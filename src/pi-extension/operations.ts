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
  commandName: string;
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
    commandName: "codemap-status",
    description: "Show CodeMap approval and local SQLite index status for the current Git repository. Uses cheap diagnostics unless full=true.",
    commandDescription: "Show CodeMap approval/index status; pass --full for stale diagnostics",
    promptSnippet: "Check CodeMap approval/index readiness and stale state for cwd.",
    promptGuidelines: [
      "Use codemap_status before search/context when approval or index state is unknown.",
      "Use codemap_status full=true only for stale diagnostics.",
      "Use codemap_status pathPrefix for monorepos.",
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
    commandName: "codemap-index",
    description: "Index or refresh the current Git repository for CodeMap. Requires approveRepo=true the first time.",
    commandDescription: "Index current repo for CodeMap; pass --approve-repo the first time",
    promptSnippet: "Approve once or refresh the CodeMap index for cwd.",
    promptGuidelines: [
      "Use codemap_index approveRepo=true only after explicit local approval.",
      "Use codemap_index when codemap_status says missing or stale.",
      "Use codemap_index pathPrefix to refresh one subtree.",
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
    commandName: "codemap-search",
    description: "Search the CodeMap index using SQLite FTS over paths, chunks, and cheap symbols.",
    commandDescription: "Search the CodeMap index: /codemap-search <query>",
    promptSnippet: "Search indexed CodeMap paths, chunks, and symbols by query.",
    promptGuidelines: [
      "Use codemap_search for navigation when target path/symbol is unknown.",
      "Use codemap_search query terms; add pathPrefix in monorepos.",
      "Treat codemap_search stale warnings as advisory.",
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
    commandName: "codemap-context",
    description: "Return a compact read-first context package from CodeMap for an indexed file path or symbol/query.",
    commandDescription: "Get CodeMap read-first context: /codemap-context <path-or-symbol>",
    promptSnippet: "Get read-first context from indexed CodeMap files or query matches.",
    promptGuidelines: [
      "Use codemap_context after codemap_search to choose files to read.",
      "Use codemap_context for read-first hints, not as a read substitute.",
      "Use codemap_context pathPrefix to scope monorepos.",
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
