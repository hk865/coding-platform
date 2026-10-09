/**
 * Slice 5 unit rows GS01..GS15
 * (docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md §5.2).
 *
 * Pure: no RecordStore, no clock, no ids. The part-1 state functions are
 * stubs, so every case currently fails with the stub's `not implemented`.
 * The assertions below are the frozen §5.2 expectations for part 2.
 */
import { describe, expect, it } from 'vitest';
import type { ModuleRef } from '../../src/contracts/core/identity.js';
import {
  DEFAULT_GOAL_SETTINGS_V1,
  type GoalDecisionBasisV1,
  type GoalFootprintV1,
  type GoalSettingsV1,
} from '../../src/contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { GoalPhaseSnapshot } from '../../src/contracts/goal-phase.js';
import { isAutomationActor, WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { decodeGoalSnapshot, encodeGoalSnapshot, readGoalSettings } from '../../src/core/work-graph/persistence/record-codecs.js';
import { buildGoalPhaseSnapshot, goalStateOf, nextGoalDesiredState, nextGoalPointer } from '../../src/core/work-graph/state/goal-machine.js';
import {
  goalConflictFacts,
  goalDecisionBasisMatches,
  goalStartPolicy,
  transitionGoalSettings,
  type GoalSettingsEffectV1,
  type GoalSettingsGuardV1,
} from '../../src/core/work-graph/state/goal-settings-machine.js';

// -------------------------------------------------------------------------- //
// §5.1 fixed fixture (P/W, Goals A/B/C, PA1/PB1, Goal@7, operator/automation, T)
// -------------------------------------------------------------------------- //

const PROJECT = 'P';
const WORKSPACE = 'W';
const WORKSPACE_REF: WorkspaceRef = { aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE };

const GOAL_REVISION = 7;
const OPERATOR = { kind: 'human', id: 'operator' } as const;
const AUTOMATION = WORKFLOW_AUTOMATION_ACTOR;
const T = '2026-10-08T00:00:00.000Z';

const goalRef = (goalId: string): GoalRef => ({ aggregateType: 'Goal', projectId: PROJECT, goalId });
const GOAL_A = goalRef('A');
const GOAL_B = goalRef('B');
const GOAL_ORDER = { A: 0, B: 1, C: 2 } as const;

const planRef = (planId: string): PlanRevisionRef => ({ aggregateType: 'PlanRevision', projectId: PROJECT, planId });
const PA1 = planRef('PA1');
const PA0 = planRef('PA0');
const PB1 = planRef('PB1');
const PB2 = planRef('PB2');

/** Module M maps the catalog path prefix `src/m/`; N maps `src/n/`. */
const M: ModuleRef = { projectId: PROJECT, moduleId: 'M' };
const FM = 'src/m/a.ts';
const FX = 'src/x/f.ts';

function settings(overrides: Partial<GoalSettingsV1> = {}): GoalSettingsV1 {
  return { ...DEFAULT_GOAL_SETTINGS_V1, ...overrides };
}

function goal(ref: GoalRef, overrides: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return {
    ref,
    workspaceRef: WORKSPACE_REF,
    objective: `objective of ${ref.goalId}`,
    desiredState: 'active',
    desiredStateRevision: 3,
    desiredStateRequestedBy: OPERATOR,
    activePlanRevision: ref.goalId === 'A' ? PA1 : PB1,
    revision: GOAL_REVISION,
    settings: settings({ order: ref.goalId === 'A' ? GOAL_ORDER.A : GOAL_ORDER.B }),
    ...overrides,
  };
}

function guardFacts(overrides: Partial<GoalSettingsGuardV1> = {}): GoalSettingsGuardV1 {
  return {
    operator: true,
    goalExists: true,
    desiredState: 'active',
    pinMatches: true,
    sameWorkspace: true,
    predecessorExists: false,
    waitingCycle: false,
    pairPlanPointersMatch: true,
    ...overrides,
  };
}

const SETTINGS_CHANGED: readonly GoalSettingsEffectV1[] = [{ type: 'goal_settings_changed' }];

/** B waits for A (the fixed conflict-pair fixture); B is order 1, A is order 0. */
const WAITING_B = goal(GOAL_B, { revision: GOAL_REVISION, settings: settings({ order: GOAL_ORDER.B, waitForGoalRef: GOAL_A }) });

function predecessor(overrides: Partial<{ exists: boolean; cancelled: boolean; formallyCompletedForActivePlan: boolean }> = {}) {
  return { exists: true, cancelled: false, formallyCompletedForActivePlan: false, ...overrides };
}

function predecessorOf(a: GoalSnapshot, phase: GoalPhaseSnapshot | null = null) {
  const state = goalStateOf(a, phase);
  return { exists: state.node !== 'absent', cancelled: state.node === 'cancelled',
    formallyCompletedForActivePlan: state.completion === 'for_active' };
}

function footprint(ref: GoalRef, overrides: Partial<GoalFootprintV1> = {}): GoalFootprintV1 {
  return {
    goalRef: ref,
    planRef: ref.goalId === 'A' ? PA1 : PB1,
    plannedModules: [],
    executedFiles: [],
    executedFilesAvailable: true,
    possiblyIncomplete: false,
    ...overrides,
  };
}

function basis(captured: GoalSnapshot): GoalDecisionBasisV1 {
  if (captured.settings === undefined) throw new Error('this fixture captures an explicitly configured Goal');
  return {
    goalRef: captured.ref,
    workspaceRef: captured.workspaceRef,
    objective: captured.objective,
    activePlanRef: captured.activePlanRevision,
    settings: structuredClone(captured.settings),
  };
}

// -------------------------------------------------------------------------- //
// GS01..GS05 — transitionGoalSettings / defaults                              //
// -------------------------------------------------------------------------- //

describe('S5 goal settings machine (§5.2 GS01..GS15)', () => {
  it('GS01 an absent settings field reads as the exact §2.2 default without a write', () => {
    const { settings: omitted, ...old } = goal(GOAL_A);
    const encoded = encodeGoalSnapshot(old);
    const originalJson = encoded.json;
    const decoded = decodeGoalSnapshot(encoded);
    expect(decoded).toEqual({ status: 'decoded', value: old });
    if (decoded.status !== 'decoded') throw new Error('legacy Goal must decode');
    const defaultSettings: GoalSettingsV1 = {
      schemaVersion: 1,
      autonomy: 'after_plan_confirmation',
      order: 0,
      waitForGoalRef: null,
      parallelRisks: [],
    };
    expect(readGoalSettings(decoded.value)).toEqual(defaultSettings);
    expect(decoded.value).toEqual(old);
    expect(decoded.value).not.toHaveProperty('settings');
    expect(encodeGoalSnapshot(decoded.value).json).toBe(originalJson);
  });

  it('GS02 settings_set on active B@7 bumps to @8 without moving desiredStateRevision or the active plan', () => {
    const state = goal(GOAL_B, { revision: GOAL_REVISION, desiredStateRevision: 3, activePlanRevision: PB1, settings: settings({ order: GOAL_ORDER.B }) });
    const before = structuredClone(state);
    const everyStep = settings({ autonomy: 'every_step', order: GOAL_ORDER.B });
    const result = transitionGoalSettings(state, { type: 'settings_set', settings: everyStep }, guardFacts());
    expect(result).toEqual({ ok: true, next: { ...before, revision: 8, settings: everyStep }, effects: SETTINGS_CHANGED });
    expect(state).toEqual(before);
  });

  it('GS03 settings_set on paused B@7 bumps to @8 and stays paused', () => {
    const state = goal(GOAL_B, { revision: GOAL_REVISION, desiredState: 'paused', settings: settings({ order: GOAL_ORDER.B }) });
    const before = structuredClone(state);
    const everyStep = settings({ autonomy: 'every_step', order: GOAL_ORDER.B });
    const result = transitionGoalSettings(state, { type: 'settings_set', settings: everyStep }, guardFacts({ desiredState: 'paused' }));
    expect(result).toEqual({ ok: true, next: { ...before, revision: 8, settings: everyStep }, effects: SETTINGS_CHANGED });
    expect(state).toEqual(before);
  });

  it('GS04 a cancelled Goal refuses any settings write with invalid and no next/effects', () => {
    const state = goal(GOAL_B, { desiredState: 'cancelled', settings: settings({ order: 1 }) });
    const before = structuredClone(state);
    const result = transitionGoalSettings(
      state, { type: 'settings_set', settings: settings({ autonomy: 'every_step', order: 1 }) }, guardFacts({ desiredState: 'cancelled' }),
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    expect('next' in result).toBe(false);
    expect('effects' in result).toBe(false);
    expect(state).toEqual(before);
  });

  it('GS05 an automation actor is not the configured operator and is forbidden', () => {
    expect(isAutomationActor(AUTOMATION)).toBe(true);
    const state = goal(GOAL_B, { settings: settings({ order: GOAL_ORDER.B }) });
    const before = structuredClone(state);
    const result = transitionGoalSettings(
      state, { type: 'settings_set', settings: settings({ autonomy: 'every_step', order: 1 }) },
      guardFacts({ operator: !isAutomationActor(AUTOMATION) }),
    );
    expect(result).toMatchObject({ ok: false, reason: 'guard_failed', code: 'forbidden' });
    expect(result).not.toHaveProperty('next');
    expect(result).not.toHaveProperty('effects');
    expect(state).toEqual(before);
  });

  // ------------------------------------------------------------------------ //
  // GS06..GS10 — goalStartPolicy (GS09 also the wait-cycle refusal)           //
  // ------------------------------------------------------------------------ //

  it('GS06 wait_selected B->A then reorder B/A keeps waitForGoalRef=A and blocks claim', () => {
    // Choosing A fixes the wait object; moving B ahead of A must not move it.
    const b = goal(GOAL_B);
    const selected = transitionGoalSettings(
      b,
      { type: 'wait_selected', predecessor: GOAL_A },
      guardFacts({ predecessorExists: true }),
    );
    expect(selected).toEqual({ ok: true,
      next: { ...b, revision: 8, settings: settings({ order: 1, waitForGoalRef: GOAL_A }) }, effects: SETTINGS_CHANGED });
    if (!selected.ok) throw new Error('wait selection must succeed');
    const reordered = transitionGoalSettings(selected.next, { type: 'order_set', order: 0 }, guardFacts());
    expect(reordered).toEqual({ ok: true,
      next: { ...b, revision: 9, settings: settings({ order: 0, waitForGoalRef: GOAL_A }) }, effects: SETTINGS_CHANGED });
    if (!reordered.ok) throw new Error('reordering B must succeed');
    const a = goal(GOAL_A);
    expect(transitionGoalSettings(a, { type: 'order_set', order: 1 }, guardFacts()))
      .toEqual({ ok: true, next: { ...a, revision: 8, settings: settings({ order: 1 }) }, effects: SETTINGS_CHANGED });
    expect(goalStartPolicy({ action: 'claim', goal: reordered.next, predecessor: predecessor() }))
      .toEqual({ allowed: false, reason: 'waiting_predecessor' });
  });

  it('GS07 a cancelled predecessor unblocks claim', () => {
    const cancelled = nextGoalDesiredState(goal(GOAL_A), { to: 'cancelled', requestedBy: OPERATOR });
    expect(cancelled).toMatchObject({ ref: GOAL_A, revision: 8, desiredStateRevision: 8,
      desiredState: 'cancelled', activePlanRevision: PA1 });
    expect(goalStartPolicy({ action: 'claim', goal: WAITING_B, predecessor: predecessorOf(cancelled) }))
      .toEqual({ allowed: true, reason: null });
  });

  it('GS08 enter is allowed only when the predecessor completed for the active plan', () => {
    const a = goal(GOAL_A);
    const completed = (plan: PlanRevisionRef) => buildGoalPhaseSnapshot({
      ref: { aggregateType: 'GoalPhase', projectId: PROJECT, goalId: 'A' }, previousRevision: null,
      planRef: plan, planRevision: 1, adoptedTaskReductions: [], satisfiedObligationIds: [], reducedAt: T,
    });
    const current = completed(PA1);
    const old = completed(PA0);
    expect(current).toMatchObject({ revision: 1, phase: 'COMPLETED', planRef: PA1 });
    expect(old).toMatchObject({ revision: 1, phase: 'COMPLETED', planRef: PA0 });
    expect(goalStartPolicy({ action: 'enter', goal: WAITING_B, predecessor: predecessorOf(a, current) }))
      .toEqual({ allowed: true, reason: null });
    expect(goalStartPolicy({ action: 'enter', goal: WAITING_B, predecessor: predecessorOf(a, old) }))
      .toEqual({ allowed: false, reason: 'waiting_predecessor' });
  });

  it('GS09 a mutual wait cycle is refused and B keeps its settings', () => {
    const a = goal(GOAL_A);
    const selected = transitionGoalSettings(a, { type: 'settings_set', settings: settings({ waitForGoalRef: GOAL_B }) },
      guardFacts({ predecessorExists: true }));
    expect(selected).toEqual({ ok: true,
      next: { ...a, revision: 8, settings: settings({ order: 0, waitForGoalRef: GOAL_B }) }, effects: SETTINGS_CHANGED });
    if (!selected.ok) throw new Error('A waiting for B must be established first');
    const b = goal(GOAL_B);
    const before = structuredClone(b);
    const result = transitionGoalSettings(
      b, { type: 'wait_selected', predecessor: GOAL_A },
      guardFacts({ predecessorExists: true, waitingCycle: selected.next.settings?.waitForGoalRef?.goalId === GOAL_B.goalId }),
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    expect(result).not.toHaveProperty('next');
    expect(result).not.toHaveProperty('effects');
    expect(b).toEqual(before);
  });

  it('GS10 a waiting Goal permits readonly_query but blocks dispatch_action', () => {
    expect(goalStartPolicy({ action: 'readonly_query', goal: WAITING_B, predecessor: predecessor() }))
      .toEqual({ allowed: true, reason: null });
    expect(goalStartPolicy({ action: 'dispatch_action', goal: WAITING_B, predecessor: predecessor() }))
      .toEqual({ allowed: false, reason: 'waiting_predecessor' });
  });

  // ------------------------------------------------------------------------ //
  // GS11..GS13 — goalConflictFacts                                            //
  // ------------------------------------------------------------------------ //

  it('GS11 a planned module M overlaps with an executed file attributed to M', () => {
    const a = footprint(GOAL_A, { planRef: PA1, plannedModules: [M] });
    const b = footprint(GOAL_B, { executedFiles: [{ path: FM, moduleRef: M, certainty: 'definite' }] });
    expect(goalConflictFacts(a, b)).toEqual({ overlaps: true, moduleRefs: [M], filePaths: [], possiblyIncomplete: false });
  });

  it('GS12 the same file path with no attributed module still overlaps on the file path', () => {
    const a = footprint(GOAL_A, { executedFiles: [{ path: FX, moduleRef: null, certainty: 'definite' }] });
    const b = footprint(GOAL_B, { executedFiles: [{ path: FX, moduleRef: null, certainty: 'definite' }] });
    expect(goalConflictFacts(a, b)).toEqual({ overlaps: true, moduleRefs: [], filePaths: [FX], possiblyIncomplete: false });
  });

  it('GS13 an unattributed file against another Goal planned module is incomplete, not an overlap', () => {
    const a = footprint(GOAL_A, { planRef: PA1, plannedModules: [M] });
    const b = footprint(GOAL_B, { executedFiles: [{ path: FX, moduleRef: null, certainty: 'possible' }] });
    expect(goalConflictFacts(a, b)).toEqual({ overlaps: false, moduleRefs: [], filePaths: [], possiblyIncomplete: true });
  });

  // ------------------------------------------------------------------------ //
  // GS14..GS15 — goalDecisionBasisMatches / the settings migration            //
  // ------------------------------------------------------------------------ //

  it('GS14 a captured B@7 basis matches active B@9 when only control fields moved; migration before B@9', () => {
    const captured = goal(GOAL_B);
    const paused = nextGoalDesiredState(captured, { to: 'paused', requestedBy: OPERATOR });
    const current = nextGoalDesiredState(paused, { to: 'active', requestedBy: OPERATOR });
    const matches = goalDecisionBasisMatches(basis(captured), current);
    expect(matches).toBe(true);
    expect(paused).toEqual({ ...captured, revision: 8, desiredState: 'paused', desiredStateRevision: 8 });
    expect(current).toEqual({ ...captured, revision: 9, desiredStateRevision: 9 });
    const before = structuredClone(current);
    const nextSettings = settings({ order: 1, autonomy: 'every_step' });
    const result = transitionGoalSettings(current, { type: 'settings_set', settings: nextSettings },
      guardFacts({ pinMatches: matches }));
    expect(result).toEqual({ ok: true,
      next: { ...captured, revision: 10, desiredStateRevision: 9, settings: nextSettings }, effects: SETTINGS_CHANGED });
    expect(current).toEqual(before);
  });

  it('GS15 a changed active Plan breaks the captured basis and the migration is revision_conflict', () => {
    const captured = goal(GOAL_B, { desiredState: 'paused', desiredStateRevision: 7 });
    const adopted = nextGoalPointer(captured, PB2);
    const current = nextGoalDesiredState(adopted, { to: 'active', requestedBy: OPERATOR });
    const matches = goalDecisionBasisMatches(basis(captured), current);
    expect(matches).toBe(false);
    expect(current).toEqual({ ...captured, revision: 9, desiredState: 'active', desiredStateRevision: 9, activePlanRevision: PB2 });
    // The content basis no longer matches, so the owner cannot relocate the captured
    // pin to B@9: the CAS stays on the stale pin and the migration is refused.
    const result = transitionGoalSettings(
      current, { type: 'settings_set', settings: settings({ order: 1, autonomy: 'every_step' }) }, guardFacts({ pinMatches: matches }),
    );
    expect(result).toMatchObject({ ok: false, reason: 'stale', code: 'revision_conflict' });
    expect('next' in result).toBe(false);
    expect('effects' in result).toBe(false);
  });
});
