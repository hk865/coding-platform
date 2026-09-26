/**
 * Pure R3d mechanical diff. It reports only what the two frozen source graphs
 * prove: a structural key appeared, disappeared or changed its recorded digest.
 * Names and paths are labels, never proof of a semantic move, and no branch can
 * produce a baseline, policy or missing-dependency verdict.
 */
import type { ArchitectureSourceSnapshotV1 } from '../../../contracts/architecture-source.js';
import { sha256Hex, canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { ObservedArchitectureComparison, ObservedArchitectureDeltaChange,
  ObservedArchitectureSelection } from './contracts.js';

function changeId(level: 'node' | 'edge', kind: ObservedArchitectureDeltaChange['kind'], structuralKey: string,
  beforeDigest: string | null, afterDigest: string | null): string {
  return sha256Hex(canonicalJson({ level, kind, structuralKey, beforeDigest, afterDigest } as unknown as JsonValue)).slice(0, 32);
}

function deterministicCycles(graph: ArchitectureSourceSnapshotV1): string[][] {
  const nodeIds = [...new Set(graph.nodes.map(node => node.nodeId))].sort((a, b) => a.localeCompare(b));
  const adjacency = new Map<string, Set<string>>();
  for (const nodeId of nodeIds) adjacency.set(nodeId, new Set());
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.fromNode) || !adjacency.has(edge.toNode)) continue;
    adjacency.get(edge.fromNode)!.add(edge.toNode);
  }
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  const strongConnect = (start: string): void => {
    const work: { nodeId: string; neighbours: string[]; cursor: number }[] = [];
    indices.set(start, index); lowlink.set(start, index); index += 1;
    stack.push(start); onStack.add(start);
    work.push({ nodeId: start, neighbours: [...(adjacency.get(start) ?? [])].sort((a, b) => a.localeCompare(b)), cursor: 0 });
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      if (frame.cursor < frame.neighbours.length) {
        const neighbour = frame.neighbours[frame.cursor]!;
        frame.cursor += 1;
        if (!indices.has(neighbour)) {
          indices.set(neighbour, index); lowlink.set(neighbour, index); index += 1;
          stack.push(neighbour); onStack.add(neighbour);
          work.push({ nodeId: neighbour, neighbours: [...(adjacency.get(neighbour) ?? [])].sort((a, b) => a.localeCompare(b)), cursor: 0 });
        } else if (onStack.has(neighbour)) {
          lowlink.set(frame.nodeId, Math.min(lowlink.get(frame.nodeId)!, indices.get(neighbour)!));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1]!;
        lowlink.set(parent.nodeId, Math.min(lowlink.get(parent.nodeId)!, lowlink.get(frame.nodeId)!));
      }
      if (lowlink.get(frame.nodeId) === indices.get(frame.nodeId)) {
        const component: string[] = [];
        let member: string | undefined;
        do {
          member = stack.pop();
          if (member === undefined) break;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.nodeId);
        const sorted = component.sort((a, b) => a.localeCompare(b));
        const selfLoop = sorted.length === 1 && (adjacency.get(sorted[0]!)?.has(sorted[0]!) ?? false);
        if (sorted.length > 1 || selfLoop) components.push(sorted);
      }
    }
  };
  for (const nodeId of nodeIds) if (!indices.has(nodeId)) strongConnect(nodeId);
  return components.sort((a, b) => a.join('\u0000').localeCompare(b.join('\u0000')));
}

export function compareObservedGraphs(before: ArchitectureSourceSnapshotV1, after: ArchitectureSourceSnapshotV1,
  beforeSelection: ObservedArchitectureSelection, afterSelection: ObservedArchitectureSelection): ObservedArchitectureComparison {
  const beforeNodes = new Map(before.nodes.map(node => [node.structuralKey, node]));
  const afterNodes = new Map(after.nodes.map(node => [node.structuralKey, node]));
  const beforeEdges = new Map(before.edges.map(edge => [edge.structuralKey, edge]));
  const afterEdges = new Map(after.edges.map(edge => [edge.structuralKey, edge]));
  const changes: ObservedArchitectureDeltaChange[] = [];
  const push = (level: 'node' | 'edge', kind: ObservedArchitectureDeltaChange['kind'], structuralKey: string,
    beforeDigest: string | null, afterDigest: string | null, label: string): void => {
    changes.push({ changeId: changeId(level, kind, structuralKey, beforeDigest, afterDigest), level, kind, structuralKey, beforeDigest, afterDigest, label });
  };
  for (const [key, node] of afterNodes) {
    const previous = beforeNodes.get(key);
    if (previous === undefined) push('node', 'added', key, null, node.contentDigest, node.name);
    else if (previous.contentDigest !== node.contentDigest) push('node', 'modified', key, previous.contentDigest, node.contentDigest, node.name);
  }
  for (const [key, node] of beforeNodes) if (!afterNodes.has(key)) push('node', 'removed', key, node.contentDigest, null, node.name);
  for (const [key, edge] of afterEdges) {
    const previous = beforeEdges.get(key);
    if (previous === undefined) push('edge', 'added', key, null, edge.edgeId, key);
    else if (previous.edgeId !== edge.edgeId) push('edge', 'modified', key, previous.edgeId, edge.edgeId, key);
  }
  for (const [key, edge] of beforeEdges) if (!afterEdges.has(key)) push('edge', 'removed', key, edge.edgeId, null, key);
  changes.sort((a, b) => a.level.localeCompare(b.level) || a.structuralKey.localeCompare(b.structuralKey) || a.kind.localeCompare(b.kind));
  const unresolved = [...new Set([...before.unresolved, ...after.unresolved])].sort((a, b) => a.localeCompare(b));
  return { before: beforeSelection, after: afterSelection, changes, cycles: deterministicCycles(after), unresolved, noVerdict: true };
}
