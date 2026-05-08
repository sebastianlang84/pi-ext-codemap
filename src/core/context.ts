import { openRepoDb } from "./db.ts";
import { getRepoInfo } from "./repo.ts";
import { searchCodebase } from "./search.ts";
import { snippet } from "./chunker.ts";
import { status } from "./indexer.ts";

export function codebaseContext(options: { target: string; cwd?: string; limit?: number }) {
  const info = getRepoInfo(options.cwd);
  if (!info.approved) throw new Error("Repository is not approved/indexed yet.");
  const db = openRepoDb(info.dbPath);
  try {
    const limit = Math.min(Math.max(options.limit ?? 8, 1), 25);
    const diagnostics = status(options.cwd);
    const warnings: string[] = [...((diagnostics as { warnings?: string[] }).warnings ?? [])];
    const target = options.target.trim();

    const file = db.prepare("select id, path, language from files where path = ? or path like ? limit 1")
      .get(target, `%${target}%`) as { id: number; path: string; language: string } | undefined;

    let readFirst: unknown[];
    if (file) {
      const chunks = db.prepare("select start_line as startLine, end_line as endLine, kind, text from chunks where file_id=? order by ordinal limit ?")
        .all(file.id, Math.min(limit, 6)) as Array<{ startLine: number; endLine: number; kind: string; text: string }>;
      readFirst = chunks.map((chunk) => ({ path: file.path, language: file.language, ...chunk, snippet: snippet(chunk.text) }));
    } else {
      warnings.push("Target was not an indexed file path; falling back to search results.");
      readFirst = searchCodebase({ query: target, cwd: options.cwd, limit });
    }

    const base = file?.path ?? target;
    const stem = base.split("/").pop()?.replace(/\.[^.]+$/, "") ?? base;
    const relatedTests = db.prepare(`
      select path from files
      where (path like '%test%' or path like '%spec%') and (path like ? or path like ?)
      order by path limit 8
    `).all(`%${stem}%`, `%${base}%`) as Array<{ path: string }>;
    const relatedDocs = db.prepare(`
      select path from files
      where language = 'markdown' and (path like ? or path like ?)
      order by path limit 8
    `).all(`%${stem}%`, `%${base}%`) as Array<{ path: string }>;
    const lastIndexedAt = (db.prepare("select value from meta where key='last_indexed_at'").get() as { value: string } | undefined)?.value ?? null;

    return {
      target,
      root: info.root,
      lastIndexedAt,
      readFirst,
      relatedTests: relatedTests.map((r) => r.path),
      relatedDocs: relatedDocs.map((r) => r.path),
      warnings,
    };
  } finally {
    db.close();
  }
}
