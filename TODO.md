# TODO

Aktive offene Arbeit für CodeMap. Erledigte Arbeit gehört in den [`CHANGELOG.md`](CHANGELOG.md), Eval-Befunde in die passenden Dokumente unter [`docs/developer/`](docs/developer/), Produkt-/Architekturkontext in [`docs/product/roadmap.md`](docs/product/roadmap.md#future-work) und [`docs/developer/architecture.md`](docs/developer/architecture.md).

## Nächster Slice

1. [ ] Macro-Signal-Entry-Ranking nur als separaten gemessenen Slice angehen.
   - Der Real-Repo-Gate ist seit dem sichtbaren Search-Evidence-Schutz wieder grün (`6` Wins, `0` Losses, `18` Ties). Beim Macrolens-Threshold-Fall bleibt `macro-signal-rules.ts` aber außerhalb der Search-Top-5; der Readplan bewahrt nur den bereits sichtbaren `macro-derivations.test.ts`.
   - Vor einer Ranking-Änderung einen deterministischen Fixture-Case für schwache Symbol-Hits gegen textlich besser gedeckte Source-Chunks hinzufügen. Danach genau eine Coverage-/Ranking-Komponente ändern.
   - Keep-Regel: besserer Entry-Hit ohne Regression in `bench:search-quality:gate`, `eval:agent-navigation:gate` oder `eval:real-repo-navigation:gate`; keine Query-/Threshold-Anpassung als Ersatz.

2. [ ] Weitere Konventions-/Targeting-Slices nur bei einem neuen konkreten Eval-Miss auswählen.
   - Kandidaten: UI↔API, Provider/Hook↔Consumer, Config-Key↔Nutzung und ADR-Nachbarn.
   - Pro Konvention ein Fixture oder Real-Repo-Case und eine eigene Metrik; keine breite Heuristik ohne messbaren Context-Gewinn.

## Opportunistisch oder gated

- [ ] Test-/Eval-Script-Deepening nur bei erneutem Doppel-Touch fortführen.
  - Gemeinsame Gate-Report-/CLI-Parser-Helfer erst extrahieren, wenn beide Navigation-Skripte erneut geändert werden.
  - Inline Eval-Cases nur dann in Datenmodule verschieben, wenn dadurch Logik- und Corpus-Diffs tatsächlich klarer werden.
  - Bestehende Core-Helfer und die bereits getrennten Search-/Navigation-Suites wiederverwenden; keine Pi/TUI-Adapterdetails in Core-Tests ziehen.

- [ ] Workspace-/Multi-Config-Pfadalias nur bei einem konkreten Miss angehen.
  - Minimaler `tsconfig.json`-/`jsconfig.json`-`baseUrl`- und `paths`-Support existiert; komplexe `extends`-Ketten, Workspace-Aliasse und Budget-Ordering bei vielen Alias-Imports bleiben bewusst offen.

- [ ] Strukturiertes C/C++-Chunking nur mit sprachspezifischem Scanner und Fixture-Beleg prüfen.
  - Symbole und kanonische `c`-/`cpp`-Tags sind umgesetzt. Fixed-Window-Chunking bleibt, weil der JS/TS-Brace-Scanner bei C-`/`-Division fehlzünden kann.
  - Anonyme `typedef struct { … } Name;` und Makros nur bei einem konkreten Miss ergänzen.

- [ ] Graphify-inspirierte öffentliche Tools nur nach wiederholtem Agent-Nutzen und Budgetentscheidung erwägen.
  - Interne Neighborhood-/Path-Diagnostics und `npm run report:architecture` existieren bereits.
  - `codemap_explain`, `codemap_path`, Symbol-Level-Reports oder breites Architektur-Ranking brauchen jeweils einen festen failing Eval-Case, Produktentscheidung und `npm run check:token-injection`.

- [ ] Review-Cleanup ohne Produktverhalten nur bei einem konkreten Review-Befund durchführen.
  - `codemap_context` und das Gesamtbudget liegen nahe am Token-Gate; neue Parameter, Guidelines oder öffentliche Tools brauchen eine explizite Budgetentscheidung.

## Produktentscheidungen / später

- [ ] npm-Registry-Veröffentlichung erst bei konkretem Nutzerbedarf entscheiden; bis dahin bleibt `npm install -g github:sebastianlang84/codemap` kanonisch.
- [ ] Native MCP-`roots`-Auflösung erst bei einem belegten Host-Miss ergänzen; `repoPath` bleibt der Fallback für Hosts mit falschem Prozess-cwd.
- [ ] Einen separaten Semantic-Benchmark-Track vor optionalen Embeddings/Rerankern definieren; Qualität, Latenz, RAM, Indexgröße und False Positives gegen feste Holdouts messen.
- [ ] Autoresearch erst mit stabilen maschinenlesbaren Metriken, getrennten Trainings-/Validierungs-Cases und festen Holdout-Guardrails einsetzen.
- [ ] Refresh-Automation erst wieder aufnehmen, wenn breitere Agent-Evals oder Praxisfälle zeigen, dass Agenten bestehende stale Warnungen übersehen.
