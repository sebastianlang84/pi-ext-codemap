export type EvalNavigationMode = "lexical" | "codemap_search" | "codemap_search_context";

export type NavigationMissReason =
  | "lexical_terms_or_limit"
  | "search_entry_miss"
  | "search_only_context_not_expanded"
  | "context_entry_miss"
  | "context_neighbor_unreachable"
  | "context_target_mismatch"
  | "context_budget_or_relationship";

export interface NavigationMissExplanation {
  file: string;
  reason: NavigationMissReason;
  detail: string;
}

export interface NavigationMissReasonSummary {
  total: number;
  byReason: Record<NavigationMissReason, number>;
  examples: NavigationMissExplanation[];
}

const navigationMissReasons: NavigationMissReason[] = [
  "lexical_terms_or_limit",
  "search_entry_miss",
  "search_only_context_not_expanded",
  "context_entry_miss",
  "context_neighbor_unreachable",
  "context_target_mismatch",
  "context_budget_or_relationship",
];

export function summarizeNavigationMissReasons(explanations: NavigationMissExplanation[], exampleLimit = 8): NavigationMissReasonSummary {
  const byReason = emptyNavigationMissReasonCounts();
  for (const item of explanations) byReason[item.reason]++;
  return { total: explanations.length, byReason, examples: explanations.slice(0, exampleLimit) };
}

export function emptyNavigationMissReasonCounts(): Record<NavigationMissReason, number> {
  return Object.fromEntries(navigationMissReasons.map((item) => [item, 0])) as Record<NavigationMissReason, number>;
}

export function explainNavigationMisses(input: {
  mode: EvalNavigationMode;
  entry: string;
  requiredContext: string[];
  missingExpectedFiles: string[];
  filesRead: string[];
  searchPaths?: string[];
  contextTarget?: string;
  readFirstPaths?: string[];
  readPlanPaths?: string[];
}): NavigationMissExplanation[] {
  const entryMissing = input.missingExpectedFiles.includes(input.entry);
  return input.missingExpectedFiles.map((file) => explainMissingFile(input, file, entryMissing));
}

function explainMissingFile(input: Parameters<typeof explainNavigationMisses>[0], file: string, entryMissing: boolean): NavigationMissExplanation {
  if (input.mode === "lexical") {
    return {
      file,
      reason: "lexical_terms_or_limit",
      detail: `not in lexical top ${input.filesRead.length}: ${previewPaths(input.filesRead)}`,
    };
  }

  if (input.mode === "codemap_search") {
    if (file === input.entry) {
      return {
        file,
        reason: "search_entry_miss",
        detail: `entry was not in search top ${input.searchPaths?.length ?? input.filesRead.length}: ${previewPaths(input.searchPaths ?? input.filesRead)}`,
      };
    }
    return {
      file,
      reason: "search_only_context_not_expanded",
      detail: "search-only mode does not expand convention/import/doc context around the entry",
    };
  }

  if (file === input.entry) {
    return {
      file,
      reason: "context_entry_miss",
      detail: `context targeted ${input.contextTarget ? JSON.stringify(input.contextTarget) : "the query fallback"} because the expected entry was not the top search result`,
    };
  }

  if (entryMissing) {
    return {
      file,
      reason: "context_neighbor_unreachable",
      detail: `expected context neighbor is unlikely to be reached because entry ${JSON.stringify(input.entry)} was not read`,
    };
  }

  if (input.contextTarget && input.contextTarget !== input.entry) {
    return {
      file,
      reason: "context_target_mismatch",
      detail: `context expanded ${JSON.stringify(input.contextTarget)} instead of expected entry ${JSON.stringify(input.entry)}`,
    };
  }

  const readFirstPaths = input.readFirstPaths ?? [];
  const readPlanPaths = input.readPlanPaths ?? input.filesRead;
  const detail = readFirstPaths.includes(file) && !readPlanPaths.includes(file)
    ? `entry was read and context suggested the file, but the merged read plan budget selected: ${previewPaths(readPlanPaths)}`
    : `entry was read, but file was absent from read-first context/read plan: context=${previewPaths(readFirstPaths)}; plan=${previewPaths(readPlanPaths)}`;
  return {
    file,
    reason: "context_budget_or_relationship",
    detail,
  };
}

function previewPaths(paths: string[]): string {
  return paths.slice(0, 5).join(", ") || "<none>";
}
