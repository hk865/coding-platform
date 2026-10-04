/**
 * §2 Goal machine (docs/refactor/STATE-MACHINES-SPEC.md): every (state, event)
 * pair of GOAL-01..08 and the §2.4 rows, each guard of the creation, adoption
 * and completion rows in today's order, the record constructors (§14.1), the
 * display reduction GOAL-17..27/GOAL-30 (one case per row and per stop
 * reason, plus seeded random fact combinations), `runStops` (orders 0..8), the
 * fan-out identities and the GOAL-29 selection.
 * Rows that step 5 flips are pinned at today's result and marked "step 5";
 * 新增 rows GOAL-04…06 answer `illegal`/`invalid` until then.
 * Pure: no RecordStore, no Kernel.
 */
import { describe, expect, it } from 'vitest';
import type { ControlIntentRef, ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { CoreError } from '../../src/contracts/core/results.js';
import type { RoleBindingRefV1, RunRef, RunSnapshot, RuntimeEventV1 } from '../../src/contracts/dispatch.js';
import type { GoalPhaseRef, GoalPhaseSnapshot } from '../../src/contracts/goal-phase.js';
import type { GoalDesiredState, GoalRef, GoalSnapshot, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { TaskReductionRef } from '../../src/contracts/reduction.js';
import type {
  FailingCheckFactV1, TaskAutomationStopDetailV1, TaskAutomationStopReason, TaskAutomationVerdictV1, TaskFailureFactsV1,
} from '../../src/contracts/task-failure.js';
import {
  GOAL_FAN_OUT_ACTOR as CONTRACT_GOAL_FAN_OUT_ACTOR, WORKFLOW_AUTOMATION_ACTOR,
  type TaskRequeueRef,
} from '../../src/contracts/task-requeue.js';
import type { VerificationRoundRef } from '../../src/contracts/verification.js';
import {
  GOAL_DISPLAY_PHASES, GOAL_DISPLAY_ROWS, GOAL_EVENT_TYPES, GOAL_FAN_OUT_ACTOR,
  buildGoalPhaseSnapshot, findGoalResumeContinuations, goalFanOutReason, goalFanOutRequestId,
  goalResumeContinueRequestId, goalStateOf, newGoalSnapshot, nextGoalDesiredState, nextGoalPointer,
  projectGoalRunStop, reduceGoalDisplay, transitionGoal,
  type GoalCompletionFacts, type GoalDisplayCauseV1, type GoalDisplayFactsV1, type GoalDisplayTaskFactsV1,
  type GoalEffect, type GoalEvent, type GoalGuardContext, type GoalHostActorRef, type GoalMachineState,
  type GoalResumeTaskFactsV1, type GoalRunControlCapabilityV1, type GoalTransition,
} from '../../src/core/work-graph/state/goal-machine.js';
import type { PlanProposalRef } from '../../src/core/work-graph/state/plan-machine.js';
import type { TransitionRejectReason } from '../../src/core/work-graph/state/transition.js';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const PROJECT = 'p-goal';
const WORKSPACE = 'w-goal';
const GOAL_ID = 'g-1';
const T0 = '2026-10-04T08:00:00.000Z';
const T1 = '2026-10-04T08:05:00.000Z';
const GOAL: GoalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: GOAL_ID };
const WS: WorkspaceRef = { aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE };
const PHASE_REF: GoalPhaseRef = { aggregateType: 'GoalPhase', projectId: PROJECT, goalId: GOAL_ID };
const planRef = (planId: string): PlanRevisionRef => ({ aggregateType: 'PlanRevision', projectId: PROJECT, planId });
const P1 = planRef('plan-1');
const P2 = planRef('plan-2');
const HUMAN: GoalHostActorRef = { kind: 'human', id: 'operator' };
const REDUCTION: { ref: TaskReductionRef; revision: number } = {
  ref: { aggregateType: 'TaskReduction', projectId: PROJECT, goalId: GOAL_ID, taskId: 't-build' }, revision: 1,
};
const OBJECTIVE = 'ship the release';

const GOAL_NEW = newGoalSnapshot({ ref: GOAL, workspaceRef: WS, objective: OBJECTIVE });
/** Active Goals never changed their desired state; paused/cancelled ones did, by an operator. */
function goalWithoutPlan(desiredState: GoalDesiredState): GoalSnapshot {
  return desiredState === 'active' ? GOAL_NEW : nextGoalDesiredState(GOAL_NEW, { to: desiredState, requestedBy: HUMAN });
}
const phaseFor = (plan: PlanRevisionRef, planRevision: number, previousRevision: number | null, reducedAt: string) =>
  buildGoalPhaseSnapshot({ ref: PHASE_REF, previousRevision, planRef: plan, planRevision, adoptedTaskReductions: [REDUCTION],
    satisfiedObligationIds: ['ob-1'], reducedAt });
const PHASE_P1 = phaseFor(P1, 1, null, T0);

type Variant = 'NoPlan' | 'Planned' | 'DoneActive' | 'DoneOther';
const VARIANTS: readonly Variant[] = ['NoPlan', 'Planned', 'DoneActive', 'DoneOther'];
const DESIRED: readonly GoalDesiredState[] = ['active', 'paused', 'cancelled'];

function goalOf(desiredState: GoalDesiredState, variant: Variant): GoalSnapshot {
  const base = goalWithoutPlan(desiredState);
  switch (variant) {
    case 'NoPlan': return base;
    case 'Planned':
    case 'DoneActive': return nextGoalPointer(base, P1);
    case 'DoneOther': return nextGoalPointer(nextGoalPointer(base, P1), P2);
  }
}
function stateOf(desiredState: GoalDesiredState, variant: Variant): GoalMachineState {
  const goal = goalOf(desiredState, variant);
  return goalStateOf(goal, variant === 'DoneActive' || variant === 'DoneOther' ? PHASE_P1 : null);
}

function completionFacts(plan: PlanRevisionRef, overrides: Partial<GoalCompletionFacts> = {}): GoalCompletionFacts {
  return { plan: { ref: plan, planRevision: plan.planId === 'plan-1' ? 1 : 2 }, evaluation: { completed: true, reasons: [] },
    requiresReviewer: false, adoptedTaskReductions: [REDUCTION], satisfiedObligationIds: ['ob-1'], ...overrides };
}
function ctxFor(state: GoalMachineState, overrides: Partial<GoalGuardContext> = {}): GoalGuardContext {
  return { callerClass: 'human', scopePinsAgree: true, goalInWorkspace: true,
    completion: state.activePlanRef === null ? null : completionFacts(state.activePlanRef), ...overrides };
}

const CREATED: GoalEvent = { type: 'goal_created', ref: GOAL, workspaceRef: WS, objective: OBJECTIVE };
const ADOPT_INITIAL: GoalEvent = { type: 'plan_adopted', basedOn: null, target: P1 };
const ADOPT_FUTURE: GoalEvent = { type: 'plan_adopted', basedOn: P1, target: P2 };
function controlEvent(type: 'goal_pause_requested' | 'goal_resume_requested' | 'goal_cancel_requested',
  state: GoalMachineState): GoalEvent {
  return { type, expectedGoalRevision: state.goal?.revision ?? 1, expectedGoalPhaseRevision: state.goalPhase?.revision ?? 0,
    reason: 'operator decision', requestedBy: HUMAN };
}
function completeEvent(state: GoalMachineState, reducedAt = T1): GoalEvent {
  return { type: 'goal_completed', expectedGoalRevision: state.goal?.revision ?? 1,
    expectedGoalPhaseRevision: state.goalPhase?.revision ?? 0, reducedAt };
}

const g = (guard: Extract<GoalEffect, { kind: 'guard' }>['guard']): GoalEffect => ({ kind: 'guard', guard });
const CREATED_EFFECTS: GoalEffect[] = [
  { kind: 'write_goal' }, { kind: 'append_event', eventType: 'GoalCreated' },
  g({ target: 'project' }), g({ target: 'workspace' }), g({ target: 'goal', expectedRevision: null }),
];
const ADOPT_EFFECTS: GoalEffect[] = [{ kind: 'write_goal' }];
function completeEffects(goalRevision: number, plan: PlanRevisionRef, phaseRevision: number | null): GoalEffect[] {
  return [
    { kind: 'write_goal_phase' }, { kind: 'append_event', eventType: 'GoalCompleted' },
    g({ target: 'goal', expectedRevision: goalRevision }), g({ target: 'plan_revision', ref: plan }),
    g({ target: 'goal_phase', expectedRevision: phaseRevision }), g({ target: 'pinned_policy' }), g({ target: 'task_facts' }),
  ];
}

type Expected =
  | { ok: true; next: GoalMachineState; effects: GoalEffect[] }
  | { ok: false; reason: TransitionRejectReason; code: CoreError; detail?: string };
const ok = (next: GoalMachineState, effects: GoalEffect[] = []): Expected => ({ ok: true, next, effects });
const no = (reason: TransitionRejectReason, code: CoreError, detail?: string): Expected =>
  detail === undefined ? { ok: false, reason, code } : { ok: false, reason, code, detail };

/** The store's check of the emitted Goal CAS guard against the stored Goal (`null` = must not exist). */
function goalGuardHolds(state: GoalMachineState, effects: readonly GoalEffect[]): boolean {
  return effects.every((effect) => effect.kind !== 'guard' || effect.guard.target !== 'goal'
    || effect.guard.expectedRevision === (state.goal?.revision ?? null));
}

function expectResult(result: GoalTransition, expected: Expected): void {
  if (expected.ok) {
    expect(result).toEqual({ ok: true, next: expected.next, effects: expected.effects });
    return;
  }
  if (result.ok) throw new Error(`expected a ${expected.reason}/${expected.code} rejection, got ${JSON.stringify(result)}`);
  expect({ reason: result.reason, code: result.code }).toEqual({ reason: expected.reason, code: expected.code });
  if (expected.detail !== undefined) expect(result.detail).toBe(expected.detail);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

// --------------------------------------------------------------------------
// Records and constructors (§14.1)
// --------------------------------------------------------------------------

describe('§14.1 Goal record constructors', () => {
  it('newGoalSnapshot writes Goal@1 with today\'s key order and no D-9 fields (commit-compiler.ts:111-118)', () => {
    expect(JSON.stringify(GOAL_NEW)).toBe(JSON.stringify({ ref: GOAL, workspaceRef: WS, objective: OBJECTIVE,
      desiredState: 'active', activePlanRevision: null, revision: 1 }));
    expect('desiredStateRevision' in GOAL_NEW).toBe(false);
    expect('desiredStateRequestedBy' in GOAL_NEW).toBe(false);
    // The contract reads the absent fields as epoch 1 and no requester.
    const view = goalStateOf(GOAL_NEW, null);
    expect(view).toMatchObject({ node: 'active', desiredStateRevision: 1, desiredStateRequestedByClass: null,
      activePlanRef: null, completion: 'none' });
  });

  it('nextGoalPointer moves the pointer and the revision only (plan-commit-compiler.ts:144,293)', () => {
    const paused = deepFreeze(goalWithoutPlan('paused'));
    const moved = nextGoalPointer(paused, P1);
    expect(moved).toEqual({ ...paused, activePlanRevision: P1, revision: paused.revision + 1 });
    expect(Object.keys(moved)).toEqual(Object.keys(paused));
    // GOAL-02/03: the desired state, its epoch and requester are untouched by an adoption.
    expect(moved.desiredState).toBe('paused');
    expect(moved.desiredStateRevision).toBe(2);
    expect(moved.desiredStateRequestedBy).toEqual(HUMAN);
    expect(JSON.stringify(nextGoalPointer(GOAL_NEW, P1))).toBe(JSON.stringify({ ref: GOAL, workspaceRef: WS,
      objective: OBJECTIVE, desiredState: 'active', activePlanRevision: P1, revision: 2 }));
  });

  it('nextGoalDesiredState writes every Goal field, the epoch rev+1 and a copy of the requester', () => {
    const planned = deepFreeze(nextGoalPointer(GOAL_NEW, P1));
    const actor = { kind: 'system' as const, id: 'host:operator-console' };
    const paused = nextGoalDesiredState(planned, { to: 'paused', requestedBy: actor });
    expect(Object.keys(paused)).toEqual(['ref', 'workspaceRef', 'objective', 'desiredState', 'desiredStateRevision',
      'desiredStateRequestedBy', 'activePlanRevision', 'revision']);
    expect(paused).toEqual({ ref: GOAL, workspaceRef: WS, objective: OBJECTIVE, desiredState: 'paused',
      desiredStateRevision: 3, desiredStateRequestedBy: actor, activePlanRevision: P1, revision: 3 });
    expect(paused.desiredStateRequestedBy).not.toBe(actor);
    // LA-7: a Host started with a kind:'system' actor is still an operator.
    expect(goalStateOf(paused, null).desiredStateRequestedByClass).toBe('human');
    const byWorkflow = nextGoalDesiredState(planned, { to: 'paused', requestedBy: WORKFLOW_AUTOMATION_ACTOR });
    expect(goalStateOf(byWorkflow, null).desiredStateRequestedByClass).toBe('system');
    const resumed = nextGoalDesiredState(paused, { to: 'active', requestedBy: HUMAN });
    expect(resumed).toMatchObject({ desiredState: 'active', desiredStateRevision: 4, revision: 4 });
  });

  it('buildGoalPhaseSnapshot writes COMPLETED@previous+1 with today\'s key order (completion.ts:572-582)', () => {
    const reductions = [REDUCTION];
    const obligations = ['ob-1', 'ob-2'];
    const first = buildGoalPhaseSnapshot({ ref: PHASE_REF, previousRevision: null, planRef: P1, planRevision: 1,
      adoptedTaskReductions: reductions, satisfiedObligationIds: obligations, reducedAt: T0 });
    expect(JSON.stringify(first)).toBe(JSON.stringify({ ref: PHASE_REF, revision: 1, schemaVersion: 1, planRef: P1,
      planRevision: 1, phase: 'COMPLETED', adoptedTaskReductions: reductions, satisfiedObligationIds: obligations,
      reducedAt: T0 }));
    expect(first.adoptedTaskReductions).not.toBe(reductions);
    expect(first.satisfiedObligationIds).not.toBe(obligations);
    const again = buildGoalPhaseSnapshot({ ref: PHASE_REF, previousRevision: 4, planRef: P2, planRevision: 2,
      adoptedTaskReductions: [], satisfiedObligationIds: [], reducedAt: T1 });
    expect(again).toMatchObject({ revision: 5, planRef: P2, planRevision: 2 });
  });

  it('goalStateOf derives the completion relation from the full plan ref', () => {
    expect(goalStateOf(nextGoalPointer(GOAL_NEW, P1), PHASE_P1).completion).toBe('for_active');
    expect(goalStateOf(nextGoalPointer(nextGoalPointer(GOAL_NEW, P1), P2), PHASE_P1).completion).toBe('for_other');
    expect(goalStateOf(nextGoalPointer(GOAL_NEW, P1), null).completion).toBe('none');
    expect(goalStateOf(null, null)).toEqual({ node: 'absent', desiredStateRevision: 0, activePlanRef: null,
      completion: 'none', desiredStateRequestedByClass: null, goal: null, goalPhase: null });
    const otherProject = { ...P1, projectId: 'p-other' };
    expect(goalStateOf(nextGoalPointer(GOAL_NEW, otherProject), PHASE_P1).completion).toBe('for_other');
  });

  it('re-exports the contract GOAL_FAN_OUT_ACTOR (§15.1)', () => {
    expect(GOAL_FAN_OUT_ACTOR).toBe(CONTRACT_GOAL_FAN_OUT_ACTOR);
    expect(GOAL_FAN_OUT_ACTOR).toEqual({ kind: 'system', id: 'host:goal-fan-out' });
  });
});

// --------------------------------------------------------------------------
// Every (state, event) pair
// --------------------------------------------------------------------------

const STATE_NAMES = ['absent', ...DESIRED.flatMap((ds) => VARIANTS.map((variant) => `${ds}${variant}`))] as const;
type StateName = string;
const STATES: Record<StateName, GoalMachineState> = { absent: goalStateOf(null, null) };
for (const ds of DESIRED) for (const variant of VARIANTS) STATES[`${ds}${variant}`] = stateOf(ds, variant);

const EVENTS = {
  created: (_state: GoalMachineState): GoalEvent => CREATED,
  adoptInitial: (_state: GoalMachineState): GoalEvent => ADOPT_INITIAL,
  adoptFuture: (_state: GoalMachineState): GoalEvent => ADOPT_FUTURE,
  pause: (state: GoalMachineState): GoalEvent => controlEvent('goal_pause_requested', state),
  resume: (state: GoalMachineState): GoalEvent => controlEvent('goal_resume_requested', state),
  cancel: (state: GoalMachineState): GoalEvent => controlEvent('goal_cancel_requested', state),
  complete: (state: GoalMachineState): GoalEvent => completeEvent(state),
} satisfies Record<string, (state: GoalMachineState) => GoalEvent>;
type EventName = keyof typeof EVENTS;

/**
 * GOAL-01 from a state with a Goal: the machine compiles the same commit as
 * from ∅, and the store's Goal ∅ guard refuses it after its in-transaction
 * receipt lookup (§2.4 "Goal 已存在", asserted with `goalGuardHolds` below).
 */
const CREATED_OVER = (phase: GoalPhaseSnapshot | null): Expected => ok(goalStateOf(GOAL_NEW, phase), CREATED_EFFECTS);
const NO_GOAL_PLAN = no('illegal', 'not_found', 'the goal does not exist');
const NO_GOAL_COMPLETE = no('illegal', 'not_found', 'the Goal does not exist');
const NOT_YET = (row: string): Expected => no('illegal', 'invalid', `${row} is not implemented before A.2 step 5`);
const CONTROL_NOT_YET = { pause: NOT_YET('GOAL-04'), resume: NOT_YET('GOAL-05'), cancel: NOT_YET('GOAL-06') };
const INITIAL_STALE = no('stale', 'revision_conflict', 'the goal already has an active plan; an initial adoption cannot replace it');
const SOURCE_STALE = no('stale', 'revision_conflict', 'the source plan is not the Goal current active plan');

/**
 * Today's results for one desired state. A paused/cancelled Goal has no writer
 * before step 5.5, so every row answers as for `active`; step 5 flips:
 * - `complete` from paused/cancelled → guard_failed/busy (GOAL-07/08 desired-state guard);
 * - `complete` from DoneActive → guard_failed/busy (§2.4 "GoalPhase 对应活动计划");
 * - `adoptInitial`/`adoptFuture` from cancelled → illegal/invalid (§2.4).
 */
function rowsFor(ds: GoalDesiredState): Record<Variant, Record<EventName, Expected>> {
  const noPlan = goalOf(ds, 'NoPlan');
  const planned = goalOf(ds, 'Planned');
  const doneOther = goalOf(ds, 'DoneOther');
  return {
    NoPlan: {
      created: CREATED_OVER(null),
      // GOAL-02
      adoptInitial: ok(goalStateOf(nextGoalPointer(noPlan, P1), null), ADOPT_EFFECTS),
      adoptFuture: SOURCE_STALE,
      ...CONTROL_NOT_YET,
      complete: no('guard_failed', 'incomplete', 'the Goal has no adopted Plan to complete'),
    },
    Planned: {
      created: CREATED_OVER(null),
      // The pointer (already on the target) is checked first, with today's text.
      adoptInitial: INITIAL_STALE,
      // GOAL-03
      adoptFuture: ok(goalStateOf(nextGoalPointer(planned, P2), null), ADOPT_EFFECTS),
      ...CONTROL_NOT_YET,
      // GOAL-07
      complete: ok(goalStateOf(planned, phaseFor(P1, 1, null, T1)), completeEffects(planned.revision, P1, null)),
    },
    DoneActive: {
      created: CREATED_OVER(PHASE_P1),
      adoptInitial: INITIAL_STALE,
      // GOAL-03 with an older completion: D-17, the old COMPLETED stays and reads for_other.
      adoptFuture: ok(goalStateOf(nextGoalPointer(planned, P2), PHASE_P1), ADOPT_EFFECTS),
      ...CONTROL_NOT_YET,
      // Today: completed again @2 for the same plan (step 5: busy).
      complete: ok(goalStateOf(planned, phaseFor(P1, 1, 1, T1)), completeEffects(planned.revision, P1, 1)),
    },
    DoneOther: {
      created: CREATED_OVER(PHASE_P1),
      adoptInitial: INITIAL_STALE,
      // Pointer P2 already on the target: a stale source (the owner's recheck replays the committed adoption).
      adoptFuture: SOURCE_STALE,
      ...CONTROL_NOT_YET,
      // GOAL-08
      complete: ok(goalStateOf(doneOther, phaseFor(P2, 2, 1, T1)), completeEffects(doneOther.revision, P2, 1)),
    },
  };
}

const TABLE: Record<StateName, Record<EventName, Expected>> = {
  absent: {
    // GOAL-01
    created: ok(goalStateOf(GOAL_NEW, null), CREATED_EFFECTS),
    adoptInitial: NO_GOAL_PLAN,
    adoptFuture: NO_GOAL_PLAN,
    ...CONTROL_NOT_YET,
    complete: NO_GOAL_COMPLETE,
  },
};
for (const ds of DESIRED) {
  const rows = rowsFor(ds);
  for (const variant of VARIANTS) TABLE[`${ds}${variant}`] = rows[variant];
}

describe('§2 transitionGoal: every (state, event) pair', () => {
  const eventNames = Object.keys(EVENTS) as EventName[];

  it('the table covers every state and every event type', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(Object.keys(TABLE)).toEqual([...STATE_NAMES]);
    for (const name of STATE_NAMES) expect(Object.keys(TABLE[name] ?? {}).sort()).toEqual([...eventNames].sort());
    const types = new Set(eventNames.map((name) => EVENTS[name](STATES['activePlanned']!).type));
    expect([...types].sort()).toEqual([...GOAL_EVENT_TYPES].sort());
  });

  for (const stateName of STATE_NAMES) {
    for (const eventName of Object.keys(EVENTS) as EventName[]) {
      it(`${stateName} × ${eventName}`, () => {
        const state = deepFreeze(STATES[stateName]!);
        const event = deepFreeze(EVENTS[eventName](state));
        const result = transitionGoal(state, event, ctxFor(state));
        expectResult(result, TABLE[stateName]![eventName]);
      });
    }
  }

  it('a legal transition never mutates its inputs and returns whole next records', () => {
    const state = deepFreeze(STATES['pausedPlanned']!);
    const result = transitionGoal(state, deepFreeze(ADOPT_FUTURE), deepFreeze(ctxFor(state)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.goal).toEqual({ ...state.goal, activePlanRevision: P2, revision: state.goal!.revision + 1 });
    expect(result.next).toMatchObject({ node: 'paused', desiredStateRevision: 2, desiredStateRequestedByClass: 'human',
      activePlanRef: P2, completion: 'none' });
  });
});

// --------------------------------------------------------------------------
// Guards in today's order
// --------------------------------------------------------------------------

describe('GOAL-01 goal_created guards (task-service.ts:154-257)', () => {
  it('pins that disagree with the versions read are the only pre-commit refusal (task-service.ts:211-222)', () => {
    for (const state of [STATES['absent']!, STATES['activePlanned']!]) {
      expectResult(transitionGoal(state, CREATED, ctxFor(state, { scopePinsAgree: false })),
        no('stale', 'revision_conflict', 'the supplied version pins do not match the versions read in this call'));
    }
  });

  it('§2.4 Goal 已存在: only the Goal ∅ CAS refuses a new identity, never the pre-read Goal (commit-compiler.ts:126)', () => {
    for (const name of STATE_NAMES) {
      const state = STATES[name]!;
      const result = transitionGoal(state, CREATED, ctxFor(state));
      // The owner commits as today; the store re-runs the receipt lookup inside the transaction first, so a
      // same-identity commit that landed after the owner's lookup miss still replays its receipt.
      if (!result.ok) throw new Error(`${name}: expected the commit to be compiled, got ${JSON.stringify(result)}`);
      expect(result.effects).toContainEqual(g({ target: 'goal', expectedRevision: null }));
      // Otherwise the guard fails in the store: stale / revision_conflict with the store's reason (task-service.ts:249-251).
      expect(goalGuardHolds(state, result.effects)).toBe(name === 'absent');
    }
  });
});

describe('GOAL-02/03 plan_adopted guards (plan-service.ts:1166-1170, :1712-1726)', () => {
  it('a target equal to its source is not a new plan', () => {
    const state = STATES['activePlanned']!;
    expectResult(transitionGoal(state, { type: 'plan_adopted', basedOn: P1, target: P1 }, ctxFor(state)),
      no('illegal', 'invalid', 'the target planId must be a new, unused reference'));
  });

  it('the pointer is checked before the target planId, as today and as transitionPlanProposal', () => {
    const state = STATES['activeDoneOther']!; // pointer P2
    expectResult(transitionGoal(state, { type: 'plan_adopted', basedOn: P1, target: P1 }, ctxFor(state)), SOURCE_STALE);
    const planned = STATES['activePlanned']!; // pointer P1
    expectResult(transitionGoal(planned, { type: 'plan_adopted', basedOn: null, target: P1 }, ctxFor(planned)), INITIAL_STALE);
  });

  it('a superseded source is stale, also when the pointer is already on the target', () => {
    const state = STATES['activeDoneOther']!; // pointer P2
    const p3 = planRef('plan-3');
    expectResult(transitionGoal(state, { type: 'plan_adopted', basedOn: P1, target: p3 }, ctxFor(state)), SOURCE_STALE);
    expectResult(transitionGoal(state, { type: 'plan_adopted', basedOn: P1, target: P2 }, ctxFor(state)), SOURCE_STALE);
    expectResult(transitionGoal(state, { type: 'plan_adopted', basedOn: P2, target: p3 }, ctxFor(state)),
      ok(goalStateOf(nextGoalPointer(state.goal!, p3), PHASE_P1), ADOPT_EFFECTS));
  });

  it('step 5: a cancelled Goal still adopts today (§2.4 target: illegal/invalid); paused keeps adopting', () => {
    for (const name of ['cancelledNoPlan', 'pausedNoPlan']) {
      const state = STATES[name]!;
      const result = transitionGoal(state, ADOPT_INITIAL, ctxFor(state));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.next.node).toBe(state.node);
    }
  });
});

describe('GOAL-07/08 goal_completed guards (completion.ts:481-614)', () => {
  const state = STATES['activePlanned']!;

  it('workspace before the Goal pin before the pointer', () => {
    const noPlan = STATES['activeNoPlan']!;
    const stalePin: GoalEvent = { type: 'goal_completed', expectedGoalRevision: 99, expectedGoalPhaseRevision: 0, reducedAt: T1 };
    expectResult(transitionGoal(noPlan, stalePin, ctxFor(noPlan, { goalInWorkspace: false })),
      no('guard_failed', 'forbidden', 'the Goal belongs to another workspace'));
    expectResult(transitionGoal(noPlan, stalePin, ctxFor(noPlan)),
      no('stale', 'revision_conflict', 'the Goal changed since the caller read it'));
    expectResult(transitionGoal(noPlan, completeEvent(noPlan), ctxFor(noPlan)),
      no('guard_failed', 'incomplete', 'the Goal has no adopted Plan to complete'));
  });

  it('the completion facts must be read for the active plan', () => {
    expectResult(transitionGoal(state, completeEvent(state), ctxFor(state, { completion: null })),
      no('illegal', 'invalid', 'goal_completed requires the completion facts of the active plan'));
    expectResult(transitionGoal(state, completeEvent(state), ctxFor(state, { completion: completionFacts(P2) })),
      no('illegal', 'invalid', 'the completion facts were read for another plan than the Goal active plan'));
  });

  it('the GoalPhase pin is checked before the reduction', () => {
    const notComplete = completionFacts(P1, { evaluation: { completed: false, reasons: ['required task t-build is not formally satisfied'] } });
    const pinned: GoalEvent = { type: 'goal_completed', expectedGoalRevision: state.goal!.revision, expectedGoalPhaseRevision: 1,
      reducedAt: T1 };
    expectResult(transitionGoal(state, pinned, ctxFor(state, { completion: notComplete })),
      no('stale', 'revision_conflict', 'the GoalPhase changed since the caller read it'));
    const done = STATES['activeDoneOther']!;
    const zero: GoalEvent = { type: 'goal_completed', expectedGoalRevision: done.goal!.revision, expectedGoalPhaseRevision: 0,
      reducedAt: T1 };
    expectResult(transitionGoal(done, zero, ctxFor(done)),
      no('stale', 'revision_conflict', 'the GoalPhase changed since the caller read it'));
  });

  it('an unsatisfied reduction is incomplete with today\'s reasons and the reviewer note', () => {
    const facts = completionFacts(P1, { evaluation: { completed: false, reasons: ['required task t-build is not formally satisfied',
      'required obligation ob-1 is not formally satisfied'] }, requiresReviewer: true });
    expectResult(transitionGoal(state, completeEvent(state), ctxFor(state, { completion: facts })),
      no('guard_failed', 'incomplete', 'Goal g-1 is not complete: required task t-build is not formally satisfied; '
        + 'required obligation ob-1 is not formally satisfied; a required independent review requirement has no formal producer yet'));
  });

  it('step 5: paused/cancelled Goals and a second completion for the active plan still complete today', () => {
    for (const name of ['pausedPlanned', 'cancelledPlanned', 'activeDoneActive']) {
      const current = STATES[name]!;
      const result = transitionGoal(current, completeEvent(current), ctxFor(current));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.next.completion).toBe('for_active');
    }
  });
});

describe('GOAL-04…06 (新增) answer illegal until step 5', () => {
  it('from every state, whatever the caller class', () => {
    for (const name of STATE_NAMES) {
      const state = STATES[name]!;
      for (const [type, row] of [['goal_pause_requested', 'GOAL-04'], ['goal_resume_requested', 'GOAL-05'],
        ['goal_cancel_requested', 'GOAL-06']] as const) {
        for (const callerClass of ['human', 'system', 'agent', null] as const) {
          expectResult(transitionGoal(state, controlEvent(type, state), ctxFor(state, { callerClass })), NOT_YET(row));
        }
      }
    }
  });
});

// --------------------------------------------------------------------------
// Fan-out identity (§2.3)
// --------------------------------------------------------------------------

const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: PROJECT, goalId: GOAL_ID, runId });

describe('§2.3 fan-out identities', () => {
  const run = runRef('run-a');

  it('goalFanOutRequestId is deterministic and separates goal, epoch, Run and control', () => {
    const id = goalFanOutRequestId(GOAL, 2, run, 'pause');
    expect(id).toBe(goalFanOutRequestId({ ...GOAL }, 2, { ...run }, 'pause'));
    expect(id).toMatch(/^goal-fan-out:pause@2:[0-9a-f]{64}$/);
    const others = [
      goalFanOutRequestId(GOAL, 3, run, 'pause'),
      goalFanOutRequestId(GOAL, 2, runRef('run-b'), 'pause'),
      goalFanOutRequestId(GOAL, 2, run, 'cancel'),
      goalFanOutRequestId(GOAL, 2, run, 'resume'),
      goalFanOutRequestId({ ...GOAL, goalId: 'g-2' }, 2, run, 'pause'),
      goalFanOutRequestId({ ...GOAL, projectId: 'p-other' }, 2, run, 'pause'),
    ];
    expect(new Set([id, ...others]).size).toBe(others.length + 1);
  });

  it('only the identity fields of the refs count', () => {
    const extended = { ...run, note: 'ignored' } as unknown as RunRef;
    expect(goalFanOutRequestId(GOAL, 2, extended, 'pause')).toBe(goalFanOutRequestId(GOAL, 2, run, 'pause'));
  });

  it('goalFanOutReason is the fixed text goal:<goalId>:<control>@<epoch>', () => {
    expect(goalFanOutReason(GOAL, 'cancel', 5)).toBe('goal:g-1:cancel@5');
  });

  it('goalResumeContinueRequestId is per resume epoch and afterRun, and never a fan-out id', () => {
    const id = goalResumeContinueRequestId(GOAL, 4, run);
    expect(id).toMatch(/^goal-resume-continue@4:[0-9a-f]{64}$/);
    expect(id).toBe(goalResumeContinueRequestId(GOAL, 4, { ...run }));
    expect(goalResumeContinueRequestId(GOAL, 5, run)).not.toBe(id);
    expect(goalResumeContinueRequestId(GOAL, 4, runRef('run-b'))).not.toBe(id);
  });
});

// --------------------------------------------------------------------------
// Run / ControlIntent fixtures
// --------------------------------------------------------------------------

const ROLE: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'policy-1',
};

function runOf(runId: string, taskId: string, overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    ref: runRef(runId), revision: 3, schemaVersion: 1, task: { projectId: PROJECT, goalId: GOAL_ID, taskId },
    attemptId: `${runId}-attempt`, planRef: P1, roleBinding: ROLE, budget: { tokenBudget: 1000, deadline: null },
    workspaceSnapshot: { workspaceId: WORKSPACE, revision: 1 }, status: 'ended', outcome: 'completed', exitCode: 0,
    lastEventSeq: 2, lastRuntimeEventId: `rt-${runId}`, lastFactEventId: `ev-${runId}`, envelope: null,
    startedAt: T0, endedAt: T1, ...overrides,
  };
}

const intentRef = (intentId: string): ControlIntentRef =>
  ({ aggregateType: 'ControlIntent', projectId: PROJECT, workspaceId: WORKSPACE, intentId });

function queuedIntent(ref: ControlIntentRef, kind: 'pause' | 'cancel', requestedBy: GoalHostActorRef, run: RunRef): ControlIntentSnapshotV1 {
  return { schemaVersion: 1, ref, runRef: run, kind, desiredState: kind === 'pause' ? 'paused' : 'cancelled', reason: null,
    requestedAt: T0, requestedBy, revision: 1, status: 'queued' };
}
function settledIntent(intent: ControlIntentSnapshotV1,
  status: 'applied' | 'superseded' | 'outcome_unknown', kind: 'paused' | 'cancelled' | 'resumed' | 'superseded_by_newer' | 'outcome_unknown'): ControlIntentSnapshotV1 {
  const { revision: _revision, status: _status, ...request } = intent;
  void _revision; void _status;
  const detail = status === 'superseded' ? { supersededBy: intentRef('ci-newer') }
    : status === 'outcome_unknown' ? { hostInstanceId: 'host-1', runOutcome: 'outcome_unknown' as const }
      : { entryPhase: 'none' as const };
  const origin = status === 'superseded' ? 'platform_superseded' as const
    : status === 'outcome_unknown' ? 'platform_reconcile' as const : 'platform_not_entered' as const;
  return { ...request, revision: 2, status, observation: { schemaVersion: 1, origin, kind, runRevision: 4, detail, observedAt: T1 } };
}

const crashedEvent = (run: RunRef): RuntimeEventV1 => ({ eventType: 'run_crashed', schemaVersion: 1, eventId: `rt-${run.runId}`,
  runRef: run, sequence: 3, occurredAt: T1, payload: { kind: 'crashed', error: 'host_interrupted_while_paused' } });

/** RUN-24: paused by `intent`, then ended `crashed` by a Host restart (C4). */
function pausedInterruptedRun(runId: string, taskId: string, intent: ControlIntentSnapshotV1): RunSnapshot {
  const ref = runRef(runId);
  return runOf(runId, taskId, { outcome: 'crashed', exitCode: null,
    controlState: { intentRef: intent.ref, desiredState: 'paused' },
    reconciliation: { status: 'done', observation: { kind: 'interrupted_clean', event: crashedEvent(ref), lastPosition: 4,
      kernelPaused: true, pausedIntentRef: intent.ref }, basis: { kind: 'live_clean' }, recordedAt: T1 } });
}

/** The injected `controlIntentRefFor(GOAL_FAN_OUT_ACTOR, scope, requestId)` of the tests. */
const fanOutIntentRefFor = (requestId: string): ControlIntentRef => intentRef(`ci:${requestId}`);
const fanOutRef = (epoch: number, run: RunRef, control: 'pause' | 'cancel' | 'resume' = 'pause'): ControlIntentRef =>
  fanOutIntentRefFor(goalFanOutRequestId(GOAL, epoch, run, control));

// --------------------------------------------------------------------------
// runStops (§2.1 projectGoalRunStop)
// --------------------------------------------------------------------------

describe('§2.1 projectGoalRunStop: orders 0..8', () => {
  const SUPPORTED: GoalRunControlCapabilityV1 = { status: 'supported' };
  const UNSUPPORTED: GoalRunControlCapabilityV1 = { status: 'unsupported', reason: 'the query adapter has no pause' };
  const run = runRef('run-a');
  const FAN_OUT = fanOutRef(3, run);
  const live = runOf('run-a', 't-build', { status: 'running', outcome: null, exitCode: null, endedAt: null });
  const fanOutPause = queuedIntent(FAN_OUT, 'pause', GOAL_FAN_OUT_ACTOR, run);
  const stop = (r: RunSnapshot, intent: ControlIntentSnapshotV1 | null, capability: GoalRunControlCapabilityV1 = SUPPORTED) =>
    projectGoalRunStop(r, intent, FAN_OUT, capability).stop;

  it('0: paused-interrupted precedes ended:crashed, with who paused it', () => {
    const byFanOut = pausedInterruptedRun('run-a', 't-build', fanOutPause);
    expect(projectGoalRunStop(byFanOut, fanOutPause, FAN_OUT, UNSUPPORTED))
      .toEqual({ runRef: run, stop: { kind: 'paused_interrupted', pausedBy: 'goal_fan_out' } });
    const humanPause = queuedIntent(intentRef('ci-human'), 'pause', HUMAN, run);
    expect(stop(pausedInterruptedRun('run-a', 't-build', humanPause), humanPause))
      .toEqual({ kind: 'paused_interrupted', pausedBy: 'human' });
    // A plain RUN-19 interruption (no pause intent) is an ordinary crash.
    const plain = runOf('run-a', 't-build', { outcome: 'crashed', exitCode: null,
      reconciliation: { status: 'done', observation: { kind: 'interrupted_clean', event: crashedEvent(run), lastPosition: 4,
        kernelPaused: false, pausedIntentRef: null }, basis: { kind: 'live_clean' }, recordedAt: T1 } });
    expect(stop(plain, null)).toEqual({ kind: 'ended', outcome: 'crashed' });
  });

  it('1/2: a known outcome, then outcome_unknown (D-4 待核对), before any capability or intent', () => {
    for (const outcome of ['completed', 'failed', 'cancelled', 'budget_exhausted', 'crashed', 'yielded'] as const) {
      expect(stop(runOf('run-a', 't-build', { outcome }), fanOutPause, UNSUPPORTED)).toEqual({ kind: 'ended', outcome });
    }
    expect(stop(runOf('run-a', 't-build', { outcome: 'outcome_unknown' }), fanOutPause, UNSUPPORTED)).toEqual({ kind: 'unknown_outcome' });
  });

  it('3: an unsupported control capability of a live Run, with its reason', () => {
    expect(stop(live, fanOutPause, UNSUPPORTED)).toEqual({ kind: 'unsupported', reason: 'the query adapter has no pause' });
    // Before order 8: a Run that cannot be controlled is never shown as "not delivered yet".
    expect(stop(live, null, UNSUPPORTED)).toEqual({ kind: 'unsupported', reason: 'the query adapter has no pause' });
  });

  it('4..6: this epoch\'s fan-out intent queued / applied / outcome_unknown', () => {
    expect(stop(live, fanOutPause)).toEqual({ kind: 'stop_requested' });
    expect(stop(live, settledIntent(fanOutPause, 'applied', 'paused'))).toEqual({ kind: 'paused' });
    const fanOutCancel = queuedIntent(FAN_OUT, 'cancel', GOAL_FAN_OUT_ACTOR, run);
    expect(stop(live, settledIntent(fanOutCancel, 'applied', 'cancelled'))).toEqual({ kind: 'cancelled' });
    expect(stop(live, settledIntent(fanOutPause, 'outcome_unknown', 'outcome_unknown'))).toEqual({ kind: 'stop_unknown' });
  });

  it('7: any other pointer intent is shown as it is (also a stale fan-out fate outside rows 4..6)', () => {
    const userPause = queuedIntent(intentRef('ci-user'), 'pause', HUMAN, run);
    expect(stop(live, userPause)).toEqual({ kind: 'other_intent', intentRef: userPause.ref, intentKind: 'pause', status: 'queued' });
    const olderEpoch = queuedIntent(fanOutRef(1, run), 'pause', GOAL_FAN_OUT_ACTOR, run);
    expect(stop(live, olderEpoch)).toMatchObject({ kind: 'other_intent', intentRef: olderEpoch.ref });
    expect(stop(live, settledIntent(fanOutPause, 'superseded', 'superseded_by_newer')))
      .toEqual({ kind: 'other_intent', intentRef: FAN_OUT, intentKind: 'pause', status: 'superseded' });
    expect(stop(live, settledIntent(fanOutPause, 'applied', 'resumed')))
      .toEqual({ kind: 'other_intent', intentRef: FAN_OUT, intentKind: 'pause', status: 'applied' });
  });

  it('8: no pointer yet: not delivered (the driver retries)', () => {
    expect(stop(live, null)).toEqual({ kind: 'not_delivered' });
    const starting = runOf('run-a', 't-build', { status: 'starting', outcome: null, exitCode: null, startedAt: null, endedAt: null });
    expect(stop(starting, null)).toEqual({ kind: 'not_delivered' });
  });
});

// --------------------------------------------------------------------------
// GOAL-29 continuation selection
// --------------------------------------------------------------------------

describe('GOAL-29 findGoalResumeContinuations', () => {
  function resumedGoal(epoch: number, desiredState: GoalDesiredState = 'active') {
    return { ref: GOAL, desiredState, desiredStateRevision: epoch };
  }
  function fanOutPausedTask(taskId: string, epoch: number, overrides: Partial<GoalResumeTaskFactsV1> = {}): GoalResumeTaskFactsV1 {
    const run = runRef(`run-${taskId}`);
    const intent = queuedIntent(fanOutRef(epoch, run), 'pause', GOAL_FAN_OUT_ACTOR, run);
    return { taskId, taskKind: 'work', selectedRun: pausedInterruptedRun(run.runId, taskId, intent), pointerIntent: intent,
      covered: false, ...overrides };
  }

  it('selects a Run paused by this Goal\'s fan-out, with its pause epoch and the resume trigger', () => {
    const task = fanOutPausedTask('t-build', 2);
    const found = findGoalResumeContinuations({ goal: resumedGoal(3), tasks: [task], fanOutIntentRefFor });
    const afterRunRef = runRef('run-t-build');
    expect(found).toEqual([{ taskId: 't-build', afterRunRef, pausedEpoch: 2,
      requestId: goalResumeContinueRequestId(GOAL, 3, afterRunRef),
      trigger: { kind: 'goal_resume', goalRef: GOAL, resumedEpoch: 3, pausedEpoch: 2 } }]);
  });

  it('selects a Run still on an older epoch\'s intent (e0 → restart → resume e1 lost → pause e2 → resume e3)', () => {
    const found = findGoalResumeContinuations({ goal: resumedGoal(4), tasks: [fanOutPausedTask('t-build', 1)], fanOutIntentRefFor });
    expect(found.map((entry) => entry.pausedEpoch)).toEqual([1]);
    expect(found[0]?.trigger).toEqual({ kind: 'goal_resume', goalRef: GOAL, resumedEpoch: 4, pausedEpoch: 1 });
  });

  it('never selects a pause a person submitted alone', () => {
    const run = runRef('run-t-build');
    const human = queuedIntent(intentRef('ci-human'), 'pause', HUMAN, run);
    const task: GoalResumeTaskFactsV1 = { taskId: 't-build', taskKind: 'work',
      selectedRun: pausedInterruptedRun(run.runId, 't-build', human), pointerIntent: human, covered: false };
    expect(findGoalResumeContinuations({ goal: resumedGoal(3), tasks: [task], fanOutIntentRefFor })).toEqual([]);
    // A fan-out actor intent whose ref is not this Goal's fan-out identity is not selected either.
    const forged = queuedIntent(intentRef('ci-forged'), 'pause', GOAL_FAN_OUT_ACTOR, run);
    const forgedTask: GoalResumeTaskFactsV1 = { ...task, selectedRun: pausedInterruptedRun(run.runId, 't-build', forged),
      pointerIntent: forged };
    expect(findGoalResumeContinuations({ goal: resumedGoal(3), tasks: [forgedTask], fanOutIntentRefFor })).toEqual([]);
    // Both checks hold on their own: the fan-out identity with another requester is not selected (TASK-27).
    const wrongActor = queuedIntent(fanOutRef(2, run), 'pause', HUMAN, run);
    const wrongActorTask: GoalResumeTaskFactsV1 = { ...task, selectedRun: pausedInterruptedRun(run.runId, 't-build', wrongActor),
      pointerIntent: wrongActor };
    expect(findGoalResumeContinuations({ goal: resumedGoal(3), tasks: [wrongActorTask], fanOutIntentRefFor })).toEqual([]);
  });

  it('skips covered Runs, gates, Runs that are not paused-interrupted, future epochs and a non-active Goal', () => {
    const base = fanOutPausedTask('t-build', 2);
    const cases: GoalResumeTaskFactsV1[] = [
      { ...base, covered: true },
      { ...base, taskKind: 'gate' },
      { ...base, selectedRun: runOf('run-t-build', 't-build', { outcome: 'crashed', exitCode: null }) },
      { ...base, selectedRun: null },
      { ...base, pointerIntent: null },
      // The pointer moved off the pause intent recorded by the reconciliation.
      { ...base, pointerIntent: queuedIntent(fanOutRef(1, runRef('run-t-build')), 'pause', GOAL_FAN_OUT_ACTOR, runRef('run-t-build')) },
    ];
    for (const task of cases) expect(findGoalResumeContinuations({ goal: resumedGoal(3), tasks: [task], fanOutIntentRefFor })).toEqual([]);
    // E must be < the resume epoch.
    expect(findGoalResumeContinuations({ goal: resumedGoal(2), tasks: [base], fanOutIntentRefFor })).toEqual([]);
    for (const desiredState of ['paused', 'cancelled'] as const) {
      expect(findGoalResumeContinuations({ goal: resumedGoal(3, desiredState), tasks: [base], fanOutIntentRefFor })).toEqual([]);
    }
  });

  it('keeps the active-plan order of several Tasks', () => {
    const found = findGoalResumeContinuations({ goal: resumedGoal(5),
      tasks: [fanOutPausedTask('t-b', 4), fanOutPausedTask('t-a', 2)], fanOutIntentRefFor });
    expect(found.map((entry) => [entry.taskId, entry.pausedEpoch])).toEqual([['t-b', 4], ['t-a', 2]]);
  });
});

// --------------------------------------------------------------------------
// Display reduction (§2.1)
// --------------------------------------------------------------------------

const PROPOSAL: PlanProposalRef = { aggregateType: 'PlanProposal', projectId: PROJECT, workspaceId: WORKSPACE, proposalId: 'prop-1' };
const roundRef = (taskId: string): VerificationRoundRef => ({ aggregateType: 'VerificationRound', projectId: PROJECT,
  workspaceId: WORKSPACE, goalId: GOAL_ID, taskId, runId: `run-${taskId}`, roundId: `round-${taskId}` });
const requeueRef = (taskId: string): TaskRequeueRef => ({ aggregateType: 'TaskRequeue', projectId: PROJECT, goalId: GOAL_ID,
  taskId, afterRunId: `run-${taskId}` });
const FAILING: FailingCheckFactV1[] = [{ checkId: 'unit', phase: 'finished', outcome: 'FAIL', cause: null, reportRef: null }];

type Failure = NonNullable<GoalDisplayTaskFactsV1['failure']>;
type Round = NonNullable<TaskFailureFactsV1['round']>;

function roundOf(taskId: string, overrides: Partial<Round> = {}): Round {
  return { roundRef: roundRef(taskId), status: 'finalized', outcome: 'FAIL', failingChecks: FAILING, gapCodes: [],
    sourceDigest: 'digest-1', workspaceRevision: 1, ordinal: 1, autoCount: 0, ...overrides };
}
function failureOf(verdict: TaskAutomationVerdictV1, overrides: { round?: Round | null; requeueAutoCount?: number; cap?: number;
  failureClass?: Failure['failureClass']; coveringRequeue?: TaskRequeueRef | null } = {}): Failure {
  return {
    failureClass: overrides.failureClass === undefined ? 'run_failed' : overrides.failureClass,
    round: overrides.round ?? null,
    automation: { cap: overrides.cap ?? 3, requeueAutoCount: overrides.requeueAutoCount ?? 0,
      coveringRequeue: overrides.coveringRequeue ?? null, lastRefusal: null, lastReverifyRefusal: null, verdict },
  };
}
const stopped = (reason: TaskAutomationStopReason, detail: TaskAutomationStopDetailV1 = {}): TaskAutomationVerdictV1 =>
  ({ kind: 'stopped', reason, detail });
const REQUEUE: TaskAutomationVerdictV1 = { kind: 'requeue', failureClass: 'run_failed', retryAfterRefusal: false };

function task(taskId: string, overrides: Partial<GoalDisplayTaskFactsV1> = {}): GoalDisplayTaskFactsV1 {
  return { taskId, taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', phaseCause: null,
    dispatchable: false, failure: null, reworkEntries: [], coveredTaskIds: [], ...overrides };
}
function facts(overrides: Partial<GoalDisplayFactsV1> = {}): GoalDisplayFactsV1 {
  return { desiredState: 'active', activePlanRef: P1, completion: { status: 'not_recorded' }, partialAcceptance: null,
    pendingProposal: null, tasks: [], runsByTaskId: new Map(), runStopInputs: [], ...overrides };
}
const liveRunOf = (taskId: string): RunSnapshot =>
  runOf(`run-${taskId}`, taskId, { status: 'running', outcome: null, exitCode: null, endedAt: null });
const runsOf = (...entries: [string, RunSnapshot][]): ReadonlyMap<string, readonly RunSnapshot[]> =>
  new Map(entries.map(([taskId, run]) => [taskId, [run]]));
const headline = (input: GoalDisplayFactsV1) => {
  const display = reduceGoalDisplay(input);
  return { phase: display.phase, row: display.row, cause: display.cause };
};

describe('§2.1 reduceGoalDisplay: one case per priority row', () => {
  const failedTask = task('t-build', { phase: 'failed', failure: failureOf({ kind: 'none' }) });

  it('GOAL-17 CANCELLED beats completion and carries runStops', () => {
    const run = liveRunOf('t-build');
    const display = reduceGoalDisplay(facts({ desiredState: 'cancelled', completion: { status: 'recorded', selectedPlanMatches: true },
      tasks: [task('t-build', { phase: 'running' })], runsByTaskId: runsOf(['t-build', run]),
      runStopInputs: [{ run, pointedIntent: null, fanOutIntentRef: fanOutRef(2, run.ref, 'cancel'), capability: { status: 'supported' } }] }));
    expect(display).toMatchObject({ phase: 'CANCELLED', row: 'GOAL-17', cause: null });
    expect(display.runStops).toEqual([{ runRef: run.ref, stop: { kind: 'not_delivered' } }]);
  });

  it('GOAL-18 COMPLETED only for the active plan', () => {
    expect(headline(facts({ completion: { status: 'recorded', selectedPlanMatches: true } })))
      .toEqual({ phase: 'COMPLETED', row: 'GOAL-18', cause: null });
    expect(headline(facts({ completion: { status: 'recorded', selectedPlanMatches: false } })).phase).toBe('RUNNING');
  });

  it('GOAL-20 PAUSED with runStops; a completion for the active plan still reads COMPLETED', () => {
    const display = reduceGoalDisplay(facts({ desiredState: 'paused' }));
    expect(display).toMatchObject({ phase: 'PAUSED', row: 'GOAL-20', cause: null, runStops: [] });
    const completed = reduceGoalDisplay(facts({ desiredState: 'paused', completion: { status: 'recorded', selectedPlanMatches: true } }));
    expect(completed).toMatchObject({ phase: 'COMPLETED', runStops: [] });
    expect(reduceGoalDisplay(facts()).runStops).toBeNull();
  });

  it('GOAL-21 PLANNING/initial_plan_pending (not NEEDS_DECISION), GOAL-22 PLANNING', () => {
    expect(headline(facts({ activePlanRef: null, pendingProposal: { ref: PROPOSAL, basedOn: null } })))
      .toEqual({ phase: 'PLANNING', row: 'GOAL-21', cause: { code: 'initial_plan_pending', proposalRef: PROPOSAL } });
    expect(headline(facts({ activePlanRef: null }))).toEqual({ phase: 'PLANNING', row: 'GOAL-22', cause: null });
    // Only an initial candidate (basedOn null) is initial_plan_pending; any other pending candidate is neither cause.
    const based = reduceGoalDisplay(facts({ activePlanRef: null, pendingProposal: { ref: PROPOSAL, basedOn: P1 } }));
    expect(based).toMatchObject({ phase: 'PLANNING', row: 'GOAL-22', cause: null });
    expect(based.causes).toEqual([]);
  });

  it('GOAL-23 NEEDS_DECISION/unknown_outcome for the ended branches of runUnresolvedBlocker only', () => {
    const unknown = runOf('run-t-build', 't-build', { outcome: 'outcome_unknown' });
    expect(headline(facts({ tasks: [task('t-build', { phase: 'blocked' })], runsByTaskId: runsOf(['t-build', unknown]) })))
      .toEqual({ phase: 'NEEDS_DECISION', row: 'GOAL-23', cause: { code: 'unknown_outcome', taskId: 't-build', runRef: unknown.ref } });
    const quarantined = runOf('run-t-build', 't-build', { outcome: 'failed', reconciliation: { status: 'quarantined',
      observation: { kind: 'unresolved', reason: 'tool call in flight', observedThroughPosition: 3, unresolvedToolCallIds: ['tc-1'] },
      basis: { kind: 'live_clean' }, recordedAt: T1 } });
    expect(headline(facts({ runsByTaskId: runsOf(['t-build', quarantined]) })).row).toBe('GOAL-23');
    const authUnknown = runOf('run-t-build', 't-build', { outcome: 'crashed', executionAuthorization: { schemaVersion: 2,
      generation: 1, sessionGeneration: 1, revision: 2, consumerId: 'c-1', inputDigest: 'd', phase: 'unknown', kernel: null } });
    expect(headline(facts({ runsByTaskId: runsOf(['t-build', authUnknown]) })).row).toBe('GOAL-23');
    // starting|running is not a decision.
    expect(headline(facts({ tasks: [task('t-build', { phase: 'running' })], runsByTaskId: runsOf(['t-build', liveRunOf('t-build')]) })))
      .toEqual({ phase: 'RUNNING', row: 'GOAL-27', cause: null });
  });

  it('GOAL-24 FAILED/task_failed for a required active work Task without automation', () => {
    expect(headline(facts({ tasks: [failedTask] })))
      .toEqual({ phase: 'FAILED', row: 'GOAL-24', cause: { code: 'task_failed', taskId: 't-build' } });
  });

  it('GOAL-25 BLOCKED/task_blocked and BLOCKED/no_dispatchable_work', () => {
    expect(headline(facts({ tasks: [task('t-build', { phase: 'blocked' })] })))
      .toEqual({ phase: 'BLOCKED', row: 'GOAL-25', cause: { code: 'task_blocked', taskId: 't-build' } });
    expect(headline(facts({ tasks: [task('t-build', { phase: 'pending' })] })))
      .toEqual({ phase: 'BLOCKED', row: 'GOAL-25', cause: { code: 'no_dispatchable_work', taskIds: ['t-build'] } });
  });

  it('GOAL-26 CHANGE_PENDING after FAILED/BLOCKED; the candidate is still a cause', () => {
    const pending = { ref: PROPOSAL, basedOn: P1 };
    expect(headline(facts({ pendingProposal: pending, tasks: [task('t-build', { dispatchable: true })] })))
      .toEqual({ phase: 'CHANGE_PENDING', row: 'GOAL-26', cause: { code: 'change_pending', proposalRef: PROPOSAL } });
    const failed = reduceGoalDisplay(facts({ pendingProposal: pending, tasks: [failedTask] }));
    expect(failed.phase).toBe('FAILED');
    expect(failed.causes).toContainEqual({ code: 'change_pending', proposalRef: PROPOSAL });
    // A candidate based on another plan is stale, not pending for this plan.
    expect(headline(facts({ pendingProposal: { ref: PROPOSAL, basedOn: P2 }, tasks: [task('t-build', { dispatchable: true })] })).phase)
      .toBe('RUNNING');
  });

  it('GOAL-27 RUNNING otherwise', () => {
    expect(headline(facts({ tasks: [task('t-build', { phase: 'ready', dispatchable: true })] })))
      .toEqual({ phase: 'RUNNING', row: 'GOAL-27', cause: null });
  });

  it('GOAL-19 ACCEPTED_PARTIAL is declared and never produced', () => {
    expect(GOAL_DISPLAY_PHASES).toContain('ACCEPTED_PARTIAL');
    expect(GOAL_DISPLAY_ROWS).toContain('GOAL-19');
    expect(reduceGoalDisplay(facts()).phase).not.toBe('ACCEPTED_PARTIAL');
  });

  it('a desired state or Goal node outside the closed unions is unreachable, never RUNNING (§1.1 never switches)', () => {
    const archived = 'archived' as unknown as GoalDesiredState;
    expect(() => reduceGoalDisplay(facts({ desiredState: archived }))).toThrow('unreachable goal desired state');
    expect(() => findGoalResumeContinuations({ goal: { ref: GOAL, desiredState: archived, desiredStateRevision: 3 }, tasks: [],
      fanOutIntentRefFor })).toThrow('unreachable goal desired state');
    const state: GoalMachineState = { ...STATES['activePlanned']!, node: archived };
    expect(() => transitionGoal(state, ADOPT_FUTURE, ctxFor(state))).toThrow('unreachable goal node');
    expect(() => transitionGoal(state, completeEvent(state), ctxFor(state))).toThrow('unreachable goal node');
  });
});

describe('§2.1 GOAL-30 NEEDS_DECISION: stop reasons and the headline rule', () => {
  const STOP_REASONS: [Exclude<TaskAutomationStopReason, 'unknown_outcome'>, TaskAutomationStopDetailV1][] = [
    ['auto_rework_cap_reached', { operation: 'requeue' }],
    ['no_new_basis', { operation: 'reverify' }],
    ['gate_needs_fix', { operation: 'reverify', failingChecks: FAILING }],
    ['verification_uncovered', { operation: 'reverify' }],
    ['budget_exhausted', { minTokenBudgetExclusive: 1000 }],
    ['task_cancelled', { fence: 'human_cancel' }],
    ['task_paused', { fence: 'human_pause', pausedBy: 'human' }],
    ['not_reworkable', { cause: 'round_ambiguous' }],
  ];

  for (const [reason, detail] of STOP_REASONS) {
    it(`${reason} → NEEDS_DECISION with its detail`, () => {
      const display = reduceGoalDisplay(facts({ tasks: [task('t-build', { phase: 'failed', failure: failureOf(stopped(reason, detail)) })] }));
      expect(display).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30', cause: { code: reason, taskId: 't-build', detail } });
    });
  }

  it('a stopped verdict with unknown_outcome is GOAL-23\'s, never a GOAL-30 cause', () => {
    const display = reduceGoalDisplay(facts({ tasks: [task('t-build', { phase: 'blocked',
      failure: failureOf(stopped('unknown_outcome')) })] }));
    expect(display.causes.some((cause) => cause.code === 'unknown_outcome')).toBe(false);
    expect(display.row).not.toBe('GOAL-30');
  });

  it('the headline cause is the first REQUIRED cause in plan order; earlier optional causes are only listed', () => {
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-opt', { requirementLevel: 'optional', phase: 'failed', failure: failureOf(stopped('no_new_basis', { operation: 'requeue' })) }),
      task('t-a', { phase: 'failed', failure: failureOf(stopped('budget_exhausted', { minTokenBudgetExclusive: 10 })) }),
      task('t-b', { phase: 'failed', failure: failureOf(stopped('auto_rework_cap_reached', { operation: 'requeue' })) }),
    ] }));
    expect(display.cause).toEqual({ code: 'budget_exhausted', taskId: 't-a', detail: { minTokenBudgetExclusive: 10 } });
    expect(display.causes.map((cause) => cause.code)).toEqual(['no_new_basis', 'budget_exhausted', 'auto_rework_cap_reached']);
  });

  it('a starting|running Run or a pending required verdict keeps RUNNING; the stop is still listed', () => {
    const stoppedTask = task('t-a', { phase: 'failed', failure: failureOf(stopped('no_new_basis', { operation: 'requeue' })) });
    const running = reduceGoalDisplay(facts({ tasks: [stoppedTask, task('t-b', { phase: 'running' })],
      runsByTaskId: runsOf(['t-b', liveRunOf('t-b')]) }));
    expect(running).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27' });
    expect(running.causes).toContainEqual({ code: 'no_new_basis', taskId: 't-a', detail: { operation: 'requeue' } });
    const pending = reduceGoalDisplay(facts({ tasks: [stoppedTask, task('t-b', { phase: 'failed', failure: failureOf(REQUEUE) })] }));
    expect(pending.phase).toBe('RUNNING');
    expect(pending.causes.map((cause) => cause.code)).toEqual(['no_new_basis', 'auto_rework_pending']);
    // A starting Run counts as well.
    const starting = runOf('run-t-b', 't-b', { status: 'starting', outcome: null, exitCode: null, startedAt: null, endedAt: null });
    expect(headline(facts({ tasks: [stoppedTask], runsByTaskId: runsOf(['t-b', starting]) })).phase).toBe('RUNNING');
  });

  it('an optional Task\'s stop alone never makes the headline', () => {
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-opt', { requirementLevel: 'optional', phase: 'failed', failure: failureOf(stopped('task_cancelled', { fence: 'human_cancel' })) }),
      task('t-a', { phase: 'ready', dispatchable: true }),
    ] }));
    expect(display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27' });
    expect(display.causes).toEqual([{ code: 'task_cancelled', taskId: 't-opt', detail: { fence: 'human_cancel' } }]);
  });

  it('a non-active Task produces no cause', () => {
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-old', { disposition: 'superseded', phase: 'failed', failure: failureOf(stopped('no_new_basis')) }),
      task('t-new', { phase: 'ready', dispatchable: true }),
    ] }));
    expect(display.causes).toEqual([]);
    expect(display.phase).toBe('RUNNING');
    // Not a GOAL-27 running cause either: no auto_rework_count for a superseded Task with automatic counts.
    const counted = reduceGoalDisplay(facts({ tasks: [
      task('t-old', { disposition: 'superseded', phase: 'failed',
        failure: failureOf({ kind: 'none' }, { requeueAutoCount: 2, round: roundOf('t-old', { autoCount: 1 }) }) }),
      task('t-new', { phase: 'ready', dispatchable: true }),
    ] }));
    expect(counted).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null });
    expect(counted.causes).toEqual([]);
  });

  it('GOAL-23 precedes GOAL-30', () => {
    const unknown = runOf('run-t-a', 't-a', { outcome: 'outcome_unknown' });
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-a', { phase: 'blocked', failure: failureOf(stopped('unknown_outcome')) }),
      task('t-b', { phase: 'failed', failure: failureOf(stopped('no_new_basis')) }),
    ], runsByTaskId: runsOf(['t-a', unknown]) }));
    expect(display).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-23' });
    expect(display.causes.map((cause) => cause.code)).toEqual(['unknown_outcome', 'no_new_basis']);
  });

  it('paused-interrupted: a person\'s pause and a Goal fan-out pause are both task_paused', () => {
    const human = reduceGoalDisplay(facts({ tasks: [task('t-a', { phase: 'blocked', phaseCause: { code: 'paused_interrupted' },
      failure: failureOf(stopped('task_paused', { fence: 'human_pause', pausedBy: 'human' }), { failureClass: 'interrupted' }) })] }));
    expect(human).toMatchObject({ phase: 'NEEDS_DECISION', cause: { code: 'task_paused', detail: { fence: 'human_pause' } } });
    const fanOut = reduceGoalDisplay(facts({ tasks: [task('t-a', { phase: 'blocked', phaseCause: { code: 'paused_interrupted' },
      failure: failureOf(stopped('task_paused', { pausedBy: 'goal_fan_out' }), { failureClass: 'interrupted' }) })] }));
    expect(fanOut).toMatchObject({ phase: 'NEEDS_DECISION', cause: { code: 'task_paused', detail: { pausedBy: 'goal_fan_out' } } });
  });

  it('a failed check_failed Task behind a human pause is NEEDS_DECISION/task_paused, not FAILED', () => {
    expect(headline(facts({ tasks: [task('t-a', { phase: 'failed',
      failure: failureOf(stopped('task_paused', { fence: 'human_pause', pausedBy: 'human' }), { failureClass: 'check_failed' }) })] })))
      .toEqual({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
        cause: { code: 'task_paused', taskId: 't-a', detail: { fence: 'human_pause', pausedBy: 'human' } } });
  });

  it('only deferred required work left → NEEDS_DECISION/required_task_deferred (one cause, all ids)', () => {
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-done', { phase: 'satisfied' }),
      task('t-later', { disposition: 'deferred' }),
      task('t-opt', { disposition: 'deferred', requirementLevel: 'optional' }),
      task('t-later-2', { disposition: 'deferred' }),
    ] }));
    expect(display).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
      cause: { code: 'required_task_deferred', taskIds: ['t-later', 't-later-2'] } });
    // A required active Task that can still run, is running or verifying suppresses it.
    for (const busy of [task('t-now', { phase: 'ready', dispatchable: true }), task('t-now', { phase: 'verifying' }),
      task('t-now', { phase: 'running' })]) {
      const other = reduceGoalDisplay(facts({ tasks: [task('t-later', { disposition: 'deferred' }), busy] }));
      expect(other.causes.some((cause) => cause.code === 'required_task_deferred')).toBe(false);
    }
    // An optional busy Task does not.
    const optionalBusy = reduceGoalDisplay(facts({ tasks: [task('t-later', { disposition: 'deferred' }),
      task('t-opt', { requirementLevel: 'optional', phase: 'ready', dispatchable: true })] }));
    expect(optionalBusy.causes).toContainEqual({ code: 'required_task_deferred', taskIds: ['t-later'] });
  });

  it('a deferred required Task that is already satisfied gives no cause', () => {
    const display = reduceGoalDisplay(facts({ tasks: [task('t-done', { phase: 'satisfied' }),
      task('t-later', { disposition: 'deferred', phase: 'satisfied' })] }));
    expect(display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null });
    expect(display.causes).toEqual([]);
  });

  it('the deferred cause takes its plan position for the headline', () => {
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-later', { disposition: 'deferred' }),
      task('t-a', { phase: 'failed', failure: failureOf(stopped('no_new_basis')) }),
    ] }));
    expect(display.cause).toEqual({ code: 'required_task_deferred', taskIds: ['t-later'] });
    expect(display.causes.map((cause) => cause.code)).toEqual(['required_task_deferred', 'no_new_basis']);
  });
});

describe('§2.1 GOAL-24/25 exclusions (C8, C7)', () => {
  it('GOAL-24 skips pending and stopped verdicts, gates, and waits for live Runs (failure only a cause)', () => {
    expect(headline(facts({ tasks: [task('t-a', { phase: 'failed', failure: failureOf(REQUEUE) })] })).phase).toBe('RUNNING');
    const gate = task('t-gate', { taskKind: 'gate', phase: 'failed', failure: failureOf({ kind: 'none' }, { round: roundOf('t-gate') }) });
    expect(headline(facts({ tasks: [gate] })).phase).not.toBe('FAILED');
    const running = reduceGoalDisplay(facts({ tasks: [task('t-a', { phase: 'failed' }), task('t-b', { phase: 'running' })],
      runsByTaskId: runsOf(['t-b', liveRunOf('t-b')]) }));
    expect(running.phase).toBe('RUNNING');
    expect(running.causes).toContainEqual({ code: 'task_failed', taskId: 't-a' });
  });

  it('GOAL-24 counts required work only: an optional failed work Task is neither the headline nor a task_failed cause', () => {
    const display = reduceGoalDisplay(facts({ tasks: [task('t-opt', { requirementLevel: 'optional', phase: 'failed' }),
      task('t-a', { phase: 'ready', dispatchable: true })] }));
    expect(display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null });
    expect(display.causes).toEqual([]);
  });

  it('GOAL-25 (b) progress is any claimable work Task: an optional one keeps a pending required Task RUNNING', () => {
    const display = reduceGoalDisplay(facts({ tasks: [task('t-a', { phase: 'pending' }),
      task('t-opt', { requirementLevel: 'optional', phase: 'ready', dispatchable: true })] }));
    expect(display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null });
    expect(display.causes).toEqual([]);
  });

  it('GOAL-25 (b) no_dispatchable_work is not even a cause while a Run is starting|running', () => {
    for (const requirementLevel of ['required', 'optional'] as const) {
      const display = reduceGoalDisplay(facts({ tasks: [task('t-a', { phase: 'pending' }),
        task('t-b', { requirementLevel, phase: 'running' })], runsByTaskId: runsOf(['t-b', liveRunOf('t-b')]) }));
      expect(display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null });
      expect(display.causes).toEqual([]);
    }
  });

  it('GOAL-25 (a) skips paused_interrupted and decided verdicts; (b) skips cancelled/superseded Tasks', () => {
    expect(headline(facts({ tasks: [task('t-a', { phase: 'blocked', phaseCause: { code: 'paused_interrupted' } }),
      task('t-b', { phase: 'ready', dispatchable: true })] })).phase).toBe('RUNNING');
    const reverify: TaskAutomationVerdictV1 = { kind: 'reverify', roundRef: roundRef('t-a'), needsFinalize: false,
      onlyIfSourceChanged: false, failureClass: 'check_incomplete', retryAfterRefusal: false };
    expect(headline(facts({ tasks: [task('t-a', { phase: 'blocked', failure: failureOf(reverify) })] })).phase).toBe('RUNNING');
    // The obligation of a cancelled required Task is carried elsewhere: not BLOCKED.
    expect(headline(facts({ tasks: [task('t-old', { disposition: 'cancelled', phase: 'failed' }),
      task('t-new', { phase: 'satisfied' })] })).phase).toBe('RUNNING');
  });

  it('GOAL-25 (b) skips a paused_interrupted required Task even with verdict none and nothing claimable (§15.3)', () => {
    const display = reduceGoalDisplay(facts({ tasks: [task('t-a', { phase: 'blocked', phaseCause: { code: 'paused_interrupted' },
      failure: failureOf({ kind: 'none' }, { failureClass: 'interrupted' }) })] }));
    expect(display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null });
    expect(display.causes).toEqual([]);
  });

  it('all work satisfied and the required gate without a chain → RUNNING/awaiting_gate, not BLOCKED', () => {
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-a', { phase: 'satisfied' }),
      task('t-gate', { taskKind: 'gate', phase: 'pending', coveredTaskIds: ['t-a'] }),
    ] }));
    expect(display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27' });
    expect(display.causes).toEqual([{ code: 'awaiting_gate', gateTaskId: 't-gate' }]);
  });

  it('a verifying Task is progress for GOAL-25 (b); an optional gate is never awaited', () => {
    expect(headline(facts({ tasks: [task('t-a', { phase: 'verifying' }), task('t-b', { phase: 'pending' })] })).phase).toBe('RUNNING');
    const optionalGate = reduceGoalDisplay(facts({ tasks: [
      task('t-a', { phase: 'satisfied' }),
      task('t-gate', { taskKind: 'gate', requirementLevel: 'optional', phase: 'pending', coveredTaskIds: ['t-a'] }),
    ] }));
    expect(optionalGate.causes).toEqual([]);
    expect(optionalGate.phase).toBe('RUNNING');
  });

  it('awaiting_gate does not wait for cancelled/superseded required work in the gate scope (completion-policy.ts:239)', () => {
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-a', { phase: 'satisfied' }),
      task('t-old', { disposition: 'cancelled', phase: 'failed' }),
      task('t-older', { disposition: 'superseded', phase: 'pending' }),
      task('t-gate', { taskKind: 'gate', phase: 'pending', coveredTaskIds: ['t-a', 't-old', 't-older'] }),
    ] }));
    expect(display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null });
    expect(display.causes).toEqual([{ code: 'awaiting_gate', gateTaskId: 't-gate' }]);
  });

  it('a gate without a chain whose work is unfinished is not awaiting; nothing to claim is BLOCKED', () => {
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-a', { phase: 'pending' }),
      task('t-gate', { taskKind: 'gate', phase: 'pending', coveredTaskIds: ['t-a'] }),
    ] }));
    expect(display).toMatchObject({ phase: 'BLOCKED', cause: { code: 'no_dispatchable_work', taskIds: ['t-a', 't-gate'] } });
  });
});

describe('§2.1 GOAL-27 running causes and the gate flow (C5, C8)', () => {
  it('auto_rework_pending for requeue, reverify and claim_requeued (class of the covering TaskRequeue)', () => {
    const reverify: TaskAutomationVerdictV1 = { kind: 'reverify', roundRef: roundRef('t-b'), needsFinalize: true,
      onlyIfSourceChanged: false, failureClass: 'check_incomplete', retryAfterRefusal: true };
    const claim: TaskAutomationVerdictV1 = { kind: 'claim_requeued', requeueRef: requeueRef('t-c'), budget: null };
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-a', { phase: 'failed', failure: failureOf(REQUEUE) }),
      task('t-b', { phase: 'blocked', failure: failureOf(reverify) }),
      task('t-c', { phase: 'pending', failure: failureOf(claim, { failureClass: null }),
        reworkEntries: [{ ref: requeueRef('t-c'), failureClass: 'check_failed' }] }),
      task('t-d', { phase: 'pending', failure: failureOf({ kind: 'claim_requeued', requeueRef: requeueRef('t-d'), budget: null },
        { failureClass: 'cancelled' }) }),
    ] }));
    expect(display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null });
    expect(display.causes).toEqual([
      { code: 'auto_rework_pending', taskId: 't-a', operation: 'requeue', failureClass: 'run_failed' },
      { code: 'auto_rework_pending', taskId: 't-b', operation: 'reverify', failureClass: 'check_incomplete' },
      { code: 'auto_rework_pending', taskId: 't-c', operation: 'requeue', failureClass: 'check_failed' },
      { code: 'auto_rework_pending', taskId: 't-d', operation: 'requeue', failureClass: 'cancelled' },
    ]);
  });

  it('auto_rework_count takes the requeue count and the round chain count separately', () => {
    const display = reduceGoalDisplay(facts({ tasks: [task('t-a', { phase: 'failed',
      failure: failureOf(REQUEUE, { requeueAutoCount: 2, cap: 5, round: roundOf('t-a', { autoCount: 1 }) }) })] }));
    expect(display.causes).toEqual([
      { code: 'auto_rework_pending', taskId: 't-a', operation: 'requeue', failureClass: 'run_failed' },
      { code: 'auto_rework_count', taskId: 't-a', operation: 'requeue', n: 2, cap: 5 },
      { code: 'auto_rework_count', taskId: 't-a', operation: 'reverify', n: 1, cap: 5 },
    ]);
  });

  it('gate head FAIL with a reverify verdict → RUNNING/auto_rework_pending (reverify)', () => {
    const verdict: TaskAutomationVerdictV1 = { kind: 'reverify', roundRef: roundRef('t-gate'), needsFinalize: false,
      onlyIfSourceChanged: true, failureClass: 'check_failed', retryAfterRefusal: false };
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-a', { phase: 'satisfied' }),
      task('t-gate', { taskKind: 'gate', phase: 'failed', coveredTaskIds: ['t-a'],
        failure: failureOf(verdict, { failureClass: 'check_failed', round: roundOf('t-gate') }) }),
    ] }));
    expect(display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27' });
    expect(display.causes).toEqual([{ code: 'auto_rework_pending', taskId: 't-gate', operation: 'reverify', failureClass: 'check_failed' }]);
  });

  it('after source_unchanged the gate is NEEDS_DECISION/gate_needs_fix with the failing checks; never FAILED', () => {
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-a', { phase: 'satisfied' }),
      task('t-gate', { taskKind: 'gate', phase: 'failed', coveredTaskIds: ['t-a'], failure: failureOf(
        stopped('gate_needs_fix', { operation: 'reverify', failingChecks: FAILING }), { failureClass: 'check_failed', round: roundOf('t-gate') }) }),
    ] }));
    expect(display).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
      cause: { code: 'gate_needs_fix', taskId: 't-gate', detail: { failingChecks: FAILING } } });
  });

  it('a required fix Task in the gate scope → RUNNING/gate_fix_in_progress', () => {
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-a', { phase: 'satisfied' }),
      task('t-fix', { phase: 'ready', dispatchable: true }),
      task('t-gate', { taskKind: 'gate', phase: 'failed', coveredTaskIds: ['t-a', 't-fix'],
        failure: failureOf({ kind: 'none' }, { failureClass: 'check_failed', round: roundOf('t-gate') }) }),
    ] }));
    expect(display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27' });
    expect(display.causes).toEqual([{ code: 'gate_fix_in_progress', gateTaskId: 't-gate', failingChecks: FAILING }]);
    // Even without a claimable Task, gate progress is not BLOCKED (GOAL-25 (b)).
    const waiting = reduceGoalDisplay(facts({ tasks: [
      task('t-fix', { phase: 'pending' }),
      task('t-gate', { taskKind: 'gate', phase: 'failed', coveredTaskIds: ['t-fix'],
        failure: failureOf({ kind: 'none' }, { round: roundOf('t-gate') }) }),
    ] }));
    expect(waiting.phase).toBe('RUNNING');
  });

  it('GV-5: deferred or cancelled required work in the gate scope is not a fix in progress', () => {
    const verdict: TaskAutomationVerdictV1 = { kind: 'reverify', roundRef: roundRef('t-gate'), needsFinalize: false,
      onlyIfSourceChanged: true, failureClass: 'check_failed', retryAfterRefusal: false };
    const display = reduceGoalDisplay(facts({ tasks: [
      task('t-later', { disposition: 'deferred', phase: 'pending' }),
      task('t-old', { disposition: 'cancelled', phase: 'failed' }),
      task('t-gate', { taskKind: 'gate', phase: 'failed', coveredTaskIds: ['t-later', 't-old'],
        failure: failureOf(verdict, { failureClass: 'check_failed', round: roundOf('t-gate') }) }),
    ] }));
    // The pending reverify of the required gate keeps the GOAL-30 cause off the headline.
    expect(display).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null });
    expect(display.causes).toEqual([
      { code: 'required_task_deferred', taskIds: ['t-later'] },
      { code: 'auto_rework_pending', taskId: 't-gate', operation: 'reverify', failureClass: 'check_failed' },
    ]);
  });

  it('a legacy PASS with gaps is not a clean PASS (VD-4): never gate_verifying; GV-5 or GV-10 as for a non-PASS head', () => {
    const passWithGaps = roundOf('t-gate', { outcome: 'PASS', failingChecks: [], gapCodes: ['evidence_missing'] });
    // GV-5: required active work in the scope is unsatisfied.
    const fixing = reduceGoalDisplay(facts({ tasks: [
      task('t-fix', { phase: 'pending' }),
      task('t-gate', { taskKind: 'gate', phase: 'blocked', coveredTaskIds: ['t-fix'],
        failure: failureOf({ kind: 'none' }, { failureClass: 'check_incomplete', round: passWithGaps }) }),
    ] }));
    expect(fixing).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null });
    expect(fixing.causes).toEqual([{ code: 'gate_fix_in_progress', gateTaskId: 't-gate', failingChecks: [] }]);
    // GV-10: the work is satisfied, the gate reverifies (check_incomplete).
    const verdict: TaskAutomationVerdictV1 = { kind: 'reverify', roundRef: roundRef('t-gate'), needsFinalize: false,
      onlyIfSourceChanged: false, failureClass: 'check_incomplete', retryAfterRefusal: false };
    const reverifying = reduceGoalDisplay(facts({ tasks: [
      task('t-a', { phase: 'satisfied' }),
      task('t-gate', { taskKind: 'gate', phase: 'blocked', coveredTaskIds: ['t-a'],
        failure: failureOf(verdict, { failureClass: 'check_incomplete', round: passWithGaps }) }),
    ] }));
    expect(reverifying).toMatchObject({ phase: 'RUNNING', row: 'GOAL-27', cause: null });
    expect(reverifying.causes).toEqual([
      { code: 'auto_rework_pending', taskId: 't-gate', operation: 'reverify', failureClass: 'check_incomplete' },
    ]);
  });

  it('gate_verifying: head open, or PASS without gaps awaiting completion', () => {
    for (const round of [roundOf('t-gate', { status: 'open', outcome: null, failingChecks: [] }),
      roundOf('t-gate', { outcome: 'PASS', failingChecks: [] })]) {
      const display = reduceGoalDisplay(facts({ tasks: [
        task('t-a', { phase: 'satisfied' }),
        task('t-gate', { taskKind: 'gate', phase: 'verifying', coveredTaskIds: ['t-a'], failure: failureOf({ kind: 'none' }, { round }) }),
      ] }));
      expect(display).toMatchObject({ phase: 'RUNNING' });
      expect(display.causes).toEqual([{ code: 'gate_verifying', gateTaskId: 't-gate' }]);
    }
    // A satisfied gate has nothing to show.
    expect(reduceGoalDisplay(facts({ tasks: [task('t-gate', { taskKind: 'gate', phase: 'satisfied',
      failure: failureOf({ kind: 'none' }, { round: roundOf('t-gate', { outcome: 'PASS', failingChecks: [] }) }) })] })).causes).toEqual([]);
  });
});

describe('§2.1 reduceGoalDisplay: seeded random fact combinations', () => {
  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }
  const pick = <T>(random: () => number, values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const VERDICTS: TaskAutomationVerdictV1[] = [
    { kind: 'none' }, REQUEUE, stopped('no_new_basis'), stopped('unknown_outcome'), stopped('task_paused', { pausedBy: 'human' }),
    { kind: 'claim_requeued', requeueRef: requeueRef('t-x'), budget: null },
  ];

  function randomFacts(random: () => number): GoalDisplayFactsV1 {
    const tasks: GoalDisplayTaskFactsV1[] = [];
    const runs = new Map<string, RunSnapshot[]>();
    const count = Math.floor(random() * 5);
    for (let index = 0; index < count; index += 1) {
      const taskId = `t-${index}`;
      const taskKind = pick(random, ['work', 'work', 'gate'] as const);
      const withFailure = random() < 0.6;
      tasks.push(task(taskId, {
        taskKind,
        requirementLevel: pick(random, ['required', 'required', 'optional'] as const),
        disposition: pick(random, ['active', 'active', 'active', 'deferred', 'cancelled'] as const),
        phase: pick(random, ['pending', 'ready', 'running', 'verifying', 'blocked', 'satisfied', 'failed'] as const),
        dispatchable: random() < 0.3,
        failure: withFailure ? failureOf(pick(random, VERDICTS), { requeueAutoCount: Math.floor(random() * 3),
          round: random() < 0.5 ? null : roundOf(taskId, { outcome: pick(random, ['PASS', 'FAIL', 'INCONCLUSIVE'] as const),
            status: pick(random, ['open', 'finalized'] as const), autoCount: Math.floor(random() * 2) }) }) : null,
        coveredTaskIds: taskKind === 'gate' ? ['t-0', 't-1'] : [],
      }));
      if (random() < 0.5) {
        runs.set(taskId, [runOf(`run-${taskId}`, taskId, pick(random, [
          { status: 'running', outcome: null, exitCode: null, endedAt: null },
          { outcome: 'failed' }, { outcome: 'outcome_unknown' }, { outcome: 'completed' },
        ] satisfies Partial<RunSnapshot>[]))]);
      }
    }
    return facts({
      desiredState: pick(random, ['active', 'active', 'paused', 'cancelled'] as const),
      activePlanRef: random() < 0.15 ? null : P1,
      completion: pick(random, [{ status: 'not_recorded' }, { status: 'recorded', selectedPlanMatches: true },
        { status: 'recorded', selectedPlanMatches: false }] as const),
      pendingProposal: random() < 0.3 ? { ref: PROPOSAL, basedOn: random() < 0.5 ? null : P1 } : null,
      tasks, runsByTaskId: runs,
    });
  }

  const ROW_PHASE: Record<string, string> = {
    'GOAL-17': 'CANCELLED', 'GOAL-18': 'COMPLETED', 'GOAL-19': 'ACCEPTED_PARTIAL', 'GOAL-20': 'PAUSED', 'GOAL-21': 'PLANNING',
    'GOAL-22': 'PLANNING', 'GOAL-23': 'NEEDS_DECISION', 'GOAL-30': 'NEEDS_DECISION', 'GOAL-24': 'FAILED', 'GOAL-25': 'BLOCKED',
    'GOAL-26': 'CHANGE_PENDING', 'GOAL-27': 'RUNNING',
  };

  it('2000 combinations: one deterministic headline that follows the priority order', () => {
    const random = lcg(20261004);
    for (let round = 0; round < 2000; round += 1) {
      const input = randomFacts(random);
      const display = reduceGoalDisplay(input);
      expect(reduceGoalDisplay(input)).toEqual(display);
      expect(GOAL_DISPLAY_PHASES).toContain(display.phase);
      expect(ROW_PHASE[display.row]).toBe(display.phase);
      expect(display.phase).not.toBe('ACCEPTED_PARTIAL');
      expect(display.runStops === null).toBe(input.desiredState === 'active');
      if (display.cause !== null) expect(display.causes).toContainEqual(display.cause);
      const matches = input.completion.status === 'recorded' && input.completion.selectedPlanMatches;
      const live = [...input.runsByTaskId.values()].flat().some((run) => run.status === 'running' || run.status === 'starting');
      const codes = new Set(display.causes.map((cause: GoalDisplayCauseV1) => cause.code));
      if (input.desiredState === 'cancelled') expect(display.phase).toBe('CANCELLED');
      else if (matches) expect(display.phase).toBe('COMPLETED');
      else if (input.desiredState === 'paused') expect(display.phase).toBe('PAUSED');
      else if (input.activePlanRef === null) expect(display.phase).toBe('PLANNING');
      else if (codes.has('unknown_outcome')) expect(display.row).toBe('GOAL-23');
      else {
        if (live) expect(['FAILED', 'BLOCKED']).not.toContain(display.phase);
        if (display.row === 'GOAL-24' || display.row === 'GOAL-25') expect(live).toBe(false);
        // A listed failure without a live Run is a FAILED headline unless GOAL-30 decided first.
        if (codes.has('task_failed') && !live) expect(['FAILED', 'NEEDS_DECISION']).toContain(display.phase);
        if (display.row === 'GOAL-30') expect(live).toBe(false);
      }
    }
  });
});
