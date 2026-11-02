/**
 * PL-21 (slice-PL-SPEC §15, §5.1.2): a plan of several hundred tasks is refined
 * by one segment — once 1:1 (the placeholder keeps its taskId and becomes
 * `request_execution`) and once 1:many (the placeholder becomes `superseded` and
 * real tasks are added). The model answer names only that segment; the platform
 * parses it (`parseInitialPlanningResponseV2`), merges it
 * (`mergeStageRefinement`) and writes a candidate through `plans/propose`.
 *
 * World: F1 of the spec's fixture table, on the real S6A Host consume world
 * (`openConsumeWorld`): the base Plan is a real initial answer's small plan,
 * adopted through `proposeInitialPlanFromAnswer` + `plans/apply`, then expanded
 * to the few-hundred-task scale through `plans/propose` + `plans/apply` with
 * the seed Plan ref as `basedOn` (the commit compiler inherits its origin).
 * The person message reaches an idle line, the adviser's answer comes from a
 * real planning Query, and the candidate is read through `plans/proposal`,
 * adopted through `plans/apply`, and then `workflow/advance` selects the
 * refined task.
 *
 * PL-21 closes at L's close-out. P1 has no merge call site (the planning branch
 * writes the answer's segment draft as proposed today), so the two world cases
 * are expected red until P4/L connect the merge — they are not bent to today's
 * behaviour.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  AcceptanceObligation, PlanRevisionDraft, PlanRevisionSnapshot, RuntimeTask,
} from '../../src/contracts/plan.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { validatePlanDraft } from '../../src/core/work-graph/tasks/plan-validation.js';
import { advanceUntil } from '../helpers/A2-restart-fixture.js';
import { AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  S6A_PLAIN_ROLE, S6A_PLAIN_ROLE_BINDING, S6A_SCOPE, S6A_WORK_ROLE,
} from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { runInitialAnswer } from '../helpers/S8B-catalog-steps.js';
import {
  awaitCandidate, openConsumeWorld, openLine, readQueryAnswer, settleHost,
} from '../helpers/IV-host-fixture.js';
import { committed, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { planAnswer } from '../helpers/S7B-V-fixture.js';

const GOAL_GATE_TASK_ID = 'pl21-goal-gate';
const TARGET_STAGE = 'pl21-stage-3';
const STAGE_COUNT = 8;
const TASKS_PER_STAGE = 36;

const stageIdForIndex = (index: number): string => `pl21-stage-${String(index)}`;
const taskIdOf = (stage: number, index: number): string =>
  `pl21-s${String(stage)}-${String(index).padStart(2, '0')}`;
/** The placeholder this row refines (last task of the target stage). */
const PLACEHOLDER_TASK_ID = taskIdOf(3, TASKS_PER_STAGE);
/** Every later stage keeps one required `plan_only` placeholder. */
const OTHER_PLACEHOLDER_TASK_IDS = Array.from({ length: STAGE_COUNT - 3 },
  (_unused, index) => taskIdOf(index + 4, TASKS_PER_STAGE));
const REFINED_TASK_IDS = ['pl21-refined-a', 'pl21-refined-b'] as const;

type BasePlan = { draft: PlanRevisionDraft; assignments: Map<string, string> };

function stageWorkTask(taskId: string, stageId: string, executionIntent: 'plan_only' | 'request_execution',
  title: string): RuntimeTask {
  return {
    taskId, stageId, title, requirementLevel: 'required', taskKind: 'work', disposition: 'active',
    phase: 'pending', scope: { kind: 'stage', stageId }, executionIntent,
  };
}

function stageGateTask(stageId: string): RuntimeTask {
  return {
    taskId: `pl21-stage-${stageId.slice('pl21-stage-'.length)}-gate`, title: `Segment ${stageId} gate`,
    requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending',
    scope: { kind: 'stage', stageId },
  };
}

function obligation(obligationId: string, taskIds: readonly string[]): AcceptanceObligation {
  return {
    obligationId, title: `PL-21 ${obligationId}`, requirementLevel: 'required', taskIds: [...taskIds],
    verificationRequirements: [{
      requirementId: `${obligationId}-requirement`, requirementLevel: 'required', kind: 'static',
      description: `the ${obligationId} check passes`,
    }],
  };
}

/** The scale base: skeleton + the first segments + one required placeholder per future segment. */
function basePlan(goal: GoalRef, planId = 'pl21-base', planRevision = 1): BasePlan {
  const tasks: RuntimeTask[] = [{
    taskId: GOAL_GATE_TASK_ID, title: 'PL-21 goal gate', requirementLevel: 'required', taskKind: 'gate',
    disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
  }];
  const assignments = new Map<string, string>();
  const dependsOn: PlanRevisionDraft['executionDag']['dependsOn'] = [];
  const stages = Array.from({ length: STAGE_COUNT }, (_unused, index) => ({
    stageId: stageIdForIndex(index + 1), title: `Segment ${String(index + 1)}`,
  }));
  for (let stage = 1; stage <= STAGE_COUNT; stage += 1) {
    const stageId = stageIdForIndex(stage);
    tasks.push(stageGateTask(stageId));
    for (let index = 1; index <= TASKS_PER_STAGE; index += 1) {
      const taskId = taskIdOf(stage, index);
      const placeholder = (stage === 3 || stage >= 4) && index === TASKS_PER_STAGE;
      tasks.push(stageWorkTask(taskId, stageId, placeholder ? 'plan_only' : 'request_execution',
        placeholder ? `Segment ${String(stage)} future placeholder` : `Segment ${String(stage)} work ${String(index)}`));
      if (!placeholder) assignments.set(taskId, S6A_WORK_ROLE.templateId);
    }
    if (stage > 1) {
      // A real dependency between adjacent segments: it is not owned by the refined segment.
      dependsOn.push({ taskId: taskIdOf(stage, 1), dependsOnId: taskIdOf(stage - 1, 1),
        requires: { kind: 'output-contract', label: `segment ${String(stage - 1)} output contract` } });
    }
    dependsOn.push({ taskId: taskIdOf(stage, 2), dependsOnId: taskIdOf(stage, 1),
      requires: { kind: 'artifact', label: `segment ${String(stage)} first output` } });
  }
  const draft: PlanRevisionDraft = {
    schemaVersion: 2,
    reviewAdmissionProtocol: 'independent-review-v1',
    planId, planRevision, goalId: goal.goalId,
    stages,
    tasks,
    assignments: [...assignments].map(([taskId, role]) => ({
      taskId, role, instruction: `PL-21 base instruction for ${taskId}`,
    })),
    obligations: [
      obligation('pl21-goal-obligation', [GOAL_GATE_TASK_ID]),
      // Every stage gate (including the six the expansion adds) carries its own required obligation:
      // a W1 revision cannot add a gate that carries no newly added acceptance obligation.
      ...Array.from({ length: STAGE_COUNT }, (_unused, index) => {
        const stage = index + 1;
        const stageId = stageIdForIndex(stage);
        const carriers = [stageGateTask(stageId).taskId];
        if (stage === 1) carriers.push(taskIdOf(1, 1));
        if (stage === 3) carriers.push(PLACEHOLDER_TASK_ID);
        return obligation(`pl21-stage-${String(stage)}-obligation`, carriers);
      }),
    ],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn },
    taskRelations: [{ fromTaskId: taskIdOf(1, 1), toTaskId: taskIdOf(2, 1),
      kind: 'coordination', note: 'PL-21 adjacent segments coordinate' }],
    inputRequirements: [],
  } as PlanRevisionDraft;
  return { draft, assignments };
}

function segmentPlanId(label: string): string {
  return `pl21-${label}-segment`;
}

/** One placeholder refined into one task: the same taskId, now `request_execution`. */
function oneToOneSegment(goal: GoalRef, _base: BasePlan): Record<string, unknown> {
  return {
    schemaVersion: 2, planId: segmentPlanId('1to1'), planRevision: 2, goalId: goal.goalId,
    stages: [{ stageId: TARGET_STAGE, title: 'Segment 3 refined' }],
    tasks: [stageWorkTask(PLACEHOLDER_TASK_ID, TARGET_STAGE, 'request_execution', 'Segment 3 refined work')],
    assignments: [{ taskId: PLACEHOLDER_TASK_ID, role: S6A_WORK_ROLE.templateId,
      instruction: 'PL-21 refined instruction for the single task' }],
    obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
    taskRelations: [], inputRequirements: [],
  };
}

/** One placeholder refined into two tasks: the placeholder is `superseded`, real tasks are added. */
function oneToManySegment(goal: GoalRef, _base: BasePlan): Record<string, unknown> {
  return {
    schemaVersion: 2, planId: segmentPlanId('1tomany'), planRevision: 2, goalId: goal.goalId,
    stages: [{ stageId: TARGET_STAGE, title: 'Segment 3 refined' }],
    tasks: [
      { ...stageWorkTask(PLACEHOLDER_TASK_ID, TARGET_STAGE, 'plan_only', 'Segment 3 future placeholder'),
        disposition: 'superseded', replacedByTaskId: REFINED_TASK_IDS[0] },
      stageWorkTask(REFINED_TASK_IDS[0], TARGET_STAGE, 'request_execution', 'Segment 3 refined work A'),
      stageWorkTask(REFINED_TASK_IDS[1], TARGET_STAGE, 'request_execution', 'Segment 3 refined work B'),
    ],
    assignments: [
      { taskId: REFINED_TASK_IDS[0], role: S6A_WORK_ROLE.templateId, instruction: 'PL-21 refined A' },
      { taskId: REFINED_TASK_IDS[1], role: S6A_WORK_ROLE.templateId, instruction: 'PL-21 refined B' },
    ],
    obligations: [], taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [{ taskId: REFINED_TASK_IDS[1], dependsOnId: REFINED_TASK_IDS[0],
      requires: { kind: 'output-contract', label: 'refined A output contract' } }] },
    taskRelations: [], inputRequirements: [],
  };
}

const VARIANTS = [
  { label: '1:1', slug: '1to1', segment: oneToOneSegment, refinedTaskId: PLACEHOLDER_TASK_ID,
    answerTaskIds: [PLACEHOLDER_TASK_ID], addedTasks: 0 },
  { label: '1:many', slug: '1tomany', segment: oneToManySegment, refinedTaskId: REFINED_TASK_IDS[0],
    answerTaskIds: [PLACEHOLDER_TASK_ID, ...REFINED_TASK_IDS], addedTasks: REFINED_TASK_IDS.length },
] as const;

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

/**
 * The small legal plan the real initial answer returns. It is a strict subset of the scale base:
 * the Goal gate, stage 1's gate and its first two work tasks keep the same ids and definitions, so
 * the later expansion only adds tasks and stages (no source task is physically removed).
 */
function seedPlanAnswer(): string {
  const stageId = stageIdForIndex(1);
  const stageGateId = stageGateTask(stageId).taskId;
  const seedWorkTaskIds = [taskIdOf(1, 1), taskIdOf(1, 2)];
  return JSON.stringify({
    schemaVersion: 2, kind: 'plan', summary: 'PL-21 seed plan from the real initial answer',
    plan: {
      schemaVersion: 2,
      reviewAdmissionProtocol: 'independent-review-v1',
      stages: [{ stageId, title: 'Segment 1' }],
      tasks: [
        {
          taskId: GOAL_GATE_TASK_ID, title: 'PL-21 goal gate', requirementLevel: 'required', taskKind: 'gate',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
        },
        stageGateTask(stageId),
        stageWorkTask(seedWorkTaskIds[0]!, stageId, 'request_execution', 'Segment 1 work 1'),
        stageWorkTask(seedWorkTaskIds[1]!, stageId, 'request_execution', 'Segment 1 work 2'),
      ],
      assignments: seedWorkTaskIds.map((taskId) => ({
        taskId, role: S6A_WORK_ROLE.templateId, instruction: `PL-21 base instruction for ${taskId}`,
      })),
      obligations: [
        obligation('pl21-goal-obligation', [GOAL_GATE_TASK_ID]),
        obligation('pl21-stage-1-obligation', [stageGateId, seedWorkTaskIds[0]!]),
      ],
      taskHierarchy: { parentOf: [] },
      executionDag: { dependsOn: [{ taskId: seedWorkTaskIds[1]!, dependsOnId: seedWorkTaskIds[0]!,
        requires: { kind: 'artifact', label: 'Segment 1 first output' } }] },
      taskRelations: [],
      inputRequirements: [],
    },
  });
}

/**
 * The real initial-answer step: script the model's small plan, run the formal claim/prepare/start
 * chain (`runInitialAnswer`), have the existing Plan owner derive the candidate from the saved
 * answer, and adopt it through the public `plans/apply` route. The returned snapshot is the seed
 * Plan with the answer's `model_coordination` origin.
 */
async function adoptSeedPlan(world: S6AHostWorld, ws: ReturnType<typeof s6aCardsWorkspace>,
  goal: GoalRef, label: string) {
  const suffix = `pl21-${label}-seed`;
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', ...S6A_SCOPE, queryJobId: `${suffix}-job` };
  const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', ...S6A_SCOPE, queryJobId: queryJobRef.queryJobId,
    runId: `${suffix}-run` };
  const registration = await world.platform.projects.readWorkspaceRegistration(world.humanContext(), S6A_SCOPE);
  if (registration.status !== 'ready') {
    throw new Error(`PL-21 ${label}: the workspace registration is not readable: ${JSON.stringify(registration)}`);
  }
  const goalRead = await world.platform.plans.queryGoal(world.humanContext(), goal);
  if (goalRead.status !== 'ready') throw new Error(`PL-21 ${label}: the Goal is not readable: ${JSON.stringify(goalRead)}`);
  const intent: QueryJobIntentV1 = {
    schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId: S6A_SCOPE.projectId,
    workspaceId: S6A_SCOPE.workspaceId, goalId: goal.goalId,
    question: 'Read the project and propose the initial plan', focusTaskRefs: [], budget: AG2B_QUERY_BUDGET,
    multiTurn: { maxRounds: 1 }, correlationId: `${suffix}-corr`,
    execution: { kind: 'initial_coordination', roleBinding: S6A_PLAIN_ROLE_BINDING,
      runtimeBudget: AG2B_RUNTIME_BUDGET },
  };
  world.scriptReplies([{ kind: 'text', text: seedPlanAnswer() }]);
  const { answerRef } = await runInitialAnswer(world.platform, world.humanContext(), {
    requestPrefix: suffix, consumerId: 'pl21-seed-consumer',
    submit: {
      meta: { requestId: `${suffix}-submit`, expected: [
        { ref: registration.value.project.ref, revision: registration.value.project.revision },
        { ref: registration.value.workspace.ref, revision: registration.value.workspace.revision },
        { ref: goal, revision: goalRead.value.goal.revision },
        { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 },
      ] },
      input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent },
    },
    session: { workspace: S6A_SCOPE, role: S6A_PLAIN_ROLE, recommendedRefs: [], initialLinks: [],
      meta: { requestId: `${suffix}-session`, expected: [] } },
  });
  const proposed = await world.platform.plans.proposeInitialPlanFromAnswer(world.humanContext(), {
    meta: { requestId: `${suffix}-propose`, expected: [] },
    input: { answerRef, reason: { text: 'PL-21 seed plan from the real initial answer', sources: [] } },
  });
  if (proposed.status !== 'committed') {
    throw new Error(`PL-21 ${label}: the initial answer wrote no candidate: ${JSON.stringify(proposed)}`);
  }
  committed(await ws.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
  }, `${suffix}-apply`)), `the PL-21 seed adoption ${label}`);
  const seed = await ws.activePlan(goal);
  if (seed === null) throw new Error(`PL-21 ${label}: the seed Plan is not active`);
  return seed;
}

/** The public `plans/propose` + `plans/apply` expansion: `basedOn` is the adopted seed Plan. */
async function expandToScale(ws: ReturnType<typeof s6aCardsWorkspace>, goal: GoalRef,
  seed: PlanRevisionSnapshot, draft: PlanRevisionDraft, label: string): Promise<void> {
  const proposal = committed<{ ref: unknown; revision: number }>(await ws.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: seed.ref, draft, reason: { text: `PL-21 ${label} scale plan`, sources: [] },
  }, `pl21-${label}-expand-propose`)), `the PL-21 scale proposal ${label}`);
  committed(await ws.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [],
  }, `pl21-${label}-expand-apply`)), `the PL-21 scale adoption ${label}`);
}

function taskOf(draft: PlanRevisionDraft, taskId: string): RuntimeTask {
  const task = draft.tasks.find((candidate) => candidate.taskId === taskId);
  if (task === undefined) throw new Error(`PL-21: the merged draft has no task ${taskId}`);
  return task;
}

describe('PL-21: a few-hundred-task Plan refined by one segment', () => {
  it.each(VARIANTS)('PL-21 $label through the real adviser answer, candidate and adoption',
    async (row) => {
      const world = await openConsumeWorld({ label: `pl21-${row.slug}` });
      worlds.push(world);
      await settleHost(world);
      const ws = s6aCardsWorkspace(world, S6A_SCOPE);
      const goal = world.goals.second;
      // The adviser line is a real `sessions/create`; `openLine` seeds the governance once for this world.
      const { line } = await openLine(world, `pl21-${row.slug}-adviser`);
      await setS7AAutonomy(world, goal, 'every_step');

      // The real initial answer's small plan is adopted first, so the base carries a real origin.
      const seed = await adoptSeedPlan(world, ws, goal, row.slug);
      expect(seed.origin, 'the seed Plan carries the real initial answer origin').toBeDefined();
      // The public propose/apply expansion keeps the seed as `basedOn`; the commit compiler inherits its origin.
      const base = basePlan(goal, 'pl21-base', seed.planRevision + 1);
      await expandToScale(ws, goal, seed, base.draft, row.slug);
      const active = await ws.activePlan(goal);
      expect(active?.planId, 'the expanded Plan is the active revision').toBe('pl21-base');
      expect(active?.tasks, 'the base Plan carries several hundred tasks').toHaveLength(base.draft.tasks.length);

      const message = await sendS7A2PersonMessage(world, { label: `pl21-${row.slug}`, recipient: line.ref, goal });
      await world.scripted.script(line, [{ kind: 'text', text: planAnswer(row.segment(goal, base)) }]);

      let candidate: Awaited<ReturnType<typeof awaitCandidate>>;
      try {
        candidate = await awaitCandidate(world, message.ref, goal, 24);
      } catch (error) {
        throw new Error(`PL-21 ${row.label}: the planning branch wrote no candidate (P4/L closure): ${String(error)}`);
      }
      const { query, proposal } = candidate;
      expect(query.run.status, 'the planning Query is terminal').toBe('answered');

      // The formal answer the model left is the segment-only one: every stage/task in it is the refined segment.
      const answerText = await readQueryAnswer(world, interventionPlanningQueryRefs(message.ref).queryJobRef);
      expect(answerText, 'the planning Query saved the model answer').not.toBeNull();
      const answerPlan = JSON.parse(answerText ?? '') as {
        plan: { stages: { stageId: string }[]; tasks: { taskId: string }[] };
      };
      expect(answerPlan.plan.stages.map((stage) => stage.stageId)).toEqual([TARGET_STAGE]);
      const answerTaskIds = answerPlan.plan.tasks.map((task) => task.taskId).sort();
      expect(answerTaskIds).toEqual([...row.answerTaskIds].sort());

      const draft = proposal.draft;
      // The base Plan was adopted from a real initial answer, so it carries a real origin; the merge must keep it
      // instead of dropping the base lineage.
      expect(active?.origin, 'the active Plan carries its adopted origin').toBeDefined();
      expect(draft.origin, 'the merged draft keeps the base origin').toEqual(active?.origin);
      expect(draft.reviewAdmissionProtocol, 'the review protocol comes from the base').toBe(
        active?.reviewAdmissionProtocol);
      const segmentQueryId = interventionPlanningQueryRefs(message.ref).queryJobRef.queryJobId;
      expect(JSON.stringify(draft), 'the segment origin never appears').not.toContain(segmentQueryId);

      // Every other segment, task, placeholder, gate and obligation survives.
      const draftTaskIds = new Set(draft.tasks.map((task) => task.taskId));
      expect(draftTaskIds.size).toBe(draft.tasks.length);
      for (const task of base.draft.tasks) expect(draftTaskIds.has(task.taskId), `task ${task.taskId} survives`).toBe(true);
      expect(draft.tasks).toHaveLength(base.draft.tasks.length + row.addedTasks);
      expect(draft.stages.map((stage) => stage.stageId)).toEqual(base.draft.stages.map((stage) => stage.stageId));
      for (const placeholderId of OTHER_PLACEHOLDER_TASK_IDS) {
        expect(taskOf(draft, placeholderId)).toMatchObject({ executionIntent: 'plan_only', disposition: 'active' });
      }
      const baseEdges = base.draft.executionDag.dependsOn;
      for (const edge of baseEdges) {
        expect(draft.executionDag.dependsOn, `edge ${edge.taskId} -> ${edge.dependsOnId} survives`)
          .toContainEqual(edge);
      }
      for (const gateId of [GOAL_GATE_TASK_ID, ...Array.from({ length: STAGE_COUNT },
        (_unused, index) => stageGateTask(stageIdForIndex(index + 1)).taskId)]) {
        expect(taskOf(draft, gateId), `gate ${gateId} keeps its definition`)
          .toEqual(taskOf(base.draft, gateId));
      }
      expect(draft.obligations).toEqual(base.draft.obligations);

      // The merged draft passes the existing admission and is a real candidate.
      expect(validatePlanDraft(draft, null)).toEqual([]);
      expect(proposal.status).toBe('candidate');
      expect(proposal.sourceMessageRef).not.toBeNull();
      // The segment's freshly normalized planId is the new revision's id, never the base's.
      expect(draft.planId).not.toBe(active?.planId);
      expect(draft.planRevision).toBe(active!.planRevision + 1);

      if (row.label === '1:1') {
        const refined = taskOf(draft, PLACEHOLDER_TASK_ID);
        expect(refined.executionIntent).toBe('request_execution');
        expect(refined.disposition).toBe('active');
        expect(draft.assignments?.filter((entry) => entry.taskId === PLACEHOLDER_TASK_ID)).toHaveLength(1);
      } else {
        expect(taskOf(draft, PLACEHOLDER_TASK_ID)).toMatchObject({
          disposition: 'superseded', replacedByTaskId: REFINED_TASK_IDS[0],
        });
        for (const taskId of REFINED_TASK_IDS) {
          expect(taskOf(draft, taskId)).toMatchObject({ executionIntent: 'request_execution', phase: 'pending' });
          expect(draft.assignments?.filter((entry) => entry.taskId === taskId)).toHaveLength(1);
        }
        expect(draft.executionDag.dependsOn).toContainEqual(expect.objectContaining({
          taskId: REFINED_TASK_IDS[1], dependsOnId: REFINED_TASK_IDS[0],
        }));
      }

      // The person adopts the candidate, then the Workflow selects the refined task from the adopted revision.
      committed(await world.post('plans/apply', graphWrite(S6A_SCOPE, {
        proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [],
      }, `pl21-${row.slug}-adopt`)), 'the PL-21 refined adoption');
      const adopted = await ws.activePlan(goal);
      expect(adopted?.planId).toBe(draft.planId);
      expect(adopted?.tasks).toHaveLength(draft.tasks.length);

      const select = { schemaVersion: 1 as const, goalRef: goal, flowId: `pl21-${row.slug}-advance`,
        sessionHint: line.ref, kind: 'select_work' as const, taskId: row.refinedTaskId };
      const next = await advanceUntil(world.ag2b, select, 'claim_task');
      expect(next.kind).toBe('perform');
      if (next.kind !== 'perform' || next.operation.kind !== 'claim_task') {
        throw new Error(`PL-21 ${row.label}: the Workflow did not select the refined task: ${JSON.stringify(next)}`);
      }
      expect(next.operation.request.input.taskId).toBe(row.refinedTaskId);
    }, 240_000);
});
