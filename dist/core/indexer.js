import { openRepoDb } from "./db.js";
import { readGitHead } from "./git-status.js";
import { cheapIndexHealth, fullIndexHealth, readIndexStatusCounts } from "./index-health.js";
import { applyIndexUpdate, isReindexForced, readIndexedFileStats } from "./index-store.js";
import { getRepoInfo, approveRepo } from "./repo.js";
import { normalizePathPrefix, scanRepo } from "./scanner.js";
export function indexRepo(options = {}) {
    const stateOptions = { stateDir: options.stateDir };
    const info = options.approve ? approveRepo(options.cwd, "codemap_index", stateOptions) : getRepoInfo(options.cwd, stateOptions);
    if (!info.approved)
        throw new Error("Repository is not approved. Run 'codemap index --approve' first (indexing is local-only; your repo is never modified).");
    const pathPrefix = normalizePathPrefix(options.pathPrefix);
    const db = openRepoDb(info.dbPath);
    // Skip re-reading+hashing unchanged files (mtime+size match) unless an index-version bump forces a
    // full rewrite, in which case every file needs its real content re-chunked.
    const knownFiles = isReindexForced(db, pathPrefix) ? undefined : readIndexedFileStats(db);
    const scan = scanRepo(info.root, { pathPrefix, knownFiles });
    try {
        const update = applyIndexUpdate({ db, files: scan.files, pathPrefix, indexedHead: readGitHead(info.root), allowDeletions: !scan.incomplete });
        return { scanned: scan.files.length, indexed: update.indexed, skipped: scan.skipped, skippedReasons: scan.skippedReasons, removed: update.removed, warnings: scan.warnings, dbPath: info.dbPath, root: info.root, pathPrefix };
    }
    catch (error) {
        try {
            db.exec("rollback");
        }
        catch { /* already closed or not in transaction */ }
        throw error;
    }
    finally {
        db.close();
    }
}
export function status(cwd = process.cwd(), options = {}) {
    const healthMode = options.health ?? "cheap";
    const pathPrefix = normalizePathPrefix(options.pathPrefix);
    let info;
    try {
        info = getRepoInfo(cwd, { stateDir: options.stateDir });
    }
    catch (err) {
        if (!(err instanceof Error && err.message.startsWith("Not inside a Git repository"))) {
            throw err;
        }
        return { readiness: "not_git", root: cwd, key: "", remote: undefined, approved: false, dbPath: "", indexed: false, files: 0, chunks: 0, symbols: 0, lastIndexedAt: null, indexedHead: null, health: healthMode, stale: false, changed: 0, missing: 0, deleted: 0, currentHead: null, headChanged: false, dirty: false, dirtyFiles: [], warnings: [] };
    }
    if (!info.approved) {
        return { ...info, readiness: "not_approved", indexed: false, files: 0, chunks: 0, symbols: 0, lastIndexedAt: null, indexedHead: null, health: healthMode, stale: false, changed: 0, missing: 0, deleted: 0, currentHead: null, headChanged: false, dirty: false, dirtyFiles: [], warnings: [] };
    }
    const db = openRepoDb(info.dbPath);
    try {
        const counts = readIndexStatusCounts(db, pathPrefix);
        const base = { ...info, ...counts, readiness: counts.indexed ? "ready" : "not_indexed", health: healthMode, pathPrefix };
        return { ...base, ...(healthMode === "cheap" ? cheapIndexHealth(db, info.root, pathPrefix) : fullIndexHealth(db, info.root, pathPrefix)) };
    }
    finally {
        db.close();
    }
}
