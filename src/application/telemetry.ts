import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { isNotApprovedError } from "../core/errors.ts";
import { packageVersion } from "../core/package-version.ts";
import { repoKey, resolveStateDir } from "../core/repo.ts";

// Local, append-only usage telemetry (ADR 0001 / docs/developer/telemetry-phase1-schema.md).
//
// Hard rules, enforced structurally below:
// - Transparent: the wrapper returns the operation's value and re-throws its error byte-for-byte
//   unchanged. Nothing telemetry does is on the result path — it lives in a `finally` whose whole body
//   is wrapped so it can never fail a command or alter stdout ("measure, never mutate").
// - Local-only: one append beside registry.sqlite, mode 0600. Write-only; never read back into ranking.

const SCHEMA_VERSION = 1;
const USAGE_LOG_NAME = "usage.jsonl";

export type TelemetryCommand = "search" | "context" | "index" | "status";
export type TelemetryOutcome = "ok" | "empty" | "not_approved" | "error";
/** Which host surface issued the call. Omitted (→ "unknown") for direct library calls (tests/scripts). */
export type TelemetryAdapter = "cli" | "mcp" | "pi";

interface RunOptions<P, R> {
  command: TelemetryCommand;
  cwd: string;
  params: P & { stateDir?: string; pathPrefix?: string };
  /** Set by the calling adapter; falls back to "unknown" for direct library calls. */
  adapter?: TelemetryAdapter;
  run: () => R;
  /** Best-effort repo root when the operation threw before returning one (e.g. not_approved). */
  resolveRoot?: () => string | undefined;
  /** Overrides the default `ok` on success (search maps zero results to `empty`). */
  outcome?: (result: R) => Exclude<TelemetryOutcome, "not_approved" | "error">;
  /** Per-command fields derived from the successful result. */
  fields?: (result: R, params: P, latencyMs: number) => Record<string, unknown>;
}

/**
 * Run `run()` and, at operation end, append exactly one JSONL usage event. The operation's return value
 * and any thrown error pass through unchanged. Every derivation runs inside the guarded `finally`, so a
 * telemetry bug can never leak onto the result path.
 */
export function runWithTelemetry<P, R>(options: RunOptions<P, R>): R {
  const start = Date.now();
  let result: R | undefined;
  let succeeded = false;
  let caught: unknown;
  try {
    result = options.run();
    succeeded = true;
    return result;
  } catch (error) {
    caught = error;
    throw error;
  } finally {
    try {
      const latencyMs = Date.now() - start;
      const outcome: TelemetryOutcome = succeeded
        ? (options.outcome?.(result as R) ?? "ok")
        : (isNotApprovedError(caught) ? "not_approved" : "error");
      const event = buildEvent(options, result, caught, succeeded, outcome, latencyMs);
      appendEvent(options.params.stateDir, event);
    } catch {
      // Never fail a command because telemetry failed.
    }
  }
}

function buildEvent<P, R>(
  options: RunOptions<P, R>,
  result: R | undefined,
  caught: unknown,
  succeeded: boolean,
  outcome: TelemetryOutcome,
  latencyMs: number,
): Record<string, unknown> {
  const root = repoRoot(result, options.resolveRoot);
  const event: Record<string, unknown> = {
    v: SCHEMA_VERSION,
    ts: new Date().toISOString(),
    tool_version: packageVersion(),
    command: options.command,
    adapter: options.adapter ?? "unknown",
    latency_ms: latencyMs,
    outcome,
  };
  if (root !== undefined) {
    event.repo_key = safe(() => repoKey(root));
    event.repo_root = root;
    if (options.cwd && options.cwd !== root) event.cwd = options.cwd;
  }
  const pathPrefix = options.params.pathPrefix;
  if (pathPrefix) event.path_prefix = pathPrefix;
  if (!succeeded && outcome === "error") {
    const kind = errorKind(caught);
    if (kind) event.error_kind = kind;
  }
  const agent = agentFingerprint();
  if (agent) event.agent = agent;
  if (succeeded && options.fields) {
    Object.assign(event, safe(() => options.fields!(result as R, options.params as P, latencyMs)) ?? {});
  }
  return event;
}

function repoRoot<R>(result: R | undefined, resolveRoot: (() => string | undefined) | undefined): string | undefined {
  const fromResult = (result as { root?: unknown } | undefined)?.root;
  if (typeof fromResult === "string" && fromResult.length > 0) return fromResult;
  return safe(() => resolveRoot?.());
}

// Constructor name only — never the message or stack, which can echo repo paths/content.
function errorKind(error: unknown): string | undefined {
  if (error instanceof Error) return error.constructor?.name ?? error.name;
  return typeof error === "object" && error !== null ? error.constructor?.name : undefined;
}

function appendEvent(stateDir: string | undefined, event: Record<string, unknown>): void {
  const dir = resolveStateDir(stateDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, USAGE_LOG_NAME);
  appendFileSync(path, JSON.stringify(event) + "\n", { flag: "a", mode: 0o600 });
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

// --- Agent fingerprint (best-effort, caveat F) -------------------------------------------------------
// Captured once per process. Every sub-field is presence-gated: if a piece is not cheaply available it is
// omitted rather than guessed. The PPID-chain hash and env markers are heuristics — validate against a
// known parallel-sub-agent run before trusting the join during fan-out.

interface AgentFingerprint {
  ppid_chain?: string;
  harness?: string;
  session?: string;
}

let cachedAgent: AgentFingerprint | undefined | null = null;

// (env var, harness label) — first present marker wins.
const HARNESS_MARKERS: Array<[string, string]> = [
  ["CLAUDECODE", "claude_code"],
  ["CLAUDE_CODE_ENTRYPOINT", "claude_code"],
  ["PI_AGENT", "pi"],
  ["PI_SESSION_ID", "pi"],
  ["CURSOR_TRACE_ID", "cursor"],
];

// Session-id env vars, most specific first.
const SESSION_MARKERS = ["CLAUDE_SESSION_ID", "PI_SESSION_ID", "CODEMAP_SESSION_ID"];

function agentFingerprint(): AgentFingerprint | undefined {
  if (cachedAgent !== null) return cachedAgent;
  const agent: AgentFingerprint = {};
  const ppidChain = ppidChainHash();
  if (ppidChain) agent.ppid_chain = ppidChain;
  const harness = HARNESS_MARKERS.find(([envVar]) => process.env[envVar]?.trim())?.[1];
  if (harness) agent.harness = harness;
  const sessionVar = SESSION_MARKERS.find((envVar) => process.env[envVar]?.trim());
  if (sessionVar) agent.session = process.env[sessionVar]!.trim();
  cachedAgent = Object.keys(agent).length > 0 ? agent : undefined;
  return cachedAgent;
}

// Walk /proc/<pid>/stat parents and hash the pid chain to a short, non-reversible id. Linux-only; any
// failure (non-Linux, unreadable /proc) omits the field.
//
// Start from the PARENT pid, not process.pid: the codemap process is ephemeral (a fresh pid per
// invocation), so including it would make every event's hash unique and defeat the field's only purpose
// — a stable per-agent join key that groups one agent's search+context calls during parallel fan-out.
function ppidChainHash(): string | undefined {
  try {
    const pids: number[] = [];
    let pid: number = process.ppid;
    for (let depth = 0; depth < 32 && pid > 1; depth++) {
      pids.push(pid);
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      // comm (field 2) is wrapped in parens and may itself contain spaces/parens; split after the last ')'.
      const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const ppid = Number(afterComm[1]); // fields after comm: state, ppid, ...
      if (!Number.isInteger(ppid) || ppid <= 0) break;
      pid = ppid;
    }
    if (pids.length === 0) return undefined;
    return createHash("sha256").update(pids.join(">")).digest("hex").slice(0, 12);
  } catch {
    return undefined;
  }
}
