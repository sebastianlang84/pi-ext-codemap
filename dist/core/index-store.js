import { chunkText } from "./chunker.js";
import { isGraphStale, rebuildFileReferenceGraph } from "./graph-store.js";
import { extractSymbols } from "./symbols.js";
// Bump on any change that alters stored chunks/symbols so existing indexes are rebuilt on next run.
// 8: line-based symbol extraction for Go/Rust/Java/Kotlin/Ruby/PHP.
export const INDEX_VERSION = "8";
function prepareWriteStatements(db) {
    return {
        selectFile: db.prepare("select id, hash, mtime_ms from files where path = ?"),
        updateFile: db.prepare("update files set language=?, size=?, hash=?, mtime_ms=?, indexed_at=? where id=?"),
        insertFile: db.prepare("insert into files(path, language, size, hash, mtime_ms, indexed_at) values (?, ?, ?, ?, ?, ?)"),
        clearChunksFts: db.prepare("delete from chunks_fts where rowid in (select id from chunks where file_id = ?)"),
        clearSymbolsFts: db.prepare("delete from symbols_fts where rowid in (select id from symbols where file_id = ?)"),
        deleteChunks: db.prepare("delete from chunks where file_id=?"),
        deleteSymbols: db.prepare("delete from symbols where file_id=?"),
        insertChunk: db.prepare("insert into chunks(file_id, ordinal, start_line, end_line, kind, text) values (?, ?, ?, ?, ?, ?)"),
        insertChunkFts: db.prepare("insert into chunks_fts(rowid, path, language, kind, text) values (?, ?, ?, ?, ?)"),
        insertSymbol: db.prepare("insert into symbols(file_id, name, kind, start_line, end_line, signature) values (?, ?, ?, ?, ?, ?)"),
        insertSymbolFts: db.prepare("insert into symbols_fts(rowid, path, name, kind, signature) values (?, ?, ?, ?, ?)"),
        selectAllFiles: db.prepare("select id, path from files"),
        deleteFileByPath: db.prepare("delete from files where path=?"),
    };
}
export function applyIndexUpdate(options) {
    const { db, files, pathPrefix, indexedHead, allowDeletions = true } = options;
    const indexVersionKey = pathPrefix ? `index_version:${pathPrefix}` : "index_version";
    const lastIndexedAtKey = pathPrefix ? `last_indexed_at:${pathPrefix}` : "last_indexed_at";
    const indexedHeadKey = pathPrefix ? `indexed_head:${pathPrefix}` : "indexed_head";
    const forceReindex = shouldForceReindex(db, indexVersionKey, INDEX_VERSION);
    const forceGraphRebuild = forceReindex || isGraphStale(db);
    const seen = new Set();
    let indexed = 0;
    db.exec("begin immediate");
    const stmts = prepareWriteStatements(db);
    for (const file of files) {
        seen.add(file.relPath);
        if (upsertIndexedFile(stmts, file, forceReindex))
            indexed++;
    }
    // Evaluate the deletion guard only now: with a streaming scan, `incomplete` is not settled until the
    // files iterable above is fully consumed.
    const deletionsAllowed = typeof allowDeletions === "function" ? allowDeletions() : allowDeletions;
    const removed = deletionsAllowed ? removeDeletedFiles(stmts, seen, pathPrefix) : 0;
    if (indexed > 0 || removed > 0 || forceGraphRebuild)
        rebuildFileReferenceGraph(db);
    writeIndexMetadata(db, indexVersionKey, lastIndexedAtKey, indexedHeadKey, indexedHead, INDEX_VERSION);
    db.exec("commit");
    return { indexed, removed };
}
function shouldForceReindex(db, indexVersionKey, expectedVersion) {
    const storedIndexVersion = db.prepare("select value from meta where key=?").get(indexVersionKey)?.value;
    return storedIndexVersion !== expectedVersion;
}
/**
 * True when the next index run will rewrite every file regardless of hash/mtime (index-version bump).
 * The scanner's mtime+size fast-skip must be disabled in that case, since forced rows need real
 * content — a skipped (text:"") entry would otherwise be re-chunked as empty.
 */
export function isReindexForced(db, pathPrefix) {
    const indexVersionKey = pathPrefix ? `index_version:${pathPrefix}` : "index_version";
    return shouldForceReindex(db, indexVersionKey, INDEX_VERSION);
}
/** Prior (path -> mtime/size/hash) for already-indexed files, used to skip re-reading unchanged files. */
export function readIndexedFileStats(db) {
    const rows = db.prepare("select path, mtime_ms as mtimeMs, size, hash from files").all();
    return new Map(rows.map((row) => [row.path, { mtimeMs: row.mtimeMs, size: row.size, hash: row.hash }]));
}
function writeIndexMetadata(db, indexVersionKey, lastIndexedAtKey, indexedHeadKey, indexedHead, indexVersion) {
    db.prepare("insert or replace into meta(key, value) values (?, ?)").run(lastIndexedAtKey, new Date().toISOString());
    db.prepare("insert or replace into meta(key, value) values (?, ?)").run(indexedHeadKey, indexedHead ?? "");
    db.prepare("insert or replace into meta(key, value) values (?, ?)").run(indexVersionKey, indexVersion);
}
function upsertIndexedFile(stmts, file, forceReindex) {
    const existing = stmts.selectFile.get(file.relPath);
    if (!forceReindex && existing && existing.hash === file.hash && Math.round(existing.mtime_ms) === Math.round(file.mtimeMs))
        return false;
    const fileId = writeFileRow(stmts, file, existing?.id);
    replaceChunks(stmts, fileId, file);
    replaceSymbols(stmts, fileId, file);
    return true;
}
function writeFileRow(stmts, file, existingId) {
    if (existingId) {
        stmts.updateFile.run(file.language, file.size, file.hash, file.mtimeMs, new Date().toISOString(), existingId);
        // Contentless FTS deletes by rowid, so clear index rows before the base rows they reference go away.
        clearFileFts(stmts, existingId);
        stmts.deleteChunks.run(existingId);
        stmts.deleteSymbols.run(existingId);
        return existingId;
    }
    const result = stmts.insertFile.run(file.relPath, file.language, file.size, file.hash, file.mtimeMs, new Date().toISOString());
    return Number(result.lastInsertRowid);
}
function replaceChunks(stmts, fileId, file) {
    for (const chunk of chunkText(file.text, file.language)) {
        const result = stmts.insertChunk.run(fileId, chunk.ordinal, chunk.startLine, chunk.endLine, chunk.kind, chunk.text);
        stmts.insertChunkFts.run(Number(result.lastInsertRowid), file.relPath, file.language, chunk.kind, chunk.text);
    }
}
function replaceSymbols(stmts, fileId, file) {
    for (const symbol of extractSymbols(file.text, file.language)) {
        const result = stmts.insertSymbol.run(fileId, symbol.name, symbol.kind, symbol.startLine, symbol.endLine ?? null, symbol.signature ?? null);
        stmts.insertSymbolFts.run(Number(result.lastInsertRowid), file.relPath, symbol.name, symbol.kind, symbol.signature ?? "");
    }
}
function removeDeletedFiles(stmts, seen, pathPrefix) {
    const rows = stmts.selectAllFiles.all();
    let removed = 0;
    for (const row of rows) {
        if (pathPrefix && !row.path.startsWith(pathPrefix))
            continue;
        if (!seen.has(row.path)) {
            // Clear FTS by rowid before the cascade drops the chunks/symbols those rowids point to.
            clearFileFts(stmts, row.id);
            stmts.deleteFileByPath.run(row.path);
            removed++;
        }
    }
    return removed;
}
// Delete a file's contentless-FTS index rows by rowid (chunks_fts.rowid = chunks.id, likewise symbols).
function clearFileFts(stmts, fileId) {
    stmts.clearChunksFts.run(fileId);
    stmts.clearSymbolsFts.run(fileId);
}
