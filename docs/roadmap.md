# CodeMap Roadmap

This roadmap is the canonical home for future/non-V1 ideas, deferred questions, and historical delivery notes. The current V1 product contract lives in [`PRD.md`](PRD.md). The historical brainstorming note is archived at [`docs/archive/brainstorming.md`](archive/brainstorming.md).

## Current V1 contract

Do not duplicate the full V1 contract here. Use the PRD as the authoritative source for:

- V1 scope and explicit non-goals: [`PRD.md#9-v1-scope`](PRD.md#9-v1-scope)
- safety and privacy requirements: [`PRD.md#11-safety-and-privacy-requirements`](PRD.md#11-safety-and-privacy-requirements)
- storage and database design: [`PRD.md#12-data-storage`](PRD.md#12-data-storage), [`PRD.md#13-database-design`](PRD.md#13-database-design)
- tool and command contracts: [`PRD.md#14-tool-api`](PRD.md#14-tool-api), [`PRD.md#16-commands`](PRD.md#16-commands)
- packaging and core/adapter boundary: [`PRD.md#17-packaging`](PRD.md#17-packaging)
- implementation decisions and resolved defaults: [`PRD.md#19-implementation-decisions`](PRD.md#19-implementation-decisions), [`PRD.md#22-resolved-defaults`](PRD.md#22-resolved-defaults)

Roadmap items must preserve the V1 baseline constraints unless the PRD is explicitly changed first: laptop/notebook-friendly defaults, low RAM use, local SQLite/FTS5 indexing under `~/.pi/agent/state/codemap/`, no mandatory model downloads, no daemon or heavyweight runtime in ordinary agent loops, explicit per-repo approval, incremental scanning with conservative ignore/secret/binary/generated-file exclusions, line-bounded chunks for code/Markdown/text, broad code/plain-file coverage, cheap symbol extraction, status/index/search/context tools and commands, and stale-index warnings instead of automatic background refreshes.

When evaluating prior art, CodeMap should combine the strongest compatible ideas from other repos with its existing strengths, but never blindly copy designs that would make the default path heavy or less predictable.

## Prior art

- [`qmd` research notes](qmd-research.md) — lessons from `tobi/qmd` on Markdown/document retrieval, BM25/vector/RRF/reranking, local GGUF models, and what CodeMap should or should not borrow.

## Prioritized next steps

Keep this plan intentionally small. `TODO.md` tracks tactical backlog items; this section orders the next improvement slices so each can be delivered with one TDD vertical slice before moving on.

| Step | Improvement slice | Module / Seam | Public Interface to test | First behavior test | Verification |
|---|---|---|---|---|---|
| 1 | Make unindexed repo status neutral | Pi status Adapter over the core status Module | `session_start` status output and `codemap_status` contract | In an unapproved or not-yet-indexed repo, the UI shows a neutral state such as `CodeMap ○` / `not indexed`, not success or failure | `npm test -- --test-name-pattern='status'` |
| 2 | Make repo state injectable | Repo/DB state Module; `cwd`/`stateDir` Seam between core and Adapters | `approveRepo`, `indexRepo`, `status`, `searchCodeMap`, `codemapContext` | A temp `stateDir` isolates registry/index DBs and does not touch the default state path | `npm test -- --test-name-pattern='repo|state|db'` |
| 3 | Shrink adapter prompt surface | Operation catalog Module; tools/commands as Adapters | registered `promptSnippet` / `promptGuidelines` metadata | Registered CodeMap tools still explain status/index/search/context usage while staying under a small prompt budget | `npm test -- --test-name-pattern='operation|prompt|tool'` |
| 4 | Improve read-first locality | Context builder Module behind the `codemapContext` Interface | `codemapContext` result package | For a nested package target, context returns the target plus sibling tests/docs in stable read-first order and respects `pathPrefix` | `npm test -- --test-name-pattern='context|pathPrefix'` |
| 5 | Improve chunking around structure | Chunker Module behind indexing/search Interfaces | `indexRepo` → `searchCodeMap` / `codemapContext` snippets | Markdown fenced code blocks are not split, and function/class-sized code chunks keep stable line ranges | `npm test -- --test-name-pattern='chunk|snippet'` |
| 6 | Keep ranking explain out of the product surface | Search pipeline/ranking Modules | `SearchResult` remains compact | Decision: do not add user-facing explain fields; use quality gates for ranking guardrails instead | n/a |
| 7 | Expand deterministic search-quality gates | Search quality metrics Module and benchmark script | `npm run bench:search-quality:gate` | New regression cases cover implementation entrypoints, related tests/docs, and lockfile/generated-file noise | `npm run bench:search-quality:gate -- /path/to/repo` |

Architecture rule for every slice: preserve Depth by keeping product logic in `src/core/` and Pi/TUI concerns in `src/pi-extension/`; add a Seam only when it improves Locality or enables a real Adapter. TDD rule: one behavior test through the public Interface, minimal Implementation to green, then refactor.

Do not start embeddings, vector stores, graph work, or broad AST integration until steps 4-7 have measurable regressions/quality data showing the lexical/structural baseline is insufficient.

## Future work

| Area | Possible direction | Notes |
|---|---|---|
| Chunking | Better Markdown/code-fence/function-aware chunks | Borrow qmd's principles: scored breakpoints, avoid splitting fenced code, preserve line ranges. |
| Search explain | Ranking traces for path/symbol/FTS and future hybrid signals | Needed before heavier ranking changes so quality regressions are debuggable. |
| Embeddings/vector adapters | Optional local embedding provider interface; evaluate FastEmbed/ONNX and vector storage such as `sqlite-vec`, Vec1, LanceDB, or an external vector backend | No cloud requirement; FTS must stay useful without embeddings. Treat model runtimes and vector stores as opt-in. |
| Ranking | Hybrid lexical/semantic ranking, possibly Reciprocal Rank Fusion | Keep deterministic lexical ranking as the fallback; protect exact path/symbol matches. |
| ast-grep and symbols | Optional query-time structural search plus stronger symbol extraction | Must degrade cleanly when `ast-grep` is unavailable. |
| Graph and relationships | Small SQLite mini-graph for file/symbol/doc/test relationships, including test/doc relationship extraction | No external graph server. Promote only relationships that improve read-first context enough to justify maintenance. |
| Related context | Better test/doc/dependency hints | Direct local imports and reverse-import callers are implemented for read-first context; remaining work should focus on measured gaps such as Markdown links or stronger test/doc relationships. |
| CLI adapter | Add a thin `src/cli/` adapter over `src/core/` | Keep CLI output/argv parsing separate from product logic; see the architecture boundary in [`PRD.md`](PRD.md#17-packaging). |
| Memory links | Link CodeMap results to `pi-memory` artifact references | Keep CodeMap rebuildable; durable decisions stay in memory. |
| Automation | Optional hooks or commands for refresh workflows | Avoid daemon/background crawling as a default. |

## Deferred questions

- Which optional local embedding adapter should be tried first, for example FastEmbed/ONNX or another lightweight provider?
- Which vector backend, if any, is worth supporting first: `sqlite-vec`, Vec1, LanceDB, or an external vector backend?
- How far should cheap regex symbol extraction go before using optional `ast-grep`?
- How much query-time structural search should come from `ast-grep`, and what should remain lexical/FTS-only?
- After direct/reverse import hints, which graph/test/doc relationships are useful enough for V1.5/V2?
- When should a CLI adapter become worth adding, and which output modes besides JSON are needed?
- Should refresh automation be an explicit command, hook, or remain manual-only?

## Historical MVP build order

This list is preserved as delivery history and planning context, not as the current product contract:

1. README + product docs
2. Package skeleton + Pi extension loads
3. Registry + per-repo DB path handling
4. SQLite schema + migrations
5. Scanner with approval/ignore/safety rules
6. Hash/mtime incremental indexing
7. Chunker for code/Markdown/text
8. FTS5 tables and indexing
9. `codemap_status`
10. `codemap_index`
11. `codemap_search`
12. `codemap_context`
13. Minimal symbol extraction
14. Tests/docs heuristics
15. Optional V1.5 features
