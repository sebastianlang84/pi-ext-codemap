import assert from "node:assert/strict";
import test from "node:test";

const { planQuery } = await import("../src/core/query-plan.ts");
const { scoreSearchRow, topHitConfidence } = await import("../src/core/ranking.ts");

const scored = (scores: number[]) => scores.map((score, index) => ({ score, path: `f${index}.ts`, startLine: 1 } as never));

test("topHitConfidence flags a bunched top cluster as low", () => {
  // Real scores from the macrolens wrong-anchor regressor: the top hit (regime-score.ts) barely
  // edges out rank 2, so anchoring codemap_context on it is unsafe — the routing eval's scenario D.
  const regressor = topHitConfidence(scored([28.091, 27.818, 27.273, 27.273, 27.0]));
  assert.equal(regressor.level, "low");
  assert.ok(regressor.margin < 0.02, `margin ${regressor.margin}`);
});

test("topHitConfidence marks a clear leader high and handles small result sets", () => {
  assert.equal(topHitConfidence(scored([40, 20, 10])).level, "high");
  assert.equal(topHitConfidence(scored([25])).level, "single");
  assert.equal(topHitConfidence(scored([])).level, "none");
});

test("generic implementation role intent does not imply main entrypoint intent", () => {
  assert.deepEqual(planQuery("memory retrieval implementation").roleIntents, ["implementation"]);
  assert.deepEqual(planQuery("where is the main implementation?").roleIntents, ["implementation", "implementation/main"]);
  const longPlan = planQuery("buildTurnIntake implementation Use memory_search if prior context matters no relevant stored context");
  assert.ok(longPlan.coreTerms.includes("relevant"), JSON.stringify(longPlan.coreTerms));
  assert.ok(longPlan.coreTerms.includes("stored"), JSON.stringify(longPlan.coreTerms));
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

test("text-covered source chunks outrank weak signature-only symbol hits", () => {
  const plan = planQuery("market regime cards show neutral tone at threshold values for VIX oil CPI payrolls yield curve and credit");
  const weakSymbolDiagnostics = scoreSearchRow({
    path: "apps/web/src/lib/regime-score.ts",
    language: "typescript",
    startLine: 100,
    endLine: 100,
    kind: "function",
    text: "function volatilitySub(vix: number): number",
    rank: -1,
    size: 10_000,
    symbolName: "volatilitySub",
  }, plan, 12);
  const sourceChunkDiagnostics = scoreSearchRow({
    path: "apps/web/src/lib/macro-signal-rules.ts",
    language: "typescript",
    startLine: 120,
    endLine: 180,
    kind: "text",
    text: "market cards show a neutral tone at threshold values for VIX and oil",
    rank: -1,
    size: 10_000,
    symbolName: null,
  }, plan, 9);

  assert.ok(sourceChunkDiagnostics.tokenCoverage > weakSymbolDiagnostics.tokenCoverage, JSON.stringify({ sourceChunkDiagnostics, weakSymbolDiagnostics }));
  assert.ok(sourceChunkDiagnostics.finalScore > weakSymbolDiagnostics.finalScore, JSON.stringify({ sourceChunkDiagnostics, weakSymbolDiagnostics }));
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

test("phantom FTS credit removed: non-FTS candidates earn no ftsScore", () => {
  // A real FTS match returns a negative bm25 rank; non-FTS retrieval sources (path/basename/
  // endpoint/role_intent) use `0 as rank` as a sentinel. That sentinel must earn no FTS credit —
  // previously it got the full FTS_MATCH_BASE (10), inflating role-intent README candidates and
  // flooding conceptual queries with docs. See the doc-flood ADR.
  const plan = planQuery("project overview");
  const row = {
    path: "README.md",
    language: "markdown",
    startLine: 1,
    endLine: 1,
    kind: "file" as const,
    text: "# Project\n\nAn overview of the project.",
    symbolName: null,
  };
  const nonFts = scoreSearchRow({ ...row, rank: 0 }, plan, 18);
  const ftsMatch = scoreSearchRow({ ...row, rank: -1 }, plan, 18);
  assert.equal(nonFts.ftsScore, 0);
  // A real bm25 match earns the base (10) plus the saturated magnitude bonus (5).
  assert.equal(ftsMatch.ftsScore, 15);
});

test("overview role intent fires only on doc-evidence, not on a role-word mixed with identifiers", () => {
  // "overview" is also a UI section/tab name; mixed with concrete identifier terms it is a
  // code/UI-navigation query, not a request for overview docs (doc-flood ADR).
  assert.ok(!planQuery("Overview tab Stock Identity Location cards part detail").roleIntents.includes("overview"));
  assert.ok(!planQuery("overview panel stock identity location").roleIntents.includes("overview"));
  // Doc-evidence keeps overview docs findable.
  assert.ok(planQuery("what is this project about").roleIntents.includes("overview"));
  assert.ok(planQuery("project overview").roleIntents.includes("overview"));
  assert.ok(planQuery("what is the purpose of this project").roleIntents.includes("overview"));
});

test("code lift prefers source on code/UI queries, is suppressed on doc-intent and noise", () => {
  const source = {
    path: "frontend/src/app/parts/[id]/page.tsx",
    language: "typescript",
    startLine: 1,
    endLine: 5,
    kind: "function" as const,
    text: "function PartDetailContent() { return null; }",
    symbolName: "PartDetailContent",
  };
  // UI-navigation query (no doc role intent): source earns the lift (+2 code, +4 src).
  const uiPlan = planQuery("Overview tab Stock Identity Location cards part detail");
  assert.equal(scoreSearchRow({ ...source, rank: -1 }, uiPlan, 12).codeIntentBoost, 6);
  // Doc-intent query: lift suppressed so canonical docs stay the top hit.
  const docPlan = planQuery("what is this project about");
  assert.equal(scoreSearchRow({ ...source, rank: -1 }, docPlan, 12).codeIntentBoost, 0);
  // Noise source (generated): never lifted, or the +6 could cancel the noise penalty.
  const generated = { ...source, path: "src/__generated__/client.ts", symbolName: "generatedClient" };
  assert.equal(scoreSearchRow({ ...generated, rank: -1 }, uiPlan, 12).codeIntentBoost, 0);
});
