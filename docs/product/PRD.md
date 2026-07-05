# PRD: pi-ext-codemap

## 1. Summary

`pi-ext-codemap` is a lightweight local codebase search and context extension for Pi/Coding Agents.

It indexes the current or explicitly targeted repository state into a local SQLite/FTS5 database and provides agent-friendly tools for finding relevant files, line ranges, snippets, docs, tests, and entry points.

It complements `pi-memory` but is not part of it.

```text
pi-memory stores durable decisions.
pi-ext-codemap indexes current or explicitly targeted repo state.
```

Canonical detailed docs:

- User behavior and commands: [`../user/usage.md`](../user/usage.md)
- Developer architecture and schema: [`../developer/architecture.md`](../developer/architecture.md)
- Search-quality benchmark: [`../developer/search-quality.md`](../developer/search-quality.md)
- Future work: [`roadmap.md`](roadmap.md)

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

From the user's perspective, `pi-ext-codemap` provides a small set of Pi-native commands and tools that can approve, index, search, and explain a repository locally. The agent can ask for a query, file, or symbol and receive a compact read-first context package with paths, line ranges, snippets, related tests/docs/imports/callers, and index health warnings.

The V1 solution is intentionally lexical/local-first: SQLite + FTS5 + cheap symbol extraction + deterministic ranking. Embeddings, graph expansion, and ast-grep integrations remain later enhancements unless they can be added without making V1 heavier.

## 4. Users

Primary users:

- Pi coding agents
- Human users operating Pi inside a repo

Secondary users:

- Future Pi extensions that need compact code context
- Handoff/memory workflows that want to reference files, symbols, or line ranges

## 5. User stories

1. As a Pi coding agent, I want to search a repo by feature, symbol, or phrase, so that I can find relevant files before editing.
2. As a Pi coding agent, I want line-bounded snippets, so that I can read targeted ranges instead of whole files.
3. As a Pi coding agent, I want a read-first context package for a file or symbol, so that I can inspect likely dependencies, callers, tests, and docs in the right order.
4. As a Pi coding agent, I want stale-index warnings, so that I do not rely on outdated search results.
5. As a human Pi user, I want explicit repo approval before indexing, so that the tool never scans arbitrary private folders.
6. As a human Pi user, I want status diagnostics, so that I can see whether a repo is approved, indexed, stale, or partially skipped.
7. As a future extension author, I want a simple local index API, so that other Pi workflows can reuse file, chunk, symbol, and context results.
8. As an agent resuming work from a handoff, I want stable file and line references, so that I can quickly reopen the relevant code context.
9. As a privacy-conscious user, I want local-only storage, so that no repository content leaves the machine.
10. As a maintainer, I want cheap incremental indexing, so that repeated searches do not require full rescans.

## 6. Goals

### Product goals

- Provide a small local repo navigation tool for Pi agents.
- Return compact, useful context packages with minimal token waste.
- Keep all indexing local and rebuildable.
- Avoid daemon, server, cloud, or heavy graph dependencies.
- Make FTS/path/symbol/doc search useful before adding embeddings.

### V1 technical goals

- Local per-repo SQLite database.
- SQLite FTS5 full-text search.
- Repo scanner with allowlist/ignore rules.
- Hash/mtime-based incremental indexing.
- Chunking for code, Markdown, and text.
- Search results with paths, line ranges, snippets, and ranking scores.
- `codemap_context` tool that answers: “What should the agent read first?”

## 7. Out of scope / non-goals

V1 is not:

- a full code intelligence server;
- a daemon;
- a remote service;
- a GitNexus clone;
- a Neo4j/external graph system;
- a perfect callgraph;
- a replacement for ripgrep, LSP, or GitNexus;
- an embeddings-first semantic search product;
- a whole-codebase AI summarizer.

## 8. Core use cases

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

- target file ranges;
- nearby symbols/chunks;
- directly imported local files and local callers where indexed;
- likely tests and docs;
- read-first order;
- stale-index warnings if applicable.

### UC3: Status/diagnostics

User asks whether the repo is indexed.

Tool returns:

- approved/not approved;
- DB location;
- last index time;
- file/chunk/symbol counts;
- stale/missing index warnings;
- skipped file counts/reasons.

## 9. V1 scope

V1 includes:

1. Repo approval and safety boundary.
2. Local registry + per-repo SQLite DB.
3. Scanner with whitelist + blacklist + `.gitignore` and `.codemapignore` support.
4. Incremental indexing using hash/mtime.
5. Chunker for code/Markdown/text.
6. SQLite schema + raw SQL migrations.
7. SQLite FTS5 tables.
8. `codemap_index`.
9. `codemap_search`.
10. `codemap_context`.
11. `codemap_status`.
12. Minimal symbol extraction where cheap and reliable.
13. Deterministic lexical ranking with file-role/noise handling.
14. `pathPrefix` scoping for monorepos and nested services.

V1 explicitly excludes:

- forced embeddings;
- public graph/explain tools beyond read-first relationship hints;
- ast-grep as a required dependency;
- memory linking;
- daemon or watcher;
- background crawl across repos;
- Prisma ORM.

### Priority languages

CodeMap must serve these languages first-class for symbol- and structure-aware navigation: **TypeScript, JavaScript, C, and C++**. Python retains earlier symbol and structured-chunking support. Every other whitelisted extension (see the scanner allowlist) is still indexed and searchable as paths, FTS chunks, and text, but without language-specific symbol or structure awareness. The exact per-capability status by language lives in [`../developer/architecture.md#language-support-tiers`](../developer/architecture.md#language-support-tiers); new language work should update that matrix.

## 10. Safety and privacy requirements

The tool must only index explicitly approved Git repositories.

V1 must not:

- scan `$HOME`;
- scan arbitrary parent folders;
- auto-discover all repos;
- run a global watcher;
- index outside the current or explicitly targeted repo context;
- follow symlinks by default;
- send repository content to a remote service.

Indexing must use whitelist-first file inclusion and conservative skips for binaries, secret-like files, generated/cache/build/dependency folders, unsupported extensions, and files larger than the active size limit.

Lockfiles are intentionally different from generated binaries: supported text lockfiles may be indexed so explicit lockfile queries work. They are treated as noisy files in ranking and read-first context and should not displace source/config/docs/tests for ordinary agent navigation queries.

Detailed scanner/storage behavior is maintained in [`../user/usage.md#indexed-file-policy`](../user/usage.md#indexed-file-policy) and [`../developer/architecture.md`](../developer/architecture.md).

## 11. Tool API contract

V1 exposes four primary tools and matching slash commands:

| Tool | Command | Purpose |
|---|---|---|
| `codemap_status` | `/codemap-status` | Show approval/index status; `full=true` / `--full` runs stale diagnostics. |
| `codemap_index` | `/codemap-index` | Approve once and/or refresh the local index. |
| `codemap_search` | `/codemap-search` | Search indexed paths, chunks, and cheap symbols. |
| `codemap_context` | `/codemap-context` | Return read-first context for a file path, symbol, feature, or query. |

All four operations accept optional `repoPath` / `--repo-path` to target a repo root, directory inside a repo, or file inside a repo without changing session cwd. They also accept optional `pathPrefix` / `--path-prefix` where applicable to scope monorepos and nested services.

Public result contracts are documented in [`../user/usage.md#commands-and-tools`](../user/usage.md#commands-and-tools). Adapter/core boundaries are documented in [`../developer/architecture.md`](../developer/architecture.md).

## 12. Ranking and noise handling

V1 ranking is deterministic and lexical/local-first. Embeddings are not part of V1 ranking.

Primary positive signals:

1. Exact path/name match.
2. Exact or prefix symbol match.
3. SQLite FTS chunk/symbol match.
4. Token coverage in path, filename, symbol, and chunk text.
5. Query-intent boosts for implementation/config/dependency/docs/tests where applicable.
6. File-role boosts such as implementation entrypoints or dependency manifests.

Noise handling:

- Lockfiles are indexed but receive a strong noise penalty for ordinary queries; explicit lockfile/path queries can still surface them first.
- Generated files, build output, vendor/output folders, and minified files are strongly de-prioritized or skipped depending on scan policy.
- `codemap_context` keeps noisy related imports/reverse-imports/includes out of `readFirst` when they point to lockfiles, generated files, build output, or minified files, while still allowing an explicitly requested noisy target to be returned directly.
- `codemap_context` may include compact `reasons[]` on read-first items to explain lightweight relationships such as target, import/include, reverse import/include, C/C++ implementation pair, nearby config, same-directory source, test/source roles, sibling test, or related doc.
- Tests and docs are useful context, not generic noise; they should appear as related read-first files when they are actual sibling, reverse-import/include, or path-related context.

Search-result objects remain compact. Internal score diagnostics may decompose retrieval/FTS/path/filename/symbol/coverage/role/noise components for tests and benchmark debugging, but the public `codemap_search` result shape does not include explain fields.

## 13. Packaging and implementation decisions

- Build a Pi extension/package with four V1 tools: status, index, search, and context.
- Keep the core product logic Pi-API-free and expose Pi tools/commands as adapters over shared core functions.
- Keep V1 local-only, on-demand, and explicitly approved per repository.
- Use a global registry plus one SQLite database per approved repo.
- Use Node.js `node:sqlite` `DatabaseSync` with raw SQL migrations; do not introduce Prisma or an ORM.
- Use SQLite FTS5 as the primary V1 search engine across file paths, symbols, and chunks.
- Keep indexing incremental with file hash/mtime checks and deleted-file cleanup.
- Use whitelist-first scanning, `.gitignore`/`.codemapignore` support, size limits, and conservative secret/binary/generated-file exclusions.
- Do not follow symlinks in V1.
- Chunk code, Markdown, and text into line-bounded ranges with stable ordinals.
- Implement only cheap, reliable symbol extraction in V1; defer full AST/callgraph behavior.
- Rank by exact path/name, symbol matches, FTS matches, query-term coverage, file-role intent boosts, and noise penalties for lockfiles/generated/build/minified files.
- Return warnings instead of silently auto-refreshing stale indexes.
- Treat embeddings, ast-grep, public graph/explain tools, and memory artifact linking as V1.5/V2 work; the implemented internal file-relationship graph remains scoped to lightweight read-first context hints.

## 14. Success metrics

V1 is successful if:

- A repo can be approved and indexed locally.
- Indexing skips unsafe/irrelevant files by default.
- Search returns useful path/chunk/snippet results.
- Context output gives agents a better read-first set than raw `rg`.
- Results include line ranges and truncation-safe snippets.
- Status clearly reports stale/missing/unsafe index states.
- No daemon, remote service, or embedding runtime is required.

## 15. Testing decisions

Tests should assert external behavior and contracts: indexed files, skipped files, tool outputs, warnings, and ranking order for representative cases.

The canonical maintainer testing policy lives in [`../developer/architecture.md#testing-policy`](../developer/architecture.md#testing-policy). Search-quality gates live in [`../developer/search-quality.md`](../developer/search-quality.md).

## 16. Resolved defaults

- The package uses a `package.json` `pi.extensions` manifest pointing at `./index.ts`.
- V1 exposes four primary tools: `codemap_status`, `codemap_index`, `codemap_search`, and `codemap_context`.
- Indexing is manual/on-demand.
- Stale search/context results warn instead of silently reindexing.
- Symlinks are not followed.
- Embeddings are not part of V1.

## 17. Future work boundary

Future and non-V1 ideas are tracked in [`roadmap.md`](roadmap.md). They are not part of this PRD unless explicitly promoted into the V1 contract here.

Deferred questions are tracked in [`roadmap.md#deferred-questions`](roadmap.md#deferred-questions).
