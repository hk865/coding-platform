/**
 * K3 group 4 reusable card round (K3-15, K3-29 variants): the ONE copy of the
 * "real review round → needs_decision → public card answer" setup.
 *
 * A `shell` call in flight is closed by RUN-25 (see the K3-15/K3-44
 * `crashShellRun` shape), then a real review round writes `partial` and
 * `settle_review` emits the `partial` card. The record therefore has one real
 * finished round (`rounds` length 1) and is `needs_decision`; the card is read
 * from the public `decisions/queue`, and `answerCard` goes through the one
 * public `decisions/answer` route (① answer ② disposition ③ application).
 *
 * The `vi.mock` blocks stay in the test files (hoisted per file): this module
 * imports the existing `shellSeam` and `createScriptedModel` seams instead of
 * duplicating them.
 *
 * Scripted model only; the read-only capability is the KE6 probe stand-in and
 * `shell` is the blocking seam (no host process).
 */
import { expect } from 'vitest';
import { HostScenario, hostCtx, performs } from '../harness.js';
import { preparedOf } from './common.js';
import { driveReviewUntil, openReviewWorkRoot } from './review-work-root.js';
import { openShellWorkRoot, prepareOn } from './shell-work-root.js';
import { createScriptedModel } from '../../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../../helpers/K3-tool-seams.js';
import {
  AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult } from '../../../src/contracts/core/results.js';
import type { DecisionAnnotationV1, DecisionSelectionV1 } from '../../../src/contracts/goal-decisions.js';
import type { RunRef } from '../../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../../src/contracts/unknown-call-review.js';
import type {
  DecisionCardV1, DecisionQueueReadV1, ResolveDecisionReadV1,
} from '../../../src/core/work-graph/model/decision-contracts.js';

/** The review record of one Run's origin, read through the public route. */
export function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

/** The public decision queue's waiting-answer section. */
export async function queueOf(h: HostScenario): Promise<DecisionQueueReadV1> {
  const read = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer'], page: { limit: 100 } }));
  if (read.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

/** The one waiting `unknown_call_review` card. */
export function cardOf(queue: DecisionQueueReadV1): DecisionCardV1 {
  const cards = queue.waitingAnswer.filter(card => card.source.kind === 'unknown_call_review');
  expect(cards).toHaveLength(1);
  return cards[0]!;
}

/** One `shell` call in flight, closed by RUN-25 on the crash restart; returns the original RunRef. */
export async function crashOneCommand(h: HostScenario, label: string): Promise<RunRef> {
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

/** A real review round settles the record to the `partial` card, read from the public queue. */
export async function needsDecisionCard(h: HostScenario, label: string): Promise<{
  originalRunRef: RunRef; record: UnknownCallReviewV1; card: DecisionCardV1;
}> {
  const originalRunRef = await crashOneCommand(h, label);
  const created = await reviewOf(h, originalRunRef);
  expect(created.status).toBe('ready');
  if (created.status !== 'ready') throw new Error('the review record must read');
  expect(created.value).toMatchObject({ status: 'pending_review', decisionReasons: [], activeRound: null });
  expect(created.value.items).toHaveLength(1);
  expect(created.value.items[0]).toMatchObject({ alias: 1, kind: 'process' });

  const modelReview = createScriptedModel([
    { kind: 'calls', calls: [{ callId: `${label}-conclusion`, name: 'record_unknown_call_review',
      args: { item: 1, verdict: 'partial', evidence: `${label} the shell call was only partly observed`,
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
    decisionReasons: ['partial'] });
  const queue = await queueOf(h);
  return { originalRunRef, record: record.value, card: cardOf(queue) };
}

/** One card option through the public `decisions/answer` route (① → ② → ③). */
export async function answerCard(h: HostScenario, card: DecisionCardV1, optionId: string, requestId: string,
  text = '', annotations: DecisionAnnotationV1[] = [],
): Promise<ReadResult<ResolveDecisionReadV1>> {
  return await h.post<ReadResult<ResolveDecisionReadV1>>('decisions/answer', graphWrite(AG2B_SCOPE, {
    source: card.source, selection: { kind: 'option', optionId } as DecisionSelectionV1,
    text, annotations,
  }, requestId, card.source.pins));
}
