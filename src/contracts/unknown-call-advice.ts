/**
 * K3 layering (HANDOFF 121-109): the adviser's answer to one `awaiting_advice`
 * phase of an `UnknownCallReview`. The adviser's submit tool fills the form;
 * the platform writes the versioned text, with the frozen packet facts it was
 * given (`subject`), and every reader parses it here (the `exec-review.ts`
 * pattern). The disposition phase picks one of four (rerun as is, safer method,
 * skip, escalate to the person), the approval phase one of three (approve,
 * decline, escalate); there is no `handle_myself`, the adviser never pauses a
 * Task for the person. Every answer carries a rationale and one plain sentence
 * for the person; an escalation also names its kind.
 */
import type { GoalDecisionBasisV1 } from './goal-decisions.js';
import { canonicalJson, sha256Hex, type JsonValue } from './fingerprint.js';
import { rejected } from './core/rejections.js';
import type { CoreRejection } from './core/results.js';
import { MAX_ANSWER_BYTES } from './query-job.js';
import type { UnknownCallReviewRef } from './unknown-call-review.js';
import { hasOnlyKeys, isPos, isRecord, nonEmpty, parseObject, utf8Bytes } from './validation/common.js';

export type UnknownCallAdvicePhaseV1 = 'disposition' | 'approval';
/** 需求、产品取舍、架构. */
export type UnknownCallAdviceEscalationKindV1 = 'requirement' | 'product_tradeoff' | 'architecture';
export type UnknownCallAdviceDispositionChoiceV1 = 'rerun_as_is' | 'safer_method' | 'skip_as_done' | 'escalate';
export type UnknownCallAdviceApprovalChoiceV1 = 'approve' | 'decline' | 'escalate';

/** The answer as the record keeps it (a suggestion on the card, or the applied answer). */
export type UnknownCallAdviceV1 = {
  phase: UnknownCallAdvicePhaseV1;
  choice: UnknownCallAdviceDispositionChoiceV1 | UnknownCallAdviceApprovalChoiceV1;
  /** Present exactly when `choice` is `escalate`. */
  escalationKind: UnknownCallAdviceEscalationKindV1 | null;
  /** 1..2000 UTF-16 units; written into the disposition's 附言 when applied. */
  rationale: string;
  /** 1..200 UTF-16 units, one line: the sentence the person reads. */
  plain: string;
};

/** The frozen packet facts the platform writes beside the form; never model text. */
export type UnknownCallAdviceSubjectV1 = {
  reviewRef: UnknownCallReviewRef;
  revision: number;
  phase: UnknownCallAdvicePhaseV1;
  /** `unknownCallAdviceGoalBasisDigest` of the Goal content the packet was built from (T02). */
  goalBasisDigest: string;
};

export type ParsedUnknownCallAdviceAnswerV1 = {
  status: 'parsed'; subject: UnknownCallAdviceSubjectV1; advice: UnknownCallAdviceV1;
};

export const UNKNOWN_CALL_ADVICE_CHOICES: Readonly<Record<UnknownCallAdvicePhaseV1, readonly string[]>> = {
  disposition: ['rerun_as_is', 'safer_method', 'skip_as_done', 'escalate'],
  approval: ['approve', 'decline', 'escalate'],
};
export const UNKNOWN_CALL_ADVICE_ESCALATION_KINDS = ['requirement', 'product_tradeoff', 'architecture'] as const;
const ADVICE_KEYS = ['phase', 'choice', 'escalationKind', 'rationale', 'plain'] as const;
const ANSWER_KEYS = ['schemaVersion', 'kind', 'reviewRef', 'revision', 'phase', 'goalBasisDigest',
  'choice', 'escalationKind', 'rationale', 'plain'] as const;
const RATIONALE_MAX_UNITS = 2_000;
const PLAIN_MAX_UNITS = 200;

/** T02: the digest of one Goal content basis, the same on the packet side and the owner side. */
export function unknownCallAdviceGoalBasisDigest(basis: GoalDecisionBasisV1): string {
  return sha256Hex(canonicalJson(basis as unknown as JsonValue));
}

/** The ONE shape check of a stored or submitted advice (codec, parse and `escalateReview` share it). */
export function unknownCallAdviceProblem(value: unknown): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ADVICE_KEYS)) return 'the advice must be { phase, choice, escalationKind, rationale, plain }';
  const phase = value['phase'];
  if (phase !== 'disposition' && phase !== 'approval') return 'the advice phase is not disposition or approval';
  if (!UNKNOWN_CALL_ADVICE_CHOICES[phase].includes(value['choice'] as string)) {
    return `the advice choice is not one of the ${phase} choices`;
  }
  return adviceDetailsProblem(value);
}

/** The escalation kind, rationale and plain sentence every adviser answer carries (both advice contracts share it). */
export function adviceDetailsProblem(value: Record<string, unknown>): string | null {
  const kind = value['escalationKind'];
  if (value['choice'] === 'escalate'
    ? !(UNKNOWN_CALL_ADVICE_ESCALATION_KINDS as readonly string[]).includes(kind as string) : kind !== null) {
    return 'the advice escalationKind is required exactly when the choice is escalate';
  }
  const rationale = value['rationale'];
  if (!nonEmpty(rationale) || rationale.length > RATIONALE_MAX_UNITS) return 'the advice rationale must be 1..2000 characters';
  const plain = value['plain'];
  if (!nonEmpty(plain) || plain.length > PLAIN_MAX_UNITS || /[\r\n]/.test(plain)) {
    return 'the advice plain sentence must be one line of 1..200 characters';
  }
  return null;
}

/**
 * The ONE shape check of the frozen subject the platform writes beside the form
 * (the request's second line and the answer's fixed members): exactly the four
 * members, the complete review ref, a positive revision, a known phase and a
 * non-empty Goal basis digest.
 */
export function unknownCallAdviceSubjectProblem(value: unknown): string | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['reviewRef', 'revision', 'phase', 'goalBasisDigest'])) {
    return 'the advice subject is not { reviewRef, revision, phase, goalBasisDigest }';
  }
  const ref = value['reviewRef'];
  if (!isRecord(ref) || !hasOnlyKeys(ref, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || ref['aggregateType'] !== 'UnknownCallReview'
    || !nonEmpty(ref['projectId']) || !nonEmpty(ref['goalId']) || !nonEmpty(ref['runId'])) {
    return 'the advice answer names no complete review ref';
  }
  if (!isPos(value['revision'])) return 'the advice answer revision is not a positive integer';
  const phase = value['phase'];
  if (typeof phase !== 'string' || !Object.keys(UNKNOWN_CALL_ADVICE_CHOICES).includes(phase)) {
    return 'the advice subject phase is not disposition or approval';
  }
  if (!nonEmpty(value['goalBasisDigest'])) return 'the advice answer has no Goal basis digest';
  return null;
}

/** The stored answer text: the platform's fixed members and frozen subject first, then the form. */
export function unknownCallAdviceAnswerText(subject: UnknownCallAdviceSubjectV1, advice: UnknownCallAdviceV1): string {
  return JSON.stringify({
    schemaVersion: 1, kind: 'unknown_call_advice',
    reviewRef: { aggregateType: 'UnknownCallReview', projectId: subject.reviewRef.projectId,
      goalId: subject.reviewRef.goalId, runId: subject.reviewRef.runId },
    revision: subject.revision, phase: subject.phase, goalBasisDigest: subject.goalBasisDigest,
    choice: advice.choice, escalationKind: advice.escalationKind, rationale: advice.rationale, plain: advice.plain,
  });
}

/**
 * The strict parse: the whole text is exactly one answer object (no prose, no
 * code fence), within 16 KiB, with exactly the members above; nothing is trimmed.
 */
export function parseUnknownCallAdviceAnswer(text: string): ParsedUnknownCallAdviceAnswerV1 | CoreRejection {
  if (utf8Bytes(text) > MAX_ANSWER_BYTES) return rejected('invalid', 'the advice answer is over 16 KiB');
  const parsed = parseObject(text);
  if (parsed === null) return rejected('invalid', 'the advice answer is not one JSON object');
  if (!hasOnlyKeys(parsed, ANSWER_KEYS)) return rejected('invalid', 'the advice answer has an unknown member');
  if (parsed['schemaVersion'] !== 1 || parsed['kind'] !== 'unknown_call_advice') {
    return rejected('invalid', 'the advice answer is not unknown_call_advice v1');
  }
  const ref = parsed['reviewRef'];
  const subjectProblem = unknownCallAdviceSubjectProblem({
    reviewRef: parsed['reviewRef'], revision: parsed['revision'],
    phase: parsed['phase'], goalBasisDigest: parsed['goalBasisDigest'],
  });
  if (subjectProblem !== null) return rejected('invalid', subjectProblem);
  const revision = parsed['revision'] as number;
  const goalBasisDigest = parsed['goalBasisDigest'] as string;
  const advice = { phase: parsed['phase'], choice: parsed['choice'], escalationKind: parsed['escalationKind'],
    rationale: parsed['rationale'], plain: parsed['plain'] };
  const problem = unknownCallAdviceProblem(advice);
  if (problem !== null) return rejected('invalid', problem);
  const value = advice as UnknownCallAdviceV1;
  return {
    status: 'parsed',
    subject: { reviewRef: ref as unknown as UnknownCallReviewRef, revision, phase: value.phase,
      goalBasisDigest },
    advice: value,
  };
}
