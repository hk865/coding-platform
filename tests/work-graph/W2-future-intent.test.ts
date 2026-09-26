/**
 * W2 future-intent behavior tests (Stage 1 skeleton, real writers, memory + SQLite).
 *
 * These are the FINAL target tests for `docs/refactor/tasks/W2-future-intent-
 * skeleton.md` §8/§9.3. Every Plan/Session/claim below is produced by the real
 * public writers over the real `task-claim-fixture`; the only seeded facts are
 * the trusted Project/Workspace/governance rows the fixture already owns. There
 * is no raw accepted-Plan seed.
 *
 * `plan-validation.ts`/`plan-service.ts` recognize the new `executionIntent`
 * branch but stop at an explicit `unsupported` seam in Stage 1, so every
 * scenario that needs a real intent adoption is RED at that seam. The Stage-1
 * failure reason is reported, never asserted: the tests only assert the frozen
 * target behavior. Later assertions in a scenario are written out and simply do
 * not execute until the adoption seam is implemented.
 */
import { expect, it } from 'vitest';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask,
} from '../../src/contracts/plan.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { decodePlanRevisionSnapshot } from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import type { EncodedRecord, PreparedCommit } from '../../src/core/record-store/ports.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createTaskClaimFixture, CLAIM_FIXTURE_AT, type Records, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';

type PlanDraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;
type SnapshotV1 = Extract<PlanRevisionSnapshot, { schemaVersion: 1 }>;

function workNode(taskId: string, title: string, executionIntent?: RuntimeTask['executionIntent']): RuntimeTask {
  return { taskId, title, requirementLevel: 'required', taskKind: 'work', disposition: 'active',
    phase: 'pending', scope: { kind: 'goal' },
    ...(executionIntent === undefined ? {} : { executionIntent }) };
}
function gateNode(taskId: string, title: string): RuntimeTask {
  return { taskId, title, requirementLevel: 'required', taskKind: 'gate', disposition: 'active',
    phase: 'pending', scope: { kind: 'goal' } };
}
function withExecutionIntent(tasks: readonly RuntimeTask[], index: number,
  intent: NonNullable<RuntimeTask['executionIntent']>): RuntimeTask[] {
  return tasks.map((task, position) => position === index ? { ...task, executionIntent: intent } : task);
}
function withRawExecutionIntent(tasks: readonly RuntimeTask[], index: number, intent: unknown): RuntimeTask[] {
  return tasks.map((task, position) => position === index
    ? { ...task, executionIntent: intent as NonNullable<RuntimeTask['executionIntent']> } : task);
}
/** A complete v2 future draft derived from a REAL accepted source, preserving
 * every source task/assignment/obligation/hierarchy/DAG/relation/input field. */
function futureDraftFrom(plan: PlanRevisionSnapshot, planId: string,
  mutate: (draft: PlanDraftV2) => PlanDraftV2 = (draft) => draft): PlanDraftV2 {
  const base: PlanDraftV2 = {
    schemaVersion: 2, planId, planRevision: plan.planRevision + 1, goalId: plan.goalRef.goalId,
    stages: structuredClone(plan.stages), tasks: structuredClone(plan.tasks),
    assignments: structuredClone(plan.assignments ?? []), obligations: structuredClone(plan.obligations),
    taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
    taskRelations: plan.schemaVersion === 2 ? structuredClone(plan.taskRelations ?? []) : [],
    inputRequirements: plan.schemaVersion === 2 ? structuredClone(plan.inputRequirements ?? []) : [],
    ...(plan.reviewAdmissionProtocol === undefined ? {} : { reviewAdmissionProtocol: plan.reviewAdmissionProtocol }),
  };
  return mutate(base);
}
function initialDraft(goalId: string, planId: string, planRevision: number,
  tasks: readonly RuntimeTask[], assignments: NonNullable<PlanDraftV2['assignments']> = []): PlanDraftV2 {
  return { schemaVersion: 2, planId, planRevision, goalId, stages: [], tasks: [...tasks],
    assignments: [...assignments], obligations: [], taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
}
function legacyFullDraft(goalId: string, planId: string, planRevision: number): PlanDraftV2 {
  return { schemaVersion: 2, planId, planRevision, goalId, stages: [],
    tasks: [workNode('deliver', 'Deliver the result'), gateNode('gate-goal', 'Goal gate')],
    assignments: [{ taskId: 'deliver', role: 'builder', instruction: 'Deliver the result' }],
    obligations: [{ obligationId: 'o-deliver', title: 'Deliver', requirementLevel: 'required',
      taskIds: ['deliver', 'gate-goal'],
      verificationRequirements: [{ requirementId: 'check-deliver', requirementLevel: 'required',
        kind: 'test', description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
}
function planServiceOver(records: Records, tag: string): ReturnType<typeof createPlanService> {
  let n = 0;
  return createPlanService({ records, now: () => CLAIM_FIXTURE_AT, eventId: () => `w2-${tag}-${++n}` });
}

async function createSecondGoal(f: TaskClaimFixture, goalId: string): Promise<GoalRef> {
  const created = await f.goals.createGoal(f.ctx, { meta: { requestId: `w2-create-${goalId}`,
    expected: [{ ref: f.projectRef, revision: 1 }, { ref: f.workspaceRef, revision: 1 }] },
    input: { goalId, workspace: f.scope, objective: 'W2 initial intent goal' } });
  if (created.status !== 'committed') throw new Error(`W2 second Goal creation failed: ${JSON.stringify(created)}`);
  return { aggregateType: 'Goal', projectId: f.scope.projectId, goalId };
}
async function expectedPins(f: TaskClaimFixture, goalRef: GoalRef, sessionRef: SessionRef): Promise<VersionPin[]> {
  const goalRead = await f.plans.queryGoal(f.ctx, goalRef);
  if (goalRead.status !== 'ready') throw new Error(`W2 goal read failed: ${JSON.stringify(goalRead)}`);
  const workspaceKey = canonicalRefKey(f.workspaceRef);
  const workspaceRead = await f.records.readMany([workspaceKey]);
  if (workspaceRead.status !== 'ready') throw new Error(`W2 workspace read failed: ${JSON.stringify(workspaceRead)}`);
  const workspaceRecord = workspaceRead.value.records.find((record) => record.refKey === workspaceKey);
  if (workspaceRecord === undefined) throw new Error('W2 workspace record is absent');
  const workspaceRevision = (JSON.parse(workspaceRecord.json) as { revision: number }).revision;
  return [{ ref: goalRef, revision: goalRead.value.goal.revision },
    { ref: f.workspaceRef, revision: workspaceRevision },
    await f.sessionPin(sessionRef)];
}
async function proposeAndApply(f: TaskClaimFixture, goalRef: GoalRef, basedOn: PlanRevisionRef | null,
  draft: PlanRevisionDraft, tag: string): Promise<WriteResult<PlanRevisionSnapshot>> {
  const proposed = await f.plans.proposePlan(f.ctx, { meta: { requestId: `${tag}-propose`, expected: [] },
    input: { goalRef, basedOn, draft, reason: { text: `${tag} revision`, sources: [] } } });
  if (proposed.status !== 'committed') throw new Error(`${tag} proposal failed: ${JSON.stringify(proposed)}`);
  return f.plans.applyPlanChange(f.ctx, { meta: { requestId: `${tag}-apply`, expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
}

it('codec: v2 accepts executionIntent; v1, gate and unknown values are rejected', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const base = f.plan as SnapshotV1;
    const record = (body: unknown) => ({ refKey: canonicalJson(base.ref as unknown as JsonValue),
      schemaId: 'PlanRevisionSnapshot@1', revision: 1, json: JSON.stringify(body) });
    const v2: PlanRevisionSnapshot = { ...base, schemaVersion: 2, taskRelations: [], inputRequirements: [] };
    expect(decodePlanRevisionSnapshot(record({ ...v2, tasks: withExecutionIntent(v2.tasks, 0, 'plan_only') })))
      .toMatchObject({ status: 'decoded' });
    expect(decodePlanRevisionSnapshot(record({ ...v2, tasks: withExecutionIntent(v2.tasks, 0, 'request_execution') })))
      .toMatchObject({ status: 'decoded' });
    expect(decodePlanRevisionSnapshot(record({ ...v2, tasks: withRawExecutionIntent(v2.tasks, 0, 'sometimes') })))
      .toMatchObject({ status: 'invalid' });
    expect(decodePlanRevisionSnapshot(record(v2))).toMatchObject({ status: 'decoded' });
    // v1 bans the field in the PARENT version branch, not only the enum.
    expect(decodePlanRevisionSnapshot(record({ ...base, tasks: withExecutionIntent(base.tasks, 0, 'plan_only') })))
      .toMatchObject({ status: 'invalid' });
    const gateIndex = base.tasks.findIndex((task) => task.taskKind === 'gate');
    expect(gateIndex).toBeGreaterThanOrEqual(0);
    expect(decodePlanRevisionSnapshot(record({ ...v2, tasks: withExecutionIntent(v2.tasks, gateIndex, 'plan_only') })))
      .toMatchObject({ status: 'invalid' });
  } finally { await f.close(); }
});

it('legacy full v1/v2 without executionIntent still adopts; empty/optional-only legacy shapes are rejected', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const goalRef = await createSecondGoal(f, 'w2-legacy-goal');
    const full = await proposeAndApply(f, goalRef, null, legacyFullDraft(goalRef.goalId, 'w2-legacy-plan', 1), 'w2-legacy');
    expect(full, JSON.stringify(full)).toMatchObject({ status: 'committed' });

    const other = await createSecondGoal(f, 'w2-legacy-reject-goal');
    const empty: PlanDraftV2 = { schemaVersion: 2, planId: 'w2-empty-plan', planRevision: 1,
      goalId: other.goalId, stages: [], tasks: [], assignments: [], obligations: [],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
    const emptyProposal = await f.plans.proposePlan(f.ctx, { meta: { requestId: 'w2-empty-propose', expected: [] },
      input: { goalRef: other, basedOn: null, draft: empty, reason: { text: 'empty legacy shape', sources: [] } } });
    expect(emptyProposal).toMatchObject({ status: 'committed' });
    if (emptyProposal.status !== 'committed') throw new Error('empty legacy candidate did not persist');
    const emptyApplied = await f.plans.applyPlanChange(f.ctx, { meta: { requestId: 'w2-empty-apply', expected: [] },
      input: { proposalRef: emptyProposal.value.ref, expectedProposalRevision: emptyProposal.value.revision, decisionRefs: [] } });
    expect(emptyApplied).toMatchObject({ status: 'rejected' });
    expect(emptyApplied.status === 'rejected' ? emptyApplied.code : '').not.toBe('unsupported');
    const optional = legacyFullDraft(other.goalId, 'w2-optional-plan', 1);
    optional.tasks = optional.tasks.map((task) => ({ ...task, requirementLevel: 'optional' }));
    optional.obligations = optional.obligations.map((obligation) => ({ ...obligation, requirementLevel: 'optional' }));
    const optionalApplied = await proposeAndApply(f, other, null, optional, 'w2-optional');
    expect(optionalApplied).toMatchObject({ status: 'rejected', code: 'incomplete' });
  } finally { await f.close(); }
});

it.each([
  { requirementLevel: 'optional' as const, disposition: 'active' as const },
  { requirementLevel: 'required' as const, disposition: 'deferred' as const },
])('initial $requirementLevel/$disposition plan_only saves but cannot be claimed', async (definition) => {
  const f = await createTaskClaimFixture('memory');
  try {
    const goalRef = await createSecondGoal(f, 'w2-intent-shape-goal');
    const task = { ...workNode('explore', 'Record a future possibility', 'plan_only'), ...definition };
    const applied = await proposeAndApply(f, goalRef, null,
      initialDraft(goalRef.goalId, 'w2-intent-shape-plan', 1, [task]), 'w2-intent-shape');
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'committed' });
    if (applied.status !== 'committed') throw new Error('explicit intent shape was not adopted');

    const graph = await f.plans.queryTaskGraph(f.ctx, { goalRef });
    expect(graph).toMatchObject({ status: 'ready' });
    if (graph.status === 'ready') {
      expect(graph.value.tasks.find((row) => row.ref.taskId === task.taskId)?.definition)
        .toMatchObject({ ...definition, executionIntent: 'plan_only' });
      expect(graph.value.planning?.completionEvaluation).toBe('not_evaluated');
    }
    const ready = await f.plans.queryReadyTasks(f.ctx, { goalRef, includeBlocked: false, page: { limit: 20 } });
    expect(ready).toMatchObject({ status: 'ready' });
    if (ready.status === 'ready') expect(ready.value.items).toHaveLength(0);
    const request = await f.buildRequest({ input: { goalRef, planRef: applied.value.ref, taskId: task.taskId },
      expected: await expectedPins(f, goalRef, f.sessions.first) });
    const before = f.spy.commits;
    expect(await f.service.claimTask(f.ctx, request)).toMatchObject({ status: 'rejected' });
    expect(f.spy.commits).toBe(before); // No Run or Session/Lease occupancy is committed.
  } finally { await f.close(); }
});

it('initial required plan_only saves without assignment/acceptance/gate and survives a SQLite reopen', async () => {
  const f = await createTaskClaimFixture('sqlite');
  let reopened: Awaited<ReturnType<TaskClaimFixture['reopenService']>> | null = null;
  try {
    const goalRef = await createSecondGoal(f, 'w2-intent-goal');
    const draft = initialDraft(goalRef.goalId, 'w2-intent-plan', 1,
      [workNode('explore', 'Explore the problem', 'plan_only')]);
    const proposed = await f.plans.proposePlan(f.ctx, { meta: { requestId: 'w2-intent-propose', expected: [] },
      input: { goalRef, basedOn: null, draft, reason: { text: 'Record initial intent', sources: [] } } });
    expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2' } });
    if (proposed.status !== 'committed') throw new Error('initial intent proposal did not persist');
    const applied = await f.plans.applyPlanChange(f.ctx, { meta: { requestId: 'w2-intent-apply', expected: [] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    // TARGET: an initial Plan whose only required node is plan_only is adopted.
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'committed' });
    if (applied.status !== 'committed') throw new Error('initial intent adoption did not commit');
    const planRef = applied.value.ref;

    // The rest is the frozen target; it only runs once the adoption seam exists.
    const active = await f.plans.queryTaskGraph(f.ctx, { goalRef });
    expect(active).toMatchObject({ status: 'ready' });
    if (active.status === 'ready') {
      expect(active.value.tasks.map((task) => task.ref.taskId)).toContain('explore');
      expect(active.value.planning).toMatchObject({ completionEvaluation: 'not_evaluated' });
      expect(active.value.planning?.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'required_task_unfinished', taskId: 'explore' }),
        expect.objectContaining({ code: 'goal_acceptance_not_defined' }),
        expect.objectContaining({ code: 'goal_gate_not_defined' }),
      ]));
    }

    reopened = await f.reopenService();
    const reopenedPlans = planServiceOver(reopened.records, 'intent-reopen');
    const graph = await reopenedPlans.queryTaskGraph(f.ctx, { goalRef });
    expect(graph, JSON.stringify(graph)).toMatchObject({ status: 'ready' });
    if (graph.status === 'ready') {
      const row = graph.value.tasks.find((task) => task.ref.taskId === 'explore');
      expect(row?.definition.executionIntent).toBe('plan_only');
      expect(row?.planningDiagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'planning_only', taskId: 'explore' }),
        expect.objectContaining({ code: 'acceptance_not_defined', taskId: 'explore' }),
      ]));
    }
    const ready = await reopenedPlans.queryReadyTasks(f.ctx, { goalRef, includeBlocked: false, page: { limit: 20 } });
    expect(ready).toMatchObject({ status: 'ready' });
    if (ready.status === 'ready') expect(ready.value.items.map((item) => item.task.ref.taskId)).not.toContain('explore');
    const blocked = await reopenedPlans.queryReadyTasks(f.ctx, { goalRef, includeBlocked: true, page: { limit: 20 } });
    expect(blocked).toMatchObject({ status: 'ready' });
    if (blocked.status === 'ready') {
      expect(blocked.value.items.find((item) => item.task.ref.taskId === 'explore')?.task.eligibility)
        .toMatchObject({ eligible: false, reasons: expect.arrayContaining([
          expect.objectContaining({ code: 'task_planning_only', taskId: 'explore' })]) });
    }

    // Direct claim is incomplete with zero side effects, even without assignment.
    const request = await f.buildRequest({ input: { goalRef, planRef, taskId: 'explore' },
      expected: await expectedPins(f, goalRef, f.sessions.first) });
    const before = f.spy.commits;
    const claimed = await f.service.claimTask(f.ctx, request);
    expect(claimed, JSON.stringify(claimed)).toMatchObject({ status: 'rejected', code: 'incomplete' });
    expect(f.spy.commits).toBe(before);

    // Deferring the only required active intent is a legal future definition
    // change; a Plan does not need an executable placeholder to remain valid.
    const deferred = await proposeAndApply(f, goalRef, planRef,
      futureDraftFrom(applied.value, 'w2-intent-plan-deferred', (draft) => ({
        ...draft, tasks: draft.tasks.map((task) => ({ ...task, disposition: 'deferred' as const })),
      })), 'w2-intent-defer');
    expect(deferred, JSON.stringify(deferred)).toMatchObject({ status: 'committed' });
    if (deferred.status !== 'committed') throw new Error('the sole intent could not be deferred');
    const deferredGraph = await f.plans.queryTaskGraph(f.ctx, { goalRef });
    expect(deferredGraph).toMatchObject({ status: 'ready' });
    if (deferredGraph.status === 'ready') {
      expect(deferredGraph.value.tasks.find((task) => task.ref.taskId === 'explore')?.definition)
        .toMatchObject({ disposition: 'deferred', executionIntent: 'plan_only' });
      expect(deferredGraph.value.planning?.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'required_task_unfinished', taskId: 'explore' }));
    }
    const deferredRequest = await f.buildRequest({ input: { goalRef, planRef: deferred.value.ref, taskId: 'explore' },
      expected: await expectedPins(f, goalRef, f.sessions.first) });
    const beforeDeferredClaim = f.spy.commits;
    expect(await f.service.claimTask(f.ctx, deferredRequest)).toMatchObject({ status: 'rejected' });
    expect(f.spy.commits).toBe(beforeDeferredClaim);

    // First assignment keeps plan_only and still cannot run; omission of the
    // source's explicit field is rejected; only an explicit request_execution
    // with a legal assignment becomes claimable (still not complete).
    const assigned = await proposeAndApply(f, goalRef, deferred.value.ref, futureDraftFrom(deferred.value, 'w2-intent-plan-2', (draft) => ({
      ...draft,
      tasks: draft.tasks.map((task) => ({ ...task, disposition: 'active' as const })),
      assignments: [{ taskId: 'explore', role: 'builder', instruction: 'Explore after refinement' }],
    })), 'w2-intent-assign');
    expect(assigned, JSON.stringify(assigned)).toMatchObject({ status: 'committed' });
    if (assigned.status !== 'committed') throw new Error('first assignment did not commit');
    const stillOnly = await f.plans.queryTaskGraph(f.ctx, { goalRef });
    expect(stillOnly).toMatchObject({ status: 'ready' });
    if (stillOnly.status === 'ready') {
      expect(stillOnly.value.tasks.find((task) => task.ref.taskId === 'explore')?.definition.executionIntent).toBe('plan_only');
    }
    const assignedRequest = await f.buildRequest({ input: { goalRef, planRef: assigned.value.ref, taskId: 'explore' },
      expected: await expectedPins(f, goalRef, f.sessions.first) });
    const beforeAssignedClaim = f.spy.commits;
    const assignedClaim = await f.service.claimTask(f.ctx, assignedRequest);
    expect(assignedClaim, JSON.stringify(assignedClaim)).toMatchObject({ status: 'rejected', code: 'incomplete' });
    expect(f.spy.commits).toBe(beforeAssignedClaim);
    const omitted = await proposeAndApply(f, goalRef, assigned.value.ref, futureDraftFrom(assigned.value, 'w2-intent-plan-3', (draft) => ({
      ...draft,
      tasks: draft.tasks.map((task) => {
        if (task.taskId !== 'explore') return task;
        const { executionIntent, ...rest } = task;
        void executionIntent;
        return rest;
      }),
    })), 'w2-intent-omit');
    expect(omitted, JSON.stringify(omitted)).toMatchObject({ status: 'rejected', code: 'invalid' });

    const activated = await proposeAndApply(f, goalRef, assigned.value.ref, futureDraftFrom(assigned.value, 'w2-intent-plan-3-active', (draft) => ({
      ...draft,
      tasks: draft.tasks.map((task) => task.taskId === 'explore'
        ? { ...task, executionIntent: 'request_execution' as const } : task),
    })), 'w2-intent-activate');
    expect(activated, JSON.stringify(activated)).toMatchObject({ status: 'committed' });
    if (activated.status !== 'committed') throw new Error('explicit activation did not commit');
    const activationRequest = await f.buildRequest({ input: { goalRef, planRef: activated.value.ref, taskId: 'explore' },
      expected: await expectedPins(f, goalRef, f.sessions.first) });
    const activationClaim = await f.service.claimTask(f.ctx, activationRequest);
    expect(activationClaim, JSON.stringify(activationClaim)).toMatchObject({ status: 'committed' });
  } finally {
    if (reopened !== null) await reopened.close();
    await f.close();
  }
});

it('an initial request_execution without its single assignment is diagnosed and not adopted', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const goalRef = await createSecondGoal(f, 'w2-reject-goal');
    const draft = initialDraft(goalRef.goalId, 'w2-reject-plan', 1,
      [workNode('investigate', 'Investigate a concrete question', 'request_execution')]);
    const proposed = await f.plans.proposePlan(f.ctx, { meta: { requestId: 'w2-reject-propose', expected: [] },
      input: { goalRef, basedOn: null, draft, reason: { text: 'Explicit request without assignment', sources: [] } } });
    expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: 'committed' });
    if (proposed.status !== 'committed') throw new Error('rejection candidate did not persist');
    expect(proposed.value.issues.map((issue) => issue.code)).toContain('missing_task_assignment');
    const applied = await f.plans.applyPlanChange(f.ctx, { meta: { requestId: 'w2-reject-apply', expected: [] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    // TARGET: an explicit execution request missing its single legal assignment
    // is `incomplete`, not an illegal Task identity.
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'rejected', code: 'incomplete' });
  } finally { await f.close(); }
});

it('future refinement preserves the real source and may add explicit intent and a new role', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const draft = futureDraftFrom(f.plan, 'w2-refine-plan', (base) => ({
      ...base,
      tasks: [...base.tasks,
        workNode('refine-next', 'Refine the next unknown', 'plan_only'),
        workNode('probe', 'Probe a concrete question', 'request_execution')],
      assignments: [...(base.assignments ?? []),
        { taskId: 'probe', role: 'reviewer', instruction: 'Probe a concrete question' }],
      obligations: base.obligations.map((obligation) => obligation.obligationId === 'obligation-1'
        ? { ...obligation, taskIds: [...obligation.taskIds, 'probe'] } : obligation),
    }));
    const proposed = await f.plans.proposePlan(f.ctx, { meta: { requestId: 'w2-refine-propose', expected: [] },
      input: { goalRef: f.goalRef, basedOn: f.planRef, draft, reason: { text: 'Add explicit intent', sources: [] } } });
    expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: 'committed' });
    if (proposed.status !== 'committed') throw new Error('future refinement candidate did not persist');
    const applied = await f.plans.applyPlanChange(f.ctx, { meta: { requestId: 'w2-refine-apply', expected: [] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    // TARGET: a future revision may add a plan_only node and a request_execution
    // node whose first role the source never authorized.
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'committed' });
    if (applied.status !== 'committed') throw new Error('future refinement did not commit');
    const graph = await f.plans.queryTaskGraph(f.ctx, { goalRef: f.goalRef });
    expect(graph).toMatchObject({ status: 'ready' });
    if (graph.status === 'ready') {
      expect(graph.value.tasks.map((task) => task.ref.taskId)).toEqual(expect.arrayContaining(['refine-next', 'probe']));
      expect(graph.value.planning).toMatchObject({ completionEvaluation: 'not_evaluated' });
    }
  } finally { await f.close(); }
});

it('a newly added obligation and gate use the source policy pin and preserve old commitments', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    // A genuinely new ID with a policy-disallowed kind, preserving all source
    // obligations. Rejection must leave the real accepted source untouched.
    const badDraft = futureDraftFrom(f.plan, 'w2-bad-obligation-plan', (base) => ({
      ...base,
      obligations: [...base.obligations,
        { obligationId: 'o-bad', title: 'Bad acceptance kind', requirementLevel: 'required',
          taskIds: ['implement-b'], verificationRequirements: [{ requirementId: 'check-bad',
            requirementLevel: 'required', kind: 'manual', description: 'Not allowed by the pinned test-only policy' }] }],
    }));
    const bad = await proposeAndApply(f, f.goalRef, f.planRef, badDraft, 'w2-bad-obligation');
    expect(bad, JSON.stringify(bad)).toMatchObject({ status: 'rejected', code: 'incomplete' });
    const unchanged = await f.plans.queryGoal(f.ctx, f.goalRef);
    expect(unchanged).toMatchObject({ status: 'ready', value: { goal: { activePlanRevision: f.planRef } } });
    const oldPlan = await f.records.readMany([canonicalJson(f.planRef as unknown as JsonValue)]);
    expect(oldPlan.status).toBe('ready');
    if (oldPlan.status === 'ready') expect(JSON.parse(oldPlan.value.records[0]!.json).obligations).toEqual(f.plan.obligations);

    const draft = futureDraftFrom(f.plan, 'w2-obligation-plan', (base) => ({
      ...base,
      tasks: [...base.tasks, gateNode('gate-extra', 'New acceptance gate')],
      obligations: [...base.obligations,
        { obligationId: 'o-extra', title: 'Extra acceptance', requirementLevel: 'required',
          taskIds: ['implement-b', 'gate-extra'],
          verificationRequirements: [{ requirementId: 'check-extra', requirementLevel: 'required',
            kind: 'test', description: 'Extra check passes' }] }],
    }));
    const proposed = await f.plans.proposePlan(f.ctx, { meta: { requestId: 'w2-obligation-propose', expected: [] },
      input: { goalRef: f.goalRef, basedOn: f.planRef, draft, reason: { text: 'Add acceptance', sources: [] } } });
    expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: 'committed' });
    if (proposed.status !== 'committed') throw new Error('obligation candidate did not persist');

    // Only APPLY is traced. Propose's opportunistic current-policy diagnostics
    // above remain allowed and do not authorize this adoption.
    const seen: string[] = [];
    const batches: PreparedCommit[] = [];
    const wrapped: Records = { ...f.records,
      async readMany(keys) { seen.push(...keys); return f.records.readMany(keys); },
      async commit(batch) { batches.push(batch); return f.records.commit(batch); },
    };
    const applied = await planServiceOver(wrapped, 'obligation').applyPlanChange(f.ctx,
      { meta: { requestId: 'w2-obligation-apply', expected: [] },
        input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'committed' });
    if (applied.status !== 'committed') throw new Error('new obligation/gate adoption did not commit');
    expect(applied.value.effectiveCompletionPolicy).toEqual(f.plan.effectiveCompletionPolicy);
    expect(applied.value.obligations.filter((obligation) => obligation.obligationId !== 'o-extra')).toEqual(f.plan.obligations);
    expect(applied.value.tasks.find((task) => task.taskId === 'gate-extra')).toEqual(gateNode('gate-extra', 'New acceptance gate'));
    const sourcePolicyKey = canonicalJson(f.plan.effectiveCompletionPolicy.ref as unknown as JsonValue);
    const activePointerKey = canonicalJson({ aggregateType: 'ProjectCompletionPolicyActive',
      projectId: f.scope.projectId } as unknown as JsonValue);
    expect.soft(seen).toContain(sourcePolicyKey);
    expect.soft(seen).not.toContain(activePointerKey);
    // The source record's actual aggregate revision, not the content revision,
    // must participate in the very adoption batch sent to the real RecordStore.
    const sourcePolicy = await f.records.readMany([sourcePolicyKey]);
    expect(sourcePolicy.status).toBe('ready');
    if (sourcePolicy.status !== 'ready') throw new Error('source policy record unavailable');
    expect(batches).toHaveLength(1);
    expect(batches[0]!.guards).toContainEqual({ refKey: sourcePolicyKey,
      expectedRevision: sourcePolicy.value.records[0]!.revision });

    // No newly-added ID here: weakening the just-adopted commitment remains a
    // semantic change, not another first-definition exemption.
    const weakened = await proposeAndApply(f, f.goalRef, applied.value.ref,
      futureDraftFrom(applied.value, 'w2-weakened-plan', (base) => ({ ...base,
        obligations: base.obligations.map((obligation) => obligation.obligationId === 'o-extra'
          ? { ...obligation, title: 'Changed acceptance meaning' } : obligation),
      })), 'w2-weakened');
    expect(weakened, JSON.stringify(weakened)).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await f.plans.queryGoal(f.ctx, f.goalRef)).toMatchObject({ status: 'ready',
      value: { goal: { activePlanRevision: applied.value.ref } } });
  } finally { await f.close(); }
});

it('a future refinement without a new obligation reads no CompletionPolicy', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const draft = futureDraftFrom(f.plan, 'w2-no-obligation-plan', (base) => ({
      ...base,
      tasks: base.tasks.map((task) => task.taskId === 'implement-b'
        ? { ...task, title: 'Implement B refined' } : task),
    }));
    const proposed = await f.plans.proposePlan(f.ctx, { meta: { requestId: 'w2-no-obligation-propose', expected: [] },
      input: { goalRef: f.goalRef, basedOn: f.planRef, draft, reason: { text: 'Title-only refinement', sources: [] } } });
    expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: 'committed' });
    if (proposed.status !== 'committed') throw new Error('title-only candidate did not persist');

    const seen: string[] = [];
    const wrapped: Records = { ...f.records, async readMany(keys) { seen.push(...keys); return f.records.readMany(keys); } };
    const applied = await planServiceOver(wrapped, 'no-obligation').applyPlanChange(f.ctx,
      { meta: { requestId: 'w2-no-obligation-apply', expected: [] },
        input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'committed' });
    // TARGET: no obligation was added, so no CompletionPolicy record is read.
    expect(seen.filter((key) => key.includes('CompletionPolicy'))).toEqual([]);
  } finally { await f.close(); }
});

it('a future definition refinement and the first claim on an adopted request_execution node race at one local fact', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    // 1. Real adoption of a request_execution node with a legal assignment.
    const adoptDraft = futureDraftFrom(f.plan, 'w2-race-plan-2', (base) => ({
      ...base,
      tasks: [...base.tasks, workNode('probe', 'Probe a concrete question', 'request_execution')],
      assignments: [...(base.assignments ?? []),
        { taskId: 'probe', role: 'builder', instruction: 'Probe v1' }],
      obligations: base.obligations.map((obligation) => obligation.obligationId === 'obligation-1'
        ? { ...obligation, taskIds: [...obligation.taskIds, 'probe'] } : obligation),
    }));
    const adopted = await proposeAndApply(f, f.goalRef, f.planRef, adoptDraft, 'w2-race-adopt');
    expect(adopted, JSON.stringify(adopted)).toMatchObject({ status: 'committed' });
    if (adopted.status !== 'committed') throw new Error('race source adoption did not commit');
    const sourceRef = adopted.value.ref;

    // 2. Two legal writers on the same still-unclaimed probe.
    const refineDraft = futureDraftFrom(adopted.value, 'w2-race-plan-3', (base) => ({
      ...base,
      assignments: (base.assignments ?? []).map((assignment) => assignment.taskId === 'probe'
        ? { ...assignment, instruction: 'Probe v2' } : assignment),
    }));
    const proposal = await f.plans.proposePlan(f.ctx, { meta: { requestId: 'w2-race-propose', expected: [] },
      input: { goalRef: f.goalRef, basedOn: sourceRef, draft: refineDraft, reason: { text: 'Refine probe', sources: [] } } });
    expect(proposal, JSON.stringify(proposal)).toMatchObject({ status: 'committed' });
    if (proposal.status !== 'committed') throw new Error('race refinement candidate did not persist');
    const request = await f.buildRequest({ input: { taskId: 'probe', planRef: sourceRef } });

    let editArrived = false;
    let claimArrived = false;
    let resolveBoth!: () => void;
    const bothArrived = new Promise<void>((resolve) => { resolveBoth = resolve; });
    const batches = new Map<'edit' | 'claim', PreparedCommit>();
    const beforeRecords = new Map<string, EncodedRecord>();
    const wrapped: Records = { ...f.records, async commit(prepared) {
      const tag = prepared.identityKey.startsWith('plan-apply:') ? 'edit'
        : prepared.identityKey.startsWith('task-claim:') ? 'claim' : null;
      if (tag === null) return f.records.commit(prepared);
      batches.set(tag, prepared);
      const before = await f.records.readMany(prepared.records.map((record) => record.refKey));
      if (before.status !== 'ready') throw new Error(`race baseline read failed: ${JSON.stringify(before)}`);
      for (const record of before.value.records) beforeRecords.set(record.refKey, record);
      if (tag === 'edit') editArrived = true; else claimArrived = true;
      if (editArrived && claimArrived) resolveBoth();
      await bothArrived;
      return f.records.commit(prepared);
    } };
    // If either service rejects before commit, release the other and report
    // its actual result below instead of hanging at an unreachable barrier.
    const releaseOnSettlement = <T>(operation: Promise<T>): Promise<T> => operation.finally(resolveBoth);
    const [editResult, claimResult] = await Promise.all([
      releaseOnSettlement(planServiceOver(wrapped, 'race').applyPlanChange(f.ctx,
        { meta: { requestId: 'w2-race-edit', expected: [] },
          input: { proposalRef: proposal.value.ref, expectedProposalRevision: proposal.value.revision, decisionRefs: [] } })),
      releaseOnSettlement(f.makeService(wrapped).claimTask(f.ctx, request)),
    ]);
    expect(editArrived, JSON.stringify(editResult)).toBe(true);
    expect(claimArrived, JSON.stringify(claimResult)).toBe(true);
    // TARGET: exactly one writer commits; the other is a revision conflict and
    // the loser leaves no partial fact.
    const statuses = [editResult.status, claimResult.status].sort();
    expect(statuses).toEqual(['committed', 'rejected']);
    const loser = editResult.status === 'rejected' ? editResult : claimResult.status === 'rejected' ? claimResult : null;
    expect(loser).toMatchObject({ code: 'revision_conflict' });
    const losingBatch = batches.get(editResult.status === 'rejected' ? 'edit' : 'claim')!;
    const losingRecords = await f.records.readMany(losingBatch.records.map((record) => record.refKey));
    expect(losingRecords.status).toBe('ready');
    if (losingRecords.status === 'ready') {
      for (const written of losingBatch.records) {
        expect(losingRecords.value.records.find((record) => record.refKey === written.refKey))
          .toEqual(beforeRecords.get(written.refKey));
      }
    }
    const goal = await f.plans.queryGoal(f.ctx, f.goalRef);
    expect(goal).toMatchObject({ status: 'ready', value: { goal: {
      activePlanRevision: editResult.status === 'committed' ? editResult.value.ref : sourceRef,
    } } });
    const session = await f.sessionsPort.readSession(f.ctx, f.sessions.first);
    expect(session).toMatchObject({ status: 'ready', value: { record: {
      occupancy: claimResult.status === 'committed'
        ? { kind: 'execution', executionRef: claimResult.value.runRef } : null,
    } } });
    if (claimResult.status === 'committed') {
      expect(await f.service.readTaskClaim(f.ctx, claimResult.value.outboxRef))
        .toMatchObject({ status: 'ready', value: claimResult.value });
    }
  } finally { await f.close(); }
});
