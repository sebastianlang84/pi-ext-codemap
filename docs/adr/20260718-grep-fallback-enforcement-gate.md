# ADR 20260718 — Enforce codemap-first via a point-of-use grep gate

- **Status:** Proposed (nothing implemented; one sub-decision open)
- **Date:** 2026-07-18

## Context

codemap exists to be the agent's first move for symbol/definition/reference navigation, but agents
under-use it and fall back to `grep`/`glob`/`find` even on an indexed repo. Two logged incidents
(see [`TODO.md`](../../TODO.md) § "Discoverability"):

1. **Grep reflex** — a single agent never ran codemap despite the `AGENTS.md` rule and a
   SessionStart "index ready" banner. Passive instructions do not fire at the moment of action.
2. **Delegation-propagation gap** — the main agent delegated recon to an `Explore` subagent, which
   navigated with grep and never saw the codemap-first rule (it lives only in the main agent's
   context). Cost was **correctness**: the grep recon missed two DB-level constraints codemap ranked
   at the top.

Established finding (see `codemap-adoption-friction` memory and
[`adoption-enforcement.md`](../developer/adoption-enforcement.md)): prose is **not load-bearing** —
the agent quoted the rule and skipped it. On Claude Code the only deterministic guardrail layers are
**hooks and permissions**. External research (2026-07-18) independently converges on the same
answer: a `PreToolUse` deny-with-reason hook is the single load-bearing mechanism, and — decisively
for Incident 2 — **hooks fire inside subagents**, so the gate survives delegation that a CLAUDE.md
rule cannot.

This host is **CLI-first, no MCP** (`codemap-cli-first-setup` memory). So tool-schema/description
framing does not apply, and `grep`-via-`Bash` cannot be removed by an allowlist (codemap itself
needs Bash) — the Bash tool must be intercepted.

## Decision (proposed)

Introduce a global `PreToolUse` hook in `~/.claude/settings.json` that, **only when
`codemap status --json` reports `readiness == "ready"` for the call's cwd**, returns
`permissionDecision: "deny"` with a corrective `permissionDecisionReason` naming the exact
`codemap search "<terms>"` command and a bypass sentinel (`CODEMAP_ALLOW_GREP=1`) for genuine
raw-text scans. Matchers: `Grep|Glob` and `Bash` (Bash matcher detects `grep|rg|find|fd|ag` after
pipes and `&&` chains). Everything else **fails open** (not-ready, non-git, missing binary, error,
sentinel present).

The full design, footguns (exit-2-not-1, `additionalContext` not honored on `PreToolUse`,
Opus-4.6 stop-on-block wording, `updatedInput` non-determinism), and rollout/measurement plan live
in [`adoption-enforcement.md`](../developer/adoption-enforcement.md).

### Why this shape

- **Deterministic + point-of-action** — fires exactly when the agent reaches for the fallback,
  where prose has decayed out of attention.
- **Propagation-proof** — hooks fire in subagents, closing Incident 2 without editing agent
  definitions or copying rules into delegation prompts.
- **Readiness-gated** — never blocks the fallback when codemap has no working answer for this repo,
  avoiding a stall (a refinement the generic research underweights).
- **Not a total ban** — an escape hatch keeps grep available for raw-text scans, matching the 2026
  hybrid consensus (codemap first for symbols; grep for text), avoiding loops.

## Open sub-decision — strictness

Deferred to the owner:

- **Hard-deny-narrow + escape hatch** (recommended; matches the research). Deterministic; blocks
  only the narrow symbol-lookup case. Reverses the earlier over-enforcement deferral because
  Incident 2 added a *correctness* cost, not just latency.
- **Advisory-only.** Reminder injection via SessionStart/UserPromptSubmit stdout, no block.
  No loop/annoyance risk but non-deterministic — the class of guidance shown to be
  quoted-then-ignored.

## Consequences

- **Blast radius:** global on the shared VM — every session, every repo, every agent (incl.
  unrelated projects). Cost ~1 `codemap status` process per intercepted grep. Reversible by removing
  the hook entry. Requires explicit approval before implementing.
- **Measurable:** existing phase-1 `usage.jsonl` (ADR 0001) already captures the codemap-vs-grep
  call ratio to tune strictness after rollout.
- **Version-sensitive:** hook exit-code handling, `additionalContext`, `updatedInput`, subagent
  inheritance, and `Explore` model behavior have all shifted across Claude Code releases and carry
  open upstream bugs — verify on the installed version before building.
- **Composes with** the existing SessionStart hook (approval/refresh) and the `AGENTS.md` slimming
  that the `codemap-adoption-friction` memory already recommends (make the rule shrink, not grow,
  once the deterministic layer exists).

## Status note

Nothing in this ADR is implemented. It records the decision frame and the single open sub-decision
so that, when approved, implementation and this ADR's status flip to Accepted together.
