/**
 * B06 G2 compile migration: the one stub of the two new required Evidence
 * pieces for fixtures and tests that never run a witness check. The facts come
 * from the real Runtime reader over a history that is unavailable, so a stray
 * witness call sees honest `unknown` facts, never invented ones; the two new
 * owner members answer `unavailable`.
 */
import { rejected } from '../../src/contracts/core/rejections.js';
import { readWitnessFacts } from '../../src/core/agent-runtime/witness-facts.js';
import type { EvidencePort } from '../../src/core/work-graph/model/evidence-contracts.js';
import type { WitnessFactsPort } from '../../src/core/work-graph/model/witness-facts-contracts.js';

const NO_WITNESS = 'this fixture never runs a witness check';

/** `EvidenceServiceDependencies.witnessFacts` for a fixture without witness checks. */
export const unavailableWitnessFacts: WitnessFactsPort = {
  read: (ctx, request) => readWitnessFacts(
    { graphHistory: { readTaskExecutionHistory: async () => rejected('unavailable', NO_WITNESS) } }, ctx, request),
};

/** The two new `EvidencePort` members (and the graph reader's `evidence`) for a double that never uses them. */
export const unavailableWitnessEvidence: Pick<EvidencePort, 'recordWitness' | 'readEvidence'> = {
  recordWitness: async () => rejected('unavailable', NO_WITNESS),
  readEvidence: async () => rejected('unavailable', 'this fixture never reads evidence'),
};
