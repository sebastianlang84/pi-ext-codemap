# pi-ext-code-search

Local SQLite/FTS codebase search for Pi coding agents. It indexes the current Git repository and gives agents fast path, symbol, and source-chunk lookup without sending code to a remote service.

## What it can do

- Build a local search index for the current Git repository.
- Search indexed paths, cheap symbols, and source chunks.
- Return compact read-first context for a file, symbol, or natural-language query.
- Warn when the index is stale without silently mutating it.
- Skip symlinks, binary/generated files, secret-like files, and heavy directories.
- Store indexes locally under `~/.pi/agent/code-search/`.

## Tools

| Tool | Use it for |
| --- | --- |
| `codebase_status` | Show approval and index status. Cheap by default; pass `full: true` for stale-index diagnostics. |
| `codebase_index` | Approve a repository for indexing and refresh its local index. |
| `codebase_search` | Search indexed paths, symbols, and chunks. |
| `codebase_context` | Get a compact read-first context package for a path, symbol, or query. |

## Commands

| Command | Use it for |
| --- | --- |
| `/codebase-status` | Show cheap approval/index diagnostics. |
| `/codebase-status --full` | Show exact changed/missing/deleted stale-index diagnostics. |
| `/codebase-index --approve-repo` | Approve and index the current Git repository. |
| `/codebase-search <query>` | Search the local index. |
| `/codebase-context <path-or-symbol>` | Show compact read-first context. |

## Install

From a local clone:

```bash
cd /absolute/path/to/pi-ext-code-search
pi install .
```

Upgrade an existing local install:

```bash
cd /absolute/path/to/pi-ext-code-search
git pull
pi update .
```

If `pi update .` is not available for your install source, run `pi install .` again after pulling.

## First use

Indexing requires explicit per-repository approval:

```text
/codebase-index --approve-repo
```

After that, use `codebase_search`, `codebase_context`, or the matching slash commands. Refresh the index explicitly after code changes when stale warnings matter.

## Quick checks

```bash
npm install
npm run typecheck
npm test
npm run audit:lightweight
```

## License

MIT, as declared in `package.json`.
