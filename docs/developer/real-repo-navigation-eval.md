# Real-repo navigation eval

This local eval measures whether CodeMap is worth using on real repositories, not only checked-in fixtures. It indexes local repos into a temporary CodeMap state dir and compares three modes with the same default 5-file read budget:

1. `lexical` — rg-like tracked-file lexical scoring.
2. `codemap_search` — read top CodeMap search hits only.
3. `codemap_search_context` — search, call `codemap_context` on the top hit, then merge visible search hits and context paths under the same read budget.

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
npm run eval:real-repo-navigation -- --quality-gate --min-natural-holdout-tasks 10
npm run eval:real-repo-navigation -- --quality-gate --min-natural-holdout-expected-recall 0.55
```

Because this eval depends on local repos, it is a local evidence gate, not a portable CI gate.

## Metrics

Per mode, the eval reports aggregate metrics plus cohort metrics:

- `baseline`: the original symbol/entrypoint-oriented local navigation tasks.
- `natural_holdout`: a symptom-style holdout with no exact function/class symbol names in the queries.

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

The gate applies the success/recall/latency thresholds to the `baseline` cohort so local quality does not flap on the holdout. It also requires the natural-language holdout to be present, keep a minimum expected/context-recall floor, and avoid explicitly configured forbidden/noisy reads. The holdout floor is intentionally lower than the baseline target because the expanded set is diagnostic and currently exposes next improvement work.

## Current local result

On 2026-05-24, after adding minimal TS/JS path-alias graph resolution, protecting source→test convention neighbors in small budgets, narrowing generic `implementation` role-intent retrieval, preferring source files over matching tests for implementation-intent queries, resolving TypeScript relative `.js` specifiers to indexed source files, prioritizing stem-affine reverse importers, preserving visible search hits in the scripted search+context read plan, expanding the natural-language holdout cohort, penalizing agent-instruction files for non-agent queries, expanding natural identifier compounds while demoting local Claude settings, letting context-related tests fill remaining scripted read-plan budget before ordinary imports, and adding root README fallback only when no name/path-specific docs match, `npm run eval:real-repo-navigation:gate` passed on 8 baseline tasks plus 10 holdout tasks with the default 5-file read budget.

Baseline cohort:

| Mode | Success | Entry hit | Expected recall | Context recall | Avg files | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| `lexical` | 0.125 | 0.500 | 0.521 | 0.563 | 5.000 | 26.518 ms |
| `codemap_search` | 0.125 | 1.000 | 0.510 | 0.188 | 1.875 | 34.163 ms |
| `codemap_search_context` | 1.000 | 1.000 | 1.000 | 1.000 | 5.000 | 47.417 ms |

Natural-language holdout cohort:

| Mode | Success | Entry hit | Expected recall | Context recall | Avg files | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| `lexical` | 0.100 | 0.600 | 0.475 | 0.450 | 5.000 | 20.980 ms |
| `codemap_search` | 0.200 | 0.700 | 0.525 | 0.483 | 2.800 | 25.185 ms |
| `codemap_search_context` | 0.700 | 0.800 | 0.783 | 0.783 | 4.800 | 63.795 ms |

Baseline deltas:

- Search+context vs lexical: `+0.875` success, `+0.479` expected recall, `+0.437` context recall, with `0.125` fewer files read on average.
- Search+context vs search-only: `+0.875` success, `+0.490` expected recall, `+0.812` context recall.

The eval also emits a miss taxonomy, per-case navigation diagnostics, and aggregate navigation-miss reason counts. In the latest local run, baseline `codemap_search_context` had no classified taxonomy misses; its previous `alias`, `missing_symbol`, `convention`, `query_formulation`, and `unknown` taxonomy misses are resolved. Baseline navigation-reason buckets are also at zero. The expanded natural-language holdout had no forbidden reads. The workbench session holdout now reads the chart source, component, session hook, and chart test within the 5-file budget. The `sg` binary holdout now reads the source, test, CLI install hint, and root README guidance within the 5-file budget. Remaining failing `codemap_search_context` cases are: provider source/test context beyond budget, handoff scope docs/code mismatch, and reviewer-context-scout docs/test mismatch. Lexical still had 12 baseline missing-expected files plus 5 `noise` reads.

Interpretation: under a realistic small read budget, CodeMap's value is strongest when agents use the intended workflow: search for an entry point, keep the visible search hits as candidate reads, then call context. Search-only is not enough; context supplies neighboring test/config/doc/source files that lexical search often misses or buries behind noisy hits. The expanded holdout is now deliberately harder: it catches exact-symbol overfitting and exposes natural-language routing gaps instead of claiming arbitrary bug-report navigation.

## Known limitations and risks exposed by the eval

The eval is intentionally honest. Even with no current baseline `codemap_search_context` misses, it still exposes risks and next validation areas:

- Minimal TypeScript/JavaScript path-alias support covers indexed `tsconfig.json` / `jsconfig.json` `baseUrl` + `paths`; it does not yet chase complex `extends` chains or package-manager workspace aliases.
- Some framework/UI-to-API relationships are convention/config based, not import based.
- Alias imports add useful direct neighbors and increase average search+context reads on this suite; direct imports are therefore capped, and only one imported-neighbor convention test is promoted in the read-first budget.
- The scripted `codemap_search_context` read plan keeps visible search hits before filling from top-hit context, then prefers context-related tests over ordinary imports for the remaining slots; this resolved the prior `pi-ext-memory` `tag-catalog.ts` miss and the workbench chart-test budget miss but increases average files read slightly.
- The expanded natural-language holdout still is local and partly paired with baseline tasks, but now includes additional unpaired symptom-style requests that expose entry-targeting and context-budget gaps. Root README fallback is intentionally only used when no name/path-specific docs were found, so specific PRDs or docs keep their budget priority.
- Search+context is slower than lexical scanning on these small repos, though still under the local gate threshold.

These are candidates for future gated work; they should not be expanded unless this real-repo eval or a follow-up case proves the benefit.
