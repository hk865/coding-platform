/**
 * R5c.1 Workflow advancement composition-root final-behaviour test.
 *
 * The whole normal path is produced by public ports on a real SQLite ledger:
 * Project/Workspace registration, CompletionPolicy install/activation, initial
 * architecture adoption, Goal creation and a v2 Plan adoption. A controlled
 * ModelClient (real frozen Kernel, real ProcessSandbox) drives two ordinary
 * work tasks and the independent Goal gate; the Host drives every `next`
 * request the Workflow returns and never fakes a domain result.
 *
 * These are FINAL behaviour assertions: stage one wires the trusted
 * configuration and dependencies but `advanceWork` is explicitly `unsupported`,
 * so the run stops at its first Workflow call and the whole two-work / Session
 * continuation / check / completion tail is NOT reached by the skeleton. The
 * optional future node stays on the graph; the second work must continue the
 * first Session with a real new turn; the Goal is only completed from the
 * formal GoalPhase writer.
 *
 * Specification: docs/refactor/tasks/R5-workflow-advancement-skeleton.md §3/§4/§5.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PlanRevisionDraft, RuntimeTask } from '../../src/contracts/plan.js';
import type { TrustedCheckConfiguration, VerificationRoundRef } from '../../src/contracts/verification.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { WorkflowAdvanceInput, WorkflowOperation, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';

const AT = '2026-09-26T00:00:00.000Z';
const projectId = 'r5c-platform-project';
const workspaceId = 'r5c-platform-workspace';
const scope = { projectId, workspaceId };
const hostActor = { kind: 'human' as const, id: 'r5c-platform-host' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'r5c-platform-goal' };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'r5c-policy', revision: 1 };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'r5c-platform-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const runtimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

function ctx(): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor: hostActor },
    materialReader: { kind: 'host', projectId, workspaceId, actor: hostActor }, signal: new AbortController().signal };
}

type HostState = { revision: number; readAllowed: boolean };
/** Controlled Runtime Host switch. It only lets the trusted resolver reject so a
 * test can build the real unadmitted pre-state; it never edits a record. */
type RuntimeState = { rejectConfiguration: boolean };
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
        ? { status: 'ready', value: { subjectKey: 'r5c-host', permissionRevision: 'r5c-host-grant-1', allowsRead: () => true } }
        : { status: 'rejected', code: 'forbidden', reason: 'the Host revoked this workspace read' };
    },
  };
}

function runtimeHost(
  scripted: ReturnType<typeof createScriptedModel>,
  state: RuntimeState = { rejectConfiguration: false },
): RuntimeHostBindings {
  return {
    async resolveConfiguration(context, request) {
      if (state.rejectConfiguration) {
        return { status: 'rejected', code: 'forbidden', reason: 'the registered grant carries an unsupported project_source' };
      }
      if (context.projectId !== projectId || context.workspaceId !== workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the runtime Host is not bound to this workspace' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'the current Role binding is inadmissible' };
      }
      return { status: 'ready', value: {
        configurationRevision: 'r5c-host-config@1',
        model: { configuration: { revision: 'r5c-host-config@1', provider: 'deepseek', model: 'r5c-local-scripted', baseUrl: 'http://127.0.0.1' },
          client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'r5c-fixture-counter' }) } },
        budget: runtimeBudget,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex('R5c trusted static role guidance') } : null,
        tools: ['read'], writeScope: [], skills: { resourceRoot: fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url)), enabledIds: [] },
        systemInstruction: 'R5c trusted static role guidance', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

/** Gate topology under test. Every adopted Plan needs a Goal gate; the stage
 * variant inserts a required stage gate before it. */
type GatePlan = 'goal-only' | 'stage-then-goal';

/** One plan_only optional future node (W2 contract) that must survive to the end. */
function planDraft(gatePlan: GatePlan): PlanRevisionDraft {
  const stageGates: RuntimeTask[] = gatePlan === 'stage-then-goal'
    ? [{ taskId: 'stage-gate', stageId: 'stage-1', title: 'Stage gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'stage-1' } }]
    : [];
  return {
    schemaVersion: 2, planId: 'r5c-platform-plan', planRevision: 1, goalId: goalRef.goalId,
    stages: gatePlan === 'stage-then-goal' ? [{ stageId: 'stage-1', title: 'Stage one' }] : [],
    tasks: [
      { taskId: 'work-1', title: 'First ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'work-2', title: 'Second ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      ...stageGates,
      { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'future-intent', title: 'Optional future investigation', requirementLevel: 'optional', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' },
    ],
    assignments: [
      { taskId: 'work-1', role: 'builder', instruction: 'Do the first ordinary work' },
      { taskId: 'work-2', role: 'builder', instruction: 'Do the second ordinary work' },
    ],
    obligations: [{ obligationId: 'r5c-obligation', title: 'Deliver the R5c work', requirementLevel: 'required',
      taskIds: ['work-1', 'work-2', ...stageGates.map(task => task.taskId), 'goal-gate'],
      verificationRequirements: [{ requirementId: 'r5c-static', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

async function bootstrap(platform: Platform, state: HostState, gatePlan: GatePlan) {
  const host = ctx();
  expect(await platform.projects.createProject(host, { meta: { requestId: 'r5c-project',
    expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } })).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(host, { meta: { requestId: 'r5c-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  expect(registered, 'the public Workspace registration must commit').toMatchObject({ status: 'committed' });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  state.revision = registered.value.revision;
  const installed = await platform.completionPolicies.installCompletionPolicy(host, { meta: { requestId: 'r5c-policy',
    expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
    input: { policyId: 'r5c-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  expect(installed, 'the CompletionPolicy must install').toMatchObject({ status: 'committed' });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'r5c-policy-active',
    expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'r5c-baseline',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { baselineId: 'r5c-baseline', description: 'The R5c adoption-first module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: 'r5c-workflow' }, name: 'R5c workflow',
        responsibility: 'Advance an adopted Plan', paths: ['src/business/workflow'], interfaces: [] }] } } }))
    .toMatchObject({ status: 'committed' });
  expect(await platform.goals.createGoal(host, { meta: { requestId: 'r5c-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Deliver the R5c adoption-first advancement closure' } }))
    .toMatchObject({ status: 'committed' });
  const proposed = await platform.plans.proposePlan(host, { meta: { requestId: 'r5c-plan-propose', expected: [] },
    input: { goalRef, basedOn: null, draft: planDraft(gatePlan), reason: { text: 'Initial R5c advancement plan', sources: [] } } });
  expect(proposed, 'the Plan must propose').toMatchObject({ status: 'committed' });
  if (proposed.status !== 'committed') throw new Error('Plan proposal failed');
  const applied = await platform.plans.applyPlanChange(host, { meta: { requestId: 'r5c-plan-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  expect(applied, 'the Plan must be adopted').toMatchObject({ status: 'committed' });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');
}

type Advanced = { state: string; reason: string | null; receipts: WorkflowStepReceipt[]; operations: WorkflowOperation[] };
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
    if (result.value.state === 'completed') return { state: 'completed', reason: result.value.reason, receipts, operations };
    if (result.value.next === null) return { state: result.value.state, reason: result.value.reason, receipts, operations };
    input = result.value.next;
  }
  throw new Error('the Workflow did not settle within the step guard');
}

const gatePlans = [
  { name: 'the Goal gate', gatePlan: 'goal-only' as const, satisfiedGates: ['goal-gate'], completeTasks: 3 },
  { name: 'a stage gate then the Goal gate', gatePlan: 'stage-then-goal' as const,
    satisfiedGates: ['stage-gate', 'goal-gate'], completeTasks: 4 },
];

it.each(gatePlans)('advances two works and $name through public ports, reusing the Session and completing the Goal', async ({ gatePlan, satisfiedGates, completeTasks }) => {
  const directory = await mkdtemp(join(tmpdir(), 'next-r5c-platform-'));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-r5c-source-'));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), 'R5c registered workspace source\n');
  const state: HostState = { revision: 1, readAllowed: true };
  const scripted = createScriptedModel([
    { kind: 'text', text: 'R5c first work result' },
    { kind: 'text', text: 'R5c second work result' },
  ]);
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'r5c-checks-1', workspace: workspaceRef, executor: hostActor, permissionRevision: 'r5c-host-grant-1',
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 'r5c-echo', kind: 'static', command: 'echo R5C_CHECK_OK', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'r5c-platform-consumer',
    bindings: [{ workspace: scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: workspaceBindings(workspaceRoot, state), now: () => AT,
    kernelStores: { entries: [{ adapterId: 'r5c-kernel', storeKey: 'r5c-kernel-store',
      workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: runtimeHost(scripted), checks, workflow,
  });
  try {
    await bootstrap(platform, state, gatePlan);
    const advanced = await drive(platform, {
      schemaVersion: 1, goalRef, flowId: 'r5c-platform-flow', sessionHint: null, kind: 'select_work',
    });
    expect(advanced.state, `the adopted Plan must reach a formal Goal completion (settled: ${advanced.reason ?? 'n/a'})`).toBe('completed');

    const graph = await platform.plans.queryTaskGraph(ctx(), { goalRef });
    expect(graph, 'the graph reads back after the Goal completion').toMatchObject({
      status: 'ready',
      value: {
        completion: { status: 'recorded', snapshot: { phase: 'COMPLETED' }, selectedPlanMatches: true },
        tasks: expect.arrayContaining([
          expect.objectContaining({ ref: expect.objectContaining({ taskId: 'work-1' }), effectivePhase: 'satisfied' }),
          expect.objectContaining({ ref: expect.objectContaining({ taskId: 'work-2' }), effectivePhase: 'satisfied' }),
          ...satisfiedGates.map(taskId =>
            expect.objectContaining({ ref: expect.objectContaining({ taskId }), effectivePhase: 'satisfied' })),
          expect.objectContaining({ ref: expect.objectContaining({ taskId: 'future-intent' }),
            definition: expect.objectContaining({ executionIntent: 'plan_only' }) }),
        ]),
      },
    });

    // Both ordinary works must run on the same Session; the second work's real
    // turn must be locatable in the original Kernel history.
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
    expect(advanced.operations.filter(operation => operation.kind === 'complete_task')).toHaveLength(completeTasks);
    expect(advanced.operations.filter(operation => operation.kind === 'complete_goal')).toHaveLength(1);
    expect(sessions.size, 'the two works must reuse one Session').toBe(1);
    const [sessionId] = [...sessions];
    const sessionRef: SessionRef = { projectId, sessionId: sessionId as string };
    const history = await platform.runtime.readSessionHistory(ctx(), { sessionRef, afterCursor: null, throughCursor: null, limit: 50 });
    expect(history, 'the original Session history is readable').toMatchObject({ status: 'ready' });
    if (history.status === 'ready') {
      const turns = history.value.items.filter(item => item.kind === 'turn_started');
      expect(turns.length, 'the reused Session must show a real new turn for the second work').toBeGreaterThanOrEqual(2);
    }
    expect(scripted.calls(), 'exactly the two ordinary works call the model; the gate has no Run').toBe(2);
  } finally { await platform.close(); }
});

/**
 * Stage-one bounded recovery case.
 *
 * A REAL public claim whose FIRST prepare is rejected by the controlled Host
 * resolver stays an unadmitted `starting` Run (no envelope, input binding, entry
 * authorization or runtime fact). After the Host configuration is restored, an
 * ORDINARY `select_work` must resume the SAME Run's prepare, keeping the
 * Task/Attempt/Session/Lease and creating no second claim or Session. Once the
 * formal prepare + entry actually authorizes the Run, a later `select_work` must
 * never prepare it again. The pre-state is produced only by public ports; no
 * record is edited.
 */
it('resumes the original Run prepare after the Host configuration is restored', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-r5c-platform-'));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-r5c-source-'));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), 'R5c registered workspace source\n');
  const state: HostState = { revision: 1, readAllowed: true };
  const runtimeState: RuntimeState = { rejectConfiguration: false };
  const scripted = createScriptedModel([{ kind: 'text', text: 'R5c recovered work result' }]);
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'r5c-checks-1', workspace: workspaceRef, executor: hostActor, permissionRevision: 'r5c-host-grant-1',
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 'r5c-echo', kind: 'static', command: 'echo R5C_CHECK_OK', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'r5c-platform-consumer',
    bindings: [{ workspace: scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: workspaceBindings(workspaceRoot, state), now: () => AT,
    kernelStores: { entries: [{ adapterId: 'r5c-kernel', storeKey: 'r5c-kernel-store',
      workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: runtimeHost(scripted, runtimeState), checks, workflow,
  });
  try {
    await bootstrap(platform, state, 'goal-only');
    const flowId = 'r5c-unprepared-flow';
    const select: WorkflowAdvanceInput = { schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work' };

    // 1. A real public claim through the ordinary select_work loop.
    let input: WorkflowAdvanceInput = select;
    let claim: TaskClaim | null = null;
    let prepareInput: WorkflowAdvanceInput | null = null;
    for (let guard = 0; guard < 16 && prepareInput === null; guard += 1) {
      const result = await platform.workflow.advanceWork(ctx(), input);
      expect(result, 'every Workflow call must return a structured result').toMatchObject({ status: 'ready' });
      if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
      if (result.value.receipt !== null && result.value.receipt.kind === 'claim_task'
        && result.value.receipt.result.status === 'committed') {
        claim = result.value.receipt.result.value;
      }
      if (result.value.next === null) throw new Error(`the Workflow stopped before the claim prepare: ${result.value.reason ?? 'n/a'}`);
      input = result.value.next;
      if (input.kind === 'perform' && input.operation.kind === 'prepare') prepareInput = input;
    }
    if (claim === null || prepareInput === null) throw new Error('the real claim did not produce the original prepare');
    const { runRef, attemptRef, sessionRef } = claim;

    // 2. The controlled Host resolver rejects the prepare. The Run remains the
    //    SAME unadmitted starting claim: no envelope, binding, authorization,
    //    entry or runtime fact was fabricated.
    runtimeState.rejectConfiguration = true;
    const rejected = await platform.workflow.advanceWork(ctx(), prepareInput);
    expect(rejected, 'the rejected prepare keeps the real rejection as a waiting receipt').toMatchObject({
      status: 'ready',
      value: { state: 'waiting', next: null, receipt: { kind: 'prepare', result: { status: 'rejected', code: 'forbidden' } } },
    });
    const before = await platform.executions.readExecution(ctx(), runRef);
    if (before.status !== 'ready') throw new Error(`the unadmitted execution is not readable: ${JSON.stringify(before)}`);
    expect(before.value.run, 'the Run is still the unadmitted starting claim').toMatchObject({
      ref: runRef, status: 'starting', outcome: null, envelope: null });
    expect(before.value.run.executionAuthorization).toBeUndefined();
    expect(before.value.run.inputBinding).toBeUndefined();
    expect(before.value.attempt).toMatchObject({ ref: attemptRef, status: 'claimed', revision: 1 });
    expect(before.value.session.ref).toMatchObject(sessionRef);
    expect(before.value.lease, 'the claim hold is the one real Lease').toMatchObject({
      holderRunId: runRef.runId, attemptId: attemptRef.attemptId, revision: 1 });
    const sessionRevision = before.value.session.revision;
    const leaseRevision = before.value.lease?.revision;

    // 3. Restore the Host configuration; an ordinary select_work resumes the
    //    SAME Run's original prepare. No claim/Session/Run/Lease is recreated.
    runtimeState.rejectConfiguration = false;
    const resumed = await platform.workflow.advanceWork(ctx(), select);
    expect(resumed, 'the restored select_work resumes the original Run prepare').toMatchObject({
      status: 'ready',
      value: { state: 'advance', receipt: null, reason: null,
        next: { schemaVersion: 1, goalRef, flowId, kind: 'perform',
          operation: { kind: 'prepare', request: { runRef } } } },
    });
    if (resumed.status !== 'ready' || resumed.value.next === null
      || resumed.value.next.kind !== 'perform' || resumed.value.next.operation.kind !== 'prepare') {
      throw new Error(`the unprepared Run did not resume: ${JSON.stringify(resumed)}`);
    }
    const afterResume = await platform.executions.readExecution(ctx(), runRef);
    if (afterResume.status !== 'ready') throw new Error('the resumed execution is not readable');
    expect(afterResume.value.attempt, 'the same TaskAttempt is kept').toMatchObject({ ref: attemptRef, revision: 1 });
    expect(afterResume.value.session.ref).toMatchObject(sessionRef);
    expect(afterResume.value.session.revision, 'the Session is not advanced by a new claim').toBe(sessionRevision);
    expect(afterResume.value.lease, 'the same Lease hold is kept, never re-granted').toMatchObject({
      holderRunId: runRef.runId, attemptId: attemptRef.attemptId, revision: leaseRevision });
    const graph = await platform.plans.queryTaskGraph(ctx(), { goalRef });
    if (graph.status !== 'ready') throw new Error('the task graph is not readable after the resume');
    const workRow = graph.value.tasks.find(row => row.ref.taskId === 'work-1');
    expect(workRow?.execution, 'the resumed prepare names the one existing Run').toEqual(runRef);
    expect(workRow?.currentAttempt, 'the resumed prepare keeps the one existing Attempt').toEqual(attemptRef);
    expect(scripted.calls(), 'no provider call happens before the formal entry').toBe(0);

    // 4. Boundary: the formal prepare + entry actually authorizes the Run, so a
    //    later ordinary select_work must not prepare it again.
    const prepared = await platform.workflow.advanceWork(ctx(), resumed.value.next);
    expect(prepared, 'the recovered prepare advances to the formal start').toMatchObject({
      status: 'ready', value: { state: 'advance',
        receipt: { kind: 'prepare', result: { status: 'ready' } },
        next: { kind: 'perform', operation: { kind: 'start' } } },
    });
    if (prepared.status !== 'ready' || prepared.value.next === null) throw new Error('the recovered prepare did not reach start');
    const started = await platform.workflow.advanceWork(ctx(), prepared.value.next);
    expect(started, 'the formal entry runs the same Run').toMatchObject({
      status: 'ready', value: { receipt: { kind: 'start', result: { status: 'ready' } } } });
    const entered = await platform.executions.readExecution(ctx(), runRef);
    if (entered.status !== 'ready') throw new Error('the entered execution is not readable');
    expect(entered.value.run.executionAuthorization, 'the formal entry authorized the Run').toBeDefined();
    expect(scripted.calls(), 'the formal entry made exactly one real provider call').toBe(1);
    const afterEntry = await platform.workflow.advanceWork(ctx(), select);
    expect(afterEntry, 'an already authorized/entered Run is never prepared again').toMatchObject({ status: 'ready' });
    if (afterEntry.status === 'ready') {
      const next = afterEntry.value.next;
      expect(next === null || next.kind !== 'perform' || next.operation.kind !== 'prepare',
        `an authorized Run must not return prepare: ${JSON.stringify(next)}`).toBe(true);
    }
  } finally { await platform.close(); }
});

/**
 * Resumes the ORIGINAL verification round of a completed Work Run across a
 * different flow, for every terminal shape of that round.
 *
 * A real public Work Run completes and the ordinary `select_work` chain opens a
 * real formal round whose registered check entry is refused at the controlled
 * Host authorization switch BEFORE any `beginCheck`. No record is edited and no
 * observation/report/verdict is fabricated. The same SQLite ledger is closed and
 * reopened and the existing ref lookup still finds the original round. A new
 * flow's `select_work` must then route to the SAME original round's pending
 * check (`run_check`), never open a second round or claim another Work, and make
 * zero additional model calls.
 *
 * The same case then covers both terminal refresh paths:
 *  - the original round finalizes PASS, so a later refresh returns the existing
 *    `complete_task` for that same round without re-running any check or model;
 *  - a second Work's original round finalizes non-PASS (a real registered FAIL),
 *    so a later refresh waits instead of opening a replacement round.
 */
type RunCheckPerform = Extract<WorkflowAdvanceInput, { kind: 'perform' }> & {
  operation: Extract<WorkflowOperation, { kind: 'run_check' }>;
};

/** Drive one `select_work` chain until it returns the pending registered check. */
async function driveToRunCheck(platform: Platform, first: WorkflowAdvanceInput) {
  let input = first;
  for (let guard = 0; guard < 32; guard += 1) {
    const result = await platform.workflow.advanceWork(ctx(), input);
    expect(result, 'every Workflow call must return a structured result').toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    const next = result.value.next;
    if (next !== null && next.kind === 'perform' && next.operation.kind === 'run_check') {
      const runCheck = next as RunCheckPerform;
      return { runCheck, roundRef: runCheck.operation.request.input.roundRef };
    }
    if (next === null) throw new Error(`the Workflow stopped before run_check: ${result.value.reason ?? 'n/a'}`);
    input = next;
  }
  throw new Error('the Workflow never returned a pending registered check');
}

it('resumes the original verification round for a completed Work Run across a different flow', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-r5c-platform-'));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-r5c-source-'));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), 'R5c registered workspace source\n');
  const state: HostState = { revision: 1, readAllowed: true };
  const scripted = createScriptedModel([
    { kind: 'text', text: 'R5c completed work result' },
    { kind: 'text', text: 'R5c second work result' },
  ]);
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'r5c-checks-1', workspace: workspaceRef, executor: hostActor, permissionRevision: 'r5c-host-grant-1',
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 'r5c-echo', kind: 'static', command: 'echo R5C_CHECK_OK', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const failChecks: TrustedCheckConfiguration = {
    ...checks, configurationRevision: 'r5c-checks-1-fail',
    checks: [{ checkId: 'r5c-echo', kind: 'static', command: 'exit 1', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'r5c-platform-consumer',
    bindings: [{ workspace: scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const options = {
    storage: { kind: 'sqlite' as const, directory },
    workspace: workspaceBindings(workspaceRoot, state), now: () => AT,
    kernelStores: { entries: [{ adapterId: 'r5c-kernel', storeKey: 'r5c-kernel-store',
      workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: runtimeHost(scripted), checks, workflow,
  };
  let platform = await createTargetPlatform(options);
  try {
    await bootstrap(platform, state, 'goal-only');
    expect(typeof platform.evidence.queryOriginalVerification,
      'the original-round read seam is published by composition').toBe('function');

    // 1. A real public Work Run completes and its ordinary open_checks opens a
    //    pending registered round; stop before the check entry.
    const first = await driveToRunCheck(platform, { schemaVersion: 1, goalRef,
      flowId: 'r5c-check-resume-flow', sessionHint: null, kind: 'select_work' });
    const { runCheck, roundRef } = first;
    expect(scripted.calls(), 'exactly one model call produced the first Work Run').toBe(1);

    // 2. The controlled Host read switch is revoked. The registered check entry
    //    is refused BEFORE beginCheck: the round stays open with its check
    //    pending and no observation/report/verdict is fabricated.
    state.readAllowed = false;
    const rejected = await platform.workflow.advanceWork(ctx(), runCheck);
    expect(rejected, 'the revoked Host refuses the check entry before begin').toMatchObject({
      status: 'ready',
      value: { state: 'waiting', next: null,
        receipt: { kind: 'run_check', result: { status: 'rejected', code: 'forbidden' } } },
    });
    const open = await platform.evidence.readVerification(ctx(), roundRef);
    expect(open, 'the original round stays open with its check pending').toMatchObject({
      status: 'ready',
      value: { ref: roundRef, status: 'open', outcome: null,
        checks: [expect.objectContaining({ checkId: 'r5c-echo', phase: 'pending',
          invocationId: null, outcome: null, reportRef: null })] },
    });
    if (open.status !== 'ready') throw new Error('the original round is not readable');
    const ended = await platform.executions.readExecution(ctx(), open.value.subjectRunRef);
    expect(ended, 'the subject Work Run is formally ended/completed').toMatchObject({
      status: 'ready', value: { run: { status: 'ended', outcome: 'completed' } } });
    expect(scripted.calls(), 'the refused check entry never calls the model').toBe(1);

    // 3. Restore the controlled Host; the SAME SQLite ledger is closed and
    //    reopened. The existing ref lookup still finds the original round (no
    //    backfill table and no empty-list fake).
    state.readAllowed = true;
    await platform.close();
    platform = await createTargetPlatform(options);
    const reopened = await platform.evidence.readVerification(ctx(), roundRef);
    expect(reopened, 'the original round survives the SQLite reopen').toMatchObject({
      status: 'ready', value: { ref: roundRef, status: 'open' } });
    if (reopened.status !== 'ready') throw new Error('the reopened round is not readable');
    expect(reopened.value.checks.every(check => check.phase === 'pending'),
      'the reopened round still has every check pending').toBe(true);

    // 4. A DIFFERENT flow resumes the SAME original pending check through the
    //    original-round lookup; no second round, no other Work, no model call.
    const resumed = await platform.workflow.advanceWork(ctx(), { schemaVersion: 1, goalRef,
      flowId: 'r5c-check-resume-flow-2', sessionHint: null, kind: 'select_work' });
    expect(scripted.calls(), 'resuming the original round adds no model call').toBe(1);
    expect(resumed, 'a different flow resumes the original pending check, not another Work').toMatchObject({
      status: 'ready',
      value: { state: 'advance', next: { kind: 'perform',
        operation: { kind: 'run_check', request: { input: { roundRef } } } } },
    });
    if (resumed.status !== 'ready' || resumed.value.next === null
      || resumed.value.next.kind !== 'perform' || resumed.value.next.operation.kind !== 'run_check') {
      throw new Error('the selection did not resume the original run_check');
    }

    // 5. The real registered check runs and the original round finalizes PASS.
    const ran = await platform.workflow.advanceWork(ctx(), resumed.value.next);
    expect(ran, 'the original check runs to a persisted finished window').toMatchObject({
      status: 'ready', value: { receipt: { kind: 'run_check', result: { status: 'ready' } } } });
    if (ran.status !== 'ready' || ran.value.next === null || ran.value.next.kind !== 'perform'
      || ran.value.next.operation.kind !== 'finalize_checks') {
      throw new Error('the finished check did not advance to finalize_checks');
    }
    const finalized = await platform.workflow.advanceWork(ctx(), ran.value.next);
    expect(finalized, 'the original round finalizes PASS through the real checks').toMatchObject({
      status: 'ready', value: { receipt: { kind: 'finalize_checks',
        result: { status: 'committed', value: { applicable: true, outcome: 'PASS' } } } } });

    // 6. A refresh BEFORE complete_task must return the existing complete_task
    //    for the SAME finalized PASS round, without re-running check or model.
    const afterPass = await platform.workflow.advanceWork(ctx(), { schemaVersion: 1, goalRef,
      flowId: 'r5c-check-resume-flow-3', sessionHint: null, kind: 'select_work' });
    expect(scripted.calls(), 'a finalized PASS refresh adds no model call').toBe(1);
    expect(afterPass, 'a finalized PASS round completes the Task without re-verifying').toMatchObject({
      status: 'ready', value: { state: 'advance', next: { kind: 'perform',
        operation: { kind: 'complete_task', request: { input: { taskRef: { taskId: 'work-1' }, roundRef } } } } },
    });

    // 7. A second Work is driven independently under a real FAILING registered
    //    check; its fresh original round finalizes non-PASS.
    platform.registerCheckConfiguration({ configuration: failChecks });
    const second = await driveToRunCheck(platform, { schemaVersion: 1, goalRef,
      flowId: 'r5c-check-resume-flow-4', sessionHint: null, taskId: 'work-2', kind: 'select_work' });
    expect(scripted.calls(), 'exactly two model calls produced the two Work Runs').toBe(2);
    expect(second.roundRef, 'the second Work opens its own original round').not.toEqual(roundRef);
    const ranSecond = await platform.workflow.advanceWork(ctx(), second.runCheck);
    expect(ranSecond, 'the failing check runs to a persisted finished window').toMatchObject({
      status: 'ready', value: { receipt: { kind: 'run_check', result: { status: 'ready' } } } });
    if (ranSecond.status !== 'ready' || ranSecond.value.next === null || ranSecond.value.next.kind !== 'perform'
      || ranSecond.value.next.operation.kind !== 'finalize_checks') {
      throw new Error('the failing check did not advance to finalize_checks');
    }
    const finalizedSecond = await platform.workflow.advanceWork(ctx(), ranSecond.value.next);
    expect(finalizedSecond, 'the real FAIL check finalizes the round non-PASS').toMatchObject({
      status: 'ready', value: { state: 'waiting', next: null,
        receipt: { kind: 'finalize_checks', result: { status: 'committed',
          value: { applicable: false, outcome: 'INCONCLUSIVE' } } } } });

    // 8. A refresh of the finalized non-PASS round must WAIT, never open a
    //    replacement round or re-run the failed check/model.
    const afterFail = await platform.workflow.advanceWork(ctx(), { schemaVersion: 1, goalRef,
      flowId: 'r5c-check-resume-flow-5', sessionHint: null, taskId: 'work-2', kind: 'select_work' });
    expect(afterFail, 'a finalized non-PASS round waits instead of opening a replacement').toMatchObject({
      status: 'ready', value: { state: 'waiting', next: null } });
    expect(scripted.calls(), 'a finalized non-PASS refresh adds no model call').toBe(2);
    const failRound = await platform.evidence.readVerification(ctx(), second.roundRef);
    expect(failRound, 'the one original non-PASS round is unchanged').toMatchObject({
      status: 'ready', value: { ref: second.roundRef, status: 'finalized', outcome: 'INCONCLUSIVE' } });
  } finally { await platform.close(); }
});
