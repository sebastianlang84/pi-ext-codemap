# ADR 0001 — Local usage telemetry for codemap

Status: **Proposed** (design fixed; implementation not started)
Date: 2026-07-15

## Context

codemap's only user is an LLM agent choosing between codemap and plain `grep`/`find`. The
tool is worth maintaining only if (a) it offers an advantage a bash command cannot, (b) the
agent understands that advantage from its prompt/rules, and (c) the agent actually prefers it.
Today none of these is measurable: the only persisted signal is `approved_at`/`updated_at` in
the registry and per-repo DB mtimes. "When was codemap last *used* (searched)?" and "is the
index/approval gate blocking adoption?" are both unanswerable.

Ranking quality (the doc-flood problem — Markdown dominating conceptual queries) is being
fixed separately. That fix's before/after effect on live traffic can only be measured if usage
capture exists *before* the ranking change lands — a one-time window.

## Decision

Add a local, append-only usage log that records each codemap invocation, to answer a fixed
list of adoption/understanding/quality questions and to feed captured (query → opened-target)
pairs back into the existing eval harness.

Design is captured in two documents:
- Questions the data must answer: `docs/developer/telemetry-questions.md`
- Phase-1 JSONL schema & write-point: `docs/developer/telemetry-phase1-schema.md`

Binding constraints:
- **Local-only, never leaves the machine** — same guarantee as the index; `usage.jsonl` beside
  `registry.sqlite`, mode 0600.
- **Measure, never mutate** — the log is write-only from the tool's perspective; it must never
  be read back into ranking.
- **Failure-proof** — one append at operation end, errors swallowed; telemetry can never change
  a command's exit code or output.
- **Single write-point** at the host-neutral seam `src/application/operations.ts`, so CLI, MCP,
  and Pi adapters are all covered by one instrumentation.
- **Capture the field superset from day one; phase only the reports** — impression-level
  `search.results[]` must be logged in phase 1 or the phase-2 clickthrough join is
  unrecoverable.

Rollout is phased: phase 1 = raw log; phase 2 = offline analyzer/reports; phase 4 =
harness-side `shadow_search` hook for the two questions the tool cannot observe from inside its
own process (agent takes grep instead / never starts codemap).

## Consequences

- "When was it last used" and "is the gate a wall" become answerable from the log alone; only
  true non-use (grep instead / never invoked) still needs the deferred harness hook.
- A one-time before/after baseline for the doc-flood ranking fix becomes possible **iff** phase
  1 ships first — this couples telemetry sequencing to the ranking work.
- Query text (repo internals) lands on local disk; documented as same sensitivity class as the
  index, not synced, not attached to bug reports. No redaction in phase 1.
- Goodhart risk: no single-metric tuning; a metric triad plus the eval harness as arbiter.
- Self-confounding: we author both tool and agent rules, so `tool_version` is logged and rule
  changes are dated to align trends against.
