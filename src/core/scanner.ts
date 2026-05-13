import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, join, resolve } from "node:path";
import { createScanPolicy, detectLanguage } from "./scan-policy.ts";

export { detectLanguage };

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

export function scanRepo(root: string, options: { pathPrefix?: string } = {}): ScanResult {
  const policy = createScanPolicy(root);
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
      const entrySkip = policy.entrySkipReason(relPath, entry.isDirectory());
      if (entrySkip) { skipOne(entrySkip); continue; }
      if (entry.isDirectory()) { walk(absPath); continue; }
      if (!entry.isFile()) { skipOne("not a regular file"); continue; }

      const stat = statSync(absPath);
      const filePolicy = policy.fileLanguageOrSkipReason(relPath, stat.size);
      if (filePolicy.skipReason) { skipOne(filePolicy.skipReason); continue; }
      const buf = readFileSync(absPath);
      const contentSkip = policy.contentSkipReason(buf);
      if (contentSkip) { skipOne(contentSkip); continue; }
      const text = buf.toString("utf8");
      files.push({
        absPath,
        relPath,
        language: filePolicy.language ?? "",
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
