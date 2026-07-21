import { chunkText } from "./chunker.ts";
import { openRepoDb } from "./db.ts";
import { isGraphStale, rebuildFileReferenceGraph } from "./graph-store.ts";
import { extractSymbols } from "./symbols.ts";
import type { ScannedFile } from "./scanner.ts";

// Bump on any change that alters stored chunks/symbols so existing indexes are rebuilt on next run.
// 8: line-based symbol extraction for Go/Rust/Java/Kotlin/Ruby/PHP.
export const INDEX_VERSION = "8";

type Db = ReturnType<typeof openRepoDb>;
type Stmt = ReturnType<Db["prepare"]>;

export interface IndexStoreResult {
  indexed: number;
  removed: number;
}

// The write path touches one file per iteration; preparing each statement once per update (instead
// of on every row) keeps re-index cost proportional to change size rather than paying a fresh
// db.prepare() per chunk/symbol/file.
interface WriteStatements {
  selectFile: Stmt;
  updateFile: Stmt;
  insertFile: Stmt;
  clearChunksFts: Stmt;
  clearSymbolsFts: Stmt;
  deleteChunks: Stmt;
  deleteSymbols: Stmt;
  insertChunk: Stmt;
  insertChunkFts: Stmt;
  insertSymbol: Stmt;
  insertSymbolFts: Stmt;
  selectAllFiles: Stmt;
  deleteFileByPath: Stmt;
}

function prepareWriteStatements(db: Db): WriteStatements {
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

export function applyIndexUpdate(options: {
  db: ReturnType<typeof openRepoDb>;
  files: Iterable<ScannedFile>;
  pathPrefix: string;
  indexedHead: string | null;
  /**
   * When false, the deletion pass is skipped and nothing is pruned. The scanner sets this via
   * `scan.incomplete` so an aborted/partial traversal (unreadable dir, mid-scan I/O error) can never
   * mistake unvisited files for deleted ones and wipe them from the index. May be a callback, which is
   * evaluated AFTER the files iterable is fully consumed — required when streaming, since `incomplete`
   * is only final once the scan generator has finished.
   */
  allowDeletions?: boolean | (() => boolean);
}): IndexStoreResult {
  const { db, files, pathPrefix, indexedHead, allowDeletions = true } = options;
  const indexVersionKey = pathPrefix ? `index_version:${pathPrefix}` : "index_version";
  const lastIndexedAtKey = pathPrefix ? `last_indexed_at:${pathPrefix}` : "last_indexed_at";
  const indexedHeadKey = pathPrefix ? `indexed_head:${pathPrefix}` : "indexed_head";
  const forceReindex = shouldForceReindex(db, indexVersionKey, INDEX_VERSION);
  const forceGraphRebuild = forceReindex || isGraphStale(db);
  const seen = new Set<string>();
  let indexed = 0;

  db.exec("begin immediate");
  const stmts = prepareWriteStatements(db);
  for (const file of files) {
    seen.add(file.relPath);
    if (upsertIndexedFile(stmts, file, forceReindex)) indexed++;
  }
  // Evaluate the deletion guard only now: with a streaming scan, `incomplete` is not settled until the
  // files iterable above is fully consumed.
  const deletionsAllowed = typeof allowDeletions === "function" ? allowDeletions() : allowDeletions;
  const removed = deletionsAllowed ? removeDeletedFiles(stmts, seen, pathPrefix) : 0;
  if (indexed > 0 || removed > 0 || forceGraphRebuild) rebuildFileReferenceGraph(db);
  writeIndexMetadata(db, indexVersionKey, lastIndexedAtKey, indexedHeadKey, indexedHead, INDEX_VERSION);
  db.exec("commit");
  return { indexed, removed };
}

function shouldForceReindex(db: ReturnType<typeof openRepoDb>, indexVersionKey: string, expectedVersion: string): boolean {
  const storedIndexVersion = (db.prepare("select value from meta where key=?").get(indexVersionKey) as { value: string } | undefined)?.value;
  return storedIndexVersion !== expectedVersion;
}

/**
 * True when the next index run will rewrite every file regardless of hash/mtime (index-version bump).
 * The scanner's mtime+size fast-skip must be disabled in that case, since forced rows need real
 * content — a skipped (text:"") entry would otherwise be re-chunked as empty.
 */
export function isReindexForced(db: ReturnType<typeof openRepoDb>, pathPrefix: string): boolean {
  const indexVersionKey = pathPrefix ? `index_version:${pathPrefix}` : "index_version";
  return shouldForceReindex(db, indexVersionKey, INDEX_VERSION);
}

/** Prior (path -> mtime/size/hash) for already-indexed files, used to skip re-reading unchanged files. */
export function readIndexedFileStats(db: ReturnType<typeof openRepoDb>): Map<string, { mtimeMs: number; size: number; hash: string }> {
  const rows = db.prepare("select path, mtime_ms as mtimeMs, size, hash from files").all() as Array<{ path: string; mtimeMs: number; size: number; hash: string }>;
  return new Map(rows.map((row) => [row.path, { mtimeMs: row.mtimeMs, size: row.size, hash: row.hash }]));
}

function writeIndexMetadata(db: ReturnType<typeof openRepoDb>, indexVersionKey: string, lastIndexedAtKey: string, indexedHeadKey: string, indexedHead: string | null, indexVersion: string): void {
  db.prepare("insert or replace into meta(key, value) values (?, ?)").run(lastIndexedAtKey, new Date().toISOString());
  db.prepare("insert or replace into meta(key, value) values (?, ?)").run(indexedHeadKey, indexedHead ?? "");
  db.prepare("insert or replace into meta(key, value) values (?, ?)").run(indexVersionKey, indexVersion);
}

function upsertIndexedFile(stmts: WriteStatements, file: ScannedFile, forceReindex: boolean): boolean {
  const existing = stmts.selectFile.get(file.relPath) as { id: number; hash: string; mtime_ms: number } | undefined;
  if (!forceReindex && existing && existing.hash === file.hash && Math.round(existing.mtime_ms) === Math.round(file.mtimeMs)) return false;

  const fileId = writeFileRow(stmts, file, existing?.id);
  replaceChunks(stmts, fileId, file);
  replaceSymbols(stmts, fileId, file);
  return true;
}

function writeFileRow(stmts: WriteStatements, file: ScannedFile, existingId?: number): number {
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

function replaceChunks(stmts: WriteStatements, fileId: number, file: ScannedFile): void {
  for (const chunk of chunkText(file.text, file.language)) {
    const result = stmts.insertChunk.run(fileId, chunk.ordinal, chunk.startLine, chunk.endLine, chunk.kind, chunk.text);
    stmts.insertChunkFts.run(Number(result.lastInsertRowid), file.relPath, file.language, chunk.kind, chunk.text);
  }
}

function replaceSymbols(stmts: WriteStatements, fileId: number, file: ScannedFile): void {
  for (const symbol of extractSymbols(file.text, file.language)) {
    const result = stmts.insertSymbol.run(fileId, symbol.name, symbol.kind, symbol.startLine, symbol.endLine ?? null, symbol.signature ?? null);
    stmts.insertSymbolFts.run(Number(result.lastInsertRowid), file.relPath, symbol.name, symbol.kind, symbol.signature ?? "");
  }
}

function removeDeletedFiles(stmts: WriteStatements, seen: Set<string>, pathPrefix: string): number {
  const rows = stmts.selectAllFiles.all() as Array<{ id: number; path: string }>;
  let removed = 0;
  for (const row of rows) {
    if (pathPrefix && !row.path.startsWith(pathPrefix)) continue;
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
function clearFileFts(stmts: WriteStatements, fileId: number): void {
  stmts.clearChunksFts.run(fileId);
  stmts.clearSymbolsFts.run(fileId);
}
