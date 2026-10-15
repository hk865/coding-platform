/**
 * Slice 2C row 2C-04 (LE3): the done-evidence boundary (L1a truth table).
 *
 * Every fact is built through the real public services: Goals/Plans through
 * `createGoalService`/`createPlanService`, Sessions through the real
 * `SessionDirectoryPort`, responsible links through `linkSessionWork`, terminal
 * closes through `closeTerminalResponsibility`, transfers through
 * `transferSessionResponsibility`, and archives through `archiveSession`. The
 * only Doubles are the two storage wrappers that inject a read failure or a
 * budget. Assertions read only the public `WorkLineReadPort`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import { createWorkLineReader } from '../../src/core/work-graph/views/work-line-reader.js';
import { lineReaderOver, openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

function taskTarget(task: TaskTriple): WorkLinkTarget {
  return { kind: 'task', ref: task };
}

describe.each(['memory', 'sqlite'] as const)('2C-04 done evidence (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('2C-04 (1) a cancelled never-run task with an open link is done (DE1) and stays done after a terminal close (DE2)', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g04-de1', [{ taskId: 'x-cancel', title: 'Cancelled task', disposition: 'cancelled' }]);
    const task = goal.tasks['x-cancel']!;
    const head = (await f.createSession('s04-de1')).ref;
    await f.link(head, taskTarget(task), 'responsible', true);

    const before = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(before?.status.own).toBe('done');
    expect(before?.status.ownReason.code).toBe('done_tasks');
    expect(before?.status.doneEvidence).toBe('complete');

    await f.closeTerminal(head, taskTarget(task));
    const after = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(after?.status.own).toBe('done');
    expect(after?.status.doneEvidence).toBe('complete');
  });

  it('2C-04 (2) a deferred task is standby with task_deferred', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g04-defer', [{ taskId: 'x-defer', title: 'Deferred task', disposition: 'deferred' }]);
    const head = (await f.createSession('s04-defer')).ref;
    await f.link(head, taskTarget(goal.tasks['x-defer']!), 'responsible', true);
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.ownReason.code).toBe('task_deferred');
  });

  it('2C-04 (3) a transferred, unfinished task does not block the done evidence', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g04-tr-block', [
      { taskId: 'x-done', title: 'Done task', disposition: 'cancelled' },
      { taskId: 'x-moved', title: 'Moved task' },
    ]);
    const head = (await f.createSession('s04-tr-head')).ref;
    const other = (await f.createSession('s04-tr-other')).ref;
    await f.link(head, taskTarget(goal.tasks['x-done']!), 'responsible', true);
    await f.link(head, taskTarget(goal.tasks['x-moved']!), 'responsible', true);
    await f.transfer(head, other, taskTarget(goal.tasks['x-moved']!));
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('done');
    expect(row?.status.doneEvidence).toBe('complete');
    expect(row?.responsibleNow.map((brief) => brief.task.taskId)).toEqual(['x-done']);
  });

  it('2C-04 (4) a task transferred away and finished elsewhere is not this line\u2019s done (DE4)', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g04-tr-elsewhere', [{ taskId: 'x-moved', title: 'Moved task' }]);
    const head = (await f.createSession('s04-else-head')).ref;
    const other = (await f.createSession('s04-else-other')).ref;
    await f.link(head, taskTarget(goal.tasks['x-moved']!), 'responsible', true);
    await f.transfer(head, other, taskTarget(goal.tasks['x-moved']!));
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.ownReason.code).toBe('idle');
    expect(row?.status.doneEvidence).toBe('complete');
  });

  it('2C-04 (5) more than 21 closed links with no positive evidence is done_unproven (DE5)', async () => {
    const f = await lineFixture();
    const specs = Array.from({ length: 22 }, (_, index) => ({
      taskId: `t${String(index)}`, title: `Task ${String(index)}`,
      ...(index === 0 ? { disposition: 'cancelled' as const } : {}),
    }));
    const goal = await f.addGoal('g04-over21', specs);
    const head = (await f.createSession('s04-over21-head')).ref;
    const other = (await f.createSession('s04-over21-other')).ref;
    await f.link(head, taskTarget(goal.tasks['t0']!), 'responsible', true);
    await f.closeTerminal(head, taskTarget(goal.tasks['t0']!));           // oldest: terminal
    for (let index = 1; index < 22; index += 1) {
      await f.link(head, taskTarget(goal.tasks[`t${String(index)}`]!), 'responsible', true);
      await f.transfer(head, other, taskTarget(goal.tasks[`t${String(index)}`]!));
    }
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.ownReason.code).toBe('done_unproven');
    expect(row?.status.doneEvidence).toBe('incomplete');
  });

  it('2C-04 (5b) exactly 21 transfer closes is a plain standby (DE4)', async () => {
    const f = await lineFixture();
    const specs = Array.from({ length: 21 }, (_, index) => ({ taskId: `t${String(index)}`, title: `Task ${String(index)}` }));
    const goal = await f.addGoal('g04-exact21', specs);
    const head = (await f.createSession('s04-exact21-head')).ref;
    const other = (await f.createSession('s04-exact21-other')).ref;
    for (let index = 0; index < 21; index += 1) {
      await f.link(head, taskTarget(goal.tasks[`t${String(index)}`]!), 'responsible', true);
      await f.transfer(head, other, taskTarget(goal.tasks[`t${String(index)}`]!));
    }
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.ownReason.code).toBe('idle');
    expect(row?.status.doneEvidence).toBe('complete');
  });

  it('2C-04 (5c) 22 closes with the newest terminal is done (DE2)', async () => {
    const f = await lineFixture();
    const specs = Array.from({ length: 22 }, (_, index) => ({
      taskId: `t${String(index)}`, title: `Task ${String(index)}`,
      ...(index === 21 ? { disposition: 'cancelled' as const } : {}),
    }));
    const goal = await f.addGoal('g04-newest-terminal', specs);
    const head = (await f.createSession('s04-newest-head')).ref;
    const other = (await f.createSession('s04-newest-other')).ref;
    for (let index = 0; index < 21; index += 1) {
      await f.link(head, taskTarget(goal.tasks[`t${String(index)}`]!), 'responsible', true);
      await f.transfer(head, other, taskTarget(goal.tasks[`t${String(index)}`]!));
    }
    await f.link(head, taskTarget(goal.tasks['t21']!), 'responsible', true);
    await f.closeTerminal(head, taskTarget(goal.tasks['t21']!));
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('done');
    expect(row?.status.doneEvidence).toBe('complete');
  });

  it('2C-04 (6) a link closed through sessions/link has no closure mode and is done_unproven (DE5)', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g04-unknown', [{ taskId: 'x-unknown', title: 'Unknown close' }]);
    const head = (await f.createSession('s04-unknown-head')).ref;
    await f.link(head, taskTarget(goal.tasks['x-unknown']!), 'responsible', true);
    await f.link(head, taskTarget(goal.tasks['x-unknown']!), 'responsible', false);
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.ownReason.code).toBe('done_unproven');
    expect(row?.status.doneEvidence).toBe('incomplete');
  });

  it('2C-04 (7) the read budget never overturns an open terminal link (DE1)', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g04-budget-de1', [{ taskId: 'x-open', title: 'Open terminal', disposition: 'cancelled' }]);
    const head = (await f.createSession('s04-budget-de1')).ref;
    await f.link(head, taskTarget(goal.tasks['x-open']!), 'responsible', true);
    const reader = lineReaderOver(f.base, f.records, () => 'executor', 0);
    const row = rowOf(ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('done');
    expect(row?.status.doneEvidence).toBe('complete');
  });

  it('2C-04 (7b) a terminal already read stands even when the budget runs out (DE2)', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g04-budget-de2', [
      { taskId: 'x-a', title: 'A', disposition: 'cancelled' },
      { taskId: 'x-b', title: 'B', disposition: 'cancelled' },
    ]);
    const head = (await f.createSession('s04-budget-de2')).ref;
    await f.link(head, taskTarget(goal.tasks['x-a']!), 'responsible', true);
    await f.closeTerminal(head, taskTarget(goal.tasks['x-a']!));
    await f.link(head, taskTarget(goal.tasks['x-b']!), 'responsible', true);
    await f.closeTerminal(head, taskTarget(goal.tasks['x-b']!));
    const reader = lineReaderOver(f.base, f.records, () => 'executor', 3);
    const row = rowOf(ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('done');
    expect(row?.status.doneEvidence).toBe('complete');
  });

  it('2C-04 (7c) transfer closes with the budget exhausted are done_unproven (DE5)', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g04-budget-tr', [
      { taskId: 'x-a', title: 'A' }, { taskId: 'x-b', title: 'B' }, { taskId: 'x-c', title: 'C' },
    ]);
    const head = (await f.createSession('s04-budget-tr')).ref;
    const other = (await f.createSession('s04-budget-tr-other')).ref;
    for (const taskId of ['x-a', 'x-b', 'x-c']) {
      await f.link(head, taskTarget(goal.tasks[taskId]!), 'responsible', true);
      await f.transfer(head, other, taskTarget(goal.tasks[taskId]!));
    }
    const reader = lineReaderOver(f.base, f.records, () => 'executor', 2);
    const row = rowOf(ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.ownReason.code).toBe('done_unproven');
    expect(row?.status.doneEvidence).toBe('incomplete');
    // L1b: the done-evidence part that stopped on the budget is reported.
    expect(row?.status.partialParts).toContainEqual({ part: 'done_evidence', reason: 'history_budget' });
  });

  it('2C-04 (7d) an oversized batch latches the budget so the later done evidence is partial too (L1b)', async () => {
    const f = await lineFixture();
    const head = (await f.createSession('s04-budget-latch')).ref;
    // A retired, executor, unoccupied line: written anchors -> undelivered -> done evidence.
    await f.runs.retire(head, 'missing');
    const reader = createWorkLineReader({
      ...f.deps,
      historyReadBudget: 3,
      // The undelivered reader is the documented L1b factory seam: its first read
      // is a 3-record batch that does not fit the remaining allowance.
      undeliveredRepliesFor: (records) => async () => {
        const read = await records.readMany(['s2c-latch-a', 's2c-latch-b', 's2c-latch-c']);
        if (read.status !== 'ready') return { status: 'rejected', code: 'unavailable', reason: read.reason };
        return { status: 'ready', value: { items: [], nextCursor: null, sourceCursor: 'c0000000000' as CommitCursor } };
      },
    });
    const row = rowOf(ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row).toBeDefined();
    expect(row?.status.partialParts.some((part) => part.part === 'undelivered')).toBe(true);
    // Sticky: once the oversized batch is denied, the following done evidence is
    // rejected as well (a non-latched budget would still allow its two small reads).
    expect(row?.status.partialParts).toContainEqual({ part: 'done_evidence', reason: 'history_budget' });
  });

  it('2C-04 (8) 21 terminal closes archived is archived-done (DE2)', async () => {
    const f = await lineFixture();
    const specs = Array.from({ length: 21 }, (_, index) => ({ taskId: `t${String(index)}`, title: `Task ${String(index)}`,
      disposition: 'cancelled' as const }));
    const goal = await f.addGoal('g04-arch-done', specs);
    const head = (await f.createSession('s04-arch-done-head')).ref;
    for (let index = 0; index < 21; index += 1) {
      await f.link(head, taskTarget(goal.tasks[`t${String(index)}`]!), 'responsible', true);
      await f.closeTerminal(head, taskTarget(goal.tasks[`t${String(index)}`]!));
    }
    await f.archive(head);
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    // Archived sessions are not in the active list; read the detail instead.
    expect(row).toBeUndefined();
    const detail = ready(await f.reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: head }));
    if (detail.kind !== 'line') throw new Error('expected a line detail');
    expect(detail.row.status.archivedTag).toBe('done');
    expect(detail.row.status.own).toBe('done');
    expect(detail.row.status.doneEvidence).toBe('complete');
  });

  it('2C-04 (8b) 22 closes with a terminal and an archiveStep-free window is plain-archived and done_unproven', async () => {
    const f = await lineFixture();
    const specs = Array.from({ length: 22 }, (_, index) => ({
      taskId: `t${String(index)}`, title: `Task ${String(index)}`,
      ...(index === 21 ? { disposition: 'cancelled' as const } : {}),
    }));
    const goal = await f.addGoal('g04-arch-over21', specs);
    const head = (await f.createSession('s04-arch-over21-head')).ref;
    const other = (await f.createSession('s04-arch-over21-other')).ref;
    for (let index = 0; index < 21; index += 1) {
      await f.link(head, taskTarget(goal.tasks[`t${String(index)}`]!), 'responsible', true);
      await f.transfer(head, other, taskTarget(goal.tasks[`t${String(index)}`]!));
    }
    await f.link(head, taskTarget(goal.tasks['t21']!), 'responsible', true);
    await f.closeTerminal(head, taskTarget(goal.tasks['t21']!));
    await f.archive(head);
    const detail = ready(await f.reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: head }));
    if (detail.kind !== 'line') throw new Error('expected a line detail');
    expect(detail.row.status.archivedTag).toBe('plain');
    expect(detail.row.status.doneEvidence).toBe('incomplete');
    expect(detail.row.status.ownReason.code).toBe('done_unproven');
  });

  it('2C-04 (10) an unknown duty is standby and grouped as unknown, never done', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g04-duty', [{ taskId: 'x-done', title: 'Done', disposition: 'cancelled' }]);
    const head = (await f.createSession('s04-duty-head')).ref;
    await f.link(head, taskTarget(goal.tasks['x-done']!), 'responsible', true);
    const reader = lineReaderOver(f.base, f.records, () => 'unknown');
    const row = rowOf(ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('standby');
    expect(row?.duty).toBe('unknown');
    expect(row?.groups.duty).toBe('unknown');
  });
});
