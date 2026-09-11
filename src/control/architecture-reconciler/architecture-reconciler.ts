import { computeArchitectureDelta } from './architecture-delta.js';
import type { ArchitectureInspectionIntentV1, ArchitectureInspectionSnapshot, ArchitectureFindingV1, ArchitectureDecisionBriefV1, CodeGraphSnapshotV1 } from '../../contracts/architecture-inspection.js';
import { architectureFindingRefFor, architectureInspectionRefFor, architectureDecisionBriefRefFor, INSPECTION_MAX_DELTA_CHANGES } from '../../contracts/architecture-inspection.js';
import type { InspectionPort, InspectResultV1 } from '../../contracts/architecture-reconciler.js';
import type { ArtifactPort, ArtifactRef } from '../../contracts/artifact.js';
import type { ControlEngine } from '../../contracts/modules.js';
import { architectureSourceDigest, type ArchitectureSourceSnapshotV1 } from '../../contracts/architecture-source.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { buildRecordArchitectureInspectionCommand, buildRecordArchitectureFindingCommand, buildRecordArchitectureDecisionBriefCommand } from '../../contracts/commands/architecture.js';
import type { ArchitectureContextPort } from '../../contracts/architecture-context.js';
export type ArchitectureReconcilerDeps = {
    context: ArchitectureContextPort;
    vault: ArtifactPort;
    control: Pick<ControlEngine, 'recordArchitectureInspection' | 'recordArchitectureFinding' | 'recordArchitectureDecisionBrief'>;
    now: () => string;
};
type Code = Extract<InspectResultV1, {
    status: 'fail_closed';
}>['code'];
class ReconcileFailure extends Error {
    constructor(readonly code: Code, message: string) { super(message); }
}
/** Source delta, explicit uncertainty, then receipt-guarded durable records.
 * No baseline activation or guessed candidate policy follows from a code change. */
export class ArchitectureReconcilerImpl implements InspectionPort {
    constructor(private readonly deps: ArchitectureReconcilerDeps) { }
    async inspect(intent: ArchitectureInspectionIntentV1): Promise<InspectResultV1> {
        try {
            const compiled = await this.deps.context.assemble(intent);
            if (compiled.status !== 'ready')
                return compiled;
            const { baseline, readerRevision, priorRecordedAt, sources } = compiled.materials;
            const at = priorRecordedAt ?? this.deps.now();
            let snapshotRef: ArtifactRef | null = null, deltaRef: ArtifactRef | null = null;
            const findings: ArchitectureFindingV1[] = [];
            const common = { schemaVersion: 1 as const, projectId: intent.projectId, workspaceId: intent.workspaceId, workspaceRevision: intent.workspaceRevision, planRef: intent.planRef, baselinePin: intent.baselinePin, generatedAt: at };
            if (intent.source === 'report') {
                const report = intent.reportInput!;
                findings.push({ ...common, findingId: intent.inspectionId + '-report', source: 'interface_report', deltaRef: null, category: report.category, risk: report.risk, confidence: 'low',
                    title: 'Reported ' + report.category + ' question', summary: report.description, sources: [{ kind: 'run', refKey: canonicalJson(intent.requestedByRunRef), version: String(readerRevision), label: 'unverified report; not a mechanical verdict' }],
                    recommendation: 'Review supplied sources and affected contracts before accepting a change.', affectedRefs: report.affectedRefs, material: report.risk === 'high', ambiguous: true });
            }
            else {
                if (!sources)
                    throw new ReconcileFailure('workspace_unavailable', 'inspection source pair unavailable');
                const { baseline: base, current } = sources;
                const before = await this.graph(intent, base, at), after = await this.graph(intent, current, at);
                snapshotRef = after.bodyRef;
                const delta = computeArchitectureDelta(before, after);
                if (delta.changes.length > INSPECTION_MAX_DELTA_CHANGES)
                    throw new ReconcileFailure('workspace_unavailable', 'delta exceeds capacity; split explicit inspection scope');
                const { bodyRef: _unused, ...deltaBody } = delta;
                deltaRef = await this.store(intent, deltaBody, at, current.sourceDigest);
                for (const change of delta.changes) {
                    const node = [...after.nodes, ...before.nodes].find(n => n.structuralKey === change.structuralKey);
                    const category = change.level === 'edge' ? 'dependency' : node?.kind === 'interface' ? 'interface' : 'structure';
                    const edge = after.edges.find(e => e.structuralKey === change.structuralKey);
                    const violation = edge && baseline.content.dependencyRules?.find(rule => edge.kind === 'module_dependency' && edge.fromNode === 'module:' + rule.fromModule && edge.toNode === 'module:' + rule.toModule);
                    const uncertain = !violation && category !== 'structure';
                    findings.push({ ...common, findingId: intent.inspectionId + '-' + sha256Hex(change.changeId).slice(0, 20), source: 'workspace_delta', deltaRef, category, risk: violation ? 'high' : uncertain ? 'medium' : 'low', confidence: 'high',
                        title: violation ? 'Forbidden dependency: ' + violation.fromModule + ' -> ' + violation.toModule : change.label, summary: canonicalJson(violation ? { change, violatedRule: violation } : change), sources: [{ kind: 'artifact', refKey: deltaRef.digest, version: architectureSourceDigest(current), label: violation ? 'explicit pinned dependency rule violated' : 'mechanical difference; no correctness verdict' }],
                        recommendation: violation ? 'Restore the permitted dependency direction or submit an explicit baseline revision.' : uncertain ? 'Review the changed dependency/interface against the pinned contract.' : 'Inspect the mechanical change against the task obligation.',
                        affectedRefs: { moduleRefs: violation ? [violation.fromModule, violation.toModule] : node?.kind === 'module' ? [node.name] : [], interfaceRefs: node?.kind === 'interface' ? [node.name] : [], pathRefs: node ? [node.path] : [] }, material: !!violation, ambiguous: uncertain });
                }
                const newlyUnknown = current.unresolved.filter(x => !base.unresolved.includes(x));
                if (newlyUnknown.length)
                    findings.push({ ...common, findingId: intent.inspectionId + '-unknown', source: 'workspace_delta', deltaRef, category: 'dependency', risk: 'medium', confidence: 'low', title: 'New unresolved source relations',
                        summary: newlyUnknown.slice(0, 8).join('\n') + '\nFull unresolved relations: ' + snapshotRef.digest, sources: [{ kind: 'artifact', refKey: snapshotRef.digest, version: architectureSourceDigest(current), label: 'unresolved relations, not missing dependencies' }],
                        recommendation: 'Supply readable dependencies or refine the explicit module mapping.', affectedRefs: { moduleRefs: [], interfaceRefs: [], pathRefs: [] }, material: false, ambiguous: true });
            }
            const ambiguous = findings.filter(f => f.material || f.ambiguous);
            if (ambiguous.length > 16)
                throw new ReconcileFailure('workspace_unavailable', 'more than 16 semantic questions; split inspection scope');
            let brief: ArchitectureDecisionBriefV1 | null = null;
            if (ambiguous.length) {
                const moduleRefs = [...new Set(ambiguous.flatMap(f => f.affectedRefs.moduleRefs))], interfaceRefs = [...new Set(ambiguous.flatMap(f => f.affectedRefs.interfaceRefs))];
                const body = { schemaVersion: 1 as const, briefId: intent.inspectionId + '-brief', projectId: intent.projectId, workspaceId: intent.workspaceId, planRef: intent.planRef, baselinePin: intent.baselinePin,
                    findingRefs: ambiguous.map(f => architectureFindingRefFor(f.projectId, f.workspaceId, f.findingId)), originalReasons: ambiguous.slice(0, 8).map(f => f.title), impact: { affectedModules: moduleRefs, affectedInterfaces: interfaceRefs, affectedPlans: [intent.planRef.planId] },
                    options: [{ optionId: 'investigate', summary: 'Investigate these source-backed questions under current authority.', affectedRefs: { moduleRefs, interfaceRefs }, risk: 'low' as const, deferralImpact: 'The listed questions remain unverified.' },
                        { optionId: 'propose-revision', summary: 'Prepare an explicit contract revision and migration proposal for decision.', affectedRefs: { moduleRefs, interfaceRefs }, risk: 'medium' as const, deferralImpact: 'Current baseline remains authoritative.' }],
                    risk: ambiguous.some(f => f.risk === 'high') ? 'high' as const : 'medium' as const, deferralConsequence: 'These questions remain open; no baseline or completion state is changed.', generatedAt: at };
                brief = { ...body, bodyRef: await this.store(intent, body, at) };
            }
            const inspection: ArchitectureInspectionSnapshot = { ref: architectureInspectionRefFor(intent.projectId, intent.workspaceId, intent.inspectionId), revision: 1, schemaVersion: 1, intent, snapshotRef, deltaRef,
                findingRefs: findings.map(f => architectureFindingRefFor(f.projectId, f.workspaceId, f.findingId)), briefRef: brief ? architectureDecisionBriefRefFor(brief.projectId, brief.workspaceId, brief.briefId) : null, proposalRef: null, recordedAt: at };
            this.require(await this.deps.control.recordArchitectureInspection(buildRecordArchitectureInspectionCommand(inspection, this.commandIdentity(intent.inspectionId + '-rec-inspection', at))));
            for (const finding of findings)
                this.require(await this.deps.control.recordArchitectureFinding(buildRecordArchitectureFindingCommand(finding, this.commandIdentity(finding.findingId + '-rec-finding', at))));
            if (brief)
                this.require(await this.deps.control.recordArchitectureDecisionBrief(buildRecordArchitectureDecisionBriefCommand(brief, this.commandIdentity(brief.briefId + '-rec-brief', at))));
            return { status: 'recorded', outcome: { status: 'recorded', inspectionRef: inspection.ref, findingCount: findings.length } };
        }
        catch (error) {
            if (error instanceof ReconcileFailure)
                return { status: 'fail_closed', code: error.code, diagnostics: [error.message] };
            throw error;
        }
    }
    private commandIdentity(commandId: string, submittedAt: string) { return { commandId, submittedAt, actor: { kind: 'system' as const, id: 'architecture-reconciler' }, idempotencyKey: commandId + '-idem', correlationId: commandId + '-corr' }; }
    private async store(intent: ArchitectureInspectionIntentV1, body: unknown, at: string, sourceDigest?: string) {
        const stored = await this.deps.vault.put({ body: canonicalJson(JSON.parse(JSON.stringify(body))), contentType: 'application/json', ownerRef: intent.requestedByRunRef!, requestedAt: at,
            sourceRefs: [{ kind: 'workspace', refId: intent.workspaceId, revision: String(intent.workspaceRevision), digest: sourceDigest ?? intent.baselinePin.digest }] });
        if (stored.status !== 'stored')
            throw new ReconcileFailure('recording_rejected', JSON.stringify(stored));
        return stored.ref;
    }
    private async graph(intent: ArchitectureInspectionIntentV1, source: ArchitectureSourceSnapshotV1, at: string): Promise<CodeGraphSnapshotV1> {
        const body = { schemaVersion: 1 as const, snapshotId: architectureSourceDigest(source), projectId: source.projectId, workspaceId: source.workspaceId, workspaceRevision: source.workspaceRevision, planRef: intent.planRef, baselinePin: intent.baselinePin,
            gitRef: source.commitHash ? { commitHash: source.commitHash, treeDigest: source.sourceDigest } : null, nodes: source.nodes, edges: source.edges, indexCapabilities: { hasCodeGraph: true, degradesToText: false, graphRevision: source.indexVersion }, sourceSnapshot: source, generatedAt: at };
        return { ...body, bodyRef: await this.store(intent, body, at, source.sourceDigest) };
    }
    private require(receipt: {
        status: string;
    }) { if (receipt.status !== 'committed')
        throw new ReconcileFailure('recording_rejected', JSON.stringify(receipt)); }
}
export type { ArchitectureInspectionOutcome } from '../../contracts/architecture-inspection.js';
