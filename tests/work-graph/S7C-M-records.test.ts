/**
 * M-records (book-7c.md:1354): `memberCreateInputProblem`'s pure table, record 1's real round trip, the
 * `core-op-member-by-goal` order and the identity-only commit read.
 *
 * The pure table is A5. The storage half runs through the real S7C world's member service: a Host-pick request
 * writes record 1, `sessions/operation` reads it back, and the codec round-trips that exact record. The order row
 * reads the one renamed lookup through the service's pending-card reader; `requestMember` itself reads no lookup.
 * Nothing reads a store, and every value is what the real operation returned.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import { decodeSessionOperationRecord, encodeSessionOperationRecord } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { memberCreateInputProblem } from '../../src/core/work-graph/state/member-creation.js';
import { openS7C1World, type S7C1World } from '../helpers/S7C-member-fixture.js';

const PROJECT = 'P';
const WORKSPACE = { projectId: PROJECT, workspaceId: 'W' };
const GOAL = 'G';
const TASK = { projectId: PROJECT, goalId: GOAL, taskId: 'T' };
const WORK_CALLER = {
  kind: 'work' as const, actor: { kind: 'human' as const, id: 'operator' },
  session: { projectId: PROJECT, sessionId: 'S' },
  run: { aggregateType: 'Run' as const, projectId: PROJECT, goalId: GOAL, runId: 'R' },
};

/** One public member request body; only the field under test varies. */
function action(overrides: Record<string, unknown> = {}) {
  return {
    input: {
      workspace: WORKSPACE, caller: WORK_CALLER, duty: 'executor', scope: { kind: 'task', task: TASK },
      reason: 'S7C reason', acknowledgement: null, commandId: 's7c-record-pure', fingerprint: '0'.repeat(64),
      ...overrides,
    },
  };
}

const INPUT_CASES: ReadonlyArray<readonly [string, unknown, RegExp | null]> = [
  ['a zero-byte reason', action({ reason: '' }), /1\.\.2000 UTF-8 bytes/],
  ['a one-byte reason', action({ reason: 'a' }), null],
  ['a two-thousand-byte reason', action({ reason: 'a'.repeat(2_000) }), null],
  ['a two-thousand-and-one-byte reason', action({ reason: 'a'.repeat(2_001) }), /1\.\.2000 UTF-8 bytes/],
  ['666 three-byte characters (1998 bytes)', action({ reason: '漢'.repeat(666) }), null],
  ['667 three-byte characters (2001 bytes)', action({ reason: '漢'.repeat(667) }), /1\.\.2000 UTF-8 bytes/],
  ['a Task in another project', action({ scope: { kind: 'task', task: { ...TASK, projectId: 'Q' } } }),
    /another project/],
  ['a work caller Session in another project', action({ caller: { ...WORK_CALLER,
    session: { projectId: 'Q', sessionId: 'S' } } }), /Session belongs to another project/],
  ['a work caller Run in another project', action({ caller: { ...WORK_CALLER,
    run: { ...WORK_CALLER.run, projectId: 'Q' } } }), /Run belongs to another project/],
  ['a work caller agent Run in another project', action({ caller: { ...WORK_CALLER,
    actor: { kind: 'agent', id: 'a', runRef: { ...WORK_CALLER.run, projectId: 'Q' } } } }), /agent Run belongs/],
  ['a secretary caller with a foreign request root', action({ caller: { kind: 'secretary_query',
    session: { projectId: PROJECT, sessionId: 'S' }, run: { aggregateType: 'QueryRun', projectId: PROJECT,
      workspaceId: 'W', queryJobId: 'J', runId: 'R' }, round: { aggregateType: 'QueryJob', projectId: PROJECT,
      workspaceId: 'W', queryJobId: 'J' }, requestRoot: { aggregateType: 'QueryJob', projectId: 'Q',
      workspaceId: 'W', queryJobId: 'J' } } }), /request root belongs/],
  ['a host pick caller', action({ caller: { kind: 'host_pick' } }), null],
];

describe('M-records: memberCreateInputProblem', () => {
  it.each(INPUT_CASES)('judges %s', (_label, value, expected) => {
    const problem = memberCreateInputProblem(value);
    if (expected === null) expect(problem).toBeNull();
    else expect(problem ?? '').toMatch(expected);
  });
});

let world: S7C1World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

async function pending(world: S7C1World, commandId: string, reason: string) {
  const result = await world.member.request.requestMember(world.world.humanContext(), {
    commandId, caller: { kind: 'host_pick' }, duty: 'executor', scope: { kind: 'task', task: world.tasks[0]! }, reason,
  });
  if (result.status !== 'needs_decision') throw new Error(`M-records: the request is not pending: ${JSON.stringify(result)}`);
  return result;
}

describe.each(['memory', 'sqlite'] as const)('M-records: record 1 and the lookup (%s)', backend => {
  it('round-trips record 1 through the real operation\'s stored read', async () => {
    world = await openS7C1World({ backend, adviser: false });
    const request = await pending(world, 's7c-record-1', 'S7C record 1');
    expect(await pending(world, 's7c-record-1', 'S7C record 1')).toEqual(request);
    expect(await pending(world, 's7c-record-1', 'S7C record 1')).toEqual(request);
    // The public directory read returns the operation the real request wrote; nothing reads the store.
    const stored = await world.world.platform.sessions.getSessionOperation(
      world.world.humanContext(), request.operation);
    if (stored.status !== 'ready') throw new Error(`M-records: the stored operation is not ready: ${JSON.stringify(stored)}`);
    if (stored.value.action.kind !== 'member_create') {
      throw new Error(`M-records: the stored operation is not a member creation: ${JSON.stringify(stored.value.action)}`);
    }
    const storedAction = stored.value.action;
    expect(storedAction).toMatchObject({
      kind: 'member_create',
      input: {
        workspace: { projectId: world.tasks[0]!.projectId, workspaceId: expect.any(String) },
        duty: 'executor', scope: { kind: 'task', task: world.tasks[0] }, reason: 'S7C record 1',
        acknowledgement: null, commandId: 's7c-record-1', caller: { kind: 'host_pick' },
      },
      progress: {
        stage: 'awaiting_decision',
        decision: { verdict: 'needs_decision', cardKey: expect.any(String), answer: null },
        createChild: { aggregateType: 'CoreOperation', projectId: world.tasks[0]!.projectId, operationId: expect.any(String) },
        outcome: null, noticeItemKey: null, lastRefusal: null,
      },
    });
    const roundTrip = decodeSessionOperationRecord(encodeSessionOperationRecord(stored.value));
    if (roundTrip.status !== 'decoded') throw new Error(`M-records: the stored operation does not round-trip: ${JSON.stringify(roundTrip)}`);
    expect(roundTrip.value).toEqual(stored.value);
    if (roundTrip.value.action.kind !== 'member_create') {
      throw new Error(`M-records: the round-trip operation is not a member creation: ${JSON.stringify(roundTrip.value.action)}`);
    }
    expect(roundTrip.value.action).toEqual(storedAction);
    expect(roundTrip.value.action.progress).toEqual(storedAction.progress);
    const cards = await world.member.request.readPendingMemberCards(world.world.humanContext(), { goalRef: world.goal });
    if (cards.status !== 'ready') throw new Error(`M-records: the pending cards are not ready: ${JSON.stringify(cards)}`);
    expect(cards.value).toMatchObject([{
      task: world.tasks[0],
      operation: request.operation,
      source: { kind: 'member_creation', pins: [{ ref: request.operation, revision: 2 }],
        subject: { kind: 'goal', goalRef: world.goal } },
    }]);
    expect(await world.member.request.readMemberRequestCommit(world.world.humanContext(), { commandId: 's7c-record-1' }))
      .toEqual({ status: 'committed' });
  });

  it('orders the one lookup by requestedAt through the real operations', async () => {
    world = await openS7C1World({ backend, adviser: false });
    const made: OperationRef[] = [];
    for (const label of ['a', 'b', 'c']) {
      world.world.clock.advance(1_000);
      made.push((await pending(world, `s7c-order-${label}`, `S7C order ${label}`)).operation);
    }
    const cards = await world.member.request.readPendingMemberCards(world.world.humanContext(), { goalRef: world.goal });
    if (cards.status !== 'ready') throw new Error(`M-records: the pending cards are not ready: ${JSON.stringify(cards)}`);
    expect(cards.value.map(card => card.operation)).toEqual(made);
  });
});

describe('M-records: readMemberRequestCommit', () => {
  it('answers committed, missing and unavailable from the one identity read', async () => {
    world = await openS7C1World({ backend: 'memory', adviser: false });
    await pending(world, 's7c-commit', 'S7C commit');
    const read = (commandId: string) => world!.member.request.readMemberRequestCommit(
      world!.world.humanContext(), { commandId });
    expect(await read('s7c-commit')).toEqual({ status: 'committed' });
    expect(await read('s7c-commit-absent')).toEqual({ status: 'missing' });
  });
});
