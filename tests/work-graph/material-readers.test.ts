import { expect, it } from 'vitest';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { TaskBudgetV1, RoleBindingRefV1, RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { GoalRef, GoalSnapshot, WorkspaceRef, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { QueryJobIntentV1, QueryRunRef, QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import type { RoleBindingFactsPort } from '../../src/core/work-graph/model/configuration-contracts.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createTaskClaimFixture } from '../helpers/task-claim-fixture.js';

const at = '2026-09-24T00:00:00.000Z';
const actor = { kind: 'human' as const, id: 'materials-operator' };
const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 'materials-binding',
  templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const budget: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };
const runtimeBudget: RuntimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
  maxRequests: 1, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 };

const ctxFor = (projectId: string, workspaceId: string): CoreCallContext => ({ projectId, workspaceId,
  principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal });

/**
 * The expected snapshots are computed by hand from the public requests and the
 * sequence of steps; no owner result is copied:
 *  - `registerWorkspace` writes `WorkspaceSnapshot@1` (revision 1);
 *  - `createGoal` writes `Goal@1` (`active`, desiredStateRevision 1, no plan),
 *    and adopting the first Plan moves the pointer to that PlanRevision and
 *    raises the Goal to revision 2 (`nextGoalPointer`); a Goal without a Plan
 *    stays at revision 1;
 *  - `claimTask` writes `RunSnapshot@1` as `starting` with the claimed Task, the
 *    injected run/attempt ids, the PlanRef, RoleBinding and TaskBudget from the
 *    request, and the Workspace pin it read (revision 1); every other contract
 *    field has its initial value (the fixed clock writes no Run timestamp);
 *  - `submitQueryJob` writes a pending `QueryRunSnapshot@1` whose ref carries
 *    the caller's queryJobId/runId in the bound Workspace.
 * The dynamic identities (Workspace/Goal/Plan refs, Session revisions) come
 * from the creating public requests or their returned refs, never from an
 * owner's whole snapshot.
 */
function expectedWorkspace(ref: WorkspaceRef): WorkspaceSnapshot {
  return { ref, revision: 1 };
}
function expectedGoal(ref: GoalRef, workspaceRef: WorkspaceRef, objective: string,
  activePlanRevision: PlanRevisionRef | null, revision: number, since: GoalSnapshot['since']): GoalSnapshot {
  return { ref, workspaceRef, objective, desiredState: 'active', desiredStateRevision: 1,
    desiredStateRequestedBy: null, activePlanRevision, revision,
    settings: { schemaVersion: 1, autonomy: 'after_plan_confirmation', order: 0, waitForGoalRef: null, parallelRisks: [] },
    continuedFrom: null, copiedInterventions: [], since };
}
function expectedRun(ref: RunRef, taskId: string, attemptId: string, planRef: PlanRevisionRef,
  workspaceId: string): RunSnapshot {
  return { ref, revision: 1, schemaVersion: 1,
    task: { projectId: ref.projectId, goalId: ref.goalId, taskId }, attemptId, planRef, roleBinding, budget,
    workspaceSnapshot: { workspaceId, revision: 1 }, status: 'starting', outcome: null, exitCode: null,
    lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '', envelope: null, startedAt: null, endedAt: null };
}
function expectedQueryRun(ref: QueryRunRef): QueryRunSnapshot {
  return { ref, revision: 1, schemaVersion: 1, run: { schemaVersion: 1,
    queryJobRef: { aggregateType: 'QueryJob', projectId: ref.projectId, workspaceId: ref.workspaceId,
      queryJobId: ref.queryJobId },
    runId: ref.runId, status: 'pending', startedAt: null, endedAt: null, outcome: null } };
}
function planDraft(planRef: PlanRevisionRef, goalId: string): PlanRevisionDraft {
  return { schemaVersion: 2, planId: planRef.planId, planRevision: 1, goalId,
    stages: [{ stageId: 's1', title: 'Stage one' }],
    tasks: [
      { taskId: 'task-1', stageId: 's1', title: 'Work one', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'gate-1', title: 'Gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'task-1', role: 'builder', instruction: 'Work one' }],
    obligations: [{ obligationId: `o-${planRef.planId}`, title: 'Deliver', requirementLevel: 'required',
      taskIds: ['task-1', 'gate-1'],
      verificationRequirements: [{ requirementId: `v-${planRef.planId}`, requirementLevel: 'required', kind: 'test',
        description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
}

it.each(['memory', 'sqlite'] as const)('%s: canonical material records use complete refs and returned values are isolated', async kind => {
  const f = await createTaskClaimFixture(kind, QUERY_JOB_RECORD_SCHEMAS, { clock: () => at });
  try {
    const projectA = f.projectRef.projectId, workspaceA = f.workspaceRef.workspaceId;
    const workspaceARef = f.workspaceRef;
    const otherWorkspace = 'other-workspace';
    const otherWorkspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: projectA, workspaceId: otherWorkspace };
    const projectB = 'other-project', workspaceB = 'other-project-workspace';
    const projectBRef = { aggregateType: 'Project' as const, projectId: projectB };
    const workspaceBRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: projectB, workspaceId: workspaceB };
    const mainGoalRef: GoalRef = { aggregateType: 'Goal', projectId: projectA, goalId: 'materials-goal' };
    const otherGoalRef: GoalRef = { aggregateType: 'Goal', projectId: projectA, goalId: 'other-goal' };
    const otherWorkspaceGoalRef: GoalRef = { aggregateType: 'Goal', projectId: projectA, goalId: 'other-workspace-goal' };
    const projectBGoalRef: GoalRef = { aggregateType: 'Goal', projectId: projectB, goalId: 'materials-goal' };
    const mainPlanRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: projectA, planId: 'materials-plan' };
    const otherPlanRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: projectA, planId: 'other-plan' };
    const projectBPlanRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: projectB, planId: 'other-project-plan' };
    const ctxA = ctxFor(projectA, workspaceA);
    const ctxOther = ctxFor(projectA, otherWorkspace);
    const ctxB = ctxFor(projectB, workspaceB);

    let eventSeq = 0;
    const eventId = () => `materials-event-${++eventSeq}`;
    const bootstrap = createProjectBootstrapServices({ records: f.records, now: () => at, eventId });

    // ---- the second Workspace of project A ---------------------------------
    const registeredOther = await bootstrap.projects.registerWorkspace(ctxOther, {
      input: { workspace: { projectId: projectA, workspaceId: otherWorkspace } },
      meta: { requestId: 'materials-register-other-workspace', expected: [
        { ref: f.projectRef, revision: 1 }, { ref: otherWorkspaceRef, revision: 0 }] },
    });
    if (registeredOther.status !== 'committed') throw new Error(`other Workspace registration failed: ${JSON.stringify(registeredOther)}`);

    // ---- the second Project: create, workspace, policy, initial architecture
    const createdProject = await bootstrap.projects.createProject(ctxB, {
      input: { projectId: projectB }, meta: { requestId: 'materials-create-other-project',
        expected: [{ ref: projectBRef, revision: 0 }] },
    });
    if (createdProject.status !== 'committed') throw new Error(`other Project creation failed: ${JSON.stringify(createdProject)}`);
    const registeredB = await bootstrap.projects.registerWorkspace(ctxB, {
      input: { workspace: { projectId: projectB, workspaceId: workspaceB } },
      meta: { requestId: 'materials-register-other-project-workspace', expected: [
        { ref: projectBRef, revision: 1 }, { ref: workspaceBRef, revision: 0 }] },
    });
    if (registeredB.status !== 'committed') throw new Error(`other Project Workspace registration failed: ${JSON.stringify(registeredB)}`);
    const policyBRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: projectB,
      policyId: 'other-policy', revision: 1 };
    const installedB = await bootstrap.completionPolicies.installCompletionPolicy(ctxB, {
      input: { policyId: policyBRef.policyId, contentRevision: 1,
        content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } },
      meta: { requestId: 'materials-install-other-policy', expected: [
        { ref: projectBRef, revision: 1 }, { ref: policyBRef, revision: 0 }] },
    });
    if (installedB.status !== 'committed') throw new Error(`other policy install failed: ${JSON.stringify(installedB)}`);
    const activatedB = await bootstrap.completionPolicies.activateCompletionPolicy(ctxB, {
      input: { target: { ref: installedB.value.ref, digest: installedB.value.contentDigest } },
      meta: { requestId: 'materials-activate-other-policy', expected: [
        { ref: projectBRef, revision: 1 },
        { ref: { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: projectB }, revision: 0 }] },
    });
    if (activatedB.status !== 'committed') throw new Error(`other policy activation failed: ${JSON.stringify(activatedB)}`);
    const architectureB = await createArchitectureCatalogService({ records: f.records }).adoptInitialArchitecture(ctxB, {
      input: { baselineId: 'other-baseline', description: 'Other project baseline', constraints: [], catalog: {
        requireDag: true, dependencies: [], modules: [
          { ref: { projectId: projectB, moduleId: 'R' }, name: 'R', responsibility: 'root', paths: ['.'], interfaces: [] },
        ] } },
      meta: { requestId: 'materials-adopt-other-architecture', expected: [
        { ref: projectBRef, revision: 1 }, { ref: workspaceBRef, revision: 1 }] },
    });
    if (architectureB.status !== 'committed') throw new Error(`other architecture adoption failed: ${JSON.stringify(architectureB)}`);

    // ---- Goals and Plans through the public owners -------------------------
    // Each Goal's creation cursor comes from its own create result; a Goal id
    // repeats across projects, so the key names the whole ref.
    const goalCursors = new Map<string, GoalSnapshot['since']>();
    const cursorKey = (ref: GoalRef): string => `${ref.projectId}/${ref.goalId}`;
    async function createGoal(ctx: CoreCallContext, goalRef: GoalRef, objective: string): Promise<void> {
      const created = await f.goals.createGoal(ctx, {
        input: { goalId: goalRef.goalId, workspace: { projectId: ctx.projectId, workspaceId: ctx.workspaceId! }, objective },
        meta: { requestId: `materials-goal-${goalRef.projectId}-${goalRef.goalId}`, expected: [
          { ref: { aggregateType: 'Project', projectId: ctx.projectId }, revision: 1 },
          { ref: { aggregateType: 'Workspace', projectId: ctx.projectId, workspaceId: ctx.workspaceId! }, revision: 1 }] },
      });
      if (created.status !== 'committed') throw new Error(`Goal creation failed: ${JSON.stringify(created)}`);
      goalCursors.set(cursorKey(goalRef), created.cursor);
    }
    async function adoptPlan(ctx: CoreCallContext, goalRef: GoalRef, planRef: PlanRevisionRef): Promise<void> {
      const proposed = await f.plans.proposePlan(ctx, {
        input: { goalRef, basedOn: null, draft: planDraft(planRef, goalRef.goalId),
          reason: { text: `Plan ${planRef.planId}`, sources: [] } },
        meta: { requestId: `materials-propose-${planRef.planId}`, expected: [{ ref: goalRef, revision: 1 }] },
      });
      if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
        throw new Error(`Plan proposal failed: ${JSON.stringify(proposed)}`);
      }
      const applied = await f.plans.applyPlanChange(ctx, {
        input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
        meta: { requestId: `materials-apply-${planRef.planId}`, expected: [{ ref: goalRef, revision: 1 }] },
      });
      if (applied.status !== 'committed') throw new Error(`Plan adoption failed: ${JSON.stringify(applied)}`);
      expect(applied.value.ref).toEqual(planRef);
    }
    await createGoal(ctxA, mainGoalRef, 'Preserve the original material');
    await adoptPlan(ctxA, mainGoalRef, mainPlanRef);
    await createGoal(ctxA, otherGoalRef, 'Other goal in the main workspace');
    await adoptPlan(ctxA, otherGoalRef, otherPlanRef);
    await createGoal(ctxOther, otherWorkspaceGoalRef, 'Goal in the other workspace');
    await createGoal(ctxB, projectBGoalRef, 'Preserve the original material');
    await adoptPlan(ctxB, projectBGoalRef, projectBPlanRef);

    // ---- role configuration and real Sessions through the Runtime ----------
    const kernelStores = await createKernelStoreRegistry({ entries: [
      { adapterId: 'materials-kernel-a', storeKey: 'materials-kernel-a', workspace: workspaceARef,
        databasePath: join(f.directory, 'materials-kernel-a.sqlite') },
      { adapterId: 'materials-kernel-other', storeKey: 'materials-kernel-other', workspace: otherWorkspaceRef,
        databasePath: join(f.directory, 'materials-kernel-other.sqlite') },
      { adapterId: 'materials-kernel-b', storeKey: 'materials-kernel-b', workspace: workspaceBRef,
        databasePath: join(f.directory, 'materials-kernel-b.sqlite') },
    ] });
    const sessionOperations = createSessionOperations({ sessions: f.sessionsPort, kernelStores });
    async function createSession(ctx: CoreCallContext, workspace: WorkspaceRef,
      requestId: string): Promise<{ sessionRef: { projectId: string; sessionId: string }; revision: number }> {
      const created = await sessionOperations.createSession(ctx, { workspace,
        role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
        recommendedRefs: [], initialLinks: [], meta: { requestId, expected: [] } });
      if (created.status !== 'completed') throw new Error(`Session creation failed: ${JSON.stringify(created)}`);
      const ref = created.value.ref;
      return { sessionRef: { projectId: ref.projectId, sessionId: ref.sessionId }, revision: created.value.revision };
    }

    // ---- three real claims; the injected newId queue gives each 'same-run' --
    const ids: string[] = [];
    const newId = () => {
      const value = ids.shift();
      if (value === undefined) throw new Error('the claim produced more ids than the test queued');
      return value;
    };
    const claims = createTaskClaimService({ records: f.records, roles: f.roleService as unknown as RoleBindingFactsPort, now: () => at, newId });
    async function claim(input: { ctx: CoreCallContext; goalRef: GoalRef; planRef: PlanRevisionRef;
      workspaceRef: WorkspaceRef; workspace: WorkspaceRef; label: string }): Promise<RunRef> {
      const session = await createSession(input.ctx, input.workspace, `materials-session-${input.label}`);
      ids.push('same-run', `${input.label}-attempt`, `${input.label}-event`);
      const claimed = await claims.claimTask(input.ctx, {
        input: { goalRef: input.goalRef, planRef: input.planRef, taskId: 'task-1',
          sessionRef: session.sessionRef, roleBinding, budget },
        meta: { requestId: `materials-claim-${input.label}`, expected: [
          { ref: input.goalRef, revision: 2 },
          { ref: input.workspaceRef, revision: 1 },
          { ref: { aggregateType: 'Session', projectId: session.sessionRef.projectId,
            sessionId: session.sessionRef.sessionId }, revision: session.revision }] },
      });
      if (claimed.status !== 'committed') throw new Error(`Task claim failed: ${JSON.stringify(claimed)}`);
      return claimed.value.runRef;
    }
    const runMain = await claim({ ctx: ctxA, goalRef: mainGoalRef, planRef: mainPlanRef,
      workspaceRef: workspaceARef, workspace: workspaceARef, label: 'main' });
    const runOtherGoal = await claim({ ctx: ctxA, goalRef: otherGoalRef, planRef: otherPlanRef,
      workspaceRef: workspaceARef, workspace: workspaceARef, label: 'other-goal' });
    const runB = await claim({ ctx: ctxB, goalRef: projectBGoalRef, planRef: projectBPlanRef,
      workspaceRef: workspaceBRef, workspace: workspaceBRef, label: 'other-project' });
    expect(runMain).toEqual({ aggregateType: 'Run', projectId: projectA, goalId: mainGoalRef.goalId, runId: 'same-run' });
    expect(runOtherGoal).toEqual({ aggregateType: 'Run', projectId: projectA, goalId: otherGoalRef.goalId, runId: 'same-run' });
    expect(runB).toEqual({ aggregateType: 'Run', projectId: projectB, goalId: projectBGoalRef.goalId, runId: 'same-run' });

    // ---- two pending QueryRuns through submitQueryJob ----------------------
    const queries = createQueryJobService({ records: f.records, now: () => at, eventId });
    async function submitQuery(ctx: CoreCallContext, workspaceRef: WorkspaceRef, goalRef: GoalRef,
      goalRevision: number, kind: 'semantic_query' | 'initial_coordination'): Promise<QueryRunRef> {
      const queryJobId = 'query-1', runId = 'same-query';
      const queryJobRef = { aggregateType: 'QueryJob' as const, projectId: ctx.projectId,
        workspaceId: ctx.workspaceId!, queryJobId };
      const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: ctx.projectId,
        workspaceId: ctx.workspaceId!, queryJobId, runId };
      const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: queryJobId, projectId: ctx.projectId,
        workspaceId: ctx.workspaceId!, goalId: goalRef.goalId,
        question: 'Explain the material scope', focusTaskRefs: [], budget: { maxTokens: 4096, deadline: null },
        multiTurn: { maxRounds: 1 }, correlationId: `materials-query-${ctx.workspaceId}`,
        execution: { kind, roleBinding, runtimeBudget } };
      const submitted = await queries.submitQueryJob(ctx, {
        input: { queryJobId, runId, intent },
        meta: { requestId: `materials-submit-${ctx.workspaceId}`, expected: [
          { ref: { aggregateType: 'Project', projectId: ctx.projectId }, revision: 1 },
          { ref: workspaceRef, revision: 1 },
          { ref: goalRef, revision: goalRevision },
          { ref: queryJobRef, revision: 0 },
          { ref: queryRunRef, revision: 0 }] },
      });
      if (submitted.status !== 'committed') throw new Error(`Query submit failed: ${JSON.stringify(submitted)}`);
      return queryRunRef;
    }
    const queryMain = await submitQuery(ctxA, workspaceARef, mainGoalRef, 2, 'semantic_query');
    const queryOther = await submitQuery(ctxOther, otherWorkspaceRef, otherWorkspaceGoalRef, 1, 'initial_coordination');

    // ---- the reader opens every real row by its complete ref --------------
    const { authority } = createMaterialRecordReaders(f.records);
    const expected = [
      expectedWorkspace(workspaceARef), expectedWorkspace(otherWorkspaceRef), expectedWorkspace(workspaceBRef),
      expectedGoal(mainGoalRef, workspaceARef, 'Preserve the original material', mainPlanRef, 2, goalCursors.get(cursorKey(mainGoalRef))!),
      expectedGoal(otherGoalRef, workspaceARef, 'Other goal in the main workspace', otherPlanRef, 2, goalCursors.get(cursorKey(otherGoalRef))!),
      expectedGoal(otherWorkspaceGoalRef, otherWorkspaceRef, 'Goal in the other workspace', null, 1,
        goalCursors.get(cursorKey(otherWorkspaceGoalRef))!),
      expectedGoal(projectBGoalRef, workspaceBRef, 'Preserve the original material', projectBPlanRef, 2,
        goalCursors.get(cursorKey(projectBGoalRef))!),
      expectedRun(runMain, 'task-1', 'main-attempt', mainPlanRef, workspaceA),
      expectedRun(runOtherGoal, 'task-1', 'other-goal-attempt', otherPlanRef, workspaceA),
      expectedRun(runB, 'task-1', 'other-project-attempt', projectBPlanRef, workspaceB),
      expectedQueryRun(queryMain), expectedQueryRun(queryOther),
    ];
    for (const snapshot of expected) {
      expect(await authority.load(snapshot.ref)).toMatchObject({ status: 'found', snapshot });
    }
    expect(await authority.load({ aggregateType: 'Run', projectId: projectA, goalId: mainGoalRef.goalId,
      runId: 'absent' })).toMatchObject({ status: 'not_found' });
    const first = await authority.load(runMain);
    if (first.status !== 'found' || first.snapshot.ref.aggregateType !== 'Run') throw Error('Run missing');
    (first.snapshot as RunSnapshot).workspaceSnapshot.workspaceId = 'tampered';
    expect(await authority.load(runMain)).toMatchObject({ status: 'found', snapshot: { workspaceSnapshot: { workspaceId: workspaceA } } });
  } finally { await f.close(); }
});
