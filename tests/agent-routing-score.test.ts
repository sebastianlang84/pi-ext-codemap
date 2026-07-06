import assert from "node:assert/strict";
import test from "node:test";

import { runRoutingEval, scoreEpisode, type RoutingEpisode, type ToolCall } from "../scripts/eval-agent-routing.ts";

const search = (args: Record<string, unknown> = {}): ToolCall => ({ name: "codemap_search", args });
const context = (target: string): ToolCall => ({ name: "codemap_context", args: { target } });
const grep = (): ToolCall => ({ name: "bash", args: { command: "grep -r foo ." } });

const episode = (scenario: RoutingEpisode["scenario"], extra: Partial<RoutingEpisode> = {}): RoutingEpisode =>
  ({ id: scenario, repo: "macrolens", scenario, prompt: "p", ...extra });

test("scenario A: codemap_search first passes; raw search first fails", () => {
  assert.equal(scoreEpisode(episode("A_plain_navigation"), [search(), context("a.ts")]).pass, true);
  assert.equal(scoreEpisode(episode("A_plain_navigation"), [grep(), search()]).pass, false);
  assert.equal(scoreEpisode(episode("A_plain_navigation"), []).pass, false);
});

test("scenario B: re-query before context passes; jumping to context fails", () => {
  assert.equal(scoreEpisode(episode("B_seeded_miss"), [search({ query: "x", limit: 5 }), search({ query: "y" })]).pass, true);
  assert.equal(scoreEpisode(episode("B_seeded_miss"), [search({ query: "x", limit: 5 }), search({ query: "x", limit: 10 })]).pass, true);
  assert.equal(scoreEpisode(episode("B_seeded_miss"), [search({ query: "x" }), context("a.ts"), search({ query: "y" })]).pass, false);
  assert.equal(scoreEpisode(episode("B_seeded_miss"), [search({ query: "x" })]).pass, false);
});

test("scenario C: path/symbol target passes; prose query target fails", () => {
  assert.equal(scoreEpisode(episode("C_confident_anchor"), [context("src/lib/finra.ts")]).pass, true);
  assert.equal(scoreEpisode(episode("C_confident_anchor"), [context("parseFinraWorksheet")]).pass, true);
  assert.equal(scoreEpisode(episode("C_confident_anchor"), [context("where finra parsing happens")]).pass, false);
});

test("scenario D: avoiding the low-confidence hit passes; anchoring on it fails", () => {
  const ep = episode("D_wrong_top_hit", { lowConfidenceTopPath: "apps/web/src/lib/regime-score.ts" });
  assert.equal(scoreEpisode(ep, [search(), search({ query: "macro signal rules" })]).pass, true);
  assert.equal(scoreEpisode(ep, [search(), context("apps/web/src/lib/macro-signal-rules.ts")]).pass, true);
  assert.equal(scoreEpisode(ep, [search(), context("apps/web/src/lib/regime-score.ts")]).pass, false);
  assert.equal(scoreEpisode(ep, [search(), context("regime-score.ts")]).pass, false); // basename match
});

test("runRoutingEval aggregates pass rates per scenario", async () => {
  const episodes = [episode("A_plain_navigation"), episode("D_wrong_top_hit", { lowConfidenceTopPath: "x.ts" })];
  const driver = async (ep: RoutingEpisode): Promise<ToolCall[]> =>
    ep.scenario === "A_plain_navigation" ? [search()] : [context("x.ts")];
  const result = await runRoutingEval(episodes, driver, 2);
  assert.equal(result.byScenario.A_plain_navigation.rate, 1);
  assert.equal(result.byScenario.D_wrong_top_hit.rate, 0);
  assert.equal(result.scores.length, 4);
});
