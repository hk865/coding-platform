/**
 * 2C-28 / 2C-30 (LE6, two bounded-read review residuals):
 *
 *  (a) `graph/hover` must batch the per-Task `readTaskArchiveState` through the
 *      Goal's one `listSessionAnomalies` read, so the archive-state port is hit
 *      only for Tasks with an outstanding anchor (shared cost, not once per
 *      Task).
 *  (b) the node-detail `participants` and `executions` sections must page over
 *      their underlying index cursor instead of an offset over a whole list
 *      built in memory, so one page reads only its own page.
 *
 * Store calls are counted with `countingNodeStore` (the injected store wrapper)
 * and port calls with a counting `SessionAnomalyPort`; the counts are the
 * observation, not the product's own numbers.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { SessionAnomalyAnchorV1, SessionAnomalyViewV1 } from '../../src/contracts/session-anomaly.js';
import type { SessionAnomalyPort } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { RUN_BY_TASK_INDEX } from '../../src/core/work-graph/tasks/plan-readers.js';
import {
  countingNodeStore, nodeReaderOf, openNodeFixture, type NodeFixture,
} from '../helpers/S2C-D-node-support.js';

const opened: NodeFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

const cursor = 'c0000000000' as CommitCursor;
const taskNode = (fixture: NodeFixture) => ({ kind: 'task' as const, ref: fixture.tasks['task-a']!, planRef: fixture.planRef });

function anchorOf(fixture: NodeFixture, taskId: string): SessionAnomalyAnchorV1 {
  const task = fixture.tasks[taskId]!;
  const runId = `s2c-d-bounded-anchor-${taskId}`;
  return {
    ref: { aggregateType: 'SessionAnomalyAnchor', projectId: fixture.scope.projectId,
      goalId: fixture.goalRef.goalId, runId },
    revision: 1, schemaVersion: 1, workspaceId: fixture.scope.workspaceId, task, planRef: fixture.planRef,
    lineHead: { projectId: fixture.scope.projectId, sessionId: 's1' },
    sessionRef: { projectId: fixture.scope.projectId, sessionId: 's1' },
    role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
    runRef: { aggregateType: 'Run', projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId, runId },
    attemptRef: { aggregateType: 'TaskAttempt', projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId,
      taskId, attemptId: `attempt-${taskId}` },
    cause: 'archive_interrupted', archiveRequestId: `request-${taskId}`,
    archiveRequestReceipt: { identityKey: `request-${taskId}-identity`, fingerprint: `request-${taskId}-fingerprint` },
    archivedBy: { kind: 'human', id: 's2c-d-operator' }, recordedAt: '2026-10-01T00:00:00.000Z',
    changedFiles: { source: 'kernel', status: 'known', confirmed: [], possible: [], omitted: 0,
      baseCommit: null, runBaselineKnown: false, reason: null },
    resultVerification: 'not_checked',
  };
}

/** Only `task-a` has one outstanding anchor; count both port methods. */
function countingAnomalies(fixture: NodeFixture): { port: SessionAnomalyPort; calls: { list: number; archive: string[] } } {
  const view: SessionAnomalyViewV1 = { anchor: anchorOf(fixture, 'task-a'), pickedUpBy: null };
  const calls = { list: 0, archive: [] as string[] };
  return { calls, port: {
    async recordSessionAnomaly() { return { status: 'rejected', code: 'unsupported', reason: 'not used' }; },
    async listSessionAnomalies() {
      calls.list += 1;
      return { status: 'ready', value: { items: [view], nextCursor: null, sourceCursor: cursor } };
    },
    async readTaskArchiveState(_ctx, task) {
      calls.archive.push(task.taskId);
      return task.taskId === 'task-a'
        ? { status: 'ready', value: { pending: [view], label: '中断，待核对', next: { kind: 'human_continue' as const } } }
        : { status: 'ready', value: { pending: [], label: null, next: null } };
    },
  } };
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe.each(['memory', 'sqlite'] as const)('node detail bounded reads (%s)', (kind) => {
  it('2C-28 the hover reads archive state only for tasks with an outstanding anchor', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const counted = countingNodeStore(fixture.records);
    const anomalies = countingAnomalies(fixture);
    const { reader } = nodeReaderOf(fixture, { records: counted.records, anomalies: anomalies.port });

    const hover = await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef });
    expect(hover.status).toBe('ready');
    if (hover.status !== 'ready') throw new Error(JSON.stringify(hover));

    // Before the fix `displayOf` called `readTaskArchiveState` once per Task row
    // (8 of them); the batch calls it only for the one Task with an anchor.
    expect(anomalies.calls.archive).toEqual(['task-a']);
    // One `listSessionAnomalies` read for the whole Goal (contract:
    // `listSessionAnomalies` itself is the shared per-Goal anchor read).
    expect(anomalies.calls.list).toBe(1);
    const taskA = hover.value.tasks.find((task) => task.task.taskId === 'task-a');
    expect(taskA?.display.anomaly?.next).toEqual({ code: 'anomaly_pending', params: { next: 'human_continue' }, refs: [] });
  });

  it('2C-30 the executions section reads only its own page from the run-by-task index', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    // Review item 7a: three REAL ended Runs of one Task (claim + real cancel +
    // real human requeue), never a hand-written RunSnapshot.
    const first = await fixture.createSession('exec-owner-1');
    await fixture.link(first, fixture.tasks['task-a']!, 'responsible', true);
    let previousRun = await fixture.endRun('task-a', first);
    for (const suffix of ['2', '3'] as const) {
      const requeued = await fixture.requeue('task-a', previousRun, { actor: 'human', requestId: `exec-requeue-${suffix}` });
      if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
        throw new Error(`the real human requeue did not commit: ${JSON.stringify(requeued)}`);
      }
      const reused = await fixture.createSession(`exec-owner-${suffix}`);
      previousRun = await fixture.endRun('task-a', reused, requeued.value.requeue.ref);
    }

    const counted = countingNodeStore(fixture.records);
    const { reader } = nodeReaderOf(fixture, { records: counted.records });
    const node = taskNode(fixture);

    const items: string[] = [];
    const perPageRecords: number[] = [];
    let after: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const before = counted.calls.length;
      const read = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'executions',
        page: { afterCursor: after, limit: 1 } });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready' || read.value.section !== 'executions') throw new Error(JSON.stringify(read));
      const runIndexRecords = counted.calls.slice(before)
        .filter((call): call is Extract<typeof call, { kind: 'lookup' }> => call.kind === 'lookup' && call.index === RUN_BY_TASK_INDEX)
        .reduce((sum, call) => sum + call.records, 0);
      perPageRecords.push(runIndexRecords);
      items.push(...read.value.items.map((item) => item.runRef.runId));
      after = read.value.nextCursor;
      if (after === null) break;
    }

    // Every page reads one candidate from the index, not the whole run history.
    expect(perPageRecords).toEqual([1, 1, 1]);
    expect(items).toHaveLength(3);
    expect(new Set(items).size).toBe(3);
  });

  it('2C-30 the claimed-participants branch pages the run-by-task index and returns the real source cursor', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const linked = await fixture.createSession('claimed-linked');
    const claimer = await fixture.createSession('claimed-owner');
    await fixture.link(linked, fixture.tasks['task-a']!, 'responsible', true);
    await fixture.claim('task-a', claimer);

    const counted = countingNodeStore(fixture.records);
    const { reader } = nodeReaderOf(fixture, { records: counted.records });
    const node = taskNode(fixture);

    const items: { id: string; via: string }[] = [];
    const runIndexRecords: number[] = [];
    let after: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const before = counted.calls.length;
      const read = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'participants',
        page: { afterCursor: after, limit: 1 } });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready' || read.value.section !== 'participants') throw new Error(JSON.stringify(read));
      const calls = counted.calls.slice(before);
      runIndexRecords.push(calls
        .filter((call): call is Extract<typeof call, { kind: 'lookup' }> => call.kind === 'lookup' && call.index === RUN_BY_TASK_INDEX)
        .reduce((sum, call) => sum + call.records, 0));
      // Item 3(c): the cursor is the real watermark the page's own reads
      // reported, never the fabricated zero.
      const watermarks = calls.flatMap((call) => 'readThrough' in call && call.readThrough !== null ? [call.readThrough] : []);
      expect(watermarks.length).toBeGreaterThan(0);
      expect(read.value.sourceCursor).not.toBe(cursor);
      expect(watermarks.map(String)).toContain(String(read.value.sourceCursor));
      items.push(...read.value.items.map((item) => ({ id: item.key.sessionId, via: item.via })));
      after = read.value.nextCursor;
      if (after === null) break;
    }

    // Both participants (the explicitly responsible Session and the claiming
    // Session) are covered with no repeats, and the claimed source read exactly
    // its own one-run index page (the claim also opens a responsible link, so
    // the claiming Session is already emitted by the responsible source).
    expect(items.map((item) => item.id).sort()).toEqual([claimer.sessionId, linked.sessionId].sort());
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
    expect(runIndexRecords.reduce((sum, value) => sum + value, 0)).toBe(1);
    // The old path loaded the whole canonical Run history (r3c-run-by-goal).
    expect(counted.calls.some((call) => call.kind === 'lookup' && call.index === 'r3c-run-by-goal')).toBe(false);
  });

  it('2C-30 the risks section returns the real source cursor of its Run read', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const counted = countingNodeStore(fixture.records);
    const { reader } = nodeReaderOf(fixture, { records: counted.records });
    const node = taskNode(fixture);

    const before = counted.calls.length;
    const read = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'risks',
      page: { afterCursor: null, limit: 20 } });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready' || read.value.section !== 'risks') throw new Error(JSON.stringify(read));
    const watermarks = counted.calls.slice(before)
      .flatMap((call) => 'readThrough' in call && call.readThrough !== null ? [call.readThrough] : []).map(String);
    expect(watermarks.length).toBeGreaterThan(0);
    expect(read.value.sourceCursor).not.toBe(cursor);
    expect(watermarks).toContain(String(read.value.sourceCursor));
  });

  it('2C-30 the participants section reads only its own page from session-links-by-task', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const sessions = await Promise.all(['p1', 'p2', 'p3'].map((id) => fixture.createSession(id)));
    for (const session of sessions) await fixture.link(session, fixture.tasks['task-a']!, 'responsible', true);

    const counted = countingNodeStore(fixture.records);
    const { reader } = nodeReaderOf(fixture, { records: counted.records });
    const node = taskNode(fixture);

    const items: string[] = [];
    let linkRecords = 0;
    let after: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const read = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'participants',
        page: { afterCursor: after, limit: 1 } });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready' || read.value.section !== 'participants') throw new Error(JSON.stringify(read));
      linkRecords = counted.calls
        .filter((call): call is Extract<typeof call, { kind: 'lookup' }> => call.kind === 'lookup' && call.index === 'session-links-by-task')
        .reduce((sum, call) => sum + call.records, 0);
      items.push(...read.value.items.map((item) => item.key.sessionId));
      after = read.value.nextCursor;
      if (after === null) break;
    }

    // Three responsible sessions, one link record read per page (before the fix
    // each page re-read all three for every relation).
    expect(linkRecords).toBe(3);
    expect(items).toHaveLength(3);
    expect(new Set(items).size).toBe(3);
  });

  it('2C-30 a malformed cursor or one issued for another section is invalid/cursor_mismatch', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const { reader } = nodeReaderOf(fixture);
    const node = taskNode(fixture);

    const malformed = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'executions',
      page: { afterCursor: 'not-a-cursor', limit: 5 } });
    expect(malformed).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' });

    const executionsCursor = base64url({ v: 1, section: 'executions', after: null });
    const wrongSection = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'participants',
      page: { afterCursor: executionsCursor, limit: 5 } });
    expect(wrongSection).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' });

    const risks = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node, section: 'risks',
      page: { afterCursor: executionsCursor, limit: 5 } });
    expect(risks).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' });
  });
});
