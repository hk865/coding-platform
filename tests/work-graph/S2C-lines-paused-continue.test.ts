/**
 * Slice 2C row 2C-39 (LE3, L16, §3.10, §3.2 T0/T3c): a paused-interrupted
 * (RUN-24) Task this line now owns gives exactly one `continue` control, pinned
 * to the Task and the Run named by `phaseCause.detail.afterRunRef`, and the
 * projection matches the real `tasks/requeue` preconditions.
 *
 * Everything is built through the real public services: the Goal/Plan, the
 * Session, the responsible link, the WorkGraph claim and entry, the pause
 * control, and the real Host-takeover reconcile (`reconcileRun`). Assertions
 * read only the public `WorkLineReadPort` (and the real Goal/Run readers to
 * hand-compute the expected pins).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { LineControlV1, LineRowV1 } from '../../src/contracts/work-line.js';
import { failingReadMany, openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

function controlOf(row: LineRowV1 | undefined, kind: LineControlV1['kind']): LineControlV1 | undefined {
  return row?.controls.find((control) => control.kind === kind);
}

describe.each(['memory', 'sqlite'] as const)('2C-39 paused-interrupted continue (%s)', (kind) => {
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

  /** A real RUN-24 line: enter a Task, queue a pause, then the Host-takeover reconcile (RUN-24). */
  async function run24(f: LineFixture, suffix: string): Promise<{ head: SessionRef; runRef: RunRef; claim: TaskClaim }> {
    const goal = await f.addGoal(`g39-${suffix}`, [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession(`s39-${suffix}`)).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.submitPause(claim.claim);
    const run = await f.runs.reconcileInterrupt(claim.claim);
    return { head, runRef: run.ref, claim: claim.claim };
  }

  it('2C-39 (1) a RUN-24 line lists one continue pinned to its Task and afterRun', async () => {
    const f = await lineFixture();
    const { head, runRef, claim } = await run24(f, 'one');

    const row = await rowOfHead(f, head);
    expect(row?.status.own).toBe('paused');
    expect(row?.status.ownReason).toMatchObject({
      code: 'paused_interrupted', params: { by: 'you', goal: 'active' },
    });

    const continues = row!.controls.filter((control) => control.kind === 'continue');
    expect(continues).toHaveLength(1);
    const cont = continues[0]!;
    expect(cont).toMatchObject({
      availability: 'available', route: 'tasks/requeue', reasonCode: null,
      target: { task: { taskId: 'w' }, runRef: { runId: runRef.runId } },
    });
    // The pins are the versions the real `tasks/requeue` submission must carry:
    // the Goal, then the afterRun, at their current revisions (hand-read).
    const goal = await f.base.plans.queryGoal(f.ctx, {
      aggregateType: 'Goal', projectId: f.base.scope.projectId, goalId: 'g39-one',
    });
    if (goal.status !== 'ready') throw new Error('the Goal must be readable');
    const runRevision = (await f.runs.pin(claim)).revision;
    expect(cont.pins).toEqual([
      { ref: { aggregateType: 'Goal', projectId: f.base.scope.projectId, goalId: 'g39-one' },
        revision: goal.value.goal.revision },
      { ref: runRef, revision: runRevision },
    ]);

    for (const kind of ['pause', 'resume', 'cancel'] as const) {
      expect(controlOf(row, kind), `the RUN-24 line lists no ${kind}`).toBeUndefined();
    }
  });

  it('2C-39 (2) a paused Goal makes continue unavailable (busy), and resuming it restores availability', async () => {
    const f = await lineFixture();
    const goalRef = { aggregateType: 'Goal', projectId: f.base.scope.projectId, goalId: 'g39-goal' } as const;
    const { head } = await run24(f, 'goal');
    await f.setGoalDesired(goalRef, 'paused');

    const pausedRow = await rowOfHead(f, head);
    expect(pausedRow?.status.own).toBe('paused');
    expect(pausedRow?.status.ownReason).toMatchObject({
      code: 'paused_interrupted', params: { by: 'you', goal: 'paused' },
    });
    const refused = controlOf(pausedRow, 'continue');
    expect(refused?.availability).toBe('unavailable');
    expect(refused?.reasonCode).toBe('busy');

    await f.setGoalDesired(goalRef, 'active');
    const activeRow = await rowOfHead(f, head);
    expect(controlOf(activeRow, 'continue')?.availability).toBe('available');
  });

  it('2C-23 a kernel_turn_open retired line still offers ask as available', async () => {
    const f = await lineFixture();
    const { head } = await run24(f, 'ask');
    const row = await rowOfHead(f, head);
    expect(row?.status.own).toBe('paused');
    const ask = controlOf(row, 'ask');
    expect(ask?.availability).toBe('available');
    expect(ask?.reasonCode).toBeNull();
  });

  // Review item 2 / B4: `problem` must be settled AFTER `readPausedTaskFacts`.
  // Fail the requeue window's Goal read (the canonical requeue window) and the
  // row must report the incomplete fact, keep the Task, and offer no continue.
  it('B4 (review item 2) a failed paused-task requeue-window read keeps the task and reports the problem', async () => {
    const f = await lineFixture();
    const { head } = await run24(f, 'b4');
    const goalKey = canonicalRefKey({ aggregateType: 'Goal', projectId: f.base.scope.projectId, goalId: 'g39-b4' });
    const wrapped = failingReadMany(f.records, (keys) => keys.includes(goalKey));
    const list = ready(await f.readerWith(wrapped.records).listWorkLines(f.ctx, { workspace: f.base.scope }));
    const row = rowOf(list.rows, head);
    expect(row?.problem?.code).toBe('unavailable');
    expect(row?.problem?.reason).toContain('injected readMany failure');
    expect(row?.status.bucket).toBeNull();
    expect(row?.responsibleNow.map((task) => task.task.taskId)).toContain('w');
    expect(row?.controls.filter((control) => control.kind === 'continue')).toHaveLength(0);
  });
});
