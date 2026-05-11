import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, join, resolve } from "node:path";
import { loadIgnoreRules, shouldSkip } from "./ignore.ts";

export interface ScannedFile {
  absPath: string;
  relPath: string;
  language: string;
  size: number;
  mtimeMs: number;
  hash: string;
  text: string;
}

export interface ScanResult {
  files: ScannedFile[];
  skipped: number;
  skippedReasons: Record<string, number>;
  warnings: string[];
}

const maxFileBytes = 1_000_000;
const textExtensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".txt", ".yml", ".yaml", ".toml", ".sql", ".css", ".scss", ".html", ".py", ".go", ".rs", ".java", ".kt", ".sh", ".bash", ".zsh", ".rb", ".php", ".c", ".h", ".cpp", ".hpp",
]);

export function scanRepo(root: string, options: { pathPrefix?: string } = {}): ScanResult {
  const rules = loadIgnoreRules(root);
  const prefix = normalizePathPrefix(options.pathPrefix);
  const files: ScannedFile[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  const skippedReasons: Record<string, number> = {};
  const skipOne = (reason: string) => {
    skipped++;
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
  };

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absPath = join(dir, entry.name);
      const relPath = relative(root, absPath).split("\\").join("/");
      if (entry.isSymbolicLink()) { skipOne("symlink"); continue; }
      const skip = shouldSkip(relPath, entry.isDirectory(), rules);
      if (skip) { skipOne(skip); continue; }
      if (entry.isDirectory()) { walk(absPath); continue; }
      if (!entry.isFile()) { skipOne("not a regular file"); continue; }

      const stat = statSync(absPath);
      if (stat.size > maxFileBytes) { skipOne("too large"); continue; }
      const language = detectLanguage(relPath);
      if (!language) { skipOne("unsupported extension"); continue; }
      const buf = readFileSync(absPath);
      if (buf.includes(0)) { skipOne("binary content"); continue; }
      const text = buf.toString("utf8");
      files.push({
        absPath,
        relPath,
        language,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        hash: createHash("sha256").update(buf).digest("hex"),
        text,
      });
    }
  }

  try {
    if (prefix) {
      const repoRoot = resolve(root);
      const scopedRoot = resolve(root, prefix);
      if (scopedRoot !== repoRoot && !scopedRoot.startsWith(`${repoRoot}/`)) warnings.push(`Invalid pathPrefix outside repository: ${options.pathPrefix}`);
      else walk(scopedRoot);
    } else {
      walk(root);
    }
  } catch (error) { warnings.push(String(error)); }
  return { files, skipped, skippedReasons, warnings };
}

export function normalizePathPrefix(pathPrefix?: string): string {
  if (!pathPrefix) return "";
  const normalized = pathPrefix.trim().replace(/^\.\/?/, "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized === ".") return "";
  return `${normalized}/`;
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
  return ext.slice(1);
}
