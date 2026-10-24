/**
 * Slice 2C row 2C-16 (LE3): line names, grouping and the detail's responsibility.
 *
 * Goals/Plans, Sessions, responsible links and claims are built through the real
 * public services. Assertions read only the public `WorkLineReadPort` (the
 * `lines/page` participation section is not implemented yet, reported under
 * UNSPECIFIED).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import { lineReaderOver, openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

function taskTarget(task: TaskTriple) {
  return { kind: 'task' as const, ref: task };
}

describe.each(['memory', 'sqlite'] as const)('2C-16 line names and groups (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('2C-16 (a) the claimed task names the line (running_task)', async () => {
    const f = await lineFixture();
    const head = (await f.createSession('s16-running')).ref;
    await f.claim('implement-a', head);
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.name.source).toBe('running_task');
    expect(row?.name.primary).toBe('Implement A');
  });

  it('2C-16 (b) two now-responsible tasks list the first and count the rest', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g16-open', [
      { taskId: 'x1', title: 'First task' },
      { taskId: 'x2', title: 'Second task' },
    ]);
    const head = (await f.createSession('s16-open')).ref;
    await f.link(head, taskTarget(goal.tasks['x1']!), 'responsible', true);
    await f.link(head, taskTarget(goal.tasks['x2']!), 'responsible', true);
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.name.source).toBe('open_tasks');
    expect(row?.name.primary).toBe('First task');
    expect(row?.name.extraCount).toBe(1);
    expect(row?.responsibleNow.map((brief) => brief.task.taskId)).toEqual(['x1', 'x2']);
  });

  it('2C-16 (c) groups carry the duty, the module and the naming task', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g16-groups', [{ taskId: 'x1', title: 'First task' }]);
    const head = (await f.createSession('s16-groups')).ref;
    await f.link(head, taskTarget(goal.tasks['x1']!), 'responsible', true);
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.groups.duty).toBe('executor');
    expect(row?.groups.module).toBeNull();
    expect(row?.groups.task).toEqual(goal.tasks['x1']);
  });

  it('2C-16 (d) an unresolved duty is grouped as unknown', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g16-duty', [{ taskId: 'x1', title: 'First task' }]);
    const head = (await f.createSession('s16-duty')).ref;
    await f.link(head, taskTarget(goal.tasks['x1']!), 'responsible', true);
    const reader = lineReaderOver(f.base, f.records, () => 'unknown');
    const row = rowOf(ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.groups.duty).toBe('unknown');
  });

  it('2C-16 (e) the detail reports no responsibility when there is no open link and has_responsibility with one', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g16-detail', [{ taskId: 'x1', title: 'First task' }]);
    const empty = (await f.createSession('s16-detail-empty')).ref;
    const emptyDetail = ready(await f.reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: empty }));
    if (emptyDetail.kind !== 'line') throw new Error('expected a line detail');
    expect(emptyDetail.responsibility).toBe('none');
    expect(emptyDetail.row.responsibleNow).toEqual([]);

    const head = (await f.createSession('s16-detail-head')).ref;
    await f.link(head, taskTarget(goal.tasks['x1']!), 'responsible', true);
    const detail = ready(await f.reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: head }));
    if (detail.kind !== 'line') throw new Error('expected a line detail');
    expect(detail.responsibility).toBe('has_responsibility');
    expect(detail.row.responsibleNow.map((brief) => brief.task.taskId)).toEqual(['x1']);
  });

  it('2C-16 (f) an empty secretary line is standby idle, not a goal-state reason', async () => {
    const f = await lineFixture();
    const head = (await f.createSession('s16-secretary', { role: {
      kind: 'legacy_template', templateId: 'secretary', templateRevision: '1' } })).ref;
    const reader = lineReaderOver(f.base, f.records,
      (role) => role.templateId === 'secretary' ? 'secretary' : 'executor');
    const row = rowOf(ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.ownReason.code).toBe('idle');
    expect(row?.name.source).toBe('secretary_ordinal');
    expect(row?.name.primary).toBe('秘书 1');
    expect(row?.name.complete).toBe(true);
  });

  it('2C-16 (f2) an occupied secretary keeps its ordinal name and exposes the Query goalRef', async () => {
    const f = await lineFixture();
    const goalRef = await f.runs.bareGoal('g16-secretary-query');
    const head = (await f.createSession('s16-secretary-query', { role: {
      kind: 'legacy_template', templateId: 'secretary', templateRevision: '1' } })).ref;
    await f.runs.claimQuery(head, goalRef, 'sec-name');
    const reader = lineReaderOver(f.base, f.records,
      (role) => role.templateId === 'secretary' ? 'secretary' : 'executor');
    const row = rowOf(ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.name.source).toBe('secretary_ordinal');
    expect(row?.name.primary).toBe('秘书 1');
    expect(row?.name.goalRef).toEqual(goalRef);
  });

  it('2C-16 (g) a task in a cancelled Goal reads goal_cancelled', async () => {    const f = await lineFixture();
    const goal = await f.addGoal('g16-cancelled', [{ taskId: 'x1', title: 'First task' }]);
    const head = (await f.createSession('s16-cancelled')).ref;
    await f.link(head, taskTarget(goal.tasks['x1']!), 'responsible', true);
    await f.setGoalDesired(goal.goalRef, 'cancelled');
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.ownReason.code).toBe('goal_cancelled');
  });
});
