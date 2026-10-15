/**
 * Slice 2C row 2C-17 (LE3): the line controls (L16, §3.10).
 *
 * Every fact is built through the real public services: Goals/Plans, Sessions,
 * responsible links, claims and Run phases through the real owners, Run
 * controls through the real `RunControlPort` (`controls/submit`), and the Goal
 * desired state through `setGoalControl`. Every `available` control the row
 * names is really submitted once and must commit; every `unavailable` one is
 * submitted once and must be refused with the listed code. Assertions read only
 * the public `WorkLineReadPort` and the submission results.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { LineControlV1, LineRowV1 } from '../../src/contracts/work-line.js';
import { openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';
import { waitContinuation, yieldedEvent } from '../helpers/S2C-L-runs-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

function controlOf(row: LineRowV1 | undefined, kind: LineControlV1['kind']): LineControlV1 | undefined {
  return row?.controls.find((control) => control.kind === kind);
}

describe.each(['memory', 'sqlite'] as const)('2C-17 line controls (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }
  async function rowOfHead(f: LineFixture, head: SessionRef): Promise<LineRowV1 | undefined> {
    return rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
  }

  it('2C-17 (1) a working Work line lists pause and cancel available and both submit', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g17-work', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s17-work')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);

    const row = await rowOfHead(f, head);
    expect(controlOf(row, 'pause')?.availability).toBe('available');
    expect(controlOf(row, 'cancel')?.availability).toBe('available');
    expect(controlOf(row, 'pause')?.reasonCode).toBeNull();

    const paused = await f.runs.submitResult(claim.claim, 'pause');
    expect(paused.status).toBe('committed');
  });

  it('2C-17 (1b) cancel on a working Work line is accepted', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g17-work-cancel', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s17-work-cancel')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);

    const row = await rowOfHead(f, head);
    expect(controlOf(row, 'cancel')?.availability).toBe('available');
    const cancelled = await f.runs.submitResult(claim.claim, 'cancel');
    expect(cancelled.status).toBe('committed');
  });

  it('2C-17 (2) after a queued pause a second pause is unavailable (busy) and is refused alike', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g17-stopping', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s17-stopping')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);
    const first = await f.runs.submitResult(claim.claim, 'pause');
    expect(first.status).toBe('committed');

    const row = await rowOfHead(f, head);
    const listed = controlOf(row, 'pause');
    expect(row?.status.own).toBe('working');
    expect(row?.status.markers.map((marker) => marker.kind)).toContain('stop_pending');
    expect(listed?.availability).toBe('unavailable');
    expect(listed?.reasonCode).toBe('busy');

    const second = await f.runs.submitResult(claim.claim, 'pause');
    expect(second.status).toBe('rejected');
    if (second.status !== 'rejected') throw new Error('expected a refusal');
    expect(second.code).toBe(listed?.reasonCode);
    expect(second.reason).toBe(listed?.reason);
  });

  it('2C-17 (3) a starting Work Run lists pause and cancel available', async () => {
    const f = await lineFixture();
    const head = (await f.createSession('s17-start')).ref;
    const claim = await f.claim('implement-a', head);
    expect(claim.generation).toBeGreaterThan(0);
    const row = await rowOfHead(f, head);
    expect(row?.status.own).toBe('starting');
    expect(controlOf(row, 'pause')?.availability).toBe('available');
    expect(controlOf(row, 'cancel')?.availability).toBe('available');
  });

  it('2C-17 (4) a pause before entry is accepted at once (T3d) and a resume returns it to starting (T4)', async () => {
    const f = await lineFixture();
    await f.addGoal('g17-t3d', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s17-t3d')).ref;
    const claim = await f.claim('implement-a', head);

    const applied = await f.runs.submitResult(claim.claim, 'pause');
    expect(applied.status).toBe('committed');

    const paused = await rowOfHead(f, head);
    expect(paused?.status.own).toBe('paused');
    expect(paused?.status.ownReason.code).toBe('paused_by_you');
    expect(controlOf(paused, 'resume')?.availability).toBe('available');
    expect(controlOf(paused, 'cancel')?.availability).toBe('available');

    const resumed = await f.runs.submitResult(claim.claim, 'resume');
    expect(resumed.status).toBe('committed');
    const starting = await rowOfHead(f, head);
    expect(starting?.status.own).toBe('starting');
    expect(controlOf(starting, 'pause')?.availability).toBe('available');
    expect(controlOf(starting, 'cancel')?.availability).toBe('available');
  });

  it('2C-17 (5) a starting Query lists pause and cancel unavailable (invalid)', async () => {
    const f = await lineFixture();
    const head = (await f.createSession('s17-query-start')).ref;
    const goal = await f.runs.bareGoal('g17-query-start');
    const queryRun = await f.runs.claimQuery(head, goal, 'start');
    const row = await rowOfHead(f, head);
    expect(row?.status.own).toBe('starting');
    expect(controlOf(row, 'pause')?.availability).toBe('unavailable');
    expect(controlOf(row, 'cancel')?.availability).toBe('unavailable');
    expect(controlOf(row, 'pause')?.reasonCode).toBe('invalid');
    expect(controlOf(row, 'pause')?.reason).toBe('Query 不能暂停或取消');

    const refused = await f.runs.controlsFor().submitControl(f.ctx, {
      input: { runRef: queryRun as unknown as RunRef, kind: 'pause', reason: null },
      meta: { requestId: 's2c-l-q-start-refuse', expected: [] },
    });
    expect(refused.status).toBe('rejected');
    if (refused.status !== 'rejected') throw new Error('expected a refusal');
    expect(refused.code).toBe(controlOf(row, 'pause')?.reasonCode);
  });

  it('2C-17 (6) a working Query lists pause and cancel unavailable (invalid)', async () => {
    const f = await lineFixture();
    const head = (await f.createSession('s17-query-work')).ref;
    const goal = await f.runs.bareGoal('g17-query-work');
    const queryRun = await f.runs.claimQuery(head, goal, 'work');
    await f.runs.completeConsultation(queryRun, head, 'entered', 'work');
    const row = await rowOfHead(f, head);
    expect(row?.status.own).toBe('working');
    expect(controlOf(row, 'pause')?.availability).toBe('unavailable');
    expect(controlOf(row, 'cancel')?.availability).toBe('unavailable');
    expect(controlOf(row, 'cancel')?.reasonCode).toBe('invalid');
  });

  it('2C-17 (7) a paused safe-point Run (T3a) lists resume and cancel available, and resume commits', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g17-t3a', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s17-t3a')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.pauseAtSafePoint(claim.claim);

    const paused = await rowOfHead(f, head);
    expect(paused?.status.own).toBe('paused');
    expect(controlOf(paused, 'resume')?.availability).toBe('available');
    expect(controlOf(paused, 'cancel')?.availability).toBe('available');
    const resumed = await f.runs.submitResult(claim.claim, 'resume');
    expect(resumed.status).toBe('committed');
    const working = await rowOfHead(f, head);
    expect(working?.status.own).toBe('working');
  });

  it('2C-17 (8) pausing the Goal (D-9) makes the same T3a resume unavailable (busy) while cancel stays available', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g17-d9', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s17-d9')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.pauseAtSafePoint(claim.claim);
    await f.setGoalDesired(goal.goalRef, 'paused');

    const paused = await rowOfHead(f, head);
    const listed = controlOf(paused, 'resume');
    expect(paused?.status.own).toBe('paused');
    expect(listed?.availability).toBe('unavailable');
    expect(listed?.reasonCode).toBe('busy');
    expect(controlOf(paused, 'cancel')?.availability).toBe('available');

    const refused = await f.runs.submitResult(claim.claim, 'resume');
    expect(refused.status).toBe('rejected');
    if (refused.status !== 'rejected') throw new Error('expected a refusal');
    expect(refused.code).toBe(listed?.reasonCode);
    expect(refused.reason).toBe(listed?.reason);
  });

  it('2C-17 (9) resuming the Goal makes resume available again, and cancelling it removes resume', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g17-goal-cancel', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s17-goal-cancel')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.pauseAtSafePoint(claim.claim);
    await f.setGoalDesired(goal.goalRef, 'paused');
    await f.setGoalDesired(goal.goalRef, 'active');
    const resumedGoal = await rowOfHead(f, head);
    expect(controlOf(resumedGoal, 'resume')?.availability).toBe('available');

    await f.setGoalDesired(goal.goalRef, 'cancelled');
    const cancelledGoal = await rowOfHead(f, head);
    expect(controlOf(cancelledGoal, 'resume')?.availability).toBe('unavailable');
    const refused = await f.runs.submitResult(claim.claim, 'resume');
    expect(refused.status).toBe('rejected');
    if (refused.status !== 'rejected') throw new Error('expected a refusal');
    expect(refused.code).toBe(controlOf(cancelledGoal, 'resume')?.reasonCode);
  });

  it('2C-17 (10) a yielded paused wait (T3b) lists resume and cancel available and resume commits', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g17-t3b', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s17-t3b')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, yieldedEvent(claim.claim, 't3b'),
      waitContinuation(claim.claim, { aggregateType: 'SessionMessage', projectId: head.projectId,
        workspaceId: f.base.scope.workspaceId, messageId: 's17-t3b-wait' }));
    await f.runs.submitControl(claim.claim, 'pause');

    const paused = await rowOfHead(f, head);
    expect(paused?.status.own).toBe('paused');
    expect(paused?.status.ownReason.code).toBe('paused_yielded');
    expect(controlOf(paused, 'resume')?.availability).toBe('available');
    expect(controlOf(paused, 'cancel')?.availability).toBe('available');
    const resumed = await f.runs.submitResult(claim.claim, 'resume');
    expect(resumed.status).toBe('committed');
  });

  it('2C-17 (11) a waiting-reply yielded Run lists pause and cancel available and pause commits', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g17-wait', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s17-wait')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, yieldedEvent(claim.claim, 'wait'),
      waitContinuation(claim.claim, { aggregateType: 'SessionMessage', projectId: head.projectId,
        workspaceId: f.base.scope.workspaceId, messageId: 's17-wait-msg' }));

    const row = await rowOfHead(f, head);
    expect(row?.status.own).toBe('waiting_reply');
    expect(controlOf(row, 'pause')?.availability).toBe('available');
    expect(controlOf(row, 'cancel')?.availability).toBe('available');
    const paused = await f.runs.submitResult(claim.claim, 'pause');
    expect(paused.status).toBe('committed');
  });

  it('2C-17 (12) unwind controls name slice 7 as not_yet', async () => {
    const f = await lineFixture();
    const head = (await f.createSession('s17-notyet')).ref;
    await f.claim('implement-a', head);
    const row = await rowOfHead(f, head);
    const intervene = controlOf(row, 'intervene');
    expect(intervene?.availability).toBe('not_yet');
    expect(intervene?.reasonCode).toBe('not_yet');
    expect(intervene?.reason).toContain('7');
  });
});
