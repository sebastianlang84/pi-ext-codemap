import { openRepoDb } from "./db.ts";
import { getRepoInfo, approveRepo } from "./repo.ts";
import { scanRepo } from "./scanner.ts";
import { chunkText } from "./chunker.ts";
import { extractSymbols } from "./symbols.ts";
import type { IndexStats } from "./types.ts";

export function indexRepo(options: { cwd?: string; approve?: boolean } = {}): IndexStats & { dbPath: string; root: string } {
  const info = options.approve ? approveRepo(options.cwd, "codebase_index") : getRepoInfo(options.cwd);
  if (!info.approved) throw new Error("Repository is not approved. Run codebase_index with approveRepo: true first.");
  const db = openRepoDb(info.dbPath);
  const scan = scanRepo(info.root);
  const seen = new Set<string>();
  let indexed = 0;

  try {
    db.exec("begin immediate");
    for (const file of scan.files) {
      seen.add(file.relPath);
      const existing = db.prepare("select id, hash, mtime_ms from files where path = ?").get(file.relPath) as { id: number; hash: string; mtime_ms: number } | undefined;
      if (existing && existing.hash === file.hash && Math.round(existing.mtime_ms) === Math.round(file.mtimeMs)) continue;

      let fileId = existing?.id;
      if (fileId) {
        db.prepare("update files set language=?, size=?, hash=?, mtime_ms=?, indexed_at=? where id=?")
          .run(file.language, file.size, file.hash, file.mtimeMs, new Date().toISOString(), fileId);
        db.prepare("delete from chunks where file_id=?").run(fileId);
        db.prepare("delete from symbols where file_id=?").run(fileId);
        db.prepare("delete from chunks_fts where path=?").run(file.relPath);
        db.prepare("delete from symbols_fts where path=?").run(file.relPath);
      } else {
        const result = db.prepare("insert into files(path, language, size, hash, mtime_ms, indexed_at) values (?, ?, ?, ?, ?, ?)")
          .run(file.relPath, file.language, file.size, file.hash, file.mtimeMs, new Date().toISOString());
        fileId = Number(result.lastInsertRowid);
      }

      for (const chunk of chunkText(file.text, file.language)) {
        const result = db.prepare("insert into chunks(file_id, ordinal, start_line, end_line, kind, text) values (?, ?, ?, ?, ?, ?)")
          .run(fileId, chunk.ordinal, chunk.startLine, chunk.endLine, chunk.kind, chunk.text);
        db.prepare("insert into chunks_fts(rowid, path, language, kind, text) values (?, ?, ?, ?, ?)")
          .run(Number(result.lastInsertRowid), file.relPath, file.language, chunk.kind, chunk.text);
      }

      for (const symbol of extractSymbols(file.text, file.language)) {
        const result = db.prepare("insert into symbols(file_id, name, kind, start_line, end_line, signature) values (?, ?, ?, ?, ?, ?)")
          .run(fileId, symbol.name, symbol.kind, symbol.startLine, symbol.endLine ?? null, symbol.signature ?? null);
        db.prepare("insert into symbols_fts(rowid, path, name, kind, signature) values (?, ?, ?, ?, ?)")
          .run(Number(result.lastInsertRowid), file.relPath, symbol.name, symbol.kind, symbol.signature ?? "");
      }
      indexed++;
    }
    const rows = db.prepare("select path from files").all() as Array<{ path: string }>;
    let removed = 0;
    for (const row of rows) {
      if (!seen.has(row.path)) {
        db.prepare("delete from chunks_fts where path=?").run(row.path);
        db.prepare("delete from symbols_fts where path=?").run(row.path);
        db.prepare("delete from files where path=?").run(row.path);
        removed++;
      }
    }
    db.prepare("insert or replace into meta(key, value) values ('last_indexed_at', ?)").run(new Date().toISOString());
    db.exec("commit");
    return { scanned: scan.files.length, indexed, skipped: scan.skipped, skippedReasons: scan.skippedReasons, removed, warnings: scan.warnings, dbPath: info.dbPath, root: info.root };
  } catch (error) {
    try { db.exec("rollback"); } catch { /* already closed or not in transaction */ }
    throw error;
  } finally {
    db.close();
  }
}

export function status(cwd = process.cwd()) {
  const info = getRepoInfo(cwd);
  if (!info.approved) return { ...info, indexed: false, files: 0, chunks: 0, symbols: 0, lastIndexedAt: null };
  const db = openRepoDb(info.dbPath);
  try {
    const files = (db.prepare("select count(*) as n from files").get() as { n: number }).n;
    const chunks = (db.prepare("select count(*) as n from chunks").get() as { n: number }).n;
    const symbols = (db.prepare("select count(*) as n from symbols").get() as { n: number }).n;
    const lastIndexedAt = (db.prepare("select value from meta where key='last_indexed_at'").get() as { value: string } | undefined)?.value ?? null;
    const health = indexHealth(db, info.root);
    return { ...info, indexed: files > 0, files, chunks, symbols, lastIndexedAt, ...health };
  } finally {
    db.close();
  }
}

function indexHealth(db: ReturnType<typeof openRepoDb>, root: string) {
  const scan = scanRepo(root);
  const rows = db.prepare("select path, hash from files").all() as Array<{ path: string; hash: string }>;
  const indexed = new Map(rows.map((row) => [row.path, row.hash]));
  const current = new Map(scan.files.map((file) => [file.relPath, file.hash]));
  let changed = 0;
  let missing = 0;
  let deleted = 0;
  for (const [path, hash] of current) {
    if (!indexed.has(path)) missing++;
    else if (indexed.get(path) !== hash) changed++;
  }
  for (const path of indexed.keys()) if (!current.has(path)) deleted++;
  const stale = changed > 0 || missing > 0 || deleted > 0;
  const warnings = [...scan.warnings];
  if (stale) warnings.push(`Index stale: ${changed} changed, ${missing} missing, ${deleted} deleted files.`);
  return { stale, changed, missing, deleted, skipped: scan.skipped, skippedReasons: scan.skippedReasons, warnings };
}
