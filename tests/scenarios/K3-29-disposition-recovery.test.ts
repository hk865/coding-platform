/**
 * K3-29 / L29 row 5 (UR7, L19): a real review card is answered, the ②
 * disposition commit is made to fail inside the `decisions/answer` route (a
 * real ledger commit abort, not a hand-encoded result), the Host restarts and
 * the start-up 6b (c) kind 3 hands the answered card's Goal to the re-drive.
 * UR7 then applies ② with the Workflow automation identity (the identity from
 * the answer), does ③ and the one continuation is claimed; the old answer is
 * never answered twice and no second continuation exists.
 *
 * Everything is real: the `needs_decision` record comes from RUN-25 and the
 * real settle_review owner (`openMissingReadReviewRoot`, K3-17's shape), the
 * card from the real review-card source, and the answer through the public
 * `decisions/answer` route.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, performs, waitFor } from './harness.js';
import { redrivePolicy } from './support/common.js';
import { createNeedsDecisionRecord } from './support/review-work-root.js';
import { failCommitOf } from './support/receipts.js';
import { expectQuietHarnessRestart } from './support/restart.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, controlGoal, readGoal } from '../helpers/A2-restart-fixture.js';
import {
  AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { DecisionSelectionV1 } from '../../src/contracts/goal-decisions.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type {
  DecisionCardV1, DecisionQueueReadV1, ResolveDecisionReadV1,
} from '../../src/core/work-graph/model/decision-contracts.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

const sandbox = vi.hoisted(() => ({ available: true as boolean, real: false as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxSwitch } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxSwitch(actual, sandbox) };
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

afterEach(async () => {
  for (const release of crashHandles.splice(0)) await release();
  shellSeam.release();
  sandbox.available = true;
  sandbox.real = false;
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

const crashHandles: Array<() => Promise<void>> = [];

async function queue(h: HostScenario): Promise<DecisionQueueReadV1> {
  const read = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer', 'answered_pending_application'],
      page: { limit: 100 } }));
  if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function reviewCard(h: HostScenario): Promise<DecisionCardV1> {
  const cards = (await queue(h)).waitingAnswer.filter(card => card.source.kind === 'unknown_call_review');
  expect(cards).toHaveLength(1);
  return cards[0]!;
}

async function answer(h: HostScenario, card: DecisionCardV1, selection: DecisionSelectionV1,
  requestId: string): Promise<ResolveDecisionReadV1> {
  const answered = await h.answer('decisions/answer', graphWrite(AG2B_SCOPE,
    { source: card.source, selection, text: '', annotations: [] }, requestId, card.source.pins));
  if (answered['status'] !== 'ready') throw new Error(`the answer was not ready: ${JSON.stringify(answered)}`);
  return answered['value'] as ResolveDecisionReadV1;
}

describe('K3-29 row 5: an answered card with a failed ② commit, UR7 after the restart', () => {
  it('K3-29 row 5 (L29): the answered card survives a failed disposition commit; the restart hands it over (6b kind 3); UR7 applies ② and ③ and exactly one continuation is claimed', async () => {
    // R-10: this test runs the registered formal check, so it uses the real
    // operating-system sandbox (bwrap) throughout, never the stand-in.
    sandbox.real = true;
    // The real sandbox mounts only /usr, /bin, /lib and /lib64 beside the
    // workspace, so the passing check runs the `node` on that PATH (the
    // harness's `pass` check), never this test process's own binary.
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass',
      script: { replies: [{ kind: 'text', text: 'K3-29 row 5: the continuation ran' }] } });
    const { origin, review, release } = await createNeedsDecisionRecord(h, 'k3-29r5',
      'k3-29r5-review-host');
    crashHandles.push(release);
    const card = await reviewCard(h);
    expect(card.options.map(option => option.id)).toEqual(['rerun_as_is', 'safer_method', 'skip_as_done', 'handle_myself']);

    // The ② disposition commit fails inside its real ledger transaction: the
    // answer (①) is already committed, the record is untouched, ③ never runs.
    const fault = failCommitOf(h.database, 'UnknownCallReviewChanged');
    let answered: ResolveDecisionReadV1;
    try {
      answered = await answer(h, card, { kind: 'option', optionId: 'rerun_as_is' }, 'k3-29r5-answer');
    } finally {
      fault.drop();
    }
    expect(answered, JSON.stringify(answered)).toMatchObject({ state: 'application_not_recorded',
      answer: { status: 'committed' }, action: { status: 'rejected', code: 'unavailable' }, application: null });
    const answerRef = answered.answer.status === 'committed' ? answered.answer.value.ref : null;
    expect(answerRef).not.toBeNull();
    const stillOpen = await reviewOf(h, origin);
    expect(stillOpen).toMatchObject({ status: 'ready', value: { status: 'needs_decision',
      revision: review.revision, disposition: null } });
    const pending = (await queue(h)).answeredPendingApplication
      .filter(entry => entry.source.key === card.source.key);
    expect(pending).toMatchObject([{ state: 'answered_pending_application', application: null }]);

    // Restart with the re-drive on: 6b (c) kind 3 hands the answered card over
    // (the record is still `needs_decision`, so no answer index entry is needed).
    const report = await h.restart({ automation: redrivePolicy(true) });
    expect(report.report?.redriveGoals).toEqual([{ goalRef: AG2B_GOAL_REF, scope: { ...AG2B_SCOPE },
      taskIds: [AG2B_WORK_TASK_ID] }]);

    // UR7 applies ② (replayed by the answer's identity) and ③; the record is
    // resolved with the card's own disposition.
    const resolved = await waitFor(() => reviewOf(h, origin), read => read.status === 'ready'
      && read.value.status === 'resolved' && read.value.disposition?.choice === 'rerun_as_is',
    'UR7 to apply the review disposition');
    if (resolved.status !== 'ready') throw new Error(JSON.stringify(resolved));
    expect(resolved.value.disposition).toMatchObject({ choice: 'rerun_as_is', source: 'card',
      answerMessageRef: answerRef });
    expect(resolved.value).toMatchObject({ open: 'no', activeRound: null });

    // ③ recorded the answer's application exactly once; the card is no longer
    // waiting to be applied.
    const applied = await waitFor(() => h.post<ReadResult<SessionMessage>>('messages/read',
      plain(AG2B_SCOPE, answerRef!)), read => read.status === 'ready' && read.value.application !== null,
    'UR7 to record the application');
    if (applied.status !== 'ready') throw new Error(JSON.stringify(applied));
    expect(applied.value.application).toMatchObject({ schemaVersion: 1 });
    expect((await queue(h)).answeredPendingApplication.filter(entry => entry.source.key === card.source.key))
      .toEqual([]);

    // Exactly one continuation: one TaskRequeued and one Run other than the
    // reviewed origin.
    const row = await waitFor(() => h.taskRow(), value => value.execution !== null
      && value.execution.runId !== origin.runId, 'the one continuation to be claimed');
    expect(h.ledgerEventTypes().filter(type => type === 'TaskRequeued')).toEqual(['TaskRequeued']);
    expect(row.execution?.runId).not.toBe(origin.runId);

    // The start-up re-drive walks past the now-passing formal check to
    // `complete_task`; once it stops driving, the ordinary selection confirms
    // the Task's end: no second continuation and the terminal state.
    await waitForFlowToStop(h, 'K3-29 row 5 continuation');
    const toComplete = await h.advance(h.select('k3-29r5-finish', AG2B_WORK_TASK_ID),
      { stopBefore: performs('complete_task') });
    expect(toComplete.state).toBe('completed');
    expect(toComplete.reason).toBe('the Goal is formally COMPLETED');
    expect(toComplete.receipts.map(receipt => receipt.kind)).not.toContain('requeue_task');
    expect(toComplete.receipts.map(receipt => receipt.kind)).not.toContain('claim_task');
    expect(toComplete.receipts.map(receipt => receipt.kind)).not.toContain('start');
    expect((await h.taskRow()).effectivePhase).toBe('satisfied');

    // The settled restart changes nothing and re-drives nothing.
    const restarted = await expectQuietHarnessRestart(h, 'K3-29 row 5: the continuation case final restart');
    expect(restarted.report?.redriveGoals).toEqual([]);
  }, 300_000);
});

/** The one UR7 `apply_review_disposition` request the Workflow selects for this Task. */
async function advanceToUr7(h: HostScenario, flowId: string): Promise<WorkflowAdvanceInput> {
  const driven = await h.advance(h.select(flowId, AG2B_WORK_TASK_ID),
    { stopBefore: performs('apply_review_disposition') });
  expect(driven.state, 'UR7 must be selected').toBe('stopped');
  if (driven.next === null) throw new Error('the Workflow selected no review disposition to perform');
  return driven.next;
}

/** One `workflow/advance` route call with an exact input. */
async function advanceWith(h: HostScenario, input: WorkflowAdvanceInput): Promise<WorkflowAdvanceResult> {
  return h.post<WorkflowAdvanceResult>('workflow/advance', plain(AG2B_SCOPE, input));
}

/** The review queue's pending-application entry for one card. */
async function pendingApplicationOf(h: HostScenario, sourceKey: string) {
  return (await queue(h)).answeredPendingApplication.filter(entry => entry.source.key === sourceKey);
}

/** Wait until the start-up answer re-drive has stopped driving (K3-44 (三)'s pattern). */
async function waitForFlowToStop(h: HostScenario, label: string): Promise<void> {
  await waitFor(() => h.answer('workflow/driver-read', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF })),
    read => {
      const state = (read['value'] as { state?: string } | undefined)?.state;
      return state !== 'running' && state !== 'waiting_for_reply';
    }, `${label}: the flow to stop`);
}

describe('K3-29 row 5: UR7 waits for a refused ② instead of re-selecting the same card', () => {
  it('K3-29 row 5 (L29): a persistently refused ② makes one advance wait with `unavailable: `; dropping the fault applies it', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass',
      script: { replies: [{ kind: 'text', text: 'K3-29 row 5 waiting: the continuation ran' }] } });
    const { origin, review, release } = await createNeedsDecisionRecord(h, 'k3-29r5w',
      'k3-29r5-review-host');
    crashHandles.push(release);
    const card = await reviewCard(h);
    expect(card.options.map(option => option.id))
      .toEqual(['rerun_as_is', 'safer_method', 'skip_as_done', 'handle_myself']);

    // The ② disposition commit keeps failing: ① is committed, ② writes nothing
    // and the record stays `needs_decision` at its same revision.
    const fault = failCommitOf(h.database, 'UnknownCallReviewChanged');
    try {
      const answered = await answer(h, card, { kind: 'option', optionId: 'rerun_as_is' }, 'k3-29r5w-answer');
      expect(answered).toMatchObject({ state: 'application_not_recorded',
        answer: { status: 'committed' }, action: { status: 'rejected', code: 'unavailable' }, application: null });

      const perform = await advanceToUr7(h, 'k3-29r5w');
      const waited = await advanceWith(h, perform);
      expect(waited, JSON.stringify(waited)).toMatchObject({ status: 'ready', value: { state: 'waiting',
        next: null, receipt: { kind: 'apply_review_disposition', result: { status: 'ready',
          value: { state: 'application_not_recorded',
            action: { status: 'rejected', code: 'unavailable' }, application: null } } } } });
      if (waited.status !== 'ready') throw new Error(JSON.stringify(waited));
      expect(waited.value.reason).toMatch(/^unavailable: /);
      expect(await reviewOf(h, origin)).toMatchObject({ status: 'ready', value: { status: 'needs_decision',
        revision: review.revision, disposition: null } });
      expect(await pendingApplicationOf(h, card.source.key))
        .toMatchObject([{ state: 'answered_pending_application' }]);
    } finally {
      fault.drop();
    }

    // The fault is gone: the same UR7 replays ② and books ③; the record resolves.
    const retry = await advanceWith(h, await advanceToUr7(h, 'k3-29r5w'));
    expect(retry, JSON.stringify(retry)).toMatchObject({ status: 'ready', value: { state: 'advance',
      receipt: { kind: 'apply_review_disposition', result: { status: 'ready',
        value: { state: 'applied', action: { status: 'committed' }, application: { status: 'committed' } } } },
      next: { kind: 'select_work' } } });
    expect(await reviewOf(h, origin)).toMatchObject({ status: 'ready', value: { status: 'resolved',
      disposition: { choice: 'rerun_as_is', source: 'card' } } });
    expect(await pendingApplicationOf(h, card.source.key)).toEqual([]);

    // Let the ordinary continuation run out so the Goal is settled before the
    // restart (§12.10 step 4): one requeue, one claim and one ordinary Run.
    const driven = await h.advance(h.select('k3-29r5w-continue', AG2B_WORK_TASK_ID));
    expect(driven.receipts.map(receipt => receipt.kind))
      .toEqual(expect.arrayContaining(['requeue_task', 'claim_task', 'start']));

    const quiet = await expectQuietHarnessRestart(h, 'K3-29 row 5: a final restart');
    expect(quiet.report?.redriveGoals).toEqual([]);
  }, 300_000);

  it('K3-29 row 5b (L29/T02): a Goal content change after the answer makes UR7 wait with the T02 reason', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const { origin, review, release } = await createNeedsDecisionRecord(h, 'k3-29r5b',
      'k3-29r5-review-host');
    crashHandles.push(release);

    // Answer while paused: the card is read at the paused Goal's control
    // revision, ② is `busy` (awaiting_resume), and nothing is written.
    expect(await controlGoal(h.host, 'pause', 'k3-29r5b-pause')).toMatchObject({ status: 'committed' });
    const card = await reviewCard(h);
    const answered = await answer(h, card, { kind: 'option', optionId: 'rerun_as_is' }, 'k3-29r5b-answer');
    expect(answered).toMatchObject({ state: 'awaiting_resume',
      action: { status: 'rejected', code: 'busy' }, application: null });

    // The content basis moves while paused: the public Goal settings route.
    const beforeSet = await readGoal(h.host);
    expect(await h.post<WriteResult<GoalSnapshot>>('goals/settings/set', graphWrite(AG2B_SCOPE, {
      goalRef: AG2B_GOAL_REF, autonomy: 'every_step', waitForGoalRef: null,
    }, 'k3-29r5b-autonomy', [{ ref: AG2B_GOAL_REF, revision: beforeSet.revision }])))
      .toMatchObject({ status: 'committed' });
    expect(await controlGoal(h.host, 'resume', 'k3-29r5b-resume')).toMatchObject({ status: 'committed' });

    // UR7's ② now returns the T02 revision conflict (no record `current`): the
    // Workflow waits with the lead's literal and never selects the card again.
    const waited = await advanceWith(h, await advanceToUr7(h, 'k3-29r5b'));
    expect(waited, JSON.stringify(waited)).toMatchObject({ status: 'ready', value: { state: 'waiting',
      next: null, receipt: { kind: 'apply_review_disposition', result: { status: 'ready',
        value: { state: 'application_not_recorded',
          action: { status: 'rejected', code: 'revision_conflict' }, application: null } } } } });
    if (waited.status !== 'ready') throw new Error(JSON.stringify(waited));
    expect(waited.value.reason).toBe('目标的内容变了，这个答复不能落实');
    expect(await reviewOf(h, origin)).toMatchObject({ status: 'ready', value: { status: 'needs_decision',
      revision: review.revision, disposition: null } });
    expect(await pendingApplicationOf(h, card.source.key))
      .toMatchObject([{ state: 'answered_pending_application' }]);

    // The lead's other way out for T02: cancel the Goal. Nothing is left to
    // re-drive, so the settled restart lists no Goal.
    expect(await controlGoal(h.host, 'cancel', 'k3-29r5b-cancel')).toMatchObject({ status: 'committed' });
    const quiet = await expectQuietHarnessRestart(h, 'K3-29 row 5b: a final restart');
    expect(quiet.report?.redriveGoals).toEqual([]);
  }, 300_000);
});
