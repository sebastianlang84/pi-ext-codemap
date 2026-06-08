import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { fixtureRepo, useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { indexRepo } = await import("../src/core/indexer.ts");
const { codemapContext } = await import("../src/core/context.ts");
const { openRepoDb } = await import("../src/core/db.ts");
const { graphNeighborhoodDiagnostics, pathBetweenTargets } = await import("../src/core/relationships.ts");
const { getRepoInfo } = await import("../src/core/repo.ts");

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

test("context read-first keeps a convention sibling test within the small read budget", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "test", "pi-extension"), { recursive: true });

  writeFileSync(join(root, "src", "pi-extension", "retrieval.ts"), `
import { readStore } from "./store";
import { validateQuery } from "./validation";

export function retrieve(query: string) {
  return validateQuery(query) ? readStore(query) : [];
}
`);
  writeFileSync(join(root, "src", "pi-extension", "store.ts"), "export function readStore(query: string) { return [query]; }\n");
  writeFileSync(join(root, "src", "pi-extension", "validation.ts"), "export function validateQuery(query: string) { return Boolean(query); }\n");
  writeFileSync(join(root, "src", "pi-extension", "commands.ts"), "import { retrieve } from './retrieval';\nexport const runRetrieval = retrieve;\n");
  writeFileSync(join(root, "src", "pi-extension", "retrieval.config.json"), JSON.stringify({ limit: 5 }, null, 2));
  writeFileSync(join(root, "test", "pi-extension", "retrieval.test.ts"), "test('retrieval convention neighbor', () => true);\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/pi-extension/retrieval.ts", limit: 5 });
  const paths = result.readFirst.map((item) => item.path);

  assert.equal(paths[0], "src/pi-extension/retrieval.ts");
  assert.ok(paths.includes("test/pi-extension/retrieval.test.ts"), JSON.stringify(paths));
  assert.ok(result.readFirst.find((item) => item.path === "test/pi-extension/retrieval.test.ts")?.reasons?.some((reason) => reason.kind === "sibling_test"), JSON.stringify(result.readFirst));
});

test("context read-first includes tests for imported local neighbors within the small read budget", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "test", "pi-extension"), { recursive: true });

  writeFileSync(join(root, "src", "pi-extension", "turn-intake.ts"), `
import { loadCore } from "../core/index";
import { retrieve } from "./retrieval";

export function runTurnIntake(prompt: string) {
  return retrieve(loadCore(prompt));
}
`);
  writeFileSync(join(root, "src", "core", "index.ts"), "export function loadCore(prompt: string) { return prompt; }\n");
  writeFileSync(join(root, "src", "pi-extension", "retrieval.ts"), "export function retrieve(query: string) { return [query]; }\n");
  writeFileSync(join(root, "src", "pi-extension", "index.ts"), "import { runTurnIntake } from './turn-intake';\nexport const run = runTurnIntake;\n");
  writeFileSync(join(root, "src", "pi-extension", "turn-intake.config.json"), JSON.stringify({ mode: "turn" }, null, 2));
  writeFileSync(join(root, "test", "pi-extension", "turn-intake.test.ts"), "test('turn intake', () => true);\n");
  writeFileSync(join(root, "test", "pi-extension", "retrieval.test.ts"), "test('retrieval imported neighbor', () => true);\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/pi-extension/turn-intake.ts", limit: 5 });
  const paths = result.readFirst.map((item) => item.path);
  const retrievalTest = result.readFirst.find((item) => item.path === "test/pi-extension/retrieval.test.ts");

  assert.equal(paths[0], "src/pi-extension/turn-intake.ts");
  assert.ok(paths.includes("src/pi-extension/retrieval.ts"), JSON.stringify(paths));
  assert.ok(retrievalTest, JSON.stringify(paths));
  assert.ok(retrievalTest.reasons?.some((reason) => reason.kind === "sibling_test" && reason.targetPath === "src/pi-extension/retrieval.ts"), JSON.stringify(retrievalTest));
});

test("context read-first prioritizes stem-affine importers before imported-neighbor tests", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "lib", "__tests__"), { recursive: true });

  writeFileSync(join(root, "src", "lib", "series-workbench-backtest-target.ts"), `
import { analyzeSeries } from "./series-analysis";
import { runEngine } from "./series-workbench-engine";

export function buildWorkbenchBacktestTargets() {
  return [analyzeSeries(), runEngine()];
}
`);
  writeFileSync(join(root, "src", "lib", "series-analysis.ts"), "export function analyzeSeries() { return true; }\n");
  writeFileSync(join(root, "src", "lib", "series-workbench-engine.ts"), "export function runEngine() { return true; }\n");
  writeFileSync(join(root, "src", "lib", "series-workbench-backtest.ts"), "import { buildWorkbenchBacktestTargets } from './series-workbench-backtest-target';\nexport const backtest = buildWorkbenchBacktestTargets;\n");
  writeFileSync(join(root, "src", "lib", "__tests__", "series-workbench-backtest-target.test.ts"), "test('target', () => true);\n");
  writeFileSync(join(root, "src", "lib", "__tests__", "series-analysis.test.ts"), "test('analysis', () => true);\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/lib/series-workbench-backtest-target.ts", limit: 5 });
  const paths = result.readFirst.map((item) => item.path);
  const importer = result.readFirst.find((item) => item.path === "src/lib/series-workbench-backtest.ts");

  assert.ok(paths.includes("src/lib/__tests__/series-workbench-backtest-target.test.ts"), JSON.stringify(paths));
  assert.ok(importer?.reasons?.some((reason) => reason.kind === "reverse_import"), JSON.stringify(result.readFirst));
  assert.ok(!paths.includes("src/lib/__tests__/series-analysis.test.ts"), JSON.stringify(paths));
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

test("graph schema stores file import edges without symbol or heuristic columns", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { connectDb } from './db';\nexport const userService = connectDb;\n");
  writeFileSync(join(root, "src", "core", "db.ts"), "export function connectDb() { return true; }\n");
  indexRepo({ cwd: root });

  const db = new DatabaseSync(getRepoInfo(root).dbPath, { readOnly: true });
  try {
    const nodeColumns = new Set((db.prepare("pragma table_info(graph_nodes)").all() as Array<{ name: string }>).map((row) => row.name));
    const edgeColumns = new Set((db.prepare("pragma table_info(graph_edges)").all() as Array<{ name: string }>).map((row) => row.name));
    assert.ok(!nodeColumns.has("symbol_id"));
    assert.ok(!edgeColumns.has("scope"));
    assert.ok(!edgeColumns.has("confidence"));
    assert.equal((db.prepare("select count(*) as count from graph_nodes where ref = 'file:src/core/db.ts' and kind = 'file'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("select count(*) as count from graph_edges where kind = 'imports' and specifier = './db'").get() as { count: number }).count, 1);
  } finally {
    db.close();
  }
});

test("reverse importer context uses graph edges when importer chunks are wiped", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "validation.ts"), "export function validateUser(id: string) { return Boolean(id); }\n");
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { validateUser } from './validation';\nexport const userService = validateUser;\n");
  indexRepo({ cwd: root });

  const db = new DatabaseSync(getRepoInfo(root).dbPath);
  try {
    db.prepare("update chunks set text = '' where file_id = (select id from files where path = ?)").run("src/core/user-service.ts");
  } finally {
    db.close();
  }

  const result = codemapContext({ cwd: root, target: "src/core/validation.ts", limit: 3 });

  assert.ok(result.readFirst.map((item) => item.path).includes("src/core/user-service.ts"), JSON.stringify(result.readFirst));
});

test("graph neighborhood diagnostics group direct file neighbors without widening pathPrefix", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-graph-neighborhood-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "packages", "billing", "src"), { recursive: true });
  mkdirSync(join(root, "packages", "shared"), { recursive: true });

  const extraImports = Array.from({ length: 9 }, (_, index) => `import { helper${index} } from "./helper-${index}";`).join("\n");
  writeFileSync(join(root, "packages", "billing", "src", "invoice-service.ts"), `
${extraImports}
import { createGateway } from "./gateway";
import { sharedLogger } from "../../shared/logger";
export const invoiceService = [createGateway, sharedLogger];
`);
  for (let index = 0; index < 9; index++) writeFileSync(join(root, "packages", "billing", "src", `helper-${index}.ts`), `export const helper${index} = true;\n`);
  writeFileSync(join(root, "packages", "billing", "src", "gateway.ts"), "export function createGateway() { return true; }\n");
  writeFileSync(join(root, "packages", "billing", "src", "include-target.h"), "int include_target();\n");
  writeFileSync(join(root, "packages", "billing", "src", "consumer-a.ts"), "import { invoiceService } from './invoice-service';\nexport const a = invoiceService;\n");
  writeFileSync(join(root, "packages", "billing", "src", "consumer-b.ts"), "import { invoiceService } from './invoice-service';\nexport const b = invoiceService;\n");
  writeFileSync(join(root, "packages", "shared", "logger.ts"), "export const sharedLogger = true;\n");
  indexRepo({ cwd: root, approve: true });

  const db = openRepoDb(getRepoInfo(root).dbPath);
  try {
    db.prepare(`
      insert into graph_edges(from_node_id, to_node_id, kind, source_file_id, extractor, line_start, line_end, specifier, evidence_key, created_at, updated_at)
      select source.id, target.id, 'includes', source.file_id, 'test-fixture', 50, 50, './include-target', 'fixture:include-target', datetime('now'), datetime('now')
      from graph_nodes source, graph_nodes target
      where source.ref = 'file:packages/billing/src/invoice-service.ts' and target.ref = 'file:packages/billing/src/include-target.h'
    `).run();
    const result = graphNeighborhoodDiagnostics(db, "packages/billing/src/invoice-service.ts", "packages/billing%", { limitPerGroup: 1 });
    const groups = new Map(result.groups.map((group) => [group.kind, group.neighbors]));

    assert.deepEqual(result.groups.map((group) => group.kind), ["imports", "reverse_imports", "includes", "reverse_includes", "implementation_pair"]);
    assert.deepEqual(groups.get("imports")?.map((item) => item.path), ["packages/billing/src/helper-0.ts"]);
    assert.deepEqual(groups.get("imports")?.[0]?.reasons.map((reason) => reason.kind), ["import"]);
    assert.deepEqual(groups.get("reverse_imports")?.map((item) => item.path), ["packages/billing/src/consumer-a.ts"]);
    assert.deepEqual(groups.get("includes")?.map((item) => item.path), ["packages/billing/src/include-target.h"]);
    assert.ok(!result.groups.flatMap((group) => group.neighbors).some((item) => item.path === "packages/shared/logger.ts"), JSON.stringify(result.groups));
  } finally {
    db.close();
  }
});

test("graph neighborhood diagnostics expose includes and implementation pairs for direct files", (t) => {
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

  const db = openRepoDb(getRepoInfo(root).dbPath);
  try {
    const result = graphNeighborhoodDiagnostics(db, "src/parser/parser.cpp", "%");
    const groups = new Map(result.groups.map((group) => [group.kind, group.neighbors]));

    assert.deepEqual(groups.get("includes")?.map((item) => item.path), ["src/parser/parser.h"]);
    assert.deepEqual(groups.get("implementation_pair")?.map((item) => item.path), ["src/parser/parser.h"]);
    assert.deepEqual(groups.get("includes")?.[0]?.reasons.map((reason) => reason.kind), ["include"]);
  } finally {
    db.close();
  }
});

test("internal relationship path helper finds capped graph paths with edge evidence", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "src", "core"), { recursive: true });
  writeFileSync(join(root, "src", "operation.ts"), "import { runCore } from './core/index';\nexport const operation = runCore;\n");
  writeFileSync(join(root, "src", "core", "index.ts"), "import { readStore } from './store';\nexport const runCore = readStore;\n");
  writeFileSync(join(root, "src", "core", "store.ts"), "export function readStore() { return true; }\n");
  writeFileSync(join(root, "src", "unreachable.ts"), "export const unreachable = true;\n");
  indexRepo({ cwd: root });

  const db = openRepoDb(getRepoInfo(root).dbPath);
  try {
    const path = pathBetweenTargets(db, "src/operation.ts", "src/core/store.ts");
    assert.deepEqual(path?.steps.map((step) => [step.fromPath, step.kind, step.toPath, step.specifier]), [
      ["src/operation.ts", "imports", "src/core/index.ts", "./core/index"],
      ["src/core/index.ts", "imports", "src/core/store.ts", "./store"],
    ]);
    assert.deepEqual(pathBetweenTargets(db, "src/operation.ts", "src/core/store.ts", { maxHops: 1 }), undefined);
    assert.deepEqual(pathBetweenTargets(db, "src/core/store.ts", "src/operation.ts")?.steps.map((step) => step.kind), ["reverse_imports", "reverse_imports"]);
    assert.deepEqual(pathBetweenTargets(db, "src/operation.ts", "src/unreachable.ts"), undefined);
  } finally {
    db.close();
  }
});

test("context resolves TypeScript relative .js specifiers to indexed .ts files", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "request.ts"), "export function normalizeRequest() { return true; }\n");
  writeFileSync(join(root, "src", "execution.ts"), "import { normalizeRequest } from './request.js';\nexport const execute = normalizeRequest;\n");
  indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/request.ts", limit: 3 });
  const executionItem = result.readFirst.find((item) => item.path === "src/execution.ts");

  assert.ok(executionItem?.reasons?.some((reason) => reason.kind === "reverse_import" && reason.specifier === "./request.js"), JSON.stringify(result.readFirst));
});

test("graph rebuild resolves imports from unchanged files when target appears later", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { lateTarget } from './late-target';\nexport const userService = lateTarget;\n");
  indexRepo({ cwd: root });
  writeFileSync(join(root, "src", "core", "late-target.ts"), "export const lateTarget = true;\n");
  const refreshed = indexRepo({ cwd: root });

  const result = codemapContext({ cwd: root, target: "src/core/late-target.ts", limit: 3 });

  assert.equal(refreshed.indexed, 1);
  assert.ok(result.readFirst.map((item) => item.path).includes("src/core/user-service.ts"), JSON.stringify(result.readFirst));
});

test("graph rebuild removes stale edges when imported target is deleted", (t) => {
  const root = fixtureRepo(t);
  writeFileSync(join(root, "src", "core", "user-service.ts"), "import { connectDb } from './db';\nexport const userService = connectDb;\n");
  writeFileSync(join(root, "src", "core", "db.ts"), "export function connectDb() { return true; }\n");
  indexRepo({ cwd: root });
  unlinkSync(join(root, "src", "core", "db.ts"));
  const refreshed = indexRepo({ cwd: root });

  const db = new DatabaseSync(getRepoInfo(root).dbPath, { readOnly: true });
  try {
    assert.equal(refreshed.removed, 1);
    assert.equal((db.prepare("select count(*) as count from graph_edges where specifier = './db'").get() as { count: number }).count, 0);
  } finally {
    db.close();
  }
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

test("context read-first links route adapters with convention-named handlers", (t) => {
  const root = fixtureRepo(t);
  mkdirSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "server"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro", "route.ts"), `
export async function GET() {
  return Response.json({ status: "newsletter macro endpoint ready" });
}
`);
  writeFileSync(join(root, "apps", "web", "src", "server", "newsletter-macro-handler.ts"), `
export function buildNewsletterMacroResponse() {
  return { status: "newsletter macro handler ready" };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "server", "newsletter-macro-handler.test.ts"), "import './newsletter-macro-handler';\n");
  writeFileSync(join(root, "apps", "web", "src", "server", "macro-cleanup-handler.ts"), "export const unrelatedHandler = true;\n");
  indexRepo({ cwd: root });

  const routeContext = codemapContext({ cwd: root, target: "apps/web/src/app/api/newsletter/macro/route.ts", limit: 5 });
  const routePaths = routeContext.readFirst.map((item) => item.path);
  const handler = routeContext.readFirst.find((item) => item.path === "apps/web/src/server/newsletter-macro-handler.ts");
  const handlerTest = routeContext.readFirst.find((item) => item.path === "apps/web/src/server/newsletter-macro-handler.test.ts");

  assert.equal(routePaths[0], "apps/web/src/app/api/newsletter/macro/route.ts");
  assert.ok(handler?.reasons?.some((reason) => reason.kind === "implementation_pair"), JSON.stringify(routeContext.readFirst));
  assert.ok(handlerTest?.reasons?.some((reason) => reason.kind === "sibling_test" && reason.targetPath === "apps/web/src/server/newsletter-macro-handler.ts"), JSON.stringify(routeContext.readFirst));
  assert.ok(!routePaths.includes("apps/web/src/server/macro-cleanup-handler.ts"), JSON.stringify(routePaths));

  const handlerContext = codemapContext({ cwd: root, target: "apps/web/src/server/newsletter-macro-handler.ts", limit: 4 });
  assert.ok(handlerContext.readFirst.find((item) => item.path === "apps/web/src/app/api/newsletter/macro/route.ts")?.reasons?.some((reason) => reason.kind === "implementation_pair"), JSON.stringify(handlerContext.readFirst));
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

