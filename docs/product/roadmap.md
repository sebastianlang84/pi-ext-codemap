# CodeMap Roadmap

This roadmap is the canonical home for future/non-V1 ideas, deferred questions, and historical delivery notes. The current V1 product contract lives in [`PRD.md`](PRD.md). The historical brainstorming note is archived at [`../archive/brainstorming.md`](../archive/brainstorming.md).

## Current V1 contract

Do not duplicate the full V1 contract here. Use the PRD as the authoritative source for:

- V1 scope and explicit non-goals: [`PRD.md#9-v1-scope`](PRD.md#9-v1-scope)
- safety and privacy requirements: [`PRD.md#10-safety-and-privacy-requirements`](PRD.md#10-safety-and-privacy-requirements)
- storage and database design: [`../developer/architecture.md#storage`](../developer/architecture.md#storage), [`../developer/architecture.md#database-design`](../developer/architecture.md#database-design)
- tool and command contracts: [`PRD.md#11-tool-api-contract`](PRD.md#11-tool-api-contract), [`../user/usage.md#commands-and-tools`](../user/usage.md#commands-and-tools)
- packaging and core/adapter boundary: [`PRD.md#13-packaging-and-implementation-decisions`](PRD.md#13-packaging-and-implementation-decisions), [`../developer/architecture.md#architecture-boundary`](../developer/architecture.md#architecture-boundary)
- implementation decisions and resolved defaults: [`PRD.md#13-packaging-and-implementation-decisions`](PRD.md#13-packaging-and-implementation-decisions), [`PRD.md#16-resolved-defaults`](PRD.md#16-resolved-defaults)

Roadmap items must preserve the V1 baseline constraints unless the PRD is explicitly changed first: laptop/notebook-friendly defaults, low RAM use, local SQLite/FTS5 indexing under `~/.pi/agent/state/codemap/`, no mandatory model downloads, no daemon or heavyweight runtime in ordinary agent loops, explicit per-repo approval, incremental scanning with conservative ignore/secret/binary/generated-file exclusions, line-bounded chunks for code/Markdown/text, broad code/plain-file coverage, cheap symbol extraction, status/index/search/context tools and commands, and stale-index warnings instead of automatic background refreshes.

When evaluating prior art, CodeMap should combine the strongest compatible ideas from other repos with its existing strengths, but never blindly copy designs that would make the default path heavy or less predictable.

## Prior art

- [`qmd` research notes](../developer/qmd-research.md) — lessons from `tobi/qmd` on Markdown/document retrieval, BM25/vector/RRF/reranking, local GGUF models, and what CodeMap should or should not borrow.
- [`relationship graph plan`](../developer/relationship-graph-plan.md) — deterministic SQLite graph substrate, first hard-scoped to file import/include relationships for `codemap_context`.

## Completed V1 improvement slices

The previous prioritized TDD slices are complete and kept here as delivery history. [`TODO.md`](../../TODO.md) is the canonical tactical backlog; it contains only active concrete follow-up slices, each with scope, benefit, first test, and verification.

| Completed slice | Module / Seam | Public Interface tested | First behavior test | Verification |
|---|---|---|---|---|
| Make unindexed repo status neutral | Pi status Adapter over the core status Module | `session_start` status output and `codemap_status` contract | In an unapproved or not-yet-indexed repo, the UI shows a neutral state such as `CodeMap ○` / `not indexed`, not success or failure | `npm test -- --test-name-pattern='status'` |
| Make repo state injectable | Repo/DB state Module; `cwd`/`stateDir` Seam between core and Adapters | `approveRepo`, `indexRepo`, `status`, `searchCodeMap`, `codemapContext` | A temp `stateDir` isolates registry/index DBs and does not touch the default state path | `npm test -- --test-name-pattern='repo|state|db'` |
| Shrink adapter prompt surface | Operation catalog Module; tools/commands as Adapters | registered `promptSnippet` / `promptGuidelines` metadata | Registered CodeMap tools still explain status/index/search/context usage while staying under a small prompt budget | `npm test -- --test-name-pattern='operation|prompt|tool'` |
| Improve read-first locality | Context builder Module behind the `codemapContext` Interface | `codemapContext` result package | For a nested package target, context returns the target plus sibling tests/docs in stable read-first order and respects `pathPrefix` | `npm test -- --test-name-pattern='context|pathPrefix'` |
| Improve chunking around structure | Chunker Module behind indexing/search Interfaces | `indexRepo` → `searchCodeMap` / `codemapContext` snippets | Markdown fenced code blocks are not split, and function/class-sized code chunks keep stable line ranges | `npm test -- --test-name-pattern='chunk|snippet'` |
| Keep ranking explain out of the product surface | Search pipeline/ranking Modules | `SearchResult` remains compact | Decision: do not add user-facing explain fields; use quality gates for ranking guardrails instead | n/a |
| Expand deterministic search-quality gates | Search quality metrics Module and benchmark script | `npm run bench:search-quality:gate` | New regression cases cover implementation entrypoints, related tests/docs, and lockfile/generated-file noise | `npm run bench:search-quality:gate -- /path/to/repo` |

Architecture rule for future slices: preserve Depth by keeping product logic in `src/core/` and Pi/TUI concerns in `src/pi-extension/`; add a Seam only when it improves Locality or enables a real Adapter. TDD rule: one behavior test through the public Interface, minimal Implementation to green, then refactor.

Do not start embeddings, vector stores, graph work, or broad AST integration until existing search-quality gates show the lexical/structural baseline is insufficient for a concrete use case.

## Future work

### Positioning and improvement plan

CodeMap's intended sweet spot is narrower than a full AI IDE or code-search server: it sits between `rg`/`ctags` and systems like Cursor, Cody, Sourcegraph, or OpenGrok. `rg` gives fast text hits; CodeMap should turn those hits into an agent read plan. `ctags` gives symbols; CodeMap combines symbols with tests, docs, configs, imports, staleness, and read-budget ordering. LSP/IDEs remain better for interactive rename/diagnostics; CodeMap should stay headless, local, and Pi-agent optimized.

Near-term improvement priorities:

1. **Make the current lightweight workflow honest and strong**: keep search/context evals, preserve visible search hits in scripted read plans, and expand the natural-language holdout before claiming broad bug-report navigation.
2. **Add relationships only as measured verticals**: route↔handler, UI↔API, provider/hook↔consumer, and config-key↔usage should each get a fixture or real-repo case before any broad heuristic ships.
3. **Improve structural extraction pragmatically**: evaluate optional `ast-grep`/Tree-sitter-style extraction for imports, exports, route declarations, and test-subject detection before adding heavier graph semantics.
4. **Keep semantic/vector retrieval optional**: embeddings may help vague vocabulary mismatch, but exact path/symbol, lexical FTS, and deterministic relationships must remain the default and fallback.
5. **Expose only proven surfaces**: prefer internal eval utilities and docs over new prompt-facing tools/parameters until a measured miss requires an API change.

Main known weakness: quality depends on parser/import recognition, test conventions, and eval coverage. For large polyglot repos, the next durable lever is better structural extraction under the same local/no-daemon/no-mandatory-model constraints, not a broad knowledge graph.

### Product direction for arbitrary repos

CodeMap should improve arbitrary, non-CodeMap-optimized repositories without requiring `.codemap` folders, curated benchmark files, or manually maintained file links. Its product identity is **agent navigation**, not a general code-retrieval system: an agent asks, CodeMap returns a useful entry point, nearby files to read first, and enough internal reasons to debug bad rankings.

Think in two tracks:

- **A: get more out of the current lightweight baseline** — stronger file-role/noise handling for lockfiles/generated/vendor/build outputs, better ranking diagnostics, deterministic read-first relationships from imports, reverse imports, sibling tests, nearby configs, paths, symbols, and precise stale-index status.
- **B: add new capabilities when A is insufficient** — optional structural search (`ast-grep`) and optional semantic/vector search. PRD/feature-idea → code discovery across different vocabulary belongs here; do not promise it as a lexical feature.

File roles matter more than raw FTS rank for agents: tests are useful context, lockfiles are indexed but rarely read-first, generated/minified/build/vendor outputs get strong penalties, and large JSON/snapshots should not bloat context packages. Explicit Markdown links are only an opportunistic signal, not a central product bet.

Hard design rule for future semantic search: **exact path/symbol > lexical FTS > import/test/config neighbors > semantic similarity**. Semantics may supplement, but must not dominate or make CodeMap unpredictable.

| Area | Possible direction | Notes |
|---|---|---|
| Chunking | Better Markdown/code-fence/function-aware chunks | Borrow qmd's principles: scored breakpoints, avoid splitting fenced code, preserve line ranges. |
| Ranking diagnostics | Internal ranking traces for path/filename/symbol/FTS/token coverage/context bonuses/noise penalties | Needed before heavier ranking changes so quality regressions are debuggable; keep public `SearchResult` compact. |
| Embeddings/vector adapters | Optional local `EmbeddingProvider`, `VectorStore`, and `HybridRanker`; evaluate LanceDB first for embedded local storage, Qdrant/FastEmbed only if a stronger vector stack is intentionally needed | No cloud requirement; FTS must stay useful without embeddings. Treat model runtimes and vector stores as opt-in. |
| Ranking | Hybrid lexical/semantic ranking, possibly Reciprocal Rank Fusion | Keep deterministic lexical ranking as the fallback; exact path/symbol matches must not be displaced by semantic similarity. |
| ast-grep and symbols | Optional query-time structural search plus stronger symbol extraction | Must degrade cleanly when `ast-grep` is unavailable. |
| Graph and relationships | Small SQLite mini-graph, first for exact file import/include relationships in context | See [`relationship graph plan`](../developer/relationship-graph-plan.md). No external graph server. Keep V1.5 to file nodes plus exact `imports`/`includes`; promote broader relationships only when they improve read-first context enough to justify maintenance. |
| Related context | Better test/dependency/config hints for arbitrary repos | Direct local imports and reverse-import callers are implemented for read-first context; remaining work should focus on measured zero-config gaps such as stronger test/callsite/config relationships and context expansion reasons. Treat Markdown links as opportunistic, not central. |
| CLI adapter | Add a thin `src/cli/` adapter over `src/core/` | Keep CLI output/argv parsing separate from product logic; see the architecture boundary in [`../developer/architecture.md`](../developer/architecture.md#architecture-boundary). |
| Memory links | Link CodeMap results to `pi-memory` artifact references | Keep CodeMap rebuildable; durable decisions stay in memory. |
| Automation | Optional hooks or commands for refresh workflows | Avoid daemon/background crawling as a default. |

## Deferred questions

- Which optional local embedding adapter should be tried first, for example FastEmbed/ONNX or another lightweight provider?
- Which vector backend, if any, is worth supporting first: `sqlite-vec`, Vec1, LanceDB, or an external vector backend?
- How far should cheap regex symbol extraction go before using optional `ast-grep`?
- How much query-time structural search should come from `ast-grep`, and what should remain lexical/FTS-only?
- After direct/reverse import hints, which zero-config test/callsite/config relationships are useful enough for V1.5/V2?
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
