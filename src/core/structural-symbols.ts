import { execFileSync } from "node:child_process";
import type { ExtractedSymbol } from "./symbols.ts";

export interface AstGrepSpec {
  language: "typescript" | "javascript" | "python";
  kind: string;
  pattern: string;
}

interface AstGrepRow {
  text?: string;
  lines?: string;
  range?: { start?: { line?: number }; end?: { line?: number } };
  metaVariables?: {
    single?: Record<string, { text?: string; range?: { start?: { line?: number }; end?: { line?: number } } }>;
  };
}

const tsSpecs: AstGrepSpec[] = [
  { language: "typescript", kind: "function", pattern: "function $NAME($$$) { $$$ }" },
  { language: "typescript", kind: "class", pattern: "class $NAME { $$$ }" },
  { language: "typescript", kind: "const-arrow", pattern: "const $NAME = ($$$) => $$$" },
  { language: "typescript", kind: "const-arrow", pattern: "const $NAME = async ($$$) => $$$" },
  { language: "typescript", kind: "const-arrow", pattern: "const $NAME: $$$ = ($$$) => $$$" },
  { language: "typescript", kind: "const-arrow", pattern: "const $NAME: $$$ = async ($$$) => $$$" },
  { language: "typescript", kind: "const-arrow", pattern: "const $NAME = <$T>($$$) => $$$" },
];

const jsSpecs: AstGrepSpec[] = [
  { language: "javascript", kind: "function", pattern: "function $NAME($$$) { $$$ }" },
  { language: "javascript", kind: "class", pattern: "class $NAME { $$$ }" },
  { language: "javascript", kind: "const-arrow", pattern: "const $NAME = ($$$) => $$$" },
  { language: "javascript", kind: "const-arrow", pattern: "const $NAME = async ($$$) => $$$" },
];

const pySpecs: AstGrepSpec[] = [
  { language: "python", kind: "function", pattern: "def $NAME($$$): $$$" },
  { language: "python", kind: "class", pattern: "class $NAME: $$$" },
];

export function extractAstGrepSymbols(text: string, language: string): ExtractedSymbol[] {
  const specs = astGrepSpecsForLanguage(language);
  if (specs.length === 0) return [];
  const symbols: ExtractedSymbol[] = [];
  for (const spec of specs) {
    for (const row of runAstGrep(text, spec)) {
      const variable = row.metaVariables?.single?.NAME;
      if (!variable) continue;
      const name = variable.text?.trim();
      if (!name || ["if", "for", "while", "switch"].includes(name)) continue;
      const startLine = (variable.range?.start?.line ?? row.range?.start?.line ?? 0) + 1;
      const endLine = (row.range?.end?.line ?? startLine - 1) + 1;
      symbols.push({
        name,
        kind: spec.kind,
        startLine,
        endLine,
        signature: (row.lines ?? row.text ?? name).trim().split(/\r?\n/)[0]?.slice(0, 240),
      });
    }
  }
  return dedupeSymbols(symbols);
}

function runAstGrep(text: string, spec: AstGrepSpec): AstGrepRow[] {
  try {
    const raw = execFileSync("ast-grep", ["run", "--stdin", "--pattern", spec.pattern, "--lang", spec.language, "--json=compact"], {
      input: text,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 2_000,
    }).trim();
    return raw ? JSON.parse(raw) as AstGrepRow[] : [];
  } catch {
    return [];
  }
}

export function astGrepSpecsForLanguage(language: string): AstGrepSpec[] {
  if (["typescript", "ts", "tsx"].includes(language)) return tsSpecs;
  if (["javascript", "js", "jsx", "mjs", "cjs"].includes(language)) return jsSpecs;
  if (["python", "py"].includes(language)) return pySpecs;
  return [];
}

function dedupeSymbols(symbols: ExtractedSymbol[]): ExtractedSymbol[] {
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    const key = `${symbol.kind}:${symbol.name}:${symbol.startLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
