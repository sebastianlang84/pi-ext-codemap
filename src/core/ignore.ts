import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ignoredDirs = new Set([
  ".git", "node_modules", "dist", "build", "target", ".next", "coverage", "vendor", ".turbo", ".cache", ".idea", ".vscode", ".pi/npm", ".pi/git",
  ".venv", "venv", "env", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", "site-packages", ".gradle", ".parcel-cache",
]);
const ignoredFiles = [
  /\.lock$/i,
  /^(?:package-lock|npm-shrinkwrap)\.json$/i,
  /^pnpm-lock\.ya?ml$/i,
  /^yarn\.lock$/i,
  /\.min\.js$/i,
  /\.png$/i,
  /\.jpe?g$/i,
  /\.gif$/i,
  /\.webp$/i,
  /\.pdf$/i,
  /\.zip$/i,
  /\.sqlite(?:-wal|-shm)?$/i,
];
const secretish = [/^\.env($|\.)/, /secret/i, /private[-_]?key/i];

export interface IgnoreRules {
  gitignore: string[];
  codemapignore: string[];
}

export function loadIgnoreRules(root: string): IgnoreRules {
  return {
    gitignore: loadIgnoreFile(join(root, ".gitignore")),
    codemapignore: loadIgnoreFile(join(root, ".codemapignore")),
  };
}

function loadIgnoreFile(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));
}

export function shouldSkip(relPath: string, isDir: boolean, rules: IgnoreRules): string | undefined {
  const parts = relPath.split("/");
  if (parts.some((part) => ignoredDirs.has(part))) return "ignored directory";
  const name = parts[parts.length - 1] ?? relPath;
  if (!isDir && ignoredFiles.some((rx) => rx.test(name))) return "binary/generated extension";
  if (!isDir && secretish.some((rx) => rx.test(name) || rx.test(relPath))) return "secret-like file";

  const gitignore = matchPatterns(relPath, name, rules.gitignore);
  if (gitignore) return ".gitignore";
  const codemapignore = matchPatterns(relPath, name, rules.codemapignore);
  if (codemapignore) return ".codemapignore";
  return undefined;
}

function matchPatterns(relPath: string, name: string, patterns: string[]): boolean {
  for (const raw of patterns) {
    const pattern = raw.replace(/^\//, "");
    if (pattern.endsWith("/") && (relPath === pattern.slice(0, -1) || relPath.startsWith(pattern))) return true;
    if (pattern.includes("*")) {
      const rx = new RegExp("^" + pattern.split("*").map(escapeRegExp).join(".*") + "$" );
      if (rx.test(relPath) || rx.test(name)) return true;
    } else if (relPath === pattern || relPath.startsWith(pattern + "/") || name === pattern) {
      return true;
    }
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
