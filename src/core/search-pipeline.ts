import { fileRoleBoost, fileRoles, toResult, type SearchRow } from "./ranking.ts";
import type { QueryPlan } from "./query-plan.ts";
import type { SearchResult } from "./types.ts";
import { openRepoDb } from "./db.ts";

export interface SearchRetrievalRequest {
  plan: QueryPlan;
  limit: number;
  pathFilter: string;
}

export function pathFilterForPrefix(pathPrefix: string): string {
  return pathPrefix ? `${escapeLike(pathPrefix)}%` : "%";
}

export function collectSearchCandidates(db: ReturnType<typeof openRepoDb>, request: SearchRetrievalRequest): SearchResult[] {
  const results: SearchResult[] = [];
  results.push(...pathMatchCandidates(db, request));
  results.push(...basenameTermCandidates(db, request));
  results.push(...endpointRouteCandidates(db, request));
  results.push(...roleIntentCandidates(db, request));
  for (const ftsQuery of request.plan.ftsQueries) {
    const remaining = Math.max(request.limit * 2 - results.length, request.limit);
    results.push(...symbolFtsCandidates(db, { ...request, ftsQuery, remaining }));
    results.push(...chunkFtsCandidates(db, { ...request, ftsQuery, remaining }));
  }
  return results;
}

function pathMatchCandidates(db: ReturnType<typeof openRepoDb>, request: SearchRetrievalRequest): SearchResult[] {
  if (!request.plan.pathLike) return [];
  const rows = db.prepare(`
    select path, language, 1 as startLine, 1 as endLine, 'file' as kind, path as text, 0 as rank, size, null as symbolName
    from files
    where lower(path) like ? escape '\\' and path like ? escape '\\'
    order by length(path), path
    limit ?
  `).all(`%${escapeLike(request.plan.pathNeedle.toLowerCase())}%`, request.pathFilter, Math.min(request.limit, 20)) as unknown as SearchRow[];
  return rows.map((row) => toResult(row, request.plan, 30));
}

function basenameTermCandidates(db: ReturnType<typeof openRepoDb>, request: SearchRetrievalRequest): SearchResult[] {
  const terms = request.plan.pathTerms.filter((term) => /^[\p{L}\p{N}_-]{4,}$/u.test(term));
  if (terms.length === 0) return [];
  const rows = db.prepare(`
    select path, language, 1 as startLine, 1 as endLine, 'file' as kind, path as text, 0 as rank, size, null as symbolName
    from files
    where path like ? escape '\\'
    order by length(path), path
    limit 500
  `).all(request.pathFilter) as unknown as SearchRow[];
  const termSet = new Set(terms.map((term) => term.toLowerCase()));
  return rows
    .filter((row) => termSet.has(fileStem(row.path)))
    .map((row) => toResult(row, request.plan, 42));
}

function endpointRouteCandidates(db: ReturnType<typeof openRepoDb>, request: SearchRetrievalRequest): SearchResult[] {
  if (!request.plan.coreTerms.includes("endpoint") || !request.plan.codeIntent || request.plan.endpointPathTerms.length === 0) return [];
  const rows = db.prepare(`
    select f.path, f.language, s.start_line as startLine, coalesce(s.end_line, s.start_line) as endLine,
           s.kind, coalesce(s.signature, s.name) as text, 0 as rank, f.size as size, s.name as symbolName
    from files f
    join symbols s on s.file_id = f.id
    where f.path like ? escape '\\'
      and (lower(f.path) like '%/app/api/%/route.%' or lower(f.path) like 'app/api/%/route.%')
      and lower(s.name) in ('get', 'post', 'put', 'patch', 'delete')
    order by length(f.path), f.path
    limit 100
  `).all(request.pathFilter) as unknown as SearchRow[];
  return rows
    .filter((row) => matchedTermCount(row.path.toLowerCase(), request.plan.endpointPathTerms) > 0)
    .map((row) => toResult(row, request.plan, 34));
}

function roleIntentCandidates(db: ReturnType<typeof openRepoDb>, request: SearchRetrievalRequest): SearchResult[] {
  const candidateRoleIntents = request.plan.roleIntents.filter((intent) => intent !== "implementation");
  if (candidateRoleIntents.length === 0) return [];
  const rows = db.prepare(`
    select f.path, f.language, 1 as startLine, 1 as endLine, 'file' as kind,
           coalesce(c.text, f.path) as text, 0 as rank, f.size as size, null as symbolName
    from files f
    left join chunks c on c.file_id = f.id and c.ordinal = 0
    where f.path like ? escape '\\'
    order by length(f.path), f.path
    limit 500
  `).all(request.pathFilter) as unknown as SearchRow[];
  return rows
    .filter((row) => fileRoleBoost(fileRoles(row.path.toLowerCase(), row.size ?? undefined), candidateRoleIntents) > 0)
    .filter((row) => !fileRoles(row.path.toLowerCase(), row.size ?? undefined).includes("tests") || matchedTermCount(`${row.path}\n${row.text}`.toLowerCase(), request.plan.coreTerms) >= 3)
    .map((row) => toResult(row, request.plan, 18));
}

function chunkFtsCandidates(
  db: ReturnType<typeof openRepoDb>,
  request: SearchRetrievalRequest & { ftsQuery: QueryPlan["ftsQueries"][number]; remaining: number },
): SearchResult[] {
  const rows = db.prepare(`
    select f.path, f.language, c.start_line as startLine, c.end_line as endLine, c.kind, c.text,
           bm25(chunks_fts) as rank, f.size as size, null as symbolName
    from chunks_fts
    join chunks c on c.id = chunks_fts.rowid
    join files f on f.id = c.file_id
    where chunks_fts match ? and f.path like ? escape '\\'
    order by rank
    limit ?
  `).all(request.ftsQuery.query, request.pathFilter, request.remaining) as unknown as SearchRow[];
  return rows.map((row) => toResult(row, request.plan, request.ftsQuery.tierBoost + 1));
}

function symbolFtsCandidates(
  db: ReturnType<typeof openRepoDb>,
  request: SearchRetrievalRequest & { ftsQuery: QueryPlan["ftsQueries"][number]; remaining: number },
): SearchResult[] {
  const rows = db.prepare(`
    select f.path, f.language, s.start_line as startLine, coalesce(s.end_line, s.start_line) as endLine,
           s.kind, coalesce(s.signature, s.name) as text, bm25(symbols_fts) as rank, f.size as size, s.name as symbolName
    from symbols_fts
    join symbols s on s.id = symbols_fts.rowid
    join files f on f.id = s.file_id
    where symbols_fts match ? and f.path like ? escape '\\'
    order by rank
    limit ?
  `).all(request.ftsQuery.query, request.pathFilter, Math.ceil(request.remaining / 2)) as unknown as SearchRow[];
  return rows.map((row) => toResult(row, request.plan, request.ftsQuery.tierBoost + 4));
}

function matchedTermCount(text: string, terms: string[]): number {
  return terms.filter((term) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, "u").test(text)).length;
}

function fileStem(path: string): string {
  return (path.split("/").pop() ?? path).toLowerCase().replace(/(?:\.[^.]+)+$/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
