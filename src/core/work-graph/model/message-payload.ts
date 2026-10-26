/**
 * The ONE send/respond payload model. These normalizers are the only
 * place the two tool argument shapes are decoded: the tool schemas, the
 * builders and any read-only lookup all share them, so the same arguments
 * produce byte-identical owner input and one fingerprint.
 *
 * Pure: no Goal, Run or Session read and no clock. `deadlineMs` is checked as a
 * finite number greater than 0; the `now + deadlineMs` overflow belongs to the
 * send/release deadline computation that has the injected clock.
 */
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { SessionMessageIntentV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { DispatchBasisV1, GoalRef } from '../../../contracts/ledger.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import { GoalRefShape, SessionMessageRefShape, SessionRefShape, TaskTripleShape } from '../../../contracts/data-format-refs.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { hasOnlyKeys, isNonNeg, isPos, isRecord } from '../../../contracts/validation/common.js';

export type SendMessageV1 = {
  recipient: SessionRef;
  text: string;
  intent: SessionMessageIntentV1 | null;
  needsReply: boolean;
  waitAfterSend: boolean;
  expected: DispatchBasisV1 | null;   // the same shape as DispatchBasisV1; planRevision may be null
  taskRef: TaskTriple | null;
  followupOf: SessionMessageRef | null;
  deadlineMs: number | null;          // inquiry only; a finite number > 0, overflow checked
  goalRef: GoalRef | null;
};
export type RespondBodyV1 = { text: string } | { reject: true; reason: string };
/** R7A1-14: flat, no nested `body`; the builder spreads the arm into the command's input. */
export type RespondMessageV1 = {
  messageRef: SessionMessageRef;
  /** The message CAS pin; it goes to `meta.expected` only, never into `input`. */
  expectedRevision: number;
} & RespondBodyV1;

const SEND_KEYS = [
  'recipient', 'text', 'intent', 'needsReply', 'waitAfterSend',
  'expected', 'taskRef', 'followupOf', 'deadlineMs', 'goalRef',
] as const;
const RESPOND_KEYS = ['messageRef', 'expectedRevision', 'text', 'reject', 'reason'] as const;

function invalid<T>(reason: string): ReadResult<T> {
  return rejected('invalid', reason);
}

function unknownKey(raw: Record<string, unknown>, allowed: readonly string[]): string | null {
  return Object.keys(raw).find((key) => !allowed.includes(key)) ?? null;
}

/** `undefined` and `null` both mean "not supplied"; any other value must match the ONE ref shape. */
function optionalRef<T>(
  raw: Record<string, unknown>, key: string, shape: Parameters<typeof checkShape>[0], label: string,
): { ok: true; value: T | null } | { ok: false; rejection: CoreRejection } {
  const value = raw[key];
  if (value === undefined || value === null) return { ok: true, value: null };
  const problem = checkShape(shape, value, 'stored');
  if (problem !== null) return { ok: false, rejection: rejected('invalid', `${label}: ${problem}`) };
  return { ok: true, value: value as T };
}

/**
 * `DispatchBasisV1` has `number | 'none'`, which no single field-table kind describes. The one check of a
 * non-null basis: the message codec's pins check calls it too.
 */
export function dispatchBasisProblem(value: unknown): string | null {
  if (!isRecord(value) || Object.keys(value).length !== 3
    || !hasOnlyKeys(value, ['planRevision', 'pointerRevision', 'dispatchSequence'])) {
    return 'must carry exactly planRevision, pointerRevision and dispatchSequence';
  }
  const planRevision = value['planRevision'];
  if (!(planRevision === null || isNonNeg(planRevision))) {
    return 'planRevision must be null or a non-negative integer';
  }
  const pointerRevision = value['pointerRevision'];
  if (!(pointerRevision === 'none' || isNonNeg(pointerRevision))) {
    return "pointerRevision must be 'none' or a non-negative integer";
  }
  if (!isNonNeg(value['dispatchSequence'])) return 'dispatchSequence must be a non-negative integer';
  return null;
}

export function normalizeSendMessageInput(raw: unknown): ReadResult<SendMessageV1> {
  if (!isRecord(raw)) return invalid('send input must be an object');
  const unknown = unknownKey(raw, SEND_KEYS);
  if (unknown !== null) return invalid(`send input carries an unknown field: ${unknown}`);

  const recipientProblem = checkShape(SessionRefShape, raw['recipient'], 'stored');
  if (recipientProblem !== null) return invalid(`send recipient: ${recipientProblem}`);
  const text = raw['text'];
  if (typeof text !== 'string' || text.length === 0) return invalid('send text must be a non-empty string');

  const intent = raw['intent'];
  if (intent !== undefined && intent !== null
    && intent !== 'notify' && intent !== 'inquiry' && intent !== 'action_request' && intent !== 'decision_request') {
    return invalid('send intent must be notify, inquiry, action_request or decision_request');
  }
  const explicitNeedsReply = raw['needsReply'];
  if (explicitNeedsReply !== undefined && typeof explicitNeedsReply !== 'boolean') {
    return invalid('send needsReply must be a boolean');
  }
  const explicitWaitAfterSend = raw['waitAfterSend'];
  if (explicitWaitAfterSend !== undefined && typeof explicitWaitAfterSend !== 'boolean') {
    return invalid('send waitAfterSend must be a boolean');
  }
  // The mailbox owner's current defaults: a fire-and-forget send waits for
  // nothing, and an omitted needsReply is supplied only by an explicit wait.
  const waitAfterSend = explicitWaitAfterSend === true;
  const needsReply = explicitNeedsReply === true || (explicitNeedsReply === undefined && waitAfterSend);

  let expected: DispatchBasisV1 | null = null;
  const expectedRaw = raw['expected'];
  if (expectedRaw !== undefined && expectedRaw !== null) {
    const problem = dispatchBasisProblem(expectedRaw);
    if (problem !== null) return invalid(`send expected: ${problem}`);
    expected = expectedRaw as DispatchBasisV1;
  }
  const taskRef = optionalRef<TaskTriple>(raw, 'taskRef', TaskTripleShape, 'send taskRef');
  if (!taskRef.ok) return taskRef.rejection;
  const followupOf = optionalRef<SessionMessageRef>(raw, 'followupOf', SessionMessageRefShape, 'send followupOf');
  if (!followupOf.ok) return followupOf.rejection;
  const goalRef = optionalRef<GoalRef>(raw, 'goalRef', GoalRefShape, 'send goalRef');
  if (!goalRef.ok) return goalRef.rejection;

  const deadlineMs = raw['deadlineMs'];
  if (deadlineMs !== undefined && deadlineMs !== null
    && (typeof deadlineMs !== 'number' || !Number.isFinite(deadlineMs) || deadlineMs <= 0)) {
    return invalid('send deadlineMs must be a finite number greater than 0');
  }

  return {
    status: 'ready',
    value: {
      recipient: raw['recipient'] as SessionRef,
      text,
      intent: (intent ?? null) as SessionMessageIntentV1 | null,
      needsReply,
      waitAfterSend,
      expected,
      taskRef: taskRef.value,
      followupOf: followupOf.value,
      deadlineMs: (deadlineMs ?? null) as number | null,
      goalRef: goalRef.value,
    },
  };
}

export function normalizeRespondMessageInput(raw: unknown): ReadResult<RespondMessageV1> {
  if (!isRecord(raw)) return invalid('respond input must be an object');
  const unknown = unknownKey(raw, RESPOND_KEYS);
  if (unknown !== null) return invalid(`respond input carries an unknown field: ${unknown}`);

  const messageRefProblem = checkShape(SessionMessageRefShape, raw['messageRef'], 'stored');
  if (messageRefProblem !== null) return invalid(`respond messageRef: ${messageRefProblem}`);
  const expectedRevision = raw['expectedRevision'];
  // The tree's version convention: a CAS revision is a positive safe integer
  // (`expectedRevision: z.number().int().min(1)` in the tool schemas).
  if (!isPos(expectedRevision)) return invalid('respond expectedRevision must be a positive integer');

  const hasText = raw['text'] !== undefined;
  const hasReject = raw['reject'] !== undefined;
  const hasReason = raw['reason'] !== undefined;
  if (hasText && (hasReject || hasReason)) return invalid('respond input must carry exactly one of text or reject');
  if (!hasText && !hasReject) return invalid('respond input must carry exactly one of text or reject');
  if (hasText) {
    const text = raw['text'];
    if (typeof text !== 'string' || text.length === 0) return invalid('respond text must be a non-empty string');
    return {
      status: 'ready',
      value: { messageRef: raw['messageRef'] as SessionMessageRef, expectedRevision, text },
    };
  }
  if (raw['reject'] !== true) return invalid('respond reject must be true');
  const reason = raw['reason'];
  if (typeof reason !== 'string' || reason.length === 0) return invalid('respond reject requires a non-empty reason');
  return {
    status: 'ready',
    value: { messageRef: raw['messageRef'] as SessionMessageRef, expectedRevision, reject: true, reason },
  };
}
