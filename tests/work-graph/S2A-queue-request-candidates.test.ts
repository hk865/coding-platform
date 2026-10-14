/**
 * Group Q (slice 2A) QA-09(二): one request with more candidates than the old
 * `findCandidateProposal` window still resolves through both public reads.
 *
 * DEVIATION from L-fixtures (UNSPECIFIED, proposed third exception; coordinator
 * ruled the seeded fixture acceptable only if the public path is infeasible
 * within P12's 600 s). The public path WAS tried: `proposePlan` with `requestRef`
 * (via `S5R2-a-support.propose`) once per candidate. It is O(n^2) because every
 * call runs `readRequestCandidateHead` -> `readLookupKeys(S5_PLAN_PROPOSAL_BY_REQUEST)`,
 * which 2A reads to the end. Measured: 1,549 ms for 200 candidates; the 5,001
 * run was killed after ~23 min without finishing on memory. The bulk rows are
 * therefore committed once at the fixture's storage boundary
 * (`seedCandidateProposal`), exactly like the QA-11 exception; every ASSERTION
 * still goes through `readDecisionCard` / `queryDecisionQueue`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { decodePlanRevisionSnapshot } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { GOAL_B, OPERATOR, PLAN_B1, REQUEST_Q1, T, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { ready, owners, decoded, recordAt } from '../helpers/S5-application-support.js';
import { proposalPins, readQueue, requestCards, requestKey } from '../helpers/S5R2-a-support.js';
import { S2A_SCALE_TIMEOUT_MS } from '../helpers/S2A-queue-fixture.js';

const CANDIDATES = 5_001;

describe.each(['memory', 'sqlite'] as const)('S2A request candidates (%s)', (kind) => {
  const opened: S5DecisionFixture[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
  const open = async () => {
    const f = await openS5DecisionFixture(kind, { operatorActor: { ...OPERATOR } });
    opened.push(f);
    return f;
  };

  it('QA-09 (二) - 5001 candidates on one request resolve to the live head through card and queue', async () => {
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
        status: live ? 'candidate' : 'not_adopted', issues: [], requestRef: REQUEST_Q1,
        ...(live ? {} : { notAdopted: { reason: 'replaced', requestedBy: { ...OPERATOR }, at: T,
          replacedBy: proposalRef(index + 1) } }),
      } as PlanProposal;
    };
    const liveRef = proposalRef(CANDIDATES - 1);
    for (let index = 0; index < CANDIDATES; index += 1) {
      const receipt = await f.seedCandidateProposal(proposal(index));
      if (receipt.status !== 'committed') throw new Error(`seed failed: ${JSON.stringify(receipt)}`);
    }

    const key = requestKey();
    const direct = ready(await owners(f).reads.readDecisionCard(f.ctx,
      { source: { kind: 'candidate', key, goalRef: GOAL_B, pins: [] } }));
    expect(direct).toMatchObject({ cardKey: key, requestRef: REQUEST_Q1, state: 'waiting_answer',
      candidateStatus: 'candidate' });
    expect(proposalPins(direct)).toEqual([{ ref: liveRef, revision: 1 }]);
    const queue = await readQueue(f, ['waiting_answer']);
    const queued = requestCards(queue.waitingAnswer);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toEqual(direct);
  }, S2A_SCALE_TIMEOUT_MS);
});
