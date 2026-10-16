/**
 * Slice 4B G2 round 2 — MF2/MF5 second-scope fixture.
 *
 * What it builds and through which public calls: on top of the real
 * `createS4BNoteCheckFixture` platform it adds
 *   - a second Goal in the SAME project (`s4b-goal-2`, stage `s2`, active tasks
 *     `t1` and `t9`) through `platform.goals.createGoal` and
 *     `platform.plans.proposePlan`/`applyPlanChange`;
 *   - a second PROJECT (`s4b-project-2` / `s4b-workspace-2`) with its own
 *     architecture catalog (modules `R`/`A`/`A1`/`B`, interface `A/I1`), its own
 *     Goal id `s4a-goal` and an accepted plan (stage `s1`, active task `t1`)
 *     through `projects.createProject`/`registerWorkspace`,
 *     `completionPolicies.*`, `architecture.adoptInitialArchitecture`,
 *     `goals.createGoal` and `plans.*`.
 * `revisePlan` adopts a next revision of any of these goals through the real
 * proposal/apply calls. Nothing reads the record store to answer an assertion.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { S4A_AT } from './S4A-note-fixture.js';
import type { S4BNoteCheckFixture } from './S4B-note-check-fixture.js';

const P1 = 's4a-project';
const W1 = 's4a-workspace';
const P2 = 's4b-project-2';
const W2 = 's4b-workspace-2';
const HOST_ACTOR = { kind: 'human' as const, id: 's4a-operator' };

export type S4BMultiScope = {
  /** The second Goal in P1 and its first accepted plan. */
  goal2Ref: GoalRef;
  plan2Ref: PlanRevisionRef;
  plan2: PlanRevisionSnapshot;
  /** The second project/workspace and its `s4a-goal` plan. */
  project2Ref: { aggregateType: 'Project'; projectId: string };
  workspace2Ref: WorkspaceRef;
  workspace2: { projectId: string; workspaceId: string };
  goal2ProjectRef: GoalRef;
  plan2ProjectRef: PlanRevisionRef;
  plan2Project: PlanRevisionSnapshot;
  ctxP2(): CoreCallContext;
  /** Claim a task against any adopted plan revision (uses the real claim port). */
  claimRunFor(input: { suffix: string; taskId: string; goalRef: GoalRef; planRef: PlanRevisionRef }): Promise<RunRef>;
  /** Adopt the next revision of a goal's plan; mutate stages and tasks together. */
  revisePlan(goalRef: GoalRef, mutate: (draft: { stages: PlanRevisionDraft['stages'];
    tasks: PlanRevisionDraft['tasks'] }) => { stages: PlanRevisionDraft['stages']; tasks: PlanRevisionDraft['tasks'] },
  affectedTaskIds?: string[]): Promise<PlanRevisionSnapshot>;
  close(): Promise<void>;
};

export async function createS4BMultiScope(f: S4BNoteCheckFixture): Promise<S4BMultiScope> {
  const platform = f.inner.platform;
  let clock = 1000;
  const now = () => new Date(Date.parse(S4A_AT) + (++clock) * 1000).toISOString();
  const committed = (label: string, result: { status: string }): Record<string, unknown> => {
    if (result.status !== 'committed') throw new Error(`S4B multi-scope ${label} failed: ${JSON.stringify(result)}`);
    return (result as unknown as { value: Record<string, unknown> }).value;
  };
  const ctxP2 = (): CoreCallContext => ({ projectId: P2, workspaceId: W2,
    principal: { kind: 'host', actor: HOST_ACTOR },
    materialReader: { kind: 'host', projectId: P2, workspaceId: W2, actor: HOST_ACTOR },
    signal: new AbortController().signal });
  const ctxFor = (goalRef: GoalRef): CoreCallContext => goalRef.projectId === P2 ? ctxP2() : f.ctx();
  const ctx1 = f.ctx();

  const projectRef = { aggregateType: 'Project' as const, projectId: P1 };
  const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: P1, workspaceId: W1 };
  const project2Ref = { aggregateType: 'Project' as const, projectId: P2 };
  const workspace2Ref: WorkspaceRef = { aggregateType: 'Workspace', projectId: P2, workspaceId: W2 };
  const goal2Ref: GoalRef = { aggregateType: 'Goal', projectId: P1, goalId: 's4b-goal-2' };
  const plan2Ref: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P1, planId: 's4b-plan-2' };
  const goal2ProjectRef: GoalRef = { aggregateType: 'Goal', projectId: P2, goalId: 's4a-goal' };
  const plan2ProjectRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P2, planId: 's4b-plan-p2' };

  const executorAssignment = (taskId: string) => ({ taskId, role: 'platform-executor', instruction: `Execute ${taskId}` });
  const verification = (label: string) => ({ obligationId: `o-${label}`, title: 'Deliver', requirementLevel: 'required' as const,
    taskIds: [] as string[], verificationRequirements: [{ requirementId: `v-${label}`, requirementLevel: 'required' as const,
      kind: 'test' as const, description: 'Tests pass' }] });
  const planDraft = (input: { planId: string; goalId: string; stages: PlanRevisionDraft['stages'];
    tasks: PlanRevisionDraft['tasks']; label: string }): PlanRevisionDraft => {
    const taskIds = input.tasks.map(task => task.taskId);
    return { schemaVersion: 1, planId: input.planId, planRevision: 1, goalId: input.goalId,
      stages: input.stages, tasks: input.tasks,
      assignments: input.tasks.filter(task => task.taskKind === 'work').map(task => executorAssignment(task.taskId)),
      obligations: [{ ...verification(input.label), taskIds }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
  };

  // ---- P1's second goal + plan -------------------------------------------
  committed('goal2', await platform.goals.createGoal(ctx1, {
    meta: { requestId: 's4b-multiscope-goal2', expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: goal2Ref.goalId, workspace: { projectId: P1, workspaceId: W1 }, objective: 'S4B second goal' } }));
  const goal2Draft = planDraft({ planId: plan2Ref.planId, goalId: goal2Ref.goalId, label: 'g2',
    stages: [{ stageId: 's2', title: 'Stage two' }],
    tasks: [
      { taskId: 't1', stageId: 's2', title: 'Second goal work one', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 't9', stageId: 's2', title: 'Second goal work nine', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'g2', title: 'Gate two', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ] });
  const proposed2 = committed('plan2-propose', await platform.plans.proposePlan(ctx1, {
    meta: { requestId: 's4b-multiscope-plan2-propose', expected: [{ ref: goal2Ref, revision: 1 }] },
    input: { goalRef: goal2Ref, basedOn: null, draft: goal2Draft, reason: { text: 'S4B second goal plan', sources: [] } } }));
  const plan2 = committed('plan2-apply', await platform.plans.applyPlanChange(ctx1, {
    meta: { requestId: 's4b-multiscope-plan2-apply', expected: [{ ref: goal2Ref, revision: 1 }] },
    input: { proposalRef: proposed2['ref'] as never, expectedProposalRevision: proposed2['revision'] as number,
      decisionRefs: [] } })) as unknown as PlanRevisionSnapshot;

  // ---- the second project, catalog, goal and plan ------------------------
  const ctx2 = ctxP2();
  committed('project2', await platform.projects.createProject(ctx2, {
    meta: { requestId: 's4b-multiscope-project2', expected: [{ ref: project2Ref, revision: 0 }] },
    input: { projectId: P2 } }));
  committed('workspace2', await platform.projects.registerWorkspace(ctx2, {
    meta: { requestId: 's4b-multiscope-workspace2', expected: [{ ref: project2Ref, revision: 1 }, { ref: workspace2Ref, revision: 0 }] },
    input: { workspace: { projectId: P2, workspaceId: W2 } } }));
  const installed = committed('policy2-install', await platform.completionPolicies.installCompletionPolicy(ctx2, {
    meta: { requestId: 's4b-multiscope-policy2-install', expected: [{ ref: project2Ref, revision: 1 },
      { ref: { aggregateType: 'CompletionPolicyRevision', projectId: P2, policyId: 's4b-policy-2', revision: 1 }, revision: 0 }] },
    input: { policyId: 's4b-policy-2', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } } }));
  committed('policy2-activate', await platform.completionPolicies.activateCompletionPolicy(ctx2, {
    meta: { requestId: 's4b-multiscope-policy2-activate', expected: [{ ref: project2Ref, revision: 1 },
      { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: P2 }, revision: 0 }] },
    input: { target: { ref: installed['ref'] as never, digest: installed['contentDigest'] as string } } }));
  committed('architecture2', await platform.architecture.adoptInitialArchitecture(ctx2, {
    meta: { requestId: 's4b-multiscope-architecture2', expected: [{ ref: project2Ref, revision: 1 }, { ref: workspace2Ref, revision: 1 }] },
    input: { baselineId: 's4b-baseline-2', description: 'S4B second project catalog', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [
        { ref: { projectId: P2, moduleId: 'R' }, name: 'R', responsibility: 'root', paths: ['.'], interfaces: [] },
        { ref: { projectId: P2, moduleId: 'A' }, name: 'A', responsibility: 'area A', paths: ['src/a'],
          interfaces: [{ id: 'I1', description: 'A interface', paths: ['src/a'] }] },
        { ref: { projectId: P2, moduleId: 'A1' }, name: 'A1', responsibility: 'area A1', paths: ['src/a/one'], interfaces: [] },
        { ref: { projectId: P2, moduleId: 'B' }, name: 'B', responsibility: 'area B', paths: ['src/b'], interfaces: [] },
      ] } } }));
  committed('goal2-project', await platform.goals.createGoal(ctx2, {
    meta: { requestId: 's4b-multiscope-goal2-project', expected: [{ ref: project2Ref, revision: 1 }, { ref: workspace2Ref, revision: 1 }] },
    input: { goalId: goal2ProjectRef.goalId, workspace: { projectId: P2, workspaceId: W2 }, objective: 'S4B second project goal' } }));
  const projectDraft = planDraft({ planId: plan2ProjectRef.planId, goalId: goal2ProjectRef.goalId, label: 'p2',
    stages: [{ stageId: 's1', title: 'Stage one' }],
    tasks: [
      { taskId: 't1', stageId: 's1', title: 'Second project work one', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'g2', title: 'Gate two', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ] });
  const proposedP2 = committed('planP2-propose', await platform.plans.proposePlan(ctx2, {
    meta: { requestId: 's4b-multiscope-planP2-propose', expected: [{ ref: goal2ProjectRef, revision: 1 }] },
    input: { goalRef: goal2ProjectRef, basedOn: null, draft: projectDraft, reason: { text: 'S4B project two plan', sources: [] } } }));
  const plan2Project = committed('planP2-apply', await platform.plans.applyPlanChange(ctx2, {
    meta: { requestId: 's4b-multiscope-planP2-apply', expected: [{ ref: goal2ProjectRef, revision: 1 }] },
    input: { proposalRef: proposedP2['ref'] as never, expectedProposalRevision: proposedP2['revision'] as number,
      decisionRefs: [] } })) as unknown as PlanRevisionSnapshot;

  // The latest adopted plan per goal, used as the `basedOn` of the next revision.
  const latest = new Map<string, PlanRevisionSnapshot>();
  const planKey = (goalRef: GoalRef) => `${goalRef.projectId}\u0000${goalRef.goalId}`;
  latest.set(planKey(f.inner.goalRef), f.inner.plan);
  latest.set(planKey(goal2Ref), plan2);
  latest.set(planKey(goal2ProjectRef), plan2Project);

  let revisionSeq = 0;
  async function claimRunFor(input: { suffix: string; taskId: string; goalRef: GoalRef;
    planRef: PlanRevisionRef }): Promise<RunRef> {
    const ctx = ctxFor(input.goalRef);
    const session = await f.inner.createSession(input.suffix, 'executor');
    const goalRead = await platform.plans.queryGoal(ctx, input.goalRef);
    if (goalRead.status !== 'ready') throw new Error('S4B multi-scope claim goal read failed');
    const card = await platform.sessions.readSession(ctx, session.sessionRef);
    if (card.status !== 'ready') throw new Error('S4B multi-scope claim session read failed');
    const roleBinding = { schemaVersion: 1 as const, bindingId: `s4b-${input.suffix}-binding`,
      templateId: 'platform-executor', templateRevision: 's3.1', bindingVersion: 1, policyRevision: 'legacy-template' };
    const claimed = await platform.claims.claimTask(ctx, {
      input: { goalRef: input.goalRef, planRef: input.planRef, taskId: input.taskId,
        sessionRef: session.sessionRef, roleBinding, budget: { tokenBudget: 100000, deadline: null } },
      meta: { requestId: `s4b-multiscope-claim-${input.suffix}`, expected: [
        { ref: input.goalRef, revision: goalRead.value.goal.revision },
        { ref: workspaceRef, revision: 1 },
        { ref: { ...session.sessionRef, aggregateType: 'Session' as const }, revision: card.value.record.revision },
      ] } });
    if (claimed.status !== 'committed') throw new Error(`S4B multi-scope claim failed: ${JSON.stringify(claimed)}`);
    return (claimed.value as unknown as { runRef: RunRef }).runRef;
  }
  async function revisePlan(goalRef: GoalRef,
    mutate: (draft: { stages: PlanRevisionDraft['stages']; tasks: PlanRevisionDraft['tasks'] }) =>
    { stages: PlanRevisionDraft['stages']; tasks: PlanRevisionDraft['tasks'] },
    affectedTaskIds?: string[]): Promise<PlanRevisionSnapshot> {
    const ctx = ctxFor(goalRef);
    const source = latest.get(planKey(goalRef));
    if (source === undefined) throw new Error(`S4B multi-scope: no plan for ${goalRef.goalId}`);
    const before = await platform.plans.queryGoal(ctx, goalRef);
    if (before.status !== 'ready') throw new Error('S4B multi-scope goal read failed');
    const { stages, tasks } = mutate({ stages: structuredClone(source.stages), tasks: structuredClone(source.tasks) });
    const revision = source.planRevision + 1;
    const requestId = `s4b-multiscope-revise-${++revisionSeq}`;
    const draftV: PlanRevisionDraft = {
      schemaVersion: 2, planId: `${source.ref.planId}-r${revision}`, planRevision: revision, goalId: goalRef.goalId,
      stages, tasks, assignments: structuredClone(source.assignments ?? []),
      obligations: structuredClone(source.obligations), taskHierarchy: structuredClone(source.taskHierarchy),
      executionDag: structuredClone(source.executionDag), taskRelations: [], inputRequirements: [],
    };
    const proposed = await platform.plans.proposePlan(ctx, {
      meta: { requestId: `${requestId}-propose`, expected: [{ ref: goalRef, revision: before.value.goal.revision }] },
      input: { goalRef, basedOn: source.ref, reason: { text: 'S4B multi-scope revision', sources: [],
        ...(affectedTaskIds === undefined ? {} : { affectedTaskIds }) }, draft: draftV } });
    if (proposed.status !== 'committed') throw new Error(`S4B multi-scope propose failed: ${JSON.stringify(proposed)}`);
    const after = await platform.plans.queryGoal(ctx, goalRef);
    if (after.status !== 'ready') throw new Error('S4B multi-scope goal re-read failed');
    const applied = await platform.plans.applyPlanChange(ctx, {
      meta: { requestId: `${requestId}-apply`, expected: [{ ref: goalRef, revision: after.value.goal.revision }] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    if (applied.status !== 'committed') throw new Error(`S4B multi-scope apply failed: ${JSON.stringify(applied)}`);
    const next = applied.value as unknown as PlanRevisionSnapshot;
    latest.set(planKey(goalRef), next);
    return next;
  }

  return {
    goal2Ref, plan2Ref, plan2, project2Ref, workspace2Ref, workspace2: { projectId: P2, workspaceId: W2 },
    goal2ProjectRef, plan2ProjectRef, plan2Project, ctxP2, claimRunFor,
    revisePlan,
    close: () => f.close(),
  };
}

export type { S4BNoteCheckFixture };
export { S4A_AT };
