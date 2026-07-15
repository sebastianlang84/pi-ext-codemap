# Telemetry — questions the usage data must answer

Status: **draft / seed list** — starting point for a local, opt-out-free, machine-only
usage-telemetry design. Reviewed once by Fable; extend and reprioritize freely.

## Why this list exists

codemap's only user is an LLM agent choosing between codemap and plain `grep`/`find`.
The tool justifies its existence only if all three hold:

- **(a) advantage** — it does something a bash command cannot, and faster enough to be worth it
- **(b) understanding** — the agent grasps that advantage from its prompt/rules
- **(c) use** — the agent actually prefers it over grep/find

Telemetry exists to turn each of these from a claim into a number. This file is the
list of concrete questions we already know we want answered. The schema, write-point,
and rotation follow *from* this list — not the other way round.

Hard constraints (inherited from the index itself):

- **Local-only, never leaves the machine.** Append-only log beside the state DB.
- **Measure, never mutate.** Telemetry is write-only from the tool's perspective; it must
  never be read back into ranking.
- **Failure-proof.** Logging must be structurally unable to fail a command.

### Capture is all-at-once; analysis is phased

**The phase numbers below order the *reports*, not the *field capture*.** Log the union of
phase-1 and phase-2 fields from day one. This is non-negotiable for the clickthrough
questions (#12/#13/#14): if phase 1 does not log **top-k impressions — `(path, score, kind,
language)` for every result on every `search`** — the search→context join is impossible to
reconstruct retroactively. You would have thrown the impressions away. Capture the superset;
switch reports on over time.

## The questions

Legend — **Source**: `log` = answerable from codemap's own invocation log alone;
`log+reg` = log joined with the approval registry; `log (offline)` = log, but needs an
offline join/derivation; `hook` = needs a harness-side observer (grep/find and direct
file-reads happen outside the codemap process). **Phase**: report rollout order.

### Adoption — is it used at all? (criterion c)

| # | Question | Signal / fields | Source | Phase |
|---|----------|-----------------|--------|-------|
| 1 | Is codemap invoked at all? | any event: `ts, command, repo_root` → count per repo/day | log | 1 |
| 2 | Which *active* repos are approved but unsearched? | registry `approved_at` ⋈ log ⋈ repo activity (recent commits/mtimes): approved + active + 0 searches. Report the idle-time distribution, don't pick an N. | log+reg | 2 |
| 3 | Does the agent take grep instead? | `shadow_search` event when grep/find runs in an indexed repo | hook | 4 |
| 4 | Does the agent never start codemap at all? | codemap's share of all search-actions in indexed repos | hook | 4 |

### The index/approval gate — a ramp or a wall? (criterion c)

The gate is **two walls**. Wall one = approval (`not_approved`). Wall two = the *cost* of
`index --approve` itself. Log-only metrics here have a structural ceiling — see caveat G.

| # | Question | Signal / fields | Source | Phase |
|---|----------|-----------------|--------|-------|
| 5 | Does the approval gate block usage? (funnel, not binary) | three-step funnel: `not_approved` → `index --approve` → `search`, with drop-off measured at each step | log+reg | 1 (raw counts) / 2 (funnel) |
| 6 | Do agents refresh a stale index, or is the stale answer fine? | `stale` flag on `search`, and whether an `index` refresh **and a follow-up action** occur | log | 2 |
| 7 | Did self-explanatory not-approved output (commit 7f6866c) reduce abandonment? | trend of gate-taken vs. abandoned rate over time (needs tool-version tag) | log+reg | 2 |
| 18 | Is indexing *cost* itself the wall? | `index` event: `duration_ms`, `file_count`, and **completion vs. killed/timed-out** (exit reason). A killed mid-build index is a wall no `not_approved` metric sees. | log | 1 |
| 19 | Does the same repo hit `not_approved` repeatedly across sessions? | count of `not_approved` per repo grouped by fingerprint/session. Recurring = the "index on demand" rule isn't firing (prompt problem, not copy problem). | log+reg | 2 |
| 20 | Is the gate discovered reactively or proactively? | first codemap event per repo: `not_approved` (reactive — hit the wall) vs. `index --approve` (proactive — rule fired). Measures whether 7f6866c's audience even exists. | log+reg | 2 |
| 21 | After approving, does the agent actually search? | drop-off at step 3 of the #5 funnel. Step-3 drop = gate is fine, something *after* it disappoints. | log+reg | 2 |

### Understanding — do agents get the value prop? (criterion b)

| # | Question | Signal / fields | Source | Phase |
|---|----------|-----------------|--------|-------|
| 8 | Are they using it as a grep substitute *and failing*? | literal-identifier query **followed by** reformulation/grep. Classify by outcome, not surface form — a literal symbol lookup is a legitimate win. | log (offline) | 2 |
| 9 | Do they ignore `context` *when they shouldn't*? | search-only **after a weak/empty result** (not search-only per se — a snippet that answered the need legitimately ends there) | log (offline) | 2 |
| 10 | Do they scope with `--path-prefix` when they should? | presence of `path_prefix` vs. result_count | log | 2 |
| 22 | Do agents consume `--json` or scrape human output? | `--json` flag presence on `search`/`context`. Low share = the machine-consumption path isn't wired into prompts. One boolean, sharp (b) signal. | log | 1 |
| 23 | Is `context` called with a path or a free-text query? | `context` arg form: resolved-path vs. query-string. Query-form = agent treats `context` as another search, not a read-first package. | log | 2 |

### Quality — does it earn the choice? (criterion a)

| # | Question | Signal / fields | Source | Phase |
|---|----------|-----------------|--------|-------|
| 11 | How often does search return nothing / weak hits? | `empty`/zero-result rate, top-score distribution | log | 1 |
| 24 | What is the non-gate error/crash rate? | `error` outcome excluding `not_approved`/`empty`: exceptions, corrupt/missing index DB. The schema has the code; add the report. | log | 1 |
| 12 | Is the opened result actually near the top? | search→context clickthrough: rank of the path later opened via `context`. Gold relevance signal; quantifies doc-flood on live traffic. **Undercounted & biased — see caveat C.** | log (offline join) | 2 |
| 13 | Do agents re-search out of frustration? | reformulation chains: same repo, seconds apart, edited query | log (offline) | 2 |
| 14 | Was the target found elsewhere then reopened? | `context` on a path **not** in the prior result list = recovered miss. Require a preceding related in-window search; weak signal — see caveat E. | log (offline join) | 2 |
| 25 | After an empty/weak search, what does the agent do next? | post-`empty` next event in repo/window: reformulate / `context` / silence. Bridges quality→abandonment; distinct from #13, which assumes a re-search happened. | log (offline) | 2 |
| 26 | Are result sets too broad to be useful? | `result_count` distribution + cap-hit flag; pair with whether a `--path-prefix` re-query follows (agent narrowing noise) | log | 2 |
| 15 | Is it fast enough to beat grep? | `latency_ms` p50/p95 per command | log | 1 |

### Context — where/how is it used?

| # | Question | Signal / fields | Source | Phase |
|---|----------|-----------------|--------|-------|
| 16 | In which repos / cwd / subtree? | `repo_root`, `cwd` (if ≠ root), `path_prefix` | log | 1 |
| 17 | Which agent/harness is calling? | process-ancestry fingerprint (PPID chain + harness env vars) — also the join key for parallel sub-agents. Best-effort, not exact — see caveat F. | log | 1 |

## Where the line falls

Everything about *what happens after codemap is invoked* is answerable from codemap's own
log. Only two questions — **#3 "takes grep instead"** and **#4 "never starts it"** — require
the harness hook, because they happen outside the process. That is why phase-1/2 (log only)
already cover most of these questions; the hook is a separate phase for the last two.

## Phase-1 MVP report

The smallest report set that answers the owner's two driving questions ("is it invoked?"
and "is the gate a wall?") with the least join logic:

- **#1** invoked at all · **#24** health/crash rate · **#11** empty rate · **#15** latency ·
  **#18** index-build cost/kills · **#22** `--json` share · plus **raw `not_approved` counts**
  from #5.

Everything requiring a join (the #5 funnel, #12/#13/#14 clickthrough, #19/#20 cross-session
gate patterns) is a phase-2 *report* — but its *fields* are captured from day one.

## Interpretation caveats (keyed to the questions above)

- **C — #12 clickthrough is a lower bound, and biased.** Agents routinely open a path straight
  from the search JSON with their own Read tool, never calling `context`. So context-clickthrough
  undercounts "results acted upon," and over-samples hard/ambiguous cases (where expansion is
  needed) vs. clean top-1 hits. Read #12 as directional, not absolute. The unbiased version needs
  a hook logging a Read of a just-searched path (the positive twin of `shadow_search`) — phase 4.
- **E — #14 recovered-miss has high false positives.** `context` on a not-in-results path also
  fires when the agent already knew the path and is just reopening it. Require a preceding related
  in-window search; treat as weak.
- **F — #17 fingerprint is best-effort.** A shell wrapper between harness and codemap flattens the
  PPID chain; env-var fingerprints vary by harness. Validate against a known parallel-sub-agent run
  before trusting the join during fan-out.
- **G — log-only gate metrics (#5–7, #19–21) have a ceiling.** They see only agents who *came back*
  and approved. The agent that hits `not_approved` and goes straight to grep — the most important
  abandonment — is invisible to the log (that's hook territory, #3/#4). So gate-taken rates are an
  optimistic upper bound and the abandonment tail is undercounted. Frame accordingly; the true rate
  needs the hook.
- **Silence is not failure (applies to #6, #9, #25).** A stale index often still returns the right
  answer; a snippet often satisfies the need. Split every "no follow-up" metric by hit strength
  before calling silence an abandonment.
- **Copy vs. prompt (the gate).** Commit 7f6866c only fixes *copy* (the not-approved message). #7
  measures whether the copy worked; #19/#20 measure whether copy is even the bottleneck — if agents
  re-hit the gate every session, the `index --approve` rule isn't propagating into prompts and better
  copy can't help. #19/#20 logically precede #7.

## Cross-cutting cautions (carry into every metric)

- **Goodhart.** No single-metric tuning. Clickthrough conversion punishes good snippets that
  end the task; zero-result minimization rewards junk; invocation count rewards prompt
  coercion. Move a triad together (chosen-rank quality, reformulation rate, shadow-search
  share) and keep the eval harness as arbiter: telemetry proposes, evals dispose.
- **Self-confounding.** We author both the tool and the agents' rules. A prompt edit moves
  every metric. Log the tool version; keep a dated note of rule changes to align against.

## Open / to extend

- Confirm the phase-1 field set and JSONL event schema (follows from the phase-1 rows + the
  capture-superset rule).
- Deferred to phase 3: redundant identical queries across parallel sub-agents (fan-out waste),
  defensive `status` polling before every search (wasteful ceremony).
- Second Fable pass once a draft schema exists.
