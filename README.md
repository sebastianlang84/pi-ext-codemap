# CodeMap

**A lightweight local map of a repository for Pi coding agents.**

CodeMap indexes code and plain-text project files into a local SQLite/FTS database so an agent can quickly find relevant files, symbols, chunks, tests, docs, and config before reading or editing. It is designed to be notebook-friendly by default: no daemon, no remote service, no mandatory embeddings, and no model downloads in the normal path.

It complements `pi-memory`:

```text
pi-memory stores durable decisions and handoffs.
CodeMap indexes the current repo state and can be rebuilt.
```

## Why CodeMap exists

Agents are better at code changes when they first know where to look. CodeMap gives Pi agents a rebuildable, local repo map with line ranges and search signals, without turning every lookup into an LLM or vector-search problem.

Use CodeMap when you need to answer questions like:

- Where is this feature, symbol, endpoint, script, or config defined?
- Which files should be read first before editing?
- Which related tests or docs should be checked?
- Is the local index fresh enough to trust?

## What CodeMap does

After explicit approval, CodeMap indexes the current Git repository into a local SQLite database under `~/.pi/agent/state/codemap/`. Repository content is not sent to a remote service.

During indexing it:

- respects `.gitignore` and optional `.codemapignore` rules;
- skips symlinks, binary-looking files, secret-like files such as `.env`, and generated/vendor/cache folders such as `.git`, `node_modules`, `dist`, `build`, `coverage`, `.venv`, `site-packages`, and `__pycache__`;
- indexes supported source/text extensions such as TypeScript/JavaScript, Markdown, JSON/YAML, SQL, CSS/HTML, Python, Go, Rust, Java, shell, C/C++, and similar files;
- skips files larger than 1 MB or containing NUL bytes;
- stores each file's path, language, size, SHA-256 hash, and mtime;
- chunks source files into overlapping line ranges and Markdown files by headings;
- extracts cheap symbols such as TypeScript/JavaScript classes, functions, const arrow functions, interfaces, types, methods, and Markdown headings;
- writes paths, chunks, and symbols into SQLite FTS5 tables.

Re-indexing is incremental: unchanged files are skipped, changed files are refreshed, and deleted files are removed. `pathPrefix` can scope indexing, status, search, and context to a subtree in monorepos.

## What is possible in V1

| Capability | Status |
|---|---|
| Approve and index the current Git repo locally | Implemented |
| Search code plus Markdown/YAML/JSON/TOML/plain project files | Implemented |
| Search paths, chunks, and cheap symbols with SQLite FTS5 | Implemented |
| Return line-bounded snippets with ranking scores | Implemented |
| Return read-first context for a file, symbol, feature, or query | Implemented |
| Warn when the index is stale | Implemented |
| Provide simple related test/doc path hints | Implemented |
| Legacy `codebase_*` aliases | Removed; use `codemap_*` |
| Embeddings/vector search | Planned, not V1 |
| ast-grep integration, callgraphs, graph expansion | Planned, not V1 |
| Daemon/background watcher or remote service | Not a goal |

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

## Commands and tools

Pi commands are for humans in the TUI. LLM tools expose the same operations as structured JSON.

| Operation | Command | Tool params | Result shape |
|---|---|---|---|
| Status | `/codemap-status [--full] [--path-prefix <subtree>]` | `codemap_status({ full?, pathPrefix? })` | repo approval, DB path, file/chunk/symbol counts, `lastIndexedAt`, stale diagnostics when `full=true` |
| Index | `/codemap-index [--approve-repo] [--path-prefix <subtree>]` | `codemap_index({ approveRepo?, pathPrefix? })` | `scanned`, `indexed`, `skipped`, `removed`, `warnings`, `skippedReasons`, `root`, `dbPath` |
| Search | `/codemap-search [--path-prefix <subtree>] <query>` | `codemap_search({ query, limit?, pathPrefix? })` | `results[]` with `path`, `language`, `startLine`, `endLine`, `kind`, `snippet`, `score`, plus stale warnings |
| Context | `/codemap-context [--path-prefix <subtree>] <target>` | `codemap_context({ target, limit?, pathPrefix? })` | `readFirst[]`, `relatedTests[]`, `relatedDocs[]`, stale diagnostics, warnings |

Use the tools this way:

1. `codemap_status` when approval, index existence, or freshness is uncertain.
2. `codemap_index` when the repo was explicitly approved or the index should be refreshed.
3. `codemap_search` when the relevant file/symbol/subsystem is not known yet.
4. `codemap_context` after finding a likely target, then read source files before editing.

## Compatibility

Use the `codemap_*` tools and `/codemap-*` commands. Legacy `codebase_*` tool aliases and `/codebase-*` commands have been removed to keep the default Pi tool surface small.

CodeMap non-destructively migrates existing `~/.pi/agent/codemap/` or `~/.pi/agent/code-search/` data into `~/.pi/agent/state/codemap/` when needed.

## Documentation map

- [`PRD.md`](PRD.md) — product contract, safety rules, data model, and implementation decisions.
- [`docs/roadmap.md`](docs/roadmap.md) — planned/non-V1 ideas.
- [`docs/search-quality.md`](docs/search-quality.md) — maintainer notes for ranking/search-quality benchmark usage.
- [`docs/qmd-research.md`](docs/qmd-research.md) — prior-art notes from `tobi/qmd` and implications for chunking, vector search, models, and lightweight defaults.
- [`docs/archive/brainstorming.md`](docs/archive/brainstorming.md) — original historical brainstorming note, no longer authoritative.

## License

MIT, as declared in `package.json`.
