/**
 * W1-read — slice 9 G3, shared S9 world (one failed commit of the Host's closing notice keeps a source unlinked).
 * Named mutation: `settlement_pending` read as `answered` (red at `settlement_pending`: `record_review` instead).
 * Today (no G3) red at: not_sent → `finalize_checks`, not `send_system_round`; no line → `state:'advance'`; closed →
 * the world's guard "sent no exec review round".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import { readPlanningQuery, waitForResponse } from '../helpers/IV-host-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import {
  advanceS9Review, answerS9Review, openS9ReviewRound, openS9ReviewWorld, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { commitBarrier.reset(); for (const world of worlds.splice(0)) await world.close(); });

type Advanced = Extract<WorkflowAdvanceResult, { status: 'ready' }>['value'];
async function selectReview(review: S9ReviewWorld): Promise<Advanced> {
  const result = await advanceS9Review(review);
  expect(result.status, JSON.stringify(result)).toBe('ready');
  return (result as Extract<WorkflowAdvanceResult, { status: 'ready' }>).value;
}
const operationOf = (value: Advanced) => value.next?.kind === 'perform' ? value.next.operation : null;
const inputOf = (value: Advanced): unknown => (operationOf(value)?.request as { input?: unknown } | undefined)?.input;

describe('W1-read: readReviewState through workflow/advance', () => {
  it('not_sent → waiting(exec_review_pending) → settlement_pending (unlinked) → answered', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const round = await openS9ReviewRound({ review });
    const notSent = await selectReview(review);
    expect(notSent.state).toBe('advance');
    expect(operationOf(notSent)).toMatchObject({ kind: 'send_system_round',
      request: { round: { kind: 'exec_review', roundRef: { roundId: round.roundRef.roundId } } } });
    const query = await answerS9Review(review, 'pass', { round, settle: false, beforeEnd: async () => {
      // Sent and prepared, not ended: the wait, never a second send.
      const pending = await selectReview(review);
      expect(pending).toMatchObject({ state: 'waiting', reason: 'exec_review_pending', next: null });
      expect(pending.waitBasis?.reasons).toContain('exec_review_pending');
      commitBarrier.failCommitOnce(byIdentityPrefix('session-message-send:'));   // the Host's closing notice
    } });
    const evidence = review.world.platform.evidence;
    const before = [await readPlanningQuery(review.world, query.messageRef),
      await evidence.readVerification(review.world.humanContext(), round.roundRef)];
    expect(await selectReview(review)).toMatchObject({ state: 'waiting', reason: 'settlement_pending', next: null });
    expect([await readPlanningQuery(review.world, query.messageRef),
      await evidence.readVerification(review.world.humanContext(), round.roundRef)]).toEqual(before);
    await waitForResponse(review.world, query.messageRef);
    const answered = await selectReview(review);
    expect(answered.state).toBe('advance');
    expect(operationOf(answered)).toMatchObject({ kind: 'record_review' });
    expect(inputOf(answered)).toEqual({ roundRef: round.roundRef });
  }, 120_000);

  it('no reviewer line → waiting(no_review_line)', async () => {
    const review = await openS9ReviewWorld({ reviewLine: 'none' });
    worlds.push(review);
    await openS9ReviewRound({ review });
    expect(await selectReview(review)).toMatchObject({ state: 'waiting', reason: 'no_review_line', next: null });
  }, 120_000);

  it('closed (ended without a verdict) → finalize_checks with no reviewerEvidence key', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    await answerS9Review(review, 'none');
    const closed = await selectReview(review);
    expect(closed.state).toBe('advance');
    expect(operationOf(closed)?.kind).toBe('finalize_checks');
    expect(Object.keys((inputOf(closed) ?? {}) as object)).toEqual(['roundRef']);
  }, 120_000);
});
