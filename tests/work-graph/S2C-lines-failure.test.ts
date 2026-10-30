/**
 * Slice 2C row 2C-14 regression (LE3, rule 3 / §8): a failed storage read is
 * returned as its error code, never turned into a ready empty answer or 0.
 *
 * The dataset is built through the real public Session services; the only
 * Doubles are the storage wrappers that fail one named call, and (RD-8) an A3
 * gate that performs a real continuation claim between two reads. Assertions
 * read only the public `WorkLineReadPort`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { JsonValue } from '../../src/contracts/fingerprint.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { createWorkLineReader } from '../../src/core/work-graph/views/work-line-reader.js';
import { failingLookup, failingLookupOrdered, failingReadMany, openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';
import { completedEvent, L_HOST } from '../helpers/S2C-L-runs-support.js';
import { createS2BRuntimeSteps } from '../helpers/S2B-runtime-steps-fixture.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
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

  it('2C-14/RD-8 a lease held by another Run makes the yielded Run refuse pause and cancel', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g14-rd8', [{ taskId: 'w', title: 'W task' },
      { taskId: 'reply', title: 'Reply task' }]);
    const head = await f.base.createSession('s14-rd8');
    const recipient = await f.base.createSession('s14-rd8-recipient');
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);

    // The real Runtime Host grant needs the mailbox tools this case uses.
    const host = { configurationRevision: 's2c-rd8-mail-host@1',
      permissions: { policyRevision: 'legacy-template',
        tools: ['read', 'send_session_message', 'respond_session_message'], writeScope: [] as string[] },
      hostTemplate: L_HOST.hostTemplate };
    let sequence = 0;
    const steps = await createS2BRuntimeSteps({ base: f.base, bodies: f.runs.bodies, ctx: f.ctx,
      directory: f.base.directory, scope: f.base.scope, now: () => '2026-09-24T00:00:00.000Z',
      setClock: () => undefined, eventId: () => `s2c-rd8-event-${++sequence}`,
      newId: () => `s2c-rd8-id-${++sequence}`, consumerId: 's2c-rd8-runtime',
      withMailbox: true, host });
    try {
      const mailbox = steps.mailbox;
      if (mailbox === undefined) throw new Error('the RD-8 Session mailbox must be wired');

      // A real scripted-model wait through the send_session_message tool: the
      // Run is genuinely yielded and its continuation names the saved message.
      const send = { callId: 'rd8-wait-send', name: 'send_session_message',
        args: { recipient, text: 'RD-8: which result should the continuation use?', intent: 'inquiry',
          needsReply: true, waitAfterSend: true } };
      const yieldedClaim = await f.claim('w', head, goal);
      const sent = await steps.start(yieldedClaim.claim, { at: '2026-09-24T00:00:00.000Z',
        replies: [{ kind: 'calls', calls: [send] }], tools: ['read', 'send_session_message',
          'respond_session_message'] });
      sent.release();
      await sent.settled;
      const yielded = await f.runs.readExecution(yieldedClaim.claim);
      expect(yielded.run).toMatchObject({ status: 'ended', outcome: 'yielded',
        continuation: { kind: 'wait_reply' } });
      const messageRef = yielded.run.continuation?.messageRef;
      if (messageRef === undefined) throw new Error('the yielded Run must name its wait message');
      const waiting = ready(await mailbox.readMessage(f.ctx, messageRef));
      expect(waiting.status).toBe('pending');
      expect(waiting.response).toBeNull();

      // The recipient answers through the real respond_session_message tool from
      // its own entered Run; the saved response is the consumed-wait reference.
      const reply = { callId: 'rd8-wait-reply', name: 'respond_session_message',
        args: { messageRef, expectedRevision: waiting.revision,
          text: 'RD-8 reply: use the recorded result.' } };
      const replyClaim = await f.claim('reply', recipient, goal);
      const replier = await steps.start(replyClaim.claim, { at: '2026-09-24T00:00:00.000Z',
        replies: [{ kind: 'calls', calls: [reply] }, { kind: 'text', text: 'RD-8 reply sent' }],
        tools: ['read', 'send_session_message', 'respond_session_message'] });
      await steps.finish(replier, '2026-09-24T00:00:00.000Z', 'completed');
      const replied = ready(await mailbox.readMessage(f.ctx, messageRef));
      expect(replied.status).toBe('responded');
      if (replied.response === null) throw new Error('the real reply must save its response');
      const responseRef = replied.response.bodyRef;

      // A3: between the reader's Session read and its TaskLease read, a real
      // continuation claim re-holds the lease for the successor Run; the reader
      // still receives its original (pre-claim) Session read unchanged.
      const headRef = { projectId: head.projectId, sessionId: head.sessionId };
      const headKey = canonicalJson({ aggregateType: 'Session', ...headRef } as unknown as JsonValue);
      let claimed = false;
      const continuation = { ...f.records, async readMany(keys: readonly string[]) {
        const read = await f.records.readMany(keys);
        // The reader's head read is the single-key `readSession` call; the
        // earlier batched session reads are the active-window/cycle probes.
        if (!claimed && keys.length === 1 && keys[0] === headKey) {
          claimed = true;
          const request = await f.base.buildRequest({ input: { sessionRef: headRef,
            goalRef: goal.goalRef, planRef: goal.planRef, taskId: 'w' }, requestId: 'rd8-continuation' });
          const result = await f.base.service.claimTask(f.ctx, { input: { ...request.input,
            consumedWait: { kind: 'wait_reply', originalRun: yieldedClaim.runRef, messageRef, responseRef } }, meta: request.meta });
          expect(result).toMatchObject({ status: 'committed' });
        }
        return read;
      } };
      const row = rowOf(ready(await f.readerWith(continuation).listWorkLines(f.ctx,
        { workspace: f.base.scope })).rows, head);
      expect(claimed).toBe(true);
      expect(row?.status.own).toBe('waiting_reply');
      for (const kind of ['pause', 'cancel'] as const) {
        const control = row?.controls.find((entry) => entry.kind === kind);
        expect(control?.availability).toBe('available');
        expect(control?.reasonCode).toBeNull();
      }
    } finally { await steps.close(); }
  });

  it('2C-14/T5x a real Run end between the head and occupancy reads rereads once and heals', async () => {
    for (const budget of [undefined, 100] as const) {
      const f = await lineFixture();
      const goal = await f.addGoal('g14-t5x-reread', [{ taskId: 'w', title: 'W task' }]);
      const head = (await f.createSession('s14-t5x-reread')).ref;
      const claim = await f.claim('w', head, goal);
      await f.runs.enter(claim.claim);
      const headKey = canonicalJson({ aggregateType: 'Session', projectId: head.projectId,
        sessionId: head.sessionId } as unknown as JsonValue);
      let headReads = 0;
      // A real end committed in ONE commit (the ended Run and the Session
      // occupancy release) between the head read and the later occupancy read.
      const gated = { ...f.records, async readMany(keys: readonly string[]) {
        const read = await f.records.readMany(keys);
        if (keys.length === 1 && keys[0] === headKey) {
          headReads += 1;
          if (headReads === 1) await f.runs.recordResult(claim.claim, completedEvent(claim.claim, 't5x-reread'));
        }
        return read;
      } };
      const list = ready(await f.readerWith(gated, budget).listWorkLines(f.ctx, { workspace: f.base.scope }));
      const row = rowOf(list.rows, head);
      // The first pass saw the stale occupied head; the single reread healed it.
      expect(headReads).toBe(3);
      expect(row).toBeDefined();
      expect(row?.problem).toBeNull();
    }
  });

  it('2C-14/T5x a second real Run end on the reread leaves the row source_moving with no bucket', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g14-t5x-two', [{ taskId: 'w', title: 'W task' },
      { taskId: 'w2', title: 'W2 task' }]);
    const head = (await f.createSession('s14-t5x-two')).ref;
    const a = await f.claim('w', head, goal);
    await f.runs.enter(a.claim);
    const headKey = canonicalJson({ aggregateType: 'Session', projectId: head.projectId,
      sessionId: head.sessionId } as unknown as JsonValue);
    let headReads = 0;
    let b: Awaited<ReturnType<typeof f.claim>> | undefined;
    const gated = { ...f.records, async readMany(keys: readonly string[]) {
      const read = await f.records.readMany(keys);
      if (keys.length === 1 && keys[0] === headKey) {
        headReads += 1;
        if (headReads === 1) {
          await f.runs.recordResult(a.claim, completedEvent(a.claim, 't5x-a'));
          b = await f.claim('w2', head, goal);
          await f.runs.enter(b.claim);
        } else if (headReads === 2) {
          await f.runs.recordResult(b!.claim, completedEvent(b!.claim, 't5x-b'));
        }
      }
      return read;
    } };
    const list = ready(await f.readerWith(gated).listWorkLines(f.ctx, { workspace: f.base.scope }));
    const row = rowOf(list.rows, head);
    // The reread itself raced a second real end: the inconsistency persists.
    expect(headReads).toBe(2);
    expect(row?.problem).toMatchObject({ code: 'source_moving' });
    expect(row?.status.bucket).toBeNull();
  });
});
