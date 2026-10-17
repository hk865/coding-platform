/**
 * Slice 8A file-level graph paging (spec L12; lead answer 1). PURE: no I/O, no
 * store, no clock. It takes the already-decoded nodes/edges of one observation
 * and returns one deterministically ordered page.
 *
 * UNSPECIFIED choices recorded here (the spec fixes the page rules, not these):
 * - `neighbors` returns exactly the nodes reachable by ONE edge in the requested
 *   direction; the queried file itself is not added to the page.
 * - `impact` returns the reverse-reachable nodes (importer side) within `depth`;
 *   the queried file itself is not added to the page.
 * - a `limit` above 200 is clamped to 200; `listFiles` always pages 200.
 * - `nextCursor` binds the capture ref AND the query identity; a cursor used with
 *   another capture or query is `cursor_mismatch`.
 */
import type { FileGraphPageNodeV1, ObservedCaptureRef } from '../../../contracts/architecture-inspection.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';

/** One page of the file graph (the service adds the capture ref and inventory). */
export type FileGraphPageData = {
  nodes: FileGraphPageNodeV1[];
  edges: { from: string; to: string }[];
  nextCursor: string | null;
  complete: boolean;
};

/** The explicit page projection; the full node table never reaches a page. */
export type FileGraphData = {
  nodes: FileGraphPageNodeV1[];
  edges: { from: string; to: string }[];
};

export const FILE_GRAPH_PAGE_SIZE = 200;
export const FILE_GRAPH_MAX_IMPACT_DEPTH = 3;

export class FileGraphCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileGraphCursorError';
  }
}

type CursorV1 = { v: 1; captureKey: string; queryKey: string; offset: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function captureKeyOf(captureRef: ObservedCaptureRef): string {
  return sha256Hex(canonicalJson(captureRef as unknown as JsonValue));
}
function queryKeyOf(query: unknown): string {
  return sha256Hex(canonicalJson(query as unknown as JsonValue));
}
function encodeCursor(cursor: CursorV1): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function readOffset(captureRef: ObservedCaptureRef, query: unknown, cursor: string | null): number {
  if (cursor === null) return 0;
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
  catch { throw new FileGraphCursorError('the file graph cursor is not decodable'); }
  if (!isRecord(parsed) || parsed['v'] !== 1 || typeof parsed['captureKey'] !== 'string'
    || typeof parsed['queryKey'] !== 'string' || !Number.isSafeInteger(parsed['offset']) || (parsed['offset'] as number) < 0) {
    throw new FileGraphCursorError('the file graph cursor is malformed');
  }
  if (parsed['captureKey'] !== captureKeyOf(captureRef) || parsed['queryKey'] !== queryKeyOf(query)) {
    throw new FileGraphCursorError('cursor_mismatch');
  }
  return parsed['offset'] as number;
}

/** Nodes sorted by workspace-relative path, de-duplicated by path. */
function orderedNodes(graph: FileGraphData): FileGraphPageNodeV1[] {
  const byPath = new Map<string, FileGraphPageNodeV1>();
  for (const node of graph.nodes) if (!byPath.has(node.path)) byPath.set(node.path, node);
  return [...byPath.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
/** Edges de-duplicated by `(from,to)` and sorted by `(from,to)`. */
function orderedEdges(graph: FileGraphData): { from: string; to: string }[] {
  const seen = new Set<string>();
  const edges: { from: string; to: string }[] = [];
  for (const edge of graph.edges) {
    const key = edge.from + '\u0000' + edge.to;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: edge.from, to: edge.to });
  }
  return edges.sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0);
}
function buildPage(graph: FileGraphData, visible: readonly FileGraphPageNodeV1[], offset: number, pageSize: number,
  captureRef: ObservedCaptureRef, query: unknown): FileGraphPageData {
  const nodes = visible.slice(offset, offset + pageSize);
  const onPage = new Set(nodes.map(node => node.path));
  const edges = orderedEdges(graph).filter(edge => onPage.has(edge.from) && onPage.has(edge.to));
  const nextOffset = offset + nodes.length;
  const nextCursor = nextOffset < visible.length
    ? encodeCursor({ v: 1, captureKey: captureKeyOf(captureRef), queryKey: queryKeyOf(query), offset: nextOffset })
    : null;
  return { nodes, edges, nextCursor, complete: nextCursor === null };
}

/** `listFiles`: all nodes sorted by path, a fixed page of 200. */
export function listFilesPage(graph: FileGraphData, captureRef: ObservedCaptureRef, cursor: string | null): FileGraphPageData {
  const query = { kind: 'listFiles' };
  const offset = readOffset(captureRef, query, cursor);
  return buildPage(graph, orderedNodes(graph), offset, FILE_GRAPH_PAGE_SIZE, captureRef, query);
}

/** `neighbors`: nodes reachable by exactly one edge in the requested direction. */
export function neighborsPage(graph: FileGraphData, captureRef: ObservedCaptureRef, file: string,
  direction: 'out' | 'in', limit: number, cursor: string | null): FileGraphPageData {
  const query = { kind: 'neighbors', file, direction };
  const offset = readOffset(captureRef, query, cursor);
  const nodes = orderedNodes(graph);
  const nodePaths = new Set(nodes.map(node => node.path));
  const visible = new Set<string>();
  for (const edge of orderedEdges(graph)) {
    const from = direction === 'out' ? edge.from : edge.to;
    const to = direction === 'out' ? edge.to : edge.from;
    if (from === file && nodePaths.has(to)) visible.add(to);
  }
  const ordered = nodes.filter(node => visible.has(node.path));
  return buildPage(graph, ordered, offset, Math.min(limit, FILE_GRAPH_PAGE_SIZE), captureRef, query);
}

/** `impact`: reverse reachability within `depth` (depth is validated by the service). */
export function impactPage(graph: FileGraphData, captureRef: ObservedCaptureRef, file: string,
  depth: number, limit: number, cursor: string | null): FileGraphPageData {
  const query = { kind: 'impact', file, depth };
  const offset = readOffset(captureRef, query, cursor);
  const nodes = orderedNodes(graph);
  const nodePaths = new Set(nodes.map(node => node.path));
  const importers = new Map<string, Set<string>>();
  for (const edge of orderedEdges(graph)) {
    if (!importers.has(edge.to)) importers.set(edge.to, new Set());
    importers.get(edge.to)!.add(edge.from);
  }
  const visited = new Set<string>([file]);
  let frontier = [file];
  for (let step = 0; step < depth && frontier.length > 0; step += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const importer of importers.get(current) ?? []) {
        if (visited.has(importer) || !nodePaths.has(importer)) continue;
        visited.add(importer);
        next.push(importer);
      }
    }
    frontier = next.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  }
  visited.delete(file);
  const ordered = nodes.filter(node => visited.has(node.path));
  return buildPage(graph, ordered, offset, Math.min(limit, FILE_GRAPH_PAGE_SIZE), captureRef, query);
}
