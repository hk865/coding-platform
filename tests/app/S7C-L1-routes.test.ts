/**
 * L1-routes (`book-7c.md:1373`; §3.3 item 7; DR-14): the two overlap routes over the real Host.
 *
 * A real gate is opened at a real basis through N's published owner (`platform.overlapGates`, the same owner the
 * Workflow step calls), read through `goals/overlap-gates`, refused to the real Host `system` actor by
 * `personOnly`, and released by the person through `goals/overlap-release` with its committed release read back.
 * There is no member actor input over HTTP, so none is fabricated (List B).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import { createPlatformCoreRouteBindings, dispatchCoreRoute, parseCoreRouteRequest } from '../../src/app/core-routes.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { openS7C1World, type S7C1World } from '../helpers/S7C-member-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

let world: S7C1World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

type Running = { task: TaskTriple; run: RunRef; startCursor: CommitCursor | null };

describe('L1-routes: goals/overlap-gates and goals/overlap-release', () => {
  it('reads the gates page, refuses the real system actor, and commits the person release', async () => {
    world = await openS7C1World();
    const target = world;
    const plan = target.plan;
    if (plan === null) throw new Error('L1-routes: the Goal has no adopted Plan');
    const running: Running[] = [];
    const heldRun = await target.main.taskRun(target.goal, target.tasks[0]!.taskId);
    if (heldRun !== null) {
      const execution = ready<TaskExecutionRecord>(await target.world.post('executions/read',
        plain(S6A_SCOPE, heldRun)), 'the conflicting Run');
      running.push({ task: target.tasks[0]!, run: heldRun, startCursor: execution.run.startedSince });
    }
    // The gate is N's own real record at the current plan revision; the waiting Task has no attempt yet.
    const opened = await target.world.platform.overlapGates.openOverlapGate(target.world.systemContext(), {
      goalRef: target.goal, task: target.tasks[1]!, moduleId: 's6a-core', running,
      planRevision: plan.planRevision, waitingAttempt: 'none',
    });
    if (opened.status !== 'opened') throw new Error(`L1-routes: the gate did not open: ${JSON.stringify(opened)}`);
    const gate = opened.gate;

    const read = await target.world.post('goals/overlap-gates', plain(S6A_SCOPE, {
      goalRef: target.goal, page: { limit: 10 },
    }));
    expect(read.body).toMatchObject({ status: 'ready', value: { gates: [
      expect.objectContaining({ ref: gate.ref, revision: gate.revision, basisDigest: gate.basisDigest }),
    ] } });

    const released = await target.world.post('goals/overlap-release', plain(S6A_SCOPE, {
      commandId: 's7c-l1-routes-person', gate: gate.ref, revision: gate.revision,
      reason: 'L1-routes: the person releases the gate',
    }));
    expect(released.body).toMatchObject({ status: 'released', gate: {
      revision: gate.revision + 1,
      release: { by: { kind: 'human' }, commandId: 's7c-l1-routes-person' },
    } });

    const after = await target.world.post('goals/overlap-gates', plain(S6A_SCOPE, {
      goalRef: target.goal, page: { limit: 10 },
    }));
    expect(after.body).toMatchObject({ status: 'ready', value: { gates: [
      expect.objectContaining({ ref: gate.ref, revision: gate.revision + 1,
        release: expect.objectContaining({ by: expect.objectContaining({ kind: 'human' }),
          commandId: 's7c-l1-routes-person' }) }),
    ] } });

    // The real Host system actor (a valid CoreCallContext) is refused by personOnly before any gate read; the
    // released gate keeps the person's revision and command id, so the refusal wrote nothing.
    const bindings = createPlatformCoreRouteBindings(target.world.platform);
    const refused = await dispatchCoreRoute(bindings, 'goals/overlap-release', target.world.systemContext(),
      parseCoreRouteRequest('goals/overlap-release', plain(S6A_SCOPE, {
        commandId: 's7c-l1-routes-system', gate: gate.ref, revision: gate.revision,
        reason: 'L1-routes: a system actor may not release',
      })));
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });

    const unchanged = await target.world.post('goals/overlap-gates', plain(S6A_SCOPE, {
      goalRef: target.goal, page: { limit: 10 },
    }));
    expect(unchanged.body).toMatchObject({ status: 'ready', value: { gates: [
      expect.objectContaining({ ref: gate.ref, revision: gate.revision + 1,
        release: expect.objectContaining({ commandId: 's7c-l1-routes-person' }) }),
    ] } });
  });
});
