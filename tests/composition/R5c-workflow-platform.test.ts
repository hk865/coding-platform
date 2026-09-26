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
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { WorkflowAdvanceInput, WorkflowOperation, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
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

function runtimeHost(scripted: ReturnType<typeof createScriptedModel>): RuntimeHostBindings {
  return {
    async resolveConfiguration(context, request) {
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

/** One plan_only optional future node (W2 contract) that must survive to the end. */
function planDraft(): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'r5c-platform-plan', planRevision: 1, goalId: goalRef.goalId, stages: [],
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
    obligations: [{ obligationId: 'r5c-obligation', title: 'Deliver the R5c work', requirementLevel: 'required',
      taskIds: ['work-1', 'work-2', 'goal-gate'],
      verificationRequirements: [{ requirementId: 'r5c-static', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

async function bootstrap(platform: Platform, state: HostState) {
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
    input: { goalRef, basedOn: null, draft: planDraft(), reason: { text: 'Initial R5c advancement plan', sources: [] } } });
  expect(proposed, 'the Plan must propose').toMatchObject({ status: 'committed' });
  if (proposed.status !== 'committed') throw new Error('Plan proposal failed');
  const applied = await platform.plans.applyPlanChange(host, { meta: { requestId: 'r5c-plan-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  expect(applied, 'the Plan must be adopted').toMatchObject({ status: 'committed' });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');
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

it('advances two works and the Goal gate through public ports, reusing the Session and completing the Goal', async () => {
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
    await bootstrap(platform, state);
    const advanced = await drive(platform, {
      schemaVersion: 1, goalRef, flowId: 'r5c-platform-flow', sessionHint: null, kind: 'select_work',
    });
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
    expect(advanced.operations.filter(operation => operation.kind === 'complete_task')).toHaveLength(3);
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
