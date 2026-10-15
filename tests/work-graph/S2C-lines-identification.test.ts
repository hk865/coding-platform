/**
 * Slice 2C row 2C-09 (LE3): which Sessions form one line, and who is the head.
 *
 * Every "given" is built through the real public Session services
 * (`admitSessionCreation` + `recordSessionCreated`, wrapped by the slice-1
 * `createSession` helper): `new`, `continuation`, `handoff` and `readonly_copy`
 * provenance. Assertions read only through the public `WorkLineReadPort`.
 * Both backends run the same examples.
 *
 * Covered here: continuation joins one line (new head, two-segment chain);
 * handoff starts a new line and keeps the original; a copy is not a line;
 * one Session with two continuations heads two lines; 33 predecessors truncate
 * to 33 chain entries with `sessionCount` partial and the `omitted` marker.
 * The E1/E14 responsible-link cases need the task rows, covered by the
 * follow-up line tests; they are reported under UNSPECIFIED.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${result.status}: ${JSON.stringify(result)}`);
  return result.value;
}

const continuation = (from: SessionRef, task: { projectId: string; goalId: string; taskId: string }) =>
  ({ schemaVersion: 1, kind: 'continuation', from, reason: 'interrupted', task } as const);

describe.each(['memory', 'sqlite'] as const)('2C-09 line identification (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('2C-09 continuation joins one line, the new Session is the head, the chain has two segments', async () => {
    const f = await lineFixture();
    const predecessor = await f.createSession('2c09-p');
    const head = await f.createSession('2c09-c',
      { provenance: continuation(predecessor.ref, f.base.tasks.first) });
    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const row = rowOf(list.rows, head.ref);
    expect(row).toBeDefined();
    expect(row?.chainSessions).toEqual([head.ref, predecessor.ref]);
    expect(row?.sessionCount).toEqual({ status: 'exact', value: 2 });
    expect(rowOf(list.rows, predecessor.ref)).toBeUndefined();
  });

  it('2C-09 handoff starts a new line and marks it as taken over from the original line', async () => {
    const f = await lineFixture();
    const from = await f.createSession('2c09-h');
    const head = await f.createSession('2c09-n', { provenance: { schemaVersion: 1, kind: 'handoff', from: from.ref } });
    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const row = rowOf(list.rows, head.ref);
    expect(row).toBeDefined();
    expect(rowOf(list.rows, from.ref)).toBeDefined();
    expect(row?.status.markers).toContainEqual({ kind: 'handoff_from', from: from.ref, fromLine: from.ref });
  });

  it('2C-09 a readonly copy is not a line but the asked Session is', async () => {
    const f = await lineFixture();
    const asked = await f.createSession('2c09-asked');
    const copy = await f.createSession('2c09-copy', {
      provenance: { schemaVersion: 1, kind: 'readonly_copy', from: asked.ref,
        messageRef: { aggregateType: 'SessionMessage', projectId: f.base.scope.projectId,
          workspaceId: f.base.scope.workspaceId, messageId: '2c09-message' } },
    });
    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    expect(rowOf(list.rows, copy.ref)).toBeUndefined();
    expect(rowOf(list.rows, asked.ref)).toBeDefined();
  });

  it('2C-09 two continuations of one Session are two lines and the shared predecessor is not one', async () => {
    const f = await lineFixture();
    const shared = await f.createSession('2c09-shared');
    const left = await f.createSession('2c09-left', { provenance: continuation(shared.ref, f.base.tasks.first) });
    const right = await f.createSession('2c09-right', { provenance: continuation(shared.ref, f.base.tasks.second) });
    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    expect(rowOf(list.rows, left.ref)).toBeDefined();
    expect(rowOf(list.rows, right.ref)).toBeDefined();
    expect(rowOf(list.rows, shared.ref)).toBeUndefined();
  });

  it('2C-09 reading a branched predecessor names both heads explicitly instead of not_found (N3)', async () => {
    const f = await lineFixture();
    const shared = await f.createSession('2c09-branch-shared');
    const left = await f.createSession('2c09-branch-left', { provenance: continuation(shared.ref, f.base.tasks.first) });
    const right = await f.createSession('2c09-branch-right', { provenance: continuation(shared.ref, f.base.tasks.second) });
    const result = await f.reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: shared.ref });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected ready');
    const value = result.value;
    if (!('kind' in value) || value.kind !== 'branched') {
      throw new Error(`expected a branched result, got ${JSON.stringify(value)}`);
    }
    expect(value.heads.map((head) => head.sessionId).sort())
      .toEqual([left.ref.sessionId, right.ref.sessionId].sort());
  });

  it('L22 an archived handoff predecessor reports its successor as handed_to', async () => {
    const f = await lineFixture();
    const from = await f.createSession('2c09-handed-from');
    await f.createSession('2c09-handed-to', { provenance: { schemaVersion: 1, kind: 'handoff', from: from.ref } });
    await f.archive(from.ref);
    const detail = ready(await f.reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: from.ref }));
    if (detail.kind !== 'line') throw new Error(`expected a line detail, got ${detail.kind}`);
    expect(detail.row.status.own).toBe('standby');
    expect(detail.row.status.ownReason.code).toBe('handed_to');
  });

  it('2C-09 33 predecessors keep 33 chain segments, report sessionCount partial and the omitted marker', async () => {
    const f = await lineFixture();
    let head = (await f.createSession('2c09-chain-0')).ref;
    for (let index = 1; index < 34; index += 1) {
      head = (await f.createSession(`2c09-chain-${index}`,
        { provenance: continuation(head, f.base.tasks.first) })).ref;
    }
    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const row = rowOf(list.rows, head);
    expect(row).toBeDefined();
    expect(row?.chainSessions).toHaveLength(33);
    expect(row?.sessionCount).toEqual({
      status: 'partial', atLeast: 34, reason: 'the chain exceeds 32 predecessors (L2)',
    });
    const omitted = row?.status.markers.find((marker) => marker.kind === 'omitted');
    expect(omitted).toEqual({ kind: 'omitted',
      count: { status: 'partial', atLeast: 1, reason: 'the chain exceeds 32 predecessors (L2)' } });
  });

  it('2C-09/E1 the detail chain lists each Session\'s own open responsibility', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('2c09-e1', [
      { taskId: 'p-task', title: 'P task' }, { taskId: 'h-task', title: 'H task' },
    ]);
    const p = (await f.createSession('2c09-e1-p')).ref;
    const h = (await f.createSession('2c09-e1-h', { provenance: continuation(p, goal.tasks['p-task']!) })).ref;
    await f.link(p, { kind: 'task', ref: goal.tasks['p-task']! }, 'responsible', true);
    await f.link(h, { kind: 'task', ref: goal.tasks['h-task']! }, 'responsible', true);
    const detail = ready(await f.reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: h }));
    if (detail.kind !== 'line') throw new Error('expected a line detail');
    const pEntry = detail.chain.find((entry) => entry.session.sessionId === p.sessionId);
    const hEntry = detail.chain.find((entry) => entry.session.sessionId === h.sessionId);
    expect(pEntry?.responsibleOpen).toEqual([goal.tasks['p-task']!]);
    expect(hEntry?.responsibleOpen).toEqual([goal.tasks['h-task']!]);
    expect(detail.row.responsibleNow.map((brief) => brief.task.taskId).sort()).toEqual(['h-task', 'p-task']);
    // L11: the source cursor is the real chain/head watermark, never a fabricated zero.
    expect(detail.sourceCursor).not.toBe('c0000000000');
  });
});
