# QMD Research Notes for CodeMap

These notes capture lessons from reviewing [`tobi/qmd`](https://github.com/tobi/qmd) as prior art for CodeMap.

## What qmd is

`qmd` is **Query Markup Documents**: a CLI, SDK, and MCP server for local retrieval over Markdown/document collections. It is not a Pi extension, although a Pi extension can call it as an external tool.

High-level positioning:

```text
qmd     = Markdown/docs/knowledge-base retrieval
CodeMap = repo/code navigation with paths, symbols, line ranges, staleness, and read-first context
```

qmd keeps source documents as files, but it builds a local SQLite index under `~/.cache/qmd/index.sqlite`.

## Product guardrails from this research

These are explicit CodeMap requirements for evaluating qmd or any other prior-art repo:

1. **Lightweight on normal notebooks**: default behavior must stay laptop/notebook-friendly, with low RAM use, no mandatory model downloads, no daemon, and no heavyweight runtime in ordinary agent loops.
2. **Code + plain-file capable**: CodeMap should handle code and repository text/config together, including C/C++, TypeScript/JavaScript, Python, Markdown, YAML, TOML, JSON, shell, SQL, and similar plain files.
3. **Best-of-breed, not blind copying**: when reviewing qmd or future CodeMap-relevant repos, combine useful ideas with CodeMap's existing strengths, but only when they preserve the lightweight/local/agent-friendly product shape.
4. **Structural first, semantic second**: prefer cheap path/symbol/chunk/config-key/doc-heading signals before adding embeddings or rerankers.
5. **Opt-in heaviness**: embeddings, rerankers, query expansion, and vector databases are optional quality/research modes unless local benchmarks prove they are worth the compute cost.

## Storage and indexing architecture

qmd uses:

- SQLite via `better-sqlite3` / `bun:sqlite` compatibility layer.
- FTS5/BM25 for lexical search.
- `sqlite-vec` for vector similarity search.
- Collections configured in YAML, with optional context descriptions.
- Content-addressed document storage: document body by hash, document path/collection separately.
- `content_vectors` metadata plus `vectors_vec` sqlite-vec virtual table for chunk vectors.
- Cached LLM outputs for query expansion and reranking.

Important implementation lessons:

- Keep the source of truth separate from rebuildable indexes.
- Use FTS as a strong deterministic baseline.
- Treat vector indexes as optional accelerators, not required state.
- Avoid unsafe `sqlite-vec` joins: qmd performs vector lookup first, then fetches document metadata in a second query.
- Use explicit collection/subtree filtering instead of global implicit search when possible.

## Context metadata lessons

qmd's context descriptions are more than labels: context can be attached to collections or path prefixes, works as a tree, and is returned with matching documents so an agent can judge why a result belongs in scope.

Potential CodeMap translation:

- Keep repo/path/symbol/line-range results primary.
- Later, allow lightweight repo/subtree/package context metadata for monorepos, e.g. `services/api` = backend API and `packages/ui` = frontend components.
- Do not require this metadata for useful search; avoid config bloat and stale human-maintained descriptions.

## Embedding and model pipeline

qmd runs models locally through `node-llama-cpp` with GGUF files downloaded from Hugging Face and cached under `~/.cache/qmd/models/`.

Default/mentioned models:

| Model | Origin | Purpose | Default? | Approx. size | Lightweight note |
|---|---|---:|---:|---:|---|
| `embeddinggemma-300M-Q8_0` | Google / Google DeepMind model, GGUF via `ggml-org` | Document/query embeddings | Yes | ~300 MB | Small/local default; qmd docs describe it as English-optimized and recommend Qwen3-Embedding for multilingual/CJK-heavy corpora. |
| `qwen3-reranker-0.6b-q8_0` | Alibaba Qwen, GGUF via `ggml-org` | Cross-encoder reranking of top candidates | Yes for `qmd query` | ~640 MB | Quality boost, but extra inference cost. |
| `qmd-query-expansion-1.7B-q4_k_m` | qmd/tobil fine-tuned query expansion model | Generates typed lexical/vector/HyDE query variants | Yes for `qmd query` | ~1.1 GB | Heaviest default component; not suitable as a lightweight default. |
| `Qwen3-Embedding-0.6B-Q8_0` | Alibaba Qwen | Optional multilingual embedding model | No | ~600-700 MB | Better multilingual/CJK, heavier than EmbeddingGemma. |
| `LFM2-1.2B-Q4_K_M` / `LFM2.5-1.2B-Instruct-Q4_K_M` | LiquidAI | Alternative generation/instruct models mentioned in code | No | ~700 MB-1 GB | Experimental alternative, not relevant for CodeMap default. |

CLI command cost tiers:

```text
qmd search  = SQLite FTS/BM25 only; no model required
qmd vsearch = query embedding + sqlite-vec search
qmd query   = query expansion + FTS + vector search + RRF + reranking
```

SDK usage is a separate integration choice: qmd's high-level `store.search({ query })` is closer to the hybrid path, while direct methods such as `searchLex()` / `searchVector()` or options such as skipping rerank keep costs explicit. CodeMap should avoid hiding model work behind a default-looking search API.

For CodeMap, the analogous rule should be:

```text
V1/default: lexical SQLite/FTS only
Optional: embeddings/vector search behind explicit opt-in
Experimental: query expansion/reranking, never required for normal use
```

## Chunking lessons

qmd's chunking is one of the most relevant parts for CodeMap:

- Documents are chunked before embedding.
- Default target is roughly 900 tokens with about 15% overlap.
- Markdown heading boundaries are preferred.
- Code fences are detected so chunks do not split inside fenced code blocks.
- Breakpoints are scored, so headings/classes/functions beat arbitrary newlines.
- Optional AST-aware chunking via tree-sitter exists for supported code languages, currently focused on TypeScript/TSX/JavaScript, Python, Go, and Rust.

CodeMap should consider borrowing the **principles**, not necessarily the dependency stack:

- Improve Markdown chunking around headings and code fences.
- Improve source chunking around functions/classes/import sections.
- Preserve line ranges as first-class output.
- Keep cheap deterministic chunking as the default.
- Consider optional AST/ast-grep/tree-sitter chunk refinement later.

## Search and ranking lessons

qmd's high-quality path is:

```text
BM25 probe
→ optional query expansion
→ FTS + vector search
→ Reciprocal Rank Fusion (RRF)
→ rerank top chunks
→ blend retrieval rank with reranker score
```

Useful ideas for CodeMap:

- Keep exact path/symbol/FTS matching as the primary ranking signal.
- Add `explain`/ranking traces before adding heavier retrieval features.
- If semantic search is added, use RRF or another transparent fusion strategy rather than replacing lexical ranking.
- Protect high-confidence exact/path/symbol matches from being demoted by model-based reranking.
- Rerank chunks, not full files, to avoid token-cost blowups.

## Multi-format CodeMap stance

CodeMap can cover code, Markdown, YAML/JSON, and plain files, but should not treat them all as undifferentiated text. The lightweight path is structural first, semantic second:

| Content | Preferred structural signals before embeddings |
|---|---|
| Code | Path, language, symbols, imports, functions/classes, line ranges, related tests. |
| Markdown | Headings, sections, links, fenced-code boundaries, document role. |
| YAML/JSON | Key paths, top-level objects, config sections, filenames. |
| Plain text | Paragraph/section chunks, path role, nearby repo context. |

This is more important than adding multiple embedders. If semantic search is added later, start with one optional embedder and transparent fusion with the lexical/structural baseline.

## Multilingual lightweight model evaluation notes

The model discussion mixes several decisions that should stay separate:

1. **System target**: CodeMap, qmd, or another non-CodeMap docs/search tool.
2. **Content type**: code, Markdown, YAML/JSON, plain text, or memory records.
3. **Retrieval stage**: lexical BM25/FTS, vector search, reranking, or query expansion.
4. **Integration path**: qmd out-of-the-box, CodeMap-native adapter, Ollama, `node-llama-cpp`/GGUF, ONNX/SentenceTransformers, etc.

Do not treat model names as freely swappable implementation details. Each model family can imply different prompt formats, vector dimensions, context limits, runtime support, cache/index invalidation, and score behavior.

### Practical model shortlist

Under a multilingual requirement, English-only candidates should be excluded from default consideration. That removes models such as `bge-small-en-v1.5`, MS-MARCO MiniLM rerankers, `jina-reranker-v1-tiny-en`, and English-focused Snowflake/Nomic variants unless deliberately scoped to English-only corpora.

Recommended profiles for CodeMap-style tooling:

| Profile | Retrieval stack | Model choice | Intended use |
|---|---|---|---|
| Agent default | SQLite FTS/BM25 only | none | Exact code terms, filenames, symbols, errors, frequent agent loops. |
| Lightweight semantic | BM25 + vector search | `embeddinggemma-300M` first as qmd-supported baseline; `multilingual-e5-small` as smaller counter-test if integration is clean | Short docs, memory, German/English technical notes, but do not assume EmbeddingGemma is the multilingual winner. |
| Code/docs quality | BM25 + vector fusion | `Qwen3-Embedding-0.6B` | Harder semantic queries, longer technical chunks, code/documentation retrieval. |
| Lightweight rerank test | BM25 + vector fusion + rerank | `gte-multilingual-reranker-base` as counter-test | Determine whether a smaller reranker is enough. |
| Research/deep mode | qmd full `query` pipeline | qmd query expansion + embedder + Qwen3 reranker | Manual high-value research, not default agent loops. |

### Embedder candidates

| Model | Why consider it | Caveats | CodeMap stance |
|---|---|---|---|
| `embeddinggemma-300M` | qmd default, local GGUF path is known, edge/on-device oriented, roughly 300 MB | qmd docs call it English-optimized and recommend Qwen3-Embedding for multilingual/CJK-heavy corpora; not code-specialized; around 2K context; not the smallest possible | First optional qmd-compatible semantic baseline, not an unproven multilingual default. |
| `intfloat/multilingual-e5-small` | Much smaller (~118M), multilingual, strong short-text retrieval family | 512-token context, `query:`/`passage:` format, qmd integration must be proven | Most important low-RAM counter-test. |
| `intfloat/multilingual-e5-base` | Proven multilingual family, similar dimension to EmbeddingGemma | 512-token context and no clear weight advantage over EmbeddingGemma | Lower priority; test only if `e5-small` is too weak. |
| `Qwen3-Embedding-0.6B` | qmd-supported quality candidate, multilingual, long context, code retrieval in scope | Heavier RAM/latency than EmbeddingGemma | Quality mode, not default. |
| `BGE-M3` | Strong multilingual retrieval and long context | Heavy/complex; sparse/multi-vector capabilities are not automatic drop-ins | Not default; only if building a richer retrieval layer. |

### Reranker candidates

| Model | Why consider it | Caveats | CodeMap stance |
|---|---|---|---|
| none | Fastest and most predictable | Lower semantic precision on ambiguous natural-language queries | Default. |
| `gte-multilingual-reranker-base` | Smaller multilingual reranker candidate, reported GGUF availability, long context | Integration and quality must be benchmarked | Best lightweight reranker counter-test. |
| `Qwen3-Reranker-0.6B` | qmd default quality reranker, multilingual/code-adjacent | 0.6B and every rerank step costs inference | Quality mode only. |
| `Jina Reranker v2 Base Multilingual` | Multilingual and smaller than Qwen3 | License/deployment/context/runtime details need checking | Secondary experiment. |
| `BGE-Reranker-v2-M3` | Potentially strong multilingual reranker | Similar weight to Qwen3 without qmd default advantage | Do not prioritize. |

### Benchmark requirements before choosing models

Do not choose from leaderboards alone. Use a repo-local benchmark with:

- 20-50 real German/English mixed queries.
- Code questions, docs questions, symbol/API questions, YAML/JSON config questions, project-decision docs, and error-message lookups.
- Metrics: Hit@1, Hit@3, MRR, cold/warm latency, peak RAM, index size, re-embedding time, and semantic false positives.
- Candidate stacks: BM25 only; BM25 + EmbeddingGemma; BM25 + multilingual-e5-small; BM25 + Qwen3-Embedding; BM25 + EmbeddingGemma + GTE reranker; BM25 + EmbeddingGemma + Qwen3 reranker; qmd full query pipeline.

Decision rule:

```text
Keep CodeMap default lexical and structural.
Add exactly one optional semantic baseline first.
Add reranking only as an explicit quality/research mode.
Do not support multiple embedders/rerankers without benchmark evidence.
```

## What CodeMap should not copy by default

Do **not** make these part of CodeMap's default path:

- `node-llama-cpp` runtime dependency.
- GGUF model downloads during ordinary indexing/search.
- `sqlite-vec` as required schema state.
- HTTP/MCP daemon or long-lived model server.
- Query expansion/reranking as mandatory behavior.
- A broad qmd-style SDK/product surface beyond CodeMap's focused Pi tools.

These would conflict with CodeMap's V1 contract: local, deterministic, lightweight, repo-scoped, and useful without embeddings.

## Recommended CodeMap roadmap impact

Short term:

1. Add/maintain this qmd prior-art note.
2. Improve chunking quality, especially Markdown/code-fence handling.
3. Add search/ranking explain traces for debugging and benchmarks.
4. Keep [`search-quality.md`](search-quality.md) focused on deterministic regression metrics.

Medium term:

1. Evaluate optional `sqlite-vec` support behind explicit opt-in.
2. Define an embedding provider interface without committing to a default model runtime.
3. Prototype hybrid lexical/vector search with RRF while preserving lexical fallback.
4. Consider collection/subtree context metadata for monorepos, but avoid config bloat.

Separate tool track:

- Evaluate qmd itself for Markdown-heavy agent context such as `~/.pi/agent/skills` and AGENTS/reference docs.
- Do not force CodeMap to become the global Markdown/skill search system; qmd may be better suited for that domain.
