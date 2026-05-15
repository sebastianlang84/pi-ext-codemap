# CodeMap developer architecture

This document is the canonical maintainer reference for CodeMap internals. Product scope lives in [`../product/PRD.md`](../product/PRD.md); user-facing command usage lives in [`../user/usage.md`](../user/usage.md).

## Architecture boundary

CodeMap is split into a Pi adapter layer and a Pi-independent core.

- `src/core/` owns product logic: repo detection, approval, DB paths, indexing, search, context building, and structured result objects.
- `src/core/` must stay independent of Pi extension APIs: no `ExtensionAPI`, `ctx`, `pi`, slash-command parsing, tool rendering, or `console.log()` output behavior.
- `src/pi-extension/` owns tool/command registration, TypeBox schemas, prompt snippets/guidelines, command parsing, UI notifications, and TUI rendering.
- Future adapters, especially `src/cli/`, should call the same core APIs instead of duplicating status/index/search/context behavior.
- Core state and execution context should be injectable where practical (`cwd`, `stateDir`) so tests and future adapters can choose output/state behavior without changing product logic.
- The root `index.ts` remains a thin package entrypoint shim for the Pi manifest.

Key current structure:

```text
pi-ext-codemap/
  README.md
  index.ts
  docs/
    product/
      PRD.md
      roadmap.md
    user/
      usage.md
    developer/
      architecture.md
      qmd-research.md
      search-quality.md
    archive/
      brainstorming.md
  migrations/
    001_init.sql
    002_fts.sql
  src/
    core/
    pi-extension/
  test/
  scripts/
  package.json
```

## Storage

CodeMap uses local per-repo SQLite databases plus a global registry:

```text
~/.pi/agent/state/codemap/
  registry.sqlite
  repos/
    <repo-hash>.sqlite
```

Rationale:

- simple cleanup per repo;
- less locking contention;
- easier debugging;
- avoids committing DBs into repos;
- keeps registry separate from rebuildable index content.

## Database design

Use Node.js `node:sqlite` `DatabaseSync` plus raw SQL migrations. Do not introduce Prisma or an ORM.

Registry table:

```sql
repos(
  key text primary key,
  root_path text not null unique,
  git_remote text,
  enabled integer not null,
  approved_at text not null,
  approval_source text not null,
  updated_at text not null
);
```

Per-repo index tables:

```sql
meta(key text primary key, value text not null);

files(
  id integer primary key,
  path text not null unique,
  language text not null,
  size integer not null,
  hash text not null,
  mtime_ms real not null,
  indexed_at text not null
);

chunks(
  id integer primary key,
  file_id integer not null references files(id) on delete cascade,
  ordinal integer not null,
  start_line integer not null,
  end_line integer not null,
  kind text not null,
  text text not null,
  unique(file_id, ordinal)
);

symbols(
  id integer primary key,
  file_id integer not null references files(id) on delete cascade,
  name text not null,
  kind text not null,
  start_line integer not null,
  end_line integer,
  signature text
);
```

FTS tables:

```sql
chunks_fts(path, language, kind, text);
symbols_fts(path, name, kind, signature);
```

## Scanner and indexing policy

Default indexing is whitelist-first. The scanner should:

- require explicit approval before first indexing;
- stay inside the current Git repository boundary;
- respect `.gitignore` and optional `.codemapignore` rules;
- skip symlinks;
- skip binaries, unsupported extensions, secret-like files, generated/cache/build/dependency folders, and files larger than 1 MB;
- support common source, docs, config, SQL, CSS/HTML, shell, and plain-text extensions;
- use hash/mtime checks for incremental refreshes;
- remove deleted files from the index;
- keep indexing manual/on-demand, not daemonized.

Lockfiles are supported text files, not generated binaries. They may be indexed for explicit lockfile queries but are penalized in ordinary ranking and filtered from related read-first neighbors.

## Search and ranking

V1 ranking is deterministic and lexical/local-first. Embeddings are not part of V1 ranking.

Primary positive signals:

1. Exact path/name match.
2. Exact or prefix symbol match.
3. SQLite FTS chunk/symbol match.
4. Token coverage in path, filename, symbol, and chunk text.
5. Query-intent boosts for implementation/config/dependency/docs/tests where applicable.
6. File-role boosts such as implementation entrypoints or dependency manifests.

Noise handling:

- Lockfiles receive a strong noise penalty for ordinary queries; explicit lockfile/path queries can still surface them first.
- Generated files, build output, vendor/output folders, and minified files are strongly de-prioritized or skipped depending on scan policy.
- Tests and docs are useful context, not generic noise.
- Public `codemap_search` results stay compact and do not expose ranking explain fields.
- Internal score diagnostics may decompose retrieval/FTS/path/filename/symbol/coverage/role/noise components for tests and benchmark debugging.

Search-quality gates and diagnostics are documented in [`search-quality.md`](search-quality.md).

## Context builder

`codemap_context` builds a compact read-first package for an indexed file path or falls back to search results for a symbol/query.

For direct file targets, context can include:

- target file chunks;
- directly imported local files;
- indexed local files that import the target;
- likely sibling tests;
- likely related docs.

Related imports/reverse-imports are resolved from indexed content, so context remains useful even when the working tree is stale. `pathPrefix` must scope context and related-file discovery to the requested subtree.

Noisy related paths — lockfiles, generated files, build output, minified files — are filtered out of `readFirst`, while an explicitly requested noisy target may still be returned directly.

## Tool API contracts

The public Pi tool/command surface is intentionally small:

- `codemap_status`
- `codemap_index`
- `codemap_search`
- `codemap_context`

Detailed user-facing command usage is in [`../user/usage.md`](../user/usage.md). Product-level contracts are in [`../product/PRD.md#11-tool-api-contract`](../product/PRD.md#11-tool-api-contract).

## Testing policy

Tests should assert external behavior and contracts: indexed files, skipped files, tool outputs, warnings, and ranking order for representative cases.

Coverage expectations:

- Scanner tests: allowlists, default excludes, `.gitignore`, `.codemapignore`, size limits, symlinks, deleted files, secret-like files.
- Migration/database tests: schema creation, FTS table availability, uniqueness constraints, repeatable migrations.
- Indexer tests: first indexing, incremental no-op indexing, changed files, deleted files, failed runs.
- Chunker tests: code, Markdown headings, fenced code blocks, plain text, line ranges, overlap/default sizing, truncation-safe snippets.
- Search tests: path matches, symbol matches, FTS chunk matches, doc matches, test boosts, limits, empty results, ranking/noise behavior.
- Context tests: read-first ordering, related tests/docs/imports/callers, budget limits, stale warnings, missing target behavior, `pathPrefix` scoping.
- Safety tests: unapproved repos cannot be indexed; paths outside the repo root are rejected.
- Package/integration tests: the Pi extension loads and each V1 tool validates inputs and returns the documented contract.

Run the standard checks:

```bash
npm run typecheck
npm test
npm run audit:lightweight
```

Run the search-quality gate when changing ranking, query planning, chunking, or symbol extraction:

```bash
npm run bench:search-quality:gate
```
