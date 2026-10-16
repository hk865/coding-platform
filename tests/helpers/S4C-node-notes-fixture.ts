/**
 * Slice 4C-1 RW-15: the R-02 node-detail notes-row fixture.
 *
 * `openNodeFixture` (2C-D) builds a hand-rolled backend with no notes, and
 * `createS4ANoteFixture` (4A) builds a real `createTargetPlatform` with notes
 * but cannot archive a Run. This helper bridges the two: it opens the real 4A
 * platform and adds one real archived Run's anomaly anchor for a Task, so the
 * node-detail notes column (written through the public `platform.notes` route)
 * can sit side by side with a real anomaly anchor.
 *
 * Everything goes through public ports; the record store is never read.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from './S4A-note-fixture.js';

export type S4CNodeNotesFixture = {
  kind: S4ANoteFixtureKind;
  platform: S4ANoteFixture['platform'];
  ctx(): CoreCallContext;
  goalRef: GoalRef;
  planRef: PlanRevisionRef;
  /** The real `TaskTriple` a task node's `ref` uses. */
  task(taskId: string): TaskTriple;
  /**
   * Claim a Run of `taskId` in a fresh executor Session, end it through the
   * public cancel control, then make the real `requestSessionArchive` request
   * and record its `SessionAnomalyAnchor`. Returns the archived `RunRef`.
   */
  archiveRun(taskId: string, suffix: string): Promise<RunRef>;
  close(): Promise<void>;
};

export async function createS4CNodeNotesFixture(kind: S4ANoteFixtureKind): Promise<S4CNodeNotesFixture> {
  const inner = await createS4ANoteFixture(kind);
  const platform = inner.platform;
  let seq = 0;

  async function archiveRun(taskId: string, suffix: string): Promise<RunRef> {
    const ctx = inner.ctx();
    const session = (await inner.createSession(`rw15-${suffix}`, 'executor')).sessionRef;
    const runRef = await inner.claimInSession(`rw15-${suffix}`, session, taskId, 'executor');
    // RUN-09: a stop on a not-entered Run ends its Attempt, Outbox, Lease and
    // Session occupancy through the public control port.
    const execution = await platform.executions.readExecution(ctx, runRef);
    if (execution.status !== 'ready') throw new Error(`RW-15 execution read failed: ${JSON.stringify(execution)}`);
    const cancelled = await platform.controls.submitControl(ctx, {
      input: { runRef, kind: 'cancel', reason: 'RW-15 real archived Run' },
      meta: { requestId: `rw15-cancel-${++seq}`,
        expected: [{ ref: runRef, revision: execution.value.run.revision }] } });
    if (cancelled.status !== 'committed') throw new Error(`RW-15 cancel failed: ${JSON.stringify(cancelled)}`);

    const card = await platform.sessions.readSession(ctx, session);
    if (card.status !== 'ready') throw new Error(`RW-15 session read failed: ${JSON.stringify(card)}`);
    const requested = await platform.sessions.requestSessionArchive(ctx, {
      input: { sessionRef: session, reason: 'RW-15 real archived Run', tasks: [], wait: null,
        confirmUnknownStopped: false },
      meta: { requestId: `rw15-archive-${++seq}`,
        expected: [{ ref: { aggregateType: 'Session', projectId: session.projectId, sessionId: session.sessionId },
          revision: card.value.record.revision }] } });
    if (requested.status !== 'committed') throw new Error(`RW-15 archive request failed: ${JSON.stringify(requested)}`);
    const request = requested.value.archiveRequest;
    if (request === null || request === undefined) throw new Error('RW-15 archive request is missing');
    const recorded = await platform.sessionAnomalies.recordSessionAnomaly(ctx, {
      step: { sessionRef: session, archiveRequestId: request.requestId, requestReceipt: request.receipt,
        step: 'anchor', subjectKey: canonicalJson(runRef as unknown as JsonValue) },
      files: { source: 'kernel', status: 'known', confirmed: [], possible: [], omitted: 0, baseCommit: null,
        runBaselineKnown: false, reason: null } });
    if (recorded.status !== 'committed') throw new Error(`RW-15 anomaly anchor failed: ${JSON.stringify(recorded)}`);
    return runRef;
  }

  return {
    kind, platform, ctx: inner.ctx, goalRef: inner.goalRef, planRef: inner.planRef,
    task: (taskId) => ({ projectId: inner.scope.projectId, goalId: inner.goalRef.goalId, taskId }),
    archiveRun, close: inner.close,
  };
}
