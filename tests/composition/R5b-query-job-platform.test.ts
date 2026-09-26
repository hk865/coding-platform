/**
 * R5b.1 stage-1 public composition acceptance on a TRULY EMPTY SQLite database.
 *
 * The whole path is produced only by public ports: the real
 * `createTargetPlatform` composition root creates the Project, registers the
 * Workspace, creates the Goal and (for the focus case) adopts governance and a
 * Plan; no raw Store commit and no pre-seeded scope fixture is used.
 *
 * Stage-1 skeleton: `submitQueryJob`/`readQueryJob` are explicitly `unsupported`,
 * so these assertions are EXPECTED to be red until the stage-2 implementation
 * lands. They stop at the first unsupported writer; the later assertions have
 * NOT been reached by the skeleton run (reported as such).
 *
 * Specification: docs/refactor/tasks/R5b-query-planning-skeleton.md §7.1/3/5.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

const AT = '2026-09-26T00:00:00.000Z';
const projectId = 'r5b-platform-project';
const workspaceId = 'r5b-platform-workspace';
const scope = { projectId, workspaceId };
const human = { kind: 'human' as const, id: 'r5b-platform-operator' };
const system = { kind: 'system' as const, id: 'r5b-platform-scheduler' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'r5b-platform-goal' };
const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId, workspaceId, queryJobId: 'r5b-platform-job' };
const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId, workspaceId, queryJobId: 'r5b-platform-job', runId: 'r5b-platform-run' };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'r5b-policy', revision: 1 };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const policyContent = { schemaVersion: 1 as const, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'r5b-platform-binding', templateId: 'advisor', templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const runtimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: 1, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 };

function ctxFor(projectIdValue: string, workspaceIdValue: string | undefined, actor: typeof human | typeof system = human): CoreCallContext {
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
const queryRunCtx: CoreCallContext = { projectId, workspaceId,
  principal: { kind: 'query_run', queryRunRef, initiator: human },
  materialReader: { kind: 'host', projectId, workspaceId, actor: human }, signal: new AbortController().signal };
const workRunCtx: CoreCallContext = { projectId, workspaceId,
  principal: { kind: 'work_run', runRef: { aggregateType: 'Run', projectId, goalId: goalRef.goalId, runId: 'r5b-platform-work-run' }, roleBinding },
  materialReader: { kind: 'host', projectId, workspaceId, actor: human }, signal: new AbortController().signal };

function initialCoordinationIntent(overrides: Partial<QueryJobIntentV1> = {}): QueryJobIntentV1 {
  return {
    schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId, workspaceId, goalId: goalRef.goalId,
    question: 'Explain the goal and outline the investigation', focusTaskRefs: [],
    budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: 'r5b-platform-corr',
    execution: { kind: 'initial_coordination', roleBinding, runtimeBudget },
    ...overrides,
  };
}
function submitRequest(requestId: string, intent: QueryJobIntentV1 = initialCoordinationIntent()) {
  return { meta: { requestId, expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }, { ref: goalRef, revision: 1 },
    { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 },
  ] }, input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent } };
}

type PlanDraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;
/** One plan_only future node (W2 contract): queryable, but not requiring execution. */
function futureFocusDraft(goalId: string, planId: string): PlanDraftV2 {
  return { schemaVersion: 2, planId, planRevision: 1, goalId, stages: [],
    tasks: [{ taskId: 'explore', title: 'Investigate without executing', requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' }],
    assignments: [], obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
    taskRelations: [], inputRequirements: [] };
}

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

type HostState = { revision: number | null; readAllowed: boolean; resolveRootCalls: number; authorizeCalls: number };
/** Held Host binding state: no pending submit may open the directory or ask the Host for root/authorization. */
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
        ? { status: 'ready', value: { subjectKey: 'r5b-host', permissionRevision: 'host-grant-1', allowsRead: () => true } }
        : { status: 'rejected', code: 'forbidden', reason: 'the Host revoked this workspace read' };
    },
  };
}
const newState = (): HostState => ({ revision: null, readAllowed: true, resolveRootCalls: 0, authorizeCalls: 0 });

async function seedProjectWorkspaceGoal(platform: Awaited<ReturnType<typeof createTargetPlatform>>, state: HostState, goalId = goalRef.goalId) {
  const project = await platform.projects.createProject(hostCtx(), { meta: { requestId: 'r5b-platform-project-1', expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } });
  expect(project).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(hostCtx(), { meta: { requestId: 'r5b-platform-workspace-1', expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  expect(registered).toMatchObject({ status: 'committed' });
  if (registered.status !== 'committed') throw new Error('public Workspace registration failed');
  state.revision = registered.value.revision;
  const goal = await platform.goals.createGoal(hostCtx(), { meta: { requestId: 'r5b-platform-goal-1', expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId, workspace: scope, objective: 'Deliver the R5b public pending QueryJob path' } });
  expect(goal).toMatchObject({ status: 'committed' });
}

it('submits and reads a no-Plan pending pair on an empty SQLite database and survives reopen without touching any source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-r5b-platform-'));
  directories.push(directory);
  await writeFile(join(directory, 'notes.txt'), 'unopened registered workspace content\n');
  const state = newState();
  const options = { storage: { kind: 'sqlite' as const, directory }, workspace: workspaceBindings(directory, state), now: () => AT };
  const request = submitRequest('r5b-platform-submit-1');

  const platform = await createTargetPlatform(options);
  try {
    await seedProjectWorkspaceGoal(platform, state);

    const submitted = await platform.queries.submitQueryJob(hostCtx(), request);
    expect(submitted).toMatchObject({ status: 'committed', replayed: false });
    if (submitted.status !== 'committed') throw new Error('public pending submit failed');
    expect(submitted.value.job).toMatchObject({ ref: queryJobRef, revision: 1,
      job: { status: 'pending', goalId: goalRef.goalId, runRef: queryRunRef, answerRefs: [], closeReason: null } });
    expect(submitted.value.run).toMatchObject({ ref: queryRunRef, revision: 1,
      run: { status: 'pending', startedAt: null, endedAt: null, outcome: null } });
    expect(await platform.queries.readQueryJob(hostCtx(), queryJobRef)).toMatchObject({ status: 'ready', value: submitted.value });

    // No Plan, Task, Session or model work is created by a pending submit.
    expect(await platform.plans.queryGoal(hostCtx(), goalRef)).toMatchObject({ status: 'ready', value: { goal: { activePlanRevision: null } } });
    expect(state.resolveRootCalls).toBe(0);
    expect(state.authorizeCalls).toBe(0);
  } finally { await platform.close(); }

  const reopened = await createTargetPlatform(options);
  try {
    expect(await reopened.queries.readQueryJob(hostCtx(), queryJobRef)).toMatchObject({ status: 'ready' });
    expect(await reopened.queries.submitQueryJob(hostCtx(), request)).toMatchObject({ status: 'committed', replayed: true });
  } finally { await reopened.close(); }
});

it('anchors a semantic query to an accepted Plan focus node and leaves Task/Run state unchanged', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-r5b-focus-'));
  directories.push(directory);
  const state = newState();
  const platform = await createTargetPlatform({ storage: { kind: 'sqlite' as const, directory }, workspace: workspaceBindings(directory, state), now: () => AT });
  try {
    await seedProjectWorkspaceGoal(platform, state);
    const installed = await platform.completionPolicies.installCompletionPolicy(hostCtx(), { meta: { requestId: 'r5b-platform-policy-1', expected: [
      { ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
      input: { policyId: 'r5b-policy', contentRevision: 1, content: policyContent } });
    expect(installed).toMatchObject({ status: 'committed' });
    if (installed.status !== 'committed') throw new Error('policy install failed');
    expect(await platform.completionPolicies.activateCompletionPolicy(hostCtx(), { meta: { requestId: 'r5b-platform-policy-activate-1', expected: [
      { ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
      input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
    expect(await platform.architecture.adoptInitialArchitecture(hostCtx(), { meta: { requestId: 'r5b-platform-adopt-1', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
      input: { baselineId: 'r5b-baseline', description: 'The formal R5b module boundary', constraints: [], catalog: { requireDag: true, dependencies: [], modules: [
        { ref: { projectId, moduleId: 'r5b-query' }, name: 'R5b query', responsibility: 'Accept pending QueryJobs', paths: ['src/core/work-graph/queries'], interfaces: [] },
      ] } } })).toMatchObject({ status: 'committed' });

    const proposed = await platform.plans.proposePlan(hostCtx(), { meta: { requestId: 'r5b-platform-propose-1', expected: [] },
      input: { goalRef, basedOn: null, draft: futureFocusDraft(goalRef.goalId, 'r5b-platform-plan'),
        reason: { text: 'Initial R5b focus plan', sources: [] } } });
    expect(proposed).toMatchObject({ status: 'committed' });
    if (proposed.status !== 'committed') throw new Error('focus proposal failed');
    const applied = await platform.plans.applyPlanChange(hostCtx(), { meta: { requestId: 'r5b-platform-apply-1', expected: [] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    expect(applied).toMatchObject({ status: 'committed' });
    if (applied.status !== 'committed') throw new Error('focus plan adoption failed');

    const before = await platform.plans.queryTaskGraph(hostCtx(), { goalRef });
    expect(before).toMatchObject({ status: 'ready' });
    if (before.status !== 'ready') throw new Error('task graph read failed');
    const explore = before.value.tasks.find(task => task.ref.taskId === 'explore');
    expect(explore).toMatchObject({ definition: { executionIntent: 'plan_only', phase: 'pending' } });

    const focus = [{ aggregateType: 'Task' as const, projectId, goalId: goalRef.goalId, taskId: 'explore' }];
    const submitted = await platform.queries.submitQueryJob(hostCtx(), { meta: { requestId: 'r5b-platform-focus-submit', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }, { ref: goalRef, revision: 2 },
      { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] },
      input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId,
        intent: initialCoordinationIntent({ execution: { kind: 'semantic_query', roleBinding, runtimeBudget }, focusTaskRefs: focus,
          budget: { maxTokens: 4096, deadline: null } }) } });
    expect(submitted).toMatchObject({ status: 'committed' });
    if (submitted.status !== 'committed') throw new Error('focused semantic submit failed');
    expect(submitted.value.job.job.intent.focusTaskRefs).toEqual(focus);

    const after = await platform.plans.queryTaskGraph(hostCtx(), { goalRef });
    expect(after).toMatchObject({ status: 'ready' });
    expect(after.status === 'ready' ? after.value.tasks.find(task => task.ref.taskId === 'explore') : null)
      .toMatchObject({ definition: { executionIntent: 'plan_only', phase: 'pending' } });
  } finally { await platform.close(); }
});

it('rejects untrusted principals and cross-scope writes, keeps ordinary reads model-free, and rejects new calls after close', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-r5b-boundary-'));
  directories.push(directory);
  const state = newState();
  const platform = await createTargetPlatform({ storage: { kind: 'sqlite' as const, directory }, workspace: workspaceBindings(directory, state), now: () => AT });
  let closed = false;
  try {
    await seedProjectWorkspaceGoal(platform, state);

    expect(await platform.queries.submitQueryJob(workRunCtx, submitRequest('r5b-platform-bound-work-run')))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await platform.queries.submitQueryJob(queryRunCtx, submitRequest('r5b-platform-bound-query-run')))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await platform.queries.submitQueryJob(ctxFor('another-project', undefined), submitRequest('r5b-platform-bound-foreign')))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });

    // Ordinary reads never start a model: no Runtime Host binding exists here.
    expect(await platform.plans.queryGoal(hostCtx(), goalRef)).toMatchObject({ status: 'ready' });
    expect(await platform.runtime.capabilities(hostCtx(), scope)).toMatchObject({ status: 'rejected' });
    expect(await platform.queries.readQueryJob(hostCtx(), queryJobRef)).toMatchObject({ status: 'not_found' });

    // close drains the in-flight submit before it rejects new calls.
    const inFlight = platform.queries.submitQueryJob(hostCtx(), submitRequest('r5b-platform-close-inflight'));
    const closing = platform.close();
    closed = true;
    expect(await inFlight).toMatchObject({ status: 'committed' });
    await closing;
    expect(await platform.queries.readQueryJob(hostCtx(), queryJobRef)).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(await platform.queries.submitQueryJob(hostCtx(), submitRequest('r5b-platform-after-close'))).toMatchObject({ status: 'rejected', code: 'unavailable' });
  } finally { if (!closed) await platform.close(); }
});
