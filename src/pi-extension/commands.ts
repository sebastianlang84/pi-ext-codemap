import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { indexRepo, status } from "../core/indexer.ts";
import { searchCodebase } from "../core/search.ts";
import { codebaseContext } from "../core/context.ts";

export function registerCodeSearchCommands(pi: ExtensionAPI): void {
  pi.registerCommand("codebase-status", {
    description: "Show code-search approval/index status",
    handler: async (_args, ctx) => ctx.ui.notify(JSON.stringify(status(process.cwd()), null, 2), "info"),
  });

  pi.registerCommand("codebase-index", {
    description: "Index current repo; pass --approve-repo the first time",
    handler: async (args, ctx) => {
      const result = indexRepo({ cwd: process.cwd(), approve: args.includes("--approve-repo") });
      ctx.ui.notify(`Indexed ${result.indexed}/${result.scanned} files (${result.skipped} skipped)`, "info");
    },
  });

  pi.registerCommand("codebase-search", {
    description: "Search indexed repo: /codebase-search <query>",
    handler: async (args, ctx) => {
      const results = searchCodebase({ query: args, cwd: process.cwd(), limit: 10 });
      ctx.ui.notify(results.map((r) => `${r.path}:${r.startLine}-${r.endLine} ${r.kind}`).join("\n") || "No results", "info");
    },
  });

  pi.registerCommand("codebase-context", {
    description: "Get read-first context: /codebase-context <path-or-symbol>",
    handler: async (args, ctx) => {
      const result = codebaseContext({ target: args, cwd: process.cwd(), limit: 8 });
      ctx.ui.notify(JSON.stringify(result, null, 2), "info");
    },
  });
}
