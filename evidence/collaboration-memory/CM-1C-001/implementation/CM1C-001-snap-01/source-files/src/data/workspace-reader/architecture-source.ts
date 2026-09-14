import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type { ArchitectureSourceSnapshotV1, ArchitectureSourceMapping } from '../../contracts/architecture-source.js';
import { architectureSourceIssues } from '../../contracts/architecture-source.js';
import type { CodeGraphEdge } from '../../contracts/architecture-inspection.js';
import { ProjectSourceIndex } from './project-source-index.js';

/** TS/JS semantic imports, collapsed only through explicit baseline mappings. */
export async function captureArchitectureSource(index: ProjectSourceIndex,
  scope: {projectId:string;workspaceId:string;workspaceRevision:number}, mappings: ArchitectureSourceMapping[], configPath?: string): Promise<ArchitectureSourceSnapshotV1> {
  const material = await index.architectureMaterials(configPath);
  if (!material.sources.length) throw Error('no TS/JS project sources; this graph provider does not claim Python/C++ coverage');
  const inMapping = (p:string,m:ArchitectureSourceMapping) => m.paths.some(prefix => p === prefix || p.startsWith(prefix + '/'));
  const nodes = mappings.filter(m=>material.sources.some(f=>inMapping(f.path,m))).map(m => {
    const files = material.sources.filter(f => inMapping(f.path,m));
    return {nodeId:m.kind+':'+m.id,structuralKey:m.kind+':'+m.id,kind:m.kind,name:m.id,path:m.paths[0]!,contentDigest:sha256Hex(canonicalJson(files))};
  }).sort((a,b)=>a.structuralKey.localeCompare(b.structuralKey));
  const unresolved = material.sources.filter(f => !mappings.some(m => inMapping(f.path,m))).map(f => 'unmapped source: '+f.path);
  for (const m of mappings) if (!material.sources.some(f=>inMapping(f.path,m))) unresolved.push('mapping has no indexed TS/JS source: '+m.kind+':'+m.id);
  const edges = new Map<string,CodeGraphEdge>();
  for (const relation of material.imports) {
    const from = String(relation['path']), targets = relation['targets'] as {path:string}[];
    if (relation['resolution'] !== 'resolved') unresolved.push('unresolved import: '+from+':'+String(relation['line'])+' -> '+String(relation['module']));
    for (const target of targets) for (const a of mappings.filter(m => m.kind === 'module' && inMapping(from,m))) for (const b of mappings.filter(m => inMapping(target.path,m))) {
      if (a.kind === b.kind && a.id === b.id) continue;
      const key=a.kind+':'+a.id+'->'+b.kind+':'+b.id;
      edges.set(key,{edgeId:sha256Hex(key),structuralKey:key,fromNode:a.kind+':'+a.id,toNode:b.kind+':'+b.id,kind:b.kind==='module'?'module_dependency':'interface_uses'});
    }
  }
  const snapshot:ArchitectureSourceSnapshotV1={schemaVersion:1,...scope,sourceDigest:material.provenance.manifestDigest,commitHash:material.provenance.commit,
    indexVersion:material.provenance.engine+'@'+material.provenance.engineVersion,configPath:material.configPath,mappings:structuredClone(mappings),nodes,
    edges:[...edges.values()].sort((a,b)=>a.structuralKey.localeCompare(b.structuralKey)),unresolved:[...new Set(unresolved)].sort()};
  const errors=architectureSourceIssues(snapshot); if(errors.length) throw Error(errors.join('; '));
  return snapshot;
}
