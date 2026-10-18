/**
 * K3-05 (L10–L16, spec §5.2): the REAL end-to-end chain of A–F. A work Run with
 * a `shell` call in flight is reconciled by RUN-25 (`W-26`, `takeover_unresolved`)
 * with its Kernel call still unresolved; its record is `pending_review` with a
 * `process` item. The Workflow then opens the review round for real:
 *
 * - the claim is the fourth basis `review` (the request carries `review`, and the
 *   Run's trusted `purpose` is `unknown_call_review`/`review`/round 1);
 * - the prepared permissions are exactly the L13 tool set and `writeScope: []`,
 *   while the Task projection stays the failed one;
 * - the round starts on a read-only-capable composition root (the KE6 probe
 *   stand-in, no host process) with a scripted `record_unknown_call_review`;
 * - after the round ends the next step is `settle_review` (never `open_checks`),
 *   the check owner created no round for the review Run, and the record settles
 *   `resolved` with empty `decisionReasons`;
 * - the conclusion comes back through `unknown-call-reviews/read`;
 * - the original Run's `unresolvedToolCallIds` still names the shell call, the
 *   Task is not completed, and the lease was last released by the review round.
 *
 * The scenario drives every Workflow step itself (`resumeOnStartup: false`); the
 * review root (./support/review-work-root.ts) carries the read-only command
 * grant so `reviewCapability` answers `available`. Scripted model only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

// The KE6 stand-in: `reviewCapability` reads `ProcessSandbox.probe` with the
// read-only options; no host process runs. The general (process) probe stays
// `unavailable` exactly as a bwrap-less host, so the shell seam's stand-in is
// not made to await the real resource-capability canary.
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

// --- The shell seam (A's process call) ------------------------------------
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

describe('K3-05 the review round really runs and settles', () => {
  it('K3-05: RUN-25 leaves a process item pending; the review claim, the prepared L13 tools and the Run purpose are real; the round records done/unlikely, settle_review (no open_checks) resolves the record and the round releases the lease', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });

    // --- A: a `shell` call in flight, closed by RUN-25. ----------------------
    shellSeam.arm();
    const modelA = createScriptedModel([{ kind: 'calls', calls: [
      { callId: 'k3-05-a-shell', name: 'shell', args: { command: 'k3-05 A runs a program' } }] }]);
    const rootA = await openShellWorkRoot(h, modelA);
    let runningA: Promise<unknown> | null = null;
    let reportA: Awaited<ReturnType<HostScenario['restart']>>;
    let preparedA: ReturnType<typeof preparedOf>;
    try {
      const startA = await prepareOn(rootA, h.select('k3-05-a', AG2B_WORK_TASK_ID));
      preparedA = preparedOf(startA);
      runningA = rootA.runtime.startRun(hostCtx(), { prepared: preparedA, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-05-a-start' });
      await shellSeam.waitForCall();
      reportA = await h.restart({ crash: true });
    } finally {
      shellSeam.release();
      await runningA?.catch(() => undefined);
      await rootA.close();
    }
    expect(reportA).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(preparedA.claim.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });

    const created = await reviewOf(h, preparedA.claim.runRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(created.value).toMatchObject({ status: 'pending_review', decisionReasons: [], activeRound: null });
    expect(created.value.items).toHaveLength(1);
    expect(created.value.items[0]).toMatchObject({ kind: 'process', observed: { verdict: 'pending', by: null } });

    // --- The review round is opened for real (UR1): claim basis `review`. ----
    const modelReview = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-05-review-conclusion', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'the shell call reached its end before the crash',
          crashSuspicion: { verdict: 'unlikely', evidence: 'the command itself leaves no crash trace' } } }] },
      { kind: 'text', text: 'the review round wrote its conclusion' },
    ]);
    const reviewRoot = await openReviewWorkRoot(h, modelReview);
    try {
      const claimStop = await driveReviewUntil(reviewRoot, h.select('k3-05-review', AG2B_WORK_TASK_ID),
        performs('claim_task'));
      expect(claimStop.stopped.kind).toBe('perform');
      if (claimStop.stopped.kind !== 'perform' || claimStop.stopped.operation.kind !== 'claim_task') {
        throw new Error('the review claim step was expected');
      }
      expect(claimStop.stopped.operation.request.input.review).toMatchObject({ phase: 'review' });

      const startStop = await driveReviewUntil(reviewRoot, claimStop.stopped, performs('start'));
      expect(startStop.receipts.map(receipt => receipt.kind)).toEqual(['claim_task', 'prepare']);
      const prepared = preparedOf(startStop.stopped);
      expect(prepared.claim.runRef.runId, 'the review round is a new Run').not.toBe(preparedA.claim.runRef.runId);
      expect(prepared.envelope.permissions.tools).toEqual(['read', 'run_readonly_command', 'record_unknown_call_review']);
      expect(prepared.envelope.permissions.writeScope).toEqual([]);

      const roundRunRef = prepared.claim.runRef;
      const starting = await readExecution(h.host, roundRunRef);
      expect(starting.run).toMatchObject({ status: 'starting',
        purpose: { kind: 'unknown_call_review', phase: 'review', round: 1, reviewRef: { runId: preparedA.claim.runRef.runId } } });
      expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed',
        execution: { runId: preparedA.claim.runRef.runId } });

      // --- The round starts, writes its conclusion and ends `completed`. -----
      await reviewRoot.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-05-review-start' });
      const ended = await readExecution(h.host, roundRunRef);
      expect(ended.run).toMatchObject({ status: 'ended', outcome: 'completed' });
      const concluded = await reviewOf(h, preparedA.claim.runRef);
      expect(concluded.status).toBe('ready');
      if (concluded.status !== 'ready') return;
      expect(concluded.value.status).toBe('pending_review');
      expect(concluded.value.items[0]!.observed).toMatchObject({ verdict: 'done', by: 'review_round',
        crashSuspicion: { verdict: 'unlikely' }, roundRunRef: { runId: roundRunRef.runId } });

      // --- settle_review, never open_checks; the check owner opened nothing. -
      const settled = await h.advance(h.select('k3-05-settle', AG2B_WORK_TASK_ID), { stopBefore: performs('requeue_task') });
      const kinds = settled.receipts.map(receipt => receipt.kind);
      expect(kinds).toContain('settle_review');
      expect(kinds).not.toContain('open_checks');
      expect(kinds).not.toContain('finalize_checks');
      expect(reviewRoot.evidence.queryRoundChainHead).toBeDefined();
      const chainHead = await reviewRoot.evidence.queryRoundChainHead!(hostCtx(), {
        subject: prepared.claim.task, subjectRunRef: roundRunRef });
      expect(chainHead.status).toBe('not_found');

      // --- The record settles `resolved`; the conclusion reads back. --------
      const resolved = await reviewOf(h, preparedA.claim.runRef);
      expect(resolved.status).toBe('ready');
      if (resolved.status !== 'ready') return;
      expect(resolved.value).toMatchObject({ status: 'resolved', decisionReasons: [], activeRound: null });
      expect(resolved.value.rounds).toHaveLength(1);
      expect(resolved.value.items[0]!.observed).toMatchObject({ verdict: 'done', by: 'review_round',
        crashSuspicion: { verdict: 'unlikely' } });

      // --- The original Kernel call stays unresolved; the Task is not done. --
      // RUN-25 leaves the original Run `crashed` with a `takeover_unresolved`
      // observation whose `unresolvedToolCallIds` still names A's shell call; the
      // review round's `done` verdict does not rewrite the Kernel or the Task.
      const original = await readExecution(h.host, preparedA.claim.runRef);
      expect(original.run).toMatchObject({ status: 'ended', outcome: 'crashed',
        reconciliation: { status: 'done', observation: { kind: 'takeover_unresolved',
          unresolvedToolCallIds: ['k3-05-a-shell'] } } });
      expect(await h.taskRow()).toMatchObject({ effectivePhase: 'failed' });

      // --- The lease was last released by the review round. -----------------
      expect(original.lease?.release?.runRef.runId).toBe(roundRunRef.runId);
    } finally {
      await reviewRoot.close();
    }
  }, 180_000);
});
