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
  SYSTEM_ROUND_ACTOR, systemRoundRequestId,
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
    : input.text;
  return {
    status: 'ready',
    value: {
      input: {
        recipient: input.recipient,
        text,
        intent: 'action_request',
        needsReply: true,
        goalRef: input.round.goalRef,
        ...(input.round.kind === 'deviation' && input.taskRef !== undefined
          ? { taskRef: input.taskRef } : {}),
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
 * The body and the request id are never parsed here; unknown combinations are
 * the ordinary text answer.
 */
export function planningAnswerShapeOf(
  message: {
    sender:
      | { kind: 'host'; actor: { kind: 'human' | 'system'; id: string } }
      | { kind: 'work_run' }
      | { kind: 'secretary_round' };
    intent?: 'notify' | 'inquiry' | 'action_request' | 'decision_request';
  },
  duty: PlatformDutyV1 | null,
): PlanningAnswerShapeV1 {
  if (message.intent !== 'action_request') return 'text';
  const sender = message.sender;
  if (sender.kind === 'host' && sender.actor.kind === 'system') {
    if (sender.actor.id !== SYSTEM_ROUND_ACTOR.id) return 'text';
    return duty === 'reviewer' ? 'plan_review' : duty === 'adviser' || duty === 'secretary' ? 'plan_round' : 'text';
  }
  if (sender.kind === 'host' && sender.actor.kind === 'human') {
    return duty === 'adviser' || duty === 'secretary' ? 'plan_round' : 'text';
  }
  if (sender.kind === 'work_run' || sender.kind === 'secretary_round') {
    return duty === 'adviser' || duty === 'secretary' ? 'plan_round' : 'text';
  }
  return 'text';
}
