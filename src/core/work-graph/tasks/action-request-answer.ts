/**
 * The `action_release` answer's facts and its R2 command fields.
 *
 * `tasks/` may not import `communication/`, so the one copy lives here: the trusted card-answer path in
 * `business/workflow/decision-actions.ts` and this folder's unapplied-answer reader both import it. The answer is a
 * saved synthetic user message whose `response.decision` names the card's `action_release` source and selection.
 */
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { ActionRequestRef } from '../../../contracts/action-request.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import type { DecisionChangeProofV1, DecisionSelectionV1 } from '../../../contracts/goal-decisions.js';
import { ACTION_RELEASE_OPTIONS } from '../../../contracts/goal-decisions.js';
import { ActionRequestRefShape } from '../../../contracts/data-format-refs.js';
import { canonicalJson, canonicalOf, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import { nestedSourceObject, parseDecisionSourceKey } from './decision-source-identity.js';

/** An answer's selection as a release decision: approve → true, deny → false, any other selection → null. */
function actionRequestAllowOf(selection: DecisionSelectionV1): boolean | null {
  if (selection.kind !== 'option') return null;
  if (selection.optionId === ACTION_RELEASE_OPTIONS.approve) return true;
  if (selection.optionId === ACTION_RELEASE_OPTIONS.deny) return false;
  return null;
}

/** The answer derivation: the target comes only from the captured source key; a malformed stored key is
 * tamper-only and returns `null`. */
export type ActionRequestAnswerFactsV1 = {
  answerRef: SessionMessageRef;
  requestRef: ActionRequestRef;
  /** The request revision captured on the card's source pins, the answer's CAS revision. */
  revision: number;
  allow: boolean;
  /** The formal answer's Host actor, exactly as the configured operator wrote it. */
  actor: { kind: 'human' | 'system'; id: string };
  capturedPins: VersionPin[];
};

export function actionRequestAnswerFacts(answer: SessionMessage): ActionRequestAnswerFactsV1 | null {
  const response = answer.response;
  if (response === null || !('decision' in response)) return null;
  const actor = response.sender.actor;
  const { source, selection } = response.decision;
  const allow = actionRequestAllowOf(selection);
  if (allow === null || source['kind'] !== 'action_release') return null;
  const parsed = parseDecisionSourceKey(source);
  if (parsed === null || parsed.kind !== 'action_release') return null;
  const requestRef = nestedSourceObject(parsed.body, 'requestRef');
  if (requestRef === null || checkShape(ActionRequestRefShape, requestRef, 'stored') !== null) return null;
  const ref = requestRef as unknown as ActionRequestRef;
  const refKey = canonicalOf(ref);
  const pin = refKey === null ? undefined : source.pins.find((candidate) => canonicalOf(candidate.ref) === refKey);
  if (pin === undefined) return null;
  return {
    answerRef: answer.ref,
    requestRef: ref,
    revision: pin.revision,
    allow,
    actor: { kind: actor.kind, id: actor.id },
    capturedPins: source.pins,
  };
}

/** The R2 command fields of one answer's application: the same operation, identity and fingerprint the action
 * owner uses for `approve`/`deny` (`tasks/action-requests.ts:answerRequest`). The unapplied-answer reader decodes the
 * answer once and passes these to `commandKeys`. */
export function actionRequestAnswerCommandOf(facts: ActionRequestAnswerFactsV1): {
  operation: 'action_request.approve' | 'action_request.deny';
  scope: { projectId: string; workspaceId: string };
  principal: JsonValue;
  commandId: string;
  fingerprintInput: JsonValue;
} {
  return {
    operation: facts.allow ? 'action_request.approve' : 'action_request.deny',
    scope: { projectId: facts.answerRef.projectId, workspaceId: facts.answerRef.workspaceId },
    principal: principalIdentity({ kind: 'host', actor: { kind: facts.actor.kind, id: facts.actor.id } }),
    commandId: actionAnswerCommandId(facts.answerRef),
    fingerprintInput: actionRequestAnswerFingerprint(facts),
  };
}

/** The answer-derived command id: one answer, one attempt; a retry replays the original receipt. */
export function actionAnswerCommandId(answerRef: SessionMessageRef): string {
  return 'answer:' + sha256Hex(canonicalJson(answerRef as unknown as JsonValue));
}

/** The command fingerprint the action owner derives for the same answer. */
export function actionRequestAnswerFingerprint(
  facts: Pick<ActionRequestAnswerFactsV1, 'requestRef' | 'revision' | 'answerRef'>,
): JsonValue {
  return {
    request: facts.requestRef, revision: facts.revision, answerRef: facts.answerRef,
  } as unknown as JsonValue;
}

/**
 * The ONE decision-change proof of an answered `action_release` card, built when the answer is applied
 * (`book 7a:436–:444`): the acknowledgement is the saved answer, the captured pins are the card's source/object
 * versions, and the changes are the request and its hold record at their before/after versions. The shape is
 * `DecisionChangeProofV1`; there is no second proof shape.
 */
export function actionReleaseChangeProof(input: {
  answerRef: SessionMessageRef;
  capturedPins: VersionPin[];
  changes: { before: VersionPin; after: VersionPin }[];
}): DecisionChangeProofV1 {
  return {
    acknowledgementRef: input.answerRef,
    capturedPins: input.capturedPins,
    changes: input.changes,
    basisRebases: [],
  };
}
