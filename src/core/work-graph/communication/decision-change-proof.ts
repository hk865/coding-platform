/**
 * The `action_release` answer's proof row. The card answer is applied by the `ActionRequest` owner
 * (`approve`/`deny`), which writes one `ActionRequestChanged` event carrying the deciding Host actor and the
 * `DecisionChangeProofV1` built by `tasks/action-request-answer.ts` (the response's acknowledgement, the card's
 * captured source pins and the changed request/hold versions). This file is the proof table's reader for that event;
 * it never re-derives a proof from current records.
 */
import type { ReadResult } from '../../../contracts/core/results.js';
import type { DecisionChangeProofV1 } from '../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type { EncodedDomainEvent } from '../../record-store/ports.js';
import { actionRequestChangedEventFromEvent, type ActionRequestChanged } from '../tasks/action-request-codecs.js';

/** The already-checked event facts: `actionRequestChangedEventFromEvent` accepted the Host actor and the formal
 * proof, so this row never re-judges them. A non-answer change carries neither and stays `incomplete`. */
type CheckedActionReleaseProofEvent = {
  actor: NonNullable<ActionRequestChanged['actor']>;
  appliedAt: string;
  proof: DecisionChangeProofV1;
};

export function decodeActionReleaseProofEvent(event: EncodedDomainEvent):
  CheckedActionReleaseProofEvent | ReadResult<never> {
  const decoded = actionRequestChangedEventFromEvent(event);
  if (decoded.status !== 'decoded') {
    return rejectedWithCurrent('unavailable', `the ActionRequestChanged event is damaged: ${decoded.reason}`);
  }
  const { actor, proof, occurredAt } = decoded.value;
  if (actor === undefined || proof === undefined) {
    return rejectedWithCurrent('incomplete',
      'the ActionRequestChanged event carries no action-release decision application');
  }
  return { actor, appliedAt: occurredAt, proof: proof as unknown as DecisionChangeProofV1 };
}
