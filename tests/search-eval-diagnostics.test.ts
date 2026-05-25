import assert from "node:assert/strict";
import test from "node:test";

const { explainNavigationMisses, summarizeNavigationMissReasons } = await import("../src/core/eval-navigation-diagnostics.ts");
const { classifyMisses, summarizeMissTaxonomy } = await import("../src/core/eval-miss-taxonomy.ts");

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
