# TODO

Aktive offene Arbeit für CodeMap. Erledigte Arbeit gehört in den [`CHANGELOG.md`](CHANGELOG.md), Eval-Befunde in die passenden Dokumente unter [`docs/developer/`](docs/developer/), Produkt-/Architekturkontext in [`docs/product/roadmap.md`](docs/product/roadmap.md#future-work) und [`docs/developer/architecture.md`](docs/developer/architecture.md).

## Nächster Slice

Kein aktiver Implementierungsslice. Weitere Konventions-/Targeting-Arbeit erst bei einem neuen konkreten Eval-Miss auswählen; pro Konvention ein Fixture oder Real-Repo-Case und eine eigene Metrik, keine breite Heuristik ohne messbaren Context-Gewinn.

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

- **Doc-Flood-Ranking-Fix gelandet (2026-07-15, ADR [`docs/adr/20260714-search-code-vs-doc-target.md`](docs/adr/20260714-search-code-vs-doc-target.md)):** konzeptuelle/UI-Queries lieferten READMEs statt Code; behoben via Phantom-FTS-Entfernung, doc-evidence-gated `overview`-Intent, additiver Code-Quota + doc-intent-gated Code-Lift (keine Doc-Abwertung). Merge-Evidenz: `doc-flood`-Fixture + Ranking-Unit-Tests, `bench:search-quality:gate` grün (Vorher: Code aus Top-5 gedrängt → Nachher recall@5 1.0), Review ohne Correctness-Befund. Beim Merge mit `8a87197` (weak-symbol/coverage) reconciled und volles `verify` auf dem kombinierten Stand grün.
  - [ ] **Autor-lokales Advisory** auf einer Maschine mit vollständiger Cohort fahren (`npm run verify:local` / `eval:real-repo-navigation:gate`, `bench:search-quality:local`); Ergebnis an Merge/ADR anhängen. Laut ADR-Amendment ist die Headline-Cohort ein autor-lokales Advisory, kein CI-Blocking-Gate — der Korpus ist privat/maschinen-lokal und nirgends reproduzierbar; blockierend sind die Fixture-Gates.
  - [ ] **Harness-Fix (eigener Task):** Eval-Suites config-/env-getrieben (`CODEMAP_EVAL_REPOS`) statt in `scripts/eval-real-repo-navigation.ts` hartkodiert; „Repo fehlt" von „Qualität regrediert" entkoppeln (fehlend → skip + Warnung, hart failen nur bei echter Regression auf vorhandenen Repos). Macht das Advisory auf jeder Teilmenge ehrlich lauffähig statt an Mindest-Task-Zahlen zu scheitern.
  - **Offene Restgrenzen (eigene Slices, nur bei konkretem Miss):** (1) Doc-Headings als Symbole erhalten `exactTermSymbol`-Boost, wenn ein Query-Term = Heading-Name — separater Verstärker, bewusst nicht angefasst; (2) exaktes Ziel-Component rankt in großen Repos nicht immer #1 (Prosa-Token/FTS-Tier-Bias) — voller Fix bräuchte Tier-/bm25-Arbeit (gated).

- [ ] Graphify-inspirierte öffentliche Tools nur nach wiederholtem Agent-Nutzen und Budgetentscheidung erwägen.
  - Interne Neighborhood-/Path-Diagnostics und `npm run report:architecture` existieren bereits.
  - `codemap_explain`, `codemap_path`, Symbol-Level-Reports oder breites Architektur-Ranking brauchen jeweils einen festen failing Eval-Case, Produktentscheidung und `npm run check:token-injection`.

- [ ] Review-Cleanup ohne Produktverhalten nur bei einem konkreten Review-Befund durchführen.
  - `codemap_context` und das Gesamtbudget liegen nahe am Token-Gate; neue Parameter, Guidelines oder öffentliche Tools brauchen eine explizite Budgetentscheidung.

## Produktentscheidungen / später

- [ ] npm-Registry-Veröffentlichung erst bei konkretem Nutzerbedarf entscheiden; bis dahin bleibt `npm install -g github:sebastianlang84/codemap` kanonisch.
- [ ] Native MCP-`roots`-Auflösung erst bei einem belegten Host-Miss ergänzen; `repoPath` bleibt der Fallback für Hosts mit falschem Prozess-cwd.
- [ ] Refresh-Automation erst wieder aufnehmen, wenn breitere Agent-Evals oder Praxisfälle zeigen, dass Agenten bestehende stale Warnungen übersehen.
