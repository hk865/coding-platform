/**
 * G8B B1：平台自动采用一份带新检查的计划时，由不是作者的 agent 批准这些检查。
 * 这里放批准要用的纯数据和纯函数：改动前的事实（baseline）。
 */
import { rejected } from './core/rejections.js';
import type { CoreRejection } from './core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from './fingerprint.js';
import type { GoalRef } from './ledger.js';
import { truncateUtf8, utf8ByteLength } from './utf8.js';
import { hasOnlyKeys, isPos, isRecord, isSha256Hex, nonEmpty, parseObject } from './validation/common.js';
import type { CheckProcessObservation, RegisteredCommandCheck } from './verification.js';

/**
 * 一条新检查在改动前的工作区跑出的结果（B1c）。“失败”只认一种：进程跑完、没超时、没被取消、退出码是非零整数。
 * 跑通、超时、被信号杀掉、没跑成都不算失败。`not_started` 时 `stderrTail` 写没跑成的原因。
 */
export type CheckBaselineV1 = {
  checkId: string;
  /** sha256(canonicalJson(check))：装检查时按 id 和它找回这一项。 */
  checkDigest: string;
  ranAt: string;
  outcome: 'failed' | 'passed' | 'timed_out' | 'killed' | 'not_started';
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
};

/** 计划候选的引用（同 WorkGraph 的 `PlanProposalRef`；契约层不引 core）。 */
export type CheckReviewProposalRefV1 = {
  aggregateType: 'PlanProposal'; projectId: string; workspaceId: string; proposalId: string;
};

/** 写候选的职责、批检查的职责：一张表（B1a），批准者和作者职责不同。 */
export type CheckReviewAuthorDutyV1 = 'secretary' | 'adviser';
export type CheckReviewApproverDutyV1 = 'adviser' | 'reviewer';

/**
 * 批准轮消息第二行 `subject:` 的内容（B1d），平台写，只从这里读：哪份候选的哪一版、谁写的、谁批、每条新检查在改动前
 * 跑出的事实（请批时只有全部失败才发）。
 */
export type CheckReviewSubjectV1 = {
  proposalRef: CheckReviewProposalRefV1;
  proposalRevision: number;
  goalRef: GoalRef;
  authorDuty: CheckReviewAuthorDutyV1;
  approverDuty: CheckReviewApproverDutyV1;
  baselines: CheckBaselineV1[];
};

/** 批准者对一条检查的答案：只有批和交人两档（Q5）。 */
export type CheckReviewVerdictV1 = { checkId: string; decision: 'approve' | 'to_person'; reason: string };
/** 模型填的表；候选和版本由平台从 `subject` 填。 */
export type CheckReviewFormV1 = { verdicts: CheckReviewVerdictV1[] };
export type CheckReviewAnswerV1 = { proposalId: string; proposalRevision: number; verdicts: CheckReviewVerdictV1[] };

const SUBJECT_KEYS = ['proposalRef', 'proposalRevision', 'goalRef', 'authorDuty', 'approverDuty', 'baselines'] as const;
const PROPOSAL_REF_KEYS = ['aggregateType', 'projectId', 'workspaceId', 'proposalId'] as const;
const GOAL_REF_KEYS = ['aggregateType', 'projectId', 'goalId'] as const;
const BASELINE_KEYS = ['checkId', 'checkDigest', 'ranAt', 'outcome', 'exitCode', 'stdoutTail', 'stderrTail'] as const;
const ANSWER_KEYS = ['schemaVersion', 'kind', 'proposalId', 'proposalRevision', 'verdicts'] as const;
const VERDICT_KEYS = ['checkId', 'decision', 'reason'] as const;
const BASELINE_OUTCOMES: readonly CheckBaselineV1['outcome'][] = ['failed', 'passed', 'timed_out', 'killed', 'not_started'];

/** 一项改动前事实的结构检查：批准轮的 `subject` 和设置文件里存的批准记录都用它。 */
export function checkBaselineProblem(value: unknown): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, BASELINE_KEYS)) return 'a baseline is not a check baseline object';
  if (!nonEmpty(value['checkId']) || !isSha256Hex(value['checkDigest']) || !nonEmpty(value['ranAt'])) {
    return 'a baseline needs checkId, a sha256 checkDigest and ranAt';
  }
  if (!BASELINE_OUTCOMES.includes(value['outcome'] as CheckBaselineV1['outcome'])) return 'a baseline outcome is unknown';
  const exitCode = value['exitCode'];
  if (exitCode !== null && !Number.isInteger(exitCode)) return 'a baseline exitCode is an integer or null';
  if (typeof value['stdoutTail'] !== 'string' || typeof value['stderrTail'] !== 'string') return 'a baseline tail is text';
  return null;
}

/** 第二行 `subject` 的结构检查；读的地方只认平台写的这一种。 */
export function checkReviewSubjectProblem(value: unknown): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, SUBJECT_KEYS)) return 'the check review subject is not an object of its keys';
  const proposalRef = value['proposalRef'];
  if (!isRecord(proposalRef) || !hasOnlyKeys(proposalRef, PROPOSAL_REF_KEYS) || proposalRef['aggregateType'] !== 'PlanProposal'
    || !nonEmpty(proposalRef['projectId']) || !nonEmpty(proposalRef['workspaceId']) || !nonEmpty(proposalRef['proposalId'])) {
    return 'the check review subject needs a plan proposal ref';
  }
  const goalRef = value['goalRef'];
  if (!isRecord(goalRef) || !hasOnlyKeys(goalRef, GOAL_REF_KEYS) || goalRef['aggregateType'] !== 'Goal'
    || !nonEmpty(goalRef['projectId']) || !nonEmpty(goalRef['goalId'])) return 'the check review subject needs a Goal ref';
  if (!isPos(value['proposalRevision'])) return 'the check review subject needs a positive proposal revision';
  if (value['authorDuty'] !== 'secretary' && value['authorDuty'] !== 'adviser') return 'the author duty is secretary or adviser';
  if (value['approverDuty'] !== 'adviser' && value['approverDuty'] !== 'reviewer') return 'the approver duty is adviser or reviewer';
  const baselines = value['baselines'];
  if (!Array.isArray(baselines) || baselines.length === 0) return 'the check review subject needs at least one baseline';
  for (const baseline of baselines) {
    const problem = checkBaselineProblem(baseline);
    if (problem !== null) return problem;
  }
  return null;
}

/** 回答正文：一个 JSON 对象，候选和版本来自 `subject`。 */
export function checkReviewAnswerText(subject: CheckReviewSubjectV1, form: CheckReviewFormV1): string {
  return JSON.stringify({
    schemaVersion: 1, kind: 'check_review',
    proposalId: subject.proposalRef.proposalId, proposalRevision: subject.proposalRevision,
    verdicts: form.verdicts.map(verdict => ({ checkId: verdict.checkId, decision: verdict.decision, reason: verdict.reason })),
  });
}

/** 严格解析（照 `plan-review.ts`）：没有多余成员，每条答案是批或交人，理由不空，同一条检查不答两次。 */
export function parseCheckReviewAnswer(text: string): { status: 'parsed'; answer: CheckReviewAnswerV1 } | CoreRejection {
  const parsed = parseObject(text);
  if (parsed === null) return rejected('invalid', 'the check review answer is not one JSON object');
  if (!hasOnlyKeys(parsed, ANSWER_KEYS)) return rejected('invalid', 'the check review answer carries an unknown member');
  if (parsed['schemaVersion'] !== 1 || parsed['kind'] !== 'check_review') {
    return rejected('invalid', 'the check review answer is not check_review v1');
  }
  const proposalId = parsed['proposalId'];
  const proposalRevision = parsed['proposalRevision'];
  if (!nonEmpty(proposalId) || !isPos(proposalRevision)) {
    return rejected('invalid', 'the check review answer needs the proposal id and revision');
  }
  const rawVerdicts = parsed['verdicts'];
  if (!Array.isArray(rawVerdicts) || rawVerdicts.length === 0) {
    return rejected('invalid', 'the check review verdicts must be a non-empty array');
  }
  const verdicts: CheckReviewVerdictV1[] = [];
  for (const raw of rawVerdicts) {
    if (!isRecord(raw) || !hasOnlyKeys(raw, VERDICT_KEYS)) {
      return rejected('invalid', 'each verdict must be an object with checkId, decision and reason');
    }
    const checkId = raw['checkId'];
    const decision = raw['decision'];
    const reason = raw['reason'];
    if (!nonEmpty(checkId)) return rejected('invalid', 'a verdict needs a checkId');
    if (decision !== 'approve' && decision !== 'to_person') return rejected('invalid', 'a decision is approve or to_person');
    if (!nonEmpty(reason)) return rejected('invalid', 'a verdict needs a non-empty reason');
    if (verdicts.some(verdict => verdict.checkId === checkId)) return rejected('invalid', `check ${checkId} is answered twice`);
    verdicts.push({ checkId, decision, reason });
  }
  return { status: 'parsed', answer: { proposalId, proposalRevision, verdicts } };
}

/** 答案要正好答 `subject` 里的每条新检查、而且是这一份候选的这一版；提交工具和读结论都用它。 */
export function checkReviewAnswerProblem(subject: CheckReviewSubjectV1, answer: CheckReviewAnswerV1): string | null {
  if (answer.proposalId !== subject.proposalRef.proposalId || answer.proposalRevision !== subject.proposalRevision) {
    return 'the answer names another plan candidate or revision';
  }
  const asked = subject.baselines.map(baseline => baseline.checkId).sort();
  const answered = answer.verdicts.map(verdict => verdict.checkId).sort();
  if (asked.length !== answered.length || asked.some((checkId, index) => checkId !== answered[index])) {
    return `answer each new check exactly once: ${asked.join(', ')}`;
  }
  return null;
}

/** 请知悉的五种情形（B1g）：批了生效，或交人的四种原因。 */
export type CheckApprovalNoticeCaseV1 =
  | { kind: 'approved'; checkIds: readonly string[]; approverDuty: CheckReviewApproverDutyV1 }
  | { kind: 'not_approved'; verdicts: readonly { checkId: string; reason: string }[]; approverDuty: CheckReviewApproverDutyV1 }
  | { kind: 'baseline'; baselines: readonly Pick<CheckBaselineV1, 'checkId' | 'outcome'>[] }
  | { kind: 'not_adopted'; checkIds: readonly string[]; approverDuty: CheckReviewApproverDutyV1; reason: string }
  | { kind: 'no_approver'; checkIds: readonly string[]; approverDuty: CheckReviewApproverDutyV1 }
  /** lead 11-17 补充裁定 2：`taskIds: "all"` 的新检查交人。 */
  | { kind: 'all_tasks'; checkIds: readonly string[] };

const DUTY_NAMES: Record<CheckReviewAuthorDutyV1 | CheckReviewApproverDutyV1, string> = {
  secretary: '秘书', adviser: '参谋', reviewer: '审阅者',
};
const BASELINE_PHRASES: Record<Exclude<CheckBaselineV1['outcome'], 'failed'>, string> = {
  passed: '改动前跑就通过了', timed_out: '改动前跑超时了', killed: '改动前跑到一半被停掉了', not_started: '改动前没跑成',
};

/** 请知悉的文字（B1g，给人看）：一个纯函数，截到 512 字节；目标取 `objective` 前 30 个字。 */
export function checkApprovalNoticeText(input: { authorDuty: CheckReviewAuthorDutyV1; objective: string;
  notice: CheckApprovalNoticeCaseV1 }): string {
  const head = `来自 ${DUTY_NAMES[input.authorDuty]} · 目标 ${Array.from(input.objective).slice(0, 30).join('')}：`;
  const ids = (checkIds: readonly string[]) => checkIds.map(checkId => `「${checkId}」`).join('');
  const notice = input.notice;
  let body: string;
  if (notice.kind === 'approved') {
    body = `加了检查${ids(notice.checkIds)}，改动前跑会失败（已核实），${DUTY_NAMES[notice.approverDuty]}已批，已生效`;
  } else if (notice.kind === 'not_approved') {
    body = `${DUTY_NAMES[notice.approverDuty]}没批检查${notice.verdicts.map(verdict =>
      `「${verdict.checkId}」（${verdict.reason}）`).join('')}，这份计划交你决定`;
  } else if (notice.kind === 'baseline') {
    body = `${notice.baselines.filter(baseline => baseline.outcome !== 'failed').map(baseline =>
      `检查「${baseline.checkId}」${BASELINE_PHRASES[baseline.outcome as Exclude<CheckBaselineV1['outcome'], 'failed'>]}`)
      .join('；')}，查不出这次的改动，交你决定`;
  } else if (notice.kind === 'not_adopted') {
    body = `${DUTY_NAMES[notice.approverDuty]}已批检查${ids(notice.checkIds)}，但计划没采用上：${notice.reason}，交你决定`;
  } else if (notice.kind === 'no_approver') {
    body = `没有能批这些检查的${DUTY_NAMES[notice.approverDuty]}，检查${ids(notice.checkIds)}交你决定`;
  } else {
    body = `检查${ids(notice.checkIds)}适用于整个工作区（taskIds: all），会影响其他目标，交你决定`;
  }
  return truncateUtf8(head + body, 512);
}

/** 输出各取末尾这么多字节。 */
export const CHECK_BASELINE_TAIL_BYTES = 500;

/** 一条检查定义的摘要，批准轮的事实和装检查时的匹配用同一个。 */
export function checkDigestOf(check: RegisteredCommandCheck): string {
  return sha256Hex(canonicalJson(check as unknown as JsonValue));
}

/** 文字末尾不超过 `maxBytes` 字节的一段，不切开一个字。 */
function utf8Tail(text: string, maxBytes: number): string {
  const chars = Array.from(text);
  let start = chars.length;
  let bytes = 0;
  while (start > 0) {
    const size = utf8ByteLength(chars[start - 1]!);
    if (bytes + size > maxBytes) break;
    bytes += size;
    start -= 1;
  }
  return chars.slice(start).join('');
}

/** 没跑成的那一种：没有进程输出，原因写进 `stderrTail`。 */
export function checkBaselineNotStarted(check: RegisteredCommandCheck, ranAt: string, reason: string): CheckBaselineV1 {
  return { checkId: check.checkId, checkDigest: checkDigestOf(check), ranAt, outcome: 'not_started', exitCode: null,
    stdoutTail: '', stderrTail: utf8Tail(reason, CHECK_BASELINE_TAIL_BYTES) };
}

/**
 * lead 11-17 裁定 5：Kernel 每路输出只收前 32 KiB，超过的部分丢掉；这时取到的只是前段的末尾，要让批准者知道。
 * 真正保留进程输出末尾要改 Kernel（走受管补丁流程），记进待办。
 */
const TRUNCATED_MARK = '（输出超过上限，这里只是前段的末尾）';

function streamTail(stream: { text: string; truncated: boolean }): string {
  if (!stream.truncated) return utf8Tail(stream.text, CHECK_BASELINE_TAIL_BYTES);
  return TRUNCATED_MARK + utf8Tail(stream.text, CHECK_BASELINE_TAIL_BYTES - utf8ByteLength(TRUNCATED_MARK));
}

/** 把检查沙盒的观察换成改动前的事实；被调用方取消的进程不在这里（调用方回 `cancelled`，下一轮重跑）。 */
export function checkBaselineOf(check: RegisteredCommandCheck, ranAt: string,
  observation: CheckProcessObservation): CheckBaselineV1 {
  if (observation.kind === 'not_started') return checkBaselineNotStarted(check, ranAt, observation.reason);
  const { exitCode } = observation;
  const outcome: CheckBaselineV1['outcome'] = observation.timedOut ? 'timed_out'
    : exitCode === 0 ? 'passed'
      : exitCode !== null && Number.isInteger(exitCode) && !observation.cancelled ? 'failed'
        : 'killed';
  return { checkId: check.checkId, checkDigest: checkDigestOf(check), ranAt, outcome, exitCode,
    stdoutTail: streamTail(observation.stdout), stderrTail: streamTail(observation.stderr) };
}
