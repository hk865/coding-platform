/**
 * R5a minimal consumer acceptance on a TRULY EMPTY SQLite database.
 *
 * The full path is produced only by public ports: the real
 * `createTargetPlatform` composition root creates the Project, registers the
 * Workspace, creates the Goal, installs and activates the CompletionPolicy,
 * adopts the initial architecture and accepts a Plan. No raw Store commit, no
 * pre-seeded scope/governance fixture and no task-claim fixture is used.
 *
 * Stage-1 skeleton: the four initialization writers are explicitly
 * `unsupported`, so these assertions are EXPECTED to be red until the stage-2
 * implementation lands. The tests stop at the first unsupported writer; the
 * later assertions have NOT been reached by the skeleton run (reported as such).
 *
 * Specification: docs/refactor/tasks/R5a-project-bootstrap-skeleton.md §7.1-3.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

const AT = '2026-09-26T00:00:00.000Z';
const projectId = 'r5a-platform-project';
const workspaceId = 'r5a-platform-workspace';
const scope = { projectId, workspaceId };
const actor = { kind: 'human' as const, id: 'r5a-platform-operator' };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'r5a-goal' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'r5a-policy', revision: 1 };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const policyContent = { schemaVersion: 1 as const, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 };

function ctxFor(projectIdValue: string, workspaceIdValue?: string): CoreCallContext {
  const readerScope = workspaceIdValue === undefined ? {} : { workspaceId: workspaceIdValue };
  return {
    projectId: projectIdValue,
    ...readerScope,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: projectIdValue, ...readerScope, actor },
    signal: new AbortController().signal,
  };
}
const hostCtx = () => ctxFor(projectId, workspaceId);

type PlanDraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;
function initialDraft(goalId: string, planId: string): PlanDraftV2 {
  return { schemaVersion: 2, planId, planRevision: 1, goalId, stages: [],
    tasks: [
      { taskId: 'implement', title: 'Implement the bootstrap path', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'goal-gate', title: 'Goal acceptance gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'implement', role: 'builder', instruction: 'Implement the R5a bootstrap path' }],
    obligations: [{ obligationId: 'r5a-obligation', title: 'Deliver the bootstrap path', requirementLevel: 'required',
      taskIds: ['implement', 'goal-gate'],
      verificationRequirements: [{ requirementId: 'r5a-check', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
}

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

type HostState = { revision: number | null; readAllowed: boolean; resolveRootCalls: number; authorizeCalls: number };
/** Held Host binding state: the domain workspace revision is learned ONLY from
 * the public registration result; the Host permission generation is a separate
 * opaque value; both call counters prove registration opens no directory. */
function workspaceBindings(directory: string, state: HostState): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      state.resolveRootCalls += 1;
      if (requested.projectId !== projectId || requested.workspaceId !== workspaceId || state.revision === null) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: state.revision } };
    },
    async authorize() {
      state.authorizeCalls += 1;
      return state.readAllowed
        ? { status: 'ready', value: { subjectKey: 'r5a-host', permissionRevision: 'host-grant-7', allowsRead: () => true } }
        : { status: 'rejected', code: 'forbidden', reason: 'the Host revoked this workspace read' };
    },
  };
}
const newState = (): HostState => ({ revision: null, readAllowed: true, resolveRootCalls: 0, authorizeCalls: 0 });

it('bootstraps an empty SQLite store to an accepted Plan and replays the four initialization receipts after reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-r5a-platform-'));
  directories.push(directory);
  await writeFile(join(directory, 'notes.txt'), 'real registered workspace content\n');
  const state = newState();
  const options = { storage: { kind: 'sqlite' as const, directory }, workspace: workspaceBindings(directory, state), now: () => AT };

  const projectRequest = { meta: { requestId: 'r5a-project-1', expected: [{ ref: projectRef, revision: 0 }] },
    input: { projectId } };
  const workspaceRequest = { meta: { requestId: 'r5a-workspace-1', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } };
  const policyRequest = { meta: { requestId: 'r5a-policy-install-1', expected: [
      { ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
    input: { policyId: 'r5a-policy', contentRevision: 1, content: policyContent } };

  const platform = await createTargetPlatform(options);
  try {
    const project = await platform.projects.createProject(hostCtx(), projectRequest);
    expect(project).toMatchObject({ status: 'committed', replayed: false, value: { ref: projectRef, revision: 1 } });
    if (project.status !== 'committed') throw new Error('public Project registration failed');
    const projectSnapshot = project.value;

    const registered = await platform.projects.registerWorkspace(hostCtx(), workspaceRequest);
    expect(registered).toMatchObject({ status: 'committed', replayed: false, value: { ref: workspaceRef, revision: 1 } });
    if (registered.status !== 'committed') throw new Error('public Workspace registration failed');
    const workspaceSnapshot = registered.value;
    // Domain registration must not open the directory or ask the Host for root/authorization.
    expect(state.resolveRootCalls).toBe(0);
    expect(state.authorizeCalls).toBe(0);
    // The domain revision comes from the REAL registration result, not a fixture.
    state.revision = workspaceSnapshot.revision;

    const readBefore = await platform.workspace.readWorkspace(hostCtx(), { workspace: workspaceRef,
      path: 'notes.txt', maxBytes: 1024, version: { kind: 'working_tree' } });
    expect(readBefore).toMatchObject({ status: 'ready', value: { path: 'notes.txt', content: 'real registered workspace content\n' } });
    expect(state.resolveRootCalls).toBeGreaterThan(0);
    expect(state.authorizeCalls).toBeGreaterThan(0);

    const goal = await platform.goals.createGoal(hostCtx(), { meta: { requestId: 'r5a-goal-1', expected: [
        { ref: projectSnapshot.ref, revision: 1 }, { ref: workspaceSnapshot.ref, revision: 1 }] },
      input: { goalId: goalRef.goalId, workspace: scope, objective: 'Deliver the R5a public bootstrap path' } });
    expect(goal).toMatchObject({ status: 'committed', replayed: false });
    if (goal.status !== 'committed') throw new Error('real Goal creation failed');

    const proposed = await platform.plans.proposePlan(hostCtx(), { meta: { requestId: 'r5a-propose-1', expected: [] },
      input: { goalRef, basedOn: null, draft: initialDraft(goalRef.goalId, 'r5a-plan'), reason: { text: 'Initial R5a plan', sources: [] } } });
    expect(proposed).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2', issues: [] } });
    if (proposed.status !== 'committed') throw new Error('real Plan proposal failed');

    // Install but do not activate: this only proves the MERGED governance gate is
    // incomplete (activation is still absent); the two unique-cause checks are
    // the missing-architecture case below and the missing-policy case on the
    // second project.
    const installed = await platform.completionPolicies.installCompletionPolicy(hostCtx(), policyRequest);
    expect(installed).toMatchObject({ status: 'committed', replayed: false,
      value: { ref: policyRef, revision: 1, policyId: 'r5a-policy', contentRevision: 1, content: policyContent } });
    if (installed.status !== 'committed') throw new Error('public CompletionPolicy install failed');
    const installedSnapshot = installed.value;
    expect(await platform.plans.applyPlanChange(hostCtx(), { meta: { requestId: 'r5a-apply-policy-inactive', expected: [] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } }))
      .toMatchObject({ status: 'rejected', code: 'incomplete' });

    const activationMeta = { requestId: 'r5a-policy-activate-1', expected: [
      { ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] };
    const activationInput = { target: { ref: installedSnapshot.ref, digest: installedSnapshot.contentDigest } };
    const activated = await platform.completionPolicies.activateCompletionPolicy(hostCtx(), {
      meta: activationMeta, input: activationInput });
    expect(activated).toMatchObject({ status: 'committed', replayed: false,
      value: { ref: activeRef, projectId, activeRevision: policyRef, revision: 1 } });
    if (activated.status !== 'committed') throw new Error('public CompletionPolicy activation failed');
    const activatedSnapshot = activated.value;

    // Active policy but NO architecture: adoption is incomplete for that cause.
    expect(await platform.plans.applyPlanChange(hostCtx(), { meta: { requestId: 'r5a-apply-no-architecture', expected: [] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } }))
      .toMatchObject({ status: 'rejected', code: 'incomplete' });

    const adopted = await platform.architecture.adoptInitialArchitecture(hostCtx(), { meta: { requestId: 'r5a-adopt-1', expected: [
        { ref: projectSnapshot.ref, revision: 1 }, { ref: workspaceSnapshot.ref, revision: 1 }] },
      input: { baselineId: 'r5a-baseline', description: 'The formal R5a module boundary', constraints: [],
        catalog: { requireDag: true, dependencies: [], modules: [
          { ref: { projectId, moduleId: 'r5a-bootstrap' }, name: 'R5a bootstrap',
            responsibility: 'Create Project/Workspace and configure the CompletionPolicy',
            paths: ['src/core/work-graph/configuration'], interfaces: [] },
        ] } } });
    expect(adopted).toMatchObject({ status: 'committed' });
    if (adopted.status !== 'committed') throw new Error('real initial architecture adoption failed');

    const applied = await platform.plans.applyPlanChange(hostCtx(), { meta: { requestId: 'r5a-apply-1', expected: [] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    expect(applied).toMatchObject({ status: 'committed', replayed: false });
    if (applied.status !== 'committed') throw new Error('real Plan acceptance failed');

    expect(await platform.plans.queryGoal(hostCtx(), goalRef)).toMatchObject({ status: 'ready',
      value: { goal: { activePlanRevision: applied.value.ref } } });
    const acceptedGraph = await platform.plans.queryTaskGraph(hostCtx(), { goalRef });
    expect(acceptedGraph).toMatchObject({ status: 'ready', value: { plan: { ref: applied.value.ref } } });
    if (acceptedGraph.status !== 'ready') throw new Error('real accepted-Plan read failed');
    const acceptedPolicyPin = acceptedGraph.value.plan.effectiveCompletionPolicy;

    // A later policy activation moves only the project default pointer; the
    // already accepted Plan keeps its exact original pin.
    const secondPolicyRef = { ...policyRef, revision: 2 };
    const installedSecond = await platform.completionPolicies.installCompletionPolicy(hostCtx(), {
      meta: { requestId: 'r5a-policy-install-2', expected: [{ ref: projectRef, revision: 1 }, { ref: secondPolicyRef, revision: 0 }] },
      input: { policyId: 'r5a-policy', contentRevision: 2, content: policyContent } });
    expect(installedSecond).toMatchObject({ status: 'committed' });
    if (installedSecond.status !== 'committed') throw new Error('second policy install failed');
    expect(await platform.completionPolicies.activateCompletionPolicy(hostCtx(), {
      meta: { requestId: 'r5a-policy-activate-2', expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 1 }] },
      input: { target: { ref: installedSecond.value.ref, digest: installedSecond.value.contentDigest } } }))
      .toMatchObject({ status: 'committed', value: { activeRevision: secondPolicyRef, revision: 2 } });
    expect(await platform.plans.queryTaskGraph(hostCtx(), { goalRef })).toMatchObject({ status: 'ready',
      value: { plan: { effectiveCompletionPolicy: acceptedPolicyPin } } });

    // A denied directory read cannot erase the registration/activation receipts.
    state.readAllowed = false;
    expect(await platform.workspace.readWorkspace(hostCtx(), { workspace: workspaceRef,
      path: 'notes.txt', maxBytes: 1024, version: { kind: 'working_tree' } }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });

    await platform.close();

    const reopened = await createTargetPlatform(options);
    try {
      expect(await reopened.projects.createProject(hostCtx(), projectRequest)).toMatchObject(
        { status: 'committed', replayed: true, value: projectSnapshot, cursor: project.cursor });
      expect(await reopened.projects.registerWorkspace(hostCtx(), workspaceRequest)).toMatchObject(
        { status: 'committed', replayed: true, value: workspaceSnapshot, cursor: registered.cursor });
      expect(await reopened.completionPolicies.installCompletionPolicy(hostCtx(), policyRequest)).toMatchObject(
        { status: 'committed', replayed: true, value: installedSnapshot, cursor: installed.cursor });
      expect(await reopened.completionPolicies.activateCompletionPolicy(hostCtx(), {
        meta: activationMeta, input: activationInput })).toMatchObject(
        { status: 'committed', replayed: true, value: activatedSnapshot, cursor: activated.cursor });
      expect(await reopened.plans.queryGoal(hostCtx(), goalRef)).toMatchObject({ status: 'ready' });
      expect(await reopened.plans.queryTaskGraph(hostCtx(), { goalRef })).toMatchObject({ status: 'ready' });
    } finally { await reopened.close(); }
  } finally {
    await platform.close().catch(() => undefined);
  }
});

it('creates a second project/Workspace without touching the first, and isolates a missing policy cause', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-r5a-multi-'));
  directories.push(directory);
  const state = newState();
  const options = { storage: { kind: 'sqlite' as const, directory }, workspace: workspaceBindings(directory, state), now: () => AT };
  const platform = await createTargetPlatform(options);
  try {
    const firstProject = await platform.projects.createProject(hostCtx(), { meta: { requestId: 'r5a-p1', expected: [{ ref: projectRef, revision: 0 }] },
      input: { projectId } });
    expect(firstProject).toMatchObject({ status: 'committed' });
    const firstWorkspace = await platform.projects.registerWorkspace(hostCtx(), { meta: { requestId: 'r5a-w1', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
    expect(firstWorkspace).toMatchObject({ status: 'committed' });

    const secondProjectId = 'r5a-second-project';
    const secondProjectRef = { aggregateType: 'Project' as const, projectId: secondProjectId };
    const secondProject = await platform.projects.createProject(ctxFor(secondProjectId),
      { meta: { requestId: 'r5a-p2', expected: [{ ref: secondProjectRef, revision: 0 }] }, input: { projectId: secondProjectId } });
    expect(secondProject).toMatchObject({ status: 'committed', value: { ref: secondProjectRef, revision: 1 } });
    if (secondProject.status !== 'committed') throw new Error('second Project registration failed');

    const secondWorkspaceId = 'r5a-second-workspace';
    const secondWorkspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId: secondWorkspaceId };
    const secondWorkspace = await platform.projects.registerWorkspace(ctxFor(projectId, secondWorkspaceId),
      { meta: { requestId: 'r5a-w2', expected: [
        { ref: projectRef, revision: 1 }, { ref: secondWorkspaceRef, revision: 0 }] },
        input: { workspace: { projectId, workspaceId: secondWorkspaceId } } });
    expect(secondWorkspace).toMatchObject({ status: 'committed', value: { ref: secondWorkspaceRef, revision: 1 } });

    // Registering the second Workspace must not bump the first Workspace or the
    // Project: a Goal in the first workspace still pins both at revision 1.
    expect(await platform.goals.createGoal(hostCtx(), { meta: { requestId: 'r5a-goal-after-w2', expected: [
        { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
      input: { goalId: 'r5a-goal-first-workspace', workspace: scope, objective: 'Still addressable at revision 1' } }))
      .toMatchObject({ status: 'committed' });

    // Isolated missing-POLICY cause: the second project adopts a formal
    // architecture with NO CompletionPolicy at all; a real Plan adoption is then
    // incomplete because the policy is missing, not because architecture is.
    const p2WorkspaceId = 'r5a-second-project-workspace';
    const p2WorkspaceRef = { aggregateType: 'Workspace' as const, projectId: secondProjectId, workspaceId: p2WorkspaceId };
    const p2GoalRef = { aggregateType: 'Goal' as const, projectId: secondProjectId, goalId: 'r5a-second-goal' };
    const p2Ctx = ctxFor(secondProjectId, p2WorkspaceId);
    expect(await platform.projects.registerWorkspace(p2Ctx, { meta: { requestId: 'r5a-p2-w', expected: [
        { ref: secondProjectRef, revision: 1 }, { ref: p2WorkspaceRef, revision: 0 }] },
      input: { workspace: { projectId: secondProjectId, workspaceId: p2WorkspaceId } } }))
      .toMatchObject({ status: 'committed' });
    expect(await platform.goals.createGoal(p2Ctx, { meta: { requestId: 'r5a-p2-goal', expected: [
        { ref: secondProjectRef, revision: 1 }, { ref: p2WorkspaceRef, revision: 1 }] },
      input: { goalId: p2GoalRef.goalId, workspace: { projectId: secondProjectId, workspaceId: p2WorkspaceId },
        objective: 'Architecture without a policy' } }))
      .toMatchObject({ status: 'committed' });
    expect(await platform.architecture.adoptInitialArchitecture(p2Ctx, { meta: { requestId: 'r5a-p2-adopt', expected: [
        { ref: secondProjectRef, revision: 1 }, { ref: p2WorkspaceRef, revision: 1 }] },
      input: { baselineId: 'r5a-p2-baseline', description: 'Second project baseline', constraints: [],
        catalog: { requireDag: true, dependencies: [], modules: [
          { ref: { projectId: secondProjectId, moduleId: 'r5a-module' }, name: 'R5a module',
            responsibility: 'Second project module', paths: ['src'], interfaces: [] }] } } }))
      .toMatchObject({ status: 'committed' });
    const p2Proposal = await platform.plans.proposePlan(p2Ctx, { meta: { requestId: 'r5a-p2-propose', expected: [] },
      input: { goalRef: p2GoalRef, basedOn: null, draft: initialDraft(p2GoalRef.goalId, 'r5a-p2-plan'),
        reason: { text: 'Initial second-project plan', sources: [] } } });
    expect(p2Proposal).toMatchObject({ status: 'committed' });
    if (p2Proposal.status !== 'committed') throw new Error('second-project proposal failed');
    expect(await platform.plans.applyPlanChange(p2Ctx, { meta: { requestId: 'r5a-p2-apply', expected: [] },
      input: { proposalRef: p2Proposal.value.ref, expectedProposalRevision: p2Proposal.value.revision, decisionRefs: [] } }))
      .toMatchObject({ status: 'rejected', code: 'incomplete' });
  } finally { await platform.close(); }
});
