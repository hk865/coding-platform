/**
 * K3-17 (L18/L19): the review card's answer shape through the public
 * `decisions/answer` route.
 *
 * A real `needs_decision` record is produced by the real Workflow without a
 * review round (the Host binding grants `run_readonly_command` but not `read`,
 * so the record settles `review_unavailable`). Then:
 * - text only (`{kind:'other'}`) is `invalid` and writes nothing;
 * - an option that is not on the card is `invalid` and writes nothing;
 * - answering while the Goal is paused is ACCEPTED (the answer commits and the
 *   card becomes `answered_pending_application`; nothing applies it yet); after
 *   the Goal resumes, the Workflow's next selection applies it (UR7) and the
 *   continuation's brief carries the answer's 附言 and annotation lines;
 * - after the record moved to revision 2 (the human direct "I'll handle it"),
 *   an answer to the revision-1 card is `revision_conflict`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { preparedBriefOf } from './support/brief.js';
import { continuationBriefDigest, renderContinuationBriefZh } from '../../src/contracts/continuation-brief.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { driveReviewUntil, openMissingReadReviewRoot } from './support/review-work-root.js';
import { crashOneCommand } from './support/review-card-round.js';
import { goalControlled } from './support/control.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { answer as postAnswer, cleanupRestart } from '../helpers/A2-restart-fixture.js';
import {
  AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { DecisionSelectionV1, DecisionAnnotationV1 } from '../../src/contracts/goal-decisions.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
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
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}



async function settleKeyUnavailable(h: HostScenario, label: string): Promise<RunRef> {
  const crashed = await crashOneCommand(h, { callId: `${label}-shell`, select: `${label}-a`,
    requestId: `${label}-a-start`, shellArgs: { command: `${label} runs a program` } });
  await crashed.release();
  const origin = crashed.runRef;
  const reviewRoot = await openMissingReadReviewRoot(h, { label, hostInstanceId: 'wp2-scenario-host' });
  try {
    const toSettle = await driveReviewUntil(reviewRoot, h.select(`${label}-settle`, AG2B_WORK_TASK_ID),
      performs('settle_review'));
    const settled = await reviewRoot.workflow.advanceWork(hostCtx(), toSettle.stopped);
    expect(settled).toMatchObject({ status: 'ready', value: { receipt: { kind: 'settle_review' } } });
  } finally {
    await reviewRoot.close();
  }
  const record = await reviewOf(h, origin);
  expect(record).toMatchObject({ status: 'ready', value: { status: 'needs_decision' } });
  return origin;
}

async function queue(h: HostScenario): Promise<DecisionQueueReadV1> {
  const read = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE,
      sections: ['waiting_answer', 'answered_pending_application', 'history'], page: { limit: 100 } }));
  if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function reviewCard(h: HostScenario): Promise<DecisionCardV1> {
  const cards = (await queue(h)).waitingAnswer.filter(card => card.source.kind === 'unknown_call_review');
  expect(cards).toHaveLength(1);
  return cards[0]!;
}

async function answer(h: HostScenario, card: DecisionCardV1, selection: DecisionSelectionV1,
  text: string, requestId: string, annotations: DecisionAnnotationV1[] = []): Promise<Record<string, unknown>> {
  return await postAnswer(h.host, 'decisions/answer', graphWrite(AG2B_SCOPE,
    { source: card.source, selection, text, annotations }, requestId, card.source.pins));
}

describe('K3-17 review card answer shape', () => {
  it('K3-17: text only/off-card are invalid and write nothing; an unpaused option answer is applied in the same call; an old revision is revision_conflict', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    await settleKeyUnavailable(h, 'k3-17-applied');
    const card = await reviewCard(h);
    expect(card.options.map(option => option.id)).toEqual(['rerun_as_is', 'safer_method', 'skip_as_done', 'handle_myself']);

    const textOnly = await answer(h, card, { kind: 'other' }, 'I would rather explain', 'k3-17-text-only');
    expect(textOnly).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'the answer names neither a stored option nor the explicit other selection' });
    expect((await queue(h)).waitingAnswer.filter(entry => entry.source.key === card.source.key))
      .toMatchObject([{ state: 'waiting_answer', answerMessageRef: null }]);

    const offCard = await answer(h, card, { kind: 'option', optionId: 'approve' }, '', 'k3-17-off-card');
    expect(offCard).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect((await queue(h)).waitingAnswer.filter(entry => entry.source.key === card.source.key))
      .toMatchObject([{ state: 'waiting_answer', answerMessageRef: null }]);

    // The final composition applies the answer in the SAME call (U6 adapter).
    const accepted = await answer(h, card, { kind: 'option', optionId: 'rerun_as_is' }, '', 'k3-17-applied');
    expect(accepted).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    const read = await queue(h);
    const applied = [...read.waitingAnswer, ...read.answeredPendingApplication, ...read.history]
      .filter(entry => entry.source.key === card.source.key);
    expect(applied).toMatchObject([{ state: 'applied' }]);
    expect(applied[0]!.application).not.toBeNull();

    // The application moved the record; the revision-1 card is now stale.
    const older = await answer(h, card, { kind: 'option', optionId: 'rerun_as_is' }, '', 'k3-17-older');
    expect(older).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  }, 240_000);

  it('K3-17: a paused Goal accepts the answer but the application waits; after resume the Workflow applies it and the continuation keeps the 附言 and annotation', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass',
      script: { replies: [{ kind: 'text', text: 'K3-17 continuation' }] } });
    const origin = await settleKeyUnavailable(h, 'k3-17-paused');
    const card = await reviewCard(h);

    // Actually pause the Goal through the public control route before answering.
    const paused = await goalControlled(h.host, 'pause', 'k3-17-pause');
    expect(paused.goal).toMatchObject({ desiredState: 'paused' });
    // Re-read the card after the pause: its identity is unchanged, but the
    // Goal pin in `source.pins` now names the paused revision.
    const pausedCard = await reviewCard(h);
    expect(pausedCard.source.key).toBe(card.source.key);
    expect(pausedCard.source.pins).toEqual(card.source.pins.filter(pin => pin.ref.aggregateType !== 'Goal')
      .concat([{ ref: card.source.goalRef, revision: paused.goal.revision }]));

    // L18: the answer carries the 附言 and one annotation on the record object
    // (`card.objects[0]`); the object key IS the card object's canonical JSON.
    const recordObject = pausedCard.objects[0]!;
    const accepted = await answer(h, pausedCard, { kind: 'option', optionId: 'rerun_as_is' }, 'while paused',
      'k3-17-paused-answer', [{ objectKey: canonicalJson(recordObject as unknown as JsonValue), text: '先核实' }]);
    expect(accepted).toMatchObject({ status: 'ready', value: { state: 'awaiting_resume' } });
    const read = await queue(h);
    const answered = [...read.waitingAnswer, ...read.answeredPendingApplication, ...read.history]
      .filter(entry => entry.source.key === card.source.key);
    expect(answered).toMatchObject([{ state: 'answered_pending_application', application: null }]);
    expect(answered[0]!.answerMessageRef).not.toBeNull();
    const answerRef = answered[0]!.answerMessageRef!;

    const record = await reviewOf(h, origin);
    expect(record).toMatchObject({ status: 'ready', value: { status: 'needs_decision',
      disposition: null } });

    // Resume the Goal with automation off: the answer waits no longer; the next
    // ordinary selection applies it (UR7) and its ③ application records the
    // continuation. Stop before its start to read the prepared brief.
    const resumed = await goalControlled(h.host, 'resume', 'k3-17-resume');
    expect(resumed.goal).toMatchObject({ desiredState: 'active' });
    const driven = await h.advance(h.select('k3-17-after-resume', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    expect(driven.receipts.map(receipt => receipt.kind)).toContain('apply_review_disposition');

    expect(await reviewOf(h, origin)).toMatchObject({ status: 'ready', value: { status: 'resolved',
      disposition: { choice: 'rerun_as_is', source: 'card', text: 'while paused', hold: null } } });
    const appliedRead = await queue(h);
    expect(appliedRead.answeredPendingApplication.filter(entry => entry.source.key === card.source.key)).toEqual([]);
    expect(appliedRead.history.filter(entry => entry.source.key === card.source.key)).toMatchObject([{ state: 'applied' }]);
    const message = await h.post<ReadResult<Record<string, unknown>>>('messages/read', plain(AG2B_SCOPE, answerRef));
    expect(message.status).toBe('ready');
    if (message.status !== 'ready') throw new Error(`the answer must be readable: ${JSON.stringify(message)}`);
    expect(message.value.application).not.toBeNull();
    expect(h.ledgerEventTypes().filter(type => type === 'TaskRequeued')).toEqual(['TaskRequeued']);

    // L18/L20: the continuation brief's review section carries the literal
    // 附言 part of the disposition line and the record object's annotation line.
    const next = driven.next;
    if (next === null) throw new Error('the continuation must stop before its start');
    const prepared = preparedOf(next);
    const brief = await preparedBriefOf(h, prepared.envelope.bundleRef);
    const note = renderContinuationBriefZh(brief, continuationBriefDigest(brief));
    expect(note).toContain('；附言：while paused。');
    expect(note).toContain('- 批注（这份核对记录）：先核实');

    // Let the continuation run and the flow settle.
    const settled = await h.advance(next);
    expect(['completed', 'waiting']).toContain(settled.state);
  }, 300_000);
});
