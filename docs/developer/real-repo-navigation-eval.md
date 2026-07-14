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
npm run eval:real-repo-navigation -- --quality-gate --min-natural-holdout-tasks 16
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
- `avgBytesRead`: total on-disk bytes of the files read within the budget — a read-cost proxy that captures a mode reading fewer *or smaller* right files, which `avgFilesRead` alone hides.
- `estTokensRead`: coarse token estimate of `avgBytesRead` (≈ bytes / 4, model-independent). Approximates the tokens an agent spends loading its read plan; not tokenizer-accurate.
- `avgToolCalls`: scripted navigation calls.
- `forbiddenReadRate`: noisy or explicitly forbidden files read, such as lockfiles or stale planning/archive files.
- `avgLatencyMs` / `p95LatencyMs`.
- `missTaxonomy`: classified misses across missing expected files and forbidden/noisy reads.
- `navigationDiagnostics`: per-case trace with selected search hits, the context target, read-first relationship reasons, final read plan, and missing-expected explanations. Miss/forbidden-read cases additionally include bounded selected/rejected search candidates with score components and read-plan budget decisions.
- `navigationMissReasons`: aggregate counts for the missing-expected explanation reasons, so taxonomy classes like `unknown` can still be split by navigation failure mode.

The miss taxonomy is diagnostic, not a gate by itself. Current classes are:

- `alias`: expected relationship likely needs path-alias resolution.
- `convention`: expected file is related by naming/framework convention rather than a direct import/search hit.
- `missing_symbol`: symbol-like query missed the expected entry file.
- `noise`: forbidden/noisy file was selected.
- `staleness`: expected file was missing while the index was stale.
- `query_formulation`: query terms do not overlap the missing expected path.
- `unknown`: miss needs manual inspection before adding heuristics.

The gate applies the success/recall/latency thresholds to the `baseline` cohort so local quality does not flap on the holdout. It also requires the natural-language holdout to be present, keep a minimum expected/context-recall floor, and avoid explicitly configured forbidden/noisy reads. The holdout floor is intentionally lower than the baseline target because the expanded set is diagnostic and should expose future improvement work as it grows.

## Current local result

On 2026-07-14, `npm run eval:real-repo-navigation:gate` evaluated 8 baseline tasks plus 16 natural-language holdout tasks with the default 5-file read budget. The local gate **passed**: across all 24 paired cases, search+context had 6 wins, 0 losses, and 18 ties against search-only.

Baseline cohort:

| Mode | Success | Entry hit | Expected recall | Context recall | Avg files | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| `lexical` | 0.125 | 0.375 | 0.448 | 0.521 | 5.000 | 30.051 ms |
| `codemap_search` | 0.500 | 1.000 | 0.823 | 0.708 | 4.875 | 34.231 ms |
| `codemap_search_context` | 0.750 | 1.000 | 0.927 | 0.896 | 5.000 | 44.367 ms |

Natural-language holdout cohort:

| Mode | Success | Entry hit | Expected recall | Context recall | Avg files | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| `lexical` | 0.125 | 0.438 | 0.375 | 0.365 | 5.000 | 21.725 ms |
| `codemap_search` | 0.438 | 0.875 | 0.724 | 0.667 | 4.875 | 30.699 ms |
| `codemap_search_context` | 0.688 | 0.875 | 0.823 | 0.812 | 5.000 | 42.991 ms |

Baseline deltas:

- Search+context vs lexical: `+0.625` success, `+0.479` expected recall, `+0.375` context recall, with the same average files read.
- Search+context vs search-only: `+0.250` success, `+0.104` expected recall, `+0.188` context recall.

The kept read-plan experiment protects visible source↔test pairs and uncovered visible test hits before context-only neighbors consume the budget. Against the frozen pre-change baseline, paired losses fell from 2 to 0, ties rose from 16 to 18, and wins stayed at 6. Natural-holdout search+context success improved from 0.625 to 0.688, expected recall from 0.771 to 0.823, and context recall from 0.719 to 0.812, with no new forbidden reads. Deterministic regression cases cover both the pi-ext-memory source/test-pair loss and the Macrolens uncovered-test loss.

Interpretation: under a realistic small read budget, CodeMap's intended search-then-context workflow remains materially better in aggregate and avoids forbidden reads in both cohorts. Preserving query-visible evidence prevents context around a wrong top hit from making the search-only read plan worse. The remaining Macrolens macro-signal entry miss is a separate ranking problem, not a reason to suppress context globally.

### Rejected experiment: suppress context on low-confidence hits

On 2026-07-13, an internal `expandContext` switch tested skipping context expansion when the top search hit had low confidence. It removed the then-observed paired losses (2 to 0), but regressed holdout success from 0.625 to 0.438, reduced context wins from 5 to 3, and introduced a 0.063 forbidden-read rate. Context expansion was net positive even on low-confidence hits, including through noise displacement, so this approach was rejected. Future work should target the specific entry-ranking or read-plan miss with one measured lever rather than globally suppressing context.

## Known limitations and risks exposed by the eval

The eval is intentionally honest. The current local gate is green and still exposes these risks and next validation areas:

- Minimal TypeScript/JavaScript path-alias support covers indexed `tsconfig.json` / `jsconfig.json` `baseUrl` + `paths`; it does not yet chase complex `extends` chains or package-manager workspace aliases.
- Some framework/UI-to-API relationships are convention/config based, not import based.
- Alias imports add useful direct neighbors and increase average search+context reads on this suite; direct imports and imported-neighbor convention tests are therefore capped in small read budgets.
- The scripted `codemap_search_context` read plan keeps the top visible search hit, protects visible source↔test pairs and uncovered visible tests, prefers high-confidence context tests/configs, preserves context-backed search hits, defers archived docs behind active search/context candidates, and only promotes one direct import when no doc/config or unsearched test/config neighbor competes. For API route-adapter targets, it instead prefers the path-affine imported implementation plus its test before generic configs so endpoint reads stay source-centered.
- The expanded natural-language holdout is local and partly paired with baseline tasks. It intentionally exposes misses even while the paired-loss gate passes. Root README fallback is only used when no name/path-specific docs were found, so specific PRDs or docs keep their budget priority. Next.js API route-adapter prioritization is limited to reverse importers under `app/api/**/route.*`, and endpoint route retrieval only adds route candidates when route path terms are adjacent to `endpoint`.
- Search+context is slower than lexical scanning on these small repos, though still under the local gate threshold.

These are candidates for future gated work; they should not be expanded unless this real-repo eval or a follow-up case proves the benefit.
