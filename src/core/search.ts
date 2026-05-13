import { openRepoDb } from "./db.ts";
import { getRepoInfo } from "./repo.ts";
import { status } from "./indexer.ts";
import { planQuery } from "./query-plan.ts";
import { rankAndSlice } from "./ranking.ts";
import { collectSearchCandidates, pathFilterForPrefix } from "./search-pipeline.ts";
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

  try {
    const candidates = collectSearchCandidates(db, { plan, limit, pathFilter: pathFilterForPrefix(pathPrefix) });
    return rankAndSlice(candidates, limit);
  } finally {
    db.close();
  }
}
