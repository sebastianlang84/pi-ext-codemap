import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { useIsolatedHome } from "./helpers/repo-fixture.ts";

useIsolatedHome();

const { indexRepo } = await import("../src/core/indexer.ts");
const { mergeSearchContextReadPlan } = await import("../src/core/navigation-read-plan.ts");
const { searchCodeMap } = await import("../src/core/search.ts");
const { codemapContext } = await import("../src/core/context.ts");

test("natural provider outage requests keep provider implementations in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-provider-outage-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "lib", "providers"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib", "__tests__"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "types"), { recursive: true });
  mkdirSync(join(root, "docs", "plans"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "src", "lib", "dashboard-pipeline.ts"), `
import { deriveMacroSignals } from "./macro-derivations";
import { appendMarginDebtDerivedSeries } from "./margin-debt-derivations";
import { fetchFredSeries } from "./providers/fred";
import { fetchYahooSeries } from "./providers/yahoo";
import type { MacroSeries } from "../types/macro";

export interface ProviderDiagnostics {
  source: "fred" | "yahoo";
  seriesCount: number;
  withDataCount: number;
  errorCount: number;
}

export function summarizeProviderDiagnostics(series: MacroSeries[]): ProviderDiagnostics[] {
  return ["fred", "yahoo"].map((source) => ({
    source: source as "fred" | "yahoo",
    seriesCount: series.filter((item) => item.source === source).length,
    withDataCount: series.filter((item) => item.source === source && item.points.length > 0).length,
    errorCount: series.filter((item) => item.source === source && item.error).length,
  }));
}

export function dashboardProviderNoDataDiagnosticsShouldKeepFredAndYahooSeriesWhenOneMarketSourceIsEmpty(series: MacroSeries[]) {
  return summarizeProviderDiagnostics(series);
}

export async function runDashboardPipeline() {
  const series = appendMarginDebtDerivedSeries([
    await fetchFredSeries(),
    await fetchYahooSeries(),
  ]);
  return { diagnostics: dashboardProviderNoDataDiagnosticsShouldKeepFredAndYahooSeriesWhenOneMarketSourceIsEmpty(series), signals: deriveMacroSignals(series) };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "providers", "fred.ts"), `
export async function fetchFredSeries() {
  return { source: "fred", points: [], error: "FRED provider has no data" };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "providers", "yahoo.ts"), `
export async function fetchYahooSeries() {
  return { source: "yahoo", points: [], error: "Yahoo market source is empty" };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "macro-derivations.ts"), `
export function deriveMacroSignals(series: unknown[]) { return series.length; }
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "margin-debt-derivations.ts"), `
export function appendMarginDebtDerivedSeries(series: unknown[]) { return series; }
`);
  writeFileSync(join(root, "apps", "web", "src", "types", "macro.ts"), `
export interface MacroSeries { source: "fred" | "yahoo"; points: unknown[]; error?: string; }
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "__tests__", "dashboard-pipeline.test.ts"), `
import { summarizeProviderDiagnostics } from "../dashboard-pipeline";

test("keeps provider no data diagnostics for partial outages", () => {
  expect(summarizeProviderDiagnostics([{ source: "fred", points: [], error: "missing" }, { source: "yahoo", points: [1] }])).toHaveLength(2);
});
`);
  writeFileSync(join(root, "docs", "plans", "macro-data-integration.md"), `
# Newsletter macro data integration

Dashboard provider no data diagnostics should remain visible in newsletter plans.
`);
  indexRepo({ cwd: root, approve: true });

  const query = "dashboard provider no data diagnostics should keep FRED and Yahoo series when one market source is empty";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "apps/web/src/lib/dashboard-pipeline.ts",
    "apps/web/src/lib/__tests__/dashboard-pipeline.test.ts",
    "apps/web/src/lib/providers/fred.ts",
    "apps/web/src/lib/providers/yahoo.ts",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural handoff preload requests keep implementation, test, and active ADRs in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-handoff-preload-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "test", "pi-extension"), { recursive: true });
  mkdirSync(join(root, "docs", "adr"), { recursive: true });
  mkdirSync(join(root, "docs", "archive", "plans"), { recursive: true });

  writeFileSync(join(root, "src", "pi-extension", "retrieval.ts"), `
import { findLatestHandoffForTurn } from "./handoffs";

export function formatLatestHandoffLines(latestHandoff: { isFallback: boolean }) {
  return [\`Latest active handoff\${latestHandoff.isFallback ? " (fallback; do not overwrite unless explicit)" : ""}:\`];
}

export function buildTurnMemoryMessage() {
  const latestHandoff = findLatestHandoffForTurn();
  return formatLatestHandoffLines(latestHandoff);
}
`);
  writeFileSync(join(root, "src", "pi-extension", "handoffs.ts"), `
export function findLatestHandoffForTurn() {
  return { isFallback: true };
}
`);
  writeFileSync(join(root, "test", "pi-extension", "retrieval.test.ts"), `
import { buildTurnMemoryMessage } from "../../src/pi-extension/retrieval";

test("findLatestHandoffForTurn prefers exact session handoff before repo fallback", () => {
  expect(buildTurnMemoryMessage()).toContain("Latest active handoff");
});

test("fallback handoff preload warns agents not to overwrite it", () => {
  expect(buildTurnMemoryMessage()).toContain("fallback; do not overwrite unless explicit");
});
`);
  writeFileSync(join(root, "docs", "adr", "005-simplified-agent-facing-scopes.md"), `
# ADR 005 — Simplified agent-facing memory scopes

Use only global, repo, and session as normal agent-facing scopes. Session is short-lived handoff and current-run context; repo is durable repository context.
`);
  writeFileSync(join(root, "docs", "adr", "006-normal-and-advanced-tool-surface.md"), `
# ADR 006 — Normal and Advanced Tool Surface

The simplified scope model favors fewer normal paths: use global, repo, and session. The normal tool surface includes memory_list for active todos and handoffs and memory_save_handoff for explicit handoff writes.
`);
  writeFileSync(join(root, "docs", "adr", "007-memory-model-minimisation.md"), `
# ADR 007 — Memory model minimisation

### Handoff count warning

memory_save_handoff warns when several active handoffs already exist in the same repo.
`);
  writeFileSync(join(root, "docs", "archive", "plans", "memory-model-minimisation.md"), `
# Archived memory model minimisation plan

### Handoff count warning

Archived plan text about active handoff warnings should not displace current implementation, tests, and ADRs.
`);
  indexRepo({ cwd: root, approve: true });

  const query = "active handoff preload should prefer current session before repo fallback and warn not to overwrite fallback handoffs";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "src/pi-extension/retrieval.ts",
    "test/pi-extension/retrieval.test.ts",
    "docs/adr/005-simplified-agent-facing-scopes.md",
    "docs/adr/006-normal-and-advanced-tool-surface.md",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural FastAPI run trigger requests keep compose deployment config in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-fastapi-compose-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "api"), { recursive: true });
  mkdirSync(join(root, "ui"), { recursive: true });

  writeFileSync(join(root, "api", "app.py"), `
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="fourier-cycles-api")

class TriggerRequest(BaseModel):
    confirm: bool = False

@app.post("/api/run")
def trigger_run(request: TriggerRequest):
    if not request.confirm:
        raise HTTPException(status_code=400, detail="set confirm=true to trigger a run")
    raise HTTPException(status_code=409, detail="run already in progress")
`);
  writeFileSync(join(root, "docker-compose.webapp.yml"), `
services:
  fourier-cycles-api:
    build:
      context: .
      dockerfile: api/Dockerfile
    environment:
      FOURIER_TRIGGER_MAX_RUNTIME_SECONDS: "5400"
`);
  writeFileSync(join(root, "PRD_webapp.md"), `
# Fourier Cycles Web App

Phase 2 includes POST /api/run as a controlled FastAPI trigger endpoint.
`);
  writeFileSync(join(root, "README.md"), "# Fourier cycles\n\nFastAPI run trigger docs.\n");
  writeFileSync(join(root, "requirements.txt"), "fastapi\npydantic\n");
  writeFileSync(join(root, "ui", "tsconfig.app.json"), JSON.stringify({ compilerOptions: {} }, null, 2));
  indexRepo({ cwd: root, approve: true });

  const query = "FastAPI confirm true run already in progress";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of ["api/app.py", "docker-compose.webapp.yml", "PRD_webapp.md"]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural reviewer context scout requests keep plan, benchmark, and fixtures in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-reviewer-scout-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "docs", "plans"), { recursive: true });
  mkdirSync(join(root, "docs", "benchmarks"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });

  writeFileSync(join(root, "docs", "plans", "reviewer-context-scout.md"), `
# Reviewer context scout

The reviewer context scout should gather bounded contract and nearby test evidence without scout recursion.
It reads the benchmark fixtures and must not route through fanout reduce plans.
`);
  writeFileSync(join(root, "docs", "benchmarks", "reviewer-context-scout-fixtures.json"), JSON.stringify({ cases: [{ name: "bounded contract evidence", scoutRecursion: false }] }, null, 2));
  writeFileSync(join(root, "tests", "reviewer-context-scout-benchmark.test.mjs"), `
import fixtures from "../docs/benchmarks/reviewer-context-scout-fixtures.json" with { type: "json" };

test("reviewer context scout gathers bounded nearby test evidence without recursion", () => {
  assert.equal(fixtures.cases[0].scoutRecursion, false);
});
`);
  writeFileSync(join(root, "scripts", "score-reviewer-context-scout-benchmark.mjs"), `
import fixtures from "../docs/benchmarks/reviewer-context-scout-fixtures.json" with { type: "json" };
console.log(fixtures.cases.length);
`);
  for (const noisyTest of ["request.test.mjs", "token-injection.test.mjs", "agents.test.mjs", "display.test.mjs"]) {
    writeFileSync(join(root, "tests", noisyTest), `
test("ordinary unrelated test evidence", () => {
  assert.ok(true);
});
`);
  }
  writeFileSync(join(root, "docs", "plans", "fanout-reduce.md"), `
# Fanout reduce

Noisy scout recursion material that should not displace the reviewer context scout plan.
`);
  indexRepo({ cwd: root, approve: true });

  const query = "reviewer context scout should gather bounded contract and nearby test evidence without scout recursion";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "docs/plans/reviewer-context-scout.md",
    "docs/benchmarks/reviewer-context-scout-fixtures.json",
    "tests/reviewer-context-scout-benchmark.test.mjs",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural binary install guidance requests keep README in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-binary-guidance-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src", "ast-grep"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });

  writeFileSync(join(root, "README.md"), `
# ast-grep binary guidance

## Installation

Install ast-grep yourself first:

\`\`\`bash
cargo install ast-grep --locked
brew install ast-grep
npm install -g @ast-grep/cli
\`\`\`

## Binary trust model

The command name sg is ambiguous on Unix-like systems. Some systems provide sg from shadow-utils/newgrp.
This extension validates sg --version and rejects sg unless the version output identifies ast-grep.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| sg exists but is ignored | It is likely not ast-grep; install ast-grep or ensure ast-grep's sg appears first on PATH. |
`);
  writeFileSync(join(root, "src", "ast-grep", "binary-path.ts"), `
export function getCandidatePaths() {
  return ["ast-grep", "sg"];
}

export function findOnPath(baseName: "ast-grep" | "sg") {
  return getCandidatePaths().filter((candidate) => candidate === baseName);
}

export function getBinaryNames(baseName: "ast-grep" | "sg") {
  return [baseName];
}

export function runVersionCommand(binaryPath: string) {
  return binaryPath.includes("sg") ? "sg from shadow utils command" : "ast-grep";
}

export function isAstGrepVersionOutput(output: string) {
  return output.includes("ast-grep");
}

export function validateCandidate(candidate: string) {
  return isAstGrepVersionOutput(runVersionCommand(candidate));
}

export function resolveAstGrepBinaryPath(candidate: string) {
  if (candidate === "sg") throw new Error("ambiguous sg shadow utils command; install ast-grep");
  return candidate;
}
`);
  writeFileSync(join(root, "src", "ast-grep", "cli.ts"), `
import { resolveAstGrepBinaryPath } from "./binary-path";

export const INSTALL_HINT = "Install ast-grep locally with cargo install ast-grep --locked, brew install ast-grep, or npm install -g @ast-grep/cli. The sg command is accepted only when sg --version identifies ast-grep.";

export async function runSg(candidate: string) {
  return resolveAstGrepBinaryPath(candidate) ?? INSTALL_HINT;
}
`);
  writeFileSync(join(root, "src", "ast-grep", "tools.ts"), `
import { resolveAstGrepBinaryPath } from "./binary-path";
export const toolBinary = resolveAstGrepBinaryPath;
`);
  writeFileSync(join(root, "src", "index.ts"), `
export { resolveAstGrepBinaryPath } from "./ast-grep/binary-path";
`);
  writeFileSync(join(root, "test", "binary-path.test.ts"), `
import { resolveAstGrepBinaryPath } from "../src/ast-grep/binary-path";

test("rejects ambiguous sg shadow utils command", () => resolveAstGrepBinaryPath("sg"));
`);
  indexRepo({ cwd: root, approve: true });

  const query = "ast grep binary path should reject ambiguous sg shadow utils command and show install guidance";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of ["src/ast-grep/binary-path.ts", "test/binary-path.test.ts", "src/ast-grep/cli.ts", "README.md"]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural API endpoint requests keep route adapters in the search plus context read plan", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-route-adapter-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib", "__tests__"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "types"), { recursive: true });
  mkdirSync(join(root, "docs", "plans"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "src", paths: { "@/*": ["*"] } } }, null, 2));
  writeFileSync(join(root, "apps", "web", "src", "app", "api", "newsletter", "macro", "route.ts"), `
import { NextResponse } from "next/server";
import { buildNewsletterMacroSnapshot } from "@/lib/newsletter-macro-snapshot";

export async function GET() {
  return NextResponse.json(buildNewsletterMacroSnapshot({ generatedAt: new Date().toISOString(), series: [], warnings: [] }));
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "newsletter-macro-snapshot.ts"), `
import { latestPercentChange } from "@/lib/series-derivations";
import type { DashboardData, MacroSeries } from "@/types/macro";

type NewsletterMacroStatus = "ok" | "stale" | "unavailable" | "error";

const INDICATORS = [
  { key: "ism_manufacturing_pmi", source: "source_decision_needed", warning: "No verified source configured yet." },
  { key: "inflation_yoy", sourceKey: "cpi", derivation: "yoy" },
];

export function buildNewsletterMacroSnapshot(dashboard: DashboardData) {
  const generatedAt = dashboard.generatedAt;
  latestPercentChange([] as MacroSeries["points"], "yoy");
  return { schemaVersion: 1, generatedAt, indicators: INDICATORS, warnings: ["stale unavailable source decision warnings"] };
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "series-derivations.ts"), `
export function latestPercentChange(points: Array<{ date: string; value: number }>, period: "mom" | "qoq" | "yoy") {
  return points.at(-1) ?? null;
}
`);
  writeFileSync(join(root, "apps", "web", "src", "types", "macro.ts"), `
export interface MacroSeries { points: Array<{ date: string; value: number }> }
export interface DashboardData { generatedAt: string; series: MacroSeries[]; warnings: string[] }
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "__tests__", "newsletter-macro-snapshot.test.ts"), `
import { buildNewsletterMacroSnapshot } from "../newsletter-macro-snapshot";

test("surfaces stale unavailable source decision warnings", () => {
  expect(buildNewsletterMacroSnapshot({ generatedAt: "2025-01-01T00:00:00.000Z", series: [], warnings: [] }).warnings).toContain("stale unavailable source decision warnings");
});
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "__tests__", "series-derivations.test.ts"), `
import { latestPercentChange } from "../series-derivations";

test("computes latest percent changes", () => {
  expect(latestPercentChange([{ date: "2025-01-01", value: 1 }], "yoy")).toMatchObject({ value: 1 });
});
`);
  writeFileSync(join(root, "docs", "plans", "newsletter-macro-data-integration.md"), `
# Newsletter Macro Data Integration

The newsletter macro endpoint returns stale and unavailable source-decision warnings for missing indicators.
`);
  indexRepo({ cwd: root, approve: true });

  const targetContext = codemapContext({ cwd: root, target: "apps/web/src/lib/newsletter-macro-snapshot.ts", limit: 5 });
  assert.ok(targetContext.readFirst.some((item) => item.path === "apps/web/src/app/api/newsletter/macro/route.ts"), JSON.stringify(targetContext.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) }))));

  const query = "newsletter macro endpoint should return stale unavailable source decision warnings for missing macro indicators";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "apps/web/src/lib/newsletter-macro-snapshot.ts",
    "apps/web/src/app/api/newsletter/macro/route.ts",
    "apps/web/src/lib/__tests__/newsletter-macro-snapshot.test.ts",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

test("natural catalog endpoint requests keep route adapter, catalog source, and catalog test", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-catalog-endpoint-read-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "apps", "web", "src", "app", "api", "catalog"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "components"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib", "__tests__"), { recursive: true });
  mkdirSync(join(root, "apps", "web", "src", "lib", "providers"), { recursive: true });

  writeFileSync(join(root, "apps", "web", "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "src", paths: { "@/*": ["*"] } } }, null, 2));
  writeFileSync(join(root, "apps", "web", "src", "app", "api", "catalog", "route.ts"), `
import { SERIES_CATALOG } from "@/lib/series-catalog";

export async function GET() {
  return Response.json(SERIES_CATALOG);
}
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "series-catalog.ts"), `
export interface SeriesSpec {
  key: string;
  label: string;
  providerId: string;
  source: "fred" | "yahoo";
}

export const SERIES_CATALOG: SeriesSpec[] = [
  { key: "sp500", label: "Macro dashboard dropdown series", providerId: "DUPLICATE", source: "yahoo" },
  { key: "vix", label: "Macro provider ids duplicate", providerId: "DUPLICATE", source: "yahoo" },
];
`);
  writeFileSync(join(root, "apps", "web", "src", "lib", "__tests__", "series-catalog.test.ts"), `
import { SERIES_CATALOG } from "../series-catalog";

test("provider ids are unique for dashboard dropdown", () => {
  expect(new Set(SERIES_CATALOG.map((series) => series.providerId)).size).toBe(SERIES_CATALOG.length);
});
`);
  for (const provider of ["finra", "fred", "yahoo"]) {
    writeFileSync(join(root, "apps", "web", "src", "lib", "providers", `${provider}.ts`), `
import type { SeriesSpec } from "@/lib/series-catalog";

export function fetch${provider}(series: SeriesSpec) {
  return { providerId: series.providerId, macro: true, dashboard: true, dropdown: "series" };
}
`);
  }
  writeFileSync(join(root, "apps", "web", "src", "components", "dashboard-client.tsx"), `
export function DashboardClient() {
  return <select>{["macro", "provider", "dashboard", "dropdown", "series"].map((item) => <option>{item}</option>)}</select>;
}
`);
  indexRepo({ cwd: root, approve: true });

  const query = "catalog endpoint returns duplicate macro provider ids and dashboard dropdown shows repeated series";
  const searchPaths = searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path);
  const contextResult = codemapContext({ cwd: root, target: searchPaths[0] ?? query, limit: 5 });
  const readPlan = mergeSearchContextReadPlan(searchPaths, contextResult.readFirst, 5);

  for (const expectedPath of [
    "apps/web/src/app/api/catalog/route.ts",
    "apps/web/src/lib/series-catalog.ts",
    "apps/web/src/lib/__tests__/series-catalog.test.ts",
  ]) {
    assert.ok(readPlan.includes(expectedPath), JSON.stringify({ searchPaths, readFirst: contextResult.readFirst.map((item) => ({ path: item.path, reasons: item.reasons?.map((reason) => reason.kind) })), readPlan }));
  }
});

