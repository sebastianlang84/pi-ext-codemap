#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { codemapContext } from "../src/core/context.ts";
import { classifyMisses, summarizeMissTaxonomy, type MissDiagnostic, type MissTaxonomySummary } from "../src/core/eval-miss-taxonomy.ts";
import { indexRepo } from "../src/core/indexer.ts";
import { explainSearchContextReadPlan, mergeSearchContextReadPlan, type ReadPlanDiagnostics } from "../src/core/navigation-read-plan.ts";
import { searchCodeMapDebug, type SearchCandidateDebugDiagnostic } from "../src/core/search.ts";

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

interface FileSelectionDiagnostic {
  path: string;
  source: "lexical" | "search" | "context";
  rank: number;
  score?: number;
  kind?: string;
  reasons?: string[];
  scoreComponents?: ScoreComponentDiagnostics;
}

interface SearchCandidateSelectionDiagnostic {
  path: string;
  source: string;
  rank?: number;
  score: number;
  decision: string;
  kind: string;
  scoreComponents: ScoreComponentDiagnostics;
}

interface ScoreComponentDiagnostics {
  retrievalBoost: number;
  ftsScore: number;
  pathScore: number;
  filenameScore: number;
  exactTextScore: number;
  symbolScore: number;
  textCoverageScore: number;
  tokenCoverage: number;
  matchedTokens: string[];
  codeIntentBoost: number;
  roleBoost: number;
  testPenalty: number;
  docPenalty: number;
  noisePenalty: number;
  roles: string[];
}

interface NavigationDiagnostics {
  searchTop: FileSelectionDiagnostic[];
  searchCandidates?: SearchCandidateSelectionDiagnostic[];
  contextTarget?: string;
  readFirst?: FileSelectionDiagnostic[];
  readPlan?: string[];
  readPlanDebug?: ReadPlanDiagnostics;
}

interface NavigationResult {
  filesRead: string[];
  searchTop: FileSelectionDiagnostic[];
  searchCandidates?: SearchCandidateSelectionDiagnostic[];
  contextTarget?: string;
  readFirst?: FileSelectionDiagnostic[];
  readPlanDebug?: ReadPlanDiagnostics;
}

interface ModeMetrics {
  mode: NavigationMode;
  tasks: number;
  successRate: number;
  entryHitRate: number;
  avgExpectedRecall: number;
  avgContextRecall: number;
  avgFilesRead: number;
  avgToolCalls: number;
  forbiddenReadRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  missTaxonomy: MissTaxonomySummary;
}

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
  const uniqueFilesRead = uniqueStrings(navigation.filesRead);
  const found = new Set(uniqueFilesRead);
  const expected = uniqueStrings([task.entry, ...task.requiredContext]);
  const missingExpectedFiles = expected.filter((path) => !found.has(path));
  const missingContext = task.requiredContext.filter((path) => !found.has(path));
  const forbiddenRead = (task.forbidden ?? []).filter((path) => found.has(path));
  const entryFound = found.has(task.entry);
  const foundExpectedFiles = expected.length - missingExpectedFiles.length;
  const foundContext = task.requiredContext.length - missingContext.length;
  const contextRecall = rate(foundContext, task.requiredContext.length);
  const misses = classifyMisses({
    query: task.query,
    entry: task.entry,
    requiredContext: task.requiredContext,
    missingExpectedFiles,
    forbiddenRead,
    indexStale: false,
  });
  const includeDebugDetails = missingExpectedFiles.length > 0 || forbiddenRead.length > 0;
  return {
    task: task.name,
    mode,
    query: task.query,
    pathPrefix: task.pathPrefix ?? "",
    entry: task.entry,
    expectedFiles: expected.length,
    foundExpectedFiles,
    expectedRecall: rate(foundExpectedFiles, expected.length),
    missingExpectedFiles,
    filesRead: uniqueFilesRead,
    entryFound,
    requiredContext: task.requiredContext.length,
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
    success: entryFound && contextRecall === 1 && forbiddenRead.length === 0,
    toolCalls: mode === "codemap_search_context" ? 2 : 1,
    latencyMs: roundMs(latencyMs),
  };
}

function navigate(options: { root: string; stateDir: string; mode: NavigationMode; task: NavigationTask; limit: number }): NavigationResult {
  const { root, stateDir, mode, task, limit } = options;
  if (mode === "lexical") {
    const hits = lexicalSearch(root, task.query, task.pathPrefix, limit);
    return {
      filesRead: hits.map((hit) => hit.path),
      searchTop: uniqueSelections(hits.map((hit, index) => ({ path: hit.path, source: "lexical", rank: index + 1, score: hit.score }))),
    };
  }
  const searchDebug = searchCodeMapDebug({ cwd: root, query: task.query, pathPrefix: task.pathPrefix, stateDir, limit });
  const searchResults = searchDebug.results;
  const searchPaths = searchResults.map((result) => result.path);
  const searchCandidateBySelectedRank = new Map(searchDebug.candidates.filter((candidate) => candidate.selectedRank !== undefined).map((candidate) => [candidate.selectedRank, candidate]));
  const searchTop: FileSelectionDiagnostic[] = uniqueSelections(searchResults.map((result, index) => {
    const candidate = searchCandidateBySelectedRank.get(index + 1);
    return {
      path: result.path,
      source: "search",
      rank: index + 1,
      score: roundRate(result.score),
      kind: result.kind,
      scoreComponents: candidate ? scoreComponents(candidate) : undefined,
    };
  }));
  const searchCandidates = compactSearchCandidates(searchDebug.candidates, limit);
  if (mode === "codemap_search") return { filesRead: searchPaths, searchTop, searchCandidates };
  const contextTarget = searchPaths[0] ?? task.query;
  const context = codemapContext({ cwd: root, target: contextTarget, pathPrefix: task.pathPrefix, stateDir, limit });
  const readFirst: FileSelectionDiagnostic[] = uniqueSelections(context.readFirst.map((item, index) => ({
    path: item.path,
    source: "context",
    rank: index + 1,
    score: "score" in item ? roundRate(item.score) : undefined,
    kind: item.kind,
    reasons: item.reasons?.map((reason) => reason.kind),
  })));
  const filesRead = mergeSearchContextReadPlan(searchPaths, context.readFirst, limit);
  const readPlanDebug = explainSearchContextReadPlan(searchPaths, context.readFirst, limit);
  return { filesRead, searchTop, searchCandidates, contextTarget, readFirst, readPlanDebug };
}

function stripScoreComponents(items: FileSelectionDiagnostic[]): FileSelectionDiagnostic[] {
  return items.map(({ scoreComponents: _scoreComponents, ...item }) => item);
}

function uniqueSelections(items: FileSelectionDiagnostic[]): FileSelectionDiagnostic[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
}

function compactSearchCandidates(candidates: SearchCandidateDebugDiagnostic[], limit: number): SearchCandidateSelectionDiagnostic[] {
  return candidates
    .filter((candidate) => candidate.decision !== "non_positive_score")
    .sort((left, right) => (left.selectedRank ?? Number.MAX_SAFE_INTEGER) - (right.selectedRank ?? Number.MAX_SAFE_INTEGER) || right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, Math.max(limit * 4, limit))
    .map((candidate) => ({
      path: candidate.path,
      source: candidate.source,
      rank: candidate.selectedRank,
      score: roundRate(candidate.score),
      decision: candidate.decision,
      kind: candidate.kind,
      scoreComponents: scoreComponents(candidate),
    }));
}

function scoreComponents(candidate: SearchCandidateDebugDiagnostic): ScoreComponentDiagnostics {
  return {
    retrievalBoost: roundRate(candidate.scoreDiagnostics.retrievalBoost),
    ftsScore: roundRate(candidate.scoreDiagnostics.ftsScore),
    pathScore: roundRate(candidate.scoreDiagnostics.pathScore),
    filenameScore: roundRate(candidate.scoreDiagnostics.filenameScore),
    exactTextScore: roundRate(candidate.scoreDiagnostics.exactTextScore),
    symbolScore: roundRate(candidate.scoreDiagnostics.symbolScore),
    textCoverageScore: roundRate(candidate.scoreDiagnostics.textCoverageScore),
    tokenCoverage: roundRate(candidate.scoreDiagnostics.tokenCoverage),
    matchedTokens: candidate.scoreDiagnostics.matchedTokens,
    codeIntentBoost: roundRate(candidate.scoreDiagnostics.codeIntentBoost),
    roleBoost: roundRate(candidate.scoreDiagnostics.roleBoost),
    testPenalty: roundRate(candidate.scoreDiagnostics.testPenalty),
    docPenalty: roundRate(candidate.scoreDiagnostics.docPenalty),
    noisePenalty: roundRate(candidate.scoreDiagnostics.noisePenalty),
    roles: candidate.scoreDiagnostics.roles,
  };
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
    avgExpectedRecall: roundRate(avg(modeCases.map((item) => item.expectedRecall))),
    avgContextRecall: roundRate(avg(modeCases.map((item) => item.contextRecall))),
    avgFilesRead: roundRate(avg(modeCases.map((item) => item.filesRead.length))),
    avgToolCalls: roundRate(avg(modeCases.map((item) => item.toolCalls))),
    forbiddenReadRate: rate(modeCases.filter((item) => item.forbiddenRead.length > 0).length, modeCases.length),
    avgLatencyMs: roundMs(avg(latencies)),
    p95LatencyMs: roundMs(p95(latencies)),
    missTaxonomy: summarizeMissTaxonomy(modeCases.flatMap((item) => item.misses)),
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
