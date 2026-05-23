# Real-repo navigation eval

This local eval measures whether CodeMap is worth using on real repositories, not only checked-in fixtures. It indexes local repos into a temporary CodeMap state dir and compares three modes with the same default 5-file read budget:

1. `lexical` — rg-like tracked-file lexical scoring.
2. `codemap_search` — read top CodeMap search hits only.
3. `codemap_search_context` — search, then read the `codemap_context` package for the top hit.

The current local suite covers:

- `~/macrolens`
- `~/alpha-cycles`
- `~/.pi/agent/git/github.com/sebastianlang84/pi-ext-memory`
- `~/.pi/agent/git/github.com/sebastianlang84/pi-ext-subagents`
- `~/.pi/agent/git/github.com/sebastianlang84/pi-ext-astgrep`

Only paths and aggregate metrics are reported; repo contents are not copied into this package.

## Run

```bash
npm run eval:real-repo-navigation
npm run eval:real-repo-navigation:gate
```

Useful options:

```bash
npm run eval:real-repo-navigation -- --limit 8
npm run eval:real-repo-navigation -- --keep-state
npm run eval:real-repo-navigation -- --quality-gate --min-success-delta-vs-lexical 0.2
npm run eval:real-repo-navigation -- --quality-gate --min-natural-holdout-tasks 4
npm run eval:real-repo-navigation -- --quality-gate --min-natural-holdout-expected-recall 0.75
```

Because this eval depends on local repos, it is a local evidence gate, not a portable CI gate.

## Metrics

Per mode, the eval reports aggregate metrics plus cohort metrics:

- `baseline`: the original symbol/entrypoint-oriented local navigation tasks.
- `natural_holdout`: a small symptom-style holdout with no exact symbol names in the queries.

Per mode, metrics are:

- `successRate`: entry file found, all required context found, and no forbidden file read.
- `entryHitRate`: expected entry file was read.
- `avgExpectedRecall`: recall over entry + required context files.
- `avgContextRecall`: recall over required neighboring files only.
- `avgFilesRead`: unique files read within the budget.
- `avgToolCalls`: scripted navigation calls.
- `forbiddenReadRate`: noisy or explicitly forbidden files read, such as lockfiles or stale planning/archive files.
- `avgLatencyMs` / `p95LatencyMs`.
- `missTaxonomy`: classified misses across missing expected files and forbidden/noisy reads.
- `navigationDiagnostics`: per-case trace with selected search hits, the context target, read-first relationship reasons, and missing-expected explanations.
- `navigationMissReasons`: aggregate counts for the missing-expected explanation reasons, so taxonomy classes like `unknown` can still be split by navigation failure mode.

The miss taxonomy is diagnostic, not a gate by itself. Current classes are:

- `alias`: expected relationship likely needs path-alias resolution.
- `convention`: expected file is related by naming/framework convention rather than a direct import/search hit.
- `missing_symbol`: symbol-like query missed the expected entry file.
- `noise`: forbidden/noisy file was selected.
- `staleness`: expected file was missing while the index was stale.
- `query_formulation`: query terms do not overlap the missing expected path.
- `unknown`: miss needs manual inspection before adding heuristics.

The gate applies the success/recall/latency thresholds to the `baseline` cohort so local quality does not flap on the tiny holdout. It also requires the natural-language holdout to be present, keep minimum expected/context recall, and avoid explicitly configured forbidden/noisy reads.

## Current local result

On 2026-05-23, after adding minimal TS/JS path-alias graph resolution, protecting source→test convention neighbors in small budgets, narrowing generic `implementation` role-intent retrieval, preferring source files over matching tests for implementation-intent queries, and adding a natural-language holdout cohort, `npm run eval:real-repo-navigation:gate` passed on 8 baseline tasks plus 4 holdout tasks with the default 5-file read budget.

Baseline cohort:

| Mode | Success | Entry hit | Expected recall | Context recall | Avg files | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| `lexical` | 0.125 | 0.375 | 0.438 | 0.500 | 5.000 | 25.656 ms |
| `codemap_search` | 0.125 | 1.000 | 0.510 | 0.188 | 1.875 | 36.740 ms |
| `codemap_search_context` | 0.625 | 1.000 | 0.896 | 0.854 | 4.125 | 46.568 ms |

Natural-language holdout cohort:

| Mode | Success | Entry hit | Expected recall | Context recall | Avg files | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| `lexical` | 0.250 | 0.500 | 0.375 | 0.250 | 5.000 | 20.498 ms |
| `codemap_search` | 0.500 | 0.750 | 0.708 | 0.750 | 2.250 | 22.286 ms |
| `codemap_search_context` | 1.000 | 1.000 | 1.000 | 1.000 | 3.000 | 47.576 ms |

Baseline deltas:

- Search+context vs lexical: `+0.500` success, `+0.458` expected recall, `+0.354` context recall, with `0.875` fewer files read on average.
- Search+context vs search-only: `+0.500` success, `+0.386` expected recall, `+0.666` context recall.

The eval also emits a miss taxonomy, per-case navigation diagnostics, and aggregate navigation-miss reason counts. In the latest local run, baseline `codemap_search_context` had 3 classified misses: 1 `query_formulation` and 2 `unknown`; its previously classified `alias`, `missing_symbol`, `convention`, and `context_target_mismatch` misses are resolved. The navigation reason split explains those 3 misses as `context_budget_or_relationship`. The natural-language holdout had no `codemap_search_context` misses or forbidden reads in this run. Lexical still had 19 baseline misses including 5 `noise` reads.

Interpretation: under a realistic small read budget, CodeMap's value is strongest when agents use the intended workflow: search for an entry point, then call context. Search-only is not enough; context supplies the neighboring test/config/doc/source files that lexical search often misses or buries behind noisy hits. The taxonomy turns remaining misses into actionable next slices instead of broad guesses. The current holdout is deliberately small, local, and partly paired with existing baseline tasks; it catches obvious exact-symbol overfitting regressions but does not prove arbitrary natural bug-report navigation.

## Known limitations exposed by the eval

The eval is intentionally honest. It still exposes misses:

- Minimal TypeScript/JavaScript path-alias support covers indexed `tsconfig.json` / `jsconfig.json` `baseUrl` + `paths`; it does not yet chase complex `extends` chains or package-manager workspace aliases.
- Some framework/UI-to-API relationships are convention/config based, not import based.
- Alias imports add useful direct neighbors and increase average search+context reads on this suite; direct imports are therefore capped, and only one imported-neighbor convention test is promoted in the read-first budget.
- Remaining baseline `codemap_search_context` misses are now query-formulation or unknown by taxonomy, but navigation diagnostics place them in the `context_budget_or_relationship` bucket.
- The natural-language holdout is small and partly paired with baseline tasks; expand it before using it as a strict success-rate gate.
- Search+context is slower than lexical scanning on these small repos, though still under the local gate threshold.

These are candidates for future gated work; they should not be expanded unless this real-repo eval or a follow-up case proves the benefit.
