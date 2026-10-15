/**
 * Slice 2C row 2C-14 regression (LE3, rule 3 / §8): a failed storage read is
 * returned as its error code, never turned into a ready empty answer or 0.
 *
 * The dataset is built through the real public Session services; the only
 * Doubles are the storage wrappers that fail one named call. Assertions read
 * only the public `WorkLineReadPort`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { JsonValue } from '../../src/contracts/fingerprint.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { createWorkLineReader, type WorkLineStore } from '../../src/core/work-graph/views/work-line-reader.js';
import { failingLookup, failingLookupOrdered, failingReadMany, openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';
import { waitContinuation, yieldedEvent } from '../helpers/S2C-L-runs-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

/** Rewrite one stored record's JSON as a read double (states the public services cannot build). */
function rewriteRead(records: WorkLineStore, refKey: string, mutate: (body: Record<string, unknown>) => void): WorkLineStore {
  return {
    ...records,
    async readMany(keys) {
      const read = await records.readMany(keys);
      if (read.status !== 'ready' || !keys.includes(refKey)) return read;
      return { ...read, value: { ...read.value, records: read.value.records.map((record) => {
        if (record.refKey !== refKey) return record;
        const parsed = JSON.parse(record.json) as Record<string, unknown>;
        mutate(parsed);
        return { ...record, json: JSON.stringify(parsed) };
      }) } };
    },
  };
}

/** An ended-but-occupied Run (T5x). */
function endedRunRead(records: WorkLineStore, runKey: string): WorkLineStore {
  return rewriteRead(records, runKey, (body) => { body['status'] = 'ended'; body['outcome'] = 'completed'; });
}

/** Make every record of the named lookup index carry a schema the codec cannot decode. */
function corruptLookupSchema(records: WorkLineStore, index: string, schemaId: string): WorkLineStore {
  return {
    ...records,
    async lookup(request) {
      const page = await records.lookup(request);
      if (request.index !== index || page.status !== 'ready') return page;
      return { ...page, value: { ...page.value, records: page.value.records.map((record) => ({ ...record, schemaId })) } };
    },
  };
}

describe.each(['memory', 'sqlite'] as const)('2C-14 failed reads propagate (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('lines/list returns the rejection when the active-Session page fails', async () => {
    const f = await lineFixture();
    await f.createSession('s14-fail-list');
    const wrapper = failingLookup(f.records, 'session-by-workspace-lifecycle');
    const result = await f.readerWith(wrapper.records).listWorkLines(f.ctx, { workspace: f.base.scope });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected a rejection');
    expect(result.code).toBe('unavailable');
    expect(wrapper.calls).toBeGreaterThan(0);
  });

  it('lines/list returns the rejection when a continuation-successor lookup fails', async () => {
    const f = await lineFixture();
    await f.createSession('s14-fail-successor');
    const wrapper = failingLookup(f.records, 's2c-session-by-kind-from');
    const result = await f.readerWith(wrapper.records).listWorkLines(f.ctx, { workspace: f.base.scope });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected a rejection');
    expect(result.code).toBe('unavailable');
    expect(wrapper.calls).toBeGreaterThan(0);
  });

  it('lines/archived returns the rejection when the archived ordered page fails', async () => {
    const f = await lineFixture();
    await f.archive((await f.createSession('s14-fail-archived')).ref);
    const wrapper = failingLookupOrdered(f.records, 's2c-session-archived-at');
    const result = await f.readerWith(wrapper.records).listArchivedLines(f.ctx,
      { workspace: f.base.scope, page: { limit: 10 } });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected a rejection');
    expect(result.code).toBe('unavailable');
    expect(wrapper.calls).toBeGreaterThan(0);
  });

  it('lines/read returns the rejection when the head walk fails instead of not_found', async () => {
    const f = await lineFixture();
    const head = (await f.createSession('s14-fail-head')).ref;
    const wrapper = failingLookup(f.records, 's2c-session-by-kind-from');
    const result = await f.readerWith(wrapper.records).readWorkLine(f.ctx, { workspace: f.base.scope, key: head });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected a rejection');
    expect(result.code).toBe('unavailable');
    expect(wrapper.calls).toBeGreaterThan(0);
  });

  it('lines/read returns the rejection when the head Session read fails instead of not_found', async () => {
    const f = await lineFixture();
    const head = (await f.createSession('s14-fail-head-read')).ref;
    const wrapper = failingReadMany(f.records);
    const result = await f.readerWith(wrapper.records).readWorkLine(f.ctx, { workspace: f.base.scope, key: head });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected a rejection');
    expect(result.code).toBe('unavailable');
    expect(wrapper.calls).toBeGreaterThan(0);
  });

  it('2C-14 a failed task-graph read marks the line B4 instead of dropping its responsibility (rule 3)', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g14-plan-fail', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s14-plan-fail')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const plans = {
      ...f.base.plans,
      async queryTaskGraph() {
        return { status: 'rejected' as const, code: 'unavailable' as const,
          reason: 'injected task-graph failure' };
      },
    };
    const reader = createWorkLineReader({ ...f.deps, plans });
    const list = ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const row = rowOf(list.rows, head);
    expect(row).toBeDefined();
    expect(row?.problem).toMatchObject({ code: 'unavailable', reason: 'injected task-graph failure' });
    // B4: the row keeps its slot but takes no bucket, and the counts are partial.
    expect(row?.status.bucket).toBeNull();
    expect(list.counts.working.status).toBe('partial');
    expect(list.counts.standby.status).toBe('partial');
  });

  it('2C-14 (review item 2) a responsible Task absent from the task graph marks the line B4, never a silent drop', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g14-ghost-task', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s14-ghost-task')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    // The Task is a real member of the accepted Plan (so the link is legal), but the
    // task-graph read does not return it: a node the reader must not silently drop.
    const plans = {
      ...f.base.plans,
      async queryTaskGraph(ctx: Parameters<typeof f.base.plans.queryTaskGraph>[0],
        input: Parameters<typeof f.base.plans.queryTaskGraph>[1]) {
        const read = await f.base.plans.queryTaskGraph(ctx, input);
        if (read.status !== 'ready') return read;
        return { ...read, value: { ...read.value,
          tasks: read.value.tasks.filter((row) => row.definition.taskId !== 'w') } };
      },
    };
    const reader = createWorkLineReader({ ...f.deps, plans });
    const list = ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const row = rowOf(list.rows, head);
    expect(row).toBeDefined();
    expect(row?.problem).toMatchObject({ code: 'incomplete' });
    // B4: the row keeps its slot but takes no bucket, and the counts are partial.
    expect(row?.status.bucket).toBeNull();
    expect(row?.responsibleNow).toHaveLength(0);
    expect(list.counts.standby.status).toBe('partial');
  });

  it('2C-14 (review item 2) an undecodable open responsible link marks the line B4, never no responsibility', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g14-bad-link', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s14-bad-link')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const reader = f.readerWith(corruptLookupSchema(f.records, 's2c-open-links-by-session', 'BogusLink@1'));
    const list = ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const row = rowOf(list.rows, head);
    expect(row).toBeDefined();
    expect(row?.problem).toMatchObject({ code: 'unavailable' });
    expect(row?.status.bucket).toBeNull();
  });

  it('2C-14/L11 an ended-but-occupied Run rereads once and then reports source_moving', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g14-t5x', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s14-t5x')).ref;
    const claim = await f.claim('w', head, goal);          // starting: the Run occupies the Session
    const runKey = canonicalJson(claim.runRef as unknown as JsonValue);
    const reader = f.readerWith(endedRunRead(f.records, runKey));
    const row = rowOf(ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row).toBeDefined();
    expect(row?.problem).toMatchObject({ code: 'source_moving' });
    expect(row?.status.bucket).toBeNull();
  });

  it('2C-14/RD-8 a lease held by another Run makes the yielded Run refuse pause and cancel', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g14-rd8', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s14-rd8')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);
    const messageRef: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: head.projectId,
      workspaceId: f.base.scope.workspaceId, messageId: 'g14-rd8-wait' };
    await f.runs.recordResult(claim.claim, yieldedEvent(claim.claim, 'rd8'), waitContinuation(claim.claim, messageRef));
    // RD-8: the read double makes the TaskLease name a different holder Run.
    const leaseKey = canonicalJson({ aggregateType: 'TaskLease', projectId: head.projectId,
      goalId: goal.goalRef.goalId, taskId: 'w' } as unknown as JsonValue);
    const reader = f.readerWith(rewriteRead(f.records, leaseKey, (body) => { body['holderRunId'] = 'another-run'; }));

    const row = rowOf(ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('waiting_reply');
    for (const kind of ['pause', 'cancel'] as const) {
      const control = row?.controls.find((entry) => entry.kind === kind);
      expect(control?.availability).toBe('unavailable');
      expect(control?.reasonCode).toBe('busy');
    }
  });
});
