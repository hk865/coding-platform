/**
 * HANDOFF 121-112: the scribe's review of one long command. When a command runs
 * past `min(max(expected, 10 min), the review line)`, the Host sends the scribe
 * one system round (`scr:`); the platform writes the frozen facts beside it
 * (`subject`, the request's second line) and the scribe's submit tool fills the
 * form. Every reader parses the stored answer here (the `exec-review.ts`
 * pattern). `normal` keeps the scribe's own note (written in the same round)
 * and names when to look again; `adviser` stops the command and tells the
 * responsible adviser; `human` tells the person. Nothing here stops a command.
 */
import { rejected } from './core/rejections.js';
import type { CoreRejection } from './core/results.js';
import type { RunRef } from './dispatch.js';
import { MAX_ANSWER_BYTES, type QueryRunRef } from './query-job.js';
import { hasOnlyKeys, isNonNeg, isPos, isRecord, nonEmpty, parseObject, utf8Bytes } from './validation/common.js';

/**
 * The facts the Host had when the round was built; never model text. Only what
 * the Host has today: a running command's output and process state are not
 * recorded anywhere, so the round says so instead of guessing.
 */
export type CommandReviewSubjectV1 = {
  projectId: string;
  workspaceId: string;
  goalId: string;
  /** `runningCommandKey(run, callId)`: the key the running-command read and its over-line notice use. */
  commandKey: string;
  /** The Work Run (and its Task), or the Query round, running the command; `goalId` is that Run's or Query's Goal. */
  run: { kind: 'run'; runRef: RunRef; taskId: string } | { kind: 'query'; queryRunRef: QueryRunRef };
  tool: string;
  /** The first 512 characters of the command. */
  commandPreview: string;
  expectedMs: number;
  lineMs: number;
  startedAt: string;
  /** How long the command had run when the round was built. */
  elapsedMs: number;
  /** 1 for the first review, one more for each "look again". */
  reviewSeq: number;
};

export type CommandReviewConclusionV1 = 'normal' | 'adviser' | 'human';
export const COMMAND_REVIEW_CONCLUSIONS = ['normal', 'adviser', 'human'] as const;

export type CommandReviewAnswerV1 = {
  schemaVersion: 1;
  kind: 'scribe_review';
  conclusion: CommandReviewConclusionV1;
  /** Present exactly when `conclusion` is `normal`: when to look again, in milliseconds. */
  nextReviewInMs: number | null;
  /** Non-empty: the sentence the adviser or the person reads (notices truncate it at their own bound). */
  reason: string;
};

const SUBJECT_KEYS = ['projectId', 'workspaceId', 'goalId', 'commandKey', 'run', 'tool', 'commandPreview',
  'expectedMs', 'lineMs', 'startedAt', 'elapsedMs', 'reviewSeq'] as const;
const ANSWER_KEYS = ['schemaVersion', 'kind', 'conclusion', 'nextReviewInMs', 'reason'] as const;

/** The ONE shape check of the frozen subject the Host writes on the request's second line. */
export function commandReviewSubjectProblem(value: unknown): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, SUBJECT_KEYS) || SUBJECT_KEYS.some(key => !(key in value))) {
    return `the command review subject is not { ${SUBJECT_KEYS.join(', ')} }`;
  }
  for (const key of ['projectId', 'workspaceId', 'goalId', 'commandKey', 'tool', 'commandPreview', 'startedAt'] as const) {
    if (!nonEmpty(value[key])) return `the command review subject ${key} is empty`;
  }
  const run = value['run'];
  const work = isRecord(run) && run['kind'] === 'run';
  const ref = isRecord(run) ? run[work ? 'runRef' : 'queryRunRef'] : undefined;
  const refKeys = work ? ['aggregateType', 'projectId', 'goalId', 'runId']
    : ['aggregateType', 'projectId', 'workspaceId', 'queryJobId', 'runId'];
  if (!isRecord(run) || !isRecord(ref) || (!work && run['kind'] !== 'query')
    || !hasOnlyKeys(run, work ? ['kind', 'runRef', 'taskId'] : ['kind', 'queryRunRef'])
    || (work && !nonEmpty(run['taskId'])) || !hasOnlyKeys(ref, refKeys)
    || ref['aggregateType'] !== (work ? 'Run' : 'QueryRun') || refKeys.slice(1).some(key => !nonEmpty(ref[key]))) {
    return 'the command review subject names no complete Work Run or Query round';
  }
  for (const key of ['expectedMs', 'lineMs', 'elapsedMs'] as const) {
    if (!isNonNeg(value[key])) return `the command review subject ${key} is not a non-negative integer`;
  }
  if (!isPos(value['reviewSeq'])) return 'the command review subject reviewSeq is not a positive integer';
  return null;
}

/** The stored answer text: the fixed members first, then the form. */
export function commandReviewAnswerText(answer: Omit<CommandReviewAnswerV1, 'schemaVersion' | 'kind'>): string {
  return JSON.stringify({ schemaVersion: 1, kind: 'scribe_review', conclusion: answer.conclusion,
    nextReviewInMs: answer.nextReviewInMs, reason: answer.reason });
}

/**
 * The strict parse: the whole text is exactly one answer object within 16 KiB,
 * one of the three conclusions, `nextReviewInMs` exactly on `normal`, and a
 * non-empty reason; nothing is trimmed.
 */
export function parseCommandReviewAnswer(text: string):
  { status: 'parsed'; answer: CommandReviewAnswerV1 } | CoreRejection {
  if (utf8Bytes(text) > MAX_ANSWER_BYTES) return rejected('invalid', 'the command review answer is over 16 KiB');
  const parsed = parseObject(text);
  if (parsed === null) return rejected('invalid', 'the command review answer is not one JSON object');
  if (!hasOnlyKeys(parsed, ANSWER_KEYS)) return rejected('invalid', 'the command review answer has an unknown member');
  if (parsed['schemaVersion'] !== 1 || parsed['kind'] !== 'scribe_review') {
    return rejected('invalid', 'the command review answer is not scribe_review v1');
  }
  const conclusion = parsed['conclusion'];
  if (!(COMMAND_REVIEW_CONCLUSIONS as readonly unknown[]).includes(conclusion)) {
    return rejected('invalid', 'the conclusion is not one of normal, adviser, human');
  }
  const next = parsed['nextReviewInMs'];
  if (conclusion === 'normal' ? !isPos(next) : next !== null) {
    return rejected('invalid', 'nextReviewInMs is a positive integer of milliseconds exactly when the conclusion is normal');
  }
  const reason = parsed['reason'];
  if (!nonEmpty(reason)) return rejected('invalid', 'the reason is empty');
  return { status: 'parsed', answer: { schemaVersion: 1, kind: 'scribe_review',
    conclusion: conclusion as CommandReviewConclusionV1, nextReviewInMs: next as number | null, reason } };
}
