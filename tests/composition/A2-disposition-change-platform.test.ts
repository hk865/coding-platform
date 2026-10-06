/**
 * A.2 step 5.10 through the public composition root on SQLite: a disposition change of a Task with
 * execution history (C7; docs/refactor/STATE-MACHINES-SPEC.md §15.2 5.10, §3 PLAN-05 with TASK-19 guards
 * 1–8 and guard 9 (lead decision LA-3), §4 TASK-18/19, TD-4, AV-1, §2 GOAL-25/GOAL-30
 * `required_task_deferred`, §9 VD-11 (L-15) Workflow selection, §13.4 #26; the C7 scenarios of §15.3).
 *
 * The real Workflow (`workflow.advanceWork`), a real Kernel with the scripted model, a real ProcessSandbox
 * for the registered check (`test -f fixed.txt`) and one SQLite ledger; the operator writes through the
 * plan service (`plans/propose`, `plans/apply`), the control service and the requeue owner.
 *
 * 1. Supersede a human-stopped Task: the operator cancels work-1's claimed Run before it enters (D-7), so
 *    work-1 is fenced (`reworkFenceOf = human_only`). The platform automation (a Host acting as
 *    `WORKFLOW_AUTOMATION_ACTOR`, class `system`) may neither supersede it (TASK-19 guard 7) nor add a
 *    parallel carrier to its obligation (guard 9); a candidate that does not list it in
 *    `reason.affectedTaskIds` is refused (guard 6); a draft carrying `dispositionRecord` or a malformed
 *    `affectedTaskIds` is refused at recording. The operator's adoption commits: work-1 keeps its source
 *    definition and basis, only `disposition`/`replacedByTaskId` change, the new Plan records the change
 *    (`dispositionRecord`), the Task row shows it (`dispositionChange`) beside the unchanged phase, and the
 *    Run, Attempt, Lease and Session records are untouched. A requeue after the adoption is refused because
 *    work-1 is no longer active (§3.3 point 2, W16 first). The Workflow skips the superseded Task (it neither
 *    runs nor waits for it, L-15), runs the replacement work-2 and completes the Goal.
 * 2. Defer and reactivate a requeued Task: work-1's check FAILs and the operator requeues it (P4); the
 *    operator defers it (TASK-19 from P4): the Workflow waits with `required_task_deferred:` (Goal level)
 *    and `task_not_active:` (Task handle), the Goal is NEEDS_DECISION/`required_task_deferred`. Reactivated,
 *    the Workflow claims it with the stored `requeueRef`; the same failure again is still no new basis
 *    (§13.4 #26: a disposition change never changes the Task's basis).
 *
 * No real model is called: one scripted text reply per entered Run.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { PlanChangeReason, PlanProposalRef } from '../../src/core/work-graph/tasks/plan-contracts.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';

const AT = '2026-10-06T00:00:00.000Z';
const projectId = 'a2-disposition-project';
const workspaceId = 'a2-disposition-workspace';
const scope = { projectId, workspaceId };
const operator = { kind: 'human' as const, id: 'a2-disposition-operator' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'a2-disposition-goal' };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'a2-disposition-policy', revision: 1 };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'a2-disposition-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const runtimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const CHECK_ID = 'a2-disposition-check';
const GATE = 'goal-gate';
const TASK = { projectId, goalId: goalRef.goalId, taskId: 'work-1' };

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
const directories: string[] = [];
const platforms: Platform[] = [];
afterEach(async () => {
  for (const platform of platforms.splice(0)) await platform.close().catch(() => undefined);
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function ctx(actor: Extract<ActorRef, { kind: 'human' | 'system' }> = operator): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
}
/** A Host acting as the platform automation actor: rework class `system` (§1 `reworkActorClassOf`). */
const automation = (): CoreCallContext => ctx({ ...WORKFLOW_AUTOMATION_ACTOR });

function workspaceBindings(directory: string, state: { revision: number }): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== projectId || requested.workspaceId !== workspaceId) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: state.revision } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 'a2-disposition-host', permissionRevision: 'a2-disposition-grant-1',
        allowsRead: () => true } };
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
        configurationRevision: 'a2-disposition-host-config@1',
        model: { configuration: { revision: 'a2-disposition-host-config@1', provider: 'deepseek', model: 'a2-disposition-scripted',
          baseUrl: 'http://127.0.0.1' },
        client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
          tokenizer: 'a2-disposition-counter' }) } },
        budget: runtimeBudget,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex('A2 disposition trusted static role guidance') } : null,
        tools: ['read'], writeScope: [], skills: { resourceRoot: fileURLToPath(new URL('../../vendor/coding-agent/resources/skills',
          import.meta.url)), enabledIds: [] },
        systemInstruction: 'A2 disposition trusted static role guidance', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

const OBLIGATION = { obligationId: 'a2-disposition-obligation', title: 'Deliver the work', requirementLevel: 'required' as const,
  verificationRequirements: [{ requirementId: 'a2-disposition-static', requirementLevel: 'required' as const, kind: 'static',
    description: 'Registered static command check' }] };
const work = (taskId: string, title: string): RuntimeTask => ({ taskId, title, requirementLevel: 'required', taskKind: 'work',
  disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' });

function planDraft(): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'a2-disposition-plan-1', planRevision: 1, goalId: goalRef.goalId, stages: [],
    tasks: [work('work-1', 'The ordinary work'), { taskId: GATE, title: 'Goal gate', requirementLevel: 'required',
      taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: [{ taskId: 'work-1', role: 'builder', instruction: 'Do the ordinary work' }],
    // The gate carries the obligation too, so work-1 may be deferred without a new carrier.
    obligations: [{ ...OBLIGATION, taskIds: ['work-1', GATE] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

type Environment = { platform: Platform; scripted: ReturnType<typeof createScriptedModel>; workspaceRoot: string };

async function openEnvironment(replies: number): Promise<Environment> {
  const directory = await mkdtemp(join(tmpdir(), 'next-a2-disposition-'));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-a2-disposition-source-'));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), 'A2 disposition registered workspace source\n');
  const state = { revision: 1 };
  const scripted = createScriptedModel(Array.from({ length: replies }, (_, index) => ({ kind: 'text' as const,
    text: `A2 disposition work result ${index + 1}` })));
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'a2-disposition-checks-1', workspace: workspaceRef, executor: operator,
    permissionRevision: 'a2-disposition-grant-1', sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
    deniedPrefixes: ['.git'],
    checks: [{ checkId: CHECK_ID, kind: 'static', command: 'test -f fixed.txt', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'a2-disposition-consumer',
    bindings: [{ workspace: scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: workspaceBindings(workspaceRoot, state), now: () => AT,
    kernelStores: { entries: [{ adapterId: 'a2-disposition-kernel', storeKey: 'a2-disposition-kernel-store',
      workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: runtimeHost(scripted), checks, workflow,
  });
  platforms.push(platform);
  const host = ctx();
  expect(await platform.projects.createProject(host, { meta: { requestId: 'a2-project',
    expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } })).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(host, { meta: { requestId: 'a2-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  state.revision = registered.value.revision;
  const installed = await platform.completionPolicies.installCompletionPolicy(host, { meta: { requestId: 'a2-policy',
    expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
    input: { policyId: 'a2-disposition-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'a2-policy-active',
    expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'a2-baseline',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { baselineId: 'a2-baseline', description: 'The A2 disposition module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: 'a2-disposition' }, name: 'A2 disposition',
        responsibility: 'Change what is planned', paths: ['src'], interfaces: [] }] } } })).toMatchObject({ status: 'committed' });
  expect(await platform.goals.createGoal(host, { meta: { requestId: 'a2-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Change the plan of work that already ran' } }))
    .toMatchObject({ status: 'committed' });
  const proposed = await platform.plans.proposePlan(host, { meta: { requestId: 'a2-plan-propose', expected: [] },
    input: { goalRef, basedOn: null, draft: planDraft(), reason: { text: 'Initial A2 disposition plan', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error('Plan proposal failed');
  const applied = await platform.plans.applyPlanChange(host, { meta: { requestId: 'a2-plan-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');
  return { platform, scripted, workspaceRoot };
}

const select = (flowId: string, taskId: string | null = null): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work', ...(taskId === null ? {} : { taskId }) });
const performs = (kind: string) => (input: WorkflowAdvanceInput): boolean => input.kind === 'perform' && input.operation.kind === kind;

type Driven = { state: string; reason: string | null; receipts: WorkflowStepReceipt[]; stoppedBefore: boolean };
/** The Host drives every returned `next` until the Workflow settles or `stopBefore` names the next step. */
async function drive(platform: Platform, first: WorkflowAdvanceInput,
  stopBefore: (input: WorkflowAdvanceInput) => boolean = () => false): Promise<Driven> {
  const receipts: WorkflowStepReceipt[] = [];
  let input = first;
  for (let guard = 0; guard < 64; guard += 1) {
    if (stopBefore(input)) return { state: 'stopped', reason: null, receipts, stoppedBefore: true };
    const result = await platform.workflow.advanceWork(ctx(), input);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    if (result.value.receipt !== null) receipts.push(result.value.receipt);
    if (result.value.state === 'completed' || result.value.next === null) {
      return { state: result.value.state, reason: result.value.reason, receipts, stoppedBefore: false };
    }
    input = result.value.next;
  }
  throw new Error('the Workflow did not settle within the step guard');
}

async function graph(platform: Platform) {
  const read = await platform.plans.queryTaskGraph(ctx(), { goalRef });
  if (read.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(read)}`);
  return read.value;
}
async function taskRow(platform: Platform, taskId: string) {
  const row = (await graph(platform)).tasks.find(candidate => candidate.ref.taskId === taskId);
  if (row === undefined) throw new Error(`task ${taskId} is not in the graph`);
  return row;
}
async function goalDisplay(platform: Platform) {
  const read = await platform.plans.queryGoalDisplay!(ctx(), { goalRef });
  if (read.status !== 'ready') throw new Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
  return read.value.display;
}
async function readRun(platform: Platform, runRef: RunRef) {
  const read = await platform.executions.readExecution(ctx(), runRef);
  if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

/** The next future revision of the active Plan with `edit` applied to a copy of its draft fields. */
async function nextDraft(platform: Platform, planId: string,
  edit: (draft: Extract<PlanRevisionDraft, { schemaVersion: 2 }>) => Extract<PlanRevisionDraft, { schemaVersion: 2 }>) {
  const plan = (await graph(platform)).plan;
  if (plan.schemaVersion !== 2) throw new Error('the active Plan is a v2 Plan');
  const draft: Extract<PlanRevisionDraft, { schemaVersion: 2 }> = { schemaVersion: 2, planId, planRevision: plan.planRevision + 1,
    goalId: goalRef.goalId, stages: structuredClone(plan.stages), tasks: structuredClone(plan.tasks),
    assignments: structuredClone(plan.assignments ?? []), obligations: structuredClone(plan.obligations),
    taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
    taskRelations: structuredClone(plan.taskRelations ?? []), inputRequirements: structuredClone(plan.inputRequirements ?? []) };
  return { source: plan, draft: edit(draft) };
}
async function propose(platform: Platform, requestId: string, source: PlanRevisionSnapshot, draft: PlanRevisionDraft,
  reason: PlanChangeReason, caller: CoreCallContext = ctx()) {
  return platform.plans.proposePlan(caller, { meta: { requestId, expected: [] }, input: { goalRef, basedOn: source.ref, draft, reason } });
}
async function apply(platform: Platform, requestId: string, proposal: { ref: PlanProposalRef; revision: number }, caller: CoreCallContext = ctx()) {
  return platform.plans.applyPlanChange(caller, { meta: { requestId, expected: [] },
    input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] } });
}
async function proposed(platform: Platform, requestId: string, source: PlanRevisionSnapshot, draft: PlanRevisionDraft,
  reason: PlanChangeReason, caller: CoreCallContext = ctx()) {
  const result = await propose(platform, requestId, source, draft, reason, caller);
  if (result.status !== 'committed') throw new Error(`proposal ${requestId} failed: ${JSON.stringify(result)}`);
  return { ref: result.value.ref, revision: result.value.revision };
}
async function activePlanRef(platform: Platform) {
  const goal = await platform.plans.queryGoal(ctx(), goalRef);
  if (goal.status !== 'ready') throw new Error('the Goal must be readable');
  return goal.value.goal.activePlanRevision;
}
const withDisposition = (tasks: RuntimeTask[], taskId: string, patch: Partial<RuntimeTask>): RuntimeTask[] =>
  tasks.map(task => task.taskId === taskId ? { ...task, ...patch } : task);

it('C7 supersede (TASK-19, guards 6, 7, 9): only the operator supersedes a human-stopped Task; the Workflow skips it and completes the Goal with its replacement', async () => {
  const { platform, scripted, workspaceRoot } = await openEnvironment(1);

  // work-1 is claimed, then the operator cancels its Run before it enters (D-7): a human stop.
  const claimed = await drive(platform, select('a2-disposition-claim'), performs('prepare'));
  expect(claimed.stoppedBefore).toBe(true);
  const claim = claimed.receipts.find(receipt => receipt.kind === 'claim_task');
  if (claim?.kind !== 'claim_task' || claim.result.status !== 'committed') throw new Error('work-1 must be claimed');
  const run1Ref = claim.result.value.runRef;
  const claimedRun = await readRun(platform, run1Ref);
  const cancelled = await platform.controls.submitControl(ctx(), { input: { runRef: run1Ref, kind: 'cancel', reason: 'not this way' },
    meta: { requestId: 'a2-disposition-cancel', expected: [{ ref: run1Ref, revision: claimedRun.run.revision }] } });
  expect(cancelled).toMatchObject({ status: 'committed', value: { intent: { status: 'applied' } } });
  const stopped = await taskRow(platform, 'work-1');
  expect(stopped).toMatchObject({ effectivePhase: 'failed', disposition: 'active', execution: run1Ref,
    failure: { failureClass: 'cancelled', automation: { verdict: { kind: 'stopped', reason: 'task_cancelled' } } } });
  const runBefore = await readRun(platform, run1Ref);

  // Recording refuses a compiler-owned dispositionRecord and a malformed affectedTaskIds (§3.4), zero writes.
  const supersede = await nextDraft(platform, 'a2-disposition-plan-2', draft => ({ ...draft,
    tasks: [...withDisposition(draft.tasks, 'work-1', { disposition: 'superseded', replacedByTaskId: 'work-2' }),
      work('work-2', 'The replacement work')],
    assignments: [...(draft.assignments ?? []), { taskId: 'work-2', role: 'builder', instruction: 'Do the work another way' }],
    obligations: [{ ...OBLIGATION, taskIds: ['work-1', GATE, 'work-2'] }] }));
  const why = { text: 'work-1 was stopped; work-2 replaces it', sources: [] };
  expect(await propose(platform, 'a2-disposition-record', supersede.source,
    { ...supersede.draft, dispositionRecord: { schemaVersion: 1, entries: [] } } as unknown as PlanRevisionDraft, why))
    .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'the draft carries dispositionRecord, which only the adoption compiler writes' });
  expect(await propose(platform, 'a2-disposition-unknown-id', supersede.source, supersede.draft, { ...why, affectedTaskIds: ['work-9'] }))
    .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'reason.affectedTaskIds names work-9, which is not a task of the draft' });

  // TASK-19 guard 7: the platform automation may not supersede what a human stopped.
  const listed = await proposed(platform, 'a2-disposition-supersede', supersede.source, supersede.draft,
    { ...why, affectedTaskIds: ['work-1'] }, automation());
  expect(await apply(platform, 'a2-disposition-supersede-auto', listed, automation())).toMatchObject({ status: 'rejected',
    code: 'forbidden', reason: 'only an operator may change the disposition of task work-1: a human paused or cancelled it' });
  // Guard 9 (LA-3): nor keep it and add a parallel carrier to its obligation.
  const parallel = await nextDraft(platform, 'a2-disposition-plan-2p', draft => ({ ...draft,
    tasks: [...draft.tasks, work('work-2', 'A parallel carrier')],
    assignments: [...(draft.assignments ?? []), { taskId: 'work-2', role: 'builder', instruction: 'Do the work in parallel' }],
    obligations: [{ ...OBLIGATION, taskIds: ['work-1', GATE, 'work-2'] }] }));
  const parallelCandidate = await proposed(platform, 'a2-disposition-parallel', parallel.source, parallel.draft,
    { text: 'add a parallel carrier', sources: [] }, automation());
  expect(await apply(platform, 'a2-disposition-parallel-auto', parallelCandidate, automation())).toMatchObject({ status: 'rejected',
    code: 'forbidden', reason: 'obligation a2-disposition-obligation: a human stopped this work; only an operator may add the parallel carrier work-2' });
  // TASK-19 guard 6: an operator adoption still needs the traced Task in reason.affectedTaskIds.
  const unlisted = await proposed(platform, 'a2-disposition-unlisted', supersede.source, supersede.draft, why);
  expect(await apply(platform, 'a2-disposition-unlisted-apply', unlisted)).toMatchObject({ status: 'rejected', code: 'invalid',
    reason: 'reason.affectedTaskIds must list traced task work-1' });
  expect(await activePlanRef(platform)).toEqual(supersede.source.ref);

  // The operator adopts the listed candidate (an operator is not fenced, LA-3, hard limit 3).
  const adopted = await apply(platform, 'a2-disposition-supersede-apply', listed);
  if (adopted.status !== 'committed') throw new Error(`the operator adoption must commit: ${JSON.stringify(adopted)}`);
  const p2 = adopted.value;
  if (p2.schemaVersion !== 2) throw new Error('the adopted Plan is a v2 Plan');
  const sourceWork1 = supersede.source.tasks.find(task => task.taskId === 'work-1')!;
  expect(p2.tasks.find(task => task.taskId === 'work-1')).toEqual({ ...sourceWork1, disposition: 'superseded', replacedByTaskId: 'work-2' });
  // The basis is inherited (only the disposition changed); the new Task points at the new Plan.
  expect(p2.taskStateBasis?.entries).toEqual(expect.arrayContaining([{ taskId: 'work-1', planRef: supersede.source.ref },
    { taskId: 'work-2', planRef: p2.ref }]));
  const entry = { taskId: 'work-1', from: 'active', to: 'superseded', replacedByTaskId: 'work-2', traced: true, setIn: p2.ref,
    proposalRef: listed.ref, reason: { ...why, affectedTaskIds: ['work-1'] }, actor: operator };
  expect(p2.dispositionRecord).toEqual({ schemaVersion: 1, entries: [entry] });
  // The Task row: the same phase and Run, the new disposition beside it; the automation verdict is none (AV-1).
  const superseded = await taskRow(platform, 'work-1');
  expect(superseded).toMatchObject({ effectivePhase: 'failed', phaseCause: stopped.phaseCause, execution: run1Ref,
    disposition: 'superseded', dispositionChange: entry, failure: { automation: { verdict: { kind: 'none' } } } });
  expect(superseded.eligibility.reasons.map(reason => reason.code)).toContain('task_not_active');
  // The old execution records are untouched; the previous Plan still reads work-1 active.
  const recordsOf = ({ run, attempt, outbox, session, lease }: Awaited<ReturnType<typeof readRun>>) => ({ run, attempt, outbox, session, lease });
  expect(recordsOf(await readRun(platform, run1Ref))).toEqual(recordsOf(runBefore));
  const p1Graph = await platform.plans.queryTaskGraph(ctx(), { goalRef, planRef: supersede.source.ref });
  expect(p1Graph.status === 'ready' ? p1Graph.value.tasks.find(row => row.ref.taskId === 'work-1') : null)
    .toMatchObject({ disposition: 'active' });
  // §3.3 point 2, W16 first: a requeue after the adoption reads work-1 superseded: TASK-16 refuses it
  // (`invalid`, task_not_active) and nothing is written.
  const goalAfterAdoption = await platform.plans.queryGoal(ctx(), goalRef);
  if (goalAfterAdoption.status !== 'ready') throw new Error('the Goal must be readable');
  expect(await platform.claims.requeueTask!(ctx(), { meta: { requestId: 'a2-disposition-requeue-superseded',
    expected: [{ ref: goalRef, revision: goalAfterAdoption.value.goal.revision }, { ref: run1Ref, revision: runBefore.run.revision }] },
    input: { taskRef: TASK, afterRunRef: run1Ref, reason: 'try it again' } }))
    .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'task_not_active: the task disposition is superseded' });
  expect(recordsOf(await readRun(platform, run1Ref))).toEqual(recordsOf(runBefore));
  // A stopped, superseded Task gives the Goal no reason: it is RUNNING with work-2 to do.
  const running = await goalDisplay(platform);
  expect(running.phase).toBe('RUNNING');
  expect(running.causes.map(cause => cause.code)).not.toContain('task_cancelled');

  // The Workflow skips work-1 (no run, no wait), runs work-2 and completes the Goal.
  await writeFile(join(workspaceRoot, 'fixed.txt'), 'fixed\n');
  const finished = await drive(platform, select('a2-disposition-finish'));
  expect(finished.state).toBe('completed');
  const claims = finished.receipts.filter(receipt => receipt.kind === 'claim_task');
  expect(claims.map(receipt => receipt.kind === 'claim_task' && receipt.result.status === 'committed'
    ? receipt.result.value.runRef.runId : null)).toHaveLength(1);
  expect(await taskRow(platform, 'work-2')).toMatchObject({ effectivePhase: 'satisfied' });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'failed', disposition: 'superseded' });
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'COMPLETED' });
  // One model call: work-1's Run never entered.
  expect(scripted.requests).toHaveLength(1);
});

it('C7 defer and reactivate (TASK-19 from P4, L-15, GOAL-30, #26): a deferred requeued Task waits, is claimed with its requeueRef once active, and the same failure is still no new basis', async () => {
  const { platform, scripted } = await openEnvironment(2);

  // Run 1 completes and its check FAILs; the operator requeues (P4).
  const first = await drive(platform, select('a2-disposition-run-1', 'work-1'), performs('requeue_task'));
  expect(first.stoppedBefore).toBe(true);
  const failed = await taskRow(platform, 'work-1');
  expect(failed).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'check_failed' } });
  const run1Ref = failed.execution;
  if (run1Ref === null) throw new Error('work-1 must have a selected Run');
  const requeue = async (requestId: string, afterRunRef: RunRef) => {
    const goal = await platform.plans.queryGoal(ctx(), goalRef);
    if (goal.status !== 'ready') throw new Error('the Goal must be readable');
    const afterRun = await readRun(platform, afterRunRef);
    return platform.claims.requeueTask!(ctx(), { meta: { requestId, expected: [{ ref: goalRef, revision: goal.value.goal.revision },
      { ref: afterRunRef, revision: afterRun.run.revision }] },
      input: { taskRef: TASK, afterRunRef, reason: 'the registered check failed; try again' } });
  };
  const requeued = await requeue('a2-disposition-requeue-1', run1Ref);
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`requeue 1: ${JSON.stringify(requeued)}`);
  const requeueRef = requeued.value.requeue.ref;
  const p1 = (await graph(platform)).plan;

  // The operator defers it (TASK-19 from P4); an adoption that does not list it is refused first (guard 6).
  const defer = await nextDraft(platform, 'a2-disposition-plan-2', draft => ({ ...draft,
    tasks: withDisposition(draft.tasks, 'work-1', { disposition: 'deferred' }) }));
  const unlisted = await proposed(platform, 'a2-disposition-defer-unlisted', defer.source, defer.draft,
    { text: 'not now', sources: [] });
  expect(await apply(platform, 'a2-disposition-defer-unlisted-apply', unlisted)).toMatchObject({ status: 'rejected',
    code: 'invalid', reason: 'reason.affectedTaskIds must list traced task work-1' });
  const deferral = await proposed(platform, 'a2-disposition-defer', defer.source, defer.draft,
    { text: 'not now', sources: [], affectedTaskIds: ['work-1'] });
  const deferred = await apply(platform, 'a2-disposition-defer-apply', deferral);
  if (deferred.status !== 'committed' || deferred.value.schemaVersion !== 2) throw new Error(`defer: ${JSON.stringify(deferred)}`);
  expect(deferred.value.taskStateBasis?.entries).toContainEqual({ taskId: 'work-1', planRef: p1.ref });
  const waiting = await taskRow(platform, 'work-1');
  expect(waiting).toMatchObject({ effectivePhase: 'pending', phaseCause: { code: 'requeued' }, requeueRef,
    disposition: 'deferred', dispositionChange: { taskId: 'work-1', from: 'active', to: 'deferred', traced: true,
      setIn: deferred.value.ref, actor: operator } });
  expect(waiting.eligibility.reasons.map(reason => reason.code)).toContain('task_not_active');
  if (waiting.failure !== undefined) expect(waiting.failure.automation.verdict).toEqual({ kind: 'none' });

  // L-15: the Workflow skips it; the Goal level waits on the deferred required work, the Task handle is not active.
  const goalLevel = await drive(platform, select('a2-disposition-goal-level'));
  expect(goalLevel.state).toBe('waiting');
  expect(goalLevel.reason).toMatch(/^required_task_deferred: required work cannot advance: work-1: deferred/);
  const handle = await drive(platform, select('a2-disposition-handle', 'work-1'));
  expect(handle).toMatchObject({ state: 'waiting', receipts: [] });
  expect(handle.reason).toMatch(/^task_not_active: the selected Task work-1 is deferred/);
  // GOAL-30: required work is deferred and nothing required is left to run.
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'required_task_deferred', taskIds: ['work-1'] } });
  expect(scripted.requests).toHaveLength(1);

  // The operator reactivates it: the record keeps the latest change, the basis is still the first Plan.
  const reactivate = await nextDraft(platform, 'a2-disposition-plan-3', draft => ({ ...draft,
    tasks: withDisposition(draft.tasks, 'work-1', { disposition: 'active' }) }));
  const reactivation = await proposed(platform, 'a2-disposition-reactivate', reactivate.source, reactivate.draft,
    { text: 'now', sources: [], affectedTaskIds: ['work-1'] });
  const reactivated = await apply(platform, 'a2-disposition-reactivate-apply', reactivation);
  if (reactivated.status !== 'committed' || reactivated.value.schemaVersion !== 2) throw new Error(`reactivate: ${JSON.stringify(reactivated)}`);
  expect(reactivated.value.taskStateBasis?.entries).toContainEqual({ taskId: 'work-1', planRef: p1.ref });
  expect(reactivated.value.dispositionRecord?.entries).toEqual([expect.objectContaining({ taskId: 'work-1', from: 'deferred',
    to: 'active', setIn: reactivated.value.ref })]);
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'pending', requeueRef, disposition: 'active',
    failure: { automation: { verdict: { kind: 'claim_requeued', requeueRef } } } });

  // The Workflow claims it with the stored requeueRef; Run 2 fails the same way.
  const second = await drive(platform, select('a2-disposition-run-2', 'work-1'), performs('requeue_task'));
  expect(second.stoppedBefore).toBe(true);
  const failedAgain = await taskRow(platform, 'work-1');
  const run2Ref = failedAgain.execution;
  if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be the selected Run');
  expect((await readRun(platform, run2Ref)).run).toMatchObject({ requeueRef, planRef: reactivated.value.ref, outcome: 'completed' });
  expect(scripted.requests).toHaveLength(2);
  // §13.4 #26: deferring and reactivating changed no basis, so the same failure is no new basis.
  expect(await requeue('a2-disposition-requeue-2', run2Ref)).toMatchObject({ status: 'committed',
    value: { kind: 'refused', refusal: { code: 'no_new_basis' } } });
});
