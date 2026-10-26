/**
 * W-basis-wiring (book §5): the route and the Goal card carry the same three values; reading commits no `DispatchCounter`.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { moveS7APlan, moveS7APointer, ready, seedS7AGoalPlan } from '../helpers/S7A-fixture.js';

const counted = vi.hoisted(() => ({ counterRecords: 0 }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    const backend = actual.createInMemoryRecordBackend(options);
    const commit = backend.records.commit;
    return { ...backend, records: { ...backend.records, commit: (input: Parameters<typeof commit>[0]) => {
      if (input.records.some(record => record.schemaId.startsWith('DispatchCounter'))) counted.counterRecords += 1;
      return commit(input);
    } } };
  } };
});

const worlds: S6AHostWorld[] = [];
afterEach(async () => { await Promise.all(worlds.splice(0).map(world => world.close())); });

type Basis = { planRevision: number | null; pointerRevision: number | 'none'; dispatchSequence: number };
const readBasis = async (world: S6AHostWorld, goal: GoalRef): Promise<Basis> =>
  ready<Basis>(await world.post('goals/dispatch-basis', plain(S6A_SCOPE, { goalRef: goal })), 'the dispatch basis');

it('the basis route and the goal card carry one basis, and reading creates no counter', async () => {
  const world = await openS6AHostWorld({ backend: 'memory' });
  worlds.push(world);
  const { goal } = await seedS7AGoalPlan(world, { pointer: 'one' });
  await moveS7APlan(world, goal);
  await moveS7APointer(world, goal);
  const committed = counted.counterRecords;
  const route = await readBasis(world, goal);
  expect(route).toEqual({ planRevision: 2, pointerRevision: 2, dispatchSequence: 0 });
  const looked = await world.dispatch('graph/look', world.humanContext(), plain(S6A_SCOPE, { goalRef: goal,
    target: { kind: 'node', node: { kind: 'goal', ref: goal } }, relation: 'card',
    page: { afterCursor: null, limit: 20 } })) as { status: string; value?: { items: Array<{ dispatchBasis: unknown }> } };
  if (looked.status !== 'ready') throw new Error(`S7A: the card read is not ready: ${JSON.stringify(looked)}`);
  expect(looked.value?.items[0]?.dispatchBasis).toEqual(route);
  expect(counted.counterRecords).toBe(committed);
  expect(await readBasis(world, goal)).toEqual(route);
});
