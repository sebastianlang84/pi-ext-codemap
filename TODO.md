# TODO

Active offene Arbeit für `pi-ext-codemap`. Abgehakte Punkte werden hier gelöscht; release-relevante Historie steht im [`CHANGELOG.md`](CHANGELOG.md). Produkt-/Architekturkontext steht in [`docs/product/roadmap.md`](docs/product/roadmap.md#future-work) und [`docs/developer/architecture.md`](docs/developer/architecture.md).

## Active tactical backlog — reviewed order

Der nächste vorgeschlagene Slice steht unten. Der V1.5 Relationship-Graph ist implementiert; Budget- und Context-Quality-Baselines sind in [`docs/developer/relationship-graph-plan.md`](docs/developer/relationship-graph-plan.md#v15-budget-baseline) / [`Context-Quality-Gate`](docs/developer/relationship-graph-plan.md#v15-context-quality-gate) dokumentiert. Weiterer Graph-Ausbau bleibt gated: kein Symbol-/Docs-/Config-/Heuristik-/Search-Ranking-Ausbau ohne klaren Context-Gewinn und neue Budget-Entscheidung.

Refresh-Automation bleibt nach dem Agent-Refresh-Eval bewusst zurückgestellt; siehe [`docs/developer/agent-refresh-eval.md`](docs/developer/agent-refresh-eval.md#current-finding). Deterministische Navigation-Evals gegen Baselines sind in [`docs/developer/agent-navigation-eval.md`](docs/developer/agent-navigation-eval.md) und [`docs/developer/real-repo-navigation-eval.md`](docs/developer/real-repo-navigation-eval.md) dokumentiert. Ein zusätzlicher Live-LLM-Navigation-Eval ist noch nicht als aktiver Slice ausgewählt.

## Eval-discovered gaps / Verbesserungspotential

Diese Lücken sind bewusst festgehalten: Evals sollen nicht nur bestehen, sondern Misses sichtbar machen und daraus gezielte Verbesserungs-Slices ableiten. Die eigentlichen To-do-Checkboxen stehen im nächsten Abschnitt, damit die Backlog-Liste nicht doppelt gezählt wird.

- **TypeScript-Pfadaliasse — Restgrenzen**: Minimaler `tsconfig.json` / `jsconfig.json` `baseUrl` + `paths`-Support ist umgesetzt; offen bleiben komplexe `extends`-Ketten, Workspace-Aliasse und Budget-Ordering bei vielen Alias-Imports.
- **Framework-/Konventions-Nachbarn**: relevante Dateien sind teils nicht über direkte Imports verbunden, sondern über Namens-/Framework-Konventionen, z. B. UI-zu-API, Route-Handler, Provider oder Config-Dateien. Source→Test-Budget-Ordering, ein importierter Source→Test-Nachbar, source-first Implementation-Targeting, TypeScript-`.js`-Specifier-Auflösung, stem-affine Reverse-Importer, Search-Hit-Preservation im Eval-Readplan, direkter Import im Eval-Readplan ohne konkurrierende Docs/Configs oder unsearched Tests/Configs, Tests für sichtbare importierte Nachbarn, Root-README-Fallback ohne spezifische Doc-Treffer, Provider-Rollen/Reverse-Importer-Tests, handoff-preload Scope/ADR-Pfade, reviewer-context-scout Benchmark-Fixtures, Docker-Compose-Deployment-Kontext, Next.js-API-Route-Adapter als Reverse-Importer und endpoint-nahe Route-Adapter-Kandidaten mit importiertem Source/Test-Budget sind als kleine Verticals geschützt; weitere Konventionen brauchen eigene Eval-/Fixture-Belege. Der aktuelle `codemap_search_context`-Run bleibt im Baseline-Cohort voll grün; der 16er Natural-Holdout zeigt weiter gezielte Konventions-/Targeting-Misses.
- **Natürlichere Bug-/Änderungsanfragen — Restgrenzen**: Real-Repo-Eval enthält jetzt 16 Natural-Language-Holdout-Cases ohne exakte Funktions-/Klassen-Symbolnamen. Der Satz ist weiter lokal und teils gepaart. `sg`-Binary-Target-Mismatch durch `AGENTS.md`, Workbench-Session-Entry-Miss, Workbench-Chart-Test-Budget, `sg`-Binary-README-Budget, Macrolens-Provider-Source/Test-Budget, Macrolens-Newsletter-Endpoint-Route-Adapter, Macrolens-Catalog-Endpoint-Route/Source/Test, pi-ext-memory Handoff-Code↔ADR, pi-ext-subagents Reviewer-Scout-Docs↔Benchmark, Alpha-Cycles FastAPI↔Compose-Kontext und ein archivierter-Plan-Noise-Read sind behoben; sichtbare Restgrenzen sind Macro-Signal-Threshold-Source-Targeting, Audit-ADR-Nachbarn, Repo-Agent-Trust-Source-Targeting und ast-grep-Truncation-Formatter/Test-Nachbarn.
- **False positives / verbotene Reads**: lexical liest im Real-Repo-Gate häufiger verbotene/noisy Dateien; CodeMap vermeidet sie aktuell, aber neue Heuristiken können Noise zurückbringen.

## Nächste sinnvolle Slices — vorgeschlagene Reihenfolge

1. [ ] Internen Ranking-/Context-Debug-Report für Eval-Misses ergänzen.
   - Scope: nur Bench-/Eval-/Testpfad; Score-Komponenten, ausgewählte/verworfene Search-Hits, Context-Target, `readFirst`-Reasons und Read-Plan-Budget sichtbar machen.
   - Nutzen: Ranking-/Context-Änderungen werden nachvollziehbar, ohne `codemap_search`-Resultate aufzublähen.
   - Verifikation: gezielte Tests/Bench-Ausgabe zeigen die erwarteten Komponenten; Public `SearchResult` bleibt kompakt.

2. [ ] Nächsten Expanded-Natural-Holdout-Fix-Slice nur bei neuem konkretem Miss auswählen.
   - Aktueller Release-Stand: Baseline und Natural-Holdout waren vor `0.5.3` voll grün; alte Miss-Listen nicht als aktive Defekte behandeln.
   - Regel: erst Diagnose/öffentlicher Regressionstest, dann maximal ein Hebel; keine Query-/Threshold-Änderung als Ersatz für Systemverbesserung.

3. [ ] Weitere Konventions-Nachbarn als kleine, getrennte Verticals testen.
   - Erledigt: Route↔Handler ist als enge Next.js-Route-Adapter-zu-`*handler*`-Quelle plus Handler-Test-Fixture umgesetzt.
   - Nächste Kandidaten: UI↔API, Provider/Hook↔Consumer, Config-Key↔Nutzung; Source↔Test nur wieder anfassen, wenn ein neuer Eval-Miss nicht durch Entry/Search-Ranking verursacht ist.
   - Regel: pro Konvention ein Fixture/Real-Repo-Case, eigene Metrik, keine breite Heuristik ohne messbaren Gewinn.

4. [ ] Workspace-/Multi-Config-Pfadalias nur als gated Slice angehen.
   - Scope: erst bei konkretem Miss mit `tsconfig`/`jsconfig` `extends`, Workspace-Alias oder vielen Alias-Imports; dann minimalen Resolver/Ordering-Fix bauen.
   - Nutzen: TS/JS-Alias-Restgrenzen bleiben sichtbar, ohne Resolver-Komplexität auf Vorrat einzubauen.
   - Verifikation: ein Fixture oder Real-Repo-Case belegt den Miss und die Verbesserung; keine breite Alias-Heuristik ohne Qualitätsgewinn.

## Parked / später

1. [ ] Thin CLI Adapter über `src/core/` ergänzen.
   - Scope: kleiner CLI-Adapter, zuerst `status --json` und maximal ein Such-/Context-Befehl.
   - Test: CLI-Integration nutzt temp `stateDir`, dupliziert keine State-Logik und gibt stabiles JSON aus.

2. [ ] Später: Autoresearch als Parameter-Tuning-Schleife prüfen.
   - Voraussetzungen: stabile maschinenlesbare Metriken, feste Trainings-/Validierungs-Cases, Holdout-Guardrails und keine Optimierung nur auf ein privates lokales Repo.
   - Kandidaten: File-Rollen-Boosts, Noise-Penalties, Symbol-/Path-/Filename-/FTS-Gewichte, Token-Coverage-Bonus, Intent-Heuristiken, Context-Nachbarschaftsbudget.

3. [ ] Separaten Semantic-Benchmark-Track vorbereiten, bevor Semantik implementiert wird.
   - Scope: Eval-Gerüst/Profil für optionale Embeddings/Reranker mit Qualität, Latenz, RAM, Indexgröße und False-Positive-Metriken; kein Default-Embedding und keine Produktzusage.
   - Nutzen: Semantik bleibt messbar und opt-in statt ein schwerer Default-Pfad zu werden.
   - Verifikation: Standalone-Report vergleicht Varianten gegen feste Cases; bestehende lexikalische Gates bleiben unverändert.

4. [ ] Refresh-Automation nur bei breiterem Eval-/Praxisbedarf wieder aufnehmen.
   - Befund: Agent-Refresh-Eval mit `openai-codex/gpt-5.4-mini`, Baseline + Hint je 3 Runs, bestand 6/6; Agent sah stale Signale, rief `codemap_index`, suchte erneut und nannte `src/calculator.ts`.
   - Entscheidung: LLM-gesteuertes Refresh über bestehende stale Warnungen genügt vorerst; kein Command/Hook als nächster Slice.
   - Wieder aufnehmen, wenn breitere Modelle/Runs scheitern oder Praxis zeigt, dass Agenten stale Warnungen übersehen.
