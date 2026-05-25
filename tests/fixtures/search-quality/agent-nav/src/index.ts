import { createNavigationEngine } from "./navigation-engine";

export function mainImplementationEntrypoint() {
  return createNavigationEngine().answer("main implementation entrypoint");
}

export const appEntrypoint = mainImplementationEntrypoint;
