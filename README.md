# CodeMap

CodeMap is a local SQLite/FTS codebase index for Pi coding agents. It indexes a Git repository and provides fast path, symbol, and source-chunk lookup without sending code to a remote service.

## How indexing works

CodeMap does not build embeddings or use a vector database. After a repository is explicitly approved, it walks the current Git repository and stores a local SQLite database under `~/.pi/agent/codemap/`.

During the scan it:

- skips symlinks, binary-looking files, secret-like files such as `.env`, common generated/vendor/cache directories such as `.git`, `node_modules`, `dist`, `build`, `coverage`, `.venv`, `site-packages`, `__pycache__`, and matching `.gitignore`/`.codemapignore` entries;
- only indexes supported text extensions such as TypeScript/JavaScript, Markdown, JSON/YAML, SQL, CSS/HTML, Python, Go, Rust, Java, shell, C/C++, and similar source files;
- skips files larger than 1 MB or containing NUL bytes;
- records each file's relative path, language, size, SHA-256 hash, and mtime so unchanged files can be skipped on later runs;
- splits source files into overlapping 80-line chunks and Markdown files by headings;
- extracts lightweight symbols with regexes: TypeScript/JavaScript classes, functions, const arrow functions, interfaces, types, methods, and Markdown headings;
- writes chunks and symbols into SQLite FTS5 tables for full-text lookup.

Re-indexing is incremental: unchanged files are left alone, changed files have their chunks and symbols refreshed, and deleted files are removed from the index. `pathPrefix` can scope indexing, status, search, and context to a repository subtree for monorepos or nested services. Search combines path matches, FTS/BM25 rank, exact text/path matches, and symbol boosts; `codemap_context` returns either the first chunks of an indexed file or falls back to search results, plus simple related test/doc path hints.

## Install

```bash
pi install git:github.com/sebastianlang84/pi-ext-codemap
```

For local development:

```bash
cd ~/dev/pi-extensions/pi-ext-codemap
pi install .
```

## Usage

Approve and index the current Git repository:

```text
/codemap-index --approve-repo
```

Search or fetch compact read-first context:

```text
/codemap-search <query>
/codemap-context <path-or-symbol>
/codemap-status --full
```

For monorepos or nested services, pass `pathPrefix` to the tools or `--path-prefix <subtree>` to commands, for example:

```text
/codemap-index --approve-repo --path-prefix services/newsletter-writer
/codemap-search --path-prefix services/newsletter-writer telegram delivery
```

## Compatibility

Legacy `/codebase-*` commands and `codebase_*` tools are still registered as deprecated aliases. Prefer the primary CodeMap names:

- `codemap_status`
- `codemap_index`
- `codemap_search`
- `codemap_context`

CodeMap stores indexes under `~/.pi/agent/codemap/` and non-destructively migrates existing `~/.pi/agent/code-search/` data when needed.

## License

MIT, as declared in `package.json`.
