import { openRepoDb } from "./db.ts";
import { getRepoInfo } from "./repo.ts";
import { searchCodeMap } from "./search.ts";
import { snippet } from "./chunker.ts";
import { status } from "./indexer.ts";
import { normalizePathPrefix } from "./scanner.ts";

export function codemapContext(options: { target: string; cwd?: string; limit?: number; pathPrefix?: string }) {
  const info = getRepoInfo(options.cwd);
  if (!info.approved) throw new Error("Repository is not approved/indexed yet.");
  const db = openRepoDb(info.dbPath);
  try {
    const limit = Math.min(Math.max(options.limit ?? 8, 1), 25);
    const pathPrefix = normalizePathPrefix(options.pathPrefix);
    const pathFilter = pathPrefix ? `${escapeLike(pathPrefix)}%` : "%";
    const diagnostics = status(options.cwd, { health: "full", pathPrefix });
    const warnings: string[] = [...((diagnostics as { warnings?: string[] }).warnings ?? [])];
    const target = options.target.trim();

    const file = db.prepare("select id, path, language from files where (path = ? or path like ?) and path like ? escape '\\' limit 1")
      .get(target, `%${target}%`, pathFilter) as { id: number; path: string; language: string } | undefined;

    let readFirst: unknown[];
    if (file) {
      const chunks = db.prepare("select start_line as startLine, end_line as endLine, kind, text from chunks where file_id=? order by ordinal limit ?")
        .all(file.id, Math.min(limit, 6)) as Array<{ startLine: number; endLine: number; kind: string; text: string }>;
      readFirst = chunks.map((chunk) => ({ path: file.path, language: file.language, ...chunk, snippet: snippet(chunk.text) }));
    } else {
      warnings.push("Target was not an indexed file path; falling back to search results.");
      readFirst = searchCodeMap({ query: target, cwd: options.cwd, limit, pathPrefix });
    }

    const base = file?.path ?? target;
    const stem = base.split("/").pop()?.replace(/\.[^.]+$/, "") ?? base;
    const relatedTests = db.prepare(`
      select path from files
      where (path like '%test%' or path like '%spec%') and (path like ? or path like ?) and path like ? escape '\\'
      order by path limit 8
    `).all(`%${stem}%`, `%${base}%`, pathFilter) as Array<{ path: string }>;
    const relatedDocs = db.prepare(`
      select path from files
      where language = 'markdown' and (path like ? or path like ?) and path like ? escape '\\'
      order by path limit 8
    `).all(`%${stem}%`, `%${base}%`, pathFilter) as Array<{ path: string }>;
    const lastIndexedAt = (db.prepare("select value from meta where key='last_indexed_at'").get() as { value: string } | undefined)?.value ?? null;

    return {
      target,
      root: info.root,
      pathPrefix,
      lastIndexedAt,
      stale: (diagnostics as { stale?: boolean }).stale ?? false,
      changed: (diagnostics as { changed?: number }).changed ?? 0,
      missing: (diagnostics as { missing?: number }).missing ?? 0,
      deleted: (diagnostics as { deleted?: number }).deleted ?? 0,
      readFirst,
      relatedTests: relatedTests.map((r) => r.path),
      relatedDocs: relatedDocs.map((r) => r.path),
      warnings,
    };
  } finally {
    db.close();
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
