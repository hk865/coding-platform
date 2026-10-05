/**
 * A.2 step 5.6: the start-up reconcile of executions caught mid-Turn, the
 * in-process paused stop, the QueryRun reconcile and the start-up re-drive,
 * through real Hosts on one SQLite ledger and Kernel store
 * (docs/refactor/STATE-MACHINES-SPEC.md §6 RUN-19/23/24, §7 CTL-08(b)(f),
 * CTL-10, §8 QRR-01..06, SES-06/09/10, §12.1 steps 3 and 6b, §12.2 W-01,
 * W-11/W-12/W-20, §12.3 Q-01/Q-04/Q-05/Q-06, §12.7 G-05, LA-6, LA-7, C8).
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
import type { SessionRef, TaskExecutionRecord } from '../../src/app/core-http-types.js';
import type { ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import {
  AG2B_QUERY_ROLE, AG2B_SCOPE, cleanupAG2b, claimBusyQuery, createAG2bSession, graphWrite, plain, seedAG2bWorkGraph, startAG2bHost,
  startBusyQuery, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  advanceUntil, answer, cleanupRestart, deferred, driveWorkflow, moveKernelAside, post, publicDirectory, readControl,
  readExecution, readQuery, selectWork, submitControl, tempDir, workRow, writeAutomationSettings, writeStaleLock,
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

it('W-11 and CTL-08(b): a Run interrupted mid-Turn ends crashed at the restart; the steer the Kernel accepted is applied and the Session retired', async () => {
  const root = await tempDir('a2-crash-steer-ws-');
  const database = await tempDir('a2-crash-steer-db-');
  const publicDir = await publicDirectory();
  let steerRef: ControlIntentSnapshotV1['ref'] | undefined;
  const crashed = await crashMidTurn(root, database, publicDir, {
    beforeBlock: async (host, runRef) => { steerRef = (await submitControl(host, runRef, 'steer', 'A2: also read the tests', 'a2-crash-steer')).intent.ref; },
    // No ack was written before the crash: the observer acks a steer only after the Kernel call returns.
    whileBlocked: async host => { expect(await readControl(host, steerRef!)).toMatchObject({ status: 'queued' }); },
  });
  const second = await startAG2bHost(publicDir, { root, database });
  try {
    const { runRef } = crashed;
    if (steerRef === undefined) throw new Error('the steer must be submitted');
    // The Kernel accepted the steer at the second model boundary (the blocked request carries it).
    expect(JSON.stringify(crashed.first.scripted.requests[1])).toContain('A2: also read the tests');
    const hostInstanceId = second.host.reconcile.hostInstanceId;
    expect(second.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
      runs: [{ ref: JSON.stringify(runRef), row: 'W-11', status: 'reconciled', reason: 'interrupted_clean' }], problems: [] } });
    // RUN-19: crashed `host_interrupted` on the takeover basis; the Session is released with its cursor and retired (LA-1).
    const ended = await readExecution(second, runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed', terminalPayload: { kind: 'crashed' },
      reconciliation: { status: 'done', basis: { kind: 'host_instance_takeover', hostInstanceId },
        observation: { kind: 'interrupted_clean', kernelPaused: false, pausedIntentRef: null } } });
    expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    // CTL-08(b): the steer the Kernel accepted (`control:<sha(intentRef)>`) is applied from that Kernel event.
    const steer = await readControl(second, steerRef);
    expect(steer).toMatchObject({ status: 'applied', observation: { kind: 'steered' } });
    expect(steer.status === 'applied' && 'origin' in steer.observation).toBe(false);
    // W-11: an ordinary interruption (not paused): failed, class interrupted.
    expect(await workRow(second)).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'run_failed' } });
    expect(second.scripted.calls(), 'the reconcile calls no model').toBe(0);
  } finally {
    await crashed.release();
    await second.host.close();
  }
}, 180_000);

it('W-12 (LA-7): a cancel queued while the Turn runs stops the Run at the restart without a Kernel pause; the cancel is applied by the paused stop', async () => {
  const root = await tempDir('a2-crash-cancel-ws-');
  const database = await tempDir('a2-crash-cancel-db-');
  const publicDir = await publicDirectory();
  let cancelRef: ControlIntentSnapshotV1['ref'] | undefined;
  const crashed = await crashMidTurn(root, database, publicDir, {
    whileBlocked: async (host, runRef) => { cancelRef = (await submitControl(host, runRef, 'cancel', 'stop the Run', 'a2-crash-cancel')).intent.ref; },
  });
  const second = await startAG2bHost(publicDir, { root, database });
  try {
    if (cancelRef === undefined) throw new Error('the cancel must be submitted');
    const hostInstanceId = second.host.reconcile.hostInstanceId;
    expect(second.host.reconcile).toMatchObject({ report: {
      runs: [{ ref: JSON.stringify(crashed.runRef), row: 'W-12', status: 'reconciled', reason: 'paused_stop' }], problems: [] } });
    // RUN-23 (restart, Kernel not paused): cancelled `cancelled_at_reconcile`; the Session retired (LA-1).
    const ended = await readExecution(second, crashed.runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled',
      terminalPayload: { kind: 'cancelled', reason: 'cancelled_at_reconcile' },
      reconciliation: { basis: { kind: 'host_instance_takeover', hostInstanceId },
        observation: { kind: 'interrupted_clean', kernelPaused: false, pausedIntentRef: null } } });
    expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    // CTL-10: the cancel is applied by the paused stop; no pause was in effect (LA-7), so `pausedBy` is null.
    expect(await readControl(second, cancelRef)).toMatchObject({ status: 'applied', observation: { origin: 'platform_paused_stop',
      kind: 'cancelled', detail: { basis: 'host_instance_takeover', pausedBy: null } } });
  } finally {
    await crashed.release();
    await second.host.close();
  }
}, 180_000);

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

it('RUN-23 and CTL-10 in process: a cancel of a Run paused at a safe point is applied on the live handle\'s exit proof; the Run ends cancelled and its Session is retired', async () => {
  const root = await tempDir('a2-paused-stop-ws-');
  const database = await tempDir('a2-paused-stop-db-');
  const publicDir = await publicDirectory();
  let host: AG2bHost | undefined;
  let pauseRef: ControlIntentSnapshotV1['ref'] | undefined;
  host = await startAG2bHost(publicDir, { root, database, replies: READ_THEN_TEXT,
    beforeReply: async (_request, index) => {
      if (index !== 0 || host === undefined) return;
      const runRef = (await workRow(host)).execution;
      if (runRef === null) throw new Error('the work Task must have a Run');
      pauseRef = (await submitControl(host, runRef, 'pause', 'pause at the safe point', 'a2-paused-stop-pause')).intent.ref;
    } });
  try {
    await seedAG2bWorkGraph(host);
    expect((await driveWorkflow(host, selectWork('a2-paused-stop'))).at(-1)).toMatchObject({ state: 'waiting', next: null });
    const runRef = (await workRow(host)).execution;
    if (runRef === null || pauseRef === undefined) throw new Error('the paused Run must exist');
    const paused = await readExecution(host, runRef);
    expect(paused.run).toMatchObject({ status: 'running', controlState: { desiredState: 'paused' } });
    expect(await readControl(host, pauseRef)).toMatchObject({ status: 'applied', observation: { kind: 'paused' } });

    // The cancel cannot reach the exited Kernel call; the platform stops the Run on the exit proof (live_clean).
    const cancel = await submitControl(host, runRef, 'cancel', 'stop the paused Run', 'a2-paused-stop-cancel');
    expect(cancel.intent).toMatchObject({ status: 'queued' });
    const delivered = await post<{ status: string; value: ControlIntentSnapshotV1 }>(host, 'controls/deliver',
      plain(AG2B_SCOPE, { intentRef: cancel.intent.ref }));
    expect(delivered).toMatchObject({ status: 'ready', value: { status: 'applied', observation: { origin: 'platform_paused_stop',
      kind: 'cancelled', detail: { basis: 'live_clean', pausedBy: pauseRef } } } });
    const ended: TaskExecutionRecord = await readExecution(host, runRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled',
      terminalPayload: { kind: 'cancelled', reason: 'cancelled_while_paused' },
      reconciliation: { status: 'done', basis: { kind: 'live_clean' }, observation: { kind: 'interrupted_clean', kernelPaused: true } } });
    // SES-06 (LA-1): the Kernel Turn stays paused, so the Session is released and retired; the pause stays applied.
    expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open',
      historyCursor: paused.session.historyCursor });
    expect(await readControl(host, pauseRef)).toMatchObject({ status: 'applied', observation: { kind: 'paused' } });
    expect(await workRow(host)).toMatchObject({ effectivePhase: 'failed' });
    expect(host.scripted.calls()).toBe(1);
  } finally {
    await host.host.close();
  }
}, 180_000);

it('Q-01 and Q-04: at the restart a claimed QueryRun is closed not_entered and one interrupted mid-Turn is closed failed, retiring its Session', async () => {
  const root = await tempDir('a2-query-ws-');
  const database = await tempDir('a2-query-db-');
  const publicDir = await publicDirectory();
  const reached = deferred();
  const hold = deferred();
  const first = await startAG2bHost(publicDir, { root, database, queryReplies: [{ kind: 'text', text: 'never answered' }],
    queryBeforeReply: async () => { reached.resolve(); await hold.promise; } });
  let inFlight: Promise<unknown> = Promise.resolve();
  let claimed: Awaited<ReturnType<typeof claimBusyQuery>>;
  let started: Awaited<ReturnType<typeof claimBusyQuery>>;
  let claimedSession: Awaited<ReturnType<typeof createAG2bSession>>;
  let startedSession: Awaited<ReturnType<typeof createAG2bSession>>;
  try {
    await seedAG2bWorkGraph(first);
    claimedSession = await createAG2bSession(first, 'a2-query-claimed');
    startedSession = await createAG2bSession(first, 'a2-query-started');
    claimed = await claimBusyQuery(first, claimedSession, 'claimed');
    started = await claimBusyQuery(first, startedSession, 'started');
    inFlight = startBusyQuery(first, started, 'started').catch(() => undefined);
    await reached.promise;
    await writeStaleLock(database);
  } catch (error) {
    hold.reject(new Error('setup failed'));
    await inFlight;
    await first.host.close();
    throw error;
  }
  const second = await startAG2bHost(publicDir, { root, database });
  try {
    const report = second.host.reconcile.report;
    expect(report?.queries).toEqual(expect.arrayContaining([
      { ref: JSON.stringify(claimed.queryRunRef), row: 'Q-01', status: 'reconciled', reason: 'not_entered' },
      { ref: JSON.stringify(started.queryRunRef), row: 'Q-04', status: 'reconciled', reason: 'interrupted_clean' },
    ]));
    expect(report?.queries).toHaveLength(2);
    // QRR-01: closed not_entered; SES-09 releases the Session with its cursor, still available.
    expect((await readQuery(second, claimed.queryJobRef)).run.run).toMatchObject({ status: 'closed', outcome: 'not_entered',
      executionState: { phase: 'settled' } });
    const claimedCard = await post<{ status: string; value: { record: TaskExecutionRecord['session'] } }>(second, 'sessions/read',
      plain(AG2B_SCOPE, claimedSession.sessionRef));
    expect(claimedCard.value.record).toMatchObject({ occupancy: null, health: 'available' });
    // QRR-04: no Kernel terminal, nothing in flight: closed failed; the open Kernel Turn retires the Session (SES-09, LA-1).
    expect((await readQuery(second, started.queryJobRef)).run.run).toMatchObject({ status: 'closed', outcome: 'failed',
      executionState: { phase: 'settled' } });
    const startedCard = await post<{ status: string; value: { record: TaskExecutionRecord['session'] } }>(second, 'sessions/read',
      plain(AG2B_SCOPE, startedSession.sessionRef));
    expect(startedCard.value.record).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    expect(second.queryScripted.calls()).toBe(0);
  } finally {
    hold.reject(new Error('A2 crash: the crashed Host never answers this request'));
    await inFlight;
    await first.host.close();
    await second.host.close();
  }
}, 180_000);

it('Q-05 and QRR-06: an unreadable Kernel marks the interrupted QueryRun unknown with its cause; only the lease-holding Host attests it, with a reason', async () => {
  const root = await tempDir('a2-query5-ws-');
  const database = await tempDir('a2-query5-db-');
  const publicDir = await publicDirectory();
  const reached = deferred();
  const hold = deferred();
  const first = await startAG2bHost(publicDir, { root, database, queryReplies: [{ kind: 'text', text: 'never answered' }],
    queryBeforeReply: async () => { reached.resolve(); await hold.promise; } });
  let inFlight: Promise<unknown> = Promise.resolve();
  let refs: Awaited<ReturnType<typeof claimBusyQuery>>;
  let session: Awaited<ReturnType<typeof createAG2bSession>>;
  try {
    await seedAG2bWorkGraph(first);
    session = await createAG2bSession(first, 'a2-query5-session');
    refs = await claimBusyQuery(first, session, 'q5');
    inFlight = startBusyQuery(first, refs, 'q5').catch(() => undefined);
    await reached.promise;
    await writeStaleLock(database);
    await moveKernelAside(database);
  } catch (error) {
    hold.reject(new Error('setup failed'));
    await inFlight;
    await first.host.close();
    throw error;
  }
  const second = await startAG2bHost(publicDir, { root, database });
  try {
    expect(second.host.reconcile).toMatchObject({ report: { queries: [{ ref: JSON.stringify(refs.queryRunRef), row: 'Q-05',
      status: 'reconciled', reason: 'unknown (Kernel missing)' }] } });
    // QRR-05: phase unknown with its persisted cause; the occupancy is kept.
    const unknown = await readQuery(second, refs.queryJobRef);
    expect(unknown.run.run.executionState).toMatchObject({ phase: 'unknown', unknown: { kind: 'kernel_unreadable', verdict: 'missing' } });
    const pin = [{ ref: refs.queryRunRef, revision: unknown.run.revision }];
    // QRR-06 (U): a blank reason is invalid; a Host without the lease answers busy; nothing is written either way.
    expect(await answer(second, 'queries/resolve-unknown', graphWrite(AG2B_SCOPE, { queryRunRef: refs.queryRunRef, reason: ' ' },
      'a2-q6-blank', pin))).toMatchObject({ status: 'rejected', code: 'invalid' });
    const other = await startAG2bHost(publicDir, { root, database });
    try {
      expect(other.host.reconcile).toMatchObject({ lease: 'held_by_other' });
      expect(await answer(other, 'queries/resolve-unknown', graphWrite(AG2B_SCOPE, { queryRunRef: refs.queryRunRef,
        reason: 'checked by hand' }, 'a2-q6-other', pin))).toMatchObject({ status: 'rejected', code: 'busy' });
    } finally {
      await other.host.close();
    }
    expect((await readQuery(second, refs.queryJobRef)).run.revision).toBe(unknown.run.revision);
    // A pin that names another aggregate is refused.
    expect(await answer(second, 'queries/resolve-unknown', graphWrite(AG2B_SCOPE, { queryRunRef: refs.queryRunRef,
      reason: 'checked by hand' }, 'a2-q6-wrong-pin', [{ ref: refs.queryJobRef, revision: unknown.run.revision }])))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    const attested = await post<WriteResult<unknown>>(second, 'queries/resolve-unknown', graphWrite(AG2B_SCOPE,
      { queryRunRef: refs.queryRunRef, reason: 'the consultation was answered by hand' }, 'a2-q6', pin));
    expect(attested).toMatchObject({ status: 'committed' });
    const closed = await readQuery(second, refs.queryJobRef);
    expect(closed.run.run).toMatchObject({ status: 'closed', outcome: 'failed', executionState: { phase: 'settled',
      unknown: { kind: 'kernel_unreadable', verdict: 'missing' } } });
    expect(closed.job.job).toMatchObject({ status: 'closed', closeReason: { message: 'the consultation was answered by hand' } });
    // SES-10 + LA-1: the unreadable Kernel counts as an open Turn: the Session is released and retired.
    const card = await post<{ status: string; value: { record: TaskExecutionRecord['session'] } }>(second, 'sessions/read',
      plain(AG2B_SCOPE, session.sessionRef));
    expect(card.value.record).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
  } finally {
    hold.reject(new Error('A2 crash: the crashed Host never answers this request'));
    await inFlight;
    await first.host.close();
    await second.host.close();
  }
}, 180_000);

it('§12.1 step 5, W-17 (CI-09): a yielded wait keeps a queued control as its continuation fence at the restart; the report lists it as left', async () => {
  const root = await tempDir('a2-fence-ws-');
  const database = await tempDir('a2-fence-db-');
  const publicDir = await publicDirectory();
  // The work Run sends a wait message to a linked Session that nobody answers, so it really yields (as TD-5).
  let recipient: SessionRef | undefined;
  const send = { callId: 'a2-fence-send', name: 'send_session_message',
    args: { recipient: {}, text: 'A2 fence: a question that nobody answers', replyMode: 'wait' } as Record<string, unknown> };
  const first = await startAG2bHost(publicDir, { root, database, replies: [{ kind: 'calls', calls: [send] }],
    beforeReply: async (_request, index) => {
      if (index === 0 && recipient !== undefined) send.args['recipient'] = { projectId: recipient.projectId, sessionId: recipient.sessionId };
    } });
  let runRef: RunRef;
  let pauseRef: ControlIntentSnapshotV1['ref'];
  try {
    const { workTarget } = await seedAG2bWorkGraph(first);
    recipient = (await createAG2bSession(first, 'a2-fence-recipient', AG2B_QUERY_ROLE,
      [{ target: workTarget, relation: 'participates' }])).sessionRef;
    expect((await driveWorkflow(first, selectWork('a2-fence'))).at(-1)).toMatchObject({ state: 'waiting', next: null });
    const selected = (await workRow(first)).execution;
    if (selected === null) throw new Error('the work Run must exist');
    runRef = selected;
    expect((await readExecution(first, runRef)).run).toMatchObject({ status: 'ended', outcome: 'yielded',
      continuation: { kind: 'wait_reply' } });
    // CI-09: a pause on the wait stays queued; it is the fence of the continuation.
    pauseRef = (await submitControl(first, runRef, 'pause', null, 'a2-fence-pause')).intent.ref;
    expect(await readControl(first, pauseRef)).toMatchObject({ status: 'queued' });
    expect(first.scripted.calls(), 'only the wait message called the model').toBe(1);
  } finally {
    await first.host.close();
  }
  await writeStaleLock(database);
  const second = await startAG2bHost(publicDir, { root, database });
  try {
    // Step 5 reads the queued intent's Run and leaves the fence as it is (CTL-08 "不处理").
    expect(second.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { problems: [] } });
    expect(second.host.reconcile.report?.controls).toEqual([
      expect.objectContaining({ ref: JSON.stringify(runRef), row: 'W-17', status: 'left' })]);
    expect(await readControl(second, pauseRef)).toMatchObject({ status: 'queued' });
    expect((await readExecution(second, runRef)).run).toMatchObject({ status: 'ended', outcome: 'yielded',
      controlState: { desiredState: 'paused' } });
    expect(await workRow(second)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'continuation_paused' } });
    expect(second.scripted.calls(), 'the reconcile calls no model').toBe(0);
  } finally {
    await second.host.close();
  }
}, 180_000);

it('VR-04 (C-01): a check left executing by a crashed Host is interrupted at the restart (host_restart), and no check runs again', async () => {
  const root = await tempDir('a2-check-ws-');
  const database = await tempDir('a2-check-db-');
  const publicDir = await publicDirectory();
  // The registered check runs long enough for the crash and the restart to happen while it executes.
  const checkCommand = 'node -e "setTimeout(() => {}, 8000)"';
  const first = await startAG2bHost(publicDir, { root, database, checkCommand, replies: [
    { kind: 'calls', calls: [{ callId: 'a2-check-edit', name: 'edit', args: { mode: 'create', path: 'src/ag2b-result.txt', newText: 'AG2B_RESULT_FROM_A' } }] },
    { kind: 'text', text: 'A2 check: the work is done' }] });
  let inFlight: Promise<unknown> = Promise.resolve();
  try {
    await seedAG2bWorkGraph(first);
    const runCheck = await advanceUntil(first, selectWork('a2-check'), 'run_check');
    inFlight = post(first, 'workflow/advance', plain(AG2B_SCOPE, runCheck)).catch(() => undefined);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const row = await workRow(first);
      if ((row['phaseCause'] as { code?: string } | undefined)?.code === 'verification_running') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    await writeStaleLock(database);
  } catch (error) {
    await inFlight;
    await first.host.close();
    throw error;
  }
  const second = await startAG2bHost(publicDir, { root, database, checkCommand });
  try {
    const report = second.host.reconcile.report;
    expect(report?.checks).toEqual([expect.objectContaining({ row: 'C-01', status: 'reconciled', reason: 'interrupted (host_restart)' })]);
    expect(report?.problems).toEqual([]);
  } finally {
    await inFlight;
    await first.host.close();
  }
  try {
    // The crashed Host's late check result is refused by the interrupted check; the Task waits on the interruption
    // (§12 C-04: never re-run within the round).
    expect(await workRow(second)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'check_interrupted' } });
    // A further start finds nothing executing.
    await second.host.close();
    const third = await startAG2bHost(publicDir, { root, database, checkCommand });
    try {
      expect(third.host.reconcile).toMatchObject({ report: { checks: [], runs: [], problems: [] } });
    } finally {
      await third.host.close();
    }
  } finally {
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

it('§12.1 step 6b (LA-6, W-01): a claimed Run left by a stopped Host is re-driven with the same claim at the next start, unless the Host setting turns the re-drive off', async () => {
  for (const resumeOnStartup of [true, false]) {
    const root = await tempDir('a2-redrive-ws-');
    const database = await tempDir('a2-redrive-db-');
    const publicDir = await publicDirectory();
    const first = await startAG2bHost(publicDir, { root, database });
    let claimedRun: RunRef;
    try {
      await seedAG2bWorkGraph(first);
      await advanceUntil(first, selectWork('a2-redrive'), 'start');
      const row = await workRow(first);
      if (row.execution === null) throw new Error('the Workflow must have claimed the Task');
      claimedRun = row.execution;
      expect((await readExecution(first, claimedRun)).run).toMatchObject({ status: 'starting' });
    } finally {
      await first.host.close();
    }
    if (!resumeOnStartup) await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false });
    const second = await startAG2bHost(publicDir, { root, database, replies: [
      { kind: 'calls', calls: [{ callId: 'a2-redrive-edit', name: 'edit', args: { mode: 'create', path: 'src/ag2b-result.txt', newText: 'AG2B_RESULT_FROM_A' } }] },
      { kind: 'text', text: 'A2 re-drive: the same claim completed the Task' }] });
    try {
      // Step 6b selects the active Goal with the not-entered Run either way (W-01); the switch decides whether a driver starts.
      expect(second.host.reconcile, String(resumeOnStartup)).toMatchObject({ lease: 'owned', report: { runs: [],
        redriveGoals: [{ goalRef: { goalId: 'ag2b-goal' }, taskIds: ['ag2b-work'] }], problems: [] } });
      if (resumeOnStartup) {
        let row = await workRow(second);
        for (let attempt = 0; attempt < 200 && row['effectivePhase'] !== 'satisfied'; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
          row = await workRow(second);
        }
        expect(row, 'the start-up re-drive completed the Task without a workflow/advance').toMatchObject({ effectivePhase: 'satisfied' });
        expect(row.execution?.runId, 'the same claim re-driven (W-01)').toBe(claimedRun.runId);
        expect((await readExecution(second, claimedRun)).run).toMatchObject({ status: 'ended', outcome: 'completed' });
        expect(second.scripted.calls()).toBe(2);
      } else {
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(second.scripted.calls(), 'no driver started').toBe(0);
        expect((await readExecution(second, claimedRun)).run).toMatchObject({ status: 'starting' });
        // The next workflow/advance continues the same claim.
        const done = await driveWorkflow(second, selectWork('a2-redrive-later', true));
        expect(done.at(-1)).toMatchObject({ state: 'completed' });
        expect((await workRow(second)).execution?.runId).toBe(claimedRun.runId);
      }
    } finally {
      await second.host.close();
    }
  }
}, 240_000);
