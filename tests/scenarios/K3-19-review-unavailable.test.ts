/**
 * K3-19 (一) (L13/L16, spec line 1433; R2): the read-only command is unusable
 * (the Host switch is off). A `pending_review` record with one `process` item
 * must be settled by `settle_review` with `review_unavailable`: NO review round
 * opens and there are ZERO model calls, every process item becomes
 * `undetermined` with the fixed sentence `只读命令用不了`, and the status becomes
 * `needs_decision`.
 *
 * The Workflow reaches this through UR2: `reviewGate` sees `reviewCapability`
 * unavailable. The scenario Host's own Runtime grant is the AG2b work grant
 * (`tests/scenarios/harness.ts` `AG2B_WORK_TOOLS`), which has no
 * `run_readonly_command` and no `readonlyCommandAccess`, so the capability is
 * unavailable there; the crash Run is prepared on `openShellWorkRoot` only
 * because it needs the `shell` grant. The record is read only through
 * `unknown-call-reviews/read`.
 *
 * The card part of the row (the `needs_decision` card, group 4) is left for
 * group 4; this file asserts the record only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { answerCard, crashOneCommand } from './support/review-card-round.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readGoal } from '../helpers/A2-restart-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { readGoalSettings } from '../../src/core/work-graph/persistence/record-codecs.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';

// The KE6 stand-in (K3-19 (二)): `reviewCapability` probes the read-only sandbox;
// the switch makes it unavailable without a host process. The scenario Host's
// own grant has no `run_readonly_command`, so K3-19 (一) never probes at all.
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
});

// --- The shell seam (the process call RUN-25 leaves in flight) --------------
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

/** The K3-19 card part: the public decision queue on the same Host. */
async function reviewCardOf(h: HostScenario, record: UnknownCallReviewV1): Promise<DecisionCardV1 | undefined> {
  const read = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer'], page: { limit: 100 } }));
  if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  const card = read.value.waitingAnswer.find(entry => entry.source.key === key);
  if (card !== undefined) {
    expect(read.value.capabilities).toContainEqual({ source: 'unknown_call_review', availability: 'available' });
  }
  return card;
}

describe('K3-19 (一) review unavailable', () => {
  it('K3-19 (一): with the read-only command unusable the Workflow opens no round (zero model calls) and settles the pending_review record review_unavailable with every item undetermined', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const crashed = await crashOneCommand(h, { callId: 'k3-19-shell', select: 'k3-19-a',
      requestId: 'k3-19-a-start', shellArgs: { command: 'k3-19 runs a program' } });
    await crashed.release();
    const origin = crashed.runRef;

    const created = await reviewOf(h, origin);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(created.value).toMatchObject({ status: 'pending_review', activeRound: null, rounds: [] });
    expect(created.value.items).toHaveLength(1);
    expect(created.value.items[0]).toMatchObject({ kind: 'process', observed: { verdict: 'pending', by: null } });

    // UR2: the gate sees `reviewCapability` unavailable and returns the
    // `settle_review{review_unavailable}` step, never a claim/prepare/start of a
    // round. Drive to that step first, then perform it.
    const toSettle = await h.advance(h.select('k3-19', AG2B_WORK_TASK_ID), { stopBefore: performs('settle_review') });
    expect(toSettle.state).toBe('stopped');
    const opened = toSettle.receipts.map(receipt => receipt.kind);
    expect(opened).not.toContain('claim_task');
    expect(opened).not.toContain('prepare');
    expect(opened).not.toContain('start');
    expect(toSettle.next?.kind).toBe('perform');
    if (toSettle.next === null || toSettle.next.kind !== 'perform') return;
    expect(toSettle.next.operation.kind).toBe('settle_review');
    expect((toSettle.next.operation.request as { input?: { cause?: string } }).input?.cause).toBe('review_unavailable');
    // No round opened, so the scripted model was never asked anything.
    expect(h.modelCalls()).toBe(0);

    const done = await h.advance(toSettle.next, { stopBefore: performs('requeue_task') });
    expect(done.receipts.map(receipt => receipt.kind)).toContain('settle_review');
    expect(h.modelCalls()).toBe(0);

    const settled = await reviewOf(h, origin);
    expect(settled.status).toBe('ready');
    if (settled.status !== 'ready') return;
    expect(settled.value).toMatchObject({ status: 'needs_decision', activeRound: null, rounds: [],
      decisionReasons: ['review_unavailable', 'undetermined', 'crash_undetermined'] });
    expect(settled.value.items[0]!.observed).toMatchObject({
      verdict: 'undetermined', by: 'settlement', evidence: '只读命令用不了',
      crashSuspicion: { verdict: 'undetermined' },
    });

    // K3-19 (一) card part: the `review_unavailable` record is needs_decision
    // and its four-option process-item card is waiting in the queue.
    const card = await reviewCardOf(h, settled.value);
    expect(card, 'the needs_decision review record has its card').toBeDefined();
    expect(card).toMatchObject({ state: 'waiting_answer', readOnly: false, actions: ['answer'],
      source: { kind: 'unknown_call_review', subject: { kind: 'goal', goalRef: { goalId: AG2B_GOAL_REF.goalId } } },
      options: [{ id: 'rerun_as_is' }, { id: 'safer_method' }, { id: 'skip_as_done' }, { id: 'handle_myself' }] });
  }, 240_000);
});

/**
 * K3-19 (二): the switch is turned off only AFTER the person chose the safer
 * method. The record is already `awaiting_proposal`; the Workflow must open NO
 * proposal round, make zero model calls, and settle `review_unavailable` +
 * `proposal_missing` (UCR-08c).
 *
 * The first card is a clean `confirm_each_step` card (a review round wrote
 * `done` / `unlikely` for the one process item), so the final reason list is
 * exactly the two L17 reasons once the person returns the Goal to the default
 * autonomy (otherwise the setting itself would still be a third reason).
 */
describe('K3-19 (二) review unavailable after safer_method', () => {
  it('K3-19 (二): with the read-only command off the Workflow opens no proposal round (zero model calls) and settles review_unavailable + proposal_missing with the four-option card', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });

    // The real `goals/settings/set` route makes the first clean card possible.
    const beforeSet = await readGoal(h.host);
    expect(await h.post<WriteResult<GoalSnapshot>>('goals/settings/set', graphWrite(AG2B_SCOPE, {
      goalRef: AG2B_GOAL_REF, autonomy: 'every_step', waitForGoalRef: null,
    }, 'k3-19-2-set-every-step', [{ ref: AG2B_GOAL_REF, revision: beforeSet.revision }])))
      .toMatchObject({ status: 'committed' });
    expect(readGoalSettings(await readGoal(h.host)).autonomy).toBe('every_step');

    const crashed = await crashOneCommand(h, { callId: 'k3-19-2-shell', select: 'k3-19-2-a',
      requestId: 'k3-19-2-a-start', shellArgs: { command: 'k3-19-2 runs a program' } });
    await crashed.release();
    const origin = crashed.runRef;
    const created = await reviewOf(h, origin);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(created.value).toMatchObject({ status: 'pending_review', activeRound: null, rounds: [] });

    // A real review round writes a clean conclusion; `confirm_each_step` is the
    // one reason, so the process item stays `done` / `unlikely`.
    const modelReview = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-19-2-conclusion', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'K3-19 (二) the command had finished',
          crashSuspicion: { verdict: 'unlikely', evidence: 'K3-19 (二) no crash trace' } } }] },
      { kind: 'text', text: 'K3-19 (二) review round wrote its conclusion' },
    ]);
    const reviewRoot = await openReviewWorkRoot(h, modelReview);
    try {
      const startStop = await driveReviewUntil(reviewRoot, h.select('k3-19-2-review', AG2B_WORK_TASK_ID),
        performs('start'));
      await reviewRoot.runtime.startRun(hostCtx(), { prepared: preparedOf(startStop.stopped),
        consumerId: AG2B_CONSUMER_ID, requestId: 'k3-19-2-review-start' });
    } finally {
      await reviewRoot.close();
    }
    const settledReview = await h.advance(h.select('k3-19-2-review-settle', AG2B_WORK_TASK_ID),
      { stopBefore: performs('requeue_task') });
    expect(settledReview.receipts.map(receipt => receipt.kind)).toContain('settle_review');

    const cardRecord = await reviewOf(h, origin);
    expect(cardRecord.status).toBe('ready');
    if (cardRecord.status !== 'ready') throw new Error(JSON.stringify(cardRecord));
    expect(cardRecord.value).toMatchObject({ status: 'needs_decision', activeRound: null,
      decisionReasons: ['confirm_each_step'],
      items: [{ observed: { verdict: 'done', by: 'review_round',
        crashSuspicion: { verdict: 'unlikely' } } }] });
    const card = await reviewCardOf(h, cardRecord.value);
    expect(card, 'the clean confirm_each_step card is waiting').toBeDefined();
    if (card === undefined) return;

    // The person answers `safer_method`; the record enters awaiting_proposal.
    const answered = await answerCard(h, card, 'safer_method', 'k3-19-2-answer');
    expect(answered, JSON.stringify(answered)).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    const awaiting = await reviewOf(h, origin);
    expect(awaiting).toMatchObject({ status: 'ready', value: { status: 'awaiting_proposal',
      activeRound: null, proposals: [], stateEntry: cardRecord.value.stateEntry + 1 } });

    // Back to the default autonomy: no `confirm_each_step` in the final reasons.
    const beforeReset = await readGoal(h.host);
    expect(await h.post<WriteResult<GoalSnapshot>>('goals/settings/set', graphWrite(AG2B_SCOPE, {
      goalRef: AG2B_GOAL_REF, autonomy: 'after_plan_confirmation', waitForGoalRef: null,
    }, 'k3-19-2-reset-autonomy', [{ ref: AG2B_GOAL_REF, revision: beforeReset.revision }])))
      .toMatchObject({ status: 'committed' });
    expect(readGoalSettings(await readGoal(h.host)).autonomy).toBe('after_plan_confirmation');

    // The read-only command is now unusable. The Workflow's gate settles BEFORE
    // claiming any proposal round, so its scripted model is never asked anything.
    sandbox.available = false;
    const finalModel = createScriptedModel([{ kind: 'text', text: 'K3-19 (二) never called' }]);
    const finalRoot = await openReviewWorkRoot(h, finalModel);
    let settledKinds: string[] = [];
    try {
      const toSettle = await driveReviewUntil(finalRoot, h.select('k3-19-2-settle', AG2B_WORK_TASK_ID),
        performs('settle_review'));
      settledKinds = toSettle.receipts.map(receipt => receipt.kind);
      expect(toSettle.stopped.kind).toBe('perform');
      if (toSettle.stopped.kind !== 'perform') return;
      expect(toSettle.stopped.operation.kind).toBe('settle_review');
      expect((toSettle.stopped.operation.request as { input?: { cause?: string } }).input?.cause)
        .toBe('review_unavailable');
      const done = await finalRoot.workflow.advanceWork(hostCtx(), toSettle.stopped);
      expect(done).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review' } } });
      expect(finalModel.calls()).toBe(0);
    } finally {
      await finalRoot.close();
    }
    // No proposal round opened: no claim/prepare/start receipt at all.
    expect(settledKinds).not.toContain('claim_task');
    expect(settledKinds).not.toContain('prepare');
    expect(settledKinds).not.toContain('start');

    const settled = await reviewOf(h, origin);
    expect(settled.status).toBe('ready');
    if (settled.status !== 'ready') throw new Error(JSON.stringify(settled));
    expect(settled.value).toMatchObject({ status: 'needs_decision', activeRound: null,
      decisionReasons: ['review_unavailable', 'proposal_missing'] });
    expect(settled.value.items[0]!.observed).toMatchObject({ verdict: 'done', by: 'review_round' });

    const fourOptionCard = await reviewCardOf(h, settled.value);
    expect(fourOptionCard).toMatchObject({ state: 'waiting_answer', readOnly: false, actions: ['answer'],
      options: [{ id: 'rerun_as_is' }, { id: 'safer_method' }, { id: 'skip_as_done' }, { id: 'handle_myself' }] });
  }, 300_000);
});
