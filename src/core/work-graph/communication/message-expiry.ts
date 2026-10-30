// The file's imports: the type imports serve the declarations and bodies below.
import type { CoreCallContext, HostPrincipal } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import type { MessageSender, SessionMessage } from '../model/communication-contracts.js';
import { deriveSessionInputId } from '../model/communication-contracts.js';
import type { MessageCommandWritePort, SessionMessageWriteCommandV1 } from '../model/decision-contracts.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { OrderedLookupValue, RecordOrderedLookupPage, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import { executeWriteCommand, type WriteCommand } from '../persistence/command-executor.js';
import { ownerReadStoreFailureToRejection } from '../persistence/read-result-failures.js';
import {
  S7B_DUE_WAITS_LOOKUP, decodeSessionMessageRecord, sessionMessageFromEvent, sessionMessageRefKey,
} from '../sessions/message-record-codecs.js';
import {
  decideExpiry, waitFactsOfRecord, type ExpirySkipReason, type MessageExpiredChangeV1,
} from '../state/message-machine.js';
import {
  eventIdOf, mapReadResult, messageVersionAgainstReceipt, ownContext, readSessionMessageRecord,
} from './mailbox-service.js';

// X's declarations: the owner's result and read shapes, its dependencies and the port (D9; v2 ports §3).
export type RecordExpiryResultV1 = Extract<WriteResult<SessionMessage>, { status: 'committed' }>
  | { status: 'skipped'; reason: ExpirySkipReason } | CoreRejection;
export type DueWaitV1 = { messageRef: SessionMessageRef; deadline: string;
  after: { order: OrderedLookupValue; refKey: string } };
export type DueWaitPageInputV1 = { limit: number; after: { order: OrderedLookupValue; refKey: string } | null };
export type DueWaitsPageV1 = { items: DueWaitV1[]; next: RecordOrderedLookupPage['next'] };
export type MessageExpiryOwnerDependencies = {
  records: GoalRecordTransactionPort & RecordOrderedLookupPort;
  writes: Pick<MessageCommandWritePort, 'prepare'>;
  now(): string;
};
export interface MessageExpiryPort {
  recordExpiry(ctx: CoreCallContext, input: { messageRef: SessionMessageRef }): Promise<RecordExpiryResultV1>;
  readDueWaits(ctx: CoreCallContext,
    input: { workspace: WorkspaceScope; page: DueWaitPageInputV1 }): Promise<ReadResult<DueWaitsPageV1>>;
  readExpiryCount(ctx: CoreCallContext,
    input: { messageRef: SessionMessageRef }): Promise<ReadResult<1 | 2 | 'incomplete'>>;
}

/** One page of due waits per workspace per heartbeat (§3.7 item 4). */
export const EXPIRY_PAGE = 50;
/** The count's page and its ONE total budget: 25 link reads per page, four pages. */
const EXPIRY_COUNT_PAGE = 25;
const EXPIRY_COUNT_PAGES = 4;

export function createMessageExpiryOwner(deps: MessageExpiryOwnerDependencies): MessageExpiryPort {
  const records = deps.records;

  type ExpiryDecision = { before: SessionMessage; change: MessageExpiredChangeV1; at: string };

  async function recordExpiry(
    ctx: Parameters<MessageExpiryPort['recordExpiry']>[0],
    input: Parameters<MessageExpiryPort['recordExpiry']>[1],
  ): ReturnType<MessageExpiryPort['recordExpiry']> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    const messageRef = { ...input.messageRef };
    const commandId = deriveSessionInputId(messageRef, 'expiry');
    const command: WriteCommand<{ message: SessionMessage }, ExpiryDecision,
      { status: 'skipped'; reason: ExpirySkipReason } | CoreRejection, SessionMessage, SessionMessage> = {
      operation: 'message.recordExpiry',
      scope: { projectId: messageRef.projectId, workspaceId: messageRef.workspaceId },
      principal: null,
      commandId,
      fingerprintInput: { messageRef },
      read: async () => {
        const loaded = await readSessionMessageRecord(records, owned.signal, messageRef);
        return loaded.status === 'ready'
          ? { status: 'ready', facts: { message: loaded.value } }
          : mapReadResult(loaded) as CoreRejection;
      },
      decide: (facts) => {
        const at = deps.now();
        const decided = decideExpiry(facts.message, waitFactsOfRecord(facts.message), at);
        return 'skip' in decided
          ? { refuse: { status: 'skipped', reason: decided.skip } }
          : { decision: { before: facts.message, change: decided.change, at } };
      },
      build: async (decision, keys) => {
        const actor: MessageSender = { kind: 'host', actor: (owned.principal as HostPrincipal).actor };
        const write: SessionMessageWriteCommandV1 = {
          operation: 'message.recordExpiry',
          messageRef: decision.before.ref,
          before: decision.before,
          expectedRevision: decision.before.revision,
          event: {
            eventId: eventIdOf(keys.identityKey, 'SessionMessageExpired'), occurredAt: decision.at,
            requestId: commandId, projectId: messageRef.projectId, workspaceId: messageRef.workspaceId, actor,
          },
          change: decision.change,
        };
        return deps.writes.prepare(ctx, write, { records: [], events: [], guards: [], claims: [] });
      },
      result: {
        eventType: 'SessionMessageExpired', schemaVersion: 1,
        decode: sessionMessageFromEvent, validate: messageVersionAgainstReceipt, project: (decoded) => decoded,
      },
      retryable: { guard: (refKey) => refKey === sessionMessageRefKey(messageRef) },
    };
    const written = await executeWriteCommand(records, command);
    return written.status === 'committed' ? written : written.status === 'refused' ? written.refusal : written;
  }

  async function readDueWaits(
    ctx: Parameters<MessageExpiryPort['readDueWaits']>[0],
    input: Parameters<MessageExpiryPort['readDueWaits']>[1],
  ): ReturnType<MessageExpiryPort['readDueWaits']> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    let page: Awaited<ReturnType<typeof records.lookupOrdered>>;
    try {
      page = await records.lookupOrdered({
        index: S7B_DUE_WAITS_LOOKUP,
        values: [input.workspace.projectId, input.workspace.workspaceId, 'released', 'inquiry'],
        direction: 'asc',
        ...(input.page.after === null ? {} : { after: input.page.after }),
        limit: input.page.limit,
      });
    } catch {
      return reject('unavailable', 'the due-wait lookup failed');
    }
    if (page.status !== 'ready') return ownerReadStoreFailureToRejection(page);
    const items: DueWaitV1[] = [];
    for (const record of page.value.records) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status !== 'decoded') return reject('unavailable', `a due-wait candidate is damaged: ${decoded.reason}`);
      const message = decoded.value;
      if (message.waitAfterSend !== true || message.deadline === null || message.expiredAt !== null) continue;
      items.push({
        messageRef: message.ref, deadline: message.deadline,
        after: { order: message.deadline, refKey: sessionMessageRefKey(message.ref) },
      });
    }
    return { status: 'ready', value: { items, next: page.value.next } };
  }

  async function readExpiryCount(
    ctx: Parameters<MessageExpiryPort['readExpiryCount']>[0],
    input: Parameters<MessageExpiryPort['readExpiryCount']>[1],
  ): ReturnType<MessageExpiryPort['readExpiryCount']> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    const head = await readSessionMessageRecord(records, owned.signal, input.messageRef);
    if (head.status !== 'ready') return mapReadResult(head) as CoreRejection;
    let count: 1 | 2 = 1;                 // this message is the expired one; K's claim requires `expiredAt`
    let current = head.value.followupOf;
    for (let page = 0; page < EXPIRY_COUNT_PAGES; page += 1) {
      for (let step = 0; step < EXPIRY_COUNT_PAGE; step += 1) {
        if (current === null) return { status: 'ready', value: count };
        const read = await readSessionMessageRecord(records, owned.signal, current);
        if (read.status !== 'ready') return mapReadResult(read) as CoreRejection;
        if (read.value.expiredAt !== null) return { status: 'ready', value: 2 };
        current = read.value.followupOf;
      }
    }
    return current === null ? { status: 'ready', value: count } : { status: 'ready', value: 'incomplete' };
  }

  return { recordExpiry, readDueWaits, readExpiryCount };
}
