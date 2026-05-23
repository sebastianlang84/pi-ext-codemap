# TODO

Active offene Arbeit für `pi-ext-codemap`. Abgehakte Punkte werden hier gelöscht; release-relevante Historie steht im [`CHANGELOG.md`](CHANGELOG.md). Produkt-/Architekturkontext steht in [`docs/product/roadmap.md`](docs/product/roadmap.md#future-work) und [`docs/developer/architecture.md`](docs/developer/architecture.md).

## Active tactical backlog — reviewed order

Der nächste vorgeschlagene Slice steht unten. Der V1.5 Relationship-Graph ist implementiert; Budget- und Context-Quality-Baselines sind in [`docs/developer/relationship-graph-plan.md`](docs/developer/relationship-graph-plan.md#v15-budget-baseline) / [`Context-Quality-Gate`](docs/developer/relationship-graph-plan.md#v15-context-quality-gate) dokumentiert. Weiterer Graph-Ausbau bleibt gated: kein Symbol-/Docs-/Config-/Heuristik-/Search-Ranking-Ausbau ohne klaren Context-Gewinn und neue Budget-Entscheidung.

Refresh-Automation bleibt nach dem Agent-Refresh-Eval bewusst zurückgestellt; siehe [`docs/developer/agent-refresh-eval.md`](docs/developer/agent-refresh-eval.md#current-finding). Deterministische Navigation-Evals gegen Baselines sind in [`docs/developer/agent-navigation-eval.md`](docs/developer/agent-navigation-eval.md) und [`docs/developer/real-repo-navigation-eval.md`](docs/developer/real-repo-navigation-eval.md) dokumentiert. Ein zusätzlicher Live-LLM-Navigation-Eval ist noch nicht als aktiver Slice ausgewählt.

## Eval-discovered gaps / Verbesserungspotential

Diese Lücken sind bewusst festgehalten: Evals sollen nicht nur bestehen, sondern Misses sichtbar machen und daraus gezielte Verbesserungs-Slices ableiten. Die eigentlichen To-do-Checkboxen stehen im nächsten Abschnitt, damit die Backlog-Liste nicht doppelt gezählt wird.

- **TypeScript-Pfadaliasse — Restgrenzen**: Minimaler `tsconfig.json` / `jsconfig.json` `baseUrl` + `paths`-Support ist umgesetzt; offen bleiben komplexe `extends`-Ketten, Workspace-Aliasse und Budget-Ordering bei vielen Alias-Imports.
- **Framework-/Konventions-Nachbarn**: relevante Dateien sind teils nicht über direkte Imports verbunden, sondern über Namens-/Framework-Konventionen, z. B. UI-zu-API, Route-Handler, Provider oder Config-Dateien. Source→Test-Budget-Ordering, ein importierter Source→Test-Nachbar, source-first Implementation-Targeting, TypeScript-`.js`-Specifier-Auflösung, stem-affine Reverse-Importer und Search-Hit-Preservation im Eval-Readplan sind als kleine Verticals geschützt; weitere Konventionen brauchen eigene Eval-/Fixture-Belege. Der aktuelle Baseline-`codemap_search_context`-Run hat keine Misses.
- **Natürlichere Bug-/Änderungsanfragen — Restgrenzen**: Real-Repo-Eval enthält jetzt einen kleinen Natural-Language-Holdout ohne exakte Symbolnamen. Offen bleibt ein größerer, stabiler Holdout für beliebige Bugreports; der aktuelle Satz ist noch lokal und klein.
- **False positives / verbotene Reads**: lexical liest im Real-Repo-Gate häufiger verbotene/noisy Dateien; CodeMap vermeidet sie aktuell, aber neue Heuristiken können Noise zurückbringen.

## Nächste sinnvolle Slices — vorgeschlagene Reihenfolge

1. [ ] Natural-Language-Holdout erweitern.
   - Ziel: mehr echte Bug-/Änderungsanfragen ohne exakte Symbolnamen, damit die aktuelle `1.000`-Quote nicht nur auf einem kleinen, lokal gepaarten Satz beruht.
   - Regel: neue Holdout-Cases getrennt von Systemverhalten hinzufügen; keine Heuristik erst nach sichtbarer Miss-Klasse.

2. [ ] Weitere Konventions-Nachbarn als kleine, getrennte Verticals testen.
   - Kandidaten: Route↔Handler, UI↔API, Provider/Hook↔Consumer, Config-Key↔Nutzung; Source↔Test nur wieder anfassen, wenn ein neuer Eval-Miss nicht durch Entry/Search-Ranking verursacht ist.
   - Regel: pro Konvention ein Fixture/Real-Repo-Case, eigene Metrik, keine breite Heuristik ohne messbaren Gewinn.

3. [ ] ast-grep/AST-gestützten Structural-Analyzer als Prototyp evaluieren.
   - Ziel: prüfen, ob AST-Beziehungen CodeMap-Context verbessern, ohne CodeMap zu einem vollständigen ast-grep-Ersatz zu machen.
   - Scope: zuerst eval-/index-intern und optional; keine harte Runtime-Abhängigkeit und kein neues prompt-facing Tool, bevor Recall/Budget/Noise klar besser sind.

## Parked / später

1. [ ] Thin CLI Adapter über `src/core/` ergänzen.
   - Scope: kleiner CLI-Adapter, zuerst `status --json` und maximal ein Such-/Context-Befehl.
   - Test: CLI-Integration nutzt temp `stateDir`, dupliziert keine State-Logik und gibt stabiles JSON aus.

2. [ ] Später: Autoresearch als Parameter-Tuning-Schleife prüfen.
   - Voraussetzungen: stabile maschinenlesbare Metriken, feste Trainings-/Validierungs-Cases, Holdout-Guardrails und keine Optimierung nur auf ein privates lokales Repo.
   - Kandidaten: File-Rollen-Boosts, Noise-Penalties, Symbol-/Path-/Filename-/FTS-Gewichte, Token-Coverage-Bonus, Intent-Heuristiken, Context-Nachbarschaftsbudget.

3. [ ] Refresh-Automation nur bei breiterem Eval-/Praxisbedarf wieder aufnehmen.
   - Befund: Agent-Refresh-Eval mit `openai-codex/gpt-5.4-mini`, Baseline + Hint je 3 Runs, bestand 6/6; Agent sah stale Signale, rief `codemap_index`, suchte erneut und nannte `src/calculator.ts`.
   - Entscheidung: LLM-gesteuertes Refresh über bestehende stale Warnungen genügt vorerst; kein Command/Hook als nächster Slice.
   - Wieder aufnehmen, wenn breitere Modelle/Runs scheitern oder Praxis zeigt, dass Agenten stale Warnungen übersehen.
