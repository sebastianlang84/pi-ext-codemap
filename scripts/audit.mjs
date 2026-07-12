#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];
let packInfo;

function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`✗ ${name}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function npmPackInfo() {
  if (!packInfo) packInfo = JSON.parse(run("npm", ["pack", "--dry-run", "--json"]))[0];
  return packInfo;
}

function forbiddenLocalArtifact(file) {
  return /(^|\/)\.env($|\.)|\.sqlite(?:-wal|-shm)?$|private[-_]?key|secret/i.test(file);
}

function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

check("runtime dependencies stay explicit and minimal", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dependencies = Object.keys(pkg.dependencies ?? {}).sort();
  const allowed = ["typebox"];
  const unexpected = dependencies.filter((name) => !allowed.includes(name));
  if (unexpected.length > 0) throw new Error(`unexpected dependencies: ${unexpected.join(", ")}`);
  for (const name of allowed) {
    if (!dependencies.includes(name)) throw new Error(`missing runtime dependency: ${name}`);
  }
});

check("production JavaScript build completes", () => {
  run("npm", ["run", "build"]);
});

check("committed dist/ matches a fresh build", () => {
  // bin points at tracked dist/ so `npm i -g github:…` works without a prepare step; the build above
  // just regenerated it. Any drift here means src/ changed without the rebuilt dist being committed.
  run("git", ["diff", "--exit-code", "--", "dist"]);
});

check("Pi extension entries exist and import", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const entries = pkg.pi?.extensions ?? [];
  for (const entry of entries) {
    const path = join(root, entry);
    if (!existsSync(path)) throw new Error(`missing extension entry ${entry}`);
    run(process.execPath, ["--experimental-strip-types", "-e", `await import(${JSON.stringify(pathToFileURL(path).href)})`]);
  }
});

check("adapter and application import boundaries stay one-way", () => {
  const adapterDirs = ["cli", "mcp", "pi-extension"];
  for (const adapter of adapterDirs) {
    for (const file of sourceFiles(join(root, "src", adapter))) {
      const source = readFileSync(file, "utf8");
      if (/from\s+["'][^"']*\.\.\/core\//.test(source)) {
        throw new Error(`${file} bypasses src/application`);
      }
      for (const other of adapterDirs.filter((name) => name !== adapter)) {
        if (source.includes(`../${other}/`)) throw new Error(`${file} imports adapter ${other}`);
      }
    }
  }
  for (const file of sourceFiles(join(root, "src", "core"))) {
    const source = readFileSync(file, "utf8");
    if (source.includes("../application/") || adapterDirs.some((name) => source.includes(`../${name}/`))) {
      throw new Error(`${file} imports an outer layer`);
    }
  }
});

check("tracked files do not include local indexes, env files, or obvious private keys", () => {
  const files = run("git", ["ls-files"]).split(/\r?\n/).filter(Boolean);
  const forbidden = files.filter(forbiddenLocalArtifact);
  if (forbidden.length > 0) throw new Error(forbidden.join(", "));
});

check("package contents do not include local indexes, env files, or obvious private keys", () => {
  const files = (npmPackInfo().files ?? []).map((file) => file.path).filter(Boolean);
  const forbidden = files.filter(forbiddenLocalArtifact);
  if (forbidden.length > 0) throw new Error(forbidden.join(", "));
});

check("published package contains built bins without test or benchmark payloads", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const packageFiles = npmPackInfo().files ?? [];
  const files = new Set(packageFiles.map((file) => file.path).filter(Boolean));
  for (const bin of Object.values(pkg.bin ?? {})) {
    if (!files.has(bin)) throw new Error(`missing built bin ${bin}`);
    const entry = packageFiles.find((file) => file.path === bin);
    if (typeof entry?.mode !== "number" || (entry.mode & 0o111) === 0) throw new Error(`built bin is not executable: ${bin}`);
  }
  for (const required of [...(pkg.pi?.extensions ?? []), "migrations/001_init.sql", "migrations/002_fts.sql", "migrations/003_graph.sql"]) {
    if (!files.has(required.replace(/^\.\//, ""))) throw new Error(`missing runtime package file ${required}`);
  }
  const unwanted = [...files].filter((file) => file.startsWith("tests/") || file.startsWith("scripts/bench-") || file.startsWith("scripts/eval-"));
  if (unwanted.length > 0) throw new Error(`unwanted package files: ${unwanted.join(", ")}`);
  const version = run(process.execPath, [join(root, pkg.bin.codemap), "--version"]);
  if (version !== pkg.version) throw new Error(`compiled CLI reports ${version}, expected ${pkg.version}`);
});

check("compiled CLI and MCP artifacts run against packaged runtime assets", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codemap-dist-audit-"));
  const repo = join(tempRoot, "repo");
  const stateDir = join(tempRoot, "state");
  try {
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "artifact.ts"), "export const packagedArtifactNeedle = true;\n");
    const init = spawnSync("git", ["init"], { cwd: repo, encoding: "utf8" });
    if (init.status !== 0) throw new Error(init.stderr || "git init failed");

    const cli = join(root, "dist", "cli", "bin.js");
    const index = spawnSync(process.execPath, [cli, "index", "--approve", "--state-dir", stateDir], { cwd: repo, encoding: "utf8" });
    if (index.status !== 0) throw new Error(index.stderr || "compiled CLI index failed");
    const search = spawnSync(process.execPath, [cli, "search", "packagedArtifactNeedle", "--state-dir", stateDir], { cwd: repo, encoding: "utf8" });
    if (search.status !== 0 || !search.stdout.includes("src/artifact.ts")) throw new Error(search.stderr || search.stdout || "compiled CLI search failed");

    const request = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`;
    const mcp = spawnSync(process.execPath, [join(root, "dist", "mcp", "bin.js")], { cwd: repo, input: request, encoding: "utf8" });
    if (mcp.status !== 0) throw new Error(mcp.stderr || "compiled MCP initialize failed");
    const response = JSON.parse(mcp.stdout.trim());
    if (response.result?.serverInfo?.name !== "codemap") throw new Error("compiled MCP returned an invalid initialize response");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

check("typecheck", () => {
  run("npm", ["run", "typecheck", "--", "--pretty", "false"]);
});

check("tests", () => {
  run("npm", ["test"]);
});

if (failures.length > 0) {
  console.error("\nLightweight audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\nLightweight audit passed.");
