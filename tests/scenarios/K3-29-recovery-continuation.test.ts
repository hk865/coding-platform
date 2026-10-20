/**
 * K3-29 rows 6, 7, 10, 11 and 12 (L12, L15, L22, L29; D9): restart recovery
 * after a review disposition, over the real Host and a real review root.
 *
 * - Row 6: the record is `resolved` + `held` and then released; no TaskRequeue
 *   exists yet. The next advance performs the automatic requeue (no
 *   confirmation card), then claims the continuation in the nearest holder's
 *   Session.
 * - Row 7: the continuation is claimed and runs as an ordinary work Run.
 * - Row 10: a direct "I'll handle it" (or the card, not built in group A) is
 *   `resolved` + `held`; a restart changes nothing and the Task stays stopped.
 * - Row 11: the same direct-hold request replays the original receipt and
 *   writes nothing.
 * - Row 12: a direct hold while the review round is claimed but not entered;
 *   UR3h cancels the round and the next advance settles only that round. A
 *   crash after the cancel commit is handed off by 6b (c) kind 2 and then
 *   settled.
 *
 * The chain is the K3-05/K3-44 one: a `shell` call in flight is closed by
 * RUN-25, leaving a `process` item `pending_review`. Scripted model only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { crashOneCommand } from './support/review-card-round.js';
import { expectQuietHarnessRestart } from './support/restart.js';
import { createScriptedModel, type ScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
});

const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg),
  };
});
seams.shellSeam = shellSeam;

// The Kernel closure switch (K3-27's unsupported fallback): `unsupported`
// drops `closeOpenTurn`, the review claim's definite close failure.
const kernelClosure = vi.hoisted(() => ({ mode: 'normal' as 'normal' | 'unsupported' }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.defineProperty({ ...actual }, 'closeOpenTurn', { enumerable: true, get: () => {
    if (kernelClosure.mode === 'unsupported') return undefined;
    return actual['closeOpenTurn'];
  } });
});

afterEach(async () => {
  for (const release of crashHandles.splice(0)) await release();
  kernelClosure.mode = 'normal';
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

/**
 * K3-05's A half: a `shell` call in flight is closed by RUN-25, leaving the
 * record `pending_review`. The blocked call stays alive until after the test's
 * flow (the K3-27 fixture shape): releasing it straight after the "crash"
 * finishes the reviewed Run's Turn inside the still-live in-process root, a
 * state a real crash cannot create. `afterEach` releases every handle.
 */
const crashHandles: Array<() => Promise<void>> = [];

async function readyReview(h: HostScenario, runRef: RunRef): Promise<UnknownCallReviewV1> {
  const created = await reviewOf(h, runRef);
  expect(created.status).toBe('ready');
  if (created.status !== 'ready') throw new Error('the review record must read');
  return created.value;
}

/** A direct "I'll handle it" through the public route. */
async function holdDirectly(h: HostScenario, review: UnknownCallReviewV1, requestId: string):
Promise<WriteResult<UnknownCallReviewV1>> {
  return await h.post<WriteResult<UnknownCallReviewV1>>('unknown-call-reviews/hold', graphWrite(AG2B_SCOPE,
    { reviewRef: review.ref, text: null }, requestId, [{ ref: review.ref, revision: review.revision }]));
}

describe('K3-29 rows 6/7: a released hold, the automatic requeue and the continuation', () => {
  it('K3-29 row 6: after the hold is released the record is resolved/released with no TaskRequeue; the next advance requeues without a confirmation card and claims in the nearest holder Session', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: `k3-29r6-shell`, select: `k3-29r6-a`,
      requestId: `k3-29r6-a-start`, shellArgs: { command: `k3-29r6 runs a program` } });
    crashHandles.push(crashed.release);
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    const preparedA = crashed.prepared;
    const created = await readyReview(h, preparedA.claim.runRef);

    const held = await holdDirectly(h, created, 'k3-29r6-hold');
    expect(held).toMatchObject({ status: 'committed', value: { status: 'resolved',
      disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } } });
    if (held.status !== 'committed') return;

    const released = await h.post<WriteResult<{ hold: WriteResult<UnknownCallReviewV1>; requeue: unknown }>>(
      'unknown-call-reviews/release-hold', graphWrite(AG2B_SCOPE, { reviewRef: created.ref },
        'k3-29r6-release', [{ ref: created.ref, revision: held.value.revision }]));
    expect(released).toMatchObject({ status: 'committed', value: { requeue: null,
      hold: { status: 'committed', replayed: false, value: { status: 'resolved', activeRound: null,
        disposition: { choice: 'handle_myself', hold: 'released' } } } } });
    // Row 6's crash state: the disposition is applied, the continuation is not claimed.
    expect(await h.taskRow()).toMatchObject({ execution: { runId: preparedA.claim.runRef.runId } });
    expect(h.ledgerEventTypes().filter(type => type === 'TaskRequeued')).toEqual([]);

    const driven = await h.advance(h.select('k3-29r6-continue', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    const kinds = driven.receipts.map(receipt => receipt.kind);
    expect(kinds).toContain('requeue_task');
    expect(kinds).toContain('claim_task');
    // No plain system-requeue confirmation card: the review disposition confirmed it.
    expect(driven.steps.some(step => (step.reason ?? '').startsWith('automation_confirmation_required'))).toBe(false);
    const claim = driven.steps.flatMap(step => step.next !== null && step.next.kind === 'perform'
      && step.next.operation.kind === 'claim_task'
      ? [step.next.operation.request.input as { review?: unknown; sessionRef?: { sessionId: string } }] : []);
    expect(claim).toHaveLength(1);
    expect(claim[0]?.review).toBeUndefined();
    // L12/L27: the nearest holder is the original Run; its Session is already
    // available (the RUN-25 dangling Turn is closed once the record no longer
    // owes a review claim), so the continuation claims there — no fallback.
    expect(claim[0]?.sessionRef?.sessionId).toBe(preparedA.claim.sessionRef.sessionId);
    expect(h.ledgerEventTypes().filter(type => type === 'TaskRequeued')).toEqual(['TaskRequeued']);
    await expectQuietHarnessRestart(h, 'K3-29 row 6: a final restart');
  }, 300_000);

  it('K3-29 row 7: the claimed continuation is an ordinary Run; it ends and exactly one continuation exists', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass',
      script: { replies: [{ kind: 'text', text: 'K3-29 row 7: the continuation ran' }] } });
    const crashed = await crashOneCommand(h, { callId: `k3-29r7-shell`, select: `k3-29r7-a`,
      requestId: `k3-29r7-a-start`, shellArgs: { command: `k3-29r7 runs a program` } });
    crashHandles.push(crashed.release);
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    const preparedA = crashed.prepared;
    const created = await readyReview(h, preparedA.claim.runRef);
    const held = await holdDirectly(h, created, 'k3-29r7-hold');
    if (held.status !== 'committed') return;
    const released = await h.post<WriteResult<{ hold: WriteResult<UnknownCallReviewV1>; requeue: unknown }>>(
      'unknown-call-reviews/release-hold', graphWrite(AG2B_SCOPE, { reviewRef: created.ref },
        'k3-29r7-release', [{ ref: created.ref, revision: held.value.revision }]));
    expect(released.status).toBe('committed');

    const driven = await h.advance(h.select('k3-29r7-continue', AG2B_WORK_TASK_ID));
    expect(driven.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining(['requeue_task', 'claim_task', 'start']));
    const row = await h.taskRow();
    expect(row.execution).not.toBeNull();
    expect(row.execution?.runId).not.toBe(preparedA.claim.runRef.runId);
    const continuation = await readExecution(h.host, row.execution!);
    expect(continuation.run).toMatchObject({ status: 'ended' });
    expect(continuation.run.purpose?.kind).not.toBe('unknown_call_review');

    await expectQuietHarnessRestart(h, 'K3-29 row 7: a final restart');
  }, 300_000);
});

describe('K3-29 rows 10/11: a direct hold', () => {
  it('K3-29 row 10: a direct hold is resolved/held; a restart changes nothing and the Task stays stopped (AV-4c)', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: `k3-29r10-shell`, select: `k3-29r10-a`,
      requestId: `k3-29r10-a-start`, shellArgs: { command: `k3-29r10 runs a program` } });
    crashHandles.push(crashed.release);
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    const preparedA = crashed.prepared;
    const created = await readyReview(h, preparedA.claim.runRef);
    const held = await holdDirectly(h, created, 'k3-29r10-hold');
    expect(held).toMatchObject({ status: 'committed', value: { status: 'resolved', activeRound: null,
      disposition: { choice: 'handle_myself', source: 'direct', hold: 'held', answerMessageRef: null } } });
    if (held.status !== 'committed') return;
    expect(h.ledgerEventTypes().filter(type => type === 'TaskRequeued')).toEqual([]);
    const before = await h.taskRow();

    // A restart (crash) does not change the held record or the stopped Task.
    const report = await h.restart({ crash: true });
    expect(report.report?.redriveGoals ?? []).toEqual([]);
    const after = await reviewOf(h, preparedA.claim.runRef);
    expect(after).toEqual({ status: 'ready', value: held.value });
    expect(await h.taskRow()).toMatchObject({ execution: before.execution, effectivePhase: before.effectivePhase });

    const again = await h.advance(h.select('k3-29r10-again', AG2B_WORK_TASK_ID));
    const claims = again.steps.flatMap(step => step.next !== null && step.next.kind === 'perform'
      && step.next.operation.kind === 'claim_task' ? [step.next.operation.request.input] : []);
    expect(claims).toEqual([]);
    expect(again.steps.some(step => step.next === null && (step.reason ?? '').startsWith('unknown_call_review'))).toBe(true);
    await expectQuietHarnessRestart(h, 'K3-29 row 10: a final restart');
  }, 300_000);

  it('K3-29 row 11: the same direct-hold request replays the original receipt and writes nothing', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: `k3-29r11-shell`, select: `k3-29r11-a`,
      requestId: `k3-29r11-a-start`, shellArgs: { command: `k3-29r11 runs a program` } });
    crashHandles.push(crashed.release);
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    const preparedA = crashed.prepared;
    const created = await readyReview(h, preparedA.claim.runRef);
    const held = await holdDirectly(h, created, 'k3-29r11-hold');
    expect(held).toMatchObject({ status: 'committed', replayed: false, value: { disposition: { source: 'direct', hold: 'held' } } });
    const counts = h.counts();
    const replay = await holdDirectly(h, created, 'k3-29r11-hold');
    expect(replay).toEqual({ ...held, replayed: true });
    expect(h.counts()).toEqual(counts);
    expect(await reviewOf(h, preparedA.claim.runRef)).toMatchObject({ status: 'ready', value: { disposition: { source: 'direct' } } });
    // The held line no longer owes a review claim, so the next start's
    // maintenance closes the RUN-25 dangling Turn (L27, one write); the start
    // after that writes nothing.
    await h.restart({ crash: true });
    await expectQuietHarnessRestart(h, 'K3-29 row 11: a final restart');
  }, 300_000);
});

describe('K3-29 row 12: a direct hold while the review round is claimed but not entered', () => {
  it('K3-29 row 12: UR3h cancels the unentered round, the crash after the cancel commit is handed off by 6b (c) kind 2, and the next advance only settles the round', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: `k3-29r12-shell`, select: `k3-29r12-a`,
      requestId: `k3-29r12-a-start`, shellArgs: { command: `k3-29r12 runs a program` } });
    crashHandles.push(crashed.release);
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    const preparedA = crashed.prepared;
    const created = await readyReview(h, preparedA.claim.runRef);
    const reviewRoot = await openReviewWorkRoot(h, createScriptedModel([{ kind: 'text', text: 'never entered' }]));
    let roundRun: RunRef | null = null;
    try {
      // Claim and prepare the review round, then stop before `start` (claimed, not entered).
      const startStop = await driveReviewUntil(reviewRoot, h.select('k3-29r12-claim', AG2B_WORK_TASK_ID),
        performs('start'));
      // The RUN-25 Turn is still dangling (the fixture no longer releases the
      // blocked call), so the claim closes it and claims in the original Session.
      expect(startStop.receipts.map(receipt => receipt.kind)).toEqual([
        'close_open_turn', 'claim_task', 'prepare']);
      const prepared = preparedOf(startStop.stopped);
      expect(prepared.claim.sessionRef.sessionId).toBe(preparedA.claim.sessionRef.sessionId);
      roundRun = prepared.claim.runRef;
      const withRound = await readyReview(h, preparedA.claim.runRef);
      expect(withRound.activeRound).toMatchObject({ runRef: roundRun, round: 1 });

      const held = await holdDirectly(h, withRound, 'k3-29r12-hold');
      expect(held).toMatchObject({ status: 'committed', value: { status: 'resolved', activeRound: { runRef: roundRun },
        disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } } });
      if (held.status !== 'committed') return;

      // UR3h cancels the unentered round; stop before the settle.
      const cancelled = await h.advance(h.select('k3-29r12-cancel', AG2B_WORK_TASK_ID),
        { stopBefore: performs('settle_review') });
      expect(cancelled.receipts.map(receipt => receipt.kind)).toContain('cancel_review_round');
      const afterCancel = await readExecution(h.host, roundRun);
      expect(afterCancel.run).toMatchObject({ status: 'ended', outcome: 'cancelled' });

      // Crash between the cancel commit and the settle.
      const report = await h.restart({ crash: true });
      expect(report.report?.reviews.find(line => line.ref === JSON.stringify(created.ref)))
        .toEqual({ ref: JSON.stringify(created.ref), row: 'UCR', status: 'left', reason: 'resolved active_round' });
      expect(report.report?.redriveGoals).toEqual([{ goalRef: AG2B_GOAL_REF, scope: { ...AG2B_SCOPE },
        taskIds: [AG2B_WORK_TASK_ID] }]);

      const settled = await h.advance(h.select('k3-29r12-settle', AG2B_WORK_TASK_ID),
        { stopBefore: performs('requeue_task') });
      expect(settled.receipts.map(receipt => receipt.kind)).toEqual(['settle_review']);
      const after = await readyReview(h, preparedA.claim.runRef);
      expect(after).toMatchObject({ status: 'resolved', open: 'no', activeRound: null,
        disposition: { choice: 'handle_myself', hold: 'held' } });
      expect(after.rounds).toHaveLength(1);
    } finally {
      await reviewRoot.close();
    }
    await expectQuietHarnessRestart(h, 'K3-29 row 12: a final restart');
  }, 300_000);
});

/**
 * Rows 8/9 setup: the review claim's K close is a definite failure. It is
 * built the K3-27 "unsupported" way: the Kernel closure is dropped only for
 * the claim (the Run is really RUN-25 and its Turn really dangles), so the
 * claim creates a new continuation Session and the drive stops after
 * `create_session` and before the E15 handover. A fresh review root then
 * stands for the next instance.
 */
async function claimReviewInNewSession(h: HostScenario, label: string, model: ScriptedModel) {
  const crashed = await crashOneCommand(h, { callId: `${label}-shell`, select: `${label}-a`,
    requestId: `${label}-a-start`, shellArgs: { command: `${label} runs a program` } });
  crashHandles.push(crashed.release);
  expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
    { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
      autoCleanup: { applied: true } }] } });
  const preparedA = crashed.prepared;
  const created = await readyReview(h, preparedA.claim.runRef);
  kernelClosure.mode = 'unsupported';
  const first = await openReviewWorkRoot(h, createScriptedModel([{ kind: 'text', text: 'never entered' }]));
  let sessionId: string;
  try {
    const createStop = await driveReviewUntil(first, h.select(`${label}-create`, AG2B_WORK_TASK_ID), performs('create_session'));
    const createdResult = await first.workflow.advanceWork(hostCtx(), createStop.stopped);
    expect(createdResult).toMatchObject({ status: 'ready', value: { receipt: { kind: 'create_session', result: { status: 'completed' } } } });
    if (createdResult.status !== 'ready') throw new Error('create_session must answer');
    const receipt = createdResult.value.receipt;
    if (receipt?.kind !== 'create_session' || receipt.result.status !== 'completed') throw new Error('create_session must commit');
    sessionId = receipt.result.value.ref.sessionId;
    // The E15 handover is NOT committed: the next step is dropped.
    expect(createdResult.value.next).toMatchObject({ kind: 'perform', operation: { kind: 'transfer_responsibility' } });
  } finally {
    await first.close();
  }
  // A new composition root on the same files stands for the next instance:
  // the recovery reads only durable facts, never the closed instance's memory.
  const second = await openReviewWorkRoot(h, model);
  try {
    const startStop = await driveReviewUntil(second, h.select(`${label}-recover`, AG2B_WORK_TASK_ID), performs('start'));
    return { preparedA, created, sessionId, second, startStop };
  } catch (error) {
    await second.close();
    throw error;
  }
}

describe('K3-29 rows 8/9: the review claim after the Session change', () => {
  it('K3-29 row 8: after a determined close failure and a new Session, the crashed handover is recovered from provenance and the review is claimed in the new Session; the original Session is not revived', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const { preparedA, created, sessionId, startStop, second } = await claimReviewInNewSession(h, 'k3-29r8',
      createScriptedModel([{ kind: 'text', text: 'never entered' }]));
    try {
      // E15: the handover is re-derived from the new Session's provenance, then the review claims there.
      // E15 recovers the handover composition from provenance (the live
      // predecessor is archived in the same handover when it still is), then
      // the claim follows in the new Session: never a second close/create.
      const kinds = startStop.receipts.map(receipt => receipt.kind);
      expect(kinds.slice(-2)).toEqual(['claim_task', 'prepare']);
      expect(kinds).not.toContain('close_open_turn');
      expect(kinds).not.toContain('create_session');
      const claim = startStop.receipts.find(receipt => receipt.kind === 'claim_task');
      expect(claim).toMatchObject({ result: { status: 'committed', value: { sessionRef: { sessionId } } } });
      const prepared = preparedOf(startStop.stopped);
      expect(prepared.claim.sessionRef.sessionId).toBe(sessionId);
      expect(prepared.claim.sessionRef.sessionId).not.toBe(preparedA.claim.sessionRef.sessionId);
      expect(prepared.claim.runRef.runId).not.toBe(preparedA.claim.runRef.runId);
      // The record follows the original Run, not the Session.
      const record = await readyReview(h, preparedA.claim.runRef);
      expect(record.activeRound).toMatchObject({ runRef: prepared.claim.runRef, round: 1 });
      // The original Run stays ended and its predecessor Session is archived by
      // the E15 handover, never revived by a new claim.
      expect((await readExecution(h.host, preparedA.claim.runRef)).run)
        .toMatchObject({ status: 'ended', reconciliation: { status: 'done' } });
      const original = await h.post<ReadResult<{ record: { lifecycle: string; occupancy: unknown } }>>(
        'sessions/read', plain(AG2B_SCOPE, preparedA.claim.sessionRef));
      expect(original).toMatchObject({ status: 'ready', value: { record: { lifecycle: 'archived', occupancy: null } } });
      expect(created.status).toBe('pending_review');
      // The recovered round runs and settles in the new Session; one
      // continuation follows there.
      await second.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-29r8-round-start' });
      const settled = await h.advance(h.select('k3-29r8-settle', AG2B_WORK_TASK_ID), { stopBefore: performs('requeue_task') });
      expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');
      // The recovered round runs in the new Session and the record stops at
      // the decision card: no continuation is claimed.
      const stopped = await readyReview(h, preparedA.claim.runRef);
      expect(stopped).toMatchObject({ status: 'needs_decision', activeRound: null });
      const again = await h.advance(h.select('k3-29r8-again', AG2B_WORK_TASK_ID));
      expect(again.steps.flatMap(step => step.next !== null && step.next.kind === 'perform'
        && step.next.operation.kind === 'claim_task' ? [step.next.operation.request.input] : [])).toEqual([]);
    } finally {
      await second.close();
    }
    await expectQuietHarnessRestart(h, 'K3-29 row 8: a final restart');
  }, 300_000);

  it('K3-29 row 9: after the Session change the record still follows the original Run; the review and continuation briefs come from it and the nearest holder claims in the new Session', async () => {
    const model = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-29r9-conclusion', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'the shell call ended before the crash',
          crashSuspicion: { verdict: 'unlikely', evidence: 'the command leaves no crash trace' } } }] },
      { kind: 'text', text: 'K3-29 row 9: the review round is done' },
      { kind: 'text', text: 'K3-29 row 9: the continuation ran' },
    ]);
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const { preparedA, created, sessionId, startStop, second } = await claimReviewInNewSession(h, 'k3-29r9', model);
    try {
      const prepared = preparedOf(startStop.stopped);
      const roundRun = prepared.claim.runRef;
      expect(prepared.claim.sessionRef.sessionId).toBe(sessionId);
      await second.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-29r9-round-start' });

      const settled = await h.advance(h.select('k3-29r9-settle', AG2B_WORK_TASK_ID), { stopBefore: performs('requeue_task') });
      expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');
      const resolved = await readyReview(h, preparedA.claim.runRef);
      expect(resolved).toMatchObject({ status: 'resolved', activeRound: null, open: 'no' });
      expect(resolved.rounds).toEqual([{ runRef: roundRun, phase: 'review', round: 1, stateEntry: 1, result: 'finished' }]);
      // The review conclusion is written on the record keyed by the original Run.
      expect(resolved.items[0]).toMatchObject({ kind: 'process', observed: { verdict: 'done', by: 'review_round' } });

      const continuation = await h.advance(h.select('k3-29r9-continue', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
      const claim = continuation.steps.flatMap(step => step.next !== null && step.next.kind === 'perform'
        && step.next.operation.kind === 'claim_task'
        ? [step.next.operation.request.input as { sessionRef?: { sessionId: string }; review?: unknown }] : []);
      expect(claim).toHaveLength(1);
      expect(claim[0]?.review).toBeUndefined();
      // The nearest holder is round 1 (the new Session), not the original Session.
      expect(claim[0]?.sessionRef?.sessionId).toBe(sessionId);
      expect(claim[0]?.sessionRef?.sessionId).not.toBe(preparedA.claim.sessionRef.sessionId);
      const nextPrepared = preparedOf(continuation.next ?? null);
      await second.runtime.startRun(hostCtx(), { prepared: nextPrepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-29r9-continuation-start' });
      const brief = await h.post<ReadResult<{ brief: { unknownCallReview: { reviewRef: { runId: string } } | null } }>>(
        'executions/brief', plain(AG2B_SCOPE, { runRef: nextPrepared.claim.runRef }));
      expect(brief).toMatchObject({ status: 'ready', value: { brief: { unknownCallReview: { reviewRef: {
        runId: preparedA.claim.runRef.runId } } } } });
      expect(created.status).toBe('pending_review');
    } finally {
      await second.close();
    }
    await expectQuietHarnessRestart(h, 'K3-29 row 9: a final restart');
  }, 300_000);
});

describe('K3-29 extra (一): a crash after the review claim, before start', () => {
  it('K3-29 extra (一): 6b (c) hands the Goal off, UR3a prepares and starts the SAME claimed Run, and no second review Run is opened', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: `k3-29e1-shell`, select: `k3-29e1-a`,
      requestId: `k3-29e1-a-start`, shellArgs: { command: `k3-29e1 runs a program` } });
    crashHandles.push(crashed.release);
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    const preparedA = crashed.prepared;
    const created = await readyReview(h, preparedA.claim.runRef);
    const first = await openReviewWorkRoot(h, createScriptedModel([{ kind: 'text', text: 'never entered' }]));
    let claimedRun: RunRef;
    try {
      const claimStop = await driveReviewUntil(first, h.select('k3-29e1-claim', AG2B_WORK_TASK_ID), performs('claim_task'));
      const claimed = await first.workflow.advanceWork(hostCtx(), claimStop.stopped);
      expect(claimed).toMatchObject({ status: 'ready', value: { receipt: { kind: 'claim_task' } } });
      if (claimed.status !== 'ready') return;
      expect(claimed.value.next).toMatchObject({ kind: 'perform', operation: { kind: 'prepare' } });
      if (claimed.value.next === null) return;
      const startStop = await driveReviewUntil(first, claimed.value.next, performs('start'));
      claimedRun = preparedOf(startStop.stopped).claim.runRef;
      // The prepare and the start are NOT performed: the record keeps `starting`.
      const after = await readyReview(h, preparedA.claim.runRef);
      expect(after.activeRound).toMatchObject({ runRef: claimedRun });
      expect((await readExecution(h.host, claimedRun)).run).toMatchObject({ status: 'starting' });
    } finally {
      await first.close();
    }

    // 6b (c) kind 2 hands the active Goal off after the crash; the re-drive is off.
    // The unentered review claim leaves its Attempt open on the failed Task until
    // UR3a starts it, which the shared restart invariant check reads as I-1; the
    // extra is about the recovery path, so that step-local check is skipped here.
    const report = await h.restart({ crash: true, invariants: false });
    expect(report.report?.reviews.find(line => line.ref === JSON.stringify(created.ref)))
      .toEqual({ ref: JSON.stringify(created.ref), row: 'UCR', status: 'left', reason: 'pending_review active_round' });
    expect(report.report?.redriveGoals).toEqual([{ goalRef: AG2B_GOAL_REF, scope: { ...AG2B_SCOPE },
      taskIds: [AG2B_WORK_TASK_ID] }]);

    // UR3a: the same claim is prepared and started; no second review claim.
    const model = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-29e1-conclusion', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'the shell call ended before the crash',
          crashSuspicion: { verdict: 'unlikely', evidence: 'the command leaves no crash trace' } } }] },
      { kind: 'text', text: 'K3-29 extra (一): the recovered round is done' },
    ]);
    const second = await openReviewWorkRoot(h, model);
    try {
      const startStop = await driveReviewUntil(second, h.select('k3-29e1-recover', AG2B_WORK_TASK_ID), performs('start'));
      expect(startStop.receipts.map(receipt => receipt.kind)).toEqual(['prepare']);
      const prepared = preparedOf(startStop.stopped);
      expect(prepared.claim.runRef).toEqual(claimedRun);
      await second.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'k3-29e1-start' });
    } finally {
      await second.close();
    }
    const settled = await h.advance(h.select('k3-29e1-settle', AG2B_WORK_TASK_ID), { stopBefore: performs('requeue_task') });
    expect(settled.receipts.map(receipt => receipt.kind)).toEqual(['settle_review']);
    const done = await readyReview(h, preparedA.claim.runRef);
    expect(done).toMatchObject({ status: 'resolved', activeRound: null, open: 'no' });
    expect(done.rounds).toEqual([{ runRef: claimedRun, phase: 'review', round: 1, stateEntry: 1, result: 'finished' }]);
  }, 300_000);
});
