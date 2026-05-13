# PRD: pi-ext-codemap

## 1. Summary

`pi-ext-codemap` is a lightweight local codebase search and context extension for Pi/Coding Agents.

It indexes the current repository state into a local SQLite/FTS5 database and provides agent-friendly tools for finding relevant files, line ranges, snippets, docs, tests, and entry points.

It complements `pi-memory` but is not part of it.

```text
pi-memory stores durable decisions.
pi-ext-codemap indexes current repo state.
```

## 2. Problem

Coding agents often need fast, low-noise repo context before making changes:

- Which files are relevant to a task?
- Where is a symbol, feature, or subsystem implemented?
- Which tests or docs should be read before editing a file?
- What line ranges are worth inspecting without dumping entire files?

Current options are either too primitive, too broad, or too heavy:

- `rg` is excellent but returns raw matches, not curated context.
- LSPs focus on editor integration, not compact agent context packages.
- GitNexus is more powerful than needed for this lightweight use case.
- `pi-memory` is for durable semantic memory, not rebuildable repo indexes.

## 3. Solution

From the user's perspective, `pi-ext-codemap` provides a small set of Pi-native commands and tools that can approve, index, search, and explain a repository locally. The agent can ask for a query, file, or symbol and receive a compact read-first context package with paths, line ranges, snippets, related tests/docs, and index health warnings.

The V1 solution is intentionally lexical/local-first: SQLite + FTS5 + cheap symbol extraction + deterministic ranking. Embeddings, graph expansion, and ast-grep integrations remain later enhancements unless they can be added without making V1 heavier.

## 4. User Stories

1. As a Pi coding agent, I want to search a repo by feature, symbol, or phrase, so that I can find relevant files before editing.
2. As a Pi coding agent, I want line-bounded snippets, so that I can read targeted ranges instead of whole files.
3. As a Pi coding agent, I want a read-first context package for a file or symbol, so that I can inspect likely dependencies, tests, and docs in the right order.
4. As a Pi coding agent, I want stale-index warnings, so that I do not rely on outdated search results.
5. As a human Pi user, I want explicit repo approval before indexing, so that the tool never scans arbitrary private folders.
6. As a human Pi user, I want status diagnostics, so that I can see whether a repo is approved, indexed, stale, or partially skipped.
7. As a future extension author, I want a simple local index API, so that other Pi workflows can reuse file, chunk, symbol, and context results.
8. As an agent resuming work from a handoff, I want stable file and line references, so that I can quickly reopen the relevant code context.
9. As a privacy-conscious user, I want local-only storage, so that no repository content leaves the machine.
10. As a maintainer, I want cheap incremental indexing, so that repeated searches do not require full rescans.

## 5. Goals

### Product Goals

- Provide a small local repo navigation tool for Pi agents.
- Return compact, useful context packages with minimal token waste.
- Keep all indexing local and rebuildable.
- Avoid daemon, server, cloud, or heavy graph dependencies.
- Make FTS/path/symbol/doc search useful before adding embeddings.

### V1 Technical Goals

- Local per-repo SQLite database.
- SQLite FTS5 full-text search.
- Repo scanner with allowlist/ignore rules.
- Hash/mtime-based incremental indexing.
- Chunking for code, Markdown, and text.
- Search results with paths, line ranges, snippets, and ranking metadata.
- `codemap_context` tool that answers: “What should the agent read first?”

## 6. Out of Scope / Non-Goals

V1 is not:

- a full code intelligence server
- a daemon
- a remote service
- a GitNexus clone
- a Neo4j/external graph system
- a perfect callgraph
- a replacement for ripgrep, LSP, or GitNexus
- an embeddings-first semantic search product
- a whole-codebase AI summarizer

## 7. Users

Primary users:

- Pi coding agents
- Human users operating Pi inside a repo

Secondary users:

- Future Pi extensions that need compact code context
- Handoff/memory workflows that want to reference files, symbols, or line ranges

## 8. Core Use Cases

### UC1: Search the repo

User or agent asks:

```text
Find auth middleware tests
```

Tool returns ranked files/chunks with snippets and line ranges.

### UC2: Build an edit context

Agent asks:

```text
What should I read before changing src/auth/middleware.ts?
```

Tool returns:

- target file ranges
- nearby symbols/chunks
- likely tests
- relevant docs/ADRs
- read-first order
- stale index warnings if applicable

### UC3: Status/diagnostics

User asks whether the repo is indexed.

Tool returns:

- approved/not approved
- DB location
- last index time
- file/chunk counts
- stale/missing index warnings
- skipped file counts/reasons

## 9. V1 Scope

V1 includes:

1. Repo approval and safety boundary
2. Local registry + per-repo SQLite DB
3. Scanner with whitelist + blacklist + `.gitignore` support
4. Incremental indexing using hash/mtime
5. Chunker for code/Markdown/text
6. SQLite schema + raw SQL migrations
7. SQLite FTS5 tables
8. `codemap_index`
9. `codemap_search`
10. `codemap_context`
11. `codemap_status`
12. Minimal symbol extraction where cheap and reliable

V1 explicitly excludes:

- forced embeddings
- graph features
- ast-grep as a required dependency
- memory linking
- daemon or watcher
- background crawl across repos
- Prisma ORM

## 10. V1.5 / V2 Scope

Possible later additions:

- embedding provider interface
- FastEmbed/ONNX adapter
- `sqlite-vec`, Vec1, LanceDB, or external vector backend
- hybrid ranking via Reciprocal Rank Fusion
- ast-grep query-time integration
- stronger symbol extraction
- SQLite mini-graph
- test/doc relationship extraction
- memory artifact linking

## 11. Safety and Privacy Requirements

### Repo Boundary

The tool must only index explicitly approved Git repositories.

V1 must not:

- scan `$HOME`
- scan arbitrary parent folders
- auto-discover all repos
- run a global watcher
- index outside the current repo context

### Approval

First indexing requires explicit approval, e.g.:

```text
/codemap-index --approve-repo
```

Registry stores:

- repo root path
- repo hash
- git remote if available
- enabled flag
- approval timestamp
- approval source

### Symlinks

Default policy:

```text
Do not follow symlinks.
```

Future option: only follow symlinks whose resolved target remains inside repo root.

### File Inclusion

Default is whitelist-first.

Index common code, docs, and config files only:

- TS/JS
- Python
- Shell
- Go/Rust/Java/etc. later as simple text
- Markdown/MDX/RST/TXT
- JSON/YAML/TOML
- important config files

Default excludes:

- binaries
- images/videos/PDFs/archives
- lockfiles
- minified/bundled output
- dependency folders
- generated output
- coverage/build directories
- secret-like files

Default ignored patterns include:

```text
.git
node_modules
dist
build
.next
coverage
vendor
target
.idea
.vscode
*.lock
*.min.js
.env*
*.pem
*.key
*.crt
```

### Size Limits

Recommended defaults:

```text
max_file_size_default: 512 KB
max_file_size_code: 1 MB
max_file_size_docs: 1 MB
max_file_size_absolute: 2 MB
```

Files above the limit are skipped and counted in status output.

## 12. Data Storage

Use local per-repo SQLite databases plus a global registry:

```text
~/.pi/agent/state/codemap/
  registry.sqlite
  repos/
    <repo-hash>.sqlite
```

Existing legacy data from `~/.pi/agent/codemap/` or `~/.pi/agent/code-search/` may be migrated non-destructively into this state directory.

Rationale:

- simple cleanup per repo
- less locking contention
- easier debugging
- avoids committing DBs into repos
- keeps registry separate from index content

## 13. Database Design

Use:

```text
Node.js node:sqlite DatabaseSync + raw SQL migrations
```

Do not use Prisma or an ORM.

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

## 14. Tool API

### `codemap_status`

Returns index health and repo approval state.

Inputs:

```ts
{
  full?: boolean;       // run full stale diagnostics when true
  pathPrefix?: string;
}
```

Output should include:

- repo root, key, remote, and approval/enabled status
- DB path
- last index run
- file/chunk/symbol counts
- selected `pathPrefix`
- stale/changed/missing/deleted diagnostics when `full=true`
- skipped file counts by reason when full diagnostics scan the tree

### `codemap_index`

Indexes or updates current repo. First use requires explicit approval.

Inputs:

```ts
{
  approveRepo?: boolean;
  pathPrefix?: string;
}
```

Output includes:

```ts
{
  scanned: number;
  indexed: number;
  skipped: number;
  removed: number;
  warnings: string[];
  skippedReasons: Record<string, number>;
  dbPath: string;
  root: string;
  pathPrefix: string;
}
```

### `codemap_search`

Searches paths, chunks, and symbols.

Inputs:

```ts
{
  query: string;
  limit?: number;      // 1..50, default 10
  pathPrefix?: string;
}
```

Output package:

```ts
{
  query: string;
  root: string;
  pathPrefix: string;
  lastIndexedAt: string | null;
  stale: boolean;
  changed: number;
  missing: number;
  deleted: number;
  warnings: string[];
  results: Array<{
    path: string;
    language: string;
    startLine: number;
    endLine: number;
    kind: string;
    snippet: string;
    score: number;
  }>;
}
```

### `codemap_context`

Builds compact context for an indexed file path or falls back to search results for a symbol/query.

Inputs:

```ts
{
  target: string;
  limit?: number;      // 1..25, default 8
  pathPrefix?: string;
}
```

Output:

```ts
{
  target: string;
  root: string;
  pathPrefix: string;
  lastIndexedAt: string | null;
  stale: boolean;
  changed: number;
  missing: number;
  deleted: number;
  readFirst: ContextItem[];
  relatedTests: string[];
  relatedDocs: string[];
  warnings: string[];
}
```

## 15. Ranking

V1 ranking signals:

1. Exact path/name match
2. Symbol match
3. FTS chunk match
4. Markdown heading/doc match
5. Test-file boost if query mentions test/debug/failing
6. Small recency boost only

Embeddings are not part of V1 ranking.

## 16. Commands

Commands:

```text
/codemap-status [--full] [--path-prefix <subtree>]
/codemap-index [--approve-repo] [--path-prefix <subtree>]
/codemap-search [--path-prefix <subtree>] <query>
/codemap-context [--path-prefix <subtree>] <path-or-symbol-or-query>
```

Deprecated aliases remain registered for compatibility: `/codebase-status`, `/codebase-index`, `/codebase-search`, `/codebase-context` and the matching `codebase_*` tools.

## 17. Packaging

The project should be packaged as a Pi extension/package.

Current structure:

```text
pi-ext-codemap/
  README.md
  PRD.md
  index.ts
  docs/
    roadmap.md
    search-quality.md
    archive/brainstorming.md
  migrations/
    001_init.sql
    002_fts.sql
  src/
    core/
      chunker.ts
      context.ts
      context-builder.ts
      db.ts
      ignore.ts
      indexer.ts
      index-store.ts
      query-plan.ts
      ranking.ts
      repo.ts
      scanner.ts
      search.ts
      search-quality-metrics.ts
      symbols.ts
      types.ts
    pi-extension/
      commands.ts
      index.ts
      operations.ts
      tools.ts
  package.json
```

## 18. Success Metrics

V1 is successful if:

- A repo can be approved and indexed locally.
- Indexing skips unsafe/irrelevant files by default.
- Search returns useful path/chunk/snippet results.
- Context output gives agents a better read-first set than raw `rg`.
- Results include line ranges and truncation-safe snippets.
- Status clearly reports stale/missing/unsafe index states.
- No daemon, remote service, or embedding runtime is required.

## 19. Implementation Decisions

- Build a Pi extension/package with four V1 tools: status, index, search, and context.
- Keep V1 local-only, on-demand, and explicitly approved per repository.
- Use a global registry plus one SQLite database per approved repo.
- Use Node.js `node:sqlite` `DatabaseSync` with raw SQL migrations; do not introduce Prisma or an ORM.
- Use SQLite FTS5 as the primary V1 search engine across file paths, symbols, and chunks.
- Keep indexing incremental with file hash/mtime checks and deleted-file cleanup.
- Use whitelist-first scanning, `.gitignore` support, size limits, and conservative secret/binary/generated-file exclusions.
- Do not follow symlinks in V1.
- Chunk code, Markdown, and text into line-bounded ranges with stable ordinals.
- Implement only cheap, reliable symbol extraction in V1; defer full AST/callgraph behavior.
- Rank by exact path/name, symbol matches, FTS matches, docs/headings, test intent, and small recency boosts.
- Return warnings instead of silently auto-refreshing stale indexes.
- Treat embeddings, ast-grep, graph relationships, and memory artifact linking as V1.5/V2 work.

## 20. Testing Decisions

- Tests should assert external behavior and contracts: indexed files, skipped files, tool outputs, warnings, and ranking order for representative cases.
- Scanner tests should cover allowlists, default excludes, `.gitignore`, size limits, symlinks, deleted files, and secret-like files.
- Migration/database tests should cover schema creation, FTS table availability, uniqueness constraints, and repeatable migration runs.
- Indexer tests should cover first indexing, incremental no-op indexing, changed files, deleted files, and failed runs.
- Chunker tests should cover code, Markdown headings, plain text, line ranges, overlap/default sizing, and truncation-safe snippets.
- Search tests should cover path matches, symbol matches, FTS chunk matches, doc matches, test boosts, limits, and empty results.
- Context tests should cover read-first ordering, related tests/docs inclusion, budget limits, stale warnings, and missing target behavior.
- Safety tests should verify unapproved repos cannot be indexed and paths outside the repo root are rejected.
- Package/integration tests should verify the Pi extension loads and each V1 tool validates inputs and returns the documented contract.

## 21. MVP Build Order

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

## 22. Resolved Defaults and Deferred Questions

Resolved V1 defaults:

- The package uses a `package.json` `pi.extensions` manifest pointing at `./index.ts`.
- V1 exposes four primary tools: `codemap_status`, `codemap_index`, `codemap_search`, and `codemap_context`.
- Deprecated `codebase_*` aliases remain available only for compatibility.
- Indexing is manual/on-demand.
- Stale search/context results warn instead of silently reindexing.
- Symlinks are not followed.
- Embeddings are not part of V1.

Deferred questions:

- Which optional embedding adapter should be tried first?
- How far should cheap symbol extraction go before using optional `ast-grep`?
- Which graph/test/doc relationships are useful enough for V1.5/V2?
- Should refresh automation be implemented as an explicit command, hook, or remain manual-only?
