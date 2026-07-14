import { openRepoDb } from "./db.ts";
import { getRepoInfo, type StateOptions } from "./repo.ts";
import { status } from "./indexer.ts";
import { planQuery } from "./query-plan.ts";
import { rankAndSlice, topHitConfidence, type SearchScoreDiagnostics, type TopHitConfidence } from "./ranking.ts";
import { collectSearchCandidateDiagnostics, collectSearchCandidates, pathFilterForPrefix, type SearchCandidateDiagnostic, type SearchCandidateSource } from "./search-pipeline.ts";
import { normalizePathPrefix } from "./scanner.ts";
import type { SearchResult } from "./types.ts";

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
  topHitConfidence: TopHitConfidence;
}

export type SearchCandidateDecision = "selected" | "outside_limit" | "deduped_lower_score" | "non_positive_score";

export interface SearchCandidateDebugDiagnostic {
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  kind: string;
  source: SearchCandidateSource;
  score: number;
  decision: SearchCandidateDecision;
  selectedRank?: number;
  scoreDiagnostics: SearchScoreDiagnostics;
}

export interface CodeMapSearchDebugReport {
  query: string;
  root: string;
  pathPrefix: string;
  limit: number;
  results: SearchResult[];
  candidates: SearchCandidateDebugDiagnostic[];
}

export function searchCodeMapWithDiagnostics(options: { query: string; cwd?: string; limit?: number; pathPrefix?: string } & StateOptions): CodeMapSearchPackage {
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  // Cheap (HEAD-based) health only: a full scan hashes the entire repo on every
  // search, which dominates latency on large repos. Search staleness is advisory
  // (see promptGuidelines); the file-level stale scan stays behind codemap_status --full.
  const diagnostics = status(options.cwd, { health: "cheap", pathPrefix, stateDir: options.stateDir }) as SearchDiagnostics & { root: string };
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

export function searchCodeMap(options: { query: string; cwd?: string; limit?: number; pathPrefix?: string } & StateOptions): SearchResult[] {
  const info = getRepoInfo(options.cwd, { stateDir: options.stateDir });
  if (!info.approved) throw new Error("Repository is not approved/indexed yet. Run 'codemap index --approve' first (indexing is local-only; your repo is never modified).");
  const db = openRepoDb(info.dbPath);
  const limit = normalizedLimit(options.limit);
  const plan = planQuery(options.query);
  const pathPrefix = normalizePathPrefix(options.pathPrefix);

  try {
    const candidates = collectSearchCandidates(db, { plan, limit, pathFilter: pathFilterForPrefix(pathPrefix) });
    return rankAndSlice(candidates, limit);
  } finally {
    db.close();
  }
}

export function searchCodeMapDebug(options: { query: string; cwd?: string; limit?: number; pathPrefix?: string } & StateOptions): CodeMapSearchDebugReport {
  const info = getRepoInfo(options.cwd, { stateDir: options.stateDir });
  if (!info.approved) throw new Error("Repository is not approved/indexed yet. Run 'codemap index --approve' first (indexing is local-only; your repo is never modified).");
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
  } finally {
    db.close();
  }
}

function normalizedLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 10, 1), 50);
}

function selectedCandidateRanks(results: SearchResult[], bestCandidateByPath: Map<string, SearchCandidateDiagnostic>): Map<SearchCandidateDiagnostic, number> {
  const ranks = new Map<SearchCandidateDiagnostic, number>();
  results.forEach((result, index) => {
    const candidate = bestCandidateByPath.get(result.path);
    if (candidate) ranks.set(candidate, index + 1);
  });
  return ranks;
}

function bestCandidateMap(candidates: SearchCandidateDiagnostic[]): Map<string, SearchCandidateDiagnostic> {
  const byPath = new Map<string, SearchCandidateDiagnostic>();
  for (const candidate of candidates) {
    const previous = byPath.get(candidate.result.path);
    if (!previous || candidate.result.score > previous.result.score) byPath.set(candidate.result.path, candidate);
  }
  return byPath;
}

function candidateDecision(candidate: SearchCandidateDiagnostic, selectedRanks: Map<SearchCandidateDiagnostic, number>, bestCandidateByPath: Map<string, SearchCandidateDiagnostic>): SearchCandidateDecision {
  if (selectedRanks.has(candidate)) return "selected";
  if (candidate.result.score <= 0) return "non_positive_score";
  if (bestCandidateByPath.get(candidate.result.path) !== candidate) return "deduped_lower_score";
  return "outside_limit";
}
