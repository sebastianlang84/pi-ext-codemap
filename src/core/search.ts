import { openRepoDb } from "./db.ts";
import { getRepoInfo } from "./repo.ts";
import { snippet } from "./chunker.ts";
import type { SearchResult } from "./types.ts";

export function searchCodebase(options: { query: string; cwd?: string; limit?: number }): SearchResult[] {
  const info = getRepoInfo(options.cwd);
  if (!info.approved) throw new Error("Repository is not approved/indexed yet.");
  const db = openRepoDb(info.dbPath);
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const ftsQuery = toFtsQuery(options.query);

  try {
    const chunkRows = db.prepare(`
      select f.path, f.language, c.start_line as startLine, c.end_line as endLine, c.kind, c.text,
             bm25(chunks_fts) as rank
      from chunks_fts
      join chunks c on c.id = chunks_fts.rowid
      join files f on f.id = c.file_id
      where chunks_fts match ?
      order by rank
      limit ?
    `).all(ftsQuery, limit) as Array<{ path: string; language: string; startLine: number; endLine: number; kind: string; text: string; rank: number }>;

    const symbolRows = db.prepare(`
      select f.path, f.language, s.start_line as startLine, coalesce(s.end_line, s.start_line) as endLine,
             s.kind, coalesce(s.signature, s.name) as text, bm25(symbols_fts) as rank
      from symbols_fts
      join symbols s on s.id = symbols_fts.rowid
      join files f on f.id = s.file_id
      where symbols_fts match ?
      order by rank
      limit ?
    `).all(ftsQuery, Math.ceil(limit / 2)) as Array<{ path: string; language: string; startLine: number; endLine: number; kind: string; text: string; rank: number }>;

    return [...symbolRows.map((r) => toResult(r, 2)), ...chunkRows.map((r) => toResult(r, 1))]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } finally {
    db.close();
  }
}

function toResult(row: { path: string; language: string; startLine: number; endLine: number; kind: string; text: string; rank: number }, boost: number): SearchResult {
  return {
    path: row.path,
    language: row.language,
    startLine: row.startLine,
    endLine: row.endLine,
    kind: row.kind,
    snippet: snippet(row.text),
    score: boost + Math.max(0, 10 - Math.abs(row.rank)),
  };
}

function toFtsQuery(query: string): string {
  const terms = query.match(/[\p{L}\p{N}_.$/-]+/gu)?.slice(0, 8) ?? [];
  if (terms.length === 0) throw new Error("Search query has no searchable terms.");
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
}
