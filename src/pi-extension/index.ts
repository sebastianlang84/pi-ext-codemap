import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { status } from "../core/indexer.ts";
import { registerCodeMapTools } from "./tools.ts";
import { registerCodeMapCommands } from "./commands.ts";

const STATUS_KEY = "codemap";
const STATUS_OK_TEXT = "CodeMap ✓";
const STATUS_NOT_INDEXED_TEXT = "CodeMap ○ not indexed";
const STATUS_ERROR_TEXT = "CodeMap ✗";

export default function codeMapExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    try {
      const currentStatus = status(process.cwd(), { health: "cheap" });
      ctx.ui.setStatus(STATUS_KEY, currentStatus.readiness === "ready" ? STATUS_OK_TEXT : STATUS_NOT_INDEXED_TEXT);
    } catch {
      ctx.ui.setStatus(STATUS_KEY, STATUS_ERROR_TEXT);
    }
  });

  registerCodeMapTools(pi);
  registerCodeMapCommands(pi);
}
