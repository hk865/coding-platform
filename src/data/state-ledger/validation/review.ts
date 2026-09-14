/** Internal StateLedger review rules. Both adapters invoke these inside their commit protocol. */
import type { DispatchOutboxEntrySnapshot, RunSnapshot, TaskAttemptSnapshot } from "../../../contracts/dispatch.js";
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import type { ReviewLedgerCommitV1 } from '../../../contracts/ledger.js';
import type { ReviewWorkSnapshot, ReviewResultSnapshot, TaskReviewProtocolSnapshot } from '../../../contracts/reviewer-work.js';
import { identityMatchesActor } from './batch-identity.js';
import { validateDispatchStartCommit } from './dispatch.js';


/** Review commit validation checks only the transaction shape. Eligibility is
 * Control policy. In particular no review transition can mutate the TaskLease. */
export function validateReviewCommit(batch: ReviewLedgerCommitV1): boolean {
  try {
    if (batch.schemaVersion !== 1 || !batch.identity.projectId || !batch.identity.idempotencyKey || !batch.identity.actor.id || !batch.fingerprint) return false;
    if (new Set(batch.snapshots.map(s => canonicalJson(s.ref))).size !== batch.snapshots.length || new Set(batch.expectedVersions.map(v => canonicalJson(v.ref))).size !== batch.expectedVersions.length) return false;
    if (batch.snapshots.some(s => s.ref.aggregateType === 'TaskLease' || s.ref.aggregateType === 'PlanRevision' || s.ref.aggregateType === 'TaskReduction')) return false;
    for (const s of batch.snapshots) {
      const old = batch.expectedVersions.find(v => canonicalJson(v.ref) === canonicalJson(s.ref));
      if (!old || (!('projectId' in s.ref) || s.ref.projectId !== batch.identity.projectId) || !Number.isInteger(s.revision) || s.revision <= old.revision) return false;
      if (s.ref.aggregateType !== 'TaskEvidenceIndex' && s.revision !== old.revision + 1) return false;
    }
    if (batch.events.some(e => e.schemaVersion !== 1 || !e.eventId || !isKnownEventType(e.eventType) || !identityMatchesActor(e.projectId, e.idempotencyKey, e.actor.kind, e.actor.id, batch.identity))) return false;
    const work = batch.snapshots.find(s => s.ref.aggregateType === 'ReviewWork') as ReviewWorkSnapshot | undefined;
    if (!work || work.schemaVersion !== 1 || work.protocol !== 'independent-review-v1' || work.ref.reviewId.length === 0) return false;
    const eventWork = batch.events.find(e => e.eventType !== 'TaskReviewProtocolAdopted' && e.eventType !== 'RunStarted' && e.eventType !== 'EvidenceAdmitted');
    if (!eventWork || !('work' in eventWork.payload) || canonicalJson(eventWork.payload.work) !== canonicalJson(work)) return false;
    const types = batch.snapshots.map(s => s.ref.aggregateType).sort().join(',');
    const eventTypes = batch.events.map(e => e.eventType).sort().join(',');
    if (batch.commitKind === 'review-work-create') {
      const protocol = batch.snapshots.find(s => s.ref.aggregateType === 'TaskReviewProtocol') as TaskReviewProtocolSnapshot | undefined;
      if (!protocol || types !== 'DispatchOutboxEntry,ReviewWork,Run,TaskAttempt,TaskReviewProtocol' || eventTypes !== 'ReviewWorkCreated,TaskReviewProtocolAdopted') return false;
      if (batch.snapshots.some(s => s.revision !== 1) || work.input !== null || work.output !== null || work.resultRef !== null || batch.outboxIntents.length !== 1) return false;
      const run = batch.snapshots.find(s => s.ref.aggregateType === 'Run') as RunSnapshot;
      const attempt = batch.snapshots.find(s => s.ref.aggregateType === 'TaskAttempt') as TaskAttemptSnapshot;
      const outbox = batch.snapshots.find(s => s.ref.aggregateType === 'DispatchOutboxEntry') as DispatchOutboxEntrySnapshot;
      const created = batch.events.find(e => e.eventType === 'ReviewWorkCreated');
      if (!created || created.eventType !== 'ReviewWorkCreated' || canonicalJson(created.payload.run) !== canonicalJson(run) || canonicalJson(created.payload.attempt) !== canonicalJson(attempt) || canonicalJson(created.payload.outbox) !== canonicalJson(outbox)) return false;
      if (canonicalJson(run.ref) !== canonicalJson(work.reviewerRunRef) || canonicalJson(attempt.ref) !== canonicalJson(work.reviewerAttemptRef) || canonicalJson(outbox.ref) !== canonicalJson(work.outboxRef)) return false;
      if ([run.work, attempt.work, outbox.intent.work].some(binding => canonicalJson(binding as never) !== canonicalJson({ kind: 'review', reviewWorkRef: work.ref }))) return false;
      if (run.status !== 'starting' || run.envelope !== null || attempt.status !== 'claimed' || outbox.status !== 'pending' || canonicalJson(outbox.intent) !== canonicalJson(batch.outboxIntents[0]!)) return false;
      if (canonicalJson(run.ref) === canonicalJson(work.producerRunRef) || canonicalJson(run.roleBinding) !== canonicalJson(work.roleBinding) || canonicalJson(outbox.intent.declaredPermissions) !== canonicalJson({ tools: ['read'], writeScope: [] })) return false;
      const adopted = batch.events.find(e => e.eventType === 'TaskReviewProtocolAdopted');
      if (!adopted || adopted.eventType !== 'TaskReviewProtocolAdopted' || canonicalJson(adopted.payload.protocol) !== canonicalJson(protocol) || canonicalJson(protocol.ref) !== canonicalJson(work.protocolRef) || canonicalJson(protocol.firstWorkRef) !== canonicalJson(work.ref) || canonicalJson(protocol.planRef) !== canonicalJson(work.planRef)) return false;
      return true;
    }
    if (batch.commitKind === 'review-work-replace') {
      const protocol = batch.snapshots.find(s => s.ref.aggregateType === 'TaskReviewProtocol') as TaskReviewProtocolSnapshot | undefined;
      if (!protocol || types !== 'DispatchOutboxEntry,ReviewWork,Run,TaskAttempt,TaskReviewProtocol'
          || eventTypes !== 'FailedReviewWorkReplaced' || batch.outboxIntents.length !== 1 || work.revision !== 1
          || work.input || work.output || work.resultRef || protocol.revision < 2) return false;
      const replaced = batch.events[0];
      if (!replaced || replaced.eventType !== 'FailedReviewWorkReplaced' || canonicalJson(replaced.payload.protocol) !== canonicalJson(protocol)
          || canonicalJson(replaced.payload.work) !== canonicalJson(work) || canonicalJson(protocol.workRefs?.at(-1) as never) !== canonicalJson(work.ref)) return false;
      const run = batch.snapshots.find(s => s.ref.aggregateType === 'Run') as RunSnapshot;
      const attempt = batch.snapshots.find(s => s.ref.aggregateType === 'TaskAttempt') as TaskAttemptSnapshot;
      const outbox = batch.snapshots.find(s => s.ref.aggregateType === 'DispatchOutboxEntry') as DispatchOutboxEntrySnapshot;
      if ([run, attempt, outbox].some(s => s.revision !== 1) || run.status !== 'starting' || run.envelope !== null
          || attempt.status !== 'claimed' || outbox.status !== 'pending' || canonicalJson(outbox.intent) !== canonicalJson(batch.outboxIntents[0]!)) return false;
      if (canonicalJson(replaced.payload.run) !== canonicalJson(run) || canonicalJson(replaced.payload.attempt) !== canonicalJson(attempt)
          || canonicalJson(replaced.payload.outbox) !== canonicalJson(outbox)) return false;
      if ([run.work, attempt.work, outbox.intent.work].some(binding => canonicalJson(binding as never) !== canonicalJson({ kind: 'review', reviewWorkRef: work.ref }))) return false;
      return canonicalJson(run.ref) === canonicalJson(work.reviewerRunRef) && canonicalJson(attempt.ref) === canonicalJson(work.reviewerAttemptRef)
        && canonicalJson(outbox.ref) === canonicalJson(work.outboxRef) && canonicalJson(protocol.ref) === canonicalJson(work.protocolRef);
    }
    if (batch.outboxIntents.length !== 0) return false;
    if (batch.commitKind === 'review-start') {
      if (types !== 'DispatchOutboxEntry,ReviewWork,Run,TaskAttempt' || eventTypes !== 'ReviewInputBound,RunStarted' || work.revision !== 2 || !work.input || work.output || work.resultRef) return false;
      const snapshots = batch.snapshots.filter(s => s.ref.aggregateType !== 'ReviewWork') as [RunSnapshot, TaskAttemptSnapshot, DispatchOutboxEntrySnapshot];
      const events = batch.events.filter(e => e.eventType === 'RunStarted') as [import('../../../contracts/dispatch.js').RunStartedEvent];
      const old = batch.expectedVersions.filter(v => snapshots.some(s => canonicalJson(s.ref) === canonicalJson(v.ref)));
      if (!validateDispatchStartCommit({ ...batch, commitKind: 'dispatch-start', snapshots, events, expectedVersions: old, outboxIntents: [] })) return false;
      const run = snapshots.find(s => s.ref.aggregateType === 'Run') as RunSnapshot;
      return canonicalJson(run.envelope?.reviewInput as never) === canonicalJson(work.input) && canonicalJson(run.work?.reviewWorkRef as never) === canonicalJson(work.ref);
    }
    if (batch.commitKind === 'review-output-bind') return types === 'ReviewWork' && eventTypes === 'ReviewOutputBound' && eventWork.eventType === 'ReviewOutputBound' && eventWork.payload.commandFingerprint === batch.fingerprint && !!work.input && !!work.output && !work.resultRef && work.output.reportRef.digest === work.output.reportDigest && canonicalJson(work.output.runRef) === canonicalJson(work.reviewerRunRef);
    if (batch.commitKind !== 'review-result-admission') return false;
    const result = batch.snapshots.find(s => s.ref.aggregateType === 'ReviewResult') as ReviewResultSnapshot | undefined;
    if (!result || result.revision !== 1 || canonicalJson(result.workRef) !== canonicalJson(work.ref) || canonicalJson(result.ref) !== canonicalJson(work.resultRef) || canonicalJson(result.output) !== canonicalJson(work.output)) return false;
    if (eventWork.eventType !== 'ReviewResultRecorded' || canonicalJson(eventWork.payload.result) !== canonicalJson(result) || result.commandFingerprint !== batch.fingerprint || canonicalJson(result.commandIdentity) !== canonicalJson(batch.identity)) return false;
    if (result.decision.status === 'rejected') return types === 'ReviewResult,ReviewWork' && eventTypes === 'ReviewResultRecorded' && result.decision.evidenceRefs.length === 0;
    const evidence = batch.snapshots.filter(s => s.ref.aggregateType === 'Evidence') as import('../../../contracts/evidence.js').EvidenceSnapshot[];
    const index = batch.snapshots.find(s => s.ref.aggregateType === 'TaskEvidenceIndex') as import('../../../contracts/evidence.js').TaskEvidenceIndexSnapshot | undefined;
    if (!index || evidence.length < 1 || evidence.length > 3 || batch.snapshots.length !== evidence.length + 3 || batch.events.length !== evidence.length + 1 || index.revision !== index.evidenceIds.length || index.revision > 512) return false;
    const priorIndex = batch.expectedVersions.find(v => canonicalJson(v.ref) === canonicalJson(index.ref));
    if (!priorIndex || index.revision !== priorIndex.revision + evidence.length || new Set(evidence.map(s => s.evidence.outcome)).size !== evidence.length || canonicalJson(evidence.map(s => s.ref)) !== canonicalJson(result.decision.evidenceRefs)) return false;
    for (const [i, s] of evidence.entries()) {
      const event = batch.events.find(e => e.eventType === 'EvidenceAdmitted' && e.aggregateId === s.ref.evidenceId);
      if (!event || event.eventType !== 'EvidenceAdmitted' || canonicalJson(event.payload.evidence) !== canonicalJson(s.evidence) || event.payload.evidenceIndex !== priorIndex.revision + i + 1 || event.payload.evidenceCount !== priorIndex.revision + i + 1 || index.evidenceIds[priorIndex.revision + i] !== s.ref.evidenceId) return false;
      const expectedCoverage = result.decision.requirements.filter(r => r.outcome === s.evidence.outcome).map(({ obligationId, requirementId }) => ({ obligationId, requirementId }));
      if (canonicalJson(s.evidence.coverage) !== canonicalJson(expectedCoverage) || canonicalJson(s.evidence.reviewAdmission as never) !== canonicalJson({ protocol: work.protocol, workRef: work.ref, resultRef: result.ref }) || s.evidence.kind !== 'verdict') return false;
    }
    return true;
  } catch { return false; }
}

export const validateReviewWorkCreateCommit = (batch: ReviewLedgerCommitV1) => batch.commitKind === 'review-work-create' && validateReviewCommit(batch);

export const validateReviewWorkReplaceCommit = (batch: ReviewLedgerCommitV1) => batch.commitKind === 'review-work-replace' && validateReviewCommit(batch);

export const validateReviewStartCommit = (batch: ReviewLedgerCommitV1) => batch.commitKind === 'review-start' && validateReviewCommit(batch);

export const validateReviewOutputBindCommit = (batch: ReviewLedgerCommitV1) => batch.commitKind === 'review-output-bind' && validateReviewCommit(batch);

export const validateReviewResultAdmissionCommit = (batch: ReviewLedgerCommitV1) => batch.commitKind === 'review-result-admission' && validateReviewCommit(batch);
