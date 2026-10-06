/**
 * A.2 step 5.6 through real Hosts on one SQLite ledger and Kernel store
 * (docs/refactor/STATE-MACHINES-SPEC.md §12.1 steps 0..7, §12.2 W-07/W-14/W-15/W-20,
 * §12.6 H-01/H-03/H-04, §12.7 G-04/G-06, §12.8 HL-01..HL-07, RUN-20, RUN-22,
 * RUN-24, SES-06, SES-07, SES-13, P19/TASK-26, TASK-27, GOAL-29, LD-4, LA-1, C4, C8).
 *
 * Test 1 — a Run paused at a safe point when its Host stopped: Host 2 ends it
 * paused-interrupted (W-20, RUN-24), retires its Session (`kernel_turn_open`,
 * SES-06, LA-1) and probes only that Session (an idle one gets no probe or
 * report line, H-04). A third start (with the Host setting `automation` at
 * 0 / no re-drive, C8) probes the retired Session again and keeps it retired
 * while the Kernel Turn is still open (SES-13), writing nothing. 继续
 * (TASK-27) continues the Task in a new Session; the read model shows the
 * installed automation cap.
 *
 * Test 2 — G-04 and GOAL-29 in process: the Goal fan-out paused the Run;
 * resuming the Goal after the restart continues the Task under the fan-out
 * actor in a new Session.
 *
 * Test 3 — G-04 and G-06 at a restart: the Goal is resumed, paused and resumed
 * again on a Host without the instance lease (its fan-out reaches no Run,
 * L-10); the next start continues the Task exactly once (GOAL-29 over the
 * earlier epochs), and a further start adds nothing.
 *
 * Test 4 — W-14 and RUN-22 with the Kernel store gone: the Run ends
 * outcome_unknown and keeps its Session; the attestation retires it.
 *
 * Test 5 — W-14, then a readable Kernel again: a Host without the Kernel
 * Store registration leaves the Run (W-07, H-03) and refuses the attestation
 * `unavailable` without writing; a Host with it finds no new Kernel terminal
 * (W-15), and the attestation of the open (paused) Turn retires the Session.
 *
 * Test 6 — HL-02/HL-07: a second Host while the first one runs reconciles
 * nothing, refuses every Kernel entry and the attestations, and still serves
 * reads. Test 7 — HL-04: a damaged lock is held the same way.
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostReconcileReportV1, SessionRef, TaskExecutionRecord } from '../../src/app/core-http-types.js';
import { HOST_INSTANCE_LOCK_FILE } from '../../src/app/host-instance-lease.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { GOAL_FAN_OUT_ACTOR, type TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import {
  AG2B_GOAL_REF, AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, AG2B_WORK_TASK_ID, cleanupAG2b, createAG2bSession, graphWrite, plain,
  seedAG2bWorkGraph, startAG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  TASK, answer, claimQueryOn, cleanupRestart, controlGoal, driveWorkflow, moveKernelAside, pausedRunOnClosedHost, post,
  publicDirectory, readExecution, readGoal, restoreKernel, selectWork, tempDir, workRow, writeAutomationSettings,
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

it('G-04 and GOAL-29: a Run the Goal fan-out paused ends paused-interrupted at the restart; resuming the Goal continues it under the fan-out actor in a new Session', async () => {
  const root = await tempDir('a2-goal29-ws-');
  const database = await tempDir('a2-goal29-db-');
  const publicDir = await publicDirectory();
  const { runRef, pauseIntentRef, oldSession } = await pausedRunOnClosedHost(root, database, publicDir, 'goal');

  const second = await startAG2bHost(publicDir, { root, database, replies: EDIT_THEN_TEXT('a2-goal29') });
  try {
    // W-20 + step 6 (GOAL-16): the paused Goal's fan-out pass finds the Run already ended; nothing is continued while paused.
    expect(second.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
      runs: [{ ref: JSON.stringify(runRef), row: 'W-20', status: 'reconciled' }],
      fanOut: [{ goalId: AG2B_GOAL_REF.goalId, control: 'pause', problem: null, continuations: 0 }], problems: [] } });
    const reconciled = await readExecution(second, runRef);
    expect(reconciled.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { observation: { kind: 'interrupted_clean', kernelPaused: true, pausedIntentRef: pauseIntentRef } } });
    expect(reconciled.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    expect(await workRow(second)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted' } });
    // §2.1 order 0: the paused Goal lists the Run as 已暂停，可继续, continued by the Goal resume.
    expect(await post(second, 'goals/display', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }))).toMatchObject({ status: 'ready',
      value: { display: { phase: 'PAUSED', runStops: [{ runRef, stop: { kind: 'paused_interrupted', pausedBy: 'goal_fan_out' } }] } } });
    // TASK-27 (Goal not active): even a person's 继续 waits for the Goal (busy, "先恢复 Goal").
    const pausedGoal = await readGoal(second);
    expect(await answer(second, 'tasks/requeue', graphWrite(AG2B_SCOPE, { taskRef: TASK, afterRunRef: runRef, reason: 'continue' },
      'a2-goal29-continue-paused', [{ ref: AG2B_GOAL_REF, revision: pausedGoal.revision }, { ref: runRef, revision: reconciled.run.revision }])))
      .toMatchObject({ status: 'rejected', code: 'busy' });

    // GOAL-29: the operator resumes the Goal; the fan-out continues the Task with a goal_resume trigger.
    const goal = await readGoal(second);
    const resumeBody = graphWrite(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF, control: 'resume', reason: 'operator resumes after the restart' },
      'a2-goal29-resume', [{ ref: AG2B_GOAL_REF, revision: goal.revision }]);
    const resumed = await post<WriteResult<{ fanOut: { continuations?: unknown[] } }>>(second, 'goals/control', resumeBody);
    if (resumed.status !== 'committed') throw new Error(`resume: ${JSON.stringify(resumed)}`);
    expect(resumed.value.fanOut).toMatchObject({ control: 'resume', problem: null, runs: [],
      continuations: [{ taskId: AG2B_WORK_TASK_ID, afterRunRef: runRef, outcome: 'requeued', reason: null }] });
    const row = await workRow(second);
    expect(row).toMatchObject({ effectivePhase: 'pending', phaseCause: { code: 'requeued' },
      rework: { entries: [{ afterRunRef: runRef, requestedBy: GOAL_FAN_OUT_ACTOR }] } });
    // The same request again replays the Goal commit; the TaskRequeue already covers the Run (exactly one).
    expect(await post(second, 'goals/control', resumeBody)).toMatchObject({ status: 'committed', replayed: true,
      value: { fanOut: { continuations: [] } } });

    const done = await driveWorkflow(second, selectWork('a2-goal29-continue', true));
    expect(done.at(-1), JSON.stringify(done.map(step => [step.state, step.reason, step.receipt?.kind]))).toMatchObject({ state: 'completed' });
    const finished = await workRow(second);
    expect(finished).toMatchObject({ effectivePhase: 'satisfied' });
    if (finished.execution === null || finished.execution.runId === runRef.runId) throw new Error('the continued Run must be selected');
    const continuedRun = await readExecution(second, finished.execution);
    expect(continuedRun.run).toMatchObject({ requeueRef: row['requeueRef'], outcome: 'completed' });
    expect(continuedRun.session.ref.sessionId).not.toBe(oldSession.ref.sessionId);
    expect(await post(second, 'executions/brief', plain(AG2B_SCOPE, { runRef: finished.execution }))).toMatchObject({ status: 'ready',
      value: { brief: { mode: 'resume_after_interruption', previous: { runRef }, trigger: { actorClass: 'system', goalResume: true } } } });
    expect(second.scripted.calls()).toBe(2);
  } finally {
    await second.host.close();
  }
}, 180_000);

it('G-04 and G-06 at a restart: a Goal resumed (and paused and resumed again) on a Host without the lease continues its paused-interrupted Task exactly once at the next start', async () => {
  const root = await tempDir('a2-g04-ws-');
  const database = await tempDir('a2-g04-db-');
  const publicDir = await publicDirectory();
  const { runRef } = await pausedRunOnClosedHost(root, database, publicDir, 'goal');

  const owner = await startAG2bHost(publicDir, { root, database });
  let pausedEpoch: number;
  try {
    expect(owner.host.reconcile).toMatchObject({ report: { runs: [{ ref: JSON.stringify(runRef), row: 'W-20', status: 'reconciled' }] } });
    pausedEpoch = (await readGoal(owner)).desiredStateRevision ?? 1;
    // HL-07, L-10: a second Host commits the Goal controls (owner writes stay), but its fan-out reaches no Run.
    const other = await startAG2bHost(publicDir, { root, database });
    try {
      expect(other.host.reconcile).toMatchObject({ lease: 'held_by_other', leaseRow: 'HL-02', report: null });
      for (const [control, requestId] of [['resume', 'a2-g06-resume-1'], ['pause', 'a2-g06-pause-2'], ['resume', 'a2-g06-resume-3']] as const) {
        const written = await controlGoal(other, control, requestId);
        if (written.status !== 'committed') throw new Error(`${control}: ${JSON.stringify(written)}`);
        expect(written.value.fanOut, control).toMatchObject({ control, runs: [],
          problem: expect.stringContaining('another Host holds the instance lease') });
        expect(written.value.fanOut.continuations, 'no continuation without the lease').toBeUndefined();
      }
      expect(await workRow(other)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'paused_interrupted' } });
    } finally {
      await other.host.close();
    }
  } finally {
    await owner.host.close();
  }

  // The next start: step 6 runs the resume pass of the current epoch after step 2 (G-04); the Run's pointer is
  // the fan-out pause of an earlier epoch, found by the bounded recomputation (G-06). Since A.2 step 5.8 the
  // start-up re-drive claims that continuation at once (§12.1 step 6b (a), W-21); this test counts the
  // continuations the starts write, so the third and fourth Hosts keep the re-drive off.
  await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false });
  const third = await startAG2bHost(publicDir, { root, database, replies: EDIT_THEN_TEXT('a2-g04') });
  try {
    const resumedEpoch = (await readGoal(third)).desiredStateRevision ?? 1;
    expect(resumedEpoch).toBe(pausedEpoch + 3);
    expect(third.host.reconcile).toMatchObject({ lease: 'owned', report: { runs: [],
      fanOut: [{ goalId: AG2B_GOAL_REF.goalId, control: 'resume', problem: null, runs: 0, continuations: 1 }],
      // §12.1 step 6b (a) (5.8): step 6's continuation reads claim_requeued, so the Goal is selected either way.
      redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [AG2B_WORK_TASK_ID] }] } });
    expect(await workRow(third)).toMatchObject({ effectivePhase: 'pending', phaseCause: { code: 'requeued' },
      rework: { entries: [{ afterRunRef: runRef, requestedBy: GOAL_FAN_OUT_ACTOR, failureClass: 'interrupted' }] } });
  } finally {
    await third.host.close();
  }
  // A further start adds nothing: the TaskRequeue covers the Run.
  const fourth = await startAG2bHost(publicDir, { root, database, replies: EDIT_THEN_TEXT('a2-g04') });
  try {
    expect(fourth.host.reconcile).toMatchObject({ report: { runs: [],
      fanOut: [{ goalId: AG2B_GOAL_REF.goalId, control: 'resume', problem: null, continuations: 0 }] } });
    const row = await workRow(fourth);
    expect((row['rework'] as { entries: unknown[] }).entries).toHaveLength(1);
    const done = await driveWorkflow(fourth, selectWork('a2-g04-continue', true));
    expect(done.at(-1), JSON.stringify(done.map(step => [step.state, step.reason, step.receipt?.kind]))).toMatchObject({ state: 'completed' });
    const finished = await workRow(fourth);
    if (finished.execution === null || finished.execution.runId === runRef.runId) throw new Error('the continued Run must be selected');
    expect(await post(fourth, 'executions/brief', plain(AG2B_SCOPE, { runRef: finished.execution }))).toMatchObject({ status: 'ready',
      value: { brief: { mode: 'resume_after_interruption', previous: { runRef }, trigger: { actorClass: 'system', goalResume: true } } } });
  } finally {
    await fourth.host.close();
  }
}, 240_000);

it('W-14 and RUN-22: with the Kernel store gone at the restart the Run ends outcome_unknown and keeps its Session; the operator attests the end over executions/resolve-unknown', async () => {
  const root = await tempDir('a2-attest-ws-');
  const database = await tempDir('a2-attest-db-');
  const publicDir = await publicDirectory();
  const { runRef, oldSession } = await pausedRunOnClosedHost(root, database, publicDir);
  // The mapped Kernel database is lost with the crashed Host: the probe is `missing` (SD-3: no proof of anything).
  await moveKernelAside(database);

  const second = await startAG2bHost(publicDir, { root, database });
  try {
    const hostInstanceId = second.host.reconcile.hostInstanceId;
    expect(second.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-03',
      report: { sessions: [{ row: 'H-02', status: 'reconciled' }],
        runs: [{ ref: JSON.stringify(runRef), row: 'W-14', status: 'reconciled', reason: 'unknown' }], problems: [] } });
    // RUN-20 (W-14): outcome_unknown with the unreadable Kernel; the unknown holder keeps the Session (I-2, D-4).
    const unknown = await readExecution(second, runRef);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
      reconciliation: { status: 'quarantined', observation: { kind: 'unresolved' },
        basis: { kind: 'host_instance_takeover', hostInstanceId } } });
    expect(unknown.session).toMatchObject({ occupancy: { kind: 'execution', executionRef: { runId: runRef.runId } },
      health: 'unavailable', healthConclusion: 'missing' });
    const sessionRef: SessionRef = { projectId: unknown.session.ref.projectId, sessionId: unknown.session.ref.sessionId };
    // LD-4: a missing Kernel history keeps refusing the public read.
    expect(await answer(second, 'sessions/history', plain(AG2B_SCOPE, { sessionRef, afterCursor: null, throughCursor: null, limit: 10 })))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });

    // RUN-22 (U): the attestation needs a reason; then the Run ends crashed `human_attested` and the Session is released.
    expect(await answer(second, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE, { runRef, reason: '   ' },
      'a2-attest-empty', [{ ref: runRef, revision: unknown.run.revision }]))).toMatchObject({ status: 'rejected', code: 'invalid' });
    const attested = await post<WriteResult<unknown>>(second, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
      { runRef, reason: 'checked the workspace by hand: nothing was written' }, 'a2-attest',
      [{ ref: runRef, revision: unknown.run.revision }]));
    expect(attested).toMatchObject({ status: 'committed', replayed: false });
    const ended = await readExecution(second, runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      terminalPayload: { kind: 'crashed', error: 'human_attested: checked the workspace by hand: nothing was written' },
      reconciliation: { status: 'done', observation: { kind: 'human_attested', attestedBy: second.actor,
        reason: 'checked the workspace by hand: nothing was written' }, basis: { kind: 'host_instance_takeover', hostInstanceId } } });
    // SES-07 + LA-1: released with the cursor kept; the unreadable Kernel retires the Session.
    expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open',
      historyCursor: oldSession.historyCursor });
    // A known terminal is never rewritten.
    expect(await answer(second, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE, { runRef, reason: 'again' },
      'a2-attest-again', [{ ref: runRef, revision: ended.run.revision }]))).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(second.scripted.calls()).toBe(0);
  } finally {
    await second.host.close();
  }
}, 180_000);

it('W-14 then W-07, W-15 and RUN-22 on a readable Kernel: a probe that proves nothing refuses the attestation without a write; the attestation of the open Turn retires the Session', async () => {
  const root = await tempDir('a2-attest2-ws-');
  const database = await tempDir('a2-attest2-db-');
  const publicDir = await publicDirectory();
  const { runRef, oldSession } = await pausedRunOnClosedHost(root, database, publicDir);
  const aside = await moveKernelAside(database);

  // Host 2: the Kernel is missing (W-14): the unknown end keeps its Session.
  const second = await startAG2bHost(publicDir, { root, database });
  let unknown: TaskExecutionRecord;
  try {
    expect(second.host.reconcile).toMatchObject({ report: { runs: [{ ref: JSON.stringify(runRef), row: 'W-14', status: 'reconciled' }] } });
    unknown = await readExecution(second, runRef);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
  } finally {
    await second.host.close();
  }
  await restoreKernel(database, aside);

  // Host 3 without the Kernel Store registration: the probe is `host_config`, which proves nothing (SD-2):
  // the Session and the Run are left (H-03, W-07) and the attestation is refused `unavailable` without a write.
  const third = await startAG2bHost(publicDir, { root, database, noKernelStores: true });
  try {
    expect(third.host.reconcile).toMatchObject({ lease: 'owned', report: {
      sessions: [{ ref: sessionKey(oldSession), row: 'H-03', status: 'left' }],
      runs: [{ ref: JSON.stringify(runRef), row: 'W-07', status: 'left' }], problems: [] } });
    const refused = await answer(third, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
      { runRef, reason: 'checked by hand' }, 'a2-attest2-host-config', [{ ref: runRef, revision: unknown.run.revision }]));
    expect(refused).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(String(refused['reason'])).toContain('host_config');
    expect((await readExecution(third, runRef)).run).toMatchObject({ revision: unknown.run.revision, outcome: 'outcome_unknown' });
  } finally {
    await third.host.close();
  }

  // Host 4 with the Kernel readable again: the Turn is still paused, no new Kernel terminal (W-15 left);
  // the probe makes the Session available again while the unknown holder keeps it (SES-13).
  const fourth = await startAG2bHost(publicDir, { root, database });
  try {
    expect(fourth.host.reconcile).toMatchObject({ lease: 'owned', report: {
      sessions: [{ ref: sessionKey(oldSession), row: 'H-01', status: 'reconciled' }],
      runs: [{ ref: JSON.stringify(runRef), row: 'W-15', status: 'left' }], problems: [] } });
    const before = await readExecution(fourth, runRef);
    expect(before.session).toMatchObject({ occupancy: { kind: 'execution', executionRef: { runId: runRef.runId } }, health: 'available' });
    // RUN-22 on a readable Kernel: the attested Turn has no Kernel terminal, so the Session is retired (SES-07, LA-1).
    const attested = await post<WriteResult<unknown>>(fourth, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
      { runRef, reason: 'the paused Turn did nothing more' }, 'a2-attest2', [{ ref: runRef, revision: before.run.revision }]));
    expect(attested).toMatchObject({ status: 'committed' });
    const ended = await readExecution(fourth, runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { observation: { kind: 'human_attested', reason: 'the paused Turn did nothing more' } } });
    expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open',
      historyCursor: oldSession.historyCursor });
    expect(fourth.scripted.calls()).toBe(0);
  } finally {
    await fourth.host.close();
  }
}, 240_000);

it('HL-02/HL-07: a second Host on a store another live Host holds reconciles nothing, refuses every Kernel entry and attestation, and still serves reads', async () => {
  const root = await tempDir('a2-lease-ws-');
  const database = await tempDir('a2-lease-db-');
  const publicDir = await publicDirectory();
  const lockPath = join(database, HOST_INSTANCE_LOCK_FILE);
  const owner = await startAG2bHost(publicDir, { root, database });
  try {
    await seedAG2bWorkGraph(owner);
    expect(owner.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-01' });
    const ownerLock = await readFile(lockPath, 'utf8');
    const other = await startAG2bHost(publicDir, { root, database });
    try {
      expect(other.host.reconcile).toMatchObject({ lease: 'held_by_other', leaseRow: 'HL-02', report: null,
        leaseReason: `another live process (pid ${String(process.pid)}) holds the store` });
      await expectHeldHost(other);
    } finally {
      await other.host.close();
    }
    // HL-06: a Host that never held the lease never touches the lock.
    expect(await readFile(lockPath, 'utf8')).toBe(ownerLock);
  } finally {
    await owner.host.close();
  }
  expect(existsSync(lockPath)).toBe(false);
}, 120_000);

it('HL-04: a damaged lock is held as another Host\'s: no reconcile, no Kernel entry, reads served, the lock left for a person', async () => {
  const root = await tempDir('a2-lease4-ws-');
  const database = await tempDir('a2-lease4-db-');
  const publicDir = await publicDirectory();
  const seeded = await startAG2bHost(publicDir, { root, database });
  try { await seedAG2bWorkGraph(seeded); } finally { await seeded.host.close(); }
  const lockPath = join(database, HOST_INSTANCE_LOCK_FILE);
  await writeFile(lockPath, 'a damaged lock');
  const held = await startAG2bHost(publicDir, { root, database });
  try {
    expect(held.host.reconcile).toMatchObject({ lease: 'held_by_other', leaseRow: 'HL-04', report: null });
    await expectHeldHost(held);
  } finally {
    await held.host.close();
  }
  expect(await readFile(lockPath, 'utf8'), 'a Host that never held the lease leaves the damaged lock for a person').toBe('a damaged lock');
}, 120_000);

/** HL-07 on a Host without the lease: reads and owner writes stay; every Kernel entry and attestation is busy. */
async function expectHeldHost(host: Awaited<ReturnType<typeof startAG2bHost>>): Promise<void> {
  expect((await readGoal(host)).ref).toEqual(AG2B_GOAL_REF);
  expect(await answer(host, 'workflow/advance', plain(AG2B_SCOPE, selectWork('a2-lease-advance'))))
    .toMatchObject({ status: 'rejected', code: 'busy' });
  for (const suffix of ['executions/start', 'queries/start', 'workflow/consultation', 'workflow/driver-start']) {
    expect(await answer(host, suffix, plain(AG2B_SCOPE, { prepared: {}, consumerId: 'a2-lease', requestId: 'a2-lease' })), suffix)
      .toMatchObject({ status: 'rejected', code: 'busy' });
  }
  const runRef: RunRef = { aggregateType: 'Run', projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, runId: 'a2-lease-run' };
  expect(await answer(host, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE, { runRef, reason: 'operator check' },
    'a2-lease-attest', [{ ref: runRef, revision: 1 }]))).toMatchObject({ status: 'rejected', code: 'busy' });
  const queryRunRef = { aggregateType: 'QueryRun', ...AG2B_SCOPE, queryJobId: 'a2-lease-job', runId: 'a2-lease-query' };
  expect(await answer(host, 'queries/resolve-unknown', graphWrite(AG2B_SCOPE, { queryRunRef, reason: 'operator check' },
    'a2-lease-attest-query', [{ ref: queryRunRef, revision: 1 }]))).toMatchObject({ status: 'rejected', code: 'busy' });
  expect(await post(host, 'host/reconcile-report', plain(AG2B_SCOPE, {}))).toEqual({ status: 'ready', value: host.host.reconcile });
  expect(host.scripted.calls()).toBe(0);
}
