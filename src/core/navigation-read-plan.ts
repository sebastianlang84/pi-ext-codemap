// The scripted eval models an agent that sees search results before context output:
// keep the top search hit, then let high-confidence context neighbors displace lower hits.
type ContextPathInput = string | { path: string; reasons?: Array<{ kind: string; targetPath?: string }> };

type ReadPlanBucket =
  | "first_search"
  | "visible_search_pair"
  | "uncovered_visible_test"
  | "route_direct_import"
  | "route_direct_import_test"
  | "prioritized_config"
  | "prioritized_test"
  | "context_backed_search"
  | "direct_import"
  | "direct_import_test"
  | "active_search"
  | "remaining_context"
  | "archived_search";

interface ContextEntry {
  path: string;
  reasons: string[];
  siblingTestTargetPaths: string[];
  contextRank: number;
}

interface ReadPlanEntry {
  path: string;
  bucket: ReadPlanBucket;
}

export interface ReadPlanDecisionDiagnostic {
  path: string;
  bucket: ReadPlanBucket;
  selected: boolean;
  rank?: number;
  searchRank?: number;
  contextRank?: number;
  contextReasons?: string[];
}

export interface ReadPlanDiagnostics {
  limit: number;
  selected: string[];
  budget: {
    requested: number;
    available: number;
    selected: number;
    dropped: number;
  };
  decisions: ReadPlanDecisionDiagnostic[];
}

export function mergeSearchContextReadPlan(searchPaths: string[], contextPaths: ContextPathInput[], limit: number): string[] {
  return buildSearchContextReadPlan(searchPaths, contextPaths, limit).selected;
}

export function explainSearchContextReadPlan(searchPaths: string[], contextPaths: ContextPathInput[], limit: number): ReadPlanDiagnostics {
  const plan = buildSearchContextReadPlan(searchPaths, contextPaths, limit);
  return {
    limit: plan.limit,
    selected: plan.selected,
    budget: {
      requested: plan.limit,
      available: plan.entries.length,
      selected: plan.selected.length,
      dropped: Math.max(0, plan.entries.length - plan.selected.length),
    },
    decisions: plan.entries.map((entry, index) => {
      const rank = index < plan.limit ? index + 1 : undefined;
      const contextEntry = plan.contextByPath.get(entry.path);
      return {
        path: entry.path,
        bucket: entry.bucket,
        selected: rank !== undefined,
        rank,
        searchRank: plan.searchRankByPath.get(entry.path),
        contextRank: contextEntry?.contextRank,
        contextReasons: contextEntry?.reasons,
      };
    }),
  };
}

function buildSearchContextReadPlan(searchPaths: string[], contextPaths: ContextPathInput[], limit: number): { limit: number; selected: string[]; entries: ReadPlanEntry[]; contextByPath: Map<string, ContextEntry>; searchRankByPath: Map<string, number> } {
  const cappedLimit = Math.max(0, Math.floor(limit));
  if (cappedLimit === 0) return { limit: cappedLimit, selected: [], entries: [], contextByPath: new Map(), searchRankByPath: rankedPathMap(searchPaths) };
  const contextEntries = contextPaths.map((item, index) => toContextEntry(item, index + 1)).filter((item) => item.path);
  const contextByPath = new Map(contextEntries.map((item) => [item.path, item]));
  const [firstSearchPath, ...laterSearchPaths] = searchPaths;
  const searchPathSet = new Set(searchPaths);
  const searchRankByPath = rankedPathMap(searchPaths);
  const visibleSearchPairPaths = laterSearchPaths.filter((path) => hasUncoveredVisibleSourceTestPair(path, laterSearchPaths, contextByPath));
  const uncoveredVisibleTests = laterSearchPaths.filter((path) => (
    isTestPath(path)
    && !isContextBackedSearchHit(contextByPath.get(path))
    && !hasVisibleSourceTestCounterpart(path, laterSearchPaths)
  ));
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
  const contextBackedSearchPaths = laterSearchPaths.filter((path) => isContextBackedSearchHit(contextByPath.get(path)));
  const remainingSearchPaths = laterSearchPaths.filter((path) => !contextBackedSearchPaths.includes(path));
  const activeSearchPaths = remainingSearchPaths.filter((path) => !isArchivedDocumentationPath(path));
  const archivedSearchPaths = remainingSearchPaths.filter(isArchivedDocumentationPath);
  const entries = uniqueEntries([
    entry(firstSearchPath, "first_search"),
    ...visibleSearchPairPaths.map((path) => entry(path, "visible_search_pair")),
    ...uncoveredVisibleTests.map((path) => entry(path, "uncovered_visible_test")),
    ...(routeAdapterEntry ? prioritizedDirectImports.map((item) => entry(item.path, "route_direct_import")) : []),
    ...(routeAdapterEntry ? prioritizedDirectImportTests.map((item) => entry(item.path, "route_direct_import_test")) : []),
    ...(routeAdapterEntry ? [] : prioritizedConfigs.map((item) => entry(item.path, "prioritized_config"))),
    ...prioritizedTests.map((item) => entry(item.path, "prioritized_test")),
    ...contextBackedSearchPaths.map((path) => entry(path, "context_backed_search")),
    ...(routeAdapterEntry ? [] : prioritizedDirectImports.map((item) => entry(item.path, "direct_import"))),
    ...(routeAdapterEntry ? [] : prioritizedDirectImportTests.map((item) => entry(item.path, "direct_import_test"))),
    ...activeSearchPaths.map((path) => entry(path, "active_search")),
    ...(routeAdapterEntry ? prioritizedConfigs.map((item) => entry(item.path, "prioritized_config")) : []),
    ...remainingContext.map((item) => entry(item.path, "remaining_context")),
    ...archivedSearchPaths.map((path) => entry(path, "archived_search")),
  ]);
  return { limit: cappedLimit, selected: entries.slice(0, cappedLimit).map((item) => item.path), entries, contextByPath, searchRankByPath };
}

function entry(path: string | undefined, bucket: ReadPlanBucket): ReadPlanEntry {
  return { path: path ?? "", bucket };
}

function toContextEntry(input: ContextPathInput, contextRank: number): ContextEntry {
  if (typeof input === "string") {
    return { path: input, reasons: [], siblingTestTargetPaths: [], contextRank };
  }

  return {
    path: input.path,
    reasons: input.reasons?.map((reason) => reason.kind) ?? [],
    siblingTestTargetPaths: input.reasons?.filter((reason) => reason.kind === "sibling_test" && reason.targetPath).map((reason) => reason.targetPath as string) ?? [],
    contextRank,
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

function hasUncoveredVisibleSourceTestPair(path: string, searchPaths: string[], contextByPath: Map<string, ContextEntry>): boolean {
  const testPath = isTestPath(path);
  return !isContextBackedSearchHit(contextByPath.get(path)) && searchPaths.some((candidate) => (
    candidate !== path
    && isTestPath(candidate) !== testPath
    && pathStem(candidate) === pathStem(path)
    && !isContextBackedSearchHit(contextByPath.get(candidate))
  ));
}

function hasVisibleSourceTestCounterpart(testPath: string, searchPaths: string[]): boolean {
  return searchPaths.some((candidate) => candidate !== testPath && !isTestPath(candidate) && pathStem(candidate) === pathStem(testPath));
}

function isTestPath(path: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|\.(?:test|spec)\./i.test(path);
}

function pathStem(path: string): string {
  const filename = path.split("/").pop()?.toLowerCase() ?? path.toLowerCase();
  return filename.replace(/\.(?:test|spec)(?=\.)/i, "").replace(/\.[^.]+$/, "");
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

function rankedPathMap(paths: string[]): Map<string, number> {
  const ranked = new Map<string, number>();
  paths.forEach((path, index) => {
    if (path && !ranked.has(path)) ranked.set(path, index + 1);
  });
  return ranked;
}

function uniqueEntries(entries: ReadPlanEntry[]): ReadPlanEntry[] {
  const seen = new Set<string>();
  const result: ReadPlanEntry[] = [];
  for (const item of entries) {
    if (!item.path || seen.has(item.path)) continue;
    seen.add(item.path);
    result.push(item);
  }
  return result;
}
