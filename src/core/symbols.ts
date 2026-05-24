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

export function extractSymbols(text: string, language: string): ExtractedSymbol[] {
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
