import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, type TestContext } from "node:test";

const storageHome = mkdtempSync(join(tmpdir(), "pi-codemap-home-"));
process.env.HOME = storageHome;
process.env.USERPROFILE = storageHome;
after(() => rmSync(storageHome, { recursive: true, force: true }));

const { indexRepo, status } = await import("../src/core/indexer.ts");
const { searchCodeMap, searchCodeMapWithDiagnostics } = await import("../src/core/search.ts");
const { codemapContext } = await import("../src/core/context.ts");
const { getRepoInfo } = await import("../src/core/repo.ts");
const { registerCodeMapTools } = await import("../src/pi-extension/tools.ts");
const { registerCodeMapCommands } = await import("../src/pi-extension/commands.ts");
const { default: codeMapExtension } = await import("../src/pi-extension/index.ts");

function fixtureRepo(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "core"), { recursive: true });
  mkdirSync(join(root, "src", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, "src", "core", "user-service.ts"), `
export function approveUser(id: string) {
  return { id, status: "approved" };
}

export function archiveUser(id: string) {
  return { id, status: "archived" };
}
`);
  writeFileSync(join(root, "src", "core", "numeric.ts"), `
export const NOT_FOUND_STATUS = 404;
export const LOCAL_PORT = 3000;
`);
  writeFileSync(join(root, "src", "pi-extension", "tools.ts"), `
export function registerTool(name: string) {
  return name;
}
`);
  writeFileSync(join(root, "src", "core", "delivery.py"), `
class DeliveryClient:
    def send_telegram(self, text: str) -> None:
        return None
`);
  writeFileSync(join(root, "train.py"), `
def run_experiment():
    return "ok"
`);
  writeFileSync(join(root, "docs", "ops.md"), `
# Operations

The scanner reports an ignored directory when dependency folders are skipped.
`);
  writeFileSync(join(root, "docs", "alpha-beta.md"), `
# Alpha Beta

The alpha beta workflow covers complete matches.
`);
  writeFileSync(join(root, "docs", "alpha-spam.md"), `
# Alpha

alpha alpha alpha alpha alpha alpha alpha alpha
`);
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "ignored directory approveUser left-pad" }, null, 2));

  indexRepo({ cwd: root, approve: true });
  return root;
}

test("exact symbol matches rank above chunk matches", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "approveUser", limit: 5 });
  assert.equal(results[0]?.path, "src/core/user-service.ts");
  assert.equal(results[0]?.kind, "function");
  assert.match(results[0]?.snippet ?? "", /approveUser/);
});

test("prefix symbol queries prefer matching symbols", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "approve", limit: 5 });
  assert.equal(results[0]?.path, "src/core/user-service.ts");
  assert.equal(results[0]?.kind, "function");
});

test("python class and function symbols are searchable", (t) => {
  const root = fixtureRepo(t);
  assert.ok(searchCodeMap({ cwd: root, query: "DeliveryClient", limit: 5 }).some((result) => result.kind === "class"));
  assert.ok(searchCodeMap({ cwd: root, query: "send_telegram", limit: 5 }).some((result) => result.kind === "function"));
});

test("path-like queries return file matches first", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "tools.ts", limit: 5 });
  assert.equal(results[0]?.path, "src/pi-extension/tools.ts");
  assert.equal(results[0]?.kind, "file");
});

test("role-intent queries can surface main implementation files without lexical hits", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "where is the main implementation?", limit: 5 });
  assert.equal(results[0]?.path, "train.py");
  assert.equal(results[0]?.kind, "file");
});

test("phrase queries find phrase-bearing docs without lockfile noise", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "\"ignored directory\"", limit: 5 });
  assert.equal(results[0]?.path, "docs/ops.md");
  assert.ok(results.every((result) => result.path !== "package-lock.json"));
});

test("multi-term queries prefer all-term matches over OR fallback", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "alpha beta", limit: 5 });
  assert.equal(results[0]?.path, "docs/alpha-beta.md");
  assert.match(results[0]?.snippet ?? "", /alpha beta/i);
});

test("numeric queries remain searchable", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "404", limit: 5 });
  assert.equal(results[0]?.path, "src/core/numeric.ts");
  assert.match(results[0]?.snippet ?? "", /404/);
});

test("search diagnostics warn without auto-refreshing stale indexes", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "new-feature.ts"), `
export function newFeatureFlag() {
  return true;
}
`);

  const result = searchCodeMapWithDiagnostics({ cwd: root, query: "newFeatureFlag", limit: 5 });
  assert.equal(result.stale, true);
  assert.equal(result.missing, 1);
  assert.match(result.warnings.join("\n"), /Index stale/);
  assert.equal(result.results.length, 0);

  indexRepo({ cwd: root });
  const refreshed = searchCodeMapWithDiagnostics({ cwd: root, query: "newFeatureFlag", limit: 5 });
  assert.equal(refreshed.stale, false);
  assert.equal(refreshed.results[0]?.path, "src/core/new-feature.ts");
});

test("context diagnostics warn without auto-refreshing stale indexes", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "context-added.ts"), `
export function contextAdded() {
  return true;
}
`);

  const result = codemapContext({ cwd: root, target: "contextAdded", limit: 5 });
  assert.equal(result.stale, true);
  assert.equal(result.missing, 1);
  assert.match(result.warnings.join("\n"), /Index stale/);
  assert.deepEqual(result.readFirst, []);
});

test("context path matching treats LIKE wildcards literally", (t) => {
  const root = fixtureRepo(t);
  const result = codemapContext({ cwd: root, target: "user_service.ts", limit: 5 });
  assert.ok(result.warnings.includes("Target was not an indexed file path; falling back to search results."));
});

test("status pathPrefix treats LIKE wildcards literally", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-status-prefix-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "services", "api_v1"), { recursive: true });
  mkdirSync(join(root, "services", "apiXv1"), { recursive: true });
  mkdirSync(join(root, "services", "api%v1"), { recursive: true });
  mkdirSync(join(root, "services", "apiYv1"), { recursive: true });

  writeFileSync(join(root, "services", "api_v1", "handler.ts"), "export function exactUnderscoreApiNeedle() { return true; }\n");
  writeFileSync(join(root, "services", "apiXv1", "handler.ts"), "export function wildcardUnderscoreApiNeedle() { return true; }\n");
  writeFileSync(join(root, "services", "api%v1", "handler.ts"), "export function exactPercentApiNeedle() { return true; }\n");
  writeFileSync(join(root, "services", "apiYv1", "handler.ts"), "export function wildcardPercentApiNeedle() { return true; }\n");

  indexRepo({ cwd: root, approve: true });

  const underscoreScoped = status(root, { health: "full", pathPrefix: "services/api_v1" });
  assert.equal(underscoreScoped.files, 1);
  assert.equal(underscoreScoped.deleted, 0);

  const percentScoped = status(root, { health: "full", pathPrefix: "services/api%v1" });
  assert.equal(percentScoped.files, 1);
  assert.equal(percentScoped.deleted, 0);
});

test("context packages direct files with related tests and docs", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "test", "user-service.test.ts"), "import '../src/core/user-service';\n");
  writeFileSync(join(root, "docs", "user-service.md"), "# User service\n\napprove and archive users\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/user-service.ts", limit: 3 });
  assert.equal((result.readFirst[0] as { path: string }).path, "src/core/user-service.ts");
  assert.deepEqual(result.relatedTests, ["test/user-service.test.ts"]);
  assert.deepEqual(result.relatedDocs, ["docs/user-service.md"]);
  assert.deepEqual(result.warnings, []);
});

test("safety skips secrets, generated files, heavy directories, binary files, large files, and symlinks", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-safety-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(root, "src", "allowed.ts"), "export const allowedNeedle = true;\n");
  writeFileSync(join(root, ".env"), "SUPER_SKIPPED_NEEDLE=1\n");
  writeFileSync(join(root, "private-key.ts"), "export const superSkippedNeedle = true;\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ superSkippedNeedle: true }));
  writeFileSync(join(root, "binary.txt"), Buffer.from("superSkippedNeedle\0"));
  writeFileSync(join(root, "huge.txt"), `${"x".repeat(1_000_001)}superSkippedNeedle`);
  writeFileSync(join(root, "ignored.txt"), "superSkippedNeedle\n");
  writeFileSync(join(root, "node_modules", "dep", "index.ts"), "export const superSkippedNeedle = true;\n");
  writeFileSync(join(root, "dist", "bundle.ts"), "export const superSkippedNeedle = true;\n");
  try {
    symlinkSync(join(root, "src", "allowed.ts"), join(root, "linked.ts"));
  } catch {
    // Some platforms disallow symlink creation; the rest of the safety policy is still testable.
  }

  const result = indexRepo({ cwd: root, approve: true });
  assert.equal(searchCodeMap({ cwd: root, query: "allowedNeedle", limit: 5 })[0]?.path, "src/allowed.ts");
  assert.deepEqual(searchCodeMap({ cwd: root, query: "superSkippedNeedle", limit: 5 }), []);
  assert.ok((result.skippedReasons["secret-like file"] ?? 0) >= 2);
  assert.ok((result.skippedReasons["binary/generated extension"] ?? 0) >= 1);
  assert.ok((result.skippedReasons["ignored directory"] ?? 0) >= 2);
  assert.ok((result.skippedReasons[".gitignore"] ?? 0) >= 1);
  assert.ok((result.skippedReasons["binary content"] ?? 0) >= 1);
  assert.ok((result.skippedReasons["too large"] ?? 0) >= 1);
  if (existsSync(join(root, "linked.ts"))) assert.ok((result.skippedReasons.symlink ?? 0) >= 1);
});

test("codemapignore and expanded default ignores suppress dependency/cache noise", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-ignore-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, ".venv", "lib", "python3.14", "site-packages"), { recursive: true });
  mkdirSync(join(root, ".pytest_cache"), { recursive: true });
  mkdirSync(join(root, "generated"), { recursive: true });

  writeFileSync(join(root, ".codemapignore"), "generated/\n*.fixture.ts\n");
  writeFileSync(join(root, "src", "allowed.ts"), "export const durableSourceNeedle = true;\n");
  writeFileSync(join(root, ".venv", "lib", "python3.14", "site-packages", "dep.py"), "dependencyNoiseNeedle = True\n");
  writeFileSync(join(root, ".pytest_cache", "cache.txt"), "dependencyNoiseNeedle\n");
  writeFileSync(join(root, "generated", "out.ts"), "export const dependencyNoiseNeedle = true;\n");
  writeFileSync(join(root, "src", "ignored.fixture.ts"), "export const dependencyNoiseNeedle = true;\n");

  const result = indexRepo({ cwd: root, approve: true });
  assert.equal(searchCodeMap({ cwd: root, query: "durableSourceNeedle", limit: 5 })[0]?.path, "src/allowed.ts");
  assert.deepEqual(searchCodeMap({ cwd: root, query: "dependencyNoiseNeedle", limit: 5 }), []);
  assert.ok((result.skippedReasons["ignored directory"] ?? 0) >= 2);
  assert.ok((result.skippedReasons[".codemapignore"] ?? 0) >= 2);
});

test("pathPrefix scopes indexing, status, search, context, and deletions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "services", "api"), { recursive: true });
  mkdirSync(join(root, "services", "web"), { recursive: true });

  writeFileSync(join(root, "services", "api", "handler.ts"), "export function apiOnlyNeedle() { return true; }\n");
  writeFileSync(join(root, "services", "web", "handler.ts"), "export function webOnlyNeedle() { return true; }\n");

  const scoped = indexRepo({ cwd: root, approve: true, pathPrefix: "services/api" });
  assert.equal(scoped.pathPrefix, "services/api/");
  assert.equal(scoped.scanned, 1);
  assert.equal(searchCodeMap({ cwd: root, query: "apiOnlyNeedle", limit: 5 })[0]?.path, "services/api/handler.ts");
  assert.deepEqual(searchCodeMap({ cwd: root, query: "webOnlyNeedle", limit: 5 }), []);
  assert.deepEqual(searchCodeMap({ cwd: root, query: "apiOnlyNeedle", pathPrefix: "services/web", limit: 5 }), []);
  assert.equal(status(root, { health: "full", pathPrefix: "services/api" }).files, 1);
  assert.equal((codemapContext({ cwd: root, target: "handler.ts", pathPrefix: "services/api" }).readFirst[0] as { path: string }).path, "services/api/handler.ts");

  indexRepo({ cwd: root });
  assert.equal(searchCodeMap({ cwd: root, query: "webOnlyNeedle", limit: 5 })[0]?.path, "services/web/handler.ts");
  unlinkSync(join(root, "services", "api", "handler.ts"));
  const refreshed = indexRepo({ cwd: root, pathPrefix: "services/api" });
  assert.equal(refreshed.removed, 1);
  assert.equal(searchCodeMap({ cwd: root, query: "webOnlyNeedle", limit: 5 })[0]?.path, "services/web/handler.ts");
});

test("pathPrefix normalizes internal dot-dot segments consistently", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-dotdot-prefix-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, "src", "app.ts"), "export function srcNeedle() { return true; }\n");
  writeFileSync(join(root, "docs", "guide.md"), "# Guide\n\ncanonical docs needle\n");

  const scoped = indexRepo({ cwd: root, approve: true, pathPrefix: "src/../docs" });
  assert.equal(scoped.pathPrefix, "docs/");
  assert.equal(scoped.scanned, 1);
  assert.equal(status(root, { health: "full", pathPrefix: "src/../docs" }).files, 1);
  assert.equal(searchCodeMap({ cwd: root, query: "canonical docs needle", pathPrefix: "src/../docs", limit: 5 })[0]?.path, "docs/guide.md");
  assert.equal((codemapContext({ cwd: root, target: "guide.md", pathPrefix: "src/../docs" }).readFirst[0] as { path: string }).path, "docs/guide.md");

  indexRepo({ cwd: root });
  unlinkSync(join(root, "docs", "guide.md"));
  const refreshed = indexRepo({ cwd: root, pathPrefix: "src/../docs" });
  assert.equal(refreshed.pathPrefix, "docs/");
  assert.equal(refreshed.removed, 1);
  assert.equal(searchCodeMap({ cwd: root, query: "srcNeedle", limit: 5 })[0]?.path, "src/app.ts");
});

test("index refreshes only changed files and removes deleted files", (t) => {
  const root = fixtureRepo(t);
  assert.equal(indexRepo({ cwd: root }).indexed, 0);

  writeFileSync(join(root, "src", "core", "user-service.ts"), `
export function changedUserFlow(id: string) {
  return { id, status: "changed" };
}
`);
  const changed = indexRepo({ cwd: root });
  assert.equal(changed.indexed, 1);
  assert.equal(searchCodeMap({ cwd: root, query: "changedUserFlow", limit: 5 })[0]?.path, "src/core/user-service.ts");
  assert.deepEqual(searchCodeMap({ cwd: root, query: "approveUser", limit: 5 }), []);

  unlinkSync(join(root, "src", "core", "numeric.ts"));
  const removed = indexRepo({ cwd: root });
  assert.equal(removed.removed, 1);
  assert.deepEqual(searchCodeMap({ cwd: root, query: "404", limit: 5 }), []);
});

test("status reports unapproved repos as not ready", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-unapproved-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });

  const result = status(root, { health: "cheap" });

  assert.equal(result.approved, false);
  assert.equal(result.indexed, false);
  assert.equal(result.readiness, "not_approved");
});

test("cheap status avoids stale scan while full status reports drift", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "cheap-status-added.ts"), `
export function cheapStatusAdded() {
  return true;
}
`);

  const cheap = status(root, { health: "cheap" });
  assert.equal(cheap.health, "cheap");
  assert.equal(cheap.stale, false);
  assert.equal(cheap.missing, 0);
  assert.deepEqual(cheap.warnings, []);

  const full = status(root, { health: "full" });
  assert.equal(full.health, "full");
  assert.equal(full.stale, true);
  assert.equal(full.missing, 1);
  assert.match(full.warnings.join("\n"), /Index stale/);
});

test("CodeMap uses state storage and migrates legacy repo DBs", (t) => {
  const root = fixtureRepo(t);
  const info = getRepoInfo(root);
  assert.match(info.dbPath, /\.pi\/agent\/state\/codemap\/repos\//);
  assert.ok(existsSync(info.dbPath));

  const legacyHome = mkdtempSync(join(tmpdir(), "pi-codemap-legacy-home-"));
  t.after(() => rmSync(legacyHome, { recursive: true, force: true }));
  const legacyRegistry = join(legacyHome, ".pi", "agent", "codemap", "registry.sqlite");
  const legacyDb = join(legacyHome, ".pi", "agent", "codemap", "repos", `${info.key}.sqlite`);
  mkdirSync(join(legacyHome, ".pi", "agent", "codemap", "repos"), { recursive: true });
  copyFileSync(join(storageHome, ".pi", "agent", "state", "codemap", "registry.sqlite"), legacyRegistry);
  copyFileSync(info.dbPath, legacyDb);

  const repoModuleUrl = pathToFileURL(join(process.cwd(), "src", "core", "repo.ts")).href;
  const script = `const { getRepoInfo } = await import(${JSON.stringify(repoModuleUrl)}); console.log(JSON.stringify(getRepoInfo(${JSON.stringify(root)})));`;
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, HOME: legacyHome, USERPROFILE: legacyHome },
  });
  const migrated = JSON.parse(output) as { dbPath: string };
  assert.match(migrated.dbPath, /\.pi\/agent\/state\/codemap\/repos\//);
  assert.ok(existsSync(join(legacyHome, ".pi", "agent", "state", "codemap", "registry.sqlite")));
  assert.ok(existsSync(migrated.dbPath));
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

  assert.deepEqual(statuses, [{ key: "codemap", text: "CodeMap ○ not indexed" }]);
});

test("registers only codemap tools", () => {
  const tools: Array<{ name: string; label?: string; description?: string; promptSnippet?: string; promptGuidelines?: string[] }> = [];
  registerCodeMapTools({ registerTool: (tool: { name: string; label?: string; description?: string; promptSnippet?: string; promptGuidelines?: string[] }) => tools.push(tool) } as never);

  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "codemap_context",
    "codemap_index",
    "codemap_search",
    "codemap_status",
  ]);
  for (const name of ["codemap_status", "codemap_index", "codemap_search", "codemap_context"]) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool?.promptSnippet, `${name} should provide promptSnippet`);
    assert.ok(tool?.promptGuidelines?.every((guideline) => guideline.includes(name)), `${name} guidelines should name the tool`);
  }
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
