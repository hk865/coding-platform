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
import type { DecisionHostSenderV1 } from '../../../contracts/core/session-message.js';
import type { SourceRefV1 } from '../../../contracts/dispatch.js';
import { canonicalJson, canonicalOf, type JsonValue } from '../../../contracts/fingerprint.js';
import type { UserDecisionBodyV1 } from '../../../contracts/goal-decisions.js';
import { hasOnlyKeys, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import { SESSION_MESSAGE_CONTENT_TYPE, SESSION_MESSAGE_MAX_TEXT_BYTES, type Problem } from './message-record-codecs.js';

/** The two parts of a message that each have a stored body. */
export type MessageBodyPart = 'message' | 'response';

/** A stored body as the material reader and the raw body store both return it. */
export type StoredMessageBody = { ref: ArtifactRef; body: string; sourceRefs: readonly SourceRefV1[] };

/**
 * Slice 5 user-answer body variant (SPEC §2.3 lines 235-245). The envelope is
 * the SAME shape as every other stored body, but `text` is the canonical JSON of
 * `UserDecisionBodyV1` instead of free text: the response part of a user
 * decision answer stores this payload, and the synthetic answer message part
 * stores the SAME payload. Old role bodies stay plain text and are never
 * JSON-decoded.
 */
export type UserDecisionBodyEnvelopeV1 = {
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  messageId: string;
  part: MessageBodyPart;
  sender: DecisionHostSenderV1;
  text: string;
};

/** The canonical stored payload of one user decision answer. */
export function encodeUserDecisionBody(body: UserDecisionBodyV1): string {
  return canonicalJson(body as unknown as JsonValue);
}

const DECISION_ANNOTATION_MAX_BYTES = 2048;
const DECISION_ANNOTATIONS_MAX = 32;
const DECISION_ANNOTATIONS_TOTAL_MAX_BYTES = 16 * 1024;

function decisionAnnotationProblem(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['objectKey', 'text'])) {
    return 'a decision annotation must carry exactly objectKey and text';
  }
  if (!nonEmpty(value['objectKey'])) return 'a decision annotation requires objectKey';
  if (typeof value['text'] !== 'string') return 'a decision annotation text must be a string';
  return Buffer.byteLength(value['text'], 'utf8') > DECISION_ANNOTATION_MAX_BYTES
    ? `a decision annotation exceeds ${String(DECISION_ANNOTATION_MAX_BYTES)} bytes` : null;
}

function decisionGoalRefProblem(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId'])) {
    return 'a decision selection Goal must be a GoalRef';
  }
  return value['aggregateType'] === 'Goal' && nonEmpty(value['projectId']) && nonEmpty(value['goalId'])
    ? null : 'a decision selection Goal is not a valid GoalRef';
}

function decisionSelectionProblem(value: unknown): Problem {
  if (!isRecord(value)) return 'a decision selection must be an object';
  switch (value['kind']) {
    case 'option':
      return hasOnlyKeys(value, ['kind', 'optionId']) && nonEmpty(value['optionId'])
        ? null : 'an option decision selection requires optionId';
    case 'other':
      return hasOnlyKeys(value, ['kind']) ? null : 'an other decision selection carries unknown fields';
    case 'conflict_wait':
    case 'conflict_parallel': {
      if (!hasOnlyKeys(value, ['kind', 'earlier', 'later'])) return 'a conflict decision selection carries unknown fields';
      const earlier = decisionGoalRefProblem(value['earlier']);
      if (earlier !== null) return earlier;
      return decisionGoalRefProblem(value['later']);
    }
    case 'conflict_order': {
      if (!hasOnlyKeys(value, ['kind', 'goalOrder'])) return 'a conflict order selection carries unknown fields';
      const order = value['goalOrder'];
      if (!Array.isArray(order)) return 'a conflict order selection goalOrder must be an array';
      for (const goal of order) {
        const problem = decisionGoalRefProblem(goal);
        if (problem !== null) return problem;
      }
      return null;
    }
    default:
      return 'a decision selection kind is not recognized';
  }
}

/** Strict `UserDecisionBodyV1` payload check; `null` when it passes. */
export function checkUserDecisionBody(value: unknown): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['schemaVersion', 'kind', 'selection', 'text', 'annotations'])) {
    return 'a user decision body must carry exactly schemaVersion, kind, selection, text and annotations';
  }
  if (value['schemaVersion'] !== 1) return 'a user decision body schemaVersion must be 1';
  if (value['kind'] !== 'user_decision_response') return "a user decision body kind must be 'user_decision_response'";
  const selection = decisionSelectionProblem(value['selection']);
  if (selection !== null) return selection;
  if (typeof value['text'] !== 'string') return 'a user decision body text must be a string';
  const annotations = value['annotations'];
  if (!Array.isArray(annotations)) return 'a user decision body annotations must be an array';
  if (annotations.length > DECISION_ANNOTATIONS_MAX) {
    return `a user decision body carries more than ${String(DECISION_ANNOTATIONS_MAX)} annotations`;
  }
  let totalBytes = 0;
  for (const annotation of annotations) {
    const problem = decisionAnnotationProblem(annotation);
    if (problem !== null) return problem;
    totalBytes += Buffer.byteLength((annotation as Record<string, unknown>)['text'] as string, 'utf8');
  }
  return totalBytes > DECISION_ANNOTATIONS_TOTAL_MAX_BYTES ? 'a user decision body annotations exceed 16 KiB' : null;
}

/**
 * True when this message part uses the user-answer body variant, decided from
 * the formal `message.decision`/`response` facts (SPEC §2.3). Old Session
 * message parts are never treated as user answers.
 */
export function isUserDecisionAnswerPart(message: SessionMessage, part: MessageBodyPart): boolean {
  if (part === 'response') {
    const response: unknown = message.response;
    return isRecord(response) && 'decision' in response;
  }
  // Only a synthetic answer stores the SAME payload in its own `message` part.
  return message.decision?.syntheticAnswer === true;
}

/**
 * Strictly decodes one user-answer body part: the stored envelope plus the
 * canonical `UserDecisionBodyV1` payload. Returns the ORIGINAL free text and the
 * parsed body; the selection and annotations must deep-equal the formal response
 * metadata, a malformed part is `{reason}` and is read as unavailable.
 */
export function decodeStoredUserDecisionBody(
  message: SessionMessage, part: MessageBodyPart, stored: StoredMessageBody,
): { text: string; body: UserDecisionBodyV1 } | { reason: string } {
  const response: unknown = message.response;
  if (!isRecord(response) || !isRecord(response['decision'])) {
    return { reason: `the message has no formal user decision answer for its ${part} body` };
  }
  const envelope = decodeStoredMessageBody(message, part, stored);
  if ('reason' in envelope) return envelope;
  let payload: unknown;
  try {
    payload = JSON.parse(envelope.text);
  } catch {
    return { reason: 'the stored user decision body is not parseable JSON' };
  }
  const problem = checkUserDecisionBody(payload);
  if (problem !== null) return { reason: problem };
  const body = payload as UserDecisionBodyV1;
  const formal = response['decision'] as Record<string, unknown>;
  if (canonicalOf(body.selection) === null || canonicalOf(body.selection) !== canonicalOf(formal['selection'])) {
    return { reason: 'the stored user decision body selection disagrees with the formal response' };
  }
  if (canonicalOf(body.annotations) !== canonicalOf(formal['annotations'])) {
    return { reason: 'the stored user decision body annotations disagree with the formal response' };
  }
  return { text: body.text, body };
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
