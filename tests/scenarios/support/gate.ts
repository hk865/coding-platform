/**
 * A.2 step 6, gate group (C5): help code for tests/scenarios/C5-gate-fix.test.ts,
 * C5-gate-fix-open.test.ts and C5-reverify-guards.test.ts (docs/refactor/STATE-MACHINES-SPEC.md
 * §15.2 "第 6 步", §9 VD-8, VD-11..VD-15, §13.7, §4 GV table).
 *
 * 1. The composition-root environments of the moved cases (scratchpad step6/OWED.md §5, user
 *    decision 31: one case is kept once). The cases came from
 *    tests/composition/A2-gate-reverify-platform, A2-reverify-platform and
 *    A2-verification-chain-platform, each with its own fixture. One builder with a profile per
 *    source file rebuilds the same ids, texts, bindings and seed, so the moved bodies run with
 *    their assertions unchanged. Their `drive` checks the §11 invariants after every receipt
 *    (with the step's `FuzzStep`, as the harness's `advance()` does), and the seed checks them
 *    once; a moved case adds `checkInvariants` after an owner write outside `drive`.
 * 2. Helpers for the new cases on the shared harness (tests/scenarios/harness.ts, platform mode
 *    on the AG2b seed): the gate's Workflow steps, the receipts paired with the operations that
 *    produced them, and the operator's fix Task adoption (W16 through the owners, with the gate
 *    round's report in `PlanChangeReason.sources`, the request the UI action "添加修复任务"
 *    sends; the button itself is task E3).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowOperation, WorkflowStepReceipt } from '../../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../../src/business/workflow/ports.js';
import { createTargetPlatform } from '../../../src/composition/create-platform.js';
import type { ActorRef } from '../../../src/contracts/command-event.js';
import type { ArtifactRef } from '../../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../../src/contracts/core/call-context.js';
import { sha256Hex } from '../../../src/contracts/fingerprint.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../../src/contracts/plan.js';
import { DEFAULT_TASK_AUTOMATION_POLICY, type TaskAutomationPolicyV1 } from '../../../src/contracts/task-requeue.js';
import type { RoundSnapshot, TrustedCheckConfiguration } from '../../../src/contracts/verification.js';
import type { RuntimeHostBindings } from '../../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../../src/core/workspace/access.js';
import type { PlanProposalRef } from '../../../src/core/work-graph/tasks/plan-contracts.js';
import type { FuzzStep } from '../../state/invariants.js';
import { AG2B_GATE_TASK_ID, AG2B_GOAL_REF } from '../../helpers/AG2b-collaboration-fixture.js';
import { createScriptedModel, type ScriptedModel, type ScriptedReply } from '../../helpers/B2-runtime-fixture.js';
import {
  assertInvariants, assertInvariantsAt, performs, stepOfReceipt, type Driven, type InvariantTarget, type Platform,
  type PlatformScenario,
} from '../harness.js';
import { reverifyRequest } from './common.js';

// ---------------------------------------------------------------------------
// 1. The moved cases' composition-root environments
// ---------------------------------------------------------------------------

type CaseName = 'gate' | 'reverify' | 'chain';

/** What differs between the three source fixtures; every id is `a2-<name>-…` as the source file had it. */
type CaseProfile = {
  name: CaseName;
  at: string;
  checkId: string;
  tasks: PlanRevisionDraft['tasks'];
  assignments: NonNullable<PlanRevisionDraft['assignments']>;
  objective: string;
  source: string;
};

const WORK_1 = { taskId: 'work-1', title: 'The ordinary work', requirementLevel: 'required', taskKind: 'work',
  disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' } as const;
const GOAL_GATE = { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
  disposition: 'active', phase: 'pending', scope: { kind: 'goal' } } as const;

const PROFILES: Record<CaseName, CaseProfile> = {
  gate: { name: 'gate', at: '2026-10-06T00:00:00.000Z', checkId: 'a2-gate-check', tasks: [{ ...WORK_1 }, { ...GOAL_GATE }],
    assignments: [{ taskId: 'work-1', role: 'builder', instruction: 'Do the ordinary work' }],
    objective: 'Accept the work at the gate, after a fix', source: 'A2_GATE_OK: the delivered work\n' },
  reverify: { name: 'reverify', at: '2026-10-06T00:00:00.000Z', checkId: 'a2-reverify-check', tasks: [{ ...WORK_1 }, { ...GOAL_GATE }],
    assignments: [{ taskId: 'work-1', role: 'builder', instruction: 'Do the ordinary work' }],
    objective: 'Check the work again on the same Run', source: 'A2 reverify registered workspace source\n' },
  chain: { name: 'chain', at: '2026-10-05T00:00:00.000Z', checkId: 'a2-check',
    tasks: [{ ...WORK_1, title: 'First ordinary work' }, { ...WORK_1, taskId: 'work-2', title: 'Second ordinary work' }, { ...GOAL_GATE }],
    assignments: [{ taskId: 'work-1', role: 'builder', instruction: 'Do the first ordinary work' },
      { taskId: 'work-2', role: 'builder', instruction: 'Do the second ordinary work' }],
    objective: 'Verify work through one round chain per subject', source: 'A2 chain registered workspace source\n' },
};

/** The ids, refs and bindings of one profile (the source files' module constants). */
function idsOf(profile: CaseProfile) {
  const prefix = `a2-${profile.name}`;
  const projectId = `${prefix}-project`;
  const workspaceId = `${prefix}-workspace`;
  return {
    prefix, projectId, workspaceId, scope: { projectId, workspaceId },
    hostActor: { kind: 'human' as const, id: `${prefix}-host` },
    projectRef: { aggregateType: 'Project' as const, projectId },
    workspaceRef: { aggregateType: 'Workspace' as const, projectId, workspaceId },
    goalRef: { aggregateType: 'Goal' as const, projectId, goalId: `${prefix}-goal` },
    policyRef: { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: `${prefix}-policy`, revision: 1 },
    activeRef: { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId },
    roleBinding: { schemaVersion: 1 as const, bindingId: `${prefix}-binding`, templateId: 'builder',
      templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' },
    grant: `${prefix}-grant-1`,
    instruction: `A2 ${profile.name} trusted static role guidance`,
    obligation: { obligationId: `${prefix}-obligation`, title: 'Deliver the work', requirementLevel: 'required' as const,
      verificationRequirements: [{ requirementId: `${prefix}-static`, requirementLevel: 'required' as const, kind: 'static',
        description: 'Registered static command check' }] },
  };
}
type CaseIds = ReturnType<typeof idsOf>;

const RUNTIME_BUDGET = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };

/** The workspace binding's state; a set `move` resolves the root to `movedRoot` after `realResolves` more resolutions. */
export type CaseWorkspaceState = { revision: number; move: { movedRoot: string; realResolves: number } | null };

/** One moved case's environment: the source files' `Environment` plus the files and the invariant target. */
export type CaseEnvironment = {
  platform: Platform;
  scripted: ScriptedModel;
  workspaceRoot: string;
  directory: string;
  workspace: CaseWorkspaceState;
  ids: CaseIds;
  invariants: InvariantTarget;
};

type CheckDefinition = { command: string; timeoutMs?: number; kind?: TrustedCheckConfiguration['checks'][number]['kind']; revision?: string };

const directories: string[] = [];
const platforms: Platform[] = [];
const environments = new WeakMap<Platform, CaseEnvironment>();

/** The moved cases' cleanup (the source files' `afterEach`); `cleanupScenarios` stays the harness's. */
export async function cleanupCases(): Promise<void> {
  for (const platform of platforms.splice(0)) await platform.close().catch(() => undefined);
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
}

function caseCtx(ids: CaseIds, actor: { kind: 'human' | 'system'; id: string } = ids.hostActor): CoreCallContext {
  return { ...ids.scope, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', ...ids.scope, actor }, signal: new AbortController().signal };
}

function caseChecks(profile: CaseProfile, ids: CaseIds, check: CheckDefinition): TrustedCheckConfiguration {
  return { configurationRevision: check.revision ?? `${ids.prefix}-checks-1`, workspace: ids.workspaceRef, executor: ids.hostActor,
    permissionRevision: ids.grant, sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: profile.checkId, kind: check.kind ?? 'static', command: check.command, cwd: '.',
      timeoutMs: check.timeoutMs ?? 60_000, taskIds: 'all' }] };
}

function caseWorkspace(ids: CaseIds, directory: string, state: CaseWorkspaceState): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== ids.projectId || requested.workspaceId !== ids.workspaceId) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      if (state.move !== null) {
        if (state.move.realResolves === 0) return { status: 'ready', value: { root: state.move.movedRoot, workspaceRevision: state.revision } };
        state.move.realResolves -= 1;
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: state.revision } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: `${ids.prefix}-host`, permissionRevision: ids.grant, allowsRead: () => true } };
    },
  };
}

function caseRuntime(ids: CaseIds, scripted: ScriptedModel): RuntimeHostBindings {
  return {
    async resolveConfiguration(context, request) {
      if (context.projectId !== ids.projectId || context.workspaceId !== ids.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the runtime Host is not bound to this workspace' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'the current Role binding is inadmissible' };
      }
      return { status: 'ready', value: {
        configurationRevision: `${ids.prefix}-host-config@1`,
        model: { configuration: { revision: `${ids.prefix}-host-config@1`, provider: 'deepseek', model: `${ids.prefix}-scripted`,
          baseUrl: 'http://127.0.0.1' },
        client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
          tokenizer: `${ids.prefix}-counter` }) } },
        budget: RUNTIME_BUDGET,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex(ids.instruction) } : null,
        tools: ['read'], writeScope: [], skills: { resourceRoot: fileURLToPath(new URL('../../../vendor/coding-agent/resources/skills',
          import.meta.url)), enabledIds: [] },
        systemInstruction: ids.instruction, deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

type OpenCaseOptions = {
  check: CheckDefinition;
  replies: readonly ScriptedReply[];
  /** Runs inside model call `index`, before the scripted answer. */
  beforeReply?: (index: number, environment: CaseEnvironment) => Promise<void>;
};

/** The source files' `openEnvironment`: the composition root on fresh SQLite files, seeded with the profile's Goal and Plan. */
async function openCase(profile: CaseProfile, options: OpenCaseOptions): Promise<CaseEnvironment> {
  const ids = idsOf(profile);
  const directory = await mkdtemp(join(tmpdir(), `next-${ids.prefix}-`));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), `next-${ids.prefix}-source-`));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), profile.source);
  const state: CaseWorkspaceState = { revision: 1, move: null };
  const holder: { environment?: CaseEnvironment } = {};
  const scripted = createScriptedModel(options.replies, async (_request, index) => {
    if (options.beforeReply !== undefined && holder.environment !== undefined) await options.beforeReply(index, holder.environment);
  });
  const workflow: WorkflowHostConfiguration = {
    consumerId: `${ids.prefix}-consumer`,
    bindings: [{ workspace: ids.scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: ids.roleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: caseWorkspace(ids, workspaceRoot, state), now: () => profile.at,
    kernelStores: { entries: [{ adapterId: `${ids.prefix}-kernel`, storeKey: `${ids.prefix}-kernel-store`,
      workspace: ids.scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: caseRuntime(ids, scripted), checks: caseChecks(profile, ids, options.check), workflow,
  });
  platforms.push(platform);
  const environment: CaseEnvironment = { platform, scripted, workspaceRoot, directory, workspace: state, ids,
    invariants: { database: directory, projectId: ids.projectId } };
  holder.environment = environment;
  environments.set(platform, environment);
  await seedCase(profile, ids, platform, state);
  await assertInvariantsAt(environment.invariants, `${ids.prefix} seeded`);
  return environment;
}

async function seedCase(profile: CaseProfile, ids: CaseIds, platform: Platform, state: CaseWorkspaceState): Promise<void> {
  const host = caseCtx(ids);
  const { projectId, projectRef, workspaceRef, goalRef, policyRef, activeRef } = ids;
  expect(await platform.projects.createProject(host, { meta: { requestId: 'a2-project',
    expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } })).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(host, { meta: { requestId: 'a2-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: ids.scope } });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  state.revision = registered.value.revision;
  const installed = await platform.completionPolicies.installCompletionPolicy(host, { meta: { requestId: 'a2-policy',
    expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
    input: { policyId: policyRef.policyId, contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'a2-policy-active',
    expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'a2-baseline',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { baselineId: 'a2-baseline', description: `The A2 ${profile.name} module boundary`, constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: ids.prefix }, name: `A2 ${profile.name}`,
        responsibility: 'Verify work', paths: ['src'], interfaces: [] }] } } })).toMatchObject({ status: 'committed' });
  expect(await platform.goals.createGoal(host, { meta: { requestId: 'a2-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { goalId: goalRef.goalId, workspace: ids.scope, objective: profile.objective } }))
    .toMatchObject({ status: 'committed' });
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `${ids.prefix}-plan`, planRevision: 1, goalId: goalRef.goalId, stages: [],
    tasks: structuredClone(profile.tasks), assignments: structuredClone(profile.assignments),
    obligations: [{ ...structuredClone(ids.obligation), taskIds: profile.tasks.map(task => task.taskId) }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
  const proposed = await platform.plans.proposePlan(host, { meta: { requestId: 'a2-plan-propose', expected: [] },
    input: { goalRef, basedOn: null, draft, reason: { text: `Initial A2 ${profile.name} plan`, sources: [] } } });
  if (proposed.status !== 'committed') throw new Error('Plan proposal failed');
  const applied = await platform.plans.applyPlanChange(host, { meta: { requestId: 'a2-plan-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');
}

function environmentOf(platform: Platform): CaseEnvironment {
  const environment = environments.get(platform);
  if (environment === undefined) throw new Error('the platform was not opened by a moved case environment');
  return environment;
}

/** §11 invariants on a moved case's files after an owner write outside `drive` (actor and policy name the step). */
export async function checkInvariants(platform: Platform, label: string,
  step?: { kind: FuzzStep['kind']; actor?: ActorRef; automationPolicy?: TaskAutomationPolicyV1 }): Promise<void> {
  const environment = environmentOf(platform);
  await assertInvariantsAt(environment.invariants, `${environment.ids.prefix} ${label}`, step === undefined ? undefined : {
    kind: step.kind, actor: step.actor ?? { ...environment.ids.hostActor },
    automationPolicy: step.automationPolicy ?? { ...DEFAULT_TASK_AUTOMATION_POLICY }, label });
}

type Perform = Extract<WorkflowAdvanceInput, { kind: 'perform' }>;
export type CaseDriven = { stopped: Perform | null; state: string; reason: string | null; receipts: WorkflowStepReceipt[] };

/** The helpers one moved case uses, bound to its profile (the source file's module-level functions). */
function caseHelpers(profile: CaseProfile) {
  const ids = idsOf(profile);
  const ctx = (actor: { kind: 'human' | 'system'; id: string } = ids.hostActor): CoreCallContext => caseCtx(ids, actor);
  const select = (flowId: string, taskId?: string): WorkflowAdvanceInput =>
    ({ schemaVersion: 1, goalRef: ids.goalRef, flowId, sessionHint: null, kind: 'select_work', ...(taskId === undefined ? {} : { taskId }) });
  /**
   * The Host drives every returned `next` until `stopBefore` names the next request (not performed) or the
   * Workflow settles; after every receipt the §11 invariants with the step's `FuzzStep` (the platform's
   * default automation policy: none of the moved cases drives after changing it).
   */
  async function drive(platform: Platform, first: WorkflowAdvanceInput,
    stopBefore: (input: WorkflowAdvanceInput) => boolean = () => false): Promise<CaseDriven> {
    const environment = environmentOf(platform);
    const receipts: WorkflowStepReceipt[] = [];
    let input = first;
    for (let guard = 0; guard < 64; guard += 1) {
      if (stopBefore(input)) return { stopped: input as Perform, state: 'stopped', reason: null, receipts };
      const result = await platform.workflow.advanceWork(ctx(), input);
      if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
      const receipt = result.value.receipt;
      if (receipt !== null) {
        receipts.push(receipt);
        const label = `${ids.prefix} ${input.flowId}#${guard} ${receipt.kind}`;
        await assertInvariantsAt(environment.invariants, label,
          stepOfReceipt(receipt, ids.hostActor, DEFAULT_TASK_AUTOMATION_POLICY, label));
      }
      if (result.value.state === 'completed' || result.value.next === null) {
        return { stopped: null, state: result.value.state, reason: result.value.reason, receipts };
      }
      input = result.value.next;
    }
    throw new Error('the Workflow did not settle within the step guard');
  }
  async function taskRow(platform: Platform, taskId: string) {
    const graph = await platform.plans.queryTaskGraph(ctx(), { goalRef: ids.goalRef });
    if (graph.status !== 'ready') throw new Error('the task graph must be readable');
    const row = graph.value.tasks.find(candidate => candidate.ref.taskId === taskId);
    if (row === undefined) throw new Error(`task ${taskId} is not in the graph`);
    return row;
  }
  async function goalDisplay(platform: Platform) {
    const read = await platform.plans.queryGoalDisplay!(ctx(), { goalRef: ids.goalRef });
    if (read.status !== 'ready') throw new Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
    return read.value.display;
  }
  return { ids, hostActor: ids.hostActor, goalRef: ids.goalRef, CHECK_ID: profile.checkId, ctx, select, performs, drive, taskRow, goalDisplay };
}

// The C5 gate fix case (tests/composition/A2-gate-reverify-platform.test.ts).

const GATE_MARKER = 'A2_GATE_OK';
const gateBase = caseHelpers(PROFILES.gate);

/** W16: an operator adopts a required fix Task carrying the gate's obligation, with the report as a source. */
async function adoptGateFixTask(platform: Platform, reportRef: unknown): Promise<{ proposalRef: PlanProposalRef; plan: PlanRevisionSnapshot }> {
  const { ctx, goalRef, CHECK_ID } = gateBase;
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
    obligations: [{ ...gateBase.ids.obligation, taskIds: ['work-1', 'goal-gate', 'fix-1'] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
  const expected = [{ ref: goalRef, revision: goal.value.goal.revision }];
  const proposed = await platform.plans.proposePlan(ctx(), { meta: { requestId: 'a2-gate-fix-propose', expected },
    input: { goalRef, basedOn: plan.ref, draft, reason: { text: `Fix the failed gate check ${CHECK_ID}`,
      sources: [reportRef as never] } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) throw new Error(`fix proposal failed: ${JSON.stringify(proposed)}`);
  await checkInvariants(platform, 'fix proposed', { kind: 'other' });
  const applied = await platform.plans.applyPlanChange(ctx(), { meta: { requestId: 'a2-gate-fix-apply', expected },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`fix adoption failed: ${JSON.stringify(applied)}`);
  await checkInvariants(platform, 'fix adopted', { kind: 'plan_adopted' });
  return { proposalRef: proposed.value.ref, plan: applied.value };
}

export const gateCase = {
  ...gateBase,
  GATE: 'goal-gate',
  MARKER: GATE_MARKER,
  /** `duringTurn(index)` runs inside model call `index`, before the scripted answer. */
  openEnvironment: async (duringTurn: (index: number, workspaceRoot: string) => Promise<void>) => {
    // The check passes only while source.txt carries the marker (a sandboxed node process).
    const command = `node -e "if(!require('node:fs').readFileSync('source.txt','utf8').includes('${GATE_MARKER}'))process.exit(3)"`;
    return openCase(PROFILES.gate, { check: { command }, replies: [{ kind: 'text', text: 'A2 gate: the work is done' },
      { kind: 'text', text: 'A2 gate: the fix is done' }], beforeReply: (index, environment) => duringTurn(index, environment.workspaceRoot) });
  },
  isGateStep: (kind: 'open_checks' | 'run_check' | 'reverify_round') => (input: WorkflowAdvanceInput): boolean => {
    if (input.kind !== 'perform' || input.operation.kind !== kind) return false;
    if (input.operation.kind === 'open_checks') return input.operation.request.input.subject.taskId === 'goal-gate';
    if (input.operation.kind === 'run_check') return input.operation.request.input.roundRef.taskId === 'goal-gate';
    return input.operation.kind === 'reverify_round' && input.operation.request.input.predecessorRoundRef.taskId === 'goal-gate';
  },
  adoptFixTask: adoptGateFixTask,
};

// The C5 reverify policy case (tests/composition/A2-reverify-platform.test.ts).

const reverifyBase = caseHelpers(PROFILES.reverify);

function reverifyChecks(revision: string, kind: 'static' | 'dynamic' = 'static'): TrustedCheckConfiguration {
  return caseChecks(PROFILES.reverify, reverifyBase.ids, { command: 'echo A2_REVERIFY_OK', revision, kind });
}

/** VD-8: the work Run completes, its round opens, the workspace changes, and the round finalizes INCONCLUSIVE. */
async function inconclusiveHead(platform: Platform, workspaceRoot: string): Promise<RoundSnapshot> {
  const { drive, select, performs } = reverifyBase;
  const toCheck = await drive(platform, select('a2-reverify-flow', 'work-1'), performs('run_check'));
  if (toCheck.stopped === null) throw new Error('the Workflow must reach the check');
  await writeFile(join(workspaceRoot, 'source.txt'), 'A2 reverify source changed after the open\n');
  const finalized = await drive(platform, toCheck.stopped, input => input.kind === 'select_work');
  const finalize = finalized.receipts.find(receipt => receipt.kind === 'finalize_checks');
  if (finalize?.kind !== 'finalize_checks' || finalize.result.status !== 'committed') throw new Error('the round must finalize');
  expect(finalize.result.value.outcome).toBe('INCONCLUSIVE');
  return finalize.result.value.snapshot;
}

export const reverifyCase = {
  ...reverifyBase,
  checksConfiguration: reverifyChecks,
  /** `duringTurn` runs inside the work Run's one model call, before the scripted answer. */
  openEnvironment: (duringTurn?: (platform: Platform) => Promise<void>) => openCase(PROFILES.reverify, {
    check: { command: 'echo A2_REVERIFY_OK', revision: 'a2-reverify-checks-1' },
    replies: [{ kind: 'text', text: 'A2 reverify work result' }],
    ...(duringTurn === undefined ? {} : { beforeReply: (_index: number, environment: CaseEnvironment) => duringTurn(environment.platform) }) }),
  inconclusiveHead,
  reverifyRequest,
};

// The VR-03 timed-out check case (tests/composition/A2-verification-chain-platform.test.ts).

export const chainCase = {
  ...caseHelpers(PROFILES.chain),
  openEnvironment: (options: { command: string; timeoutMs?: number; replies?: number; beforeReply?: (index: number) => Promise<void> }) =>
    openCase(PROFILES.chain, { check: { command: options.command, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) },
      replies: Array.from({ length: options.replies ?? 2 }, (_, index) => ({ kind: 'text' as const, text: `A2 chain work result ${index + 1}` })),
      beforeReply: async (index) => { await options.beforeReply?.(index); } }),
};

// ---------------------------------------------------------------------------
// 2. Helpers for the new cases on the shared harness (AG2b seed)
// ---------------------------------------------------------------------------

/** The Task a Workflow operation acts on (`null` for prepare, start and observe, which name only a Run). */
export function subjectTaskOf(operation: WorkflowOperation): string | null {
  switch (operation.kind) {
    case 'create_session': return operation.taskRef.taskId;
    case 'claim_task': return operation.request.input.taskId;
    case 'open_checks': return operation.request.input.subject.taskId;
    case 'run_check': return operation.request.input.roundRef.taskId;
    case 'finalize_checks': return operation.request.input.roundRef.taskId;
    case 'reverify_round': return operation.request.input.predecessorRoundRef.taskId;
    case 'requeue_task': return operation.request.input.taskRef.taskId;
    case 'complete_task': return operation.request.input.taskRef.taskId;
    default: return null;
  }
}

/** `stopBefore` for the next `perform` of `kind` on the Task `taskId` (default the AG2b gate). */
export function performsOn(kind: WorkflowOperation['kind'], taskId: string = AG2B_GATE_TASK_ID): (input: WorkflowAdvanceInput) => boolean {
  return input => input.kind === 'perform' && input.operation.kind === kind && subjectTaskOf(input.operation) === taskId;
}

export type PerformedStep = { operation: WorkflowOperation; receipt: WorkflowStepReceipt; task: string | null };

/** Every `perform` a drive sent, in order, with its receipt: step i was produced by `first` (i = 0) or step i-1's `next`. */
export function performedSteps(first: WorkflowAdvanceInput, driven: Driven): PerformedStep[] {
  const steps: PerformedStep[] = [];
  let input: WorkflowAdvanceInput | null = first;
  for (const step of driven.steps) {
    if (input !== null && input.kind === 'perform' && step.receipt !== null) {
      steps.push({ operation: input.operation, receipt: step.receipt, task: subjectTaskOf(input.operation) });
    }
    input = step.next;
  }
  return steps;
}

/** The finalized rounds' outcomes of one Task in a drive (`finalize_checks` receipts that committed). */
export function finalizeOutcomesOfTask(steps: readonly PerformedStep[], taskId: string): unknown[] {
  return steps.flatMap(step => step.task === taskId && step.receipt.kind === 'finalize_checks' && step.receipt.result.status === 'committed'
    ? [step.receipt.result.value.outcome] : []);
}

/** The committed round snapshot of a `finalize_checks` receipt. */
export function finalizedRound(step: PerformedStep | undefined): RoundSnapshot {
  if (step?.receipt.kind !== 'finalize_checks' || step.receipt.result.status !== 'committed') {
    throw new Error(`a committed finalize_checks receipt was expected: ${JSON.stringify(step?.receipt)}`);
  }
  return step.receipt.result.value.snapshot;
}

/** The fix Task `adoptFixTaskOn` adds: its id, the failed check it names, the report refs, the request-id prefix. */
export type FixTaskOptions = { fixId: string; checkId: string; sources: ArtifactRef[]; label: string };

/**
 * W16 on the AG2b seed: the operator adds a required work Task carrying the Goal's obligation (so it
 * carries the gate's obligation too, §9 VD-11), the request the UI action "添加修复任务" sends with the
 * failing gate round's report refs in `PlanChangeReason.sources`. The §11 invariants after the
 * proposal and after the adoption (`plan_adopted` by the operator).
 */
export async function adoptFixTaskOn(h: PlatformScenario,
  options: FixTaskOptions): Promise<{ proposalRef: PlanProposalRef; plan: PlanRevisionSnapshot }> {
  const ctx = h.ctx();
  const graph = await h.platform.plans.queryTaskGraph(ctx, { goalRef: AG2B_GOAL_REF });
  const goal = await h.platform.plans.queryGoal(ctx, AG2B_GOAL_REF);
  if (graph.status !== 'ready' || goal.status !== 'ready') throw new Error('the Goal and its graph must be readable');
  const plan = graph.value.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `ag2b-plan-${options.fixId}`, planRevision: plan.planRevision + 1, goalId: AG2B_GOAL_REF.goalId,
    stages: structuredClone(plan.stages), tasks: [...structuredClone(plan.tasks), { taskId: options.fixId, title: 'Repair the gate failure',
      requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
      executionIntent: 'request_execution' }],
    assignments: [...structuredClone(plan.assignments ?? []), { taskId: options.fixId, role: 'builder',
      instruction: `Make the failed check ${options.checkId} pass` }],
    obligations: plan.obligations.map(obligation => ({ ...structuredClone(obligation), taskIds: [...obligation.taskIds, options.fixId] })),
    taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
    taskRelations: [], inputRequirements: [],
  };
  const expected = [{ ref: AG2B_GOAL_REF, revision: goal.value.goal.revision }];
  const proposed = await h.platform.plans.proposePlan(ctx, { meta: { requestId: `${options.label}-propose`, expected },
    input: { goalRef: AG2B_GOAL_REF, basedOn: plan.ref, draft, reason: { text: `Fix the failed gate check ${options.checkId}`,
      sources: structuredClone(options.sources) } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) throw new Error(`fix proposal failed: ${JSON.stringify(proposed)}`);
  await assertInvariants(h, `${options.label} proposed`, { kind: 'other', actor: { ...h.stepActor() },
    automationPolicy: h.automationPolicy(), label: `${options.label} proposed` });
  const applied = await h.platform.plans.applyPlanChange(ctx, { meta: { requestId: `${options.label}-apply`, expected },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`fix adoption failed: ${JSON.stringify(applied)}`);
  await assertInvariants(h, `${options.label} adopted`, { kind: 'plan_adopted', actor: { ...h.stepActor() },
    automationPolicy: h.automationPolicy(), label: `${options.label} adopted` });
  return { proposalRef: proposed.value.ref, plan: applied.value };
}
