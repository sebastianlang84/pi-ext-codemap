import { snippet } from "./chunker.ts";
import { openRepoDb } from "./db.ts";
import { fullIndexHealth, readIndexStatusCounts } from "./index-health.ts";
import {
  findIndexedRelationships,
  isConfigReadFirstPath,
  isNoisyIndexedPath,
  isNoisyReadFirstPath,
  isTestReadFirstPath,
  mergeRelatedPaths,
  nearConfigReason,
  relatedDocReason,
  relatedTestReason,
  sameDirReason,
  searchResultReason,
  targetReason,
  testOfReason,
  type CodeMapContextReason,
  type RelatedPath,
} from "./relationships.ts";
import { getRepoInfo, type StateOptions } from "./repo.ts";
import { NotApprovedError } from "./errors.ts";
import { searchCodeMap } from "./search.ts";
import { normalizePathPrefix } from "./scanner.ts";
import { escapeLike, localityScore, uniqueStrings } from "./text-util.ts";
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
  reasons?: CodeMapContextReason[];
}

export type CodeMapReadFirstItem = (CodeMapReadFirstChunk | SearchResult) & { reasons?: CodeMapContextReason[] };

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
  lastIndexedAt?: string | null;
  stale?: boolean;
  changed?: number;
  missing?: number;
  deleted?: number;
  warnings?: string[];
}

export function buildCodeMapContext(options: CodeMapContextOptions): CodeMapContextPackage {
  const info = getRepoInfo(options.cwd, { stateDir: options.stateDir });
  if (!info.approved) throw new NotApprovedError();
  const db = openRepoDb(info.dbPath);
  try {
    const request = normalizeContextRequest(options);
    // Full (content-hashing) health, because context returns read-first file *content* and must warn
    // when that content has drifted (unlike search, where path staleness is only advisory). Computed
    // on the already-open db handle + resolved repo root instead of calling status(), which would
    // re-resolve repo info and open a second db connection for the same work.
    const counts = readIndexStatusCounts(db, request.pathPrefix);
    const health = fullIndexHealth(db, info.root, request.pathPrefix);
    const diagnostics: ContextDiagnostics = {
      lastIndexedAt: counts.lastIndexedAt,
      stale: health.stale,
      changed: health.changed,
      missing: health.missing,
      deleted: health.deleted,
      warnings: health.warnings,
    };
    const warnings: string[] = [...(diagnostics.warnings ?? [])];
    const readFirst = readFirstItems(db, request, warnings, options.cwd, options.stateDir);
    const related = relatedPaths(db, readFirst.base, request.pathFilter);
    const relationships = readFirst.direct ? findIndexedRelationships(db, readFirst.base, request.pathFilter) : { imports: [], importers: [], implementationPairs: [] };
    const importedNeighborTests = readFirst.direct ? importedNeighborTestPaths(db, relationships.imports, request.pathFilter) : [];
    const importerNeighborTests = readFirst.direct ? importerNeighborTestPaths(db, relationships.importers, request.pathFilter) : [];
    const implementationPairNeighborTests = readFirst.direct ? implementationPairNeighborTestPaths(db, relationships.implementationPairs, request.pathFilter) : [];
    const items = readFirst.direct
      ? localReadFirstItems(db, {
          targetItems: readFirst.items,
          imports: relationships.imports,
          importedNeighborTests,
          importerNeighborTests,
          implementationPairNeighborTests,
          implementationPairs: relationships.implementationPairs,
          importers: relationships.importers,
          configs: related.configs,
          tests: related.tests,
          docs: related.docs,
          sameDir: related.sameDir,
          testOf: related.testOf,
          limit: request.limit,
        })
      : readFirst.items;
    const lastIndexedAt = diagnostics.lastIndexedAt ?? null;

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
): { base: string; items: CodeMapReadFirstItem[]; direct: boolean } {
  // Deterministic target resolution: an exact path wins, then the shortest path, then lexicographic.
  // Without ORDER BY the old `limit 1` returned whichever row SQLite scanned first — for an ambiguous
  // basename (e.g. two `operations.ts`) that anchor was unspecified, the exact "wrong-anchor" failure
  // the confidence logic warns about. `limit 6` bounds the query for pathological broad targets.
  const matches = db.prepare(
    "select id, path, language from files where (path = ? or path like ? escape '\\') and path like ? escape '\\' " +
      "order by (path = ?) desc, length(path), path limit 6",
  ).all(request.target, request.targetLike, request.pathFilter, request.target) as Array<{ id: number; path: string; language: string }>;
  const file = matches[0];
  if (matches.length > 1) {
    const alternatives = matches.slice(1, 4).map((match) => match.path).join(", ");
    const count = matches.length >= 6 ? "6 or more" : String(matches.length);
    warnings.push(`Ambiguous target "${request.target}" matched ${count} indexed files; using ${file.path}. Other matches: ${alternatives}${matches.length > 4 ? ", …" : ""}`);
  }

  if (!file) {
    warnings.push("Target was not an indexed file path; falling back to search results.");
    return {
      base: request.target,
      items: searchCodeMap({ query: request.target, cwd, limit: request.limit, pathPrefix: request.pathPrefix, stateDir })
        .map((item) => ({ ...item, reasons: [searchResultReason(request.target)] })),
      direct: false,
    };
  }

  const chunks = db.prepare("select start_line as startLine, end_line as endLine, kind, text from chunks where file_id=? order by ordinal limit ?")
    .all(file.id, Math.min(request.limit, 6)) as Array<{ startLine: number; endLine: number; kind: string; text: string }>;
  return {
    base: file.path,
    items: chunks.map((chunk) => ({ path: file.path, language: file.language, ...chunk, snippet: snippet(chunk.text), reasons: [targetReason(file.path)] })),
    direct: true,
  };
}

interface LocalReadFirstInput {
  targetItems: CodeMapReadFirstItem[];
  imports: RelatedPath[];
  importedNeighborTests: RelatedPath[];
  importerNeighborTests: RelatedPath[];
  implementationPairNeighborTests: RelatedPath[];
  implementationPairs: RelatedPath[];
  importers: RelatedPath[];
  configs: RelatedPath[];
  tests: string[];
  docs: string[];
  sameDir: RelatedPath[];
  testOf: RelatedPath[];
  limit: number;
}

function localReadFirstItems(db: ReturnType<typeof openRepoDb>, input: LocalReadFirstInput): CodeMapReadFirstItem[] {
  const {
    targetItems, imports, importedNeighborTests, importerNeighborTests, implementationPairNeighborTests,
    implementationPairs, importers, configs, tests, docs, sameDir, testOf, limit,
  } = input;
  const targetPath = targetItems[0]?.path ?? "";
  const testItems = tests.map((path) => ({ path, reasons: [relatedTestReason(targetPath, path)] }));
  const docItems = docs.map((path) => ({ path, reasons: [relatedDocReason(targetPath, path)] }));
  const primaryImports = imports.slice(0, 2);
  const laterImports = imports.slice(2);
  const routeAdapterImporters = importers.filter((item) => isRouteAdapterPath(item.path));
  const nonRouteImporters = importers.filter((item) => !routeAdapterImporters.some((route) => route.path === item.path));
  const affineImporters = nonRouteImporters.filter((item) => hasStemAffinity(stemWithoutExtension(targetPath), stemWithoutExtension(item.path)));
  const otherImporters = nonRouteImporters.filter((item) => !affineImporters.some((affine) => affine.path === item.path));
  const strongRelated = mergeRelatedPaths([
    ...(routeAdapterImporters[0] ? [routeAdapterImporters[0]] : []),
    ...primaryImports,
    ...implementationPairs,
    ...implementationPairNeighborTests,
    ...(testItems[0] ? [testItems[0]] : []),
    ...(affineImporters[0] ? [affineImporters[0]] : []),
    ...importedNeighborTests,
    ...importerNeighborTests,
    ...(otherImporters[0] ? [otherImporters[0]] : []),
    ...(testOf[0] ? [testOf[0]] : []),
    ...(configs[0] ? [configs[0]] : []),
    ...(docItems[0] ? [docItems[0]] : []),
    ...laterImports,
    ...routeAdapterImporters.slice(1),
    ...affineImporters.slice(1),
    ...otherImporters.slice(1),
    ...testOf.slice(1),
    ...configs.slice(1),
    ...testItems.slice(1),
    ...docItems.slice(1),
  ]).filter((item) => !isNoisyIndexedPath(db, item.path));
  const strongPaths = new Set(strongRelated.map((item) => item.path));
  const sameDirItems = sameDir.filter((item) => !strongPaths.has(item.path) && !isNoisyIndexedPath(db, item.path));
  const strongItems = strongRelated.flatMap((item) => firstChunkForPath(db, item));
  const weakItems = sameDirItems.flatMap((item) => firstChunkForPath(db, item));
  const laterTargetItems = targetItems.slice(1);
  const items = targetItems.length > 0 ? [targetItems[0]] : [];
  items.push(...dedupeReadFirstItems(strongItems, items).slice(0, Math.max(0, limit - items.length)));
  if (items.length < limit) items.push(...dedupeReadFirstItems(weakItems, items).slice(0, Math.max(0, limit - items.length)));
  if (items.length < limit) items.push(...laterTargetItems.slice(0, Math.max(0, limit - items.length)));
  return items.slice(0, limit);
}

function firstChunkForPath(db: ReturnType<typeof openRepoDb>, item: RelatedPath): CodeMapReadFirstChunk[] {
  const row = db.prepare(`
    select f.path, f.language, c.start_line as startLine, c.end_line as endLine, c.kind, c.text
    from files f join chunks c on c.file_id = f.id
    where f.path = ?
    order by c.ordinal limit 1
  `).get(item.path) as ({ path: string; language: string; startLine: number; endLine: number; kind: string; text: string } | undefined);
  return row ? [{ ...row, snippet: snippet(row.text), reasons: item.reasons }] : [];
}

function dedupeReadFirstItems(items: CodeMapReadFirstItem[], existing: CodeMapReadFirstItem[]): CodeMapReadFirstItem[] {
  const seen = new Set(existing.map((item) => item.path));
  return items.filter((item) => {
    if (seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
}

function relatedPaths(db: ReturnType<typeof openRepoDb>, base: string, pathFilter: string): { configs: RelatedPath[]; tests: string[]; docs: string[]; sameDir: RelatedPath[]; testOf: RelatedPath[] } {
  const stem = base.split("/").pop()?.replace(/\.[^.]+$/, "") ?? base;
  const stemLike = `%${escapeLike(stem)}%`;
  const baseLike = `%${escapeLike(base)}%`;
  const relatedDocs = db.prepare(`
    select path, size from files
    where language = 'markdown' and (path like ? escape '\\' or path like ? escape '\\') and path like ? escape '\\'
    order by path
  `).all(stemLike, baseLike, pathFilter) as Array<{ path: string; size: number }>;
  const overviewDocs = db.prepare(`
    select path, size from files
    where language = 'markdown' and (lower(path) = 'readme.md' or lower(path) like '%/readme.md') and path like ? escape '\\'
    order by length(path), path
  `).all(pathFilter) as Array<{ path: string; size: number }>;
  const possibleConfigs = db.prepare(`
    select path, size from files
    where path <> ? and path like ? escape '\\'
    order by path
  `).all(base, pathFilter) as Array<{ path: string; size: number }>;
  const configs = sortByLocality(
    base,
    possibleConfigs
      .filter((row) => isNearbyConfigPath(base, row.path, row.size))
      .map((row) => row.path),
  ).slice(0, 8).map((path) => ({ path, reasons: [nearConfigReason(base, path)] }));
  const sameDir = sortByLocality(
    base,
    sameDirSourcePaths(base, possibleConfigs),
  ).slice(0, 8).map((path) => ({ path, reasons: [sameDirReason(base, path)] }));
  const testOf = isTestReadFirstPath(base)
    ? sortByLocality(base, possibleConfigs.filter((row) => isLikelySourceUnderTest(base, row.path, row.size)).map((row) => row.path))
      .slice(0, 8)
      .map((path) => ({ path, reasons: [testOfReason(base, path)] }))
    : [];
  return {
    configs,
    tests: findRelatedTestPaths(db, base, pathFilter),
    docs: sortByLocality(base, uniqueStrings((relatedDocs.length > 0 ? relatedDocs : overviewDocs).filter((row) => !isNoisyReadFirstPath(row.path, row.size)).map((row) => row.path))).slice(0, 8),
    sameDir,
    testOf,
  };
}

function importedNeighborTestPaths(db: ReturnType<typeof openRepoDb>, imports: RelatedPath[], pathFilter: string): RelatedPath[] {
  return mergeRelatedPaths(
    imports.slice(0, 2).flatMap((item) => findRelatedTestPaths(db, item.path, pathFilter)
      .slice(0, 1)
      .map((path) => ({ path, reasons: [relatedTestReason(item.path, path)] }))),
  ).slice(0, 1);
}

function importerNeighborTestPaths(db: ReturnType<typeof openRepoDb>, importers: RelatedPath[], pathFilter: string): RelatedPath[] {
  return mergeRelatedPaths(
    importers.filter((item) => !isTestReadFirstPath(item.path)).slice(0, 2).flatMap((item) => findRelatedTestPaths(db, item.path, pathFilter)
      .slice(0, 1)
      .map((path) => ({ path, reasons: [relatedTestReason(item.path, path)] }))),
  ).slice(0, 1);
}

function implementationPairNeighborTestPaths(db: ReturnType<typeof openRepoDb>, implementationPairs: RelatedPath[], pathFilter: string): RelatedPath[] {
  return mergeRelatedPaths(
    implementationPairs.filter((item) => !isTestReadFirstPath(item.path)).slice(0, 2).flatMap((item) => findRelatedTestPaths(db, item.path, pathFilter)
      .slice(0, 1)
      .map((path) => ({ path, reasons: [relatedTestReason(item.path, path)] }))),
  ).slice(0, 1);
}

function findRelatedTestPaths(db: ReturnType<typeof openRepoDb>, base: string, pathFilter: string): string[] {
  const stem = base.split("/").pop()?.replace(/\.[^.]+$/, "") ?? base;
  const stemLike = `%${escapeLike(stem)}%`;
  const baseLike = `%${escapeLike(base)}%`;
  const rows = db.prepare(`
    select path, size from files
    where (path like '%test%' or path like '%spec%') and (path like ? escape '\\' or path like ? escape '\\') and path like ? escape '\\'
    order by path
  `).all(stemLike, baseLike, pathFilter) as Array<{ path: string; size: number }>;
  return sortByLocality(base, rows.filter((row) => isTestReadFirstPath(row.path) && !isNoisyReadFirstPath(row.path, row.size)).map((row) => row.path)).slice(0, 8);
}

function sameDirSourcePaths(base: string, rows: Array<{ path: string; size: number }>): string[] {
  return rows
    .filter((row) => isSameDirSourceNeighbor(base, row.path, row.size))
    .map((row) => row.path);
}

function isRouteAdapterPath(path: string): boolean {
  return /(?:^|\/)app\/api\/.+\/route\.[cm]?[jt]sx?$/i.test(path);
}

function isSameDirSourceNeighbor(base: string, path: string, size: number): boolean {
  if (dirname(path) !== dirname(base)) return false;
  if (isNoisyReadFirstPath(path, size) || isConfigReadFirstPath(path, size) || isTestReadFirstPath(path) || isMarkdownPath(path)) return false;
  return hasStemAffinity(stemWithoutExtension(base), stemWithoutExtension(path));
}

function isLikelySourceUnderTest(testPath: string, path: string, size: number): boolean {
  if (path === testPath || isNoisyReadFirstPath(path, size) || isTestReadFirstPath(path) || isConfigReadFirstPath(path, size) || isMarkdownPath(path)) return false;
  return dirname(path) === dirname(testPath) && stemWithoutTestMarker(testPath) === stemWithoutExtension(path);
}

function isNearbyConfigPath(base: string, path: string, size: number): boolean {
  if (isNoisyReadFirstPath(path, size) || !isConfigReadFirstPath(path, size)) return false;
  const baseDir = dirname(base);
  const pathDir = dirname(path);
  const stem = base.split("/").pop()?.replace(/\.[^.]+$/, "").toLowerCase() ?? base.toLowerCase();
  const basename = path.split("/").pop()?.toLowerCase() ?? path.toLowerCase();
  return pathDir === baseDir || basename.includes(stem) || /^docker-compose(?:[.-].*)?\.ya?ml$/.test(basename);
}

function dirname(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md") || path.toLowerCase().endsWith(".mdx");
}

function stemWithoutExtension(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "").toLowerCase();
}

function stemWithoutTestMarker(path: string): string {
  return stemWithoutExtension(path).replace(/(?:[._-](?:test|spec)|(?:test|spec)[._-])$/i, "");
}

function hasStemAffinity(baseStem: string, candidateStem: string): boolean {
  if (baseStem === candidateStem) return false;
  return candidateStem.startsWith(`${baseStem}.`)
    || candidateStem.startsWith(`${baseStem}-`)
    || candidateStem.startsWith(`${baseStem}_`)
    || baseStem.startsWith(`${candidateStem}.`)
    || baseStem.startsWith(`${candidateStem}-`)
    || baseStem.startsWith(`${candidateStem}_`);
}

function sortByLocality(base: string, paths: string[]): string[] {
  return paths.filter((path) => path !== base).sort((left, right) => localityScore(base, right) - localityScore(base, left) || left.localeCompare(right));
}

