/**
 * K3-29 (R4; K3-SPEC L28, L29 rows 1-4 and 4b): restart recovery of the
 * unknown-call review, one fixed crash point per row.
 *
 * - row 1: the original Run is closed and its record created; the Session is
 *   `kernel_turn_open`. Step 2b lists the open record; the next advance closes
 *   the Turn and claims the round (success), the `needs_decision` record only
 *   waits for a person, and the `resolved` record continues.
 * - row 2: the round was claimed but not entered. 6b (c) hands the Goal off;
 *   UR3a prepares and starts the SAME Run (no second review Run) and RUN-02
 *   rechecks the record. A paused-before-entry + held record is cancelled by
 *   UR3h (RUN-09(U)).
 * - row 3: the round wrote a conclusion and was interrupted. A clean
 *   interruption is RUN-19; an unresolved tool call is RUN-20(i) and waits for
 *   the attestation (UR5). `settle_review` records the round `unfinished` and
 *   the new round closes the previous round's Turn; the second unfinished round
 *   in the same state entry finalizes with `review_incomplete`.
 * - row 4: the round ended `completed` with `activeRound` still set;
 *   `settle_review` finalizes it.
 * - row 4b: the operator paused the round and the Host restarted (RUN-24); the
 *   round's fence is `human_only`, so `settle_review` finalizes with
 *   `review_stopped` and opens no new round.
 *
 * Every row ends with one continuation, at a card, or at "I'll handle it";
 * the last restart writes nothing. Scripted model only; no real model call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, readCall, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { crashOneCommand } from './support/review-card-round.js';
import { expectQuietHarnessRestart } from './support/restart.js';
import { preparedManifestOf } from './support/brief.js';
import { createScriptedModel, type ScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readControl, readExecution, submitControl } from '../helpers/A2-restart-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';

// The KE6 stand-in: `reviewCapability` reads `ProcessSandbox.probe` with the
// read-only options; no host process runs (K3-05's stand-in, unchanged).
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

// --- The blocking conclusion stand-in (row 3's unresolved call) -----------
const reviewToolSeam = vi.hoisted(() => ({ armed: false, skip: 0, gate: Promise.resolve(), reached: null as null | (() => void) }));
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
            if (reviewToolSeam.armed && reviewToolSeam.skip > 0) {
              reviewToolSeam.skip -= 1;
            } else if (reviewToolSeam.armed) {
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
  reviewToolSeam.gate = Promise.resolve();
  reviewToolSeam.armed = false;
  reviewToolSeam.skip = 0;
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

function reviewRefOf(record: { ref: UnknownCallReviewV1['ref'] }): UnknownCallReviewV1['ref'] {
  return record.ref;
}

/** The conclusion the round writes; the second model request completes the turn. */
function concludingModel(label: string): ScriptedModel {
  return createScriptedModel([
    { kind: 'calls', calls: [{ callId: `${label}-conclusion`, name: 'record_unknown_call_review',
      args: { item: 1, verdict: 'done', evidence: 'the shell call reached its end before the crash',
        crashSuspicion: { verdict: 'unlikely', evidence: 'the command itself leaves no crash trace' } } }] },
    { kind: 'text', text: `${label}: the round completes` },
  ]);
}

/** A conclusion, then the second model request HELD so the crash lands between two calls. */
function interruptedConcludingModel(label: string): { model: ScriptedModel; release(): void } {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const model = createScriptedModel([
    { kind: 'calls', calls: [{ callId: `${label}-conclusion`, name: 'record_unknown_call_review',
      args: { item: 1, verdict: 'done', evidence: 'the shell call reached its end before the crash',
        crashSuspicion: { verdict: 'unlikely', evidence: 'the command itself leaves no crash trace' } } }] },
    { kind: 'text', text: `${label}: the round is interrupted between its two calls` },
  ], async (_request, index) => { if (index === 1) await gate; });
  return { model, release: () => { release(); } };
}

/** Claims the review round on `root` (its `claim_task` has committed on return). */
async function claimRound(root: Parameters<typeof driveReviewUntil>[0], h: HostScenario, label: string): Promise<{
  claimReceipt: WorkflowStepReceipt; next: WorkflowAdvanceInput; runRef: RunRef;
}> {
  const claimStop = await driveReviewUntil(root, h.select(`${label}-claim`, AG2B_WORK_TASK_ID), performs('claim_task'));
  const claim = await root.workflow.advanceWork(hostCtx(), claimStop.stopped);
  expect(claim).toMatchObject({ status: 'ready', value: { receipt: { kind: 'claim_task', result: { status: 'committed' } } } });
  if (claim.status !== 'ready' || claim.value.receipt?.kind !== 'claim_task' || claim.value.next === null) {
    throw new Error(`${label}: the review claim did not commit`);
  }
  const receipt = claim.value.receipt;
  if (receipt.result.status !== 'committed') throw new Error(`${label}: the claim was not committed`);
  return { claimReceipt: receipt, next: claim.value.next, runRef: receipt.result.value.runRef };
}

/** Drives one claimed round to its start request (the claim is already committed). */
async function toStart(root: Parameters<typeof driveReviewUntil>[0], next: WorkflowAdvanceInput): Promise<WorkflowAdvanceInput> {
  return (await driveReviewUntil(root, next, performs('start'))).stopped;
}

/** Drives from a start request through the round's known end to its `settle_review`. */
async function toSettle(root: Parameters<typeof driveReviewUntil>[0], h: HostScenario, start: WorkflowAdvanceInput,
  label: string): Promise<WorkflowAdvanceInput> {
  await root.workflow.advanceWork(hostCtx(), start);
  return (await driveReviewUntil(root, h.select(`${label}-settle`, AG2B_WORK_TASK_ID), performs('settle_review'))).stopped;
}

/** A direct "I'll handle it" through the public route. */
async function holdDirectly(h: HostScenario, review: UnknownCallReviewV1, requestId: string):
Promise<WriteResult<UnknownCallReviewV1>> {
  return await h.post<WriteResult<UnknownCallReviewV1>>('unknown-call-reviews/hold', graphWrite(AG2B_SCOPE,
    { reviewRef: review.ref, text: null }, requestId, [{ ref: review.ref, revision: review.revision }]));
}

/** The continuation claims the Task asks for (no `review` arg). */
function continuationClaims(steps: Array<{ next: WorkflowAdvanceInput | null }>): unknown[] {
  return steps.flatMap(step => step.next !== null && step.next.kind === 'perform' && step.next.operation.kind === 'claim_task'
    ? [(step.next.operation.request.input as { review?: unknown }).review] : []);
}

describe('K3-29 row 1 — the original Run is closed and its record exists', () => {
  it('K3-29 row 1 (pending_review): 2b lists the record, the review claim closes the dangling Turn and claims in the original Session, and the resolved record continues once', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-29-r1-shell', select: 'k3-29-r1-a',
      requestId: 'k3-29-r1-a-start', shellArgs: { command: 'k3-29-r1 runs a program' } });
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    const created = await reviewOf(h, crashed.prepared.claim.runRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(created.value).toMatchObject({ status: 'pending_review', activeRound: null, open: 'yes' });
    // Step 2b: one UCR/left line, read only; 6b (c) kind 1 hands the Goal off.
    expect(crashed.report.report?.reviews).toEqual([{ ref: JSON.stringify(created.value.ref), row: 'UCR', status: 'left',
      reason: 'pending_review' }]);
    expect(crashed.report.report?.redriveGoals).toEqual([{ goalRef: AG2B_GOAL_REF, scope: { ...AG2B_SCOPE },
      taskIds: [AG2B_WORK_TASK_ID] }]);

    const root = await openReviewWorkRoot(h, concludingModel('k3-29-r1'));
    try {
      const toClose = await driveReviewUntil(root, h.select('k3-29-r1-close', AG2B_WORK_TASK_ID),
        performs('close_open_turn'));
      expect(toClose.stopped).toMatchObject({ kind: 'perform', operation: { kind: 'close_open_turn',
        request: { afterRunRef: crashed.prepared.claim.runRef } } });
      const closed = await root.workflow.advanceWork(hostCtx(), toClose.stopped);
      expect(closed).toMatchObject({ status: 'ready', value: { receipt: { kind: 'close_open_turn',
        result: { status: 'closed', health: 'available' } } } });
      if (closed.status !== 'ready' || closed.value.next === null) throw new Error('the close has no successor');
      const claimStop = await driveReviewUntil(root, closed.value.next, performs('claim_task'));
      const claimed = claimStop.stopped as unknown as { operation: { request: { input: { sessionRef: { sessionId: string } } } } };
      expect(claimed.operation.request.input.sessionRef.sessionId).toBe(crashed.prepared.claim.sessionRef.sessionId);
      const claim = await root.workflow.advanceWork(hostCtx(), claimStop.stopped);
      expect(claim).toMatchObject({ status: 'ready', value: { receipt: { kind: 'claim_task',
        result: { status: 'committed' } } } });
      if (claim.status !== 'ready' || claim.value.next === null) throw new Error('the claim has no successor');
      const start = await toStart(root, claim.value.next);
      const prepared = preparedOf(start);
      expect(prepared.claim.sessionRef.sessionId).toBe(crashed.prepared.claim.sessionRef.sessionId);
      await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'k3-29-r1-start' });
      const settle = await toSettle(root, h, start, 'k3-29-r1');
      const settled = await root.workflow.advanceWork(hostCtx(), settle);
      expect(settled).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review',
        result: { status: 'committed', value: { status: 'resolved', activeRound: null } } } } });
    } finally {
      await crashed.release();
      await root.close();
    }

    const resolved = await reviewOf(h, crashed.prepared.claim.runRef);
    expect(resolved).toMatchObject({ status: 'ready', value: { status: 'resolved', open: 'no' } });
    const continuation = await h.advance(h.select('k3-29-r1-continue', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    expect(continuationClaims(continuation.steps)).toHaveLength(1);
    expect(continuationClaims(continuation.steps)[0]).toBeUndefined();
    expect(preparedOf(continuation.next).claim.sessionRef.sessionId).toBe(crashed.prepared.claim.sessionRef.sessionId);
    await expectQuietHarnessRestart(h, 'K3-29 row 1 (pending_review): a final restart');
  }, 300_000);

  it('K3-29 row 1 (needs_decision): the settled record is listed by 2b and waits at the card; no continuation', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-29-r1n-shell', select: 'k3-29-r1n-a',
      requestId: 'k3-29-r1n-a-start', shellArgs: { command: 'k3-29-r1n runs a program' } });
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    try {
      // UR2 (the Host's Runtime has no read-only command grant): settle review_unavailable.
      const toSettle = await h.advance(h.select('k3-29-r1n', AG2B_WORK_TASK_ID), { stopBefore: performs('settle_review') });
      expect(toSettle.receipts.map(receipt => receipt.kind)).not.toContain('claim_task');
      const settled = await h.advance(toSettle.next!, { stopBefore: performs('requeue_task') });
      expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');
      const record = await reviewOf(h, crashed.prepared.claim.runRef);
      expect(record).toMatchObject({ status: 'ready', value: { status: 'needs_decision', activeRound: null,
        decisionReasons: ['review_unavailable', 'undetermined', 'crash_undetermined'] } });

      const restarted = await h.restart({ crash: true });
      if (record.status !== 'ready') return;
      expect(restarted.report?.reviews).toEqual([{ ref: JSON.stringify(record.value.ref), row: 'UCR', status: 'left',
        reason: 'needs_decision review_unavailable,undetermined,crash_undetermined' }]);
      // The card waits for the person: no continuation is claimed.
      const again = await h.advance(h.select('k3-29-r1n-again', AG2B_WORK_TASK_ID));
      expect(continuationClaims(again.steps)).toHaveLength(0);
    } finally {
      await crashed.release();
    }
    await expectQuietHarnessRestart(h, 'K3-29 row 1 (needs_decision): a final restart');
  }, 300_000);
});

describe('K3-29 row 2 — the round was claimed but not entered', () => {
  it('K3-29 row 2: 6b (c) hands off, UR3a prepares and starts the SAME Run, the round settles and one continuation follows', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-29-r2-shell', select: 'k3-29-r2-a',
      requestId: 'k3-29-r2-a-start', shellArgs: { command: 'k3-29-r2 runs a program' } });
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    try {
      const created = await reviewOf(h, crashed.prepared.claim.runRef);
      expect(created.status).toBe('ready');
      if (created.status !== 'ready') return;
      const ref = reviewRefOf(created.value);

      // The round is claimed, but the crash lands before `start`.
      let roundRun: RunRef | null = null;
      const claimRoot = await openReviewWorkRoot(h, createScriptedModel([]));
      try {
        const claimed = await claimRound(claimRoot, h, 'k3-29-r2');
        roundRun = claimed.runRef;
        const round = await readExecution(h.host, roundRun);
        expect(round.run).toMatchObject({ status: 'starting', startedAt: null });
        const afterClaim = await reviewOf(h, crashed.prepared.claim.runRef);
        expect(afterClaim).toMatchObject({ status: 'ready', value: { status: 'pending_review',
          activeRound: { runRef: roundRun, round: 1 } } });
      } finally {
        await claimRoot.close();
      }
      // The claimed-not-entered review Run keeps its Attempt open while the Task is
      // failed: I-1 (`tests/state/invariants.ts:843`) counts that attempt as the
      // Task's open one but the Task projection stays `failed`. The row's state is
      // exactly this, so the restart is checked without that invariant assertion.
      const restarted = await h.restart({ crash: true, invariants: false });
      expect(restarted.report?.redriveGoals).toEqual([{ goalRef: AG2B_GOAL_REF, scope: { ...AG2B_SCOPE },
        taskIds: [AG2B_WORK_TASK_ID] }]);
      expect(restarted.report?.reviews).toEqual([{ ref: JSON.stringify(ref), row: 'UCR', status: 'left',
        reason: 'pending_review active_round' }]);

      const root = await openReviewWorkRoot(h, concludingModel('k3-29-r2'));
      try {
        // UR3a: prepare then start on the SAME Run, with no second review Run.
        const toPrepare = await driveReviewUntil(root, h.select('k3-29-r2-prepare', AG2B_WORK_TASK_ID),
          performs('prepare'));
        expect(toPrepare.stopped).toMatchObject({ kind: 'perform', operation: { kind: 'prepare',
          request: { runRef: roundRun } } });
        expect(toPrepare.receipts.map(receipt => receipt.kind)).not.toContain('claim_task');
        const prepared = await root.workflow.advanceWork(hostCtx(), toPrepare.stopped);
        expect(prepared).toMatchObject({ status: 'ready', value: { receipt: { kind: 'prepare', result: { status: 'ready' } } } });
        if (prepared.status !== 'ready' || prepared.value.next === null) throw new Error('the prepare has no successor');
        const start = await toStart(root, prepared.value.next);
        expect(preparedOf(start).claim.runRef).toEqual(roundRun);
        await root.runtime.startRun(hostCtx(), { prepared: preparedOf(start), consumerId: AG2B_CONSUMER_ID,
          requestId: 'k3-29-r2-start' });
        const settle = await toSettle(root, h, start, 'k3-29-r2');
        const settled = await root.workflow.advanceWork(hostCtx(), settle);
        expect(settled).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review',
          result: { status: 'committed', value: { status: 'resolved', activeRound: null } } } } });
      } finally {
        await root.close();
      }
      const after = await reviewOf(h, crashed.prepared.claim.runRef);
      expect(after).toMatchObject({ status: 'ready', value: { status: 'resolved', rounds: [{ runRef: roundRun,
        result: 'finished' }] } });
      const continuation = await h.advance(h.select('k3-29-r2-continue', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
      expect(continuationClaims(continuation.steps)).toHaveLength(1);
    } finally {
      await crashed.release();
    }
    await expectQuietHarnessRestart(h, 'K3-29 row 2: a final restart');
  }, 300_000);

  it('K3-29 row 2 (paused before entry + hold): RUN-02 refuses the start with source_stale once the record is held; UR3h cancels the Run (RUN-09(U)) and UR4 closes only that round', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-29-r2h-shell', select: 'k3-29-r2h-a',
      requestId: 'k3-29-r2h-a-start', shellArgs: { command: 'k3-29-r2h runs a program' } });
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    try {
      const created = await reviewOf(h, crashed.prepared.claim.runRef);
      if (created.status !== 'ready') return;
      let roundRun: RunRef | null = null;
      const claimRoot = await openReviewWorkRoot(h, createScriptedModel([]));
      try {
        const claimed = await claimRound(claimRoot, h, 'k3-29-r2h');
        roundRun = claimed.runRef;
      } finally {
        await claimRoot.close();
      }
      await h.restart({ crash: true, invariants: false });
      if (roundRun === null) return;

      const root = await openReviewWorkRoot(h, createScriptedModel([]));
      try {
        // UR3a: the pre-crash claim is prepared (still the same Run).
        const toPrepare = await driveReviewUntil(root, h.select('k3-29-r2h-prepare', AG2B_WORK_TASK_ID),
          performs('prepare'));
        expect(toPrepare.stopped).toMatchObject({ kind: 'perform', operation: { kind: 'prepare',
          request: { runRef: roundRun } } });
        const prepared = await root.workflow.advanceWork(hostCtx(), toPrepare.stopped);
        if (prepared.status !== 'ready' || prepared.value.next === null) throw new Error('the prepare has no successor');
        const startStep = (await driveReviewUntil(root, prepared.value.next, performs('start'))).stopped;

        // The operator holds the record while the claimed Run is still unentered.
        const createdAgain = await reviewOf(h, crashed.prepared.claim.runRef);
        if (createdAgain.status !== 'ready') return;
        const hold = await h.post('unknown-call-reviews/hold', graphWrite(AG2B_SCOPE,
          { reviewRef: createdAgain.value.ref, text: 'I will handle this' }, 'k3-29-r2h-hold',
          [{ ref: createdAgain.value.ref, revision: createdAgain.value.revision }]));
        expect(hold).toMatchObject({ status: 'committed', value: { status: 'resolved', activeRound: { runRef: roundRun } } });

        // RUN-02 rechecks the record before entry: now it no longer waits for this Run.
        const refused = await root.workflow.advanceWork(hostCtx(), startStep);
        expect(refused).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null,
          receipt: { kind: 'start', result: { status: 'rejected', code: 'source_stale',
            reason: 'the review round no longer waits for this Run' } } } });
        expect((await readExecution(h.host, roundRun)).run).toMatchObject({ status: 'starting', startedAt: null });

        // The operator then pauses the claimed-not-entered Run before UR3h.
        const pause = await submitControl(h.host, roundRun, 'pause', 'the operator pauses before entry', 'k3-29-r2h-pause');
        const pauseRef: ControlIntentRef = pause.intent.ref;
        expect(pause.intent).toMatchObject({ status: 'applied' });
        expect((await readExecution(h.host, roundRun)).run).toMatchObject({ status: 'starting', startedAt: null,
          controlState: { intentRef: pauseRef, desiredState: 'paused' } });

        // UR3h: the Workflow cancels the unentered Run (RUN-09(U)).
        const toCancel = await driveReviewUntil(root, h.select('k3-29-r2h-cancel', AG2B_WORK_TASK_ID),
          performs('cancel_review_round'));
        const cancel = await root.workflow.advanceWork(hostCtx(), toCancel.stopped);
        expect(cancel).toMatchObject({ status: 'ready', value: { receipt: { kind: 'cancel_review_round',
          result: { status: 'committed' } } } });
        if (cancel.status === 'ready' && cancel.value.receipt?.kind === 'cancel_review_round'
          && cancel.value.receipt.result.status === 'committed') {
          const intent = (cancel.value.receipt.result.value as { intent: { ref: ControlIntentRef } }).intent;
          expect(await readControl(h.host, intent.ref)).toMatchObject({ kind: 'cancel', status: 'applied',
            observation: { origin: 'platform_not_entered', kind: 'cancelled' } });
        }
        const ended = await readExecution(h.host, roundRun);
        expect(ended.run).toMatchObject({ status: 'ended', outcome: 'cancelled', startedAt: null });
        // UR4: the record's held round is only closed (UCR-08b), no new round.
        const settleStop = await driveReviewUntil(root, h.select('k3-29-r2h-settle', AG2B_WORK_TASK_ID),
          performs('settle_review'));
        const settled = await root.workflow.advanceWork(hostCtx(), settleStop.stopped);
        expect(settled).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review',
          result: { status: 'committed', value: { status: 'resolved', activeRound: null,
            disposition: { choice: 'handle_myself', hold: 'held' } } } } } });
        const again = await h.advance(h.select('k3-29-r2h-again', AG2B_WORK_TASK_ID));
        expect(continuationClaims(again.steps)).toHaveLength(0);
      } finally {
        await root.close();
      }
    } finally {
      await crashed.release();
    }
    await expectQuietHarnessRestart(h, 'K3-29 row 2 (hold): a final restart');
  }, 300_000);
});

describe('K3-29 row 3 — the round is running with conclusions written', () => {
  it('K3-29 row 3 (clean): the clean crash is RUN-19; the first round is unfinished and the second unfinished in the same state entry finalizes review_incomplete', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-29-r3c-shell', select: 'k3-29-r3c-a',
      requestId: 'k3-29-r3c-a-start', shellArgs: { command: 'k3-29-r3c runs a program' } });
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    const created = await reviewOf(h, crashed.prepared.claim.runRef);
    if (created.status !== 'ready') return;

    // Round 1: a conclusion, then the second model request is held; crash -> RUN-19.
    const first = interruptedConcludingModel('k3-29-r3c');
    const root = await openReviewWorkRoot(h, first.model);
    let round1: RunRef | null = null;
    try {
      const claimed = await claimRound(root, h, 'k3-29-r3c');
      round1 = claimed.runRef;
      const start = await toStart(root, claimed.next);
      void root.runtime.startRun(hostCtx(), { prepared: preparedOf(start), consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-29-r3c-start' }).catch(() => undefined);
      for (let attempt = 0; attempt < 300 && first.model.calls() < 2; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(first.model.calls(), 'the conclusion was written and the second call is in flight').toBe(2);
      const report = await h.restart({ crash: true });
      expect(report.report?.runs.find(row => row.ref === JSON.stringify(round1)))
        .toMatchObject({ row: 'W-11', status: 'reconciled', reason: 'interrupted_clean' });
      expect(report.report?.reviews).toEqual([{ ref: JSON.stringify(created.value.ref), row: 'UCR', status: 'left',
        reason: 'pending_review active_round' }]);

      // Round 1 settles `unfinished`.
      const settleStop1 = await driveReviewUntil(root, h.select('k3-29-r3c-settle1', AG2B_WORK_TASK_ID),
        performs('settle_review'));
      const settle1 = await root.workflow.advanceWork(hostCtx(), settleStop1.stopped);
      expect(settle1).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review',
        result: { status: 'committed', value: { status: 'pending_review', activeRound: null } } } } });
      const afterFirst = await reviewOf(h, crashed.prepared.claim.runRef);
      expect(afterFirst).toMatchObject({ status: 'ready', value: { rounds: [{ runRef: round1,
        stateEntry: 1, result: 'unfinished' }] } });

      // Round 2 claims in the same Session. `settle_review` took round 1 out
      // of `activeRound`; the same advance's maintenance page closes its
      // dangling Turn with `afterRunRef = round 1` (K3-SPEC L29 row 3, L27),
      // so the Session is available and the claim needs no second close or a
      // fallback Session.
      expect((await readExecution(h.host, round1)).session).toMatchObject({ lifecycle: 'active',
        occupancy: null, health: 'available', healthConclusion: null });
      const claimStop = (await driveReviewUntil(root, h.select('k3-29-r3c-close2', AG2B_WORK_TASK_ID),
        performs('claim_task'))).stopped;
      expect(claimStop).toMatchObject({ kind: 'perform', operation: { kind: 'claim_task',
        request: { input: { sessionRef: { sessionId: created.value.sessionRef.sessionId } } } } });
      const claim = await root.workflow.advanceWork(hostCtx(), claimStop);
      expect(claim).toMatchObject({ status: 'ready', value: { receipt: { kind: 'claim_task',
        result: { status: 'committed' } } } });
      if (claim.status !== 'ready' || claim.value.next === null) throw new Error('the claim has no successor');
      const start2 = await toStart(root, claim.value.next);
      const prepared2 = preparedOf(start2);
      expect(prepared2.claim.runRef.runId).not.toBe(round1.runId);
      // Round 2's model: a conclusion, then a held second request; crash -> RUN-19 again.
      const second = interruptedConcludingModel('k3-29-r3c-b');
      const root2 = await openReviewWorkRoot(h, second.model);
      let round2: RunRef = prepared2.claim.runRef;
      try {
        void root2.runtime.startRun(hostCtx(), { prepared: prepared2, consumerId: AG2B_CONSUMER_ID,
          requestId: 'k3-29-r3c-start2' }).catch(() => undefined);
        for (let attempt = 0; attempt < 300 && second.model.calls() < 2; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(second.model.calls()).toBe(2);
        // The first round's held call is released; its late write is refused.
        first.release();
        const report2 = await h.restart({ crash: true });
        expect(report2.report?.runs.find(row => row.ref === JSON.stringify(round2)))
          .toMatchObject({ row: 'W-11', status: 'reconciled', reason: 'interrupted_clean' });
        // The second unfinished round in the same state entry finalizes the record.
        const settleStop2 = await driveReviewUntil(root2, h.select('k3-29-r3c-settle2', AG2B_WORK_TASK_ID),
          performs('settle_review'));
        const settle2 = await root2.workflow.advanceWork(hostCtx(), settleStop2.stopped);
        expect(settle2).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review',
          result: { status: 'committed', value: { status: 'needs_decision', activeRound: null } } } } });
        const finalized = await reviewOf(h, crashed.prepared.claim.runRef);
        expect(finalized).toMatchObject({ status: 'ready', value: { status: 'needs_decision',
          decisionReasons: expect.arrayContaining(['review_incomplete']), activeRound: null } });
        if (finalized.status === 'ready') {
          expect(finalized.value.rounds.map(round => round.result)).toEqual(['unfinished', 'unfinished']);
        }
        const again = await h.advance(h.select('k3-29-r3c-again', AG2B_WORK_TASK_ID));
        expect(continuationClaims(again.steps)).toHaveLength(0);
        await expectQuietHarnessRestart(h, 'K3-29 row 3 (clean): a final restart');
      } finally {
        second.release();
        await root2.close();
      }
    } finally {
      first.release();
      await root.close();
      await crashed.release();
    }
  }, 300_000);

  it('K3-29 row 3 (unresolved call): RUN-20(i) review_round waits for the attestation (UR5); then the round is unfinished and the next round carries the written conclusion', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-29-r3u-shell', select: 'k3-29-r3u-a',
      requestId: 'k3-29-r3u-a-start', shellArgs: { command: 'k3-29-r3u runs a program' } });
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    const created = await reviewOf(h, crashed.prepared.claim.runRef);
    if (created.status !== 'ready') return;

    let releaseTool!: () => void;
    reviewToolSeam.gate = new Promise<void>(resolve => { releaseTool = resolve; });
    const reached = new Promise<void>(resolve => { reviewToolSeam.reached = resolve; });
    reviewToolSeam.skip = 1;
    reviewToolSeam.armed = true;
    const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-29-r3u-conclusion',
      name: 'record_unknown_call_review', args: { item: 1, verdict: 'done', evidence: 'the shell call finished',
        crashSuspicion: { verdict: 'unlikely', evidence: 'nothing suggests a crash' } } }] },
    { kind: 'calls', calls: [{ callId: 'k3-29-r3u-second', name: 'record_unknown_call_review',
      args: { item: 1, verdict: 'not_done', evidence: 'the second conclusion stays in flight',
        crashSuspicion: { verdict: 'possible', evidence: 'the Host dies with the call' } } }] },
    { kind: 'text', text: 'K3-29 row 3 unresolved: round 2 completes with the written conclusion' }]);
    const root = await openReviewWorkRoot(h, model);
    let round1: RunRef | null = null;
    try {
      const claimed = await claimRound(root, h, 'k3-29-r3u');
      round1 = claimed.runRef;
      const start = await toStart(root, claimed.next);
      void root.runtime.startRun(hostCtx(), { prepared: preparedOf(start), consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-29-r3u-start' }).catch(() => undefined);
      await reached;
      const report = await h.restart({ crash: true });
      expect(report.report?.runs.find(row => row.ref === JSON.stringify(round1)))
        .toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown',
          autoCleanup: { applied: false, blockedBy: 'review_round' } });
      expect(report.report?.reviews).toEqual([{ ref: JSON.stringify(created.value.ref), row: 'UCR', status: 'left',
        reason: 'pending_review active_round' }]);

      // UR5: the Workflow skips this record until a person attests the round.
      const skipped = await h.advance(h.select('k3-29-r3u-skip', AG2B_WORK_TASK_ID));
      expect(skipped.receipts.map(receipt => receipt.kind)).not.toContain('settle_review');
      expect(skipped.reason?.startsWith('unknown_call_review')).toBe(true);
      const unknown = await readExecution(h.host, round1);
      const attested = await h.post('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
        { runRef: round1, reason: 'a person attests the interrupted review round' }, 'k3-29-r3u-attest',
        [{ ref: round1, revision: unknown.run.revision }]));
      expect(attested).toMatchObject({ status: 'committed' });
      expect(await reviewOf(h, round1)).toEqual({ status: 'not_found' });

      // UR4: the first round is unfinished; the new round closes its Turn.
      const settleStop = await driveReviewUntil(root, h.select('k3-29-r3u-settle', AG2B_WORK_TASK_ID),
        performs('settle_review'));
      const settled = await root.workflow.advanceWork(hostCtx(), settleStop.stopped);
      expect(settled).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review',
        result: { status: 'committed', value: { status: 'pending_review', activeRound: null } } } } });
      // The same advance's maintenance page closes round 1's RUN-22 Turn with
      // `afterRunRef = round 1` (L27): the Session stays available and the
      // second round claims there with the written conclusion.
      expect((await readExecution(h.host, round1)).session).toMatchObject({ lifecycle: 'active',
        occupancy: null, health: 'available', healthConclusion: null });
      const claimStop = (await driveReviewUntil(root, h.select('k3-29-r3u-close2', AG2B_WORK_TASK_ID),
        performs('claim_task'))).stopped;
      expect(claimStop).toMatchObject({ kind: 'perform', operation: { kind: 'claim_task',
        request: { input: { sessionRef: { sessionId: created.value.sessionRef.sessionId } } } } });
      const claim = await root.workflow.advanceWork(hostCtx(), claimStop);
      expect(claim).toMatchObject({ status: 'ready', value: { receipt: { kind: 'claim_task',
        result: { status: 'committed' } } } });
      if (claim.status !== 'ready' || claim.value.next === null) throw new Error('the claim has no successor');
      // The second round's input carries the conclusion already written.
      const start2 = await toStart(root, claim.value.next);
      const prepared2 = preparedOf(start2);
      const manifest = await preparedManifestOf(h, prepared2.envelope.bundleRef);
      expect(manifest.unknownCallReview?.items[0]?.current).toMatchObject({ verdict: 'done', by: 'review_round',
        roundRunRef: round1 });
      expect(prepared2.claim.runRef.runId).not.toBe(round1.runId);
      // Round 2 completes with the written conclusion; settle_review finalizes
      // the record and one continuation follows in the same Session.
      await root.runtime.startRun(hostCtx(), { prepared: prepared2, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-29-r3u-start2' });
      const settleStop2 = await driveReviewUntil(root, h.select('k3-29-r3u-settle2', AG2B_WORK_TASK_ID),
        performs('settle_review'));
      const settled2 = await root.workflow.advanceWork(hostCtx(), settleStop2.stopped);
      expect(settled2).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review',
        result: { status: 'committed', value: { status: 'resolved', activeRound: null } } } } });
      const resolved = await reviewOf(h, crashed.prepared.claim.runRef);
      expect(resolved).toMatchObject({ status: 'ready', value: { status: 'resolved', open: 'no' } });
      const continuation = await h.advance(h.select('k3-29-r3u-continue', AG2B_WORK_TASK_ID),
        { stopBefore: performs('start') });
      expect(continuationClaims(continuation.steps)).toHaveLength(1);
      expect(preparedOf(continuation.next).claim.sessionRef.sessionId).toBe(created.value.sessionRef.sessionId);
      await expectQuietHarnessRestart(h, 'K3-29 row 3 (unresolved): a final restart');
    } finally {
      releaseTool();
      await root.close();
      await crashed.release();
    }
  }, 300_000);
});

describe('K3-29 row 4 — the round ended normally, not settled', () => {
  it('K3-29 row 4: Ended(completed) with activeRound still set; the next advance settles it and one continuation follows', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-29-r4-shell', select: 'k3-29-r4-a',
      requestId: 'k3-29-r4-a-start', shellArgs: { command: 'k3-29-r4 runs a program' } });
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    try {
      const created = await reviewOf(h, crashed.prepared.claim.runRef);
      if (created.status !== 'ready') return;
      const root = await openReviewWorkRoot(h, concludingModel('k3-29-r4'));
      let round: RunRef | null = null;
      try {
        const claimed = await claimRound(root, h, 'k3-29-r4');
        round = claimed.runRef;
        const start = await toStart(root, claimed.next);
        await root.runtime.startRun(hostCtx(), { prepared: preparedOf(start), consumerId: AG2B_CONSUMER_ID,
          requestId: 'k3-29-r4-start' });
        const ended = await readExecution(h.host, round);
        expect(ended.run).toMatchObject({ status: 'ended', outcome: 'completed' });
        const notSettled = await reviewOf(h, crashed.prepared.claim.runRef);
        expect(notSettled).toMatchObject({ status: 'ready', value: { status: 'pending_review',
          activeRound: { runRef: round } } });
        const settleStop = await driveReviewUntil(root, h.select('k3-29-r4-settle', AG2B_WORK_TASK_ID),
          performs('settle_review'));
        const settled = await root.workflow.advanceWork(hostCtx(), settleStop.stopped);
        expect(settled).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review',
          result: { status: 'committed', value: { status: 'resolved', activeRound: null } } } } });
      } finally {
        await root.close();
      }
      const record = await reviewOf(h, crashed.prepared.claim.runRef);
      expect(record).toMatchObject({ status: 'ready', value: { status: 'resolved', rounds: [{ runRef: round,
        result: 'finished' }] } });
      const continuation = await h.advance(h.select('k3-29-r4-continue', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
      expect(continuationClaims(continuation.steps)).toHaveLength(1);
    } finally {
      await crashed.release();
    }
    await expectQuietHarnessRestart(h, 'K3-29 row 4: a final restart');
  }, 300_000);
});

describe('K3-29 row 4b — the operator paused the round and the Host restarted', () => {
  it('K3-29 row 4b: a paused running round ends RUN-24, its fence is human_only, and settle_review finalizes review_stopped without a new round', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-29-r4b-shell', select: 'k3-29-r4b-a',
      requestId: 'k3-29-r4b-a-start', shellArgs: { command: 'k3-29-r4b runs a program' } });
    expect(crashed.report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
      { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } }] } });
    const created = await reviewOf(h, crashed.prepared.claim.runRef);
    if (created.status !== 'ready') return;
    let round: RunRef | null = null;
    let pauseRef: ControlIntentRef | null = null;
    const model = createScriptedModel([readCall('k3-29-r4b')], async () => {
      if (round === null) throw new Error('the round Run must be known before its model call');
      pauseRef = (await submitControl(h.host, round, 'pause', 'the operator pauses the running review round',
        'k3-29-r4b-pause')).intent.ref;
    });
    const root = await openReviewWorkRoot(h, model);
    try {
      const claimed = await claimRound(root, h, 'k3-29-r4b');
      round = claimed.runRef;
      const start = await toStart(root, claimed.next);
      await root.runtime.startRun(hostCtx(), { prepared: preparedOf(start), consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-29-r4b-start' });
      if (pauseRef === null) throw new Error('the pause must have been submitted during the model call');
      expect((await readExecution(h.host, round)).run).toMatchObject({ status: 'running',
        controlState: { intentRef: pauseRef, desiredState: 'paused' } });
      const report = await h.restart({ crash: true });
      expect(report.report?.runs.find(row => row.ref === JSON.stringify(round)))
        .toMatchObject({ row: 'W-20', status: 'reconciled', reason: 'interrupted_clean' });
      const reconciled = await readExecution(h.host, round);
      expect(reconciled.session).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'unavailable',
        healthConclusion: 'kernel_turn_open' });
      expect(reconciled.run).toMatchObject({ status: 'ended', outcome: 'crashed',
        reconciliation: { status: 'done', observation: { kind: 'interrupted_clean', kernelPaused: true,
          pausedIntentRef: pauseRef } } });
      expect(report.report?.reviews).toEqual([{ ref: JSON.stringify(created.value.ref), row: 'UCR', status: 'left',
        reason: 'pending_review active_round' }]);

      // UR4: the human-only fence means no new round; finalize with review_stopped.
      const settled = await h.advance(h.select('k3-29-r4b-settle', AG2B_WORK_TASK_ID), { stopBefore: performs('requeue_task') });
      const kinds = settled.receipts.map(receipt => receipt.kind);
      expect(kinds).toContain('settle_review');
      expect(kinds).not.toContain('claim_task');
      const record = await reviewOf(h, crashed.prepared.claim.runRef);
      expect(record).toMatchObject({ status: 'ready', value: { status: 'needs_decision', activeRound: null,
        decisionReasons: expect.arrayContaining(['review_stopped']) } });
      if (record.status === 'ready') {
        expect(record.value.rounds).toEqual([{ runRef: round, phase: 'review', round: 1, stateEntry: 1, result: 'stopped' }]);
      }
      if (record.status !== 'ready') throw new Error('the record must read');
      // The dangling Turn is closed with `afterRunRef = round` by the same
      // advance's maintenance page once `settle_review` has taken the round
      // out of `activeRound` (L27, SES-19a): the round's Session returns
      // available and is the continuation's Session. Without the L27
      // authorization the close is refused and the claim would fall back to a
      // new Session.
      const roundSession = (await readExecution(h.host, round)).session;
      expect(roundSession).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'available',
        healthConclusion: null });
      expect(roundSession.lastExecutionRef).toMatchObject({ runId: round.runId });
      // The card's direct "I'll handle it", then the two-step release-hold:
      // the release commits, the human requeue is the next advance's job.
      const held = await holdDirectly(h, record.value, 'k3-29-r4b-hold');
      expect(held).toMatchObject({ status: 'committed', value: { status: 'resolved', activeRound: null,
        disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } } });
      if (held.status !== 'committed') throw new Error('the direct hold must commit');
      const released = await h.post<WriteResult<{ hold: WriteResult<UnknownCallReviewV1>; requeue: unknown }>>(
        'unknown-call-reviews/release-hold', graphWrite(AG2B_SCOPE, { reviewRef: record.value.ref },
          'k3-29-r4b-release', [{ ref: record.value.ref, revision: held.value.revision }]));
      expect(released).toMatchObject({ status: 'committed', value: { requeue: null,
        hold: { status: 'committed', value: { status: 'resolved', disposition: { hold: 'released' } } } } });
      expect(h.ledgerEventTypes().filter(type => type === 'TaskRequeued')).toEqual([]);

      // The automatic requeue covers the original Run; the continuation claim
      // follows in the nearest holder's Session (L12), which the close above
      // left available. Nothing is closed or created a second time.
      const driven = await h.advance(h.select('k3-29-r4b-continue', AG2B_WORK_TASK_ID),
        { stopBefore: performs('start') });
      const drivenKinds = driven.receipts.map(receipt => receipt.kind);
      expect(drivenKinds).not.toContain('close_open_turn');
      expect(drivenKinds).not.toContain('create_session');
      const claim = driven.steps.flatMap(step => step.next !== null && step.next.kind === 'perform'
        && step.next.operation.kind === 'claim_task'
        ? [step.next.operation.request.input as { sessionRef?: { sessionId: string }; review?: unknown }] : []);
      expect(claim).toHaveLength(1);
      expect(claim[0]?.review).toBeUndefined();
      expect(claim[0]?.sessionRef?.sessionId).toBe(created.value.sessionRef.sessionId);
      expect(h.ledgerEventTypes().filter(type => type === 'TaskRequeued')).toEqual(['TaskRequeued']);
    } finally {
      await root.close();
      await crashed.release();
    }
    await expectQuietHarnessRestart(h, 'K3-29 row 4b: a final restart');
  }, 300_000);
});
