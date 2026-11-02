/**
 * Plan-review answers: the frozen verdict/finding/form shapes and the ONE
 * strict parse of a review answer (§6.1.3, §6.2, §6.3.3).
 *
 * The form is what the `submit_plan_review` tool accepts; the answer is
 * exactly one JSON object with `schemaVersion: 1`, `kind: 'plan_review'`, the
 * verdict and (for `fix`) at least one finding. There is no tolerant read: the
 * candidate loop treats an unparseable answer as `terminal_invalid`.
 */
import { rejected } from './core/rejections.js';
import type { CoreRejection } from './core/results.js';
import { hasOnlyKeys, isRecord, nonEmpty, parseObject } from './validation/common.js';
import type { VerificationCheckKind } from './verification.js';

export type PlanReviewVerdictV1 = 'pass' | 'fix';

/** One review opinion; `taskId: null` is a plan-level opinion. */
export type PlanReviewFindingV1 = { taskId: string | null; text: string };

/** The model-filled form; `findings` may be omitted (the tool writes `[]` on pass). */
export type PlanReviewFormV1 = { verdict: PlanReviewVerdictV1; findings?: PlanReviewFindingV1[] };

/** One candidate version's review read; the four states are mutually exclusive (§6.1.3). */
export type PlanReviewReadV1 =
  | { status: 'not_sent' }
  | { status: 'waiting' }
  | { status: 'decided'; verdict: PlanReviewVerdictV1; findings: readonly PlanReviewFindingV1[] }
  | { status: 'terminal_invalid'; reason: string };

/** The mechanical-diagnosis finding (§6.2); computed, never persisted. */
export type PlanDiagnosisFindingV1 = {
  obligationId: string;
  requirementId: string;
  kind: VerificationCheckKind;
  code: 'no_registered_check' | 'reviewer_not_supported';
  /** One plain sentence for the reviewer and the person; no references. */
  message: string;
};

const REVIEW_KEYS = ['schemaVersion', 'kind', 'verdict', 'findings'] as const;
const FINDING_KEYS = ['taskId', 'text'] as const;

/** The answer body: exactly one JSON object, `findings` always written. */
export function planReviewAnswerText(form: PlanReviewFormV1): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: 'plan_review',
    verdict: form.verdict,
    findings: (form.findings ?? []).map(finding => ({ taskId: finding.taskId, text: finding.text })),
  });
}

/**
 * Strict parse (§6.3.3): one JSON object with no surrounding text or code
 * fence, no unknown members, a known verdict and structurally valid findings;
 * a `fix` needs at least one finding, while `pass` may carry findings.
 */
export function parsePlanReviewAnswer(
  text: string,
): { status: 'parsed'; verdict: PlanReviewVerdictV1; findings: PlanReviewFindingV1[] } | CoreRejection {
  const parsed = parseObject(text);
  if (parsed === null) return rejected('invalid', 'the plan review answer is not one JSON object');
  if (!hasOnlyKeys(parsed, REVIEW_KEYS)) {
    return rejected('invalid', 'the plan review answer carries an unknown member');
  }
  if (parsed['schemaVersion'] !== 1) {
    return rejected('invalid', 'the plan review answer must carry schemaVersion 1');
  }
  if (parsed['kind'] !== 'plan_review') {
    return rejected('invalid', 'the plan review answer kind must be plan_review');
  }
  const verdict = parsed['verdict'];
  if (verdict !== 'pass' && verdict !== 'fix') {
    return rejected('invalid', 'the plan review verdict must be pass or fix');
  }
  const rawFindings = parsed['findings'];
  if (!Array.isArray(rawFindings)) {
    return rejected('invalid', 'the plan review findings must be an array');
  }
  const findings: PlanReviewFindingV1[] = [];
  for (const raw of rawFindings) {
    if (!isRecord(raw) || !hasOnlyKeys(raw, FINDING_KEYS)) {
      return rejected('invalid', 'each plan review finding must be an object with taskId and text');
    }
    const taskId = raw['taskId'];
    const findingText = raw['text'];
    if (typeof taskId !== 'string' && taskId !== null) {
      return rejected('invalid', 'a plan review finding taskId must be a string or null');
    }
    if (!nonEmpty(findingText)) {
      return rejected('invalid', 'a plan review finding needs a non-empty text');
    }
    findings.push({ taskId, text: findingText });
  }
  if (verdict === 'fix' && findings.length === 0) {
    return rejected('invalid', 'a fix verdict needs at least one finding');
  }
  return { status: 'parsed', verdict, findings };
}
