/**
 * A.2 step 5.3 through the public composition root on SQLite
 * (docs/refactor/STATE-MACHINES-SPEC.md §4 P1..P18, TASK-04..14; §9 VR-01..08,
 * VR-10..13, VD-1..VD-10, VD-14, VD-15).
 *
 * The Host drives the real Workflow (`workflow.advanceWork`) over a real
 * Kernel with the scripted model, a real ProcessSandbox for the registered
 * checks and one SQLite ledger:
 *
 * 1. A work Run's round is the root of its subject chain (ordinal 1, slot
 *    claimed): a second open on the same Run is `busy` with the head pin, the
 *    chain head reads without a Plan, the projection follows the head
 *    (`verifying` while open, `failed/check_failed` once an applicable FAIL
 *    finalizes it, D-2), a claim on the finalized round is `busy` (VD-2) and
 *    the failed Task cannot complete (TASK-14).
 * 2. VD-7: a future-only adoption before the round opens, between its
 *    finalize and the completion, while the Run is still in the Kernel, or
 *    between the checks and the finalize never strands the Task: the Workflow
 *    opens (resume and `start` paths) and completes (resume and
 *    `finalize_checks` paths) under the Goal's current adopted Plan.
 * 3. VR-05 (VD-6): a root moved after begin returns the check to pending; the
 *    next begin sees the moved root (`frozen_root_changed:`) and the round
 *    finalizes INCONCLUSIVE; since 5.9 the next selection re-verifies it (AV-7d).
 * 4. VD-15: a gate has one chain, anchored on its first producer; another
 *    producer cannot open a second one, and the Workflow follows the head.
 * 5. VD-8: a source that changed after the round opened ends the check
 *    attempts (`frozen_source_changed:`), so the Workflow finalizes the round
 *    INCONCLUSIVE instead of retrying the check forever (since 5.9 the next
 *    selection opens a successor round, AV-7d).
 * 6. (Moved in A.2 step 6 to tests/scenarios/C5-reverify-guards.test.ts, row (d): VR-03, a
 *    timed-out check, and the automatic re-verification stopping at no_new_basis.)
 *
 * No real model is called: the scripted model answers with text replies.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RoundSnapshot, TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkflowAdvanceInput, WorkflowOperation, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';

const AT = '2026-10-05T00:00:00.000Z';
const projectId = 'a2-chain-project';
const workspaceId = 'a2-chain-workspace';
const scope = { projectId, workspaceId };
const hostActor = { kind: 'human' as const, id: 'a2-chain-host' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'a2-chain-goal' };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'a2-chain-policy', revision: 1 };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'a2-chain-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const runtimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const CHECK_ID = 'a2-check';

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

type WorkspaceState = {
  revision: number;
  /** Once set, the root resolves to `movedRoot` after `realResolves` more resolutions (and stays moved). */
  move: { movedRoot: string; realResolves: number } | null;
};

function workspaceBindings(directory: string, state: WorkspaceState): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== projectId || requested.workspaceId !== workspaceId) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      if (state.move !== null) {
        if (state.move.realResolves === 0) return { status: 'ready', value: { root: state.move.movedRoot, workspaceRevision: state.revision } };
        state.move.realResolves -= 1;
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: state.revision } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 'a2-chain-host', permissionRevision: 'a2-chain-grant-1', allowsRead: () => true } };
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
        configurationRevision: 'a2-chain-host-config@1',
        model: { configuration: { revision: 'a2-chain-host-config@1', provider: 'deepseek', model: 'a2-chain-scripted',
          baseUrl: 'http://127.0.0.1' },
        client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
          tokenizer: 'a2-chain-counter' }) } },
        budget: runtimeBudget,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex('A2 chain trusted static role guidance') } : null,
        tools: ['read'], writeScope: [], skills: { resourceRoot: fileURLToPath(new URL('../../vendor/coding-agent/resources/skills',
          import.meta.url)), enabledIds: [] },
        systemInstruction: 'A2 chain trusted static role guidance', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

const TASKS: PlanRevisionDraft['tasks'] = [
  { taskId: 'work-1', title: 'First ordinary work', requirementLevel: 'required', taskKind: 'work',
    disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
  { taskId: 'work-2', title: 'Second ordinary work', requirementLevel: 'required', taskKind: 'work',
    disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
  { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
    disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
];

function planDraft(): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'a2-chain-plan', planRevision: 1, goalId: goalRef.goalId, stages: [], tasks: TASKS,
    assignments: [
      { taskId: 'work-1', role: 'builder', instruction: 'Do the first ordinary work' },
      { taskId: 'work-2', role: 'builder', instruction: 'Do the second ordinary work' },
    ],
    obligations: [{ obligationId: 'a2-chain-obligation', title: 'Deliver the work', requirementLevel: 'required',
      taskIds: ['work-1', 'work-2', 'goal-gate'],
      verificationRequirements: [{ requirementId: 'a2-chain-static', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

type Environment = {
  platform: Platform;
  scripted: ReturnType<typeof createScriptedModel>;
  workspaceRoot: string;
  workspace: WorkspaceState;
  checks: TrustedCheckConfiguration;
};

type EnvironmentOptions = {
  command: string;
  timeoutMs?: number;
  replies?: number;
  /** Runs inside the model stream before reply `index`, while the work Run is in the Kernel. */
  beforeReply?: (index: number) => Promise<void>;
};

async function openEnvironment(options: EnvironmentOptions): Promise<Environment> {
  const directory = await mkdtemp(join(tmpdir(), 'next-a2-chain-'));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-a2-chain-source-'));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), 'A2 chain registered workspace source\n');
  const state: WorkspaceState = { revision: 1, move: null };
  const check = { command: options.command, timeoutMs: options.timeoutMs };
  const scripted = createScriptedModel(Array.from({ length: options.replies ?? 2 }, (_, index) => ({ kind: 'text' as const,
    text: `A2 chain work result ${index + 1}` })), async (_request, index) => { await options.beforeReply?.(index); });
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'a2-chain-checks-1', workspace: workspaceRef, executor: hostActor, permissionRevision: 'a2-chain-grant-1',
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: CHECK_ID, kind: 'static', command: check.command, cwd: '.', timeoutMs: check.timeoutMs ?? 60_000,
      taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'a2-chain-consumer',
    bindings: [{ workspace: scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: workspaceBindings(workspaceRoot, state), now: () => AT,
    kernelStores: { entries: [{ adapterId: 'a2-chain-kernel', storeKey: 'a2-chain-kernel-store',
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
    input: { policyId: 'a2-chain-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'a2-policy-active',
    expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'a2-baseline',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { baselineId: 'a2-baseline', description: 'The A2 chain module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: 'a2-chain' }, name: 'A2 chain',
        responsibility: 'Verify work', paths: ['src'], interfaces: [] }] } } })).toMatchObject({ status: 'committed' });
  expect(await platform.goals.createGoal(host, { meta: { requestId: 'a2-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Verify work through one round chain per subject' } }))
    .toMatchObject({ status: 'committed' });
  const proposed = await platform.plans.proposePlan(host, { meta: { requestId: 'a2-plan-propose', expected: [] },
    input: { goalRef, basedOn: null, draft: planDraft(), reason: { text: 'Initial A2 chain plan', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error('Plan proposal failed');
  const applied = await platform.plans.applyPlanChange(host, { meta: { requestId: 'a2-plan-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');
  return { platform, scripted, workspaceRoot, workspace: state, checks };
}

/** A real W16 future-only adoption that adds one unrelated plan_only node; the existing tasks keep their definitions. */
async function adoptUnrelatedFuture(platform: Platform, suffix: string): Promise<PlanRevisionSnapshot> {
  const graph = await platform.plans.queryTaskGraph(ctx(), { goalRef });
  const goal = await platform.plans.queryGoal(ctx(), goalRef);
  if (graph.status !== 'ready' || goal.status !== 'ready') throw new Error('the Goal and its graph must be readable');
  const plan = graph.value.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `a2-chain-plan-${suffix}`, planRevision: plan.planRevision + 1, goalId: goalRef.goalId,
    stages: structuredClone(plan.stages), tasks: [...structuredClone(plan.tasks), { taskId: `future-${suffix}`,
      title: 'Unrelated future intent', requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending',
      scope: { kind: 'goal' }, executionIntent: 'plan_only' }],
    assignments: structuredClone(plan.assignments ?? []), obligations: structuredClone(plan.obligations),
    taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
    taskRelations: plan.schemaVersion === 2 ? structuredClone(plan.taskRelations ?? []) : [],
    inputRequirements: plan.schemaVersion === 2 ? structuredClone(plan.inputRequirements ?? []) : [],
  };
  const expected = [{ ref: goalRef, revision: goal.value.goal.revision }];
  const proposed = await platform.plans.proposePlan(ctx(), { meta: { requestId: `a2-future-${suffix}-propose`, expected },
    input: { goalRef, basedOn: plan.ref, draft, reason: { text: 'An unrelated future-only edit', sources: [] } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) throw new Error(`future proposal failed: ${JSON.stringify(proposed)}`);
  const applied = await platform.plans.applyPlanChange(ctx(), { meta: { requestId: `a2-future-${suffix}-apply`, expected },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`future adoption failed: ${JSON.stringify(applied)}`);
  return applied.value;
}

const select = (flowId: string, taskId?: string): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work', ...(taskId === undefined ? {} : { taskId }) });
type Perform = Extract<WorkflowAdvanceInput, { kind: 'perform' }>;
const performs = (kind: WorkflowOperation['kind']) => (input: WorkflowAdvanceInput): boolean =>
  input.kind === 'perform' && input.operation.kind === kind;

type Driven = { stopped: Perform | null; state: string; reason: string | null; receipts: WorkflowStepReceipt[] };
/** The Host drives every returned `next` until `stopBefore` names the next request (not performed) or the Workflow settles. */
async function drive(platform: Platform, first: WorkflowAdvanceInput,
  stopBefore: (input: WorkflowAdvanceInput) => boolean = () => false): Promise<Driven> {
  const receipts: WorkflowStepReceipt[] = [];
  let input = first;
  for (let guard = 0; guard < 64; guard += 1) {
    if (stopBefore(input)) return { stopped: input as Perform, state: 'stopped', reason: null, receipts };
    const result = await platform.workflow.advanceWork(ctx(), input);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    if (result.value.receipt !== null) receipts.push(result.value.receipt);
    if (result.value.state === 'completed' || result.value.next === null) {
      return { stopped: null, state: result.value.state, reason: result.value.reason, receipts };
    }
    input = result.value.next;
  }
  throw new Error('the Workflow did not settle within the step guard');
}

async function taskRow(platform: Platform, taskId: string) {
  const graph = await platform.plans.queryTaskGraph(ctx(), { goalRef });
  if (graph.status !== 'ready') throw new Error('the task graph must be readable');
  const row = graph.value.tasks.find(candidate => candidate.ref.taskId === taskId);
  if (row === undefined) throw new Error(`task ${taskId} is not in the graph`);
  return row;
}

function openedRound(receipts: readonly WorkflowStepReceipt[]): RoundSnapshot {
  const receipt = receipts.at(-1);
  if (receipt?.kind !== 'open_checks' || receipt.result.status !== 'committed') throw new Error('the open must commit');
  return receipt.result.value;
}

it('VR-01..VR-08: one chain per subject Run, the projection follows its head, and an applicable FAIL fails the Task', async () => {
  const { platform, scripted } = await openEnvironment({ command: 'exit 1' });
  // 1. The work Run completes; before its round opens the Task waits for verification (P11).
  const beforeOpen = await drive(platform, select('a2-chain-flow'), performs('open_checks'));
  const open = beforeOpen.stopped;
  if (open === null || open.operation.kind !== 'open_checks') throw new Error('the Workflow must reach the open');
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'verifying',
    phaseCause: { code: 'awaiting_verification' } });

  // 2. VR-01: the root of the subject chain; while it is open the Task is verifying (P12).
  const opened = await drive(platform, open, performs('run_check'));
  const round = openedRound(opened.receipts);
  expect(round.chain).toEqual({ schemaVersion: 1, ordinal: 1, predecessorRoundRef: null, predecessorRevision: null,
    supersededEvidenceIds: [], basisDigests: [], autoCount: 0, reverify: null });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'verifying',
    phaseCause: { code: 'verification_running' } });

  // 3. VD-1: the same subject Run takes no second root, whatever the request; the head pin is returned.
  const openInput = open.operation.request.input;
  expect(await platform.evidence.openVerification(ctx(), { input: openInput, meta: { requestId: 'a2-second-open', expected: [] } }))
    .toMatchObject({ status: 'rejected', code: 'busy', current: [{ ref: round.ref, revision: round.revision }] });
  // VD-14 / VD-7: the head reads by subject, without a Plan.
  const subject = { subject: openInput.subject, subjectRunRef: openInput.subjectRunRef };
  expect(await platform.evidence.queryRoundChainHead!(ctx(), subject)).toEqual({ status: 'ready', value: round });
  expect(await platform.evidence.queryOriginalVerification!(ctx(), subject)).toEqual({ status: 'ready', value: round });

  // 4. D-2: the registered check exits 1, the round finalizes FAIL and the Task is failed (P7).
  if (opened.stopped === null) throw new Error('the open must continue with the check');
  // §15.2 5.8 result mapping: the non-PASS finalize goes back to the selection; the Host stops there (the
  // Goal-level selection would go on with work-2).
  const checked = await drive(platform, opened.stopped, input => input.kind === 'select_work');
  expect(checked.state).toBe('stopped');
  const finalize = checked.receipts.find(receipt => receipt.kind === 'finalize_checks');
  expect(finalize).toMatchObject({ result: { status: 'committed', value: { outcome: 'FAIL', applicable: false, gaps: [] } } });
  const failedRound = await platform.evidence.readVerification(ctx(), round.ref);
  expect(failedRound).toMatchObject({ status: 'ready', value: { status: 'finalized', outcome: 'FAIL',
    checks: [{ checkId: CHECK_ID, phase: 'finished', outcome: 'FAIL' }] } });
  if (failedRound.status !== 'ready') throw new Error('the round must be readable');
  expect('incompleteCause' in failedRound.value.checks[0]!).toBe(false);
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'failed',
    phaseCause: { code: 'check_failed', detail: { checkIds: [CHECK_ID] } } });

  // 5. VD-2: a claim never lands on the finalized round.
  expect(await platform.evidence.submitEvidence(ctx(), { input: { roundRef: round.ref, claim: 'late claim' },
    meta: { requestId: 'a2-late-claim', expected: [] } })).toMatchObject({ status: 'rejected', code: 'busy' });
  // TASK-14 (§4.4): the failed Task is not completed from any round.
  const goal = await platform.plans.queryGoal(ctx(), goalRef);
  if (goal.status !== 'ready' || goal.value.goal.activePlanRevision === null) throw new Error('the Goal must be readable');
  expect(await platform.goals.completeTask(ctx(), { input: { taskRef: round.subject, planRef: goal.value.goal.activePlanRevision,
    roundRef: round.ref }, meta: { requestId: 'a2-complete-failed', expected: [{ ref: goalRef, revision: goal.value.goal.revision },
    { ref: { aggregateType: 'TaskReduction', projectId, goalId: goalRef.goalId, taskId: 'work-1' }, revision: 0 }] } }))
    .toMatchObject({ status: 'rejected', code: 'incomplete', reason: 'the task is failed; a PASS round cannot complete it' });
  expect(scripted.calls(), 'one model call produced the one work Run').toBe(1);
});

it('VD-7: future adoptions before the open and before the completion never strand the Task', async () => {
  const { platform, scripted } = await openEnvironment({ command: 'echo A2_CHAIN_OK' });
  // work-1: the Run completes, then an unrelated future adoption moves the Goal to P2.
  const beforeOpen = await drive(platform, select('a2-vd7-flow-1', 'work-1'), performs('open_checks'));
  const staleOpen = beforeOpen.stopped;
  if (staleOpen === null || staleOpen.operation.kind !== 'open_checks') throw new Error('the Workflow must reach the open');
  const p2 = await adoptUnrelatedFuture(platform, 'p2');
  // The open built before the adoption names the old Plan and is refused (VR-01 keeps `source_stale`).
  const refused = await drive(platform, staleOpen);
  expect(refused.receipts[0]).toMatchObject({ kind: 'open_checks', result: { status: 'rejected', code: 'source_stale' } });
  // A new selection opens the root under P2 and completes the Task under P2.
  const resumed = await drive(platform, select('a2-vd7-flow-2', 'work-1'), performs('complete_task'));
  const complete1 = resumed.stopped;
  if (complete1 === null || complete1.operation.kind !== 'complete_task') throw new Error('work-1 must reach its completion');
  expect(openedRound(resumed.receipts.filter(receipt => receipt.kind === 'open_checks')).adoptedPlanRef).toEqual(p2.ref);
  expect(complete1.operation.request.input.planRef).toEqual(p2.ref);
  expect(await drive(platform, complete1)).toMatchObject({ state: 'completed' });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'satisfied' });

  // work-2: the round opens and finalizes PASS under P2, then a second adoption moves the Goal to P3.
  const beforeComplete = await drive(platform, select('a2-vd7-flow-3', 'work-2'), performs('complete_task'));
  const staleComplete = beforeComplete.stopped;
  if (staleComplete === null || staleComplete.operation.kind !== 'complete_task') throw new Error('work-2 must reach its completion');
  const round2 = openedRound(beforeComplete.receipts.filter(receipt => receipt.kind === 'open_checks'));
  expect(round2.adoptedPlanRef).toEqual(p2.ref);
  const p3 = await adoptUnrelatedFuture(platform, 'p3');
  // The stale completion pins the old Goal revision and Plan; the chain head completes under P3.
  expect((await drive(platform, staleComplete)).receipts[0]).toMatchObject({ kind: 'complete_task',
    result: { status: 'rejected', code: 'revision_conflict' } });
  const again = await drive(platform, select('a2-vd7-flow-4', 'work-2'), performs('complete_task'));
  const complete2 = again.stopped;
  if (complete2 === null || complete2.operation.kind !== 'complete_task') throw new Error('work-2 must reach its completion again');
  expect(complete2.operation.request.input).toMatchObject({ planRef: p3.ref, roundRef: round2.ref });
  expect(await drive(platform, complete2)).toMatchObject({ state: 'completed' });
  expect(await taskRow(platform, 'work-2')).toMatchObject({ effectivePhase: 'satisfied' });
  expect(scripted.calls(), 'the adoptions add no model call').toBe(2);
});

it('VD-7: an adoption while the Run is in the Kernel, and one before the finalize: the start and finalize paths use the current Plan', async () => {
  const holder: { platform?: Platform; p2?: PlanRevisionSnapshot } = {};
  const { platform, scripted } = await openEnvironment({ command: 'echo A2_CHAIN_OK', beforeReply: async index => {
    // work-1's Run has entered the Kernel: a future-only adoption moves the Goal to P2 before the Run ends.
    if (index === 0) holder.p2 = await adoptUnrelatedFuture(holder.platform!, 'p2');
  } });
  holder.platform = platform;
  // work-1 (`start`): the Run ends after the adoption and its round opens under P2, with no new selection.
  const toOpen = await drive(platform, select('a2-vd7-start-flow', 'work-1'), performs('open_checks'));
  const open1 = toOpen.stopped;
  if (open1 === null || open1.operation.kind !== 'open_checks' || holder.p2 === undefined) {
    throw new Error('work-1 must reach its open after the adoption');
  }
  expect(toOpen.receipts.at(-1)).toMatchObject({ kind: 'start', result: { status: 'ready' } });
  expect(open1.operation.request.input.planRef).toEqual(holder.p2.ref);
  expect(await drive(platform, open1)).toMatchObject({ state: 'completed' });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'satisfied' });

  // work-2 (`finalize_checks`): its checks ran under P2, then an adoption moves the Goal to P3 before the finalize.
  const toFinalize = await drive(platform, select('a2-vd7-finalize-flow', 'work-2'), performs('finalize_checks'));
  if (toFinalize.stopped === null) throw new Error('work-2 must reach its finalize');
  const round2 = openedRound(toFinalize.receipts.filter(receipt => receipt.kind === 'open_checks'));
  expect(round2.adoptedPlanRef).toEqual(holder.p2.ref);
  const p3 = await adoptUnrelatedFuture(platform, 'p3');
  const toComplete = await drive(platform, toFinalize.stopped, performs('complete_task'));
  expect(toComplete.receipts[0]).toMatchObject({ kind: 'finalize_checks',
    result: { status: 'committed', value: { outcome: 'PASS', applicable: true } } });
  const complete2 = toComplete.stopped;
  if (complete2 === null || complete2.operation.kind !== 'complete_task') throw new Error('the finalize must lead to the completion');
  expect(complete2.operation.request.input).toMatchObject({ planRef: p3.ref, roundRef: round2.ref });
  expect(await drive(platform, complete2)).toMatchObject({ state: 'completed' });
  expect(await taskRow(platform, 'work-2')).toMatchObject({ effectivePhase: 'satisfied' });
  expect(scripted.calls(), 'the adoptions add no model call').toBe(2);
});

it('VR-05 (VD-6): a root moved after begin returns the check to pending; the next begin ends the attempts (frozen_root_changed)', async () => {
  const { platform, scripted, workspace } = await openEnvironment({ command: 'echo A2_CHAIN_OK' });
  const toCheck = await drive(platform, select('a2-vr05-flow', 'work-1'), performs('run_check'));
  if (toCheck.stopped === null || toCheck.stopped.operation.kind !== 'run_check') throw new Error('the Workflow must reach the check');
  const roundRef = toCheck.stopped.operation.request.input.roundRef;
  const movedRoot = await mkdtemp(join(tmpdir(), 'next-a2-chain-moved-'));
  directories.push(movedRoot);
  await writeFile(join(movedRoot, 'source.txt'), 'A2 chain source under another root\n');
  // The runner resolves the root before the begin and the begin resolves it once; the runner's own
  // re-check after the begin is the first to see the moved root.
  workspace.move = { movedRoot, realResolves: 2 };
  const abandoned = await platform.workflow.advanceWork(ctx(), toCheck.stopped);
  expect(abandoned).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null, receipt: { kind: 'run_check',
    result: { status: 'rejected', code: 'unavailable', reason: 'the workspace root changed after begin; no process was started' } } } });
  expect(await platform.evidence.readVerification(ctx(), roundRef)).toMatchObject({ status: 'ready', value: { status: 'open',
    checks: [{ checkId: CHECK_ID, phase: 'pending', invocationId: null }] } });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'verifying', phaseCause: { code: 'verification_running' } });
  // The root stays moved: the next begin compares it with the frozen root and ends the round's attempts (VD-8).
  const next = await drive(platform, select('a2-vr05-flow-2', 'work-1'), performs('reverify_round'));
  expect(next.receipts.find(receipt => receipt.kind === 'run_check')).toMatchObject({ result: { status: 'rejected',
    reason: expect.stringMatching(/^frozen_root_changed: /) } });
  expect(next.receipts.find(receipt => receipt.kind === 'finalize_checks')).toMatchObject({ result: { status: 'committed',
    value: { outcome: 'INCONCLUSIVE', gaps: expect.arrayContaining([expect.objectContaining({ code: 'pending_check' })]) } } });
  // §15.2 5.9 (AV-7d): the next selection re-verifies the INCONCLUSIVE head automatically (a successor round).
  expect(next.stopped).toMatchObject({ operation: { kind: 'reverify_round', request: { input: { predecessorRoundRef: roundRef,
    reason: 'auto-reverify:check_incomplete#1' } } } });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'round_inconclusive' } });
  expect(scripted.calls()).toBe(1);
});

it('VD-15: a gate has one chain anchored on its first producer, and the Workflow follows its head', async () => {
  const { platform, scripted } = await openEnvironment({ command: 'echo A2_CHAIN_OK' });
  const isGateCheck = (input: WorkflowAdvanceInput): boolean => input.kind === 'perform' && input.operation.kind === 'run_check'
    && input.operation.request.input.roundRef.taskId === 'goal-gate';
  // Both works complete; the gate's root opens on the first satisfied producer.
  const toGate = await drive(platform, select('a2-gate-flow'), isGateCheck);
  if (toGate.stopped === null) throw new Error('the Workflow must reach the gate check');
  const gate = { projectId, goalId: goalRef.goalId, taskId: 'goal-gate' };
  const head = await platform.evidence.queryRoundChainHead!(ctx(), { subject: gate, subjectRunRef: null });
  if (head.status !== 'ready') throw new Error(`the gate chain head must be readable: ${JSON.stringify(head)}`);
  expect(head.value).toMatchObject({ status: 'open', chain: { ordinal: 1 } });
  const work1 = await taskRow(platform, 'work-1');
  const work2 = await taskRow(platform, 'work-2');
  expect(head.value.subjectRunRef).toEqual(work1.execution);
  // Another producer cannot open a second gate chain (the gate slot has no runId).
  const graph = await platform.plans.queryTaskGraph(ctx(), { goalRef });
  if (graph.status !== 'ready' || work2.execution === null) throw new Error('the graph and work-2 Run must be readable');
  expect(await platform.evidence.openVerification(ctx(), { input: { subjectRunRef: work2.execution, subject: gate,
    planRef: graph.value.plan.ref, gateSubject: 'goal' }, meta: { requestId: 'a2-gate-second-producer', expected: [] } }))
    .toMatchObject({ status: 'rejected', code: 'busy', current: [{ ref: head.value.ref, revision: head.value.revision }] });
  // A fresh selection follows the open head (its pending check), never a new open.
  const reselected = await platform.workflow.advanceWork(ctx(), select('a2-gate-flow-2'));
  expect(reselected).toMatchObject({ status: 'ready', value: { state: 'advance', next: { kind: 'perform',
    operation: { kind: 'run_check', request: { input: { roundRef: head.value.ref } } } } } });
  // The gate passes and the Goal completes from the one chain.
  expect(await drive(platform, select('a2-gate-flow-3'))).toMatchObject({ state: 'completed' });
  expect(await taskRow(platform, 'goal-gate')).toMatchObject({ effectivePhase: 'satisfied' });
  expect(await platform.evidence.queryRoundChainHead!(ctx(), { subject: gate, subjectRunRef: null }))
    .toMatchObject({ status: 'ready', value: { ref: head.value.ref, status: 'finalized', outcome: 'PASS' } });
  expect(scripted.calls()).toBe(2);
});

it('VD-8: a source changed after the open ends the check attempts and the round finalizes INCONCLUSIVE', async () => {
  const { platform, scripted, workspaceRoot } = await openEnvironment({ command: 'echo A2_CHAIN_OK' });
  const toCheck = await drive(platform, select('a2-vd8-flow', 'work-1'), performs('run_check'));
  if (toCheck.stopped === null || toCheck.stopped.operation.kind !== 'run_check') throw new Error('the Workflow must reach the check');
  const roundRef = toCheck.stopped.operation.request.input.roundRef;
  // The workspace changes after the round froze its source.
  await writeFile(join(workspaceRoot, 'source.txt'), 'A2 chain source changed after the open\n');
  const refused = await platform.workflow.advanceWork(ctx(), toCheck.stopped);
  expect(refused).toMatchObject({ status: 'ready', value: { state: 'advance',
    receipt: { kind: 'run_check', result: { status: 'rejected', code: 'source_stale',
      reason: expect.stringMatching(/^frozen_source_changed: /) } },
    next: { kind: 'perform', operation: { kind: 'finalize_checks', request: { input: { roundRef } } } } } });
  if (refused.status !== 'ready' || refused.value.next === null) throw new Error('the Workflow must finalize');
  const finalized = await platform.workflow.advanceWork(ctx(), refused.value.next);
  // §15.2 5.8 result mapping: a non-PASS finalize goes back to the selection.
  expect(finalized).toMatchObject({ status: 'ready', value: { state: 'advance',
    next: { kind: 'select_work', flowId: 'a2-vd8-flow', taskId: 'work-1' }, receipt: { kind: 'finalize_checks',
    result: { status: 'committed', value: { outcome: 'INCONCLUSIVE', gaps: [{ code: 'pending_check' }, { code: 'source_changed' }] } } } } });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'blocked',
    phaseCause: { code: 'round_inconclusive', detail: { gapCodes: ['pending_check', 'source_changed'] } } });
  // No retry loop: the next selection does not begin the check again; §15.2 5.9 (AV-7d): it opens a successor
  // round as the automation instead (VD-8: "Workflow 自动重验").
  const next = await platform.workflow.advanceWork(ctx(), select('a2-vd8-flow-2', 'work-1'));
  expect(next).toMatchObject({ status: 'ready', value: { state: 'advance', next: { kind: 'perform', operation: {
    kind: 'reverify_round', request: { input: { predecessorRoundRef: roundRef, reason: 'auto-reverify:check_incomplete#1' } } } } } });
  expect(scripted.calls()).toBe(1);
});
