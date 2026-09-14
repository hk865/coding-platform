import type { StateLedger, AggregateRef, AggregateSnapshot } from '../../contracts/ledger.js';
import { architectureReviewFingerprint, type ArchitectureReviewCommand, type ArchitectureReviewCommit, type ArchitectureReviewReceipt, type ArchitectureReviewSnapshot } from '../../contracts/architecture-review.js';
import { foldArchitectureReview, validArchitectureReviewCommand } from '../../contracts/architecture-review-values.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { communicationIntentRecordedEvent } from '../../contracts/coordination-events.js';
import { communicationIntentSettledEvent, deliveryRecordedEvent, waitConditionRegisteredEvent } from '../../contracts/coordination-events.js';
import { communicationIntentRefFor, communicationSettleFingerprint, type CommunicationIntentSnapshot, type CommunicationSettleReceipt } from '../../contracts/coordination.js';
import { foldArchitectureDelivery } from '../../contracts/architecture-review-values.js';
import type { ArchitectureDeliveryCommand, ArchitectureDeliveryCommit } from '../../contracts/architecture-review.js';
/** One durable transition; public body storage remains with the caller. */
export async function recordArchitectureReview(deps: {
    ledger: StateLedger;
    eventId: () => string;
}, command: ArchitectureReviewCommand): Promise<ArchitectureReviewReceipt> {
    if (!validArchitectureReviewCommand(command))
        return { status: 'rejected', code: 'invalid', reason: 'Invalid review command' };
    const base: ArchitectureReviewCommit = { commitKind: 'architecture-review', schemaVersion: 1, identity: command.identity, fingerprint: architectureReviewFingerprint(command), command, events: [], snapshots: [], expectedVersions: [], outboxIntents: [] };
    const cache = new Map<string, AggregateSnapshot>();
    const read = async (ref: AggregateRef) => {
        const r = await deps.ledger.load(ref);
        if (r.status === 'found')
            cache.set(canonicalJson(ref), r.snapshot);
        return r.status === 'found' ? r.snapshot : undefined;
    };
    const prior = await read(command.ref) as ArchitectureReviewSnapshot | undefined;
    // Existing command receipts survive changes to mutable source state.
    if ((prior?.revision ?? 0) !== command.expectedRevision)
        return deps.ledger.commit(base);
    const a = command.action;
    const proposalRef = a.kind === 'decide' ? prior?.proposalRef : a.proposalRef;
    const candidateRef = a.kind === 'decide' ? prior?.candidateRef : a.candidateRef;
    if (!proposalRef || !candidateRef)
        return { status: 'rejected', code: 'not_found', reason: 'Review source unavailable' };
    const proposal = await read(proposalRef);
    await read(candidateRef);
    await read({ aggregateType: 'Workspace', projectId: command.ref.projectId, workspaceId: command.ref.workspaceId });
    await read({ aggregateType: 'ProjectArchitectureBaselineActive', projectId: command.ref.projectId });
    if (proposal && 'proposal' in proposal && 'selectedBriefRef' in proposal.proposal && proposal.proposal.selectedBriefRef) {
        const brief = await read(proposal.proposal.selectedBriefRef);
        if (brief && 'brief' in brief)
            for (const ref of brief.brief.findingRefs)
                await read(ref);
    }
    const reporter = a.kind === 'open' ? a.reporterRunRef : prior?.reporterRunRef;
    if (reporter)
        await read(reporter);
    const principal = command.identity.agentPrincipal;
    if (principal) {
        await read(principal.workContextRef);
        await read(principal.participationRef);
    }
    const directory = await deps.ledger.workDirectory?.(command.ref.projectId, command.ref.workspaceId) ?? { status: 'unavailable' as const, reason: 'Work directory unavailable' };
    const fold = foldArchitectureReview(command, ref => cache.get(canonicalJson(ref)), directory);
    if ('error' in fold)
        return { status: 'rejected', code: fold.error, reason: fold.reason };
    const eventBase = { schemaVersion: 1 as const, projectId: command.ref.projectId, workspaceId: command.ref.workspaceId, actor: command.identity.actor, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, occurredAt: command.submittedAt };
    base.snapshots.push(fold.snapshot);
    base.expectedVersions = fold.guards;
    base.events.push({ ...eventBase, eventId: deps.eventId(), eventType: 'ArchitectureReviewRecorded', aggregateType: 'ArchitectureReview', aggregateId: command.ref.reviewId, aggregateRevision: fold.snapshot.revision, payload: { action: a.kind, snapshot: fold.snapshot } });
    if (fold.decision) {
        base.snapshots.push({ ref: fold.snapshot.decisionRef!, revision: 1, schemaVersion: 1, decision: fold.decision, recordedAt: command.submittedAt });
        base.events.push({ ...eventBase, eventId: deps.eventId(), eventType: 'ArchitectureChangeDecisionRecorded', aggregateType: 'ArchitectureChangeDecision', aggregateId: fold.decision.decisionId, aggregateRevision: 1, payload: { decision: fold.decision, recordedAt: command.submittedAt } });
    }
    for (const intent of fold.intents) {
        base.snapshots.push(intent);
        base.events.push(communicationIntentRecordedEvent({ commandId: command.commandId, correlationId: command.correlationId, occurredAt: command.submittedAt, identity: command.identity }, deps.eventId(), intent.intent));
    }
    return deps.ledger.commit(base);
}
export async function deliverArchitectureReview(deps: {
    ledger: StateLedger;
    eventId: () => string;
}, command: ArchitectureDeliveryCommand): Promise<CommunicationSettleReceipt> {
    const cache = new Map<string, AggregateSnapshot>();
    const read = async (ref: AggregateRef) => {
        const r = await deps.ledger.load(ref);
        if (r.status === 'found')
            cache.set(canonicalJson(ref), r.snapshot);
        return r.status === 'found' ? r.snapshot : undefined;
    };
    const intentRef = communicationIntentRefFor(command.identity.projectId, command.payload.workspaceId, command.aggregateId);
    const prior = await read(intentRef) as CommunicationIntentSnapshot | undefined;
    if (!prior || prior.intent.domain.kind !== 'architecture_decision_delivery')
        return { status: 'rejected', commandId: command.commandId, code: 'not_found' };
    const batch: ArchitectureDeliveryCommit = { commitKind: 'architecture-review-delivery', schemaVersion: 1, identity: command.identity, fingerprint: communicationSettleFingerprint(command), command, events: [], snapshots: [], expectedVersions: [], outboxIntents: [] };
    if (prior.revision === command.expectedRevision) {
        const review = await read(prior.intent.domain.reviewRef) as ArchitectureReviewSnapshot | undefined;
        if (review) {
            if (review.decisionRef)
                await read(review.decisionRef);
            const target = review.targets[prior.intent.domain.targetIndex];
            if (target) {
                const work = await read(target.ref);
                if (work && 'binding' in work) {
                    if (work.binding.currentParticipationRef)
                        await read(work.binding.currentParticipationRef);
                    const run = work.binding.linkedRunRefs.at(-1);
                    if (run)
                        await read(run);
                }
            }
        }
        const folded = foldArchitectureDelivery(command, ref => cache.get(canonicalJson(ref)));
        if (!folded)
            return { status: 'rejected', commandId: command.commandId, code: 'forbidden', issues: ['Exact decision, target and current intent lease are required'] };
        const ctx = { commandId: command.commandId, correlationId: command.correlationId, occurredAt: command.payload.settledAt, identity: command.identity };
        batch.expectedVersions = folded.guards;
        batch.snapshots = [folded.delivery, folded.intent];
        batch.events = [deliveryRecordedEvent(ctx, deps.eventId(), folded.delivery.delivery), communicationIntentSettledEvent(ctx, deps.eventId(), folded.intent.intent, folded.intent.revision)];
        if (folded.wait) {
            batch.snapshots.push(folded.wait);
            batch.events.push(waitConditionRegisteredEvent(ctx, deps.eventId(), folded.wait.wait));
        }
    }
    const receipt = await deps.ledger.commit(batch);
    if (receipt.status === 'committed')
        return { status: 'committed', commandId: command.commandId, replayed: receipt.replayed, intentRef, intentStatus: 'done', deliveries: receipt.aggregateRevisions.flatMap(r => r.ref.aggregateType === 'Delivery' ? [r.ref] : []), nextIntentRef: null, eventIds: receipt.eventIds, commitCursor: receipt.commitCursor };
    return { status: 'rejected', commandId: command.commandId, code: receipt.code === 'invalid_commit' || receipt.code === 'not_empty' ? 'invalid' : receipt.code };
}
