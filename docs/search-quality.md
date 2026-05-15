# Search quality metrics and benchmark

This document explains how CodeMap search quality is measured so ranking, chunking, symbol extraction, and query-planning changes can be tuned without relying on anecdotal examples.

## Goals

The benchmark answers three questions:

1. Does a query return at least one expected file in the first five distinct paths?
2. Is the best expected file ranked first often enough?
3. Did a change introduce misses, partial misses, or latency regressions?

It is intentionally deterministic and local. It does not call an LLM or embedding service.

## Commands

Run an informational report:

```bash
npm run bench:search-quality -- /path/to/repo
```

Run the default quality gate:

```bash
npm run bench:search-quality:gate -- /path/to/repo
```

If no repository path is supplied, the script uses existing default local fixtures when present:

- `/home/wasti/macrolens`
- `/home/wasti/ai_stack/services/newsletter-writer`
- `/home/wasti/dev/autoresearch`

## Case sources

The benchmark combines two case types.

### Structural cases

If `ast-grep` is installed, the benchmark scans supported source files for cheap ground-truth symbols such as functions and classes. Each discovered symbol name becomes a query, and the defining file is the expected path.

This checks whether exact or prefix symbol searches still surface definitions near the top.

### Natural-language cases

For known local repos, the benchmark includes hand-written questions that represent agent-style navigation, for example:

- `where is the main implementation?` → `train.py`
- `where are dependencies declared?` → `pyproject.toml`
- `freshness gate evaluation matrix aggregator` → newsletter aggregator code

Natural cases can have multiple expected paths when a good answer should include several files.

## Metrics

Metrics are computed over distinct result paths in the top five results.

| Metric | Meaning |
|---|---|
| `top1Accuracy` | Fraction of cases where the first result is one of the expected paths. |
| `recallAt5` | Fraction of cases where at least one expected path appears in the top five. |
| `expectedCoverageAt5` | Average fraction of all expected paths found in the top five. Useful for multi-file questions. |
| `mrrAt5` | Mean reciprocal rank of the first expected path in the top five. |
| `avgLatencyMs` | Average per-query search latency measured by the benchmark. |
| `p95LatencyMs` | 95th percentile per-query search latency. |
| `misses` | Cases with no expected path in the top five. |
| `partialMisses` | Multi-expected-path cases where some expected paths are missing from the top five. |

Cases with no expected paths are invalid and rejected, because they would make coverage meaningless.

## Quality gate

`npm run bench:search-quality:gate` enables the default gate:

```text
--min-top1 0.6
--min-recall-at-5 1
--min-mrr-at-5 0.85
--fail-on-misses
require at least one evaluated case per repo
```

The gate exits non-zero when a threshold fails. Informational benchmark runs still print the gate section but do not fail unless a gate flag is supplied.

Custom gate flags:

```text
--quality-gate
--min-top1 <0..1>
--min-recall-at-5 <0..1>
--min-coverage-at-5 <0..1>
--min-mrr-at-5 <0..1>
--max-p95-ms <milliseconds>
--fail-on-misses
--fail-on-partial-misses
```

Custom numeric thresholds must be present and in range. Supplying any custom gate flag also requires at least one evaluated case.

## How to use this when improving CodeMap

1. Run the gate before changing search behavior.
2. Change ranking, query planning, chunking, or symbol extraction.
3. Re-run the same gate command.
4. Inspect `misses` and `partialMisses` first; then inspect Top-1/MRR shifts.
5. Add a natural-language case when a real agent query should have found a specific file.
6. Only relax thresholds when the benchmark data or case design is wrong.

## Future semantic benchmark track

The default benchmark intentionally stays deterministic and model-free. If CodeMap later evaluates optional semantic search, keep it as a separate profile rather than mixing it into the default quality gate.

A semantic evaluation should include:

- German and English mixed queries.
- Code, Markdown docs, YAML/JSON config, memory/decision-style notes, and error-message lookups.
- Candidate stacks such as BM25 only, BM25 + `embeddinggemma-300M`, BM25 + `multilingual-e5-small`, BM25 + `Qwen3-Embedding-0.6B`, and optional reranker variants.
- Additional runtime metrics: cold/warm latency, peak RAM, index size, re-embedding time, model download size, and semantic false positives.

Do not promote an embedder or reranker to a default path unless it beats the lexical baseline on the local corpus without unacceptable compute or reliability cost.

## Current limitations

- Structural ground truth depends on optional `ast-grep`; without it, only natural cases run.
- Natural cases are currently hard-coded in `scripts/bench-search-quality.ts` for known local repos.
- Metrics judge file-path retrieval, not whether the returned snippet is the best possible line range.
- The benchmark is designed for local tuning and regression checks, not as a universal search benchmark across arbitrary projects.
