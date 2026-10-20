/**
 * K3-29 / L28 step 6b (c): the two start-up variants from A's UNSPECIFIED 5,
 * rebuilt for real on the Host (SQLite), plus the `safer_method` state entry.
 *
 * The bindings resolve the question "a record that had a round and whose card
 * was answered held" (an answered card cannot coexist with a running round,
 * UCR-03/UCR-11): the record first runs a REAL review round (RUN-25 →
 * `pending_review`, one round writes `partial`, `settle_review` gives
 * `needs_decision` with `rounds` length 1), the card is answered through the
 * public `decisions/answer` route, and the Host is restarted on the same
 * SQLite files so the real start-up reconcile and re-drive run.
 *
 * - (a) `handle_myself` with ③ booked: the held record has `open = 'no'`, so
 *   L28 2b lists no row and no candidate hands the Goal over; the restart
 *   changes nothing.
 * - (b) `handle_myself` with ③ failing (`failCommitOf`): 6b (c) kind 4 hands
 *   the answer over by its own `reviewRef`; UR7b replays ② and records ③. The
 *   record stays held and the Task stays stopped.
 * - (c) `safer_method`: `awaiting_proposal` at `stateEntry + 1`; 6b (c) kind 1
 *   hands the Goal over with the record's Task id, and the test stops at the
 *   state entry (the proposal round is B2's).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, performs, waitFor } from './harness.js';
import { redrivePolicy } from './support/common.js';
import { answerCard, needsDecisionCard, proposalRound, queueOf, reviewOf } from './support/review-card-round.js';
import { failCommitOf } from './support/receipts.js';
import { expectQuietHarnessRestart } from './support/restart.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { ResolveDecisionReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';

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

/** One answer through the public route, read as the owner's ready result. */
async function answer(h: HostScenario, card: Parameters<typeof answerCard>[1], optionId: string, requestId: string,
): Promise<ResolveDecisionReadV1> {
  const answered = await answerCard(h, card, optionId, requestId);
  expect(answered, JSON.stringify(answered)).toMatchObject({ status: 'ready' });
  if (answered.status !== 'ready') throw new Error(`the answer must be ready: ${JSON.stringify(answered)}`);
  return answered.value;
}

function messageApplication(h: HostScenario, ref: SessionMessage['ref']): Promise<ReadResult<SessionMessage>> {
  return h.post<ReadResult<SessionMessage>>('messages/read', plain(AG2B_SCOPE, ref));
}

describe('K3-29 step 6b (c) variant: a record with a round, its card answered handle_myself', () => {
  it('K3-29 variant (a): ③ booked keeps the held record closed, so a redrive-on restart lists no review and hands nothing over', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const { originalRunRef, record, card } = await needsDecisionCard(h, 'k3-29-va');
    expect(record.rounds).toHaveLength(1);

    const applied = await answer(h, card, 'handle_myself', 'k3-29-va-answer');
    expect(applied).toMatchObject({ state: 'applied' });

    const before = await reviewOf(h, originalRunRef);
    expect(before.status).toBe('ready');
    if (before.status !== 'ready') throw new Error(JSON.stringify(before));
    expect(before.value).toMatchObject({
      status: 'resolved', open: 'no', activeRound: null,
      disposition: { choice: 'handle_myself', source: 'card', hold: 'held' },
    });
    expect(before.value.rounds).toHaveLength(1);

    const restarted = await h.restart({ automation: redrivePolicy(true) });
    expect(restarted.report?.reviews.filter(line => line.ref === JSON.stringify(record.ref))).toEqual([]);
    expect(restarted.report?.redriveGoals).toEqual([]);
    expect(await reviewOf(h, originalRunRef)).toEqual(before);
    expect((await h.taskRow()).execution).toEqual(originalRunRef);
    expect(h.ledgerEventTypes().filter(type => type === 'TaskRequeued')).toEqual([]);

    const quiet = await expectQuietHarnessRestart(h, 'K3-29 variant (a): a final restart');
    expect(quiet.report?.redriveGoals).toEqual([]);
  }, 300_000);

  it('K3-29 variant (b): a failed ③ leaves the held record equal; the redrive-on restart hands the answer over (kind 4) and records it', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const { originalRunRef, record, card } = await needsDecisionCard(h, 'k3-29-vb');
    expect(record.rounds).toHaveLength(1);

    const fault = failCommitOf(h.database, 'SessionMessageDecisionApplied');
    let applied: ResolveDecisionReadV1;
    try {
      applied = await answer(h, card, 'handle_myself', 'k3-29-vb-answer');
    } finally {
      fault.drop();
    }
    expect(applied).toMatchObject({ state: 'application_not_recorded',
      answer: { status: 'committed' }, action: { status: 'committed' }, application: { status: 'rejected' } });
    if (applied.answer.status !== 'committed') throw new Error(JSON.stringify(applied.answer));
    const answerRef = applied.answer.value.ref;

    const before = await reviewOf(h, originalRunRef);
    expect(before.status).toBe('ready');
    if (before.status !== 'ready') throw new Error(JSON.stringify(before));
    expect(before.value).toMatchObject({
      status: 'resolved', open: 'no', activeRound: null,
      disposition: { choice: 'handle_myself', source: 'card', hold: 'held' },
    });
    expect(before.value.rounds).toHaveLength(1);

    const restarted = await h.restart({ automation: redrivePolicy(true) });
    expect(restarted.report?.redriveGoals).toEqual([{
      goalRef: AG2B_GOAL_REF, scope: { ...AG2B_SCOPE }, taskIds: [],
      answers: [{ kind: 'unknown_call_review', reviewRef: record.ref, answerMessageRef: answerRef }],
    }]);

    const appliedRead = await waitFor(() => messageApplication(h, answerRef),
      read => read.status === 'ready' && read.value.application !== null,
      'UR7b to record the answer application');
    if (appliedRead.status !== 'ready') throw new Error(JSON.stringify(appliedRead));
    expect(appliedRead.value.application).toMatchObject({ schemaVersion: 1 });

    expect(await reviewOf(h, originalRunRef)).toEqual(before);
    expect((await h.taskRow()).execution).toEqual(originalRunRef);
    expect(h.ledgerEventTypes().filter(type => type === 'TaskRequeued')).toEqual([]);

    const quiet = await expectQuietHarnessRestart(h, 'K3-29 variant (b): a final restart');
    expect(quiet.report?.redriveGoals).toEqual([]);
  }, 300_000);
});

describe('K3-29 step 6b (c) variant: a record answered safer_method', () => {
  it('K3-29 variant (c): a real safer_method answer enters awaiting_proposal at stateEntry+1; kind 1 hands the Goal over and the record stays', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const { originalRunRef, record, card } = await needsDecisionCard(h, 'k3-29-vc');
    expect(record.rounds).toHaveLength(1);

    const applied = await answer(h, card, 'safer_method', 'k3-29-vc-answer');
    expect(applied).toMatchObject({ state: 'applied' });

    const before = await reviewOf(h, originalRunRef);
    expect(before.status).toBe('ready');
    if (before.status !== 'ready') throw new Error(JSON.stringify(before));
    expect(before.value).toMatchObject({
      status: 'awaiting_proposal', open: 'yes', stateEntry: record.stateEntry + 1,
      proposals: [], activeRound: null,
    });
    expect(before.value.rounds).toHaveLength(1);

    const restarted = await h.restart({ automation: redrivePolicy(false) });
    expect(restarted.report?.reviews).toContainEqual({
      ref: JSON.stringify(record.ref), row: 'UCR', status: 'left', reason: 'awaiting_proposal',
    });
    expect(restarted.report?.redriveGoals).toEqual([{
      goalRef: AG2B_GOAL_REF, scope: { ...AG2B_SCOPE }, taskIds: [AG2B_WORK_TASK_ID],
    }]);
    expect(await reviewOf(h, originalRunRef)).toEqual(before);

    // B2 continues here: the restart above left the record at
    // `awaiting_proposal`; the normal Workflow now drives the real proposal
    // round through `propose_safer_method` to `awaiting_approval`. No restart is
    // involved, so the restart report gains no new row for this round.
    const proposalModel = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-29-vc-proposal', name: 'propose_safer_method',
        args: { item: 1, command: 'echo safer', cwd: '.', rationale: 'K3-29 variant (c) safer command' } }] },
      { kind: 'text', text: 'K3-29 variant (c) proposal round finished' },
    ]);
    const round = await proposalRound(h, { model: proposalModel, select: 'k3-29-vc-proposal',
      requestId: 'k3-29-vc-proposal-start' });
    let proposalRunRef: RunRef | null = null;
    try {
      proposalRunRef = round.runRef;
      const startResult = await round.start();
      expect(startResult).toMatchObject({ status: 'ready' });
    } finally {
      await round.close();
    }
    expect(proposalRunRef).not.toBeNull();
    expect(restarted.report?.runs.filter(row => proposalRunRef !== null
      && row.ref === JSON.stringify(proposalRunRef))).toEqual([]);

    const settled = await h.advance(h.select('k3-29-vc-settle', AG2B_WORK_TASK_ID),
      { stopBefore: performs('requeue_task') });
    expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');

    const approved = await reviewOf(h, originalRunRef);
    expect(approved.status).toBe('ready');
    if (approved.status !== 'ready') throw new Error(JSON.stringify(approved));
    expect(approved.value).toMatchObject({ status: 'awaiting_approval', open: 'yes', activeRound: null,
      proposals: [{ alias: 1, command: 'echo safer', cwd: '.', rationale: 'K3-29 variant (c) safer command' }] });
    // K3-16 (L18/L20): the variant ends at the approval card itself — exactly
    // the two approval options with their fixed labels, pinned to the new revision.
    const queue = await queueOf(h);
    const approvalCards = queue.waitingAnswer.filter(card => card.source.kind === 'unknown_call_review');
    expect(approvalCards).toHaveLength(1);
    expect(approvalCards[0]).toMatchObject({
      state: 'waiting_answer', readOnly: false, actions: ['answer'],
      options: [
        { id: 'approve', label: '同意', effect: 'apply' },
        { id: 'decline', label: '不同意', effect: 'apply' },
      ],
    });
    expect(approvalCards[0]!.source.pins[0]).toMatchObject({ revision: approved.value.revision });
  }, 300_000);
});
