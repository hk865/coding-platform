import { expect } from 'vitest';
import type { DecisionCardV1 } from '../../../src/core/work-graph/model/decision-contracts.js';
import { plain } from '../../helpers/AG2b-collaboration-fixture.js';
import { proposalRefOf } from '../../helpers/IV-host-fixture.js';
import {
  interveneUntilSettled, openIpfWorld, readIpfQueue, sendIntervention, type IpfWorld,
} from '../../helpers/IPF-world.js';
import { candidateCardOf } from '../../helpers/Q-candidate-card.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../../helpers/S6A-request-fixture.js';
import { refinementPlan } from '../../helpers/S7B-V-fixture.js';
import type { SessionMessage } from '../../../src/core/work-graph/model/communication-contracts.js';

/**
 * GAPA1 1a: one intervention candidate on the IPF world (the Q W1 world the
 * frozen row names). The done line's planning turn proposes one new work Task,
 * so the candidate card is waiting with a live proposal, and its plan read is
 * the reason text the card's 理由 fact must show.
 */
export type IpfCandidate = {
  w: IpfWorld;
  card: DecisionCardV1;
  messageRef: SessionMessage['ref'];
  /** The plan task's title (`refinementPlan` names it `S7B3 V <taskId> work`). */
  taskTitle: string;
  /** The proposal's own `reason.text`, read through the public `plans/proposal`. */
  reasonText: string;
};

export async function openIpfCandidate(label: string): Promise<IpfCandidate> {
  const w = await openIpfWorld(label);
  try {
    const taskId = `${label}-new`;
    await w.world.scripted.script(w.done, [{ kind: 'text', text: await refinementPlan(w.world, w.goal,
      { label, taskId, role: S6A_WORK_ROLE.templateId }) }]);
    const sent = await sendIntervention(w, { label, recipient: w.done, goalRef: w.goal });
    expect(await interveneUntilSettled(w, sent.ref), 'the intervention writes a candidate').toMatchObject({
      status: 'awaiting_decision' });
    const queue = await readIpfQueue(w);
    if (queue.status !== 'ready') throw new Error(`GAPA1: the queue is not ready: ${JSON.stringify(queue)}`);
    const proposalRef = proposalRefOf(sent.ref, w.goal);
    const card = candidateCardOf(queue.value, proposalRef.proposalId);
    const proposal = await w.world.post('plans/proposal', plain(S6A_SCOPE, proposalRef)) as
      { body?: { value?: { reason?: { text?: string } } } };
    const reasonText = proposal.body?.value?.reason?.text ?? '';
    if (reasonText === '') throw new Error(`GAPA1: the candidate carries no reason: ${JSON.stringify(proposal.body)}`);
    return { w, card, messageRef: sent.ref, taskTitle: `S7B3 V ${taskId} work`, reasonText };
  } catch (error) {
    await w.world.close().catch(() => undefined);
    throw error;
  }
}
