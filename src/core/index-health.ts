import { openRepoDb } from "./db.ts";
import { scanRepo } from "./scanner.ts";

export interface IndexStatusCounts {
  indexed: boolean;
  files: number;
  chunks: number;
  symbols: number;
  lastIndexedAt: string | null;
}

export interface IndexHealth {
  stale: boolean;
  changed: number;
  missing: number;
  deleted: number;
  skipped?: number;
  skippedReasons?: Record<string, number>;
  warnings: string[];
}

export function readIndexStatusCounts(db: ReturnType<typeof openRepoDb>, pathPrefix = ""): IndexStatusCounts {
  const files = pathPrefix
    ? (db.prepare("select count(*) as n from files where path like ?").get(`${pathPrefix}%`) as { n: number }).n
    : (db.prepare("select count(*) as n from files").get() as { n: number }).n;
  const chunks = pathPrefix
    ? (db.prepare("select count(*) as n from chunks join files f on f.id = chunks.file_id where f.path like ?").get(`${pathPrefix}%`) as { n: number }).n
    : (db.prepare("select count(*) as n from chunks").get() as { n: number }).n;
  const symbols = pathPrefix
    ? (db.prepare("select count(*) as n from symbols join files f on f.id = symbols.file_id where f.path like ?").get(`${pathPrefix}%`) as { n: number }).n
    : (db.prepare("select count(*) as n from symbols").get() as { n: number }).n;
  const lastIndexedAt = (db.prepare("select value from meta where key='last_indexed_at'").get() as { value: string } | undefined)?.value ?? null;
  return { indexed: files > 0, files, chunks, symbols, lastIndexedAt };
}

export function cheapIndexHealth(): IndexHealth {
  return { stale: false, changed: 0, missing: 0, deleted: 0, warnings: [] };
}

export function fullIndexHealth(db: ReturnType<typeof openRepoDb>, root: string, pathPrefix = ""): IndexHealth {
  const scan = scanRepo(root, { pathPrefix });
  const rows = (pathPrefix
    ? db.prepare("select path, hash from files where path like ?").all(`${pathPrefix}%`)
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
  const stale = changed > 0 || missing > 0 || deleted > 0;
  const warnings = [...scan.warnings];
  if (stale) warnings.push(`Index stale: ${changed} changed, ${missing} missing, ${deleted} deleted files.`);
  return { stale, changed, missing, deleted, skipped: scan.skipped, skippedReasons: scan.skippedReasons, warnings };
}
