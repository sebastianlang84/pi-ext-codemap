#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

import { explainNavigationMisses, summarizeNavigationMissReasons, type NavigationMissExplanation, type NavigationMissReasonSummary } from "../src/core/eval-navigation-diagnostics.ts";
import { summarizeMissTaxonomy, type MissClass, type MissDiagnostic, type MissTaxonomySummary } from "../src/core/eval-miss-taxonomy.ts";
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
}

const modes: NavigationMode[] = ["lexical", "codemap_search", "codemap_search_context"];
const taskCohorts: TaskCohort[] = ["baseline", "natural_holdout"];
const home = homedir();
const defaultSuites: RealRepoSuite[] = [
  {
    label: "macrolens",
    root: join(home, "dev", "macrolens"),
    tasks: [
      {
        name: "FINRA provider parser change",
        query: "parseFinraMarginWorksheetXml implementation FINRA worksheet debit balances",
        entry: "apps/web/src/lib/providers/finra.ts",
        requiredContext: ["apps/web/src/lib/__tests__/finra-provider.test.ts"],
        forbidden: ["apps/web/package-lock.json", "package-lock.json"],
      },
      {
        name: "dashboard pipeline FINRA derivations",
        query: "runDashboardPipeline implementation FINRA derivations provider status",
        entry: "apps/web/src/lib/dashboard-pipeline.ts",
        requiredContext: ["apps/web/src/lib/__tests__/dashboard-pipeline.test.ts"],
        forbidden: ["apps/web/package-lock.json", "package-lock.json"],
      },
      {
        name: "workbench backtest target selection",
        query: "buildWorkbenchBacktestTargets implementation selectedSlotId RSI score target",
        entry: "apps/web/src/lib/series-workbench-backtest-target.ts",
        requiredContext: [
          "apps/web/src/lib/__tests__/series-workbench-backtest-target.test.ts",
          "apps/web/src/lib/series-workbench-backtest.ts",
          "apps/web/src/lib/series-analysis.ts",
        ],
        forbidden: ["apps/web/package-lock.json", "package-lock.json", ".agents/memory/daily/2026-03-12-rsi-score-cutover.md"],
        missHints: { "apps/web/src/lib/series-analysis.ts": "alias" },
      },
      {
        name: "NL holdout newsletter stale macro snapshot",
        cohort: "natural_holdout",
        query: "newsletter macro article shows wrong FINRA snapshot after dashboard refresh",
        entry: "apps/web/src/lib/newsletter-macro-snapshot.ts",
        requiredContext: ["apps/web/src/lib/__tests__/newsletter-macro-snapshot.test.ts"],
        forbidden: ["apps/web/package-lock.json", "package-lock.json"],
      },
      {
        name: "NL holdout newsletter macro endpoint warnings",
        cohort: "natural_holdout",
        query: "newsletter macro endpoint should return stale unavailable source decision warnings for missing macro indicators",
        entry: "apps/web/src/app/api/newsletter/macro/route.ts",
        requiredContext: [
          "apps/web/src/lib/newsletter-macro-snapshot.ts",
          "apps/web/src/lib/__tests__/newsletter-macro-snapshot.test.ts",
          "docs/plans/20260502-newsletter-macro-data-integration.md",
        ],
        forbidden: ["apps/web/package-lock.json", "package-lock.json"],
      },
      {
        name: "NL holdout partial provider outage",
        cohort: "natural_holdout",
        query: "dashboard provider no data diagnostics should keep FRED and Yahoo series when one market source is empty",
        entry: "apps/web/src/lib/dashboard-pipeline.ts",
        requiredContext: ["apps/web/src/lib/__tests__/dashboard-pipeline.test.ts", "apps/web/src/lib/providers/fred.ts", "apps/web/src/lib/providers/yahoo.ts"],
        forbidden: ["apps/web/package-lock.json", "package-lock.json"],
      },
      {
        name: "NL holdout workbench chart session restore",
        cohort: "natural_holdout",
        query: "workbench chart interval and x range settings should survive reload from local storage",
        entry: "apps/web/src/lib/use-series-workbench-session.ts",
        requiredContext: ["apps/web/src/lib/__tests__/series-workbench-chart.test.ts", "apps/web/src/components/series-workbench.tsx"],
        forbidden: ["apps/web/package-lock.json", "package-lock.json"],
      },
      {
        name: "NL holdout macro signal threshold boundaries",
        cohort: "natural_holdout",
        query: "market regime cards show neutral tone at threshold values for VIX oil CPI payrolls yield curve and credit",
        entry: "apps/web/src/lib/macro-signal-rules.ts",
        requiredContext: ["apps/web/src/lib/macro-derivations.ts", "apps/web/src/lib/__tests__/macro-derivations.test.ts"],
        forbidden: ["apps/web/package-lock.json", "package-lock.json"],
      },
      {
        name: "NL holdout catalog endpoint duplicate provider ids",
        cohort: "natural_holdout",
        query: "catalog endpoint returns duplicate macro provider ids and dashboard dropdown shows repeated series",
        entry: "apps/web/src/app/api/catalog/route.ts",
        requiredContext: ["apps/web/src/lib/series-catalog.ts", "apps/web/src/lib/__tests__/series-catalog.test.ts"],
        forbidden: ["apps/web/package-lock.json", "package-lock.json"],
      },
    ],
  },
  {
    label: "alpha-cycles",
    root: join(home, "alpha-cycles"),
    tasks: [
      {
        name: "controlled run trigger API",
        query: "trigger_run implementation confirm true run already in progress FastAPI",
        entry: "api/app.py",
        requiredContext: ["docker-compose.webapp.yml", "PRD_webapp.md"],
        forbidden: ["ui/package-lock.json"],
      },
      {
        name: "NL holdout duplicate run rejection",
        cohort: "natural_holdout",
        query: "FastAPI confirm true run already in progress",
        entry: "api/app.py",
        requiredContext: ["docker-compose.webapp.yml", "PRD_webapp.md"],
        forbidden: ["ui/package-lock.json"],
      },
      {
        name: "NL holdout run button busy status",
        cohort: "natural_holdout",
        query: "webapp run button disabled while batch is starting then status polling shows latest success or failure",
        entry: "ui/src/App.tsx",
        requiredContext: ["api/app.py", "PRD_webapp.md"],
        forbidden: ["ui/package-lock.json"],
      },
    ],
  },
  {
    label: "pi-ext-memory",
    root: join(home, ".pi/agent/git/github.com/sebastianlang84/pi-ext-memory"),
    tasks: [
      {
        name: "memory_search empty-result hints",
        query: "registerMemoryTools implementation memory_search empty_result_hints near canonical keys near tag suggestions",
        entry: "src/pi-extension/tools.ts",
        requiredContext: ["test/pi-extension/tools.test.ts", "src/pi-extension/tag-catalog.ts", "src/pi-extension/formatters.ts"],
        forbidden: ["package-lock.json"],
      },
      {
        name: "turn-intake memory context hint",
        query: "buildTurnIntake implementation Use memory_search if prior context matters no relevant stored context",
        entry: "src/pi-extension/retrieval.ts",
        requiredContext: ["test/pi-extension/retrieval.test.ts", "src/pi-extension/turn-intake.ts"],
        forbidden: ["package-lock.json"],
      },
      {
        name: "NL holdout stored memory hint",
        cohort: "natural_holdout",
        query: "Use memory_search if prior context matters no relevant stored context",
        entry: "src/pi-extension/retrieval.ts",
        requiredContext: ["test/pi-extension/retrieval.test.ts"],
        forbidden: ["package-lock.json"],
      },
      {
        name: "NL holdout handoff scope precedence",
        cohort: "natural_holdout",
        query: "active handoff preload should prefer current session before repo fallback and warn not to overwrite fallback handoffs",
        entry: "src/pi-extension/retrieval.ts",
        requiredContext: ["test/pi-extension/retrieval.test.ts", "docs/adr/005-simplified-agent-facing-scopes.md", "docs/adr/006-normal-and-advanced-tool-surface.md"],
        forbidden: ["package-lock.json", "docs/archive/plans/tool-surface-simplification.md"],
      },
      {
        name: "NL holdout legacy project audit preview",
        cohort: "natural_holdout",
        query: "memory audit should show read only legacy project migration preview without rewriting archived or repo scoped records",
        entry: "src/pi-extension/audit.ts",
        requiredContext: ["test/pi-extension/audit.test.ts", "docs/adr/005-simplified-agent-facing-scopes.md", "docs/adr/007-memory-model-minimisation.md"],
        forbidden: ["package-lock.json", "docs/archive/plans/memory-scope-simplification.md"],
      },
    ],
  },
  {
    label: "pi-ext-subagents",
    root: join(home, ".pi/agent/git/github.com/sebastianlang84/pi-ext-subagents"),
    tasks: [
      {
        name: "subagent request validation",
        query: "normalizeSubagentRequest implementation too many parallel tasks exactly one mode",
        entry: "src/request.ts",
        requiredContext: ["tests/request.test.mjs", "src/execution.ts"],
      },
      {
        name: "NL holdout invalid subagent request shape",
        cohort: "natural_holdout",
        query: "reject subagent request when parallel tasks and single task are both set",
        entry: "src/request.ts",
        requiredContext: ["tests/request.test.mjs"],
      },
      {
        name: "NL holdout reviewer scout recursion guard",
        cohort: "natural_holdout",
        query: "reviewer context scout should gather bounded contract and nearby test evidence without scout recursion",
        entry: "docs/plans/reviewer-context-scout.md",
        requiredContext: ["docs/benchmarks/reviewer-context-scout-fixtures.json", "tests/reviewer-context-scout-benchmark.test.mjs"],
        forbidden: ["docs/plans/fanout-reduce.md"],
      },
      {
        name: "NL holdout repo agent mutation warning",
        cohort: "natural_holdout",
        query: "repo local subagent approval warning should list mutation capable bash and edit tools without trusting untrusted frontmatter text",
        entry: "src/agents.ts",
        requiredContext: ["tests/agents.test.mjs", "src/request.ts"],
        forbidden: ["package-lock.json", "docs/plans/fanout-reduce.md"],
      },
    ],
  },
  {
    label: "pi-ext-astgrep",
    root: join(home, ".pi/agent/git/github.com/sebastianlang84/pi-ext-astgrep"),
    tasks: [
      {
        name: "ast-grep pattern hint rendering",
        query: "getPatternHint implementation ast-grep rule language support fixer",
        entry: "src/ast-grep/pattern-hints.ts",
        requiredContext: ["test/pattern-hints.test.ts"],
        forbidden: ["package-lock.json", "docs/archive/plans/slim-fork-plan.md"],
      },
      {
        name: "NL holdout ambiguous sg binary",
        cohort: "natural_holdout",
        query: "ast grep binary path should reject ambiguous sg shadow utils command and show install guidance",
        entry: "src/ast-grep/binary-path.ts",
        requiredContext: ["src/ast-grep/cli.ts", "test/binary-path.test.ts", "README.md"],
        forbidden: ["package-lock.json", "docs/archive/plans/slim-fork-plan.md"],
      },
      {
        name: "NL holdout truncated ast-grep output banner",
        cohort: "natural_holdout",
        query: "ast grep search should salvage truncated JSON output and explain output exceeded the one megabyte limit",
        entry: "src/ast-grep/json-output.ts",
        requiredContext: ["src/ast-grep/result-formatter.ts", "test/sg-compact-json-output.test.ts", "test/result-formatter.test.ts"],
        forbidden: ["package-lock.json", "docs/archive/plans/slim-fork-plan.md"],
      },
    ],
  },
];

const parsed = parseArgs(process.argv.slice(2));
const stateDir = join(tmpdir(), `pi-codemap-real-repo-navigation-${process.pid}-${Date.now()}`);
try {
  const report = runEval(parsed, stateDir);
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
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [name, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? args[i + 1];
    if (arg === "--local-repos") {
      continue;
    } else if (arg === "--quality-gate") {
      gateEnabled = true;
      requireRepos = true;
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
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }
  return { gateEnabled, keepState, requireRepos, limit, maxP95LatencyMs, minTasks, minNaturalHoldoutTasks, minNaturalHoldoutExpectedRecall, minNaturalHoldoutContextRecall, minSuccessDeltaVsLexical, minContextRecallDeltaVsSearch };
}

function runEval(options: ParsedArgs, stateDir: string): EvalReport {
  const repos = defaultSuites.map((suite) => runSuite(suite, options, stateDir));
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
  if (!existsSync(suite.root)) return { label: suite.label, root: suite.root, skipped: "missing repo", modes: [], cases: [], missTaxonomy: summarizeMissTaxonomy([]) };
  const indexed = indexRepo({ cwd: suite.root, approve: true, stateDir });
  const currentStatus = indexStatus(suite.root, { stateDir, health: "full" });
  const indexStale = Boolean(currentStatus.headChanged || currentStatus.changed > 0 || currentStatus.missing > 0 || currentStatus.deleted > 0);
  const cases = modes.flatMap((mode) => suite.tasks.map((task) => evaluateTask({ suite, stateDir, mode, task, limit: options.limit, indexStale })));
  return { label: suite.label, root: suite.root, indexed, modes: modes.map((mode) => metricsFor(mode, cases)), cases, missTaxonomy: summarizeMissTaxonomy(cases.flatMap((item) => item.misses)) };
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
    latencyMs: roundMs(latencyMs),
  };
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

function evaluateGate(report: EvalReport, options: ParsedArgs): { passed: boolean; issues: Array<{ label: string; metric: string; expected: string; actual: number | string }> } {
  const issues: Array<{ label: string; metric: string; expected: string; actual: number | string }> = [];
  const skipped = report.repos.filter((repo) => repo.skipped);
  if (options.requireRepos) for (const repo of skipped) issues.push({ label: repo.label, metric: "repo", expected: "present", actual: repo.skipped ?? "skipped" });
  const baseline = cohortMetric(report, "baseline");
  const naturalHoldout = cohortMetric(report, "natural_holdout");
  const searchContext = metric(baseline.modes, "codemap_search_context");
  const lexical = metric(baseline.modes, "lexical");
  const search = metric(baseline.modes, "codemap_search");
  const successDelta = searchContext.successRate - lexical.successRate;
  const contextRecallDelta = searchContext.avgContextRecall - search.avgContextRecall;
  if (searchContext.tasks < options.minTasks) issues.push({ label: searchContext.mode, metric: "tasks", expected: `>= ${options.minTasks}`, actual: searchContext.tasks });
  if (successDelta < options.minSuccessDeltaVsLexical) issues.push({ label: searchContext.mode, metric: "successDeltaVsLexical", expected: `>= ${options.minSuccessDeltaVsLexical}`, actual: roundRate(successDelta) });
  if (contextRecallDelta < options.minContextRecallDeltaVsSearch) issues.push({ label: searchContext.mode, metric: "contextRecallDeltaVsSearch", expected: `>= ${options.minContextRecallDeltaVsSearch}`, actual: roundRate(contextRecallDelta) });
  if (searchContext.successRate <= search.successRate) issues.push({ label: searchContext.mode, metric: "successRateVsSearch", expected: `> ${search.successRate}`, actual: searchContext.successRate });
  if (searchContext.avgExpectedRecall <= lexical.avgExpectedRecall) issues.push({ label: searchContext.mode, metric: "expectedRecallVsLexical", expected: `> ${lexical.avgExpectedRecall}`, actual: searchContext.avgExpectedRecall });
  if (searchContext.forbiddenReadRate > 0) issues.push({ label: searchContext.mode, metric: "forbiddenReadRate", expected: "0", actual: searchContext.forbiddenReadRate });
  if (searchContext.p95LatencyMs > options.maxP95LatencyMs) issues.push({ label: searchContext.mode, metric: "p95LatencyMs", expected: `<= ${options.maxP95LatencyMs}`, actual: searchContext.p95LatencyMs });
  const holdoutSearchContext = metric(naturalHoldout.modes, "codemap_search_context");
  if (holdoutSearchContext.tasks < options.minNaturalHoldoutTasks) issues.push({ label: "natural_holdout", metric: "tasks", expected: `>= ${options.minNaturalHoldoutTasks}`, actual: holdoutSearchContext.tasks });
  if (holdoutSearchContext.avgExpectedRecall < options.minNaturalHoldoutExpectedRecall) issues.push({ label: "natural_holdout", metric: "avgExpectedRecall", expected: `>= ${options.minNaturalHoldoutExpectedRecall}`, actual: holdoutSearchContext.avgExpectedRecall });
  if (holdoutSearchContext.avgContextRecall < options.minNaturalHoldoutContextRecall) issues.push({ label: "natural_holdout", metric: "avgContextRecall", expected: `>= ${options.minNaturalHoldoutContextRecall}`, actual: holdoutSearchContext.avgContextRecall });
  if (holdoutSearchContext.forbiddenReadRate > 0) issues.push({ label: "natural_holdout", metric: "forbiddenReadRate", expected: "0", actual: holdoutSearchContext.forbiddenReadRate });
  return { passed: issues.length === 0, issues };
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
