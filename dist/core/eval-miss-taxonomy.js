export const missClasses = ["alias", "convention", "missing_symbol", "noise", "staleness", "query_formulation", "unknown"];
export function classifyMisses(input) {
    const diagnostics = [];
    for (const file of input.forbiddenRead) {
        diagnostics.push({ class: "noise", kind: "forbidden_read", file, reason: "forbidden/noisy file was selected" });
    }
    for (const file of input.missingExpectedFiles) {
        const hinted = normalizeHints(input.hints?.[file]);
        if (input.indexStale) {
            diagnostics.push({ class: "staleness", kind: "missing_expected", file, reason: "index was stale while expected file was missing" });
        }
        else if (hinted.length > 0) {
            for (const item of hinted)
                diagnostics.push({ class: item, kind: "missing_expected", file, reason: `task ground truth marks this miss as ${item}` });
        }
        else if (isConventionNeighbor(file, input.entry, input.requiredContext)) {
            diagnostics.push({ class: "convention", kind: "missing_expected", file, reason: "expected file is a convention neighbor rather than a direct lexical/symbol hit" });
        }
        else if (file === input.entry && looksLikeSymbolQuery(input.query)) {
            diagnostics.push({ class: "missing_symbol", kind: "missing_expected", file, reason: "entry file was missed for a symbol-like query" });
        }
        else if (queryPathOverlap(input.query, file) === 0) {
            diagnostics.push({ class: "query_formulation", kind: "missing_expected", file, reason: "query terms do not overlap the missing expected path" });
        }
        else {
            diagnostics.push({ class: "unknown", kind: "missing_expected", file, reason: "miss does not match a known taxonomy rule" });
        }
    }
    return diagnostics;
}
export function summarizeMissTaxonomy(diagnostics, exampleLimit = 8) {
    const byClass = emptyClassCounts();
    for (const item of diagnostics)
        byClass[item.class]++;
    return { total: diagnostics.length, byClass, examples: diagnostics.slice(0, exampleLimit) };
}
export function emptyClassCounts() {
    return Object.fromEntries(missClasses.map((item) => [item, 0]));
}
function normalizeHints(value) {
    if (!value)
        return [];
    return Array.isArray(value) ? value : [value];
}
function isConventionNeighbor(file, entry, requiredContext) {
    if (file === entry)
        return false;
    const lower = file.toLowerCase();
    if (/((^|\/)(__tests__|tests?|specs?)\/|\.(test|spec)\.)/.test(lower))
        return true;
    if (/(^|\/)docs?\//.test(lower) || lower.endsWith(".md"))
        return true;
    if (/(^|\/)(docker-compose[^/]*\.ya?ml|compose[^/]*\.ya?ml)$/.test(lower))
        return true;
    if (/\.(config|conf)\.(js|ts|mjs|cjs|json|ya?ml)$/.test(lower))
        return true;
    if (requiredContext.includes(file) && pathStem(file) === pathStem(entry))
        return true;
    return false;
}
function looksLikeSymbolQuery(query) {
    return /[a-z][A-Z]/.test(query) || /\b(class|def|function|implementation|handler|provider|component|hook)\b/i.test(query);
}
function queryPathOverlap(query, file) {
    const queryTerms = new Set(tokenize(query));
    return tokenize(file).filter((term) => queryTerms.has(term)).length;
}
function tokenize(value) {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((term) => term.length > 1);
}
function pathStem(path) {
    const file = path.split("/").pop() ?? path;
    return file.replace(/\.(test|spec)\.[^.]+$/i, "").replace(/\.[^.]+$/i, "").toLowerCase();
}
