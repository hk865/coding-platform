/**
 * Pure R3d source-graph traversal. The graph is frozen observed evidence:
 * cycles and unresolved relations are preserved, no node is invented, and the
 * only direction asserted is the one the stored edges carry.
 *
 * This module performs no I/O, opens no body and consults no store. It receives
 * one already-decoded `ArchitectureSourceSnapshotV1` plus its persisted
 * selection, and returns a bounded, deterministically ordered page.
 */
import type { ArchitectureSourceSnapshotV1 } from '../../../contracts/architecture-source.js';
import type { CodeGraphEdge, CodeGraphNode } from '../../../contracts/architecture-inspection.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { ObservedArchitectureImpact, ObservedArchitectureNeighborhood,
  ObservedArchitectureSelection, ObservedGraphAnchor, ObservedGraphPageRequest } from './contracts.js';

export class ObservedGraphCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObservedGraphCursorError';
  }
}

const DEPENDENCY_EDGE_KINDS: readonly string[] = ['module_dependency'];
const INTERFACE_EDGE_KINDS: readonly string[] = ['interface_uses'];
const EDGE_KIND_BY_RELATION: Record<'dependency' | 'interface', readonly string[]> = {
  dependency: DEPENDENCY_EDGE_KINDS,
  interface: INTERFACE_EDGE_KINDS,
};

type GraphSelection = ObservedArchitectureSelection;

type GraphCursorV1 = { v: 1; sourceKey: string; queryKey: string; offset: number };
type ImpactCursorV1 = { v: 1; sourceKey: string; changeKey: string; offset: number };

function relationsOf(relations: readonly ('dependency' | 'interface')[]): ('dependency' | 'interface')[] {
  return [...new Set(relations)].sort();
}
function sourceKeyOf(selection: GraphSelection): string {
  return sha256Hex(canonicalJson(selection as unknown as JsonValue));
}
function queryKeyOf(anchor: ObservedGraphAnchor | undefined, depth: number, relations: readonly string[]): string {
  return sha256Hex(canonicalJson({ anchor: (anchor ?? null) as unknown as JsonValue, depth, relations: relationsOf(relations as ('dependency' | 'interface')[]) }));
}
function encodeCursor(value: GraphCursorV1 | ImpactCursorV1): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
function decodeCursor(cursor: string): GraphCursorV1 | ImpactCursorV1 {
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
  catch { throw new ObservedGraphCursorError('the graph cursor is not decodable'); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ObservedGraphCursorError('the graph cursor is malformed');
  const value = parsed as Record<string, unknown>;
  if (value['v'] !== 1 || typeof value['sourceKey'] !== 'string' || typeof value['offset'] !== 'number'
    || !Number.isSafeInteger(value['offset']) || value['offset'] < 0) {
    throw new ObservedGraphCursorError('the graph cursor is malformed');
  }
  return parsed as GraphCursorV1 | ImpactCursorV1;
}
function edgeKindsOf(relations: readonly ('dependency' | 'interface')[]): Set<string> {
  const kinds = new Set<string>();
  for (const relation of relations) for (const kind of EDGE_KIND_BY_RELATION[relation]) kinds.add(kind);
  return kinds;
}
function ownEdges(graph: ArchitectureSourceSnapshotV1, relations: readonly ('dependency' | 'interface')[]): CodeGraphEdge[] {
  const kinds = edgeKindsOf(relations);
  const seen = new Set<string>();
  const edges: CodeGraphEdge[] = [];
  for (const edge of graph.edges) {
    if (!kinds.has(edge.kind) || seen.has(edge.edgeId)) continue;
    seen.add(edge.edgeId);
    edges.push(edge);
  }
  return edges;
}
function orderedNodes(graph: ArchitectureSourceSnapshotV1): CodeGraphNode[] {
  const seen = new Set<string>();
  const nodes: CodeGraphNode[] = [];
  for (const node of graph.nodes) {
    if (seen.has(node.nodeId)) continue;
    seen.add(node.nodeId);
    nodes.push(node);
  }
  return nodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}
function mappingPathsByStructuralKey(graph: ArchitectureSourceSnapshotV1): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const mapping of graph.mappings) map.set(mapping.kind + ':' + mapping.id, [...mapping.paths]);
  return map;
}
function resolveAnchorNodes(graph: ArchitectureSourceSnapshotV1, anchor: ObservedGraphAnchor | undefined): string[] | null {
  if (anchor === undefined) return null;
  if (anchor.kind === 'node') return graph.nodes.some(node => node.nodeId === anchor.nodeId) ? [anchor.nodeId] : [];
  const matches: string[] = [];
  for (const mapping of graph.mappings) {
    if (!mapping.paths.some(path => anchor.path === path || anchor.path.startsWith(path + '/'))) continue;
    const nodeId = mapping.kind + ':' + mapping.id;
    if (graph.nodes.some(node => node.nodeId === nodeId)) matches.push(nodeId);
  }
  return [...new Set(matches)].sort();
}

/** Undirected bounded walk over the requested edge kinds; visited stops real cycles. */
function neighborhoodNodes(graph: ArchitectureSourceSnapshotV1, seeds: readonly string[] | null,
  depth: number, relations: readonly ('dependency' | 'interface')[]): Set<string> {
  const all = orderedNodes(graph).map(node => node.nodeId);
  if (seeds === null) return new Set(all);
  const adjacency = new Map<string, Set<string>>();
  for (const edge of ownEdges(graph, relations)) {
    if (!adjacency.has(edge.fromNode)) adjacency.set(edge.fromNode, new Set());
    if (!adjacency.has(edge.toNode)) adjacency.set(edge.toNode, new Set());
    adjacency.get(edge.fromNode)!.add(edge.toNode);
    adjacency.get(edge.toNode)!.add(edge.fromNode);
  }
  const visited = new Set<string>();
  let frontier = [...seeds].filter(nodeId => graph.nodes.some(node => node.nodeId === nodeId));
  for (const nodeId of frontier) visited.add(nodeId);
  for (let step = 0; step < depth && frontier.length > 0; step += 1) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const neighbour of adjacency.get(nodeId) ?? []) {
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next.sort((a, b) => a.localeCompare(b));
  }
  return visited;
}

/** Attribute each unresolved line to the first node whose frozen paths it names. */
function unresolvedByPage(graph: ArchitectureSourceSnapshotV1, ordered: readonly CodeGraphNode[]): { byNode: Map<string, string[]>; global: string[] } {
  const pathsByKey = mappingPathsByStructuralKey(graph);
  const byNode = new Map<string, string[]>();
  const global: string[] = [];
  for (const entry of graph.unresolved) {
    let owner: string | null = null;
    for (const node of ordered) {
      const paths = pathsByKey.get(node.structuralKey) ?? [node.path];
      if (paths.some(path => entry.includes(path + ':'))) { owner = node.nodeId; break; }
    }
    if (owner === null) global.push(entry);
    else byNode.set(owner, [...(byNode.get(owner) ?? []), entry]);
  }
  return { byNode, global };
}

export function buildObservedNeighborhood(graph: ArchitectureSourceSnapshotV1, selection: GraphSelection, input: {
  anchor?: ObservedGraphAnchor; depth: number; relations: ('dependency' | 'interface')[];
  page: ObservedGraphPageRequest; sourceCursor: CommitCursor;
}): ObservedArchitectureNeighborhood {
  const relations = relationsOf(input.relations);
  const sourceKey = sourceKeyOf(selection);
  const queryKey = queryKeyOf(input.anchor, input.depth, relations);
  let offset = 0;
  if (input.page.cursor !== undefined) {
    const cursor = decodeCursor(input.page.cursor);
    if (!('queryKey' in cursor) || cursor.sourceKey !== sourceKey || cursor.queryKey !== queryKey) {
      throw new ObservedGraphCursorError('the graph cursor belongs to another source or query');
    }
    offset = cursor.offset;
  }
  const ordered = orderedNodes(graph);
  const included = neighborhoodNodes(graph, resolveAnchorNodes(graph, input.anchor), input.depth, relations);
  const visible = ordered.filter(node => included.has(node.nodeId));
  const pageNodes = visible.slice(offset, offset + input.page.limit);
  const pageNodeIds = new Set(pageNodes.map(node => node.nodeId));
  const edgeSeen = new Set<string>();
  const edges: CodeGraphEdge[] = [];
  for (const edge of ownEdges(graph, relations)) {
    if (!pageNodeIds.has(edge.fromNode) || edgeSeen.has(edge.edgeId)) continue;
    edgeSeen.add(edge.edgeId);
    edges.push(edge);
  }
  edges.sort((a, b) => a.structuralKey.localeCompare(b.structuralKey));
  const attribution = unresolvedByPage(graph, ordered);
  const unresolved: string[] = [];
  for (const node of pageNodes) for (const entry of attribution.byNode.get(node.nodeId) ?? []) if (!unresolved.includes(entry)) unresolved.push(entry);
  if (offset === 0) for (const entry of attribution.global) if (!unresolved.includes(entry)) unresolved.push(entry);
  const nextOffset = offset + pageNodes.length;
  const nextCursor = nextOffset < visible.length
    ? encodeCursor({ v: 1, sourceKey, queryKey, offset: nextOffset }) : null;
  return { selection, nodes: pageNodes, edges, unresolved, nextCursor, sourceCursor: input.sourceCursor, noVerdict: true };
}

/** Forward edge -> importers, so impact walks against the dependency direction. */
function reverseAdjacency(graph: ArchitectureSourceSnapshotV1): Map<string, Set<string>> {
  const reverse = new Map<string, Set<string>>();
  for (const edge of ownEdges(graph, ['dependency', 'interface'])) {
    if (!reverse.has(edge.toNode)) reverse.set(edge.toNode, new Set());
    reverse.get(edge.toNode)!.add(edge.fromNode);
  }
  return reverse;
}

export function buildObservedImpact(graph: ArchitectureSourceSnapshotV1, selection: GraphSelection,
  changed: readonly ObservedGraphAnchor[], page: ObservedGraphPageRequest, sourceCursor: CommitCursor): ObservedArchitectureImpact {
  const sourceKey = sourceKeyOf(selection);
  const seeds = new Set<string>();
  for (const anchor of changed) for (const nodeId of resolveAnchorNodes(graph, anchor) ?? []) seeds.add(nodeId);
  const changeKey = sha256Hex(canonicalJson([...seeds].sort() as unknown as JsonValue));
  let offset = 0;
  if (page.cursor !== undefined) {
    const cursor = decodeCursor(page.cursor);
    if (!('changeKey' in cursor) || cursor.sourceKey !== sourceKey || cursor.changeKey !== changeKey) {
      throw new ObservedGraphCursorError('the impact cursor belongs to another source or change set');
    }
    offset = cursor.offset;
  }
  const reverse = reverseAdjacency(graph);
  const visited = new Set<string>(seeds);
  const paths = new Map<string, string[]>();
  let frontier = [...seeds].sort((a, b) => a.localeCompare(b)).map(nodeId => ({ nodeId, path: [nodeId] }));
  while (frontier.length > 0) {
    const next: { nodeId: string; path: string[] }[] = [];
    for (const item of frontier) {
      for (const importer of reverse.get(item.nodeId) ?? []) {
        if (visited.has(importer)) continue;
        visited.add(importer);
        const path = [...item.path, importer];
        paths.set(importer, path);
        next.push({ nodeId: importer, path });
      }
    }
    frontier = next.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  }
  const affected = [...paths.keys()].sort((a, b) => a.localeCompare(b));
  const pageAffected = affected.slice(offset, offset + page.limit);
  const nextOffset = offset + pageAffected.length;
  const nextCursor = nextOffset < affected.length
    ? encodeCursor({ v: 1, sourceKey, changeKey, offset: nextOffset }) : null;
  return {
    affected: pageAffected.map(nodeId => ({ kind: 'node' as const, nodeId })),
    paths: pageAffected.map(nodeId => paths.get(nodeId) ?? [nodeId]),
    unresolved: [...graph.unresolved],
    nextCursor,
    sourceCursor,
    noVerdict: true,
  };
}
