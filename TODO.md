# TODO

## Active tactical backlog

Quelle: [`docs/product/roadmap.md`](docs/product/roadmap.md#future-work). Arbeitsregel: Erst **A) mehr aus dem bestehenden leichten CodeMap herausholen**; **B) neue Fähigkeiten** bleiben in der Roadmap, bis ein konkreter Bedarf belegt ist. CodeMap bleibt primär Agent-Navigationswerkzeug: Einstiegspunkt + Nachbarn + Gründe, nicht allgemeines Code-Retrieval-System.

1. [ ] File-Rollen und Noise-Penalty-System härten.
   - Score: Lightweight 5/5, Nützlichkeit 5/5, Attraktivität 5/5.
   - Scope: Dateien rollenbasiert klassifizieren: Source/Config/Docs/Tests sind nützlich; Lockfiles werden indexiert, aber selten Top-Treffer; generated/build/vendor/minified/large-json werden stark de-priorisiert oder aus Read-first-Kontext ferngehalten.
   - Benefit: Zero-config Repos profitieren sofort; weniger Kontextmüll verbessert Suche, Ranking und `codemapContext`, ohne semantische Annahmen.
   - Test: Fixture mit `src/index.ts`, `package.json`, Lockfile, `dist/`, generated Datei, minified Bundle, großem JSON und Testdatei rankt Source/Config/Test sinnvoll vor Noise; Lockfile steigt nur bei explizitem Lockfile-Match.
   - Progress: erste TDD-Slices umgesetzt: Lockfiles werden indexiert, aber aus normalen Top-Ergebnissen gefiltert; explizite Lockfile-Queries finden sie weiterhin. Ranking kennt Rollen/Penalties für Lockfile, generated, build output und minified. `codemapContext` hält noisy Lockfile-/Generated-/Build-/Minified-Nachbarn aus Read-first heraus; echte Tests/Docs bleiben nützlicher Kontext, während direkte noisy Targets lesbar bleiben.
2. [ ] Interne Ranking-Diagnostics ergänzen, ohne API-Explain-Feld.
   - Score: Lightweight 4/5, Nützlichkeit 5/5, Attraktivität 5/5.
   - Scope: Tests/Benchmarks und Debug-Ausgaben bekommen eine Score-Zerlegung: `final_score`, `path_score`, `filename_score`, `symbol_score`, `fts_score`/BM25, `exact_phrase_bonus`, `token_coverage`, Rollen-/Kontext-Boni, `noise_penalty`, `generated_penalty`, `size_penalty`, optional `stale_index_penalty`.
   - Benefit: Bei beliebigen Repos wird sichtbar, warum ein Treffer da ist, warum er nicht höher ist und welche Query-Tokens getroffen wurden; dadurch werden Verbesserungen zielgerichtet.
   - Test: Ein Diagnosepfad zeigt path/symbol/FTS/penalty/context-Signale und gematchte Tokens, während `codemap_search` keine Explain-Felder ausgibt.
   - Progress: erster interner Helper `scoreSearchRow()` zerlegt Treffer in `finalScore`, Retrieval-/FTS-/Path-/Filename-/Symbol-/Coverage-Scores, Rollenboosts, Test-/Doc-/Noise-Penalties und gematchte Tokens; Public SearchResult bleibt ohne Explain-Felder.
3. [ ] `codemapContext` mit Herkunftsgründen ausgeben/intern absichern.
   - Score: Lightweight 4/5, Nützlichkeit 5/5, Attraktivität 4/5.
   - Scope: Read-first Items bekommen intern/testseitig Gründe wie `direct_hit`, `import`, `reverse_import`, `sibling_test`, `near_config`, `same_dir`; Tests sind keine Noise-Klasse, sondern eigene Rolle (`test_of`, `sibling_test`, `reverse_test`).
   - Benefit: CodeMap wird stärker als Agent-Navigationswerkzeug: nicht nur Trefferliste, sondern lesbarer Einstiegspunkt plus Nachbarn plus nachvollziehbarer Grund.
   - Test: Fixture mit Modul, Caller, Test, naher Config und Rauschdatei liefert Target + echte Beziehungen stabil vor Rauschen und erklärt die Herkunft der Context-Items.
4. [ ] Stale-Status präzisieren: Git HEAD, indexed HEAD, dirty files, last index time.
   - Score: Lightweight 4/5, Nützlichkeit 4/5, Attraktivität 4/5.
   - Scope: Status/Health kann unterscheiden zwischen aktuellem Git-HEAD, indexiertem HEAD, Dirty Working Tree und letztem Indexzeitpunkt; keine automatische Hintergrundaktualisierung.
   - Benefit: Agenten wissen besser, ob Suchergebnisse vertrauenswürdig sind, ohne dass CodeMap zum Daemon wird.
   - Test: Temp-Git-Repo zeigt clean indexed, new commit, dirty file und stale Index jeweils unterscheidbar im Status.
5. [ ] Typische Query-Klassen als robuste Tests abdecken.
   - Score: Lightweight 4/5, Nützlichkeit 4/5, Attraktivität 3/5.
   - Scope: Repräsentative Fixtures für Symbol, Pfad, Fehlermeldung, Endpoint/Route, Config-Key und noisy query; keine repo-lokale kuratierte Benchmark-Datei.
   - Benefit: Verbesserungen bleiben auf agentische Navigationsfälle ausgerichtet statt auf abstrakte Retrieval-Metriken.
   - Test: Eine Fixture-Suite prüft Top-Ergebnisse und Context-Pakete pro Query-Klasse.
6. [ ] Refresh-Automation als expliziten Command oder Hook entscheiden.
   - Score: Lightweight 4/5, Nützlichkeit 3/5, Attraktivität 3/5.
   - Scope: Kurze ADR/Doc-Entscheidung plus kleinster Implementierungs-Slice; kein Daemon/Background-Crawling als Default.
   - Benefit: Nutzer bekommen einen sicheren Refresh-Workflow, ohne Agent-Loops schwerer zu machen.
   - Test: Command/Hook respektiert Approval, `pathPrefix` und stale-index Warnungen.
7. [ ] Thin CLI adapter über `src/core/` ergänzen.
   - Score: Lightweight 3/5, Nützlichkeit 3/5, Attraktivität 3/5.
   - Scope: Kleiner `src/cli/`-Adapter, zuerst `status --json` und maximal ein Such-/Context-Befehl.
   - Benefit: CodeMap ist außerhalb der Pi-Extension nutzbar und die Core/Adapter-Grenze wird geprüft; verbessert nicht direkt Search-Qualität.
   - Test: CLI-Integration nutzt temp `stateDir`, dupliziert keine State-Logik und gibt stabiles JSON aus.

Weitere Zukunfts- und Parkthemen stehen in [`docs/product/roadmap.md`](docs/product/roadmap.md#future-work). Abgeschlossene Lieferungshistorie steht ebenfalls dort, nicht im TODO.
