/**
 * PlanProposal state machine and PlanRevision derivations (docs/refactor/STATE-MACHINES-SPEC.md
 * §3, rows PLAN-01..PLAN-09; forbidden transitions §3.4; the W16 guards of §3.3).
 *
 * A candidate is the only mutable plan record: `candidate → accepted` and the
 * new immutable PlanRevision@1 and the Goal pointer move are ONE commit
 * (PLAN-04/05 with GOAL-02/03 and PLAN-08/09). "stale", "adopted" and
 * "superseded" are never stored: they are derived from the Goal pointer
 * (`derivePlanProposalStatus`, `derivePlanRevisionStatus`). `rejected` is
 * declared but has no writer (D-17, PLAN-07).
 *
 * Pure: the owner (`tasks/plan-service.ts`) looks up the receipt first, reads
 * the proposal, the Goal scope, the source/target Plans and the Task facts, runs
 * the draft validators that live in `tasks/plan-validation.ts` (this directory
 * may not import them, §14.4) and hands their results in through
 * `PlanProposalGuardContext`. The checks run in today's service order, so the
 * first failing guard returns today's CoreError (§1.2). After each read the
 * owner asks `planProposalProblem` with the facts read so far (an unread fact
 * holds), so a refusal stops its reads where they always stopped; the
 * accepted transition then names the records, the event and the CAS guards of
 * the one commit. Read failures (not_found/unavailable/corrupt of a record the
 * service needed) stay with the service, as do the input-shape checks it makes
 * before the receipt lookup.
 *
 * Step 2 (§15.2) implements the pre-A.2 results; step 5.5 adds the Goal
 * `cancelled` guard (D-9, `scopeStep`). Step 5.10 (C7, lead decision LA-3)
 * adds the `affectedTaskIds` shape and draft `dispositionRecord` checks of
 * PLAN-01/02 (`reasonShapeStep`), and splits W16 into changed and
 * disposition-only Tasks: the untraced rule for the changed and added ones,
 * TASK-19 (`tracedDispositionChangeProblem`) for the traced disposition-only
 * ones, then guard 9 (`parallelCarrierFenceProblem`) for an `agent`/`system`
 * adopter. Each disposition change of the adoption is named as a
 * `change_task_disposition` effect, which the owner asks the Task machine
 * (TASK-18/19) about, as it asks the Goal machine about `move_goal_pointer`.
 *
 * `PlanProposal` is declared in `tasks/plan-contracts.ts:28-50`, which this
 * directory may not import. `PlanProposalRecord` below is the same shape built
 * from `src/contracts` types only; tests/state/plan-machine.test.ts asserts the
 * two types are identical.
 *
 * The `plan-service.ts`, `plan-commit-compiler.ts` and `plan-readers.ts` line
 * references below cite the pre-step-3 worktree (2026-10-02, as the spec does).
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { ControlIntentSnapshotV1 } from '../../../contracts/control-intent.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection } from '../../../contracts/core/results.js';
import type { PlanWriteProvenanceV1 } from '../../../contracts/delegated-write.js';
import type { RoleBindingRefV1, RunRef, RunSnapshot, TaskLeaseSnapshot } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { PlanProposalSnapshot } from '../../../contracts/goal-change.js';
import type { GoalDesiredState, GoalRef } from '../../../contracts/ledger.js';
import type {
  AcceptanceObligation, Disposition, PlanRevisionDraft, PlanRevisionRef, PlanValidationError, RuntimeTask,
} from '../../../contracts/plan.js';
import type { TaskReductionSnapshot } from '../../../contracts/reduction.js';
import type { ReworkActorClass } from '../../../contracts/task-requeue.js';
import { runUnresolvedBlocker } from './run-machine.js';
import { reworkFenceOf } from './task-failure.js';
import {
  accept, reject, rejected, unreachable, type Rejected, type Transition, type TransitionRejectReason,
} from './transition.js';

// --------------------------------------------------------------------------
// Persisted record (structurally identical to tasks/plan-contracts.ts:28-50)
// --------------------------------------------------------------------------

/** Same full identity as legacy PlanProposal@1 (`plan-contracts.ts:28-29`). */
export type PlanProposalRef = { aggregateType: 'PlanProposal'; projectId: string; workspaceId: string; proposalId: string };

/** `plan-contracts.ts:30-35`; `affectedTaskIds` is the optional C7 list. */
export type PlanChangeReason = { text: string; sources: ArtifactRef[]; affectedTaskIds?: string[] };

/** `plan-contracts.ts:37-44`. Only `status` is protected (§14.1). */
export type CandidatePlanProposal = {
  kind: 'candidate_v2'; ref: PlanProposalRef; revision: number; schemaVersion: 2;
  goalRef: GoalRef; basedOn: PlanRevisionRef | null; draft: PlanRevisionDraft;
  reason: PlanChangeReason; status: 'candidate' | 'accepted' | 'rejected';
  issues: PlanValidationError[];
  /** W2 Agent branch only; absent on every legacy/Host candidate. */
  submittedBy?: PlanWriteProvenanceV1;
};

/** `plan-contracts.ts:45-47`: read-only; always `candidate` (`plan-record-codecs.ts:752`). */
export type LegacyPlanProposal = {
  kind: 'legacy_v1'; ref: PlanProposalRef; revision: 1; schemaVersion: 1;
  goalRef: GoalRef; basedOn: PlanRevisionRef; draft: null;
  legacy: PlanProposalSnapshot; status: 'candidate'; issues: PlanValidationError[];
};

/** `PlanProposal` (`plan-contracts.ts:36-47`). */
export type PlanProposalRecord = CandidatePlanProposal | LegacyPlanProposal;

// --------------------------------------------------------------------------
// Record constructors (§14.1: the only writers of `PlanProposal.status`)
// --------------------------------------------------------------------------

/**
 * PLAN-01..03: a new `candidate@1` (pre-step-3 `plan-service.ts:965-967` and
 * `:1974-1977`). Key order matches today's record bytes; `submittedBy` is
 * present only on an Agent candidate.
 */
export function newCandidateProposal(input: {
  ref: PlanProposalRef;
  goalRef: GoalRef;
  basedOn: PlanRevisionRef | null;
  draft: PlanRevisionDraft;
  reason: PlanChangeReason;
  issues: PlanValidationError[];
  submittedBy: PlanWriteProvenanceV1 | null;
}): CandidatePlanProposal {
  const candidate: CandidatePlanProposal = { kind: 'candidate_v2', ref: input.ref, revision: 1, schemaVersion: 2,
    goalRef: input.goalRef, basedOn: input.basedOn, draft: input.draft, reason: input.reason,
    status: 'candidate', issues: input.issues };
  return input.submittedBy === null ? candidate : { ...candidate, submittedBy: input.submittedBy };
}

/** PLAN-04/05: the accepted candidate, revision + 1 (pre-step-3 `plan-commit-compiler.ts:145-149,294-298`). */
export function acceptProposalRecord(proposal: CandidatePlanProposal): CandidatePlanProposal {
  return { ...proposal, revision: proposal.revision + 1, status: 'accepted' };
}

// --------------------------------------------------------------------------
// Derived status and the adoption target (PLAN-06, PLAN-08/09)
// --------------------------------------------------------------------------

export type PlanProposalReadStatus = 'candidate' | 'stale' | 'accepted' | 'rejected';

/**
 * PLAN-06: a stored `candidate` whose `basedOn` is not the Goal active plan
 * reads as `stale` (`plan-readers.ts:483-487`). Whether it can become pending
 * again depends on `basedOn` (§3.1): never when it is null or an existing older
 * version; yes when it names a planId adopted later (GAP-14). A legacy
 * candidate follows the same rule but is never selected as pending: the pending
 * read also requires `kind:'candidate_v2'` (`plan-readers.ts:479`).
 */
export function derivePlanProposalStatus(
  proposal: PlanProposalRecord,
  activePlanRevision: PlanRevisionRef | null,
): PlanProposalReadStatus {
  switch (proposal.status) {
    case 'accepted':
    case 'rejected':
      return proposal.status;
    case 'candidate':
      return samePlanPointer(proposal.basedOn, activePlanRevision) ? 'candidate' : 'stale';
    default:
      return unreachable(proposal, 'plan proposal status');
  }
}

export type PlanRevisionStatus = 'adopted' | 'superseded';

/**
 * PLAN-08/09: a PlanRevision is written only together with the pointer move
 * onto it, and the pointer only moves forward (source = active, target =
 * source+1 and absent). So an existing revision is `adopted` while the Goal
 * points at it and `superseded` once the pointer moved on.
 */
export function derivePlanRevisionStatus(
  planRef: PlanRevisionRef,
  activePlanRevision: PlanRevisionRef | null,
): PlanRevisionStatus {
  return samePlanPointer(planRef, activePlanRevision) ? 'adopted' : 'superseded';
}

/**
 * PLAN-08: the PlanRevision an adoption writes (the draft's planId in the
 * proposal's project), which GOAL-02/03 move the pointer onto. The future
 * owner reads it first: its absence is PLAN-05's `targetExists` fact.
 */
export function planRevisionTargetOf(proposalRef: PlanProposalRef, draft: PlanRevisionDraft): PlanRevisionRef {
  return { aggregateType: 'PlanRevision', projectId: proposalRef.projectId, planId: draft.planId };
}

// --------------------------------------------------------------------------
// PlanProposal machine: state, events, guard context, effects (§3.1, §3.2)
// --------------------------------------------------------------------------

/** `null` = ∅ (no record under the proposal ref), otherwise the decoded record. */
export type PlanProposalMachineState = PlanProposalRecord | null;

/** Host `proposePlan`; Agent `propose_future_plan`; Workflow/Host initial answer (`proposeInitialPlanFromAnswer`). */
export type PlanProposalWriter = 'host' | 'agent' | 'initial_answer';

/** Host `applyPlanChange`; Agent `apply_future_plan` (`applyPlanChangeAsAgent`). */
export type PlanAdopter = 'host' | 'agent';

/** The identified Agent writer (`plan-write-admission.ts:74-81`, without the actor). */
export type AgentPlanWriterIdentity = {
  runRef: RunRef;
  sessionRef: SessionRef;
  roleBinding: RoleBindingRefV1;
  goalRef: GoalRef;
};

/**
 * §3.2. `proposal_recorded.issues` is `validatePlanDraft(draft, policy)`:
 * diagnostics recorded on the candidate, never blocking (PLAN-01).
 * `submittedBy` is the admitted provenance, present only for the Agent writer.
 * `proposal_accepted.agentWriter` is the identified writer, present only for
 * the Agent adopter. `proposal_stale` is derived at read time;
 * `proposal_rejected` has no writer (D-17).
 */
export type PlanProposalEvent =
  | {
    type: 'proposal_recorded';
    writer: PlanProposalWriter;
    ref: PlanProposalRef;
    goalRef: GoalRef;
    basedOn: PlanRevisionRef | null;
    draft: PlanRevisionDraft;
    reason: PlanChangeReason;
    issues: PlanValidationError[];
    submittedBy: PlanWriteProvenanceV1 | null;
  }
  | {
    type: 'proposal_accepted';
    adopter: PlanAdopter;
    proposalRef: PlanProposalRef;
    expectedProposalRevision: number;
    decisionRefs: readonly VersionPin[];
    agentWriter: AgentPlanWriterIdentity | null;
  }
  | { type: 'proposal_stale' }
  | { type: 'proposal_rejected' };

/** The source PlanRevision read through `basedOn`. */
export type PlanSourceFacts = { ref: PlanRevisionRef; goalRef: GoalRef; planId: string; planRevision: number };

/**
 * C7: an existing Task whose `disposition` or `replacedByTaskId` changes in a
 * future adoption (`deriveFuturePlanDelta`); `from === to` re-points a
 * superseded Task's replacement.
 */
export type FutureDispositionChangeV1 = { taskId: string; from: Disposition; to: Disposition; replacedByTaskId: string | null };

/** C7 (§3.3 无痕规则): a changed Task that left these source obligations' `taskIds`. */
export type FutureCarrierRemovalV1 = { taskId: string; obligationIds: readonly string[] };

/**
 * `deriveFuturePlanDelta` (`plan-validation.ts`). C7 (step 5.10) splits the
 * existing Tasks into changed (execution definition) and disposition-only
 * ones; `dispositionChanges` lists every existing Task whose `disposition` or
 * `replacedByTaskId` changes, changed or disposition-only, in taskId order.
 */
export type FuturePlanDeltaVerdict =
  | { status: 'supported'; changedTaskIds: readonly string[]; addedTaskIds: readonly string[];
    dispositionOnlyTaskIds: readonly string[]; dispositionChanges: readonly FutureDispositionChangeV1[];
    carrierRemovals: readonly FutureCarrierRemovalV1[] }
  | { status: 'unsupported'; reason: string };

/** `validateFutureObligationCoverage` (`plan-validation.ts:349-511`). */
export type FutureCoverageVerdict =
  | { status: 'supported' }
  | { status: 'rejected'; issues: readonly PlanValidationError[] }
  | { status: 'unsupported'; reason: string };

/** The draft admission validators of `plan-validation.ts`, run by the service. */
export type PlanDraftAdmissionFacts = {
  /** `validatePlanDraft(draft, policy)`. */
  draftIssues: readonly PlanValidationError[];
  /** `validatePlanAssignments(draft)`. */
  assignmentReasons: readonly string[];
  /** `planPhaseGuardReasons(draft.tasks)`. */
  phaseReasons: readonly string[];
};

/** PLAN-04 facts (`plan-service.ts:1171-1185`). */
export type InitialAdoptionFacts = PlanDraftAdmissionFacts & {
  /** `verifyModelCoordinationDraft`; `'ok'` when the draft has no `origin`. */
  origin: 'ok' | CoreRejection;
  /** `resolveGovernance`. */
  governance: 'ok' | CoreRejection;
};

/** PLAN-05 facts (`plan-service.ts:1727-1771`). */
export type FutureAdoptionFacts = PlanDraftAdmissionFacts & {
  /** A PlanRevision record already exists under the target planId. */
  targetExists: boolean;
  delta: FuturePlanDeltaVerdict;
  coverage: FutureCoverageVerdict;
  /** `readPinnedCompletionPolicy`, read only when the draft adds an obligation. */
  pinnedPolicy: 'not_needed' | 'ok' | CoreRejection;
  /** `readFutureChangeTaskFacts` for `changedTaskIds ∪ addedTaskIds`. */
  touchedTaskFacts: readonly FutureChangeTaskFactsV1[];
  /**
   * C7: `reworkActorClassOf(principal, actor)` of the adopter (§1): an Agent
   * `apply_future_plan` is `agent`; a Host actor that is a platform automation
   * actor is `system`; every other Host actor (a Host started as
   * `kind:'system'` too) is `human`.
   */
  adopterClass: ReworkActorClass;
  /** C7: `readDispositionChangeTaskFacts` for `dispositionOnlyTaskIds` (TASK-19). */
  dispositionTaskFacts: readonly TracedTaskFactsV1[];
  /** Guard 9 (LA-3): the source Plan's carriers, read with the source. */
  sourceCarriers: PlanCarrierViewV1;
  /**
   * Guard 9: the facts of `parallelCarrierFactTaskIds`, read only for an
   * `agent`/`system` adopter (an operator adoption is never limited by it).
   */
  carrierFacts: readonly TracedTaskFactsV1[];
};

/** §2.4/§3.4 (D-9): the refusal of every plan write on a cancelled Goal (shared with GOAL-02/03 and TASK-19 guard 8). */
export const GOAL_CANCELLED_PLAN_DETAIL = 'the Goal is cancelled; its plan can no longer change';

/**
 * What the service read and validated. Sections an event does not use are
 * `null`. `goal.desiredState` is read for D-9 (step 5.5): a cancelled Goal
 * records and adopts no Plan; a paused one does (W16 is not rework).
 */
export type PlanProposalGuardContext = {
  /** The Goal read in this call (`readGoalScope`). */
  goal: { activePlanRevision: PlanRevisionRef | null; desiredState: GoalDesiredState };
  /** The Goal belongs to the bound workspace (propose) / the proposal workspace (apply). */
  goalInWorkspace: boolean;
  /** `compareCallerPlanPins`: the caller's pins equal the versions read in this call. */
  pinsAgree: boolean;
  /** Agent writes only: the fresh `authorizePlanWrite` verdict (`plan-write-admission.ts:247-324`); null for the Host. */
  agentAdmission: 'ok' | CoreRejection | null;
  /** The source Plan read through `basedOn` (Agent propose, every future adoption). */
  source: PlanSourceFacts | null;
  /** `proposal_accepted` with `basedOn = null` (PLAN-04). */
  initial: InitialAdoptionFacts | null;
  /** `proposal_accepted` with `basedOn ≠ null` (PLAN-05). */
  future: FutureAdoptionFacts | null;
};

/**
 * The CAS guards of the one commit, in today's order:
 * - `answer_facts`: the Answer/Job/QueryRun revisions read (PLAN-03, `plan-service.ts:1325-1329`);
 * - `agent_admission`: the guards returned by `authorizePlanWrite` (PLAN-02, Agent PLAN-05);
 * - `origin_sources`: the guards of `verifyModelCoordinationDraft` (PLAN-04 with `origin`);
 * - `project`/`workspace`/`goal`: the revisions read by `readGoalScope`;
 * - `governance`/`pinned_policy`: the governance or pinned policy guards;
 * - `proposal`: the candidate (`null` = must not exist);
 * - `plan_revision`: the source Plan @1 or the target Plan ∅;
 * - `task_record_absent`: the Lease/Reduction ∅ of a changed or added Task,
 *   and of an untraced disposition-only one (C7);
 * - `task_facts` (C7, TASK-19): every Run@rev, the Lease@k, the Reduction ∅ and
 *   the selected Run's pointer ControlIntent@rev read for a traced
 *   disposition-only Task;
 * - `carrier_facts` (guard 9, LA-3): the selected Run@rev, the Lease (@k or ∅)
 *   and the pointer ControlIntent@rev read for an existing carrier.
 */
export type PlanCommitGuard =
  | { target: 'answer_facts' | 'agent_admission' | 'origin_sources' | 'project' | 'workspace' | 'goal'
    | 'governance' | 'pinned_policy' }
  | { target: 'proposal'; expectedRevision: number | null }
  | { target: 'plan_revision'; ref: PlanRevisionRef; expectedRevision: 1 | null }
  | { target: 'task_record_absent'; record: 'TaskLease' | 'TaskReduction'; taskId: string }
  | { target: 'task_facts' | 'carrier_facts'; taskId: string };

/**
 * How the new PlanRevision@1 is built (compiler-owned, `plan-commit-compiler.ts`):
 * the initial draft verbatim (`:59-90`), or source + validated delta with the
 * target `taskStateBasis` (`:241-328`). A disposition-only Task (C7) is its
 * source definition with the draft's `disposition`/`replacedByTaskId`, its
 * basis inherited.
 */
export type PlanRevisionBuild =
  | { from: 'initial_draft' }
  | { from: 'future_delta'; source: PlanRevisionRef; changedTaskIds: readonly string[]; addedTaskIds: readonly string[];
    dispositionOnlyTaskIds: readonly string[] };

/** C7: one disposition change of a future adoption; `traced` = the Task had a Run, a Lease record or a Reduction. */
export type PlannedDispositionChangeV1 = FutureDispositionChangeV1 & { traced: boolean };

/**
 * Effects the owner translates into ONE commit (§3.3 effects column):
 * - `write_proposal`: the record `next` (from `newCandidateProposal` / `acceptProposalRecord`);
 * - `write_plan_revision`: PLAN-08, the new immutable Plan;
 * - `move_goal_pointer`: GOAL-02 (null → P) / GOAL-03 (Pk → Pk+1); PLAN-09 derives Pk superseded;
 * - `change_task_disposition` (C7): the Task's `disposition_changed` (TASK-18
 *   untraced, TASK-19 traced), whose `record_disposition_change` is the
 *   compiler's `dispositionRecord` entry;
 * - `append_event`: the durable event of the same commit;
 * - `guard`: one CAS guard of the commit.
 */
export type PlanProposalEffect =
  | { kind: 'write_proposal' }
  | { kind: 'write_plan_revision'; ref: PlanRevisionRef; build: PlanRevisionBuild }
  | { kind: 'move_goal_pointer'; from: PlanRevisionRef | null; to: PlanRevisionRef }
  | { kind: 'change_task_disposition'; change: PlannedDispositionChangeV1 }
  | { kind: 'append_event'; eventType: 'PlanProposalRecorded' | 'PlanRevisionAccepted' }
  | { kind: 'guard'; guard: PlanCommitGuard };

export type PlanProposalTransition = Transition<PlanProposalMachineState, PlanProposalEvent, PlanProposalEffect>;

// --------------------------------------------------------------------------
// W16 pure guards (§3.3 任务定义守卫表)
// --------------------------------------------------------------------------

/**
 * A guard's rejection: today's CoreError and reason. `reason` is the
 * transition's reject reason when it is not `guard_failed` (TASK-19 guard 5:
 * a satisfied Task's disposition is final, `illegal`, §3.4, §4.4).
 */
export type PlanGuardProblem = { code: CoreError; detail: string; reason?: TransitionRejectReason };

/**
 * One Task's execution facts for the untraced rule (`readFutureChangeTaskFacts`,
 * `plan-readers.ts:1238-1301`): this Goal's Runs of the Task across every Plan,
 * the TaskLease and the TaskReduction (null when absent).
 */
export type FutureChangeTaskFactsV1 = {
  taskId: string;
  runs: readonly RunSnapshot[];
  lease: TaskLeaseSnapshot | null;
  reduction: TaskReductionSnapshot | null;
};

/**
 * `readDispositionChangeTaskFacts` (C7, §3.3): the facts above plus the
 * selected Run and the ControlIntent its `controlState.intentRef` points at.
 * "Traced" = any Run, Lease record or Reduction.
 */
export type TracedTaskFactsV1 = FutureChangeTaskFactsV1 & {
  selectedRun: RunSnapshot | null;
  pointerIntent: ControlIntentSnapshotV1 | null;
};

/**
 * The untraced rule (§3.3; pre-step-3 inside the reader, `plan-readers.ts:1269-1297`)
 * for the Tasks whose execution definition changes or that are added
 * (`changedTaskIds ∪ addedTaskIds`): none may have a Run, a TaskLease or a
 * TaskReduction. Today's order: every Task's Runs first, then each Task's Lease
 * and Reduction (`readFutureChangeTaskFacts` reads them in that order and stops
 * at the first trace). C7 (§3.3): when the traced Task left source
 * obligations' `taskIds` (`carrierRemovals`), the refusal also says how to
 * keep it.
 */
export function futureChangeTraceProblem(
  facts: readonly FutureChangeTaskFactsV1[],
  carrierRemovals: readonly FutureCarrierRemovalV1[] = [],
): PlanGuardProblem | null {
  const refused = (taskId: string, trace: string): PlanGuardProblem => {
    const removal = carrierRemovals.find((entry) => entry.taskId === taskId);
    const hint = removal === undefined ? '' : '; a traced task may change only its disposition or replacedByTaskId: keep it in '
      + `${removal.obligationIds.map((obligationId) => `obligations[${obligationId}].taskIds`).join(', ')} `
      + 'and add the replacement task as another carrier';
    return { code: 'revision_conflict', detail: `task ${taskId} ${trace} and is no longer a future task${hint}` };
  };
  for (const task of facts) {
    if (task.runs.length > 0) return refused(task.taskId, 'already has a Run');
  }
  for (const task of facts) {
    if (task.lease !== null) return refused(task.taskId, 'already holds a TaskLease');
    if (task.reduction !== null) return refused(task.taskId, 'already has a formal reduction');
  }
  return null;
}

/**
 * TASK-19 guards 8, 1, 2, 2b, 3–7 (C7, §3.3) for the Tasks whose disposition
 * alone changes. Guard 8 runs once, first; then every traced Task in taskId
 * order runs guards 1..7; the first hit is returned (zero writes). Untraced
 * Tasks keep today's Lease ∅ / Reduction ∅ commit guards and are skipped here.
 * A Goal that is `paused` is not a reason: its unfinished Runs fail guard 1.
 */
export function tracedDispositionChangeProblem(input: {
  goalDesiredState: GoalDesiredState;
  tasks: readonly TracedTaskFactsV1[];
  /** The candidate's `reason.affectedTaskIds` (absent = none listed). */
  affectedTaskIds: readonly string[] | undefined;
  /** `reworkActorClassOf(principal, actor)` of the adopter. */
  adopterClass: ReworkActorClass;
}): PlanGuardProblem | null {
  // Guard 8 (the same D-9 check as PLAN-05, checked once).
  if (input.goalDesiredState === 'cancelled') {
    return { code: 'invalid', detail: GOAL_CANCELLED_PLAN_DETAIL };
  }
  const affected = new Set(input.affectedTaskIds ?? []);
  const traced = input.tasks
    .filter((task) => task.runs.length > 0 || task.lease !== null || task.reduction !== null)
    .sort((left, right) => (left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0));
  for (const task of traced) {
    const problem = tracedTaskProblem(task, affected, input.adopterClass);
    if (problem !== null) return problem;
  }
  return null;
}

function tracedTaskProblem(
  task: TracedTaskFactsV1,
  affected: ReadonlySet<string>,
  adopterClass: ReworkActorClass,
): PlanGuardProblem | null {
  const id = task.taskId;
  // Guard 1: every Run of the Task (every Plan) has ended.
  for (const run of task.runs) {
    if (run.status !== 'ended') {
      return { code: 'busy', detail: `task ${id} still has an unfinished execution: run ${run.ref.runId} is ${run.status}` };
    }
  }
  // Guard 2: no unknown outcome (hard limit 1).
  for (const run of task.runs) {
    if (run.outcome === 'outcome_unknown') {
      return { code: 'busy', detail: `task ${id}: resolve the unknown outcome of run ${run.ref.runId} first` };
    }
  }
  // Guard 2b: no other unreconciled Run.
  for (const run of task.runs) {
    const blocker = runUnresolvedBlocker(run);
    if (blocker !== null) return { code: 'busy', detail: `task ${id}: reconcile run ${run.ref.runId} first: ${blocker}` };
  }
  // Guard 3: no unconsumed yielded wait; a cancelled wait (P17) passes.
  const selected = task.selectedRun;
  if (selected !== null && selected.outcome === 'yielded' && selected.continuation !== undefined
    && selected.controlState?.desiredState !== 'cancelled') {
    return { code: 'busy', detail: `task ${id}: cancel or resume the yielded wait of run ${selected.ref.runId} first` };
  }
  // Guard 4: the Lease record exists and is released.
  if (task.lease === null) {
    if (task.runs.length > 0) {
      return { code: 'unavailable', detail: `task ${id} has Runs but no TaskLease record; its execution facts are inconsistent (legacy data)` };
    }
  } else if (task.lease.release === undefined) {
    return { code: 'busy', detail: `task ${id} still holds its TaskLease` };
  }
  // Guard 5: a satisfied Task's disposition is final (the Reduction is only ever `satisfied`).
  if (task.reduction !== null) {
    return { code: 'invalid', detail: `task ${id} is satisfied; the disposition of a satisfied task is final`, reason: 'illegal' };
  }
  // Guard 6: the candidate names the Task (candidates are immutable: resubmit).
  if (!affected.has(id)) {
    return { code: 'invalid', detail: `reason.affectedTaskIds must list traced task ${id}` };
  }
  // Guard 7: a human-stopped Task changes disposition only by a human (hard limit 3).
  if (fenceOf(task) !== 'none' && adopterClass !== 'human') {
    return { code: 'forbidden', detail: `only an operator may change the disposition of task ${id}: a human paused or cancelled it` };
  }
  return null;
}

/** The plan view guard 9 reads: Task kind/disposition and obligation carriers. */
export type PlanCarrierViewV1 = {
  tasks: readonly Pick<RuntimeTask, 'taskId' | 'taskKind' | 'disposition'>[];
  obligations: readonly Pick<AcceptanceObligation, 'obligationId' | 'taskIds'>[];
};

type GainingObligation = { obligationId: string; existing: string[]; added: string[] };

/**
 * Guard 9 (§3.3): source obligations that gain a new active work carrier, with
 * their existing active work carriers. Gates never count: they have no pointer,
 * are never fenced and do no work.
 */
function obligationsGainingWorkCarriers(source: PlanCarrierViewV1, target: PlanCarrierViewV1): GainingObligation[] {
  const activeWork = (view: PlanCarrierViewV1): Set<string> => new Set(view.tasks
    .filter((task) => task.taskKind === 'work' && task.disposition === 'active').map((task) => task.taskId));
  const sourceActiveWork = activeWork(source);
  const targetActiveWork = activeWork(target);
  const targetObligations = new Map(target.obligations.map((obligation) => [obligation.obligationId, obligation]));
  const gaining: GainingObligation[] = [];
  for (const obligation of source.obligations) {
    const next = targetObligations.get(obligation.obligationId);
    if (next === undefined) continue;
    const existing = [...new Set(obligation.taskIds)].filter((taskId) => sourceActiveWork.has(taskId));
    const existingSet = new Set(existing);
    const added = [...new Set(next.taskIds)].filter((taskId) => targetActiveWork.has(taskId) && !existingSet.has(taskId));
    if (added.length > 0) gaining.push({ obligationId: obligation.obligationId, existing, added });
  }
  return gaining;
}

/**
 * The existing active work carriers whose facts guard 9 needs: only those of
 * the obligations that gain a new carrier (sorted, unique). The service reads
 * them only for an `agent`/`system` adopter and joins their selected Run@rev,
 * Lease (@k or ∅) and pointer ControlIntent@rev to the commit guards.
 */
export function parallelCarrierFactTaskIds(input: { source: PlanCarrierViewV1; target: PlanCarrierViewV1 }): string[] {
  const ids = new Set<string>();
  for (const obligation of obligationsGainingWorkCarriers(input.source, input.target)) {
    for (const taskId of obligation.existing) ids.add(taskId);
  }
  return [...ids].sort();
}

/**
 * Guard 9 (lead decision LA-3, 2026-10-03): an `agent`/`system` W16 may not add
 * an active work carrier (a new Task, a Task newly listed in `taskIds`, or one
 * restored to `active`) to a source obligation whose existing active work
 * carriers are non-empty and all fenced (`reworkFenceOf ≠ 'none'`). An
 * operator (`human`) adoption is never limited by it.
 */
export function parallelCarrierFenceProblem(input: {
  adopterClass: ReworkActorClass;
  source: PlanCarrierViewV1;
  target: PlanCarrierViewV1;
  carrierFacts: readonly Pick<TracedTaskFactsV1, 'taskId' | 'selectedRun' | 'pointerIntent'>[];
}): PlanGuardProblem | null {
  if (input.adopterClass === 'human') return null;
  const facts = new Map(input.carrierFacts.map((entry) => [entry.taskId, entry]));
  for (const obligation of obligationsGainingWorkCarriers(input.source, input.target)) {
    if (obligation.existing.length === 0) continue;
    let allFenced = true;
    for (const taskId of obligation.existing) {
      const entry = facts.get(taskId);
      if (entry === undefined) {
        return { code: 'unavailable', detail: `the facts of carrier task ${taskId} of obligation ${obligation.obligationId} were not read` };
      }
      if (fenceOf(entry) === 'none') { allFenced = false; break; }
    }
    if (allFenced) {
      return { code: 'forbidden', detail: `obligation ${obligation.obligationId}: a human stopped this work; `
        + `only an operator may add the parallel carrier ${obligation.added.join(', ')}` };
    }
  }
  return null;
}

/** `reworkFenceOf` of a carrier; a Task without a selected Run has no pointer to fence it. */
function fenceOf(task: Pick<TracedTaskFactsV1, 'selectedRun' | 'pointerIntent'>): string {
  return task.selectedRun === null ? 'none' : reworkFenceOf(task.selectedRun, task.pointerIntent);
}

// --------------------------------------------------------------------------
// Facts read so far (the owner asks after each read, A.2 step 3)
// --------------------------------------------------------------------------

/**
 * The facts the owner has read so far in one call. An absent (`undefined`)
 * entry is not read yet: it holds, and every guard after it in today's order
 * waits for it, so `planProposalProblem` stops the owner's reads where today's
 * service stopped. `null` keeps its `PlanProposalGuardContext` meaning (not
 * read for this event); the complete context is one of these.
 */
export type PlanProposalReadFacts = {
  goal?: PlanProposalGuardContext['goal'];
  goalInWorkspace?: boolean;
  pinsAgree?: boolean;
  agentAdmission?: 'ok' | CoreRejection | null;
  source?: PlanSourceFacts | null;
  initial?: Partial<InitialAdoptionFacts> | null;
  future?: Partial<FutureAdoptionFacts> | null;
};

type RecordedGuardEvent = Omit<Extract<PlanProposalEvent, { type: 'proposal_recorded' }>, 'issues'>;
type AcceptedEvent = Extract<PlanProposalEvent, { type: 'proposal_accepted' }>;

/** What the guards read of an event: a recorded candidate's `issues` are diagnostics no guard reads (PLAN-01). */
export type PlanProposalGuardEvent = RecordedGuardEvent | AcceptedEvent;

/** A guard's fact is not read yet: it holds, and the guards after it wait. */
const UNREAD = 'unread';

/** One guard: today's refusal, `null` (holds) or `UNREAD`. */
type GuardStep = Rejected | null | typeof UNREAD;

/** A candidate every PLAN-04/05 guard admits, with what its one commit names. */
type AdmittedAdoption =
  | { path: 'initial'; proposal: CandidatePlanProposal; target: PlanRevisionRef }
  | {
    path: 'future'; proposal: CandidatePlanProposal; target: PlanRevisionRef; source: PlanSourceFacts;
    changedTaskIds: readonly string[]; addedTaskIds: readonly string[];
    /** `changedTaskIds ∪ addedTaskIds`, each once. */
    touchedTaskIds: readonly string[];
    pinnedPolicy: boolean;
    /** C7: the disposition-only Tasks, split by trace (Run, Lease record or Reduction). */
    dispositionOnlyTaskIds: readonly string[];
    tracedDispositionTaskIds: readonly string[];
    untracedDispositionTaskIds: readonly string[];
    /** C7: every disposition change, with its trace. */
    dispositionChanges: readonly PlannedDispositionChangeV1[];
    /** Guard 9: the carriers whose facts were read (agent/system adopter only). */
    carrierTaskIds: readonly string[];
  };

type AcceptStep = Rejected | typeof UNREAD | AdmittedAdoption;

function isAdmitted(step: AcceptStep): step is AdmittedAdoption {
  return typeof step === 'object' && 'path' in step;
}

/**
 * PLAN-01..05 over the facts read so far: today's refusal, or `null` while
 * every guard whose facts are read holds. The owner asks after each read, so
 * a refusal stops its reads where today's service stopped; then
 * `transitionPlanProposal` re-judges with the complete context and names the
 * commit. `state` is `undefined` while the proposal is not read (an Agent
 * adoption judges its decisionRefs and fresh admission first); a proposal
 * write passes `null`: its absence is the commit's CAS ∅ guard, never a read.
 */
export function planProposalProblem(
  state: PlanProposalMachineState | undefined,
  event: PlanProposalGuardEvent,
  facts: PlanProposalReadFacts,
): Rejected | null {
  switch (event.type) {
    case 'proposal_recorded': {
      const step = recordedStep(state, event, facts);
      return step === UNREAD ? null : step;
    }
    case 'proposal_accepted': {
      const step = acceptedStep(state, event, facts);
      return step === UNREAD || isAdmitted(step) ? null : step;
    }
    default:
      return unreachable(event, 'plan proposal guard event');
  }
}

/** `transitionPlanProposal` always has every fact; an unread one is a broken caller. */
function incompleteFacts(): Rejected {
  return reject('illegal', 'invalid', 'the plan proposal guard context is incomplete');
}

// --------------------------------------------------------------------------
// Shared guards (each returns today's rejection, null, or UNREAD)
// --------------------------------------------------------------------------

function refKey(ref: object): string {
  return canonicalJson(ref as unknown as JsonValue);
}
function sameRef(left: object, right: object): boolean {
  return refKey(left) === refKey(right);
}
function samePlanPointer(left: PlanRevisionRef | null, right: PlanRevisionRef | null): boolean {
  return left === null || right === null ? left === right : sameRef(left, right);
}

/** A forwarded read/admission verdict keeps its own code; an old basis is `stale`. */
function verdictStep(verdict: 'ok' | CoreRejection | undefined): GuardStep {
  if (verdict === undefined) return UNREAD;
  return verdict === 'ok' ? null : rejected(verdict);
}

/** The fresh Agent admission runs before any proposal/Goal read. */
function agentAdmissionStep(facts: PlanProposalReadFacts): GuardStep {
  if (facts.agentAdmission === undefined) return UNREAD;
  if (facts.agentAdmission === null) {
    return reject('illegal', 'invalid', 'an Agent plan write requires the fresh authorizePlanWrite verdict');
  }
  return verdictStep(facts.agentAdmission);
}

/**
 * `readGoalScope` workspace + pin comparison (propose :955-961, :1941-1950;
 * apply `validateProposalScope`, :1644-1666), then D-9 (§2.4, §3.4, step 5.5):
 * the Goal read with the scope is not cancelled.
 */
function scopeStep(facts: PlanProposalReadFacts, outsideWorkspace: string): GuardStep {
  if (facts.goalInWorkspace === undefined || facts.pinsAgree === undefined) return UNREAD;
  if (!facts.goalInWorkspace) return reject('guard_failed', 'forbidden', outsideWorkspace);
  if (!facts.pinsAgree) {
    return reject('stale', 'revision_conflict', 'the supplied version pins do not match the versions read in this call');
  }
  if (facts.goal === undefined) return UNREAD;
  if (facts.goal.desiredState === 'cancelled') return reject('illegal', 'invalid', GOAL_CANCELLED_PLAN_DETAIL);
  return null;
}

/** The service's `planAdmissionRejection` mapping (`plan-service.ts:215-223`), now only here. */
function planAdmissionProblem(label: string, issues: readonly PlanValidationError[]): Rejected {
  const rendered = `${label}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`;
  if (issues.some((issue) => issue.code === 'unsupported_execution_change')) return reject('guard_failed', 'unsupported', rendered);
  const structural = issues.some((issue) => issue.code === 'dag_cycle' || issue.code === 'self_dependency'
    || issue.code === 'hierarchy_cycle' || issue.code === 'dangling_task_ref' || issue.code === 'dangling_stage_ref');
  return reject('guard_failed', structural ? 'invalid' : 'incomplete', rendered);
}

/**
 * validatePlanDraft → validatePlanAssignments → planPhaseGuardReasons
 * (`:1180-1185`, `:1762-1767`); the owner runs each validator only after the
 * one before it holds.
 */
function draftAdmissionStep(label: string, facts: Partial<PlanDraftAdmissionFacts>): GuardStep {
  if (facts.draftIssues === undefined) return UNREAD;
  if (facts.draftIssues.length > 0) return planAdmissionProblem(label, facts.draftIssues);
  if (facts.assignmentReasons === undefined) return UNREAD;
  if (facts.assignmentReasons.length > 0) {
    return reject('guard_failed', 'incomplete', `${label}: ${facts.assignmentReasons.join('; ')}`);
  }
  if (facts.phaseReasons === undefined) return UNREAD;
  if (facts.phaseReasons.length > 0) return reject('guard_failed', 'incomplete', `${label}: ${facts.phaseReasons.join('; ')}`);
  return null;
}

/** The first refusal, or `UNREAD` at the first guard whose fact is not read yet. */
function chain(...steps: ReadonlyArray<() => GuardStep>): GuardStep {
  for (const step of steps) {
    const result = step();
    if (result !== null) return result;
  }
  return null;
}

function guard(value: PlanCommitGuard): PlanProposalEffect {
  return { kind: 'guard', guard: value };
}

// --------------------------------------------------------------------------
// Rows
// --------------------------------------------------------------------------

/**
 * PLAN-01 (Host, `plan-service.ts:923-1055`), PLAN-02 (Agent, `:1886-2011`),
 * PLAN-03 (initial answer, `:1244-1333`). A proposal is never refused for its
 * `basedOn` (GAP-14): a candidate may be stale the moment it is recorded
 * (`W1-future-plan.test.ts:471-473`).
 */
function recordedStep(
  state: PlanProposalMachineState | undefined,
  event: RecordedGuardEvent,
  facts: PlanProposalReadFacts,
): GuardStep {
  // :1029 — the shared entry check of every writer.
  if (event.draft.goalId !== event.goalRef.goalId) {
    return reject('illegal', 'invalid', 'the draft goalId does not match the GoalRef');
  }
  let problem: GuardStep;
  switch (event.writer) {
    case 'host':
      problem = chain(
        () => hostProvenanceProblem(event),
        // :955-961
        () => scopeStep(facts, 'the goal does not belong to the requested workspace'),
        () => reasonShapeStep(event),
      );
      break;
    case 'initial_answer':
      problem = chain(
        // PLAN-03: the answer-derived candidate is an initial plan (:1331).
        () => event.basedOn !== null
          ? reject('illegal', 'invalid', 'an initial-plan answer candidate is never based on a plan') : null,
        () => hostProvenanceProblem(event),
        // :955-961
        () => scopeStep(facts, 'the goal does not belong to the requested workspace'),
        () => reasonShapeStep(event),
      );
      break;
    case 'agent':
      problem = chain(
        // :1930-1936 — the fresh admission comes first; its provenance is `submittedBy`.
        () => agentAdmissionStep(facts),
        () => event.submittedBy === null
          ? reject('illegal', 'invalid', 'an Agent proposal requires the admitted submission provenance') : null,
        // :1941-1950
        () => scopeStep(facts, 'the goal does not belong to the requested workspace'),
        // :1954-1958
        () => event.draft.schemaVersion !== 2
          ? reject('guard_failed', 'unsupported', 'an Agent proposal requires a schemaVersion 2 future draft') : null,
        () => event.basedOn === null
          ? reject('guard_failed', 'forbidden', 'an Agent proposal must be based on an accepted source plan') : null,
        // :1959-1970
        () => agentSourceStep(event, facts),
        () => reasonShapeStep(event),
      );
      break;
    default:
      return unreachable(event.writer, 'plan proposal writer');
  }
  if (problem !== null) return problem;
  if (state === undefined) return UNREAD;
  // The proposalId is derived from the request id (:269-271, :1836-1839). The
  // receipt lookup runs first (:942-951, :1921-1925); a record found after it
  // was committed in between. Today the store replays a same-identity commit
  // before its guards (in-memory-record-store.ts:256-265), so the record that
  // this event would write is `duplicate` (§1.2): the service re-queries the
  // receipt (replay, or `idempotency_conflict`), and with no receipt for this
  // identity keeps today's create CAS ∅ code, `revision_conflict` (:985, :1991).
  if (state !== null) {
    const candidate = newCandidateProposal({ ref: event.ref, goalRef: event.goalRef, basedOn: event.basedOn,
      draft: event.draft, reason: event.reason, issues: [], submittedBy: event.submittedBy });
    return sameRecordedCandidate(state, candidate)
      ? reject('duplicate', 'revision_conflict',
        `proposal ${event.ref.proposalId} is already recorded with the same content; only its original receipt replays`)
      : reject('illegal', 'revision_conflict', `proposal ${event.ref.proposalId} already exists; only the original receipt replays`);
  }
  return null;
}

function onProposalRecorded(
  state: PlanProposalMachineState,
  event: Extract<PlanProposalEvent, { type: 'proposal_recorded' }>,
  ctx: PlanProposalGuardContext,
): PlanProposalTransition {
  const problem = recordedStep(state, event, ctx);
  if (problem === UNREAD) return incompleteFacts();
  if (problem !== null) return problem;
  const candidate = newCandidateProposal({ ref: event.ref, goalRef: event.goalRef, basedOn: event.basedOn,
    draft: event.draft, reason: event.reason, issues: event.issues, submittedBy: event.submittedBy });
  /** The writer's own CAS guards: `before` the Goal scope guards, `after` them (the source Plan). */
  let writerGuards: { before: PlanCommitGuard[]; after: PlanCommitGuard[] };
  switch (event.writer) {
    case 'host':
      writerGuards = { before: [], after: [] };
      break;
    case 'initial_answer':
      // :1325-1329
      writerGuards = { before: [{ target: 'answer_facts' }], after: [] };
      break;
    case 'agent':
      // :1985-1992 — the admission guards first, the source Plan @1 after the scope (non-null once its guard passed).
      writerGuards = { before: [{ target: 'agent_admission' }],
        after: ctx.source === null ? [] : [{ target: 'plan_revision', ref: ctx.source.ref, expectedRevision: 1 }] };
      break;
    default:
      return unreachable(event.writer, 'plan proposal writer');
  }
  const effects: PlanProposalEffect[] = [
    { kind: 'write_proposal' },
    { kind: 'append_event', eventType: 'PlanProposalRecorded' },
    ...writerGuards.before.map(guard),
    guard({ target: 'project' }), guard({ target: 'workspace' }), guard({ target: 'goal' }),
    ...writerGuards.after.map(guard),
    guard({ target: 'proposal', expectedRevision: null }),
  ];
  return accept<PlanProposalMachineState, PlanProposalEffect>(candidate, effects);
}

/** Upper bound of `PlanChangeReason.affectedTaskIds` (§3.1, C7; the record codec checks the same bound). */
const MAX_AFFECTED_TASK_IDS = 200;

/**
 * PLAN-01/02/03 (C7, §3.4, step 5.10), shape only: a draft never carries the
 * compiler-owned `dispositionRecord` (like `taskStateBasis`), and
 * `reason.affectedTaskIds`, when present, holds at most 200 distinct
 * non-empty task ids of the draft. Whether a traced Task is listed is judged
 * at adoption (TASK-19 guard 6).
 */
function reasonShapeStep(event: RecordedGuardEvent): GuardStep {
  if ((event.draft as unknown as Record<string, unknown>)['dispositionRecord'] !== undefined) {
    return reject('guard_failed', 'invalid', 'the draft carries dispositionRecord, which only the adoption compiler writes');
  }
  const reason: unknown = event.reason;
  const affected: unknown = typeof reason === 'object' && reason !== null
    ? (reason as { affectedTaskIds?: unknown }).affectedTaskIds : undefined;
  if (affected === undefined) return null;
  if (!Array.isArray(affected)) return reject('guard_failed', 'invalid', 'reason.affectedTaskIds must be an array when present');
  if (affected.length > MAX_AFFECTED_TASK_IDS) {
    return reject('guard_failed', 'invalid', `reason.affectedTaskIds must hold at most ${MAX_AFFECTED_TASK_IDS} task ids`);
  }
  const tasks: readonly unknown[] = Array.isArray(event.draft.tasks) ? event.draft.tasks : [];
  const draftTaskIds = new Set(tasks.map((task) => (task as { taskId?: unknown }).taskId));
  const seen = new Set<string>();
  for (const taskId of affected as unknown[]) {
    if (typeof taskId !== 'string' || taskId.length === 0) {
      return reject('guard_failed', 'invalid', 'reason.affectedTaskIds must hold non-empty task ids');
    }
    if (seen.has(taskId)) return reject('guard_failed', 'invalid', `reason.affectedTaskIds repeats task ${taskId}`);
    seen.add(taskId);
    if (!draftTaskIds.has(taskId)) {
      return reject('guard_failed', 'invalid', `reason.affectedTaskIds names ${taskId}, which is not a task of the draft`);
    }
  }
  return null;
}

/** A Host or answer-derived candidate never carries an Agent submission provenance. */
function hostProvenanceProblem(event: RecordedGuardEvent): GuardStep {
  return event.submittedBy !== null
    ? reject('illegal', 'invalid', 'only an Agent candidate carries a submission provenance') : null;
}

/**
 * The stored record is already this event's target, candidate@1, with the same
 * content. `issues` are not compared: they are `validatePlanDraft` diagnostics
 * under the policy read in each call, outside every request fingerprint
 * (`proposeFingerprint`, :284-289; the Agent fingerprint, :1915-1917).
 */
function sameRecordedCandidate(state: PlanProposalRecord, candidate: CandidatePlanProposal): boolean {
  if (state.kind !== 'candidate_v2' || state.status !== 'candidate' || state.revision !== 1) return false;
  try {
    return refKey({ ...state, issues: [] }) === refKey({ ...candidate, issues: [] });
  } catch {
    // A non-JSON value (never produced by the record decoders or the owned input) is not the same content.
    return false;
  }
}

/** PLAN-02: the source is a real Plan of this Goal and still its active plan (:1959-1970). */
function agentSourceStep(event: RecordedGuardEvent, facts: PlanProposalReadFacts): GuardStep {
  const source = facts.source;
  if (source === undefined) return UNREAD;
  if (source === null) return reject('illegal', 'invalid', 'an Agent proposal requires the source plan read through basedOn');
  if (source.ref.projectId !== event.ref.projectId || source.goalRef.goalId !== event.goalRef.goalId) {
    return reject('illegal', 'not_found', 'the source plan does not belong to the proposal goal');
  }
  // The Goal was read with the scope, before the source.
  if (facts.goal === undefined) return UNREAD;
  if (!samePlanPointer(facts.goal.activePlanRevision, source.ref)) {
    return reject('stale', 'revision_conflict', 'the source plan is not the Goal current active plan');
  }
  return null;
}

/**
 * PLAN-04/05 and the §3.4 `proposal_accepted` rows. Host `applyPlanChange`
 * (`plan-service.ts:1140-1215`); Agent `applyPlanChangeAsAgent` (`:2019-2106`),
 * whose decisionRefs and fresh admission checks run before the proposal read.
 */
function acceptedStep(
  state: PlanProposalMachineState | undefined,
  event: AcceptedEvent,
  facts: PlanProposalReadFacts,
): AcceptStep {
  switch (event.adopter) {
    case 'host':
      break;
    case 'agent': {
      // :2034-2036, before the fresh admission (:2057-2062)
      if (event.decisionRefs.length > 0) {
        return reject('guard_failed', 'forbidden', 'an Agent future-plan apply does not accept decision references');
      }
      const admission = agentAdmissionStep(facts);
      if (admission !== null) return admission;
      break;
    }
    default:
      return unreachable(event.adopter, 'plan adopter');
  }
  if (state === undefined) return UNREAD;
  if (state === null) return reject('illegal', 'not_found', `proposal ${event.proposalRef.proposalId} does not exist`);
  switch (state.kind) {
    case 'legacy_v1':
      return reject('illegal', 'unsupported', legacyAdoptionDetail(event.adopter));
    case 'candidate_v2':
      switch (state.status) {
        case 'accepted':
        case 'rejected':
          // :1145, :2070
          return reject('illegal', 'invalid', `proposal ${event.proposalRef.proposalId} is not a pending candidate`);
        case 'candidate':
          return candidateStep(state, event, facts);
        default:
          return unreachable(state, 'plan proposal status');
      }
    default:
      return unreachable(state, 'plan proposal kind');
  }
}

function onProposalAccepted(
  state: PlanProposalMachineState,
  event: AcceptedEvent,
  ctx: PlanProposalGuardContext,
): PlanProposalTransition {
  const step = acceptedStep(state, event, ctx);
  if (step === UNREAD) return incompleteFacts();
  if (!isAdmitted(step)) return step;
  return accept<PlanProposalMachineState, PlanProposalEffect>(acceptProposalRecord(step.proposal),
    adoptionEffects(step, event.adopter));
}

/** :1144 (Host), :2069 (Agent). */
function legacyAdoptionDetail(adopter: PlanAdopter): string {
  switch (adopter) {
    case 'host':
      return 'a legacy v1 patch proposal cannot be adopted by this slice';
    case 'agent':
      return 'a legacy v1 patch proposal cannot be adopted by an Agent';
    default:
      return unreachable(adopter, 'plan adopter');
  }
}

/** The adopter's own CAS guards: the fresh Agent admission joins the commit (`extraGuards`, :2095 → :1773-1774). */
function adopterCommitGuards(adopter: PlanAdopter): PlanCommitGuard[] {
  switch (adopter) {
    case 'host':
      return [];
    case 'agent':
      return [{ target: 'agent_admission' }];
    default:
      return unreachable(adopter, 'plan adopter');
  }
}

function candidateStep(
  proposal: CandidatePlanProposal,
  event: AcceptedEvent,
  facts: PlanProposalReadFacts,
): AcceptStep {
  // :1146-1149, :2071-2073
  if (proposal.revision !== event.expectedProposalRevision) {
    return reject('stale', 'revision_conflict', 'the proposal revision changed');
  }
  switch (event.adopter) {
    case 'host':
      break;
    case 'agent': {
      const problem = agentCandidateProblem(proposal, event);
      if (problem !== null) return problem;
      break;
    }
    default:
      return unreachable(event.adopter, 'plan adopter');
  }
  // validateProposalScope (:1644-1666)
  const scope = scopeStep(facts, 'the goal does not belong to the proposal workspace');
  if (scope !== null) return scope;
  return proposal.basedOn === null
    ? initialAdoptionStep(proposal, event, facts)
    : futureAdoptionStep(proposal, event, facts);
}

/** :2075-2087 — only this Run's own future candidate of its own Goal. */
function agentCandidateProblem(proposal: CandidatePlanProposal, event: AcceptedEvent): Rejected | null {
  const writer = event.agentWriter;
  if (writer === null) return reject('illegal', 'invalid', 'an Agent apply requires the identified writer');
  const submittedBy = proposal.submittedBy;
  if (submittedBy === undefined) {
    return reject('guard_failed', 'forbidden', 'a candidate without an Agent submission source cannot be adopted by an Agent');
  }
  if (!sameRef(submittedBy.runRef, writer.runRef) || !sameRef(submittedBy.sessionRef, writer.sessionRef)
    || !sameRef(submittedBy.roleBinding, writer.roleBinding)) {
    return reject('guard_failed', 'forbidden', 'the candidate was submitted by another Agent Run');
  }
  if (proposal.goalRef.projectId !== event.proposalRef.projectId || proposal.goalRef.goalId !== writer.goalRef.goalId) {
    return reject('guard_failed', 'forbidden', 'the candidate goal is not the Agent Run goal');
  }
  if (proposal.basedOn === null) {
    return reject('guard_failed', 'forbidden', 'an Agent apply requires a future revision with a source plan');
  }
  return null;
}

/** PLAN-04 + GOAL-02 + PLAN-08 (`plan-service.ts:1165-1215` → `plan-commit-compiler.ts:135-181`). */
function initialAdoptionStep(
  proposal: CandidatePlanProposal,
  event: AcceptedEvent,
  facts: PlanProposalReadFacts,
): AcceptStep {
  // :1165
  if (event.decisionRefs.length > 0) {
    return reject('guard_failed', 'invalid', 'an initial plan adoption does not accept decision references');
  }
  // :1166-1170 (the Goal was read with the scope)
  if (facts.goal === undefined) return UNREAD;
  if (facts.goal.activePlanRevision !== null) {
    return reject('stale', 'revision_conflict', 'the goal already has an active plan; an initial adoption cannot replace it');
  }
  const initial = facts.initial;
  if (initial === undefined) return UNREAD;
  if (initial === null) {
    return reject('illegal', 'invalid', 'an initial adoption requires the origin, governance and draft admission facts');
  }
  const problem = chain(
    // :1171-1179
    () => verdictStep(initial.origin),
    () => verdictStep(initial.governance),
    // :1180-1185
    () => draftAdmissionStep('the initial plan is not admissible', initial),
  );
  if (problem !== null) return problem;
  return { path: 'initial', proposal, target: planRevisionTargetOf(event.proposalRef, proposal.draft) };
}

/**
 * PLAN-05 + GOAL-03 + PLAN-08/09 (`applyFutureRevision`, `plan-service.ts:1676-1816`
 * → `plan-commit-compiler.ts:241-328`). C7 (step 5.10): a changed or added
 * Task falls under the untraced rule; a disposition-only Task under TASK-19
 * when it is traced (an untraced one keeps the Lease ∅ / Reduction ∅ commit
 * guards); then guard 9 for an `agent`/`system` adopter.
 */
function futureAdoptionStep(
  proposal: CandidatePlanProposal,
  event: AcceptedEvent,
  facts: PlanProposalReadFacts,
): AcceptStep {
  const draft = proposal.draft;
  // :1695-1700
  if (draft.schemaVersion !== 2) {
    return event.decisionRefs.length === 0
      ? reject('guard_failed', 'incomplete', 'a plan change requires an accepted UserDecision; this slice does not accept raw full drafts')
      : reject('guard_failed', 'unsupported', 'authorized plan-change delta compilation is not implemented in this slice');
  }
  // :1703-1705
  if (event.decisionRefs.length > 0) {
    return reject('guard_failed', 'unsupported', 'a W1 future-only revision does not accept decision references');
  }
  const source = facts.source;
  if (source === undefined) return UNREAD;
  if (source === null) return reject('illegal', 'invalid', 'a future adoption requires the source plan read through basedOn');
  // :1709-1711
  if (source.ref.projectId !== event.proposalRef.projectId || source.goalRef.goalId !== proposal.goalRef.goalId) {
    return reject('illegal', 'not_found', 'the source plan does not belong to the proposal goal');
  }
  // :1712-1717 — the pointer only moves forward (a superseded source is stale); the Goal was read with the scope.
  if (facts.goal === undefined) return UNREAD;
  if (!samePlanPointer(facts.goal.activePlanRevision, source.ref)) {
    return reject('stale', 'revision_conflict', 'the source plan is not the Goal current active plan');
  }
  // :1718-1726
  if (draft.goalId !== proposal.goalRef.goalId) {
    return reject('illegal', 'invalid', 'the draft goalId does not match the proposal goal');
  }
  if (draft.planRevision !== source.planRevision + 1) {
    return reject('stale', 'revision_conflict', 'the target planRevision must be exactly source+1');
  }
  if (draft.planId === source.planId) {
    return reject('illegal', 'invalid', 'the target planId must be a new, unused reference');
  }
  const future = facts.future;
  if (future === undefined) return UNREAD;
  if (future === null) return reject('illegal', 'invalid', 'a future adoption requires the target, delta and task facts');
  // :1727-1733
  if (future.targetExists === undefined) return UNREAD;
  if (future.targetExists) return reject('stale', 'revision_conflict', 'the target plan already exists');
  // :1737-1738 — includes "a Task was physically removed".
  const delta = future.delta;
  if (delta === undefined) return UNREAD;
  if (delta.status === 'unsupported') return reject('guard_failed', 'unsupported', delta.reason);
  // :1740-1745 — obligation, gate, intent, role and new-Task-phase rules.
  const coverage = future.coverage;
  if (coverage === undefined) return UNREAD;
  switch (coverage.status) {
    case 'supported':
      break;
    case 'unsupported':
      return reject('guard_failed', 'unsupported', coverage.reason);
    case 'rejected':
      return reject('guard_failed', 'invalid',
        `the future plan is not admissible: ${coverage.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
    default:
      return unreachable(coverage, 'future obligation coverage');
  }
  const pinnedPolicy = future.pinnedPolicy;
  const problem = chain(
    // :1755-1761
    () => pinnedPolicy === 'not_needed' ? null : verdictStep(pinnedPolicy),
    // :1762-1767
    () => draftAdmissionStep('the future plan is not admissible', future),
  );
  if (problem !== null) return problem;
  // :1769-1771 → plan-readers.ts `readFutureChangeTaskFacts`: the untraced rule for the changed and added Tasks.
  const touchedFacts = future.touchedTaskFacts;
  if (touchedFacts === undefined) return UNREAD;
  const touched = [...new Set([...delta.changedTaskIds, ...delta.addedTaskIds])];
  const factsById = new Map(touchedFacts.map((entry) => [entry.taskId, entry]));
  const judged: FutureChangeTaskFactsV1[] = [];
  for (const taskId of touched) {
    const entry = factsById.get(taskId);
    if (entry === undefined) return reject('illegal', 'invalid', `the future-change facts of task ${taskId} were not read`);
    judged.push(entry);
  }
  const trace = futureChangeTraceProblem(judged, delta.carrierRemovals);
  if (trace !== null) return reject('guard_failed', trace.code, trace.detail);
  // C7 (TASK-19, guards 8, 1, 2, 2b, 3–7): the disposition-only Tasks, read by `readDispositionChangeTaskFacts`.
  const dispositionFacts = future.dispositionTaskFacts;
  const adopterClass = future.adopterClass;
  if (dispositionFacts === undefined || adopterClass === undefined) return UNREAD;
  const dispositionById = new Map(dispositionFacts.map((entry) => [entry.taskId, entry]));
  const dispositionJudged: TracedTaskFactsV1[] = [];
  for (const taskId of delta.dispositionOnlyTaskIds) {
    const entry = dispositionById.get(taskId);
    if (entry === undefined) return reject('illegal', 'invalid', `the disposition-change facts of task ${taskId} were not read`);
    dispositionJudged.push(entry);
  }
  // The scope step refused a cancelled Goal (D-9) before any of this; guard 8 is the same check.
  if (facts.goal === undefined) return UNREAD;
  const traced = tracedDispositionChangeProblem({ goalDesiredState: facts.goal.desiredState, tasks: dispositionJudged,
    affectedTaskIds: proposal.reason.affectedTaskIds, adopterClass });
  if (traced !== null) return reject(traced.reason ?? 'guard_failed', traced.code, traced.detail);
  // Guard 9 (LA-3): only an `agent`/`system` adopter reads and judges the existing carriers.
  let carrierTaskIds: readonly string[] = [];
  if (adopterClass !== 'human') {
    const sourceCarriers = future.sourceCarriers;
    const carrierFacts = future.carrierFacts;
    if (sourceCarriers === undefined || carrierFacts === undefined) return UNREAD;
    const targetCarriers: PlanCarrierViewV1 = { tasks: draft.tasks, obligations: draft.obligations };
    const fence = parallelCarrierFenceProblem({ adopterClass, source: sourceCarriers, target: targetCarriers, carrierFacts });
    if (fence !== null) return reject(fence.reason ?? 'guard_failed', fence.code, fence.detail);
    carrierTaskIds = parallelCarrierFactTaskIds({ source: sourceCarriers, target: targetCarriers });
  }
  const isTraced = (entry: TracedTaskFactsV1): boolean => entry.runs.length > 0 || entry.lease !== null || entry.reduction !== null;
  const tracedIds = new Set(dispositionJudged.filter(isTraced).map((entry) => entry.taskId));
  return { path: 'future', proposal, source, target: planRevisionTargetOf(event.proposalRef, draft),
    changedTaskIds: delta.changedTaskIds, addedTaskIds: delta.addedTaskIds, touchedTaskIds: touched,
    pinnedPolicy: pinnedPolicy === 'ok',
    dispositionOnlyTaskIds: delta.dispositionOnlyTaskIds,
    tracedDispositionTaskIds: delta.dispositionOnlyTaskIds.filter((taskId) => tracedIds.has(taskId)),
    untracedDispositionTaskIds: delta.dispositionOnlyTaskIds.filter((taskId) => !tracedIds.has(taskId)),
    // A changed Task passed the untraced rule, so only a disposition-only Task can be traced.
    dispositionChanges: delta.dispositionChanges.map((change) => ({ ...change, traced: tracedIds.has(change.taskId) })),
    carrierTaskIds };
}

/** The one adoption commit of an admitted candidate (§3.3 effects column of PLAN-04/05). */
function adoptionEffects(admitted: AdmittedAdoption, adopter: PlanAdopter): PlanProposalEffect[] {
  const proposal = admitted.proposal;
  switch (admitted.path) {
    case 'initial': {
      const effects: PlanProposalEffect[] = [
        { kind: 'write_proposal' },
        { kind: 'write_plan_revision', ref: admitted.target, build: { from: 'initial_draft' } },
        { kind: 'move_goal_pointer', from: null, to: admitted.target },
        { kind: 'append_event', eventType: 'PlanRevisionAccepted' },
      ];
      if (proposal.draft.origin !== undefined) effects.push(guard({ target: 'origin_sources' }));
      effects.push(
        guard({ target: 'project' }), guard({ target: 'workspace' }), guard({ target: 'goal' }),
        guard({ target: 'proposal', expectedRevision: proposal.revision }),
        guard({ target: 'governance' }),
        guard({ target: 'plan_revision', ref: admitted.target, expectedRevision: null }),
      );
      return effects;
    }
    case 'future': {
      const effects: PlanProposalEffect[] = [
        { kind: 'write_proposal' },
        { kind: 'write_plan_revision', ref: admitted.target, build: { from: 'future_delta', source: admitted.source.ref,
          changedTaskIds: admitted.changedTaskIds, addedTaskIds: admitted.addedTaskIds,
          dispositionOnlyTaskIds: admitted.dispositionOnlyTaskIds } },
        { kind: 'move_goal_pointer', from: admitted.source.ref, to: admitted.target },
        // C7: TASK-18 (untraced) / TASK-19 (traced) for each disposition change, in taskId order.
        ...admitted.dispositionChanges.map((change): PlanProposalEffect => ({ kind: 'change_task_disposition', change })),
        { kind: 'append_event', eventType: 'PlanRevisionAccepted' },
        ...adopterCommitGuards(adopter).map(guard),
      ];
      if (admitted.pinnedPolicy) effects.push(guard({ target: 'pinned_policy' }));
      effects.push(
        guard({ target: 'project' }), guard({ target: 'workspace' }), guard({ target: 'goal' }),
        guard({ target: 'proposal', expectedRevision: proposal.revision }),
        guard({ target: 'plan_revision', ref: admitted.source.ref, expectedRevision: 1 }),
      );
      // The changed and added Tasks, and (C7) the untraced disposition-only ones: Lease ∅ / Reduction ∅.
      for (const taskId of [...admitted.touchedTaskIds, ...admitted.untracedDispositionTaskIds]) {
        effects.push(guard({ target: 'task_record_absent', record: 'TaskLease', taskId }),
          guard({ target: 'task_record_absent', record: 'TaskReduction', taskId }));
      }
      // C7 (TASK-19): the traced disposition-only Tasks' facts; guard 9: the carriers read.
      for (const taskId of admitted.tracedDispositionTaskIds) effects.push(guard({ target: 'task_facts', taskId }));
      for (const taskId of admitted.carrierTaskIds) effects.push(guard({ target: 'carrier_facts', taskId }));
      effects.push(guard({ target: 'plan_revision', ref: admitted.target, expectedRevision: null }));
      return effects;
    }
    default:
      return unreachable(admitted, 'admitted adoption');
  }
}

/**
 * PLAN-06 (derived, no write): a candidate whose `basedOn` is not the active
 * plan reads as stale; `findPendingProposal` skips it and adoption gets
 * `revision_conflict` (rows above).
 */
function onProposalStale(state: PlanProposalMachineState, ctx: PlanProposalGuardContext): PlanProposalTransition {
  if (state === null) return reject('illegal', 'not_found', 'there is no proposal to read as stale');
  switch (state.status) {
    case 'candidate':
      if (samePlanPointer(state.basedOn, ctx.goal.activePlanRevision)) {
        return reject('guard_failed', 'invalid', 'the candidate is based on the Goal active plan; it is pending, not stale');
      }
      return accept<PlanProposalMachineState, PlanProposalEffect>(state);
    case 'accepted':
    case 'rejected':
      return reject('illegal', 'invalid', `a ${state.status} proposal is never read as stale`);
    default:
      return unreachable(state, 'plan proposal status');
  }
}

/**
 * PLAN-07 (新增): `rejected` is declared but has no writer (D-17). A candidate
 * reports the missing capability as `unsupported` (§3.4); `accepted` is final.
 */
function onProposalRejected(state: PlanProposalMachineState): PlanProposalTransition {
  if (state === null) return reject('illegal', 'not_found', 'there is no proposal to reject');
  switch (state.status) {
    case 'candidate':
      return reject('illegal', 'unsupported', 'rejecting a plan candidate has no writer in this batch (D-17)');
    case 'accepted':
      return reject('illegal', 'invalid', 'an accepted proposal is final; it cannot be rejected');
    case 'rejected':
      return reject('illegal', 'invalid', 'the proposal is already rejected; rejection has no writer in this batch');
    default:
      return unreachable(state, 'plan proposal status');
  }
}

/** §3 PlanProposal machine (PLAN-01..07 and the §3.4 rows). */
export function transitionPlanProposal(
  state: PlanProposalMachineState,
  event: PlanProposalEvent,
  ctx: PlanProposalGuardContext,
): PlanProposalTransition {
  switch (event.type) {
    case 'proposal_recorded':
      return onProposalRecorded(state, event, ctx);
    case 'proposal_accepted':
      return onProposalAccepted(state, event, ctx);
    case 'proposal_stale':
      return onProposalStale(state, ctx);
    case 'proposal_rejected':
      return onProposalRejected(state);
    default:
      return unreachable(event, 'plan proposal event');
  }
}
