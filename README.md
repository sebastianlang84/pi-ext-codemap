# CodeMap

**A fast, local, deterministic map of a repository — so a coding agent finds the right files before it reads or edits them.**

CodeMap indexes code and plain-text project files into a local SQLite/FTS database. An agent then asks *"where is this feature/symbol/endpoint/config, and what should I read first?"* and gets a ranked answer plus the related files (imports, callers, tests, docs, config) — instead of running many broad `grep`/`find` passes and reading whole files to orient itself.

The **standalone `codemap` CLI is the primary interface**. The same operations are also available through a native MCP server (Claude Code, Codex, Cursor, or any MCP host) and an optional Pi extension (tools + slash commands).

## Why it's worth using

- **Cheaper, sharper navigation than raw grep.** One ranked query replaces several `grep`/`find` passes and speculative full-file reads. For an LLM agent that directly means fewer tool calls and fewer tokens spent just finding where to work.
- **Read-first context, not just hits.** For a target file CodeMap returns its imports, reverse-imports/callers, C/C++ header↔source pairs, nearby config, sibling tests, and related docs — the neighborhood you'd otherwise reconstruct by hand.
- **Deterministic and private.** No embeddings, no model downloads, no daemon, no network. The same query gives the same ranked result, and repository content never leaves your machine.
- **Honest about freshness.** It flags when the index has drifted from the working tree instead of silently returning stale results.

## What CodeMap is for

- Orienting in an unfamiliar or large repository.
- "Where is this feature / symbol / endpoint / config key / script implemented?"
- "Which file should I read first before I change this one, and what's related to it?"
- Cutting the grep-and-read token cost an agent pays before it can start real work.
- Local, offline, privacy-sensitive work where sending code to a remote index is not acceptable.

## What CodeMap is *not*

- **Not semantic search.** V1 ranking is lexical/FTS + local heuristics. Query with real tokens (symbol names, path fragments, feature words), not vague natural-language questions. No embeddings or conceptual-similarity matching.
- **Not a compiler-accurate index.** Symbols come from cheap regexes and relationships from import/include text matching — not a full AST or call graph. It will miss dynamic dispatch, macro-generated code, and exotic path aliases.
- **Not a file reader or editor.** It tells you *where to look*; you still open and edit files with your normal tools. Treat its context as a read-first list, not a substitute for reading.
- **Not a memory system.** It indexes rebuildable repo state. Durable decisions and handoffs belong in `pi-memory`.
- **Not auto-refreshing.** You re-index after changes; it warns when stale rather than watching the tree in the background.

```text
pi-memory stores durable decisions and handoffs.
CodeMap indexes the current (rebuildable) repo state and helps you navigate it.
```

## Benchmarks

The claims above are measured, not asserted. The strongest evidence is the local **real-repo navigation eval**: it indexes five real repositories, gives every mode the *same* budget of 5 files to read, and checks whether the mode actually found the right entry file plus its required read-first neighbors. Three modes are compared:

- **`lexical`** — a stand-in for raw `grep`/`rg`: score tracked files by keyword match and read the top ones.
- **`codemap_search`** — read only CodeMap's top ranked search hits.
- **`codemap_search_context`** — the intended workflow: search for an entry point, then call `codemap_context` on the top hit to pull in its related files, all within the same 5-file budget.

Baseline cohort (2026-05-24):

| Mode | Success | Expected recall | Context recall | Avg files read |
|---|---:|---:|---:|---:|
| `lexical` (grep/rg-like) | 0.125 | 0.521 | 0.563 | 5.0 |
| `codemap_search` | 0.375 | 0.781 | 0.646 | 4.9 |
| `codemap_search_context` | **1.000** | **1.000** | **1.000** | 5.0 |

- *Success* = found the right entry file **and** all required neighbors **and** read no forbidden/noisy file.
- *Expected recall* = share of the entry + required context files actually read.
- *Context recall* = share of just the required neighboring files (tests, config, docs, imports) read.

> These success/recall figures are a **dated snapshot (2026-05-24)**. The suite runs against evolving real repositories, so a later rerun on the same five repos scores somewhat lower as those repos grow more convention-linked neighbors (tests/docs/related sources not reachable by a direct import or symbol) — a known limitation, not a code regression; the quality gate still passes. The read-cost figures below are a separate, freshly dated measurement.

### What this means in plain terms

Give an agent five files' worth of attention and point it at a real task:

- **Plain grep-style search gets it fully right about 1 in 8 times** (success 0.125). It often lands somewhere in the neighborhood — roughly half the right files (recall ~0.52–0.56) — but rarely assembles the *complete* picture, and it wastes part of the budget on noisy hits.
- **CodeMap's ranked search alone triples that** (success 0.375) and reads fewer files to do it, because the ranking pushes the real target up instead of burying it under keyword matches.
- **The full search-then-context workflow gets it right every time on this set** (success 1.000) using the *same* five-file budget — it doesn't read *more*, it reads the *right* files: the entry point plus the tests, config, and imports you'd otherwise have to hunt down by hand.

Put differently: against a grep-like baseline, the intended workflow turns "found roughly half of what I needed, and only rarely everything" into "found exactly what I needed" — **without spending a larger reading budget**. That is the concrete payoff for an agent: fewer speculative reads and tool calls before it can start real work.

The gain holds on a deliberately harder **natural-language holdout** (symptom-style queries with no function/class names to grep for), where grep-style search succeeds on ~1 in 16 tasks (0.063) and the full workflow on ~3 in 4 (0.750) — smaller, but the same direction, and honest about where lexical search falls off hardest.

### Read cost

Success and recall say whether the agent found the right files; the same eval also measures how many bytes/tokens it *read* to get there, under the identical 5-file budget. Full local suite, 2026-07-12 (est. tokens read across all cases):

| Mode | Est. tokens read | vs. lexical |
|---|---:|---:|
| `lexical` (grep/rg-like) | ~51,800 | 1.0× |
| `codemap_search` | ~11,600 | **~4.5× fewer** |
| `codemap_search_context` | ~11,400 | **~4.5× fewer** |

Because ranked search points the agent at the *right* files, it spends its 5-file budget on small, relevant sources instead of large speculative reads — roughly a 4–5× cut in tokens read for the same number of files. The ratio holds per cohort (baseline ~53.9k→12.3k, natural holdout ~50.7k→11.0k). This is the concrete token payoff behind the success/recall numbers above.

These numbers are reproducible locally and gated in CI-style checks:

```bash
npm run eval:real-repo-navigation       # real repos vs rg-like baseline
npm run eval:agent-navigation           # deterministic checked-in fixture
npm run bench:search-quality            # ranking / top-1 / recall benchmark
```

Full methodology, per-cohort tables, miss taxonomy, and known limitations live in
[`docs/developer/real-repo-navigation-eval.md`](docs/developer/real-repo-navigation-eval.md) and
[`docs/developer/agent-navigation-eval.md`](docs/developer/agent-navigation-eval.md).

## Install

### Standalone CLI (recommended)

Requires **Node ≥ 22.13** (CodeMap uses the built-in `node:sqlite`; this release is the first Node 22 version where it is available without an opt-in flag).

```bash
# Installs a `codemap` command on your PATH
npm install -g github:sebastianlang84/codemap

# …or link a development checkout
git clone https://github.com/sebastianlang84/codemap ~/dev/codemap
cd ~/dev/codemap
npm install && npm run build && npm link
```

Then, inside any Git repository:

```bash
codemap index --approve         # one-time: approve + build the local index
codemap search auth middleware  # ranked files/symbols/chunks
codemap context src/app/auth.ts # read-first files + related tests/docs/imports
codemap status                  # approval / index / staleness (add --json anywhere)
```

**Wire it into an agent.** Add a note to the repo's `CLAUDE.md` (Claude Code) or `AGENTS.md` (Codex) so the agent chooses CodeMap for ranked navigation and `rg` for exhaustive literal matching:

```markdown
## Code navigation
Use CodeMap for ranked code navigation and related-file discovery:
- `codemap search <terms>` — ranked files, symbols, and chunks
- `codemap context <path|query>` — read-first files plus related tests/docs/imports
Run `codemap index --approve` once, then `codemap index` to refresh after changes.
Use `--json` when you want to parse results. Staleness is advisory.
Use `rg` when the task requires every exact literal or regex match.
```

Everything is local-only and never leaves your machine; the first index requires `--approve`.

### As an MCP server (native tools in Claude Code, Codex, Cursor)

Installing the package (above) also puts a `codemap-mcp` command on your PATH. It speaks the Model Context Protocol over stdio, so an MCP host can expose the same four `codemap_*` tools **natively** — the agent sees them in its tool list and calls them itself, with no `CLAUDE.md`/`AGENTS.md` note and no shell parsing. It adds **no runtime dependency** (plain JSON-RPC over stdin/stdout).

Claude Code:

```bash
claude mcp add codemap -- codemap-mcp
```

Any MCP host (Codex, Cursor, …) via config:

```json
{
  "mcpServers": {
    "codemap": { "command": "codemap-mcp" }
  }
}
```

The server operates on the directory it is launched in. Most hosts (e.g. Claude Code) start MCP servers in the project directory; if yours does not, pass `repoPath` in the tool call (or the agent will see `readiness: not a git repository`). The agent gets `codemap_status`, `codemap_search`, `codemap_context`, and `codemap_index` (call `codemap_index` with `approveRepo: true` once to approve local indexing). This is the alternative to the CLI-plus-`AGENTS.md` route: use MCP when you want first-class, self-served tools; use the CLI when you want an explicit, scriptable command. One caveat: if your host *defers* MCP tools (lists them by name but loads schemas on demand, e.g. some large tool inventories in Claude Code), the agent pays an extra step before the first call and the server's instructions are injected every session — there the CLI-plus-`AGENTS.md` route is leaner, so prefer it and skip the MCP registration.

### As a Pi extension

```bash
pi install git:github.com/sebastianlang84/codemap
# local development:
pi install ~/dev/codemap
```

Then use the `/codemap-*` slash commands and `codemap_*` tools — see the [Pi quick start](#pi-quick-start).

Upgrading from `pi-ext-codemap` or moving an existing local installation? Follow the [migration guide](docs/user/migrating-from-pi-extension.md) for the Git source, Pi package, development checkout, and state directory.

## CLI reference

All commands default to the current directory and accept `--json`, `--repo <path>` (target another repo), `--path-prefix <dir>` (scope to a subtree), and `--state-dir <path>` (override where indexes and the approval registry are stored).

| Command | Purpose |
|---|---|
| `codemap search <query> [--limit N]` | Ranked paths, symbols, and chunks. |
| `codemap context <path\|query> [--limit N]` | Read-first target file plus related imports, callers, tests, docs, config. |
| `codemap status [--full]` | Approval, index counts, and staleness (`--full` does a working-tree scan). |
| `codemap index [--approve]` | Build or refresh the index (`--approve` required the first time). |

### State location

State resolution is `--state-dir` → `CODEMAP_HOME` → `$XDG_DATA_HOME/codemap` → `~/.local/share/codemap`. Existing users keep using `~/.pi/agent/state/codemap` automatically when no environment override is set, that legacy directory exists, and the new default does not. See the [migration guide](docs/user/migrating-from-pi-extension.md#move-state-to-the-platform-neutral-location) before moving it; do not merge SQLite directories by hand. A source checkout also provides `npm run gc:state` to prune indexes for repositories that no longer exist.

## Pi quick start

```text
/codemap-index --approve-repo                         # approve + index this repo
/codemap-status --full                                # health before trusting old results
/codemap-search memory handoff retrieval              # find files/symbols/chunks
/codemap-search --path-prefix services/api auth       # scope to a monorepo subtree
/codemap-context src/core/search.ts                   # read-first package for a file
/codemap-search --repo-path /path/to/repo auth        # target another repo
```

## Strengths and limitations at a glance

**Strengths:** fast lexical/FTS search; symbol-aware for TypeScript, JavaScript, Python, C, and C++; relationship-aware read-first context; deterministic and reproducible; zero infrastructure and a tiny dependency footprint; monorepo scoping and cross-repo targeting; explicit stale-index warnings.

**Limitations:** no semantic/NL search; heuristic (non-AST) symbols and relationships; language support is tiered (C/C++ have symbols but not yet structured chunking; many languages are indexed as text only); manual re-index; per-repo approval and Node ≥ 22.13 required.

The full, current capability list lives in [`docs/user/usage.md`](docs/user/usage.md).

## Documentation map

- [`docs/user/usage.md`](docs/user/usage.md) — features, workflows, commands/tools, examples, compatibility.
- [`docs/user/migrating-from-pi-extension.md`](docs/user/migrating-from-pi-extension.md) — upgrade existing Git, npm, Pi, local-development, and state installations.
- [`docs/product/PRD.md`](docs/product/PRD.md) — product contract, scope, goals, constraints, success metrics.
- [`docs/product/roadmap.md`](docs/product/roadmap.md) — future/non-V1 ideas, deferred questions, delivery history.
- [`docs/developer/architecture.md`](docs/developer/architecture.md) — storage, schema, scanner/index/search/context architecture, adapter boundary, testing policy.
- [`docs/developer/search-quality.md`](docs/developer/search-quality.md) — maintainer notes for ranking/search-quality benchmark usage.
- [`docs/developer/agent-navigation-eval.md`](docs/developer/agent-navigation-eval.md) — deterministic eval comparing lexical, search-only, and search-plus-context navigation.
- [`docs/developer/real-repo-navigation-eval.md`](docs/developer/real-repo-navigation-eval.md) — local real-repo eval measuring navigation value against rg-like lexical baselines.
- [`docs/developer/qmd-research.md`](docs/developer/qmd-research.md) — prior-art notes from `tobi/qmd` and implications for chunking, vector search, models, and lightweight defaults.
- [`docs/archive/brainstorming.md`](docs/archive/brainstorming.md) — original historical brainstorming note, no longer authoritative.

## License

MIT, as declared in `package.json`.
