/**
 * A.2 step 5.6 through real Hosts on one SQLite ledger and Kernel store
 * (docs/refactor/STATE-MACHINES-SPEC.md §12.2 W-20, §12.6 H-01/H-04, RUN-24, SES-06, SES-13,
 * P19/TASK-26, TASK-27, LD-4, LA-1, C4, C8).
 *
 * A.2 step 6 moved this file's cases to tests/scenarios/ (A7-control, A8-host-restart,
 * A8-host-restart-lease). The one case left here waits for its new home,
 * tests/scenarios/A8-host-restart-paused.test.ts (A8-3o), which is not committed yet: that
 * file also holds A8-3p, open on a lead decision (§16 GAP-50 (ii)). Commit that file
 * together with the deletion of this one (user decision 31: each case once).
 *
 * A Run paused at a safe point when its Host stopped: Host 2 ends it
 * paused-interrupted (W-20, RUN-24), retires its Session (`kernel_turn_open`,
 * SES-06, LA-1) and probes only that Session (an idle one gets no probe or
 * report line, H-04). A third start (with the Host setting `automation` at
 * 0 / no re-drive, C8) probes the retired Session again and keeps it retired
 * while the Kernel Turn is still open (SES-13), writing nothing. 继续
 * (TASK-27) continues the Task in a new Session; the read model shows the
 * installed automation cap.
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostReconcileReportV1, SessionRef, TaskExecutionRecord } from '../../src/app/core-http-types.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import {
  AG2B_GOAL_REF, AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, cleanupAG2b, createAG2bSession, graphWrite, plain, startAG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  TASK, answer, claimQueryOn, cleanupRestart, driveWorkflow, pausedRunOnClosedHost, post, publicDirectory, readExecution, readGoal,
  selectWork, tempDir, workRow, writeAutomationSettings,
} from '../helpers/A2-restart-fixture.js';

afterEach(async () => {
  await cleanupAG2b();
  await cleanupRestart();
});

const sessionKey = (session: TaskExecutionRecord['session']): string =>
  JSON.stringify({ projectId: session.ref.projectId, sessionId: session.ref.sessionId });
const EDIT_THEN_TEXT = (label: string) => [
  { kind: 'calls' as const, calls: [{ callId: `${label}-edit`, name: 'edit', args: { mode: 'create', path: AG2B_RESULT_FILE, newText: AG2B_RESULT_TEXT } }] },
  { kind: 'text' as const, text: `A2 ${label}: the continued Run wrote the result file` }];

it('a Run paused at a safe point when its Host stopped ends paused-interrupted at the restart; a second start keeps its Session retired and writes nothing; 继续 continues the Task in a new Session', async () => {
  const root = await tempDir('a2-restart-ws-');
  const database = await tempDir('a2-restart-db-');
  const publicDir = await publicDirectory();
  let idleSession: SessionRef | undefined;
  const { runRef, pauseIntentRef, oldSession, lockPath, crashedPid } = await pausedRunOnClosedHost(root, database, publicDir, 'run', {
    // H-04: an idle, available Session is neither probed nor reported.
    beforeClose: async host => { idleSession = (await createAG2bSession(host, 'a2-restart-idle')).sessionRef; },
  });
  if (idleSession === undefined) throw new Error('the idle Session must exist');

  // Host 2 on the same ledger and Kernel store: takeover (HL-03), then the start-up reconcile.
  const second = await startAG2bHost(publicDir, { root, database });
  let reconciled: TaskExecutionRecord;
  try {
    const hostInstanceId = second.host.reconcile.hostInstanceId;
    const runKey = JSON.stringify(runRef);
    expect(second.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-03',
      leaseReason: `the stale lock of pid ${String(crashedPid)} was taken over`,
      report: { hostInstanceId, sessions: [{ ref: sessionKey(oldSession), row: 'H-01' }],
        runs: [{ ref: runKey, row: 'W-20', status: 'reconciled' }], queries: [], checks: [], problems: [] } });
    expect(JSON.stringify(second.host.reconcile.report?.sessions)).not.toContain(idleSession.sessionId);
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toMatchObject({ hostInstanceId, pid: process.pid });
    // §12.1 step 7: the same report over the public route.
    expect(await post<ReadResult<HostReconcileReportV1>>(second, 'host/reconcile-report', plain(AG2B_SCOPE, {})))
      .toEqual({ status: 'ready', value: second.host.reconcile });

    // RUN-24 (C4): crashed, paused-interrupted, on the takeover basis; SES-06 + LA-1: released, cursor kept, retired.
    reconciled = await readExecution(second, runRef);
    expect(reconciled.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { status: 'done', basis: { kind: 'host_instance_takeover', hostInstanceId },
        observation: { kind: 'interrupted_clean', kernelPaused: true, pausedIntentRef: pauseIntentRef } } });
    expect(reconciled.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open',
      historyCursor: oldSession.historyCursor });
    const oldSessionRef: SessionRef = { projectId: reconciled.session.ref.projectId, sessionId: reconciled.session.ref.sessionId };

    // LD-4: the public history read accepts the kernel_turn_open Session as read-only ...
    expect(await post(second, 'sessions/history', plain(AG2B_SCOPE, { sessionRef: oldSessionRef, afterCursor: null,
      throughCursor: null, limit: 10 }))).toMatchObject({ status: 'ready' });
    // ... while a claim on it is busy (SES-02: a retired Session takes no new execution).
    expect((await claimQueryOn(second, reconciled.session, 'old-session')).claim).toMatchObject({ status: 'rejected', code: 'busy' });

    // P19 (TASK-26): 已暂停，可继续 — blocked, never failed; a control on the ended Run is refused with the C4 text.
    expect(await workRow(second)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted',
      detail: { afterRunRef: runRef, pausedIntentRef: pauseIntentRef, kernelPaused: true } } });
    expect(await answer(second, 'controls/submit', graphWrite(AG2B_SCOPE, { runRef, kind: 'resume', reason: null },
      'a2-restart-resume-ended', [{ ref: runRef, revision: reconciled.run.revision }])))
      .toMatchObject({ status: 'rejected', code: 'busy', reason: 'the paused Run ended at the Host restart; continue the Task' });
    expect(await driveWorkflow(second, selectWork('a2-restart-wait'))).toMatchObject([{ state: 'waiting', next: null }]);
    expect(second.scripted.calls(), 'the restart and the reads called no model').toBe(0);
  } finally {
    await second.host.close();
  }
  expect(existsSync(lockPath), 'the second Host removed its own lock').toBe(false);

  // A third start: C8 installs the Host setting `automation` (cap 0, no start-up re-drive); the retired Session
  // is probed again (health unavailable) and stays retired while its Kernel Turn is open (SES-13); nothing is written.
  await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: false });
  const third = await startAG2bHost(publicDir, { root, database, replies: EDIT_THEN_TEXT('a2-restart') });
  try {
    expect(third.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-01', report: {
      sessions: [{ ref: sessionKey(oldSession), row: 'H-01', status: 'left' }],
      runs: [], queries: [], checks: [], controls: [], redriveGoals: [], problems: [] } });
    const again = await readExecution(third, runRef);
    expect(again.run.revision, 'the second start rewrites no Run').toBe(reconciled.run.revision);
    expect(again.session).toMatchObject({ revision: reconciled.session.revision, health: 'unavailable', healthConclusion: 'kernel_turn_open' });

    // TASK-27: the operator continues the Task; the Workflow opens a new Session for the requeue.
    const goal = await readGoal(third);
    const continued = await post<WriteResult<TaskRequeueOutcomeV1>>(third, 'tasks/requeue', graphWrite(AG2B_SCOPE,
      { taskRef: TASK, afterRunRef: runRef, reason: 'continue after the restart' }, 'a2-restart-continue',
      [{ ref: AG2B_GOAL_REF, revision: goal.revision }, { ref: runRef, revision: again.run.revision }]));
    if (continued.status !== 'committed' || continued.value.kind !== 'requeued') throw new Error(`continue: ${JSON.stringify(continued)}`);
    expect(continued.value.requeue).toMatchObject({ failureClass: 'interrupted', interruption: 'paused',
      stopIntentRef: pauseIntentRef, afterRunRef: runRef });
    const requeueRef = continued.value.requeue.ref;
    // C8: the read model shows the cap the Host installed from its settings.
    expect(await workRow(third)).toMatchObject({ effectivePhase: 'pending', requeueRef, rework: { cap: 0 } });

    const done = await driveWorkflow(third, selectWork('a2-restart-continue', true));
    expect(done.at(-1), JSON.stringify(done.map(step => [step.state, step.reason, step.receipt?.kind]))).toMatchObject({ state: 'completed' });
    expect(await readFile(join(root, AG2B_RESULT_FILE), 'utf8')).toBe(AG2B_RESULT_TEXT);
    const finished = await workRow(third);
    expect(finished).toMatchObject({ effectivePhase: 'satisfied' });
    if (finished.execution === null || finished.execution.runId === runRef.runId) throw new Error('the continued Run must be selected');
    const continuedRun = await readExecution(third, finished.execution);
    expect(continuedRun.run).toMatchObject({ requeueRef, outcome: 'completed' });
    expect(continuedRun.session.ref.sessionId, 'the continuation runs in a new Session').not.toBe(oldSession.ref.sessionId);
    expect(third.scripted.calls()).toBe(2);
  } finally {
    await third.host.close();
  }
}, 180_000);

