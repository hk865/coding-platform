/**
 * K3-18 (一) (L22, spec line 1432): an `every_step` Goal with a review card.
 *
 * A real `every_step` world: a `shell` call in flight is closed by RUN-25, the
 * review round writes `done`/`unlikely`, and `settle_review` emits the one
 * `confirm_each_step` review card. Answering `rerun_as_is` through the public
 * `decisions/answer` route confirms the automatic requeue: the Workflow's next
 * step is the `requeue_task` with no `system_requeue` confirmation card. The
 * whole flow therefore has exactly ONE card, the review card, read from the
 * public decision queue (the confirmation-card cause is the read model, never
 * private state).
 *
 * Scripted model only; the read-only capability is the KE6 probe stand-in and
 * `shell` is the blocking seam (no host process).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { crashOneCommand } from './support/review-card-round.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readGoal } from '../helpers/A2-restart-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { DecisionSelectionV1 } from '../../src/contracts/goal-decisions.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { ResolveDecisionReadV1 } from '../../src/business/workflow/contracts.js';

// The KE6 stand-in: `reviewCapability` reads `ProcessSandbox.probe` with the
// read-only options; no host process runs.
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
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

async function queueOf(h: HostScenario): Promise<DecisionQueueReadV1> {
  const read = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer'], page: { limit: 100 } }));
  if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

function reviewCardOf(queue: DecisionQueueReadV1): DecisionCardV1 {
  const cards = queue.waitingAnswer.filter(card => card.source.kind === 'unknown_call_review');
  expect(cards).toHaveLength(1);
  return cards[0]!;
}

function confirmationCardsOf(queue: DecisionQueueReadV1): DecisionCardV1[] {
  return queue.waitingAnswer.filter(card => card.source.kind === 'goal_cause'
    && card.source.key.includes('automation_confirmation_required'));
}

async function taskRowOf(h: HostScenario): Promise<TaskRow> {
  return await h.taskRow() as TaskRow;
}

async function setEveryStep(h: HostScenario): Promise<void> {
  const before = await readGoal(h.host);
  const set = await h.post<WriteResult<GoalSnapshot>>('goals/settings/set', graphWrite(AG2B_SCOPE, {
    goalRef: AG2B_GOAL_REF, autonomy: 'every_step', waitForGoalRef: null,
  }, 'k3-18-one-every-step', [{ ref: AG2B_GOAL_REF, revision: before.revision }]));
  expect(set).toMatchObject({ status: 'committed' });
}

/** The real review round settles to the `confirm_each_step` card; read from the public queue. */
async function needsDecisionCard(h: HostScenario, label: string): Promise<{
  originalRunRef: RunRef; record: UnknownCallReviewV1; card: DecisionCardV1;
}> {
  const crashed = await crashOneCommand(h, { callId: `${label}-shell`, select: `${label}-a`,
    requestId: `${label}-a-start`, shellArgs: { command: `${label} runs a program` } });
  await crashed.release();
  const originalRunRef = crashed.runRef;
  const created = await reviewOf(h, originalRunRef);
  expect(created.status).toBe('ready');
  if (created.status !== 'ready') throw new Error('the review record must read');
  expect(created.value).toMatchObject({ status: 'pending_review', decisionReasons: [], activeRound: null });

  const modelReview = createScriptedModel([
    { kind: 'calls', calls: [{ callId: `${label}-conclusion`, name: 'record_unknown_call_review',
      args: { item: 1, verdict: 'done', evidence: `${label} the shell call reached its end`,
        crashSuspicion: { verdict: 'unlikely', evidence: `${label} the command leaves no crash trace` } } }] },
    { kind: 'text', text: `${label} review round wrote its conclusion` },
  ]);
  const reviewRoot = await openReviewWorkRoot(h, modelReview);
  try {
    const startStop = await driveReviewUntil(reviewRoot, h.select(`${label}-review`, AG2B_WORK_TASK_ID),
      performs('start'));
    const prepared = preparedOf(startStop.stopped);
    await reviewRoot.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
      requestId: `${label}-review-start` });
  } finally {
    await reviewRoot.close();
  }
  const settled = await h.advance(h.select(`${label}-settle`, AG2B_WORK_TASK_ID),
    { stopBefore: performs('requeue_task') });
  expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');

  const record = await reviewOf(h, originalRunRef);
  expect(record.status).toBe('ready');
  if (record.status !== 'ready') throw new Error('the settled record must read');
  expect(record.value).toMatchObject({ status: 'needs_decision', activeRound: null,
    decisionReasons: ['confirm_each_step'] });
  return { originalRunRef, record: record.value, card: reviewCardOf(await queueOf(h)) };
}

async function answerCard(h: HostScenario, card: DecisionCardV1, optionId: string, requestId: string,
): Promise<ReadResult<ResolveDecisionReadV1>> {
  return await h.post<ReadResult<ResolveDecisionReadV1>>('decisions/answer', graphWrite(AG2B_SCOPE, {
    source: card.source, selection: { kind: 'option', optionId } as DecisionSelectionV1,
    text: '', annotations: [],
  }, requestId, card.source.pins));
}

describe('K3-18 (一) one card in an every_step flow', () => {
  it('K3-18 (一): a rerun_as_is answer confirms the automatic requeue; the review card is the only card and no system_requeue confirmation appears', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    await setEveryStep(h);
    const { originalRunRef, record, card } = await needsDecisionCard(h, 'k3-18-one');

    // Before the answer the one review card is waiting; the crash restart also listed its one
    // interrupted-pending-resume record as a Goal card, and no confirmation cause.
    const beforeQueue = await queueOf(h);
    expect(beforeQueue.waitingAnswer.filter(entry => entry.source.kind === 'goal_cause'
      && (JSON.parse(entry.source.key) as { code: string }).code === 'interrupted_pending_resume'),
    'the restart records one interrupted-pending-resume card').toHaveLength(1);
    const otherCards = beforeQueue.waitingAnswer.filter(entry => entry.source.kind !== 'goal_cause'
      || (JSON.parse(entry.source.key) as { code: string }).code !== 'interrupted_pending_resume');
    expect(otherCards).toHaveLength(1);
    expect(otherCards[0]!.source.kind).toBe('unknown_call_review');
    expect(confirmationCardsOf(beforeQueue)).toEqual([]);
    expect(record.decisionReasons).toEqual(['confirm_each_step']);

    const applied = await answerCard(h, card, 'rerun_as_is', 'k3-18-one-answer');
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    if (applied.status !== 'ready') return;
    const action = applied.value.action as WriteResult<UnknownCallReviewV1>;
    expect(action, JSON.stringify(action)).toMatchObject({ status: 'committed', value: {
      status: 'resolved', activeRound: null, disposition: { choice: 'rerun_as_is', source: 'card', hold: null } } });

    // The Task projection consumes the applied disposition as the requeue's confirmation.
    const confirmedRow = await h.taskRow();
    expect(confirmedRow.failure?.unknownCallReview).toEqual({ status: 'resolved', hold: null, requeueConfirmed: true });
    const afterQueue = await queueOf(h);
    expect(afterQueue.waitingAnswer.filter(entry => entry.source.kind === 'unknown_call_review')).toEqual([]);
    expect(confirmationCardsOf(afterQueue)).toEqual([]);

    // The same answer confirms the ONE automatic requeue: it commits and its
    // continuation is claimed with NO confirmation card to answer.
    const driven = await h.advance(h.select('k3-18-one-continue', AG2B_WORK_TASK_ID),
      { stopBefore: performs('start') });
    expect(driven.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining(['requeue_task', 'claim_task']));
    expect(driven.steps.some(step => (step.reason ?? '').startsWith('automation_confirmation_required')),
      'no system_requeue confirmation is derived').toBe(false);
    const continued = await taskRowOf(h);
    expect(continued.rework?.entries ?? [], 'exactly one TaskRequeue').toHaveLength(1);
    if (continued.execution === null || continued.execution.runId === originalRunRef.runId) {
      throw new Error('the confirmed automatic requeue must claim a new continuation Run');
    }

    // The whole flow had exactly ONE card besides the restart's interruption record: the review card read before the answer.
    expect({ waiting: otherCards.length, answers: beforeQueue.answeredPendingApplication.length })
      .toEqual({ waiting: 1, answers: 0 });
    const finalQueue = await queueOf(h);
    expect(finalQueue.waitingAnswer.filter(entry => entry.source.kind === 'unknown_call_review')).toEqual([]);
    expect(confirmationCardsOf(finalQueue)).toEqual([]);
  }, 300_000);
});
