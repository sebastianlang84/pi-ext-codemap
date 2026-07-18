# TODO

Aktive offene Arbeit für CodeMap. Erledigte Arbeit gehört in den [`CHANGELOG.md`](CHANGELOG.md), Eval-Befunde in die passenden Dokumente unter [`docs/developer/`](docs/developer/), Produkt-/Architekturkontext in [`docs/product/roadmap.md`](docs/product/roadmap.md#future-work) und [`docs/developer/architecture.md`](docs/developer/architecture.md).

## Nächster Slice

Kein aktiver Implementierungsslice. Weitere Konventions-/Targeting-Arbeit erst bei einem neuen konkreten Eval-Miss auswählen; pro Konvention ein Fixture oder Real-Repo-Case und eine eigene Metrik, keine breite Heuristik ohne messbaren Context-Gewinn.

## Opportunistisch oder gated

- [ ] Test-/Eval-Script-Deepening nur bei erneutem Doppel-Touch fortführen.
  - Gemeinsame Gate-Report-/CLI-Parser-Helfer erst extrahieren, wenn beide Navigation-Skripte erneut geändert werden.
  - Inline Eval-Cases nur dann in Datenmodule verschieben, wenn dadurch Logik- und Corpus-Diffs tatsächlich klarer werden.
  - Bestehende Core-Helfer und die bereits getrennten Search-/Navigation-Suites wiederverwenden; keine Pi/TUI-Adapterdetails in Core-Tests ziehen.

- [ ] Workspace-/Multi-Config-Pfadalias nur bei einem konkreten Miss angehen.
  - Minimaler `tsconfig.json`-/`jsconfig.json`-`baseUrl`- und `paths`-Support existiert; komplexe `extends`-Ketten, Workspace-Aliasse und Budget-Ordering bei vielen Alias-Imports bleiben bewusst offen.

- [ ] Strukturiertes C/C++-Chunking nur mit sprachspezifischem Scanner und Fixture-Beleg prüfen.
  - Symbole und kanonische `c`-/`cpp`-Tags sind umgesetzt. Fixed-Window-Chunking bleibt, weil der JS/TS-Brace-Scanner bei C-`/`-Division fehlzünden kann.
  - Anonyme `typedef struct { … } Name;` und Makros nur bei einem konkreten Miss ergänzen.

- **Doc-Flood-Ranking-Fix gelandet (2026-07-15, ADR [`docs/adr/20260714-search-code-vs-doc-target.md`](docs/adr/20260714-search-code-vs-doc-target.md)):** konzeptuelle/UI-Queries lieferten READMEs statt Code; behoben via Phantom-FTS-Entfernung, doc-evidence-gated `overview`-Intent, additiver Code-Quota + doc-intent-gated Code-Lift (keine Doc-Abwertung). Merge-Evidenz: `doc-flood`-Fixture + Ranking-Unit-Tests, `bench:search-quality:gate` grün (Vorher: Code aus Top-5 gedrängt → Nachher recall@5 1.0), Review ohne Correctness-Befund. Beim Merge mit `8a87197` (weak-symbol/coverage) reconciled und volles `verify` auf dem kombinierten Stand grün.
  - [ ] **Autor-lokales Advisory** auf einer Maschine mit vollständiger Cohort fahren (`npm run verify:local` / `eval:real-repo-navigation:gate`, `bench:search-quality:local`); Ergebnis an Merge/ADR anhängen. Laut ADR-Amendment ist die Headline-Cohort ein autor-lokales Advisory, kein CI-Blocking-Gate — der Korpus ist privat/maschinen-lokal und nirgends reproduzierbar; blockierend sind die Fixture-Gates.
  - [ ] **Harness-Fix (eigener Task):** Eval-Suites config-/env-getrieben (`CODEMAP_EVAL_REPOS`) statt in `scripts/eval-real-repo-navigation.ts` hartkodiert; „Repo fehlt" von „Qualität regrediert" entkoppeln (fehlend → skip + Warnung, hart failen nur bei echter Regression auf vorhandenen Repos). Macht das Advisory auf jeder Teilmenge ehrlich lauffähig statt an Mindest-Task-Zahlen zu scheitern.
  - **Offene Restgrenzen (eigene Slices, nur bei konkretem Miss):** (1) Doc-Headings als Symbole erhalten `exactTermSymbol`-Boost, wenn ein Query-Term = Heading-Name — separater Verstärker, bewusst nicht angefasst; (2) exaktes Ziel-Component rankt in großen Repos nicht immer #1 (Prosa-Token/FTS-Tier-Bias) — voller Fix bräuchte Tier-/bm25-Arbeit (gated).

- [ ] Graphify-inspirierte öffentliche Tools nur nach wiederholtem Agent-Nutzen und Budgetentscheidung erwägen.
  - Interne Neighborhood-/Path-Diagnostics und `npm run report:architecture` existieren bereits.
  - `codemap_explain`, `codemap_path`, Symbol-Level-Reports oder breites Architektur-Ranking brauchen jeweils einen festen failing Eval-Case, Produktentscheidung und `npm run check:token-injection`.

- [ ] Review-Cleanup ohne Produktverhalten nur bei einem konkreten Review-Befund durchführen.
  - `codemap_context` und das Gesamtbudget liegen nahe am Token-Gate; neue Parameter, Guidelines oder öffentliche Tools brauchen eine explizite Budgetentscheidung.

## Discoverability: agents under-use codemap even when the rule mandates it

> **Research + design done (2026-07-18) — nothing implemented.** External research (how others make
> agents adopt a preferred tool over grep, and make it survive delegation) is reconciled with this
> CLI-first/no-MCP host in [`docs/developer/adoption-enforcement.md`](docs/developer/adoption-enforcement.md);
> the decision frame is [ADR 20260718](docs/adr/20260718-grep-fallback-enforcement-gate.md) (Status:
> Proposed).
>
> **Conclusion:** prose is not load-bearing — the only deterministic layer on Claude Code is
> hooks/permissions. A `PreToolUse` **deny-with-reason** hook is the single load-bearing mechanism,
> and because **hooks fire inside subagents** it closes *both* Incident 1 (grep reflex) and Incident 2
> (delegation gap) with one mechanism — no need to copy the rule into subagent contexts. This flips
> the earlier deferral of the grep hook in the `codemap-adoption-friction` memory (fix #6), because
> Incident 2 added a *correctness* cost, not just latency.
>
> **Recommended (not built):** global `PreToolUse` hook matching `Grep|Glob` + `Bash`
> (post-pipe/`&&`-aware), that only denies when `codemap status --json` reports `readiness=="ready"`
> for the cwd, with a `permissionDecisionReason` naming the exact `codemap search` command and a
> `CODEMAP_ALLOW_GREP=1` escape hatch for raw-text scans; fail-open otherwise. Footguns encoded:
> exit-2-not-1, `additionalContext` not honored on `PreToolUse`, "automated gate" wording vs the
> Opus-4.6 stop-on-block bug.
>
> **Open sub-decision (owner):** strictness — hard-deny-narrow + escape hatch (recommended) vs
> advisory-only reminder injection. **Blast radius:** global on the shared VM (every session/repo/
> agent) → approval-gated before any implementation.

**Logged:** 2026-07-18 (from a Claude Code session in `~/partflow`)

### Incident 1

An agent did an extended code-reconnaissance task (building an audit-lens skill: locating
build-readiness math, availability/reservation code, parsers, guard files across the repo) and
navigated almost entirely with `grep` + subagent `test -f`, **never** running `codemap search`
/ `codemap context` — despite:
- the global `AGENTS.md` explicitly stating codemap is the primary navigation tool
  ("`codemap search`, then `codemap context`, before find/grep"),
- the repo being indexed and ready (a `SessionStart` hook even printed "codemap index ready"),
- codemap being clearly the better fit (symbol-level lookup with `file:line`).

The user had to prompt "codemap was indexed — why do you never use it?" before it got used. When
finally run, one `codemap search` resolved the exact symbols (`computeBuildReadiness` →
`build-readiness.ts:71`, `canBuildValue`, `AvailabilityTab`) in a single call — confirming it would
have been faster from the start. Root cause was habit (grep reflex), not a codemap failure.

### Why this matters

The rule exists but does not *fire* at the moment of action. A `SessionStart` "index ready" line
and a line in `AGENTS.md` are both passive — they don't intercept the grep reflex when the agent is
mid-task. Discoverability, not capability, is the gap.

### Candidate directions (for maintainers to weigh — not prescriptive)

- **Point-of-use nudge:** when the harness/hook detects `grep`/`rg`/`find` on an indexed repo,
  surface a one-line reminder ("indexed — `codemap search <terms>` may be faster") rather than
  relying on session-start text the agent has scrolled past.
- **Make the SessionStart line actionable, not decorative:** include a ready-to-run example
  (`codemap search "<likely task terms>"`) instead of just "index ready".
- **Tool-description weighting:** if codemap is exposed as an MCP/tool, ensure its description
  frames it as *first* nav step for symbol/definition/caller lookup, so it out-competes generic
  search tools at selection time. (Balance against this repo's low-token-injection rule.)
- **Staleness ergonomics:** the index flagged `stale` after a release + new untracked files; a
  near-zero-friction auto-refresh (or a louder "run `codemap index`") would remove one more reason
  to fall back to grep.

Deciding which of these is worth the prompt-token cost is the actual open question.

### Incident 2 — the rule dies at the delegation boundary (2026-07-18)

**Logged:** 2026-07-18 (from a second Claude Code session in `~/partflow`, a P1 inventory-race
diagnosis). Same phenomenon as Incident 1, but a distinct root cause worth logging separately.

**What happened.** The main agent judged the reconnaissance "non-trivial" and — following its
global rule "use sub-agents by default" — dispatched an `Explore` subagent to map the code path.
The subagent navigated entirely with `grep`/`glob`/`read` and **never** ran codemap. The main
agent itself also never ran codemap before delegating. The user again had to prompt ("did you use
codemap? if not, why?") before it was used. One `codemap search` then resolved the exact symbols
(`inventory.service`, `stock-change.ts`, the DTO, the api-client layer) in a single call.

**Root cause — different from Incident 1.** Incident 1 was a single agent's grep *habit*. This one
is a **delegation-propagation gap**: the codemap-first rule lives only in the *main* agent's context
(global `AGENTS.md`). When the main agent delegates the navigation to a subagent, the rule does not
travel with the delegation — it is not injected into the subagent's prompt, and the `Explore` agent
type is itself framed as a grep/glob "search agent" with no codemap awareness. So the agent offloaded
*exactly the activity the rule governs* (code navigation) onto a delegate that never received the
rule. The main agent would have had to manually copy the rule into the subagent prompt, and didn't.

There is a **rule-interaction** angle here: two global rules ("navigate with codemap first" and
"delegate recon to subagents by default") pull against each other, and the current resolution
silently drops the first. Any fix has to make the two compose, not compete.

**The cost was correctness, not just latency.** The grep-based recon produced a complete-looking
report that **missed two DB-level constraints** on `inventory_transactions` (an append-only
UPDATE/DELETE deny-trigger, and `chk_quantity_delta_nonzero` — a CHECK that rejects a zero delta at
the DB). `codemap search` surfaced the guard's migration + integration test in its top hits
immediately. Those constraints materially changed the design (a "set on-hand to N" no-op must be
caught *before* insert or the DB throws). So codemap under-use here didn't just cost time — the
grep path shipped a design-relevant omission that codemap's ranking would have caught up front.

**New candidate direction (in addition to Incident 1's list).**

- **Make the rule survive delegation.** The nudge/guidance must reach *subagents*, not only the
  top-level agent — e.g. the `Explore`/search agent type's own definition frames codemap as its
  first nav step, or the harness injects the codemap-first line into every code-search subagent's
  context the same way it reaches the main agent. A rule that only the orchestrator can see will
  keep dying every time recon is delegated (which the "subagents by default" rule makes the common
  case, not the exception).

## Produktentscheidungen / später

- [ ] npm-Registry-Veröffentlichung erst bei konkretem Nutzerbedarf entscheiden; bis dahin bleibt `npm install -g github:sebastianlang84/codemap` kanonisch.
- [ ] Native MCP-`roots`-Auflösung erst bei einem belegten Host-Miss ergänzen; `repoPath` bleibt der Fallback für Hosts mit falschem Prozess-cwd.
- [ ] Refresh-Automation erst wieder aufnehmen, wenn breitere Agent-Evals oder Praxisfälle zeigen, dass Agenten bestehende stale Warnungen übersehen.
