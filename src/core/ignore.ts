import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ignoredDirs = new Set([
  ".git", "node_modules", "dist", "build", "target", ".next", "coverage", "vendor", ".turbo", ".cache", ".idea", ".vscode", ".pi/npm", ".pi/git",
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
}

export function loadIgnoreRules(root: string): IgnoreRules {
  const path = join(root, ".gitignore");
  if (!existsSync(path)) return { gitignore: [] };
  const gitignore = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));
  return { gitignore };
}

export function shouldSkip(relPath: string, isDir: boolean, rules: IgnoreRules): string | undefined {
  const parts = relPath.split("/");
  if (parts.some((part) => ignoredDirs.has(part))) return "ignored directory";
  const name = parts[parts.length - 1] ?? relPath;
  if (!isDir && ignoredFiles.some((rx) => rx.test(name))) return "binary/generated extension";
  if (!isDir && secretish.some((rx) => rx.test(name) || rx.test(relPath))) return "secret-like file";

  for (const raw of rules.gitignore) {
    const pattern = raw.replace(/^\//, "");
    if (pattern.endsWith("/") && (relPath === pattern.slice(0, -1) || relPath.startsWith(pattern))) return ".gitignore";
    if (pattern.includes("*")) {
      const rx = new RegExp("^" + pattern.split("*").map(escapeRegExp).join(".*") + "$" );
      if (rx.test(relPath) || rx.test(name)) return ".gitignore";
    } else if (relPath === pattern || relPath.startsWith(pattern + "/") || name === pattern) {
      return ".gitignore";
    }
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
