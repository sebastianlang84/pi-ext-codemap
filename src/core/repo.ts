import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import type { RepoInfo } from "./types.ts";

export interface StateOptions {
  stateDir?: string;
}

function configuredStateDir(): string | undefined {
  const codemapHome = process.env.CODEMAP_HOME?.trim();
  if (codemapHome) return resolve(codemapHome);

  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  if (xdgDataHome) return resolve(xdgDataHome, "codemap");

  return undefined;
}

function legacyStateDir(): string {
  return join(homedir(), ".pi", "agent", "state", "codemap");
}

function defaultStateDir(): string {
  const stateDir = join(homedir(), ".local", "share", "codemap");
  const legacy = legacyStateDir();
  return !existsSync(stateDir) && existsSync(legacy) ? legacy : stateDir;
}

let warnedLegacyStateAbandoned = false;

// A configured override (CODEMAP_HOME / XDG_DATA_HOME) silently wins over the legacy Pi state dir.
// An upgrading Pi user who happens to export XDG_DATA_HOME would land in a fresh empty location and
// lose their approvals/indexes without notice — surface that once on stderr (never stdout, which the
// MCP transport keeps JSON-pure) so it stays diagnosable but non-fatal.
function warnIfLegacyStateAbandoned(chosen: string): void {
  if (warnedLegacyStateAbandoned) return;
  const legacy = legacyStateDir();
  if (chosen === legacy || existsSync(chosen) || !existsSync(legacy)) return;
  warnedLegacyStateAbandoned = true;
  process.stderr.write(
    `codemap: ignoring legacy Pi state at ${legacy}; using ${chosen}. ` +
      `Pass --state-dir ${legacy} (or unset CODEMAP_HOME/XDG_DATA_HOME) to reuse it.\n`,
  );
}

export function resolveStateDir(stateDir?: string): string {
  if (stateDir) return resolve(stateDir);
  const chosen = configuredStateDir() ?? defaultStateDir();
  warnIfLegacyStateAbandoned(chosen);
  return chosen;
}

export function getReposDir(options: StateOptions = {}): string {
  return join(resolveStateDir(options.stateDir), "repos");
}

export function getRegistryPath(options: StateOptions = {}): string {
  const baseDir = resolveStateDir(options.stateDir);
  const registryPath = join(baseDir, "registry.sqlite");
  mkdirSync(baseDir, { recursive: true });
  return registryPath;
}

export function findRepoRoot(cwd = process.cwd()): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error(`Not inside a Git repository: ${cwd}`);
  }
}

export function getRemote(root: string): string | undefined {
  try {
    return execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function repoKey(root: string): string {
  return createHash("sha256").update(resolve(root)).digest("hex").slice(0, 24);
}

function registryDb(options: StateOptions = {}): DatabaseSync {
  const activeRegistryPath = getRegistryPath(options);
  mkdirSync(dirname(activeRegistryPath), { recursive: true });
  const db = new DatabaseSync(activeRegistryPath);
  db.exec(`
    create table if not exists repos (
      key text primary key,
      root_path text not null unique,
      git_remote text,
      enabled integer not null default 1,
      approved_at text not null,
      approval_source text not null,
      updated_at text not null
    );
  `);
  return db;
}

export function getRepoInfo(cwd = process.cwd(), options: StateOptions = {}): RepoInfo {
  const root = findRepoRoot(cwd);
  const key = repoKey(root);
  const dbPath = join(resolveStateDir(options.stateDir), "repos", `${key}.sqlite`);
  const db = registryDb(options);
  const row = db.prepare("select enabled from repos where key = ?").get(key) as { enabled: number } | undefined;
  db.close();
  return { root, key, remote: getRemote(root), approved: row?.enabled === 1, dbPath };
}

export function approveRepo(cwd = process.cwd(), source = "tool", options: StateOptions = {}): RepoInfo {
  const info = getRepoInfo(cwd, options);
  mkdirSync(dirname(info.dbPath), { recursive: true });
  const db = registryDb(options);
  const now = new Date().toISOString();
  db.prepare(`
    insert into repos(key, root_path, git_remote, enabled, approved_at, approval_source, updated_at)
    values (?, ?, ?, 1, ?, ?, ?)
    on conflict(key) do update set
      root_path = excluded.root_path,
      git_remote = excluded.git_remote,
      enabled = 1,
      approval_source = excluded.approval_source,
      updated_at = excluded.updated_at
  `).run(info.key, info.root, info.remote ?? null, now, source, now);
  db.close();
  return { ...info, approved: true };
}

export interface RegistryRepo {
  key: string;
  rootPath: string;
}

/** Read approved repos from the registry without creating it. Returns [] when no registry exists yet. */
export function listRegistryRepos(options: StateOptions = {}): RegistryRepo[] {
  const registryPath = join(resolveStateDir(options.stateDir), "registry.sqlite");
  if (!existsSync(registryPath)) return [];
  const db = new DatabaseSync(registryPath);
  try {
    return db.prepare("select key, root_path as rootPath from repos").all() as unknown as RegistryRepo[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** Delete registry rows by key. Returns the number of rows removed. No-op when no registry exists. */
export function removeRegistryRepos(keys: string[], options: StateOptions = {}): number {
  if (keys.length === 0) return 0;
  const registryPath = join(resolveStateDir(options.stateDir), "registry.sqlite");
  if (!existsSync(registryPath)) return 0;
  const db = new DatabaseSync(registryPath);
  try {
    const stmt = db.prepare("delete from repos where key = ?");
    let removed = 0;
    for (const key of keys) removed += Number(stmt.run(key).changes);
    return removed;
  } finally {
    db.close();
  }
}
