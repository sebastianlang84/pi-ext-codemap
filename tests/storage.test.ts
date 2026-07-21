import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

const storageHome = useIsolatedHome();

const { indexRepo, status } = await import("../src/core/indexer.ts");
const { searchCodeMap } = await import("../src/core/search.ts");
const { codemapContext } = await import("../src/core/context.ts");
const { getRepoInfo, repoKey, listRegistryRepos, approveRepo, resolveStateDir } = await import("../src/core/repo.ts");
const { scanRepo, scanRepoStream, createScanState } = await import("../src/core/scanner.ts");

test("scanRepoStream yields the same files and state as the eager scanRepo", (t) => {
  const root = fixtureRepo(t);
  const eager = scanRepo(root);
  const state = createScanState();
  const streamed = [...scanRepoStream(root, {}, state)];

  assert.deepEqual(
    streamed.map((file) => file.relPath).sort(),
    eager.files.map((file) => file.relPath).sort(),
    "streamed and eager scans visit the same files",
  );
  assert.ok(eager.files.length > 0, "fixture has scannable files");
  assert.equal(state.scanned, eager.files.length);
  assert.equal(state.skipped, eager.skipped);
  assert.equal(state.incomplete, eager.incomplete);
  assert.deepEqual(state.skippedReasons, eager.skippedReasons);
});
const { collectStateGcCandidates, pruneState } = await import("../src/core/state-gc.ts");
const { GRAPH_VERSION } = await import("../src/core/graph-store.ts");
const { INDEX_VERSION } = await import("../src/core/index-store.ts");

function withStateEnv(
  values: Partial<Record<"HOME" | "USERPROFILE" | "CODEMAP_HOME" | "XDG_DATA_HOME", string | undefined>>,
  run: () => void,
): void {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("state directory priority is explicit path, CODEMAP_HOME, then XDG_DATA_HOME", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codemap-state-priority-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const explicit = join(root, "explicit");
  const codemapHome = join(root, "codemap-home");
  const xdgDataHome = join(root, "xdg-data");
  withStateEnv({ CODEMAP_HOME: codemapHome, XDG_DATA_HOME: xdgDataHome }, () => {
    assert.equal(resolveStateDir(explicit), resolve(explicit));
    assert.equal(resolveStateDir(), resolve(codemapHome));
  });

  withStateEnv({ CODEMAP_HOME: undefined, XDG_DATA_HOME: xdgDataHome }, () => {
    assert.equal(resolveStateDir(), join(resolve(xdgDataHome), "codemap"));
  });
});

test("state directory defaults to the platform-neutral user data path", (t) => {
  const home = mkdtempSync(join(tmpdir(), "codemap-state-default-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));

  withStateEnv({ HOME: home, USERPROFILE: home, CODEMAP_HOME: undefined, XDG_DATA_HOME: undefined }, () => {
    assert.equal(resolveStateDir(), join(home, ".local", "share", "codemap"));
  });
});

test("state directory keeps using existing Pi state until the new default exists", (t) => {
  const home = mkdtempSync(join(tmpdir(), "codemap-state-legacy-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const legacyStateDir = join(home, ".pi", "agent", "state", "codemap");
  const newStateDir = join(home, ".local", "share", "codemap");
  const xdgDataHome = join(home, "xdg-data");
  mkdirSync(legacyStateDir, { recursive: true });

  withStateEnv({ HOME: home, USERPROFILE: home, CODEMAP_HOME: undefined, XDG_DATA_HOME: xdgDataHome }, () => {
    assert.equal(resolveStateDir(), join(xdgDataHome, "codemap"));
  });

  withStateEnv({ HOME: home, USERPROFILE: home, CODEMAP_HOME: undefined, XDG_DATA_HOME: undefined }, () => {
    assert.equal(resolveStateDir(), legacyStateDir);
    mkdirSync(newStateDir, { recursive: true });
    assert.equal(resolveStateDir(), newStateDir);
  });
});

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
  const defaultRegistryPath = join(storageHome, ".local", "share", "codemap", "registry.sqlite");
  const defaultDbPath = join(storageHome, ".local", "share", "codemap", "repos", `${repoKey(root)}.sqlite`);
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
    assert.equal((migratedDb.prepare("select value from meta where key = 'index_version'").get() as { value: string }).value, INDEX_VERSION);
    assert.equal((migratedDb.prepare("select value from meta where key = 'graph_version'").get() as { value: string }).value, GRAPH_VERSION);
    assert.equal((migratedDb.prepare("select count(*) as count from files where path = 'src/legacy.ts'").get() as { count: number }).count, 1);
  } finally {
    migratedDb.close();
  }
});

test("legacy content-owning FTS converts to contentless and stays searchable without reindex", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-legacy-fts-repo-"));
  const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-legacy-fts-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });

  const info = getRepoInfo(root, { stateDir });
  approveRepo(root, "test", { stateDir });
  mkdirSync(join(stateDir, "repos"), { recursive: true });

  const chunkText = "export function needleForFts() {\n  return 1;\n}\n";
  const legacyDb = new DatabaseSync(info.dbPath);
  try {
    legacyDb.exec(`
      create table meta (key text primary key, value text not null);
      create table files (id integer primary key, path text not null unique, language text not null, size integer not null, hash text not null, mtime_ms real not null, indexed_at text not null);
      create table chunks (id integer primary key, file_id integer not null references files(id) on delete cascade, ordinal integer not null, start_line integer not null, end_line integer not null, kind text not null, text text not null, unique(file_id, ordinal));
      create table symbols (id integer primary key, file_id integer not null references files(id) on delete cascade, name text not null, kind text not null, start_line integer not null, end_line integer, signature text);
      create virtual table chunks_fts using fts5(path, language, kind, text);
      create virtual table symbols_fts using fts5(path, name, kind, signature);
    `);
    for (const [key, value] of [["index_version", "7"], ["last_indexed_at", "2026-01-01T00:00:00.000Z"], ["indexed_head", ""]] as const) {
      legacyDb.prepare("insert into meta(key, value) values (?, ?)").run(key, value);
    }
    legacyDb.prepare("insert into files(id, path, language, size, hash, mtime_ms, indexed_at) values (?, ?, ?, ?, ?, ?, ?)")
      .run(1, "src/legacy-fts.ts", "typescript", chunkText.length, "legacy-hash", 1, "2026-01-01T00:00:00.000Z");
    legacyDb.prepare("insert into chunks(id, file_id, ordinal, start_line, end_line, kind, text) values (?, ?, ?, ?, ?, ?, ?)")
      .run(1, 1, 0, 1, 3, "chunk", chunkText);
    legacyDb.prepare("insert into chunks_fts(rowid, path, language, kind, text) values (?, ?, ?, ?, ?)")
      .run(1, "src/legacy-fts.ts", "typescript", "chunk", chunkText);
    legacyDb.prepare("insert into symbols(id, file_id, name, kind, start_line, end_line, signature) values (?, ?, ?, ?, ?, ?, ?)")
      .run(1, 1, "needleForFts", "function", 1, 3, "needleForFts()");
    legacyDb.prepare("insert into symbols_fts(rowid, path, name, kind, signature) values (?, ?, ?, ?, ?)")
      .run(1, "src/legacy-fts.ts", "needleForFts", "function", "needleForFts()");
  } finally {
    legacyDb.close();
  }

  // Opening through search triggers migrate() -> contentless conversion + repopulate; no reindex runs.
  const results = searchCodeMap({ cwd: root, query: "needleForFts", stateDir, limit: 5 });
  assert.equal(results[0]?.path, "src/legacy-fts.ts");

  const migrated = new DatabaseSync(info.dbPath, { readOnly: true });
  try {
    for (const name of ["chunks_fts", "symbols_fts"]) {
      const sql = (migrated.prepare("select sql from sqlite_master where name = ?").get(name) as { sql: string }).sql;
      assert.match(sql, /contentless_delete/, `${name} should be contentless`);
      const shadow = migrated.prepare("select name from sqlite_master where name = ?").get(`${name}_content`);
      assert.equal(shadow, undefined, `${name}_content shadow (duplicated text) should be gone`);
    }
  } finally {
    migrated.close();
  }
});

test("state GC reclaims deleted-repo and orphan index DBs without touching live repos", (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-gc-state-"));
  const liveRoot = mkdtempSync(join(tmpdir(), "pi-codemap-gc-live-"));
  const goneRoot = mkdtempSync(join(tmpdir(), "pi-codemap-gc-gone-"));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  t.after(() => rmSync(liveRoot, { recursive: true, force: true }));
  t.after(() => rmSync(goneRoot, { recursive: true, force: true }));

  for (const root of [liveRoot, goneRoot]) {
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "keep.ts"), "export function keepFeature() {\n  return true;\n}\n");
    indexRepo({ cwd: root, approve: true, stateDir });
  }

  // An orphan DB: a repo DB file with no registry row (approval was dropped but the index lingered).
  const orphanKey = "0".repeat(24);
  writeFileSync(join(stateDir, "repos", `${orphanKey}.sqlite`), "not-a-real-db");

  // Simulate a deleted repo: remove the working tree, keep its index DB + registry row.
  const goneKey = repoKey(goneRoot);
  rmSync(goneRoot, { recursive: true, force: true });

  const plan = collectStateGcCandidates({ stateDir });
  assert.equal(plan.applied, false);
  assert.equal(plan.repoDbCount, 3);
  assert.equal(plan.registryRepoCount, 2);
  const byKey = new Map(plan.candidates.map((candidate) => [candidate.key, candidate]));
  assert.equal(byKey.get(orphanKey)?.reason, "orphan_db");
  assert.equal(byKey.get(goneKey)?.reason, "missing_root");
  assert.equal(byKey.get(goneKey)?.rootPath, goneRoot);
  assert.ok((byKey.get(goneKey)?.bytes ?? 0) > 0);
  assert.equal(byKey.has(repoKey(liveRoot)), false, "live repo DB must not be a candidate");
  assert.equal(plan.reclaimableBytes, plan.candidates.reduce((sum, candidate) => sum + candidate.bytes, 0));

  const applied = pruneState({ stateDir, apply: true });
  assert.equal(applied.applied, true);
  assert.equal(applied.removedRegistryRows, 1);
  assert.equal(existsSync(join(stateDir, "repos", `${orphanKey}.sqlite`)), false);
  assert.equal(existsSync(join(stateDir, "repos", `${goneKey}.sqlite`)), false);

  // The live repo keeps its DB, registry approval, and searchability.
  assert.ok(existsSync(getRepoInfo(liveRoot, { stateDir }).dbPath));
  assert.deepEqual(listRegistryRepos({ stateDir }).map((repo) => repo.key), [repoKey(liveRoot)]);
  assert.equal(searchCodeMap({ cwd: liveRoot, query: "keepFeature", stateDir })[0]?.path, "src/keep.ts");
  assert.equal(collectStateGcCandidates({ stateDir }).candidates.length, 0);
});

test("state GC is a no-op when no state directory exists yet", (t) => {
  const stateDir = join(mkdtempSync(join(tmpdir(), "pi-codemap-gc-empty-")), "never-created");
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const plan = collectStateGcCandidates({ stateDir });
  assert.equal(plan.repoDbCount, 0);
  assert.equal(plan.registryRepoCount, 0);
  assert.deepEqual(plan.candidates, []);
  assert.equal(pruneState({ stateDir, apply: true }).removedRegistryRows, 0);
});

test("CodeMap uses state storage for registry and repo DBs", (t) => {
  const root = fixtureRepo(t);
  const info = getRepoInfo(root);

  assert.match(info.dbPath, /\.local\/share\/codemap\/repos\//);
  assert.ok(existsSync(join(storageHome, ".local", "share", "codemap", "registry.sqlite")));
  assert.ok(existsSync(info.dbPath));
});
