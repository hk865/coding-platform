/**
 * One real S7B Host for the L46 rows: A/B/C/D, A's failed Run and its card (the legacy variant also declares D's
 * exact input). Every state is a public step and a public read; no record, context or card is built, nothing is read
 * from the store.
 */
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { ResolveDecisionReadV1, WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { driveWorkflow } from './A2-restart-fixture.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6AWorldOptions } from './S6A-request-fixture.js';
import { openS7BWorld } from './S7B-fixture.js';
import { createS6BLine } from './S6B1-fixture.js';
import { checkConfiguration, committed, ready, sessionOf } from './S7A-fixture.js';

const TASKS = { A: 's7b3-a', B: 's7b3-b', C: 's7b3-c', D: 's7b3-d' } as const;

/** A/B/C/D, C's `gate-result` edge on A, D's advisory `expected_dependency`; the legacy revision adds D's input. */
function l46Draft(input: { goalId: string; planId: string; planRevision: number; legacy?: ArtifactRef }): PlanRevisionDraft {
  const work = [TASKS.A, TASKS.B, TASKS.D];
  return {
    schemaVersion: 2, planId: input.planId, planRevision: input.planRevision, goalId: input.goalId, stages: [],
    tasks: [
      ...work.map(taskId => ({ taskId, title: `S7B3 ${taskId} work`, requirementLevel: 'required' as const,
        taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const,
        scope: { kind: 'goal' as const }, executionIntent: 'request_execution' as const })),
      { taskId: TASKS.C, title: 'S7B3 C gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: work.map(taskId => ({ taskId, role: S6A_WORK_ROLE.templateId, instruction: `S7B3 ${taskId}` })),
    obligations: [{ obligationId: 's7b3-obligation', title: 'S7B3 L46 work', requirementLevel: 'required',
      taskIds: [...work, TASKS.C], verificationRequirements: [{ requirementId: 's7b3-static',
        requirementLevel: 'required', kind: 'static', description: 'S7B3 static check' }] }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [{ taskId: TASKS.C, dependsOnId: TASKS.A,
      requires: { kind: 'gate-result', label: 's7b3-gate-result-A' } }] },
    taskRelations: [{ fromTaskId: TASKS.D, toTaskId: TASKS.A, kind: 'expected_dependency',
      note: 'S7B3 D expects A; advisory, never a dispatch prerequisite' }],
    ...(input.legacy === undefined ? {} : { inputRequirements: [{ requirementId: 's7b3-legacy-A',
      consumerTaskId: TASKS.D, kind: 'artifact' as const, artifactRef: input.legacy }] }),
  };
}

/** `plans/propose` + `plans/apply` of the next revision; `legacy` is D's exact input on the legacy revision. */
export async function adoptL46Plan(ws: S6ACardsWorkspace, goal: GoalRef,
  input: { planId: string; label: string; legacy?: ArtifactRef }): Promise<PlanRevisionSnapshot> {
  const current = await ws.activePlan(goal);
  const draft = l46Draft({ goalId: goal.goalId, planId: input.planId,
    planRevision: (current?.planRevision ?? 0) + 1, ...(input.legacy === undefined ? {} : { legacy: input.legacy }) });
  const proposed = committed<{ ref: unknown; revision: number }>(await ws.post('plans/propose', graphWrite(ws.scope, {
    goalRef: goal, basedOn: current?.ref ?? null, draft, reason: { text: `S7B3 L46 ${input.label}`, sources: [] },
  }, `s7b3-l46-propose-${input.label}`)), `the Plan ${input.label}`);
  committed(await ws.post('plans/apply', graphWrite(ws.scope, { proposalRef: proposed.ref,
    expectedProposalRevision: proposed.revision, decisionRefs: [] }, `s7b3-l46-apply-${input.label}`)),
  `the adoption of ${input.label}`);
  const plan = await ws.activePlan(goal);
  if (plan === null) throw new Error(`S7B3 L46: ${goal.goalId} has no adopted Plan after ${input.label}`);
  return plan;
}

/** E25: `legacyOnD: true` runs steps 1–6 (legacy revision before A starts); `false` runs 1, 2, 3, 5, 6. */
export async function openS7BL46World(options: S6AWorldOptions & { legacyOnD?: boolean }) {
  const { legacyOnD = false, ...worldOptions } = options;
  const actor: { kind: 'human'; id: string } = worldOptions.actor !== undefined
    && worldOptions.actor.kind === 'human'
    ? { kind: 'human', id: worldOptions.actor.id } : { kind: 'human', id: OPERATOR.id };
  const { world } = await openS7BWorld({
    ...worldOptions,
    extraHostOptions: { checks: checkConfiguration(actor), ...(worldOptions.extraHostOptions ?? {}) },
  });
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  const goal = world.goals.first;
  const planRef = (await adoptL46Plan(ws, goal, { planId: 's7b3-l46-plan', label: 'first' })).ref;
  const read = ready<{ goal: { revision: number } }>(await ws.route('goals/settings',
    { goalRef: goal }), 'the Goal settings');
  committed(await ws.post('goals/settings/set', graphWrite(ws.scope, {
    goalRef: goal, autonomy: 'every_step', waitForGoalRef: null,
  }, 's7b3-l46-every-step', [{ ref: goal, revision: read.goal.revision }])), 'the every_step setting');
  const task = (taskId: string): TaskTriple => ({ projectId: goal.projectId, goalId: goal.goalId, taskId });
  const tasks = { A: task(TASKS.A), B: task(TASKS.B), C: task(TASKS.C), D: task(TASKS.D) };
  const lineA = await createS6BLine(ws, { label: 's7b3-l46-a', role: S6A_WORK_ROLE, tasks: [tasks.A] });
  await createS6BLine(ws, { label: 's7b3-l46-b', role: S6A_WORK_ROLE, tasks: [tasks.B] });
  const receipts: WorkflowStepReceipt[] = [];
  const prepared = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 's7b3-l46-a',
    sessionHint: lineA.ref, kind: 'select_work', taskId: tasks.A.taskId }, { stopBefore: 'start', receipts });
  const next = prepared.at(-1)?.next;
  if (next === null || next === undefined) throw new Error('S7B3 L46: A prepared without a start step');
  let bundleRef: ArtifactRef | null = null;
  let legacyPlanRef: PlanRevisionRef | null = null;
  if (legacyOnD) {
    const prepare = receipts.find(entry => entry.kind === 'prepare');
    bundleRef = prepare?.kind === 'prepare' && prepare.result.status === 'ready'
      ? prepare.result.value.envelope.bundleRef : null;
    if (bundleRef === null) throw new Error('S7B3 L46: the prepared A Run has no public envelope.bundleRef');
    legacyPlanRef = (await adoptL46Plan(ws, goal, {
      planId: 's7b3-l46-plan-legacy', label: 'legacy', legacy: bundleRef })).ref;
  }
  await world.scripted.script(await sessionOf(world, lineA), [{ kind: 'fail', message: 'S7B3 A fails' }]);
  await driveWorkflow(world.ag2b, next);
  const run = await ws.taskRun(goal, tasks.A.taskId);
  if (run === null) throw new Error('S7B3 L46: A lost its Run');
  const ended = ready<TaskExecutionRecord>(await world.post('executions/read',
    plain(S6A_SCOPE, run)), 'the failed A Run');
  if (ended.run.status !== 'ended'
    || (ended.run.outcome !== 'failed' && ended.run.outcome !== 'crashed'))
    throw new Error(`S7B3 L46: A did not end failed/crashed: ${JSON.stringify(ended.run)}`);
  return { world, goalRef: goal, tasks, run, bundleRef, planRef, legacyPlanRef };
}

/** The raw `tasks/requeue` answer (E27: the person's covering requeue is the applied rework). */
export type L46RequeueAnswer = { status?: string; code?: string; reason?: string };

/** The Task a `claim_task`/`create_session` step selects; every other step continues the same Task. */
export function selectedL46Task(next: WorkflowAdvanceInput | null): string | null {
  if (next?.kind !== 'perform') return null;
  if (next.operation.kind === 'create_session') return next.operation.taskRef.taskId;
  if (next.operation.kind !== 'claim_task') return null;
  return (next.operation.request.input as { taskId?: string }).taskId ?? null;
}

/** The public card read: the queue's one `goal_cause` card by its `automation_confirmation_required` source. */
export async function readL46Card(world: S6AHostWorld, goalRef: GoalRef): Promise<DecisionCardV1> {
  const queue = ready<DecisionQueueReadV1>(await world.post('decisions/queue', plain(S6A_SCOPE,
    { workspace: S6A_SCOPE, goalRef, sections: ['waiting_answer'], page: { limit: 100 } })),
  'the L46 queue');
  const listed = queue.waitingAnswer.find(card => card.source.kind === 'goal_cause'
    && (JSON.parse(card.source.key) as { code?: string }).code === 'automation_confirmation_required');
  if (listed === undefined) throw new Error('S7B3 L46: the automatic-rework card is not in the queue');
  return ready<DecisionCardV1>(await world.post('decisions/card',
    plain(S6A_SCOPE, { source: listed.source })), 'the L46 card');
}

/**
 * Queue, the automation card (by its `automation_confirmation_required` source, never the display card), the
 * answer, and — with `apply` — the person's public covering `tasks/requeue` of A. No option and no advance is
 * invented; the caller drives `workflow/advance`.
 */
export async function applyL46Card(world: S6AHostWorld, input: {
  goalRef: GoalRef; label: string;
  apply?: { taskRef: TaskTriple; run: RunRef };
}): Promise<{ card: DecisionCardV1; resolution: ResolveDecisionReadV1; requeue: L46RequeueAnswer | null }> {
  const card = await readL46Card(world, input.goalRef);
  const resolution = ready<ResolveDecisionReadV1>(await world.post('decisions/answer', graphWrite(S6A_SCOPE, {
    source: card.source, selection: { kind: 'other' }, text: '', annotations: [],
  }, `s7b3-l46-answer-${input.label}`, card.source.pins)), 'the L46 answer');
  if (input.apply === undefined) return { card, resolution, requeue: null };
  const answer = resolution.answer;
  if (answer.status !== 'committed') throw new Error(`S7B3 L46: the ${input.label} answer did not commit`);
  const goal = ready<{ goal: { revision: number } }>(await world.post('goals/read',
    plain(S6A_SCOPE, input.goalRef)), 'the L46 Goal');
  const afterRun = ready<{ run: { revision: number } }>(await world.post('executions/read',
    plain(S6A_SCOPE, input.apply.run)), 'the L46 afterRun');
  const requeue = (await world.post('tasks/requeue', graphWrite(S6A_SCOPE, {
    taskRef: input.apply.taskRef, afterRunRef: input.apply.run,
    reason: `S7B3 L46: apply the confirmed rework (${input.label})`, acknowledgement: answer.value.ref,
  }, `s7b3-l46-requeue-${input.label}`, [{ ref: input.goalRef, revision: goal.goal.revision },
    { ref: input.apply.run, revision: afterRun.run.revision }]))).body as L46RequeueAnswer;
  return { card, resolution, requeue };
}
