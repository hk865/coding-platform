/**
 * UI1 goals-list route rows (book `ui1-brief-goals-list.md` §5; lead ruling 11-06 lines 5-7).
 *
 * Rows: empty workspace, two Goals both at order 0, the reorder pin round trip, a repeated read
 * whose order is recomputed with no cursor, a cancelled Goal that stays listed and pinned, the
 * owner-level cross-workspace refusal, and one read that never loops through `goals/settings`.
 * The list is a stable `a2-goal-by-workspace` lookup, so the business rows run on memory and
 * SQLite (tests/RULES.md S3: index/lookup order and CAS).
 *
 * The production package is not in this tree yet (it lands from the other session), so the route
 * suffix below is not in `CoreRouteSuffix`/`CORE_ROUTE_SPECS` at the base: the rows are RED on
 * their first assertion. Suffix casts carry the frozen literal; they disappear when the type lands.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { createPlatformCoreRouteBindings, dispatchCoreRoute, parseCoreRouteRequest } from '../../src/app/core-routes.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import {
  S6A_SCOPE, openS6ARequestWorld, type S6ABackend, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';

type GoalListPhaseV1 = 'PLANNING' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';
type GoalListRow = {
  ref: GoalRef;
  revision: number;
  ordinal: number | null;
  order: number;
  desiredState: string;
  activePlanRevision: unknown;
  display: { phase: GoalListPhaseV1 | null };
};
type GoalListRead = { status: 'ready'; value: { goals: GoalListRow[]; sourceCursor: CommitCursor | null } };
type Rejected = { status: 'rejected'; code: string; reason: string };
type Committed = { status: 'committed'; value?: unknown };

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

async function worldWithoutGoals(backend: S6ABackend): Promise<{ world: S6ARequestWorld; workspace: S6ACardsWorkspace }> {
  const world = await openS6ARequestWorld({ backend, defaultGoals: false });
  worlds.push(world);
  return { world, workspace: s6aCardsWorkspace(world, S6A_SCOPE) };
}

async function readList(workspace: S6ACardsWorkspace): Promise<GoalListRead> {
  const body = await workspace.route('goals/list', { workspace: S6A_SCOPE });
  // The base has no `goals/list` yet: this is the row's first assertion, not a fixture failure.
  expect(body, 'goals/list must answer a ready Goal list').toMatchObject({ status: 'ready', value: { goals: expect.any(Array) } });
  return body as GoalListRead;
}

const idsOf = (read: GoalListRead): string[] => read.value.goals.map((row) => row.ref.goalId);
const revisionsOf = (read: GoalListRead): number[] => read.value.goals.map((row) => row.revision);
const versionPinsOf = (read: GoalListRead): { ref: GoalRef; revision: number }[] =>
  read.value.goals.map((row) => ({ ref: row.ref, revision: row.revision }));

async function reorder(
  workspace: S6ACardsWorkspace, read: GoalListRead, order: GoalRef[], requestId: string,
): Promise<Committed> {
  return await workspace.post('goals/reorder', graphWrite(S6A_SCOPE,
    { workspace: S6A_SCOPE, goalOrder: order }, requestId, versionPinsOf(read))) as Committed;
}

// Mutation: in `views/goal-list-read-model.ts` answer `{ status: 'not_found' }` when the window is empty.
// Red at the `toMatchObject({ status: 'ready', ... })` below (ui1-brief-goals-list.md §5 row 1).
it.each(['memory', 'sqlite'] as const)('%s: an empty workspace is a ready empty Goal list', async (backend) => {
  const { workspace } = await worldWithoutGoals(backend);
  const read = await readList(workspace);
  expect(read).toMatchObject({ status: 'ready', value: { goals: [] } });
  expect(read.value).toHaveProperty('sourceCursor');
  expect(read).not.toHaveProperty('code');
}, 60_000);

// Mutation: drop the `since` arm from `rows.sort` in `views/goal-list-read-model.ts` (order only).
// Red below at `idsOf(read)`: the index's goal-id order answers `goal-a, goal-b` (§5 row 2).
it.each(['memory', 'sqlite'] as const)(
  '%s: two Goals both at order 0 are listed in creation order with project ordinals', async (backend) => {
    const { workspace } = await worldWithoutGoals(backend);
    // Created first, although `a2-goal-by-workspace` returns the lexicographically smaller goal id
    // first: this is what makes the `since` tie-break (ui1-brief-goals-list.md §2 sort key 2) observable.
    await workspace.createGoal('goal-b');
    await workspace.createGoal('goal-a');
    const read = await readList(workspace);
    expect(idsOf(read)).toEqual(['goal-b', 'goal-a']);
    expect(read.value.goals.map((row) => row.order)).toEqual([0, 0]);
    expect(read.value.goals.map((row) => row.ordinal)).toEqual([1, 2]);
    expect(revisionsOf(read)).toEqual([1, 1]);
  }, 60_000);

// Mutation: carry `desiredStateRevision` instead of `revision` in the row (both 1 for a fresh Goal).
// Red at the second `toMatchObject({ status: 'committed' })`: the stale pin is a `revision_conflict`
// (§5 row 3).
it.each(['memory', 'sqlite'] as const)(
  '%s: reorder and list round-trip through the versions the list returned', async (backend) => {
    const { workspace } = await worldWithoutGoals(backend);
    const first = (await workspace.createGoal('goal-b')).ref;
    const second = (await workspace.createGoal('goal-a')).ref;
    const initial = await readList(workspace);

    // Put the second-created Goal first: it keeps order 0, so only the first-created one is rewritten.
    expect(await reorder(workspace, initial, [second, first], 'ui1-gls-order-down')).toMatchObject({ status: 'committed' });
    const down = await readList(workspace);
    expect(idsOf(down)).toEqual(['goal-a', 'goal-b']);
    expect(down.value.goals.map((row) => row.order)).toEqual([0, 1]);
    expect(down.value.goals.map((row) => row.ordinal)).toEqual([2, 1]);
    expect(revisionsOf(down)).toEqual([1, 2]);

    // The pins from that read are what make the next write land; a list of the wrong versions is a CAS refusal.
    expect(await reorder(workspace, down, [first, second], 'ui1-gls-order-back')).toMatchObject({ status: 'committed' });
    const back = await readList(workspace);
    expect(idsOf(back)).toEqual(['goal-b', 'goal-a']);
    expect(revisionsOf(back)).toEqual([3, 2]);
  }, 60_000);

// Mutation: number the rows by list position (or cache the first rows outside the read).
// Red at `after.value.goals.map(row => row.ordinal)` `toEqual([2, 1])` (§5 row 6).
it.each(['memory', 'sqlite'] as const)(
  '%s: a repeated read is complete, has no cursor and recomputes the order', async (backend) => {
    const { workspace } = await worldWithoutGoals(backend);
    const first = (await workspace.createGoal('goal-b')).ref;
    const second = (await workspace.createGoal('goal-a')).ref;
    const before = await readList(workspace);
    expect(idsOf(before)).toEqual(['goal-b', 'goal-a']);
    expect(before.value.goals.map((row) => row.ordinal)).toEqual([1, 2]);

    expect(await reorder(workspace, before, [second, first], 'ui1-gls-repeat-reorder')).toMatchObject({ status: 'committed' });
    const after = await readList(workspace);
    expect(after.value.goals).toHaveLength(2);
    expect(new Set(idsOf(after))).toEqual(new Set(['goal-a', 'goal-b']));
    expect(idsOf(after)).toEqual(['goal-a', 'goal-b']);
    expect(after.value.goals.map((row) => row.ordinal)).toEqual([2, 1]);
    expect(Object.keys(after.value).sort()).toEqual(['goals', 'sourceCursor']);
    expect(after.value).not.toHaveProperty('cursor');
    expect(after.value).not.toHaveProperty('next');
  }, 60_000);

// Mutation: `goals.filter(goal => goal.desiredState !== 'cancelled')` before assembling rows.
// Red at `idsOf(listed)` (two rows) and the reorder below answers `invalid` (§5 row 8).
it.each(['memory', 'sqlite'] as const)(
  '%s: a cancelled Goal is listed, keeps phase CANCELLED and can still be pinned', async (backend) => {
    const { workspace } = await worldWithoutGoals(backend);
    const first = (await workspace.createGoal('goal-b')).ref;
    const second = (await workspace.createGoal('goal-a')).ref;
    const third = (await workspace.createGoal('goal-c')).ref;
    const readThird = await workspace.route('goals/read', third) as { status: 'ready'; value: { goal: { revision: number } } };
    const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: third.projectId, goalId: third.goalId };
    const cancelled = await workspace.post('goals/control', graphWrite(S6A_SCOPE,
      { goalRef: third, control: 'cancel', reason: 'UI1 goals-list: cancel the third Goal' }, 'ui1-gls-cancel-c', [
        { ref: third, revision: readThird.value.goal.revision },
        { ref: phaseRef, revision: 0 },
      ]));
    expect(cancelled).toMatchObject({ status: 'committed' });

    const listed = await readList(workspace);
    expect(idsOf(listed)).toEqual(['goal-b', 'goal-a', 'goal-c']);
    const row = listed.value.goals.find((candidate) => candidate.ref.goalId === 'goal-c');
    expect(row).toMatchObject({ desiredState: 'cancelled', display: { phase: 'CANCELLED' } });
    const cancelledRevision = row?.revision;

    // `goals/reorder` needs every Goal and every pin; filtering the cancelled one out is a refusal there.
    expect(await reorder(workspace, listed, [first, second, third], 'ui1-gls-cancel-reorder'))
      .toMatchObject({ status: 'committed' });
    const after = await readList(workspace);
    expect(after.value.goals.find((candidate) => candidate.ref.goalId === 'goal-c'))
      .toMatchObject({ desiredState: 'cancelled', revision: cancelledRevision, display: { phase: 'CANCELLED' } });
  }, 60_000);

describe('rejects: goals/list refuses a workspace outside the bound call scope', () => {
  // Mutation: delete the `workspaceScopeProblem(ctx, input.workspace)` call before the window read.
  // Red at the `forbidden`/reason assertion below (§5 row 4; sentence at goal-conflicts.ts:100).
  it('a foreign workspace is forbidden and leaves the list unchanged', async () => {
    const { workspace } = await worldWithoutGoals('memory');
    await workspace.createGoal('goal-a');
    const foreign = { projectId: S6A_SCOPE.projectId, workspaceId: 'ui1-goals-list-other-workspace' };
    const refused = await workspace.post('goals/list', plain(S6A_SCOPE, { workspace: foreign })) as Rejected;
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden',
      reason: 'the requested workspace is outside the bound call scope' });
    expect(refused).not.toHaveProperty('value');

    // The public read still shows exactly the one Goal that was there before the refusal.
    expect(idsOf(await readList(workspace))).toEqual(['goal-a']);
  }, 60_000);
});

describe('routes: one named owner and one read', () => {
  // Mutation: loop `platform.goalSettings.readGoalSettings(row.ref)` over the rows in the route arm.
  // Red at `counts` below: `goalSettings.readGoalSettings` would appear (ui1-brief §5 row 7).
  it('goals/list calls goalList.readGoalList once and never loops through goalSettings or decisions', async () => {
    const { world, workspace } = await worldWithoutGoals('memory');
    await workspace.createGoal('goal-b');
    await workspace.createGoal('goal-a');
    await workspace.createGoal('goal-c');
    type AnyFn = (...args: never[]) => unknown;
    // The published platform owns the real `goalList` group after the other session lands.
    const real = world.platform as unknown as {
      goalList?: { readGoalList: AnyFn };
      goalSettings: { readGoalSettings: AnyFn };
      decisions: { queryGoalConflicts: AnyFn };
    };
    expect(real.goalList, 'the platform publishes goalList.readGoalList').toBeDefined();
    const counts = new Map<string, number>();
    // A3: the wrapper counts one named method and forwards every other member to the real group.
    const countedGroup = (groupName: string, method: string, group: object): object => new Proxy(group, {
      get: (target, key) => key === method
        ? (...args: never[]) => {
          counts.set(`${groupName}.${method}`, (counts.get(`${groupName}.${method}`) ?? 0) + 1);
          return (Reflect.get(target, key) as AnyFn).apply(target, args);
        }
        : Reflect.get(target, key),
    });
    const goalList = countedGroup('goalList', 'readGoalList', real.goalList!);
    const goalSettings = countedGroup('goalSettings', 'readGoalSettings', real.goalSettings);
    const decisions = countedGroup('decisions', 'queryGoalConflicts', real.decisions);
    const platform = new Proxy(world.platform, { get: (target, key) =>
      key === 'goalList' ? goalList : key === 'goalSettings' ? goalSettings : key === 'decisions' ? decisions : Reflect.get(target, key) });
    const bindings = createPlatformCoreRouteBindings(platform);
    const body = { scope: S6A_SCOPE, input: { workspace: S6A_SCOPE } };
    const result = await dispatchCoreRoute(bindings, 'goals/list' as never, world.humanContext(),
      parseCoreRouteRequest('goals/list' as never, body));
    expect(result).toMatchObject({ status: 'ready' });
    expect((result as GoalListRead).value.goals).toHaveLength(3);
    expect(idsOf(result as GoalListRead)).toEqual(['goal-b', 'goal-a', 'goal-c']);
    expect(counts.get('goalList.readGoalList')).toBe(1);
    expect(counts.get('goalSettings.readGoalSettings') ?? 0).toBe(0);
    expect(counts.get('decisions.queryGoalConflicts') ?? 0).toBe(0);
  }, 60_000);
});
