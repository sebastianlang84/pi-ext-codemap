import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { indexRepo, status } from "../core/indexer.ts";
import { searchCodeMapWithDiagnostics } from "../core/search.ts";
import { codemapContext } from "../core/context.ts";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], details: value };
}

function summarizeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const stale = record.stale === true ? " (stale)" : "";
    if (Array.isArray(record.results)) return `${record.results.length} result${record.results.length === 1 ? "" : "s"}${stale}`;
    if (Array.isArray(record.matches)) return `${record.matches.length} match${record.matches.length === 1 ? "" : "es"}${stale}`;
    if (Array.isArray(record.readFirst)) return `${record.readFirst.length} read-first item${record.readFirst.length === 1 ? "" : "s"}${stale}`;
    if (typeof record.status === "string") return record.status;
    if (typeof record.message === "string") return record.message;
    if (typeof record.indexed === "boolean") return record.stale === true ? "index stale" : "index ready";
    return Object.keys(record).slice(0, 4).join(", ") || "ok";
  }
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatWarnings(value: unknown, theme: Theme): string[] {
  if (!isRecord(value) || !Array.isArray(value.warnings) || value.warnings.length === 0) return [];
  return value.warnings.slice(0, 3).map((warning) => `${theme.fg("warning", "⚠")} ${String(warning)}`);
}

function formatItem(value: unknown, theme: Theme): string {
  if (!isRecord(value)) return theme.fg("dim", String(value));
  const path = typeof value.path === "string" ? value.path : "<unknown>";
  const start = typeof value.startLine === "number" ? value.startLine : undefined;
  const end = typeof value.endLine === "number" ? value.endLine : start;
  const loc = start ? `${path}:${start}${end && end !== start ? `-${end}` : ""}` : path;
  const kind = typeof value.kind === "string" ? ` ${theme.fg("muted", `[${value.kind}]`)}` : "";
  const snippet = typeof value.snippet === "string" ? ` ${theme.fg("dim", value.snippet.replace(/\s+/g, " ").slice(0, 120))}` : "";
  return `${theme.fg("toolTitle", loc)}${kind}${snippet}`;
}

function formatList(value: unknown, theme: Theme): string[] {
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => formatItem(item, theme));
  if (!isRecord(value)) return [];
  if (Array.isArray(value.results)) return value.results.slice(0, 8).map((item) => formatItem(item, theme));
  if (Array.isArray(value.readFirst)) return value.readFirst.slice(0, 8).map((item) => formatItem(item, theme));
  return [];
}

function renderCodeMapCall(label: string, detail?: unknown) {
  return (_args: unknown, theme: Theme) => {
    const text = detail === undefined || detail === "" ? "" : ` ${theme.fg("muted", String(detail))}`;
    return new Text(`${theme.fg("toolTitle", theme.bold(label))}${text}`, 0, 0);
  };
}

function renderCodeMapResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme) {
  const summary = summarizeValue(result.details);
  const warnings = formatWarnings(result.details, theme);
  const list = formatList(result.details, theme);
  const head = `${theme.fg("success", "✓")} ${summary}`;
  const compact = [head, ...warnings, ...list].join("\n");
  if (!options.expanded) {
    const hint = list.length > 0 || warnings.length > 0 ? ` ${theme.fg("dim", keyHint("app.tools.expand", "raw"))}` : ` ${theme.fg("dim", keyHint("app.tools.expand", "details"))}`;
    return new Text(`${compact}${hint}`, 0, 0);
  }

  const body = result.content.find((part) => part.type === "text")?.text ?? summary;
  return new Text(`${compact}\n${theme.fg("dim", body)}`, 0, 0);
}

export function registerCodeMapTools(pi: ExtensionAPI): void {
  const statusTool = {
    label: "CodeMap Status",
    description: "Show CodeMap approval and local SQLite index status for the current Git repository. Uses cheap diagnostics unless full=true.",
    parameters: Type.Object({
      full: Type.Optional(Type.Boolean({ description: "Run a full repository scan to report stale index diagnostics." })),
      pathPrefix: Type.Optional(Type.String({ description: "Limit diagnostics to an indexed subtree, e.g. services/api/." })),
    }),
    async execute(_id: string, params: { full?: boolean; pathPrefix?: string }) {
      return textResult(status(process.cwd(), { health: params.full === true ? "full" : "cheap", pathPrefix: params.pathPrefix }));
    },
    renderResult: renderCodeMapResult,
  };

  const indexTool = {
    label: "CodeMap Index",
    description: "Index or refresh the current Git repository for CodeMap. Requires approveRepo=true the first time.",
    parameters: Type.Object({
      approveRepo: Type.Optional(Type.Boolean({ description: "Approve this Git repository for local-only indexing." })),
      pathPrefix: Type.Optional(Type.String({ description: "Only index/refresh this repository subtree, e.g. services/api/." })),
    }),
    async execute(_id: string, params: { approveRepo?: boolean; pathPrefix?: string }) {
      return textResult(indexRepo({ cwd: process.cwd(), approve: params.approveRepo === true, pathPrefix: params.pathPrefix }));
    },
    renderResult: renderCodeMapResult,
  };

  const searchTool = {
    label: "CodeMap Search",
    description: "Search the CodeMap index using SQLite FTS over paths, chunks, and cheap symbols.",
    parameters: Type.Object({
      query: Type.String({ description: "Feature, symbol, path, or phrase to search for." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Maximum result count." })),
      pathPrefix: Type.Optional(Type.String({ description: "Limit results to an indexed subtree, e.g. services/api/." })),
    }),
    async execute(_id: string, params: { query: string; limit?: number; pathPrefix?: string }) {
      return textResult(searchCodeMapWithDiagnostics({ query: params.query, limit: params.limit, cwd: process.cwd(), pathPrefix: params.pathPrefix }));
    },
    renderResult: renderCodeMapResult,
  };

  const contextTool = {
    label: "CodeMap Context",
    description: "Return a compact read-first context package from CodeMap for an indexed file path or symbol/query.",
    parameters: Type.Object({
      target: Type.String({ description: "Indexed file path, symbol, subsystem, or phrase." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 25, description: "Maximum read-first items." })),
      pathPrefix: Type.Optional(Type.String({ description: "Limit lookup to an indexed subtree, e.g. services/api/." })),
    }),
    async execute(_id: string, params: { target: string; limit?: number; pathPrefix?: string }) {
      return textResult(codemapContext({ target: params.target, limit: params.limit, cwd: process.cwd(), pathPrefix: params.pathPrefix }));
    },
    renderResult: renderCodeMapResult,
  };

  pi.registerTool({ ...statusTool, name: "codemap_status", renderCall: renderCodeMapCall("codemap_status") });
  pi.registerTool({
    ...indexTool,
    name: "codemap_index",
    renderCall(args, theme) {
      return renderCodeMapCall("codemap_index", args.approveRepo ? "approve + index" : "refresh")(args, theme);
    },
  });
  pi.registerTool({
    ...searchTool,
    name: "codemap_search",
    renderCall(args, theme) {
      return renderCodeMapCall("codemap_search", args.query)(args, theme);
    },
  });
  pi.registerTool({
    ...contextTool,
    name: "codemap_context",
    renderCall(args, theme) {
      return renderCodeMapCall("codemap_context", args.target)(args, theme);
    },
  });

  pi.registerTool({ ...statusTool, name: "codebase_status", label: "CodeMap Status (deprecated alias)", description: "Deprecated alias for codemap_status. " + statusTool.description, renderCall: renderCodeMapCall("codebase_status", "deprecated: use codemap_status") });
  pi.registerTool({
    ...indexTool,
    name: "codebase_index",
    label: "CodeMap Index (deprecated alias)",
    description: "Deprecated alias for codemap_index. " + indexTool.description,
    renderCall(args, theme) {
      return renderCodeMapCall("codebase_index", args.approveRepo ? "deprecated: use codemap_index · approve + index" : "deprecated: use codemap_index · refresh")(args, theme);
    },
  });
  pi.registerTool({
    ...searchTool,
    name: "codebase_search",
    label: "CodeMap Search (deprecated alias)",
    description: "Deprecated alias for codemap_search. " + searchTool.description,
    renderCall(args, theme) {
      return renderCodeMapCall("codebase_search", `deprecated: use codemap_search · ${args.query}`)(args, theme);
    },
  });
  pi.registerTool({
    ...contextTool,
    name: "codebase_context",
    label: "CodeMap Context (deprecated alias)",
    description: "Deprecated alias for codemap_context. " + contextTool.description,
    renderCall(args, theme) {
      return renderCodeMapCall("codebase_context", `deprecated: use codemap_context · ${args.target}`)(args, theme);
    },
  });
}
