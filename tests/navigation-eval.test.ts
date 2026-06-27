import assert from "node:assert/strict";
import test from "node:test";

import {
  assessNavigationCase,
  deltaMetrics,
  queryTerms,
  summarizeModeMetrics,
  type BaseNavigationCaseMetrics,
} from "../src/core/navigation-eval.ts";

test("navigation eval assesses expected context, duplicates, forbidden reads, and misses", () => {
  const assessment = assessNavigationCase({
    query: "registerMemoryTools empty result hints",
    entry: "src/pi-extension/tools.ts",
    requiredContext: ["test/pi-extension/tools.test.ts", "src/pi-extension/formatters.ts"],
    forbidden: ["package-lock.json"],
    missHints: { "src/pi-extension/formatters.ts": "query_formulation" },
    indexStale: false,
    filesRead: ["src/pi-extension/tools.ts", "package-lock.json", "src/pi-extension/tools.ts"],
  });

  assert.deepEqual(assessment.uniqueFilesRead, ["src/pi-extension/tools.ts", "package-lock.json"]);
  assert.equal(assessment.expectedFiles, 3);
  assert.equal(assessment.foundExpectedFiles, 1);
  assert.equal(assessment.expectedRecall, 0.333);
  assert.equal(assessment.entryFound, true);
  assert.deepEqual(assessment.missingContext, ["test/pi-extension/tools.test.ts", "src/pi-extension/formatters.ts"]);
  assert.equal(assessment.contextRecall, 0);
  assert.deepEqual(assessment.forbiddenRead, ["package-lock.json"]);
  assert.equal(assessment.success, false);
  assert.deepEqual(assessment.misses.map((item) => [item.kind, item.class, item.file]), [
    ["forbidden_read", "noise", "package-lock.json"],
    ["missing_expected", "convention", "test/pi-extension/tools.test.ts"],
    ["missing_expected", "query_formulation", "src/pi-extension/formatters.ts"],
  ]);
});

test("navigation eval summarizes mode metrics and deltas with stable rounding", () => {
  const cases: BaseNavigationCaseMetrics[] = [
    {
      mode: "codemap_search_context",
      success: true,
      entryFound: true,
      expectedRecall: 1,
      contextRecall: 1,
      filesRead: ["src/a.ts", "src/a.test.ts"],
      toolCalls: 2,
      forbiddenRead: [],
      latencyMs: 10,
      misses: [],
    },
    {
      mode: "codemap_search_context",
      success: false,
      entryFound: true,
      expectedRecall: 0.5,
      contextRecall: 0,
      filesRead: ["src/b.ts"],
      toolCalls: 2,
      forbiddenRead: ["package-lock.json"],
      latencyMs: 20,
      misses: [],
    },
  ];

  const summary = summarizeModeMetrics("codemap_search_context", cases);

  assert.equal(summary.tasks, 2);
  assert.equal(summary.successRate, 0.5);
  assert.equal(summary.entryHitRate, 1);
  assert.equal(summary.avgExpectedRecall, 0.75);
  assert.equal(summary.avgContextRecall, 0.5);
  assert.equal(summary.avgFilesRead, 1.5);
  assert.equal(summary.avgToolCalls, 2);
  assert.equal(summary.forbiddenReadRate, 0.5);
  assert.equal(summary.avgLatencyMs, 15);
  assert.equal(summary.p95LatencyMs, 20);

  assert.deepEqual(deltaMetrics(summary, { ...summary, successRate: 0.25, avgContextRecall: 0.25, avgFilesRead: 1, avgToolCalls: 1 }), {
    successRate: 0.25,
    avgExpectedRecall: 0,
    avgContextRecall: 0.25,
    avgFilesRead: 0.5,
    avgToolCalls: 1,
  });
});

test("navigation eval query terms can preserve legacy terms or normalize code paths", () => {
  assert.deepEqual(queryTerms("buildWorkbenchBacktestTargets implementation"), ["buildworkbenchbacktesttargets", "implementation"]);
  assert.deepEqual(queryTerms("src/pi-extension/audit.ts", { normalize: true }), ["src", "pi", "extension", "audit", "ts"]);
});
