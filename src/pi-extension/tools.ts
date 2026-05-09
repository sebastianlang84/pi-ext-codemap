import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { indexRepo, status } from "../core/indexer.ts";
import { searchCodebase } from "../core/search.ts";
import { codebaseContext } from "../core/context.ts";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], details: value };
}

function summarizeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.results)) return `${record.results.length} result${record.results.length === 1 ? "" : "s"}`;
    if (Array.isArray(record.matches)) return `${record.matches.length} match${record.matches.length === 1 ? "" : "es"}`;
    if (Array.isArray(record.readFirst)) return `${record.readFirst.length} read-first item${record.readFirst.length === 1 ? "" : "s"}`;
    if (typeof record.status === "string") return record.status;
    if (typeof record.message === "string") return record.message;
    return Object.keys(record).slice(0, 4).join(", ") || "ok";
  }
  return String(value);
}

function renderCodeSearchCall(label: string, detail?: unknown) {
  return (_args: unknown, theme: Theme) => {
    const text = detail === undefined || detail === "" ? "" : ` ${theme.fg("muted", String(detail))}`;
    return new Text(`${theme.fg("toolTitle", theme.bold(label))}${text}`, 0, 0);
  };
}

function renderCodeSearchResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme) {
  const summary = summarizeValue(result.details);
  if (!options.expanded) {
    return new Text(`${theme.fg("success", "✓")} ${summary} ${theme.fg("dim", keyHint("app.tools.expand", "details"))}`, 0, 0);
  }

  const body = result.content.find((part) => part.type === "text")?.text ?? summary;
  return new Text(`${theme.fg("success", "✓")} ${summary}\n${theme.fg("dim", body)}`, 0, 0);
}

export function registerCodeSearchTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "codebase_status",
    label: "Codebase Status",
    description: "Show approval and local SQLite index status for the current Git repository.",
    parameters: Type.Object({}),
    async execute(_id, _params) {
      return textResult(status(process.cwd()));
    },
    renderCall: renderCodeSearchCall("codebase_status"),
    renderResult: renderCodeSearchResult,
  });

  pi.registerTool({
    name: "codebase_index",
    label: "Codebase Index",
    description: "Index or refresh the current Git repository. Requires approveRepo=true the first time.",
    parameters: Type.Object({
      approveRepo: Type.Optional(Type.Boolean({ description: "Approve this Git repository for local-only indexing." })),
    }),
    async execute(_id, params) {
      return textResult(indexRepo({ cwd: process.cwd(), approve: params.approveRepo === true }));
    },
    renderCall(args, theme) {
      return renderCodeSearchCall("codebase_index", args.approveRepo ? "approve + index" : "refresh")(args, theme);
    },
    renderResult: renderCodeSearchResult,
  });

  pi.registerTool({
    name: "codebase_search",
    label: "Codebase Search",
    description: "Search the indexed repository using SQLite FTS over paths, chunks, and cheap symbols.",
    parameters: Type.Object({
      query: Type.String({ description: "Feature, symbol, path, or phrase to search for." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Maximum result count." })),
    }),
    async execute(_id, params) {
      return textResult(searchCodebase({ query: params.query, limit: params.limit, cwd: process.cwd() }));
    },
    renderCall(args, theme) {
      return renderCodeSearchCall("codebase_search", args.query)(args, theme);
    },
    renderResult: renderCodeSearchResult,
  });

  pi.registerTool({
    name: "codebase_context",
    label: "Codebase Context",
    description: "Return a compact read-first context package for an indexed file path or symbol/query.",
    parameters: Type.Object({
      target: Type.String({ description: "Indexed file path, symbol, subsystem, or phrase." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 25, description: "Maximum read-first items." })),
    }),
    async execute(_id, params) {
      return textResult(codebaseContext({ target: params.target, limit: params.limit, cwd: process.cwd() }));
    },
    renderCall(args, theme) {
      return renderCodeSearchCall("codebase_context", args.target)(args, theme);
    },
    renderResult: renderCodeSearchResult,
  });
}
