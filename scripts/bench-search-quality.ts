#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";
import { indexRepo } from "../src/core/indexer.ts";
import { getRepoInfo } from "../src/core/repo.ts";
import { searchCodeMap } from "../src/core/search.ts";
import {
  evaluateSearchQualityGate,
  scoreSearchQualityCases,
  type SearchQualityCase,
  type SearchQualityGateIssue,
  type SearchQualityMetrics,
  type SearchQualityThresholds,
} from "../src/core/search-quality-metrics.ts";

interface GroundTruthHit {
  name: string;
  path: string;
  language: string;
  kind: string;
}

interface RepoReport {
  root: string;
  indexed: ReturnType<typeof indexRepo>;
  astGrepAvailable: boolean;
  astGrepSymbols: number;
  structural: Metrics;
  natural: Metrics;
}

interface ParsedArgs {
  roots: string[];
  thresholds: SearchQualityThresholds;
  gateEnabled: boolean;
  fixtureRepos: boolean;
  localRepos: boolean;
}

type SearchCase = SearchQualityCase;
type Metrics = SearchQualityMetrics;

const localRepoRoots = [
  "/home/wasti/macrolens",
  "/home/wasti/ai_stack/services/newsletter-writer",
  "/home/wasti/dev/autoresearch",
];
const fixtureRoots = [
  fileURLToPath(new URL("../test/fixtures/search-quality/agent-nav", import.meta.url)),
];
const ignoredStructuralNames = new Set(["main", "run"]);

const parsed = parseArgs(process.argv.slice(2));
const roots = resolveBenchmarkRoots(parsed);
if (roots.length === 0) {
  console.error("No benchmark repository roots found. Use --fixtures, --local-repos, or pass explicit repo roots.");
  process.exit(2);
}

const astGrepAvailable = hasAstGrep();
const reports: RepoReport[] = [];
for (const rootArg of roots) {
  const root = resolve(rootArg);
  const info = getRepoInfo(root);
  const pathPrefix = relative(info.root, root).split("\\").join("/");
  const indexed = indexRepo({ cwd: root, approve: true, pathPrefix });
  const symbols = astGrepAvailable ? astGrepSymbols(root, indexed.root).slice(0, 50) : [];
  const structuralCases = groupedSymbolCases(symbols);
  const naturalCases = naturalCasesFor(root, indexed.root);
  reports.push({
    root,
    indexed,
    astGrepAvailable,
    astGrepSymbols: symbols.length,
    structural: scoreCases(root, structuralCases, pathPrefix),
    natural: scoreCases(root, naturalCases, pathPrefix),
  });
}

const gate = evaluateReports(reports, parsed.thresholds);
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), thresholds: parsed.thresholds, reports, gate }, null, 2));
if (parsed.gateEnabled && !gate.passed) process.exitCode = 1;

function parseArgs(args: string[]): ParsedArgs {
  const roots: string[] = [];
  const thresholds: SearchQualityThresholds = {};
  let gateEnabled = false;
  let fixtureRepos = false;
  let localRepos = false;
  const applyDefaultGate = () => {
    thresholds.minTop1Accuracy ??= 0.6;
    thresholds.minRecallAt5 ??= 1;
    thresholds.minMrrAt5 ??= 0.85;
    thresholds.failOnMisses ??= true;
    thresholds.failOnExcludedHits ??= true;
    thresholds.requireCases ??= true;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [name, inlineValue] = arg.split("=", 2);
    const value = inlineValue ?? args[i + 1];
    if (arg === "--quality-gate") {
      gateEnabled = true;
      applyDefaultGate();
    } else if (arg === "--fixtures") {
      fixtureRepos = true;
    } else if (arg === "--local-repos") {
      localRepos = true;
    } else if (name === "--min-top1") {
      thresholds.minTop1Accuracy = parseRateArg(name, value);
      thresholds.requireCases ??= true;
      if (inlineValue === undefined) i++;
      gateEnabled = true;
    } else if (name === "--min-recall-at-5") {
      thresholds.minRecallAt5 = parseRateArg(name, value);
      thresholds.requireCases ??= true;
      if (inlineValue === undefined) i++;
      gateEnabled = true;
    } else if (name === "--min-coverage-at-5") {
      thresholds.minExpectedCoverageAt5 = parseRateArg(name, value);
      thresholds.requireCases ??= true;
      if (inlineValue === undefined) i++;
      gateEnabled = true;
    } else if (name === "--min-mrr-at-5") {
      thresholds.minMrrAt5 = parseRateArg(name, value);
      thresholds.requireCases ??= true;
      if (inlineValue === undefined) i++;
      gateEnabled = true;
    } else if (name === "--max-p95-ms") {
      thresholds.maxP95LatencyMs = parseNonNegativeArg(name, value);
      thresholds.requireCases ??= true;
      if (inlineValue === undefined) i++;
      gateEnabled = true;
    } else if (arg === "--fail-on-misses") {
      thresholds.failOnMisses = true;
      thresholds.requireCases ??= true;
      gateEnabled = true;
    } else if (arg === "--fail-on-partial-misses") {
      thresholds.failOnPartialMisses = true;
      thresholds.requireCases ??= true;
      gateEnabled = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      roots.push(arg);
    }
  }
  if (fixtureRepos && localRepos) throw new Error("Use either --fixtures or --local-repos, not both");
  return { roots, thresholds, gateEnabled, fixtureRepos, localRepos };
}

function resolveBenchmarkRoots(parsed: ParsedArgs): string[] {
  if (parsed.roots.length > 0) return parsed.roots;
  if (parsed.localRepos) return localRepoRoots.filter(existsSync);
  return fixtureRoots.filter(existsSync);
}

function parseNumberArg(name: string, value: string | undefined): number {
  if (value === undefined || value.trim() === "") throw new Error(`${name} requires a numeric value`);
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) throw new Error(`${name} requires a numeric value`);
  return parsedValue;
}

function parseRateArg(name: string, value: string | undefined): number {
  const parsedValue = parseNumberArg(name, value);
  if (parsedValue < 0 || parsedValue > 1) throw new Error(`${name} must be between 0 and 1`);
  return parsedValue;
}

function parseNonNegativeArg(name: string, value: string | undefined): number {
  const parsedValue = parseNumberArg(name, value);
  if (parsedValue < 0) throw new Error(`${name} must be non-negative`);
  return parsedValue;
}

function evaluateReports(reports: RepoReport[], thresholds: SearchQualityThresholds): { passed: boolean; issues: SearchQualityGateIssue[] } {
  const metricThresholds = { ...thresholds, requireCases: false };
  const issues = reports.flatMap((report) => {
    const reportIssues = [
      ...evaluateSearchQualityGate(report.structural, metricThresholds, `${report.root}:structural`).issues,
      ...evaluateSearchQualityGate(report.natural, metricThresholds, `${report.root}:natural`).issues,
    ];
    if (thresholds.requireCases === true && report.structural.cases + report.natural.cases === 0) {
      reportIssues.push({ label: report.root, metric: "cases", expected: "> 0", actual: 0 });
    }
    return reportIssues;
  });
  return { passed: issues.length === 0, issues };
}

function hasAstGrep(): boolean {
  try {
    execFileSync("ast-grep", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function astGrepSymbols(searchRoot: string, indexRoot: string): GroundTruthHit[] {
  const specs = [
    { language: "typescript", kind: "function", pattern: "function $NAME($$$) { $$$ }", globs: ["*.ts", "*.tsx"] },
    { language: "typescript", kind: "class", pattern: "class $NAME { $$$ }", globs: ["*.ts", "*.tsx"] },
    { language: "typescript", kind: "const-arrow", pattern: "const $NAME = ($$$) => $$$", globs: ["*.ts", "*.tsx"] },
    { language: "javascript", kind: "function", pattern: "function $NAME($$$) { $$$ }", globs: ["*.js", "*.jsx", "*.mjs", "*.cjs"] },
    { language: "python", kind: "function", pattern: "def $NAME($$$): $$$", globs: ["*.py"] },
  ];
  const hits: GroundTruthHit[] = [];
  for (const spec of specs) {
    try {
      const args = ["run", "--pattern", spec.pattern, "--lang", spec.language, "--json=compact", ...spec.globs.flatMap((glob) => ["--globs", glob]), searchRoot];
      const raw = execFileSync("ast-grep", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim();
      const rows = raw ? JSON.parse(raw) as Array<{ file: string; metaVariables?: { single?: Record<string, { text: string }> } }> : [];
      for (const row of rows) {
        const name = row.metaVariables?.single?.NAME?.text;
        if (!name) continue;
        hits.push({ name, path: relative(indexRoot, row.file).split("\\").join("/"), language: spec.language, kind: spec.kind });
      }
    } catch {
      // Some repos/languages may not parse cleanly; keep the benchmark best-effort.
    }
  }
  return dedupeHits(hits);
}

function naturalCasesFor(searchRoot: string, indexRoot: string): SearchCase[] {
  const root = searchRoot;
  const lower = searchRoot.toLowerCase();
  const toIndexedPath = (path: string) => relative(indexRoot, `${searchRoot}/${path}`).split("\\").join("/");
  const toCases = (items: Array<{ query: string; expectedPath?: string; expectedPaths?: string[]; excludedPaths?: string[] }>) => items
    .map((item) => ({
      query: item.query,
      expectedPaths: item.expectedPaths ?? (item.expectedPath ? [item.expectedPath] : []),
      excludedPaths: item.excludedPaths,
    }))
    .map((item) => ({
      ...item,
      expectedPaths: item.expectedPaths.filter((path) => existsSync(`${root}/${path}`)).map(toIndexedPath),
      excludedPaths: item.excludedPaths?.filter((path) => existsSync(`${root}/${path}`)).map(toIndexedPath),
    }))
    .filter((item) => item.expectedPaths.length > 0);
  const generic = genericRepoShapeCases(root, toCases);
  if (lower.includes("search-quality/agent-nav")) {
    return [...generic, ...toCases([
      { query: "GET api newsletter macro snapshot endpoint", expectedPath: "apps/web/src/app/api/newsletter/macro/route.ts", excludedPaths: ["dist/index.js", "dist/bundle.js"] },
      { query: "newsletterMacroSnapshotTtlMs config key", expectedPath: "config/newsletter-macro.json", excludedPaths: ["package-lock.json"] },
      { query: "ERR_NEWSLETTER_SNAPSHOT_STALE macro snapshot stale error", expectedPath: "src/newsletter-snapshot.ts", excludedPaths: ["package-lock.json", "dist/index.js", "dist/bundle.js"] },
    ])];
  }
  if (lower.includes("macrolens")) {
    return [...generic, ...toCases([
      { query: "declarative macro signal rules thresholds inputs", expectedPath: "apps/web/src/lib/macro-signal-rules.ts" },
      { query: "derived RSI consensus divergences history", expectedPath: "apps/web/src/lib/series-analysis.ts" },
      { query: "GET api newsletter macro snapshot endpoint", expectedPath: "apps/web/src/app/api/newsletter/macro/route.ts" },
      { query: "MacroLens newsletter macro data integration plan", expectedPath: "docs/plans/20260502-newsletter-macro-data-integration.md" },
    ])];
  }
  if (lower.includes("newsletter")) {
    return [...generic, ...toCases([
      { query: "optional MacroLens context GET api newsletter macro", expectedPath: "src/newsletter_writer/macrolens.py" },
      { query: "freshness gate evaluation matrix aggregator", expectedPath: "src/newsletter_writer/aggregator.py" },
      { query: "telegram delivery log host lock", expectedPath: "src/newsletter_writer/delivery.py" },
      { query: "audit revise newsletter risk tracker draft", expectedPath: "src/newsletter_writer/auditor.py" },
      { query: "orchestrator run newsletter pipeline", expectedPath: "src/newsletter_writer/main.py" },
    ])];
  }
  if (lower.includes("autoresearch")) {
    return [...generic, ...toCases([
      { query: "what is this project about?", expectedPath: "README.md" },
      { query: "where are agent instructions?", expectedPath: "program.md" },
      { query: "what file should the agent edit?", expectedPaths: ["README.md", "program.md", "train.py"] },
      { query: "what should not be modified?", expectedPaths: ["README.md", "prepare.py"] },
      { query: "where is the main implementation?", expectedPath: "train.py" },
      { query: "where is validation metric computed?", expectedPath: "prepare.py" },
      { query: "where is validation metric used?", expectedPath: "train.py" },
      { query: "where is model architecture defined?", expectedPath: "train.py" },
      { query: "where is data preparation?", expectedPath: "prepare.py" },
      { query: "where are dependencies declared?", expectedPath: "pyproject.toml" },
    ])];
  }
  return generic;
}

function genericRepoShapeCases(
  root: string,
  toCases: (items: Array<{ query: string; expectedPath?: string; expectedPaths?: string[]; excludedPaths?: string[] }>) => SearchCase[],
): SearchCase[] {
  const firstExisting = (paths: string[]) => paths.find((path) => existsSync(`${root}/${path}`));
  const generatedCandidates = ["dist/index.js", "dist/bundle.js", "build/index.js", "build/bundle.js"];
  const lockfileCandidates = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"];
  const entrypoint = firstExisting(["src/index.ts", "src/index.tsx", "src/index.js", "index.ts", "index.js", "main.py", "train.py"]);
  const testFile = firstExisting(["tests/index.test.ts", "test/index.test.ts", "src/index.test.ts", "tests/test_main.py", "test_main.py"]);
  const docFile = firstExisting(["README.md", "docs/index.md", "docs/README.md", "docs/architecture.md"]);

  return toCases([
    ...(entrypoint ? [{ query: entrypoint, expectedPath: entrypoint, excludedPaths: generatedCandidates }] : []),
    ...(testFile ? [{ query: testFile, expectedPath: testFile }] : []),
    ...(docFile ? [{ query: docFile, expectedPath: docFile }] : []),
    ...(existsSync(`${root}/package.json`) ? [{ query: "package.json dependencies", expectedPath: "package.json", excludedPaths: lockfileCandidates }] : []),
  ]);
}

function scoreCases(root: string, cases: SearchCase[], pathPrefix = ""): Metrics {
  return scoreSearchQualityCases(cases, (query) => searchCodeMap({ cwd: root, query, limit: 5, pathPrefix }).map((result) => result.path));
}

function groupedSymbolCases(hits: GroundTruthHit[]): SearchCase[] {
  const byName = new Map<string, Set<string>>();
  for (const hit of hits) {
    if (ignoredStructuralNames.has(hit.name)) continue;
    const paths = byName.get(hit.name) ?? new Set<string>();
    paths.add(hit.path);
    byName.set(hit.name, paths);
  }
  return [...byName.entries()].map(([query, paths]) => ({ query, expectedPaths: [...paths] }));
}

function dedupeHits(hits: GroundTruthHit[]): GroundTruthHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.name}:${hit.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
