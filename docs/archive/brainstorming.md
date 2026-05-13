# pi-ext-codemap Brainstorming

> Historical archive: this note preserves the original idea exploration and is no longer authoritative. Use `README.md`, `PRD.md`, and `docs/roadmap.md` for the current product contract and future-work list.

## Ausgangsidee

Ein separates, super-lightweight CodeMap-Tool als Ergänzung zu `pi-memory`.
Nicht in `pi-memory` einbauen, sondern als eigener Folder bzw. eigenes Pi Package/Extension: `pi-ext-codemap`.

Ziel ist kein GitNexus-Klon, sondern ein kleines lokales Repo-Navigations- und Kontextwerkzeug für Coding Agents.

## Zielbild

Das Tool soll Agents schnell beantworten helfen:

- Welche Dateien, Symbole oder Tests sind für eine Änderung relevant?
- Wo liegt der Einstiegspunkt für ein Feature oder Subsystem?
- Welche Docs/ADRs erwähnen einen Bereich?
- Welche Dateien hängen grob zusammen?
- Welche Code-Chunks passen semantisch oder lexikalisch zu einer Frage?

## Nicht-Ziele

- Kein vollständiger Code-Intelligence-Server
- Kein schwerer Daemon
- Kein zentraler Remote-Service
- Kein Neo4j oder separates Graph-System
- Kein vollständiger, perfekter Callgraph
- Kein Ersatz für ripgrep, Language Server oder GitNexus
- Keine aggressiven AI-Summaries über die ganze CodeMap in V1

## V1-Kernfunktionen

### 1. Lokaler Repo-Index

SQLite-basierter Index pro Repo:

- Dateien mit Pfad, Sprache, Größe, Hash, mtime
- Chunks aus Code und Markdown
- einfache Symbolinformationen
- optionale Beziehungen zwischen Dateien, Symbolen, Tests und Docs

Der Index sollte inkrementell sein:

- unveränderte Dateien überspringen
- gelöschte Dateien entfernen
- `.gitignore` respektieren
- typische schwere Ordner ignorieren: `.git`, `node_modules`, `dist`, `build`, `.next`, Coverage, Vendor-Folder

### 2. Hybrid Search

Kombination aus:

- SQLite FTS5 für Pfade, Dateinamen, Symbole und Text-Chunks
- optionalen Lightweight Embeddings für semantische Suche
- Ranking in Anwendungscode

Mögliche Ranking-Signale:

- lexical match score
- embedding similarity
- Pfad-/Dateityp-Boost
- Symboltreffer vor normalem Chunktreffer
- Nähe zwischen Symbol und Chunk
- Recency bzw. Git-Änderungsnähe
- Test-/Doc-Bezug

FTS muss alleine brauchbar bleiben. Embeddings sind optionaler Qualitätsboost.

### 3. Lightweight Embeddings

Mögliche Profile:

- deterministic hash embeddings als Fallback, ähnlich `pi-memory`
- optional lokaler Command-Adapter, z.B. BGE-M3 oder anderes Modell
- später mögliche kleine Modelle: `all-MiniLM`, `gte-small`, `nomic-embed-text`
- optional Ollama-kompatibler Adapter

Designprinzip:

- keine Cloud-Pflicht
- keine schwere Runtime als Voraussetzung
- Adapter-Schnittstelle klein halten
- Embeddings versionieren und bei Modellwechsel neu berechnen können

### 4. ast-grep Integration

`ast-grep` passt gut als optionale, leichte Strukturquelle.

Mögliche Nutzung:

- Funktions-/Klassen-/Export-Definitionen finden
- Imports/Exports extrahieren
- Pattern-basierte Code-Suche
- Call-like Patterns erkennen
- sprachübergreifende Queries ohne eigenen Parser

Beispiele für spätere Agent-Fragen:

- Find exports matching `auth`
- Find functions touching `memory_save`
- Find React components using `useEffect`
- Find callers of a known helper pattern
- Find tests referencing a symbol or file

Wichtig: `ast-grep` optional halten. Wenn nicht installiert, fällt das Tool auf Text-/Regex-/FTS-Indexing zurück.

### 5. Kleiner Knowledge Graph in SQLite

Kein externer Graph-Server. Ein minimalistisches Graph-Modell in SQLite reicht.

Mögliche Nodes:

- `file`
- `symbol`
- `chunk`
- `package`
- `command`
- `test`
- `doc`
- `memory_ref`

Mögliche Edges:

- `defines`
- `imports`
- `exports`
- `references`
- `tests`
- `documents`
- `related_to`
- `mentions`

Damit wären Fragen möglich wie:

- Welche Dateien hängen an diesem Modul?
- Welche Tests decken diese Datei oder dieses Symbol ab?
- Welche Docs/ADRs erwähnen dieses Subsystem?
- Was sollte ich lesen, bevor ich Datei X ändere?

## Mögliche Pi Tools

Minimal:

- `codemap_index` — Repo indexieren oder aktualisieren
- `codemap_search` — Hybrid-Suche über Pfade, Symbole und Chunks
- `codemap_symbols` — Symbole nach Query/Datei listen
- `codemap_context` — kompakten Kontext für Datei/Symbol/Subsystem liefern

Später:

- `codemap_related` — verwandte Dateien/Symbole/Tests/Docs finden
- `codemap_graph` — kleine Nachbarschaft im SQLite-Graph ausgeben
- `codemap_ast_search` — ast-grep Pattern ausführen
- `codemap_link_memory` — relevante `pi-memory` Artifact-Refs verknüpfen

## Mögliche Pi Commands

- `/codemap-status`
- `/codemap-index`
- `/codemap-search <query>`
- `/codemap-context <path-or-symbol>`

## Beziehung zu pi-memory

`pi-memory` bleibt das langlebige Gedächtnis für:

- Entscheidungen
- Todos
- Handoffs
- stabile Fakten
- Präferenzen
- Artifact-Refs

`pi-ext-codemap` ist dagegen der lokale, aktualisierbare Repo-Index.

Integration nur locker:

- Suchergebnisse können auf `artifact_ref` Memories zeigen
- wichtige Code-Stellen können in `pi-memory` gespeichert/verlinkt werden
- Handoffs können relevante Dateien/Symbole aus `codemap` referenzieren

## Grobe Modulstruktur

```text
pi-ext-codemap/
  brainstorming.md
  package.json
  src/
    core/
      store.ts
      schema.ts
      indexer.ts
      chunker.ts
      search.ts
      ranking.ts
      embeddings.ts
      astGrep.ts
      graph.ts
    pi-extension/
      index.ts
      tools.ts
      commands.ts
```

## Schema-Idee

```text
repos(id, root_path, git_remote, created_at, updated_at)
files(id, repo_id, path, language, size, hash, mtime, indexed_at)
chunks(id, file_id, ordinal, start_line, end_line, kind, text)
symbols(id, file_id, name, kind, start_line, end_line, signature)
embeddings(id, target_type, target_id, model, dimensions, vector_blob)
nodes(id, repo_id, type, key, label)
edges(id, repo_id, from_node_id, to_node_id, type, weight, source)
```

FTS-Tabellen für:

- files/path
- symbols/name/signature
- chunks/text

## MVP-Reihenfolge

1. Repo-Folder und README/Plan anlegen
2. SQLite Schema + Migrationen
3. Datei-Scanner mit Ignore-Regeln
4. Chunker für Text/Markdown/Code
5. FTS5 Suche
6. Pi Tool `codemap_search`
7. optional Embedding Adapter + Hybrid Ranking
8. einfache Symbol-Extraktion
9. optionale ast-grep Integration
10. kleiner SQLite-Graph für Datei/Symbol/Test/Doc-Beziehungen

## Offene Fragen

- Pro Repo eigene SQLite DB oder globale DB mit `repo_id`?
- Soll Indexing manuell bleiben oder später Hook-basiert laufen?
- Welche Sprachen zuerst gut unterstützen?
- Wie stark sollen Git-Daten ins Ranking einfließen?
- Wie eng soll die Integration mit `pi-memory` werden?
- Brauchen wir vor V1 eine ADR zum Verhältnis `memory` vs. `codemap`?
