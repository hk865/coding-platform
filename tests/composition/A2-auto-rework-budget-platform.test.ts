/**
 * A.2 step 5.8, part 2 through the public composition root on SQLite
 * (docs/refactor/STATE-MACHINES-SPEC.md §15.2 5.8 "`stopped/budget_exhausted`
 * 且配置的绑定预算更大时带该预算 requeue"; §4 TD-9 AV-11, TASK-03, G-BUDGET;
 * §13.4 #19; §2.1 GOAL-30; C8).
 *
 * The Host drives the real Workflow over a real Kernel with the scripted
 * model. The runtime grant allows one tool call per Run, so Run 1's second
 * `read` exceeds the Kernel limit and Run 1 ends `budget_exhausted`; `start`
 * goes back to the selection (result mapping). The verdict is
 * `stopped/budget_exhausted{minTokenBudgetExclusive}` = Run 1's token budget,
 * the binding's own budget is not larger, so the Workflow requeues nothing and
 * the Goal shows NEEDS_DECISION. The Host raises the binding budget
 * (`registerWorkflowBinding`); the next 推进 requeues with that budget as the
 * Workflow automation actor, the claim and Run 2 carry it (TASK-03), Run 2
 * passes once the source is fixed and the Goal completes.
 *
 * No real model is called: three scripted replies.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';

const AT = '2026-10-06T00:00:00.000Z';
const projectId = 'a2-budget-project';
const workspaceId = 'a2-budget-workspace';
const scope = { projectId, workspaceId };
const hostActor = { kind: 'human' as const, id: 'a2-budget-operator' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'a2-budget-goal' };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'a2-budget-policy', revision: 1 };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const sessionRole = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'a2-budget-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
/** One tool call per Run: a Run's second call exceeds the Kernel limit (`limit_exceeded` → `budget_exhausted`). */
const runtimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 1, timeoutMs: 30000, perResponseTokens: 512 };
const CONSUMER_ID = 'a2-budget-consumer';
const BINDING_BUDGET = { tokenBudget: 100000, deadline: null };
const RAISED_BUDGET = { tokenBudget: 200000, deadline: null };
const TASK_ID = 'work-1';

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
const directories: string[] = [];
const platforms: Platform[] = [];
afterEach(async () => {
  for (const platform of platforms.splice(0)) await platform.close().catch(() => undefined);
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function ctx(): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor: hostActor },
    materialReader: { kind: 'host', projectId, workspaceId, actor: hostActor }, signal: new AbortController().signal };
}

function workspaceBindings(directory: string, state: { revision: number }): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== projectId || requested.workspaceId !== workspaceId) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: state.revision } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 'a2-budget-host', permissionRevision: 'a2-budget-grant-1', allowsRead: () => true } };
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
        configurationRevision: 'a2-budget-host-config@1',
        model: { configuration: { revision: 'a2-budget-host-config@1', provider: 'deepseek', model: 'a2-budget-scripted',
          baseUrl: 'http://127.0.0.1' },
        client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
          tokenizer: 'a2-budget-counter' }) } },
        budget: runtimeBudget,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex('A2 budget trusted static role guidance') } : null,
        tools: ['read'], writeScope: [], skills: { resourceRoot: fileURLToPath(new URL('../../vendor/coding-agent/resources/skills',
          import.meta.url)), enabledIds: [] },
        systemInstruction: 'A2 budget trusted static role guidance', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

function planDraft(): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'a2-budget-plan', planRevision: 1, goalId: goalRef.goalId, stages: [],
    tasks: [
      { taskId: TASK_ID, title: 'Ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: TASK_ID, role: 'builder', instruction: 'Do the ordinary work' }],
    obligations: [{ obligationId: 'a2-budget-obligation', title: 'Deliver the work', requirementLevel: 'required',
      taskIds: [TASK_ID, 'goal-gate'],
      verificationRequirements: [{ requirementId: 'a2-budget-static', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

async function openEnvironment(): Promise<{ platform: Platform; scripted: ReturnType<typeof createScriptedModel>; workspaceRoot: string }> {
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
    configurationRevision: 'a2-budget-checks-1', workspace: workspaceRef, executor: hostActor,
    permissionRevision: 'a2-budget-grant-1', sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
    deniedPrefixes: ['.git'],
    checks: [{ checkId: 'a2-budget-check', kind: 'static', command: 'test -f fixed.txt', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = { consumerId: CONSUMER_ID,
    bindings: [{ workspace: scope, sessionRole, roleBinding, budget: BINDING_BUDGET }] };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: workspaceBindings(workspaceRoot, state), now: () => AT,
    kernelStores: { entries: [{ adapterId: 'a2-budget-kernel', storeKey: 'a2-budget-kernel-store',
      workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: runtimeHost(scripted), checks, workflow,
  });
  platforms.push(platform);
  const host = ctx();
  expect(await platform.projects.createProject(host, { meta: { requestId: 'a2-budget-project',
    expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } })).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(host, { meta: { requestId: 'a2-budget-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  state.revision = registered.value.revision;
  const installed = await platform.completionPolicies.installCompletionPolicy(host, { meta: { requestId: 'a2-budget-policy',
    expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
    input: { policyId: 'a2-budget-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'a2-budget-policy-active',
    expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'a2-budget-baseline',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { baselineId: 'a2-budget-baseline', description: 'The A2 budget module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: 'a2-budget' }, name: 'A2 budget',
        responsibility: 'Rework an exhausted Run', paths: ['src'], interfaces: [] }] } } })).toMatchObject({ status: 'committed' });
  expect(await platform.goals.createGoal(host, { meta: { requestId: 'a2-budget-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Rework an exhausted Run with a larger budget' } }))
    .toMatchObject({ status: 'committed' });
  const proposed = await platform.plans.proposePlan(host, { meta: { requestId: 'a2-budget-plan-propose', expected: [] },
    input: { goalRef, basedOn: null, draft: planDraft(), reason: { text: 'Initial A2 budget plan', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error('Plan proposal failed');
  const applied = await platform.plans.applyPlanChange(host, { meta: { requestId: 'a2-budget-plan-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');
  return { platform, scripted, workspaceRoot };
}

type AdvanceValue = Extract<WorkflowAdvanceResult, { status: 'ready' }>['value'];

/** The Host drives every returned `next` until the Workflow settles. */
async function drive(platform: Platform, first: WorkflowAdvanceInput): Promise<AdvanceValue[]> {
  const steps: AdvanceValue[] = [];
  let input = first;
  for (let guard = 0; guard < 64; guard += 1) {
    const result = await platform.workflow.advanceWork(ctx(), input);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    steps.push(result.value);
    if (result.value.state === 'completed' || result.value.next === null) return steps;
    input = result.value.next;
  }
  throw new Error('the Workflow did not settle within the step guard');
}

const select = (flowId: string, goalLevel = false): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work', ...(goalLevel ? {} : { taskId: TASK_ID }) });

async function taskRow(platform: Platform) {
  const graph = await platform.plans.queryTaskGraph(ctx(), { goalRef });
  if (graph.status !== 'ready') throw new Error('the task graph must be readable');
  const row = graph.value.tasks.find(candidate => candidate.ref.taskId === TASK_ID);
  if (row === undefined) throw new Error('work-1 is not in the graph');
  return row;
}

async function display(platform: Platform) {
  const read = await platform.plans.queryGoalDisplay!(ctx(), { goalRef });
  if (read.status !== 'ready') throw new Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
  return read.value.display;
}

it('AV-11, §13.4 #19: an exhausted Run waits until the binding budget is larger, then the Workflow requeues with it and the claim carries it', async () => {
  const { platform, scripted, workspaceRoot } = await openEnvironment();

  // Run 1 exceeds the one-tool limit: `start` returns it ended budget_exhausted and goes back to the selection,
  // which stops on the verdict (the binding budget is the exhausted one, not larger).
  const first = await drive(platform, select('a2-budget-flow-1'));
  const started = first.find(step => step.receipt?.kind === 'start');
  expect(started).toMatchObject({ state: 'advance', next: { kind: 'select_work' },
    receipt: { result: { status: 'ready', value: { run: { status: 'ended', outcome: 'budget_exhausted', budget: BINDING_BUDGET } } } } });
  expect(first.at(-1)).toMatchObject({ state: 'waiting', next: null, reason: `the selected Task ${TASK_ID} is not executable right now` });
  expect(first.some(step => step.next?.kind === 'perform' && step.next.operation.kind === 'requeue_task')).toBe(false);
  expect(scripted.calls(), 'Run 1: the first read, then the request whose read exceeds the limit').toBe(2);
  const exhausted = await taskRow(platform);
  expect(exhausted).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'run_failed' },
    failure: { failureClass: 'run_failed', run: { outcome: 'budget_exhausted', budget: BINDING_BUDGET },
      automation: { lastRefusal: null, verdict: { kind: 'stopped', reason: 'budget_exhausted',
        detail: { minTokenBudgetExclusive: BINDING_BUDGET.tokenBudget } } } } });
  expect(exhausted.rework).toBeUndefined();
  expect(await display(platform)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'budget_exhausted', taskId: TASK_ID, detail: { minTokenBudgetExclusive: BINDING_BUDGET.tokenBudget } } });
  const run1Ref = exhausted.execution;
  if (run1Ref === null) throw new Error('Run 1 must be selected');

  // The Host raises the Workflow binding budget; the source is fixed so Run 2's round can pass.
  platform.registerWorkflowBinding({ consumerId: CONSUMER_ID,
    binding: { workspace: scope, sessionRole, roleBinding, budget: RAISED_BUDGET } });
  await writeFile(join(workspaceRoot, 'fixed.txt'), 'fixed\n');
  const second = await drive(platform, select('a2-budget-flow-2', true));
  expect(second.at(-1), JSON.stringify(second.map(step => [step.state, step.reason, step.receipt?.kind])))
    .toMatchObject({ state: 'completed', receipt: { kind: 'complete_goal' } });
  // The automatic requeue carries the larger budget (G-BUDGET passes), as the automation actor.
  expect(second.find(step => step.receipt?.kind === 'requeue_task')).toMatchObject({ state: 'advance', next: { kind: 'select_work' },
    receipt: { result: { status: 'committed', value: { kind: 'requeued', requeue: { afterRunRef: run1Ref, afterOutcome: 'budget_exhausted',
      failureClass: 'run_failed', budget: RAISED_BUDGET, reason: 'auto-rework:run_failed#1', requestedBy: WORKFLOW_AUTOMATION_ACTOR,
      automation: { automatic: true, counted: true, autoCount: 1 } } } } } });
  // TASK-03: the claim and Run 2 carry the pinned budget.
  expect(second.find(step => step.receipt?.kind === 'claim_task')).toMatchObject({ receipt: { result: { status: 'committed' } } });
  const done = await taskRow(platform);
  expect(done).toMatchObject({ effectivePhase: 'satisfied' });
  const run2Ref = done.execution;
  if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be selected');
  const run2 = await platform.executions.readExecution(ctx(), run2Ref);
  expect(run2).toMatchObject({ status: 'ready', value: { run: { outcome: 'completed', budget: RAISED_BUDGET,
    requeueRef: { afterRunId: run1Ref.runId } } } });
  expect(await display(platform)).toMatchObject({ phase: 'COMPLETED' });
  expect(scripted.calls()).toBe(3);
}, 120_000);
