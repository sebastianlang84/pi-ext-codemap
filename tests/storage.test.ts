import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

const storageHome = useIsolatedHome();

const { indexRepo, status } = await import("../src/core/indexer.ts");
const { searchCodeMap } = await import("../src/core/search.ts");
const { codemapContext } = await import("../src/core/context.ts");
const { getRepoInfo, repoKey } = await import("../src/core/repo.ts");

test("stateDir isolates approval registry and repo index DBs", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-state-seam-repo-"));
  const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-state-seam-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "isolated.ts"), `
export function isolatedFeature() {
  return true;
}
`);
  const defaultRegistryPath = join(storageHome, ".pi", "agent", "state", "codemap", "registry.sqlite");
  const defaultDbPath = join(storageHome, ".pi", "agent", "state", "codemap", "repos", `${repoKey(root)}.sqlite`);
  const defaultRegistryBefore = existsSync(defaultRegistryPath) ? statSync(defaultRegistryPath) : undefined;
  assert.equal(existsSync(defaultDbPath), false);

  const indexed = indexRepo({ cwd: root, approve: true, stateDir });
  const isolatedInfo = getRepoInfo(root, { stateDir });

  assert.equal(isolatedInfo.approved, true);
  assert.equal(indexed.dbPath, join(stateDir, "repos", `${isolatedInfo.key}.sqlite`));
  assert.ok(existsSync(join(stateDir, "registry.sqlite")));
  assert.ok(existsSync(indexed.dbPath));
  assert.equal(status(root, { stateDir }).readiness, "ready");
  assert.equal(searchCodeMap({ cwd: root, query: "isolatedFeature", stateDir })[0]?.path, "src/isolated.ts");
  assert.equal(codemapContext({ cwd: root, target: "isolatedFeature", stateDir }).root, root);

  assert.notEqual(defaultDbPath, isolatedInfo.dbPath);
  assert.equal(existsSync(defaultDbPath), false);
  if (defaultRegistryBefore) {
    const defaultRegistryAfter = statSync(defaultRegistryPath);
    assert.equal(defaultRegistryAfter.size, defaultRegistryBefore.size);
    assert.equal(defaultRegistryAfter.mtimeMs, defaultRegistryBefore.mtimeMs);
  } else {
    assert.equal(existsSync(defaultRegistryPath), false);
  }
});

test("old repo DBs migrate and reindex through public index and search paths", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-old-db-repo-"));
  const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-old-db-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "legacy.ts"), `
export function migratedNeedle() {
  return "current index content";
}
`);

  const info = getRepoInfo(root, { stateDir });
  mkdirSync(join(stateDir, "repos"), { recursive: true });
  const legacyDb = new DatabaseSync(info.dbPath);
  try {
    legacyDb.exec(`
      create table meta (key text primary key, value text not null);
      create table files (id integer primary key, path text not null unique, language text not null, size integer not null, hash text not null, mtime_ms real not null, indexed_at text not null);
      create table chunks (id integer primary key, file_id integer not null references files(id) on delete cascade, ordinal integer not null, start_line integer not null, end_line integer not null, kind text not null, text text not null, unique(file_id, ordinal));
      create table symbols (id integer primary key, file_id integer not null references files(id) on delete cascade, name text not null, kind text not null, start_line integer not null, end_line integer, signature text);
    `);
    legacyDb.prepare("insert into meta(key, value) values (?, ?)").run("index_version", "3");
    legacyDb.prepare("insert into files(id, path, language, size, hash, mtime_ms, indexed_at) values (?, ?, ?, ?, ?, ?, ?)")
      .run(1, "src/legacy.ts", "typescript", 12, "old-hash", 1, "2026-01-01T00:00:00.000Z");
    legacyDb.prepare("insert into chunks(file_id, ordinal, start_line, end_line, kind, text) values (?, ?, ?, ?, ?, ?)")
      .run(1, 0, 1, 1, "chunk", "stale legacy content");
    legacyDb.prepare("insert into symbols(file_id, name, kind, start_line, end_line, signature) values (?, ?, ?, ?, ?, ?)")
      .run(1, "staleLegacySymbol", "function", 1, 1, "staleLegacySymbol()");
  } finally {
    legacyDb.close();
  }

  const indexed = indexRepo({ cwd: root, approve: true, stateDir });
  assert.equal(indexed.dbPath, info.dbPath);
  assert.equal(indexed.indexed, 1);
  assert.equal(status(root, { stateDir }).readiness, "ready");
  assert.equal(searchCodeMap({ cwd: root, query: "migratedNeedle", stateDir, limit: 5 })[0]?.path, "src/legacy.ts");
  assert.deepEqual(searchCodeMap({ cwd: root, query: "staleLegacySymbol", stateDir, limit: 5 }), []);

  const migratedDb = new DatabaseSync(info.dbPath, { readOnly: true });
  try {
    const tables = new Set((migratedDb.prepare("select name from sqlite_master where type in ('table', 'virtual table')").all() as Array<{ name: string }>).map((row) => row.name));
    for (const table of ["meta", "files", "chunks", "symbols", "chunks_fts", "symbols_fts", "graph_nodes", "graph_edges"]) assert.ok(tables.has(table), `${table} should exist`);
    const indexes = new Set((migratedDb.prepare("select name from sqlite_master where type = 'index'").all() as Array<{ name: string }>).map((row) => row.name));
    for (const index of ["graph_edges_from_kind", "graph_edges_to_kind", "graph_edges_source_file", "graph_nodes_kind_path"]) assert.ok(indexes.has(index), `${index} should exist`);
    const nodeColumns = new Set((migratedDb.prepare("pragma table_info(graph_nodes)").all() as Array<{ name: string }>).map((row) => row.name));
    const edgeColumns = new Set((migratedDb.prepare("pragma table_info(graph_edges)").all() as Array<{ name: string }>).map((row) => row.name));
    assert.ok(!nodeColumns.has("symbol_id"));
    assert.ok(!edgeColumns.has("scope"));
    assert.ok(!edgeColumns.has("confidence"));
    assert.equal((migratedDb.prepare("select value from meta where key = 'index_version'").get() as { value: string }).value, "7");
    assert.equal((migratedDb.prepare("select value from meta where key = 'graph_version'").get() as { value: string }).value, "1");
    assert.equal((migratedDb.prepare("select count(*) as count from files where path = 'src/legacy.ts'").get() as { count: number }).count, 1);
  } finally {
    migratedDb.close();
  }
});

test("CodeMap uses state storage for registry and repo DBs", (t) => {
  const root = fixtureRepo(t);
  const info = getRepoInfo(root);

  assert.match(info.dbPath, /\.pi\/agent\/state\/codemap\/repos\//);
  assert.ok(existsSync(join(storageHome, ".pi", "agent", "state", "codemap", "registry.sqlite")));
  assert.ok(existsSync(info.dbPath));
});
