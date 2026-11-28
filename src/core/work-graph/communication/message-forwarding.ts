/**
 * The forward owner (§3.9 items 1–5): `messages/forward` and `waits/dispose` as the two R2 commands, plus the copy
 * owner's trusted entry. The reads are the mailbox's one record read and the one delivery derivation; the records are
 * the message machine's two constructors; the commit is the one command executor. This file adds no second owner, no
 * second record constructor; the forward table alone decides admission.
 *
 * The ordinary entry is the person's; the trusted entry is the copy owner's and admits the copy branch only. Both
 * paths judge the same pure table (`forwardMessageProblem`) and the transfer shares `destinationProblem` with it.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import type { MessageDeliveryStateV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import { canonicalJson, sameJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { SessionDirectoryPort } from '../model/session-contracts.js';
import type {
  DisposeWaitInputV1, ForwardMessageInputV1, ForwardMessageResultV1, MessageForwardingPort, SessionMessage,
} from '../model/communication-contracts.js';
import { deriveMessageDelivery } from '../model/communication-contracts.js';
import type { SessionMessageRecord } from '../state/message-machine.js';
import {
  FORWARD_DESTINATION_GONE, createSessionMessageRecord, disposeWaitProblem, disposeWaitProblemBeforeTarget,
  forwardMessageProblem, nextSessionMessageRecord, waitFactsOfRecord, waitStateOf,
  type DisposeFactsV1, type ForwardFactsV1,
} from '../state/message-machine.js';
import { copyInterventionCandidateOf } from '../state/copy-intervention.js';
import { readGoal } from '../tasks/plan-readers.js';
import { readOwnerRecord } from '../tasks/owner-record-read.js';
import {
  checkPlainSessionRef, decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import {
  SESSION_MESSAGE_EVENT_SCHEMA_VERSION, SESSION_MESSAGE_FORWARDED_EVENT_TYPE, SESSION_MESSAGE_REPLY_TRANSFERRED_EVENT_TYPE,
  SESSION_MESSAGE_SENT_EVENT_TYPE, SESSION_MESSAGE_WAIT_DISPOSED_EVENT_TYPE, encodeSessionMessageForwardedEvent,
  encodeSessionMessageRecord, encodeSessionMessageReplyTransferredEvent, encodeSessionMessageSentEvent,
  encodeSessionMessageWaitDisposedEvent, sessionMessageFromEvent, sessionMessageRefKey,
} from '../sessions/message-record-codecs.js';
import {
  eventIdOf, mapReadResult, messageSenderSessionOf, messageVersionAgainstReceipt, ownContext,
  preservedNoticeOrigin, readSessionMessageRecord, recipientLineFacts, replyTargetEligible, type Owned,
} from './mailbox-service.js';
import {
  executeWriteCommand, type CommitFragment, type WriteCommand,
} from '../persistence/command-executor.js';

export { FORWARD_DESTINATION_GONE } from '../state/message-machine.js';

export type MessageForwardingDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  sessions: Pick<SessionDirectoryPort, 'readSession'>;
  now(): string;
};

type ForwardReadFacts =
  | { kind: 'transferred'; existing: SessionMessage; sameDestination: boolean }
  | { kind: 'fresh'; before: SessionMessage; receivingWorkspaceId: string; facts: ForwardFactsV1 };

function copyGoalOf(input: ForwardMessageInputV1): GoalRef | null {
  return input.copyGoalRef === undefined || input.copyGoalRef === null ? null : input.copyGoalRef;
}

/** The dispose input's shape checks: `transfer`/`transfer_reply` need a complete target; `cancel` must not carry one. */
function disposeInputProblem(input: DisposeWaitInputV1): CoreRejection | null {
  if (input.mode !== 'cancel' && input.mode !== 'transfer' && input.mode !== 'transfer_reply') {
    return reject('invalid', 'the wait disposal mode is not recognized');
  }
  if (input.mode === 'transfer' || input.mode === 'transfer_reply') {
    const toProblem = checkPlainSessionRef(input.to);
    if (toProblem !== null) return reject('invalid', `the transfer handler: ${toProblem}`);
  } else if (input.to !== undefined) {
    return reject('invalid', 'a wait cancel must not name a handler');
  }
  return null;
}

export function createMessageForwardingOwner(deps: MessageForwardingDependencies): MessageForwardingPort {
  const records = deps.records;

  /**
   * The one destination read both commands use (§3.9 item 3). A gone line is refused before its workspace or
   * eligibility is used. A forward, and a `transfer_reply` hand-off, may receive in another workspace of the same
   * project (7D1's same-project lift); a wait `transfer` keeps today's cross-workspace answer. The comparison is the
   * real `SessionRecord.workspaceId`, never the caller's `SessionRef` (which has no workspace). Every live destination
   * line is admitted by this read.
   */
  async function readDestination(owned: Owned, to: SessionRef, receiving: 'forward' | 'dispose'): Promise<
    { ok: true; value: ForwardFactsV1['destination']; receivingWorkspaceId: string } | { ok: false; rejection: CoreRejection }> {
    // Only another PROJECT is refused by the destination read; a dispose keeps its existing not-found answer.
    if (to.projectId !== owned.projectId) {
      return { ok: false, rejection: receiving === 'forward'
        ? reject('invalid', 'cross_workspace_forward')
        : reject('not_found', 'the destination Session does not exist') };
    }
    const target = await readOwnerRecord({
      store: records,
      refKey: sessionAggregateRefKey(plainSessionRefToAggregate(to)),
      decode: decodeSessionRecord,
      readError: () => reject('unavailable', 'the destination Session could not be read'),
    });
    if (!target.ok) {
      return { ok: false, rejection: 'notFound' in target
        ? reject('not_found', 'the destination Session does not exist')
        : target.rejection };
    }
    if (target.value.lifecycle === 'archived' || target.value.health === 'unavailable'
      || (target.value.archiveRequest ?? null) !== null) {
      return { ok: false, rejection: reject('invalid', FORWARD_DESTINATION_GONE) };
    }
    if (receiving === 'dispose' && target.value.workspaceId !== owned.workspaceId) {
      return { ok: true, receivingWorkspaceId: target.value.workspaceId,
        value: { sameWorkspace: false, eligible: false } };
    }
    // A forward reads the target's own line: the TARGET's workspace is the receiving scope, so the one eligibility
    // rule runs on that line rather than on the caller's workspace.
    const receivingOwned: Owned = { ...owned, workspaceId: target.value.workspaceId };
    return { ok: true, receivingWorkspaceId: target.value.workspaceId, value: {
      sameWorkspace: receiving === 'forward' || target.value.workspaceId === owned.workspaceId,
      eligible: replyTargetEligible(receivingOwned, target.value),
    } };
  }

  /** The already-read facts of one ordinary/copy forward; `transferredTo` is settled before the table. */
  async function readForwardFacts(owned: Owned, ctx: CoreCallContext, input: ForwardMessageInputV1):
    Promise<{ status: 'ready'; facts: ForwardReadFacts } | CoreRejection> {
    const loaded = await readSessionMessageRecord(records, owned.signal, input.messageRef);
    if (loaded.status !== 'ready') return mapReadResult(loaded) as CoreRejection;
    const before = loaded.value;
    if (before.transferredTo !== null) {
      const existing = await readSessionMessageRecord(records, owned.signal, before.transferredTo);
      if (existing.status !== 'ready') return mapReadResult(existing) as CoreRejection;
      return { status: 'ready', facts: { kind: 'transferred', existing: existing.value,
        sameDestination: sameJson(existing.value.recipient, input.to) } };
    }

    const recipientLine = await recipientLineFacts(deps, ctx, before.recipient);
    if (!recipientLine.ok) return recipientLine.rejection;
    const delivery: MessageDeliveryStateV1 = deriveMessageDelivery(before, recipientLine.value).delivery;

    // The ruling's read list includes the sender line; a Host message has no Session line to read. The sender's
    // `SessionRef` carries no workspace, so the record is read by ref first and the ONE line-facts read runs with that
    // record's workspace (finding 22). The general `readSession` boundary is unchanged.
    const sender = messageSenderSessionOf(before);
    if (sender !== null) {
      const senderRecord = await readOwnerRecord({
        store: records,
        refKey: sessionAggregateRefKey(plainSessionRefToAggregate(sender)),
        decode: decodeSessionRecord,
        readError: () => reject('unavailable', 'the sender Session could not be read'),
      });
      if (!senderRecord.ok) {
        return 'notFound' in senderRecord
          ? reject('not_found', 'the sender Session does not exist')
          : senderRecord.rejection;
      }
      const senderLine = await recipientLineFacts(deps, { ...ctx, workspaceId: senderRecord.value.workspaceId }, sender);
      if (!senderLine.ok) return senderLine.rejection;
    }

    let goal: GoalSnapshot | null = null;
    if (before.goalRef !== null) {
      const goalRead = await readGoal(records, before.goalRef);
      if (goalRead.status !== 'ready') return goalRead;
      goal = goalRead.goal;
    }

    const copyGoalRef = copyGoalOf(input);
    const branch: ForwardFactsV1['branch'] = copyGoalRef === null ? 'ordinary' : 'copy';
    let copy: ForwardFactsV1['copy'];
    let judgedGoal = goal;
    if (copyGoalRef !== null) {
      const copyGoalRead = await readGoal(records, copyGoalRef);
      if (copyGoalRead.status !== 'ready') return copyGoalRead;
      const copyGoal = copyGoalRead.goal;
      judgedGoal = copyGoal;
      const candidate = before.goalRef === null ? null : copyInterventionCandidateOf(before.goalRef, {
        message: before, delivered: delivery.delivery === 'delivered', copiedElsewhere: false,
      });
      copy = candidate === null ? undefined : {
        candidateState: candidate.state,
        selected: copyGoal.copiedInterventions.some((ref) => sameJson(ref, before.ref)),
        sourceMatches: copyGoal.continuedFrom !== null
          && sameJson(copyGoal.continuedFrom.goal, before.goalRef),
        planAdopted: copyGoal.activePlanRevision !== null,
      };
    }

    const destination = await readDestination(owned, input.to, 'forward');
    if (!destination.ok) return destination.rejection;

    const facts: ForwardFactsV1 = {
      branch,
      message: before,
      delivery: delivery.delivery,
      undeliveredReason: delivery.undeliveredReason,
      acceptedMessage: (before.acceptedInputs ?? []).some((entry) => entry.part === 'message'),
      goal: judgedGoal === null ? null : { desiredState: judgedGoal.desiredState },
      destination: destination.value,
      ...(copy === undefined ? {} : { copy }),
    };
    return { status: 'ready', facts: { kind: 'fresh', before,
      receivingWorkspaceId: destination.receivingWorkspaceId, facts } };
  }

  async function forward(ctx: CoreCallContext, input: ForwardMessageInputV1, copyOnly: boolean):
    Promise<ForwardMessageResultV1> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    if (owned.principal.kind !== 'host') {
      return reject('forbidden', 'a forward requires the trusted Host principal');
    }
    const copyGoalRef = copyGoalOf(input);
    if (copyOnly && copyGoalRef === null) {
      return reject('invalid', 'forwardCopiedIntervention requires the copy Goal');
    }
    const messageRef: SessionMessageRef = { ...input.messageRef };
    const to: SessionRef = { ...input.to };
    const forwardInput: ForwardMessageInputV1 = {
      commandId: input.commandId, messageRef, to,
      ...(copyGoalRef === null ? {} : { copyGoalRef: { ...copyGoalRef } }),
    };

    const command: WriteCommand<ForwardReadFacts,
      { before: SessionMessage; copyGoalRef: GoalRef | null; receivingWorkspaceId: string }, ForwardMessageResultV1,
      SessionMessage, SessionMessage> = {
      operation: 'message.forward',
      scope: { projectId: owned.projectId, workspaceId: owned.workspaceId },
      principal: principalIdentity(owned.principal),
      commandId: input.commandId,
      fingerprintInput: { messageRef, to, copyGoalRef },
      read: () => readForwardFacts(owned, ctx, forwardInput),
      decide: (facts) => {
        if (facts.kind === 'transferred') {
          if (facts.sameDestination) return { refuse: { status: 'existing', message: facts.existing } };
          return { refuse: reject('busy', 'the message was already forwarded to another destination') };
        }
        const problem = forwardMessageProblem(facts.facts);
        if (problem !== null) return { refuse: problem };
        return { decision: { before: facts.before, copyGoalRef, receivingWorkspaceId: facts.receivingWorkspaceId } };
      },
      build: async (decision, keys) => {
        const at = deps.now();
        const before = decision.before;
        const messageId = 'session-message-forward-' + sha256Hex(canonicalJson({
          projectId: owned.projectId, workspaceId: decision.receivingWorkspaceId, original: messageRef, to,
        } as unknown as JsonValue));
        // The copy is written in the RECEIVING workspace; its body ref is the original's, never re-stored.
        const newRef: SessionMessageRef = {
          aggregateType: 'SessionMessage', projectId: owned.projectId, workspaceId: decision.receivingWorkspaceId, messageId,
        };
        const newRecord: SessionMessageRecord = createSessionMessageRecord({
          ref: newRef,
          sender: before.sender,
          recipient: to,
          bodyRef: before.bodyRef,
          sourceRef: before.sourceRef,
          createdAt: at,
          wake: before.wake,
          answeredBy: before.answeredBy,
          // A forward copy is not the human direct-intervention entry, so it never carries `entry` (§2.1).
          needsReply: before.needsReply === true,
          waitAfterSend: before.waitAfterSend === true,
          goalRef: decision.copyGoalRef === null ? before.goalRef : decision.copyGoalRef,
          taskRef: null,
          followupOf: null,
          requestRoot: null,
          deadline: before.deadline,
          deadlineMs: before.deadlineMs,
          originalRef: before.ref,
        });
        const oldNext = nextSessionMessageRecord(before, { kind: 'forwarded', to: newRef, at });
        const preserved = await preservedNoticeOrigin(records, sessionMessageRefKey(messageRef));
        if (!preserved.ok) return preserved.rejection;
        const oldEvent = encodeSessionMessageForwardedEvent({
          eventId: eventIdOf(keys.identityKey, SESSION_MESSAGE_FORWARDED_EVENT_TYPE),
          schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION, occurredAt: at,
          projectId: before.ref.projectId, workspaceId: before.ref.workspaceId,
          eventType: SESSION_MESSAGE_FORWARDED_EVENT_TYPE, message: oldNext, originalRef: before.ref,
        });
        const sentEvent = encodeSessionMessageSentEvent({
          eventId: eventIdOf(keys.identityKey, SESSION_MESSAGE_SENT_EVENT_TYPE),
          schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION, occurredAt: at,
          projectId: newRef.projectId, workspaceId: newRef.workspaceId, requestId: input.commandId,
          actor: newRecord.sender, eventType: SESSION_MESSAGE_SENT_EVENT_TYPE, message: newRecord,
        });
        const fragment: CommitFragment = {
          // Old first, new last: the executor projects the new message.
          records: [encodeSessionMessageRecord(oldNext, preserved.value),
            encodeSessionMessageRecord(newRecord, { since: null })],
          events: [oldEvent, sentEvent],
          guards: [
            { refKey: sessionMessageRefKey(messageRef), expectedRevision: before.revision },
            { refKey: sessionMessageRefKey(newRef), expectedRevision: null },
          ],
          claims: [{
            claimKey: 'forwarded:' + sessionMessageRefKey(messageRef),
            expectedOwner: null,
            nextOwner: canonicalJson(to as unknown as JsonValue),
          }],
          commitCursorBindings: [{ refKey: sessionMessageRefKey(newRef), field: 'since' }],
        };
        return fragment;
      },
      result: {
        eventType: SESSION_MESSAGE_SENT_EVENT_TYPE,
        schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
        decode: sessionMessageFromEvent,
        validate: messageVersionAgainstReceipt,
        project: (message) => message,
      },
    };

    const written = await executeWriteCommand(records, command);
    if (written.status === 'committed') {
      return { status: 'forwarded', message: written.value, replayed: written.replayed, cursor: written.cursor };
    }
    if (written.status === 'refused') return written.refusal;
    // §3.2.8 step 9: a claim or create-CAS loss re-reads `transferredTo` once. The executor's receipt lookup already
    // covered this command's own identity; a different command's commit is classified here.
    if (written.code === 'busy' || written.code === 'revision_conflict') {
      const recovered = await readForwardFacts(owned, ctx, forwardInput);
      if (recovered.status === 'ready' && recovered.facts.kind === 'transferred') {
        return recovered.facts.sameDestination
          ? { status: 'existing', message: recovered.facts.existing }
          : reject('busy', 'the message was already forwarded to another destination');
      }
    }
    return written;
  }

  async function forwardMessage(ctx: CoreCallContext, input: ForwardMessageInputV1): Promise<ForwardMessageResultV1> {
    return forward(ctx, input, false);
  }

  async function forwardCopiedIntervention(ctx: CoreCallContext,
    input: ForwardMessageInputV1 & { copyGoalRef: GoalRef }): Promise<ForwardMessageResultV1> {
    return forward(ctx, input, true);
  }

  async function disposeWait(ctx: CoreCallContext, input: DisposeWaitInputV1): Promise<WriteResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    if (owned.principal.kind !== 'host' || owned.principal.actor.kind !== 'human') {
      return reject('forbidden', 'waits/dispose is person-only');
    }
    const inputProblem = disposeInputProblem(input);
    if (inputProblem !== null) return inputProblem;
    const messageRef: SessionMessageRef = { ...input.messageRef };
    const to: SessionRef | null = input.mode === 'cancel' ? null : { ...(input.to as SessionRef) };
    const mode = input.mode;
    const replyClaimKey = 'reply-transferred:' + sessionMessageRefKey(messageRef);
    // Set by `build`; after a concurrent hand-off the retry re-reads the original message through the same table.
    let transferReplyNewRefKey: string | null = null;

    const command: WriteCommand<{ before: SessionMessage; facts: DisposeFactsV1; receivingWorkspaceId: string | null;
        early: CoreRejection | null },
      { before: SessionMessage; change: { mode: 'cancel' } | { mode: 'transfer'; to: SessionRef }
        | { mode: 'transfer_reply'; to: SessionRef; receivingWorkspaceId: string } },
      CoreRejection, SessionMessage, SessionMessage> = {
      operation: mode === 'transfer_reply' ? 'wait-transfer-reply' : 'message.disposeWait',
      scope: { projectId: owned.projectId, workspaceId: owned.workspaceId },
      principal: principalIdentity(owned.principal),
      commandId: input.commandId,
      fingerprintInput: { messageRef, mode, to },
      read: async () => {
        const loaded = await readSessionMessageRecord(records, owned.signal, messageRef);
        if (loaded.status !== 'ready') return mapReadResult(loaded) as CoreRejection;
        const before = loaded.value;
        const wait = waitStateOf(before, waitFactsOfRecord(before));
        const recipientLine = await recipientLineFacts(deps, ctx, before.recipient);
        if (!recipientLine.ok) return recipientLine.rejection;
        const delivery = deriveMessageDelivery(before, recipientLine.value).delivery;
        let waitingLineGone = false;
        // R-F2: `waiting_line_live` is a `transfer` rule only. `transfer_reply` judges the saved reply and
        // then the target, so it never reads the sender line (a forwarded copy's sender may be in another workspace).
        if (mode === 'transfer') {
          const sender = messageSenderSessionOf(before);
          if (sender !== null) {
            const senderLine = await recipientLineFacts(deps, ctx, sender);
            if (!senderLine.ok) return senderLine.rejection;
            waitingLineGone = senderLine.value.archived || senderLine.value.retired || senderLine.value.archiving;
          }
        }
        let destination: DisposeFactsV1['destination'] = null;
        let receivingWorkspaceId: string | null = null;
        const facts: DisposeFactsV1 = {
          mode,
          message: before,
          wait,
          delivery: delivery.delivery,
          acceptedResponse: (before.acceptedInputs ?? []).some((entry) => entry.part === 'response'),
          response: before.response,
          responseTransferredTo: before.responseTransferredTo ?? null,
          waitingLineGone,
          destination,
        };
        // R-F2's order for a reply hand-off: the original message's own table runs before the target read, so a
        // missing or gone target cannot hide `not_a_wait`, an absent/accepted/transferred reply, or a closed wait.
        // The refusal rides on the ready facts so `decide` returns it and the executor can first re-check this
        // command's own receipt (a concurrent same-identity commit must still replay the original receipt).
        // `cancel`/`transfer` keep today's order: the target read still comes before their table.
        const early = mode === 'transfer_reply' ? disposeWaitProblemBeforeTarget(facts) : null;
        if (early === null && mode !== 'cancel') {
          // A reply hand-off uses the forward rule: another workspace of the same project is eligible.
          const read = await readDestination(owned, to as SessionRef, mode === 'transfer_reply' ? 'forward' : 'dispose');
          if (!read.ok) return read.rejection;
          destination = read.value;
          facts.destination = destination;
          receivingWorkspaceId = read.receivingWorkspaceId;
        }
        return { status: 'ready', facts: { before, facts, receivingWorkspaceId, early } };
      },
      decide: (facts) => {
        if (facts.early !== null) return { refuse: facts.early };
        const problem = disposeWaitProblem(facts.facts);
        if (problem !== null) return { refuse: problem };
        return { decision: { before: facts.before, change: mode === 'cancel'
          ? { mode: 'cancel' }
          : mode === 'transfer'
            ? { mode: 'transfer', to: to as SessionRef }
            : { mode: 'transfer_reply', to: to as SessionRef,
              receivingWorkspaceId: facts.receivingWorkspaceId as string } } };
      },
      build: async (decision, keys) => {
        const at = deps.now();
        if (decision.change.mode === 'transfer_reply') {
          const before = decision.before;
          const response = before.response as NonNullable<SessionMessage['response']>;
          const messageId = 'session-message-transfer-reply-' + sha256Hex(canonicalJson({
            projectId: owned.projectId, workspaceId: decision.change.receivingWorkspaceId,
            original: messageRef, to: decision.change.to,
          } as unknown as JsonValue));
          const newRef: SessionMessageRef = {
            aggregateType: 'SessionMessage', projectId: owned.projectId,
            workspaceId: decision.change.receivingWorkspaceId, messageId,
          };
          transferReplyNewRefKey = sessionMessageRefKey(newRef);
          // R-F2: the copied input is the saved reply, never a second wait; it carries no `entry`/`decision`.
          // A formal Query Answer's sender carries `answerRef`; the copied message's sender slot admits only this
          // round's identity fields, so the copy drops the reply-slot-only key and keeps the rest.
          const replySender = response.sender;
          const sender: SessionMessageRecord['sender'] = replySender.kind === 'query_run'
            ? { kind: 'query_run', sessionRef: replySender.sessionRef,
              queryRunRef: replySender.queryRunRef, generation: replySender.generation }
            : replySender;
          const newRecord: SessionMessageRecord = createSessionMessageRecord({
            ref: newRef,
            sender,
            recipient: decision.change.to,
            bodyRef: response.bodyRef,
            sourceRef: response.sourceRef,
            createdAt: at,
            wake: before.wake,
            answeredBy: 'line',
            needsReply: false,
            waitAfterSend: false,
            goalRef: before.goalRef,
            taskRef: null,
            followupOf: null,
            requestRoot: null,
            deadline: null,
            deadlineMs: null,
            originalRef: before.ref,
          });
          const oldNext = nextSessionMessageRecord(before, { kind: 'reply_transferred', to: newRef });
          const preserved = await preservedNoticeOrigin(records, sessionMessageRefKey(messageRef));
          if (!preserved.ok) return preserved.rejection;
          const replyTransferredEvent = encodeSessionMessageReplyTransferredEvent({
            eventId: eventIdOf(keys.identityKey, SESSION_MESSAGE_REPLY_TRANSFERRED_EVENT_TYPE),
            schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION, occurredAt: at,
            projectId: before.ref.projectId, workspaceId: before.ref.workspaceId,
            eventType: SESSION_MESSAGE_REPLY_TRANSFERRED_EVENT_TYPE, message: oldNext,
            to: decision.change.to, copyRef: newRef,
          });
          const sentEvent = encodeSessionMessageSentEvent({
            eventId: eventIdOf(keys.identityKey, SESSION_MESSAGE_SENT_EVENT_TYPE),
            schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION, occurredAt: at,
            projectId: newRef.projectId, workspaceId: newRef.workspaceId, requestId: input.commandId,
            actor: newRecord.sender, eventType: SESSION_MESSAGE_SENT_EVENT_TYPE, message: newRecord,
          });
          return {
            // Old first, new last: the executor projects the last event (the copied message).
            records: [encodeSessionMessageRecord(oldNext, preserved.value),
              encodeSessionMessageRecord(newRecord, { since: null })],
            events: [replyTransferredEvent, sentEvent],
            guards: [
              { refKey: sessionMessageRefKey(messageRef), expectedRevision: before.revision },
              { refKey: sessionMessageRefKey(newRef), expectedRevision: null },
            ],
            claims: [{
              claimKey: replyClaimKey,
              expectedOwner: null,
              nextOwner: canonicalJson(decision.change.to as unknown as JsonValue),
            }],
            commitCursorBindings: [{ refKey: sessionMessageRefKey(newRef), field: 'since' }],
          };
        }
        const change = decision.change.mode === 'transfer'
          ? { kind: 'wait_disposed' as const, mode: 'transfer' as const, to: decision.change.to, at }
          : { kind: 'wait_disposed' as const, mode: 'cancel' as const, to: null, at };
        const next = nextSessionMessageRecord(decision.before, change);
        const preserved = await preservedNoticeOrigin(records, sessionMessageRefKey(messageRef));
        if (!preserved.ok) return preserved.rejection;
        const event = encodeSessionMessageWaitDisposedEvent({
          eventId: eventIdOf(keys.identityKey, SESSION_MESSAGE_WAIT_DISPOSED_EVENT_TYPE),
          schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION, occurredAt: at,
          projectId: next.ref.projectId, workspaceId: next.ref.workspaceId,
          eventType: SESSION_MESSAGE_WAIT_DISPOSED_EVENT_TYPE, message: next,
          disposition: { mode: decision.change.mode, to: decision.change.mode === 'transfer' ? decision.change.to : null },
        });
        const fragment: CommitFragment = {
          records: [encodeSessionMessageRecord(next, preserved.value)],
          events: [event],
          guards: [{ refKey: sessionMessageRefKey(messageRef), expectedRevision: decision.before.revision }],
          claims: [],
        };
        return fragment;
      },
      result: {
        // The executor's replay decodes the LAST event: a transfer_reply's last event is the copied message's send.
        eventType: mode === 'transfer_reply'
          ? SESSION_MESSAGE_SENT_EVENT_TYPE : SESSION_MESSAGE_WAIT_DISPOSED_EVENT_TYPE,
        schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
        decode: sessionMessageFromEvent,
        validate: messageVersionAgainstReceipt,
        project: (message) => message,
      },
      retryable: {
        // Only a concurrent hand-off of this same reply re-reads and re-decides; `cancel`/`transfer` keep the
        // executor's conflict answer.
        guard: (refKey) => mode === 'transfer_reply'
          && (refKey === sessionMessageRefKey(messageRef) || refKey === transferReplyNewRefKey),
        claim: (claimKey) => mode === 'transfer_reply' && claimKey === replyClaimKey,
      },
    };

    const written = await executeWriteCommand(records, command);
    return written.status === 'refused' ? written.refusal : written;
  }

  return { forwardMessage, forwardCopiedIntervention, disposeWait };
}
