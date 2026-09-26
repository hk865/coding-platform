/**
 * R5b.4 chain two: a real initial_coordination answer -> handleGoalInput's two
 * narrow branches -> the already-adopted advanceWork loop through formal
 * execution, registered checks and the independent Goal gate.
 *
 * The whole normal path is produced by public ports on a real SQLite ledger and
 * the frozen Kernel: public Project/Workspace/Goal (no Plan/policy/baseline), then the formal
 * Query submit/claim/prepare/start and
 * a controlled local provider. The same Host then drives every `next` request
 * the Workflow returns; no domain result is faked and both ordinary work runs
 * plus the goal gate use the real ProcessSandbox.
 *
 * Stage one: the first `handleGoalInput(planning_answer)` is expected to fail at
 * the explicitly unsupported initial-planning Workflow seam, so the candidate /
 * adoption / execution tail is NOT reached by the skeleton. The test is the
 * final acceptance shape and must not be relaxed to pass early.
 *
 * Specification: docs/refactor/tasks/R5b-query-planning-skeleton.md §11.5/§11.6.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { InitialPlanningResponseV2 } from '../../src/contracts/initial-planning.js';
import type { PlanProposal } from '../../src/core/work-graph/tasks/plan-contracts.js';
import type { QueryJobAnswerRef, QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { InitialPlanningGoalInput, WorkflowAdvanceInput, WorkflowOperation, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';

const AT = '2026-09-26T00:00:00.000Z';
const projectId = 'r5b-iw-project';
const workspaceId = 'r5b-iw-workspace';
const scope = { projectId, workspaceId };
const hostActor = { kind: 'human' as const, id: 'r5b-iw-host' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'r5b-iw-goal' };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'r5b-iw-policy', revision: 1 };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId, workspaceId, queryJobId: 'r5b-iw-job' };
const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId, workspaceId, queryJobId: 'r5b-iw-job', runId: 'r5b-iw-run' };
const queryRoleBinding = { schemaVersion: 1 as const, bindingId: 'r5b-iw-query-binding', templateId: 'advisor', templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const querySessionRole = { kind: 'legacy_template' as const, templateId: 'advisor', templateRevision: '1' };
const workRoleBinding = { schemaVersion: 1 as const, bindingId: 'r5b-iw-work-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const runtimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const workInstruction = 'R5b IW trusted static work guidance';
const queryInstruction = 'R5b IW trusted read-only query guidance';

/** One real v2 reply: two executable works, a goal gate and one optional future. */
const PLAN_RESPONSE: InitialPlanningResponseV2 = {
  schemaVersion: 2,
  kind: 'plan',
  summary: 'Initial plan from the real coordination answer before any adoption',
  plan: {
    schemaVersion: 2,
    stages: [],
    tasks: [
      { taskId: 'work-1', title: 'First ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'work-2', title: 'Second ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'future-intent', title: 'Optional future investigation', requirementLevel: 'optional', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' },
    ],
    assignments: [
      { taskId: 'work-1', role: 'builder', instruction: 'Do the first ordinary work' },
      { taskId: 'work-2', role: 'builder', instruction: 'Do the second ordinary work' },
    ],
    obligations: [{ obligationId: 'r5b-iw-obligation', title: 'Deliver the initial plan work',
      requirementLevel: 'required', taskIds: ['work-1', 'work-2', 'goal-gate'],
      verificationRequirements: [{ requirementId: 'r5b-iw-static', requirementLevel: 'required',
        kind: 'static', description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
    taskRelations: [],
    inputRequirements: [],
  },
};
const PLAN_ANSWER_TEXT = JSON.stringify(PLAN_RESPONSE);

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

function ctx(): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor: hostActor },
    materialReader: { kind: 'host', projectId, workspaceId, actor: hostActor }, signal: new AbortController().signal };
}
function initialCoordinationIntent(): QueryJobIntentV1 {
  return {
    schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId, workspaceId, goalId: goalRef.goalId,
    question: 'Read the project sources and propose the initial plan',
    focusTaskRefs: [], budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 },
    correlationId: 'r5b-iw-corr', execution: { kind: 'initial_coordination', roleBinding: queryRoleBinding, runtimeBudget },
  };
}

type HostState = { revision: number; readAllowed: boolean };
function workspaceBindings(directory: string, state: HostState): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== projectId || requested.workspaceId !== workspaceId) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: state.revision } };
    },
    async authorize() {
      return state.readAllowed
        ? { status: 'ready', value: { subjectKey: 'r5b-iw-host', permissionRevision: 'r5b-iw-host-grant-1', allowsRead: () => true } }
        : { status: 'rejected', code: 'forbidden', reason: 'the Host revoked this workspace read' };
    },
  };
}

function runtimeHost(scripted: ReturnType<typeof createScriptedModel>): RuntimeHostBindings {
  const skills = { resourceRoot: fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url)), enabledIds: [] as string[] };
  const model = (revision: string, name: string) => ({
    configuration: { revision, provider: 'deepseek', model: name, baseUrl: 'http://127.0.0.1' },
    client: scripted.client,
    inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'r5b-iw-fixture-counter' }) },
  });
  return {
    async resolveConfiguration(context, request) {
      if (context.projectId !== projectId || context.workspaceId !== workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the runtime Host is not bound to this workspace' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'the current Role binding is inadmissible' };
      }
      return { status: 'ready', value: {
        configurationRevision: 'r5b-iw-work-host@1', model: model('r5b-iw-work-host@1', 'r5b-iw-scripted'),
        budget: runtimeBudget,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex(workInstruction) } : null,
        tools: ['read'], writeScope: [], skills, systemInstruction: workInstruction, deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
    async resolveQueryConfiguration() {
      return { status: 'ready', value: {
        configurationRevision: 'r5b-iw-query-host@1', model: model('r5b-iw-query-host@1', 'r5b-iw-scripted-query'),
        budget: runtimeBudget, tools: ['read', 'project_source'], writeScope: [], skills,
        systemInstruction: queryInstruction,
        hostTemplate: { templateId: 'advisor', revision: '1', digest: sha256Hex(queryInstruction) },
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

async function bootstrap(platform: Platform, state: HostState, directory: string) {
  const host = ctx();
  expect(await platform.projects.createProject(host, { meta: { requestId: 'r5b-iw-project',
    expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } })).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(host, { meta: { requestId: 'r5b-iw-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  expect(registered, 'the public Workspace registration must commit').toMatchObject({ status: 'committed' });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  state.revision = registered.value.revision;
  expect(await platform.goals.createGoal(host, { meta: { requestId: 'r5b-iw-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Deliver the answer-derived initial plan' } }))
    .toMatchObject({ status: 'committed' });
  void directory;
}

async function completeGovernance(platform: Platform, state: HostState) {
  const host = ctx();
  const installed = await platform.completionPolicies.installCompletionPolicy(host, { meta: { requestId: 'r5b-iw-policy',
    expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
    input: { policyId: 'r5b-iw-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  expect(installed, 'the CompletionPolicy must install').toMatchObject({ status: 'committed' });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'r5b-iw-policy-active',
    expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'r5b-iw-baseline',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { baselineId: 'r5b-iw-baseline', description: 'The R5b initial planning module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: 'r5b-iw' }, name: 'R5b initial planning',
        responsibility: 'Consume a formal answer and hand off to advancement', paths: ['src/business/workflow'], interfaces: [] }] } } }))
    .toMatchObject({ status: 'committed' });
}

async function answerInitialQuery(platform: Platform) {
  expect(await platform.queries.submitQueryJob(ctx(), { meta: { requestId: 'r5b-iw-submit',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }, { ref: goalRef, revision: 1 },
      { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] },
    input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent: initialCoordinationIntent() } }))
    .toMatchObject({ status: 'committed' });
  const created = await platform.runtime.createSession(ctx(), {
    workspace: scope, role: querySessionRole, recommendedRefs: [], initialLinks: [],
    meta: { requestId: 'r5b-iw-session', expected: [] },
  });
  expect(created).toMatchObject({ status: 'completed' });
  if (created.status !== 'completed') throw new Error('Query Session creation did not complete');
  const sessionRef = created.value.ref;
  const claim = await platform.queries.claimQuery(ctx(), { meta: { requestId: 'r5b-iw-claim', expected: [
    { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 }, { ref: sessionRef, revision: created.value.revision }] },
    input: { queryRunRef, sessionRef } });
  expect(claim).toMatchObject({ status: 'committed' });
  if (claim.status !== 'committed') throw new Error('Query claim did not commit: ' + JSON.stringify(claim));
  const prepared = await platform.runtime.prepareQuery(ctx(), { queryRunRef, requestId: 'r5b-iw-prepare' });
  expect(prepared).toMatchObject({ status: 'ready' });
  if (prepared.status !== 'ready') throw new Error('Query preparation did not become ready');
  const started = await platform.runtime.startQuery(ctx(), { prepared: prepared.value, consumerId: 'r5b-iw-consumer', requestId: 'r5b-iw-start' });
  expect(started).toMatchObject({ status: 'ready' });
  if (started.status !== 'ready') throw new Error('Query start did not become ready');
  const answerRef = started.value.answer?.ref as QueryJobAnswerRef | undefined;
  if (answerRef === undefined) throw new Error('the initial_coordination QueryRun did not record an answer');
  return answerRef;
}

type Advanced = { state: string; receipts: WorkflowStepReceipt[]; operations: WorkflowOperation[] };
/** The Host drives every returned `next`; it never invents a domain result. */
async function drive(platform: Platform, first: WorkflowAdvanceInput): Promise<Advanced> {
  const receipts: WorkflowStepReceipt[] = [];
  const operations: WorkflowOperation[] = [];
  let input = first;
  for (let guard = 0; guard < 64; guard += 1) {
    if (input.kind === 'perform') operations.push(input.operation);
    const result = await platform.workflow.advanceWork(ctx(), input);
    expect(result, 'every Workflow call must return a structured result').toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    if (result.value.receipt !== null) receipts.push(result.value.receipt);
    if (result.value.state === 'completed') return { state: 'completed', receipts, operations };
    if (result.value.next === null) return { state: result.value.state, receipts, operations };
    input = result.value.next;
  }
  throw new Error('the Workflow did not settle within the step guard');
}

it('consumes the answer, adopts the candidate, then advances to a formal Goal completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-r5b-iw-'));
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-r5b-iw-source-'));
  directories.push(directory, workspaceRoot);
  await mkdir(join(workspaceRoot, 'src'), { recursive: true });
  await writeFile(join(workspaceRoot, 'src', 'module.ts'), 'export const r5bIwMarker = "R5B_IW_REAL_SOURCE";\n');
  const state: HostState = { revision: 1, readAllowed: true };
  const scripted = createScriptedModel([
    { kind: 'calls', calls: [{ callId: 'r5b-iw-source-1', name: 'project_source', args: { action: 'read', path: 'src/module.ts', maxBytes: 8192, version: { kind: 'working_tree' } } }] },
    { kind: 'text', text: PLAN_ANSWER_TEXT },
    { kind: 'text', text: 'R5b IW first work result' },
    { kind: 'text', text: 'R5b IW second work result' },
  ]);
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'r5b-iw-checks-1', workspace: workspaceRef, executor: hostActor, permissionRevision: 'r5b-iw-host-grant-1',
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 'r5b-iw-echo', kind: 'static', command: 'echo R5B_IW_CHECK_OK', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'r5b-iw-consumer',
    bindings: [{ workspace: scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: workRoleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: workspaceBindings(workspaceRoot, state), now: () => AT,
    sourcePolicyFor: async (requestedProjectId: string, requestedWorkspaceId: string) =>
      requestedProjectId === projectId && requestedWorkspaceId === workspaceId && state.revision !== 0
        ? { root: workspaceRoot, permissionRevision: 'r5b-iw-host-grant-1', allowsRead: () => true } : null,
    kernelStores: { entries: [{ adapterId: 'r5b-iw-kernel', storeKey: 'r5b-iw-kernel-store',
      workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: runtimeHost(scripted), checks, workflow,
  });
  try {
    await bootstrap(platform, state, directory);
    const answerRef = await answerInitialQuery(platform);

    // 1. planning_answer delegates to the one Plan owner. Stage one is
    // explicitly unsupported, so this is the FIRST RED; the adoption and the
    // whole execution/check/completion tail below are unreached.
    const planningInput: InitialPlanningGoalInput = {
      schemaVersion: 1, goalRef, flowId: 'r5b-iw-flow', sessionHint: null, executeWithinRequest: true,
      kind: 'planning_answer',
      request: { meta: { requestId: 'r5b-iw-planning-answer', expected: [] },
        input: { answerRef, reason: { text: 'Initial plan from the real coordination answer', sources: [] } } },
    };
    const planned = await platform.workflow.handleGoalInput(ctx(), planningInput);
    expect(planned).toMatchObject({ status: 'ready', value: {
      state: 'proposed', next: { kind: 'goal_input', input: { kind: 'adopt_initial_plan' } } } });
    if (planned.status !== 'ready') throw new Error(`planning_answer was not ready: ${JSON.stringify(planned)}`);
    if (planned.value.receipt.status !== 'committed') {
      throw new Error(`the initial candidate did not commit: ${JSON.stringify(planned.value.receipt)}`);
    }
    const candidate = planned.value.receipt.value as PlanProposal;
    expect(candidate).toMatchObject({ kind: 'candidate_v2', goalRef });

    // 2. The continuation adopts the REAL proposal ref/revision. Every call must
    // reach exactly one owner and keep the fixed flow identity.
    const adoptStep = planned.value.next;
    if (adoptStep === null || adoptStep.kind !== 'goal_input') throw new Error('no adopt continuation was returned');
    expect(adoptStep.input).toMatchObject({ schemaVersion: 1, goalRef, flowId: 'r5b-iw-flow',
      executeWithinRequest: true, kind: 'adopt_initial_plan', request: {
        input: { proposalRef: candidate.ref, expectedProposalRevision: candidate.revision },
        meta: { requestId: expect.stringMatching(/^wf:[0-9a-f]{64}$/) } } });
    await completeGovernance(platform, state);
    const adopted = await platform.workflow.handleGoalInput(ctx(), adoptStep.input);
    expect(adopted).toMatchObject({ status: 'ready', value: { state: 'advance', next: { kind: 'work' } } });
    if (adopted.status !== 'ready' || adopted.value.next === null || adopted.value.next.kind !== 'work') {
      throw new Error(`adoption did not hand off to the Workflow: ${JSON.stringify(adopted)}`);
    }

    // 3. The existing advanceWork loop runs the two real works through the
    // registered check and the independent gate until the formal GoalPhase.
    const advanced = await drive(platform, adopted.value.next.input);
    expect(advanced.state, 'the adopted Plan must reach a formal Goal completion').toBe('completed');
    const graph = await platform.plans.queryTaskGraph(ctx(), { goalRef });
    expect(graph, 'the graph reads back after the Goal completion').toMatchObject({
      status: 'ready',
      value: {
        completion: { status: 'recorded', snapshot: { phase: 'COMPLETED' }, selectedPlanMatches: true },
        tasks: expect.arrayContaining([
          expect.objectContaining({ ref: expect.objectContaining({ taskId: 'work-1' }), effectivePhase: 'satisfied' }),
          expect.objectContaining({ ref: expect.objectContaining({ taskId: 'work-2' }), effectivePhase: 'satisfied' }),
          expect.objectContaining({ ref: expect.objectContaining({ taskId: 'goal-gate' }), effectivePhase: 'satisfied' }),
          expect.objectContaining({ ref: expect.objectContaining({ taskId: 'future-intent' }),
            definition: expect.objectContaining({ executionIntent: 'plan_only' }) }),
        ]),
      },
    });
    const sessions = new Set<string>();
    const claimedTasks: string[] = [];
    let startedWorkRuns = 0;
    for (const receipt of advanced.receipts) {
      if (receipt.kind === 'claim_task' && receipt.result.status === 'committed') {
        sessions.add(receipt.result.value.sessionRef.sessionId);
        claimedTasks.push(receipt.result.value.task.taskId);
      }
      if (receipt.kind === 'start') startedWorkRuns += 1;
    }
    expect(claimedTasks.sort(), 'only the two ordinary works are claimed; the gate is never claimed')
      .toEqual(['work-1', 'work-2']);
    expect(startedWorkRuns, 'the gate gets no fabricated Run').toBe(2);
    expect(advanced.operations.filter(operation => operation.kind === 'complete_task')).toHaveLength(3);
    expect(advanced.operations.filter(operation => operation.kind === 'complete_goal')).toHaveLength(1);
    expect(sessions.size, 'the two works must reuse one Session').toBe(1);
    const [sessionId] = [...sessions];
    const sessionRef: SessionRef = { projectId, sessionId: sessionId as string };
    const history = await platform.runtime.readSessionHistory(ctx(), { sessionRef, afterCursor: null, throughCursor: null, limit: 50 });
    expect(history, 'the original Work Session history is readable').toMatchObject({ status: 'ready' });
    if (history.status === 'ready') {
      const turns = history.value.items.filter(item => item.kind === 'turn_started');
      expect(turns.length, 'the reused Session must show a real new turn for the second work').toBeGreaterThanOrEqual(2);
    }
    expect(scripted.calls(), 'two Query calls and exactly the two ordinary Work calls').toBe(4);
  } finally { await platform.close(); }
});
