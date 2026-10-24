/**
 * The request facts read at its boundary (book §3.3, §3.12): the real complete
 * read of a request root the platform itself created, the frozen store surface,
 * read failures, and the candidate adapter.
 *
 * Every prior state is reached through the frozen SE1 world's public steps:
 * `requests/submit` through the Host route creates the root, `sessions/archive-line`
 * archives its owner. The store is the platform's OWN real records port (A4: the
 * two backend factories are wrapped only to remember the backend they built and
 * return it unchanged); the fault rows wrap that real port (A2) and every other
 * result passes through. No record is written by hand and no fact is read from
 * the store to assert it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import { SESSION_BY_PROVENANCE_LOOKUP } from '../../src/core/work-graph/model/session-facts-contracts.js';
import {
  deriveRequestOwner, readRequestRounds, type RequestRoundsStore,
} from '../../src/core/work-graph/queries/request-rounds-read.js';
import { createCandidateRequestFactsReader } from '../../src/core/work-graph/tasks/request-facts.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_GOAL_2, S6A_SCOPE,
  type S6ABackend, type S6ARequestWorld, type S6ASession,
} from '../helpers/S6A-request-fixture.js';

// ---------------------------------------------------------------------------
// A4: remember the real records port the platform shares; return it unchanged.
// ---------------------------------------------------------------------------
const captured = vi.hoisted(() => ({ records: undefined as unknown }));

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    const backend = actual.createInMemoryRecordBackend(options);
    captured.records = backend.records;
    return backend;
  } };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/sqlite-record-store.js')>();
  return { ...actual, createSqliteRecordBackend: (options: Parameters<typeof actual.createSqliteRecordBackend>[0]) => {
    const backend = actual.createSqliteRecordBackend(options);
    captured.records = backend.records;
    return backend;
  } };
});

type RealRecords = GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;

const worlds: S6ARequestWorld[] = [];

async function open(backend: S6ABackend): Promise<S6ARequestWorld> {
  const world = await openS6ARequestWorld({ backend });
  worlds.push(world);
  return world;
}

afterEach(async () => {
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

const submitInput = (commandId: string): Record<string, unknown> => ({
  commandId, goalId: S6A_GOAL_1.goalId, text: `S6A request facts ${commandId}`, continues: null, recipient: null,
});

/** One request root through the Host's `requests/submit` route. */
async function submitRoot(
  world: S6ARequestWorld, commandId: string,
): Promise<{ root: QueryJobRef; secretary: SessionRef }> {
  const answer = await world.post('requests/submit', body(submitInput(commandId)));
  const value = asRecord(answer.body);
  if (value['status'] !== 'queued') throw new Error(`S6A: the submit did not queue: ${JSON.stringify(answer.body)}`);
  return { root: value['requestRoot'] as QueryJobRef, secretary: asRecord(value['secretary']) as unknown as SessionRef };
}

async function idleSecretary(world: S6ARequestWorld): Promise<S6ASession> {
  return world.createSecretary('facts-owner');
}

function realRecords(): RealRecords {
  return captured.records as RealRecords;
}

/** A store with exactly the frozen interface: no commit locator. */
function frozenStore(real: RealRecords): RequestRoundsStore {
  return {
    readMany: keys => real.readMany(keys),
    eventAt: cursor => real.eventAt(cursor),
    lookup: request => real.lookup(request),
    lookupOrdered: request => real.lookupOrdered(request),
  };
}

/** A real request root read through the frozen surface. */
async function readRoot(
  world: S6ARequestWorld, root: QueryJobRef, store: RequestRoundsStore = frozenStore(realRecords()),
) {
  return readRequestRounds(store, world.humanContext(), { requestRoot: root });
}

describe.each(['memory', 'sqlite'] as const)('request facts read (%s)', backend => {
  it('FP-03 a store with exactly the frozen interface (no commit lookup) reads a real request root', async () => {
    const world = await open(backend);
    const secretary = await idleSecretary(world);
    const { root } = await submitRoot(world, `s6a-fp03-${backend}`);

    const facts = await readRoot(world, root);
    expect(facts.status).toBe('ready');
    if (facts.status !== 'ready') return;
    expect({ owner: facts.value.owner, ownerState: facts.value.ownerState, lastOwner: facts.value.lastOwner })
      .toEqual({ owner: secretary.ref, ownerState: 'owned', lastOwner: secretary.ref });
    expect(facts.value.initiator.kind).toBe('human');
  });

  it('FP-05 a throwing owner-Session read is unavailable, not a rejected promise', async () => {
    const world = await open(backend);
    const secretary = await idleSecretary(world);
    const { root } = await submitRoot(world, `s6a-fp05-owner-${backend}`);
    const real = realRecords();
    const ownerKeyPart = `"sessionId":"${secretary.ref.sessionId}"`;
    const wrapped: RealRecords = {
      ...real,
      async readMany(keys) {
        if (keys.some(key => key.includes(ownerKeyPart))) throw new Error('the owner Session read failed');
        return real.readMany(keys);
      },
    };
    await expect(readRoot(world, root, frozenStore(wrapped)))
      .resolves.toMatchObject({ status: 'rejected', code: 'unavailable' });
  });

  it('FP-05 a throwing successor lookup is unavailable, not a rejected promise', async () => {
    const world = await open(backend);
    const secretary = await idleSecretary(world);
    const { root } = await submitRoot(world, `s6a-fp05-successor-${backend}`);
    // An archived owner: the next read asks the provenance index for successors.
    await world.archive(secretary);
    const real = realRecords();
    const wrapped: RealRecords = {
      ...real,
      async lookup(request) {
        if (request.index === SESSION_BY_PROVENANCE_LOOKUP) throw new Error('the successor lookup failed');
        return real.lookup(request);
      },
    };
    await expect(readRoot(world, root, frozenStore(wrapped)))
      .resolves.toMatchObject({ status: 'rejected', code: 'unavailable' });
  });

  it('FP-05 a throwing creation-event read is unavailable, not a rejected promise', async () => {
    const world = await open(backend);
    await idleSecretary(world);
    const { root } = await submitRoot(world, `s6a-fp05-event-${backend}`);
    const real = realRecords();
    const wrapped: RealRecords = {
      ...real,
      async eventAt() { throw new Error('the creation event read failed'); },
    };
    await expect(readRoot(world, root, frozenStore(wrapped)))
      .resolves.toMatchObject({ status: 'rejected', code: 'unavailable' });
  });

  it('FP-05 a throwing creation-event read through the candidate adapter is unavailable', async () => {
    const world = await open(backend);
    await idleSecretary(world);
    const { root } = await submitRoot(world, `s6a-fp05-adapter-${backend}`);
    const real = realRecords();
    const wrapped: RealRecords = {
      ...real,
      async eventAt() { throw new Error('the creation event read failed'); },
    };
    const reader = createCandidateRequestFactsReader({ records: wrapped });
    const goal: GoalRef = S6A_GOAL_1;
    await expect(reader.readCandidateRequestFacts(world.humanContext(), { requestRef: root, goalRef: goal }))
      .resolves.toMatchObject({ status: 'rejected', code: 'unavailable' });
  });

  it('FP-07 the real read and the exported owner rule read one owner', async () => {
    const world = await open(backend);
    const secretary = await idleSecretary(world);
    const { root } = await submitRoot(world, `s6a-fp07-${backend}`);
    const facts = await readRoot(world, root);
    expect(facts.status).toBe('ready');
    if (facts.status !== 'ready') return;
    expect({ owner: facts.value.owner, ownerState: facts.value.ownerState })
      .toEqual({ owner: secretary.ref, ownerState: 'owned' });
    const card = await world.readSession(secretary.ref);
    const derived = deriveRequestOwner(facts.value.rounds, [
      { session: secretary.ref, lifecycle: card.record.lifecycle, provenance: card.record.provenance },
    ]);
    expect({ owner: derived.owner, ownerState: derived.ownerState, lastOwner: derived.lastOwner })
      .toEqual({ owner: secretary.ref, ownerState: 'owned', lastOwner: secretary.ref });
  });

  it('FP-08 the candidate adapter reads the root through the complete read', async () => {
    const world = await open(backend);
    const secretary = await idleSecretary(world);
    const { root } = await submitRoot(world, `s6a-fp08-${backend}`);
    const real = realRecords();
    // The frozen store has no commit locator: the adapter must not need one.
    const noCommitLookup: RealRecords = {
      ...real,
      async lookupCommit() { throw new Error('the frozen store has no commit locator'); },
    };
    const reader = createCandidateRequestFactsReader({ records: noCommitLookup });
    const goal: GoalRef = S6A_GOAL_1;
    const facts = await reader.readCandidateRequestFacts(world.humanContext(), { requestRef: root, goalRef: goal });
    expect(facts).toMatchObject({
      status: 'ready',
      value: { root: true, initiatedByOperator: true, currentSecretary: secretary.ref },
    });
    if (facts.status !== 'ready') return;
    // The complete read guards every record it read: the root round, its
    // QueryRun and the owner Session.
    expect(facts.value.guards).toHaveLength(3);
    // The effective goal is the request's own goal: another goal is not its root.
    const otherGoal: GoalRef = S6A_GOAL_2;
    expect(await reader.readCandidateRequestFacts(world.humanContext(), { requestRef: root, goalRef: otherGoal }))
      .toMatchObject({ status: 'ready', value: { root: false } });
    // The initiator is the root's creation actor: a system caller is not it.
    expect(await reader.readCandidateRequestFacts(world.systemContext(), { requestRef: root, goalRef: goal }))
      .toMatchObject({ status: 'ready', value: { root: true, initiatedByOperator: false } });
  });
});
