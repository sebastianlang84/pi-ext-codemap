import { posix } from "node:path";

import { snippet } from "./chunker.ts";
import { openRepoDb } from "./db.ts";
import { status } from "./indexer.ts";
import { getRepoInfo, type StateOptions } from "./repo.ts";
import { searchCodeMap } from "./search.ts";
import { normalizePathPrefix } from "./scanner.ts";
import type { SearchResult } from "./types.ts";

export interface CodeMapContextOptions extends StateOptions {
  target: string;
  cwd?: string;
  limit?: number;
  pathPrefix?: string;
}

export interface CodeMapReadFirstChunk {
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  kind: string;
  text: string;
  snippet: string;
}

export type CodeMapReadFirstItem = CodeMapReadFirstChunk | SearchResult;

export interface CodeMapContextPackage {
  target: string;
  root: string;
  pathPrefix: string;
  lastIndexedAt: string | null;
  stale: boolean;
  changed: number;
  missing: number;
  deleted: number;
  readFirst: CodeMapReadFirstItem[];
  relatedTests: string[];
  relatedDocs: string[];
  warnings: string[];
}

interface ContextDiagnostics {
  stale?: boolean;
  changed?: number;
  missing?: number;
  deleted?: number;
  warnings?: string[];
}

export function buildCodeMapContext(options: CodeMapContextOptions): CodeMapContextPackage {
  const info = getRepoInfo(options.cwd, { stateDir: options.stateDir });
  if (!info.approved) throw new Error("Repository is not approved/indexed yet.");
  const db = openRepoDb(info.dbPath);
  try {
    const request = normalizeContextRequest(options);
    const diagnostics = status(options.cwd, { health: "full", pathPrefix: request.pathPrefix, stateDir: options.stateDir }) as ContextDiagnostics;
    const warnings: string[] = [...(diagnostics.warnings ?? [])];
    const readFirst = readFirstItems(db, request, warnings, options.cwd, options.stateDir);
    const related = relatedPaths(db, readFirst.base, request.pathFilter);
    const items = readFirst.direct ? localReadFirstItems(db, readFirst.items, readFirst.imports, related.tests, related.docs, request.limit) : readFirst.items;
    const lastIndexedAt = (db.prepare("select value from meta where key='last_indexed_at'").get() as { value: string } | undefined)?.value ?? null;

    return {
      target: request.target,
      root: info.root,
      pathPrefix: request.pathPrefix,
      lastIndexedAt,
      stale: diagnostics.stale ?? false,
      changed: diagnostics.changed ?? 0,
      missing: diagnostics.missing ?? 0,
      deleted: diagnostics.deleted ?? 0,
      readFirst: items,
      relatedTests: related.tests,
      relatedDocs: related.docs,
      warnings,
    };
  } finally {
    db.close();
  }
}

function normalizeContextRequest(options: CodeMapContextOptions) {
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 25);
  const pathPrefix = normalizePathPrefix(options.pathPrefix);
  const target = options.target.trim();
  return {
    limit,
    pathPrefix,
    target,
    targetLike: `%${escapeLike(target)}%`,
    pathFilter: pathPrefix ? `${escapeLike(pathPrefix)}%` : "%",
  };
}

function readFirstItems(
  db: ReturnType<typeof openRepoDb>,
  request: ReturnType<typeof normalizeContextRequest>,
  warnings: string[],
  cwd?: string,
  stateDir?: string,
): { base: string; items: CodeMapReadFirstItem[]; imports: string[]; direct: boolean } {
  const file = db.prepare("select id, path, language from files where (path = ? or path like ? escape '\\') and path like ? escape '\\' limit 1")
    .get(request.target, request.targetLike, request.pathFilter) as { id: number; path: string; language: string } | undefined;

  if (!file) {
    warnings.push("Target was not an indexed file path; falling back to search results.");
    return {
      base: request.target,
      items: searchCodeMap({ query: request.target, cwd, limit: request.limit, pathPrefix: request.pathPrefix, stateDir }),
      imports: [],
      direct: false,
    };
  }

  const chunks = db.prepare("select start_line as startLine, end_line as endLine, kind, text from chunks where file_id=? order by ordinal limit ?")
    .all(file.id, Math.min(request.limit, 6)) as Array<{ startLine: number; endLine: number; kind: string; text: string }>;
  return {
    base: file.path,
    items: chunks.map((chunk) => ({ path: file.path, language: file.language, ...chunk, snippet: snippet(chunk.text) })),
    imports: importedLocalPaths(db, file.path, request.pathFilter),
    direct: true,
  };
}

function localReadFirstItems(db: ReturnType<typeof openRepoDb>, targetItems: CodeMapReadFirstItem[], imports: string[], tests: string[], docs: string[], limit: number): CodeMapReadFirstItem[] {
  const related = [...imports, tests[0], docs[0], ...tests.slice(1), ...docs.slice(1)].filter((path): path is string => Boolean(path));
  const relatedItems = related.flatMap((path) => firstChunkForPath(db, path));
  const items = targetItems.length > 0 ? [targetItems[0]] : [];
  items.push(...dedupeReadFirstItems(relatedItems, items).slice(0, Math.max(0, limit - items.length)));
  if (items.length < limit) items.push(...targetItems.slice(1, 1 + Math.max(0, limit - items.length)));
  return items.slice(0, limit);
}

function firstChunkForPath(db: ReturnType<typeof openRepoDb>, path: string): CodeMapReadFirstChunk[] {
  const row = db.prepare(`
    select f.path, f.language, c.start_line as startLine, c.end_line as endLine, c.kind, c.text
    from files f join chunks c on c.file_id = f.id
    where f.path = ?
    order by c.ordinal limit 1
  `).get(path) as ({ path: string; language: string; startLine: number; endLine: number; kind: string; text: string } | undefined);
  return row ? [{ ...row, snippet: snippet(row.text) }] : [];
}

function importedLocalPaths(db: ReturnType<typeof openRepoDb>, fromPath: string, pathFilter: string): string[] {
  const text = readIndexedSource(db, fromPath);
  if (!text) return [];
  const resolved = extractLocalModuleSpecifiers(text)
    .map((specifier) => resolveIndexedImport(db, fromPath, specifier, pathFilter))
    .filter((path): path is string => Boolean(path && path !== fromPath));
  return uniqueStrings(resolved).slice(0, 8);
}

function readIndexedSource(db: ReturnType<typeof openRepoDb>, path: string): string | undefined {
  const rows = db.prepare(`
    select c.text from files f join chunks c on c.file_id = f.id
    where f.path = ?
    order by c.ordinal
  `).all(path) as Array<{ text: string }>;
  return rows.length > 0 ? rows.map((row) => row.text).join("\n") : undefined;
}

function extractLocalModuleSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[\s\S]{0,500}?\bfrom\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const specifier = cleanModuleSpecifier(match[1] ?? "");
      if (specifier.startsWith(".")) specifiers.push(specifier);
    }
  }
  return uniqueStrings(specifiers);
}

function cleanModuleSpecifier(specifier: string): string {
  return specifier.split(/[?#]/, 1)[0].trim();
}

function resolveIndexedImport(db: ReturnType<typeof openRepoDb>, fromPath: string, specifier: string, pathFilter: string): string | undefined {
  const baseDir = posix.dirname(fromPath);
  const normalized = posix.normalize(posix.join(baseDir, specifier));
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.startsWith("/")) return undefined;
  for (const candidate of importCandidates(normalized)) {
    const row = db.prepare("select path from files where path = ? and path like ? escape '\\' limit 1")
      .get(candidate, pathFilter) as { path: string } | undefined;
    if (row) return row.path;
  }
  return undefined;
}

function importCandidates(path: string): string[] {
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".md", ".py"];
  const hasExtension = /\.[^/.]+$/.test(path);
  return uniqueStrings([
    path,
    ...(hasExtension ? [] : extensions.map((extension) => `${path}${extension}`)),
    ...extensions.map((extension) => `${path}/index${extension}`),
  ]);
}

function dedupeReadFirstItems(items: CodeMapReadFirstItem[], existing: CodeMapReadFirstItem[]): CodeMapReadFirstItem[] {
  const seen = new Set(existing.map((item) => item.path));
  return items.filter((item) => {
    if (seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
}

function relatedPaths(db: ReturnType<typeof openRepoDb>, base: string, pathFilter: string): { tests: string[]; docs: string[] } {
  const stem = base.split("/").pop()?.replace(/\.[^.]+$/, "") ?? base;
  const stemLike = `%${escapeLike(stem)}%`;
  const baseLike = `%${escapeLike(base)}%`;
  const relatedTests = db.prepare(`
    select path from files
    where (path like '%test%' or path like '%spec%') and (path like ? escape '\\' or path like ? escape '\\') and path like ? escape '\\'
    order by path
  `).all(stemLike, baseLike, pathFilter) as Array<{ path: string }>;
  const relatedDocs = db.prepare(`
    select path from files
    where language = 'markdown' and (path like ? escape '\\' or path like ? escape '\\') and path like ? escape '\\'
    order by path
  `).all(stemLike, baseLike, pathFilter) as Array<{ path: string }>;
  return {
    tests: sortByLocality(base, relatedTests.map((r) => r.path)).slice(0, 8),
    docs: sortByLocality(base, relatedDocs.map((r) => r.path)).slice(0, 8),
  };
}

function sortByLocality(base: string, paths: string[]): string[] {
  return paths.filter((path) => path !== base).sort((left, right) => localityScore(base, right) - localityScore(base, left) || left.localeCompare(right));
}

function localityScore(base: string, path: string): number {
  const baseDir = base.split("/").slice(0, -1);
  const pathDir = path.split("/").slice(0, -1);
  let shared = 0;
  while (shared < baseDir.length && shared < pathDir.length && baseDir[shared] === pathDir[shared]) shared++;
  const sameDir = baseDir.length === pathDir.length && shared === baseDir.length;
  const depthPenalty = Math.abs(baseDir.length - pathDir.length);
  return shared * 10 + (sameDir ? 5 : 0) - depthPenalty;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
