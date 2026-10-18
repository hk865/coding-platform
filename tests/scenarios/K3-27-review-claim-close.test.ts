/**
 * K3-27 (R4; K3-SPEC L12 / L29 rows 8-9; K L7): the review claim's K close.
 *
 * - success: the dangling Turn of the reviewed Run's Session is closed by the
 *   review claim and the round claims in the ORIGINAL Session;
 * - Kernel version conflict: `close_open_turn` answers `conflict`, the Workflow
 *   waits, and the next advance closes the Turn and claims in the original
 *   Session;
 * - unsupported: the new-Session fallback runs (`create_session`, the E15
 *   handover), the review claims in the NEW Session, that Session's first round
 *   is seeded with the original Session's completed history, the later
 *   continuation is also in the new Session and its brief carries the
 *   review-record section.
 *
 * The original Session is made `kernel_turn_open` by a real crash: Run 1 ends
 * after its check fails (a completed Kernel turn); a person's requeue starts
 * Run 2 in the same Session, and Run 2 crashes inside a `shell` call (RUN-25,
 * `takeover_unresolved`). Scripted model only; no real model call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { operatorRequeue, preparedOf, readCall, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { expectQuietHarnessRestart } from './support/restart.js';
import { preparedBriefOf, preparedManifestOf } from './support/brief.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

// The KE6 stand-in: `reviewCapability` reads `ProcessSandbox.probe` with the
// read-only options; no host process runs (K3-05's stand-in, unchanged).
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  class KProcessSandbox {
    constructor(..._args: unknown[]) { void _args; }
    get effectiveOptions(): { protectedPaths: string[]; readOnlyPaths: string[]; executablePath: string } {
      return { protectedPaths: [], readOnlyPaths: [], executablePath: '/usr/bin:/bin' };
    }
    static async probe(_root: string, _workspace: unknown, options?: Record<string, unknown>): Promise<unknown> {
      if (options?.['workspaceMode'] !== 'read_only') {
        return { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: only read-only probing' };
      }
      return sandbox.available
        ? { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
        : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: bubblewrap unavailable' };
    }
  }
  return { ...actual, ProcessSandbox: KProcessSandbox };
});

// The Kernel closure switch: `unsupported` drops `closeOpenTurn` (K L4 step 5);
// `conflict-once` answers one `conflict` and then delegates to the real seam.
const kernelClosure = vi.hoisted(() => ({ mode: 'normal' as 'normal' | 'unsupported' | 'conflict-once', conflicts: 0 }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.defineProperty({ ...actual }, 'closeOpenTurn', { enumerable: true, get: () => {
    if (kernelClosure.mode === 'unsupported') return undefined;
    const real = actual['closeOpenTurn'] as (...args: unknown[]) => Promise<unknown>;
    return async (...args: unknown[]) => {
      if (kernelClosure.mode === 'conflict-once' && kernelClosure.conflicts === 0) {
        kernelClosure.conflicts += 1;
        return { status: 'conflict', currentRevision: 999 };
      }
      return await real(...args);
    };
  } });
});

// --- The shell seam (Run 2's process call in flight) -----------------------
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

afterEach(async () => {
  kernelClosure.mode = 'normal';
  kernelClosure.conflicts = 0;
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

type Crashed = {
  original: RunRef;
  originalSessionId: string;
  originalKernelSessionId: string;
  /** Releases the original Run's blocked tool call and closes its root (after the review claim). */
  release(): Promise<void>;
};

/**
 * Run 1 completes its turn (the check then FAILs, so the Task stays open); a
 * person's requeue starts Run 2 in the SAME Session, and Run 2 crashes inside a
 * `shell` call after a completed `read` group. That leaves the record
 * `pending_review` and the Session `kernel_turn_open`.
 */
async function crashedOriginalSession(h: HostScenario, label: string): Promise<Crashed> {
  // Another Task's Run first completes a normal turn in a Session (its check
  // round is left unstarted): the Session is idle and its Kernel history has a
  // completed part for the new Session to seed from later.
  const otherTask = `${label}-other-task`;
  const toStartOther = await h.advance(h.select(`${label}-other`, otherTask), { stopBefore: performs('start') });
  const other = preparedOf(toStartOther.next);
  const otherSessionId = other.claim.sessionRef.sessionId;
  const otherDriven = await h.advance(toStartOther.next!, { stopBefore: performs('run_check') });
  expect(otherDriven.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining(['start', 'open_checks']));
  expect((await readExecution(h.host, other.claim.runRef)).run).toMatchObject({ status: 'ended', outcome: 'completed' });
  expect((await readExecution(h.host, other.claim.runRef)).session.ref.sessionId).toBe(otherSessionId);

  // The Task under review is claimed FIRST (no preceding TaskRequeue), and it
  // reuses that idle Session. It crashes inside a `shell` call after its read
  // group (RUN-25, `takeover_unresolved`).
  shellSeam.arm();
  const model = createScriptedModel([
    { kind: 'calls', calls: [{ callId: `${label}-read`, name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'calls', calls: [{ callId: `${label}-shell`, name: 'shell', args: { command: `${label} runs a program` } }] },
  ]);
  const root = await openShellWorkRoot(h, model);
  let running: Promise<unknown> | null = null;
  let released = false;
  try {
    const start = await prepareOn(root, h.select(`${label}-run`, AG2B_WORK_TASK_ID));
    const prepared = preparedOf(start);
    expect(prepared.claim.sessionRef.sessionId).toBe(otherSessionId);
    running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
      requestId: `${label}-run-start` });
    await shellSeam.waitForCall();
    const report = await h.restart({ crash: true });
    expect(report, JSON.stringify(report)).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(prepared.claim.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    const created = await reviewOf(h, prepared.claim.runRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') throw new Error(JSON.stringify(created));
    expect(created.value).toMatchObject({ status: 'pending_review', activeRound: null });
    const original = await readExecution(h.host, prepared.claim.runRef);
    return { original: prepared.claim.runRef, originalSessionId: prepared.claim.sessionRef.sessionId,
      originalKernelSessionId: original.session.kernel.kernelSessionId,
      async release() {
        if (released) return;
        released = true;
        shellSeam.release();
        await running?.catch(() => undefined);
        await root.close();
      } };
  } catch (error) {
    shellSeam.release();
    await running?.catch(() => undefined);
    await root.close();
    throw error;
  }
}

/** One stored model that writes the round's conclusion and then completes the turn. */
function concludingModel(label: string) {
  return createScriptedModel([
    { kind: 'calls', calls: [{ callId: `${label}-conclusion`, name: 'record_unknown_call_review',
      args: { item: 1, verdict: 'done', evidence: 'the shell call reached its end before the crash',
        crashSuspicion: { verdict: 'unlikely', evidence: 'the command itself leaves no crash trace' } } }] },
    { kind: 'text', text: `${label}: the round completes` },
  ]);
}

describe('K3-27 the review claim\'s K close', () => {
  it('K3-27 (success): the review claim closes the dangling Turn and the round claims in the original Session', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass',
      script: { replies: [readCall('k3-27-success-other'), { kind: 'text', text: 'the other task completes' }] }, workIds: [AG2B_WORK_TASK_ID, 'k3-27-success-other-task'] });
    const crashed = await crashedOriginalSession(h, 'k3-27-success');
    const root = await openReviewWorkRoot(h, concludingModel('k3-27-success'));
    try {
      const toClose = await driveReviewUntil(root, h.select('k3-27-success-close', AG2B_WORK_TASK_ID),
        performs('close_open_turn'));
      expect(toClose.stopped).toMatchObject({ kind: 'perform', operation: { kind: 'close_open_turn',
        request: { afterRunRef: crashed.original } } });
      const closed = await root.workflow.advanceWork(hostCtx(), toClose.stopped);
      expect(closed).toMatchObject({ status: 'ready', value: { receipt: { kind: 'close_open_turn',
        result: { status: 'closed', health: 'available' } } } });
      if (closed.status !== 'ready' || closed.value.next === null) throw new Error('the close has no successor');

      const claimStop = await driveReviewUntil(root, closed.value.next, performs('claim_task'));
      if (claimStop.stopped.kind !== 'perform' || claimStop.stopped.operation.kind !== 'claim_task') {
        throw new Error('the review claim step is expected');
      }
      expect(claimStop.stopped.operation.request.input.sessionRef.sessionId).toBe(crashed.originalSessionId);
      const session = await h.post<ReadResult<{ record: { health: string; healthConclusion?: string } }>>(
        'sessions/read', plain(AG2B_SCOPE, { projectId: AG2B_SCOPE.projectId, sessionId: crashed.originalSessionId }));
      expect(session).toMatchObject({ status: 'ready', value: { record: { health: 'available' } } });

      // The round runs and settles in the original Session.
      const claim = await root.workflow.advanceWork(hostCtx(), claimStop.stopped);
      expect(claim).toMatchObject({ status: 'ready', value: { receipt: { kind: 'claim_task' } } });
      if (claim.status !== 'ready' || claim.value.next === null) throw new Error('the claim has no successor');
      const startStop = await driveReviewUntil(root, claim.value.next, performs('start'));
      const prepared = preparedOf(startStop.stopped);
      expect(prepared.claim.sessionRef.sessionId).toBe(crashed.originalSessionId);
      expect(prepared.claim.runRef.runId).not.toBe(crashed.original.runId);
      await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'k3-27-success-start' });
      const settleStop = await driveReviewUntil(root, h.select('k3-27-success-settle', AG2B_WORK_TASK_ID),
        performs('settle_review'));
      const settled = await root.workflow.advanceWork(hostCtx(), settleStop.stopped);
      expect(settled).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review' } } });
      const record = await reviewOf(h, crashed.original);
      expect(record).toMatchObject({ status: 'ready', value: { status: 'resolved', activeRound: null } });
    } finally {
      await crashed.release();
      await root.close();
    }
    await expectQuietHarnessRestart(h, 'K3-27 (success): a final restart');
  }, 300_000);

  it('K3-27 (Kernel version conflict): the close answers conflict, the Workflow waits, and the next advance closes the Turn and claims in the original Session', async () => {
    kernelClosure.mode = 'conflict-once';
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass',
      script: { replies: [readCall('k3-27-conflict-other'), { kind: 'text', text: 'the other task completes' }] }, workIds: [AG2B_WORK_TASK_ID, 'k3-27-conflict-other-task'] });
    const crashed = await crashedOriginalSession(h, 'k3-27-conflict');
    const root = await openReviewWorkRoot(h, concludingModel('k3-27-conflict'));
    try {
      const first = await driveReviewUntil(root, h.select('k3-27-conflict-close1', AG2B_WORK_TASK_ID),
        performs('close_open_turn'));
      const waited = await root.workflow.advanceWork(hostCtx(), first.stopped);
      expect(waited).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null,
        receipt: { kind: 'close_open_turn', result: { status: 'conflict' } },
        reason: 'close_open_turn: conflict; retry on the next advancement' } });
      expect(kernelClosure.conflicts).toBe(1);

      // The next advance re-runs the close; now it succeeds and claims in the original Session.
      const second = await driveReviewUntil(root, h.select('k3-27-conflict-close2', AG2B_WORK_TASK_ID),
        performs('close_open_turn'));
      expect(second.stopped).toMatchObject({ kind: 'perform', operation: { kind: 'close_open_turn',
        request: { afterRunRef: crashed.original } } });
      const closed = await root.workflow.advanceWork(hostCtx(), second.stopped);
      expect(closed).toMatchObject({ status: 'ready', value: { receipt: { kind: 'close_open_turn',
        result: { status: 'closed' } } } });
      if (closed.status !== 'ready' || closed.value.next === null) throw new Error('the close has no successor');
      const claimStop = await driveReviewUntil(root, closed.value.next, performs('claim_task'));
      if (claimStop.stopped.kind !== 'perform' || claimStop.stopped.operation.kind !== 'claim_task') {
        throw new Error('the review claim step is expected');
      }
      expect(claimStop.stopped.operation.request.input.sessionRef.sessionId).toBe(crashed.originalSessionId);
      const claim = await root.workflow.advanceWork(hostCtx(), claimStop.stopped);
      expect(claim).toMatchObject({ status: 'ready', value: { receipt: { kind: 'claim_task' } } });
    } finally {
      await crashed.release();
      await root.close();
    }
  }, 300_000);

  it('K3-27 (unsupported): the fallback creates a Session and hands over; the round claims there, seeded with the original history; the continuation is in the same Session and the brief carries the review record', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass',
      script: { replies: [readCall('k3-27-fallback-other'), { kind: 'text', text: 'the other task completes' }] }, workIds: [AG2B_WORK_TASK_ID, 'k3-27-fallback-other-task'] });
    const crashed = await crashedOriginalSession(h, 'k3-27-fallback');
    // The record exists (RUN-25); only the review claim's K close finds the
    // Kernel closure unavailable now.
    kernelClosure.mode = 'unsupported';
    const root = await openReviewWorkRoot(h, concludingModel('k3-27-fallback'));
    try {
      const toClose = await driveReviewUntil(root, h.select('k3-27-fallback-close', AG2B_WORK_TASK_ID),
        performs('close_open_turn'));
      const fallback = await root.workflow.advanceWork(hostCtx(), toClose.stopped);
      expect(fallback).toMatchObject({ status: 'ready', value: { receipt: { kind: 'close_open_turn',
        result: { status: 'unsupported' } } } });
      if (fallback.status !== 'ready') throw new Error('the close was not performed');
      const driven = await driveReviewUntil(root, fallback.value.next ?? toClose.stopped, performs('start'));
      const kinds = ['close_open_turn', ...driven.receipts.map(receipt => receipt.kind)];
      expect(kinds).toEqual(expect.arrayContaining(['close_open_turn', 'create_session', 'claim_task']));
      expect(kinds).toContain('transfer_responsibility');
      const prepared = preparedOf(driven.stopped);
      expect(prepared.claim.sessionRef.sessionId).not.toBe(crashed.originalSessionId);

      // The new Session's first round is seeded from the original Session's completed history.
      const manifest = await preparedManifestOf(h, prepared.envelope.bundleRef);
      expect(manifest.sessionBasis).toMatchObject({ sourceKernelSessionId: crashed.originalKernelSessionId,
        throughPosition: expect.any(Number) });
      expect((manifest.sessionBasis as { throughPosition: number }).throughPosition).toBeGreaterThan(0);

      // Complete and settle the round.
      await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'k3-27-fallback-start' });
      const settleStop = await driveReviewUntil(root, h.select('k3-27-fallback-settle', AG2B_WORK_TASK_ID),
        performs('settle_review'));
      const settled = await root.workflow.advanceWork(hostCtx(), settleStop.stopped);
      expect(settled).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review',
        result: { status: 'committed', value: { status: 'resolved', activeRound: null } } } } });

      // The later continuation is in the new Session (the nearest holder's claim Session).
      const toContinue = await h.advance(h.select('k3-27-fallback-continue', AG2B_WORK_TASK_ID),
        { stopBefore: performs('start') });
      const continued = preparedOf(toContinue.next);
      expect(continued.claim.sessionRef.sessionId).toBe(prepared.claim.sessionRef.sessionId);
      expect(continued.claim.sessionRef.sessionId).not.toBe(crashed.originalSessionId);
      // The continuation brief carries the review-record section.
      const brief = await preparedBriefOf(h, continued.envelope.bundleRef);
      expect(brief.unknownCallReview).toBeDefined();
      expect(brief.unknownCallReview).not.toBeNull();
      const originalSession = await readExecution(h.host, crashed.original);
      expect(originalSession.session.ref.sessionId).toBe(crashed.originalSessionId);

      // Release the abandoned original Run (its Turn ends) and let one settling
      // restart complete the fallback's handover bookkeeping; the NEXT restart
      // is the quiet one.
      await crashed.release();
      const settling = await h.restart({ crash: true, automation: redrivePolicy(false) });
      expect(settling.report?.problems).toEqual([]);
    } finally {
      await crashed.release();
      await root.close();
    }
    await expectQuietHarnessRestart(h, 'K3-27 (unsupported): a final restart');
  }, 300_000);
});
