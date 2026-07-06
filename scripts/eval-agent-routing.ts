#!/usr/bin/env node
// Routing eval — measures whether the CodeMap tool surface steers an agent's TOOL CHOICE, not the
// retrieval mechanism (that is eval-real-repo-navigation.ts). Design + episode rationale live in
// ../../autoresearch/experiments/agent-routing.episodes.md.
//
// This file is the reusable, tested core: episode types + the per-scenario predicate scorer + a
// runner that consumes any AgentDriver. The one remaining integration is the live driver — a headless
// agent (claude -p / pi headless) with the CodeMap MCP server wired, returning its tool-call
// transcript. Everything below is exercised by tests/agent-routing-score.test.ts against a mock driver.

export type RoutingScenario = "A_plain_navigation" | "B_seeded_miss" | "C_confident_anchor" | "D_wrong_top_hit";

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface RoutingEpisode {
  id: string;
  repo: string;
  scenario: RoutingScenario;
  prompt: string;
  /** For D only: the low-confidence top hit the agent must NOT anchor codemap_context on. */
  lowConfidenceTopPath?: string;
}

export interface EpisodeScore {
  id: string;
  scenario: RoutingScenario;
  pass: boolean;
  reason: string;
}

/** A driver runs one episode against a real agent and returns the ordered tool calls it made. */
export type AgentDriver = (episode: RoutingEpisode) => Promise<ToolCall[]>;

const isSearch = (call: ToolCall) => call.name === "codemap_search";
const isContext = (call: ToolCall) => call.name === "codemap_context";

// A raw filesystem search the agent should have replaced with codemap_search.
function isRawSearch(call: ToolCall): boolean {
  if (["grep", "rg", "ripgrep", "find", "glob", "search_files"].includes(call.name)) return true;
  if (call.name === "bash" || call.name === "shell") {
    const command = String(call.args.command ?? "");
    return /(^|\s|\|)(grep|rg|ag|find)\b/.test(command);
  }
  return false;
}

function targetOf(call: ToolCall): string {
  return String(call.args.target ?? call.args.query ?? "");
}

// A path or symbol (safe codemap_context target) vs a broad prose query (unsafe).
function looksLikePathOrSymbol(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (/\s/.test(trimmed)) return false; // multi-word => prose query
  return trimmed.includes("/") || /\.[a-z]{1,5}$/i.test(trimmed) || /^[A-Za-z_$][\w$.]*$/.test(trimmed);
}

function samePath(a: string, b: string): boolean {
  const base = (p: string) => p.trim().split("/").pop() ?? p.trim();
  return a.trim() === b.trim() || base(a) === base(b);
}

export function scoreEpisode(episode: RoutingEpisode, transcript: ToolCall[]): EpisodeScore {
  const verdict = (pass: boolean, reason: string): EpisodeScore => ({ id: episode.id, scenario: episode.scenario, pass, reason });
  const firstCodemapIdx = transcript.findIndex((call) => isSearch(call) || isContext(call));
  const firstSearchIdx = transcript.findIndex(isSearch);
  const firstContextIdx = transcript.findIndex(isContext);

  switch (episode.scenario) {
    case "A_plain_navigation": {
      if (firstCodemapIdx === -1) return verdict(false, "no CodeMap tool used");
      if (!isSearch(transcript[firstCodemapIdx])) return verdict(false, "first CodeMap call was not codemap_search");
      const rawBefore = transcript.slice(0, firstCodemapIdx).some(isRawSearch);
      return verdict(!rawBefore, rawBefore ? "used grep/find before codemap_search" : "codemap_search first, no raw search before it");
    }
    case "B_seeded_miss": {
      if (firstSearchIdx === -1) return verdict(false, "never called codemap_search");
      const first = transcript[firstSearchIdx];
      const secondSearchIdx = transcript.findIndex((call, index) =>
        index > firstSearchIdx && isSearch(call) && (targetOf(call) !== targetOf(first) || Number(call.args.limit ?? 0) > Number(first.args.limit ?? 0)),
      );
      if (secondSearchIdx === -1) return verdict(false, "did not re-query / raise limit");
      const contextBeforeSecond = firstContextIdx !== -1 && firstContextIdx < secondSearchIdx;
      return verdict(!contextBeforeSecond, contextBeforeSecond ? "jumped to codemap_context before re-querying" : "re-queried before codemap_context");
    }
    case "C_confident_anchor": {
      if (firstContextIdx === -1) return verdict(false, "never called codemap_context on the named target");
      const ok = looksLikePathOrSymbol(targetOf(transcript[firstContextIdx]));
      return verdict(ok, ok ? "codemap_context targeted a path/symbol" : "codemap_context targeted a prose query");
    }
    case "D_wrong_top_hit": {
      const anchored = transcript.some((call) => isContext(call) && episode.lowConfidenceTopPath !== undefined && samePath(targetOf(call), episode.lowConfidenceTopPath));
      return verdict(!anchored, anchored ? "anchored codemap_context on the low-confidence top hit" : "avoided anchoring on the low-confidence hit");
    }
  }
}

export interface RoutingRunResult {
  scores: EpisodeScore[];
  byScenario: Record<RoutingScenario, { pass: number; total: number; rate: number }>;
}

export async function runRoutingEval(episodes: RoutingEpisode[], driver: AgentDriver, reps = 1): Promise<RoutingRunResult> {
  const scores: EpisodeScore[] = [];
  for (const episode of episodes) {
    for (let rep = 0; rep < reps; rep++) {
      scores.push(scoreEpisode(episode, await driver(episode)));
    }
  }
  const byScenario = {} as RoutingRunResult["byScenario"];
  for (const score of scores) {
    const bucket = (byScenario[score.scenario] ??= { pass: 0, total: 0, rate: 0 });
    bucket.total++;
    if (score.pass) bucket.pass++;
    bucket.rate = bucket.pass / bucket.total;
  }
  return { scores, byScenario };
}
