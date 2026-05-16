# Search quality metrics and benchmark

This document explains how CodeMap search quality is measured so ranking, chunking, symbol extraction, and query-planning changes can be tuned without relying on anecdotal examples.

## Goals

The benchmark answers three questions:

1. Does a query return at least one expected file in the first five distinct paths?
2. Is the best expected file ranked first often enough?
3. Did a change introduce misses, partial misses, or latency regressions?

It is intentionally deterministic and local. It does not call an LLM or embedding service.

## Commands

Run the deterministic in-repo fixture report:

```bash
npm run bench:search-quality
```

Run the deterministic quality gate used for closeout/CI:

```bash
npm run bench:search-quality:gate
```

Run against explicit repositories for ad hoc tuning:

```bash
npm run bench:search-quality -- /path/to/repo
```

Run the opt-in local real-repo tuning profile:

```bash
npm run bench:search-quality:local
```

The default and gate commands use checked-in fixtures under `test/fixtures/search-quality/`. They do not depend on private local repositories. `--local-repos` is the only mode that uses known local paths when present:

- `/home/wasti/macrolens`
- `/home/wasti/ai_stack/services/newsletter-writer`
- `/home/wasti/dev/autoresearch`

## Case sources

The benchmark combines two case types.

### Structural cases

If `ast-grep` is installed, the benchmark scans supported source files for cheap ground-truth symbols such as functions and classes. Each discovered symbol name becomes a query, and the defining file is the expected path.

This checks whether exact or prefix symbol searches still surface definitions near the top.

### Natural-language cases

For checked-in fixtures and known local repos, the benchmark includes hand-written questions that represent agent-style navigation, for example:

- `where is the main implementation?` → `train.py`
- `where are dependencies declared?` → `pyproject.toml`
- `freshness gate evaluation matrix aggregator` → newsletter aggregator code

Natural cases can have multiple expected paths when a good answer should include several files or when a generic repo-shape query has several valid targets, such as root and workspace `package.json` manifests.

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

Repo-selection and custom gate flags:

```text
--fixtures
--local-repos
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

## Ranking/noise behavior covered by tests

The current product contract is documented in [`../product/PRD.md#12-ranking-and-noise-handling`](../product/PRD.md#12-ranking-and-noise-handling). The benchmark and unit tests act as executable documentation for these rules:

- Lockfiles are indexed so explicit queries such as `package-lock.json` can find them.
- Ordinary dependency or phrase queries should prefer source/config/docs/tests and should not include lockfiles in the top results.
- Generated/build/minified outputs are noisy signals and should not displace source matches or become read-first context neighbors.
- `codemap_context` should keep lockfile/generated/build/minified import or reverse-import neighbors out of `readFirst` while preserving useful related tests/docs.
- Ranking diagnostics exist for maintainer/debug paths, but public `codemap_search` results stay compact and do not expose explain fields.

Relevant tests in `test/search.test.ts` include:

- `lockfiles are indexed but only prominent for explicit lockfile queries`
- `context read-first excludes noisy generated and lockfile neighbors`
- `noisy queries keep source first and out of read-first neighbors`
- `ranking diagnostics expose score components without search API explain fields`

## How to use this when improving CodeMap

1. Run the gate before changing search behavior.
2. Change ranking, query planning, chunking, or symbol extraction.
3. Re-run the same gate command.
4. Inspect `misses`, `partialMisses`, and `excludedHits` first; then inspect Top-1/MRR shifts.
5. Add a natural-language case when a real agent query should have found a specific file or avoided a known noise file.
6. Correct expected paths only when the query is genuinely ambiguous or multi-target; do not relax thresholds after seeing a worse score.

## Future semantic benchmark track

The default benchmark intentionally stays deterministic and model-free. If CodeMap later evaluates optional semantic search, keep it as a separate profile rather than mixing it into the default quality gate.

A semantic evaluation should include:

- German and English mixed queries.
- Code, Markdown docs, YAML/JSON config, project-decision docs, and error-message lookups.
- Candidate stacks such as BM25 only, BM25 + `embeddinggemma-300M`, BM25 + `multilingual-e5-small`, BM25 + `Qwen3-Embedding-0.6B`, and optional reranker variants.
- Additional runtime metrics: cold/warm latency, peak RAM, index size, re-embedding time, model download size, and semantic false positives.

Do not promote an embedder or reranker to a default path unless it beats the lexical baseline on the local corpus without unacceptable compute or reliability cost.

## Current limitations

- Structural ground truth depends on optional `ast-grep`; without it, only natural cases run.
- Natural cases are hard-coded in `scripts/bench-search-quality.ts` for checked-in fixtures and optional known local repos.
- Metrics judge file-path retrieval, not whether the returned snippet is the best possible line range.
- The benchmark is designed for local tuning and regression checks, not as a universal search benchmark across arbitrary projects.
