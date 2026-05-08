import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { indexRepo, status } from "../core/indexer.ts";
import { searchCodebase } from "../core/search.ts";
import { codebaseContext } from "../core/context.ts";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], details: value };
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
  });
}
