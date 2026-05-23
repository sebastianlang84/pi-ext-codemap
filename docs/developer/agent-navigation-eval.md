# Agent navigation eval

This deterministic eval estimates CodeMap's agent-navigation value without a live LLM. It uses the checked-in context-quality fixture, copies it into a temporary clean Git repo, indexes it, then compares three scripted navigation modes over fixed tasks with the same read budget, defaulting to 8 files:

1. `lexical` — rg-like tracked-file lexical matching.
2. `codemap_search` — read the top CodeMap search paths only.
3. `codemap_search_context` — search, call `codemap_context` on the top hit, then merge visible search hits and context paths under the same read budget.

The eval is a proxy for agent behavior on these fixture tasks: it measures whether the right entry file and required read-first neighbors would be available to an agent. It is not a replacement for the live-model `eval:agent-refresh` style tests.

## Run

```bash
npm run eval:agent-navigation
npm run eval:agent-navigation:gate
```

Useful variants:

```bash
npm run eval:agent-navigation -- --limit 8
npm run eval:agent-navigation -- --quality-gate --max-p95-ms 200
npm run eval:agent-navigation -- --keep-state
```

## Metrics

Per mode, the eval reports:

- `successRate`: entry file found, all required context found, and no forbidden/noisy file read.
- `entryHitRate`: expected entry file was read.
- `avgContextRecall`: fraction of required neighbors read.
- `avgFilesRead`: unique files read by the mode.
- `avgToolCalls`: scripted tool-call count for the mode.
- `forbiddenReadRate`: tasks where generated/build/lockfile/cross-prefix noise was read.
- `avgLatencyMs` and `p95LatencyMs`.

The gate currently requires `codemap_search_context` to reach full success/entry/context recall, avoid forbidden reads, stay under the latency threshold, and improve context recall over plain `codemap_search` with the same read budget.

## Current fixture result

On 2026-05-23, `npm run eval:agent-navigation:gate` passed on 4 fixture tasks with the default 8-file read budget:

| Mode | Success | Entry hit | Context recall | Forbidden read | Avg files | p95 latency |
|---|---:|---:|---:|---:|---:|---:|
| `lexical` | 0.50 | 1.00 | 0.667 | 0.25 | 4.00 | 11.840 ms |
| `codemap_search` | 0.50 | 1.00 | 0.667 | 0.00 | 2.75 | 15.300 ms |
| `codemap_search_context` | 1.00 | 1.00 | 1.000 | 0.00 | 4.25 | 33.120 ms |

Interpretation for this fixture: `codemap_search` is good at finding entry files and sometimes already surfaces query-relevant neighbors; `codemap_context` supplies the missing relationship neighbors when search-only is sparse.

## Boundary

This eval intentionally does not change `codemap_search` ranking, tool schemas, prompt text, or graph scope. It is evidence for the current agent-navigation workflow: search for an entry point, preserve visible search hits as candidates, then call context before reading/editing broadly.
