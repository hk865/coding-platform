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
} from "./ledger.js";
import type {
  ArchitectureBaselineRevisionSnapshot,
  CompletionPolicyRevisionSnapshot,
  ProjectArchitectureBaselineActiveSnapshot,
  ProjectCompletionPolicyActiveSnapshot,
} from "./governance.js";
// P1-13 LANE-A: third governance kind (ArchitectureEvolutionPolicy) snapshots.
import type {
  ArchitectureEvolutionPolicyRevisionSnapshot,
  ProjectArchitectureEvolutionPolicyActiveSnapshot,
} from "./architecture-evolution-policy.js";
import type {
  DispatchOutboxEntrySnapshot,
  RunSnapshot,
  TaskAttemptSnapshot,
  TaskLeaseSnapshot,
} from "./dispatch.js";
import type { ReplacementAttemptSnapshot } from "./handoff.js";
import {
  dispatchOutboxRefFor,
  isTerminalRuntimeEvent,
  runRefFor,
  taskAttemptRefFor,
  taskLeaseRefFor,
} from "./dispatch.js";
import { canonicalJson } from "./fingerprint.js";
import { isKnownEventType } from "./events.js";
import { commandIdentityKey } from "./command-event.js";
import { bootstrapIdentityKey } from "./bootstrap.js";
import type {
  IntegrationRecordLedgerCommitV1,
  PatchRecordLedgerCommitV1,
  WorkspaceReadLeaseAcquireLedgerCommitV1,
  WorkspaceReadLeaseReleaseLedgerCommitV1,
  WorkspaceWriteLeaseAcquireLedgerCommitV1,
  WorkspaceWriteLeaseReleaseLedgerCommitV1,
} from "./ledger.js";
import type { WorkspaceWriteLeaseIndexSnapshot, WorkspaceWriteLeaseSnapshot } from "./workspace-lease.js";
import { workspaceReadLeaseIndexRefFor, workspaceReadLeaseRefFor, workspaceWriteLeaseIndexRefFor, workspaceWriteLeaseRefFor } from "./workspace-lease.js";
import { integrationResultRefFor } from "./integration.js";
import { patchRecordRefFor } from "./patch.js";
import { WORK_CONTEXT_MAX_RUN_LINKS } from "./context-continuity.js";
import { candidateProposalDigest } from "./architecture-inspection.js";
import { CONTROL_INTENT_MAX_ACKS } from "./control-intent.js";
import { QUERY_JOB_MAX_ROUNDS, validQueryExecution } from "./query-job.js";
import { MATERIAL_ACCESS_MAX_MATERIALS, validMaterialSourcePin } from "./material-access.js";
import type { ReviewLedgerCommitV1 } from './ledger.js';
import type { ReviewWorkSnapshot, ReviewResultSnapshot, TaskReviewProtocolSnapshot } from './reviewer-work.js';

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
      const events = batch.events.filter(e => e.eventType === 'RunStarted') as [import('./dispatch.js').RunStartedEvent];
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
    const evidence = batch.snapshots.filter(s => s.ref.aggregateType === 'Evidence') as import('./evidence.js').EvidenceSnapshot[];
    const index = batch.snapshots.find(s => s.ref.aggregateType === 'TaskEvidenceIndex') as import('./evidence.js').TaskEvidenceIndexSnapshot | undefined;
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
  if (event.aggregateRevision !== 2) return false;
  if (event.payload.startedAt !== event.occurredAt) return false;

  const run = batch.snapshots.find((s): s is RunSnapshot => s.ref.aggregateType === "Run");
  const attempt = batch.snapshots.find(
    (s): s is TaskAttemptSnapshot => s.ref.aggregateType === "TaskAttempt",
  );
  const outbox = batch.snapshots.find(
    (s): s is DispatchOutboxEntrySnapshot => s.ref.aggregateType === "DispatchOutboxEntry",
  );
  if (run === undefined || attempt === undefined || outbox === undefined) return false;
  if (run.revision !== 2 || attempt.revision !== 2 || outbox.revision !== 2) return false;
  if (run.schemaVersion !== 1 || attempt.schemaVersion !== 1 || outbox.schemaVersion !== 1) {
    return false;
  }
  if (run.ref.runId !== event.aggregateId || event.aggregateId !== run.ref.runId) return false;
  if (event.payload.taskId !== run.task.taskId) return false;
  if (event.payload.attemptId !== run.attemptId) return false;
  if (canonicalJson(run.envelope) !== canonicalJson(event.payload.envelope)) return false;
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
    if (expected.revision !== 1) return false;
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
    if (batch.expectedVersions.length !== 1) return false;
    if (batch.expectedVersions[0]!.revision !== run.revision - 1) return false;
    if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(run.ref)) return false;
    if (event.eventType !== "RunEventRecorded") return false;
    if (run.outcome !== null || run.endedAt !== null) return false;
    if (run.exitCode !== null) return false;
  } else {
    if (batch.snapshots.length !== 3) return false;
    if (attempt === undefined || outbox === undefined) return false;
    if (batch.expectedVersions.length !== 3) return false;
    if (attempt.schemaVersion !== 1 || outbox.schemaVersion !== 1) return false;
    if (attempt.revision !== 2 && attempt.revision !== 3) return false;
    if (outbox.revision !== 2 && outbox.revision !== 3) return false;
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
  batch: import("./ledger.js").EvidenceIntakeLedgerCommitV1,
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
    (s): s is import("./evidence.js").EvidenceSnapshot => s.ref.aggregateType === "Evidence",
  );
  const indexSnapshot = batch.snapshots.find(
    (s): s is import("./evidence.js").TaskEvidenceIndexSnapshot =>
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
  batch: import("./ledger.js").TaskReductionLedgerCommitV1,
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
  batch: import("./ledger.js").GoalReductionLedgerCommitV1,
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

export function validateControlIntentRecordCommit(batch: import("./ledger.js").ControlIntentRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
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
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateControlAckRecordCommit(batch: import("./ledger.js").ControlAckRecordLedgerCommitV1): boolean {
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

export function validateQueryJobRecordCommit(batch: import("./ledger.js").QueryJobRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 2) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const [jobEvent, runEvent] = batch.events as [import("./query-job.js").QueryJobSubmittedEvent, import("./query-job.js").QueryRunStartedEvent];
  if (jobEvent.eventType !== "QueryJobSubmitted") return false;
  if (runEvent.eventType !== "QueryRunStarted") return false;
  if (!isKnownEventType(jobEvent.eventType) || !isKnownEventType(runEvent.eventType)) return false;
  const jobSnap = batch.snapshots[0] as import("./query-job.js").QueryJobSnapshot;
  const runSnap = batch.snapshots[1] as import("./query-job.js").QueryRunSnapshot;
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

export function validateQueryAnswerRecordCommit(batch: import("./ledger.js").QueryAnswerRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 3) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "QueryJobAnswerRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  const answerSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryJobAnswer") as import("./query-job.js").QueryJobAnswerSnapshot | undefined;
  const jobSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryJob") as import("./query-job.js").QueryJobSnapshot | undefined;
  const runSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryRun") as import("./query-job.js").QueryRunSnapshot | undefined;
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

export function validateQueryCloseRecordCommit(batch: import("./ledger.js").QueryCloseRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "QueryJobClosed") return false;
  if (!isKnownEventType(event.eventType)) return false;
  const jobSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryJob") as import("./query-job.js").QueryJobSnapshot | undefined;
  const runSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryRun") as import("./query-job.js").QueryRunSnapshot | undefined;
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

export function validatePlanChangeProposalRecordCommit(batch: import("./ledger.js").PlanChangeProposalRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "PlanProposalRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "PlanProposal" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0] as import("./goal-change.js").PlanProposalSnapshot;
  if (snap.ref.aggregateType !== "PlanProposal" || snap.revision !== 1) return false;
  if (canonicalJson(snap.proposal) !== canonicalJson(event.payload.proposal)) return false;
  if (snap.proposal.proposalId !== event.aggregateId) return false;
  if (snap.recordedAt !== event.payload.recordedAt) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateUserDecisionRecordCommit(batch: import("./ledger.js").UserDecisionRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "UserDecisionRecorded" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "UserDecision" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0] as import("./goal-change.js").UserDecisionSnapshot;
  if (snap.ref.aggregateType !== "UserDecision" || snap.revision !== 1) return false;
  if (canonicalJson(snap.decision) !== canonicalJson(event.payload.decision)) return false;
  if (snap.decision.decisionId !== event.aggregateId) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateGoalChangeApplyCommit(batch: import("./ledger.js").GoalChangeApplyLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 3) return false;
  if (batch.snapshots.length !== 3 || batch.outboxIntents.length !== 0) return false;
  const [planEvent, supersedeEvent, revisionEvent] = batch.events as [import("./plan.js").PlanRevisionAcceptedEvent, import("./goal-change.js").PlanRevisionSupersededEvent, import("./goal-change.js").GoalRevisionRecordedEvent];
  if (planEvent.eventType !== "PlanRevisionAccepted" || supersedeEvent.eventType !== "PlanRevisionSuperseded" || revisionEvent.eventType !== "GoalRevisionRecorded") return false;
  if (!isKnownEventType(planEvent.eventType) || !isKnownEventType(supersedeEvent.eventType) || !isKnownEventType(revisionEvent.eventType)) return false;
  const planSnap = batch.snapshots.find((s) => s.ref.aggregateType === "PlanRevision") as import("./plan.js").PlanRevisionSnapshot | undefined;
  const revSnap = batch.snapshots.find((s) => s.ref.aggregateType === "GoalRevision") as import("./goal-change.js").GoalRevisionSnapshot | undefined;
  const goalSnap = batch.snapshots.find((s) => s.ref.aggregateType === "Goal") as import("./ledger.js").GoalSnapshot | undefined;
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

export function validateRemediationPlanPatchRecordCommit(batch: import("./ledger.js").RemediationPlanPatchRecordLedgerCommitV1): boolean {
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

export function validateRemediationTaskRecordCommit(batch: import("./ledger.js").RemediationTaskRecordLedgerCommitV1): boolean {
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

export function validateRemediationTaskAdvanceCommit(batch: import("./ledger.js").RemediationTaskAdvanceLedgerCommitV1): boolean {
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

export function validateCandidateBaselineMaterializeCommit(batch: import("./ledger.js").CandidateBaselineMaterializeLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "CandidateBaselineMaterialized" || !isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "CandidateArchitectureBaseline" || event.aggregateRevision !== 1) return false;
  const snap = batch.snapshots[0]!;
  if (snap.candidate.candidateId !== event.aggregateId) return false;
  if (snap.schemaVersion !== 1 || snap.revision !== 1 || snap.ref.aggregateType !== "CandidateArchitectureBaseline" || snap.ref.candidateId !== event.aggregateId || snap.ref.projectId !== event.projectId || snap.ref.workspaceId !== event.workspaceId || snap.candidate.projectId !== event.projectId || snap.candidate.workspaceId !== event.workspaceId) return false;
  if (canonicalJson(snap.candidate) !== canonicalJson(event.payload.candidate)) return false;
  if (snap.materializedAt !== event.payload.materializedAt) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}
export function validateArchitectureChangeDecisionRecordCommit(batch: import("./ledger.js").ArchitectureChangeDecisionRecordLedgerCommitV1): boolean {
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
export function validateMigrationGateRecordCommit(batch: import("./ledger.js").MigrationGateRecordLedgerCommitV1): boolean {
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
export function validateBaselineActivationRecordCommit(batch: import("./ledger.js").BaselineActivationRecordLedgerCommitV1): boolean {
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

function validateInitialDesignCommon(event: { eventType: string; projectId: string; workspaceId: string; aggregateRevision: number; aggregateId: string; actor: import("./command-event.js").ActorRef; idempotencyKey: string }, batch: { identity: import("./command-event.js").CommandIdentity }): boolean {
  return event.aggregateRevision === 1 && identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateInitialDesignProposalRecordCommit(batch: import("./ledger.js").InitialDesignProposalRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "InitialDesignProposalRecorded" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.proposal.designId !== event.aggregateId || canonicalJson(snap.proposal) !== canonicalJson(event.payload.proposal) || snap.recordedAt !== event.payload.recordedAt) return false;
  if (!validateInitialDesignCommon(event, batch)) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return true;
}
export function validateInitialDesignDecisionRecordCommit(batch: import("./ledger.js").InitialDesignDecisionRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "InitialDesignDecisionRecorded" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.decision.decisionId !== event.aggregateId || canonicalJson(snap.decision) !== canonicalJson(event.payload.decision) || snap.recordedAt !== event.payload.recordedAt) return false;
  if (!validateInitialDesignCommon(event, batch)) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return true;
}
export function validateCoordinationPolicyInstallCommit(batch: import("./ledger.js").CoordinationPolicyInstallRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "CoordinationPolicyInstalled" || !isKnownEventType(event.eventType)) return false;
  const snap = batch.snapshots[0]!;
  if (snap.policyId !== event.aggregateId || canonicalJson(snap.content) !== canonicalJson(event.payload.revision.content) || snap.contentDigest !== event.payload.revision.contentDigest || snap.installedAt !== event.payload.revision.installedAt) return false;
  if (batch.expectedVersions.length !== 1 || batch.expectedVersions[0]!.revision !== 0 || canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(snap.ref)) return false;
  return validateInitialDesignCommon(event, batch);
}
export function validateCoordinationPolicyActivateCommit(batch: import("./ledger.js").CoordinationPolicyActivateRecordLedgerCommitV1): boolean {
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
// material-access-grant (P1-18)                                             //
// ------------------------------------------------------------------------ //

/**
 * One immutable grant @0. The validator is pure: it checks the event/snapshot
 * alignment and the grant's internal consistency (scope match, bounded material
 * set, reader/issuer shape, basis shape). It does NOT check whether the
 * materials are actually stored — that is the ArtifactVault's read-time job —
 * and it never judges the grant's business value.
 */
export function validateMaterialAccessGrantCommit(batch: import("./ledger.js").MaterialAccessGrantLedgerCommitV1): boolean {
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

export function validateMaterialAccessRevokeCommit(batch: import("./ledger.js").MaterialAccessRevokeLedgerCommitV1): boolean {
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

export function validateWorkContextBindCommit(batch: import("./ledger.js").WorkContextBindLedgerCommitV1): boolean {
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

export function validateArchitectureInspectionRecordCommit(batch: import("./ledger.js").ArchitectureInspectionRecordLedgerCommitV1): boolean {
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

export function validateArchitectureFindingRecordCommit(batch: import("./ledger.js").ArchitectureFindingRecordLedgerCommitV1): boolean {
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

export function validateArchitectureBriefRecordCommit(batch: import("./ledger.js").ArchitectureBriefRecordLedgerCommitV1): boolean {
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

export function validateArchitectureProposalRecordCommit(batch: import("./ledger.js").ArchitectureProposalRecordLedgerCommitV1): boolean {
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
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateWorkContextLinkCommit(batch: import("./ledger.js").WorkContextLinkLedgerCommitV1): boolean {
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

export function validateExecutionNoteRecordCommit(batch: import("./ledger.js").ExecutionNoteRecordLedgerCommitV1): boolean {
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

  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}

export function validateContinuationRecordCommit(batch: import("./ledger.js").ContinuationRecordLedgerCommitV1): boolean {
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



export function validateQueryJobStartCommit(batch: import("./ledger.js").QueryJobStartLedgerCommitV1): boolean {
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
// existed as a private copy in each adapter (src/ledger/in-memory-ledger.ts and
// src/sqlite-ledger/sqlite-ledger.ts). Both copies were logically identical but
// could drift silently, and dev_docs/modules/data/state-ledger.md already
// promises that event/snapshot/expected alignment rules live here and are
// shared. These are that single implementation.

/** Deterministic idempotency identity for a commit batch. The commit-kind
 * prefix keeps identity namespaces disjoint per command family. */
export function ledgerIdentityKeyFor(batch: import("./ledger.js").LedgerCommit): string {
  if (batch.commitKind === "bootstrap") {
    return "bootstrap:" + bootstrapIdentityKey(batch.identity);
  }
  // goal-create / governance-install / governance-activate / plan-revision and
  // the remaining kinds all carry a project-scoped CommandIdentity.
  return batch.commitKind + ":" + commandIdentityKey(batch.identity);
}

/** goal-create: exactly one GoalCreated event and its revision-1 Goal snapshot,
 * aligned with the command identity. */
export function validateGoalCreateCommit(batch: import("./ledger.js").GoalCreateLedgerCommitV1): boolean {
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
export function validateBootstrapCommit(batch: import("./ledger.js").BootstrapLedgerCommitV1): boolean {
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
