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
 * (`roundWriteAdmission`, `roundOpenPointerProblem`, `roundOpenBasisProblem`,
 * `roundOpenSubjectProblem`, `checkEventAdmission`, `frozenBindingProblem`,
 * `finalizeRoundOutcome`) so the service can stop at the same point as today
 * before doing the next IO. Read failures, the scope checks of a read record
 * (configuration, Goal and Plan belong to the call scope) and the VR-01 Host
 * grant, workspace revision, capture and compile results stay with the
 * service (§1.1).
 *
 * A.2 step 2 (§15.2) scope:
 * - 已有/改造 rows return TODAY's result, records byte for byte as today's
 *   literals (`evidence-service.ts:486-487`, `:514-517`, `:706-707`,
 *   `:781-782`, `:1034-1038`). Not yet wired, flipped in step 5: the VR-01 slot,
 *   `chain` and VD-3/VD-9/requeue guards; the VR-02 VD-9 guard and VD-8 reason
 *   markers; the VR-03 `incompleteCause`; the D-2 target fold of VR-07 (FAIL,
 *   `interrupted_check`, PASS ⇒ no gaps); VD-2 on VR-08; VR-11 legacy @0 and
 *   VR-12 zero-append in `nextTaskEvidenceIndex`; the VR-05 and VR-13 writes.
 *   The facts only those guards read (Goal desired state and disposition for
 *   VD-9, the subject's chain for VD-1/VD-15, the TaskRequeue cover) are not
 *   in `RoundGuardContext`/`RoundOpenFactsV1` yet: today's services do not
 *   read them, and step 5 adds each with its row.
 * - 新增 rows keep their events in the unions: the guards of §9.4 that need only
 *   the round are implemented, the legal cell returns `illegal`/`invalid`
 *   (`notYet`). `round_reverified` (VR-14/15) and `task_requeued` (VR-09) need
 *   facts outside the round (chain, Goal, fences, TaskRequeue) and return
 *   `notYet` from every state.
 * - The chain helpers (`roundChainHead`, `chainEvidenceIds`,
 *   `reverifyExemption`, `reverifyFailureClass`, `buildSuccessorRound`,
 *   `evidenceSupersededByRequeue`), `outcomeFor`, `displayRoundStatus`,
 *   `roundTaskSignal`, `roundSlotKey` and `beginRefusalIsPermanent` are
 *   implemented in full: nothing calls them today, so they change no result.
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
import type { NewBasisInputRefV1 } from '../../../contracts/no-progress.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type {
  ReworkActorClass, ReworkFailureClass, TaskRequeueSnapshotV1,
} from '../../../contracts/task-requeue.js';
import type {
  CheckHostActor, CheckProcessObservation, ReverifyBasisV1, ReverifyExemption, RoundChainV1,
  RoundCheckIncompleteCause, RoundCheckSnapshot, RoundSnapshot, TrustedCheckConfiguration, VerificationPlanV1,
  VerificationRoundRef,
} from '../../../contracts/verification.js';
import { INTERRUPTED_CHECK_GAP_CODE, ROUND_CHAIN_MAX } from '../../../contracts/verification.js';
import type {
  VerificationRoundMaterialIdentity, VerificationRoundSourceProof,
} from '../../../contracts/verification-context.js';
import { roundFailureFacts } from './no-progress.js';
import { accept, notYet, reject, unreachable, type Rejected, type Transition } from './transition.js';

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
  | 'VerificationCheckReportBooked'
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
/** §15.3 names the same function `roundSubjectSlotKey`. */
export const roundSubjectSlotKey = roundSlotKey;

/** A gate round carries its declared kind in the frozen identity scope (`evidence-service.ts:494-496`). */
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
   * The caller is the round's frozen executor (`evidence-service.ts:672`, `:765`,
   * `:831`, `:905`); for `round_opened`, the trusted configuration's executor
   * (`:385-387`). Not read by the reconcile rows VR-04 (`host_restart`) and VR-06.
   */
  callerIsExecutor: boolean;
  /** The caller's `meta.expected` round revision; null when the operation pins none (`submitEvidence` today). */
  expectedRevision: number | null;
  /** The reconciling Host holds the D-18 instance lease (VR-04, VR-06); otherwise another live Host does. */
  instanceLeaseHeld: boolean;
  // Step 5.5 adds the VD-9 inputs (Goal desired state, subject disposition in
  // the Goal's current adopted Plan) with the VR-01/VR-02/VR-14 guards that read them.
};

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

/** How the subject relates to the subject Run (`evidence-service.ts:415-440`). */
export type RoundSubjectRelationV1 =
  | { kind: 'work'; runTaskIsSubject: boolean }
  | {
    kind: 'gate';
    gateSubject: 'goal' | 'stage' | 'module';
    /** The subject is an adopted gate of the declared scope kind (`:422-425`). */
    gateAdopted: boolean;
    /** `:426-436`, in that order. */
    producer: 'ok' | 'not_goal_work_run' | 'not_adopted_work' | 'other_workspace';
  };

/**
 * VR-01 facts read by the owner, in today's order: each group is known after
 * one read (Goal, Plan, Run) and has its own guard step. Step 5 adds the
 * subject's chain (VD-1, VD-15) and the TaskRequeue cover with their guards.
 */
export type RoundOpenFactsV1 = {
  /** After the Goal read: `Goal.activePlanRevision` equals the requested planRef (`:398-400`). */
  planIsActive: boolean;
  /** After the Plan read: the subject task has a resolved, supported task-state basis (`:407-410`). */
  taskBasisResolved: boolean;
  /** After the Run read (`:415-440`). */
  relation: RoundSubjectRelationV1;
  /** The subject (gate: producer) Run as read (`:411-414`). */
  subjectRun: Pick<RunSnapshot, 'status' | 'outcome' | 'reconciliation'>;
};

/** `evidenceApplicabilityWithBasis` for one finished check's verdict (`evidence-service.ts:978-983`). */
export type CheckVerdictDecisionV1 = { applicability: EvidenceApplicability; basis: string; reason: string };

/** The facts of the D-2 fold the owner reads (`evidence-service.ts:910-950`). */
export type RoundFoldFactsV1 = {
  /** checkId → decision for each finished check; null when the evidence or the adopted Plan is unreadable. */
  decisions: Readonly<Record<string, CheckVerdictDecisionV1>> | null;
  /** The current source still matches the frozen one under the frozen grant; false makes every verdict STALE. */
  sourceCurrent: boolean;
  /** `evidence_plan_unavailable`, `goal_unavailable`, `adopted_plan_unavailable`, `source_changed`, `source_unavailable`. */
  contextGaps: readonly RoundGapV1[];
};

export type RoundEvent =
  | { kind: 'round_opened'; opening: RoundOpeningV1; facts: RoundOpenFactsV1 }
  | { kind: 'evidence_submitted' }
  /** `evidenceRefs` are minted by the owner, one per admission of `finalizeRoundOutcome`, in that order. */
  | { kind: 'round_finalized'; reviewerEvidenceCount: number; fold: RoundFoldFactsV1; evidenceRefs: readonly EvidenceRef[] }
  /** VR-14/15 (新增, step 5.9): the request facts are added with the rows. */
  | { kind: 'round_reverified'; actorClass: ReworkActorClass }
  /** VR-09 (新增, step 5.4): the round side of a requeue of the chain head. */
  | { kind: 'task_requeued'; actorClass: ReworkActorClass };

/** The current Host values compared against the round's frozen binding (`evidence-service.ts:686-699`). */
export type FrozenBindingObservationV1 = { permissionRevision: string; workspaceRoot: string; sourceDigest: string };

/** What reconcile located for VR-06 (注 1): the identity and original values of the stored report(s). */
export type BookedReportFactsV1 = {
  roundRef: VerificationRoundRef;
  checkId: string;
  invocationId: string;
  outcome: EvidenceOutcome;
  sourceStatus: Exclude<CheckSourceStatus, null>;
  reportRef: ArtifactRef;
  /** Every body stored under `r3e-check-result-<invocationId>` has the same (sourceStatus, outcome). */
  bodiesAgree: boolean;
};

export type CheckEvent =
  | { kind: 'check_begun'; checkId: string; invocationId: string; observed: FrozenBindingObservationV1 }
  /** `sourceStatus` from the owner's `evaluateSource`; `reportRef` stored before the commit (`:773-780`). */
  | {
    kind: 'check_result_recorded'; checkId: string; invocationId: string;
    observation: CheckProcessObservation; sourceStatus: Exclude<CheckSourceStatus, null>; reportRef: ArtifactRef;
  }
  /** VR-04 (R): start-up reconcile under the instance lease. */
  | { kind: 'check_interrupted'; checkId: string; invocationId: string; cause: 'host_restart'; hostInstanceId: string }
  /** VR-13 (P): the runner's ticket is incomplete; `ticketProblem` is the proof (`check-execution.ts:108-109`). */
  | { kind: 'check_interrupted'; checkId: string; invocationId: string; cause: 'ticket_invalid'; ticketProblem: string | null }
  /** VR-05 (P): `provenNotStarted` is false once `execute` may have been called (VD-6). */
  | { kind: 'check_abandoned'; checkId: string; invocationId: string; cause: CheckAbandonCause; provenNotStarted: boolean }
  | { kind: 'check_report_booked'; checkId: string; invocationId: string; hostInstanceId: string; report: BookedReportFactsV1 };

/** The identity part of a check event that the pre-IO admission reads. */
export type CheckEventHead =
  | { kind: 'check_begun'; checkId: string }
  | { kind: 'check_result_recorded' | 'check_abandoned' | 'check_report_booked'; checkId: string; invocationId: string }
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
 * - `guard_round`: the round CAS (`null` = the key must not exist);
 * - `guard_open_read_set`: Goal, adopted Plan, Workspace, subject Run, pinned
 *   policy and baseline as read (`evidence-service.ts:533-541`);
 * - `claim_round_slot`: the chain slot CAS (VR-01, VR-14; step 5);
 * - `admit_claim_evidence` / `admit_verdict_evidence`: Evidence@1 rows, each
 *   CAS null (VR-08, VR-07);
 * - `append_task_evidence_index`: the admitted ids through `nextTaskEvidenceIndex`;
 * - `emit_event`: the durable round event.
 */
export type VerificationEffect =
  | { kind: 'guard_round'; expectedRevision: number | null }
  | { kind: 'guard_open_read_set' }
  | { kind: 'claim_round_slot'; claim: RoundSlotClaimV1 }
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
 * `outcomeFor` (`evidence-service.ts:329-335`) with the C5 cause of an
 * INCONCLUSIVE result, in the same order (VR-03). PASS/FAIL carry no cause.
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

/** The required coverage a claim attaches to (`collectRequiredCoverage`, `evidence-service.ts:1075-1093`). */
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
  const facts = roundFailureFacts(predecessor);
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
  const previousAutoCount = predecessor.chain?.autoCount ?? 0;
  const autoCount = reverify.actorClass === 'human' ? 0
    : exemption === 'host_interruption' ? previousAutoCount : previousAutoCount + 1;
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

/**
 * `finalizeRoundOutcome` with TODAY's fold (`evidence-service.ts:952-1030`):
 * - an `executing` or `interrupted` check refuses the fold (`incomplete`);
 * - gaps in plan-check order: `missing_check`, `pending_check`,
 *   `evidence_<basis>` for a non-applicable verdict; then
 *   `uncovered_requirement`; then the context gaps;
 * - every verdict is STALE when the source is not current; OUT_OF_SCOPE
 *   without a gap when a Plan is unreadable (`decisions = null`);
 * - INCONCLUSIVE when a required requirement has an applicable FAIL or
 *   INCONCLUSIVE blocker or no applicable PASS, otherwise PASS, gaps or not;
 * - admissions: the applicable PASS coverage per requirement, then every
 *   blocker, in `selectEffectiveEvidenceSet` order (`coverage.ts:76-121`).
 * Step 5.3 flips it to the D-2 target: `interrupted` → gap
 * `interrupted_check`, an applicable FAIL → FAIL, PASS ⇒ `gaps = []`.
 */
export function finalizeRoundOutcome(input: RoundFoldInputV1): RoundFoldResultV1 {
  const { round } = input;
  const gaps: RoundGapV1[] = [];
  const candidates: { checkId: string; outcome: EvidenceOutcome; coverage: readonly EvidenceCoverageV1[];
    applicability: EvidenceApplicability }[] = [];
  for (const planCheck of round.verificationPlan.checks) {
    const check = round.checks.find((candidate) => candidate.checkId === planCheck.checkId);
    if (check === undefined) {
      gaps.push({ code: 'missing_check', message: `the round is missing required check ${planCheck.checkId}` });
      continue;
    }
    const first = planCheck.coverage[0];
    const firstCoverage = first === undefined ? {} : { coverage: { ...first } };
    switch (check.phase) {
      case 'executing':
      case 'interrupted':
        return { status: 'incomplete', detail: `the check ${check.checkId} is ${check.phase}; its result window is not reconciled` };
      case 'pending':
        gaps.push({ code: 'pending_check', message: `the required check ${check.checkId} never ran`, ...firstCoverage });
        continue;
      case 'finished':
        break;
      default: return unreachable(check.phase, 'check phase');
    }
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
  return { status: 'folded', outcome: blocked || missing ? 'INCONCLUSIVE' : 'PASS', gaps, admissions };
}

// -------------------------------------------------------------------------- //
// Record constructors (§14.1)                                                 //
// -------------------------------------------------------------------------- //

/** The pending checks of a compiled plan, or the first check the frozen configuration does not register (`:482-488`). */
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
 * VR-01: open@1 with every check `pending` and the uncovered requirements as
 * gaps, in today's key order (`evidence-service.ts:511-517`). Today's round
 * has no `chain`; step 5.3 adds `rootRoundChain()` here (C5). Every compiled
 * check must be registered (`transitionRound` refuses otherwise).
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
    checks: checks.checks, status: 'open', outcome: null, gaps, evidenceRefs: [] };
}

/** The one write of a check's lifecycle fields (§14.1); `incompleteCause` is written only through here. */
export type CheckPhaseChange =
  /** VR-02 (`evidence-service.ts:706-707`). */
  | { phase: 'executing'; invocationId: string }
  /** VR-03, VR-06 (`:781-782`); today's VR-03 leaves `incompleteCause` out (step 5.3 passes it). */
  | {
    phase: 'finished'; outcome: EvidenceOutcome; reportRef: ArtifactRef; sourceStatus: Exclude<CheckSourceStatus, null>;
    incompleteCause?: RoundCheckIncompleteCause | null;
  }
  /** VR-04, VR-13: the invocation is kept, the result fields stay null. */
  | { phase: 'interrupted'; incompleteCause: CheckInterruptionCause }
  /** VR-05: back to pending, the invocation and any cause cleared. */
  | { phase: 'pending' };

/**
 * The one phase each change leaves (§9.3): VR-02 pending → executing; VR-03,
 * VR-06 executing → finished; VR-04, VR-13 executing → interrupted; VR-05
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
 * VR-07 (`evidence-service.ts:1037-1038`). Only legal combinations (§9.1,
 * §14): the round is open (§9.4: a finalized round never rewrites its
 * outcome) and no check is `executing` (I-7). An `interrupted` check is
 * allowed: the D-2 target of step 5.3 counts it as a gap. The transitions
 * refuse both cases first, so a throw here is a caller bug.
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

/** The index of the subject task (`evidence-service.ts:1103-1104`); a gate round writes the gate's own index. */
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
 * VR-10..VR-12 with TODAY's results (`evidence-service.ts:846-850`,
 * `:1034-1045`): revision = stored ids + appended, CAS null when the read
 * revision is 0 (missing row or legacy @0 row alike), and a write even when
 * nothing is appended. Step 5.3 flips VR-11 (a stored @0 row is guarded at 0)
 * and VR-12 (`{write:false}` for zero appended ids).
 */
export function nextTaskEvidenceIndex(current: TaskEvidenceIndexReadV1, appended: readonly string[]): TaskEvidenceIndexWrite {
  const record: TaskEvidenceIndexSnapshot = { ref: current.ref, revision: current.evidenceIds.length + appended.length,
    schemaVersion: 1, evidenceIds: [...current.evidenceIds, ...appended] };
  return { write: true, record, expectedRevision: current.revision === 0 ? null : current.revision };
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
 * (`:385-387`; the round key must be absent), `evidence_submitted`
 * (`:828-831`) and `round_finalized` (`:882-907`, the reviewer evidence before
 * anything else).
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
        // VR-08 today: a finalized round still accepts a claim (VD-2 flips it to `busy` in step 5.3).
        case 'finalized': break;
        default: return unreachable(state.status, 'round status');
      }
      if (!ctx.callerIsExecutor) return reject('guard_failed', 'forbidden', 'the evidence author is not the round executor');
      return null;
    case 'round_finalized':
      if (head.reviewerEvidenceCount > 0) {
        return reject('guard_failed', 'unsupported', 'reviewer evidence finalization is not implemented in R3e.1');
      }
      if (state === null) return reject('illegal', 'invalid', 'round_finalized needs an existing round');
      switch (state.status) {
        case 'open': break;
        case 'finalized': return reject('illegal', 'busy', 'the round is already finalized');
        default: return unreachable(state.status, 'round status');
      }
      if (!ctx.callerIsExecutor) return reject('guard_failed', 'forbidden', 'the finalizer is not the round executor');
      if (pinIsStale(state, ctx)) return staleRound();
      return null;
    default: return unreachable(head, 'round event head');
  }
}

/**
 * VR-01 subject guards in today's order, one step per read so the owner
 * stops where it stops today: the plan pointer after the Goal read
 * (`roundOpenPointerProblem`), the task basis after the Plan read
 * (`roundOpenBasisProblem`), the subject relation and Run end after the Run
 * read (`roundOpenSubjectProblem`). Step 5 adds VD-3 (`completed`,
 * reconciliation done), the TaskRequeue cover, VD-1/VD-15 (`busy`) and VD-9.
 */
export function roundOpenProblem(facts: RoundOpenFactsV1, subject: TaskTriple): Rejected | null {
  return roundOpenPointerProblem(facts.planIsActive)
    ?? roundOpenBasisProblem(facts.taskBasisResolved, subject)
    ?? roundOpenSubjectProblem(facts, subject);
}

/** `:398-400`; `source_stale` is kept (§9.4), VD-7 makes the Workflow pass the current Plan. */
export function roundOpenPointerProblem(planIsActive: boolean): Rejected | null {
  return planIsActive ? null : reject('stale', 'source_stale', 'the requested planRef is not the Goal current adopted Plan');
}

/** `:407-410`: the subject task has a resolved, supported task-state basis in the requested Plan. */
export function roundOpenBasisProblem(taskBasisResolved: boolean, subject: TaskTriple): Rejected | null {
  return taskBasisResolved ? null
    : reject('guard_failed', 'incomplete', `the subject task ${subject.taskId} has no resolved task-state basis`);
}

/** `:415-441`: the subject relation (work or gate), then the Run has formally ended. */
export function roundOpenSubjectProblem(
  facts: Pick<RoundOpenFactsV1, 'relation' | 'subjectRun'>,
  subject: TaskTriple,
): Rejected | null {
  const relation = facts.relation;
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
  if (facts.subjectRun.status !== 'ended') return reject('guard_failed', 'forbidden', 'the subject Run has not formally ended');
  return null;
}

/**
 * Pre-IO guards of the check writes. Today's order for `check_begun`
 * (`:671-678`): finalized, executor, checkId, pin, phase. For the writes on an
 * executing check (`:764-771`): finalized, executor, checkId, phase,
 * invocation, pin. The reconcile rows (VR-04 `host_restart`, VR-06) skip the
 * executor check: their guard is the instance lease.
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
  const reconcile = head.kind === 'check_report_booked' || (head.kind === 'check_interrupted' && head.cause === 'host_restart');
  if (!reconcile && !ctx.callerIsExecutor) return reject('guard_failed', 'forbidden', 'the check executor is not the round executor');
  const check = state.checks.find((candidate) => candidate.checkId === head.checkId);
  if (check === undefined) return reject('illegal', 'invalid', `the round has no registered check ${head.checkId}`);
  if (head.kind === 'check_begun') {
    if (pinIsStale(state, ctx)) return staleRound();
    switch (check.phase) {
      case 'pending': return null;
      // `:677`; an interrupted check never runs again in the same round (D-12).
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
        case 'check_report_booked':
          return reject('illegal', 'invalid', notExecuting);
        default: return unreachable(head, 'check event head');
      }
    case 'finished':
      switch (head.kind) {
        case 'check_result_recorded':
        case 'check_report_booked':
          return reject('illegal', 'busy', notExecuting);
        case 'check_interrupted':
        case 'check_abandoned':
          return reject('illegal', 'invalid', notExecuting);
        default: return unreachable(head, 'check event head');
      }
    case 'interrupted':
      switch (head.kind) {
        // A late result or a report found afterwards is history only (D-12).
        case 'check_result_recorded':
        case 'check_report_booked':
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
 * VR-02 comparisons with the round's frozen binding, in today's order
 * (`:690-699`): Host permission revision, workspace root, then (after the
 * capture) the source digest. `sourceDigest` may be left out to compare only
 * the first two before capturing. Step 5.3 prefixes the VD-8 markers.
 */
export function frozenBindingProblem(
  round: RoundSnapshot,
  observed: Omit<FrozenBindingObservationV1, 'sourceDigest'> & { sourceDigest?: string },
): Rejected | null {
  if (observed.permissionRevision !== round.configuration.permissionRevision) {
    return reject('guard_failed', 'forbidden', 'the current Host permission revision is not the trusted configuration binding');
  }
  if (observed.workspaceRoot !== round.identity.workspaceRoot) {
    return reject('guard_failed', 'source_stale', 'the current workspace root is not the round fixed root');
  }
  if (observed.sourceDigest !== undefined && observed.sourceDigest !== round.identity.sourceDigest) {
    return reject('guard_failed', 'source_stale', 'the current verification source is not the round fixed source');
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
    case 'round_reverified': return notYet('VR-14/VR-15 (round_reverified)');
    case 'task_requeued': return notYet('VR-09 (task_requeued)');
    default: return unreachable(event, 'round event');
  }
}

/** VR-01 with today's result: no slot, no `chain`, a second open on the same subject still commits. */
function roundOnOpened(
  state: RoundSnapshot | null,
  event: Extract<RoundEvent, { kind: 'round_opened' }>,
  ctx: RoundGuardContext,
): RoundTransition {
  const admission = roundWriteAdmission(state, event, ctx);
  if (admission !== null) return admission;
  const problem = roundOpenProblem(event.facts, event.opening.subject);
  if (problem !== null) return problem;
  const checks = pendingRoundChecks(event.opening.verificationPlan, event.opening.configuration);
  if (!checks.ok) return reject('guard_failed', 'incomplete', `the compiled plan names an unregistered check ${checks.checkId}`);
  return accept(buildOpenedRound(event.opening), [
    { kind: 'guard_round', expectedRevision: null },
    { kind: 'guard_open_read_set' },
    { kind: 'emit_event', eventType: 'VerificationRoundOpened' },
  ]);
}

/** VR-08 (and VR-10..12 through the index effect), today: any round status, no round guard. */
function roundOnEvidenceSubmitted(state: RoundSnapshot | null, ctx: RoundGuardContext): RoundTransition {
  const admission = roundWriteAdmission(state, { kind: 'evidence_submitted' }, ctx);
  if (admission !== null) return admission;
  const round = state as RoundSnapshot;
  const coverage = requiredRoundCoverage(round);
  if (coverage.length === 0) {
    return reject('guard_failed', 'incomplete', 'the round has no required verification coverage to attach a claim to');
  }
  return accept(round, [
    { kind: 'admit_claim_evidence', coverage },
    { kind: 'append_task_evidence_index' },
    { kind: 'emit_event', eventType: 'EvidenceAdmitted' },
  ]);
}

/** VR-07 with today's fold; the TaskEvidenceIndex follows VR-10..12. */
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
      // VR-02 today: no VD-9 Goal/disposition guard and no VD-8 markers (step 5.3, 5.5).
      const problem = frozenBindingProblem(state, event.observed);
      if (problem !== null) return problem;
      return accept(withCheckPhase(state, event.checkId, { phase: 'executing', invocationId: event.invocationId }), [
        { kind: 'guard_round', expectedRevision: state.revision },
        { kind: 'emit_event', eventType: 'VerificationCheckBegun' },
      ]);
    }
    case 'check_result_recorded': {
      // VR-03 today: the outcome is written without its `incompleteCause` (step 5.3).
      const verdict = outcomeFor(event.observation, event.sourceStatus);
      return accept(withCheckPhase(state, event.checkId, { phase: 'finished', outcome: verdict.outcome,
        reportRef: event.reportRef, sourceStatus: event.sourceStatus }), [
        { kind: 'guard_round', expectedRevision: state.revision },
        { kind: 'emit_event', eventType: 'VerificationCheckResultRecorded' },
      ]);
    }
    case 'check_interrupted':
      switch (event.cause) {
        case 'host_restart':
          // D-18: another live Host keeps every fact unchanged.
          if (!ctx.instanceLeaseHeld) return reject('guard_failed', 'busy', 'another live Host holds the instance lease');
          return notYet('VR-04');
        case 'ticket_invalid':
          // Without proof (for example an unknown execute error) the window stays executing for VR-04.
          if (event.ticketProblem === null) {
            return reject('guard_failed', 'unavailable', 'no proof that the ticket is invalid; the executing window waits for reconcile');
          }
          return notYet('VR-13');
        default: return unreachable(event, 'interruption cause');
      }
    case 'check_abandoned':
      if (!event.provenNotStarted) {
        return reject('guard_failed', 'unavailable', 'the process may have started; the executing window waits for reconcile');
      }
      return notYet('VR-05');
    case 'check_report_booked': {
      if (!ctx.instanceLeaseHeld) return reject('guard_failed', 'busy', 'another live Host holds the instance lease');
      const report = event.report;
      if (!sameRoundRef(report.roundRef, state.ref) || report.checkId !== event.checkId || report.invocationId !== event.invocationId) {
        return reject('guard_failed', 'invalid', 'the located report does not belong to this check invocation');
      }
      if (!report.bodiesAgree) {
        return reject('guard_failed', 'invalid', 'the located report bodies disagree; the check is reconciled as interrupted (VR-04)');
      }
      return notYet('VR-06');
    }
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
