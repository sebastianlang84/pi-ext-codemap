import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodeSearchTools } from "./tools.ts";
import { registerCodeSearchCommands } from "./commands.ts";

export default function codeSearchExtension(pi: ExtensionAPI): void {
  registerCodeSearchTools(pi);
  registerCodeSearchCommands(pi);
}
