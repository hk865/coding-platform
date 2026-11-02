import type { CommitCursor } from '../../../contracts/command-event.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { QueryJobRefShape } from '../../../contracts/data-format-refs.js';
import { canonicalOf } from '../../../contracts/fingerprint.js';
import type { MessageReleaseBlockV1 } from '../../../contracts/goal-decisions.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import { deriveMessageDelivery } from '../model/communication-contracts.js';
import type {
  SessionMessage, SessionMessageOutboxPageV1, SessionMessageReadPageV1, SessionMessageStatus, UndeliveredReplyV1,
} from '../model/communication-contracts.js';
import type { SecretaryQueryRunV1 } from '../model/secretary-query-run-contracts.js';
import { SESSION_BY_PROVENANCE_LOOKUP, SESSION_REPLY_BY_HANDLER_LOOKUP } from '../model/session-facts-contracts.js';
import type { SessionPage, SessionPageRequest } from '../model/session-contracts.js';
import { decodeNoticeOrigin } from '../persistence/decision-record-codecs.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import type { RecordLookupRequest } from '../../record-store/lookup-ports.js';
import type { EncodedRecord, StoreResult } from '../../record-store/ports.js';
import {
  SESSION_MESSAGE_BY_RECIPIENT_LOOKUP, SESSION_MESSAGE_BY_RECIPIENT_STATUS_LOOKUP,
  SESSION_MESSAGE_BY_REQUEST_ROOT_LOOKUP, SESSION_MESSAGE_BY_SENDER_RUN_LOOKUP, SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP,
  decodeSessionMessageRecord, sessionMessageRefKey,
} from '../sessions/message-record-codecs.js';
import { checkPlainSessionRef, decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../sessions/session-record-codecs.js';
import { readBatch } from '../tasks/plan-readers.js';
import { releaseBlockOf } from './mailbox-basis.js';
import {
  atLeastCursorOf, internalHostContext, isRunRef, isUserRecipient, mapBatchFailure, ownContext, pageProblem, presenceOf,
  readProgress, recipientLineFacts, sameSessionRefAs,
} from './mailbox-common.js';
import { readWorkRunIdentity, secretaryReader } from './mailbox-identity.js';
import type {
  InboxCursorV1, InboxPage, MailboxContext, OutboxCursorV1, Owned, ReplyCursorV1, SecretaryOutboxCursorV1, Unknown,
} from './mailbox-types.js';

// --------------------------------------------------------------------------
// Inbox cursor: binds scope, recipient, filter, caller and the after key only.
// --------------------------------------------------------------------------

function encodeInboxCursor(cursor: InboxCursorV1): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeInboxCursor(raw: string): InboxCursorV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed['v'] !== 1) return null;
  const { projectId, workspaceId, recipient, status, callerKey, after } = parsed;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId) || !nonEmpty(callerKey) || !nonEmpty(after)) return null;
  if (!isObject(recipient) || !nonEmpty(recipient['projectId']) || !nonEmpty(recipient['sessionId'])) return null;
  if (!(status === null || status === 'pending' || status === 'read' || status === 'responded')) return null;
  return {
    v: 1, projectId, workspaceId,
    recipient: { projectId: recipient['projectId'], sessionId: recipient['sessionId'] },
    status, callerKey, after,
  };
}

// --------------------------------------------------------------------------
// Outbox cursor: binds scope, the exact sender Run, the caller and the after
// key only. It is a SEPARATE cursor namespace from the inbox.
// --------------------------------------------------------------------------

function encodeOutboxCursor(cursor: OutboxCursorV1): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeOutboxCursor(raw: string): OutboxCursorV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed['v'] !== 1) return null;
  const { projectId, workspaceId, senderRun, senderSession, callerKey, after } = parsed;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId) || !nonEmpty(callerKey) || !nonEmpty(after)) return null;
  if ((senderRun === undefined) === (senderSession === undefined)) return null;
  if (senderRun !== undefined && !isRunRef(senderRun)) return null;
  if (senderSession !== undefined && checkPlainSessionRef(senderSession) !== null) return null;
  return { v: 1, projectId, workspaceId, callerKey, after,
    ...(senderRun === undefined ? { senderSession: senderSession as SessionRef } : { senderRun: senderRun as RunRef }) };

}

// --------------------------------------------------------------------------
// Secretary outbox cursor: a FOURTH keyset namespace. It binds the scope, the
// resolved request root, the caller and the after key; a Host/work_run cursor
// never satisfies it.
// --------------------------------------------------------------------------

function encodeSecretaryOutboxCursor(cursor: SecretaryOutboxCursorV1): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeSecretaryOutboxCursor(raw: string): SecretaryOutboxCursorV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed['v'] !== 1) return null;
  const { projectId, workspaceId, requestRoot, callerKey, after } = parsed;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId) || !nonEmpty(callerKey) || !nonEmpty(after)) return null;
  if (checkShape(QueryJobRefShape, requestRoot, 'stored') !== null) return null;
  return { v: 1, projectId, workspaceId, requestRoot: requestRoot as QueryJobRef, callerKey, after };
}

// --------------------------------------------------------------------------
// Reply cursor: binds scope, the exact source/handler Session, the kind and the
// caller to the after key. It is a THIRD keyset namespace (inbox/outbox/reply).
// --------------------------------------------------------------------------

function encodeReplyCursor(cursor: ReplyCursorV1): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeReplyCursor(raw: string): ReplyCursorV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed['v'] !== 1) return null;
  const { kind, projectId, workspaceId, sessionId, callerKey, after } = parsed;
  if (kind !== 'routed' && kind !== 'undelivered') return null;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId) || !nonEmpty(sessionId) || !nonEmpty(callerKey) || !nonEmpty(after)) return null;
  return { v: 1, kind, projectId, workspaceId, sessionId, callerKey, after };
}

// ---- readInbox ----------------------------------------------------------

/**
 * `readInbox`'s own body (input validation, keyset cursor, `atLeastCursor`,
 * page limit, recipient/filter binding and recipient-bound authorization),
 * shared with `readInboxView` so the two can never drift.
 */
async function readInboxPage(mailbox: MailboxContext, owned: Owned, input: {
  recipient: SessionRef;
  status?: SessionMessageStatus;
  page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
}): Promise<ReadResult<InboxPage>> {
  const raw = input as unknown as Unknown | null | undefined;
  if (!isObject(raw)) return reject('invalid', 'readInbox requires an input object');
  if (Object.keys(raw).some((key) => key !== 'recipient' && key !== 'status' && key !== 'page')) {
    return reject('invalid', 'readInbox does not accept extra fields');
  }
  const recipientProblem = checkPlainSessionRef(raw['recipient']);
  if (recipientProblem !== null) return reject('invalid', `readInbox recipient: ${recipientProblem}`);
  const recipient = structuredClone(raw['recipient']) as SessionRef;
  if (recipient.projectId !== owned.projectId) return reject('forbidden', 'the inbox recipient belongs to another project');
  const status = raw['status'];
  if (status !== undefined && status !== 'pending' && status !== 'read' && status !== 'responded') {
    return reject('invalid', 'the inbox status filter is not recognized');
  }
  const page = pageProblem(mailbox, raw['page'], {
    requiresObject: 'readInbox requires a page object',
    extraFields: 'readInbox page does not accept extra fields',
    limit: 'readInbox limit must be an integer between 1 and 100',
  });
  if (!page.ok) return page.rejection;
  // Snapshot the complete page synchronously. No later await may re-read a
  // caller-mutable `page`; the decoded cursor below is the accepted one.
  if (page.rawCursor !== undefined && !nonEmpty(page.rawCursor)) {
    return reject('invalid', 'the inbox cursor must be a non-empty string');
  }
  let decodedCursor: InboxCursorV1 | null = null;
  if (page.rawCursor !== undefined) {
    decodedCursor = decodeInboxCursor(page.rawCursor);
    if (decodedCursor === null) return reject('invalid', 'the inbox cursor is not a valid continuation token');
    if (decodedCursor.projectId !== owned.projectId || decodedCursor.workspaceId !== owned.workspaceId
      || canonicalOf(decodedCursor.recipient) !== canonicalOf(recipient)
      || (decodedCursor.status ?? null) !== (status ?? null)) {
      return reject('invalid', 'the inbox cursor belongs to another scope, recipient or filter');
    }
  }
  const atLeast = atLeastCursorOf(mailbox, page.rawAtLeast);
  if (!atLeast.ok) return atLeast.rejection;
  const after = decodedCursor?.after;

  let secretary: { round: SecretaryQueryRunV1; reader: SessionRef } | null = null;
  if (owned.principal.kind === 'query_run') {
    const reading = await secretaryReader(mailbox, owned);
    if (!reading.ok) return reading.rejection;
    secretary = reading;
  }
  let callerKey: string;
  if (owned.principal.kind === 'host') {
    callerKey = canonicalOf({ kind: 'host', actor: { ...owned.principal.actor } }) ?? '';
  } else if (owned.principal.kind === 'work_run') {
    const identity = await readWorkRunIdentity(mailbox, owned, owned.principal, owned.principal.runRef);
    if (!identity.ok) return identity.rejection;
    const sessionRef: SessionRef = {
      projectId: identity.claim.sessionRef.projectId,
      sessionId: identity.claim.sessionRef.sessionId,
    };
    if (sessionRef.projectId !== recipient.projectId || sessionRef.sessionId !== recipient.sessionId) {
      return reject('forbidden', 'a work_run inbox is limited to its own formal Session');
    }
    callerKey = canonicalOf({ kind: 'work_run', sessionRef, runRef: identity.run.ref }) ?? '';
  } else {
    if (secretary === null) return reject('forbidden', 'the secretary inbox was not resolved');
    if (!sameSessionRefAs(secretary.reader, recipient)) {
      return reject('forbidden', 'a query_run inbox is limited to the resolved round Session');
    }
    callerKey = canonicalOf({ kind: 'query_run', sessionRef: secretary.reader,
      queryRunRef: secretary.round.run }) ?? '';
  }
  // Bind the ALREADY-DECODED snapshot to the trusted caller.
  if (decodedCursor !== null && decodedCursor.callerKey !== callerKey) {
    return reject('invalid', 'the inbox cursor does not belong to the current caller');
  }

  const filtered = status !== undefined;
  const request: RecordLookupRequest = {
    index: filtered ? SESSION_MESSAGE_BY_RECIPIENT_STATUS_LOOKUP : SESSION_MESSAGE_BY_RECIPIENT_LOOKUP,
    values: filtered
      ? [owned.projectId, owned.workspaceId, recipient.sessionId, status]
      : [owned.projectId, owned.workspaceId, recipient.sessionId],
    limit: page.limit,
    ...(after === undefined ? {} : { after }),
  };
  let pageResult: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
  try {
    pageResult = await mailbox.records.lookup(request);
  } catch {
    return reject('unavailable', 'the inbox lookup failed');
  }
  if (pageResult.status !== 'ready') return sessionStoreFailureToRejection(pageResult);
  const progress = readProgress(pageResult.value.readThrough, atLeast.atLeast);
  if (!progress.ok) return progress.result;
  const readThrough = progress.readThrough;
  const items: SessionMessage[] = [];
  const cursors: CommitCursor[] = [];
  for (const record of pageResult.value.records) {
    const decoded = decodeSessionMessageRecord(record);
    if (decoded.status !== 'decoded') return reject('unavailable', `an inbox candidate is damaged: ${decoded.reason}`);
    const message = decoded.value;
    const candidateRecipient = message.recipient;
    if (sessionMessageRefKey(message.ref) !== record.refKey
      || message.ref.projectId !== owned.projectId
      || message.ref.workspaceId !== owned.workspaceId
      || isUserRecipient(candidateRecipient)
      || candidateRecipient.projectId !== owned.projectId
      || candidateRecipient.sessionId !== recipient.sessionId
      || (status !== undefined && message.status !== status)) {
      return reject('unavailable', 'an inbox candidate disagrees with the requested recipient or filter');
    }
    const since = decodeNoticeOrigin(record);
    if (since.status !== 'decoded' || since.value.since === undefined) {
      return reject('unavailable', 'an inbox candidate has no commit origin');
    }
    items.push(message);
    cursors.push(since.value.since!);
  }
  const nextCursor = pageResult.value.next === null ? null : encodeInboxCursor({
    v: 1,
    projectId: owned.projectId,
    workspaceId: owned.workspaceId,
    recipient,
    status: status ?? null,
    callerKey,
    after: pageResult.value.next,
  });
  return { status: 'ready', value: { items, cursors, nextCursor, sourceCursor: readThrough, recipient } };
}

export async function readInbox(mailbox: MailboxContext, ctx: CoreCallContext, input: {
  recipient: SessionRef;
  status?: SessionMessageStatus;
  page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
}): Promise<ReadResult<{ items: SessionMessage[]; cursors: CommitCursor[]; nextCursor: string | null; sourceCursor: CommitCursor }>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  const page = await readInboxPage(mailbox, owned, input);
  if (page.status !== 'ready') return page;
  const { items, cursors, nextCursor, sourceCursor } = page.value;
  return { status: 'ready', value: { items, cursors, nextCursor, sourceCursor } };
}

export async function readInboxView(mailbox: MailboxContext, ctx: CoreCallContext, input: {
  recipient: SessionRef;
  status?: SessionMessageStatus;
  page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
}): Promise<ReadResult<SessionMessageReadPageV1>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  const page = await readInboxPage(mailbox, owned, input);
  if (page.status !== 'ready') return page;
  const { items, nextCursor, sourceCursor, recipient } = page.value;
  if (items.length === 0) return { status: 'ready', value: { items: [], nextCursor, sourceCursor } };
  const line = await recipientLineFacts(mailbox.deps, internalHostContext(mailbox, owned), recipient);
  if (!line.ok) return line.rejection;
  return { status: 'ready', value: {
    items: items.map((message) => ({ message, ...deriveMessageDelivery(message, line.value), releaseBlock: null })),
    nextCursor, sourceCursor,
  } };
}

// ---- readOutbox ---------------------------------------------------------

/**
 * Read messages SENT BY one exact Work Run or Session. It mirrors `readInbox`'s
 * keyset/atLeast contract over registered indexes: a Host caller may read its
 * workspace, a work_run caller only its own Run or Session. It never
 * acks, wakes or reorders a Session and never scans all Sessions.
 */
export async function readOutbox(mailbox: MailboxContext, ctx: CoreCallContext, input: {
  senderRun?: RunRef;
  senderSession?: SessionRef;
  page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
}): Promise<ReadResult<SessionMessageOutboxPageV1>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  const raw = input as unknown as Unknown | null | undefined;
  if (!isObject(raw)) return reject('invalid', 'readOutbox requires an input object');
  if (Object.keys(raw).some((key) => key !== 'senderRun' && key !== 'senderSession' && key !== 'page')) {
    return reject('invalid', 'readOutbox does not accept extra fields');
  }
  if ((raw['senderRun'] === undefined) === (raw['senderSession'] === undefined))
    return reject('invalid', 'readOutbox requires exactly one sender Run or Session');
  if (raw['senderRun'] !== undefined && !isRunRef(raw['senderRun'])) return reject('invalid', 'readOutbox requires a complete RunRef');
  if (raw['senderSession'] !== undefined && checkPlainSessionRef(raw['senderSession']) !== null)
    return reject('invalid', 'readOutbox requires a complete SessionRef');
  const senderRun = raw['senderRun'] === undefined ? undefined : structuredClone(raw['senderRun']) as RunRef;
  const senderSession = raw['senderSession'] === undefined ? undefined : structuredClone(raw['senderSession']) as SessionRef;
  if ((senderRun ?? senderSession)!.projectId !== owned.projectId) return reject('forbidden', 'the outbox sender belongs to another project');
  const page = pageProblem(mailbox, raw['page'], {
    requiresObject: 'readOutbox requires a page object',
    extraFields: 'readOutbox page does not accept extra fields',
    limit: 'readOutbox limit must be an integer between 1 and 100',
  });
  if (!page.ok) return page.rejection;
  if (page.rawCursor !== undefined && !nonEmpty(page.rawCursor)) {
    return reject('invalid', 'the outbox cursor must be a non-empty string');
  }
  const atLeast = atLeastCursorOf(mailbox, page.rawAtLeast);
  if (!atLeast.ok) return atLeast.rejection;

  // A secretary's outbox is the request root's messages, not a Run/Session
  // index range: the resolver supplies the root and the sending Session, and
  // the request-root index pages it. Host/work_run semantics stay below.
  if (owned.principal.kind === 'query_run') {
    const reading = await secretaryReader(mailbox, owned);
    if (!reading.ok) return reading.rejection;
    if (senderRun !== undefined) return reject('invalid', 'a secretary outbox read requires senderSession');
    const session = senderSession as SessionRef;
    if (!sameSessionRefAs(session, reading.reader)) {
      return reject('forbidden', 'a secretary outbox read is limited to the resolved round Session');
    }
    const callerKey = canonicalOf({ kind: 'query_run', sessionRef: reading.reader,
      queryRunRef: reading.round.run }) ?? '';
    let cursor: SecretaryOutboxCursorV1 | null = null;
    if (page.rawCursor !== undefined) {
      cursor = decodeSecretaryOutboxCursor(page.rawCursor);
      if (cursor === null) return reject('invalid', 'the outbox cursor is not a valid continuation token');
      if (cursor.projectId !== owned.projectId || cursor.workspaceId !== owned.workspaceId
        || canonicalOf(cursor.requestRoot) !== canonicalOf(reading.round.requestRoot)
        || cursor.callerKey !== callerKey) {
        return reject('invalid', 'the outbox cursor belongs to another scope, request root or caller');
      }
    }
    const request: RecordLookupRequest = {
      index: SESSION_MESSAGE_BY_REQUEST_ROOT_LOOKUP,
      values: [owned.projectId, owned.workspaceId, reading.round.requestRoot.queryJobId],
      limit: page.limit,
      ...(cursor === null ? {} : { after: cursor.after }),
    };
    let result: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
    try {
      result = await mailbox.records.lookup(request);
    } catch {
      return reject('unavailable', 'the outbox lookup failed');
    }
    if (result.status !== 'ready') return sessionStoreFailureToRejection(result);
    const progress = readProgress(result.value.readThrough, atLeast.atLeast);
    if (!progress.ok) return progress.result;
    const items: SessionMessage[] = [];
    const cursors: CommitCursor[] = [];
    for (const record of result.value.records) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status !== 'decoded') return reject('unavailable', `an outbox candidate is damaged: ${decoded.reason}`);
      const message = decoded.value;
      if (sessionMessageRefKey(message.ref) !== record.refKey
        || message.ref.projectId !== owned.projectId || message.ref.workspaceId !== owned.workspaceId
        || message.requestRoot === null
        || canonicalOf(message.requestRoot) !== canonicalOf(reading.round.requestRoot)
        || message.sender.kind !== 'secretary_round'
        || canonicalOf(message.sender.requestRoot) !== canonicalOf(reading.round.requestRoot)) {
        return reject('unavailable', 'an outbox candidate disagrees with the resolved request root');
      }
      const since = decodeNoticeOrigin(record);
      if (since.status !== 'decoded' || since.value.since === undefined) {
        return reject('unavailable', 'an outbox candidate has no commit origin');
      }
      items.push(message);
      cursors.push(since.value.since!);
    }
    const nextCursor = result.value.next === null ? null : encodeSecretaryOutboxCursor({
      v: 1, projectId: owned.projectId, workspaceId: owned.workspaceId,
      requestRoot: { ...reading.round.requestRoot }, callerKey, after: result.value.next,
    });
    const releaseBlocks: (MessageReleaseBlockV1 | null)[] = [];
    for (const message of items) {
      const block = await releaseBlockOf(mailbox, owned, message);
      if (block.status !== 'ready') return block;
      releaseBlocks.push(block.value);
    }
    return { status: 'ready', value: { items, releaseBlocks, cursors, nextCursor, sourceCursor: progress.readThrough } };
  }

  let decodedCursor: OutboxCursorV1 | null = null;
  if (page.rawCursor !== undefined) {
    decodedCursor = decodeOutboxCursor(page.rawCursor);
    if (decodedCursor === null) return reject('invalid', 'the outbox cursor is not a valid continuation token');
    if (decodedCursor.projectId !== owned.projectId || decodedCursor.workspaceId !== owned.workspaceId
      || canonicalOf(decodedCursor.senderRun ?? decodedCursor.senderSession) !== canonicalOf(senderRun ?? senderSession)) {
      return reject('invalid', 'the outbox cursor belongs to another scope or sender Run');
    }
  }
  const after = decodedCursor?.after;

  let callerKey: string;
  if (owned.principal.kind === 'host') {
    callerKey = canonicalOf({ kind: 'host', actor: { ...owned.principal.actor } }) ?? '';
  } else if (owned.principal.kind === 'work_run') {
    const identity = await readWorkRunIdentity(mailbox, owned, owned.principal, owned.principal.runRef);
    if (!identity.ok) return identity.rejection;
    if (senderRun !== undefined ? canonicalOf(identity.run.ref) !== canonicalOf(senderRun)
      : canonicalOf(identity.claim.sessionRef) !== canonicalOf(senderSession)) {
      return reject('forbidden', 'a work_run outbox read is limited to its own Run or Session');
    }
    callerKey = canonicalOf({ kind: 'work_run', sessionRef: identity.claim.sessionRef, runRef: identity.run.ref }) ?? '';
  } else {
    return reject('forbidden', 'the mailbox reader principal is not supported');
  }
  if (decodedCursor !== null && decodedCursor.callerKey !== callerKey) {
    return reject('invalid', 'the outbox cursor does not belong to the current caller');
  }

  const request: RecordLookupRequest = {
    index: senderRun === undefined ? SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP : SESSION_MESSAGE_BY_SENDER_RUN_LOOKUP,
    values: senderRun === undefined ? [owned.projectId, owned.workspaceId, senderSession!.sessionId]
      : [owned.projectId, owned.workspaceId, senderRun.goalId, senderRun.runId],
    limit: page.limit,
    ...(after === undefined ? {} : { after }),
  };
  let pageResult: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
  try {
    pageResult = await mailbox.records.lookup(request);
  } catch {
    return reject('unavailable', 'the outbox lookup failed');
  }
  if (pageResult.status !== 'ready') return sessionStoreFailureToRejection(pageResult);
  const progress = readProgress(pageResult.value.readThrough, atLeast.atLeast);
  if (!progress.ok) return progress.result;
  const readThrough = progress.readThrough;
  const items: SessionMessage[] = [];
  const cursors: CommitCursor[] = [];
  for (const record of pageResult.value.records) {
    const decoded = decodeSessionMessageRecord(record);
    if (decoded.status !== 'decoded') return reject('unavailable', `an outbox candidate is damaged: ${decoded.reason}`);
    const message = decoded.value;
    if (sessionMessageRefKey(message.ref) !== record.refKey || message.ref.projectId !== owned.projectId
      || message.ref.workspaceId !== owned.workspaceId) return reject('unavailable', 'an outbox candidate disagrees with the requested sender Run');
    const since = decodeNoticeOrigin(record);
    if (since.status !== 'decoded' || since.value.since === undefined) {
      return reject('unavailable', 'an outbox candidate has no commit origin');
    }
    // The person reads the Session's whole outbox, including what its
    // secretary round sent; a work_run keeps only its own work_run messages.
    if (senderRun === undefined && message.sender.kind === 'secretary_round'
      && canonicalOf(message.sender.sessionRef) === canonicalOf(senderSession)) {
      if (owned.principal.kind === 'host') { items.push(message); cursors.push(since.value.since!); }
      continue;
    }
    if (message.sender.kind !== 'work_run' || (senderRun === undefined
      ? canonicalOf(message.sender.sessionRef) !== canonicalOf(senderSession)
      : canonicalOf(message.sender.runRef) !== canonicalOf(senderRun))) {
      return reject('unavailable', 'an outbox candidate disagrees with the requested sender Run');
    }
    items.push(message);
    cursors.push(since.value.since!);
  }
  const nextCursor = pageResult.value.next === null ? null : encodeOutboxCursor({
    v: 1,
    projectId: owned.projectId,
    workspaceId: owned.workspaceId,
    ...(senderRun === undefined ? { senderSession: senderSession! } : { senderRun }),
    callerKey,
    after: pageResult.value.next,
  });
  const releaseBlocks: (MessageReleaseBlockV1 | null)[] = [];
  for (const message of items) {
    const block = await releaseBlockOf(mailbox, owned, message);
    if (block.status !== 'ready') return block;
    releaseBlocks.push(block.value);
  }
  return { status: 'ready', value: { items, releaseBlocks, cursors, nextCursor, sourceCursor: readThrough } };
}

// ---- readRoutedReplies / readUndeliveredReplies (slice 1 §2.5) ----------

/** A work_run reads only its own Session; a Host reads within its workspace. */
async function replyCallerKey(mailbox: MailboxContext, owned: Owned, session: SessionRef, what: string):
Promise<{ ok: true; key: string } | { ok: false; rejection: CoreRejection }> {
  if (owned.principal.kind === 'host') {
    return { ok: true, key: canonicalOf({ kind: 'host', actor: { ...owned.principal.actor } }) ?? '' };
  }
  if (owned.principal.kind === 'work_run') {
    const identity = await readWorkRunIdentity(mailbox, owned, owned.principal, owned.principal.runRef);
    if (!identity.ok) return { ok: false, rejection: identity.rejection };
    if (canonicalOf(identity.claim.sessionRef) !== canonicalOf(session)) {
      return { ok: false, rejection: reject('forbidden', `a work_run ${what} read is limited to its own Session`) };
    }
    return { ok: true, key: canonicalOf({ kind: 'work_run', sessionRef: identity.claim.sessionRef, runRef: identity.run.ref }) ?? '' };
  }
  return { ok: false, rejection: reject('forbidden', 'the mailbox reader principal is not supported') };
}

export async function readRoutedReplies(
  mailbox: MailboxContext, ctx: CoreCallContext, input: { handler: SessionRef; page: SessionPageRequest },
): Promise<ReadResult<SessionPage<SessionMessage>>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  const raw = input as unknown as Unknown;
  if (!isObject(raw)) return reject('invalid', 'readRoutedReplies requires an input object');
  if (Object.keys(raw).some((key) => key !== 'handler' && key !== 'page')) {
    return reject('invalid', 'readRoutedReplies does not accept extra fields');
  }
  const handlerProblem = checkPlainSessionRef(raw['handler']);
  if (handlerProblem !== null) return reject('invalid', `readRoutedReplies handler: ${handlerProblem}`);
  const handler = structuredClone(raw['handler']) as SessionRef;
  if (handler.projectId !== owned.projectId) return reject('forbidden', 'the reply handler belongs to another project');
  const page = pageProblem(mailbox, raw['page'], {
    requiresObject: 'the reply page must be an object',
    extraFields: 'the reply page does not accept extra fields',
    limit: 'the reply limit must be an integer between 1 and 100',
  });
  if (!page.ok) return page.rejection;
  const caller = await replyCallerKey(mailbox, owned, handler, 'routed-replies');
  if (!caller.ok) return caller.rejection;
  if (page.rawCursor !== undefined && !nonEmpty(page.rawCursor)) {
    return reject('invalid', 'the reply cursor must be a non-empty string');
  }
  let decodedCursor: ReplyCursorV1 | null = null;
  if (page.rawCursor !== undefined) {
    decodedCursor = decodeReplyCursor(page.rawCursor);
    if (decodedCursor === null) return reject('invalid', 'the reply cursor is not a valid continuation token');
    if (decodedCursor.kind !== 'routed' || decodedCursor.projectId !== owned.projectId
      || decodedCursor.workspaceId !== owned.workspaceId || decodedCursor.sessionId !== handler.sessionId) {
      return reject('invalid', 'the reply cursor belongs to another scope or handler');
    }
  }
  const atLeast = atLeastCursorOf(mailbox, page.rawAtLeast);
  if (!atLeast.ok) return atLeast.rejection;
  if (decodedCursor !== null && decodedCursor.callerKey !== caller.key) {
    return reject('invalid', 'the reply cursor does not belong to the current caller');
  }
  const after = decodedCursor?.after;
  const request: RecordLookupRequest = {
    index: SESSION_REPLY_BY_HANDLER_LOOKUP,
    values: [owned.projectId, owned.workspaceId, handler.sessionId],
    limit: page.limit,
    ...(after === undefined ? {} : { after }),
  };
  let pageResult: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
  try {
    pageResult = await mailbox.records.lookup(request);
  } catch {
    return reject('unavailable', 'the routed-reply lookup failed');
  }
  if (pageResult.status !== 'ready') return sessionStoreFailureToRejection(pageResult);
  const progress = readProgress(pageResult.value.readThrough, atLeast.atLeast);
  if (!progress.ok) return progress.result;
  const readThrough = progress.readThrough;
  const items: SessionMessage[] = [];
  for (const record of pageResult.value.records) {
    const decoded = decodeSessionMessageRecord(record);
    if (decoded.status !== 'decoded') return reject('unavailable', `a routed-reply candidate is damaged: ${decoded.reason}`);
    const message = decoded.value;
    const handlerRef = message.replyHandler ?? null;
    if (sessionMessageRefKey(message.ref) !== record.refKey
      || message.ref.projectId !== owned.projectId || message.ref.workspaceId !== owned.workspaceId
      || handlerRef === null || canonicalOf(handlerRef.sessionRef) !== canonicalOf(handler)) {
      return reject('unavailable', 'a routed-reply candidate disagrees with the requested handler');
    }
    items.push(message);
  }
  const nextCursor = pageResult.value.next === null ? null : encodeReplyCursor({
    v: 1, kind: 'routed', projectId: owned.projectId, workspaceId: owned.workspaceId,
    sessionId: handler.sessionId, callerKey: caller.key, after: pageResult.value.next,
  });
  return { status: 'ready', value: { items, nextCursor, sourceCursor: readThrough } };
}

export async function readUndeliveredReplies(
  mailbox: MailboxContext, ctx: CoreCallContext, input: { sessionRef: SessionRef; page: SessionPageRequest },
): Promise<ReadResult<SessionPage<UndeliveredReplyV1>>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  const raw = input as unknown as Unknown;
  if (!isObject(raw)) return reject('invalid', 'readUndeliveredReplies requires an input object');
  if (Object.keys(raw).some((key) => key !== 'sessionRef' && key !== 'page')) {
    return reject('invalid', 'readUndeliveredReplies does not accept extra fields');
  }
  const sessionProblem = checkPlainSessionRef(raw['sessionRef']);
  if (sessionProblem !== null) return reject('invalid', `readUndeliveredReplies sessionRef: ${sessionProblem}`);
  const sessionRef = structuredClone(raw['sessionRef']) as SessionRef;
  if (sessionRef.projectId !== owned.projectId) return reject('forbidden', 'the reply source belongs to another project');
  const page = pageProblem(mailbox, raw['page'], {
    requiresObject: 'the reply page must be an object',
    extraFields: 'the reply page does not accept extra fields',
    limit: 'the reply limit must be an integer between 1 and 100',
  });
  if (!page.ok) return page.rejection;
  const caller = await replyCallerKey(mailbox, owned, sessionRef, 'undelivered-replies');
  if (!caller.ok) return caller.rejection;
  if (page.rawCursor !== undefined && !nonEmpty(page.rawCursor)) {
    return reject('invalid', 'the reply cursor must be a non-empty string');
  }
  let decodedCursor: ReplyCursorV1 | null = null;
  if (page.rawCursor !== undefined) {
    decodedCursor = decodeReplyCursor(page.rawCursor);
    if (decodedCursor === null) return reject('invalid', 'the reply cursor is not a valid continuation token');
    if (decodedCursor.kind !== 'undelivered' || decodedCursor.projectId !== owned.projectId
      || decodedCursor.workspaceId !== owned.workspaceId || decodedCursor.sessionId !== sessionRef.sessionId) {
      return reject('invalid', 'the reply cursor belongs to another scope or source Session');
    }
  }
  const atLeast = atLeastCursorOf(mailbox, page.rawAtLeast);
  if (!atLeast.ok) return atLeast.rejection;
  if (decodedCursor !== null && decodedCursor.callerKey !== caller.key) {
    return reject('invalid', 'the reply cursor does not belong to the current caller');
  }
  const after = decodedCursor?.after;
  // The source Session's retirement is the durable fact; without it nothing is
  // an undelivered reply. The read is otherwise pure and never acks.
  const sourceKey = sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef));
  const sourceRead = await readBatch(mailbox.records, [sourceKey]);
  if (sourceRead.status !== 'ready') return mapBatchFailure(mailbox, sourceRead);
  const sourcePresence = presenceOf(mailbox, sourceRead.batch, sourceKey);
  if (sourcePresence === 'missing') return reject('not_found', 'the undelivered-reply source Session does not exist');
  if (sourcePresence === 'unaccounted') return reject('unavailable', 'the source Session was neither returned nor reported missing');
  const sourceDecoded = decodeSessionRecord(sourceRead.batch.present.get(sourceKey) as EncodedRecord);
  if (sourceDecoded.status !== 'decoded') return reject('unavailable', `the source Session is damaged: ${sourceDecoded.reason}`);
  const retired = sourceDecoded.value.health === 'unavailable';
  let hasContinuation = false;
  if (retired) {
    let continuationRead: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
    try {
      continuationRead = await mailbox.records.lookup({
        index: SESSION_BY_PROVENANCE_LOOKUP,
        values: [owned.projectId, owned.workspaceId, sessionRef.sessionId],
        limit: 1,
      });
    } catch {
      return reject('unavailable', 'the Session continuation lookup failed');
    }
    if (continuationRead.status !== 'ready') return sessionStoreFailureToRejection(continuationRead);
    hasContinuation = continuationRead.value.records.length > 0;
  }
  const request: RecordLookupRequest = {
    index: SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP,
    values: [owned.projectId, owned.workspaceId, sessionRef.sessionId],
    limit: page.limit,
    ...(after === undefined ? {} : { after }),
  };
  let pageResult: StoreResult<{ records: EncodedRecord[]; next: string | null; readThrough: CommitCursor | null }>;
  try {
    pageResult = await mailbox.records.lookup(request);
  } catch {
    return reject('unavailable', 'the undelivered-reply lookup failed');
  }
  if (pageResult.status !== 'ready') return sessionStoreFailureToRejection(pageResult);
  const progress = readProgress(pageResult.value.readThrough, atLeast.atLeast);
  if (!progress.ok) return progress.result;
  const readThrough = progress.readThrough;
  const items: UndeliveredReplyV1[] = [];
  for (const record of pageResult.value.records) {
    const decoded = decodeSessionMessageRecord(record);
    if (decoded.status !== 'decoded') return reject('unavailable', `an undelivered-reply candidate is damaged: ${decoded.reason}`);
    const message = decoded.value;
    if (sessionMessageRefKey(message.ref) !== record.refKey || message.ref.projectId !== owned.projectId
      || message.ref.workspaceId !== owned.workspaceId || message.sender.kind !== 'work_run'
      || canonicalOf(message.sender.sessionRef) !== canonicalOf(sessionRef)) {
      return reject('unavailable', 'an undelivered-reply candidate disagrees with the requested source Session');
    }
    if (!retired || message.response === null) continue;
    const response = message.response;
    // A reply already used by an execution is delivered, never undelivered.
    if ((message.acceptedInputs ?? []).some((entry) => entry.part === 'response')) continue;
    const unavailableSince = sourceDecoded.value.unavailableSince;
    const responseSince = message.responseSince;
    // Spec §2.3/L7: a retired source and a replied work_run message always
    // carry their bound positions; a missing one is damaged, never a DTO
    // without the field.
    if (unavailableSince === undefined || unavailableSince === null) {
      return reject('unavailable', 'an undelivered-reply source Session has no entry position');
    }
    if (responseSince === undefined || responseSince === null) {
      return reject('unavailable', 'an undelivered-reply message has no reply position');
    }
    items.push({
      kind: 'retired_reply', messageRef: message.ref, sourceSessionRef: sessionRef,
      responseRef: response.bodyRef, respondedAt: response.respondedAt,
      hasContinuation, requiresUserRecipient: !hasContinuation,
      unavailableSince, responseSince,
    });
  }
  const nextCursor = pageResult.value.next === null ? null : encodeReplyCursor({
    v: 1, kind: 'undelivered', projectId: owned.projectId, workspaceId: owned.workspaceId,
    sessionId: sessionRef.sessionId, callerKey: caller.key, after: pageResult.value.next,
  });
  return { status: 'ready', value: { items, nextCursor, sourceCursor: readThrough } };
}
