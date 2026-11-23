/**
 * The pure rules of a planning round (PL §5.1.4, §5.2.2–§5.2.3, §5.2.7).
 *
 * It reads the round facts and builds a mailbox send request; it never reads a
 * store, runs a Host call or keeps state. The one send wrapper is
 * `app/system-round.ts`.
 */
import { rejected } from '../../contracts/core/rejections.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { TaskTriple } from '../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { GoalRef } from '../../contracts/ledger.js';
import {
  systemRoundRequestId,
  type RefinementTargetV1, type SystemRoundV1,
} from '../../contracts/plan-round.js';
import type { PlatformDutyV1 } from '../../contracts/platform-duty.js';
import type { PlanningAnswerShapeV1 } from '../../contracts/query-job.js';
import type { SessionMessageSendInputV1 } from '../../core/work-graph/model/communication-contracts.js';
import type { GoalWaitBasisV1 } from './contracts.js';

/**
 * The single planner target of a Goal wait: a stage placeholder
 * (`plan_only:<stageId>`), or the goal-level placeholder task
 * (`plan_only_task:<taskId>`). Absent or empty means this wait carries no
 * planner marker, never "there is no stage".
 */
export function planOnlyTargetOf(basis: GoalWaitBasisV1 | undefined): RefinementTargetV1 | undefined {
  const task = basis?.reasons.find(reason => reason.startsWith('plan_only_task:'));
  if (task !== undefined) {
    const taskId = task.slice('plan_only_task:'.length);
    return taskId.length === 0 ? undefined : { kind: 'task', taskId };
  }
  const token = basis?.reasons.find(reason => reason === 'plan_only:' || reason.startsWith('plan_only:'));
  if (token === undefined) return undefined;
  const stageId = token.slice('plan_only:'.length);
  return stageId.length === 0 ? undefined : { kind: 'stage', stageId };
}

/**
 * The one refine round of a target wait (§5.2.2). The target is the caller's
 * explicit choice (`planOnlyStageOf` or the placeholder task); it is never
 * re-derived from the basis here.
 */
export function refinementRoundOf(input: {
  basis: GoalWaitBasisV1 | undefined;
  goalRef: GoalRef;
  planRevision: number | null;
  target: RefinementTargetV1 | null;
}): SystemRoundV1 | null {
  if (input.target === null || input.planRevision === null) return null;
  return { kind: 'refine', goalRef: input.goalRef, target: input.target, planRevision: input.planRevision };
}

/** The fixed request sentence of a `planresume:` body (§5.2.3). */
const PLAN_RESUME_REQUEST_SENTENCE =
  '人已答完这一轮的问题卡；接着原规划轮写下一步：只输出这一段/这一版，平台会合并';

/**
 * The complete mailbox request of one round (§5.2.3): reuse
 * `SessionMessageSendInputV1`, never a second message shape. The text's first
 * line is the request id; a `planresume:` body is exactly the header, the
 * original-Query reference and the fixed request sentence.
 */
export function systemRoundSendInput(input: {
  round: SystemRoundV1;
  recipient: SessionRef;
  text: string;
  taskRef?: TaskTriple;
  followupOf?: SessionMessageRef;
}): { status: 'ready'; value: SessionMessageSendInputV1 } | CoreRejection {
  const requestId = systemRoundRequestId(input.round);
  if (requestId.status !== 'ready') return requestId;
  const firstLine = input.text.split('\n')[0] ?? '';
  if (firstLine !== requestId.value) {
    return rejected('invalid', 'the system round text must start with its request id');
  }
  const text = input.round.kind === 'planresume'
    ? [
      requestId.value,
      `originalQueryRef: ${canonicalJson(input.round.originalMessageRef as unknown as JsonValue)}`,
      PLAN_RESUME_REQUEST_SENTENCE,
    ].join('\n')
    : input.round.kind === 'unknown_call' || input.round.kind === 'command_review' || input.round.kind === 'command_rerun'
      || input.round.kind === 'check_review'
      ? [requestId.value, `subject: ${canonicalJson(input.round.subject as unknown as JsonValue)}`].join('\n')
      : input.text;
  return {
    status: 'ready',
    value: {
      input: {
        recipient: input.recipient,
        text,
        needsReply: true,
        goalRef: input.round.goalRef,
        ...((input.round.kind === 'deviation' || input.round.kind === 'unknown_call'
          || input.round.kind === 'command_review' || input.round.kind === 'command_rerun')
          && input.taskRef !== undefined ? { taskRef: input.taskRef } : {}),
        ...(input.round.kind === 'planresume' && input.followupOf !== undefined
          ? { followupOf: input.followupOf } : {}),
      },
      meta: { requestId: requestId.value, expected: [] },
    },
  };
}

/**
 * The submit-tool shape of a planning Query, computed once where the Query is
 * created (§5.2.7 (2)): the sender identity plus the recipient line's duty.
 * The body and the request id are never parsed here, and no sender self-recognizes:
 * the caller passes the round only when `trustedSystemRoundOf` already accepted
 * it (`SystemRoundV1 | null`). A gate's saved overlap-note is classified first
 * and is always the text shape, for both the secretary and the adviser. Only an
 * ordinary agent/platform message then splits by duty: the secretary and the
 * adviser plan, the executor, scribe and reviewer settle text. The Host human's
 * B20 shape is selected only by the caller's already-classified `person` fact
 * (`entry:'person_intervention'` plus the Host human sender), never by the
 * sender alone. `null` is the ordinary platform-message split, never a
 * system-round shape.
 */
export function planningAnswerShapeOf(
  message: {
    sender:
      | { kind: 'host'; actor: { kind: 'human' | 'system'; id: string } }
      | { kind: 'work_run' }
      | { kind: 'secretary_round' }
      | { kind: 'query_run' };
  },
  duty: PlatformDutyV1 | null,
  round: SystemRoundV1 | null,
  overlapNote: boolean,
  /** The caller's stored B20 source fact (Host human plus `entry`); a Host human without it is not a direct intervention. */
  person: boolean,
): PlanningAnswerShapeV1 {
  if (overlapNote) return 'text';
  if (round !== null) {
    // G8B B1d：批检查轮只发给参谋或审阅者。
    if ((duty === 'adviser' || duty === 'reviewer') && round.kind === 'check_review') return 'check_review';
    if (duty === 'reviewer') return round.kind === 'exec_review' ? 'exec_review' : 'plan_review';
    if (duty === 'adviser' && round.kind === 'unknown_call') return 'unknown_call_advice';
    if (duty === 'scribe' && round.kind === 'command_review') return 'scribe_review';
    if (duty === 'adviser' && round.kind === 'command_rerun') return 'command_rerun_advice';
    return duty === 'adviser' || duty === 'secretary' ? 'plan_round' : 'text';
  }
  const sender = message.sender;
  if (person) {
    // B20：没有任务的活跃目标，人发给执行者线的直接干预在这条线上开规划轮，回答带完整计划草稿。
    return duty === 'adviser' || duty === 'secretary' || duty === 'executor' ? 'plan_round' : 'text';
  }
  // The ordinary platform messages (including the automated identities' notifications) split exactly like an
  // agent's message: a secretary/adviser line plans, every other duty settles text.
  if (sender.kind === 'work_run' || sender.kind === 'secretary_round' || sender.kind === 'query_run'
    || (sender.kind === 'host' && sender.actor.kind === 'system')) {
    return duty === 'adviser' || duty === 'secretary' ? 'plan_round' : 'text';
  }
  return 'text';
}
