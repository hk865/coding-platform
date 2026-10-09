/** Round-2 group A: production histories and uncapped Store observations. */
import { expect } from 'vitest';
import { decisionSourceKey, type DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';
import type { DecisionCardV1, DecisionReadPort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { PlanProposal, ProposedPlanRequestV1 } from '../../src/core/work-graph/model/plan-contracts.js';
import { decodePlanRevisionSnapshot } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { decodeGoalSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { GOAL_BY_WORKSPACE_INDEX } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import {
  GOAL_B, PROJECT, REQUEST_Q1, T, WORKSPACE, WORKSPACE_SCOPE, type S5DecisionFixture,
} from './S5-decision-fixture.js';
import { committed, decoded, goalAt, keyOf, owners, pin, ready, recordAt } from './S5-application-support.js';

export type Candidate = Extract<PlanProposal, { kind: 'candidate_v2' }>;

export function candidate(proposal: PlanProposal): Candidate {
  expect(proposal.kind).toBe('candidate_v2');
  if (proposal.kind !== 'candidate_v2') throw new Error('expected a v2 candidate');
  return proposal;
}

export const requestKey = () => decisionSourceKey({ kind: 'candidate', goalRef: GOAL_B, requestRef: REQUEST_Q1 });
export const requestCards = (cards: DecisionCardV1[]) => cards.filter(card => card.cardKey === requestKey());
export const proposalPins = (card: DecisionCardV1) => card.source.pins.filter(p => p.ref.aggregateType === 'PlanProposal');

export async function readProposal(f: S5DecisionFixture, proposal: PlanProposal) {
  return candidate(ready(await owners(f).plans.readPlanProposal(f.ctx, proposal.ref)));
}

export async function requestHead(f: S5DecisionFixture) {
  return ready(await owners(f).requests.readRequestCandidate(f.ctx, { goalRef: GOAL_B, requestRef: REQUEST_Q1 }));
}

export async function abandon(f: S5DecisionFixture, proposal: PlanProposal, requestId: string) {
  const goal = await goalAt(f.records, proposal.goalRef);
  const result = committed(await owners(f).requests.abandonPlanProposal(f.ctx, {
    input: { proposalRef: proposal.ref },
    meta: { requestId, expected: [pin(proposal.ref, proposal.revision), pin(goal.ref, goal.revision)] },
  }));
  expect(result.replayed).toBe(false);
  expect(result.value).toMatchObject({ ref: proposal.ref, revision: 2, status: 'not_adopted',
    notAdopted: { reason: 'abandoned', requestedBy: f.operatorActor, at: T, replacedBy: null } });
  expect(await readProposal(f, proposal)).toEqual(result.value);
  return candidate(result.value);
}

/** Release the fixture's existing Q1 slot without deleting its history. */
export async function emptyQ1(f: S5DecisionFixture, requestId: string) {
  await abandon(f, f.candidates.U1, requestId);
  expect(await requestHead(f)).toEqual({ head: null, status: 'closed', closedReason: null });
}

/** Like the frozen fixture's futureDraft: retain every definition, add one
 * future task/assignment to the existing obligations. Read the active snapshot
 * again after adoption; never build PB3 from the fixture's old PB1 draft. */
export async function propose(f: S5DecisionFixture, requestId: string, options: {
  planId: string; goalRef?: GoalRef; requestRef?: QueryJobRef;
  replaces?: NonNullable<ProposedPlanRequestV1['replaces']>;
}) {
  const goalRef = options.goalRef ?? GOAL_B;
  const goal = await goalAt(f.records, goalRef);
  if (goal.activePlanRevision === null) throw new Error('future candidate requires an active Plan');
  const active = decoded(decodePlanRevisionSnapshot(await recordAt(f.records, goal.activePlanRevision)));
  const taskId = `${options.planId}-future`;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: options.planId, planRevision: active.planRevision + 1, goalId: goalRef.goalId,
    stages: structuredClone(active.stages),
    tasks: [...structuredClone(active.tasks), { taskId, title: `Future work for ${options.planId}`,
      taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: [...structuredClone(active.assignments ?? []), { taskId, role: 'builder', instruction: `Execute ${taskId}` }],
    obligations: active.obligations.map(obligation => ({ ...structuredClone(obligation), taskIds: [...obligation.taskIds, taskId] })),
    taskHierarchy: structuredClone(active.taskHierarchy), executionDag: structuredClone(active.executionDag),
    ...(active.schemaVersion === 2 ? {
      taskRelations: structuredClone(active.taskRelations ?? []), inputRequirements: structuredClone(active.inputRequirements ?? []),
    } : {}),
  };
  const result = committed(await owners(f).plans.proposePlan(f.ctx, {
    input: { goalRef, basedOn: active.ref, draft, reason: { text: 'Round-2 queue history', sources: [] },
      ...(options.requestRef === undefined ? {} : { requestRef: options.requestRef }),
      ...(options.replaces === undefined ? {} : { replaces: options.replaces }) },
    meta: { requestId, expected: [pin(goalRef, goal.revision)] },
  }));
  expect(result.replayed).toBe(false);
  expect(result.value).toMatchObject({ kind: 'candidate_v2', goalRef, basedOn: active.ref,
    revision: 1, status: 'candidate', issues: [], draft: { planId: options.planId, planRevision: active.planRevision + 1 } });
  const proposal = candidate(result.value);
  expect(await readProposal(f, proposal)).toEqual(proposal);
  return proposal;
}

export async function adopt(f: S5DecisionFixture, proposal: Candidate, requestId: string) {
  const goal = await goalAt(f.records, proposal.goalRef);
  const result = committed(await owners(f).plans.applyPlanChange(f.ctx, {
    input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] },
    meta: { requestId, expected: [pin(goal.ref, goal.revision)] },
  }));
  expect(result.replayed).toBe(false);
  expect(result.value).toMatchObject({ ref: { aggregateType: 'PlanRevision', projectId: 'P', planId: proposal.draft.planId },
    revision: 1, planRevision: proposal.draft.planRevision });
  expect(await goalAt(f.records, goal.ref)).toMatchObject({ revision: goal.revision + 1, activePlanRevision: result.value.ref });
  const accepted = await readProposal(f, proposal);
  expect(accepted).toMatchObject({ ref: proposal.ref, revision: 2, status: 'accepted' });
  return { plan: result.value, proposal: accepted };
}

export async function readQueue(f: S5DecisionFixture,
  sections: Parameters<DecisionReadPort['queryDecisionQueue']>[1]['sections']) {
  return ready(await owners(f).reads.queryDecisionQueue(f.ctx, {
    workspace: WORKSPACE_SCOPE, goalRef: GOAL_B, sections, page: { limit: 100 },
  }));
}

export async function expectClosedQ1(f: S5DecisionFixture, previous: Candidate, last: Candidate) {
  // The decisive RED assertion is below; prove the real slot and both stored
  // closures first, independently of either decision projection.
  expect(await requestHead(f)).toEqual({ head: null, status: 'closed', closedReason: null });
  expect(await readProposal(f, previous)).toMatchObject({ revision: 2 });
  expect(await readProposal(f, last)).toEqual(last);
  expect(last).toMatchObject({ revision: 2 });
  const before = await f.storeSnapshot();
  const allocations = { ...f.allocationCounts };
  const page = await readQueue(f, ['history']);
  const cards = requestCards(page.history);
  expect(cards).toHaveLength(1);
  const card = cards[0];
  if (card === undefined) throw new Error('Q1 history card is missing');
  const source: DecisionSourceV1 = { kind: 'candidate', key: requestKey(), goalRef: GOAL_B, pins: [] };
  const direct = ready(await owners(f).reads.readDecisionCard(f.ctx, { source }));
  expect(await f.storeSnapshot()).toEqual(before);
  expect(f.allocationCounts).toEqual(allocations);
  // Soft assertions exercise BOTH broken selectors in R2A01/R2A02.
  expect.soft(proposalPins(card)).toEqual([{ ref: last.ref, revision: 2 }]);
  expect.soft(proposalPins(direct)).toEqual([{ ref: last.ref, revision: 2 }]);
  for (const actual of [card, direct]) {
    expect.soft(actual).toMatchObject({ cardKey: requestKey(), requestRef: REQUEST_Q1,
      state: 'closed', closedReason: 'source_resolved', candidateStatus: null, readOnly: true, actions: [] });
    expect.soft(actual.objects.filter(object => object.kind === 'aggregate'
      && keyOf(object.pin.ref) === keyOf(previous.ref))).toEqual([]);
  }
  expect(direct).toEqual(card);
  return page;
}

/** Observe every real index page, including item 5001. Do not use the reader's
 * capped lookup helper to prove the very capacity precondition under test. */
export async function allIndexRecords(f: S5DecisionFixture, index: string,
  values: readonly (string | number | boolean | null)[]): Promise<EncodedRecord[]> {
  const records: EncodedRecord[] = [];
  let after: string | undefined;
  do {
    const page = await f.records.lookup({ index, values, limit: 200,
      ...(after === undefined ? {} : { after }) });
    expect(page.status).toBe('ready');
    if (page.status !== 'ready') throw new Error(`Store lookup failed: ${JSON.stringify(page)}`);
    records.push(...page.value.records);
    after = page.value.next ?? undefined;
  } while (after !== undefined);
  return records;
}

export async function populateGoals(f: S5DecisionFixture, count: 200 | 201) {
  const goals = createGoalService({ records: f.records, now: f.now, eventId: f.newId }).tasks;
  const existing = await allIndexRecords(f, GOAL_BY_WORKSPACE_INDEX, ['P', 'W']);
  expect(existing.map(record => decoded(decodeGoalSnapshot(record)).ref.goalId).sort()).toEqual(['A', 'B', 'C']);
  for (let index = 0; index < count - 3; index += 1) {
    const goalId = `S5R2-capacity-${String(index).padStart(3, '0')}`;
    const created = committed(await goals.createGoal(f.ctx, {
      input: { goalId, workspace: WORKSPACE_SCOPE, objective: `Capacity boundary Goal ${index}` },
      meta: { requestId: `s5r2-create-${goalId}`, expected: [pin(PROJECT, 1), pin(WORKSPACE, 3)] },
    }));
    expect(created.value).toMatchObject({ ref: { aggregateType: 'Goal', projectId: 'P', goalId },
      workspaceRef: WORKSPACE, revision: 1, activePlanRevision: null, desiredState: 'active' });
  }
  const saved = (await allIndexRecords(f, GOAL_BY_WORKSPACE_INDEX, ['P', 'W']))
    .map(record => decoded(decodeGoalSnapshot(record)));
  expect(saved).toHaveLength(count);
  expect(new Set(saved.map(goal => keyOf(goal.ref))).size).toBe(count);
  expect(saved.filter(goal => keyOf(goal.workspaceRef) !== keyOf(WORKSPACE))).toEqual([]);
}
