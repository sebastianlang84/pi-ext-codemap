// The scripted eval models an agent that sees search results before context output:
// keep the top search hit, then let high-confidence context tests/configs displace lower hits.
type ContextPathInput = string | { path: string; reasons?: Array<{ kind: string }> };

export function mergeSearchContextReadPlan(searchPaths: string[], contextPaths: ContextPathInput[], limit: number): string[] {
  const cappedLimit = Math.max(0, Math.floor(limit));
  if (cappedLimit === 0) return [];
  const contextEntries = contextPaths.map(toContextEntry).filter((item) => item.path);
  const prioritizedConfigs = contextEntries.filter((item) => isRelatedConfig(item) && !searchPaths.includes(item.path));
  const prioritizedTests = contextEntries.filter((item) => isRelatedTest(item) && !searchPaths.includes(item.path));
  const prioritizedContext = [...prioritizedConfigs, ...prioritizedTests];
  const remainingContext = contextEntries.filter((item) => !prioritizedContext.some((priority) => priority.path === item.path));
  const [firstSearchPath, ...laterSearchPaths] = searchPaths;
  return uniquePaths([firstSearchPath, ...prioritizedConfigs.map((item) => item.path), ...prioritizedTests.map((item) => item.path), ...laterSearchPaths, ...remainingContext.map((item) => item.path)]).slice(0, cappedLimit);
}

function toContextEntry(input: ContextPathInput): { path: string; reasons: string[] } {
  return typeof input === "string"
    ? { path: input, reasons: [] }
    : { path: input.path, reasons: input.reasons?.map((reason) => reason.kind) ?? [] };
}

function isRelatedTest(item: { path: string; reasons: string[] }): boolean {
  return item.reasons.some((reason) => reason === "reverse_test" || reason === "test_of");
}

function isRelatedConfig(item: { path: string; reasons: string[] }): boolean {
  return /^docker-compose(?:[.-].*)?\.ya?ml$/.test(item.path.split("/").pop() ?? item.path) && item.reasons.some((reason) => reason === "near_config");
}

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
