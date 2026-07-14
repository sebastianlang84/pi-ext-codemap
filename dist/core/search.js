import { openRepoDb } from "./db.js";
import { getRepoInfo } from "./repo.js";
import { status } from "./indexer.js";
import { planQuery } from "./query-plan.js";
import { rankAndSlice, topHitConfidence } from "./ranking.js";
import { collectSearchCandidateDiagnostics, collectSearchCandidates, pathFilterForPrefix } from "./search-pipeline.js";
import { normalizePathPrefix } from "./scanner.js";
export function searchCodeMapWithDiagnostics(options) {
    const pathPrefix = normalizePathPrefix(options.pathPrefix);
    // Cheap (HEAD-based) health only: a full scan hashes the entire repo on every
    // search, which dominates latency on large repos. Search staleness is advisory
    // (see promptGuidelines); the file-level stale scan stays behind codemap_status --full.
    const diagnostics = status(options.cwd, { health: "cheap", pathPrefix, stateDir: options.stateDir });
    const results = searchCodeMap({ ...options, pathPrefix });
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
        results,
        topHitConfidence: topHitConfidence(results),
    };
}
export function searchCodeMap(options) {
    const info = getRepoInfo(options.cwd, { stateDir: options.stateDir });
    if (!info.approved)
        throw new Error("Repository is not approved/indexed yet. Run 'codemap index --approve' first (indexing is local-only; your repo is never modified).");
    const db = openRepoDb(info.dbPath);
    const limit = normalizedLimit(options.limit);
    const plan = planQuery(options.query);
    const pathPrefix = normalizePathPrefix(options.pathPrefix);
    try {
        const candidates = collectSearchCandidates(db, { plan, limit, pathFilter: pathFilterForPrefix(pathPrefix) });
        return rankAndSlice(candidates, limit);
    }
    finally {
        db.close();
    }
}
export function searchCodeMapDebug(options) {
    const info = getRepoInfo(options.cwd, { stateDir: options.stateDir });
    if (!info.approved)
        throw new Error("Repository is not approved/indexed yet. Run 'codemap index --approve' first (indexing is local-only; your repo is never modified).");
    const db = openRepoDb(info.dbPath);
    const limit = normalizedLimit(options.limit);
    const plan = planQuery(options.query);
    const pathPrefix = normalizePathPrefix(options.pathPrefix);
    try {
        const candidates = collectSearchCandidateDiagnostics(db, { plan, limit, pathFilter: pathFilterForPrefix(pathPrefix) });
        const results = rankAndSlice(candidates.map((candidate) => candidate.result), limit);
        const bestCandidateByPath = bestCandidateMap(candidates);
        const selectedRanks = selectedCandidateRanks(results, bestCandidateByPath);
        return {
            query: options.query,
            root: info.root,
            pathPrefix,
            limit,
            results,
            candidates: candidates.map((candidate) => ({
                path: candidate.result.path,
                language: candidate.result.language,
                startLine: candidate.result.startLine,
                endLine: candidate.result.endLine,
                kind: candidate.result.kind,
                source: candidate.source,
                score: candidate.result.score,
                decision: candidateDecision(candidate, selectedRanks, bestCandidateByPath),
                selectedRank: selectedRanks.get(candidate),
                scoreDiagnostics: candidate.scoreDiagnostics,
            })),
        };
    }
    finally {
        db.close();
    }
}
function normalizedLimit(limit) {
    return Math.min(Math.max(limit ?? 10, 1), 50);
}
function selectedCandidateRanks(results, bestCandidateByPath) {
    const ranks = new Map();
    results.forEach((result, index) => {
        const candidate = bestCandidateByPath.get(result.path);
        if (candidate)
            ranks.set(candidate, index + 1);
    });
    return ranks;
}
function bestCandidateMap(candidates) {
    const byPath = new Map();
    for (const candidate of candidates) {
        const previous = byPath.get(candidate.result.path);
        if (!previous || candidate.result.score > previous.result.score)
            byPath.set(candidate.result.path, candidate);
    }
    return byPath;
}
function candidateDecision(candidate, selectedRanks, bestCandidateByPath) {
    if (selectedRanks.has(candidate))
        return "selected";
    if (candidate.result.score <= 0)
        return "non_positive_score";
    if (bestCandidateByPath.get(candidate.result.path) !== candidate)
        return "deduped_lower_score";
    return "outside_limit";
}
