import type { AggregateRef, AggregateSnapshot, ExpectedVersion } from './ledger.js';
import type { ArchitectureCandidateProposalSnapshot, ArchitectureDecisionBriefSnapshot } from './architecture-inspection.js';
import type { CandidateArchitectureBaselineSnapshot, ArchitectureChangeDecisionV1 } from './baseline-evolution.js';
import { architectureChangeDecisionRefFor } from './baseline-evolution.js';
import type { WorkContextBindingSnapshot } from './context-continuity.js';
import type { CommunicationIntentSnapshot, CommunicationIntentV1, DeliverySnapshot, WaitConditionSnapshot } from './coordination.js';
import { communicationIntentRefFor, deliveryRefFor, waitConditionRefFor } from './coordination.js';
import type { ArchitectureDeliveryCommand } from './architecture-review.js';
import { canonicalJson, sha256Hex } from './fingerprint.js';
import { ARCHITECTURE_REVIEW_MAX_WORKS, architectureWorkSetDigest, architectureReviewBody, type ArchitectureReviewCommand, type ArchitectureReviewSnapshot, type WorkDirectoryResult } from './architecture-review.js';
import { validateArtifactRefRef } from './validation/evidence.js';
const same = (a: unknown, b: unknown) => a === undefined || b === undefined ? a === b : canonicalJson(JSON.parse(JSON.stringify(a))) === canonicalJson(JSON.parse(JSON.stringify(b)));
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
export function validArchitectureReviewCommand(c: unknown): c is ArchitectureReviewCommand {
    if (!record(c) || c['schemaVersion'] !== 1 || !text(c['commandId']) || !text(c['correlationId']) || !text(c['submittedAt']) || !Number.isFinite(Date.parse(c['submittedAt'])) || !Number.isSafeInteger(c['expectedRevision']) || (c['expectedRevision'] as number) < 0)
        return false;
    if (!record(c['ref']) || c['ref']['aggregateType'] !== 'ArchitectureReview' || !text(c['ref']['projectId']) || !text(c['ref']['workspaceId']) || !text(c['ref']['reviewId']))
        return false;
    if (!record(c['identity']) || c['identity']['projectId'] !== c['ref']['projectId'] || !text(c['identity']['idempotencyKey']) || !record(c['identity']['actor']) || !['human', 'agent'].includes(String(c['identity']['actor']['kind'])) || !text(c['identity']['actor']['id']))
        return false;
    if (!record(c['action']) || !['open', 'modify', 'decide'].includes(String(c['action']['kind'])) || !text(c['action']['summary']) || c['action']['summary'].length > 4096)
        return false;
    const a = c['action'];
    const bodyIssues: import('./validation/common.js').ValidationIssue[] = [];
    if (!record(a['bodyRef']))
        return false;
    validateArtifactRefRef(a['bodyRef'], 'bodyRef', bodyIssues);
    if (bodyIssues.length)
        return false;
    if (a['kind'] === 'decide')
        return text(a['proposalDigest']) && ['accept', 'reject', 'defer'].includes(String(a['outcome'])) && c['expectedRevision'] !== 0;
    if (!record(a['proposalRef']) || a['proposalRef']['aggregateType'] !== 'ArchitectureCandidateProposal' || !text(a['proposalRef']['proposalId']) || a['proposalRef']['projectId'] !== c['ref']['projectId'] || a['proposalRef']['workspaceId'] !== c['ref']['workspaceId'])
        return false;
    if (!record(a['candidateRef']) || a['candidateRef']['aggregateType'] !== 'CandidateArchitectureBaseline' || !text(a['candidateRef']['candidateId']) || a['candidateRef']['projectId'] !== c['ref']['projectId'] || a['candidateRef']['workspaceId'] !== c['ref']['workspaceId'])
        return false;
    const scope = c['ref'];
    if (!Array.isArray(a['targets']) || a['targets'].length === 0 || a['targets'].length > ARCHITECTURE_REVIEW_MAX_WORKS)
        return false;
    if (!a['targets'].every(t => record(t) && record(t['ref']) && t['ref']['aggregateType'] === 'WorkContextBinding' && t['ref']['projectId'] === scope['projectId'] && t['ref']['workspaceId'] === scope['workspaceId'] && text(t['ref']['workId']) && Number.isSafeInteger(t['revision']) && (t['revision'] as number) >= 1 && ['notify', 'resume'].includes(String(t['mode'])) && text(t['reason']) && t['reason'].length <= 1024))
        return false;
    if (a['kind'] === 'modify')
        return text(a['proposalDigest']) && c['expectedRevision'] !== 0;
    return c['expectedRevision'] === 0 && record(a['reporterRunRef']) && a['reporterRunRef']['aggregateType'] === 'Run' && a['reporterRunRef']['projectId'] === c['ref']['projectId'] && text(a['reporterRunRef']['runId']) && text(a['reporterRunRef']['goalId']);
}
/** Complete canonical scope; never silently truncate or accept corrupt entries. */
export function selectArchitectureWorkDirectory(snapshots: AggregateSnapshot[], projectId: string, workspaceId: string): WorkDirectoryResult {
    const bindings = snapshots.filter(s => s.ref.aggregateType === 'WorkContextBinding' && s.ref.projectId === projectId && s.ref.workspaceId === workspaceId) as WorkContextBindingSnapshot[];
    if (bindings.length > ARCHITECTURE_REVIEW_MAX_WORKS)
        return { status: 'unavailable', reason: 'Work set exceeds capacity; no partial directory returned' };
    for (const s of bindings) {
        if (!s.binding || s.binding.projectId !== projectId || s.binding.workspaceId !== workspaceId || s.binding.workId !== s.ref.workId || !Number.isSafeInteger(s.revision) || s.revision < 1)
            return { status: 'unavailable', reason: 'Corrupt Work binding' };
    }
    bindings.sort((a, b) => canonicalJson(a.ref).localeCompare(canonicalJson(b.ref)));
    return { status: 'ready', bindings, digest: architectureWorkSetDigest(bindings) };
}
export type ArchitectureReviewFold = {
    snapshot: ArchitectureReviewSnapshot;
    decision: ArchitectureChangeDecisionV1 | null;
    intents: CommunicationIntentSnapshot[];
    guards: ExpectedVersion[];
};
/** Pure shared rule: Control chooses the transition; adapters verify the same values atomically. */
export function foldArchitectureReview(command: ArchitectureReviewCommand, get: (ref: AggregateRef) => AggregateSnapshot | undefined, directory: WorkDirectoryResult): ArchitectureReviewFold | {
    error: 'invalid' | 'stale' | 'forbidden' | 'not_found';
    reason: string;
} {
    const fail = (error: 'invalid' | 'stale' | 'forbidden' | 'not_found', reason: string) => ({ error, reason });
    if (!validArchitectureReviewCommand(command))
        return fail('invalid', 'Invalid architecture review command');
    const c = command, a = c.action, prior = get(c.ref) as ArchitectureReviewSnapshot | undefined;
    if ((prior?.revision ?? 0) !== c.expectedRevision || (prior && prior.status !== 'pending'))
        return fail('stale', 'Review version is no longer pending');
    if (a.kind !== 'open' && (!prior || a.proposalDigest !== prior.proposalDigest))
        return fail('stale', 'Decision must bind the exact displayed proposal');
    if (a.kind !== 'open' && c.identity.actor.kind !== 'human')
        return fail('forbidden', 'Only a human may decide or modify this review');
    const proposalRef = a.kind === 'decide' ? prior!.proposalRef : a.proposalRef;
    const candidateRef = a.kind === 'decide' ? prior!.candidateRef : a.candidateRef;
    const p = get(proposalRef) as ArchitectureCandidateProposalSnapshot | undefined;
    const candidate = get(candidateRef) as CandidateArchitectureBaselineSnapshot | undefined;
    if (!p?.proposal || !candidate?.candidate || !p.proposal.selectedBriefRef)
        return fail('not_found', 'Exact report proposal and candidate are required');
    const brief = get(p.proposal.selectedBriefRef) as ArchitectureDecisionBriefSnapshot | undefined;
    if (!brief?.brief || !same(candidate.candidate.proposalRef, proposalRef) || candidate.candidate.contentDigest !== p.proposal.expectedCandidateDigest || !same(candidate.candidate.parentSourcePin, p.proposal.sourceBaselinePin))
        return fail('invalid', 'Candidate/source chain differs');
    if (a.kind === 'modify' && (same(prior!.proposalRef, proposalRef) || !same(prior!.briefRef, p.proposal.selectedBriefRef)))
        return fail('invalid', 'Modification requires a new proposal from the same brief');
    const workspace = get({ aggregateType: 'Workspace', projectId: c.ref.projectId, workspaceId: c.ref.workspaceId });
    const active = get({ aggregateType: 'ProjectArchitectureBaselineActive', projectId: c.ref.projectId });
    if (!workspace || !active || !('activeRevision' in active) || !same(active.activeRevision, p.proposal.sourceBaselinePin.ref))
        return fail('stale', 'Current architecture baseline differs');
    if (a.kind !== 'open' && prior!.workspaceRevision !== workspace.revision)
        return fail('stale', 'Workspace changed since presentation');
    const reporterRunRef = a.kind === 'open' ? a.reporterRunRef : prior!.reporterRunRef;
    const reporter = get(reporterRunRef);
    if (!reporter || !('workspaceSnapshot' in reporter) || !('planRef' in reporter) || reporter.workspaceSnapshot.workspaceId !== c.ref.workspaceId || reporter.workspaceSnapshot.revision !== workspace.revision || !same(reporter.planRef, p.proposal.planRef))
        return fail('forbidden', 'Report requires a real Run in the exact workspace and plan');
    const guards: ExpectedVersion[] = [{ ref: c.ref, revision: c.expectedRevision }, { ref: p.ref, revision: 1 }, { ref: candidate.ref, revision: 1 }, { ref: brief.ref, revision: 1 }, { ref: workspace.ref, revision: workspace.revision }, { ref: active.ref, revision: active.revision }];
    for (const ref of brief.brief.findingRefs) {
        const finding = get(ref) as import('./architecture-inspection.js').ArchitectureFindingSnapshot | undefined;
        if (!finding?.finding || finding.finding.workspaceRevision !== workspace.revision || !same(finding.finding.planRef, p.proposal.planRef) || !same(finding.finding.baselinePin, p.proposal.sourceBaselinePin))
            return fail('stale', 'Report findings are not current for this workspace, plan and baseline');
        guards.push({ ref: finding.ref, revision: finding.revision });
    }
    if (!brief.brief.findingRefs.length)
        return fail('invalid', 'A review requires sourced report findings');
    if (c.identity.actor.kind === 'agent') {
        const principal = c.identity.agentPrincipal;
        if (!principal || !same(c.identity.actor.runRef, reporterRunRef) || !same(principal.runRef, reporterRunRef))
            return fail('forbidden', 'Report actor does not own the source Run');
        const work = get(principal.workContextRef) as WorkContextBindingSnapshot | undefined;
        const participation = get(principal.participationRef);
        if (!work?.binding || !participation || !('participation' in participation) || participation.participation.status !== 'active' || !same(work.binding.currentParticipationRef, principal.participationRef) || !work.binding.linkedRunRefs.some(r => same(r, reporterRunRef)) || participation.participation.agentInstanceId !== c.identity.actor.id)
            return fail('forbidden', 'Report participation is no longer current');
        if (principal.agentInstanceId !== c.identity.actor.id || !same(principal.roleBinding, participation.participation.roleBinding) || !same(participation.participation.workContextRef, principal.workContextRef) || principal.workContextRef.projectId !== c.ref.projectId || principal.workContextRef.workspaceId !== c.ref.workspaceId || principal.participationRef.projectId !== c.ref.projectId || principal.participationRef.workspaceId !== c.ref.workspaceId)
            return fail('forbidden', 'Report principal differs from canonical identity or role');
        guards.push({ ref: participation.ref, revision: participation.revision });
    }
    const targets = a.kind === 'decide' ? prior!.targets : a.targets;
    if (a.kind === 'open' && targets.filter(t => t.mode === 'resume').length < 2)
        return fail('invalid', 'Cross-work review requires at least two affected Works');
    if (a.kind === 'modify' && targets.some(t => t.mode !== (prior!.targets.find(old => same(old.ref, t.ref))?.mode ?? 'notify')))
        return fail('invalid', 'Modification cannot downgrade the recorded impact set');
    if (directory.status !== 'ready' || directory.bindings.length !== targets.length || directory.digest !== architectureWorkSetDigest(targets) || new Set(targets.map(t => canonicalJson(t.ref))).size !== targets.length)
        return fail('stale', 'Complete Work set changed; refresh the proposal before deciding');
    guards.push(...directory.bindings.map(b => ({ ref: b.ref, revision: b.revision })));
    const decisionRef = a.kind === 'decide' ? architectureChangeDecisionRefFor(c.ref.projectId, c.ref.workspaceId, 'human-review-' + sha256Hex(canonicalJson(c.ref)).slice(0, 24)) : null;
    const snapshot: ArchitectureReviewSnapshot = { ref: c.ref, revision: c.expectedRevision + 1, schemaVersion: 1, reporterRunRef, briefRef: p.proposal.selectedBriefRef, proposalRef, candidateRef, proposalDigest: p.proposal.proposalDigest, proposalContent: structuredClone(p.proposal.normalizedContent), workspaceRevision: workspace.revision, targets: structuredClone(targets), workSetDigest: directory.digest, bodyRef: a.bodyRef, status: a.kind === 'decide' ? a.outcome === 'accept' ? 'accepted' : a.outcome === 'reject' ? 'rejected' : 'deferred' : 'pending', decisionRef, summary: a.summary, recordedAt: c.submittedAt };
    const body = architectureReviewBody(snapshot, c.identity.actor);
    if (a.bodyRef.contentType !== 'application/json' || a.bodyRef.digest !== sha256Hex(body) || a.bodyRef.sizeBytes !== Buffer.byteLength(body, 'utf8'))
        return fail('invalid', 'Public body must match the exact proposal, targets and formal outcome');
    const decision: ArchitectureChangeDecisionV1 | null = a.kind === 'decide' ? { schemaVersion: 1, decisionId: decisionRef!.decisionId, projectId: c.ref.projectId, workspaceId: c.ref.workspaceId, subject: { fromPin: p.proposal.sourceBaselinePin, candidateRef }, outcome: a.outcome, actor: c.identity.actor, authority: { strategy: 'user', delegator: null, policyVersion: 'human-architecture-review-v1' }, authorizedTarget: { fromPin: p.proposal.sourceBaselinePin, candidateDigest: candidate.candidate.contentDigest }, summary: a.summary, decidedAt: c.submittedAt } : null;
    const intents: CommunicationIntentSnapshot[] = decision ? targets.map((_, targetIndex) => {
        const intentId = 'architecture-delivery-' + sha256Hex(canonicalJson([c.ref, snapshot.revision, targetIndex])).slice(0, 24);
        const intent: CommunicationIntentV1 = { schemaVersion: 1, intentId, projectId: c.ref.projectId, workspaceId: c.ref.workspaceId, domain: { kind: 'architecture_decision_delivery', reviewRef: c.ref, reviewRevision: snapshot.revision, targetIndex }, status: 'pending', leaseGeneration: 0, leaseOwner: null, leaseExpiresAt: null, attemptCount: 0, availableAt: c.submittedAt, lastFailureClass: null, sideEffectStarted: false, createdAt: c.submittedAt, settledAt: null };
        return { ref: { aggregateType: 'CommunicationIntent', projectId: c.ref.projectId, workspaceId: c.ref.workspaceId, intentId }, revision: 1, schemaVersion: 1, intent, recordedAt: c.submittedAt };
    }) : [];
    if (decisionRef)
        guards.push({ ref: decisionRef, revision: 0 });
    guards.push(...intents.map(i => ({ ref: i.ref, revision: 0 })));
    return { snapshot, decision, intents, guards };
}
export function foldArchitectureDelivery(c: ArchitectureDeliveryCommand, get: (ref: AggregateRef) => AggregateSnapshot | undefined): {
    delivery: DeliverySnapshot;
    intent: CommunicationIntentSnapshot;
    wait: WaitConditionSnapshot | null;
    guards: ExpectedVersion[];
} | null {
    if (c.identity.actor.kind !== 'system' || c.identity.actor.id !== c.payload.consumerId || !Number.isFinite(Date.parse(c.payload.settledAt)))
        return null;
    const ref = communicationIntentRefFor(c.identity.projectId, c.payload.workspaceId, c.aggregateId);
    const prior = get(ref) as CommunicationIntentSnapshot | undefined;
    if (!prior || prior.revision !== c.expectedRevision || prior.intent.domain.kind !== 'architecture_decision_delivery' || prior.intent.status !== 'leased' || prior.intent.leaseGeneration !== c.payload.leaseGeneration || prior.intent.leaseOwner !== c.payload.consumerId || !prior.intent.leaseExpiresAt || Date.parse(prior.intent.leaseExpiresAt) <= Date.parse(c.payload.settledAt))
        return null;
    const domain = prior.intent.domain, review = get(domain.reviewRef) as ArchitectureReviewSnapshot | undefined;
    if (!review || review.revision !== domain.reviewRevision || review.status === 'pending' || !review.decisionRef || review.ref.projectId !== c.identity.projectId || review.ref.workspaceId !== c.payload.workspaceId)
        return null;
    const target = review.targets[domain.targetIndex];
    const work = target ? get(target.ref) : undefined;
    if (!target || !work)
        return null;
    const decision = get(review.decisionRef);
    if (!decision || !('decision' in decision) || !('outcome' in decision.decision) || decision.decision.outcome !== (review.status === 'accepted' ? 'accept' : review.status === 'rejected' ? 'reject' : 'defer'))
        return null;
    const deliveryId = 'architecture-delivery-' + sha256Hex(canonicalJson([review.ref, review.revision, target.ref])).slice(0, 24);
    const delivery: DeliverySnapshot = { schemaVersion: 1, ref: deliveryRefFor(c.identity.projectId, c.payload.workspaceId, deliveryId), revision: 1, recordedAt: c.payload.settledAt, delivery: { schemaVersion: 1, deliveryId, projectId: c.identity.projectId, workspaceId: c.payload.workspaceId, origin: { kind: 'architecture_decision', reviewRef: review.ref, reviewRevision: review.revision, targetIndex: domain.targetIndex }, targetWorkContextRef: target.ref, bodyRef: review.bodyRef, sourceRefs: [{ kind: 'architecture_review', refId: review.ref.reviewId, revision: String(review.revision) }, { kind: 'architecture_decision', refId: review.decisionRef.decisionId, revision: '1' }], createdAt: c.payload.settledAt } };
    const intent: CommunicationIntentSnapshot = { ...prior, revision: prior.revision + 1, intent: { ...prior.intent, status: 'done', settledAt: c.payload.settledAt }, recordedAt: c.payload.settledAt };
    const guards: ExpectedVersion[] = [{ ref: prior.ref, revision: prior.revision }, { ref: review.ref, revision: review.revision }, { ref: decision.ref, revision: decision.revision }, { ref: work.ref, revision: work.revision }, { ref: delivery.ref, revision: 0 }];
    let wait: WaitConditionSnapshot | null = null;
    delivery.delivery.continuation = { status: target.mode === 'notify' ? 'not_required' : 'unavailable', reason: target.mode === 'notify' ? 'Notification only; existing work may continue' : 'No current participant and real predecessor are available for automatic continuation', waitRef: null };
    if (target.mode === 'resume' && 'binding' in work) {
        const binding = work as WorkContextBindingSnapshot;
        const participation = binding.binding.currentParticipationRef ? get(binding.binding.currentParticipationRef) : undefined;
        const predecessorRef = binding.binding.linkedRunRefs.at(-1);
        const predecessor = predecessorRef ? get(predecessorRef) : undefined;
        if (participation && 'participation' in participation && participation.participation.status === 'active' && predecessor && 'envelope' in predecessor && predecessor.envelope && same(participation.participation.workContextRef, binding.ref)) {
            const waitId = 'architecture-wait-' + sha256Hex(canonicalJson([review.ref, review.revision, target.ref])).slice(0, 24);
            const waitRef = waitConditionRefFor(c.identity.projectId, c.payload.workspaceId, waitId);
            wait = { ref: waitRef, schemaVersion: 1, revision: 1, recordedAt: c.payload.settledAt, wait: { schemaVersion: 1, waitId, projectId: c.identity.projectId, workspaceId: c.payload.workspaceId, ownerWorkContextRef: target.ref, ownerParticipationRef: participation.ref as import('./coordination.js').WorkParticipationRef, predecessorRunRef: predecessorRef!, mode: 'all', architectureReview: { ref: review.ref, revision: review.revision }, conditions: [{ kind: 'delivery_present', deliveryRef: delivery.ref }], satisfiedIndexes: [], observations: [], status: 'active', deadlineAt: null, createdAt: c.payload.settledAt, settledAt: null, satisfiedRevision: null } };
            guards.push({ ref: participation.ref, revision: participation.revision }, { ref: predecessor.ref, revision: predecessor.revision }, { ref: waitRef, revision: 0 });
            delivery.delivery.continuation = { status: 'registered', reason: 'Await the real predecessor and current admission guards', waitRef };
        }
    }
    return { delivery, intent, wait, guards };
}
export function architectureDeliveryApplies(review: ArchitectureReviewSnapshot | undefined, delivery: DeliverySnapshot, wait: WaitConditionSnapshot): boolean {
    const origin = delivery.delivery.origin;
    if (origin.kind !== 'architecture_decision')
        return false;
    if (!review || review.revision !== origin.reviewRevision || review.status === 'pending' || !review.decisionRef || !same(review.ref, origin.reviewRef) || !same(review.bodyRef, delivery.delivery.bodyRef))
        return false;
    const target = review.targets[origin.targetIndex];
    if (!target || target.mode !== 'resume' || !same(target.ref, delivery.delivery.targetWorkContextRef) || !same(target.ref, wait.wait.ownerWorkContextRef))
        return false;
    return !wait.wait.architectureReview || same(wait.wait.architectureReview, { ref: review.ref, revision: review.revision });
}
/** Canonical architecture waits require the entire decision material set, including at final CAS. */
export function architectureDeliverySetMatches(wait: WaitConditionSnapshot, refs: import('./coordination.js').DeliveryRef[]): boolean {
    if (!wait.wait.architectureReview)
        return true;
    const expected = wait.wait.conditions.flatMap(c => c.kind === 'delivery_present' ? [c.deliveryRef] : []);
    return wait.wait.mode === 'all' && expected.length === 1 && refs.length === 1 && same(expected[0], refs[0]);
}
