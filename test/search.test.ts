import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, type TestContext } from "node:test";

const storageHome = mkdtempSync(join(tmpdir(), "pi-codemap-home-"));
process.env.HOME = storageHome;
process.env.USERPROFILE = storageHome;
after(() => rmSync(storageHome, { recursive: true, force: true }));

const { indexRepo, status } = await import("../src/core/indexer.ts");
const { planQuery } = await import("../src/core/query-plan.ts");
const { scoreSearchRow } = await import("../src/core/ranking.ts");
const { searchCodeMap, searchCodeMapWithDiagnostics } = await import("../src/core/search.ts");
const { codemapContext } = await import("../src/core/context.ts");
const { getRepoInfo, repoKey } = await import("../src/core/repo.ts");
const { registerCodeMapTools } = await import("../src/pi-extension/tools.ts");
const { registerCodeMapCommands } = await import("../src/pi-extension/commands.ts");
const { codeMapContext, codeMapIndex, codeMapSearch } = await import("../src/pi-extension/operations.ts");
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
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", dependencies: { leftpad: "1.0.0" } }, null, 2));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "ignored directory approveUser left-pad" }, null, 2));

  indexRepo({ cwd: root, approve: true });
  return root;
}

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

  const searchResult = codeMapSearch(root, { query: "where is the main implementation?", limit: 5 });
  assert.equal(searchResult.stale, false);
  assert.deepEqual(searchResult.warnings, []);
  assert.equal(searchResult.results[0]?.path, "src/index.ts");

  const contextResult = codeMapContext(root, { target: searchResult.results[0]?.path ?? "", limit: 6 });
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

test("endpoint route queries find route handlers before docs and generated noise", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-route-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro", "route.ts"), `
export async function GET() {
  const macroSnapshot = await loadMacroSnapshot();
  return Response.json({ macroSnapshot, channel: "newsletter" });
}

async function loadMacroSnapshot() {
  return { risk: "steady" };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro", "route.test.ts"), `
import { GET } from "./route";

export const routeSmoke = GET;
`);
  writeFileSync(join(root, "docs", "newsletter-macro-api.md"), "# Newsletter macro API\n\nThe GET api newsletter macro snapshot endpoint is documented here.\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "GET api newsletter macro snapshot endpoint" }, null, 2));
  writeFileSync(join(root, "dist", "route.js"), "export const generated = 'GET api newsletter macro snapshot endpoint';\n");

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "GET api newsletter macro snapshot endpoint", limit: 5 });
  assert.equal(results[0]?.path, "apps/web/src/app/api/newsletter/macro/route.ts");
  assert.ok(results.every((result) => result.path !== "package-lock.json"), JSON.stringify(results.map((result) => result.path)));

  const contextResult = codemapContext({ cwd: root, target: results[0]?.path ?? "", limit: 5 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.equal(readFirstPaths[0], "apps/web/src/app/api/newsletter/macro/route.ts");
  assert.ok(readFirstPaths.includes("apps/web/src/app/api/newsletter/macro/route.test.ts"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("dist/route.js"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("package-lock.json"), JSON.stringify(readFirstPaths));
});

test("config-key queries find source config before docs and lockfile noise", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-config-key-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "src", "newsletter"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, "config", "newsletter-macro.json"), JSON.stringify({ newsletterMacroSnapshotTtlMs: 900000, channel: "macro" }, null, 2));
  writeFileSync(join(root, "src", "newsletter", "macro-service.ts"), "export const macroSnapshotTtl = 900000;\n");
  writeFileSync(join(root, "docs", "newsletter-macro.md"), "# Newsletter macro\n\nOperators tune newsletterMacroSnapshotTtlMs in config.\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "newsletterMacroSnapshotTtlMs config key" }, null, 2));

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "newsletterMacroSnapshotTtlMs config key", limit: 5 });
  assert.equal(results[0]?.path, "config/newsletter-macro.json");
  assert.ok(results.every((result) => result.path !== "package-lock.json"), JSON.stringify(results.map((result) => result.path)));

  const contextResult = codemapContext({ cwd: root, target: results[0]?.path ?? "", limit: 4 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.equal(readFirstPaths[0], "config/newsletter-macro.json");
  assert.ok(!readFirstPaths.includes("package-lock.json"), JSON.stringify(readFirstPaths));
});

test("error-message queries find throwing source before docs and generated noise", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-error-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "newsletter"), { recursive: true });
  mkdirSync(join(root, "tests", "newsletter"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, "src", "newsletter", "snapshot-service.ts"), `
export function requireFreshSnapshot(snapshotAgeMs: number) {
  if (snapshotAgeMs > 900000) {
    throw new Error("ERR_NEWSLETTER_SNAPSHOT_STALE: macro snapshot is too old");
  }
  return true;
}
`);
  writeFileSync(join(root, "tests", "newsletter", "snapshot-service.test.ts"), `
import { requireFreshSnapshot } from "../../src/newsletter/snapshot-service";

export const staleSnapshotTest = requireFreshSnapshot;
`);
  writeFileSync(join(root, "docs", "newsletter-errors.md"), "# Newsletter errors\n\nERR_NEWSLETTER_SNAPSHOT_STALE: macro snapshot is too old means operators should refresh data.\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "ERR_NEWSLETTER_SNAPSHOT_STALE macro snapshot stale error" }, null, 2));
  writeFileSync(join(root, "dist", "snapshot-service.js"), "throw new Error('ERR_NEWSLETTER_SNAPSHOT_STALE: macro snapshot is too old');\n");

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "ERR_NEWSLETTER_SNAPSHOT_STALE macro snapshot stale error", limit: 5 });
  assert.equal(results[0]?.path, "src/newsletter/snapshot-service.ts");
  assert.ok(results.every((result) => result.path !== "package-lock.json"), JSON.stringify(results.map((result) => result.path)));
  assert.ok(results.every((result) => result.path !== "dist/snapshot-service.js"), JSON.stringify(results.map((result) => result.path)));

  const contextResult = codemapContext({ cwd: root, target: results[0]?.path ?? "", limit: 5 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.equal(readFirstPaths[0], "src/newsletter/snapshot-service.ts");
  assert.ok(readFirstPaths.includes("tests/newsletter/snapshot-service.test.ts"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("dist/snapshot-service.js"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("package-lock.json"), JSON.stringify(readFirstPaths));
});

test("phrase queries find phrase-bearing docs without lockfile noise", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "\"ignored directory\"", limit: 5 });
  assert.equal(results[0]?.path, "docs/ops.md");
  assert.ok(results.every((result) => result.path !== "package-lock.json"));
});

test("lockfiles are indexed but only prominent for explicit lockfile queries", (t) => {
  const root = fixtureRepo(t);

  const dependencies = searchCodeMap({ cwd: root, query: "package dependencies leftpad", limit: 5 });
  assert.equal(dependencies[0]?.path, "package.json");
  assert.ok(dependencies.every((result) => result.path !== "package-lock.json"));

  const lockfile = searchCodeMap({ cwd: root, query: "package-lock.json", limit: 5 });
  assert.equal(lockfile[0]?.path, "package-lock.json");
});

test("navigation queries rank source config docs and tests before noisy files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-ranking-noise-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "__generated__"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(join(root, "data"), { recursive: true });

  writeFileSync(join(root, "src", "index.ts"), "export function featureGateway() { return 'feature gateway source entrypoint'; }\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "feature-gateway", description: "feature gateway config", scripts: { test: "node --test" } }, null, 2));
  writeFileSync(join(root, "docs", "feature-gateway.md"), "# Feature gateway docs\n\nFeature gateway documentation for operators.\n");
  writeFileSync(join(root, "test", "feature-gateway.test.ts"), "import '../src/index';\n// feature gateway tests validate behavior\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, noise: "feature gateway config docs tests" }, null, 2));
  writeFileSync(join(root, "dist", "index.js"), "function featureGateway(){return 'feature gateway build output config docs tests'}\n");
  writeFileSync(join(root, "src", "__generated__", "feature-client.ts"), "export const generatedFeatureGateway = 'feature gateway generated config docs tests';\n");
  writeFileSync(join(root, "dist", "app.min.js"), "var featureGateway='feature gateway minified config docs tests';\n");
  writeFileSync(join(root, "data", "catalog.json"), JSON.stringify({ rows: Array.from({ length: 1500 }, (_, index) => ({ index, text: "feature gateway config docs tests noisy data" })) }, null, 2));

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "feature gateway config docs tests", limit: 10 });
  const paths = results.map((result) => result.path);
  const useful = ["src/index.ts", "package.json", "docs/feature-gateway.md", "test/feature-gateway.test.ts"];
  const noisy = ["package-lock.json", "dist/index.js", "src/__generated__/feature-client.ts", "dist/app.min.js", "data/catalog.json"];
  const firstNoisyIndex = Math.min(...noisy.map((path) => paths.indexOf(path)).filter((index) => index >= 0));

  assert.ok(Number.isFinite(firstNoisyIndex), JSON.stringify(paths));
  for (const path of useful) {
    const index = paths.indexOf(path);
    assert.ok(index >= 0, `${path} missing from ${JSON.stringify(paths)}`);
    assert.ok(index < firstNoisyIndex, `${path} should rank before noisy files: ${JSON.stringify(paths)}`);
  }

  const jsonResults = searchCodeMap({ cwd: root, query: "feature gateway json config docs tests", limit: 10 });
  const jsonPaths = jsonResults.map((result) => result.path);
  const firstJsonNoisyIndex = Math.min(...noisy.map((path) => jsonPaths.indexOf(path)).filter((index) => index >= 0));
  const packageJsonIndex = jsonPaths.indexOf("package.json");
  assert.ok(Number.isFinite(firstJsonNoisyIndex), JSON.stringify(jsonPaths));
  assert.ok(packageJsonIndex >= 0, JSON.stringify(jsonPaths));
  assert.ok(packageJsonIndex < firstJsonNoisyIndex, JSON.stringify(jsonPaths));

  const explicitNoise = searchCodeMap({ cwd: root, query: "catalog.json", limit: 5 });
  assert.equal(explicitNoise[0]?.path, "data/catalog.json");
});

test("ranking diagnostics expose score components without search API explain fields", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "package dependencies leftpad", limit: 5 });
  assert.ok(results.length > 0);
  assert.ok(results.every((result) => !("diagnostics" in result) && !("scoreDiagnostics" in result)));

  const diagnostics = scoreSearchRow({
    path: "package-lock.json",
    language: "json",
    startLine: 1,
    endLine: 1,
    kind: "text",
    text: "leftpad dependencies package",
    rank: -3,
    symbolName: null,
  }, planQuery("package dependencies leftpad"), 1);

  assert.ok(diagnostics.finalScore < 0, JSON.stringify(diagnostics));
  assert.equal(diagnostics.retrievalBoost, 1);
  assert.ok(diagnostics.ftsScore > 0, JSON.stringify(diagnostics));
  assert.ok(diagnostics.tokenCoverage > 0, JSON.stringify(diagnostics));
  assert.deepEqual(diagnostics.matchedTokens.sort(), ["dependencies", "leftpad", "package"]);
  assert.ok(diagnostics.noisePenalty >= 60, JSON.stringify(diagnostics));
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

test("full status reports git head and dirty tracked files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-git-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "codemap@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "CodeMap Test"], { cwd: root });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "changed.ts"), "export const changed = 1;\n");
  writeFileSync(join(root, "src", "deleted.ts"), "export const deleted = 1;\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: root, stdio: "ignore" });

  indexRepo({ cwd: root, approve: true });
  const clean = status(root, { health: "full" });
  assert.ok(clean.lastIndexedAt);
  assert.ok(clean.currentHead);
  assert.ok(clean.indexedHead);
  assert.equal(clean.currentHead, clean.indexedHead);
  assert.equal(clean.headChanged, false);
  assert.equal(clean.dirty, false);
  assert.deepEqual(clean.dirtyFiles, []);

  writeFileSync(join(root, "src", "changed.ts"), "export const changed = 2;\n");
  unlinkSync(join(root, "src", "deleted.ts"));
  const dirty = status(root, { health: "full" });
  assert.equal(dirty.stale, true);
  assert.equal(dirty.changed, 1);
  assert.equal(dirty.deleted, 1);
  assert.equal(dirty.dirty, true);
  assert.deepEqual(dirty.dirtyFiles.map((file) => [file.path, file.status]).sort(), [
    ["src/changed.ts", "modified"],
    ["src/deleted.ts", "deleted"],
  ]);

  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-m", "change tracked files"], { cwd: root, stdio: "ignore" });
  const committed = status(root, { health: "full" });
  assert.equal(committed.stale, true);
  assert.notEqual(committed.currentHead, committed.indexedHead);
  assert.equal(committed.headChanged, true);
  assert.equal(committed.dirty, false);
  assert.deepEqual(committed.dirtyFiles, []);
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

test("context read-first includes directly imported local files with reasons", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "src", "core", "user-service.ts"), `
import { connectDb } from "./db";
import { validateUser } from "./validation.ts";
import { externalClient } from "external-package";

export function approveUser(id: string) {
  validateUser(id);
  return connectDb().approve(id, externalClient);
}
`);
  writeFileSync(join(root, "src", "core", "db.ts"), "export function connectDb() { return { approve: (id: string, client: unknown) => ({ id, client }) }; }\n");
  writeFileSync(join(root, "src", "core", "validation.ts"), "export function validateUser(id: string) { if (!id) throw new Error('missing id'); }\n");
  writeFileSync(join(root, "test", "user-service.test.ts"), "import '../src/core/user-service';\n");
  writeFileSync(join(root, "docs", "user-service.md"), "# User service\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/user-service.ts", limit: 5 });

  assert.deepEqual(result.readFirst.slice(0, 3).map((item) => item.path), [
    "src/core/user-service.ts",
    "src/core/db.ts",
    "src/core/validation.ts",
  ]);
  assert.deepEqual(result.readFirst[0]?.reasons?.map((reason) => reason.kind), ["target"]);
  assert.deepEqual(result.readFirst[1]?.reasons?.map((reason) => reason.kind), ["import"]);
  assert.equal(result.readFirst[1]?.reasons?.[0]?.specifier, "./db");
  assert.ok(result.readFirst.every((item) => item.path !== "external-package"));
  assert.deepEqual(result.warnings, []);
});

test("context read-first includes Python relative imports with reasons", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "pkg"), { recursive: true });
  writeFileSync(join(root, "src", "pkg", "service.py"), `
from .db import connect_db
from . import validation


def run_service():
    return connect_db(), validation.validate()
`);
  writeFileSync(join(root, "src", "pkg", "db.py"), "def connect_db():\n    return True\n");
  writeFileSync(join(root, "src", "pkg", "db.ts"), "export const wrongLanguageDb = true;\n");
  writeFileSync(join(root, "src", "pkg", "validation.py"), "def validate():\n    return True\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/pkg/service.py", limit: 4 });

  assert.deepEqual(result.readFirst.slice(0, 3).map((item) => item.path), [
    "src/pkg/service.py",
    "src/pkg/db.py",
    "src/pkg/validation.py",
  ]);
  assert.deepEqual(result.readFirst[1]?.reasons?.map((reason) => reason.kind), ["import"]);
  assert.equal(result.readFirst[2]?.reasons?.[0]?.specifier, "./validation");
});

test("context read-first includes C++ includes and header implementation pairs with reasons", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "parser"), { recursive: true });
  writeFileSync(join(root, "src", "parser", "parser.h"), "int parse_value();\n");
  writeFileSync(join(root, "src", "parser", "parser.cpp"), `
#include "parser.h"

int parse_value() { return 1; }
`);
  writeFileSync(join(root, "src", "parser", "parser_test.cpp"), `
#include "parser.h"

int main() { return parse_value(); }
`);
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/parser/parser.h", limit: 4 });

  assert.deepEqual(result.readFirst.slice(0, 3).map((item) => item.path), [
    "src/parser/parser.h",
    "src/parser/parser.cpp",
    "src/parser/parser_test.cpp",
  ]);
  assert.ok(result.readFirst[1]?.reasons?.some((reason) => reason.kind === "implementation_pair"));
  assert.ok(result.readFirst[1]?.reasons?.some((reason) => reason.kind === "reverse_include"));
  assert.ok(result.readFirst[2]?.reasons?.some((reason) => reason.kind === "reverse_include"));
});

test("context import hints come from indexed content when target is stale", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { connectDb } from './db';\nexport const userService = connectDb;\n");
  writeFileSync(join(root, "src", "core", "db.ts"), "export function connectDb() { return true; }\n");
  writeFileSync(join(root, "src", "core", "validation.ts"), "export function validateUser() { return true; }\n");
  indexRepo({ cwd: root });
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { validateUser } from './validation';\nexport const userService = validateUser;\n");

  const result = codemapContext({ cwd: root, target: "src/core/user-service.ts", limit: 4 });
  const paths = result.readFirst.map((item) => item.path);

  const dbItem = result.readFirst.find((item) => item.path === "src/core/db.ts");
  assert.equal(result.stale, true);
  assert.ok(paths.includes("src/core/db.ts"));
  assert.equal(dbItem?.reasons?.[0]?.specifier, "./db");
  assert.ok(!paths.includes("src/core/validation.ts"));
});

test("context direct files keep later target chunks when no related files exist", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "long-context.ts"), `${Array.from({ length: 120 }, (_, index) => `export const longContextLine${index} = ${index};`).join("\n")}\n`);
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/long-context.ts", limit: 2 });

  assert.deepEqual(result.readFirst.map((item) => item.path), ["src/core/long-context.ts", "src/core/long-context.ts"]);
  assert.deepEqual(result.readFirst.map((item) => item.startLine), [1, 71]);
});

test("context read-first includes indexed local files that import the target", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "validation.ts"), "export function validateUser(id: string) { return Boolean(id); }\n");
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { validateUser } from './validation';\nexport function approveUser(id: string) { return validateUser(id); }\n");
  writeFileSync(join(root, "src", "pi-extension", "tools.ts"), "import { validateUser } from '../core/validation';\nexport const toolUsesValidation = validateUser;\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/validation.ts", limit: 4 });

  assert.deepEqual(result.readFirst.slice(0, 3).map((item) => item.path), [
    "src/core/validation.ts",
    "src/core/user-service.ts",
    "src/pi-extension/tools.ts",
  ]);
  assert.deepEqual(result.warnings, []);
});

test("context read-first includes nearby config files with reasons", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "core", "payments"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, "src", "core", "payments", "payment-service.ts"), `
import { createGateway } from "./gateway";

export function chargeInvoice(id: string) {
  return createGateway().charge(id);
}
`);
  writeFileSync(join(root, "src", "core", "payments", "gateway.ts"), "export function createGateway() { return { charge: (id: string) => id }; }\n");
  writeFileSync(join(root, "src", "core", "payments", "payment-service.config.json"), JSON.stringify({ retries: 3, provider: "stripe" }, null, 2));
  writeFileSync(join(root, "src", "core", "payments", "payment-service.test.ts"), "import './payment-service';\n");
  writeFileSync(join(root, "docs", "payment-service.md"), "# Payment service\n\nRead src/core/payments/payment-service.ts with its config.\n");
  writeFileSync(join(root, "dist", "payment-service.config.json"), JSON.stringify({ retries: 99, noise: "build output" }, null, 2));
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/payments/payment-service.ts", limit: 6 });
  const paths = result.readFirst.map((item) => item.path);

  assert.equal(paths[0], "src/core/payments/payment-service.ts");
  assert.ok(paths.includes("src/core/payments/gateway.ts"), JSON.stringify(paths));
  assert.ok(paths.includes("src/core/payments/payment-service.config.json"), JSON.stringify(paths));
  assert.ok(paths.includes("src/core/payments/payment-service.test.ts"), JSON.stringify(paths));
  assert.ok(paths.includes("docs/payment-service.md"), JSON.stringify(paths));
  assert.ok(!paths.includes("dist/payment-service.config.json"), JSON.stringify(paths));
  assert.deepEqual(result.readFirst.find((item) => item.path === "src/core/payments/payment-service.config.json")?.reasons?.map((reason) => reason.kind), ["near_config"]);
});

test("context read-first explains same-directory and test-role neighbors", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "core", "billing"), { recursive: true });

  writeFileSync(join(root, "src", "core", "billing", "invoice-service.ts"), `
import { createGateway } from "./gateway";

export function settleInvoice(id: string) {
  return createGateway().settle(id);
}
`);
  writeFileSync(join(root, "src", "core", "billing", "gateway.ts"), "export function createGateway() { return { settle: (id: string) => id }; }\n");
  writeFileSync(join(root, "src", "core", "billing", "invoice-service.policy.ts"), "export const invoiceServicePolicy = 'standard';\n");
  writeFileSync(join(root, "src", "core", "billing", "latest-invoice-service.ts"), "export const latestInvoiceServiceNotes = true;\n");
  writeFileSync(join(root, "src", "core", "billing", "invoice-service.test.ts"), "import './invoice-service';\n");
  writeFileSync(join(root, "src", "core", "billing", "invoice-service.spec.ts"), "export const siblingSpec = true;\n");
  writeFileSync(join(root, "src", "core", "billing", "invoice-service.config.json"), JSON.stringify({ retries: 2 }, null, 2));
  writeFileSync(join(root, "docs", "invoice-service.md"), "# Invoice service\n\nBilling docs.\n");
  indexRepo({ cwd: root });

  const sourceContext = codemapContext({ cwd: root, target: "src/core/billing/invoice-service.ts" });
  const reasonKindsByPath = new Map(sourceContext.readFirst.map((item) => [item.path, item.reasons?.map((reason) => reason.kind) ?? []]));

  assert.equal(sourceContext.readFirst[0]?.path, "src/core/billing/invoice-service.ts");
  assert.ok(reasonKindsByPath.get("src/core/billing/invoice-service.policy.ts")?.includes("same_dir"), JSON.stringify(sourceContext.readFirst));
  assert.ok(reasonKindsByPath.get("src/core/billing/invoice-service.test.ts")?.includes("reverse_test"), JSON.stringify(sourceContext.readFirst));
  assert.ok(reasonKindsByPath.get("src/core/billing/invoice-service.spec.ts")?.includes("sibling_test"), JSON.stringify(sourceContext.readFirst));
  assert.ok(!reasonKindsByPath.get("src/core/billing/latest-invoice-service.ts")?.includes("sibling_test"), JSON.stringify(sourceContext.readFirst));

  const testContext = codemapContext({ cwd: root, target: "src/core/billing/invoice-service.test.ts", limit: 3 });
  const sourceUnderTest = testContext.readFirst.find((item) => item.path === "src/core/billing/invoice-service.ts");
  assert.ok(sourceUnderTest?.reasons?.some((reason) => reason.kind === "test_of"), JSON.stringify(testContext.readFirst));
});

test("context read-first includes same-directory source before extra target chunks at default limit", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "isolated-widget.ts"), `${Array.from({ length: 90 }, (_, index) => `export const isolatedWidgetLine${index} = ${index};`).join("\n")}\n`);
  writeFileSync(join(root, "src", "core", "isolated-widget.policy.ts"), "export const isolatedWidgetPolicy = true;\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/isolated-widget.ts" });
  const sameDirItem = result.readFirst.find((item) => item.path === "src/core/isolated-widget.policy.ts");

  assert.ok(sameDirItem?.reasons?.some((reason) => reason.kind === "same_dir"), JSON.stringify(result.readFirst));
});

test("context read-first excludes noisy generated and lockfile neighbors", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "__generated__"), { recursive: true });
  mkdirSync(join(root, "data"), { recursive: true });
  writeFileSync(join(root, "src", "feature.ts"), `
import lockData from "../package-lock.json";
import catalogData from "../data/catalog.json";
import { generatedClient } from "./__generated__/client";
export const feature = generatedClient + String(lockData) + String(catalogData);
`);
  writeFileSync(join(root, "src", "__generated__", "client.ts"), `
import { feature } from "../feature";
export const generatedClient = String(feature);
`);
  writeFileSync(join(root, "src", "feature.test.ts"), `
import { feature } from "./feature";
test("feature", () => feature);
`);
  writeFileSync(join(root, "data", "catalog.json"), JSON.stringify({ rows: Array.from({ length: 1500 }, (_, index) => ({ index, text: "feature catalog data" })) }, null, 2));
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/feature.ts", limit: 6 });
  const paths = result.readFirst.map((item) => item.path);
  assert.equal(paths[0], "src/feature.ts");
  assert.ok(paths.includes("src/feature.test.ts"), JSON.stringify(paths));
  assert.ok(!paths.includes("src/__generated__/client.ts"), JSON.stringify(paths));
  assert.ok(!paths.includes("package-lock.json"), JSON.stringify(paths));
  assert.ok(!paths.includes("data/catalog.json"), JSON.stringify(paths));
});

test("context read-first excludes imported files outside pathPrefix", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-context-import-prefix-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "packages", "billing", "src"), { recursive: true });
  mkdirSync(join(root, "packages", "shared"), { recursive: true });

  writeFileSync(join(root, "packages", "billing", "src", "invoice-service.ts"), "import { sharedLogger } from '../../shared/logger';\nexport const invoiceService = sharedLogger;\n");
  writeFileSync(join(root, "packages", "shared", "logger.ts"), "export const sharedLogger = true;\n");
  writeFileSync(join(root, "packages", "shared", "consumer.ts"), "import { invoiceService } from '../billing/src/invoice-service';\nexport const consumer = invoiceService;\n");
  indexRepo({ cwd: root, approve: true });

  const result = codemapContext({ cwd: root, target: "invoice-service.ts", pathPrefix: "packages/billing", limit: 4 });

  assert.deepEqual(result.readFirst.map((item) => item.path), ["packages/billing/src/invoice-service.ts"]);
  assert.ok(result.readFirst.every((item) => item.path.startsWith("packages/billing/")));
});

test("context read-first locality includes nested sibling tests and docs within pathPrefix", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-context-locality-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "packages", "billing", "src"), { recursive: true });
  mkdirSync(join(root, "packages", "billing", "docs"), { recursive: true });
  mkdirSync(join(root, "packages", "billing", "archive"), { recursive: true });
  mkdirSync(join(root, "packages", "web", "src"), { recursive: true });
  mkdirSync(join(root, "packages", "web", "docs"), { recursive: true });

  writeFileSync(join(root, "packages", "billing", "src", "invoice-service.ts"), `${Array.from({ length: 90 }, (_, index) => `export const invoiceLine${index} = ${index};`).join("\n")}\n`);
  writeFileSync(join(root, "packages", "billing", "src", "invoice-service.test.ts"), "import './invoice-service';\n");
  writeFileSync(join(root, "packages", "billing", "docs", "invoice-service.md"), "# Invoice service\n\nBilling invoice docs.\n");
  writeFileSync(join(root, "packages", "billing", "archive", "invoice-service.test.ts"), "import '../src/invoice-service';\n");
  writeFileSync(join(root, "packages", "web", "src", "invoice-service.test.ts"), "import './invoice-service';\n");
  writeFileSync(join(root, "packages", "web", "docs", "invoice-service.md"), "# Web invoice docs\n");
  indexRepo({ cwd: root, approve: true });

  const result = codemapContext({ cwd: root, target: "invoice-service.ts", pathPrefix: "packages/billing", limit: 6 });
  const readFirstPaths = [...new Set(result.readFirst.map((item) => item.path))];

  assert.deepEqual(result.readFirst.slice(0, 3).map((item) => item.path), [
    "packages/billing/src/invoice-service.ts",
    "packages/billing/src/invoice-service.test.ts",
    "packages/billing/docs/invoice-service.md",
  ]);
  assert.deepEqual(readFirstPaths.slice(0, 3), [
    "packages/billing/src/invoice-service.ts",
    "packages/billing/src/invoice-service.test.ts",
    "packages/billing/docs/invoice-service.md",
  ]);
  assert.deepEqual(result.relatedTests, [
    "packages/billing/src/invoice-service.test.ts",
    "packages/billing/archive/invoice-service.test.ts",
  ]);
  assert.deepEqual(result.relatedDocs, ["packages/billing/docs/invoice-service.md"]);
  assert.ok(result.readFirst.every((item) => item.path.startsWith("packages/billing/")));
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
  writeFileSync(join(root, "bundle.min.js"), "const superSkippedNeedle=true;");
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

test("full status reports dirty files before the first commit without stale warnings", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-unborn-dirty-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  writeFileSync(join(root, "untracked.ts"), "export const unbornDirtyStatus = true;\n");
  indexRepo({ cwd: root, approve: true });

  const result = status(root, { health: "full" });

  assert.equal(result.currentHead, null);
  assert.equal(result.indexedHead, null);
  assert.equal(result.dirty, true);
  assert.deepEqual(result.dirtyFiles.map((file) => [file.path, file.status]), [["untracked.ts", "untracked"]]);
  assert.equal(result.stale, false);
  assert.deepEqual(result.warnings, []);
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

test("stateDir isolates approval registry and repo index DBs", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-state-seam-repo-"));
  const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-state-seam-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "isolated.ts"), `
export function isolatedFeature() {
  return true;
}
`);
  const defaultRegistryPath = join(storageHome, ".pi", "agent", "state", "codemap", "registry.sqlite");
  const defaultDbPath = join(storageHome, ".pi", "agent", "state", "codemap", "repos", `${repoKey(root)}.sqlite`);
  const defaultRegistryBefore = existsSync(defaultRegistryPath) ? statSync(defaultRegistryPath) : undefined;
  assert.equal(existsSync(defaultDbPath), false);

  const indexed = indexRepo({ cwd: root, approve: true, stateDir });
  const isolatedInfo = getRepoInfo(root, { stateDir });

  assert.equal(isolatedInfo.approved, true);
  assert.equal(indexed.dbPath, join(stateDir, "repos", `${isolatedInfo.key}.sqlite`));
  assert.ok(existsSync(join(stateDir, "registry.sqlite")));
  assert.ok(existsSync(indexed.dbPath));
  assert.equal(status(root, { stateDir }).readiness, "ready");
  assert.equal(searchCodeMap({ cwd: root, query: "isolatedFeature", stateDir })[0]?.path, "src/isolated.ts");
  assert.equal(codemapContext({ cwd: root, target: "isolatedFeature", stateDir }).root, root);

  assert.notEqual(defaultDbPath, isolatedInfo.dbPath);
  assert.equal(existsSync(defaultDbPath), false);
  if (defaultRegistryBefore) {
    const defaultRegistryAfter = statSync(defaultRegistryPath);
    assert.equal(defaultRegistryAfter.size, defaultRegistryBefore.size);
    assert.equal(defaultRegistryAfter.mtimeMs, defaultRegistryBefore.mtimeMs);
  } else {
    assert.equal(existsSync(defaultRegistryPath), false);
  }
});

test("CodeMap uses state storage for registry and repo DBs", (t) => {
  const root = fixtureRepo(t);
  const info = getRepoInfo(root);

  assert.match(info.dbPath, /\.pi\/agent\/state\/codemap\/repos\//);
  assert.ok(existsSync(join(storageHome, ".pi", "agent", "state", "codemap", "registry.sqlite")));
  assert.ok(existsSync(info.dbPath));
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
