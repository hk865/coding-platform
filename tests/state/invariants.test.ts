/**
 * The §11 invariant framework (`tests/state/invariants.ts`, A.2 step 6
 * foundation): `readInvariantWorld`, `checkAllInvariants` and the checkers
 * I-1..I-22.
 *
 * 1. A store-built world: the Host drives the real Workflow over a real
 *    Kernel with a scripted model, a real ProcessSandbox for the registered
 *    check (`test -f fixed.txt`) and one SQLite ledger (the flow of
 *    `tests/composition/A2-requeue-platform.test.ts`): FAIL → human requeue →
 *    FAIL → committed `no_new_basis` refusal → requeue with a note → PASS →
 *    Task and Goal complete. The world is read after every operation and
 *    `checkAllInvariants(world, prev, step)` finds nothing, with each step's
 *    kind so the step-local clauses run too.
 * 2. The C2 composition fixture (`createC2RuntimePlatform`): a claim and a
 *    completed Run, no violation.
 * 3. Each checker against a world that satisfies it and, for every clause, a
 *    world that violates that clause: the store-built world (or a hand-built
 *    one) cloned with one fact changed. Each violating world is asserted by
 *    its exact message list (`toEqual`), so a clause that stops firing, or a
 *    sibling clause that fires too, fails the case.
 *
 * No real model is called: scripted text replies only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { ControlIntentKindV1, ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { ExecutionAuthorizationV2, RunRef, RunSnapshot, TaskAttemptSnapshot } from '../../src/contracts/dispatch.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { QueryRunSnapshot } from '../../src/contracts/query-job.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, GOAL_FAN_OUT_ACTOR, WORKFLOW_AUTOMATION_ACTOR, type ReworkActorClass, type TaskRequeueOutcomeV1,
  type TaskRequeueSnapshotV1, type TaskReworkRefusalSnapshotV1,
} from '../../src/contracts/task-requeue.js';
import type { ReverifyBasisV1, RoundSnapshot, TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { RequeueTaskInput, TaskClaimOutbox } from '../../src/core/work-graph/model/claim-contracts.js';
import { desiredStateOfKind } from '../../src/core/work-graph/state/control-intent-machine.js';
import { buildSuccessorRound, reverifyFailureClass } from '../../src/core/work-graph/state/verification-machine.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { createC2RuntimePlatform } from '../helpers/C2-runtime-platform-fixture.js';
import {
  checkAllInvariants, checkI10RunNodeShape, checkI11QueryRunSettlement, checkI12RequeueFacts, checkI13EvidenceIndex,
  checkI14CompletedGoalIsActive, checkI15Monotone, checkI16PausedInterrupted, checkI17HumanStopRespected, checkI18RefusalLog,
  checkI19ContinuationBriefBinding, checkI1RunningPairing, checkI20RoundChain, checkI21NonActiveTaskQuiescent,
  checkI22TracedBasisFrozen, checkI2ReleaseMatchesOutcome, checkI3GoalCompletionBacked, checkI4SingleWriterPerSession,
  checkI5SingleQueuedPointerIntent, checkI6EndingConsistency, checkI7RoundConsistency, checkI8MessageMonotone,
  checkI9NoAdmissionAfterGoalStop, INVARIANT_CHECKERS, invariantStoreOf, legacyFindings, readInvariantWorld, refKey,
  type FuzzStep, type FuzzStepKind, type InvariantEvent, type InvariantViolation, type InvariantWorld,
} from './invariants.js';

// ------------------------------------------------------------------------ //
// 1. The store-built world                                                  //
// ------------------------------------------------------------------------ //

const AT = '2026-10-06T00:00:00.000Z';
const projectId = 'inv-project';
const workspaceId = 'inv-workspace';
const scope = { projectId, workspaceId };
const hostActor = { kind: 'human' as const, id: 'inv-operator' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'inv-goal' };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'inv-policy', revision: 1 };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'inv-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const runtimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const TASK = { projectId, goalId: goalRef.goalId, taskId: 'work-1' };

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;

function ctx(): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor: hostActor },
    materialReader: { kind: 'host', projectId, workspaceId, actor: hostActor }, signal: new AbortController().signal };
}

function step(kind: FuzzStepKind, label: string): FuzzStep {
  return { kind, actor: hostActor, automationPolicy: { ...DEFAULT_TASK_AUTOMATION_POLICY }, label };
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
      return { status: 'ready', value: { subjectKey: 'inv-host', permissionRevision: 'inv-grant-1', allowsRead: () => true } };
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
        configurationRevision: 'inv-host-config@1',
        model: { configuration: { revision: 'inv-host-config@1', provider: 'deepseek', model: 'inv-scripted', baseUrl: 'http://127.0.0.1' },
          client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'inv-counter' }) } },
        budget: runtimeBudget,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex('Invariant trusted static role guidance') } : null,
        tools: ['read'], writeScope: [], skills: { resourceRoot: fileURLToPath(new URL('../../vendor/coding-agent/resources/skills',
          import.meta.url)), enabledIds: [] },
        systemInstruction: 'Invariant trusted static role guidance', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

function planDraft(): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'inv-plan', planRevision: 1, goalId: goalRef.goalId, stages: [],
    tasks: [
      { taskId: 'work-1', title: 'Ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'work-1', role: 'builder', instruction: 'Do the ordinary work' }],
    obligations: [{ obligationId: 'inv-obligation', title: 'Deliver the work', requirementLevel: 'required',
      taskIds: ['work-1', 'goal-gate'],
      verificationRequirements: [{ requirementId: 'inv-static', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

type Environment = { platform: Platform; scripted: ReturnType<typeof createScriptedModel>; directory: string; workspaceRoot: string };

async function openEnvironment(directories: string[]): Promise<Environment> {
  const directory = await mkdtemp(join(tmpdir(), 'next-invariants-'));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-invariants-source-'));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), 'Invariant registered workspace source\n');
  const state = { revision: 1 };
  const scripted = createScriptedModel(Array.from({ length: 3 }, (_, index) => ({ kind: 'text' as const,
    text: `Invariant work result ${index + 1}` })));
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'inv-checks-1', workspace: workspaceRef, executor: hostActor,
    permissionRevision: 'inv-grant-1', sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
    deniedPrefixes: ['.git'],
    checks: [{ checkId: 'inv-check', kind: 'static', command: 'test -f fixed.txt', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'inv-consumer',
    bindings: [{ workspace: scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: workspaceBindings(workspaceRoot, state), now: () => AT,
    kernelStores: { entries: [{ adapterId: 'inv-kernel', storeKey: 'inv-kernel-store', workspace: scope,
      databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: runtimeHost(scripted), checks, workflow,
  });
  const host = ctx();
  expect(await platform.projects.createProject(host, { meta: { requestId: 'inv-project',
    expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } })).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(host, { meta: { requestId: 'inv-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  state.revision = registered.value.revision;
  const installed = await platform.completionPolicies.installCompletionPolicy(host, { meta: { requestId: 'inv-policy',
    expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
    input: { policyId: 'inv-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'inv-policy-active',
    expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'inv-baseline',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { baselineId: 'inv-baseline', description: 'The invariant module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: 'inv' }, name: 'Invariants',
        responsibility: 'Rework failed work', paths: ['src'], interfaces: [] }] } } })).toMatchObject({ status: 'committed' });
  expect(await platform.goals.createGoal(host, { meta: { requestId: 'inv-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Keep every invariant through a rework' } }))
    .toMatchObject({ status: 'committed' });
  const proposed = await platform.plans.proposePlan(host, { meta: { requestId: 'inv-plan-propose', expected: [] },
    input: { goalRef, basedOn: null, draft: planDraft(), reason: { text: 'Initial invariant plan', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error('Plan proposal failed');
  const applied = await platform.plans.applyPlanChange(host, { meta: { requestId: 'inv-plan-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');
  return { platform, scripted, directory, workspaceRoot };
}

/** The step kind of one performed Workflow operation (§11.11 `FuzzStep`). */
function stepKindOf(receipt: WorkflowStepReceipt): FuzzStepKind {
  switch (receipt.kind) {
    case 'claim_task': return 'task_claimed';
    case 'start': return 'entry_authorized';
    case 'open_checks': return 'round_opened';
    case 'run_check': return 'check_begun';
    case 'complete_goal': return 'goal_completed';
    default: return 'other';
  }
}

/** Every world the flow read, with the step that produced it; the checks run once the flow is done. */
type Observation = { label: string; world: InvariantWorld; prev: InvariantWorld | undefined; step: FuzzStep | undefined };

type Flow = {
  observations: Observation[];
  final: InvariantWorld;
  /** The world right after the human requeue (one TaskRequeue, before Run 2). */
  afterRequeue: InvariantWorld;
  /** The world right after the committed `no_new_basis` refusal. */
  afterRefusal: InvariantWorld;
  /** The world before the refusal step. */
  beforeRefusal: InvariantWorld;
};

const directories: string[] = [];
let flow: Flow;

/** Reads the world, records it with the step that produced it, and returns it. */
async function observe(env: Environment, observations: Observation[], label: string, stepOf?: FuzzStep): Promise<InvariantWorld> {
  const world = await readInvariantWorld(invariantStoreOf(env.directory), projectId);
  observations.push({ label, world, prev: observations.at(-1)?.world, step: stepOf });
  return world;
}

/** The Host drives every returned `next`, reading the world after each perform; it stops before an automatic requeue. */
async function drive(env: Environment, observations: Observation[], flowId: string,
  taskId: string | null = 'work-1'): Promise<WorkflowStepReceipt[]> {
  const receipts: WorkflowStepReceipt[] = [];
  let input: WorkflowAdvanceInput = { schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work',
    ...(taskId === null ? {} : { taskId }) };
  for (let guard = 0; guard < 64; guard += 1) {
    const result = await env.platform.workflow.advanceWork(ctx(), input);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    const receipt = result.value.receipt;
    if (receipt !== null) {
      receipts.push(receipt);
      await observe(env, observations, `${flowId}:${receipt.kind}`, step(stepKindOf(receipt), `${flowId}:${receipt.kind}`));
    }
    if (result.value.state === 'completed' || result.value.next === null) return receipts;
    input = result.value.next;
    if (input.kind === 'perform' && input.operation.kind === 'requeue_task') return receipts;
  }
  throw new Error('the Workflow did not settle within the step guard');
}

async function selectedRun(platform: Platform): Promise<RunRef> {
  const graph = await platform.plans.queryTaskGraph(ctx(), { goalRef });
  if (graph.status !== 'ready') throw new Error('the task graph must be readable');
  const run = graph.value.tasks.find(candidate => candidate.ref.taskId === 'work-1')?.execution ?? null;
  if (run === null) throw new Error('work-1 must have a selected Run');
  return run;
}

async function requeue(platform: Platform, requestId: string, afterRunRef: RunRef,
  extra: Partial<RequeueTaskInput> = {}): Promise<WriteResult<TaskRequeueOutcomeV1>> {
  const goal = await platform.plans.queryGoal(ctx(), goalRef);
  if (goal.status !== 'ready') throw new Error('the Goal must be readable');
  const run = await platform.executions.readExecution(ctx(), afterRunRef);
  if (run.status !== 'ready') throw new Error('the Run must be readable');
  return platform.claims.requeueTask!(ctx(), { meta: { requestId, expected: [{ ref: goalRef, revision: goal.value.goal.revision },
    { ref: afterRunRef, revision: run.value.run.revision }] },
    input: { taskRef: TASK, afterRunRef, reason: 'the registered check failed; try again', ...extra } });
}

beforeAll(async () => {
  const env = await openEnvironment(directories);
  const observations: Observation[] = [];
  try {
    await observe(env, observations, 'adopted');
    await drive(env, observations, 'inv-flow-1');
    const run1 = await selectedRun(env.platform);
    const requeued = await requeue(env.platform, 'inv-requeue-1', run1);
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`requeue 1: ${JSON.stringify(requeued)}`);
    const afterRequeue = await observe(env, observations, 'requeue-1', step('task_requeued', 'requeue-1'));
    await drive(env, observations, 'inv-flow-2');
    const run2 = await selectedRun(env.platform);
    const beforeRefusal = observations.at(-1)!.world;
    const refused = await requeue(env.platform, 'inv-requeue-2', run2);
    if (refused.status !== 'committed' || refused.value.kind !== 'refused') throw new Error(`requeue 2: ${JSON.stringify(refused)}`);
    const afterRefusal = await observe(env, observations, 'refusal', step('task_rework_refused', 'refusal'));
    const withNote = await requeue(env.platform, 'inv-requeue-3', run2, { note: 'create fixed.txt before the check' });
    if (withNote.status !== 'committed' || withNote.value.kind !== 'requeued') throw new Error(`requeue 3: ${JSON.stringify(withNote)}`);
    await observe(env, observations, 'requeue-2', step('task_requeued', 'requeue-2'));
    await writeFile(join(env.workspaceRoot, 'fixed.txt'), 'fixed\n');
    await drive(env, observations, 'inv-flow-3');
    // The Goal-level selection reaches the gate (`tests/scenarios/C5-gate-fix.test.ts`).
    await drive(env, observations, 'inv-flow-gate', null);
    expect(env.scripted.calls(), 'one model call per Run').toBe(3);
    flow = { observations, final: observations.at(-1)!.world, afterRequeue, afterRefusal, beforeRefusal };
  } finally {
    await env.platform.close();
  }
}, 180_000);

afterAll(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function report(violations: readonly InvariantViolation[]): string {
  return violations.map((violation) => `${violation.invariant} ${violation.ref}: ${violation.message}`).join('\n');
}

describe('readInvariantWorld and checkAllInvariants over a platform run (store-built)', () => {
  it('reads every record kind of the run in one window, with the event log and the projected Task states', () => {
    const world = flow.final;
    expect(world.projectId).toBe(projectId);
    expect(world.runs).toHaveLength(3);
    expect(world.attempts).toHaveLength(3);
    expect(world.outboxes).toHaveLength(3);
    expect(world.leases).toHaveLength(1);
    expect(world.sessions.length).toBeGreaterThanOrEqual(1);
    expect(world.requeues.map((requeue) => requeue.automation.automatic)).toEqual([false, false]);
    expect(world.refusals).toMatchObject([{ revision: 1, code: 'no_new_basis' }]);
    expect(world.rounds.filter((round) => round.identity.scope.gateSubject === undefined).map((round) => round.outcome).sort())
      .toEqual(['FAIL', 'FAIL', 'PASS']);
    expect(world.evidence.length).toBeGreaterThanOrEqual(3);
    expect(world.plans).toHaveLength(1);
    expect(world.goals).toMatchObject([{ desiredState: 'active' }]);
    expect(world.reductions.find((reduction) => reduction.ref.taskId === 'work-1')).toMatchObject({ phase: 'satisfied' });
    expect(world.taskStates.find((state) => state.taskId === 'work-1')).toMatchObject({ phase: 'satisfied', problem: null });
    // The gate passed on its own chain and the Goal completed (I-3 has a COMPLETED GoalPhase to check).
    expect(world.rounds.filter((round) => round.identity.scope.gateSubject !== undefined)).toMatchObject([{ outcome: 'PASS' }]);
    expect(world.taskStates.find((state) => state.taskId === 'goal-gate')).toMatchObject({ phase: 'satisfied' });
    expect(world.goalPhases).toMatchObject([{ phase: 'COMPLETED', planRef: world.plans[0]!.ref }]);
    expect(world.evidenceIndexes.length).toBeGreaterThanOrEqual(1);
    // The event log: the Goal, three claims and authorizations, rounds, both requeues and the refusal.
    const count = (eventType: string) => world.events.filter((event) => event.eventType === eventType).length;
    expect(count('GoalCreated')).toBe(1);
    expect(count('TaskClaimed')).toBe(3);
    expect(count('ExecutionEntryAuthorized')).toBe(3);
    expect(count('TaskRequeued')).toBe(2);
    expect(world.events.filter((event) => event.eventType === 'TaskReworkRefused')).toMatchObject([{ revision: 1 }]);
    // The two requeue Runs' manifests are read for I-19.
    expect(world.manifests?.map((manifest) => manifest.problem)).toEqual([null, null]);
    expect(world.manifests?.every((manifest) => manifest.continuationBrief !== null)).toBe(true);
  });

  it('finds no violation and no legacy record after any operation, with prev and the step of each operation', () => {
    expect(flow.observations.length).toBeGreaterThan(20);
    const problems = flow.observations.flatMap(({ label, world, prev, step: taken }) =>
      [...checkAllInvariants(world, prev, taken), ...legacyFindings(world, prev, taken)]
        .map((violation) => `${label}: ${report([violation])}`));
    expect(problems.join('\n')).toBe('');
    // The step-local clauses ran on matching steps.
    const kinds = new Set(flow.observations.map((observation) => observation.step?.kind));
    for (const kind of ['task_claimed', 'entry_authorized', 'round_opened', 'check_begun', 'task_requeued', 'task_rework_refused',
      'goal_completed'] as const) {
      expect(kinds.has(kind), kind).toBe(true);
    }
  });
});

describe('the C2 composition fixture (createC2RuntimePlatform)', () => {
  it('has no violation after the claim and after the Run completed', async () => {
    const fx = await createC2RuntimePlatform({ toolNames: ['read'], allowSourceRead: true,
      scriptedReplies: [{ kind: 'text', text: 'C2 invariant run' }] });
    try {
      const store = invariantStoreOf(fx.directory);
      const claimed = await readInvariantWorld(store, fx.scope.projectId);
      expect(claimed.runs).toMatchObject([{ status: 'starting' }]);
      expect(report(checkAllInvariants(claimed))).toBe('');
      const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: 'inv-c2-prepare' });
      if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);
      const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'inv-c2-driver', requestId: 'inv-c2-start' });
      expect(started).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'completed' } } });
      const ended = await readInvariantWorld(store, fx.scope.projectId);
      expect(ended.runs).toMatchObject([{ status: 'ended', outcome: 'completed' }]);
      expect(ended.attempts).toMatchObject([{ status: 'ended' }]);
      expect(report([...checkAllInvariants(ended, claimed, { kind: 'entry_authorized', actor: hostActor,
        automationPolicy: { ...DEFAULT_TASK_AUTOMATION_POLICY } }), ...legacyFindings(ended, claimed)])).toBe('');
    } finally {
      await fx.close();
    }
  });
});

// ------------------------------------------------------------------------ //
// 3. Every checker: a violating world and a satisfying world                //
// ------------------------------------------------------------------------ //

const clone = (world: InvariantWorld): InvariantWorld => structuredClone(world);

/** The non-legacy messages of one checker's findings. */
function violations(found: readonly InvariantViolation[]): string[] {
  return found.filter((violation) => violation.legacy !== true).map((violation) => violation.message);
}

/** The `legacy` messages of one checker's findings. */
function legacyOf(found: readonly InvariantViolation[]): string[] {
  return found.filter((violation) => violation.legacy === true).map((violation) => violation.message);
}

function observed(label: string): Observation {
  const found = flow.observations.find((observation) => observation.label === label);
  if (found === undefined) throw new Error(`no observation ${label}: ${flow.observations.map((o) => o.label).join(', ')}`);
  return found;
}

/** Run 1..3, their rounds and the two TaskRequeues of the flow, from the world's own records. */
function flowRecords(world: InvariantWorld) {
  const requeue1 = world.requeues.find((requeue) => requeue.newInputRefs.length === 0)!;
  const requeue2 = world.requeues.find((requeue) => requeue.newInputRefs.length > 0);
  const run1 = world.runs.find((candidate) => candidate.ref.runId === requeue1.afterRunRef.runId)!;
  const run2 = world.runs.find((candidate) => candidate.requeueRef !== undefined && candidate.requeueRef.afterRunId === run1.ref.runId);
  const run3 = requeue2 === undefined ? undefined
    : world.runs.find((candidate) => candidate.requeueRef !== undefined && candidate.requeueRef.afterRunId === requeue2.afterRunRef.runId);
  const workRound = (target: RunSnapshot | undefined): RoundSnapshot | undefined => target === undefined ? undefined
    : world.rounds.find((round) => round.identity.scope.gateSubject === undefined && round.ref.runId === target.ref.runId);
  const attemptOf = (target: RunSnapshot): TaskAttemptSnapshot => world.attempts.find((attempt) => attempt.runId === target.ref.runId)!;
  const outboxOf = (target: RunSnapshot): TaskClaimOutbox => world.outboxes.find((outbox) => outbox.ref.attemptId === target.attemptId)!;
  return { requeue1, requeue2, run1, run2, run3, round1: workRound(run1), round2: workRound(run2), round3: workRound(run3),
    attemptOf, outboxOf, lease: world.leases[0]!, plan: world.plans[0]!, refusal: world.refusals[0] };
}

/** The V2 authorization of a Run of the flow (every flow Run has one once started). */
function authOf(run: RunSnapshot): ExecutionAuthorizationV2 {
  const auth = run.executionAuthorization;
  if (auth === undefined || !('schemaVersion' in auth) || auth.schemaVersion !== 2) throw new Error(`Run ${run.ref.runId} has no V2 authorization`);
  return auth;
}

/** One hand-written event-log entry after every event of `world` (I-5, I-9, I-18). */
function appendEvent(world: InvariantWorld, event: Omit<InvariantEvent, 'seq' | 'goalId' | 'goalStateTo' | 'revision' | 'controlKind' | 'taskId'>
  & Partial<InvariantEvent>): InvariantEvent {
  const seq = Math.max(0, ...world.events.map((candidate) => candidate.seq)) + 1;
  const appended: InvariantEvent = { seq, goalId: goalRef.goalId, goalStateTo: null, revision: null, controlKind: null, taskId: null, ...event };
  world.events.push(appended);
  return appended;
}

function intentRecord(run: RunSnapshot, intentId: string, kind: ControlIntentKindV1,
  status: ControlIntentSnapshotV1['status'], requestedBy: ControlIntentSnapshotV1['requestedBy'] = hostActor,
  requestedAt: string = AT): ControlIntentSnapshotV1 {
  const request = { schemaVersion: 1 as const, ref: { aggregateType: 'ControlIntent' as const, projectId, workspaceId, intentId },
    runRef: run.ref, kind, desiredState: desiredStateOfKind(kind), reason: null, requestedAt, requestedBy };
  if (status === 'queued') return { ...request, revision: 1, status };
  return { ...request, revision: 2, status, observation: { schemaVersion: 1, origin: 'platform_reconcile', kind: 'paused',
    runRevision: run.revision, detail: { hostInstanceId: 'inv-host', runOutcome: 'crashed' }, observedAt: AT } };
}

/** Run r of `world` becomes paused-interrupted (RUN-24) by an applied pause intent (CTL-08(f)); returns the intent. */
function pausedInterrupted(world: InvariantWorld, run: RunSnapshot,
  requestedBy: ControlIntentSnapshotV1['requestedBy'] = hostActor): ControlIntentSnapshotV1 {
  const pause = intentRecord(run, `pause-${run.ref.runId}`, 'pause', 'applied', requestedBy);
  const target = world.runs.find((candidate) => candidate.ref.runId === run.ref.runId)!;
  target.outcome = 'crashed';
  target.controlState = { intentRef: pause.ref, desiredState: 'paused' };
  target.reconciliation = { status: 'done', recordedAt: AT, basis: { kind: 'host_instance_takeover', hostInstanceId: 'inv-host' },
    observation: { kind: 'interrupted_clean', lastPosition: null, kernelPaused: true, pausedIntentRef: pause.ref,
      event: { eventType: 'run_crashed', schemaVersion: 1, eventId: 'inv-crash', runRef: run.ref, sequence: 9, occurredAt: AT,
        payload: { kind: 'crashed', error: 'the Host restarted while the Run was paused' } } } };
  world.intents.push(pause);
  return pause;
}

function sessionMessage(messageId: string, status: SessionMessage['status'], readAt: string | null, responded: boolean): SessionMessage {
  const bodyRef = { aggregateType: 'Artifact', digest: sha256Hex(messageId), contentType: 'text/plain; charset=utf-8', sizeBytes: 1 };
  return { ref: { aggregateType: 'SessionMessage', projectId, workspaceId, messageId }, schemaVersion: 1, revision: 1,
    sender: { kind: 'host', actor: hostActor }, recipient: { projectId, sessionId: 'inv-session' },
    bodyRef, sourceRef: { kind: 'artifact', refId: messageId, revision: '1' }, createdAt: AT, status, readAt,
    response: responded ? { sender: { kind: 'host', actor: hostActor }, bodyRef, sourceRef: { kind: 'artifact', refId: `${messageId}-r`,
      revision: '1' }, respondedAt: AT } : null } as unknown as SessionMessage;
}

type QueryExecutionState = NonNullable<QueryRunSnapshot['run']['executionState']>;

function queryRun(runId: string, fields: Partial<QueryRunSnapshot['run']>): QueryRunSnapshot {
  return { ref: { aggregateType: 'QueryRun', projectId, workspaceId, queryJobId: `job-${runId}`, runId }, revision: 1, schemaVersion: 1,
    run: { schemaVersion: 1, queryJobRef: { aggregateType: 'QueryJob', projectId, workspaceId, queryJobId: `job-${runId}` }, runId,
      status: 'pending', startedAt: null, endedAt: null, outcome: null, ...fields } } as QueryRunSnapshot;
}

function executionState(session: SessionRecord, phase: QueryExecutionState['phase'], sessionGeneration: number): QueryExecutionState {
  return { phase, sessionRef: { projectId: session.ref.projectId, sessionId: session.ref.sessionId }, sessionGeneration } as QueryExecutionState;
}

const automation = (autoReworkLimit: number): FuzzStep['automationPolicy'] => ({ ...DEFAULT_TASK_AUTOMATION_POLICY, autoReworkLimit });

/** Adopts a copy of the active Plan as `inv-plan-2` (v2), changed by `change`; returns it. */
function adoptedPlan(world: InvariantWorld,
  change: (plan: Extract<PlanRevisionSnapshot, { schemaVersion: 2 }>, source: PlanRevisionSnapshot) => void): PlanRevisionSnapshot {
  const source = world.plans[0]!;
  if (source.schemaVersion !== 2) throw new Error('the flow adopts a v2 Plan');
  const plan = structuredClone(source);
  plan.ref = { ...plan.ref, planId: 'inv-plan-2' };
  plan.planId = 'inv-plan-2';
  plan.planRevision = source.planRevision + 1;
  change(plan, source);
  world.plans.push(plan);
  world.goals[0]!.activePlanRevision = { ...plan.ref };
  return plan;
}

/** A VR-14 successor of `predecessor` through the production constructor (`buildSuccessorRound`). */
function successor(predecessor: RoundSnapshot, roundId: string, requestedBy: ActorRef, actorClass: ReworkActorClass, digest: string): RoundSnapshot {
  const { adoptedPlanRef, taskBasisRef, configuration, configurationDigest, identity, sourceProof, verificationPlan } = predecessor;
  const basis = { digest, source: { workspaceRevision: identity.workspaceRevision, sourceDigest: identity.sourceDigest } } as unknown as ReverifyBasisV1;
  return buildSuccessorRound({ predecessor, roundId,
    build: { adoptedPlanRef, taskBasisRef, configuration, configurationDigest, identity, sourceProof, verificationPlan },
    reverify: { requestedBy, actorClass, requestedAt: AT, basis, newInputRefs: [], reason: null } });
}

/** A reverify refusal (`no_new_basis`, LA-4 configuration revision) on `round`, with its `TaskReworkRefused` event. */
function reverifyRefusal(world: InvariantWorld, round: RoundSnapshot): TaskReworkRefusalSnapshotV1 {
  const base = flowRecords(world).refusal!;
  const failureClass = reverifyFailureClass(round);
  if (failureClass === null) throw new Error(`round ${round.ref.roundId} is not a finalized non-PASS round`);
  const refusal: TaskReworkRefusalSnapshotV1 = { ...structuredClone(base),
    ref: { ...base.ref, operation: 'reverify', subjectId: round.ref.roundId }, subjectRoundRef: { ...round.ref }, failureClass,
    code: 'no_new_basis', matchedRequeueRef: null, configurationRevision: 'inv-checks-1' };
  world.refusals.push(refusal);
  appendEvent(world, { eventType: 'TaskReworkRefused', subject: refKey(refusal.ref), revision: refusal.revision, taskId: refusal.ref.taskId });
  return refusal;
}

const LATER = '2026-10-06T01:00:00.000Z';
const EARLIER = '2026-10-05T23:00:00.000Z';
const AGENT: ActorRef = { kind: 'agent', id: 'inv-agent', runRef: { aggregateType: 'Run', projectId, goalId: goalRef.goalId, runId: 'inv-agent-run' } };
const PROVENANCE = { schemaVersion: 1, runRef: AGENT.kind === 'agent' ? AGENT.runRef : null } as unknown as TaskRequeueSnapshotV1['agentProvenance'];
/** An automatic (counted) requeue's automation facts (C8). */
const counted = (autoCount: number, cap = 3): TaskRequeueSnapshotV1['automation'] => ({ automatic: true, counted: true, autoCount, cap });
/** A yielded wait continuation (I-5, I-12). */
const waitContinuation = (run: RunSnapshot): NonNullable<RunSnapshot['continuation']> => ({ schemaVersion: 1, kind: 'wait_reply', task: run.task,
  sessionRef: { projectId, sessionId: 's' }, messageRef: { aggregateType: 'SessionMessage', projectId, workspaceId, messageId: 'm' } });
/** A consumed wait (W2): Run r continues `runRef` with a reply. */
const consumedWait = (runRef: RunRef): NonNullable<RunSnapshot['consumedWait']> => ({ runRef: { ...runRef },
  messageRef: { aggregateType: 'SessionMessage', projectId, workspaceId, messageId: 'inv-wait' },
  responseRef: { aggregateType: 'Artifact', digest: sha256Hex('inv-reply'), contentType: 'text/plain; charset=utf-8', sizeBytes: 1 } } as never);

describe('every checker: a satisfying world and a violating world per clause (exact message lists)', () => {
  it('I-1 checkI1RunningPairing: one open Attempt exactly while the Task runs, paired per D-14', () => {
    const claimed = observed('inv-flow-1:claim_task').world;
    expect(claimed.attempts.filter((attempt) => attempt.status === 'claimed')).toHaveLength(1);
    expect(claimed.taskStates.find((state) => state.taskId === 'work-1')).toMatchObject({ phase: 'running' });
    expect(checkI1RunningPairing(claimed)).toEqual([]);
    expect(checkI1RunningPairing(flow.final)).toEqual([]);
    const open = claimed.attempts.find((attempt) => attempt.status === 'claimed')!;
    const notRunning = clone(claimed);
    notRunning.taskStates.find((state) => state.taskId === 'work-1')!.phase = 'pending';
    expect(violations(checkI1RunningPairing(notRunning))).toEqual(['Task work-1 projects pending with 1 open Attempt(s)']);
    // |O(t)| ≤ 1: a second open Attempt (the Lease names the first).
    const twoOpen = clone(claimed);
    twoOpen.attempts.push({ ...structuredClone(open), ref: { ...open.ref, attemptId: 'inv-second' } });
    expect(violations(checkI1RunningPairing(twoOpen))).toEqual([`Task work-1 has 2 open Attempts (${open.ref.attemptId}, inv-second)`,
      'claimed Attempt inv-second does not hold its Lease', 'Task work-1 projects running with 2 open Attempt(s)']);
    // D-14: a claimed Attempt pairs with the entry phase none, authorized, entering or revoked only.
    const entered = clone(claimed);
    entered.runs[0]!.executionAuthorization = { ...authOf(flowRecords(flow.final).run1), phase: 'entered' };
    expect(violations(checkI1RunningPairing(entered)))
      .toEqual([`Attempt ${open.ref.attemptId} (claimed) pairs with entry phase authorized/entering/revoked, not entered`]);
    const reopened = clone(flow.final);
    const { run3, attemptOf } = flowRecords(reopened);
    const third = attemptOf(run3!);
    third.status = 'started';
    const id = third.ref.attemptId;
    expect(violations(checkI1RunningPairing(reopened))).toEqual([`started Attempt ${id} pairs with a running Run, not ended`,
      `Attempt ${id} (started) pairs with entry phase entered, not settled`, `Attempt ${id} (started) pairs with Outbox status entered, not settled`,
      `started Attempt ${id} does not hold its Lease`, 'Task work-1 projects satisfied with 1 open Attempt(s)']);
  });

  it('I-2 checkI2ReleaseMatchesOutcome: a known end released, an unknown end kept the occupancy and the Lease', () => {
    expect(checkI2ReleaseMatchesOutcome(flow.final)).toEqual([]);
    const { run1, run3 } = flowRecords(flow.final);
    const held = clone(flow.final);
    const records = flowRecords(held);
    const claim = records.outboxOf(records.run3!).claim;
    const session = held.sessions.find((candidate) => candidate.ref.sessionId === claim.sessionRef.sessionId)!;
    session.occupancy = { kind: 'execution', executionRef: records.run3!.ref, generation: claim.generation };
    expect(violations(checkI2ReleaseMatchesOutcome(held)))
      .toEqual([`Run ${run3!.ref.runId} ended completed but still occupies Session ${claim.sessionRef.sessionId}`]);
    const leaseHeld = clone(flow.final);
    delete flowRecords(leaseHeld).lease.release;
    expect(violations(checkI2ReleaseMatchesOutcome(leaseHeld))).toEqual([`Run ${run3!.ref.runId} ended completed but still holds the Lease of work-1`]);
    const unknown = clone(flow.final);
    flowRecords(unknown).run3!.outcome = 'outcome_unknown';
    expect(violations(checkI2ReleaseMatchesOutcome(unknown))).toEqual([
      `Run ${run3!.ref.runId} ended outcome_unknown and released Session ${claim.sessionRef.sessionId}`,
      `Run ${run3!.ref.runId} ended outcome_unknown and released the Lease of work-1`]);
    // claimOf(r) is defined for every Run (§11.0): a Run without its Attempt and Outbox is damage.
    const unclaimed = clone(flow.final);
    unclaimed.attempts = unclaimed.attempts.filter((attempt) => attempt.runId !== run1.ref.runId);
    unclaimed.outboxes = unclaimed.outboxes.filter((outbox) => outbox.ref.attemptId !== run1.attemptId);
    expect(violations(checkI2ReleaseMatchesOutcome(unclaimed))).toEqual([`Run ${run1.ref.runId} has no claim (no Outbox)`]);
    // The Query clause (§8 D-11).
    const queries = clone(flow.final);
    const querySession = queries.sessions[0]!;
    queries.queryRuns.push(queryRun('q-settled', { status: 'answered', executionState: executionState(querySession, 'settled', 7) }));
    expect(checkI2ReleaseMatchesOutcome(queries)).toEqual([]);
    const occupied = clone(queries);
    occupied.sessions[0]!.occupancy = { kind: 'execution', executionRef: occupied.queryRuns[0]!.ref, generation: 7 };
    expect(violations(checkI2ReleaseMatchesOutcome(occupied))).toEqual(['settled QueryRun q-settled still occupies its Session']);
    const unknownQuery = clone(queries);
    unknownQuery.queryRuns.push(queryRun('q-unknown', { status: 'running', executionState: executionState(querySession, 'unknown', 8) }));
    expect(violations(checkI2ReleaseMatchesOutcome(unknownQuery))).toEqual(['QueryRun q-unknown is unknown and released its Session']);
    unknownQuery.sessions[0]!.occupancy = { kind: 'execution', executionRef: unknownQuery.queryRuns[1]!.ref, generation: 8 };
    expect(checkI2ReleaseMatchesOutcome(unknownQuery)).toEqual([]);
  });

  it('I-3 checkI3GoalCompletionBacked: COMPLETED rests on PASS chain heads and nothing is unresolved at goal_completed', () => {
    const completion = observed('inv-flow-gate:complete_goal');
    expect(completion.world.goalPhases).toHaveLength(1);
    expect(checkI3GoalCompletionBacked(completion.world, completion.prev, completion.step)).toEqual([]);
    const failRound = clone(flow.final);
    const records = flowRecords(failRound);
    failRound.reductions.find((reduction) => reduction.ref.taskId === 'work-1')!.completion!.roundRef = records.round1!.ref;
    expect(violations(checkI3GoalCompletionBacked(failRound))).toEqual(['the completion round of work-1 is finalized FAIL with 0 gap(s)',
      'the completion round of work-1 has no PASS evidence for requirement inv-obligation/inv-static']);
    // phase(t) of every required Task is satisfied.
    const verifying = clone(flow.final);
    verifying.taskStates.find((state) => state.taskId === 'work-1')!.phase = 'verifying';
    expect(violations(checkI3GoalCompletionBacked(verifying))).toEqual(['required Task work-1 of the COMPLETED Goal projects verifying']);
    // The work round is a round of the Task's completed production Run.
    const crashed = clone(flow.final);
    flowRecords(crashed).run3!.outcome = 'crashed';
    expect(violations(checkI3GoalCompletionBacked(crashed)))
      .toEqual(['the completion round of work work-1 is not a work round of its completed production Run']);
    // A second root on Run 3's chain: the PASS round is no longer the one head (VD-14).
    const ambiguous = clone(flow.final);
    const head = flowRecords(ambiguous).round3!;
    ambiguous.rounds.push({ ...structuredClone(head), ref: { ...head.ref, roundId: 'inv-other-root' } });
    expect(violations(checkI3GoalCompletionBacked(ambiguous))).toEqual(['the completion round of work-1 is not its chain head (VD-14)']);
    const superseded = clone(flow.final);
    const old = flowRecords(superseded).requeue1.supersededEvidenceIds[0]!;
    superseded.reductions.find((reduction) => reduction.ref.taskId === 'work-1')!.effectiveEvidenceIds.push(old);
    expect(violations(checkI3GoalCompletionBacked(superseded))).toEqual([`the completion of work-1 adopts superseded evidence ${old} (TD-2)`]);
    const paused = clone(flow.final);
    paused.goals[0]!.desiredState = 'paused';
    expect(violations(checkI3GoalCompletionBacked(paused))).toEqual(['Goal inv-goal is COMPLETED while paused']);
    // Step-local: an unresolved Run of the Goal when goal_completed commits (checked only with that step).
    const unresolvedRun = clone(completion.world);
    const run = flowRecords(unresolvedRun).run1;
    run.status = 'running';
    run.outcome = null;
    expect(violations(checkI3GoalCompletionBacked(unresolvedRun, completion.prev, completion.step)))
      .toEqual([expect.stringMatching(new RegExp(`^Goal inv-goal completed while Run ${run.ref.runId} is unresolved`))]);
    expect(violations(checkI3GoalCompletionBacked(unresolvedRun, completion.prev))).toEqual([]);
  });

  it('I-4 checkI4SingleWriterPerSession: one unresolved writer per Session, which holds the occupancy', () => {
    const claimed = observed('inv-flow-1:claim_task').world;
    expect(claimed.sessions.some((session) => session.occupancy !== null)).toBe(true);
    expect(checkI4SingleWriterPerSession(claimed)).toEqual([]);
    expect(checkI4SingleWriterPerSession(flow.final)).toEqual([]);
    const released = clone(claimed);
    released.sessions.find((session) => session.occupancy !== null)!.occupancy = null;
    expect(violations(checkI4SingleWriterPerSession(released))).toEqual([expect.stringMatching(/is not occupied by its writer Run/)]);
    const maintenance = clone(flow.final);
    maintenance.sessions[0]!.occupancy = { kind: 'maintenance', operationRef: { aggregateType: 'CoreOperation', projectId,
      operationId: 'inv-op' } as never, generation: 3 };
    const sessionId = maintenance.sessions[0]!.ref.sessionId;
    expect(violations(checkI4SingleWriterPerSession(maintenance))).toEqual([`Session ${sessionId} is occupied (maintenance) without an unresolved writer`]);
    const twoWriters = clone(claimed);
    const session = twoWriters.sessions.find((candidate) => candidate.occupancy !== null)!;
    twoWriters.queryRuns.push(queryRun('q-second-writer', { status: 'running', executionState: executionState(session, 'entered', 99) }));
    expect(violations(checkI4SingleWriterPerSession(twoWriters))).toEqual([expect.stringMatching(/has 2 unresolved writers/)]);
    // An archived Session holds no occupancy.
    const archived = clone(flow.final);
    archived.sessions[0]!.lifecycle = 'archived';
    archived.sessions[0]!.occupancy = { kind: 'execution', executionRef: flowRecords(archived).run3!.ref, generation: 1 };
    expect(violations(checkI4SingleWriterPerSession(archived))).toEqual([
      `Session ${sessionId} is occupied (execution) without an unresolved writer`, `archived Session ${sessionId} is occupied`]);
  });

  it('I-5 checkI5SingleQueuedPointerIntent: the pointer names the one queued pointer intent (legacy only when it moved on)', () => {
    const claimed = observed('inv-flow-1:claim_task').world;
    expect(claimed.runs[0]!.controlState).toBeUndefined();
    const world = clone(claimed);
    const run = world.runs[0]!;
    const runId = run.ref.runId;
    const pause = intentRecord(run, 'inv-pause', 'pause', 'queued');
    world.intents.push(pause, intentRecord(run, 'inv-steer', 'steer', 'queued'));
    run.controlState = { intentRef: pause.ref, desiredState: 'paused' };
    run.controlInputs = [{ aggregateType: 'ControlIntent', projectId, workspaceId, intentId: 'inv-steer' }];
    expect(checkI5SingleQueuedPointerIntent(world)).toEqual([]);
    const mismatch = clone(world);
    mismatch.runs[0]!.controlState!.desiredState = 'running';
    expect(violations(checkI5SingleQueuedPointerIntent(mismatch))).toEqual([`Run ${runId} points at queued pause inv-pause with desiredState running`]);
    const superseded = clone(world);
    superseded.intents[0] = intentRecord(run, 'inv-pause', 'pause', 'superseded');
    expect(violations(checkI5SingleQueuedPointerIntent(superseded))).toEqual([`Run ${runId} still points at superseded intent inv-pause`]);
    const steer = clone(world);
    steer.runs[0]!.controlInputs = [];
    expect(violations(checkI5SingleQueuedPointerIntent(steer))).toEqual([`queued steer inv-steer is not among Run ${runId}'s control inputs`]);
    // A queued pointer intent the pointer does not name: a violation with no pointer (P1), with an older
    // pointer (P1b) or with a pointer intent outside the window ...
    const orphan = clone(claimed);
    orphan.intents.push(intentRecord(orphan.runs[0]!, 'inv-orphan', 'pause', 'queued'));
    expect(violations(checkI5SingleQueuedPointerIntent(orphan)))
      .toEqual([`queued pause intent inv-orphan is not Run ${runId}'s pointer (the Run has no pointer)`]);
    const newer = clone(world);
    newer.intents.push(intentRecord(run, 'inv-newer-cancel', 'cancel', 'queued', hostActor, LATER));
    expect(violations(checkI5SingleQueuedPointerIntent(newer)))
      .toEqual([`queued cancel intent inv-newer-cancel is not Run ${runId}'s pointer (the pointer names inv-pause, which was not submitted after it)`]);
    const gone = clone(world);
    gone.intents = gone.intents.filter((intent) => intent.ref.intentId !== 'inv-pause');
    gone.intents.push(intentRecord(run, 'inv-other-pause', 'pause', 'queued'));
    expect(violations(checkI5SingleQueuedPointerIntent(gone)))
      .toEqual([`queued pause intent inv-other-pause is not Run ${runId}'s pointer (the pointer intent inv-pause is not in the window)`]);
    // ... and legacy (pre-D-8, CTL-05) only when the pointer moved on to an intent submitted after it.
    const moved = clone(world);
    const old = intentRecord(run, 'inv-old-pause', 'pause', 'queued', hostActor, EARLIER);
    moved.intents.push(old);
    expect(violations(checkI5SingleQueuedPointerIntent(moved))).toEqual([]);
    expect(legacyOf(checkI5SingleQueuedPointerIntent(moved)))
      .toEqual([`queued pause intent inv-old-pause is not Run ${runId}'s pointer (pre-D-8 data: the pointer moved on to inv-pause)`]);
    // In a store the ControlIntentSubmitted order decides, not requestedAt.
    const logged = clone(moved);
    appendEvent(logged, { eventType: 'ControlIntentSubmitted', subject: refKey(pause.ref), controlKind: 'pause' });
    appendEvent(logged, { eventType: 'ControlIntentSubmitted', subject: refKey(old.ref), controlKind: 'pause' });
    expect(violations(checkI5SingleQueuedPointerIntent(logged)))
      .toEqual([`queued pause intent inv-old-pause is not Run ${runId}'s pointer (the pointer names inv-pause, which was not submitted after it)`]);
    // CTL-06: the natural terminal supersedes the still-queued pointer pause of an ended Run, whose pointer never moves.
    const terminal = clone(flow.final);
    const ended = flowRecords(terminal).run1;
    const settled = intentRecord(ended, 'inv-terminal-pause', 'pause', 'superseded');
    if (settled.status === 'queued') throw new Error('a superseded intent carries its observation');
    settled.observation = { ...settled.observation, kind: 'terminal_without_cancel' };
    terminal.intents.push(settled);
    ended.controlState = { intentRef: settled.ref, desiredState: 'paused' };
    expect(checkI5SingleQueuedPointerIntent(terminal)).toEqual([]);
    // Not on a yielded Run (CTL-06 is illegal on YieldedWait), and not on a Run that has not ended.
    const yielded = clone(terminal);
    const yieldedRun = flowRecords(yielded).run1;
    yieldedRun.outcome = 'yielded';
    yieldedRun.continuation = waitContinuation(yieldedRun);
    expect(violations(checkI5SingleQueuedPointerIntent(yielded))).toEqual([`Run ${ended.ref.runId} still points at superseded intent inv-terminal-pause`]);
    const live = clone(world);
    live.intents[0] = { ...settled, ref: { ...pause.ref }, runRef: { ...run.ref } };
    expect(violations(checkI5SingleQueuedPointerIntent(live))).toEqual([`Run ${runId} still points at superseded intent inv-pause`]);
  });

  it('I-6 checkI6EndingConsistency: Attempt, Run, Outbox and Lease end together', () => {
    expect(checkI6EndingConsistency(observed('inv-flow-1:claim_task').world)).toEqual([]);
    expect(checkI6EndingConsistency(flow.final)).toEqual([]);
    const { run1, run2, run3, attemptOf } = flowRecords(flow.final);
    const [a1, a2, a3] = [attemptOf(run1).ref.attemptId, attemptOf(run2!).ref.attemptId, attemptOf(run3!).ref.attemptId];
    const [r1, r3] = [run1.ref.runId, run3!.ref.runId];
    const changed = (change: (records: ReturnType<typeof flowRecords>) => void): string[] => {
      const world = clone(flow.final);
      change(flowRecords(world));
      return violations(checkI6EndingConsistency(world));
    };
    // o.status='settled' ⇔ ended known; 'pending' ⇒ starting (or unknown never entered); 'entered' ⇒ running (or unknown entered).
    expect(changed((records) => { records.outboxOf(records.run1).status = 'pending'; })).toEqual([
      `Outbox of ${a1} is pending while Run ${r1} is ended completed`, `Outbox of ${a1} is pending while Run ${r1} is ended completed`,
      `Attempt ${a1} (ended) pairs with Outbox status settled, not pending`]);
    expect(changed((records) => { records.outboxOf(records.run1).status = 'entered'; })).toEqual([
      `Outbox of ${a1} is entered while Run ${r1} is ended completed`, `Outbox of ${a1} is entered while Run ${r1} is ended completed`,
      `Attempt ${a1} (ended) pairs with Outbox status settled, not entered`]);
    // a.status='ended' ⇔ r.status='ended'; claimed ⇒ starting; started ⇒ running; endOutcome = outcome.
    expect(changed((records) => { records.attemptOf(records.run1).status = 'claimed'; }))
      .toEqual([`Attempt ${a1} is claimed while Run ${r1} is ended`, `claimed Attempt ${a1} has a ended Run`]);
    expect(changed((records) => { records.attemptOf(records.run1).status = 'started'; }))
      .toEqual([`Attempt ${a1} is started while Run ${r1} is ended`, `started Attempt ${a1} has a ended Run`]);
    expect(changed((records) => { records.attemptOf(records.run2!).endOutcome = 'cancelled'; }))
      .toEqual([`Attempt ${a2} ended cancelled, its Run completed`, `ended Attempt ${a2} has outcome cancelled, its Run completed`]);
    // A released Lease names its ended holder with a known outcome.
    expect(changed((records) => { records.lease.release!.runRef = { ...records.run1.ref }; }))
      .toEqual([`the Lease of work-1 was released by Run ${r1}, which is not its ended holder with a known outcome`]);
    // D-4: an unknown end keeps the Lease; the entered Attempt keeps its Outbox entered (L-2).
    expect(attemptOf(run3!).startedAt).not.toBeNull();
    expect(changed((records) => {
      const run = records.run3!;
      run.outcome = 'outcome_unknown';
      authOf(run).phase = 'unknown';
      records.attemptOf(run).endOutcome = 'outcome_unknown';
      records.outboxOf(run).status = 'entered';
    })).toEqual([`Attempt ${a3} ended outcome_unknown and released its Lease (D-4)`,
      `the Lease of work-1 was released by Run ${r3}, which is not its ended holder with a known outcome`]);
  });

  it('I-7 checkI7RoundConsistency: outcomes, check shapes and causes; finalized rounds and settled checks never change', () => {
    const { prev, world } = observed('inv-flow-3:finalize_checks');
    expect(checkI7RoundConsistency(world, prev)).toEqual([]);
    const { round1, round3 } = flowRecords(flow.final);
    const [r1, r3] = [round1!.ref.roundId, round3!.ref.roundId];
    const changed = (change: (records: ReturnType<typeof flowRecords>, world: InvariantWorld) => void, before?: InvariantWorld): string[] => {
      const next = clone(flow.final);
      change(flowRecords(next), next);
      return violations(checkI7RoundConsistency(next, before));
    };
    expect(changed((records) => { records.round3!.status = 'open'; })).toEqual([`open round ${r3} has outcome PASS`]);
    expect(changed((records) => {
      Object.assign(records.round1!.checks[0]!, { phase: 'executing', outcome: null, reportRef: null, sourceStatus: null, incompleteCause: null });
    })).toEqual([`finalized round ${r1} still has an executing check`, `FAIL round ${r1} has no finished FAIL check (D-2)`]);
    expect(changed((records) => { records.round3!.checks[0]!.outcome = 'FAIL'; }))
      .toEqual([`PASS round ${r3} has required check inv-check finished FAIL matched`]);
    expect(changed((records) => { for (const check of records.round1!.checks) check.outcome = 'PASS'; }))
      .toEqual([`FAIL round ${r1} has no finished FAIL check (D-2)`]);
    // D-2: the FAIL round's admitted Evidence holds a FAIL.
    expect(round1!.evidenceRefs.some((ref) => flow.final.evidence.find((e) => e.ref.evidenceId === ref.evidenceId)?.evidence.outcome === 'FAIL')).toBe(true);
    expect(changed((records, next) => {
      for (const ref of records.round1!.evidenceRefs) next.evidence.find((e) => e.ref.evidenceId === ref.evidenceId)!.evidence.outcome = 'PASS';
    })).toEqual([`FAIL round ${r1} admitted no applicable FAIL evidence (D-2)`]);
    expect(changed((records) => { records.round3!.checks[0]!.reportRef = null; }))
      .toEqual([`check inv-check of round ${r3} is finished with fields [true,true,false,true] (§9.1)`]);
    expect(changed((records) => { records.round1!.checks[0]!.incompleteCause = 'host_restart'; }))
      .toEqual([`check inv-check of round ${r1} is finished FAIL with cause host_restart (C5)`]);
    // Cross-step: a finalized round, a settled check and the chain never change.
    expect(changed((records) => { records.round1!.gaps.push({ code: 'late', message: 'a late gap' }); }, flow.final))
      .toEqual([`finalized round ${r1} changed`]);
    expect(changed((records) => { records.round3!.checks[0]!.invocationId = 'inv-other-invocation'; }, flow.final))
      .toEqual([`finished check inv-check of round ${r3} changed`]);
    expect(changed((records) => { records.round1!.chain!.basisDigests = ['inv-rewritten']; }, flow.final))
      .toEqual([`the chain of round ${r1} changed`]);
    // VD-4: a PASS with gaps written before the rule is legacy.
    const legacyPass = clone(flow.final);
    flowRecords(legacyPass).round3!.gaps.push({ code: 'uncovered_requirement', message: 'old' });
    expect(violations(checkI7RoundConsistency(legacyPass))).toEqual([]);
    expect(legacyOf(checkI7RoundConsistency(legacyPass))).toEqual([`round ${r3} is PASS with 1 gap(s) (before VD-4)`]);
  });

  it('I-8 checkI8MessageMonotone: status shapes; status, response and inputs only move forward', () => {
    const before = clone(flow.final);
    before.messages.push(sessionMessage('m-1', 'pending', null, false), sessionMessage('m-2', 'read', AT, false));
    const after = clone(before);
    after.messages[0] = { ...sessionMessage('m-1', 'responded', AT, true), revision: 2 };
    expect(checkI8MessageMonotone(before)).toEqual([]);
    expect(checkI8MessageMonotone(after, before)).toEqual([]);
    const noReadAt = clone(before);
    noReadAt.messages[1]!.readAt = null;
    expect(violations(checkI8MessageMonotone(noReadAt))).toEqual(['message m-2 is read with readAt null and no response']);
    const back = clone(before);
    back.messages[1] = sessionMessage('m-2', 'pending', null, false);
    expect(violations(checkI8MessageMonotone(back, before))).toEqual(['message m-2 went back from read to pending']);
    const rewritten = clone(after);
    rewritten.messages[0]!.response!.respondedAt = '2026-10-07T00:00:00.000Z';
    expect(violations(checkI8MessageMonotone(rewritten, after))).toEqual(['the response of message m-1 changed']);
    // acceptedInputs only append; consultationDerivation is written once.
    const inputs = clone(before);
    Object.assign(inputs.messages[0]!, { acceptedInputs: [{ inputId: 'inv-a' }, { inputId: 'inv-b' }] });
    const appended = clone(inputs);
    Object.assign(appended.messages[0]!, { acceptedInputs: [{ inputId: 'inv-a' }, { inputId: 'inv-b' }, { inputId: 'inv-c' }] });
    expect(checkI8MessageMonotone(appended, inputs)).toEqual([]);
    const dropped = clone(inputs);
    Object.assign(dropped.messages[0]!, { acceptedInputs: [{ inputId: 'inv-b' }] });
    expect(violations(checkI8MessageMonotone(dropped, inputs))).toEqual(['the accepted inputs of message m-1 were rewritten']);
    const derived = clone(before);
    Object.assign(derived.messages[0]!, { consultationDerivation: { queryJobId: 'inv-q-1' } });
    const rederived = clone(derived);
    Object.assign(rederived.messages[0]!, { consultationDerivation: { queryJobId: 'inv-q-2' } });
    expect(checkI8MessageMonotone(derived, before)).toEqual([]);
    expect(violations(checkI8MessageMonotone(rederived, derived))).toEqual(['the consultation derivation of message m-1 changed']);
  });

  it('I-9 checkI9NoAdmissionAfterGoalStop: claims, entries, rounds, checks, rework and resume commit only while the Goal is active', () => {
    expect(flow.final.events.filter((event) => event.eventType === 'TaskClaimed')).toHaveLength(3);
    expect(checkI9NoAdmissionAfterGoalStop(flow.final)).toEqual([]);
    const created = flow.final.events.find((event) => event.eventType === 'GoalCreated')!;
    const firstClaim = flow.final.events.find((event) => event.eventType === 'TaskClaimed')!;
    const stopped = clone(flow.final);
    stopped.events.push({ ...created, seq: firstClaim.seq - 0.5, eventType: 'GoalDesiredStateChanged', goalStateTo: 'paused' });
    expect(violations(checkI9NoAdmissionAfterGoalStop(stopped))).toContainEqual(`TaskClaimed committed at #${firstClaim.seq} while Goal inv-goal is paused`);
    // Resumed again before the claim: nothing was admitted while stopped.
    const resumed = clone(stopped);
    resumed.events.push({ ...created, seq: firstClaim.seq - 0.25, eventType: 'GoalDesiredStateChanged', goalStateTo: 'active' });
    expect(checkI9NoAdmissionAfterGoalStop(resumed)).toEqual([]);
    // Every admission kind and a Run resume after a cancel are reported; a pause is not an admission.
    const cancelled = clone(flow.final);
    appendEvent(cancelled, { eventType: 'GoalDesiredStateChanged', goalStateTo: 'cancelled', subject: refKey(goalRef) });
    const admitted = (['TaskClaimed', 'ExecutionEntryAuthorized', 'VerificationRoundOpened', 'VerificationCheckBegun', 'TaskRequeued',
      'TaskReworkRefused', 'VerificationRoundReverified'] as const).map((eventType) =>
      appendEvent(cancelled, { eventType, subject: `inv-${eventType}`, taskId: 'work-1' }));
    const resume = appendEvent(cancelled, { eventType: 'ControlIntentSubmitted', controlKind: 'resume', subject: 'inv-resume' });
    appendEvent(cancelled, { eventType: 'ControlIntentSubmitted', controlKind: 'pause', subject: 'inv-pause' });
    expect(violations(checkI9NoAdmissionAfterGoalStop(cancelled))).toEqual([
      ...admitted.map((event) => `${event.eventType} committed at #${event.seq} while Goal inv-goal is cancelled`),
      `ControlIntentSubmitted (resume) committed at #${resume.seq} while Goal inv-goal is cancelled`]);
  });

  it('I-10 checkI10RunNodeShape: the §6.1 node shapes, a continuation only on yielded, never failed', () => {
    expect(checkI10RunNodeShape(flow.final)).toEqual([]);
    expect(checkI10RunNodeShape(observed('inv-flow-1:claim_task').world)).toEqual([]);
    const continuation = clone(flow.final);
    const run = flowRecords(continuation).run1;
    run.continuation = waitContinuation(run);
    expect(violations(checkI10RunNodeShape(continuation))).toEqual([`Run ${run.ref.runId} ended completed with a continuation`]);
    const failed = clone(flow.final);
    const run2 = flowRecords(failed).run2!;
    run2.outcome = 'failed';
    expect(violations(checkI10RunNodeShape(failed))).toEqual([`Run ${run2.ref.runId}: the outcome failed has no writer`]);
  });

  it('I-11 checkI11QueryRunSettlement: answered/closed ⇔ settled ⇔ ended with an outcome', () => {
    const world = clone(flow.final);
    const session = world.sessions[0]!;
    world.queryRuns.push(queryRun('q-pending', {}),
      queryRun('q-answered', { status: 'answered', endedAt: AT, outcome: 'answered', executionState: executionState(session, 'settled', 1) }));
    expect(checkI11QueryRunSettlement(world)).toEqual([]);
    const early = clone(world);
    early.queryRuns[1]!.run.executionState!.phase = 'entered';
    expect(violations(checkI11QueryRunSettlement(early))).toEqual([`QueryRun q-answered is answered, phase entered, endedAt ${AT}, outcome answered`]);
    const unended = clone(world);
    unended.queryRuns[1]!.run.endedAt = null;
    expect(violations(checkI11QueryRunSettlement(unended))).toEqual(['QueryRun q-answered is answered, phase settled, endedAt null, outcome answered']);
  });

  /** checkI12RequeueFacts over a copy of `base` changed by `change`. */
  function requeueFacts(change: (records: ReturnType<typeof flowRecords>, world: InvariantWorld) => void,
    base: InvariantWorld = flow.final): string[] {
    const world = clone(base);
    change(flowRecords(world), world);
    return violations(checkI12RequeueFacts(world));
  }

  it('I-12 checkI12RequeueFacts, clauses 1–4: a known afterRun, its head and evidence, the class, the stop', () => {
    expect(checkI12RequeueFacts(flow.final)).toEqual([]);
    const { run1, round1 } = flowRecords(flow.final);
    const r1 = run1.ref.runId;
    // 1. The afterRun ended known; afterOutcome is its outcome; yielded only with a cancelled pointer (P17).
    expect(requeueFacts((records) => { records.requeue1.afterOutcome = 'crashed'; })).toEqual(['afterOutcome crashed ≠ Run outcome completed']);
    expect(requeueFacts((records) => { records.run1.outcome = 'outcome_unknown'; }))
      .toEqual([`the afterRun ${r1} is ended outcome_unknown`, 'the afterRun derives FC-2 (not_reworkable), not a rework class']);
    expect(requeueFacts((records) => {
      records.run1.outcome = 'yielded';
      records.run1.continuation = waitContinuation(records.run1);
      records.requeue1.afterOutcome = 'yielded';
    })).toEqual(['a yielded afterRun without a cancelled pointer (P17)', 'the afterRun derives FC-5 (no_rework), not a rework class']);
    // 2. afterRoundRef is the finalized non-PASS chain head; supersededEvidenceIds = chainEvidenceIds (TD-2).
    expect(requeueFacts((records) => { Object.assign(records.round1!, { outcome: 'PASS', gaps: [] }); }))
      .toEqual([`the head ${round1!.ref.roundId} is not finalized non-PASS`, 'the afterRun derives FC-17 (no_rework), not a rework class']);
    expect(requeueFacts((records) => { records.requeue1.afterRoundRef = null; })).toEqual([`afterRoundRef is null but Run ${r1} has a round chain`,
      'supersededEvidenceIds is not chainEvidenceIds(afterRoundRef) (TD-2)']);
    expect(requeueFacts((records) => { records.requeue1.supersededEvidenceIds = []; }))
      .toEqual(['supersededEvidenceIds is not chainEvidenceIds(afterRoundRef) (TD-2)']);
    // 3. The class re-derives (TD-8); check_incomplete only by a human, cancelled never by an agent; paused ⇔ isPausedInterrupted.
    expect(requeueFacts((records) => { records.requeue1.failureClass = 'run_failed'; }))
      .toEqual(['failureClass/interruption run_failed/null ≠ derived check_failed/null']);
    expect(requeueFacts((records) => {
      Object.assign(records.requeue1, { failureClass: 'check_incomplete', requestedBy: { ...WORKFLOW_AUTOMATION_ACTOR }, automation: counted(1) });
    })).toEqual(['failureClass/interruption check_incomplete/null ≠ derived check_failed/null',
      'a system requeued check_incomplete (only a human may; TASK-17)']);
    expect(requeueFacts((records) => {
      Object.assign(records.requeue1, { failureClass: 'cancelled', requestedBy: AGENT, agentProvenance: PROVENANCE, automation: counted(1) });
    })).toEqual(['failureClass/interruption cancelled/null ≠ derived check_failed/null', 'an agent requeued a cancelled Run (C2)']);
    expect(requeueFacts((records) => { Object.assign(records.requeue1, { failureClass: 'interrupted', interruption: 'paused' }); }))
      .toEqual(['failureClass/interruption interrupted/paused ≠ derived check_failed/null', 'interruption paused disagrees with isPausedInterrupted',
        'basisComparison compared ≠ skipped_interrupted']);
    expect(requeueFacts((records) => { records.requeue1.interruption = 'executing'; }))
      .toEqual(['failureClass/interruption check_failed/executing ≠ derived check_failed/null', 'interruption is set exactly for class interrupted']);
    // 4. The stop is the pause or cancel pointer and its requester; any other pointer, or none, gives null/none.
    expect(requeueFacts((records) => { records.requeue1.stopRequester = 'human'; })).toEqual(['stop null/human ≠ derived null/none']);
    const stopped = (kind: 'pause' | 'resume', recorded: boolean): string[] => requeueFacts((records, world) => {
      const intent = intentRecord(records.run1, `inv-stop-${kind}`, kind, 'applied');
      world.intents.push(intent);
      records.run1.controlState = { intentRef: intent.ref, desiredState: intent.desiredState };
      if (recorded) Object.assign(records.requeue1, { stopIntentRef: { ...intent.ref }, stopRequester: 'human' });
    });
    expect(stopped('pause', false)).toEqual(['stop null/none ≠ derived inv-stop-pause/human']);
    expect(stopped('pause', true)).toEqual([]);
    expect(stopped('resume', false)).toEqual([]);
    expect(stopped('resume', true)).toEqual(['stop inv-stop-resume/human ≠ derived null/none']);
  });

  it('I-12 clauses 5–8: the key comparison, the actor and trigger, the automatic count and cap, the budget', () => {
    const { run2 } = flowRecords(flow.final);
    // 5. The comparison record follows the class and actor; a compared key differs from every earlier one (ND-3).
    expect(requeueFacts((records) => { records.requeue1.basisComparison = 'skipped_interrupted'; }))
      .toEqual(['basisComparison skipped_interrupted ≠ compared']);
    expect(requeueFacts((records) => { records.requeue2!.basis.digest = records.requeue1.basis.digest; }))
      .toEqual([expect.stringMatching(/^the compared key equals earlier TaskRequeue /)]);
    // 6. agent ⇔ agentProvenance; a trigger exactly for GOAL_FAN_OUT_ACTOR, on a fan-out pause (GOAL-29).
    expect(requeueFacts((records) => { records.requeue1.agentProvenance = PROVENANCE; }))
      .toEqual(['agentProvenance does not match actor class human']);
    expect(requeueFacts((records) => { records.requeue1.trigger = { kind: 'goal_resume', goalRef, resumedEpoch: 3, pausedEpoch: 2 }; }))
      .toEqual(['a trigger with requestedBy human:inv-operator (a trigger exactly for GOAL_FAN_OUT_ACTOR, GOAL-29)',
        'a Goal-resume continuation continues a fan-out pause (goal_resume, paused, goal_fan_out)']);
    // 7. automatic ⇔ system/agent, counted ⇔ automatic ∧ not interrupted, cap ≤ 10, autoCount re-derived, counted ⇒ ≤ cap.
    const humanAutomation = /^automation \{.*\} ≠ \{automatic:false, counted:false, autoCount:0, cap null\}$/;
    expect(requeueFacts((records) => { records.requeue1.automation.autoCount = 1; })).toEqual([expect.stringMatching(humanAutomation)]);
    expect(requeueFacts((records) => { records.requeue1.automation.automatic = true; })).toEqual([expect.stringMatching(humanAutomation)]);
    expect(requeueFacts((records) => { records.requeue1.automation.cap = 3; })).toEqual([expect.stringMatching(humanAutomation)]);
    const system = (change: (records: ReturnType<typeof flowRecords>, world: InvariantWorld) => void = () => undefined): string[] =>
      requeueFacts((records, world) => {
        Object.assign(records.requeue1, { requestedBy: { ...WORKFLOW_AUTOMATION_ACTOR }, automation: counted(1) });
        Object.assign(records.requeue2!, { requestedBy: { ...WORKFLOW_AUTOMATION_ACTOR }, automation: counted(2) });
        change(records, world);
      });
    expect(system()).toEqual([]);
    expect(system((records) => { records.requeue2!.automation = counted(1); }))
      .toEqual(['automation {"automatic":true,"counted":true,"autoCount":1,"cap":3} ≠ {automatic:true, counted:true, autoCount:2, cap 0..10}']);
    expect(system((records) => { records.requeue1.automation = counted(1, 11); }))
      .toEqual(['automation {"automatic":true,"counted":true,"autoCount":1,"cap":11} ≠ {automatic:true, counted:true, autoCount:1, cap 0..10}']);
    expect(system((records) => { records.requeue1.automation = counted(1, 0); })).toEqual(['autoCount 1 exceeds the cap 0']);
    // The prior count is walked back over consumedWait to the first Run with a requeueRef (here Run 2's requeue, autoCount 1).
    const viaWait = (autoCount: number): string[] => system((records, world) => {
      const cont: RunSnapshot = { ...structuredClone(records.run2!), ref: { ...records.run2!.ref, runId: 'inv-cont' },
        consumedWait: consumedWait(records.run2!.ref) };
      delete cont.requeueRef;
      world.runs.push(cont);
      world.requeues.push({ ...structuredClone(records.requeue2!), ref: { ...records.requeue2!.ref, afterRunId: 'inv-cont' },
        afterRunRef: { ...cont.ref }, afterRoundRef: null, supersededEvidenceIds: [], basis: { ...records.requeue2!.basis, digest: 'inv-key-3' },
        automation: counted(autoCount) });
    });
    expect(viaWait(2)).toEqual(['the afterRun derives FC-12 (no_rework), not a rework class']);
    expect(viaWait(1)).toEqual(['the afterRun derives FC-12 (no_rework), not a rework class',
      'automation {"automatic":true,"counted":true,"autoCount":1,"cap":3} ≠ {automatic:true, counted:true, autoCount:2, cap 0..10}']);
    // A requeueRef whose TaskRequeue is not in the window is damage.
    expect(requeueFacts((records, world) => { world.requeues = world.requeues.filter((requeue) => requeue !== records.requeue1); }))
      .toEqual([`Run ${run2!.ref.runId} claimed with TaskRequeue ${flowRecords(flow.final).run1.ref.runId}, which is not in the window`]);
    // 8. An agent has no budget; after budget_exhausted a larger budget or a new input.
    expect(requeueFacts((records) => {
      Object.assign(records.requeue1, { requestedBy: AGENT, agentProvenance: PROVENANCE, automation: counted(1),
        budget: { tokenBudget: 5, deadline: null } });
    })).toEqual(['an agent requeue carries a budget', `Run ${run2!.ref.runId} budget differs from the pinned budget`]);
    expect(requeueFacts((records) => { records.run1.outcome = 'budget_exhausted'; records.requeue1.afterOutcome = 'budget_exhausted'; }))
      .toEqual(['failureClass/interruption check_failed/null ≠ derived run_failed/null',
        'a requeue after budget_exhausted has neither a larger budget nor a new input']);
    expect(requeueFacts((records) => {
      records.run1.outcome = 'budget_exhausted';
      records.requeue1.afterOutcome = 'budget_exhausted';
      records.requeue1.newInputRefs = structuredClone(records.requeue2!.newInputRefs);
    })).toEqual(['failureClass/interruption check_failed/null ≠ derived run_failed/null']);
  });

  it('I-12 clauses 9–10 and the step-local clause: one claim per requeue, the history source, the step that wrote it', () => {
    const { run1, run2, run3, outboxOf } = flowRecords(flow.final);
    const [r2, r3] = [run2!.ref.runId, run3!.ref.runId];
    // 9. At most one Run claims with it, for its Task, without a consumed wait, recorded on its Attempt, with the pinned budget.
    expect(requeueFacts((records) => { records.run3!.requeueRef = { ...records.requeue1.ref }; }))
      .toEqual(['2 Runs claim with this TaskRequeue', `the Attempt of Run ${r3} does not record this requeueRef`]);
    expect(requeueFacts((records, world) => {
      world.runs.push({ ...structuredClone(records.run2!), ref: { ...records.run2!.ref, runId: 'inv-other-task-run' },
        task: { ...records.run2!.task, taskId: 'inv-other-task' }, attemptId: 'inv-other-attempt' });
    })).toEqual(['2 Runs claim with this TaskRequeue', 'Run inv-other-task-run claims it for another Task',
      'the Attempt of Run inv-other-task-run does not record this requeueRef']);
    expect(requeueFacts((records) => { records.run2!.consumedWait = consumedWait(records.run1.ref); }))
      .toEqual([`Run ${r2} claims it and consumes a wait`]);
    expect(requeueFacts((records) => { records.requeue1.budget = { tokenBudget: 1, deadline: null }; }))
      .toEqual([`Run ${r2} budget differs from the pinned budget`]);
    // 10. An entered afterRun names its claim Session; an un-entered one inherits its requeueRef's source (LA-1).
    expect(run1.executionHistory).toBeDefined();
    expect(flowRecords(flow.final).requeue1.historySource).not.toBeNull();
    expect(requeueFacts((records) => { records.requeue1.historySource!.sessionRef.sessionId = 'inv-other-session'; }))
      .toEqual([`historySource names Session inv-other-session, not the claim Session ${outboxOf(run1).claim.sessionRef.sessionId}`]);
    expect(requeueFacts((records) => { delete records.run2!.executionHistory; records.requeue2!.historySource = null; }))
      .toEqual(['the historySource of an un-entered afterRun is not the one its requeueRef carries']);
    expect(requeueFacts((records) => {
      delete records.run2!.executionHistory;
      records.requeue2!.historySource = structuredClone(records.requeue1.historySource);
    })).toEqual([]);
    // Step-local (task_requeued): the afterRun was prev's selected, resolved Run; the Task and the Goal are active.
    const requeued = observed('requeue-1');
    expect(checkI12RequeueFacts(requeued.world, requeued.prev, requeued.step)).toEqual([]);
    const local = (world: InvariantWorld, prev: InvariantWorld | undefined = requeued.prev, taken: FuzzStep = requeued.step!): string[] =>
      violations(checkI12RequeueFacts(world, prev, taken));
    const paused = clone(requeued.world);
    paused.goals[0]!.desiredState = 'paused';
    expect(local(paused)).toEqual(['Goal inv-goal is not active']);
    const deferred = clone(requeued.world);
    deferred.plans[0]!.tasks.find((task) => task.taskId === 'work-1')!.disposition = 'deferred';
    expect(local(deferred)).toEqual(['Task work-1 is deferred']);
    const stale = clone(requeued.prev!);
    stale.taskStates.find((state) => state.taskId === 'work-1')!.selectedRunRef = null;
    expect(local(requeued.world, stale)).toEqual([`the afterRun ${run1.ref.runId} was not the selected Run before the step`]);
    const unresolvedBefore = clone(requeued.prev!);
    expect(unresolvedBefore.runs).toHaveLength(1);
    Object.assign(unresolvedBefore.runs[0]!, { status: 'running', outcome: null });
    expect(local(requeued.world, unresolvedBefore)).toEqual([`the afterRun ${run1.ref.runId} was unresolved`]);
    // Clause 7's cap is the limit in effect when the automatic requeue was written.
    const automatic = clone(requeued.world);
    Object.assign(flowRecords(automatic).requeue1, { requestedBy: { ...WORKFLOW_AUTOMATION_ACTOR }, automation: counted(1) });
    expect(local(automatic, requeued.prev, { ...requeued.step!, automationPolicy: automation(3) })).toEqual([]);
    expect(local(automatic, requeued.prev, { ...requeued.step!, automationPolicy: automation(5) }))
      .toEqual(['the automatic requeue records cap 3, not the limit 5 in effect']);
  });

  it('I-13 checkI13EvidenceIndex: revision = id count ≥ 1 (an @0 index is legacy)', () => {
    expect(flow.final.evidenceIndexes.length).toBeGreaterThan(0);
    expect(checkI13EvidenceIndex(flow.final)).toEqual([]);
    const skipped = clone(flow.final);
    skipped.evidenceIndexes[0]!.revision += 1;
    expect(violations(checkI13EvidenceIndex(skipped))).toEqual([expect.stringMatching(/^TaskEvidenceIndex of .* is @\d+ with \d+ id\(s\)$/)]);
    const empty = clone(flow.final);
    empty.evidenceIndexes[0]!.revision = 0;
    empty.evidenceIndexes[0]!.evidenceIds = [];
    expect(violations(checkI13EvidenceIndex(empty))).toEqual([]);
    expect(checkI13EvidenceIndex(empty)).toMatchObject([{ invariant: 'I-13', legacy: true }]);
  });

  it('I-14 checkI14CompletedGoalIsActive: a GoalPhase of the active Plan has an active Goal', () => {
    expect(checkI14CompletedGoalIsActive(flow.final)).toEqual([]);
    const paused = clone(flow.final);
    paused.goals[0]!.desiredState = 'paused';
    expect(violations(checkI14CompletedGoalIsActive(paused))).toEqual(['Goal inv-goal has a GoalPhase of its active Plan while paused']);
    // A GoalPhase of an older Plan is out of scope (D-17).
    paused.goalPhases[0]!.planRef = { aggregateType: 'PlanRevision', projectId, planId: 'inv-older-plan' };
    expect(checkI14CompletedGoalIsActive(paused)).toEqual([]);
  });

  it('I-15 checkI15Monotone: records only move forward; write-once fields and immutable records never change', () => {
    expect(checkI15Monotone(flow.afterRefusal, flow.beforeRefusal)).toEqual([]);
    expect(checkI15Monotone(flow.final)).toEqual([]);
    const { run1, round1, attemptOf } = flowRecords(flow.final);
    const [r1, a1] = [run1.ref.runId, attemptOf(run1).ref.attemptId];
    const changed = (change: (records: ReturnType<typeof flowRecords>, world: InvariantWorld) => void, before = flow.final): string[] => {
      const next = clone(before);
      change(flowRecords(next), next);
      return violations(checkI15Monotone(next, before));
    };
    expect(changed((records, next) => {
      records.run1.status = 'running';
      records.attemptOf(records.run2!).status = 'claimed';
      records.plan.tasks[0]!.title = 'Rewritten';
      records.requeue1.reason = 'rewritten';
      next.evidence.pop();
    })).toEqual([`Run ${r1} went back from ended to running`, `Attempt ${attemptOf(flowRecords(flow.final).run2!).ref.attemptId} went back from ended to claimed`,
      'PlanRevision is immutable and changed', 'Evidence disappeared', 'TaskRequeue is immutable and changed']);
    expect(changed((records) => { records.run1.outcome = 'crashed'; })).toEqual([`Run ${r1} changed its outcome completed to crashed`]);
    // outcome_unknown is left only with a RUN-21/22 reconciliation.
    const unknownBefore = clone(flow.final);
    flowRecords(unknownBefore).run1.outcome = 'outcome_unknown';
    expect(violations(checkI15Monotone(flow.final, unknownBefore))).toEqual([`Run ${r1} left outcome_unknown without RUN-21/22 (undefined)`]);
    const attested = clone(flow.final);
    flowRecords(attested).run1.reconciliation = { status: 'done', recordedAt: AT,
      observation: { kind: 'human_attested' } } as unknown as NonNullable<RunSnapshot['reconciliation']>;
    expect(checkI15Monotone(attested, unknownBefore)).toEqual([]);
    // Claim fields, terminalPayload and inputBinding are written once.
    expect(changed((records) => { records.run1.attemptId = 'inv-other-attempt'; })).toEqual([`Run ${r1} changed its claim field attemptId`]);
    expect(run1.terminalPayload).toBeDefined();
    expect(changed((records) => { records.run1.terminalPayload = { kind: 'crashed', error: 'rewritten' } as never; }))
      .toEqual([`Run ${r1} rewrote its terminalPayload`]);
    expect(changed((records) => { records.run1.inputBinding!.inputDigest = sha256Hex('rebound'); })).toEqual([`Run ${r1} rewrote its inputBinding`]);
    // The entry phase never goes back; the generation never decreases; Revoked → Authorized needs RUN-03's new generation.
    expect(changed((records) => { authOf(records.run1).phase = 'authorized'; }))
      .toEqual([`Run ${r1} went back from entry phase settled to authorized`, `Run ${r1} left the settled entry phase`]);
    expect(changed((records) => { authOf(records.run1).generation -= 1; })).toEqual([`Run ${r1} entry generation went back`]);
    for (const from of ['revoked', 'entering'] as const) {
      const before = clone(flow.final);
      authOf(flowRecords(before).run1).phase = from;
      expect(changed((records) => { authOf(records.run1).phase = 'authorized'; }, before))
        .toEqual([`Run ${r1} went from entry phase ${from} to authorized without a new generation (RUN-16/RUN-03)`]);
      expect(changed((records) => { authOf(records.run1).phase = 'authorized'; authOf(records.run1).generation += 1; }, before)).toEqual([]);
    }
    // Attempts and Outboxes only move forward; a known end and a settled Outbox never change.
    expect(changed((records) => { records.attemptOf(records.run1).endOutcome = 'crashed'; }))
      .toEqual([`Attempt ${a1} changed its known end completed to crashed`]);
    expect(changed((records) => { records.outboxOf(records.run1).status = 'entered'; })).toEqual([`Outbox ${a1} went back from settled to entered`]);
    expect(changed((records) => {
      const outbox = records.outboxOf(records.run1);
      outbox.claim = { ...outbox.claim, generation: outbox.claim.generation + 1 };
    })).toEqual([`settled Outbox ${a1} changed`]);
    // A record never loses revisions; the round chain is written once.
    const session = flow.final.sessions[0]!;
    expect(changed((_, next) => { next.sessions[0]!.revision -= 1; }))
      .toEqual([`Session went back from @${session.revision} to @${session.revision - 1}`]);
    expect(changed((records) => { records.round1!.chain!.basisDigests = ['inv-rewritten']; })).toEqual([`the chain of round ${round1!.ref.roundId} changed`]);
    // Settled intents never change; outcome_unknown never returns to queued (CTL-07).
    const withIntents = clone(flow.final);
    withIntents.intents.push(intentRecord(run1, 'inv-applied', 'pause', 'applied'),
      { ...intentRecord(run1, 'inv-unknown', 'cancel', 'applied'), status: 'outcome_unknown' } as ControlIntentSnapshotV1);
    const intentAt = (world: InvariantWorld, intentId: string): number => world.intents.findIndex((intent) => intent.ref.intentId === intentId);
    expect(changed((_, next) => { next.intents[intentAt(next, 'inv-applied')]!.reason = 'rewritten'; }, withIntents))
      .toEqual(['applied intent inv-applied changed']);
    expect(changed((_, next) => {
      next.intents[intentAt(next, 'inv-unknown')] = { ...intentRecord(run1, 'inv-unknown', 'cancel', 'queued'), revision: 2 } as ControlIntentSnapshotV1;
    }, withIntents)).toEqual(['intent inv-unknown went back from outcome_unknown to queued']);
  });

  it('I-16 checkI16PausedInterrupted: a Run the restart ended while paused agrees with its pause intent and projects P19', () => {
    const base = clone(flow.afterRequeue);
    base.requeues = [];
    const run = flowRecords(flow.afterRequeue).run1;
    const r1 = run.ref.runId;
    const pause = pausedInterrupted(base, run);
    Object.assign(base.taskStates.find((candidate) => candidate.taskId === 'work-1')!,
      { phase: 'blocked', cause: { code: 'paused_interrupted' }, selectedRunRef: run.ref, coveringRequeueRef: null });
    expect(checkI16PausedInterrupted(base)).toEqual([]);
    const changed = (change: (world: InvariantWorld, target: RunSnapshot) => void): string[] => {
      const world = clone(base);
      change(world, world.runs.find((candidate) => candidate.ref.runId === r1)!);
      return violations(checkI16PausedInterrupted(world));
    };
    expect(changed((world) => { world.intents[world.intents.length - 1] = intentRecord(run, `pause-${r1}`, 'pause', 'queued'); }))
      .toEqual([`the pause intent pause-${r1} of Run ${r1} is pause queued, not an applied pause`]);
    expect(changed((_, target) => { target.controlState = { intentRef: pause.ref, desiredState: 'running' }; }))
      .toEqual([`paused-interrupted Run ${r1} does not point at its pause intent pause-${r1}`]);
    expect(changed((_, target) => { target.outcome = 'cancelled'; }))
      .toEqual([`paused-interrupted Run ${r1} ended cancelled, not crashed`, `cancelled Run ${r1} names a paused intent (RUN-23 is a cancel)`]);
    expect(changed((world) => {
      Object.assign(world.taskStates.find((candidate) => candidate.taskId === 'work-1')!, { phase: 'failed', cause: { code: 'run_failed' } });
    })).toEqual([`Task work-1 of paused-interrupted Run ${r1} projects failed/run_failed, not blocked/paused_interrupted (P19)`]);
    // The continuation is a paused-interruption requeue by a human (or the Goal-resume fan-out).
    const requeue1 = flowRecords(flow.afterRequeue).requeue1;
    expect(changed((world) => { world.requeues.push({ ...structuredClone(requeue1), interruption: 'paused' }); })).toEqual([]);
    expect(changed((world) => { world.requeues.push(structuredClone(requeue1)); }))
      .toEqual([`the continuation of Run ${r1} has interruption null`]);
    expect(changed((world) => {
      world.requeues.push({ ...structuredClone(requeue1), interruption: 'paused', requestedBy: { ...WORKFLOW_AUTOMATION_ACTOR } });
    })).toEqual([`Run ${r1} was continued automatically, not by a human or the Goal-resume fan-out`]);
  });

  it('I-17 checkI17HumanStopRespected: only a human restarts what a human stopped', () => {
    const fenced = clone(flow.final);
    const records = flowRecords(fenced);
    const r1 = records.run1.ref.runId;
    const cancel = intentRecord(records.run1, 'inv-cancel', 'cancel', 'applied');
    fenced.intents.push(cancel);
    records.run1.controlState = { intentRef: cancel.ref, desiredState: 'cancelled' };
    expect(checkI17HumanStopRespected(fenced)).toEqual([]);
    const automatic = clone(fenced);
    flowRecords(automatic).requeue1.requestedBy = { ...WORKFLOW_AUTOMATION_ACTOR };
    expect(violations(checkI17HumanStopRespected(automatic))).toEqual([`a system requeued Run ${r1}, which a human stopped`]);
    // The pointer intent must be in the window to know the fence.
    const unknownFence = clone(fenced);
    unknownFence.intents = unknownFence.intents.filter((intent) => intent.ref.intentId !== 'inv-cancel');
    expect(violations(checkI17HumanStopRespected(unknownFence))).toEqual([`the fence of Run ${r1} is unknown: its pointer intent is not in the window`]);
    // A Goal fan-out pause: the Goal-resume continuation may continue it, the Workflow may not.
    const fanOut = clone(flow.afterRequeue);
    pausedInterrupted(fanOut, flowRecords(fanOut).run1, { ...GOAL_FAN_OUT_ACTOR });
    const continuation = fanOut.requeues[0]!;
    continuation.requestedBy = { ...GOAL_FAN_OUT_ACTOR };
    continuation.trigger = { kind: 'goal_resume', goalRef, resumedEpoch: 3, pausedEpoch: 2 };
    expect(checkI17HumanStopRespected(fanOut)).toEqual([]);
    const byWorkflow = clone(fanOut);
    delete byWorkflow.requeues[0]!.trigger;
    byWorkflow.requeues[0]!.requestedBy = { ...WORKFLOW_AUTOMATION_ACTOR };
    expect(violations(checkI17HumanStopRespected(byWorkflow)))
      .toEqual([`a system requeued Run ${r1} paused by the Goal fan-out without the Goal-resume trigger`]);
    // A reverify successor on a fenced Run (VR-14).
    const reverified = clone(fenced);
    const round1 = flowRecords(reverified).round1!;
    round1.chain!.reverify = { requestedBy: { ...WORKFLOW_AUTOMATION_ACTOR }, actorClass: 'system' } as never;
    expect(violations(checkI17HumanStopRespected(reverified))).toEqual([`a system reverified round ${round1.ref.roundId} of a Run a human stopped (fence human_only)`]);
    // Step-local PLAN-05 guards 7 and 9: an automatic adopter touches no fenced traced Task and adds no parallel carrier.
    const prev = clone(flow.final);
    const fencedRun = flowRecords(prev).run3!;
    const stop = intentRecord(fencedRun, 'inv-stop', 'pause', 'applied');
    prev.intents.push(stop);
    fencedRun.controlState = { intentRef: stop.ref, desiredState: 'paused' };
    const adoptedBy = (entryActor: ActorRef): InvariantWorld => {
      const adopted = clone(prev);
      adoptedPlan(adopted, (plan) => {
        plan.dispositionRecord = { schemaVersion: 1, entries: [{ taskId: 'work-1', from: 'active', to: 'deferred', replacedByTaskId: null,
          traced: true, setIn: plan.ref, proposalRef: { aggregateType: 'PlanProposal', projectId, workspaceId, proposalId: 'p2' },
          reason: { text: 'defer', sources: [], affectedTaskIds: ['work-1'] }, actor: entryActor }] };
        plan.tasks.push({ ...structuredClone(plan.tasks[0]!), taskId: 'work-2', title: 'Parallel carrier' });
        plan.obligations[0]!.taskIds.push('work-2');
      });
      return adopted;
    };
    const system: FuzzStep = { kind: 'plan_adopted', actor: { ...WORKFLOW_AUTOMATION_ACTOR }, automationPolicy: automation(3) };
    const human: FuzzStep = { ...system, actor: hostActor };
    const guard7 = 'a system changed the disposition of traced Task work-1 (fence human_only; TASK-19 guard 7)';
    const guard9 = 'a system added carrier(s) work-2 for obligation inv-obligation, whose carriers a human stopped (guard 9)';
    expect(violations(checkI17HumanStopRespected(adoptedBy({ ...WORKFLOW_AUTOMATION_ACTOR }), prev, system))).toEqual([guard7, guard9]);
    // Guard 7 classifies the persisted entry's actor, guard 9 the step's adopter.
    expect(violations(checkI17HumanStopRespected(adoptedBy({ ...WORKFLOW_AUTOMATION_ACTOR }), prev, human))).toEqual([guard7]);
    expect(violations(checkI17HumanStopRespected(adoptedBy(hostActor), prev, system))).toEqual([guard9]);
    expect(checkI17HumanStopRespected(adoptedBy(hostActor), prev, human)).toEqual([]);
  });

  it('I-18 checkI18RefusalLog: revisions, codes, subjects, the cap, the matched key, the watermark', () => {
    expect(checkI18RefusalLog(flow.final)).toEqual([]);
    const { run2, round1 } = flowRecords(flow.final);
    const r2 = run2!.ref.runId;
    const refusalFacts = (change: (records: ReturnType<typeof flowRecords>, world: InvariantWorld) => void,
      base: InvariantWorld = flow.final): string[] => {
      const world = clone(base);
      change(flowRecords(world), world);
      return violations(checkI18RefusalLog(world));
    };
    expect(refusalFacts((records) => {
      Object.assign(records.refusal!, { revision: 2, code: 'source_unchanged', goalEndedRunsAtRefusal: 99, configurationRevision: 'inv-checks-1' });
    })).toEqual(['refusal @2 has TaskReworkRefused revisions [1]', 'code source_unchanged does not belong to operation requeue (ND-8)',
      `watermark 99 exceeds the ${flow.final.runs.filter((run) => run.status === 'ended').length} ended Goal Runs`,
      'configurationRevision inv-checks-1 for requeue source_unchanged (LA-4)']);
    expect(refusalFacts((records) => { records.refusal!.matchedRequeueRef = null; }))
      .toEqual(['a no_new_basis requeue refusal names no TaskRequeue of the same Task with the same key']);
    expect(refusalFacts((records) => { records.refusal!.code = 'auto_rework_cap_reached'; })).toEqual(['the cap refused a human']);
    expect(refusalFacts((records) => { records.refusal!.failureClass = 'interrupted'; })).toEqual(['an interrupted class is never refused by policy']);
    expect(refusalFacts((records) => { records.run2!.outcome = 'outcome_unknown'; })).toEqual([`the afterRun ${r2} has no known end (hard limit 1)`]);
    expect(refusalFacts((records) => { records.refusal!.ref.subjectId = 'inv-other-subject'; }))
      .toEqual(['refusal @1 has TaskReworkRefused revisions []', 'a requeue refusal is keyed by its afterRun']);
    // A reverify refusal: keyed by its finalized non-PASS round, with its class and its configuration revision (LA-4).
    const reverifying = clone(flow.final);
    reverifyRefusal(reverifying, flowRecords(reverifying).round2!);
    expect(checkI18RefusalLog(reverifying)).toEqual([]);
    const reverifyOf = (world: InvariantWorld): TaskReworkRefusalSnapshotV1 =>
      world.refusals.find((refusal) => refusal.ref.operation === 'reverify')!;
    expect(refusalFacts((records) => { Object.assign(records.round2!, { status: 'open', outcome: null }); }, reverifying))
      .toEqual(['the refused round is not a finalized non-PASS round']);
    expect(refusalFacts((_, world) => { reverifyOf(world).failureClass = 'check_incomplete'; }, reverifying))
      .toEqual(['failureClass check_incomplete ≠ check_failed']);
    expect(refusalFacts((_, world) => { reverifyOf(world).subjectRoundRef = { ...round1!.ref }; }, reverifying))
      .toEqual(['a reverify refusal is keyed by its subject round']);
    expect(refusalFacts((_, world) => { reverifyOf(world).configurationRevision = null; }, reverifying))
      .toEqual(['configurationRevision null for reverify no_new_basis (LA-4)']);
    // Cross-step: the revision and the watermark never go back; a refusal changes only through task_rework_refused.
    const lowered = clone(flow.afterRefusal);
    flowRecords(lowered).refusal!.goalEndedRunsAtRefusal -= 1;
    expect(violations(checkI18RefusalLog(lowered, flow.afterRefusal))).toEqual([expect.stringMatching(/^refusal went from @1\/\d+ to @1\/\d+$/),
      'refusal @1 changed without a new revision']);
    expect(violations(checkI18RefusalLog(flow.afterRefusal, flow.beforeRefusal, step('other', 'not a refusal'))))
      .toEqual(['refusal @1 was written by a other step, not task_rework_refused']);
  });

  it('I-18 step-local (task_rework_refused): the refused Run or head was current, the Goal active, nothing else written', () => {
    const refused = step('task_rework_refused', 'refusal');
    expect(checkI18RefusalLog(flow.afterRefusal, flow.beforeRefusal, refused)).toEqual([]);
    const r2 = flowRecords(flow.final).run2!.ref.runId;
    const local = (world: InvariantWorld, prev: InvariantWorld = flow.beforeRefusal): string[] => violations(checkI18RefusalLog(world, prev, refused));
    const stale = clone(flow.beforeRefusal);
    stale.taskStates.find((state) => state.taskId === 'work-1')!.selectedRunRef = null;
    expect(local(flow.afterRefusal, stale)).toEqual([`the refused afterRun ${r2} was not the selected Run`]);
    const paused = clone(flow.afterRefusal);
    paused.goals[0]!.desiredState = 'paused';
    expect(local(paused)).toEqual(['Goal inv-goal is not active']);
    const extra = clone(flow.afterRefusal);
    extra.sessions[0]!.revision += 1;
    expect(local(extra)).toEqual(['the refusal step wrote a Run, Attempt, Lease, Session, round or TaskRequeue']);
    // Run 2 already requeued before the step (the requeue is in both worlds, so nothing else was written).
    const covered = (world: InvariantWorld): InvariantWorld => {
      const next = clone(world);
      const records = flowRecords(next);
      next.requeues.push({ ...structuredClone(records.requeue1), ref: { ...records.requeue1.ref, afterRunId: r2 }, afterRunRef: { ...records.run2!.ref } });
      return next;
    };
    expect(local(covered(flow.afterRefusal), covered(flow.beforeRefusal))).toEqual([`the refused afterRun ${r2} was already requeued`]);
    const coveredReverify = covered(flow.afterRefusal);
    reverifyRefusal(coveredReverify, flowRecords(coveredReverify).round2!);
    expect(local(coveredReverify, covered(flow.beforeRefusal)))
      .toEqual([`the refused afterRun ${r2} was already requeued`, `the subject Run ${r2} was already requeued`]);
    // A reverify refusal on a round that was no longer its chain head before the step.
    const headPrev = clone(flow.beforeRefusal);
    headPrev.rounds.push(successor(flowRecords(headPrev).round2!, 'inv-head', hostActor, 'human', 'inv-key-head'));
    const headWorld = clone(flow.afterRefusal);
    headWorld.rounds.push(structuredClone(headPrev.rounds.at(-1)!));
    reverifyRefusal(headWorld, flowRecords(headWorld).round2!);
    expect(local(headWorld, headPrev)).toEqual(['the refused round was not its subject chain head']);
  });

  it('I-19 checkI19ContinuationBriefBinding: a requeue Run binds exactly the brief its manifest carries', () => {
    expect(flow.final.manifests).toHaveLength(2);
    expect(checkI19ContinuationBriefBinding(flow.final, observed('inv-flow-gate:complete_goal').prev)).toEqual([]);
    const { run2, run3 } = flowRecords(flow.final);
    const [r2, r3] = [run2!.ref.runId, run3!.ref.runId];
    const changed = (change: (records: ReturnType<typeof flowRecords>, world: InvariantWorld) => void, before?: InvariantWorld): string[] => {
      const next = clone(flow.final);
      change(flowRecords(next), next);
      return violations(checkI19ContinuationBriefBinding(next, before));
    };
    expect(changed((records) => { delete records.run2!.inputBinding!.continuationBriefDigest; }))
      .toEqual([`Run ${r2} has a requeueRef and no brief digest`]);
    expect(changed((records) => { records.run2!.consumedWait = consumedWait(records.run1.ref); })).toEqual([`continuation Run ${r2} binds a brief`]);
    expect(changed((records) => { records.run3!.inputBinding!.continuationBriefDigest = sha256Hex('another brief'); }))
      .toEqual([`the manifest brief of Run ${r3} does not match its bound digest`,
        `the manifest input of Run ${r3} does not end with the rendered brief and its marker`]);
    expect(changed((records) => {
      const outbox = records.outboxOf(records.run2!);
      outbox.claim = { ...outbox.claim, runRef: { ...outbox.claim.runRef, runId: 'inv-other-run' } };
    })).toEqual([`the brief of Run ${r2} names another Run or requeue`]);
    expect(changed((_, next) => { next.manifests!.find((manifest) => manifest.runRef.runId === r2)!.problem = 'unreadable'; }))
      .toEqual([`the manifest of Run ${r2} has no readable brief: unreadable`]);
    expect(changed((_, next) => { next.manifests!.find((manifest) => manifest.runRef.runId === r2)!.input += '\n'; }))
      .toEqual([`the manifest input of Run ${r2} does not end with the rendered brief and its marker`]);
    expect(changed((records) => { records.run2!.inputBinding!.inputDigest = sha256Hex('rebound'); }, flow.final))
      .toEqual([`Run ${r2} rewrote its inputBinding`]);
  });

  it('I-20 checkI20RoundChain: one linear chain per subject, successor facts recomputable, the step at the cap in effect', () => {
    expect(checkI20RoundChain(flow.final)).toEqual([]);
    const twoRoots = clone(flow.final);
    const root = flowRecords(twoRoots).round1!;
    twoRoots.rounds.push({ ...structuredClone(root), ref: { ...root.ref, roundId: 'inv-second-root' } });
    expect(violations(checkI20RoundChain(twoRoots))).toEqual([expect.stringMatching(/has 2 roots/)]);
    const rootFacts = clone(flow.final);
    flowRecords(rootFacts).round1!.chain!.autoCount = 1;
    expect(violations(checkI20RoundChain(rootFacts))).toEqual([expect.stringMatching(/^root round .* carries successor facts$/)]);
    // A successor on Run 2's FAIL head (VR-14) once Run 2 is not requeued.
    const prev = clone(flow.final);
    prev.requeues = prev.requeues.filter((requeue) => requeue.newInputRefs.length === 0);
    const round2 = flowRecords(prev).round2!;
    const [r1, r2, label] = [flowRecords(prev).run1.ref.runId, round2.ref.roundId, `work chain of work-1/${round2.ref.runId}`];
    const chained = clone(prev);
    chained.rounds.push(successor(round2, 'inv-successor', { ...WORKFLOW_AUTOMATION_ACTOR }, 'system', 'inv-key-1'));
    const reverify: FuzzStep = { kind: 'round_reverified', actor: { ...WORKFLOW_AUTOMATION_ACTOR }, automationPolicy: automation(3) };
    expect(checkI20RoundChain(chained, prev, reverify)).toEqual([]);
    const successorFacts = (change: (round: RoundSnapshot, world: InvariantWorld) => void): string[] => {
      const world = clone(chained);
      change(world.rounds.at(-1)!, world);
      return violations(checkI20RoundChain(world));
    };
    expect(successorFacts((round) => { round.chain!.ordinal = 3; })).toEqual([`the ${label} has 0 round(s) at ordinal 2`]);
    expect(successorFacts((round) => { round.chain!.predecessorRevision = round2.revision + 1; }))
      .toEqual([`round inv-successor does not name round ${r2}@${round2.revision} as its predecessor`]);
    expect(successorFacts((round) => { round.chain!.supersededEvidenceIds = []; }))
      .toEqual(['round inv-successor does not supersede chainEvidenceIds of its predecessor']);
    expect(successorFacts((round) => { round.chain!.basisDigests = ['inv-other']; }))
      .toEqual(["round inv-successor basisDigests is not its predecessor's plus its own key"]);
    expect(successorFacts((round) => { round.chain!.reverify!.failureClass = 'check_incomplete'; }))
      .toEqual(['the reverify facts of round inv-successor differ from the recomputed class/exemption/actor/source']);
    expect(successorFacts((round) => { round.chain!.autoCount = 5; })).toEqual(['round inv-successor autoCount 5 is not the recomputed count 1']);
    expect(successorFacts((round, world) => { round.subjectRunRef = { ...flowRecords(world).run1.ref }; }))
      .toEqual(['round inv-successor moved to another subject Run', `the ${label} grew after TaskRequeue ${r1} covered it (VR-09)`]);
    // The step (round_reverified): the predecessor was prev's finalized non-PASS head; Goal and Task active; the cap in effect.
    expect(violations(checkI20RoundChain(chained, prev, { ...reverify, automationPolicy: automation(0) })))
      .toEqual(['autoCount 1 exceeds the limit 0 in effect']);
    const openBefore = clone(prev);
    Object.assign(flowRecords(openBefore).round2!, { status: 'open', outcome: null });
    expect(violations(checkI20RoundChain(chained, openBefore, reverify)))
      .toEqual(['the predecessor of round inv-successor was not a finalized non-PASS chain head']);
    const pausedGoal = clone(chained);
    pausedGoal.goals[0]!.desiredState = 'paused';
    expect(violations(checkI20RoundChain(pausedGoal, prev, reverify))).toEqual(['Goal inv-goal is not active']);
    const deferredTask = clone(chained);
    deferredTask.plans[0]!.tasks.find((task) => task.taskId === 'work-1')!.disposition = 'deferred';
    expect(violations(checkI20RoundChain(deferredTask, prev, reverify))).toEqual(['subject Task work-1 is not active']);
    // A later write to the successor (a check begun) is not the VR-14 step.
    const begun = clone(chained);
    begun.rounds.at(-1)!.revision += 1;
    expect(checkI20RoundChain(begun, chained, { ...reverify, automationPolicy: automation(0) })).toEqual([]);
    // A third round with the second round's key: the second must first be a finalized FAIL head. A human
    // successor counts 0 whatever the predecessor counted.
    const repeated = clone(chained);
    const second = repeated.rounds.at(-1)!;
    Object.assign(second, { status: 'finalized', outcome: 'FAIL', checks: structuredClone(round2.checks) });
    repeated.rounds.push(successor(second, 'inv-third', hostActor, 'human', 'inv-key-1'));
    expect(repeated.rounds.at(-1)!.chain!.autoCount).toBe(0);
    expect(violations(checkI20RoundChain(repeated))).toEqual(['round inv-third repeats an earlier key without an exemption (§13.7)']);
    const reopened = clone(repeated);
    Object.assign(reopened.rounds.find((round) => round.ref.roundId === 'inv-successor')!, { status: 'open', outcome: null });
    // An open predecessor: not the head, not finalized, and its successor's class and exemption cannot be re-derived.
    expect(violations(checkI20RoundChain(reopened))).toEqual([`round inv-successor of the ${label} is open but not the head`,
      'the predecessor inv-successor of round inv-third is not finalized non-PASS',
      'round inv-third repeats an earlier key without an exemption (§13.7)',
      'the reverify facts of round inv-third differ from the recomputed class/exemption/actor/source']);
    // n ≤ ROUND_CHAIN_MAX: 33 rounds on one subject (human successors, distinct keys).
    const long = clone(prev);
    let last = flowRecords(long).round2!;
    for (let ordinal = 2; ordinal <= 32; ordinal += 1) {
      const next = successor(last, `inv-round-${ordinal}`, hostActor, 'human', `inv-key-${ordinal}`);
      Object.assign(next, { status: 'finalized', outcome: 'FAIL', checks: structuredClone(round2.checks) });
      long.rounds.push(next);
      last = next;
    }
    const beyond = successor({ ...last, chain: { ...last.chain!, ordinal: 31 } }, 'inv-round-33', hostActor, 'human', 'inv-key-33');
    beyond.chain!.ordinal = 33;
    long.rounds.push(beyond);
    expect(violations(checkI20RoundChain(long))).toEqual([`the ${label} has 33 rounds, above 32`]);
    // Covered by a TaskRequeue: the chain cannot grow (VR-09).
    const grown = clone(flow.final);
    grown.rounds.push(successor(flowRecords(grown).round2!, 'inv-grown', hostActor, 'human', 'inv-key-2'));
    expect(violations(checkI20RoundChain(grown))).toEqual([expect.stringMatching(/grew after TaskRequeue .* covered it \(VR-09\)$/)]);
  });

  it('I-21 checkI21NonActiveTaskQuiescent: a non-active Task has no unresolved Run or held Lease; admissions need active', () => {
    const deferred = clone(flow.final);
    deferred.plans[0]!.tasks.find((task) => task.taskId === 'work-1')!.disposition = 'deferred';
    expect(checkI21NonActiveTaskQuiescent(deferred)).toEqual([]);
    const held = clone(deferred);
    delete held.leases[0]!.release;
    expect(violations(checkI21NonActiveTaskQuiescent(held))).toEqual(['deferred Task work-1 still holds its Lease']);
    /** The observed step with work-1 deferred in its world; `withoutEvents` drops the step's events (a hand-built world). */
    const deferredStep = (label: string, withoutEvents = false): string[] => {
      const taken = observed(label);
      expect(checkI21NonActiveTaskQuiescent(taken.world, taken.prev, taken.step)).toEqual([]);
      const world = clone(taken.world);
      world.plans[0]!.tasks.find((task) => task.taskId === 'work-1')!.disposition = 'deferred';
      if (withoutEvents) world.events = structuredClone(taken.prev!.events);
      return violations(checkI21NonActiveTaskQuiescent(world, taken.prev, taken.step));
    };
    const claimed = observed('inv-flow-2:claim_task').world;
    const run2 = claimed.runs.find((run) => run.status === 'starting')!.ref.runId;
    const claimAttempt = claimed.attempts.find((attempt) => attempt.status === 'claimed')!.ref.attemptId;
    const committed = (kind: string, what: string): RegExp => new RegExp(`^${kind} \\(${what}\\) committed on Task work-1, which is deferred$`);
    // From the step's event-log entries (a Workflow `start` authorizes, enters and ends the Run in one step).
    expect(deferredStep('inv-flow-2:claim_task')).toEqual([`deferred Task work-1 has unresolved Run ${run2}`,
      'deferred Task work-1 still holds its Lease', expect.stringMatching(committed('task_claimed', 'TaskClaimed #\\d+'))]);
    expect(deferredStep('inv-flow-2:start')).toEqual([expect.stringMatching(committed('entry_authorized', 'ExecutionEntryAuthorized #\\d+'))]);
    expect(deferredStep('inv-flow-2:open_checks')).toEqual([expect.stringMatching(committed('round_opened', 'VerificationRoundOpened #\\d+'))]);
    expect(deferredStep('inv-flow-2:run_check')).toEqual([expect.stringMatching(committed('check_begun', 'VerificationCheckBegun #\\d+'))]);
    expect(deferredStep('requeue-1')).toEqual([expect.stringMatching(committed('task_requeued', 'TaskRequeued #\\d+'))]);
    expect(deferredStep('refusal')).toEqual([expect.stringMatching(committed('task_rework_refused', 'TaskReworkRefused #\\d+'))]);
    // From the records, for hand-built worlds without those events.
    expect(deferredStep('inv-flow-2:claim_task', true)).toEqual([`deferred Task work-1 has unresolved Run ${run2}`,
      'deferred Task work-1 still holds its Lease', `task_claimed (claim ${claimAttempt}) committed on Task work-1, which is deferred`]);
    expect(deferredStep('inv-flow-2:open_checks', true)).toEqual([expect.stringMatching(committed('round_opened', 'round .*'))]);
    expect(deferredStep('inv-flow-2:run_check', true)).toEqual(['check_begun (check inv-check) committed on Task work-1, which is deferred']);
    expect(deferredStep('requeue-1', true)).toEqual(['task_requeued (requeue) committed on Task work-1, which is deferred']);
    expect(deferredStep('refusal', true)).toEqual(['task_rework_refused (refusal) committed on Task work-1, which is deferred']);
    const claimStep = observed('inv-flow-2:claim_task');
    const authorized = clone(claimStep.world);
    authorized.plans[0]!.tasks.find((task) => task.taskId === 'work-1')!.disposition = 'deferred';
    authorized.runs.find((run) => run.ref.runId === run2)!.executionAuthorization = { ...authOf(flowRecords(flow.final).run2!), phase: 'authorized' };
    expect(violations(checkI21NonActiveTaskQuiescent(authorized, claimStep.world, step('entry_authorized', 'authorized')))).toEqual([
      `deferred Task work-1 has unresolved Run ${run2}`, 'deferred Task work-1 still holds its Lease',
      `entry_authorized (authorization of Run ${run2}) committed on Task work-1, which is deferred`]);
    const prev = clone(flow.final);
    prev.requeues = prev.requeues.filter((requeue) => requeue.newInputRefs.length === 0);
    const chained = clone(prev);
    chained.rounds.push(successor(flowRecords(prev).round2!, 'inv-successor', { ...WORKFLOW_AUTOMATION_ACTOR }, 'system', 'inv-key-1'));
    chained.plans[0]!.tasks.find((task) => task.taskId === 'work-1')!.disposition = 'deferred';
    expect(violations(checkI21NonActiveTaskQuiescent(chained, prev, step('round_reverified', 'reverify'))))
      .toEqual(['round_reverified (round inv-successor) committed on Task work-1, which is deferred']);
  });

  it('I-22 checkI22TracedBasisFrozen: a Task with a Run keeps its basis and execution definition (only §11.19 legacy)', () => {
    expect(checkI22TracedBasisFrozen(flow.final)).toEqual([]);
    const runIds = flow.final.runs.map((run) => run.ref.runId);
    const carried = clone(flow.final);
    adoptedPlan(carried, (plan, source) => {
      plan.taskStateBasis = { schemaVersion: 1, entries: plan.tasks.map((task) => ({ taskId: task.taskId, planRef: source.ref })) };
      plan.tasks.find((task) => task.taskId === 'work-1')!.disposition = 'deferred';
    });
    expect(checkI22TracedBasisFrozen(carried)).toEqual([]);
    const redefined = clone(carried);
    redefined.plans.at(-1)!.tasks.find((task) => task.taskId === 'work-1')!.title = 'Another execution definition';
    expect(violations(checkI22TracedBasisFrozen(redefined)))
      .toEqual(runIds.map((runId) => `the execution definition of Task work-1 changed since Run ${runId} was claimed`));
    const moved = clone(carried);
    const plan2 = moved.plans.at(-1)!;
    if (plan2.schemaVersion !== 2 || plan2.taskStateBasis === undefined) throw new Error('the adopted Plan carries a basis');
    plan2.taskStateBasis.entries.find((entry) => entry.taskId === 'work-1')!.planRef = { ...plan2.ref };
    expect(violations(checkI22TracedBasisFrozen(moved))).toEqual(runIds.map(() => 'the basis of Task work-1 moved from inv-plan to inv-plan-2'));
    // The active Plan's basis no longer resolves for the traced Task (P2): a violation, not legacy.
    const unresolvable = clone(carried);
    const plan3 = unresolvable.plans.at(-1)!;
    if (plan3.schemaVersion !== 2 || plan3.taskStateBasis === undefined) throw new Error('the adopted Plan carries a basis');
    plan3.taskStateBasis.entries = plan3.taskStateBasis.entries.filter((entry) => entry.taskId !== 'work-1');
    expect(violations(checkI22TracedBasisFrozen(unresolvable))).toEqual(runIds.map(() => 'the basis of Task work-1 moved from inv-plan to an '
      + 'unresolvable basis (accepted Plan inv-plan-2 carries a taskStateBasis without task work-1)'));
    expect(legacyOf(checkI22TracedBasisFrozen(unresolvable))).toEqual([]);
    // PlanRevisions are never deleted: a claim Plan missing from the window is damage (P3).
    const missing = clone(carried);
    missing.plans = missing.plans.filter((plan) => plan.planId !== 'inv-plan');
    expect(violations(checkI22TracedBasisFrozen(missing))).toEqual(runIds.map((runId) => `the claim Plan inv-plan of Run ${runId} is not in the window`));
    const dropped = clone(carried);
    dropped.plans.at(-1)!.tasks = dropped.plans.at(-1)!.tasks.filter((task) => task.taskId !== 'work-1');
    expect(violations(checkI22TracedBasisFrozen(dropped))).toEqual(runIds.map((runId) => `the active Plan no longer carries Task work-1 of Run ${runId}`));
    // Legacy (§11.19): the claim Plan's basis does not resolve, or a later v2 adoption has no taskStateBasis (before W1).
    const claimUnresolvable = clone(carried);
    const claimPlan = claimUnresolvable.plans.find((plan) => plan.planId === 'inv-plan')!;
    if (claimPlan.schemaVersion !== 2) throw new Error('the claim Plan is v2');
    claimPlan.taskStateBasis = { schemaVersion: 1, entries: [] };
    expect(violations(checkI22TracedBasisFrozen(claimUnresolvable))).toEqual([]);
    expect(legacyOf(checkI22TracedBasisFrozen(claimUnresolvable)))
      .toEqual(runIds.map((runId) => `the claim Plan basis of Task work-1 is not resolvable for Run ${runId}`));
    const beforeW1 = clone(moved);
    const legacyPlan = beforeW1.plans.at(-1)!;
    if (legacyPlan.schemaVersion === 2) delete legacyPlan.taskStateBasis;
    expect(violations(checkI22TracedBasisFrozen(beforeW1))).toEqual([]);
    expect(legacyOf(checkI22TracedBasisFrozen(beforeW1)))
      .toEqual(runIds.map(() => 'the basis of Task work-1 moved from inv-plan to inv-plan-2 (a v2 adoption without taskStateBasis)'));
  });

  it('checkAllInvariants runs every checker; legacy findings are kept apart', () => {
    expect(Object.keys(INVARIANT_CHECKERS)).toEqual(Array.from({ length: 22 }, (_, position) => `I-${position + 1}`));
    const broken = clone(flow.final);
    flowRecords(broken).requeue1.failureClass = 'run_failed';
    broken.evidenceIndexes[0]!.revision = 0;
    broken.evidenceIndexes[0]!.evidenceIds = [];
    expect(checkAllInvariants(broken).map((violation) => `${violation.invariant} ${violation.message}`))
      .toEqual(['I-12 failureClass/interruption run_failed/null ≠ derived check_failed/null']);
    expect(legacyFindings(broken)).toMatchObject([{ invariant: 'I-13', legacy: true }]);
  });
});
