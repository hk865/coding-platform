/**
 * K3-44 (二) (L7, L28, L29 row 4b/10; D4): the operator holds the review while
 * the review round is running, then the Host restarts and the round is
 * interrupted cleanly:
 *
 * - step 2b reports the record (`open = 'yes'`, one `UCR`/`left` line);
 * - step 6b (c) kind 2 hands the Goal to the start-up re-drive (the record's
 *   Task id), because its round still has to be closed;
 * - the next advance settles only that round (UCR-08b `settled`), opens no
 *   second round, and the Task stays stopped (held, AV-4c);
 * - a second restart writes nothing.
 *
 * The chain is the real K3-05 one: a `shell` call in flight is closed by RUN-25
 * on a crash restart, leaving a `process` item `pending_review`; a real review
 * root claims and starts round 1 with the read-only grant. Its first model
 * request is held so the round Run is `running` when the operator holds the
 * review and the Host crashes (no unresolved tool call: RUN-19 clean).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { expectQuietHarnessRestart } from './support/restart.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
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

// --- The shell seam (the original work call in flight) --------------------
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
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

/** K3-05's A half: a `shell` call in flight is closed by RUN-25, leaving the record `pending_review`. */
async function crashShellRun(h: HostScenario): Promise<ReturnType<typeof preparedOf>> {
  shellSeam.arm();
  const modelA = createScriptedModel([{ kind: 'calls', calls: [
    { callId: 'k3-44b-shell', name: 'shell', args: { command: 'k3-44b runs a program' } }] }]);
  const rootA = await openShellWorkRoot(h, modelA);
  let runningA: Promise<unknown> | null = null;
  try {
    const startA = await prepareOn(rootA, h.select('k3-44b-a', AG2B_WORK_TASK_ID));
    const preparedA = preparedOf(startA);
    runningA = rootA.runtime.startRun(hostCtx(), { prepared: preparedA, consumerId: AG2B_CONSUMER_ID,
      requestId: 'k3-44b-a-start' });
    await shellSeam.waitForCall();
    const report = await h.restart({ crash: true });
    expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(preparedA.claim.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    return preparedA;
  } finally {
    shellSeam.release();
    await runningA?.catch(() => undefined);
    await rootA.close();
  }
}

describe('K3-44 (二) hold during the review round, then a clean restart', () => {
  it('K3-44 (二): 2b lists the held open record, 6b (c) kind 2 hands off, settle_review closes the round (UCR-08b), no new round, the Task stays stopped, a second restart writes nothing', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const preparedA = await crashShellRun(h);
    const created = await reviewOf(h, preparedA.claim.runRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(created.value).toMatchObject({ status: 'pending_review', activeRound: null, open: 'yes' });

    // --- The review round really starts; its first model request is held, so
    // the round Run stays `running` with no tool call in flight. -------------
    let releaseModel!: () => void;
    const modelHeld = new Promise<void>(resolve => { releaseModel = resolve; });
    const modelReview = createScriptedModel([{ kind: 'text', text: 'the round is interrupted before it concludes' }],
      async () => { await modelHeld; });
    const reviewRoot = await openReviewWorkRoot(h, modelReview);
    let roundRunRef: RunRef | null = null;
    let running: Promise<unknown> | null = null;
    try {
      const claimStop = await driveReviewUntil(reviewRoot, h.select('k3-44b-review', AG2B_WORK_TASK_ID),
        performs('claim_task'));
      if (claimStop.stopped.kind !== 'perform' || claimStop.stopped.operation.kind !== 'claim_task') {
        throw new Error('the review claim step was expected');
      }
      const startStop = await driveReviewUntil(reviewRoot, claimStop.stopped, performs('start'));
      expect(startStop.receipts.map(receipt => receipt.kind)).toEqual(['claim_task', 'prepare']);
      const preparedRound = preparedOf(startStop.stopped);
      roundRunRef = preparedRound.claim.runRef;
      expect(roundRunRef.runId).not.toBe(preparedA.claim.runRef.runId);
      running = reviewRoot.runtime.startRun(hostCtx(), { prepared: preparedRound, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-44b-review-start' });
      for (let attempt = 0; attempt < 200 && modelReview.calls() === 0; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(modelReview.calls(), 'the review round reached its first model request').toBe(1);
      const claimed = await reviewOf(h, preparedA.claim.runRef);
      expect(claimed.status).toBe('ready');
      if (claimed.status !== 'ready') return;
      const reviewRef = claimed.value.ref;
      expect(claimed.value.activeRound).toMatchObject({ runRef: roundRunRef, round: 1 });

      // --- The operator holds the review while the round is running. --------
      const hold = await h.post('unknown-call-reviews/hold', graphWrite(AG2B_SCOPE,
        { reviewRef, text: 'I will handle this' }, 'k3-44b-hold', [{ ref: reviewRef, revision: claimed.value.revision }]));
      expect(hold).toMatchObject({ status: 'committed', value: { status: 'resolved',
        disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' }, activeRound: { runRef: roundRunRef } } });

      // --- The Host crashes: the running round is interrupted cleanly. ------
      const report = await h.restart({ crash: true });
      const roundLine = report.report?.runs.find(row => row.ref === JSON.stringify(roundRunRef));
      expect(roundLine, JSON.stringify(report.report?.runs)).toMatchObject({ status: 'reconciled' });
      const reported = report.report?.reviews.find(line => line.ref === JSON.stringify(reviewRef));
      expect(reported, JSON.stringify(report.report?.reviews)).toEqual({ ref: JSON.stringify(reviewRef), row: 'UCR',
        status: 'left', reason: 'resolved active_round' });
      expect(report.report?.redriveGoals).toEqual([{ goalRef: AG2B_GOAL_REF, scope: { ...AG2B_SCOPE },
        taskIds: [AG2B_WORK_TASK_ID] }]);

      // --- settle_review closes only this round (UCR-08b), no second round. -
      const settled = await h.advance(h.select('k3-44b-settle', AG2B_WORK_TASK_ID), { stopBefore: performs('requeue_task') });
      const kinds = settled.receipts.map(receipt => receipt.kind);
      expect(kinds).toContain('settle_review');
      expect(kinds).not.toContain('open_checks');
      const after = await reviewOf(h, preparedA.claim.runRef);
      expect(after.status).toBe('ready');
      if (after.status !== 'ready') return;
      expect(after.value).toMatchObject({ status: 'resolved', open: 'no', activeRound: null,
        disposition: { choice: 'handle_myself', hold: 'held' }, decisionReasons: [] });
      expect(after.value.rounds).toEqual([{ runRef: roundRunRef, phase: 'review', round: 1, stateEntry: 1,
        result: 'unfinished' }]);

      // --- The Task stays stopped; a second advance opens no review round. --
      const again = await h.advance(h.select('k3-44b-again', AG2B_WORK_TASK_ID));
      const reviewClaims = again.steps.flatMap(step => step.next !== null && step.next.kind === 'perform'
        && step.next.operation.kind === 'claim_task'
        ? [(step.next.operation.request.input as { review?: unknown }).review] : []);
      expect(reviewClaims.every(review => review === undefined)).toBe(true);
      expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed', execution: { runId: preparedA.claim.runRef.runId } });

      // --- A second restart writes nothing. ---------------------------------
      await expectQuietHarnessRestart(h, 'K3-44 (二): a second restart');

      // Let the abandoned round's held model request end before closing the root.
      releaseModel();
      await running?.catch(() => undefined);
    } finally {
      releaseModel();
      await running?.catch(() => undefined);
      await reviewRoot.close();
    }
  }, 300_000);
});
