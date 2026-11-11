/**
 * Slice 9: the reviewer's execution-result answer. `submit_exec_review` fills `verdict`/`basis`/`report`; the platform
 * writes the versioned text and every reader parses it here. It shares no name
 * with the plan review answer (`plan-review.ts`): no `findings`, no task ids,
 * no evidence ref.
 */
import { EVIDENCE_SUMMARY_MAX_BYTES } from './evidence.js';
import { rejected } from './core/rejections.js';
import type { CoreRejection } from './core/results.js';
import { MAX_ANSWER_BYTES } from './query-job.js';
import { hasOnlyKeys, nonEmpty, parseObject, utf8Bytes } from './validation/common.js';

export type ExecReviewVerdictV1 = 'pass' | 'fix';
/** The three members the model fills. */
export type ExecReviewFormV1 = { verdict: ExecReviewVerdictV1; basis: string; report: string };
export type ExecReviewAnswerV1 = {
  schemaVersion: 1; kind: 'exec_review'; verdict: ExecReviewVerdictV1; basis: string; report: string;
};
export type ParsedExecReviewAnswerV1 = { status: 'parsed' } & ExecReviewFormV1;

const ANSWER_KEYS = ['schemaVersion', 'kind', 'verdict', 'basis', 'report'] as const;

/** The stored answer text: the platform's fixed members first, then the form. */
export function execReviewAnswerText(form: ExecReviewFormV1): string {
  const answer: ExecReviewAnswerV1 = {
    schemaVersion: 1, kind: 'exec_review', verdict: form.verdict, basis: form.basis, report: form.report,
  };
  return JSON.stringify(answer);
}

/**
 * The strict parse: the whole text is exactly one answer object (no prose, no
 * code fence), within 16 KiB; `basis` is non-empty and at most 4096 UTF-8 bytes,
 * `report` is non-empty. Neither is trimmed.
 */
export function parseExecReviewAnswer(text: string): ParsedExecReviewAnswerV1 | CoreRejection {
  if (utf8Bytes(text) > MAX_ANSWER_BYTES) return rejected('invalid', 'the exec review answer is over 16 KiB');
  const parsed = parseObject(text);
  if (parsed === null) return rejected('invalid', 'the exec review answer is not one JSON object');
  if (!hasOnlyKeys(parsed, ANSWER_KEYS)) return rejected('invalid', 'the exec review answer has an unknown member');
  if (parsed['schemaVersion'] !== 1) return rejected('invalid', 'the exec review answer schemaVersion is not 1');
  if (parsed['kind'] !== 'exec_review') return rejected('invalid', 'the exec review answer kind is not exec_review');
  const verdict = parsed['verdict'];
  if (verdict !== 'pass' && verdict !== 'fix') return rejected('invalid', 'the exec review verdict is not pass or fix');
  const basis = parsed['basis'];
  if (!nonEmpty(basis)) return rejected('invalid', 'the exec review basis is empty');
  if (utf8Bytes(basis) > EVIDENCE_SUMMARY_MAX_BYTES) {
    return rejected('invalid', 'the exec review basis is over 4096 bytes');
  }
  const report = parsed['report'];
  if (!nonEmpty(report)) return rejected('invalid', 'the exec review report is empty');
  return { status: 'parsed', verdict, basis, report };
}
