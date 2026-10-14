/**
 * A.2 step 6, scenario A8, the A8-2 cases (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" A8 row,
 * §12.10 A8-2a..A8-2c and the A8-1c supplement; §12.2 W-03, W-05..W-07, §12.5 CI-10, §12.6 H-01..H-03;
 * lead decisions L-1, L-2, LA-1, LA-6): a work Run whose begin committed and whose Kernel Turn never
 * started, on rebuilt Hosts over one SQLite ledger and Kernel store, with scripted model replies.
 *
 * The Host has no Kernel seam, so this crash point is reached with the Kernel store moved aside at the
 * Workflow `start` (support/common.ts `startWithKernelAside`): the begin commits (RUN-02, RUN-04) and the
 * Runtime's completed-boundary read finds no Kernel Session, so the Run stays `Entering` with no Turn.
 *
 * - A8-2a, A8-1c (W-05, W-03): with the Kernel readable at the restart the binding is revoked (RUN-16) and
 *   the same claim re-authorizes with the bound brief (RUN-03, I-19): at once with the start-up re-drive on,
 *   at a later start with it on when it was off (a true W-03 Run re-driven); with a queued cancel RUN-09
 *   ends the Run in the same commit.
 * - A8-2b (W-06, W-15): with the Kernel unreadable the Run ends outcome_unknown without a Turn (RUN-20(ii),
 *   ATT-36, ATT-37, L-2) until a person attests it on the lease Host (L-1, RUN-22, ATT-29), with the Kernel
 *   back or still missing (SES-07); H-01 returns the Session once the Kernel shows its last Turn ended.
 * - A8-2c (W-07, H-03, CI-10): a `host_config` probe leaves the Run and its queued cancel as they are.
 * - A8-1b (W-02): a requeue Run authorized and never begun (support/common.ts `authorizeWithoutBegin`) is re-driven
 *   by the start-up re-drive with its bound brief rebuilt (`rehydratePreparedExecution`, I-19), no workflow/advance.
 * - A8-1a requeue variant (W-01, W-24): a requeue Run claimed and never prepared is re-prepared by the start-up
 *   re-drive; its brief is assembled then, from the workspace as it is.
 * - A8-2d (W-08): the begin committed and the Kernel Turn started, the entered fact never booked (a composition
 *   root runs the start and the ledger is locked right after the begin, support/common.ts `lockLedgerAfter`);
 *   the restart classifies the Turn by the W-11 rule and records the entry facts in the same commit; its start-up
 *   maintenance then closes the open Kernel Turn (K KA1) and the Session is available again, not archived.
 *
 * Every step that changes records is followed by the §11 invariant check (the harness does it in
 * `advance()` and after every restart); the reconcile's model calls, Kernel Turns and check starts are
 * counted; every case ends with another start on the same data that writes nothing
 * (`expectQuietHarnessRestart`). Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import { continuationBriefMarker } from '../../src/contracts/continuation-brief.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { answer, post, readControl } from '../helpers/A2-restart-fixture.js';
import { assertInvariants, cleanupScenarios, hostCtx, openHostScenario, performs, waitFor, type HostScenario } from './harness.js';
import {
  authorizeWithoutBegin, codeOf, editThenText, execution, lockLedgerAfter, openWorkRoot, preparedOf, putKernelBack, redrivePolicy,
  removeKernelFiles, requiredBriefOf, sourceDigestOf, startWithKernelAside, stepOf,
} from './support/common.js';
import { expectQuietHarnessRestart, kernelTurnOf, RUN1_WITHOUT_FILE, sessionLineRef } from './support/restart.js';

afterEach(cleanupScenarios);

/**
 * Run 1 answers without the result file, so its round FAILs; the Workflow requeues the Task
 * automatically (check_failed #1) and claims the requeue in Run 1's Session, which holds Run 1's
 * completed Turn (W-21), and prepares Run 2 with its brief. Returns Run 2 unstarted and its `start`.
 */
async function requeuedRunBeforeStart(h: HostScenario, flowId: string) {
  const toStart = await h.advance(h.select(flowId, AG2B_WORK_TASK_ID), { stopBefore: (input) => input.kind === 'perform'
    && input.operation.kind === 'start' && (h.lastWorld?.requeues.length ?? 0) === 1 });
  expect(toStart.state).toBe('stopped');
  expect(h.lastWorld?.requeues).toMatchObject([{ failureClass: 'check_failed',
    automation: { automatic: true, counted: true, autoCount: 1 } }]);
  const run2Ref = (await h.taskRow()).execution;
  if (run2Ref === null || toStart.next === null) throw new Error('Run 2 must be claimed and prepared');
  const run2 = await execution(h, run2Ref);
  expect(run2.run).toMatchObject({ status: 'starting', requeueRef: h.lastWorld?.requeues[0]?.ref });
  expect(run2.session.historyCursor, 'Run 2 is claimed in a Session with completed history').not.toBeNull();
  return { run2Ref, start: toStart.next, sessionRef: run2.session.ref };
}

it('A8-2a, A8-1c (W-05, W-03, RUN-16, RUN-03, I-19): an Entering Run with no Kernel Turn is revoked at the restart and the same claim re-authorizes with the bound brief; on, the start-up re-drive does it at once; off, the revoked Run (W-03) waits, and a later start with the re-drive on re-drives it without a workflow/advance', async () => {
  for (const resumeOnStartup of [false, true]) {
    const h = await openHostScenario({ automation: redrivePolicy(resumeOnStartup),
      script: { replies: [RUN1_WITHOUT_FILE, ...editThenText(`a8-2a-${String(resumeOnStartup)}`)] } });
    const { run2Ref, start } = await requeuedRunBeforeStart(h, `a8-2a-${String(resumeOnStartup)}`);
    const kernelBefore = h.kernelSnapshot();
    const aside = await startWithKernelAside(h, start);
    // The begin committed (RUN-02, RUN-04) and the Kernel was never reached: Entering, nothing written in the Kernel.
    const entering = await execution(h, run2Ref);
    expect(entering.run).toMatchObject({ status: 'starting', startedAt: null,
      executionAuthorization: { schemaVersion: 2, phase: 'entering', generation: 1 } });
    expect(entering.attempt).toMatchObject({ status: 'claimed', startedAt: null });
    expect(entering.outbox).toMatchObject({ status: 'pending' });
    const digest = entering.run.inputBinding?.continuationBriefDigest;
    expect(digest, 'RUN-02 bound the brief of the requeued Run').toEqual(expect.any(String));
    expect((await requiredBriefOf(h.host, run2Ref)).digest).toBe(digest);
    await putKernelBack(h.database, aside);
    expect(h.kernelSnapshot(), 'the real Kernel store is back unchanged').toEqual(kernelBefore);
    const beforeRestart = h.counts();

    // A8-2a: the crash. The Kernel holds no Turn of the fixed identity, the probe is `ready`: RUN-16.
    const report = await h.restart({ crash: true });
    expect(report, String(resumeOnStartup)).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
      runs: [{ ref: JSON.stringify(run2Ref), row: 'W-05', status: 'reconciled', reason: 'not_entered' }],
      queries: [], checks: [], controls: [], problems: [],
      // §12.1 step 6b (b): the revoked Run is re-driven with the same claim, so its Goal is selected either way.
      redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [AG2B_WORK_TASK_ID] }] } });
    const hostInstanceId = report.hostInstanceId;
    if (!resumeOnStartup) {
      // RUN-16 writes the Run only (ATT-04, ATT-21, ATT-25): Attempt, Outbox, Lease and Session keep their revisions.
      const revoked = await execution(h, run2Ref);
      expect(revoked.run).toMatchObject({ status: 'starting', executionAuthorization: { phase: 'revoked', generation: 1 },
        reconciliation: { status: 'done', basis: { kind: 'host_instance_takeover', hostInstanceId } } });
      expect(revoked.attempt).toEqual(entering.attempt);
      expect(revoked.outbox).toEqual(entering.outbox);
      expect(revoked.lease).toEqual(entering.lease);
      expect(revoked.session).toEqual(entering.session);
      // §12.10 step 4: no Kernel Turn, provider request or check process during the reconcile; the Kernel is untouched.
      expect(h.counts()).toMatchObject({ modelCalls: beforeRestart.modelCalls, kernelTurnsStarted: beforeRestart.kernelTurnsStarted,
        checksBegun: beforeRestart.checksBegun, kernelRecords: beforeRestart.kernelRecords });
      expect(h.kernelSnapshot()).toEqual(kernelBefore);
      // Another start with the re-drive off writes nothing: the revoked Run (W-03 now) is never reconciled again,
      // and step 6b (b) still selects its Goal; no driver starts.
      const reconciled = h.counts();
      const again = await h.restart({ crash: true });
      expect(again.report).toMatchObject({ runs: [], controls: [], problems: [],
        redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [AG2B_WORK_TASK_ID] }] });
      expect(h.counts()).toEqual(reconciled);
      // A8-1c: a later start with the re-drive on re-drives the W-03 Run with the same claim, no workflow/advance:
      // RUN-03 (generation 2), the bound input, Run 2 completes.
      const redriven = await h.restart({ automation: redrivePolicy(true) });
      expect(redriven.report).toMatchObject({ runs: [], problems: [],
        redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [AG2B_WORK_TASK_ID] }] });
    }
    // The start-up re-drive (the crash restart when on, the later start when off) completes the Goal by itself.
    await waitFor(() => h.goalDisplay(), display => display.phase === 'COMPLETED', 'the start-up re-drive to complete the Goal');
    await assertInvariants(h, `a8-2a re-driven (${String(resumeOnStartup)})`);
    const done = await execution(h, run2Ref);
    expect((await h.taskRow()).execution, 'the same Run, no new claim').toEqual(run2Ref);
    expect(done.run).toMatchObject({ status: 'ended', outcome: 'completed',
      executionAuthorization: { schemaVersion: 2, generation: 2 }, inputBinding: { continuationBriefDigest: digest } });
    expect(done.attempt.ref, 'RUN-03 makes no new Attempt (ATT-04)').toEqual(entering.attempt.ref);
    // I-19: the re-authorized Run kept its brief (rehydratePreparedExecution); its first model request carries the marker.
    expect((await requiredBriefOf(h.host, run2Ref)).digest).toBe(digest);
    const run2Requests = h.modelRequests().slice(1);
    expect(JSON.stringify(run2Requests[0]?.messages ?? [])).toContain(continuationBriefMarker(digest!));
    expect(h.modelCalls(), 'Run 1, then Run 2 (edit and final text)').toBe(3);
    expect(h.lastWorld?.requeues, 'no further requeue').toHaveLength(1);
    // §12.10 step 4: the `start` the crash interrupted, sent again with the same identity, answers the Run as the
    // re-drive booked it (a read-shaped answer): no Kernel Turn, no model call, no write.
    const beforeResend = h.counts();
    expect(await h.answer('workflow/advance', plain(AG2B_SCOPE, start))).toMatchObject({ status: 'ready', value: { receipt: {
      kind: 'start', result: { status: 'ready', value: { run: { ref: run2Ref, status: 'ended', outcome: 'completed', revision: done.run.revision } } } } } });
    expect(h.counts(), 'the same start again writes nothing').toEqual(beforeResend);
    await expectQuietHarnessRestart(h, `a8-2a ${String(resumeOnStartup)}`);
  }
}, 240_000);

it('A8-2a with a queued cancel (W-05, RUN-16 + RUN-09, CTL-08(a)): a cancel submitted while the Run is Entering stays queued; the restart revokes the entry and ends the Run cancelled in the same commit, releasing its claim', async () => {
  const h = await openHostScenario({ automation: redrivePolicy(true), script: { replies: [RUN1_WITHOUT_FILE] } });
  const { run2Ref, start } = await requeuedRunBeforeStart(h, 'a8-2a-cancel');
  const aside = await startWithKernelAside(h, start);
  // Entering may already have entered the Kernel, so a person's cancel cannot apply at once (D-7 is for Runs that never began).
  const run = await execution(h, run2Ref);
  const cancelled = await h.post<WriteResult<{ intent: ControlIntentSnapshotV1 }>>('controls/submit', graphWrite(AG2B_SCOPE,
    { runRef: run2Ref, kind: 'cancel', reason: 'restart scenario: stop the entering Run' }, 'a8-2a-cancel',
    [{ ref: run2Ref, revision: run.run.revision }]));
  if (cancelled.status !== 'committed') throw new Error(`cancel: ${JSON.stringify(cancelled)}`);
  const cancelRef = cancelled.value.intent.ref;
  expect(cancelled.value.intent).toMatchObject({ status: 'queued' });
  await assertInvariants(h, 'a8-2a cancel queued', stepOf(h, 'other', 'a8-2a cancel queued'));
  await putKernelBack(h.database, aside);
  const atCrash = h.counts();

  const report = await h.restart({ crash: true });
  expect(report.report).toMatchObject({ runs: [{ ref: JSON.stringify(run2Ref), row: 'W-05', status: 'reconciled', reason: 'not_entered' }],
    // Hard limit 3: the person's cancel is no automation verdict, and the Run is no longer re-drivable (6b).
    redriveGoals: [], problems: [] });
  expect(h.counts()).toMatchObject({ modelCalls: atCrash.modelCalls, kernelTurnsStarted: atCrash.kernelTurnsStarted,
    kernelRecords: atCrash.kernelRecords });
  const ended = await execution(h, run2Ref);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
  expect(await readControl(h.host, cancelRef)).toMatchObject({ status: 'applied', observation: { origin: 'platform_not_entered', kind: 'cancelled' } });
  expect(ended.attempt).toMatchObject({ status: 'ended', endOutcome: 'cancelled', startedAt: null });
  expect(ended.outbox).toMatchObject({ status: 'settled' });
  expect(ended.lease?.release).toBeDefined();
  expect(ended.session).toMatchObject({ occupancy: null, health: 'available' });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed', failure: { failureClass: 'cancelled',
    automation: { verdict: { kind: 'stopped', reason: 'task_cancelled' } } } });
  await expectQuietHarnessRestart(h, 'a8-2a cancelled');
}, 180_000);

it('A8-2b, L-2, L-1 (W-06, W-15, RUN-20(ii), RUN-22, ATT-36, ATT-37, ATT-29): an Entering Run with the Kernel unreadable ends outcome_unknown without a Turn; with the Kernel back it waits for evidence; a Host without the lease cannot attest it, the lease Host settles the pending Outbox', async () => {
  const h = await openHostScenario({ automation: redrivePolicy(true), script: { replies: [RUN1_WITHOUT_FILE] } });
  const { run2Ref, start, sessionRef } = await requeuedRunBeforeStart(h, 'a8-2b');
  const aside = await startWithKernelAside(h, start);
  const entering = await execution(h, run2Ref);
  expect(entering.run.executionAuthorization).toMatchObject({ phase: 'entering', generation: 1 });
  // The crashed Host's Kernel database is gone at the restart: the probe is `missing` (SD-3: no proof of anything).
  await removeKernelFiles(h.database);
  const beforeRestart = h.counts();

  const report = await h.restart({ crash: true });
  const hostInstanceId = report.hostInstanceId;
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
    sessions: [{ ref: sessionLineRef(sessionRef), row: 'H-02', status: 'reconciled' }],
    runs: [{ ref: JSON.stringify(run2Ref), row: 'W-06', status: 'reconciled', reason: 'unknown' }],
    // Hard limit 1: outcome_unknown is no failure class; nothing is re-driven.
    redriveGoals: [], problems: [] } });
  expect(h.counts()).toMatchObject({ modelCalls: beforeRestart.modelCalls, checksBegun: beforeRestart.checksBegun,
    kernelTurnsStarted: beforeRestart.kernelTurnsStarted, kernelRecords: beforeRestart.kernelRecords });
  // RUN-20(ii): unknown with no Turn to record; ATT-36: the Attempt ends with startedAt null; ATT-37: the Outbox stays
  // pending (same revision); the Lease and the Session are kept (ATT-20, D-4); SES-12 records the Session unavailable.
  const unknown = await execution(h, run2Ref);
  expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown', startedAt: null,
    reconciliation: { status: 'quarantined', basis: { kind: 'host_instance_takeover', hostInstanceId },
      observation: { kind: 'unresolved', reason: 'kernel_unreadable', observedThroughPosition: null, unresolvedToolCallIds: [] } } });
  expect(unknown.attempt).toMatchObject({ status: 'ended', endOutcome: 'outcome_unknown', startedAt: null });
  expect(unknown.outbox).toEqual(entering.outbox);
  expect(unknown.lease).toEqual(entering.lease);
  expect(unknown.session).toMatchObject({ occupancy: { kind: 'execution', executionRef: { runId: run2Ref.runId } },
    health: 'unavailable', healthConclusion: 'missing' });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'run_outcome_unknown' } });

  // The Kernel is readable again and still holds no Turn of the fixed identity: no new fact (W-15), the Run is left;
  // the probe makes the Session available again while the unknown end keeps it (SES-13).
  await putKernelBack(h.database, aside);
  const unknownCounts = h.counts();
  const back = await h.restart({ crash: true });
  expect(back.report).toMatchObject({ runs: [{ ref: JSON.stringify(run2Ref), row: 'W-15', status: 'left' }], redriveGoals: [], problems: [] });
  expect((await execution(h, run2Ref)).run.revision, 'W-15 without new evidence writes no Run').toBe(unknown.run.revision);
  expect(h.counts()).toMatchObject({ modelCalls: unknownCounts.modelCalls, kernelTurnsStarted: unknownCounts.kernelTurnsStarted });

  // L-1 (HL-02, HL-07): a Host without the instance lease answers busy and writes nothing.
  const peer = await h.startPeer();
  const pin = [{ ref: run2Ref, revision: unknown.run.revision }];
  const beforePeer = h.counts();
  expect(await answer(peer, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
    { runRef: run2Ref, reason: 'checked by hand on the other Host' }, 'a8-2b-attest-peer', pin)))
    .toMatchObject({ status: 'rejected', code: 'busy' });
  expect(h.counts()).toEqual(beforePeer);

  // RUN-22 on the lease Host: crashed `human_attested`; ATT-29 settles the Outbox from the ATT-37 pending with the
  // entering binding; the person's attestation keeps startedAt null; the Lease and the Session are released.
  const attested = await post(h.host, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
    { runRef: run2Ref, reason: 'the Run never reached the Kernel' }, 'a8-2b-attest', pin));
  expect(attested).toMatchObject({ status: 'committed', replayed: false });
  await assertInvariants(h, 'a8-2b attested', stepOf(h, 'other', 'a8-2b attested'));
  const ended = await execution(h, run2Ref);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed', startedAt: null,
    terminalPayload: { kind: 'crashed', error: 'human_attested: the Run never reached the Kernel' },
    reconciliation: { status: 'done', observation: { kind: 'human_attested', reason: 'the Run never reached the Kernel' } } });
  expect(ended.attempt).toMatchObject({ status: 'ended', startedAt: null });
  const authorization = unknown.run.executionAuthorization;
  if (authorization === undefined || !('schemaVersion' in authorization) || authorization.schemaVersion !== 2) {
    throw new Error('the Run must keep its V2 authorization');
  }
  expect(ended.outbox).toMatchObject({ status: 'settled', revision: entering.outbox.revision + 1,
    dispatchState: { phase: 'settled', consumerId: authorization.consumerId, entryGeneration: authorization.generation } });
  // QUESTION Q8 (restart notes): the Kernel is readable at the attestation and no Turn of this Run exists; the Kernel
  // Session's last Turn (Run 1's) ended, so the Kernel takes a new Turn there. SES-07 takes `kernelTurnOpen` from the
  // Kernel read at the attestation and §8 defines kernel_turn_open by the Kernel facts only ("最后一个 Turn 没有 Kernel
  // 终态"), so the Session is not retired. (Attested with the Kernel still unreadable it is: the next case.)
  expect(ended.session).toMatchObject({ occupancy: null, health: 'available' });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'run_failed',
    detail: { outcome: 'crashed', origin: 'human_attested' } } });
  expect(h.modelCalls(), 'only Run 1 called the model').toBe(1);
  // §12.10 step 4: another start on the same data writes nothing.
  await expectQuietHarnessRestart(h, 'a8-2b attested');
  // §12.10 step 4: the same request (an answer lost, the person retries) gets the original receipt.
  const afterAttestation = h.counts();
  expect(await answer(h.host, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
    { runRef: run2Ref, reason: 'the Run never reached the Kernel' }, 'a8-2b-attest', pin)))
    .toMatchObject({ status: 'committed', replayed: true });
  expect(h.counts()).toEqual(afterAttestation);
  // §1.2 "同身份异内容：idempotency_conflict": the same identity with another reason is refused by its receipt, before
  // the pin and the Run's state are compared (CTL-01 order), and writes nothing.
  expect(await answer(h.host, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
    { runRef: run2Ref, reason: 'another reason' }, 'a8-2b-attest', pin)))
    .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  expect(h.counts()).toEqual(afterAttestation);
}, 180_000);

it('A8-2b, SES-07, SES-19, H-01 (W-06, RUN-22, LA-1): attested while the Kernel is still unreadable, the Session is retired kernel_turn_open in place of missing; a start with the Kernel still missing keeps it; with the Kernel back and its last Turn ended, the probe returns it to available', async () => {
  const h = await openHostScenario({ automation: redrivePolicy(false), script: { replies: [RUN1_WITHOUT_FILE] } });
  const { run2Ref, start, sessionRef } = await requeuedRunBeforeStart(h, 'a8-2b-missing');
  const aside = await startWithKernelAside(h, start);
  const entering = await execution(h, run2Ref);
  const kernelSessionId = entering.session.kernel.kernelSessionId;
  await removeKernelFiles(h.database);
  const report = await h.restart({ crash: true });
  expect(report.report).toMatchObject({ sessions: [{ ref: sessionLineRef(sessionRef), row: 'H-02', status: 'reconciled' }],
    runs: [{ ref: JSON.stringify(run2Ref), row: 'W-06', status: 'reconciled', reason: 'unknown' }], problems: [] });
  const unknown = await execution(h, run2Ref);
  expect(unknown.session).toMatchObject({ health: 'unavailable', healthConclusion: 'missing' });

  // RUN-22 on the lease Host with the Kernel unreadable (SES-07: "Kernel 不可读时仍可认定"): no read proves the Turn
  // ended, so `kernelTurnOpen` is true and the conclusion `missing` becomes `kernel_turn_open` in the same commit.
  const attested = await post(h.host, 'executions/resolve-unknown', graphWrite(AG2B_SCOPE,
    { runRef: run2Ref, reason: 'the Kernel store was lost with the Host' }, 'a8-2b-missing-attest',
    [{ ref: run2Ref, revision: unknown.run.revision }]));
  expect(attested).toMatchObject({ status: 'committed', replayed: false });
  await assertInvariants(h, 'a8-2b attested, Kernel missing', stepOf(h, 'other', 'a8-2b attested, Kernel missing'));
  const ended = await execution(h, run2Ref);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed', startedAt: null,
    reconciliation: { status: 'done', observation: { kind: 'human_attested', reason: 'the Kernel store was lost with the Host' } } });
  expect(ended.attempt).toMatchObject({ status: 'ended', startedAt: null });
  expect(ended.outbox).toMatchObject({ status: 'settled', revision: entering.outbox.revision + 1 });
  expect(ended.session).toMatchObject({ occupancy: null, health: 'unavailable', healthConclusion: 'kernel_turn_open',
    historyCursor: unknown.session.historyCursor });

  // §12.10 step 4 with the Kernel still missing: H-02 meets kernel_turn_open, which SES-19 keeps; nothing is written.
  const stillMissing = await expectQuietHarnessRestart(h, 'a8-2b Kernel still missing');
  expect(stillMissing.report?.sessions).toEqual([{ ref: sessionLineRef(sessionRef), row: 'H-02', status: 'left', reason: expect.any(String) }]);
  expect((await execution(h, run2Ref)).session).toMatchObject({ revision: ended.session.revision, healthConclusion: 'kernel_turn_open' });

  // H-01 with the Kernel back: the Kernel Session header shows its last Turn (Run 1's) ended (`activeRunId` null),
  // so SES-13 writes the Session available again (the LA-1 guard lets it through only then).
  await putKernelBack(h.database, aside);
  expect(h.kernelSnapshot().sessions.find(session => session.sessionId === kernelSessionId)).toMatchObject({ activeRunId: null });
  const back = await h.restart({ crash: true });
  expect(back.report).toMatchObject({ sessions: [{ ref: sessionLineRef(sessionRef), row: 'H-01', status: 'reconciled' }],
    runs: [], problems: [] });
  expect((await execution(h, run2Ref)).session).toMatchObject({ revision: ended.session.revision + 1, occupancy: null,
    health: 'available', healthConclusion: null });
  expect(h.modelCalls(), 'only Run 1 called the model').toBe(1);
  await expectQuietHarnessRestart(h, 'a8-2b Kernel back');
}, 180_000);

it('A8-2c (W-07, H-03, CI-10, then W-05 with RUN-09): under a host_config probe an Entering Run and its queued cancel are left as they are; the next start with the Kernel registered revokes the entry and ends the Run cancelled in the same commit', async () => {
  const h = await openHostScenario({ automation: redrivePolicy(false), script: { replies: [RUN1_WITHOUT_FILE] } });
  const { run2Ref, start, sessionRef } = await requeuedRunBeforeStart(h, 'a8-2c');
  const aside = await startWithKernelAside(h, start);
  const entering = await execution(h, run2Ref);
  const cancelled = await h.post<WriteResult<{ intent: ControlIntentSnapshotV1 }>>('controls/submit', graphWrite(AG2B_SCOPE,
    { runRef: run2Ref, kind: 'cancel', reason: 'restart scenario: stop the entering Run' }, 'a8-2c-cancel',
    [{ ref: run2Ref, revision: entering.run.revision }]));
  if (cancelled.status !== 'committed') throw new Error(`cancel: ${JSON.stringify(cancelled)}`);
  const cancelRef = cancelled.value.intent.ref;
  expect(cancelled.value.intent).toMatchObject({ status: 'queued' });
  await assertInvariants(h, 'a8-2c cancel queued', stepOf(h, 'other', 'a8-2c cancel queued'));
  await putKernelBack(h.database, aside);
  const queued = await execution(h, run2Ref);
  const queuedCancel = await readControl(h.host, cancelRef);
  const atCrash = h.counts();

  // The crash; the next Host has no Kernel Store registration: the probe is `host_config`, which proves nothing (SD-2).
  const report = await h.restart({ crash: true, noKernelStores: true });
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
    sessions: [{ ref: sessionLineRef(sessionRef), row: 'H-03', status: 'left' }],
    runs: [{ ref: JSON.stringify(run2Ref), row: 'W-07', status: 'left' }],
    queries: [], checks: [], controls: [], redriveGoals: [], problems: [] } });
  expect(h.counts(), 'W-07: nothing is written, no model call or Kernel Turn').toEqual(atCrash);
  // The Run is still Entering at the same revision; CI-10: the cancel stays queued.
  const left = await execution(h, run2Ref);
  expect(left).toEqual(queued);
  expect(left.run.executionAuthorization).toMatchObject({ phase: 'entering', generation: 1 });
  expect(await readControl(h.host, cancelRef)).toEqual(queuedCancel);

  // The next start with the Kernel registered: the probe is `ready` and no Turn exists (W-05); the queued cancel
  // makes RUN-16 + RUN-09 one commit (CTL-08(a)).
  const registered = await h.restart({ crash: true, noKernelStores: false });
  expect(registered.report).toMatchObject({ runs: [{ ref: JSON.stringify(run2Ref), row: 'W-05', status: 'reconciled',
    reason: 'not_entered' }], redriveGoals: [], problems: [] });
  const ended = await execution(h, run2Ref);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
  expect(await readControl(h.host, cancelRef)).toMatchObject({ status: 'applied', observation: { origin: 'platform_not_entered', kind: 'cancelled' } });
  expect(ended.attempt).toMatchObject({ status: 'ended', endOutcome: 'cancelled', startedAt: null });
  expect(ended.outbox).toMatchObject({ status: 'settled' });
  expect(ended.session).toMatchObject({ occupancy: null, health: 'available' });
  expect(h.modelCalls(), 'only Run 1 called the model').toBe(1);
  await expectQuietHarnessRestart(h, 'a8-2c');
}, 180_000);

it('A8-1b (W-02, I-19, LA-6, §12.1 step 6b (b)): a requeue Run authorized and never begun is re-driven by the start-up re-drive with no workflow/advance; the bound brief is rebuilt (rehydratePreparedExecution): the same digest after the source changed, the same permit', async () => {
  const h = await openHostScenario({ automation: redrivePolicy(true), script: { replies: [RUN1_WITHOUT_FILE, ...editThenText('a8-1b')] } });
  const { run2Ref, start } = await requeuedRunBeforeStart(h, 'a8-1b');
  // W-02: the Host has no seam between RUN-02 and RUN-04, so a composition root on the same files starts the prepared
  // Run and is cancelled right after the entry authorization commits (support/common.ts `authorizeWithoutBegin`).
  const authorized = await authorizeWithoutBegin(h, preparedOf(start), 'a8-1b-w02');
  expect(codeOf(authorized.answer), JSON.stringify(authorized.answer)).toBe('cancelled');
  expect(authorized.modelCalls).toBe(0);
  const bound = await execution(h, run2Ref);
  expect(bound.run).toMatchObject({ status: 'starting', startedAt: null,
    executionAuthorization: { schemaVersion: 2, phase: 'authorized', generation: 1 } });
  await assertInvariants(h, 'a8-1b authorized, not begun', stepOf(h, 'entry_authorized', 'a8-1b authorized, not begun'));
  const digest = bound.run.inputBinding?.continuationBriefDigest;
  expect(digest, 'RUN-02 bound the brief of the requeued Run').toEqual(expect.any(String));
  const brief = await requiredBriefOf(h.host, run2Ref);
  expect(brief.digest).toBe(digest);
  // The workspace source changes after RUN-02: a brief assembled again would capture another source, so the
  // equalities below show the re-drive rebuilt the bound value (I-19), not a new prepare.
  const sourceAtAuthorization = await sourceDigestOf(h.root);
  await writeFile(join(h.root, 'src', 'a8-1b-after-w02.txt'), 'A8-1b: changed after RUN-02, before the re-drive\n');
  expect(await sourceDigestOf(h.root)).not.toBe(sourceAtAuthorization);
  const authorizations = (): number => h.ledgerEventTypes().filter(type => type === 'ExecutionEntryAuthorized').length;
  expect(authorizations(), 'Run 1 and Run 2 each authorized once').toBe(2);
  expect(h.modelCalls()).toBe(1);

  // The crash. W-02 is not migrated; step 6b (b) selects the Goal and the re-drive continues the same claim.
  const report = await h.restart({ crash: true });
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [], queries: [], checks: [], controls: [],
    problems: [], redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [AG2B_WORK_TASK_ID] }] } });
  await waitFor(() => h.goalDisplay(), display => display.phase === 'COMPLETED', 'the start-up re-drive to complete the Goal');
  await assertInvariants(h, 'a8-1b re-driven');
  expect((await h.taskRow()).execution, 'the same Run, no new claim').toEqual(run2Ref);
  const done = await execution(h, run2Ref);
  // The same permit (no re-authorization, generation 1), envelope and input binding; the same Attempt.
  expect(done.run).toMatchObject({ status: 'ended', outcome: 'completed', executionAuthorization: { schemaVersion: 2, generation: 1 },
    envelope: bound.run.envelope, inputBinding: bound.run.inputBinding });
  expect(done.attempt.ref).toEqual(bound.attempt.ref);
  expect(authorizations(), 'the begin reused the persisted permit').toBe(2);
  expect(await requiredBriefOf(h.host, run2Ref), 'I-19: the brief RUN-02 bound is the one Run 2 ran with').toEqual(brief);
  expect(JSON.stringify(h.modelRequests()[1]?.messages ?? [])).toContain(continuationBriefMarker(digest!));
  expect(h.modelCalls(), 'Run 1, then Run 2 (edit and final text)').toBe(3);
  await expectQuietHarnessRestart(h, 'a8-1b');
}, 180_000);

it('A8-1a requeue variant (W-01, W-24, C3, LA-6): a requeue Run claimed and never prepared is re-prepared by the start-up re-drive; its brief is assembled then, from the workspace as it is at that prepare', async () => {
  const h = await openHostScenario({ automation: redrivePolicy(true), script: { replies: [RUN1_WITHOUT_FILE, ...editThenText('a8-1a-requeue')] } });
  // Run 1 FAILs; the automatic requeue (check_failed #1) is claimed in Run 1's Session; stop before Run 2's prepare.
  const toPrepare = await h.advance(h.select('a8-1a-requeue', AG2B_WORK_TASK_ID), { stopBefore: (input) => input.kind === 'perform'
    && input.operation.kind === 'prepare' && (h.lastWorld?.requeues.length ?? 0) === 1 });
  expect(toPrepare.state).toBe('stopped');
  const requeue = h.lastWorld?.requeues[0];
  const run2Ref = (await h.taskRow()).execution;
  if (requeue === undefined || run2Ref === null) throw new Error('Run 2 must claim the automatic requeue');
  const claimed = await execution(h, run2Ref);
  expect(claimed.run).toMatchObject({ status: 'starting', startedAt: null, requeueRef: requeue.ref });
  expect(claimed.run.executionAuthorization, 'W-01: claimed, not authorized').toBeUndefined();
  expect(claimed.run.inputBinding, 'nothing prepared is bound').toBeUndefined();
  // The workspace changes between the claim and the restart.
  const sourceAtClaim = await sourceDigestOf(h.root);
  await writeFile(join(h.root, 'src', 'a8-1a-after-claim.txt'), 'A8-1a: changed after the claim, before the restart\n');
  const sourceAtRestart = await sourceDigestOf(h.root);
  expect(sourceAtRestart).not.toBe(sourceAtClaim);
  expect(h.modelCalls()).toBe(1);

  // The crash: nothing is reconciled for a claimed Run (W-01); step 6b (b) selects the Goal; the re-drive re-prepares
  // the same claim (W-24: the brief is assembled again) and runs it, with no workflow/advance.
  const report = await h.restart({ crash: true });
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [], problems: [],
    redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [AG2B_WORK_TASK_ID] }] } });
  await waitFor(() => h.goalDisplay(), display => display.phase === 'COMPLETED', 'the start-up re-drive to complete the Goal');
  await assertInvariants(h, 'a8-1a requeue re-driven');
  expect((await h.taskRow()).execution, 'the same claim, no new Run').toEqual(run2Ref);
  const done = await execution(h, run2Ref);
  expect(done.run).toMatchObject({ status: 'ended', outcome: 'completed', requeueRef: requeue.ref,
    executionAuthorization: { schemaVersion: 2, generation: 1 } });
  expect(done.attempt.ref, 'the same Attempt').toEqual(claimed.attempt.ref);
  const { brief, digest } = await requiredBriefOf(h.host, run2Ref);
  expect(done.run.inputBinding?.continuationBriefDigest).toBe(digest);
  // 接续说明可变: the brief's own checkpoint is the workspace the re-drive's prepare read, after the change.
  expect(brief).toMatchObject({ runRef: run2Ref, requeueRef: requeue.ref, mode: 'rework', failureClass: 'check_failed' });
  expect(brief.workspace.checkpoints.at(-1)).toMatchObject({ kind: 'brief', sourceDigest: sourceAtRestart });
  expect(JSON.stringify(h.modelRequests()[1]?.messages ?? [])).toContain(continuationBriefMarker(digest));
  expect(h.modelCalls()).toBe(3);
  expect(h.lastWorld?.requeues, 'no further requeue').toHaveLength(1);
  await expectQuietHarnessRestart(h, 'a8-1a requeue');
}, 180_000);

it('A8-2d (W-08, W-11, RUN-19, ATT-31..34, LA-1): the begin committed and the Kernel Turn started, the entered fact was never booked; the restart classifies the Turn by the W-11 rule and records the entry facts in the same commit', async () => {
  const h = await openHostScenario({ automation: redrivePolicy(false), check: 'pass' });
  const toStart = await h.advance(h.select('a8-2d', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  const prepared = preparedOf(toStart.next);
  // The crash point (§12.10 step 1, 故障注入; the Host has no seam inside one Runtime call): a composition root on the
  // same files starts the prepared Run; right after the begin commits (RUN-04) the test takes the ledger's write lock,
  // so the Kernel starts the Turn and the `before_model` entered commit fails: the Runtime pauses the Turn there.
  const lock = lockLedgerAfter(h.database, 'ExecutionEntryBegun');
  const model = createScriptedModel([]);
  const root = await openWorkRoot(h, model, lock.observer);
  let started: unknown;
  try {
    started = await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'a8-2d-start' });
  } finally {
    lock.release();
    await root.close();
  }
  expect(lock.locked(), 'the lock was taken right after the begin').toBe(true);
  expect(started).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect(JSON.stringify(started)).toContain('database is locked');
  expect(model.calls(), 'the Turn stopped before its first model call').toBe(0);
  await assertInvariants(h, 'a8-2d begun, entry not booked', stepOf(h, 'entry_authorized', 'a8-2d begun, entry not booked'));
  const runRef = (await h.taskRow()).execution;
  if (runRef === null) throw new Error('the work Task must select its Run');
  const entering = await execution(h, runRef);
  expect(entering.run).toMatchObject({ status: 'starting', startedAt: null, executionAuthorization: { phase: 'entering', generation: 1 } });
  expect(entering.run.executionHistory, 'no entered fact').toBeUndefined();
  expect(entering.attempt).toMatchObject({ status: 'claimed', startedAt: null });
  expect(entering.outbox).toMatchObject({ status: 'pending' });
  const binding = entering.run.executionAuthorization;
  if (binding === undefined || !('schemaVersion' in binding) || binding.kernel === null) throw new Error('the begin must fix the Kernel identity');
  const kernelRunId = binding.kernel.runId;
  // W-08's facts: the Kernel Turn of the fixed identity exists, without a terminal, and holds the Kernel Session.
  const turn = kernelTurnOf(h.database, kernelRunId);
  if (turn === null) throw new Error('the Kernel Turn of the fixed identity must have started');
  expect(turn.eventTypes.filter(type => ['run.completed', 'run.failed', 'run.cancelled', 'run.yielded', 'run.limit_exceeded'].includes(type)),
    'no Kernel terminal').toEqual([]);
  expect(h.kernelSnapshot().sessions.find(session => session.sessionId === entering.session.kernel.kernelSessionId)?.activeRunId)
    .toBe(kernelRunId);
  const atCrash = h.counts();

  // The crash. W-08: classified as W-11 (no terminal, no tool in flight, the pointer is not paused): RUN-19, and the
  // entry facts are recorded in the same commit (startedAt = the Turn's start, ATT-31..34).
  const report = await h.restart({ crash: true });
  const hostInstanceId = report.hostInstanceId;
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: {
    runs: [{ ref: JSON.stringify(runRef), row: 'W-11', status: 'reconciled', reason: 'interrupted_clean' }],
    queries: [], checks: [], controls: [], problems: [],
    // §12.1 step 6b (a): the interrupted Task's verdict is requeue, so the Goal is selected (the re-drive is off here).
    redriveGoals: [{ goalRef: { goalId: AG2B_GOAL_REF.goalId }, taskIds: [AG2B_WORK_TASK_ID] }] } });
  // K (KA1, L2 row 7): the start-up maintenance appends exactly one Kernel record, the run.interrupted that closes the Turn.
  expect(h.counts(), 'no model request, Kernel Turn or check process during the reconcile').toMatchObject({
    modelCalls: atCrash.modelCalls, kernelTurnsStarted: atCrash.kernelTurnsStarted, checksBegun: atCrash.checksBegun,
    kernelRecords: atCrash.kernelRecords + 1 });
  const ended = await execution(h, runRef);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed', startedAt: turn.recordedAt,
    executionAuthorization: { phase: 'settled' }, executionHistory: { startPosition: turn.position },
    terminalPayload: { kind: 'crashed' },
    reconciliation: { status: 'done', basis: { kind: 'host_instance_takeover', hostInstanceId },
      observation: { kind: 'interrupted_clean', pausedIntentRef: null } } });
  expect(ended.attempt).toMatchObject({ status: 'ended', endOutcome: 'crashed', startedAt: turn.recordedAt });
  expect(ended.outbox).toMatchObject({ status: 'settled' });
  // LA-1: at the restart the Turn had no Kernel terminal, so the Session was released and retired; K (KA1, L5): the start-up
  // maintenance then closed the open Turn and SES-13 made the Session available again, not archived.
  expect(ended.session).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'available', healthConclusion: null });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed', failure: { failureClass: 'interrupted',
    interruption: { kind: 'executing' } } });
  await expectQuietHarnessRestart(h, 'a8-2d');
}, 180_000);
