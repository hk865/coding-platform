/**
 * Goal understanding-pointer facts and consistent dispatch-basis reads over a real platform.
 *
 * Prior state comes from the fixture's public steps (`seedS7AGoalPlan`, `moveS7APlan`, `moveS7APointer`) and
 * `openS6AHostWorld`; no Work Run is needed. The memory factory is wrapped only to capture and return the real
 * backend unchanged (A4), and the fault rows delegate every read to the real port (A2). A missing pointer is
 * `'none'` with an expectedRevision of null; a read failure is the failure, never "no pointer".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GraphNodeRefV1 } from '../../src/contracts/graph-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import { createDispatchBasisReader } from '../../src/core/work-graph/tasks/dispatch-basis.js';
import { sameCursor } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createGoalPointerFacts } from '../../src/core/work-graph/views/pointer-facts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { moveS7APlan, moveS7APointer, seedS7AGoalPlan } from '../helpers/S7A-fixture.js';

const captured = vi.hoisted(() => ({ records: undefined as unknown, platformRecords: undefined as unknown }));

// A4: capture the one real backend the platform builds and return it unchanged; no schema is added.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    const backend = actual.createInMemoryRecordBackend(options);
    captured.records = backend.records;
    return backend;
  } };
});

// The Host reads an observed copy of the backend; capture that same object, delegating unchanged.
vi.mock('../../src/composition/commit-observer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/composition/commit-observer.js')>();
  const real = actual.observeRecordCommits;
  return { ...actual, observeRecordCommits: async (...args: Parameters<typeof real>) => {
    const observed = await real(...args);
    captured.platformRecords = observed.records;
    return observed;
  } };
});

const worlds: S6AHostWorld[] = [];

async function openWorld(): Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({ backend: 'memory' });
  worlds.push(world);
  return world;
}

afterEach(async () => {
  captured.records = captured.platformRecords = undefined;
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

function realRecords(): GoalRecordTransactionPort {
  return captured.records as GoalRecordTransactionPort;
}

function basis(records: GoalRecordTransactionPort = realRecords()) {
  return createDispatchBasisReader({ records, pointer: createGoalPointerFacts({ records }) });
}

function readyBasis(read: Awaited<ReturnType<ReturnType<typeof basis>['readDispatchFacts']>>) {
  expect(read.status).toBe('ready');
  if (read.status !== 'ready') throw new Error(`S7A: the basis read is not ready: ${JSON.stringify(read)}`);
  return read.value;
}

/** The pointer's L2 key and its CurrentPointer CAS address. */
function pointerKeys(goal: GoalRef): { anchorKey: string; refKey: string } {
  const anchorKey = 'goal:' + goal.goalId;
  return { anchorKey, refKey: canonicalJson({ aggregateType: 'CurrentPointer', projectId: goal.projectId, anchorKey }) };
}

/** The counter's full canonical address; a null expected revision requires the counter to be absent. */
function counterKey(goal: GoalRef): string {
  return canonicalJson({
    aggregateType: 'DispatchCounter', projectId: goal.projectId, goalId: goal.goalId,
  } as unknown as JsonValue);
}

/** The Goal revision from the public read (the guard's expected revision comes from there, not the store). */
async function publicGoalRevision(world: S6AHostWorld, goal: GoalRef): Promise<number> {
  const answer = await world.post('goals/read', plain(S6A_SCOPE, goal));
  const body = answer.body as { status?: string; value?: { goal?: { revision?: number } } };
  if (body?.status !== 'ready' || typeof body.value?.goal?.revision !== 'number') {
    throw new Error(`S7A: goals/read is not ready: ${JSON.stringify(answer)}`);
  }
  return body.value.goal.revision;
}

// A3: wraps the real records port, counts every read and runs the test's public write after the named 1-based
// read; the real batch is returned unchanged and the write only reaches the reads that follow it.
function windowBasis(writes: ReadonlyMap<number, () => Promise<unknown>>) {
  const real = realRecords();
  const cursors: (CommitCursor | null)[] = [];
  let reads = 0;
  const records: GoalRecordTransactionPort = { ...real, async readMany(keys) {
    const batch = await real.readMany(keys);
    reads += 1;
    cursors.push(batch.status === 'ready' ? batch.value.readThrough : null);
    await writes.get(reads)?.();
    return batch;
  } };
  return { basis: basis(records), cursors, reads: () => reads };
}

type WindowVariant = { name: string; writes: readonly { afterRead: number; move: 'plan' | 'pointer' }[];
  expected: 'ready' | 'revision_conflict'; secondPass: 'retry' | 'moved' | 'split' };

// One table over eight real reads (four per pass). The first pass is A,B,B; row a re-reads B,B,B, row b moves
// again inside the re-read (B,C,C), row c moves between the passes (C,C,C, not the retry's B).
const windowVariants: readonly WindowVariant[] = [
  { name: 'a stable re-read: A,B,B then B,B,B is accepted',
    writes: [{ afterRead: 2, move: 'plan' }], expected: 'ready', secondPass: 'retry' },
  { name: 'b a move inside the re-read: A,B,B then B,C,C is a revision conflict',
    writes: [{ afterRead: 2, move: 'plan' }, { afterRead: 6, move: 'pointer' }],
    expected: 'revision_conflict', secondPass: 'split' },
  { name: 'c a second move before the re-read: A,B,B then C,C,C is a revision conflict',
    writes: [{ afterRead: 2, move: 'plan' }, { afterRead: 4, move: 'pointer' }],
    expected: 'revision_conflict', secondPass: 'moved' },
];

type PointerState = { name: string; pointer?: string; move: boolean; revision: number | 'none';
  expectedRevision: number | null };

const pointerStates: readonly PointerState[] = [
  { name: 'missing', move: false, revision: 'none', expectedRevision: null },
  { name: 'present at revision 1', pointer: 'one', move: false, revision: 1, expectedRevision: 1 },
  { name: 'moved to revision 2', pointer: 'one', move: true, revision: 2, expectedRevision: 2 },
];
async function lookCard(world: S6AHostWorld, node: GraphNodeRefV1, goal: GoalRef) {
  const read = await world.platform.graphContext.lookGraph(world.humanContext(), {
    goalRef: goal, target: { kind: 'node', node }, relation: 'card', page: { afterCursor: null, limit: 20 },
  });
  expect(read.status).toBe('ready');
  if (read.status !== 'ready') throw new Error(`S7A: the graph look is not ready: ${JSON.stringify(read)}`);
  const card = read.value.items[0];
  if (card === undefined) throw new Error('S7A: the graph look returned no card');
  return card;
}

describe('dispatch basis facts', () => {
  it.each(pointerStates)('one read over a $name pointer gives the three values and the three guards', async (state) => {
    const world = await openWorld();
    const { goal, plan } = await seedS7AGoalPlan(world, state.pointer === undefined ? {} : { pointer: state.pointer });
    let planRef = plan.ref;
    let planRevision = 1;
    if (state.move) {
      planRef = (await moveS7APlan(world, goal)).ref;
      planRevision = 2;
      await moveS7APointer(world, goal);
    }
    const facts = readyBasis(await basis().readDispatchFacts(world.humanContext(), { goalRef: goal }));
    expect(facts.goal.ref).toEqual(goal);
    expect(facts.plan?.ref).toEqual(planRef);
    expect(facts.values).toEqual({ planRevision, pointerRevision: state.revision, dispatchSequence: 0 });
    expect(facts.pointer).toEqual({
      revision: state.revision, anchorRefKey: pointerKeys(goal).anchorKey, expectedRevision: state.expectedRevision,
    });
    expect(facts.counter).toMatchObject({ record: null, refKey: counterKey(goal), expectedRevision: null });
    expect(facts.readCursor).not.toBeNull();
    expect(facts.guards).toEqual([
      { refKey: canonicalJson(goal as unknown as JsonValue), expectedRevision: await publicGoalRevision(world, goal) },
      { refKey: pointerKeys(goal).refKey, expectedRevision: state.expectedRevision },
      { refKey: counterKey(goal), expectedRevision: null },
    ]);
    expect(await basis().readDispatchBasis(world.humanContext(), { goalRef: goal })).toEqual({
      status: 'ready', value: { planRevision, pointerRevision: state.revision, dispatchSequence: 0 },
    });
  });

  it.each<[string, (goal: GoalRef) => string]>([
    ['pointer', goal => pointerKeys(goal).refKey],
    ['counter', counterKey],
  ])('a failed %s read is the rejection, never none or 0, and the real port recovers', async (name, refKey) => {
    const world = await openWorld();
    const { goal } = await seedS7AGoalPlan(world, { pointer: 'one' });
    const real = realRecords();
    const key = refKey(goal);
    let failed = false;
    const failing: GoalRecordTransactionPort = { ...real, async readMany(keys) {
      if (!failed && keys.includes(key)) {
        failed = true;
        throw new Error(`S7A: the ${name} read failed once`);
      }
      return real.readMany(keys);
    } };
    const rejectedRead = await basis(failing).readDispatchBasis(world.humanContext(), { goalRef: goal });
    expect(rejectedRead).toMatchObject({
      status: 'rejected', code: 'unavailable',
      reason: expect.stringContaining(`the ${name} read failed once`),
    });
    expect(await basis(real).readDispatchBasis(world.humanContext(), { goalRef: goal })).toEqual({
      status: 'ready', value: { planRevision: 1, pointerRevision: 1, dispatchSequence: 0 },
    });
  });

  it.each(windowVariants)('window $name', async (variant) => {
    const world = await openWorld();
    const { goal } = await seedS7AGoalPlan(world, { pointer: 'one' });
    const writes = new Map(variant.writes.map(({ afterRead, move }) => [afterRead, () => (
      move === 'plan' ? moveS7APlan(world, goal) : moveS7APointer(world, goal))]));
    const gated = windowBasis(writes);
    const read = await gated.basis.readDispatchFacts(world.humanContext(), { goalRef: goal });

    // One retry only: four real reads per pass, eight in all; a second retry would make this twelve.
    expect(gated.reads()).toBe(8);
    const [goalA, planA, pointerB, counterB, goalC, planC, pointerC, counterC] = gated.cursors;
    // First pass A,B,B: the window pair shares one cursor, the pointer and counter the next.
    expect(sameCursor(goalA ?? null, planA ?? null)).toBe(true);
    expect(sameCursor(pointerB ?? null, counterB ?? null)).toBe(true);
    expect(sameCursor(planA ?? null, pointerB ?? null)).toBe(false);
    if (variant.secondPass === 'split') {
      expect(sameCursor(goalC ?? null, planC ?? null)).toBe(true);
      expect(sameCursor(pointerC ?? null, counterC ?? null)).toBe(true);
      expect(sameCursor(planC ?? null, pointerC ?? null)).toBe(false);
    } else {
      expect([goalC, planC, pointerC, counterC].every(cursor => sameCursor(cursor ?? null, goalC ?? null))).toBe(true);
      expect(sameCursor(goalC ?? null, counterB ?? null)).toBe(variant.secondPass === 'retry');
    }

    if (variant.expected === 'ready') {
      if (read.status !== 'ready') throw new Error(`S7A: the stable re-read is not ready: ${JSON.stringify(read)}`);
      expect(read.value.values).toEqual({ planRevision: 2, pointerRevision: 1, dispatchSequence: 0 });
      // The accepted cursor is the last counter read's B, not the first pass's window A.
      expect(sameCursor(read.value.readCursor, counterB ?? null)).toBe(true);
    } else {
      expect(read).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    }
  });

  it('the goal card carries the basis, a task card has null, and a failed basis read propagates', async () => {
    const world = await openWorld();
    const { goal, plan } = await seedS7AGoalPlan(world, { pointer: 'one' });
    const goalCard = await lookCard(world, { kind: 'goal', ref: goal }, goal);
    expect(goalCard.dispatchBasis).toEqual({ planRevision: 1, pointerRevision: 1, dispatchSequence: 0 });

    const task = plan.tasks.find(candidate => candidate.taskKind === 'work');
    if (task === undefined) throw new Error('S7A: the seeded plan has no work task');
    const taskCard = await lookCard(
      world, { kind: 'task', planRef: plan.ref, ref: { ...goal, taskId: task.taskId } }, goal);
    expect(taskCard.dispatchBasis).toBeNull();

    // A2: the platform's own captured records object fails the pointer read once; the failure is the graph
    // read's rejection, never a null field.
    const platformRecords = captured.platformRecords as GoalRecordTransactionPort;
    const pointerRefKey = pointerKeys(goal).refKey;
    const original = platformRecords.readMany;
    let failed = false;
    platformRecords.readMany = async (keys) => {
      if (!failed && keys.includes(pointerRefKey)) {
        failed = true;
        throw new Error('S7A: the platform pointer read failed once');
      }
      return original(keys);
    };
    try {
      const failedLook = await world.platform.graphContext.lookGraph(world.humanContext(), {
        goalRef: goal, target: { kind: 'node', node: { kind: 'goal', ref: goal } }, relation: 'card',
        page: { afterCursor: null, limit: 20 },
      });
      expect(failedLook).toMatchObject({
        status: 'rejected', code: 'unavailable',
        reason: expect.stringContaining('the platform pointer read failed once'),
      });
    } finally {
      platformRecords.readMany = original;
    }
  });
});
