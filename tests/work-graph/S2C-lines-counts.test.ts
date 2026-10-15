/**
 * Slice 2C row 2C-36 (LE3): the archived count is either one instant or
 * `unavailable`/`source_moving` (L5, L11).
 *
 * Datasets are built through the real public services (Sessions, links,
 * transfers, archives). The only Double is `commitBefore`, which inserts one
 * real `archiveSession` commit before a named count read; assertions read only
 * the public `WorkLineReadPort`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { commitBefore, openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

const continuation = (from: SessionRef, task: { projectId: string; goalId: string; taskId: string }) =>
  ({ schemaVersion: 1, kind: 'continuation', from, reason: 'interrupted', task } as const);

describe.each(['memory', 'sqlite'] as const)('2C-36 archived count instant (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('2C-36 (1) archiving P before the first count makes the archived count unavailable and keeps C as the only active line', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g36-a', [{ taskId: 'x', title: 'X' }]);
    const p = (await f.createSession('s36-p')).ref;
    const c = (await f.createSession('s36-c', { provenance: continuation(p, goal.tasks['x']!) })).ref;
    await f.link(p, { kind: 'task', ref: goal.tasks['x']! }, 'responsible', true);
    await f.transfer(p, c, { kind: 'task', ref: goal.tasks['x']! });

    const wrapped = commitBefore(f.records, () => true, async () => { await f.archive(p); });
    const reader = f.readerWith(wrapped);
    const list = ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    expect(list.counts.archived.status).toBe('unavailable');
    if (list.counts.archived.status !== 'unavailable') throw new Error('expected unavailable');
    expect(list.counts.archived.reason.startsWith('source_moving')).toBe(true);
    expect(rowOf(list.rows, c)).toBeDefined();
    expect(rowOf(list.rows, p)).toBeUndefined();
  });

  it('2C-36 (1b) the same dataset without the inserted commit reports exact 0 (A=0, S=1, F=1)', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g36-b', [{ taskId: 'x', title: 'X' }]);
    const p = (await f.createSession('s36-p')).ref;
    const c = (await f.createSession('s36-c', { provenance: continuation(p, goal.tasks['x']!) })).ref;
    await f.link(p, { kind: 'task', ref: goal.tasks['x']! }, 'responsible', true);
    await f.transfer(p, c, { kind: 'task', ref: goal.tasks['x']! });
    await f.archive(p);
    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    expect(list.counts.archived).toEqual({ status: 'exact', value: 0, asOf: expect.any(String) });
  });

  it('2C-36 (1c) before P is archived the same read is exact 0 (A=1, S=0, F=1)', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g36-c', [{ taskId: 'x', title: 'X' }]);
    const p = (await f.createSession('s36-p')).ref;
    const c = (await f.createSession('s36-c', { provenance: continuation(p, goal.tasks['x']!) })).ref;
    await f.link(p, { kind: 'task', ref: goal.tasks['x']! }, 'responsible', true);
    await f.transfer(p, c, { kind: 'task', ref: goal.tasks['x']! });
    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    expect(list.counts.archived).toEqual({ status: 'exact', value: 0, asOf: expect.any(String) });
    expect(rowOf(list.rows, c)).toBeDefined();
    // P still has an active continuation, so P is not a line head.
    expect(rowOf(list.rows, p)).toBeUndefined();
  });

  it('2C-36 (2) archiving Z between S and F makes the archived count unavailable (A=1, S=1, F=1 otherwise)', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g36-d', [{ taskId: 'x', title: 'X' }]);
    const p = (await f.createSession('s36-p')).ref;
    const c = (await f.createSession('s36-c', { provenance: continuation(p, goal.tasks['x']!) })).ref;
    const z = (await f.createSession('s36-z')).ref;
    await f.link(p, { kind: 'task', ref: goal.tasks['x']! }, 'responsible', true);
    await f.transfer(p, c, { kind: 'task', ref: goal.tasks['x']! });

    const wrapped = commitBefore(f.records,
      (request) => request.index === 's2c-session-by-kind-from', async () => { await f.archive(z); });
    const reader = f.readerWith(wrapped);
    const list = ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    expect(list.counts.archived.status).toBe('unavailable');
    if (list.counts.archived.status !== 'unavailable') throw new Error('expected unavailable');
    expect(list.counts.archived.reason.startsWith('source_moving')).toBe(true);
  });

  it('2C-36 (2b) the same dataset without the inserted commit is exact 1 (A=1, S=1, F=1)', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g36-e', [{ taskId: 'x', title: 'X' }]);
    const p = (await f.createSession('s36-p')).ref;
    const c = (await f.createSession('s36-c', { provenance: continuation(p, goal.tasks['x']!) })).ref;
    const z = (await f.createSession('s36-z')).ref;
    await f.link(p, { kind: 'task', ref: goal.tasks['x']! }, 'responsible', true);
    await f.transfer(p, c, { kind: 'task', ref: goal.tasks['x']! });
    await f.archive(z);
    // The archived Z is unrelated to P/C; A=1 (P has active C), S=1, F=1, C=1-(1-1)=1.
    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    expect(list.counts.archived).toEqual({ status: 'exact', value: 1, asOf: expect.any(String) });
  });

  it('2C-36 (3) archiving V between the two archived counts makes withoutArchivedAt unavailable', async () => {
    const f = await lineFixture();
    const y = (await f.createSession('s36-y')).ref;
    const v = (await f.createSession('s36-v')).ref;
    await f.archive(y);
    const wrapped = commitBefore(f.records,
      (request) => request.index === 's2c-session-archived-at', async () => { await f.archive(v); });
    const reader = f.readerWith(wrapped);
    const page = ready(await reader.listArchivedLines(f.ctx, { workspace: f.base.scope, page: { limit: 10 } }));
    expect(page.withoutArchivedAt.status).toBe('unavailable');
    if (page.withoutArchivedAt.status !== 'unavailable') throw new Error('expected unavailable');
    expect(page.withoutArchivedAt.reason.startsWith('source_moving')).toBe(true);
  });

  it('2C-36 (3b) the same dataset without the inserted commit reports withoutArchivedAt exact 0', async () => {
    const f = await lineFixture();
    const y = (await f.createSession('s36-y')).ref;
    await f.createSession('s36-v');
    await f.archive(y);
    const page = ready(await f.reader.listArchivedLines(f.ctx, { workspace: f.base.scope, page: { limit: 10 } }));
    expect(page.withoutArchivedAt).toEqual({ status: 'exact', value: 0 });
    expect(page.rows.map((row) => row.key.sessionId)).toEqual([y.sessionId]);
  });

  it('L5 a malformed archived cursor is invalid, not a silent restart at page one', async () => {
    const f = await lineFixture();
    const y = (await f.createSession('s36-bad-cursor')).ref;
    await f.archive(y);
    const result = await f.reader.listArchivedLines(f.ctx,
      { workspace: f.base.scope, page: { limit: 10, cursor: 'not-a-real-cursor' } });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected a rejection');
    expect(result.code).toBe('invalid');
  });

  it('L5 one bounded candidate page drops a copy and still advances the cursor', async () => {
    const f = await lineFixture();
    const head = (await f.createSession('s36-bound-head')).ref;
    await f.archive(head);
    // A later-archived readonly copy sorts first but is not a line; the page must
    // not keep scanning records to fill `limit`.
    const asked = (await f.createSession('s36-bound-asked')).ref;
    const copy = (await f.createSession('s36-bound-copy', {
      provenance: { schemaVersion: 1, kind: 'readonly_copy', from: asked,
        messageRef: { aggregateType: 'SessionMessage', projectId: f.base.scope.projectId,
          workspaceId: f.base.scope.workspaceId, messageId: 's36-bound-msg' } },
    })).ref;
    await f.archive(copy);

    const first = ready(await f.reader.listArchivedLines(f.ctx, { workspace: f.base.scope, page: { limit: 1 } }));
    expect(first.rows).toEqual([]);
    expect(first.nextCursor).not.toBeNull();

    const second = ready(await f.reader.listArchivedLines(f.ctx,
      { workspace: f.base.scope, page: { limit: 1, cursor: first.nextCursor! } }));
    expect(second.rows.map((row) => row.key.sessionId)).toEqual([head.sessionId]);
  });
});
