import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodeSearchTools } from "./tools.ts";
import { registerCodeSearchCommands } from "./commands.ts";

const STATUS_KEY = "code-search";
const STATUS_OK_TEXT = "code-search ok";
const STATUS_ERROR_TEXT = "code-search fehler";

export default function codeSearchExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    try {
      ctx.ui.setStatus(STATUS_KEY, STATUS_OK_TEXT);
    } catch {
      ctx.ui.setStatus(STATUS_KEY, STATUS_ERROR_TEXT);
    }
  });

  registerCodeSearchTools(pi);
  registerCodeSearchCommands(pi);
}
