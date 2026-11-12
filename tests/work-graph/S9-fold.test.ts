/**
 * E4-fold — slice 9 (G2's row, landed with G3), shared S9 world.
 * Named mutation: a missing review folded as an empty-set PASS (red at the no-booking case's `INCONCLUSIVE`).
 * Today (no G3) red at: the world's guard "sent no exec review round".
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvidenceRef } from '../../src/contracts/evidence.js';
import type { VerificationRoundReadV1 } from '../../src/core/work-graph/views/verification-round-read.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import {
  answerS9Review, bookS9Review, finalizeS9Review, openS9ReviewWorld, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

const REVIEW_PAIR = { obligationId: 's9-review-obligation', requirementId: 's9-review' };
type Finalized = { value: { outcome: string; gaps: { code: string }[]; snapshot: { evidenceRefs: EvidenceRef[] } } };

describe('E4-fold: the booked review in finalizeChecks', () => {
  it('only this round\'s one ref; pass → PASS, the ref last, the requirement shown met', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const { world } = review;
    const query = await answerS9Review(review, 'pass');
    const ref = await bookS9Review(review, query.roundRef);
    const before = await world.platform.evidence.readVerification(world.humanContext(), query.roundRef);
    for (const [index, refs] of [[ref, ref], [{ ...ref, evidenceId: 's9-e4-booked-nowhere' }]].entries()) {
      expect(await finalizeS9Review(review, query.roundRef, `s9-e4-wrong-${String(index)}`, refs))
        .toMatchObject({ status: 'rejected', code: 'forbidden' });
    }
    expect(await world.platform.evidence.readVerification(world.humanContext(), query.roundRef)).toEqual(before);
    const passed = await finalizeS9Review(review, query.roundRef, 's9-e4-pass', [ref]);
    expect(passed).toMatchObject({ status: 'committed', value: { outcome: 'PASS', gaps: [],
      snapshot: { status: 'finalized' } } });
    const refs = (passed as Finalized).value.snapshot.evidenceRefs;
    expect(refs).toHaveLength(2);
    expect(refs.at(-1)).toEqual(ref);
    const shown = ready<VerificationRoundReadV1>(await world.post('verification/round',
      plain(S6A_SCOPE, { roundRef: query.roundRef })), 'the round read');
    expect(shown.delivery.requirements.find(entry => entry.requirementId === 's9-review')?.state).toBe('pass');
  }, 120_000);

  it.each([
    { name: 'fix', reply: 'fix', booked: true, stale: false, outcome: 'FAIL', gap: null },
    { name: 'no booking, no ref', reply: 'pass', booked: false, stale: false, outcome: 'INCONCLUSIVE', gap: 'reviewer_missing' },
    { name: 'source changed after booking', reply: 'pass', booked: true, stale: true, outcome: 'INCONCLUSIVE', gap: 'reviewer_stale' },
  ] as const)('$name → $outcome', async ({ reply, booked, stale, outcome, gap }) => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    const query = await answerS9Review(review, reply);
    const ref = booked ? await bookS9Review(review, query.roundRef) : null;
    if (stale) await writeFile(join(review.world.root, 'src', 's9-stale.txt'), 'changed after the review');
    const finalized = await finalizeS9Review(review, query.roundRef, 's9-e4', ref === null ? undefined : [ref]);
    expect(finalized).toMatchObject({ status: 'committed', value: { outcome } });
    const value = (finalized as Finalized).value;
    if (gap !== null) {
      expect(value.gaps.filter(entry => entry.code === gap)).toEqual([expect.objectContaining({ coverage: REVIEW_PAIR })]);
    }
    if (ref !== null) expect(value.snapshot.evidenceRefs).toContainEqual(ref);
  }, 120_000);
});
