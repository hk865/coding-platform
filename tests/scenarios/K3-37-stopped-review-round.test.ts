/**
 * K3-37 (一)/(二) (L15/L16, spec §3.2 UCR-06b): the operator STOPS the running
 * review round and the round settles `needs_decision` with `review_stopped`,
 * with no second round.
 *
 * - (一) an in-process CANCEL lands at the safe point; the round Run ends
 *   `cancelled` with the operator's cancel as its pointer (`reworkFenceOf`
 *   `human_only`);
 * - (二) the operator PAUSES the round and the Host crashes (RUN-24); the round
 *   Run ends `crashed`/`interrupted_clean` with the pause as its pointer, so the
 *   same `human_only` fence and the same settlement follow.
 *
 * The chain is the real K3-05 one: a `shell` call in flight is closed by RUN-25
 * on a crash restart, leaving a `process` item `pending_review`; a real review
 * root claims and starts the round (round 1) with the read-only grant. The
 * record is read through `unknown-call-reviews/read`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, readCall, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { crashOneCommand } from './support/review-card-round.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readControl, readExecution, submitControl } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

// The KE6 stand-in: `reviewCapability` reads `ProcessSandbox.probe` with the
// read-only options; no host process runs (K3-05's stand-in, unchanged).
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
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

/** L18 option labels, in the frozen order (the card source's literals). */
const FOUR_OPTIONS = [
  { id: 'rerun_as_is', label: '照原样重跑', effect: 'apply' },
  { id: 'safer_method', label: '换个稳妥的跑法再跑', effect: 'apply' },
  { id: 'skip_as_done', label: '跳过，当作已做', effect: 'apply' },
  { id: 'handle_myself', label: '我来处理', effect: 'apply' },
];

/** The stopped record's card really is in the decision queue, readable by key. */
async function expectStoppedReviewCard(h: HostScenario, record: UnknownCallReviewV1): Promise<void> {
  const queue = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer', 'history'], page: { limit: 100 } }));
  if (queue.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(queue)}`);
  const cards = queue.value.waitingAnswer.filter(card => card.source.kind === 'unknown_call_review');
  expect(cards).toHaveLength(1);
  const card: DecisionCardV1 = cards[0]!;
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  expect(card.source.key).toBe(key);
  expect(card.state).toBe('waiting_answer');
  // One process item -> proposalTargets present -> the four L18 options.
  expect(card.options).toEqual(FOUR_OPTIONS);
  // The mixed line is not applicable (no platform item).
  expect(card.objects).toEqual([{ kind: 'aggregate', pin: { ref: record.ref, revision: record.revision },
    label: `核对记录 ${record.runRef.runId.slice(0, 8)}：需要你决定` }]);
  expect(card.closedReason).toBeNull();
  expect(card.readOnly).toBe(false);
  expect(card.actions).toEqual(['answer']);
  const byKey = await h.post<ReadResult<DecisionCardV1>>('decisions/card',
    plain(AG2B_SCOPE, { source: card.source }));
  expect(byKey).toMatchObject({ status: 'ready', value: { state: 'waiting_answer',
    source: { kind: 'unknown_call_review', key }, options: FOUR_OPTIONS } });
}

/** Claims and prepares the real review round, returning the start request and its Run. */
describe('K3-37 (一) stopped review round', () => {
  it('K3-37 (一): an in-process cancel of the running review round settles needs_decision with review_stopped and opens no second round', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-37-a-shell', select: 'k3-37-a',
      requestId: 'k3-37-a-start', shellArgs: { command: 'k3-37 A runs a program' } });
    await crashed.release();
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    const created = await reviewOf(h, crashed.runRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') throw new Error(JSON.stringify(created));
    expect(created.value).toMatchObject({ status: 'pending_review', decisionReasons: [], activeRound: null });
    expect(created.value.items).toHaveLength(1);
    expect(created.value.items[0]).toMatchObject({ kind: 'process', observed: { verdict: 'pending', by: null } });
    const preparedA = crashed.prepared;

    // --- The review round starts for real; the operator cancels it mid-round.
    let roundRunRef: RunRef | null = null;
    let cancelRef: ControlIntentRef | null = null;
    const modelReview = createScriptedModel(
      [readCall('k3-37-review')],
      async () => {
        if (roundRunRef === null) throw new Error('the review round Run must be known before its model call');
        // The operator's cancel reaches the running review round at the safe point
        // after this model call's read tool group (the C8 pattern).
        cancelRef = (await submitControl(h.host, roundRunRef, 'cancel',
          'the operator cancels the review round', 'k3-37-cancel')).intent.ref;
      });
    const reviewRoot = await openReviewWorkRoot(h, modelReview);
    try {
      const claimStop = await driveReviewUntil(reviewRoot, h.select('k3-37-review', AG2B_WORK_TASK_ID),
        performs('claim_task'));
      expect(claimStop.stopped.kind).toBe('perform');
      if (claimStop.stopped.kind !== 'perform' || claimStop.stopped.operation.kind !== 'claim_task') {
        throw new Error('the review claim step was expected');
      }
      const startStop = await driveReviewUntil(reviewRoot, claimStop.stopped, performs('start'));
      expect(startStop.receipts.map(receipt => receipt.kind)).toEqual(['claim_task', 'prepare']);
      const prepared = preparedOf(startStop.stopped);
      expect(prepared.claim.runRef.runId).not.toBe(preparedA.claim.runRef.runId);
      roundRunRef = prepared.claim.runRef;

      await reviewRoot.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-37-review-start' });
      if (cancelRef === null) throw new Error('the cancel must have been submitted during the model call');
      // The round Run ends on the operator's cancel; the pointer is the cancel.
      const ended = await readExecution(h.host, roundRunRef);
      expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled',
        controlState: { intentRef: cancelRef, desiredState: 'cancelled' } });
      expect(await readControl(h.host, cancelRef)).toMatchObject({ kind: 'cancel', status: 'applied' });

      // --- settle_review: review_stopped, needs_decision, no check round. -----
      const settled = await h.advance(h.select('k3-37-settle', AG2B_WORK_TASK_ID),
        { stopBefore: performs('requeue_task') });
      const kinds = settled.receipts.map(receipt => receipt.kind);
      expect(kinds).toContain('settle_review');
      expect(kinds).not.toContain('open_checks');
      expect(kinds).not.toContain('finalize_checks');

      const record = await reviewOf(h, preparedA.claim.runRef);
      expect(record.status).toBe('ready');
      if (record.status !== 'ready') return;
      expect(record.value.status).toBe('needs_decision');
      expect(record.value.decisionReasons).toEqual(['review_stopped', 'undetermined', 'crash_undetermined']);
      expect(record.value.decisionReasons).toContain('review_stopped');
      expect(record.value.activeRound).toBeNull();
      expect(record.value.rounds).toHaveLength(1);
      expect(record.value.rounds[0]).toMatchObject({ result: 'stopped', round: 1 });
      // The stopped record's card is in the queue (L18).
      await expectStoppedReviewCard(h, record.value);

      // --- NO second review round opens: the record stays one stopped round.
      const again = await h.advance(h.select('k3-37-again', AG2B_WORK_TASK_ID));
      const reviewClaims = again.steps
        .flatMap(step => step.next !== null && step.next.kind === 'perform' && step.next.operation.kind === 'claim_task'
          ? [(step.next.operation.request.input as { review?: unknown }).review] : []);
      expect(reviewClaims.every(review => review === undefined)).toBe(true);
      const after = await reviewOf(h, preparedA.claim.runRef);
      expect(after.status).toBe('ready');
      if (after.status !== 'ready') return;
      expect(after.value).toMatchObject({ status: 'needs_decision', activeRound: null,
        decisionReasons: ['review_stopped', 'undetermined', 'crash_undetermined'] });
      expect(after.value.rounds).toHaveLength(1);
      expect(after.value.rounds[0]).toMatchObject({ result: 'stopped', round: 1 });
    } finally {
      await reviewRoot.close();
    }
  }, 240_000);

  it('K3-37 (二): a paused review round ended by the Host crash (RUN-24) settles needs_decision with review_stopped and opens no second round', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-37b-a-shell', select: 'k3-37b-a',
      requestId: 'k3-37b-a-start', shellArgs: { command: 'k3-37b A runs a program' } });
    await crashed.release();
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    const created = await reviewOf(h, crashed.runRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') throw new Error(JSON.stringify(created));
    expect(created.value).toMatchObject({ status: 'pending_review', decisionReasons: [], activeRound: null });
    expect(created.value.items).toHaveLength(1);
    expect(created.value.items[0]).toMatchObject({ kind: 'process', observed: { verdict: 'pending', by: null } });
    const preparedA = crashed.prepared;

    // --- The review round starts; the operator pauses it at the safe point. --
    let roundRunRef: RunRef | null = null;
    let pauseRef: ControlIntentRef | null = null;
    const modelReview = createScriptedModel(
      [readCall('k3-37b-review')],
      async () => {
        if (roundRunRef === null) throw new Error('the review round Run must be known before its model call');
        pauseRef = (await submitControl(h.host, roundRunRef, 'pause',
          'the operator pauses the review round', 'k3-37b-pause')).intent.ref;
      });
    const reviewRoot = await openReviewWorkRoot(h, modelReview);
    let report: Awaited<ReturnType<HostScenario['restart']>>;
    try {
      const claimStop = await driveReviewUntil(reviewRoot, h.select('k3-37b-review', AG2B_WORK_TASK_ID),
        performs('claim_task'));
      if (claimStop.stopped.kind !== 'perform' || claimStop.stopped.operation.kind !== 'claim_task') {
        throw new Error('the review claim step was expected');
      }
      const startStop = await driveReviewUntil(reviewRoot, claimStop.stopped, performs('start'));
      const prepared = preparedOf(startStop.stopped);
      roundRunRef = prepared.claim.runRef;

      await reviewRoot.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-37b-review-start' });
      if (pauseRef === null) throw new Error('the pause must have been submitted during the model call');
      // The pause landed at the safe point after the tool group (RUN-24's precondition).
      const paused = await readExecution(h.host, roundRunRef);
      expect(paused.run).toMatchObject({ status: 'running',
        controlState: { intentRef: pauseRef, desiredState: 'paused' } });
      expect(await readControl(h.host, pauseRef)).toMatchObject({ kind: 'pause', status: 'applied',
        observation: { kind: 'paused' } });

      // --- The crash restart ends the paused round RUN-24. --------------------
      report = await h.restart({ crash: true });
      const reviewed = report.report?.runs.find(row => row.ref === JSON.stringify(roundRunRef));
      expect(reviewed, JSON.stringify(report.report?.runs)).toMatchObject({ row: 'W-20', status: 'reconciled',
        reason: 'interrupted_clean' });
      const reconciled = await readExecution(h.host, roundRunRef);
      expect(reconciled.run).toMatchObject({ status: 'ended', outcome: 'crashed',
        reconciliation: { status: 'done', observation: { kind: 'interrupted_clean', kernelPaused: true,
          pausedIntentRef: pauseRef } } });

      // --- settle_review: review_stopped, needs_decision, no second round. ----
      const settled = await h.advance(h.select('k3-37b-settle', AG2B_WORK_TASK_ID),
        { stopBefore: performs('requeue_task') });
      const kinds = settled.receipts.map(receipt => receipt.kind);
      expect(kinds).toContain('settle_review');
      expect(kinds).not.toContain('open_checks');
      const record = await reviewOf(h, preparedA.claim.runRef);
      expect(record.status).toBe('ready');
      if (record.status !== 'ready') return;
      expect(record.value.status).toBe('needs_decision');
      expect(record.value.decisionReasons).toEqual(['review_stopped', 'undetermined', 'crash_undetermined']);
      expect(record.value.activeRound).toBeNull();
      expect(record.value.rounds).toHaveLength(1);
      expect(record.value.rounds[0]).toMatchObject({ result: 'stopped', round: 1 });
      // The stopped record's card is in the queue (L18).
      await expectStoppedReviewCard(h, record.value);
    } finally {
      await reviewRoot.close();
    }
  }, 240_000);

});
