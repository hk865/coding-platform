/**
 * W2 (Q frozen row; 121-147): an initial (`basedOn: null`) intervention candidate whose source message is withdrawn
 * is stale too, so the queue does not offer `adopt` only because there is no Plan pointer to compare. The adoption
 * still answers `source_stale`, the same guard V-01 (b) already pins.
 *
 * The world and the first-plan proposal are S7B's public steps; `messages/withdraw` is the person's. The queue read
 * uses the candidate's own `requestRef` identity. Today the row is red after the withdrawal: the card is still
 * `candidate` because the stale test only looks at `basedOn`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { candidateCardOf } from '../helpers/Q-candidate-card.js';
import { openS7BPlanningWorld, type S7BPlanningWorld } from '../helpers/S7B3-planning-world.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { firstPlan, interveneS7B, s7bVWorkProfile } from '../helpers/S7B-V-fixture.js';

const worlds: S7BPlanningWorld[] = [];
afterEach(async () => { for (const w of worlds.splice(0)) await w.world.close().catch(() => undefined); });

describe('W2 a withdrawn initial candidate source', () => {
  it('marks the basedOn-null candidate stale and leaves plans/apply refusing it', async () => {
    const planning = await openS7BPlanningWorld();
    worlds.push(planning);
    const { world, noPlanGoalRef, noPlanSessionRef } = planning;
    const second = await sendS7A2PersonMessage(world, { label: 'q-w2', recipient: noPlanSessionRef.ref,
      goal: noPlanGoalRef });
    expect(await interveneS7B(world, second.ref, s7bVWorkProfile())).toEqual({ status: 'progressed', branch: 'no_task',
      stage: 'query' });
    const goalRead = ready<{ goal: { revision: number } }>(await world.post('goals/read',
      plain(S6A_SCOPE, noPlanGoalRef)), 'the Goal');
    const draft = { ...JSON.parse(firstPlan({ label: 'q-w2', taskId: 'q-w2-task',
      role: S6A_WORK_ROLE.templateId })).plan, goalId: noPlanGoalRef.goalId };
    const proposed = committed<{ ref: { proposalId: string }; revision: number }>(await world.post('plans/propose',
      graphWrite(S6A_SCOPE, { goalRef: noPlanGoalRef, basedOn: null, draft,
        reason: { text: 'Q W2 initial adoption', sources: [] },
        requestRef: interventionPlanningQueryRefs(second.ref).queryJobRef, sourceMessageRef: second.ref },
      'q-w2-propose', [{ ref: noPlanGoalRef, revision: goalRead.goal.revision }])), 'the initial proposal');
    const proposalId = proposed.ref.proposalId;

    const before = await world.post('decisions/queue', plain(S6A_SCOPE, { workspace: S6A_SCOPE,
      goalRef: noPlanGoalRef, sections: ['waiting_answer'], page: { limit: 100 } }));
    const beforeBody = before.body as ReadResult<DecisionQueueReadV1>;
    if (beforeBody.status !== 'ready') throw new Error(`the queue before the withdrawal is not ready: ${JSON.stringify(beforeBody)}`);
    expect(candidateCardOf(beforeBody.value, proposalId).candidateStatus).toBe('candidate');

    committed<SessionMessage>(await world.post('messages/withdraw', graphWrite(S6A_SCOPE, { messageRef: second.ref },
      'q-w2-withdraw')), 'the source withdrawal');

    const after = await world.post('decisions/queue', plain(S6A_SCOPE, { workspace: S6A_SCOPE,
      goalRef: noPlanGoalRef, sections: ['waiting_answer'], page: { limit: 100 } }));
    const afterBody = after.body as ReadResult<DecisionQueueReadV1>;
    if (afterBody.status !== 'ready') throw new Error(`the queue after the withdrawal is not ready: ${JSON.stringify(afterBody)}`);
    const card = candidateCardOf(afterBody.value, proposalId);
    expect(card.candidateStatus).toBe('stale');
    expect(card.staleReason).toBe('来源已撤回');
    expect(card.actions).toEqual(['answer', 'regenerate', 'abandon']);

    const applied = await world.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: proposed.ref,
      expectedProposalRevision: proposed.revision, decisionRefs: [] }, 'q-w2-apply', []));
    expect(applied.body).toMatchObject({ status: 'rejected', code: 'source_stale' });
  }, 120_000);
});
