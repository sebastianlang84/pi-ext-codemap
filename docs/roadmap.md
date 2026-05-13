# CodeMap Roadmap

This roadmap captures future ideas that are not part of the current V1 contract. The historical brainstorming note is archived at [`docs/archive/brainstorming.md`](archive/brainstorming.md).

## Current V1 baseline

V1 is intentionally local, lexical, and lightweight:

- explicit per-repo approval before indexing;
- SQLite + FTS5 index under `~/.pi/agent/state/codemap/`;
- incremental scanner with conservative ignore/secret/binary/generated-file exclusions;
- line-bounded chunks for code, Markdown, and text;
- cheap regex symbol extraction;
- tools and commands for status, indexing, search, and read-first context;
- stale-index warnings instead of automatic background refreshes.

## Future work

| Area | Possible direction | Notes |
|---|---|---|
| Embeddings | Optional local embedding provider interface | No cloud requirement; FTS must stay useful without embeddings. |
| Ranking | Hybrid lexical/semantic ranking, possibly RRF | Keep deterministic lexical ranking as the fallback. |
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
