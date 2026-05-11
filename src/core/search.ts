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
  phrases: string[];
  pathLike: boolean;
  pathNeedle: string;
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
      (row.path.toLowerCase().endsWith(plan.normalized) ? 3 : 0) +
      (exactText ? 4 : 0) +
      (symbolish && exactText ? 3 : 0) +
      (exactSymbol ? 8 : 0) +
      (prefixSymbol ? 5 : 0) -
      lockPenalty,
  };
}

function planQuery(query: string): QueryPlan {
  const raw = query.trim();
  const phrases = [...raw.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim()).filter(Boolean);
  const terms = raw.match(/[\p{L}\p{N}_.$/-]+/gu)?.slice(0, 8) ?? [];
  if (terms.length === 0 && phrases.length === 0) throw new Error("Search query has no searchable terms.");

  const normalized = raw.replace(/^"|"$/g, "").toLowerCase();
  const pathLike = /[/.\\-]|\.[A-Za-z0-9]{1,8}$/.test(raw);
  const pathNeedle = raw.replace(/^"|"$/g, "");
  const quotedPhrases = phrases.map(quoteFtsPhrase);
  const quotedTerms = terms.map(quoteFtsPhrase);
  const prefixTerms = terms.map(toPrefixTerm).filter(Boolean);
  const tiered = phrases.length > 0 || terms.length > 1;
  const ftsQueries = uniqueFtsQueries([
    ...quotedPhrases.map((query) => ({ query, tierBoost: tiered ? 24 : 0 })),
    { query: quotedTerms.join(" "), tierBoost: tiered ? 16 : 0 },
    { query: prefixTerms.join(" OR "), tierBoost: tiered ? 8 : 0 },
    { query: quotedTerms.join(" OR "), tierBoost: 0 },
  ].filter((entry) => entry.query));

  return { normalized, terms, phrases, pathLike, pathNeedle, ftsQueries };
}

function quoteFtsPhrase(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function toPrefixTerm(value: string): string {
  const token = value.match(/[\p{L}\p{N}_]+/u)?.[0];
  return token && token.length > 2 ? `${token}*` : "";
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
