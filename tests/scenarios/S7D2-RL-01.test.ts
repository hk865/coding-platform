/**
 * RL-01 (`7d2-start-rulings.v4.md:8839` as the O1b run sheet `run-7d2-o1b.md:48` modifies it; book `:1304`): the
 * first workspace registration of a fresh project births one `start_lines` operation, and the Host's lifecycle
 * passes open the secretary, adviser and scribe lines from it, across a Host restart on the same store.
 *
 * World: `openS7D2BirthWorld` (tests/helpers/S7D2-role-line-world.ts), run twice (T8, rework-1). The registration
 * commit of the world's seed births the operation; the first Host's background pass is stopped once — after the
 * secretary step's `created` commit, or before the commit that moves that step past `registered` — and crashed, and
 * the restarted Host's start-up pass finishes the operation in one call (C1). SQLite only: each stop is a Host
 * restart on the same store, which needs the SQLite directory (the host world's `crash()`).
 *
 * Expected (from the row, hand-counted): `role-lines/operations` shows the three steps at the stop with the secretary
 * `created`, or `registered`, and at the end exactly one operation with outer `phase:'completed'`,
 * `actionPhase:'done'`, the three steps `done` and `result:{status:'done',reason:null}`; the three lines
 * (`sessions/find` on the project target, `sessions/read` of each) each have one open `responsible` `{kind:'project'}`
 * link and the role facts `{openedBy:'start_lines',creator:{kind:'platform'},originOperation:<the start_lines
 * operation>}`; `role-lines/allocation` counts each line once as a holder of its duty with no reservation, so the
 * restart made no second line and no second reservation. Hand count: 3 steps done, 3 lines, 3 holders (3/3). The three
 * role facts are asserted on `sessions/read`'s `roleFacts` (O2b's half, revision 11-03 item 2; v4 :8839, :3107); their
 * named mutation is `readSession`'s `roleFacts` always `null` (v4 :3100), which turns that assertion red on each card.
 *
 * Named mutation: skip the `registered` step marker (mark `created`, then `done`): the `registered` stop reads
 * `created`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import {
  openS7D2BirthWorld, openTargetsOf, startLinesOf, type S7D2BirthRun, type S7D2OpeningDuty, type S7D2RoleLineWorld,
} from '../helpers/S7D2-role-line-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const runs: S7D2BirthRun[] = [];
afterEach(async () => {
  // The world's close lets its held commit go before it closes the abandoned Host.
  await Promise.allSettled(runs.splice(0).map(run => run.world.close()));
  expect(commitBarrier.reset()).toEqual([]);
});

const DUTIES: readonly S7D2OpeningDuty[] = ['secretary', 'adviser', 'scribe'];
const statesOf = (rows: S7D2BirthRun['atStop']) =>
  startLinesOf(rows)?.steps.map(step => [step.key, step.state]) ?? null;

/** The end of the birth: one operation, completed, every step done; three lines, each its duty's one holder. */
async function expectEnd(world: S7D2RoleLineWorld): Promise<void> {
  const rows = await world.operations();
  expect(rows).toHaveLength(2);
  expect(startLinesOf(rows)).toMatchObject({
    action: 'role_line', phase: 'completed', actionPhase: 'done',
    steps: [{ key: 'secretary', state: 'done' }, { key: 'adviser', state: 'done' }, { key: 'scribe', state: 'done' }],
    result: { status: 'done', reason: null },
  });
  // The secretary step's registration commit also bore the project's one cold start. This world adopted its
  // governance first, so no secretary round is an initial-format answer and the cold start waits at `candidates`.
  const projectId = world.startLines.projectId;
  const coldStartRef = { aggregateType: 'CoreOperation', projectId, operationId: `cold_start:${projectId}` };
  expect(rows.filter(row => row.operation.operationId === coldStartRef.operationId)).toEqual([{
    operation: coldStartRef, action: 'role_line', phase: 'running', actionPhase: 'candidates', steps: [],
    result: null, lastCompleted: null, candidate: null, pendingRegions: [], explorations: [], batchRefs: [],
    route: null, baseCatalogPin: null, depth: 2,
  }]);

  // The three lines, and only they, are responsible for the project: one open project link each.
  const lineIds = DUTIES.map(duty => world.lines[duty].ref.sessionId);
  expect((await world.findByTarget(world.targets.project)).map(card => card.record.ref.sessionId).sort())
    .toEqual([...lineIds].sort());
  for (const duty of DUTIES) {
    const card = await world.readCard(world.lines[duty]);
    expect(card.record.lifecycle).toBe('active');
    expect(openTargetsOf(card)).toEqual([world.targets.project]);
    expect(card.roleFacts).toMatchObject({ openedBy: 'start_lines', creator: { kind: 'platform' },
      originOperation: world.startLines });
  }

  // Each line is its duty's one holder and no reservation is left: 3/3.
  const allocation = await world.allocation();
  for (const duty of DUTIES) {
    expect(allocation.duties[duty].holders.map(holder => holder.session.sessionId))
      .toEqual([world.lines[duty].ref.sessionId]);
    expect(allocation.duties[duty].reservations).toEqual([]);
  }
  expect(DUTIES.flatMap(duty => allocation.duties[duty].holders)).toHaveLength(3);
}

describe('RL-01', () => {
  it('RL-01 (sqlite): the first registration births one start_lines operation that opens three lines across '
    + 'a restart, stopped at created and at registered', async () => {
    const created = await openS7D2BirthWorld({ backend: 'sqlite', stopAt: 'created' });
    runs.push(created);
    expect(statesOf(created.atStop)).toEqual([['secretary', 'created'], ['adviser', 'pending'], ['scribe', 'pending']]);
    await expectEnd(created.world);
    await created.world.close();
    runs.splice(runs.indexOf(created), 1);

    const registered = await openS7D2BirthWorld({ backend: 'sqlite', stopAt: 'registered' });
    runs.push(registered);
    expect(statesOf(registered.atStop))
      .toEqual([['secretary', 'registered'], ['adviser', 'pending'], ['scribe', 'pending']]);
    await expectEnd(registered.world);
  }, 300_000);
});
