#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { codemapContext } from "../src/core/context.ts";
import { indexRepo } from "../src/core/indexer.ts";
import { getRepoInfo } from "../src/core/repo.ts";

interface ParsedArgs {
  roots: string[];
  fixtureRepos: boolean;
  localRepos: boolean;
  iterations: number;
  keepState: boolean;
}

interface SqliteSizeReport {
  totalBytes: number;
  mainBytes: number;
  walBytes: number;
  shmBytes: number;
}

interface DbCounts {
  files: number;
  chunks: number;
  symbols: number;
  graphNodes: number;
  graphEdges: number;
  graphVersion: string | null;
}

interface ContextCaseReport {
  target: string;
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  readFirstCount: number;
  relatedTests: number;
  relatedDocs: number;
  warnings: string[];
}

interface RepoReport {
  root: string;
  indexRoot: string;
  pathPrefix: string;
  scanned: number;
  indexed: number;
  skipped: number;
  removed: number;
  timings: {
    coldIndexMs: number;
    warmIndexMs: number;
    graphRebuildIndexMs: number;
  };
  sqlite: SqliteSizeReport;
  counts: DbCounts;
  context: {
    iterations: number;
    cases: ContextCaseReport[];
    avgLatencyMs: number;
    p95LatencyMs: number;
    maxLatencyMs: number;
  };
}

const fixtureRoots = [fileURLToPath(new URL("../test/fixtures/graph-budget", import.meta.url))];
const localRepoRoots = [
  "/home/wasti/macrolens",
  "/home/wasti/ai_stack/services/newsletter-writer",
  "/home/wasti/dev/autoresearch",
];

const parsed = parseArgs(process.argv.slice(2));
const roots = resolveBenchmarkRoots(parsed);
if (roots.length === 0) {
  console.error("No benchmark repository roots found. Use --fixtures, --local-repos, or pass explicit repo roots.");
  process.exit(2);
}

const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-graph-budget-"));
try {
  const reports = roots.map((root) => benchmarkRepo(root, parsed.iterations, stateDir));
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), stateDir: parsed.keepState ? stateDir : undefined, reports }, null, 2));
} finally {
  if (!parsed.keepState) rmSync(stateDir, { recursive: true, force: true });
}

function parseArgs(args: string[]): ParsedArgs {
  const roots: string[] = [];
  let fixtureRepos = false;
  let localRepos = false;
  let iterations = 10;
  let keepState = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [name, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? args[i + 1];
    if (arg === "--fixtures") {
      fixtureRepos = true;
    } else if (arg === "--local-repos") {
      localRepos = true;
    } else if (name === "--iterations") {
      iterations = parsePositiveInteger(name, value);
      if (inlineValue === undefined) i++;
    } else if (arg === "--keep-state") {
      keepState = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      roots.push(arg);
    }
  }
  if (fixtureRepos && localRepos) throw new Error("Use either --fixtures or --local-repos, not both");
  return { roots, fixtureRepos, localRepos, iterations, keepState };
}

function resolveBenchmarkRoots(parsed: ParsedArgs): string[] {
  if (parsed.roots.length > 0) return parsed.roots;
  if (parsed.localRepos) return localRepoRoots.filter(existsSync);
  return fixtureRoots.filter(existsSync);
}

function parsePositiveInteger(name: string, value: string | undefined): number {
  if (value === undefined || value.trim() === "") throw new Error(`${name} requires a positive integer`);
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 1) throw new Error(`${name} requires a positive integer`);
  return parsedValue;
}

function benchmarkRepo(rootArg: string, iterations: number, stateDir: string): RepoReport {
  const root = resolve(rootArg);
  const info = getRepoInfo(root, { stateDir });
  const pathPrefixArg = relative(info.root, root).split("\\").join("/");

  const [coldIndexMs, coldIndex] = timed(() => indexRepo({ cwd: root, approve: true, pathPrefix: pathPrefixArg, stateDir }));
  const [warmIndexMs] = timed(() => indexRepo({ cwd: root, pathPrefix: pathPrefixArg, stateDir }));
  invalidateGraphVersion(coldIndex.dbPath);
  const [graphRebuildIndexMs] = timed(() => indexRepo({ cwd: root, pathPrefix: pathPrefixArg, stateDir }));

  const targets = contextTargets(coldIndex.dbPath, coldIndex.pathPrefix);
  const cases = targets.map((target) => measureContextCase({ cwd: root, target, pathPrefix: coldIndex.pathPrefix, stateDir, iterations }));
  const caseAvgLatencies = cases.map((contextCase) => contextCase.avgLatencyMs);
  const caseP95Latencies = cases.map((contextCase) => contextCase.p95LatencyMs);
  const caseMaxLatencies = cases.map((contextCase) => contextCase.maxLatencyMs);

  return {
    root,
    indexRoot: coldIndex.root,
    pathPrefix: coldIndex.pathPrefix,
    scanned: coldIndex.scanned,
    indexed: coldIndex.indexed,
    skipped: coldIndex.skipped,
    removed: coldIndex.removed,
    timings: {
      coldIndexMs: roundMs(coldIndexMs),
      warmIndexMs: roundMs(warmIndexMs),
      graphRebuildIndexMs: roundMs(graphRebuildIndexMs),
    },
    sqlite: sqliteSizes(coldIndex.dbPath),
    counts: dbCounts(coldIndex.dbPath),
    context: {
      iterations,
      cases,
      avgLatencyMs: roundMs(avg(caseAvgLatencies)),
      p95LatencyMs: roundMs(Math.max(0, ...caseP95Latencies)),
      maxLatencyMs: roundMs(Math.max(0, ...caseMaxLatencies)),
    },
  };
}

function timed<T>(fn: () => T): [number, T] {
  const start = performance.now();
  const result = fn();
  return [performance.now() - start, result];
}

function invalidateGraphVersion(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare("delete from meta where key = 'graph_version'").run();
  } finally {
    db.close();
  }
}

function contextTargets(dbPath: string, pathPrefix: string): string[] {
  const db = new DatabaseSync(dbPath);
  const pathFilter = pathPrefix ? `${escapeLike(pathPrefix)}%` : "%";
  try {
    const rows = db.prepare(`
      select source.path as sourcePath, target.path as targetPath
      from graph_edges edge
      join graph_nodes source on source.id = edge.from_node_id
      join graph_nodes target on target.id = edge.to_node_id
      where edge.kind in ('imports', 'includes')
        and source.path like ? escape '\\'
        and target.path like ? escape '\\'
      order by edge.kind, source.path, target.path
      limit 24
    `).all(pathFilter, pathFilter) as Array<{ sourcePath: string; targetPath: string }>;
    const targets: string[] = [];
    for (const row of rows) {
      targets.push(row.sourcePath, row.targetPath);
    }
    if (targets.length === 0) {
      const fallback = db.prepare("select path from files where path like ? escape '\\' order by path limit 6").all(pathFilter) as Array<{ path: string }>;
      targets.push(...fallback.map((row) => row.path));
    }
    return uniqueStrings(targets).slice(0, 6);
  } finally {
    db.close();
  }
}

function measureContextCase(options: { cwd: string; target: string; pathPrefix: string; stateDir: string; iterations: number }): ContextCaseReport {
  const latencies: number[] = [];
  let readFirstCount = 0;
  let relatedTests = 0;
  let relatedDocs = 0;
  let warnings: string[] = [];
  for (let i = 0; i < options.iterations; i++) {
    const [latency, context] = timed(() => codemapContext({ cwd: options.cwd, target: options.target, pathPrefix: options.pathPrefix, stateDir: options.stateDir, limit: 8 }));
    latencies.push(latency);
    readFirstCount = context.readFirst.length;
    relatedTests = context.relatedTests.length;
    relatedDocs = context.relatedDocs.length;
    warnings = context.warnings;
  }
  return {
    target: options.target,
    avgLatencyMs: roundMs(avg(latencies)),
    p95LatencyMs: roundMs(p95(latencies)),
    maxLatencyMs: roundMs(Math.max(...latencies)),
    readFirstCount,
    relatedTests,
    relatedDocs,
    warnings,
  };
}

function sqliteSizes(dbPath: string): SqliteSizeReport {
  const mainBytes = fileSize(dbPath);
  const walBytes = fileSize(`${dbPath}-wal`);
  const shmBytes = fileSize(`${dbPath}-shm`);
  return { totalBytes: mainBytes + walBytes + shmBytes, mainBytes, walBytes, shmBytes };
}

function fileSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

function dbCounts(dbPath: string): DbCounts {
  const db = new DatabaseSync(dbPath);
  try {
    return {
      files: count(db, "files"),
      chunks: count(db, "chunks"),
      symbols: count(db, "symbols"),
      graphNodes: count(db, "graph_nodes"),
      graphEdges: count(db, "graph_edges"),
      graphVersion: (db.prepare("select value from meta where key = 'graph_version'").get() as { value: string } | undefined)?.value ?? null,
    };
  } finally {
    db.close();
  }
}

function count(db: DatabaseSync, table: string): number {
  return (db.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count;
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
