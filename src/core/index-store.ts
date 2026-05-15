import { chunkText } from "./chunker.ts";
import { openRepoDb } from "./db.ts";
import { extractSymbols } from "./symbols.ts";
import type { ScannedFile } from "./scanner.ts";

const INDEX_VERSION = "4";

export interface IndexStoreResult {
  indexed: number;
  removed: number;
}

export function applyIndexUpdate(options: {
  db: ReturnType<typeof openRepoDb>;
  files: ScannedFile[];
  pathPrefix: string;
}): IndexStoreResult {
  const { db, files, pathPrefix } = options;
  const indexVersionKey = pathPrefix ? `index_version:${pathPrefix}` : "index_version";
  const forceReindex = shouldForceReindex(db, indexVersionKey);
  const seen = new Set<string>();
  let indexed = 0;

  db.exec("begin immediate");
  for (const file of files) {
    seen.add(file.relPath);
    if (upsertIndexedFile(db, file, forceReindex)) indexed++;
  }
  const removed = removeDeletedFiles(db, seen, pathPrefix);
  writeIndexMetadata(db, indexVersionKey);
  db.exec("commit");
  return { indexed, removed };
}

function shouldForceReindex(db: ReturnType<typeof openRepoDb>, indexVersionKey: string): boolean {
  const storedIndexVersion = (db.prepare("select value from meta where key=?").get(indexVersionKey) as { value: string } | undefined)?.value;
  return storedIndexVersion !== INDEX_VERSION;
}

function writeIndexMetadata(db: ReturnType<typeof openRepoDb>, indexVersionKey: string): void {
  db.prepare("insert or replace into meta(key, value) values ('last_indexed_at', ?)").run(new Date().toISOString());
  db.prepare("insert or replace into meta(key, value) values (?, ?)").run(indexVersionKey, INDEX_VERSION);
}

function upsertIndexedFile(db: ReturnType<typeof openRepoDb>, file: ScannedFile, forceReindex: boolean): boolean {
  const existing = db.prepare("select id, hash, mtime_ms from files where path = ?").get(file.relPath) as { id: number; hash: string; mtime_ms: number } | undefined;
  if (!forceReindex && existing && existing.hash === file.hash && Math.round(existing.mtime_ms) === Math.round(file.mtimeMs)) return false;

  const fileId = writeFileRow(db, file, existing?.id);
  replaceChunks(db, fileId, file);
  replaceSymbols(db, fileId, file);
  return true;
}

function writeFileRow(db: ReturnType<typeof openRepoDb>, file: ScannedFile, existingId?: number): number {
  if (existingId) {
    db.prepare("update files set language=?, size=?, hash=?, mtime_ms=?, indexed_at=? where id=?")
      .run(file.language, file.size, file.hash, file.mtimeMs, new Date().toISOString(), existingId);
    db.prepare("delete from chunks where file_id=?").run(existingId);
    db.prepare("delete from symbols where file_id=?").run(existingId);
    db.prepare("delete from chunks_fts where path=?").run(file.relPath);
    db.prepare("delete from symbols_fts where path=?").run(file.relPath);
    return existingId;
  }

  const result = db.prepare("insert into files(path, language, size, hash, mtime_ms, indexed_at) values (?, ?, ?, ?, ?, ?)")
    .run(file.relPath, file.language, file.size, file.hash, file.mtimeMs, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

function replaceChunks(db: ReturnType<typeof openRepoDb>, fileId: number, file: ScannedFile): void {
  for (const chunk of chunkText(file.text, file.language)) {
    const result = db.prepare("insert into chunks(file_id, ordinal, start_line, end_line, kind, text) values (?, ?, ?, ?, ?, ?)")
      .run(fileId, chunk.ordinal, chunk.startLine, chunk.endLine, chunk.kind, chunk.text);
    db.prepare("insert into chunks_fts(rowid, path, language, kind, text) values (?, ?, ?, ?, ?)")
      .run(Number(result.lastInsertRowid), file.relPath, file.language, chunk.kind, chunk.text);
  }
}

function replaceSymbols(db: ReturnType<typeof openRepoDb>, fileId: number, file: ScannedFile): void {
  for (const symbol of extractSymbols(file.text, file.language)) {
    const result = db.prepare("insert into symbols(file_id, name, kind, start_line, end_line, signature) values (?, ?, ?, ?, ?, ?)")
      .run(fileId, symbol.name, symbol.kind, symbol.startLine, symbol.endLine ?? null, symbol.signature ?? null);
    db.prepare("insert into symbols_fts(rowid, path, name, kind, signature) values (?, ?, ?, ?, ?)")
      .run(Number(result.lastInsertRowid), file.relPath, symbol.name, symbol.kind, symbol.signature ?? "");
  }
}

function removeDeletedFiles(db: ReturnType<typeof openRepoDb>, seen: Set<string>, pathPrefix: string): number {
  const rows = db.prepare("select path from files").all() as Array<{ path: string }>;
  let removed = 0;
  for (const row of rows) {
    if (pathPrefix && !row.path.startsWith(pathPrefix)) continue;
    if (!seen.has(row.path)) {
      db.prepare("delete from chunks_fts where path=?").run(row.path);
      db.prepare("delete from symbols_fts where path=?").run(row.path);
      db.prepare("delete from files where path=?").run(row.path);
      removed++;
    }
  }
  return removed;
}
