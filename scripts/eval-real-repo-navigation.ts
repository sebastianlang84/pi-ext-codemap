#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { explainNavigationMisses, summarizeNavigationMissReasons, type NavigationMissExplanation, type NavigationMissReasonSummary } from "../src/core/eval-navigation-diagnostics.ts";
import { missClasses, summarizeMissTaxonomy, type MissClass, type MissDiagnostic, type MissTaxonomySummary } from "../src/core/eval-miss-taxonomy.ts";
import { indexRepo, status as indexStatus } from "../src/core/indexer.ts";
import {
  assessNavigationCase,
  deltaMetrics,
  lexicalScore,
  navigateForNavigationEval,
  parseNonNegativeNumber,
  parsePositiveInteger,
  queryTerms,
  roundMs,
  roundRate,
  stripScoreComponents,
  summarizeModeMetrics,
  timed,
  type BaseModeMetrics,
  type DeltaMetrics,
  type FileSelectionDiagnostic,
  type NavigationEvalLookupResult,
  type NavigationMode,
  type SearchCandidateSelectionDiagnostic,
} from "../src/core/navigation-eval.ts";

type TaskCohort = "baseline" | "natural_holdout";

interface RealRepoTask {
  name: string;
  cohort?: TaskCohort;
  query: string;
  pathPrefix?: string;
  entry: string;
  requiredContext: string[];
  forbidden?: string[];
  missHints?: Record<string, MissClass | MissClass[]>;
}

interface RealRepoSuite {
  label: string;
  root: string;
  tasks: RealRepoTask[];
}

interface CaseReport {
  repo: string;
  root: string;
  task: string;
  cohort: TaskCohort;
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
  contextRecall: number;
  forbiddenRead: string[];
  misses: MissDiagnostic[];
  navigationDiagnostics: NavigationDiagnostics;
  success: boolean;
  toolCalls: number;
  bytesRead: number;
  latencyMs: number;
}

interface NavigationDiagnostics {
  searchTop: FileSelectionDiagnostic[];
  searchCandidates?: SearchCandidateSelectionDiagnostic[];
  contextTarget?: string;
  readFirst?: FileSelectionDiagnostic[];
  readPlan?: string[];
  readPlanDebug?: NavigationEvalLookupResult["readPlanDebug"];
  missingExpected: NavigationMissExplanation[];
}

interface ModeMetrics extends BaseModeMetrics {
  navigationMissReasons: NavigationMissReasonSummary;
}

interface CohortReport {
  cohort: TaskCohort;
  tasks: number;
  modes: ModeMetrics[];
  missTaxonomy: MissTaxonomySummary;
  deltas: {
    searchContextVsLexical: DeltaMetrics;
    searchContextVsSearch: DeltaMetrics;
  };
}

interface RepoReport {
  label: string;
  root: string;
  skipped?: string;
  taskCounts: Record<TaskCohort, number>;
  indexed?: ReturnType<typeof indexRepo>;
  modes: ModeMetrics[];
  cases: CaseReport[];
  missTaxonomy: MissTaxonomySummary;
}

interface EvalReport {
  readLimit: number;
  stateDir: string;
  repos: RepoReport[];
  modes: ModeMetrics[];
  cohorts: CohortReport[];
  missTaxonomy: MissTaxonomySummary;
  deltas: {
    searchContextVsLexical: DeltaMetrics;
    searchContextVsSearch: DeltaMetrics;
  };
}

interface ParsedArgs {
  gateEnabled: boolean;
  keepState: boolean;
  requireRepos: boolean;
  limit: number;
  maxP95LatencyMs: number;
  minTasks: number;
  minNaturalHoldoutTasks: number;
  minNaturalHoldoutExpectedRecall: number;
  minNaturalHoldoutContextRecall: number;
  minSuccessDeltaVsLexical: number;
  minContextRecallDeltaVsSearch: number;
  minContextWinsVsSearch: number;
  maxContextLossesVsSearch: number;
  maxSingleContextLossVsSearch: number;
}

const modes: NavigationMode[] = ["lexical", "codemap_search", "codemap_search_context"];
const taskCohorts: TaskCohort[] = ["baseline", "natural_holdout"];
// Real-repo suites live in a checked-in data module (home-relative roots), not inline machine paths.
const defaultSuites: RealRepoSuite[] = loadSuites();

const parsed = parseArgs(process.argv.slice(2));
const suites = configuredSuites(process.env.CODEMAP_EVAL_REPOS);
const stateDir = join(tmpdir(), `pi-codemap-real-repo-navigation-${process.pid}-${Date.now()}`);
try {
  const report = runEval(parsed, stateDir, suites);
  const gate = evaluateGate(report, parsed);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), report: parsed.keepState ? report : { ...report, stateDir: undefined }, gate }, null, 2));
  if (parsed.gateEnabled && !gate.passed) process.exitCode = 1;
} finally {
  if (!parsed.keepState) rmSync(stateDir, { recursive: true, force: true });
}

function parseArgs(args: string[]): ParsedArgs {
  let gateEnabled = false;
  let keepState = false;
  let requireRepos = false;
  let limit = 5;
  let maxP95LatencyMs = 500;
  let minTasks = 8;
  let minNaturalHoldoutTasks = 16;
  let minNaturalHoldoutExpectedRecall = 0.55;
  let minNaturalHoldoutContextRecall = 0.55;
  let minSuccessDeltaVsLexical = 0.2;
  let minContextRecallDeltaVsSearch = 0.2;
  let minContextWinsVsSearch = 5;
  let maxContextLossesVsSearch = 1;
  let maxSingleContextLossVsSearch = 0.25;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [name, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? args[i + 1];
    if (arg === "--local-repos") {
      continue;
    } else if (arg === "--quality-gate") {
      gateEnabled = true;
    } else if (arg === "--keep-state") {
      keepState = true;
    } else if (arg === "--require-repos") {
      requireRepos = true;
    } else if (name === "--limit") {
      limit = parsePositiveInteger(name, value);
      if (inlineValue === undefined) i++;
    } else if (name === "--max-p95-ms") {
      maxP95LatencyMs = parseNonNegativeNumber(name, value);
      if (inlineValue === undefined) i++;
      gateEnabled = true;
    } else if (name === "--min-tasks") {
      minTasks = parsePositiveInteger(name, value);
      if (inlineValue === undefined) i++;
    } else if (name === "--min-natural-holdout-tasks") {
      minNaturalHoldoutTasks = parsePositiveInteger(name, value);
      if (inlineValue === undefined) i++;
    } else if (name === "--min-natural-holdout-expected-recall") {
      minNaturalHoldoutExpectedRecall = parseNonNegativeNumber(name, value);
      if (inlineValue === undefined) i++;
    } else if (name === "--min-natural-holdout-context-recall") {
      minNaturalHoldoutContextRecall = parseNonNegativeNumber(name, value);
      if (inlineValue === undefined) i++;
    } else if (name === "--min-success-delta-vs-lexical") {
      minSuccessDeltaVsLexical = parseNonNegativeNumber(name, value);
      if (inlineValue === undefined) i++;
    } else if (name === "--min-context-recall-delta-vs-search") {
      minContextRecallDeltaVsSearch = parseNonNegativeNumber(name, value);
      if (inlineValue === undefined) i++;
    } else if (name === "--min-context-wins-vs-search") {
      minContextWinsVsSearch = parsePositiveInteger(name, value);
      if (inlineValue === undefined) i++;
    } else if (name === "--max-context-losses-vs-search") {
      maxContextLossesVsSearch = parseNonNegativeNumber(name, value);
      if (inlineValue === undefined) i++;
    } else if (name === "--max-single-context-loss-vs-search") {
      maxSingleContextLossVsSearch = parseNonNegativeNumber(name, value);
      if (inlineValue === undefined) i++;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }
  return { gateEnabled, keepState, requireRepos, limit, maxP95LatencyMs, minTasks, minNaturalHoldoutTasks, minNaturalHoldoutExpectedRecall, minNaturalHoldoutContextRecall, minSuccessDeltaVsLexical, minContextRecallDeltaVsSearch, minContextWinsVsSearch, maxContextLossesVsSearch, maxSingleContextLossVsSearch };
}

function configuredSuites(raw: string | undefined): RealRepoSuite[] {
  if (!raw?.trim()) return defaultSuites;
  const knownSuites = new Map(defaultSuites.map((suite) => [suite.label, suite]));
  const seen = new Set<string>();
  const suites = raw.split(/[\n,]/).map((value) => value.trim()).filter(Boolean).map((spec) => {
    const separator = spec.indexOf("=");
    if (separator <= 0 || separator === spec.length - 1) throw new Error(`Invalid CODEMAP_EVAL_REPOS entry: ${spec}. Expected label=/absolute/path.`);
    const label = spec.slice(0, separator).trim();
    const root = spec.slice(separator + 1).trim();
    const suite = knownSuites.get(label);
    if (!suite) throw new Error(`Unknown CODEMAP_EVAL_REPOS suite: ${label}. Known suites: ${[...knownSuites.keys()].join(", ")}.`);
    if (seen.has(label)) throw new Error(`Duplicate CODEMAP_EVAL_REPOS suite: ${label}.`);
    if (!isAbsolute(root)) throw new Error(`CODEMAP_EVAL_REPOS path for ${label} must be absolute: ${root}.`);
    seen.add(label);
    return { ...suite, root };
  });
  if (suites.length === 0) throw new Error("CODEMAP_EVAL_REPOS did not contain any suites.");
  return suites;
}

function runEval(options: ParsedArgs, stateDir: string, suites: RealRepoSuite[]): EvalReport {
  const repos = suites.map((suite) => runSuite(suite, options, stateDir));
  const allCases = repos.flatMap((repo) => repo.cases);
  const aggregateModes = modes.map((mode) => metricsFor(mode, allCases));
  const searchContext = metric(aggregateModes, "codemap_search_context");
  const lexical = metric(aggregateModes, "lexical");
  const search = metric(aggregateModes, "codemap_search");
  return {
    readLimit: options.limit,
    stateDir,
    repos,
    modes: aggregateModes,
    cohorts: taskCohorts.map((cohort) => metricsForCohort(cohort, allCases)).filter((item) => item.tasks > 0),
    missTaxonomy: summarizeMissTaxonomy(allCases.flatMap((item) => item.misses)),
    deltas: {
      searchContextVsLexical: delta(searchContext, lexical),
      searchContextVsSearch: delta(searchContext, search),
    },
  };
}

function runSuite(suite: RealRepoSuite, options: ParsedArgs, stateDir: string): RepoReport {
  const taskCounts = taskCohorts.reduce<Record<TaskCohort, number>>((counts, cohort) => {
    counts[cohort] = suite.tasks.filter((task) => (task.cohort ?? "baseline") === cohort).length;
    return counts;
  }, { baseline: 0, natural_holdout: 0 });
  if (!existsSync(suite.root)) return { label: suite.label, root: suite.root, skipped: "missing repo", taskCounts, modes: [], cases: [], missTaxonomy: summarizeMissTaxonomy([]) };
  const indexed = indexRepo({ cwd: suite.root, approve: true, stateDir });
  const currentStatus = indexStatus(suite.root, { stateDir, health: "full" });
  const indexStale = Boolean(currentStatus.headChanged || currentStatus.changed > 0 || currentStatus.missing > 0 || currentStatus.deleted > 0);
  const cases = modes.flatMap((mode) => suite.tasks.map((task) => evaluateTask({ suite, stateDir, mode, task, limit: options.limit, indexStale })));
  return { label: suite.label, root: suite.root, taskCounts, indexed, modes: modes.map((mode) => metricsFor(mode, cases)), cases, missTaxonomy: summarizeMissTaxonomy(cases.flatMap((item) => item.misses)) };
}

function evaluateTask(options: { suite: RealRepoSuite; stateDir: string; mode: NavigationMode; task: RealRepoTask; limit: number; indexStale: boolean }): CaseReport {
  const { suite, stateDir, mode, task, limit, indexStale } = options;
  const [latencyMs, navigation] = timed(() => navigate({ root: suite.root, stateDir, mode, task, limit }));
  const assessment = assessNavigationCase({ ...task, filesRead: navigation.filesRead, indexStale });
  const {
    uniqueFilesRead,
    expectedFiles,
    foundExpectedFiles,
    expectedRecall,
    missingExpectedFiles,
    entryFound,
    requiredContext,
    foundContext,
    contextRecall,
    forbiddenRead,
    misses,
    success,
  } = assessment;
  const includeDebugDetails = missingExpectedFiles.length > 0 || forbiddenRead.length > 0;
  const navigationDiagnostics: NavigationDiagnostics = {
    searchTop: includeDebugDetails ? navigation.searchTop : stripScoreComponents(navigation.searchTop),
    contextTarget: navigation.contextTarget,
    searchCandidates: includeDebugDetails ? navigation.searchCandidates : undefined,
    readFirst: navigation.readFirst,
    readPlan: uniqueFilesRead,
    readPlanDebug: includeDebugDetails ? navigation.readPlanDebug : undefined,
    missingExpected: explainNavigationMisses({
      mode,
      entry: task.entry,
      requiredContext: task.requiredContext,
      missingExpectedFiles,
      filesRead: uniqueFilesRead,
      searchPaths: navigation.searchTop.map((item) => item.path),
      contextTarget: navigation.contextTarget,
      readFirstPaths: navigation.readFirst?.map((item) => item.path),
      readPlanPaths: uniqueFilesRead,
    }),
  };
  return {
    repo: suite.label,
    root: suite.root,
    task: task.name,
    cohort: task.cohort ?? "baseline",
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
    contextRecall,
    forbiddenRead,
    misses,
    navigationDiagnostics,
    success,
    toolCalls: mode === "codemap_search_context" ? 2 : 1,
    bytesRead: sumBytesRead(suite.root, uniqueFilesRead),
    latencyMs: roundMs(latencyMs),
  };
}

// On-disk byte cost of the files a mode read, a model-independent proxy for the tokens an agent
// would spend loading them. Missing/unreadable files contribute 0.
function sumBytesRead(root: string, paths: string[]): number {
  let bytes = 0;
  for (const path of paths) {
    try {
      bytes += statSync(join(root, path)).size;
    } catch {
      // File not present in the working tree; counts as no read cost.
    }
  }
  return bytes;
}

function navigate(options: { root: string; stateDir: string; mode: NavigationMode; task: RealRepoTask; limit: number }): NavigationEvalLookupResult {
  const { root, stateDir, mode, task, limit } = options;
  return navigateForNavigationEval({ root, stateDir, mode, query: task.query, pathPrefix: task.pathPrefix, limit, lexicalSearch });
}

function lexicalSearch(root: string, query: string, pathPrefix = "", limit: number): Array<{ path: string; score: number }> {
  const paths = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((path) => path && path.startsWith(pathPrefix));
  const terms = queryTerms(query, { normalize: true });
  return paths
    .map((path) => {
      const fullPath = join(root, path);
      if (!safeTextFile(fullPath)) return { path, score: 0 };
      const text = readFileSync(fullPath, "utf8");
      return { path, score: lexicalScore(path, text, terms, { normalize: true }) };
    })
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit);
}

function safeTextFile(path: string): boolean {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 2_000_000) return false;
    const lower = basename(path).toLowerCase();
    if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".ico") || lower.endsWith(".xlsx")) return false;
    return true;
  } catch {
    return false;
  }
}

function metricsFor(mode: NavigationMode, cases: CaseReport[]): ModeMetrics {
  return {
    ...summarizeModeMetrics(mode, cases),
    navigationMissReasons: summarizeNavigationMissReasons(cases.filter((item) => item.mode === mode).flatMap((item) => item.navigationDiagnostics.missingExpected)),
  };
}

interface PairedRecord {
  pairs: number;
  wins: number;
  losses: number;
  ties: number;
  maxSingleLoss: number;
  losingTasks: Array<{ task: string; loss: number }>;
}

// Paired per-task record of codemap_search_context contextRecall minus codemap_search
// contextRecall, over every task in the corpus. Preferred over the mean-delta gate: with ~70%
// ties the mean has an effective sample size far below the task count, so a single outlier
// dominates it. A paired win/loss record with a per-task max-loss cap catches the failure mode we
// actually care about (context evicting a correct raw hit) without flapping on mean noise.
function pairedContextVsSearch(cases: CaseReport[]): PairedRecord {
  const search = new Map<string, number>();
  const context = new Map<string, number>();
  for (const item of cases) {
    const key = `${item.repo} :: ${item.task}`;
    if (item.mode === "codemap_search") search.set(key, item.contextRecall);
    else if (item.mode === "codemap_search_context") context.set(key, item.contextRecall);
  }
  const record: PairedRecord = { pairs: 0, wins: 0, losses: 0, ties: 0, maxSingleLoss: 0, losingTasks: [] };
  for (const [key, ctx] of context) {
    const base = search.get(key);
    if (base === undefined) continue;
    record.pairs++;
    const delta = ctx - base;
    if (delta > 1e-6) record.wins++;
    else if (delta < -1e-6) {
      record.losses++;
      const loss = base - ctx;
      record.maxSingleLoss = Math.max(record.maxSingleLoss, loss);
      record.losingTasks.push({ task: key, loss: roundRate(loss) });
    } else record.ties++;
  }
  record.losingTasks.sort((a, b) => b.loss - a.loss);
  return record;
}

interface GateFinding {
  label: string;
  metric: string;
  expected: string;
  actual: number | string;
}

function evaluateGate(report: EvalReport, options: ParsedArgs): { passed: boolean; paired: PairedRecord; issues: GateFinding[]; warnings: GateFinding[] } {
  const issues: GateFinding[] = [];
  const skipped = report.repos.filter((repo) => repo.skipped);
  const warnings = skipped.map((repo) => ({ label: repo.label, metric: "repo", expected: "present", actual: repo.skipped ?? "skipped" }));
  if (options.requireRepos) issues.push(...warnings);
  const available = report.repos.filter((repo) => !repo.skipped);
  const paired = pairedContextVsSearch(report.repos.flatMap((repo) => repo.cases));
  if (available.length === 0) return { passed: issues.length === 0, paired, issues, warnings };
  const baseline = cohortMetric(report, "baseline");
  const naturalHoldout = cohortMetric(report, "natural_holdout");
  const searchContext = metric(baseline.modes, "codemap_search_context");
  const lexical = metric(baseline.modes, "lexical");
  const search = metric(baseline.modes, "codemap_search");
  const successDelta = searchContext.successRate - lexical.successRate;
  const availableBaselineTasks = available.reduce((total, repo) => total + repo.taskCounts.baseline, 0);
  const availableHoldoutTasks = available.reduce((total, repo) => total + repo.taskCounts.natural_holdout, 0);
  const fullTaskCount = defaultSuites.reduce((total, suite) => total + suite.tasks.length, 0);
  const availableTaskCount = availableBaselineTasks + availableHoldoutTasks;
  const fullCohortAvailable = availableTaskCount >= fullTaskCount;
  const effectiveMinTasks = Math.min(options.minTasks, availableBaselineTasks);
  const effectiveMinHoldoutTasks = Math.min(options.minNaturalHoldoutTasks, availableHoldoutTasks);
  const effectiveMinWins = fullCohortAvailable ? options.minContextWinsVsSearch : Math.floor(options.minContextWinsVsSearch * availableTaskCount / fullTaskCount);
  const effectiveMinSuccessDelta = fullCohortAvailable ? options.minSuccessDeltaVsLexical : 0;
  if (searchContext.tasks < effectiveMinTasks) issues.push({ label: searchContext.mode, metric: "tasks", expected: `>= ${effectiveMinTasks}`, actual: searchContext.tasks });
  if (successDelta < effectiveMinSuccessDelta) issues.push({ label: searchContext.mode, metric: "successDeltaVsLexical", expected: `>= ${effectiveMinSuccessDelta}`, actual: roundRate(successDelta) });
  // Paired win/loss gate (replaces the statistically-underpowered mean-delta check): context must
  // win on enough tasks, lose on few, and never regress a single task beyond the cap.
  if (paired.wins < effectiveMinWins) issues.push({ label: searchContext.mode, metric: "contextWinsVsSearch", expected: `>= ${effectiveMinWins}`, actual: paired.wins });
  if (paired.losses > options.maxContextLossesVsSearch) issues.push({ label: searchContext.mode, metric: "contextLossesVsSearch", expected: `<= ${options.maxContextLossesVsSearch}`, actual: paired.losses });
  if (paired.maxSingleLoss > options.maxSingleContextLossVsSearch) issues.push({ label: searchContext.mode, metric: "maxSingleContextLossVsSearch", expected: `<= ${options.maxSingleContextLossVsSearch}`, actual: roundRate(paired.maxSingleLoss) });
  const relativeOperator = fullCohortAvailable ? ">" : ">=";
  if (fullCohortAvailable ? searchContext.successRate <= search.successRate : searchContext.successRate < search.successRate) issues.push({ label: searchContext.mode, metric: "successRateVsSearch", expected: `${relativeOperator} ${search.successRate}`, actual: searchContext.successRate });
  if (fullCohortAvailable ? searchContext.avgExpectedRecall <= lexical.avgExpectedRecall : searchContext.avgExpectedRecall < lexical.avgExpectedRecall) issues.push({ label: searchContext.mode, metric: "expectedRecallVsLexical", expected: `${relativeOperator} ${lexical.avgExpectedRecall}`, actual: searchContext.avgExpectedRecall });
  if (searchContext.forbiddenReadRate > 0) issues.push({ label: searchContext.mode, metric: "forbiddenReadRate", expected: "0", actual: searchContext.forbiddenReadRate });
  if (searchContext.p95LatencyMs > options.maxP95LatencyMs) issues.push({ label: searchContext.mode, metric: "p95LatencyMs", expected: `<= ${options.maxP95LatencyMs}`, actual: searchContext.p95LatencyMs });
  const holdoutSearchContext = metric(naturalHoldout.modes, "codemap_search_context");
  if (holdoutSearchContext.tasks < effectiveMinHoldoutTasks) issues.push({ label: "natural_holdout", metric: "tasks", expected: `>= ${effectiveMinHoldoutTasks}`, actual: holdoutSearchContext.tasks });
  if (holdoutSearchContext.avgExpectedRecall < options.minNaturalHoldoutExpectedRecall) issues.push({ label: "natural_holdout", metric: "avgExpectedRecall", expected: `>= ${options.minNaturalHoldoutExpectedRecall}`, actual: holdoutSearchContext.avgExpectedRecall });
  if (holdoutSearchContext.avgContextRecall < options.minNaturalHoldoutContextRecall) issues.push({ label: "natural_holdout", metric: "avgContextRecall", expected: `>= ${options.minNaturalHoldoutContextRecall}`, actual: holdoutSearchContext.avgContextRecall });
  if (holdoutSearchContext.forbiddenReadRate > 0) issues.push({ label: "natural_holdout", metric: "forbiddenReadRate", expected: "0", actual: holdoutSearchContext.forbiddenReadRate });
  return { passed: issues.length === 0, paired, issues, warnings };
}

function metricsForCohort(cohort: TaskCohort, cases: CaseReport[]): CohortReport {
  const cohortCases = cases.filter((item) => item.cohort === cohort);
  const cohortModes = modes.map((mode) => metricsFor(mode, cohortCases));
  const searchContext = metric(cohortModes, "codemap_search_context");
  const lexical = metric(cohortModes, "lexical");
  const search = metric(cohortModes, "codemap_search");
  return {
    cohort,
    tasks: searchContext.tasks,
    modes: cohortModes,
    missTaxonomy: summarizeMissTaxonomy(cohortCases.flatMap((item) => item.misses)),
    deltas: {
      searchContextVsLexical: delta(searchContext, lexical),
      searchContextVsSearch: delta(searchContext, search),
    },
  };
}

function cohortMetric(report: EvalReport, cohort: TaskCohort): CohortReport {
  const found = report.cohorts.find((item) => item.cohort === cohort);
  if (found) return found;
  return metricsForCohort(cohort, []);
}

function metric(metrics: ModeMetrics[], mode: NavigationMode): ModeMetrics {
  const found = metrics.find((item) => item.mode === mode);
  if (!found) throw new Error(`Missing mode metrics for ${mode}`);
  return found;
}

function delta(left: ModeMetrics, right: ModeMetrics): DeltaMetrics {
  return deltaMetrics(left, right);
}

// Load and validate the checked-in suites data module. Roots are home-relative unless absolute; miss
// classes are validated at load time (they were TS-checked when inline). Any structural problem throws
// with the offending location so a bad edit fails loudly rather than silently skewing the eval. The
// path is computed in the default param (not a module-level const) so it is available when loadSuites
// runs during module initialization, before EOF declarations are evaluated.
function loadSuites(suitesPath = join(dirname(fileURLToPath(import.meta.url)), "eval-real-repo-navigation.suites.json")): RealRepoSuite[] {
  let raw: string;
  try {
    raw = readFileSync(suitesPath, "utf8");
  } catch (error) {
    throw new Error(`Cannot read eval suites ${suitesPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = JSON.parse(raw) as { suites?: unknown };
  if (!Array.isArray(parsed.suites) || parsed.suites.length === 0) throw new Error(`${suitesPath}: expected a non-empty "suites" array`);
  const home = homedir();
  const known = new Set<string>(missClasses);
  return parsed.suites.map((entry, index) => validateSuite(entry, index, home, known, suitesPath));
}

function validateSuite(entry: unknown, index: number, home: string, knownMissClasses: Set<string>, suitesPath: string): RealRepoSuite {
  const where = `${suitesPath} suites[${index}]`;
  if (typeof entry !== "object" || entry === null) throw new Error(`${where}: not an object`);
  const suite = entry as Record<string, unknown>;
  if (typeof suite.label !== "string" || suite.label.trim() === "") throw new Error(`${where}: missing label`);
  if (typeof suite.root !== "string" || suite.root.trim() === "") throw new Error(`${where} (${String(suite.label)}): missing root`);
  if (!Array.isArray(suite.tasks) || suite.tasks.length === 0) throw new Error(`${where} (${suite.label}): missing tasks`);
  const root = isAbsolute(suite.root) ? suite.root : join(home, suite.root);
  const tasks = suite.tasks.map((task, taskIndex) => validateTask(task, `${where} (${suite.label}) tasks[${taskIndex}]`, knownMissClasses));
  return { label: suite.label, root, tasks };
}

function validateTask(entry: unknown, where: string, knownMissClasses: Set<string>): RealRepoTask {
  if (typeof entry !== "object" || entry === null) throw new Error(`${where}: not an object`);
  const task = entry as Record<string, unknown>;
  for (const field of ["name", "query", "entry"] as const) {
    if (typeof task[field] !== "string" || (task[field] as string).trim() === "") throw new Error(`${where}: missing ${field}`);
  }
  if (!Array.isArray(task.requiredContext)) throw new Error(`${where}: requiredContext must be an array`);
  if (task.missHints !== undefined) {
    for (const value of Object.values(task.missHints as Record<string, unknown>)) {
      for (const cls of Array.isArray(value) ? value : [value]) {
        if (typeof cls !== "string" || !knownMissClasses.has(cls)) throw new Error(`${where}: unknown miss class "${String(cls)}"`);
      }
    }
  }
  return task as unknown as RealRepoTask;
}
