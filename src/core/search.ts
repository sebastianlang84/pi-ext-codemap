import { openRepoDb } from "./db.ts";
import { getRepoInfo } from "./repo.ts";
import { snippet } from "./chunker.ts";
import { status } from "./indexer.ts";
import { normalizePathPrefix } from "./scanner.ts";
import type { SearchResult } from "./types.ts";

interface SearchRow {
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  kind: string;
  text: string;
  rank: number;
  symbolName?: string | null;
}

interface FtsQuery {
  query: string;
  tierBoost: number;
}

interface QueryPlan {
  normalized: string;
  terms: string[];
  coreTerms: string[];
  phrases: string[];
  pathLike: boolean;
  pathNeedle: string;
  codeIntent: boolean;
  roleIntents: string[];
  ftsQueries: FtsQuery[];
}

interface SearchDiagnostics {
  stale?: boolean;
  changed?: number;
  missing?: number;
  deleted?: number;
  lastIndexedAt?: string | null;
  warnings?: string[];
}

export interface CodeMapSearchPackage {
  query: string;
  root: string;
  pathPrefix: string;
  lastIndexedAt: string | null;
  stale: boolean;
  changed: number;
  missing: number;
  deleted: number;
  warnings: string[];
  results: SearchResult[];
}

export function searchCodeMapWithDiagnostics(options: { query: string; cwd?: string; limit?: number; pathPrefix?: string }): CodeMapSearchPackage {
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  const diagnostics = status(options.cwd, { health: "full", pathPrefix }) as SearchDiagnostics & { root: string };
  return {
    query: options.query,
    root: diagnostics.root,
    pathPrefix,
    lastIndexedAt: diagnostics.lastIndexedAt ?? null,
    stale: diagnostics.stale ?? false,
    changed: diagnostics.changed ?? 0,
    missing: diagnostics.missing ?? 0,
    deleted: diagnostics.deleted ?? 0,
    warnings: diagnostics.warnings ?? [],
    results: searchCodeMap({ ...options, pathPrefix }),
  };
}

export function searchCodeMap(options: { query: string; cwd?: string; limit?: number; pathPrefix?: string }): SearchResult[] {
  const info = getRepoInfo(options.cwd);
  if (!info.approved) throw new Error("Repository is not approved/indexed yet.");
  const db = openRepoDb(info.dbPath);
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const plan = planQuery(options.query);
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  const pathFilter = pathPrefix ? `${escapeLike(pathPrefix)}%` : "%";

  try {
    const results: SearchResult[] = [];

    if (plan.pathLike) {
      const pathRows = db.prepare(`
        select path, language, 1 as startLine, 1 as endLine, 'file' as kind, path as text, 0 as rank, null as symbolName
        from files
        where lower(path) like ? escape '\\' and path like ? escape '\\'
        order by length(path), path
        limit ?
      `).all(`%${escapeLike(plan.pathNeedle.toLowerCase())}%`, pathFilter, Math.min(limit, 20)) as unknown as SearchRow[];
      results.push(...pathRows.map((row) => toResult(row, plan, 30)));
    }

    if (plan.roleIntents.length > 0) {
      const roleRows = db.prepare(`
        select path, language, 1 as startLine, 1 as endLine, 'file' as kind, path as text, 0 as rank, null as symbolName
        from files
        where path like ? escape '\\'
        order by length(path), path
        limit 500
      `).all(pathFilter) as unknown as SearchRow[];
      results.push(...roleRows
        .filter((row) => fileRoleBoost(fileRoles(row.path.toLowerCase()), plan.roleIntents) > 0)
        .map((row) => toResult(row, plan, 18)));
    }

    for (const ftsQuery of plan.ftsQueries) {
      const remaining = Math.max(limit * 2 - results.length, limit);
      const chunkRows = db.prepare(`
        select f.path, f.language, c.start_line as startLine, c.end_line as endLine, c.kind, c.text,
               bm25(chunks_fts) as rank, null as symbolName
        from chunks_fts
        join chunks c on c.id = chunks_fts.rowid
        join files f on f.id = c.file_id
        where chunks_fts match ? and f.path like ? escape '\\'
        order by rank
        limit ?
      `).all(ftsQuery.query, pathFilter, remaining) as unknown as SearchRow[];

      const symbolRows = db.prepare(`
        select f.path, f.language, s.start_line as startLine, coalesce(s.end_line, s.start_line) as endLine,
               s.kind, coalesce(s.signature, s.name) as text, bm25(symbols_fts) as rank, s.name as symbolName
        from symbols_fts
        join symbols s on s.id = symbols_fts.rowid
        join files f on f.id = s.file_id
        where symbols_fts match ? and f.path like ? escape '\\'
        order by rank
        limit ?
      `).all(ftsQuery.query, pathFilter, Math.ceil(remaining / 2)) as unknown as SearchRow[];

      results.push(...symbolRows.map((row) => toResult(row, plan, ftsQuery.tierBoost + 4)));
      results.push(...chunkRows.map((row) => toResult(row, plan, ftsQuery.tierBoost + 1)));
    }

    return dedupe(results)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine)
      .slice(0, limit);
  } finally {
    db.close();
  }
}

function toResult(row: SearchRow, plan: QueryPlan, boost: number): SearchResult {
  const exactPath = row.path.toLowerCase().includes(plan.normalized);
  const exactText = row.text.toLowerCase().includes(plan.normalized);
  const symbolish = row.kind !== "text" && row.kind !== "markdown" && row.kind !== "file";
  const symbolName = row.symbolName?.toLowerCase() ?? "";
  const exactSymbol = symbolName === plan.normalized;
  const prefixSymbol = plan.terms.some((term) => symbolName.startsWith(term.toLowerCase()));
  const lowerPath = row.path.toLowerCase();
  const lowerText = row.text.toLowerCase();
  const pathCoverage = termCoverage(lowerPath, plan.coreTerms);
  const textCoverage = termCoverage(lowerText, plan.coreTerms);
  const basename = lowerPath.split("/").pop() ?? lowerPath;
  const basenameCoverage = termCoverage(basename, plan.coreTerms);
  const codeLike = /\.(?:[cm]?[jt]sx?|py|go|rs|java|rb|php|cs|cpp|c|h|hpp|swift|kt|scala|sh|sql)$/.test(lowerPath);
  const sourceLike = /(^|\/)src\//.test(lowerPath);
  const testLike = /(^|\/)(?:test|tests|__tests__)\//.test(lowerPath) || /(?:^|[._-])test\./.test(basename);
  const docLike = /(^|\/)(?:readme|architecture|changelog|todo)(?:\.|$)|\.(?:md|mdx|rst|txt)$/.test(lowerPath);
  const roleBoost = fileRoleBoost(fileRoles(lowerPath), plan.roleIntents);
  const lockPenalty = /(^|[/.-])(?:package-lock|npm-shrinkwrap|yarn\.lock|pnpm-lock|.*\.lock)(?:$|[/.])/.test(row.path) ? 4 : 0;

  return {
    path: row.path,
    language: row.language,
    startLine: row.startLine,
    endLine: row.endLine,
    kind: row.kind,
    snippet: matchSnippet(row.text, plan),
    score:
      boost +
      rankScore(row.rank) +
      (exactPath ? 6 : 0) +
      (lowerPath.endsWith(plan.normalized) ? 3 : 0) +
      (exactText ? 4 : 0) +
      (symbolish && exactText ? 3 : 0) +
      (exactSymbol ? 8 : 0) +
      (prefixSymbol ? 5 : 0) +
      pathCoverage * 5 +
      basenameCoverage * 4 +
      textCoverage * 3 +
      (plan.codeIntent && codeLike ? 2 : 0) +
      (plan.codeIntent && sourceLike ? 4 : 0) +
      roleBoost -
      (plan.codeIntent && testLike ? 3 : 0) -
      (plan.codeIntent && docLike ? 6 : 0) -
      lockPenalty,
  };
}

function planQuery(query: string): QueryPlan {
  const raw = query.trim();
  const phrases = [...raw.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim()).filter(Boolean);
  const terms = raw.match(/[\p{L}\p{N}_.$/-]+/gu)?.slice(0, 8) ?? [];
  if (terms.length === 0 && phrases.length === 0) throw new Error("Search query has no searchable terms.");

  const normalized = raw.replace(/^"|"$/g, "").toLowerCase();
  const expandedTerms = expandTerms(terms);
  const coreTerms = expandedTerms.filter((term) => !stopWords.has(term)).slice(0, 10);
  const pathLike = /[/.\\-]|\.[A-Za-z0-9]{1,8}$/.test(raw);
  const pathNeedle = raw.replace(/^"|"$/g, "");
  const codeIntent = coreTerms.some((term) => codeIntentTerms.has(term));
  const roleIntents = inferRoleIntents(normalized, coreTerms);
  const quotedPhrases = phrases.map(quoteFtsPhrase);
  const quotedTerms = terms.map(quoteFtsPhrase);
  const quotedExpandedTerms = expandedTerms.map(quoteFtsPhrase);
  const quotedCoreTerms = coreTerms.map(quoteFtsPhrase);
  const broadTerms = terms.length > 1 ? expandedTerms : terms.map((term) => term.toLowerCase());
  const prefixTerms = broadTerms.map(toPrefixTerm).filter(Boolean);
  const tiered = phrases.length > 0 || expandedTerms.length > 1;
  const ftsQueries = uniqueFtsQueries([
    ...quotedPhrases.map((query) => ({ query, tierBoost: tiered ? 24 : 0 })),
    { query: quotedTerms.join(" "), tierBoost: tiered ? 18 : 0 },
    { query: quotedCoreTerms.join(" "), tierBoost: tiered ? 16 : 0 },
    { query: quotedExpandedTerms.join(" "), tierBoost: tiered ? 12 : 0 },
    { query: prefixTerms.join(" OR "), tierBoost: tiered ? 8 : 0 },
    { query: broadTerms.map(quoteFtsPhrase).join(" OR "), tierBoost: 0 },
  ].filter((entry) => entry.query));

  return { normalized, terms: expandedTerms, coreTerms, phrases, pathLike, pathNeedle, codeIntent, roleIntents, ftsQueries };
}

const stopWords = new Set([
  "a", "an", "and", "api", "by", "for", "from", "get", "in", "into", "of", "on", "or", "post", "put", "the", "to", "with",
]);

const codeIntentTerms = new Set([
  "aggregator", "class", "delivery", "endpoint", "function", "handler", "implemented", "lock", "macro", "method", "orchestrator", "pipeline", "service",
]);

function inferRoleIntents(normalized: string, terms: string[]): string[] {
  const intents: string[] = [];
  const has = (...needles: string[]) => needles.some((needle) => terms.includes(needle) || normalized.includes(needle));
  if (has("what is this project", "project about", "overview", "purpose")) intents.push("overview");
  if (has("agent", "instructions", "program")) intents.push("agent_instructions");
  if (has("edit")) intents.push("overview", "agent_instructions", "implementation/main");
  if (has("implemented", "implementation", "main", "defined", "architecture", "model", "used", "orchestrator", "pipeline", "run")) intents.push("implementation", "implementation/main");
  if (has("computed")) intents.push("setup/utility");
  if (has("data", "setup", "preparation", "prepare")) intents.push("setup/utility");
  if (has("not be modified", "not modified", "do not modify")) intents.push("overview", "setup/utility");
  if (has("dependencies", "dependency", "package", "pyproject")) intents.push("dependencies");
  return uniqueStrings(intents);
}

function fileRoleBoost(roles: string[], intents: string[]): number {
  if (roles.includes("implementation/main") && intents.includes("implementation/main")) return 24;
  if (roles.includes("setup/utility") && intents.includes("setup/utility")) return 22;
  return roles.some((role) => intents.includes(role)) ? 15 : 0;
}

function fileRoles(path: string): string[] {
  const basename = path.split("/").pop() ?? path;
  const roles: string[] = [];
  if (basename === "readme.md") roles.push("overview");
  if (["program.md", "agents.md", "claude.md"].includes(basename)) roles.push("agent_instructions");
  if (path.startsWith("src/") || /(?:^|\/)src\//.test(path)) roles.push("implementation");
  if (["train.py", "main.py", "index.ts", "index.js"].includes(basename)) roles.push("implementation", "implementation/main");
  if (["prepare.py", "setup.py"].includes(basename)) roles.push("setup/utility");
  if (path.startsWith("scripts/") || /(?:^|\/)scripts\//.test(path)) roles.push("tooling");
  if (path.startsWith("tests/") || /(?:^|\/)(?:test|tests|__tests__)\//.test(path)) roles.push("tests");
  if (["pyproject.toml", "package.json", "requirements.txt", "cargo.toml", "go.mod"].includes(basename)) roles.push("dependencies");
  if (/(?:^|[/.])(?:uv|package|pnpm|yarn|cargo)\.lock$/.test(path) || basename.endsWith(".lock")) roles.push("lockfile");
  return uniqueStrings(roles);
}

function quoteFtsPhrase(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function expandTerms(terms: string[]): string[] {
  const expanded: string[] = [];
  for (const term of terms) {
    for (const part of splitTerm(term)) {
      const normalized = part.toLowerCase();
      if (normalized.length > 1) expanded.push(normalized);
    }
  }
  return uniqueStrings(expanded).slice(0, 16);
}

function splitTerm(value: string): string[] {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[.$/\\_-]+/g, " ");
  return [value, ...spaced.split(/\s+/)].filter(Boolean);
}

function toPrefixTerm(value: string): string {
  const token = value.match(/[\p{L}\p{N}_]+/u)?.[0];
  return token && token.length > 2 ? `${token}*` : "";
}

function termCoverage(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const hits = terms.filter((term) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, "u").test(text)).length;
  return hits / terms.length;
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

function uniqueFtsQueries(values: FtsQuery[]): FtsQuery[] {
  const byQuery = new Map<string, FtsQuery>();
  for (const value of values) {
    const previous = byQuery.get(value.query);
    if (!previous || value.tierBoost > previous.tierBoost) byQuery.set(value.query, value);
  }
  return [...byQuery.values()];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
