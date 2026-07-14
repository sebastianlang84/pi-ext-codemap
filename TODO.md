# TODO

Active offene Arbeit für CodeMap. Abgehakte Punkte werden hier gelöscht; release-relevante Historie steht im [`CHANGELOG.md`](CHANGELOG.md). Produkt-/Architekturkontext steht in [`docs/product/roadmap.md`](docs/product/roadmap.md#future-work) und [`docs/developer/architecture.md`](docs/developer/architecture.md).

## Active tactical backlog — reviewed order

Der nächste vorgeschlagene Slice steht unten. Der V1.5 Relationship-Graph ist implementiert; Budget- und Context-Quality-Baselines sind in [`docs/developer/relationship-graph-plan.md`](docs/developer/relationship-graph-plan.md#v15-budget-baseline) / [`Context-Quality-Gate`](docs/developer/relationship-graph-plan.md#v15-context-quality-gate) dokumentiert. Graph-Rebuild/Legacy-Relationship-Lookups rekonstruieren Indexed-Source-Text overlap-sicher aus Chunk-Line-Ranges, damit Import-/Include-Line-Evidence stabil bleibt. Weiterer Graph-Ausbau bleibt gated: kein Symbol-/Docs-/Config-/Heuristik-/Search-Ranking-Ausbau ohne klaren Context-Gewinn und neue Budget-Entscheidung.

Refresh-Automation bleibt nach dem Agent-Refresh-Eval bewusst zurückgestellt; siehe [`docs/developer/agent-refresh-eval.md`](docs/developer/agent-refresh-eval.md#current-finding). Deterministische Navigation-Evals gegen Baselines sind in [`docs/developer/agent-navigation-eval.md`](docs/developer/agent-navigation-eval.md) und [`docs/developer/real-repo-navigation-eval.md`](docs/developer/real-repo-navigation-eval.md) dokumentiert. Ein zusätzlicher Live-LLM-Navigation-Eval ist noch nicht als aktiver Slice ausgewählt.

## Eval-discovered gaps / Verbesserungspotential

Diese Lücken sind bewusst festgehalten: Evals sollen nicht nur bestehen, sondern Misses sichtbar machen und daraus gezielte Verbesserungs-Slices ableiten. Die eigentlichen To-do-Checkboxen stehen im nächsten Abschnitt, damit die Backlog-Liste nicht doppelt gezählt wird.

- **TypeScript-Pfadaliasse — Restgrenzen**: Minimaler `tsconfig.json` / `jsconfig.json` `baseUrl` + `paths`-Support ist umgesetzt; offen bleiben komplexe `extends`-Ketten, Workspace-Aliasse und Budget-Ordering bei vielen Alias-Imports.
- **Framework-/Konventions-Nachbarn**: relevante Dateien sind teils nicht über direkte Imports verbunden, sondern über Namens-/Framework-Konventionen, z. B. UI-zu-API, Route-Handler, Provider oder Config-Dateien. Source→Test-Budget-Ordering, ein importierter Source→Test-Nachbar, source-first Implementation-Targeting, TypeScript-`.js`-Specifier-Auflösung, stem-affine Reverse-Importer, Search-Hit-Preservation im Eval-Readplan, direkter Import im Eval-Readplan ohne konkurrierende Docs/Configs oder unsearched Tests/Configs, Tests für sichtbare importierte Nachbarn, Root-README-Fallback ohne spezifische Doc-Treffer, Provider-Rollen/Reverse-Importer-Tests, handoff-preload Scope/ADR-Pfade, reviewer-context-scout Benchmark-Fixtures, Docker-Compose-Deployment-Kontext, Next.js-API-Route-Adapter als Reverse-Importer und endpoint-nahe Route-Adapter-Kandidaten mit importiertem Source/Test-Budget sind als kleine Verticals geschützt; weitere Konventionen brauchen eigene Eval-/Fixture-Belege. Der aktuelle `codemap_search_context`-Run bleibt im Baseline-Cohort voll grün; der 16er Natural-Holdout zeigt weiter gezielte Konventions-/Targeting-Misses.
- **Natürlichere Bug-/Änderungsanfragen — Restgrenzen**: Real-Repo-Eval enthält jetzt 16 Natural-Language-Holdout-Cases ohne exakte Funktions-/Klassen-Symbolnamen. Der Satz ist weiter lokal und teils gepaart. `sg`-Binary-Target-Mismatch durch `AGENTS.md`, Workbench-Session-Entry-Miss, Workbench-Chart-Test-Budget, `sg`-Binary-README-Budget, Macrolens-Provider-Source/Test-Budget, Macrolens-Newsletter-Endpoint-Route-Adapter, Macrolens-Catalog-Endpoint-Route/Source/Test, pi-ext-memory Handoff-Code↔ADR, pi-ext-subagents Reviewer-Scout-Docs↔Benchmark, Alpha-Cycles FastAPI↔Compose-Kontext und ein archivierter-Plan-Noise-Read sind behoben; sichtbare Restgrenzen sind Macro-Signal-Threshold-Source-Targeting, Audit-ADR-Nachbarn, Repo-Agent-Trust-Source-Targeting und ast-grep-Truncation-Formatter/Test-Nachbarn.
- **False positives / verbotene Reads**: lexical liest im Real-Repo-Gate häufiger verbotene/noisy Dateien; CodeMap vermeidet sie aktuell, aber neue Heuristiken können Noise zurückbringen.
- **Doc-Flood-Ranking-Fix gelandet (2026-07-14, ADR [`docs/adr/20260714-search-code-vs-doc-target.md`](docs/adr/20260714-search-code-vs-doc-target.md)):** konzeptuelle/UI-Queries lieferten READMEs statt Code (Phantom-FTS-Credit + `overview`-Rollenwort-Kollision + Code komplett aus dem Kandidaten-Pool gedrängt). Behoben via Phantom-FTS-Entfernung, doc-evidence-gated `overview`-Intent, additiver Code-Quota + doc-intent-gated Code-Lift (keine Doc-Abwertung). Neues `doc-flood`-Fixture + Ranking-Unit-Tests.
  - **Auf dieser Maschine NICHT lauffähig — vor Merge auf einer Maschine mit vollständigen Cohorts grün fahren (Teilmengen sind laut §6 unzulässig):**
    1. [ ] `npm run verify:local` bzw. `npm run eval:real-repo-navigation:gate` — die datierte Headline-Cohort (§6) und ABBRUCH-Kriterium für diese Ranking-Änderung. Von 5 Cohort-Repos fehlten 3 (`~/dev/macrolens`, `~/alpha-cycles`, `~/.pi/agent/git/.../pi-ext-subagents`); nur `pi-ext-memory` und `pi-ext-astgrep` vorhanden. Sinkt Success/Recall → Fix nachbessern, Gate NICHT aufweichen.
    2. [ ] `npm run bench:search-quality:local` — nutzt `/home/wasti/{macrolens,ai_stack/services/newsletter-writer,dev/autoresearch}`, alle drei auf dieser Maschine abwesend. Belegt Real-Repo-Search-Qualität (u. a. doc-intent-Cases wie „what is this project about").
    3. [ ] Real-Repo-Doc-Intent-Regression prüfen: gegen die volle Cohort bestätigen, dass die Phantom-FTS-Entfernung (Doc-Floor 43→33) kanonische README-Ziele nicht unter dichtere Docs drückt. Beobachtung am Proxy partflow: „what is this project about" README Rang 1→2 (noch Top-5) — auf der Headline-Cohort verifizieren.
    4. [ ] Optional `npm run bench:graph-budget:local` / weitere `*:local`-Varianten, falls von der Änderung berührt.
  - **Offene Restgrenzen (eigene Slices, nur bei konkretem Miss):** (1) Doc-Headings als Symbole erhalten `exactTermSymbol`-Boost, wenn ein Query-Term = Heading-Name — separater Verstärker, bewusst nicht angefasst; (2) exaktes Ziel-Component rankt in großen Repos nicht immer #1 (Prosa-Token/FTS-Tier-Bias, Wurzel von Amplifier 3) — voller Fix bräuchte Tier-/bm25-Arbeit (gated, TODO §5).
- **Getestet & verworfen (2026-07-13): confidence-gated Context-Suppression.** Hypothese: der Nav-Eval sei pessimistisch, weil er `codemap_context` unbedingt auf `searchPaths[0]` ankert (`navigation-eval.ts`), auch bei `topHitConfidence` low — entgegen dem Routing-Eval-Soll (Szenario D: nicht auf Low-Confidence-Hit ankern). Umsetzung: `expandContext`-Schalter in `navigation-read-plan.ts`, bei low-confidence kein Context-Expand. Messung am Real-Repo-Gate: paired losses zwar 2 → 0, aber **netto-Regression** (Holdout-Success 0.625 → 0.438, context-wins 5 → 3, neue forbiddenRead 0.063 → Gate rot). Befund: Context-Expansion ist auch bei low-confidence **netto positiv** (mehr Wins als Losses, plus Noise-Verdrängung); der Eval ist hier **nicht** verzerrt. Nicht erneut versuchen. Der verbleibende echte Hebel für die realen Entry-Misses (agents/macro) ist Entry-**Ranking** (`ranking.ts`) über `bench:search-quality`, eine Score-Komponente pro Slice — kein Gate-Druck, hohes Regressionsrisiko, bewusst zurückgestellt.

## Nächste sinnvolle Slices — vorgeschlagene Reihenfolge

1. [ ] Nächsten Expanded-Natural-Holdout-Fix-Slice nur bei neuem konkretem Miss auswählen.
   - Aktueller Release-Stand: Baseline und Natural-Holdout waren vor `0.5.3` voll grün; alte Miss-Listen nicht als aktive Defekte behandeln.
   - Regel: erst Diagnose/öffentlicher Regressionstest, dann maximal ein Hebel; keine Query-/Threshold-Änderung als Ersatz für Systemverbesserung.

2. [ ] Weitere Konventions-Nachbarn als kleine, getrennte Verticals testen.
   - Erledigt: Route↔Handler ist als enge Next.js-Route-Adapter-zu-`*handler*`-Quelle plus Handler-Test-Fixture umgesetzt.
   - Nächste Kandidaten: UI↔API, Provider/Hook↔Consumer, Config-Key↔Nutzung; Source↔Test nur wieder anfassen, wenn ein neuer Eval-Miss nicht durch Entry/Search-Ranking verursacht ist.
   - Regel: pro Konvention ein Fixture/Real-Repo-Case, eigene Metrik, keine breite Heuristik ohne messbaren Gewinn.

3. [ ] Test-/Script-Monolith Deepening nur opportunistisch fortführen.
   - Erledigt: `test/` heißt jetzt `tests/`; Storage-/Migration-Verträge liegen in `tests/storage.test.ts`, Pi-Adapter-Verträge in `tests/pi-extension.test.ts`, gemeinsame Temp-Repo/Home-Fixtures liegen in `tests/helpers/repo-fixture.ts`, die reinen Search+Context-Read-Plan-Verträge liegen in `tests/search-read-plan.test.ts`, Natural-Navigation-Search+Context-Fixtures liegen in `tests/search-natural-navigation.test.ts`, öffentliche Search-Navigation-Ranking-/Noise-Verträge liegen in `tests/search-navigation-ranking.test.ts`, reine Eval-Diagnostik-/Miss-Taxonomy-Verträge liegen in `tests/search-eval-diagnostics.test.ts`, der Eval-Report-Smoke liegt in `tests/search-eval-report.test.ts`, reine Query-Plan-/Ranking-Verträge liegen in `tests/search-ranking.test.ts`, interne Search-Diagnostics-Verträge liegen in `tests/search-diagnostics.test.ts`, Context-Relationship-/Graph-Verträge liegen in `tests/search-context-relationships.test.ts`, stale/status/safety/pathPrefix-Verträge liegen in `tests/search-index-status.test.ts`, und gemeinsame Navigation-Eval-Bewertung/Metrik-/Lookup-Helfer liegen in `src/core/navigation-eval.ts` mit `tests/navigation-eval.test.ts`.
   - Review-Befund: `tests/search.test.ts` (~0.13k Zeilen) ist jetzt ein kompakter Search-/Symbol-/Alias-Smoke; `scripts/eval-agent-navigation.ts` und `scripts/eval-real-repo-navigation.ts` teilen Bewertung/Metriken/Scoring/Search+Context-Lookup-Helfer, enthalten aber weiterhin eigene Suite-/Fixture-/CLI-/Gate-Adapterlogik.
   - Priorisierte Kandidaten:
     1. Weitere Script-Adapter nur bei klarem Doppel-Touch ausdünnen: gemeinsame Gate-Report- oder CLI-Parser-Helfer erst extrahieren, wenn beide Navigation-Skripte erneut geändert werden.
     2. Weitere Test-Fixture-Helfer nur dort extrahieren, wo sie mehrere neue Suites vereinfachen; case-spezifische Inhalte inline lassen.
     3. Inline Eval-/Benchmark-Cases in Daten-/Fixture-Module verschieben, damit Logik- und Corpus-Diffs getrennt bleiben.
     4. `tests/search.test.ts` nur wieder anfassen, wenn der Search-/Symbol-/Alias-Smoke erneut mehrere Verantwortungen vermischt.
   - Namenskonvention: `test/` → `tests/` ist erledigt; weitere Splits sollen Package-/Doku-Referenzen synchron halten.
   - Guardrail: `src/core/search-quality-metrics.ts`, `src/core/eval-miss-taxonomy.ts`, `src/core/eval-navigation-diagnostics.ts`, `src/core/navigation-read-plan.ts`, `src/core/context-builder.ts` und `src/core/relationships.ts` wiederverwenden; keine Pi/TUI-Adapter-Details in Core-Tests ziehen.
   - Verifikation: pro Slice `npm run typecheck`/`npm test`; bei Script-Eval-Änderungen zusätzlich betroffene `bench:*`/`eval:*:gate` ausführen.

4. [ ] Workspace-/Multi-Config-Pfadalias nur als gated Slice angehen.
   - Scope: erst bei konkretem Miss mit `tsconfig`/`jsconfig` `extends`, Workspace-Alias oder vielen Alias-Imports; dann minimalen Resolver/Ordering-Fix bauen.
   - Nutzen: TS/JS-Alias-Restgrenzen bleiben sichtbar, ohne Resolver-Komplexität auf Vorrat einzubauen.
   - Verifikation: ein Fixture oder Real-Repo-Case belegt den Miss und die Verbesserung; keine breite Alias-Heuristik ohne Qualitätsgewinn.

5. [ ] Graphify-inspirierte Follow-ups nur nach internen Helpern und Gates weiterführen.
   - Detailplan: [`docs/developer/relationship-graph-plan.md#graphify-smoke-test-learnings-and-improvement-plan`](docs/developer/relationship-graph-plan.md#graphify-smoke-test-learnings-and-improvement-plan).
   - Implementierter Unterbau: interner `graphNeighborhoodDiagnostics(...)`, interner `pathBetweenTargets(...)`, Developer-only `npm run report:architecture`; Graphify bleibt separates Prior-Art-Tool und keine Dependency.
   - **Public/API-Gate:** öffentliche Commands wie `codemap_explain`/`codemap_path` erst nach wiederholtem Agent-Nutzen, Produktentscheidung und Token-Injection-Budgetcheck.
   - **Symbol-Gate:** Symbol-Ziele, callers/callees, Symbol-Containment und Symbol-Level-Reports erst nach separatem Slice für stabile Symbol-Identitäten.
   - **Broad-Architecture-Query-Gate:** Ranking nur als Eval-/Autoresearch-Loop anfassen; zuerst festen failing Eval-Case definieren, z. B. `core search context modules`, mit erwarteten Module-Dateien (`search.ts`, `search-pipeline.ts`, `context-builder.ts`) vor TODO/docs noise.
   - Guardrails: keine generelle Doc-Abwertung; canonical docs bleiben auffindbar; Tests/TODOs bleiben sichtbar, wenn Query sie verlangt; bestehende Natural-Holdout-/Search-Gates dürfen nicht regressieren.

6. [ ] Review-Cleanup ohne Produktverhalten ändern.
   - Token-Budget: `codemap_context` und Gesamtbudget sind nahe am Gate; neue Parameter, Guidelines oder öffentliche Tools nur mit `npm run check:token-injection` und expliziter Budgetentscheidung.
   - Verifikation: Doku-/Package-Änderungen mit `npm pack --dry-run --json`, `npm run audit:lightweight`, `npm run check:token-injection` prüfen.

7. [ ] Strukturiertes Chunking für C/C++ als separaten Slice prüfen (Review 2026-07-05).
   - Erledigt: C/C++-Symbole (Funktions-/Methoden-Definitionen, `struct`/`union`/`enum`/`class`) in `src/core/symbols.ts`; C/C++-Extensions auf kanonische Tags `c`/`cpp` in `src/core/scan-policy.ts` normalisiert; Verträge in `tests/symbols-c-cpp.test.ts`.
   - Offen: C/C++ nutzt weiter Fixed-Window-Chunking. Strukturiertes Brace-Chunking (`src/core/chunker.ts`) ist auf JS/TS zugeschnitten — der Brace-Scanner hat Regex-Literal-Heuristiken (`isRegexStart`), die auf C-`/`-Division fehlzünden; erst mit sprachspezifischem Scanner und Fixture-Beleg angehen.
   - Bekannte Symbol-Grenzen: anonyme `typedef struct { … } Name;` (Name auf der Schluss-Zeile) und Makros werden noch nicht als Symbole erfasst; nur bei konkretem Miss ergänzen.
   - Später (nicht aktuell relevant): Go/Rust/Java/Ruby/PHP-Symbole nur bei konkretem Bedarf als weitere Verticals.

## Diskussionspunkte / offen

1. [ ] npm-Registry-Veröffentlichung nur bei Bedarf aufnehmen.
   - Kontext: CodeMap ist CLI-first; `codemap` und `codemap-mcp` werden bis zu einer Registry-Veröffentlichung kanonisch mit `npm install -g github:sebastianlang84/codemap` installiert. Pi bleibt ein optionaler Adapter aus demselben Repo.
   - Offen bleibt nur der npm-Publish/`npx`-Pfad statt Git-Install (`@sebastianlang84/codemap` gegen Registry-/Release-Pflege) — erst bei konkretem Nutzerwunsch.
   - MCP-Verbesserung (gated): Der Server nutzt aktuell den Prozess-cwd als Repo-Root; Hosts, die MCP-Server nicht im Projektverzeichnis starten (z. B. manche Cursor-Versionen), brauchen `repoPath` im Tool-Call. Native Auflösung über die MCP-`roots`-Capability erst umsetzen, wenn ein konkreter Host-Miss auftaucht.

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

5. [x] Kanonische Token-Read-Zahlen in die README-Benchmarks aufnehmen.
   - Erledigt (2026-07-12): Full-Suite-Lauf über alle fünf lokalen Real-Repos; die Read-Cost-Tabelle in `README.md` zeigt jetzt est-tokens-read pro Modus (lexical ~51,8k vs. search/context ~11,4–11,6k, ~4,5× weniger), datiert und als eigener Abschnitt statt in den 2026-05-24-Snapshot gemischt.

6. [ ] Erfolgs-/Recall-Baseline im README auf aktuellen Repo-Stand re-baselinen (entscheiden).
   - Befund (2026-07-12): Derselbe Full-Suite-Lauf zeigt gegenüber dem datierten 2026-05-24-Snapshot gedriftete Zahlen (Baseline `codemap_search_context` Success 0.75 statt 1.000; Natural-Holdout 0.625 statt 0.750), weil sich die fünf lokalen Real-Repos verändert haben. Der `eval:real-repo-navigation:gate` besteht weiter (kein Regressions-Gate-Bruch). Ein gedrifteter Holdout-Fall war Fixture-Rot durch Rename (`reviewer-context-scout*` → `reviewer-scout*`, in `scripts/eval-real-repo-navigation.ts` gefixt); die übrigen Misses sind echte Konventions-Nachbar-Grenzen (H2).
   - Offen: Produktentscheidung, ob die datierte Benchmark-Tabelle + Prosa („gets it right every time") auf einen neuen datierten Cohort aktualisiert werden soll. Nicht eigenmächtig, weil es Headline-Claims senkt.
   - Regel: keine Token-/Erfolgszahlen aus Teilmengen in die README schreiben; Cohorts immer datieren.
