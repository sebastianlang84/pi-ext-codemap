import { snippet } from "./chunker.ts";
import { escapeRegExp, uniqueStrings } from "./text-util.ts";
import type { QueryPlan } from "./query-plan.ts";
import type { SearchResult } from "./types.ts";

export interface SearchRow {
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  kind: string;
  text: string;
  rank: number;
  size?: number | null;
  symbolName?: string | null;
}

export interface SearchScoreDiagnostics {
  finalScore: number;
  retrievalBoost: number;
  ftsScore: number;
  pathScore: number;
  filenameScore: number;
  exactTextScore: number;
  symbolScore: number;
  textCoverageScore: number;
  tokenCoverage: number;
  matchedTokens: string[];
  codeIntentBoost: number;
  roleBoost: number;
  testPenalty: number;
  docPenalty: number;
  noisePenalty: number;
  roles: string[];
}

export interface ScoredSearchCandidate {
  result: SearchResult;
  diagnostics: SearchScoreDiagnostics;
}

export function toResult(row: SearchRow, plan: QueryPlan, boost: number): SearchResult {
  return toScoredCandidate(row, plan, boost).result;
}

export function toScoredCandidate(row: SearchRow, plan: QueryPlan, boost: number): ScoredSearchCandidate {
  const diagnostics = scoreSearchRow(row, plan, boost);
  return {
    result: {
      path: row.path,
      language: row.language,
      startLine: row.startLine,
      endLine: row.endLine,
      kind: row.kind,
      snippet: matchSnippet(row.text, plan),
      score: diagnostics.finalScore,
    },
    diagnostics,
  };
}

export function scoreSearchRow(row: SearchRow, plan: QueryPlan, boost: number): SearchScoreDiagnostics {
  const exactPath = row.path.toLowerCase().includes(plan.normalized);
  const exactText = row.text.toLowerCase().includes(plan.normalized);
  const symbolish = row.kind !== "text" && row.kind !== "markdown" && row.kind !== "file";
  const symbolName = row.symbolName?.toLowerCase() ?? "";
  const exactSymbol = symbolName === plan.normalized;
  const exactTermSymbol = plan.terms.some((term) => term.length >= 5 && symbolName === term.toLowerCase());
  const prefixSymbol = !exactTermSymbol && plan.terms.some((term) => {
    const normalizedTerm = term.toLowerCase();
    return normalizedTerm.length >= 5 && symbolName.startsWith(normalizedTerm) && normalizedTerm.length / Math.max(symbolName.length, 1) >= 0.55;
  });
  const lowerPath = row.path.toLowerCase();
  const lowerText = row.text.toLowerCase();
  const pathCoverage = termCoverage(lowerPath, plan.coreTerms);
  const textCoverage = termCoverage(lowerText, plan.coreTerms);
  const basename = lowerPath.split("/").pop() ?? lowerPath;
  const basenameCoverage = termCoverage(basename, plan.coreTerms);
  const basenameDepth = lowerPath.split("/").length - 1;
  const exactFilenameScore = basename === plan.normalized ? Math.max(1, 4 - basenameDepth) : 0;
  const exactModuleNameScore = exactBasenameStemMatch(basename, plan.coreTerms) ? 8 : 0;
  const codeLike = isCodeLikePath(lowerPath);
  const sourceLike = /(^|\/)src\//.test(lowerPath);
  const testLike = /(^|\/)(?:test|tests|__tests__)\//.test(lowerPath) || /(?:^|[._-])test\./.test(basename);
  const docLike = /(^|\/)(?:readme|architecture|changelog|todo)(?:\.|$)|\.(?:md|mdx|rst|txt)$/.test(lowerPath);
  const roles = fileRoles(lowerPath, row.size ?? undefined);
  const implementationIntent = plan.roleIntents.includes("implementation") && !plan.roleIntents.includes("tests");
  const retrievalBoost = boost;
  const ftsScore = rankScore(row.rank);
  const pathScore = (exactPath ? 6 : 0) + (lowerPath.endsWith(plan.normalized) ? 3 : 0) + pathCoverage * 5;
  const filenameScore = basenameCoverage * 4 + exactFilenameScore + exactModuleNameScore;
  const exactTextScore = exactText ? 4 : 0;
  const routeHandlerSymbol = symbolish
    && /(?:^|\/)route\.[cm]?[jt]sx?$/.test(lowerPath)
    && ["get", "post", "put", "patch", "delete"].includes(symbolName)
    && plan.codeIntent
    && (plan.terms.some((term) => term.toLowerCase() === symbolName) || matchedQueryTokens(lowerPath, plan.endpointPathTerms).length > 0);
  const symbolScore = (symbolish && exactText ? 3 : 0) + (exactSymbol ? 28 : 0) + (exactTermSymbol ? 20 : 0) + (prefixSymbol ? 10 : 0) + (routeHandlerSymbol ? 20 : 0);
  const textCoverageScore = textCoverage * 3;
  // Code lift: prefer source over docs on code/UI-navigation queries. The old `codeIntent` gate only
  // fired on explicit code keywords (function/service/endpoint/…), so natural-language UI queries
  // ("Overview tab Stock Identity Location cards") got no code lift and lost to doc headings that
  // carry the same words as clean prose tokens. Fire the lift unless the query is documentation-
  // oriented (a doc role intent). This is a code lift, never a doc penalty — canonical docs stay
  // findable and doc-intent queries are unaffected (see the doc-flood ADR).
  const noisePenalty = fileRolePenalty(roles, plan);
  const docIntent = plan.roleIntents.some((intent) => DOC_ROLE_INTENTS.has(intent));
  // Only genuine source earns the lift: never lift a file that carries a noise penalty (generated,
  // build output, minified, lockfiles), or the small +6 could cancel the penalty and float noise
  // back into results (regression caught by the generated/dist noise test).
  const codePreferred = (plan.codeIntent || !docIntent) && noisePenalty === 0;
  const codeIntentBoost = (codePreferred && codeLike ? 2 : 0) + (codePreferred && sourceLike ? 4 : 0);
  const roleBoost = fileRoleBoost(roles, plan.roleIntents);
  const testPenalty = testLike ? (implementationIntent ? 8 : plan.codeIntent ? 3 : 0) : 0;
  const docPenalty = plan.codeIntent && docLike ? 6 : 0;
  const matchedTokens = matchedQueryTokens([lowerPath, lowerText, symbolName].join("\n"), plan.coreTerms);
  const tokenCoverage = plan.coreTerms.length > 0 ? matchedTokens.length / plan.coreTerms.length : 0;
  const finalScore = retrievalBoost + ftsScore + pathScore + filenameScore + exactTextScore + symbolScore + textCoverageScore + codeIntentBoost + roleBoost - testPenalty - docPenalty - noisePenalty;

  return {
    finalScore,
    retrievalBoost,
    ftsScore,
    pathScore,
    filenameScore,
    exactTextScore,
    symbolScore,
    textCoverageScore,
    tokenCoverage,
    matchedTokens,
    codeIntentBoost,
    roleBoost,
    testPenalty,
    docPenalty,
    noisePenalty,
    roles,
  };
}

export function rankAndSlice(results: SearchResult[], limit: number): SearchResult[] {
  return dedupe(results)
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine)
    .slice(0, limit);
}

export type TopHitConfidenceLevel = "high" | "low" | "single" | "none";

export interface TopHitConfidence {
  level: TopHitConfidenceLevel;
  /** Relative score gap between rank 1 and rank 2, (s0 - s1) / s0. 1 when only one hit. */
  margin: number;
}

// How much the top search hit stands out from rank 2. A bunched cluster (small margin) means the
// top hit is one of several near-ties, so anchoring codemap_context on it risks the wrong-anchor
// failure mode (context expands whatever it lands on, crowding out correct lower-ranked hits). The
// threshold is a first cut, meant to be calibrated by the routing eval.
export function topHitConfidence(results: SearchResult[], lowMarginThreshold = 0.1): TopHitConfidence {
  if (results.length === 0) return { level: "none", margin: 0 };
  if (results.length === 1) return { level: "single", margin: 1 };
  const top = results[0].score;
  const second = results[1].score;
  const margin = top > 0 ? (top - second) / top : 0;
  return { level: margin >= lowMarginThreshold ? "high" : "low", margin };
}

// Documentation-oriented role intents. When the query carries one of these, code is NOT preferred
// over docs (the code lift is suppressed) so canonical docs stay the top hit for doc-intent queries.
const DOC_ROLE_INTENTS = new Set(["overview", "documentation", "decision_record", "agent_instructions"]);

const CODE_PATH_PATTERN = /\.(?:[cm]?[jt]sx?|py|go|rs|java|rb|php|cs|cpp|c|h|hpp|swift|kt|scala|sh|sql)$/;

export function isCodeLikePath(path: string): boolean {
  return CODE_PATH_PATTERN.test(path.toLowerCase());
}

export function fileRoleBoost(roles: string[], intents: string[]): number {
  if (roles.includes("implementation/main") && intents.includes("implementation/main")) return 24;
  if (roles.includes("setup/utility") && intents.includes("setup/utility")) return 22;
  return roles.some((role) => intents.includes(role)) ? 15 : 0;
}

export function fileRoles(path: string, size = 0): string[] {
  const basename = path.split("/").pop() ?? path;
  const parts = path.split("/");
  const roles: string[] = [];
  if (basename === "readme.md") roles.push("overview");
  if (["program.md", "agents.md", "claude.md"].includes(basename)) roles.push("agent_instructions");
  if (path === ".claude/settings.local.json") roles.push("local_agent_settings");
  if (path.startsWith("src/") || /(?:^|\/)src\//.test(path)) roles.push("implementation");
  if (parts.some((part) => part === "providers") || /(?:^|[._-])provider(?:[._-]|\.|$)/.test(basename)) roles.push("provider");
  if (["train.py", "main.py", "index.ts", "index.js"].includes(basename)) roles.push("implementation", "implementation/main");
  if (["prepare.py", "setup.py"].includes(basename)) roles.push("setup/utility");
  if (path.startsWith("scripts/") || /(?:^|\/)scripts\//.test(path)) roles.push("tooling");
  if (path.startsWith("tests/") || /(?:^|\/)(?:test|tests|__tests__)\//.test(path)) roles.push("tests");
  if (/(?:^|\/)docs\/archive\//.test(path)) roles.push("archived_documentation");
  if (/(?:^|\/)docs\/adr\//.test(path)) roles.push("decision_record");
  if (path.startsWith("docs/") || /(?:^|\/)docs\//.test(path) || /\.(?:md|mdx|rst|txt)$/.test(basename)) roles.push("documentation");
  if (["pyproject.toml", "package.json", "requirements.txt", "cargo.toml", "go.mod"].includes(basename)) roles.push("dependencies", "configuration");
  if (/\.(?:json|ya?ml|toml|ini|env)$/.test(basename) && !isLockfilePath(path, basename)) roles.push("configuration");
  if (isLockfilePath(path, basename)) roles.push("lockfile");
  if (parts.some((part) => ["dist", "build", ".next", "coverage", "vendor"].includes(part))) roles.push("build_output");
  if (parts.some((part) => /generated|__generated__/.test(part)) || /(?:^|[._-])generated(?:[._-]|$)/.test(basename)) roles.push("generated");
  if (/\.min\.[cm]?js$/.test(basename)) roles.push("minified");
  if (/\.json$/.test(basename) && size >= 64_000) roles.push("large_json");
  return uniqueStrings(roles);
}

function isLockfilePath(path: string, basename: string): boolean {
  return /^(?:package-lock|npm-shrinkwrap)\.json$/.test(basename)
    || /^pnpm-lock\.ya?ml$/.test(basename)
    || basename === "yarn.lock"
    || basename.endsWith(".lock")
    || /(?:^|[/.])(?:uv|package|pnpm|yarn|cargo)\.lock$/.test(path);
}

function fileRolePenalty(roles: string[], plan: QueryPlan): number {
  const explicit = explicitNoiseIntents(plan);
  let penalty = 0;
  if (roles.includes("agent_instructions") && !plan.roleIntents.includes("agent_instructions")) penalty += 18;
  if (roles.includes("local_agent_settings") && !plan.pathLike && !plan.roleIntents.includes("agent_instructions") && !plan.roleIntents.includes("configuration")) penalty += 18;
  if (roles.includes("lockfile")) penalty += explicit.lockfile ? 0 : 60;
  if (roles.includes("generated")) penalty += explicit.generated ? 8 : 60;
  if (roles.includes("build_output") || roles.includes("minified")) penalty += explicit.buildOutput ? 12 : 48;
  if (roles.includes("large_json")) penalty += explicit.largeJson ? 12 : 36;
  if (roles.includes("archived_documentation") && !/\barchive[ds]?\b/.test(plan.normalized)) penalty += 14;
  return penalty;
}

function explicitNoiseIntents(plan: QueryPlan): { lockfile: boolean; generated: boolean; buildOutput: boolean; largeJson: boolean } {
  const text = [plan.normalized, ...plan.terms].join(" ");
  return {
    lockfile: /(?:\blockfile\b|\b(?:package-lock|npm-shrinkwrap)\.json\b|\bpnpm-lock\.ya?ml\b|\byarn\.lock\b|\b\S+\.lock\b)/.test(text),
    generated: plan.pathLike && /\b(?:generated|__generated__)\b/.test(text),
    buildOutput: plan.pathLike && /(?:^|[/\\])(?:dist|build|vendor)(?:[/\\]|$)|\.min\.[cm]?js\b/.test(text),
    largeJson: /(?:\.json\b|\blarge json\b)/.test(text),
  };
}

function exactBasenameStemMatch(basename: string, terms: string[]): boolean {
  const stem = basename.replace(/(?:\.[^.]+)+$/, "");
  return stem.length > 1 && terms.includes(stem);
}

function termCoverage(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  return matchedQueryTokens(text, terms).length / terms.length;
}

function matchedQueryTokens(text: string, terms: string[]): string[] {
  return terms.filter((term) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, "u").test(text));
}

// NOTE: bm25() returns a small negative number for any FTS match (more-negative = more relevant).
// `Math.abs(rank) * 1_000_000` saturates at the `Math.min(5, …)` cap for essentially every real
// match, so this deliberately collapses to a near-binary "matched (~15) vs. not" signal: raw bm25
// magnitude does not differentiate candidates here. FTS relevance instead enters ranking via the
// per-source `boost`/`tierBoost` and the SQL `order by rank limit ?` cutoff in search-pipeline.
// Revisit via bench:search-quality if finer bm25 weighting is wanted (see TODO §2).
const FTS_MATCH_BASE = 10;
const FTS_MATCH_BONUS_CAP = 5;

function rankScore(rank: number): number {
  // bm25() returns a negative score for every real FTS match (more-negative = more relevant), so a
  // real match always has rank < 0. A non-negative rank is exclusively the `0 as rank` sentinel that
  // non-FTS retrieval sources (path_match/basename_term/endpoint_route/role_intent) use for rows that
  // never went through FTS. Those rows must earn no FTS credit: giving them the FTS_MATCH_BASE (10)
  // rewarded a match that never happened and inflated role-intent doc candidates (see the doc-flood
  // ADR). FTS relevance still enters ranking via the per-source boost and the SQL `order by rank`.
  if (rank >= 0) return 0;
  return FTS_MATCH_BASE + Math.min(FTS_MATCH_BONUS_CAP, Math.abs(rank) * 1_000_000);
}

function matchSnippet(text: string, plan: QueryPlan): string {
  const lines = text.split(/\r?\n/);
  const needles = [plan.normalized, ...plan.phrases.map((phrase) => phrase.toLowerCase()), ...plan.terms.map((term) => term.toLowerCase())]
    .filter((term) => term.length > 1);
  const index = lines.findIndex((line) => needles.some((term) => line.toLowerCase().includes(term)));
  if (index === -1) return snippet(text);
  const start = Math.max(0, index - 2);
  const end = Math.min(lines.length, index + 3);
  return snippet(lines.slice(start, end).join("\n"));
}

function dedupe(results: SearchResult[]): SearchResult[] {
  const byKey = new Map<string, SearchResult>();
  for (const result of results) {
    const key = result.path;
    const previous = byKey.get(key);
    if (!previous || result.score > previous.score) byKey.set(key, result);
  }
  return [...byKey.values()];
}
