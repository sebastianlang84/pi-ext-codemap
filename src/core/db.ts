import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export function openRepoDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(here, "..", "..", "migrations");
  const files = ["001_init.sql", "002_fts.sql"];
  for (const file of files) {
    const path = join(migrationsDir, file);
    if (existsSync(path)) db.exec(readFileSync(path, "utf8"));
    else db.exec(fallbackSql);
  }
}

const fallbackSql = `
  create table if not exists meta (key text primary key, value text not null);
  create table if not exists files (id integer primary key, path text not null unique, language text not null, size integer not null, hash text not null, mtime_ms real not null, indexed_at text not null);
  create table if not exists chunks (id integer primary key, file_id integer not null references files(id) on delete cascade, ordinal integer not null, start_line integer not null, end_line integer not null, kind text not null, text text not null, unique(file_id, ordinal));
  create table if not exists symbols (id integer primary key, file_id integer not null references files(id) on delete cascade, name text not null, kind text not null, start_line integer not null, end_line integer, signature text);
  create virtual table if not exists chunks_fts using fts5(path, language, kind, text);
  create virtual table if not exists symbols_fts using fts5(path, name, kind, signature);
`;

export function readSql(path: string): string {
  return readFileSync(path, "utf8");
}
