import { snippet } from "./chunker.ts";
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

export function toResult(row: SearchRow, plan: QueryPlan, boost: number): SearchResult {
  const diagnostics = scoreSearchRow(row, plan, boost);
  return {
    path: row.path,
    language: row.language,
    startLine: row.startLine,
    endLine: row.endLine,
    kind: row.kind,
    snippet: matchSnippet(row.text, plan),
    score: diagnostics.finalScore,
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
  const codeLike = /\.(?:[cm]?[jt]sx?|py|go|rs|java|rb|php|cs|cpp|c|h|hpp|swift|kt|scala|sh|sql)$/.test(lowerPath);
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
    && plan.terms.some((term) => term.toLowerCase() === symbolName)
    && plan.codeIntent;
  const symbolScore = (symbolish && exactText ? 3 : 0) + (exactSymbol ? 28 : 0) + (exactTermSymbol ? 20 : 0) + (prefixSymbol ? 10 : 0) + (routeHandlerSymbol ? 20 : 0);
  const textCoverageScore = textCoverage * 3;
  const codeIntentBoost = (plan.codeIntent && codeLike ? 2 : 0) + (plan.codeIntent && sourceLike ? 4 : 0);
  const roleBoost = fileRoleBoost(roles, plan.roleIntents);
  const testPenalty = testLike ? (implementationIntent ? 8 : plan.codeIntent ? 3 : 0) : 0;
  const docPenalty = plan.codeIntent && docLike ? 6 : 0;
  const noisePenalty = fileRolePenalty(roles, plan);
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
  if (path.startsWith("src/") || /(?:^|\/)src\//.test(path)) roles.push("implementation");
  if (["train.py", "main.py", "index.ts", "index.js"].includes(basename)) roles.push("implementation", "implementation/main");
  if (["prepare.py", "setup.py"].includes(basename)) roles.push("setup/utility");
  if (path.startsWith("scripts/") || /(?:^|\/)scripts\//.test(path)) roles.push("tooling");
  if (path.startsWith("tests/") || /(?:^|\/)(?:test|tests|__tests__)\//.test(path)) roles.push("tests");
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
  if (roles.includes("lockfile")) penalty += explicit.lockfile ? 0 : 60;
  if (roles.includes("generated")) penalty += explicit.generated ? 8 : 60;
  if (roles.includes("build_output") || roles.includes("minified")) penalty += explicit.buildOutput ? 12 : 48;
  if (roles.includes("large_json")) penalty += explicit.largeJson ? 12 : 36;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rankScore(rank: number): number {
  if (rank < 0) return 10 + Math.min(5, Math.abs(rank) * 1_000_000);
  return Math.max(0, 10 - rank);
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
    const key = `${result.path}:${result.startLine}:${result.endLine}:${result.kind}`;
    const previous = byKey.get(key);
    if (!previous || result.score > previous.score) byKey.set(key, result);
  }
  return [...byKey.values()];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
