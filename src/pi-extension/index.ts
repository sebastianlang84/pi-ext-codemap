import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { isBashToolResult } from "@earendil-works/pi-coding-agent";
import { status } from "../core/indexer.ts";
import { CODEMAP_BASH_NUDGE_TEXT, shouldNudgeForCodeMapNavigationCommand } from "./bash-nudge.ts";
import { registerCodeMapTools } from "./tools.ts";
import { registerCodeMapCommands } from "./commands.ts";

const STATUS_KEY = "codemap";
const STATUS_OK_TEXT = "[CodeMap ✓]";
const STATUS_NOT_INDEXED_TEXT = "[CodeMap ✗]";
const STATUS_ERROR_TEXT = "[CodeMap ✗]";

export default function codeMapExtension(pi: ExtensionAPI): void {
  const nudgedRepoRoots = new Set<string>();
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

  pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
    if (!isBashToolResult(event)) return;
    const command = typeof event.input.command === "string" ? event.input.command : "";
    if (!shouldNudgeForCodeMapNavigationCommand(command, { cwd: ctx.cwd })) return;

    let repoStatus: ReturnType<typeof status>;
    try {
      repoStatus = status(ctx.cwd, { health: "cheap" });
    } catch {
      return;
    }
    if (repoStatus.readiness !== "ready" || repoStatus.stale) return;
    if (nudgedRepoRoots.has(repoStatus.root)) return;
    nudgedRepoRoots.add(repoStatus.root);

    return {
      content: [...event.content, { type: "text" as const, text: CODEMAP_BASH_NUDGE_TEXT }],
    };
  });

  pi.on("session_shutdown", () => {
    nudgedRepoRoots.clear();
  });
}
