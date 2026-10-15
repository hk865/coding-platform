/**
 * 2C-28 (LE6, §3.9, §3.12, E3 D42-2): the task display "中断，待核对"
 * `<next>` for each of the five `TaskArchiveNextV1` kinds — `dispatch`,
 * `human_continue`, `goal_stopped` (paused and cancelled) and `rework_blocked`
 * — plus `next: null` ("等待推进") is the same result the `tasks/archive-state`
 * route reports at the same moment: same label, same pending count, and the
 * reason the §3.9 table maps the raw `next` to.
 *
 * Every archive state is built through REAL services over the fixture's own
 * records (never by substituting the archive-state owner): the claim and the
 * Run phases come from the real `TaskClaimPort` / `ExecutionEntryPort`, the
 * safe-point pause + interrupt from the real `RunControlPort` +
 * `RunReconcilePort`, the anchor from the real
 * `SessionLifecyclePort.requestSessionArchive` + `SessionAnomalyPort`
 * (`fixture.anomalies`), the Goal states from the real `setGoalControl`, and
 * the requeue/refusal from the real `TaskRequeuePort`. The `tasks/archive-state`
 * answer and the `NodeDetailReadPort` display are then read from that same real
 * `SessionAnomalyPort` (the LE6 entry is `readNodeDetail`). Expected reason
 * literals are the §3.9 table, never recomputed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RunRef, RuntimeEventV1, TaskTriple } from '../../src/contracts/dispatch.js';
import type { LineReasonV1 } from '../../src/contracts/work-line.js';
import type { TaskArchiveNextV1 } from '../../src/core/work-graph/state/session-anomaly.js';
import { nodeReaderOf, openNodeFixture, type NodeFixture } from '../helpers/S2C-D-node-support.js';

const opened: NodeFixture[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

const page = { afterCursor: null, limit: 20 };

/** The real `run_crashed` terminal event (the failed Run `rework_blocked` needs). */
function crashedEvent(claim: { runRef: RunRef }): RuntimeEventV1 {
  return { eventType: 'run_crashed', schemaVersion: 1, eventId: `s2c-d-next-crashed-${claim.runRef.runId}`,
    runRef: claim.runRef, sequence: 0, occurredAt: '2026-10-01T00:00:00.000Z',
    payload: { kind: 'crashed', error: 'S2C-D next-kinds fixture' } };
}

/**
 * Build one real archive state and return the Task whose `tasks/archive-state`
 * answer carries it. Each entry does exactly the public writes its kind needs.
 */
type Builder = (fixture: NodeFixture) => Promise<TaskTriple>;

/** A normal completed Run, then the real archive step (the "等待推进" state). */
const waiting: Builder = async (fixture) => {
  const session = await fixture.createSession('next-waiting');
  const claim = await fixture.claim('task-a', session);
  await fixture.runs.enter(claim);
  await fixture.runs.recordResult(claim, fixture.completedRunEvent(claim));
  await fixture.writeAnchor(session, claim.runRef, 'next-waiting');
  return fixture.tasks['task-a']!;
};

/** The same, then the real human "continue" requeue makes the Task claimable. */
const dispatch: Builder = async (fixture) => {
  const session = await fixture.createSession('next-dispatch');
  const claim = await fixture.claim('task-a', session);
  await fixture.runs.enter(claim);
  await fixture.runs.pauseAtSafePoint(claim);
  await fixture.runs.reconcileInterrupt(claim);
  await fixture.writeAnchor(session, claim.runRef, 'next-dispatch');
  const requeued = await fixture.requeue('task-a', claim.runRef, { requestId: 'next-dispatch-requeue' });
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
    throw new Error(`the real continue requeue did not commit: ${JSON.stringify(requeued)}`);
  }
  return fixture.tasks['task-a']!;
};

/** A human-paused Run interrupted by the restart: the real `paused_interrupted` fact. */
const humanContinue: Builder = async (fixture) => {
  const session = await fixture.createSession('next-human');
  const claim = await fixture.claim('task-a', session);
  await fixture.runs.enter(claim);
  await fixture.runs.pauseAtSafePoint(claim);
  await fixture.runs.reconcileInterrupt(claim);
  await fixture.writeAnchor(session, claim.runRef, 'next-human');
  return fixture.tasks['task-a']!;
};

/** A completed Run + anchor, then the real Goal control. */
const goalStopped = (desired: 'paused' | 'cancelled'): Builder => async (fixture) => {
  const session = await fixture.createSession(`next-goal-${desired}`);
  const claim = await fixture.claim('task-a', session);
  await fixture.runs.enter(claim);
  await fixture.runs.recordResult(claim, fixture.completedRunEvent(claim));
  await fixture.writeAnchor(session, claim.runRef, `next-goal-${desired}`);
  await fixture.setGoalDesired(desired);
  return fixture.tasks['task-a']!;
};

/** A failed Run + anchor, then the real automatic requeue refused at the cap. */
const reworkBlocked: Builder = async (fixture) => {
  const session = await fixture.createSession('next-rework');
  const claim = await fixture.claim('task-a', session);
  await fixture.runs.enter(claim);
  await fixture.runs.recordResult(claim, crashedEvent(claim));
  await fixture.writeAnchor(session, claim.runRef, 'next-rework');
  const refused = await fixture.requeue('task-a', claim.runRef,
    { actor: 'system', autoReworkLimit: 0, requestId: 'next-rework-refusal' });
  if (refused.status !== 'committed' || refused.value.kind !== 'refused') {
    throw new Error(`the real automatic requeue was not refused: ${JSON.stringify(refused)}`);
  }
  return fixture.tasks['task-a']!;
};

/** The §3.9 literal reason for each real archive state (independent of the product). */
const cases: {
  name: string; next: TaskArchiveNextV1 | null; reason: LineReasonV1; build: Builder;
}[] = [
  { name: 'dispatch (等待派工)', next: { kind: 'dispatch' }, build: dispatch,
    reason: { code: 'anomaly_pending', params: { next: 'dispatch' }, refs: [] } },
  { name: 'human_continue (等你点“继续”)', next: { kind: 'human_continue' }, build: humanContinue,
    reason: { code: 'anomaly_pending', params: { next: 'human_continue' }, refs: [] } },
  { name: 'goal_stopped paused (目标已暂停)', next: { kind: 'goal_stopped', desiredState: 'paused' },
    build: goalStopped('paused'),
    reason: { code: 'anomaly_pending', params: { next: 'goal_stopped', goal: 'paused' }, refs: [] } },
  { name: 'goal_stopped cancelled (目标已取消)', next: { kind: 'goal_stopped', desiredState: 'cancelled' },
    build: goalStopped('cancelled'),
    reason: { code: 'anomaly_pending', params: { next: 'goal_stopped', goal: 'cancelled' }, refs: [] } },
  { name: 'rework_blocked (不能自动返工)', next: { kind: 'rework_blocked', code: 'auto_rework_cap_reached' },
    build: reworkBlocked,
    reason: { code: 'anomaly_pending', params: { next: 'rework_blocked', code: 'auto_rework_cap_reached' }, refs: [] } },
  { name: 'waiting (等待推进)', next: null, build: waiting,
    reason: { code: 'anomaly_pending', params: {}, refs: [] } },
];

describe.each(['memory', 'sqlite'] as const)('2C-28 task display next kinds (%s)', (kind) => {
  it.each(cases)('2C-28 the task display $name next equals the same-moment tasks/archive-state result', async (entry) => {
    const fixture = await openNodeFixture(kind);
    opened.push(fixture);
    const task = await entry.build(fixture);
    const { reader } = nodeReaderOf(fixture);
    const taskNode = { kind: 'task' as const, ref: task, planRef: fixture.planRef };

    // The same-moment `tasks/archive-state` result (its route binding, the real owner).
    const state = await fixture.anomalies.readTaskArchiveState(fixture.ctx, task);
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') throw new Error(JSON.stringify(state));
    expect(state.value.next).toEqual(entry.next);
    expect(state.value.label).toBe('中断，待核对');

    const summary = await reader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef, node: taskNode, section: 'summary', page });
    expect(summary.status).toBe('ready');
    if (summary.status !== 'ready' || summary.value.section !== 'summary') throw new Error(JSON.stringify(summary));
    expect(summary.value.task?.display.anomaly).toEqual({
      label: state.value.label,
      next: entry.reason,
      pending: { status: 'exact', value: state.value.pending.length },
    });
  });
});
