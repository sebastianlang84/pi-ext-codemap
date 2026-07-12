# CodeMap user guide

Read this file when you want to understand what CodeMap can do and how to use its CLI, MCP server, or Pi adapter.

## What CodeMap is

CodeMap is a local repository map for coding agents. It indexes the current or explicitly targeted Git repo into SQLite/FTS and helps find the right files before reading or editing code. The standalone `codemap` CLI is the primary interface; the `codemap-mcp` server and Pi extension adapt the same four operations for native agent tools and Pi slash commands.

Use CodeMap when you want to answer:

- Where is this feature, symbol, endpoint, config key, or script implemented?
- Which file should I read first before making a change?
- Are there nearby tests, docs, config files, imports, or callers worth checking?
- Is the index fresh enough to trust?

CodeMap is not a semantic memory system. `pi-memory` stores durable decisions and handoffs; CodeMap indexes rebuildable repo state.

## Main features

| Feature | What it does | How to use it |
|---|---|---|
| Repo approval | Requires explicit approval before indexing a Git repo. | `codemap index --approve` |
| Local indexing | Stores a rebuildable SQLite index in a user data directory. | `codemap index` |
| Status diagnostics | Shows approval, index counts, DB path, and optional stale diagnostics. | `codemap status --full` |
| Code/text search | Searches paths, chunks, and cheap symbols with SQLite FTS. | `codemap search <query>` |
| Read-first context | Returns the target file plus likely imports, callers, nearby config, tests, and docs. | `codemap context <path-or-query>` |
| Repo targeting | Runs status/index/search/context for another repo path without changing the session cwd. | `--repo /path/to/repo` or `repoPath` |
| Monorepo scoping | Limits status/index/search/context to a subtree. | `--path-prefix services/api` |
| Stale warnings | Warns instead of silently refreshing old results. | Refresh with `codemap index` |
| Noise handling | Keeps lockfiles/generated/build/minified files from dominating ordinary results. | Automatic; explicit lockfile queries still work. |

## Install

### CLI

CodeMap requires Node ≥ 22.13:

```bash
npm install -g github:sebastianlang84/codemap
codemap --help
```

This installs both `codemap` and `codemap-mcp` from the GitHub repository. A registry-published npm package is not available yet.

### MCP server

After installing the CLI package, configure an MCP host to start `codemap-mcp`. For example:

```bash
claude mcp add codemap -- codemap-mcp
```

Other hosts can use the equivalent command-based MCP configuration shown in the [README](../../README.md#as-an-mcp-server-native-tools-in-claude-code-codex-cursor).

Note: some hosts *defer* MCP tools — they list a tool by name but load its schema only on demand, so the agent must take an extra step before the first call, and the server's instructions are injected every session. In those harnesses the plain `codemap` CLI over Bash is the leaner path (one call, no schema round-trip, nothing injected); prefer it there and skip the MCP registration.

### Pi extension

```bash
pi install git:github.com/sebastianlang84/codemap
```

### Local development checkout

Keep the canonical clone outside Pi-managed package storage:

```bash
git clone git@github.com:sebastianlang84/codemap.git ~/dev/codemap
cd ~/dev/codemap
npm install
npm run build
npm link
pi install ~/dev/codemap   # optional Pi adapter
```

The CLI supports `--json`, `--repo`, `--path-prefix`, and `--state-dir`. See the [README CLI reference](../../README.md#cli-reference) for wiring it into `CLAUDE.md` or `AGENTS.md`. Existing `pi-ext-codemap` users should follow the [migration guide](migrating-from-pi-extension.md), especially before changing their state directory.

## State location

CodeMap resolves its index and approval-registry directory in this order:

1. CLI `--state-dir <path>`;
2. `CODEMAP_HOME`;
3. `$XDG_DATA_HOME/codemap`;
4. `~/.local/share/codemap`.

`CODEMAP_HOME` names the state root; it is unrelated to the CodeMap source-checkout directory.

For backward compatibility, `~/.pi/agent/state/codemap` remains active automatically when that legacy directory exists, neither environment variable selects another location, and `~/.local/share/codemap` does not yet exist. Once the new default directory exists, it wins. Do not create an empty new directory or merge SQLite files by hand; use the [state migration procedure](migrating-from-pi-extension.md#move-state-to-the-platform-neutral-location).

## First use in a repo

Approve and index the current Git repository:

```bash
codemap index --approve
```

After that, refresh the same repo without re-approving:

```bash
codemap index
```

Check whether the index is ready:

```bash
codemap status
```

Run full stale diagnostics when freshness matters:

```bash
codemap status --full
```

Pi equivalents are `/codemap-index --approve-repo`, `/codemap-index`, and `/codemap-status [--full]`. MCP clients call `codemap_index` and `codemap_status` with the matching structured parameters.

## Typical workflows

### Find where something is implemented

```bash
codemap search auth middleware
codemap search parsePathPrefix
codemap search package.json dependencies
```

Then read the best matching file with your normal file-reading tools. Use `rg` instead when you need every exact literal or regex match.

### Build context before editing a file

```bash
codemap context src/core/search.ts
```

For direct file targets, CodeMap may return:

- the target file's first useful chunk;
- directly imported local files;
- local files that import the target;
- nearby configuration files;
- likely sibling tests;
- likely related docs.

Treat this as a read-first list, not as a replacement for reading the files.

### Target another repo by path

All CodeMap tools and commands default to the current working directory. To target another repo, pass a repo root, a directory inside a repo, or a file inside a repo:

```bash
codemap status --repo /path/to/repo --full
codemap index --repo /path/to/repo --approve
codemap search --repo /path/to/repo repoPathNeedle
codemap context --repo /path/to/repo src/core/search.ts
```

Equivalent tool params:

```ts
codemap_status({ repoPath: "/path/to/repo", full: true })
codemap_search({ repoPath: "/path/to/repo", query: "auth middleware" })
```

Approval is still per repo. If the target repo is not approved, ask before running `codemap_index({ repoPath, approveRepo: true })`.

### Work inside a monorepo subtree

```bash
codemap index --path-prefix services/api
codemap search --path-prefix services/api auth middleware
codemap context --path-prefix services/api src/auth/middleware.ts
codemap status --full --path-prefix services/api
```

`pathPrefix` is normalized to a repository-relative POSIX path and is supported by all four operations.

### Handle stale results

Search and context include stale warnings when the index no longer matches the working tree. Full status also reports Git freshness fields: `currentHead`, `indexedHead`, `headChanged`, `dirty`, and `dirtyFiles`. CodeMap does not auto-refresh in the background.

If results are stale and freshness matters:

```bash
codemap index
```

For scoped refreshes:

```bash
codemap index --path-prefix services/api
```

## Commands and tools

The CLI is the scriptable interface. MCP and Pi expose the same operations as structured tools; Pi also adds slash commands for humans in the TUI.

| Operation | CLI | MCP/Pi tool | Result shape |
|---|---|---|---|
| Status | `codemap status [--repo <path>] [--full] [--path-prefix <subtree>]` | `codemap_status({ repoPath?, full?, pathPrefix? })` | repo approval, DB path, file/chunk/symbol counts, `lastIndexedAt`, and full Git/index diagnostics (`currentHead`, `indexedHead`, `headChanged`, `dirty`, `dirtyFiles`, stale counts) when `full=true` |
| Index | `codemap index [--repo <path>] [--approve] [--path-prefix <subtree>]` | `codemap_index({ repoPath?, approveRepo?, pathPrefix? })` | `scanned`, `indexed`, `skipped`, `removed`, `warnings`, `skippedReasons`, `root`, `dbPath`, `pathPrefix` |
| Search | `codemap search [--repo <path>] [--path-prefix <subtree>] <query>` | `codemap_search({ repoPath?, query, limit?, pathPrefix? })` | `results[]` with `path`, `language`, `startLine`, `endLine`, `kind`, `snippet`, `score`, plus stale warnings |
| Context | `codemap context [--repo <path>] [--path-prefix <subtree>] <target>` | `codemap_context({ repoPath?, target, limit?, pathPrefix? })` | `readFirst[]` with optional `reasons[]`, `relatedTests[]`, `relatedDocs[]`, stale diagnostics, warnings |

The Pi slash-command forms are `/codemap-status`, `/codemap-index`, `/codemap-search`, and `/codemap-context`; they use `--repo-path` and `--approve-repo` instead of the shorter CLI flags.

`codemap_context` reason kinds are best-effort navigation hints such as `target`, `search_result`, `import`, `reverse_import`, `include`, `reverse_include`, `implementation_pair`, `near_config`, `same_dir`, `test_of`, `sibling_test`, `reverse_test`, and `related_doc`. They are derived from indexed content and path/name heuristics; TypeScript/JavaScript imports, Python relative imports, nearby config files, same-directory source neighbors, test/source roles, and C/C++ quoted includes/header-source pairs are supported without building a full language graph.

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

Use `codemap search|context|status|index` in a shell, `codemap_*` tools in MCP or Pi, and `/codemap-*` commands in the Pi TUI. Every adapter executes the same shared operations. All require a Git repository and per-repo approval before indexing.
