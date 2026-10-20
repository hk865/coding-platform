/**
 * K3-29 item 5b (K3-SPEC L27 bullets 2/3; L29 rows 4b/6): the maintenance
 * closure of a retired line whose latest Work Run is a review-purpose Run.
 *
 * - RUN-25: a `shell` call in flight is closed by RUN-25 (`takeover_unresolved`);
 *   the reviewed Session is retired `kernel_turn_open`, has no continuation,
 *   and its latest Run is RUN-25. While a review claim can still run (active
 *   Goal) maintenance leaves the Turn to it; once the record no longer owes a
 *   claim (held) or the Goal is paused (no claim can run), the start-up
 *   maintenance closes the dangling Turn and the Session returns available,
 *   never archived.
 * - RUN-24: the same line, but the latest Run is the review-purpose round the
 *   operator paused and the Host crashed on. A review-purpose Run with a known
 *   ending (RUN-24 here) is closable for maintenance even though its pause
 *   pointer keeps ordinary work open; the Session returns available, not
 *   archived.
 *
 * Scripted model only; no real model call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, readCall, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { crashOneCommand } from './support/review-card-round.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, goalControlPins, readExecution, submitControl } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

// The KE6 stand-in: `reviewCapability` reads `ProcessSandbox.probe` with the
// read-only options; no host process runs.
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
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

/** A direct "I'll handle it" through the public route. */
function holdDirectly(h: HostScenario, review: UnknownCallReviewV1 | null, requestId: string):
Promise<WriteResult<UnknownCallReviewV1>> {
  if (review === null) throw new Error('the review record must read before the hold');
  return h.post<WriteResult<UnknownCallReviewV1>>('unknown-call-reviews/hold', graphWrite(AG2B_SCOPE,
    { reviewRef: review.ref, text: null }, requestId, [{ ref: review.ref, revision: review.revision }]));
}


describe('K3-29 maintenance (L27): a retired line whose latest Run is a review-purpose Run', () => {
  it('K3-29 maintenance RUN-25: the start-up maintenance closes the takeover-unresolved dangling Turn; the Session is available, not archived', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-29-maint-25-shell', select: 'k3-29-maint-25-a',
      requestId: 'k3-29-maint-25-a-start', shellArgs: { command: 'k3-29-maint-25 runs a program' } });
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    try {
      const created = await reviewOf(h, crashed.prepared.claim.runRef);
      expect(created).toMatchObject({ status: 'ready', value: { status: 'pending_review', activeRound: null } });
      if (created.status !== 'ready') throw new Error('the review record must read');
      const read = await readExecution(h.host, crashed.prepared.claim.runRef);
      expect(read.run).toMatchObject({ status: 'ended', outcome: 'crashed',
        reconciliation: { observation: { kind: 'takeover_unresolved' } } });
      // An open review record still owns the next close (the review claim,
      // K L4 / L29 row 8): maintenance leaves the dangling Turn for it.
      expect(read.session).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'unavailable',
        healthConclusion: 'kernel_turn_open' });
      // Once the record no longer owes a review claim, L27 bullet 3 makes the
      // retired RUN-25 line maintenance's: the next start closes the Turn.
      const held = await holdDirectly(h, created.value, 'k3-29-maint-25-hold');
      expect(held).toMatchObject({ status: 'committed', value: { status: 'resolved', activeRound: null } });
      await h.restart({ crash: true });
      const closed = await readExecution(h.host, crashed.prepared.claim.runRef);
      expect(closed.session).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'available',
        healthConclusion: null });
    } finally {
      await crashed.release();
    }
  }, 300_000);

  it('K3-29 maintenance RUN-24: a paused review-purpose round is not covered by the ordinary pause fence; maintenance closes it and the Session is available, not archived', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-29-maint-24-shell', select: 'k3-29-maint-24-a',
      requestId: 'k3-29-maint-24-a-start', shellArgs: { command: 'k3-29-maint-24 runs a program' } });
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    let round: RunRef | null = null;
    let pauseRef: ControlIntentRef | null = null;
    const model = createScriptedModel([readCall('k3-29-maint-24')], async () => {
      if (round === null) throw new Error('the round Run must be known before its model call');
      pauseRef = (await submitControl(h.host, round, 'pause', 'the operator pauses the running review round',
        'k3-29-maint-24-pause')).intent.ref;
    });
    const root = await openReviewWorkRoot(h, model);
    try {
      const created = await reviewOf(h, crashed.prepared.claim.runRef);
      if (created.status !== 'ready') throw new Error('the review record must read');
      const claimStop = await driveReviewUntil(root, h.select('k3-29-maint-24-claim', AG2B_WORK_TASK_ID),
        performs('claim_task'));
      const claim = await root.workflow.advanceWork(hostCtx(), claimStop.stopped);
      if (claim.status !== 'ready' || claim.value.next === null) throw new Error('the review claim must commit');
      const startStop = (await driveReviewUntil(root, claim.value.next, performs('start'))).stopped;
      const prepared = preparedOf(startStop);
      round = prepared.claim.runRef;
      await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-29-maint-24-start' });
      if (pauseRef === null) throw new Error('the pause must have been submitted during the model call');
      const report = await h.restart({ crash: true });
      expect(report.report?.runs.find(row => row.ref === JSON.stringify(round)))
        .toMatchObject({ row: 'W-20', status: 'reconciled', reason: 'interrupted_clean' });
      const reconciled = await readExecution(h.host, round);
      expect(reconciled.run).toMatchObject({ status: 'ended', outcome: 'crashed',
        reconciliation: { observation: { kind: 'interrupted_clean', pausedIntentRef: pauseRef } } });
      // The first start-up left the paused round for UR4: settle_review takes
      // it out of `activeRound` and opens no new round (review_stopped).
      const settled = await h.advance(h.select('k3-29-maint-24-settle', AG2B_WORK_TASK_ID),
        { stopBefore: performs('requeue_task') });
      expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');
      const afterSettle = await reviewOf(h, crashed.prepared.claim.runRef);
      expect(afterSettle).toMatchObject({ status: 'ready', value: { status: 'needs_decision', activeRound: null,
        decisionReasons: expect.arrayContaining(['review_stopped']) } });
      // L27 bullet 3 + D1: a review-purpose Run never takes RUN-25; once it is
      // no longer `activeRound`, maintenance may close its RUN-24 dangling Turn
      // and return the Session to available.
      await h.restart({ crash: true });
      const closed = await readExecution(h.host, round);
      expect(closed.session).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'available',
        healthConclusion: null });
    } finally {
      await root.close();
      await crashed.release();
    }
  }, 300_000);

  it('K3-29 maintenance RUN-25 (paused Goal): a pending record with no review claim left to run does not defer the maintenance close', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-29-maint-25p-shell', select: 'k3-29-maint-25p-a',
      requestId: 'k3-29-maint-25p-a-start', shellArgs: { command: 'k3-29-maint-25p runs a program' } });
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    try {
      const created = await reviewOf(h, crashed.prepared.claim.runRef);
      expect(created).toMatchObject({ status: 'ready', value: { status: 'pending_review', activeRound: null } });
      // The Goal is paused: no advance will claim the review round, so no
      // review claim can close the RUN-25 Turn. L27 bullet 3 makes it
      // maintenance's even though the record is still `pending_review`.
      const paused = await h.post<WriteResult<unknown>>('goals/control', graphWrite(AG2B_SCOPE,
        { goalRef: AG2B_GOAL_REF, control: 'pause', reason: 'no review claim may run now' },
        'k3-29-maint-25p-pause', await goalControlPins(h.host)));
      expect(paused).toMatchObject({ status: 'committed' });
      await h.restart({ crash: true });
      const read = await readExecution(h.host, crashed.prepared.claim.runRef);
      expect(read.run).toMatchObject({ status: 'ended', outcome: 'crashed',
        reconciliation: { observation: { kind: 'takeover_unresolved' } } });
      expect(read.session).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'available',
        healthConclusion: null });
      // The record is untouched by maintenance: it stays pending for the day
      // the Goal resumes, and no claim ran.
      expect(await reviewOf(h, crashed.prepared.claim.runRef))
        .toMatchObject({ status: 'ready', value: { status: 'pending_review', activeRound: null } });
    } finally {
      await crashed.release();
    }
  }, 300_000);
});
