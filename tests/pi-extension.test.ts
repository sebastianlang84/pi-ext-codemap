import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { indexRepo } = await import("../src/core/indexer.ts");
const { registerCodeMapTools } = await import("../src/pi-extension/tools.ts");
const { registerCodeMapCommands } = await import("../src/pi-extension/commands.ts");
const { codeMapContext, codeMapIndex, codeMapSearch, codeMapStatus, parsePathPrefix } = await import("../src/pi-extension/operations.ts");
const { default: codeMapExtension } = await import("../src/pi-extension/index.ts");

test("agentic E2E smoke test navigates from search to read-first context", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-agentic-e2e-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "core"), { recursive: true });
  mkdirSync(join(root, "src", "__generated__"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, "src", "index.ts"), `
import { createNavigationEngine } from "./core/navigation-engine";

export function mainImplementationEntrypoint() {
  return createNavigationEngine().answer("where is the main implementation?");
}
`);
  writeFileSync(join(root, "src", "core", "navigation-engine.ts"), `
export function createNavigationEngine() {
  return { answer: (question: string) => question + " -> src/index.ts" };
}
`);
  writeFileSync(join(root, "test", "index.test.ts"), `
import { mainImplementationEntrypoint } from "../src/index";

test("main implementation entrypoint", () => mainImplementationEntrypoint());
`);
  writeFileSync(join(root, "docs", "index.md"), "# Main implementation\n\nStart with src/index.ts, then read the navigation engine.\n");
  writeFileSync(join(root, "src", "__generated__", "client.ts"), "export const generatedClient = 'where is the main implementation noise';\n");
  writeFileSync(join(root, "dist", "index.js"), "function mainImplementationEntrypoint(){return 'build output noise'}\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "where is the main implementation" }, null, 2));

  const indexResult = codeMapIndex(root, { approveRepo: true });
  assert.ok(indexResult.scanned >= 6, JSON.stringify(indexResult));
  assert.ok(indexResult.indexed >= 6, JSON.stringify(indexResult));

  const symbolSearchResult = codeMapSearch(root, { query: "mainImplementationEntrypoint", limit: 5 });
  assert.equal(symbolSearchResult.stale, false);
  assert.deepEqual(symbolSearchResult.warnings, []);
  assert.equal(symbolSearchResult.results[0]?.path, "src/index.ts");
  assert.equal(symbolSearchResult.results[0]?.kind, "function");
  assert.ok(symbolSearchResult.results.every((result) => result.path !== "dist/index.js"), JSON.stringify(symbolSearchResult.results.map((result) => result.path)));

  const searchResult = codeMapSearch(root, { query: "where is the main implementation?", limit: 5 });
  assert.equal(searchResult.stale, false);
  assert.deepEqual(searchResult.warnings, []);
  assert.equal(searchResult.results[0]?.path, "src/index.ts");

  const contextResult = codeMapContext(root, { target: symbolSearchResult.results[0]?.path ?? "", limit: 6 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.equal(readFirstPaths[0], "src/index.ts");
  assert.ok(readFirstPaths.includes("src/core/navigation-engine.ts"), JSON.stringify(readFirstPaths));
  assert.ok(readFirstPaths.includes("test/index.test.ts"), JSON.stringify(readFirstPaths));
  assert.ok(readFirstPaths.includes("docs/index.md"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("src/__generated__/client.ts"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("dist/index.js"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("package-lock.json"), JSON.stringify(readFirstPaths));
  assert.deepEqual(contextResult.relatedTests, ["test/index.test.ts"]);
  assert.deepEqual(contextResult.relatedDocs, ["docs/index.md"]);
  assert.deepEqual(contextResult.warnings, []);
});

test("CodeMap operations can target another repo with repoPath", (t) => {
  const currentRoot = mkdtempSync(join(tmpdir(), "pi-codemap-current-repopath-"));
  const targetRoot = mkdtempSync(join(tmpdir(), "pi-codemap-target-repopath-"));
  t.after(() => rmSync(currentRoot, { recursive: true, force: true }));
  t.after(() => rmSync(targetRoot, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: currentRoot, stdio: "ignore" });
  execFileSync("git", ["init"], { cwd: targetRoot, stdio: "ignore" });
  mkdirSync(join(currentRoot, "src"), { recursive: true });
  mkdirSync(join(targetRoot, "src"), { recursive: true });
  writeFileSync(join(currentRoot, "src", "current.ts"), "export const currentRepoOnly = true;\n");
  writeFileSync(join(targetRoot, "src", "target.ts"), `
export function repoPathNeedle() {
  return "target repo only";
}
`);

  assert.throws(() => codeMapIndex(currentRoot, { repoPath: targetRoot }), /Repository is not approved/);
  codeMapIndex(currentRoot, { approveRepo: true });
  codeMapIndex(currentRoot, { repoPath: targetRoot, approveRepo: true });
  const cwdStatus = codeMapStatus(currentRoot, {});
  const statusResult = codeMapStatus(currentRoot, { repoPath: targetRoot });
  const nestedStatus = codeMapStatus(currentRoot, { repoPath: join(targetRoot, "src") });
  const searchResult = codeMapSearch(currentRoot, { repoPath: targetRoot, query: "repoPathNeedle", limit: 5 });
  const contextResult = codeMapContext(currentRoot, { repoPath: join(targetRoot, "src", "target.ts"), target: "src/target.ts", limit: 3 });

  assert.equal(cwdStatus.root, currentRoot);
  assert.equal(statusResult.root, targetRoot);
  assert.equal(statusResult.readiness, "ready");
  assert.equal(nestedStatus.root, targetRoot);
  assert.equal(searchResult.root, targetRoot);
  assert.equal(searchResult.results[0]?.path, "src/target.ts");
  assert.equal(contextResult.root, targetRoot);
  assert.equal(contextResult.readFirst[0]?.path, "src/target.ts");
});

test("session start shows neutral status for an unapproved repo", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-unapproved-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });

  let sessionStart: ((event: unknown, ctx: { hasUI: boolean; ui: { setStatus: (key: string, text: string) => void } }) => Promise<void>) | undefined;
  const statuses: Array<{ key: string; text: string }> = [];
  codeMapExtension({
    on(name: string, handler: typeof sessionStart) {
      if (name === "session_start") sessionStart = handler;
    },
    registerTool() {},
    registerCommand() {},
  } as never);

  const cwd = process.cwd();
  try {
    process.chdir(root);
    await sessionStart?.({}, { hasUI: true, ui: { setStatus: (key, text) => statuses.push({ key, text }) } });
  } finally {
    process.chdir(cwd);
  }

  assert.deepEqual(statuses, [{ key: "codemap", text: "CodeMap ✗" }]);
});

test("registers only codemap tools with compact complete prompt guidance", () => {
  const tools: Array<{ name: string; label?: string; description?: string; promptSnippet?: string; promptGuidelines?: string[] }> = [];
  registerCodeMapTools({ registerTool: (tool: { name: string; label?: string; description?: string; promptSnippet?: string; promptGuidelines?: string[] }) => tools.push(tool) } as never);

  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "codemap_context",
    "codemap_index",
    "codemap_search",
    "codemap_status",
  ]);
  const requiredTerms: Record<string, string[]> = {
    codemap_status: ["approval", "stale", "full=true", "pathPrefix"],
    codemap_index: ["approveRepo", "stale", "pathPrefix"],
    codemap_search: ["indexed", "query", "stale", "pathPrefix"],
    codemap_context: ["read-first", "indexed", "read substitute", "pathPrefix"],
  };
  const promptSurface = tools.map((tool) => [tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join("\n")).join("\n");
  assert.ok(promptSurface.length <= 1_000, `CodeMap prompt surface should stay compact, got ${promptSurface.length} chars`);
  for (const name of Object.keys(requiredTerms)) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool?.promptSnippet, `${name} should provide promptSnippet`);
    assert.ok(tool?.promptGuidelines?.length, `${name} should provide promptGuidelines`);
    const prompt = [tool?.promptSnippet, ...(tool?.promptGuidelines ?? [])].join("\n");
    assert.ok(prompt.length <= 260, `${name} prompt guidance should stay compact, got ${prompt.length} chars`);
    assert.ok(tool?.promptGuidelines?.every((guideline) => guideline.includes(name)), `${name} guidelines should name the tool`);
    for (const term of requiredTerms[name]) assert.ok(prompt.includes(term), `${name} prompt guidance should mention ${term}`);
  }
});

test("codemap tool renderer shows indexed false as not indexed", () => {
  const tools: Array<{ name: string; renderResult?: (result: unknown, options: { expanded: boolean }, theme: { fg: (_name: string, text: string) => string; bold: (text: string) => string }) => { render: (width: number) => string[] } }> = [];
  registerCodeMapTools({ registerTool: (tool: { name: string; renderResult?: (result: unknown, options: { expanded: boolean }, theme: { fg: (_name: string, text: string) => string; bold: (text: string) => string }) => { render: (width: number) => string[] } }) => tools.push(tool) } as never);

  const rendered = tools.find((tool) => tool.name === "codemap_status")?.renderResult?.(
    { content: [{ type: "text", text: JSON.stringify({ indexed: false }) }], details: { indexed: false } },
    { expanded: true },
    { fg: (_name, text) => text, bold: (text) => text },
  ).render(120).join("\n") ?? "";

  assert.match(rendered, /not indexed/);
  assert.doesNotMatch(rendered, /index ready/);
});

test("codemap command args parse repoPath and pathPrefix", () => {
  assert.deepEqual(parsePathPrefix("--repo-path /tmp/repo --path-prefix services/api needle"), {
    repoPath: "/tmp/repo",
    pathPrefix: "services/api",
    query: "needle",
  });
  assert.deepEqual(parsePathPrefix('--repo-path "/tmp/repo with spaces" needle'), {
    repoPath: "/tmp/repo with spaces",
    pathPrefix: undefined,
    query: "needle",
  });
});

test("codemap index command requires explicit approve flag token", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-command-noapprove--approve-repo-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  writeFileSync(join(root, "target.ts"), "export const commandApprovalNeedle = true;\n");

  const commands: Array<{ name: string; handler: (args: string, ctx: { ui: { notify: (message: string, level: string) => void } }) => Promise<void> }> = [];
  registerCodeMapCommands({ registerCommand: (name: string, command: { handler: (args: string, ctx: { ui: { notify: (message: string, level: string) => void } }) => Promise<void> }) => commands.push({ name, handler: command.handler }) } as never);

  await assert.rejects(
    () => commands.find((command) => command.name === "codemap-index")!.handler(`--repo-path ${root}`, { ui: { notify() {} } }),
    /Repository is not approved/,
  );
});

test("registers only codemap commands", () => {
  const commands: Array<{ name: string; description?: string }> = [];
  registerCodeMapCommands({ registerCommand: (name: string, command: { description?: string }) => commands.push({ name, description: command.description }) } as never);

  const names = commands.map((command) => command.name).sort();
  assert.deepEqual(names, [
    "codemap-context",
    "codemap-index",
    "codemap-search",
    "codemap-status",
  ]);
});

test("codemap search command uses shared pathPrefix behavior", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-command-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "services", "api"), { recursive: true });
  mkdirSync(join(root, "services", "web"), { recursive: true });
  writeFileSync(join(root, "services", "api", "handler.ts"), "export function commandNeedle() { return 'api'; }\n");
  writeFileSync(join(root, "services", "web", "handler.ts"), "export function commandNeedle() { return 'web'; }\n");
  indexRepo({ cwd: root, approve: true });

  const commands: Array<{ name: string; handler: (args: string, ctx: { ui: { notify: (message: string, level: string) => void } }) => Promise<void> }> = [];
  registerCodeMapCommands({ registerCommand: (name: string, command: { handler: (args: string, ctx: { ui: { notify: (message: string, level: string) => void } }) => Promise<void> }) => commands.push({ name, handler: command.handler }) } as never);
  const cwd = process.cwd();
  const notifications: Array<{ message: string; level: string }> = [];
  try {
    process.chdir(root);
    await commands.find((command) => command.name === "codemap-search")?.handler("--path-prefix services/api commandNeedle", { ui: { notify: (message, level) => notifications.push({ message, level }) } });
  } finally {
    process.chdir(cwd);
  }

  assert.equal(notifications[0]?.level, "info");
  assert.match(notifications[0]?.message ?? "", /services\/api\/handler\.ts/);
  assert.doesNotMatch(notifications[0]?.message ?? "", /services\/web\/handler\.ts/);
});
