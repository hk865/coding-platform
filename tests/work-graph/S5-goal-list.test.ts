/**
 * UI1 goals-list read-model rows (book `ui1-brief-goals-list.md` §5 "上限不返回半页" and
 * "COMPLETED 的 phase 优先级"; lead ruling 11-06 lines 5 and 7).
 *
 * The owner's public entry is `createGoalListReadModel` with the real shared records port of the
 * S5 decision fixture; the limit is injected at the constructor (ui1-brief-goals-list.md §2 "上限用注入的 maxItems
 * 缩小测试"). The list is a stable `a2-goal-by-workspace` lookup, so the capacity row runs on
 * memory and SQLite (tests/RULES.md S3); the ordinal fallback and the phase are business rows.
 *
 * The production package is not in this tree yet (the other session writes it); the factory is
 * loaded at run time and its absence is asserted by name, so the base still typechecks and the
 * rows are RED on their own assertion. No production type or constant is imported.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalSettingsV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import {
  GOAL_A, T, WORKSPACE_SCOPE, openS5DecisionFixture,
  type S5DecisionFixture, type S5FixtureKind, type S5OrderedRecords,
} from '../helpers/S5-decision-fixture.js';
import { assembleS5R2C, completeA1 } from '../helpers/S5R2-c-support.js';

type GoalListPhaseV1 = 'PLANNING' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';
type GoalListRow = {
  ref: GoalRef;
  revision: number;
  since: CommitCursor;
  ordinal: number | null;
  objective: string;
  desiredState: GoalSnapshot['desiredState'];
  desiredStateRevision: number;
  order: number;
  autonomy: GoalSettingsV1['autonomy'];
  waitForGoalRef: GoalRef | null;
  activePlanRevision: PlanRevisionRef | null;
  display: { phase: GoalListPhaseV1 | null };
};
type GoalListRead = { goals: GoalListRow[]; sourceCursor: CommitCursor | null };
type ReadModel = {
  readGoalList(ctx: CoreCallContext, input: { workspace: typeof WORKSPACE_SCOPE }): Promise<ReadResult<GoalListRead>>;
};
type ReadModelFactory = (deps: { records: S5OrderedRecords; maxItems?: number }) => ReadModel;

/** The module is produced by the other session; at the base it is absent, so the row says so by name. */
const GOAL_LIST_MODULE: string = '../../src/core/work-graph/views/goal-list-read-model.js';
async function readModelFactory(): Promise<ReadModelFactory | null> {
  try {
    const loaded = await import(GOAL_LIST_MODULE) as { createGoalListReadModel?: ReadModelFactory };
    return loaded.createGoalListReadModel ?? null;
  } catch {
    return null;
  }
}

const fixtures: S5DecisionFixture[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T);
});
afterEach(async () => {
  try { for (const fixture of fixtures.splice(0)) await fixture.close(); }
  finally { vi.useRealTimers(); }
});

async function openFixture(kind: S5FixtureKind) {
  const fixture = await openS5DecisionFixture(kind);
  fixtures.push(fixture);
  return fixture;
}

// Mutation: replace the capacity rejection with `goals.slice(0, maxItems)` in
// `views/goal-list-read-model.ts`. Red at the `capacity` assertion below (§5 row 5).
it.each(['memory', 'sqlite'] as const)(
  '%s: a workspace over maxItems is capacity and never a half page', async (kind) => {
    const fixture = await openFixture(kind);
    const make = await readModelFactory();
    expect(make, 'createGoalListReadModel is published by the goal list read model').not.toBeNull();
    const read = await make!({ records: fixture.records, maxItems: 2 })
      .readGoalList(fixture.ctx, { workspace: WORKSPACE_SCOPE });
    // The fixture has three Goals; the reason is the book's sentence with the injected limit.
    expect(read).toMatchObject({ status: 'rejected', code: 'capacity',
      reason: 'the workspace Goal list exceeds the 2 record read window' });
    expect(read).not.toHaveProperty('value');
  }, 60_000);

// Mutation: fall back to the list position when `readGoalOrdinals` answers null.
// Red at `toEqual([null, null, null])` below (ruling 11-06 line 5; §2 "绝不按列表位置补号").
it('the ordinal column is all null when the project Goal numbering cannot be read', async () => {
  const fixture = await openFixture('memory');
  // A2: the project-wide numbering lookup fails once; the workspace list itself still reads.
  const records: S5OrderedRecords = { ...fixture.records, lookup: (request) =>
    request.index === 'a2-goal-by-project'
      ? Promise.resolve({ status: 'rejected', code: 'unavailable', reason: 'the project Goal numbering is unavailable' })
      : fixture.records.lookup(request) };
  const make = await readModelFactory();
  expect(make, 'createGoalListReadModel is published by the goal list read model').not.toBeNull();
  const read = await make!({ records }).readGoalList(fixture.ctx, { workspace: WORKSPACE_SCOPE });
  expect(read.status).toBe('ready');
  expect((read as { status: 'ready'; value: GoalListRead }).value.goals.map((row) => row.ordinal))
    .toEqual([null, null, null]);
}, 60_000);

// Mutation: delete the `terminal.completed -> 'COMPLETED'` branch of the phase truth table.
// Red at `toMatchObject({ display: { phase: 'COMPLETED' } })` below (§5 row 9). The source line
// `goal-machine.ts:552` makes paused + COMPLETED unreachable, so reordering that branch behind
// PAUSED is unobservable; the branch's absence is the mutation this row can see.
it('Goal A reads as COMPLETED after the public completion path', async () => {
  // The existing completion fixture: real evidence rounds, then `completeGoal` on Goal A.
  const fixture = await openS5DecisionFixture('memory', { catalog: 'modules', requirementKind: 'static' });
  fixtures.push(fixture);
  const completion = await assembleS5R2C(fixture);
  await completeA1(completion);
  const make = await readModelFactory();
  expect(make, 'createGoalListReadModel is published by the goal list read model').not.toBeNull();
  const read = await make!({ records: fixture.records }).readGoalList(fixture.ctx, { workspace: WORKSPACE_SCOPE });
  expect(read.status).toBe('ready');
  const row = (read as { status: 'ready'; value: GoalListRead }).value.goals
    .find((candidate) => candidate.ref.goalId === GOAL_A.goalId);
  expect(row).toMatchObject({ desiredState: 'active', display: { phase: 'COMPLETED' } });
}, 120_000);
