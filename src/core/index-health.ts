import { openRepoDb } from "./db.ts";
import { readGitHead, readGitWorkingTreeStatus, type GitDirtyFile } from "./git-status.ts";
import { scanRepo } from "./scanner.ts";

export interface IndexStatusCounts {
  indexed: boolean;
  files: number;
  chunks: number;
  symbols: number;
  lastIndexedAt: string | null;
  indexedHead: string | null;
}

export interface IndexHealth {
  stale: boolean;
  changed: number;
  missing: number;
  deleted: number;
  skipped?: number;
  skippedReasons?: Record<string, number>;
  warnings: string[];
  currentHead: string | null;
  headChanged: boolean;
  dirty: boolean;
  dirtyFiles: GitDirtyFile[];
}

export function readIndexStatusCounts(db: ReturnType<typeof openRepoDb>, pathPrefix = ""): IndexStatusCounts {
  const pathFilter = pathPrefix ? `${escapeLike(pathPrefix)}%` : "";
  const files = pathPrefix
    ? (db.prepare("select count(*) as n from files where path like ? escape '\\'").get(pathFilter) as { n: number }).n
    : (db.prepare("select count(*) as n from files").get() as { n: number }).n;
  const chunks = pathPrefix
    ? (db.prepare("select count(*) as n from chunks join files f on f.id = chunks.file_id where f.path like ? escape '\\'").get(pathFilter) as { n: number }).n
    : (db.prepare("select count(*) as n from chunks").get() as { n: number }).n;
  const symbols = pathPrefix
    ? (db.prepare("select count(*) as n from symbols join files f on f.id = symbols.file_id where f.path like ? escape '\\'").get(pathFilter) as { n: number }).n
    : (db.prepare("select count(*) as n from symbols").get() as { n: number }).n;
  const lastIndexedAt = readPathAwareMeta(db, "last_indexed_at", pathPrefix);
  const indexedHead = readPathAwareMeta(db, "indexed_head", pathPrefix);
  return { indexed: files > 0, files, chunks, symbols, lastIndexedAt, indexedHead };
}

export function cheapIndexHealth(db: ReturnType<typeof openRepoDb>, root: string, pathPrefix = ""): IndexHealth {
  const currentHead = readGitHead(root);
  const indexedHead = readPathAwareMeta(db, "indexed_head", pathPrefix);
  const headChanged = Boolean(indexedHead && currentHead && indexedHead !== currentHead);
  const warnings: string[] = [];
  let stale: boolean;
  if (currentHead === null && indexedHead !== null) {
    // HEAD became unreadable after the index was built against a real commit
    stale = true;
    warnings.push("Git HEAD unreadable — index may be stale.");
  } else if (headChanged) {
    stale = true;
    warnings.push("Git HEAD changed since last index.");
  } else if (currentHead !== null && indexedHead === null) {
    // Repo has commits but was never indexed with a HEAD baseline
    stale = true;
    warnings.push("No indexed HEAD baseline — index may be stale.");
  } else {
    stale = false;
  }
  return { stale, changed: 0, missing: 0, deleted: 0, currentHead, headChanged, dirty: false, dirtyFiles: [], warnings };
}

export function fullIndexHealth(db: ReturnType<typeof openRepoDb>, root: string, pathPrefix = ""): IndexHealth {
  const scan = scanRepo(root, { pathPrefix });
  const rows = (pathPrefix
    ? db.prepare("select path, hash from files where path like ? escape '\\'").all(`${escapeLike(pathPrefix)}%`)
    : db.prepare("select path, hash from files").all()) as Array<{ path: string; hash: string }>;
  const indexed = new Map(rows.map((row) => [row.path, row.hash]));
  const current = new Map(scan.files.map((file) => [file.relPath, file.hash]));
  let changed = 0;
  let missing = 0;
  let deleted = 0;
  for (const [path, hash] of current) {
    if (!indexed.has(path)) missing++;
    else if (indexed.get(path) !== hash) changed++;
  }
  for (const path of indexed.keys()) if (!current.has(path)) deleted++;
  const fileDrift = changed > 0 || missing > 0 || deleted > 0;
  const warnings = [...scan.warnings];
  if (fileDrift) warnings.push(`Index stale: ${changed} changed, ${missing} missing, ${deleted} deleted files.`);
  const indexedHead = readPathAwareMeta(db, "indexed_head", pathPrefix);
  const git = readGitWorkingTreeStatus(root, pathPrefix);
  const headChanged = Boolean(indexedHead && git.currentHead && indexedHead !== git.currentHead);
  const dirtyFiles = git.dirtyFiles;
  const dirty = dirtyFiles.length > 0;
  const hasIndexedGitBaseline = Boolean(indexedHead && git.currentHead);
  if (headChanged) warnings.push("Git HEAD changed since last index.");
  if (dirty && hasIndexedGitBaseline) warnings.push(`Working tree dirty: ${dirtyFiles.length} file${dirtyFiles.length === 1 ? "" : "s"}.`);
  const stale = fileDrift || headChanged || (dirty && hasIndexedGitBaseline);
  return { stale, changed, missing, deleted, skipped: scan.skipped, skippedReasons: scan.skippedReasons, currentHead: git.currentHead, headChanged, dirty, dirtyFiles, warnings };
}

function readPathAwareMeta(db: ReturnType<typeof openRepoDb>, baseKey: string, pathPrefix: string): string | null {
  const scoped = pathPrefix ? readMeta(db, `${baseKey}:${pathPrefix}`) : null;
  return scoped ?? readMeta(db, baseKey);
}

function readMeta(db: ReturnType<typeof openRepoDb>, key: string): string | null {
  const value = (db.prepare("select value from meta where key=?").get(key) as { value: string } | undefined)?.value ?? null;
  return value || null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
