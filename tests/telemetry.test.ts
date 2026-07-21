import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { codeMapIndex, codeMapSearch } = await import("../src/application/operations.ts");
const { pruneState, rotateUsageLogIfOverCap, USAGE_LOG_MAX_BYTES } = await import("../src/core/state-gc.ts");

interface UsageEvent {
  v: number;
  command: string;
  adapter: string;
  outcome: string;
  latency_ms: number;
  tool_version: string;
  repo_root?: string;
  repo_key?: string;
  query?: string;
  result_count?: number;
  results?: Array<{ path: string; score: number; kind: string; language: string }>;
}

function tempRepo(t: { after(fn: () => void): void }): { root: string; stateDir: string } {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-telemetry-repo-"));
  const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-telemetry-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "widget.ts"), "export function renderWidget() {\n  return \"ok\";\n}\n");
  return { root, stateDir };
}

function readEvents(stateDir: string): UsageEvent[] {
  return readFileSync(join(stateDir, "usage.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as UsageEvent);
}

test("a search appends a well-formed usage event with trimmed impressions", (t) => {
  const { root, stateDir } = tempRepo(t);
  codeMapIndex(root, { approveRepo: true, stateDir });
  codeMapSearch(root, { query: "renderWidget", stateDir });

  const events = readEvents(stateDir);
  const search = events.find((event) => event.command === "search");
  assert.ok(search, "expected a search event");
  assert.equal(search.v, 1);
  assert.equal(search.outcome, "ok");
  assert.equal(search.query, "renderWidget");
  assert.equal(typeof search.latency_ms, "number");
  assert.match(search.tool_version, /^\d+\.\d+\.\d+/);
  assert.equal(search.repo_root, root);
  assert.equal(typeof search.repo_key, "string");
  assert.ok(Array.isArray(search.results) && search.results.length > 0, "expected impressions");
  const impression = search.results[0];
  assert.deepEqual(Object.keys(impression).sort(), ["kind", "language", "path", "score"]);
  // No snippets in impressions — the path is the join key.
  assert.equal((impression as Record<string, unknown>).snippet, undefined);
  assert.equal(impression.path, "src/widget.ts");
});

test("the adapter tag reflects the calling surface, defaulting to unknown", (t) => {
  const { root, stateDir } = tempRepo(t);
  codeMapIndex(root, { approveRepo: true, stateDir }, "cli");
  codeMapSearch(root, { query: "renderWidget", stateDir }, "mcp");
  codeMapSearch(root, { query: "renderWidget", stateDir }); // omitted → unknown

  const events = readEvents(stateDir);
  assert.equal(events.find((event) => event.command === "index")?.adapter, "cli");
  const searches = events.filter((event) => event.command === "search");
  assert.deepEqual(searches.map((event) => event.adapter), ["mcp", "unknown"]);
});

test("a zero-result search records outcome empty", (t) => {
  const { root, stateDir } = tempRepo(t);
  codeMapIndex(root, { approveRepo: true, stateDir });
  codeMapSearch(root, { query: "zzz_no_such_symbol_zzz", stateDir });

  const search = readEvents(stateDir).find((event) => event.command === "search" && event.query === "zzz_no_such_symbol_zzz");
  assert.ok(search);
  assert.equal(search.outcome, "empty");
  assert.deepEqual(search.results, []);
});

test("a not-approved search records outcome not_approved and re-throws unchanged", (t) => {
  const { root, stateDir } = tempRepo(t);
  // No index/approve: the gate must throw with its stable code and its human message intact.
  assert.throws(() => codeMapSearch(root, { query: "renderWidget", stateDir }), /Repository is not approved/);

  const search = readEvents(stateDir).find((event) => event.command === "search");
  assert.ok(search);
  assert.equal(search.outcome, "not_approved");
  assert.equal(search.repo_root, root);
});

test("a telemetry write failure never changes the command result", (t) => {
  const { root, stateDir } = tempRepo(t);
  codeMapIndex(root, { approveRepo: true, stateDir });
  // Replace usage.jsonl with a directory so every append throws (EISDIR) — the command must be immune.
  rmSync(join(stateDir, "usage.jsonl"), { force: true });
  mkdirSync(join(stateDir, "usage.jsonl"));

  const pkg = codeMapSearch(root, { query: "renderWidget", stateDir });
  assert.equal(pkg.results[0]?.path, "src/widget.ts", "search result is unaffected by a broken log");
});

test("rotateUsageLogIfOverCap rotates only past the cap and never throws", (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-telemetry-cap-"));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const logPath = join(stateDir, "usage.jsonl");

  assert.equal(rotateUsageLogIfOverCap(logPath, 50), false, "missing log → no rotation, no throw");
  writeFileSync(logPath, "x".repeat(40));
  assert.equal(rotateUsageLogIfOverCap(logPath, 50), false, "under cap → no rotation");
  writeFileSync(logPath, "x".repeat(120));
  assert.equal(rotateUsageLogIfOverCap(logPath, 50), true, "over cap → rotate");
  assert.equal(statSync(`${logPath}.1`).size, 120);
  assert.throws(() => statSync(logPath), "current log was rotated away");
});

test("appendEvent self-rotates the log once it exceeds the production cap", (t) => {
  const { root, stateDir } = tempRepo(t);
  codeMapIndex(root, { approveRepo: true, stateDir });
  const logPath = join(stateDir, "usage.jsonl");
  // Sparse file instantly over the 32 MB cap without writing 32 MB.
  truncateSync(logPath, USAGE_LOG_MAX_BYTES + 1);

  codeMapSearch(root, { query: "renderWidget", stateDir });

  assert.equal(statSync(`${logPath}.1`).size, USAGE_LOG_MAX_BYTES + 1, "oversized log rotated to .1");
  assert.ok(statSync(logPath).size < USAGE_LOG_MAX_BYTES, "fresh log holds only the new event");
});

test("rotation past the cap moves the log to .1 and reports reclaimed bytes", (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), "pi-codemap-telemetry-rot-"));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const logPath = join(stateDir, "usage.jsonl");
  writeFileSync(logPath, "x".repeat(120));
  writeFileSync(`${logPath}.1`, "old".repeat(10)); // 30 bytes reclaimed when overwritten

  const plan = pruneState({ stateDir, maxUsageLogBytes: 50 });
  assert.equal(plan.usageLog.overCap, true);
  assert.equal(plan.usageLog.rotated, false, "dry-run plan does not rotate");
  assert.equal(plan.usageLog.reclaimedBytes, 30);

  const applied = pruneState({ stateDir, apply: true, maxUsageLogBytes: 50 });
  assert.equal(applied.usageLog.rotated, true);
  assert.equal(statSync(`${logPath}.1`).size, 120, "current log became .1");
  assert.throws(() => statSync(logPath), "current log was rotated away");

  // Sanity: the production cap is 32 MB.
  assert.equal(USAGE_LOG_MAX_BYTES, 32 * 1024 * 1024);
});
