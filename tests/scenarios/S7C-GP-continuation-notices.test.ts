/**
 * GP-3: the `continuation` "请知悉" source.
 *
 * GP3-a follows the C3 pause → restart → 继续 path over the real Host: a person
 * pauses the entered Run, the next Host ends it paused-interrupted, the person's
 * `tasks/requeue` writes the TaskRequeue, and the next advance opens Run 2 with
 * a `resume_after_interruption` brief. Only once Run 2 actually entered does
 * `decisions/queue` show one `continuation` line; a requeue not yet entered,
 * a repeated read and a read after the returned token was marked seen add none.
 *
 * GP3-b is the RUN-25 control on the same public read: a Host takeover closes a
 * Run with a `takeover_unresolved` observation, the review disposition releases
 * the automatic recovery, and the successor Run enters with the same
 * `resume_after_interruption` brief. K3 keeps that successor on the existing
 * `automatic_rework` "自动恢复 · …（不计次）" line, so no `continuation` line is
 * added; removing the predecessor check makes the second line appear.
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import {
  AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution, submitControl } from '../helpers/A2-restart-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupScenarios, openHostScenario } from './harness.js';
import { NO_REDRIVE, briefOf, operatorRequeue, readCall, selectedRun } from './support/common.js';
import { crashOneCommand, reviewOf } from './support/review-card-round.js';

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

const crashHandles: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const release of crashHandles.splice(0)) await release();
  shellSeam.release();
  await cleanupScenarios();
});

/** The one `decisions/queue` notice read this file uses; `categories` is the caller's. */
async function continuationPage(
  h: Awaited<ReturnType<typeof openHostScenario>>,
  categories: readonly ('automatic_rework' | 'continuation')[],
): Promise<DecisionQueueReadV1> {
  const page = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue', plain(AG2B_SCOPE, {
    workspace: AG2B_SCOPE, sections: ['notices'], categories, page: { limit: 100 } }));
  if (page.status !== 'ready') throw new Error(`decisions/queue is not readable: ${JSON.stringify(page)}`);
  return page.value;
}

it('GP3-a: a Run actually entered after an interruption adds one continuation notice; a requeue not yet entered, a repeated read and a marked-seen read add none', async () => {
  let pause: Awaited<ReturnType<typeof submitControl>> | undefined;
  const scenario = await openHostScenario({ check: 'pass', automation: NO_REDRIVE,
    script: {
      replies: [readCall('gp3-run1'), { kind: 'text', text: 'GP3: the interrupted work continued' }],
      duringReply: async (index) => {
        if (index !== 0) return;
        pause = await submitControl(scenario.host, await selectedRun(scenario), 'pause',
          'the person pauses the Run', 'gp3-pause');
      },
    } });
  const h = scenario;

  expect((await h.advance(h.select('gp3-run1', AG2B_WORK_TASK_ID))).state).toBe('waiting');
  if (pause === undefined) throw new Error('the pause must have been submitted during the first model call');
  const run1 = await selectedRun(h);

  // The next Host ends Run 1 paused-interrupted; the person then continues it.
  expect((await h.restart({ staleLock: true })).report).toMatchObject({
    runs: [{ ref: JSON.stringify(run1), row: 'W-20', status: 'reconciled' }], problems: [] });
  const continued = await operatorRequeue(h.host, run1, 'gp3-continue', 'the person continues after the restart');
  expect(continued).toMatchObject({ status: 'committed', value: { kind: 'requeued',
    requeue: { failureClass: 'interrupted' } } });

  // Only requeued, not entered yet: no continuation line.
  expect((await continuationPage(h, ['continuation'])).notices).toEqual([]);

  // The continuation Run enters and ends; the brief says it resumed after the interruption.
  expect((await h.advance(h.select('gp3-run2', AG2B_WORK_TASK_ID))).state).toBe('completed');
  const run2 = await selectedRun(h);
  expect(run2.runId).not.toBe(run1.runId);
  const bound = await briefOf(h.host, run2);
  if (bound === null) throw new Error('Run 2 must carry a continuation brief');
  expect(bound.brief).toMatchObject({ mode: 'resume_after_interruption', failureClass: 'interrupted',
    previous: { runRef: run1 } });

  const first = await continuationPage(h, ['continuation']);
  expect(first.notices).toHaveLength(1);
  const notice = first.notices[0]!;
  expect(notice).toMatchObject({ category: 'continuation' });
  expect(notice.itemKey.startsWith('continuation:')).toBe(true);
  expect(notice.summary).toContain('接续');
  expect(notice.objects.map((object) => object.kind === 'aggregate' ? object.pin.ref : null)).toEqual([run1, run2]);
  expect(first.displayToken).not.toBeNull();

  // A repeated read does not duplicate the line.
  expect((await continuationPage(h, ['continuation'])).notices).toEqual([notice]);

  // Marking the displayed page seen removes it.
  const registration = await h.post<ReadResult<{ workspace: { ref: unknown; revision: number } }>>(
    'workspaces/registration', plain(AG2B_SCOPE, AG2B_SCOPE));
  if (registration.status !== 'ready') throw new Error(`the workspace registration is not readable: ${JSON.stringify(registration)}`);
  const marked = await h.post<{ status: string }>('decisions/notices/seen', graphWrite(AG2B_SCOPE, {
    workspace: AG2B_SCOPE, displayToken: first.displayToken, seenThrough: first.seenThrough,
  }, 'gp3-seen', [{ ref: registration.value.workspace.ref, revision: registration.value.workspace.revision }]));
  expect(marked).toMatchObject({ status: 'committed' });
  expect((await continuationPage(h, ['continuation'])).notices).toEqual([]);
}, 180_000);

it('GP3-b: a RUN-25 automatic recovery keeps its automatic-rework notice and adds no continuation notice', async () => {
  const h = await openHostScenario({ gitWorkspace: true, automation: NO_REDRIVE, check: 'pass',
    script: { replies: [{ kind: 'text', text: 'GP3: the RUN-25 recovery continued' }] } });
  const crashed = await crashOneCommand(h, { callId: 'gp3-run25-shell', select: 'gp3-run25-a',
    requestId: 'gp3-run25-a-start', shellArgs: { command: 'gp3 run25 runs a program' } });
  crashHandles.push(crashed.release);
  expect(crashed.report).toMatchObject({ report: { runs: [
    { ref: JSON.stringify(crashed.runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
      autoCleanup: { applied: true } }] } });
  const original = await readExecution(h.host, crashed.runRef);
  expect(original.run).toMatchObject({ status: 'ended', outcome: 'crashed',
    reconciliation: { observation: { kind: 'takeover_unresolved' } } });

  // A person releases the review hold; the next advance performs the automatic
  // recovery requeue and starts the successor Run.
  const review = await reviewOf(h, crashed.runRef);
  expect(review.status).toBe('ready');
  if (review.status !== 'ready') throw new Error(`the review record must read: ${JSON.stringify(review)}`);
  expect(review.value).toMatchObject({ status: 'pending_review', activeRound: null });
  const held = await h.post<WriteResult<UnknownCallReviewV1>>('unknown-call-reviews/hold', graphWrite(AG2B_SCOPE,
    { reviewRef: review.value.ref, text: null }, 'gp3-run25-hold',
    [{ ref: review.value.ref, revision: review.value.revision }]));
  expect(held).toMatchObject({ status: 'committed', value: { status: 'resolved',
    disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } } });
  if (held.status !== 'committed') throw new Error('the review hold must commit');
  const released = await h.post<WriteResult<{ hold: WriteResult<UnknownCallReviewV1>; requeue: unknown }>>(
    'unknown-call-reviews/release-hold', graphWrite(AG2B_SCOPE, { reviewRef: review.value.ref },
      'gp3-run25-release', [{ ref: review.value.ref, revision: held.value.revision }]));
  expect(released).toMatchObject({ status: 'committed', value: { requeue: null } });

  const driven = await h.advance(h.select('gp3-run25-continue', AG2B_WORK_TASK_ID));
  expect(driven.receipts.map((receipt) => receipt.kind))
    .toEqual(expect.arrayContaining(['requeue_task', 'claim_task', 'start']));
  const successor = (await h.taskRow()).execution;
  if (successor === null) throw new Error('the RUN-25 recovery must select a successor Run');
  expect(successor.runId).not.toBe(crashed.runRef.runId);
  expect((await readExecution(h.host, successor)).run.status).toBe('ended');
  const bound = await briefOf(h.host, successor);
  if (bound === null) throw new Error('the RUN-25 successor must carry a continuation brief');
  expect(bound.brief).toMatchObject({ mode: 'resume_after_interruption', failureClass: 'interrupted',
    previous: { runRef: crashed.runRef } });

  const page = await continuationPage(h, ['automatic_rework', 'continuation']);
  expect(page.capabilities).toContainEqual({ source: 'continuation', availability: 'available' });
  const recovered = page.notices.filter((notice) => notice.category === 'automatic_rework');
  expect(recovered).toHaveLength(1);
  expect(recovered[0]!.summary).toContain('自动恢复');
  expect(page.notices.filter((notice) => notice.category === 'continuation')).toEqual([]);
}, 300_000);
