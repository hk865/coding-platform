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
import { HostScenario, hostCtx, performs, type Platform } from '../harness.js';
import { preparedOf } from './common.js';
import { driveReviewUntil, openReviewWorkRoot } from './review-work-root.js';
import { openShellWorkRoot, prepareOn } from './shell-work-root.js';
import { createScriptedModel, type ScriptedModel } from '../../helpers/B2-runtime-fixture.js';
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

/**
 * One `shell` call in flight, closed by RUN-25 on the crash restart.
 *
 * The caller supplies the original identities and the exact `shell` arguments
 * so every migrated copy keeps its own call, flow and request ids and its real
 * restart report. The returned `release` is idempotent and also runs when the
 * helper itself throws; an immediate-release caller awaits it where its old
 * helper's `finally` released, while a deferred caller keeps it until its
 * original cleanup (the K3-29/K3-44 recovery shapes).
 */
export interface CrashOneCommandOptions {
  /** The scripted `shell` call's id. */
  callId: string;
  /** The `h.select` flow label that prepares the Run. */
  select: string;
  /** The Work task `h.select` binds; defaults to `AG2B_WORK_TASK_ID`. */
  taskId?: string;
  /** The Run start request id. */
  requestId: string;
  /** The exact `shell` tool arguments. */
  shellArgs: Record<string, unknown>;
}

export interface CrashOneCommandResult {
  runRef: RunRef;
  prepared: ReturnType<typeof preparedOf>;
  report: Awaited<ReturnType<HostScenario['restart']>>;
  release(): Promise<void>;
}

export async function crashOneCommand(h: HostScenario,
  options: CrashOneCommandOptions): Promise<CrashOneCommandResult> {
  let rootA: Platform | null = null;
  let runningA: Promise<unknown> | null = null;
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    shellSeam.release();
    await runningA?.catch(() => undefined);
    await rootA?.close();
  };
  try {
    shellSeam.arm();
    const modelA = createScriptedModel([{ kind: 'calls', calls: [
      { callId: options.callId, name: 'shell', args: options.shellArgs }] }]);
    rootA = await openShellWorkRoot(h, modelA);
    const startA = await prepareOn(rootA, h.select(options.select, options.taskId ?? AG2B_WORK_TASK_ID));
    const prepared = preparedOf(startA);
    runningA = rootA.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
      requestId: options.requestId });
    await shellSeam.waitForCall();
    const report = await h.restart({ crash: true });
    return { runRef: prepared.claim.runRef, prepared, report, release };
  } catch (error) {
    await release();
    throw error;
  }
}

/**
 * The real proposal-phase round setup shared by K3-16 (proposal/approval) and
 * K3-29 variant (c): open the read-only root, prepare the round, and assert the
 * exact proposal tool set. `start` is bound to that prepared execution, so the
 * caller keeps its manifest/writeScope checks between prepare and start; the
 * answer card and settle stay in the caller.
 */
export interface ProposalRoundOptions {
  /** The scripted model of the proposal round. */
  model: ScriptedModel;
  /** The `h.select` flow label that prepares the proposal Run. */
  select: string;
  /** The proposal Run start request id. */
  requestId: string;
  /** The Work task `h.select` binds; defaults to `AG2B_WORK_TASK_ID`. */
  taskId?: string;
}

export interface ProposalRoundResult {
  prepared: ReturnType<typeof preparedOf>;
  runRef: RunRef;
  model: ScriptedModel;
  start(): ReturnType<Platform['runtime']['startRun']>;
  close(): Promise<void>;
}

export async function proposalRound(h: HostScenario, options: ProposalRoundOptions): Promise<ProposalRoundResult> {
  const root = await openReviewWorkRoot(h, options.model);
  try {
    const stop = await driveReviewUntil(root,
      h.select(options.select, options.taskId ?? AG2B_WORK_TASK_ID), performs('start'));
    const prepared = preparedOf(stop.stopped);
    expect(prepared.envelope.permissions.tools)
      .toEqual(['read', 'run_readonly_command', 'propose_safer_method']);
    return {
      prepared,
      runRef: prepared.claim.runRef,
      model: options.model,
      start: () => root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: options.requestId }),
      close: () => root.close(),
    };
  } catch (error) {
    await root.close();
    throw error;
  }
}

/** A real review round settles the record to the `partial` card, read from the public queue. */
export async function needsDecisionCard(h: HostScenario, label: string): Promise<{
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
