/**
 * E2-booking — slice 9 (G2's row, landed with G3), shared S9 world, memory and SQLite (receipt replay).
 * Named mutation: the receipt early return removed (red at the fault's zero calls / `replayed:true`).
 * Today (no G3) red at: the world's guard "sent no exec review round".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { answerS9Review, openS9ReviewWorld, type S9ReviewWorld } from '../helpers/S9-review-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { commitBarrier.reset(); for (const world of worlds.splice(0)) await world.close(); });

describe.each(['memory', 'sqlite'] as const)('E2-booking (%s)', (backend) => {
  it('books once; another request id replays the same ref without reading the subject Run', async () => {
    const review = await openS9ReviewWorld({ backend });
    worlds.push(review);
    const { world } = review;
    const query = await answerS9Review(review, 'pass');
    const book = (requestId: string) => world.platform.evidence.recordReviewEvidence!(world.humanContext(),
      { input: { roundRef: query.roundRef }, meta: { requestId, expected: [] } });
    const before = await world.platform.evidence.readVerification(world.humanContext(), query.roundRef);
    const first = await book('s9-booking-1');
    expect(first).toMatchObject({ status: 'committed', replayed: false,
      value: { evidenceRef: { aggregateType: 'Evidence', projectId: query.roundRef.projectId } } });
    const evidenceRef = (first as { value: { evidenceRef: { evidenceId: string } } }).value.evidenceRef;
    expect(evidenceRef.evidenceId).not.toBe('');
    expect(await world.platform.evidence.readVerification(world.humanContext(), query.roundRef)).toEqual(before);
    const modelCalls = (await world.scripted.requests(review.reviewLine!)).length;
    const fault = commitBarrier.failReads(canonicalKey(query.subjectRunRef), 'throw-once');
    const replay = await book('s9-booking-2');
    const subjectReads = fault.calls();
    fault.release();
    expect(replay).toMatchObject({ status: 'committed', replayed: true, value: { evidenceRef } });
    expect(subjectReads).toBe(0);
    expect((await world.scripted.requests(review.reviewLine!)).length).toBe(modelCalls);
    if (backend === 'sqlite') {
      await world.crash();
      expect(await book('s9-booking-3')).toMatchObject({ status: 'committed', value: { evidenceRef } });
    }
  }, 180_000);
});
