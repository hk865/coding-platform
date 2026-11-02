/**
 * PL workflow fixture: the PL-specific inputs and public steps the workflow rows share.
 * It composes the existing real worlds/steps (`openS6AHostWorld`, `governS6B`, the
 * cards workspace, `createS6BLine`) and adds no second Host, no consumption loop and
 * no record/store read. Every state comes from a public route; every pin is what the
 * route's own read returned just before.
 *
 * DR-P4-04: the shared scene is a two-stage skeleton (stage 1 tasks, one required
 * active `plan_only` placeholder per later stage, one stage gate per stage, an
 * optional module gate), a reviewer line over the existing profile/binding route,
 * the `goals/settings/set` autonomy step and the Host model-gate wrapper. Rows call
 * these; they never copy them.
 */
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  AcceptanceObligation, PlanRevisionDraft, PlanRevisionSnapshot, PlanTaskAssignment, RuntimeTask,
} from '../../src/contracts/plan.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { PlanProposal, PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { parsePlanReviewAnswer } from '../../src/contracts/plan-review.js';
import { advanceUntil, driveWorkflow, readExecution, type AdvanceValue } from './A2-restart-fixture.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply, type S6AUsage } from './S6A-host-fixture.js';
import { awaitPlanningAnswer, heartbeatUntil, heartbeatUntilModel, readBody as readSavedBody, readProposal, readQueryAnswer, waitForResponse } from './IV-host-fixture.js';
import { listed } from './S7B-fixture.js';
import {
  OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6AExtraBinding, type S6ASession,
} from './S6A-request-fixture.js';
import { createS6BLine, governS6B } from './S6B1-fixture.js';
import { bindingOf, checkConfiguration, claimedRunOf, committed, ready, sessionOf, setS7AAutonomy } from './S7A-fixture.js';
import { createPLAdviserLine } from './PL-consumption-fixture.js';
import { lineBinding } from './PL-taskbook-fixture.js';

export type PLModuleGateInput = { stageId: string; moduleRef: string; taskId?: string; workTaskId?: string };

export type PLSkeletonInput = {
  label?: string;
  /** Stage 1's `request_execution` work tasks; default `['pl-a', 'pl-b']`. */
  stageOneTaskIds?: readonly string[];
  /** Add a module-scoped gate carrying its own new acceptance obligation. */
  moduleGate?: PLModuleGateInput;
  /** Stage 2's executable `request_execution` tasks instead of the stage placeholder (G-02/G-12). */
  stageTwoTaskIds?: readonly string[];
  /** Add a required `scope.kind === 'goal'` gate (G-02). */
  goalGate?: boolean;
  /** Replace the stage-2 placeholder's disposition (PL-18a uses `deferred`). */
  placeholderDisposition?: 'active' | 'deferred';
  /** Add a goal-level `plan_only` placeholder with no stageId (PL-18b). */
  goalPlaceholderTaskId?: string;
  /** Omit the stage-2 `plan_only` placeholder (PL-18b's only placeholder is goal-level). */
  omitStagePlaceholder?: boolean;
};

export type PLSkeleton = {
  readonly plan: PlanRevisionSnapshot;
  readonly tasks: readonly TaskTriple[];
  readonly stageOneTasks: readonly string[];
  readonly stageTwoTasks: readonly string[];
  readonly stageGateIds: readonly string[];
  readonly placeholderTaskIds: readonly string[];
  readonly goalGateId: string | null;
};

/** One stage-1 work task: required, active, pending, `request_execution`, stage-scoped. */
function stageOneTask(taskId: string): RuntimeTask {
  return {
    taskId, stageId: 'pl-stage-1', title: `PL stage 1 ${taskId}`, requirementLevel: 'required',
    taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'stage', stageId: 'pl-stage-1' }, executionIntent: 'request_execution', sizeClass: 'small',
  };
}

/** One later-stage placeholder: required, active or deferred, pending, `plan_only`, stage-scoped. */
function placeholderTask(stageId: string, disposition: 'active' | 'deferred' = 'active'): RuntimeTask {
  return {
    taskId: `pl-placeholder-${stageId}`, stageId, title: `PL ${stageId} placeholder`, requirementLevel: 'required',
    taskKind: 'work', disposition, phase: 'pending',
    scope: { kind: 'stage', stageId }, executionIntent: 'plan_only', sizeClass: 'small',
  };
}

/** One goal-level placeholder: no `stageId`, `scope.kind === 'goal'` (PL-18b). */
function goalPlaceholderTask(taskId: string): RuntimeTask {
  return {
    taskId, title: `PL goal-level placeholder ${taskId}`, requirementLevel: 'required',
    taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'goal' }, executionIntent: 'plan_only', sizeClass: 'small',
  };
}

/** One stage-2 executable task: required, active, pending, `request_execution` (G-02/G-12). */
function stageTwoTask(taskId: string): RuntimeTask {
  return {
    taskId, stageId: 'pl-stage-2', title: `PL stage 2 ${taskId}`, requirementLevel: 'required',
    taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'stage', stageId: 'pl-stage-2' }, executionIntent: 'request_execution', sizeClass: 'small',
  };
}

function stageGate(stageId: string): RuntimeTask {
  return {
    taskId: `pl-gate-${stageId}`, title: `PL ${stageId} acceptance`, requirementLevel: 'required',
    taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId },
  };
}

/** One goal-scope gate: the existing `taskKind: 'gate'` with `scope.kind === 'goal'` (G-02). */
function goalGate(taskId: string): RuntimeTask {
  return {
    taskId, title: 'PL goal acceptance', requirementLevel: 'required',
    taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
  };
}

function gateObligation(obligationId: string, taskIds: readonly string[], requirementId: string) {
  return {
    obligationId, title: `${obligationId} acceptance`, requirementLevel: 'required' as const,
    taskIds: [...taskIds],
    verificationRequirements: [{ requirementId, requirementLevel: 'required' as const,
      kind: 'static', description: `${obligationId} static check` }],
  };
}

/** The two-stage skeleton draft (spec §5.1.1): skeleton + stage 1 + one placeholder and one gate per later stage. */
export function plSkeletonDraft(goal: GoalRef, input: PLSkeletonInput = {}): PlanRevisionDraft {
  const label = input.label ?? 'pl';
  const stageOne = input.stageOneTaskIds ?? ['pl-a', 'pl-b'];
  const stageTwo = input.stageTwoTaskIds ?? [];
  const goalGateId = input.goalGate === true ? 'pl-gate-goal' : null;
  const stageTwoEmpty = stageTwo.length === 0 && input.omitStagePlaceholder === true;
  const stages = [{ stageId: 'pl-stage-1', title: 'PL stage 1' },
    ...(stageTwoEmpty ? [] : [{ stageId: 'pl-stage-2', title: 'PL stage 2' }])];
  const tasks: RuntimeTask[] = [
    ...stageOne.map(stageOneTask),
    ...stageTwo.map(stageTwoTask),
    ...(stageTwo.length === 0 && input.omitStagePlaceholder !== true
      ? [placeholderTask('pl-stage-2', input.placeholderDisposition ?? 'active')] : []),
    ...(input.goalPlaceholderTaskId === undefined ? [] : [goalPlaceholderTask(input.goalPlaceholderTaskId)]),
    stageGate('pl-stage-1'),
    ...(stageTwoEmpty ? [] : [stageGate('pl-stage-2')]),
    ...(goalGateId === null ? [] : [goalGate(goalGateId)]),
  ];
  const stageTwoCovered = stageTwo.length > 0 ? stageTwo
    : (input.omitStagePlaceholder === true ? [] : ['pl-placeholder-pl-stage-2']);
  const obligations = [
    gateObligation('pl-obligation-stage-1', [...stageOne, 'pl-gate-pl-stage-1'], 'pl-requirement-stage-1'),
    ...(stageTwoEmpty ? [] : [gateObligation('pl-obligation-stage-2', [...stageTwoCovered, 'pl-gate-pl-stage-2'],
      'pl-requirement-stage-2')]),
  ];
  if (goalGateId !== null) {
    obligations.push(gateObligation('pl-obligation-goal', [goalGateId], 'pl-requirement-goal'));
  }
  if (input.moduleGate !== undefined) {
    const gate = input.moduleGate;
    const taskId = gate.taskId ?? 'pl-gate-module';
    const workTaskId = gate.workTaskId ?? 'pl-module-work';
    tasks.push({ taskId: workTaskId, stageId: gate.stageId, title: `PL module work ${gate.moduleRef}`,
      requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
      scope: { kind: 'module', stageId: gate.stageId, moduleRef: gate.moduleRef },
      executionIntent: 'request_execution', sizeClass: 'small' });
    tasks.push({ taskId, stageId: gate.stageId, title: `PL module gate ${gate.moduleRef}`,
      requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending',
      scope: { kind: 'module', stageId: gate.stageId, moduleRef: gate.moduleRef } });
    obligations.push(gateObligation(`pl-obligation-${taskId}`, [workTaskId, taskId], `pl-requirement-${taskId}`));
  }
  return {
    schemaVersion: 2, planId: `pl-plan-${label}`, planRevision: 1, goalId: goal.goalId, stages, tasks,
    assignments: [...stageOne, ...stageTwo, ...(input.moduleGate === undefined
      ? [] : [input.moduleGate.workTaskId ?? 'pl-module-work'])].map(taskId => ({
      taskId, role: S6A_WORK_ROLE.templateId, instruction: `PL ${label} ${taskId}` })),
    obligations, taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
    taskRelations: [], inputRequirements: [],
  };
}

export type PLWorkflowWorld = {
  readonly world: S6AHostWorld;
  readonly main: S6ACardsWorkspace;
  readonly goal: GoalRef;
  close(): Promise<void>;
};

/**
 * The Work binding with the real `propose_future_plan` tool (PL-28): a Work Run
 * proposes a future Plan revision through the same tool real use gives it.
 */
export const PL_PROPOSE_FUTURE_TOOLS: S6AExtraBinding = {
  binding: bindingOf('s6a-work-binding', S6A_WORK_ROLE,
    'PL trusted work guidance with the future-plan tool', ['read']),
  mergeTools: ['propose_future_plan'],
};

/** The real Host world: memory by default, governance seeded, one existing Goal. The caller closes it. */
const PL_ROLE_BINDINGS: readonly S6AExtraBinding[] = [
  lineBinding('pl-workflow-adviser-binding', platformRoleProfile('adviser').template, 'PL workflow adviser'),
  lineBinding('pl-workflow-reviewer-binding', platformRoleProfile('reviewer').template, 'PL workflow reviewer'),
];

/** The Host input consumers the two PL lines need so a `refine:`/`planreview:` round is served promptly. */
const PL_ROLE_CONSUMERS = ['pl-workflow-adviser-binding', 'pl-workflow-reviewer-binding'].map(id => ({
  scope: S6A_SCOPE,
  sessionRef: { projectId: S6A_SCOPE.projectId, sessionId: `${id}-consumer` },
  goalRef: { aggregateType: 'Goal' as const, projectId: S6A_SCOPE.projectId, goalId: `${id}-consumer` },
  queryProfileId: id,
  heartbeatMs: 25,
}));

export async function openPLWorkflowWorld(options: {
  backend?: 'memory' | 'sqlite'; label?: string; extraHostOptions?: Record<string, unknown>;
  extraBindings?: readonly S6AExtraBinding[];
} = {}): Promise<PLWorkflowWorld> {
  const label = options.label ?? 'pl';
  const world = await openS6AHostWorld({ backend: options.backend ?? 'memory',
    extraBindings: [...PL_ROLE_BINDINGS, ...(options.extraBindings ?? [])],
    extraHostOptions: { inputConsumers: PL_ROLE_CONSUMERS, ...(options.extraHostOptions ?? {}) } });
  try {
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await world.setResumeOnStartup(false);
    await governS6B(world, main, world.goals);
    return {
      world, main, goal: world.goals.first,
      close: async () => { await world.close(); },
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** `plans/propose` + `plans/apply` of the two-stage skeleton; the adopted Plan and its task triples. */
export async function adoptPLTwoStageSkeleton(main: S6ACardsWorkspace, goal: GoalRef,
  input: PLSkeletonInput = {}): Promise<PLSkeleton> {
  const label = input.label ?? 'pl';
  const plan = await adoptPLPlanDraft(main, goal, plSkeletonDraft(goal, input), label);
  const stageOne = input.stageOneTaskIds ?? ['pl-a', 'pl-b'];
  const stageTwo = input.stageTwoTaskIds ?? [];
  const stageTwoCovered = stageTwo.length > 0 ? stageTwo
    : (input.omitStagePlaceholder === true ? [] : ['pl-placeholder-pl-stage-2']);
  const placeholderTaskIds = stageTwo.length === 0 && input.omitStagePlaceholder !== true
    ? ['pl-placeholder-pl-stage-2'] : [];
  const goalGateId = input.goalGate === true ? 'pl-gate-goal' : null;
  const stageTwoGate = stageTwo.length === 0 && input.omitStagePlaceholder === true ? [] : ['pl-gate-pl-stage-2'];
  const stageGateIds = ['pl-gate-pl-stage-1', ...stageTwoGate, ...(input.moduleGate === undefined
    ? [] : [input.moduleGate.taskId ?? 'pl-gate-module']), ...(goalGateId === null ? [] : [goalGateId])];
  const moduleWorkId = input.moduleGate === undefined ? [] : [input.moduleGate.workTaskId ?? 'pl-module-work'];
  const taskIds = [...stageOne, ...stageTwoCovered, ...placeholderTaskIds,
    ...(input.goalPlaceholderTaskId === undefined ? [] : [input.goalPlaceholderTaskId]), ...moduleWorkId, ...stageGateIds];
  return { plan, stageOneTasks: stageOne, stageTwoTasks: stageTwo, placeholderTaskIds, stageGateIds, goalGateId,
    tasks: [...new Set(taskIds)].map(taskId => ({ projectId: goal.projectId, goalId: goal.goalId, taskId })) };
}

/** One reviewer line through `sessions/create` with the existing platform reviewer role profile. */
export async function createPLReviewerLine(world: S6AHostWorld, main: S6ACardsWorkspace,
  label = 'pl-reviewer'): Promise<S6ASession> {
  const role = platformRoleProfile('reviewer').template;
  return await sessionOf(world, await createS6BLine(main, { label, role }));
}

/** A public target-level `workflow/advance`, returned exactly as the route answered it. */
export async function advancePLGoal(world: S6AHostWorld, goal: GoalRef, flowId: string): Promise<unknown> {
  return (await world.post('workflow/advance', plain(S6A_SCOPE, {
    schemaVersion: 1, goalRef: goal, flowId, sessionHint: null, kind: 'select_work',
  }))).body;
}

/** The public selection driven to its stop, a refinement send on the way performed; the stop as the route answered it. */
export async function settlePLGoal(world: S6AHostWorld, goal: GoalRef, flowId: string): Promise<unknown> {
  const steps = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId, sessionHint: null, kind: 'select_work' });
  return { status: 'ready', value: steps[steps.length - 1] };
}

type PLTaskRunOptions = {
  /** Leave the Run ended before this Workflow operation without running its checks. */
  stopBefore?: string;
  /** The usage the Run's model reply reports (PL-10's complete stage reading). */
  usage?: S6AUsage;
  /** The real `propose_future_plan` call the Work Run makes before it answers (PL-28). */
  propose?: { callId: string; basedOn: PlanRevisionSnapshot['ref']; draft: PlanRevisionDraft; reasonText: string };
};

/** One real task Run: claim, start, drive its check round and finalize it to `satisfied`. */
async function runPLTask(world: S6AHostWorld, goal: GoalRef, taskId: string, line: S6ASession, label: string,
  options: PLTaskRunOptions = {}): Promise<{ run: RunRef; proposal?: { ref: PlanProposalRef; revision: number } }> {
  const propose = options.propose;
  await world.scripted.script(line, propose === undefined
    ? [{ kind: 'text', text: `PL ${label} ${taskId} done`, ...(options.usage === undefined ? {} : { usage: options.usage }) }]
    : [
      { kind: 'calls', calls: [{ callId: propose.callId, name: 'propose_future_plan', args: {
        basedOn: propose.basedOn, draft: propose.draft,
        reason: { text: propose.reasonText, sources: [] }, expected: [],
      } }] },
      { kind: 'text', text: `PL ${label} ${taskId} done` },
    ]);
  const claim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: `pl-${label}-${taskId}`,
    sessionHint: line.ref, kind: 'select_work', taskId }, 'claim_task');
  const receipts: import('../../src/business/workflow/contracts.js').WorkflowStepReceipt[] = [];
  const stopBefore = options.stopBefore ?? 'open_checks';
  const steps: AdvanceValue[] = await driveWorkflow(world.ag2b, claim, { stopBefore, receipts });
  const claimed = claimedRunOf(receipts, taskId);
  if (options.stopBefore !== undefined) return { run: claimed.run };
  const openChecks = steps.at(-1)?.next;
  if (openChecks === null || openChecks === undefined || openChecks.kind !== 'perform'
    || openChecks.operation.kind !== 'open_checks') {
    throw new Error(`PL fixture: ${taskId} did not reach open_checks: ${JSON.stringify(steps.at(-1))}`);
  }
  await driveWorkflow(world.ag2b, openChecks);
  if (propose === undefined) return { run: claimed.run };
  // The receipt is the model's own tool message: same call, same output. Read the
  // committed proposal ref/revision back out of it instead of rebuilding an id.
  const requests = await world.scripted.requests(line);
  for (const request of [...requests].reverse()) {
    for (const message of request.messages) {
      if (message.role !== 'tool' || message.callId !== propose.callId) continue;
      if (message.result.status !== 'success') {
        throw new Error(`PL fixture: propose_future_plan failed: ${JSON.stringify(message.result)}`);
      }
      for (const output of message.result.output) {
        if (output.kind !== 'json') continue;
        const receipt = output.value as { status?: string; value?: { ref?: PlanProposalRef; revision?: number } };
        if (receipt.status !== 'committed' || receipt.value?.ref === undefined || receipt.value.revision === undefined) {
          throw new Error(`PL fixture: propose_future_plan did not commit: ${JSON.stringify(receipt)}`);
        }
        return { run: claimed.run, proposal: { ref: receipt.value.ref, revision: receipt.value.revision } };
      }
    }
  }
  throw new Error(`PL fixture: the ${taskId} Run has no propose_future_plan tool receipt`);
}

/** The one Run step: no options finishes the check round; `stopBefore` leaves it ended. */
export async function satisfyPLTask(world: S6AHostWorld, goal: GoalRef, taskId: string,
  line: S6ASession, label: string, options: { stopBefore?: string; usage?: S6AUsage } = {}): Promise<RunRef> {
  return (await runPLTask(world, goal, taskId, line, label, options)).run;
}

/** The same Run step with the real `propose_future_plan` call before the answer (PL-28). */
export async function satisfyPLTaskWithPropose(world: S6AHostWorld, goal: GoalRef, taskId: string,
  line: S6ASession, label: string, input: {
    basedOn: PlanRevisionSnapshot['ref']; draft: PlanRevisionDraft; reasonText: string;
  }): Promise<{ run: RunRef; proposalRef: PlanProposalRef; proposalRevision: number }> {
  const result = await runPLTask(world, goal, taskId, line, label, {
    propose: { callId: `pl-${label}-${taskId}-propose`, ...input },
  });
  if (result.proposal === undefined) throw new Error(`PL fixture: the ${taskId} Run wrote no proposal`);
  return { run: result.run, proposalRef: result.proposal.ref, proposalRevision: result.proposal.revision };
}

/** A v2 draft one revision on from `plan`, for a real `plans/propose` change (PL-04/26/27). */
export function plPlanChangeDraft(plan: PlanRevisionSnapshot, goal: GoalRef, input: {
  planId: string; tasks: readonly RuntimeTask[]; assignments: readonly PlanTaskAssignment[];
  obligations: readonly AcceptanceObligation[];
}): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: input.planId, planRevision: plan.planRevision + 1, goalId: goal.goalId,
    stages: structuredClone(plan.stages),
    tasks: structuredClone([...input.tasks]),
    assignments: structuredClone([...input.assignments]),
    obligations: structuredClone([...input.obligations]),
    taskHierarchy: structuredClone(plan.taskHierarchy),
    executionDag: structuredClone(plan.executionDag),
    ...(plan.taskRelations === undefined ? {} : { taskRelations: structuredClone(plan.taskRelations) }),
    ...(plan.inputRequirements === undefined
      ? {} : { inputRequirements: structuredClone(plan.inputRequirements) }),
  };
}

/**
 * Claim and start one task, holding its real model request in the entered Run.
 * `stopBefore` lets a row leave the Run ended but the Task unsatisfied (DR-P4-19):
 * `complete_task` is the last step after the checks round, before the reduction.
 */
export async function holdPLTaskRequest(world: S6AHostWorld, goal: GoalRef, taskId: string,
  line: S6ASession, label: string,
  options: { stopBefore?: string } = {}): Promise<{ run: RunRef; execution: TaskExecutionRecord; release: () => Promise<void> }> {
  const claim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: `pl-${label}-${taskId}`,
    sessionHint: line.ref, kind: 'select_work', taskId }, 'claim_task');
  const gate = await world.gates.modelRequest(line);
  const receipts: import('../../src/business/workflow/contracts.js').WorkflowStepReceipt[] = [];
  const driving = driveWorkflow(world.ag2b, claim, { receipts,
    ...(options.stopBefore === undefined ? {} : { stopBefore: options.stopBefore }) });
  await gate.reached;
  const receipt = receipts.find(item => item.kind === 'claim_task');
  if (receipt === undefined || receipt.result.status !== 'committed') {
    throw new Error(`PL fixture: ${taskId} was not claimed`);
  }
  const run = receipt.result.value.runRef;
  const execution = await readExecution(world.ag2b, run);
  if (execution.run.status !== 'running') throw new Error(`PL fixture: the ${taskId} Run is not entered`);
  return { run, execution, release: async () => { gate.release(); await driving; } };
}

/** `plans/propose` + `plans/apply` of one draft; the adopted Plan (PL-15/PL-50 use a full plan). */
export async function adoptPLPlanDraft(main: S6ACardsWorkspace, goal: GoalRef,
  draft: PlanRevisionDraft, label: string): Promise<PlanRevisionSnapshot> {
  const proposed = committed<{ ref: unknown; revision: number }>(await main.post('plans/propose', graphWrite(main.scope, {
    goalRef: goal, basedOn: null, draft, reason: { text: `PL plan ${label}`, sources: [] },
  }, `pl-plan-${label}-propose`)), `the Plan ${label}`);
  committed(await main.post('plans/apply', graphWrite(main.scope, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, `pl-plan-${label}-apply`)), `the adoption of ${label}`);
  const plan = await main.activePlan(goal);
  if (plan === null) throw new Error(`PL workflow: ${goal.goalId} has no adopted Plan after ${label}`);
  return plan;
}

/**
 * One complete single-stage plan (spec PL-15): the two-stage skeleton's first
 * stage only, no later placeholder, one required work/gate obligation. The
 * carrier list lets PL-50(c) make one Task the sole required carrier.
 */
export function plSingleStageDraft(goal: GoalRef, input: {
  label?: string; taskIds?: readonly string[]; carrierTaskIds?: readonly string[];
  estimatedLines?: number; goalGate?: boolean;
} = {}): PlanRevisionDraft {
  const label = input.label ?? 'pl-single';
  const taskIds = input.taskIds ?? ['pl-a', 'pl-b'];
  const base = plSkeletonDraft(goal, { label, stageOneTaskIds: taskIds });
  const tasks = base.tasks
    .filter(task => (task.stageId === 'pl-stage-1'
      || (task.taskKind === 'gate' && task.scope.kind === 'stage' && task.scope.stageId === 'pl-stage-1'))
      && task.taskId !== 'pl-gate-module')
    .map(task => input.estimatedLines === undefined || task.taskKind !== 'work' ? task
      : { ...task, estimatedLines: input.estimatedLines });
  const obligation = base.obligations.find(entry => entry.obligationId === 'pl-obligation-stage-1');
  if (obligation === undefined) throw new Error('PL workflow: the single-stage obligation is missing');
  const gate = input.goalGate === true ? goalGate('pl-gate-goal') : null;
  return {
    ...base,
    planId: `pl-plan-${label}`,
    stages: [base.stages[0]!],
    tasks: gate === null ? tasks : [...tasks, gate],
    assignments: (base.assignments ?? []).filter(assignment => taskIds.includes(assignment.taskId)),
    obligations: [
      { ...obligation, taskIds: [...(input.carrierTaskIds ?? [...taskIds, 'pl-gate-pl-stage-1'])] },
      ...(gate === null ? [] : [gateObligation('pl-obligation-goal', [gate.taskId], 'pl-requirement-goal')]),
    ],
  };
}

/** The first system-round message of `line` whose saved body starts with `prefix`. */
export async function plSystemRoundRef(workflow: PLWorkflowWorld, line: S6ASession,
  prefix: string): Promise<SessionMessageRef> {
  let found: SessionMessageRef | null = null;
  const read = async (): Promise<boolean> => {
    const messages = (await listed(workflow.world, 'inbox', line)).filter(message =>
      message.sender.kind === 'host' && message.sender.actor.kind === 'system');
    for (const message of messages) {
      const head = (await readSavedBody(workflow.world, message.ref, 'message')).split('\n')[0] ?? '';
      if (head.startsWith(prefix)) { found = message.ref; return true; }
    }
    return false;
  };
  await heartbeatUntil(workflow.world, read, value => value);
  if (found === null) throw new Error(`PL chain: the ${line.label} inbox has no ${prefix} system round`);
  return found;
}

/** Every Host system-round head in one line's inbox, in inbox order. */
export async function requestHeads(workflow: PLWorkflowWorld,
  line: Parameters<typeof listed>[2]): Promise<string[]> {
  const messages = (await listed(workflow.world, 'inbox', line)).filter(message =>
    message.sender.kind === 'host' && message.sender.actor.kind === 'system');
  return await Promise.all(messages.map(async message =>
    (await readSavedBody(workflow.world, message.ref, 'message')).split('\n')[0] ?? ''));
}

/** Posts the selection until the requested perform is the next step, then performs exactly that one step. */
export async function performOne(workflow: PLWorkflowWorld, flowId: string,
  kind: 'send_system_round' | 'adopt_plan'): Promise<Record<string, unknown>> {
  const step = await advanceUntil(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId, sessionHint: null, kind: 'select_work' }, kind);
  const answer = await workflow.world.post('workflow/advance', plain(S6A_SCOPE, step));
  const body = answer.body as Record<string, unknown>;
  if (body['status'] !== 'ready') throw new Error(`PL chain: the ${kind} step was ${JSON.stringify(body)}`);
  return body;
}

/** The verdict of the one review Query a `planreview:` round opened. */
export async function verdictOf(workflow: PLWorkflowWorld,
  ref: Awaited<ReturnType<typeof plSystemRoundRef>>): Promise<string> {
  const query = await awaitPlanningAnswer(workflow.world, ref, 48);
  if (query === null) throw new Error('PL chain: the review Query was not answered');
  const answer = await heartbeatUntil(workflow.world, () => readQueryAnswer(workflow.world, query.job.ref),
    value => value !== null, 16);
  const parsed = answer === null ? null : parsePlanReviewAnswer(answer);
  if (parsed === null || parsed.status !== 'parsed') {
    throw new Error(`PL chain: the review answer is ${String(answer)}`);
  }
  return parsed.verdict;
}

/** A v2 draft one revision on from `plan` that makes the stage-2 placeholder executable. */
export function plStageTwoDraft(plan: PlanRevisionSnapshot, goal: GoalRef, label: string): PlanRevisionDraft {
  const placeholder = plan.tasks.find(task => task.taskId === 'pl-placeholder-pl-stage-2');
  if (placeholder === undefined) throw new Error('PL chain: the stage-2 placeholder is missing');
  return plPlanChangeDraft(plan, goal, {
    planId: plan.planId,
    tasks: plan.tasks.map(task => task.taskId === placeholder.taskId
      ? { ...task, executionIntent: 'request_execution' as const, estimatedLines: 10, sizeClass: 'small' as const }
      : task),
    assignments: [...(plan.assignments ?? []), { taskId: placeholder.taskId,
      role: S6A_WORK_ROLE.templateId, instruction: `PL ${label} refined stage 2 work` }],
    obligations: plan.obligations,
  });
}

/** The `submit_plan_round` tool's plan shape: no identity fields and no runtime `phase`. */
export function plToolPlanOf(draft: PlanRevisionDraft): Record<string, unknown> {
  return {
    stages: draft.stages,
    tasks: draft.tasks.map(task => {
      const { phase: _phase, ...rest } = task;
      return rest;
    }),
    ...(draft.assignments === undefined ? {} : { assignments: draft.assignments }),
    obligations: draft.obligations,
    taskHierarchy: draft.taskHierarchy,
    executionDag: draft.executionDag,
    ...(draft.taskRelations === undefined ? {} : { taskRelations: draft.taskRelations }),
    ...(draft.inputRequirements === undefined ? {} : { inputRequirements: draft.inputRequirements }),
  };
}

export type PLChain = {
  readonly workflow: PLWorkflowWorld;
  readonly skeleton: PLSkeleton;
  readonly line: S6ASession;
  readonly adviser: S6ASession;
  readonly reviewer: S6ASession;
  /** The candidate the Goal loop reads (the adviser's, the Work Run's or the normal agent's). */
  readonly candidate: PlanProposal;
  readonly reviewRef: SessionMessageRef;
};

export type PLAutomaticChain = PLChain & {
  /** PL-28: the Work Run's own `propose_future_plan` receipt, when that option wrote the candidate. */
  readonly toolProposal?: { ref: PlanProposalRef; revision: number };
  /** Only let the held review `pass` go; the Goal driver takes it from there (PL-42). */
  releaseReview(): void;
  /** Release the held review `pass`, let the platform adopt, and leave stage 2 entered. */
  release(): Promise<void>;
};

type PLChainOptions = {
  backend?: 'memory' | 'sqlite';
  /** Bindings the world needs (PL-28's `propose_future_plan`). */
  extraBindings?: readonly S6AExtraBinding[];
  /** The last stage-1 Work Run makes this real tool call before it answers (PL-28). */
  propose?: { draft: PlanRevisionDraft; reasonText: string }
    | ((skeleton: PLSkeleton, goal: GoalRef) => { draft: PlanRevisionDraft; reasonText: string });
  /** A normal agent candidate written through `plans/propose` (PL-29). */
  draft?: PlanRevisionDraft | ((skeleton: PLSkeleton, goal: GoalRef) => PlanRevisionDraft);
  /** Extra real steps before the stage-1 Runs (PL-28/29 create the person's request slot here). */
  beforeRuns?: (context: { workflow: PLWorkflowWorld; skeleton: PLSkeleton }) => Promise<void>;
  /** The reviewer's scripted reply instead of the tool `pass` with no findings (A-02, A-03). */
  reviewReply?: S6AReply;
};

type PLOpenedChain = PLChain & {
  reviewHold: { release(): void };
  toolProposal?: { ref: PlanProposalRef; revision: number };
};

/** Perform exactly the one `send_system_round` the Goal selected; a repeat is the same message. */
async function performPLSend(workflow: PLWorkflowWorld, flowId: string): Promise<void> {
  const send = await advanceUntil(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId, sessionHint: null, kind: 'select_work' }, 'send_system_round');
  const answer = await workflow.world.post('workflow/advance', plain(S6A_SCOPE, send));
  if ((answer.body as { status?: string }).status !== 'ready') {
    throw new Error(`PL chain: the ${flowId} send was not ready: ${JSON.stringify(answer.body)}`);
  }
}

/** The shared real chain body: one world, real role lines, the scripted answers, Host consumption. */
async function openPLChain(label: string, autonomy: 'after_plan_confirmation' | 'every_step',
  options: PLChainOptions = {}): Promise<PLOpenedChain> {
  const workflow = await openPLWorkflowWorld({ label,
    ...(options.backend === undefined ? {} : { backend: options.backend }),
    ...(options.extraBindings === undefined ? {} : { extraBindings: options.extraBindings }),
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  try {
    const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
      label, stageOneTaskIds: ['pl-a', 'pl-b'],
    });
    await setS7AAutonomy(workflow.world, workflow.goal, autonomy);
    const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
      label: `${label}-line`, role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task =>
        ['pl-a', 'pl-b'].includes(task.taskId)),
    }));
    const adviser = await createPLAdviserLine(workflow.world, `${label}-adviser`);
    const reviewer = await createPLReviewerLine(workflow.world, workflow.main, `${label}-reviewer`);
    const propose = options.propose === undefined ? undefined
      : typeof options.propose === 'function' ? options.propose(skeleton, workflow.goal) : options.propose;
    if (propose !== undefined) {
      await workflow.world.scripted.script(adviser, [{ kind: 'text', text: `PL ${label} adviser idle` }]);
    } else {
      await workflow.world.scripted.script(adviser, [{ kind: 'calls', calls: [{
        callId: `${label}-refine`, name: 'submit_plan_round', args: {
          answerKind: 'plan', summary: `PL ${label} stage 2`,
          plan: plToolPlanOf(plStageTwoDraft(skeleton.plan, workflow.goal, label)),
          reason: { text: `PL ${label} stage 2 refinement`, affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
        } }] }]);
    }
    await workflow.world.scripted.script(reviewer, [options.reviewReply ?? { kind: 'calls', calls: [{
      callId: `${label}-review`, name: 'submit_plan_review', args: { verdict: 'pass', findings: [] },
    }] }]);
    if (options.beforeRuns !== undefined) await options.beforeRuns({ workflow, skeleton });
    await satisfyPLTask(workflow.world, workflow.goal, 'pl-a', line, label);
    let toolProposal: { ref: PlanProposalRef; revision: number } | undefined;
    if (propose === undefined) {
      await satisfyPLTask(workflow.world, workflow.goal, 'pl-b', line, label);
    } else {
      const proposed = await satisfyPLTaskWithPropose(workflow.world, workflow.goal, 'pl-b', line, label, {
        basedOn: skeleton.plan.ref, draft: propose.draft, reasonText: propose.reasonText,
      });
      toolProposal = { ref: proposed.proposalRef, revision: proposed.proposalRevision };
    }
    const draft = options.draft === undefined ? undefined
      : typeof options.draft === 'function' ? options.draft(skeleton, workflow.goal) : options.draft;
    if (draft !== undefined) {
      const written = await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
        goalRef: workflow.goal, basedOn: skeleton.plan.ref, draft,
        reason: { text: `PL ${label} normal agent candidate`, sources: [] },
      }, `${label}-agent-propose`));
      if ((written as { status?: string }).status !== 'committed') {
        throw new Error(`PL chain: the ${label} agent candidate was not written: ${JSON.stringify(written)}`);
      }
    }
    // Without a pre-written/tool candidate the Goal first sends the one `refine:`; the
    // Host consumes the adviser's real answer before the candidate exists.
    if (propose === undefined && draft === undefined) {
      await performPLSend(workflow, `${label}-refine`);
      const refineRef = await plSystemRoundRef(workflow, adviser, `refine:${workflow.goal.goalId}:pl-stage-2:`);
      await waitForResponse(workflow.world, refineRef);
    }
    // Hold the reviewer's request before its `pass`; the Goal must not adopt yet.
    const reviewHold = await workflow.world.gates.modelRequest(reviewer);
    await performPLSend(workflow, `${label}-review`);
    const reviewRef = await plSystemRoundRef(workflow, reviewer, 'planreview:');
    // The pass reaching the held reviewer request blocks until `release`, so its
    // barrier is not awaited here.
    await heartbeatUntilModel(workflow.world, reviewHold);
    const head = (await readSavedBody(workflow.world, reviewRef, 'message')).split('\n')[0] ?? '';
    const proposalId = head.slice('planreview:'.length).split(':')[0] ?? '';
    const candidate = await readProposal(workflow.world, {
      aggregateType: 'PlanProposal', projectId: workflow.goal.projectId,
      workspaceId: S6A_SCOPE.workspaceId, proposalId,
    });
    return { workflow, skeleton, line, adviser, reviewer, candidate, reviewRef,
      reviewHold: { release: () => reviewHold.release() }, ...(toolProposal === undefined ? {} : { toolProposal }) };
  } catch (error) {
    await workflow.close();
    throw error;
  }
}

/**
 * The disposition-only candidate PL-37 and PL-44 adopt: A becomes `superseded` by a new A2 of the same stage, A stays
 * in the obligation as a carrier and its assignment and execution definition do not change.
 */
export function plSupersedeDraft(plan: PlanRevisionSnapshot, goal: GoalRef, label: string): PlanRevisionDraft {
  const a2: RuntimeTask = {
    taskId: 'pl-a2', stageId: 'pl-stage-1', title: `${label} replacement A2`, requirementLevel: 'required',
    taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'stage', stageId: 'pl-stage-1' }, executionIntent: 'request_execution', sizeClass: 'small',
  };
  return plPlanChangeDraft(plan, goal, {
    planId: `pl-plan-${label}-v2`,
    tasks: [...plan.tasks.map(task => task.taskId === 'pl-a'
      ? { ...task, disposition: 'superseded' as const, replacedByTaskId: 'pl-a2' } : task), a2],
    assignments: [...(plan.assignments ?? []),
      { taskId: 'pl-a2', role: S6A_WORK_ROLE.templateId, instruction: `${label} replacement A2 instruction` }],
    obligations: plan.obligations.map(obligation => obligation.obligationId === 'pl-obligation-stage-1'
      ? { ...obligation, taskIds: [...obligation.taskIds, 'pl-a2'] } : obligation),
  });
}

/** One stage-2 text answer for the reused Work line, so the adopted task's Run has a real reply. */
async function scriptPLStageTwo(workflow: PLWorkflowWorld, line: S6ASession, label: string): Promise<void> {
  await workflow.world.scripted.script(line, [{ kind: 'text', text: `PL ${label} stage 2 done` }]);
}

/**
 * PL-03/22's one automatic chain: stage gate, one `refine:`, the adviser's real
 * answer through Host consumption, one held `planreview:`, then `pass`, automatic
 * adoption and the stage-2 Run. `release` performs that second half.
 */
export async function runPLAutomaticChain(label: string,
  options: PLChainOptions = {}): Promise<PLAutomaticChain> {
  const opened = await openPLChain(label, 'after_plan_confirmation', options);
  return { workflow: opened.workflow, skeleton: opened.skeleton, line: opened.line,
    adviser: opened.adviser, reviewer: opened.reviewer, candidate: opened.candidate, reviewRef: opened.reviewRef,
    ...(opened.toolProposal === undefined ? {} : { toolProposal: opened.toolProposal }),
    releaseReview: () => opened.reviewHold.release(),
    release: async () => {
      opened.reviewHold.release();
      await waitForResponse(opened.workflow.world, opened.reviewRef);
      await scriptPLStageTwo(opened.workflow, opened.line, label);
      await driveWorkflow(opened.workflow.world.ag2b, { schemaVersion: 1, goalRef: opened.workflow.goal,
        flowId: `${label}-adopt`, sessionHint: null, kind: 'select_work' }, { stopBefore: 'open_checks' });
    } };
}

/**
 * PL-04/26's one every-step chain: the same real refinement/review, then release
 * `pass` and one Goal pass. `every_step` leaves the candidate for the person.
 */
export async function runPLEveryStepChain(label: string,
  options: PLChainOptions = {}): Promise<PLChain> {
  const opened = await openPLChain(label, 'every_step', options);
  opened.reviewHold.release();
  await waitForResponse(opened.workflow.world, opened.reviewRef);
  const pass = await opened.workflow.world.post('workflow/advance', plain(S6A_SCOPE, { schemaVersion: 1,
    goalRef: opened.workflow.goal, flowId: `${label}-every-step`, sessionHint: null, kind: 'select_work' }));
  if ((pass.body as { status?: string }).status !== 'ready') {
    throw new Error(`PL chain: the ${label} every-step pass was not ready: ${JSON.stringify(pass.body)}`);
  }
  return { workflow: opened.workflow, skeleton: opened.skeleton, line: opened.line,
    adviser: opened.adviser, reviewer: opened.reviewer, candidate: opened.candidate, reviewRef: opened.reviewRef };
}
