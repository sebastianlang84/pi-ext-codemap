export interface ExtractedSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine?: number;
  signature?: string;
}

const patterns: Array<{ kind: string; rx: RegExp }> = [
  { kind: "class", rx: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "function", rx: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function(?:\s+|\s*\*\s*)([A-Za-z_$][\w$]*)/ },
  { kind: "function", rx: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/ },
  { kind: "interface", rx: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "type", rx: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/ },
  { kind: "method", rx: /^\s*(?:public\s+|private\s+|protected\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/ },
  { kind: "class", rx: /^\s*class\s+([A-Za-z_][\w]*)/ },
  { kind: "function", rx: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/ },
  { kind: "heading", rx: /^\s{0,3}#{1,6}\s+(.+)/ },
];

const cFamilyLanguages = new Set(["c", "cpp"]);
const cControlKeywords = new Set(["if", "for", "while", "switch", "return", "sizeof", "do", "else", "catch"]);
// Named aggregate definition with a body brace and no `;` before it (skips forward
// declarations like `struct Node;` and variable declarations like `struct Point p;`).
const cAggregateRx = /^\s*(?:typedef\s+)?(struct|union|enum|class)\s+([A-Za-z_]\w*)\b[^;]*\{/;
// Return type / qualifier (or `Class::`) followed by the name right before `(`.
const cFunctionRx = /^\s*([A-Za-z_][\w\s*&<>,:~]*?[\s*&:>])([A-Za-z_]\w*)\s*\(/;

function extractCFamilySymbols(text: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    const aggregate = line.match(cAggregateRx);
    if (aggregate) {
      const kind = aggregate[1] === "class" ? "class" : aggregate[1];
      symbols.push({ name: aggregate[2], kind, startLine: i + 1, signature: trimmed.slice(0, 240) });
      continue;
    }

    // Skip prototypes and call statements; multi-line signatures still match on their first line.
    if (trimmed.endsWith(";")) continue;
    const fn = line.match(cFunctionRx);
    if (!fn) continue;
    const name = fn[2];
    if (cControlKeywords.has(name)) continue;
    const kind = fn[1].includes("::") ? "method" : "function";
    symbols.push({ name, kind, startLine: i + 1, signature: trimmed.slice(0, 240) });
  }
  return symbols;
}

// Line-based symbol extractors for languages that get no structured chunks/symbols from the TS/JS/
// Python/Markdown loop below (they are indexed by scan-policy but were previously symbol-less, so the
// exactSymbol ranking boosts never fired). Patterns match a declaration's first line; a `kind` may be
// a function of the match when the keyword itself selects the kind. Conservative by design — line
// heuristics favor no false positive over catching every declaration form.
interface LineSymbolPattern {
  rx: RegExp;
  nameGroup: number;
  kind: string | ((match: RegExpMatchArray) => string);
}

const AGGREGATE_KIND: Record<string, string> = {
  class: "class", struct: "class", record: "class", object: "class",
  interface: "interface", trait: "interface", module: "module", enum: "type",
};
const aggregateKind = (match: RegExpMatchArray): string => AGGREGATE_KIND[match[1]] ?? "class";
const lineControlKeywords = new Set(["if", "for", "while", "switch", "return", "catch", "else", "do", "when", "match", "loop"]);

const lineSymbolLanguages: Record<string, LineSymbolPattern[]> = {
  go: [
    { rx: /^\s*func\s+\([^)]*\)\s*([A-Za-z_]\w*)\s*[[(]/, nameGroup: 1, kind: "method" },
    { rx: /^\s*func\s+([A-Za-z_]\w*)\s*[[(]/, nameGroup: 1, kind: "function" },
    { rx: /^\s*type\s+([A-Za-z_]\w*)\s+struct\b/, nameGroup: 1, kind: "class" },
    { rx: /^\s*type\s+([A-Za-z_]\w*)\s+interface\b/, nameGroup: 1, kind: "interface" },
    { rx: /^\s*type\s+([A-Za-z_]\w*)\b/, nameGroup: 1, kind: "type" },
  ],
  rs: [
    { rx: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern(?:\s+"[^"]*")?)\s+)*fn\s+([A-Za-z_]\w*)/, nameGroup: 1, kind: "function" },
    { rx: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, nameGroup: 1, kind: "class" },
    { rx: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, nameGroup: 1, kind: "type" },
    { rx: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/, nameGroup: 1, kind: "interface" },
    { rx: /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)/, nameGroup: 1, kind: "type" },
  ],
  java: [
    { rx: /^\s*(?:(?:public|private|protected|abstract|final|static|sealed)\s+)*(class|interface|enum|record)\s+([A-Za-z_]\w*)/, nameGroup: 2, kind: aggregateKind },
    { rx: /^\s*(?:(?:public|private|protected)\s+)(?:(?:static|final|abstract|synchronized|native|default)\s+)*[\w<>[\],.?]+\s+([A-Za-z_]\w*)\s*\([^;{]*\)\s*(?:throws [\w.,\s]+)?\{?\s*$/, nameGroup: 1, kind: "method" },
  ],
  kt: [
    { rx: /^\s*(?:(?:public|private|protected|internal|open|override|suspend|inline|final|abstract|tailrec|operator)\s+)*fun\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*)\s*[<(]/, nameGroup: 1, kind: "function" },
    { rx: /^\s*(?:(?:public|private|protected|internal|open|sealed|abstract|final|data|enum|annotation|inner|value)\s+)*(class|interface|object)\s+([A-Za-z_]\w*)/, nameGroup: 2, kind: aggregateKind },
  ],
  rb: [
    { rx: /^\s*def\s+self\.([A-Za-z_]\w*[!?=]?)/, nameGroup: 1, kind: "method" },
    { rx: /^\s*def\s+([A-Za-z_]\w*[!?=]?)/, nameGroup: 1, kind: "method" },
    { rx: /^\s*class\s+([A-Za-z_][\w:]*)/, nameGroup: 1, kind: "class" },
    { rx: /^\s*module\s+([A-Za-z_][\w:]*)/, nameGroup: 1, kind: "module" },
  ],
  php: [
    { rx: /^\s*(?:abstract\s+|final\s+)*(class|interface|trait|enum)\s+([A-Za-z_]\w*)/, nameGroup: 2, kind: aggregateKind },
    { rx: /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)+function\s+&?\s*([A-Za-z_]\w*)\s*\(/, nameGroup: 1, kind: "method" },
    { rx: /^\s*function\s+&?\s*([A-Za-z_]\w*)\s*\(/, nameGroup: 1, kind: "function" },
  ],
};

function extractLineBasedSymbols(text: string, patterns: LineSymbolPattern[]): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    for (const pattern of patterns) {
      const match = line.match(pattern.rx);
      if (!match) continue;
      const name = (match[pattern.nameGroup] ?? "").trim();
      if (!name || lineControlKeywords.has(name)) continue;
      const kind = typeof pattern.kind === "function" ? pattern.kind(match) : pattern.kind;
      symbols.push({ name, kind, startLine: i + 1, signature: trimmed.slice(0, 240) });
      break;
    }
  }
  return symbols;
}

export function extractSymbols(text: string, language: string): ExtractedSymbol[] {
  if (cFamilyLanguages.has(language)) return extractCFamilySymbols(text);
  const linePatterns = lineSymbolLanguages[language];
  if (linePatterns) return extractLineBasedSymbols(text, linePatterns);
  const symbols: ExtractedSymbol[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      if (pattern.kind === "heading" && language !== "markdown") continue;
      if (pattern.kind !== "heading" && !["typescript", "javascript", "python", "py"].includes(language)) continue;
      if (["python", "py"].includes(language) && !/^\s*(?:class|(?:async\s+)?def)\s+/.test(line)) continue;
      const match = line.match(pattern.rx);
      if (!match) continue;
      const name = (match[1] ?? "").trim();
      if (!name || ["if", "for", "while", "switch", "catch", "return"].includes(name)) continue;
      symbols.push({ name, kind: pattern.kind, startLine: i + 1, signature: line.trim().slice(0, 240) });
      break;
    }
  }
  return symbols;
}
