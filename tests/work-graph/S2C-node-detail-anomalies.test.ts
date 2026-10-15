/**
 * 2C-28 (LE6): the node detail's anomaly view and the Goal anomaly count.
 *
 * The reader is a pass-through of the injected `SessionAnomalyPort`
 * (`listSessionAnomalies` / `readTaskArchiveState`); it never recomputes
 * `claimable`/`reworkRefusal`. This test drives the port with a scripted
 * `SessionAnomalyPort` double carrying the five `next` kinds; the real archive
 * path that produces them is exercised at LE4 (2C-24/2C-32). The incomplete
 * answer makes the Goal count `partial`, never a number.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { SessionAnomalyAnchorV1, SessionAnomalyViewV1 } from '../../src/contracts/session-anomaly.js';
import type { SessionAnomalyPort } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { nodeReaderOf, openNodeFixture, type NodeFixture } from '../helpers/S2C-D-node-support.js';

const opened: NodeFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

const page = { afterCursor: null, limit: 20 };
const cursor = 'c0000000000' as CommitCursor;

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

/** 2C-28: more than one index page, so a truncated first page is not an exact total. */
function pagingAnomalies(fixture: NodeFixture, options: { firstPage: number; lastPage?: number; failSecond?: boolean }): SessionAnomalyPort {
  const viewAt = (index: number): SessionAnomalyViewV1 => {
    const runId = `s2c-d-anomaly-page-${index}`;
    const base = anchorOf(fixture, 'task-a');
    return { anchor: { ...base,
      ref: { aggregateType: 'SessionAnomalyAnchor', projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId, runId },
      runRef: { aggregateType: 'Run', projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId, runId },
      attemptRef: { aggregateType: 'TaskAttempt', projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId,
        taskId: 'task-a', attemptId: `attempt-${index}` } }, pickedUpBy: null };
  };
  return {
    async recordSessionAnomaly() { return { status: 'rejected', code: 'unsupported', reason: 'not used' }; },
    async listSessionAnomalies(_ctx, input) {
      if (input.page.cursor !== undefined && input.page.cursor !== null) {
        if (options.failSecond === true) return { status: 'rejected', code: 'incomplete', reason: 'second page failed' };
        const rest = Array.from({ length: options.lastPage ?? 0 }, (_, index) => viewAt(options.firstPage + index));
        return { status: 'ready', value: { items: rest, nextCursor: null, sourceCursor: cursor } };
      }
      const first = Array.from({ length: options.firstPage }, (_, index) => viewAt(index));
      const more = options.failSecond === true || (options.lastPage ?? 0) > 0;
      return { status: 'ready', value: { items: first, nextCursor: more ? 'page-2' : null, sourceCursor: cursor } };
    },
    async readTaskArchiveState() {
      return { status: 'ready', value: { pending: [viewAt(0)], label: '中断，待核对', next: null } };
    },
  };
}

describe.each(['memory', 'sqlite'] as const)('2C-28 node detail anomalies (%s)', (kind) => {
  it('2C-28 the task anomaly facts, the goal count and the incomplete count', async () => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const { reader } = nodeReaderOf(fixture, { anomalies: scriptedAnomalies(fixture, 'human_continue', false) });
    const taskNode = { kind: 'task' as const, ref: fixture.tasks['task-a']!, planRef: fixture.planRef };

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
    expect(anomalies.value.items[0]!.anchor.ref.runId).toBe('s2c-d-anomaly-run-task-a');

    const goalNode = { kind: 'goal' as const, ref: fixture.goalRef };
    const goal = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node: goalNode, section: 'summary', page });
    expect(goal.status).toBe('ready');
    if (goal.status !== 'ready' || goal.value.section !== 'summary') throw new Error(JSON.stringify(goal));
    expect(goal.value.goal?.anomalyCount).toEqual({ status: 'exact', value: 1 });

    const picked = nodeReaderOf(fixture, { anomalies: scriptedAnomalies(fixture, null, true) });
    const pickedPage = await picked.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node: taskNode, section: 'anomalies', page });
    expect(pickedPage.status).toBe('ready');
    if (pickedPage.status !== 'ready' || pickedPage.value.section !== 'anomalies') throw new Error(JSON.stringify(pickedPage));
    expect(pickedPage.value.items[0]!.pickedUpBy).not.toBeNull();

    const broken: SessionAnomalyPort = { ...scriptedAnomalies(fixture, null, false),
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
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const goalNode = { kind: 'goal' as const, ref: fixture.goalRef };

    const paged = nodeReaderOf(fixture, { anomalies: pagingAnomalies(fixture, { firstPage: 100, lastPage: 1 }) });
    const goal = await paged.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node: goalNode, section: 'summary', page });
    expect(goal.status).toBe('ready');
    if (goal.status !== 'ready' || goal.value.section !== 'summary') throw new Error(JSON.stringify(goal));
    expect(goal.value.goal?.anomalyCount).toEqual({ status: 'exact', value: 101 });

    const broken = nodeReaderOf(fixture, { anomalies: pagingAnomalies(fixture, { firstPage: 100, failSecond: true }) });
    const partial = await broken.reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node: goalNode, section: 'summary', page });
    expect(partial.status).toBe('ready');
    if (partial.status !== 'ready' || partial.value.section !== 'summary') throw new Error(JSON.stringify(partial));
    expect(partial.value.goal?.anomalyCount).toEqual({
      status: 'partial', atLeast: 100, reason: 'incomplete: second page failed',
    });
  });

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
