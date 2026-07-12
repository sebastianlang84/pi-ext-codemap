import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Check, Errors } from "typebox/value";
import { codeMapOperationMetadata } from "../application/operation-metadata.js";
import { codeMapContext, codeMapIndex, codeMapSearch, codeMapStatus } from "../application/operations.js";
// Minimal Model Context Protocol server exposing the same codemap_* tools as the Pi extension to
// non-Pi hosts (Claude Code, Codex, ...). MCP over stdio is newline-delimited JSON-RPC 2.0, so no
// SDK dependency is needed — we speak the handful of methods a tools-only server must support.
// Latest protocol revision we implement; advertised when a client omits or requests a version we do
// not support. We only list post-batch-removal revisions since this server does not do JSON-RPC
// batching (removed in 2025-06-18).
const PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-11-25", "2025-06-18"]);
const INSTRUCTIONS = "Use these tools to navigate code in this repo. codemap_search ranks files/symbols/chunks — start there when the target file/symbol is unknown or the query is conceptual; for exhaustive matches of a known literal or regex, grep/rg is the right tool. If a search result is missing, re-query or raise limit before anything else. codemap_context lists read-first neighbors (tests/docs/imports) of a known target — use it as a follow-up on a file you already trust, passing an exact path or symbol, not a broad query; do not point it at an uncertain top search hit, as it expands whatever it lands on. codemap_status checks index readiness. Run codemap_index to build/refresh; the first index needs approveRepo=true and only after the user approves local indexing. Staleness is advisory. If your host lists these tools without preloading their schemas (deferred tools), load all four before the first call.";
const executors = {
    codemap_status: codeMapStatus,
    codemap_index: codeMapIndex,
    codemap_search: codeMapSearch,
    codemap_context: codeMapContext,
};
const parametersByTool = new Map(codeMapOperationMetadata.map((operation) => [operation.toolName, operation.parameters]));
// Read-only tools can be auto-run by hosts without a confirmation prompt; index writes the local
// cache (non-destructive, idempotent). openWorldHint=false: everything operates on the local repo.
const annotationsById = {
    status: { readOnlyHint: true, openWorldHint: false },
    search: { readOnlyHint: true, openWorldHint: false },
    context: { readOnlyHint: true, openWorldHint: false },
    index: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
export const mcpTools = codeMapOperationMetadata.map((operation) => ({
    name: operation.toolName,
    description: operation.description,
    inputSchema: operation.parameters,
    annotations: { title: operation.label, ...annotationsById[operation.id] },
}));
function serverVersion() {
    try {
        const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
        return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "0.0.0";
    }
    catch {
        return "0.0.0";
    }
}
function result(id, value) {
    return { jsonrpc: "2.0", id: id ?? null, result: value };
}
function error(id, code, message) {
    return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function toolResult(text, structured, isError = false) {
    const payload = { content: [{ type: "text", text }] };
    // structuredContent carries the full object once, for hosts that parse it; the text stays compact
    // so the model spends tokens on the ranked shortlist, not a duplicated JSON tree.
    if (structured)
        payload.structuredContent = structured;
    if (isError)
        payload.isError = true;
    return payload;
}
// Validate arguments against the tool's full TypeBox schema so a bad call yields a message the model
// can act on instead of a downstream TypeError. The explicit required-field pass keeps the friendly
// "Missing required argument: query" wording; the TypeBox Check then enforces types plus constraints
// (e.g. limit range, object-vs-string). Extra properties are allowed (schemas are open objects).
// Returns an error string, or null when the arguments satisfy the schema.
function validateArgs(name, args) {
    const schema = parametersByTool.get(name);
    if (!isRecord(schema))
        return null;
    const required = Array.isArray(schema.required) ? schema.required : [];
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const key of required) {
        const value = args[key];
        if (value === undefined || value === null)
            return `Missing required argument: ${key}`;
        const expectedType = isRecord(properties[key]) ? properties[key].type : undefined;
        if (typeof expectedType === "string" && typeof value !== expectedType) {
            return `Argument ${key} must be of type ${expectedType}`;
        }
    }
    // Backstop: full-schema validation catches what the required-field pass above does not — optional
    // arguments with the wrong type (e.g. limit as a string or object) and numeric range violations.
    if (Check(schema, args))
        return null;
    const firstError = [...Errors(schema, args)][0];
    if (!firstError)
        return "Invalid arguments.";
    const path = firstError.path ?? "";
    const location = path ? `${path.replace(/^\//, "").replace(/\//g, ".")}: ` : "";
    return `Invalid argument: ${location}${firstError.message}`;
}
function callTool(request, cwd) {
    const name = typeof request.params?.name === "string" ? request.params.name : "";
    const executor = executors[name];
    // SEP-1303: unknown-tool, bad-argument, and execution failures are Tool Execution Errors (isError),
    // not JSON-RPC protocol errors, so the model can read the message and self-correct.
    if (!executor) {
        return result(request.id, toolResult(`Unknown tool: ${name || "(missing name)"}. Available: ${Object.keys(executors).join(", ")}.`, undefined, true));
    }
    const args = isRecord(request.params?.arguments) ? request.params.arguments : {};
    const validationError = validateArgs(name, args);
    if (validationError)
        return result(request.id, toolResult(validationError, undefined, true));
    try {
        const value = executor(cwd, args);
        const structured = isRecord(value) ? value : undefined;
        return result(request.id, toolResult(summarize(name, value), structured));
    }
    catch (err) {
        return result(request.id, toolResult(err instanceof Error ? err.message : String(err), undefined, true));
    }
}
function staleSuffix(value) {
    return value.stale === true ? "\n(!) index is stale for this query; run codemap_index to refresh" : "";
}
// Compact, agent-readable summaries — the token-lean per-call payload. Full detail stays in
// structuredContent for hosts that parse it.
function summarize(name, value) {
    if (!isRecord(value))
        return typeof value === "string" ? value : JSON.stringify(value);
    switch (name) {
        case "codemap_status": {
            const lines = [
                `readiness: ${value.readiness}`,
                `approved:  ${value.approved}`,
                `indexed:   ${value.indexed} (${value.files} files, ${value.symbols} symbols)`,
                `stale:     ${value.stale}${value.headChanged ? " (Git HEAD changed)" : ""}`,
            ];
            return [...lines, ...warningLines(value)].join("\n");
        }
        case "codemap_index":
            return [`Indexed ${value.indexed}/${value.scanned} files (${value.skipped} skipped, ${value.removed} removed)`, ...warningLines(value)].join("\n");
        case "codemap_search": {
            const results = Array.isArray(value.results) ? value.results : [];
            const rows = results.map((r) => `${r.path}:${r.startLine}-${r.endLine} [${r.kind}]`);
            const confidenceLevel = isRecord(value.topHitConfidence) ? value.topHitConfidence.level : undefined;
            const confidence = confidenceLevel === "low"
                ? ["top-hit confidence: low — the top result is one of several near-ties; do not use it as a codemap_context target without verifying it first"]
                : [];
            return [...warningLines(value), ...confidence, rows.join("\n") || "No results"].join("\n") + staleSuffix(value);
        }
        case "codemap_context": {
            const readFirst = Array.isArray(value.readFirst) ? value.readFirst : [];
            const rows = readFirst.map((item) => {
                const reasons = Array.isArray(item.reasons) && item.reasons.length > 0 ? ` (${item.reasons.map((reason) => reason.kind).join(", ")})` : "";
                return `${item.path}:${item.startLine}-${item.endLine} [${item.kind}]${reasons}`;
            });
            const tail = [];
            if (Array.isArray(value.relatedTests) && value.relatedTests.length > 0)
                tail.push(`tests: ${value.relatedTests.join(", ")}`);
            if (Array.isArray(value.relatedDocs) && value.relatedDocs.length > 0)
                tail.push(`docs: ${value.relatedDocs.join(", ")}`);
            return [rows.join("\n") || "No read-first items", ...tail].join("\n") + staleSuffix(value);
        }
        default:
            return JSON.stringify(value, null, 2);
    }
}
function warningLines(value) {
    return Array.isArray(value.warnings) ? value.warnings.map((warning) => `(!) ${warning}`) : [];
}
/**
 * Handle a single decoded JSON-RPC message. Returns the response to write back, or null for
 * notifications (no id) which must never be answered. Pure and synchronous so it is trivially testable.
 */
export function dispatch(request, io = {}) {
    // A JSON-RPC notification omits `id`; the server MUST NOT reply to one, whatever its method.
    if (request.id === undefined)
        return null;
    const cwd = io.cwd ?? process.cwd();
    switch (request.method) {
        case "initialize": {
            const requested = request.params?.protocolVersion;
            return result(request.id, {
                protocolVersion: typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: { name: "codemap", version: serverVersion(), description: "Local SQLite/FTS repo map: ranked code/doc/config search and read-first context." },
                instructions: INSTRUCTIONS,
            });
        }
        case "ping":
            return result(request.id, {});
        case "tools/list":
            return result(request.id, { tools: mcpTools });
        case "tools/call":
            return callTool(request, cwd);
        default:
            return error(request.id, -32601, `Method not found: ${request.method ?? "(missing)"}`);
    }
}
