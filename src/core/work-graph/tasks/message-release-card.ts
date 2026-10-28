/**
 * The `message_release` card's one facts builder and the derived block's one eligibility rule
 * (`book :392–:396`, `:417–:435`). Both the card source (`views/`) and the source handler (`communication/`) need the
 * same source, objects, options and close reason, and `tasks/` is the one submodule both may import.
 */
import type {
  DecisionObjectV1, DecisionOptionV1, DecisionSourceV1, MessageReleaseCardItemV1,
} from '../../../contracts/goal-decisions.js';
import { decisionSourceKey, MESSAGE_RELEASE_OPTIONS } from '../../../contracts/goal-decisions.js';
import type { GoalSnapshot } from '../../../contracts/ledger.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import { goalDecisionBasis } from './goal-basis.js';
import { UNKNOWN_CALL_APPROVAL_OPTION_LABELS } from './unknown-call-review-card.js';

export type MessageReleaseCardFactsV1 = Omit<MessageReleaseCardItemV1, 'releaseBlock'> & {
  /** The canonical natural source (`C/goal-decisions.ts:204`, `:230`, `:250–:251`): messageRef + creation revision. */
  source: DecisionSourceV1;
  objects: DecisionObjectV1[];
  options: DecisionOptionV1[];
  /** `null` = the card is open; a reason closes it (a released, denied or withdrawn message, or a cancelled Goal). */
  closedReason: 'goal_cancelled' | 'source_resolved' | null;
};

/**
 * `book :392–:396` (b-16): the ONE eligibility rule of the block DTO — an approved, not withdrawn, not released
 * message has one, whatever its intent, so the paused Goal's inquiry or request shows `goal_not_active`.
 * "过期" is only `stale_pins`, which R's projection reserves for an `action_request` (`message-release.ts:318–:321`);
 * an inquiry is therefore never stale however its Goal moves, and the reason itself is still R's projection.
 */
export function messageReleaseBlockEligible(
  message: Pick<SessionMessage, 'release' | 'withdrawnAt'>,
): boolean {
  return message.release === 'approved' && message.withdrawnAt === null;
}

/** The card's facts from the message record and its Goal alone. The derived block is NOT here: only `views/` and the
 * mailbox may call R's projection, so the item is built as `{ ...facts, releaseBlock }` at the caller. */
export function messageReleaseCardFacts(input: {
  message: SessionMessage;
  goal: GoalSnapshot;
}): MessageReleaseCardFactsV1 {
  const { message, goal } = input;
  const source: DecisionSourceV1 = {
    kind: 'message_release',
    key: decisionSourceKey({ kind: 'message_release', messageRef: message.ref, revision: 1 }),
    subject: { kind: 'goal', goalRef: { ...goal.ref } },
    pins: [
      { ref: structuredClone(message.ref), revision: message.revision },
      { ref: structuredClone(goal.ref), revision: goal.revision },
    ],
    goalBases: [goalDecisionBasis(goal)],
  };
  const objects: DecisionObjectV1[] = [
    { kind: 'aggregate', pin: { ref: structuredClone(message.ref), revision: message.revision }, label: '原消息' },
  ];
  const options: DecisionOptionV1[] = [
    { id: MESSAGE_RELEASE_OPTIONS.approve, label: UNKNOWN_CALL_APPROVAL_OPTION_LABELS.approve, effect: 'apply' },
    { id: MESSAGE_RELEASE_OPTIONS.deny, label: UNKNOWN_CALL_APPROVAL_OPTION_LABELS.decline, effect: 'apply' },
  ];
  const closedReason: MessageReleaseCardFactsV1['closedReason'] =
    goal.desiredState === 'cancelled' ? 'goal_cancelled'
      : message.release === 'released' || message.release === 'denied' || message.withdrawnAt !== null
        ? 'source_resolved'
        : null;
  return {
    messageRef: message.ref,
    creationRevision: 1,
    requestRoot: message.requestRoot,
    release: message.release as MessageReleaseCardFactsV1['release'],
    pins: message.pins,
    deadline: message.deadline,
    source, objects, options, closedReason,
  };
}
