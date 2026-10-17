import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type { ArchitectureSourceSnapshotV1, ArchitectureSourceMapping } from '../../contracts/architecture-source.js';
import { architectureSourceIssues, pathOwnershipOf } from '../../contracts/architecture-source.js';
import type { CodeGraphEdge } from '../../contracts/architecture-inspection.js';

/** Frozen material needed to collapse explicit baseline mappings into a source graph. */
export type ArchitectureSourceMaterial = {
  sources: { path: string; digest: string }[];
  imports: {
    path: string; digest: string; line: number; module: string;
    resolution: string; targets: { path: string; digest: string }[];
  }[];
  manifestDigest: string;
  commit: string | null;
  engine: string;
  engineVersion: string;
  configPath: string | null;
};

/**
 * The one pure mapping behind the capture registry's architecture port: semantic TS/JS
 * imports collapsed only through explicit baseline mappings.
 *
 * File-to-mapping ownership is the ONE longest-prefix decision (`pathOwnershipOf`):
 * a `.` mapping is the root, owns every relative path at match length 0 and is
 * beaten by any concrete prefix; two mappings on the longest prefix tie and the
 * file belongs to NEITHER (a tie is not an owner). Nodes, edges and `unresolved`
 * all use the same per-file result.
 */
export function mapArchitectureSource(material: ArchitectureSourceMaterial,
  scope: {projectId:string;workspaceId:string;workspaceRevision:number}, mappings: ArchitectureSourceMapping[]): ArchitectureSourceSnapshotV1 {
  if (!material.sources.length) throw Error('no TS/JS project sources; this graph provider does not claim Python/C++ coverage');
  const candidates = mappings.map((mapping, index) => ({ value: index, paths: mapping.paths }));
  // One ownership decision per frozen file; `null` (no owner or an equal-longest tie) is not mapped.
  const ownerByPath = new Map<string, number | null>();
  for (const source of material.sources) {
    const ownership = pathOwnershipOf(source.path, candidates);
    ownerByPath.set(source.path, ownership.status === 'owner' ? ownership.owner : null);
  }
  const ownerOf = (p: string): number | null => {
    if (ownerByPath.has(p)) return ownerByPath.get(p)!;
    const ownership = pathOwnershipOf(p, candidates);
    return ownership.status === 'owner' ? ownership.owner : null;
  };
  const nodes = mappings.map((mapping, index) => ({ mapping, index }))
    .filter(({ index }) => material.sources.some(f => ownerOf(f.path) === index))
    .map(({ mapping: m, index }) => {
      const files = material.sources.filter(f => ownerOf(f.path) === index);
      return {nodeId:m.kind+':'+m.id,structuralKey:m.kind+':'+m.id,kind:m.kind,name:m.id,path:m.paths[0]!,contentDigest:sha256Hex(canonicalJson(files))};
    }).sort((a,b)=>a.structuralKey.localeCompare(b.structuralKey));
  const unresolved = material.sources.filter(f => ownerOf(f.path) === null).map(f => 'unmapped source: '+f.path);
  mappings.forEach((m, index) => {
    if (!material.sources.some(f => ownerOf(f.path) === index)) unresolved.push('mapping has no indexed TS/JS source: '+m.kind+':'+m.id);
  });
  const edges = new Map<string,CodeGraphEdge>();
  for (const relation of material.imports) {
    const from = relation.path, targets = relation.targets;
    if (relation.resolution !== 'resolved') unresolved.push('unresolved import: '+from+':'+relation.line+' -> '+relation.module);
    const fromIndex = ownerOf(from);
    if (fromIndex === null || mappings[fromIndex]!.kind !== 'module') continue;
    const a = mappings[fromIndex]!;
    for (const target of targets) {
      const targetIndex = ownerOf(target.path);
      if (targetIndex === null) continue;
      const b = mappings[targetIndex]!;
      if (a.kind === b.kind && a.id === b.id) continue;
      const key=a.kind+':'+a.id+'->'+b.kind+':'+b.id;
      edges.set(key,{edgeId:sha256Hex(key),structuralKey:key,fromNode:a.kind+':'+a.id,toNode:b.kind+':'+b.id,kind:b.kind==='module'?'module_dependency':'interface_uses'});
    }
  }
  const snapshot:ArchitectureSourceSnapshotV1={schemaVersion:1,...scope,sourceDigest:material.manifestDigest,commitHash:material.commit,
    indexVersion:material.engine+'@'+material.engineVersion,configPath:material.configPath,mappings:structuredClone(mappings),
    indexedSources: material.sources.map(source => ({ path: source.path, digest: source.digest })), nodes,
    edges:[...edges.values()].sort((a,b)=>a.structuralKey.localeCompare(b.structuralKey)),unresolved:[...new Set(unresolved)].sort()};
  const errors=architectureSourceIssues(snapshot); if(errors.length) throw Error(errors.join('; '));
  return snapshot;
}
