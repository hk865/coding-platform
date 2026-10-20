/**
 * 2C-28 (LE6): the node detail's anomaly view and the Goal anomaly count.
 *
 * The reader is a pass-through of the injected `SessionAnomalyPort`
 * (`listSessionAnomalies` / `readTaskArchiveState`); it never recomputes
 * `claimable`/`reworkRefusal`. The facts the first two rows read come from the
 * fixture's real line (`openRuntimeLine`, the 2C-32 path below the Host): the
 * Session from the Session operations owner, the Run entered by the real
 * Runtime, the person's pause stopping the Kernel Turn at its safe point, the
 * Host restart booked by the production start-up classifier (W-20, RUN-24),
 * the anchor written by the real `sessions/archive-line` composition, the
 * person's 继续 through the real `tasks/requeue` owner and the pickup by a Run
 * the real Runtime enters in another Session. The 101 anchors come from 101
 * real archives. Only the failing read (the `incomplete` answer and the
 * second page) is an A2 dependency failure; the successful page and its
 * cursor are the real read's own.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { SessionAnomalyAnchorV1, SessionAnomalyViewV1 } from '../../src/contracts/session-anomaly.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { SessionAnomalyPort } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { nodeReaderOf, openNodeFixture, type NodeFixture } from '../helpers/S2C-D-node-support.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';

const opened: NodeFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

const page = { afterCursor: null, limit: 20 };
const cursor = 'c0000000000' as CommitCursor;

/** Two tool-group replies: the person's pause lands at the first safe point (2C-23/2C-32's script). */
const PAUSED_TURN: readonly ScriptedReply[] = [
  { kind: 'calls', calls: [{ callId: 's2c-d-anomaly-g1', name: 'read', args: { path: 's2c-d-line-read.txt' } }] },
  { kind: 'calls', calls: [{ callId: 's2c-d-anomaly-g2', name: 'read', args: { path: 's2c-d-line-read.txt' } }] },
];
/** The continuation Run's reply; it stays held at the model gate once the Run entered. */
const CONTINUATION_TURN: readonly ScriptedReply[] = [{ kind: 'text', text: '2C-28: the continuation Run' }];

function anchorOf(fixture: NodeFixture, taskId: string): SessionAnomalyAnchorV1 {
  const task = fixture.tasks[taskId]!;
  const runId = `s2c-d-anomaly-run-${taskId}`;
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
    changedFiles: { source: 'kernel', status: 'known', confirmed: ['m/a.ts'], possible: ['m/b.ts'], omitted: 0,
      baseCommit: null, runBaselineKnown: false, reason: null },
    resultVerification: 'not_checked',
  };
}

/**
 * The 2C-28 hover row keeps the archive-state read failure visible. Its prior
 * state is the scripted port this file keeps only for that row; the two rows
 * above use the real owner.
 */
function scriptedAnomalies(fixture: NodeFixture, nextKind: 'dispatch' | 'human_continue' | 'goal_stopped' | 'rework_blocked' | null,
  pickedUp: boolean): SessionAnomalyPort {
  const anchor = anchorOf(fixture, 'task-a');
  const view: SessionAnomalyViewV1 = { anchor, pickedUpBy: pickedUp
    ? { aggregateType: 'Run', projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId, runId: 'picked-up' } : null };
  const next = nextKind === 'goal_stopped' ? { kind: 'goal_stopped' as const, desiredState: 'paused' as const }
    : nextKind === 'rework_blocked' ? { kind: 'rework_blocked' as const, code: 'rework_cap' as never }
      : nextKind === null ? null : { kind: nextKind };
  return {
    async recordSessionAnomaly() { return { status: 'rejected', code: 'unsupported', reason: 'not used' }; },
    async listSessionAnomalies(_ctx, input) {
      return { status: 'ready', value: { items: input.taskId === undefined || input.taskId === 'task-a' ? [view] : [],
        nextCursor: null, sourceCursor: cursor } };
    },
    async readTaskArchiveState(_ctx, task) {
      return task.taskId === 'task-a'
        ? { status: 'ready', value: { pending: [view], label: '中断，待核对', next } }
        : { status: 'ready', value: { pending: [], label: null, next: null } };
    },
  };
}

describe.each(['memory', 'sqlite'] as const)('2C-28 node detail anomalies (%s)', (kind) => {
  it('2C-28 the task anomaly facts, the goal count and the incomplete count', async () => {
    const fixture = await openNodeFixture(kind, { runtimeLine: true });
    opened.push(fixture);
    const taskNode = { kind: 'task' as const, ref: fixture.tasks['task-a']!, planRef: fixture.planRef };
    const goalNode = { kind: 'goal' as const, ref: fixture.goalRef };
    const { reader } = nodeReaderOf(fixture);
    const line = await fixture.openRuntimeLine();

    // RUN-24 (2C-32): the real Runtime enters the Run, the person pauses it at
    // its safe point, and the Host restarts; the start-up classifier books W-20.
    const first = await line.createSession('anomaly-first');
    const firstClaim = await fixture.claim('task-a', first);
    const firstRun = await line.start(firstClaim, PAUSED_TURN);
    await line.pauseAtSafePoint(firstRun);
    const restarted = await line.restart(firstClaim.runRef, 's2c-d-anomaly-host-2');
    expect(restarted, JSON.stringify(restarted)).toMatchObject({ row: 'W-20', status: 'reconciled' });
    // §3.7 E9: the person archives the retired line; the archive composition
    // writes the anchor of the interrupted Run. The fixture's claim opens no
    // responsible link, so the line has no responsibility to dispose.
    const archived = await line.archiveLine(first, [], 'anomaly-first-archive');
    expect(archived.state).toBe('archived');

    const task = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node: taskNode, section: 'summary', page });
    expect(task.status).toBe('ready');
    if (task.status !== 'ready' || task.value.section !== 'summary') throw new Error(JSON.stringify(task));
    expect(task.value.task?.display.anomaly).toEqual({
      label: '中断，待核对',
      next: { code: 'anomaly_pending', params: { next: 'human_continue' }, refs: [] },
      pending: { status: 'exact', value: 1 },
    });

    const anomalies = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node: taskNode, section: 'anomalies', page });
    expect(anomalies.status).toBe('ready');
    if (anomalies.status !== 'ready' || anomalies.value.section !== 'anomalies') throw new Error(JSON.stringify(anomalies));
    expect(anomalies.value.items).toHaveLength(1);
    expect(anomalies.value.items[0]!.pickedUpBy).toBeNull();
    expect(anomalies.value.items[0]!.anchor.ref.runId).toBe(firstClaim.runRef.runId);

    const goal = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node: goalNode, section: 'summary', page });
    expect(goal.status).toBe('ready');
    if (goal.status !== 'ready' || goal.value.section !== 'summary') throw new Error(JSON.stringify(goal));
    expect(goal.value.goal?.anomalyCount).toEqual({ status: 'exact', value: 1 });

    // The person continues (继续): the Task is requeued and a DIFFERENT Session
    // claims it; once the real Runtime enters that Run, the pickup reports it.
    const requeued = await line.requeue('task-a', firstClaim.runRef, 'anomaly-continue');
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
      throw new Error(`the real continue requeue did not commit: ${JSON.stringify(requeued)}`);
    }
    const second = await line.createSession('anomaly-second');
    expect(second.sessionId).not.toBe(first.sessionId);
    const secondClaim = await fixture.claim('task-a', second, requeued.value.requeue.ref);
    const secondRun = await line.start(secondClaim, CONTINUATION_TURN);
    await secondRun.entered;

    const pickedPage = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node: taskNode, section: 'anomalies', page });
    expect(pickedPage.status).toBe('ready');
    if (pickedPage.status !== 'ready' || pickedPage.value.section !== 'anomalies') throw new Error(JSON.stringify(pickedPage));
    expect(pickedPage.value.items[0]!.pickedUpBy).toEqual(secondClaim.runRef);

    const broken: SessionAnomalyPort = { ...fixture.anomalies,
      async listSessionAnomalies() { return { status: 'rejected', code: 'incomplete', reason: 'anomaly read capped' }; } };
    const partial = nodeReaderOf(fixture, { anomalies: broken });
    const goalPartial = await partial.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node: goalNode, section: 'summary', page });
    expect(goalPartial.status).toBe('ready');
    if (goalPartial.status !== 'ready' || goalPartial.value.section !== 'summary') throw new Error(JSON.stringify(goalPartial));
    expect(goalPartial.value.goal?.anomalyCount).toEqual({
      status: 'partial', atLeast: 0, reason: 'incomplete: anomaly read capped',
    });
  });

  it('2C-28 the goal anomaly count pages the index to the end, never a truncated exact total', async () => {
    const fixture = await openNodeFixture(kind, { runtimeLine: true });
    opened.push(fixture);
    const goalNode = { kind: 'goal' as const, ref: fixture.goalRef };
    const line = await fixture.openRuntimeLine();

    // 101 anchors from 101 real archives: each cycle a new Session claims the
    // Task and the person archives that line through `sessions/archive-line`;
    // the archive stops the not-yet-entered Run, writes its anchor and requeues
    // the Task, and the next claim takes the covering requeue the public Task
    // graph reads. Hand count: one anchor per cycle, 101 cycles = 101 anchors,
    // one more than a 100-item index page.
    let requeueRef: TaskRequeueRef | undefined;
    for (let index = 0; index < 101; index += 1) {
      const session = await line.createSession(`anomaly-page-${index}`);
      await fixture.claim('task-a', session, requeueRef);
      const archived = await line.archiveLine(session, [], `anomaly-page-archive-${index}`);
      if (archived.state !== 'archived') throw new Error(`the real archive did not finish: ${JSON.stringify(archived)}`);
      requeueRef = await line.requeueRefOf('task-a');
    }

    const paged = nodeReaderOf(fixture);
    const goal = await paged.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node: goalNode, section: 'summary', page });
    expect(goal.status).toBe('ready');
    if (goal.status !== 'ready' || goal.value.section !== 'summary') throw new Error(JSON.stringify(goal));
    expect(goal.value.goal?.anomalyCount).toEqual({ status: 'exact', value: 101 });

    // Only the SECOND page fails: the first page and its cursor stay the real
    // read's own (the count reaches 100 and then the dependency fails).
    const broken: SessionAnomalyPort = { ...fixture.anomalies,
      async listSessionAnomalies(ctx, input) {
        if (input.page.cursor !== undefined && input.page.cursor !== null) {
          return { status: 'rejected', code: 'incomplete', reason: 'second page failed' };
        }
        return fixture.anomalies.listSessionAnomalies(ctx, input);
      } };
    const partial = nodeReaderOf(fixture, { anomalies: broken });
    const goalPartial = await partial.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node: goalNode, section: 'summary', page });
    expect(goalPartial.status).toBe('ready');
    if (goalPartial.status !== 'ready' || goalPartial.value.section !== 'summary') throw new Error(JSON.stringify(goalPartial));
    expect(goalPartial.value.goal?.anomalyCount).toEqual({
      status: 'partial', atLeast: 100, reason: 'incomplete: second page failed',
    });
    // R-14 (W2b-08): the 101 real archives measured 34.2 s, 45.3 s and 49.4 s on
    // SQLite and 10.8 s and 11.2 s on memory (`--maxWorkers=2`, other test runs on
    // the machine).
  }, 120_000);

  it('2C-28 a failed archive-state read stays visible: the hover keeps the row with a problem', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const taskNode = { kind: 'task' as const, ref: fixture.tasks['task-a']!, planRef: fixture.planRef };
    const broken: SessionAnomalyPort = { ...scriptedAnomalies(fixture, null, false),
      async readTaskArchiveState() {
        return { status: 'rejected', code: 'unavailable', reason: 'injected archive-state failure' };
      } };
    const { reader } = nodeReaderOf(fixture, { anomalies: broken });

    const summary = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node: taskNode, section: 'summary', page });
    expect(summary.status).toBe('rejected');
    if (summary.status !== 'rejected') throw new Error(JSON.stringify(summary));
    expect(summary.reason).toContain('injected archive-state failure');

    const hover = await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef });
    expect(hover.status).toBe('ready');
    if (hover.status !== 'ready') throw new Error(JSON.stringify(hover));
    expect(hover.value.tasks.some((task) => task.task.taskId === 'task-a')).toBe(true);
    expect(hover.value.problems).toContainEqual(expect.objectContaining({
      node: expect.objectContaining({ kind: 'task' }),
      reason: expect.stringContaining('injected archive-state failure'),
    }));
  });
});
