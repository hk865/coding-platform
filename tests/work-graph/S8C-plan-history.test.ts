/**
 * 8C R6, the three plan-history pieces (start ruling §5 R6; book 8C §3.5 item
 * 10, :1304): the module fact at a proposal's trial and at adoption leaves out
 * the terminal history a draft carries forward unchanged; a new, changed or
 * re-enabled module task is still checked; an adopted plan and its original
 * `plans/apply` command read and replay unchanged after a real module delete.
 * KLS-2c-2b G7 (merge ruling 4): the candidate's knowledge pin is narrowed to the
 * Tasks the module fact checked, so the exempt history's module is not pinned.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PlanRevisionDraft, PlanRevisionRef, RuntimeTask } from '../../src/contracts/plan.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { bindCatalogRevision, catalogRevisionModule, openS8CCatalogWorld } from '../helpers/S8C-catalog-world.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { openS7AWorkWorld } from '../helpers/S7A-fixture.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { draftFrom } from '../scenarios/support/common.js';
import { committed, ready } from '../helpers/S1-runtime-scenario-fixture.js';

const catalogMock = vi.hoisted(() => ({ actual: null as null | Record<string, unknown>,
  revision: null as null | Record<string, unknown> }));
vi.mock('../../src/core/work-graph/architecture/catalog-service.js', async importOriginal => {
  const actual = await importOriginal() as Record<string, unknown>;
  catalogMock.actual = actual;
  return { ...actual, createArchitectureCatalogService: (stores: unknown) => {
    if (catalogMock.revision === null) throw new Error('the catalog revision factory is not bound');
    return (catalogMock.revision['createArchitectureCatalogService'] as (stores: unknown) => unknown)(stores);
  } };
});
beforeAll(async () => { catalogMock.revision = await catalogRevisionModule(async () => catalogMock.actual!); });

type World = Awaited<ReturnType<typeof openS8CCatalogWorld>>;
const worlds: World[] = [];
type S7AWorld = Awaited<ReturnType<typeof openS7AWorkWorld>>;
const s7aWorlds: S7AWorld[] = [];
afterEach(async () => {
  await Promise.all(s7aWorlds.splice(0).map(world => world.world.close()));
  await Promise.all(worlds.splice(0).map(world => world.close()));
});
async function openWorld(): Promise<World> { const world = await openS8CCatalogWorld(); worlds.push(world); return world; }

/** One required work task on `docs` and the goal gate; a v2 draft. */
const work = (taskId: string, disposition: 'active' | 'cancelled' = 'active', title = `Work ${taskId}`): RuntimeTask => ({
  taskId, stageId: 'build', title, requirementLevel: 'required', taskKind: 'work', disposition, phase: 'pending',
  executionIntent: 'request_execution', scope: { kind: 'module', stageId: 'build', moduleRef: 'docs' } });
const GATE: RuntimeTask = { taskId: 'gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
  disposition: 'active', phase: 'pending', scope: { kind: 'goal' } };
function planOf(goalId: string, planRevision: number, tasks: RuntimeTask[]): PlanRevisionDraft {
  const workIds = tasks.filter(task => task.taskKind === 'work').map(task => task.taskId);
  return { schemaVersion: 2, planId: `s8c-history-${planRevision}`, planRevision, goalId,
    stages: [{ stageId: 'build', title: 'Build' }], tasks,
    assignments: workIds.map(taskId => ({ taskId, role: 'builder', instruction: `Do ${taskId}` })),
    obligations: [{ obligationId: 'deliver', title: 'Deliver', requirementLevel: 'required',
      taskIds: tasks.map(task => task.taskId), verificationRequirements: [{ requirementId: 'static',
        requirementLevel: 'required', kind: 'static', description: 'The static check passes' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
}

/** Adopt `docs` active, then a successor that cancels it; the adopted history plan and its original apply command. */
async function history(world: World) {
  const goal = await world.goal('s8c-goal-history');
  const first = committed((await world.propose({ goal, draft: planOf(goal.goalId, 1, [work('work-0'), GATE]) })).result);
  const firstPlan = committed((await world.apply(first)).result);
  const second = committed((await world.propose({ goal, basedOn: firstPlan.ref,
    draft: planOf(goal.goalId, 2, [work('work-0', 'cancelled'), GATE]) })).result);
  const adoption = await world.apply(second);
  return { goal, plan: committed(adoption.result), adoption };
}
const deleteDocs = async (world: World) =>
  committed(await world.revise({ ops: [{ op: 'remove_module', moduleId: 'docs' }], reason: 'delete docs' }));

describe('S8C R6 plan history after a module delete', () => {
  it('exempts the unchanged terminal module task at propose', async () => {
    const world = await openWorld();
    const { goal, plan } = await history(world);
    await deleteDocs(world);
    const proposed = await world.propose({ goal, basedOn: plan.ref,
      draft: planOf(goal.goalId, 3, [work('work-0', 'cancelled'), GATE]) });
    expect(proposed.result).toMatchObject({ status: 'committed' });
  });

  it('exempts the unchanged terminal module task at adoption', async () => {
    const world = await openWorld();
    const { goal, plan } = await history(world);
    const candidate = committed((await world.propose({ goal, basedOn: plan.ref,
      draft: planOf(goal.goalId, 3, [work('work-0', 'cancelled'), GATE]) })).result);
    await deleteDocs(world);
    expect(committed((await world.apply(candidate)).result).tasks
      .find(task => task.taskId === 'work-0')?.disposition).toBe('cancelled');
  });

  it('G7 (KLS-2c-2b): the candidate pins only the checked Tasks\' modules, not the exempt terminal history\'s',
    async () => {
      const world = await openWorld();
      const { goal, plan } = await history(world);
      const onSrc: RuntimeTask = { ...work('work-1'), scope: { kind: 'module', stageId: 'build', moduleRef: 'src' } };
      const candidate = committed((await world.propose({ goal, basedOn: plan.ref,
        draft: planOf(goal.goalId, 3, [work('work-0', 'cancelled'), onSrc, GATE]) })).result);
      // The one line is dirty (not git), so it lists the modules the plan uses (L3).
      // 具名改坏 G7「窗里不按检查过的任务收窄」→ 豁免的 work-0 挂的 `docs` 也钉进去，红在这一句。
      expect(candidate.catalogPin?.lines.map(line => line.modules?.map(module => module.moduleId))).toEqual([['src']]);
    });

  it('still refuses a new, changed or re-enabled module task', async () => {
    const world = await openWorld();
    const { goal, plan } = await history(world);
    await deleteDocs(world);
    const rows: [PlanRevisionDraft, string][] = [
      [planOf(goal.goalId, 3, [work('work-0', 'cancelled'), GATE, work('work-1')]), 'work-1=docs'],
      [planOf(goal.goalId, 3, [work('work-0', 'cancelled', 'Work 0 changed'), GATE]), 'work-0=docs'],
      [planOf(goal.goalId, 3, [work('work-0'), GATE]), 'work-0=docs'],
    ];
    for (const [draft, literal] of rows) {
      expect((await world.propose({ goal, basedOn: plan.ref, draft })).result)
        .toEqual({ status: 'rejected', code: 'invalid', reason: `unknown_module: ${literal}` });
    }
  });

  it('reads and replays the adopted plan unchanged after the delete', async () => {
    const world = await openWorld();
    const { goal, plan, adoption } = await history(world);
    const read = async () => {
      const graph = ready(await world.platform.plans.queryTaskGraph(world.ctx, { goalRef: goal, planRef: plan.ref }));
      return { plan: graph.plan, tasks: graph.tasks };
    };
    const before = await read();
    await deleteDocs(world);
    expect(await read()).toEqual(before);
    expect(await world.platform.plans.applyPlanChange(world.ctx, adoption.request))
      .toEqual({ ...adoption.result, replayed: true });
  });

  it('accepts a carried satisfied module task at propose and adoption after its module is deleted', async () => {
    const opened = await openS7AWorkWorld({ backend: 'memory' });
    s7aWorlds.push(opened);
    const { world, goal, plan, line } = opened;
    // The S8C rows install the catalog mock; bind its revision deps to this real platform.
    bindCatalogRevision(world.platform, S6A_SCOPE);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const ctx = world.humanContext();
    const taskId = 's8c-carried-satisfied';
    const stageId = plan.stages[0]?.stageId ?? 's8c-carried-stage';
    const stage = plan.stages[0] ?? { stageId, title: 'Carried stage' };
    const moduleTask: RuntimeTask = { taskId, stageId, title: 'Carried satisfied work',
      requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
      executionIntent: 'request_execution', scope: { kind: 'module', stageId, moduleRef: 's6a-core' } };
    const p2 = draftFrom(plan, 's8c-carried-plan-2', draft => ({ ...draft,
      stages: draft.stages.length === 0 ? [stage] : draft.stages,
      tasks: [...draft.tasks, moduleTask],
      assignments: [...(draft.assignments ?? []),
        { taskId, role: S6A_WORK_ROLE.templateId, instruction: 'Carry the satisfied work' }],
      obligations: draft.obligations.map(obligation => ({ ...obligation,
        taskIds: [...obligation.taskIds, taskId] })) }));
    const goalPin = async () => ({ ref: goal,
      revision: ready(await world.platform.plans.queryGoal(ctx, goal)).goal.revision });
    const proposeS8CPlan = async (requestId: string, basedOn: PlanRevisionRef, draft: PlanRevisionDraft) => {
      const body = await main.post('plans/propose', graphWrite(S6A_SCOPE, { goalRef: goal, basedOn, draft,
        reason: { text: requestId, sources: [] } }, requestId, [await goalPin()])) as
        { status: string; value?: { ref: PlanRevisionRef; revision: number } };
      return body;
    };
    const apply = async (requestId: string, proposalRef: PlanRevisionRef, expectedProposalRevision: number) => {
      const body = await main.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef,
        expectedProposalRevision, decisionRefs: [] }, requestId, [await goalPin()])) as { status: string };
      return body;
    };
    const p2Proposal = await proposeS8CPlan('s8c-carried-propose-2', plan.ref, p2);
    expect(p2Proposal.status).toBe('committed');
    expect(await apply('s8c-carried-apply-2', p2Proposal.value!.ref, p2Proposal.value!.revision))
      .toMatchObject({ status: 'committed' });

    // A real Work Run satisfies the module task through the Workflow's own completion.
    await world.scripted.script(line, [{ kind: 'text', text: 'S8C carried satisfied' }]);
    const claim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal,
      flowId: 's8c-carried-run', sessionHint: line.ref, kind: 'select_work', taskId }, 'claim_task');
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, claim, { stopBefore: 'claim_task', receipts });
    const satisfied = ready(await world.platform.plans.queryTaskGraph(ctx, { goalRef: goal })).tasks
      .find(task => task.ref.taskId === taskId)?.effectivePhase;
    expect(satisfied).toBe('satisfied');

    // Delete the module the satisfied task declared: the delete's `module_in_use` sees a closed Task.
    const registration = ready(await world.platform.projects.readWorkspaceRegistration(ctx, S6A_SCOPE));
    const current = ready(await world.platform.architecture.readArchitectureRevision(ctx,
      { selection: { kind: 'current' } }));
    expect(await world.platform.architecture.reviseArchitectureCatalog(ctx, {
      meta: { requestId: 's8c-carried-delete', expected: [
        { ref: registration.project.ref, revision: registration.project.revision },
        { ref: registration.workspace.ref, revision: registration.workspace.revision },
      ] },
      input: { expected: { catalogRef: current.catalog!.ref,
        baseline: { ref: current.baseline.ref, digest: current.baseline.contentDigest } },
        ops: [{ op: 'remove_module', moduleId: 's6a-core' }], responsibilityMoves: [],
        reason: 'delete the satisfied module' },
    })).toMatchObject({ status: 'committed' });

    // The next plan carries the satisfied Task unchanged: propose and future adoption both accept it.
    const source = await main.activePlan(goal);
    if (source === null) throw new Error('the Goal has no active Plan after the carried Task ran');
    const p3 = draftFrom(source, 's8c-carried-plan-3');
    const p3Proposal = await proposeS8CPlan('s8c-carried-propose-3', source.ref, p3);
    expect(p3Proposal).toMatchObject({ status: 'committed' });
    expect(await apply('s8c-carried-apply-3', p3Proposal.value!.ref, p3Proposal.value!.revision))
      .toMatchObject({ status: 'committed' });
    expect(ready(await world.platform.plans.queryTaskGraph(ctx, { goalRef: goal })).tasks
      .find(task => task.ref.taskId === taskId)?.effectivePhase).toBe('satisfied');
  });
});
