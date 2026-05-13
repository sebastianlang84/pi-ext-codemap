import type { AgentToolResult, ExtensionAPI, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { codeMapOperations, deprecatedCallDetail, deprecatedToolDescription } from "./operations.ts";

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
  for (const operation of codeMapOperations) {
    pi.registerTool({
      label: operation.label,
      description: operation.description,
      promptSnippet: operation.promptSnippet,
      promptGuidelines: operation.promptGuidelines,
      parameters: operation.parameters,
      async execute(_id: string, params: unknown) {
        return textResult(operation.execute(process.cwd(), params));
      },
      renderResult: renderCodeMapResult,
      name: operation.toolName,
      renderCall(args, theme) {
        return renderCodeMapCall(operation.toolName, operation.renderCallDetail?.(args))(args, theme);
      },
    });
  }

  for (const operation of codeMapOperations) {
    pi.registerTool({
      label: `${operation.label} (deprecated alias)`,
      description: deprecatedToolDescription(operation),
      parameters: operation.parameters,
      async execute(_id: string, params: unknown) {
        return textResult(operation.execute(process.cwd(), params));
      },
      renderResult: renderCodeMapResult,
      name: operation.deprecatedToolName,
      renderCall(args, theme) {
        return renderCodeMapCall(operation.deprecatedToolName, deprecatedCallDetail(operation, args))(args, theme);
      },
    });
  }
}
