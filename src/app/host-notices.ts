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
import { readDisconnectFacts,
  type DisconnectNoticeSourceDependencies } from '../core/work-graph/views/disconnect-notices.js';

/** The ONE Host system-notify request builder: intent, recipient, deterministic request id, empty expected set. */
export function systemNotifyRequest(input: {
  recipient: SessionRef; text: string; requestId: string; goalRef?: GoalRef | null;
}): SessionMessageSendInputV1 {
  return {
    input: { recipient: input.recipient, text: input.text, intent: 'notify',
      ...(input.goalRef === undefined || input.goalRef === null ? {} : { goalRef: input.goalRef }) },
    meta: { requestId: input.requestId, expected: [] },
  };
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
