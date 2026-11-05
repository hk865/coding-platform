/**
 * E38-R5, E38-R6, E38-R8 (E3-8 spec §3.5, §4): the one overlap rule with planned files, in its three pure places.
 *
 * - R5 `plannedFootprintOf`: a work task without a list gives its module (the module claim); a work task with a list
 *   gives its files, each carrying the task's own module (null when the scope is not a module); cancelled and
 *   superseded tasks count for nothing, deferred ones still count; a gate gives nothing.
 * - R6 `goalConflictFacts`: a module claim meets the other side's modules (its claims, its listed tasks' modules,
 *   its executed files' modules); files (planned + executed) meet only on the same path.
 * - R8 `moduleOverlapOf`: same module and running, unless both tasks list files and the lists share no path.
 *
 * Pure A5: every task, footprint and fact is written out here and every expectation is hand-computed from the spec;
 * no store, platform, Host, Workflow or Runtime is imported.
 */
import { describe, expect, it } from 'vitest';
import type { ModuleRef } from '../../src/contracts/core/identity.js';
import type { GoalConflictFactsV1, GoalFootprintV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef, RuntimeTask, TaskScope } from '../../src/contracts/plan.js';
import { plannedFootprintOf } from '../../src/core/work-graph/model/architecture-footprint.js';
import { goalConflictFacts } from '../../src/core/work-graph/state/goal-settings-machine.js';
import {
  moduleOverlapOf, type ModuleOverlapFactsV1, type ModuleOverlapV1,
} from '../../src/core/work-graph/tasks/overlap-gates.js';

const M: ModuleRef = { projectId: 'p', moduleId: 'm' };
const N: ModuleRef = { projectId: 'p', moduleId: 'n' };

// -------------------------------------------------------------------------- //
// E38-R5 plannedFootprintOf                                                   //
// -------------------------------------------------------------------------- //

const ON_M: TaskScope = { kind: 'module', stageId: 's', moduleRef: 'm' };
const ON_STAGE: TaskScope = { kind: 'stage', stageId: 's' };

function task(taskId: string, scope: TaskScope, extra: Partial<RuntimeTask> = {}): RuntimeTask {
  return {
    taskId, title: `E38 ${taskId}`, requirementLevel: 'required', taskKind: 'work',
    disposition: 'active', phase: 'pending', scope, ...extra,
  };
}

type PlannedFootprint = Pick<GoalFootprintV1, 'plannedModules' | 'plannedFiles'>;

describe('E38-R5 plannedFootprintOf', () => {
  it.each<[string, RuntimeTask[], PlannedFootprint]>([
    ['a module task with a list', [task('t1', ON_M, { plannedFiles: ['src/m/a.ts', 'src/m/b.ts'] })],
      { plannedModules: [], plannedFiles: [{ path: 'src/m/a.ts', taskModule: M }, { path: 'src/m/b.ts', taskModule: M }] }],
    ['a module task without a list', [task('t1', ON_M)], { plannedModules: [M], plannedFiles: [] }],
    ['a stage task with a list', [task('t1', ON_STAGE, { plannedFiles: ['src/x.ts'] })],
      { plannedModules: [], plannedFiles: [{ path: 'src/x.ts', taskModule: null }] }],
    ['a stage task without a list', [task('t1', ON_STAGE)], { plannedModules: [], plannedFiles: [] }],
    ['a cancelled and a superseded task', [
      task('t1', ON_M, { disposition: 'cancelled', plannedFiles: ['src/m/a.ts'] }),
      task('t2', ON_M, { disposition: 'superseded', plannedFiles: ['src/m/b.ts'] }),
    ], { plannedModules: [], plannedFiles: [] }],
    ['a deferred task', [task('t1', ON_M, { disposition: 'deferred', plannedFiles: ['src/m/a.ts'] })],
      { plannedModules: [], plannedFiles: [{ path: 'src/m/a.ts', taskModule: M }] }],
    ['a gate', [task('t1', ON_M, { taskKind: 'gate' })], { plannedModules: [], plannedFiles: [] }],
  ])('E38-R5 %s', (_name, tasks, expected) => {
    /*
     * Named mutation: a task with a list also gives its module (the first row's plannedModules becomes [M]).
     * Per row, its own branch removed (no files from a list, no null module off a module scope, the disposition
     * filter, the gate skip).
     */
    expect(plannedFootprintOf(tasks, 'p')).toEqual(expected);
  });
});

// -------------------------------------------------------------------------- //
// E38-R6 goalConflictFacts                                                    //
// -------------------------------------------------------------------------- //

const goalRef = (goalId: string): GoalRef => ({ aggregateType: 'Goal', projectId: 'p', goalId });
const planRef = (planId: string): PlanRevisionRef => ({ aggregateType: 'PlanRevision', projectId: 'p', planId });
const GOAL_A = goalRef('A');
const GOAL_B = goalRef('B');

function footprint(ref: GoalRef, overrides: Partial<GoalFootprintV1> = {}): GoalFootprintV1 {
  return {
    goalRef: ref,
    planRef: ref.goalId === 'A' ? planRef('PA') : planRef('PB'),
    plannedModules: [],
    plannedFiles: [],
    executedFiles: [],
    executedFilesAvailable: true,
    possiblyIncomplete: false,
    ...overrides,
  };
}

const planned = (path: string, taskModule: ModuleRef | null): Partial<GoalFootprintV1> =>
  ({ plannedFiles: [{ path, taskModule }] });
const executed = (path: string, moduleRef: ModuleRef): Partial<GoalFootprintV1> =>
  ({ executedFiles: [{ path, moduleRef, certainty: 'definite' }] });
const claims = (moduleRef: ModuleRef): Partial<GoalFootprintV1> => ({ plannedModules: [moduleRef] });
const facts = (overlaps: boolean, moduleRefs: ModuleRef[], filePaths: string[]): GoalConflictFactsV1 =>
  ({ overlaps, moduleRefs, filePaths, possiblyIncomplete: false });

describe('E38-R6 goalConflictFacts', () => {
  it.each<[string, Partial<GoalFootprintV1>, Partial<GoalFootprintV1>, GoalConflictFactsV1]>([
    ['one module, two different planned files', planned('src/m/a.ts', M), planned('src/m/b.ts', M), facts(false, [], [])],
    ['the same planned file', planned('src/m/a.ts', M), planned('src/m/a.ts', M), facts(true, [], ['src/m/a.ts'])],
    ['a module claim meets a listed task\'s module', claims(M), planned('src/m/b.ts', M), facts(true, [M], [])],
    ['the same, A and B swapped', planned('src/m/b.ts', M), claims(M), facts(true, [M], [])],
    ['a list meets an executed file on another path', planned('src/m/a.ts', M), executed('src/m/b.ts', M),
      facts(false, [], [])],
    ['a list meets an executed file on the same path', planned('src/m/a.ts', M), executed('src/m/a.ts', M),
      facts(true, [], ['src/m/a.ts'])],
    ['executed files only, one module, two paths', executed('src/m/a.ts', M), executed('src/m/b.ts', M),
      facts(false, [], [])],
    ['a stage task\'s list meets another module\'s list', planned('src/x.ts', null), planned('src/x.ts', N),
      facts(true, [], ['src/x.ts'])],
    ['a module claim does not meet another module\'s list', claims(M), planned('src/n/z.ts', N), facts(false, [], [])],
  ])('E38-R6 %s', (_name, a, b, expected) => {
    /*
     * Named mutation: planned files also count as module claims (the first row becomes true, [M], …).
     * Per row, its own meeting removed (planned paths in the file set, a claim against the listed task's module).
     */
    expect(goalConflictFacts(footprint(GOAL_A, a), footprint(GOAL_B, b))).toEqual(expected);
  });
});

// -------------------------------------------------------------------------- //
// E38-R8 moduleOverlapOf                                                      //
// -------------------------------------------------------------------------- //

const W = { projectId: 'p', goalId: 'g', taskId: 'w' };
const R1 = { projectId: 'p', goalId: 'g', taskId: 'r1' };
const R2 = { projectId: 'p', goalId: 'g', taskId: 'r2' };

describe('E38-R8 moduleOverlapOf with planned files', () => {
  it.each<[string, ModuleOverlapFactsV1, ModuleOverlapV1]>([
    ['disjoint lists', {
      waiting: { task: W, moduleId: 'm', effectivePhase: 'running', plannedFiles: ['src/a.ts'] },
      others: [{ task: R1, moduleId: 'm', effectivePhase: 'running', plannedFiles: ['src/b.ts'] }],
    }, { overlaps: false }],
    ['lists sharing a path', {
      waiting: { task: W, moduleId: 'm', effectivePhase: 'running', plannedFiles: ['src/a.ts'] },
      others: [{ task: R1, moduleId: 'm', effectivePhase: 'running', plannedFiles: ['src/a.ts', 'src/c.ts'] }],
    }, { overlaps: true, moduleId: 'm', running: [R1] }],
    ['the running task has no list', {
      waiting: { task: W, moduleId: 'm', effectivePhase: 'running', plannedFiles: ['src/a.ts'] },
      others: [{ task: R1, moduleId: 'm', effectivePhase: 'running' }],
    }, { overlaps: true, moduleId: 'm', running: [R1] }],
    ['the waiting task has no list', {
      waiting: { task: W, moduleId: 'm', effectivePhase: 'running' },
      others: [{ task: R1, moduleId: 'm', effectivePhase: 'running', plannedFiles: ['src/b.ts'] }],
    }, { overlaps: true, moduleId: 'm', running: [R1] }],
    ['another module, the same file', {
      waiting: { task: W, moduleId: 'm', effectivePhase: 'running', plannedFiles: ['src/a.ts'] },
      others: [{ task: R1, moduleId: 'n', effectivePhase: 'running', plannedFiles: ['src/a.ts'] }],
    }, { overlaps: false }],
    ['two running tasks, only one sharing a path', {
      waiting: { task: W, moduleId: 'm', effectivePhase: 'running', plannedFiles: ['src/a.ts'] },
      others: [
        { task: R1, moduleId: 'm', effectivePhase: 'running', plannedFiles: ['src/a.ts'] },
        { task: R2, moduleId: 'm', effectivePhase: 'running', plannedFiles: ['src/b.ts'] },
      ],
    }, { overlaps: true, moduleId: 'm', running: [R1] }],
  ])('E38-R8 %s', (_name, input, expected) => {
    /*
     * Named mutation: drop the "lists share a path" half (the first and the last rows go red).
     * Per row, its own branch removed (a missing list on either side keeps the module overlap).
     */
    expect(moduleOverlapOf(input)).toEqual(expected);
  });
});
