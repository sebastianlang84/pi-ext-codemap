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

test("codemap context resolves TypeScript path aliases from tsconfig paths", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-alias-context-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "app"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib"), { recursive: true });
  mkdirSync(join(root, "src", "app"), { recursive: true });
  mkdirSync(join(root, "src", "lib"), { recursive: true });
  mkdirSync(join(root, "src", "root-wrong", "lib"), { recursive: true });

  const rootPaths: Record<string, string[]> = { "~/*": ["lib/*"], "@/*": ["root-wrong/*"] };
  for (let index = 0; index < 90; index++) rootPaths[`dummy-${index}/*`] = [`unused-${index}/*`];

  writeFileSync(join(root, "apps", "web", "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }, null, 2));
  writeFileSync(join(root, "apps", "web", "src", "app", "page.ts"), `
import { formatHeadline } from "@/lib/headline";

export function renderPageHeadline(value: string) {
  return formatHeadline(value);
}
`);
  writeFileSync(join(root, "apps", "web", "src", "app", "missing-page.ts"), `
import { wrongAliasTarget } from "@/lib/missing";

export const missingPage = wrongAliasTarget;
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "headline.ts"), `
export function formatHeadline(value: string) {
  return value.toUpperCase();
}
`);
  writeFileSync(join(root, "jsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "src", paths: rootPaths } }, null, 2));
  writeFileSync(join(root, "src", "app", "widget.js"), `
import { formatWidgetHeadline } from "~/headline";

export function renderWidget(value) {
  return formatWidgetHeadline(value);
}
`);
  writeFileSync(join(root, "src", "lib", "headline.js"), `
export function formatWidgetHeadline(value) {
  return value.toLowerCase();
}
`);
  writeFileSync(join(root, "src", "root-wrong", "lib", "headline.ts"), `
export const wrongAliasTarget = true;
`);
  writeFileSync(join(root, "src", "root-wrong", "lib", "missing.ts"), `
export const wrongAliasTarget = true;
`);

  indexRepo({ cwd: root, approve: true });

  const contextResult = codemapContext({ cwd: root, target: "apps/web/src/app/page.ts", limit: 5 });
  const readFirstPaths = contextResult.readFirst.map((item) => item.path);
  assert.ok(readFirstPaths.includes("apps/web/src/lib/headline.ts"), JSON.stringify(readFirstPaths));
  assert.ok(!readFirstPaths.includes("src/root-wrong/lib/headline.ts"), JSON.stringify(readFirstPaths));
  const headlineReason = contextResult.readFirst.find((item) => item.path === "apps/web/src/lib/headline.ts")?.reasons ?? [];
  assert.ok(headlineReason.some((reason) => reason.kind === "import" && reason.specifier === "@/lib/headline"), JSON.stringify(headlineReason));

  const missingContextResult = codemapContext({ cwd: root, target: "apps/web/src/app/missing-page.ts", limit: 5 });
  const missingReadFirstPaths = missingContextResult.readFirst.map((item) => item.path);
  assert.ok(!missingReadFirstPaths.includes("src/root-wrong/lib/missing.ts"), JSON.stringify(missingReadFirstPaths));

  const jsContextResult = codemapContext({ cwd: root, target: "src/app/widget.js", limit: 5 });
  const jsReadFirstPaths = jsContextResult.readFirst.map((item) => item.path);
  assert.ok(jsReadFirstPaths.includes("src/lib/headline.js"), JSON.stringify(jsReadFirstPaths));
  const jsHeadlineReason = jsContextResult.readFirst.find((item) => item.path === "src/lib/headline.js")?.reasons ?? [];
  assert.ok(jsHeadlineReason.some((reason) => reason.kind === "import" && reason.specifier === "~/headline"), JSON.stringify(jsHeadlineReason));
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

test("symbol queries outrank broad implementation file chunks", (t) => {
  const root = fixtureRepo(t);
  const results = searchCodeMap({ cwd: root, query: "approveUser implementation", limit: 5 });
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
