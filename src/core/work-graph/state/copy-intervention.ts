import type { GoalRef } from '../../../contracts/ledger.js';
import type { CopyInterventionCandidateV1 } from '../../../contracts/goal-copy-retraction.js';
import { sameJson } from '../../../contracts/fingerprint.js';
import type { SessionMessageRecord } from './message-machine.js';

export type CopyInterventionFactsV1 = {
  message: Pick<SessionMessageRecord, 'ref' | 'revision' | 'sender' | 'goalRef' | 'decision'
    | 'withdrawnAt' | 'appliedAt' | 'rejectedAt' | 'transferredTo' | 'originalRef'>;
  /** The ready value of `readMessageView` has `delivery.delivery === 'delivered'`: the one derivation, never a second one. */
  delivered: boolean;
  /** The ref is in `copiedInterventions` of a Goal whose `continuedFrom.goal` is the source. */
  copiedElsewhere: boolean;
};

/** The book's table as one rule; `null` = not a candidate. */
export function copyInterventionCandidateOf(sourceGoalRef: GoalRef, facts: CopyInterventionFactsV1):
  CopyInterventionCandidateV1 | null {
  const { message } = facts;

  // 1. Not a candidate: another goal, a non-person sender, a decision message or a forwarding record (7a:609).
  if (message.goalRef === null || !sameJson(message.goalRef, sourceGoalRef)) return null;
  if (message.sender.kind !== 'host' || message.sender.actor.kind !== 'human') return null;
  if (message.decision !== undefined || message.originalRef !== null) return null;

  // 2. Disposed, in the book's order (7a:605).
  const disposed = message.withdrawnAt !== null ? 'withdrawn'
    : message.appliedAt !== null ? 'applied'
    : message.rejectedAt !== null ? 'rejected'
    : null;
  if (disposed !== null) {
    return { messageRef: message.ref, version: message.revision, state: disposed,
      selectable: false, reason: disposed, retractable: false, retractReason: disposed };
  }

  // 3. Copied elsewhere or moved to another line (7a:606).
  if (facts.copiedElsewhere || message.transferredTo !== null) {
    return { messageRef: message.ref, version: message.revision, state: 'copied',
      selectable: false, reason: 'copied', retractable: false, retractReason: 'copied' };
  }

  // 4. Delivered: selectable for a copy, never retractable (7a:607).
  if (facts.delivered) {
    return { messageRef: message.ref, version: message.revision, state: 'delivered',
      selectable: true, reason: null, retractable: false, retractReason: 'delivered' };
  }

  // 5. Otherwise not delivered: selectable and retractable (7a:608, :614–:617).
  return { messageRef: message.ref, version: message.revision, state: 'not_delivered',
    selectable: true, reason: null, retractable: true, retractReason: null };
}
