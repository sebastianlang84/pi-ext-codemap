import { fileRoleBoost, fileRoles, isCodeLikePath, toScoredCandidate, type SearchRow, type SearchScoreDiagnostics } from "./ranking.ts";
import { escapeLike, escapeRegExp } from "./text-util.ts";
import type { QueryPlan } from "./query-plan.ts";
import type { SearchResult } from "./types.ts";
import { openRepoDb } from "./db.ts";

export interface SearchRetrievalRequest {
  plan: QueryPlan;
  limit: number;
  pathFilter: string;
}

export type SearchCandidateSource = "path_match" | "basename_term" | "endpoint_route" | "role_intent" | "symbol_fts" | "chunk_fts" | "code_quota";

// How deep to scan FTS-ranked chunks looking for code files that the per-source `limit` cutoff
// crowded out, and how many code chunks to guarantee into the pool per FTS query. Purely additive:
// the quota only appends candidates, so it can surface a crowded-out code target but never removes
// or reorders a doc hit (ranking still sorts by score). See the doc-flood ADR.
const CODE_QUOTA_SCAN = 60;
const CODE_QUOTA_KEEP = 6;

export interface SearchCandidateDiagnostic {
  source: SearchCandidateSource;
  result: SearchResult;
  scoreDiagnostics: SearchScoreDiagnostics;
}

export function pathFilterForPrefix(pathPrefix: string): string {
  return pathPrefix ? `${escapeLike(pathPrefix)}%` : "%";
}

export function collectSearchCandidates(db: ReturnType<typeof openRepoDb>, request: SearchRetrievalRequest): SearchResult[] {
  return collectSearchCandidateDiagnostics(db, request).map((candidate) => candidate.result);
}

export function collectSearchCandidateDiagnostics(db: ReturnType<typeof openRepoDb>, request: SearchRetrievalRequest): SearchCandidateDiagnostic[] {
  const candidates: SearchCandidateDiagnostic[] = [];
  candidates.push(...pathMatchCandidates(db, request));
  candidates.push(...basenameTermCandidates(db, request));
  candidates.push(...endpointRouteCandidates(db, request));
  candidates.push(...roleIntentCandidates(db, request));
  for (const ftsQuery of request.plan.ftsQueries) {
    const remaining = Math.max(request.limit * 2 - candidates.length, request.limit);
    candidates.push(...symbolFtsCandidates(db, { ...request, ftsQuery, remaining }));
    candidates.push(...chunkFtsCandidates(db, { ...request, ftsQuery, remaining }));
    candidates.push(...codeQuotaCandidates(db, { ...request, ftsQuery }));
  }
  return candidates;
}

function pathMatchCandidates(db: ReturnType<typeof openRepoDb>, request: SearchRetrievalRequest): SearchCandidateDiagnostic[] {
  if (!request.plan.pathLike) return [];
  const rows = db.prepare(`
    select path, language, 1 as startLine, 1 as endLine, 'file' as kind, path as text, 0 as rank, size, null as symbolName
    from files
    where lower(path) like ? escape '\\' and path like ? escape '\\'
    order by length(path), path
    limit ?
  `).all(`%${escapeLike(request.plan.pathNeedle.toLowerCase())}%`, request.pathFilter, Math.min(request.limit, 20)) as unknown as SearchRow[];
  return rows.map((row) => toSearchCandidate(row, request.plan, 30, "path_match"));
}

function basenameTermCandidates(db: ReturnType<typeof openRepoDb>, request: SearchRetrievalRequest): SearchCandidateDiagnostic[] {
  const terms = request.plan.pathTerms.filter((term) => /^[\p{L}\p{N}_-]{4,}$/u.test(term));
  if (terms.length === 0) return [];
  const termSet = new Set(terms.map((term) => term.toLowerCase()));
  // Pre-filter to files whose basename plausibly carries one of the terms directly in SQL, then keep
  // only exact basename-stem matches in JS. Previously this scanned the 500 shortest paths and stem-
  // filtered afterwards, so on repos with >500 files an exact-basename match on a long path was
  // silently dropped. The per-term LIKE set is selective, so no row cap is needed.
  const likeClauses: string[] = [];
  const params: string[] = [request.pathFilter];
  for (const term of termSet) {
    const esc = escapeLike(term);
    likeClauses.push("lower(path) like ? escape '\\'", "lower(path) like ? escape '\\'", "lower(path) like ? escape '\\'", "lower(path) = ?");
    params.push(`%/${esc}.%`, `${esc}.%`, `%/${esc}`, esc);
  }
  const rows = db.prepare(`
    select path, language, 1 as startLine, 1 as endLine, 'file' as kind, path as text, 0 as rank, size, null as symbolName
    from files
    where path like ? escape '\\' and (${likeClauses.join(" or ")})
    order by length(path), path
  `).all(...params) as unknown as SearchRow[];
  return rows
    .filter((row) => termSet.has(fileStem(row.path)))
    .map((row) => toSearchCandidate(row, request.plan, 42, "basename_term"));
}

function endpointRouteCandidates(db: ReturnType<typeof openRepoDb>, request: SearchRetrievalRequest): SearchCandidateDiagnostic[] {
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
    .map((row) => toSearchCandidate(row, request.plan, 34, "endpoint_route"));
}

function roleIntentCandidates(db: ReturnType<typeof openRepoDb>, request: SearchRetrievalRequest): SearchCandidateDiagnostic[] {
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
    .map((row) => toSearchCandidate(row, request.plan, 18, "role_intent"));
}

function chunkFtsCandidates(
  db: ReturnType<typeof openRepoDb>,
  request: SearchRetrievalRequest & { ftsQuery: QueryPlan["ftsQueries"][number]; remaining: number },
): SearchCandidateDiagnostic[] {
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
  return rows.map((row) => toSearchCandidate(row, request.plan, request.ftsQuery.tierBoost + 1, "chunk_fts"));
}

// Guarantee code files a foothold in the candidate pool. On conceptual/UI-navigation queries the
// natural-language tokens match many doc chunks whose bm25 rank beats the code that implements the
// feature, so the per-query `order by rank limit ?` cutoff can drop every code file (verified on
// partflow: 0 code candidates of 36 for a UI-navigation query). This scans deeper into the ranked
// chunk matches and appends the top code-file chunks. Additive only — it never removes a doc hit.
function codeQuotaCandidates(
  db: ReturnType<typeof openRepoDb>,
  request: SearchRetrievalRequest & { ftsQuery: QueryPlan["ftsQueries"][number] },
): SearchCandidateDiagnostic[] {
  const rows = db.prepare(`
    select f.path, f.language, c.start_line as startLine, c.end_line as endLine, c.kind, c.text,
           bm25(chunks_fts) as rank, f.size as size, null as symbolName
    from chunks_fts
    join chunks c on c.id = chunks_fts.rowid
    join files f on f.id = c.file_id
    where chunks_fts match ? and f.path like ? escape '\\'
    order by rank
    limit ?
  `).all(request.ftsQuery.query, request.pathFilter, CODE_QUOTA_SCAN) as unknown as SearchRow[];
  return rows
    .filter((row) => isCodeLikePath(row.path))
    .slice(0, CODE_QUOTA_KEEP)
    .map((row) => toSearchCandidate(row, request.plan, request.ftsQuery.tierBoost + 1, "code_quota"));
}

function symbolFtsCandidates(
  db: ReturnType<typeof openRepoDb>,
  request: SearchRetrievalRequest & { ftsQuery: QueryPlan["ftsQueries"][number]; remaining: number },
): SearchCandidateDiagnostic[] {
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
  return rows.map((row) => toSearchCandidate(row, request.plan, request.ftsQuery.tierBoost + 4, "symbol_fts"));
}

function toSearchCandidate(row: SearchRow, plan: QueryPlan, boost: number, source: SearchCandidateSource): SearchCandidateDiagnostic {
  const scored = toScoredCandidate(row, plan, boost);
  return { source, result: scored.result, scoreDiagnostics: scored.diagnostics };
}

function matchedTermCount(text: string, terms: string[]): number {
  return terms.filter((term) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, "u").test(text)).length;
}

function fileStem(path: string): string {
  return (path.split("/").pop() ?? path).toLowerCase().replace(/(?:\.[^.]+)+$/, "");
}
