# TODO

Active offene Arbeit für `pi-ext-codemap`. Abgehakte Punkte werden hier gelöscht; release-relevante Historie steht im [`CHANGELOG.md`](CHANGELOG.md). Produkt-/Architekturkontext steht in [`docs/product/roadmap.md`](docs/product/roadmap.md#future-work) und [`docs/developer/architecture.md`](docs/developer/architecture.md).

## Active tactical backlog — reviewed order

1. [ ] Typische Query-Klassen als vertikale TDD-Slices abdecken.
   - Scope: je ein repräsentativer öffentlicher Navigationsfall für Symbol, Pfad, Fehlermeldung, Endpoint/Route, Config-Key und noisy query.
   - Progress: Endpoint/Route, Config-Key und Fehlermeldung sind über öffentliche Search/Context-Fixtures plus checked-in Search-Quality-Fixture abgedeckt.
   - Test: pro Query-Klasse ein Fixture + öffentlicher Test für Top-Ergebnis und optionales Context-Paket.
   - Stop: keine neue Retrieval-Schicht ohne konkreten roten Navigationsfall.

2. [ ] DB-/Migration-Schema-Tests ergänzen.
   - Scope: Migrationen/SQLite-Schema, Index-Versionierung und bestehende DB-Aktualisierung.
   - Test: simulierte Vorversion/alte Test-DB wird über öffentliche Index-/Search-Pfade geöffnet; Version steigt, Index/Search funktionieren ohne Datenverlust/Crash.

3. [ ] Fehlgeschlagene Natural-Language-Benchmark-Cases als konkrete Regressionen bearbeiten.
   - Scope: pro rotem Case Top-5-Treffer, erwartete Pfade, Query, Ranking-Diagnostics, Noise-Hits und Miss-Klasse analysieren.
   - Entscheidung je Case: Ranking/Query-Plan/File-Rollen verbessern, Ground Truth korrigieren oder Case als ungeeignet entfernen.
   - Test: maschinenlesbarer Regressionstest oder Benchmark-Case; keine Benchmark-Erleichterung nach Ergebnislage.

4. [ ] Thin CLI Adapter über `src/core/` ergänzen.
   - Scope: kleiner CLI-Adapter, zuerst `status --json` und maximal ein Such-/Context-Befehl.
   - Test: CLI-Integration nutzt temp `stateDir`, dupliziert keine State-Logik und gibt stabiles JSON aus.

## Parked / später

5. [ ] Refresh-Automation als expliziten Command oder Hook entscheiden.
   - Scope: kurze ADR/Doc-Entscheidung plus kleinster Implementierungs-Slice.
   - Test: gewählter Command/Hook respektiert Approval, `pathPrefix` und stale-index Warnungen.

6. [ ] Später: Autoresearch als Parameter-Tuning-Schleife prüfen.
   - Voraussetzungen: stabile maschinenlesbare Metriken, feste Trainings-/Validierungs-Cases, Holdout-Guardrails und keine Optimierung nur auf ein privates lokales Repo.
   - Kandidaten: File-Rollen-Boosts, Noise-Penalties, Symbol-/Path-/Filename-/FTS-Gewichte, Token-Coverage-Bonus, Intent-Heuristiken, Context-Nachbarschaftsbudget.
