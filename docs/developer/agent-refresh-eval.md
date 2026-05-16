# Agent refresh eval

This opt-in eval checks whether a Pi agent can handle a stale CodeMap index without a dedicated refresh hook.

It creates a temporary calculator Git repo, indexes it, edits `src/calculator.ts` to add `percentOf`, then runs `pi --mode json` with only these tools enabled:

- `codemap_status`
- `codemap_index`
- `codemap_search`

The script parses Pi JSON events and reports whether the agent saw stale signals, refreshed with `codemap_index`, searched again, and answered with `src/calculator.ts`.

## Run

```bash
npm run eval:agent-refresh
```

Useful variants:

```bash
npm run eval:agent-refresh -- --prompt hint --runs 5
npm run eval:agent-refresh -- --prompt baseline --model openai-codex/gpt-5.4-mini
npm run eval:agent-refresh -- --json --strict
npm run eval:agent-refresh -- --keep-temp
```

## Current finding

On 2026-05-16, `openai-codex/gpt-5.4-mini` passed 6/6 runs:

```bash
npm run eval:agent-refresh -- --prompt all --runs 3 --model openai-codex/gpt-5.4-mini
```

Both baseline and hinted prompts saw stale signals, called `codemap_index`, searched again, and answered with `src/calculator.ts`. No forbidden `bash`, `edit`, or `write` tools were available or used.

Decision: do not add refresh automation yet. Existing stale warnings plus LLM-controlled `codemap_index` are sufficient until broader evals or real usage show repeated misses.

## Interpretation

This is not part of `npm test`: it uses a live model and is nondeterministic. Use it before deciding whether CodeMap needs refresh automation.

- If the hinted prompt passes reliably, the existing stale warnings and LLM-controlled `codemap_index` flow are probably enough.
- If the baseline prompt fails but the hinted prompt passes, improve prompt guidance before adding hooks.
- If both fail, consider an explicit refresh command or hook that still respects repo approval and `pathPrefix`.
