#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { summarizeMissTaxonomy, type MissDiagnostic, type MissTaxonomySummary } from "../src/core/eval-miss-taxonomy.ts";
import { indexRepo } from "../src/core/indexer.ts";
import {
  assessNavigationCase,
  lexicalScore,
  navigateForNavigationEval,
  parseNonNegativeNumber,
  parsePositiveInteger,
  queryTerms,
  roundMs,
  stripScoreComponents,
  summarizeModeMetrics,
  timed,
  type BaseModeMetrics,
  type FileSelectionDiagnostic,
  type NavigationEvalLookupResult,
  type SearchCandidateSelectionDiagnostic,
} from "../src/core/navigation-eval.ts";

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
  expectedFiles: number;
  foundExpectedFiles: number;
  expectedRecall: number;
  missingExpectedFiles: string[];
  filesRead: string[];
  entryFound: boolean;
  requiredContext: number;
  foundContext: number;
  missingContext: string[];
  contextRecall: number;
  forbiddenRead: string[];
  misses: MissDiagnostic[];
  navigationDiagnostics: NavigationDiagnostics;
  success: boolean;
  toolCalls: number;
  latencyMs: number;
}

interface NavigationDiagnostics {
  searchTop: FileSelectionDiagnostic[];
  searchCandidates?: SearchCandidateSelectionDiagnostic[];
  contextTarget?: string;
  readFirst?: FileSelectionDiagnostic[];
  readPlan?: string[];
  readPlanDebug?: NavigationEvalLookupResult["readPlanDebug"];
}

type ModeMetrics = BaseModeMetrics;

interface EvalReport {
  root: string;
  readLimit: number;
  indexed: ReturnType<typeof indexRepo>;
  modes: ModeMetrics[];
  cases: NavigationCaseReport[];
  missTaxonomy: MissTaxonomySummary;
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

const fixtureRoot = fileURLToPath(new URL("../tests/fixtures/context-quality", import.meta.url));
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
  return {
    root,
    readLimit: options.limit,
    indexed,
    modes: modes.map((mode) => metricsFor(mode, cases)),
    cases,
    missTaxonomy: summarizeMissTaxonomy(cases.flatMap((item) => item.misses)),
  };
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
  const [latencyMs, navigation] = timed(() => navigate({ root, stateDir, mode, task, limit }));
  const assessment = assessNavigationCase({ ...task, filesRead: navigation.filesRead, emptyRecall: 1 });
  const {
    uniqueFilesRead,
    expectedFiles,
    foundExpectedFiles,
    expectedRecall,
    missingExpectedFiles,
    entryFound,
    requiredContext,
    foundContext,
    missingContext,
    contextRecall,
    forbiddenRead,
    misses,
    success,
  } = assessment;
  const includeDebugDetails = missingExpectedFiles.length > 0 || forbiddenRead.length > 0;
  return {
    task: task.name,
    mode,
    query: task.query,
    pathPrefix: task.pathPrefix ?? "",
    entry: task.entry,
    expectedFiles,
    foundExpectedFiles,
    expectedRecall,
    missingExpectedFiles,
    filesRead: uniqueFilesRead,
    entryFound,
    requiredContext,
    foundContext,
    missingContext,
    contextRecall,
    forbiddenRead,
    misses,
    navigationDiagnostics: {
      searchTop: includeDebugDetails ? navigation.searchTop : stripScoreComponents(navigation.searchTop),
      searchCandidates: includeDebugDetails ? navigation.searchCandidates : undefined,
      contextTarget: navigation.contextTarget,
      readFirst: navigation.readFirst,
      readPlan: uniqueFilesRead,
      readPlanDebug: includeDebugDetails ? navigation.readPlanDebug : undefined,
    },
    success,
    toolCalls: mode === "codemap_search_context" ? 2 : 1,
    latencyMs: roundMs(latencyMs),
  };
}

function navigate(options: { root: string; stateDir: string; mode: NavigationMode; task: NavigationTask; limit: number }): NavigationEvalLookupResult {
  const { root, stateDir, mode, task, limit } = options;
  return navigateForNavigationEval({ root, stateDir, mode, query: task.query, pathPrefix: task.pathPrefix, limit, lexicalSearch });
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

function metricsFor(mode: NavigationMode, cases: NavigationCaseReport[]): ModeMetrics {
  return summarizeModeMetrics(mode, cases, { emptyRate: 1 });
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
