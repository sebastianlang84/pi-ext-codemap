# TODO

## Backlog

Priorisierte Details stehen in [`docs/roadmap.md`](docs/roadmap.md#prioritized-next-steps). Arbeitsregel: Vor jedem Punkt kurz Scope, Benefit und ersten TDD-Test klären; ohne klaren Benefit wird der Punkt gestrichen oder vertagt.

Aktuell kein offener taktischer Backlog. Nächster Kandidat nur bei konkretem Bedarf: repo-lokale Search-Quality-Cases aus einer kleinen Config-Datei statt hart codierter lokaler Repos.

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
6. [x] Ranking-/Explain-Guardrails hinzufügen.
   - Entscheidung: kein eigenes Explain-Feature; User/API-Surface bleibt schlank, Guardrails laufen über Search-Quality-Gates.
7. [x] Search-Quality-Gates erweitern.
   - Benefit: echte Regressionen bei Entry-Points, Tests/Docs und Lockfile-/Generated-Noise fallen früh auf.
   - Test: `bench:search-quality:gate` enthält neue repräsentative Fälle und excluded-noise Checks.

## V1.5 Context-Locality-Slices

- [x] Direkte lokale Imports in `codemapContext` Read-first-Pakete aufnehmen.
  - Benefit: Agenten lesen echte direkte Abhängigkeiten vor rein namensähnlichen Tests/Docs.
  - Test: Target importiert `./db` und `./validation`; `readFirst` liefert Target, beide Imports, keine externen Packages.
- [x] Reverse-Imports/Caller in `codemapContext` Read-first-Pakete aufnehmen.
  - Benefit: Beim Ändern eines kleinen Moduls erscheinen lokale Call-sites/Tests, die das Modul importieren.
  - Test: `validation.ts` wird von `user-service.ts` und `tools.ts` importiert; `readFirst` liefert Target plus beide Importer.

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
