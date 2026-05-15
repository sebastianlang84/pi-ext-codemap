import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import type { RepoInfo } from "./types.ts";

export interface StateOptions {
  stateDir?: string;
}

function defaultStateDir(): string {
  return join(homedir(), ".pi", "agent", "state", "codemap");
}

function resolveStateDir(stateDir?: string): string {
  return stateDir ? resolve(stateDir) : defaultStateDir();
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
