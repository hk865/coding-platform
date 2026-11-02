/**
 * PL accepted cursor (slice-PL-SPEC §6.4.2; ruling D of the PL P1 second
 * stage): an adopted `PlanProposal` carries the top-level wire field `until`,
 * filled by the adoption commit's own cursor. The expected cursor is the value
 * the real `plans/apply` receipt returns, never a stored constant.
 *
 * The world is the established real Plan/Goal/Store harness
 * (`createTaskClaimFixture`): Project, Workspace, completion policy and the
 * architecture baseline come from the public bootstrap; the Goal, candidate
 * and adopted Plan come from the real Goal/Plan owners. Scratch storage is a
 * per-test temporary directory provided by that same fixture.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';
import {
  decodePlanProposalOrigin,
  decodePlanProposalRecord,
} from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { storedRecord } from '../helpers/S5-queue-support.js';
import {
  createTaskClaimFixture,
  type TaskClaimFixture,
} from '../helpers/task-claim-fixture.js';

function acceptedCursorDraft(goalId: string, planId: string): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId, planRevision: 1, goalId, stages: [],
    tasks: [
      { taskId: 'work-a', title: 'Work A', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'gate-goal', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'work-a', role: 'builder', instruction: 'Do work A' }],
    obligations: [{
      obligationId: 'obligation-1', title: 'Deliver', requirementLevel: 'required',
      taskIds: ['work-a', 'gate-goal'],
      verificationRequirements: [{ requirementId: 'check-1', requirementLevel: 'required',
        kind: 'test', description: 'Tests pass' }],
    }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
  };
}

describe.each(['memory', 'sqlite'] as const)('PL accepted cursor (%s)', (kind) => {
  let fixture: TaskClaimFixture;

  beforeAll(async () => {
    fixture = await createTaskClaimFixture(kind);
  });
  afterAll(async () => {
    await fixture.close();
  });

  async function createCursorGoal(goalId: string): Promise<GoalSnapshot> {
    const created = await fixture.goals.createGoal(fixture.ctx, {
      meta: { requestId: `PL-cursor-goal-${goalId}`, expected: [
        { ref: fixture.projectRef, revision: 1 }, { ref: fixture.workspaceRef, revision: 1 },
      ] },
      input: { goalId, workspace: fixture.scope, objective: 'PL accepted cursor' },
    });
    if (created.status !== 'committed') {
      throw new Error(`PL accepted cursor: Goal creation failed: ${JSON.stringify(created)}`);
    }
    return created.value;
  }

  async function proposeInitialCandidate(goal: GoalSnapshot, planId: string, requestId: string): Promise<PlanProposal> {
    const proposed = await fixture.plans.proposePlan(fixture.ctx, {
      meta: { requestId, expected: [{ ref: goal.ref, revision: goal.revision }] },
      input: { goalRef: goal.ref, basedOn: null, draft: acceptedCursorDraft(goal.ref.goalId, planId),
        reason: { text: 'PL accepted cursor candidate', sources: [] } },
    });
    if (proposed.status !== 'committed') {
      throw new Error(`PL accepted cursor: Plan proposal failed: ${JSON.stringify(proposed)}`);
    }
    return proposed.value;
  }

  async function apply(goal: GoalSnapshot, proposal: PlanProposal, requestId: string) {
    return fixture.plans.applyPlanChange(fixture.ctx, {
      meta: { requestId, expected: [{ ref: goal.ref, revision: goal.revision }] },
      input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] },
    });
  }

  it('plans/apply adopts a candidate and the stored until is the apply receipt cursor', async () => {
    const goal = await createCursorGoal('PL-cursor-adopt');
    const proposal = await proposeInitialCandidate(goal, 'PL-cursor-adopt-plan', 'PL-cursor-adopt-propose');
    const applied = await apply(goal, proposal, 'PL-cursor-adopt-apply');
    expect(applied).toMatchObject({ status: 'committed', replayed: false });
    if (applied.status !== 'committed') throw new Error('PL accepted cursor: adoption failed');

    const record = await storedRecord(fixture.records, proposal.ref);
    const origin = decodePlanProposalOrigin(record);
    expect(origin).toMatchObject({ status: 'decoded' });
    if (origin.status !== 'decoded') throw new Error('PL accepted cursor: the stored origin is invalid');
    // The wire cursor is the adoption receipt's cursor, not the candidate's
    // creation cursor and not a system-internal constant.
    expect(origin.value.until).toBe(applied.cursor);
    expect(origin.value.until).not.toBe(origin.value.since);
    const dto = decodePlanProposalRecord(record);
    if (dto.status !== 'decoded') throw new Error('PL accepted cursor: the stored proposal is invalid');
    expect(dto.value).not.toHaveProperty('until');

    // §6.4.2: only the adoption commit's cursor is legal. A persisted null (the
    // PreparedCommit placeholder) is invalid; a pre-field record still reads.
    const wire = JSON.parse(JSON.stringify(record)) as EncodedRecord;
    const parsed = JSON.parse(wire.json) as Record<string, unknown>;
    expect(decodePlanProposalOrigin({ ...wire, json: JSON.stringify({ ...parsed, until: null }) }))
      .toMatchObject({ status: 'invalid' });
    const legacy = { ...parsed };
    delete legacy['until'];
    const legacyOrigin = decodePlanProposalOrigin({ ...wire, json: JSON.stringify(legacy) });
    expect(legacyOrigin).toMatchObject({ status: 'decoded' });
    if (legacyOrigin.status !== 'decoded') throw new Error('PL accepted cursor: a legacy record must decode');
    expect(legacyOrigin.value).not.toHaveProperty('until');
  });

  it('replaying the same apply leaves the stored until on the first commit cursor', async () => {
    const goal = await createCursorGoal('PL-cursor-replay');
    const proposal = await proposeInitialCandidate(goal, 'PL-cursor-replay-plan', 'PL-cursor-replay-propose');
    const applied = await apply(goal, proposal, 'PL-cursor-replay-apply');
    expect(applied).toMatchObject({ status: 'committed', replayed: false });
    if (applied.status !== 'committed') throw new Error('PL accepted cursor: adoption failed');
    const first = decodePlanProposalOrigin(await storedRecord(fixture.records, proposal.ref));
    if (first.status !== 'decoded') throw new Error('PL accepted cursor: the first origin is invalid');
    expect(first.value.until).toBe(applied.cursor);

    const replay = await apply(goal, proposal, 'PL-cursor-replay-apply');
    expect(replay).toMatchObject({ status: 'committed', replayed: true, cursor: applied.cursor });
    const second = decodePlanProposalOrigin(await storedRecord(fixture.records, proposal.ref));
    if (second.status !== 'decoded') throw new Error('PL accepted cursor: the replayed origin is invalid');
    expect(second.value.until).toBe(applied.cursor);
  });

  it('a candidate that was never adopted has no until', async () => {
    const goal = await createCursorGoal('PL-cursor-candidate');
    const proposal = await proposeInitialCandidate(goal, 'PL-cursor-candidate-plan', 'PL-cursor-candidate-propose');
    const record = await storedRecord(fixture.records, proposal.ref);

    const dto = decodePlanProposalRecord(record);
    expect(dto).toMatchObject({ status: 'decoded' });
    if (dto.status !== 'decoded') throw new Error('PL accepted cursor: the candidate is invalid');
    expect(dto.value).not.toHaveProperty('until');

    const origin = decodePlanProposalOrigin(record);
    expect(origin).toMatchObject({ status: 'decoded' });
    if (origin.status !== 'decoded') throw new Error('PL accepted cursor: the candidate origin is invalid');
    expect(origin.value).not.toHaveProperty('until');
  });
});
