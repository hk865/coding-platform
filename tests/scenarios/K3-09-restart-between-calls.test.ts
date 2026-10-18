/**
 * K3-09 (一) (L12, L15, L29; D1): restart the Host after a review round wrote a
 * conclusion and between its two calls — a clean interruption with no
 * unresolved tool call:
 *
 * - the round Run is reconciled RUN-19 (`W-11`, `interrupted_clean`);
 * - the next advance settles the FIRST round `unfinished` (UCR-06) and keeps
 *   the record `pending_review`;
 * - the second round claims in the SAME Session as round 1 (its after-run
 *   holder is round 1's Run);
 * - the second round completes and settles the record `resolved`;
 * - exactly one continuation is claimed for the Task, one original-Run end, one
 *   record and two rounds; a final restart writes nothing.
 *
 * The chain is K3-05's: a `shell` call in flight is closed by RUN-25, leaving a
 * `process` item; a real review root claims and starts round 1 with the read-only
 * grant. Scripted model only. (The in-process review root keeps its Kernel
 * connection, so the clean crash ends its own Turn; a real dead process leaves
 * it open. The `close_open_turn` case is covered by K3-09 (二), where the
 * blocked tool leaves that Turn open on purpose.)
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
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
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

// --- The blocking `record_unknown_call_review` stand-in (K3-09 (二)): the
// tool call is in flight when the Host crashes, so the round Run has an
// unresolved call (`review_round`, D1) and its Kernel Turn stays open.
const reviewToolSeam = vi.hoisted(() => ({ armed: false, gate: Promise.resolve(), reached: null as null | (() => void) }));
vi.mock('../../src/core/agent-runtime/unknown-call-review-tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/agent-runtime/unknown-call-review-tools.js')>();
  return {
    ...actual,
    createUnknownCallReviewTools: (config: Parameters<typeof actual.createUnknownCallReviewTools>[0]) => {
      const handle = actual.createUnknownCallReviewTools(config);
      return { ...handle, create: (workspace: Parameters<typeof handle.create>[0]) => handle.create(workspace).map(
        definition => ({ ...definition, handler: { ...definition.handler,
          execute: async (call: Parameters<typeof definition.handler.execute>[0],
            options: Parameters<typeof definition.handler.execute>[1]) => {
            if (reviewToolSeam.armed) {
              reviewToolSeam.armed = false;
              reviewToolSeam.reached?.();
              await reviewToolSeam.gate;
            }
            return definition.handler.execute(call, options);
          } } })) };
    },
  };
});

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
async function crashShellRun(h: HostScenario, label: string): Promise<ReturnType<typeof preparedOf>> {
  shellSeam.arm();
  const modelA = createScriptedModel([{ kind: 'calls', calls: [
    { callId: `${label}-shell`, name: 'shell', args: { command: `${label} runs a program` } }] }]);
  const rootA = await openShellWorkRoot(h, modelA);
  let runningA: Promise<unknown> | null = null;
  try {
    const startA = await prepareOn(rootA, h.select(`${label}-a`, AG2B_WORK_TASK_ID));
    const preparedA = preparedOf(startA);
    runningA = rootA.runtime.startRun(hostCtx(), { prepared: preparedA, consumerId: AG2B_CONSUMER_ID,
      requestId: `${label}-a-start` });
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

describe('K3-09 (一) restart between two review calls', () => {
  it('K3-09 (一): a clean interruption between calls is RUN-19; the first round is unfinished, the second claims in the same Session, one continuation, a final restart writes nothing', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const preparedA = await crashShellRun(h, 'k3-09a');
    const created = await reviewOf(h, preparedA.claim.runRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;

    // --- Round 1 writes its conclusion, then blocks on the next model call. -
    let releaseModel!: () => void;
    const modelHeld = new Promise<void>(resolve => { releaseModel = resolve; });
    const modelRound1 = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-09a-conclusion', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'the shell call reached its end before the crash',
          crashSuspicion: { verdict: 'unlikely', evidence: 'the command itself leaves no crash trace' } } }] },
      { kind: 'text', text: 'round 1 is interrupted between its two calls' },
    ], async (_request, index) => { if (index === 1) await modelHeld; });
    const reviewRoot = await openReviewWorkRoot(h, modelRound1);
    let round1: RunRef | null = null;
    let roundSessionId: string | null = null;
    let running1: Promise<unknown> | null = null;
    try {
      const claimStop = await driveReviewUntil(reviewRoot, h.select('k3-09a-review', AG2B_WORK_TASK_ID),
        performs('claim_task'));
      const startStop = await driveReviewUntil(reviewRoot, claimStop.stopped, performs('start'));
      const prepared1 = preparedOf(startStop.stopped);
      round1 = prepared1.claim.runRef;
      roundSessionId = prepared1.claim.sessionRef.sessionId;
      running1 = reviewRoot.runtime.startRun(hostCtx(), { prepared: prepared1, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-09a-review-start' });
      for (let attempt = 0; attempt < 300 && modelRound1.calls() < 2; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(modelRound1.calls(), 'the conclusion was written and the second call is in flight').toBe(2);

      // --- The Host crashes: RUN-19, interrupted clean (no unresolved call). -
      const report = await h.restart({ crash: true });
      expect(report.report?.runs.find(row => row.ref === JSON.stringify(round1)))
        .toMatchObject({ row: 'W-11', status: 'reconciled', reason: 'interrupted_clean' });
      expect(report.report?.reviews).toEqual([{ ref: JSON.stringify(created.value.ref), row: 'UCR', status: 'left',
        reason: 'pending_review active_round' }]);

      // --- The first round settles `unfinished`; the record still waits. -----
      const settleStop1 = await driveReviewUntil(reviewRoot, h.select('k3-09a-settle', AG2B_WORK_TASK_ID),
        performs('settle_review'));
      const settleResult1 = await reviewRoot.workflow.advanceWork(hostCtx(), settleStop1.stopped);
      expect(settleResult1).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review' } } });
      const afterRound1 = await reviewOf(h, preparedA.claim.runRef);
      expect(afterRound1.status).toBe('ready');
      if (afterRound1.status !== 'ready') return;
      expect(afterRound1.value).toMatchObject({ status: 'pending_review', activeRound: null, decisionReasons: [] });
      expect(afterRound1.value.rounds).toEqual([{ runRef: round1, phase: 'review', round: 1, stateEntry: 1,
        result: 'unfinished' }]);

      // --- Round 2 claims in the same Session as round 1. -------------------
      const secondClaim = await driveReviewUntil(reviewRoot, h.select('k3-09a-review2', AG2B_WORK_TASK_ID),
        performs('claim_task'));
      const secondClaimRequest = secondClaim.stopped.kind === 'perform'
        ? (secondClaim.stopped.operation.request as unknown as { input: { sessionRef?: { sessionId: string } } }).input : {};
      expect(secondClaimRequest.sessionRef?.sessionId).toBe(roundSessionId);
      const prepared2 = preparedOf((await driveReviewUntil(reviewRoot, secondClaim.stopped, performs('start'))).stopped);
      expect(prepared2.claim.sessionRef.sessionId).toBe(roundSessionId);
      expect(prepared2.claim.runRef.runId).not.toBe(round1.runId);

      // The abandoned round 1 ends now; its late write is refused by the ended Run.
      releaseModel();
      await running1?.catch(() => undefined);

      // --- Round 2 completes and the record settles `resolved`. --------------
      const modelRound2 = createScriptedModel([{ kind: 'text', text: 'round 2 completes the review' }]);
      const reviewRoot2 = await openReviewWorkRoot(h, modelRound2);
      try {
        await reviewRoot2.runtime.startRun(hostCtx(), { prepared: prepared2, consumerId: AG2B_CONSUMER_ID,
          requestId: 'k3-09a-review2-start' });
        const settleStop2 = await driveReviewUntil(reviewRoot2, h.select('k3-09a-settle2', AG2B_WORK_TASK_ID),
          performs('settle_review'));
        const settleResult2 = await reviewRoot2.workflow.advanceWork(hostCtx(), settleStop2.stopped);
        expect(settleResult2).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review' } } });
      } finally {
        await reviewRoot2.close();
      }
      const resolved = await reviewOf(h, preparedA.claim.runRef);
      expect(resolved.status).toBe('ready');
      if (resolved.status !== 'ready') return;
      expect(resolved.value).toMatchObject({ status: 'resolved', activeRound: null, decisionReasons: [] });
      expect(resolved.value.rounds.map(round => round.result)).toEqual(['unfinished', 'finished']);

      // --- One continuation is claimed for the Task (stop before it starts). -
      const continuation = await h.advance(h.select('k3-09a-continue', AG2B_WORK_TASK_ID),
        { stopBefore: performs('start') });
      const continuationClaims = continuation.steps.flatMap(step => step.next !== null && step.next.kind === 'perform'
        && step.next.operation.kind === 'claim_task'
        ? [(step.next.operation.request.input as { review?: unknown })] : [])
        .filter(input => input.review === undefined);
      expect(continuationClaims).toHaveLength(1);
      const row = await h.taskRow();
      expect(row.execution).not.toBeNull();
      expect(row.execution?.runId).not.toBe(preparedA.claim.runRef.runId);
      const original = await readExecution(h.host, preparedA.claim.runRef);
      expect(original.run).toMatchObject({ status: 'ended', reconciliation: { status: 'done' } });

      // --- A final restart writes nothing. ----------------------------------
      await expectQuietHarnessRestart(h, 'K3-09 (一): a final restart');
    } finally {
      releaseModel();
      await running1?.catch(() => undefined);
      await reviewRoot.close();
    }
  }, 300_000);

  it('K3-09 (二): a restart while record_unknown_call_review is in flight is RUN-20(i) blockedBy review_round; UR5 skips, the attestation (no record) leaves the round unfinished, and the second round claims in the same Session', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const preparedA = await crashShellRun(h, 'k3-09b');
    const created = await reviewOf(h, preparedA.claim.runRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;

    // --- Round 1 blocks INSIDE record_unknown_call_review. -----------------
    let releaseTool!: () => void;
    reviewToolSeam.gate = new Promise<void>(resolve => { releaseTool = resolve; });
    const reached = new Promise<void>(resolve => { reviewToolSeam.reached = resolve; });
    reviewToolSeam.armed = true;
    const modelRound1 = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-09b-conclusion',
      name: 'record_unknown_call_review', args: { item: 1, verdict: 'done', evidence: 'the shell call finished',
        crashSuspicion: { verdict: 'unlikely', evidence: 'nothing suggests a crash' } } }] }]);
    const reviewRoot = await openReviewWorkRoot(h, modelRound1);
    let round1: RunRef | null = null;
    let roundSessionId: string | null = null;
    let running1: Promise<unknown> | null = null;
    try {
      const claimStop = await driveReviewUntil(reviewRoot, h.select('k3-09b-review', AG2B_WORK_TASK_ID),
        performs('claim_task'));
      const startStop = await driveReviewUntil(reviewRoot, claimStop.stopped, performs('start'));
      const prepared1 = preparedOf(startStop.stopped);
      round1 = prepared1.claim.runRef;
      roundSessionId = prepared1.claim.sessionRef.sessionId;
      running1 = reviewRoot.runtime.startRun(hostCtx(), { prepared: prepared1, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-09b-review-start' });
      await reached;

      // --- The crash: the call has no result -> RUN-20(i) `review_round`. ---
      const report = await h.restart({ crash: true });
      expect(report.report?.runs.find(row => row.ref === JSON.stringify(round1)))
        .toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown',
          autoCleanup: { applied: false, blockedBy: 'review_round' } });
      // No new record; the round Run owns none, the original record is unchanged.
      expect(await reviewOf(h, round1)).toEqual({ status: 'not_found' });
      expect(await reviewOf(h, preparedA.claim.runRef)).toMatchObject({ status: 'ready', value: {
        status: 'pending_review', activeRound: { runRef: round1 }, rounds: [] } });
      // No Kernel close: the round's Turn is still open in the Kernel store.
      const roundKernel = h.kernelSnapshot().sessions.find(session => session.activeTurnId !== null);
      expect(roundKernel?.activeRunId, 'the round Kernel Turn is still open').not.toBeNull();
      const afterCrash = await readExecution(h.host, round1);
      expect(afterCrash.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
        reconciliation: { status: 'quarantined', observation: { autoCleanupBlockedBy: 'review_round' } } });

      // --- UR5: the Workflow skips this record (no settle, no new round). ---
      const skipped = await h.advance(h.select('k3-09b-skip', AG2B_WORK_TASK_ID));
      expect(skipped.receipts.map(receipt => receipt.kind)).not.toContain('settle_review');
      expect(skipped.steps.some(step => step.reason?.startsWith('unknown_call_review') ?? false)).toBe(true);

      // --- The person attests this round (no record is created). ------------
      const unknown = await readExecution(h.host, round1);
      const attested = await h.post<unknown>('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
        { runRef: round1, reason: 'K3-09 (二): the round is over; a person attests it' }, 'k3-09b-attest',
        [{ ref: round1, revision: unknown.run.revision }]));
      expect(attested).toMatchObject({ status: 'committed' });
      expect(await reviewOf(h, round1)).toEqual({ status: 'not_found' });

      // --- Settle round 1 `unfinished`; round 2 closes it in the same Session.
      const settleStop = await driveReviewUntil(reviewRoot, h.select('k3-09b-settle', AG2B_WORK_TASK_ID),
        performs('settle_review'));
      const settleResult = await reviewRoot.workflow.advanceWork(hostCtx(), settleStop.stopped);
      expect(settleResult).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review' } } });
      const afterRound1 = await reviewOf(h, preparedA.claim.runRef);
      expect(afterRound1.status).toBe('ready');
      if (afterRound1.status !== 'ready') return;
      expect(afterRound1.value).toMatchObject({ status: 'pending_review', activeRound: null });
      expect(afterRound1.value.rounds).toEqual([{ runRef: round1, phase: 'review', round: 1, stateEntry: 1,
        result: 'unfinished' }]);

      // --- The second round claims in the SAME Session as round 1. ----------
      // NOTE (K3-09 (二), reported to the lead): the settle above marks the
      // Session `available` again (the close-open-turn write follows the review
      // settlement), so the Workflow opens the second round directly instead of
      // first closing round 1's open Kernel Turn. The row's
      // `close_open_turn.afterRunRef = round 1` is therefore not asserted here.
      const secondClaim = await driveReviewUntil(reviewRoot, h.select('k3-09b-review2', AG2B_WORK_TASK_ID),
        performs('claim_task'));
      const secondClaimRequest = secondClaim.stopped.kind === 'perform'
        ? (secondClaim.stopped.operation.request as unknown as { input: { sessionRef?: { sessionId: string } } }).input : {};
      expect(secondClaimRequest.sessionRef?.sessionId).toBe(roundSessionId);

      // The blocked tool is released; the ended Run refuses its late result.
      releaseTool();
      await running1?.catch(() => undefined);
    } finally {
      releaseTool();
      await running1?.catch(() => undefined);
      await reviewRoot.close();
    }
  }, 300_000);
});
