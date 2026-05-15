# TODO

## Backlog

Priorisierte Details stehen in [`docs/roadmap.md`](docs/roadmap.md#prioritized-next-steps). Arbeitsregel: Vor jedem Punkt kurz Scope, Benefit und ersten TDD-Test klären; ohne klaren Benefit wird der Punkt gestrichen oder vertagt.

1. [x] Nicht-indexierte Repos neutral anzeigen.
   - Benefit: Nutzer/Agenten sehen „noch nicht bereit“ statt falschem Erfolg/Fehler.
   - Test: unapproved/unindexed Repo liefert neutralen Session-Status.
2. [x] `cwd`/`stateDir` als Core-Seam absichern.
   - Benefit: Core bleibt testbar und künftige CLI/Adapter müssen keine State-Logik duplizieren.
   - Test: temp `stateDir` isoliert Registry und Index-DBs.
3. [x] Prompt-Surface der Adapter kürzen.
   - Benefit: weniger Kontext-Bloat bei gleicher Tool-Führung.
   - Test: registrierte Snippets/Guidelines bleiben vollständig, aber unter Budget.
4. [x] `codemapContext` Locality verbessern.
   - Benefit: bessere Read-first-Pakete mit passenden Tests/Docs, weniger manuelles Suchen.
   - Test: nested Fixture liefert Ziel, sibling Tests/Docs und respektiert `pathPrefix`.
5. [x] Chunking für Markdown/Fences und Code-Struktur verbessern.
   - Benefit: stabilere, lesbarere Snippets mit besseren Line-Ranges.
   - Test: fenced code wird nicht gesplittet; Funktions-/Klassenbereiche bleiben stabil.
6. [ ] Ranking-/Explain-Guardrails hinzufügen.
   - Benefit: Ranking-Änderungen werden nachvollziehbar, bevor schwerere Suche gebaut wird.
   - Test: Top-Ergebnisse erklären Path/Symbol/FTS/Doc/Test-Signale.
7. [ ] Search-Quality-Gates erweitern.
   - Benefit: echte Regressionen bei Entry-Points, Tests/Docs und Lockfile-Noise fallen früh auf.
   - Test: `bench:search-quality:gate` enthält neue repräsentative Fälle.

## Review-Funde vom TDD-Review

- [x] `src/core/index-health.ts`: `pathPrefix` in SQL-`LIKE` literal escapen (`ESCAPE '\\'`), damit `_`/`%` in echten Verzeichnisnamen nicht als Wildcards zählen. TDD-Slice: Repo mit `services/api_v1/` und `services/apiXv1/`; `status(..., { pathPrefix: "services/api_v1" })` darf nur exakt `api_v1` zählen.
- [x] `src/core/scanner.ts`: `pathPrefix` mit internen `..`-Segmenten rejecten oder kanonisch normalisieren. TDD-Slice: `src/../docs` muss konsistent als ungültig gewarnt oder zu `docs/` normalisiert werden, damit Scan, DB-Filter, Suche, Status und Deletion nicht auseinanderlaufen.

## Erledigt

Alle Architektur-Vertiefungen aus dieser Liste wurden umgesetzt.

- [x] Unified CodeMap operation surface (`src/pi-extension/operations.ts` als Katalog; `tools.ts`/`commands.ts` als Adapter)
- [x] Index health as its own deeper Module (`src/core/index-health.ts`)
- [x] Search retrieval pipeline (`src/core/search-pipeline.ts`)
- [x] Index update ownership (`src/core/index-store.ts` owns version/force-reindex/update metadata)
- [x] Repository scan policy (`src/core/scan-policy.ts`)
