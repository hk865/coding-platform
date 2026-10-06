/**
 * A.2 step 5.9 part 2 through the public composition root on SQLite: the gate's own round chain (C5;
 * docs/refactor/STATE-MACHINES-SPEC.md §15.2 5.9, §4 P20, TASK-15, TASK-30, the GV table, §2 GOAL-27/30
 * gate reasons, §9 VD-11, VD-15, §13.7 points 5 and 8; the C5-gate-fix path of §15.3).
 *
 * The real Workflow (`workflow.advanceWork`), a real Kernel with the scripted model, a real ProcessSandbox
 * for the registered check and one SQLite ledger. The work Task passes; the workspace is broken before the
 * gate's root round opens, so the gate check FAILs:
 *
 * 1. The gate projects from its own chain head (P20 `failed/check_failed`, `gate`, `ordinal`) and its
 *    `TaskRow.failure` comes from that head (anchored producer Run, `check_failed`). Its verdict GV-9 makes
 *    the Workflow try one cheap automatic re-verification (`reverify_round{onlyIfSourceChanged}` as the
 *    platform automation); the source did not change, so the owner commits `source_unchanged` and the
 *    verdict turns `stopped/gate_needs_fix` (GV-8): the Workflow waits with that code and the Goal shows
 *    NEEDS_DECISION/gate_needs_fix with the failing check and its report.
 * 2. An operator adopts a required fix Task through the existing plan evolution (W16), with the gate
 *    round's report in `PlanChangeReason.sources`: the gate is `gate_fix_in_progress` (GV-5).
 * 3. The fix Task's Run repairs the file (during its Turn); its own round passes; that Run's end makes the
 *    refusal stale, so the Workflow re-verifies the gate again (refusal pin @1, a new request): the source
 *    changed, the successor opens on the anchored producer (GAP-51) and the Goal shows `gate_verifying`;
 *    it passes, the gate completes from P20 `verifying(awaiting_completion)` (TASK-15) and the Goal
 *    completes. Two model calls in all: a re-verification builds no Run.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';

const AT = '2026-10-06T00:00:00.000Z';
const projectId = 'a2-gate-project';
const workspaceId = 'a2-gate-workspace';
const scope = { projectId, workspaceId };
const hostActor = { kind: 'human' as const, id: 'a2-gate-host' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'a2-gate-goal' };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'a2-gate-policy', revision: 1 };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'a2-gate-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const runtimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const CHECK_ID = 'a2-gate-check';
const GATE = 'goal-gate';
const MARKER = 'A2_GATE_OK';

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
      return { status: 'ready', value: { subjectKey: 'a2-gate-host', permissionRevision: 'a2-gate-grant-1', allowsRead: () => true } };
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
        configurationRevision: 'a2-gate-host-config@1',
        model: { configuration: { revision: 'a2-gate-host-config@1', provider: 'deepseek', model: 'a2-gate-scripted',
          baseUrl: 'http://127.0.0.1' },
        client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
          tokenizer: 'a2-gate-counter' }) } },
        budget: runtimeBudget,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex('A2 gate trusted static role guidance') } : null,
        tools: ['read'], writeScope: [], skills: { resourceRoot: fileURLToPath(new URL('../../vendor/coding-agent/resources/skills',
          import.meta.url)), enabledIds: [] },
        systemInstruction: 'A2 gate trusted static role guidance', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

const OBLIGATION = { obligationId: 'a2-gate-obligation', title: 'Deliver the work', requirementLevel: 'required' as const,
  verificationRequirements: [{ requirementId: 'a2-gate-static', requirementLevel: 'required' as const, kind: 'static',
    description: 'Registered static command check' }] };

function planDraft(): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'a2-gate-plan', planRevision: 1, goalId: goalRef.goalId, stages: [],
    tasks: [
      { taskId: 'work-1', title: 'The ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: GATE, title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'work-1', role: 'builder', instruction: 'Do the ordinary work' }],
    obligations: [{ ...OBLIGATION, taskIds: ['work-1', GATE] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

function checksConfiguration(): TrustedCheckConfiguration {
  // The check passes only while source.txt carries the marker (a sandboxed node process).
  const command = `node -e "if(!require('node:fs').readFileSync('source.txt','utf8').includes('${MARKER}'))process.exit(3)"`;
  return { configurationRevision: 'a2-gate-checks-1', workspace: workspaceRef, executor: hostActor,
    permissionRevision: 'a2-gate-grant-1', sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
    deniedPrefixes: ['.git'], checks: [{ checkId: CHECK_ID, kind: 'static', command, cwd: '.', timeoutMs: 60_000, taskIds: 'all' }] };
}

type Environment = { platform: Platform; scripted: ReturnType<typeof createScriptedModel>; workspaceRoot: string };

/** `duringTurn(index)` runs inside model call `index`, before the scripted answer. */
async function openEnvironment(duringTurn: (index: number, workspaceRoot: string) => Promise<void>): Promise<Environment> {
  const directory = await mkdtemp(join(tmpdir(), 'next-a2-gate-'));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-a2-gate-source-'));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), `${MARKER}: the delivered work\n`);
  const state = { revision: 1 };
  const scripted = createScriptedModel([{ kind: 'text' as const, text: 'A2 gate: the work is done' },
    { kind: 'text' as const, text: 'A2 gate: the fix is done' }], async (_request, index) => duringTurn(index, workspaceRoot));
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'a2-gate-consumer',
    bindings: [{ workspace: scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: workspaceBindings(workspaceRoot, state), now: () => AT,
    kernelStores: { entries: [{ adapterId: 'a2-gate-kernel', storeKey: 'a2-gate-kernel-store',
      workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: runtimeHost(scripted), checks: checksConfiguration(), workflow,
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
    input: { policyId: 'a2-gate-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'a2-policy-active',
    expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'a2-baseline',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { baselineId: 'a2-baseline', description: 'The A2 gate module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: 'a2-gate' }, name: 'A2 gate',
        responsibility: 'Verify work', paths: ['src'], interfaces: [] }] } } })).toMatchObject({ status: 'committed' });
  expect(await platform.goals.createGoal(host, { meta: { requestId: 'a2-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Accept the work at the gate, after a fix' } }))
    .toMatchObject({ status: 'committed' });
  const proposed = await platform.plans.proposePlan(host, { meta: { requestId: 'a2-plan-propose', expected: [] },
    input: { goalRef, basedOn: null, draft: planDraft(), reason: { text: 'Initial A2 gate plan', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error('Plan proposal failed');
  const applied = await platform.plans.applyPlanChange(host, { meta: { requestId: 'a2-plan-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');
  return { platform, scripted, workspaceRoot };
}

const select = (flowId: string): WorkflowAdvanceInput => ({ schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work' });
type Perform = Extract<WorkflowAdvanceInput, { kind: 'perform' }>;
const isGateStep = (kind: 'open_checks' | 'run_check') => (input: WorkflowAdvanceInput): boolean => {
  if (input.kind !== 'perform' || input.operation.kind !== kind) return false;
  return input.operation.kind === 'open_checks' ? input.operation.request.input.subject.taskId === GATE
    : input.operation.kind === 'run_check' && input.operation.request.input.roundRef.taskId === GATE;
};

type Driven = { stopped: Perform | null; state: string; reason: string | null; receipts: WorkflowStepReceipt[] };
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

async function goalDisplay(platform: Platform) {
  const read = await platform.plans.queryGoalDisplay!(ctx(), { goalRef });
  if (read.status !== 'ready') throw new Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
  return read.value.display;
}

/** W16: an operator adopts a required fix Task carrying the gate's obligation, with the report as a source. */
async function adoptFixTask(platform: Platform, reportRef: unknown): Promise<void> {
  const graph = await platform.plans.queryTaskGraph(ctx(), { goalRef });
  const goal = await platform.plans.queryGoal(ctx(), goalRef);
  if (graph.status !== 'ready' || goal.status !== 'ready') throw new Error('the Goal and its graph must be readable');
  const plan = graph.value.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 'a2-gate-plan-fix', planRevision: plan.planRevision + 1, goalId: goalRef.goalId,
    stages: [], tasks: [...structuredClone(plan.tasks), { taskId: 'fix-1', title: 'Repair the gate failure',
      requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
      executionIntent: 'request_execution' }],
    assignments: [...structuredClone(plan.assignments ?? []), { taskId: 'fix-1', role: 'builder',
      instruction: `Make the failed check ${CHECK_ID} pass` }],
    obligations: [{ ...OBLIGATION, taskIds: ['work-1', GATE, 'fix-1'] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
  const expected = [{ ref: goalRef, revision: goal.value.goal.revision }];
  const proposed = await platform.plans.proposePlan(ctx(), { meta: { requestId: 'a2-gate-fix-propose', expected },
    input: { goalRef, basedOn: plan.ref, draft, reason: { text: `Fix the failed gate check ${CHECK_ID}`,
      sources: [reportRef as never] } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) throw new Error(`fix proposal failed: ${JSON.stringify(proposed)}`);
  const applied = await platform.plans.applyPlanChange(ctx(), { meta: { requestId: 'a2-gate-fix-apply', expected },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`fix adoption failed: ${JSON.stringify(applied)}`);
}

it('C5 gate fix (§15.2 5.9, GV-8/GV-9, P20, TASK-15): a FAILed gate stops as gate_needs_fix, a fix Task repairs it, and the automatic re-verification completes the Goal', async () => {
  const { platform, scripted, workspaceRoot } = await openEnvironment(async (index, root) => {
    // Model call 1 is the fix Task's Run: it repairs the file the gate check reads.
    if (index === 1) await writeFile(join(root, 'source.txt'), `${MARKER}: repaired by the fix Task\n`);
  });

  // The work passes and completes; the gate's root is about to open on its Run.
  const toGate = await drive(platform, select('a2-gate-flow'), isGateStep('open_checks'));
  if (toGate.stopped === null) throw new Error('the Workflow must reach the gate open');
  const work1 = await taskRow(platform, 'work-1');
  expect(work1).toMatchObject({ effectivePhase: 'satisfied' });
  expect(await taskRow(platform, GATE)).toMatchObject({ effectivePhase: 'pending' });
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'RUNNING',
    causes: expect.arrayContaining([{ code: 'awaiting_gate', gateTaskId: GATE }]) });
  // The workspace breaks before the gate round captures it, so the gate check FAILs.
  await writeFile(join(workspaceRoot, 'source.txt'), 'the delivered work, broken later\n');
  const failed = await drive(platform, toGate.stopped);

  // GV-9 → one automatic re-verification with onlyIfSourceChanged; the source did not change: source_unchanged.
  const finalize = failed.receipts.find(receipt => receipt.kind === 'finalize_checks');
  if (finalize?.kind !== 'finalize_checks' || finalize.result.status !== 'committed') throw new Error('the gate round must finalize');
  expect(finalize.result.value.outcome).toBe('FAIL');
  const r1 = finalize.result.value.snapshot;
  const firstReverify = failed.receipts.find(receipt => receipt.kind === 'reverify_round');
  expect(firstReverify).toMatchObject({ kind: 'reverify_round', result: { status: 'committed', value: { kind: 'refused',
    refusal: { revision: 1, code: 'source_unchanged', failureClass: 'check_failed', requestedBy: WORKFLOW_AUTOMATION_ACTOR,
      configurationRevision: null, goalEndedRunsAtRefusal: 1 } } } });
  // GV-8: the Workflow stops on the gate with the stop reason as its code.
  expect(failed).toMatchObject({ state: 'waiting' });
  expect(failed.reason).toMatch(/^gate_needs_fix: the goal gate goal-gate /);
  const reportRef = r1.checks[0]!.reportRef;
  expect(reportRef).not.toBeNull();
  const failingChecks = [{ checkId: CHECK_ID, phase: 'finished', outcome: 'FAIL', cause: null, reportRef }];
  // P20 and the gate's TaskRow.failure come from its own chain head, anchored on work-1's Run.
  expect(await taskRow(platform, GATE)).toMatchObject({ effectivePhase: 'failed',
    phaseCause: { code: 'check_failed', detail: { gate: true, ordinal: 1, checkIds: [CHECK_ID] } },
    failure: { subjectKind: 'gate', runRef: work1.execution, failureClass: 'check_failed', notReworkableCause: null,
      round: { roundRef: r1.ref, revision: r1.revision, status: 'finalized', outcome: 'FAIL', ordinal: 1, autoCount: 0, failingChecks },
      requeueActors: [], reverifyActors: ['human', 'system', 'agent'],
      automation: { lastReverifyRefusal: { code: 'source_unchanged', revision: 1, stale: false },
        verdict: { kind: 'stopped', reason: 'gate_needs_fix', detail: { operation: 'reverify', failingChecks } } } } });
  // GOAL-30: nothing automatic is left, so the Goal needs a decision, naming the failing check and its report.
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'gate_needs_fix', taskId: GATE, detail: { operation: 'reverify', failingChecks } } });

  // An operator adds a required fix Task (W16) with the gate round's report as a source: GV-5.
  await adoptFixTask(platform, reportRef);
  expect(await taskRow(platform, GATE)).toMatchObject({ effectivePhase: 'failed',
    failure: { automation: { verdict: { kind: 'none' } } } });
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'RUNNING',
    causes: expect.arrayContaining([{ code: 'gate_fix_in_progress', gateTaskId: GATE, failingChecks }]) });

  // The fix Task runs (its Turn repairs the file) and passes; its Run's end makes the refusal stale, so the gate is
  // re-verified again with the refusal pin @1: the source changed, so the successor opens on the anchored producer.
  const toSuccessorCheck = await drive(platform, select('a2-gate-flow-2'), isGateStep('run_check'));
  if (toSuccessorCheck.stopped === null) throw new Error('the Workflow must reach the successor gate check');
  expect(await taskRow(platform, 'fix-1')).toMatchObject({ effectivePhase: 'satisfied' });
  const reverified = toSuccessorCheck.receipts.find(receipt => receipt.kind === 'reverify_round');
  if (reverified?.kind !== 'reverify_round' || reverified.result.status !== 'committed'
    || reverified.result.value.kind !== 'reverified') throw new Error(`the gate must be re-verified: ${JSON.stringify(reverified)}`);
  const r2 = reverified.result.value.round;
  expect(r2).toMatchObject({ status: 'open', subject: { taskId: GATE }, subjectRunRef: work1.execution, executor: hostActor,
    chain: { ordinal: 2, predecessorRoundRef: r1.ref, autoCount: 1, reverify: { actorClass: 'system',
      requestedBy: WORKFLOW_AUTOMATION_ACTOR, failureClass: 'check_failed', exemption: 'none', sourceChanged: true,
      reason: 'auto-reverify:check_failed#1' } } });
  // TASK-30: the gate follows its open successor (P20 verifying, ordinal 2); GOAL-27 gate_verifying.
  expect(await taskRow(platform, GATE)).toMatchObject({ effectivePhase: 'verifying',
    phaseCause: { code: 'verification_running', detail: { gate: true, ordinal: 2, predecessorRoundRef: r1.ref } } });
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'RUNNING',
    causes: expect.arrayContaining([{ code: 'gate_verifying', gateTaskId: GATE }]) });

  const done = await drive(platform, toSuccessorCheck.stopped);
  expect(done.state).toBe('completed');
  expect(done.receipts.find(receipt => receipt.kind === 'finalize_checks')).toMatchObject({ result: { status: 'committed',
    value: { outcome: 'PASS', snapshot: { ref: r2.ref } } } });
  // TASK-15: the gate completes from its PASS head; R1's FAIL evidence left the fold with the chain.
  expect(done.receipts.find(receipt => receipt.kind === 'complete_task')).toMatchObject({ result: { status: 'committed',
    value: { phase: 'satisfied', completion: { roundRef: r2.ref } } } });
  expect(await taskRow(platform, GATE)).toMatchObject({ effectivePhase: 'satisfied' });
  expect(await goalDisplay(platform)).toMatchObject({ phase: 'COMPLETED' });
  // VR-15: the FAILed gate round and its report stay readable as they were.
  expect(await platform.evidence.readVerification(ctx(), r1.ref)).toMatchObject({ status: 'ready',
    value: { ref: r1.ref, status: 'finalized', outcome: 'FAIL', revision: r1.revision } });
  expect(scripted.calls()).toBe(2);
}, 180_000);
