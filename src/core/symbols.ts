export interface ExtractedSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine?: number;
  signature?: string;
}

const patterns: Array<{ kind: string; rx: RegExp }> = [
  { kind: "class", rx: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "function", rx: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
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

export function extractSymbols(text: string, language: string): ExtractedSymbol[] {
  if (cFamilyLanguages.has(language)) return extractCFamilySymbols(text);
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
      if (!name || ["if", "for", "while", "switch"].includes(name)) continue;
      symbols.push({ name, kind: pattern.kind, startLine: i + 1, signature: line.trim().slice(0, 240) });
      break;
    }
  }
  return symbols;
}
