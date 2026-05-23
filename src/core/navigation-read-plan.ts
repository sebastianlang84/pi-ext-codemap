// The scripted eval models an agent that sees search results before context output:
// preserve visible search hits first, then fill remaining read budget from context.
export function mergeSearchContextReadPlan(searchPaths: string[], contextPaths: string[], limit: number): string[] {
  const cappedLimit = Math.max(0, Math.floor(limit));
  if (cappedLimit === 0) return [];
  return uniquePaths([...searchPaths, ...contextPaths]).slice(0, cappedLimit);
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
