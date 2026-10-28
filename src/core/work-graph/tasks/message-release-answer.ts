/**
 * The `message_release` answer's facts, its option parsing and its R2 command fields (`book :436–:443`).
 *
 * `tasks/` may not import `communication/`, so the one copy lives here: the trusted application entry in
 * `communication/decision-change-proof.ts` and this folder's unapplied-answer reader both import it.
 */
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import type { DecisionSelectionV1 } from '../../../contracts/goal-decisions.js';
import { MESSAGE_RELEASE_OPTIONS } from '../../../contracts/goal-decisions.js';
import { SessionMessageRefShape } from '../../../contracts/data-format-refs.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import { nestedSourceObject, parseDecisionSourceKey } from './decision-source-identity.js';

/** An answer's selection as a release decision: approve → true, deny → false, any other selection → null. */
export function messageReleaseAllowOf(selection: DecisionSelectionV1): boolean | null {
  if (selection.kind !== 'option') return null;
  if (selection.optionId === MESSAGE_RELEASE_OPTIONS.approve) return true;
  if (selection.optionId === MESSAGE_RELEASE_OPTIONS.deny) return false;
  return null;
}

/** G-early's ONE answer derivation, now exported from its own home (`decision-change-proof.ts:88–:107` moved here):
 * the target comes only from the captured source key; a malformed stored key is tamper-only and returns `null`. */
export type MessageReleaseAnswerFactsV1 = {
  answerRef: SessionMessageRef;
  messageRef: SessionMessageRef;
  allow: boolean;
  actor: { kind: 'human'; id: string };
  capturedPins: VersionPin[];
};

export function messageReleaseAnswerFacts(answer: SessionMessage): MessageReleaseAnswerFactsV1 | null {
  const response = answer.response;
  if (response === null || !('decision' in response)) return null;
  const actor = response.sender.actor;
  if (actor.kind !== 'human') return null;
  const { source, selection } = response.decision;
  const allow = messageReleaseAllowOf(selection);
  if (allow === null || source['kind'] !== 'message_release') return null;
  const parsed = parseDecisionSourceKey(source);
  if (parsed === null || parsed.kind !== 'message_release') return null;
  const messageRef = nestedSourceObject(parsed.body, 'messageRef');
  if (messageRef === null || checkShape(SessionMessageRefShape, messageRef, 'stored') !== null) return null;
  return {
    answerRef: answer.ref,
    messageRef: messageRef as unknown as SessionMessageRef,
    allow,
    actor: { kind: 'human', id: actor.id },
    capturedPins: source.pins,
  };
}

/** The R2 command fields of one answer's application. The entry spreads them into its `WriteCommand`; the
 * unapplied-answer branch passes them to `commandKeys` (`command-executor.ts:43–:55`). `null` when the answer is not a
 * person's `message_release` answer. */
export function messageReleaseAnswerCommand(answer: SessionMessage): {
  operation: 'message.release';
  scope: { projectId: string; workspaceId: string };
  principal: JsonValue;
  commandId: string;
  fingerprintInput: JsonValue;
} | null {
  const facts = messageReleaseAnswerFacts(answer);
  if (facts === null) return null;
  return {
    operation: 'message.release',
    scope: { projectId: facts.answerRef.projectId, workspaceId: facts.answerRef.workspaceId },
    principal: principalIdentity({ kind: 'host', actor: { kind: 'human', id: facts.actor.id } }),
    commandId: 'answer:' + sha256Hex(canonicalJson(facts.answerRef as unknown as JsonValue)),
    fingerprintInput: {
      answerRef: facts.answerRef, messageRef: facts.messageRef, allow: facts.allow,
    } as unknown as JsonValue,
  };
}
