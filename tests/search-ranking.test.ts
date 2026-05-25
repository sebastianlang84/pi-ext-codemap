import assert from "node:assert/strict";
import test from "node:test";

const { planQuery } = await import("../src/core/query-plan.ts");
const { scoreSearchRow } = await import("../src/core/ranking.ts");

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
