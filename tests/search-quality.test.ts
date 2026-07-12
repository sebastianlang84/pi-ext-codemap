import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test, { type TestContext } from "node:test";

import { useIsolatedHome } from "./helpers/repo-fixture.ts";

// Routes through the shared isolator so state resolution (which also honors CODEMAP_HOME /
// XDG_DATA_HOME) cannot escape into real CodeMap state when those vars are set in the environment.
useIsolatedHome("pi-codemap-quality-home-");

const { indexRepo } = await import("../src/core/indexer.ts");
const { searchCodeMap } = await import("../src/core/search.ts");
const { evaluateSearchQualityGate, scoreSearchQualityCases } = await import("../src/core/search-quality-metrics.ts");

interface GroundTruthHit {
  name: string;
  path: string;
  language: string;
  kind: string;
}

interface AstGrepGroundTruthSpec {
  language: "typescript" | "python";
  kind: string;
  pattern: string;
  globs: string[];
}

interface QueryCase {
  query: string;
  expectedPath: string;
}

const astGrepGroundTruthSpecs: AstGrepGroundTruthSpec[] = [
  { language: "typescript", kind: "function", pattern: "function $NAME($$$) { $$$ }", globs: ["*.ts", "*.tsx"] },
  { language: "typescript", kind: "class", pattern: "class $NAME { $$$ }", globs: ["*.ts", "*.tsx"] },
  { language: "typescript", kind: "const-arrow", pattern: "const $NAME = ($$$) => $$$", globs: ["*.ts", "*.tsx"] },
  { language: "typescript", kind: "const-arrow", pattern: "const $NAME = async ($$$) => $$$", globs: ["*.ts", "*.tsx"] },
  { language: "typescript", kind: "const-arrow", pattern: "const $NAME: $$$ = ($$$) => $$$", globs: ["*.ts", "*.tsx"] },
  { language: "typescript", kind: "const-arrow", pattern: "const $NAME: $$$ = async ($$$) => $$$", globs: ["*.ts", "*.tsx"] },
  { language: "typescript", kind: "const-arrow", pattern: "const $NAME = <$T>($$$) => $$$", globs: ["*.ts", "*.tsx"] },
  { language: "python", kind: "function", pattern: "def $NAME($$$): $$$", globs: ["*.py"] },
  { language: "python", kind: "class", pattern: "class $NAME: $$$", globs: ["*.py"] },
];

function astGrepAvailable(): boolean {
  try {
    execFileSync("ast-grep", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function qualityFixtureRepo(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-quality-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });

  mkdirSync(join(root, "src", "core"), { recursive: true });
  mkdirSync(join(root, "src", "features"), { recursive: true });
  mkdirSync(join(root, "services", "newsletter"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, "src", "core", "repo-approval.ts"), `
export class RepoRegistry {
  approve(root: string) {
    return { root, enabled: true };
  }
}

export function approveRepo(root: string) {
  return new RepoRegistry().approve(root);
}

export const getRepoInfo = (cwd: string) => ({ cwd, approved: true });
`);

  writeFileSync(join(root, "src", "core", "ignore-policy.ts"), `
export function shouldSkipFile(path: string) {
  return path.includes("node_modules") || path.includes(".env") || path.includes("private-key");
}

export function explainSecretLikeFile(path: string) {
  return ` + "`skip secret-like file ${path}`" + `;
}
`);

  writeFileSync(join(root, "src", "features", "macrolens-panel.tsx"), `
export class MacroLensPanel {
  renderRiskTrend() {
    return "macro lens risk trend";
  }
}

export function rankSearchResults(score: number) {
  return score + 42;
}
`);

  writeFileSync(join(root, "services", "newsletter", "digest.py"), `
def render_digest(items):
    return "daily market digest"

def send_telegram_newsletter(message):
    return message
`);

  writeFileSync(join(root, "docs", "indexing.md"), `
# CodeMap indexing quality

Repository approval is stored locally before indexing starts.
Search ranking combines path matches, full text matches, and symbol boosts.
The scanner explains skipped secret-like files and generated directories.
`);

  indexRepo({ cwd: root, approve: true });
  return root;
}

function astGrepSymbols(root: string): GroundTruthHit[] {
  const hits: GroundTruthHit[] = [];
  for (const spec of astGrepGroundTruthSpecs) {
    try {
      const args = ["run", "--pattern", spec.pattern, "--lang", spec.language, "--json=compact", ...spec.globs.flatMap((glob) => ["--globs", glob]), root];
      const raw = execFileSync("ast-grep", args, { encoding: "utf8" }).trim();
      const rows = raw ? JSON.parse(raw) as Array<{ file: string; metaVariables?: { single?: Record<string, { text: string }> } }> : [];
      for (const row of rows) {
        const name = row.metaVariables?.single?.NAME?.text;
        if (!name) continue;
        hits.push({ name, path: relative(root, row.file).split("\\").join("/"), language: spec.language, kind: spec.kind });
      }
    } catch {
      // Some patterns legitimately have no matches in a fixture.
    }
  }
  return hits;
}

function scoreCases(root: string, cases: QueryCase[]) {
  return scoreSearchQualityCases(
    cases.map((item) => ({ query: item.query, expectedPaths: [item.expectedPath] })),
    (query) => searchCodeMap({ cwd: root, query, limit: 5 }).map((result) => result.path),
  );
}

test("search quality metrics report top1, recall, MRR, misses, and partial misses", () => {
  let tick = 0;
  const metrics = scoreSearchQualityCases([
    { query: "exact", expectedPaths: ["a.ts"] },
    { query: "second", expectedPaths: ["b.ts"] },
    { query: "partial", expectedPaths: ["c.ts", "d.ts"] },
    { query: "miss", expectedPaths: ["z.ts"] },
  ], (query) => ({
    exact: ["a.ts", "noise.ts"],
    second: ["noise.ts", "b.ts"],
    partial: ["c.ts", "other.ts"],
    miss: ["x.ts"],
  }[query] ?? []), () => tick++);

  assert.equal(metrics.cases, 4);
  assert.equal(metrics.top1Accuracy, 0.5);
  assert.equal(metrics.recallAt5, 0.75);
  assert.equal(metrics.expectedCoverageAt5, 0.625);
  assert.equal(metrics.mrrAt5, 0.625);
  assert.equal(metrics.avgLatencyMs, 1);
  assert.equal(metrics.p95LatencyMs, 1);
  assert.deepEqual(metrics.misses, [{ query: "miss", expectedPaths: ["z.ts"], actual: ["x.ts"] }]);
  assert.deepEqual(metrics.partialMisses, [
    { query: "partial", expectedPaths: ["c.ts", "d.ts"], missingExpectedPaths: ["d.ts"], actual: ["c.ts", "other.ts"] },
    { query: "miss", expectedPaths: ["z.ts"], missingExpectedPaths: ["z.ts"], actual: ["x.ts"] },
  ]);
});

test("search quality metrics can fail gates on excluded noise hits", () => {
  const metrics = scoreSearchQualityCases([
    { query: "dependencies", expectedPaths: ["package.json"], excludedPaths: ["package-lock.json"] },
  ], () => ["package-lock.json", "package.json"]);

  assert.deepEqual(metrics.excludedHits, [{ query: "dependencies", excludedPaths: ["package-lock.json"], actual: ["package-lock.json", "package.json"] }]);
  assert.deepEqual(evaluateSearchQualityGate(metrics, { failOnExcludedHits: true }, "noise").issues, [
    { label: "noise", metric: "excludedHits", expected: "0", actual: 1 },
  ]);
});

test("search quality metrics reject cases without expected paths", () => {
  assert.throws(
    () => scoreSearchQualityCases([{ query: "empty", expectedPaths: [] }], () => []),
    /no expected paths: empty/,
  );
});

test("search quality gates report threshold failures", () => {
  const gate = evaluateSearchQualityGate({
    cases: 2,
    top1Accuracy: 0.5,
    recallAt5: 1,
    expectedCoverageAt5: 0.75,
    mrrAt5: 0.75,
    avgLatencyMs: 12,
    p95LatencyMs: 42,
    misses: [],
    partialMisses: [{ query: "partial", expectedPaths: ["a.ts", "b.ts"], missingExpectedPaths: ["b.ts"], actual: ["a.ts"] }],
  }, {
    minTop1Accuracy: 0.8,
    minExpectedCoverageAt5: 1,
    maxP95LatencyMs: 25,
    failOnPartialMisses: true,
  }, "fixture");

  assert.equal(gate.passed, false);
  assert.deepEqual(evaluateSearchQualityGate({
    cases: 0,
    top1Accuracy: 0,
    recallAt5: 0,
    expectedCoverageAt5: 0,
    mrrAt5: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
    misses: [],
    partialMisses: [],
  }, { requireCases: true }, "empty").issues, [
    { label: "empty", metric: "cases", expected: "> 0", actual: 0 },
  ]);
  assert.deepEqual(gate.issues.map((issue) => [issue.label, issue.metric, issue.expected, issue.actual]), [
    ["fixture", "top1Accuracy", ">= 0.8", 0.5],
    ["fixture", "expectedCoverageAt5", ">= 1", 0.75],
    ["fixture", "p95LatencyMs", "<= 25", 42],
    ["fixture", "partialMisses", "0", 1],
  ]);
});

test("bench search-quality fixture gate uses checked-in fixtures", () => {
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "scripts/bench-search-quality.ts", "--quality-gate", "--fixtures"], { encoding: "utf8" });
  const report = JSON.parse(output) as { gate: { passed: boolean }; reports: Array<{ root: string; natural: { cases: number; excludedHits?: unknown[] }; structural: { cases: number } }> };

  assert.equal(report.gate.passed, true);
  assert.equal(report.reports.length, 1);
  assert.ok(report.reports[0]?.root.endsWith("tests/fixtures/search-quality/agent-nav"), report.reports[0]?.root);
  assert.ok(report.reports[0]?.natural.cases >= 9, JSON.stringify(report.reports[0]?.natural));
  assert.deepEqual(report.reports[0]?.natural.excludedHits, []);
});

test("bench search-quality gate includes generic repo-shape regression cases", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-codemap-bench-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });

  writeFileSync(join(root, "src", "index.ts"), "export const appEntrypoint = 'main implementation entrypoint generated bundle noise';\n");
  writeFileSync(join(root, "tests", "index.test.ts"), "test('entrypoint behavior', () => appEntrypoint);\n");
  writeFileSync(join(root, "docs", "index.md"), "# Entrypoint documentation\n\nRelated tests and docs describe the app entrypoint.\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "quality-fixture", dependencies: { typebox: "1.0.0" } }, null, 2));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "quality-fixture", packages: {} }, null, 2));
  writeFileSync(join(root, "dist", "index.js"), "console.log('main implementation entrypoint generated bundle noise');\n");

  const output = execFileSync(process.execPath, ["--experimental-strip-types", "scripts/bench-search-quality.ts", "--quality-gate", root], { encoding: "utf8" });
  const report = JSON.parse(output) as { gate: { passed: boolean }; reports: Array<{ natural: { cases: number; excludedHits?: unknown[] } }> };
  assert.equal(report.gate.passed, true);
  assert.ok(report.reports[0]?.natural.cases >= 4, JSON.stringify(report.reports[0]?.natural));
  assert.deepEqual(report.reports[0]?.natural.excludedHits, []);
});

test("CodeMap search quality is quantifiable against ast-grep structural ground truth", { skip: !astGrepAvailable() && "ast-grep CLI is not installed" }, (t) => {
  const root = qualityFixtureRepo(t);
  const symbols = astGrepSymbols(root);
  assert.ok(symbols.length >= 7, "fixture should expose enough ast-grep ground-truth symbols");

  const cases = symbols.map((symbol) => ({ query: symbol.name, expectedPath: symbol.path }));
  const metrics = scoreCases(root, cases);

  assert.deepEqual(metrics.misses, []);
  assert.equal(metrics.recallAt5, 1);
  assert.ok(metrics.mrrAt5 >= 0.9, JSON.stringify(metrics));
  assert.ok(metrics.top1Accuracy >= 0.85, JSON.stringify(metrics));
});

test("CodeMap quality metrics can include natural-language repository questions", (t) => {
  const root = qualityFixtureRepo(t);
  const metrics = scoreCases(root, [
    { query: "repo approval local indexing", expectedPath: "docs/indexing.md" },
    { query: "secret-like file generated directories", expectedPath: "docs/indexing.md" },
    { query: "macro lens risk trend", expectedPath: "src/features/macrolens-panel.tsx" },
    { query: "daily market digest telegram newsletter", expectedPath: "services/newsletter/digest.py" },
    { query: "rank search results symbol boosts", expectedPath: "docs/indexing.md" },
  ]);

  assert.deepEqual(metrics.misses, []);
  assert.ok(metrics.top1Accuracy >= 0.6, JSON.stringify(metrics));
  assert.equal(metrics.recallAt5, 1);
});
