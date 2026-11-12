/**
 * E5-completion — slice 9 (G2's row, landed with G3), shared S9 world.
 * Named mutation: the `reviewerMissing` hard reject restored (red at the PASS case's `committed`/`satisfied`).
 * Today (no G3) red at: the world's guard "sent no exec review round".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import {
  answerS9Review, bookS9Review, completeS9Task, finalizeS9Review, openS9ReviewWorld, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

describe('E5-completion: one completion rule, the review is Evidence, not a gate', () => {
  it('PASS with the booked review → satisfied, no causes', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const query = await answerS9Review(review, 'pass');
    const ref = await bookS9Review(review, query.roundRef);
    expect(await finalizeS9Review(review, query.roundRef, 's9-e5-finalize', [ref]))
      .toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
    expect(await completeS9Task(review, query.roundRef, 's9-e5-complete'))
      .toMatchObject({ status: 'committed', value: { phase: 'satisfied', causes: [] } });
  }, 120_000);

  it('INCONCLUSIVE without a review → the row blocked by round_inconclusive, completeTask incomplete', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const query = await answerS9Review(review, 'pass');
    expect(await finalizeS9Review(review, query.roundRef, 's9-e5-finalize'))
      .toMatchObject({ status: 'committed', value: { outcome: 'INCONCLUSIVE' } });
    const graph = ready<{ tasks: { ref: { taskId: string }; effectivePhase: string;
      phaseCause: { code: string; detail?: { gapCodes?: string[] } } | null }[] }>(
      await review.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: review.goal })), 'the Task graph');
    const row = graph.tasks.find(task => task.ref.taskId === review.task.taskId);
    expect(row).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'round_inconclusive' } });
    expect(row?.phaseCause?.detail?.gapCodes).toContain('reviewer_missing');
    expect(await completeS9Task(review, query.roundRef, 's9-e5-complete'))
      .toMatchObject({ status: 'rejected', code: 'incomplete' });
  }, 120_000);
});
