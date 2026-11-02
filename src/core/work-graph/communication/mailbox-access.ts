import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { canonicalOf } from '../../../contracts/fingerprint.js';
import { isRecord as isObject } from '../../../contracts/validation/common.js';
import { deriveMessageDelivery } from '../model/communication-contracts.js';
import type { SessionMessage, SessionMessageReadV1 } from '../model/communication-contracts.js';
import type { SecretaryQueryRunV1 } from '../model/secretary-query-run-contracts.js';
import { decodeStoredMessageBody, decodeStoredUserDecisionBody, isUserDecisionAnswerPart } from '../sessions/message-body-envelope.js';
import { releaseBlockOf } from './mailbox-basis.js';
import {
  internalHostContext, isUserRecipient, isolatedContext, loadMessage, mapReadResult, normalizeMessageRef,
  ownContext, recipientLineFacts, sameSessionRefAs, scopeOfMessageRef,
} from './mailbox-common.js';
import { deriveWorkRunSender, readWorkRunIdentity, secretaryReader } from './mailbox-identity.js';
import type { MailboxContext, Owned, ReadRight, Unknown } from './mailbox-types.js';

// ---- read authority -----------------------------------------------------

/**
 * The one single-message read right. Steps 1–4 establish a right without any
 * read; only a secretary-sent message with a request root and no established
 * right consults the request's owner. `ready(null)` and `not_found` add no
 * right; any other failure is `unavailable`; a failure never erases an
 * already established right.
 */
async function canReadMessage(mailbox: MailboxContext, owned: Owned, reader: SessionRef, message: SessionMessage): Promise<ReadRight> {
  const recipient = message.recipient;
  if (!isUserRecipient(recipient)
    && recipient.projectId === reader.projectId && recipient.sessionId === reader.sessionId) {
    return { ok: true, allowed: true };
  }
  if (message.sender.kind === 'work_run' && sameSessionRefAs(message.sender.sessionRef, reader)) {
    return { ok: true, allowed: true };
  }
  if (message.sender.kind === 'secretary_round' && sameSessionRefAs(message.sender.sessionRef, reader)) {
    return { ok: true, allowed: true };
  }
  // Slice 1 §2.5: the effective reply handler may read the original message
  // and its response body, but this never widens ack/respond rights (those
  // still use `ownsInbox`, i.e. the original recipient).
  const handler = message.replyHandler ?? null;
  if (handler !== null && sameSessionRefAs(handler.sessionRef, reader)) return { ok: true, allowed: true };
  if (message.sender.kind !== 'secretary_round' || message.requestRoot === null) {
    return { ok: true, allowed: false };
  }
  if (mailbox.deps.requestOwners === undefined) {
    return { ok: false, rejection: reject('unsupported', 'the request-owner read is not configured') };
  }
  let owner: ReadResult<SessionRef | null>;
  try {
    owner = await mailbox.deps.requestOwners.ownerOf(isolatedContext(owned), { requestRoot: message.requestRoot });
  } catch {
    return { ok: false, rejection: reject('unavailable', 'the request owner could not be read') };
  }
  if (owner.status === 'not_found') return { ok: true, allowed: false };
  if (owner.status !== 'ready') {
    return { ok: false, rejection: reject('unavailable', 'the request owner could not be read') };
  }
  if (owner.value === null) return { ok: true, allowed: false };
  return { ok: true, allowed: canonicalOf(owner.value) === canonicalOf(reader) };
}

export function ownsInbox(mailbox: MailboxContext, sessionRef: SessionRef, message: SessionMessage): boolean {
  const recipient = message.recipient;
  return !isUserRecipient(recipient)
    && recipient.projectId === sessionRef.projectId
    && recipient.sessionId === sessionRef.sessionId;
}

/**
 * The one single-message read right shared by `readMessage`, `readMessageBody`
 * and `readMessageView` (R7A1-09): a Host inside its workspace, a Work Run
 * through its own derived sender, or a secretary round through its resolved
 * Session; the per-message check is `canReadMessage`. `null` means allowed.
 */
async function messageReadRight(mailbox: MailboxContext, owned: Owned, message: SessionMessage,
  secretary: { round: SecretaryQueryRunV1; reader: SessionRef } | null): Promise<CoreRejection | null> {
  if (owned.principal.kind === 'host') return null;
  let reader: SessionRef;
  if (owned.principal.kind === 'query_run') {
    if (secretary === null) return reject('forbidden', 'the secretary read was not resolved');
    reader = secretary.reader;
  } else {
    const identity = await readWorkRunIdentity(mailbox, owned, owned.principal, owned.principal.runRef);
    if (!identity.ok) return identity.rejection;
    const derived = deriveWorkRunSender(mailbox, identity);
    if (!derived.ok) return derived.rejection;
    reader = derived.sender.sessionRef;
  }
  const right = await canReadMessage(mailbox, owned, reader, message);
  if (!right.ok) return right.rejection;
  return right.allowed ? null : reject('forbidden', 'this message is not addressed to or sent by the caller Session');
}

// ---- readMessage --------------------------------------------------------

export async function readMessage(mailbox: MailboxContext, ctx: CoreCallContext, ref: SessionMessageRef): Promise<ReadResult<SessionMessage>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  // A read has no receipt to miss: a `query_run` caller's round is resolved on
  // every read, before any record read.
  let secretary: { round: SecretaryQueryRunV1; reader: SessionRef } | null = null;
  if (owned.principal.kind === 'query_run') {
    const reading = await secretaryReader(mailbox, owned);
    if (!reading.ok) return reading.rejection;
    secretary = reading;
  }
  const normalized = normalizeMessageRef(ref);
  if (!normalized.ok) return reject('invalid', normalized.reason);
  const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
  if (scopeProblem !== null) return scopeProblem;
  const loaded = await loadMessage(mailbox, owned, normalized.ref);
  if (loaded.status !== 'ready') return loaded;
  const right = await messageReadRight(mailbox, owned, loaded.value, secretary);
  if (right !== null) return right;
  return loaded;
}

// ---- readMessageBody ----------------------------------------------------

export async function readMessageBody(mailbox: MailboxContext, ctx: CoreCallContext, input: { messageRef: SessionMessageRef; part: 'message' | 'response' }): Promise<ReadResult<import('../model/communication-contracts.js').MessageBody>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  let secretary: { round: SecretaryQueryRunV1; reader: SessionRef } | null = null;
  if (owned.principal.kind === 'query_run') {
    const reading = await secretaryReader(mailbox, owned);
    if (!reading.ok) return reading.rejection;
    secretary = reading;
  }
  let raw: Unknown;
  try {
    raw = structuredClone(input) as unknown as Unknown;
  } catch {
    return reject('invalid', 'readMessageBody input cannot be isolated from the caller');
  }
  if (!isObject(raw)) return reject('invalid', 'readMessageBody requires an input object');
  if (Object.keys(raw).some((key) => key !== 'messageRef' && key !== 'part')) {
    return reject('invalid', 'readMessageBody does not accept extra fields');
  }
  const part = raw['part'];
  if (part !== 'message' && part !== 'response') return reject('invalid', 'readMessageBody part must be message or response');
  const normalized = normalizeMessageRef(raw['messageRef']);
  if (!normalized.ok) return reject('invalid', normalized.reason);
  const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
  if (scopeProblem !== null) return scopeProblem;
  const loaded = await loadMessage(mailbox, owned, normalized.ref);
  if (loaded.status !== 'ready') return loaded;
  const message = loaded.value;
  const right = await messageReadRight(mailbox, owned, message, secretary);
  if (right !== null) return right;
  const bodyRef = part === 'message' ? message.bodyRef : message.response?.bodyRef;
  const sourceRef = part === 'message' ? message.sourceRef : message.response?.sourceRef;
  if (bodyRef === undefined || sourceRef === undefined) return { status: 'not_found' };
  if (canonicalOf(bodyRef.source) !== canonicalOf(sourceRef)) {
    return reject('unavailable', 'the message body ref source disagrees with the message source');
  }
  if (owned.signal.aborted) return reject('cancelled', 'the message body read was cancelled before the material read');
  let opened: ReadResult<import('../../../contracts/artifact.js').ArtifactRecord>;
  try {
    opened = await mailbox.deps.materials.openArtifact(internalHostContext(mailbox, owned), { ref: bodyRef, usage: 'historical_explanation' });
  } catch {
    return reject('unavailable', 'the message body could not be opened');
  }
  if (opened.status === 'not_found') return reject('unavailable', 'the message body is missing');
  if (opened.status !== 'ready') return mapReadResult(opened) as CoreRejection;
  // A forward copies the original body and bodyRef (§3.2.8 step 6), so the stored
  // message-part envelope names the original message; decode it against that record.
  let bodyMessage = message;
  while (part === 'message' && bodyMessage.originalRef !== null) {
    const original = await loadMessage(mailbox, owned, bodyMessage.originalRef);
    if (original.status !== 'ready') return original;
    bodyMessage = original.value;
  }
  const decoded = isUserDecisionAnswerPart(message, part)
    ? decodeStoredUserDecisionBody(message, part, opened.value)
    : decodeStoredMessageBody(bodyMessage, part, opened.value);
  if ('reason' in decoded) return reject('unavailable', decoded.reason);
  return {
    status: 'ready',
    value: { messageRef: message.ref, part, text: decoded.text, sourceRef, usage: 'message' },
  };
}

export async function readMessageView(mailbox: MailboxContext, ctx: CoreCallContext, ref: SessionMessageRef): Promise<ReadResult<SessionMessageReadV1>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  let secretary: { round: SecretaryQueryRunV1; reader: SessionRef } | null = null;
  if (owned.principal.kind === 'query_run') {
    const reading = await secretaryReader(mailbox, owned);
    if (!reading.ok) return reading.rejection;
    secretary = reading;
  }
  const normalized = normalizeMessageRef(ref);
  if (!normalized.ok) return reject('invalid', normalized.reason);
  const scopeProblem = scopeOfMessageRef(owned, normalized.ref);
  if (scopeProblem !== null) return scopeProblem;
  const loaded = await loadMessage(mailbox, owned, normalized.ref);
  if (loaded.status !== 'ready') return loaded;
  const right = await messageReadRight(mailbox, owned, loaded.value, secretary);
  if (right !== null) return right;
  const line = await recipientLineFacts(mailbox.deps, internalHostContext(mailbox, owned), loaded.value.recipient);
  if (!line.ok) return line.rejection;
  const block = await releaseBlockOf(mailbox, owned, loaded.value);
  if (block.status !== 'ready') return block;
  return { status: 'ready', value: { message: loaded.value, ...deriveMessageDelivery(loaded.value, line.value), releaseBlock: block.value } };
}
