/**
 * W5-steps — slice 9 G3, shared S9 world.
 * Named mutation: a non-empty `reviewerEvidence` left out of the finalize fingerprint (red at `idempotency_conflict`).
 * Today (no G3) red at: the subject drive's step is `finalize_checks` (keys `input`/`meta`), not the send request;
 * the closed world's guard "sent no exec review round".
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { VerificationRoundRef } from '../../src/contracts/verification.js';
import {
  advanceS9Review, answerS9Review, openS9ReviewRound, openS9ReviewWorld, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

/** G3's operation, as a public `workflow/advance` body (rulings §3.5: `graphWrite(base,'record_review',{roundRef},[pin])`). */
const recordReview = (review: S9ReviewWorld, roundRef: VerificationRoundRef, revision: number): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef: review.goal, flowId: 's9-review-subject', sessionHint: review.workLine.ref,
    taskId: review.task.taskId, kind: 'perform', operation: { kind: 'record_review', request: { input: { roundRef },
      meta: { requestId: 's9-w5-record', expected: [{ ref: roundRef, revision }] } } } }) as unknown as WorkflowAdvanceInput;

describe('W5-steps: record_review, the send request and the finalize third parameter', () => {
  it('record_review feeds finalize_checks; [] replays the omitted member, [ref] conflicts', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const { evidence } = review.world.platform;
    const ctx = review.world.humanContext();
    const round = await openS9ReviewRound({ review });
    const send = round.next?.kind === 'perform' ? round.next.operation : null;
    expect(Object.keys(send?.request ?? {}).sort()).toEqual(['recipient', 'round', 'text']);
    await answerS9Review(review, 'pass', { round });
    const selected = await advanceS9Review(review);
    const booked = await advanceS9Review(review, (selected as { value: { next: WorkflowAdvanceInput } }).value.next);
    expect(booked).toMatchObject({ status: 'ready', value: { state: 'advance',
      receipt: { kind: 'record_review', result: { status: 'committed' } } } });
    const evidenceRef = (booked as unknown as { value: { receipt: { result: { value: { evidenceRef: unknown } } } } })
      .value.receipt.result.value.evidenceRef;
    expect(booked).toMatchObject({ value: { next: { operation: { kind: 'finalize_checks',
      request: { input: { roundRef: round.roundRef, reviewerEvidence: [evidenceRef] } } } } } });
    const open = await evidence.readVerification(ctx, round.roundRef);
    if (open.status !== 'ready') throw new Error('W5: the round is not readable');
    const request = { input: { roundRef: round.roundRef }, meta: { requestId: 's9-w5-finalize',
      expected: [{ ref: round.roundRef, revision: open.value.revision }] } };
    const first = await evidence.finalizeChecks(ctx, request);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    expect(await evidence.finalizeChecks(ctx, { ...request, input: { ...request.input, reviewerEvidence: [] } }))
      .toEqual({ ...first, replayed: true });
    const finalized = await evidence.readVerification(ctx, round.roundRef);
    expect(await evidence.finalizeChecks(ctx, { ...request, input: { ...request.input,
      reviewerEvidence: [evidenceRef as never] } })).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await evidence.readVerification(ctx, round.roundRef)).toEqual(finalized);
  }, 120_000);

  it('no_accepted_answer finalizes without a ref; another invalid is returned and finalizes nothing', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const ctx = review.world.humanContext();
    const query = await answerS9Review(review, 'none');
    const open = await review.world.platform.evidence.readVerification(ctx, query.roundRef);
    if (open.status !== 'ready') throw new Error('W5: the round is not readable');
    const closed = await advanceS9Review(review, recordReview(review, query.roundRef, open.value.revision));
    expect(closed).toMatchObject({ status: 'ready', value: { state: 'advance',
      next: { operation: { kind: 'finalize_checks', request: { input: { roundRef: query.roundRef } } } } } });
    expect(Object.keys((closed as { value: { next: { operation: { request: { input: object } } } } })
      .value.next.operation.request.input)).toEqual(['roundRef']);
    expect(await advanceS9Review(review, recordReview(review, { ...query.roundRef, roundId: '' }, open.value.revision)))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await review.world.platform.evidence.readVerification(ctx, query.roundRef)).toEqual(open);
  }, 120_000);
});
