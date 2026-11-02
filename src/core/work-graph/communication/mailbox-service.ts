/**
 * C1 SessionMailbox service.
 *
 * A SessionMessage is a durable, received statement; it is NOT a task
 * obligation, wait or execution claim. Sending never wakes, preempts or changes
 * a Session/Task; a busy/archived Session still receives mail and a pending
 * inbox item never blocks explicit archival.
 *
 * Trusted identity (never from model JSON):
 *   - `ctx` is a trusted Host/tool-adapter binding. Every mutable input is
 *     snapshotted synchronously before the first await; the original AbortSignal
 *     is kept by reference. Host and work_run scopes are re-checked here.
 *   - A work_run sender is re-derived from the persisted WG11/claim facts on the
 *     ONE real ledger; `agentPrincipal.workId` is never used as a Session.
 *   - A NEW work_run action additionally requires a real running, non-terminal
 *     Run, the exact Session occupancy/lease owner and generation, a B2 V2
 *     `phase:'entered'` authorization with `sessionGeneration === claim.generation`
 *     and a Session-matching kernel binding, a non-null envelope whose
 *     Run/Role/workspace agree and which authorizes the operation tool, and the
 *     existing Role resolver ceiling. A replay restores the ORIGINAL receipt
 *     first and is never re-judged against the current world.
 *
 * Body storage (MaterialPort only, never inlined text):
 *   - a canonical JSON envelope is stored with `scope+messageId+part`; the
 *     internal system Host is used ONLY as the platform body executor. It never
 *     replaces the real command actor/sender.
 *   - a message is published only after the body is stored, read back and
 *     verified inside one PreparedCommit with the event/idempotency receipt.
 *
 * Reads use the registered recipient lookup and a realtime keyset; they never
 * scan all events, never ack and never bind a cursor to the whole-ledger
 * watermark.
 *
 * Every write is decided by the pure message machine (`state/message-machine.ts`,
 * STATE-MACHINES-SPEC §10 MSG-01..09). The request checks that name the
 * receipt identity and the receipt lookup still come first, each read happens
 * where it always did (an earlier refusal skips the later reads), and the
 * machine's effects become the body store before the commit and the one
 * commit's record, event and CAS guards. Status, readAt, response,
 * acceptedInputs and the derivation are written only by the machine's record
 * constructors (§14.1).
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import { canonicalOf, sha256Hex } from '../../../contracts/fingerprint.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { isNonNeg as isNonNegativeInt, isPos as isPositiveInt, isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import type { SessionMailboxDependencies, SessionMessage } from '../model/communication-contracts.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import type { MessageCommandWritePort, SessionMessageCommitFragment, SessionMessageWriteCommandV1 } from '../model/decision-contracts.js';
import type { EncodedDomainEvent, CommitCursorBinding, RecordGuard, UniqueClaimChange } from '../../record-store/ports.js';
import { sessionMessageTextBound, encodeSessionMessageReadEvent, encodeSessionMessageRespondedEvent, encodeSessionMessageSentEvent, sessionMessageRefKey, encodeSessionMessageConsultationDerivedEvent, encodeSessionMessageInputAcceptedEvent, encodeSessionMessageDecisionAnsweredEvent, encodeSessionMessageDecisionAppliedEvent, encodeSessionMessageWithdrawnEvent, encodeSessionMessageReleaseDecidedEvent, encodeSessionMessageReleasedEvent, encodeSessionMessageAppliedEvent, encodeSessionMessageExpiredEvent, type SessionMessageEventV1 } from '../sessions/message-record-codecs.js';
import { unreachable } from '../state/transition.js';
import { mapReadResult, recipientLineFacts, preservedNoticeOrigin, ownContext, normalizeMessageRef, scopeOfMessageRef, judge, refusalOf, readProgress, eventIdOf } from './mailbox-common.js';
import type { MailboxContext, Unknown, Owned, SessionMailboxWithUserSend, MessageBodySender } from './mailbox-types.js';
import { readCurrentWorkspaceSource, storeScopedMessageBody, replaySessionMessageReceipt, companionContributionOf, prepareSessionMessage, releaseDecidedChange, messageWriteResult, commitPreparedSessionMessage, releaseDecidedResult } from './mailbox-write.js';
import { sameBasis, dispatchCurrentOf, basisPinsOf, releasedMessageCompanions, basisConflictCurrent } from './mailbox-basis.js';
import { readMessage, readMessageBody, readMessageView } from './mailbox-access.js';
import {
  readInbox, readInboxView, readOutbox, readRoutedReplies, readUndeliveredReplies,
} from './mailbox-pages.js';
import {
  ackMessage, respondMessage, respondFromQueryAnswer, recordConsultationDerivation, recordInputAccepted,
  withdrawMessage, releaseMessage,
} from './mailbox-commands.js';
import { disposeArchiveWait } from './mailbox-archive.js';
import { readHostSystemOutbox, appendHostSystemOutbox, lookupToolCommit, lookupHostSendCommit } from './mailbox-host.js';
import { sendMessage, sendUserMessage } from './mailbox-send.js';

export {
  mapReadResult, recipientLineFacts, readSessionMessageRecord, preservedNoticeOrigin,
  ownContext, judge, refusalOf, readProgress, messageSenderSessionOf, eventIdOf,
} from './mailbox-common.js';
export type {
  MailboxPrincipal, Owned, OwnedContext, SessionMailboxWithUserSend,
} from './mailbox-types.js';
export { messageVersionAgainstReceipt, releaseDecidedResult, releaseDecidedChange, messageWriteResult } from './mailbox-write.js';
export { sameBasis, dispatchCurrentOf, basisPinsOf, releasedMessageCompanions, basisConflictCurrent } from './mailbox-basis.js';
export { respondReceiptIdentityOf } from './mailbox-identity.js';
export { replyTargetEligible } from './mailbox-archive.js';

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

export function createSessionMailbox(deps: SessionMailboxDependencies): SessionMailboxWithUserSend {
  const records = deps.records;
  // SPEC §3.3 line 684: the original send/respond/ack/user-send paths commit
  // through the SAME `createMessageWriteOwner` facade the decision service uses
  // (`writeMessage` below is only the body+record builder that calls it), so
  // there is one writer, one replay and one CAS rule for every SessionMessage.
  const messageWrites = createMessageWriteOwner(deps);
  const mailbox: MailboxContext = { deps, records, messageWrites };

  return {
    sendMessage: (...args) => sendMessage(mailbox, ...args),
    readMessage: (...args) => readMessage(mailbox, ...args),
    readMessageBody: (...args) => readMessageBody(mailbox, ...args),
    readInbox: (...args) => readInbox(mailbox, ...args),
    readOutbox: (...args) => readOutbox(mailbox, ...args),
    ackMessage: (...args) => ackMessage(mailbox, ...args),
    respondMessage: (...args) => respondMessage(mailbox, ...args),
    respondFromQueryAnswer: (...args) => respondFromQueryAnswer(mailbox, ...args),
    recordConsultationDerivation: (...args) => recordConsultationDerivation(mailbox, ...args),
    recordInputAccepted: (...args) => recordInputAccepted(mailbox, ...args),
    sendUserMessage: (...args) => sendUserMessage(mailbox, ...args),
    disposeArchiveWait: (...args) => disposeArchiveWait(mailbox, ...args),
    readUndeliveredReplies: (...args) => readUndeliveredReplies(mailbox, ...args),
    readRoutedReplies: (...args) => readRoutedReplies(mailbox, ...args),
    lookupToolCommit: (...args) => lookupToolCommit(mailbox, ...args),
    lookupHostSendCommit: (...args) => lookupHostSendCommit(mailbox, ...args),
    readHostSystemOutbox: (...args) => readHostSystemOutbox(mailbox, ...args),
    appendHostSystemOutbox: (...args) => appendHostSystemOutbox(mailbox, ...args),
    withdrawMessage: (...args) => withdrawMessage(mailbox, ...args),
    releaseMessage: (...args) => releaseMessage(mailbox, ...args),
    readMessageView: (...args) => readMessageView(mailbox, ...args),
    readInboxView: (...args) => readInboxView(mailbox, ...args),
  };
}

/**
 * The shared body/persist facade over the mailbox's private helpers
 * (SPEC §3.3 line 684): `storeBody`/`persist` keep the original
 * `storeMessageBody`/`writeMessage`/receipt rules, while the public
 * `SessionMailboxPort` gains no internal method. Both callers
 * (`sendMessage`/`respond*` and `createDecisionMessageService`) share this one
 * instance.
 */
export function createMessageWriteOwner(deps: SessionMailboxDependencies): MessageCommandWritePort {
  const records = deps.records;
  type WriteReceipt = Extract<Awaited<ReturnType<SessionMailboxDependencies['records']['commit']>>, { status: 'committed' }>;

  function encodePersistEvent(event: SessionMessageEventV1): EncodedDomainEvent {
    switch (event.eventType) {
      case 'SessionMessageSent': return encodeSessionMessageSentEvent(event);
      case 'SessionMessageRead': return encodeSessionMessageReadEvent(event);
      case 'SessionMessageResponded': return encodeSessionMessageRespondedEvent(event);
      case 'SessionMessageConsultationDerived': return encodeSessionMessageConsultationDerivedEvent(event);
      case 'SessionMessageInputAccepted': return encodeSessionMessageInputAcceptedEvent(event);
      case 'SessionMessageDecisionAnswered': return encodeSessionMessageDecisionAnsweredEvent(event);
      case 'SessionMessageDecisionApplied': return encodeSessionMessageDecisionAppliedEvent(event);
      case 'SessionMessageWithdrawn': return encodeSessionMessageWithdrawnEvent(event);
      case 'SessionMessageReleaseDecided': return encodeSessionMessageReleaseDecidedEvent(event);
      case 'SessionMessageReleased': return encodeSessionMessageReleasedEvent(event);
      case 'SessionMessageApplied': return encodeSessionMessageAppliedEvent(event);
      case 'SessionMessageExpired': return encodeSessionMessageExpiredEvent(event);
      default: return unreachable(event, 'message event');
    }
  }

  async function replayReceipt(receipt: WriteReceipt): Promise<WriteResult<SessionMessage>> {
    return replaySessionMessageReceipt(records, receipt);
  }

  return {
    async storeBody(ctx, input): Promise<ReadResult<{ bodyRef: ArtifactRef; sourceRef: ArtifactRef['source'] }>> {
      const owned = ownContext(ctx);
      if (!owned.ok) return owned.rejection;
      const raw = input as unknown as Unknown | null | undefined;
      if (!isObject(raw)) return reject('invalid', 'storeBody requires an input object');
      const normalized = normalizeMessageRef(raw['messageRef']);
      if (!normalized.ok) return reject('invalid', normalized.reason);
      const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
      if (scopeProblem !== null) return scopeProblem;
      const part = raw['part'];
      if (part !== 'message' && part !== 'response') return reject('invalid', 'storeBody part must be message or response');
      const text = raw['text'];
      if (typeof text !== 'string' || text.length === 0) return reject('invalid', 'storeBody text must be a non-empty string');
      const sender = raw['sender'];
      if (!isObject(sender) || !nonEmpty(sender['kind'])) return reject('invalid', 'storeBody requires a sender');
      // The one bound: the `message` part by this body's sender, the `response` part always 16 KiB.
      const maxBytes = sessionMessageTextBound({
        sender: sender as unknown as MessageBodySender, part, original: null,
      });
      if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        return reject('capacity', `message text exceeds ${maxBytes} UTF-8 bytes`);
      }
      const source = await readCurrentWorkspaceSource(records, owned);
      if (!source.ok) return source.rejection;
      return storeScopedMessageBody(deps, {
        owned, sender: sender as unknown as MessageBodySender, part, messageRef: normalized.ref, text,
        sourceRef: source.value,
        // The facade keeps its own original operation identity.
        bodyRequestId: `session-message-body:${sha256Hex(`${normalized.ref.messageId}|${part}`)}`,
      });
    },

    /**
     * The R2 prepared commit's one fragment: the command's message built by the
     * state machine, its one snapshot event, the command's admitted CAS and the
     * companions — companion records and events FIRST, this message last. It never
     * looks up a receipt, never commits and is safe to call again on a retry. A
     * change the machine refuses is `revision_conflict`, never a crash.
     */
    async prepare(ctx, command, companions): Promise<SessionMessageCommitFragment | CoreRejection> {
      const owned = ownContext(ctx);
      if (!owned.ok) return owned.rejection;
      const raw = command as unknown as Unknown | null | undefined;
      if (!isObject(raw)) return reject('invalid', 'prepare requires a command object');
      const before = raw['before'] as SessionMessage | null;
      if (before === null || typeof before !== 'object' || !isObject(before.ref)) {
        return reject('invalid', 'prepare requires the message the command read');
      }
      const expectedRevision = raw['expectedRevision'];
      if (!isPositiveInt(expectedRevision)) return reject('invalid', 'prepare requires the admitted message revision');
      const operation = raw['operation'];
      if (operation !== 'message.withdraw' && operation !== 'message.release'
        && operation !== 'message.releaseApproved' && operation !== 'message.apply'
        && operation !== 'message.recordExpiry' && operation !== 'message.inputAccepted') {
        return reject('invalid', 'prepare does not know this message write operation');
      }
      const change = raw['change'];
      if (!isObject(change) || !nonEmpty(change['kind'])) return reject('invalid', 'prepare requires the command\'s change');
      const event = raw['event'];
      if (!isObject(event) || !nonEmpty(event['eventId']) || !nonEmpty(event['occurredAt'])
        || !nonEmpty(event['requestId']) || !isObject(event['actor'])) {
        return reject('invalid', 'prepare requires the command\'s event envelope');
      }
      const contribution = companionContributionOf(companions);
      if (!contribution.ok) return contribution.rejection;
      const contributed = contribution.value
        ?? { records: [], events: [], guards: [], claims: [] };
      return prepareSessionMessage(records, owned,
        raw as unknown as SessionMessageWriteCommandV1, contributed);
    },

    async persist(ctx, request): Promise<WriteResult<SessionMessage>> {
      const owned = ownContext(ctx);
      if (!owned.ok) return owned.rejection;
      const raw = request as unknown as Unknown | null | undefined;
      if (!isObject(raw)) return reject('invalid', 'persist requires a request object');
      const meta = raw['meta'];
      if (!isObject(meta) || !nonEmpty(meta['requestId']) || !Array.isArray(meta['expected'])) {
        return reject('invalid', 'persist requires meta.requestId and meta.expected');
      }
      const input = raw['input'];
      if (!isObject(input)) return reject('invalid', 'persist requires an input object');
      const identityKey = raw['identityKey'];
      const fingerprint = raw['fingerprint'];
      if (!nonEmpty(identityKey) || !nonEmpty(fingerprint)) {
        return reject('invalid', 'persist requires the entry identityKey and fingerprint');
      }
      const existing = await records.lookupCommit({ identityKey, fingerprint });
      if (existing.status === 'ready') return replayReceipt(existing.value);
      if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);

      const next = input['next'] as SessionMessage;
      if (!isObject(next) || !isObject(next.ref)) return reject('invalid', 'persist requires the next SessionMessage');
      const before = (input['before'] ?? null) as SessionMessage | null;
      const event = input['event'] as SessionMessageEventV1;
      if (!isObject(event) || !nonEmpty(event.eventType)) return reject('invalid', 'persist requires the appended event');
      const guards: RecordGuard[] = Array.isArray(input['guards']) ? input['guards'] as RecordGuard[] : [];
      const claims: UniqueClaimChange[] = Array.isArray(input['claims']) ? input['claims'] as UniqueClaimChange[] : [];
      const companions = companionContributionOf(input['companions']);
      if (!companions.ok) return companions.rejection;
      // Persist only concatenates the top-level bindings and the companions';
      // the commit tail dedupes all three sources (these two and the message's
      // own bindings) once, so this layer keeps no second dedupe.
      const bound = [...(Array.isArray(input['commitCursorBindings']) ? input['commitCursorBindings'] : []) as CommitCursorBinding[],
        ...(companions.value?.commitCursorBindings ?? [])];
      const contributed = { ...(companions.value ?? { records: [], events: [], guards: [], claims: [] }),
        ...(bound.length === 0 ? {} : { commitCursorBindings: bound }),
        ...(input['ledgerHorizon'] !== undefined ? { ledgerHorizon: input['ledgerHorizon'] as CommitCursor | null }
          : companions.value?.ledgerHorizon === undefined ? {} : { ledgerHorizon: companions.value.ledgerHorizon }) };

      // §3.3 line 625 / §8.2: the caller's ACCEPTED pins become the commit
      // guards. The message's own pin is the CAS — never a re-read
      // `before.revision`, so a stale accepted pin is a real revision_conflict.
      const expectedRaw = meta['expected'];
      if (!Array.isArray(expectedRaw)) return reject('invalid', 'persist requires an expected pin array');
      const nextRefKey = sessionMessageRefKey(next.ref);
      const acceptedGuards: RecordGuard[] = [];
      const messagePins: VersionPin[] = [];
      for (const pin of expectedRaw as VersionPin[]) {
        // §2.1: a non-stored aggregate's absence pin is revision 0; the message
        // pin itself (the CAS) must still be a real stored revision.
        if (!isObject(pin) || !isObject(pin.ref) || !isNonNegativeInt(pin.revision)) {
          return reject('invalid', 'persist requires complete, non-negative-integer version pins');
        }
        const refKey = canonicalOf(pin.ref);
        if (refKey === null) return reject('invalid', 'a persist version pin ref is not canonicalizable JSON');
        if (refKey === nextRefKey) {
          if (!isPositiveInt(pin.revision)) {
            return reject('invalid', 'the accepted message pin must be a positive integer');
          }
          messagePins.push(pin);
          continue;
        }
        // §2.1: a revision-0 absence pin (virtual Task focus) has no stored
        // record schema and must never become a Store guard.
        if (pin.revision === 0) continue;
        acceptedGuards.push({ refKey, expectedRevision: pin.revision });
      }
      if (messagePins.length > 1) return reject('invalid', 'persist names the message pin more than once');
      const isCreate = before === null || before === undefined;
      if (isCreate) {
        if (messagePins.length > 0) return reject('invalid', 'persist must not pin a message that does not exist yet');
      } else if (messagePins.length !== 1) {
        return reject('invalid', 'persist requires exactly the accepted message pin for an update');
      }
      return commitPreparedSessionMessage(records, {
        owned, identityKey, fingerprint, message: next, event: encodePersistEvent(event),
        messageRevision: isCreate ? null : messagePins[0]!.revision,
        guards: [...guards, ...acceptedGuards], claims,
        companions: contributed,
        cancelledReason: 'the message write was cancelled before commit',
        commitFailureReason: 'the message commit failed before completing',
      });
    },
  };
}
