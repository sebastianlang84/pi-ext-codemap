# Changelog

## Unreleased

- Make `codemap_search` use cheap (Git HEAD-based) health instead of a full working-tree scan, so every search no longer re-hashes the entire repository; search staleness stays advisory (HEAD changes still flagged) and the file-level stale scan remains behind `codemap_status --full`.

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
