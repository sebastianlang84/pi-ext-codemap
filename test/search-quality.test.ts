import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test, { after, type TestContext } from "node:test";

const storageHome = mkdtempSync(join(tmpdir(), "pi-codemap-quality-home-"));
process.env.HOME = storageHome;
process.env.USERPROFILE = storageHome;
after(() => rmSync(storageHome, { recursive: true, force: true }));

const { indexRepo } = await import("../src/core/indexer.ts");
const { searchCodeMap } = await import("../src/core/search.ts");

interface GroundTruthHit {
  name: string;
  path: string;
  language: string;
  kind: string;
}

interface QueryCase {
  query: string;
  expectedPath: string;
}

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
  const specs = [
    { language: "typescript", kind: "function", pattern: "function $NAME($$$) { $$$ }", globs: ["*.ts", "*.tsx"] },
    { language: "typescript", kind: "class", pattern: "class $NAME { $$$ }", globs: ["*.ts", "*.tsx"] },
    { language: "typescript", kind: "const-arrow", pattern: "const $NAME = ($$$) => $$$", globs: ["*.ts", "*.tsx"] },
    { language: "python", kind: "function", pattern: "def $NAME($$$): $$$", globs: ["*.py"] },
  ];
  const hits: GroundTruthHit[] = [];
  for (const spec of specs) {
    const args = ["run", "--pattern", spec.pattern, "--lang", spec.language, "--json=compact", ...spec.globs.flatMap((glob) => ["--globs", glob]), root];
    const raw = execFileSync("ast-grep", args, { encoding: "utf8" }).trim();
    const rows = raw ? JSON.parse(raw) as Array<{ file: string; metaVariables?: { single?: Record<string, { text: string }> } }> : [];
    for (const row of rows) {
      const name = row.metaVariables?.single?.NAME?.text;
      if (!name) continue;
      hits.push({ name, path: relative(root, row.file).split("\\").join("/"), language: spec.language, kind: spec.kind });
    }
  }
  return hits;
}

function scoreCases(root: string, cases: QueryCase[]) {
  let top1 = 0;
  let recall5 = 0;
  let reciprocalRankSum = 0;
  const misses: Array<{ query: string; expectedPath: string; actual: string[] }> = [];

  for (const item of cases) {
    const results = searchCodeMap({ cwd: root, query: item.query, limit: 5 });
    const paths = results.map((result) => result.path);
    const rank = paths.findIndex((path) => path === item.expectedPath);
    if (rank === 0) top1++;
    if (rank >= 0) {
      recall5++;
      reciprocalRankSum += 1 / (rank + 1);
    } else {
      misses.push({ query: item.query, expectedPath: item.expectedPath, actual: paths });
    }
  }

  return {
    cases: cases.length,
    top1Accuracy: top1 / cases.length,
    recallAt5: recall5 / cases.length,
    mrrAt5: reciprocalRankSum / cases.length,
    misses,
  };
}

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
