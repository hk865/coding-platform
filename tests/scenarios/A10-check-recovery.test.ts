/**
 * A.2 step 6, scenario A10 (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" A10 row; §12.4 C-01..C-06,
 * §12.1 step 4, "gate 检查中断"; §9 VR-04, VR-07, VR-14; §13.7; C5, GAP-24, LA-6): a check without a
 * complete result never completes its Task, and a check a Host restart interrupted is never run again in
 * its round; the Workflow finalizes the round INCONCLUSIVE and opens an exempt successor round.
 *
 * - A10-R1: two PASS and one check without a result (timed out) → INCONCLUSIVE, the Task is not completed
 *   (platform mode: the Host registers one check, this needs three).
 * - A10-R1..R4 (C-01, C-04): a check left executing by a crashed Host is interrupted `host_restart` and not
 *   run again (moved case); the projections P9 → P8 → P12 along the C-04 path (A10-R5 variant below).
 * - A10-R2 (C-02 under GAP-24): the check process ended and its report body is stored, but the result
 *   was never booked (the ledger was locked past the runner's retries, the VD-10 stall): the restart still
 *   interrupts it (VR-04; VR-06 is deleted) without reading that report.
 * - A10-R5: work check interrupted → restart → finalize INCONCLUSIVE → exempt automatic reverify → the
 *   successor round PASSes → satisfied, no model call after Run 1; the C-06 variant crashes again during
 *   the successor round's check and gets one more exempt round.
 * - A10-R6: the gate's check interrupted → reverify on the anchored producer Run → PASS → Goal COMPLETED.
 *
 * The crash points of a chosen round come from `HOLDABLE_CHECK` (tests/scenarios/support/restart.ts):
 * the check sleeps while a marker file is in the round's workspace. Every step that changes records is
 * followed by the §11 invariant check; every case with a restart ends with another start on the same data
 * that changes and writes nothing (§12.10 step 4; A10-R1 runs in platform mode and has no restart).
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import { AG2B_GATE_TASK_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, ag2bChecksConfiguration, plain, seedAG2bWorkGraph, startAG2bHost } from '../helpers/AG2b-collaboration-fixture.js';
import {
  post, publicDirectory, selectWork, tempDir, workRow, writeAutomationSettings, writeStaleLock,
} from '../helpers/A2-restart-fixture.js';
import {
  assertInvariants, assertInvariantsAt, checkRevisionOf, cleanupScenarios, fileCounts, openHostScenario, openPlatformScenario, performs,
  SCENARIO_OPERATOR, waitFor, type HostScenario, type InvariantTarget,
} from './harness.js';
import { driveChecked, editThenText } from './support/common.js';
import {
  artifactsMentioning, checksHeld, expectQuietHarnessRestart, HOLDABLE_CHECK, holdChecks, ledgerEvents, releaseHeldCheck, reportChanges,
} from './support/restart.js';

// Draining an abandoned Host waits for its sleeping check process (at most 20 s when a test failed before releasing it).
afterEach(cleanupScenarios, 60_000);

const OFF = { schemaVersion: 1 as const, autoReworkLimit: 3, resumeOnStartup: 'off' } as const;
const ON = { schemaVersion: 1 as const, autoReworkLimit: 3, resumeOnStartup: 'auto' } as const;

/** The rounds of `taskId` in chain order (ordinal 1 first), from the last invariant read. */
function chainOf(h: HostScenario, taskId: string): RoundSnapshot[] {
  return (h.lastWorld?.rounds ?? []).filter(round => round.subject.taskId === taskId)
    .sort((left, right) => (left.chain?.ordinal ?? 1) - (right.chain?.ordinal ?? 1));
}

/**
 * Drives `input` to the next `run_check` (the marker of `HOLDABLE_CHECK` already in the workspace) and
 * sends it without waiting, then waits until the check is begun (`executing`, VerificationCheckBegun)
 * and its process took the marker (it sleeps now): a crash from here is C-01. Answers the in-flight
 * request (wrapped, so awaiting this helper does not wait for the check to end).
 */
async function checkInFlight(h: HostScenario, input: Parameters<HostScenario['advance']>[0]): Promise<{ inFlight: Promise<unknown> }> {
  expect(checksHeld(h.root), 'the marker is in place before the round opens').toBe(true);
  const toCheck = await h.advance(input, { stopBefore: performs('run_check') });
  if (toCheck.state !== 'stopped' || toCheck.next === null) throw new Error(`no run_check was reached: ${JSON.stringify(toCheck.reason)}`);
  const begun = h.counts().checksBegun;
  const inFlight = h.post('workflow/advance', plain(AG2B_SCOPE, toCheck.next)).catch(() => undefined);
  await waitFor(async () => h.counts().checksBegun, count => count > begun, 'the check to begin');
  await waitFor(async () => checksHeld(h.root), held => !held, 'the check process to take the marker');
  return { inFlight };
}

it('A10-R1: two checks PASS and one has no result (it timed out): the round is INCONCLUSIVE and the Task is not completed', async () => {
  const h = await openPlatformScenario({ script: { replies: editThenText('a10-r1') } });
  // Three registered checks over the same requirement: two pass, the third sleeps past its timeout.
  const base = ag2bChecksConfiguration({ actor: SCENARIO_OPERATOR, revision: checkRevisionOf(2) });
  const check = base.checks[0]!;
  h.platform.registerCheckConfiguration({ configuration: { ...base, checks: [
    { ...check, checkId: 'a10-pass-1', command: 'node -e "process.exit(0)"' },
    { ...check, checkId: 'a10-pass-2', command: 'node -e "process.exit(0)"' },
    { ...check, checkId: 'a10-missing', command: 'sleep 5', timeoutMs: 1_000 }] } });
  const driven = await h.advance(h.select('a10-r1', AG2B_WORK_TASK_ID), { stopBefore: performs('reverify_round') });
  expect(driven.receipts.map(receipt => receipt.kind)).not.toContain('complete_task');
  const [round] = (h.lastWorld?.rounds ?? []).filter(candidate => candidate.subject.taskId === AG2B_WORK_TASK_ID);
  expect(round).toMatchObject({ status: 'finalized', outcome: 'INCONCLUSIVE' });
  expect(Object.fromEntries((round?.checks ?? []).map(item => [item.checkId, item.outcome])))
    .toEqual({ 'a10-pass-1': 'PASS', 'a10-pass-2': 'PASS', 'a10-missing': 'INCONCLUSIVE' });
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'round_inconclusive' } });
  expect(await h.goalDisplay()).not.toMatchObject({ phase: 'COMPLETED' });
}, 120_000);

// Moved from tests/app/A2-host-reconcile.test.ts:413 (05125db): A10-R1..R4 (C-01, VR-04: interrupted, never run again).
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
  const inv: InvariantTarget = { database };   // A.2 step 6
  try {
    await seedAG2bWorkGraph(first);
    // A.2 step 6: the steps before the check are checked one by one (§11 invariants with each receipt's step).
    const runCheck = (await driveChecked(first, inv, selectWork('a2-check'), { stopBefore: 'run_check' })).next;
    if (runCheck === null) throw new Error('the Workflow must reach run_check');
    inFlight = post(first, 'workflow/advance', plain(AG2B_SCOPE, runCheck)).catch(() => undefined);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const row = await workRow(first);
      if ((row['phaseCause'] as { code?: string } | undefined)?.code === 'verification_running') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    // A.2 step 6: `verification_running` is already the open round with its check pending; wait for the begin
    // itself (the check `executing`), or a loaded machine crashes the Host before it (seen once in slot s1).
    await waitFor(async () => ledgerEvents(database, 'VerificationCheckBegun'), begun => begun > 0, 'the check to begin');
    await writeStaleLock(database);
  } catch (error) {
    await inFlight;
    await first.host.close();
    throw error;
  }
  // The subject is the reconcile itself: since 5.9 the interrupted round's Task has the verdict reverify
  // (FC-13, needsFinalize), which the start-up re-drive would act on at once, so the re-drive is off here.
  await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'off' });
  const begunBefore = ledgerEvents(database, 'VerificationCheckBegun');   // A.2 step 6
  const second = await startAG2bHost(publicDir, { root, database, checkCommand });
  try {
    // A.2 step 6: §12.10 step 4, no check process and no model call during the reconcile.
    expect(ledgerEvents(database, 'VerificationCheckBegun'), 'the reconcile starts no check').toBe(begunBefore);
    expect(second.scripted.calls(), 'the reconcile calls no model').toBe(0);
    const report = second.host.reconcile.report;
    expect(report?.checks).toEqual([expect.objectContaining({ row: 'C-01', status: 'reconciled', reason: 'interrupted (host_restart)' })]);
    expect(report?.problems).toEqual([]);
    // §12.1 step 6b condition (a), 5.9: the Goal with the reverify verdict is selected for the re-drive.
    expect(report?.redriveGoals).toEqual([expect.objectContaining({ goalRef: expect.objectContaining({ goalId: 'ag2b-goal' }),
      taskIds: ['ag2b-work'] })]);
    await assertInvariantsAt(inv, 'C-01 reconciled');   // A.2 step 6
  } finally {
    await inFlight;
    await first.host.close();
  }
  try {
    // The crashed Host's late check result is refused by the interrupted check; the Task waits on the interruption
    // (§12 C-04: never re-run within the round).
    expect(await workRow(second)).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'check_interrupted' } });
    await assertInvariantsAt(inv, 'C-01 late result refused');   // A.2 step 6
    // A further start finds nothing executing.
    await second.host.close();
    const quiet = fileCounts(database);   // A.2 step 6
    const third = await startAG2bHost(publicDir, { root, database, checkCommand });
    try {
      expect(third.host.reconcile).toMatchObject({ report: { checks: [], runs: [], problems: [] } });
      // A.2 step 6: §12.10 step 4, it changes and writes nothing and calls no model.
      expect(reportChanges(third.host.reconcile.report)).toEqual([]);
      expect(fileCounts(database)).toEqual(quiet);
      expect(third.scripted.calls()).toBe(0);
    } finally {
      await third.host.close();
    }
  } finally {
    await second.host.close();
  }
}, 180_000);

it('A10-R5, A10-R4 (C-01, C-04, VR-07, VR-14, §13.7, LA-6): a work check interrupted by a crash is finalized INCONCLUSIVE after the restart and re-verified automatically without counting; the successor round PASSes with no model call after Run 1', async () => {
  const h = await openHostScenario({ check: { command: HOLDABLE_CHECK }, automation: ON, script: { replies: editThenText('a10-r5') } });
  await holdChecks(h.root);
  const { inFlight } = await checkInFlight(h, h.select('a10-r5', AG2B_WORK_TASK_ID));
  const afterRun1 = h.modelCalls();
  expect(afterRun1).toBe(2);

  // The crash during the check; the start-up re-drive (on) finalizes, re-verifies and completes the Goal.
  const report = await h.restart({ crash: true });
  await releaseHeldCheck(h.root);
  expect(report.report).toMatchObject({ checks: [expect.objectContaining({ row: 'C-01', status: 'reconciled',
    reason: 'interrupted (host_restart)' })], runs: [], problems: [],
  redriveGoals: [expect.objectContaining({ taskIds: [AG2B_WORK_TASK_ID] })] });
  await waitFor(() => h.goalDisplay(), display => display.phase === 'COMPLETED', 'the start-up re-drive to complete the Goal');
  await assertInvariants(h, 'a10-r5 completed');
  const [root, successor] = chainOf(h, AG2B_WORK_TASK_ID);
  // C-01: the interrupted check is never run again in its round; finalize counts it as a gap (INCONCLUSIVE).
  expect(root).toMatchObject({ status: 'finalized', outcome: 'INCONCLUSIVE',
    checks: [{ phase: 'interrupted', incompleteCause: 'host_restart', reportRef: null }] });
  expect(root?.gaps.map(gap => gap.code)).toEqual(['interrupted_check']);
  // VR-14 exempt successor (§13.7 point 3): no key comparison, not counted, the predecessor linked.
  expect(successor).toMatchObject({ status: 'finalized', outcome: 'PASS', chain: { ordinal: 2, predecessorRoundRef: root?.ref,
    autoCount: 0, reverify: { failureClass: 'check_incomplete', exemption: 'host_interruption' } } });
  expect(chainOf(h, AG2B_WORK_TASK_ID)).toHaveLength(2);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'satisfied' });
  expect(h.modelCalls(), 'no model call after Run 1').toBe(afterRun1);
  await h.drainAbandoned();
  await inFlight;
  await expectQuietHarnessRestart(h, 'a10-r5');
}, 180_000);

it('A10-R5, C-06, A10-R4: the successor round\'s check is interrupted by a second crash; the projections follow C-04, and one more exempt round PASSes', async () => {
  const h = await openHostScenario({ check: { command: HOLDABLE_CHECK }, automation: OFF, script: { replies: editThenText('a10-c06') } });
  await holdChecks(h.root);
  const { inFlight: firstCheck } = await checkInFlight(h, h.select('a10-c06', AG2B_WORK_TASK_ID));
  const afterRun1 = h.modelCalls();

  // Crash 1 (re-drive off): C-01, then the C-04 projections on the 推进 path.
  const report = await h.restart({ crash: true });
  await releaseHeldCheck(h.root);
  expect(report.report?.checks).toEqual([expect.objectContaining({ row: 'C-01', status: 'reconciled' })]);
  expect(h.counts().checksBegun, 'the reconcile starts no check').toBe(1);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'check_interrupted' },
    failure: { automation: { verdict: { kind: 'reverify', needsFinalize: true } } } });
  const finalized = await h.advance(h.select('a10-c06-finalize', AG2B_WORK_TASK_ID), { stopBefore: performs('reverify_round') });
  expect(finalized.receipts.map(receipt => receipt.kind)).toEqual(['finalize_checks']);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'round_inconclusive' },
    failure: { failureClass: 'check_incomplete', automation: { verdict: { kind: 'reverify', needsFinalize: false } } } });
  // The exempt reverify opens round 2 with the marker back in place: its check sleeps; crash 2 during it (C-06).
  await holdChecks(h.root);
  const { inFlight: secondCheck } = await checkInFlight(h, finalized.next!);
  expect(await h.taskRow()).toMatchObject({ effectivePhase: 'verifying', phaseCause: { code: 'verification_running' } });
  const again = await h.restart({ crash: true, automation: ON });
  await releaseHeldCheck(h.root);
  expect(again.report?.checks).toEqual([expect.objectContaining({ row: 'C-01', status: 'reconciled', reason: 'interrupted (host_restart)' })]);
  await waitFor(() => h.goalDisplay(), display => display.phase === 'COMPLETED', 'the start-up re-drive to complete the Goal');
  await assertInvariants(h, 'a10-c06 completed');
  const chain = chainOf(h, AG2B_WORK_TASK_ID);
  expect(chain).toHaveLength(3);
  expect(chain[1]).toMatchObject({ outcome: 'INCONCLUSIVE', checks: [{ phase: 'interrupted', incompleteCause: 'host_restart' }],
    chain: { ordinal: 2, autoCount: 0, reverify: { exemption: 'host_interruption' } } });
  // C-06: every non-PASS item of round 2 is a host_restart interruption, so round 3 is exempt again (n+1, uncounted).
  expect(chain[2]).toMatchObject({ outcome: 'PASS', chain: { ordinal: 3, predecessorRoundRef: chain[1]?.ref, autoCount: 0,
    reverify: { exemption: 'host_interruption' } } });
  expect(h.modelCalls(), 'no model call after Run 1').toBe(afterRun1);
  await h.drainAbandoned();
  await firstCheck;
  await secondCheck;
  await expectQuietHarnessRestart(h, 'a10-c06');
}, 240_000);

it('A10-R6 (C-01, GV-3, GV-10, P20, TASK-15, TASK-30): the gate\'s check interrupted by a crash is re-verified on the anchored producer Run after the restart; PASS completes the Goal', async () => {
  const h = await openHostScenario({ check: { command: HOLDABLE_CHECK }, automation: ON, script: { replies: editThenText('a10-r6') } });
  // The work Task passes (no marker); its Run is the gate's producer.
  expect((await h.advance(h.select('a10-r6-work', AG2B_WORK_TASK_ID))).state).toBe('completed');
  const producer = (await h.taskRow()).execution;
  // The gate round opens with the marker: its check sleeps; the crash comes during it.
  await holdChecks(h.root);
  const { inFlight } = await checkInFlight(h, h.select('a10-r6-gate'));
  const afterRun1 = h.modelCalls();
  const report = await h.restart({ crash: true });
  await releaseHeldCheck(h.root);
  expect(report.report).toMatchObject({ checks: [expect.objectContaining({ row: 'C-01', status: 'reconciled' })],
    redriveGoals: [expect.objectContaining({ taskIds: [AG2B_GATE_TASK_ID] })] });
  await waitFor(() => h.goalDisplay(), display => display.phase === 'COMPLETED', 'the start-up re-drive to complete the Goal');
  await assertInvariants(h, 'a10-r6 completed');
  const [root, successor] = chainOf(h, AG2B_GATE_TASK_ID);
  expect(root).toMatchObject({ outcome: 'INCONCLUSIVE', subjectRunRef: producer, checks: [{ phase: 'interrupted', incompleteCause: 'host_restart' }] });
  expect(successor).toMatchObject({ outcome: 'PASS', subjectRunRef: producer,
    chain: { ordinal: 2, predecessorRoundRef: root?.ref, autoCount: 0, reverify: { exemption: 'host_interruption' } } });
  expect(await h.taskRow(AG2B_GATE_TASK_ID)).toMatchObject({ effectivePhase: 'satisfied' });
  expect(h.modelCalls()).toBe(afterRun1);
  await h.drainAbandoned();
  await inFlight;
  await expectQuietHarnessRestart(h, 'a10-r6');
}, 180_000);

it('A10-R2 (C-02 under GAP-24, VD-10): a check whose process ended with its report stored but whose result was never booked stays executing until the restart, which interrupts it without reading the report', async () => {
  const h = await openHostScenario({ check: { command: HOLDABLE_CHECK }, automation: ON, script: { replies: editThenText('a10-r2') } });
  await holdChecks(h.root);
  const { inFlight } = await checkInFlight(h, h.select('a10-r2', AG2B_WORK_TASK_ID));
  // The ledger stays locked past the check's end and the runner's bounded retries (VD-10): the report body is stored
  // in the artifact store, the result is never booked, and the check stays `executing` on the live Host.
  const ledger = new DatabaseSync(join(h.database, 'ledger.sqlite'));
  try {
    ledger.exec('BEGIN IMMEDIATE');
    await releaseHeldCheck(h.root);
    await inFlight;
  } finally {
    if (ledger.isTransaction) ledger.exec('ROLLBACK');
    ledger.close();
  }
  await assertInvariants(h, 'a10-r2 stalled');
  const [stalled] = chainOf(h, AG2B_WORK_TASK_ID);
  const invocationId = stalled?.checks[0]?.invocationId;
  expect(stalled).toMatchObject({ status: 'open', checks: [{ phase: 'executing', reportRef: null }] });
  expect(invocationId).toEqual(expect.any(String));
  expect(artifactsMentioning(h.database, `r3e-check-result-${String(invocationId)}`), 'the report body was stored').toBeGreaterThan(0);

  // The restart: C-02's facts, but VR-06 is deleted (GAP-24): VR-04 interrupts the check and the report is not booked.
  const report = await h.restart({ staleLock: true });
  expect(report.report?.checks).toEqual([expect.objectContaining({ row: 'C-01', status: 'reconciled', reason: 'interrupted (host_restart)' })]);
  await waitFor(() => h.goalDisplay(), display => display.phase === 'COMPLETED', 'the start-up re-drive to complete the Goal');
  await assertInvariants(h, 'a10-r2 completed');
  const [root, successor] = chainOf(h, AG2B_WORK_TASK_ID);
  expect(root).toMatchObject({ outcome: 'INCONCLUSIVE', checks: [{ phase: 'interrupted', incompleteCause: 'host_restart',
    invocationId, reportRef: null, outcome: null }] });
  expect(successor).toMatchObject({ outcome: 'PASS', chain: { ordinal: 2, autoCount: 0, reverify: { exemption: 'host_interruption' } } });
  await expectQuietHarnessRestart(h, 'a10-r2');
}, 180_000);
