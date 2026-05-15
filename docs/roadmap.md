# CodeMap Roadmap

This roadmap captures future ideas that are not part of the current V1 contract. The historical brainstorming note is archived at [`docs/archive/brainstorming.md`](archive/brainstorming.md).

## Current V1 baseline

V1 is intentionally local, lexical, and lightweight:

- laptop/notebook-friendly default behavior with low RAM use;
- no mandatory model downloads, daemon, or heavyweight runtime in ordinary agent loops;
- explicit per-repo approval before indexing;
- SQLite + FTS5 index under `~/.pi/agent/state/codemap/`;
- incremental scanner with conservative ignore/secret/binary/generated-file exclusions;
- line-bounded chunks for code, Markdown, and text;
- broad code + plain-file coverage, including C/C++, TypeScript/JavaScript, Python, Markdown, YAML, TOML, JSON, shell, SQL, and similar files;
- cheap regex symbol extraction;
- tools and commands for status, indexing, search, and read-first context;
- stale-index warnings instead of automatic background refreshes.

When evaluating prior art, CodeMap should combine the strongest compatible ideas from other repos with its existing strengths, but never blindly copy designs that would make the default path heavy or less predictable.

## Prior art

- [`qmd` research notes](qmd-research.md) — lessons from `tobi/qmd` on Markdown/document retrieval, BM25/vector/RRF/reranking, local GGUF models, and what CodeMap should or should not borrow.

## Future work

| Area | Possible direction | Notes |
|---|---|---|
| Chunking | Better Markdown/code-fence/function-aware chunks | Borrow qmd's principles: scored breakpoints, avoid splitting fenced code, preserve line ranges. |
| Search explain | Ranking traces for path/symbol/FTS and future hybrid signals | Needed before heavier ranking changes so quality regressions are debuggable. |
| Embeddings | Optional local embedding provider interface | No cloud requirement; FTS must stay useful without embeddings. Treat model runtimes as opt-in. |
| Ranking | Hybrid lexical/semantic ranking, possibly RRF | Keep deterministic lexical ranking as the fallback; protect exact path/symbol matches. |
| ast-grep | Optional structural search and symbol extraction | Must degrade cleanly when `ast-grep` is unavailable. |
| Graph | Small SQLite graph for file/symbol/doc/test relationships | No external graph server. |
| Related context | Better test/doc/dependency hints | Current V1 has simple path-based related test/doc hints. |
| Memory links | Link CodeMap results to `pi-memory` artifact references | Keep CodeMap rebuildable; durable decisions stay in memory. |
| Automation | Optional hooks or commands for refresh workflows | Avoid daemon/background crawling as a default. |

## Deferred questions

- Which local embedding adapters are worth supporting first?
- How much structural extraction should come from regexes versus optional `ast-grep`?
- What graph relationships are useful enough to maintain?
- Should refresh automation be a hook, a command, or remain manual-only?
