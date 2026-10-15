/**
 * Slice 2C row 2C-18 (LE3): the line detail sections (L4, L12, L17, §3.11).
 *
 * The fixture builds a two-segment line P (predecessor) + H (head) through the
 * real public services: P claims E1 (entered at 09:10, then a normal check
 * round), then Query Q1 (entered/settled at 09:30); H claims E2 (10:05), Q2
 * (10:30), Q3 (a clock regression: startedAt 10:15 but claimed after Q2) and E4
 * (claimed but cancelled before entry, startedAt null). The claim id sequence
 * runs opposite to the claim order, so only generation can give the literal
 * order. Everything is read through the public `WorkLineReadPort`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionProvenanceV1 } from '../../src/contracts/core/session.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { LineExecutionItemV1 } from '../../src/contracts/work-line.js';
import { openLineFixture, commitBeforeLookupOrdered, type LineFixture, type LineGoal } from '../helpers/S2C-L-line-support.js';
import { completedEvent } from '../helpers/S2C-L-runs-support.js';
import { encodeQueryRunSnapshotRecord, S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP } from '../../src/core/work-graph/queries/query-record-codecs.js';
import type { QueryRunRef, QueryRunSnapshot } from '../../src/contracts/query-job.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

const E1 = '2026-01-01T09:10:00.000Z';
const Q1 = '2026-01-01T09:30:00.000Z';
const E2 = '2026-01-01T10:05:00.000Z';
const Q2 = '2026-01-01T10:30:00.000Z';
const Q3 = '2026-01-01T10:15:00.000Z';
const E4 = '2026-01-01T10:40:00.000Z';

function continuation(from: SessionRef, task: TaskTriple): SessionProvenanceV1 {
  return { schemaVersion: 1, kind: 'continuation', from, reason: 'interrupted', task };
}

function itemKey(item: LineExecutionItemV1): string {
  if (item.kind === 'execution') return `execution:${item.task.taskId}@${item.startedAt ?? 'null'}`;
  return `query:${item.queryRunRef.queryJobId}@${item.startedAt ?? 'null'}`;
}

/** The 2C-18 two-segment line with E1/Q1 on P and E2/Q2/Q3/E4 on H. */
async function buildExecutionsLine(f: LineFixture): Promise<{ p: SessionRef; h: SessionRef; goal: LineGoal; e1: TaskClaim }> {
  await f.checks.installPolicy();
  const goal = await f.checks.addCheckableGoal('g18', [
    { taskId: 'e1', title: 'E1 task' }, { taskId: 'e2', title: 'E2 task' }, { taskId: 'e4', title: 'E4 task' },
  ]);
  const p = (await f.createSession('s18-p')).ref;
  const h = (await f.createSession('s18-h', { provenance: continuation(p, goal.tasks['e1']!) })).ref;

  // Claim ids descend while generations ascend (L12: order is by generation).
  let seed = 0;
  const descending = () => ['z', 'y', 'x', 'w', 'v', 'u', 't', 's'][seed++] ?? `n${String(seed)}`;

  // P: E1 entered at 09:10, ended, then its normal check round opens.
  const e1 = await f.claimWith('e1', p, { goal, now: () => E1, newId: descending });
  await f.runs.enter(e1.claim, E1);
  await f.runs.recordResult(e1.claim, completedEvent(e1.claim, 'e1'));
  const round = await f.checks.openRound(e1.runRef, goal.tasks['e1']!, goal.planRef);
  expect(round.status).toBe('open');

  // P: Q1 entered at 09:30 (settled so P is free for H's claims are independent).
  const q1 = await f.runs.claimQuery(p, await f.runs.bareGoal('g18-q1'), 'q1');
  await f.runs.completeConsultation(q1, p, 'answered', 'q1', Q1, { now: () => Q1 });

  // H: E2 entered at 10:05, ended.
  const e2 = await f.claimWith('e2', h, { goal, now: () => E2, newId: descending });
  await f.runs.enter(e2.claim, E2);
  await f.runs.recordResult(e2.claim, completedEvent(e2.claim, 'e2'));

  // H: Q2 at 10:30, then Q3 whose clock went back to 10:15 but was claimed later.
  const q2 = await f.runs.claimQuery(h, await f.runs.bareGoal('g18-q2'), 'q2');
  await f.runs.completeConsultation(q2, h, 'answered', 'q2', Q2, { now: () => Q2 });
  const q3 = await f.runs.claimQuery(h, await f.runs.bareGoal('g18-q3'), 'q3');
  await f.runs.completeConsultation(q3, h, 'answered', 'q3', Q3, { now: () => Q3 });

  // H: E4 claimed then cancelled before entry (startedAt null).
  const e4 = await f.claimWith('e4', h, { goal, now: () => E4, newId: descending });
  const cancelled = await f.runs.submitResult(e4.claim, 'cancel');
  expect(cancelled.status).toBe('committed');

  return { p, h, goal, e1: e1.claim };
}

describe.each(['memory', 'sqlite'] as const)('2C-18 line page sections (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('2C-18 executions page by generation, with the within-segment boundary', async () => {
    const f = await lineFixture();
    const { p } = await buildExecutionsLine(f);
    const page = async (limit: number, cursor?: string) => ready(await f.reader.readWorkLinePage(f.ctx, {
      workspace: f.base.scope, key: p, section: 'executions', page: { limit, ...(cursor === undefined ? {} : { cursor }) } }));

    const first = await page(2);
    if (first.section !== 'executions') throw new Error('expected the executions section');
    expect(first.scope).toBe('indexed');
    expect(first.items.map(itemKey)).toEqual([`execution:e1@${E1}`, `query:s2c-l-query-q1@${Q1}`]);
    const firstWork = first.items[0];
    if (firstWork?.kind !== 'execution') throw new Error('expected the E1 execution');
    expect(firstWork.checks).toHaveLength(1);
    expect(firstWork.checks[0]?.status).toBe('open');
    expect(first.nextCursor).not.toBeNull();

    const second = await page(2, first.nextCursor!);
    if (second.section !== 'executions') throw new Error('expected the executions section');
    expect(second.items.map(itemKey)).toEqual([`execution:e2@${E2}`, `query:s2c-l-query-q2@${Q2}`]);
    expect(second.segments.map((segment) => segment.session.sessionId)).toEqual([p.sessionId, expect.any(String)]);
    expect(second.sourceCursor).toBe(first.sourceCursor);
    expect(second.nextCursor).not.toBeNull();

    const third = await page(2, second.nextCursor!);
    if (third.section !== 'executions') throw new Error('expected the executions section');
    expect(third.items.map(itemKey)).toEqual([`query:s2c-l-query-q3@${Q3}`, `execution:e4@null`]);
    const e4 = third.items[1];
    if (e4?.kind !== 'execution') throw new Error('expected the E4 execution');
    expect(e4.status).toBe('ended');
    expect(e4.startedAt).toBeNull();
    expect(third.nextCursor).toBeNull();
  });

  it('2C-18 (i) a commit mid-page is re-read and neither W nor Q is lost', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g18i', [{ taskId: 'w', title: 'W task' }]);
    const p = (await f.createSession('s18i-p')).ref;
    const h = (await f.createSession('s18i-h', { provenance: continuation(p, goal.tasks['w']!) })).ref;
    const instant = '2026-01-02T00:00:00.000Z';
    let commits = 0;
    const wrapped = commitBeforeLookupOrdered(f.records,
      (request) => request.index === S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP && request.values[2] === h.sessionId,
      async (attempt) => {
        if (attempt !== 1) return;
        commits += 1;
        const w = await f.claimWith('w', h, { goal, now: () => instant, newId: () => 's2c-l-instant-w' });
        await f.runs.enter(w.claim, instant);
        await f.runs.recordResult(w.claim, completedEvent(w.claim, 'instant-w'));
        const q = await f.runs.claimQuery(h, await f.runs.bareGoal('g18i-q'), 'instant-q');
        await f.runs.completeConsultation(q, h, 'answered', 'instant-q', instant, { now: () => instant });
      });
    const reader = f.readerWith(wrapped.records);
    const page = ready(await reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: p,
      section: 'executions', page: { limit: 10 } }));
    if (page.section !== 'executions') throw new Error('expected the executions section');
    expect(commits).toBe(1);
    expect(page.items.map(itemKey)).toEqual([`execution:w@${instant}`, `query:s2c-l-query-instant-q@${instant}`]);
  });

  it('2C-18 (ii) four interrupted attempts answer source_moving with nothing', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g18ii', [{ taskId: 'w', title: 'W task' }]);
    const p = (await f.createSession('s18ii-p')).ref;
    const h = (await f.createSession('s18ii-h', { provenance: continuation(p, goal.tasks['w']!) })).ref;
    const wrapped = commitBeforeLookupOrdered(f.records,
      (request) => request.index === S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP && request.values[2] === h.sessionId,
      async (attempt) => {
        const at = `2026-01-02T00:0${String(attempt)}:00.000Z`;
        const q = await f.runs.claimQuery(h, await f.runs.bareGoal(`g18ii-q${String(attempt)}`), `ii-q${String(attempt)}`);
        await f.runs.completeConsultation(q, h, 'answered', `ii-q${String(attempt)}`, at, { now: () => at });
      });
    const reader = f.readerWith(wrapped.records);
    const page = await reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: p,
      section: 'executions', page: { limit: 10 } });
    expect(page.status).toBe('rejected');
    if (page.status !== 'rejected') throw new Error('expected a rejection');
    expect(page.code).toBe('unavailable');
    expect(page.reason).toContain('source_moving');
  });

  it('2C-18 (iii) a commit after the page lands on a later page by generation', async () => {
    const f = await lineFixture();
    const { p, h } = await buildExecutionsLine(f);
    const after = await f.checks.addCheckableGoal('g18iii', [{ taskId: 'w', title: 'W task' }]);
    const pageAt = async (cursor?: string) => ready(await f.reader.readWorkLinePage(f.ctx, {
      workspace: f.base.scope, key: p, section: 'executions', page: { limit: 2,
        ...(cursor === undefined ? {} : { cursor }) } }));
    const first = await pageAt();
    if (first.section !== 'executions') throw new Error('expected the executions section');

    const instant = '2026-01-02T00:00:00.000Z';
    const w = await f.claimWith('w', h, { goal: after, now: () => instant, newId: () => 's2c-l-after-w' });
    await f.runs.enter(w.claim, instant);
    await f.runs.recordResult(w.claim, completedEvent(w.claim, 'after-w'));
    const q = await f.runs.claimQuery(h, await f.runs.bareGoal('g18iii-q'), 'after-q');
    await f.runs.completeConsultation(q, h, 'answered', 'after-q', instant, { now: () => instant });

    // Walk on from page 1: the new W and Q are on H after E4, so a later page gives them.
    const collected: string[] = [];
    let cursor = first.nextCursor ?? undefined;
    while (cursor !== undefined) {
      const next = await pageAt(cursor);
      if (next.section !== 'executions') throw new Error('expected the executions section');
      collected.push(...next.items.map(itemKey));
      cursor = next.nextCursor ?? undefined;
    }
    expect(collected).toEqual([
      `execution:e2@${E2}`, `query:s2c-l-query-q2@${Q2}`,
      `query:s2c-l-query-q3@${Q3}`, `execution:e4@null`,
      `execution:w@${instant}`, `query:s2c-l-query-after-q@${instant}`,
    ]);
  });

  it('2C-18 a new execution on a walked segment makes the next page source_stale', async () => {
    const f = await lineFixture();
    const { p } = await buildExecutionsLine(f);
    const pageAt = async (cursor?: string) => ready(await f.reader.readWorkLinePage(f.ctx, {
      workspace: f.base.scope, key: p, section: 'executions', page: { limit: 2,
        ...(cursor === undefined ? {} : { cursor }) } }));
    const first = await pageAt();
    const second = await pageAt(first.nextCursor!);
    if (first.section !== 'executions' || second.section !== 'executions') throw new Error('expected executions');

    // P is active, available and free: a real claim adds a newer execution.
    const walk = await f.checks.addCheckableGoal('g18walk', [{ taskId: 'w', title: 'Walk task' }]);
    const at = '2026-01-02T00:00:00.000Z';
    const claimed = await f.claimWith('w', p, { goal: walk, now: () => at, newId: () => 's2c-l-walk-w' });

    const third = await f.reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: p,
      section: 'executions', page: { limit: 2, cursor: second.nextCursor! } });
    expect(third.status).toBe('rejected');
    if (third.status !== 'rejected') throw new Error('expected a rejection');
    expect(third.code).toBe('source_stale');

    // From page 1 again the new execution sits in P's segment after Q1.
    const rereadFirst = await pageAt();
    if (rereadFirst.section !== 'executions') throw new Error('expected executions');
    const rereadSecond = await pageAt(rereadFirst.nextCursor!);
    if (rereadSecond.section !== 'executions') throw new Error('expected executions');
    expect(rereadSecond.items[0]?.kind).toBe('execution');
    if (rereadSecond.items[0]?.kind !== 'execution') throw new Error('expected an execution');
    expect(rereadSecond.items[0].runRef).toEqual(claimed.runRef);
  });

  it('2C-18 a new head on the chain makes an old cursor source_stale', async () => {
    const f = await lineFixture();
    const { p, h, goal } = await buildExecutionsLine(f);
    const pageAt = async (cursor?: string) => ready(await f.reader.readWorkLinePage(f.ctx, {
      workspace: f.base.scope, key: p, section: 'executions', page: { limit: 2,
        ...(cursor === undefined ? {} : { cursor }) } }));
    const first = await pageAt();
    if (first.section !== 'executions') throw new Error('expected the executions section');

    await f.createSession('s18-h2', { provenance: continuation(h, goal.tasks['e2']!) });
    const stale = await f.reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: p,
      section: 'executions', page: { limit: 2, cursor: first.nextCursor! } });
    expect(stale.status).toBe('rejected');
    if (stale.status !== 'rejected') throw new Error('expected a rejection');
    expect(stale.code).toBe('source_stale');

    const reread = await pageAt();
    if (reread.section !== 'executions') throw new Error('expected the executions section');
    expect(reread.items.map(itemKey)).toEqual([`execution:e1@${E1}`, `query:s2c-l-query-q1@${Q1}`]);
  });

  it('2C-18 the executions cursor binds the resolved head, so a predecessor key pages the same line', async () => {
    const f = await lineFixture();
    const { p, h } = await buildExecutionsLine(f);
    const first = ready(await f.reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: p,
      section: 'executions', page: { limit: 2 } }));
    if (first.section !== 'executions') throw new Error('expected the executions section');
    // The second page is read through the HEAD key; the cursor must still match.
    const next = ready(await f.reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: h,
      section: 'executions', page: { limit: 2, cursor: first.nextCursor! } }));
    if (next.section !== 'executions') throw new Error('expected the executions section');
    expect(next.items.map(itemKey)).toEqual([`execution:e2@${E2}`, `query:s2c-l-query-q2@${Q2}`]);
  });

  it('2C-18 a head created mid-page makes the retried page source_stale', async () => {
    const f = await lineFixture();
    const { p, h, goal } = await buildExecutionsLine(f);
    const wrapped = commitBeforeLookupOrdered(f.records,
      (request) => request.index === S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP && request.values[2] === h.sessionId,
      async (attempt) => {
        if (attempt !== 1) return;
        await f.createSession('s18-mid-h2', { provenance: continuation(h, goal.tasks['e2']!) });
      });
    const reader = f.readerWith(wrapped.records);
    const result = await reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: p,
      section: 'executions', page: { limit: 10 } });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected a rejection');
    expect(result.code).toBe('source_stale');
  });

  // L12 (review item 3b): `segments` must be built inside the accepted attempt.
  // A write between the stale first attempt and the retry changes H's segment
  // (its history becomes unreadable); the accepted page must report the accepted
  // attempt, not the stale first resolution.
  it('2C-18 (review item 3b) the returned segments come from the accepted attempt', async () => {
    const f = await lineFixture();
    const { p, h } = await buildExecutionsLine(f);
    const wrapped = commitBeforeLookupOrdered(f.records,
      (request) => request.index === S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP && request.values[2] === h.sessionId,
      async (attempt) => { if (attempt === 1) await f.runs.retire(h, 'missing'); });
    const reader = f.readerWith(wrapped.records);
    const page = ready(await reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: p,
      section: 'executions', page: { limit: 4 } }));
    if (page.section !== 'executions') throw new Error('expected the executions section');
    expect(page.segments.map((segment) => segment.session)).toEqual([p, h]);
    const hSegment = page.segments.find((segment) => segment.session.sessionId === h.sessionId);
    // Before the fix this was the stale first resolution's readable H segment.
    expect(hSegment?.history).toBe('not_readable');
  });

  it('2C-18/L23 gateChecks land only on the line responsible for the gate task', async () => {    const f = await lineFixture();
    const { p, h, goal, e1 } = await buildExecutionsLine(f);
    const gateTask: TaskTriple = { projectId: f.base.scope.projectId, goalId: 'g18', taskId: '__gate' };
    // Two responsible Sessions on one line: the round is still listed once.
    await f.link(h, { kind: 'task', ref: gateTask }, 'responsible', true);
    await f.link(p, { kind: 'task', ref: gateTask }, 'responsible', true);
    const round = await f.checks.openRound(e1.runRef, gateTask, goal.planRef, 'goal');

    const detail = ready(await f.reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: h }));
    if (detail.kind !== 'line') throw new Error(`expected a line, got ${detail.kind}`);
    expect(detail.gateChecks).toHaveLength(1);
    expect(detail.gateChecks[0]?.gateTask.taskId).toBe('__gate');
    expect(detail.gateChecks[0]?.roundRef).toEqual(round.ref);
    expect(detail.gateChecks[0]?.producerRunRef).toEqual(e1.runRef);
    expect(detail.gateChecks[0]?.status).toBe('open');

    // A line with no responsible link to the gate has no gate check.
    const other = (await f.createSession('s18-other')).ref;
    const otherDetail = ready(await f.reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: other }));
    if (otherDetail.kind !== 'line') throw new Error('expected a line');
    expect(otherDetail.gateChecks).toEqual([]);
  });

  it('2C-18 messages project queued, delivered, read and the disposition column', async () => {
    const f = await lineFixture();
    const { p, e1 } = await buildExecutionsLine(f);
    const mailbox = f.runs.mailbox();
    const sent = await mailbox.sendMessage(f.ctx, { input: { recipient: p, text: 'S2C-L hello',
      intent: 'inquiry', needsReply: true }, meta: { requestId: 's2c-l-msg-1', expected: [] } });
    if (sent.status !== 'committed') throw new Error(`send failed: ${JSON.stringify(sent)}`);
    const messageRef = sent.value.ref;
    const readOne = async () => {
      const page = ready(await f.reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: p,
        section: 'messages', page: { limit: 10 } }));
      if (page.section !== 'messages') throw new Error('expected the messages section');
      const item = page.items.find((entry) => entry.messageRef.messageId === messageRef.messageId);
      if (item === undefined) throw new Error('the sent message is not on the line');
      return item;
    };

    expect(await readOne()).toMatchObject({ delivery: 'queued', deliveredTo: null, read: false, responded: false,
      replyHandler: null, waitDisposition: null, undelivered: false,
      disposition: { availability: 'not_available', reason: 'slice_7' } });

    const current = await f.runs.readExecution(e1);
    const kernel = { adapterId: current.session.kernel.adapterId,
      kernelSessionId: current.session.kernel.kernelSessionId,
      runId: `s2c-l-kernel-run-${e1.runRef.runId}`, turnId: `s2c-l-kernel-turn-${e1.runRef.runId}`, position: 4 };
    const acceptInput = mailbox.recordInputAccepted;
    if (acceptInput === undefined) throw new Error('recordInputAccepted is not wired');
    const accepted = await acceptInput(f.ctx, { input: { messageRef, part: 'message',
      executionRef: e1.runRef, executionSessionRef: p, kernel },
      meta: { requestId: 's2c-l-accept-1', expected: [] } });
    if (accepted.status !== 'committed') throw new Error(`input acceptance failed: ${JSON.stringify(accepted)}`);
    const delivered = await readOne();
    expect(delivered.delivery).toBe('delivered');
    expect(delivered.deliveredTo?.executionRef).toEqual(e1.runRef);

  });

  it('2C-18 participation lists every work link and copies lists the answering copies', async () => {
    const f = await lineFixture();
    const { h, goal } = await buildExecutionsLine(f);
    await f.link(h, { kind: 'task', ref: goal.tasks['e2']! }, 'responsible', true);
    const consultation = await f.runs.beginConsultationCopy(h, 'p18copy');

    const participation = ready(await f.reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: h,
      section: 'participation', page: { limit: 10 } }));
    if (participation.section !== 'participation') throw new Error('expected participation');
    expect(participation.items.some((item) => item.relation === 'responsible'
      && item.target.kind === 'task' && item.target.ref.taskId === 'e2'
      && item.session.sessionId === h.sessionId)).toBe(true);

    const copies = ready(await f.reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: h,
      section: 'copies', page: { limit: 10 } }));
    if (copies.section !== 'copies') throw new Error('expected copies');
    expect(copies.items).toHaveLength(1);
    expect(copies.items[0]?.copy).toEqual(consultation.copy);
    expect(copies.items[0]?.lifecycle).toBe('active');
    expect(copies.items[0]?.messageRef.aggregateType).toBe('SessionMessage');
  });

  it('2C-18 executions list only the indexed Work claims and QueryRuns on a legacy Session', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g18legacy', [{ taskId: 'w', title: 'Legacy W task' }]);
    const l = await f.createLegacySession('s18-legacy');
    const at = '2026-01-03T00:00:00.000Z';
    const w = await f.claimWith('w', l, { goal, now: () => at, newId: () => 's2c-l-legacy-w' });
    await f.runs.enter(w.claim, at);
    await f.runs.recordResult(w.claim, completedEvent(w.claim, 'legacy-w'));

    // The §7 storage-boundary exception: a valid old QueryRun without executionState.
    // A real Query cannot be claimed on a null-provenance Session (the service
    // refuses `legacy_provenance_ambiguous`), so the session's real indexed
    // execution is the Work claim; the old Query is not a candidate.
    const legacyQueryRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: f.base.scope.projectId,
      workspaceId: f.base.scope.workspaceId, queryJobId: 'legacy-qjob', runId: 'legacy-qrun' };
    const legacyQuery: QueryRunSnapshot = { ref: legacyQueryRef, revision: 1, schemaVersion: 1,
      run: { schemaVersion: 1, queryJobRef: { aggregateType: 'QueryJob', projectId: f.base.scope.projectId,
        workspaceId: f.base.scope.workspaceId, queryJobId: 'legacy-qjob' }, runId: 'legacy-qrun',
        status: 'pending', startedAt: null, endedAt: null, outcome: null } };
    const committed = await f.base.commitRaw([encodeQueryRunSnapshotRecord(legacyQuery)]);
    if (committed.status !== 'committed') throw new Error(`legacy Query commit failed: ${JSON.stringify(committed)}`);

    const page = ready(await f.reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: l,
      section: 'executions', page: { limit: 10 } }));
    if (page.section !== 'executions') throw new Error('expected the executions section');
    expect(page.scope).toBe('indexed');
    expect(page.items.map(itemKey)).toEqual([`execution:w@${at}`]);
  });
});
