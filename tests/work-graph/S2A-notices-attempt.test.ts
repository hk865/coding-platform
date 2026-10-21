/**
 * Slice 2A QE3, Group N: L11/P1 — the automatic-rework source assembles its
 * whole ordered collection once per window attempt and serves that attempt's
 * internal pages from it. The queue result (counts and items) is unchanged.
 *
 * This daily file keeps the scale case's count behaviour with 3 real requeues.
 * The scale batch keeps the 201 requeues that cross the 200-item source page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { S2A_REQUEUE_BY_PROJECT_LOOKUP } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { automaticRework, noticesHarness, openManyTaskWorld, openS2ANotices } from '../helpers/S2A-notices-support.js';
import type { S5DecisionFixture } from '../helpers/S5-decision-fixture.js';

const opened: S5DecisionFixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });

describe.each(['memory', 'sqlite'] as const)('S2A automatic-rework attempt assembly (%s)', kind => {
  it('L11 (small: 3 requeues, page 2) 3 requeues cross the 2-item source page and the ordered window is read once per attempt', async () => {
    const { f } = await openS2ANotices(kind);
    opened.push(f);
    // Ordered layer: the three real requeues are submitted one per task in the
    // order rework-000, rework-001, rework-002. The ordered index sorts by the
    // `since` commit position ascending, so the ordered read returns
    // [rework-000, rework-001] / [rework-002] at ordered width 2 → 2 pages and
    // ceil(3 / 2) = 2 ordered reads for the ONE assembly. A per-source-page
    // rebuild would read the ordered window for each of the source's pages and
    // make 2 * 2 = 4.
    // Source layer: the assembled source keeps the same notice order and serves
    // the same [rework-000, rework-001] / [rework-002] pages; the total count
    // of 3 depends on the second page's rework-002 being assembled.
    // Outer queue: limit 2 → the first page carries 2 of the 3 assembled items.
    const taskIds = Array.from({ length: 3 }, (_, index) => `rework-${String(index).padStart(3, '0')}`);
    const world = await openManyTaskWorld(f, taskIds, { goalId: 'L11', planId: 'PL11' });
    for (const taskId of taskIds) await world.requeueOnce(taskId);

    let orderedReads = 0;
    const h = noticesHarness(f, [automaticRework(f, (index) => {
      if (index === S2A_REQUEUE_BY_PROJECT_LOOKUP) orderedReads += 1;
    }, 2)], { sourcePageLimit: 2, lookupPageLimit: 2 });
    const page = await h.page({ limit: 2 });
    // The count is assembled from all 3 requeues even though the outer queue
    // page carries only its 2-item window.
    expect(page.counts.notices.automatic_rework).toBe(3);
    expect(page.notices).toHaveLength(2);
    // Exactly two ordered pages for the ONE assembly this attempt needs.
    expect(orderedReads).toBe(2);
  });
});
