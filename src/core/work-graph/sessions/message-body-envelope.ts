/**
 * The stored body of one SessionMessage part.
 *
 * The mailbox stores each part's text as an envelope
 * `{schemaVersion:1, projectId, workspaceId, messageId, part, sender, text}`
 * (`mailbox-service.ts` `storeMessageBody`). Every reader of a saved body (the
 * mailbox's `readMessageBody`, the continuation basis reader's reply text)
 * decodes it here, so the rules for the stored body live in one place. This
 * file performs no I/O.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { SourceRefV1 } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import { SESSION_MESSAGE_CONTENT_TYPE, SESSION_MESSAGE_MAX_TEXT_BYTES } from './message-record-codecs.js';

/** The two parts of a message that each have a stored body. */
export type MessageBodyPart = 'message' | 'response';

/** A stored body as the material reader and the raw body store both return it. */
export type StoredMessageBody = { ref: ArtifactRef; body: string; sourceRefs: readonly SourceRefV1[] };

function canonicalOf(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}

/**
 * The text of one part of `message` from its stored body, or the reason it
 * cannot be given: the message's body ref and source, the stored ref
 * (contentType, digest, size, source) and provenance, then the envelope (it
 * names this message, this part and the part's sender) and its text (non-empty,
 * at most `SESSION_MESSAGE_MAX_TEXT_BYTES`).
 */
export function decodeStoredMessageBody(
  message: SessionMessage, part: MessageBodyPart, stored: StoredMessageBody,
): { text: string } | { reason: string } {
  const bodyRef = part === 'message' ? message.bodyRef : message.response?.bodyRef;
  const sourceRef = part === 'message' ? message.sourceRef : message.response?.sourceRef;
  if (bodyRef === undefined || sourceRef === undefined) return { reason: `the message has no saved ${part} body` };
  if (canonicalOf(bodyRef.source) !== canonicalOf(sourceRef)) {
    return { reason: 'the message body ref source disagrees with the message source' };
  }
  if (stored.ref.contentType !== SESSION_MESSAGE_CONTENT_TYPE
    || stored.ref.digest !== bodyRef.digest || stored.ref.sizeBytes !== bodyRef.sizeBytes
    || canonicalOf(stored.ref.source) !== canonicalOf(sourceRef)) {
    return { reason: 'the stored message body ref disagrees with the message record' };
  }
  if (!stored.sourceRefs.some((candidate) => canonicalOf(candidate) === canonicalOf(sourceRef))) {
    return { reason: 'the stored message body source disagrees with the message record' };
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(stored.body);
  } catch {
    return { reason: 'the stored message body is not parseable JSON' };
  }
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    return { reason: 'the stored message body is not an object' };
  }
  const fields = envelope as Record<string, unknown>;
  const expectedSender = part === 'message' ? message.sender : message.response?.sender;
  if (fields['schemaVersion'] !== 1
    || fields['projectId'] !== message.ref.projectId
    || fields['workspaceId'] !== message.ref.workspaceId
    || fields['messageId'] !== message.ref.messageId
    || fields['part'] !== part
    || canonicalOf(fields['sender']) !== canonicalOf(expectedSender)) {
    return { reason: 'the stored message body envelope disagrees with the message record' };
  }
  const text = fields['text'];
  if (typeof text !== 'string' || text.length === 0 || Buffer.byteLength(text, 'utf8') > SESSION_MESSAGE_MAX_TEXT_BYTES) {
    return { reason: 'the stored message body text is invalid' };
  }
  return { text };
}
