/**
 * Goal-settings state machine and the pure Goal policy helpers
 * (docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md §3.1,
 * rows S5-GS-01..06, and the §3.2 start admission of S5-AU-01/02).
 *
 * Pure: the owner service (`tasks/goal-settings-service.ts`) reads the current
 * Goal, the predecessor Goal/GoalPhase and the ordered workspace Goal set into
 * `GoalSettingsGuardV1`, calls `transitionGoalSettings`, then writes `next`
 * plus its `GoalSettingsChanged` event in ONE RecordStore commit. `order_set`
 * applies `order` as the array index of the ordered Goal set, so this machine
 * never re-derives the list. A `cancelled` Goal is a terminal refusal (S5-GS-05).
 *
 * This directory may not import `model` or `record-store` (§14.4): every shape
 * below is built from `src/contracts`; `Transition` comes from `./transition.js`.
 */
import {
  type GoalConflictFactsV1,
  type GoalDecisionBasisV1,
  type GoalFootprintV1,
  type GoalParallelRiskV1,
  type GoalSettingsV1,
} from '../../../contracts/goal-decisions.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalDesiredState, GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import { accept, reject, unreachable, type Rejected, type Transition } from './transition.js';

// --------------------------------------------------------------------------
// Machine state, events, guard context, effects (spec §3.1)
// --------------------------------------------------------------------------

/** `settings_set` writes the complete settings; the three single-field rows write one field. */
export type GoalSettingsEventV1 =
  | { type: 'settings_set'; settings: GoalSettingsV1 }
  | { type: 'order_set'; order: number }
  | { type: 'wait_selected'; predecessor: GoalRef }
  | { type: 'risk_accepted'; risk: GoalParallelRiskV1 };

/**
 * The facts the owner read and authorized. `goalExists` is the source-read
 * verdict (a read failure is the service's, never `exists=false`); `pinMatches`
 * is the caller's Goal pin against the version read in this call.
 */
export type GoalSettingsGuardV1 = {
  operator: boolean; goalExists: boolean;
  desiredState: GoalDesiredState; pinMatches: boolean;
  sameWorkspace: boolean; predecessorExists: boolean;
  waitingCycle: boolean; pairPlanPointersMatch: boolean;
};

/** The one effect the owner translates into `GoalSettingsChanged`. */
export type GoalSettingsEffectV1 = { type: 'goal_settings_changed' };

/** The Goal-start admission vocabulary of S5-AU-01/02. */
export type GoalStartActionV1 =
  | 'claim' | 'enter' | 'continue_work' | 'small_task' | 'dispatch_action'
  | 'readonly_query' | 'propose_plan' | 'continue_existing';

const SETTINGS_CHANGED: readonly GoalSettingsEffectV1[] = [{ type: 'goal_settings_changed' }];

/**
 * S5-AU-01: the actions that start changing work for this Goal. The remaining
 * actions (`readonly_query`, `propose_plan`, `continue_existing`) are the
 * read-only / already-running paths of S5-AU-02 and never wait.
 */
const BLOCKING_START_ACTIONS: ReadonlySet<GoalStartActionV1> = new Set<GoalStartActionV1>(
  ['claim', 'enter', 'continue_work', 'small_task', 'dispatch_action'],
);

// --------------------------------------------------------------------------
// Pure comparison helpers
// --------------------------------------------------------------------------

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Key-order-free equality by canonical JSON; a value it cannot encode throws, unlike the canonical `sameJson`. */
function sameJsonOrThrow(left: unknown, right: unknown): boolean {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
}

function samePlanPointer(left: PlanRevisionRef | null, right: PlanRevisionRef | null): boolean {
  return left === null || right === null ? left === right : sameJsonOrThrow(left, right);
}

/** The saved settings as an owned (mutable) copy. */
function settingsOf(state: GoalSnapshot): GoalSettingsV1 {
  const base = state.settings;
  return {
    schemaVersion: 1,
    autonomy: base.autonomy,
    order: base.order,
    waitForGoalRef: base.waitForGoalRef,
    parallelRisks: base.parallelRisks.map((risk) => ({ ...risk })),
  };
}

/** §2.8: normalize and sort `parallelRisks` by otherGoal key so only content is compared. */
function comparableSettings(settings: GoalSettingsV1): GoalSettingsV1 {
  return {
    ...settings,
    parallelRisks: [...settings.parallelRisks].sort((left, right) =>
      compareText(canonicalJson(left.otherGoalRef as JsonValue), canonicalJson(right.otherGoalRef as JsonValue))),
  };
}

function isLegalOrder(order: number): boolean {
  return Number.isSafeInteger(order) && order >= 0;
}

/** §2.2: a complete `GoalRef`, or any non-`Goal`/incomplete value is illegal. */
function isGoalRef(value: unknown): value is GoalRef {
  if (typeof value !== 'object' || value === null) return false;
  const ref = value as Record<string, unknown>;
  return ref['aggregateType'] === 'Goal'
    && typeof ref['projectId'] === 'string' && ref['projectId'].length > 0
    && typeof ref['goalId'] === 'string' && ref['goalId'].length > 0;
}

/** §2.2: a complete `PlanRevisionRef`, or any non-`PlanRevision`/incomplete value is illegal. */
function isPlanRevisionRef(value: unknown): value is PlanRevisionRef {
  if (typeof value !== 'object' || value === null) return false;
  const ref = value as Record<string, unknown>;
  return ref['aggregateType'] === 'PlanRevision'
    && typeof ref['projectId'] === 'string' && ref['projectId'].length > 0
    && typeof ref['planId'] === 'string' && ref['planId'].length > 0;
}

/** §2.2 `GoalParallelRiskV1`: complete other Goal plus `null`/complete Plan pointers. */
function isLegalParallelRisk(risk: unknown): risk is GoalParallelRiskV1 {
  if (typeof risk !== 'object' || risk === null) return false;
  const entry = risk as Record<string, unknown>;
  if (!isGoalRef(entry['otherGoalRef'])) return false;
  if (entry['selfPlanRef'] !== null && !isPlanRevisionRef(entry['selfPlanRef'])) return false;
  if (entry['otherPlanRef'] !== null && !isPlanRevisionRef(entry['otherPlanRef'])) return false;
  return true;
}

/** S5-GS-01 `settings 形状` (§2.2): enum/order and every complete ref must be legal. */
export function isLegalSettings(settings: unknown): boolean {
  if (typeof settings !== 'object' || settings === null) return false;
  const value = settings as GoalSettingsV1;
  if (value.schemaVersion !== 1) return false;
  if (value.autonomy !== 'every_step' && value.autonomy !== 'after_plan_confirmation') return false;
  if (!isLegalOrder(value.order)) return false;
  if (value.waitForGoalRef !== null && !isGoalRef(value.waitForGoalRef)) return false;
  if (!Array.isArray(value.parallelRisks)) return false;
  return value.parallelRisks.every((risk) => isLegalParallelRisk(risk));
}

// --------------------------------------------------------------------------
// Refusals
// --------------------------------------------------------------------------

function forbidden(detail: string): Rejected {
  return reject('guard_failed', 'forbidden', detail);
}

function invalid(detail: string): Rejected {
  return reject('guard_failed', 'invalid', detail);
}

function stale(detail: string): Rejected {
  return reject('stale', 'revision_conflict', detail);
}

/**
 * The checks every Goal-settings row shares, in the table's refusal order:
 * `operator=false → forbidden`, missing Goal → `not_found`, cancelled → terminal
 * `invalid`, a stale pin → `revision_conflict`, another workspace → `invalid`.
 */
function sharedProblem(state: GoalSnapshot, facts: GoalSettingsGuardV1): Rejected | null {
  if (!facts.operator) return forbidden('only the configured operator may change Goal settings');
  if (!facts.goalExists) return reject('illegal', 'not_found', 'the requested Goal does not exist');
  if (facts.desiredState === 'cancelled' || state.desiredState === 'cancelled') {
    return reject('illegal', 'invalid', 'a cancelled Goal can no longer change its settings');
  }
  if (!facts.pinMatches) return stale('the Goal revision changed since it was read');
  if (!facts.sameWorkspace) return invalid('the Goal does not belong to the requested workspace');
  return null;
}

// --------------------------------------------------------------------------
// Transitions and constructors (spec §3.1)
// --------------------------------------------------------------------------

/** S5-GS-01..06: the Goal-settings transition, one row per event (spec §3.1 table). */
export function transitionGoalSettings(
  state: GoalSnapshot, event: GoalSettingsEventV1, facts: GoalSettingsGuardV1,
): Transition<GoalSnapshot, GoalSettingsEventV1, GoalSettingsEffectV1> {
  const shared = sharedProblem(state, facts);
  if (shared !== null) return shared;
  switch (event.type) {
    case 'settings_set': {
      if (!isLegalSettings(event.settings)) return invalid('the Goal settings shape is invalid');
      const wait = event.settings.waitForGoalRef;
      if (wait !== null && sameJsonOrThrow(wait, state.ref)) return invalid('a Goal cannot wait for itself');
      if (wait !== null) {
        if (!facts.predecessorExists) return reject('illegal', 'not_found', 'the selected predecessor Goal does not exist');
        if (facts.waitingCycle) return invalid('the selected wait would form a cycle');
      }
      return accept(buildGoalSettingsRecord(state, event.settings), SETTINGS_CHANGED);
    }
    case 'order_set': {
      if (!isLegalOrder(event.order)) return invalid('the Goal order must be a non-negative safe integer');
      return accept(buildGoalSettingsRecord(state, { ...settingsOf(state), order: event.order }), SETTINGS_CHANGED);
    }
    case 'wait_selected': {
      if (sameJsonOrThrow(event.predecessor, state.ref)) return invalid('a Goal cannot wait for itself');
      if (!facts.predecessorExists) return reject('illegal', 'not_found', 'the selected predecessor Goal does not exist');
      if (facts.waitingCycle) return invalid('the selected wait would form a cycle');
      if (!facts.pairPlanPointersMatch) return stale('the conflict pair plan pointers changed since they were read');
      return accept(buildGoalSettingsRecord(state, { ...settingsOf(state), waitForGoalRef: event.predecessor }),
        SETTINGS_CHANGED);
    }
    case 'risk_accepted': {
      if (sameJsonOrThrow(event.risk.otherGoalRef, state.ref)) return invalid('a Goal cannot accept a parallel risk with itself');
      if (!facts.predecessorExists) return reject('illegal', 'not_found', 'the other Goal of the conflict pair does not exist');
      if (!facts.pairPlanPointersMatch) return stale('the conflict pair plan pointers changed since they were read');
      const settings = settingsOf(state);
      const risks = settings.parallelRisks.filter((risk) => !sameJsonOrThrow(risk.otherGoalRef, event.risk.otherGoalRef));
      risks.push(event.risk);
      return accept(buildGoalSettingsRecord(state, { ...settings, parallelRisks: risks }), SETTINGS_CHANGED);
    }
    default:
      return unreachable(event, 'goal settings event');
  }
}

/** Writes only `settings` and `revision + 1`; every other field is carried verbatim (spec §3.1). */
export function buildGoalSettingsRecord(goal: GoalSnapshot, settings: GoalSettingsV1): GoalSnapshot {
  return { ...goal, revision: goal.revision + 1, settings };
}

/** S5-AU-01/02: whether a new modifying action may start for this Goal (read-only predicate). */
export function goalStartPolicy(input: {
  action: GoalStartActionV1; goal: GoalSnapshot;
  predecessor: null | { exists: boolean; cancelled: boolean;
    formallyCompletedForActivePlan: boolean };
}): { allowed: boolean; reason: 'goal_stopped' | 'waiting_predecessor' | null } {
  if (!BLOCKING_START_ACTIONS.has(input.action)) return { allowed: true, reason: null };
  if (input.goal.desiredState !== 'active') return { allowed: false, reason: 'goal_stopped' };
  const waiting = input.goal.settings.waitForGoalRef;
  if (waiting === null) return { allowed: true, reason: null };
  const predecessor = input.predecessor;
  if (predecessor === null || !predecessor.exists) return { allowed: false, reason: 'waiting_predecessor' };
  if (predecessor.cancelled || predecessor.formallyCompletedForActivePlan) {
    return { allowed: true, reason: null };
  }
  return { allowed: false, reason: 'waiting_predecessor' };
}

/** S5-GS-06/§2.8: the captured answer basis still equals the current Goal control content. */
export function goalDecisionBasisMatches(basis: GoalDecisionBasisV1, current: GoalSnapshot): boolean {
  if (!sameJsonOrThrow(basis.goalRef, current.ref)) return false;
  if (!sameJsonOrThrow(basis.workspaceRef, current.workspaceRef)) return false;
  if (basis.objective !== current.objective) return false;
  if (!samePlanPointer(basis.activePlanRef, current.activePlanRevision)) return false;
  const captured = comparableSettings(basis.settings);
  const actual = comparableSettings(current.settings);
  return sameJsonOrThrow(captured, actual);
}

/** §2.8: the overlap facts of two Goal footprints, pure and order-independent. */
export function goalConflictFacts(a: GoalFootprintV1, b: GoalFootprintV1): GoalConflictFactsV1 {
  const moduleSet = (footprint: GoalFootprintV1): Map<string, GoalFootprintV1['plannedModules'][number]> => {
    const modules = new Map<string, GoalFootprintV1['plannedModules'][number]>();
    for (const moduleRef of footprint.plannedModules) modules.set(canonicalJson(moduleRef as JsonValue), moduleRef);
    for (const file of footprint.executedFiles) {
      if (file.moduleRef !== null) modules.set(canonicalJson(file.moduleRef as JsonValue), file.moduleRef);
    }
    return modules;
  };
  const fileSet = (footprint: GoalFootprintV1): Set<string> =>
    new Set(footprint.executedFiles.map((file) => file.path));
  const modulesA = moduleSet(a);
  const modulesB = moduleSet(b);
  const moduleRefs = [...modulesA.entries()]
    .filter(([key]) => modulesB.has(key))
    .map(([, moduleRef]) => moduleRef)
    .sort((left, right) => compareText(canonicalJson(left as JsonValue), canonicalJson(right as JsonValue)));
  const filesA = fileSet(a);
  const filesB = fileSet(b);
  const filePaths = [...filesA].filter((path) => filesB.has(path)).sort(compareText);
  const hasUnattributed = (footprint: GoalFootprintV1): boolean =>
    footprint.executedFiles.some((file) => file.moduleRef === null);
  const hasModuleExpectation = (footprint: GoalFootprintV1): boolean =>
    footprint.plannedModules.length > 0 || footprint.executedFiles.some((file) => file.moduleRef !== null);
  const possiblyIncomplete = a.possiblyIncomplete || b.possiblyIncomplete
    || !a.executedFilesAvailable || !b.executedFilesAvailable
    || (hasUnattributed(a) && hasModuleExpectation(b))
    || (hasUnattributed(b) && hasModuleExpectation(a));
  return {
    overlaps: moduleRefs.length > 0 || filePaths.length > 0,
    moduleRefs,
    filePaths,
    possiblyIncomplete,
  };
}
