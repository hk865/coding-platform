/**
 * L16: the read-only Query activity tally of one ended QueryRun.
 *
 * First row: a secretary round whose scripted model makes three real
 * `list_files` calls, one per model request and a minute apart, and then
 * answers, run by the Host's own request driver. The read answers `counted`
 * with exactly three steps, a terminal Turn and no unresolved call.
 *
 * Second row: a request round dropped before any claim. The public
 * `queries/read` shows its QueryRun ended with no execution state, so it never
 * claimed a Kernel identity: the read answers `not_entered`, never a zero
 * tally.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1 } from '../helpers/S6A-request-fixture.js';

// The frozen commit barrier (tests/helpers/S6A-commit-barrier.ts): the two
// `vi.mock`s every host-world file that uses the fixture's gates installs.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  expect(left).toEqual([]);
});

function remember(world: S6AHostWorld): S6AHostWorld {
  worlds.push(world);
  return world;
}

/** A semantic answer body: the v2 answer format's JSON, as the scripted model writes it. */
const answerText = (text: string): string =>
  JSON.stringify({ schemaVersion: 1, body: text, ideas: [], goalCardDrafts: [] });

function queued(result: RequestSubmitResultV1): { requestRoot: QueryJobRef; round: QueryJobRef } {
  if (result.status !== 'queued') throw new Error(`S6A: the request was not queued: ${JSON.stringify(result)}`);
  return { requestRoot: result.requestRoot, round: result.round };
}

const backends = ['memory', 'sqlite'] as const;

describe('the Query activity count of an ended QueryRun', () => {
  it.each(backends)('counts exactly the three tool calls of the round (%s)', async (backend) => {
    const world = remember(await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } }));
    await ensureProjectPointers(world);
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [
      { kind: 'calls', calls: [{ callId: 's6a-activity-list-1', name: 'list_files', args: { prefix: '.' } }] },
      { kind: 'calls', calls: [{ callId: 's6a-activity-list-2', name: 'list_files', args: { prefix: '.' } }] },
      { kind: 'calls', calls: [{ callId: 's6a-activity-list-3', name: 'list_files', args: { prefix: '.' } }] },
      { kind: 'text', text: answerText('S6A activity answer') },
    ]);
    // One hold per model request: each call is released a minute after the
    // previous one, so the three calls land at 10:05, 10:06 and 10:07.
    const holds = [
      await world.gates.modelRequest(a),
      await world.gates.modelRequest(a),
      await world.gates.modelRequest(a),
    ];
    const submitted = queued(await world.submit({ commandId: 's6a-activity-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A activity request', recipient: a }));
    const minutes = ['2026-10-23T10:05:00.000Z', '2026-10-23T10:06:00.000Z', '2026-10-23T10:07:00.000Z'];
    for (const [index, hold] of holds.entries()) {
      await hold.reached;
      world.clock.set(minutes[index]!);
      hold.release();
    }
    const view = await world.waitForRequest(submitted.requestRoot,
      current => current.rounds[0]?.status === 'ended', 'the round answers');
    expect(view.rounds[0]).toMatchObject({ status: 'ended', answer: 'S6A activity answer', session: a.ref });
    const query = await readQuery(world.ag2b, submitted.round);
    // The QueryRun ref comes from the public `queries/read`, as the backfill
    // reads it; the count then reads the Kernel only.
    const counted = await world.platform.runtime.countQueryActivity!(world.humanContext(), { queryRunRef: query.run.ref });
    expect(counted).toMatchObject({ status: 'ready', value: { kind: 'facts', facts: {
      status: 'counted',
      totals: { steps: 3 },
      window: { turnTerminal: true, unresolvedCalls: 0 },
    } } });
  }, 120_000);

  it.each(backends)('answers not_entered for a request round dropped before any claim (%s)', async (backend) => {
    const world = remember(await openS6AHostWorld({ backend }));
    await ensureProjectPointers(world);
    const b = await world.createSecretary('b');
    // The request driver is off: the round waits on B unclaimed until the drop ends it.
    const submitted = queued(await world.submit({ commandId: 's6a-activity-drop-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A activity dropped request', recipient: b }));
    expect(await world.drop({ commandId: 's6a-activity-drop-2', round: submitted.round })).toMatchObject({ status: 'routed' });
    // A drop ends an unstarted round: the round closes `cancelled`/`dropped`, its QueryRun `not_entered`.
    const query = await readQuery(world.ag2b, submitted.round);
    expect(query.job.job.closeReason).toMatchObject({ code: 'cancelled', detail: 'dropped' });
    expect(query.run.run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
    expect(query.run.run.endedAt).not.toBeNull();
    expect(query.run.run.executionState).toBeUndefined();
    const counted = await world.platform.runtime.countQueryActivity!(world.humanContext(), { queryRunRef: query.run.ref });
    expect(counted).toEqual({ status: 'ready', value: { kind: 'not_entered' } });
  }, 120_000);
});
