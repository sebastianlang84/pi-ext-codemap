#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { codemapContext } from "../src/core/context.ts";
import { indexRepo } from "../src/core/indexer.ts";
import { getRepoInfo } from "../src/core/repo.ts";
import type { CodeMapContextReasonKind } from "../src/core/relationships.ts";

interface ExpectedNeighbor {
  path: string;
  reasonKinds?: CodeMapContextReasonKind[];
}

interface ContextQualityCase {
  name: string;
  target: string;
  pathPrefix?: string;
  limit?: number;
  required: ExpectedNeighbor[];
  forbidden?: string[];
}

interface ContextQualityCaseReport {
  name: string;
  target: string;
  pathPrefix: string;
  readFirst: Array<{ path: string; reasons: CodeMapContextReasonKind[] }>;
  targetFirst: boolean;
  required: number;
  foundRequired: number;
  missingRequired: string[];
  requiredReasonKinds: number;
  foundReasonKinds: number;
  missingReasonKinds: Array<{ path: string; reasonKind: CodeMapContextReasonKind }>;
  noiseLeaks: string[];
  forbiddenLeaks: string[];
  pathPrefixLeaks: string[];
  iterations: number;
  latencySamplesMs: number[];
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  warnings: string[];
}

interface ContextQualityMetrics {
  cases: number;
  targetFirstRate: number;
  mandatoryNeighborRecallAtK: number;
  reasonKindRecall: number;
  noiseLeakRate: number;
  forbiddenLeakRate: number;
  pathPrefixLeakRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
}

interface ContextQualityReport {
  root: string;
  indexRoot: string;
  pathPrefix: string;
  indexed: ReturnType<typeof indexRepo>;
  cases: ContextQualityCaseReport[];
  metrics: ContextQualityMetrics;
}

interface GateIssue {
  label: string;
  metric: string;
  expected: string;
  actual: number | string;
}

interface ParsedArgs {
  gateEnabled: boolean;
  maxP95LatencyMs: number;
  keepState: boolean;
  iterations: number;
}

const fixtureRoot = fileURLToPath(new URL("../tests/fixtures/context-quality", import.meta.url));
const fixtureCases: ContextQualityCase[] = [
  {
    name: "js target includes direct imports, reverse test importer, config, and doc",
    target: "src/budget-renderer.js",
    limit: 8,
    required: [
      { path: "src/core/format.js", reasonKinds: ["import"] },
      { path: "src/core/math.js", reasonKinds: ["import"] },
      { path: "config/app.config.json", reasonKinds: ["import"] },
      { path: "src/budget-renderer.config.json", reasonKinds: ["near_config"] },
      { path: "test/budget-renderer.test.js", reasonKinds: ["reverse_import", "reverse_test"] },
      { path: "docs/budget-renderer.md", reasonKinds: ["related_doc"] },
    ],
    forbidden: [
      "src/budget-renderer.generated.js",
      "src/budget-renderer.min.js",
      "src/__generated__/client.js",
      "dist/budget-renderer.js",
      "package-lock.json",
    ],
  },
  {
    name: "python relative imports are read-first context",
    target: "pkg/service.py",
    limit: 6,
    required: [
      { path: "pkg/util.py", reasonKinds: ["import"] },
      { path: "pkg/__init__.py", reasonKinds: ["reverse_import"] },
    ],
  },
  {
    name: "c++ header shows source/include relationships",
    target: "native/ledger.h",
    limit: 6,
    required: [
      { path: "native/ledger.cpp", reasonKinds: ["reverse_include", "implementation_pair"] },
      { path: "native/main.cpp", reasonKinds: ["reverse_include"] },
    ],
  },
  {
    name: "pathPrefix keeps monorepo context inside the selected package",
    target: "packages/app/src/feature.js",
    pathPrefix: "packages/app/",
    limit: 5,
    required: [
      { path: "packages/app/src/lib.js", reasonKinds: ["import"] },
      { path: "packages/app/test/feature.test.js", reasonKinds: ["reverse_import", "reverse_test"] },
    ],
  },
];

const parsed = parseArgs(process.argv.slice(2));
const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-context-quality-"));
try {
  const report = benchmarkFixture(parsed, stateDir);
  const gate = evaluateGate(report, parsed.maxP95LatencyMs);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), stateDir: parsed.keepState ? stateDir : undefined, report, gate }, null, 2));
  if (parsed.gateEnabled && !gate.passed) process.exitCode = 1;
} finally {
  if (!parsed.keepState) rmSync(stateDir, { recursive: true, force: true });
}

function parseArgs(args: string[]): ParsedArgs {
  let gateEnabled = false;
  let maxP95LatencyMs = 100;
  let keepState = false;
  let iterations = 5;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [name, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? args[i + 1];
    if (arg === "--fixtures") {
      continue;
    } else if (arg === "--quality-gate") {
      gateEnabled = true;
    } else if (name === "--max-p95-ms") {
      maxP95LatencyMs = parseNonNegativeArg(name, value);
      if (inlineValue === undefined) i++;
      gateEnabled = true;
    } else if (name === "--iterations") {
      iterations = parsePositiveIntegerArg(name, value);
      if (inlineValue === undefined) i++;
    } else if (arg === "--keep-state") {
      keepState = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }
  return { gateEnabled, maxP95LatencyMs, keepState, iterations };
}

function benchmarkFixture(parsed: ParsedArgs, stateDir: string): ContextQualityReport {
  const root = prepareFixtureRepo(stateDir);
  const info = getRepoInfo(root, { stateDir });
  const pathPrefix = relative(info.root, root).split("\\").join("/");
  const indexed = indexRepo({ cwd: root, approve: true, pathPrefix, stateDir });
  const cases = fixtureCases.map((qualityCase) => evaluateCase(root, indexed.pathPrefix, qualityCase, stateDir, parsed.iterations));
  return {
    root,
    indexRoot: indexed.root,
    pathPrefix: indexed.pathPrefix,
    indexed,
    cases,
    metrics: aggregateMetrics(cases),
  };
}

function prepareFixtureRepo(stateDir: string): string {
  const root = join(stateDir, "context-quality-fixture");
  cpSync(resolve(fixtureRoot), root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["-c", "user.email=codemap@example.invalid", "-c", "user.name=CodeMap Benchmark", "commit", "-m", "fixture"], { cwd: root, stdio: "ignore" });
  return root;
}

function evaluateCase(root: string, fixturePathPrefix: string, qualityCase: ContextQualityCase, stateDir: string, iterations: number): ContextQualityCaseReport {
  const target = joinPath(fixturePathPrefix, qualityCase.target);
  const pathPrefix = joinPath(fixturePathPrefix, qualityCase.pathPrefix ?? "");
  const expected = qualityCase.required.map((item) => ({ ...item, path: joinPath(fixturePathPrefix, item.path) }));
  const forbidden = new Set((qualityCase.forbidden ?? []).map((path) => joinPath(fixturePathPrefix, path)));
  const latencySamplesMs: number[] = [];
  let context: ReturnType<typeof codemapContext> | undefined;
  for (let i = 0; i < iterations; i++) {
    const [latencyMs, nextContext] = timed(() => codemapContext({ cwd: root, target, pathPrefix, stateDir, limit: qualityCase.limit ?? 8 }));
    latencySamplesMs.push(roundMs(latencyMs));
    context = nextContext;
  }
  if (!context) throw new Error("Context benchmark requires at least one iteration");
  const readFirst = context.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) ?? [] }));
  const readFirstPaths = new Set(readFirst.map((item) => item.path));
  const missingRequired = expected.filter((item) => !readFirstPaths.has(item.path)).map((item) => item.path);
  const missingReasonKinds: Array<{ path: string; reasonKind: CodeMapContextReasonKind }> = [];
  let requiredReasonKinds = 0;
  let foundReasonKinds = 0;
  for (const item of expected) {
    const reasonKinds = readFirst.find((candidate) => candidate.path === item.path)?.reasons ?? [];
    for (const reasonKind of item.reasonKinds ?? []) {
      requiredReasonKinds++;
      if (reasonKinds.includes(reasonKind)) foundReasonKinds++;
      else missingReasonKinds.push({ path: item.path, reasonKind });
    }
  }
  return {
    name: qualityCase.name,
    target,
    pathPrefix,
    readFirst,
    targetFirst: readFirst[0]?.path === target,
    required: expected.length,
    foundRequired: expected.length - missingRequired.length,
    missingRequired,
    requiredReasonKinds,
    foundReasonKinds,
    missingReasonKinds,
    noiseLeaks: readFirst.map((item) => item.path).filter(isNoisyPath),
    forbiddenLeaks: readFirst.map((item) => item.path).filter((path) => forbidden.has(path)),
    pathPrefixLeaks: readFirst.map((item) => item.path).filter((path) => !path.startsWith(pathPrefix)),
    iterations,
    latencySamplesMs,
    avgLatencyMs: roundMs(avg(latencySamplesMs)),
    p95LatencyMs: roundMs(p95(latencySamplesMs)),
    maxLatencyMs: roundMs(Math.max(0, ...latencySamplesMs)),
    warnings: context.warnings,
  };
}

function aggregateMetrics(cases: ContextQualityCaseReport[]): ContextQualityMetrics {
  const required = sum(cases.map((item) => item.required));
  const foundRequired = sum(cases.map((item) => item.foundRequired));
  const reasonKinds = sum(cases.map((item) => item.requiredReasonKinds));
  const foundReasonKinds = sum(cases.map((item) => item.foundReasonKinds));
  const latencies = cases.flatMap((item) => item.latencySamplesMs);
  return {
    cases: cases.length,
    targetFirstRate: rate(cases.filter((item) => item.targetFirst).length, cases.length),
    mandatoryNeighborRecallAtK: rate(foundRequired, required),
    reasonKindRecall: rate(foundReasonKinds, reasonKinds),
    noiseLeakRate: rate(cases.filter((item) => item.noiseLeaks.length > 0).length, cases.length),
    forbiddenLeakRate: rate(cases.filter((item) => item.forbiddenLeaks.length > 0).length, cases.length),
    pathPrefixLeakRate: rate(cases.filter((item) => item.pathPrefixLeaks.length > 0).length, cases.length),
    avgLatencyMs: roundMs(avg(latencies)),
    p95LatencyMs: roundMs(p95(latencies)),
    maxLatencyMs: roundMs(Math.max(0, ...latencies)),
  };
}

function evaluateGate(report: ContextQualityReport, maxP95LatencyMs: number): { passed: boolean; issues: GateIssue[] } {
  const metrics = report.metrics;
  const issues: GateIssue[] = [];
  if (metrics.cases < 1) issues.push({ label: report.root, metric: "cases", expected: "> 0", actual: metrics.cases });
  if (metrics.targetFirstRate < 1) issues.push({ label: report.root, metric: "targetFirstRate", expected: "1", actual: metrics.targetFirstRate });
  if (metrics.mandatoryNeighborRecallAtK < 1) issues.push({ label: report.root, metric: "mandatoryNeighborRecallAtK", expected: "1", actual: metrics.mandatoryNeighborRecallAtK });
  if (metrics.reasonKindRecall < 1) issues.push({ label: report.root, metric: "reasonKindRecall", expected: "1", actual: metrics.reasonKindRecall });
  if (metrics.noiseLeakRate > 0) issues.push({ label: report.root, metric: "noiseLeakRate", expected: "0", actual: metrics.noiseLeakRate });
  if (metrics.forbiddenLeakRate > 0) issues.push({ label: report.root, metric: "forbiddenLeakRate", expected: "0", actual: metrics.forbiddenLeakRate });
  if (metrics.pathPrefixLeakRate > 0) issues.push({ label: report.root, metric: "pathPrefixLeakRate", expected: "0", actual: metrics.pathPrefixLeakRate });
  if (metrics.p95LatencyMs > maxP95LatencyMs) issues.push({ label: report.root, metric: "p95LatencyMs", expected: `<= ${maxP95LatencyMs}`, actual: metrics.p95LatencyMs });
  for (const qualityCase of report.cases) {
    for (const path of qualityCase.missingRequired) issues.push({ label: qualityCase.name, metric: "missingRequired", expected: "present in readFirst", actual: path });
    for (const missing of qualityCase.missingReasonKinds) issues.push({ label: qualityCase.name, metric: "missingReasonKind", expected: `${missing.reasonKind} on ${missing.path}`, actual: qualityCase.readFirst.find((item) => item.path === missing.path)?.reasons.join(",") ?? "missing" });
    for (const path of qualityCase.noiseLeaks) issues.push({ label: qualityCase.name, metric: "noiseLeak", expected: "no noisy readFirst path", actual: path });
    for (const path of qualityCase.forbiddenLeaks) issues.push({ label: qualityCase.name, metric: "forbiddenLeak", expected: "no explicitly forbidden readFirst path", actual: path });
    for (const path of qualityCase.pathPrefixLeaks) issues.push({ label: qualityCase.name, metric: "pathPrefixLeak", expected: `inside ${qualityCase.pathPrefix}`, actual: path });
  }
  return { passed: issues.length === 0, issues };
}

function parseNonNegativeArg(name: string, value: string | undefined): number {
  if (value === undefined || value.trim() === "") throw new Error(`${name} requires a numeric value`);
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) throw new Error(`${name} requires a non-negative numeric value`);
  return parsedValue;
}

function parsePositiveIntegerArg(name: string, value: string | undefined): number {
  if (value === undefined || value.trim() === "") throw new Error(`${name} requires a positive integer`);
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 1) throw new Error(`${name} requires a positive integer`);
  return parsedValue;
}

function timed<T>(fn: () => T): [number, T] {
  const start = performance.now();
  const result = fn();
  return [performance.now() - start, result];
}

function joinPath(prefix: string, path: string): string {
  return `${prefix}${path}`.replace(/\/+/g, "/");
}

function isNoisyPath(path: string): boolean {
  return /(?:^|\/)(?:dist|build|__generated__|generated)(?:\/|$)|(?:^|\/)package-lock\.json$|\.min\.[cm]?js$/i.test(path);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : roundRate(numerator / denominator);
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}
