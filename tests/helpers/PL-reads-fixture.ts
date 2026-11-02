/**
 * The one real reader assembly for the PL goal loop (PL P5-12, L-04/L-05):
 * the composition root's own published `planReaders` and candidate-card read.
 * The platform builds both from the raw mailbox (the one owner that carries
 * `lookupHostSendCommit`); this fixture never builds a second reader and never
 * fabricates a `not_found`. PL-25 and PL-41 import this instead of rebuilding
 * the bag.
 */
import type { CandidateCardFactsDependencies } from '../../src/core/work-graph/views/decision-read-model.js';
import type { PlanReaders } from '../../src/core/work-graph/tasks/plan-readers.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';

/** The composition root's published seven reads, drained through its one close path. */
export function openPlanReaders(world: S6AHostWorld): PlanReaders {
  return world.platform.planReaders;
}

/**
 * The composite card's real input: the platform's own records, published plan
 * readers and decision-card read. It is the same bag `platform.readCandidateCard`
 * closes over; nothing here is a second projection.
 */
export function openCandidateCardFacts(world: S6AHostWorld): CandidateCardFactsDependencies {
  return {
    records: world.platform.disconnect.records,
    planReaders: world.platform.planReaders,
    decisions: world.platform.decisions,
  };
}
