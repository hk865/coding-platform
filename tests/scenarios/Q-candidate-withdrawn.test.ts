/**
 * W1 (Q frozen row; 121-147): once the source message of a live candidate is withdrawn, the queue and the single
 * card both read `candidateStatus: 'stale'`, the reason literally "来源已撤回", and the actions lose `adopt`; the
 * adoption itself still answers `source_stale`. The source proves the same fact both adoption arms check.
 *
 * The world is IPF's public world (a done line, an intervention, the candidate it writes); the withdrawal is the
 * person's real `messages/withdraw`. Today the row is red after the withdrawal: both reads still say `candidate`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { candidateCardOf } from '../helpers/Q-candidate-card.js';
import { proposalRefOf } from '../helpers/IV-host-fixture.js';
import {
  interveneUntilSettled, openIpfWorld, readIpfQueue, sendIntervention, type IpfWorld,
} from '../helpers/IPF-world.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { refinementPlan } from '../helpers/S7B-V-fixture.js';

const worlds: IpfWorld[] = [];
afterEach(async () => { for (const w of worlds.splice(0)) await w.world.close().catch(() => undefined); });

function singleCardOf(result: ReadResult<DecisionCardV1>): DecisionCardV1 {
  if (result.status !== 'ready') throw new Error(`the single card is not ready: ${JSON.stringify(result)}`);
  return result.value;
}

describe('W1 a withdrawn candidate source', () => {
  it('turns the queue and the single card stale and keeps plans/apply refusing the source', async () => {
    const w = await openIpfWorld('q-w1');
    worlds.push(w);
    await w.world.scripted.script(w.done, [{ kind: 'text', text: await refinementPlan(w.world, w.goal,
      { label: 'q-w1', taskId: 'q-w1-new', role: S6A_WORK_ROLE.templateId }) }]);
    const sent = await sendIntervention(w, { label: 'q-w1', recipient: w.done, goalRef: w.goal });
    const settled = await interveneUntilSettled(w, sent.ref);
    expect(settled.status, 'the intervention writes a candidate').toBe('awaiting_decision');
    const proposalRef = proposalRefOf(sent.ref, w.goal);
    const proposal = await w.world.post('plans/proposal', plain(S6A_SCOPE, proposalRef));
    if ((proposal.body as ReadResult<PlanProposal>).status !== 'ready') {
      throw new Error(`the candidate is not readable: ${JSON.stringify(proposal.body)}`);
    }
    const proposalValue = (proposal.body as Extract<ReadResult<PlanProposal>, { status: 'ready' }>).value;

    const before = await readIpfQueue(w);
    if (before.status !== 'ready') throw new Error(`the queue before the withdrawal is not ready: ${JSON.stringify(before)}`);
    const beforeCard = candidateCardOf(before.value, proposalRef.proposalId);
    expect(beforeCard.candidateStatus).toBe('candidate');
    expect(beforeCard.actions).toContain('adopt');
    const beforeSingle = singleCardOf((await w.world.post('decisions/card',
      plain(S6A_SCOPE, { source: beforeCard.source }))).body as ReadResult<DecisionCardV1>);
    expect(beforeSingle).toMatchObject({ candidateStatus: 'candidate', actions: expect.arrayContaining(['adopt']) });

    const withdrawn = await w.world.post('messages/withdraw', graphWrite(S6A_SCOPE, { messageRef: sent.ref },
      'q-w1-withdraw'));
    expect(withdrawn.body).toMatchObject({ status: 'committed', value: { withdrawnAt: expect.any(String) } });

    const after = await readIpfQueue(w);
    if (after.status !== 'ready') throw new Error(`the queue after the withdrawal is not ready: ${JSON.stringify(after)}`);
    const afterCard = candidateCardOf(after.value, proposalRef.proposalId);
    expect(afterCard.candidateStatus).toBe('stale');
    expect(afterCard.staleReason).toBe('来源已撤回');
    expect(afterCard.actions).toEqual(['answer', 'regenerate', 'abandon']);
    const single = singleCardOf((await w.world.post('decisions/card', plain(S6A_SCOPE, { source: afterCard.source }))).body as
      ReadResult<DecisionCardV1>);
    expect(single).toMatchObject({ candidateStatus: 'stale', staleReason: '来源已撤回',
      actions: ['answer', 'regenerate', 'abandon'] });

    const applied = await w.world.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef, expectedProposalRevision: proposalValue.revision, decisionRefs: [],
    }, 'q-w1-apply', []));
    expect(applied.body).toMatchObject({ status: 'rejected', code: 'source_stale' });
  }, 120_000);
});
