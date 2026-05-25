import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { registerCodeMapTools } from "../src/pi-extension/tools.ts";
import {
  buildTokenInjectionReport,
  defaultTokenInjectionBudgets,
  evaluateTokenInjectionBudget,
  formatTokenInjectionBudgetFailure,
} from "../scripts/check-token-injection.ts";

test("registered CodeMap tools stay within token injection budgets", () => {
  const tools: Array<{ name: string; description?: string; promptSnippet?: string; promptGuidelines?: string[]; parameters?: unknown }> = [];
  registerCodeMapTools({ registerTool: (tool: { name: string; description?: string; promptSnippet?: string; promptGuidelines?: string[]; parameters?: unknown }) => tools.push(tool) } as never);

  const report = buildTokenInjectionReport(tools);
  const gate = evaluateTokenInjectionBudget(report, defaultTokenInjectionBudgets);

  assert.deepEqual(report.tools.map((tool) => tool.name).sort(), [
    "codemap_context",
    "codemap_index",
    "codemap_search",
    "codemap_status",
  ]);
  for (const tool of report.tools) {
    assert.ok(tool.fields.description.tokens > 0, `${tool.name} should count description tokens`);
    assert.ok(tool.fields.parameters.tokens > 0, `${tool.name} should count parameter-schema tokens`);
    assert.ok(tool.fields.promptGuidelines.tokens > 0, `${tool.name} should count promptGuidelines tokens`);
    assert.ok(tool.fields.promptSnippet.tokens > 0, `${tool.name} should count promptSnippet tokens`);
  }
  assert.equal(gate.passed, true, formatTokenInjectionBudgetFailure(report, gate.issues));
});

test("token-injection checker emits a machine-readable budget report", () => {
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "scripts/check-token-injection.ts", "--budget-gate"], { encoding: "utf8" });
  const report = JSON.parse(output) as { gate?: { passed?: boolean }; tools?: Array<{ name?: string; total?: { tokens?: number } }>; totals?: { tokens?: number } };

  assert.equal(report.gate?.passed, true);
  assert.equal(report.tools?.length, 4);
  assert.ok((report.totals?.tokens ?? 0) > 0);
  assert.ok(report.tools?.every((tool) => typeof tool.name === "string" && (tool.total?.tokens ?? 0) > 0));
});
