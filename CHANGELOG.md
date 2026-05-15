# Changelog

## Unreleased

- Breaking: remove deprecated `codebase_*` tool aliases and `/codebase-*` commands. Use `codemap_*` tools and `/codemap-*` commands instead.
- Improve `codemap_context` read-first packages by adding directly imported local files and local caller hints alongside name-based test/doc hints.

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

- Move CodeMap indexes under `~/.pi/agent/state/codemap/` and migrate existing `~/.pi/agent/codemap/` or `~/.pi/agent/code-search/` data non-destructively.
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
