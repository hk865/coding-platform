/**
 * 6C S4 (book §2.3, `7d2-drill-rulings.md` binding): a candidate may carry a new objective statement, and a
 * person's adoption writes it into the Goal in the same commit as the plan revision. The platform's automatic
 * adoption refuses such a candidate with `invalid`.
 *
 * The world is the frozen C7 platform (`tests/scenarios/support/plan.ts` `c7Case`): one real Goal, one adopted
 * Plan and the real `plans/propose` / `plans/apply` owners. No request, no second fixture.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalDetail, PlanChangeReason, PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { ready } from '../helpers/S7A-fixture.js';
import { cleanupCommon, draftFrom } from '../scenarios/support/common.js';
import { cleanupPlan, c7Case, workTask } from '../scenarios/support/plan.js';
import { cleanupScenarios } from '../scenarios/harness.js';

type Platform = Awaited<ReturnType<typeof c7Case.openEnvironment>>['platform'];

afterEach(async () => {
  await cleanupPlan();
  await cleanupCommon();
  await cleanupScenarios();
});

/** The Goal's public detail. */
async function goalOf(platform: Platform): Promise<GoalDetail> {
  return ready<GoalDetail>(await platform.plans.queryGoal(c7Case.ctx(), c7Case.goalRef), 'the Goal read');
}

/** The next future revision of the active Plan with one new required work Task carried by the source obligation. */
async function candidateWith(platform: Platform, planId: string, reason: PlanChangeReason) {
  const { source, draft } = await c7Case.nextDraft(platform, planId, current => ({
    ...current,
    tasks: [...current.tasks, workTask(`${planId}-task`, `${planId} future work`)],
    assignments: [...(current.assignments ?? []),
      { taskId: `${planId}-task`, role: 'builder', instruction: `Do ${planId} work` }],
    obligations: current.obligations.map(obligation => ({
      ...obligation, taskIds: [...obligation.taskIds, `${planId}-task`],
    })),
  }));
  return { source, draft, reason };
}

/** The stored candidate, read through the public proposal read. */
async function candidateOf(platform: Platform, proposalRef: { proposalId: string }): Promise<PlanProposal> {
  return ready<PlanProposal>(await platform.plans.readPlanProposal(c7Case.ctx(), proposalRef as never),
    'plans/proposal');
}

describe('S6C S4: the candidate objective and the Goal pointer', () => {
  it('S4-1: a person adopting a candidate with `reason.objective` writes the objective and moves the Goal in the same plan revision', async () => {
    const opened = await c7Case.openEnvironment(0);
    try {
      const before = await goalOf(opened.platform);
      const planBefore = (await c7Case.graph(opened.platform)).plan;
      const { source, draft, reason } = await candidateWith(opened.platform, 's6c-s4-plan-1', {
        text: 'S4 changes the objective', sources: [], objective: '新目标',
      });
      const candidate = await c7Case.proposed(opened.platform, 's6c-s4-propose-1', source, draft,
        reason);
      const adopted = await c7Case.apply(opened.platform, 's6c-s4-apply-1', candidate);
      if (adopted.status !== 'committed' || adopted.value.schemaVersion !== 2) {
        throw new Error(`the adoption did not commit: ${JSON.stringify(adopted)}`);
      }
      expect(adopted.value.planRevision).toBe(planBefore.planRevision + 1);
      const after = await goalOf(opened.platform);
      expect(after.goal.objective).toBe('新目标');
      expect(after.goal.objective).not.toBe('同意');
      expect(after.goal.revision).toBe(before.goal.revision + 1);
      expect(after.goal.activePlanRevision).toEqual(adopted.value.ref);
      // The same request id and proposal replay to the same Goal read, with the pointer at the one revision.
      const replayed = await c7Case.apply(opened.platform, 's6c-s4-apply-1', candidate);
      expect(replayed).toMatchObject({ status: 'committed' });
      expect((await goalOf(opened.platform)).goal.revision).toBe(after.goal.revision);
    } finally {
      await opened.platform.close();
    }
  }, 120_000);

  it('S4-2: the platform automation adopting the same objective candidate is refused `invalid` and moves nothing', async () => {
    const opened = await c7Case.openEnvironment(0);
    try {
      const before = await goalOf(opened.platform);
      const planBefore = (await c7Case.graph(opened.platform)).plan;
      const { source, draft, reason } = await candidateWith(opened.platform, 's6c-s4-plan-2', {
        text: 'S4 automatic objective', sources: [], objective: '自动目标',
      });
      const candidate = await c7Case.proposed(opened.platform, 's6c-s4-propose-2', source, draft,
        reason, c7Case.automation());
      const refused = await c7Case.apply(opened.platform, 's6c-s4-apply-2', candidate, c7Case.automation());
      expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
      const after = await goalOf(opened.platform);
      expect(after.goal.objective).toBe(before.goal.objective);
      expect(after.goal.revision).toBe(before.goal.revision);
      expect((await c7Case.graph(opened.platform)).plan.ref).toEqual(planBefore.ref);
    } finally {
      await opened.platform.close();
    }
  }, 120_000);

  it('S4-3: a candidate without the objective keeps the Goal objective and moves the pointer once', async () => {
    const opened = await c7Case.openEnvironment(0);
    try {
      const before = await goalOf(opened.platform);
      const planBefore = (await c7Case.graph(opened.platform)).plan;
      const { source, draft, reason } = await candidateWith(opened.platform, 's6c-s4-plan-3',
        { text: 'S4 no objective', sources: [] });
      const candidate = await c7Case.proposed(opened.platform, 's6c-s4-propose-3', source, draft,
        reason);
      // The old record has no `objective`; decoding stays absent/null, never a fabricated string.
      const stored = await candidateOf(opened.platform, candidate.ref);
      expect(stored.reason.objective ?? null).toBeNull();
      const adopted = await c7Case.apply(opened.platform, 's6c-s4-apply-3', candidate);
      if (adopted.status !== 'committed' || adopted.value.schemaVersion !== 2) {
        throw new Error(`the adoption did not commit: ${JSON.stringify(adopted)}`);
      }
      expect(adopted.value.planRevision).toBe(planBefore.planRevision + 1);
      const after = await goalOf(opened.platform);
      expect(after.goal.objective).toBe(before.goal.objective);
      expect(after.goal.revision).toBe(before.goal.revision + 1);
    } finally {
      await opened.platform.close();
    }
  }, 120_000);

  it('S4-4: an objective that is only whitespace is `invalid` at propose and writes no candidate', async () => {
    const opened = await c7Case.openEnvironment(0);
    try {
      const before = await goalOf(opened.platform);
      const { source, draft, reason } = await candidateWith(opened.platform, 's6c-s4-plan-4',
        { text: 'S4 empty objective', sources: [], objective: '   ' });
      const refused = await opened.platform.plans.proposePlan(c7Case.ctx(), {
        input: { goalRef: c7Case.goalRef, basedOn: source.ref, draft,
          reason: reason },
        meta: { requestId: 's6c-s4-propose-4', expected: [] },
      });
      expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
      const after = await goalOf(opened.platform);
      expect(after.pendingPlan).toBeNull();
      expect(after.goal.revision).toBe(before.goal.revision);
    } finally {
      await opened.platform.close();
    }
  }, 120_000);
  it('S4-5: a first independent candidate with `reason.objective` is `invalid` when the platform automation adopts it and moves nothing', async () => {
    const opened = await c7Case.openEnvironment(0);
    try {
      const ctx = c7Case.ctx();
      if (ctx.workspaceId === undefined) throw new Error('the C7 context has no workspace');
      const workspace = { projectId: ctx.projectId, workspaceId: ctx.workspaceId };
      const firstGoalRef = { aggregateType: 'Goal' as const, projectId: ctx.projectId, goalId: 's6c-s4-first-goal' };
      const registration = await opened.platform.projects.readWorkspaceRegistration(ctx, workspace);
      if (registration.status !== 'ready') throw new Error(`the registration is unreadable: ${JSON.stringify(registration)}`);
      const created = await opened.platform.goals.createGoal(ctx, { meta: {
        requestId: 's6c-s4-first-goal', expected: [
          { ref: registration.value.project.ref, revision: registration.value.project.revision },
          { ref: registration.value.workspace.ref, revision: registration.value.workspace.revision },
        ],
      }, input: { goalId: firstGoalRef.goalId, workspace, objective: 'S4 first goal' } });
      expect(created).toMatchObject({ status: 'committed' });
      const before = ready<GoalDetail>(await opened.platform.plans.queryGoal(ctx, firstGoalRef), 'the first Goal read');
      // The first independent candidate: no source Plan, no request, and a new objective statement.
      const source = (await c7Case.graph(opened.platform)).plan;
      const draft = draftFrom(source, 's6c-s4-first-plan', value => ({
        ...value, planRevision: 1, goalId: firstGoalRef.goalId,
      }));
      const proposed = await opened.platform.plans.proposePlan(ctx, {
        input: { goalRef: firstGoalRef, basedOn: null, draft,
          reason: { text: 'S4 first objective', sources: [], objective: '首版目标' } },
        meta: { requestId: 's6c-s4-first-propose', expected: [] },
      });
      if (proposed.status !== 'committed') throw new Error(`the first candidate failed: ${JSON.stringify(proposed)}`);
      const refused = await opened.platform.plans.applyPlanChange(c7Case.automation(), {
        input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
        meta: { requestId: 's6c-s4-first-apply', expected: [] },
      });
      expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
      const after = ready<GoalDetail>(await opened.platform.plans.queryGoal(ctx, firstGoalRef),
        'the first Goal after the refusal');
      expect(after.goal.objective).toBe(before.goal.objective);
      expect(after.goal.revision).toBe(before.goal.revision);
      expect(after.goal.activePlanRevision).toBeNull();
    } finally {
      await opened.platform.close();
    }
  }, 120_000);
});
