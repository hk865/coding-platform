import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { ownerNodesOf, ownershipRuleOf, type OwnershipV1 } from '../../contracts/architecture-catalog.js';
import type { ArchitectureSourceSnapshotV1, ArchitectureSourceMapping } from '../../contracts/architecture-source.js';
import { architectureSourceIssues, compactUnresolvedLines } from '../../contracts/architecture-source.js';
import type { CodeGraphEdge, CodeGraphNode } from '../../contracts/architecture-inspection.js';

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
 * File ownership is the ONE layered decision `ownershipRuleOf`: a file belongs to the
 * module with the longest legal path (a `.` mapping is the root, owns every relative path
 * at match length 0 and is beaten by any concrete prefix; an equal-longest tie owns
 * nothing), then to the interface with the longest legal path among that module's
 * interfaces. A module node's members are all of its files, the ones in its interfaces
 * included; an interface node's members are that interface's files. Ownership is always
 * decided over the FULL mapping list, which is the list the snapshot stores and the body
 * recheck and the file anchors read; an interface that owns no frozen source gets no
 * node, but its mapping stays, so a tie it takes part in stays a tie. Nodes, edges and
 * `unresolved` all use the same per-file result.
 *
 * `count` is the number of references between the two endpoints, one per import target:
 * a reference across two modules adds to `module→module`; one inside a module adds to
 * `interface→interface` when its two files are in different interfaces of that module,
 * and to no edge otherwise. The count is a value of the edge, never part of its identity
 * (`structuralKey = canonicalJson([fromNode, toNode])`, `edgeId` its SHA-256).
 *
 * `mode` is the explicit §10 item 1 switch. Observation compacts before
 * validation (no `indexedSources`, unresolved cut to the §11.2 caps); strict
 * keeps the capture's full `indexedSources` and full de-duplicated/sorted
 * unresolved list, so its 240 KiB check and contract stay as they were.
 */
export function mapArchitectureSource(material: ArchitectureSourceMaterial,
  scope: {projectId:string;workspaceId:string;workspaceRevision:number}, mappings: ArchitectureSourceMapping[],
  mode: 'strict' | 'observation'): ArchitectureSourceSnapshotV1 {
  if (!material.sources.length) throw Error('no project sources; this graph provider does not claim Python/C++ coverage');
  // One ownership decision per path over the full list; a `null` module is not mapped.
  const ownership = ownershipRuleOf(mappings);
  const ownerByPath = new Map<string, OwnershipV1>();
  const ownerOf = (path: string): OwnershipV1 => {
    let owner = ownerByPath.get(path);
    if (owner === undefined) {
      owner = ownership(path);
      ownerByPath.set(path, owner);
    }
    return owner;
  };
  const members = new Map<string, { path: string; digest: string }[]>();
  const addMember = (nodeId: string, source: { path: string; digest: string }): void => {
    const files = members.get(nodeId);
    if (files === undefined) members.set(nodeId, [source]);
    else files.push(source);
  };
  const unresolved: string[] = [];
  for (const source of material.sources) {
    const nodeIds = ownerNodesOf(ownerOf(source.path));
    if (nodeIds.length === 0) unresolved.push('unmapped source: ' + source.path);
    for (const nodeId of nodeIds) addMember(nodeId, source);
  }
  const nodes: CodeGraphNode[] = [];
  for (const mapping of mappings) {
    const nodeId = mapping.kind + ':' + mapping.id;
    const files = members.get(nodeId);
    // No member, no node; only a module without one is reported.
    if (files === undefined) {
      if (mapping.kind === 'module') unresolved.push('mapping has no indexed TS/JS source: ' + nodeId);
      continue;
    }
    nodes.push({ nodeId, structuralKey: nodeId, kind: mapping.kind, name: mapping.id, path: mapping.paths[0]!,
      contentDigest: sha256Hex(canonicalJson(files)) });
  }
  nodes.sort((a, b) => a.structuralKey.localeCompare(b.structuralKey));
  const edges = new Map<string, CodeGraphEdge>();
  const addReference = (fromNode: string, toNode: string, kind: CodeGraphEdge['kind']): void => {
    const structuralKey = canonicalJson([fromNode, toNode]);
    const edge = edges.get(structuralKey);
    if (edge !== undefined) edge.count += 1;
    else edges.set(structuralKey, { edgeId: sha256Hex(structuralKey), structuralKey, fromNode, toNode, kind, count: 1 });
  };
  for (const relation of material.imports) {
    if (relation.resolution !== 'resolved') unresolved.push('unresolved import: '+relation.path+':'+relation.line+' -> '+relation.module);
    const [fromModule, fromInterface] = ownerNodesOf(ownerOf(relation.path));
    if (fromModule === undefined) continue;
    for (const target of relation.targets) {
      const [toModule, toInterface] = ownerNodesOf(ownerOf(target.path));
      if (toModule === undefined) continue;
      if (fromModule !== toModule) addReference(fromModule, toModule, 'module_dependency');
      else if (fromInterface !== undefined && toInterface !== undefined && fromInterface !== toInterface)
        addReference(fromInterface, toInterface, 'interface_uses');
    }
  }
  // §10 item 2 / §11.2: ONLY the observation path compacts, and it compacts
  // BEFORE `architectureSourceIssues`. It never carries `indexedSources` (the
  // file layer owns path+digest) and its unresolved evidence is cut to the cap.
  // The strict path keeps the capture's full sources and unresolved list, so the
  // unchanged 240 KiB contract check sees the whole snapshot. Node member digests
  // are always computed from the full frozen `material.sources`.
  const unresolvedLines=[...new Set(unresolved)].sort();
  const snapshot:ArchitectureSourceSnapshotV1={schemaVersion:1,...scope,sourceDigest:material.manifestDigest,commitHash:material.commit,
    indexVersion:material.engine+'@'+material.engineVersion,configPath:material.configPath,mappings:structuredClone(mappings),
    ...(mode === 'strict' ? {indexedSources:material.sources} : {}),
    nodes,
    edges:[...edges.values()].sort((a,b)=>a.structuralKey.localeCompare(b.structuralKey)),
    unresolved:mode === 'observation' ? compactUnresolvedLines(unresolvedLines) : unresolvedLines};
  const errors=architectureSourceIssues(snapshot); if(errors.length) throw Error(errors.join('; '));
  return snapshot;
}
