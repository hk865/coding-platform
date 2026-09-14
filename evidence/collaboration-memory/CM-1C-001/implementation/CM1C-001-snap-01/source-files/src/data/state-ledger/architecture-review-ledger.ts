import type { AggregateRef, AggregateSnapshot, LedgerCommitReceipt } from '../../contracts/ledger.js';
import type { ArchitectureReviewCommit } from '../../contracts/architecture-review.js';
import { architectureReviewFingerprint } from '../../contracts/architecture-review.js';
import { foldArchitectureReview, selectArchitectureWorkDirectory, validArchitectureReviewCommand } from '../../contracts/architecture-review-values.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { validateDomainEvent } from '../../contracts/validation/event.js';
import type { ArchitectureDeliveryCommit } from '../../contracts/architecture-review.js';
import { foldArchitectureDelivery } from '../../contracts/architecture-review-values.js';
import { communicationSettleFingerprint } from '../../contracts/coordination.js';
export { selectArchitectureWorkDirectory };
export function validArchitectureReviewEnvelope(batch: ArchitectureReviewCommit): boolean {
    return batch.schemaVersion === 1 && validArchitectureReviewCommand(batch.command) && canonicalJson(batch.identity) === canonicalJson(batch.command.identity) && batch.fingerprint === architectureReviewFingerprint(batch.command);
}
export function validArchitectureDeliveryEnvelope(batch: ArchitectureDeliveryCommit): boolean {
    const c = batch.command;
    return batch.schemaVersion === 1 && c.schemaVersion === 1 && c.commandType === 'CommunicationSettleIntent' && c.payload.outcome === 'architecture_delivery' && c.identity.actor.kind === 'system' && typeof c.commandId === 'string' && Number.isSafeInteger(c.expectedRevision) && c.expectedRevision >= 1 && canonicalJson(c.identity) === canonicalJson(batch.identity) && batch.fingerprint === communicationSettleFingerprint(c);
}
export function architectureDeliveryStateRejection(batch: ArchitectureDeliveryCommit, get: (ref: AggregateRef) => AggregateSnapshot | undefined): Extract<LedgerCommitReceipt, {
    status: 'rejected';
}> | null {
    const fold = foldArchitectureDelivery(batch.command, get);
    if (!fold)
        return { status: 'rejected', code: 'revision_conflict' };
    const invalid = () => ({ status: 'rejected' as const, code: 'invalid_commit' as const });
    if (batch.outboxIntents.length || batch.events.length !== (fold.wait ? 3 : 2) || canonicalJson(batch.expectedVersions) !== canonicalJson(fold.guards) || canonicalJson(batch.snapshots) !== canonicalJson([fold.delivery, fold.intent, ...(fold.wait ? [fold.wait] : [])]))
        return invalid();
    const [delivery, intent] = batch.events;
    if (!delivery || !intent || delivery.eventType !== 'DeliveryRecorded' || intent.eventType !== 'CommunicationIntentSettled' || delivery.aggregateType !== 'Delivery' || intent.aggregateType !== 'CommunicationIntent' || delivery.aggregateId !== fold.delivery.ref.deliveryId || intent.aggregateId !== fold.intent.ref.intentId || delivery.aggregateRevision !== 1 || intent.aggregateRevision !== fold.intent.revision || canonicalJson(delivery.payload) !== canonicalJson({ delivery: fold.delivery.delivery }) || canonicalJson(intent.payload) !== canonicalJson({ intent: fold.intent.intent }))
        return invalid();
    if (new Set(batch.events.map(e => e.eventId)).size !== batch.events.length)
        return invalid();
    if (fold.wait) {
        const e = batch.events[2]!;
        if (e.eventType !== 'WaitConditionRegistered' || e.aggregateType !== 'WaitCondition' || e.aggregateId !== fold.wait.ref.waitId || e.aggregateRevision !== 1 || canonicalJson(e.payload) !== canonicalJson({ wait: fold.wait.wait }))
            return invalid();
    }
    for (const e of batch.events)
        if (validateDomainEvent(e).length || e.projectId !== batch.identity.projectId || !('workspaceId' in e) || e.workspaceId !== batch.command.payload.workspaceId || canonicalJson(e.actor) !== canonicalJson(batch.identity.actor) || e.causationId !== batch.command.commandId || e.correlationId !== batch.command.correlationId || e.idempotencyKey !== batch.identity.idempotencyKey || e.occurredAt !== batch.command.payload.settledAt)
            return invalid();
    return null;
}
/** Invoked after receipt lookup and before mutation, within the adapter transaction. */
export function architectureReviewStateRejection(batch: ArchitectureReviewCommit, get: (ref: AggregateRef) => AggregateSnapshot | undefined, snapshots: AggregateSnapshot[]): Extract<LedgerCommitReceipt, {
    status: 'rejected';
}> | null {
    const c = batch.command;
    const result = foldArchitectureReview(c, get, selectArchitectureWorkDirectory(snapshots, c.ref.projectId, c.ref.workspaceId));
    if ('error' in result)
        return { status: 'rejected', code: result.error === 'stale' ? 'revision_conflict' : 'invalid_commit' };
    const expected: AggregateSnapshot[] = [result.snapshot];
    if (result.decision)
        expected.push({ ref: result.snapshot.decisionRef!, revision: 1, schemaVersion: 1, decision: result.decision, recordedAt: c.submittedAt });
    expected.push(...result.intents);
    const invalid = () => ({ status: 'rejected' as const, code: 'invalid_commit' as const });
    if (batch.outboxIntents.length || canonicalJson(batch.expectedVersions) !== canonicalJson(result.guards) || canonicalJson(batch.snapshots) !== canonicalJson(expected) || batch.events.length !== expected.length)
        return invalid();
    if (new Set(batch.events.map(e => e.eventId)).size !== batch.events.length)
        return invalid();
    for (let i = 0; i < batch.events.length; i++) {
        const e = batch.events[i]!, s = expected[i]!;
        if (validateDomainEvent(e).length || e.projectId !== c.ref.projectId || !('workspaceId' in e) || e.workspaceId !== c.ref.workspaceId || e.aggregateType !== s.ref.aggregateType || e.aggregateRevision !== s.revision || e.causationId !== c.commandId || e.correlationId !== c.correlationId || e.idempotencyKey !== c.identity.idempotencyKey || e.occurredAt !== c.submittedAt || canonicalJson(e.actor) !== canonicalJson(c.identity.actor))
            return invalid();
        if (i === 0) {
            if (e.eventType !== 'ArchitectureReviewRecorded' || e.aggregateId !== c.ref.reviewId || canonicalJson(e.payload) !== canonicalJson({ action: c.action.kind, snapshot: result.snapshot }))
                return invalid();
        }
        else if (s.ref.aggregateType === 'ArchitectureChangeDecision' && 'decision' in s && 'decisionId' in s.decision) {
            if (e.eventType !== 'ArchitectureChangeDecisionRecorded' || e.aggregateId !== s.decision.decisionId || canonicalJson(e.payload) !== canonicalJson({ decision: s.decision, recordedAt: c.submittedAt }))
                return invalid();
        }
        else if (s.ref.aggregateType === 'CommunicationIntent' && 'intent' in s && 'intentId' in s.intent) {
            if (e.eventType !== 'CommunicationIntentRecorded' || e.aggregateId !== s.intent.intentId || canonicalJson(e.payload) !== canonicalJson({ intent: s.intent }))
                return invalid();
        }
        else
            return invalid();
    }
    return null;
}
