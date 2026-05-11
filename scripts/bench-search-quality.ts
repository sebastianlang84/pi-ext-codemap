#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { indexRepo } from "../src/core/indexer.ts";
import { getRepoInfo } from "../src/core/repo.ts";
import { searchCodeMap } from "../src/core/search.ts";

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

interface SearchCase {
  query: string;
  expectedPaths: string[];
}

interface Metrics {
  cases: number;
  top1Accuracy: number;
  recallAt5: number;
  expectedCoverageAt5: number;
  mrrAt5: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  misses: Array<{ query: string; expectedPaths: string[]; actual: string[] }>;
  partialMisses: Array<{ query: string; expectedPaths: string[]; missingExpectedPaths: string[]; actual: string[] }>;
}

const defaultRoots = [
  "/home/wasti/macrolens",
  "/home/wasti/ai_stack/services/newsletter-writer",
  "/home/wasti/dev/autoresearch",
];

const roots = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultRoots.filter(existsSync);
if (roots.length === 0) {
  console.error("No repository roots supplied and default macrolens/newsletter-writer paths were not found.");
  process.exit(2);
}

const ignoredStructuralNames = new Set(["main"]);
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

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2));

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
  const toCases = (items: Array<{ query: string; expectedPath?: string; expectedPaths?: string[] }>) => items
    .map((item) => ({ query: item.query, expectedPaths: item.expectedPaths ?? (item.expectedPath ? [item.expectedPath] : []) }))
    .map((item) => ({ ...item, expectedPaths: item.expectedPaths.filter((path) => existsSync(`${root}/${path}`)).map(toIndexedPath) }))
    .filter((item) => item.expectedPaths.length > 0);
  if (lower.includes("macrolens")) {
    return toCases([
      { query: "declarative macro signal rules thresholds inputs", expectedPath: "apps/web/src/lib/macro-signal-rules.ts" },
      { query: "derived RSI consensus divergences history", expectedPath: "apps/web/src/lib/series-analysis.ts" },
      { query: "GET api newsletter macro snapshot endpoint", expectedPath: "apps/web/src/app/api/newsletter/macro/route.ts" },
      { query: "MacroLens newsletter macro data integration plan", expectedPath: "docs/plans/20260502-newsletter-macro-data-integration.md" },
    ]);
  }
  if (lower.includes("newsletter")) {
    return toCases([
      { query: "optional MacroLens context GET api newsletter macro", expectedPath: "src/newsletter_writer/macrolens.py" },
      { query: "freshness gate evaluation matrix aggregator", expectedPath: "src/newsletter_writer/aggregator.py" },
      { query: "telegram delivery log host lock", expectedPath: "src/newsletter_writer/delivery.py" },
      { query: "audit revise newsletter risk tracker draft", expectedPath: "src/newsletter_writer/auditor.py" },
      { query: "orchestrator run newsletter pipeline", expectedPath: "src/newsletter_writer/main.py" },
    ]);
  }
  if (lower.includes("autoresearch")) {
    return toCases([
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
    ]);
  }
  return [];
}

function scoreCases(root: string, cases: SearchCase[], pathPrefix = ""): Metrics {
  if (cases.length === 0) return { cases: 0, top1Accuracy: 0, recallAt5: 0, expectedCoverageAt5: 0, mrrAt5: 0, avgLatencyMs: 0, p95LatencyMs: 0, misses: [], partialMisses: [] };
  let top1 = 0;
  let recall5 = 0;
  let expectedCoverage5 = 0;
  let reciprocalRankSum = 0;
  const latencies: number[] = [];
  const misses: Metrics["misses"] = [];
  const partialMisses: Metrics["partialMisses"] = [];

  for (const item of cases) {
    const start = performance.now();
    const results = searchCodeMap({ cwd: root, query: item.query, limit: 5, pathPrefix });
    latencies.push(performance.now() - start);
    const paths = [...new Set(results.map((result) => result.path))];
    const matchedExpectedPaths = item.expectedPaths.filter((path) => paths.includes(path));
    const missingExpectedPaths = item.expectedPaths.filter((path) => !paths.includes(path));
    expectedCoverage5 += matchedExpectedPaths.length / item.expectedPaths.length;
    const rank = paths.findIndex((path) => item.expectedPaths.includes(path));
    if (rank === 0) top1++;
    if (rank >= 0) {
      recall5++;
      reciprocalRankSum += 1 / (rank + 1);
    } else {
      misses.push({ query: item.query, expectedPaths: item.expectedPaths, actual: paths });
    }
    if (missingExpectedPaths.length > 0) {
      partialMisses.push({ query: item.query, expectedPaths: item.expectedPaths, missingExpectedPaths, actual: paths });
    }
  }

  latencies.sort((a, b) => a - b);
  return {
    cases: cases.length,
    top1Accuracy: round(top1 / cases.length),
    recallAt5: round(recall5 / cases.length),
    expectedCoverageAt5: round(expectedCoverage5 / cases.length),
    mrrAt5: round(reciprocalRankSum / cases.length),
    avgLatencyMs: round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    p95LatencyMs: round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? 0),
    misses,
    partialMisses,
  };
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
