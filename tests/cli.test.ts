import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { runCli } = await import("../src/cli/main.ts");

function cliRepo(t: { after(fn: () => void): void }): { root: string; stateDir: string } {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-cli-repo-"));
  const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-cli-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "widget.ts"), "export function renderWidget() {\n  return \"ok\";\n}\n");
  return { root, stateDir };
}

test("cli help and version do not touch the repo", () => {
  assert.match(runCli(["--help"]).out, /Usage:/);
  assert.match(runCli([]).out, /Usage:/);
  assert.match(runCli(["--version"]).out, /^\d+\.\d+\.\d+/);
});

test("cli index/search/context/status round-trip on an isolated state dir", (t) => {
  const { root, stateDir } = cliRepo(t);
  const io = { cwd: root };

  const indexed = runCli(["index", "--approve", "--state-dir", stateDir], io);
  assert.equal(indexed.code, 0);
  assert.match(indexed.out, /Indexed \d+\/\d+ files/);

  const search = runCli(["search", "renderWidget", "--state-dir", stateDir], io);
  assert.equal(search.code, 0);
  assert.match(search.out, /src\/widget\.ts:\d+(-\d+)? \[function\] .+ — [\d.]+/);

  const context = runCli(["context", "src/widget.ts", "--state-dir", stateDir], io);
  assert.equal(context.code, 0);
  assert.match(context.out, /src\/widget\.ts:\d+-\d+ \[[a-z]+\] \(target\)/);

  const status = runCli(["status", "--state-dir", stateDir], io);
  assert.equal(status.code, 0);
  assert.match(status.out, /readiness: ready/);
});

test("cli --json emits a parseable search package", (t) => {
  const { root, stateDir } = cliRepo(t);
  const io = { cwd: root };
  runCli(["index", "--approve", "--state-dir", stateDir], io);

  const result = runCli(["search", "renderWidget", "--json", "--state-dir", stateDir], io);
  assert.equal(result.code, 0);
  const pkg = JSON.parse(result.out) as { query: string; results: Array<{ path: string }> };
  assert.equal(pkg.query, "renderWidget");
  assert.equal(pkg.results[0]?.path, "src/widget.ts");
});

test("cli reports usage errors on stderr with a non-zero code", () => {
  const missingQuery = runCli(["search"]);
  assert.equal(missingQuery.code, 2);
  assert.match(missingQuery.err, /needs a query/);

  const unknownCommand = runCli(["frobnicate"]);
  assert.equal(unknownCommand.code, 2);
  assert.match(unknownCommand.err, /Unknown command/);

  const unknownOption = runCli(["search", "x", "--nope"]);
  assert.equal(unknownOption.code, 2);
  assert.match(unknownOption.err, /Unknown option/);
});
