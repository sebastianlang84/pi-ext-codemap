import type { Chunk } from "./types.ts";

export function chunkText(text: string, language: string): Chunk[] {
  const lines = text.split(/\r?\n/);
  if (language === "markdown") return chunkMarkdown(lines);
  const chunks: Chunk[] = [];
  const size = 80;
  const overlap = 10;
  for (let start = 0, ordinal = 0; start < lines.length; start += size - overlap, ordinal++) {
    const end = Math.min(lines.length, start + size);
    chunks.push({ ordinal, startLine: start + 1, endLine: end, kind: "text", text: lines.slice(start, end).join("\n") });
    if (end === lines.length) break;
  }
  return chunks;
}

function chunkMarkdown(lines: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  let ordinal = 0;
  for (let i = 1; i < lines.length; i++) {
    if (/^#{1,3}\s+/.test(lines[i]) && i - start > 8) {
      chunks.push({ ordinal: ordinal++, startLine: start + 1, endLine: i, kind: "markdown", text: lines.slice(start, i).join("\n") });
      start = i;
    }
  }
  if (start < lines.length) chunks.push({ ordinal, startLine: start + 1, endLine: lines.length, kind: "markdown", text: lines.slice(start).join("\n") });
  return chunks;
}

export function snippet(text: string, max = 700): string {
  const compact = text.replace(/\n{3,}/g, "\n\n").trim();
  return compact.length <= max ? compact : compact.slice(0, max - 1).trimEnd() + "…";
}
