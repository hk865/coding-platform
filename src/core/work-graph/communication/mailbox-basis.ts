import type { CommitCursor } from '../../../contracts/command-event.js';
import { canonicalOf } from '../../../contracts/fingerprint.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { SendRejectionV1, SessionMessageIntentV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { DispatchBasisV1, GoalSnapshot } from '../../../contracts/ledger.js';
import type { MessageReleaseBlockV1 } from '../../../contracts/goal-decisions.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import type { MessageReleaseCandidateV1 } from '../model/decision-contracts.js';
import type { DispatchBasisFactsV1 } from '../model/dispatch-basis-contracts.js';
import type { EncodedRecord, GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import { firstDispatch, nextDispatch } from '../state/dispatch-counter.js';
import { dispatchCounterCodec } from '../persistence/dispatch-counter-codecs.js';
import { activityGuardOf, planSessionActivityAdvance } from '../sessions/session-activity.js';
import { messageReleaseBlockEligible } from '../tasks/message-release-card.js';
import { internalHostContext, mapReadResult } from './mailbox-common.js';
import type { MailboxContext, Owned } from './mailbox-types.js';

// --------------------------------------------------------------------------
// Message machine calls (STATE-MACHINES-SPEC §10)
// --------------------------------------------------------------------------

/** The three dispatch values are equal only when all three agree. */
export function sameBasis(left: DispatchBasisV1, right: DispatchBasisV1): boolean {
  return left.planRevision === right.planRevision
    && left.pointerRevision === right.pointerRevision
    && left.dispatchSequence === right.dispatchSequence;
}

/** The one consistent read's values plus its own cursor; the caller re-reads at it. */
export function dispatchCurrentOf(facts: DispatchBasisFactsV1): DispatchBasisV1 & { readCursor: CommitCursor } {
  return { ...facts.values, readCursor: facts.readCursor };
}

/** The version pins of the two records whose revisions the read knows: the Goal and the counter. */
export function basisPinsOf(facts: DispatchBasisFactsV1): VersionPin[] {
  const pins: VersionPin[] = [{ ref: structuredClone(facts.goal.ref), revision: facts.goal.revision }];
  if (facts.counter.record !== null) {
    pins.push({ ref: structuredClone(facts.counter.record.ref), revision: facts.counter.record.revision });
  }
  return pins;
}

/**
 * The companions of a message the same commit RELEASES (send's direct release and `releaseApproved`); the caller
 * calls it only then. Send's three conditions, word for word:
 * - the deadline `at + deadlineMs` is frozen, with the overflow refusal, when `deadlineMs !== null`
 *   (send `:2796–:2804`, whose other condition `release === 'released'` is the call condition);
 * - the counter +1 and the facts' guards are added when `intent === 'action_request' && basis !== null` (`:2807`);
 * - the recipient's activity advance is added when `intent !== 'notify'` (`:2817`).
 * The record order and the guard order are send's: counter record and guard, basis guards, activity record and guard.
 */
export async function releasedMessageCompanions(
  records: Pick<GoalRecordTransactionPort, 'readMany'>,
  input: {
    at: string;
    messageRef: SessionMessageRef;
    recipient: SessionRef;
    intent: SessionMessageIntentV1 | null;
    deadlineMs: number | null;
    basis: DispatchBasisFactsV1 | null;
  },
): Promise<
  | { ok: true; value: { records: EncodedRecord[]; guards: RecordGuard[]; deadline: string | null } }
  | { ok: false; rejection: CoreRejection }> {
  const { at, messageRef, recipient, intent, deadlineMs, basis } = input;
  const companionRecords: EncodedRecord[] = [];
  const companionGuards: RecordGuard[] = [];
  let deadline: string | null = null;
  if (deadlineMs !== null) {
    // The instant is representable iff the Date is; a fractional duration is
    // legal, an out-of-range one is refused before anything is written.
    const frozen = new Date(Date.parse(at) + deadlineMs);
    if (!Number.isFinite(frozen.getTime())) {
      return { ok: false, rejection: reject('invalid', 'the inquiry deadline overflows the representable instant') };
    }
    deadline = frozen.toISOString();
  }
  // A released action_request counts itself and carries the facts' guards; its
  // pins are the values before that +1.
  if (intent === 'action_request' && basis !== null) {
    const counted = basis.counter.record === null
      ? firstDispatch(basis.goal.ref, messageRef)
      : nextDispatch(basis.counter.record, messageRef);
    companionRecords.push(dispatchCounterCodec.encode(counted.record));
    companionGuards.push({ refKey: basis.counter.refKey, expectedRevision: counted.expectedRevision });
    companionGuards.push(...basis.guards);
  }
  // A released non-notify message advances the recipient Session; a notify,
  // a read and a replay never do.
  if (intent !== 'notify') {
    const planned = await planSessionActivityAdvance(records, {
      sessionRef: recipient, at, kind: 'input', source: messageRef,
    });
    if (!planned.ok) return { ok: false, rejection: planned.rejection };
    companionRecords.push(planned.record);
    companionGuards.push(activityGuardOf(planned.guard));
  }
  return { ok: true, value: { records: companionRecords, guards: companionGuards, deadline } };
}

/**
 * After a commit conflict whose `current` names one of `refKeys`, one more consistent read projects the
 * three values (send `:2843–:2865`). Any other conflict, or a failed re-read, returns `written` unchanged.
 */
export async function basisConflictCurrent<T extends WriteResult<unknown>>(
  written: T,
  refKeys: ReadonlySet<string>,
  readAgain: () => Promise<ReadResult<DispatchBasisFactsV1>>,
): Promise<T | SendRejectionV1> {
  if (written.status !== 'rejected' || written.code !== 'revision_conflict') return written;
  const named = (written.current ?? []).some((pin) => {
    const refKey = canonicalOf(pin.ref);
    return refKey !== null && refKeys.has(refKey);
  });
  if (!named) return written;
  let again: ReadResult<DispatchBasisFactsV1>;
  try {
    again = await readAgain();
  } catch {
    return written;
  }
  if (again.status !== 'ready') return written;
  return {
    ...reject('revision_conflict', 'the dispatch basis moved while the send committed', basisPinsOf(again.value)),
    dispatchCurrent: dispatchCurrentOf(again.value),
  };
}

/** One candidate's block reason (candidate read item 5). It never returns `activity_conflict`. */
export function releaseCandidateBlockedReason(
  message: Pick<SessionMessage, 'intent' | 'pins'>,
  goal: { desiredState: GoalSnapshot['desiredState']; currentValues: DispatchBasisV1 | null },
): Exclude<MessageReleaseCandidateV1['blockedReason'], 'activity_conflict'> {
  if (goal.desiredState !== 'active') return 'goal_not_active';
  if (message.intent === 'action_request'
    && (message.pins === null || goal.currentValues === null || !sameBasis(message.pins, goal.currentValues))) {
    return 'stale_pins';
  }
  return null;
}

/**
 * §3.8 item 4: the derived block of one message, `null` unless it is an approved, not withdrawn, not released
 * message. Reading derives it and writes nothing (`book :393–:394`).
 */
export async function releaseBlockOf(mailbox: MailboxContext, owned: Owned, message: SessionMessage):
  Promise<ReadResult<MessageReleaseBlockV1 | null>> {
  if (!messageReleaseBlockEligible(message)) return { status: 'ready', value: null };
  if (mailbox.deps.dispatchBasis === undefined) {
    return reject('unsupported', 'the release block needs the dispatch basis read');
  }
  const basis = await mailbox.deps.dispatchBasis.readDispatchFacts(internalHostContext(mailbox, owned),
    { goalRef: message.goalRef! });
  if (basis.status !== 'ready') return mapReadResult(basis) as CoreRejection;
  return { status: 'ready', value: {
    blockedReason: releaseCandidateBlockedReason(message,
      { desiredState: basis.value.goal.desiredState, currentValues: basis.value.values }),
    current: dispatchCurrentOf(basis.value),
  } };
}
