import { codeMapOperationMetadataById, type CodeMapOperationMetadata } from "../application/operation-metadata.ts";
import { codeMapContext, codeMapIndex, codeMapSearch, codeMapStatus } from "../application/operations.ts";

// Re-export the Pi-free execution surface so existing importers keep a single entrypoint.
export { codeMapContext, codeMapIndex, codeMapSearch, codeMapStatus } from "../application/operations.ts";

export type CommandNotifyLevel = "info" | "warning" | "error";

export interface CommandNotification {
  message: string;
  level: CommandNotifyLevel;
}

export interface CodeMapOperation extends CodeMapOperationMetadata {
  execute(cwd: string, params: any): any;
  parseCommandArgs(args: string): any;
  formatCommandResult(result: any): CommandNotification;
  renderCallDetail?(params: any): string | undefined;
}

function splitCommandArgs(args: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const char = args[i];
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function parseCommonArgs(args: string): { flags: Set<string>; pathPrefix?: string; repoPath?: string; query: string } {
  const parts = splitCommandArgs(args);
  const flags = new Set<string>();
  const kept: string[] = [];
  let pathPrefix: string | undefined;
  let repoPath: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "--path-prefix") {
      pathPrefix = parts[++i];
    } else if (part.startsWith("--path-prefix=")) {
      pathPrefix = part.slice("--path-prefix=".length);
    } else if (part === "--repo-path") {
      repoPath = parts[++i];
    } else if (part.startsWith("--repo-path=")) {
      repoPath = part.slice("--repo-path=".length);
    } else if (part === "--full" || part === "--approve-repo") {
      flags.add(part);
    } else {
      kept.push(part);
    }
  }
  return { flags, pathPrefix, repoPath, query: kept.join(" ") };
}

export function parsePathPrefix(args: string): { pathPrefix?: string; repoPath?: string; query: string } {
  const { flags: _flags, ...parsed } = parseCommonArgs(args);
  return parsed;
}

function parseStatusArgs(args: string) {
  const parsed = parseCommonArgs(args);
  return { full: parsed.flags.has("--full"), pathPrefix: parsed.pathPrefix, repoPath: parsed.repoPath };
}

function parseIndexArgs(args: string) {
  const parsed = parseCommonArgs(args);
  return { approveRepo: parsed.flags.has("--approve-repo"), pathPrefix: parsed.pathPrefix, repoPath: parsed.repoPath };
}

function parseQueryArgs(args: string) {
  const parsed = parseCommonArgs(args);
  return { query: parsed.query, limit: 10, pathPrefix: parsed.pathPrefix, repoPath: parsed.repoPath };
}

function parseContextArgs(args: string) {
  const parsed = parseCommonArgs(args);
  return { target: parsed.query, limit: 8, pathPrefix: parsed.pathPrefix, repoPath: parsed.repoPath };
}

export const codeMapOperations: readonly CodeMapOperation[] = [
  {
    ...codeMapOperationMetadataById.status,
    execute: (cwd, params) => codeMapStatus(cwd, params, "pi"),
    parseCommandArgs: parseStatusArgs,
    formatCommandResult(result) {
      return { message: JSON.stringify(result, null, 2), level: "info" };
    },
  },
  {
    ...codeMapOperationMetadataById.index,
    execute: (cwd, params) => codeMapIndex(cwd, params, "pi"),
    parseCommandArgs: parseIndexArgs,
    formatCommandResult(result) {
      return { message: `Indexed ${result.indexed}/${result.scanned} files (${result.skipped} skipped)`, level: "info" };
    },
    renderCallDetail(params) {
      return params.approveRepo ? "approve + index" : "refresh";
    },
  },
  {
    ...codeMapOperationMetadataById.search,
    execute: (cwd, params) => codeMapSearch(cwd, params, "pi"),
    parseCommandArgs: parseQueryArgs,
    formatCommandResult(result) {
      const warnings = result.warnings.length > 0 ? `${result.warnings.map((warning: string) => `⚠ ${warning}`).join("\n")}\n` : "";
      const rows = result.results.map((row: { path: string; startLine: number; endLine: number; kind: string }) => `${row.path}:${row.startLine}-${row.endLine} ${row.kind}`).join("\n") || "No results";
      return { message: `${warnings}${rows}`, level: result.stale ? "warning" : "info" };
    },
    renderCallDetail(params) {
      return params.query;
    },
  },
  {
    ...codeMapOperationMetadataById.context,
    execute: (cwd, params) => codeMapContext(cwd, params, "pi"),
    parseCommandArgs: parseContextArgs,
    formatCommandResult(result) {
      return { message: JSON.stringify(result, null, 2), level: "info" };
    },
    renderCallDetail(params) {
      return params.target;
    },
  },
];
