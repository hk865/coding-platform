/**
 * A.2 step 6, scenario A8: the Host instance lease (§12.8 HL-01..HL-07, lead decisions L-1, L-10) and the
 * QueryRun reconcile (§12.3 Q-01..Q-07) on rebuilt Hosts over one SQLite ledger and Kernel store
 * (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" A8 row, §12.10 A8-L1..A8-L6, A8-Q1..A8-Q7).
 *
 * - A8-L2/A8-L6 (HL-02, HL-06, HL-07), A8-L4 (HL-04): moved cases; A8-L5 (HL-05): a lock naming a live, unrelated
 *   process (the test process itself) is held the same way. A8-L1 (HL-01) and A8-L3 (HL-03) are every scenario's
 *   first start and crash restart (the reports' `leaseRow`).
 * - A8-Q1/A8-Q4, A8-Q5/A8-Q6: moved cases; A8-Q7: an interrupted QueryRun under a `host_config` probe is left.
 * - A8-Q2 (Q-02): a QueryRun begun with no Kernel Turn (the Kernel store aside at its start, as A8-2's) is closed
 *   and never entered again. A8-Q3 (Q-03): the Kernel answered and the answer was never booked (a composition root
 *   runs the Query and the ledger is locked after its last usage write); the restart books it and writes the Answer.
 * - A8-H4 (H-04): with the Kernel store gone at the restart, idle available Sessions are not probed (a probe would
 *   answer `missing` and write them unavailable); (H-05) in the A8-Q1/Q4 case, the retired Session is probed at
 *   another start, archived by a person, and not probed at the next one.
 *
 * Every case checks the §11 invariants after the steps that change records; the QueryRun cases end with
 * another start on the same data that changes and writes nothing (`expectQuietRestart`), the held-lease
 * cases show the ledger unchanged. Scripted model replies only.
 */
import { afterEach, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskExecutionRecord } from '../../src/app/core-http-types.js';
import { HOST_INSTANCE_LOCK_FILE } from '../../src/app/host-instance-lease.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_ROLE_BINDING, AG2B_WORK_TASK_ID, claimBusyQuery, createAG2bSession, graphWrite, plain,
  seedAG2bWorkGraph, startAG2bHost, startBusyQuery,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  answer, claimQueryOn, deferred, moveKernelAside, post, publicDirectory, readGoal, readQuery, selectWork, tempDir, writeStaleLock,
} from '../helpers/A2-restart-fixture.js';
import { assertInvariants, assertInvariantsAt, cleanupScenarios, hostCtx, openHostScenario, type InvariantTarget } from './harness.js';
import { NO_REDRIVE, execution, lockLedgerAfter, openWorkRoot, putKernelBack, stepOf } from './support/common.js';
import { expectQuietHarnessRestart, expectQuietRestart, kernelTurnOf, ledgerEvents } from './support/restart.js';

afterEach(cleanupScenarios);

const RUN0_TASK = 'ag2b-work-0';
const A8_Q3_ANSWER = 'restart scenario A8-Q3: the answer the Kernel gave';

it('A8-L5 (HL-05, HL-06, HL-07): a lock naming a live process that is no Host (the test process itself) is held: no reconcile, no Kernel entry, no write, reads served; closing leaves the lock for a person', async () => {
  const root = await tempDir('a8-l5-ws-');
  const database = await tempDir('a8-l5-db-');
  const publicDir = await publicDirectory();
  const seeded = await startAG2bHost(publicDir, { root, database });
  try { await seedAG2bWorkGraph(seeded); } finally { await seeded.host.close(); }
  const inv: InvariantTarget = { database };
  await assertInvariantsAt(inv, 'A8-L5 seeded');
  const lockPath = join(database, HOST_INSTANCE_LOCK_FILE);
  const lock = JSON.stringify({ pid: process.pid, hostInstanceId: 'a8-l5-unrelated-process', startedAt: '2026-10-06T00:00:00.000Z' });
  await writeFile(lockPath, lock);
  const before = ledgerEvents(database);
  const held = await startAG2bHost(publicDir, { root, database });
  try {
    // HL-05 is judged alive like HL-02 (the report names the row of the action it takes).
    expect(held.host.reconcile).toMatchObject({ lease: 'held_by_other', leaseRow: 'HL-02', report: null,
      leaseReason: `another live process (pid ${String(process.pid)}) holds the store` });
    await expectHeldHost(held);
    expect(ledgerEvents(database), 'no fact changes on a Host without the lease').toBe(before);
  } finally {
    await held.host.close();
  }
  expect(await readFile(lockPath, 'utf8'), 'HL-06: a Host that never held the lease leaves the lock').toBe(lock);
  await assertInvariantsAt(inv, 'A8-L5 after the held Host');
}, 120_000);

it('A8-Q7 (Q-07, SD-2): a QueryRun interrupted mid-Turn under a host_config probe is left with its Session; the next start with the Kernel registered closes it (Q-04)', async () => {
  const root = await tempDir('a8-q7-ws-');
  const database = await tempDir('a8-q7-db-');
  const publicDir = await publicDirectory();
  const reached = deferred();
  const hold = deferred();
  const first = await startAG2bHost(publicDir, { root, database, queryReplies: [{ kind: 'text', text: 'never answered' }],
    queryBeforeReply: async () => { reached.resolve(); await hold.promise; } });
  const inv: InvariantTarget = { database };
  let inFlight: Promise<unknown> = Promise.resolve();
  try {
    await seedAG2bWorkGraph(first);
    const session = await createAG2bSession(first, 'a8-q7-session');
    const refs = await claimBusyQuery(first, session, 'a8-q7');
    inFlight = startBusyQuery(first, refs, 'a8-q7').catch(() => undefined);
    await reached.promise;
    await writeStaleLock(database);
    await assertInvariantsAt(inv, 'A8-Q7 mid-Turn');
    const atCrash = ledgerEvents(database);
    const entered = await readQuery(first, refs.queryJobRef);

    // The crash; the next Host has no Kernel Store registration: the probe proves nothing (SD-2), nothing is written.
    const second = await startAG2bHost(publicDir, { root, database, noKernelStores: true });
    try {
      expect(second.host.reconcile).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
        sessions: [{ row: 'H-03', status: 'left' }],
        queries: [{ ref: JSON.stringify(refs.queryRunRef), row: 'Q-07', status: 'left' }], problems: [] } });
      expect(ledgerEvents(database)).toBe(atCrash);
      expect((await readQuery(second, refs.queryJobRef)).run).toEqual(entered.run);
      const card = await post<{ status: string; value: { record: TaskExecutionRecord['session'] } }>(second, 'sessions/read',
        plain(AG2B_SCOPE, session.sessionRef));
      expect(card.value.record.occupancy).toMatchObject({ kind: 'execution', executionRef: { runId: refs.queryRunRef.runId } });
      expect(second.queryScripted.calls()).toBe(0);
      await assertInvariantsAt(inv, 'A8-Q7 left');
    } finally {
      await second.host.close();
    }
    // With the Kernel registered again the same QueryRun is reconciled by its Kernel facts (Q-04).
    const third = await startAG2bHost(publicDir, { root, database });
    try {
      expect(third.host.reconcile).toMatchObject({ report: { queries: [{ ref: JSON.stringify(refs.queryRunRef), row: 'Q-04',
        status: 'reconciled' }] } });
      expect((await readQuery(third, refs.queryJobRef)).run.run).toMatchObject({ status: 'closed', outcome: 'failed' });
      await assertInvariantsAt(inv, 'A8-Q7 closed');
      // §12.10 step 4: the QueryRun's claim, sent again with the same identity, gets its original receipt and writes nothing.
      const beforeReplay = ledgerEvents(database);
      expect(await answer(third, 'queries/claim', graphWrite(AG2B_SCOPE, { queryRunRef: refs.queryRunRef,
        sessionRef: session.sessionAggregateRef }, 'ag2b-busy-claim-a8-q7', [{ ref: refs.queryJobRef, revision: 1 },
        { ref: refs.queryRunRef, revision: 1 }, { ref: session.sessionAggregateRef, revision: session.revision }])))
        .toMatchObject({ status: 'committed', replayed: true, value: { run: { ref: refs.queryRunRef } } });
      expect(ledgerEvents(database)).toBe(beforeReplay);
    } finally {
      await third.host.close();
    }
    // §12.10 step 4, while the crashed Host still holds its call (draining it lets its Kernel end the Turn).
    await expectQuietRestart(database, publicDir, root, { label: 'A8-Q7' });
  } finally {
    hold.reject(new Error('A8-Q7: the crashed Host never answers this request'));
    await inFlight;
    await first.host.close();
  }
}, 180_000);

it('A8-Q2 (Q-02, QRR-02, SES-09): a QueryRun whose begin committed and whose Kernel Turn never started is closed at the restart and never entered again (its entry stays generation 1); the same claim request replays its receipt', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'pass', workIds: [RUN0_TASK, AG2B_WORK_TASK_ID],
    script: { replies: [{ kind: 'text', text: 'restart scenario A8-Q2: Run0 completed its Turn in S1' }] } });
  // Run0 completes in S1, so S1 has completed history; a QueryRun of the same role is claimed on it and prepared.
  await h.advance(h.select('a8-q2-run0', RUN0_TASK));
  expect(await h.taskRow(RUN0_TASK)).toMatchObject({ effectivePhase: 'satisfied' });
  const run0Ref = (await h.taskRow(RUN0_TASK)).execution;
  if (run0Ref === null) throw new Error('Run0 must exist');
  const s1 = (await execution(h, run0Ref)).session;
  const claimed = await claimQueryOn(h.host, s1, 'a8-q2', AG2B_WORK_ROLE_BINDING);
  expect(claimed.claim).toMatchObject({ status: 'committed' });
  await assertInvariants(h, 'a8-q2 claimed', stepOf(h, 'other', 'a8-q2 claimed'));
  const prepared = await h.post<ReadResult<unknown>>('queries/prepare', plain(AG2B_SCOPE, { queryRunRef: claimed.queryRunRef,
    requestId: 'a8-q2-prepare' }));
  expect(prepared.status).toBe('ready');
  // The crash point (as A8-2's, support/common.ts `startWithKernelAside`): with the Kernel store aside the begin commits
  // (`entering`) and the read of S1's completed boundary finds no Kernel Session, so the start answers before the Kernel.
  const aside = await moveKernelAside(h.database);
  const started = await h.answer('queries/start', plain(AG2B_SCOPE, { prepared: (prepared as { value: unknown }).value,
    consumerId: AG2B_CONSUMER_ID, requestId: 'a8-q2-start' }));
  await putKernelBack(h.database, aside);
  expect(started).toMatchObject({ status: 'rejected', code: 'not_found' });
  await assertInvariants(h, 'a8-q2 begun', stepOf(h, 'other', 'a8-q2 begun'));
  const entering = await readQuery(h.host, claimed.queryJobRef);
  const state = entering.run.run.executionState;
  expect(state).toMatchObject({ phase: 'entering', entry: { generation: 1 } });
  if (state === undefined || state.entry === null) throw new Error('the begin must fix the Query entry');
  expect(kernelTurnOf(h.database, state.entry.kernel.runId), 'no Kernel Turn of the fixed identity').toBeNull();
  const atCrash = h.counts();

  // The crash. Q-02: the probe is `ready` and no Turn exists: QRR-02 closes it, and nothing enters it again.
  const report = await h.restart({ crash: true });
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [],
    queries: [{ ref: JSON.stringify(claimed.queryRunRef), row: 'Q-02', status: 'reconciled', reason: 'not_entered' }], problems: [] } });
  expect(h.counts(), 'no model request, Kernel Turn or check process during the reconcile').toMatchObject({
    modelCalls: atCrash.modelCalls, kernelTurnsStarted: atCrash.kernelTurnsStarted, kernelRecords: atCrash.kernelRecords });
  const closed = await readQuery(h.host, claimed.queryJobRef);
  expect(closed.run.run).toMatchObject({ status: 'closed', outcome: 'not_entered',
    executionState: { phase: 'settled', entry: { generation: 1, kernel: state.entry.kernel } } });
  expect(closed.job.job).toMatchObject({ status: 'closed', answerRefs: [], closeReason: { code: 'not_entered' } });
  // SES-09: the Session is released with its cursor, still available (no Kernel Turn was opened).
  expect((await execution(h, run0Ref)).session).toMatchObject({ occupancy: null, health: 'available', historyCursor: s1.historyCursor });
  expect(kernelTurnOf(h.database, state.entry.kernel.runId), 'never entered').toBeNull();
  // §12.10 step 4: the same claim request (its answer lost) gets its original receipt and writes nothing.
  const beforeReplay = h.counts();
  expect(await h.answer('queries/claim', graphWrite(AG2B_SCOPE, { queryRunRef: claimed.queryRunRef, sessionRef: s1.ref },
    'a2-restart-claim-a8-q2', [{ ref: claimed.queryJobRef, revision: 1 }, { ref: claimed.queryRunRef, revision: 1 },
      { ref: s1.ref, revision: s1.revision }]))).toEqual({ ...claimed.claim, replayed: true });
  expect(h.counts()).toEqual(beforeReplay);
  await expectQuietHarnessRestart(h, 'a8-q2');
}, 180_000);

it('A8-Q3 (Q-03, QRR-03, SES-08): the Kernel answered the Query and the answer was never booked; the restart books the Kernel\'s own terminal (R source) and writes the Answer', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'pass' });
  const session = await createAG2bSession(h.host, 'a8-q3-session');
  const refs = await claimBusyQuery(h.host, session, 'a8-q3');
  await assertInvariants(h, 'a8-q3 claimed', stepOf(h, 'other', 'a8-q3 claimed'));
  // The crash point (§12.10 step 1, 故障注入; the Host has no seam inside one Runtime call): a composition root on the
  // same files with the Host's query binding prepares and starts the QueryRun; during its one model call the test arms
  // the lock, so right after the call's usage write the ledger is locked: the Kernel answers in its own store and the
  // Query's observed commit fails.
  let armed = false;
  const lock = lockLedgerAfter(h.database, last => armed && last === 'QueryExecutionRecorded');
  const queryModel = createScriptedModel([{ kind: 'text', text: A8_Q3_ANSWER }], async () => { armed = true; });
  const root = await openWorkRoot(h, createScriptedModel([]), lock.observer, queryModel);
  let started: unknown;
  try {
    const prepared = await root.runtime.prepareQuery!(hostCtx(), { queryRunRef: refs.queryRunRef, requestId: 'a8-q3-prepare' });
    if (prepared.status !== 'ready') throw new Error(`the Query must be prepared: ${JSON.stringify(prepared)}`);
    started = await root.runtime.startQuery!(hostCtx(), { prepared: prepared.value, consumerId: AG2B_CONSUMER_ID, requestId: 'a8-q3-start' });
  } finally {
    lock.release();
    await root.close();
  }
  expect(lock.locked(), 'the lock was taken after the call\'s usage write').toBe(true);
  expect(started).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect(JSON.stringify(started)).toContain('database is locked');
  expect(queryModel.calls()).toBe(1);
  await assertInvariants(h, 'a8-q3 answered in the Kernel, not booked', stepOf(h, 'other', 'a8-q3 answered in the Kernel, not booked'));
  const entered = await readQuery(h.host, refs.queryJobRef);
  expect(entered.job.job).toMatchObject({ status: 'running', answerRefs: [] });
  const state = entered.run.run.executionState;
  if (state === undefined || state.entry === null) throw new Error('the QueryRun must have entered');
  expect(state.phase).not.toBe('settled');
  expect(kernelTurnOf(h.database, state.entry.kernel.runId)?.eventTypes, 'the Kernel completed the Turn').toContain('run.completed');
  const atCrash = h.counts();

  // The crash. Q-03: a mappable Kernel terminal: QRR-03 books it as the Query observer does and writes the Answer.
  const report = await h.restart({ crash: true });
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [],
    queries: [{ ref: JSON.stringify(refs.queryRunRef), row: 'Q-03', status: 'reconciled', reason: 'terminal completed' }], problems: [] } });
  expect(h.counts(), 'no model request or Kernel Turn during the reconcile').toMatchObject({
    modelCalls: atCrash.modelCalls, kernelTurnsStarted: atCrash.kernelTurnsStarted, kernelRecords: atCrash.kernelRecords });
  expect(queryModel.calls()).toBe(1);
  const answered = await readQuery(h.host, refs.queryJobRef);
  expect(answered.job.job).toMatchObject({ status: 'answered', answerRefs: [{ aggregateType: 'QueryJobAnswer' }] });
  expect(answered.run.run).toMatchObject({ executionState: { phase: 'settled' } });
  // SES-08: the Session is released; the Turn ended in the Kernel, so it stays available.
  const card = await h.post<{ status: string; value: { record: TaskExecutionRecord['session'] } }>('sessions/read',
    plain(AG2B_SCOPE, session.sessionRef));
  expect(card.value.record).toMatchObject({ occupancy: null, health: 'available' });
  await expectQuietHarnessRestart(h, 'a8-q3');
}, 180_000);

it('A8-H4 (H-04, S8): an idle, available Session is never probed: with the Kernel store gone at the restart a probe would answer `missing` and write it unavailable (H-02); nothing of it is reported or written', async () => {
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'pass',
    script: { replies: [{ kind: 'text', text: 'restart scenario A8-H4: the work is done' }] } });
  // The Goal completes: its Run's Session is idle and available; a second idle Session never ran anything.
  expect((await h.advance(h.select('a8-h4'))).state).toBe('completed');
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Task must select its Run');
  const runSession = (await execution(h, runRef)).session;
  expect(runSession).toMatchObject({ occupancy: null, health: 'available' });
  const fresh = await createAG2bSession(h.host, 'a8-h4-idle');
  await assertInvariants(h, 'a8-h4 idle Session', stepOf(h, 'other', 'a8-h4 idle Session'));
  const readSession = async (sessionRef: unknown): Promise<TaskExecutionRecord['session']> =>
    (await h.post<{ status: string; value: { record: TaskExecutionRecord['session'] } }>('sessions/read', plain(AG2B_SCOPE, sessionRef))).value.record;
  const freshBefore = await readSession(fresh.sessionRef);

  // The Kernel store is gone at the restart. H-04: neither idle Session is probed (a probe would see `missing`).
  const aside = await moveKernelAside(h.database);
  const atCrash = h.counts();
  const report = await h.restart({ crash: true });
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { sessions: [], runs: [], queries: [], checks: [],
    controls: [], redriveGoals: [], problems: [] } });
  expect(h.counts(), 'nothing is written').toEqual(atCrash);
  expect((await execution(h, runRef)).session, 'the Run\'s idle Session is untouched').toEqual(runSession);
  expect(await readSession(fresh.sessionRef), 'the never-used idle Session is untouched').toEqual(freshBefore);
  await putKernelBack(h.database, aside);
  await expectQuietHarnessRestart(h, 'a8-h4');
}, 120_000);

// Moved from tests/app/A2-host-restart.test.ts:394 (05125db): A8-L2 (HL-02, HL-07) and A8-L6 (HL-06).
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
    const before = ledgerEvents(database);   // A.2 step 6
    const other = await startAG2bHost(publicDir, { root, database });
    try {
      expect(other.host.reconcile).toMatchObject({ lease: 'held_by_other', leaseRow: 'HL-02', report: null,
        leaseReason: `another live process (pid ${String(process.pid)}) holds the store` });
      await expectHeldHost(other);
      expect(ledgerEvents(database), 'the Host without the lease changed no fact').toBe(before);   // A.2 step 6
      await assertInvariantsAt({ database }, 'A8-L2 held Host');   // A.2 step 6
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

// Moved from tests/app/A2-host-restart.test.ts:420 (05125db): A8-L4 (HL-04).
it('HL-04: a damaged lock is held as another Host\'s: no reconcile, no Kernel entry, reads served, the lock left for a person', async () => {
  const root = await tempDir('a2-lease4-ws-');
  const database = await tempDir('a2-lease4-db-');
  const publicDir = await publicDirectory();
  const seeded = await startAG2bHost(publicDir, { root, database });
  try { await seedAG2bWorkGraph(seeded); } finally { await seeded.host.close(); }
  const lockPath = join(database, HOST_INSTANCE_LOCK_FILE);
  await writeFile(lockPath, 'a damaged lock');
  const before = ledgerEvents(database);   // A.2 step 6
  const held = await startAG2bHost(publicDir, { root, database });
  try {
    expect(held.host.reconcile).toMatchObject({ lease: 'held_by_other', leaseRow: 'HL-04', report: null });
    await expectHeldHost(held);
    expect(ledgerEvents(database), 'the Host without the lease changed no fact').toBe(before);   // A.2 step 6
    await assertInvariantsAt({ database }, 'A8-L4 held Host');   // A.2 step 6
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

// Moved from tests/app/A2-host-reconcile.test.ts:240 (05125db): A8-Q1 (Q-01, QRR-01) and A8-Q4 (Q-04, QRR-04).
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
    await assertInvariantsAt({ database }, 'A8-Q1/Q4 reconciled');   // A.2 step 6
    // A.2 step 6: §12.10 step 4, the claim of the QueryRun Q-01 closed, sent again with the same identity (its answer
    // lost), gets its original receipt and writes nothing.
    const beforeReplay = ledgerEvents(database);
    expect(await answer(second, 'queries/claim', graphWrite(AG2B_SCOPE, { queryRunRef: claimed.queryRunRef,
      sessionRef: claimedSession.sessionAggregateRef }, 'ag2b-busy-claim-claimed', [{ ref: claimed.queryJobRef, revision: 1 },
      { ref: claimed.queryRunRef, revision: 1 }, { ref: claimedSession.sessionAggregateRef, revision: claimedSession.revision }])))
      .toMatchObject({ status: 'committed', replayed: true, value: { run: { ref: claimed.queryRunRef } } });
    expect(ledgerEvents(database)).toBe(beforeReplay);

    // A.2 step 6: §12.10 step 4 and A8-H4 (H-05), while the crashed Host still holds its call (draining it lets its
    // Kernel end the Turn, new Kernel data). Another start reconciles nothing: the retired Session is probed and left
    // (H-01: its Kernel Turn is still open); a person archives it; the next start does not probe it at all (H-05).
    await second.host.close();
    const startedLine = JSON.stringify({ projectId: startedSession.sessionRef.projectId, sessionId: startedSession.sessionRef.sessionId });
    let archivedRevision = 0;
    const probed = await expectQuietRestart(database, publicDir, root, { label: 'A8-Q1/Q4 again', whileOpen: async host => {
      const card = await post<{ status: string; value: { record: TaskExecutionRecord['session'] } }>(host, 'sessions/read',
        plain(AG2B_SCOPE, startedSession.sessionRef));
      const archived = await post<WriteResult<TaskExecutionRecord['session']>>(host, 'sessions/archive', graphWrite(AG2B_SCOPE,
        { sessionRef: startedSession.sessionRef, reason: 'A8-H4: the retired Session is archived' }, 'a8-h4-archive',
        [{ ref: card.value.record.ref, revision: card.value.record.revision }]));
      if (archived.status !== 'committed') throw new Error(`archive: ${JSON.stringify(archived)}`);
      expect(archived.value).toMatchObject({ lifecycle: 'archived', health: 'unavailable', healthConclusion: 'kernel_turn_open' });
      archivedRevision = archived.value.revision;
      await assertInvariantsAt({ database }, 'A8-H4 archived');
    } });
    expect(probed.report?.sessions).toEqual([expect.objectContaining({ ref: startedLine, row: 'H-01', status: 'left' })]);
    const skipped = await expectQuietRestart(database, publicDir, root, { label: 'A8-H4 (H-05)', whileOpen: async host => {
      const card = await post<{ status: string; value: { record: TaskExecutionRecord['session'] } }>(host, 'sessions/read',
        plain(AG2B_SCOPE, startedSession.sessionRef));
      expect(card.value.record).toMatchObject({ revision: archivedRevision, lifecycle: 'archived' });
    } });
    expect(skipped.report?.sessions, 'H-05: an archived Session is not probed').toEqual([]);
  } finally {
    hold.reject(new Error('A2 crash: the crashed Host never answers this request'));
    await inFlight;
    await first.host.close();
    await second.host.close();
  }
}, 180_000);

// Moved from tests/app/A2-host-reconcile.test.ts:297 (05125db): A8-Q5 (Q-05, QRR-05) and A8-Q6 (QRR-06, L-1).
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
    const inv: InvariantTarget = { database };   // A.2 step 6
    await assertInvariantsAt(inv, 'A8-Q5 reconciled');   // A.2 step 6
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
    await assertInvariantsAt(inv, 'A8-Q6 attested');   // A.2 step 6
    const closed = await readQuery(second, refs.queryJobRef);
    expect(closed.run.run).toMatchObject({ status: 'closed', outcome: 'failed', executionState: { phase: 'settled',
      unknown: { kind: 'kernel_unreadable', verdict: 'missing' } } });
    expect(closed.job.job).toMatchObject({ status: 'closed', closeReason: { message: 'the consultation was answered by hand' } });
    // SES-10 + LA-1: the unreadable Kernel counts as an open Turn: the Session is released and retired.
    const card = await post<{ status: string; value: { record: TaskExecutionRecord['session'] } }>(second, 'sessions/read',
      plain(AG2B_SCOPE, session.sessionRef));
    expect(card.value.record).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open' });
    expect(second.scripted.calls() + second.queryScripted.calls(), 'the reconcile and the attestation call no model').toBe(0);   // A.2 step 6

    // A.2 step 6: §12.10 step 4, while the crashed Host still holds its call (draining it lets its Kernel end the Turn);
    // the Kernel still missing, H-02 meets kernel_turn_open (SES-19 keeps it). On that Host, the same attestation again
    // (its answer lost, the person retries) gets the original receipt and writes nothing (QRR-06 同请求身份重放).
    await second.host.close();
    await expectQuietRestart(database, publicDir, root, { label: 'A8-Q5/Q6 again', whileOpen: async host => {
      const before = ledgerEvents(database);
      const replayed = await answer(host, 'queries/resolve-unknown', graphWrite(AG2B_SCOPE,
        { queryRunRef: refs.queryRunRef, reason: 'the consultation was answered by hand' }, 'a2-q6', pin));
      expect(ledgerEvents(database)).toBe(before);
      expect(replayed, `the same attestation again: ${JSON.stringify(replayed)}`).toMatchObject({ status: 'committed', replayed: true });
      // §1.2 "同身份异内容：idempotency_conflict": the same identity with another reason is refused by its receipt,
      // before the pin and the phase are compared, and writes nothing.
      const conflicting = await answer(host, 'queries/resolve-unknown', graphWrite(AG2B_SCOPE,
        { queryRunRef: refs.queryRunRef, reason: 'another reason' }, 'a2-q6', pin));
      expect(ledgerEvents(database)).toBe(before);
      expect(conflicting, `the same identity, another reason: ${JSON.stringify(conflicting)}`)
        .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    } });
  } finally {
    hold.reject(new Error('A2 crash: the crashed Host never answers this request'));
    await inFlight;
    await first.host.close();
    await second.host.close();
  }
}, 180_000);
