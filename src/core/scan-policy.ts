import { loadIgnoreRules, shouldSkip } from "./ignore.ts";

const maxFileBytes = 1_000_000;
const textExtensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".txt", ".yml", ".yaml", ".toml", ".sql", ".css", ".scss", ".html", ".py", ".go", ".rs", ".java", ".kt", ".sh", ".bash", ".zsh", ".rb", ".php", ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx",
]);

export interface ScanPolicy {
  entrySkipReason(relPath: string, isDir: boolean): string | undefined;
  fileLanguageOrSkipReason(relPath: string, size: number): { language?: string; skipReason?: string };
  contentSkipReason(buffer: Buffer): string | undefined;
}

export function createScanPolicy(root: string): ScanPolicy {
  const rules = loadIgnoreRules(root);
  return {
    entrySkipReason(relPath, isDir) {
      return shouldSkip(relPath, isDir, rules);
    },
    fileLanguageOrSkipReason(relPath, size) {
      if (size > maxFileBytes) return { skipReason: "too large" };
      const language = detectLanguage(relPath);
      return language ? { language } : { skipReason: "unsupported extension" };
    },
    contentSkipReason(buffer) {
      return buffer.includes(0) ? "binary content" : undefined;
    },
  };
}

export function detectLanguage(path: string): string {
  const lower = path.toLowerCase();
  const ext = lower.match(/\.[^.]+$/)?.[0] ?? "";
  if (!textExtensions.has(ext)) return "";
  if (ext === ".md" || ext === ".mdx") return "markdown";
  if ([".ts", ".tsx"].includes(ext)) return "typescript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "javascript";
  if (ext === ".json") return "json";
  if ([".yml", ".yaml"].includes(ext)) return "yaml";
  if ([".c", ".h"].includes(ext)) return "c";
  if ([".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx"].includes(ext)) return "cpp";
  return ext.slice(1);
}
