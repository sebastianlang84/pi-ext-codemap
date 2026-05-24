interface FtsQuery {
  query: string;
  tierBoost: number;
}

export interface QueryPlan {
  normalized: string;
  terms: string[];
  coreTerms: string[];
  phrases: string[];
  pathLike: boolean;
  pathNeedle: string;
  codeIntent: boolean;
  roleIntents: string[];
  pathTerms: string[];
  endpointPathTerms: string[];
  ftsQueries: FtsQuery[];
}

export function planQuery(query: string): QueryPlan {
  const raw = query.trim();
  const phrases = [...raw.matchAll(/"([^"]+)"/g)].map((match) => match[1].trim()).filter(Boolean);
  const rawTerms = raw.match(/[\p{L}\p{N}_.$/-]+/gu) ?? [];
  const terms = rawTerms.slice(0, 12);
  if (terms.length === 0 && phrases.length === 0) throw new Error("Search query has no searchable terms.");

  const normalized = raw.replace(/^"|"$/g, "").toLowerCase();
  const expandedTerms = expandTerms(terms, rawTerms);
  const coreTerms = expandedTerms.filter((term) => !stopWords.has(term)).slice(0, 16);
  const pathLike = /[/.\\-]|\.[A-Za-z0-9]{1,8}$/.test(raw);
  const pathNeedle = raw.replace(/^"|"$/g, "");
  const codeIntent = coreTerms.some((term) => codeIntentTerms.has(term));
  const roleIntents = inferRoleIntents(normalized, coreTerms);
  const pathTerms = inferPathTerms(coreTerms);
  const endpointPathTerms = inferEndpointPathTerms(expandedTerms);
  const quotedPhrases = phrases.map(quoteFtsPhrase);
  const quotedTerms = terms.map(quoteFtsPhrase);
  const quotedExpandedTerms = expandedTerms.map(quoteFtsPhrase);
  const quotedCoreTerms = coreTerms.map(quoteFtsPhrase);
  const broadTerms = terms.length > 1 ? expandedTerms : terms.map((term) => term.toLowerCase());
  const prefixTerms = broadTerms.map(toPrefixTerm).filter(Boolean);
  const tiered = phrases.length > 0 || expandedTerms.length > 1;
  const scopePairQuery = coreTerms.includes("session") && coreTerms.includes("repo") ? `${quoteFtsPhrase("session")} ${quoteFtsPhrase("repo")}` : "";
  const ftsQueries = uniqueFtsQueries([
    ...quotedPhrases.map((query) => ({ query, tierBoost: tiered ? 24 : 0 })),
    { query: quotedTerms.join(" "), tierBoost: tiered ? 18 : 0 },
    { query: quotedCoreTerms.join(" "), tierBoost: tiered ? 16 : 0 },
    ...(scopePairQuery ? [{ query: scopePairQuery, tierBoost: tiered ? 14 : 0 }] : []),
    { query: quotedExpandedTerms.join(" "), tierBoost: tiered ? 12 : 0 },
    { query: prefixTerms.join(" OR "), tierBoost: tiered ? 8 : 0 },
    { query: broadTerms.map(quoteFtsPhrase).join(" OR "), tierBoost: 0 },
  ].filter((entry) => entry.query));

  return { normalized, terms: expandedTerms, coreTerms, phrases, pathLike, pathNeedle, codeIntent, roleIntents, pathTerms, endpointPathTerms, ftsQueries };
}

const stopWords = new Set([
  "a", "an", "and", "api", "by", "for", "from", "get", "in", "into", "of", "on", "or", "post", "put", "the", "to", "with",
]);

const codeIntentTerms = new Set([
  "aggregator", "class", "delivery", "endpoint", "function", "handler", "implemented", "lock", "macro", "method", "orchestrator", "pipeline", "service",
]);

const knownIdentifierCompounds = new Set(["localstorage"]);

function inferRoleIntents(normalized: string, terms: string[]): string[] {
  const intents: string[] = [];
  const has = (...needles: string[]) => needles.some((needle) => needle.includes(" ") ? normalized.includes(needle) : terms.includes(needle));
  if (has("what is this project", "project about", "overview", "purpose")) intents.push("overview");
  if (has("agent", "agents", "instructions", "program", "claude")) intents.push("agent_instructions");
  if (has("edit")) intents.push("overview", "agent_instructions", "implementation/main");
  if (has("implemented", "implementation", "source", "defined", "architecture", "model", "used", "orchestrator", "pipeline", "provider", "run")) intents.push("implementation");
  if (has("provider", "providers")) intents.push("provider");
  if (has("main", "entry", "entrypoint", "orchestrator")) intents.push("implementation", "implementation/main");
  if (has("config", "configuration")) intents.push("configuration");
  if (has("docs", "doc", "documentation")) intents.push("documentation");
  if (has("adr", "decision", "scope", "scopes")) intents.push("decision_record");
  if (has("tests", "test", "testing")) intents.push("tests");
  if (has("computed")) intents.push("setup/utility");
  if (has("data", "setup", "preparation", "prepare")) intents.push("setup/utility");
  if (has("not be modified", "not modified", "do not modify")) intents.push("overview", "setup/utility");
  if (has("dependencies", "dependency", "package", "pyproject")) intents.push("dependencies");
  return uniqueStrings(intents);
}

function inferPathTerms(terms: string[]): string[] {
  return terms.includes("preload") ? ["retrieval"] : [];
}

function inferEndpointPathTerms(terms: string[]): string[] {
  const endpointTerms: string[] = [];
  for (let index = 0; index < terms.length; index++) {
    if (terms[index] !== "endpoint") continue;
    endpointTerms.push(...terms.slice(Math.max(0, index - 2), index), ...terms.slice(index + 1, index + 2));
  }
  return uniqueStrings(endpointTerms.filter((term) => term.length > 2 && !stopWords.has(term) && !endpointPathTermNoise.has(term)));
}

const endpointPathTermNoise = new Set(["return", "returns", "show", "shows", "should"]);

function quoteFtsPhrase(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function expandTerms(terms: string[], compoundSourceTerms = terms): string[] {
  const expanded: string[] = [];
  for (const term of terms) {
    for (const part of splitTerm(term)) {
      const normalized = part.toLowerCase();
      if (normalized.length > 1) expanded.push(normalized);
    }
  }
  const lowered = new Set(expanded.map((term) => term.toLowerCase()));
  if (lowered.has("session") && lowered.has("repo")) expanded.push("scope");
  for (const compound of adjacentCompounds(compoundSourceTerms)) expanded.push(compound);
  return uniqueStrings(expanded).slice(0, 16);
}

function adjacentCompounds(terms: string[]): string[] {
  const compounds: string[] = [];
  const primaryTerms = terms
    .map((term) => splitTerm(term).at(-1)?.toLowerCase() ?? "")
    .filter(Boolean);
  const pairs: Array<[string, string]> = [];
  for (let index = 0; index < primaryTerms.length - 1; index++) pairs.push([primaryTerms[index], primaryTerms[index + 1]]);
  for (const [left, right] of pairs) {
    if (stopWords.has(left) || stopWords.has(right)) continue;
    const compound = `${left}${right}`;
    const identifierLike = left.length === 1 || right.length === 1 || knownIdentifierCompounds.has(compound);
    if (identifierLike && /^[\p{L}\p{N}]+$/u.test(compound) && compound.length >= 5 && compound.length <= 32) compounds.push(compound);
  }
  return uniqueStrings(compounds);
}

function splitTerm(value: string): string[] {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[.$/\\_-]+/g, " ");
  return [value, ...spaced.split(/\s+/)].filter(Boolean);
}

function toPrefixTerm(value: string): string {
  const token = value.match(/[\p{L}\p{N}_]+/u)?.[0];
  return token && token.length > 2 ? `${token}*` : "";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueFtsQueries(values: FtsQuery[]): FtsQuery[] {
  const byQuery = new Map<string, FtsQuery>();
  for (const value of values) {
    const previous = byQuery.get(value.query);
    if (!previous || value.tierBoost > previous.tierBoost) byQuery.set(value.query, value);
  }
  return [...byQuery.values()];
}
