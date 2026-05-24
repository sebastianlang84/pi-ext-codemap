// The scripted eval models an agent that sees search results before context output:
// keep the top search hit, then let high-confidence context neighbors displace lower hits.
type ContextPathInput = string | { path: string; reasons?: Array<{ kind: string; targetPath?: string }> };

interface ContextEntry {
  path: string;
  reasons: string[];
  siblingTestTargetPaths: string[];
}

export function mergeSearchContextReadPlan(searchPaths: string[], contextPaths: ContextPathInput[], limit: number): string[] {
  const cappedLimit = Math.max(0, Math.floor(limit));
  if (cappedLimit === 0) return [];
  const contextEntries = contextPaths.map(toContextEntry).filter((item) => item.path);
  const [firstSearchPath, ...laterSearchPaths] = searchPaths;
  const searchPathSet = new Set(searchPaths);
  const routeAdapterEntry = isRouteAdapterPath(firstSearchPath ?? "");
  const prioritizedConfigs = contextEntries.filter((item) => isRelatedConfig(item) && !searchPathSet.has(item.path));
  const prioritizedTests = contextEntries.filter((item) => isRelatedTest(item, searchPathSet) && !searchPathSet.has(item.path));
  const hasCompetingDocOrConfig = laterSearchPaths.some(isDocumentationPath) || contextEntries.some((item) => isRelatedDoc(item) || isAnyConfig(item));
  const directImportCandidates = contextEntries.filter((item) => isDirectImport(item) && (routeAdapterEntry || !searchPaths.includes(item.path)));
  const prioritizedDirectImports = routeAdapterEntry
    ? sortByPathAffinity(directImportCandidates, firstSearchPath ?? "").slice(0, 1)
    : prioritizedConfigs.length === 0 && prioritizedTests.length === 0 && !hasCompetingDocOrConfig
      ? directImportCandidates.slice(0, 1)
      : [];
  const directImportPathSet = new Set([...searchPaths, ...prioritizedDirectImports.map((item) => item.path)]);
  const prioritizedDirectImportTests = prioritizedDirectImports.length > 0
    ? contextEntries.filter((item) => isRelatedTest(item, directImportPathSet) && !searchPathSet.has(item.path) && !prioritizedDirectImports.some((priority) => priority.path === item.path)).slice(0, 1)
    : [];
  const prioritizedContext = [...prioritizedConfigs, ...prioritizedTests, ...prioritizedDirectImports, ...prioritizedDirectImportTests];
  const remainingContext = contextEntries.filter((item) => !prioritizedContext.some((priority) => priority.path === item.path));
  const contextByPath = new Map(contextEntries.map((item) => [item.path, item]));
  const contextBackedSearchPaths = laterSearchPaths.filter((path) => isContextBackedSearchHit(contextByPath.get(path)));
  const remainingSearchPaths = laterSearchPaths.filter((path) => !contextBackedSearchPaths.includes(path));
  const activeSearchPaths = remainingSearchPaths.filter((path) => !isArchivedDocumentationPath(path));
  const archivedSearchPaths = remainingSearchPaths.filter(isArchivedDocumentationPath);
  return uniquePaths([
    firstSearchPath,
    ...(routeAdapterEntry ? prioritizedDirectImports.map((item) => item.path) : []),
    ...(routeAdapterEntry ? prioritizedDirectImportTests.map((item) => item.path) : []),
    ...(routeAdapterEntry ? [] : prioritizedConfigs.map((item) => item.path)),
    ...prioritizedTests.map((item) => item.path),
    ...contextBackedSearchPaths,
    ...(routeAdapterEntry ? [] : prioritizedDirectImports.map((item) => item.path)),
    ...(routeAdapterEntry ? [] : prioritizedDirectImportTests.map((item) => item.path)),
    ...activeSearchPaths,
    ...(routeAdapterEntry ? prioritizedConfigs.map((item) => item.path) : []),
    ...remainingContext.map((item) => item.path),
    ...archivedSearchPaths,
  ]).slice(0, cappedLimit);
}

function toContextEntry(input: ContextPathInput): ContextEntry {
  if (typeof input === "string") {
    return { path: input, reasons: [], siblingTestTargetPaths: [] };
  }

  return {
    path: input.path,
    reasons: input.reasons?.map((reason) => reason.kind) ?? [],
    siblingTestTargetPaths: input.reasons?.filter((reason) => reason.kind === "sibling_test" && reason.targetPath).map((reason) => reason.targetPath as string) ?? [],
  };
}

function isRelatedTest(item: ContextEntry, searchPathSet: Set<string>): boolean {
  return item.reasons.some((reason) => reason === "reverse_test" || reason === "test_of")
    || item.siblingTestTargetPaths.some((targetPath) => searchPathSet.has(targetPath));
}

function isRelatedConfig(item: { path: string; reasons: string[] }): boolean {
  return /^docker-compose(?:[.-].*)?\.ya?ml$/.test(item.path.split("/").pop() ?? item.path) && isAnyConfig(item);
}

function isAnyConfig(item: { path: string; reasons: string[] }): boolean {
  return item.reasons.some((reason) => reason === "near_config");
}

function isRelatedDoc(item: { path: string; reasons: string[] }): boolean {
  return item.reasons.some((reason) => reason === "related_doc");
}

function isDirectImport(item: { path: string; reasons: string[] }): boolean {
  return item.reasons.some((reason) => reason === "import");
}

function isContextBackedSearchHit(item: { path: string; reasons: string[] } | undefined): boolean {
  return Boolean(item?.reasons.some((reason) => reason === "reverse_import" || reason === "reverse_test" || reason === "sibling_test" || reason === "test_of" || reason === "related_doc" || reason === "near_config"));
}

function isDocumentationPath(path: string): boolean {
  return /\.(?:md|mdx|rst|txt)$/i.test(path);
}

function isRouteAdapterPath(path: string): boolean {
  return /(?:^|\/)app\/api\/.+\/route\.[cm]?[jt]sx?$/i.test(path);
}

function isArchivedDocumentationPath(path: string): boolean {
  return /(?:^|\/)docs\/archive\//i.test(path);
}

function sortByPathAffinity(items: ContextEntry[], targetPath: string): ContextEntry[] {
  const targetTerms = pathTerms(targetPath);
  return [...items].sort((left, right) => pathAffinity(right.path, targetTerms) - pathAffinity(left.path, targetTerms) || left.path.localeCompare(right.path));
}

function pathAffinity(path: string, targetTerms: Set<string>): number {
  let score = 0;
  for (const term of pathTerms(path)) if (targetTerms.has(term)) score++;
  return score;
}

function pathTerms(path: string): Set<string> {
  return new Set(path.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2 && !pathTermNoise.has(term)));
}

const pathTermNoise = new Set(["app", "api", "src", "lib", "route", "test", "tests", "web"]);

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}
