import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { GoalRef } from '../contracts/ledger.js';
import type { SessionRef, WorkspaceScope } from '../contracts/core/identity.js';
import type { SessionMessageRef } from '../contracts/core/session-message.js';
import type {
  SendMessageResultV1, SessionMessageCommandPort, SessionMessageSendInputV1,
} from '../core/work-graph/model/communication-contracts.js';
import type { SessionFactsPort } from '../core/work-graph/model/session-facts-contracts.js';
import type { NodeDetailReadPort } from '../core/work-graph/model/work-line-contracts.js';
import { canonicalKey } from '../contracts/fingerprint.js';
import { STOPPED_BEFORE_ENTRY } from '../contracts/query-job.js';
import { interventionClosingNoticeRequestId,
  type InterventionClosingReasonV1 } from '../business/workflow/intervention.js';
import { readDisconnectFacts,
  type DisconnectNoticeSourceDependencies } from '../core/work-graph/views/disconnect-notices.js';

/** The ONE Host system-notify request builder: recipient, deterministic request id, empty expected set. */
export function systemNotifyRequest(input: {
  recipient: SessionRef; text: string; requestId: string; goalRef?: GoalRef | null;
}): SessionMessageSendInputV1 {
  return {
    // A platform notice never wakes the line: `wake:false` keeps it out of the `agent_wake` class and opens no round.
    input: { recipient: input.recipient, text: input.text, wake: false,
      ...(input.goalRef === undefined || input.goalRef === null ? {} : { goalRef: input.goalRef }) },
    meta: { requestId: input.requestId, expected: [] },
  };
}


/**
 * The lead's fixed closing sentences: exactly one per reason, and `questions` sends none (the cards say it). A
 * round that writes a reply (`part: 'message'` and `needsReply:true`) carries its content there, so these sentences
 * point at it; every round without a reply slot (a card-answer round, a `needsReply:false` message round) gets the
 * sentences below that never point at a reply.
 */
const MESSAGE_ROUND_CLOSING_NOTICE_TEXTS = {
  invalid_plan: '这次规划没有形成可采用的计划，模型的原回答在回复里。可以补充要求后重新发送。',
  declined: '这次规划的方案没有采用，原回答在回复里。可以补充要求后重新发送。',
  // PL-1's planning-round endings: a review answer, a written candidate and an
  // adoption each end the system round; the reply/card carries the content.
  answered: '这次规划已有结论，模型的回答在回复里。',
  candidate: '这次规划已写入候选，采用前可以继续补充要求。',
  adopted: '这次规划已经采用，计划的内容在候选卡和回复里。',
} as const satisfies Record<Exclude<InterventionClosingReasonV1, 'no_answer'>, string>;

/** A round with no reply slot's fixed sentences: same endings, without a reply the round never writes. */
const NO_REPLY_SLOT_CLOSING_NOTICE_TEXTS = {
  invalid_plan: '这次规划没有形成可采用的计划。可以补充要求后重新发送。',
  declined: '这次规划的方案没有采用。可以补充要求后重新发送。',
  answered: '这次规划已有结论。',
  candidate: '这次规划已写入候选，采用前可以继续补充要求。',
  adopted: '这次规划已经采用，计划的内容在候选卡里。',
} as const satisfies Record<Exclude<InterventionClosingReasonV1, 'no_answer'>, string>;

/**
 * The `no_answer` ending: the other side ended this round without a reply. Only the person's B20 source is withdrawn
 * afterwards; an agent's message is not withdrawn (its sender's wait expires on its own), so only that source says so.
 */
function noAnswerText(withdrawSource: boolean, notStarted: string | undefined): string {
  // P6I: a round the Host ended on purpose before it entered never ran; the notice says so and why.
  const ending = notStarted === undefined ? '对方这一轮结束，没有回复。'
    : `这一轮没能开始：${notStarted === STOPPED_BEFORE_ENTRY ? '已被停下' : notStarted}。`;
  return withdrawSource ? `${ending}这条消息已撤回。请补充要求后重新发送。` : `${ending}请补充要求后重新发送。`;
}

/** The ONE Host closing notice of an intervention: the fixed text, the original line, the frozen source part and
 *  the fixed request id (a card-answer round has its own part, so it never collides with the message round). The
 *  notice binds no Goal: a cancelled or paused Goal must not refuse or withhold the close-out (design 2.3/2.6). */
export function interventionClosingNoticeRequest(input: {
  recipient: SessionRef; messageRef: SessionMessageRef; reason: InterventionClosingReasonV1;
  part?: 'message' | 'decision_answer';
  /** This round writes a reply (`part: 'message'` and `needsReply:true`); only then may the text point at it. */
  hasReplySlot: boolean;
  /** The person's B20 source is withdrawn after the notice; every other source is not. */
  withdrawSource?: boolean;
  /** A `no_answer` round the Host ended on purpose before entry: its close message (P6I). */
  notStarted?: string;
}): SessionMessageSendInputV1 {
  const text = input.reason === 'no_answer' ? noAnswerText(input.withdrawSource === true, input.notStarted)
    : input.hasReplySlot ? MESSAGE_ROUND_CLOSING_NOTICE_TEXTS[input.reason]
    : NO_REPLY_SLOT_CLOSING_NOTICE_TEXTS[input.reason];
  return systemNotifyRequest({ recipient: input.recipient, text,
    requestId: interventionClosingNoticeRequestId(input.messageRef, input.reason, input.part) });
}

export type HostNoticeDependencies = {
  messages: Pick<SessionMessageCommandPort, 'sendMessage'>;
  /** The same fact read the projection uses; the Host scans no wait of its own. */
  disconnect: DisconnectNoticeSourceDependencies;
  /** The interruption party set only (`announceInterruption`). */
  facts: Pick<SessionFactsPort, 'readSessionFacts'>;
  nodeDetail: Pick<NodeDetailReadPort, 'readNodeDetail'>;
};

/** One `notify` to each side of every disconnect fact whose `party` is the line that just went away. */
export async function announceDisconnect(ctx: CoreCallContext, deps: HostNoticeDependencies,
  input: { scope: WorkspaceScope; sessionRef: SessionRef }): Promise<SendMessageResultV1[]> {
  const facts = await readDisconnectFacts(deps.disconnect, ctx, input.scope);
  if (facts.status !== 'ready') return [];   // the next Session commit or start retries; a failed read sends nothing
  const results: SendMessageResultV1[] = [];
  for (const fact of facts.value) {
    if (canonicalKey(fact.party) !== canonicalKey(input.sessionRef)) continue;
    const text = `断开通知 · Session ${fact.party.sessionId} · ${fact.occurredAt} · ${fact.successor?.sessionId ?? '没人接，等你定'}`;
    results.push(await deps.messages.sendMessage(ctx, systemNotifyRequest({ recipient: fact.party, text,
      requestId: `disconnect:${fact.operationKey}:${canonicalKey(fact.messageRef)}:${fact.side}`,
      goalRef: fact.goalRef })));
    if (fact.counterparty !== null) {
      results.push(await deps.messages.sendMessage(ctx, systemNotifyRequest({ recipient: fact.counterparty, text,
        requestId: `disconnect:${fact.operationKey}:${canonicalKey(fact.messageRef)}:${fact.side === 'waiting' ? 'recipient' : 'waiting'}`,
        goalRef: fact.goalRef })));
    }
  }
  return results;
}

/** One `notify` to each deduped party of the interrupted line's open wait (the set in §4.3). */
export async function announceInterruption(ctx: CoreCallContext,
  deps: Pick<HostNoticeDependencies, 'messages' | 'facts' | 'nodeDetail'>,
  input: { scope: WorkspaceScope; sessionRef: SessionRef; personMessageRef: SessionMessageRef }): Promise<SendMessageResultV1[]> {
  const facts = await deps.facts.readSessionFacts(ctx, input.sessionRef);
  if (facts.status !== 'ready') return [];
  const parties = new Map<string, SessionRef>();
  for (const wait of facts.value.waits) {
    if (wait.state.state !== 'open') continue;
    parties.set(canonicalKey(wait.waitingSession), wait.waitingSession);
    if (!('kind' in wait.recipient)) parties.set(canonicalKey(wait.recipient), wait.recipient);
  }
  // An interruption with no open wait has no interruption party: the latest Work's owners are not a substitute.
  if (parties.size === 0) return [];
  const work = facts.value.latestWork;
  if (work !== null) {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: work.task.projectId, goalId: work.task.goalId };
    const goal = await deps.nodeDetail.readNodeDetail(ctx, { goalRef, node: { kind: 'goal', ref: goalRef },
      section: 'summary', page: { afterCursor: null, limit: 100 } });
    if (goal.status === 'ready' && goal.value.section === 'summary' && goal.value.group !== null) {
      for (const owner of goal.value.group.owners) parties.set(canonicalKey(owner.key), owner.key);
    }
    let afterCursor: string | null = null;
    do {
      const task = await deps.nodeDetail.readNodeDetail(ctx, { goalRef,
        node: { kind: 'task', ref: work.task, planRef: work.planRef },
        section: 'participants', page: { afterCursor, limit: 100 } });
      if (task.status !== 'ready' || task.value.section !== 'participants') break;
      for (const item of task.value.items) {
        if (item.duty === 'adviser') parties.set(canonicalKey(item.key), item.key);
      }
      afterCursor = task.value.nextCursor;
    } while (afterCursor !== null);
  }
  const text = `中断通知 · Session ${input.sessionRef.sessionId} 已被人工中断`;
  const results: SendMessageResultV1[] = [];
  for (const party of parties.values()) {
    results.push(await deps.messages.sendMessage(ctx, systemNotifyRequest({ recipient: party, text,
      requestId: `interrupt:${canonicalKey(input.personMessageRef)}:${canonicalKey(party)}` })));
  }
  return results;
}
