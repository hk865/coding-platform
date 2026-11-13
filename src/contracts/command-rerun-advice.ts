/**
 * 121-110: the adviser's answer to one `awaiting_advice` `CommandRerunRequest` (a blocked command the executor asks
 * to run again). The adviser's submit tool fills the form; the platform writes the versioned text with the frozen
 * round facts it was given (`subject`), and every reader parses it here (the `unknown-call-advice.ts` pattern).
 * Three choices: allow one rerun, deny it for this Run, or escalate to the person. There is no `deny_final`: only the
 * person stops an alias for good. Every answer carries a rationale and one plain sentence for the person; an
 * escalation also names its kind.
 */
import type { CommandRerunRequestRef } from './command-rerun-request.js';
import { rejected } from './core/rejections.js';
import type { CoreRejection } from './core/results.js';
import { MAX_ANSWER_BYTES } from './query-job.js';
import { adviceDetailsProblem, type UnknownCallAdviceEscalationKindV1 } from './unknown-call-advice.js';
import type { UnknownCallReviewRef } from './unknown-call-review.js';
import { hasOnlyKeys, isPos, isRecord, nonEmpty, parseObject, utf8Bytes } from './validation/common.js';

export const COMMAND_RERUN_ADVICE_CHOICES = ['allow_rerun', 'deny', 'escalate'] as const;
export type CommandRerunAdviceChoiceV1 = typeof COMMAND_RERUN_ADVICE_CHOICES[number];

/** The answer as the request keeps it (the applied answer, or the suggestion on the person's card). */
export type CommandRerunAdviceV1 = {
  choice: CommandRerunAdviceChoiceV1;
  /** Present exactly when `choice` is `escalate` (需求、产品取舍、架构). */
  escalationKind: UnknownCallAdviceEscalationKindV1 | null;
  /** 1..2000 UTF-16 units. */
  rationale: string;
  /** 1..200 UTF-16 units, one line: the sentence the person reads. */
  plain: string;
};

/**
 * The frozen round facts the platform writes beside the form; never model text. `reviewRef` is the record that
 * blocked the command (its Run is the history the adviser reads); the Goal digest is `unknownCallAdviceGoalBasisDigest`.
 */
export type CommandRerunAdviceSubjectV1 = {
  requestRef: CommandRerunRequestRef;
  reviewRef: UnknownCallReviewRef;
  revision: number;
  goalBasisDigest: string;
};

export type ParsedCommandRerunAdviceAnswerV1 = {
  status: 'parsed'; subject: CommandRerunAdviceSubjectV1; advice: CommandRerunAdviceV1;
};

const ADVICE_KEYS = ['choice', 'escalationKind', 'rationale', 'plain'] as const;
const SUBJECT_KEYS = ['requestRef', 'reviewRef', 'revision', 'goalBasisDigest'] as const;
const ANSWER_KEYS = ['schemaVersion', 'kind', ...SUBJECT_KEYS, ...ADVICE_KEYS] as const;

/** The ONE shape check of a stored or submitted advice (codec, parse and the owner share it). */
export function commandRerunAdviceProblem(value: unknown): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ADVICE_KEYS)) return 'the advice must be { choice, escalationKind, rationale, plain }';
  if (!(COMMAND_RERUN_ADVICE_CHOICES as readonly unknown[]).includes(value['choice'])) {
    return 'the advice choice is not allow_rerun, deny or escalate';
  }
  return adviceDetailsProblem(value);
}

/**
 * The ONE shape check of the frozen subject (the request's second line and the answer's fixed members): exactly the
 * four members, the complete request and review refs of one Goal, a positive revision and a non-empty digest.
 */
export function commandRerunAdviceSubjectProblem(value: unknown): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, SUBJECT_KEYS)) {
    return 'the advice subject is not { requestRef, reviewRef, revision, goalBasisDigest }';
  }
  const request = value['requestRef'];
  if (!isRecord(request) || !hasOnlyKeys(request, ['aggregateType', 'projectId', 'goalId', 'taskId', 'requestId'])
    || request['aggregateType'] !== 'CommandRerunRequest' || !nonEmpty(request['projectId'])
    || !nonEmpty(request['goalId']) || !nonEmpty(request['taskId']) || !nonEmpty(request['requestId'])) {
    return 'the advice subject names no complete request ref';
  }
  const review = value['reviewRef'];
  if (!isRecord(review) || !hasOnlyKeys(review, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || review['aggregateType'] !== 'UnknownCallReview' || review['projectId'] !== request['projectId']
    || review['goalId'] !== request['goalId'] || !nonEmpty(review['runId'])) {
    return 'the advice subject names no complete review ref of the request\'s Goal';
  }
  if (!isPos(value['revision'])) return 'the advice subject revision is not a positive integer';
  if (!nonEmpty(value['goalBasisDigest'])) return 'the advice subject has no Goal basis digest';
  return null;
}

/** The stored answer text: the platform's fixed members and frozen subject first, then the form. */
export function commandRerunAdviceAnswerText(subject: CommandRerunAdviceSubjectV1, advice: CommandRerunAdviceV1): string {
  const request = subject.requestRef;
  const review = subject.reviewRef;
  return JSON.stringify({
    schemaVersion: 1, kind: 'command_rerun_advice',
    requestRef: { aggregateType: 'CommandRerunRequest', projectId: request.projectId, goalId: request.goalId,
      taskId: request.taskId, requestId: request.requestId },
    reviewRef: { aggregateType: 'UnknownCallReview', projectId: review.projectId, goalId: review.goalId,
      runId: review.runId },
    revision: subject.revision, goalBasisDigest: subject.goalBasisDigest,
    choice: advice.choice, escalationKind: advice.escalationKind, rationale: advice.rationale, plain: advice.plain,
  });
}

/**
 * The strict parse: the whole text is exactly one answer object (no prose, no code fence), within 16 KiB, with
 * exactly the members above; nothing is trimmed.
 */
export function parseCommandRerunAdviceAnswer(text: string): ParsedCommandRerunAdviceAnswerV1 | CoreRejection {
  if (utf8Bytes(text) > MAX_ANSWER_BYTES) return rejected('invalid', 'the rerun advice answer is over 16 KiB');
  const parsed = parseObject(text);
  if (parsed === null) return rejected('invalid', 'the rerun advice answer is not one JSON object');
  if (!hasOnlyKeys(parsed, ANSWER_KEYS)) return rejected('invalid', 'the rerun advice answer has an unknown member');
  if (parsed['schemaVersion'] !== 1 || parsed['kind'] !== 'command_rerun_advice') {
    return rejected('invalid', 'the rerun advice answer is not command_rerun_advice v1');
  }
  const subject = { requestRef: parsed['requestRef'], reviewRef: parsed['reviewRef'],
    revision: parsed['revision'], goalBasisDigest: parsed['goalBasisDigest'] };
  const subjectProblem = commandRerunAdviceSubjectProblem(subject);
  if (subjectProblem !== null) return rejected('invalid', subjectProblem);
  const advice = { choice: parsed['choice'], escalationKind: parsed['escalationKind'],
    rationale: parsed['rationale'], plain: parsed['plain'] };
  const problem = commandRerunAdviceProblem(advice);
  if (problem !== null) return rejected('invalid', problem);
  return { status: 'parsed', subject: subject as unknown as CommandRerunAdviceSubjectV1,
    advice: advice as CommandRerunAdviceV1 };
}
