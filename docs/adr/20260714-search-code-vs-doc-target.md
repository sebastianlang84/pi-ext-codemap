# ADR 20260714 — Search ranking: code-default target for conceptual/UI queries

- **Status:** Accepted (pending the maintainer real-repo headline gate — see Verification)
- **Date:** 2026-07-14

## Context

`codemap search` returned README/overview docs instead of code for conceptual and
UI-navigation queries — the query type the tool markets as its strength. Verified on the
partflow index (650 files): `Overview tab Stock Identity Location cards part detail` returned
top-6 = READMEs (score ~43) and **zero** code candidates, even though the implementing component
(`PartDetailContent` in `frontend/src/app/(app)/parts/[id]/page.tsx`) is indexed.

Root cause (via `searchCodeMapDebug`), three compounding amplifiers:

1. **role-intent source + phantom FTS credit.** The word "overview" in the query triggered the
   `overview` role intent (`query-plan.ts`), which pulls every README into the pool via the
   `role_intent` source and boosts them (`roleBoost` +15). Those rows are created with `0 as rank`,
   and `rankScore(0)` returned the full `FTS_MATCH_BASE` (10) — a free FTS credit for a match that
   never happened. Doc floor 43 = 18 (role_intent boost) + 15 (roleBoost) + 10 (phantom FTS).
2. **role-word/tab-name collision.** "overview" is both a documentation role word and a common UI
   section/tab name, so a bare "overview" mixed with concrete identifier terms was misread as a
   request for overview docs.
3. **code missing from the pool.** For queries without a role-word, doc chunks/headings still won:
   natural-language tokens ("tab", "cards") appear as clean prose tokens in docs but are embedded in
   identifiers in code, so docs match the higher-tier FTS AND-queries while code matches only the
   loose fallback. The per-query `order by rank limit ?` cutoff then dropped every code file
   (partflow: 0 code candidates of 36).

The underlying question is an architecture decision: **for a conceptual/UI-navigation query, is the
default target the doc that describes the feature, or the code that implements it?** This ADR
records the decision that the default target is **code**, while genuine documentation-intent queries
keep returning docs.

## Decision

Three changes, each landed with a fixture case pair (`tests/fixtures/search-quality/doc-flood`) and
ranking unit tests (`tests/search-ranking.test.ts`):

1. **Remove the phantom FTS credit** (`ranking.ts::rankScore`). A real bm25 match always has
   `rank < 0`; a non-negative rank is exclusively the `0 as rank` sentinel used by non-FTS sources
   (path_match / basename_term / endpoint_route / role_intent). Those rows now earn `ftsScore = 0`.
   Drops the partflow doc floor 43 → 33.

2. **Fire the `overview` role intent only on doc-evidence** (`query-plan.ts::inferRoleIntents`).
   Doc-evidence = an explicit doc phrase/word ("what is this project", "project about", "purpose",
   "readme") or an overview-dominant query ("overview" with at most one other term). A bare
   "overview" mixed with identifier terms no longer pulls or boosts the README corpus.

3. **Additive code quota + doc-intent-gated code lift** (`search-pipeline.ts`, `ranking.ts`):
   - **Quota:** after normal FTS collection, scan deeper into the ranked chunk matches and append
     the top code-file chunks. Purely additive — it can surface a crowded-out code target but never
     removes or reorders a doc hit.
   - **Code lift:** `codeIntentBoost` (+2 code-like, +4 under `src/`) now fires whenever the query
     is not documentation-oriented (no doc role intent), not only on explicit code keywords. The
     lift is suppressed for documentation-intent queries (so canonical docs stay the top hit) and
     for any file carrying a noise penalty (generated/build/minified/lockfile), so the small boost
     cannot float noise back into results.

## Alternatives rejected

- **Decouple `docPenalty` from the `codeIntent` gate** (a general doc penalty). Rejected: violates
  the standing guardrail "keine generelle Doc-Abwertung; canonical docs bleiben auffindbar"
  (TODO §5). A code lift achieves code-default targeting without devaluing docs.
- **Reactivate bm25 magnitude weighting** (`ranking.ts` note). Rejected as out of bounds:
  corpus-dependent, highest cross-repo regression risk.
- **Rank code above dense spec docs via heading-symbol de-weighting.** Deferred: doc headings
  indexed as symbols earn an exact-term symbol boost, a separate mechanism. Left for a future gated
  slice; not required to eliminate the README flood.

## Consequences

- Fixture gate (`bench:search-quality:gate`, checked-in `doc-flood`): with the ranking fixes
  reverted the gate **fails** — the two conceptual/UI cases return only docs, `page.tsx` is crowded
  out of the top 5 entirely (`recall@5 0.8`, 2 misses), reproducing partflow's condition. With the
  fixes: `recall@5 1.0`, `top1 0.9`, `mrr@5 0.95`, gate green (the headline query reaches rank 2
  behind one dense user-manual doc; every other code case is rank 1 and both counter-cases keep the
  README at rank 1). `agent-nav` and all other `npm run verify` gates unchanged and green (166 unit
  tests pass).
- Partflow (real-repo proxy): the README flood is eliminated (READMEs no longer in the top for the
  UI-navigation query) and code enters the pool (0 → 12 candidates) and occupies the top instead of
  docs. The *exact* implementing component does not always reach rank 1 in a large repo — noisier
  code files that match more query tokens can outrank it — because the prose-token/FTS-tier bias
  (amplifier 3's root) is only partially addressed by the quota+lift; fully closing it needs the
  deferred ranking work above.
- **Doc-target reranking (accepted trade-off):** removing the phantom credit lowers role-intent doc
  candidates by 10. On partflow, `what is this project about` moved README from rank 1 to rank 2
  behind a content-dense doc; README stays in the top 5. Doc-intent queries with an overview/doc
  role intent are unaffected by the code lift.

## Verification

- `npm run verify` (typecheck, build, unit tests, `bench:search-quality:gate`,
  `bench:context-quality:gate`, `eval:agent-navigation:gate`, `check:token-injection`) — green.
- **Outstanding:** the dated real-repo headline cohort (`npm run verify:local` /
  `eval:real-repo-navigation:gate`, the maintainer-machine `/home/wasti` repos) could **not** be run
  in the implementation environment (repos absent). It is the abort criterion for these ranking
  changes and MUST be run before merge; if the headline success/recall numbers drop, fix the fix,
  do not soften the gate.
