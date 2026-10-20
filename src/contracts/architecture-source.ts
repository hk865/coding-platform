import type { CodeGraphNode, CodeGraphEdge } from './architecture-inspection.js';
/** Explicit, versioned mapping; a directory name is not implicitly a product Module. */
export type ArchitectureSourceMapping = {
    id: string;
    kind: 'module' | 'interface';
    paths: string[];
};
// The one pure longest-prefix path-ownership decision lives in the Contracts
// layer; re-exported here so this module's callers are unchanged.
export { pathOwnershipOf, type PathOwnershipV1 } from './path-ownership.js';

export type ArchitectureSourceSnapshotV1 = {
    schemaVersion: 1;
    projectId: string;
    workspaceId: string;
    workspaceRevision: number;
    sourceDigest: string;
    commitHash: string | null;
    indexVersion: string;
    configPath: string | null;
    mappings: ArchitectureSourceMapping[];
    /** Exact indexed graph inputs, including JSON modules when the TS project indexes them. */
    indexedSources?: { path: string; digest: string }[];
    nodes: CodeGraphNode[];
    edges: CodeGraphEdge[];
    /** Unknown imports/unmapped sources are evidence gaps, never absent dependencies. */
    unresolved: string[];
};
/** §11.2 compact module snapshot caps: at most this many `unresolved` lines
 * AND at most this many UTF-8 bytes of the kept lines joined by `\n` (the
 * appended summary line is not counted). */
export const SNAPSHOT_UNRESOLVED_MAX_LINES = 500;
export const SNAPSHOT_UNRESOLVED_MAX_BYTES = 64 * 1024;
/** §11.2 "模块快照的没解析": de-duplicate, sort by string, keep at most
 * `SNAPSHOT_UNRESOLVED_MAX_LINES` lines and at most
 * `SNAPSHOT_UNRESOLVED_MAX_BYTES` UTF-8 bytes of their `\n`-joined text.
 * When anything is removed, append exactly one line
 * `另有 <n> 条没列出，逐条见文件层` with `n = removed count`. Deterministic,
 * pure, and shared by the snapshot builder and the observed-architecture service. */
export function compactUnresolvedLines(lines: readonly string[]): string[] {
    const sorted = [...new Set(lines)].sort();
    const kept: string[] = [];
    let bytes = 0;
    for (const line of sorted) {
        if (kept.length >= SNAPSHOT_UNRESOLVED_MAX_LINES) break;
        const addition = (kept.length === 0 ? 0 : 1) + Buffer.byteLength(line, 'utf8');
        if (bytes + addition > SNAPSHOT_UNRESOLVED_MAX_BYTES) break;
        kept.push(line);
        bytes += addition;
    }
    const removed = sorted.length - kept.length;
    if (removed > 0) kept.push('另有 ' + removed + ' 条没列出，逐条见文件层');
    return kept;
}
export function architectureSourceIssues(value: unknown): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return ['source binding must be an object'];
    const v = value as ArchitectureSourceSnapshotV1, errors: string[] = [];
    if (v.schemaVersion !== 1 || typeof v.projectId !== 'string' || !v.projectId || typeof v.workspaceId !== 'string' || !v.workspaceId || !Number.isSafeInteger(v.workspaceRevision) || v.workspaceRevision < 1)
        errors.push('invalid source scope/revision');
    if (typeof v.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(v.sourceDigest) || typeof v.indexVersion !== 'string' || !v.indexVersion || (v.commitHash !== null && (typeof v.commitHash !== 'string' || !/^[a-f0-9]{40,64}$/.test(v.commitHash))))
        errors.push('invalid source identity');
    // `filePath` is the strict check for real files and the configuration path.
    // `modulePath` additionally accepts exactly `.`, the root module/mapping path.
    const filePath = (p: unknown) => typeof p === 'string' && p.length > 0 && !/[\\:\0]/.test(p) && p.split('/').every(s => s && s !== '.' && s !== '..');
    const modulePath = (p: unknown) => p === '.' || filePath(p);
    if (v.configPath !== null && !filePath(v.configPath))
        errors.push('invalid configuration path');
    if (!Array.isArray(v.mappings) || v.mappings.length > 512 || v.mappings.some(m => !m || !m.id || !['module', 'interface'].includes(m.kind) || !Array.isArray(m.paths) || !m.paths.length || m.paths.some(p => !modulePath(p))))
        errors.push('invalid mappings');
    else if (new Set(v.mappings.map(m => m.kind + ':' + m.id)).size !== v.mappings.length)
        errors.push('duplicate mapping');
    if (v.indexedSources !== undefined) {
        if (!Array.isArray(v.indexedSources) || v.indexedSources.some(source => !source || !filePath(source.path) || typeof source.digest !== 'string' || !/^[a-f0-9]{64}$/.test(source.digest)))
            errors.push('invalid indexed sources');
        else if (new Set(v.indexedSources.map(source => source.path)).size !== v.indexedSources.length)
            errors.push('duplicate indexed source');
    }
    if (!Array.isArray(v.nodes) || v.nodes.length > 512 || v.nodes.some(n => !n || !n.nodeId || !n.structuralKey || !['module', 'interface'].includes(n.kind) || !modulePath(n.path) || !/^[a-f0-9]{64}$/.test(n.contentDigest)))
        errors.push('invalid mapped nodes');
    else if (new Set(v.nodes.map(n => n.nodeId)).size !== v.nodes.length || new Set(v.nodes.map(n => n.structuralKey)).size !== v.nodes.length)
        errors.push('duplicate node');
    if (!Array.isArray(v.edges) || v.edges.length > 1024 || v.edges.some(e => !e || !e.edgeId || !e.structuralKey || !['module_dependency', 'interface_uses'].includes(e.kind)))
        errors.push('invalid edges');
    else if (Array.isArray(v.nodes)) {
        const ids = new Set(v.nodes.map(n => n?.nodeId));
        if (v.edges.some(e => !ids.has(e.fromNode) || !ids.has(e.toNode)))
            errors.push('dangling edge');
        if (new Set(v.edges.map(e => e.structuralKey)).size !== v.edges.length)
            errors.push('duplicate edge');
    }
    if (!Array.isArray(v.unresolved) || v.unresolved.length > 2048 || v.unresolved.some(x => typeof x !== 'string' || !x || x.length > 4096))
        errors.push('invalid unresolved relations');
    if (Buffer.byteLength(JSON.stringify(v)) > 240 * 1024)
        errors.push('source binding exceeds capacity');
    return errors;
}
