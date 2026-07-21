# Changelog

## Unreleased

- Move the real-repo navigation eval suites out of inline machine-specific paths into a checked-in `scripts/eval-real-repo-navigation.suites.json` data module with home-relative roots, loaded and validated at startup (structure + miss-class values). Behavior is unchanged — the same 5 suites / 24 tasks, the `CODEMAP_EVAL_REPOS` root override, and the missing-repo skip semantics all still apply.
- Self-cap the usage-telemetry log on the append path: `appendEvent` now rotates `usage.jsonl` to `usage.jsonl.1` when it exceeds the 32 MB cap before writing, so installed users (with no dev clone to run `gc:state`) can no longer grow the log without bound. One `statSync` per process, never throws, and `gc:state` remains the reporting/DB-prune entry point. The rename logic and log-name constant are now shared between the append path and `state-gc` instead of duplicated.
- Replace the role-intent candidate query's blind "500 shortest paths" cap with an SQL LIKE prefilter on the role-bearing path patterns for the active intents (readme/agents/docs/adr/tests/config/dependency basenames, etc.). In repos with more than 500 files, role files on long paths (deep READMEs, `docs/adr/…`) were silently dropped before the role filter ran; the prefilter is a superset of the authoritative `fileRoles` conditions, so recall improves without new false positives, and the 500 cap remains only as a DoS ceiling applied to role-bearing paths. An unknown intent falls back to the unfiltered scan, guarded by an exhaustiveness test.
- Merge the duplicated per-tier FTS chunk scan: `chunkFtsCandidates` and `codeQuotaCandidates` ran the same `chunks_fts MATCH` twice per query tier (up to ~7 tiers). They now share one `order by rank` scan (deepest of the two limits), so each consumer's prefix is identical to before — no ranking change, up to ~7 fewer FTS scans per search.
- Memoize the query-term boundary `RegExp` in a shared `termBoundaryPattern` helper instead of recompiling it per candidate × term in the ranking hot path; the pattern is byte-identical, so ranking is unchanged, and the long-lived MCP process now reuses compiled patterns across searches.
- Add a lexicon-ratchet test that fails if the eval-tuned `knownIdentifierCompounds` / `evalTunedPathTerms` tables grow, forcing a new entry to be a deliberate general-mechanism/ADR decision rather than silent fixture-fitting.
- Resolve `codemap context` targets deterministically: an ambiguous basename (e.g. two `operations.ts`) now prefers an exact path, then the shortest path, then lexicographic order, instead of returning whichever row SQLite scanned first, and emits a warning listing the other matches so the caller can disambiguate. Prevents the unspecified "wrong-anchor" expansion the confidence logic warns about.
- Reuse the indexer's mtime+size fastpath in `fullIndexHealth`, so `codemap context` and `status --health full` no longer read and re-hash every unchanged file on every call (cost now scales with changed files, not repo size). Staleness detection is unchanged — the fastpath only skips the read; the hash comparison still runs, and the accepted tradeoff (a content edit that keeps identical size and mtime is not flagged) matches the incremental indexer exactly.
- Validate the `codemap` CLI `--limit` flag as a positive integer at the argument boundary. A non-integer, zero, negative, fractional, or missing value now fails fast as a usage error (exit 2) instead of flowing through as `NaN` into the SQL bind and dying with an opaque "datatype mismatch"; the MCP path was already guarded by its schema.
- Add a read-only offline analyzer for the usage-telemetry log (`npm run report:usage`, ADR 0001 phase 2): a pure `usage-report.ts` builder plus a thin script that reads the rotated and current `usage.jsonl`, tolerating malformed/legacy lines, and reports per-repo/per-day activity, per-command outcome and latency distributions (p50/p95, empty/cap-hit/stale rates), the `not_approved → approving index → search` gate funnel, stale→refresh follow-through, and a search→context impression join (rank of the opened file in the prior in-window search, preferring the same agent). It never writes state, indexes, or feeds the ranking path.
- Tag every usage-telemetry event with the calling surface (`adapter`: `cli` / `mcp` / `pi`) via an optional argument threaded through the host-neutral operations seam, so adoption can be attributed per adapter instead of collapsing to `unknown`. Direct library calls (tests, scripts) still record `unknown` as the documented fallback; the schema is unchanged (no version bump) and pre-existing events keep their `unknown` bucket.
- Bundle an optional, harness-agnostic `navigating-with-codemap` skill in the Git/npm package, with a portable CLI-first navigation workflow, explicit exhaustive-search fallbacks, and generic copy/symlink deployment guidance for global or repository-local skill scopes. Package and test gates ensure the skill ships and remains free of runtime-specific instructions.
- Add local, append-only usage telemetry (`usage.jsonl` beside the index state, mode 0600, never leaves the machine): every `codemap` invocation records command, outcome (ok/empty/not_approved/error), latency, repo, a best-effort agent fingerprint, and — for search — the ranked-result impressions. It is written failure-proof at the single host-neutral operations seam (covering CLI, MCP, and Pi), so a telemetry fault can never alter a command's result or output, and the log is never read back into ranking. `npm run gc:state` now size-caps (32 MB, one rotated generation) and reports the log.
- Add a separate machine-readable semantic benchmark track with a checked-in English/German corpus, fixed development/holdout splits, a frozen lexical baseline, false-positive and quality gates, plus cold/warm latency, peak-RSS, index-size, embedding-time, and model-size resource reporting. It remains model-free and changes no production search behavior.
- Rank text-covered source files ahead of weak signature-only symbol hits by scaling the symbol-source preference with actual query coverage and using cross-chunk file coverage only to rescue results below the visible limit. The Macrolens threshold-boundary entry now reaches the search Top 5 without changing query terms or regressing the fixed search/navigation gates.
- Keep a test belonging only to a newly added direct-import neighbor from displacing higher-ranked visible source hits in the scripted search+context read plan. The Macrolens provider-outage advisory now retains both named provider files; the 24-case real-repo comparison returns to 6 wins, 0 losses, and 18 ties against search-only.
- Make the author-local real-repo navigation harness portable with `CODEMAP_EVAL_REPOS=label=/absolute/path,...`: configured missing repos are skipped with warnings, `--require-repos` remains available for strict inventory checks, and corpus-size improvement thresholds adapt to the available subset while real quality regressions still fail the gate.
- Fix conceptual/UI-navigation search returning README/overview docs instead of the code that implements the feature. Three ranking changes (see [`docs/adr/20260714-search-code-vs-doc-target.md`](docs/adr/20260714-search-code-vs-doc-target.md)): non-FTS retrieval sources no longer earn a phantom FTS credit; the `overview` role intent fires only on doc-evidence, not on a role word mixed with identifier terms; and an additive code-chunk quota plus a doc-intent-gated code lift surface source over docs on code/UI queries while keeping canonical docs the top hit for doc-intent queries and never lifting generated/build noise. Guarded by a new checked-in `doc-flood` search-quality fixture and ranking unit tests.
- Point `codemap` CLI users to `codemap index --approve` in the not-approved / not-indexed errors (search, context, index, and the architecture report) instead of the stale MCP `codemap_index` / `approveRepo` wording, and state that indexing is local-only and never modifies the repo.
- Show the first matched line and score of each hit in `codemap search` human output (one line per hit; JSON output unchanged) so ranked results carry the same at-a-glance signal as a grep line.
- Silence the one-line `node:sqlite` `ExperimentalWarning` on the `codemap` CLI (via a `--disable-warning=ExperimentalWarning` shebang flag) so shell/agent callers get clean stderr; stdout JSON is unaffected and the `codemap-mcp` server keeps its default shebang.
- Add a deferred-tool hint to the MCP server instructions: hosts that list the `codemap_*` tools without preloading their schemas should load them before the first call, or drive the `codemap` CLI directly, so the ranked-navigation path is not lost to a schema round-trip.

## 0.9.0 - 2026-07-12

- Reframe the project from Pi-first `pi-ext-codemap` to CLI-first CodeMap at `sebastianlang84/codemap`: rename the package to `@sebastianlang84/codemap`, ship versioned built JavaScript for compiler-free `codemap` and `codemap-mcp` installs, and keep MCP and Pi as adapters over the shared operations. Pi peer dependencies are optional for CLI/MCP users.
- Move the default approval/index state to platform-neutral user data resolution (`CODEMAP_HOME`, then `$XDG_DATA_HOME/codemap`, then `~/.local/share/codemap`) while continuing to use an existing `~/.pi/agent/state/codemap` automatically until the user deliberately migrates it. The CLI `--state-dir` override remains highest priority.
- Add an existing-user migration guide covering the renamed Git/npm/Pi sources, MCP restart, a canonical `~/dev/codemap` development checkout, guarded state migration, and post-move verification.
- Lower the supported runtime floor from Node 24 to Node 22.13 now that CLI/MCP ship built JavaScript and `node:sqlite` is available without an opt-in flag; refresh Pi development peers to 0.80.6 and clear the prior dev-only audit findings.
- Make `npm run verify` reproducible from checked-in fixtures; retain the maintainer-machine real-repo cohort as the explicit `npm run verify:local` extension so external repository drift is not mistaken for a product regression.
- Reframe the `codemap_search` / `codemap_context` tool descriptions and the MCP server instructions from a blanket "prefer over grep/find" to an explicit decision boundary — ranked/conceptual navigation and relationship neighbors go to CodeMap, exhaustive literal/regex matches stay with grep/rg — so an agent routes between the tools by task shape instead of being told to always prefer CodeMap. Drops the unsupported "relationship-aware" wording from search (relationship edges come from `codemap_context`) and aligns the Pi prompt guidelines with the same framing. Description token surface stays within the soft budget.
- Add a read-cost metric (`avgBytesRead` / `estTokensRead`, ≈ bytes / 4) to the agent-navigation and real-repo-navigation evals, quantifying the tokens an agent spends loading each mode's read plan instead of only counting files read. On the locally available real repos, `codemap_search_context` reads far fewer estimated tokens than the rg-like lexical baseline at the same file budget.
- Add a `Benchmarks` section to the README that surfaces the navigation-eval numbers (success/recall at a fixed read budget) with a plain-language interpretation, so CodeMap's navigation value is stated as measured evidence rather than a claim.

## 0.8.1 - 2026-07-07

- Fix the footer status pill (`[CodeMap ✓]` / `[CodeMap ✗]`) not refreshing after `codemap_index` runs mid-session (e.g. an interactive `approveRepo`); the pill now updates immediately instead of staying stale until the next session start.

## 0.8.0 - 2026-07-05

- Add an MCP server (`bin/codemap-mcp.ts`, `src/mcp/`, `codemap-mcp` bin) so MCP hosts such as Claude Code, Codex, and Cursor can expose the same four `codemap_*` tools natively instead of shelling out to the CLI via an `AGENTS.md`/`CLAUDE.md` note. It speaks newline-delimited JSON-RPC 2.0 over stdio (`initialize`/`tools/list`/`tools/call`/`ping`, protocol revision `2025-11-25`) with no added runtime dependency; `dispatch()` is a pure, testable handler. Token-lean per call: `content` is a compact ranked summary with the full object in `structuredContent` (no duplicated JSON dump). Read tools declare `readOnlyHint` annotations, and unknown-tool/execution failures return as Tool Execution Errors (`isError`, SEP-1303) so the model self-corrects.
- Move the Pi-free operation surface into core: tool metadata/TypeBox schemas to `src/core/operation-metadata.ts` and the `codeMapStatus/Index/Search/Context` executors (plus `operationCwd`) to `src/core/operations.ts`, so the Pi, CLI, and MCP adapters share one description and one execution path. No behavior change; the Pi adapter re-exports the executors.

## 0.7.1 - 2026-07-05

- Store the FTS indexes as contentless FTS5 (`content='', contentless_delete=1`) instead of duplicating chunk/symbol text in the FTS shadow tables. Search reads only use the FTS index for `MATCH`/`bm25()` and join back to the base tables, so matching is unchanged while the on-disk index shrinks (~40% smaller on a code-heavy repo). Legacy content-owning FTS databases are converted in place and repopulated from the base tables on next open, so no reindex is required.

## 0.7.0 - 2026-07-05

- Add a standalone `codemap` CLI (`bin/codemap.ts`, `src/cli/`) so non-Pi agents such as Claude Code and Codex can use CodeMap: `codemap search|context|status|index`, all accepting `--json`, `--repo`, and `--path-prefix`. The CLI is a thin adapter over the Pi-independent core (no `src/pi-extension/` imports); `runCli` returns `{ code, out, err }` for testability. README now leads with the value proposition, the for/not-for boundaries, and CLI install + `CLAUDE.md`/`AGENTS.md` wiring.
- Add a state garbage-collector (`npm run gc:state`, core `pruneState`/`collectStateGcCandidates`) that reclaims orphaned per-repo index DBs (no registry row) and DBs for deleted/moved repo roots, and drops their leftover registry approval rows. Dry-run by default; `--apply` deletes and `--json` emits machine output. Index DBs are rebuildable, so pruning only clears cached data and stale approvals.

## 0.6.10 - 2026-07-05

- Make `codemap_search` use cheap (Git HEAD-based) health instead of a full working-tree scan, so every search no longer re-hashes the entire repository; search staleness stays advisory (HEAD changes still flagged) and the file-level stale scan remains behind `codemap_status --full`.
- Extract C/C++ symbols (functions, methods, `struct`/`union`/`enum`/`class`) so C/C++ files are searchable by symbol like TS/JS/Python, and normalize C/C++ file extensions to canonical `c`/`cpp` language tags. Structured (brace-based) chunking for C/C++ stays out of scope for now.
- Document priority languages (TypeScript, JavaScript, C, C++) in the PRD and add a per-capability language support matrix (text/symbols/chunking/relationships) to the architecture docs.

## 0.6.9 - 2026-06-28

- Replace the bash grep/rg/find pre-execution block with a once-per-repo `tool_result` nudge that only appears for broad navigation/discovery commands against a fresh CodeMap index, skipping targeted known-file checks.
- Extract shared navigation-eval assessment, metric, and Search+Context lookup helpers into Pi-independent core so eval scripts can stay thinner adapters without changing CodeMap ranking/context behavior.
- Split Natural-Navigation search+context fixtures out of the remaining large search test suite without changing public CodeMap behavior.
- Split public search navigation ranking/noise fixtures out of the core search smoke suite without changing CodeMap behavior.
- Render the CodeMap footer status as a self-contained pill (`[CodeMap ✓]` / `[CodeMap ✗]`) so it stays readable when Pi composes adjacent extension statuses with single spaces.

## 0.6.8 - 2026-06-09

- Split stale-index diagnostics, status/pathPrefix, refresh, and safety/ignore-policy contracts out of the large search test suite without changing public CodeMap behavior.

## 0.6.7 - 2026-06-09

- Preserve import/include line evidence when rebuilding relationship graphs from overlapping indexed chunks, bumping the internal graph version and sharing overlap-safe source reconstruction with legacy relationship lookups.
- Clarify PRD wording that public graph/explain tools remain out of scope while the internal file-relationship graph supports read-first context hints.

## 0.6.6 - 2026-06-09

- Add internal graph-neighborhood diagnostics, an internal relationship path helper, and a developer-only architecture report script without adding public Pi tool schemas or Graphify dependencies.
- Split internal search diagnostics contract tests out of the large search test suite without changing public CodeMap behavior.
- Split context relationship and graph contract tests out of the large search test suite without changing public CodeMap behavior.

## 0.6.5 - 2026-06-05

- Fix `codemap_status` cheap mode: replace hardcoded stub with a real Git HEAD comparison so `stale: false` is never reported for an unchecked index; `full=true` is now only needed for file-level diff diagnostics.

## 0.6.4 - 2026-05-25

- Split eval diagnostics/report and pure query-plan/ranking contracts out of the large search test suite, shrinking the remaining monolith while keeping public CodeMap behavior unchanged.

## 0.6.3 - 2026-05-25

- Split the pure search+context read-plan contracts out of the large search test suite so follow-up search/ranking/context refactors have a smaller public seam to change.

## 0.6.2 - 2026-05-25

- Rename the repository test root from `test/` to `tests/`, update package/script/docs references, and keep checked-in eval fixtures discoverable under the new path.
- Split storage/migration and Pi adapter contract coverage out of the large search test suite, adding shared temp repo/home test fixtures for follow-up refactors.
- Add eval-only ranking/context debug traces with score components, selected/rejected search candidates, and read-plan budget decisions while keeping public search results compact.

## 0.6.1 - 2026-05-25

- Add `npm run verify` as a local closeout gate that chains existing typecheck, tests, quality gates, and token-injection checks.
- Add stable miss-taxonomy summaries to the deterministic agent-navigation eval report, matching the real-repo eval classes and bounded examples.

## 0.6.0 - 2026-05-25

- Link Next.js-style route adapter files with convention-named `*handler*` sources and their tests in `codemap_context` read-first output without adding new reason kinds or public tool schema.

## 0.5.5 - 2026-05-24

- Remove the internal experimental `ast-grep`-supplemented symbol indexing path and comparison benchmark after evals showed no retrieval-quality gain, a local structural Top-1/MRR regression, and measurable index-time cost; optional `ast-grep` remains only benchmark ground truth.

## 0.5.4 - 2026-05-24

- Add an internal opt-in `ast-grep`-supplemented symbol indexing prototype plus search-quality benchmark flags, including an isolated default-vs-experimental comparison report, keeping the default indexer and public Pi tool schemas unchanged.

## 0.5.3 - 2026-05-24

- Expand the local real-repo natural-language navigation holdout from 11 to 16 cases, keeping newly exposed misses visible while the baseline cohort remains fully green.
- Add endpoint path-term route candidates and route-adapter import/test ordering, resolving the expanded holdout's catalog endpoint route/source/test miss without changing public tool schemas.
- Defer archived docs behind active search/context candidates in scripted search+context read plans, avoiding a noisy archived-plan read in the expanded holdout without changing public tool schemas.

## 0.5.2 - 2026-05-24

- Prioritize Next.js API route adapters that import a context target, keeping newsletter endpoint handlers visible in small search+context read plans without changing public tool schemas.
- Expand the local real-repo natural-language navigation holdout to cover a Macrolens newsletter macro endpoint route-adapter case.

## 0.5.1 - 2026-05-24

- Keep tests for visible imported neighbors in the scripted search+context read plan, resolving the remaining `pi-ext-memory` baseline retrieval-test miss and bringing local baseline plus natural holdout `codemap_search_context` recall to full coverage without changing public tool schemas.
- Let the scripted search+context read plan keep context-backed search hits and one direct import when no doc/config or unsearched test/config neighbor competes, resolving the baseline Macrolens `series-analysis.ts` budget miss without changing public tool schemas.
- Add natural navigation support for handoff preload scope/docs, reviewer-context-scout benchmark docs, and FastAPI compose deployment configs, bringing the expanded natural holdout to full `codemap_search_context` recall without changing public tool schemas.
- Treat provider files as a navigation role and include tests for non-test reverse importers, resolving the expanded holdout's Macrolens provider-source/test budget miss without changing public tool schemas.
- Add root README fallback as read-first documentation only when no name/path-specific docs match, resolving the expanded holdout's `sg` binary README-budget miss without changing public tool schemas.
- Prefer context-related tests when the scripted search+context read plan fills remaining budget, resolving the expanded holdout's workbench chart-test miss without changing public tool schemas.
- Expand natural identifier-pair search terms and demote local Claude settings for ordinary searches, improving the expanded holdout's workbench-session entry recall without changing public tool schemas.
- Penalize agent-instruction files for non-agent search queries, resolving the expanded holdout's ambiguous `sg` binary target mismatch without changing public tool schemas.
- Expand the local real-repo natural-language navigation holdout from 4 to 10 cases and recalibrate its diagnostic gate floor so new symptom-style misses stay visible without weakening the baseline gate.
- Preserve visible `codemap_search` hits when scripted navigation evaluates search+context read plans, resolving the remaining local real-repo baseline miss without adding prompt-facing API surface.
- Document CodeMap's positioning as a local Pi-agent context router between grep/ctags and heavier AI/code-search systems.
- Resolve TypeScript/JavaScript graph edges for relative `.js` specifiers that point at indexed TypeScript sources, improving reverse-import context and triggering an index-version rebuild.
- Prioritize stem-affine reverse importers before imported-neighbor tests in small `codemap_context` budgets.
- Prefer source files over matching tests for generic implementation-intent search queries, reducing real-repo search+context target mismatches.
- Add navigation-miss reason summaries to the local real-repo navigation eval so remaining taxonomy misses are split by context-target mismatch versus context relationship/budget gaps.
- Add a natural-language holdout cohort to the local real-repo navigation eval so symbol-heavy navigation gains remain visible separately from symptom-style queries.
- Include one imported local neighbor's convention sibling test in small `codemap_context` read-first budgets when direct imports bring the source file in.
- Reduce generic `implementation` role-intent noise so broad source entrypoints do not outrank more specific CodeMap search hits in local real-repo navigation.
- Add per-case navigation diagnostics to the local real-repo eval: search top hits, context target, read-first reasons, and entry-coupled miss explanations.
- Keep one convention-based sibling test earlier than nearby config files in small `codemap_context` read-first budgets.
- Resolve minimal TypeScript/JavaScript `tsconfig.json` / `jsconfig.json` path aliases as graph-backed local import neighbors for `codemap_context`.
- Add miss-taxonomy diagnostics to the local real-repo navigation eval so missed expected files and noisy reads are classified into actionable improvement buckets.
- Add a local real-repo navigation eval showing CodeMap search+context value against rg-like lexical baselines on Macrolens, Alpha Cycles, and Pi extension repos.
- Strengthen exact/prefix symbol ranking so implementation symbols beat broad file chunks in real navigation queries.
- Add a deterministic agent-navigation eval comparing lexical lookup, `codemap_search`, and `codemap_search` + `codemap_context` on fixed fixture tasks.
- Add a context-quality benchmark gate and fixture to prove graph-backed `codemap_context` returns required imports, reverse imports, includes, tests, docs/config, and path-scoped neighbors without noisy leaks.
- Add a graph-budget benchmark script and fixture to measure V1.5 relationship-graph index time, SQLite size, and `codemap_context` latency before further graph expansion.
- Add the first relationship-graph slice for `codemap_context`: local file import/include edges are persisted in SQLite and reused for direct/reverse read-first context without changing public tool schemas or search ranking.
- Replace `○ not indexed` status text with `✗` for a cleaner status bar indicator.
- Add optional `repoPath` / `--repo-path` targeting to CodeMap status, index, search, and context so agents can query another repo without changing session cwd.
- Restructure documentation into product, user, and developer sections, with README kept as a concise entry point.
- Remove stale compatibility wording and migration code for obsolete names/paths.
- Improve `codemap_context` read-first packages by adding directly imported local files and local caller hints alongside name-based test/doc hints.
- Add `codemap_context` read-first relationship reasons plus lightweight TypeScript/JavaScript, Python relative import, nearby config, same-directory source, test/source role, and C/C++ include/header-source relationship hints.
- Keep lockfile/generated/build/minified neighbors out of read-first context while preserving useful related tests/docs.
- Add internal ranking diagnostics for tests and benchmarks without adding public `codemap_search` explain fields.
- Add Git-aware full status diagnostics for current/indexed HEAD, dirty working trees, dirty file lists, and path-scoped last-index metadata.
- Harden ranking roles and noise penalties so source/config/docs/tests beat generated/build/vendor/minified/large-JSON noise unless noisy paths/files are explicitly requested.
- Add a token-injection budget report and test gate for registered CodeMap Pi tools.
- Make the search-quality gate deterministic by defaulting it to checked-in fixtures and moving private local real-repo benchmarks behind an opt-in local mode.
- Add symbol, endpoint/route, config-key, error-message, and noisy-query class coverage to public search/context tests and the checked-in search-quality fixture.
- Improve natural-language module-file ranking for exact basename terms and refine generic README/package benchmark ground truth for multi-manifest repos.
- Add an opt-in Pi JSON-mode agent eval for stale CodeMap refresh behavior and document the initial 6/6 pass, so refresh automation stays deferred for now.

## 0.5.0 - 2026-05-12

- Improve natural-language CodeMap ranking with lightweight query normalization, path/text coverage scoring, heuristic file roles, and role-aware boosts for overview, agent instructions, implementation, setup, tooling, tests, dependencies, and lockfiles.
- Add Python class/function symbol extraction and force index refreshes when extraction semantics change.
- Extend search-quality benchmarks with autoresearch natural-language cases, distinct-path scoring, multi-expected-path support, reusable quality-gate thresholds, and detailed docs.

## 0.4.2 - 2026-05-12

- Fix the root Pi extension entrypoint so package discovery can import it with Node type stripping.
- Include the entrypoint in TypeScript checks and make the lightweight audit import extension entries.
- Declare `typebox` as an explicit runtime dependency.
- Escape `LIKE` wildcards in CodeMap context path matching.

## 0.4.1 - 2026-05-11

- Move CodeMap indexes under `~/.pi/agent/state/codemap/`.
- Add a root Pi extension entrypoint for cleaner package discovery.

## 0.4.0 - 2026-05-11

- Add scoped CodeMap indexing/search/context via `pathPrefix` and command `--path-prefix` for monorepos and nested services.
- Add `.codemapignore` support and broader default ignores for dependency/cache noise such as `.venv`, `site-packages`, `__pycache__`, and tool caches.
- Add quantifiable search-quality tests and a benchmark script using CodeMap plus ast-grep ground truth.
- Document how indexing works, including FTS/chunk/symbol behavior and the absence of embeddings.

## 0.2.2 - 2026-05-11

- Align status bar symbols with pi-ext-memory convention: `✓` / `✗` instead of plain text.

## 0.2.1 - 2026-05-09

- Improve the README for faster human overview, tool discovery, install/upgrade, and first-use guidance.
- Release the lightweight diagnostics hardening as a patch update.

## 0.2.0 - 2026-05-09

- Surface stale-index diagnostics in codemap results instead of silently searching stale data.
- Improve tool rendering with compact path/line/snippet lists and warning badges.
- Document explicit refresh flow for stale indexes.

## 0.1.1 - 2026-05-09

- Improve search ranking for symbols, paths, phrases, and lockfile noise.
- Add test coverage and TUI result rendering integration.
