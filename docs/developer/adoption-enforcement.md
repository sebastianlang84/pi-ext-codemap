# Adoption enforcement — making agents actually reach for codemap

Status: **research + design (nothing implemented)** — captures external research (2026-07-18)
and its reconciliation with this machine's CLI-first setup. The decision frame lives in
[ADR 20260718](../adr/20260718-grep-fallback-enforcement-gate.md); the incident evidence lives in
[`TODO.md`](../../TODO.md) (§ "Discoverability").

## Problem

Agents (Claude Code and peers) under-use codemap and fall back to `grep`/`glob`/`find` even when
the repo is indexed and codemap is the better fit for symbol/definition/reference lookup. Two
incidents are logged in `TODO.md`:

- **Incident 1 — grep reflex.** A single agent navigated an extended recon task entirely with
  grep, never running codemap, despite the global `AGENTS.md` rule and a SessionStart "index ready"
  banner. Root cause: habit; passive instructions do not *fire at the moment of action*.
- **Incident 2 — delegation-propagation gap.** The main agent delegated recon to an `Explore`
  subagent (following "use subagents by default"); the subagent navigated with grep and never saw
  the codemap-first rule (it lives only in the main agent's context). Cost was **correctness**, not
  just latency — the grep recon shipped a report that missed two DB-level constraints codemap's
  ranking surfaced immediately.

Core finding: this is **discoverability at the point of action, not capability**. Prose is provably
not load-bearing — the agent knew and even quoted the rule, then skipped it. A real guardrail must
be **deterministic**; on Claude Code the deterministic layers are **hooks and permissions**, not
CLAUDE.md/AGENTS.md text.

## What the external research says (2026-07-18)

Condensed; full citations at the bottom.

- **The only reliable fix is deterministic point-of-use interception.** A `PreToolUse` hook that
  matches the fallback tool and returns `permissionDecision: "deny"` with a corrective
  `permissionDecisionReason` is the single load-bearing mechanism. Written rules and session
  banners are ignored under task pressure.
- **The tool reflex is a strong prior that descriptions only partly move.** Sourcegraph's
  CodeScaleBench: agents chose keyword search 4,813× vs 587 semantic vs 8 "deep search" calls
  "even when told outright about these tools." Anthropic reports tool-description refinements drove
  SoTA SWE-bench results — descriptions help at the margin; enforcement changes behavior.
- **Delegation is solved by configuration/hooks, not hope.** Subagents do **not** reliably inherit
  CLAUDE.md-only rules — the built-in `Explore`/`Plan` agents *skip CLAUDE.md by design* for speed.
  But **hooks DO fire inside subagents** (hook inputs carry `agent_id`/`agent_type`). So a
  `PreToolUse` interceptor is the propagation-proof fix: it fires regardless of which agent runs.
- **Removing the fallback from context is the strongest lever where feasible** (deny rule /
  allowlist exclusion removes the tool the model can't reach for). But `grep`-via-`Bash` is a leak
  path, so the Bash tool must also be intercepted.
- **Adoption payoff is quantified.** Cursor: semantic search +12.5% avg answer accuracy
  (6.5–23.5% by model). Turbopuffer/ContextBench: wasted file reads fell from 1-in-3 to 1-in-8
  (precision 65%→87%). Sourcegraph MCP: ~4k tokens vs ~48k for the same cross-repo understanding.
  Corroborates Incident 2: grep recon is not just slower, it *misses things*.

## Reconciliation with this machine (CLI-first, no MCP)

codemap here is a **Bash CLI on PATH, not an MCP tool** (see `codemap-cli-first-setup` memory).
That changes which levers apply:

| Report lever | Applies here? |
| --- | --- |
| `PreToolUse` deny-with-reason | **Yes — the load-bearing lever.** Fires at point-of-action and inside subagents → covers Incident 1 **and** 2 with one mechanism. |
| Delegation: `Explore` skips CLAUDE.md | Confirms Incident 2's mechanism. The hook survives it; editing the agent definition does not have to. |
| Remove fallback via allowlist | **Only partial.** codemap runs *through Bash*, so any recon agent needs Bash, and `grep`-via-Bash leaks with it. Bash interception is mandatory; allowlist alone insufficient. Only the built-in `Grep`/`Glob` tools could be `deny`d from context. |
| Tool-schema / MCP description framing | **N/A.** codemap is not an exposed tool here — no description to reframe, no anti-affordance line to add to the built-in `Grep`. The report's biggest "partial" lever does not exist on this host. |
| Reminder injection (SessionStart) | **Already shipped** (`~/.claude/hooks/codemap-session-start.sh`). Defense-in-depth, not load-bearing. |
| Measurement (telemetry) | **Already shipped** — phase-1 `usage.jsonl` (ADR 0001). The before/after instrument exists. |

### Critical refinement the generic report underweights: gate on readiness

A blanket grep-deny is **dangerous here**: if codemap is not indexed/approved for the current repo,
denying the fallback leaves the agent with no working alternative → it stalls. The hook must call
`codemap status --json` and **only deny when `readiness == "ready"`** (approved + indexed +
not stale). Otherwise **fail open** (allow grep). This composes with the existing SessionStart hook,
which handles approval/refresh. Non-git dirs and a missing `codemap` binary also fail open.

### No total ban

grep is legitimately better for raw text scans (log strings, config values, TODO sweeps,
non-code). The 2026 consensus is **hybrid**: mandate codemap as the *first move for
symbol/definition/reference* questions, keep grep for raw text — enforced at the point of action.
The deny reason must therefore offer an **escape hatch** (a sentinel the agent re-runs with) so the
gate is a redirect, not a wall, and does not loop.

## Recommended design (Stage 1 — not implemented)

A single global `PreToolUse` hook in `~/.claude/settings.json`:

- **Matchers:** `Grep|Glob` and `Bash`. The Bash interceptor must detect `grep|rg|find|fd|ag`
  **after pipes and in `&&` chains** (the permission system evaluates only the first command in a
  chain, so a naive matcher misses `cmd | grep …`).
- **Logic:** run `codemap status --json` for the call's `cwd`; only when `readiness == "ready"`
  return
  ```json
  { "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "AUTOMATED POLICY GATE (not a user denial). This repo is indexed by codemap. For symbol/definition/reference lookup run: codemap search \"<terms>\"  (then codemap context <hit>). If this is a genuine raw-text scan, re-run with CODEMAP_ALLOW_GREP=1 to bypass."
  }}
  ```
- **Fail open** on: `readiness != "ready"`, non-git dir, `codemap` missing, `status` error, or the
  bypass sentinel present.

### Footguns to encode (from the research)

- **Exit codes:** exit `2` blocks; exit `1` does **not** block (silent leak). Wrap the validator so
  it can only ever `exit 0` or `exit 2`, never 1.
- **`additionalContext` is NOT honored on `PreToolUse`** (received but dropped, can fail open). The
  redirect text must ride in `permissionDecisionReason`.
- **Word it as an automated gate, not a denial.** Since Opus 4.6 a bug can make the model treat a
  hook block as a *user* denial and stop/defer instead of adapting. The "AUTOMATED POLICY GATE"
  prefix mitigates.
- **Do not rely on `updatedInput` rewrite** (silent grep→codemap rewrite) — open non-determinism
  bugs when sibling hooks return `ask`, and last-writer-wins across multiple hooks. Prefer
  deny-with-reason for correctness-critical redirection.

### Delegation coverage

The hook alone closes Incident 2: hooks fire inside subagents, so the `Explore` subagent's grep
call is intercepted even though `Explore` never read the rule. An explicit
`.claude/agents/code-recon.md` (allowlist excluding `Grep`/`Glob`, body mandating codemap) is
**optional hardening, not required**.

## Open decision — strictness

Genuinely unresolved; owner's call. The research recommends the hard variant.

- **Hard-deny-narrow + escape hatch (recommended, matches the report).** Deterministic; blocks only
  the narrow symbol-lookup case; text scans bypass via sentinel. The `codemap-adoption-friction`
  memory had deferred this hook for over-enforcement risk — but Incident 2's *correctness* cost
  flips the balance, and the evidence shows prose/reminders never reach 100%.
- **Advisory-only (softer).** Hook injects a reminder (via SessionStart/UserPromptSubmit stdout,
  which *is* injected) and never blocks. No loop/annoyance risk, but non-deterministic — the exact
  class of guidance shown to be quoted-then-ignored.

## Blast radius

The gate would be a **global harness change on the shared VM**: it affects every session in every
repo for every agent (including unrelated projects like `~/partflow`). Cost: ~1 `codemap status`
process per intercepted grep. Reversible by removing the hook entry. This is why it is
approval-gated and not implemented here.

## Rollout & measurement (when/if built)

1. Ship Stage 1 (ready-gated deny + escape hatch).
2. Optional Stage 2: `code-recon` subagent + `deny Agent(Explore)` routing, if delegation still
   leaks.
3. Measure via existing `usage.jsonl`: codemap-vs-grep call ratio per session. Tighten (drop the
   escape hatch) if grep-family calls stay high; soften to reminder-only if the model loops/stops.

## Other agents (portability notes)

- **OpenAI Codex CLI / GitHub Copilot CLI:** have `PreToolUse` with `permissionDecision`; coverage
  and `updatedInput`/`additionalContext` support are partial and buggy — test per version.
- **Cursor:** hooks since v1.7 (command handlers) + Rules; ships "Instant Grep" and designs semantic
  search to *complement* grep.
- **Cline:** file-based hook discovery. **Windsurf / Continue.dev / Aider:** no hooks — only
  prompt-level rules; for those the only lever is schema framing / not exposing grep (N/A for a
  CLI).

## Source pointers (external research, 2026-07-18)

- Anthropic — "Writing effective tools for agents" (descriptions move selection; namespacing/naming
  effects; when-to-use clauses; input examples). SWE-bench SoTA via tool-description refinement.
- Anthropic — context engineering: attention drifts from the system prompt as context grows →
  "silent failures"; guardrails must be deterministic (hooks/permissions).
- Sourcegraph — CodeScaleBench: keyword 4,813 vs semantic 587 vs deep-search 8 calls; agents
  struggle past ~400k LOC; MCP-preamble wording iteration (subtle→never used; all-caps→90% but
  "death spiral"; explicit "not present locally, must use MCP"→forced adoption). Author calls it
  "directional evidence, not a final verdict."
- Cursor — "Improving agent with semantic search": +12.5% avg accuracy (6.5–23.5%); retention +0.3
  to +2.6% on 1000+ file repos.
- Turbopuffer/ContextBench (secondary-sourced talk): wasted reads 1-in-3 → 1-in-8; precision
  65%→87%.
- Tool-DE (Lu et al., arXiv:2510.22670): structured tool docs (`when_to_use`, `limitations`, `tags`)
  raise retrieval NDCG@10; documentation-incompleteness 41.6%→23.5%.
- Claude Code hook mechanics: `PreToolUse` deny/allow/ask, `permissionDecisionReason`; exit 2 blocks
  / exit 1 leaks; `additionalContext` not honored on `PreToolUse`; deny evaluated before permission
  mode (blocks even `--dangerously-skip-permissions`); `Explore`/`Plan` skip CLAUDE.md; hooks fire
  in subagents; Opus-4.6 stop-on-block bug; `updatedInput` non-determinism.

> Caveats: several external figures are secondary-sourced or version-sensitive (hook exit-code
> handling, `updatedInput`, `additionalContext`, subagent MCP inheritance, `Explore` model
> inheritance all changed across releases and carry open bugs). Verify on the installed Claude Code
> version before building. Descriptions are necessary-but-insufficient; do not over-ban grep.
