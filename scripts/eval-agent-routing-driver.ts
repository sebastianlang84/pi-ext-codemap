#!/usr/bin/env node
// Live driver for the routing eval (scoring core: eval-agent-routing.ts). Runs a headless Pi agent per
// episode with the CodeMap extension loaded, captures its ordered tool-call transcript from the saved
// session, and scores tool CHOICE (search-first / re-query / anchor discipline).
//
// Why Pi and not Claude Code: CodeMap is a Pi extension, so Pi is the real deployment host and its
// tools are first-class. In the Claude Code CLI here they are *deferred* behind ToolSearch, so the
// agent can't see CodeMap's descriptions until it goes looking — which measures ToolSearch behavior,
// not whether the wording steers routing. Pi presents the tools (and their descriptions) directly.
//
// Two arms, held constant except for the CodeMap tool surface (descriptions + topHitConfidence note):
//   - treatment: this repo's index.ts (search-first wording + low-confidence flag)
//   - baseline : a git worktree at fdfa5e5~1 (pre-"steer agents" metadata), via --baseline-worktree
// `-ne` disables extension discovery so only the arm's `-e` CodeMap loads (no double-registration);
// `-ns -np` drop skills/prompt-templates to cut variance; bash is disabled (read-only, safe): the
// agent's raw-search alternative for scenario A is the grep/find built-ins.
//
// Usage:
//   node --experimental-strip-types scripts/eval-agent-routing-driver.ts \
//     --baseline-worktree <path> [--arm both|treatment|baseline] [--reps N] \
//     [--provider openai-codex] [--model gpt-5.5] [--thinking low|medium|high|xhigh] \
//     [--episodes scripts/eval-agent-routing.episodes.json] [--only <id>] [--timeout 240] \
//     [--transcripts <dir>] [--out <results.json>]

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { indexRepo } from "../src/core/indexer.ts";
import {
  runRoutingEval,
  scoreEpisode,
  type AgentDriver,
  type RoutingEpisode,
  type RoutingScenario,
  type ToolCall,
} from "./eval-agent-routing.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const home = homedir();

// Repo label -> on-disk root. Mirrors the nav eval's suite roots so episode repos resolve identically.
const REPO_ROOTS: Record<string, string> = {
  macrolens: join(home, "dev", "macrolens"),
  "alpha-cycles": join(home, "alpha-cycles"),
  "pi-ext-memory": join(home, ".pi/agent/git/github.com/sebastianlang84/pi-ext-memory"),
  "pi-ext-subagents": join(home, ".pi/agent/git/github.com/sebastianlang84/pi-ext-subagents"),
  "pi-ext-astgrep": join(home, ".pi/agent/git/github.com/sebastianlang84/pi-ext-astgrep"),
};

type Arm = "baseline" | "treatment";

interface Options {
  arms: Arm[];
  reps: number;
  provider: string;
  model: string;
  thinking: string;
  episodesPath: string;
  only?: string;
  timeoutMs: number;
  baselineWorktree?: string;
  transcriptsDir: string;
  outPath?: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    arms: ["treatment", "baseline"],
    reps: 1,
    provider: "openai-codex",
    model: "gpt-5.5",
    thinking: "xhigh",
    episodesPath: join(here, "eval-agent-routing.episodes.json"),
    timeoutMs: 300_000,
    transcriptsDir: join(tmpdir(), `routing-eval-${process.pid}`),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--arm": {
        const value = next();
        opts.arms = value === "both" ? ["treatment", "baseline"] : [value as Arm];
        break;
      }
      case "--reps": opts.reps = Number(next()); break;
      case "--provider": opts.provider = next(); break;
      case "--model": opts.model = next(); break;
      case "--thinking": opts.thinking = next(); break;
      case "--episodes": opts.episodesPath = resolve(next()); break;
      case "--only": opts.only = next(); break;
      case "--timeout": opts.timeoutMs = Number(next()) * 1000; break;
      case "--baseline-worktree": opts.baselineWorktree = resolve(next()); break;
      case "--transcripts": opts.transcriptsDir = resolve(next()); break;
      case "--out": opts.outPath = resolve(next()); break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function extensionEntryFor(arm: Arm, opts: Options): string {
  if (arm === "treatment") return join(repoRoot, "index.ts");
  if (!opts.baselineWorktree) throw new Error("--baseline-worktree is required for the baseline arm");
  const entry = join(opts.baselineWorktree, "index.ts");
  if (!existsSync(entry)) throw new Error(`baseline worktree missing index.ts: ${entry}`);
  return entry;
}

// Pull ordered toolCall parts out of a Pi session .jsonl, in the scorer's tool vocabulary. Pi already
// emits clean names (codemap_search, codemap_context, read, grep, find, ...) so no remapping is needed.
function extractToolCalls(sessionFile: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (event.type !== "message") continue;
    const message = event.message ?? event;
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "toolCall") {
        calls.push({ name: String(part.name), args: (part.arguments ?? {}) as Record<string, unknown> });
      }
    }
  }
  return calls;
}

function makeDriver(arm: Arm, opts: Options): AgentDriver {
  const extensionEntry = extensionEntryFor(arm, opts);
  return async (episode: RoutingEpisode): Promise<ToolCall[]> => {
    const root = REPO_ROOTS[episode.repo];
    if (!root || !existsSync(root)) throw new Error(`repo root missing for ${episode.repo}: ${root}`);
    const sessionDir = join(opts.transcriptsDir, `${arm}--${episode.id}--${Date.now()}`);
    mkdirSync(sessionDir, { recursive: true });
    const result = spawnSync(
      "pi",
      [
        "-p", episode.prompt,
        "-ne", "-e", extensionEntry, // only this arm's CodeMap loads
        "-ns", "-np", // no skills / prompt templates → less variance
        "-xt", "bash", // read-only: grep/find remain as the raw-search alternative
        "--approve",
        "--provider", opts.provider,
        "--model", opts.model,
        "--thinking", opts.thinking,
        "--session-dir", sessionDir,
        "--session-id", "episode",
      ],
      { cwd: root, encoding: "utf8", timeout: opts.timeoutMs, maxBuffer: 64 * 1024 * 1024 },
    );
    const files = readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"));
    if (files.length === 0) {
      throw new Error(`[${arm}/${episode.id}] no session written (status=${result.status}, signal=${result.signal ?? "none"}): ${(result.stderr ?? "").slice(0, 300)}`);
    }
    return extractToolCalls(join(sessionDir, files[0]));
  };
}

function loadEpisodes(opts: Options): RoutingEpisode[] {
  const raw = JSON.parse(readFileSync(opts.episodesPath, "utf8"));
  const episodes: RoutingEpisode[] = raw.episodes;
  return opts.only ? episodes.filter((e) => e.id === opts.only) : episodes;
}

function ensureIndexed(episodes: RoutingEpisode[]): void {
  for (const label of [...new Set(episodes.map((e) => e.repo))]) {
    const root = REPO_ROOTS[label];
    if (!root || !existsSync(root)) throw new Error(`repo root missing for ${label}: ${root}`);
    const stats = indexRepo({ cwd: root, approve: true });
    console.error(`[index] ${label}: ${stats.indexed}/${stats.scanned} files`);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(opts.transcriptsDir, { recursive: true });
  const episodes = loadEpisodes(opts);
  if (episodes.length === 0) throw new Error("no episodes selected");
  ensureIndexed(episodes);

  const armResults: Record<string, Awaited<ReturnType<typeof runRoutingEval>>> = {};
  for (const arm of opts.arms) {
    console.error(`\n=== arm: ${arm} (${episodes.length} episodes x ${opts.reps} reps, ${opts.provider}/${opts.model} thinking=${opts.thinking}) ===`);
    const driver = makeDriver(arm, opts);
    const loggingDriver: AgentDriver = async (episode) => {
      const calls = await driver(episode);
      const score = scoreEpisode(episode, calls);
      console.error(`  [${arm}] ${episode.id} (${episode.scenario}): ${score.pass ? "PASS" : "FAIL"} — ${score.reason}  | ${calls.map((c) => c.name).join(" > ") || "(no tools)"}`);
      return calls;
    };
    armResults[arm] = await runRoutingEval(episodes, loggingDriver, opts.reps);
  }

  const scenarios: RoutingScenario[] = ["A_plain_navigation", "B_seeded_miss", "C_confident_anchor", "D_wrong_top_hit"];
  const both = opts.arms.length === 2;
  console.log("\n=== routing eval: pass-rate by scenario ===");
  console.log(["scenario", ...opts.arms, ...(both ? ["delta(t-b)"] : [])].join("\t"));
  for (const scenario of scenarios) {
    const cells = opts.arms.map((arm) => {
      const bucket = armResults[arm].byScenario[scenario];
      return bucket ? `${(bucket.rate * 100).toFixed(0)}% (${bucket.pass}/${bucket.total})` : "-";
    });
    let deltaCell = "";
    if (both) {
      const t = armResults.treatment.byScenario[scenario]?.rate ?? 0;
      const b = armResults.baseline.byScenario[scenario]?.rate ?? 0;
      deltaCell = `${(t - b) * 100 >= 0 ? "+" : ""}${((t - b) * 100).toFixed(0)}pts`;
    }
    console.log([scenario, ...cells, ...(both ? [deltaCell] : [])].join("\t"));
  }

  const payload = { generatedAt: new Date().toISOString(), provider: opts.provider, model: opts.model, thinking: opts.thinking, reps: opts.reps, episodes: episodes.map((e) => e.id), arms: armResults };
  if (opts.outPath) {
    writeFileSync(opts.outPath, JSON.stringify(payload, null, 2));
    console.error(`\nwrote ${opts.outPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
