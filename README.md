# CodeMap

**A lightweight local map of a repository for Pi coding agents.**

CodeMap indexes code and plain-text project files into a local SQLite/FTS database so an agent can quickly find relevant files, symbols, chunks, tests, docs, and config before reading or editing. It is notebook-friendly by default: no daemon, no remote service, no mandatory embeddings, and no model downloads in the normal path.

It complements `pi-memory`:

```text
pi-memory stores durable decisions and handoffs.
CodeMap indexes the current repo state and can be rebuilt.
```

## Install

```bash
pi install git:github.com/sebastianlang84/pi-ext-codemap
```

For local development:

```bash
cd /path/to/pi-ext-codemap
pi install .
```

## Quick start

Approve and index the current Git repository once:

```text
/codemap-index --approve-repo
```

Check health before relying on old results:

```text
/codemap-status --full
```

Find relevant files, symbols, or chunks:

```text
/codemap-search memory handoff retrieval
/codemap-search --path-prefix services/api auth middleware
```

Get a compact read-first package before opening broader code:

```text
/codemap-context src/core/search.ts
/codemap-context --path-prefix services/api auth middleware
```

Start with [`docs/user/usage.md`](docs/user/usage.md) to understand what CodeMap can do, which features exist today, and how to use them.

## What CodeMap does

After explicit approval, CodeMap indexes the current Git repository into a local SQLite database under `~/.pi/agent/state/codemap/`. Repository content is not sent to a remote service.

Implemented V1 capabilities:

- approve and index the current Git repo locally;
- search code plus Markdown/YAML/JSON/TOML/plain project files;
- search paths, chunks, and cheap symbols with SQLite FTS5;
- return line-bounded snippets with ranking scores;
- return read-first context for a file, symbol, feature, or query;
- warn when the index is stale;
- provide simple related test/doc/import/caller hints;
- scope status, indexing, search, and context to a subtree with `pathPrefix`.

## Documentation map

- [`docs/user/usage.md`](docs/user/usage.md) — start here to understand features, workflows, commands/tools, examples, and compatibility.
- [`docs/product/PRD.md`](docs/product/PRD.md) — product contract, scope, goals, constraints, success metrics.
- [`docs/product/roadmap.md`](docs/product/roadmap.md) — future/non-V1 ideas, deferred questions, delivery history.
- [`docs/developer/architecture.md`](docs/developer/architecture.md) — storage, schema, scanner/index/search/context architecture, adapter boundary, testing policy.
- [`docs/developer/search-quality.md`](docs/developer/search-quality.md) — maintainer notes for ranking/search-quality benchmark usage.
- [`docs/developer/qmd-research.md`](docs/developer/qmd-research.md) — prior-art notes from `tobi/qmd` and implications for chunking, vector search, models, and lightweight defaults.
- [`docs/archive/brainstorming.md`](docs/archive/brainstorming.md) — original historical brainstorming note, no longer authoritative.

## License

MIT, as declared in `package.json`.
