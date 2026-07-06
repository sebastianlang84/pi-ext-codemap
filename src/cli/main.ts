import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { codemapContext } from "../core/context.ts";
import { indexRepo, status } from "../core/indexer.ts";
import { searchCodeMapWithDiagnostics } from "../core/search.ts";
import type { StateOptions } from "../core/repo.ts";

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
  --state-dir <path>     Index/registry location (default: ~/.pi/agent/state/codemap)
  --json                 Emit machine-readable JSON
  --version, --help

Notes:
  Indexing is local-only and never leaves your machine. First index needs --approve.
  Staleness is advisory; refresh with 'codemap index' when it matters.
  Indexes and the approval registry live under ~/.pi/agent/state/codemap (override with
  --state-dir); prune indexes for repos that no longer exist with 'npm run gc:state'.`;

function packageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
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

function resolveRepoCwd(cwd: string, repo?: string): string {
  if (!repo) return cwd;
  const target = isAbsolute(repo) ? repo : resolve(cwd, repo);
  if (!existsSync(target)) throw new Error(`--repo path does not exist: ${target}`);
  return statSync(target).isDirectory() ? target : dirname(target);
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
  const stateOptions: StateOptions = { stateDir: parsed.stateDir };
  const result = status(resolveRepoCwd(cwd, parsed.repo), { health: parsed.full ? "full" : "cheap", pathPrefix: parsed.pathPrefix, ...stateOptions });
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
  const stateOptions: StateOptions = { stateDir: parsed.stateDir };
  const result = indexRepo({ cwd: resolveRepoCwd(cwd, parsed.repo), approve: parsed.approve, pathPrefix: parsed.pathPrefix, ...stateOptions });
  if (parsed.json) return ok(JSON.stringify(result, null, 2));
  const warnings = result.warnings.length > 0 ? `\n${result.warnings.map((w) => `(!) ${w}`).join("\n")}` : "";
  return ok(`Indexed ${result.indexed}/${result.scanned} files (${result.skipped} skipped, ${result.removed} removed)${warnings}`);
}

function runSearch(parsed: ParsedArgs, cwd: string): CliResult {
  const query = parsed.positionals.join(" ").trim();
  if (!query) return fail("search needs a query, e.g. codemap search auth middleware", 2);
  const stateOptions: StateOptions = { stateDir: parsed.stateDir };
  const pkg = searchCodeMapWithDiagnostics({ query, cwd: resolveRepoCwd(cwd, parsed.repo), limit: parsed.limit, pathPrefix: parsed.pathPrefix, ...stateOptions });
  if (parsed.json) return ok(JSON.stringify(pkg, null, 2));
  const rows = pkg.results.map((r) => `${r.path}:${r.startLine}-${r.endLine} [${r.kind}]`);
  const confidenceNote = pkg.topHitConfidence.level === "low"
    ? "top-hit confidence: low — top result is one of several near-ties; verify before using as a codemap-context target\n"
    : "";
  return ok(`${confidenceNote}${rows.join("\n") || "No results"}${staleNote(pkg)}`);
}

function runContext(parsed: ParsedArgs, cwd: string): CliResult {
  const target = parsed.positionals.join(" ").trim();
  if (!target) return fail("context needs a path or query, e.g. codemap context src/core/search.ts", 2);
  const stateOptions: StateOptions = { stateDir: parsed.stateDir };
  const pkg = codemapContext({ target, cwd: resolveRepoCwd(cwd, parsed.repo), limit: parsed.limit, pathPrefix: parsed.pathPrefix, ...stateOptions });
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
