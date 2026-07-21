import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { codemapContext } from "../core/context.ts";
import type { CodeMapContextPackage } from "../core/context-builder.ts";
import { indexRepo, status } from "../core/indexer.ts";
import { findRepoRoot, type StateOptions } from "../core/repo.ts";
import { searchCodeMapWithDiagnostics, type CodeMapSearchPackage } from "../core/search.ts";
import { runWithTelemetry, type TelemetryAdapter } from "./telemetry.ts";

// Host-neutral execution surface shared by the CLI, MCP, and Pi adapters.
// Product behavior belongs behind this boundary; adapters only translate inputs and outputs.
// This is also the single telemetry write-point: each codeMap* op below is wrapped so one usage event
// is appended at operation end. The wrapper is transparent — it never alters a return value or thrown
// error (see ./telemetry.ts), so MCP/Pi consumers see byte-for-byte identical results.

export interface RepoPathParams extends StateOptions {
  repoPath?: string;
}

export function operationCwd(cwd: string, params: RepoPathParams): string {
  if (!params.repoPath) return cwd;
  const target = isAbsolute(params.repoPath) ? params.repoPath : resolve(cwd, params.repoPath);
  if (!existsSync(target)) throw new Error(`repoPath does not exist: ${target}`);
  const stats = statSync(target);
  return stats.isDirectory() ? target : dirname(target);
}

// Best-effort repo root for events whose operation threw before returning one (e.g. not_approved).
function repoRootHint(cwd: string, params: RepoPathParams): string | undefined {
  return findRepoRoot(operationCwd(cwd, params));
}

// search's effective limit clamp, mirrored for the cap_hit signal (normalizedLimit is private to search).
function effectiveSearchLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 10, 1), 50);
}

export function codeMapStatus(cwd: string, params: RepoPathParams & { full?: boolean; pathPrefix?: string }, adapter?: TelemetryAdapter) {
  return runWithTelemetry({
    command: "status",
    cwd,
    params,
    adapter,
    resolveRoot: () => repoRootHint(cwd, params),
    run: () =>
      status(operationCwd(cwd, params), {
        health: params.full === true ? "full" : "cheap",
        pathPrefix: params.pathPrefix,
        stateDir: params.stateDir,
      }),
  });
}

export function codeMapIndex(cwd: string, params: RepoPathParams & { approveRepo?: boolean; pathPrefix?: string }, adapter?: TelemetryAdapter) {
  return runWithTelemetry({
    command: "index",
    cwd,
    params,
    adapter,
    resolveRoot: () => repoRootHint(cwd, params),
    run: () =>
      indexRepo({
        cwd: operationCwd(cwd, params),
        approve: params.approveRepo === true,
        pathPrefix: params.pathPrefix,
        stateDir: params.stateDir,
      }),
    fields: (result, p, latencyMs) => ({
      approve: p.approveRepo === true,
      duration_ms: latencyMs,
      scanned: result.scanned,
      indexed: result.indexed,
      skipped: result.skipped,
      removed: result.removed,
      completed: true,
    }),
  });
}

export function codeMapSearch(cwd: string, params: RepoPathParams & { query: string; limit?: number; pathPrefix?: string }, adapter?: TelemetryAdapter) {
  return runWithTelemetry({
    command: "search",
    cwd,
    params,
    adapter,
    resolveRoot: () => repoRootHint(cwd, params),
    run: () =>
      searchCodeMapWithDiagnostics({
        query: params.query,
        cwd: operationCwd(cwd, params),
        limit: params.limit,
        pathPrefix: params.pathPrefix,
        stateDir: params.stateDir,
      }),
    outcome: (pkg) => (pkg.results.length === 0 ? "empty" : "ok"),
    fields: (pkg: CodeMapSearchPackage, p) => ({
      query: p.query,
      result_count: pkg.results.length,
      top_score: pkg.results[0]?.score,
      top_hit_confidence: pkg.topHitConfidence.level,
      stale: pkg.stale,
      cap_hit: pkg.results.length === effectiveSearchLimit(p.limit),
      // Impressions — trimmed to the join key + rank signals. No snippets (bloat; path is the join key).
      results: pkg.results.map((r) => ({ path: r.path, score: r.score, kind: r.kind, language: r.language })),
    }),
  });
}

export function codeMapContext(cwd: string, params: RepoPathParams & { target: string; limit?: number; pathPrefix?: string }, adapter?: TelemetryAdapter) {
  return runWithTelemetry({
    command: "context",
    cwd,
    params,
    adapter,
    resolveRoot: () => repoRootHint(cwd, params),
    run: () =>
      codemapContext({
        target: params.target,
        cwd: operationCwd(cwd, params),
        limit: params.limit,
        pathPrefix: params.pathPrefix,
        stateDir: params.stateDir,
      }),
    fields: (pkg: CodeMapContextPackage, p) => {
      const first = pkg.readFirst[0];
      // A direct file resolution carries a `target` reason on its first read-first item; anything else
      // (empty, or a search fallback) means context was used as another query (#23).
      const directTarget = first?.reasons?.some((reason) => reason.kind === "target") ?? false;
      return {
        target: p.target,
        target_form: directTarget ? "path" : "query",
        ...(directTarget && first ? { resolved_path: first.path } : {}),
        read_first_count: pkg.readFirst.length,
      };
    },
  });
}
