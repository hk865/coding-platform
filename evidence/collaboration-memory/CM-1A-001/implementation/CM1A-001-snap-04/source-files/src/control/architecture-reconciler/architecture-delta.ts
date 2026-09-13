import type { ArchitectureDeltaV1, ArchitectureDeltaChange, CodeGraphSnapshotV1 } from '../../contracts/architecture-inspection.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';

/** Deterministic mechanical diff: same inputs -> identical Delta JSON. PURE. */
export function computeArchitectureDelta(before: CodeGraphSnapshotV1, after: CodeGraphSnapshotV1): ArchitectureDeltaV1 {
  const changes: ArchitectureDeltaChange[] = [];
  const beforeNodes = new Map(before.nodes.map((n) => [n.structuralKey, n]));
  const afterNodes = new Map(after.nodes.map((n) => [n.structuralKey, n]));
  for (const key of [...beforeNodes.keys()].sort()) {
    const b = beforeNodes.get(key)!;
    const a = afterNodes.get(key);
    if (a === undefined) {
      changes.push({ changeId: "node:" + key, level: "node", kind: "removed", structuralKey: key, beforeDigest: b.contentDigest, afterDigest: null, label: "node removed: " + b.name });
    } else if (a.path !== b.path) {
      changes.push({ changeId: "node:" + key, level: "node", kind: "moved", structuralKey: key, beforeDigest: b.contentDigest, afterDigest: a.contentDigest, label: "node moved: " + b.path + " -> " + a.path });
    } else if (a.contentDigest !== b.contentDigest || a.name !== b.name || a.kind !== b.kind) {
      changes.push({ changeId: "node:" + key, level: "node", kind: "modified", structuralKey: key, beforeDigest: b.contentDigest, afterDigest: a.contentDigest, label: "node modified: " + a.name });
    }
  }
  for (const key of [...afterNodes.keys()].sort()) {
    const a = afterNodes.get(key)!;
    if (!beforeNodes.has(key)) {
      changes.push({ changeId: "node:" + key, level: "node", kind: "added", structuralKey: key, beforeDigest: null, afterDigest: a.contentDigest, label: "node added: " + a.name });
    }
  }
  const beforeEdges = new Map(before.edges.map((e) => [e.structuralKey, e]));
  const afterEdges = new Map(after.edges.map((e) => [e.structuralKey, e]));
  for (const key of [...beforeEdges.keys()].sort()) {
    if (!afterEdges.has(key)) {
      changes.push({ changeId: "edge:" + key, level: "edge", kind: "removed", structuralKey: key, beforeDigest: sha256Hex(canonicalJson(beforeEdges.get(key)!)), afterDigest: null, label: "edge removed: " + key });
    } else {
      const beforeEdge = beforeEdges.get(key)!, afterEdge = afterEdges.get(key)!;
      if (beforeEdge.fromNode !== afterEdge.fromNode || beforeEdge.toNode !== afterEdge.toNode || beforeEdge.kind !== afterEdge.kind) {
        changes.push({ changeId: "edge:" + key, level: "edge", kind: "modified", structuralKey: key,
          beforeDigest: sha256Hex(canonicalJson(beforeEdge)), afterDigest: sha256Hex(canonicalJson(afterEdge)), label: "edge modified: " + key });
      }
    }
  }
  for (const key of [...afterEdges.keys()].sort()) {
    if (!beforeEdges.has(key)) {
      changes.push({ changeId: "edge:" + key, level: "edge", kind: "added", structuralKey: key, beforeDigest: null, afterDigest: sha256Hex(canonicalJson(afterEdges.get(key)!)), label: "edge added: " + key });
    }
  }
  return {
    schemaVersion: 1,
    deltaId: "delta-" + sha256Hex(canonicalJson({ before: before.snapshotId, after: after.snapshotId, changes })).slice(0, 16),
    projectId: before.projectId,
    workspaceId: before.workspaceId,
    workspaceRevision: after.workspaceRevision,
    planRef: { ...before.planRef },
    baselinePin: { ...before.baselinePin },
    changes,
    noVerdict: true,
    sourceSnapshotRef: after.bodyRef,
    bodyRef: after.bodyRef,
    generatedAt: after.generatedAt,
  };
}
