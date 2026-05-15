# CodeMap user guide

Read this file when you want to understand what CodeMap can do, which features exist today, and how to use them in Pi.

## What CodeMap is

CodeMap is a local repository map for Pi coding agents. It indexes the current Git repo into SQLite/FTS and gives agents a small set of tools for finding the right files before reading or editing code.

Use CodeMap when you want to answer:

- Where is this feature, symbol, endpoint, config key, or script implemented?
- Which file should I read first before making a change?
- Are there nearby tests, docs, imports, or callers worth checking?
- Is the index fresh enough to trust?

CodeMap is not a semantic memory system. `pi-memory` stores durable decisions and handoffs; CodeMap indexes rebuildable repo state.

## Main features

| Feature | What it does | How to use it |
|---|---|---|
| Repo approval | Requires explicit approval before indexing a Git repo. | `/codemap-index --approve-repo` |
| Local indexing | Stores a rebuildable SQLite index under `~/.pi/agent/state/codemap/`. | `/codemap-index` |
| Status diagnostics | Shows approval, index counts, DB path, and optional stale diagnostics. | `/codemap-status --full` |
| Code/text search | Searches paths, chunks, and cheap symbols with SQLite FTS. | `/codemap-search <query>` |
| Read-first context | Returns the target file plus likely imports, callers, tests, and docs. | `/codemap-context <path-or-query>` |
| Monorepo scoping | Limits status/index/search/context to a subtree. | `--path-prefix services/api` |
| Stale warnings | Warns instead of silently refreshing old results. | Refresh with `/codemap-index` |
| Noise handling | Keeps lockfiles/generated/build/minified files from dominating ordinary results. | Automatic; explicit lockfile queries still work. |

## Install

```bash
pi install git:github.com/sebastianlang84/pi-ext-codemap
```

For local development:

```bash
cd /path/to/pi-ext-codemap
pi install .
```

## First use in a repo

Approve and index the current Git repository:

```text
/codemap-index --approve-repo
```

After that, refresh the same repo without re-approving:

```text
/codemap-index
```

Check whether the index is ready:

```text
/codemap-status
```

Run full stale diagnostics when freshness matters:

```text
/codemap-status --full
```

## Typical workflows

### Find where something is implemented

```text
/codemap-search auth middleware
/codemap-search parsePathPrefix
/codemap-search package.json dependencies
```

Then read the best matching file with Pi's normal file-reading tools.

### Build context before editing a file

```text
/codemap-context src/core/search.ts
```

For direct file targets, CodeMap may return:

- the target file's first useful chunk;
- directly imported local files;
- local files that import the target;
- likely sibling tests;
- likely related docs.

Treat this as a read-first list, not as a replacement for reading the files.

### Work inside a monorepo subtree

```text
/codemap-index --path-prefix services/api
/codemap-search --path-prefix services/api auth middleware
/codemap-context --path-prefix services/api src/auth/middleware.ts
/codemap-status --full --path-prefix services/api
```

`pathPrefix` is normalized to a repository-relative POSIX path and is supported by all four operations.

### Handle stale results

Search and context include stale warnings when the index no longer matches the working tree. CodeMap does not auto-refresh in the background.

If results are stale and freshness matters:

```text
/codemap-index
```

For scoped refreshes:

```text
/codemap-index --path-prefix services/api
```

## Commands and tools

Pi commands are for humans in the TUI. LLM tools expose the same operations as structured JSON.

| Operation | Command | Tool params | Result shape |
|---|---|---|---|
| Status | `/codemap-status [--full] [--path-prefix <subtree>]` | `codemap_status({ full?, pathPrefix? })` | repo approval, DB path, file/chunk/symbol counts, `lastIndexedAt`, stale diagnostics when `full=true` |
| Index | `/codemap-index [--approve-repo] [--path-prefix <subtree>]` | `codemap_index({ approveRepo?, pathPrefix? })` | `scanned`, `indexed`, `skipped`, `removed`, `warnings`, `skippedReasons`, `root`, `dbPath`, `pathPrefix` |
| Search | `/codemap-search [--path-prefix <subtree>] <query>` | `codemap_search({ query, limit?, pathPrefix? })` | `results[]` with `path`, `language`, `startLine`, `endLine`, `kind`, `snippet`, `score`, plus stale warnings |
| Context | `/codemap-context [--path-prefix <subtree>] <target>` | `codemap_context({ target, limit?, pathPrefix? })` | `readFirst[]`, `relatedTests[]`, `relatedDocs[]`, stale diagnostics, warnings |

Recommended agent flow:

1. Use `codemap_status` if approval, index existence, or freshness is uncertain.
2. Use `codemap_index` when the repo was explicitly approved or the index should be refreshed.
3. Use `codemap_search` when the relevant file/symbol/subsystem is unknown.
4. Use `codemap_context` after finding a likely target, then read source files before editing.

## What gets indexed

CodeMap indexes common code, docs, and config files, including:

- TypeScript/JavaScript;
- Python;
- Shell;
- Go/Rust/Java/Kotlin/Ruby/PHP/C/C++ and similar files as plain text;
- Markdown/MDX/RST/TXT;
- JSON/YAML/TOML/SQL/CSS/SCSS/HTML;
- important config files.

During indexing it:

- respects `.gitignore` and optional `.codemapignore` rules;
- skips symlinks;
- skips secret-like files such as `.env`;
- skips binary-looking files and files containing NUL bytes;
- skips files larger than 1 MB;
- skips dependency/generated/cache/build folders such as `.git`, `node_modules`, `dist`, `build`, `coverage`, `.venv`, `site-packages`, and `__pycache__`;
- stores path, language, size, SHA-256 hash, and mtime;
- chunks source files into overlapping line ranges and Markdown files by headings;
- extracts cheap symbols such as TypeScript/JavaScript classes, functions, const arrow functions, interfaces, types, methods, Python classes/functions, and Markdown headings;
- writes paths, chunks, and symbols into SQLite FTS5 tables.

Re-indexing is incremental: unchanged files are skipped, changed files are refreshed, and deleted files are removed.

## Ranking behavior in plain language

CodeMap ranking is deterministic and lexical/local-first. It does not use embeddings in V1.

Strong signals:

- exact path/name matches;
- exact or prefix symbol matches;
- SQLite FTS matches in chunks and symbols;
- query-token coverage in path, filename, symbol, and text;
- role boosts for likely implementation, config, dependency, docs, or tests.

Noise handling:

- lockfiles are indexed but penalized for ordinary queries;
- generated/build/vendor/minified files are skipped or de-prioritized;
- read-first context filters noisy related neighbors;
- explicit queries such as `package-lock.json` can still find lockfiles.

## What CodeMap deliberately does not do in V1

- No daemon or background watcher.
- No remote service.
- No mandatory embeddings or model downloads.
- No full callgraph.
- No external graph database.
- No automatic scan of all repos or `$HOME`.

Future/non-V1 ideas are tracked in [`../product/roadmap.md`](../product/roadmap.md).

## Compatibility

Use the `codemap_*` tools and `/codemap-*` commands.
