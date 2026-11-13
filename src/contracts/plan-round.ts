/**
 * The system-round contract: the six round shapes, their one request-id
 * format, the fixed Host sender and its message identity, and the pure reply /
 * read helpers (§5.2.2, §5.2.5–§5.2.6, §5.3.5, §5.6).
 *
 * Only contracts are imported: Workflow, Host, AgentRuntime and WorkGraph all
 * read these names. Sending, refinement selection and Query creation belong to
 * their own packages.
 */
import { rejected } from './core/rejections.js';
import type { CoreCallContext } from './core/call-context.js';
import type { CoreRejection } from './core/results.js';
import type { SessionMessageRef } from './core/session-message.js';
import { canonicalJson, sha256Hex, type JsonValue } from './fingerprint.js';
import { parseInitialPlanningResponseV2 } from './initial-planning-parse.js';
import { parseExecReviewAnswer } from './exec-review.js';
import type { GoalRef } from './ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from './plan.js';
import { parsePlanReviewAnswer } from './plan-review.js';
import type { PlanningAnswerShapeV1, QueryJobRef } from './query-job.js';
import { validSessionMessageRef } from './query-job.js';
import { inList, isPos, nonEmpty, parseObject } from './validation/common.js';
import type { VerificationRoundRef } from './verification.js';

/** A `refine:` target: a stage, or the plan-only placeholder task at goal level. */
export type RefinementTargetV1 =
  | { kind: 'stage'; stageId: string }
  | { kind: 'task'; taskId: string };

/** A `deviation:` cause; two soft lines and two hard stops. */
export type DeviationRoundKind = 'growth' | 'lines' | 'budget' | 'stop';

export type SystemRoundV1 =
  | { kind: 'refine'; goalRef: GoalRef; target: RefinementTargetV1; planRevision: number }
  | { kind: 'deviation'; goalRef: GoalRef; taskId: string; cause: DeviationRoundKind; planRevision: number }
  | { kind: 'planreview'; goalRef: GoalRef; proposalId: string; proposalRevision: number }
  | { kind: 'planfix'; goalRef: GoalRef; proposalId: string; proposalRevision: number }
  | { kind: 'planresume'; goalRef: GoalRef; queryJobId: string; originalMessageRef: SessionMessageRef }
  /** Slice 9: the reviewer's execution-result round of one open verification round. */
  | { kind: 'exec_review'; goalRef: GoalRef; roundRef: VerificationRoundRef };

/** The read-side head of a round: only the first line's segments, never a guess. */
export type SystemRoundHeadV1 =
  | { kind: 'refine'; goalId: string; stageOrTaskId: string; planRevision: number }
  | { kind: 'deviation'; goalId: string; taskId: string; cause: DeviationRoundKind; planRevision: number }
  | { kind: 'planreview'; proposalId: string; proposalRevision: number }
  | { kind: 'planfix'; proposalId: string; proposalRevision: number }
  | { kind: 'planresume'; goalId: string; queryJobId: string }
  /** No `goalId` (the `planreview` precedent): the Goal comes from the source message's `goalRef`. */
  | { kind: 'exec_review'; roundId: string };

/** The one system-round sender; a fixed id is what makes one request id one message. */
export const SYSTEM_ROUND_ACTOR = Object.freeze({ kind: 'system' as const, id: 'host:plan-round' });

/** Host scope context for a system round; the shape `host.ts`'s settings context uses. */
export function systemRoundContext(
  scope: { projectId: string; workspaceId: string },
  signal: AbortSignal,
): CoreCallContext {
  return {
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor: { ...SYSTEM_ROUND_ACTOR } },
    materialReader: {
      kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId,
      actor: { ...SYSTEM_ROUND_ACTOR },
    },
    signal,
  };
}

/**
 * The request id of a round; one literal format per kind (§5.2.2). `refine:`
 * puts the stage id or the placeholder task id in the same third segment.
 */
export function systemRoundRequestId(
  round: SystemRoundV1,
): { status: 'ready'; value: string } | CoreRejection {
  if (round.kind === 'refine') {
    if (round.goalRef.goalId.length === 0) return rejected('invalid', 'goalId is empty');
    const targetId = round.target.kind === 'stage' ? round.target.stageId : round.target.taskId;
    if (targetId.length === 0) {
      return rejected('invalid', round.target.kind === 'stage' ? 'stageId is empty' : 'taskId is empty');
    }
    if (!isPos(round.planRevision)) {
      return rejected('invalid', 'planRevision must be a positive safe integer');
    }
    return { status: 'ready', value: `refine:${round.goalRef.goalId}:${targetId}:${round.planRevision}` };
  }
  if (round.kind === 'deviation') {
    if (round.goalRef.goalId.length === 0) return rejected('invalid', 'goalId is empty');
    if (round.taskId.length === 0) return rejected('invalid', 'taskId is empty');
    if (!isPos(round.planRevision)) {
      return rejected('invalid', 'planRevision must be a positive safe integer');
    }
    return {
      status: 'ready',
      value: `deviation:${round.goalRef.goalId}:${round.taskId}:${round.cause}:${round.planRevision}`,
    };
  }
  if (round.kind === 'planreview' || round.kind === 'planfix') {
    if (round.proposalId.length === 0) return rejected('invalid', 'proposalId is empty');
    if (!isPos(round.proposalRevision)) {
      return rejected('invalid', 'proposalRevision must be a positive safe integer');
    }
    return { status: 'ready', value: `${round.kind}:${round.proposalId}:${round.proposalRevision}` };
  }
  if (round.goalRef.goalId.length === 0) return rejected('invalid', 'goalId is empty');
  if (round.kind === 'exec_review') {
    if (round.roundRef.roundId.length === 0) return rejected('invalid', 'roundId is empty');
    return { status: 'ready', value: `execreview:${round.roundRef.roundId}` };
  }
  if (round.queryJobId.length === 0) return rejected('invalid', 'queryJobId is empty');
  return { status: 'ready', value: `planresume:${round.goalRef.goalId}:${round.queryJobId}` };
}

/**
 * The message id of a Host send: the mailbox's one formula
 * (`messageIdOf`): `session-message-` + sha256 of the canonical JSON of
 * project, workspace, sender identity and request id.
 */
export function hostMessageId(
  scope: { projectId: string; workspaceId: string },
  actor: { kind: 'human'; id: string } | { kind: 'system'; id: string },
  requestId: string,
): { status: 'ready'; value: string } | CoreRejection {
  if (requestId.length === 0) return rejected('invalid', 'requestId is empty');
  return {
    status: 'ready',
    value: 'session-message-' + sha256Hex(canonicalJson({
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      sender: { kind: 'host', actor: { ...actor } },
      requestId,
    } as unknown as JsonValue)),
  };
}

/**
 * The head of a round from the text's FIRST line only. An unknown prefix (or a
 * line that is not the exact shape of a known one) is not an error: it reads
 * as an ordinary planning message and returns `null`.
 */
export function systemRoundOfText(text: string): SystemRoundHeadV1 | null {
  const firstLine = text.split('\n')[0] ?? '';
  const segments = firstLine.split(':');
  const [prefix] = segments;
  if (prefix === 'refine') {
    if (segments.length !== 4) return null;
    const [, goalId, stageOrTaskId, revision] = segments;
    const planRevision = positivePlanRevisionOf(revision);
    if (!nonEmpty(goalId) || !nonEmpty(stageOrTaskId) || planRevision === null) return null;
    return { kind: 'refine', goalId, stageOrTaskId, planRevision };
  }
  if (prefix === 'deviation') {
    if (segments.length !== 5) return null;
    const [, goalId, taskId, cause, revision] = segments;
    const planRevision = positivePlanRevisionOf(revision);
    if (!nonEmpty(goalId) || !nonEmpty(taskId)
      || !inList(cause, ['growth', 'lines', 'budget', 'stop']) || planRevision === null) return null;
    return { kind: 'deviation', goalId, taskId, cause, planRevision };
  }
  if (prefix === 'planreview' || prefix === 'planfix') {
    if (segments.length !== 3) return null;
    const [, proposalId, revision] = segments;
    const proposalRevision = positivePlanRevisionOf(revision);
    if (!nonEmpty(proposalId) || proposalRevision === null) return null;
    return { kind: prefix, proposalId, proposalRevision };
  }
  if (prefix === 'planresume') {
    if (segments.length !== 3) return null;
    const [, goalId, queryJobId] = segments;
    if (!nonEmpty(goalId) || !nonEmpty(queryJobId)) return null;
    return { kind: 'planresume', goalId, queryJobId };
  }
  if (prefix === 'execreview') {
    if (segments.length !== 2) return null;
    const [, roundId] = segments;
    if (!nonEmpty(roundId)) return null;
    return { kind: 'exec_review', roundId };
  }
  return null;
}

function positivePlanRevisionOf(segment: string | undefined): number | null {
  if (!nonEmpty(segment)) return null;
  const revision = Number(segment);
  return isPos(revision) ? revision : null;
}

/**
 * The second line of a `planresume:` text: `originalQueryRef: <canonicalJson>`.
 * Absent or not a complete `SessionMessageRef` -> `null`.
 */
export function planResumeOriginalQueryOfText(text: string): SessionMessageRef | null {
  const line = text.split('\n')[1];
  if (line === undefined) return null;
  const prefix = 'originalQueryRef: ';
  if (!line.startsWith(prefix)) return null;
  const json = line.slice(prefix.length);
  const parsed = parseObject(json);
  if (parsed === null) return null;
  return validSessionMessageRef(parsed) ? parsed : null;
}

/**
 * The short reply derived from the frozen answer shape (§5.3.5): a plan
 * summary, a review verdict, or the original text. Only a `plan_review` or
 * `exec_review` answer that no longer parses has no reply (`null` -> terminal
 * invalid). The exec review reply never carries the answer JSON (slice 9).
 */
export function planningReplyTextOf(input: {
  shape: PlanningAnswerShapeV1;
  answerText: string;
  queryJobId: string;
}): string | null {
  if (input.shape === 'text') return input.answerText;
  if (input.shape === 'plan_review') {
    const parsed = parsePlanReviewAnswer(input.answerText);
    if (parsed.status !== 'parsed') return null;
    return parsed.verdict === 'pass'
      ? '审阅通过'
      : `审阅要求返修：${parsed.findings.length} 条意见，见 Query ${input.queryJobId}`;
  }
  if (input.shape === 'exec_review') {
    const parsed = parseExecReviewAnswer(input.answerText);
    if (parsed.status !== 'parsed') return null;
    return parsed.verdict === 'pass' ? '执行结果审阅通过' : `执行结果审阅要求返工：见 Query ${input.queryJobId}`;
  }
  const parsed = parseInitialPlanningResponseV2(input.answerText);
  if (parsed.status === 'parsed') return parsed.response.summary;
  return input.answerText;
}

// ------------------------------------------------------------------------ //
// Shared result types (the declarations moved here by DR-P1-03)             //
// ------------------------------------------------------------------------ //

/** One candidate version's fix read; mutually exclusive (§6.1.3). */
export type PlanFixReadV1 =
  | { status: 'not_sent' }
  | { status: 'waiting' }
  | { status: 'terminal' };

/** One planning question group from this loop's own source (§6.1.6). */
export type PlanningQuestionGroupV1 = {
  queryJobRef: QueryJobRef;
  /** The original planning round's message, read only from its execution source. */
  originalMessageRef: SessionMessageRef;
  total: number;
  answered: number;
  /** Every question has a stored answer (`total > 0` and `answered === total`). */
  allAnswered: boolean;
  /** The `planresume:` message or its Query already exists. */
  resumeMessageExists: boolean;
};

export type TaskbookFileStatusV1 =
  | { state: 'written'; stageId: string; path: string; bytes: number }
  | { state: 'incomplete'; stageId: string; path: string; actualBytes: number; expectedBytes: number }
  | { state: 'missing'; stageId: string; path: string };

export type TaskbookExportReadV1 =
  | { status: 'not_configured' }
  | { status: 'ready'; stages: readonly TaskbookFileStatusV1[] }
  | { status: 'unavailable'; reason: string };

/** The Host probe the notice source reads; a candidate passes its draft (§6.4.3). */
export type TaskbookExportReadPort = {
  read(input: {
    plan: PlanRevisionSnapshot | PlanRevisionDraft;
    scope: { projectId: string; workspaceId: string; goalId: string };
  }): Promise<TaskbookExportReadV1>;
};
