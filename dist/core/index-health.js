import { readGitHead, readGitWorkingTreeStatus } from "./git-status.js";
import { readIndexedFileStats } from "./index-store.js";
import { scanRepo } from "./scanner.js";
import { escapeLike } from "./text-util.js";
export function readIndexStatusCounts(db, pathPrefix = "") {
    const pathFilter = pathPrefix ? `${escapeLike(pathPrefix)}%` : "";
    const files = pathPrefix
        ? db.prepare("select count(*) as n from files where path like ? escape '\\'").get(pathFilter).n
        : db.prepare("select count(*) as n from files").get().n;
    const chunks = pathPrefix
        ? db.prepare("select count(*) as n from chunks join files f on f.id = chunks.file_id where f.path like ? escape '\\'").get(pathFilter).n
        : db.prepare("select count(*) as n from chunks").get().n;
    const symbols = pathPrefix
        ? db.prepare("select count(*) as n from symbols join files f on f.id = symbols.file_id where f.path like ? escape '\\'").get(pathFilter).n
        : db.prepare("select count(*) as n from symbols").get().n;
    const lastIndexedAt = readPathAwareMeta(db, "last_indexed_at", pathPrefix);
    const indexedHead = readPathAwareMeta(db, "indexed_head", pathPrefix);
    return { indexed: files > 0, files, chunks, symbols, lastIndexedAt, indexedHead };
}
export function cheapIndexHealth(db, root, pathPrefix = "") {
    const currentHead = readGitHead(root);
    const indexedHead = readPathAwareMeta(db, "indexed_head", pathPrefix);
    const headChanged = Boolean(indexedHead && currentHead && indexedHead !== currentHead);
    const warnings = [];
    let stale;
    if (currentHead === null && indexedHead !== null) {
        // HEAD became unreadable after the index was built against a real commit
        stale = true;
        warnings.push("Git HEAD unreadable — index may be stale.");
    }
    else if (headChanged) {
        stale = true;
        warnings.push("Git HEAD changed since last index.");
    }
    else if (currentHead !== null && indexedHead === null) {
        // Repo has commits but was never indexed with a HEAD baseline
        stale = true;
        warnings.push("No indexed HEAD baseline — index may be stale.");
    }
    else {
        stale = false;
    }
    return { stale, changed: 0, missing: 0, deleted: 0, currentHead, headChanged, dirty: false, dirtyFiles: [], warnings };
}
export function fullIndexHealth(db, root, pathPrefix = "") {
    // Reuse the indexer's mtime+size fastpath so unchanged files are not re-read and re-hashed on every
    // `context` / `status --health full` call: a single files read serves both the scanner fastpath and
    // the comparison map. `text` is never consumed here (only `hash`), so — unlike the incremental
    // indexer (indexer.ts) — no forced-reindex guard is needed. The `path = ?`/LIKE-prefix filter the
    // old query used is equivalent to `startsWith(pathPrefix)` (pathPrefix is a normalized dir prefix).
    const knownFiles = readIndexedFileStats(db);
    const scan = scanRepo(root, { pathPrefix, knownFiles });
    const indexed = new Map();
    for (const [path, stat] of knownFiles) {
        if (!pathPrefix || path.startsWith(pathPrefix))
            indexed.set(path, stat.hash);
    }
    const current = new Map(scan.files.map((file) => [file.relPath, file.hash]));
    let changed = 0;
    let missing = 0;
    let deleted = 0;
    for (const [path, hash] of current) {
        if (!indexed.has(path))
            missing++;
        else if (indexed.get(path) !== hash)
            changed++;
    }
    for (const path of indexed.keys())
        if (!current.has(path))
            deleted++;
    const fileDrift = changed > 0 || missing > 0 || deleted > 0;
    const warnings = [...scan.warnings];
    if (fileDrift)
        warnings.push(`Index stale: ${changed} changed, ${missing} missing, ${deleted} deleted files.`);
    const indexedHead = readPathAwareMeta(db, "indexed_head", pathPrefix);
    const git = readGitWorkingTreeStatus(root, pathPrefix);
    const headChanged = Boolean(indexedHead && git.currentHead && indexedHead !== git.currentHead);
    const dirtyFiles = git.dirtyFiles;
    const dirty = dirtyFiles.length > 0;
    const hasIndexedGitBaseline = Boolean(indexedHead && git.currentHead);
    if (headChanged)
        warnings.push("Git HEAD changed since last index.");
    if (dirty && hasIndexedGitBaseline)
        warnings.push(`Working tree dirty: ${dirtyFiles.length} file${dirtyFiles.length === 1 ? "" : "s"}.`);
    const stale = fileDrift || headChanged || (dirty && hasIndexedGitBaseline);
    return { stale, changed, missing, deleted, skipped: scan.skipped, skippedReasons: scan.skippedReasons, currentHead: git.currentHead, headChanged, dirty, dirtyFiles, warnings };
}
function readPathAwareMeta(db, baseKey, pathPrefix) {
    const scoped = pathPrefix ? readMeta(db, `${baseKey}:${pathPrefix}`) : null;
    return scoped ?? readMeta(db, baseKey);
}
function readMeta(db, key) {
    const value = db.prepare("select value from meta where key=?").get(key)?.value ?? null;
    return value || null;
}
