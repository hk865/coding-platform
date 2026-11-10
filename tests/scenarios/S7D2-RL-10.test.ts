/**
 * RL-10 (`book-7d2-frozen.md:1313`; `7d2-start-rulings.v4.md:8848`): the running cap's one common start gate.
 *
 * The world has adviser running cap 4 with three occupied adviser QueryRuns, one prepared Work Run
 * (`starting`/`authorized` through `workflow/advance`), one prepared adviser Query and one prepared secretary
 * Query (`tests/helpers/S7D2-admission-world.ts`). Hand count: adviser 3 occupied + 1 entrant = 4 against cap 4.
 *
 * DR/A1b-07 and the lead's RL-10 answer (a): the race half runs on memory only, with three entered occupants; the
 * restart half runs on SQLite only, because a Host restart on the same store needs the SQLite directory. Its builder
 * makes the one result-unknown occupant through the world's real `crash()`; the row then proves that the unknown and
 * the entered calls are both counted, that the restart re-runs neither, and that the waiter keeps waiting. The two
 * starters go in a fixed order there (Work, then Query): the race is the memory row's. After the Query waits, a second
 * same-store restart (review A1b-R1-03): every holder's call is held at the tool gate, so all four come back `unknown`
 * and still fill the cap, and start-up keeps the marked waiter (`startup-reconcile.ts` step 3's Q-wait branch).
 *
 * Named mutations: admit at prepare instead of the common start (both prepared starters enter); drop start-up's
 * Q-wait branch (the second restart settles the waiter and its marker is gone).
 *
 * The public-start row (review A1b-R1-01, book :431, :457): a Work started through `executions/start` at the full cap
 * answers `waiting`, and when a seat frees its Goal's Workflow starts it; without the route's Goal wake nothing does.
 *
 * The round-end row (lead, 11-03): a secretary request round refused at the cap is started by the admission drain
 * when the occupant frees the seat; its end must still reach the round-end trigger, so a too-long round starts the
 * automatic handoff (observed as in `tests/app/S6A-secretary-selection-usage.test.ts`). The request driver's refused
 * start is held after its marker commit, so its advance stays in flight on that line and it cannot end the round.
 *
 * The 'off' row (lead, 11-03, decision 97-9): with `resumeOnStartup: 'off'` a restart starts nothing, so the kept
 * marked round is not drained; it keeps waiting with no model request. The restart's `wakeRounds` is counted through
 * a pass-through on `runStartupReconcile` (review A1b-R2-01). Named mutation: drain at start-up under 'off'.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as startupReconcileModule from '../../src/app/startup-reconcile.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { usageOf } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  openS7D2RunningWorld, openS7D2SecretaryCapWorld, type S7D2Starter,
} from '../helpers/S7D2-admission-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: { close(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

type ExecutionRead = { value?: { run?: { status?: string; executionAuthorization?: { phase?: string };
  run?: { executionState?: { phase?: string; admissionWait?: string | null } } } } };

/** The persisted phase the running count reads: the Run's authorization phase or the Query's execution phase. */
function phaseOf(starter: S7D2Starter, read: Record<string, unknown>): string | undefined {
  const run = (read as ExecutionRead).value?.run;
  return starter.kind === 'work' ? run?.executionAuthorization?.phase : run?.run?.executionState?.phase;
}

function waitRefOf(starter: S7D2Starter): unknown {
  return starter.kind === 'work' ? starter.runRef : starter.queryRunRef;
}

/** The waiter's kept wait: the Run stays `starting`/`authorized`; the Query stays `prepared` with its marker. */
function expectWaiting(starter: S7D2Starter, read: Record<string, unknown>): void {
  const run = (read as ExecutionRead).value?.run;
  if (starter.kind === 'work') {
    expect(run).toMatchObject({ status: 'starting', executionAuthorization: { phase: 'authorized' } });
  } else {
    expect(run?.run?.executionState).toMatchObject({ phase: 'prepared', admissionWait: 'running_cap' });
  }
}

describe('RL-10: the running cap has one common start gate', () => {
  it('one adviser start enters, the other waits with running_cap, and the secretary group enters', async () => {
    const world = await openS7D2RunningWorld({ backend: 'memory' });
    worlds.push(world);
    const gates = {
      work: await world.world.gates.modelRequest(world.work.session),
      query: await world.world.gates.modelRequest(world.query.session),
    };
    const workStart = world.start(world.work);
    const queryStart = world.start(world.query);
    workStart.catch(() => undefined);
    queryStart.catch(() => undefined);
    // The entrant's start holds at its first model request; the waiter's start answers. Both at their model
    // request means both entered.
    const first = await Promise.race([
      workStart.then(body => ({ waiter: world.work, entrant: world.query, body })),
      queryStart.then(body => ({ waiter: world.query, entrant: world.work, body })),
      Promise.all([gates.work.reached, gates.query.reached]).then(() => null),
    ]);
    expect(first, 'both adviser starters entered').not.toBeNull();
    const { waiter, entrant, body } = first!;
    expect(body).toEqual({ status: 'waiting', reason: 'running_cap', ref: waitRefOf(waiter) });
    await (entrant === world.work ? gates.work : gates.query).reached;
    expect(['entering', 'entered']).toContain(phaseOf(entrant, await world.read(entrant)));
    expectWaiting(waiter, await world.read(waiter));
    const occupied = await Promise.all(world.occupied.map(starter => world.read(starter)));
    expect(occupied.map((read, index) => phaseOf(world.occupied[index]!, read))).toEqual(['entered', 'entered', 'entered']);

    // The secretary group is independent: it enters although the adviser group is at 4.
    const secretaryGate = await world.world.gates.modelRequest(world.secretary.session);
    world.start(world.secretary).catch(() => undefined);
    await secretaryGate.reached;
    expect(['entering', 'entered']).toContain(phaseOf(world.secretary, await world.read(world.secretary)));
  });

  it('a public Work start at the cap waits, and the freed seat starts it through its Goal (review A1b-R1-01)', async () => {
    const world = await openS7D2RunningWorld({ backend: 'memory' });
    worlds.push(world);
    const queryGate = await world.world.gates.modelRequest(world.query.session);
    world.start(world.query).catch(() => undefined);
    await queryGate.reached;                                    // 3 occupants + the Query = 4: the cap is full
    const workGate = await world.world.gates.modelRequest(world.work.session);
    expect(await world.start(world.work)).toEqual({ status: 'waiting', reason: 'running_cap', ref: waitRefOf(world.work) });
    queryGate.release();                                        // the Query answers and frees its seat
    const timeout = new Promise(resolve => { setTimeout(resolve, 15_000, 'still waiting'); });
    expect(await Promise.race([workGate.reached.then(() => 'started'), timeout])).toBe('started');
    expect(phaseOf(world.work, await world.read(world.work))).toBe('entered');
  });

  it('a request round the admission drain starts records its end, so the too-long round still hands off', async () => {
    const { world, secretary, occupant } = await openS7D2SecretaryCapWorld({ backend: 'memory' });
    worlds.push(world);
    await world.scripted.script(secretary, [{ kind: 'text', usage: usageOf(500_000),
      text: JSON.stringify({ schemaVersion: 1, body: 'S7D2 round answer', ideas: [], goalCardDrafts: [] }) }]);
    // The request driver's refused start is held after its marker commit: its advance stays in flight on the line,
    // so that driver neither starts nor observes the round, and only the admission drain starts it.
    const marker = commitBarrier.holdAfter(byIdentityPrefix('r5b-query-execution:waiting:'), 'the round wait marker');
    const handoff = commitBarrier.hold(byIdentityPrefix('handoff.accept:'), 'the automatic handoff accept');
    try {
      const submitted = await world.submit({ commandId: 's7d2-round', goalId: world.goals.first.goalId,
        text: 'S7D2 round', recipient: secretary });
      if (submitted.status !== 'queued') throw new Error(`S7D2: the round was not queued: ${JSON.stringify(submitted)}`);
      await marker.reached;
      occupant.release();                                         // the occupant answers and frees the seat
      await world.waitForRequest(submitted.requestRoot, view => view.rounds[0]?.status === 'ended', 'the round ends');
      const timeout = new Promise(resolve => { setTimeout(resolve, 15_000, 'no handoff'); });
      expect(await Promise.race([handoff.reached.then(() => 'handoff'), timeout])).toBe('handoff');
    } finally {
      marker.release();
      handoff.release();
    }
  });
});

describe('RL-10 SQLite only: Host restart', () => {
  it('after a same-store crash/reopen the unknown and the entered calls are counted, none re-runs and the waiter waits', async () => {
    const world = await openS7D2RunningWorld({ backend: 'sqlite' });
    worlds.push(world);
    const [unknown] = world.occupied;
    // The restart left the crashed occupant unknown and counted; the new Host entered the other two.
    expect(phaseOf(unknown!, await world.read(unknown!))).toBe('unknown');

    const workTool = await world.world.gates.toolCall(world.work.session, 'list_files');
    world.start(world.work).catch(() => undefined);
    await workTool.reached;
    // 1 unknown + 2 entered + the Work Run = 4: the Query meets the full gate.
    expect(await world.start(world.query)).toEqual({ status: 'waiting', reason: 'running_cap', ref: waitRefOf(world.query) });
    expectWaiting(world.query, await world.read(world.query));
    expect(phaseOf(world.work, await world.read(world.work))).toBe('entered');
    const occupied = await Promise.all(world.occupied.map(starter => world.read(starter)));
    expect(occupied.map((read, index) => phaseOf(world.occupied[index]!, read))).toEqual(['unknown', 'entered', 'entered']);
    // The unknown call was never re-run: its one model request is the crashed Host's, its second reply unserved.
    expect(await world.world.scripted.requests(unknown!.session)).toHaveLength(1);
    expect(await world.world.scripted.pending(unknown!.session)).toBe(1);

    // A second same-store restart with the waiter already waiting: every holder's call has no result, so all four
    // are `unknown` and still counted; start-up keeps the marked waiter for the drain, which meets the full gate.
    await world.world.crash();
    expectWaiting(world.query, await world.read(world.query));
    const holders = [...world.occupied, world.work];
    const after = await Promise.all(holders.map(starter => world.read(starter)));
    expect(after.map((read, index) => phaseOf(holders[index]!, read))).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    for (const starter of holders) expect(await world.world.scripted.requests(starter.session)).toHaveLength(1);
    expect(await world.world.scripted.requests(world.query.session)).toHaveLength(0);
  });

  it("with resumeOnStartup 'off' a restart leaves the marked request round waiting: nothing starts it", async () => {
    const { world, secretary } = await openS7D2SecretaryCapWorld({ backend: 'sqlite' });
    worlds.push(world);
    await world.setResumeOnStartup(false);
    // The marker is held after its commit, so the old Host's request driver is quiet when the Host crashes.
    const marker = commitBarrier.holdAfter(byIdentityPrefix('r5b-query-execution:waiting:'), 'the round wait marker');
    // A3 on the reconcile's own input: the new Host's real `wakeRounds` (the admission drain entry), counted and passed
    // through. The Host awaits the reconcile and the reconcile awaits this call, so the count is final at the restart.
    let wakes = 0;
    const real = startupReconcileModule.runStartupReconcile;
    const reconcile = vi.spyOn(startupReconcileModule, 'runStartupReconcile').mockImplementation(deps =>
      real({ ...deps, forScope: scope => {
        const scoped = deps.forScope(scope);
        return scoped === null ? null
          : { ...scoped, wakeRounds: async target => { wakes += 1; await scoped.wakeRounds?.(target); } };
      } }));
    try {
      const submitted = await world.submit({ commandId: 's7d2-off-round', goalId: world.goals.first.goalId,
        text: 'S7D2 round', recipient: secretary });
      if (submitted.status !== 'queued') throw new Error(`S7D2: the round was not queued: ${JSON.stringify(submitted)}`);
      await marker.reached;
      // The restart frees the occupant (Q-04), so a start would be admitted; with 'off' start-up makes none.
      await world.crash();
      expect(wakes, 'the restart woke the admission drain').toBe(0);
      const read = (await world.post('queries/read', plain(S6A_SCOPE, submitted.round))).body as ExecutionRead;
      expect(read.value?.run?.run?.executionState).toMatchObject({ phase: 'prepared', admissionWait: 'running_cap' });
      expect(await world.scripted.requests(secretary)).toHaveLength(0);
    } finally {
      reconcile.mockRestore();
      marker.release();
    }
  });
});
