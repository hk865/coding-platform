import type {AggregateRef,AggregateSnapshot} from '../../contracts/ledger.js';
import {startWorkParticipationFingerprint as startWorkParticipationFingerprintForInitial} from '../../contracts/coordination.js';
import { initialAssignmentEligible } from '../../contracts/initial-work-assignment.js';
import { architectureDeliveryApplies, architectureDeliverySetMatches } from "../../contracts/architecture-review-values.js";
import { waitAdmissionIntentIdFor, WAIT_MAX_CONDITIONS } from '../../contracts/coordination.js';
import {validMemoryGovernanceWitness,memoryNoteBodyDigest} from '../../contracts/memory-values.js';
import { qualifiedAlternativeReport } from '../../contracts/alternative-report.js';
import { projectRoleSpecActiveRefFor } from '../../contracts/role-spec.js';
import { quarantineCommunicationIntent } from '../../contracts/communication-reconciliation.js';
import { nextRunSnapshotForRuntimeEvent, nextRunSnapshotForOutcomeUnknown, nextAttemptSnapshotForTerminal, nextOutboxSnapshotForTerminal } from '../../contracts/run-lifecycle-fold.js';
import { foldRunReconciliation } from '../../contracts/run-reconciliation.js';
import { executionRetryState } from '../../contracts/execution-authorization.js';
import { runtimeInputMaterialGuards } from '../../contracts/runtime-input-authorization.js';
import { subscriptionCatchupIdFor, selectCatchupPrefix, subscriptionDeliveryIdFor, communicationSource } from "../../contracts/coordination.js";
/**
 * P1-02 pure commit validators shared by BOTH StateLedger adapters.
 *
 * Scope: StateLedger-level invariants for the versioned P1-02 commit kinds
 * (governance-install / governance-activate / plan-revision). These validators
 * are pure functions over the commit batch — the same rules run against the
 * InMemory ledger and the SQLite ledger so neither adapter can drift.
 *
 * They implement the frozen "Event/snapshot/expected-revision alignment"
 * rule of the StateLedger module interface: each commit kind carries exactly
 * the events+snapshots+expected versions its semantics define; anything else
 * is an invalid_commit (zero-write). Control-level guards (digest check,
 * install-not-found, non-empty plan guards, cycle detection) live in the
 * Control handlers, NOT here.
 */
import type {
  DispatchClaimLedgerCommitV1,
  DispatchStartLedgerCommitV1,
  GovernanceActivateLedgerCommitV1,
  GovernanceInstallLedgerCommitV1,
  HandoffRecordLedgerCommitV1,
  PlanRevisionLedgerCommitV1,
  ReplacementClaimLedgerCommitV1,
  RunFactLedgerCommitV1,
} from "../../contracts/ledger.js";
import type {
  ArchitectureBaselineRevisionSnapshot,
  CompletionPolicyRevisionSnapshot,
  ProjectArchitectureBaselineActiveSnapshot,
  ProjectCompletionPolicyActiveSnapshot,
} from "../../contracts/governance.js";
// P1-13 LANE-A: third governance kind (ArchitectureEvolutionPolicy) snapshots.
import type {
  ArchitectureEvolutionPolicyRevisionSnapshot,
  ProjectArchitectureEvolutionPolicyActiveSnapshot,
} from "../../contracts/architecture-evolution-policy.js";
import type {
  DispatchOutboxEntrySnapshot,
  RunSnapshot,
  TaskAttemptSnapshot,
  TaskLeaseSnapshot,
} from "../../contracts/dispatch.js";
import type { ReplacementAttemptSnapshot } from "../../contracts/handoff.js";
import {
  dispatchOutboxRefFor,
  isTerminalRuntimeEvent,
  runRefFor,
  taskAttemptRefFor,
  taskLeaseRefFor,
} from "../../contracts/dispatch.js";
import { canonicalJson, sha256Hex } from "../../contracts/fingerprint.js";
import {validateArchitectureCandidateProposal} from '../../contracts/validation/architecture.js';
import { isKnownEventType } from "../../contracts/events.js";
import { makeCommitCursor, seqOfCommitCursor } from "../../contracts/ledger.js";
import { commandIdentityKey } from "../../contracts/command-event.js";
import { bootstrapIdentityKey } from "../../contracts/bootstrap.js";
import type {
  IntegrationRecordLedgerCommitV1,
  PatchRecordLedgerCommitV1,
  WorkspaceReadLeaseAcquireLedgerCommitV1,
  WorkspaceReadLeaseReleaseLedgerCommitV1,
  WorkspaceWriteLeaseAcquireLedgerCommitV1,
  WorkspaceWriteLeaseReleaseLedgerCommitV1,
} from "../../contracts/ledger.js";
import type { WorkspaceWriteLeaseIndexSnapshot, WorkspaceWriteLeaseSnapshot } from "../../contracts/workspace-lease.js";
import { workspaceReadLeaseIndexRefFor, workspaceReadLeaseRefFor, workspaceWriteLeaseIndexRefFor, workspaceWriteLeaseRefFor } from "../../contracts/workspace-lease.js";
import { integrationResultRefFor } from "../../contracts/integration.js";
import { patchRecordRefFor } from "../../contracts/patch.js";
import { WORK_CONTEXT_MAX_RUN_LINKS } from "../../contracts/context-continuity.js";
import { communicationAdmissionRefFor, communicationIntentRefFor, deliveryDedupeKey, deliveryRefFor, routePageIntentIdFor } from "../../contracts/coordination.js";
import { candidateProposalDigest } from "../../contracts/architecture-inspection.js";
import { CONTROL_INTENT_MAX_ACKS } from "../../contracts/control-intent.js";
import { QUERY_JOB_MAX_ROUNDS, validQueryExecution } from "../../contracts/query-job.js";
import { MATERIAL_ACCESS_MAX_MATERIALS, validMaterialSourcePin } from "../../contracts/material-access.js";
import type { ReviewLedgerCommitV1 } from '../../contracts/ledger.js';
import type { ReviewWorkSnapshot, ReviewResultSnapshot, TaskReviewProtocolSnapshot } from '../../contracts/reviewer-work.js';

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
      const events = batch.events.filter(e => e.eventType === 'RunStarted') as [import('../../contracts/dispatch.js').RunStartedEvent];
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
    const evidence = batch.snapshots.filter(s => s.ref.aggregateType === 'Evidence') as import('../../contracts/evidence.js').EvidenceSnapshot[];
    const index = batch.snapshots.find(s => s.ref.aggregateType === 'TaskEvidenceIndex') as import('../../contracts/evidence.js').TaskEvidenceIndexSnapshot | undefined;
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

function identityMatchesActor(
  projectId: string,
  idempotencyKey: string,
  actorKind: string,
  actorId: string,
  batchIdentity: { projectId: string; idempotencyKey: string; actor: { kind: string; id: string } },
): boolean {
  return (
    projectId === batchIdentity.projectId &&
    idempotencyKey === batchIdentity.idempotencyKey &&
    actorKind === batchIdentity.actor.kind &&
    actorId === batchIdentity.actor.id
  );
}

// ------------------------------------------------------------------------ //
// governance-install                                                        //
// ------------------------------------------------------------------------ //

export function validateGovernanceInstallCommit(
  batch: GovernanceInstallLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1) return false;
  const event = batch.events[0]!;
  const snapshot = batch.snapshots[0]!;
  if (event.schemaVersion !== 1 || snapshot.schemaVersion !== 1) return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateRevision !== 1) return false;
  if (snapshot.revision !== 1) return false;

  if (event.eventType === "CompletionPolicyInstalled") {
    if (event.aggregateType !== "CompletionPolicyRevision") return false;
    if (snapshot.ref.aggregateType !== "CompletionPolicyRevision") return false;
    const s = snapshot as CompletionPolicyRevisionSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.policyId !== event.aggregateId ||
      s.contentRevision !== event.payload.revision ||
      s.contentDigest !== event.payload.contentDigest
    ) {
      return false;
    }
    if (canonicalJson(s.content) !== canonicalJson(event.payload.content)) return false;
  } else if (event.eventType === "ArchitectureBaselineInstalled") {
    if (event.aggregateType !== "ArchitectureBaselineRevision") return false;
    if (snapshot.ref.aggregateType !== "ArchitectureBaselineRevision") return false;
    const s = snapshot as ArchitectureBaselineRevisionSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.baselineId !== event.aggregateId ||
      s.contentRevision !== event.payload.revision ||
      s.contentDigest !== event.payload.contentDigest
    ) {
      return false;
    }
    if (canonicalJson(s.content) !== canonicalJson(event.payload.content)) return false;
  } else if (event.eventType === "ArchitectureEvolutionPolicyInstalled") {
    // P1-13 LANE-A: third governance kind — exactly one revision snapshot + event.
    if (event.aggregateType !== "ArchitectureEvolutionPolicyRevision") return false;
    if (snapshot.ref.aggregateType !== "ArchitectureEvolutionPolicyRevision") return false;
    const s = snapshot as ArchitectureEvolutionPolicyRevisionSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.policyId !== event.aggregateId ||
      s.contentRevision !== event.payload.revision.contentRevision ||
      s.contentDigest !== event.payload.revision.contentDigest
    ) {
      return false;
    }
    if (canonicalJson(s.content) !== canonicalJson(event.payload.revision.content)) return false;
    if (canonicalJson(event.payload.revision.ref) !== canonicalJson(snapshot.ref)) return false;
  } else {
    return false;
  }

  // Immutability CAS: exactly one expected version = the revision at 0.
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

// ------------------------------------------------------------------------ //
// governance-activate                                                       //
// ------------------------------------------------------------------------ //

export function validateGovernanceActivateCommit(
  batch: GovernanceActivateLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1) return false;
  const event = batch.events[0]!;
  const snapshot = batch.snapshots[0]!;
  if (event.schemaVersion !== 1) return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateRevision !== snapshot.revision) return false;
  if (!Number.isSafeInteger(event.aggregateRevision) || event.aggregateRevision < 1) return false;

  if (event.eventType === "CompletionPolicyActivated") {
    if (event.aggregateType !== "ProjectCompletionPolicyActive") return false;
    if (snapshot.ref.aggregateType !== "ProjectCompletionPolicyActive") return false;
    const s = snapshot as ProjectCompletionPolicyActiveSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.projectId !== event.projectId ||
      s.activeRevision.policyId !== event.payload.target.ref.policyId ||
      s.activeRevision.projectId !== event.payload.target.ref.projectId ||
      s.activeRevision.revision !== event.payload.target.ref.revision
    ) {
      return false;
    }
    if (canonicalJson(s.activeRevision) !== canonicalJson(event.payload.target.ref)) {
      return false;
    }
  } else if (event.eventType === "ArchitectureBaselineActivated") {
    if (event.aggregateType !== "ProjectArchitectureBaselineActive") return false;
    if (snapshot.ref.aggregateType !== "ProjectArchitectureBaselineActive") return false;
    const s = snapshot as ProjectArchitectureBaselineActiveSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.projectId !== event.projectId ||
      s.activeRevision.baselineId !== event.payload.target.ref.baselineId ||
      s.activeRevision.projectId !== event.payload.target.ref.projectId ||
      s.activeRevision.revision !== event.payload.target.ref.revision
    ) {
      return false;
    }
    if (canonicalJson(s.activeRevision) !== canonicalJson(event.payload.target.ref)) {
      return false;
    }
  } else if (event.eventType === "ArchitectureEvolutionPolicyActivated") {
    // P1-13 LANE-A: third governance kind — per-kind Project active aggregate.
    if (event.aggregateType !== "ProjectArchitectureEvolutionPolicyActive") return false;
    if (snapshot.ref.aggregateType !== "ProjectArchitectureEvolutionPolicyActive") return false;
    const s = snapshot as ProjectArchitectureEvolutionPolicyActiveSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.projectId !== event.projectId ||
      s.activeRevision.policyId !== event.payload.activeRevision.policyId ||
      s.activeRevision.projectId !== event.payload.activeRevision.projectId ||
      s.activeRevision.revision !== event.payload.activeRevision.revision
    ) {
      return false;
    }
    if (canonicalJson(s.activeRevision) !== canonicalJson(event.payload.activeRevision)) return false;
    if (canonicalJson(s.ref) !== canonicalJson(event.payload.activeRef)) return false;
  } else {
    return false;
  }

  // CAS: [Project@expected, ActiveAggregate@(snapshot.revision - 1)].
  if (batch.expectedVersions.length !== 2) return false;
  if (batch.expectedVersions[0]!.ref.aggregateType !== "Project") return false;
  if (batch.expectedVersions[0]!.ref.projectId !== event.projectId) return false;
  if (batch.expectedVersions[1]!.revision !== snapshot.revision - 1) return false;
  if (canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

// ------------------------------------------------------------------------ //
// plan-revision                                                             //
// ------------------------------------------------------------------------ //

export function validatePlanRevisionCommit(batch: PlanRevisionLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 2) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "PlanRevisionAccepted") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "PlanRevision") return false;
  if (event.aggregateRevision !== 1) return false;

  const planSnapshot = batch.snapshots.find(
    (s): s is Extract<typeof s, { ref: { aggregateType: "PlanRevision" } }> =>
      s.ref.aggregateType === "PlanRevision",
  );
  const goalSnapshot = batch.snapshots.find(
    (s): s is Extract<typeof s, { ref: { aggregateType: "Goal" } }> => s.ref.aggregateType === "Goal",
  );
  if (planSnapshot === undefined || goalSnapshot === undefined) return false;
  if (planSnapshot.revision !== 1) return false;
  if (planSnapshot.schemaVersion !== 1) return false;

  // Plan snapshot aligns with the event aggregate identity.
  if (
    planSnapshot.ref.projectId !== event.projectId ||
    planSnapshot.planId !== event.aggregateId ||
    planSnapshot.goalRef.projectId !== event.projectId ||
    planSnapshot.goalRef.goalId !== event.payload.goalId
  ) {
    return false;
  }
  // The event carries the exact accepted snapshot (ReadModel replay source).
  if (canonicalJson(event.payload.planRevision) !== canonicalJson(planSnapshot)) return false;

  // Goal snapshot advances by one; workspace must stay consistent.
  if (goalSnapshot.revision !== event.aggregateRevision + 1) return false;
  if (goalSnapshot.activePlanRevision === null) return false;
  if (canonicalJson(goalSnapshot.activePlanRevision) !== canonicalJson(planSnapshot.ref)) {
    return false;
  }
  if (goalSnapshot.ref.projectId !== event.projectId || goalSnapshot.ref.goalId !== event.payload.goalId) {
    return false;
  }
  if (goalSnapshot.workspaceRef.projectId !== event.projectId) return false;
  if (goalSnapshot.workspaceRef.workspaceId !== event.workspaceId) return false;
  if (event.payload.goalAggregateRevision !== goalSnapshot.revision) return false;

  // CAS: [Goal@(goalSnapshot.revision - 1), PlanRevision@0].
  if (batch.expectedVersions.length !== 2) return false;
  if (batch.expectedVersions[0]!.revision !== goalSnapshot.revision - 1) return false;
  if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(goalSnapshot.ref)) return false;
  if (batch.expectedVersions[1]!.revision !== 0) return false;
  if (canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(planSnapshot.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}
// ------------------------------------------------------------------------ //
// dispatch-claim (P1-03)                                                     //
// ------------------------------------------------------------------------ //

export function validateDispatchClaimCommit(batch: DispatchClaimLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 4) return false;
  if (batch.outboxIntents.length !== 1) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "TaskClaimed") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "TaskLease") return false;
  if (event.aggregateRevision !== 1) return false;

  const lease = batch.snapshots.find(
    (s): s is TaskLeaseSnapshot => s.ref.aggregateType === "TaskLease",
  );
  const attempt = batch.snapshots.find(
    (s): s is TaskAttemptSnapshot => s.ref.aggregateType === "TaskAttempt",
  );
  const run = batch.snapshots.find((s): s is RunSnapshot => s.ref.aggregateType === "Run");
  const outbox = batch.snapshots.find(
    (s): s is DispatchOutboxEntrySnapshot => s.ref.aggregateType === "DispatchOutboxEntry",
  );
  if (lease === undefined || attempt === undefined || run === undefined || outbox === undefined) {
    return false;
  }
  if (lease.revision !== 1 || attempt.revision !== 1 || run.revision !== 1 || outbox.revision !== 1) {
    return false;
  }
  if (
    lease.schemaVersion !== 1 ||
    attempt.schemaVersion !== 1 ||
    run.schemaVersion !== 1 ||
    outbox.schemaVersion !== 1
  ) {
    return false;
  }

  // Event <-> snapshot alignment (full refs, never bare local ids).
  const expectedLeaseRef = taskLeaseRefFor(
    event.projectId,
    event.payload.goalId,
    event.payload.taskId,
  );
  if (canonicalJson(lease.ref) !== canonicalJson(expectedLeaseRef)) return false;
  if (
    canonicalJson(attempt.ref) !==
    canonicalJson(
      taskAttemptRefFor(
        event.projectId,
        event.payload.goalId,
        event.payload.taskId,
        event.payload.attemptRef.attemptId,
      ),
    )
  ) {
    return false;
  }
  if (
    canonicalJson(run.ref) !==
    canonicalJson(runRefFor(event.projectId, event.payload.goalId, event.payload.runRef.runId))
  ) {
    return false;
  }
  if (
    canonicalJson(outbox.ref) !==
    canonicalJson(
      dispatchOutboxRefFor(
        event.projectId,
        event.payload.goalId,
        event.payload.taskId,
        event.payload.attemptRef.attemptId,
      ),
    )
  ) {
    return false;
  }
  if (event.aggregateId !== event.payload.taskId) return false;
  if (lease.holderRunId !== event.payload.runRef.runId) return false;
  if (lease.attemptId !== event.payload.attemptRef.attemptId) return false;
  if (attempt.runId !== event.payload.runRef.runId) return false;
  if (attempt.status !== "claimed") return false;
  if (attempt.startedAt !== null || attempt.endedAt !== null || attempt.endOutcome !== null) {
    return false;
  }
  if (canonicalJson(attempt.planRef) !== canonicalJson(event.payload.planRef)) return false;

  if (
    run.task.projectId !== event.projectId ||
    run.task.goalId !== event.payload.goalId ||
    run.task.taskId !== event.payload.taskId
  ) {
    return false;
  }
  if (run.attemptId !== event.payload.attemptRef.attemptId) return false;
  if (canonicalJson(run.planRef) !== canonicalJson(event.payload.planRef)) return false;
  if (canonicalJson(run.roleBinding) !== canonicalJson(event.payload.roleBinding)) return false;
  if (canonicalJson(run.budget) !== canonicalJson(event.payload.budget)) return false;
  if (run.workspaceSnapshot.workspaceId !== event.workspaceId) return false;
  if (
    run.status !== "starting" ||
    run.outcome !== null ||
    run.exitCode !== null ||
    run.lastEventSeq !== 0 ||
    run.lastRuntimeEventId !== "" ||
    run.lastFactEventId !== ""
  ) {
    return false;
  }
  if (run.envelope !== null || run.startedAt !== null || run.endedAt !== null) return false;

  if (outbox.status !== "pending") return false;
  if (canonicalJson(outbox.intent) !== canonicalJson(batch.outboxIntents[0]!)) return false;
  const intent = outbox.intent;
  if (intent.intentId !== event.payload.attemptRef.attemptId) return false;
  if (
    intent.projectId !== event.projectId ||
    intent.workspaceId !== event.workspaceId ||
    intent.goalId !== event.payload.goalId ||
    intent.taskId !== event.payload.taskId
  ) {
    return false;
  }
  if (canonicalJson(intent.planRef) !== canonicalJson(event.payload.planRef)) return false;
  if (canonicalJson(intent.attemptRef) !== canonicalJson(event.payload.attemptRef)) return false;
  if (canonicalJson(intent.runRef) !== canonicalJson(event.payload.runRef)) return false;
  if (canonicalJson(intent.roleBinding) !== canonicalJson(event.payload.roleBinding)) return false;
  if (canonicalJson(intent.declaredPermissions) !== canonicalJson(event.payload.declaredPermissions)) {
    return false;
  }
  if (canonicalJson(intent.budget) !== canonicalJson(event.payload.budget)) return false;
  if (intent.requestedAt !== event.payload.claimedAt || intent.requestedAt !== event.occurredAt) {
    return false;
  }
  if (intent.correlationId !== event.correlationId) return false;
  if (canonicalJson(intent.workspaceSnapshot) !== canonicalJson(run.workspaceSnapshot)) return false;

  // CAS: all four aggregates are created at revision 0 in one commit.
  if (batch.expectedVersions.length !== 4) return false;
  const expectedRefs = [
    lease.ref,
    attempt.ref,
    run.ref,
    outbox.ref,
  ];
  for (const [index, ref] of expectedRefs.entries()) {
    const expected = batch.expectedVersions[index]!;
    if (expected.revision !== 0) return false;
    if (canonicalJson(expected.ref) !== canonicalJson(ref)) return false;
  }

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

// ------------------------------------------------------------------------ //
// dispatch-start (P1-03)                                                     //
// ------------------------------------------------------------------------ //

export function validateDispatchStartCommit(batch: DispatchStartLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 3) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "RunStarted") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "Run") return false;
  if (!Number.isInteger(event.aggregateRevision) || event.aggregateRevision < 2) return false;
  if (event.payload.startedAt !== event.occurredAt) return false;

  const run = batch.snapshots.find((s): s is RunSnapshot => s.ref.aggregateType === "Run");
  const attempt = batch.snapshots.find(
    (s): s is TaskAttemptSnapshot => s.ref.aggregateType === "TaskAttempt",
  );
  const outbox = batch.snapshots.find(
    (s): s is DispatchOutboxEntrySnapshot => s.ref.aggregateType === "DispatchOutboxEntry",
  );
  if (run === undefined || attempt === undefined || outbox === undefined) return false;
  if (run.revision !== event.aggregateRevision || attempt.revision < 2 || outbox.revision < 2) return false;
  if (run.schemaVersion !== 1 || attempt.schemaVersion !== 1 || outbox.schemaVersion !== 1) {
    return false;
  }
  if (run.ref.runId !== event.aggregateId || event.aggregateId !== run.ref.runId) return false;
  if (event.payload.taskId !== run.task.taskId) return false;
  if (event.payload.attemptId !== run.attemptId) return false;
  if (canonicalJson(run.envelope) !== canonicalJson(event.payload.envelope)) return false;
  if (canonicalJson(run.executionAuthorization ?? null) !== canonicalJson(event.payload.executionAuthorization ?? null)) return false;
  if (run.status !== "running" || run.outcome !== null || run.endedAt !== null) return false;
  if (run.startedAt !== event.payload.startedAt) return false;
  if (run.lastEventSeq !== 0 || run.lastRuntimeEventId !== "" || run.lastFactEventId !== "") {
    return false;
  }
  if (attempt.status !== "started" || attempt.startedAt !== event.payload.startedAt) return false;
  if (attempt.endedAt !== null || attempt.endOutcome !== null) return false;
  if (outbox.status !== "started" || outbox.startedAt !== event.payload.startedAt) return false;

  // CAS: [Run@1, TaskAttempt@1, DispatchOutboxEntry@1].
  if (batch.expectedVersions.length !== 3) return false;
  for (const [index, ref] of [run.ref, attempt.ref, outbox.ref].entries()) {
    const expected = batch.expectedVersions[index]!;
    if (expected.revision !== [run.revision - 1, attempt.revision - 1, outbox.revision - 1][index]) return false;
    if (canonicalJson(expected.ref) !== canonicalJson(ref)) return false;
  }

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

// ------------------------------------------------------------------------ //
// run-fact (P1-03)                                                           //
// ------------------------------------------------------------------------ //

export function validateRunFactCommit(batch: RunFactLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (!isKnownEventType(event.eventType)) return false;

  const run = batch.snapshots.find((s): s is RunSnapshot => s.ref.aggregateType === "Run");
  const event0 = batch.events[0]!;
  if (event0.eventType === 'RunReconciled') {
    const next = event0.payload.run;
    if (!next.reconciliation || batch.identity.actor.kind !== 'system' || event0.aggregateId !== next.ref.runId || event0.aggregateRevision !== next.revision ||
        canonicalJson(batch.snapshots[0]!) !== canonicalJson(next) || event0.workspaceId !== next.workspaceSnapshot.workspaceId ||
        !identityMatchesActor(event0.projectId, event0.idempotencyKey, event0.actor.kind, event0.actor.id, batch.identity)) return false;
    if (batch.snapshots.length !== (next.reconciliation.observation.kind === 'runtime_terminal' ? 2 : 1) || batch.expectedVersions.length !== batch.snapshots.length) return false;
    return batch.snapshots.every(s => batch.expectedVersions.filter(v => canonicalJson(v.ref) === canonicalJson(s.ref) && v.revision === s.revision - 1).length === 1);
  }
  if (event0.eventType === 'ExecutionEntered' || event0.eventType === 'ExecutionRetryScheduled') {
    if (!run || batch.identity.actor.kind !== 'system' || event0.aggregateId !== run.ref.runId || event0.aggregateRevision !== run.revision ||
        !identityMatchesActor(event0.projectId, event0.idempotencyKey, event0.actor.kind, event0.actor.id, batch.identity)) return false;
    if (batch.snapshots.length !== (event0.eventType === 'ExecutionEntered' ? 1 : 3) || batch.expectedVersions.length !== batch.snapshots.length) return false;
    return batch.snapshots.every(s => batch.expectedVersions.filter(v => canonicalJson(v.ref) === canonicalJson(s.ref) && v.revision === s.revision - 1).length === 1);
  }
  if (event0.eventType === 'DispatchDeferred') {
    const outbox = batch.snapshots[0] as DispatchOutboxEntrySnapshot;
    if (batch.snapshots.length !== 1 || outbox.ref.aggregateType !== 'DispatchOutboxEntry' ||
        batch.expectedVersions.length !== 2 || outbox.status !== 'pending' || !outbox.schedule ||
        outbox.revision < 2 || event0.aggregateRevision !== outbox.revision || event0.aggregateId !== outbox.ref.attemptId ||
        canonicalJson(event0.payload.outbox) !== canonicalJson(outbox) ||
        canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(outbox.intent.runRef) ||
        canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(outbox.ref) ||
        batch.expectedVersions[1]!.revision !== outbox.revision - 1) return false;
    if (!Number.isInteger(outbox.schedule.attemptCount) || outbox.schedule.attemptCount < 1 ||
        !Number.isFinite(Date.parse(outbox.schedule.availableAt)) || !outbox.schedule.lastFailure) return false;
    return identityMatchesActor(event0.projectId, event0.idempotencyKey, event0.actor.kind, event0.actor.id, batch.identity);
  }
  if (event0.eventType === "ModelRequestAuthorized" || event0.eventType === "ModelRequestEvidenceRecorded") {
    /**
     * CM-1A-001 第 4 步 / D06：调用证据（许可签发与**一次**调用尝试）。
     *
     * 这两条事实**只**写许可聚合，**不**写 Run 快照、**不**推进 Run 的 revision：
     *   · 它们不是 Run 的生命周期事件（D06 明确不污染 RuntimeEventType）；
     *   · 更重要的是，Run 的 revision 序列是**多个消费者**（ordinary drive / handoff drive /
     *     workspace drive / reviewer）共用的单写者 CAS 计数器，任何非生命周期提交去推进它，
     *     都会让按既有序列读取的消费者 revision_conflict，从而丢掉这个 Run 的终态事实。
     *   · Run 侧的准入（exact Run、未结束、信封存在）由 **Control** 的 authorizeModelRequest
     *     在同一次调用里判定；账本负责的是**许可聚合自己的 CAS**。
     *
     * 「一次许可只能对应一次尝试」因此仍由**账本**保证：许可只有 @1（已签发）与 @2（已尝试）
     * 两态，第二次尝试提交 expectedVersions=[Permit@1] 时当前已是 @2，CAS 失败 → 提交被拒。
     */
    const permitSnapshot = batch.snapshots.find(
      (s): s is import("../../contracts/dispatch.js").ModelRequestPermitSnapshot => s.ref.aggregateType === "ModelRequestPermit",
    );
    if (permitSnapshot === undefined) return false;
    if (batch.snapshots.length !== 1) return false;
    if (batch.expectedVersions.length < 3) return false;
    const policyGuard = batch.expectedVersions.filter(v => v.ref.aggregateType === 'ProjectCoordinationPolicyActive' && v.ref.projectId === permitSnapshot.permit.runRef.projectId);
    if (policyGuard.length !== 1) return false;
    if (new Set(batch.expectedVersions.map(v => canonicalJson(v.ref))).size !== batch.expectedVersions.length) return false;
    const runGuard = batch.expectedVersions.filter(v => canonicalJson(v.ref) === canonicalJson(permitSnapshot.permit.runRef));
    if (runGuard.length !== 1 || runGuard[0]!.revision < 2) return false;
    if (!permitSnapshot.permit.requestId || !/^[0-9a-f]{64}$/.test(permitSnapshot.permit.requestDigest ?? '') ||
        !/^[0-9a-f]{64}$/.test(permitSnapshot.permit.contextInputDigest ?? '') ||
        !/^[0-9a-f]{64}$/.test(permitSnapshot.permit.manifestDigest ?? '')) return false;
    if (event0.aggregateType !== "ModelRequestPermit") return false;
    if (event0.aggregateId !== permitSnapshot.ref.permitId) return false;
    if (event0.aggregateRevision !== permitSnapshot.revision) return false;
    if (permitSnapshot.schemaVersion !== 1) return false;
    if (canonicalJson(permitSnapshot.permit as never) !== canonicalJson((event0.payload as { permit: unknown }).permit as never)) return false;
    const permitExpected = batch.expectedVersions.filter((v) => canonicalJson(v.ref as never) === canonicalJson(permitSnapshot.ref as never));
    if (permitExpected.length !== 1) return false;
    if (permitSnapshot.revision !== permitExpected[0]!.revision + 1) return false;
    if (event0.eventType === "ModelRequestAuthorized") {
      if (permitSnapshot.revision !== 1 || permitExpected[0]!.revision !== 0) return false;
      if (permitSnapshot.permit.consumedByAttemptId !== null || permitSnapshot.permit.consumedAt !== null) return false;
    } else {
      const evidence = (event0.payload as { evidence: import("../../contracts/dispatch.js").ModelRequestEvidenceV1 }).evidence;
      if (permitSnapshot.revision !== 2 || permitExpected[0]!.revision !== 1) return false;
      if (evidence.permitId !== permitSnapshot.permit.permitId) return false;
      if (permitSnapshot.permit.consumedByAttemptId !== evidence.attemptId) return false;
      if (permitSnapshot.permit.consumedAt === null) return false;
      if (canonicalJson(evidence.deliveryRefs as never) !== canonicalJson(permitSnapshot.permit.deliveryRefs as never)) return false;
      if (!/^[0-9a-f]{64}$/.test(evidence.requestDigest)) return false;
      if (evidence.requestDigest !== permitSnapshot.permit.requestDigest || evidence.contextInputDigest !== permitSnapshot.permit.contextInputDigest || evidence.attemptId !== permitSnapshot.permit.requestId) return false;
    }
    return identityMatchesActor(event0.projectId, event0.idempotencyKey, event0.actor.kind, event0.actor.id, batch.identity);
  }
  if (run === undefined) return false;
  if (event.aggregateType !== "Run" || event.aggregateId !== run.ref.runId) return false;
  if (event.aggregateRevision !== run.revision) return false;
  if (run.schemaVersion !== 1) return false;

  const outbox = batch.snapshots.find(
    (s): s is DispatchOutboxEntrySnapshot => s.ref.aggregateType === "DispatchOutboxEntry",
  );
  const attempt = batch.snapshots.find(
    (s): s is TaskAttemptSnapshot => s.ref.aggregateType === "TaskAttempt",
  );
  const terminal = event.eventType === "RunOutcomeUnknown" || (event.eventType === "RunEventRecorded" && isTerminalRuntimeEvent(event.payload.runtimeEvent));

  if (!terminal) {
    if (batch.snapshots.length !== 1) return false;
    if (attempt !== undefined || outbox !== undefined) return false;
    if (event.eventType !== 'RuntimeInputBound' && batch.expectedVersions.length !== 1) return false;
    if (batch.expectedVersions[0]!.revision !== run.revision - 1) return false;
    if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(run.ref)) return false;
    if (event.eventType !== "RunEventRecorded" && event.eventType !== 'RuntimeInputBound') return false;
    if (event.eventType === 'RuntimeInputBound' && (!run.inputBinding ||
        canonicalJson(run.inputBinding) !== canonicalJson(event.payload.binding) ||
        !/^[0-9a-f]{64}$/.test(run.inputBinding.inputDigest) || !/^[0-9a-f]{64}$/.test(run.inputBinding.manifestDigest))) return false;
    if (run.outcome !== null || run.endedAt !== null) return false;
    if (run.exitCode !== null) return false;
  } else {
    if (batch.snapshots.length !== 3) return false;
    if (attempt === undefined || outbox === undefined) return false;
    if (batch.expectedVersions.length !== 3) return false;
    if (attempt.schemaVersion !== 1 || outbox.schemaVersion !== 1) return false;
    if (!Number.isInteger(attempt.revision) || attempt.revision < 2) return false;
    if (outbox.revision < 2) return false;
    if (batch.expectedVersions[0]!.revision !== run.revision - 1) return false;
    if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(run.ref)) return false;
    if (batch.expectedVersions[1]!.revision !== attempt.revision - 1) return false;
    if (canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(attempt.ref)) return false;
    if (batch.expectedVersions[2]!.revision !== outbox.revision - 1) return false;
    if (canonicalJson(batch.expectedVersions[2]!.ref) !== canonicalJson(outbox.ref)) return false;
    if (attempt.endedAt === null || attempt.endOutcome === null) return false;
    if (outbox.status !== "done" || outbox.doneAt === null) return false;
  }

  if (event.eventType === "RunEventRecorded") {
    const rt = event.payload.runtimeEvent;
    if (rt.schemaVersion !== 1) return false;
    if (canonicalJson(rt.runRef) !== canonicalJson(run.ref)) return false;
    if (event.payload.taskId !== run.task.taskId) return false;
    if (rt.sequence !== run.lastEventSeq) return false;
    if (rt.eventId !== run.lastRuntimeEventId) return false;
    if (event.eventId !== run.lastFactEventId) return false;
    if (terminal) {
      if (run.status !== "ended" || run.outcome === null) return false;
      if (run.endedAt !== rt.occurredAt) return false;
      if (rt.payload.kind === "completed") {
        if (run.exitCode !== rt.payload.exitCode) return false;
      } else {
        if (run.exitCode !== null) return false;
      }
    } else {
      if (run.status !== "running" || run.outcome !== null || run.endedAt !== null) return false;
      if (run.exitCode !== null) return false;
    }
  } else if (event.eventType === "RunOutcomeUnknown") {
    if (run.status !== "ended" || run.outcome !== "outcome_unknown") return false;
    if (run.endedAt !== event.payload.observedAt) return false;
    if (run.exitCode !== null) return false;
    if (attempt?.endOutcome !== "outcome_unknown") return false;
    if (attempt?.endedAt !== event.payload.observedAt) return false;
  } else if (event.eventType === 'RuntimeInputBound') {
    if (!run.inputBinding || run.status === 'ended') return false;
  } else {
    return false;
  }

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

// ------------------------------------------------------------------------ //
// evidence-intake (P1-04)                                                   //
// ------------------------------------------------------------------------ //

export function validateEvidenceIntakeCommit(
  batch: import("../../contracts/ledger.js").EvidenceIntakeLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "EvidenceAdmitted") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "Evidence") return false;
  if (event.aggregateRevision !== 1) return false;

  const evidenceSnapshot = batch.snapshots.find(
    (s): s is import("../../contracts/evidence.js").EvidenceSnapshot => s.ref.aggregateType === "Evidence",
  );
  const indexSnapshot = batch.snapshots.find(
    (s): s is import("../../contracts/evidence.js").TaskEvidenceIndexSnapshot =>
      s.ref.aggregateType === "TaskEvidenceIndex",
  );
  if (evidenceSnapshot === undefined || indexSnapshot === undefined) return false;
  if (evidenceSnapshot.revision !== 1 || evidenceSnapshot.schemaVersion !== 1) return false;
  if (indexSnapshot.schemaVersion !== 1) return false;
  const evidence = evidenceSnapshot.evidence;
  if (evidenceSchemaVersionInvalid(evidence)) return false;
  if (evidenceSnapshot.ref.projectId !== event.projectId || evidenceSnapshot.ref.evidenceId !== event.aggregateId) {
    return false;
  }
  if (evidence.evidenceId !== event.aggregateId) return false;
  if (canonicalJson(evidence) !== canonicalJson(event.payload.evidence)) return false;
  if (evidence.subject.projectId !== event.projectId) return false;
  if (evidence.subject.goalId !== event.payload.goalId) return false;
  if (evidence.subject.taskId !== event.payload.taskId) return false;
  if (evidence.coverage.length === 0) return false;
  // A CompletionClaim is a self-report: it can NEVER be evidence PASS.
  if (evidence.kind === "claim" && evidence.outcome !== "INCONCLUSIVE") return false;
  if (evidence.verificationPlanRef.planId.length === 0 || evidence.verificationPlanRef.planDigest.length === 0) {
    return false;
  }
  if (evidence.source.actor.kind !== event.actor.kind || evidence.source.actor.id !== event.actor.id) {
    return false;
  }
  if (evidence.anchor.schemaVersion !== 1) return false;
  if (canonicalJson(evidence.anchor.planRef) !== canonicalJson(event.payload.evidence.anchor.planRef)) {
    return false;
  }
  if (evidence.anchor.planRevision < 1 || evidence.anchor.workspaceRevision < 1) return false;
  if (evidence.anchor.pinnedCompletionPolicy.ref.aggregateType !== "CompletionPolicyRevision") return false;
  if (evidence.anchor.pinnedArchitectureBaseline.ref.aggregateType !== "ArchitectureBaselineRevision") return false;
  if (evidence.anchor.pinnedCompletionPolicy.digest.length === 0) return false;
  if (evidence.anchor.pinnedArchitectureBaseline.digest.length === 0) return false;

  // Index alignment: revision == count; this evidence is the newest entry.
  const index = indexSnapshot;
  if (index.revision !== index.evidenceIds.length) return false;
  if (index.evidenceIds.length === 0) return false;
  if (index.evidenceIds[index.evidenceIds.length - 1] !== evidence.evidenceId) return false;
  if (index.ref.projectId !== event.projectId || index.ref.goalId !== event.payload.goalId || index.ref.taskId !== event.payload.taskId) {
    return false;
  }
  if (event.payload.evidenceIndex !== index.evidenceIds.length) return false;
  if (event.payload.evidenceCount !== index.evidenceIds.length) return false;
  if (event.payload.admittedAt !== event.occurredAt) return false;

  // CAS: Evidence@0 + TaskEvidenceIndex@(count-1).
  if (batch.expectedVersions.length !== 2) return false;
  if (batch.expectedVersions[0]!.revision !== 0) return false;
  if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(evidenceSnapshot.ref)) return false;
  if (batch.expectedVersions[1]!.revision !== index.revision - 1) return false;
  if (canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(index.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

function evidenceSchemaVersionInvalid(evidence: { schemaVersion: number }): boolean {
  return evidence.schemaVersion !== 1;
}

// ------------------------------------------------------------------------ //
// verification-result (P1-04)                                               //
// ------------------------------------------------------------------------ //

export function validateTaskReductionCommit(
  batch: import("../../contracts/ledger.js").TaskReductionLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "TaskReductionUpdated") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "TaskReduction") return false;
  const reduction = batch.snapshots[0]!;
  if (reduction.ref.aggregateType !== "TaskReduction") return false;
  if (reduction.schemaVersion !== 1) return false;
  if (!Number.isSafeInteger(reduction.revision) || reduction.revision < 1) return false;
  if (event.aggregateRevision !== reduction.revision) return false;
  if (event.aggregateId !== reduction.ref.taskId) return false;
  if (event.projectId !== reduction.ref.projectId) return false;
  if (event.payload.goalId !== reduction.ref.goalId || event.payload.taskId !== reduction.ref.taskId) {
    return false;
  }
  if (reduction.phase !== "verifying" && reduction.phase !== "blocked" && reduction.phase !== "failed" && reduction.phase !== "satisfied") {
    return false;
  }
  if (canonicalJson(event.payload.reduction) !== canonicalJson(reduction)) return false;
  if (reduction.currentAnchor.schemaVersion !== 1) return false;
  if (reduction.reducedAt !== event.occurredAt) return false;

  if (batch.reviewProtocol === 'independent-review-v1') {
    if (!batch.expectedVersions.some(v => v.ref.aggregateType === 'TaskReviewProtocol') || new Set(batch.expectedVersions.map(v => canonicalJson(v.ref))).size !== batch.expectedVersions.length) return false;
  } else if (batch.expectedVersions.length !== 1) return false;
  if (batch.expectedVersions[0]!.revision !== reduction.revision - 1) return false;
  if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(reduction.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

// ------------------------------------------------------------------------ //
// goal-reduction (P1-05)                                                    //
// ------------------------------------------------------------------------ //

export function validateGoalReductionCommit(
  batch: import("../../contracts/ledger.js").GoalReductionLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "GoalPhaseUpdated") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "GoalPhase") return false;
  const phase = batch.snapshots[0]!;
  if (phase.ref.aggregateType !== "GoalPhase") return false;
  if (phase.schemaVersion !== 1) return false;
  if (!Number.isSafeInteger(phase.revision) || phase.revision < 1) return false;
  if (event.aggregateRevision !== phase.revision) return false;
  if (event.aggregateId !== phase.ref.goalId) return false;
  if (event.projectId !== phase.ref.projectId) return false;
  if (event.payload.goalId !== phase.ref.goalId) return false;
  if (event.payload.phase !== phase.phase) return false;
  if (event.payload.previousPhase !== phase.previousPhase) return false;
  if (canonicalJson(event.payload.reasonCodes) !== canonicalJson(phase.reasonCodes)) return false;
  if (canonicalJson(event.payload.explanation) !== canonicalJson(phase.explanation)) return false;
  if (canonicalJson(event.payload.sideEffectReconciliation) !== canonicalJson(phase.sideEffectReconciliation)) return false;
  if (canonicalJson(event.payload.planRef) !== canonicalJson(phase.planRef)) return false;
  if (phase.reducedAt !== event.occurredAt) return false;
  if (event.payload.reducedAt !== event.occurredAt) return false;
  if (batch.reviewProtocol === 'independent-review-v1') {
    if (!batch.expectedVersions.some(v => v.ref.aggregateType === 'TaskReviewProtocol') || new Set(batch.expectedVersions.map(v => canonicalJson(v.ref))).size !== batch.expectedVersions.length) return false;
  } else if (batch.expectedVersions.length !== 1) return false;
  if (batch.expectedVersions[0]!.revision !== phase.revision - 1) return false;
  if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(phase.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}


// ------------------------------------------------------------------------ //
// P1-06 handoff validators (shared by BOTH adapters)                         //
// ------------------------------------------------------------------------ //

export function validateHandoffRecordCommit(batch: HandoffRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "HandoffRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "HandoffPacket") return false;
  if (event.aggregateRevision !== 1) return false;

  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "HandoffPacket") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const packet = snapshot.packet;
  if (packet.packetId !== event.aggregateId) return false;
  if (canonicalJson(packet) !== canonicalJson(event.payload.packet)) return false;
  if (packet.projectId !== event.projectId) return false;
  if (packet.workspaceId !== event.workspaceId) return false;
  if (packet.goalId !== event.payload.goalId) return false;
  if (packet.taskId !== event.payload.taskId) return false;
  if (packet.noFullTranscript !== true) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.goalId !== event.payload.goalId) return false;
  if (snapshot.ref.taskId !== event.payload.taskId) return false;
  if (snapshot.ref.packetId !== packet.packetId) return false;
  if (snapshot.recordedAt !== event.payload.recordedAt) return false;

  // Immutability CAS: exactly one expected version = the packet at 0.
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

export function validateReplacementClaimCommit(batch: ReplacementClaimLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 5) return false;
  if (batch.outboxIntents.length !== 1) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ReplacementClaimed") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ReplacementAttempt") return false;
  if (event.aggregateRevision !== 1) return false;

  const lease = batch.snapshots.find((s): s is TaskLeaseSnapshot => s.ref.aggregateType === "TaskLease");
  const attempt = batch.snapshots.find((s): s is TaskAttemptSnapshot => s.ref.aggregateType === "TaskAttempt");
  const run = batch.snapshots.find((s): s is RunSnapshot => s.ref.aggregateType === "Run");
  const outbox = batch.snapshots.find((s): s is DispatchOutboxEntrySnapshot => s.ref.aggregateType === "DispatchOutboxEntry");
  const replacement = batch.snapshots.find((s): s is ReplacementAttemptSnapshot => s.ref.aggregateType === "ReplacementAttempt");
  if (lease === undefined || attempt === undefined || run === undefined || outbox === undefined || replacement === undefined) {
    return false;
  }
  if (attempt.revision !== 1 || run.revision !== 1 || outbox.revision !== 1 || replacement.revision !== 1) {
    return false;
  }
  // A replacement REQUIRES a prior lease (>= 1) — the lease moved to revision >= 2.
  if (lease.revision < 2) return false;
  if (
    lease.schemaVersion !== 1 || attempt.schemaVersion !== 1 || run.schemaVersion !== 1 ||
    outbox.schemaVersion !== 1 || replacement.schemaVersion !== 1
  ) {
    return false;
  }

  // Event <-> snapshot alignment (full refs).
  if (canonicalJson(attempt.ref) !== canonicalJson(event.payload.attemptRef)) return false;
  if (canonicalJson(run.ref) !== canonicalJson(event.payload.runRef)) return false;
  if (canonicalJson(outbox.ref) !== canonicalJson(event.payload.outboxRef)) return false;
  if (canonicalJson(replacement.ref) !== canonicalJson(event.payload.replacementRef)) return false;
  if (canonicalJson(replacement.packetRef) !== canonicalJson(event.payload.packetRef)) return false;
  if (canonicalJson(replacement.priorAttemptRef) !== canonicalJson(event.payload.priorAttemptRef)) return false;
  if (canonicalJson(replacement.priorRunRef) !== canonicalJson(event.payload.priorRunRef)) return false;

  // Lease moved to B (the NEW holder) — a stale holder cannot survive.
  if (lease.holderRunId !== event.payload.runRef.runId) return false;
  if (lease.attemptId !== event.payload.attemptRef.attemptId) return false;
  if (attempt.runId !== event.payload.runRef.runId) return false;
  if (attempt.ref.attemptId !== event.payload.attemptRef.attemptId) return false;
  if (run.attemptId !== event.payload.attemptRef.attemptId) return false;
  if (outbox.intent.intentId !== event.payload.attemptRef.attemptId) return false;
  if (outbox.status !== "pending") return false;
  if (replacement.ref.attemptId !== event.payload.attemptRef.attemptId) return false;
  if (replacement.runRef.runId !== event.payload.runRef.runId) return false;
  if (replacement.reason !== event.payload.reason) return false;

  // The durable intent rides the same commit and must reference B's lifecycle.
  const intent = batch.outboxIntents[0]!;
  if (intent.intentId !== event.payload.attemptRef.attemptId) return false;
  if (canonicalJson(intent.attemptRef) !== canonicalJson(event.payload.attemptRef)) return false;
  if (canonicalJson(intent.runRef) !== canonicalJson(event.payload.runRef)) return false;
  if (intent.taskId !== event.payload.taskId) return false;
  if (intent.goalId !== event.payload.goalId) return false;
  const expectedLeaseRef = taskLeaseRefFor(event.projectId, event.payload.goalId, event.payload.taskId);
  if (canonicalJson(lease.ref) !== canonicalJson(expectedLeaseRef)) return false;

  // CAS: exactly 5 expected versions (lease@N, attempt/run/outbox/replacement@0).
  if (batch.expectedVersions.length !== 5) return false;
  const leaseExpected = batch.expectedVersions.find((v) => v.ref.aggregateType === "TaskLease");
  if (leaseExpected === undefined || leaseExpected.revision !== lease.revision - 1) return false;
  const expects = (ref: { aggregateType: string }): boolean =>
    batch.expectedVersions.some((v) => v.ref.aggregateType === ref.aggregateType && v.revision === 0 && canonicalJson(v.ref) === canonicalJson(ref));
  if (!expects(attempt.ref)) return false;
  if (!expects(run.ref)) return false;
  if (!expects(outbox.ref)) return false;
  if (!expects(replacement.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

// ------------------------------------------------------------------------ //
// P1-07 pure commit validators (shared by both ledger adapters)             //
// ------------------------------------------------------------------------ //

function expectedVersionOf(batch: { expectedVersions: { ref: { aggregateType: string }; revision: number }[] }, ref: { aggregateType: string }): number | null {
  const hit = batch.expectedVersions.find((v) => canonicalJson(v.ref) === canonicalJson(ref));
  return hit === undefined ? null : hit.revision;
}

export function validateWorkspaceReadLeaseAcquireCommit(batch: WorkspaceReadLeaseAcquireLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "WorkspaceReadLeaseGranted") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "WorkspaceReadLease") return false;
  if (event.aggregateRevision !== 1) return false;
  const lease = batch.snapshots[0]!;
  const index = batch.snapshots[1]!;
  if (lease.ref.aggregateType !== "WorkspaceReadLease") return false;
  if (index.ref.aggregateType !== "WorkspaceReadLeaseIndex") return false;
  if (lease.revision !== 1) return false;
  if (lease.schemaVersion !== 1) return false;
  if (index.schemaVersion !== 1) return false;
  const expectedLeaseRef = workspaceReadLeaseRefFor(event.projectId, event.payload.leaseId);
  if (canonicalJson(lease.ref) !== canonicalJson(expectedLeaseRef)) return false;
  const expectedIndexRef = workspaceReadLeaseIndexRefFor(event.projectId, event.workspaceId);
  if (canonicalJson(index.ref) !== canonicalJson(expectedIndexRef)) return false;
  if (event.aggregateId !== event.payload.leaseId) return false;
  if (event.projectId !== lease.ref.projectId) return false;
  if (event.workspaceId !== index.ref.workspaceId) return false;
  if (event.payload.leaseId !== lease.lease.leaseId) return false;
  if (canonicalJson(event.payload.scope) !== canonicalJson(lease.lease.scope)) return false;
  if (canonicalJson(event.payload.holder) !== canonicalJson({ runRef: lease.lease.holder.runRef, attemptRef: lease.lease.holder.attemptRef })) return false;
  if (event.payload.expiresAt !== lease.lease.expiresAt) return false;
  if (lease.lease.status !== "active") return false;
  if (lease.lease.grantedAt !== event.occurredAt) return false;
  if (lease.lease.releasedAt !== null || lease.lease.releasedBy !== null) return false;
  const indexWait = expectedVersionOf(batch, index.ref);
  if (indexWait === null || index.revision !== indexWait + 1) return false;
  if (expectedVersionOf(batch, lease.ref) !== 0) return false;
  const opposingIndexRevision = expectedVersionOf(batch, workspaceWriteLeaseIndexRefFor(event.projectId, event.workspaceId));
  if (opposingIndexRevision === null || !Number.isInteger(opposingIndexRevision) || opposingIndexRevision < 0) return false;
  if (!index.activeReadLeases.some((e) => e.leaseId === lease.lease.leaseId && canonicalJson(e.scope) === canonicalJson(lease.lease.scope))) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateWorkspaceReadLeaseReleaseCommit(batch: WorkspaceReadLeaseReleaseLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "WorkspaceReadLeaseReleased") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "WorkspaceReadLease") return false;
  if (event.aggregateRevision !== 2) return false;
  const lease = batch.snapshots[0]!;
  const index = batch.snapshots[1]!;
  if (lease.ref.aggregateType !== "WorkspaceReadLease") return false;
  if (index.ref.aggregateType !== "WorkspaceReadLeaseIndex") return false;
  if (lease.revision !== 2) return false;
  if (lease.lease.status !== "released") return false;
  if (lease.lease.releasedAt !== event.payload.releasedAt) return false;
  if (lease.lease.releasedBy !== event.payload.releasedBy) return false;
  if (event.aggregateId !== lease.ref.leaseId) return false;
  if (event.payload.leaseId !== lease.ref.leaseId) return false;
  if (expectedVersionOf(batch, lease.ref) !== 1) return false;
  const indexWait = expectedVersionOf(batch, index.ref);
  if (indexWait === null || index.revision !== indexWait + 1) return false;
  if (index.activeReadLeases.some((e) => e.leaseId === lease.ref.leaseId)) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

function validateWriteLeaseIndexSnapshot(index: WorkspaceWriteLeaseIndexSnapshot, lease: WorkspaceWriteLeaseSnapshot, batch: { expectedVersions: { ref: { aggregateType: string }; revision: number }[] }): boolean {
  if (index.schemaVersion !== 1) return false;
  if (index.activeLeaseId !== lease.ref.leaseId) return false;
  if (canonicalJson(index.activeScope) !== canonicalJson(lease.lease.scope)) return false;
  if (canonicalJson(index.holderRunRef) !== canonicalJson(lease.lease.holder.runRef)) return false;
  const indexWait = expectedVersionOf(batch, index.ref);
  return indexWait !== null && index.revision === indexWait + 1;
}

export function validateWorkspaceWriteLeaseAcquireCommit(batch: WorkspaceWriteLeaseAcquireLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 2 && batch.snapshots.length !== 3) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "WorkspaceWriteLeaseGranted") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "WorkspaceWriteLease") return false;
  if (event.aggregateRevision !== 1) return false;
  const lease = batch.snapshots[0]!;
  const index = batch.snapshots[1]!;
  if (lease.ref.aggregateType !== "WorkspaceWriteLease") return false;
  if (index.ref.aggregateType !== "WorkspaceWriteLeaseIndex") return false;
  if (lease.revision !== 1) return false;
  const expectedLeaseRef = workspaceWriteLeaseRefFor(event.projectId, event.payload.leaseId);
  if (canonicalJson(lease.ref) !== canonicalJson(expectedLeaseRef)) return false;
  const expectedIndexRef = workspaceWriteLeaseIndexRefFor(event.projectId, event.workspaceId);
  if (canonicalJson(index.ref) !== canonicalJson(expectedIndexRef)) return false;
  if (event.aggregateId !== event.payload.leaseId) return false;
  if (event.projectId !== lease.ref.projectId) return false;
  if (event.payload.leaseId !== lease.lease.leaseId) return false;
  if (canonicalJson(event.payload.scope) !== canonicalJson(lease.lease.scope)) return false;
  if (canonicalJson(event.payload.holder) !== canonicalJson({ runRef: lease.lease.holder.runRef, attemptRef: lease.lease.holder.attemptRef })) return false;
  if (event.payload.expiresAt !== lease.lease.expiresAt) return false;
  if (lease.lease.status !== "active") return false;
  if (lease.lease.grantedAt !== event.occurredAt) return false;
  if (lease.lease.releasedAt !== null || lease.lease.releasedBy !== null) return false;
  if (expectedVersionOf(batch, lease.ref) !== 0) return false;
  const opposingIndexRevision = expectedVersionOf(batch, workspaceReadLeaseIndexRefFor(event.projectId, event.workspaceId));
  if (opposingIndexRevision === null || !Number.isInteger(opposingIndexRevision) || opposingIndexRevision < 0) return false;
  if (!validateWriteLeaseIndexSnapshot(index, lease, batch)) return false;
  if (batch.vacatedLeaseRef !== null) {
    if (batch.snapshots.length !== 3) return false;
    const vacated = batch.snapshots[2]!;
    if (vacated.ref.aggregateType !== "WorkspaceWriteLease") return false;
    if (canonicalJson(vacated.ref) !== canonicalJson(batch.vacatedLeaseRef)) return false;
    if (vacated.revision !== 2) return false;
    if (vacated.lease.status !== "released") return false;
    if (vacated.lease.releasedBy !== null) return false;
    if (vacated.lease.releasedAt !== event.occurredAt) return false;
    if (expectedVersionOf(batch, vacated.ref) !== 1) return false;
  }

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateWorkspaceWriteLeaseReleaseCommit(batch: WorkspaceWriteLeaseReleaseLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "WorkspaceWriteLeaseReleased") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "WorkspaceWriteLease") return false;
  if (event.aggregateRevision !== 2) return false;
  const lease = batch.snapshots[0]!;
  const index = batch.snapshots[1]!;
  if (lease.ref.aggregateType !== "WorkspaceWriteLease") return false;
  if (index.ref.aggregateType !== "WorkspaceWriteLeaseIndex") return false;
  if (lease.revision !== 2) return false;
  if (lease.lease.status !== "released") return false;
  if (lease.lease.releasedAt !== event.payload.releasedAt) return false;
  if (lease.lease.releasedBy !== event.payload.releasedBy) return false;
  if (event.payload.releasedVia !== "explicit") return false;
  if (event.payload.postWriteWorkspaceRevision !== null) return false;
  if (lease.lease.postWriteWorkspaceRevision !== null) return false;
  if (event.aggregateId !== lease.ref.leaseId) return false;
  if (event.payload.leaseId !== lease.ref.leaseId) return false;
  if (expectedVersionOf(batch, lease.ref) !== 1) return false;
  if (index.activeLeaseId !== null || index.activeScope !== null || index.holderRunRef !== null) return false;
  const indexWait = expectedVersionOf(batch, index.ref);
  if (indexWait === null || index.revision !== indexWait + 1) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateIntegrationRecordCommit(batch: IntegrationRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "IntegrationJoined") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "IntegrationResult") return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "IntegrationResult") return false;
  if (snapshot.schemaVersion !== 1) return false;
  const expectedRef = integrationResultRefFor(event.projectId, event.payload.goalId, event.payload.taskId);
  if (canonicalJson(snapshot.ref) !== canonicalJson(expectedRef)) return false;
  if (event.aggregateId !== event.payload.taskId) return false;
  if (snapshot.records.length !== snapshot.revision) return false;
  if (snapshot.revision !== event.aggregateRevision) return false;
  if (snapshot.records.length < 1) return false;
  if (expectedVersionOf(batch, snapshot.ref) !== snapshot.revision - 1) return false;
  if (event.occurredAt !== snapshot.records[snapshot.records.length - 1]!.generatedAt) return false;
  const last = snapshot.records[snapshot.records.length - 1]!;
  if (last.resultId !== event.payload.resultId) return false;
  if (last.taskId !== event.payload.taskId) return false;
  if (canonicalJson(last.runRef) !== canonicalJson(event.payload.runRef)) return false;
  if (last.workspaceRevision !== event.payload.workspaceRevision) return false;
  if (canonicalJson(last.inputs) !== canonicalJson(event.payload.inputs)) return false;
  if (canonicalJson(last.conflicts) !== canonicalJson(event.payload.conflicts)) return false;
  if (canonicalJson(last.gaps) !== canonicalJson(event.payload.gaps)) return false;
  if (last.explanation !== event.payload.explanation) return false;
  if (last.escalate !== event.payload.escalate) return false;
  if (last.generatedAt !== event.payload.generatedAt) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validatePatchRecordCommit(batch: PatchRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 2) return false;
  if (batch.snapshots.length !== 4) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const patchEvent = batch.events[0]!;
  const releaseEvent = batch.events[1]!;
  if (patchEvent.schemaVersion !== 1 || releaseEvent.schemaVersion !== 1) return false;
  if (patchEvent.eventType !== "PatchRecorded") return false;
  if (releaseEvent.eventType !== "WorkspaceWriteLeaseReleased") return false;
  if (!isKnownEventType(patchEvent.eventType) || !isKnownEventType(releaseEvent.eventType)) return false;
  if (patchEvent.aggregateType !== "PatchRecord") return false;
  if (patchEvent.aggregateRevision !== 1) return false;
  if (releaseEvent.aggregateType !== "WorkspaceWriteLease") return false;
  if (releaseEvent.aggregateRevision !== 2) return false;
  const patch = batch.snapshots[0]!;
  const workspace = batch.snapshots[1]!;
  const lease = batch.snapshots[2]!;
  const index = batch.snapshots[3]!;
  if (patch.ref.aggregateType !== "PatchRecord") return false;
  if (workspace.ref.aggregateType !== "Workspace") return false;
  if (lease.ref.aggregateType !== "WorkspaceWriteLease") return false;
  if (index.ref.aggregateType !== "WorkspaceWriteLeaseIndex") return false;
  if (patch.revision !== 1) return false;
  const expectedPatchRef = patchRecordRefFor(patchEvent.projectId, patchEvent.payload.patchId);
  if (canonicalJson(patch.ref) !== canonicalJson(expectedPatchRef)) return false;
  if (patchEvent.aggregateId !== patchEvent.payload.patchId) return false;
  if (patchEvent.payload.patchId !== patch.patch.patchId) return false;
  if (patchEvent.payload.taskId !== patch.patch.taskId) return false;
  if (canonicalJson(patchEvent.payload.runRef) !== canonicalJson(patch.patch.runRef)) return false;
  if (patchEvent.payload.kind !== patch.patch.kind) return false;
  if (patchEvent.payload.title !== patch.patch.title) return false;
  if (canonicalJson(patchEvent.payload.changedPaths) !== canonicalJson(patch.patch.changedPaths)) return false;
  if (patchEvent.payload.beforeWorkspaceRevision !== patch.patch.beforeWorkspaceRevision) return false;
  if (patchEvent.payload.afterWorkspaceRevision !== patch.patch.afterWorkspaceRevision) return false;
  if (canonicalJson(patchEvent.payload.checkResults) !== canonicalJson(patch.patch.checkResults)) return false;
  if (canonicalJson(patchEvent.payload.usedInputEvidenceRefs) !== canonicalJson(patch.patch.usedInputEvidenceRefs)) return false;
  if (patch.recordedAt !== patchEvent.occurredAt) return false;
  // Workspace canonical advance N -> N+1 (only via patch-record).
  if (workspace.revision !== patch.patch.afterWorkspaceRevision) return false;
  if (expectedVersionOf(batch, workspace.ref) !== workspace.revision - 1) return false;
  // The write lease is released BY the patch record (@2, releasedVia patch-record).
  if (lease.revision !== 2) return false;
  if (lease.lease.status !== "released") return false;
  if (lease.lease.releasedAt !== releaseEvent.payload.releasedAt) return false;
  if (lease.lease.releasedBy !== releaseEvent.payload.releasedBy) return false;
  if (releaseEvent.payload.releasedVia !== "patch-record") return false;
  if (releaseEvent.payload.postWriteWorkspaceRevision !== workspace.revision) return false;
  if (lease.lease.postWriteWorkspaceRevision !== workspace.revision) return false;
  if (releaseEvent.payload.leaseId !== lease.ref.leaseId) return false;
  if (releaseEvent.aggregateId !== lease.ref.leaseId) return false;
  if (releaseEvent.projectId !== patchEvent.projectId) return false;
  if (canonicalJson(patchEvent.payload.usedInputEvidenceRefs) !== canonicalJson(patch.patch.usedInputEvidenceRefs)) return false;
  if (expectedVersionOf(batch, patch.ref) !== 0) return false;
  if (expectedVersionOf(batch, lease.ref) !== 1) return false;
  if (index.activeLeaseId !== null || index.activeScope !== null || index.holderRunRef !== null) return false;
  const indexWait = expectedVersionOf(batch, index.ref);
  if (indexWait === null || index.revision !== indexWait + 1) return false;
  if (!lease.lease.patches.some((r) => canonicalJson(r) === canonicalJson(patch.ref))) return false;

  return identityMatchesActor(patchEvent.projectId, patchEvent.idempotencyKey, patchEvent.actor.kind, patchEvent.actor.id, batch.identity);
}

// ------------------------------------------------------------------------ //
// P1-16 context-continuity commit validators (shared by BOTH adapters)      //
// ------------------------------------------------------------------------ //


// ------------------------------------------------------------------------ //
// P1-10 control validators (shared by BOTH adapters)                        //
// ------------------------------------------------------------------------ //

export function validateControlIntentRecordCommit(batch: import("../../contracts/ledger.js").ControlIntentRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== (batch.events[0]?.payload.intent.scope.runRef ? 2 : 1)) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ControlIntentRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ControlIntent") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ControlIntent") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const intent = snapshot.intent;
  if (intent.intentId !== event.aggregateId) return false;
  if (canonicalJson(intent) !== canonicalJson(event.payload.intent)) return false;
  if (intent.projectId !== event.projectId) return false;
  if (intent.workspaceId !== event.workspaceId) return false;
  if (intent.status !== "queued") return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.intentId !== intent.intentId) return false;
  if (intent.acks.length !== 0) return false;
  if (batch.expectedVersions.length !== batch.snapshots.length) return false;
  if (intent.scope.runRef) {
    const run = batch.snapshots[1]; const guard = batch.expectedVersions[1];
    if (!run || !guard || canonicalJson(run.ref) !== canonicalJson(intent.scope.runRef) ||
        canonicalJson(guard.ref) !== canonicalJson(run.ref) || run.revision !== guard.revision + 1 ||
        canonicalJson(run.controlState ?? null) !== canonicalJson({ intentRef: snapshot.ref, desiredState: intent.desiredState })) return false;
  }
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateControlAckRecordCommit(batch: import("../../contracts/ledger.js").ControlAckRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "SafePointAcknowledged") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ControlIntent") return false;
  if (event.aggregateRevision < 2) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ControlIntent") return false;
  if (snapshot.revision !== event.aggregateRevision) return false;
  if (snapshot.schemaVersion !== 1) return false;
  const intent = snapshot.intent;
  if (intent.intentId !== event.aggregateId) return false;
  if (intent.projectId !== event.projectId) return false;
  if (intent.workspaceId !== event.workspaceId) return false;
  const lastAck = intent.acks[intent.acks.length - 1];
  if (lastAck === undefined || canonicalJson(event.payload.ack) !== canonicalJson(lastAck)) return false;
  if (event.payload.status !== intent.status) return false;
  if (event.payload.updatedAt !== intent.updatedAt) return false;
  if (intent.acks.length > CONTROL_INTENT_MAX_ACKS) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== snapshot.revision - 1) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


// ------------------------------------------------------------------------ //
// P1-09 query-job validators (shared by BOTH adapters)                      //
// ------------------------------------------------------------------------ //

export function validateQueryJobRecordCommit(batch: import("../../contracts/ledger.js").QueryJobRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 2) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const [jobEvent, runEvent] = batch.events as [import("../../contracts/query-job.js").QueryJobSubmittedEvent, import("../../contracts/query-job.js").QueryRunStartedEvent];
  if (jobEvent.eventType !== "QueryJobSubmitted") return false;
  if (runEvent.eventType !== "QueryRunStarted") return false;
  if (!isKnownEventType(jobEvent.eventType) || !isKnownEventType(runEvent.eventType)) return false;
  const jobSnap = batch.snapshots[0] as import("../../contracts/query-job.js").QueryJobSnapshot;
  const runSnap = batch.snapshots[1] as import("../../contracts/query-job.js").QueryRunSnapshot;
  if (jobSnap.ref.aggregateType !== "QueryJob" || runSnap.ref.aggregateType !== "QueryRun") return false;
  if (!validQueryExecution(jobSnap.job.intent.execution)) return false;
  if (jobSnap.job.intent.execution?.implementationAuthorization && jobEvent.actor.kind !== 'human') return false;
  if (jobSnap.revision !== 1 || runSnap.revision !== 1) return false;
  if (canonicalJson(jobSnap.job) !== canonicalJson(jobEvent.payload.job)) return false;
  if (canonicalJson(runSnap.run) !== canonicalJson(runEvent.payload.run)) return false;
  if (jobSnap.job.queryJobId !== jobEvent.aggregateId) return false;
  if (jobSnap.job.projectId !== jobEvent.projectId || jobSnap.job.workspaceId !== jobEvent.workspaceId) return false;
  if (runSnap.run.queryJobRef.queryJobId !== jobSnap.job.queryJobId) return false;
  if (jobSnap.job.status !== "pending" || runSnap.run.status !== "pending") return false;
  if (batch.expectedVersions.length !== 2) return false;
  const jE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryJob");
  const rE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryRun");
  if (jE === undefined || jE.revision !== 0 || canonicalJson(jE.ref) !== canonicalJson(jobSnap.ref)) return false;
  if (rE === undefined || rE.revision !== 0 || canonicalJson(rE.ref) !== canonicalJson(runSnap.ref)) return false;
  return identityMatchesActor(jobEvent.projectId, jobEvent.idempotencyKey, jobEvent.actor.kind, jobEvent.actor.id, batch.identity);
}

export function validateQueryAnswerRecordCommit(batch: import("../../contracts/ledger.js").QueryAnswerRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 3) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "QueryJobAnswerRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  const answerSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryJobAnswer") as import("../../contracts/query-job.js").QueryJobAnswerSnapshot | undefined;
  const jobSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryJob") as import("../../contracts/query-job.js").QueryJobSnapshot | undefined;
  const runSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryRun") as import("../../contracts/query-job.js").QueryRunSnapshot | undefined;
  if (answerSnap === undefined || jobSnap === undefined || runSnap === undefined) return false;
  if (answerSnap.revision !== 1 || answerSnap.schemaVersion !== 1) return false;
  if (canonicalJson(answerSnap.answer) !== canonicalJson(event.payload.answer)) return false;
  if (canonicalJson(jobSnap.job) !== canonicalJson(event.payload.job)) return false;
  if (canonicalJson(runSnap.run) !== canonicalJson(event.payload.run)) return false;
  if (jobSnap.job.status !== "answered") return false;
  if (runSnap.run.status !== "answered" && runSnap.run.status !== "running") return false;
  if (jobSnap.job.answerRefs[jobSnap.job.answerRefs.length - 1]?.answerId !== answerSnap.answer.answerId) return false;
  if (batch.expectedVersions.length !== 3) return false;
  const aE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryJobAnswer");
  if (aE === undefined || aE.revision !== 0) return false;
  const jE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryJob");
  if (jE === undefined || jE.revision !== jobSnap.revision - 1) return false;
  const rE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryRun");
  if (rE === undefined || rE.revision !== runSnap.revision - 1) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateQueryCloseRecordCommit(batch: import("../../contracts/ledger.js").QueryCloseRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "QueryJobClosed") return false;
  if (!isKnownEventType(event.eventType)) return false;
  const jobSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryJob") as import("../../contracts/query-job.js").QueryJobSnapshot | undefined;
  const runSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryRun") as import("../../contracts/query-job.js").QueryRunSnapshot | undefined;
  if (jobSnap === undefined || runSnap === undefined) return false;
  if (canonicalJson(jobSnap.job) !== canonicalJson(event.payload.job)) return false;
  if (canonicalJson(runSnap.run) !== canonicalJson(event.payload.run)) return false;
  if (jobSnap.job.status !== "closed" || runSnap.run.status !== "closed") return false;
  if (jobSnap.job.closeReason?.code !== event.payload.reason.code) return false;
  const jE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryJob");
  if (jE === undefined || jE.revision !== jobSnap.revision - 1) return false;
  const rE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryRun");
  if (rE === undefined || rE.revision !== runSnap.revision - 1) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


// ------------------------------------------------------------------------ //
// P1-11 goal-change validators (shared by BOTH adapters)                    //
// ------------------------------------------------------------------------ //

export function validatePlanChangeProposalRecordCommit(batch: import("../../contracts/ledger.js").PlanChangeProposalRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "PlanProposalRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "PlanProposal" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0] as import("../../contracts/goal-change.js").PlanProposalSnapshot;
  if (snap.ref.aggregateType !== "PlanProposal" || snap.revision !== 1) return false;
  if (canonicalJson(snap.proposal) !== canonicalJson(event.payload.proposal)) return false;
  if (snap.proposal.proposalId !== event.aggregateId) return false;
  if (snap.recordedAt !== event.payload.recordedAt) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateUserDecisionRecordCommit(batch: import("../../contracts/ledger.js").UserDecisionRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "UserDecisionRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "UserDecision" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0] as import("../../contracts/goal-change.js").UserDecisionSnapshot;
  if (snap.ref.aggregateType !== "UserDecision" || snap.revision !== 1) return false;
  if (canonicalJson(snap.decision) !== canonicalJson(event.payload.decision)) return false;
  if (snap.decision.decisionId !== event.aggregateId) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateGoalChangeApplyCommit(batch: import("../../contracts/ledger.js").GoalChangeApplyLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 3) return false;
  if (batch.snapshots.length !== 3 || batch.outboxIntents.length !== 0) return false;
  const [planEvent, supersedeEvent, revisionEvent] = batch.events as [import("../../contracts/plan.js").PlanRevisionAcceptedEvent, import("../../contracts/goal-change.js").PlanRevisionSupersededEvent, import("../../contracts/goal-change.js").GoalRevisionRecordedEvent];
  if (planEvent.eventType !== "PlanRevisionAccepted" || supersedeEvent.eventType !== "PlanRevisionSuperseded" || revisionEvent.eventType !== "GoalRevisionRecorded") return false;
  if (!isKnownEventType(planEvent.eventType) || !isKnownEventType(supersedeEvent.eventType) || !isKnownEventType(revisionEvent.eventType)) return false;
  const planSnap = batch.snapshots.find((s) => s.ref.aggregateType === "PlanRevision") as import("../../contracts/plan.js").PlanRevisionSnapshot | undefined;
  const revSnap = batch.snapshots.find((s) => s.ref.aggregateType === "GoalRevision") as import("../../contracts/goal-change.js").GoalRevisionSnapshot | undefined;
  const goalSnap = batch.snapshots.find((s) => s.ref.aggregateType === "Goal") as import("../../contracts/ledger.js").GoalSnapshot | undefined;
  if (planSnap === undefined || revSnap === undefined || goalSnap === undefined) return false;
  if (canonicalJson(planSnap) !== canonicalJson(planEvent.payload.planRevision)) return false;
  if (goalSnap.revision !== planEvent.payload.goalAggregateRevision) return false;
  if (goalSnap.activePlanRevision?.planId !== planSnap.ref.planId) return false;
  if (canonicalJson(revSnap.change) !== canonicalJson(revisionEvent.payload.change)) return false;
  const supersededRefs = revSnap.change.supersededPlanRefs;
  if (supersededRefs.length === 0) return false;
  const lastSuperseded = supersededRefs[supersededRefs.length - 1]!;
  if (canonicalJson(supersedeEvent.payload.supersededRef) !== canonicalJson(lastSuperseded)) return false;
  if (canonicalJson(supersedeEvent.payload.activeRef) !== canonicalJson(revSnap.change.activePlanRef)) return false;
  if (supersedeEvent.payload.decisionRef.aggregateType !== "UserDecision" || !supersedeEvent.payload.decisionRef.decisionId) return false;
  if (supersedeEvent.payload.changedAt !== revSnap.change.changedAt) return false;
  if (batch.expectedVersions.length !== 2) return false;
  const gE = batch.expectedVersions.find((v) => v.ref.aggregateType === "Goal");
  const pE = batch.expectedVersions.find((v) => v.ref.aggregateType === "PlanRevision");
  if (gE === undefined || gE.revision !== goalSnap.revision - 1) return false;
  if (pE === undefined || pE.revision !== 0) return false;
  return identityMatchesActor(planEvent.projectId, planEvent.idempotencyKey, planEvent.actor.kind, planEvent.actor.id, batch.identity);
}


// ------------------------------------------------------------------------ //
// P1-13 remediation commit validators (shared by BOTH adapters)             //
// ------------------------------------------------------------------------ //

export function validateRemediationPlanPatchRecordCommit(batch: import("../../contracts/ledger.js").RemediationPlanPatchRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "RemediationPlanPatchRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "RemediationPlanPatch" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0]!;
  if (snap.ref.aggregateType !== "RemediationPlanPatch" || snap.revision !== 1 || snap.schemaVersion !== 1) return false;
  if (snap.patch.patchId !== event.aggregateId) return false;
  if (canonicalJson(snap.patch) !== canonicalJson(event.payload.patch)) return false;
  if (snap.recordedAt !== event.payload.recordedAt) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0 || canonicalJson(expected.ref) !== canonicalJson(snap.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateRemediationTaskRecordCommit(batch: import("../../contracts/ledger.js").RemediationTaskRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "RemediationTaskCreated" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "RemediationTask" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0]!;
  if (snap.ref.aggregateType !== "RemediationTask" || snap.revision !== 1 || snap.schemaVersion !== 1) return false;
  if (snap.task.taskId !== event.aggregateId) return false;
  if (canonicalJson(snap.task) !== canonicalJson(event.payload.task)) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0 || canonicalJson(expected.ref) !== canonicalJson(snap.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateRemediationTaskAdvanceCommit(batch: import("../../contracts/ledger.js").RemediationTaskAdvanceLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "RemediationTaskAdvanced" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "RemediationTask") return false;
  const snap = batch.snapshots[0]!;
  if (snap.ref.aggregateType !== "RemediationTask" || snap.schemaVersion !== 1) return false;
  if (event.aggregateRevision !== snap.revision) return false;
  if (snap.task.taskId !== event.aggregateId) return false;
  if (canonicalJson(snap.task) !== canonicalJson(event.payload.task)) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== snap.revision - 1 || canonicalJson(expected.ref) !== canonicalJson(snap.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


// ------------------------------------------------------------------------ //
// P1-14 baseline-evolution commit validators (shared by BOTH adapters)       //
// ------------------------------------------------------------------------ //

export function validateCandidateBaselineMaterializeCommit(batch: import("../../contracts/ledger.js").CandidateBaselineMaterializeLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "CandidateBaselineMaterialized" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "CandidateArchitectureBaseline" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0]!;
  if (snap.candidate.candidateId !== event.aggregateId) return false;
  if (snap.schemaVersion !== 1 || snap.revision !== 1 || snap.ref.aggregateType !== "CandidateArchitectureBaseline" || snap.ref.candidateId !== event.aggregateId || snap.ref.projectId !== event.projectId || snap.ref.workspaceId !== event.workspaceId || snap.candidate.projectId !== event.projectId || snap.candidate.workspaceId !== event.workspaceId) return false;
  if (canonicalJson(snap.candidate) !== canonicalJson(event.payload.candidate)) return false;
  if (snap.materializedAt !== event.payload.materializedAt) return false;
  if ((batch.expectedVersions.length !== 1 && batch.expectedVersions.length !== 2) || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  if (batch.expectedVersions.length === 2) {
    const active = batch.expectedVersions[1]!;
    if (active.ref.aggregateType !== "ProjectArchitectureBaselineActive" || active.ref.projectId !== snap.candidate.projectId || !Number.isInteger(active.revision) || active.revision < 1) return false;
  }
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}
export function validateArchitectureChangeDecisionRecordCommit(batch: import("../../contracts/ledger.js").ArchitectureChangeDecisionRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "ArchitectureChangeDecisionRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ArchitectureChangeDecision" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0]!;
  if (snap.decision.decisionId !== event.aggregateId) return false;
  if (snap.schemaVersion !== 1 || snap.revision !== 1 || snap.ref.aggregateType !== "ArchitectureChangeDecision" || snap.ref.decisionId !== event.aggregateId || snap.ref.projectId !== event.projectId || snap.ref.workspaceId !== event.workspaceId || snap.decision.projectId !== event.projectId || snap.decision.workspaceId !== event.workspaceId) return false;
  if (canonicalJson(snap.decision) !== canonicalJson(event.payload.decision)) return false;
  if (snap.recordedAt !== event.payload.recordedAt) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}
export function validateMigrationGateRecordCommit(batch: import("../../contracts/ledger.js").MigrationGateRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "MigrationGateRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "MigrationGateTask" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0]!;
  if (snap.gate.gateId !== event.aggregateId) return false;
  if (snap.schemaVersion !== 1 || snap.revision !== 1 || snap.ref.aggregateType !== "MigrationGateTask" || snap.ref.gateId !== event.aggregateId || snap.ref.projectId !== event.projectId || snap.ref.workspaceId !== event.workspaceId || snap.gate.projectId !== event.projectId || snap.gate.workspaceId !== event.workspaceId) return false;
  if (canonicalJson(snap.gate) !== canonicalJson(event.payload.gate)) return false;
  if (snap.recordedAt !== event.payload.recordedAt) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}
export function validateBaselineActivationRecordCommit(batch: import("../../contracts/ledger.js").BaselineActivationRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "BaselineActivationRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "BaselineActivation" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0]!;
  if (snap.activation.activationId !== event.aggregateId) return false;
  if (snap.schemaVersion !== 1 || snap.revision !== 1 || snap.ref.aggregateType !== "BaselineActivation" || snap.ref.activationId !== event.aggregateId || snap.ref.projectId !== event.projectId || snap.ref.workspaceId !== event.workspaceId || snap.activation.projectId !== event.projectId || snap.activation.workspaceId !== event.workspaceId) return false;
  if (canonicalJson(snap.activation) !== canonicalJson(event.payload.activation)) return false;
  if (snap.recordedAt !== event.payload.recordedAt) return false;
  if ((batch.expectedVersions.length !== 1 && batch.expectedVersions.length !== 3) || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  if (batch.expectedVersions.length === 3) {
    const workspace = batch.expectedVersions[1]!;
    const active = batch.expectedVersions[2]!;
    if (workspace.ref.aggregateType !== "Workspace" || workspace.ref.projectId !== snap.activation.projectId || workspace.ref.workspaceId !== snap.activation.workspaceId || !Number.isInteger(workspace.revision) || workspace.revision < 1) return false;
    if (active.ref.aggregateType !== "ProjectArchitectureBaselineActive" || active.ref.projectId !== snap.activation.projectId || !Number.isInteger(active.revision) || active.revision < 1) return false;
  }
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


// ------------------------------------------------------------------------ //
// P1-15 initial-design + coordination-policy commit validators              //
// ------------------------------------------------------------------------ //

function validateInitialDesignCommon(event: { eventType: string; projectId: string; workspaceId: string; aggregateRevision: number; aggregateId: string; actor: import("../../contracts/command-event.js").ActorRef; idempotencyKey: string }, batch: { identity: import("../../contracts/command-event.js").CommandIdentity }): boolean {
  return event.aggregateRevision === 1 && identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateInitialDesignProposalRecordCommit(batch: import("../../contracts/ledger.js").InitialDesignProposalRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "InitialDesignProposalRecorded" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.proposal.designId !== event.aggregateId || canonicalJson(snap.proposal) !== canonicalJson(event.payload.proposal) || snap.recordedAt !== event.payload.recordedAt) return false;
  if (!validateInitialDesignCommon(event, batch)) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return true;
}
export function validateInitialDesignDecisionRecordCommit(batch: import("../../contracts/ledger.js").InitialDesignDecisionRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "InitialDesignDecisionRecorded" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.decision.decisionId !== event.aggregateId || canonicalJson(snap.decision) !== canonicalJson(event.payload.decision) || snap.recordedAt !== event.payload.recordedAt) return false;
  if (!validateInitialDesignCommon(event, batch)) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return true;
}
export function validateCoordinationPolicyInstallCommit(batch: import("../../contracts/ledger.js").CoordinationPolicyInstallRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "CoordinationPolicyInstalled" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.policyId !== event.aggregateId || canonicalJson(snap.content) !== canonicalJson(event.payload.revision.content) || snap.contentDigest !== event.payload.revision.contentDigest || snap.installedAt !== event.payload.revision.installedAt) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return validateInitialDesignCommon(event, batch);
}
export function validateCoordinationPolicyActivateCommit(batch: import("../../contracts/ledger.js").CoordinationPolicyActivateRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "CoordinationPolicyActivated" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.projectId !== event.projectId || canonicalJson(snap.activeRevision) !== canonicalJson(event.payload.activeRevision)) return false;
  // CAS: [Project@expected (shape-only; runtime CAS), ActiveAggregate@(snapshot.revision - 1)] — P1-02 semantics.
  if (batch.expectedVersions.length !== 2) return false;
  const pE = batch.expectedVersions[0]!; const aE = batch.expectedVersions[1]!;
  if (pE.ref.aggregateType !== "Project" || pE.ref.projectId !== event.projectId) return false;
  if (!Number.isSafeInteger(pE.revision) || pE.revision < 0) return false;
  if (canonicalJson(aE.ref) !== canonicalJson(snap.ref) || aE.revision !== snap.revision - 1) return false;
  return true;
}

// ------------------------------------------------------------------------ //
// RW-11 role-spec governance commit validators                              //
// ------------------------------------------------------------------------ //

/**
 * RoleSpecRevision 安装：一条事件 + 一个不可改写快照，CAS@0。
 * 校验的是「事件与快照逐字对齐」这一 StateLedger 级不变量——内容好坏、摘要口径与权限是否
 * 合理属于 Control 侧的安装守卫，不在这里重复判断（与 P1-15 同一分工）。
 */
export function validateRoleSpecInstallCommit(batch: import("../../contracts/ledger.js").RoleSpecInstallRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "RoleSpecInstalled" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.roleId !== event.aggregateId || snap.ref.roleId !== snap.roleId || snap.contentRevision !== snap.ref.revision) return false;
  if (canonicalJson(snap.content) !== canonicalJson(event.payload.revision.content) || snap.contentDigest !== event.payload.revision.contentDigest || snap.installedAt !== event.payload.revision.installedAt) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return event.aggregateRevision === 1 && identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

/**
 * RoleSpecRevision 激活：每个 (project, role) 一个生效引用，CAS 与 P1-02／P1-15 同口径——
 * Project@expectedRevision（形状校验，运行时 CAS 由账本判定）+ 该角色生效聚合 @(snapshot.revision - 1)。
 * 与 P1-15 的关键差别：这里把 activeRevision.roleId 与快照、事件三者绑成同一个角色，
 * 避免「A 角色的生效引用被写成 B 角色的规格」这种跨角色漂移。
 */
export function validateRoleSpecActivateCommit(batch: import("../../contracts/ledger.js").RoleSpecActivateRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "RoleSpecActivated" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.projectId !== event.projectId) return false;
  if (snap.roleId !== snap.ref.roleId || snap.roleId !== snap.activeRevision.roleId) return false;
  if (event.aggregateId !== snap.roleId || event.aggregateRevision !== snap.revision) return false;
  if (canonicalJson(snap.activeRevision) !== canonicalJson(event.payload.activeRevision)) return false;
  if (batch.expectedVersions.length !== 2) return false;
  const pE = batch.expectedVersions[0]!;
  const aE = batch.expectedVersions[1]!;
  if (pE.ref.aggregateType !== "Project" || pE.ref.projectId !== event.projectId) return false;
  if (!Number.isSafeInteger(pE.revision) || pE.revision < 0) return false;
  if (canonicalJson(aE.ref) !== canonicalJson(snap.ref) || aE.revision !== snap.revision - 1) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

// ------------------------------------------------------------------------ //
// material-access-grant (P1-18)                                             //
// ------------------------------------------------------------------------ //

/**
 * One immutable grant @0. The validator is pure: it checks the event/snapshot
 * alignment and the grant's internal consistency (scope match, bounded material
 * set, reader/issuer shape, basis shape). It does NOT check whether the
 * materials are actually stored — that is the ArtifactVault's read-time job —
 * and it never judges the grant's business value.
 */
export function validateMaterialAccessGrantCommit(batch: import("../../contracts/ledger.js").MaterialAccessGrantLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "MaterialAccessGranted") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "MaterialAccessGrant") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "MaterialAccessGrant") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  if (snapshot.revocation !== undefined) return false;
  const grant = snapshot.grant;
  if (grant.grantId !== event.aggregateId) return false;
  if (canonicalJson(grant) !== canonicalJson(event.payload.grant)) return false;
  if (grant.grantedAt !== event.payload.grantedAt) return false;
  if (grant.scope.projectId !== event.projectId) return false;
  if (grant.scope.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.goalId !== grant.scope.goalId) return false;
  if (snapshot.ref.grantId !== grant.grantId) return false;
  if (!Array.isArray(grant.materials) || grant.materials.length === 0) return false;
  if (grant.materials.length > MATERIAL_ACCESS_MAX_MATERIALS) return false;
  if (grant.purpose.length === 0) return false;
  if (grant.basis.planRef !== null && grant.basis.planRef.projectId !== event.projectId) return false;
  const sourcePin = grant.basis.sourcePin;
  if (sourcePin !== undefined && (!validMaterialSourcePin(sourcePin) || sourcePin.projectId !== grant.scope.projectId || sourcePin.workspaceId !== grant.scope.workspaceId)) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  const crossWorkspace = grant.history?.crossWorkspace;
  if (crossWorkspace && (grant.history?.usage !== 'historical_explanation' || grant.issuedBy.aggregateType !== 'Control' ||
      grant.history.owner.projectId !== grant.scope.projectId || typeof crossWorkspace.sourceWorkspaceId !== 'string' || !crossWorkspace.sourceWorkspaceId ||
      crossWorkspace.sourceWorkspaceId === grant.scope.workspaceId || crossWorkspace.authorizedBy?.kind !== 'human' || !crossWorkspace.authorizedBy.id ||
      event.actor.kind !== 'human' || event.actor.id !== crossWorkspace.authorizedBy.id)) return false;
  if (!identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity)) return false;
  return true;
}

export function validateMaterialAccessRevokeCommit(batch: import("../../contracts/ledger.js").MaterialAccessRevokeLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0 || batch.expectedVersions.length !== 1) return false;
  const event = batch.events[0], snapshot = batch.snapshots[0], expected = batch.expectedVersions[0]!;
  const ref = snapshot.ref, grant = snapshot.grant, revoked = snapshot.revocation;
  if (snapshot.schemaVersion !== 1 || snapshot.revision !== 2 || !revoked || !revoked.reason || Buffer.byteLength(revoked.reason, "utf8") > 1024) return false;
  if (event.eventType !== "MaterialAccessRevoked" || event.schemaVersion !== 1 || event.aggregateRevision !== 2 || event.aggregateType !== "MaterialAccessGrant" || ref.aggregateType !== "MaterialAccessGrant") return false;
  if (event.projectId !== ref.projectId || event.workspaceId !== ref.workspaceId || event.aggregateId !== ref.grantId || grant.grantId !== ref.grantId || grant.scope.goalId !== ref.goalId || grant.scope.projectId !== ref.projectId || grant.scope.workspaceId !== ref.workspaceId) return false;
  if (expected.revision !== 1 || canonicalJson(expected.ref) !== canonicalJson(ref)) return false;
  if (canonicalJson(event.payload) !== canonicalJson({ grant, revocation: revoked })) return false;
  if (revoked.commandId !== event.causationId || revoked.revokedAt !== event.occurredAt || canonicalJson(revoked.actor) !== canonicalJson(event.actor)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateWorkContextBindCommit(batch: import("../../contracts/ledger.js").WorkContextBindLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "WorkContextBound") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "WorkContextBinding") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "WorkContextBinding") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const binding = snapshot.binding;
  if (binding.workId !== event.aggregateId) return false;
  if (canonicalJson(binding as never) !== canonicalJson(event.payload.binding)) return false;
  if (binding.projectId !== event.projectId) return false;
  if (binding.workspaceId !== event.workspaceId) return false;
  if (binding.status !== "active") return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.workId !== binding.workId) return false;
  if (binding.linkedRunRefs.length !== 1) return false;
  const firstLink = binding.linkedRunRefs[0];
  if (firstLink === undefined) return false;
  if (canonicalJson(firstLink) !== canonicalJson(binding.initialRunRef)) return false;

  // Immutability CAS: exactly one expected version = the binding at 0.
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

// ------------------------------------------------------------------------ //
// P1-12 architecture-inspection commit validators (shared by BOTH adapters) //
// ------------------------------------------------------------------------ //

export function validateArchitectureInspectionRecordCommit(batch: import("../../contracts/ledger.js").ArchitectureInspectionRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ArchitectureInspectionRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ArchitectureInspection") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ArchitectureInspection") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  if (canonicalJson(snapshot) !== canonicalJson(event.payload.inspection)) return false;
  if (snapshot.intent.inspectionId !== event.aggregateId) return false;
  if (snapshot.intent.projectId !== event.projectId) return false;
  if (snapshot.intent.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.inspectionId !== snapshot.intent.inspectionId) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateArchitectureFindingRecordCommit(batch: import("../../contracts/ledger.js").ArchitectureFindingRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ArchitectureFindingRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ArchitectureFinding") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ArchitectureFinding") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const finding = snapshot.finding;
  if (finding.findingId !== event.aggregateId) return false;
  if (canonicalJson(finding) !== canonicalJson(event.payload.finding)) return false;
  if (finding.projectId !== event.projectId) return false;
  if (finding.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.findingId !== finding.findingId) return false;
  if (snapshot.recordedAt !== event.payload.recordedAt) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateArchitectureBriefRecordCommit(batch: import("../../contracts/ledger.js").ArchitectureBriefRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ArchitectureDecisionBriefRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ArchitectureDecisionBrief") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ArchitectureDecisionBrief") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const brief = snapshot.brief;
  if (brief.briefId !== event.aggregateId) return false;
  if (canonicalJson(brief) !== canonicalJson(event.payload.brief)) return false;
  if (brief.projectId !== event.projectId) return false;
  if (brief.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.briefId !== brief.briefId) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateArchitectureProposalRecordCommit(batch: import("../../contracts/ledger.js").ArchitectureProposalRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ArchitectureCandidateProposalRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ArchitectureCandidateProposal") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ArchitectureCandidateProposal") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const proposal = snapshot.proposal;
  if (proposal.proposalId !== event.aggregateId) return false;
  if (canonicalJson(proposal) !== canonicalJson(event.payload.proposal)) return false;
  if (proposal.projectId !== event.projectId) return false;
  if (proposal.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.proposalId !== proposal.proposalId) return false;
  if (proposal.proposalDigest !== candidateProposalDigest(proposal)) return false;
  if (validateArchitectureCandidateProposal(proposal).length) return false;
  const requiredVersions=[{ref:snapshot.ref,revision:0},...(proposal.selectedBriefRef?[{ref:proposal.selectedBriefRef,revision:1}]:[])];
  if(canonicalJson(batch.expectedVersions)!==canonicalJson(requiredVersions))return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateWorkContextLinkCommit(batch: import("../../contracts/ledger.js").WorkContextLinkLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "WorkRunLinked") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "WorkContextBinding") return false;
  if (event.aggregateRevision < 2) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "WorkContextBinding") return false;
  if (snapshot.revision !== event.aggregateRevision) return false;
  if (snapshot.schemaVersion !== 1) return false;
  const binding = snapshot.binding;
  if (binding.workId !== event.aggregateId) return false;
  if (binding.projectId !== event.projectId) return false;
  if (binding.workspaceId !== event.workspaceId) return false;
  const lastLink = binding.linkedRunRefs[binding.linkedRunRefs.length - 1];
  if (lastLink === undefined || event.payload.runRef.runId !== lastLink.runId) return false;
  if (canonicalJson(event.payload.linkedRunRefs) !== canonicalJson(binding.linkedRunRefs)) return false;
  if (binding.linkedRunRefs.length > WORK_CONTEXT_MAX_RUN_LINKS) return false;

  // CAS: the binding advanced by exactly 1.
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== snapshot.revision - 1) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateExecutionNoteRecordCommit(batch: import("../../contracts/ledger.js").ExecutionNoteRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ExecutionNoteRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ExecutionNote") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ExecutionNote") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const note = snapshot.note;
  if (note.noteId !== event.aggregateId) return false;
  if (canonicalJson(note) !== canonicalJson(event.payload.note)) return false;
  if (note.projectId !== event.projectId) return false;
  if (note.workspaceId !== event.workspaceId) return false;
  if (note.noFullTranscript !== true) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.workId !== note.workId) return false;
  if (snapshot.ref.noteId !== note.noteId) return false;
  if (snapshot.recordedAt !== event.payload.recordedAt) return false;

  if(note.memoryGovernance!==undefined&&(!validMemoryGovernanceWitness(note.memoryGovernance)||note.bodyRef.digest!==memoryNoteBodyDigest(note)))return false;
  const requiredVersions=[{ref:snapshot.ref,revision:0},...(note.memoryGovernance?.versions??[]).map(pin=>({ref:{aggregateType:pin.kind,projectId:note.projectId},revision:pin.revision}))];
  if(canonicalJson(batch.expectedVersions)!==canonicalJson(requiredVersions))return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateContinuationRecordCommit(batch: import("../../contracts/ledger.js").ContinuationRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ContinuationRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ContinuationRecord") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ContinuationRecord") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const result = snapshot.result;
  if (result.reportId !== event.aggregateId) return false;
  if (canonicalJson(result) !== canonicalJson(event.payload.result)) return false;
  if (result.projectId !== event.projectId) return false;
  if (result.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.workId !== result.workId) return false;
  if (snapshot.ref.reportId !== result.reportId) return false;
  if (result.status === "restored_original" && result.originalRunRef === null) return false;
  if (result.status === "took_over" && result.takeoverRunRef === null) return false;
  if (result.status === "unsupported" && result.unsupportedCapabilities.length === 0) return false;
  if (result.status === "rejected" && result.rejectionCode === null) return false;

  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}



export function validateQueryJobStartCommit(batch: import("../../contracts/ledger.js").QueryJobStartLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 2 || batch.expectedVersions.length !== 2 || batch.outboxIntents.length !== 0) return false;
  const [job, run] = batch.snapshots;
  const event = batch.events[0];
  if (job.ref.aggregateType !== "QueryJob" || run.ref.aggregateType !== "QueryRun" || event.eventType !== "QueryRunStarted") return false;
  if (job.job.status !== "running" || run.run.status !== "running" || job.revision !== run.revision || job.revision < 2) return false;
  if (canonicalJson(job.job.runRef) !== canonicalJson(run.ref) || canonicalJson(run.run.queryJobRef) !== canonicalJson(job.ref)) return false;
  if (event.payload.job === undefined || canonicalJson(event.payload.job) !== canonicalJson(job.job) || canonicalJson(event.payload.run) !== canonicalJson(run.run)) return false;
  if (event.aggregateRevision !== run.revision || event.aggregateId !== run.ref.runId || event.projectId !== job.ref.projectId || event.workspaceId !== job.ref.workspaceId) return false;
  if (!batch.snapshots.every((snap) => batch.expectedVersions.some((v) => canonicalJson(v.ref) === canonicalJson(snap.ref) && v.revision === snap.revision - 1))) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

// ------------------------------------------------------------------------- //
// StateLedger-level validators shared by BOTH adapters (ERR R-1)            //
// ------------------------------------------------------------------------- //
// `identityKeyFor`, `validateGoalCreate` and `validateBootstrap` previously
// existed as a private copy in each adapter (src/data/state-ledger/in-memory-ledger.ts and
// src/data/state-ledger/sqlite-ledger.ts). Both copies were logically identical but
// could drift silently, and dev_docs/modules/data/state-ledger.md already
// promises that event/snapshot/expected alignment rules live here and are
// shared. These are that single implementation.

/** Deterministic idempotency identity for a commit batch. The commit-kind
 * prefix keeps identity namespaces disjoint per command family. */
// ------------------------------------------------------------------------ //
// CM-1A-001 协作通信 commit 校验（两个适配器共用这一份规则）                    //
// ------------------------------------------------------------------------ //

const COMMUNICATION_EVENT_TYPES: readonly string[] = [
  "AgentInstanceRegistered",
  "WorkParticipationStarted",
  /**
   * CM-1A-001 owner 裁决（D06）：WorkRunLinked 只作为「允许出现在协作通信提交里」的登记。
   * 它**不是**靠这条白名单被放行的：`participation-start` 走下面的专用校验
   * （validateParticipationStartCommit），白名单在这里只声明该事件类型属于协作通信提交的
   * 合法组成，避免通用形状校验把合法的 participation-start 误判为非法事件。
   */
  "WorkRunLinked",
  "WorkParticipationEnded",
  "DirectedRequestSent",
  "DirectedRequestResponded",
  "DirectedRequestCancelled",
  "SubscriptionCreated",
  "SubscriptionCancelled",
  "SubscriptionCatchupPlanned",
  "SubscriptionCatchupAdvanced",
  "DeliveryRecorded",
  "WaitConditionRegistered",
  "WaitConditionObserved",
  "WaitConditionSatisfied",
  "WaitConditionTimedOut",
  "WaitConditionCancelled",
  "CommunicationIntentRecorded",
  "CommunicationIntentCancelRequested",
  "CommunicationIntentClaimed",
  "CommunicationIntentSettled",
  "CommunicationAdmissionRecorded",
  "CoordinationRegistryUpdated",
  "WorkMailboxUpdated",
];

function isCommunicationEvent(event: { eventType: string; schemaVersion: number; eventId: string }): boolean {
  return event.schemaVersion === 1 && event.eventId.length > 0 && COMMUNICATION_EVENT_TYPES.includes(event.eventType);
}

/**
 * 协作通信提交的**事务形状**规则（业务准入仍在 Control）：
 *   - 至少一个事件与一个快照；事件全部是已知的通信事件类型；
 *   - 每个事件的 projectId/idempotencyKey/actor 与提交身份一致；
 *   - 每个快照都能对上一条 expected version：`revision === expected + 1`（既有聚合推进）
 *     或 `revision === 1 且无 expected`（本次新建）。**expected 存在时不允许 revision 停在原值**
 *     （拒绝"写了快照但没推进版本"这种伪提交）。
 */
export function validateCommunicationCommit(batch: import("../../contracts/coordination.js").CommunicationLedgerCommit): boolean {
  try {
    if (batch.schemaVersion !== 1) return false;
    if (!batch.identity.projectId || !batch.identity.idempotencyKey || !batch.identity.actor.id) return false;
    if (batch.events.length === 0 || batch.snapshots.length === 0) return false;
    if (!batch.events.every(isCommunicationEvent)) return false;
    if (batch.commitKind === 'wait-register') {
      const wait = batch.snapshots.find(s => s.ref.aggregateType === 'WaitCondition') as import('../../contracts/coordination.js').WaitConditionSnapshot | undefined;
      if (!wait || (wait.wait.mode !== 'all' && wait.wait.mode !== 'any') || wait.wait.selectedReport ||
          !wait.wait.conditions.length || wait.wait.conditions.length > WAIT_MAX_CONDITIONS || wait.wait.satisfiedIndexes.length ||
          (wait.wait.mode === 'any' && wait.wait.conditions.some(t => t.kind === 'request_closed'))) return false;
    }
    if (!batch.events.every((event) =>
      identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity))) return false;
    const expectedKeys = new Set<string>();
    for (const expected of batch.expectedVersions) {
      const key = canonicalJson(expected.ref);
      if (expectedKeys.has(key)) return false;
      expectedKeys.add(key);
    }
    const snapshotKeys = new Set<string>();
    for (const snapshot of batch.snapshots) {
      const key = canonicalJson(snapshot.ref);
      if (snapshotKeys.has(key)) return false;
      snapshotKeys.add(key);
      if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) return false;
      const expected = batch.expectedVersions.find((v) => canonicalJson(v.ref) === key);
      if (expected === undefined) {
        // 新建聚合：必须是 @1（没有 expected，就没有"原地推进"这一说）。
        if (snapshot.revision !== 1) return false;
      } else if (snapshot.revision !== expected.revision + 1) {
        // 推进既有聚合：必须恰好 +1（拒绝"写了快照但没推进版本"的伪提交）。
        return false;
      }
      if (!("projectId" in snapshot.ref) || snapshot.ref.projectId !== batch.identity.projectId) return false;
    }
    return true;
  } catch {
    return false;
  }
}


/**
 * **源事件提交时同事务登记待路由 intent**（CM-1A-001 第 4 步，协议约束 1.4）。
 *
 * 规则（为什么必须在账本里做，而不是在 Control 里）：
 *   - `CommitCursor` 由账本在**追加事件的那一刻**赋予；Control 构造提交时拿不到它。若让 Control
 *     先读后写去猜位置，两条并发的同 topic 事件会争同一个确定性 intentId，把合法提交判成冲突。
 *     因此 Control 只声明 anchor（源事件在本批里的类型）与 scope，位置由**本函数所在的同一个事务**
 *     算出：`sourceCursor = makeCommitCursor(firstSeq + anchorIndex)`。
 *   - 追加的事件与快照因此与源事件**原子**：提交被拒时两者都不落账。
 *
 * 形状（与协议同一个算式，不另立一套）：
 *   - intentId = routePageIntentIdFor(projectId, workspaceId, topic, sourceCursor)（确定性）；
 *   - 事件 = CommunicationIntentRecorded（aggregateRevision 1，aggregateId = intentId，身份字段
 *     逐字节沿用 anchor 事件，因此 identityMatchesActor 与源事件同一份判定）；
 *   - 快照 = CommunicationIntentSnapshot@1，expectedVersions 追加该聚合 @0。
 *
 * 失败即 invalid（**不**静默丢弃计划）：anchor 不在本批事件里、scope 为空、作用域不一致、
 * cursor 序号非法、topic 与 anchor 事件类型不一致，任何一种都拒绝整个提交。
 */
export function materializeRouteIntentPlans(
  batch: RouteIntentPlannableCommit,
  /** 本次追加序列里**第一个**事件的 cursor 序号（两个适配器在各自的事务里给出）。 */
  firstSeq: number,
  subscriptions: () => import("../../contracts/coordination.js").SubscriptionSnapshot[] = () => [],
): { status: "ok"; batch: RouteIntentPlannableCommit } | { status: "invalid" } {
  if ((batch as { commitKind?: string }).commitKind === 'subscription-create') {
    const sub = (batch.snapshots as { ref: { aggregateType: string } }[]).find(s => s.ref.aggregateType === 'Subscription') as import('../../contracts/coordination.js').SubscriptionSnapshot | undefined;
    if (sub?.subscription.startCursor != null && seqOfCommitCursor(sub.subscription.startCursor) >= firstSeq) return { status: 'invalid' };
  }
  batch = materializeSubscriptionStart(batch, firstSeq);
  const plans = batch.routeIntentPlans;
  if (plans === undefined || plans.length === 0) return { status: "ok", batch };
  if (!Number.isSafeInteger(firstSeq) || firstSeq < 1) return { status: "invalid" };
  const events: unknown[] = [...batch.events];
  const snapshots: unknown[] = [...batch.snapshots];
  const expectedVersions = [...batch.expectedVersions];
  const seen = new Set<string>();
  const materializedPlans: import("../../contracts/coordination.js").RouteIntentPlanV1[] = [];
  for (let plan of plans) {
    if (plan === null || typeof plan !== "object") return { status: "invalid" };
    if (plan.schemaVersion !== 1) return { status: "invalid" };
    if (typeof plan.plannedAt !== "string" || plan.plannedAt.length === 0) return { status: "invalid" };
    if (plan.topic !== plan.anchorEventType) return { status: "invalid" };
    if (!Array.isArray(plan.subscriptionScope)) return { status: "invalid" };
    if (seen.has(plan.topic)) return { status: "invalid" };
    seen.add(plan.topic);
    const anchorIndex = events.findIndex((event) =>
      (event as { eventType?: unknown }).eventType === plan.anchorEventType);
    if (anchorIndex < 0) return { status: "invalid" };
    const anchor = events[anchorIndex] as import("../../contracts/coordination.js").CommunicationDomainEvent;
    const projectId = batch.identity.projectId;
    const workspaceId = anchor.workspaceId;
    if (typeof workspaceId !== "string" || workspaceId.length === 0) return { status: "invalid" };
    const sourceCursor = makeCommitCursor(firstSeq + anchorIndex);
    if (plan.scopeMode === 'canonical_active') {
      const scope = subscriptions().filter(s => s.ref.projectId === projectId && s.ref.workspaceId === workspaceId &&
        s.subscription.status === 'active' && s.subscription.topics.includes(plan.topic) &&
        (s.subscription.startCursor === null || String(s.subscription.startCursor) < String(sourceCursor)))
        .map(s => ({ subscriptionRef: s.ref, expectedRevision: s.revision }))
        .sort((a,b) => canonicalJson(a.subscriptionRef).localeCompare(canonicalJson(b.subscriptionRef)));
      if (!scope.length) continue;
      plan = { ...plan, subscriptionScope: scope };
    }
    if (!plan.subscriptionScope.length) return { status: 'invalid' };
    materializedPlans.push(plan);
    // scope 的作用域必须与源事件同一 (projectId, workspaceId)：范围里的订阅属于别的 workspace
    // 是伪提交，直接拒绝而不是「写进去等着被页拒绝」。
    for (const entry of plan.subscriptionScope) {
      const ref = entry.subscriptionRef;
      if (ref === null || typeof ref !== "object") return { status: "invalid" };
      if (ref.aggregateType !== "Subscription") return { status: "invalid" };
      if (ref.projectId !== projectId || ref.workspaceId !== workspaceId) return { status: "invalid" };
    }
    const cursor = makeCommitCursor(firstSeq + anchorIndex);
    const intentId = routePageIntentIdFor(projectId, workspaceId, plan.topic, cursor);
    const intent: import("../../contracts/coordination.js").CommunicationIntentV1 = {
      schemaVersion: 1,
      intentId,
      projectId,
      workspaceId,
      domain: {
        kind: "route_page",
        sourceTopic: plan.topic,
        sourceCursor: cursor,
        subscriptionPosition: null,
        subscriptionScope: plan.subscriptionScope.map((entry) => ({
          subscriptionRef: { ...entry.subscriptionRef },
          expectedRevision: entry.expectedRevision,
        })),
      },
      status: "pending",
      leaseGeneration: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      availableAt: null,
      lastFailureClass: null,
      sideEffectStarted: false,
      createdAt: plan.plannedAt,
      settledAt: null,
    };
    const event: import("../../contracts/coordination.js").CommunicationIntentRecordedEvent = {
      eventId: "route-plan-" + intentId,
      eventType: "CommunicationIntentRecorded",
      schemaVersion: 1,
      projectId: anchor.projectId,
      workspaceId: anchor.workspaceId,
      aggregateType: "CommunicationIntent",
      aggregateId: intentId,
      aggregateRevision: 1,
      causationId: anchor.causationId,
      correlationId: anchor.correlationId,
      idempotencyKey: anchor.idempotencyKey,
      actor: { ...anchor.actor },
      occurredAt: plan.plannedAt,
      payload: { intent },
    };
    const snapshot: import("../../contracts/coordination.js").CommunicationIntentSnapshot = {
      ref: communicationIntentRefFor(projectId, workspaceId, intentId),
      revision: 1,
      schemaVersion: 1,
      intent,
      recordedAt: plan.plannedAt,
    };
    events.push(event);
    snapshots.push(snapshot);
    expectedVersions.push({ ref: communicationIntentRefFor(projectId, workspaceId, intentId), revision: 0 });
  }
  return {
    status: "ok",
    batch: { ...batch, events, snapshots, expectedVersions, routeIntentPlans: materializedPlans },
  };
}

/**
 * materializeRouteIntentPlans 的结构约束（两个适配器的提交类型都满足）。
 * 刻意写成结构类型而不是 LedgerCommit 联合：bootstrap 的身份类型与 CommandIdentity 不同，
 * 而**只有**通信提交会带计划，适配器在调用前先判 routeIntentPlans 是否存在。
 */
export type RouteIntentPlannableCommit = {
  events: unknown[];
  snapshots: unknown[];
  expectedVersions: { ref: unknown; revision: number }[];
  identity: { projectId: string };
  routeIntentPlans?: import("../../contracts/coordination.js").RouteIntentPlanV1[];
};

/**
 * `participation-start` 的**专用**形状校验（CM-1A-001 owner 裁决 D06）。
 *
 * ── 为什么不能只靠通用形状校验 + 白名单 ────────────────────────────────────────
 * 通用规则只说「事件都在白名单里、快照 revision 与 expected 对齐」，于是
 * `[WorkParticipationStarted]`、`[WorkRunLinked]`、乃至两条顺序颠倒或快照与事件不
 * 对应的组合都会被放行——那等于把「参与关系与发起 Run 在同一事务里成立」这条语义
 * 交给调用方自觉。这里照 validateQueryJobStartCommit 的复合样板，把**同一个事务里必须
 * 同时成立的两件事**逐一钉住：
 *
 *   1. 恰好两条事件，且顺序为 `[WorkParticipationStarted, WorkRunLinked]`；
 *   2. 恰好两个快照，且顺序为 `[WorkParticipationSnapshot@1, WorkContextBindingSnapshot@(expected+1)]`；
 *   3. expectedVersions 恰好是这两个 ref（participation@0、binding@priorRevision）；
 *   4. 事件与快照逐字段一致：aggregateId/aggregateRevision、payload 与快照值逐字节相同；
 *   5. **link 的 Run 必须真的落在该 Work 上**：`WorkRunLinked.payload.runRef` 必须出现在
 *      binding 快照的 `linkedRunRefs` 里，且事件里的 `linkedRunRefs` 与快照逐字节一致；
 *   6. participation 的 `workContextRef` 与 binding 快照的 ref 逐字段一致（同一个 Work），
 *      且三条记录的 projectId/workspaceId 一致；
 *   7. 两条事件的 command 身份与提交身份一致（identityMatchesActor）。
 *
 * 边界（如实）：校验只看**这次提交**的内容，因此它能证明「这条 participation-start 把
 * 某个 Run link 到了它自己的 Work 上」，但**不能**证明「该 AgentInstance 在别处没有别的
 * active participation」——那需要持久身份槽，见 contracts/coordination.ts 的边界说明。
 */
export function validateParticipationStartCommit(
  batch: import("../../contracts/coordination.js").ParticipationStartCommitV1,
): boolean {
  try {
    // (0) **先执行通用事件校验，再执行专用校验**（CM-1A-001 owner 裁决）：
    // validateCommunicationCommit 是协作通信提交的通用形状规则，它覆盖了专用校验
    // 表达不了、也不该由每个 commit kind 各写一遍的部分：
    //   · 每条事件的 schemaVersion === 1 与**非空 eventId**；
    //   · 事件类型在协作通信白名单内（WorkRunLinked 已在白名单里登记）；
    //   · 每条事件的 (projectId, idempotencyKey, actor) 与提交身份一致；
    //   · 每个快照的 ref.projectId 与**提交身份**一致（作用域一致）；
    //   · expectedVersions / snapshots 的 ref 不重复，且 revision 与 expected 精确对齐。
    // 专用校验只补通用规则看不到的**事务内关联**（下面 (1)-(7)），两者都必须成立；
    // 这里**不重复实现**通用规则。历史缺陷：本函数曾是唯一入口且没有复用通用校验，
    // 于是 eventId 为空、事件 schemaVersion 不是 1 的提交都能写进账本。
    if (!validateCommunicationCommit(batch)) return false;
    if (batch.outboxIntents.length !== 0) return false;
    if (batch.events.length !== 2 || batch.snapshots.length !== 2 || batch.expectedVersions.length !== 2) return false;

    const startedEvent = batch.events[0]!;
    const linkedEvent = batch.events[1]!;
    if (startedEvent.eventType !== "WorkParticipationStarted" || linkedEvent.eventType !== "WorkRunLinked") return false;
    if (!isKnownEventType(startedEvent.eventType) || !isKnownEventType(linkedEvent.eventType)) return false;
    const participationSnapshotRaw = batch.snapshots[0]!;
    const bindingSnapshotRaw = batch.snapshots[1]!;
    if (participationSnapshotRaw.ref.aggregateType !== "WorkParticipation") return false;
    if (bindingSnapshotRaw.ref.aggregateType !== "WorkContextBinding") return false;

    // 顺序已在上面钉死，这里按已声明的联合类型收窄（类型系统看不到数组下标与事件类型的关联）。
    const started = startedEvent as import("../../contracts/coordination.js").WorkParticipationStartedEvent;
    const linked = linkedEvent as import("../../contracts/context-continuity.js").WorkRunLinkedEvent;
    const participationSnapshot = participationSnapshotRaw as import("../../contracts/coordination.js").WorkParticipationSnapshot;
    const bindingSnapshot = bindingSnapshotRaw as import("../../contracts/context-continuity.js").WorkContextBindingSnapshot;

    const participation = started.payload.participation;
    const binding = bindingSnapshot.binding;
    const linkPayload = linked.payload;

    // (1)(2) 版本与形状
    if (participationSnapshot.revision !== 1 || participationSnapshot.schemaVersion !== 1) return false;
    if (bindingSnapshot.revision < 2 || bindingSnapshot.schemaVersion !== 1) return false;
    if (participation.schemaVersion !== 1) return false;
    if (participation.status !== "active" || participation.endedAt !== null) return false;

    // (3) expectedVersions 恰好对应这两个 ref
    const expectedFor = (ref: unknown) =>
      batch.expectedVersions.filter((v) => canonicalJson(v.ref as never) === canonicalJson(ref as never));
    const participationExpected = expectedFor(participationSnapshot.ref);
    const bindingExpected = expectedFor(bindingSnapshot.ref);
    if (participationExpected.length !== 1 || participationExpected[0]!.revision !== 0) return false;
    if (bindingExpected.length !== 1 || bindingExpected[0]!.revision !== bindingSnapshot.revision - 1) return false;

    // (4) 事件/快照逐字段一致
    if (started.aggregateType !== "WorkParticipation") return false;
    if (started.aggregateId !== participation.participationId) return false;
    if (started.aggregateRevision !== 1) return false;
    if (participationSnapshot.ref.participationId !== participation.participationId) return false;
    if (participationSnapshot.ref.workId !== participation.workContextRef.workId) return false;
    if (canonicalJson(participationSnapshot.participation as never) !== canonicalJson(participation as never)) return false;
    if (linked.aggregateType !== "WorkContextBinding") return false;
    if (linked.aggregateId !== binding.workId) return false;
    if (linked.aggregateRevision !== bindingSnapshot.revision) return false;

    // (5) link 的 Run 必须真的落在该 Work 上
    if (binding.linkedRunRefs.length === 0) return false;
    if (binding.linkedRunRefs.length > WORK_CONTEXT_MAX_RUN_LINKS) return false;
    if (canonicalJson(linkPayload.linkedRunRefs as never) !== canonicalJson(binding.linkedRunRefs as never)) return false;
    const linkedRunKey = canonicalJson(linkPayload.runRef as never);
    if (!binding.linkedRunRefs.some((run) => canonicalJson(run as never) === linkedRunKey)) return false;

    // (6) 同一个 Work、同一个作用域
    if (canonicalJson(participation.workContextRef as never) !== canonicalJson(bindingSnapshot.ref as never)) return false;
    if (binding.workId !== bindingSnapshot.ref.workId) return false;
    if (binding.projectId !== started.projectId || binding.workspaceId !== started.workspaceId) return false;
    if (participationSnapshot.ref.projectId !== started.projectId || bindingSnapshot.ref.projectId !== started.projectId) return false;
    if (participationSnapshot.ref.workspaceId !== started.workspaceId || bindingSnapshot.ref.workspaceId !== started.workspaceId) return false;
    // 两条事件必须声明**同一个**作用域：projectId 由 identityMatchesActor 钉在提交身份上，
    // 而 CommandIdentity 里没有 workspaceId，因此 workspaceId 只能钉在"两条事件互相同一"上。
    // 历史缺陷：这里曾漏掉 WorkRunLinked 自身的 (projectId, workspaceId)，于是"参与关系记在一处、
    // 发起 Run 的 link 记在另一处"的提交会被放行。
    if (linked.projectId !== started.projectId || linked.workspaceId !== started.workspaceId) return false;

    // (7) 身份一致
    if (!identityMatchesActor(started.projectId, started.idempotencyKey, started.actor.kind, started.actor.id, batch.identity)) return false;
    if (!identityMatchesActor(linked.projectId, linked.idempotencyKey, linked.actor.kind, linked.actor.id, batch.identity)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * `communication-route-page` 的**专用**形状校验（CM-1A-001 第 3 工作段裁决的契约加法）。
 *
 * ── 为什么不能只靠通用形状校验 + 白名单 ────────────────────────────────────────
 * 通用规则只说"事件都在白名单里、快照 revision 与 expected 对齐"。于是：
 *   · 一条把正文投给**别的 Work**的 Delivery（越权投递）；
 *   · 同一页里对同一 (源事件, 订阅, 目标 Work) 重复登记两条 Delivery（重复投递）；
 *   · checkpoint **回退或原地**（同一 topic 的同一事件位置被再路由一次）；
 *   · 页里塞进"没有任何订阅快照支撑"的 Delivery
 * 都会被放行——那等于把 A03 的三条断言（目标 Work、去重、checkpoint 单事务推进）交给调用方自觉。
 * 这里按 validateCommunicationSuccessorClaimCommit 的手法把它们逐条钉在**已提交的结果**上，
 * 而不是钉在 Control 收到的那份 proposal 上。
 *
 * ── 两个 intent 角色必须**分别**核对（本工作段的修正）────────────────────────────
 * 一页提交里最多出现两个 CommunicationIntent，角色完全不同，不能混为一谈：
 *   ①「本页已完成（done）的 intent」：必填、恰好一个，是这一页正在收敛的那条；
 *   ②「可选的下一页 pending intent」：0 或 1 条，是本页没处理完时同事务登记的续页触发器。
 * 旧规则只认角色 ①——它按"恰好一个 CommunicationIntent 快照"计数，于是续页 intent 一出现
 * 就被判非法，任何需要翻页的提交都被整页拒绝（多页订阅无法连续完成）。
 *
 * ── 两个位置必须分开（CM-1A-001 协议约束 1.4）────────────────────────────────────
 *   · **源事件位置** = `sourceTopic` + `sourceCursor`：本 intent 负责的那一个账本事件位置。
 *     同一事件翻页时它**允许不变**，因此**不能**用"事件位置每页严格增加"去校验分页。
 *   · **订阅分页位置** = `subscriptionPosition`（canonical ref key，null = 该事件还没处理过订阅）：
 *     同一事件翻页时它**必须严格前进**，回退或原地不动一律拒绝。
 *   · **本轮订阅范围** = `subscriptionScope`：翻页期间**逐字节不变**。
 *
 * 检查项（事务边界，协议约束 2.1）：
 *   0. CAS 只允许落在**本次确实写入**的聚合上（expectedVersions 的每个 ref 都必须在本批快照里）；
 *      否则等于把页外的状态当成这一页的事务前置条件，"一起提交"就不成立了。
 *
 * 检查项（角色 ①，本页 done 的 intent）：
 *   1. 事件只允许 DeliveryRecorded / WaitConditionObserved / CommunicationIntentSettled /
 *      CommunicationIntentRecorded，且 settle 恰好一条、recorded 至多一条；
 *   2. 快照数量 = settle 事件数 + recorded 事件数，且事件与快照逐字节一致；
 *   3. 该 intent @(expected+1)，status=done，domain.kind=route_page；
 *   4. **确定性 id**：`subscriptionPosition === null`（该事件位置的第一页）时逐字节等于
 *      `routePageIntentIdFor(topic, sourceCursor)`；否则等于
 *      「首次页 id + "-p" + sha256(subscriptionPosition)[0..8]」（与 Control 的 nextRouteIntentFor 同一算式）；
 *   5. **来源位置**：domain.sourceCursor 必须是合法账本游标；
 *   6. **订阅分页边界**：本页处理的每个订阅都必须**严格排在** intent 自己的 subscriptionPosition
 *      之后（不得回退或原地重放已经处理过的订阅）；
 *   7. 每条 DeliveryRecorded 的 origin 必须是 subscription；
 *   8. 页内 Delivery 去重键唯一；
 *   9. 每条 Delivery 的 targetWorkContextRef 必须等于它所属订阅的 ownerWorkContextRef；
 *  10. 每条 Delivery 的订阅必须出现在**本页推进的订阅快照**里（不投给本页没处理的订阅）；
 *  11. 页事件位置唯一：本页所有 Delivery 的 sourceCursor 与所有被推进订阅的 routedThroughCursor
 *      必须等于同一个事件位置 P；若本页确实路由了 P，则 P 不得早于 intent 的 sourceCursor；
 *  12. 范围固定：如果 intent 已经固定了 subscriptionScope（非空），本页处理的订阅必须都在范围内，
 *      且每条推进后的快照必须正好是范围里登记的 expectedRevision + 1；
 *  12a. **自描述完整性（协议约束 2.4）**：intent 的 domain 必须**显式**带 subscriptionPosition 与
 *      subscriptionScope。旧形状（只有 afterSubscriptionRef / routedThroughCursor）的记录缺少必需
 *      字段时一律拒绝——不得当作"位置未知就是 null、范围未知就是空"补猜后继续；
 *  12c. **结算必须来自一次真实领取（协议约束 1.5）**：被结算的 intent 必须 generation >= 1 且有
 *      leaseOwner（正常路径上 settle 之前必定先 claim）。重放回执不授予再次执行副作用的权利。
 *
 * 检查项（两个角色共同的作用域约束）：
 *  12b. 整批事件与快照必须声明**同一个** (projectId, workspaceId)，且等于本页 intent 声明的作用域
 *       （projectId 由通用规则钉在提交身份上；CommandIdentity 没有 workspaceId 字段，因此
 *       workspaceId 钉在"整批互相同一"上）。
 *
 * 检查项（角色 ②，可选的下一页 pending intent）：
 *  13. **版本**：新建聚合——快照 @1 且 expected 恰好 @0；
 *  14. 形态为 pending 的 route_page，且未被任何人领取（generation=0、无 leaseOwner）；
 *  15. **来源位置**：与角色 ① 同 topic，且 sourceCursor 等于**本页实际路由的事件位置 P**
 *      （不能拿角色 ① 自己的 sourceCursor 来比：首页 intent 的 sourceCursor 可能是订阅声明的起点）；
 *  16. **确定性 id**：由 (topic, P, subscriptionPosition) 机械派生（同第 4 条算式）；
 *  17. **分页边界**：本页必须真的处理过订阅，续页的 subscriptionPosition 恰好等于本页处理过的
 *      订阅里 canonical 序**最大**的那一个，且**严格大于**角色 ① 自己的 subscriptionPosition；
 *  18. **范围固定**：续页的 subscriptionScope 与角色 ① 逐字节相同；
 *  19. **hasMore 与下一页 intent 必须一致**（本轮范围已固定时，它同时就是账本内的 hasMore 证）：
 *      范围里严格排在「本页处理到的位置」之后的订阅存在 ⇒ 本页**必须**登记下一页 intent；
 *      不存在 ⇒ 本页是末页，**不得**登记下一页 intent。
 *
 * 边界（如实）：当本轮订阅范围**还没有被固定**（subscriptionScope 为空，今天的生产路径就是如此，
 * 因为"固定本轮订阅范围"是 FOLLOWUP-PLAN 第 4 步「持续路由」的生产者工作）时，第 19 条没有
 * 可依据的事实，因此不会触发——账本里没有独立的 hasMore 字段。这一条在被填上范围之前是**已实现
 * 但未激活**的；本工作段用真实 InMemoryLedger 证明了它在范围存在时确实拒绝（见
 * evidence/collaboration-memory/CM-1A-001/implementation/step-1/ledger-validation-probes.mjs 的 B3/B4）。
 * 另外，**末页最终停在哪**同样读不到（末页不登记续页 intent），由多页用例断言。
 */
export function validateCommunicationRoutePageCommit(
  batch: import("../../contracts/coordination.js").CommunicationRoutePageCommitV1,
): boolean {
  try {
    if (!validateCommunicationCommit(batch)) return false;
    if (batch.outboxIntents.length !== 0) return false;
    /**
     * (0) 协议约束 2.1（路由页是一个事务）：CAS 只允许发生在**本次确实写入**的聚合上。
     * 对没有快照的聚合做期望版本检查，等于把页外的状态拉进这一页的原子边界——
     * 那不是"一起提交"，而是把别人的版本当成自己的前置条件。
     */
    const writtenRefKeys = new Set(batch.snapshots.map((s) => canonicalJson(s.ref as never)));
    if (!batch.expectedVersions.every((v) => writtenRefKeys.has(canonicalJson(v.ref as never)))) return false;
    /**
     * (1) 事件词表：本页投递 / 页内 wait 观察 / **本页 intent 的 settle** /
     *     **下一页 pending intent 的登记**。
     *
     * 为什么必须放行 CommunicationIntentRecorded（本工作段修掉的真实缺陷）：一页走完之后
     * 若还有没处理完的订阅，Control 会在**同一个 CAS** 里把下一页的 pending intent 与它的
     * CommunicationIntentRecorded 一起落账。旧规则只允许 settle，于是任何"需要翻页"的提交
     * 都被整页拒绝——多页订阅无法连续完成，重启后分页也永远停在该页。
     */
    for (const event of batch.events) {
      if (event.eventType !== "DeliveryRecorded" && event.eventType !== "WaitConditionObserved" &&
          event.eventType !== "CommunicationIntentSettled" &&
          event.eventType !== "CommunicationIntentRecorded") return false;
    }
    const settledEvents = batch.events
      .filter((e) => e.eventType === "CommunicationIntentSettled") as
      import("../../contracts/coordination.js").CommunicationIntentSettledEvent[];
    const recordedEvents = batch.events
      .filter((e) => e.eventType === "CommunicationIntentRecorded") as
      import("../../contracts/coordination.js").CommunicationIntentRecordedEvent[];
    // 本页恰好收敛**它自己**那一条 intent；下一页 intent 至多登记一条（0 条 = 末页）。
    if (settledEvents.length !== 1) return false;
    if (recordedEvents.length > 1) return false;

    const intents = batch.snapshots.filter((s) => s.ref.aggregateType === "CommunicationIntent") as
      import("../../contracts/coordination.js").CommunicationIntentSnapshot[];
    // 快照数量必须与两个角色的事件数量精确对应：多一个少一个都是伪提交。
    if (intents.length !== settledEvents.length + recordedEvents.length) return false;

    // ---- 角色 ①：本页已完成（done）的 intent（必填，恰好一个）----------------
    const settledEvent = settledEvents[0]!;
    const settled = intents.find((s) => s.ref.intentId === settledEvent.aggregateId &&
      canonicalJson(s.ref as never) === canonicalJson(
        communicationIntentRefFor(settledEvent.projectId, settledEvent.workspaceId, settledEvent.aggregateId) as never));
    if (settled === undefined) return false;
    // 事件与快照必须逐字节一致（防"事件写一条、快照写另一条"的伪提交）。
    if (canonicalJson(settled.intent as never) !== canonicalJson(settledEvent.payload.intent as never)) return false;
    if (settledEvent.aggregateRevision !== settled.revision) return false;
    if (settled.intent.status !== "done") return false;
    if (settled.intent.domain.kind !== "route_page") return false;
    // 协议约束 2.4：route_page 的**新字段必须显式存在**。旧形状（只有 afterSubscriptionRef /
    // routedThroughCursor）的记录不能被当成"订阅位置未知就当作 null、订阅范围未知就当作空"继续
    // 处理——那是补猜值后继续，而不是"不可恢复或进入对账"。
    if (!isRoutePageDomainWellFormed(settled.intent.domain)) return false;
    // 协议约束 1.5：结算必须来自一次**真实领取**。账本看不到命令里的 consumer/generation，
    // 但它看得到结果，因此钉住可核对的事实：这条 intent 至少被领取过一次（generation >= 1 且有
    // leaseOwner）。**重放回执不授予再次执行副作用的权利**——一条从未被领取的 intent 被直接结算
    // 一律拒绝（正常路径上 settle 之前必定先 claim，见 CoordinationDrive.routePages）。
    if (settled.intent.leaseGeneration < 1 || settled.intent.leaseOwner === null) return false;
    // 版本：本页 intent 由 expected@N 推进到 N+1。
    const expectedForSettled = batch.expectedVersions.filter((v) => canonicalJson(v.ref as never) === canonicalJson(settled.ref as never));
    if (expectedForSettled.length !== 1) return false;
    if (settled.revision !== expectedForSettled[0]!.revision + 1) return false;
    const domainFrontier = settled.intent.domain.sourceCursor;
    const priorPosition = settled.intent.domain.subscriptionPosition;
    if (!cursorSeq(domainFrontier).ok) return false;
    // 确定性 id + 来源位置：该事件位置的**第一页**必须逐字节使用协议的 routePageIntentIdFor；
    // **续页**必须是「首次页 id + 订阅分页位置的稳定摘要」派生 id（与 Control 的 nextRouteIntentFor
    // 同一算式），且必须真的带着一个非空的订阅分页位置——否则"从头重来"的页能冒充续页。
    const settledBaseId = routePageIntentIdFor(
      settled.ref.projectId, settled.ref.workspaceId, settled.intent.domain.sourceTopic, settled.intent.domain.sourceCursor);
    if (priorPosition === null) {
      if (settled.intent.intentId !== settledBaseId) return false;
    } else if (settled.intent.intentId !== continuationRoutePageIntentId(settledBaseId, priorPosition)) {
      return false;
    }

    // 作用域一致性：一页只能属于**同一个** (projectId, workspaceId)。projectId 已由通用规则钉在
    // 提交身份上；workspaceId 在 CommandIdentity 里没有对应字段，因此这里把它钉在"整批事件与快照
    // 互相同一、且等于本页 intent 声明的作用域"上——否则一条把投递/订阅/intent 记到别的
    // workspace 的提交都能通过。
    const scopeProjectId = settled.ref.projectId;
    const scopeWorkspaceId = settled.ref.workspaceId;
    for (const event of batch.events) {
      if (event.projectId !== scopeProjectId || event.workspaceId !== scopeWorkspaceId) return false;
    }
    for (const snapshot of batch.snapshots) {
      if (snapshot.ref.projectId !== scopeProjectId || snapshot.ref.workspaceId !== scopeWorkspaceId) return false;
    }

    const subscriptions = batch.snapshots.filter((s) => s.ref.aggregateType === "Subscription") as
      import("../../contracts/coordination.js").SubscriptionSnapshot[];
    // 本页推进过的订阅（canonical 序与 selectPageSubscriptions 同一口径：canonicalJson(ref) 的 localeCompare）。
    const advancedKeys = subscriptions.map((s) => canonicalJson(s.ref as never)).sort((a, b) => a.localeCompare(b));
    // 订阅分页边界（角色 ①侧，协议约束 1.4）：续页只能处理**严格排在自身订阅分页位置之后**的
    // 订阅——把本 intent 已经处理过的订阅再处理一次（回退或原地）一律整页拒绝。
    if (priorPosition !== null) {
      if (!advancedKeys.every((key) => key.localeCompare(priorPosition) > 0)) return false;
    }
    // 范围固定：intent 已经固定过订阅范围时，本页处理的订阅必须都在范围内
    // （每条的 expectedRevision 必须等于它在范围里登记的那一个）。
    const scopedByKey = new Map(settled.intent.domain.subscriptionScope.map((entry) =>
      [canonicalJson(entry.subscriptionRef as never), entry.expectedRevision] as const));
    if (settled.intent.domain.subscriptionScope.length > 0) {
      for (const subscription of subscriptions) {
        const expected = scopedByKey.get(canonicalJson(subscription.ref as never));
        // 范围外订阅：本页推进了本轮没有固定的订阅 → 整页拒绝。
        if (expected === undefined) return false;
        // 范围记的是**本轮开始时**那一版：本页推进后的快照必须正好是 expected + 1。
        if (subscription.revision - 1 < expected) return false;
      }
    }
    // 本轮订阅范围一旦固定，它同时就是**账本内的 hasMore 证**（协议约束 1.4 + 2.1）：
    //   范围里严格排在「本页处理到的位置」之后的订阅存在 ⟺ 本页**必须**登记下一页 intent；
    //   不存在 ⟺ 本页就是末页，**不得**登记下一页 intent。
    // 「本页处理到的位置」= 本页处理过的订阅里 canonical 序最大者；本页什么都没处理时位置不动
    // （空页既不推进分页位置，也不允许挂续页——见角色 ②）。
    const pageResultPosition = advancedKeys.length === 0 ? priorPosition : advancedKeys[advancedKeys.length - 1]!;
    if (scopedByKey.size > 0) {
      const scopeKeys = [...scopedByKey.keys()].sort((a, b) => a.localeCompare(b));
      const remaining = pageResultPosition === null
        ? scopeKeys
        : scopeKeys.filter((key) => key.localeCompare(pageResultPosition) > 0);
      if (recordedEvents.length === 1) {
        // hasMore 声称还有剩余，账本却在范围里看不到任何剩余 ⇒ 本页还挂了多余的续页 intent。
        if (remaining.length === 0) return false;
      } else if (remaining.length > 0) {
        // 范围里明明还有剩余订阅，本页却没登记下一页 intent ⇒ 分页会在这里永久停住。
        return false;
      }
    }
    const subscriptionByKey = new Map(subscriptions.map((s) => [canonicalJson(s.ref as never), s]));
    const deliveries = batch.events
      .filter((e) => e.eventType === "DeliveryRecorded")
      .map((e) => (e as import("../../contracts/coordination.js").DeliveryRecordedEvent).payload.delivery);

    // (3)(4)(5)(6)(7)
    const dedupe = new Set<string>();
    const pageCursors = new Set<string>();
    for (const delivery of deliveries) {
      if (delivery.origin.kind !== "subscription") return false;
      const key = deliveryDedupeKey(delivery);
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      const owner = subscriptionByKey.get(canonicalJson(delivery.origin.subscriptionRef as never));
      if (owner === undefined) return false;
      if (canonicalJson(delivery.targetWorkContextRef as never) !== canonicalJson(owner.subscription.ownerWorkContextRef as never)) return false;
      if (canonicalJson(owner.subscription.routedThroughCursor as never) !== canonicalJson(delivery.origin.sourceCursor as never)) return false;
      pageCursors.add(String(delivery.origin.sourceCursor));
      // 快照与事件必须逐字节一致（防止"事件一条、快照另一条"的伪提交）。
      const snapshot = batch.snapshots.find((s) => s.ref.aggregateType === "Delivery" && canonicalJson(s.ref as never) === canonicalJson(deliveryRefFor(delivery.projectId, delivery.workspaceId, delivery.deliveryId) as never));
      if (snapshot === undefined) return false;
      if (canonicalJson((snapshot as import("../../contracts/coordination.js").DeliverySnapshot).delivery as never) !== canonicalJson(delivery as never)) return false;
    }
    for (const subscription of subscriptions) {
      const advanced = subscription.subscription.routedThroughCursor;
      if (advanced === null) return false;
      pageCursors.add(String(advanced));
    }
    if (pageCursors.size > 1) return false;

    // 事件位置不得回退到本 intent 的源事件位置之前（同一事件翻页时 P 等于 sourceCursor 是合法的：
    // 严格前进的是订阅分页位置，不是事件位置——协议约束 1.4）。
    if (pageCursors.size === 1) {
      const page = cursorSeq([...pageCursors][0]!);
      if (!page.ok) return false;
      if (page.seq < cursorSeq(domainFrontier).seq) return false;
    }

    // ---- 角色 ②：可选的下一页 pending intent（0 条 = 本页是末页）--------------
    if (recordedEvents.length === 1) {
      const recordedEvent = recordedEvents[0]!;
      const recorded = intents.find((s) => s.ref.intentId === recordedEvent.aggregateId &&
        canonicalJson(s.ref as never) === canonicalJson(
          communicationIntentRefFor(recordedEvent.projectId, recordedEvent.workspaceId, recordedEvent.aggregateId) as never));
      if (recorded === undefined) return false;
      if (canonicalJson(recorded.intent as never) !== canonicalJson(recordedEvent.payload.intent as never)) return false;
      if (recordedEvent.aggregateRevision !== 1) return false;
      const next = recorded.intent;
      // 版本：下一页 intent 是**新建聚合**（快照 @1 + expected @0）。
      if (recorded.revision !== 1 || next.schemaVersion !== 1) return false;
      const expectedForNext = batch.expectedVersions.filter((v) => canonicalJson(v.ref as never) === canonicalJson(recorded.ref as never));
      if (expectedForNext.length !== 1 || expectedForNext[0]!.revision !== 0) return false;
      // 形态：pending 的 route_page，且不是终态/租约态（下一页还没被任何人领取）。
      if (next.status !== "pending") return false;
      if (next.leaseGeneration !== 0 || next.leaseOwner !== null) return false;
      if (next.domain.kind !== "route_page") return false;
      // 协议约束 2.4：下一页 intent 同样必须显式带新字段。
      if (!isRoutePageDomainWellFormed(next.domain)) return false;
      // 来源位置：续页停在**本页实际路由的那个事件位置 P** 上（同 topic、同 cursor）。
      // 注意不能拿"本页 intent 自己的 sourceCursor"来比：首页 intent 的 sourceCursor 可能是
      // 订阅声明的起点（早于 P），而页走完之后续页的起点就是 P。
      if (next.domain.sourceTopic !== settled.intent.domain.sourceTopic) return false;
      if (pageCursors.size !== 1) return false;
      const pageRoutedCursor = [...pageCursors][0]!;
      if (String(next.domain.sourceCursor) !== pageRoutedCursor) return false;
      // 订阅分页边界：续页必须带一个非空的订阅分页位置。
      const nextPosition = next.domain.subscriptionPosition;
      if (nextPosition === null) return false;
      // 确定性 id：必须由 (topic, P, 订阅分页位置) 机械派生（不是调用方随便给的 id）。
      const nextBaseId = routePageIntentIdFor(
        recorded.ref.projectId, recorded.ref.workspaceId, next.domain.sourceTopic, next.domain.sourceCursor);
      if (next.intentId !== continuationRoutePageIntentId(nextBaseId, nextPosition)) return false;
      // 分页边界：
      //   · 本页必须真的处理过订阅（空页不允许挂续页，否则会拿空页把分页无限延长）；
      //   · 续页的订阅位置必须恰好是本页处理过的订阅里 canonical 序**最大**的那一个——
      //     比它小会漏投剩余订阅，比它大（不在本页集合里）会跳投；
      //   · 并且必须**严格大于**本页 intent 自己的订阅位置（不得原地不动）。
      if (advancedKeys.length === 0) return false;
      if (nextPosition !== advancedKeys[advancedKeys.length - 1]) return false;
      if (priorPosition !== null && nextPosition.localeCompare(priorPosition) <= 0) return false;
      // 范围固定：续页的订阅范围必须与角色 ① 逐字节相同（翻页期间不得改变）。
      if (canonicalJson(next.domain.subscriptionScope as never) !== canonicalJson(settled.intent.domain.subscriptionScope as never)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 续页 route intent 的稳定 intentId（与 Control 的 nextRouteIntentFor 同一算式：
 * 首次页 id + "-p" + sha256(订阅分页位置 canonical ref key)[0..8]）。
 * 该事件位置的第一页仍逐字节使用协议的 routePageIntentIdFor；派生只发生在 hasMore 的下一页。
 */
function continuationRoutePageIntentId(baseId: string, subscriptionPositionKey: string): string {
  return baseId + "-p" + sha256Hex(subscriptionPositionKey).slice(0, 8);
}

/**
 * route_page domain 的**自描述完整性**（协议约束 2.4）。
 *
 * 新形状必须**显式**带 subscriptionPosition 与 subscriptionScope。旧形状的记录（只有
 * afterSubscriptionRef / routedThroughCursor）缺少必需字段时，绝不能被当作
 * 「订阅位置未知就当作 null、订阅范围未知就当作空」继续处理——那正是 2.4 禁止的补猜值后继续。
 * 缺字段一律当作不合法提交拒绝（调用方得到明确的拒绝，而不是一个猜出来的分页位置）。
 */
function isRoutePageDomainWellFormed(domain: unknown): boolean {
  if (domain === null || typeof domain !== "object") return false;
  const record = domain as Record<string, unknown>;
  if (record["kind"] !== "route_page") return false;
  const topic = record["sourceTopic"];
  if (typeof topic !== "string" || topic.length === 0) return false;
  const sourceCursor = record["sourceCursor"];
  if (typeof sourceCursor !== "string" || sourceCursor.length === 0) return false;
  const position = record["subscriptionPosition"];
  if (position !== null && (typeof position !== "string" || position.length === 0)) return false;
  const scope = record["subscriptionScope"];
  if (!Array.isArray(scope)) return false;
  for (const entry of scope) {
    if (entry === null || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    const ref = item["subscriptionRef"];
    if (ref === null || typeof ref !== "object") return false;
    const refRecord = ref as Record<string, unknown>;
    if (refRecord["aggregateType"] !== "Subscription") return false;
    if (typeof refRecord["projectId"] !== "string" || typeof refRecord["workspaceId"] !== "string") return false;
    const subscriptionId = refRecord["subscriptionId"];
    if (typeof subscriptionId !== "string" || subscriptionId.length === 0) return false;
    const expectedRevision = item["expectedRevision"];
    if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) return false;
  }
  return true;
}

function cursorSeq(cursor: string): { ok: true; seq: number } | { ok: false; seq: -1 } {
  const match = /^c(\d{10})$/.exec(String(cursor));
  if (!match?.[1]) return { ok: false, seq: -1 };
  const seq = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(seq) ? { ok: true, seq } : { ok: false, seq: -1 };
}

/**
 * communication-successor-claim 的形状规则：
 *   - 恰好 TaskClaimed / WaitConditionSatisfied / CommunicationAdmissionRecorded 三个事件
 *     （外加 0..N 个 CommunicationIntentSettled，用于同事务 settle 触发它的 intent）；
 *   - 快照含 TaskLease/TaskAttempt/Run/DispatchOutboxEntry 与 WaitCondition/CommunicationAdmission；
 *   - **outboxIntents 恰好一条**，且与 DispatchOutboxEntry 快照里的 intent 逐字节相同
 *     （后继 Run 的唯一调度记录就是它，没有第二份 pending）；
 *   - TaskLease 由 expected@N 推进到 N+1（承担者从被等待的 Work 转到后继 Run）。
 */
export function validateCommunicationSuccessorClaimCommit(
  batch: import("../../contracts/coordination.js").CommunicationSuccessorClaimCommitV1,
): boolean {
  try {
    if (batch.schemaVersion !== 1) return false;
    if (batch.outboxIntents.length !== 1) return false;
    const eventTypes = batch.events.map((e) => e.eventType);
    if (eventTypes[0] !== "TaskClaimed") return false;
    if (!eventTypes.includes("WaitConditionSatisfied")) return false;
    if (!eventTypes.includes("CommunicationAdmissionRecorded")) return false;
    if (eventTypes.some((t) => t !== "TaskClaimed" && t !== "WaitConditionSatisfied" &&
      t !== "CommunicationAdmissionRecorded" && t !== "CommunicationIntentSettled" &&
      t !== "CommunicationIntentRecorded")) return false;
    // CM-1A-001 第 4 步：WaitConditionSatisfied 是可路由源事件，这次提交可以同事务登记它触发的
    // 待路由 intent（账本 materializeRouteIntentPlans 补写）。允许的**只有**这一条来源：没有计划
    // 却出现 CommunicationIntentRecorded，或数量对不上，仍然是非法提交（不放宽既有形状）。
    const plannedRecorded = (batch.routeIntentPlans ?? []).length;
    const recordedCount = batch.events.filter((event) => event.eventType === "CommunicationIntentRecorded").length;
    if (recordedCount !== plannedRecorded) return false;
    if (!batch.events.every((event) =>
      identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity))) return false;
    const byType = (type: string) => batch.snapshots.filter((s) => s.ref.aggregateType === type);
    const outboxes = byType("DispatchOutboxEntry") as DispatchOutboxEntrySnapshot[];
    const waits = byType("WaitCondition") as import("../../contracts/coordination.js").WaitConditionSnapshot[];
    const admissions = byType("CommunicationAdmission") as import("../../contracts/coordination.js").CommunicationAdmissionSnapshot[];
    if (byType("TaskLease").length !== 1 || byType("TaskAttempt").length !== 1 || byType("Run").length !== 1) return false;
    if (outboxes.length !== 1 || waits.length !== 1 || admissions.length !== 1) return false;
    const outbox = outboxes[0]!;
    if (canonicalJson(outbox.intent as never) !== canonicalJson(batch.outboxIntents[0]! as never)) return false;
    if (outbox.status !== "pending" || outbox.revision !== 1) return false;
    const attempt = byType("TaskAttempt")[0]! as TaskAttemptSnapshot;
    const run = byType("Run")[0]! as RunSnapshot;
    const lease = byType("TaskLease")[0]! as TaskLeaseSnapshot;
    if (attempt.status !== "claimed" || attempt.revision !== 1) return false;
    if (run.status !== "starting" || run.revision !== 1 || run.envelope !== null) return false;
    if (lease.holderRunId !== run.ref.runId || lease.attemptId !== attempt.ref.attemptId) return false;
    if (canonicalJson(attempt.ref) !== canonicalJson(outbox.intent.attemptRef)) return false;
    if (canonicalJson(run.ref) !== canonicalJson(outbox.intent.runRef)) return false;
    if (canonicalJson(run.roleBinding as never) !== canonicalJson(outbox.intent.roleBinding as never)) return false;
    const wait = waits[0]!;
    const admission = admissions[0]!;
    if (wait.wait.status !== "satisfied") return false;
    if (wait.wait.satisfiedRevision === null) return false;
    if (admission.revision !== 1) return false;
    if (canonicalJson(admission.ref) !== canonicalJson(communicationAdmissionRefFor(
      wait.ref.projectId, wait.ref.workspaceId, wait.ref.waitId))) return false;
    if (canonicalJson(admission.admission.waitRef as never) !== canonicalJson(wait.ref as never)) return false;
    if (canonicalJson(admission.admission.runRef as never) !== canonicalJson(run.ref as never)) return false;
    if (canonicalJson(admission.admission.attemptRef as never) !== canonicalJson(attempt.ref as never)) return false;
    if (admission.admission.satisfiedRevision !== wait.wait.satisfiedRevision) return false;
    // 上界：快照总数 = 6 个固定 + 0..N 个 intent
    const extras = batch.snapshots.length - 6;
    if (extras < 0 || byType("CommunicationIntent").length !== extras) return false;
    return true;
  } catch {
    return false;
  }
}

export function ledgerIdentityKeyFor(batch: import("../../contracts/ledger.js").LedgerCommit): string {
  if (batch.commitKind === "bootstrap") {
    return "bootstrap:" + bootstrapIdentityKey(batch.identity);
  }
  // goal-create / governance-install / governance-activate / plan-revision and
  // the remaining kinds all carry a project-scoped CommandIdentity.
  return batch.commitKind + ":" + commandIdentityKey(batch.identity);
}

/** goal-create: exactly one GoalCreated event and its revision-1 Goal snapshot,
 * aligned with the command identity. */
export function validateGoalCreateCommit(batch: import("../../contracts/ledger.js").GoalCreateLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1) return false;
  const ev = batch.events[0]!;
  const snap = batch.snapshots[0]!;
  if (ev.schemaVersion !== 1) return false;
  if (ev.eventType !== "GoalCreated") return false;
  if (!isKnownEventType(ev.eventType)) return false;
  if (ev.aggregateType !== "Goal") return false;
  if (ev.aggregateRevision !== 1) return false;
  if (snap.ref.aggregateType !== "Goal") return false;
  if (snap.revision !== 1) return false;
  // Event / snapshot alignment (StateLedger interface local invariants).
  if (snap.ref.projectId !== snap.workspaceRef.projectId) return false;
  if (snap.ref.projectId !== ev.projectId) return false;
  if (snap.ref.goalId !== ev.aggregateId) return false;
  if (snap.workspaceRef.workspaceId !== ev.workspaceId) return false;
  // Command/Event interface invariants: event must mirror the command identity.
  if (ev.projectId !== batch.identity.projectId) return false;
  if (ev.idempotencyKey !== batch.identity.idempotencyKey) return false;
  if (ev.actor.kind !== batch.identity.actor.kind || ev.actor.id !== batch.identity.actor.id) {
    return false;
  }
  return true;
}

/** bootstrap: only Project/WorkspaceBootstrapped events, all at revision 1. */
export function validateBootstrapCommit(batch: import("../../contracts/ledger.js").BootstrapLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length === 0) return false;
  for (const ev of batch.events) {
    if (ev.schemaVersion !== 1) return false;
    if (ev.eventType !== "ProjectBootstrapped" && ev.eventType !== "WorkspaceBootstrapped") {
      return false;
    }
    if (!isKnownEventType(ev.eventType)) return false;
    if (ev.aggregateRevision !== 1) return false;
  }
  for (const snapshot of batch.snapshots) {
    if (snapshot.revision !== 1) return false;
  }
  return true;
}

// ------------------------------------------------------------------------ //
// RC-03: 任务工作身份的唯一性槽（提交语义层；两个适配器共用这一份规则）        //
// ------------------------------------------------------------------------ //

/**
 * 一个身份槽的占用声明：key = 该槽的稳定标识，owner = 占用者（canonical 聚合 ref）。
 *
 * ── 为什么这条规则必须放在账本的提交语义里（而不是只放在 Control 守卫里）──────────
 * 「先查、后写」在跨进程时是不成立的：两个宿主进程各自的 ControlEngine 都会先扫到「这个任务
 * 还没有身份」，然后各自提交——两条绑定的聚合 ref 不同，CAS@0 各自成立，账本里就留下两条
 * WorkContextBound。进程内锁同样不成立（不跨进程），调用方约定更不成立（任何调用方都能绕）。
 * 因此唯一性必须由**唯一写入路径**（StateLedger.commit）在同一个事务里判定并占用。
 *
 * ── 为什么 key 由绑定内容机械派生，而不是由调用方传进来 ────────────────────────
 * key 完全由「这条绑定描述的是哪个 (项目, 工作区, 目标, 任务)」算出，没有调用方可控的自由度：
 * 任何一条 task 绑定都必然占用它自己那个槽，因此**没有**「忘了声明所以绕过」的路径。
 * 非 task 工作（coordination／query／review／integration）不占槽：唯一性要求只针对任务身份。
 *
 * ── 边界（明确写下来，不假装覆盖）─────────────────────────────────────────────
 *   1. 槽表是按需建立的**约束索引**，不是状态对象：没有事件、没有 revision、没有生命周期，
 *      只在它所守卫的那次原子提交里被写入（与既有的 idempotency 索引同一手法）。
 *   2. 它不改变任何既有事实：已经存在的绑定不改名、不删除、不合并。RC-03 之前形成的
 *      「同一任务两条身份」仍然是可读的不可变历史（解析面继续给唯一答案），只是不再新增第三条。
 *   3. 槽按 taskId 精确匹配；返工替换链上的不同承担者仍是不同任务，本规则不跨越它们合并
 *      （RW-13 已把链收敛到起源任务，那属于派发面的解析语义）。
 */
export type WorkIdentityClaim = {
  key: string;
  owner: string;
  /**
   * true 表示这次提交**释放**该槽（占用者本人释放才生效），而不是占用它。
   * 唯一的使用者是 participation-end：一段参与结束必须在**同一个事务**里让出
   * AgentInstance 的参与槽，否则换手（同一 Agent 在同一工作区建立下一段参与）永远被拒。
   * 缺省（undefined）= 占用，既有 work-context-bind 的语义逐字节不变。
   */
  release?: boolean;
};

/** 任务身份槽的稳定 key（纯函数；同一 (项目, 工作区, 目标, 任务) 永远同一 key）。 */
export function taskWorkIdentityClaimKey(
  projectId: string,
  workspaceId: string,
  goalId: string,
  taskId: string,
): string {
  return canonicalJson(["task-work-identity-claim-v1", projectId, workspaceId, goalId, taskId]);
}

/**
 * 这次 work-context-bind 要占用的身份槽（非 task 工作返回 null）。
 * 由**快照内容**派生：调用方无法省略、无法改写，也就无法绕过。
 */
export function workContextIdentityClaim(
  batch: import("../../contracts/ledger.js").WorkContextBindLedgerCommitV1,
): WorkIdentityClaim | null {
  const snapshot = batch.snapshots[0];
  if (snapshot === undefined || snapshot.ref.aggregateType !== "WorkContextBinding") return null;
  const binding = snapshot.binding;
  if (binding.workKind !== "task" || binding.goalId === null || binding.taskId === null) return null;
  return {
    key: taskWorkIdentityClaimKey(binding.projectId, binding.workspaceId, binding.goalId, binding.taskId),
    owner: canonicalJson(snapshot.ref as never),
  };
}

/**
 * AgentInstance 的 active participation 槽的稳定 key（纯函数）。
 * 作用域刻意是 (project, workspace, agentInstanceId)：不变式是「一个 AgentInstance 在同一
 * (project, workspace) 至多有一个 active participation」，因此跨 Work 也只有一个槽。
 */
export function participationIdentityClaimKey(
  projectId: string,
  workspaceId: string,
  agentInstanceId: string,
): string {
  return canonicalJson(["agent-participation-claim-v1", projectId, workspaceId, agentInstanceId]);
}

/**
 * 这次参与提交要占用／释放的槽（CM-1A-001 owner 裁决，第 2 步）。
 *
 * 与 workContextIdentityClaim 同一手法：key 与 owner 全部由**快照内容**派生，调用方无法省略、
 * 无法改写，因此没有「忘了声明所以绕过」的路径。两种提交各自的语言是：
 *   - participation-start → 占用（若该 AgentInstance 在本 (project, workspace) 已有另一段 active
 *     参与，占用失败 → 账本拒绝且零写入）；
 *   - participation-end  → 释放（只有当前占用者本人释放才生效；别人的槽不动）。
 *
 * ── 为什么必须在账本里（而不是只靠 Control 的守卫）─────────────────────────────
 * Control 的守卫是「先查后写」：两个宿主进程各自的引擎都会先看到「这个 Agent 还没有 active
 * 参与」，然后各自提交 —— 两条参与关系的聚合 ref 不同，CAS@0 各自成立，账本里于是留下两段
 * active 参与。唯一有效的判定点只能是与写入同一时刻的这一次提交。
 *
 * 边界（如实）：槽按快照内容派生，守卫的是「经正式提交写进来的参与关系」；本次裁决之前已经
 * 落账的历史重复保持可读、不改写、不合并。
 */
export function participationIdentityClaim(
  batch: import("../../contracts/coordination.js").ParticipationStartCommitV1 |
    import("../../contracts/coordination.js").ParticipationEndCommitV1,
): WorkIdentityClaim | null {
  const snapshot = batch.snapshots.find((s) => s.ref.aggregateType === "WorkParticipation");
  if (snapshot === undefined) return null;
  const participation = (snapshot as import("../../contracts/coordination.js").WorkParticipationSnapshot).participation;
  if (participation === undefined) return null;
  return {
    key: participationIdentityClaimKey(
      participation.workContextRef.projectId,
      participation.workContextRef.workspaceId,
      participation.agentInstanceId,
    ),
    owner: canonicalJson(snapshot.ref as never),
    ...(batch.commitKind === "participation-end" ? { release: true } : {}),
  };
}

/**
 * 槽已被**另一个**身份占用即为冲突（同一 owner 的重复提交不是冲突：那条路径由 CAS@0 与
 * 幂等记录决定，语义不变）。
 *
 * 释放型声明永远不是冲突：它由适配器按 owner 精确删除（自己占的才清），别人占的槽不受影响。
 */
export function identityClaimConflicts(
  claim: WorkIdentityClaim | null,
  existingOwner: string | undefined,
): boolean {
  if (claim === null || claim.release === true) return false;
  return existingOwner !== undefined && existingOwner !== claim.owner;
}

/** Cross-check persisted facts inside the transaction, in addition to batch
 * shape and CAS. A direct commit cannot change the pinned input or consume a
 * different permit body by merely keeping the same revision. */
export function validateRunFactState(batch: RunFactLedgerCommitV1,
  get: (ref: import('../../contracts/ledger.js').AggregateRef) => import('../../contracts/ledger.js').AggregateSnapshot | undefined): boolean {
  const event = batch.events[0];
  if (event?.eventType === 'RunReconciled') {
    const next = event.payload.run, prior = get(next.ref) as RunSnapshot | undefined;
    if (!prior || !next.reconciliation) return false;
    const expected = foldRunReconciliation(prior, next.reconciliation.observation, event.occurredAt);
    if (!expected || canonicalJson(expected) !== canonicalJson(next)) return false;
    if (batch.snapshots.length === 2) {
      const attempt = batch.snapshots[1] as TaskAttemptSnapshot, pa = get(attempt.ref) as TaskAttemptSnapshot | undefined;
      if (!pa || pa.runId !== prior.ref.runId || pa.endOutcome !== 'outcome_unknown' || pa.ref.attemptId !== prior.attemptId ||
          canonicalJson(attempt) !== canonicalJson({ ...pa, revision: pa.revision + 1, endOutcome: next.outcome, endedAt: next.endedAt })) return false;
    }
    return true;
  }
  if (event?.eventType === 'ExecutionEntered') {
    const next = batch.snapshots[0] as RunSnapshot, prior = get(next.ref) as RunSnapshot | undefined;
    if (!prior || prior.status !== 'running' || !prior.envelope || prior.executionAuthorization?.phase !== 'authorized' ||
        prior.controlState?.desiredState === 'cancelled' || prior.controlState?.desiredState === 'paused' ||
        prior.executionAuthorization.consumerId !== event.actor.id) return false;
    return canonicalJson(next) === canonicalJson({ ...prior, revision: prior.revision + 1,
      executionAuthorization: { ...prior.executionAuthorization, phase: 'entered' } }) && canonicalJson(event.payload.authorization) === canonicalJson(next.executionAuthorization!);
  }
  if (event?.eventType === 'ExecutionRetryScheduled') {
    const { run, attempt, outbox, reason } = event.payload;
    const previous = get(run.ref) as RunSnapshot | undefined, pa = get(attempt.ref) as TaskAttemptSnapshot | undefined, po = get(outbox.ref) as DispatchOutboxEntrySnapshot | undefined;
    if (!previous || !pa || !po) return false;
    const expected = executionRetryState(previous, pa, po, reason, event.occurredAt);
    return !!expected && canonicalJson(expected) === canonicalJson({ run, attempt, outbox }) && canonicalJson(batch.snapshots) === canonicalJson([run, attempt, outbox]);
  }
  if (event?.eventType === 'DispatchDeferred') {
    const next = event.payload.outbox;
    const previous = get(next.ref) as DispatchOutboxEntrySnapshot | undefined;
    const run = get(next.intent.runRef) as RunSnapshot | undefined;
    if (!previous || !run || run.envelope || run.status !== 'starting' || previous.status !== 'pending' || previous.schedule?.quarantined ||
        next.schedule?.attemptCount !== (previous.schedule?.attemptCount ?? 0) + 1) return false;
    return canonicalJson(next) === canonicalJson({ ...previous, revision: previous.revision + 1, schedule: next.schedule });
  }
  if (event?.eventType === 'RuntimeInputBound') {
    const next = batch.snapshots[0] as RunSnapshot;
    const previous = get(next.ref) as RunSnapshot | undefined;
    if (!previous || previous.status === 'ended' || previous.inputBinding || !previous.envelope || (previous.executionAuthorization && previous.executionAuthorization.phase !== 'entered')) return false;
    const guards = runtimeInputMaterialGuards(previous, event.payload.binding, get);
    if (!guards || !guards.every(guard => batch.expectedVersions.some(v => canonicalJson(v) === canonicalJson(guard)))) return false;
    return canonicalJson(next) === canonicalJson({ ...previous, revision: previous.revision + 1, inputBinding: event.payload.binding });
  }
  if (event?.eventType === 'RunEventRecorded' || event?.eventType === 'RunOutcomeUnknown') {
    const next = batch.snapshots[0] as RunSnapshot, prior = get(next.ref) as RunSnapshot | undefined;
    if (!prior || prior.status === 'ended') return false;
    let expected: RunSnapshot;
    if (event.eventType === 'RunEventRecorded') {
      const rt = event.payload.runtimeEvent;
      if (rt.sequence <= prior.lastEventSeq || (prior.executionAuthorization && prior.executionAuthorization.phase !== 'entered' &&
          !(rt.eventType === 'run_cancelled' && prior.controlState?.desiredState === 'cancelled'))) return false;
      expected = nextRunSnapshotForRuntimeEvent({ ...prior, revision: prior.revision + 1 }, rt);
      expected.lastFactEventId = event.eventId;
    } else expected = nextRunSnapshotForOutcomeUnknown({ ...prior, revision: prior.revision + 1 }, { observedAt: event.payload.observedAt });
    if (canonicalJson(next) !== canonicalJson(expected)) return false;
    if (next.status === 'ended') {
      const attempt = batch.snapshots[1] as TaskAttemptSnapshot, outbox = batch.snapshots[2] as DispatchOutboxEntrySnapshot;
      const pa = get(attempt.ref) as TaskAttemptSnapshot | undefined, po = get(outbox.ref) as DispatchOutboxEntrySnapshot | undefined;
      if (!pa || !po || pa.runId !== prior.ref.runId || canonicalJson(po.intent.runRef) !== canonicalJson(prior.ref)) return false;
      if (canonicalJson(attempt) !== canonicalJson(nextAttemptSnapshotForTerminal(pa, next.outcome!, next.endedAt!)) ||
          canonicalJson(outbox) !== canonicalJson(nextOutboxSnapshotForTerminal(po, next.endedAt!))) return false;
    }
    return true;
  }
  if (event?.eventType !== 'ModelRequestAuthorized' && event?.eventType !== 'ModelRequestEvidenceRecorded') return true;
  const permit = event.payload.permit;
  const run = get(permit.runRef) as RunSnapshot | undefined;
  if (!run?.inputBinding || !run.envelope || (run.executionAuthorization && run.executionAuthorization.phase !== 'entered') || run.status === 'ended' || run.controlState?.desiredState === 'cancelled' || run.controlState?.desiredState === 'paused') return false;
  const guards = runtimeInputMaterialGuards(run, run.inputBinding, get);
  if (!guards || !guards.every(guard => batch.expectedVersions.some(v => canonicalJson(v) === canonicalJson(guard)))) return false;
  if (permit.contextInputDigest !== run.inputBinding.inputDigest || permit.manifestDigest !== run.inputBinding.manifestDigest ||
      canonicalJson(permit.deliveryRefs) !== canonicalJson(run.inputBinding.deliveryRefs) ||
      canonicalJson(permit.permissions) !== canonicalJson({ tools: run.envelope.permissions.tools, writeScope: run.envelope.permissions.writeScope })) return false;
  if (event.eventType === 'ModelRequestEvidenceRecorded') {
    const previous = get(batch.snapshots[0]!.ref) as import('../../contracts/dispatch.js').ModelRequestPermitSnapshot | undefined;
    if (!previous || previous.revision !== 1 || previous.permit.consumedByAttemptId !== null) return false;
    if (canonicalJson(permit) !== canonicalJson({ ...previous.permit, consumedByAttemptId: event.payload.evidence.attemptId, consumedAt: event.payload.evidence.observedAt })) return false;
  }
  return true;
}

/** Fix subscription start and historical horizon at the actual append position. */
function materializeSubscriptionStart(batch: RouteIntentPlannableCommit, firstSeq: number): RouteIntentPlannableCommit {
  if ((batch as {commitKind?: string}).commitKind !== 'subscription-create') return batch;
  const events = structuredClone(batch.events) as import('../../contracts/coordination.js').CommunicationDomainEvent[];
  const snapshots = structuredClone(batch.snapshots) as import('../../contracts/coordination.js').SubscriptionCreateCommitV1['snapshots'];
  const index = events.findIndex(e => e.eventType === 'SubscriptionCreated');
  if (index < 0) return batch;
  const event = events[index]; if (event?.eventType !== 'SubscriptionCreated') return batch;
  const sub = snapshots.find((s): s is import('../../contracts/coordination.js').SubscriptionSnapshot => s.ref.aggregateType === 'Subscription');
  if (!sub || sub.revision !== 1) return batch;
  const horizonCursor = makeCommitCursor(firstSeq + index);
  const initial = sub.subscription.startCursor;
  const expectedVersions = [...batch.expectedVersions];
  if (initial === null) sub.subscription.startCursor = horizonCursor;
  else if (String(initial) < String(horizonCursor) && sub.subscription.topics.length) {
    const intentId = subscriptionCatchupIdFor(sub.ref);
    const ref = communicationIntentRefFor(sub.ref.projectId, sub.ref.workspaceId, intentId);
    sub.subscription.catchup = { intentRef: ref, horizonCursor };
    const intent: import('../../contracts/coordination.js').CommunicationIntentV1 = {
      schemaVersion: 1, intentId, projectId: sub.ref.projectId, workspaceId: sub.ref.workspaceId,
      domain: { kind: 'subscription_catchup', subscriptionRef: sub.ref, startCursor: initial, scanCursor: initial, horizonCursor },
      status: 'pending', leaseGeneration: 0, leaseOwner: null, leaseExpiresAt: null, attemptCount: 0,
      availableAt: null, lastFailureClass: null, sideEffectStarted: false, createdAt: sub.recordedAt, settledAt: null,
    };
    events.push({ ...event, eventId: 'subscription-' + intentId, eventType: 'CommunicationIntentRecorded',
      aggregateType: 'CommunicationIntent', aggregateId: intentId, aggregateRevision: 1, payload: { intent } });
    snapshots.push({ ref, revision: 1, schemaVersion: 1, intent, recordedAt: sub.recordedAt });
    expectedVersions.push({ ref, revision: 0 });
  }
  event.payload.subscription = structuredClone(sub.subscription);
  return { ...batch, events, snapshots, expectedVersions };
}

/** Canonical replay of a bounded catchup page inside the same ledger transaction. */
export function validateSubscriptionCatchupPage(batch: import('../../contracts/coordination.js').SubscriptionCatchupPageCommitV1,
  load: (ref: import('../../contracts/ledger.js').AggregateRef) => import('../../contracts/ledger.js').AggregateSnapshot | undefined,
  prefix: (cursor: import('../../contracts/command-event.js').CommitCursor) => import('../../contracts/ledger.js').PositionedEvent[]): boolean {
  try {
    if (!validateCommunicationCommit(batch) || batch.outboxIntents.length || batch.routeIntentPlans?.length) return false;
    const next = batch.snapshots.find((s): s is import('../../contracts/coordination.js').CommunicationIntentSnapshot => s.ref.aggregateType === 'CommunicationIntent');
    const sub = batch.snapshots.find((s): s is import('../../contracts/coordination.js').SubscriptionSnapshot => s.ref.aggregateType === 'Subscription');
    if (!next || !sub || next.intent.domain.kind !== 'subscription_catchup') return false;
    const prior = load(next.ref) as import('../../contracts/coordination.js').CommunicationIntentSnapshot | undefined;
    const oldSub = load(sub.ref) as import('../../contracts/coordination.js').SubscriptionSnapshot | undefined;
    if (!prior || !oldSub || prior.intent.domain.kind !== 'subscription_catchup' || prior.intent.status !== 'leased' || prior.intent.sideEffectStarted) return false;
    if (canonicalJson(prior.intent.domain.subscriptionRef) !== canonicalJson(sub.ref) ||
        canonicalJson(oldSub.subscription.catchup?.intentRef ?? null) !== canonicalJson(prior.ref)) return false;
    const selected = selectCatchupPrefix(prior.intent.domain, oldSub.subscription, prefix(prior.intent.domain.scanCursor));
    const now = next.recordedAt;
    const status = oldSub.subscription.status === 'cancelled' ? 'cancelled' : selected.cursor === prior.intent.domain.horizonCursor ? 'done' : 'pending';
    const expectedIntent = { ...prior, revision: prior.revision + 1, recordedAt: now, intent: { ...prior.intent,
      domain: { ...prior.intent.domain, scanCursor: selected.cursor }, status, leaseOwner: null, leaseExpiresAt: null, settledAt: status === 'pending' ? null : now } };
    if (canonicalJson(next) !== canonicalJson(expectedIntent)) return false;
    if (canonicalJson(sub) !== canonicalJson({ ...oldSub, revision: oldSub.revision + 1, recordedAt: now,
      subscription: { ...oldSub.subscription, routedThroughCursor: selected.cursor } })) return false;
    const deliveries = batch.snapshots.filter((s): s is import('../../contracts/coordination.js').DeliverySnapshot => s.ref.aggregateType === 'Delivery');
    let expectedDelivery: import('../../contracts/coordination.js').DeliveryV1 | null = null;
    if (selected.source) {
      const source = selected.source;
      const deliveryId = subscriptionDeliveryIdFor({ subscriptionRef: sub.ref, topic: source.topic, cursor: source.cursor, targetWorkContextRef: sub.subscription.ownerWorkContextRef });
      expectedDelivery = { schemaVersion: 1, deliveryId, projectId: sub.ref.projectId, workspaceId: sub.ref.workspaceId,
        origin: { kind: 'subscription', subscriptionRef: sub.ref, sourceTopic: source.topic, sourceCursor: source.cursor },
        targetWorkContextRef: sub.subscription.ownerWorkContextRef, bodyRef: source.bodyRef, sourceRefs: source.sourceRefs, createdAt: now };
      const existing = load({ aggregateType: 'Delivery', projectId: sub.ref.projectId, workspaceId: sub.ref.workspaceId, deliveryId }) as import('../../contracts/coordination.js').DeliverySnapshot | undefined;
      if (existing) { if (canonicalJson({ ...existing.delivery, createdAt: now }) !== canonicalJson(expectedDelivery) || deliveries.length) return false; }
      else if (deliveries.length !== 1 || canonicalJson(deliveries[0]!.delivery) !== canonicalJson(expectedDelivery) || deliveries[0]!.revision !== 1) return false;
    } else if (deliveries.length) return false;
    const waits = batch.snapshots.filter((s): s is import('../../contracts/coordination.js').WaitConditionSnapshot => s.ref.aggregateType === 'WaitCondition');
    for (const wait of waits) {
      const old = load(wait.ref) as import('../../contracts/coordination.js').WaitConditionSnapshot | undefined;
      if (!old || old.wait.status !== 'active' || !selected.source || canonicalJson(old.wait.ownerWorkContextRef) !== canonicalJson(sub.subscription.ownerWorkContextRef)) return false;
      const added = wait.wait.satisfiedIndexes.filter(i => !old.wait.satisfiedIndexes.includes(i));
      if (!added.length || new Set(wait.wait.satisfiedIndexes).size !== wait.wait.satisfiedIndexes.length || old.wait.satisfiedIndexes.some(i => !wait.wait.satisfiedIndexes.includes(i))) return false;
      for (const i of added) {
        const term = old.wait.conditions[i]; if (!term) return false;
        if (term.kind === 'delivery_present') {
          const inPage = expectedDelivery && term.deliveryRef.deliveryId === expectedDelivery.deliveryId && term.deliveryRef.projectId === expectedDelivery.projectId && term.deliveryRef.workspaceId === expectedDelivery.workspaceId;
          if (!inPage && !load(term.deliveryRef)) return false;
        } else {
          const request = load(term.requestRef) as import('../../contracts/coordination.js').DirectedRequestSnapshot | undefined;
          if (!request || (term.kind === 'request_responded' ? request.request.response === null : !['responded','cancelled','expired','closed'].includes(request.request.status))) return false;
        }
      }
      const expected = { ...old, revision: old.revision + 1, recordedAt: now, wait: { ...old.wait, satisfiedIndexes: wait.wait.satisfiedIndexes,
        observations: [...old.wait.observations, ...added.map(index => ({ index, observedAt: now, note: 'Historical delivery observed' }))] } };
      if (canonicalJson(wait) !== canonicalJson(expected)) return false;
    }
    if (batch.snapshots.length !== 2 + deliveries.length + waits.length || batch.events.length !== batch.snapshots.length || batch.expectedVersions.length !== batch.snapshots.length) return false;
    for (const snapshot of batch.snapshots) {
      const events = batch.events.filter(e => e.aggregateType === snapshot.ref.aggregateType && e.aggregateId ===
        (snapshot.ref.aggregateType === 'CommunicationIntent' ? snapshot.ref.intentId : snapshot.ref.aggregateType === 'Subscription' ? snapshot.ref.subscriptionId : snapshot.ref.aggregateType === 'Delivery' ? snapshot.ref.deliveryId : snapshot.ref.waitId));
      if (events.length !== 1 || events[0]!.aggregateRevision !== snapshot.revision || events[0]!.workspaceId !== sub.ref.workspaceId) return false;
      const event = events[0]!;
      if (snapshot.ref.aggregateType === 'CommunicationIntent') { if (event.eventType !== 'CommunicationIntentSettled' || canonicalJson(event.payload.intent) !== canonicalJson(next.intent)) return false; }
      else if (snapshot.ref.aggregateType === 'Subscription') { if (event.eventType !== 'SubscriptionCatchupAdvanced' || canonicalJson(event.payload) !== canonicalJson({ subscription: sub.subscription, intent: next.intent })) return false; }
      else if (snapshot.ref.aggregateType === 'Delivery') { if (event.eventType !== 'DeliveryRecorded' || canonicalJson(event.payload.delivery) !== canonicalJson((snapshot as import('../../contracts/coordination.js').DeliverySnapshot).delivery)) return false; }
      else if (event.eventType !== 'WaitConditionObserved' || canonicalJson(event.payload.wait) !== canonicalJson((snapshot as import('../../contracts/coordination.js').WaitConditionSnapshot).wait)) return false;
    }
    return true;
  } catch { return false; }
}

/** Ordinary route pages may only copy their exact committed source and prior subscription. */
export function validateRoutePageState(batch: import('../../contracts/coordination.js').CommunicationRoutePageCommitV1,
  load: (ref: import('../../contracts/ledger.js').AggregateRef) => import('../../contracts/ledger.js').AggregateSnapshot | undefined,
  sourceAt: (cursor: import('../../contracts/command-event.js').CommitCursor) => import('../../contracts/events.js').DomainEvent | undefined): boolean {
  try {
    const done = batch.snapshots.find((s): s is import('../../contracts/coordination.js').CommunicationIntentSnapshot => s.ref.aggregateType === 'CommunicationIntent' && (s as import('../../contracts/coordination.js').CommunicationIntentSnapshot).intent.status === 'done');
    if (!done || done.intent.domain.kind !== 'route_page') return false;
    const prior = load(done.ref) as import('../../contracts/coordination.js').CommunicationIntentSnapshot | undefined;
    if (!prior || prior.intent.domain.kind !== 'route_page' || prior.intent.status !== 'leased' || prior.intent.sideEffectStarted ||
        prior.intent.leaseGeneration !== done.intent.leaseGeneration || prior.intent.leaseOwner !== done.intent.leaseOwner) return false;
    const domain = done.intent.domain;
    const event = sourceAt(domain.sourceCursor);
    const source = event ? communicationSource(event, domain.sourceCursor) : null;
    const subs = batch.snapshots.filter((s): s is import('../../contracts/coordination.js').SubscriptionSnapshot => s.ref.aggregateType === 'Subscription');
    for (const sub of subs) {
      const old = load(sub.ref) as import('../../contracts/coordination.js').SubscriptionSnapshot | undefined;
      if (!old || !source || source.projectId !== sub.ref.projectId || source.workspaceId !== sub.ref.workspaceId || source.topic !== domain.sourceTopic) return false;
      if (canonicalJson(sub) !== canonicalJson({ ...old, revision: old.revision + 1, recordedAt: sub.recordedAt,
          subscription: { ...old.subscription, routedThroughCursor: source.cursor } })) return false;
      if (old.subscription.routedThroughCursor !== null && String(old.subscription.routedThroughCursor) > String(source.cursor)) return false;
      if (old.subscription.status !== 'active') continue;
      if (!old.subscription.topics.includes(source.topic) || (old.subscription.startCursor !== null && String(old.subscription.startCursor) >= String(source.cursor))) return false;
      if (old.subscription.catchup && (load(old.subscription.catchup.intentRef) as import('../../contracts/coordination.js').CommunicationIntentSnapshot | undefined)?.intent.status !== 'done') return false;
      const id = subscriptionDeliveryIdFor({ subscriptionRef: sub.ref, topic: source.topic, cursor: source.cursor, targetWorkContextRef: sub.subscription.ownerWorkContextRef });
      const ref = { aggregateType: 'Delivery' as const, projectId: sub.ref.projectId, workspaceId: sub.ref.workspaceId, deliveryId: id };
      const delivery = (batch.snapshots.find(s => canonicalJson(s.ref) === canonicalJson(ref)) ?? load(ref)) as import('../../contracts/coordination.js').DeliverySnapshot | undefined;
      if (!delivery || canonicalJson(delivery.delivery.bodyRef) !== canonicalJson(source.bodyRef) || canonicalJson(delivery.delivery.sourceRefs) !== canonicalJson(source.sourceRefs)) return false;
    }
    return true;
  } catch { return false; }
}

/** Current-state start admission; retry increments revisions and execution
 * generation without granting a second begin to an already-entered Run. */
export function validateDispatchStartState(batch: DispatchStartLedgerCommitV1,
  get: (ref: import('../../contracts/ledger.js').AggregateRef) => import('../../contracts/ledger.js').AggregateSnapshot | undefined): boolean {
  const event = batch.events[0];
  const run = batch.snapshots.find(s => s.ref.aggregateType === 'Run') as RunSnapshot;
  const attempt = batch.snapshots.find(s => s.ref.aggregateType === 'TaskAttempt') as TaskAttemptSnapshot;
  const outbox = batch.snapshots.find(s => s.ref.aggregateType === 'DispatchOutboxEntry') as DispatchOutboxEntrySnapshot;
  const prior = get(run.ref) as RunSnapshot | undefined;
  const pa = get(attempt.ref) as TaskAttemptSnapshot | undefined;
  const po = get(outbox.ref) as DispatchOutboxEntrySnapshot | undefined;
  if (!prior || !pa || !po || prior.status !== 'starting' || prior.envelope || prior.inputBinding || pa.status !== 'claimed' || po.status !== 'pending' ||
      po.schedule?.quarantined || (po.schedule && po.schedule.availableAt > event.occurredAt) ||
      prior.controlState?.desiredState === 'cancelled' || prior.controlState?.desiredState === 'paused') return false;
  const a = run.executionAuthorization;
  if (a) {
    if (!Number.isInteger(a.generation) || a.generation !== (prior.executionAuthorization?.generation ?? 0) + 1 || !a.consumerId || a.phase !== 'authorized' ||
        (prior.executionAuthorization && prior.executionAuthorization.phase !== 'revoked')) return false;
  } else if (prior.executionAuthorization) return false;
  return canonicalJson(run) === canonicalJson({ ...prior, revision: prior.revision + 1, status: 'running', envelope: event.payload.envelope,
    startedAt: event.occurredAt, ...(a ? { executionAuthorization: a } : {}) }) &&
    canonicalJson(attempt) === canonicalJson({ ...pa, revision: pa.revision + 1, status: 'started', startedAt: event.occurredAt }) &&
    canonicalJson(outbox) === canonicalJson({ ...po, revision: po.revision + 1, status: 'started', startedAt: event.occurredAt });
}

export function validateCommunicationReconcileState(batch: import('../../contracts/coordination.js').CommunicationIntentReconcileCommitV1,
  get: (ref: import('../../contracts/ledger.js').AggregateRef) => import('../../contracts/ledger.js').AggregateSnapshot | undefined): boolean {
  try {
    if (!validateCommunicationCommit(batch) || batch.identity.actor.kind !== 'system' || batch.events.length !== 1 || batch.snapshots.length !== 1 ||
        batch.expectedVersions.length !== 1 || batch.outboxIntents.length || batch.routeIntentPlans?.length) return false;
    const event = batch.events[0], next = batch.snapshots[0] as import('../../contracts/coordination.js').CommunicationIntentSnapshot;
    if (event?.eventType !== 'CommunicationIntentSettled' || next.ref.aggregateType !== 'CommunicationIntent' ||
        event.aggregateId !== next.ref.intentId || event.aggregateRevision !== next.revision || event.workspaceId !== next.ref.workspaceId ||
        canonicalJson(event.payload.intent) !== canonicalJson(next.intent)) return false;
    const prior = get(next.ref) as import('../../contracts/coordination.js').CommunicationIntentSnapshot | undefined;
    return !!prior && canonicalJson(quarantineCommunicationIntent(prior, event.occurredAt)) === canonicalJson(next);
  } catch { return false; }
}

export function validateSuccessorClaimState(batch: import('../../contracts/coordination.js').CommunicationSuccessorClaimCommitV1,
  get: (ref: import('../../contracts/ledger.js').AggregateRef) => import('../../contracts/ledger.js').AggregateSnapshot | undefined,
  selectReport?: (wait: import('../../contracts/coordination.js').WaitConditionSnapshot) => import('../../contracts/alternative-report.js').AlternativeReportResult): boolean {
  // Stale CAS and exact idempotency replays are decided by the generic transaction.
  if (!batch.expectedVersions.every(v => (get(v.ref)?.revision ?? 0) === v.revision)) return true;
  const admission = batch.snapshots[5].admission;
  const oldWait = get(admission.waitRef) as import('../../contracts/coordination.js').WaitConditionSnapshot | undefined;
  const newWait = batch.snapshots.find(s => s.ref.aggregateType === 'WaitCondition') as import('../../contracts/coordination.js').WaitConditionSnapshot;
  if (!oldWait || oldWait.wait.mode !== newWait.wait.mode || canonicalJson(oldWait.wait.conditions) !== canonicalJson(newWait.wait.conditions)) return false;
  if(canonicalJson(oldWait.wait.architectureReview??null)!==canonicalJson(newWait.wait.architectureReview??null))return false;
  if(!architectureDeliverySetMatches(oldWait,admission.deliveryRefs))return false;
  for(const ref of admission.deliveryRefs){
    const delivery=get(ref) as import('../../contracts/coordination.js').DeliverySnapshot|undefined;
    if(delivery?.delivery.origin.kind==='architecture_decision'){
      const review=get(delivery.delivery.origin.reviewRef) as import('../../contracts/architecture-review.js').ArchitectureReviewSnapshot|undefined;
      if(!architectureDeliveryApplies(review,delivery,oldWait)||!batch.expectedVersions.some(v=>canonicalJson(v.ref)===canonicalJson(review!.ref)&&v.revision===review!.revision))return false;
    }
  }
  if (newWait.wait.mode === 'all' && (newWait.wait.selectedReport || admission.reportQualification)) return false;
  if (oldWait?.wait.mode === 'any') {
    const chosen = selectReport?.(oldWait);
    const nextWait = batch.snapshots.find(s => s.ref.aggregateType === 'WaitCondition') as import('../../contracts/coordination.js').WaitConditionSnapshot;
    if (chosen?.status !== 'selected' || !admission.reportQualification) return false;
    const winner = qualifiedAlternativeReport(oldWait, chosen.candidates, admission.reportQualification, get);
    if (!winner || !nextWait.wait.selectedReport || canonicalJson(nextWait.wait.selectedReport) !== canonicalJson(winner) ||
        canonicalJson(nextWait.wait.satisfiedIndexes) !== canonicalJson([winner.conditionIndex]) ||
        canonicalJson(admission.deliveryRefs) !== canonicalJson([winner.deliveryRef])) return false;
    const guarded = (ref: import('../../contracts/ledger.js').AggregateRef, revision: number) => batch.expectedVersions.some(v => canonicalJson(v.ref) === canonicalJson(ref) && v.revision === revision);
    const policyRef = { aggregateType: 'ProjectCoordinationPolicyActive' as const, projectId: oldWait.ref.projectId };
    const policyActive = get(policyRef) as import('../../contracts/human-role-collaboration.js').ProjectCoordinationPolicyActiveSnapshot | undefined;
    if (!guarded(policyRef, policyActive?.revision ?? 0)) return false;
    if (policyActive) {
      const policy = get(policyActive.activeRevision) as import('../../contracts/human-role-collaboration.js').CoordinationPolicyRevisionSnapshot | undefined;
      if (!policy || !guarded(policy.ref, policy.revision)) return false;
      const pin = policy.content.roles?.catalog[admission.roleBinding.templateId];
      if (pin) {
        const activeRef = projectRoleSpecActiveRefFor(oldWait.ref.projectId, admission.roleBinding.templateId);
        if (!guarded(pin.ref, get(pin.ref)?.revision ?? 0) || !guarded(activeRef, get(activeRef)?.revision ?? 0)) return false;
      }
    }
    for (const ref of [oldWait.wait.predecessorRunRef,
      { aggregateType: 'Workspace' as const, projectId: oldWait.ref.projectId, workspaceId: oldWait.ref.workspaceId },
      { aggregateType: 'Goal' as const, projectId: oldWait.ref.projectId, goalId: oldWait.wait.predecessorRunRef.goalId }]) {
      const snapshot = get(ref);
      if (!snapshot || !guarded(ref, snapshot.revision)) return false;
    }
    for (const [index, observation] of admission.reportQualification.observations.entries()) {
      const candidate = chosen.candidates[index]!;
      if (!guarded(observation.grantRef, observation.grantRevision) || !guarded(candidate.delivery.ref, candidate.delivery.revision) || !guarded(candidate.request.ref, candidate.request.revision)) return false;
    }
  }
  const ref = communicationIntentRefFor(admission.waitRef.projectId, admission.waitRef.workspaceId,
    waitAdmissionIntentIdFor(admission.waitRef.waitId, admission.satisfiedRevision));
  const prior = get(ref) as import('../../contracts/coordination.js').CommunicationIntentSnapshot | undefined;
  const version = batch.expectedVersions.find(v => canonicalJson(v.ref) === canonicalJson(ref));
  if (!version || version.revision !== (prior?.revision ?? 0)) return false;
  if (!prior) return true;
  const next = batch.snapshots.find(s => canonicalJson(s.ref) === canonicalJson(ref));
  const at = batch.events[0].occurredAt;
  return prior.intent.status === 'leased' && !prior.intent.sideEffectStarted && prior.intent.leaseOwner === batch.identity.actor.id &&
    !!prior.intent.leaseExpiresAt && prior.intent.leaseExpiresAt > at &&
    !!next && canonicalJson(next) === canonicalJson({ ...prior, revision: prior.revision + 1, recordedAt: at, intent: { ...prior.intent, status: 'done', settledAt: at } });
}

export function validateInitialParticipationState(batch:import('../../contracts/coordination.js').InitialParticipationStartCommitV1,get:(ref:AggregateRef)=>AggregateSnapshot|undefined):boolean {
  if(!initialAssignmentEligible(batch.command,get))return false;
  const old=get(batch.command.payload.workContextRef) as import('../../contracts/context-continuity.js').WorkContextBindingSnapshot;
  const part=batch.snapshots[0] as import('../../contracts/coordination.js').WorkParticipationSnapshot;
  const agent=get({aggregateType:'AgentInstance',projectId:old.ref.projectId,workspaceId:old.ref.workspaceId,agentInstanceId:part.participation.agentInstanceId}) as import('../../contracts/coordination.js').AgentInstanceSnapshot|undefined;
  return agent?.agent.status==='active'&&agent.agent.templateId===batch.command.payload.roleBinding.templateId&&agent.agent.templateRevision===batch.command.payload.roleBinding.templateRevision
    &&canonicalJson(batch.snapshots[1]!)===canonicalJson({...old,revision:old.revision+1,binding:{...old.binding,currentParticipationRef:part.ref}});
}
export function validateInitialParticipationCommit(batch:import('../../contracts/coordination.js').InitialParticipationStartCommitV1):boolean {
  try {
    const c=batch.command;
    if(!c?.payload.initialDispatchRef||c.commandType!=='StartWorkParticipation'||c.expectedRevision!==0||c.schemaVersion!==1
      ||startWorkParticipationFingerprintForInitial(c)!==batch.fingerprint||canonicalJson(c.identity)!==canonicalJson(batch.identity)
      ||!validateParticipationStartCommit({...batch,commitKind:'participation-start'}))return false;
    const part=batch.snapshots[0] as import('../../contracts/coordination.js').WorkParticipationSnapshot;
    const link=batch.events[1] as import('../../contracts/context-continuity.js').WorkRunLinkedEvent;
    return part.recordedAt===part.participation.startedAt&&batch.events.every(e=>e.occurredAt===part.recordedAt)
      &&c.aggregateId===part.ref.participationId&&part.ref.workspaceId===c.payload.workspaceId
      &&canonicalJson(part.participation.workContextRef)===canonicalJson(c.payload.workContextRef)
      &&part.participation.agentInstanceId===c.payload.agentInstanceId
      &&canonicalJson(part.participation.roleBinding)===canonicalJson(c.payload.roleBinding)
      &&canonicalJson(link.payload.runRef)===canonicalJson(c.payload.runRef)
      &&batch.events.every(e=>e.causationId===c.commandId&&e.correlationId===c.correlationId);
  }catch{return false;}
}
