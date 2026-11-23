/**
 * 一个 Goal 里人的直接干预，执行审阅包只在这里读一次（slice-9 SPEC :187-200）。
 *
 * 直接干预 = 人发、存下的 `entry: 'person_intervention'`、已被这个 Goal 的某个 Work Run 收下的消息；排队中的、
 * 被干预规划 Query 收下的都不列，因为还没有工作照它做。读法：翻这个 Goal 的公开执行列表拿到线和 Task，再翻每条线
 * 的公开收件箱；读失败原样返回，绝不当成“没有干预”。
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { boundedTo, type BoundedTextV1 } from '../../../contracts/continuation-brief.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { SessionMailboxPort, SessionMessage } from '../model/communication-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { hostContextIn, PERSON_WORDS_MAX } from './plan-lineage.js';

/** 最多列这么多条，其余只计数。 */
export const GOAL_PERSON_INTERVENTIONS_MAX = 10;
/** 一个 Run 页和一条收件箱页都用公开读口的上限。 */
const INTERVENTION_PAGE_LIMIT = 100;

export type GoalPersonInterventionV1 = {
  messageRef: SessionMessageRef;
  /** 收下这条消息的 Work Run 和它的 Task。 */
  runRef: RunRef; taskId: string;
  acceptedAt: string;
  /** 人的原话，前 `PERSON_WORDS_MAX` 字。 */
  text: BoundedTextV1;
};
export type GoalPersonInterventionsV1 = { items: GoalPersonInterventionV1[]; omitted: number };

type AcceptedIntervention = Omit<GoalPersonInterventionV1, 'text'>;

function acceptedByHuman(message: SessionMessage): boolean {
  const sender = message.sender;
  return sender.kind === 'host' && sender.actor.kind === 'human' && message.entry === 'person_intervention';
}

/**
 * 读这个 Goal 里人的直接干预：所有被收下的 `entry: 'person_intervention'` 消息，按 `acceptedAt` 取最后
 * `GOAL_PERSON_INTERVENTIONS_MAX` 条（保留的里面最早的在前），带人的原话；`omitted` 是更早没列出的条数。
 */
export async function readGoalPersonInterventions(ctx: CoreCallContext, deps: {
  runs: { listExecutions: NonNullable<ExecutionReadPort['listExecutions']> };
  messages: Pick<SessionMailboxPort, 'readInbox' | 'readMessageBody'>;
}, goalRef: GoalRef): Promise<ReadResult<GoalPersonInterventionsV1>> {
  // 1. 这个 Goal 的全部 Run，记下 Run → Task 和每条线。
  const taskIdByRunId = new Map<string, string>();
  const lines = new Map<string, { session: SessionRef; workspaceId: string }>();
  let afterCursor: string | null = null;
  for (;;) {
    let page: Awaited<ReturnType<typeof deps.runs.listExecutions>>;
    try {
      page = await deps.runs.listExecutions(ctx, { goalRef, page: { afterCursor, limit: INTERVENTION_PAGE_LIMIT } });
    } catch (error) {
      return storeFailureToRejection(error as { code: string; reason: string });
    }
    if (page.status !== 'ready') return page;
    for (const item of page.value.items) {
      const run = item.run;
      const workspaceId = item.session.workspaceId;
      const session: SessionRef = { projectId: item.session.ref.projectId, sessionId: item.session.ref.sessionId };
      taskIdByRunId.set(run.ref.runId, run.task.taskId);
      const key = `${workspaceId}/${session.sessionId}`;
      if (!lines.has(key)) lines.set(key, { session, workspaceId });
    }
    if (page.value.nextCursor === null) break;
    afterCursor = page.value.nextCursor;
  }

  // 2. 每条线的收件箱：只有被这个 Goal 的 Work Run 收下的消息才列。
  const accepted: AcceptedIntervention[] = [];
  for (const line of lines.values()) {
    const inboxCtx = hostContextIn(ctx, line.workspaceId);
    let cursor: string | undefined;
    for (;;) {
      const inbox = await deps.messages.readInbox(inboxCtx, {
        recipient: line.session, page: cursor === undefined
          ? { limit: INTERVENTION_PAGE_LIMIT }
          : { limit: INTERVENTION_PAGE_LIMIT, cursor },
      });
      if (inbox.status !== 'ready') return inbox;
      for (const message of inbox.value.items) {
        const evidence = message.deliveryEvidence;
        if (evidence === null || !acceptedByHuman(message)) continue;
        const execution = evidence.executionRef;
        if (execution.aggregateType !== 'Run') continue;
        if (execution.projectId !== goalRef.projectId || execution.goalId !== goalRef.goalId) continue;
        const taskId = taskIdByRunId.get(execution.runId);
        if (taskId === undefined) continue;
        accepted.push({ messageRef: message.ref, runRef: execution, taskId, acceptedAt: evidence.acceptedAt });
      }
      if (inbox.value.nextCursor === null) break;
      cursor = inbox.value.nextCursor;
    }
  }

  // 3. 保留最新的十条（旧的在前），其余只计数。
  accepted.sort((left, right) => left.acceptedAt < right.acceptedAt ? -1 : left.acceptedAt > right.acceptedAt ? 1 : 0);
  const kept = accepted.slice(-GOAL_PERSON_INTERVENTIONS_MAX);
  const items: GoalPersonInterventionV1[] = [];
  for (const item of kept) {
    const body = await deps.messages.readMessageBody(hostContextIn(ctx, item.messageRef.workspaceId),
      { messageRef: item.messageRef, part: 'message' });
    if (body.status !== 'ready') return body;
    items.push({ ...item, text: boundedTo(body.value.text, PERSON_WORDS_MAX) });
  }
  return { status: 'ready', value: { items, omitted: accepted.length - kept.length } };
}
