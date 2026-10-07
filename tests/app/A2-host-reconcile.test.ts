/**
 * A.2 step 5.6: the start-up reconcile of a Run caught mid-Turn with a pause queued, and the
 * continuation seeded with the original Session's history, through real Hosts on one SQLite ledger
 * and Kernel store (docs/refactor/STATE-MACHINES-SPEC.md §6 RUN-24, §7 CTL-08(f), §12.2 W-20,
 * §12.7 G-05, LA-1, contract (e)).
 *
 * A.2 step 6 moved this file's cases to tests/scenarios/ (A7-control, A8-host-restart,
 * A8-host-restart-lease, A10-check-recovery). The two cases left here wait for their new home,
 * tests/scenarios/A8-host-restart-paused.test.ts (A8-3m, A8-3r), which is not committed yet: that
 * file also holds A8-3p, open on a lead decision (§16 GAP-50 (ii)). Commit that file together
 * with the deletion of this one (user decision 31: each case once).
 *
 * A crash is simulated by abandoning a running Host: its execution is blocked
 * inside a scripted model request, so its Kernel Turn is open; its lock is
 * rewritten to name an exited process and the next Host takes it over (HL-03).
 * The abandoned Host is released (its model request fails) and closed after
 * the assertions; its late writes are refused by the records the reconcile
 * wrote.
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import type { TaskExecutionRecord } from '../../src/app/core-http-types.js';
import type { ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import {
  AG2B_SCOPE, cleanupAG2b, graphWrite, plain, seedAG2bWorkGraph, startAG2bHost, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  advanceUntil, cleanupRestart, deferred, driveWorkflow, post, publicDirectory, readControl, readExecution, selectWork, submitControl,
  tempDir, workRow, writeStaleLock,
} from '../helpers/A2-restart-fixture.js';

afterEach(async () => {
  await cleanupAG2b();
  await cleanupRestart();
});

const READ_THEN_TEXT = [
  { kind: 'calls' as const, calls: [{ callId: 'a2-crash-read', name: 'read', args: { path: 'src/module.ts' } }] },
  { kind: 'text' as const, text: 'A2 crash: never answered on the crashed Host' }];

type Crashed = {
  first: AG2bHost;
  runRef: RunRef;
  /** The crashed Host's in-flight Workflow `start` step; settles once the Host is released. */
  inFlight: Promise<unknown>;
  release(): Promise<void>;
};

/**
 * Host 1 enters the work Run; the Turn completes a `read` tool group, then the
 * second model request blocks (the Kernel Turn stays open). `beforeBlock`
 * acts on Host 1 while the first request runs (a steer here is accepted by the
 * Kernel at the second model boundary); `whileBlocked` acts while the second
 * request blocks (a control here stays queued). Then the lock is rewritten as a
 * crashed Host leaves it.
 */
async function crashMidTurn(root: string, database: string, publicDir: string, actions: {
  beforeBlock?: (host: AG2bHost, runRef: RunRef) => Promise<void>;
  whileBlocked?: (host: AG2bHost, runRef: RunRef) => Promise<void>;
}): Promise<Crashed> {
  const reached = deferred();
  const hold = deferred();
  const firstRequest = deferred<RunRef>();
  let first: AG2bHost | undefined;
  first = await startAG2bHost(publicDir, { root, database, replies: READ_THEN_TEXT,
    beforeReply: async (_request, index) => {
      if (first === undefined) return;
      if (index === 0) {
        const runRef = (await workRow(first)).execution;
        if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
        await actions.beforeBlock?.(first, runRef);
        firstRequest.resolve(runRef);
        return;
      }
      reached.resolve();
      await hold.promise;
    } });
  await seedAG2bWorkGraph(first);
  const start = await advanceUntil(first, selectWork('a2-crash'), 'start');
  const inFlight = post(first, 'workflow/advance', plain(AG2B_SCOPE, start)).catch(() => undefined);
  const runRef = await firstRequest.promise;
  await reached.promise;
  await actions.whileBlocked?.(first, runRef);
  expect(first.scripted.calls(), 'the second model request is in flight on the crashed Host').toBe(2);
  await writeStaleLock(database);
  const host = first;
  return { first: host, runRef, inFlight, async release() {
    hold.reject(new Error('A2 crash: the crashed Host never answers this request'));
    await inFlight;
    await host.host.close();
  } };
}


it('G-05, W-20 and CTL-08(f): a pause queued before the safe point ends the Run paused-interrupted at the restart (kernelPaused false); the pause is applied by the platform', async () => {
  const root = await tempDir('a2-crash-pause-ws-');
  const database = await tempDir('a2-crash-pause-db-');
  const publicDir = await publicDirectory();
  let pauseRef: ControlIntentSnapshotV1['ref'] | undefined;
  const crashed = await crashMidTurn(root, database, publicDir, {
    whileBlocked: async (host, runRef) => { pauseRef = (await submitControl(host, runRef, 'pause', 'pause the Run', 'a2-crash-pause')).intent.ref; },
  });
  const second = await startAG2bHost(publicDir, { root, database });
  try {
    if (pauseRef === undefined) throw new Error('the pause must be submitted');
    const hostInstanceId = second.host.reconcile.hostInstanceId;
    expect(second.host.reconcile).toMatchObject({ report: {
      runs: [{ ref: JSON.stringify(crashed.runRef), row: 'W-20', status: 'reconciled', reason: 'interrupted_clean' }] } });
    const ended = await readExecution(second, crashed.runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { observation: { kind: 'interrupted_clean', kernelPaused: false, pausedIntentRef: pauseRef } } });
    // CI-11: the queued pause is applied by the platform conclusion, never by a Kernel `run.paused` (CD-1).
    expect(await readControl(second, pauseRef)).toMatchObject({ status: 'applied', observation: { origin: 'platform_reconcile',
      kind: 'paused', detail: { hostInstanceId, runOutcome: 'crashed' } } });
    expect(await workRow(second)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted',
      detail: { kernelPaused: false, pausedIntentRef: pauseRef } } });
  } finally {
    await crashed.release();
    await second.host.close();
  }
}, 180_000);


it('LA-1 and contract (e) (A8-3l step 5, A8-3r): the continuation in a new Session is seeded with the original Session\'s completed history and says so; a later requeue after a never-entered continuation keeps that source', async () => {
  const root = await tempDir('a2-seeded-ws-');
  const database = await tempDir('a2-seeded-db-');
  const publicDir = await publicDirectory();
  const RUN0_TASK = 'ag2b-work-0';
  const RUN0_TEXT = 'A2 Run0: the completed history the continuation keeps';
  let first: AG2bHost | undefined;
  let pauseRef: ControlIntentSnapshotV1['ref'] | undefined;
  first = await startAG2bHost(publicDir, { root, database, replies: [
    { kind: 'calls', calls: [{ callId: 'a2-seeded-run0-edit', name: 'edit',
      args: { mode: 'create', path: 'src/ag2b-result.txt', newText: 'AG2B_RESULT_FROM_A' } }] },
    { kind: 'text', text: RUN0_TEXT },
    { kind: 'calls', calls: [{ callId: 'a2-seeded-interrupted-read', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 'never reached: the Run pauses' }],
  beforeReply: async (_request, index) => {
    if (index !== 2 || first === undefined) return;
    const runRef = (await workRow(first)).execution;
    if (runRef === null) throw new Error('the work Task must have a Run');
    pauseRef = (await submitControl(first, runRef, 'pause', 'pause before the restart', 'a2-seeded-pause')).intent.ref;
  } });
  let originalSession: TaskExecutionRecord['session'];
  let interrupted: RunRef;
  try {
    await seedAG2bWorkGraph(first, [RUN0_TASK, 'ag2b-work']);
    // Run0 of another Task completes in Session S1 (its history cursor moves).
    await driveWorkflow(first, { ...selectWork('a2-seeded-run0'), taskId: RUN0_TASK });
    const run0Ref = (await workRow(first, RUN0_TASK)).execution;
    if (run0Ref === null) throw new Error('Run0 must exist');
    const run0 = await readExecution(first, run0Ref);
    expect(run0.run).toMatchObject({ status: 'ended', outcome: 'completed' });
    // The work Task's Run in the same Session pauses at the safe point after its first tool call.
    expect((await driveWorkflow(first, { ...selectWork('a2-seeded-run1'),
      sessionHint: { projectId: run0.session.ref.projectId, sessionId: run0.session.ref.sessionId } })).at(-1))
      .toMatchObject({ state: 'waiting' });
    const runRef = (await workRow(first)).execution;
    if (runRef === null || pauseRef === undefined) throw new Error('the paused Run must exist');
    interrupted = runRef;
    const paused = await readExecution(first, runRef);
    expect(paused.session.ref.sessionId, 'the work Task runs in the Session Run0 completed in').toBe(run0.session.ref.sessionId);
    expect(paused.session.historyCursor).not.toBeNull();
    originalSession = paused.session;
  } finally {
    await first.host.close();
  }
  await writeStaleLock(database);

  const second = await startAG2bHost(publicDir, { root, database, replies: [{ kind: 'text', text: 'A2 seeded: continued in a new Session' }] });
  try {
    expect(second.host.reconcile).toMatchObject({ report: { runs: [{ ref: JSON.stringify(interrupted), row: 'W-20' }] } });
    const ended = await readExecution(second, interrupted);
    const requeue = async (afterRunRef: RunRef, requestId: string) => {
      const goal = await post<{ status: string; value: { goal: { revision: number } } }>(second, 'goals/read', plain(AG2B_SCOPE, { aggregateType: 'Goal', projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal' }));
      const run = await readExecution(second, afterRunRef);
      const written = await post<WriteResult<{ kind: string }>>(second, 'tasks/requeue', graphWrite(AG2B_SCOPE,
        { taskRef: { projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal', taskId: 'ag2b-work' }, afterRunRef, reason: 'continue' }, requestId,
        [{ ref: { aggregateType: 'Goal', projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal' }, revision: goal.value.goal.revision },
          { ref: afterRunRef, revision: run.run.revision }]));
      expect(written, requestId).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
    };
    await requeue(interrupted, 'a2-seeded-continue');
    // The continuation r2 is claimed in a new Session (LA-1) and prepared, then cancelled before it enters (D-7).
    await advanceUntil(second, selectWork('a2-seeded-r2', true), 'start');
    const r2Ref = (await workRow(second)).execution;
    if (r2Ref === null || r2Ref.runId === interrupted.runId) throw new Error('the continuation r2 must be claimed');
    const r2 = await readExecution(second, r2Ref);
    expect(r2.session.ref.sessionId).not.toBe(originalSession.ref.sessionId);
    const seededFrom = { sessionRef: { projectId: originalSession.ref.projectId, sessionId: originalSession.ref.sessionId } };
    expect((await submitControl(second, r2Ref, 'cancel', 'not this one', 'a2-seeded-r2-cancel')).intent).toMatchObject({ status: 'applied' });
    expect((await readExecution(second, r2Ref)).run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });

    // A8-3r: the next requeue after the never-entered r2 carries the original source; r3 is seeded the same way.
    await requeue(r2Ref, 'a2-seeded-again');
    const done = await driveWorkflow(second, selectWork('a2-seeded-r3', true));
    expect(done.at(-1), JSON.stringify(done.map(step => [step.state, step.reason, step.receipt?.kind]))).toMatchObject({ state: 'completed' });
    const r3Ref = (await workRow(second)).execution;
    if (r3Ref === null || r3Ref.runId === r2Ref.runId) throw new Error('the continuation r3 must run');
    const brief = await post<{ status: string; value: { brief: { session: { seededFrom: { throughPosition: number } | null } } } }>(second,
      'executions/brief', plain(AG2B_SCOPE, { runRef: r3Ref }));
    expect(brief, 'r3 brief').toMatchObject({ status: 'ready', value: { brief: { session: { continuity: 'other_session_seeded', seededFrom } } } });
    expect(brief.value.brief.session.seededFrom?.throughPosition).toBeGreaterThan(0);
    // The first (and only) provider request of r3 carries Run0's completed Turn as history, never the interrupted
    // Turn (that one is described by the brief only).
    const messages = second.scripted.requests[0]?.messages ?? [];
    expect(JSON.stringify(messages)).toContain(RUN0_TEXT);
    expect(messages.some(message => message.role === 'tool' && message.callId === 'a2-seeded-run0-edit')).toBe(true);
    expect(messages.some(message => message.role === 'tool' && message.callId === 'a2-seeded-interrupted-read')).toBe(false);
    expect(second.scripted.calls()).toBe(1);
    expect(ended.session).toMatchObject({ healthConclusion: 'kernel_turn_open' });
  } finally {
    await second.host.close();
  }
}, 240_000);

