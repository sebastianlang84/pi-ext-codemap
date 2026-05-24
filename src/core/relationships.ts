import { openRepoDb } from "./db.ts";
import { hasGraphMetadata, incomingGraphDependencies, outgoingGraphDependencies } from "./graph-store.ts";
import { extractLocalReferences, resolveIndexedReference } from "./local-references.ts";
import { fileRoles } from "./ranking.ts";

export type CodeMapContextReasonKind =
  | "target"
  | "search_result"
  | "import"
  | "reverse_import"
  | "include"
  | "reverse_include"
  | "implementation_pair"
  | "near_config"
  | "same_dir"
  | "test_of"
  | "sibling_test"
  | "reverse_test"
  | "related_doc";

export interface CodeMapContextReason {
  kind: CodeMapContextReasonKind;
  label: string;
  sourcePath?: string;
  targetPath?: string;
  specifier?: string;
}

export interface RelatedPath {
  path: string;
  reasons: CodeMapContextReason[];
}

export interface IndexedRelationships {
  imports: RelatedPath[];
  importers: RelatedPath[];
  implementationPairs: RelatedPath[];
}

export function findIndexedRelationships(db: ReturnType<typeof openRepoDb>, targetPath: string, pathFilter: string): IndexedRelationships {
  return {
    imports: importedLocalPaths(db, targetPath, pathFilter),
    importers: importingLocalPaths(db, targetPath, pathFilter),
    implementationPairs: implementationPairPaths(db, targetPath, pathFilter),
  };
}

export function mergeRelatedPaths(paths: RelatedPath[]): RelatedPath[] {
  const byPath = new Map<string, RelatedPath>();
  for (const item of paths) {
    const existing = byPath.get(item.path);
    if (!existing) {
      byPath.set(item.path, { path: item.path, reasons: dedupeReasons(item.reasons) });
      continue;
    }
    existing.reasons = dedupeReasons([...existing.reasons, ...item.reasons]);
  }
  return [...byPath.values()];
}

export function targetReason(path: string): CodeMapContextReason {
  return { kind: "target", label: "direct target file", targetPath: path };
}

export function searchResultReason(target: string): CodeMapContextReason {
  return { kind: "search_result", label: "fallback search result", specifier: target };
}

export function sameDirReason(targetPath: string, path: string): CodeMapContextReason {
  return { kind: "same_dir", label: "same-directory source file", sourcePath: path, targetPath };
}

export function testOfReason(testPath: string, path: string): CodeMapContextReason {
  return { kind: "test_of", label: "source file tested by target", sourcePath: testPath, targetPath: path };
}

export function relatedTestReason(targetPath: string, path: string): CodeMapContextReason {
  return { kind: "sibling_test", label: "name/path-related test", sourcePath: path, targetPath };
}

export function reverseTestReason(targetPath: string, path: string): CodeMapContextReason {
  return { kind: "reverse_test", label: "test file imports target", sourcePath: path, targetPath };
}

export function relatedDocReason(targetPath: string, path: string): CodeMapContextReason {
  return { kind: "related_doc", label: "name/path-related documentation", sourcePath: path, targetPath };
}

export function nearConfigReason(targetPath: string, path: string): CodeMapContextReason {
  return { kind: "near_config", label: "nearby configuration file", sourcePath: path, targetPath };
}

export function isConfigReadFirstPath(path: string, size = 0): boolean {
  const lowerPath = path.toLowerCase();
  const basename = lowerPath.split("/").pop() ?? lowerPath;
  const roles = fileRoles(lowerPath, size);
  return roles.includes("configuration")
    || /(?:^|[._-])config(?:[._-]|\.|$)/.test(basename)
    || /\.config\.[cm]?[jt]sx?$/.test(basename);
}

export function isNoisyReadFirstPath(path: string, size = 0): boolean {
  const roles = fileRoles(path.toLowerCase(), size);
  return roles.some((role) => ["lockfile", "generated", "build_output", "minified", "large_json"].includes(role));
}

export function isTestReadFirstPath(path: string): boolean {
  const lowerPath = path.toLowerCase();
  const basename = lowerPath.split("/").pop() ?? lowerPath;
  return /(?:^|\/)(?:__tests__|tests?|spec)(?:\/|$)/.test(lowerPath)
    || /(?:^|[._-])(?:test|spec)(?:[._-]|\.|$)/.test(basename);
}

export function isNoisyIndexedPath(db: ReturnType<typeof openRepoDb>, path: string): boolean {
  const row = db.prepare("select size from files where path = ?").get(path) as { size: number } | undefined;
  return isNoisyReadFirstPath(path, row?.size ?? 0);
}

function importedLocalPaths(db: ReturnType<typeof openRepoDb>, fromPath: string, pathFilter: string): RelatedPath[] {
  if (!hasGraphMetadata(db)) return legacyImportedLocalPaths(db, fromPath, pathFilter);
  const resolved = outgoingGraphDependencies(db, fromPath, pathFilter)
    .map((dependency) => {
      if (dependency.targetPath === fromPath || isNoisyIndexedPath(db, dependency.targetPath)) return undefined;
      const reasons: CodeMapContextReason[] = [{
        kind: dependency.kind,
        label: dependency.kind === "include" ? "quoted local include" : "local import",
        sourcePath: fromPath,
        targetPath: dependency.targetPath,
        specifier: dependency.specifier,
      }];
      if (isTestReadFirstPath(fromPath) && !isTestReadFirstPath(dependency.targetPath)) reasons.push(testOfReason(fromPath, dependency.targetPath));
      return { path: dependency.targetPath, reasons };
    })
    .filter((path): path is RelatedPath => Boolean(path));
  return mergeRelatedPaths(resolved).slice(0, 8);
}

function importingLocalPaths(db: ReturnType<typeof openRepoDb>, targetPath: string, pathFilter: string): RelatedPath[] {
  if (!hasGraphMetadata(db)) return legacyImportingLocalPaths(db, targetPath, pathFilter);
  const importers = incomingGraphDependencies(db, targetPath, pathFilter)
    .map((dependency) => {
      if (dependency.sourcePath === targetPath || isNoisyIndexedPath(db, dependency.sourcePath)) return undefined;
      const reasons: CodeMapContextReason[] = [{
        kind: dependency.kind === "include" ? "reverse_include" : "reverse_import",
        label: dependency.kind === "include" ? "file includes target" : "file imports target",
        sourcePath: dependency.sourcePath,
        targetPath,
        specifier: dependency.specifier,
      }];
      if (isTestReadFirstPath(dependency.sourcePath) && !isTestReadFirstPath(targetPath)) reasons.push(reverseTestReason(targetPath, dependency.sourcePath));
      return { path: dependency.sourcePath, reasons };
    })
    .filter((path): path is RelatedPath => Boolean(path));
  return mergeRelatedPaths(sortRelatedByLocality(targetPath, importers)).slice(0, 8);
}

function legacyImportedLocalPaths(db: ReturnType<typeof openRepoDb>, fromPath: string, pathFilter: string): RelatedPath[] {
  const source = readIndexedSource(db, fromPath);
  if (!source) return [];
  const resolved = extractLocalReferences(source.text, source.language, source.path)
    .map((reference) => {
      const targetPath = resolveIndexedReference(db, fromPath, source.language, reference, pathFilter);
      if (!targetPath || targetPath === fromPath || isNoisyIndexedPath(db, targetPath)) return undefined;
      const reasons: CodeMapContextReason[] = [{
        kind: reference.kind,
        label: reference.kind === "include" ? "quoted local include" : "local import",
        sourcePath: fromPath,
        targetPath,
        specifier: reference.specifier,
      }];
      if (isTestReadFirstPath(fromPath) && !isTestReadFirstPath(targetPath)) reasons.push(testOfReason(fromPath, targetPath));
      const related: RelatedPath = { path: targetPath, reasons };
      return related;
    })
    .filter((path): path is RelatedPath => Boolean(path));
  return mergeRelatedPaths(resolved).slice(0, 8);
}

function legacyImportingLocalPaths(db: ReturnType<typeof openRepoDb>, targetPath: string, pathFilter: string): RelatedPath[] {
  const rows = db.prepare("select path, size from files where path <> ? and path like ? escape '\\' order by path")
    .all(targetPath, pathFilter) as Array<{ path: string; size: number }>;
  const importers = rows
    .filter((row) => !isNoisyReadFirstPath(row.path, row.size))
    .flatMap((row) => indexedFileReferencesTarget(db, row.path, targetPath, pathFilter));
  return mergeRelatedPaths(sortRelatedByLocality(targetPath, importers)).slice(0, 8);
}

function indexedFileReferencesTarget(db: ReturnType<typeof openRepoDb>, fromPath: string, targetPath: string, pathFilter: string): RelatedPath[] {
  const source = readIndexedSource(db, fromPath);
  if (!source) return [];
  return extractLocalReferences(source.text, source.language, source.path)
    .map((reference) => {
      const resolved = resolveIndexedReference(db, fromPath, source.language, reference, pathFilter);
      if (resolved !== targetPath) return undefined;
      const reasons: CodeMapContextReason[] = [{
        kind: reference.kind === "include" ? "reverse_include" : "reverse_import",
        label: reference.kind === "include" ? "file includes target" : "file imports target",
        sourcePath: fromPath,
        targetPath,
        specifier: reference.specifier,
      }];
      if (isTestReadFirstPath(fromPath) && !isTestReadFirstPath(targetPath)) reasons.push(reverseTestReason(targetPath, fromPath));
      const related: RelatedPath = { path: fromPath, reasons };
      return related;
    })
    .filter((path): path is RelatedPath => Boolean(path));
}

function implementationPairPaths(db: ReturnType<typeof openRepoDb>, targetPath: string, pathFilter: string): RelatedPath[] {
  return mergeRelatedPaths([
    ...headerImplementationPairPaths(db, targetPath, pathFilter),
    ...routeHandlerConventionPaths(db, targetPath, pathFilter),
  ]).slice(0, 8);
}

function headerImplementationPairPaths(db: ReturnType<typeof openRepoDb>, targetPath: string, pathFilter: string): RelatedPath[] {
  const extension = targetPath.match(/\.[^.\/]+$/)?.[0]?.toLowerCase();
  const headerExtensions = new Set([".h", ".hh", ".hpp", ".hxx"]);
  const sourceExtensions = new Set([".c", ".cc", ".cpp", ".cxx"]);
  if (!extension || (!headerExtensions.has(extension) && !sourceExtensions.has(extension))) return [];

  const stem = targetPath.slice(0, -extension.length);
  const candidateExtensions = headerExtensions.has(extension) ? [...sourceExtensions] : [...headerExtensions];
  const rows = candidateExtensions
    .map((candidateExtension) => `${stem}${candidateExtension}`)
    .map((path) => db.prepare("select path, size from files where path = ? and path like ? escape '\\' limit 1").get(path, pathFilter) as { path: string; size: number } | undefined)
    .filter((row): row is { path: string; size: number } => Boolean(row && !isNoisyReadFirstPath(row.path, row.size)));

  return rows.map((row) => ({
    path: row.path,
    reasons: [{ kind: "implementation_pair", label: "matching header/source file", sourcePath: targetPath, targetPath: row.path }],
  }));
}

function routeHandlerConventionPaths(db: ReturnType<typeof openRepoDb>, targetPath: string, pathFilter: string): RelatedPath[] {
  const pairs = isRouteAdapterPath(targetPath)
    ? routeHandlerCandidatesForRoute(db, targetPath, pathFilter)
    : isRouteHandlerPath(targetPath)
      ? routeAdapterCandidatesForHandler(db, targetPath, pathFilter)
      : [];

  return sortRelatedByLocality(targetPath, pairs.map((path) => ({
    path,
    reasons: [{ kind: "implementation_pair", label: "matching route/handler file", sourcePath: targetPath, targetPath: path }],
  }))).slice(0, 4);
}

function routeHandlerCandidatesForRoute(db: ReturnType<typeof openRepoDb>, routePath: string, pathFilter: string): string[] {
  const routeTerms = routeAdapterTerms(routePath);
  if (routeTerms.length === 0) return [];
  return candidateSourceFiles(db, routePath, pathFilter)
    .filter((row) => isRouteHandlerPath(row.path) && hasAllTerms(row.path, routeTerms))
    .map((row) => row.path);
}

function routeAdapterCandidatesForHandler(db: ReturnType<typeof openRepoDb>, handlerPath: string, pathFilter: string): string[] {
  const handlerTerms = pathTerms(handlerPath);
  return candidateSourceFiles(db, handlerPath, pathFilter)
    .filter((row) => isRouteAdapterPath(row.path))
    .filter((row) => {
      const routeTerms = routeAdapterTerms(row.path);
      return routeTerms.length > 0 && routeTerms.every((term) => handlerTerms.has(term) || handlerTerms.has(singular(term)));
    })
    .map((row) => row.path);
}

function candidateSourceFiles(db: ReturnType<typeof openRepoDb>, targetPath: string, pathFilter: string): Array<{ path: string; size: number }> {
  return (db.prepare("select path, size from files where path <> ? and path like ? escape '\\' order by path")
    .all(targetPath, pathFilter) as Array<{ path: string; size: number }>)
    .filter((row) => isCodePath(row.path) && !isNoisyReadFirstPath(row.path, row.size) && !isConfigReadFirstPath(row.path, row.size) && !isTestReadFirstPath(row.path));
}

function isRouteAdapterPath(path: string): boolean {
  return /(?:^|\/)app\/api\/.+\/route\.[cm]?[jt]sx?$/i.test(path);
}

function isRouteHandlerPath(path: string): boolean {
  const basename = path.toLowerCase().split("/").pop() ?? path.toLowerCase();
  return /(?:^|[._-])handler(?:[._-]|\.|$)/.test(basename);
}

function routeAdapterTerms(path: string): string[] {
  const match = path.toLowerCase().match(/(?:^|\/)app\/api\/(.+)\/route\.[cm]?[jt]sx?$/);
  if (!match) return [];
  return uniqueStrings(match[1].split(/[^a-z0-9]+/).map(normalizeRouteTerm).filter((term) => term.length >= 3 && !routeTermNoise.has(term)));
}

function hasAllTerms(path: string, terms: string[]): boolean {
  const candidateTerms = pathTerms(path);
  return terms.every((term) => candidateTerms.has(term) || candidateTerms.has(singular(term)));
}

function pathTerms(path: string): Set<string> {
  return new Set(path.toLowerCase().split(/[^a-z0-9]+/).map(normalizeRouteTerm).filter((term) => term.length >= 3));
}

function normalizeRouteTerm(term: string): string {
  return singular(term.replace(/^\[+|\]+$/g, ""));
}

function singular(term: string): string {
  return term.endsWith("s") && term.length > 4 ? term.slice(0, -1) : term;
}

function isCodePath(path: string): boolean {
  return /\.[cm]?[jt]sx?$/i.test(path);
}

const routeTermNoise = new Set(["app", "api", "route", "handler", "src", "web", "lib", "server"]);

function readIndexedSource(db: ReturnType<typeof openRepoDb>, path: string): { path: string; language: string; text: string } | undefined {
  const rows = db.prepare(`
    select f.path, f.language, c.text from files f join chunks c on c.file_id = f.id
    where f.path = ?
    order by c.ordinal
  `).all(path) as Array<{ path: string; language: string; text: string }>;
  return rows.length > 0 ? { path: rows[0].path, language: rows[0].language, text: rows.map((row) => row.text).join("\n") } : undefined;
}

function sortRelatedByLocality(base: string, paths: RelatedPath[]): RelatedPath[] {
  return paths.filter((path) => path.path !== base).sort((left, right) => localityScore(base, right.path) - localityScore(base, left.path) || left.path.localeCompare(right.path));
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeReasons(reasons: CodeMapContextReason[]): CodeMapContextReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.kind}:${reason.sourcePath ?? ""}:${reason.targetPath ?? ""}:${reason.specifier ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
