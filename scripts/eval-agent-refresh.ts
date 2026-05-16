#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface ParsedArgs {
  prompt: "baseline" | "hint" | "all";
  runs: number;
  piBin: string;
  model?: string;
  provider?: string;
  thinking?: string;
  timeoutMs: number;
  keepTemp: boolean;
  strict: boolean;
  json: boolean;
  help: boolean;
}

interface ScenarioResult {
  scenario: string;
  run: number;
  repo: string;
  tempRoot: string;
  tempKept: boolean;
  prompt: string;
  exitCode: number | null;
  error?: string;
  toolCalls: string[];
  staleSeen: boolean;
  indexCalled: boolean;
  searchedAfterIndex: boolean;
  finalMentionsPath: boolean;
  forbiddenToolCalled: boolean;
  passed: boolean;
  finalAnswer: string;
  stderr: string;
}

const originalHome = homedir();
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensionPath = join(repoRoot, "index.ts");
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const { indexRepo } = await import("../src/core/indexer.ts");
const allowedToolNames = new Set(["codemap_status", "codemap_index", "codemap_search"]);

const scenarios = args.prompt === "all" ? ["baseline", "hint"] as const : [args.prompt];
const results: ScenarioResult[] = [];
for (const scenario of scenarios) {
  for (let run = 1; run <= args.runs; run++) {
    results.push(runScenario(scenario, run, args));
  }
}

if (args.json) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results, summary: summarize(results) }, null, 2));
} else {
  printSummary(results);
}

if (args.strict && results.some((result) => !result.passed)) process.exitCode = 1;

function runScenario(scenario: "baseline" | "hint", run: number, options: ParsedArgs): ScenarioResult {
  const fixture = createStaleCalculatorFixture(options.keepTemp);
  const prompt = scenarioPrompt(scenario);
  const child = spawnSync(options.piBin, piArgs(prompt, options), {
    cwd: fixture.repo,
    env: childEnv(fixture.home),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeoutMs,
  });
  const parsed = parsePiJsonEvents(child.stdout ?? "");
  const toolCalls = parsed.toolCalls;
  const indexPosition = toolCalls.indexOf("codemap_index");
  const result: ScenarioResult = {
    scenario,
    run,
    repo: fixture.repo,
    tempRoot: fixture.tempRoot,
    tempKept: options.keepTemp,
    prompt,
    exitCode: child.status,
    error: child.error?.message,
    toolCalls,
    staleSeen: parsed.staleSeen,
    indexCalled: indexPosition >= 0,
    searchedAfterIndex: indexPosition >= 0 && toolCalls.slice(indexPosition + 1).includes("codemap_search"),
    finalMentionsPath: /src\/calculator\.ts/.test(parsed.finalAnswer),
    forbiddenToolCalled: toolCalls.some((name) => !allowedToolNames.has(name)),
    passed: false,
    finalAnswer: parsed.finalAnswer.trim(),
    stderr: (child.stderr ?? "").trim(),
  };
  result.passed = child.status === 0
    && !result.error
    && result.staleSeen
    && result.indexCalled
    && result.searchedAfterIndex
    && result.finalMentionsPath
    && !result.forbiddenToolCalled;
  if (!options.keepTemp) rmSync(fixture.tempRoot, { recursive: true, force: true });
  return result;
}

function createStaleCalculatorFixture(keepTemp: boolean): { tempRoot: string; home: string; repo: string } {
  const tempRoot = mkdtempSync(join(tmpdir(), "pi-codemap-agent-refresh-"));
  const home = join(tempRoot, "home");
  const repo = join(tempRoot, "calculator-cli");
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(home, { recursive: true });
  spawnSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "calculator-cli", type: "module", scripts: { start: "node src/calculator.ts" } }, null, 2));
  writeFileSync(join(repo, "README.md"), "# Calculator CLI\n\nTiny calculator fixture for CodeMap stale-index agent eval.\n");
  writeFileSync(join(repo, "src", "calculator.ts"), `
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`);

  withCodeMapHome(home, () => indexRepo({ cwd: repo, approve: true }));

  writeFileSync(join(repo, "src", "calculator.ts"), `
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function percentOf(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}
`);

  if (keepTemp) console.error(`Kept fixture repo: ${repo}`);
  return { tempRoot, home, repo };
}

function withCodeMapHome<T>(home: string, fn: () => T): T {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return fn();
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
  }
}

function piArgs(prompt: string, options: ParsedArgs): string[] {
  const values = [
    "--mode", "json",
    "--no-session",
    "--no-context-files",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-extensions",
    "-e", extensionPath,
    "--tools", "codemap_status,codemap_index,codemap_search",
  ];
  if (options.provider) values.push("--provider", options.provider);
  if (options.model) values.push("--model", options.model);
  if (options.thinking) values.push("--thinking", options.thinking);
  values.push(prompt);
  return values;
}

function childEnv(codeMapHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: codeMapHome,
    USERPROFILE: codeMapHome,
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR ?? join(originalHome, ".pi", "agent"),
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
  };
}

function scenarioPrompt(scenario: "baseline" | "hint"): string {
  if (scenario === "baseline") {
    return "Where is percentOf implemented in this repository? Use CodeMap to answer. Reply with the file path and a short reason.";
  }
  return "Use CodeMap to answer. If CodeMap reports a stale index, changed files, missing files, deleted files, or stale warnings, refresh with codemap_index and then search again. Where is percentOf implemented in this repository? Reply with the file path and a short reason.";
}

function parsePiJsonEvents(stdout: string): { toolCalls: string[]; staleSeen: boolean; finalAnswer: string } {
  const toolCalls: string[] = [];
  let staleSeen = false;
  let finalAnswer = "";
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "tool_execution_start" && typeof event.toolName === "string") toolCalls.push(event.toolName);
    if (event.type === "tool_execution_end" && containsStaleSignal(event.result)) staleSeen = true;
    if ((event.type === "message_end" || event.type === "turn_end") && event.message?.role === "assistant") {
      const text = extractText(event.message);
      if (text.trim()) finalAnswer = text;
    }
  }
  return { toolCalls, staleSeen, finalAnswer };
}

function containsStaleSignal(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return /Index stale|stale|changed files|missing files|deleted files/i.test(value);
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsStaleSignal);
  const record = value as Record<string, unknown>;
  if (record.stale === true) return true;
  if (typeof record.changed === "number" && record.changed > 0) return true;
  if (typeof record.missing === "number" && record.missing > 0) return true;
  if (typeof record.deleted === "number" && record.deleted > 0) return true;
  return Object.values(record).some(containsStaleSignal);
}

function extractText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractText).join("\n");
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const direct = typeof record.text === "string" ? record.text : "";
  return [direct, extractText(record.content)].filter(Boolean).join("\n");
}

function parseArgs(raw: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    prompt: "all",
    runs: 1,
    piBin: "pi",
    timeoutMs: 180_000,
    keepTemp: false,
    strict: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    const [name, inline] = arg.split("=", 2);
    const value = inline ?? raw[i + 1];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (name === "--prompt") {
      if (value !== "baseline" && value !== "hint" && value !== "all") throw new Error("--prompt must be baseline, hint, or all");
      parsed.prompt = value;
      if (inline === undefined) i++;
    } else if (name === "--runs") {
      parsed.runs = positiveInteger(name, value);
      if (inline === undefined) i++;
    } else if (name === "--pi-bin") {
      parsed.piBin = requiredValue(name, value);
      if (inline === undefined) i++;
    } else if (name === "--model") {
      parsed.model = requiredValue(name, value);
      if (inline === undefined) i++;
    } else if (name === "--provider") {
      parsed.provider = requiredValue(name, value);
      if (inline === undefined) i++;
    } else if (name === "--thinking") {
      parsed.thinking = requiredValue(name, value);
      if (inline === undefined) i++;
    } else if (name === "--timeout-ms") {
      parsed.timeoutMs = positiveInteger(name, value);
      if (inline === undefined) i++;
    } else if (arg === "--keep-temp") parsed.keepTemp = true;
    else if (arg === "--strict") parsed.strict = true;
    else if (arg === "--json") parsed.json = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return parsed;
}

function requiredValue(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function positiveInteger(name: string, value: string | undefined): number {
  const number = Number(requiredValue(name, value));
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
}

function summarize(results: ScenarioResult[]) {
  const passed = results.filter((result) => result.passed).length;
  return { passed, total: results.length, passRate: results.length === 0 ? 0 : passed / results.length };
}

function printSummary(results: ScenarioResult[]): void {
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`${status} ${result.scenario}#${result.run}`);
    console.log(`  tools: ${result.toolCalls.join(" -> ") || "none"}`);
    console.log(`  staleSeen=${result.staleSeen} indexCalled=${result.indexCalled} searchedAfterIndex=${result.searchedAfterIndex} finalMentionsPath=${result.finalMentionsPath} forbiddenToolCalled=${result.forbiddenToolCalled}`);
    if (result.error) console.log(`  error: ${result.error}`);
    if (result.exitCode !== 0) console.log(`  exitCode: ${result.exitCode}`);
    if (result.finalAnswer) console.log(`  answer: ${result.finalAnswer.replace(/\s+/g, " ").slice(0, 240)}`);
    if (result.stderr) console.log(`  stderr: ${result.stderr.split(/\r?\n/).slice(-3).join(" | ")}`);
    if (result.repo && result.tempRoot) console.log(`  repo: ${result.repo}${result.tempKept ? "" : " (removed; use --keep-temp to inspect)"}`);
  }
  const summary = summarize(results);
  console.log(`Summary: ${summary.passed}/${summary.total} passed (${Math.round(summary.passRate * 100)}%)`);
}

function printHelp(): void {
  console.log(`Usage: npm run eval:agent-refresh -- [options]

Creates a temporary calculator Git repo, indexes it with CodeMap, changes src/calculator.ts to make the index stale, then runs pi --mode json with only CodeMap tools and evaluates whether the agent refreshes before answering.

Options:
  --prompt baseline|hint|all   Scenario(s) to run (default: all)
  --runs N                     Runs per scenario (default: 1)
  --model MODEL                Pass --model to pi
  --provider PROVIDER          Pass --provider to pi
  --thinking LEVEL             Pass --thinking to pi
  --pi-bin PATH                pi binary (default: pi)
  --timeout-ms N               Per-run timeout (default: 180000)
  --json                       Print machine-readable JSON summary
  --strict                     Exit non-zero if any selected run fails
  --keep-temp                  Keep fixture repos for debugging
  -h, --help                   Show this help
`);
}
