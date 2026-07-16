import { TEXT_COVERAGE_WEIGHT, fileRoleBoost, fileRoles, isCodeLikePath, rankAndSlice, toScoredCandidate } from "./ranking.js";
import { escapeLike, escapeRegExp } from "./text-util.js";
// How deep to scan FTS-ranked chunks looking for code files that the per-source `limit` cutoff
// crowded out, and how many code chunks to guarantee into the pool per FTS query. Purely additive:
// the quota only appends candidates, so it can surface a crowded-out code target but never removes
// or reorders a doc hit (ranking still sorts by score). See the doc-flood ADR.
const CODE_QUOTA_SCAN = 60;
const CODE_QUOTA_KEEP = 6;
// A guaranteed foothold is for the code that *implements* the queried feature, not any code file
// that happens to share a stopword-ish token with the query. Without a floor, a generic test/util
// whose only overlap is a common term ("test", "config") gets force-added past the visible cutoff,
// and — because it may carry a role boost — can occupy a top-5 slot and crowd a genuinely on-topic
// hit out of the downstream read plan (regression caught by the reviewer-context-scout fixture).
// Require a code-quota rescue to cover a meaningful share of the query's core terms.
const CODE_QUOTA_MIN_COVERAGE = 0.2;
export function pathFilterForPrefix(pathPrefix) {
    return pathPrefix ? `${escapeLike(pathPrefix)}%` : "%";
}
export function collectSearchCandidates(db, request) {
    return collectSearchCandidateDiagnostics(db, request).map((candidate) => candidate.result);
}
export function collectSearchCandidateDiagnostics(db, request) {
    const candidates = [];
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
    return applyFileTextCoverage(candidates, request.plan, request.limit);
}
function applyFileTextCoverage(candidates, plan, limit) {
    if (plan.coreTerms.length === 0)
        return candidates;
    const matchedByPath = new Map();
    for (const candidate of candidates) {
        const matched = matchedByPath.get(candidate.result.path) ?? new Set();
        for (const term of candidate.scoreDiagnostics.matchedTokens)
            matched.add(term);
        matchedByPath.set(candidate.result.path, matched);
    }
    const visiblePaths = new Set(rankAndSlice(candidates.map((candidate) => candidate.result), limit).map((result) => result.path));
    return candidates.map((candidate) => {
        if (candidate.source !== "chunk_fts" || visiblePaths.has(candidate.result.path))
            return candidate;
        const matched = matchedByPath.get(candidate.result.path) ?? new Set();
        const matchedTokens = plan.coreTerms.filter((term) => matched.has(term));
        const tokenCoverage = matchedTokens.length / plan.coreTerms.length;
        const coverageBonus = Math.max(0, tokenCoverage - candidate.scoreDiagnostics.tokenCoverage) * TEXT_COVERAGE_WEIGHT;
        if (coverageBonus === 0)
            return candidate;
        const scoreDiagnostics = {
            ...candidate.scoreDiagnostics,
            finalScore: candidate.scoreDiagnostics.finalScore + coverageBonus,
            textCoverageScore: candidate.scoreDiagnostics.textCoverageScore + coverageBonus,
            tokenCoverage,
            matchedTokens,
        };
        return {
            ...candidate,
            result: { ...candidate.result, score: candidate.result.score + coverageBonus },
            scoreDiagnostics,
        };
    });
}
function pathMatchCandidates(db, request) {
    if (!request.plan.pathLike)
        return [];
    const rows = db.prepare(`
    select path, language, 1 as startLine, 1 as endLine, 'file' as kind, path as text, 0 as rank, size, null as symbolName
    from files
    where lower(path) like ? escape '\\' and path like ? escape '\\'
    order by length(path), path
    limit ?
  `).all(`%${escapeLike(request.plan.pathNeedle.toLowerCase())}%`, request.pathFilter, Math.min(request.limit, 20));
    return rows.map((row) => toSearchCandidate(row, request.plan, 30, "path_match"));
}
function basenameTermCandidates(db, request) {
    const terms = request.plan.pathTerms.filter((term) => /^[\p{L}\p{N}_-]{4,}$/u.test(term));
    if (terms.length === 0)
        return [];
    const termSet = new Set(terms.map((term) => term.toLowerCase()));
    // Pre-filter to files whose basename plausibly carries one of the terms directly in SQL, then keep
    // only exact basename-stem matches in JS. Previously this scanned the 500 shortest paths and stem-
    // filtered afterwards, so on repos with >500 files an exact-basename match on a long path was
    // silently dropped. The per-term LIKE set is selective, so no row cap is needed.
    const likeClauses = [];
    const params = [request.pathFilter];
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
  `).all(...params);
    return rows
        .filter((row) => termSet.has(fileStem(row.path)))
        .map((row) => toSearchCandidate(row, request.plan, 42, "basename_term"));
}
function endpointRouteCandidates(db, request) {
    if (!request.plan.coreTerms.includes("endpoint") || !request.plan.codeIntent || request.plan.endpointPathTerms.length === 0)
        return [];
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
  `).all(request.pathFilter);
    return rows
        .filter((row) => matchedTermCount(row.path.toLowerCase(), request.plan.endpointPathTerms) > 0)
        .map((row) => toSearchCandidate(row, request.plan, 34, "endpoint_route"));
}
function roleIntentCandidates(db, request) {
    const candidateRoleIntents = request.plan.roleIntents.filter((intent) => intent !== "implementation");
    if (candidateRoleIntents.length === 0)
        return [];
    const rows = db.prepare(`
    select f.path, f.language, 1 as startLine, 1 as endLine, 'file' as kind,
           coalesce(c.text, f.path) as text, 0 as rank, f.size as size, null as symbolName
    from files f
    left join chunks c on c.file_id = f.id and c.ordinal = 0
    where f.path like ? escape '\\'
    order by length(f.path), f.path
    limit 500
  `).all(request.pathFilter);
    return rows
        .filter((row) => fileRoleBoost(fileRoles(row.path.toLowerCase(), row.size ?? undefined), candidateRoleIntents) > 0)
        .filter((row) => !fileRoles(row.path.toLowerCase(), row.size ?? undefined).includes("tests") || matchedTermCount(`${row.path}\n${row.text}`.toLowerCase(), request.plan.coreTerms) >= 3)
        .map((row) => toSearchCandidate(row, request.plan, 18, "role_intent"));
}
function chunkFtsCandidates(db, request) {
    const rows = db.prepare(`
    select f.path, f.language, c.start_line as startLine, c.end_line as endLine, c.kind, c.text,
           bm25(chunks_fts) as rank, f.size as size, null as symbolName
    from chunks_fts
    join chunks c on c.id = chunks_fts.rowid
    join files f on f.id = c.file_id
    where chunks_fts match ? and f.path like ? escape '\\'
    order by rank
    limit ?
  `).all(request.ftsQuery.query, request.pathFilter, request.remaining);
    return rows.map((row) => toSearchCandidate(row, request.plan, request.ftsQuery.tierBoost + 1, "chunk_fts"));
}
// Guarantee code files a foothold in the candidate pool. On conceptual/UI-navigation queries the
// natural-language tokens match many doc chunks whose bm25 rank beats the code that implements the
// feature, so the per-query `order by rank limit ?` cutoff can drop every code file (verified on
// partflow: 0 code candidates of 36 for a UI-navigation query). This scans deeper into the ranked
// chunk matches and appends the top code-file chunks. Additive only — it never removes a doc hit.
function codeQuotaCandidates(db, request) {
    const rows = db.prepare(`
    select f.path, f.language, c.start_line as startLine, c.end_line as endLine, c.kind, c.text,
           bm25(chunks_fts) as rank, f.size as size, null as symbolName
    from chunks_fts
    join chunks c on c.id = chunks_fts.rowid
    join files f on f.id = c.file_id
    where chunks_fts match ? and f.path like ? escape '\\'
    order by rank
    limit ?
  `).all(request.ftsQuery.query, request.pathFilter, CODE_QUOTA_SCAN);
    return rows
        .filter((row) => isCodeLikePath(row.path))
        .map((row) => toSearchCandidate(row, request.plan, request.ftsQuery.tierBoost + 1, "code_quota"))
        .filter((candidate) => candidate.scoreDiagnostics.tokenCoverage >= CODE_QUOTA_MIN_COVERAGE)
        .slice(0, CODE_QUOTA_KEEP);
}
function symbolFtsCandidates(db, request) {
    const rows = db.prepare(`
    select f.path, f.language, s.start_line as startLine, coalesce(s.end_line, s.start_line) as endLine,
           s.kind, coalesce(s.signature, s.name) as text, bm25(symbols_fts) as rank, f.size as size, s.name as symbolName
    from symbols_fts
    join symbols s on s.id = symbols_fts.rowid
    join files f on f.id = s.file_id
    where symbols_fts match ? and f.path like ? escape '\\'
    order by rank
    limit ?
  `).all(request.ftsQuery.query, request.pathFilter, Math.ceil(request.remaining / 2));
    return rows.map((row) => toSearchCandidate(row, request.plan, request.ftsQuery.tierBoost + 4, "symbol_fts"));
}
function toSearchCandidate(row, plan, boost, source) {
    const scored = toScoredCandidate(row, plan, boost);
    return { source, result: scored.result, scoreDiagnostics: scored.diagnostics };
}
function matchedTermCount(text, terms) {
    return terms.filter((term) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}($|[^\\p{L}\\p{N}])`, "u").test(text)).length;
}
function fileStem(path) {
    return (path.split("/").pop() ?? path).toLowerCase().replace(/(?:\.[^.]+)+$/, "");
}
