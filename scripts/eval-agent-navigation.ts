#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { codemapContext } from "../src/core/context.ts";
import { indexRepo } from "../src/core/indexer.ts";
import { mergeSearchContextReadPlan } from "../src/core/navigation-read-plan.ts";
import { searchCodeMap } from "../src/core/search.ts";

interface NavigationTask {
  name: string;
  query: string;
  pathPrefix?: string;
  entry: string;
  requiredContext: string[];
  forbidden?: string[];
}

interface NavigationCaseReport {
  task: string;
  mode: NavigationMode;
  query: string;
  pathPrefix: string;
  entry: string;
  filesRead: string[];
  entryFound: boolean;
  requiredContext: number;
  foundContext: number;
  missingContext: string[];
  contextRecall: number;
  forbiddenRead: string[];
  success: boolean;
  toolCalls: number;
  latencyMs: number;
}

interface ModeMetrics {
  mode: NavigationMode;
  tasks: number;
  successRate: number;
  entryHitRate: number;
  avgContextRecall: number;
  avgFilesRead: number;
  avgToolCalls: number;
  forbiddenReadRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

interface EvalReport {
  root: string;
  readLimit: number;
  indexed: ReturnType<typeof indexRepo>;
  modes: ModeMetrics[];
  cases: NavigationCaseReport[];
}

interface GateIssue {
  label: string;
  metric: string;
  expected: string;
  actual: number | string;
}

interface ParsedArgs {
  gateEnabled: boolean;
  keepState: boolean;
  limit: number;
  maxP95LatencyMs: number;
}

type NavigationMode = "lexical" | "codemap_search" | "codemap_search_context";

const fixtureRoot = fileURLToPath(new URL("../test/fixtures/context-quality", import.meta.url));
const modes: NavigationMode[] = ["lexical", "codemap_search", "codemap_search_context"];
const tasks: NavigationTask[] = [
  {
    name: "edit budget renderer safely",
    query: "renderBudget",
    entry: "src/budget-renderer.js",
    requiredContext: [
      "src/core/format.js",
      "src/core/math.js",
      "config/app.config.json",
      "src/budget-renderer.config.json",
      "test/budget-renderer.test.js",
      "docs/budget-renderer.md",
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
    name: "inspect python service dependencies",
    query: "build_service python relative imports",
    entry: "pkg/service.py",
    requiredContext: ["pkg/util.py", "pkg/__init__.py"],
  },
  {
    name: "inspect native ledger callers",
    query: "native/ledger.h",
    entry: "native/ledger.h",
    requiredContext: ["native/ledger.cpp", "native/main.cpp"],
  },
  {
    name: "stay inside app package",
    query: "app feature implementation",
    pathPrefix: "packages/app/",
    entry: "packages/app/src/feature.js",
    requiredContext: ["packages/app/src/lib.js", "packages/app/test/feature.test.js"],
    forbidden: ["packages/other/src/feature.js", "packages/other/src/lib.js", "packages/other/test/feature.test.js"],
  },
];

const parsed = parseArgs(process.argv.slice(2));
const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-agent-navigation-"));
try {
  const report = runEval(parsed, stateDir);
  const gate = evaluateGate(report, parsed.maxP95LatencyMs);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), stateDir: parsed.keepState ? stateDir : undefined, report, gate }, null, 2));
  if (parsed.gateEnabled && !gate.passed) process.exitCode = 1;
} finally {
  if (!parsed.keepState) rmSync(stateDir, { recursive: true, force: true });
}

function parseArgs(args: string[]): ParsedArgs {
  let gateEnabled = false;
  let keepState = false;
  let limit = 8;
  let maxP95LatencyMs = 150;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [name, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? args[i + 1];
    if (arg === "--fixtures") {
      continue;
    } else if (arg === "--quality-gate") {
      gateEnabled = true;
    } else if (arg === "--keep-state") {
      keepState = true;
    } else if (name === "--limit") {
      limit = parsePositiveInteger(name, value);
      if (inlineValue === undefined) i++;
    } else if (name === "--max-p95-ms") {
      maxP95LatencyMs = parseNonNegativeNumber(name, value);
      if (inlineValue === undefined) i++;
      gateEnabled = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }
  return { gateEnabled, keepState, limit, maxP95LatencyMs };
}

function runEval(options: ParsedArgs, stateDir: string): EvalReport {
  const root = prepareFixtureRepo(stateDir);
  const indexed = indexRepo({ cwd: root, approve: true, stateDir });
  const cases = modes.flatMap((mode) => tasks.map((task) => evaluateTask({ root, stateDir, mode, task, limit: options.limit })));
  return { root, readLimit: options.limit, indexed, modes: modes.map((mode) => metricsFor(mode, cases)), cases };
}

function prepareFixtureRepo(stateDir: string): string {
  const root = join(stateDir, "agent-navigation-fixture");
  cpSync(resolve(fixtureRoot), root, { recursive: true });
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["-c", "user.email=codemap@example.invalid", "-c", "user.name=CodeMap Eval", "commit", "-m", "fixture"], { cwd: root, stdio: "ignore" });
  return root;
}

function evaluateTask(options: { root: string; stateDir: string; mode: NavigationMode; task: NavigationTask; limit: number }): NavigationCaseReport {
  const { root, stateDir, mode, task, limit } = options;
  const [latencyMs, filesRead] = timed(() => navigate({ root, stateDir, mode, task, limit }));
  const uniqueFilesRead = uniqueStrings(filesRead);
  const found = new Set(uniqueFilesRead);
  const missingContext = task.requiredContext.filter((path) => !found.has(path));
  const forbiddenRead = (task.forbidden ?? []).filter((path) => found.has(path));
  const entryFound = found.has(task.entry);
  const foundContext = task.requiredContext.length - missingContext.length;
  const contextRecall = rate(foundContext, task.requiredContext.length);
  return {
    task: task.name,
    mode,
    query: task.query,
    pathPrefix: task.pathPrefix ?? "",
    entry: task.entry,
    filesRead: uniqueFilesRead,
    entryFound,
    requiredContext: task.requiredContext.length,
    foundContext,
    missingContext,
    contextRecall,
    forbiddenRead,
    success: entryFound && contextRecall === 1 && forbiddenRead.length === 0,
    toolCalls: mode === "codemap_search_context" ? 2 : 1,
    latencyMs: roundMs(latencyMs),
  };
}

function navigate(options: { root: string; stateDir: string; mode: NavigationMode; task: NavigationTask; limit: number }): string[] {
  const { root, stateDir, mode, task, limit } = options;
  if (mode === "lexical") return lexicalSearch(root, task.query, task.pathPrefix, limit).map((hit) => hit.path);
  const searchResults = searchCodeMap({ cwd: root, query: task.query, pathPrefix: task.pathPrefix, stateDir, limit });
  const searchPaths = searchResults.map((result) => result.path);
  if (mode === "codemap_search") return searchPaths;
  const contextTarget = searchPaths[0] ?? task.query;
  const context = codemapContext({ cwd: root, target: contextTarget, pathPrefix: task.pathPrefix, stateDir, limit });
  return mergeSearchContextReadPlan(searchPaths, context.readFirst.map((item) => item.path), limit);
}

function lexicalSearch(root: string, query: string, pathPrefix = "", limit: number): Array<{ path: string; score: number }> {
  const paths = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((path) => path && path.startsWith(pathPrefix));
  const terms = queryTerms(query);
  return paths
    .map((path) => {
      const text = readFileSync(join(root, path), "utf8");
      return { path, score: lexicalScore(path, text, terms) };
    })
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit);
}

function lexicalScore(path: string, text: string, terms: string[]): number {
  const haystacks = [path.toLowerCase(), text.toLowerCase()];
  let score = 0;
  for (const term of terms) {
    const pathMatches = countOccurrences(haystacks[0], term);
    const textMatches = countOccurrences(haystacks[1], term);
    score += pathMatches * 4 + textMatches;
  }
  return score;
}

function metricsFor(mode: NavigationMode, cases: NavigationCaseReport[]): ModeMetrics {
  const modeCases = cases.filter((item) => item.mode === mode);
  const latencies = modeCases.map((item) => item.latencyMs);
  return {
    mode,
    tasks: modeCases.length,
    successRate: rate(modeCases.filter((item) => item.success).length, modeCases.length),
    entryHitRate: rate(modeCases.filter((item) => item.entryFound).length, modeCases.length),
    avgContextRecall: roundRate(avg(modeCases.map((item) => item.contextRecall))),
    avgFilesRead: roundRate(avg(modeCases.map((item) => item.filesRead.length))),
    avgToolCalls: roundRate(avg(modeCases.map((item) => item.toolCalls))),
    forbiddenReadRate: rate(modeCases.filter((item) => item.forbiddenRead.length > 0).length, modeCases.length),
    avgLatencyMs: roundMs(avg(latencies)),
    p95LatencyMs: roundMs(p95(latencies)),
  };
}

function evaluateGate(report: EvalReport, maxP95LatencyMs: number): { passed: boolean; issues: GateIssue[] } {
  const issues: GateIssue[] = [];
  const search = metric(report, "codemap_search");
  const searchContext = metric(report, "codemap_search_context");
  if (searchContext.tasks < 1) issues.push({ label: searchContext.mode, metric: "tasks", expected: "> 0", actual: searchContext.tasks });
  if (searchContext.successRate < 1) issues.push({ label: searchContext.mode, metric: "successRate", expected: "1", actual: searchContext.successRate });
  if (searchContext.entryHitRate < 1) issues.push({ label: searchContext.mode, metric: "entryHitRate", expected: "1", actual: searchContext.entryHitRate });
  if (searchContext.avgContextRecall < 1) issues.push({ label: searchContext.mode, metric: "avgContextRecall", expected: "1", actual: searchContext.avgContextRecall });
  if (searchContext.forbiddenReadRate > 0) issues.push({ label: searchContext.mode, metric: "forbiddenReadRate", expected: "0", actual: searchContext.forbiddenReadRate });
  if (searchContext.p95LatencyMs > maxP95LatencyMs) issues.push({ label: searchContext.mode, metric: "p95LatencyMs", expected: `<= ${maxP95LatencyMs}`, actual: searchContext.p95LatencyMs });
  if (searchContext.avgContextRecall <= search.avgContextRecall) issues.push({ label: searchContext.mode, metric: "contextRecallDelta", expected: `> ${search.avgContextRecall}`, actual: searchContext.avgContextRecall });
  for (const item of report.cases.filter((candidate) => candidate.mode === "codemap_search_context")) {
    for (const missing of item.missingContext) issues.push({ label: item.task, metric: "missingContext", expected: "present", actual: missing });
    for (const forbidden of item.forbiddenRead) issues.push({ label: item.task, metric: "forbiddenRead", expected: "absent", actual: forbidden });
  }
  return { passed: issues.length === 0, issues };
}

function metric(report: EvalReport, mode: NavigationMode): ModeMetrics {
  const found = report.modes.find((item) => item.mode === mode);
  if (!found) throw new Error(`Missing mode metrics for ${mode}`);
  return found;
}

function queryTerms(query: string): string[] {
  return uniqueStrings(query.toLowerCase().split(/[^a-z0-9_]+/).filter((term) => term.length > 1));
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count++;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function parsePositiveInteger(name: string, value: string | undefined): number {
  if (value === undefined || value.trim() === "") throw new Error(`${name} requires a positive integer`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} requires a positive integer`);
  return parsed;
}

function parseNonNegativeNumber(name: string, value: string | undefined): number {
  if (value === undefined || value.trim() === "") throw new Error(`${name} requires a number`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} requires a non-negative number`);
  return parsed;
}

function timed<T>(fn: () => T): [number, T] {
  const started = performance.now();
  const result = fn();
  return [performance.now() - started, result];
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : roundRate(numerator / denominator);
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}
