import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

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
