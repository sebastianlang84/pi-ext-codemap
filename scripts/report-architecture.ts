#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { buildArchitectureReport } from "../src/core/architecture-report.ts";
import { hasGraphMetadata } from "../src/core/graph-store.ts";
import { findRepoRoot, repoKey } from "../src/core/repo.ts";
import { normalizePathPrefix } from "../src/core/scanner.ts";

interface ParsedArgs {
  root: string;
  pathPrefix: string;
  limit: number;
}

const parsed = parseArgs(process.argv.slice(2));
const root = findRepoRoot(parsed.root);
const key = repoKey(root);
const registryPath = join(defaultStateDir(), "registry.sqlite");
const dbPath = join(defaultStateDir(), "repos", `${key}.sqlite`);

if (!isApproved(registryPath, key)) {
  console.error("Repository is not approved/indexed yet. Run 'codemap index --approve' first; this report is read-only and does not create registry state.");
  process.exit(2);
}

if (!existsSync(dbPath)) {
  console.error("CodeMap DB does not exist. Run 'codemap index --approve' first; this report is read-only and does not index.");
  process.exit(2);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  if (!hasGraphMetadata(db)) {
    console.error("CodeMap graph metadata is missing or stale. Run 'codemap index --approve' first; this report is read-only and does not migrate or index.");
    process.exit(2);
  }
  const pathFilter = parsed.pathPrefix ? `${escapeLike(parsed.pathPrefix)}%` : "%";
  const report = buildArchitectureReport(db, pathFilter, { limit: parsed.limit });
  console.log(JSON.stringify({
    root,
    pathPrefix: parsed.pathPrefix,
    report,
  }, null, 2));
} finally {
  db.close();
}

function parseArgs(args: string[]): ParsedArgs {
  let root = process.cwd();
  let pathPrefix = "";
  let limit = 10;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [name, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? args[i + 1];
    if (name === "--repo" || name === "--repo-path") {
      root = requiredValue(name, value);
      if (inlineValue === undefined) i++;
    } else if (name === "--path-prefix") {
      pathPrefix = normalizePathPrefix(requiredValue(name, value));
      if (inlineValue === undefined) i++;
    } else if (name === "--limit") {
      limit = parsePositiveInteger(name, value);
      if (inlineValue === undefined) i++;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      root = arg;
    }
  }

  return { root: resolve(root), pathPrefix, limit };
}

function requiredValue(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") throw new Error(`${name} requires a value`);
  return value;
}

function parsePositiveInteger(name: string, value: string | undefined): number {
  const raw = requiredValue(name, value);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} requires a positive integer`);
  return parsed;
}

function isApproved(registryPath: string, key: string): boolean {
  if (!existsSync(registryPath)) return false;
  const db = new DatabaseSync(registryPath, { readOnly: true });
  try {
    const row = db.prepare("select enabled from repos where key = ?").get(key) as { enabled: number } | undefined;
    return row?.enabled === 1;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

function defaultStateDir(): string {
  return join(homedir(), ".pi", "agent", "state", "codemap");
}

function printUsage(): void {
  console.log(`Usage: node --experimental-strip-types scripts/report-architecture.ts [repoRoot] [--path-prefix <subtree>] [--limit <n>]

Emits a deterministic JSON architecture report from the existing CodeMap SQLite graph.
The script is read-only: it does not index, refresh, call LLMs, or write report state.`);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
