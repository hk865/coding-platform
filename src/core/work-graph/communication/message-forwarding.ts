/**
 * The forward owner (§3.9 items 1–5): `messages/forward` and `waits/dispose` as the two R2 commands, plus the copy
 * owner's trusted entry. The reads are the mailbox's one record read and the one delivery derivation; the records are
 * the message machine's two constructors; the commit is the one command executor. This file adds no second owner, no
 * second record constructor and no release path: an unreleased original goes through 7A's `messages/release`.
 *
 * The ordinary entry is the person's; the trusted entry is the copy owner's and admits the copy branch only. Both
 * paths judge the same pure table (`forwardMessageProblem`) and the transfer shares `destinationProblem` with it.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import type { RoleBindingRefV1 } from '../../../contracts/dispatch.js';
import type { RoleConfigurationRef, SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import type { MessageDeliveryStateV1, SessionMessageIntentV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import { canonicalJson, sameJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { MessageDutiesFactsPort } from '../model/decision-contracts.js';
import type { SessionDirectoryPort } from '../model/session-contracts.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import { deriveMessageDelivery } from '../model/communication-contracts.js';
import type { SessionMessageRecord } from '../state/message-machine.js';
import {
  FORWARD_DESTINATION_GONE, createSessionMessageRecord, disposeWaitProblem,
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
  SESSION_MESSAGE_EVENT_SCHEMA_VERSION, SESSION_MESSAGE_FORWARDED_EVENT_TYPE, SESSION_MESSAGE_SENT_EVENT_TYPE,
  SESSION_MESSAGE_WAIT_DISPOSED_EVENT_TYPE, encodeSessionMessageForwardedEvent,
  encodeSessionMessageRecord, encodeSessionMessageSentEvent, encodeSessionMessageWaitDisposedEvent,
  sessionMessageFromEvent, sessionMessageRefKey,
} from '../sessions/message-record-codecs.js';
import {
  eventIdOf, mapReadResult, messageSenderSessionOf, messageVersionAgainstReceipt, ownContext,
  preservedNoticeOrigin, readSessionMessageRecord, recipientLineFacts, replyTargetEligible, type Owned,
} from './mailbox-service.js';
import {
  executeWriteCommand, type CommitFragment, type WriteCommand,
} from '../persistence/command-executor.js';

export { FORWARD_DESTINATION_GONE } from '../state/message-machine.js';

/** `messages/forward` (L(3), `book-7b.md:942`); `copyGoalRef` is the copy branch (§3.9 item 1, B-03). */
export type ForwardMessageInputV1 = {
  commandId: string; messageRef: SessionMessageRef; to: SessionRef; copyGoalRef?: GoalRef | null;
};
/** `waits/dispose` (§3.9 item 5); `to` is required exactly for `transfer`. */
export type DisposeWaitInputV1 = {
  commandId: string; messageRef: SessionMessageRef; mode: 'cancel' | 'transfer'; to?: SessionRef;
};
/**
 * `forwarded` is the one commit; `existing` is the same-destination second command (§3.9 item 2: "the existing
 * result") and carries no cursor because it wrote nothing. A refusal is a CoreRejection.
 */
export type ForwardMessageResultV1 =
  | { status: 'forwarded'; message: SessionMessage; replayed: boolean; cursor: CommitCursor }
  | { status: 'existing'; message: SessionMessage }
  | CoreRejection;

export interface MessageForwardingPort {
  forwardMessage(ctx: CoreCallContext, input: ForwardMessageInputV1): Promise<ForwardMessageResultV1>;
  /** P's trusted entry: no person check, the copy branch only. */
  forwardCopiedIntervention(ctx: CoreCallContext,
    input: ForwardMessageInputV1 & { copyGoalRef: GoalRef }): Promise<ForwardMessageResultV1>;
  disposeWait(ctx: CoreCallContext, input: DisposeWaitInputV1): Promise<WriteResult<SessionMessage>>;
}

export type MessageForwardingDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  sessions: Pick<SessionDirectoryPort, 'readSession'>;
  /** The one duties adapter (`W/configuration/message-duties-adapter.ts:51`); absent: a non-notify forward is `unsupported`. */
  duties?: MessageDutiesFactsPort;
  now(): string;
};

/** `notify` → any; `inquiry` → any duty that can reply (every line can); `action_request` → never a secretary. */
export function forwardDutyAllows(intent: SessionMessageIntentV1 | undefined,
  duties: readonly PlatformDutyV1[]): boolean {
  if (intent === undefined || intent === 'notify' || intent === 'inquiry') return true;
  return duties.some((duty) => duty === 'executor' || duty === 'adviser' || duty === 'scribe');
}

/**
 * The duties adapter's input names the destination Session's own fixed role: the adapter reads that record and
 * refuses a binding that disagrees with it, so only `templateId`/`templateRevision` carry anything and the rest is
 * derived from the same role (never from the caller).
 */
function dutyBinding(role: RoleConfigurationRef): RoleBindingRefV1 {
  if (role.kind === 'role_spec') {
    return { schemaVersion: 1, bindingId: `session-role:${role.pin.ref.roleId}`, templateId: role.pin.ref.roleId,
      templateRevision: String(role.pin.ref.revision), bindingVersion: 1, policyRevision: role.pin.digest };
  }
  return { schemaVersion: 1, bindingId: `session-role:${role.templateId}`, templateId: role.templateId,
    templateRevision: role.templateRevision, bindingVersion: 1, policyRevision: 'legacy-template' };
}

type ForwardReadFacts =
  | { kind: 'transferred'; existing: SessionMessage; sameDestination: boolean }
  | { kind: 'fresh'; before: SessionMessage; facts: ForwardFactsV1 };

function copyGoalOf(input: ForwardMessageInputV1): GoalRef | null {
  return input.copyGoalRef === undefined || input.copyGoalRef === null ? null : input.copyGoalRef;
}

/** The dispose input's shape checks: `transfer` needs a complete target; `cancel` must not carry one. */
function disposeInputProblem(input: DisposeWaitInputV1): CoreRejection | null {
  if (input.mode !== 'cancel' && input.mode !== 'transfer') return reject('invalid', 'the wait disposal mode is not recognized');
  if (input.mode === 'transfer') {
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
   * The one destination read both commands use (§3.9 item 3). A gone line is refused before its role or workspace is
   * used, so a duty read cannot turn "gone" into another answer. The cross-workspace comparison is the real
   * `SessionRecord.workspaceId` against the bound context, never the caller's `SessionRef` (which has no workspace).
   */
  async function readDestination(owned: Owned, ctx: CoreCallContext, to: SessionRef,
    intent: SessionMessageIntentV1 | undefined): Promise<
    { ok: true; value: ForwardFactsV1['destination'] } | { ok: false; rejection: CoreRejection }> {
    // Another project's Session is not found, as the directory's own read answers it (book §3.9 item 3: same project).
    if (to.projectId !== owned.projectId) {
      return { ok: false, rejection: reject('not_found', 'the destination Session does not exist') };
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
    if (target.value.workspaceId !== owned.workspaceId) {
      return { ok: true, value: { sameWorkspace: false, eligible: false, dutyAllows: true } };
    }
    let dutyAllows = true;
    if (intent !== undefined && intent !== 'notify') {
      if (deps.duties === undefined) {
        return { ok: false, rejection: reject('unsupported', 'the trusted duties adapter is not configured for a forward') };
      }
      let facts: ReadResult<{ duties: PlatformDutyV1[] }>;
      try {
        facts = await deps.duties.readMessageDutiesFacts(ctx, { sessionRef: to, roleBinding: dutyBinding(target.value.role) });
      } catch {
        return { ok: false, rejection: reject('unavailable', 'the destination duties could not be read') };
      }
      if (facts.status !== 'ready') return { ok: false, rejection: mapReadResult(facts) as CoreRejection };
      dutyAllows = forwardDutyAllows(intent, facts.value.duties);
    }
    return { ok: true, value: {
      sameWorkspace: true,
      eligible: replyTargetEligible(owned, target.value),
      dutyAllows,
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

    // The ruling's read list includes the sender line; a Host message has no Session line to read.
    const sender = messageSenderSessionOf(before);
    if (sender !== null) {
      const senderLine = await recipientLineFacts(deps, ctx, sender);
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

    const destination = await readDestination(owned, ctx, input.to, before.intent);
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
    return { status: 'ready', facts: { kind: 'fresh', before, facts } };
  }

  async function forward(ctx: CoreCallContext, input: ForwardMessageInputV1, copyOnly: boolean):
    Promise<ForwardMessageResultV1> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    if (owned.principal.kind !== 'host') {
      return reject('forbidden', 'a forward requires the trusted Host principal');
    }
    if (!copyOnly && owned.principal.actor.kind !== 'human') {
      return reject('forbidden', 'messages/forward is person-only');
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
      { before: SessionMessage; copyGoalRef: GoalRef | null }, ForwardMessageResultV1,
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
        return { decision: { before: facts.before, copyGoalRef } };
      },
      build: async (decision, keys) => {
        const at = deps.now();
        const before = decision.before;
        const messageId = 'session-message-forward-' + sha256Hex(canonicalJson({
          projectId: owned.projectId, workspaceId: owned.workspaceId, original: messageRef, to,
        } as unknown as JsonValue));
        const newRef: SessionMessageRef = {
          aggregateType: 'SessionMessage', projectId: owned.projectId, workspaceId: owned.workspaceId, messageId,
        };
        const newRecord: SessionMessageRecord = createSessionMessageRecord({
          ref: newRef,
          sender: before.sender,
          recipient: to,
          bodyRef: before.bodyRef,
          sourceRef: before.sourceRef,
          createdAt: at,
          intent: before.intent ?? null,
          needsReply: before.needsReply === true,
          waitAfterSend: before.waitAfterSend === true,
          goalRef: decision.copyGoalRef === null ? before.goalRef : decision.copyGoalRef,
          taskRef: null,
          followupOf: null,
          requestRoot: null,
          deadline: before.deadline,
          deadlineMs: before.deadlineMs,
          release: before.release,
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
    const to: SessionRef | null = input.mode === 'transfer' ? { ...(input.to as SessionRef) } : null;
    const mode = input.mode;

    const command: WriteCommand<{ before: SessionMessage; facts: DisposeFactsV1 },
      { before: SessionMessage; change: { mode: 'cancel' } | { mode: 'transfer'; to: SessionRef } },
      CoreRejection, SessionMessage, SessionMessage> = {
      operation: 'message.disposeWait',
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
        const sender = messageSenderSessionOf(before);
        if (sender !== null) {
          const senderLine = await recipientLineFacts(deps, ctx, sender);
          if (!senderLine.ok) return senderLine.rejection;
          waitingLineGone = senderLine.value.archived || senderLine.value.retired || senderLine.value.archiving;
        }
        let destination: DisposeFactsV1['destination'] = null;
        if (mode === 'transfer') {
          const read = await readDestination(owned, ctx, to as SessionRef, before.intent);
          if (!read.ok) return read.rejection;
          destination = read.value;
        }
        const facts: DisposeFactsV1 = {
          mode,
          message: before,
          wait,
          delivery: delivery.delivery,
          acceptedResponse: (before.acceptedInputs ?? []).some((entry) => entry.part === 'response'),
          waitingLineGone,
          destination,
        };
        return { status: 'ready', facts: { before, facts } };
      },
      decide: (facts) => {
        const problem = disposeWaitProblem(facts.facts);
        if (problem !== null) return { refuse: problem };
        return { decision: { before: facts.before, change: mode === 'transfer'
          ? { mode: 'transfer', to: to as SessionRef } : { mode: 'cancel' } } };
      },
      build: async (decision, keys) => {
        const at = deps.now();
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
        eventType: SESSION_MESSAGE_WAIT_DISPOSED_EVENT_TYPE,
        schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
        decode: sessionMessageFromEvent,
        validate: messageVersionAgainstReceipt,
        project: (message) => message,
      },
    };

    const written = await executeWriteCommand(records, command);
    return written.status === 'refused' ? written.refusal : written;
  }

  return { forwardMessage, forwardCopiedIntervention, disposeWait };
}
