import { validateRuntimeEvent } from './validation/dispatch.js';
import { canonicalJson, sha256Hex } from './fingerprint.js';
import { runtimeEventTerminalOutcome, type RunReconciliationV1, type RunSnapshot } from './dispatch.js';

/** A separate transition for evidence acquired after an unknown terminal fact.
 * Ordinary runFact still rejects all facts after terminal. No Run is reopened. */
export function foldRunReconciliation(prior: RunSnapshot, observation: RunReconciliationV1['observation'], at: string): RunSnapshot | null {
  if (prior.status !== 'ended' || prior.outcome !== 'outcome_unknown') return null;
  if (observation.kind === 'unresolved') {
    if (!observation.reason) return null;
    return { ...prior, revision: prior.revision + 1,
      reconciliation: { status: 'quarantined', observation, recordedAt: at } };
  }
  const event = observation.event;
  if (validateRuntimeEvent(event).length) return null;
  const outcome = runtimeEventTerminalOutcome(event);
  if (!outcome || canonicalJson(event.runRef) !== canonicalJson(prior.ref) || event.sequence <= prior.lastEventSeq ||
      sha256Hex(canonicalJson(event)) !== observation.digest) return null;
  return { ...prior, revision: prior.revision + 1, outcome, endedAt: event.occurredAt,
    exitCode: event.payload.kind === 'completed' ? event.payload.exitCode : null,
    lastEventSeq: event.sequence, lastRuntimeEventId: event.eventId,
    ...(prior.executionAuthorization ? { executionAuthorization: { ...prior.executionAuthorization, phase: 'settled' as const } } : {}),
    reconciliation: { status: outcome === 'cancelled' ? 'cancelled' : 'done', observation, recordedAt: at } };
}
