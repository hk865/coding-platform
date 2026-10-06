/**
 * A.2 step 5.9 part 1 through the public composition root on SQLite
 * (docs/refactor/STATE-MACHINES-SPEC.md §9 VR-14/VR-15, VD-12, VD-13, §13.7;
 * §4 TASK-28 (reverify refusals), TASK-29, TD-8 `TaskRow.failure`; LA-4).
 *
 * The real Workflow (`workflow.advanceWork`), a real Kernel with the scripted
 * model, a real ProcessSandbox for the registered check and one SQLite ledger.
 * The work round finalizes INCONCLUSIVE because the workspace changed after it
 * froze its source (VD-8). Then, through `platform.evidence.reverifyRound`:
 *
 * 1. An operator opens the successor round (ordinal 2, `sourceChanged`); the
 *    Task follows it (TASK-29); the Workflow runs its check on the same Run,
 *    completes the Task, the gate and the Goal; the predecessor is unchanged;
 *    one model call in all (a successor round builds no Run).
 * 2. The policy refusals are committed values the read model shows: the cap
 *    refuses the platform automation (`registerAutomationPolicy`, limit 0);
 *    a configuration whose checks cover no requirement refuses even the
 *    operator (`verification_uncovered`, the configuration revision stored);
 *    registering a covering configuration makes that refusal stale on
 *    `TaskRow.failure` (LA-4, the read path's `configurationFor`), and the
 *    operator's next reverify opens the successor under it.
 * 3. Hard limit 3 (VR-14 step 5, I-17): an operator pauses the running Turn,
 *    which completes first (CTL-06, the pointer stays on the Run); the round
 *    finalizes INCONCLUSIVE; the platform automation's reverify is
 *    `forbidden` with nothing written, the operator's opens the successor.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { RoundSnapshot, TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkflowAdvanceInput, WorkflowOperation, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';

const AT = '2026-10-06T00:00:00.000Z';
const projectId = 'a2-reverify-project';
const workspaceId = 'a2-reverify-workspace';
const scope = { projectId, workspaceId };
const hostActor = { kind: 'human' as const, id: 'a2-reverify-host' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'a2-reverify-goal' };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'a2-reverify-policy', revision: 1 };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'a2-reverify-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const runtimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const CHECK_ID = 'a2-reverify-check';

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
const directories: string[] = [];
const platforms: Platform[] = [];
afterEach(async () => {
  for (const platform of platforms.splice(0)) await platform.close().catch(() => undefined);
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function ctx(actor: { kind: 'human' | 'system'; id: string } = hostActor): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
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
      return { status: 'ready', value: { subjectKey: 'a2-reverify-host', permissionRevision: 'a2-reverify-grant-1', allowsRead: () => true } };
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
        configurationRevision: 'a2-reverify-host-config@1',
        model: { configuration: { revision: 'a2-reverify-host-config@1', provider: 'deepseek', model: 'a2-reverify-scripted',
          baseUrl: 'http://127.0.0.1' },
        client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
          tokenizer: 'a2-reverify-counter' }) } },
        budget: runtimeBudget,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex('A2 reverify trusted static role guidance') } : null,
        tools: ['read'], writeScope: [], skills: { resourceRoot: fileURLToPath(new URL('../../vendor/coding-agent/resources/skills',
          import.meta.url)), enabledIds: [] },
        systemInstruction: 'A2 reverify trusted static role guidance', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

function planDraft(): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'a2-reverify-plan', planRevision: 1, goalId: goalRef.goalId, stages: [],
    tasks: [
      { taskId: 'work-1', title: 'The ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'work-1', role: 'builder', instruction: 'Do the ordinary work' }],
    obligations: [{ obligationId: 'a2-reverify-obligation', title: 'Deliver the work', requirementLevel: 'required',
      taskIds: ['work-1', 'goal-gate'],
      verificationRequirements: [{ requirementId: 'a2-reverify-static', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

function checksConfiguration(revision: string, kind: 'static' | 'dynamic' = 'static'): TrustedCheckConfiguration {
  return { configurationRevision: revision, workspace: workspaceRef, executor: hostActor, permissionRevision: 'a2-reverify-grant-1',
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: CHECK_ID, kind, command: 'echo A2_REVERIFY_OK', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }] };
}

type Environment = { platform: Platform; scripted: ReturnType<typeof createScriptedModel>; workspaceRoot: string };

/** `duringTurn` runs inside the work Run's one model call, before the scripted answer. */
async function openEnvironment(duringTurn?: (platform: Platform) => Promise<void>): Promise<Environment> {
  const directory = await mkdtemp(join(tmpdir(), 'next-a2-reverify-'));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-a2-reverify-source-'));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), 'A2 reverify registered workspace source\n');
  const state = { revision: 1 };
  let opened: Platform | undefined;
  const scripted = createScriptedModel([{ kind: 'text' as const, text: 'A2 reverify work result' }], async () => {
    if (duringTurn !== undefined && opened !== undefined) await duringTurn(opened);
  });
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'a2-reverify-consumer',
    bindings: [{ workspace: scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: workspaceBindings(workspaceRoot, state), now: () => AT,
    kernelStores: { entries: [{ adapterId: 'a2-reverify-kernel', storeKey: 'a2-reverify-kernel-store',
      workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: runtimeHost(scripted), checks: checksConfiguration('a2-reverify-checks-1'), workflow,
  });
  platforms.push(platform);
  opened = platform;
  const host = ctx();
  expect(await platform.projects.createProject(host, { meta: { requestId: 'a2-project',
    expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } })).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(host, { meta: { requestId: 'a2-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  state.revision = registered.value.revision;
  const installed = await platform.completionPolicies.installCompletionPolicy(host, { meta: { requestId: 'a2-policy',
    expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
    input: { policyId: 'a2-reverify-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'a2-policy-active',
    expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'a2-baseline',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { baselineId: 'a2-baseline', description: 'The A2 reverify module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: 'a2-reverify' }, name: 'A2 reverify',
        responsibility: 'Verify work', paths: ['src'], interfaces: [] }] } } })).toMatchObject({ status: 'committed' });
  expect(await platform.goals.createGoal(host, { meta: { requestId: 'a2-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Check the work again on the same Run' } }))
    .toMatchObject({ status: 'committed' });
  const proposed = await platform.plans.proposePlan(host, { meta: { requestId: 'a2-plan-propose', expected: [] },
    input: { goalRef, basedOn: null, draft: planDraft(), reason: { text: 'Initial A2 reverify plan', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error('Plan proposal failed');
  const applied = await platform.plans.applyPlanChange(host, { meta: { requestId: 'a2-plan-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');
  return { platform, scripted, workspaceRoot };
}

const select = (flowId: string, taskId?: string): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work', ...(taskId === undefined ? {} : { taskId }) });
type Perform = Extract<WorkflowAdvanceInput, { kind: 'perform' }>;
const performs = (kind: WorkflowOperation['kind']) => (input: WorkflowAdvanceInput): boolean =>
  input.kind === 'perform' && input.operation.kind === kind;

type Driven = { stopped: Perform | null; state: string; receipts: WorkflowStepReceipt[] };
async function drive(platform: Platform, first: WorkflowAdvanceInput,
  stopBefore: (input: WorkflowAdvanceInput) => boolean = () => false): Promise<Driven> {
  const receipts: WorkflowStepReceipt[] = [];
  let input = first;
  for (let guard = 0; guard < 64; guard += 1) {
    if (stopBefore(input)) return { stopped: input as Perform, state: 'stopped', receipts };
    const result = await platform.workflow.advanceWork(ctx(), input);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    if (result.value.receipt !== null) receipts.push(result.value.receipt);
    if (result.value.state === 'completed' || result.value.next === null) return { stopped: null, state: result.value.state, receipts };
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

/** VD-8: the work Run completes, its round opens, the workspace changes, and the round finalizes INCONCLUSIVE. */
async function inconclusiveHead(platform: Platform, workspaceRoot: string): Promise<RoundSnapshot> {
  const toCheck = await drive(platform, select('a2-reverify-flow', 'work-1'), performs('run_check'));
  if (toCheck.stopped === null) throw new Error('the Workflow must reach the check');
  await writeFile(join(workspaceRoot, 'source.txt'), 'A2 reverify source changed after the open\n');
  const finalized = await drive(platform, toCheck.stopped, input => input.kind === 'select_work');
  const finalize = finalized.receipts.find(receipt => receipt.kind === 'finalize_checks');
  if (finalize?.kind !== 'finalize_checks' || finalize.result.status !== 'committed') throw new Error('the round must finalize');
  expect(finalize.result.value.outcome).toBe('INCONCLUSIVE');
  return finalize.result.value.snapshot;
}

const reverifyRequest = (round: RoundSnapshot, requestId: string, refusalRevision?: number, reason?: string) => ({
  input: { predecessorRoundRef: round.ref, ...(reason === undefined ? {} : { reason }) },
  meta: { requestId, expected: [{ ref: round.ref, revision: round.revision },
    ...(refusalRevision === undefined ? [] : [{ ref: { aggregateType: 'TaskReworkRefusal' as const, projectId,
      goalId: goalRef.goalId, taskId: round.ref.taskId, operation: 'reverify' as const, subjectId: round.ref.roundId },
      revision: refusalRevision }])] },
});

it('C5 (§15.2 5.9, VR-14/15, TASK-29): an operator reverifies an INCONCLUSIVE head; the Workflow runs the successor and completes the Goal', async () => {
  const { platform, scripted, workspaceRoot } = await openEnvironment();
  const r1 = await inconclusiveHead(platform, workspaceRoot);
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'blocked', phaseCause: { code: 'round_inconclusive' },
    failure: { failureClass: 'check_incomplete', round: { roundRef: r1.ref, ordinal: 1 },
      reverifyActors: ['human', 'system', 'agent'] } });
  const before = JSON.stringify(r1);

  const reverified = await platform.evidence.reverifyRound!(ctx(), reverifyRequest(r1, 'a2-reverify-operator', undefined,
    'the source moved under the round'));
  if (reverified.status !== 'committed' || reverified.value.kind !== 'reverified') throw new Error(`reverify: ${JSON.stringify(reverified)}`);
  const r2 = reverified.value.round;
  expect(r2).toMatchObject({ status: 'open', subjectRunRef: r1.subjectRunRef, executor: hostActor,
    configuration: { configurationRevision: 'a2-reverify-checks-1' },
    chain: { ordinal: 2, predecessorRoundRef: r1.ref, autoCount: 0, reverify: { actorClass: 'human', requestedBy: hostActor,
      failureClass: 'check_incomplete', exemption: 'none', sourceChanged: true, reason: 'the source moved under the round' } } });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'verifying',
    phaseCause: { code: 'verification_running', detail: { ordinal: 2, predecessorRoundRef: r1.ref } } });

  // The Workflow follows the open successor head on the same Run: its check, the PASS finalize, the
  // completion, then the gate and the Goal.
  const driven = await drive(platform, select('a2-reverify-flow-2'));
  expect(driven.state).toBe('completed');
  expect(driven.receipts.find(receipt => receipt.kind === 'run_check'))
    .toMatchObject({ kind: 'run_check', result: { status: 'ready' } });
  const finalizes = driven.receipts.filter(receipt => receipt.kind === 'finalize_checks');
  expect(finalizes[0]).toMatchObject({ result: { status: 'committed', value: { outcome: 'PASS', snapshot: { ref: r2.ref } } } });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'satisfied' });
  expect(await taskRow(platform, 'goal-gate')).toMatchObject({ effectivePhase: 'satisfied' });
  // VR-15: the predecessor is not rewritten and stays readable.
  expect(JSON.stringify(await platform.evidence.readVerification(ctx(), r1.ref)))
    .toBe(JSON.stringify({ status: 'ready', value: JSON.parse(before) }));
  expect(scripted.calls()).toBe(1);
}, 90_000);

it('§13.7 / LA-4: the cap and verification_uncovered are committed refusals on TaskRow.failure; a covering configuration makes them stale', async () => {
  const { platform, scripted, workspaceRoot } = await openEnvironment();
  const r1 = await inconclusiveHead(platform, workspaceRoot);

  // The platform automation (the Workflow's actor) is capped: limit 0 refuses before any capture.
  platform.registerAutomationPolicy({ schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: false });
  expect(await platform.evidence.reverifyRound!(ctx({ ...WORKFLOW_AUTOMATION_ACTOR }), reverifyRequest(r1, 'a2-reverify-cap')))
    .toMatchObject({ status: 'committed', value: { kind: 'refused', refusal: { revision: 1, code: 'auto_rework_cap_reached',
      requestedBy: WORKFLOW_AUTOMATION_ACTOR, configurationRevision: null, source: null } } });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ failure: { automation: {
    lastReverifyRefusal: { code: 'auto_rework_cap_reached', revision: 1, stale: false } } } });

  // No registered check covers the static requirement: refused for the operator too, storing the revision.
  platform.registerCheckConfiguration({ configuration: checksConfiguration('a2-reverify-dynamic', 'dynamic') });
  expect(await platform.evidence.reverifyRound!(ctx(), reverifyRequest(r1, 'a2-reverify-uncovered', 1)))
    .toMatchObject({ status: 'committed', value: { kind: 'refused', refusal: { revision: 2, code: 'verification_uncovered',
      configurationRevision: 'a2-reverify-dynamic', requestedBy: hostActor } } });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'blocked', failure: { automation: {
    lastReverifyRefusal: { code: 'verification_uncovered', revision: 2, stale: false } } } });

  // LA-4: once a covering configuration (another revision) is registered, the stored refusal is stale.
  platform.registerCheckConfiguration({ configuration: checksConfiguration('a2-reverify-checks-2') });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ failure: { automation: {
    lastReverifyRefusal: { code: 'verification_uncovered', revision: 2, stale: true } } } });
  const reverified = await platform.evidence.reverifyRound!(ctx(), reverifyRequest(r1, 'a2-reverify-covered', 2));
  expect(reverified).toMatchObject({ status: 'committed', value: { kind: 'reverified', round: { chain: { ordinal: 2 },
    configuration: { configurationRevision: 'a2-reverify-checks-2' } } } });
  expect(scripted.calls()).toBe(1);
}, 90_000);

it('VR-14 step 5 (hard limit 3, I-17): an operator pause superseded by the natural completion fences the automation, not the operator', async () => {
  let pauseRef: ControlIntentRef | undefined;
  const { platform, scripted, workspaceRoot } = await openEnvironment(async (current) => {
    if (pauseRef !== undefined) return;
    // The operator pauses the running Turn; the Turn completes before any safe point consumes the pause (CTL-06).
    const runRef = (await taskRow(current, 'work-1')).execution;
    if (runRef === null) throw new Error('the work Task must have a Run while its Turn calls the model');
    const read = await current.executions.readExecution(ctx(), runRef);
    if (read.status !== 'ready') throw new Error('the Run must be readable');
    const submitted = await current.controls.submitControl(ctx(), { input: { runRef, kind: 'pause',
      reason: 'operator pause before the Run finishes' }, meta: { requestId: 'a2-reverify-pause',
      expected: [{ ref: runRef, revision: read.value.run.revision }] } });
    if (submitted.status !== 'committed') throw new Error(`the pause must commit: ${JSON.stringify(submitted)}`);
    pauseRef = submitted.value.intent.ref;
  });
  const r1 = await inconclusiveHead(platform, workspaceRoot);
  if (pauseRef === undefined) throw new Error('the pause must be submitted during the Turn');
  // CTL-06: the natural terminal superseded the queued pause; the pointer stays on the completed Run.
  expect(await platform.executions.readExecution(ctx(), r1.subjectRunRef)).toMatchObject({ status: 'ready', value: { run: {
    status: 'ended', outcome: 'completed', controlState: { intentRef: pauseRef, desiredState: 'paused' } } } });
  expect(await platform.controls.readControl(ctx(), pauseRef)).toMatchObject({ status: 'ready', value: { status: 'superseded' } });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'blocked', failure: { failureClass: 'check_incomplete',
    stop: { intentRef: pauseRef, kind: 'pause', requester: 'human' }, reverifyActors: ['human'] } });

  // The platform automation (the Workflow's actor) may not rework what a human stopped: forbidden, nothing written.
  expect(await platform.evidence.reverifyRound!(ctx({ ...WORKFLOW_AUTOMATION_ACTOR }), reverifyRequest(r1, 'a2-reverify-fenced')))
    .toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'a human stopped this work; only an operator may rework it' });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'blocked',
    failure: { round: { roundRef: r1.ref, revision: r1.revision }, automation: { lastReverifyRefusal: null } } });
  // The operator may: the successor round opens on the same Run.
  const reverified = await platform.evidence.reverifyRound!(ctx(), reverifyRequest(r1, 'a2-reverify-fenced-operator'));
  expect(reverified).toMatchObject({ status: 'committed', value: { kind: 'reverified', round: { subjectRunRef: r1.subjectRunRef,
    chain: { ordinal: 2, autoCount: 0, reverify: { actorClass: 'human', requestedBy: hostActor } } } } });
  expect(scripted.calls()).toBe(1);
}, 90_000);
