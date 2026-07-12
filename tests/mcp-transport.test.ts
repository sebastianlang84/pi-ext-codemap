import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Exercises the real stdio bin end to end (framing + stdout purity), which the pure dispatch() tests
// cannot cover. Runs the process in a throwaway HOME/cwd so it never touches real CodeMap state.
const binPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "mcp", "bin.ts");

function runTransport(lines: string[], cwd?: string): { stdout: string; parsed: any[] } {
  const home = mkdtempSync(join(tmpdir(), "pi-codemap-mcp-home-"));
  try {
    // CODEMAP_HOME / XDG_DATA_HOME take precedence over HOME in state resolution, so the child would
    // touch real CodeMap state if they leaked through from the parent env; strip them to stay isolated.
    const { CODEMAP_HOME, XDG_DATA_HOME, ...parentEnv } = process.env;
    const res = spawnSync(process.execPath, [binPath], {
      input: lines.map((line) => `${line}\n`).join(""),
      encoding: "utf8",
      cwd: cwd ?? home,
      env: { ...parentEnv, HOME: home, USERPROFILE: home },
    });
    const stdout = res.stdout ?? "";
    const parsed = stdout.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
    return { stdout, parsed };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("stdio transport frames responses, skips blank lines, and stays JSON-pure", () => {
  const { parsed } = runTransport([
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
    "",
    "not valid json",
    '[{"jsonrpc":"2.0","id":9,"method":"ping"}]',
    '{"jsonrpc":"2.0","id":3,"method":"tools/list"}',
  ]);

  // Every stdout line is a well-formed JSON-RPC 2.0 message (nothing else leaked to stdout).
  for (const message of parsed) assert.equal(message.jsonrpc, "2.0");

  const initialize = parsed.find((m) => m.id === 1);
  assert.equal(initialize.result.protocolVersion, "2025-11-25");
  const toolsList = parsed.find((m) => m.id === 3);
  assert.equal(toolsList.result.tools.length, 4);

  const errors = parsed.filter((m) => m.id === null);
  assert.ok(errors.some((m) => m.error.code === -32700), "invalid JSON -> parse error");
  assert.ok(errors.some((m) => m.error.code === -32600), "batch array -> invalid request");
});

test("stdout stays JSON-pure even when a tool call loads the SQLite core", () => {
  // codemap_status loads node:sqlite, which emits an ExperimentalWarning; it must go to stderr and
  // never corrupt the stdout protocol stream.
  const { parsed } = runTransport(['{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"codemap_status","arguments":{}}}']);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 1);
  assert.equal(parsed[0].jsonrpc, "2.0");
  assert.ok(Array.isArray(parsed[0].result.content), "returns a tool result");
});
