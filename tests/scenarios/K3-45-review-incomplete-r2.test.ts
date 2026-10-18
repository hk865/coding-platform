/**
 * K3-45 (一) R2 (L9/L15/L16/L17, spec line 1438; ruling 4; Codex finding 1):
 * the L9 "second unfinished review round in one `stateEntry`" is proven
 * through the real R2 chain, not from pre-set state.
 *
 * A real `shell` call left in flight is closed by RUN-25 (`pending_review`,
 * one `process` item). Then, twice:
 *
 * 1. the Workflow really claims and prepares the round;
 * 2. the scripted review model writes `done` / `unlikely` for the item through
 *    the real `record_unknown_call_review` tool;
 * 3. the round is interrupted with NO call in flight, using the K3-37 (三)
 *    pattern: the Goal is paused during a later model call (the fan-out
 *    `pausedIntentRef`), then the Host crashes, so the round Run is reconciled
 *    `interrupted_clean` and `settle_review` records it `unfinished`;
 * 4. the round settles through its own `settleReviewAfterRun` while the Goal is
 *    paused.
 *
 * After round 1 the record is still `pending_review` with one `unfinished`
 * round and the conclusion preserved; the Goal resumes and round 2 opens. After
 * round 2 — although every item already carries a conclusion — the record is
 * `needs_decision` with `decisionReasons` exactly `['review_incomplete']`,
 * `rounds` `['unfinished', 'unfinished']`, and the conclusion untouched
 * (`by: 'review_round'`). The record is read ONLY through
 * `unknown-call-reviews/read`.
 *
 * Scripted model only; the read-only capability is the KE6 probe stand-in and
 * `shell` is the blocking seam (no host process). The card/disposition part of
 * the row is group 4.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, readCall, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { createScriptedModel, type ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readControl, readExecution } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { goalControl } from './support/control.js';
import { GOAL_FAN_OUT_ACTOR } from '../../src/contracts/task-requeue.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

// The KE6 stand-in: `reviewCapability` reads `ProcessSandbox.probe` with the
// read-only options; no host process runs.
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

// The blocking `shell` stand-in (K3 §5.1): keeps the call in flight until the crash.
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

/** The two-unfinished-rounds record's card is in the queue (L18). */
async function expectReviewIncompleteCard(h: HostScenario, record: UnknownCallReviewV1): Promise<void> {
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
  const aggregate = card.objects.filter(object => object.kind === 'aggregate');
  expect(aggregate).toEqual([{ kind: 'aggregate', pin: { ref: record.ref, revision: record.revision },
    label: `核对记录 ${record.runRef.runId.slice(0, 8)}：需要你决定` }]);
  expect(card.closedReason).toBeNull();
  expect(card.readOnly).toBe(false);
  expect(card.actions).toEqual(['answer']);
  const pinned = await h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read',
    plain(AG2B_SCOPE, { ref: card.source.pins[0]!.ref }));
  expect(pinned).toMatchObject({ status: 'ready', value: { revision: card.source.pins[0]!.revision,
    status: 'needs_decision', decisionReasons: ['review_incomplete'],
    rounds: [{ result: 'unfinished' }, { result: 'unfinished' }] } });
}

/** One `shell` call in flight, closed by RUN-25 on the crash restart; returns the original RunRef. */
async function crashOneCommand(h: HostScenario, label: string): Promise<RunRef> {
  shellSeam.arm();
  const modelA = createScriptedModel([{ kind: 'calls', calls: [
    { callId: `${label}-shell`, name: 'shell', args: { command: `${label} runs a program` } }] }]);
  const rootA = await openShellWorkRoot(h, modelA);
  let runningA: Promise<unknown> | null = null;
  let preparedA: ReturnType<typeof preparedOf>;
  try {
    const startA = await prepareOn(rootA, h.select(`${label}-a`, AG2B_WORK_TASK_ID));
    preparedA = preparedOf(startA);
    runningA = rootA.runtime.startRun(hostCtx(), { prepared: preparedA, consumerId: AG2B_CONSUMER_ID,
      requestId: `${label}-a-start` });
    await shellSeam.waitForCall();
    await h.restart({ crash: true });
  } finally {
    shellSeam.release();
    await runningA?.catch(() => undefined);
    await rootA.close();
  }
  return preparedA.claim.runRef;
}

describe('K3-45 (一) review_incomplete through the real two-round R2 chain', () => {
  it('K3-45 (一) R2: two rounds that each wrote every conclusion then were interrupted with no call in flight settle needs_decision with exactly review_incomplete', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });

    const originalRunRef = await crashOneCommand(h, 'k3-45-r2');
    const created = await reviewOf(h, originalRunRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(created.value).toMatchObject({ status: 'pending_review', decisionReasons: [], activeRound: null });
    expect(created.value.items).toHaveLength(1);
    expect(created.value.items[0]).toMatchObject({ alias: 1, kind: 'process',
      observed: { verdict: 'pending', by: null } });

    // Each round: write `done` / `unlikely` through the real tool, then a second
    // model call where the Goal pause lands at its safe point (K3-37 (三)).
    const writeDone = (round: number): ScriptedReply =>
      ({ kind: 'calls', calls: [{ callId: `k3-45-r2-write-${String(round)}`, name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: `K3-45 round ${String(round)} the shell call reached its end`,
          crashSuspicion: { verdict: 'unlikely', evidence: `K3-45 round ${String(round)} no crash trace` } } }] });
    const pauses: Array<ControlIntentRef | null> = [];
    const modelReview = createScriptedModel(
      [writeDone(1), readCall('k3-45-r2-r1-pause'), writeDone(2), readCall('k3-45-r2-r2-pause')],
      async (_request, index) => {
        // The write call runs with no control pending; the following model call
        // is where the Goal pause lands at its safe point.
        if (index % 2 === 0) return;
        const paused = await goalControl(h.host, 'pause', `k3-45-r2-goal-pause-${String(pauses.length + 1)}`);
        if (paused.status !== 'committed') throw new Error(`goal pause: ${JSON.stringify(paused)}`);
        pauses.push(paused.value.fanOut.runs.find(entry => entry.outcome === 'submitted')?.intentRef ?? null);
      });
    const reviewRoot = await openReviewWorkRoot(h, modelReview);
    try {
      // --- Round 1: claim, start, write done, pause the GOAL, crash, settle. --
      const startStop1 = await driveReviewUntil(reviewRoot, h.select('k3-45-r2-r1', AG2B_WORK_TASK_ID),
        performs('start'));
      expect(startStop1.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining(['claim_task', 'prepare']));
      const prepared1 = preparedOf(startStop1.stopped);
      const roundRunRef1 = prepared1.claim.runRef;
      expect(roundRunRef1.runId).not.toBe(originalRunRef.runId);
      await reviewRoot.runtime.startRun(hostCtx(), { prepared: prepared1, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-45-r2-r1-start' });
      expect(pauses, 'the Goal pause was submitted during round 1\'s model call').toHaveLength(1);
      expect(pauses[0]).not.toBeNull();
      const pause1 = pauses[0];
      if (pause1 === null || pause1 === undefined) throw new Error('round 1 must point at the fan-out pause intent');

      // The round is running and paused by the Goal fan-out.
      expect((await readExecution(h.host, roundRunRef1)).run).toMatchObject({ status: 'running',
        controlState: { intentRef: pause1, desiredState: 'paused' } });
      expect(await readControl(h.host, pause1)).toMatchObject({ kind: 'pause', status: 'applied',
        requestedBy: { ...GOAL_FAN_OUT_ACTOR } });
      // The conclusion really reached the record through the round-1 tool call.
      expect(await reviewOf(h, originalRunRef)).toMatchObject({ status: 'ready', value: {
        status: 'pending_review', activeRound: { phase: 'review', round: 1 },
        items: [{ observed: { verdict: 'done', by: 'review_round', roundRunRef: roundRunRef1,
          crashSuspicion: { verdict: 'unlikely' } } }] } });

      // The crash restart ends the paused round RUN-24 with the fan-out pointer.
      expect((await h.restart({ crash: true })).report?.runs.find(row => row.ref === JSON.stringify(roundRunRef1)))
        .toMatchObject({ row: 'W-20', status: 'reconciled', reason: 'interrupted_clean' });
      expect((await readExecution(h.host, roundRunRef1)).run).toMatchObject({ status: 'ended', outcome: 'crashed',
        reconciliation: { status: 'done', observation: { kind: 'interrupted_clean', kernelPaused: true,
          pausedIntentRef: pause1 } } });

      // settle_review records the FIRST unfinished round; the Goal is paused, so
      // the round settles through its own settleReviewAfterRun.
      const settleStop1 = await driveReviewUntil(reviewRoot, startStop1.stopped, performs('settle_review'));
      expect(await reviewRoot.workflow.advanceWork(hostCtx(), settleStop1.stopped))
        .toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review' } } });
      const afterRound1 = await reviewOf(h, originalRunRef);
      expect(afterRound1.status).toBe('ready');
      if (afterRound1.status !== 'ready') return;
      expect(afterRound1.value).toMatchObject({ status: 'pending_review', activeRound: null, decisionReasons: [] });
      expect(afterRound1.value.rounds).toHaveLength(1);
      expect(afterRound1.value.rounds[0]).toMatchObject({ result: 'unfinished', round: 1, stateEntry: 1 });
      // The round-1 conclusion is preserved verbatim (settlement did not re-judge it).
      expect(afterRound1.value.items).toHaveLength(1);
      expect(afterRound1.value.items[0]?.observed).toMatchObject({ verdict: 'done', by: 'review_round',
        roundRunRef: roundRunRef1, evidence: 'K3-45 round 1 the shell call reached its end' });

      // --- Round 2 after the Goal resumes: same chain, then final settlement. -
      expect(await goalControl(h.host, 'resume', 'k3-45-r2-goal-resume')).toMatchObject({ status: 'committed' });
      const startStop2 = await driveReviewUntil(reviewRoot, h.select('k3-45-r2-r2', AG2B_WORK_TASK_ID),
        performs('start'));
      expect(startStop2.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining(['claim_task', 'prepare']));
      const prepared2 = preparedOf(startStop2.stopped);
      const roundRunRef2 = prepared2.claim.runRef;
      expect(roundRunRef2.runId).not.toBe(roundRunRef1.runId);
      await reviewRoot.runtime.startRun(hostCtx(), { prepared: prepared2, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-45-r2-r2-start' });
      expect(pauses, 'the Goal pause was submitted during round 2\'s model call').toHaveLength(2);
      expect(pauses[1]).not.toBeNull();
      const pause2 = pauses[1];
      if (pause2 === null) throw new Error('round 2 must point at the fan-out pause intent');
      expect((await readExecution(h.host, roundRunRef2)).run).toMatchObject({ status: 'running',
        controlState: { intentRef: pause2, desiredState: 'paused' } });
      // Round 2's conclusion really reached the record through the tool.
      expect(await reviewOf(h, originalRunRef)).toMatchObject({ status: 'ready', value: {
        status: 'pending_review', activeRound: { phase: 'review', round: 2 },
        items: [{ observed: { verdict: 'done', by: 'review_round', roundRunRef: roundRunRef2,
          evidence: 'K3-45 round 2 the shell call reached its end' } }] } });

      expect((await h.restart({ crash: true })).report?.runs.find(row => row.ref === JSON.stringify(roundRunRef2)))
        .toMatchObject({ row: 'W-20', status: 'reconciled', reason: 'interrupted_clean' });
      expect((await readExecution(h.host, roundRunRef2)).run).toMatchObject({ status: 'ended', outcome: 'crashed',
        reconciliation: { status: 'done', observation: { kind: 'interrupted_clean', kernelPaused: true,
          pausedIntentRef: pause2 } } });
      const settleStop2 = await driveReviewUntil(reviewRoot, startStop2.stopped, performs('settle_review'));
      expect(await reviewRoot.workflow.advanceWork(hostCtx(), settleStop2.stopped))
        .toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review' } } });

      // --- Final record: needs_decision / review_incomplete although every ----
      // --- item carries a conclusion; two unfinished rounds. -----------------
      const record = await reviewOf(h, originalRunRef);
      expect(record.status).toBe('ready');
      if (record.status !== 'ready') return;
      expect(record.value.status).toBe('needs_decision');
      expect(record.value.activeRound).toBe(null);
      expect(record.value.decisionReasons).toEqual(['review_incomplete']);
      expect(record.value.rounds.map(round => round.result)).toEqual(['unfinished', 'unfinished']);
      expect(record.value.rounds.map(round => round.round)).toEqual([1, 2]);
      expect(record.value.rounds.map(round => round.stateEntry)).toEqual([1, 1]);
      // The conclusion is untouched: the item still bears round 2's write verbatim.
      expect(record.value.items).toHaveLength(1);
      expect(record.value.items[0]?.observed).toMatchObject({ verdict: 'done', by: 'review_round',
        roundRunRef: roundRunRef2, evidence: 'K3-45 round 2 the shell call reached its end',
        crashSuspicion: { verdict: 'unlikely' } });
      // The `review_incomplete` record's card is in the queue, not a second round.
      await expectReviewIncompleteCard(h, record.value);
    } finally {
      await reviewRoot.close();
    }
  }, 300_000);
});
