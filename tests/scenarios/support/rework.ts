/**
 * Help code of the A.2 step 6 "rework" scenario group (docs/refactor/STATE-MACHINES-SPEC.md
 * §15.2 "第 6 步": A1-rework-same-session, C8-auto-rework-cap, C8-human-stop-respected,
 * C8-budget). Shared code stays in tests/scenarios/harness.ts and ./common.ts (the Workflow step
 * readers, the operator's requeue, the brief read, `PlanBoard` for C8 LA-3); this file adds:
 *
 * - readers over the Workflow steps (moved with tests/app/A2-automation-rework.test.ts test 1);
 * - an owner requeue as any caller, pinned to the Goal and the afterRun as they are now;
 * - the C8-budget environment moved from
 *   tests/composition/A2-auto-rework-budget-platform.test.ts (a runtime grant of
 *   one tool call per Run, which the shared harness does not offer), with the
 *   §11 invariant check after every Workflow step that returned a receipt.
 *
 * Scripted model replies only; no real model is called.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkflowAdvanceInput } from '../../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../../src/business/workflow/ports.js';
import { createTargetPlatform } from '../../../src/composition/create-platform.js';
import type { CoreCallContext } from '../../../src/contracts/core/call-context.js';
import type { WriteResult } from '../../../src/contracts/core/results.js';
import type { RunRef } from '../../../src/contracts/dispatch.js';
import { sha256Hex } from '../../../src/contracts/fingerprint.js';
import type { PlanRevisionDraft } from '../../../src/contracts/plan.js';
import { DEFAULT_TASK_AUTOMATION_POLICY, type TaskRequeueOutcomeV1 } from '../../../src/contracts/task-requeue.js';
import type { RoundSnapshot, TrustedCheckConfiguration } from '../../../src/contracts/verification.js';
import type { RuntimeHostBindings } from '../../../src/core/agent-runtime/execution-contracts.js';
import type { RequeueTaskInput } from '../../../src/core/work-graph/tasks/claim-contracts.js';
import type { WorkspaceHostBindings } from '../../../src/core/workspace/access.js';
import { createScriptedModel, type ScriptedModel } from '../../helpers/B2-runtime-fixture.js';
import { AG2B_GOAL_REF, AG2B_WORK_TASK_ID } from '../../helpers/AG2b-collaboration-fixture.js';
import { TASK, type AdvanceValue } from '../../helpers/A2-restart-fixture.js';
import {
  assertInvariantsAt, hostCtx, stepOfReceipt, type InvariantTarget, type Platform, type ScenarioBase,
} from '../harness.js';
import { receiptsOf } from './common.js';

// ---------------------------------------------------------------------------
// Workflow steps (moved with tests/app/A2-automation-rework.test.ts test 1)
// ---------------------------------------------------------------------------

/** The committed `requeued` TaskRequeue values of the `requeue_task` receipts, in order (refusals left out). */
export function requeuedOf(steps: readonly AdvanceValue[]): Array<Record<string, unknown>> {
  return receiptsOf(steps, 'requeue_task').flatMap((result) => {
    const written = result as { status?: string; value?: { kind?: string; requeue?: Record<string, unknown> } };
    return written.status === 'committed' && written.value?.kind === 'requeued' && written.value.requeue !== undefined
      ? [written.value.requeue] : [];
  });
}
/** The `claim_task` requests the Workflow returned (their `input`: Task, Session, budget, `requeueRef`). */
export function claimInputsOf(steps: readonly AdvanceValue[]): Array<Record<string, unknown>> {
  return steps.flatMap(step => step.next !== null && step.next.kind === 'perform' && step.next.operation.kind === 'claim_task'
    ? [step.next.operation.request.input as unknown as Record<string, unknown>] : []);
}
/** `stopBefore` for the `n`-th `perform` of `kind` from now on (1-based). */
export function performsNth(kind: string, n: number): (input: WorkflowAdvanceInput) => boolean {
  let seen = 0;
  return (input) => {
    if (input.kind !== 'perform' || input.operation.kind !== kind) return false;
    seen += 1;
    return seen === n;
  };
}

// ---------------------------------------------------------------------------
// Owner calls
// ---------------------------------------------------------------------------

/**
 * `claims.requeueTask` as `caller` (the automation actor through a Host principal, or an Agent's work-run
 * context), which no route accepts; the pins are read as the operator on the same platform.
 */
export async function ownerRequeue(platform: Platform, caller: CoreCallContext, afterRunRef: RunRef, requestId: string,
  extra: Partial<RequeueTaskInput> = {}): Promise<WriteResult<TaskRequeueOutcomeV1>> {
  const goal = await platform.plans.queryGoal(hostCtx(), AG2B_GOAL_REF);
  if (goal.status !== 'ready') throw new Error(`the Goal must be readable: ${JSON.stringify(goal)}`);
  const run = await platform.executions.readExecution(hostCtx(), afterRunRef);
  if (run.status !== 'ready') throw new Error(`the afterRun must be readable: ${JSON.stringify(run)}`);
  return platform.claims.requeueTask!(caller, { meta: { requestId, expected: [{ ref: AG2B_GOAL_REF, revision: goal.value.goal.revision },
    { ref: afterRunRef, revision: run.value.run.revision }] },
  input: { taskRef: TASK, afterRunRef, reason: 'try the stopped work again', ...extra } });
}

/** The work Task's rounds in the last invariant world. */
export function roundsOfTask(h: ScenarioBase, taskId: string = AG2B_WORK_TASK_ID): RoundSnapshot[] {
  return (h.lastWorld?.rounds ?? []).filter(round => round.subject.taskId === taskId);
}

// ---------------------------------------------------------------------------
// C8-budget (moved from tests/composition/A2-auto-rework-budget-platform.test.ts)
// ---------------------------------------------------------------------------

const SKILLS_ROOT = fileURLToPath(new URL('../../../vendor/coding-agent/resources/skills', import.meta.url));
const AT = '2026-10-06T00:00:00.000Z';
const platforms: Platform[] = [];
const directories: string[] = [];

/** Closes the platforms this file opened and removes its own directories (call before `cleanupScenarios`). */
export async function cleanupRework(): Promise<void> {
  for (const platform of platforms.splice(0)) await platform.close().catch(() => undefined);
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
}

export const BUDGET_PROJECT_ID = 'a2-budget-project';
const budgetWorkspaceId = 'a2-budget-workspace';
export const BUDGET_SCOPE = { projectId: BUDGET_PROJECT_ID, workspaceId: budgetWorkspaceId };
const budgetActor = { kind: 'human' as const, id: 'a2-budget-operator' };
const budgetProjectRef = { aggregateType: 'Project' as const, projectId: BUDGET_PROJECT_ID };
const budgetWorkspaceRef = { aggregateType: 'Workspace' as const, projectId: BUDGET_PROJECT_ID, workspaceId: budgetWorkspaceId };
export const BUDGET_GOAL_REF = { aggregateType: 'Goal' as const, projectId: BUDGET_PROJECT_ID, goalId: 'a2-budget-goal' };
const budgetPolicyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: BUDGET_PROJECT_ID, policyId: 'a2-budget-policy',
  revision: 1 };
const budgetActiveRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: BUDGET_PROJECT_ID };
export const BUDGET_SESSION_ROLE = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
export const BUDGET_ROLE_BINDING = { schemaVersion: 1 as const, bindingId: 'a2-budget-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
/** One tool call per Run: a Run's second call exceeds the Kernel limit (`limit_exceeded` → `budget_exhausted`). */
const budgetRuntimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 1, timeoutMs: 30000, perResponseTokens: 512 };
export const BUDGET_CONSUMER_ID = 'a2-budget-consumer';
export const BUDGET_BINDING_BUDGET = { tokenBudget: 100000, deadline: null };
export const BUDGET_RAISED_BUDGET = { tokenBudget: 200000, deadline: null };
export const BUDGET_TASK_ID = 'work-1';

export function budgetCtx(): CoreCallContext {
  return { ...BUDGET_SCOPE, principal: { kind: 'host', actor: budgetActor },
    materialReader: { kind: 'host', ...BUDGET_SCOPE, actor: budgetActor }, signal: new AbortController().signal };
}

function budgetWorkspaceBindings(directory: string, state: { revision: number }): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== BUDGET_PROJECT_ID || requested.workspaceId !== budgetWorkspaceId) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: state.revision } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 'a2-budget-host', permissionRevision: 'a2-budget-grant-1', allowsRead: () => true } };
    },
  };
}

function budgetRuntimeHost(scripted: ScriptedModel): RuntimeHostBindings {
  return {
    async resolveConfiguration(context, request) {
      if (context.projectId !== BUDGET_PROJECT_ID || context.workspaceId !== budgetWorkspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the runtime Host is not bound to this workspace' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'the current Role binding is inadmissible' };
      }
      return { status: 'ready', value: {
        configurationRevision: 'a2-budget-host-config@1',
        model: { configuration: { revision: 'a2-budget-host-config@1', provider: 'deepseek', model: 'a2-budget-scripted',
          baseUrl: 'http://127.0.0.1' },
        client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
          tokenizer: 'a2-budget-counter' }) } },
        budget: budgetRuntimeBudget,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex('A2 budget trusted static role guidance') } : null,
        tools: ['read'], writeScope: [], skills: { resourceRoot: SKILLS_ROOT, enabledIds: [] },
        systemInstruction: 'A2 budget trusted static role guidance', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

function budgetPlanDraft(): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'a2-budget-plan', planRevision: 1, goalId: BUDGET_GOAL_REF.goalId, stages: [],
    tasks: [
      { taskId: BUDGET_TASK_ID, title: 'Ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: BUDGET_TASK_ID, role: 'builder', instruction: 'Do the ordinary work' }],
    obligations: [{ obligationId: 'a2-budget-obligation', title: 'Deliver the work', requirementLevel: 'required',
      taskIds: [BUDGET_TASK_ID, 'goal-gate'],
      verificationRequirements: [{ requirementId: 'a2-budget-static', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

async function committed<T>(result: WriteResult<T>, what: string): Promise<T> {
  if (result.status !== 'committed') throw new Error(`${what} failed: ${JSON.stringify(result)}`);
  return result.value;
}

/**
 * The budget platform: Run 1 reads once, then a second read the one-tool limit refuses; Run 2 answers with a
 * final text. The registered check passes once `fixed.txt` exists. The seed writes are checked to commit.
 */
export async function openBudgetEnvironment(): Promise<{ platform: Platform; scripted: ScriptedModel; workspaceRoot: string;
  directory: string; target: InvariantTarget }> {
  const directory = await mkdtemp(join(tmpdir(), 'next-a2-budget-'));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-a2-budget-source-'));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), 'A2 budget registered workspace source\n');
  const state = { revision: 1 };
  const read = (callId: string) => ({ kind: 'calls' as const, calls: [{ callId, name: 'read', args: { path: 'source.txt' } }] });
  // Run 1: one read, then a second read the one-tool limit refuses; Run 2: a final text.
  const scripted = createScriptedModel([read('a2-budget-read-1'), read('a2-budget-read-2'),
    { kind: 'text', text: 'A2 budget: Run 2 finishes within its larger budget' }]);
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'a2-budget-checks-1', workspace: budgetWorkspaceRef, executor: budgetActor,
    permissionRevision: 'a2-budget-grant-1', sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
    deniedPrefixes: ['.git'],
    checks: [{ checkId: 'a2-budget-check', kind: 'static', command: 'test -f fixed.txt', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = { consumerId: BUDGET_CONSUMER_ID,
    bindings: [{ workspace: BUDGET_SCOPE, sessionRole: BUDGET_SESSION_ROLE, roleBinding: BUDGET_ROLE_BINDING, budget: BUDGET_BINDING_BUDGET }] };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: budgetWorkspaceBindings(workspaceRoot, state), now: () => AT,
    kernelStores: { entries: [{ adapterId: 'a2-budget-kernel', storeKey: 'a2-budget-kernel-store',
      workspace: BUDGET_SCOPE, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: budgetRuntimeHost(scripted), checks, workflow,
  });
  platforms.push(platform);
  const host = budgetCtx();
  await committed(await platform.projects.createProject(host, { meta: { requestId: 'a2-budget-project',
    expected: [{ ref: budgetProjectRef, revision: 0 }] }, input: { projectId: BUDGET_PROJECT_ID } }), 'project creation');
  const registered = await committed(await platform.projects.registerWorkspace(host, { meta: { requestId: 'a2-budget-workspace',
    expected: [{ ref: budgetProjectRef, revision: 1 }, { ref: budgetWorkspaceRef, revision: 0 }] }, input: { workspace: BUDGET_SCOPE } }),
  'Workspace registration');
  state.revision = registered.revision;
  const installed = await committed(await platform.completionPolicies.installCompletionPolicy(host, { meta: { requestId: 'a2-budget-policy',
    expected: [{ ref: budgetProjectRef, revision: 1 }, { ref: budgetPolicyRef, revision: 0 }] },
    input: { policyId: 'a2-budget-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } }), 'policy install');
  await committed(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'a2-budget-policy-active',
    expected: [{ ref: budgetProjectRef, revision: 1 }, { ref: budgetActiveRef, revision: 0 }] },
    input: { target: { ref: installed.ref, digest: installed.contentDigest } } }), 'policy activation');
  await committed(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'a2-budget-baseline',
    expected: [{ ref: budgetProjectRef, revision: 1 }, { ref: budgetWorkspaceRef, revision: state.revision }] },
    input: { baselineId: 'a2-budget-baseline', description: 'The A2 budget module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId: BUDGET_PROJECT_ID, moduleId: 'a2-budget' }, name: 'A2 budget',
        responsibility: 'Rework an exhausted Run', paths: ['src'], interfaces: [] }] } } }), 'architecture adoption');
  await committed(await platform.goals.createGoal(host, { meta: { requestId: 'a2-budget-goal',
    expected: [{ ref: budgetProjectRef, revision: 1 }, { ref: budgetWorkspaceRef, revision: state.revision }] },
    input: { goalId: BUDGET_GOAL_REF.goalId, workspace: BUDGET_SCOPE, objective: 'Rework an exhausted Run with a larger budget' } }),
  'Goal creation');
  const proposed = await committed(await platform.plans.proposePlan(host, { meta: { requestId: 'a2-budget-plan-propose', expected: [] },
    input: { goalRef: BUDGET_GOAL_REF, basedOn: null, draft: budgetPlanDraft(), reason: { text: 'Initial A2 budget plan', sources: [] } } }),
  'Plan proposal');
  await committed(await platform.plans.applyPlanChange(host, { meta: { requestId: 'a2-budget-plan-apply', expected: [] },
    input: { proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [] } }), 'Plan adoption');
  return { platform, scripted, workspaceRoot, directory, target: { database: directory, projectId: BUDGET_PROJECT_ID } };
}

/**
 * The Host drives every returned `next` until the Workflow settles (moved `drive`); after every step that
 * returned a receipt it checks the §11 invariants with that step (`stepOfReceipt`, the operator, the default policy).
 */
export async function budgetDrive(platform: Platform, target: InvariantTarget, first: WorkflowAdvanceInput,
  label: string): Promise<AdvanceValue[]> {
  const steps: AdvanceValue[] = [];
  let input = first;
  for (let guard = 0; guard < 64; guard += 1) {
    const result = await platform.workflow.advanceWork(budgetCtx(), input);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    steps.push(result.value);
    const receipt = result.value.receipt;
    if (receipt !== null) {
      const at = `${label}#${guard} ${receipt.kind}`;
      await assertInvariantsAt(target, at, stepOfReceipt(receipt, budgetActor, DEFAULT_TASK_AUTOMATION_POLICY, at));
    }
    if (result.value.state === 'completed' || result.value.next === null) return steps;
    input = result.value.next;
  }
  throw new Error('the Workflow did not settle within the step guard');
}

export const budgetSelect = (flowId: string, goalLevel = false): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef: BUDGET_GOAL_REF, flowId, sessionHint: null, kind: 'select_work', ...(goalLevel ? {} : { taskId: BUDGET_TASK_ID }) });

export async function budgetTaskRow(platform: Platform) {
  const graph = await platform.plans.queryTaskGraph(budgetCtx(), { goalRef: BUDGET_GOAL_REF });
  if (graph.status !== 'ready') throw new Error('the task graph must be readable');
  const row = graph.value.tasks.find(candidate => candidate.ref.taskId === BUDGET_TASK_ID);
  if (row === undefined) throw new Error('work-1 is not in the graph');
  return row;
}

export async function budgetDisplay(platform: Platform) {
  const read = await platform.plans.queryGoalDisplay!(budgetCtx(), { goalRef: BUDGET_GOAL_REF });
  if (read.status !== 'ready') throw new Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
  return read.value.display;
}
