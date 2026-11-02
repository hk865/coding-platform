/**
 * `W-drain` (book :2037, `:284`, S6 R-01, §3.9 item 3): one project, two workspaces, `open.secretary` raised
 * 2→4 with one waiting request each. The raise's `ProjectRoleLimitsChanged` is an ordinary queue commit: each
 * request is assigned exactly once after it. With `requestDriver: 'off'` the raise assigns nothing. An
 * assigned-but-unclaimed request keeps its one routing round across a memory reopen (the A4 seam).
 * Named mutation (not run here): remove `ProjectRoleLimits` from the unassigned queue's `aggregateTypes`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import {
  openS6ACardsWorld, openS7D1DrainWorld, type S6ACardsWorld,
} from '../helpers/S6A-cards-fixture.js';
import { asRecord } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { waitFor } from '../scenarios/harness.js';

// A4: one real in-memory records backend and one real body store across Host starts, so the reopen is the same
// store on the same directory (the pattern tests/app/S7A-host-gates.test.ts installs).
const shared = vi.hoisted(() => ({ backend: undefined as unknown, bodies: undefined as unknown }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    shared.backend ??= { ...actual.createInMemoryRecordBackend(options), close: async () => undefined };
    return shared.backend;
  } };
});
vi.mock('../../src/core/record-store/body-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/body-store.js')>();
  return { ...actual, RawArtifactBodyStore: class SharedRawArtifactBodyStore {
    constructor() { shared.bodies ??= new actual.RawArtifactBodyStore(); return shared.bodies as never; }
  } as never };
});

const worlds: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  // The A4 seam is per world: the next test starts on a fresh backend, not the previous world's records.
  shared.backend = undefined;
  shared.bodies = undefined;
});

const routingRounds = (view: RequestCoreViewV1): number =>
  view.rounds.filter(round => round.kind === 'routing').length;

/** The person's limit read and set, each pinning the revision the previous read answered. */
async function raiseSecretaryOpen(cards: S6ACardsWorld, commandId: string, open: number): Promise<void> {
  const read = asRecord(await cards.main.route('projects/role-limits', { projectRef: { projectId: S6A_SCOPE.projectId } }));
  expect(read['status']).toBe('ready');
  const set = asRecord(await cards.main.route('projects/role-limits/set', { commandId,
    expectedRevision: asRecord(read['value'])['revision'], open: { secretary: open } }));
  expect(set['status']).toBe('committed');
}

describe('W-drain: the raised project limit wakes both workspaces once', () => {
  it('one waiting request per workspace is assigned exactly once after open.secretary 2→4, and keeps its round across the reopen', async () => {
    const drain = await openS7D1DrainWorld();
    worlds.push(drain.world);
    expect(drain.mainRequest.secretary).toBeNull();
    expect(drain.secondRequest.secretary).toBeNull();
    const main = await waitFor(
      async () => await drain.world.main.readRequest(drain.mainRequest.requestRoot) as unknown as RequestCoreViewV1,
      view => view.assignment === 'assigned', 'the main drain assignment');
    const second = await waitFor(
      async () => await drain.world.second.readRequest(drain.secondRequest.requestRoot) as unknown as RequestCoreViewV1,
      view => view.assignment === 'assigned', 'the second drain assignment');
    expect(main.owner).not.toBeNull();
    expect(second.owner).not.toBeNull();
    expect(main.owner!.sessionId).not.toBe(second.owner!.sessionId);
    expect(routingRounds(main)).toBe(1);
    expect(routingRounds(second)).toBe(1);

    await drain.world.world.reopen({ sharedMemoryStore: true });
    const after = await drain.world.main.readRequest(drain.mainRequest.requestRoot) as unknown as RequestCoreViewV1;
    expect(after).toMatchObject({ assignment: 'assigned', owner: main.owner, waitReason: null });
    expect(routingRounds(after)).toBe(1);
    expect(after.rounds).toHaveLength(main.rounds.length);
  }, 180_000);

  it('with requestDriver off the same raise assigns neither waiting request', async () => {
    const cards = await openS6ACardsWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'off' } });
    worlds.push(cards);
    const world = cards.world;
    await raiseSecretaryOpen(cards, 's7d1-w-drain-off-2', 2);
    const first = await world.createSecretary('s7d1-drain-off-a');
    const second = await world.createSecretary('s7d1-drain-off-b');
    await world.occupy(first);
    await world.occupy(second);
    const mainRequest = await cards.main.submit({ label: 's7d1-drain-off-main', goalId: null });
    const secondRequest = await cards.second.submit({ label: 's7d1-drain-off-second', goalId: null });
    await raiseSecretaryOpen(cards, 's7d1-w-drain-off-4', 4);
    await world.settleDetached();
    expect(await cards.main.readRequest(mainRequest.requestRoot)).toMatchObject({ assignment: 'unassigned',
      owner: null, waitReason: 'secretary_open_cap' });
    expect(await cards.second.readRequest(secondRequest.requestRoot)).toMatchObject({ assignment: 'unassigned',
      owner: null, waitReason: 'secretary_open_cap' });
    const limits = asRecord(await cards.main.route('projects/role-limits',
      { projectRef: { projectId: S6A_SCOPE.projectId } }));
    expect(asRecord(asRecord(limits['value'])['open'])['secretary']).toBe(4);
  }, 180_000);
});
