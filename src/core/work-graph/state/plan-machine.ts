/**
 * PlanProposal / PlanRevision state machines (docs/refactor/STATE-MACHINES-SPEC.md
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
 * first failing guard returns today's CoreError (§1.2). Read failures
 * (not_found/unavailable/corrupt of a record the service needed) stay with the
 * service, as do the input-shape checks it makes before the receipt lookup.
 *
 * Step 2 (§15.2) implements today's results. Not yet wired, flipped in step 5:
 * the Goal `cancelled` guard (D-9, step 5.5); the C7 `affectedTaskIds` shape
 * and draft `dispositionRecord` checks (today the PlanProposal record schema
 * rejects both at commit with `invalid`, zero writes); the C7 split of W16 into
 * changed / disposition-only Tasks with `tracedDispositionChangeProblem`
 * (TASK-19) and the LA-3 guard 9 `parallelCarrierFenceProblem` (step 5.10).
 * Both W16 helpers are implemented in full below.
 *
 * `PlanProposal` is declared in `tasks/plan-contracts.ts:28-50`, which this
 * directory may not import. `PlanProposalRecord` below is the same shape built
 * from `src/contracts` types only; tests/state/plan-machine.test.ts asserts the
 * two types are identical.
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
  AcceptanceObligation, PlanRevisionDraft, PlanRevisionRef, PlanValidationError, RuntimeTask,
} from '../../../contracts/plan.js';
import type { TaskReductionSnapshot } from '../../../contracts/reduction.js';
import type { ReworkActorClass } from '../../../contracts/task-requeue.js';
import { runUnresolvedBlocker } from './run-machine.js';
import { reworkFenceOf } from './task-failure.js';
import { accept, reject, rejected, unreachable, type Transition } from './transition.js';

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
 * PLAN-01..03: a new `candidate@1` (today `plan-service.ts:965-967` and
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

/** PLAN-04/05: the accepted candidate, revision + 1 (today `plan-commit-compiler.ts:145-149,294-298`). */
export function acceptProposalRecord(proposal: CandidatePlanProposal): CandidatePlanProposal {
  return { ...proposal, revision: proposal.revision + 1, status: 'accepted' };
}

// --------------------------------------------------------------------------
// Derived status (PLAN-06, PLAN-08/09)
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

/** `deriveFuturePlanDelta` (`plan-validation.ts:306-347`). */
export type FuturePlanDeltaVerdict =
  | { status: 'supported'; changedTaskIds: readonly string[]; addedTaskIds: readonly string[] }
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
};

/**
 * What the service read and validated. Sections an event does not use are
 * `null`. `goal.desiredState` is read for D-9 (step 5.5): today no Goal state
 * blocks a plan write.
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
 * - `task_record_absent`: the Lease/Reduction ∅ of a changed or added Task.
 */
export type PlanCommitGuard =
  | { target: 'answer_facts' | 'agent_admission' | 'origin_sources' | 'project' | 'workspace' | 'goal'
    | 'governance' | 'pinned_policy' }
  | { target: 'proposal'; expectedRevision: number | null }
  | { target: 'plan_revision'; ref: PlanRevisionRef; expectedRevision: 1 | null }
  | { target: 'task_record_absent'; record: 'TaskLease' | 'TaskReduction'; taskId: string };

/**
 * How the new PlanRevision@1 is built (compiler-owned, `plan-commit-compiler.ts`):
 * the initial draft verbatim (`:59-90`), or source + validated delta with the
 * target `taskStateBasis` (`:241-328`).
 */
export type PlanRevisionBuild =
  | { from: 'initial_draft' }
  | { from: 'future_delta'; source: PlanRevisionRef; changedTaskIds: readonly string[]; addedTaskIds: readonly string[] };

/**
 * Effects the owner translates into ONE commit (§3.3 effects column):
 * - `write_proposal`: the record `next` (from `newCandidateProposal` / `acceptProposalRecord`);
 * - `write_plan_revision`: PLAN-08, the new immutable Plan;
 * - `move_goal_pointer`: GOAL-02 (null → P) / GOAL-03 (Pk → Pk+1); PLAN-09 derives Pk superseded;
 * - `append_event`: the durable event of the same commit;
 * - `guard`: one CAS guard of the commit.
 */
export type PlanProposalEffect =
  | { kind: 'write_proposal' }
  | { kind: 'write_plan_revision'; ref: PlanRevisionRef; build: PlanRevisionBuild }
  | { kind: 'move_goal_pointer'; from: PlanRevisionRef | null; to: PlanRevisionRef }
  | { kind: 'append_event'; eventType: 'PlanProposalRecorded' | 'PlanRevisionAccepted' }
  | { kind: 'guard'; guard: PlanCommitGuard };

export type PlanProposalTransition = Transition<PlanProposalMachineState, PlanProposalEvent, PlanProposalEffect>;

// --------------------------------------------------------------------------
// W16 pure guards (§3.3 任务定义守卫表)
// --------------------------------------------------------------------------

/** A guard's rejection: today's CoreError and reason. */
export type PlanGuardProblem = { code: CoreError; detail: string };

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
 * The untraced rule (§3.3; `plan-readers.ts:1269-1297`) for the Tasks whose
 * execution definition changes or that are added (`changedTaskIds ∪
 * addedTaskIds`): none may have a Run, a TaskLease or a TaskReduction. Today's
 * order: every Task's Runs first, then each Task's Lease and Reduction.
 */
export function futureChangeTraceProblem(facts: readonly FutureChangeTaskFactsV1[]): PlanGuardProblem | null {
  for (const task of facts) {
    if (task.runs.length > 0) {
      return { code: 'revision_conflict', detail: `task ${task.taskId} already has a Run and is no longer a future task` };
    }
  }
  for (const task of facts) {
    if (task.lease !== null) {
      return { code: 'revision_conflict', detail: `task ${task.taskId} already holds a TaskLease and is no longer a future task` };
    }
    if (task.reduction !== null) {
      return { code: 'revision_conflict', detail: `task ${task.taskId} already has a formal reduction and is no longer a future task` };
    }
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
    return { code: 'invalid', detail: 'the Goal is cancelled; its plan can no longer change' };
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
    return { code: 'invalid', detail: `task ${id} is satisfied; the disposition of a satisfied task is final` };
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
// Shared guards (each returns today's rejection, or null)
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
function verdictProblem(verdict: 'ok' | CoreRejection): PlanProposalTransition | null {
  return verdict === 'ok' ? null : rejected(verdict);
}

/** The fresh Agent admission runs before any proposal/Goal read. */
function agentAdmissionProblem(ctx: PlanProposalGuardContext): PlanProposalTransition | null {
  if (ctx.agentAdmission === null) {
    return reject('illegal', 'invalid', 'an Agent plan write requires the fresh authorizePlanWrite verdict');
  }
  return verdictProblem(ctx.agentAdmission);
}

/** `planAdmissionRejection` (`plan-service.ts:215-223`). */
function planAdmissionProblem(label: string, issues: readonly PlanValidationError[]): PlanProposalTransition {
  const rendered = `${label}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`;
  if (issues.some((issue) => issue.code === 'unsupported_execution_change')) return reject('guard_failed', 'unsupported', rendered);
  const structural = issues.some((issue) => issue.code === 'dag_cycle' || issue.code === 'self_dependency'
    || issue.code === 'hierarchy_cycle' || issue.code === 'dangling_task_ref' || issue.code === 'dangling_stage_ref');
  return reject('guard_failed', structural ? 'invalid' : 'incomplete', rendered);
}

/** validatePlanDraft → validatePlanAssignments → planPhaseGuardReasons (`:1180-1185`, `:1762-1767`). */
function draftAdmissionProblem(label: string, facts: PlanDraftAdmissionFacts): PlanProposalTransition | null {
  if (facts.draftIssues.length > 0) return planAdmissionProblem(label, facts.draftIssues);
  if (facts.assignmentReasons.length > 0) {
    return reject('guard_failed', 'incomplete', `${label}: ${facts.assignmentReasons.join('; ')}`);
  }
  if (facts.phaseReasons.length > 0) return reject('guard_failed', 'incomplete', `${label}: ${facts.phaseReasons.join('; ')}`);
  return null;
}

function first(...checks: ReadonlyArray<() => PlanProposalTransition | null>): PlanProposalTransition | null {
  for (const check of checks) {
    const problem = check();
    if (problem !== null) return problem;
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
function onProposalRecorded(
  state: PlanProposalMachineState,
  event: Extract<PlanProposalEvent, { type: 'proposal_recorded' }>,
  ctx: PlanProposalGuardContext,
): PlanProposalTransition {
  // :1029 — the shared entry check of every writer.
  if (event.draft.goalId !== event.goalRef.goalId) {
    return reject('illegal', 'invalid', 'the draft goalId does not match the GoalRef');
  }
  let problem: PlanProposalTransition | null;
  /** The writer's own CAS guards: `before` the Goal scope guards, `after` them (the source Plan). */
  let writerGuards: { before: PlanCommitGuard[]; after: PlanCommitGuard[] };
  switch (event.writer) {
    case 'host':
      problem = first(
        () => hostProvenanceProblem(event),
        // :955-961
        () => recordScopeProblem(ctx),
      );
      writerGuards = { before: [], after: [] };
      break;
    case 'initial_answer':
      problem = first(
        // PLAN-03: the answer-derived candidate is an initial plan (:1331).
        () => event.basedOn !== null
          ? reject('illegal', 'invalid', 'an initial-plan answer candidate is never based on a plan') : null,
        () => hostProvenanceProblem(event),
        // :955-961
        () => recordScopeProblem(ctx),
      );
      // :1325-1329
      writerGuards = { before: [{ target: 'answer_facts' }], after: [] };
      break;
    case 'agent':
      problem = first(
        () => event.submittedBy === null
          ? reject('illegal', 'invalid', 'an Agent proposal requires the admitted submission provenance') : null,
        // :1930-1936
        () => agentAdmissionProblem(ctx),
        // :1941-1950
        () => recordScopeProblem(ctx),
        // :1954-1958
        () => event.draft.schemaVersion !== 2
          ? reject('guard_failed', 'unsupported', 'an Agent proposal requires a schemaVersion 2 future draft') : null,
        () => event.basedOn === null
          ? reject('guard_failed', 'forbidden', 'an Agent proposal must be based on an accepted source plan') : null,
        // :1959-1970
        () => agentSourceProblem(event, ctx),
      );
      // :1985-1992 — the admission guards first, the source Plan @1 after the scope (non-null once its guard passed).
      writerGuards = { before: [{ target: 'agent_admission' }],
        after: ctx.source === null ? [] : [{ target: 'plan_revision', ref: ctx.source.ref, expectedRevision: 1 }] };
      break;
    default:
      return unreachable(event.writer, 'plan proposal writer');
  }
  if (problem !== null) return problem;
  const candidate = newCandidateProposal({ ref: event.ref, goalRef: event.goalRef, basedOn: event.basedOn,
    draft: event.draft, reason: event.reason, issues: event.issues, submittedBy: event.submittedBy });
  // The proposalId is derived from the request id (:269-271, :1836-1839). The
  // receipt lookup runs first (:942-951, :1921-1925); a record found after it
  // was committed in between. Today the store replays a same-identity commit
  // before its guards (in-memory-record-store.ts:256-265), so the record that
  // this event would write is `duplicate` (§1.2): the service re-queries the
  // receipt (replay, or `idempotency_conflict`), and with no receipt for this
  // identity keeps today's create CAS ∅ code, `revision_conflict` (:985, :1991).
  if (state !== null) {
    return sameRecordedCandidate(state, candidate)
      ? reject('duplicate', 'revision_conflict',
        `proposal ${event.ref.proposalId} is already recorded with the same content; only its original receipt replays`)
      : reject('illegal', 'revision_conflict', `proposal ${event.ref.proposalId} already exists; only the original receipt replays`);
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

/** A Host or answer-derived candidate never carries an Agent submission provenance. */
function hostProvenanceProblem(event: Extract<PlanProposalEvent, { type: 'proposal_recorded' }>): PlanProposalTransition | null {
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

/** `readGoalScope` workspace + pin comparison of a proposal write (:955-961, :1941-1950). */
function recordScopeProblem(ctx: PlanProposalGuardContext): PlanProposalTransition | null {
  if (!ctx.goalInWorkspace) return reject('guard_failed', 'forbidden', 'the goal does not belong to the requested workspace');
  if (!ctx.pinsAgree) {
    return reject('stale', 'revision_conflict', 'the supplied version pins do not match the versions read in this call');
  }
  return null;
}

/** PLAN-02: the source is a real Plan of this Goal and still its active plan (:1959-1970). */
function agentSourceProblem(
  event: Extract<PlanProposalEvent, { type: 'proposal_recorded' }>,
  ctx: PlanProposalGuardContext,
): PlanProposalTransition | null {
  const source = ctx.source;
  if (source === null) return reject('illegal', 'invalid', 'an Agent proposal requires the source plan read through basedOn');
  if (source.ref.projectId !== event.ref.projectId || source.goalRef.goalId !== event.goalRef.goalId) {
    return reject('illegal', 'not_found', 'the source plan does not belong to the proposal goal');
  }
  if (!samePlanPointer(ctx.goal.activePlanRevision, source.ref)) {
    return reject('stale', 'revision_conflict', 'the source plan is not the Goal current active plan');
  }
  return null;
}

/**
 * PLAN-04/05 and the §3.4 `proposal_accepted` rows. Host `applyPlanChange`
 * (`plan-service.ts:1140-1215`); Agent `applyPlanChangeAsAgent` (`:2019-2106`),
 * whose decisionRefs and fresh admission checks run before the proposal read.
 */
function onProposalAccepted(
  state: PlanProposalMachineState,
  event: Extract<PlanProposalEvent, { type: 'proposal_accepted' }>,
  ctx: PlanProposalGuardContext,
): PlanProposalTransition {
  switch (event.adopter) {
    case 'host':
      break;
    case 'agent': {
      // :2034-2036, before the fresh admission (:2057-2062)
      if (event.decisionRefs.length > 0) {
        return reject('guard_failed', 'forbidden', 'an Agent future-plan apply does not accept decision references');
      }
      const admission = agentAdmissionProblem(ctx);
      if (admission !== null) return admission;
      break;
    }
    default:
      return unreachable(event.adopter, 'plan adopter');
  }
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
          return acceptCandidate(state, event, ctx);
        default:
          return unreachable(state, 'plan proposal status');
      }
    default:
      return unreachable(state, 'plan proposal kind');
  }
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

function acceptCandidate(
  proposal: CandidatePlanProposal,
  event: Extract<PlanProposalEvent, { type: 'proposal_accepted' }>,
  ctx: PlanProposalGuardContext,
): PlanProposalTransition {
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
  if (!ctx.goalInWorkspace) return reject('guard_failed', 'forbidden', 'the goal does not belong to the proposal workspace');
  if (!ctx.pinsAgree) {
    return reject('stale', 'revision_conflict', 'the supplied version pins do not match the versions read in this call');
  }
  return proposal.basedOn === null
    ? initialAdoption(proposal, event, ctx)
    : futureAdoption(proposal, event, ctx);
}

/** :2075-2087 — only this Run's own future candidate of its own Goal. */
function agentCandidateProblem(
  proposal: CandidatePlanProposal,
  event: Extract<PlanProposalEvent, { type: 'proposal_accepted' }>,
): PlanProposalTransition | null {
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
function initialAdoption(
  proposal: CandidatePlanProposal,
  event: Extract<PlanProposalEvent, { type: 'proposal_accepted' }>,
  ctx: PlanProposalGuardContext,
): PlanProposalTransition {
  // :1165
  if (event.decisionRefs.length > 0) {
    return reject('guard_failed', 'invalid', 'an initial plan adoption does not accept decision references');
  }
  // :1166-1170
  if (ctx.goal.activePlanRevision !== null) {
    return reject('stale', 'revision_conflict', 'the goal already has an active plan; an initial adoption cannot replace it');
  }
  const facts = ctx.initial;
  if (facts === null) {
    return reject('illegal', 'invalid', 'an initial adoption requires the origin, governance and draft admission facts');
  }
  const problem = first(
    // :1171-1179
    () => verdictProblem(facts.origin),
    () => verdictProblem(facts.governance),
    // :1180-1185
    () => draftAdmissionProblem('the initial plan is not admissible', facts),
  );
  if (problem !== null) return problem;
  const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: event.proposalRef.projectId,
    planId: proposal.draft.planId };
  const effects: PlanProposalEffect[] = [
    { kind: 'write_proposal' },
    { kind: 'write_plan_revision', ref: planRef, build: { from: 'initial_draft' } },
    { kind: 'move_goal_pointer', from: null, to: planRef },
    { kind: 'append_event', eventType: 'PlanRevisionAccepted' },
  ];
  if (proposal.draft.origin !== undefined) effects.push(guard({ target: 'origin_sources' }));
  effects.push(
    guard({ target: 'project' }), guard({ target: 'workspace' }), guard({ target: 'goal' }),
    guard({ target: 'proposal', expectedRevision: proposal.revision }),
    guard({ target: 'governance' }),
    guard({ target: 'plan_revision', ref: planRef, expectedRevision: null }),
  );
  return accept<PlanProposalMachineState, PlanProposalEffect>(acceptProposalRecord(proposal), effects);
}

/**
 * PLAN-05 + GOAL-03 + PLAN-08/09 (`applyFutureRevision`, `plan-service.ts:1676-1816`
 * → `plan-commit-compiler.ts:241-328`). Today every existing Task whose full
 * definition differs is "changed", including a disposition-only change, and
 * falls under the untraced rule (C7 splits it off in step 5.10).
 */
function futureAdoption(
  proposal: CandidatePlanProposal,
  event: Extract<PlanProposalEvent, { type: 'proposal_accepted' }>,
  ctx: PlanProposalGuardContext,
): PlanProposalTransition {
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
  const source = ctx.source;
  if (source === null) return reject('illegal', 'invalid', 'a future adoption requires the source plan read through basedOn');
  // :1709-1711
  if (source.ref.projectId !== event.proposalRef.projectId || source.goalRef.goalId !== proposal.goalRef.goalId) {
    return reject('illegal', 'not_found', 'the source plan does not belong to the proposal goal');
  }
  // :1712-1717 — the pointer only moves forward (a superseded source is stale).
  if (!samePlanPointer(ctx.goal.activePlanRevision, source.ref)) {
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
  const facts = ctx.future;
  if (facts === null) return reject('illegal', 'invalid', 'a future adoption requires the target, delta and task facts');
  // :1727-1733
  if (facts.targetExists) return reject('stale', 'revision_conflict', 'the target plan already exists');
  // :1737-1738 — includes "a Task was physically removed".
  if (facts.delta.status === 'unsupported') return reject('guard_failed', 'unsupported', facts.delta.reason);
  const delta = facts.delta;
  // :1740-1745 — obligation, gate, intent, role and new-Task-phase rules.
  const coverage = facts.coverage;
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
  const problem = first(
    // :1755-1761
    () => facts.pinnedPolicy === 'not_needed' ? null : verdictProblem(facts.pinnedPolicy),
    // :1762-1767
    () => draftAdmissionProblem('the future plan is not admissible', facts),
  );
  if (problem !== null) return problem;
  // :1769-1771 → plan-readers.ts:1238-1301
  const touched = [...new Set([...delta.changedTaskIds, ...delta.addedTaskIds])];
  const factsById = new Map(facts.touchedTaskFacts.map((entry) => [entry.taskId, entry]));
  const touchedFacts: FutureChangeTaskFactsV1[] = [];
  for (const taskId of touched) {
    const entry = factsById.get(taskId);
    if (entry === undefined) return reject('illegal', 'invalid', `the future-change facts of task ${taskId} were not read`);
    touchedFacts.push(entry);
  }
  const trace = futureChangeTraceProblem(touchedFacts);
  if (trace !== null) return reject('guard_failed', trace.code, trace.detail);
  const targetRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: event.proposalRef.projectId,
    planId: draft.planId };
  const effects: PlanProposalEffect[] = [
    { kind: 'write_proposal' },
    { kind: 'write_plan_revision', ref: targetRef, build: { from: 'future_delta', source: source.ref,
      changedTaskIds: delta.changedTaskIds, addedTaskIds: delta.addedTaskIds } },
    { kind: 'move_goal_pointer', from: source.ref, to: targetRef },
    { kind: 'append_event', eventType: 'PlanRevisionAccepted' },
    ...adopterCommitGuards(event.adopter).map(guard),
  ];
  if (facts.pinnedPolicy === 'ok') effects.push(guard({ target: 'pinned_policy' }));
  effects.push(
    guard({ target: 'project' }), guard({ target: 'workspace' }), guard({ target: 'goal' }),
    guard({ target: 'proposal', expectedRevision: proposal.revision }),
    guard({ target: 'plan_revision', ref: source.ref, expectedRevision: 1 }),
  );
  for (const taskId of touched) {
    effects.push(guard({ target: 'task_record_absent', record: 'TaskLease', taskId }),
      guard({ target: 'task_record_absent', record: 'TaskReduction', taskId }));
  }
  effects.push(guard({ target: 'plan_revision', ref: targetRef, expectedRevision: null }));
  return accept<PlanProposalMachineState, PlanProposalEffect>(acceptProposalRecord(proposal), effects);
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

// --------------------------------------------------------------------------
// PlanRevision (PLAN-08, PLAN-09; §3.4 PlanRevision rows)
// --------------------------------------------------------------------------

/** `absent` = no record; otherwise the derived status (`derivePlanRevisionStatus`). */
export type PlanRevisionMachineState = 'absent' | PlanRevisionStatus;

/**
 * `plan_adopted` from the point of view of one revision: `target` = this
 * revision is the adoption's new Plan (PLAN-08); `source` = the pointer moves
 * from this revision to its successor (PLAN-09). `plan_revision_rewritten`
 * stands for any attempt to change a stored revision: there is no such entry.
 */
export type PlanRevisionEvent =
  | { type: 'plan_adopted'; role: 'target' | 'source' }
  | { type: 'plan_revision_rewritten' };

/** PLAN-08: write the immutable revision under CAS ∅ (`plan-commit-compiler.ts:167,315`). */
export type PlanRevisionEffect = { kind: 'write_plan_revision'; expectedRevision: null };

export type PlanRevisionTransition = Transition<PlanRevisionMachineState, PlanRevisionEvent, PlanRevisionEffect>;

export function transitionPlanRevision(state: PlanRevisionMachineState, event: PlanRevisionEvent): PlanRevisionTransition {
  switch (event.type) {
    case 'plan_adopted':
      switch (event.role) {
        case 'target':
          return onAdoptedAsTarget(state);
        case 'source':
          return onAdoptedAsSource(state);
        default:
          return unreachable(event.role, 'plan revision role');
      }
    case 'plan_revision_rewritten':
      // `revision` is always 1 (`plan.ts:233`); the commit layer also guards the target ∅.
      return reject('illegal', 'invalid', 'a PlanRevision is immutable; a change adopts a new revision');
    default:
      return unreachable(event, 'plan revision event');
  }
}

/** PLAN-08; an existing target (adopted or superseded) is never pointed at again. */
function onAdoptedAsTarget(state: PlanRevisionMachineState): PlanRevisionTransition {
  switch (state) {
    case 'absent':
      return accept<PlanRevisionMachineState, PlanRevisionEffect>('adopted', [{ kind: 'write_plan_revision', expectedRevision: null }]);
    case 'adopted':
    case 'superseded':
      // plan-service.ts:1727-1733
      return reject('stale', 'revision_conflict', 'the target plan already exists');
    default:
      return unreachable(state, 'plan revision state');
  }
}

/** PLAN-09: the record is unchanged; "superseded" is derived from the pointer. */
function onAdoptedAsSource(state: PlanRevisionMachineState): PlanRevisionTransition {
  switch (state) {
    case 'absent':
      // readPlan (plan-readers.ts:388)
      return reject('illegal', 'not_found', 'the source plan does not exist');
    case 'adopted':
      return accept<PlanRevisionMachineState, PlanRevisionEffect>('superseded');
    case 'superseded':
      // plan-service.ts:1712-1717
      return reject('stale', 'revision_conflict', 'the source plan is not the Goal current active plan');
    default:
      return unreachable(state, 'plan revision state');
  }
}
