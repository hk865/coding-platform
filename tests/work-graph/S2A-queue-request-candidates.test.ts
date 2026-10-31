/**
 * Group Q (slice 2A) QA-09(二): one request with more candidates than the old
 * `findCandidateProposal` window still resolves through both public reads.
 *
 * Small daily version: 5 seeded candidates on request Q1, with the direct card
 * read and the queue's candidate enumeration narrowed to 4-item lookup pages;
 * the live (last) candidate `S2AQ09-4` is the fifth item, so it sits on the last
 * page of both layers. The 5,001-candidate scale run (and its seeded-fixture
 * deviation note) lives in `S2A-queue-request-candidates.scale.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { decodePlanRevisionSnapshot } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { GOAL_B, OPERATOR, PLAN_B1, REQUEST_Q1, T, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { ready, owners, decoded, recordAt } from '../helpers/S5-application-support.js';
import { proposalPins, readQueue, requestCards, requestKey } from '../helpers/S5R2-a-support.js';

const CANDIDATES = 5;
/** Small daily widths: the direct A lookup and the queue's B′ enumeration both read 4 per page. */
const SMALL_WIDTHS = { decision: { lookupPageLimit: 4 } };

describe.each(['memory', 'sqlite'] as const)('S2A request candidates (%s)', (kind) => {
  const opened: S5DecisionFixture[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
  const open = async () => {
    const f = await openS5DecisionFixture(kind, { operatorActor: { ...OPERATOR } });
    opened.push(f);
    return f;
  };

  it('QA-09 (二) (small: 5 candidates, page 4) - 5 candidates on one request resolve to the live head through card and queue', async () => {
    const f = await open();
    const active = decoded(decodePlanRevisionSnapshot(await recordAt(f.records, PLAN_B1)));
    const futureTask = 'pqa09-future';
    const draft: PlanRevisionDraft = {
      schemaVersion: 2, planId: 'PQA09', planRevision: active.planRevision + 1, goalId: GOAL_B.goalId,
      stages: structuredClone(active.stages),
      tasks: [...structuredClone(active.tasks), { taskId: futureTask, title: 'Future work for PQA09',
        taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
      assignments: [...structuredClone(active.assignments ?? []), { taskId: futureTask, role: 'builder', instruction: 'Execute PQA09' }],
      obligations: active.obligations.map((obligation) => ({ ...structuredClone(obligation),
        taskIds: [...obligation.taskIds, futureTask] })),
      taskHierarchy: structuredClone(active.taskHierarchy), executionDag: structuredClone(active.executionDag),
      ...(active.schemaVersion === 2 ? { taskRelations: structuredClone(active.taskRelations ?? []),
        inputRequirements: structuredClone(active.inputRequirements ?? []) } : {}),
    };
    const proposalRef = (index: number) => ({ aggregateType: 'PlanProposal' as const, projectId: 'P', workspaceId: 'W',
      proposalId: `S2AQ09-${String(index)}` });
    const proposal = (index: number): PlanProposal => {
      const live = index === CANDIDATES - 1;
      return {
        kind: 'candidate_v2',
        ref: proposalRef(index),
        // M4: the public replacement writer (plan-machine.ts:1639) leaves each
        // replaced candidate at revision 2, status `not_adopted`, with
        // `notAdopted.replacedBy` naming the next candidate; only the last one
        // stays a live revision-1 candidate.
        revision: live ? 1 : 2, schemaVersion: 2, goalRef: GOAL_B, basedOn: PLAN_B1, draft: structuredClone(draft),
        reason: { text: `Seeded candidate ${String(index)}`, sources: [] },
        status: live ? 'candidate' : 'not_adopted', issues: [], catalogPin: f.catalogPin, requestRef: REQUEST_Q1,
        sourceMessageRef: null,
        ...(live ? {} : { notAdopted: { reason: 'replaced', requestedBy: { ...OPERATOR }, at: T,
          replacedBy: proposalRef(index + 1) } }),
      } as PlanProposal;
    };
    const liveRef = proposalRef(CANDIDATES - 1);
    for (let index = 0; index < CANDIDATES; index += 1) {
      const receipt = await f.seedCandidateProposal(proposal(index));
      if (receipt.status !== 'committed') throw new Error(`seed failed: ${JSON.stringify(receipt)}`);
    }

    // Direct card read (seam A): the request lookup sees the fixture's U1 plus
    // the 5 seeded candidates on Q1 = 6 items at width 4 -> pages 4 + 2. Byte
    // order: S2AQ09-0, S2AQ09-1, S2AQ09-2, S2AQ09-3, S2AQ09-4, U1; the live
    // S2AQ09-4 is the fifth item, on the last page.
    const key = requestKey();
    const direct = ready(await owners(f, f.records, f.bodies, SMALL_WIDTHS).reads.readDecisionCard(f.ctx,
      { source: { kind: 'candidate', key, subject: { kind: 'goal', goalRef: GOAL_B }, pins: [] } }));
    expect(direct).toMatchObject({ cardKey: key, requestRef: REQUEST_Q1, state: 'waiting_answer',
      candidateStatus: 'candidate' });
    expect(proposalPins(direct)).toEqual([{ ref: liveRef, revision: 1 }]);
    // Queue enumeration (seam B′): the Goal-B proposal index sees the fixture's
    // accepted PB1, its U1/U2, plus the 5 seeded = 8 items at width 4 -> pages
    // 4 + 4. Byte order: S2AQ09-0, S2AQ09-1, S2AQ09-2, S2AQ09-3, S2AQ09-4, U1
    // (plan-proposal-0798…), U2 (plan-proposal-a9aa…), PB1
    // (plan-proposal-fd93…); the live S2AQ09-4 is the fifth item, on the last
    // page.
    const queue = await readQueue(f, ['waiting_answer'], SMALL_WIDTHS);
    const queued = requestCards(queue.waitingAnswer);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toEqual(direct);
  });
});
