import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { explainNavigationMisses, summarizeNavigationMissReasons } = await import("../src/core/eval-navigation-diagnostics.ts");
const { classifyMisses, summarizeMissTaxonomy } = await import("../src/core/eval-miss-taxonomy.ts");
const { indexRepo, status } = await import("../src/core/indexer.ts");
const { explainSearchContextReadPlan, mergeSearchContextReadPlan } = await import("../src/core/navigation-read-plan.ts");
const { planQuery } = await import("../src/core/query-plan.ts");
const { scoreSearchRow } = await import("../src/core/ranking.ts");
const { searchCodeMap, searchCodeMapDebug, searchCodeMapWithDiagnostics } = await import("../src/core/search.ts");
const { codemapContext } = await import("../src/core/context.ts");
const { getRepoInfo } = await import("../src/core/repo.ts");

test("real-repo eval navigation diagnostics explain entry-coupled context misses", () => {
  const explanations = explainNavigationMisses({
    mode: "codemap_search_context",
    entry: "src/pi-extension/retrieval.ts",
    requiredContext: ["test/pi-extension/retrieval.test.ts", "src/pi-extension/turn-intake.ts"],
    missingExpectedFiles: ["src/pi-extension/retrieval.ts", "test/pi-extension/retrieval.test.ts"],
    filesRead: ["src/pi-extension/tools.ts", "test/pi-extension/tools.test.ts"],
    searchPaths: ["src/pi-extension/tools.ts", "src/pi-extension/retrieval.ts"],
    contextTarget: "src/pi-extension/tools.ts",
    readFirstPaths: ["src/pi-extension/tools.ts", "test/pi-extension/tools.test.ts"],
  });

  assert.deepEqual(explanations.map((item) => [item.file, item.reason]), [
    ["src/pi-extension/retrieval.ts", "context_entry_miss"],
    ["test/pi-extension/retrieval.test.ts", "context_neighbor_unreachable"],
  ]);
});

test("real-repo eval summarizes navigation miss reasons", () => {
  const targetMismatch = explainNavigationMisses({
    mode: "codemap_search_context",
    entry: "src/pi-extension/tools.ts",
    requiredContext: ["src/pi-extension/tag-catalog.ts", "src/pi-extension/formatters.ts"],
    missingExpectedFiles: ["src/pi-extension/tag-catalog.ts", "src/pi-extension/formatters.ts"],
    filesRead: ["test/pi-extension/tools.test.ts", "src/pi-extension/tools.ts"],
    searchPaths: ["test/pi-extension/tools.test.ts", "src/pi-extension/tools.ts", "src/pi-extension/tag-catalog.ts"],
    contextTarget: "test/pi-extension/tools.test.ts",
    readFirstPaths: ["test/pi-extension/tools.test.ts", "src/pi-extension/tools.ts"],
  });
  const relationshipGap = explainNavigationMisses({
    mode: "codemap_search_context",
    entry: "src/request.ts",
    requiredContext: ["src/execution.ts"],
    missingExpectedFiles: ["src/execution.ts"],
    filesRead: ["src/request.ts", "tests/request.test.mjs"],
    searchPaths: ["src/request.ts"],
    contextTarget: "src/request.ts",
    readFirstPaths: ["src/request.ts", "tests/request.test.mjs"],
  });

  const summary = summarizeNavigationMissReasons([...targetMismatch, ...relationshipGap]);

  assert.equal(summary.total, 3);
  assert.equal(summary.byReason.context_target_mismatch, 2);
  assert.equal(summary.byReason.context_budget_or_relationship, 1);
  assert.deepEqual(summary.examples.map((item) => item.reason), ["context_target_mismatch", "context_target_mismatch", "context_budget_or_relationship"]);
});

test("real-repo eval miss taxonomy classifies actionable misses", () => {
  const misses = classifyMisses({
    query: "registerMemoryTools empty result hints",
    entry: "src/pi-extension/tools.ts",
    requiredContext: ["test/pi-extension/tools.test.ts", "src/pi-extension/formatters.ts"],
    missingExpectedFiles: ["test/pi-extension/tools.test.ts", "src/pi-extension/formatters.ts", "src/lib/series-analysis.ts"],
    forbiddenRead: ["package-lock.json"],
    indexStale: false,
    hints: { "src/pi-extension/formatters.ts": "query_formulation", "src/lib/series-analysis.ts": "alias" },
  });

  assert.deepEqual(misses.map((item) => [item.kind, item.class, item.file]), [
    ["forbidden_read", "noise", "package-lock.json"],
    ["missing_expected", "convention", "test/pi-extension/tools.test.ts"],
    ["missing_expected", "query_formulation", "src/pi-extension/formatters.ts"],
    ["missing_expected", "alias", "src/lib/series-analysis.ts"],
  ]);
  const staleMiss = classifyMisses({
    query: "registerMemoryTools empty result hints",
    entry: "src/pi-extension/tools.ts",
    requiredContext: ["src/lib/series-analysis.ts"],
    missingExpectedFiles: ["src/lib/series-analysis.ts"],
    forbiddenRead: [],
    indexStale: true,
    hints: { "src/lib/series-analysis.ts": "alias" },
  });
  assert.equal(staleMiss[0]?.class, "staleness");
  const summary = summarizeMissTaxonomy(misses);
  assert.equal(summary.total, 4);
  assert.equal(summary.byClass.noise, 1);
  assert.equal(summary.byClass.convention, 1);
  assert.equal(summary.byClass.query_formulation, 1);
  assert.equal(summary.byClass.alias, 1);
});

test("agent navigation eval report includes stable miss taxonomy summaries", () => {
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "scripts/eval-agent-navigation.ts", "--fixtures", "--limit", "1"], { encoding: "utf8" });
  const parsed = JSON.parse(output);
  const taxonomy = parsed.report.missTaxonomy;
  assert.equal(typeof taxonomy.total, "number");
  assert.deepEqual(Object.keys(taxonomy.byClass), ["alias", "convention", "missing_symbol", "noise", "staleness", "query_formulation", "unknown"]);
  assert.ok(Array.isArray(taxonomy.examples));
  assert.ok(taxonomy.total > 0);
  assert.equal(typeof parsed.report.modes[0].avgExpectedRecall, "number");
  assert.equal(typeof parsed.report.modes[0].missTaxonomy.byClass.unknown, "number");
  assert.equal(typeof parsed.report.cases[0].expectedRecall, "number");
  assert.ok(Array.isArray(parsed.report.cases[0].misses));
  const searchContextCase = parsed.report.cases.find((item: { mode: string }) => item.mode === "codemap_search_context");
  assert.ok(Array.isArray(searchContextCase.navigationDiagnostics.searchTop));
  const missedSearchCase = parsed.report.cases.find((item: { mode: string; missingExpectedFiles: string[] }) => item.mode === "codemap_search" && item.missingExpectedFiles.length > 0);
  assert.ok(Array.isArray(missedSearchCase.navigationDiagnostics.searchCandidates));
});

test("search+context read plan preserves visible search hits within the read budget", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      ["src/pi-extension/tools.ts", "test/pi-extension/tools.test.ts", "src/pi-extension/tag-catalog.ts", "src/pi-extension/formatters.ts"],
      ["src/pi-extension/tools.ts", "src/core/index.ts", "src/pi-extension/formatters.ts", "test/pi-extension/tools.test.ts", "src/pi-extension/index.ts"],
      5,
    ),
    ["src/pi-extension/tools.ts", "test/pi-extension/tools.test.ts", "src/pi-extension/tag-catalog.ts", "src/pi-extension/formatters.ts", "src/core/index.ts"],
  );
});

test("search+context read plan diagnostics explain budgeted selections", () => {
  const diagnostics = explainSearchContextReadPlan(
    ["src/pi-extension/tools.ts", "test/pi-extension/tools.test.ts", "src/pi-extension/tag-catalog.ts", "src/pi-extension/formatters.ts"],
    [
      { path: "src/pi-extension/tools.ts", reasons: [{ kind: "target" }] },
      { path: "src/core/index.ts", reasons: [{ kind: "import" }] },
      { path: "src/pi-extension/formatters.ts", reasons: [{ kind: "import" }] },
      { path: "test/pi-extension/tools.test.ts", reasons: [{ kind: "reverse_test" }] },
      { path: "src/pi-extension/index.ts", reasons: [{ kind: "import" }] },
    ],
    3,
  );

  assert.deepEqual(diagnostics.selected, ["src/pi-extension/tools.ts", "test/pi-extension/tools.test.ts", "src/core/index.ts"]);
  assert.equal(diagnostics.budget.available, 6);
  assert.equal(diagnostics.budget.dropped, 3);
  assert.deepEqual(
    diagnostics.decisions.slice(0, 4).map((item) => [item.path, item.bucket, item.selected, item.rank]),
    [
      ["src/pi-extension/tools.ts", "first_search", true, 1],
      ["test/pi-extension/tools.test.ts", "context_backed_search", true, 2],
      ["src/core/index.ts", "direct_import", true, 3],
      ["src/pi-extension/tag-catalog.ts", "active_search", false, undefined],
    ],
  );
});

test("search+context read plan defers archived docs behind active search and context paths", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      [
        "src/pi-extension/audit.ts",
        "test/pi-extension/audit.test.ts",
        "docs/archive/plans/memory-scope-simplification.md",
        "src/core/policy.ts",
        "src/pi-extension/retrieval.ts",
      ],
      [
        { path: "src/pi-extension/audit.ts", reasons: [{ kind: "target" }] },
        { path: "src/core/index.ts", reasons: [{ kind: "import" }] },
        { path: "test/pi-extension/audit.test.ts", reasons: [{ kind: "reverse_test" }] },
        { path: "test/pi-extension/commands.test.ts", reasons: [{ kind: "sibling_test" }] },
      ],
      5,
    ),
    [
      "src/pi-extension/audit.ts",
      "test/pi-extension/audit.test.ts",
      "src/core/policy.ts",
      "src/pi-extension/retrieval.ts",
      "src/core/index.ts",
    ],
  );
});

test("search+context read plan promotes context-related tests ahead of lower search hits", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      [
        "apps/web/src/lib/series-workbench-chart.ts",
        "apps/web/src/components/series-workbench.tsx",
        "apps/web/src/lib/use-series-workbench-session.ts",
        "docs/plans/20260502-newsletter-macro-data-integration.md",
      ],
      [
        { path: "apps/web/src/lib/series-workbench-chart.ts", reasons: [{ kind: "target" }] },
        { path: "apps/web/src/lib/formatters.ts", reasons: [{ kind: "import" }] },
        { path: "apps/web/src/lib/series-analysis.ts", reasons: [{ kind: "import" }] },
        { path: "apps/web/src/lib/__tests__/series-workbench-chart.test.ts", reasons: [{ kind: "sibling_test" }, { kind: "reverse_test" }] },
      ],
      5,
    ),
    [
      "apps/web/src/lib/series-workbench-chart.ts",
      "apps/web/src/lib/__tests__/series-workbench-chart.test.ts",
      "apps/web/src/components/series-workbench.tsx",
      "apps/web/src/lib/use-series-workbench-session.ts",
      "docs/plans/20260502-newsletter-macro-data-integration.md",
    ],
  );
});

test("search+context read plan keeps the first direct import before lower search hits", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      [
        "apps/web/src/lib/series-workbench-backtest-target.ts",
        "apps/web/src/lib/series-workbench-backtest.ts",
        "apps/web/src/components/series-workbench.tsx",
        "apps/web/src/lib/__tests__/series-workbench-backtest-target.test.ts",
        "apps/web/src/lib/__tests__/series-workbench-backtest.test.ts",
      ],
      [
        { path: "apps/web/src/lib/series-workbench-backtest-target.ts", reasons: [{ kind: "target" }] },
        { path: "apps/web/src/lib/series-analysis.ts", reasons: [{ kind: "import" }] },
        { path: "apps/web/src/lib/series-workbench-engine.ts", reasons: [{ kind: "import" }] },
        { path: "apps/web/src/lib/__tests__/series-workbench-backtest-target.test.ts", reasons: [{ kind: "sibling_test" }, { kind: "reverse_test" }] },
        { path: "apps/web/src/lib/series-workbench-backtest.ts", reasons: [{ kind: "reverse_import" }] },
      ],
      5,
    ),
    [
      "apps/web/src/lib/series-workbench-backtest-target.ts",
      "apps/web/src/lib/series-workbench-backtest.ts",
      "apps/web/src/lib/__tests__/series-workbench-backtest-target.test.ts",
      "apps/web/src/lib/series-analysis.ts",
      "apps/web/src/components/series-workbench.tsx",
    ],
  );
});

test("search+context read plan does not let direct imports displace config hits", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      ["api/app.py", "docker-compose.webapp.yml"],
      [
        { path: "api/app.py", reasons: [{ kind: "target" }] },
        { path: "docker-compose.webapp.yml", reasons: [{ kind: "near_config" }] },
        { path: "api/settings.py", reasons: [{ kind: "import" }] },
      ],
      2,
    ),
    ["api/app.py", "docker-compose.webapp.yml"],
  );
});

test("search+context read plan keeps imported-neighbor tests before lower doc hits", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      [
        "src/pi-extension/turn-intake.ts",
        "src/pi-extension/retrieval.ts",
        "docs/user/usage.md",
        "CHANGELOG.md",
        "test/pi-extension/turn-intake.test.ts",
      ],
      [
        { path: "src/pi-extension/turn-intake.ts", reasons: [{ kind: "target" }] },
        { path: "src/core/index.ts", reasons: [{ kind: "import" }] },
        { path: "src/pi-extension/retrieval.ts", reasons: [{ kind: "import" }] },
        { path: "test/pi-extension/turn-intake.test.ts", reasons: [{ kind: "sibling_test" }, { kind: "reverse_import" }, { kind: "reverse_test" }] },
        { path: "test/pi-extension/retrieval.test.ts", reasons: [{ kind: "sibling_test", targetPath: "src/pi-extension/retrieval.ts" }] },
      ],
      5,
    ),
    [
      "src/pi-extension/turn-intake.ts",
      "test/pi-extension/retrieval.test.ts",
      "test/pi-extension/turn-intake.test.ts",
      "src/pi-extension/retrieval.ts",
      "docs/user/usage.md",
    ],
  );
});

test("search+context read plan does not promote sibling tests for non-search import targets", () => {
  assert.deepEqual(
    mergeSearchContextReadPlan(
      ["src/pi-extension/retrieval.ts", "docs/adr/005-simplified-agent-facing-scopes.md", "docs/adr/006-normal-and-advanced-tool-surface.md"],
      [
        { path: "src/pi-extension/retrieval.ts", reasons: [{ kind: "target" }] },
        { path: "src/core/identity-policy.ts", reasons: [{ kind: "import" }] },
        { path: "test/core/identity-policy.test.ts", reasons: [{ kind: "sibling_test", targetPath: "src/core/identity-policy.ts" }] },
        { path: "docs/adr/005-simplified-agent-facing-scopes.md", reasons: [{ kind: "related_doc" }] },
        { path: "docs/adr/006-normal-and-advanced-tool-surface.md", reasons: [{ kind: "related_doc" }] },
      ],
      3,
    ),
    ["src/pi-extension/retrieval.ts", "docs/adr/005-simplified-agent-facing-scopes.md", "docs/adr/006-normal-and-advanced-tool-surface.md"],
  );
});

test("codemap context resolves TypeScript path aliases from tsconfig paths", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-alias-context-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "app"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib"), { recursive: true });
  mkdirSync(join(root, "src", "app"), { recursive: true });
  mkdirSync(join(root, "src", "lib"), { recursive: true });
  mkdirSync(join(root, "src", "root-wrong", "lib"), { recursive: true });

  const rootPaths: Record<string, string[]> = { "~/*": ["lib/*"], "@/*": ["root-wrong/*"] };
  for (let index = 0; index < 90; index++) rootPaths[`dummy-${index}/*`] = [`unused-${index}/*`];

  writeFileSync(join(root, "apps", "web", "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }, null, 2));
  writeFileSync(join(root, "apps", "web", "src", "app", "page.ts"), `
import { formatHeadline } from "@/lib/headline";

export function renderPageHeadline(value: string) {
  return formatHeadline(value);
}
`);
  writeFileSync(join(root, "apps", "web", "src", "app", "missing-page.ts"), `
import { wrongAliasTarget } from "@/lib/missing";

export const missingPage = wrongAliasTarget;
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "headline.ts"), `
export function formatHeadline(value: string) {
  return value.toUpperCase();
}
`);
  writeFileSync(join(root, "jsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "src", paths: rootPaths } }, null, 2));
  writeFileSync(join(root, "src", "app", "widget.js"), `
import { formatWidgetHeadline } from "~/headline";

export function renderWidget(value) {
  return formatWidgetHeadline(value);
}
`);
  writeFileSync(join(root, "src", "lib", "headline.js"), `
export function formatWidgetHeadline(value) {
  return value.toLowerCase();
}
`);
  writeFileSync(join(root, "src", "root-wrong", "lib", "headline.ts"), `
export const wrongAliasTarget = true;
`);
  writeFileSync(join(root, "src", "root-wrong", "lib", "missing.ts"), `
export const wrongAliasTarget = true;
`);

  indexRepo({ cwd: root, approve: true });

  const contextResult = codemapContext({ cwd: root, target: "apps/web/src/app/page.ts", limit: 5 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.ok(readFirstPaths.includes("apps/web/src/lib/headline.ts"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("src/root-wrong/lib/headline.ts"), JSON.stringify(readFirstPaths));
  const headlineReason = contextResult.readFirst.find((item) => item.path === "apps/web/src/lib/headline.ts")?.reasons ?? [];
  assert.ok(headlineReason.some((reason) => reason.kind === "import" && reason.specifier === "@/lib/headline"), JSON.stringify(headlineReason));

  const missingContextResult = codemapContext({ cwd: root, target: "apps/web/src/app/missing-page.ts", limit: 5 });
  const missingReadFirstPaths = missingContextResult.readFirst.map((item) => item.path);
  assert.ok(!missingReadFirstPaths.includes("src/root-wrong/lib/missing.ts"), JSON.stringify(missingReadFirstPaths));

  const jsContextResult = codemapContext({ cwd: root, target: "src/app/widget.js", limit: 5 });
  const jsReadFirstPaths = jsContextResult.readFirst.map((item) => item.path);
  assert.ok(jsReadFirstPaths.includes("src/lib/headline.js"), JSON.stringify(jsReadFirstPaths));
  const jsHeadlineReason = jsContextResult.readFirst.find((item) => item.path === "src/lib/headline.js")?.reasons ?? [];
  assert.ok(jsHeadlineReason.some((reason) => reason.kind === "import" && reason.specifier === "~/headline"), JSON.stringify(jsHeadlineReason));
});

test("exact symbol matches rank above chunk matches", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "approveUser", limit: 5 });
  assert.equal(results[0]?.path, "src/core/user-service.ts");
  assert.equal(results[0]?.kind, "function");
  assert.match(results[0]?.snippet ?? "", /approveUser/);
});

test("prefix symbol queries prefer matching symbols", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "approve", limit: 5 });
  assert.equal(results[0]?.path, "src/core/user-service.ts");
  assert.equal(results[0]?.kind, "function");
});

test("symbol queries outrank broad implementation file chunks", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "approveUser implementation", limit: 5 });
  assert.equal(results[0]?.path, "src/core/user-service.ts");
  assert.equal(results[0]?.kind, "function");
});

test("generic implementation role intent does not imply main entrypoint intent", () => {
  assert.deepEqual(planQuery("memory retrieval implementation").roleIntents, ["implementation"]);
  assert.deepEqual(planQuery("where is the main implementation?").roleIntents, ["implementation", "implementation/main"]);
  const longPlan = planQuery("buildTurnIntake implementation Use memory_search if prior context matters no relevant stored context");
  assert.ok(longPlan.coreTerms.includes("relevant"), JSON.stringify(longPlan.coreTerms));
  assert.ok(longPlan.coreTerms.includes("stored"), JSON.stringify(longPlan.coreTerms));
});

test("generic implementation search does not seed unrelated main entrypoints", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-generic-implementation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });

  writeFileSync(join(root, "src", "index.ts"), "export function bootstrapEntrypoint() { return 'main app shell'; }\n");
  writeFileSync(join(root, "src", "retrieval.ts"), "export const retrievalHint = 'memory retrieval behavior lives here';\n");
  indexRepo({ cwd: root, approve: true });

  const genericResults = searchCodeMap({ cwd: root, query: "memory retrieval implementation", limit: 5 });
  assert.equal(genericResults[0]?.path, "src/retrieval.ts", JSON.stringify(genericResults));

  const mainResults = searchCodeMap({ cwd: root, query: "where is the main implementation?", limit: 5 });
  assert.equal(mainResults[0]?.path, "src/index.ts", JSON.stringify(mainResults));
});

test("implementation-intent ranking penalizes test-only matches", () => {
  const plan = planQuery("registerMemoryTools implementation memory_search");
  const sourceDiagnostics = scoreSearchRow({
    path: "src/pi-extension/tools.ts",
    language: "typescript",
    startLine: 1,
    endLine: 5,
    kind: "function",
    text: "export function registerMemoryTools() {}",
    rank: -1,
    size: 100,
    symbolName: "registerMemoryTools",
  }, plan, 4);
  const testDiagnostics = scoreSearchRow({
    path: "test/pi-extension/tools.test.ts",
    language: "typescript",
    startLine: 1,
    endLine: 5,
    kind: "method",
    text: "registerMemoryTools memory_search implementation",
    rank: -1,
    size: 100,
    symbolName: "registerMemoryTools",
  }, plan, 4);

  assert.ok(testDiagnostics.testPenalty > 0, JSON.stringify(testDiagnostics));
  assert.ok(sourceDiagnostics.finalScore > testDiagnostics.finalScore, JSON.stringify({ sourceDiagnostics, testDiagnostics }));
});

test("non-agent queries penalize agent instruction files", () => {
  const plan = planQuery("ast grep binary path should reject ambiguous sg shadow utils command and show install guidance");
  const agentDiagnostics = scoreSearchRow({
    path: "AGENTS.md",
    language: "markdown",
    startLine: 1,
    endLine: 8,
    kind: "heading",
    text: "# ast-grep binary guidance\nsg process binary path ambiguous install guidance shadow utils command",
    rank: -1,
    size: 200,
    symbolName: null,
  }, plan, 4);
  const sourceDiagnostics = scoreSearchRow({
    path: "src/ast-grep/binary-path.ts",
    language: "typescript",
    startLine: 1,
    endLine: 8,
    kind: "function",
    text: "export function resolveAstGrepBinary() { return validateCandidate('sg'); }",
    rank: -1,
    size: 200,
    symbolName: "resolveAstGrepBinary",
  }, plan, 4);
  const agentPlan = planQuery("AGENTS.md");
  const requestedAgentDiagnostics = scoreSearchRow({
    path: "AGENTS.md",
    language: "markdown",
    startLine: 1,
    endLine: 8,
    kind: "heading",
    text: "# Agent instructions",
    rank: -1,
    size: 200,
    symbolName: null,
  }, agentPlan, 4);

  assert.equal(agentDiagnostics.noisePenalty, 18, JSON.stringify(agentDiagnostics));
  assert.ok(sourceDiagnostics.finalScore > agentDiagnostics.finalScore, JSON.stringify({ sourceDiagnostics, agentDiagnostics }));
  assert.equal(requestedAgentDiagnostics.noisePenalty, 0, JSON.stringify(requestedAgentDiagnostics));
});

test("natural binary change requests prefer source targets over agent instructions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-binary-change-source-first-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "ast-grep"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });

  writeFileSync(join(root, "AGENTS.md"), `
# ast-grep binary guidance

The ast grep binary path may be ambiguous when sg is shadowed by another utils command.
The ast grep binary path install guidance belongs in source behavior, not this instruction file.
`);
  writeFileSync(join(root, "src", "ast-grep", "binary-path.ts"), `
export function resolveAstGrepBinaryPath(candidate: string) {
  if (candidate === "sg") throw new Error("ambiguous sg shadow utils command; install ast-grep");
  return candidate;
}
`);
  writeFileSync(join(root, "test", "binary-path.test.ts"), `
import { resolveAstGrepBinaryPath } from "../src/ast-grep/binary-path";

test("rejects ambiguous sg shadow utils command", () => resolveAstGrepBinaryPath("sg"));
`);
  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "ast grep binary path should reject ambiguous sg shadow utils command and show install guidance", limit: 5 });
  const sourceIndex = results.findIndex((result) => result.path === "src/ast-grep/binary-path.ts");
  const agentIndex = results.findIndex((result) => result.path === "AGENTS.md");

  assert.equal(sourceIndex, 0, JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
  assert.ok(agentIndex === -1 || agentIndex > sourceIndex, JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
});

test("natural provider outage requests keep provider implementations in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-provider-outage-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "lib", "providers"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib", "__tests__"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "types"), { recursive: true });
  mkdirSync(join(root, "docs", "plans"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "src", "lib", "dashboard-pipeline.ts"), `
import { deriveMacroSignals } from "./macro-derivations";
import { appendMarginDebtDerivedSeries } from "./margin-debt-derivations";
import { fetchFredSeries } from "./providers/fred";
import { fetchYahooSeries } from "./providers/yahoo";
import type { MacroSeries } from "../types/macro";

export interface ProviderDiagnostics {
  source: "fred" | "yahoo";
  seriesCount: number;
  withDataCount: number;
  errorCount: number;
}

export function summarizeProviderDiagnostics(series: MacroSeries[]): ProviderDiagnostics[] {
  return ["fred", "yahoo"].map((source) => ({
    source: source as "fred" | "yahoo",
    seriesCount: series.filter((item) => item.source === source).length,
    withDataCount: series.filter((item) => item.source === source && item.points.length > 0).length,
    errorCount: series.filter((item) => item.source === source && item.error).length,
  }));
}

export function dashboardProviderNoDataDiagnosticsShouldKeepFredAndYahooSeriesWhenOneMarketSourceIsEmpty(series: MacroSeries[]) {
  return summarizeProviderDiagnostics(series);
}

export async function runDashboardPipeline() {
  const series = appendMarginDebtDerivedSeries([
    await fetchFredSeries(),
    await fetchYahooSeries(),
  ]);
  return { diagnostics: dashboardProviderNoDataDiagnosticsShouldKeepFredAndYahooSeriesWhenOneMarketSourceIsEmpty(series), signals: deriveMacroSignals(series) };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "providers", "fred.ts"), `
export async function fetchFredSeries() {
  return { source: "fred", points: [], error: "FRED provider has no data" };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "providers", "yahoo.ts"), `
export async function fetchYahooSeries() {
  return { source: "yahoo", points: [], error: "Yahoo market source is empty" };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "macro-derivations.ts"), `
export function deriveMacroSignals(series: unknown[]) { return series.length; }
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "margin-debt-derivations.ts"), `
export function appendMarginDebtDerivedSeries(series: unknown[]) { return series; }
`);
  writeFileSync(join(root, "apps", "web", "src", "types", "macro.ts"), `
export interface MacroSeries { source: "fred" | "yahoo"; points: unknown[]; error?: string; }
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "__tests__", "dashboard-pipeline.test.ts"), `
import { summarizeProviderDiagnostics } from "../dashboard-pipeline";

test("keeps provider no data diagnostics for partial outages", () => {
  expect(summarizeProviderDiagnostics([{ source: "fred", points: [], error: "missing" }, { source: "yahoo", points: [1] }])).toHaveLength(2);
});
`);
  writeFileSync(join(root, "docs", "plans", "macro-data-integration.md"), `
# Newsletter macro data integration

Dashboard provider no data diagnostics should remain visible in newsletter plans.
`);
  indexRepo({ cwd: root, approve: true });

  const query = "dashboard provider no data diagnostics should keep FRED and Yahoo series when one market source is empty";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "apps/web/src/lib/dashboard-pipeline.ts",
    "apps/web/src/lib/__tests__/dashboard-pipeline.test.ts",
    "apps/web/src/lib/providers/fred.ts",
    "apps/web/src/lib/providers/yahoo.ts",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural handoff preload requests keep implementation, test, and active ADRs in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-handoff-preload-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "test", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "docs", "adr"), { recursive: true });
  mkdirSync(join(root, "docs", "archive", "plans"), { recursive: true });

  writeFileSync(join(root, "src", "pi-extension", "retrieval.ts"), `
import { findLatestHandoffForTurn } from "./handoffs";

export function formatLatestHandoffLines(latestHandoff: { isFallback: boolean }) {
  return [\`Latest active handoff\${latestHandoff.isFallback ? " (fallback; do not overwrite unless explicit)" : ""}:\`];
}

export function buildTurnMemoryMessage() {
  const latestHandoff = findLatestHandoffForTurn();
  return formatLatestHandoffLines(latestHandoff);
}
`);
  writeFileSync(join(root, "src", "pi-extension", "handoffs.ts"), `
export function findLatestHandoffForTurn() {
  return { isFallback: true };
}
`);
  writeFileSync(join(root, "test", "pi-extension", "retrieval.test.ts"), `
import { buildTurnMemoryMessage } from "../../src/pi-extension/retrieval";

test("findLatestHandoffForTurn prefers exact session handoff before repo fallback", () => {
  expect(buildTurnMemoryMessage()).toContain("Latest active handoff");
});

test("fallback handoff preload warns agents not to overwrite it", () => {
  expect(buildTurnMemoryMessage()).toContain("fallback; do not overwrite unless explicit");
});
`);
  writeFileSync(join(root, "docs", "adr", "005-simplified-agent-facing-scopes.md"), `
# ADR 005 — Simplified agent-facing memory scopes

Use only global, repo, and session as normal agent-facing scopes. Session is short-lived handoff and current-run context; repo is durable repository context.
`);
  writeFileSync(join(root, "docs", "adr", "006-normal-and-advanced-tool-surface.md"), `
# ADR 006 — Normal and Advanced Tool Surface

The simplified scope model favors fewer normal paths: use global, repo, and session. The normal tool surface includes memory_list for active todos and handoffs and memory_save_handoff for explicit handoff writes.
`);
  writeFileSync(join(root, "docs", "adr", "007-memory-model-minimisation.md"), `
# ADR 007 — Memory model minimisation

### Handoff count warning

memory_save_handoff warns when several active handoffs already exist in the same repo.
`);
  writeFileSync(join(root, "docs", "archive", "plans", "memory-model-minimisation.md"), `
# Archived memory model minimisation plan

### Handoff count warning

Archived plan text about active handoff warnings should not displace current implementation, tests, and ADRs.
`);
  indexRepo({ cwd: root, approve: true });

  const query = "active handoff preload should prefer current session before repo fallback and warn not to overwrite fallback handoffs";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "src/pi-extension/retrieval.ts",
    "test/pi-extension/retrieval.test.ts",
    "docs/adr/005-simplified-agent-facing-scopes.md",
    "docs/adr/006-normal-and-advanced-tool-surface.md",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural FastAPI run trigger requests keep compose deployment config in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-fastapi-compose-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "api"), { recursive: true });
  mkdirSync(join(root, "ui"), { recursive: true });

  writeFileSync(join(root, "api", "app.py"), `
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="fourier-cycles-api")

class TriggerRequest(BaseModel):
    confirm: bool = False

@app.post("/api/run")
def trigger_run(request: TriggerRequest):
    if not request.confirm:
        raise HTTPException(status_code=400, detail="set confirm=true to trigger a run")
    raise HTTPException(status_code=409, detail="run already in progress")
`);
  writeFileSync(join(root, "docker-compose.webapp.yml"), `
services:
  fourier-cycles-api:
    build:
      context: .
      dockerfile: api/Dockerfile
    environment:
      FOURIER_TRIGGER_MAX_RUNTIME_SECONDS: "5400"
`);
  writeFileSync(join(root, "PRD_webapp.md"), `
# Fourier Cycles Web App

Phase 2 includes POST /api/run as a controlled FastAPI trigger endpoint.
`);
  writeFileSync(join(root, "README.md"), "# Fourier cycles\n\nFastAPI run trigger docs.\n");
  writeFileSync(join(root, "requirements.txt"), "fastapi\npydantic\n");
  writeFileSync(join(root, "ui", "tsconfig.app.json"), JSON.stringify({ compilerOptions: {} }, null, 2));
  indexRepo({ cwd: root, approve: true });

  const query = "FastAPI confirm true run already in progress";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of ["api/app.py", "docker-compose.webapp.yml", "PRD_webapp.md"]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural reviewer context scout requests keep plan, benchmark, and fixtures in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-reviewer-scout-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "docs", "plans"), { recursive: true });
  mkdirSync(join(root, "docs", "benchmarks"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });

  writeFileSync(join(root, "docs", "plans", "reviewer-context-scout.md"), `
# Reviewer context scout

The reviewer context scout should gather bounded contract and nearby test evidence without scout recursion.
It reads the benchmark fixtures and must not route through fanout reduce plans.
`);
  writeFileSync(join(root, "docs", "benchmarks", "reviewer-context-scout-fixtures.json"), JSON.stringify({ cases: [{ name: "bounded contract evidence", scoutRecursion: false }] }, null, 2));
  writeFileSync(join(root, "tests", "reviewer-context-scout-benchmark.test.mjs"), `
import fixtures from "../docs/benchmarks/reviewer-context-scout-fixtures.json" with { type: "json" };

test("reviewer context scout gathers bounded nearby test evidence without recursion", () => {
  assert.equal(fixtures.cases[0].scoutRecursion, false);
});
`);
  writeFileSync(join(root, "scripts", "score-reviewer-context-scout-benchmark.mjs"), `
import fixtures from "../docs/benchmarks/reviewer-context-scout-fixtures.json" with { type: "json" };
console.log(fixtures.cases.length);
`);
  for (const noisyTest of ["request.test.mjs", "token-injection.test.mjs", "agents.test.mjs", "display.test.mjs"]) {
    writeFileSync(join(root, "tests", noisyTest), `
test("ordinary unrelated test evidence", () => {
  assert.ok(true);
});
`);
  }
  writeFileSync(join(root, "docs", "plans", "fanout-reduce.md"), `
# Fanout reduce

Noisy scout recursion material that should not displace the reviewer context scout plan.
`);
  indexRepo({ cwd: root, approve: true });

  const query = "reviewer context scout should gather bounded contract and nearby test evidence without scout recursion";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "docs/plans/reviewer-context-scout.md",
    "docs/benchmarks/reviewer-context-scout-fixtures.json",
    "tests/reviewer-context-scout-benchmark.test.mjs",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural binary install guidance requests keep README in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-binary-guidance-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "ast-grep"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });

  writeFileSync(join(root, "README.md"), `
# ast-grep binary guidance

## Installation

Install ast-grep yourself first:

\`\`\`bash
cargo install ast-grep --locked
brew install ast-grep
npm install -g @ast-grep/cli
\`\`\`

## Binary trust model

The command name sg is ambiguous on Unix-like systems. Some systems provide sg from shadow-utils/newgrp.
This extension validates sg --version and rejects sg unless the version output identifies ast-grep.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| sg exists but is ignored | It is likely not ast-grep; install ast-grep or ensure ast-grep's sg appears first on PATH. |
`);
  writeFileSync(join(root, "src", "ast-grep", "binary-path.ts"), `
export function getCandidatePaths() {
  return ["ast-grep", "sg"];
}

export function findOnPath(baseName: "ast-grep" | "sg") {
  return getCandidatePaths().filter((candidate) => candidate === baseName);
}

export function getBinaryNames(baseName: "ast-grep" | "sg") {
  return [baseName];
}

export function runVersionCommand(binaryPath: string) {
  return binaryPath.includes("sg") ? "sg from shadow utils command" : "ast-grep";
}

export function isAstGrepVersionOutput(output: string) {
  return output.includes("ast-grep");
}

export function validateCandidate(candidate: string) {
  return isAstGrepVersionOutput(runVersionCommand(candidate));
}

export function resolveAstGrepBinaryPath(candidate: string) {
  if (candidate === "sg") throw new Error("ambiguous sg shadow utils command; install ast-grep");
  return candidate;
}
`);
  writeFileSync(join(root, "src", "ast-grep", "cli.ts"), `
import { resolveAstGrepBinaryPath } from "./binary-path";

export const INSTALL_HINT = "Install ast-grep locally with cargo install ast-grep --locked, brew install ast-grep, or npm install -g @ast-grep/cli. The sg command is accepted only when sg --version identifies ast-grep.";

export async function runSg(candidate: string) {
  return resolveAstGrepBinaryPath(candidate) ?? INSTALL_HINT;
}
`);
  writeFileSync(join(root, "src", "ast-grep", "tools.ts"), `
import { resolveAstGrepBinaryPath } from "./binary-path";
export const toolBinary = resolveAstGrepBinaryPath;
`);
  writeFileSync(join(root, "src", "index.ts"), `
export { resolveAstGrepBinaryPath } from "./ast-grep/binary-path";
`);
  writeFileSync(join(root, "test", "binary-path.test.ts"), `
import { resolveAstGrepBinaryPath } from "../src/ast-grep/binary-path";

test("rejects ambiguous sg shadow utils command", () => resolveAstGrepBinaryPath("sg"));
`);
  indexRepo({ cwd: root, approve: true });

  const query = "ast grep binary path should reject ambiguous sg shadow utils command and show install guidance";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of ["src/ast-grep/binary-path.ts", "test/binary-path.test.ts", "src/ast-grep/cli.ts", "README.md"]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural API endpoint requests keep route adapters in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-route-adapter-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib", "__tests__"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "types"), { recursive: true });
  mkdirSync(join(root, "docs", "plans"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "src", paths: { "@/*": ["*"] } } }, null, 2));
  writeFileSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro", "route.ts"), `
import { NextResponse } from "next/server";
import { buildNewsletterMacroSnapshot } from "@/lib/newsletter-macro-snapshot";

export async function GET() {
  return NextResponse.json(buildNewsletterMacroSnapshot({ generatedAt: new Date().toISOString(), series: [], warnings: [] }));
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "newsletter-macro-snapshot.ts"), `
import { latestPercentChange } from "@/lib/series-derivations";
import type { DashboardData, MacroSeries } from "@/types/macro";

type NewsletterMacroStatus = "ok" | "stale" | "unavailable" | "error";

const INDICATORS = [
  { key: "ism_manufacturing_pmi", source: "source_decision_needed", warning: "No verified source configured yet." },
  { key: "inflation_yoy", sourceKey: "cpi", derivation: "yoy" },
];

export function buildNewsletterMacroSnapshot(dashboard: DashboardData) {
  const generatedAt = dashboard.generatedAt;
  latestPercentChange([] as MacroSeries["points"], "yoy");
  return { schemaVersion: 1, generatedAt, indicators: INDICATORS, warnings: ["stale unavailable source decision warnings"] };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "series-derivations.ts"), `
export function latestPercentChange(points: Array<{ date: string; value: number }>, period: "mom" | "qoq" | "yoy") {
  return points.at(-1) ?? null;
}
`);
  writeFileSync(join(root, "apps", "web", "src", "types", "macro.ts"), `
export interface MacroSeries { points: Array<{ date: string; value: number }> }
export interface DashboardData { generatedAt: string; series: MacroSeries[]; warnings: string[] }
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "__tests__", "newsletter-macro-snapshot.test.ts"), `
import { buildNewsletterMacroSnapshot } from "../newsletter-macro-snapshot";

test("surfaces stale unavailable source decision warnings", () => {
  expect(buildNewsletterMacroSnapshot({ generatedAt: "2025-01-01T00:00:00.000Z", series: [], warnings: [] }).warnings).toContain("stale unavailable source decision warnings");
});
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "__tests__", "series-derivations.test.ts"), `
import { latestPercentChange } from "../series-derivations";

test("computes latest percent changes", () => {
  expect(latestPercentChange([{ date: "2025-01-01", value: 1 }], "yoy")).toMatchObject({ value: 1 });
});
`);
  writeFileSync(join(root, "docs", "plans", "newsletter-macro-data-integration.md"), `
# Newsletter Macro Data Integration

The newsletter macro endpoint returns stale and unavailable source-decision warnings for missing indicators.
`);
  indexRepo({ cwd: root, approve: true });

  const targetContext = codemapContext({ cwd: root, target: "apps/web/src/lib/newsletter-macro-snapshot.ts", limit: 5 });
  assert.ok(targetContext.readFirst.some((item) => item.path === "apps/web/src/app/api/newsletter/macro/route.ts"), JSON.stringify(targetContext.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) }))));

  const query = "newsletter macro endpoint should return stale unavailable source decision warnings for missing macro indicators";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "apps/web/src/lib/newsletter-macro-snapshot.ts",
    "apps/web/src/app/api/newsletter/macro/route.ts",
    "apps/web/src/lib/__tests__/newsletter-macro-snapshot.test.ts",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural catalog endpoint requests keep route adapter, catalog source, and catalog test", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-catalog-endpoint-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "app", "api", "catalog"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "components"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib", "__tests__"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib", "providers"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "src", paths: { "@/*": ["*"] } } }, null, 2));
  writeFileSync(join(root, "apps", "web", "src", "app", "api", "catalog", "route.ts"), `
import { SERIES_CATALOG } from "@/lib/series-catalog";

export async function GET() {
  return Response.json(SERIES_CATALOG);
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "series-catalog.ts"), `
export interface SeriesSpec {
  key: string;
  label: string;
  providerId: string;
  source: "fred" | "yahoo";
}

export const SERIES_CATALOG: SeriesSpec[] = [
  { key: "sp500", label: "Macro dashboard dropdown series", providerId: "DUPLICATE", source: "yahoo" },
  { key: "vix", label: "Macro provider ids duplicate", providerId: "DUPLICATE", source: "yahoo" },
];
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "__tests__", "series-catalog.test.ts"), `
import { SERIES_CATALOG } from "../series-catalog";

test("provider ids are unique for dashboard dropdown", () => {
  expect(new Set(SERIES_CATALOG.map((series) => series.providerId)).size).toBe(SERIES_CATALOG.length);
});
`);
  for (const provider of ["finra", "fred", "yahoo"]) {
    writeFileSync(join(root, "apps", "web", "src", "lib", "providers", `${provider}.ts`), `
import type { SeriesSpec } from "@/lib/series-catalog";

export function fetch${provider}(series: SeriesSpec) {
  return { providerId: series.providerId, macro: true, dashboard: true, dropdown: "series" };
}
`);
  }
  writeFileSync(join(root, "apps", "web", "src", "components", "dashboard-client.tsx"), `
export function DashboardClient() {
  return <select>{["macro", "provider", "dashboard", "dropdown", "series"].map((item) => <option>{item}</option>)}</select>;
}
`);
  indexRepo({ cwd: root, approve: true });

  const query = "catalog endpoint returns duplicate macro provider ids and dashboard dropdown shows repeated series";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "apps/web/src/app/api/catalog/route.ts",
    "apps/web/src/lib/series-catalog.ts",
    "apps/web/src/lib/__tests__/series-catalog.test.ts",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural identifier pairs keep compact code terms without prose compounds", () => {
  const plan = planQuery("workbench chart interval and x range settings should survive reload from local storage");

  assert.ok(plan.coreTerms.includes("xrange"), JSON.stringify(plan.coreTerms));
  assert.ok(plan.coreTerms.includes("localstorage"), JSON.stringify(plan.coreTerms));
  assert.ok(!plan.coreTerms.includes("shouldsurvive"), JSON.stringify(plan.coreTerms));
});

test("ordinary natural queries penalize local Claude settings", () => {
  const naturalPlan = planQuery("workbench chart interval and x range settings should survive reload from local storage");
  const pathPlan = planQuery(".claude/settings.local.json");
  const claudePlan = planQuery("claude settings permissions");
  const row = {
    path: ".claude/settings.local.json",
    language: "json",
    startLine: 1,
    endLine: 8,
    kind: "text",
    text: '{ "permissions": { "allow": ["Bash(curl:*)"] }, "spinnerTipsEnabled": true }',
    rank: -1,
    size: 120,
    symbolName: null,
  };

  assert.equal(scoreSearchRow(row, naturalPlan, 4).noisePenalty, 18);
  assert.equal(scoreSearchRow(row, pathPlan, 4).noisePenalty, 0);
  assert.equal(scoreSearchRow(row, claudePlan, 4).noisePenalty, 0);
});

test("natural workbench session queries prefer source over local agent settings", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-workbench-session-source-first-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(join(root, "src", "lib"), { recursive: true });

  writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({
    permissions: { allow: ["Bash(curl:*)"] },
    spinnerTipsEnabled: true,
  }, null, 2));
  writeFileSync(join(root, "src", "lib", "use-series-workbench-session.ts"), `
export function restoreSeriesWorkbenchSession() {
  const saved = localStorage.getItem("series-workbench-session");
  return saved ? JSON.parse(saved) : { interval: "1d", range: "1y" };
}
`);
  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "workbench chart interval and x range settings should survive reload from local storage", limit: 5 });
  const sourceIndex = results.findIndex((result) => result.path === "src/lib/use-series-workbench-session.ts");
  const localSettingsIndex = results.findIndex((result) => result.path === ".claude/settings.local.json");

  assert.equal(sourceIndex, 0, JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
  assert.ok(localSettingsIndex === -1 || localSettingsIndex > sourceIndex, JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
});

test("implementation-intent queries prefer source targets over matching tests", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-implementation-source-first-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "test", "pi-extension"), { recursive: true });

  writeFileSync(join(root, "src", "pi-extension", "tools.ts"), `
export function registerMemoryTools() {
  return true;
}
`);
  writeFileSync(join(root, "test", "pi-extension", "tools.test.ts"), `
import { registerMemoryTools } from "../../src/pi-extension/tools";

// Repeated test-local helper methods should not saturate the implementation query candidate pool.
${Array.from({ length: 30 }, (_, index) => `export const testCase${index} = { registerMemoryTools() { return "implementation memory_search empty_result_hints near canonical keys near tag suggestions"; } };`).join("\n")}

test("registerMemoryTools implementation memory_search empty_result_hints near canonical keys near tag suggestions", () => {
  testCase0.registerMemoryTools();
});
`);
  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "registerMemoryTools implementation memory_search empty_result_hints near canonical keys near tag suggestions", limit: 5 });

  assert.equal(results[0]?.path, "src/pi-extension/tools.ts", JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
});

test("python class and function symbols are searchable", (t) => {
  const root = fixtureRepo(t);
  assert.ok(searchCodeMap({ cwd: root, query: "DeliveryClient", limit: 5 }).some((result) => result.kind === "class"));
  assert.ok(searchCodeMap({ cwd: root, query: "send_telegram", limit: 5 }).some((result) => result.kind === "function"));
});

test("path-like queries return file matches first", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "tools.ts", limit: 5 });
  assert.equal(results[0]?.path, "src/pi-extension/tools.ts");
  assert.equal(results[0]?.kind, "file");
});

test("role-intent queries can surface main implementation files without lexical hits", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "where is the main implementation?", limit: 5 });
  assert.equal(results[0]?.path, "train.py");
  assert.equal(results[0]?.kind, "file");
});

test("endpoint route queries find route handlers before docs and generated noise", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-route-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro", "route.ts"), `
export async function GET() {
  const macroSnapshot = await loadMacroSnapshot();
  return Response.json({ macroSnapshot, channel: "newsletter" });
}

async function loadMacroSnapshot() {
  return { risk: "steady" };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro", "route.test.ts"), `
import { GET } from "./route";

export const routeSmoke = GET;
`);
  writeFileSync(join(root, "docs", "newsletter-macro-api.md"), "# Newsletter macro API\n\nThe GET api newsletter macro snapshot endpoint is documented here.\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "GET api newsletter macro snapshot endpoint" }, null, 2));
  writeFileSync(join(root, "dist", "route.js"), "export const generated = 'GET api newsletter macro snapshot endpoint';\n");

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "GET api newsletter macro snapshot endpoint", limit: 5 });
  assert.equal(results[0]?.path, "apps/web/src/app/api/newsletter/macro/route.ts");
  assert.ok(results.every((result) => result.path !== "package-lock.json"), JSON.stringify(results.map((result) => result.path)));

  const contextResult = codemapContext({ cwd: root, target: results[0]?.path ?? "", limit: 5 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.equal(readFirstPaths[0], "apps/web/src/app/api/newsletter/macro/route.ts");
  assert.ok(readFirstPaths.includes("apps/web/src/app/api/newsletter/macro/route.test.ts"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("dist/route.js"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("package-lock.json"), JSON.stringify(readFirstPaths));
});

test("config-key queries find source config before docs and lockfile noise", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-config-key-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "src", "newsletter"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, "config", "newsletter-macro.json"), JSON.stringify({ newsletterMacroSnapshotTtlMs: 900000, channel: "macro" }, null, 2));
  writeFileSync(join(root, "src", "newsletter", "macro-service.ts"), "export const macroSnapshotTtl = 900000;\n");
  writeFileSync(join(root, "docs", "newsletter-macro.md"), "# Newsletter macro\n\nOperators tune newsletterMacroSnapshotTtlMs in config.\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "newsletterMacroSnapshotTtlMs config key" }, null, 2));

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "newsletterMacroSnapshotTtlMs config key", limit: 5 });
  assert.equal(results[0]?.path, "config/newsletter-macro.json");
  assert.ok(results.every((result) => result.path !== "package-lock.json"), JSON.stringify(results.map((result) => result.path)));

  const contextResult = codemapContext({ cwd: root, target: results[0]?.path ?? "", limit: 4 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.equal(readFirstPaths[0], "config/newsletter-macro.json");
  assert.ok(!readFirstPaths.includes("package-lock.json"), JSON.stringify(readFirstPaths));
});

test("error-message queries find throwing source before docs and generated noise", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-error-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "newsletter"), { recursive: true });
  mkdirSync(join(root, "tests", "newsletter"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, "src", "newsletter", "snapshot-service.ts"), `
export function requireFreshSnapshot(snapshotAgeMs: number) {
  if (snapshotAgeMs > 900000) {
    throw new Error("ERR_NEWSLETTER_SNAPSHOT_STALE: macro snapshot is too old");
  }
  return true;
}
`);
  writeFileSync(join(root, "tests", "newsletter", "snapshot-service.test.ts"), `
import { requireFreshSnapshot } from "../../src/newsletter/snapshot-service";

export const staleSnapshotTest = requireFreshSnapshot;
`);
  writeFileSync(join(root, "docs", "newsletter-errors.md"), "# Newsletter errors\n\nERR_NEWSLETTER_SNAPSHOT_STALE: macro snapshot is too old means operators should refresh data.\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "ERR_NEWSLETTER_SNAPSHOT_STALE macro snapshot stale error" }, null, 2));
  writeFileSync(join(root, "dist", "snapshot-service.js"), "throw new Error('ERR_NEWSLETTER_SNAPSHOT_STALE: macro snapshot is too old');\n");

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "ERR_NEWSLETTER_SNAPSHOT_STALE macro snapshot stale error", limit: 5 });
  assert.equal(results[0]?.path, "src/newsletter/snapshot-service.ts");
  assert.ok(results.every((result) => result.path !== "package-lock.json"), JSON.stringify(results.map((result) => result.path)));
  assert.ok(results.every((result) => result.path !== "dist/snapshot-service.js"), JSON.stringify(results.map((result) => result.path)));

  const contextResult = codemapContext({ cwd: root, target: results[0]?.path ?? "", limit: 5 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.equal(readFirstPaths[0], "src/newsletter/snapshot-service.ts");
  assert.ok(readFirstPaths.includes("tests/newsletter/snapshot-service.test.ts"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("dist/snapshot-service.js"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("package-lock.json"), JSON.stringify(readFirstPaths));
});

test("phrase queries find phrase-bearing docs without lockfile noise", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "\"ignored directory\"", limit: 5 });
  assert.equal(results[0]?.path, "docs/ops.md");
  assert.ok(results.every((result) => result.path !== "package-lock.json"));
});

test("lockfiles are indexed but only prominent for explicit lockfile queries", (t) => {
  const root = fixtureRepo(t);

  const dependencies = searchCodeMap({ cwd: root, query: "package dependencies leftpad", limit: 5 });
  assert.equal(dependencies[0]?.path, "package.json");
  assert.ok(dependencies.every((result) => result.path !== "package-lock.json"));

  const lockfile = searchCodeMap({ cwd: root, query: "package-lock.json", limit: 5 });
  assert.equal(lockfile[0]?.path, "package-lock.json");
});

test("navigation queries rank source config docs and tests before noisy files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-ranking-noise-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "__generated__"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(join(root, "data"), { recursive: true });

  writeFileSync(join(root, "src", "index.ts"), "export function featureGateway() { return 'feature gateway source entrypoint'; }\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "feature-gateway", description: "feature gateway config", scripts: { test: "node --test" } }, null, 2));
  writeFileSync(join(root, "docs", "feature-gateway.md"), "# Feature gateway docs\n\nFeature gateway documentation for operators.\n");
  writeFileSync(join(root, "test", "feature-gateway.test.ts"), "import '../src/index';\n// feature gateway tests validate behavior\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, noise: "feature gateway config docs tests" }, null, 2));
  writeFileSync(join(root, "dist", "index.js"), "function featureGateway(){return 'feature gateway build output config docs tests'}\n");
  writeFileSync(join(root, "src", "__generated__", "feature-client.ts"), "export const generatedFeatureGateway = 'feature gateway generated config docs tests';\n");
  writeFileSync(join(root, "dist", "app.min.js"), "var featureGateway='feature gateway minified config docs tests';\n");
  writeFileSync(join(root, "data", "catalog.json"), JSON.stringify({ rows: Array.from({ length: 1500 }, (_, index) => ({ index, text: "feature gateway config docs tests noisy data" })) }, null, 2));

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "feature gateway config docs tests", limit: 10 });
  const paths = results.map((result) => result.path);
  const useful = ["src/index.ts", "package.json", "docs/feature-gateway.md", "test/feature-gateway.test.ts"];
  const noisy = ["package-lock.json", "dist/index.js", "src/__generated__/feature-client.ts", "dist/app.min.js", "data/catalog.json"];
  const firstNoisyIndex = Math.min(...noisy.map((path) => paths.indexOf(path)).filter((index) => index >= 0));

  assert.ok(Number.isFinite(firstNoisyIndex), JSON.stringify(paths));
  for (const path of useful) {
    const index = paths.indexOf(path);
    assert.ok(index >= 0, `${path} missing from ${JSON.stringify(paths)}`);
    assert.ok(index < firstNoisyIndex, `${path} should rank before noisy files: ${JSON.stringify(paths)}`);
  }

  const jsonResults = searchCodeMap({ cwd: root, query: "feature gateway json config docs tests", limit: 10 });
  const jsonPaths = jsonResults.map((result) => result.path);
  const firstJsonNoisyIndex = Math.min(...noisy.map((path) => jsonPaths.indexOf(path)).filter((index) => index >= 0));
  const packageJsonIndex = jsonPaths.indexOf("package.json");
  assert.ok(Number.isFinite(firstJsonNoisyIndex), JSON.stringify(jsonPaths));
  assert.ok(packageJsonIndex >= 0, JSON.stringify(jsonPaths));
  assert.ok(packageJsonIndex < firstJsonNoisyIndex, JSON.stringify(jsonPaths));

  const explicitNoise = searchCodeMap({ cwd: root, query: "catalog.json", limit: 5 });
  assert.equal(explicitNoise[0]?.path, "data/catalog.json");
});

test("noisy queries keep source first and out of read-first neighbors", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-noisy-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "__generated__"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, "src", "noisy-navigation.ts"), `
export function resolveNoisyNavigation() {
  return "generated bundle noise root cause source anchor";
}
`);
  writeFileSync(join(root, "src", "__generated__", "noisy-client.ts"), "export const generatedNoisyClient = 'generated bundle noise root cause source anchor';\n");
  writeFileSync(join(root, "dist", "noisy-navigation.js"), "function resolveNoisyNavigation(){return 'generated bundle noise root cause source anchor';}\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "generated bundle noise root cause source anchor" }, null, 2));

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "generated bundle noise root cause source anchor", limit: 5 });
  assert.equal(results[0]?.path, "src/noisy-navigation.ts");
  assert.ok(results.every((result) => result.path !== "src/__generated__/noisy-client.ts"), JSON.stringify(results.map((result) => result.path)));
  assert.ok(results.every((result) => result.path !== "dist/noisy-navigation.js"), JSON.stringify(results.map((result) => result.path)));
  assert.ok(results.every((result) => result.path !== "package-lock.json"), JSON.stringify(results.map((result) => result.path)));

  const contextResult = codemapContext({ cwd: root, target: results[0]?.path ?? "", limit: 4 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.equal(readFirstPaths[0], "src/noisy-navigation.ts");
  assert.ok(!readFirstPaths.includes("src/__generated__/noisy-client.ts"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("dist/noisy-navigation.js"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("package-lock.json"), JSON.stringify(readFirstPaths));
});

test("ranking diagnostics expose score components without search API explain fields", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "package dependencies leftpad", limit: 5 });
  assert.ok(results.length > 0);
  assert.ok(results.every((result) => !("diagnostics" in result) && !("scoreDiagnostics" in result)));

  const diagnostics = scoreSearchRow({
    path: "package-lock.json",
    language: "json",
    startLine: 1,
    endLine: 1,
    kind: "text",
    text: "leftpad dependencies package",
    rank: -3,
    symbolName: null,
  }, planQuery("package dependencies leftpad"), 1);

  assert.ok(diagnostics.finalScore < 0, JSON.stringify(diagnostics));
  assert.equal(diagnostics.retrievalBoost, 1);
  assert.ok(diagnostics.ftsScore > 0, JSON.stringify(diagnostics));
  assert.ok(diagnostics.tokenCoverage > 0, JSON.stringify(diagnostics));
  assert.deepEqual(diagnostics.matchedTokens.sort(), ["dependencies", "leftpad", "package"]);
  assert.ok(diagnostics.noisePenalty >= 60, JSON.stringify(diagnostics));
});

test("internal search debug report shows score components and candidate decisions", (t) => {
  const root = fixtureRepo(t);
  const publicResults = searchCodeMap({ cwd: root, query: "alpha beta", limit: 1 });
  const debug = searchCodeMapDebug({ cwd: root, query: "alpha beta", limit: 1 });

  assert.deepEqual(Object.keys(publicResults[0] ?? {}).sort(), ["endLine", "kind", "language", "path", "score", "snippet", "startLine"]);
  assert.deepEqual(debug.results, publicResults);
  assert.equal(debug.limit, 1);
  assert.ok(debug.candidates.some((candidate) => candidate.decision === "selected" && candidate.selectedRank === 1), JSON.stringify(debug.candidates));
  assert.ok(debug.candidates.some((candidate) => candidate.decision === "outside_limit" || candidate.decision === "deduped_lower_score"), JSON.stringify(debug.candidates));
  const selectedCandidate = debug.candidates.find((candidate) => candidate.decision === "selected");
  assert.ok(selectedCandidate, JSON.stringify(debug.candidates));
  assert.equal(typeof selectedCandidate.scoreDiagnostics.pathScore, "number");
  assert.ok(Array.isArray(selectedCandidate.scoreDiagnostics.matchedTokens));
});

test("natural module queries rank exact basename files above sibling config matches", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-module-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "newsletter_writer"), { recursive: true });

  writeFileSync(join(root, "src", "newsletter_writer", "config.py"), `
class TelegramConfig:
    delivery_log_path = "telegram delivery log"
`);
  writeFileSync(join(root, "src", "newsletter_writer", "delivery.py"), `
"""Telegram delivery: send newsletter messages via Bot API."""

def send_telegram(text):
    return text
`);

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "telegram delivery log host lock", limit: 5 });
  assert.equal(results[0]?.path, "src/newsletter_writer/delivery.py", JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
});

test("ranking gives exact module-name terms enough weight over sibling content matches", () => {
  const plan = planQuery("telegram delivery log host lock");
  const moduleDiagnostics = scoreSearchRow({
    path: "src/newsletter_writer/delivery.py",
    language: "python",
    startLine: 1,
    endLine: 1,
    kind: "text",
    text: "send telegram newsletter",
    rank: 0,
    symbolName: null,
  }, plan, 1);
  const siblingDiagnostics = scoreSearchRow({
    path: "src/newsletter_writer/config.py",
    language: "python",
    startLine: 1,
    endLine: 1,
    kind: "text",
    text: "telegram delivery log host lock settings",
    rank: 0,
    symbolName: null,
  }, plan, 1);

  assert.ok(moduleDiagnostics.filenameScore > siblingDiagnostics.filenameScore, JSON.stringify({ moduleDiagnostics, siblingDiagnostics }));
  assert.ok(moduleDiagnostics.finalScore > siblingDiagnostics.finalScore, JSON.stringify({ moduleDiagnostics, siblingDiagnostics }));
});

test("multi-term queries prefer all-term matches over OR fallback", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "alpha beta", limit: 5 });
  assert.equal(results[0]?.path, "docs/alpha-beta.md");
  assert.match(results[0]?.snippet ?? "", /alpha beta/i);
});

test("numeric queries remain searchable", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "404", limit: 5 });
  assert.equal(results[0]?.path, "src/core/numeric.ts");
  assert.match(results[0]?.snippet ?? "", /404/);
});

test("search diagnostics warn without auto-refreshing stale indexes", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "new-feature.ts"), `
export function newFeatureFlag() {
  return true;
}
`);

  const result = searchCodeMapWithDiagnostics({ cwd: root, query: "newFeatureFlag", limit: 5 });
  assert.equal(result.stale, true);
  assert.equal(result.missing, 1);
  assert.match(result.warnings.join("\n"), /Index stale/);
  assert.equal(result.results.length, 0);

  indexRepo({ cwd: root });
  const refreshed = searchCodeMapWithDiagnostics({ cwd: root, query: "newFeatureFlag", limit: 5 });
  assert.equal(refreshed.stale, false);
  assert.equal(refreshed.results[0]?.path, "src/core/new-feature.ts");
});

test("context diagnostics warn without auto-refreshing stale indexes", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "context-added.ts"), `
export function contextAdded() {
  return true;
}
`);

  const result = codemapContext({ cwd: root, target: "contextAdded", limit: 5 });
  assert.equal(result.stale, true);
  assert.equal(result.missing, 1);
  assert.match(result.warnings.join("\n"), /Index stale/);
  assert.deepEqual(result.readFirst, []);
});

test("context path matching treats LIKE wildcards literally", (t) => {
  const root = fixtureRepo(t);
  const result = codemapContext({ cwd: root, target: "user_service.ts", limit: 5 });
  assert.ok(result.warnings.includes("Target was not an indexed file path; falling back to search results."));
});

test("full status reports git head and dirty tracked files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-git-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "codemap@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "CodeMap Test"], { cwd: root });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "changed.ts"), "export const changed = 1;\n");
  writeFileSync(join(root, "src", "deleted.ts"), "export const deleted = 1;\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: root, stdio: "ignore" });

  indexRepo({ cwd: root, approve: true });
  const clean = status(root, { health: "full" });
  assert.ok(clean.lastIndexedAt);
  assert.ok(clean.currentHead);
  assert.ok(clean.indexedHead);
  assert.equal(clean.currentHead, clean.indexedHead);
  assert.equal(clean.headChanged, false);
  assert.equal(clean.dirty, false);
  assert.deepEqual(clean.dirtyFiles, []);

  writeFileSync(join(root, "src", "changed.ts"), "export const changed = 2;\n");
  unlinkSync(join(root, "src", "deleted.ts"));
  const dirty = status(root, { health: "full" });
  assert.equal(dirty.stale, true);
  assert.equal(dirty.changed, 1);
  assert.equal(dirty.deleted, 1);
  assert.equal(dirty.dirty, true);
  assert.deepEqual(dirty.dirtyFiles.map((file) => [file.path, file.status]).sort(), [
    ["src/changed.ts", "modified"],
    ["src/deleted.ts", "deleted"],
  ]);

  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-m", "change tracked files"], { cwd: root, stdio: "ignore" });
  const committed = status(root, { health: "full" });
  assert.equal(committed.stale, true);
  assert.notEqual(committed.currentHead, committed.indexedHead);
  assert.equal(committed.headChanged, true);
  assert.equal(committed.dirty, false);
  assert.deepEqual(committed.dirtyFiles, []);
});

test("status pathPrefix treats LIKE wildcards literally", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-status-prefix-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "services", "api_v1"), { recursive: true });
  mkdirSync(join(root, "services", "apiXv1"), { recursive: true });
  mkdirSync(join(root, "services", "api%v1"), { recursive: true });
  mkdirSync(join(root, "services", "apiYv1"), { recursive: true });

  writeFileSync(join(root, "services", "api_v1", "handler.ts"), "export function exactUnderscoreApiNeedle() { return true; }\n");
  writeFileSync(join(root, "services", "apiXv1", "handler.ts"), "export function wildcardUnderscoreApiNeedle() { return true; }\n");
  writeFileSync(join(root, "services", "api%v1", "handler.ts"), "export function exactPercentApiNeedle() { return true; }\n");
  writeFileSync(join(root, "services", "apiYv1", "handler.ts"), "export function wildcardPercentApiNeedle() { return true; }\n");

  indexRepo({ cwd: root, approve: true });

  const underscoreScoped = status(root, { health: "full", pathPrefix: "services/api_v1" });
  assert.equal(underscoreScoped.files, 1);
  assert.equal(underscoreScoped.deleted, 0);

  const percentScoped = status(root, { health: "full", pathPrefix: "services/api%v1" });
  assert.equal(percentScoped.files, 1);
  assert.equal(percentScoped.deleted, 0);
});

test("context packages direct files with related tests and docs", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "test", "user-service.test.ts"), "import '../src/core/user-service';\n");
  writeFileSync(join(root, "docs", "user-service.md"), "# User service\n\napprove and archive users\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/user-service.ts", limit: 3 });
  assert.equal((result.readFirst[0] as { path: string }).path, "src/core/user-service.ts");
  assert.deepEqual(result.relatedTests, ["test/user-service.test.ts"]);
  assert.deepEqual(result.relatedDocs, ["docs/user-service.md"]);
  assert.deepEqual(result.warnings, []);
});

test("context read-first includes directly imported local files with reasons", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "src", "core", "user-service.ts"), `
import { connectDb } from "./db";
import { validateUser } from "./validation.ts";
import { externalClient } from "external-package";

export function approveUser(id: string) {
  validateUser(id);
  return connectDb().approve(id, externalClient);
}
`);
  writeFileSync(join(root, "src", "core", "db.ts"), "export function connectDb() { return { approve: (id: string, client: unknown) => ({ id, client }) }; }\n");
  writeFileSync(join(root, "src", "core", "validation.ts"), "export function validateUser(id: string) { if (!id) throw new Error('missing id'); }\n");
  writeFileSync(join(root, "test", "user-service.test.ts"), "import '../src/core/user-service';\n");
  writeFileSync(join(root, "docs", "user-service.md"), "# User service\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/user-service.ts", limit: 5 });

  assert.deepEqual(result.readFirst.slice(0, 3).map((item) => item.path), [
    "src/core/user-service.ts",
    "src/core/db.ts",
    "src/core/validation.ts",
  ]);
  assert.deepEqual(result.readFirst[0]?.reasons?.map((reason) => reason.kind), ["target"]);
  assert.deepEqual(result.readFirst[1]?.reasons?.map((reason) => reason.kind), ["import"]);
  assert.equal(result.readFirst[1]?.reasons?.[0]?.specifier, "./db");
  assert.ok(result.readFirst.every((item) => item.path !== "external-package"));
  assert.deepEqual(result.warnings, []);
});

test("context read-first keeps a convention sibling test within the small read budget", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "test", "pi-extension"), { recursive: true });

  writeFileSync(join(root, "src", "pi-extension", "retrieval.ts"), `
import { readStore } from "./store";
import { validateQuery } from "./validation";

export function retrieve(query: string) {
  return validateQuery(query) ? readStore(query) : [];
}
`);
  writeFileSync(join(root, "src", "pi-extension", "store.ts"), "export function readStore(query: string) { return [query]; }\n");
  writeFileSync(join(root, "src", "pi-extension", "validation.ts"), "export function validateQuery(query: string) { return Boolean(query); }\n");
  writeFileSync(join(root, "src", "pi-extension", "commands.ts"), "import { retrieve } from './retrieval';\nexport const runRetrieval = retrieve;\n");
  writeFileSync(join(root, "src", "pi-extension", "retrieval.config.json"), JSON.stringify({ limit: 5 }, null, 2));
  writeFileSync(join(root, "test", "pi-extension", "retrieval.test.ts"), "test('retrieval convention neighbor', () => true);\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/pi-extension/retrieval.ts", limit: 5 });
  const paths = result.readFirst.map((item) => item.path);

  assert.equal(paths[0], "src/pi-extension/retrieval.ts");
  assert.ok(paths.includes("test/pi-extension/retrieval.test.ts"), JSON.stringify(paths));
  assert.ok(result.readFirst.find((item) => item.path === "test/pi-extension/retrieval.test.ts")?.reasons?.some((reason) => reason.kind === "sibling_test"), JSON.stringify(result.readFirst));
});

test("context read-first includes tests for imported local neighbors within the small read budget", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "test", "pi-extension"), { recursive: true });

  writeFileSync(join(root, "src", "pi-extension", "turn-intake.ts"), `
import { loadCore } from "../core/index";
import { retrieve } from "./retrieval";

export function runTurnIntake(prompt: string) {
  return retrieve(loadCore(prompt));
}
`);
  writeFileSync(join(root, "src", "core", "index.ts"), "export function loadCore(prompt: string) { return prompt; }\n");
  writeFileSync(join(root, "src", "pi-extension", "retrieval.ts"), "export function retrieve(query: string) { return [query]; }\n");
  writeFileSync(join(root, "src", "pi-extension", "index.ts"), "import { runTurnIntake } from './turn-intake';\nexport const run = runTurnIntake;\n");
  writeFileSync(join(root, "src", "pi-extension", "turn-intake.config.json"), JSON.stringify({ mode: "turn" }, null, 2));
  writeFileSync(join(root, "test", "pi-extension", "turn-intake.test.ts"), "test('turn intake', () => true);\n");
  writeFileSync(join(root, "test", "pi-extension", "retrieval.test.ts"), "test('retrieval imported neighbor', () => true);\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/pi-extension/turn-intake.ts", limit: 5 });
  const paths = result.readFirst.map((item) => item.path);
  const retrievalTest = result.readFirst.find((item) => item.path === "test/pi-extension/retrieval.test.ts");

  assert.equal(paths[0], "src/pi-extension/turn-intake.ts");
  assert.ok(paths.includes("src/pi-extension/retrieval.ts"), JSON.stringify(paths));
  assert.ok(retrievalTest, JSON.stringify(paths));
  assert.ok(retrievalTest.reasons?.some((reason) => reason.kind === "sibling_test" && reason.targetPath === "src/pi-extension/retrieval.ts"), JSON.stringify(retrievalTest));
});

test("context read-first prioritizes stem-affine importers before imported-neighbor tests", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "lib", "__tests__"), { recursive: true });

  writeFileSync(join(root, "src", "lib", "series-workbench-backtest-target.ts"), `
import { analyzeSeries } from "./series-analysis";
import { runEngine } from "./series-workbench-engine";

export function buildWorkbenchBacktestTargets() {
  return [analyzeSeries(), runEngine()];
}
`);
  writeFileSync(join(root, "src", "lib", "series-analysis.ts"), "export function analyzeSeries() { return true; }\n");
  writeFileSync(join(root, "src", "lib", "series-workbench-engine.ts"), "export function runEngine() { return true; }\n");
  writeFileSync(join(root, "src", "lib", "series-workbench-backtest.ts"), "import { buildWorkbenchBacktestTargets } from './series-workbench-backtest-target';\nexport const backtest = buildWorkbenchBacktestTargets;\n");
  writeFileSync(join(root, "src", "lib", "__tests__", "series-workbench-backtest-target.test.ts"), "test('target', () => true);\n");
  writeFileSync(join(root, "src", "lib", "__tests__", "series-analysis.test.ts"), "test('analysis', () => true);\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/lib/series-workbench-backtest-target.ts", limit: 5 });
  const paths = result.readFirst.map((item) => item.path);
  const importer = result.readFirst.find((item) => item.path === "src/lib/series-workbench-backtest.ts");

  assert.ok(paths.includes("src/lib/__tests__/series-workbench-backtest-target.test.ts"), JSON.stringify(paths));
  assert.ok(importer?.reasons?.some((reason) => reason.kind === "reverse_import"), JSON.stringify(result.readFirst));
  assert.ok(!paths.includes("src/lib/__tests__/series-analysis.test.ts"), JSON.stringify(paths));
});

test("context read-first includes Python relative imports with reasons", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "pkg"), { recursive: true });
  writeFileSync(join(root, "src", "pkg", "service.py"), `
from .db import connect_db
from . import validation


def run_service():
    return connect_db(), validation.validate()
`);
  writeFileSync(join(root, "src", "pkg", "db.py"), "def connect_db():\n    return True\n");
  writeFileSync(join(root, "src", "pkg", "db.ts"), "export const wrongLanguageDb = true;\n");
  writeFileSync(join(root, "src", "pkg", "validation.py"), "def validate():\n    return True\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/pkg/service.py", limit: 4 });

  assert.deepEqual(result.readFirst.slice(0, 3).map((item) => item.path), [
    "src/pkg/service.py",
    "src/pkg/db.py",
    "src/pkg/validation.py",
  ]);
  assert.deepEqual(result.readFirst[1]?.reasons?.map((reason) => reason.kind), ["import"]);
  assert.equal(result.readFirst[2]?.reasons?.[0]?.specifier, "./validation");
});

test("context read-first includes C++ includes and header implementation pairs with reasons", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "parser"), { recursive: true });
  writeFileSync(join(root, "src", "parser", "parser.h"), "int parse_value();\n");
  writeFileSync(join(root, "src", "parser", "parser.cpp"), `
#include "parser.h"

int parse_value() { return 1; }
`);
  writeFileSync(join(root, "src", "parser", "parser_test.cpp"), `
#include "parser.h"

int main() { return parse_value(); }
`);
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/parser/parser.h", limit: 4 });

  assert.deepEqual(result.readFirst.slice(0, 3).map((item) => item.path), [
    "src/parser/parser.h",
    "src/parser/parser.cpp",
    "src/parser/parser_test.cpp",
  ]);
  assert.ok(result.readFirst[1]?.reasons?.some((reason) => reason.kind === "implementation_pair"));
  assert.ok(result.readFirst[1]?.reasons?.some((reason) => reason.kind === "reverse_include"));
  assert.ok(result.readFirst[2]?.reasons?.some((reason) => reason.kind === "reverse_include"));
});

test("context import hints come from indexed content when target is stale", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { connectDb } from './db';\nexport const userService = connectDb;\n");
  writeFileSync(join(root, "src", "core", "db.ts"), "export function connectDb() { return true; }\n");
  writeFileSync(join(root, "src", "core", "validation.ts"), "export function validateUser() { return true; }\n");
  indexRepo({ cwd: root });
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { validateUser } from './validation';\nexport const userService = validateUser;\n");

  const result = codemapContext({ cwd: root, target: "src/core/user-service.ts", limit: 4 });
  const paths = result.readFirst.map((item) => item.path);

  const dbItem = result.readFirst.find((item) => item.path === "src/core/db.ts");
  assert.equal(result.stale, true);
  assert.ok(paths.includes("src/core/db.ts"));
  assert.equal(dbItem?.reasons?.[0]?.specifier, "./db");
  assert.ok(!paths.includes("src/core/validation.ts"));
});

test("context direct files keep later target chunks when no related files exist", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "long-context.ts"), `${Array.from({ length: 120 }, (_, index) => `export const longContextLine${index} = ${index};`).join("\n")}\n`);
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/long-context.ts", limit: 2 });

  assert.deepEqual(result.readFirst.map((item) => item.path), ["src/core/long-context.ts", "src/core/long-context.ts"]);
  assert.deepEqual(result.readFirst.map((item) => item.startLine), [1, 71]);
});

test("context read-first includes indexed local files that import the target", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "validation.ts"), "export function validateUser(id: string) { return Boolean(id); }\n");
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { validateUser } from './validation';\nexport function approveUser(id: string) { return validateUser(id); }\n");
  writeFileSync(join(root, "src", "pi-extension", "tools.ts"), "import { validateUser } from '../core/validation';\nexport const toolUsesValidation = validateUser;\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/validation.ts", limit: 4 });

  assert.deepEqual(result.readFirst.slice(0, 3).map((item) => item.path), [
    "src/core/validation.ts",
    "src/core/user-service.ts",
    "src/pi-extension/tools.ts",
  ]);
  assert.deepEqual(result.warnings, []);
});

test("graph schema stores file import edges without symbol or heuristic columns", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { connectDb } from './db';\nexport const userService = connectDb;\n");
  writeFileSync(join(root, "src", "core", "db.ts"), "export function connectDb() { return true; }\n");
  indexRepo({ cwd: root });

  const db = new DatabaseSync(getRepoInfo(root).dbPath, { readOnly: true });
  try {
    const nodeColumns = new Set((db.prepare("pragma table_info(graph_nodes)").all() as Array<{ name: string }>).map((row) => row.name));
    const edgeColumns = new Set((db.prepare("pragma table_info(graph_edges)").all() as Array<{ name: string }>).map((row) => row.name));
    assert.ok(!nodeColumns.has("symbol_id"));
    assert.ok(!edgeColumns.has("scope"));
    assert.ok(!edgeColumns.has("confidence"));
    assert.equal((db.prepare("select count(*) as count from graph_nodes where ref = 'file:src/core/db.ts' and kind = 'file'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("select count(*) as count from graph_edges where kind = 'imports' and specifier = './db'").get() as { count: number }).count, 1);
  } finally {
    db.close();
  }
});

test("reverse importer context uses graph edges when importer chunks are wiped", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "validation.ts"), "export function validateUser(id: string) { return Boolean(id); }\n");
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { validateUser } from './validation';\nexport const userService = validateUser;\n");
  indexRepo({ cwd: root });

  const db = new DatabaseSync(getRepoInfo(root).dbPath);
  try {
    db.prepare("update chunks set text = '' where file_id = (select id from files where path = ?)").run("src/core/user-service.ts");
  } finally {
    db.close();
  }

  const result = codemapContext({ cwd: root, target: "src/core/validation.ts", limit: 3 });

  assert.ok(result.readFirst.map((item) => item.path).includes("src/core/user-service.ts"), JSON.stringify(result.readFirst));
});

test("context resolves TypeScript relative .js specifiers to indexed .ts files", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "request.ts"), "export function normalizeRequest() { return true; }\n");
  writeFileSync(join(root, "src", "execution.ts"), "import { normalizeRequest } from './request.js';\nexport const execute = normalizeRequest;\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/request.ts", limit: 3 });
  const executionItem = result.readFirst.find((item) => item.path === "src/execution.ts");

  assert.ok(executionItem?.reasons?.some((reason) => reason.kind === "reverse_import" && reason.specifier === "./request.js"), JSON.stringify(result.readFirst));
});

test("graph rebuild resolves imports from unchanged files when target appears later", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { lateTarget } from './late-target';\nexport const userService = lateTarget;\n");
  indexRepo({ cwd: root });
  writeFileSync(join(root, "src", "core", "late-target.ts"), "export const lateTarget = true;\n");
  const refreshed = indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/late-target.ts", limit: 3 });

  assert.equal(refreshed.indexed, 1);
  assert.ok(result.readFirst.map((item) => item.path).includes("src/core/user-service.ts"), JSON.stringify(result.readFirst));
});

test("graph rebuild removes stale edges when imported target is deleted", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { connectDb } from './db';\nexport const userService = connectDb;\n");
  writeFileSync(join(root, "src", "core", "db.ts"), "export function connectDb() { return true; }\n");
  indexRepo({ cwd: root });
  unlinkSync(join(root, "src", "core", "db.ts"));
  const refreshed = indexRepo({ cwd: root });

  const db = new DatabaseSync(getRepoInfo(root).dbPath, { readOnly: true });
  try {
    assert.equal(refreshed.removed, 1);
    assert.equal((db.prepare("select count(*) as count from graph_edges where specifier = './db'").get() as { count: number }).count, 0);
  } finally {
    db.close();
  }
});

test("context read-first includes nearby config files with reasons", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "core", "payments"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, "src", "core", "payments", "payment-service.ts"), `
import { createGateway } from "./gateway";

export function chargeInvoice(id: string) {
  return createGateway().charge(id);
}
`);
  writeFileSync(join(root, "src", "core", "payments", "gateway.ts"), "export function createGateway() { return { charge: (id: string) => id }; }\n");
  writeFileSync(join(root, "src", "core", "payments", "payment-service.config.json"), JSON.stringify({ retries: 3, provider: "stripe" }, null, 2));
  writeFileSync(join(root, "src", "core", "payments", "payment-service.test.ts"), "import './payment-service';\n");
  writeFileSync(join(root, "docs", "payment-service.md"), "# Payment service\n\nRead src/core/payments/payment-service.ts with its config.\n");
  writeFileSync(join(root, "dist", "payment-service.config.json"), JSON.stringify({ retries: 99, noise: "build output" }, null, 2));
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/payments/payment-service.ts", limit: 6 });
  const paths = result.readFirst.map((item) => item.path);

  assert.equal(paths[0], "src/core/payments/payment-service.ts");
  assert.ok(paths.includes("src/core/payments/gateway.ts"), JSON.stringify(paths));
  assert.ok(paths.includes("src/core/payments/payment-service.config.json"), JSON.stringify(paths));
  assert.ok(paths.includes("src/core/payments/payment-service.test.ts"), JSON.stringify(paths));
  assert.ok(paths.includes("docs/payment-service.md"), JSON.stringify(paths));
  assert.ok(!paths.includes("dist/payment-service.config.json"), JSON.stringify(paths));
  assert.deepEqual(result.readFirst.find((item) => item.path === "src/core/payments/payment-service.config.json")?.reasons?.map((reason) => reason.kind), ["near_config"]);
});

test("context read-first explains same-directory and test-role neighbors", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "core", "billing"), { recursive: true });

  writeFileSync(join(root, "src", "core", "billing", "invoice-service.ts"), `
import { createGateway } from "./gateway";

export function settleInvoice(id: string) {
  return createGateway().settle(id);
}
`);
  writeFileSync(join(root, "src", "core", "billing", "gateway.ts"), "export function createGateway() { return { settle: (id: string) => id }; }\n");
  writeFileSync(join(root, "src", "core", "billing", "invoice-service.policy.ts"), "export const invoiceServicePolicy = 'standard';\n");
  writeFileSync(join(root, "src", "core", "billing", "latest-invoice-service.ts"), "export const latestInvoiceServiceNotes = true;\n");
  writeFileSync(join(root, "src", "core", "billing", "invoice-service.test.ts"), "import './invoice-service';\n");
  writeFileSync(join(root, "src", "core", "billing", "invoice-service.spec.ts"), "export const siblingSpec = true;\n");
  writeFileSync(join(root, "src", "core", "billing", "invoice-service.config.json"), JSON.stringify({ retries: 2 }, null, 2));
  writeFileSync(join(root, "docs", "invoice-service.md"), "# Invoice service\n\nBilling docs.\n");
  indexRepo({ cwd: root });

  const sourceContext = codemapContext({ cwd: root, target: "src/core/billing/invoice-service.ts" });
  const reasonKindsByPath = new Map(sourceContext.readFirst.map((item) => [item.path, item.reasons?.map((reason) => reason.kind) ?? []]));

  assert.equal(sourceContext.readFirst[0]?.path, "src/core/billing/invoice-service.ts");
  assert.ok(reasonKindsByPath.get("src/core/billing/invoice-service.policy.ts")?.includes("same_dir"), JSON.stringify(sourceContext.readFirst));
  assert.ok(reasonKindsByPath.get("src/core/billing/invoice-service.test.ts")?.includes("reverse_test"), JSON.stringify(sourceContext.readFirst));
  assert.ok(reasonKindsByPath.get("src/core/billing/invoice-service.spec.ts")?.includes("sibling_test"), JSON.stringify(sourceContext.readFirst));
  assert.ok(!reasonKindsByPath.get("src/core/billing/latest-invoice-service.ts")?.includes("sibling_test"), JSON.stringify(sourceContext.readFirst));

  const testContext = codemapContext({ cwd: root, target: "src/core/billing/invoice-service.test.ts", limit: 3 });
  const sourceUnderTest = testContext.readFirst.find((item) => item.path === "src/core/billing/invoice-service.ts");
  assert.ok(sourceUnderTest?.reasons?.some((reason) => reason.kind === "test_of"), JSON.stringify(testContext.readFirst));
});

test("context read-first links route adapters with convention-named handlers", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "server"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro", "route.ts"), `
export async function GET() {
  return Response.json({ status: "newsletter macro endpoint ready" });
}
`);
  writeFileSync(join(root, "apps", "web", "src", "server", "newsletter-macro-handler.ts"), `
export function buildNewsletterMacroResponse() {
  return { status: "newsletter macro handler ready" };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "server", "newsletter-macro-handler.test.ts"), "import './newsletter-macro-handler';\n");
  writeFileSync(join(root, "apps", "web", "src", "server", "macro-cleanup-handler.ts"), "export const unrelatedHandler = true;\n");
  indexRepo({ cwd: root });

  const routeContext = codemapContext({ cwd: root, target: "apps/web/src/app/api/newsletter/macro/route.ts", limit: 5 });
  const routePaths = routeContext.readFirst.map((item) => item.path);
  const handler = routeContext.readFirst.find((item) => item.path === "apps/web/src/server/newsletter-macro-handler.ts");
  const handlerTest = routeContext.readFirst.find((item) => item.path === "apps/web/src/server/newsletter-macro-handler.test.ts");

  assert.equal(routePaths[0], "apps/web/src/app/api/newsletter/macro/route.ts");
  assert.ok(handler?.reasons?.some((reason) => reason.kind === "implementation_pair"), JSON.stringify(routeContext.readFirst));
  assert.ok(handlerTest?.reasons?.some((reason) => reason.kind === "sibling_test" && reason.targetPath === "apps/web/src/server/newsletter-macro-handler.ts"), JSON.stringify(routeContext.readFirst));
  assert.ok(!routePaths.includes("apps/web/src/server/macro-cleanup-handler.ts"), JSON.stringify(routePaths));

  const handlerContext = codemapContext({ cwd: root, target: "apps/web/src/server/newsletter-macro-handler.ts", limit: 4 });
  assert.ok(handlerContext.readFirst.find((item) => item.path === "apps/web/src/app/api/newsletter/macro/route.ts")?.reasons?.some((reason) => reason.kind === "implementation_pair"), JSON.stringify(handlerContext.readFirst));
});

test("context read-first includes same-directory source before extra target chunks at default limit", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "isolated-widget.ts"), `${Array.from({ length: 90 }, (_, index) => `export const isolatedWidgetLine${index} = ${index};`).join("\n")}\n`);
  writeFileSync(join(root, "src", "core", "isolated-widget.policy.ts"), "export const isolatedWidgetPolicy = true;\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/isolated-widget.ts" });
  const sameDirItem = result.readFirst.find((item) => item.path === "src/core/isolated-widget.policy.ts");

  assert.ok(sameDirItem?.reasons?.some((reason) => reason.kind === "same_dir"), JSON.stringify(result.readFirst));
});

test("context read-first excludes noisy generated and lockfile neighbors", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "__generated__"), { recursive: true });
  mkdirSync(join(root, "data"), { recursive: true });
  writeFileSync(join(root, "src", "feature.ts"), `
import lockData from "../package-lock.json";
import catalogData from "../data/catalog.json";
import { generatedClient } from "./__generated__/client";
export const feature = generatedClient + String(lockData) + String(catalogData);
`);
  writeFileSync(join(root, "src", "__generated__", "client.ts"), `
import { feature } from "../feature";
export const generatedClient = String(feature);
`);
  writeFileSync(join(root, "src", "feature.test.ts"), `
import { feature } from "./feature";
test("feature", () => feature);
`);
  writeFileSync(join(root, "data", "catalog.json"), JSON.stringify({ rows: Array.from({ length: 1500 }, (_, index) => ({ index, text: "feature catalog data" })) }, null, 2));
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/feature.ts", limit: 6 });
  const paths = result.readFirst.map((item) => item.path);
  assert.equal(paths[0], "src/feature.ts");
  assert.ok(paths.includes("src/feature.test.ts"), JSON.stringify(paths));
  assert.ok(!paths.includes("src/__generated__/client.ts"), JSON.stringify(paths));
  assert.ok(!paths.includes("package-lock.json"), JSON.stringify(paths));
  assert.ok(!paths.includes("data/catalog.json"), JSON.stringify(paths));
});

test("context read-first excludes imported files outside pathPrefix", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-context-import-prefix-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "packages", "billing", "src"), { recursive: true });
  mkdirSync(join(root, "packages", "shared"), { recursive: true });

  writeFileSync(join(root, "packages", "billing", "src", "invoice-service.ts"), "import { sharedLogger } from '../../shared/logger';\nexport const invoiceService = sharedLogger;\n");
  writeFileSync(join(root, "packages", "shared", "logger.ts"), "export const sharedLogger = true;\n");
  writeFileSync(join(root, "packages", "shared", "consumer.ts"), "import { invoiceService } from '../billing/src/invoice-service';\nexport const consumer = invoiceService;\n");
  indexRepo({ cwd: root, approve: true });

  const result = codemapContext({ cwd: root, target: "invoice-service.ts", pathPrefix: "packages/billing", limit: 4 });

  assert.deepEqual(result.readFirst.map((item) => item.path), ["packages/billing/src/invoice-service.ts"]);
  assert.ok(result.readFirst.every((item) => item.path.startsWith("packages/billing/")));
});

test("context read-first locality includes nested sibling tests and docs within pathPrefix", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-context-locality-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "packages", "billing", "src"), { recursive: true });
  mkdirSync(join(root, "packages", "billing", "docs"), { recursive: true });
  mkdirSync(join(root, "packages", "billing", "archive"), { recursive: true });
  mkdirSync(join(root, "packages", "web", "src"), { recursive: true });
  mkdirSync(join(root, "packages", "web", "docs"), { recursive: true });

  writeFileSync(join(root, "packages", "billing", "src", "invoice-service.ts"), `${Array.from({ length: 90 }, (_, index) => `export const invoiceLine${index} = ${index};`).join("\n")}\n`);
  writeFileSync(join(root, "packages", "billing", "src", "invoice-service.test.ts"), "import './invoice-service';\n");
  writeFileSync(join(root, "packages", "billing", "docs", "invoice-service.md"), "# Invoice service\n\nBilling invoice docs.\n");
  writeFileSync(join(root, "packages", "billing", "archive", "invoice-service.test.ts"), "import '../src/invoice-service';\n");
  writeFileSync(join(root, "packages", "web", "src", "invoice-service.test.ts"), "import './invoice-service';\n");
  writeFileSync(join(root, "packages", "web", "docs", "invoice-service.md"), "# Web invoice docs\n");
  indexRepo({ cwd: root, approve: true });

  const result = codemapContext({ cwd: root, target: "invoice-service.ts", pathPrefix: "packages/billing", limit: 6 });
  const readFirstPaths = [...new Set(result.readFirst.map((item) => item.path))];

  assert.deepEqual(result.readFirst.slice(0, 3).map((item) => item.path), [
    "packages/billing/src/invoice-service.ts",
    "packages/billing/src/invoice-service.test.ts",
    "packages/billing/docs/invoice-service.md",
  ]);
  assert.deepEqual(readFirstPaths.slice(0, 3), [
    "packages/billing/src/invoice-service.ts",
    "packages/billing/src/invoice-service.test.ts",
    "packages/billing/docs/invoice-service.md",
  ]);
  assert.deepEqual(result.relatedTests, [
    "packages/billing/src/invoice-service.test.ts",
    "packages/billing/archive/invoice-service.test.ts",
  ]);
  assert.deepEqual(result.relatedDocs, ["packages/billing/docs/invoice-service.md"]);
  assert.ok(result.readFirst.every((item) => item.path.startsWith("packages/billing/")));
  assert.deepEqual(result.warnings, []);
});

test("safety skips secrets, generated files, heavy directories, binary files, large files, and symlinks", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-safety-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(root, "src", "allowed.ts"), "export const allowedNeedle = true;\n");
  writeFileSync(join(root, ".env"), "SUPER_SKIPPED_NEEDLE=1\n");
  writeFileSync(join(root, "private-key.ts"), "export const superSkippedNeedle = true;\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ superSkippedNeedle: true }));
  writeFileSync(join(root, "bundle.min.js"), "const superSkippedNeedle=true;");
  writeFileSync(join(root, "binary.txt"), Buffer.from("superSkippedNeedle\0"));
  writeFileSync(join(root, "huge.txt"), `${"x".repeat(1_000_001)}superSkippedNeedle`);
  writeFileSync(join(root, "ignored.txt"), "superSkippedNeedle\n");
  writeFileSync(join(root, "node_modules", "dep", "index.ts"), "export const superSkippedNeedle = true;\n");
  writeFileSync(join(root, "dist", "bundle.ts"), "export const superSkippedNeedle = true;\n");
  try {
    symlinkSync(join(root, "src", "allowed.ts"), join(root, "linked.ts"));
  } catch {
    // Some platforms disallow symlink creation; the rest of the safety policy is still testable.
  }

  const result = indexRepo({ cwd: root, approve: true });
  assert.equal(searchCodeMap({ cwd: root, query: "allowedNeedle", limit: 5 })[0]?.path, "src/allowed.ts");
  assert.deepEqual(searchCodeMap({ cwd: root, query: "superSkippedNeedle", limit: 5 }), []);
  assert.ok((result.skippedReasons["secret-like file"] ?? 0) >= 2);
  assert.ok((result.skippedReasons["binary/generated extension"] ?? 0) >= 1);
  assert.ok((result.skippedReasons["ignored directory"] ?? 0) >= 2);
  assert.ok((result.skippedReasons[".gitignore"] ?? 0) >= 1);
  assert.ok((result.skippedReasons["binary content"] ?? 0) >= 1);
  assert.ok((result.skippedReasons["too large"] ?? 0) >= 1);
  if (existsSync(join(root, "linked.ts"))) assert.ok((result.skippedReasons.symlink ?? 0) >= 1);
});

test("codemapignore and expanded default ignores suppress dependency/cache noise", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-ignore-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, ".venv", "lib", "python3.14", "site-packages"), { recursive: true });
  mkdirSync(join(root, ".pytest_cache"), { recursive: true });
  mkdirSync(join(root, "generated"), { recursive: true });

  writeFileSync(join(root, ".codemapignore"), "generated/\n*.fixture.ts\n");
  writeFileSync(join(root, "src", "allowed.ts"), "export const durableSourceNeedle = true;\n");
  writeFileSync(join(root, ".venv", "lib", "python3.14", "site-packages", "dep.py"), "dependencyNoiseNeedle = True\n");
  writeFileSync(join(root, ".pytest_cache", "cache.txt"), "dependencyNoiseNeedle\n");
  writeFileSync(join(root, "generated", "out.ts"), "export const dependencyNoiseNeedle = true;\n");
  writeFileSync(join(root, "src", "ignored.fixture.ts"), "export const dependencyNoiseNeedle = true;\n");

  const result = indexRepo({ cwd: root, approve: true });
  assert.equal(searchCodeMap({ cwd: root, query: "durableSourceNeedle", limit: 5 })[0]?.path, "src/allowed.ts");
  assert.deepEqual(searchCodeMap({ cwd: root, query: "dependencyNoiseNeedle", limit: 5 }), []);
  assert.ok((result.skippedReasons["ignored directory"] ?? 0) >= 2);
  assert.ok((result.skippedReasons[".codemapignore"] ?? 0) >= 2);
});

test("pathPrefix scopes indexing, status, search, context, and deletions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "services", "api"), { recursive: true });
  mkdirSync(join(root, "services", "web"), { recursive: true });

  writeFileSync(join(root, "services", "api", "handler.ts"), "export function apiOnlyNeedle() { return true; }\n");
  writeFileSync(join(root, "services", "web", "handler.ts"), "export function webOnlyNeedle() { return true; }\n");

  const scoped = indexRepo({ cwd: root, approve: true, pathPrefix: "services/api" });
  assert.equal(scoped.pathPrefix, "services/api/");
  assert.equal(scoped.scanned, 1);
  assert.equal(searchCodeMap({ cwd: root, query: "apiOnlyNeedle", limit: 5 })[0]?.path, "services/api/handler.ts");
  assert.deepEqual(searchCodeMap({ cwd: root, query: "webOnlyNeedle", limit: 5 }), []);
  assert.deepEqual(searchCodeMap({ cwd: root, query: "apiOnlyNeedle", pathPrefix: "services/web", limit: 5 }), []);
  assert.equal(status(root, { health: "full", pathPrefix: "services/api" }).files, 1);
  assert.equal((codemapContext({ cwd: root, target: "handler.ts", pathPrefix: "services/api" }).readFirst[0] as { path: string }).path, "services/api/handler.ts");

  indexRepo({ cwd: root });
  assert.equal(searchCodeMap({ cwd: root, query: "webOnlyNeedle", limit: 5 })[0]?.path, "services/web/handler.ts");
  unlinkSync(join(root, "services", "api", "handler.ts"));
  const refreshed = indexRepo({ cwd: root, pathPrefix: "services/api" });
  assert.equal(refreshed.removed, 1);
  assert.equal(searchCodeMap({ cwd: root, query: "webOnlyNeedle", limit: 5 })[0]?.path, "services/web/handler.ts");
});

test("pathPrefix normalizes internal dot-dot segments consistently", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-dotdot-prefix-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, "src", "app.ts"), "export function srcNeedle() { return true; }\n");
  writeFileSync(join(root, "docs", "guide.md"), "# Guide\n\ncanonical docs needle\n");

  const scoped = indexRepo({ cwd: root, approve: true, pathPrefix: "src/../docs" });
  assert.equal(scoped.pathPrefix, "docs/");
  assert.equal(scoped.scanned, 1);
  assert.equal(status(root, { health: "full", pathPrefix: "src/../docs" }).files, 1);
  assert.equal(searchCodeMap({ cwd: root, query: "canonical docs needle", pathPrefix: "src/../docs", limit: 5 })[0]?.path, "docs/guide.md");
  assert.equal((codemapContext({ cwd: root, target: "guide.md", pathPrefix: "src/../docs" }).readFirst[0] as { path: string }).path, "docs/guide.md");

  indexRepo({ cwd: root });
  unlinkSync(join(root, "docs", "guide.md"));
  const refreshed = indexRepo({ cwd: root, pathPrefix: "src/../docs" });
  assert.equal(refreshed.pathPrefix, "docs/");
  assert.equal(refreshed.removed, 1);
  assert.equal(searchCodeMap({ cwd: root, query: "srcNeedle", limit: 5 })[0]?.path, "src/app.ts");
});

test("index refreshes only changed files and removes deleted files", (t) => {
  const root = fixtureRepo(t);
  assert.equal(indexRepo({ cwd: root }).indexed, 0);

  writeFileSync(join(root, "src", "core", "user-service.ts"), `
export function changedUserFlow(id: string) {
  return { id, status: "changed" };
}
`);
  const changed = indexRepo({ cwd: root });
  assert.equal(changed.indexed, 1);
  assert.equal(searchCodeMap({ cwd: root, query: "changedUserFlow", limit: 5 })[0]?.path, "src/core/user-service.ts");
  assert.deepEqual(searchCodeMap({ cwd: root, query: "approveUser", limit: 5 }), []);

  unlinkSync(join(root, "src", "core", "numeric.ts"));
  const removed = indexRepo({ cwd: root });
  assert.equal(removed.removed, 1);
  assert.deepEqual(searchCodeMap({ cwd: root, query: "404", limit: 5 }), []);
});

test("status reports unapproved repos as not ready", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-unapproved-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });

  const result = status(root, { health: "cheap" });

  assert.equal(result.approved, false);
  assert.equal(result.indexed, false);
  assert.equal(result.readiness, "not_approved");
});

test("full status reports dirty files before the first commit without stale warnings", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-unborn-dirty-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  writeFileSync(join(root, "untracked.ts"), "export const unbornDirtyStatus = true;\n");
  indexRepo({ cwd: root, approve: true });

  const result = status(root, { health: "full" });

  assert.equal(result.currentHead, null);
  assert.equal(result.indexedHead, null);
  assert.equal(result.dirty, true);
  assert.deepEqual(result.dirtyFiles.map((file) => [file.path, file.status]), [["untracked.ts", "untracked"]]);
  assert.equal(result.stale, false);
  assert.deepEqual(result.warnings, []);
});

test("cheap status avoids stale scan while full status reports drift", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "cheap-status-added.ts"), `
export function cheapStatusAdded() {
  return true;
}
`);

  const cheap = status(root, { health: "cheap" });
  assert.equal(cheap.health, "cheap");
  assert.equal(cheap.stale, false);
  assert.equal(cheap.missing, 0);
  assert.deepEqual(cheap.warnings, []);

  const full = status(root, { health: "full" });
  assert.equal(full.health, "full");
  assert.equal(full.stale, true);
  assert.equal(full.missing, 1);
  assert.match(full.warnings.join("\n"), /Index stale/);
});
