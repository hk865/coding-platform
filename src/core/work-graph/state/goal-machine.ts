/**
 * Goal machine (docs/refactor/STATE-MACHINES-SPEC.md §2): three independent
 * durable facts of one Goal, the desired state (`desiredState`,
 * `desiredStateRevision`, `desiredStateRequestedBy`, D-9), the active plan
 * pointer (`activePlanRevision`) and the formal completion record
 * (`GoalPhase`), plus the pure display reduction of the ten design names.
 *
 * - `transitionGoal` (GOAL-01..08 and the §2.4 rows): the owner looks up the
 *   receipt first, reads the Goal and the GoalPhase, builds `goalStateOf` and
 *   the `GoalGuardContext`, and writes `next` plus the translated `effects` in
 *   ONE RecordStore commit. A plan adoption is the same commit as §3 PLAN-04/05
 *   (`transitionPlanProposal` names the PlanRevision, the proposal, the event
 *   and the guards); this machine gives the moved Goal record. The §2.4
 *   refusal "Goal 已存在 × goal_created" is the store's answer to GOAL-01's
 *   Goal ∅ guard, as today, never a rejection from the pre-read Goal.
 * - `reduceGoalDisplay` (GOAL-17..27, GOAL-30) and `projectGoalRunStop`
 *   (`runStops`): never stored, never an execution command.
 * - The G7 fan-out identities (`goalFanOutRequestId`, `goalFanOutReason`,
 *   `goalResumeContinueRequestId`) and the GOAL-29 selection
 *   `findGoalResumeContinuations`. Each fan-out commit is a Run/ControlIntent
 *   or TaskRequeue commit judged by its own machine, never part of a Goal commit.
 *
 * A.2 step 2 (§15.2) scope:
 * - 已有 rows keep today's records byte for byte (pre-step-3 `commit-compiler.ts:113-120`,
 *   pre-step-3 `plan-commit-compiler.ts:144,293`, pre-step-3 `completion.ts:572-582`) and today's
 *   CoreError codes, checked in today's service order.
 * - 改造 rows keep TODAY's externally visible result; step 5.5 flips them: the
 *   `desiredState = active` guard of GOAL-07/08 (`busy`), the `busy` of a new
 *   completion for the active plan (§2.4, today a second `COMPLETED@r+1`), and
 *   the `cancelled` refusal of GOAL-02/03 (§2.4, `invalid`). No Goal is ever
 *   `paused`/`cancelled` before GOAL-04…06 exist, so none of them is reachable
 *   today.
 * - 新增 rows GOAL-04…06 keep their events in the union and answer `illegal`
 *   (`notYet`) from every state, together with their §2.4 refusals, so step 5
 *   only adds rows. The display reduction, `projectGoalRunStop`, the fan-out
 *   identities and the GOAL-29 selection are new pure functions with no
 *   writer today, implemented in full (§2.1, §2.3).
 *
 * Pure: imports only `src/contracts` and this directory (§14.4). Ids, instants
 * and pins come in the event payload; read facts in the guard context.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type {
  ControlIntentKindV1, ControlIntentRef, ControlIntentSnapshotV1,
} from '../../../contracts/control-intent.js';
import type { RunOutcome, RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalPhaseRef, GoalPhaseSnapshot } from '../../../contracts/goal-phase.js';
import type { GoalDesiredState, GoalRef, GoalSnapshot, WorkspaceRef } from '../../../contracts/ledger.js';
import type { Disposition, Phase, PlanRevisionRef, RequirementLevel, TaskKind } from '../../../contracts/plan.js';
import type { TaskReductionRef } from '../../../contracts/reduction.js';
import type {
  FailingCheckFactV1, TaskAutomationStopDetailV1, TaskAutomationStopReason, TaskAutomationVerdictV1,
  TaskFailureFactsV1, TaskPhaseCauseV1, TaskReworkSummaryEntryV1,
} from '../../../contracts/task-failure.js';
import {
  GOAL_FAN_OUT_ACTOR, reworkActorClassOf,
  type ReworkActorClass, type ReworkFailureClass, type StopRequester, type TaskRequeueTriggerV1,
  type TaskReworkOperation,
} from '../../../contracts/task-requeue.js';
import type { PlanProposalRef } from './plan-machine.js';
import { isPausedInterrupted, isRunFinished, runUnresolvedBlocker } from './run-machine.js';
import { stopRequesterOf } from './task-failure.js';
import { accept, notYet, reject, unreachable, type Rejected, type Transition } from './transition.js';

/** The Host Goal-resume fan-out actor (GOAL-29); defined in contracts, only re-exported here (§15.1). */
export { GOAL_FAN_OUT_ACTOR };

/** A Host (human/system) actor: the only writers of a Goal desired state. */
export type GoalHostActorRef = Extract<ActorRef, { kind: 'human' | 'system' }>;

/** The three Goal-level controls (G7, GOAL-04…06). */
export type GoalControl = 'pause' | 'resume' | 'cancel';

// -------------------------------------------------------------------------- //
// Record constructors (§14.1: the only writers of the Goal lifecycle fields)   //
// -------------------------------------------------------------------------- //

/**
 * GOAL-01: Goal@1, `active`, no plan (the pre-step-3 `commit-compiler.ts:113-120`
 * literal, same key order). The two D-9 fields are absent, which the contract reads as
 * `desiredStateRevision` 1 and `desiredStateRequestedBy` null (`ledger.ts`);
 * `encodeGoalSnapshot` writes this pre-A.2 shape for an unchanged Goal anyway,
 * and a fresh commit returns this value as is (`graph-repository.ts:319`).
 */
export function newGoalSnapshot(input: { ref: GoalRef; workspaceRef: WorkspaceRef; objective: string }): GoalSnapshot {
  return {
    ref: input.ref,
    workspaceRef: input.workspaceRef,
    objective: input.objective,
    desiredState: 'active',
    activePlanRevision: null,
    revision: 1,
  };
}

/**
 * GOAL-02/03: the pointer moves onto `planRef`, revision + 1. The desired state,
 * its revision and requester are kept (pre-step-3 `plan-commit-compiler.ts:144,293`
 * spread the Goal the same way).
 */
export function nextGoalPointer(goal: GoalSnapshot, planRef: PlanRevisionRef): GoalSnapshot {
  return { ...goal, activePlanRevision: planRef, revision: goal.revision + 1 };
}

/**
 * GOAL-04…06 (step 5.5): the new desired state; `desiredStateRevision` is the
 * new Goal revision (the fan-out epoch) and `desiredStateRequestedBy` the
 * caller (LA-7). Every Goal field is written explicitly, in the declaration
 * order of `ledger.ts`: the `GoalDesiredStateChanged` event carries exactly
 * this snapshot (`record-codecs.ts` `writtenGoalHasExactShape`).
 */
export function nextGoalDesiredState(goal: GoalSnapshot, input: {
  to: GoalDesiredState;
  requestedBy: GoalHostActorRef;
}): GoalSnapshot {
  const revision = goal.revision + 1;
  return {
    ref: goal.ref,
    workspaceRef: goal.workspaceRef,
    objective: goal.objective,
    desiredState: input.to,
    desiredStateRevision: revision,
    desiredStateRequestedBy: { kind: input.requestedBy.kind, id: input.requestedBy.id },
    activePlanRevision: goal.activePlanRevision,
    revision,
  };
}

/**
 * GOAL-07/08: `COMPLETED@previous+1` for the plan it was reduced against (the
 * pre-step-3 `completion.ts:572-582` literal, same key order).
 */
export function buildGoalPhaseSnapshot(input: {
  ref: GoalPhaseRef;
  /** The stored GoalPhase revision, null when there is none. */
  previousRevision: number | null;
  planRef: PlanRevisionRef;
  planRevision: number;
  adoptedTaskReductions: readonly { ref: TaskReductionRef; revision: number }[];
  satisfiedObligationIds: readonly string[];
  reducedAt: string;
}): GoalPhaseSnapshot {
  return {
    ref: input.ref,
    revision: (input.previousRevision ?? 0) + 1,
    schemaVersion: 1,
    planRef: input.planRef,
    planRevision: input.planRevision,
    phase: 'COMPLETED',
    adoptedTaskReductions: input.adoptedTaskReductions.map((entry) => ({ ref: entry.ref, revision: entry.revision })),
    satisfiedObligationIds: [...input.satisfiedObligationIds],
    reducedAt: input.reducedAt,
  };
}

// -------------------------------------------------------------------------- //
// Machine view (§2.6)                                                        //
// -------------------------------------------------------------------------- //

export type GoalNode = 'absent' | GoalDesiredState;

/** Whether the GoalPhase was reduced against the active plan (`plan-service.ts:1456-1459` `selectedPlanMatches`). */
export type GoalCompletionRelation = 'none' | 'for_active' | 'for_other';

export type GoalMachineState = {
  node: GoalNode;
  /** The fan-out epoch; 0 while `absent`, 1 for a Goal whose desired state never changed. */
  desiredStateRevision: number;
  activePlanRef: PlanRevisionRef | null;
  completion: GoalCompletionRelation;
  /** `reworkActorClassOf(null, desiredStateRequestedBy)`; null while it was never changed (GOAL-05, LA-7). */
  desiredStateRequestedByClass: ReworkActorClass | null;
  /** The stored records (`null` = ∅). An accepted transition's `next` carries the whole next records. */
  goal: GoalSnapshot | null;
  goalPhase: GoalPhaseSnapshot | null;
};

/** The machine state of the stored Goal and GoalPhase. */
export function goalStateOf(goal: GoalSnapshot | null, goalPhase: GoalPhaseSnapshot | null): GoalMachineState {
  const pointer = goal?.activePlanRevision ?? null;
  const completion: GoalCompletionRelation = goalPhase === null ? 'none'
    : pointer !== null && samePlan(goalPhase.planRef, pointer) ? 'for_active' : 'for_other';
  if (goal === null) {
    return { node: 'absent', desiredStateRevision: 0, activePlanRef: null, completion, desiredStateRequestedByClass: null,
      goal: null, goalPhase };
  }
  const requestedBy = goal.desiredStateRequestedBy ?? null;
  return {
    node: goal.desiredState,
    desiredStateRevision: goal.desiredStateRevision ?? 1,
    activePlanRef: pointer,
    completion,
    desiredStateRequestedByClass: requestedBy === null ? null : reworkActorClassOf(null, requestedBy),
    goal,
    goalPhase,
  };
}

// -------------------------------------------------------------------------- //
// Events, guard context, effects (§2.2)                                       //
// -------------------------------------------------------------------------- //

/** `setGoalControl{goalRef, control, reason}` (GOAL-04…06): Host trusted context only. */
export type GoalControlRequest = {
  /** The Goal pin; must equal the current revision. */
  expectedGoalRevision: number;
  /** The GoalPhase pin; 0 when the caller read none. */
  expectedGoalPhaseRevision: number;
  reason: string | null;
  /** The caller; becomes `desiredStateRequestedBy`. */
  requestedBy: GoalHostActorRef;
};

/**
 * §2.2. `goal_created` carries the normalized objective (the owner validates
 * the command first); `plan_adopted` is the Goal side of PLAN-04/05 (`basedOn`
 * = the candidate's source, `target` = the new PlanRevision); `goal_completed`
 * carries the caller's two pins and the reduction instant.
 */
export type GoalEvent =
  | { type: 'goal_created'; ref: GoalRef; workspaceRef: WorkspaceRef; objective: string }
  | { type: 'plan_adopted'; basedOn: PlanRevisionRef | null; target: PlanRevisionRef }
  | ({ type: 'goal_pause_requested' } & GoalControlRequest)
  | ({ type: 'goal_resume_requested' } & GoalControlRequest)
  | ({ type: 'goal_cancel_requested' } & GoalControlRequest)
  | { type: 'goal_completed'; expectedGoalRevision: number; expectedGoalPhaseRevision: number; reducedAt: string };

export type GoalEventType = GoalEvent['type'];

export const GOAL_EVENT_TYPES: readonly GoalEventType[] = Object.freeze([
  'goal_created', 'plan_adopted', 'goal_pause_requested', 'goal_resume_requested', 'goal_cancel_requested', 'goal_completed',
]);

/**
 * What `completeGoal` read after the pointer (pre-step-3 `completion.ts:529-569`): the
 * active Plan, `evaluateGoalCompletion` (`completion-policy.ts:178-244`), and
 * the formal reductions it consumes. `requiresReviewer` adds today's reviewer
 * reason to an incomplete answer (pre-step-3 `completion.ts:549-554`).
 */
export type GoalCompletionFacts = {
  plan: { ref: PlanRevisionRef; planRevision: number };
  evaluation: { completed: boolean; reasons: readonly string[] };
  requiresReviewer: boolean;
  adoptedTaskReductions: readonly { ref: TaskReductionRef; revision: number }[];
  satisfiedObligationIds: readonly string[];
};

export type GoalGuardContext = {
  /** `reworkActorClassOf(principal, actor)` of the caller; null for a principal that is not a Host. GOAL-05 (step 5.5). */
  callerClass: ReworkActorClass | null;
  /** `goal_created`: `compareCallerGoalPins` agreed with the versions read (`task-service.ts:249-253`). */
  scopePinsAgree: boolean;
  /** `goal_completed`: the Goal belongs to the trusted workspace (pre-step-3 `completion.ts:522`). */
  goalInWorkspace: boolean;
  /** `goal_completed`: null when the service did not read them (no pointer). */
  completion: GoalCompletionFacts | null;
};

/**
 * The CAS guards of the one commit:
 * - `project`/`workspace`: the revisions read by `readGoalScope` (GOAL-01);
 * - `goal`: `null` = must not exist (GOAL-01), otherwise the read-only Goal@rev (GOAL-07/08);
 * - `goal_phase`: the GoalPhase read (`null` = must not exist);
 * - `plan_revision`: the active Plan at the revision read;
 * - `pinned_policy`, `task_facts`: the guards of the pinned completion policy and the canonical task facts.
 */
export type GoalCommitGuard =
  | { target: 'project' | 'workspace' | 'pinned_policy' | 'task_facts' }
  | { target: 'goal'; expectedRevision: number | null }
  | { target: 'goal_phase'; expectedRevision: number | null }
  | { target: 'plan_revision'; ref: PlanRevisionRef };

/**
 * Effects the owner translates into ONE commit:
 * - `write_goal` / `write_goal_phase`: the record in `next`;
 * - `append_event`: the durable event of the commit;
 * - `guard`: one CAS guard.
 * A plan adoption emits only `write_goal`: the rest of that commit is §3 PLAN-04/05.
 */
export type GoalEffect =
  | { kind: 'write_goal' }
  | { kind: 'write_goal_phase' }
  | { kind: 'append_event'; eventType: 'GoalCreated' | 'GoalCompleted' | 'GoalDesiredStateChanged' }
  | { kind: 'guard'; guard: GoalCommitGuard };

export type GoalTransition = Transition<GoalMachineState, GoalEvent, GoalEffect>;

// -------------------------------------------------------------------------- //
// Shared helpers                                                              //
// -------------------------------------------------------------------------- //

function refKey(ref: object): string {
  return canonicalJson(ref as unknown as JsonValue);
}
function samePlan(left: PlanRevisionRef, right: PlanRevisionRef): boolean {
  return refKey(left) === refKey(right);
}
function samePlanPointer(left: PlanRevisionRef | null, right: PlanRevisionRef | null): boolean {
  return left === null || right === null ? left === right : samePlan(left, right);
}
function sameIntent(left: ControlIntentRef, right: ControlIntentRef): boolean {
  return left.projectId === right.projectId && left.workspaceId === right.workspaceId && left.intentId === right.intentId;
}

function guard(value: GoalCommitGuard): GoalEffect {
  return { kind: 'guard', guard: value };
}

// -------------------------------------------------------------------------- //
// Rows                                                                        //
// -------------------------------------------------------------------------- //

/**
 * GOAL-01 (`task-service.ts:192-309` → `commit-compiler.ts:91-137`). The pins
 * are compared before the commit (`task-service.ts:249-253`). Goal absence is
 * NOT judged from the pre-read Goal: it comes only from the commit's Goal ∅
 * guard (`task-service.ts:168`), which the store checks after its
 * in-transaction receipt lookup. So a same-identity request committed between
 * the owner's lookup miss and its read still replays its receipt, and a new
 * identity on an existing Goal gets the store's `revision_conflict`
 * (`task-service.ts:301-303`, the §2.4 "Goal 已存在" row) with today's reason.
 * The pre-read Goal therefore never rejects here (`task-service.ts:255-257`).
 */
function onGoalCreated(
  state: GoalMachineState,
  event: Extract<GoalEvent, { type: 'goal_created' }>,
  ctx: GoalGuardContext,
): GoalTransition {
  if (!ctx.scopePinsAgree) {
    return reject('stale', 'revision_conflict', 'the supplied version pins do not match the versions read in this call');
  }
  const goal = newGoalSnapshot({ ref: event.ref, workspaceRef: event.workspaceRef, objective: event.objective });
  return accept<GoalMachineState, GoalEffect>(goalStateOf(goal, state.goalPhase), [
    { kind: 'write_goal' },
    { kind: 'append_event', eventType: 'GoalCreated' },
    guard({ target: 'project' }), guard({ target: 'workspace' }), guard({ target: 'goal', expectedRevision: null }),
  ]);
}

/**
 * GOAL-02 (null → P1) / GOAL-03 (Pk → Pk+1), the Goal side of §3 PLAN-04/05,
 * in today's order and with today's texts, the same as `transitionPlanProposal`
 * (so both machines answer one adoption commit alike): the pointer only moves
 * forward from the candidate's source (pre-step-3 `plan-service.ts:1166-1170`,
 * `:1712-1717`), then the target must be a new plan (`:1724-1726`). The plan
 * service runs it on the plan machine's `move_goal_pointer` of the same commit.
 * A pointer already on the target is a stale source like any other: the owner's
 * same-identity recheck after a rejection (`plan-service.ts:1120-1138,
 * 1225-1229`) replays the adoption that moved it. Step 5.5: a `cancelled` Goal
 * answers `illegal`/`invalid` (§2.4); `paused` stays legal (W16 is a plan
 * adoption, not rework).
 */
function onPlanAdopted(state: GoalMachineState, event: Extract<GoalEvent, { type: 'plan_adopted' }>): GoalTransition {
  switch (state.node) {
    case 'absent':
      return reject('illegal', 'not_found', 'the goal does not exist');
    case 'active':
    case 'paused':
      break;
    case 'cancelled':
      // Today's accept path (no writer of `cancelled` before GOAL-06); step 5.5: `illegal`/`invalid` (§2.4).
      break;
    default:
      return unreachable(state.node, 'goal node');
  }
  // `goalStateOf` keeps the node and the record together; this only narrows the type.
  const goal = state.goal;
  if (goal === null) return reject('illegal', 'not_found', 'the goal does not exist');
  if (!samePlanPointer(state.activePlanRef, event.basedOn)) {
    return event.basedOn === null
      ? reject('stale', 'revision_conflict', 'the goal already has an active plan; an initial adoption cannot replace it')
      : reject('stale', 'revision_conflict', 'the source plan is not the Goal current active plan');
  }
  if (event.basedOn !== null && samePlan(event.basedOn, event.target)) {
    return reject('illegal', 'invalid', 'the target planId must be a new, unused reference');
  }
  return accept<GoalMachineState, GoalEffect>(goalStateOf(nextGoalPointer(goal, event.target), state.goalPhase),
    [{ kind: 'write_goal' }]);
}

/**
 * The GOAL-07/08 guards of `completeGoalFromHost` in the pre-step-3
 * `completion.ts:519-555` order: workspace, Goal pin, pointer, then the facts'
 * plan, the GoalPhase pin and the reduction. Exported so the owner stops where
 * it always stopped: right after the Goal read, with `completion` null (the
 * facts, the GoalPhase and the reduction are not read yet and hold), and after
 * the GoalPhase read and the pure reduction, before it reads the pinned
 * policy. `transitionGoal` re-runs them, then requires the facts.
 */
export function goalCompletionProblem(
  state: GoalMachineState,
  event: Pick<Extract<GoalEvent, { type: 'goal_completed' }>, 'expectedGoalRevision' | 'expectedGoalPhaseRevision'>,
  ctx: Pick<GoalGuardContext, 'goalInWorkspace' | 'completion'>,
): Rejected | null {
  switch (state.node) {
    case 'absent':
      return reject('illegal', 'not_found', 'the Goal does not exist');
    case 'active':
      break;
    case 'paused':
    case 'cancelled':
      // Today the desired state is not read (no writer before GOAL-04/06); step 5.5: `guard_failed`/`busy` (§2.4).
      break;
    default:
      return unreachable(state.node, 'goal node');
  }
  // `goalStateOf` keeps the node and the record together; this only narrows the type.
  const goal = state.goal;
  if (goal === null) return reject('illegal', 'not_found', 'the Goal does not exist');
  // :522
  if (!ctx.goalInWorkspace) return reject('guard_failed', 'forbidden', 'the Goal belongs to another workspace');
  // :523-525
  if (goal.revision !== event.expectedGoalRevision) {
    return reject('stale', 'revision_conflict', 'the Goal changed since the caller read it');
  }
  // :526-527
  const pointer = state.activePlanRef;
  if (pointer === null) return reject('guard_failed', 'incomplete', 'the Goal has no adopted Plan to complete');
  const facts = ctx.completion;
  if (facts === null) return null;
  if (!samePlan(facts.plan.ref, pointer)) {
    return reject('illegal', 'invalid', 'the completion facts were read for another plan than the Goal active plan');
  }
  // :539-546
  const persistedPhaseRevision = state.goalPhase?.revision ?? null;
  const expectedPhaseRevision = event.expectedGoalPhaseRevision === 0 ? null : event.expectedGoalPhaseRevision;
  if (persistedPhaseRevision !== expectedPhaseRevision) {
    return reject('stale', 'revision_conflict', 'the GoalPhase changed since the caller read it');
  }
  // :548-555
  if (!facts.evaluation.completed) {
    const reasons = [...facts.evaluation.reasons];
    if (facts.requiresReviewer) reasons.push('a required independent review requirement has no formal producer yet');
    return reject('guard_failed', 'incomplete', `Goal ${goal.ref.goalId} is not complete: ${reasons.join('; ')}`);
  }
  return null;
}

/**
 * GOAL-07 (no GoalPhase) / GOAL-08 (a GoalPhase for an older plan),
 * `completeGoalFromHost` (`tasks/completion.ts`) in today's order
 * (`goalCompletionProblem`). Today a GoalPhase already for the active plan is
 * completed again as `@r+1`, and the desired state is not read; step 5.5
 * refuses both with `busy` (§2.4).
 */
function onGoalCompleted(
  state: GoalMachineState,
  event: Extract<GoalEvent, { type: 'goal_completed' }>,
  ctx: GoalGuardContext,
): GoalTransition {
  const problem = goalCompletionProblem(state, event, ctx);
  if (problem !== null) return problem;
  const facts = ctx.completion;
  if (facts === null) return reject('illegal', 'invalid', 'goal_completed requires the completion facts of the active plan');
  // `goalCompletionProblem` refused ∅ above; this only narrows the type.
  const goal = state.goal!;
  const persistedPhaseRevision = state.goalPhase?.revision ?? null;
  const goalPhase = buildGoalPhaseSnapshot({
    ref: { aggregateType: 'GoalPhase', projectId: goal.ref.projectId, goalId: goal.ref.goalId },
    previousRevision: persistedPhaseRevision,
    planRef: facts.plan.ref,
    planRevision: facts.plan.planRevision,
    adoptedTaskReductions: facts.adoptedTaskReductions,
    satisfiedObligationIds: facts.satisfiedObligationIds,
    reducedAt: event.reducedAt,
  });
  // :584-590
  return accept<GoalMachineState, GoalEffect>(goalStateOf(goal, goalPhase), [
    { kind: 'write_goal_phase' },
    { kind: 'append_event', eventType: 'GoalCompleted' },
    guard({ target: 'goal', expectedRevision: goal.revision }),
    guard({ target: 'plan_revision', ref: facts.plan.ref }),
    guard({ target: 'goal_phase', expectedRevision: persistedPhaseRevision }),
    guard({ target: 'pinned_policy' }),
    guard({ target: 'task_facts' }),
  ]);
}

/** §2 Goal machine (GOAL-01..08 and the §2.4 rows). */
export function transitionGoal(state: GoalMachineState, event: GoalEvent, ctx: GoalGuardContext): GoalTransition {
  switch (event.type) {
    case 'goal_created':
      return onGoalCreated(state, event, ctx);
    case 'plan_adopted':
      return onPlanAdopted(state, event);
    case 'goal_pause_requested':
      return notYet('GOAL-04');
    case 'goal_resume_requested':
      return notYet('GOAL-05');
    case 'goal_cancel_requested':
      return notYet('GOAL-06');
    case 'goal_completed':
      return onGoalCompleted(state, event, ctx);
    default:
      return unreachable(event, 'goal event');
  }
}

// -------------------------------------------------------------------------- //
// G7 fan-out identity (§2.3 扇出身份与重驱协议)                                 //
// -------------------------------------------------------------------------- //

function goalIdentity(goalRef: GoalRef): JsonValue {
  return { aggregateType: goalRef.aggregateType, projectId: goalRef.projectId, goalId: goalRef.goalId };
}
function runIdentity(runRef: RunRef): JsonValue {
  return { aggregateType: runRef.aggregateType, projectId: runRef.projectId, goalId: runRef.goalId, runId: runRef.runId };
}

/**
 * The deterministic requestId of the fan-out control of ONE Run in ONE epoch:
 * submitted by `GOAL_FAN_OUT_ACTOR`, the same epoch and Run always give the
 * same `intentId` (`control-service.ts:104-108,346`), so a re-drive finds the
 * original intent instead of submitting again.
 */
export function goalFanOutRequestId(goalRef: GoalRef, desiredStateRevision: number, runRef: RunRef, control: GoalControl): string {
  const digest = sha256Hex(canonicalJson({ goal: goalIdentity(goalRef), run: runIdentity(runRef) }));
  return `goal-fan-out:${control}@${String(desiredStateRevision)}:${digest}`;
}

/** The deterministic reason text of a fan-out control (`goal:<goalId>:<control>@<desiredStateRevision>`). */
export function goalFanOutReason(goalRef: GoalRef, control: GoalControl, desiredStateRevision: number): string {
  return `goal:${goalRef.goalId}:${control}@${String(desiredStateRevision)}`;
}

/** GOAL-29: the requestId of the Goal-resume continuation of one afterRun; at most one per resume epoch and Run. */
export function goalResumeContinueRequestId(goalRef: GoalRef, resumedEpoch: number, afterRunRef: RunRef): string {
  const digest = sha256Hex(canonicalJson({ goal: goalIdentity(goalRef), afterRun: runIdentity(afterRunRef) }));
  return `goal-resume-continue@${String(resumedEpoch)}:${digest}`;
}

// -------------------------------------------------------------------------- //
// GOAL-29: Goal-resume continuations (C4)                                      //
// -------------------------------------------------------------------------- //

/** One work Task of the `readCanonicalTaskFacts` window. */
export type GoalResumeTaskFactsV1 = {
  taskId: string;
  taskKind: TaskKind;
  /** The selected Run (lease holder); null without one. */
  selectedRun: RunSnapshot | null;
  /** The ControlIntent at `selectedRun.controlState.intentRef`; null without a pointer. */
  pointerIntent: ControlIntentSnapshotV1 | null;
  /** A TaskRequeue already covers the selected Run (P4). */
  covered: boolean;
};

export type GoalResumeContinuationV1 = {
  taskId: string;
  afterRunRef: RunRef;
  /** The fan-out pause epoch E < resumedEpoch whose intent paused the Run. */
  pausedEpoch: number;
  /** `goalResumeContinueRequestId(goalRef, resumedEpoch, afterRunRef)`. */
  requestId: string;
  trigger: TaskRequeueTriggerV1;
};

/**
 * GOAL-29 (§2.3): the work Tasks whose selected Run ended paused-interrupted
 * (`isPausedInterrupted`, RUN-24) by THIS Goal's fan-out pause and that no
 * TaskRequeue covers yet. The pause epoch is found by a bounded recomputation
 * over E ∈ [1, resumedEpoch), never by parsing text: it is usually the resume
 * event's `pausedEpoch`, but a lost continuation can leave a Run on an older
 * epoch's intent. `fanOutIntentRefFor` is `controlIntentRefFor(GOAL_FAN_OUT_ACTOR,
 * scope, requestId)` (control-service), injected because the intent identity
 * digest belongs to the control owner. A pause a person submitted alone is
 * never selected. Nothing is returned while the Goal is not `active`.
 */
export function findGoalResumeContinuations(input: {
  goal: Pick<GoalSnapshot, 'ref' | 'desiredState' | 'desiredStateRevision'>;
  tasks: readonly GoalResumeTaskFactsV1[];
  fanOutIntentRefFor: (requestId: string) => ControlIntentRef;
}): GoalResumeContinuationV1[] {
  const goal = input.goal;
  switch (goal.desiredState) {
    case 'active':
      break;
    case 'paused':
    case 'cancelled':
      return [];
    default:
      return unreachable(goal.desiredState, 'goal desired state');
  }
  const resumedEpoch = goal.desiredStateRevision ?? 1;
  const continuations: GoalResumeContinuationV1[] = [];
  for (const task of input.tasks) {
    const run = task.selectedRun;
    const intent = task.pointerIntent;
    if (task.taskKind !== 'work' || task.covered || run === null || intent === null) continue;
    if (!isPausedInterrupted(run)) continue;
    const observation = run.reconciliation?.observation;
    if (observation === undefined || observation.kind !== 'interrupted_clean' || observation.pausedIntentRef === null) continue;
    const pausedIntentRef = observation.pausedIntentRef;
    if (intent.kind !== 'pause' || stopRequesterOf(intent) !== 'goal_fan_out' || !sameIntent(intent.ref, pausedIntentRef)) continue;
    for (let epoch = 1; epoch < resumedEpoch; epoch += 1) {
      const fanOutRef = input.fanOutIntentRefFor(goalFanOutRequestId(goal.ref, epoch, run.ref, 'pause'));
      if (!sameIntent(fanOutRef, pausedIntentRef)) continue;
      continuations.push({
        taskId: task.taskId,
        afterRunRef: run.ref,
        pausedEpoch: epoch,
        requestId: goalResumeContinueRequestId(goal.ref, resumedEpoch, run.ref),
        trigger: { kind: 'goal_resume', goalRef: goal.ref, resumedEpoch, pausedEpoch: epoch },
      });
      break;
    }
  }
  return continuations;
}

// -------------------------------------------------------------------------- //
// runStops (§2.1 projectGoalRunStop)                                          //
// -------------------------------------------------------------------------- //

/** A control capability of the Run's kind or adapter: the capability report (D-15) or a delivery `unsupported` answer. */
export type GoalRunControlCapabilityV1 = { status: 'supported' } | { status: 'unsupported'; reason: string };

export type GoalRunStopInputV1 = {
  run: RunSnapshot;
  /** The ControlIntent at `run.controlState.intentRef`, read after the window; null without a pointer. */
  pointedIntent: ControlIntentSnapshotV1 | null;
  /** This epoch's fan-out intent ref of the Run (`controlIntentRefFor(GOAL_FAN_OUT_ACTOR, …)`). */
  fanOutIntentRef: ControlIntentRef;
  capability: GoalRunControlCapabilityV1;
};

/** The actual state of one Run under a non-active Goal, in the order of §2.1 (orders 0..8). */
export type GoalRunStopStateV1 =
  /** 0: `pausedBy` of the pointer's pause intent (`goal_fan_out`: continued when the Goal resumes). */
  | { kind: 'paused_interrupted'; pausedBy: StopRequester }
  /** 1 */
  | { kind: 'ended'; outcome: Exclude<RunOutcome, 'outcome_unknown'> }
  /** 2 (D-4 待核对) */
  | { kind: 'unknown_outcome' }
  /** 3 */
  | { kind: 'unsupported'; reason: string }
  /** 4 */
  | { kind: 'stop_requested' }
  /** 5 */
  | { kind: 'paused' }
  | { kind: 'cancelled' }
  /** 6 */
  | { kind: 'stop_unknown' }
  /** 7 */
  | { kind: 'other_intent'; intentRef: ControlIntentRef; intentKind: ControlIntentKindV1; status: ControlIntentSnapshotV1['status'] }
  /** 8: the driver retries. */
  | { kind: 'not_delivered' };

export type GoalRunStopV1 = { runRef: RunRef; stop: GoalRunStopStateV1 };

function otherIntent(intent: ControlIntentSnapshotV1): GoalRunStopStateV1 {
  return { kind: 'other_intent', intentRef: intent.ref, intentKind: intent.kind, status: intent.status };
}

/**
 * The actual state of one Run (§2.1 `runStops`). The intent may be newer than
 * the Run snapshot; only the intent's own monotone status is read (D-8), never
 * a Run state inferred from it. Each Run is shown on its own: a `PAUSED` or
 * `CANCELLED` headline never means every Run has stopped (B08).
 */
export function projectGoalRunStop(
  run: RunSnapshot,
  pointedIntent: ControlIntentSnapshotV1 | null,
  fanOutIntentRef: ControlIntentRef,
  capability: GoalRunControlCapabilityV1,
): GoalRunStopV1 {
  return { runRef: run.ref, stop: runStopState(run, pointedIntent, fanOutIntentRef, capability) };
}

function runStopState(
  run: RunSnapshot,
  pointedIntent: ControlIntentSnapshotV1 | null,
  fanOutIntentRef: ControlIntentRef,
  capability: GoalRunControlCapabilityV1,
): GoalRunStopStateV1 {
  // 0: before 1, because this Run ended `crashed` but is not a failure (C4).
  if (isPausedInterrupted(run)) return { kind: 'paused_interrupted', pausedBy: stopRequesterOf(pointedIntent) };
  if (isRunFinished(run)) {
    // 2 (an ended Run without an outcome is not a known end either)
    if (run.outcome === null || run.outcome === 'outcome_unknown') return { kind: 'unknown_outcome' };
    // 1
    return { kind: 'ended', outcome: run.outcome };
  }
  // 3
  if (capability.status === 'unsupported') return { kind: 'unsupported', reason: capability.reason };
  if (pointedIntent === null) return { kind: 'not_delivered' };
  // 7
  if (!sameIntent(pointedIntent.ref, fanOutIntentRef)) return otherIntent(pointedIntent);
  switch (pointedIntent.status) {
    case 'queued':
      return { kind: 'stop_requested' };
    case 'applied': {
      const kind = pointedIntent.observation.kind;
      if (kind === 'paused') return { kind: 'paused' };
      if (kind === 'cancelled') return { kind: 'cancelled' };
      // A fan-out intent is a pause or a cancel: no other applied fate is one of rows 4..6.
      return otherIntent(pointedIntent);
    }
    case 'outcome_unknown':
      return { kind: 'stop_unknown' };
    case 'superseded':
      // The pointer moves to the superseding intent in the same commit (D-8); kept total.
      return otherIntent(pointedIntent);
    default:
      return unreachable(pointedIntent, 'control intent status');
  }
}

// -------------------------------------------------------------------------- //
// Display reduction (§2.1 reduceGoalDisplay: GOAL-17..27, GOAL-30)            //
// -------------------------------------------------------------------------- //

/** The ten design names (§2 Goal). Never stored, never an execution command. */
export type GoalDisplayPhase =
  | 'PLANNING' | 'RUNNING' | 'CHANGE_PENDING' | 'NEEDS_DECISION' | 'BLOCKED' | 'FAILED'
  | 'PAUSED' | 'CANCELLED' | 'COMPLETED' | 'ACCEPTED_PARTIAL';

export const GOAL_DISPLAY_PHASES: readonly GoalDisplayPhase[] = Object.freeze([
  'PLANNING', 'RUNNING', 'CHANGE_PENDING', 'NEEDS_DECISION', 'BLOCKED', 'FAILED', 'PAUSED', 'CANCELLED', 'COMPLETED',
  'ACCEPTED_PARTIAL',
]);

/** The rows of the display table, in priority order. */
export type GoalDisplayRow =
  | 'GOAL-17' | 'GOAL-18' | 'GOAL-19' | 'GOAL-20' | 'GOAL-21' | 'GOAL-22' | 'GOAL-23' | 'GOAL-30'
  | 'GOAL-24' | 'GOAL-25' | 'GOAL-26' | 'GOAL-27';

export const GOAL_DISPLAY_ROWS: readonly GoalDisplayRow[] = Object.freeze([
  'GOAL-17', 'GOAL-18', 'GOAL-19', 'GOAL-20', 'GOAL-21', 'GOAL-22', 'GOAL-23', 'GOAL-30',
  'GOAL-24', 'GOAL-25', 'GOAL-26', 'GOAL-27',
]);

/** One Task of the active plan, read in the same `readGoalDisplayFacts` window as `queryTaskGraph`'s `TaskRow`. */
export type GoalDisplayTaskFactsV1 = {
  taskId: string;
  taskKind: TaskKind;
  requirementLevel: RequirementLevel;
  disposition: Disposition;
  /** `TaskRow.effectivePhase` (`projectTaskPhase`). */
  phase: Phase;
  /** `TaskRow.phaseCause`; null when absent. */
  phaseCause: TaskPhaseCauseV1 | null;
  /** `TaskRow.eligibility.eligible`: the Task can be claimed now. */
  dispatchable: boolean;
  /** `TaskRow.failure`; null when absent (no failure facts: running, satisfied, a gate without a chain). */
  failure: Pick<TaskFailureFactsV1, 'failureClass' | 'round' | 'automation'> | null;
  /** `TaskRow.rework.entries` ([] when absent): the class of the TaskRequeue a `claim_requeued` verdict claims. */
  reworkEntries: readonly Pick<TaskReworkSummaryEntryV1, 'ref' | 'failureClass'>[];
  /** Gate only: the work Task ids inside its scope (goal/stage/module); [] for a work Task. */
  coveredTaskIds: readonly string[];
};

/**
 * Every input of the reduction, read in one window (`readGoalDisplayFacts`,
 * §2.1). `tasks` are in active-plan task order; `runStopInputs` are the Runs
 * whose actual state is shown while the Goal is not `active`.
 */
export type GoalDisplayFactsV1 = {
  desiredState: GoalDesiredState;
  activePlanRef: PlanRevisionRef | null;
  /** `GoalCompletionView` (`plan-contracts.ts:96-98`) without the snapshot. */
  completion: { status: 'not_recorded' } | { status: 'recorded'; selectedPlanMatches: boolean };
  /** GOAL-19: declared, no writer (D-9), so the input is always null. */
  partialAcceptance: null;
  /** `findPendingProposal` (`plan-readers.ts:441-495`). */
  pendingProposal: { ref: PlanProposalRef; basedOn: PlanRevisionRef | null } | null;
  tasks: readonly GoalDisplayTaskFactsV1[];
  /** `readCanonicalTaskFacts(...).runsByTaskId`: every Run candidate of the Goal. */
  runsByTaskId: ReadonlyMap<string, readonly RunSnapshot[]>;
  runStopInputs: readonly GoalRunStopInputV1[];
};

/** The eight stop reasons GOAL-30 reports (`unknown_outcome` belongs to GOAL-23). */
export type GoalStopCauseCode = Exclude<TaskAutomationStopReason, 'unknown_outcome'>;

/** The causes of §2.1 (原因码 table, plus the GOAL-21/24/25/26 causes). */
export type GoalDisplayCauseV1 =
  /** GOAL-21 */
  | { code: 'initial_plan_pending'; proposalRef: PlanProposalRef }
  /** GOAL-23: a Run that ended unreconciled (`runUnresolvedBlocker`, ended branches). */
  | { code: 'unknown_outcome'; taskId: string; runRef: RunRef }
  /** GOAL-30: `verdict.stopped` of an active Task. */
  | { code: GoalStopCauseCode; taskId: string; detail: TaskAutomationStopDetailV1 }
  /** GOAL-30: required work deferred with nothing required left to run. */
  | { code: 'required_task_deferred'; taskIds: string[] }
  /** GOAL-24 */
  | { code: 'task_failed'; taskId: string }
  /** GOAL-25 (a) */
  | { code: 'task_blocked'; taskId: string }
  /** GOAL-25 (b): the unfinished required active Tasks. */
  | { code: 'no_dispatchable_work'; taskIds: string[] }
  /** GOAL-26 */
  | { code: 'change_pending'; proposalRef: PlanProposalRef }
  /** GOAL-27 running causes ("等待推进": no periodic scheduler, GAP-48). */
  | { code: 'auto_rework_pending'; taskId: string; operation: TaskReworkOperation; failureClass: ReworkFailureClass | null }
  | { code: 'auto_rework_count'; taskId: string; operation: TaskReworkOperation; n: number; cap: number }
  | { code: 'gate_verifying'; gateTaskId: string }
  | { code: 'gate_fix_in_progress'; gateTaskId: string; failingChecks: FailingCheckFactV1[] }
  | { code: 'awaiting_gate'; gateTaskId: string };

export type GoalDisplayV1 = {
  phase: GoalDisplayPhase;
  /** The row that decided `phase`. */
  row: GoalDisplayRow;
  /** That row's cause; null for a row without one (GOAL-17/18/20/22/27). */
  cause: GoalDisplayCauseV1 | null;
  /**
   * Every cause the rows find, in row order then active-plan task order. A row
   * kept from the headline by a starting|running Run still lists its causes
   * (GOAL-24, GOAL-25 (a), GOAL-30), so a failure or a stop is never hidden.
   */
  causes: GoalDisplayCauseV1[];
  /** Only while `desiredState ≠ active` (GOAL-17/20 "附 runStops"); null otherwise. */
  runStops: GoalRunStopV1[] | null;
};

type DisplayHit = { row: GoalDisplayRow; phase: GoalDisplayPhase; cause: GoalDisplayCauseV1 | null };
type RankedCause = { index: number; required: boolean; cause: GoalDisplayCauseV1 };

const NO_VERDICT: TaskAutomationVerdictV1 = { kind: 'none' };

function verdictOf(task: GoalDisplayTaskFactsV1): TaskAutomationVerdictV1 {
  return task.failure?.automation.verdict ?? NO_VERDICT;
}

/** `requeue`, `reverify`, `claim_requeued`: an automatic rework the owner would accept now. */
function isPendingVerdict(verdict: TaskAutomationVerdictV1): boolean {
  switch (verdict.kind) {
    case 'requeue':
    case 'reverify':
    case 'claim_requeued':
      return true;
    case 'none':
    case 'stopped':
      return false;
    default:
      return unreachable(verdict, 'automation verdict');
  }
}

/** GOAL-24/25: a Task whose verdict is pending or `stopped` is reported by GOAL-27/GOAL-30 instead (C8). */
function decidedByAutomation(task: GoalDisplayTaskFactsV1): boolean {
  const verdict = verdictOf(task);
  return verdict.kind === 'stopped' || isPendingVerdict(verdict);
}

function isGoalStopCause(reason: TaskAutomationStopReason): reason is GoalStopCauseCode {
  return reason !== 'unknown_outcome';
}

type DesiredStateHit = { row: 'GOAL-17'; phase: 'CANCELLED' } | { row: 'GOAL-20'; phase: 'PAUSED' };

/** GOAL-17 / GOAL-20: the row a non-active desired state decides, which also attaches `runStops`; null for `active`. */
function desiredStateHit(desiredState: GoalDesiredState): DesiredStateHit | null {
  switch (desiredState) {
    case 'active':
      return null;
    case 'paused':
      return { row: 'GOAL-20', phase: 'PAUSED' };
    case 'cancelled':
      return { row: 'GOAL-17', phase: 'CANCELLED' };
    default:
      return unreachable(desiredState, 'goal desired state');
  }
}

function isLiveRun(run: RunSnapshot): boolean {
  return run.status === 'starting' || run.status === 'running';
}

/** Runs in active-plan task order, then the other Tasks' Runs by taskId. */
function orderedRuns(facts: GoalDisplayFactsV1): { taskId: string; run: RunSnapshot }[] {
  const planOrder = facts.tasks.map((task) => task.taskId);
  const known = new Set(planOrder);
  const rest = [...facts.runsByTaskId.keys()].filter((taskId) => !known.has(taskId)).sort();
  const ordered: { taskId: string; run: RunSnapshot }[] = [];
  for (const taskId of [...planOrder, ...rest]) {
    for (const run of facts.runsByTaskId.get(taskId) ?? []) ordered.push({ taskId, run });
  }
  return ordered;
}

type GateState = 'awaiting_gate' | 'gate_verifying' | 'gate_fix_in_progress' | null;

/**
 * GV-1 / GV-3′ / GV-4 / GV-5 as display states of an active, unsatisfied gate:
 * no chain yet and its required work all satisfied → `awaiting_gate` (required
 * gates only); head `open`, or `PASS` without gaps awaiting completion →
 * `gate_verifying`; another finalized head while required active work in its
 * scope is unsatisfied → `gate_fix_in_progress`.
 */
function gateStateOf(gate: GoalDisplayTaskFactsV1, tasks: readonly GoalDisplayTaskFactsV1[]): GateState {
  if (gate.taskKind !== 'gate' || gate.disposition !== 'active' || gate.phase === 'satisfied') return null;
  const covered = new Set(gate.coveredTaskIds);
  const requiredWork = tasks.filter((task) => covered.has(task.taskId) && task.taskKind === 'work'
    && task.requirementLevel === 'required');
  const round = gate.failure?.round ?? null;
  if (round === null) {
    // Cancelled/superseded work carries no work any more (`completion-policy.ts:208`).
    const carried = requiredWork.filter((task) => task.disposition !== 'cancelled' && task.disposition !== 'superseded');
    return gate.requirementLevel === 'required' && carried.every((task) => task.phase === 'satisfied') ? 'awaiting_gate' : null;
  }
  if (round.status === 'open' || (round.outcome === 'PASS' && round.gapCodes.length === 0)) return 'gate_verifying';
  return requiredWork.some((task) => task.disposition === 'active' && task.phase !== 'satisfied') ? 'gate_fix_in_progress' : null;
}

/** GOAL-27: the failure class of the TaskRequeue a `claim_requeued` verdict claims. */
function claimRequeuedClass(task: GoalDisplayTaskFactsV1, verdict: Extract<TaskAutomationVerdictV1, { kind: 'claim_requeued' }>): ReworkFailureClass | null {
  const covering = verdict.requeueRef;
  const entry = task.reworkEntries.find((candidate) => refKey(candidate.ref) === refKey(covering));
  return entry?.failureClass ?? task.failure?.failureClass ?? null;
}

/** GOAL-27 running causes of one active Task, in a fixed order. */
function runningCauses(task: GoalDisplayTaskFactsV1, tasks: readonly GoalDisplayTaskFactsV1[]): GoalDisplayCauseV1[] {
  const causes: GoalDisplayCauseV1[] = [];
  const verdict = verdictOf(task);
  switch (verdict.kind) {
    case 'requeue':
      causes.push({ code: 'auto_rework_pending', taskId: task.taskId, operation: 'requeue', failureClass: verdict.failureClass });
      break;
    case 'reverify':
      causes.push({ code: 'auto_rework_pending', taskId: task.taskId, operation: 'reverify', failureClass: verdict.failureClass });
      break;
    case 'claim_requeued':
      causes.push({ code: 'auto_rework_pending', taskId: task.taskId, operation: 'requeue',
        failureClass: claimRequeuedClass(task, verdict) });
      break;
    case 'none':
    case 'stopped':
      break;
    default:
      return unreachable(verdict, 'automation verdict');
  }
  const failure = task.failure;
  if (failure !== null) {
    const cap = failure.automation.cap;
    if (failure.automation.requeueAutoCount > 0) {
      causes.push({ code: 'auto_rework_count', taskId: task.taskId, operation: 'requeue', n: failure.automation.requeueAutoCount, cap });
    }
    if (failure.round !== null && failure.round.autoCount > 0) {
      causes.push({ code: 'auto_rework_count', taskId: task.taskId, operation: 'reverify', n: failure.round.autoCount, cap });
    }
  }
  const gate = gateStateOf(task, tasks);
  switch (gate) {
    case 'awaiting_gate':
    case 'gate_verifying':
      causes.push({ code: gate, gateTaskId: task.taskId });
      break;
    case 'gate_fix_in_progress':
      causes.push({ code: 'gate_fix_in_progress', gateTaskId: task.taskId,
        failingChecks: [...(task.failure?.round?.failingChecks ?? [])] });
      break;
    case null:
      break;
    default:
      return unreachable(gate, 'gate display state');
  }
  return causes;
}

/**
 * GOAL-30 causes in active-plan task order: every stopped verdict of an active
 * Task except `unknown_outcome`, and `required_task_deferred` at the position
 * of the first deferred required work Task when no required active Task is
 * running, claimable or verifying.
 */
function stopCauses(tasks: readonly GoalDisplayTaskFactsV1[]): RankedCause[] {
  const ranked: RankedCause[] = [];
  tasks.forEach((task, index) => {
    if (task.disposition !== 'active') return;
    const verdict = verdictOf(task);
    if (verdict.kind !== 'stopped' || !isGoalStopCause(verdict.reason)) return;
    ranked.push({ index, required: task.requirementLevel === 'required',
      cause: { code: verdict.reason, taskId: task.taskId, detail: verdict.detail } });
  });
  const deferred = tasks.map((task, index) => ({ task, index })).filter(({ task }) => task.requirementLevel === 'required'
    && task.taskKind === 'work' && task.disposition === 'deferred' && task.phase !== 'satisfied');
  const requiredBusy = tasks.some((task) => task.disposition === 'active' && task.requirementLevel === 'required'
    && (task.phase === 'running' || task.phase === 'verifying' || task.dispatchable));
  const first = deferred[0];
  if (first !== undefined && !requiredBusy) {
    ranked.push({ index: first.index, required: true,
      cause: { code: 'required_task_deferred', taskIds: deferred.map(({ task }) => task.taskId) } });
  }
  return ranked.sort((left, right) => left.index - right.index);
}

/**
 * §2.1 display reduction: the first row that holds (priority order) is the
 * `phase`; the causes of every row that holds are listed, so a secondary fact
 * is never hidden by the headline. Task verdicts are read by name from the
 * failure facts (§4 TD-9), never recomputed here.
 */
export function reduceGoalDisplay(facts: GoalDisplayFactsV1): GoalDisplayV1 {
  const hits: DisplayHit[] = [];
  const causes: GoalDisplayCauseV1[] = [];
  const hit = (row: GoalDisplayRow, phase: GoalDisplayPhase, cause: GoalDisplayCauseV1 | null): void => {
    hits.push({ row, phase, cause });
  };
  const pointer = facts.activePlanRef;
  const tasks = facts.tasks;
  const active = tasks.filter((task) => task.disposition === 'active');
  const requiredActive = active.filter((task) => task.requirementLevel === 'required');
  const runs = orderedRuns(facts);
  const liveRun = runs.some(({ run }) => isLiveRun(run));
  const requiredPending = requiredActive.some((task) => isPendingVerdict(verdictOf(task)));
  const gates = active.map((task) => gateStateOf(task, tasks));
  const desiredHit = desiredStateHit(facts.desiredState);

  // GOAL-17
  if (desiredHit?.row === 'GOAL-17') hit(desiredHit.row, desiredHit.phase, null);
  // GOAL-18
  if (facts.completion.status === 'recorded' && facts.completion.selectedPlanMatches) hit('GOAL-18', 'COMPLETED', null);
  // GOAL-19: declared only (D-9); the input type is always null, so it never holds.
  if (facts.partialAcceptance !== null) hit('GOAL-19', 'ACCEPTED_PARTIAL', null);
  // GOAL-20
  if (desiredHit?.row === 'GOAL-20') hit(desiredHit.row, desiredHit.phase, null);
  // GOAL-21
  const pending = facts.pendingProposal;
  if (pointer === null && pending !== null && pending.basedOn === null) {
    const cause: GoalDisplayCauseV1 = { code: 'initial_plan_pending', proposalRef: pending.ref };
    causes.push(cause);
    hit('GOAL-21', 'PLANNING', cause);
  }
  // GOAL-22
  if (pointer === null) hit('GOAL-22', 'PLANNING', null);
  // GOAL-23: the ended branches of `runUnresolvedBlocker` (the starting|running branch is not a decision).
  const unknown: GoalDisplayCauseV1[] = runs
    .filter(({ run }) => !isLiveRun(run) && runUnresolvedBlocker(run) !== null)
    .map(({ taskId, run }) => ({ code: 'unknown_outcome', taskId, runRef: run.ref }));
  causes.push(...unknown);
  const firstUnknown = unknown[0];
  if (firstUnknown !== undefined) hit('GOAL-23', 'NEEDS_DECISION', firstUnknown);
  // GOAL-30: causes always listed; the headline only when nothing automatic is left.
  const stops = stopCauses(tasks);
  causes.push(...stops.map((entry) => entry.cause));
  const firstRequiredStop = stops.find((entry) => entry.required);
  if (firstRequiredStop !== undefined && !liveRun && !requiredPending) hit('GOAL-30', 'NEEDS_DECISION', firstRequiredStop.cause);
  // GOAL-24: required active WORK only; a pending or stopped verdict is not a failure headline. While a
  // Run is still starting|running the failure is only a cause and the headline stays RUNNING (§2.1 说明).
  const failed: GoalDisplayCauseV1[] = requiredActive
    .filter((task) => task.taskKind === 'work' && task.phase === 'failed' && !decidedByAutomation(task))
    .map((task) => ({ code: 'task_failed', taskId: task.taskId }));
  causes.push(...failed);
  const firstFailed = failed[0];
  if (firstFailed !== undefined && !liveRun) hit('GOAL-24', 'FAILED', firstFailed);
  // GOAL-25: (a) a blocked required active work Task; (b) unfinished required active Tasks with nothing
  // claimable, verifying, pending automatic rework or gate progress. Cancelled/superseded Tasks are not
  // active; deferred required work is reported only by GOAL-30 `required_task_deferred`; a stopped or
  // paused-interrupted Task is GOAL-30's (§15.3: GOAL-25 excludes them).
  const blocked: GoalDisplayCauseV1[] = requiredActive
    .filter((task) => task.taskKind === 'work' && task.phase === 'blocked' && !decidedByAutomation(task))
    .filter((task) => task.phaseCause?.code !== 'paused_interrupted')
    .map((task) => ({ code: 'task_blocked', taskId: task.taskId }));
  const unfinished = requiredActive
    .filter((task) => task.phase !== 'satisfied' && verdictOf(task).kind !== 'stopped')
    .filter((task) => task.phaseCause?.code !== 'paused_interrupted')
    .map((task) => task.taskId);
  const progressing = active.some((task) => task.taskKind === 'work' && task.dispatchable)
    || active.some((task) => task.phase === 'verifying')
    || requiredPending
    || gates.some((state) => state !== null);
  const stuck: GoalDisplayCauseV1[] = unfinished.length > 0 && !progressing && !liveRun
    ? [{ code: 'no_dispatchable_work', taskIds: unfinished }] : [];
  causes.push(...blocked, ...stuck);
  const firstBlocked = blocked[0] ?? stuck[0];
  if (firstBlocked !== undefined && !liveRun) hit('GOAL-25', 'BLOCKED', firstBlocked);
  // GOAL-26
  if (pointer !== null && pending !== null && samePlanPointer(pending.basedOn, pointer)) {
    const cause: GoalDisplayCauseV1 = { code: 'change_pending', proposalRef: pending.ref };
    causes.push(cause);
    hit('GOAL-26', 'CHANGE_PENDING', cause);
  }
  // GOAL-27: the running causes are facts of the active plan, listed whenever there is one.
  if (pointer !== null) {
    for (const task of active) causes.push(...runningCauses(task, tasks));
    hit('GOAL-27', 'RUNNING', null);
  }

  // GOAL-22 holds whenever GOAL-27 does not, so there is always a headline.
  const headline = hits[0];
  if (headline === undefined) throw new Error('reduceGoalDisplay: no display row holds');
  // GOAL-17/20 "附 runStops".
  const runStops = desiredHit === null ? null
    : facts.runStopInputs.map((input) => projectGoalRunStop(input.run, input.pointedIntent, input.fanOutIntentRef, input.capability));
  return { phase: headline.phase, row: headline.row, cause: headline.cause, causes, runStops };
}
