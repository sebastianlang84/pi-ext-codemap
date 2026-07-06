import { Type } from "typebox";

export type CodeMapOperationId = "status" | "index" | "search" | "context";

export interface CodeMapOperationMetadata {
  id: CodeMapOperationId;
  label: string;
  toolName: string;
  commandName: string;
  description: string;
  commandDescription: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: any;
}

export const codeMapOperationMetadataById = {
  status: {
    id: "status",
    label: "CodeMap Status",
    toolName: "codemap_status",
    commandName: "codemap-status",
    description: "Show CodeMap approval/index status for cwd or repoPath; full=true does a full file-level stale scan.",
    commandDescription: "Show CodeMap approval/index status; pass --repo-path and/or --full",
    promptSnippet: "Check CodeMap approval/index readiness and stale state.",
    promptGuidelines: [
      "Use codemap_status before search/context if approval or index state is unknown; full=true only for file-level stale scans.",
      "Use codemap_status pathPrefix for monorepos.",
    ],
    parameters: Type.Object({
      full: Type.Optional(Type.Boolean({ description: "Run a full repository scan to report stale index diagnostics." })),
      repoPath: Type.Optional(Type.String({ description: "Repo root/path; defaults cwd." })),
      pathPrefix: Type.Optional(Type.String({ description: "Limit diagnostics to an indexed subtree, e.g. services/api/." })),
    }),
  },
  index: {
    id: "index",
    label: "CodeMap Index",
    toolName: "codemap_index",
    commandName: "codemap-index",
    description: "Index/refresh cwd or repoPath; first run needs approveRepo=true.",
    commandDescription: "Index cwd or --repo-path for CodeMap; pass --approve-repo the first time",
    promptSnippet: "Approve once or refresh the CodeMap index for cwd.",
    promptGuidelines: [
      "Use codemap_index approveRepo=true only after explicit local approval.",
      "Use codemap_index when codemap_status says missing or stale.",
      "Use codemap_index pathPrefix to refresh one subtree.",
    ],
    parameters: Type.Object({
      approveRepo: Type.Optional(Type.Boolean({ description: "Approve this Git repository for local-only indexing." })),
      repoPath: Type.Optional(Type.String({ description: "Repo root/path; defaults cwd." })),
      pathPrefix: Type.Optional(Type.String({ description: "Only index/refresh this repository subtree, e.g. services/api/." })),
    }),
  },
  search: {
    id: "search",
    label: "CodeMap Search",
    toolName: "codemap_search",
    commandName: "codemap-search",
    description: "Search indexed paths, symbols, and chunks. Primary navigation tool — prefer over grep/find.",
    commandDescription: "Search the CodeMap index: /codemap-search [--repo-path <path>] <query>",
    promptSnippet: "Primary navigation: search indexed paths, symbols, chunks.",
    promptGuidelines: [
      "Use codemap_search first when the target path/symbol is unknown.",
      "Give codemap_search query terms; add pathPrefix in monorepos; stale warnings advisory; re-query or raise limit before codemap_context.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Feature, symbol, path, or phrase." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Maximum result count." })),
      repoPath: Type.Optional(Type.String({ description: "Repo root/path; defaults cwd." })),
      pathPrefix: Type.Optional(Type.String({ description: "Limit to an indexed subtree, e.g. services/api/." })),
    }),
  },
  context: {
    id: "context",
    label: "CodeMap Context",
    toolName: "codemap_context",
    commandName: "codemap-context",
    description: "Read-first neighbors (tests, imports, docs) of a known target path or symbol.",
    commandDescription: "Get CodeMap read-first context: /codemap-context [--repo-path <path>] <target>",
    promptSnippet: "Read-first neighbors of a known path or symbol.",
    promptGuidelines: [
      "Use codemap_context on an indexed path or symbol you trust — not a broad query, and not an uncertain top search hit.",
      "codemap_context gives read-first hints, not a read substitute; pathPrefix scopes monorepos.",
    ],
    parameters: Type.Object({
      target: Type.String({ description: "Indexed path or symbol (preferred); phrase also works." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 25, description: "Maximum read-first items." })),
      repoPath: Type.Optional(Type.String({ description: "Repo root/path; defaults cwd." })),
      pathPrefix: Type.Optional(Type.String({ description: "Scope to an indexed subtree, e.g. services/api/." })),
    }),
  },
} satisfies Record<CodeMapOperationId, CodeMapOperationMetadata>;

export const codeMapOperationMetadata = [
  codeMapOperationMetadataById.status,
  codeMapOperationMetadataById.index,
  codeMapOperationMetadataById.search,
  codeMapOperationMetadataById.context,
] as const;
