import { openRepoDb } from "./db.ts";
import { readGitHead } from "./git-status.ts";
import { cheapIndexHealth, fullIndexHealth, readIndexStatusCounts } from "./index-health.ts";
import { applyIndexUpdate } from "./index-store.ts";
import { getRepoInfo, approveRepo, type StateOptions } from "./repo.ts";
import { normalizePathPrefix, scanRepo } from "./scanner.ts";
import type { IndexStats } from "./types.ts";

export function indexRepo(options: { cwd?: string; approve?: boolean; pathPrefix?: string } & StateOptions = {}): IndexStats & { dbPath: string; root: string; pathPrefix: string } {
  const stateOptions = { stateDir: options.stateDir };
  const info = options.approve ? approveRepo(options.cwd, "codemap_index", stateOptions) : getRepoInfo(options.cwd, stateOptions);
  if (!info.approved) throw new Error("Repository is not approved. Run codemap_index with approveRepo: true first.");
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  const db = openRepoDb(info.dbPath);
  const scan = scanRepo(info.root, { pathPrefix });
  try {
    const update = applyIndexUpdate({ db, files: scan.files, pathPrefix, indexedHead: readGitHead(info.root) });
    return { scanned: scan.files.length, indexed: update.indexed, skipped: scan.skipped, skippedReasons: scan.skippedReasons, removed: update.removed, warnings: scan.warnings, dbPath: info.dbPath, root: info.root, pathPrefix };
  } catch (error) {
    try { db.exec("rollback"); } catch { /* already closed or not in transaction */ }
    throw error;
  } finally {
    db.close();
  }
}

export function status(cwd = process.cwd(), options: { health?: "cheap" | "full"; pathPrefix?: string } & StateOptions = {}) {
  const healthMode = options.health ?? "cheap";
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  const info = getRepoInfo(cwd, { stateDir: options.stateDir });
  if (!info.approved) {
    return { ...info, readiness: "not_approved", indexed: false, files: 0, chunks: 0, symbols: 0, lastIndexedAt: null, indexedHead: null, health: healthMode, stale: false, changed: 0, missing: 0, deleted: 0, currentHead: null, headChanged: false, dirty: false, dirtyFiles: [], warnings: [] };
  }
  const db = openRepoDb(info.dbPath);
  try {
    const counts = readIndexStatusCounts(db, pathPrefix);
    const base = { ...info, ...counts, readiness: counts.indexed ? "ready" : "not_indexed", health: healthMode, pathPrefix };
    return { ...base, ...(healthMode === "cheap" ? cheapIndexHealth() : fullIndexHealth(db, info.root, pathPrefix)) };
  } finally {
    db.close();
  }
}
