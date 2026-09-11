import { canonicalJson, sha256Hex } from './fingerprint.js';
import type { CodeGraphNode, CodeGraphEdge } from './architecture-inspection.js';

/** Explicit, versioned mapping; a directory name is not implicitly a product Module. */
export type ArchitectureSourceMapping = { id: string; kind: 'module' | 'interface'; paths: string[] };
/** WorkspaceReader returns source facts; Context binds them to canonical records
 * and stores the authorized source bundle. This provider never opens the ledger
 * or invokes ArtifactVault. */
export interface ArchitectureSourceCapturePort {
  capture(request: {
    projectId: string; workspaceId: string; workspaceRevision: number;
    mappings: ArchitectureSourceMapping[]; configPath?: string;
  }): Promise<ArchitectureSourceSnapshotV1>;
}
export type ArchitectureSourceSnapshotV1 = {
  schemaVersion: 1; projectId: string; workspaceId: string; workspaceRevision: number;
  sourceDigest: string; commitHash: string | null; indexVersion: string; configPath: string | null;
  mappings: ArchitectureSourceMapping[]; nodes: CodeGraphNode[]; edges: CodeGraphEdge[];
  /** Unknown imports/unmapped sources are evidence gaps, never absent dependencies. */
  unresolved: string[];
};
export const architectureSourceDigest = (value: ArchitectureSourceSnapshotV1) => sha256Hex(canonicalJson(value));

export function architectureSourceIssues(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['source binding must be an object'];
  const v = value as ArchitectureSourceSnapshotV1, errors: string[] = [];
  if (v.schemaVersion !== 1 || typeof v.projectId !== 'string' || !v.projectId || typeof v.workspaceId !== 'string' || !v.workspaceId || !Number.isSafeInteger(v.workspaceRevision) || v.workspaceRevision < 1) errors.push('invalid source scope/revision');
  if (typeof v.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(v.sourceDigest) || typeof v.indexVersion !== 'string' || !v.indexVersion || (v.commitHash !== null && (typeof v.commitHash !== 'string' || !/^[a-f0-9]{40,64}$/.test(v.commitHash)))) errors.push('invalid source identity');
  const path = (p: unknown) => typeof p === 'string' && p.length > 0 && !/[\\:\0]/.test(p) && p.split('/').every(s => s && s !== '.' && s !== '..');
  if (v.configPath !== null && !path(v.configPath)) errors.push('invalid configuration path');
  if (!Array.isArray(v.mappings) || v.mappings.length > 512 || v.mappings.some(m => !m || !m.id || !['module','interface'].includes(m.kind) || !Array.isArray(m.paths) || !m.paths.length || m.paths.some(p => !path(p)))) errors.push('invalid mappings');
  else if (new Set(v.mappings.map(m => m.kind + ':' + m.id)).size !== v.mappings.length) errors.push('duplicate mapping');
  if (!Array.isArray(v.nodes) || v.nodes.length > 512 || v.nodes.some(n => !n || !n.nodeId || !n.structuralKey || !['module','interface'].includes(n.kind) || !path(n.path) || !/^[a-f0-9]{64}$/.test(n.contentDigest))) errors.push('invalid mapped nodes');
  else if (new Set(v.nodes.map(n => n.nodeId)).size !== v.nodes.length || new Set(v.nodes.map(n => n.structuralKey)).size !== v.nodes.length) errors.push('duplicate node');
  if (!Array.isArray(v.edges) || v.edges.length > 1024 || v.edges.some(e => !e || !e.edgeId || !e.structuralKey || !['module_dependency','interface_uses'].includes(e.kind))) errors.push('invalid edges');
  else if (Array.isArray(v.nodes)) { const ids = new Set(v.nodes.map(n => n?.nodeId)); if (v.edges.some(e => !ids.has(e.fromNode) || !ids.has(e.toNode))) errors.push('dangling edge'); if (new Set(v.edges.map(e => e.structuralKey)).size !== v.edges.length) errors.push('duplicate edge'); }
  if (!Array.isArray(v.unresolved) || v.unresolved.length > 2048 || v.unresolved.some(x => typeof x !== 'string' || !x || x.length > 4096)) errors.push('invalid unresolved relations');
  if (Buffer.byteLength(JSON.stringify(v)) > 240 * 1024) errors.push('source binding exceeds capacity');
  return errors;
}
