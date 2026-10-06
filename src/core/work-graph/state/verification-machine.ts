/**
 * VerificationRound, round-check and TaskEvidenceIndex machines
 * (docs/refactor/STATE-MACHINES-SPEC.md §9, rows VR-01..VR-15; forbidden
 * transitions §9.4; round chain helpers VD-5, VD-12..VD-15; D-2 fold).
 *
 * The owner is `evidence/evidence-service.ts` (and, for the check rows,
 * `agent-runtime/check-execution.ts` and the start-up check reconcile). It looks
 * up the receipt first, reads the round, does every IO step (Goal/Plan/Run
 * reads, workspace root, Host grant, source capture, compile, report storage),
 * hands the results in through the event payload and `RoundGuardContext`, and
 * writes `next` plus the translated `effects` in ONE RecordStore commit. The
 * machines never read storage, mint ids or read a clock: round ids, invocation
 * ids, Evidence ids and report refs come in the payload.
 *
 * Several of today's operations interleave guards and IO (for example
 * `beginCheck` rejects a finalized round before resolving the root, and the
 * root mismatch before capturing the source). The transitions re-run every
 * guard in today's order, and the pure guard steps are exported
 * (`roundReviewerEvidenceProblem`, `roundWriteAdmission`,
 * `roundOpenPointerProblem`, `roundOpenBasisProblem`, `roundOpenSubjectProblem`,
 * `roundOpenChecksProblem`, `checkEventAdmission`, `frozenBindingProblem`,
 * `foldVerdictChecks`, `finalizeRoundOutcome`) so the service stops at the
 * same point as before A.2 step 3 ahead of the next IO or id. Read failures,
 * the scope checks of a read record (configuration, Goal and Plan belong to
 * the call scope), and the VR-01 Host grant, workspace revision, capture and
 * compile results stay with the service (§1.1).
 *
 * A.2 step 5.3 (§15.2) scope:
 * - VR-01 writes the chain root (`rootRoundChain`) and claims the subject slot
 *   (work per subject Run, gate per gate, VD-1/VD-15); an existing chain is
 *   `busy` and an invalid one `incomplete`; VD-3 needs a `completed` subject
 *   Run whose reconciliation is absent or `done`. VR-02 prefixes the VD-8
 *   markers. VR-03 writes the INCONCLUSIVE `incompleteCause`; VR-05 (VD-6) and
 *   VR-13 are written. VR-07 is the D-2 fold (an applicable FAIL is FAIL, an
 *   `interrupted` check is the gap `interrupted_check`, PASS ⇒ no gaps) and
 *   guards the read set; VR-08 refuses a finalized round (VD-2) and guards the
 *   round as read; VR-11 guards a stored @0 index at 0 and VR-12 writes no
 *   index for zero appended ids.
 * - A.2 step 5.4 (D-3): VR-01 refuses a subject Run a TaskRequeue covers, and
 *   VR-09 answers a requeue of the chain head (the head guarded as read and the
 *   slot held with a same-owner claim).
 * - A.2 step 5.5 (VD-9): VR-01 and VR-02 refuse a Goal that is not active
 *   (`busy`) and a subject task that is not active in the Goal's current
 *   adopted Plan (`invalid`); VR-02 guards the Goal and that Plan as read.
 * - A.2 step 5.6 (D-12, D-18): VR-04, the start-up reconcile interrupts an
 *   executing check (`host_restart`) under the instance lease. VR-06 (booking
 *   a stored report) needs a body lookup by origin requestId that does not exist
 *   (§9 注 1, §16 GAP-24): it has no row, and reconcile always takes VR-04.
 * - A.2 step 5.9 (C5, VD-12, VD-13): VR-14/VR-15 (`round_reverified`): the
 *   successor of a finalized non-PASS chain head (`buildSuccessorRound`, the
 *   slot moved from the head to the successor), or one of the four committed
 *   policy refusals (`refuse_reverify`, written by the owner through
 *   `taskReworkRefusalEffects`, §4 TASK-28). The owner stops at the exported
 *   steps (`reverifyAdmissionProblem` before the capture,
 *   `reverifyCapRefusal` before the capture, then the full transition after
 *   it); steps 4–5 (Goal, fence, matrix, note) are `reworkPermission`'s
 *   answer, handed in as a fact (the one actor × class matrix lives in
 *   `task-failure.ts`).
 * - The successor helpers (`chainEvidenceIds`, `reverifyExemption`,
 *   `reverifyFailureClass`, `buildSuccessorRound`,
 *   `evidenceSupersededByRequeue`) are implemented in full for 5.4 and 5.9.
 *
 * `transitionCheck` takes the round, not the check, as its state: §9.4 rows
 * such as "checkId 不在轮次中" and "轮次 finalized" are round-level, and the
 * record written is the round (rev+1). The check's phase is read from it.
 * `CheckInterruptionCause`/`CheckAbandonCause` restate the codec unions of
 * `evidence/evidence-record-codecs.ts:57-59`, which this directory may not import.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../../contracts/dispatch.js';
import type {
  EvidenceApplicability, EvidenceCoverageV1, EvidenceOutcome, EvidenceRef, TaskEvidenceIndexRef,
  TaskEvidenceIndexSnapshot,
} from '../../../contracts/evidence.js';
import { requirementKeyOf } from '../../../contracts/evidence.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import type { NewBasisInputRefV1, SourceStampV1 } from '../../../contracts/no-progress.js';
import type { GoalDesiredState } from '../../../contracts/ledger.js';
import type { Disposition, PlanRevisionRef } from '../../../contracts/plan.js';
import type {
  ReworkActorClass, ReworkFailureClass, TaskRequeueSnapshotV1, TaskReworkRefusalCode,
} from '../../../contracts/task-requeue.js';
import type {
  CheckHostActor, CheckProcessObservation, ReverifyBasisV1, ReverifyExemption, RoundChainV1,
  RoundCheckIncompleteCause, RoundCheckSnapshot, RoundSnapshot, TrustedCheckConfiguration, VerificationCheckPlan,
  VerificationPlanV1, VerificationRoundRef,
} from '../../../contracts/verification.js';
import { INTERRUPTED_CHECK_GAP_CODE, ROUND_CHAIN_MAX } from '../../../contracts/verification.js';
import type {
  VerificationRoundMaterialIdentity, VerificationRoundSourceProof,
} from '../../../contracts/verification-context.js';
import { roundFailureFacts, type RoundFailureFactsV1 } from './no-progress.js';
import { runUnresolvedBlocker } from './run-machine.js';
import { accept, reject, unreachable, type Rejected, type Transition } from './transition.js';

// -------------------------------------------------------------------------- //
// Records and vocabulary (§9.1)                                               //
// -------------------------------------------------------------------------- //

export type RoundGapV1 = RoundSnapshot['gaps'][number];
export type CheckPhase = RoundCheckSnapshot['phase'];
export type CheckSourceStatus = RoundCheckSnapshot['sourceStatus'];
/** Same union as `evidence-record-codecs.ts:57`; also the written `incompleteCause`. */
export type CheckInterruptionCause = Extract<RoundCheckIncompleteCause, 'host_restart' | 'ticket_invalid'>;
/** Same union as `evidence-record-codecs.ts:59` (VD-6). */
export type CheckAbandonCause = 'caller_cancelled' | 'root_changed' | 'permission_changed' | 'read_failed';
/** The persisted domain events of the round (`evidence-record-codecs.ts:44-53`). */
export type VerificationRoundEventType =
  | 'VerificationRoundOpened'
  | 'VerificationCheckBegun'
  | 'VerificationCheckResultRecorded'
  | 'VerificationCheckInterrupted'
  | 'VerificationCheckAbandoned'
  | 'EvidenceAdmitted'
  | 'VerificationRoundFinalized'
  | 'VerificationRoundReverified';

/** A legacy round without `chain` is a slot-less chain root (§9.1). */
export function roundOrdinalOf(round: Pick<RoundSnapshot, 'chain'>): number {
  return round.chain?.ordinal ?? 1;
}

/** Finalized and not a clean PASS: FAIL, INCONCLUSIVE, or a legacy PASS with gaps (VD-4). */
export function isFinalizedNonPass(round: Pick<RoundSnapshot, 'status' | 'outcome' | 'gaps'>): boolean {
  return round.status === 'finalized' && (round.outcome !== 'PASS' || round.gaps.length > 0);
}

/** The ordinal-1 chain every round opened through VR-01 writes from step 5.3 on (C5). */
export function rootRoundChain(): RoundChainV1 {
  return { schemaVersion: 1, ordinal: 1, predecessorRoundRef: null, predecessorRevision: null,
    supersededEvidenceIds: [], basisDigests: [], autoCount: 0, reverify: null };
}

// -------------------------------------------------------------------------- //
// Slots (VD-1, VD-15)                                                         //
// -------------------------------------------------------------------------- //

export const ROUND_SUBJECT_SLOT_PREFIX = 'verification-round-subject:';
export const ROUND_GATE_SLOT_PREFIX = 'verification-round-gate:';

/** work: one chain per (subject task, subject Run); gate: one chain per gate, anchored on its first producer. */
export type RoundSlotSubjectV1 =
  | { kind: 'work'; projectId: string; workspaceId: string; goalId: string; taskId: string; runId: string }
  | { kind: 'gate'; projectId: string; workspaceId: string; goalId: string; taskId: string };

/** The unique claim key of a subject's chain; the owner is the head round's refKey (`roundSlotOwner`). */
export function roundSlotKey(subject: RoundSlotSubjectV1): string {
  switch (subject.kind) {
    case 'work':
      return ROUND_SUBJECT_SLOT_PREFIX + canonicalJson({ projectId: subject.projectId, workspaceId: subject.workspaceId,
        goalId: subject.goalId, taskId: subject.taskId, runId: subject.runId });
    case 'gate':
      return ROUND_GATE_SLOT_PREFIX + canonicalJson({ projectId: subject.projectId, workspaceId: subject.workspaceId,
        goalId: subject.goalId, taskId: subject.taskId });
    default: return unreachable(subject, 'round slot subject');
  }
}

/** A gate round carries its declared kind in the frozen identity scope (`evidence-service.ts:596-598`). */
export function roundSlotSubjectOf(round: Pick<RoundSnapshot, 'ref' | 'identity'>): RoundSlotSubjectV1 {
  const { projectId, workspaceId, goalId, taskId, runId } = round.ref;
  return round.identity.scope.gateSubject === undefined
    ? { kind: 'work', projectId, workspaceId, goalId, taskId, runId }
    : { kind: 'gate', projectId, workspaceId, goalId, taskId };
}

/** The slot owner: the round record's refKey (canonical JSON of the full ref). */
export function roundSlotOwner(ref: VerificationRoundRef): string {
  return canonicalJson({ aggregateType: ref.aggregateType, projectId: ref.projectId, workspaceId: ref.workspaceId,
    goalId: ref.goalId, taskId: ref.taskId, runId: ref.runId, roundId: ref.roundId });
}

export type RoundSlotClaimV1 = { claimKey: string; expectedOwner: string | null; nextOwner: string | null };

// -------------------------------------------------------------------------- //
// Guard context, events and effects (§9.2)                                    //
// -------------------------------------------------------------------------- //

/** Facts the owner reads in the same window as the round. */
export type RoundGuardContext = {
  /**
   * The caller is the round's frozen executor (`evidence-service.ts:755`, `:831`,
   * `:882`, `:937`); for `round_opened`, the trusted configuration's executor
   * (`:500`). Not read by the reconcile row VR-04 (`host_restart`).
   */
  callerIsExecutor: boolean;
  /** The caller's `meta.expected` round revision; null when the operation pins none (`submitEvidence` today). */
  expectedRevision: number | null;
  /** The reconciling Host holds the D-18 instance lease (VR-04); otherwise another live Host does. */
  instanceLeaseHeld: boolean;
};

/**
 * VD-9 facts of a write that starts a new check process (VR-01 `round_opened`,
 * VR-02 `check_begun`; VR-14 in 5.9): the Goal's desired state and the subject
 * task's disposition in the Goal's CURRENT adopted Plan (not the round's frozen
 * `adoptedPlanRef`; null when that Plan does not name the task). The owner
 * guards the Goal as read (PlanRevisions are immutable).
 */
export type RoundActivityFactsV1 = { goalDesiredState: GoalDesiredState; subjectDisposition: Disposition | null };

/** Everything `prepareRoundOpening` produced for one new round (VR-01; VR-14 reuses it without ref/subject). */
export type RoundOpeningV1 = {
  ref: VerificationRoundRef;
  subject: TaskTriple;
  subjectRunRef: RunRef;
  /** The requested (today) / the Goal's current (VD-7) adopted Plan. */
  adoptedPlanRef: PlanRevisionRef;
  taskBasisRef: PlanRevisionRef;
  executor: CheckHostActor;
  configuration: TrustedCheckConfiguration;
  configurationDigest: string;
  identity: VerificationRoundMaterialIdentity;
  sourceProof: VerificationRoundSourceProof;
  verificationPlan: VerificationPlanV1;
};

/** How the subject relates to the subject Run (`evidence-service.ts:537-547`). */
export type RoundSubjectRelationV1 =
  | { kind: 'work'; runTaskIsSubject: boolean }
  | {
    kind: 'gate';
    gateSubject: 'goal' | 'stage' | 'module';
    /** The subject is an adopted gate of the declared scope kind (`:544`). */
    gateAdopted: boolean;
    /** `:545-547`, in that order. */
    producer: 'ok' | 'not_goal_work_run' | 'not_adopted_work' | 'other_workspace';
  };

/**
 * VR-01 facts read by the owner, in order: each group is known after one read
 * (Goal, Plan, Run, then the subject's chain) and has its own guard step.
 * Step 5.4 adds the TaskRequeue cover and 5.5 the VD-9 facts, each with its
 * guard.
 */
export type RoundOpenFactsV1 = {
  /** VD-9 (5.5): the Goal desired state after the Goal read, the subject disposition after the Plan read. */
  activity: RoundActivityFactsV1;
  /** After the Goal read: `Goal.activePlanRevision` equals the requested planRef (`:513-515`). */
  planIsActive: boolean;
  /** After the Plan read: the subject task has a resolved, supported task-state basis (`:523-525`). */
  taskBasisResolved: boolean;
  /** After the Run read (`:537-548`). */
  relation: RoundSubjectRelationV1;
  /** The subject (gate: producer) Run as read (`:527-530`). */
  subjectRun: Pick<RunSnapshot, 'status' | 'outcome' | 'reconciliation'>;
  /** VR-01 (D-3, 5.4): a TaskRequeue covers the subject Run; its rework belongs to the new Run. */
  subjectRunRequeued: boolean;
  /**
   * After the chain lookup: `roundChainHead` of the subject's rounds (work:
   * `VerificationRoundBySubject` of the subject Run; gate:
   * `VerificationRoundByTask` of the gate, every producer). Legacy rounds
   * without a slot count, so an existing chain is found without reading the slot.
   */
  chain: RoundChainHeadV1;
};

/** `evidenceApplicabilityWithBasis` for one finished check's verdict (`evidence-service.ts:997-1001`). */
export type CheckVerdictDecisionV1 = { applicability: EvidenceApplicability; basis: string; reason: string };

/** The facts of the D-2 fold the owner reads (`evidence-service.ts:946-981`). */
export type RoundFoldFactsV1 = {
  /** checkId → decision for each finished check; null when the evidence or the adopted Plan is unreadable. */
  decisions: Readonly<Record<string, CheckVerdictDecisionV1>> | null;
  /** The current source still matches the frozen one under the frozen grant; false makes every verdict STALE. */
  sourceCurrent: boolean;
  /** `evidence_plan_unavailable`, `goal_unavailable`, `adopted_plan_unavailable`, `source_changed`, `source_unavailable`. */
  contextGaps: readonly RoundGapV1[];
};

/**
 * VR-14 facts the owner reads before the capture (§9.3 VR-14 steps 2–5,
 * §13.2 point 3); the state of `round_reverified` is the requested
 * predecessor round as read.
 */
export type RoundReverifyFactsV1 = {
  /** Step 2: `reworkActorClassOf(principal, actor)`; the request carries no trigger (VD-12). */
  actorClass: ReworkActorClass;
  /**
   * `roundChainHead` of the predecessor's subject chain (work: its subject
   * Run, `VerificationRoundBySubject`; gate: every producer,
   * `VerificationRoundByTask`), read before the capture; the commit's slot
   * claim settles a concurrent successor or requeue.
   */
  chain: RoundChainHeadV1;
  /** The subject Run (gate: the anchored producer Run) as read now. */
  subjectRun: RunSnapshot;
  /** VR-01's subject relation of the predecessor, judged against the Goal's current adopted Plan. */
  relation: RoundSubjectRelationV1;
  /** VD-9: the subject's disposition in the Goal's current adopted Plan (the Goal itself is step 4). */
  activity: RoundActivityFactsV1;
  /** work: a TaskRequeue covers the subject Run (the new Run opens its own chain); false for a gate. */
  subjectRunRequeued: boolean;
  /**
   * Steps 4–5 as `reworkPermission` (`task-failure.ts`, the one actor × class
   * matrix) answered them for this request: the Goal `active` (`busy`), the
   * human-stop fence (`forbidden`, hard limit 3; a gate has none), the
   * Goal fan-out actor (`forbidden`) and a non-human `note` (`invalid`).
   * Null when admitted.
   */
  permission: Rejected | null;
};

/** What the owner built after the capture for one successor (§9.3 VR-14 step 9, §13.7). */
export type RoundSuccessorV1 = {
  roundId: string;
  /** `prepareRoundOpening` under the current configuration, the Goal's current adopted Plan and a full capture (LA-5). */
  build: SuccessorRoundBuildV1;
  /** `reverifyBasis` over the predecessor, this capture and the configuration the successor freezes (§13.7 point 1). */
  basis: ReverifyBasisV1;
  requestedBy: ActorRef;
  requestedAt: string;
  /** Verified by `newBasisInputProblem` (ND-9); a stored human `note` is one of them. */
  newInputRefs: readonly NewBasisInputRefV1[];
  reason: string | null;
};

/** The policy refusal codes of a reverify (§13.7, §4 TASK-28). */
export type ReverifyRefusalCode = Extract<TaskReworkRefusalCode,
  'auto_rework_cap_reached' | 'verification_uncovered' | 'source_unchanged' | 'no_new_basis'>;

/**
 * One committed policy refusal (§9.3 VR-14 steps 7, 10, 11): the owner writes
 * `TaskReworkRefusal{operation:'reverify', subjectId: predecessor}@k+1`
 * through `taskReworkRefusalEffects` (`task-failure.ts`). The cap refuses
 * before the capture (no source, no key); `configurationRevision` only on
 * `verification_uncovered` and `no_new_basis` (LA-4).
 */
export type ReverifyRefusalV1 = {
  code: ReverifyRefusalCode;
  reason: string;
  /** The predecessor's class (`reverifyFailureClass`). */
  failureClass: ReverifyFailureClass;
  basisDigest: string | null;
  source: SourceStampV1 | null;
  configurationRevision: string | null;
};

export type RoundEvent =
  | { kind: 'round_opened'; opening: RoundOpeningV1; facts: RoundOpenFactsV1 }
  | { kind: 'evidence_submitted' }
  /** `evidenceRefs` are minted by the owner, one per admission of `finalizeRoundOutcome`, in that order. */
  | { kind: 'round_finalized'; reviewerEvidenceCount: number; fold: RoundFoldFactsV1; evidenceRefs: readonly EvidenceRef[] }
  /**
   * VR-14/15 (step 5.9): the state is the requested predecessor. `successor`
   * is null before the capture, where only the cap (step 7) can refuse.
   */
  | {
    kind: 'round_reverified'; facts: RoundReverifyFactsV1; onlyIfSourceChanged: boolean; autoReworkLimit: number;
    successor: RoundSuccessorV1 | null;
  }
  /** VR-09 (新增, step 5.4): the round side of a requeue of the chain head. */
  | { kind: 'task_requeued'; actorClass: ReworkActorClass };

/** The current Host values compared against the round's frozen binding (`evidence-service.ts:767-777`). */
export type FrozenBindingObservationV1 = { permissionRevision: string; workspaceRoot: string; sourceDigest: string };

export type CheckEvent =
  /** `activity`: the VD-9 facts the owner read after the pre-IO admission (5.5). */
  | { kind: 'check_begun'; checkId: string; invocationId: string; observed: FrozenBindingObservationV1; activity: RoundActivityFactsV1 }
  /** `sourceStatus` from the owner's `evaluateSource`; `reportRef` stored before the commit (`:835-842`). */
  | {
    kind: 'check_result_recorded'; checkId: string; invocationId: string;
    observation: CheckProcessObservation; sourceStatus: Exclude<CheckSourceStatus, null>; reportRef: ArtifactRef;
  }
  /** VR-04 (R): start-up reconcile under the instance lease. */
  | { kind: 'check_interrupted'; checkId: string; invocationId: string; cause: 'host_restart'; hostInstanceId: string }
  /** VR-13 (P): the runner's ticket is incomplete; `ticketProblem` is the proof (`check-execution.ts:108-109`). */
  | { kind: 'check_interrupted'; checkId: string; invocationId: string; cause: 'ticket_invalid'; ticketProblem: string | null }
  /** VR-05 (P): `provenNotStarted` is false once `execute` may have been called (VD-6). */
  | { kind: 'check_abandoned'; checkId: string; invocationId: string; cause: CheckAbandonCause; provenNotStarted: boolean };

/** The identity part of a check event that the pre-IO admission reads. */
export type CheckEventHead =
  | { kind: 'check_begun'; checkId: string }
  | { kind: 'check_result_recorded' | 'check_abandoned'; checkId: string; invocationId: string }
  | { kind: 'check_interrupted'; checkId: string; invocationId: string; cause: CheckInterruptionCause };

/** The part of a round event that the pre-IO admission reads. */
export type RoundEventHead =
  | { kind: 'round_opened' }
  | { kind: 'evidence_submitted' }
  | { kind: 'round_finalized'; reviewerEvidenceCount: number };

/** One verdict Evidence@1 of VR-07: the owner copies the check's candidate verdict with this ref and coverage. */
export type VerdictAdmissionV1 = { ref: EvidenceRef; checkId: string; coverage: EvidenceCoverageV1 };

/**
 * Same-commit intents the owner translates:
 * - `guard_round`: the round CAS (`null` = the key must not exist), writing `next`;
 * - `guard_round_unchanged`: the round as read, not written (VR-08);
 * - `guard_open_read_set`: Goal, adopted Plan, Workspace, subject Run, pinned
 *   policy and baseline as read (`evidence-service.ts:635-642`);
 * - `guard_finalize_read_set`: Goal, the Plans the fold judged against and the
 *   subject Run as read (VR-07);
 * - `guard_begin_read_set`: the Goal and its current adopted Plan as read (VR-02, VD-9);
 * - `guard_predecessor`: the predecessor as read, never written (VR-14, VR-15);
 * - `guard_reverify_read_set`: the Goal, its current adopted Plan, the subject
 *   Run, the refusal record @k (null when absent), work: the absent
 *   TaskRequeue of the subject Run, and after the capture the Workspace and
 *   the pinned policy and baseline (VR-14);
 * - `claim_round_slot`: the chain slot CAS (VR-01, VR-14; the same owner on a
 *   requeue VR-09 and a reverify refusal);
 * - `refuse_reverify`: the policy refusal record the owner writes through
 *   `taskReworkRefusalEffects` with its `TaskReworkRefused` event (VR-14);
 * - `admit_claim_evidence` / `admit_verdict_evidence`: Evidence@1 rows, each
 *   CAS null (VR-08, VR-07);
 * - `append_task_evidence_index`: the admitted ids through `nextTaskEvidenceIndex`;
 * - `emit_event`: the durable round event.
 */
export type VerificationEffect =
  | { kind: 'guard_round'; expectedRevision: number | null }
  | { kind: 'guard_round_unchanged'; revision: number }
  | { kind: 'guard_open_read_set' }
  | { kind: 'guard_finalize_read_set' }
  | { kind: 'guard_begin_read_set' }
  | { kind: 'guard_predecessor'; ref: VerificationRoundRef; revision: number }
  | { kind: 'guard_reverify_read_set' }
  | { kind: 'claim_round_slot'; claim: RoundSlotClaimV1 }
  | { kind: 'refuse_reverify'; refusal: ReverifyRefusalV1 }
  | { kind: 'admit_claim_evidence'; coverage: EvidenceCoverageV1[] }
  | { kind: 'admit_verdict_evidence'; admissions: VerdictAdmissionV1[] }
  | { kind: 'append_task_evidence_index' }
  | { kind: 'emit_event'; eventType: VerificationRoundEventType };

export type RoundTransition = Transition<RoundSnapshot, RoundEvent, VerificationEffect>;
export type CheckTransition = Transition<RoundSnapshot, CheckEvent, VerificationEffect>;

// -------------------------------------------------------------------------- //
// Pure helpers named by §9.6                                                  //
// -------------------------------------------------------------------------- //

export type CheckResultVerdictV1 = { outcome: EvidenceOutcome; incompleteCause: RoundCheckIncompleteCause | null };

/**
 * The service's former `outcomeFor` (moved here in A.2 step 3) with the C5
 * cause of an INCONCLUSIVE result, in the same order (VR-03). PASS/FAIL carry
 * no cause.
 */
export function outcomeFor(observation: CheckProcessObservation, sourceStatus: CheckSourceStatus): CheckResultVerdictV1 {
  if (observation.kind === 'not_started') return { outcome: 'INCONCLUSIVE', incompleteCause: 'not_started' };
  if (sourceStatus !== 'matched') return { outcome: 'INCONCLUSIVE', incompleteCause: 'source_not_matched' };
  if (observation.timedOut) return { outcome: 'INCONCLUSIVE', incompleteCause: 'process_timed_out' };
  if (observation.cancelled) return { outcome: 'INCONCLUSIVE', incompleteCause: 'process_cancelled' };
  if (observation.signal !== null || observation.exitCode === null || observation.effects.workspaceRevision === null) {
    return { outcome: 'INCONCLUSIVE', incompleteCause: 'process_abnormal' };
  }
  return { outcome: observation.exitCode === 0 ? 'PASS' : 'FAIL', incompleteCause: null };
}

/** The required coverage a claim attaches to (the service's former `collectRequiredCoverage`). */
export function requiredRoundCoverage(round: Pick<RoundSnapshot, 'verificationPlan'>): EvidenceCoverageV1[] {
  const seen = new Set<string>();
  const coverage: EvidenceCoverageV1[] = [];
  for (const check of round.verificationPlan.checks) {
    for (const entry of check.coverage) {
      const key = requirementKeyOf(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      coverage.push({ ...entry });
    }
  }
  for (const uncovered of round.verificationPlan.uncovered ?? []) {
    const key = requirementKeyOf(uncovered);
    if (seen.has(key)) continue;
    seen.add(key);
    coverage.push({ obligationId: uncovered.obligationId, requirementId: uncovered.requirementId });
  }
  return coverage;
}

/** §9.1 design names; display only, never stored. A superseded predecessor (VR-15) is still `completed`. */
export type RoundDisplayStatus = 'incomplete' | 'running' | 'interrupted' | 'completed';

export function displayRoundStatus(round: Pick<RoundSnapshot, 'status' | 'checks'>): RoundDisplayStatus {
  switch (round.status) {
    case 'finalized': return 'completed';
    case 'open': break;
    default: return unreachable(round.status, 'round status');
  }
  if (round.checks.some((check) => check.phase === 'executing')) return 'running';
  const interrupted = round.checks.some((check) => check.phase === 'interrupted');
  const pending = round.checks.some((check) => check.phase === 'pending');
  return interrupted && !pending ? 'interrupted' : 'incomplete';
}

export const FROZEN_PERMISSION_CHANGED = 'frozen_permission_changed';
export const FROZEN_ROOT_CHANGED = 'frozen_root_changed';
export const FROZEN_SOURCE_CHANGED = 'frozen_source_changed';
const FROZEN_BINDING_MARKERS: readonly string[] = [FROZEN_PERMISSION_CHANGED, FROZEN_ROOT_CHANGED, FROZEN_SOURCE_CHANGED];

/** L-9: the stable VD-8 marker as a fixed `reason` prefix, `<marker>: <text>`. */
export function frozenBindingReason(marker: string, text: string): string {
  return `${marker}: ${text}`;
}

/**
 * Exit #3 (VD-8, L-9): only a `beginCheck` refusal whose reason starts with one
 * of the three frozen-binding markers ends the round's check attempts; every
 * other refusal waits.
 */
export function beginRefusalIsPermanent(rejection: Pick<CoreRejection, 'reason'>): boolean {
  return FROZEN_BINDING_MARKERS.some((marker) => rejection.reason.startsWith(`${marker}:`));
}

// -------------------------------------------------------------------------- //
// Round chain (VD-5, VD-12..VD-15)                                            //
// -------------------------------------------------------------------------- //

export type RoundChainHeadV1 =
  | { kind: 'none' }
  /** `chain` lists the rounds by ordinal; `head` is the last. */
  | { kind: 'head'; head: RoundSnapshot; chain: RoundSnapshot[] }
  | { kind: 'invalid'; reason: string };

/**
 * VD-14: the one head of a subject's chain. Valid when every round names the
 * same subject (ref minus roundId), ordinals are 1..n and unique, ordinal 1 has
 * no predecessor, and round k>1 names round k−1 as predecessor while k−1 is
 * finalized non-PASS (so only the head can be open). A legacy round without
 * `chain` is a slot-less root (ordinal 1); two of them are two roots.
 */
export function roundChainHead(rounds: readonly RoundSnapshot[]): RoundChainHeadV1 {
  const first = rounds[0];
  if (first === undefined) return { kind: 'none' };
  for (const round of rounds) {
    if (!sameSubjectRef(round.ref, first.ref)) {
      return { kind: 'invalid', reason: `round ${round.ref.roundId} belongs to another subject than round ${first.ref.roundId}` };
    }
  }
  const byOrdinal = new Map<number, RoundSnapshot>();
  for (const round of rounds) {
    const ordinal = roundOrdinalOf(round);
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
      return { kind: 'invalid', reason: `round ${round.ref.roundId} has an invalid ordinal ${ordinal}` };
    }
    const other = byOrdinal.get(ordinal);
    if (other !== undefined) {
      return { kind: 'invalid', reason: ordinal === 1
        ? `rounds ${other.ref.roundId} and ${round.ref.roundId} are both chain roots`
        : `rounds ${other.ref.roundId} and ${round.ref.roundId} share ordinal ${ordinal}` };
    }
    byOrdinal.set(ordinal, round);
  }
  const chain: RoundSnapshot[] = [];
  for (let ordinal = 1; ordinal <= rounds.length; ordinal += 1) {
    const round = byOrdinal.get(ordinal);
    if (round === undefined) return { kind: 'invalid', reason: `the chain has no round with ordinal ${ordinal}` };
    const predecessorRef = round.chain?.predecessorRoundRef ?? null;
    const predecessor = chain[ordinal - 2];
    if (predecessor === undefined) {
      if (predecessorRef !== null) return { kind: 'invalid', reason: `chain root ${round.ref.roundId} names a predecessor` };
    } else {
      if (predecessorRef === null || !sameRoundRef(predecessorRef, predecessor.ref)) {
        return { kind: 'invalid', reason: `round ${round.ref.roundId} does not name round ${predecessor.ref.roundId} as its predecessor` };
      }
      if (!isFinalizedNonPass(predecessor)) {
        return { kind: 'invalid', reason: `predecessor ${predecessor.ref.roundId} is not finalized non-PASS` };
      }
    }
    chain.push(round);
  }
  return { kind: 'head', head: chain[chain.length - 1]!, chain };
}

/**
 * VD-5: the evidence a requeue or a successor round supersedes: the head's
 * cumulative `chain.supersededEvidenceIds` (ancestors first), then the head's
 * own `evidenceRefs`. A legacy head contributes only its own ids.
 */
export function chainEvidenceIds(head: Pick<RoundSnapshot, 'chain' | 'evidenceRefs'>): string[] {
  return distinct([...(head.chain?.supersededEvidenceIds ?? []), ...head.evidenceRefs.map((ref) => ref.evidenceId)]);
}

/** VR-09 / VD-5: the union of the ids every TaskRequeue of the Task stored (L-3), first occurrence order. */
export function evidenceSupersededByRequeue(requeues: readonly Pick<TaskRequeueSnapshotV1, 'supersededEvidenceIds'>[]): string[] {
  return distinct(requeues.flatMap((requeue) => requeue.supersededEvidenceIds));
}

export type ReverifyFailureClass = Extract<ReworkFailureClass, 'check_failed' | 'check_incomplete'>;

/** C2/VD-12: FAIL → `check_failed`; INCONCLUSIVE or a legacy PASS with gaps → `check_incomplete`; else null. */
export function reverifyFailureClass(head: Pick<RoundSnapshot, 'status' | 'outcome' | 'gaps'>): ReverifyFailureClass | null {
  if (!isFinalizedNonPass(head)) return null;
  return head.outcome === 'FAIL' ? 'check_failed' : 'check_incomplete';
}

/**
 * §13.7 point 3 over `roundFailureFacts(predecessor)`:
 * - `host_interruption`: every non-PASS check is `interrupted` with cause
 *   `host_restart`, and the gap codes are ⊆ {`interrupted_check`};
 * - `not_started`: every non-PASS cause ∈ {`host_restart`, `not_started`}, at
 *   least one `not_started`, gap codes ⊆ {`interrupted_check`};
 * - otherwise `none` (a legacy check has no cause and reads null).
 */
export function reverifyExemption(predecessor: Pick<RoundSnapshot, 'checks' | 'gaps'>): ReverifyExemption {
  return reverifyExemptionOfFacts(roundFailureFacts(predecessor));
}

/**
 * `reverifyExemption` over the facts form `roundFailureFacts` gives, so a
 * reader of `TaskRow.failure.round` (`failingChecks`, `gapCodes`) judges the
 * same exemption without the round (the Workflow's `reverify_round` reason).
 */
export function reverifyExemptionOfFacts(facts: Pick<RoundFailureFactsV1, 'checks' | 'gapCodes'>): ReverifyExemption {
  if (facts.checks.length === 0) return 'none';
  if (!facts.gapCodes.every((code) => code === INTERRUPTED_CHECK_GAP_CODE)) return 'none';
  if (facts.checks.every((check) => check.phase === 'interrupted' && check.cause === 'host_restart')) return 'host_interruption';
  const causes = facts.checks.map((check) => check.cause);
  if (causes.every((cause) => cause === 'host_restart' || cause === 'not_started') && causes.includes('not_started')) {
    return 'not_started';
  }
  return 'none';
}

/**
 * VD-13 (§13.7 point 4): the successor's `chain.autoCount`. A human resets it
 * to 0; a Host-interruption exemption keeps the predecessor's count; any other
 * automatic request (`system`, `agent`) counts one more. The VR-14 record and
 * the Workflow's `auto-reverify:<class>#<autoCount>` reason use this one rule.
 */
export function successorAutoCount(previousAutoCount: number, actorClass: ReworkActorClass, exemption: ReverifyExemption): number {
  if (actorClass === 'human') return 0;
  return exemption === 'host_interruption' ? previousAutoCount : previousAutoCount + 1;
}

/**
 * What `prepareRoundOpening` built for a successor; ref, subject and subject
 * Run come from the predecessor and the executor from the configuration. A
 * full `RoundOpeningV1` may be passed: only these fields are read.
 */
export type SuccessorRoundBuildV1 = Omit<RoundOpeningV1, 'ref' | 'subject' | 'subjectRunRef' | 'executor'>;

export type SuccessorRoundInputV1 = {
  /** The finalized non-PASS chain head (VR-14). */
  predecessor: RoundSnapshot;
  roundId: string;
  build: SuccessorRoundBuildV1;
  reverify: {
    requestedBy: ActorRef;
    /** `reworkActorClassOf(principal, actor)`. */
    actorClass: ReworkActorClass;
    requestedAt: string;
    basis: ReverifyBasisV1;
    newInputRefs: readonly NewBasisInputRefV1[];
    reason: string | null;
  };
};

/**
 * VR-14 record (VD-12, VD-13): the successor round @1 on the predecessor's
 * subject with a new roundId, all checks `pending`, the executor of the
 * current configuration, and the chain linked to the predecessor:
 * `supersededEvidenceIds = chainEvidenceIds(predecessor)`, `basisDigests`
 * appended, `autoCount` 0 for a human, unchanged after a Host interruption,
 * otherwise +1; `failureClass`, `exemption` and `sourceChanged` are derived.
 * The predecessor itself is never written (VR-15). Only legal combinations
 * (§14, I-20): the predecessor is finalized non-PASS and below
 * `ROUND_CHAIN_MAX`; VR-14 refuses every other case first, so a throw here is
 * a caller bug.
 */
export function buildSuccessorRound(input: SuccessorRoundInputV1): RoundSnapshot {
  const { predecessor, build, reverify } = input;
  const failureClass = reverifyFailureClass(predecessor);
  if (failureClass === null) {
    throw new Error(`round ${predecessor.ref.roundId} is not a finalized non-PASS head and has no successor`);
  }
  const ordinal = roundOrdinalOf(predecessor) + 1;
  // I-20: n ≤ ROUND_CHAIN_MAX; VR-14 refuses it first (`dependency_blocked`, `round_chain_limit:`, step 5.9).
  if (ordinal > ROUND_CHAIN_MAX) {
    throw new Error(`round ${predecessor.ref.roundId} is at the chain limit ${ROUND_CHAIN_MAX} and has no successor`);
  }
  const exemption = reverifyExemption(predecessor);
  const autoCount = successorAutoCount(predecessor.chain?.autoCount ?? 0, reverify.actorClass, exemption);
  const chain: RoundChainV1 = {
    schemaVersion: 1,
    ordinal,
    predecessorRoundRef: { ...predecessor.ref },
    predecessorRevision: predecessor.revision,
    supersededEvidenceIds: chainEvidenceIds(predecessor),
    basisDigests: [...(predecessor.chain?.basisDigests ?? []), reverify.basis.digest],
    autoCount,
    reverify: {
      requestedBy: reverify.requestedBy,
      actorClass: reverify.actorClass,
      failureClass,
      requestedAt: reverify.requestedAt,
      basis: reverify.basis,
      exemption,
      sourceChanged: build.identity.sourceDigest !== predecessor.identity.sourceDigest,
      newInputRefs: [...reverify.newInputRefs],
      reason: reverify.reason,
    },
  };
  // Only the built fields are taken: a caller passing VR-01's full opening
  // (its own ref, the caller as executor) must not override the subject or
  // the configured executor (VD-12).
  const { adoptedPlanRef, taskBasisRef, configuration, configurationDigest, identity, sourceProof, verificationPlan } = build;
  const opened = buildOpenedRound({
    ref: { ...predecessor.ref, roundId: input.roundId },
    subject: predecessor.subject,
    subjectRunRef: predecessor.subjectRunRef,
    adoptedPlanRef,
    taskBasisRef,
    executor: configuration.executor,
    configuration,
    configurationDigest,
    identity,
    sourceProof,
    verificationPlan,
  });
  return { ...opened, chain };
}

// -------------------------------------------------------------------------- //
// Projection input (§9 "轮次 → Task 投影", §4 P7–P13, P20)                    //
// -------------------------------------------------------------------------- //

/** What `projectTaskPhase` reads from a chain head; the Task phase itself is decided in `task-machine.ts`. */
export type RoundTaskSignalV1 =
  | { kind: 'none' }
  | { kind: 'invalid'; reason: string }
  | {
    kind: 'open'; head: RoundSnapshot; ordinal: number; predecessorRoundRef: VerificationRoundRef | null;
    interruptedCheckIds: string[];
    /** Some check is still `pending` or `executing` (P12 even with interrupted checks). */
    unsettled: boolean;
  }
  | { kind: 'fail'; head: RoundSnapshot; ordinal: number; failedCheckIds: string[] }
  | { kind: 'inconclusive'; head: RoundSnapshot; ordinal: number; gapCodes: string[]; legacyPassWithGaps: boolean }
  | { kind: 'pass'; head: RoundSnapshot; ordinal: number };

export function roundTaskSignal(rounds: readonly RoundSnapshot[]): RoundTaskSignalV1 {
  const chain = roundChainHead(rounds);
  switch (chain.kind) {
    case 'none': return { kind: 'none' };
    case 'invalid': return { kind: 'invalid', reason: chain.reason };
    case 'head': break;
    default: return unreachable(chain, 'round chain');
  }
  const head = chain.head;
  const ordinal = roundOrdinalOf(head);
  switch (head.status) {
    case 'open':
      return { kind: 'open', head, ordinal, predecessorRoundRef: head.chain?.predecessorRoundRef ?? null,
        interruptedCheckIds: head.checks.filter((check) => check.phase === 'interrupted').map((check) => check.checkId).sort(),
        unsettled: head.checks.some((check) => check.phase === 'pending' || check.phase === 'executing') };
    case 'finalized': break;
    default: return unreachable(head.status, 'round status');
  }
  switch (head.outcome) {
    case 'FAIL':
      return { kind: 'fail', head, ordinal,
        failedCheckIds: head.checks.filter((check) => check.outcome === 'FAIL').map((check) => check.checkId).sort() };
    case 'INCONCLUSIVE':
    case null:
      return { kind: 'inconclusive', head, ordinal, gapCodes: roundFailureFacts(head).gapCodes, legacyPassWithGaps: false };
    case 'PASS':
      return head.gaps.length > 0
        ? { kind: 'inconclusive', head, ordinal, gapCodes: roundFailureFacts(head).gapCodes, legacyPassWithGaps: true }
        : { kind: 'pass', head, ordinal };
    default: return unreachable(head.outcome, 'round outcome');
  }
}

// -------------------------------------------------------------------------- //
// D-2 fold (VR-07)                                                            //
// -------------------------------------------------------------------------- //

export type RoundFoldInputV1 = RoundFoldFactsV1 & { round: Pick<RoundSnapshot, 'checks' | 'verificationPlan'> };

/** One Evidence@1 to admit: the check's verdict narrowed to one requirement. */
export type FoldAdmissionV1 = { checkId: string; coverage: EvidenceCoverageV1 };

export type RoundFoldResultV1 =
  | { status: 'folded'; outcome: EvidenceOutcome; gaps: RoundGapV1[]; admissions: FoldAdmissionV1[] }
  | { status: 'incomplete'; detail: string };

/** One plan check as the fold meets it. */
type FoldStepV1 =
  | { kind: 'missing'; planCheck: VerificationCheckPlan }
  | { kind: 'stop' | 'pending' | 'interrupted' | 'verdict'; planCheck: VerificationCheckPlan; check: RoundCheckSnapshot };

/**
 * The plan checks the fold walks, in plan-check order: a check the round
 * lacks is `missing`, a `pending` or `interrupted` one is a gap, a `finished`
 * one gives a verdict, and the walk ends at the first `executing` check
 * (`stop`, which refuses the fold, I-7). The one rule for the fold and
 * `foldVerdictChecks` alike.
 */
function foldSteps(round: Pick<RoundSnapshot, 'checks' | 'verificationPlan'>): FoldStepV1[] {
  const steps: FoldStepV1[] = [];
  for (const planCheck of round.verificationPlan.checks) {
    const check = round.checks.find((candidate) => candidate.checkId === planCheck.checkId);
    if (check === undefined) {
      steps.push({ kind: 'missing', planCheck });
      continue;
    }
    switch (check.phase) {
      case 'executing':
        steps.push({ kind: 'stop', planCheck, check });
        return steps;
      case 'interrupted': steps.push({ kind: 'interrupted', planCheck, check }); break;
      case 'pending': steps.push({ kind: 'pending', planCheck, check }); break;
      case 'finished': steps.push({ kind: 'verdict', planCheck, check }); break;
      default: return unreachable(check.phase, 'check phase');
    }
  }
  return steps;
}

/**
 * The finished checks the fold judges, in plan-check order up to where it
 * stops. The owner builds one candidate verdict per entry (drawing one
 * Evidence id each, as before A.2 step 3) and decides its applicability
 * before the fold; the fold's admissions name only these checks.
 */
export function foldVerdictChecks(round: Pick<RoundSnapshot, 'checks' | 'verificationPlan'>): RoundCheckSnapshot[] {
  return foldSteps(round).flatMap((step) => step.kind === 'verdict' ? [step.check] : []);
}

/**
 * `finalizeRoundOutcome`, the D-2 fold (§9.3 "D-2 结论折叠"):
 * - an `executing` check refuses the fold (`incomplete`; the walk of
 *   `foldSteps`, shared with `foldVerdictChecks`);
 * - gaps in plan-check order: `missing_check`, `pending_check`,
 *   `interrupted_check`, `evidence_<basis>` for a non-applicable verdict; then
 *   `uncovered_requirement`; then the context gaps;
 * - every verdict is STALE when the source is not current; OUT_OF_SCOPE
 *   without a gap when a Plan is unreadable (`decisions = null`);
 * - FAIL when some applicable verdict is FAIL (an explicit failure wins over
 *   missing items); otherwise INCONCLUSIVE when there is a gap, a required
 *   requirement has an applicable INCONCLUSIVE blocker or no applicable PASS;
 *   otherwise PASS, so PASS ⇒ `gaps = []` (VD-4);
 * - admissions: the applicable PASS coverage per requirement, then every
 *   blocker, in `selectEffectiveEvidenceSet` order (`coverage.ts:76-121`).
 */
export function finalizeRoundOutcome(input: RoundFoldInputV1): RoundFoldResultV1 {
  const { round } = input;
  const gaps: RoundGapV1[] = [];
  const candidates: { checkId: string; outcome: EvidenceOutcome; coverage: readonly EvidenceCoverageV1[];
    applicability: EvidenceApplicability }[] = [];
  for (const step of foldSteps(round)) {
    const first = step.planCheck.coverage[0];
    const firstCoverage = first === undefined ? {} : { coverage: { ...first } };
    switch (step.kind) {
      case 'missing':
        gaps.push({ code: 'missing_check', message: `the round is missing required check ${step.planCheck.checkId}` });
        continue;
      case 'stop':
        return { status: 'incomplete',
          detail: `the check ${step.check.checkId} is ${step.check.phase}; its result window is not reconciled` };
      case 'pending':
        gaps.push({ code: 'pending_check', message: `the required check ${step.check.checkId} never ran`, ...firstCoverage });
        continue;
      case 'interrupted': {
        const cause = step.check.incompleteCause ?? null;
        gaps.push({ code: INTERRUPTED_CHECK_GAP_CODE, message: `the required check ${step.check.checkId} was interrupted`
          + (cause === null ? '' : ` (${cause})`), ...firstCoverage });
        continue;
      }
      case 'verdict':
        break;
      default: return unreachable(step, 'fold step');
    }
    const check = step.check;
    let applicability: EvidenceApplicability = 'OUT_OF_SCOPE';
    const decision = input.decisions === null ? undefined : input.decisions[check.checkId];
    if (decision !== undefined) {
      applicability = decision.applicability;
      if (decision.applicability !== 'APPLICABLE') {
        gaps.push({ code: `evidence_${decision.basis}`, message: `check ${check.checkId}: ${decision.reason}`, ...firstCoverage });
      }
    }
    if (!input.sourceCurrent) applicability = 'STALE';
    candidates.push({ checkId: check.checkId, outcome: check.outcome ?? 'INCONCLUSIVE', coverage: check.coverage, applicability });
  }
  for (const uncovered of round.verificationPlan.uncovered ?? []) {
    gaps.push({ code: 'uncovered_requirement', message: `no registered check covers required requirement ${uncovered.requirementId}`,
      coverage: { obligationId: uncovered.obligationId, requirementId: uncovered.requirementId } });
  }
  gaps.push(...input.contextGaps.map((gap) => ({ ...gap })));

  const covering = new Map<string, FoldAdmissionV1>();
  const blocking = new Map<string, FoldAdmissionV1[]>();
  for (const candidate of candidates) {
    if (candidate.applicability !== 'APPLICABLE') continue;
    for (const entry of candidate.coverage) {
      const key = requirementKeyOf(entry);
      const admission = { checkId: candidate.checkId,
        coverage: { obligationId: entry.obligationId, requirementId: entry.requirementId } };
      if (candidate.outcome === 'PASS') {
        if (!covering.has(key)) covering.set(key, admission);
        continue;
      }
      const list = blocking.get(key);
      if (list === undefined) blocking.set(key, [admission]);
      else list.push(admission);
    }
  }
  const requiredKeys = new Set<string>();
  for (const planCheck of round.verificationPlan.checks) {
    for (const entry of planCheck.coverage) requiredKeys.add(requirementKeyOf(entry));
  }
  for (const uncovered of round.verificationPlan.uncovered ?? []) requiredKeys.add(requirementKeyOf(uncovered));
  let blocked = false;
  let missing = false;
  for (const key of requiredKeys) {
    if ((blocking.get(key)?.length ?? 0) > 0) blocked = true;
    if (!covering.has(key)) missing = true;
  }
  const admissions = [...covering.values(), ...[...blocking.values()].flat()];
  const failed = candidates.some((candidate) => candidate.applicability === 'APPLICABLE' && candidate.outcome === 'FAIL');
  const outcome: EvidenceOutcome = failed ? 'FAIL' : gaps.length > 0 || blocked || missing ? 'INCONCLUSIVE' : 'PASS';
  return { status: 'folded', outcome, gaps, admissions };
}

// -------------------------------------------------------------------------- //
// Record constructors (§14.1)                                                 //
// -------------------------------------------------------------------------- //

/** The pending checks of a compiled plan, or the first check the frozen configuration does not register. */
export function pendingRoundChecks(
  verificationPlan: VerificationPlanV1,
  configuration: TrustedCheckConfiguration,
): { ok: true; checks: RoundCheckSnapshot[] } | { ok: false; checkId: string } {
  const checks: RoundCheckSnapshot[] = [];
  for (const planCheck of verificationPlan.checks) {
    const definition = configuration.checks.find((candidate) => candidate.checkId === planCheck.checkId);
    if (definition === undefined) return { ok: false, checkId: planCheck.checkId };
    checks.push({ checkId: planCheck.checkId, definition, coverage: planCheck.coverage.map((entry) => ({ ...entry })),
      phase: 'pending', invocationId: null, outcome: null, reportRef: null, sourceStatus: null });
  }
  return { ok: true, checks };
}

/**
 * VR-01: open@1 with every check `pending`, the uncovered requirements as gaps
 * and the ordinal-1 chain root (C5), in the key order of the service's former
 * literal with `chain` last. Every compiled check must be registered
 * (`transitionRound` refuses otherwise). `buildSuccessorRound` replaces the
 * chain of the same shape (VR-14).
 */
export function buildOpenedRound(opening: RoundOpeningV1): RoundSnapshot {
  const checks = pendingRoundChecks(opening.verificationPlan, opening.configuration);
  if (!checks.ok) throw new Error(`the compiled plan names an unregistered check ${checks.checkId}`);
  const gaps: RoundGapV1[] = (opening.verificationPlan.uncovered ?? []).map((uncovered) => ({
    code: 'uncovered_requirement', message: `no registered check covers required requirement ${uncovered.requirementId}`,
    coverage: { obligationId: uncovered.obligationId, requirementId: uncovered.requirementId } }));
  return { ref: opening.ref, revision: 1, schemaVersion: 1, subject: { ...opening.subject },
    subjectRunRef: opening.subjectRunRef, adoptedPlanRef: opening.adoptedPlanRef, taskBasisRef: opening.taskBasisRef,
    executor: opening.executor, configuration: opening.configuration, configurationDigest: opening.configurationDigest,
    identity: opening.identity, sourceProof: opening.sourceProof, verificationPlan: opening.verificationPlan,
    checks: checks.checks, status: 'open', outcome: null, gaps, evidenceRefs: [], chain: rootRoundChain() };
}

/** The one write of a check's lifecycle fields (§14.1); `incompleteCause` is written only through here. */
export type CheckPhaseChange =
  /** VR-02. */
  | { phase: 'executing'; invocationId: string }
  /** VR-03 (the INCONCLUSIVE cause of `outcomeFor`; PASS/FAIL leave it out, §9.1 "null 或缺省"). */
  | {
    phase: 'finished'; outcome: EvidenceOutcome; reportRef: ArtifactRef; sourceStatus: Exclude<CheckSourceStatus, null>;
    incompleteCause?: RoundCheckIncompleteCause | null;
  }
  /** VR-04, VR-13: the invocation is kept, the result fields stay null. */
  | { phase: 'interrupted'; incompleteCause: CheckInterruptionCause }
  /** VR-05: back to pending, the invocation and any cause cleared. */
  | { phase: 'pending' };

/**
 * The one phase each change leaves (§9.3): VR-02 pending → executing; VR-03
 * executing → finished; VR-04, VR-13 executing → interrupted; VR-05
 * executing → pending. Every other source is a §9.4 row (D-12: interrupted
 * never returns to pending and never runs again in the same round).
 */
const CHECK_PHASE_SOURCE: Readonly<Record<CheckPhaseChange['phase'], CheckPhase>> = {
  executing: 'pending',
  finished: 'executing',
  interrupted: 'executing',
  pending: 'executing',
};

/**
 * The round @rev+1 with one check changed; the other checks and fields keep
 * their bytes. Only legal combinations (§9.1, §14): the round is open, the
 * check is in the change's source phase, and a finished check's cause matches
 * its outcome. The transitions refuse every other case first, so a throw here
 * is a caller bug.
 */
export function withCheckPhase(round: RoundSnapshot, checkId: string, change: CheckPhaseChange): RoundSnapshot {
  switch (round.status) {
    case 'open': break;
    case 'finalized': throw new Error(`the round ${round.ref.roundId} is finalized; its checks are settled`);
    default: return unreachable(round.status, 'round status');
  }
  const current = round.checks.find((check) => check.checkId === checkId);
  if (current === undefined) throw new Error(`the round has no registered check ${checkId}`);
  const source = CHECK_PHASE_SOURCE[change.phase];
  if (current.phase !== source) {
    throw new Error(`the check ${checkId} is ${current.phase}; it becomes ${change.phase} only from ${source}`);
  }
  return { ...round, revision: round.revision + 1,
    checks: round.checks.map((check) => check.checkId === checkId ? changedCheck(check, change) : check) };
}

function changedCheck(check: RoundCheckSnapshot, change: CheckPhaseChange): RoundCheckSnapshot {
  switch (change.phase) {
    case 'executing':
      return { ...check, phase: 'executing', invocationId: change.invocationId };
    case 'finished': {
      const cause = change.incompleteCause ?? null;
      if (cause !== null && (change.outcome !== 'INCONCLUSIVE' || cause === 'host_restart' || cause === 'ticket_invalid')) {
        throw new Error(`a finished ${change.outcome} check cannot carry the cause ${cause}`);
      }
      const finished: RoundCheckSnapshot = { ...check, phase: 'finished', outcome: change.outcome,
        reportRef: change.reportRef, sourceStatus: change.sourceStatus };
      return change.incompleteCause === undefined ? finished : { ...finished, incompleteCause: change.incompleteCause };
    }
    case 'interrupted':
      return { ...check, phase: 'interrupted', outcome: null, reportRef: null, sourceStatus: null,
        incompleteCause: change.incompleteCause };
    case 'pending': {
      const pending: RoundCheckSnapshot = { ...check, phase: 'pending', invocationId: null, outcome: null, reportRef: null,
        sourceStatus: null };
      delete pending.incompleteCause;
      return pending;
    }
    default: return unreachable(change, 'check phase change');
  }
}

/**
 * VR-07. Only legal combinations (§9.1, §14): the round is open (§9.4: a
 * finalized round never rewrites its outcome) and no check is `executing`
 * (I-7). An `interrupted` check is allowed: the D-2 fold counts it as a gap.
 * The transitions refuse both cases first, so a throw here is a caller bug.
 */
export function buildFinalizedRound(
  round: RoundSnapshot,
  result: { outcome: EvidenceOutcome; gaps: RoundGapV1[]; evidenceRefs: EvidenceRef[] },
): RoundSnapshot {
  switch (round.status) {
    case 'open': break;
    case 'finalized': throw new Error(`the round ${round.ref.roundId} is already finalized; its outcome is not rewritten`);
    default: return unreachable(round.status, 'round status');
  }
  const executing = round.checks.find((check) => check.phase === 'executing');
  if (executing !== undefined) throw new Error(`the check ${executing.checkId} is executing; the round cannot be finalized`);
  return { ...round, revision: round.revision + 1, status: 'finalized', outcome: result.outcome, gaps: result.gaps,
    evidenceRefs: result.evidenceRefs };
}

/** The index of the subject task (`readIndex`, `evidence-service.ts:372-374`); a gate round writes the gate's own index. */
export function taskEvidenceIndexRefOf(round: Pick<RoundSnapshot, 'ref'>): TaskEvidenceIndexRef {
  return { aggregateType: 'TaskEvidenceIndex', projectId: round.ref.projectId, goalId: round.ref.goalId,
    taskId: round.ref.taskId };
}

/** The index as read: `exists` separates a missing row from a stored (legacy) @0 row. */
export type TaskEvidenceIndexReadV1 = {
  ref: TaskEvidenceIndexRef;
  exists: boolean;
  revision: number;
  evidenceIds: readonly string[];
};

export type TaskEvidenceIndexWrite =
  | { write: false }
  | { write: true; record: TaskEvidenceIndexSnapshot; expectedRevision: number | null };

/**
 * VR-10..VR-12: revision = stored ids + appended. A missing row is guarded
 * absent (`null`, VR-10); a stored row, a legacy @0 row included, at its stored
 * revision, which the append repairs (VR-11, decided by `exists`, never by
 * `revision === 0`). Zero appended ids write nothing and create no @0 row
 * (VR-12).
 */
export function nextTaskEvidenceIndex(current: TaskEvidenceIndexReadV1, appended: readonly string[]): TaskEvidenceIndexWrite {
  if (appended.length === 0) return { write: false };
  const record: TaskEvidenceIndexSnapshot = { ref: current.ref, revision: current.evidenceIds.length + appended.length,
    schemaVersion: 1, evidenceIds: [...current.evidenceIds, ...appended] };
  return { write: true, record, expectedRevision: current.exists ? current.revision : null };
}

// -------------------------------------------------------------------------- //
// Shared guard rows                                                           //
// -------------------------------------------------------------------------- //

function staleRound(): Rejected {
  return reject('stale', 'revision_conflict', 'the round changed since the caller read it');
}

function pinIsStale(state: RoundSnapshot, ctx: RoundGuardContext): boolean {
  return ctx.expectedRevision !== null && ctx.expectedRevision !== state.revision;
}

/**
 * Pre-IO guards of the round-level writes, in today's order: `round_opened`
 * (`evidence-service.ts:500-502`; the round key must be absent),
 * `evidence_submitted` (`:882`) and `round_finalized` (`:937-938`): the
 * reviewer evidence before anything else (`roundReviewerEvidenceProblem`,
 * which the owner also runs on its own at `:913-916`, ahead of the scope
 * check and the receipt lookup), then open, executor and the pin.
 */
export function roundWriteAdmission(state: RoundSnapshot | null, head: RoundEventHead, ctx: RoundGuardContext): Rejected | null {
  switch (head.kind) {
    case 'round_opened':
      if (state !== null) return reject('illegal', 'invalid', 'a round is opened once; a new round on the subject is a successor (VR-14)');
      if (!ctx.callerIsExecutor) return reject('guard_failed', 'forbidden', 'the call context is not the registered check Host executor');
      return null;
    case 'evidence_submitted':
      if (state === null) return reject('illegal', 'invalid', 'evidence_submitted needs an existing round');
      switch (state.status) {
        case 'open': break;
        // VD-2: like a fresh begin or result, a claim never lands on a finalized round.
        case 'finalized': return reject('illegal', 'busy', 'the round is finalized; no further claim may be submitted');
        default: return unreachable(state.status, 'round status');
      }
      if (!ctx.callerIsExecutor) return reject('guard_failed', 'forbidden', 'the evidence author is not the round executor');
      return null;
    case 'round_finalized': {
      const reviewerProblem = roundReviewerEvidenceProblem(head.reviewerEvidenceCount);
      if (reviewerProblem !== null) return reviewerProblem;
      if (state === null) return reject('illegal', 'invalid', 'round_finalized needs an existing round');
      switch (state.status) {
        case 'open': break;
        case 'finalized': return reject('illegal', 'busy', 'the round is already finalized');
        default: return unreachable(state.status, 'round status');
      }
      if (!ctx.callerIsExecutor) return reject('guard_failed', 'forbidden', 'the finalizer is not the round executor');
      if (pinIsStale(state, ctx)) return staleRound();
      return null;
    }
    default: return unreachable(head, 'round event head');
  }
}

/** VR-07's first guard: reviewer evidence is not finalized in R3e.1 (needs no round). */
export function roundReviewerEvidenceProblem(reviewerEvidenceCount: number): Rejected | null {
  return reviewerEvidenceCount > 0
    ? reject('guard_failed', 'unsupported', 'reviewer evidence finalization is not implemented in R3e.1') : null;
}

/**
 * VR-01 subject guards, one step per read so the owner stops before the next
 * read: the plan pointer after the Goal read (`roundOpenPointerProblem`), the
 * task basis after the Plan read (`roundOpenBasisProblem`), the subject
 * relation and a normal Run end (VD-3) after the Run read
 * (`roundOpenSubjectProblem`), then the subject's chain after the lookup
 * (`roundOpenChainProblem`, VD-1/VD-15), all before the capture. The subject
 * step includes the TaskRequeue cover (5.4); VD-9 (5.5) asks the Goal's
 * desired state right after the Goal read and the subject's disposition right
 * after the Plan read (`roundGoalActivityProblem`, `roundSubjectActivityProblem`).
 */
export function roundOpenProblem(facts: RoundOpenFactsV1, subject: TaskTriple): Rejected | null {
  return roundGoalActivityProblem(facts.activity.goalDesiredState)
    ?? roundOpenPointerProblem(facts.planIsActive)
    ?? roundSubjectActivityProblem(facts.activity.subjectDisposition, subject)
    ?? roundOpenBasisProblem(facts.taskBasisResolved, subject)
    ?? roundOpenSubjectProblem(facts, subject)
    ?? roundOpenChainProblem(facts.chain, subject);
}

/**
 * VD-9 (§9.4, D-9): a Goal that is not active starts no new check process
 * (`busy`, "resume the Goal first", the claim's code). Results, reconcile and
 * finalize stay writable: they only book what already ran.
 */
export function roundGoalActivityProblem(goalDesiredState: GoalDesiredState): Rejected | null {
  return goalDesiredState === 'active' ? null
    : reject('guard_failed', 'busy', `the Goal is ${goalDesiredState}; no new check process starts until the Goal is resumed`);
}

/** VD-9 (§9.4, C7): a subject task that is not `active` in the Goal's current adopted Plan starts no new check process (`invalid`). */
export function roundSubjectActivityProblem(subjectDisposition: Disposition | null, subject: TaskTriple): Rejected | null {
  if (subjectDisposition === 'active') return null;
  return reject('guard_failed', 'invalid', subjectDisposition === null
    ? `the subject task ${subject.taskId} is not in the Goal current adopted Plan`
    : `the subject task ${subject.taskId} is ${subjectDisposition} in the Goal current adopted Plan; no new check process starts`);
}

/** VD-9 of `check_begun` (VR-02): the Goal, then the subject, both asked after the admission and before the frozen binding. */
export function roundActivityProblem(activity: RoundActivityFactsV1, subject: TaskTriple): Rejected | null {
  return roundGoalActivityProblem(activity.goalDesiredState) ?? roundSubjectActivityProblem(activity.subjectDisposition, subject);
}

/** `evidence-service.ts:513-515`; `source_stale` is kept (§9.4), VD-7 makes the Workflow pass the current Plan. */
export function roundOpenPointerProblem(planIsActive: boolean): Rejected | null {
  return planIsActive ? null : reject('stale', 'source_stale', 'the requested planRef is not the Goal current adopted Plan');
}

/** `:523-525`: the subject task has a resolved, supported task-state basis in the requested Plan. */
export function roundOpenBasisProblem(taskBasisResolved: boolean, subject: TaskTriple): Rejected | null {
  return taskBasisResolved ? null
    : reject('guard_failed', 'incomplete', `the subject task ${subject.taskId} has no resolved task-state basis`);
}

/**
 * `:537-548`: the subject relation (work or gate), then the Run has formally
 * ended, then VD-3: it ended `completed` (an unknown, crashed, cancelled or
 * yielded Run is not verified) and its reconciliation is absent or `done`
 * (Workflow `normalEnd`), then the Run is not covered by a TaskRequeue
 * (§9.4, D-3: the rework's output belongs to the new Run, which opens its own
 * chain).
 */
export function roundOpenSubjectProblem(
  facts: Pick<RoundOpenFactsV1, 'relation' | 'subjectRun' | 'subjectRunRequeued'>,
  subject: TaskTriple,
): Rejected | null {
  const problem = roundRelationProblem(facts.relation, subject) ?? roundSubjectRunProblem(facts.subjectRun);
  if (problem !== null) return problem;
  if (facts.subjectRunRequeued) {
    return reject('guard_failed', 'forbidden', 'the subject Run is covered by a TaskRequeue; its rework belongs to the new Run');
  }
  return null;
}

/** `:537-548`: the subject relation (work: the Run's task is the subject; gate: the adopted gate and its producer). */
function roundRelationProblem(relation: RoundSubjectRelationV1, subject: TaskTriple): Rejected | null {
  switch (relation.kind) {
    case 'gate':
      if (!relation.gateAdopted) {
        return reject('guard_failed', 'invalid', `the gate subject ${subject.taskId} is not an adopted ${relation.gateSubject} gate`);
      }
      switch (relation.producer) {
        case 'ok': break;
        case 'not_goal_work_run': return reject('guard_failed', 'forbidden', 'the gate producer Run is not a work Run of the same Goal');
        case 'not_adopted_work': return reject('guard_failed', 'forbidden', 'the gate producer Run is not an adopted work task of the same Plan');
        case 'other_workspace': return reject('guard_failed', 'forbidden', 'the gate producer Run belongs to another workspace');
        default: return unreachable(relation.producer, 'gate producer relation');
      }
      break;
    case 'work':
      if (!relation.runTaskIsSubject) return reject('guard_failed', 'forbidden', 'the subject task is not the subject Run task');
      break;
    default: return unreachable(relation, 'subject relation');
  }
  return null;
}

/** VD-3: the subject Run formally ended `completed` and its reconciliation is absent or `done`. */
function roundSubjectRunProblem(run: Pick<RunSnapshot, 'status' | 'outcome' | 'reconciliation'>): Rejected | null {
  if (run.status !== 'ended') return reject('guard_failed', 'forbidden', 'the subject Run has not formally ended');
  if (run.outcome !== 'completed') {
    return reject('guard_failed', 'forbidden', `the subject Run ended ${run.outcome ?? 'without an outcome'}, not completed`);
  }
  const reconciliation = run.reconciliation;
  if (reconciliation !== undefined && reconciliation.status !== 'done') {
    return reject('guard_failed', 'forbidden', `the subject Run reconciliation is ${reconciliation.status}`);
  }
  return null;
}

/**
 * VD-1/VD-15 after the chain lookup: a subject has at most one chain. Any
 * existing chain (a legacy slot-less root included; for a gate, on any
 * producer) refuses a second root as `busy` (the owner adds the head pin); a
 * chain `roundChainHead` cannot judge is `incomplete`. The next round on the
 * subject is a successor (VR-14).
 */
export function roundOpenChainProblem(chain: RoundChainHeadV1, subject: TaskTriple): Rejected | null {
  switch (chain.kind) {
    case 'none': return null;
    case 'head':
      return reject('guard_failed', 'busy', `the subject ${subject.taskId} already has a verification round chain `
        + `(head ${chain.head.ref.roundId}); its next round is a successor (VR-14)`);
    case 'invalid':
      return reject('guard_failed', 'incomplete', `the subject ${subject.taskId} round chain is invalid: ${chain.reason}`);
    default: return unreachable(chain, 'round chain');
  }
}

/** After the compile (`evidence-service.ts:590`): every check the compiled plan names is registered in the configuration. */
export function roundOpenChecksProblem(verificationPlan: VerificationPlanV1, configuration: TrustedCheckConfiguration): Rejected | null {
  const checks = pendingRoundChecks(verificationPlan, configuration);
  return checks.ok ? null : reject('guard_failed', 'incomplete', `the compiled plan names an unregistered check ${checks.checkId}`);
}

/**
 * Pre-IO guards of the check writes. Today's order for `check_begun`
 * (`evidence-service.ts:755-756`): finalized, executor, checkId, pin, phase.
 * For the writes on an executing check (`:831-833`): finalized, executor,
 * checkId, phase, invocation, pin. The reconcile row (VR-04 `host_restart`)
 * skips the executor check: its guard is the instance lease.
 */
export function checkEventAdmission(state: RoundSnapshot, head: CheckEventHead, ctx: RoundGuardContext): Rejected | null {
  switch (state.status) {
    case 'open': break;
    case 'finalized':
      return reject('illegal', 'busy', head.kind === 'check_begun' ? 'the round is finalized; no fresh check may begin'
        : head.kind === 'check_result_recorded' ? 'the round is finalized; no fresh result may be recorded'
          : 'the round is finalized; its checks are settled');
    default: return unreachable(state.status, 'round status');
  }
  const reconcile = head.kind === 'check_interrupted' && head.cause === 'host_restart';
  if (!reconcile && !ctx.callerIsExecutor) return reject('guard_failed', 'forbidden', 'the check executor is not the round executor');
  const check = state.checks.find((candidate) => candidate.checkId === head.checkId);
  if (check === undefined) return reject('illegal', 'invalid', `the round has no registered check ${head.checkId}`);
  if (head.kind === 'check_begun') {
    if (pinIsStale(state, ctx)) return staleRound();
    switch (check.phase) {
      case 'pending': return null;
      // An interrupted check never runs again in the same round (D-12).
      case 'executing':
      case 'finished':
      case 'interrupted':
        return reject('illegal', 'busy', `the check ${check.checkId} is already ${check.phase}`);
      default: return unreachable(check.phase, 'check phase');
    }
  }
  const phaseProblem = executingPhaseProblem(check, head);
  if (phaseProblem !== null) return phaseProblem;
  if (check.invocationId !== head.invocationId) {
    return reject('guard_failed', 'forbidden', 'the ticket is not the begun invocation of this check');
  }
  if (pinIsStale(state, ctx)) return staleRound();
  return null;
}

/** §9.4 rows of the events that need an `executing` check. */
function executingPhaseProblem(check: RoundCheckSnapshot, head: Exclude<CheckEventHead, { kind: 'check_begun' }>): Rejected | null {
  const notExecuting = `the check ${check.checkId} is ${check.phase}, not executing`;
  switch (check.phase) {
    case 'executing': return null;
    case 'pending':
      switch (head.kind) {
        case 'check_result_recorded': return reject('illegal', 'busy', notExecuting);
        case 'check_interrupted':
        case 'check_abandoned':
          return reject('illegal', 'invalid', notExecuting);
        default: return unreachable(head, 'check event head');
      }
    case 'finished':
      switch (head.kind) {
        case 'check_result_recorded':
          return reject('illegal', 'busy', notExecuting);
        case 'check_interrupted':
        case 'check_abandoned':
          return reject('illegal', 'invalid', notExecuting);
        default: return unreachable(head, 'check event head');
      }
    case 'interrupted':
      switch (head.kind) {
        // A late result is history only (D-12).
        case 'check_result_recorded':
          return reject('stale', 'busy', notExecuting);
        case 'check_interrupted':
          // The same invocation already interrupted with the same cause: reconcile treats it as handled.
          return check.invocationId === head.invocationId && check.incompleteCause === head.cause
            ? reject('duplicate', 'busy', `the check ${check.checkId} is already interrupted (${head.cause})`)
            : reject('illegal', 'invalid', notExecuting);
        case 'check_abandoned':
          // D-12: an interrupted check never returns to pending.
          return reject('illegal', 'invalid', notExecuting);
        default: return unreachable(head, 'check event head');
      }
    default: return unreachable(check.phase, 'check phase');
  }
}

/**
 * VR-02 comparisons with the round's frozen binding, in order
 * (`evidence-service.ts:767-777`): Host permission revision, workspace root,
 * then (after the capture) the source digest. `sourceDigest` may be left out
 * to compare only the first two before capturing. Each reason carries its
 * VD-8 marker as the L-9 prefix, so the Workflow ends the round's attempts
 * (`beginRefusalIsPermanent`) and finalizes instead of retrying.
 */
export function frozenBindingProblem(
  round: RoundSnapshot,
  observed: Omit<FrozenBindingObservationV1, 'sourceDigest'> & { sourceDigest?: string },
): Rejected | null {
  if (observed.permissionRevision !== round.configuration.permissionRevision) {
    return reject('guard_failed', 'forbidden', frozenBindingReason(FROZEN_PERMISSION_CHANGED,
      'the current Host permission revision is not the trusted configuration binding'));
  }
  if (observed.workspaceRoot !== round.identity.workspaceRoot) {
    return reject('guard_failed', 'source_stale', frozenBindingReason(FROZEN_ROOT_CHANGED,
      'the current workspace root is not the round fixed root'));
  }
  if (observed.sourceDigest !== undefined && observed.sourceDigest !== round.identity.sourceDigest) {
    return reject('guard_failed', 'source_stale', frozenBindingReason(FROZEN_SOURCE_CHANGED,
      'the current verification source is not the round fixed source'));
  }
  return null;
}

// -------------------------------------------------------------------------- //
// Round (§9.3 VR-01, VR-07, VR-08, VR-09, VR-14, VR-15)                       //
// -------------------------------------------------------------------------- //

export function transitionRound(state: RoundSnapshot | null, event: RoundEvent, ctx: RoundGuardContext): RoundTransition {
  switch (event.kind) {
    case 'round_opened': return roundOnOpened(state, event, ctx);
    case 'evidence_submitted': return roundOnEvidenceSubmitted(state, ctx);
    case 'round_finalized': return roundOnFinalized(state, event, ctx);
    case 'round_reverified': return roundOnReverified(state, event, ctx);
    case 'task_requeued': return roundOnTaskRequeued(state);
    default: return unreachable(event, 'round event');
  }
}

/**
 * VR-09 (D-3, C5, VD-5): the round side of a requeue of the afterRun's chain
 * head. The head stays finalized and is not written; the requeue commit guards
 * it as read and holds the subject slot with a same-owner claim
 * (`headKey → headKey`; a legacy slot-less root `null → null`), because VR-14
 * never writes its predecessor: a successor round committed after the requeue
 * read moves the slot, so the two commit at most once. Its evidence is
 * superseded by the TaskRequeue (`chainEvidenceIds`), not here.
 */
function roundOnTaskRequeued(state: RoundSnapshot | null): RoundTransition {
  if (state === null) return reject('illegal', 'not_found', 'task_requeued needs the chain head round');
  if (state.status === 'open') {
    return reject('guard_failed', 'busy', `finalize_first: round ${state.ref.roundId} is open; finalize it before a requeue`);
  }
  if (!isFinalizedNonPass(state)) {
    return reject('illegal', 'invalid', `round ${state.ref.roundId} finalized as a clean PASS; there is nothing to requeue`);
  }
  const owner = state.chain === undefined ? null : roundSlotOwner(state.ref);
  return accept(state, [
    { kind: 'guard_round_unchanged', revision: state.revision },
    { kind: 'claim_round_slot', claim: { claimKey: roundSlotKey(roundSlotSubjectOf(state)), expectedOwner: owner,
      nextOwner: owner } },
  ]);
}

/**
 * VR-14 step 3 (§13.2 point 3, §9.4), then steps 4–5, in that order; the
 * owner stops here before the refusal record read, the new inputs and the
 * capture. Every refusal commits nothing:
 * - the requested predecessor is not the chain head, or its pin is stale →
 *   `revision_conflict` (the owner adds the head pin); a predecessor its
 *   subject's lookup does not list → `unavailable`;
 * - the subject Run (gate: the anchored producer): an unresolved end
 *   (`runUnresolvedBlocker`, hard limit 1) → `busy`; not ended `completed`
 *   with its reconciliation absent or `done` (VD-3) → `forbidden`;
 * - the chain is invalid → `incomplete` (no automatic exit, GAP-52); its head
 *   is open → `busy` (`finalize_first:`); the head is at `ROUND_CHAIN_MAX` →
 *   `dependency_blocked` (`round_chain_limit:`); a clean PASS head → `invalid`;
 * - the subject is not active in the Goal's current adopted Plan → `invalid`
 *   (VD-9), then VR-01's subject relation (gate/producer) with VR-01's code;
 * - work: a TaskRequeue covers the subject Run → `revision_conflict` (the
 *   owner adds `current=[TaskRequeue@1]`: the new Run opens its own chain);
 * - steps 4–5: `facts.permission` (`reworkPermission`'s answer).
 */
export function reverifyAdmissionProblem(state: RoundSnapshot, facts: RoundReverifyFactsV1, ctx: RoundGuardContext): Rejected | null {
  const chain = facts.chain;
  if (chain.kind === 'none') {
    return reject('guard_failed', 'unavailable', `round ${state.ref.roundId} is not listed in its subject's round chain`);
  }
  if (chain.kind === 'head' && !sameRoundRef(chain.head.ref, state.ref)) {
    return reject('stale', 'revision_conflict',
      `round ${state.ref.roundId} is not the chain head; round ${chain.head.ref.roundId} is (another request checked it again)`);
  }
  if (pinIsStale(state, ctx)) return staleRound();
  const blocker = runUnresolvedBlocker(facts.subjectRun);
  if (blocker !== null) return reject('guard_failed', 'busy', `reconcile the subject Run first: ${blocker}`);
  const runProblem = roundSubjectRunProblem(facts.subjectRun);
  if (runProblem !== null) return runProblem;
  if (chain.kind === 'invalid') {
    return reject('guard_failed', 'incomplete', `the subject ${state.subject.taskId} round chain is invalid: ${chain.reason}`);
  }
  const head = chain.head;
  if (head.status === 'open') {
    return reject('guard_failed', 'busy', `finalize_first: round ${head.ref.roundId} is open; finalize it before a successor round`);
  }
  const ordinal = roundOrdinalOf(head);
  if (ordinal + 1 > ROUND_CHAIN_MAX) {
    return reject('guard_failed', 'dependency_blocked',
      `round_chain_limit: round ${head.ref.roundId} is round ${ordinal} of a chain of at most ${ROUND_CHAIN_MAX}`);
  }
  if (!isFinalizedNonPass(head)) {
    return reject('illegal', 'invalid', `round ${head.ref.roundId} finalized as a clean PASS; it completes the task, it is not checked again`);
  }
  const subjectProblem = roundSubjectActivityProblem(facts.activity.subjectDisposition, state.subject)
    ?? roundRelationProblem(facts.relation, state.subject);
  if (subjectProblem !== null) return subjectProblem;
  if (facts.subjectRunRequeued) {
    return reject('stale', 'revision_conflict', 'a TaskRequeue covers the subject Run; its rework continues in the new Run');
  }
  return facts.permission;
}

/**
 * VR-14 step 7 (VD-13, §13.7 point 4), before the capture: an automatic
 * request (`system`, `agent`) whose successor would count past
 * `autoReworkLimit` is refused `auto_rework_cap_reached`; a human is never
 * capped, and a Host-interruption exemption keeps the count. Null when the
 * cap admits it (or the head has no class: step 3 refuses it first).
 */
export function reverifyCapRefusal(predecessor: RoundSnapshot, actorClass: ReworkActorClass,
  autoReworkLimit: number): ReverifyRefusalV1 | null {
  const failureClass = reverifyFailureClass(predecessor);
  const exemption = reverifyExemption(predecessor);
  if (failureClass === null || actorClass === 'human' || exemption === 'host_interruption') return null;
  const autoCount = successorAutoCount(predecessor.chain?.autoCount ?? 0, actorClass, exemption);
  if (autoCount <= autoReworkLimit) return null;
  return { code: 'auto_rework_cap_reached', failureClass, basisDigest: null, source: null, configurationRevision: null,
    reason: `auto rework cap reached: automatic reverify ${autoCount} of round ${predecessor.ref.roundId} exceeds the cap ${autoReworkLimit}` };
}

/**
 * VR-14 steps 10–11 after the capture and the compile (§13.7 points 2, 5, 6):
 * `verification_uncovered` for every class and exemption (the successor
 * could never PASS; it stores the configuration revision, LA-4); then
 * `source_unchanged` when the request asks `onlyIfSourceChanged`, the
 * exemption is `none` and the captured digest is the predecessor's; then the
 * key: with exemption `none`, a key equal to any earlier key of the chain is
 * `no_new_basis` (the reason names the round that key opened).
 */
export function reverifyPolicyRefusal(predecessor: RoundSnapshot, successor: RoundSuccessorV1,
  onlyIfSourceChanged: boolean): ReverifyRefusalV1 | null {
  const failureClass = reverifyFailureClass(predecessor);
  if (failureClass === null) return null;
  const { build, basis } = successor;
  const captured = { basisDigest: basis.digest, source: { ...basis.source } };
  const uncovered = build.verificationPlan.uncovered ?? [];
  if (uncovered.length > 0) {
    return { code: 'verification_uncovered', failureClass, ...captured,
      configurationRevision: build.configuration.configurationRevision,
      reason: `verification uncovered: no registered check covers required requirement(s) `
        + `${uncovered.map((entry) => entry.requirementId).join(', ')}; register a check that covers them` };
  }
  const exemption = reverifyExemption(predecessor);
  if (onlyIfSourceChanged && exemption === 'none' && build.identity.sourceDigest === predecessor.identity.sourceDigest) {
    return { code: 'source_unchanged', failureClass, ...captured, configurationRevision: null,
      reason: `source unchanged: the workspace is the source round ${predecessor.ref.roundId} checked; change the work first` };
  }
  const matched = exemption === 'none' ? (predecessor.chain?.basisDigests ?? []).indexOf(basis.digest) : -1;
  if (matched >= 0) {
    return { code: 'no_new_basis', failureClass, ...captured, configurationRevision: build.configuration.configurationRevision,
      reason: `no new basis: same failure, source and configuration as the reverify that opened round ${matched + 2} `
        + 'of this chain; supply new input or change the method' };
  }
  return null;
}

/**
 * VR-14/VR-15 (C5): either the successor @1 of the finalized non-PASS head
 * (`buildSuccessorRound`: ordinal + 1, the chain linked to the predecessor,
 * the configured executor), with the slot moved from the head to the
 * successor (a legacy slot-less head: `null → successor`) and the predecessor
 * guarded as read, never written; or a committed policy refusal (TASK-28)
 * with the predecessor and its slot held by the same owner, so a refusal and
 * a successor (or a requeue, VR-09) commit at most once. The refusal pin, the
 * new inputs and the capture are the owner's steps between the calls.
 */
function roundOnReverified(
  state: RoundSnapshot | null,
  event: Extract<RoundEvent, { kind: 'round_reverified' }>,
  ctx: RoundGuardContext,
): RoundTransition {
  if (state === null) return reject('illegal', 'not_found', 'round_reverified needs the predecessor round');
  const admission = reverifyAdmissionProblem(state, event.facts, ctx);
  if (admission !== null) return admission;
  const claimKey = roundSlotKey(roundSlotSubjectOf(state));
  const owner = state.chain === undefined ? null : roundSlotOwner(state.ref);
  const refused = (refusal: ReverifyRefusalV1): RoundTransition => accept(state, [
    { kind: 'guard_predecessor', ref: state.ref, revision: state.revision },
    { kind: 'guard_reverify_read_set' },
    { kind: 'claim_round_slot', claim: { claimKey, expectedOwner: owner, nextOwner: owner } },
    { kind: 'refuse_reverify', refusal },
  ]);
  const cap = reverifyCapRefusal(state, event.facts.actorClass, event.autoReworkLimit);
  if (cap !== null) return refused(cap);
  const successor = event.successor;
  if (successor === null) return reject('illegal', 'invalid', 'a successor round needs the capture and the compiled plan');
  if (successor.basis.subjectRunId !== state.subjectRunRef.runId || successor.basis.subject.taskId !== state.subject.taskId) {
    return reject('illegal', 'invalid', 'the reverify key was computed for another subject');
  }
  const checksProblem = roundOpenChecksProblem(successor.build.verificationPlan, successor.build.configuration);
  if (checksProblem !== null) return checksProblem;
  const policy = reverifyPolicyRefusal(state, successor, event.onlyIfSourceChanged);
  if (policy !== null) return refused(policy);
  const next = buildSuccessorRound({ predecessor: state, roundId: successor.roundId, build: successor.build,
    reverify: { requestedBy: successor.requestedBy, actorClass: event.facts.actorClass, requestedAt: successor.requestedAt,
      basis: successor.basis, newInputRefs: successor.newInputRefs, reason: successor.reason } });
  return accept(next, [
    { kind: 'guard_round', expectedRevision: null },
    { kind: 'guard_predecessor', ref: state.ref, revision: state.revision },
    { kind: 'guard_reverify_read_set' },
    { kind: 'claim_round_slot', claim: { claimKey, expectedOwner: owner, nextOwner: roundSlotOwner(next.ref) } },
    { kind: 'emit_event', eventType: 'VerificationRoundReverified' },
  ]);
}

/**
 * VR-01: the chain root @1 (`buildOpenedRound`, ordinal 1) and the slot claim
 * `null → roundKey` on the subject slot (work per subject Run, gate per gate,
 * VD-1/VD-15); the claim makes two concurrent opens commit at most once.
 */
function roundOnOpened(
  state: RoundSnapshot | null,
  event: Extract<RoundEvent, { kind: 'round_opened' }>,
  ctx: RoundGuardContext,
): RoundTransition {
  const admission = roundWriteAdmission(state, event, ctx);
  if (admission !== null) return admission;
  const problem = roundOpenProblem(event.facts, event.opening.subject)
    ?? roundOpenChecksProblem(event.opening.verificationPlan, event.opening.configuration);
  if (problem !== null) return problem;
  const round = buildOpenedRound(event.opening);
  return accept(round, [
    { kind: 'guard_round', expectedRevision: null },
    { kind: 'guard_open_read_set' },
    { kind: 'claim_round_slot', claim: { claimKey: roundSlotKey(roundSlotSubjectOf(round)), expectedOwner: null,
      nextOwner: roundSlotOwner(round.ref) } },
    { kind: 'emit_event', eventType: 'VerificationRoundOpened' },
  ]);
}

/**
 * VR-08 (and VR-10..12 through the index effect): an open round only (VD-2);
 * the round is not written but guarded as read, so a claim and a finalize do
 * not both commit.
 */
function roundOnEvidenceSubmitted(state: RoundSnapshot | null, ctx: RoundGuardContext): RoundTransition {
  const admission = roundWriteAdmission(state, { kind: 'evidence_submitted' }, ctx);
  if (admission !== null) return admission;
  const round = state as RoundSnapshot;
  const coverage = requiredRoundCoverage(round);
  if (coverage.length === 0) {
    return reject('guard_failed', 'incomplete', 'the round has no required verification coverage to attach a claim to');
  }
  return accept(round, [
    { kind: 'guard_round_unchanged', revision: round.revision },
    { kind: 'admit_claim_evidence', coverage },
    { kind: 'append_task_evidence_index' },
    { kind: 'emit_event', eventType: 'EvidenceAdmitted' },
  ]);
}

/** VR-07 with the D-2 fold and the read-set guard; the TaskEvidenceIndex follows VR-10..12. */
function roundOnFinalized(
  state: RoundSnapshot | null,
  event: Extract<RoundEvent, { kind: 'round_finalized' }>,
  ctx: RoundGuardContext,
): RoundTransition {
  const admission = roundWriteAdmission(state, event, ctx);
  if (admission !== null) return admission;
  const round = state as RoundSnapshot;
  const fold = finalizeRoundOutcome({ ...event.fold, round });
  if (fold.status === 'incomplete') return reject('guard_failed', 'incomplete', fold.detail);
  if (event.evidenceRefs.length !== fold.admissions.length) {
    return reject('illegal', 'invalid',
      `the finalize names ${event.evidenceRefs.length} evidence refs for ${fold.admissions.length} admissions`);
  }
  const admissions: VerdictAdmissionV1[] = fold.admissions.map((admission, index) => ({
    ref: event.evidenceRefs[index]!, checkId: admission.checkId, coverage: admission.coverage }));
  return accept(buildFinalizedRound(round, { outcome: fold.outcome, gaps: fold.gaps, evidenceRefs: [...event.evidenceRefs] }), [
    { kind: 'guard_round', expectedRevision: round.revision },
    { kind: 'guard_finalize_read_set' },
    { kind: 'admit_verdict_evidence', admissions },
    { kind: 'append_task_evidence_index' },
    { kind: 'emit_event', eventType: 'VerificationRoundFinalized' },
  ]);
}

// -------------------------------------------------------------------------- //
// Checks (§9.3 VR-02..VR-06, VR-13)                                           //
// -------------------------------------------------------------------------- //

export function transitionCheck(state: RoundSnapshot, event: CheckEvent, ctx: RoundGuardContext): CheckTransition {
  const admission = checkEventAdmission(state, event, ctx);
  if (admission !== null) return admission;
  switch (event.kind) {
    case 'check_begun': {
      // VR-02: the VD-9 Goal/subject guard (5.5), then the VD-8 markers.
      const problem = roundActivityProblem(event.activity, state.subject) ?? frozenBindingProblem(state, event.observed);
      if (problem !== null) return problem;
      return accept(withCheckPhase(state, event.checkId, { phase: 'executing', invocationId: event.invocationId }), [
        { kind: 'guard_round', expectedRevision: state.revision },
        { kind: 'guard_begin_read_set' },
        { kind: 'emit_event', eventType: 'VerificationCheckBegun' },
      ]);
    }
    case 'check_result_recorded': {
      // VR-03: an INCONCLUSIVE result carries its `outcomeFor` cause (C5).
      const verdict = outcomeFor(event.observation, event.sourceStatus);
      return accept(withCheckPhase(state, event.checkId, { phase: 'finished', outcome: verdict.outcome,
        reportRef: event.reportRef, sourceStatus: event.sourceStatus,
        ...(verdict.incompleteCause === null ? {} : { incompleteCause: verdict.incompleteCause }) }), [
        { kind: 'guard_round', expectedRevision: state.revision },
        { kind: 'emit_event', eventType: 'VerificationCheckResultRecorded' },
      ]);
    }
    case 'check_interrupted':
      switch (event.cause) {
        case 'host_restart':
          // D-18: another live Host keeps every fact unchanged.
          if (!ctx.instanceLeaseHeld) return reject('guard_failed', 'busy', 'another live Host holds the instance lease');
          // VR-04 (D-12): the lease takeover proves the old process (and its
          // `--die-with-parent` check process) gone; nothing is started, and the
          // check runs again only in a successor round (VR-14).
          return accept(withCheckPhase(state, event.checkId, { phase: 'interrupted', incompleteCause: 'host_restart' }), [
            { kind: 'guard_round', expectedRevision: state.revision },
            { kind: 'emit_event', eventType: 'VerificationCheckInterrupted' },
          ]);
        case 'ticket_invalid':
          // Without proof (for example an unknown execute error) the window stays executing for VR-04.
          if (event.ticketProblem === null) {
            return reject('guard_failed', 'unavailable', 'no proof that the ticket is invalid; the executing window waits for reconcile');
          }
          // VR-13: the ticket comes deterministically from the frozen values, so
          // the check never runs again in this round (D-12, VD-6).
          return accept(withCheckPhase(state, event.checkId, { phase: 'interrupted', incompleteCause: 'ticket_invalid' }), [
            { kind: 'guard_round', expectedRevision: state.revision },
            { kind: 'emit_event', eventType: 'VerificationCheckInterrupted' },
          ]);
        default: return unreachable(event, 'interruption cause');
      }
    case 'check_abandoned':
      if (!event.provenNotStarted) {
        return reject('guard_failed', 'unavailable', 'the process may have started; the executing window waits for reconcile');
      }
      // VR-05 (VD-6): no process ran, so the check returns to pending and a
      // later begin issues a new invocation.
      return accept(withCheckPhase(state, event.checkId, { phase: 'pending' }), [
        { kind: 'guard_round', expectedRevision: state.revision },
        { kind: 'emit_event', eventType: 'VerificationCheckAbandoned' },
      ]);
    default: return unreachable(event, 'check event');
  }
}

// -------------------------------------------------------------------------- //
// Small helpers                                                               //
// -------------------------------------------------------------------------- //

function sameRoundRef(left: VerificationRoundRef, right: VerificationRoundRef): boolean {
  return sameSubjectRef(left, right) && left.roundId === right.roundId;
}

/** Same subject (and anchored Run) of a chain: the ref without its roundId. */
function sameSubjectRef(left: VerificationRoundRef, right: VerificationRoundRef): boolean {
  return left.aggregateType === right.aggregateType && left.projectId === right.projectId
    && left.workspaceId === right.workspaceId && left.goalId === right.goalId
    && left.taskId === right.taskId && left.runId === right.runId;
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}
