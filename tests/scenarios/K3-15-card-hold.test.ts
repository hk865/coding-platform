/**
 * K3-15 (三) (L19/L21, spec line 1429): the card's `handle_myself` answer.
 *
 * A real world: a `shell` call in flight is closed by RUN-25, a real review
 * round writes `partial`, `settle_review` emits the `partial` card. Answering it with `handle_myself` through the public
 * `decisions/answer` route reaches `resolved` + `hold: 'held'` +
 * `disposition.source: 'card'`; the Task stops at AV-4c (`reviewHold: true`); a
 * human `tasks/requeue` is `busy` (`unknown_call_review_held`) and writes no
 * TaskRequeue; the public `unknown-call-reviews/release-hold` then continues,
 * and exactly one continuation Run is claimed.
 *
 * Scripted model only; the read-only capability is the KE6 probe stand-in and
 * `shell` is the blocking seam (no host process). Expected values are the
 * spec's literal ones.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, performs } from './harness.js';
import { operatorRequeue, redrivePolicy } from './support/common.js';
import { answerCard, needsDecisionCard, queueOf, reviewOf } from './support/review-card-round.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import {
  AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite,
} from '../helpers/AG2b-collaboration-fixture.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

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

describe('K3-15 (三) handle_myself through the card', () => {
  it('K3-15 (三): the card answer is resolved/held/source card, the Task stops at AV-4c, a human requeue is busy with no TaskRequeue, and release-hold continues exactly once', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const { originalRunRef, record, card } = await needsDecisionCard(h, 'k3-15-card');

    // The card itself: a real needs_decision review card, no system_requeue card.
    expect(card).toMatchObject({ state: 'waiting_answer', readOnly: false, actions: ['answer'],
      options: [{ id: 'rerun_as_is' }, { id: 'safer_method' }, { id: 'skip_as_done' }, { id: 'handle_myself' }] });
    expect((await queueOf(h)).waitingAnswer.filter(entry => entry.source.kind === 'goal_cause')).toEqual([]);

    // The card answer goes through the ONE public route, ① answer ② disposition ③ application.
    const applied = await answerCard(h, card, 'handle_myself', 'k3-15-card-answer');
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    if (applied.status !== 'ready') return;
    const action = applied.value.action as WriteResult<UnknownCallReviewV1>;
    expect(action, JSON.stringify(action)).toMatchObject({ status: 'committed', value: {
      status: 'resolved', activeRound: null,
      disposition: { choice: 'handle_myself', source: 'card', hold: 'held',
        answerMessageRef: expect.objectContaining({ messageId: expect.any(String) }) } } });

    // The durable record agrees, read only through the public route.
    const after = await reviewOf(h, originalRunRef);
    expect(after).toMatchObject({ status: 'ready', value: { status: 'resolved', activeRound: null,
      disposition: { choice: 'handle_myself', source: 'card', hold: 'held' } } });

    // AV-4c: the Task is stopped by the review hold, before AV-3.
    const heldRow = await h.taskRow();
    expect(heldRow.unknownCallReview).toMatchObject({ status: 'resolved', hold: 'held' });
    expect(heldRow.failure?.automation.verdict).toMatchObject({ kind: 'stopped', reason: 'task_paused',
      detail: { fence: 'human_pause', pausedBy: 'human', reviewHold: true } });
    expect(heldRow.execution?.runId).toBe(originalRunRef.runId);
    expect(heldRow.rework?.entries ?? [], 'no TaskRequeue exists yet').toEqual([]);
    // The review card is closed (the record is terminal); no confirmation card appears.
    const afterQueue = await queueOf(h);
    expect(afterQueue.waitingAnswer.filter(entry => entry.source.kind === 'unknown_call_review')).toEqual([]);
    expect(afterQueue.waitingAnswer.filter(entry => entry.source.kind === 'goal_cause')).toEqual([]);

    // L11: the human "continue" while held is busy and writes no TaskRequeue.
    const refused = await operatorRequeue(h.host, originalRunRef, 'k3-15-card-requeue', 'continue the stopped work');
    expect(refused, JSON.stringify(refused)).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(String((refused as { reason?: unknown }).reason)).toContain('unknown_call_review_held');
    expect((await h.taskRow()).rework?.entries ?? [], 'the refused requeue writes no TaskRequeue').toEqual([]);

    // The public release-hold owner releases the hold; the Task's fence is not human,
    // so the route's requeue side stays null and the Workflow performs the one rework.
    const released = await h.post<WriteResult<{ hold: WriteResult<UnknownCallReviewV1>; requeue: unknown }>>(
      'unknown-call-reviews/release-hold', graphWrite(AG2B_SCOPE, { reviewRef: record.ref },
        'k3-15-card-release', [{ ref: record.ref, revision: after.status === 'ready' ? after.value.revision : record.revision }]));
    expect(released, JSON.stringify(released)).toMatchObject({ status: 'committed', value: {
      hold: { status: 'committed', replayed: false, value: { status: 'resolved', activeRound: null,
        disposition: { choice: 'handle_myself', hold: 'released' } } },
      requeue: null } });

    const driven = await h.advance(h.select('k3-15-card-continue', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    expect(driven.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining(['requeue_task', 'claim_task']));
    expect(driven.steps.some(step => (step.reason ?? '').startsWith('automation_confirmation_required')),
      'the disposition confirms the one requeue').toBe(false);
    const continued = await h.taskRow();
    expect(continued.rework?.entries ?? [], 'exactly one TaskRequeue').toHaveLength(1);
    if (continued.execution === null || continued.execution.runId === originalRunRef.runId) {
      throw new Error('the release-hold continuation must be claimed as a new Run');
    }
    expect(continued.execution.runId).not.toBe(originalRunRef.runId);
  }, 300_000);
});
