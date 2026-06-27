import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { indexRepo } = await import("../src/core/indexer.ts");
const { searchCodeMap } = await import("../src/core/search.ts");
const { codemapContext } = await import("../src/core/context.ts");

test("generic implementation search does not seed unrelated main entrypoints", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-generic-implementation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });

  writeFileSync(join(root, "src", "index.ts"), "export function bootstrapEntrypoint() { return 'main app shell'; }\n");
  writeFileSync(join(root, "src", "retrieval.ts"), "export const retrievalHint = 'memory retrieval behavior lives here';\n");
  indexRepo({ cwd: root, approve: true });

  const genericResults = searchCodeMap({ cwd: root, query: "memory retrieval implementation", limit: 5 });
  assert.equal(genericResults[0]?.path, "src/retrieval.ts", JSON.stringify(genericResults));

  const mainResults = searchCodeMap({ cwd: root, query: "where is the main implementation?", limit: 5 });
  assert.equal(mainResults[0]?.path, "src/index.ts", JSON.stringify(mainResults));
});

test("natural binary change requests prefer source targets over agent instructions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-binary-change-source-first-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "ast-grep"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });

  writeFileSync(join(root, "AGENTS.md"), `
# ast-grep binary guidance

The ast grep binary path may be ambiguous when sg is shadowed by another utils command.
The ast grep binary path install guidance belongs in source behavior, not this instruction file.
`);
  writeFileSync(join(root, "src", "ast-grep", "binary-path.ts"), `
export function resolveAstGrepBinaryPath(candidate: string) {
  if (candidate === "sg") throw new Error("ambiguous sg shadow utils command; install ast-grep");
  return candidate;
}
`);
  writeFileSync(join(root, "test", "binary-path.test.ts"), `
import { resolveAstGrepBinaryPath } from "../src/ast-grep/binary-path";

test("rejects ambiguous sg shadow utils command", () => resolveAstGrepBinaryPath("sg"));
`);
  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "ast grep binary path should reject ambiguous sg shadow utils command and show install guidance", limit: 5 });
  const sourceIndex = results.findIndex((result) => result.path === "src/ast-grep/binary-path.ts");
  const agentIndex = results.findIndex((result) => result.path === "AGENTS.md");

  assert.equal(sourceIndex, 0, JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
  assert.ok(agentIndex === -1 || agentIndex > sourceIndex, JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
});

test("natural workbench session queries prefer source over local agent settings", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-workbench-session-source-first-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(join(root, "src", "lib"), { recursive: true });

  writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({
    permissions: { allow: ["Bash(curl:*)"] },
    spinnerTipsEnabled: true,
  }, null, 2));
  writeFileSync(join(root, "src", "lib", "use-series-workbench-session.ts"), `
export function restoreSeriesWorkbenchSession() {
  const saved = localStorage.getItem("series-workbench-session");
  return saved ? JSON.parse(saved) : { interval: "1d", range: "1y" };
}
`);
  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "workbench chart interval and x range settings should survive reload from local storage", limit: 5 });
  const sourceIndex = results.findIndex((result) => result.path === "src/lib/use-series-workbench-session.ts");
  const localSettingsIndex = results.findIndex((result) => result.path === ".claude/settings.local.json");

  assert.equal(sourceIndex, 0, JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
  assert.ok(localSettingsIndex === -1 || localSettingsIndex > sourceIndex, JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
});

test("implementation-intent queries prefer source targets over matching tests", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-implementation-source-first-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "test", "pi-extension"), { recursive: true });

  writeFileSync(join(root, "src", "pi-extension", "tools.ts"), `
export function registerMemoryTools() {
  return true;
}
`);
  writeFileSync(join(root, "test", "pi-extension", "tools.test.ts"), `
import { registerMemoryTools } from "../../src/pi-extension/tools";

// Repeated test-local helper methods should not saturate the implementation query candidate pool.
${Array.from({ length: 30 }, (_, index) => `export const testCase${index} = { registerMemoryTools() { return "implementation memory_search empty_result_hints near canonical keys near tag suggestions"; } };`).join("\n")}

test("registerMemoryTools implementation memory_search empty_result_hints near canonical keys near tag suggestions", () => {
  testCase0.registerMemoryTools();
});
`);
  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "registerMemoryTools implementation memory_search empty_result_hints near canonical keys near tag suggestions", limit: 5 });

  assert.equal(results[0]?.path, "src/pi-extension/tools.ts", JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
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

test("noisy queries keep source first and out of read-first neighbors", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-noisy-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "__generated__"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, "src", "noisy-navigation.ts"), `
export function resolveNoisyNavigation() {
  return "generated bundle noise root cause source anchor";
}
`);
  writeFileSync(join(root, "src", "__generated__", "noisy-client.ts"), "export const generatedNoisyClient = 'generated bundle noise root cause source anchor';\n");
  writeFileSync(join(root, "dist", "noisy-navigation.js"), "function resolveNoisyNavigation(){return 'generated bundle noise root cause source anchor';}\n");
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ noise: "generated bundle noise root cause source anchor" }, null, 2));

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "generated bundle noise root cause source anchor", limit: 5 });
  assert.equal(results[0]?.path, "src/noisy-navigation.ts");
  assert.ok(results.every((result) => result.path !== "src/__generated__/noisy-client.ts"), JSON.stringify(results.map((result) => result.path)));
  assert.ok(results.every((result) => result.path !== "dist/noisy-navigation.js"), JSON.stringify(results.map((result) => result.path)));
  assert.ok(results.every((result) => result.path !== "package-lock.json"), JSON.stringify(results.map((result) => result.path)));

  const contextResult = codemapContext({ cwd: root, target: results[0]?.path ?? "", limit: 4 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.equal(readFirstPaths[0], "src/noisy-navigation.ts");
  assert.ok(!readFirstPaths.includes("src/__generated__/noisy-client.ts"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("dist/noisy-navigation.js"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("package-lock.json"), JSON.stringify(readFirstPaths));
});

test("natural module queries rank exact basename files above sibling config matches", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-module-query-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "newsletter_writer"), { recursive: true });

  writeFileSync(join(root, "src", "newsletter_writer", "config.py"), `
class TelegramConfig:
    delivery_log_path = "telegram delivery log"
`);
  writeFileSync(join(root, "src", "newsletter_writer", "delivery.py"), `
"""Telegram delivery: send newsletter messages via Bot API."""

def send_telegram(text):
    return text
`);

  indexRepo({ cwd: root, approve: true });

  const results = searchCodeMap({ cwd: root, query: "telegram delivery log host lock", limit: 5 });
  assert.equal(results[0]?.path, "src/newsletter_writer/delivery.py", JSON.stringify(results.map((result) => ({ path: result.path, score: result.score }))));
});
