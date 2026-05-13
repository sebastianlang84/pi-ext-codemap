import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { codeMapOperations, deprecatedCommandDescription, type CodeMapOperation } from "./operations.ts";

function registerCommandAdapter(pi: ExtensionAPI, operation: CodeMapOperation, deprecated = false): void {
  pi.registerCommand(deprecated ? operation.deprecatedCommandName : operation.commandName, {
    description: deprecated ? deprecatedCommandDescription(operation) : operation.commandDescription,
    handler: async (args, ctx) => {
      const params = operation.parseCommandArgs(args);
      const result = operation.execute(process.cwd(), params);
      const notification = operation.formatCommandResult(result);
      ctx.ui.notify(notification.message, notification.level);
    },
  });
}

export function registerCodeMapCommands(pi: ExtensionAPI): void {
  for (const operation of codeMapOperations) registerCommandAdapter(pi, operation);
  for (const operation of codeMapOperations) registerCommandAdapter(pi, operation, true);
}
