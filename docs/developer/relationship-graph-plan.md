# CodeMap relationship graph plan

Status: V1.5 import/include slice implemented on `feature/relationship-graph`; broader graph ideas gated
Owner: CodeMap core
Last reviewed: 2026-05-23 implementation-readiness review

## Purpose

Add a lightweight, deterministic relationship graph to CodeMap so agents can navigate arbitrary repositories by structure, not only by lexical search. The graph should improve `codemap_context` read-first packages, impact analysis, and query routing while preserving CodeMap's existing identity: local, rebuildable, SQLite-backed, low-RAM, no daemon, no mandatory embeddings, and no LLM work in the ordinary index path.

This is not a plan to copy a heavyweight knowledge-graph product. The target is a small graph substrate that makes CodeMap better at answering:

- What local files does this file depend on?
- What local files depend on it?
- Which exact import-proven tests exercise it?
- Which files should `codemap_context` make an agent read before editing this target?

V1.5 is intentionally not a general knowledge graph. It is a vertical context slice for exact local file relationships.

## Design principles

1. **Deterministic first.** Default graph extraction must be local, repeatable, and cheap. LLM summaries, tours, embeddings, and semantic clustering are optional enrichment layers, not prerequisites.
2. **Improve retrieval, not dashboards.** The first product win is better `codemap_context`; visualization can come later if the graph data proves useful.
3. **Reuse existing index state.** Files, chunks, scanner policy, ignores, size limits, and stale checks remain the authority. Graph tables reference indexed files instead of creating a separate crawler.
4. **Evidence over vibes.** Every stored edge should carry extractor/evidence metadata sufficient to debug why it exists.
5. **Small public surface.** Avoid adding prompt-facing tool text until an internal graph demonstrably improves context results. Preserve token-injection budgets.
6. **Incremental and disposable.** Graph data is rebuildable per repo and should refresh with file hash changes; deleting/reindexing a file should remove or replace its graph evidence.
7. **Privacy-safe by construction.** Respect existing scanner exclusions; do not index skipped secret-like files; do not store raw secret values in edge evidence.

## Non-goals

- No mandatory graph database, daemon, web server, model runtime, or remote service.
- No automatic LLM analysis during `codemap_index`.
- No browser dashboard as part of the core slice.
- No full call graph, type resolver, symbol graph, module graph, external package graph, documentation graph, config graph, or similarity graph in V1.5.
- No `codemap_search` ranking changes until separate benchmarks prove value; V1.5 graph is for `codemap_context` only.
- No user-facing ranking-explain fields unless a separate product decision accepts them.
- No committed repo-local graph artifacts; graph data stays under CodeMap state.

## Current baseline

CodeMap already has a useful relationship seam in `src/core/relationships.ts` and `src/core/context-builder.ts`:

- direct local TypeScript/JavaScript imports;
- Python explicit relative imports;
- C/C++ quoted includes;
- reverse imports/includes by scanning indexed files;
- C/C++ header/source pairs;
- sibling tests, reverse tests, related docs, nearby configs, same-directory source neighbors;
- compact reason objects on `readFirst` items.

The limitation is that many relationships are recomputed ad hoc from chunks at context time. That works for V1, but it makes relationship quality hard to test, debug, benchmark, and reuse for future impact analysis. The graph plan promotes the best current relationship logic into an indexed, queryable substrate.

## Implementation readiness review

The plan is implementable if the first slices preserve these constraints:

- **Use valid raw SQLite.** Migrations run through `node:sqlite` `db.exec`, and `src/core/db.ts` has a hardcoded migration list plus fallback SQL. New graph schema must be verified under `node:sqlite`, added to both places, and avoid table constraints SQLite cannot parse.
- **Prefer consistency over clever incrementality first.** Import/include resolution depends on target file rows already existing. Indexing therefore needs a file pass before graph edge extraction. For exact local dependency edges, the first implementation may rebuild the import/include edge set from all indexed files after file rows are current; optimize narrower invalidation only after tests and benchmarks prove the need.
- **Version graph extractors separately.** Bumping the whole index version is acceptable for schema/index-shape changes, but extractor-only changes should have graph metadata and graph-only backfill so unchanged files are not skipped forever.
- **Keep `pathPrefix` a query contract.** Cross-prefix edges may be stored for global consistency, but `codemap_context` and graph neighbor queries with `pathPrefix` must filter returned neighbors the same way current context tests expect.
- **Assert logical idempotency.** Tests should compare stable refs, evidence keys, and edge kinds rather than row ids or timestamps.
- **Keep public prompt surface unchanged.** Graph integration must not add tool descriptions, parameters, prompt snippets, or reason verbosity until a separate product decision accepts the token cost.
- **Budget the vertical slice.** Measure or cap the first graph-backed context path so it remains laptop-friendly: bounded neighbor counts, deterministic hub caps, no search-ranking work, and no broad heuristic edge extraction.

## Target model

### Node kinds

V1.5 has exactly one node kind:

| Kind | Stable ref | Backing source | Notes |
|---|---|---|---|
| `file` | `file:<path>` | `files.path` | Required; all initial edges are file-to-file. |

Future ideas such as `symbol`, `repo`, `dir`, `module`, `external`, and `doc_anchor` stay out of the initial schema/implementation until a measured context use case justifies them. If symbol nodes are added later, their stable refs must not depend on `start_line`; line numbers belong in location/evidence, not identity.

### Edge kinds

V1.5 has only exact local file edges:

| Edge kind | Direction | Initial source | First use |
|---|---|---|---|
| `imports` | file -> file | existing local import resolver | dependency and reverse dependency context |
| `includes` | file -> file | C/C++ quoted include resolver | header/source context |

Exact test imports are represented by the same `imports`/`includes` edges plus existing test-file detection when building context reasons. Path-based `tested_by`, `documents`, `configures`, `references`, `calls`, `contains`, `defines`, `depends_on`, and `similar_to` are future ideas, not V1.5 scope.

### Evidence fields

Every edge should retain enough evidence to be inspectable without storing full source text:

- `extractor`: e.g. `ts-import-regex`, `python-relative-import`, or `cpp-include`.
- `source_file_id`: indexed file that produced the edge, for replacement/backfill.
- `line_start` / `line_end`: optional evidence line range.
- `specifier`: import/include string when safe and useful.
- `evidence_key`: deterministic normalized key for idempotent upsert/dedupe.

Do not store snippets or raw config values in graph evidence. Store paths, import/include specifiers, and line numbers only.

## Proposed SQLite schema

Add a `003_graph.sql` migration after the first implementation test drives the exact schema. Suggested shape:

```sql
create table if not exists graph_nodes (
  id integer primary key,
  kind text not null,
  ref text not null unique,
  name text not null,
  file_id integer references files(id) on delete cascade,
  path text,
  created_at text not null,
  updated_at text not null
);

create table if not exists graph_edges (
  id integer primary key,
  from_node_id integer not null references graph_nodes(id) on delete cascade,
  to_node_id integer not null references graph_nodes(id) on delete cascade,
  kind text not null,
  source_file_id integer references files(id) on delete cascade,
  extractor text not null,
  line_start integer,
  line_end integer,
  specifier text,
  evidence_key text not null,
  created_at text not null,
  updated_at text not null,
  unique(from_node_id, to_node_id, kind, evidence_key)
);

create index if not exists graph_edges_from_kind on graph_edges(from_node_id, kind);
create index if not exists graph_edges_to_kind on graph_edges(to_node_id, kind);
create index if not exists graph_edges_source_file on graph_edges(source_file_id);
create index if not exists graph_nodes_kind_path on graph_nodes(kind, path);
```

Implementation detail: `evidence_key` is generated in TypeScript from normalized evidence fields such as extractor, source file id, edge kind, target path, specifier, and line range. Do not use `coalesce(...)` in a table-level unique constraint unless it is separately verified against the supported `node:sqlite` runtime.

Graph schema changes should also update the hardcoded migration file list and fallback SQL in `src/core/db.ts`. Store graph/extractor metadata in the existing `meta` table, for example `graph_schema_version` and `graph_extractor_version:<extractor-group>`, so extractor changes can trigger graph-only backfill without pretending all file chunks changed.

## Core module shape

Add graph logic under `src/core/` without touching Pi adapter prompts initially.

```text
src/core/local-references.ts  // reusable deterministic import/include parsing and resolution
src/core/graph-store.ts       // file-node upsert, import/include edge rebuild, graph neighbor queries
```

Keep these modules Pi-independent and injectable with `stateDir` through existing core entry points.

## Indexing integration

### Current index flow

`applyIndexUpdate` currently upserts changed files, replaces chunks, replaces symbols, removes deleted files, and writes metadata.

### Target index flow

Use a two-pass flow so edge extraction sees current target rows:

1. scan files and compute whether file/chunk/symbol content needs rewriting;
2. upsert all changed file rows;
3. replace chunks and symbols for changed files;
4. remove deleted files inside the indexed scope;
5. ensure file graph nodes;
6. if graph extractor metadata is stale, run graph-only backfill for the exact local dependency extractor;
7. rebuild exact local import/include edges from all currently indexed source files in the first implementation, then optimize invalidation later if needed;
8. insert edges only to indexed, non-skipped file nodes, with normalized evidence keys.

For deleted files, existing foreign keys should cascade graph nodes/edges. After `removeDeletedFiles`, optionally run a cheap orphan cleanup for non-file nodes such as future `dir`, `module`, or `external` nodes.

For `pathPrefix` indexing, graph storage may retain or refresh cross-prefix edges for global consistency. The hard contract is query-time: graph context queries with `pathPrefix` must filter neighbor candidates to the prefix unless the target itself explicitly resolves outside the prefix. This preserves existing monorepo behavior while avoiding stale reverse edges when a target is added or removed.

## Query and retrieval behavior

### Internal graph API

Add small core functions first:

```ts
neighborsForPath(db, path, options): GraphNeighbor[]
neighborhoodForPaths(db, paths, options): GraphNeighborhood
relatedPathsFromGraph(db, path, options): RelatedPath[]
```

Options should include:

- `direction`: `out`, `in`, or `both`;
- `kinds`: allowed edge kinds;
- `maxHops`: default `1`, cap at `2` initially;
- `limit`: small default, e.g. `12`;
- `pathPrefix` filter;
- `includeHeuristic`: default `true` for context, configurable for tests.

### `codemap_context` integration

Initial public behavior should remain the same shape: `readFirst` items with `reasons[]`. The graph should replace or supplement ad hoc relationship discovery internally.

Priority order for direct file targets:

1. target chunk;
2. direct imports/includes and implementation pairs;
3. reverse imports/includes and strong callers;
4. tests proven by imports, then path-heuristic tests;
5. docs/configs with evidence;
6. same-directory weak neighbors;
7. remaining target chunks.

Reason labels should stay compact and should not expand the Pi tool prompt surface.

### Search integration

`codemap_search` is out of V1.5 scope. Do not change search result schema, search ranking, or search query planning for graph work. Graph may influence search only in a future measured experiment after context gains are proven and search-quality gates cover graph-assisted ranking.

## Optional enrichment layer

Add this only after deterministic graph retrieval proves useful.

### Enrichment goals

- module/file summaries cached by file hash;
- architectural layer labels;
- short onboarding tours;
- semantic `similar_to` hints;
- risk/blast-radius summaries for diffs.

### Constraints

- explicit command/API only; never part of ordinary `codemap_index`;
- provider-agnostic and disabled by default;
- per-repo approval still required;
- respect `.codemapignore` and scanner exclusions;
- cache by graph/index version plus file hashes;
- store only compact annotations, not full prompts or raw model transcripts;
- failed enrichment must not corrupt deterministic graph data.

### Possible storage

```sql
create table if not exists graph_annotations (
  id integer primary key,
  node_id integer references graph_nodes(id) on delete cascade,
  kind text not null,
  value text not null,
  source text not null,
  input_hash text not null,
  created_at text not null,
  unique(node_id, kind, source, input_hash)
);
```

Do not create `codemap_enrich` or add prompt-facing tool descriptions until there is a clear first enrichment use case and token-injection budget review.

## V1.5 budget baseline

Measured on 2026-05-23 with `npm run bench:graph-budget` and `npm run bench:graph-budget:local` after the V1.5 import/include slice. The benchmark records cold index time, warm no-change index time, a forced graph-rebuild `indexRepo` pass over unchanged files, SQLite size including WAL/SHM files, graph rows, and 10 repeated `codemap_context` calls per graph-edge target. These numbers are a baseline, not a permanent gate; re-run before any symbol/docs/config/heuristic/search-ranking graph expansion. Local absolute repo rows are operator-specific spot checks, not portable release gates.

| Corpus | Files | Graph edges | DB bytes | Cold index | Warm index | Graph rebuild | Context avg | Context p95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `test/fixtures/graph-budget` | 10 | 6 | 106,496 | 24.285 ms | 12.268 ms | 12.080 ms | 19.556 ms | 26.045 ms |
| `/home/wasti/macrolens` | 106 | 27 | 2,789,376 | 126.367 ms | 21.041 ms | 32.630 ms | 29.824 ms | 49.280 ms |
| `/home/wasti/ai_stack/services/newsletter-writer` | 29 | 25 | 1,740,800 | 86.584 ms | 19.206 ms | 26.302 ms | 28.604 ms | 31.312 ms |
| `/home/wasti/dev/autoresearch` | 5 | 0 | 307,200 | 19.694 ms | 10.544 ms | 11.123 ms | 21.154 ms | 23.504 ms |

Budget decision: V1.5 remains acceptable for the measured fixture and local repos. The all-indexed-source graph rebuild cost was small relative to cold indexing in these runs, so no incremental graph invalidation work is justified yet. Keep the existing cap-and-measure posture: do not expand graph scope until a concrete context-quality gain outweighs additional index time, DB size, and context latency.

## Milestones

### Milestone 0 — Plan and baseline measurements

Deliverables:

- this plan is linked from the roadmap;
- baseline search/context quality gate still passes;
- fixture coverage identifies current context misses caused by query-time relationship rescans.

Verification:

```bash
npm run typecheck
npm test
npm run bench:search-quality:gate
npm run check:token-injection
```

### Milestone 1 — V1.5 graph imports vertical slice

Status: implemented in branch commit `0cb4355`.

Goal: deliver one user-visible context improvement without opening graph scope.

Scope:

- minimal `003_graph.sql` with file nodes and exact file-to-file edges only;
- update `src/core/db.ts` migration list and fallback SQL;
- reusable deterministic import/include parsing and resolution;
- graph-store primitives for file-node upsert, exact import/include edge rebuild, and direct/reverse neighbor queries;
- index all file nodes and exact `imports`/`includes` edges after file rows are current;
- `codemap_context` reads direct/reverse imports/includes from graph while preserving existing reason shape;
- existing test-file detection turns exact reverse test imports into test reasons; no path-based `tested_by` edge yet;
- no `codemap_search`, prompt, Pi tool schema, symbol-node, docs/config, or heuristic-edge changes.

First tests:

- legacy DB migration creates graph tables and keeps FTS behavior;
- direct local TS/JS imports, Python relative imports, and C/C++ includes are graph-backed in context;
- reverse importer lookup returns the importing file without rescanning chunks at query time;
- adding a previously missing target creates an edge from an unchanged importer after the next index;
- `pathPrefix` filters graph neighbors consistently;
- token-injection budget does not grow.

Budget checks:

- direct/reverse graph neighbor reads are capped, deterministic, and indexed;
- initial all-indexed-source dependency rebuild is accepted only as the simple correctness baseline;
- before optimizing or widening edge kinds, measure index-time and DB-size impact on fixture/local repos.

### Future milestones — gated ideas only

These are intentionally not part of V1.5 and need separate evidence before implementation:

- symbol nodes with stable identities that do not use `start_line`;
- path-based or heuristic `tested_by` edges;
- `documents` and `configures` edges;
- neighborhood/impact APIs;
- graph-assisted `codemap_search` ranking;
- optional enrichment/annotations.

## Acceptance criteria for the overall project

- Normal `codemap_index` remains local, deterministic, and laptop-friendly.
- No new always-on process, remote dependency, model download, or browser runtime.
- Existing public tools keep compact schemas unless a separate product decision changes them.
- `codemap_context` returns graph-backed read-first neighbors for exact imports, reverse imports, includes, and exact test imports.
- Graph tables rebuild correctly from indexed content and are safe to delete/recreate.
- `pathPrefix`, repo approval, stale warnings, ignore policy, binary/secret skips, and size limits continue to apply.
- Token-injection budget checks do not regress.
- Search-quality gates cover graph-backed context before ranking uses graph signals.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Graph schema overfits early use cases | Start with file nodes and exact import/include edges only; move every other node/edge kind behind a separate measured decision. |
| Incremental updates leave stale edges | Use two-pass indexing, graph/extractor version metadata, cascade deletes, and initially rebuild exact local dependency edges from all indexed sources after file rows are current. Optimize narrower invalidation only after tests cover target add/delete/rename cases. |
| Heuristic edges create noisy context | Do not implement heuristic edges in V1.5; add them later only behind separate gates and caps. |
| Public API bloat | Keep graph internal until behavior proves useful; do not add prompt-facing fields early. |
| Large hub files dominate context | Per-kind and total limits; stable ordering; noise penalties. |
| Optional enrichment becomes mandatory by accident | Keep enrichment in separate tables/commands; deterministic graph must pass all tests alone. |
| Secret/config leakage | Reuse scanner exclusions; store paths/specifiers only. |
| Performance regression | Benchmark indexing time and context query time on fixture repos; keep graph context 1-hop and indexed. |

## Open questions

1. What larger portable fixture should become the first CI budget guard for all-source dependency rebuilds, beyond the current local spot-check baseline?
2. After exact import-backed tests work, is a path-based `tested_by` edge worth a separate noisy-heuristic gate?
3. Should graph-backed impact analysis become a new core API only, or eventually a fifth Pi tool/command?

## Implemented first slice

The V1.5 vertical slice intentionally delivered user-visible `codemap_context` value instead of a substrate-only graph:

- minimal file-node/file-edge schema;
- exact local import/include edges persisted during indexing;
- direct and reverse context neighbors queried from the graph;
- reverse-import context coverage without query-time chunk rescanning;
- no search, public tool, prompt text, symbol-node, docs/config, or heuristic-edge changes.

Future slices should stay similarly small and measured.
