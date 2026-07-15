# Telemetry — phase-1 JSONL schema & write-point

Status: **draft design** — derives directly from the phase-1 rows in
[telemetry-questions.md](./telemetry-questions.md). Not yet implemented. Grounded in the
current code; file:line anchors are integration points, not existing telemetry.

Recall the capture rule from the questions doc: **capture the phase-1+2 field superset from
day one; phases only switch on reports.** So this schema logs the impression-level fields the
phase-2 clickthrough join needs (`top-k` on `search`) even though the join itself is a
phase-2 report.

## Where the write happens

All three adapters — CLI ([src/cli/main.ts](../../src/cli/main.ts)), MCP
([src/mcp/server.ts](../../src/mcp/server.ts)), Pi extension
([src/pi-extension](../../src/pi-extension)) — funnel through the host-neutral seam
[src/application/operations.ts](../../src/application/operations.ts):

- `codeMapSearch` · `codeMapContext` · `codeMapIndex` · `codeMapStatus`

That file's own comment states product behavior lives behind this boundary and adapters only
translate I/O. **That makes it the single correct telemetry seam** — instrument it once and
every adapter is covered; instrument the CLI and MCP/Pi calls go unlogged.

Mechanism: wrap each `codeMap*` operation so that around the inner call it (1) stamps start
time, (2) runs the operation, (3) derives the outcome from the return value or the caught
error, (4) appends one event, (5) re-throws / returns unchanged. The wrapper must be
**transparent** — it changes neither return values nor thrown errors. Telemetry is a
side-effect, never part of the result path (upholds "measure, never mutate").

`status` is logged too (low volume, and #17/#16 want its context), but carries no result
fields.

## Storage

- Path: `join(resolveStateDir(stateDir), "usage.jsonl")` — beside `registry.sqlite`, using the
  exact same resolution as the state DB ([src/core/repo.ts:50](../../src/core/repo.ts) `resolveStateDir`).
  So `--state-dir` / `CODEMAP_HOME` / `XDG_DATA_HOME` / legacy Pi dir are all honored automatically.
- Format: newline-delimited JSON, one event per invocation, UTF-8, mode `0600`.
- Sensitivity: **same class as the index** — query text echoes repo internals. Local-only,
  never synced, never attached to a bug report. Document, don't redact (phase 1).

## Write mechanics (failure-proof, off the result path)

- **One append at the end of the operation**, via `appendFileSync(path, line + "\n", { flag: "a", mode: 0o600 })`.
  `O_APPEND` gives atomic single-line appends across concurrent processes on local fs — no
  lock needed for our line sizes.
- **Errors swallowed.** The whole telemetry block sits in `try { … } catch { /* never fail a
  command */ }`. A broken/unwritable log must never change a command's exit code or output.
- **No fsync**, no buffering across invocations (each process is short-lived and writes once).
- Operations are synchronous (`node:sqlite` `DatabaseSync`), so timing is a plain
  `Date.now()` delta around the inner call — no async plumbing.

## Event schema

Common envelope (every event):

| field | type | source | notes |
|-------|------|--------|-------|
| `v` | int | const | schema version, start at `1` |
| `ts` | string | `new Date().toISOString()` | event time |
| `tool_version` | string | `packageVersion()` (lift out of [main.ts:49](../../src/cli/main.ts) into shared util) | **must-have** — self-confounding guard |
| `command` | string | dispatch | `search` \| `context` \| `index` \| `status` |
| `adapter` | string | seam caller | `cli` \| `mcp` \| `pi` — which surface was used |
| `repo_key` | string | `repoKey(root)` ([repo.ts:92](../../src/core/repo.ts)) | stable 24-char id; join key to registry |
| `repo_root` | string | resolved cwd/root | absolute path (local-only) |
| `cwd` | string? | caller cwd | only when ≠ `repo_root` (#16) |
| `path_prefix` | string? | args | scoping (#10) |
| `latency_ms` | int | `Date.now()` delta | (#15) |
| `outcome` | string | derived (below) | `ok` \| `empty` \| `not_approved` \| `error` |
| `agent` | object? | fingerprint (below) | best-effort (#17, caveat F) |
| `json` | bool | `--json` present | machine-consumption signal (#22); CLI-only, omit for mcp/pi |

Outcome derivation (grounded):

- `not_approved` — inner call throws `Error` whose message starts with
  `"Repository is not approved/indexed yet"` ([search.ts:81,97](../../src/core/search.ts)).
  Match on a shared sentinel/`code`, **not** the English prose — refactor that throw to carry a
  stable `code: "not_approved"` so telemetry and the self-explanatory CLI copy don't drift.
- `empty` — no throw, `results.length === 0`.
- `error` — any other thrown error (crash / corrupt DB — #24). Capture `error_kind` (constructor
  name), **never** the message/stack (may leak paths/content).
- `ok` — otherwise.

### `search` — additional fields

| field | type | source | phase-need |
|-------|------|--------|-----------|
| `query` | string | args | b-signal #8/#22; verbatim |
| `result_count` | int | `pkg.results.length` | #11/#26 |
| `top_score` | number | `pkg.results[0]?.score` | #11 weak-hit |
| `top_hit_confidence` | string | `pkg.topHitConfidence.level` | already computed ([main.ts:145](../../src/cli/main.ts)) |
| `stale` | bool | `pkg.stale` | #6 |
| `cap_hit` | bool | `result_count === effectiveLimit` | #26 |
| `results` | array | `pkg.results` → `{path, score, kind, language}` per hit | **#12/#13/#14 impressions — must log in phase 1 or the clickthrough join is unrecoverable** |

`results[]` is trimmed to `(path, score, kind, language)` — **no snippets** (bloat; the path is
the join key). This is the one non-trivial serialization cost and it's microseconds.

### `context` — additional fields

| field | type | source | phase-need |
|-------|------|--------|-----------|
| `target` | string | args (raw) | #23 |
| `target_form` | string | `path` \| `query` | #23 — is `context` used as read-first or as another search |
| `resolved_path` | string? | resolved read-first target | #12/#14 join key against a prior `search`'s `results[].path` |
| `read_first_count` | int | `pkg.readFirst.length` | health |

### `index` — additional fields

| field | type | source | phase-need |
|-------|------|--------|-----------|
| `approve` | bool | `--approve` | #5/#20 — proactive approval vs. reactive |
| `duration_ms` | int | timing | #18 (the second wall) |
| `scanned` / `indexed` / `skipped` / `removed` | int | `indexRepo` result | build cost/scope |
| `completed` | bool | reached normal return | **#18 — a killed/timed-out index never writes the event, so a *missing* completion for a started index is itself the signal.** See note. |

**#18 kill detection.** A process killed mid-`index` (agent timeout, OOM) never reaches the
end-of-operation append, so absence can't be logged from the end alone. Options, cheapest
first: (i) accept that killed indexes surface only as an approved-but-never-searched repo
(#2) — zero code; (ii) write a `index_start` breadcrumb before the build and an
`index` completion after, so a start with no matching completion = a killed build. Phase-1
default: **(i)**; promote to (ii) only if #2 shows unexplained dead repos clustering on large
indexes.

## Agent fingerprint (`agent` object, best-effort — caveat F)

Captured once at process start:

| field | source |
|-------|--------|
| `ppid_chain` | walk `/proc/<pid>/stat` parents → hashed short id (join key for parallel sub-agents) |
| `harness` | recognized env vars (e.g. `CLAUDE*`, `CLAUDECODE`, Pi markers) → label |
| `session` | harness session id env var when present |

Explicitly best-effort: a shell wrapper flattens the PPID chain; env markers vary by harness.
**Validate against a known parallel-sub-agent run before trusting the time-window join during
fan-out.** Also emit a free `query_id` (uuid) in `search` `--json` output; do not require anyone
to thread it — harvest it later only if the heuristic join proves too ambiguous.

## Rotation (extend `state-gc`)

Wire a size-capped rotation into [src/core/state-gc.ts](../../src/core/state-gc.ts), which
already owns state hygiene and runs via `npm run gc:state`:

- Cap `usage.jsonl` at a fixed size (e.g. 32 MB); on overflow rotate to `usage.jsonl.1`
  (single generation, old `.1` dropped). No time-based cron, no compression.
- Report reclaimed bytes alongside the existing DB-prune candidates.

At ~1–2 KB/event, a heavy multi-agent day is thousands of events → tens of MB/month worst
case, so one 32 MB cap + one rotated generation is ample headroom.

## Deferred (not phase 1)

- The offline analyzer / `codemap telemetry report` (phase-2 reports: funnel, clickthrough join,
  reformulation chains).
- Mandatory `query_id` threading; per-event fsync; any read-back into ranking.
- Harness-side `shadow_search` hook (#3/#4) — separate phase-4 mini-project.
- Redaction machinery.

## Open / to confirm

- Lift `packageVersion()` into a shared util both `main.ts` and the seam can call.
- Add a stable `code` to the not-approved throw ([search.ts:81,97](../../src/core/search.ts)) so
  outcome detection doesn't match English prose.
- Second Fable pass on this schema before implementation.

Confirmed against code: `SearchResult` exposes `path`/`language`/`kind`/`score`
([src/core/types.ts:26](../../src/core/types.ts)) — the trimmed `results[]` set needs no new
extraction.
