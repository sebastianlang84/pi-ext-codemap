import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { isBashToolResult } from "@earendil-works/pi-coding-agent";
import { codeMapStatus } from "../application/operations.ts";
import { CODEMAP_BASH_NUDGE_TEXT, shouldNudgeForCodeMapNavigationCommand } from "./bash-nudge.ts";
import { registerCodeMapTools } from "./tools.ts";
import { registerCodeMapCommands } from "./commands.ts";
import { computeStatusText, STATUS_KEY } from "./status-bar.ts";

export default function codeMapExtension(pi: ExtensionAPI): void {
  const nudgedRepoRoots = new Set<string>();
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, computeStatusText(ctx.cwd));
  });

  registerCodeMapTools(pi);
  registerCodeMapCommands(pi);

  pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
    if (!isBashToolResult(event)) return;
    const command = typeof event.input.command === "string" ? event.input.command : "";
    if (!shouldNudgeForCodeMapNavigationCommand(command, { cwd: ctx.cwd })) return;

    let repoStatus: ReturnType<typeof codeMapStatus>;
    try {
      repoStatus = codeMapStatus(ctx.cwd, {}, "pi");
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
