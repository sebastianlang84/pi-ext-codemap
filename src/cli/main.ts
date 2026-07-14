import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { codeMapContext, codeMapIndex, codeMapSearch, codeMapStatus } from "../application/operations.ts";

export interface CliResult {
  code: number;
  out: string;
  err: string;
}

interface ParsedArgs {
  json: boolean;
  full: boolean;
  approve: boolean;
  limit?: number;
  pathPrefix?: string;
  repo?: string;
  stateDir?: string;
  positionals: string[];
}

const USAGE = `codemap — local SQLite/FTS repo map for coding agents

Usage:
  codemap search <query> [options]     Find files, symbols, and chunks
  codemap context <path|query> [opts]  Read-first package for a target
  codemap status [options]             Approval / index / staleness
  codemap index [--approve] [options]  Index or refresh the repo (approve once)

Options:
  --repo <path>          Target another repo root/dir/file (default: cwd)
  --path-prefix <dir>    Scope to a subtree, e.g. services/api
  --limit <n>            Max results (search/context)
  --approve              Allow first-time local indexing (index only)
  --full                 Full working-tree stale scan (status only)
  --state-dir <path>     Index/registry location (overrides CODEMAP_HOME/XDG default)
  --json                 Emit machine-readable JSON
  --version, --help

Notes:
  Indexing is local-only and never leaves your machine. First index needs --approve.
  Staleness is advisory; refresh with 'codemap index' when it matters.
  New installs store state under CODEMAP_HOME, XDG_DATA_HOME/codemap, or
  ~/.local/share/codemap. Existing ~/.pi/agent/state/codemap data remains in use until migrated.
  Override with --state-dir; prune deleted-repo indexes with 'npm run gc:state' in a clone.`;

function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const pkgPath of [join(here, "..", "..", "package.json"), join(here, "..", "..", "..", "package.json")]) {
    if (!existsSync(pkgPath)) continue;
    try {
      return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "0.0.0";
    } catch {
      // Keep looking: source and compiled layouts place package.json at different depths.
    }
  }
  return "0.0.0";
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { json: false, full: false, approve: false, positionals: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const key = arg.startsWith("--") && eq !== -1 ? arg.slice(0, eq) : arg;
    const inlineValue = arg.startsWith("--") && eq !== -1 ? arg.slice(eq + 1) : undefined;
    const takeValue = () => inlineValue ?? argv[++i];
    switch (key) {
      case "--json": parsed.json = true; break;
      case "--full": parsed.full = true; break;
      case "--approve": case "--approve-repo": parsed.approve = true; break;
      case "--limit": parsed.limit = Number(takeValue()); break;
      case "--path-prefix": parsed.pathPrefix = takeValue(); break;
      case "--repo": case "--repo-path": parsed.repo = takeValue(); break;
      case "--state-dir": parsed.stateDir = takeValue(); break;
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
        parsed.positionals.push(arg);
    }
  }
  return parsed;
}

function ok(out: string): CliResult {
  return { code: 0, out, err: "" };
}

function fail(err: string, code = 1): CliResult {
  return { code, out: "", err };
}

function staleNote(pkg: { stale: boolean }): string {
  return pkg.stale ? "\n(!) index is stale for this query; run 'codemap index' to refresh" : "";
}

function runStatus(parsed: ParsedArgs, cwd: string): CliResult {
  const result = codeMapStatus(cwd, {
    full: parsed.full,
    repoPath: parsed.repo,
    pathPrefix: parsed.pathPrefix,
    stateDir: parsed.stateDir,
  });
  if (parsed.json) return ok(JSON.stringify(result, null, 2));
  const lines = [
    `readiness: ${result.readiness}`,
    `approved:  ${result.approved}`,
    `indexed:   ${result.indexed} (${result.files} files, ${result.symbols} symbols)`,
    `stale:     ${result.stale}${result.headChanged ? " (Git HEAD changed)" : ""}`,
  ];
  if (result.warnings.length > 0) lines.push(...result.warnings.map((w) => `(!) ${w}`));
  return ok(lines.join("\n"));
}

function runIndex(parsed: ParsedArgs, cwd: string): CliResult {
  const result = codeMapIndex(cwd, {
    approveRepo: parsed.approve,
    repoPath: parsed.repo,
    pathPrefix: parsed.pathPrefix,
    stateDir: parsed.stateDir,
  });
  if (parsed.json) return ok(JSON.stringify(result, null, 2));
  const warnings = result.warnings.length > 0 ? `\n${result.warnings.map((w) => `(!) ${w}`).join("\n")}` : "";
  return ok(`Indexed ${result.indexed}/${result.scanned} files (${result.skipped} skipped, ${result.removed} removed)${warnings}`);
}

function runSearch(parsed: ParsedArgs, cwd: string): CliResult {
  const query = parsed.positionals.join(" ").trim();
  if (!query) return fail("search needs a query, e.g. codemap search auth middleware", 2);
  const pkg = codeMapSearch(cwd, {
    query,
    repoPath: parsed.repo,
    limit: parsed.limit,
    pathPrefix: parsed.pathPrefix,
    stateDir: parsed.stateDir,
  });
  if (parsed.json) return ok(JSON.stringify(pkg, null, 2));
  const rows = pkg.results.map((r) => {
    const loc = r.startLine === r.endLine ? `${r.startLine}` : `${r.startLine}-${r.endLine}`;
    const snippet = r.snippet.split("\n")[0].trim();
    const snippetPart = snippet ? ` ${snippet}` : "";
    return `${r.path}:${loc} [${r.kind}]${snippetPart} — ${r.score}`;
  });
  const confidenceNote = pkg.topHitConfidence.level === "low"
    ? "top-hit confidence: low — top result is one of several near-ties; verify before using as a codemap-context target\n"
    : "";
  return ok(`${confidenceNote}${rows.join("\n") || "No results"}${staleNote(pkg)}`);
}

function runContext(parsed: ParsedArgs, cwd: string): CliResult {
  const target = parsed.positionals.join(" ").trim();
  if (!target) return fail("context needs a path or query, e.g. codemap context src/core/search.ts", 2);
  const pkg = codeMapContext(cwd, {
    target,
    repoPath: parsed.repo,
    limit: parsed.limit,
    pathPrefix: parsed.pathPrefix,
    stateDir: parsed.stateDir,
  });
  if (parsed.json) return ok(JSON.stringify(pkg, null, 2));
  const rows = pkg.readFirst.map((item) => {
    const reasons = item.reasons && item.reasons.length > 0 ? ` (${item.reasons.map((reason) => reason.kind).join(", ")})` : "";
    return `${item.path}:${item.startLine}-${item.endLine} [${item.kind}]${reasons}`;
  });
  const tail: string[] = [];
  if (pkg.relatedTests.length > 0) tail.push(`tests: ${pkg.relatedTests.join(", ")}`);
  if (pkg.relatedDocs.length > 0) tail.push(`docs: ${pkg.relatedDocs.join(", ")}`);
  return ok([rows.join("\n") || "No read-first items", ...tail].join("\n") + staleNote(pkg));
}

/** Pure CLI entrypoint: returns exit code and captured output instead of writing/exiting, so it is testable. */
export function runCli(argv: string[], io: { cwd?: string } = {}): CliResult {
  const cwd = io.cwd ?? process.cwd();
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") return ok(USAGE);
  if (command === "--version" || command === "-v" || command === "version") return ok(packageVersion());

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(rest);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 2);
  }

  try {
    switch (command) {
      case "status": return runStatus(parsed, cwd);
      case "index": return runIndex(parsed, cwd);
      case "search": return runSearch(parsed, cwd);
      case "context": return runContext(parsed, cwd);
      default: return fail(`Unknown command: ${command}\n\n${USAGE}`, 2);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 1);
  }
}
