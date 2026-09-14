import type { StateLedger } from '../../contracts/ledger.js';
import type { ControlEngine } from '../../contracts/modules.js';
import type { ArtifactPort } from '../../contracts/artifact.js';
import type { InspectionPort } from '../../contracts/architecture-reconciler.js';
import type { ArchitectureCandidateProposalV1, ArchitectureCandidateProposalSnapshot, ArchitectureInspectionSnapshot } from '../../contracts/architecture-inspection.js';
import { architectureCandidateProposalRefFor, architectureInspectionRefFor, candidateProposalDigest } from '../../contracts/architecture-inspection.js';
import { candidateContentDigest } from '../../contracts/baseline-evolution.js';
import { buildRecordCandidateBaselineProposalCommand } from '../../contracts/commands/architecture.js';
import type { AgentPrincipalRefV1 } from '../../contracts/coordination.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { ArchitectureBaselineRevisionSnapshot } from '../../contracts/governance.js';
import { architectureReviewRef, architectureReviewBody, type ArchitectureReviewCommand, type ArchitectureReviewSnapshot, type ArchitectureReviewView } from '../../contracts/architecture-review.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type { ArchitectureReportInput } from '../../contracts/coordination-tools.js';
type Scope = {
    projectId: string;
    workspaceId: string;
};
export class ArchitectureReviewEntry {
    constructor(private readonly deps: {
        ledger: StateLedger;
        control: ControlEngine;
        vault: ArtifactPort;
        inspection: InspectionPort;
        now: () => string;
    }) { }
    private async version(ref: ArchitectureReviewSnapshot['ref'], revision?: number): Promise<ArchitectureReviewSnapshot> {
        const current = await this.deps.ledger.load(ref);
        if (current.status !== 'found')
            throw Error('待决项不存在');
        if (revision === undefined || current.snapshot.revision === revision)
            return current.snapshot as ArchitectureReviewSnapshot;
        let cursor: import('../../contracts/command-event.js').CommitCursor | null = null;
        for (let pageIndex = 0; pageIndex < 200; pageIndex++) {
            const page = await this.deps.ledger.events({ afterCursor: cursor, limit: 1000 });
            for (const row of page.events) {
                cursor = row.cursor;
                const e = row.event;
                if (e.eventType === 'ArchitectureReviewRecorded' && e.payload.snapshot.revision === revision && canonicalJson(e.payload.snapshot.ref) === canonicalJson(ref))
                    return e.payload.snapshot;
            }
            if (!page.hasMore)
                break;
        }
        throw Error('无法读取所选待决版本');
    }
    private async store(body: string, owner: ArchitectureReviewSnapshot['reporterRunRef']) {
        const result = await this.deps.vault.put({ body, contentType: 'application/json', ownerRef: owner, requestedAt: this.deps.now(), sourceRefs: [{ kind: 'artifact', refId: 'run:' + owner.runId, revision: 'architecture-review-v1' }] });
        if (result.status !== 'stored')
            throw Error('公开决定正文保存失败');
        return result.ref;
    }
    private async proposal(input: {
        projectId: string;
        workspaceId: string;
        id: string;
        source: ArchitectureCandidateProposalV1;
        description: string;
        owner: ArchitectureReviewSnapshot['reporterRunRef'];
        actor: ArchitectureReviewCommand['identity']['actor'];
    }) {
        const proposal: ArchitectureCandidateProposalV1 = { ...input.source, proposalId: input.id, normalizedContent: { ...input.source.normalizedContent, description: input.description } };
        proposal.expectedCandidateDigest = candidateContentDigest(proposal.normalizedContent);
        proposal.proposalDigest = candidateProposalDigest(proposal);
        proposal.bodyRef = await this.store(canonicalJson({ ...proposal, bodyRef: null }), input.owner);
        const cmd = 'proposal-' + input.id;
        const recorded = await this.deps.control.recordCandidateBaselineProposal(buildRecordCandidateBaselineProposalCommand(proposal, { commandId: cmd, actor: input.actor, idempotencyKey: cmd, correlationId: cmd, submittedAt: proposal.generatedAt }));
        if (recorded.status !== 'committed')
            throw Error('候选提案未受理：' + JSON.stringify(recorded));
        const proposalRef = architectureCandidateProposalRefFor(input.projectId, input.workspaceId, input.id), candidateId = 'candidate-' + input.id;
        const materialized = await this.deps.control.materializeCandidateBaseline({ schemaVersion: 1, commandType: 'MaterializeCandidateBaseline', commandId: 'materialize-' + input.id, identity: { projectId: input.projectId, actor: input.actor, idempotencyKey: 'materialize-' + input.id }, aggregateId: candidateId, expectedRevision: 0, correlationId: cmd, submittedAt: proposal.generatedAt, payload: { proposalRef } });
        if (materialized.status !== 'committed')
            throw Error('候选基线未受理：' + JSON.stringify(materialized));
        return { proposal, proposalRef, candidateRef: materialized.candidateRef };
    }
    async report(principal: AgentPrincipalRefV1, input: ArchitectureReportInput) {
        if (!input.key?.trim() || !input.description?.trim() || input.description.length > 4096 || !input.proposedDescription?.trim() || input.proposedDescription.length > 4096 || !Array.isArray(input.affectedWorkIds) || input.affectedWorkIds.length < 2 || input.affectedWorkIds.length > 64)
            throw Error('报告需说明两个工作包的冲突和待决方案');
        const { projectId, workspaceId } = principal.workContextRef;
        const runResult = await this.deps.ledger.load(principal.runRef);
        if (runResult.status !== 'found')
            throw Error('报告来源 Run 不存在');
        const run = runResult.snapshot as RunSnapshot;
        const planResult = await this.deps.ledger.load(run.planRef);
        if (planResult.status !== 'found')
            throw Error('报告来源 Plan 不存在');
        const plan = planResult.snapshot as PlanRevisionSnapshot;
        if (!plan.effectiveArchitectureBaseline)
            throw Error('当前 Plan 没有架构 pin');
        const baselineResult = await this.deps.ledger.load(plan.effectiveArchitectureBaseline.ref);
        if (baselineResult.status !== 'found')
            throw Error('当前架构基线不可读');
        const baseline = baselineResult.snapshot as ArchitectureBaselineRevisionSnapshot;
        const id = 'architecture-review-' + sha256Hex(canonicalJson([principal.runRef, input.key])).slice(0, 24);
        const inspected = await this.deps.inspection.inspect({ schemaVersion: 1, inspectionId: id, projectId, workspaceId, workspaceRevision: run.workspaceSnapshot.revision, planRef: run.planRef, baselinePin: plan.effectiveArchitectureBaseline, source: 'report', requestedByRunRef: principal.runRef, reportInput: { description: input.description, category: 'interface', risk: 'high', affectedRefs: input.affectedRefs }, budget: { maxTokens: null, deadline: null } });
        if (inspected.status !== 'recorded')
            throw Error('报告对账未受理：' + JSON.stringify(inspected));
        const inspectionResult = await this.deps.ledger.load(architectureInspectionRefFor(projectId, workspaceId, id));
        if (inspectionResult.status !== 'found')
            throw Error('检查记录不存在');
        const inspection = inspectionResult.snapshot as ArchitectureInspectionSnapshot;
        if (!inspection.briefRef)
            throw Error('报告未形成待决简报');
        const actor = { kind: 'agent' as const, id: principal.agentInstanceId, runRef: principal.runRef };
        const { schemaVersion: _schema, ...normalizedContent } = baseline.content;
        const briefResult = await this.deps.ledger.load(inspection.briefRef);
        if (briefResult.status !== 'found')
            throw Error('报告简报缺失');
        const source: ArchitectureCandidateProposalV1 = { schemaVersion: 1, proposalId: id, projectId, workspaceId, planRef: run.planRef, sourceBaselinePin: plan.effectiveArchitectureBaseline, selectedDeltaRef: null, selectedBriefRef: inspection.briefRef, selectedOptionId: 'propose-revision', normalizedContent, proposalDigest: '', expectedCandidateDigest: '', bodyRef: (briefResult.snapshot as import('../../contracts/architecture-inspection.js').ArchitectureDecisionBriefSnapshot).brief.bodyRef, generatedAt: inspection.recordedAt };
        const selected = await this.proposal({ projectId, workspaceId, id, source, description: input.proposedDescription, owner: principal.runRef, actor });
        const directory = await this.deps.ledger.workDirectory?.(projectId, workspaceId);
        if (directory?.status !== 'ready')
            throw Error('完整 Work 集不可读取');
        if (new Set(input.affectedWorkIds).size !== input.affectedWorkIds.length || input.affectedWorkIds.some(id => !directory.bindings.some(b => b.ref.workId === id)))
            throw Error('受影响 Work 不在当前工作区');
        const ref = architectureReviewRef(projectId, workspaceId, id), existing = await this.deps.ledger.load(ref);
        if (existing.status === 'found') {
            const original = await this.version(ref, 1);
            const affected = original.targets.filter(t => t.mode === 'resume').map(t => t.ref.workId).sort();
            if (canonicalJson(affected) !== canonicalJson([...input.affectedWorkIds].sort()))
                throw Error('idempotency_conflict: 同一报告 key 的受影响 Work 集发生变化');
        }
        const targets = existing.status === 'found' ? (await this.version(ref, 1)).targets : directory.bindings.map(b => ({ ref: b.ref, revision: b.revision, mode: input.affectedWorkIds.includes(b.ref.workId) ? 'resume' as const : 'notify' as const, reason: input.affectedWorkIds.includes(b.ref.workId) ? input.description.slice(0, 1024) : '未列入冲突；现行工作可继续' }));
        const summary = input.description;
        const body = architectureReviewBody({ ref, revision: 1, ...selected, proposalDigest: selected.proposal.proposalDigest, proposalContent: selected.proposal.normalizedContent, targets, status: 'pending', summary }, actor);
        const command: ArchitectureReviewCommand = { schemaVersion: 1, commandId: 'open-' + id, identity: { projectId, actor, idempotencyKey: 'open-' + id, agentPrincipal: principal }, correlationId: id, submittedAt: inspection.recordedAt, ref, expectedRevision: 0, action: { kind: 'open', reporterRunRef: principal.runRef, proposalRef: selected.proposalRef, candidateRef: selected.candidateRef, targets, bodyRef: await this.store(body, principal.runRef), summary } };
        const receipt = await this.deps.control.recordArchitectureReview(command);
        return { receipt, reviewRef: ref };
    }
    async decide(scope: Scope, input: Record<string, unknown>) {
        const field = (key: string) => {
            const x = input[key];
            if (typeof x !== 'string' || !x.trim())
                throw Error('缺少 ' + key);
            return x;
        };
        const requestId = field('requestId'), ref = architectureReviewRef(scope.projectId, scope.workspaceId, field('reviewId'));
        const expectedRevision = input['expectedRevision'];
        if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1)
            throw Error('缺少精确待决版本');
        const source = await this.version(ref, expectedRevision as number);
        const proposalDigest = field('proposalDigest');
        if (proposalDigest !== source.proposalDigest)
            throw Error('提案摘要已变化，请刷新');
        const outcome = field('outcome'), summary = field('summary');
        if (!['accept', 'reject', 'defer', 'modify'].includes(outcome) || summary.length > 4096)
            throw Error('决定无效');
        const actor = { kind: 'human' as const, id: 'local-gui' };
        let selected = { proposalRef: source.proposalRef, candidateRef: source.candidateRef, proposalDigest: source.proposalDigest, proposalContent: source.proposalContent }, targets = source.targets;
        if (outcome === 'modify') {
            const p = await this.deps.ledger.load(source.proposalRef);
            if (p.status !== 'found')
                throw Error('原提案缺失');
            const proposal = (p.snapshot as ArchitectureCandidateProposalSnapshot).proposal;
            const replacement = await this.proposal({ ...scope, id: 'modified-' + sha256Hex(canonicalJson([ref, requestId])).slice(0, 24), source: proposal, description: field('description'), owner: source.reporterRunRef, actor });
            selected = { proposalRef: replacement.proposalRef, candidateRef: replacement.candidateRef, proposalDigest: replacement.proposal.proposalDigest, proposalContent: replacement.proposal.normalizedContent };
            const current = await this.version(ref);
            if (current.revision > source.revision)
                targets = (await this.version(ref, source.revision + 1)).targets;
            else {
                const directory = await this.deps.ledger.workDirectory?.(scope.projectId, scope.workspaceId);
                if (directory?.status !== 'ready')
                    throw Error('完整 Work 集不可读取');
                targets = directory.bindings.map(b => ({ ...source.targets.find(t => canonicalJson(t.ref) === canonicalJson(b.ref)), ref: b.ref, revision: b.revision, mode: source.targets.find(t => canonicalJson(t.ref) === canonicalJson(b.ref))?.mode ?? 'notify', reason: source.targets.find(t => canonicalJson(t.ref) === canonicalJson(b.ref))?.reason ?? '新加入的 Work；通知当前决定' }));
            }
        }
        const body = architectureReviewBody({ ref, revision: source.revision + 1, ...selected, targets, status: outcome === 'modify' ? 'pending' : outcome === 'accept' ? 'accepted' : outcome === 'reject' ? 'rejected' : 'deferred', summary }, actor);
        const bodyRef = await this.store(body, source.reporterRunRef);
        const command: ArchitectureReviewCommand = { schemaVersion: 1, commandId: 'human-review-' + requestId, identity: { projectId: scope.projectId, actor, idempotencyKey: 'human-review-' + requestId }, correlationId: requestId, submittedAt: this.deps.now(), ref, expectedRevision: source.revision, action: outcome === 'modify' ? { kind: 'modify', proposalDigest, proposalRef: selected.proposalRef, candidateRef: selected.candidateRef, targets, bodyRef, summary } : { kind: 'decide', proposalDigest, outcome: outcome as 'accept' | 'reject' | 'defer', bodyRef, summary } };
        return this.deps.control.recordArchitectureReview(command);
    }
}
