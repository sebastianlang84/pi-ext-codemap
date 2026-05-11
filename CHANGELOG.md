# Changelog

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
