import { Type } from "typebox";
import { codemapContext } from "../core/context.ts";
import { indexRepo, status } from "../core/indexer.ts";
import { searchCodeMapWithDiagnostics } from "../core/search.ts";

export type CommandNotifyLevel = "info" | "warning" | "error";

export interface CommandNotification {
  message: string;
  level: CommandNotifyLevel;
}

export interface CodeMapOperation {
  id: "status" | "index" | "search" | "context";
  label: string;
  toolName: string;
  deprecatedToolName: string;
  commandName: string;
  deprecatedCommandName: string;
  description: string;
  commandDescription: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: any;
  execute(cwd: string, params: any): any;
  parseCommandArgs(args: string): any;
  formatCommandResult(result: any): CommandNotification;
  renderCallDetail?(params: any): string | undefined;
}

export function parsePathPrefix(args: string): { pathPrefix?: string; query: string } {
  const parts = args.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  let pathPrefix: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "--path-prefix") {
      pathPrefix = parts[++i];
    } else if (part.startsWith("--path-prefix=")) {
      pathPrefix = part.slice("--path-prefix=".length);
    } else {
      kept.push(part);
    }
  }
  return { pathPrefix, query: kept.join(" ") };
}

function parseStatusArgs(args: string) {
  const parsed = parsePathPrefix(args);
  return { full: args.includes("--full"), pathPrefix: parsed.pathPrefix };
}

function parseIndexArgs(args: string) {
  const parsed = parsePathPrefix(args);
  return { approveRepo: args.includes("--approve-repo"), pathPrefix: parsed.pathPrefix };
}

function parseQueryArgs(args: string) {
  const parsed = parsePathPrefix(args);
  return { query: parsed.query, limit: 10, pathPrefix: parsed.pathPrefix };
}

function parseContextArgs(args: string) {
  const parsed = parsePathPrefix(args);
  return { target: parsed.query, limit: 8, pathPrefix: parsed.pathPrefix };
}

export const codeMapOperations: readonly CodeMapOperation[] = [
  {
    id: "status",
    label: "CodeMap Status",
    toolName: "codemap_status",
    deprecatedToolName: "codebase_status",
    commandName: "codemap-status",
    deprecatedCommandName: "codebase-status",
    description: "Show CodeMap approval and local SQLite index status for the current Git repository. Uses cheap diagnostics unless full=true.",
    commandDescription: "Show CodeMap approval/index status; pass --full for stale diagnostics",
    promptSnippet: "Check CodeMap repo approval, index freshness, and optional subtree diagnostics before relying on indexed context.",
    promptGuidelines: [
      "Use codemap_status when repository approval, index existence, or index freshness is uncertain.",
      "Use codemap_status with full=true only when stale diagnostics need a full repository scan.",
      "Use codemap_status pathPrefix for monorepos or focused subtree work.",
    ],
    parameters: Type.Object({
      full: Type.Optional(Type.Boolean({ description: "Run a full repository scan to report stale index diagnostics." })),
      pathPrefix: Type.Optional(Type.String({ description: "Limit diagnostics to an indexed subtree, e.g. services/api/." })),
    }),
    execute: codeMapStatus,
    parseCommandArgs: parseStatusArgs,
    formatCommandResult(result) {
      return { message: JSON.stringify(result, null, 2), level: "info" };
    },
  },
  {
    id: "index",
    label: "CodeMap Index",
    toolName: "codemap_index",
    deprecatedToolName: "codebase_index",
    commandName: "codemap-index",
    deprecatedCommandName: "codebase-index",
    description: "Index or refresh the current Git repository for CodeMap. Requires approveRepo=true the first time.",
    commandDescription: "Index current repo for CodeMap; pass --approve-repo the first time",
    promptSnippet: "Index or refresh the current Git repository for CodeMap after explicit repo approval or when the index is stale.",
    promptGuidelines: [
      "Use codemap_index when codemap_status reports a missing or stale index and indexed navigation is useful.",
      "Use codemap_index with approveRepo=true only for explicit local-only repository approval.",
      "Use codemap_index pathPrefix to refresh only the relevant subtree in large repos or monorepos.",
    ],
    parameters: Type.Object({
      approveRepo: Type.Optional(Type.Boolean({ description: "Approve this Git repository for local-only indexing." })),
      pathPrefix: Type.Optional(Type.String({ description: "Only index/refresh this repository subtree, e.g. services/api/." })),
    }),
    execute: codeMapIndex,
    parseCommandArgs: parseIndexArgs,
    formatCommandResult(result) {
      return { message: `Indexed ${result.indexed}/${result.scanned} files (${result.skipped} skipped)`, level: "info" };
    },
    renderCallDetail(params) {
      return params.approveRepo ? "approve + index" : "refresh";
    },
  },
  {
    id: "search",
    label: "CodeMap Search",
    toolName: "codemap_search",
    deprecatedToolName: "codebase_search",
    commandName: "codemap-search",
    deprecatedCommandName: "codebase-search",
    description: "Search the CodeMap index using SQLite FTS over paths, chunks, and cheap symbols.",
    commandDescription: "Search the CodeMap index: /codemap-search <query>",
    promptSnippet: "Search indexed repository paths, chunks, and symbols for feature, file, symbol, or subsystem discovery.",
    promptGuidelines: [
      "Use codemap_search for repository navigation when the target file, feature, symbol, or subsystem is not already known.",
      "Use compact natural-language or symbol queries with codemap_search; prefer pathPrefix for monorepos.",
      "Do not treat codemap_search results as authoritative when the index is stale; refresh or read files directly.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Feature, symbol, path, or phrase to search for." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Maximum result count." })),
      pathPrefix: Type.Optional(Type.String({ description: "Limit results to an indexed subtree, e.g. services/api/." })),
    }),
    execute: codeMapSearch,
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
    id: "context",
    label: "CodeMap Context",
    toolName: "codemap_context",
    deprecatedToolName: "codebase_context",
    commandName: "codemap-context",
    deprecatedCommandName: "codebase-context",
    description: "Return a compact read-first context package from CodeMap for an indexed file path or symbol/query.",
    commandDescription: "Get CodeMap read-first context: /codemap-context <path-or-symbol>",
    promptSnippet: "Get compact read-first context for an indexed file, symbol, feature, or subsystem before reading broader code.",
    promptGuidelines: [
      "Use codemap_context after locating a likely file, symbol, feature, or subsystem to decide what to read first.",
      "Use codemap_context for context packaging, not as a substitute for reading source files before editing.",
      "Use codemap_context pathPrefix to keep read-first context scoped in monorepos.",
    ],
    parameters: Type.Object({
      target: Type.String({ description: "Indexed file path, symbol, subsystem, or phrase." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 25, description: "Maximum read-first items." })),
      pathPrefix: Type.Optional(Type.String({ description: "Limit lookup to an indexed subtree, e.g. services/api/." })),
    }),
    execute: codeMapContext,
    parseCommandArgs: parseContextArgs,
    formatCommandResult(result) {
      return { message: JSON.stringify(result, null, 2), level: "info" };
    },
    renderCallDetail(params) {
      return params.target;
    },
  },
];

export function deprecatedToolDescription(operation: CodeMapOperation): string {
  return `Deprecated alias for ${operation.toolName}. ${operation.description}`;
}

export function deprecatedCommandDescription(operation: CodeMapOperation): string {
  return `Deprecated alias for /${operation.commandName}. ${operation.commandDescription}`;
}

export function deprecatedCallDetail(operation: CodeMapOperation, params: any): string {
  const detail = operation.renderCallDetail?.(params);
  return detail ? `deprecated: use ${operation.toolName} · ${detail}` : `deprecated: use ${operation.toolName}`;
}

export function codeMapStatus(cwd: string, params: { full?: boolean; pathPrefix?: string }) {
  return status(cwd, { health: params.full === true ? "full" : "cheap", pathPrefix: params.pathPrefix });
}

export function codeMapIndex(cwd: string, params: { approveRepo?: boolean; pathPrefix?: string }) {
  return indexRepo({ cwd, approve: params.approveRepo === true, pathPrefix: params.pathPrefix });
}

export function codeMapSearch(cwd: string, params: { query: string; limit?: number; pathPrefix?: string }) {
  return searchCodeMapWithDiagnostics({ query: params.query, cwd, limit: params.limit, pathPrefix: params.pathPrefix });
}

export function codeMapContext(cwd: string, params: { target: string; limit?: number; pathPrefix?: string }) {
  return codemapContext({ target: params.target, cwd, limit: params.limit, pathPrefix: params.pathPrefix });
}
