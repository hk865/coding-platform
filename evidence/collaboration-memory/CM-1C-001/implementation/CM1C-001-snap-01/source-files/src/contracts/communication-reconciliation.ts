import type { CommunicationIntentSnapshot } from './coordination.js';

/** No external receipt exists for this protocol's communication intent. Preserve
 * generation, owner and domain, and make the unresolved result visibly isolated. */
export function quarantineCommunicationIntent(prior: CommunicationIntentSnapshot, at: string): CommunicationIntentSnapshot | null {
  if (prior.intent.status !== 'outcome_unknown' && !(prior.intent.status === 'leased' && prior.intent.sideEffectStarted &&
      prior.intent.leaseExpiresAt !== null && prior.intent.leaseExpiresAt <= at)) return null;
  return { ...prior, revision: prior.revision + 1, recordedAt: at, intent: { ...prior.intent, status: 'quarantined', settledAt: at,
    lastFailureClass: 'No verifiable external receipt; quarantined without replay' } };
}
