export type MissClass = "alias" | "convention" | "missing_symbol" | "noise" | "staleness" | "query_formulation" | "unknown";
export type MissKind = "missing_expected" | "forbidden_read";

export interface MissDiagnostic {
  class: MissClass;
  kind: MissKind;
  file: string;
  reason: string;
}

export interface MissTaxonomySummary {
  total: number;
  byClass: Record<MissClass, number>;
  examples: MissDiagnostic[];
}

export interface ClassifyMissesInput {
  query: string;
  entry: string;
  requiredContext: string[];
  missingExpectedFiles: string[];
  forbiddenRead: string[];
  indexStale?: boolean;
  hints?: Record<string, MissClass | MissClass[]>;
}

export const missClasses: MissClass[] = ["alias", "convention", "missing_symbol", "noise", "staleness", "query_formulation", "unknown"];

export function classifyMisses(input: ClassifyMissesInput): MissDiagnostic[] {
  const diagnostics: MissDiagnostic[] = [];
  for (const file of input.forbiddenRead) {
    diagnostics.push({ class: "noise", kind: "forbidden_read", file, reason: "forbidden/noisy file was selected" });
  }
  for (const file of input.missingExpectedFiles) {
    const hinted = normalizeHints(input.hints?.[file]);
    if (input.indexStale) {
      diagnostics.push({ class: "staleness", kind: "missing_expected", file, reason: "index was stale while expected file was missing" });
    } else if (hinted.length > 0) {
      for (const item of hinted) diagnostics.push({ class: item, kind: "missing_expected", file, reason: `task ground truth marks this miss as ${item}` });
    } else if (isConventionNeighbor(file, input.entry, input.requiredContext)) {
      diagnostics.push({ class: "convention", kind: "missing_expected", file, reason: "expected file is a convention neighbor rather than a direct lexical/symbol hit" });
    } else if (file === input.entry && looksLikeSymbolQuery(input.query)) {
      diagnostics.push({ class: "missing_symbol", kind: "missing_expected", file, reason: "entry file was missed for a symbol-like query" });
    } else if (queryPathOverlap(input.query, file) === 0) {
      diagnostics.push({ class: "query_formulation", kind: "missing_expected", file, reason: "query terms do not overlap the missing expected path" });
    } else {
      diagnostics.push({ class: "unknown", kind: "missing_expected", file, reason: "miss does not match a known taxonomy rule" });
    }
  }
  return diagnostics;
}

export function summarizeMissTaxonomy(diagnostics: MissDiagnostic[], exampleLimit = 8): MissTaxonomySummary {
  const byClass = emptyClassCounts();
  for (const item of diagnostics) byClass[item.class]++;
  return { total: diagnostics.length, byClass, examples: diagnostics.slice(0, exampleLimit) };
}

export function emptyClassCounts(): Record<MissClass, number> {
  return Object.fromEntries(missClasses.map((item) => [item, 0])) as Record<MissClass, number>;
}

function normalizeHints(value: MissClass | MissClass[] | undefined): MissClass[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function isConventionNeighbor(file: string, entry: string, requiredContext: string[]): boolean {
  if (file === entry) return false;
  const lower = file.toLowerCase();
  if (/((^|\/)(__tests__|tests?|specs?)\/|\.(test|spec)\.)/.test(lower)) return true;
  if (/(^|\/)docs?\//.test(lower) || lower.endsWith(".md")) return true;
  if (/(^|\/)(docker-compose[^/]*\.ya?ml|compose[^/]*\.ya?ml)$/.test(lower)) return true;
  if (/\.(config|conf)\.(js|ts|mjs|cjs|json|ya?ml)$/.test(lower)) return true;
  if (requiredContext.includes(file) && pathStem(file) === pathStem(entry)) return true;
  return false;
}

function looksLikeSymbolQuery(query: string): boolean {
  return /[a-z][A-Z]/.test(query) || /\b(class|def|function|implementation|handler|provider|component|hook)\b/i.test(query);
}

function queryPathOverlap(query: string, file: string): number {
  const queryTerms = new Set(tokenize(query));
  return tokenize(file).filter((term) => queryTerms.has(term)).length;
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length > 1);
}

function pathStem(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.(test|spec)\.[^.]+$/i, "").replace(/\.[^.]+$/i, "").toLowerCase();
}
