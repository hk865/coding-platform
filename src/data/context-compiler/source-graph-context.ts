import type { StateLedger } from '../../contracts/ledger.js';
import type { ArtifactPort } from '../../contracts/artifact.js';
import type { WorkspaceReadPort, CodeGraphReadQueryV1, CodeGraphReadResultV1 } from '../../contracts/workspace-read.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import type { ArchitectureBaselineRevisionSnapshot } from '../../contracts/governance.js';
import { architectureSourceDigest } from '../../contracts/architecture-source.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import type { ArchitectureSourceCapturePort } from '../../contracts/architecture-source.js';
/** Fresh source snapshots resolved through canonical plan, workspace and reader scope. */
export class SourceGraphContextCompiler implements WorkspaceReadPort {
    constructor(private readonly deps: {
        ledger: () => StateLedger;
        vault: () => ArtifactPort;
        source: ArchitectureSourceCapturePort;
        now: () => string;
    }) { }
    async read(query: CodeGraphReadQueryV1): Promise<CodeGraphReadResultV1> {
        const reject = (message: string): CodeGraphReadResultV1 => ({ status: 'rejected', code: 'scope_forbidden', issues: [message] });
        const ledger = this.deps.ledger();
        if (!query.requesterRunRef)
            return { status: 'unsupported', message: 'a real reader Run is required for source graph material' };
        const loaded = await ledger.load(query.requesterRunRef);
        if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'Run')
            return reject('reader Run not found');
        const run = loaded.snapshot as RunSnapshot;
        if (run.ref.projectId !== query.projectId || run.workspaceSnapshot.workspaceId !== query.workspaceId || canonicalJson(run.planRef) !== canonicalJson(query.planRef) || !run.envelope?.permissions.tools.includes('read'))
            return reject('reader source scope mismatch');
        const plan = await ledger.load(query.planRef);
        if (plan.status !== 'found' || plan.snapshot.ref.aggregateType !== 'PlanRevision' || canonicalJson((plan.snapshot as import('../../contracts/plan.js').PlanRevisionSnapshot).effectiveArchitectureBaseline) !== canonicalJson(query.baselinePin))
            return reject('plan pin mismatch');
        const baseline = await ledger.load(query.baselinePin.ref);
        if (baseline.status !== 'found' || baseline.snapshot.ref.aggregateType !== 'ArchitectureBaselineRevision' || (baseline.snapshot as ArchitectureBaselineRevisionSnapshot).contentDigest !== query.baselinePin.digest)
            return reject('baseline unavailable or mismatched');
        const binding = (baseline.snapshot as ArchitectureBaselineRevisionSnapshot).content.sourceBinding;
        if (!binding)
            return { status: 'unsupported', message: 'pinned baseline has no source binding; prepare an explicit baseline revision' };
        const ref = { aggregateType: 'Workspace' as const, projectId: query.projectId, workspaceId: query.workspaceId };
        const current = await ledger.load(ref);
        if (current.status !== 'found')
            return reject('workspace unavailable');
        if (current.snapshot.revision !== query.workspaceRevision)
            return { status: 'stale', expectedRevision: current.snapshot.revision, observedRevision: query.workspaceRevision, message: 'canonical workspace changed' };
        try {
            const source = await this.deps.source.capture({ projectId: query.projectId, workspaceId: query.workspaceId, workspaceRevision: query.workspaceRevision, mappings: binding.mappings, ...(binding.configPath ? { configPath: binding.configPath } : {}) });
            const after = await ledger.load(ref);
            if (after.status !== 'found' || after.snapshot.revision !== query.workspaceRevision)
                return { status: 'stale', expectedRevision: after.status === 'found' ? after.snapshot.revision : query.workspaceRevision, observedRevision: query.workspaceRevision, message: 'workspace changed during graph capture' };
            if (source.nodes.length > query.maxNodes || source.edges.length > query.maxEdges)
                return { status: 'unsupported', message: 'complete graph exceeds requested capacity' };
            const generatedAt = this.deps.now(), snapshotId = architectureSourceDigest(source);
            const body = { schemaVersion: 1 as const, snapshotId, projectId: query.projectId, workspaceId: query.workspaceId, workspaceRevision: query.workspaceRevision, planRef: query.planRef, baselinePin: query.baselinePin,
                gitRef: source.commitHash ? { commitHash: source.commitHash, treeDigest: source.sourceDigest } : null, nodes: source.nodes, edges: source.edges,
                indexCapabilities: { hasCodeGraph: true, degradesToText: false, graphRevision: source.indexVersion }, sourceSnapshot: source, generatedAt };
            const stored = await this.deps.vault().put({ body: canonicalJson(body), contentType: 'application/json', ownerRef: query.requesterRunRef, requestedAt: generatedAt,
                sourceRefs: [{ kind: 'workspace', refId: query.workspaceId, revision: String(query.workspaceRevision), digest: source.sourceDigest }] });
            if (stored.status !== 'stored')
                return { status: 'rejected', code: 'unavailable', issues: [JSON.stringify(stored)] };
            return { status: 'sourced', snapshot: { ...body, bodyRef: stored.ref }, provenance: { readAt: generatedAt, source: 'workspace_snapshot', revision: query.workspaceRevision,
                    coverage: { hasCodeGraph: true, degradesToText: false, coveredPaths: source.mappings.flatMap(m => m.paths) }, sourceCursor: null } };
        }
        catch (error) {
            return { status: 'rejected', code: 'unavailable', issues: [String(error)] };
        }
    }
}
