import { openRepoDb } from "./db.ts";

export interface ArchitectureReportOptions {
  limit?: number;
}

export interface ArchitectureDegreeFile {
  path: string;
  inbound: number;
  outbound: number;
  total: number;
}

export interface ArchitectureCycle {
  paths: string[];
}

export interface ArchitectureModuleCluster {
  module: string;
  files: number;
  edges: number;
}

export interface ArchitectureReport {
  pathFilter: string;
  highDegreeFiles: ArchitectureDegreeFile[];
  bridgeFiles: ArchitectureDegreeFile[];
  importCycles: ArchitectureCycle[];
  weaklyConnectedFiles: string[];
  moduleClusters: ArchitectureModuleCluster[];
}

interface GraphEdgeRow {
  sourcePath: string;
  targetPath: string;
  kind: string;
}

export function buildArchitectureReport(
  db: ReturnType<typeof openRepoDb>,
  pathFilter = "%",
  options: ArchitectureReportOptions = {},
): ArchitectureReport {
  const limit = boundedLimit(options.limit ?? 10, 1, 50);
  const files = indexedFiles(db, pathFilter);
  const fileSet = new Set(files);
  const edges = graphEdges(db, pathFilter);
  const degree = degreeByPath(files, edges);

  return {
    pathFilter,
    highDegreeFiles: [...degree.values()]
      .filter((item) => item.total > 0)
      .sort(sortDegree)
      .slice(0, limit),
    bridgeFiles: [...degree.values()]
      .filter((item) => item.inbound > 0 && item.outbound > 0)
      .sort(sortDegree)
      .slice(0, limit),
    importCycles: stronglyConnectedComponents(files, edges)
      .filter((component) => component.length > 1)
      .map((paths) => ({ paths: paths.sort() }))
      .sort((left, right) => right.paths.length - left.paths.length || left.paths[0].localeCompare(right.paths[0]))
      .slice(0, limit),
    weaklyConnectedFiles: files
      .filter((path) => fileSet.has(path) && (degree.get(path)?.total ?? 0) === 0)
      .slice(0, limit),
    moduleClusters: moduleClusters(files, edges).slice(0, limit),
  };
}

function indexedFiles(db: ReturnType<typeof openRepoDb>, pathFilter: string): string[] {
  return (db.prepare("select path from files where path like ? escape '\\' order by path").all(pathFilter) as Array<{ path: string }>).map((row) => row.path);
}

function graphEdges(db: ReturnType<typeof openRepoDb>, pathFilter: string): GraphEdgeRow[] {
  return db.prepare(`
    select source.path as sourcePath, target.path as targetPath, e.kind
    from graph_edges e
    join graph_nodes source on source.id = e.from_node_id
    join graph_nodes target on target.id = e.to_node_id
    where source.path like ? escape '\\' and target.path like ? escape '\\' and e.kind in ('imports', 'includes')
    order by source.path, target.path, e.kind
  `).all(pathFilter, pathFilter) as unknown as GraphEdgeRow[];
}

function degreeByPath(files: string[], edges: GraphEdgeRow[]): Map<string, ArchitectureDegreeFile> {
  const degree = new Map(files.map((path) => [path, { path, inbound: 0, outbound: 0, total: 0 }]));
  for (const edge of edges) {
    const source = degree.get(edge.sourcePath);
    const target = degree.get(edge.targetPath);
    if (source) source.outbound++;
    if (target) target.inbound++;
  }
  for (const item of degree.values()) item.total = item.inbound + item.outbound;
  return degree;
}

function sortDegree(left: ArchitectureDegreeFile, right: ArchitectureDegreeFile): number {
  return right.total - left.total || right.inbound - left.inbound || right.outbound - left.outbound || left.path.localeCompare(right.path);
}

function stronglyConnectedComponents(files: string[], edges: GraphEdgeRow[]): string[][] {
  const adjacency = new Map(files.map((path) => [path, [] as string[]]));
  for (const edge of edges) adjacency.get(edge.sourcePath)?.push(edge.targetPath);
  for (const targets of adjacency.values()) targets.sort();

  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;

  function visit(path: string): void {
    indices.set(path, nextIndex);
    lowlinks.set(path, nextIndex);
    nextIndex++;
    stack.push(path);
    onStack.add(path);

    for (const next of adjacency.get(path) ?? []) {
      if (!indices.has(next)) {
        visit(next);
        lowlinks.set(path, Math.min(lowlinks.get(path) ?? 0, lowlinks.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowlinks.set(path, Math.min(lowlinks.get(path) ?? 0, indices.get(next) ?? 0));
      }
    }

    if (lowlinks.get(path) !== indices.get(path)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) break;
      onStack.delete(current);
      component.push(current);
      if (current === path) break;
    }
    components.push(component);
  }

  for (const file of files) if (!indices.has(file)) visit(file);
  return components;
}

function moduleClusters(files: string[], edges: GraphEdgeRow[]): ArchitectureModuleCluster[] {
  const clusters = new Map<string, { module: string; files: Set<string>; edges: number }>();
  for (const file of files) {
    const module = moduleKey(file);
    const cluster = clusters.get(module) ?? { module, files: new Set<string>(), edges: 0 };
    cluster.files.add(file);
    clusters.set(module, cluster);
  }
  for (const edge of edges) {
    const sourceModule = moduleKey(edge.sourcePath);
    const targetModule = moduleKey(edge.targetPath);
    const sourceCluster = clusters.get(sourceModule);
    if (sourceCluster) sourceCluster.edges++;
    if (targetModule !== sourceModule) {
      const targetCluster = clusters.get(targetModule);
      if (targetCluster) targetCluster.edges++;
    }
  }
  return [...clusters.values()]
    .map((cluster) => ({ module: cluster.module, files: cluster.files.size, edges: cluster.edges }))
    .sort((left, right) => right.files - left.files || right.edges - left.edges || left.module.localeCompare(right.module));
}

function moduleKey(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return ".";
  if ((parts[0] === "packages" || parts[0] === "apps") && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

function boundedLimit(value: number, min: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.min(Math.max(integer, min), max);
}
