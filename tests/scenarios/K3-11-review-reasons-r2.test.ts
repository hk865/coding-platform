/**
 * K3-11 R2 (L17/L23, spec line 1425; ruling 4; Codex finding 1): the L17
 * reasons really reach settlement through the Workflow, not from owner-level
 * pre-set state.
 *
 * - `confirm_each_step`: the scenario Goal's autonomy is set to `every_step`
 *   through the real `goals/settings/set` route, then the K3-05 chain runs for
 *   real: a `shell` call left in flight is closed by RUN-25
 *   (`pending_review`), a scripted review round records `done` / `unlikely`
 *   and ends, `settle_review` commits, and the record — read only through
 *   `unknown-call-reviews/read` — carries exactly `['confirm_each_step']`.
 * - three reasons at once: two review rounds each write `partial` through the
 *   real `record_unknown_call_review` tool, then the Goal is paused mid-call
 *   and the Host crashes (the K3-37 (三) pattern) so each round records
 *   `unfinished` with no call in flight; `every_step` plus the surviving
 *   `partial` yields `['review_incomplete', 'partial', 'confirm_each_step']`.
 * - `second_consecutive` on the real continuation chain: Work Run A ends by
 *   RUN-25 and settles `resolved`; its continuation B is blocked by
 *   `second_auto_cleanup` (RUN-20(i)) and attested through
 *   `executions/resolve-unknown`; B's own round settles `second_consecutive`.
 *
 * Scripted model only; the read-only capability is the KE6 probe stand-in and
 * `shell` is the blocking seam (no host process). The card/disposition parts of
 * the row are group 4.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, readCall, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readExecution, readGoal } from '../helpers/A2-restart-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { goalControl } from './support/control.js';
import { readGoalSettings } from '../../src/core/work-graph/persistence/record-codecs.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';

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

/** The K3-11 card part: the public decision queue on the same Host/world. */
function queueOf(h: HostScenario): Promise<DecisionQueueReadV1> {
  return h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer'], page: { limit: 100 } }))
    .then((read) => {
      if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
      return read.value;
    });
}

function cardOf(queue: DecisionQueueReadV1, record: UnknownCallReviewV1): DecisionCardV1 | undefined {
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  return queue.waitingAnswer.find(card => card.source.key === key);
}

/** The L18 four-option card of a `needs_decision` process-item record, in the queue and available. */
async function expectReviewCard(h: HostScenario, record: UnknownCallReviewV1): Promise<void> {
  const queue = await queueOf(h);
  const card = cardOf(queue, record);
  expect(card, 'the needs_decision record has its card').toBeDefined();
  expect(card).toMatchObject({ state: 'waiting_answer', readOnly: false, actions: ['answer'],
    source: { kind: 'unknown_call_review', goalRef: { goalId: AG2B_GOAL_REF.goalId } },
    options: [{ id: 'rerun_as_is' }, { id: 'safer_method' }, { id: 'skip_as_done' }, { id: 'handle_myself' }] });
  expect(queue.capabilities).toContainEqual({ source: 'unknown_call_review', availability: 'available' });
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

describe('K3-11 confirm_each_step through a real review round', () => {
  it('K3-11 R2: with the Goal autonomy every_step a full review round settles with exactly confirm_each_step', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });

    // The real `goals/settings/set` route: `every_step` is read back from the
    // stored Goal, so the settlement's own read sees it too.
    const before = await readGoal(h.host);
    const set = await h.post<WriteResult<GoalSnapshot>>('goals/settings/set', graphWrite(AG2B_SCOPE, {
      goalRef: AG2B_GOAL_REF, autonomy: 'every_step', waitForGoalRef: null,
    }, 'k3-11-set-autonomy', [{ ref: AG2B_GOAL_REF, revision: before.revision }]));
    expect(set).toMatchObject({ status: 'committed' });
    expect(readGoalSettings(await readGoal(h.host)).autonomy).toBe('every_step');

    const originalRunRef = await crashOneCommand(h, 'k3-11-confirm');
    const created = await reviewOf(h, originalRunRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(created.value).toMatchObject({ status: 'pending_review', decisionReasons: [], activeRound: null });
    expect(created.value.items).toHaveLength(1);
    expect(created.value.items[0]).toMatchObject({ alias: 1, kind: 'process' });

    const modelReview = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-11-confirm-conclusion', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'K3-11 the shell call reached its end',
          crashSuspicion: { verdict: 'unlikely', evidence: 'K3-11 the command leaves no crash trace' } } }] },
      { kind: 'text', text: 'K3-11 confirm review round wrote its conclusion' },
    ]);
    const reviewRoot = await openReviewWorkRoot(h, modelReview);
    try {
      const startStop = await driveReviewUntil(reviewRoot, h.select('k3-11-confirm-review', AG2B_WORK_TASK_ID),
        performs('start'));
      const prepared = preparedOf(startStop.stopped);
      await reviewRoot.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-11-confirm-review-start' });

      // `settle_review` runs here. The record is `needs_decision` afterwards, so
      // the Workflow never requeues the original Task; stop before it anyway.
      const settled = await h.advance(h.select('k3-11-confirm-settle', AG2B_WORK_TASK_ID),
        { stopBefore: performs('requeue_task') });
      expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');

      const record = await reviewOf(h, originalRunRef);
      expect(record.status).toBe('ready');
      if (record.status !== 'ready') return;
      expect(record.value.status).toBe('needs_decision');
      expect(record.value.activeRound).toBe(null);
      expect(record.value.decisionReasons).toEqual(['confirm_each_step']);
      await expectReviewCard(h, record.value);
    } finally {
      await reviewRoot.close();
    }
  }, 240_000);
});

describe('K3-11 three reasons through the real two-round chain', () => {
  it('K3-11 R2: every_step plus two unfinished rounds that each wrote partial settles review_incomplete, partial, confirm_each_step in L17 order', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });

    // The real `goals/settings/set` route: `every_step` is read back at settlement.
    const before = await readGoal(h.host);
    expect(await h.post<WriteResult<GoalSnapshot>>('goals/settings/set', graphWrite(AG2B_SCOPE, {
      goalRef: AG2B_GOAL_REF, autonomy: 'every_step', waitForGoalRef: null,
    }, 'k3-11-three-set-autonomy', [{ ref: AG2B_GOAL_REF, revision: before.revision }])))
      .toMatchObject({ status: 'committed' });
    expect(readGoalSettings(await readGoal(h.host)).autonomy).toBe('every_step');

    const originalRunRef = await crashOneCommand(h, 'k3-11-three');
    const created = await reviewOf(h, originalRunRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(created.value).toMatchObject({ status: 'pending_review', decisionReasons: [], activeRound: null });

    // Rounds 1 and 2 each: the scripted review model first writes `partial`
    // through the real tool, then a second model call pauses the Goal mid-call
    // (the K3-37 (三) fan-out) so the crash restart ends the round
    // `interrupted_clean` with no call in flight; `settle_review` then runs
    // through the Workflow.
    const writePartial = (round: number): { kind: 'calls'; calls: Array<{ callId: string; name: string; args: Record<string, unknown> }> } =>
      ({ kind: 'calls', calls: [{ callId: `k3-11-three-write-${String(round)}`, name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'partial', evidence: `K3-11 round ${String(round)} partial`,
          crashSuspicion: { verdict: 'unlikely', evidence: `K3-11 round ${String(round)} self-check` } } }] });
    const pauses: Array<ControlIntentRef | null> = [];
    const modelReview = createScriptedModel(
      [writePartial(1), readCall('k3-11-three-r1-pause'), writePartial(2), readCall('k3-11-three-r2-pause')],
      async (_request, index) => {
        // The write call runs with no control pending; the following model call
        // is where the Goal pause lands at its safe point.
        if (index % 2 === 0) return;
        const paused = await goalControl(h.host, 'pause', `k3-11-three-goal-pause-${String(pauses.length + 1)}`);
        if (paused.status !== 'committed') throw new Error(`goal pause: ${JSON.stringify(paused)}`);
        pauses.push(paused.value.fanOut.runs.find(entry => entry.outcome === 'submitted')?.intentRef ?? null);
      });
    const reviewRoot = await openReviewWorkRoot(h, modelReview);
    try {
      // --- Round 1: claim, start, write partial, pause, crash, settle. -------
      const startStop1 = await driveReviewUntil(reviewRoot, h.select('k3-11-three-r1', AG2B_WORK_TASK_ID),
        performs('start'));
      const prepared1 = preparedOf(startStop1.stopped);
      const roundRunRef1 = prepared1.claim.runRef;
      await reviewRoot.runtime.startRun(hostCtx(), { prepared: prepared1, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-11-three-r1-start' });
      expect(pauses, 'the Goal pause was submitted during round 1\'s model call').toHaveLength(1);
      expect(pauses[0]).not.toBeNull();
      expect((await readExecution(h.host, roundRunRef1)).run).toMatchObject({ status: 'running',
        controlState: { intentRef: pauses[0], desiredState: 'paused' } });
      // The conclusion really reached the record through the round-1 tool call.
      expect(await reviewOf(h, originalRunRef)).toMatchObject({ status: 'ready',
        value: { items: [{ observed: { verdict: 'partial', by: 'review_round',
          roundRunRef: roundRunRef1 } }] } });

      expect((await h.restart({ crash: true })).report?.runs.find(row => row.ref === JSON.stringify(roundRunRef1)))
        .toMatchObject({ row: 'W-20', status: 'reconciled', reason: 'interrupted_clean' });
      const settleStop1 = await driveReviewUntil(reviewRoot, startStop1.stopped, performs('settle_review'));
      expect(await reviewRoot.workflow.advanceWork(hostCtx(), settleStop1.stopped))
        .toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review' } } });
      const unfinished1 = await reviewOf(h, originalRunRef);
      expect(unfinished1).toMatchObject({ status: 'ready', value: { status: 'pending_review',
        activeRound: null, decisionReasons: [], rounds: [{ round: 1, result: 'unfinished' }] } });

      // --- Round 2 after the Goal resumes: same chain, then final settlement.
      expect(await goalControl(h.host, 'resume', 'k3-11-three-goal-resume')).toMatchObject({ status: 'committed' });
      const startStop2 = await driveReviewUntil(reviewRoot, h.select('k3-11-three-r2', AG2B_WORK_TASK_ID),
        performs('start'));
      const prepared2 = preparedOf(startStop2.stopped);
      const roundRunRef2 = prepared2.claim.runRef;
      expect(roundRunRef2.runId).not.toBe(roundRunRef1.runId);
      await reviewRoot.runtime.startRun(hostCtx(), { prepared: prepared2, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-11-three-r2-start' });
      expect(pauses, 'the Goal pause was submitted during round 2\'s model call').toHaveLength(2);
      expect((await readExecution(h.host, roundRunRef2)).run).toMatchObject({ status: 'running',
        controlState: { intentRef: pauses[1], desiredState: 'paused' } });

      expect((await h.restart({ crash: true })).report?.runs.find(row => row.ref === JSON.stringify(roundRunRef2)))
        .toMatchObject({ row: 'W-20', status: 'reconciled', reason: 'interrupted_clean' });
      const settleStop2 = await driveReviewUntil(reviewRoot, startStop2.stopped, performs('settle_review'));
      expect(await reviewRoot.workflow.advanceWork(hostCtx(), settleStop2.stopped))
        .toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review' } } });

      // --- Read ONLY through the public route. --------------------------------
      const record = await reviewOf(h, originalRunRef);
      expect(record.status).toBe('ready');
      if (record.status !== 'ready') return;
      expect(record.value.status).toBe('needs_decision');
      expect(record.value.activeRound).toBe(null);
      expect(record.value.decisionReasons).toEqual(['review_incomplete', 'partial', 'confirm_each_step']);
      expect(record.value.rounds.map(round => round.result)).toEqual(['unfinished', 'unfinished']);
      expect(record.value.rounds.map(round => round.round)).toEqual([1, 2]);
      // The surviving `partial` is round 2's real tool write.
      expect(record.value.items[0]?.observed).toMatchObject({ verdict: 'partial', by: 'review_round',
        roundRunRef: roundRunRef2 });
      await expectReviewCard(h, record.value);
    } finally {
      await reviewRoot.close();
    }
  }, 300_000);
});

describe('K3-11 second_consecutive on the real continuation chain', () => {
  it('K3-11 R2: a shell call in B after A ended by RUN-25 leaves streak.priorUnknownProcess and settles second_consecutive', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });

    // --- A: a shell call in flight, closed by RUN-25. -----------------------
    const runA = await crashOneCommand(h, 'k3-11-second-a');
    const recordA = await reviewOf(h, runA);
    expect(recordA).toMatchObject({ status: 'ready',
      value: { status: 'pending_review', items: [{ kind: 'process' }] } });

    // --- A's own review round writes done/unlikely and ends normally. -------
    const modelReviewA = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-11-second-a-review', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'A reached its end before the crash',
          crashSuspicion: { verdict: 'unlikely', evidence: 'A leaves no crash trace' } } }] },
      { kind: 'text', text: 'A review done' },
    ]);
    const reviewRootA = await openReviewWorkRoot(h, modelReviewA);
    try {
      const startStopA = await driveReviewUntil(reviewRootA, h.select('k3-11-second-a-review', AG2B_WORK_TASK_ID),
        performs('start'));
      const preparedAReview = preparedOf(startStopA.stopped);
      await reviewRootA.runtime.startRun(hostCtx(), { prepared: preparedAReview, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-11-second-a-review-start' });
      expect((await readExecution(h.host, preparedAReview.claim.runRef)).run)
        .toMatchObject({ status: 'ended', outcome: 'completed' });
    } finally {
      await reviewRootA.close();
    }

    // --- B: A's continuation, another shell call in flight, crashed again. ---
    shellSeam.arm();
    const modelB = createScriptedModel([{ kind: 'calls', calls: [
      { callId: 'k3-11-second-b-shell', name: 'shell', args: { command: 'k3-11-second B runs a program' } }] }]);
    const rootB = await openShellWorkRoot(h, modelB);
    let runningB: Promise<unknown> | null = null;
    let preparedB: ReturnType<typeof preparedOf>;
    try {
      // The Workflow settles A and prepares B's continuation on this root, so
      // B's manifest carries the shell grant A had.
      const startStopB = await prepareOn(rootB, h.select('k3-11-second-b', AG2B_WORK_TASK_ID));
      preparedB = preparedOf(startStopB);
      expect(preparedB.claim.runRef.runId, 'B is a new continuation Run').not.toBe(runA.runId);
      expect(await reviewOf(h, runA)).toMatchObject({ status: 'ready',
        value: { status: 'resolved', decisionReasons: [] } });

      runningB = rootB.runtime.startRun(hostCtx(), { prepared: preparedB, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-11-second-b-start' });
      await shellSeam.waitForCall();
      expect(shellSeam.calls.map(call => call.callId)).toEqual(['k3-11-second-b-shell']);
      const reportB = await h.restart({ crash: true });
      expect(reportB.report?.runs.find(row => row.ref === JSON.stringify(preparedB.claim.runRef)))
        .toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown',
          autoCleanup: { applied: false, blockedBy: 'second_auto_cleanup' } });

      const unknownB = await readExecution(h.host, preparedB.claim.runRef);
      expect(unknownB.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
        reconciliation: { status: 'quarantined',
          observation: { kind: 'unresolved', autoCleanupBlockedBy: 'second_auto_cleanup' } } });

      // The real attestation entry creates B's record in the same commit.
      expect(await h.post<unknown>('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
        { runRef: preparedB.claim.runRef, reason: 'a person attests the second consecutive interruption' },
        'k3-11-second-attest', [{ ref: preparedB.claim.runRef, revision: unknownB.run.revision }])))
        .toMatchObject({ status: 'committed' });

      const createdB = await reviewOf(h, preparedB.claim.runRef);
      expect(createdB).toMatchObject({ status: 'ready', value: {
        status: 'pending_review', activeRound: null,
        streak: { priorAutoCleanup: true, priorUnknownProcess: true, resetRunRef: null },
        items: [{ kind: 'process' }],
      } });
    } finally {
      shellSeam.release();
      await runningB?.catch(() => undefined);
      await rootB.close();
    }

    // --- B's own round writes done/unlikely; settlement names the reason. ----
    const modelReviewB = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-11-second-b-review', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'B reached its end before the crash',
          crashSuspicion: { verdict: 'unlikely', evidence: 'B leaves no crash trace' } } }] },
      { kind: 'text', text: 'B review done' },
    ]);
    const reviewRootB = await openReviewWorkRoot(h, modelReviewB);
    try {
      const startStopReviewB = await driveReviewUntil(reviewRootB, h.select('k3-11-second-b-review', AG2B_WORK_TASK_ID),
        performs('start'));
      const preparedReviewB = preparedOf(startStopReviewB.stopped);
      await reviewRootB.runtime.startRun(hostCtx(), { prepared: preparedReviewB, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-11-second-b-review-start' });
      const settledB = await h.advance(h.select('k3-11-second-b-settle', AG2B_WORK_TASK_ID),
        { stopBefore: performs('requeue_task') });
      expect(settledB.receipts.map(receipt => receipt.kind)).toContain('settle_review');

      const finalB = await reviewOf(h, preparedB.claim.runRef);
      expect(finalB.status).toBe('ready');
      if (finalB.status !== 'ready') return;
      expect(finalB.value.status).toBe('needs_decision');
      expect(finalB.value.activeRound).toBe(null);
      expect(finalB.value.decisionReasons).toEqual(['second_consecutive']);
      expect(finalB.value.streak).toEqual({ priorAutoCleanup: true, priorUnknownProcess: true, resetRunRef: null });
      expect(finalB.value.rounds.map(round => round.result)).toEqual(['finished']);
      // B's round really wrote the conclusion through the tool.
      expect(finalB.value.items[0]?.observed).toMatchObject({ verdict: 'done', by: 'review_round',
        roundRunRef: preparedReviewB.claim.runRef });
      await expectReviewCard(h, finalB.value);
    } finally {
      await reviewRootB.close();
    }
  }, 300_000);
});
