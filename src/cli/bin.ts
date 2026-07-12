#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// node:sqlite emits a one-line ExperimentalWarning at load; it fires natively before user JS runs, so
// it can only be silenced with a startup flag, not a process.emitWarning override. Keep the shipped
// CLI's stderr clean for shell/agent callers. The MCP bin keeps the default shebang (its warning goes
// to server stderr, never into the JSON-RPC stdout stream).
import { runCli } from "./main.ts";

const result = runCli(process.argv.slice(2));
if (result.out) process.stdout.write(result.out.endsWith("\n") ? result.out : `${result.out}\n`);
if (result.err) process.stderr.write(result.err.endsWith("\n") ? result.err : `${result.err}\n`);
process.exit(result.code);
