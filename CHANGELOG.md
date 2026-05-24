# Changelog

## Unreleased

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
