export interface RepoInfo {
  root: string;
  key: string;
  remote?: string;
  approved: boolean;
  dbPath: string;
}

export interface IndexedFile {
  id: number;
  path: string;
  language: string;
  size: number;
  hash: string;
  mtimeMs: number;
}

export interface Chunk {
  ordinal: number;
  startLine: number;
  endLine: number;
  kind: string;
  text: string;
}

export interface SearchResult {
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  kind: string;
}

export interface IndexStats {
  scanned: number;
  indexed: number;
  skipped: number;
  removed: number;
  warnings: string[];
  skippedReasons?: Record<string, number>;
}
