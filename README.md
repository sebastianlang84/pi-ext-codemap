# pi-ext-code-search

Local SQLite/FTS codebase search and context tools for Pi coding agents.

## Tools

- `codebase_status` — show approval/index diagnostics for the current Git repo.
- `codebase_index` — approve and/or refresh the local index.
- `codebase_search` — search indexed paths, symbols, and chunks.
- `codebase_context` — get a compact read-first context package for a path or symbol.

## Commands

- `/codebase-status`
- `/codebase-index --approve-repo`
- `/codebase-search <query>`
- `/codebase-context <path-or-symbol>`

## Safety model

Indexing is local-only and limited to the current Git repository. First indexing requires explicit approval via `approveRepo: true` or `/codebase-index --approve-repo`. Symlinks, secret-like files, binary/generated files, and common heavy directories are skipped.

## Development

```bash
npm install
npm run typecheck
pi -e .
```

Indexes are stored under `~/.pi/agent/code-search/`.
