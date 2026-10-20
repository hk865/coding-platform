/**
 * W2 future-intent composition tests (Stage 1 skeleton, real SQLite).
 *
 * The first test drives the REAL `createTargetPlatform` root (one durable SQLite
 * ledger) across a close/reopen and asserts an initial plan_only Plan is adopted
 * and remains visible. The second drives the REAL `createWhiteboardTools` factory
 * into the formal `PlanTaskPort` (propose → apply → query) with an
 * `executionIntent` draft. The factory here runs with a trusted HOST context, so
 * it only proves adapter forward-compatibility; Agent delegation keeps using the
 * already-accepted W2 whiteboard fixture.
 *
 * Both target adoptions stop at the Stage-1 explicit `unsupported` seam; the
 * failure reason is reported, never asserted as a success expectation.
 *
 * Specification: docs/refactor/tasks/W2-future-intent-skeleton.md §8/§9.3.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { GoalRef, ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import { createWhiteboardTools, WHITEBOARD_TOOL_NAMES } from '../../src/core/agent-runtime/whiteboard-tools.js';
import type { ToolCall, ToolDefinition, ToolResult, WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import type { PlanProposal, TaskGraph } from '../../src/core/work-graph/model/plan-contracts.js';
import { createTaskClaimFixture } from '../helpers/task-claim-fixture.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

type PlanDraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;

const AT = '2026-09-26T00:00:00.000Z';
const projectId = 'w2-composed';
const workspaceId = 'w2-composed-workspace';
const scope = { projectId, workspaceId };
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const actor = { kind: 'human' as const, id: 'w2-composed-operator' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: 'w2-intent-goal' };

const policyContent = { schemaVersion: 1 as const, requirementKinds: ['test'],
  minimumRequiredRequirementsPerObligation: 1 };
const architectureContent = { schemaVersion: 1 as const, description: 'W2 composed baseline', constraints: [] };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'w2-policy', revision: 1 };
const architectureRef = { aggregateType: 'ArchitectureBaselineRevision' as const, projectId, baselineId: 'w2-baseline', revision: 1 };

function workNode(taskId: string, title: string, executionIntent?: RuntimeTask['executionIntent']): RuntimeTask {
  return { taskId, title, requirementLevel: 'required', taskKind: 'work', disposition: 'active',
    phase: 'pending', scope: { kind: 'goal' },
    ...(executionIntent === undefined ? {} : { executionIntent }) };
}
function initialIntentDraft(goalIdValue: string, planId: string, planRevision: number): PlanDraftV2 {
  return { schemaVersion: 2, planId, planRevision, goalId: goalIdValue, stages: [],
    tasks: [workNode('explore', 'Explore the problem', 'plan_only')], assignments: [], obligations: [],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
}
function futureDraftFrom(plan: PlanRevisionSnapshot, planId: string): PlanDraftV2 {
  return { schemaVersion: 2, planId, planRevision: plan.planRevision + 1, goalId: plan.goalRef.goalId,
    stages: structuredClone(plan.stages), tasks: [...structuredClone(plan.tasks),
      workNode('refine-next', 'Refine the next unknown', 'plan_only')],
    assignments: structuredClone(plan.assignments ?? []), obligations: structuredClone(plan.obligations),
    taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
    taskRelations: plan.schemaVersion === 2 ? structuredClone(plan.taskRelations ?? []) : [],
    inputRequirements: plan.schemaVersion === 2 ? structuredClone(plan.inputRequirements ?? []) : [],
    ...(plan.reviewAdmissionProtocol === undefined ? {} : { reviewAdmissionProtocol: plan.reviewAdmissionProtocol }) };
}
function toolJson(result: ToolResult): unknown {
  const output = result.output as unknown as { kind: string; value: unknown }[];
  return output[0]?.value ?? null;
}

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it('real composition: an initial plan_only Plan adopts and survives a SQLite reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-w2-intent-'));
  dirs.push(directory);

  const workspaceBindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === projectId && requested.workspaceId === workspaceId
        ? { status: 'ready', value: { root: directory, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'unknown workspace' };
    },
    async authorize() { return { status: 'rejected', code: 'forbidden', reason: 'no source read grant' }; },
  };
  const options = { storage: { kind: 'sqlite' as const, directory }, workspace: workspaceBindings, now: () => AT,
    kernelStores: { entries: [{ adapterId: 'w2-kernel', storeKey: 'w2-kernel-store', workspace: scope,
      databasePath: join(directory, 'kernel.sqlite') }] } };

  const first = await createTargetPlatform(options);
  try {
    // Public bootstrap on the same SQLite platform: Project, Workspace, the
    // active CompletionPolicy and the initial ArchitectureBaseline.
    const createdProject = await first.projects.createProject(ctx, { meta: {
      requestId: 'w2-composed-create-project', expected: [{ ref: project.ref, revision: 0 }] },
      input: { projectId } });
    expect(createdProject).toMatchObject({ status: 'committed', replayed: false, value: project });
    const registered = await first.projects.registerWorkspace(ctx, { meta: {
      requestId: 'w2-composed-register-workspace', expected: [
        { ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 0 }] },
      input: { workspace: scope } });
    expect(registered).toMatchObject({ status: 'committed', replayed: false, value: workspace });
    const installed = await first.completionPolicies.installCompletionPolicy(ctx, { meta: {
      requestId: 'w2-composed-install-policy', expected: [
        { ref: project.ref, revision: 1 }, { ref: policyRef, revision: 0 }] },
      input: { policyId: policyRef.policyId, contentRevision: policyRef.revision, content: policyContent } });
    expect(installed).toMatchObject({ status: 'committed', replayed: false });
    if (installed.status !== 'committed') throw new Error('public CompletionPolicy install failed');
    expect(await first.completionPolicies.activateCompletionPolicy(ctx, { meta: {
      requestId: 'w2-composed-activate-policy', expected: [
        { ref: project.ref, revision: 1 },
        { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId }, revision: 0 }] },
      input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } }))
      .toMatchObject({ status: 'committed', replayed: false });
    expect(await first.architecture.adoptInitialArchitecture(ctx, { meta: {
      requestId: 'w2-composed-adopt-architecture', expected: [
        { ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { baselineId: architectureRef.baselineId, description: architectureContent.description,
        constraints: architectureContent.constraints,
        catalog: { requireDag: true, dependencies: [], modules: [] } } }))
      .toMatchObject({ status: 'committed', replayed: false });

    const goal = await first.goals.createGoal(ctx, { meta: { requestId: 'w2-composed-goal',
      expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
      input: { goalId: goalRef.goalId, workspace: scope, objective: 'W2 intent-only composed goal' } });
    expect(goal, JSON.stringify(goal)).toMatchObject({ status: 'committed' });
    const proposed = await first.plans.proposePlan(ctx, { meta: { requestId: 'w2-composed-propose', expected: [] },
      input: { goalRef, basedOn: null, draft: initialIntentDraft(goalRef.goalId, 'w2-intent-plan', 1),
        reason: { text: 'Record intent only', sources: [] } } });
    expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2' } });
    if (proposed.status !== 'committed') throw new Error('composed intent proposal failed');
    const applied = await first.plans.applyPlanChange(ctx, { meta: { requestId: 'w2-composed-apply', expected: [] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    // TARGET: the initial intent-only Plan is adopted.
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'committed' });
  } finally { await first.close(); }

  const reopened = await createTargetPlatform(options);
  try {
    const graph = await reopened.plans.queryTaskGraph(ctx, { goalRef });
    expect(graph, JSON.stringify(graph)).toMatchObject({ status: 'ready' });
    if (graph.status === 'ready') {
      expect(graph.value.tasks.map((task) => task.ref.taskId)).toContain('explore');
      expect(graph.value.planning).toMatchObject({ completionEvaluation: 'not_evaluated' });
    }
  } finally { await reopened.close(); }
});

it('real whiteboard factory proposes, adopts and queries an executionIntent future draft (Host pass-through)', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const handle = createWhiteboardTools({ plans: f.plans, context: f.ctx, goalRef: f.goalRef,
      requestIdForCall: (call: Readonly<ToolCall>) => `w2-tool-request:${call.callId}` });
    const definitions = handle.create({} as WorkspaceSandbox);
    expect(handle.names).toEqual(WHITEBOARD_TOOL_NAMES);
    const byName = (name: string): ToolDefinition => {
      const definition = definitions.find((candidate) => candidate.name === name);
      if (definition === undefined) throw new Error(`whiteboard tool ${name} is missing`);
      return definition;
    };
    const call = (name: string, callId: string, args: Record<string, unknown>): ToolCall =>
      ({ schemaVersion: 1, callId, name, arguments: args as ToolCall['arguments'] });

    const draft = futureDraftFrom(f.plan, 'w2-factory-plan');
    const proposeResult = await byName('propose_future_plan').handler.execute(
      call('propose_future_plan', 'w2-factory-propose', {
        basedOn: { ...f.planRef }, draft, reason: { text: 'Factory future intent', sources: [] }, expected: [],
      }), { signal: new AbortController().signal });
    expect(proposeResult.status, JSON.stringify(proposeResult)).toBe('success');
    const proposed = toolJson(proposeResult) as WriteResult<PlanProposal>;
    expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2' } });
    if (proposed.status !== 'committed' || proposed.value.kind !== 'candidate_v2') {
      throw new Error('factory propose did not persist a candidate_v2');
    }
    expect(proposed.value.draft.tasks.find((task) => task.taskId === 'refine-next')?.executionIntent,
      'the adapter must not drop the v2 field').toBe('plan_only');

    const applyResult = await byName('apply_future_plan').handler.execute(
      call('apply_future_plan', 'w2-factory-apply', {
        proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, expected: [],
      }), { signal: new AbortController().signal });
    expect(applyResult.status, JSON.stringify(applyResult)).toBe('success');
    const applied = toolJson(applyResult) as WriteResult<PlanRevisionSnapshot>;
    // TARGET: the factory chain adopts the future intent.
    expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'committed' });
    if (applied.status !== 'committed') throw new Error('factory apply did not commit');

    const queryResult = await byName('query_task_graph').handler.execute(
      call('query_task_graph', 'w2-factory-query', {}), { signal: new AbortController().signal });
    expect(queryResult.status, JSON.stringify(queryResult)).toBe('success');
    const graph = toolJson(queryResult) as ReadResult<TaskGraph>;
    expect(graph).toMatchObject({ status: 'ready' });
    if (graph.status === 'ready') {
      expect(graph.value.tasks.find((task) => task.ref.taskId === 'refine-next')?.definition.executionIntent)
        .toBe('plan_only');
      expect(graph.value.planning).toMatchObject({ completionEvaluation: 'not_evaluated' });
    }
  } finally { await f.close(); }
});
