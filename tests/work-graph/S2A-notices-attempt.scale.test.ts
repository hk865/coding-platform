/**
 * Slice 2A QE3, Group N: L11/P1 — the automatic-rework source assembles its
 * whole ordered collection once per window attempt and serves that attempt's
 * internal pages from it. The queue result (counts and items) is unchanged.
 *
 * 201 real requeues cross the 200-item source page, so one assembly needs
 * exactly two ordered pages. A per-source-page rebuild (the pre-2A shape) would
 * read the ordered window twice.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { S2A_REQUEUE_BY_PROJECT_LOOKUP } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { automaticRework, noticesHarness, openManyTaskWorld, openS2ANotices } from '../helpers/S2A-notices-support.js';
import type { S5DecisionFixture } from '../helpers/S5-decision-fixture.js';

const opened: S5DecisionFixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });

describe.each(['memory', 'sqlite'] as const)('S2A automatic-rework attempt assembly (%s)', kind => {
  it('L11 201 requeues cross the 200-item source page and the ordered window is read once per attempt', async () => {
    const { f } = await openS2ANotices(kind);
    opened.push(f);
    const taskIds = Array.from({ length: 201 }, (_, index) => `rework-${String(index).padStart(3, '0')}`);
    const world = await openManyTaskWorld(f, taskIds, { goalId: 'L11', planId: 'PL11' });
    for (const taskId of taskIds) await world.requeueOnce(taskId);

    let orderedReads = 0;
    const h = noticesHarness(f, [automaticRework(f, (index) => {
      if (index === S2A_REQUEUE_BY_PROJECT_LOOKUP) orderedReads += 1;
    })]);
    const page = await h.page({ limit: 100 });
    // The count is assembled from all 201 requeues even though the outer queue
    // page carries only its 100-item window.
    expect(page.counts.notices.automatic_rework).toBe(201);
    expect(page.notices).toHaveLength(100);
    // Exactly two ordered pages for the ONE assembly this attempt needs.
    expect(orderedReads).toBe(2);
  }, 600_000);
});
