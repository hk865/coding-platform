/**
 * Help code of the A.2 step 6 "plan" scenario group (docs/refactor/STATE-MACHINES-SPEC.md §15.2
 * "第 6 步": tests/scenarios/C6-unrelated-adoption.test.ts, C7-supersede-failed-task.test.ts and
 * C7-defer-reactivate.test.ts). Shared code stays in tests/scenarios/harness.ts and ./common.ts (`PlanBoard`, the
 * draft copy of an accepted Plan, the tool output reader); this file adds:
 *
 * 1. Readers the three files share: the `ExecutionEntryAuthorized` and `PlanRevisionAccepted` audit
 *    bodies, the no-progress key a Task would have against a given Plan (§13.1 `plan` = the Task's
 *    effective basis, L-4).
 * 2. Host-mode helpers on the harness's Host scenario: one Workflow step at a time with the Goal
 *    display phase after each ("Goal 从不 FAILED"), the task graph over the routes, and a W16
 *    adoption over the `plans/propose` / `plans/apply` routes.
 * 3. The composition-root environments of the moved cases (scratchpad step6/OWED.md §6, user
 *    decision 31: one case is kept once): tests/composition/A2-entry-plan-platform.test.ts (3a, C6,
 *    project `a2-c6-project`) and tests/composition/A2-disposition-change-platform.test.ts (3b, C7,
 *    project `a2-disposition-project`). Each is the source file's module-level code with the same
 *    ids, texts, bindings and seed, so the moved bodies run with their assertions unchanged. Their
 *    `drive` checks the §11 invariants after every receipt (with the step's `FuzzStep`, as the
 *    harness's `advance()` does) and records the Goal display phase; the plan helpers check them
 *    after every write they make; a moved body adds `check…` after its own owner writes.
 * 4. `raceWindow`: the commit barrier of the §3.6 PLAN-05 races
 *    (tests/composition/W1-future-plan-platform.test.ts:280-341) on a scenario's ledger file.
 *
 * Scripted model replies only; no real model is called.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../../src/business/workflow/ports.js';
import { createTargetPlatform } from '../../../src/composition/create-platform.js';
import type { ActorRef } from '../../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../../src/contracts/core/call-context.js';
import type { TaskClaim } from '../../../src/contracts/core/task-claim.js';
import type { ReadResult } from '../../../src/contracts/core/results.js';
import type { RunRef, RunSnapshot } from '../../../src/contracts/dispatch.js';
import { sha256Hex } from '../../../src/contracts/fingerprint.js';
import type { NoProgressKeyV1 } from '../../../src/contracts/no-progress.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../../src/contracts/plan.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, WORKFLOW_AUTOMATION_ACTOR, type TaskAutomationPolicyV1,
} from '../../../src/contracts/task-requeue.js';
import type { RoundSnapshot, TrustedCheckConfiguration } from '../../../src/contracts/verification.js';
import type { RuntimeHostBindings } from '../../../src/core/agent-runtime/execution-contracts.js';
import { createSqliteRecordBackend, type SqliteRecordBackend } from '../../../src/core/record-store/sqlite-record-store.js';
import type { WorkspaceHostBindings } from '../../../src/core/workspace/access.js';
import { VerificationWorkspaceReader } from '../../../src/core/workspace/verification-workspace-reader.js';
import { createRoleConfigurationService } from '../../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialRecordReaders } from '../../../src/core/work-graph/materials/record-readers.js';
import { noProgressKey } from '../../../src/core/work-graph/state/no-progress.js';
import type { GoalDisplayV1 } from '../../../src/core/work-graph/state/goal-machine.js';
import type { TaskClaimPort } from '../../../src/core/work-graph/tasks/claim-contracts.js';
import { createTaskClaimService } from '../../../src/core/work-graph/tasks/claim-service.js';
import type { RunControlPort } from '../../../src/core/work-graph/tasks/control-contracts.js';
import { createRunControlService } from '../../../src/core/work-graph/tasks/control-service.js';
import type { TaskExecutionRecord } from '../../../src/core/work-graph/tasks/execution-read-contracts.js';
import type { PlanChangeReason, PlanProposalRef, PlanServicePort, TaskRow } from '../../../src/core/work-graph/tasks/plan-contracts.js';
import { createPlanService } from '../../../src/core/work-graph/tasks/plan-service.js';
import { buildEffectiveTaskBasis } from '../../../src/core/work-graph/tasks/plan-task-basis.js';
import { createTaskRequeueService } from '../../../src/core/work-graph/tasks/requeue-service.js';
import { createRunStateReader } from '../../../src/core/work-graph/tasks/run-state-service.js';
import { createScriptedModel, type ScriptedModel } from '../../helpers/B2-runtime-fixture.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, graphWrite, plain } from '../../helpers/AG2b-collaboration-fixture.js';
import { platformRecordSchemas, type FuzzStep } from '../../state/invariants.js';
import {
  assertInvariants, assertInvariantsAt, performs, stepOfReceipt, type HostScenario, type InvariantTarget, type Platform,
} from '../harness.js';
import { draftFrom, type PhaseLog } from './common.js';

type Perform = Extract<WorkflowAdvanceInput, { kind: 'perform' }>;
type DraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;

const directories: string[] = [];
const platforms: Platform[] = [];
const raceBackends: SqliteRecordBackend[] = [];

/**
 * Closes the race backends and platforms this file opened and removes its own directories
 * (call before `cleanupScenarios`).
 */
export async function cleanupPlan(): Promise<void> {
  for (const backend of raceBackends.splice(0)) await backend.close().catch(() => undefined);
  for (const platform of platforms.splice(0)) await platform.close().catch(() => undefined);
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 1. Shared readers (used by every part below)
// ---------------------------------------------------------------------------

/** Every `ExecutionEntryAuthorized` audit body of a ledger, in commit order (read with its own connection). */
export function authorizedEventsIn(directory: string): Array<{ permit: { claim: TaskClaim }; activePlanRef?: PlanRevisionRef }> {
  const database = new DatabaseSync(join(directory, 'ledger.sqlite'), { readOnly: true });
  try {
    const rows = database.prepare('SELECT event_json FROM events ORDER BY id').all() as Array<{ event_json: string }>;
    type Authorized = { eventType: string; permit: { claim: TaskClaim }; activePlanRef?: PlanRevisionRef };
    return rows.map(row => JSON.parse(row.event_json) as Authorized)
      .filter(event => event.eventType === 'ExecutionEntryAuthorized');
  } finally { database.close(); }
}

/** Every `PlanRevisionAccepted` event of a ledger in commit order: the adopted planId and the actor production recorded. */
export function planAcceptedEventsIn(directory: string): Array<{ aggregateId: string; actor: ActorRef }> {
  const database = new DatabaseSync(join(directory, 'ledger.sqlite'), { readOnly: true });
  try {
    const rows = database.prepare('SELECT event_json FROM events ORDER BY id').all() as Array<{ event_json: string }>;
    type Accepted = { eventType: string; aggregateId: string; actor: ActorRef };
    return rows.map(row => JSON.parse(row.event_json) as Accepted).filter(event => event.eventType === 'PlanRevisionAccepted')
      .map(event => ({ aggregateId: event.aggregateId, actor: event.actor }));
  } finally { database.close(); }
}

/**
 * §13.1 (L-4): the no-progress key a requeue of `afterRun` would carry with `plan` as the Goal's active Plan:
 * the Task's effective basis in `plan` (`buildEffectiveTaskBasis`), the Run's terminal and its chain head, a
 * fixed source stamp and no new input. Two Plans that give the same key leave the guard where it was.
 */
export function noProgressKeyAgainst(plan: PlanRevisionSnapshot, afterRun: RunSnapshot, head: RoundSnapshot | null): NoProgressKeyV1 {
  const keyed = noProgressKey({ taskRef: afterRun.task, afterRun, head,
    source: { workspaceRevision: 1, sourceDigest: 'scenario-fixed-source' },
    basisPlan: buildEffectiveTaskBasis(plan).get(afterRun.task.taskId), newInputRefs: [] });
  if (!keyed.ok) throw new Error(`the no-progress key is not defined here: ${JSON.stringify(keyed)}`);
  return keyed.next;
}

/** The unrelated optional intent an adoption adds (C6 "加入 T3"): never claimable, carries no obligation. */
export function futureIntent(taskId: string): RuntimeTask {
  return { taskId, title: 'Unrelated future intent', requirementLevel: 'optional', taskKind: 'work', disposition: 'active',
    phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' };
}

/** The AG2b work Task shape, for a Task an adoption adds (C7's replacement). */
export function workTask(taskId: string, title: string): RuntimeTask {
  return { taskId, title, requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'goal' }, executionIntent: 'request_execution' };
}

/** The committed value of the first receipt of `kind` (throws when there is none or it did not commit). */
export function committedOf<K extends WorkflowStepReceipt['kind']>(receipts: readonly WorkflowStepReceipt[], kind: K):
  Extract<Extract<WorkflowStepReceipt, { kind: K }>['result'], { status: 'committed' }>['value'] {
  const receipt = receipts.find(candidate => candidate.kind === kind) as Extract<WorkflowStepReceipt, { kind: K }> | undefined;
  const result = receipt?.result as { status: string; value?: unknown } | undefined;
  if (result?.status !== 'committed') throw new Error(`a committed ${kind} receipt was expected: ${JSON.stringify(receipt)}`);
  return result.value as never;
}

// ---------------------------------------------------------------------------
// 2. Host-mode helpers (the harness's Host scenario)
// ---------------------------------------------------------------------------

/**
 * Drives the Workflow one step at a time on a harness Host (each step checks the invariants, as `advance()`
 * does) and records the Goal display phase after every step. Returns the receipts in order, the last state
 * and `next` (set only when `stopBefore` matched).
 */
export async function advanceLogged(h: HostScenario, first: WorkflowAdvanceInput, phases: PhaseLog,
  stopBefore: (input: WorkflowAdvanceInput) => boolean = () => false): Promise<{ receipts: WorkflowStepReceipt[];
  state: string; reason: string | null; next: WorkflowAdvanceInput | null }> {
  const receipts: WorkflowStepReceipt[] = [];
  let input = first;
  for (let guard = 0; guard < 64; guard += 1) {
    if (stopBefore(input)) return { receipts, state: 'stopped', reason: null, next: input };
    let calls = 0;
    const one = await h.advance(input, { stopBefore: () => calls++ >= 1, invariants: { label: input.flowId } });
    receipts.push(...one.receipts);
    phases.push((await h.goalDisplay()).phase);
    if (one.state !== 'stopped') return { receipts, state: one.state, reason: one.reason, next: null };
    if (one.next === null) throw new Error('a stopped single step must carry its next request');
    input = one.next;
  }
  throw new Error('the Workflow did not settle within the step guard');
}

/** `tasks/query` of the AG2b Goal on a Host: its active Plan and Task rows. */
export async function hostGraph(h: HostScenario): Promise<{ plan: PlanRevisionSnapshot; tasks: TaskRow[] }> {
  const read = await h.post<ReadResult<{ plan: PlanRevisionSnapshot; tasks: TaskRow[] }>>('tasks/query', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
  if (read.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

/**
 * W16 through the Host routes as the operator (`plans/propose`, `plans/apply`, the requests the plan editor
 * sends): the next revision of the active Plan with `edit` applied, pinned to the Goal as read. The §11
 * invariants after the adoption, as the operator's `plan_adopted` step. Returns the adopted Plan.
 */
export async function hostAdopt(h: HostScenario, planId: string, edit: (draft: DraftV2) => DraftV2,
  reason: PlanChangeReason, label: string): Promise<PlanRevisionSnapshot> {
  const source = (await hostGraph(h)).plan;
  const goal = await h.post<ReadResult<{ goal: { revision: number } }>>('goals/read', plain(AG2B_SCOPE, AG2B_GOAL_REF));
  if (goal.status !== 'ready') throw new Error('the Goal must be readable');
  const expected = [{ ref: AG2B_GOAL_REF, revision: goal.value.goal.revision }];
  const proposed = await h.post<{ status: string; value: { ref: PlanProposalRef; revision: number; issues: unknown[] } }>('plans/propose',
    graphWrite(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF, basedOn: source.ref, draft: draftFrom(source, planId, edit), reason },
      `${label}-propose`, expected));
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) throw new Error(`proposal ${label}: ${JSON.stringify(proposed)}`);
  const applied = await h.post<{ status: string; value: PlanRevisionSnapshot }>('plans/apply', graphWrite(AG2B_SCOPE,
    { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] }, `${label}-apply`, expected));
  if (applied.status !== 'committed') throw new Error(`adoption ${label}: ${JSON.stringify(applied)}`);
  await assertInvariants(h, `${label} adopted`, { kind: 'plan_adopted', actor: { ...h.stepActor() },
    automationPolicy: h.automationPolicy(), label: `${label} adopted` });
  return applied.value;
}

// ---------------------------------------------------------------------------
// 3a. The C6 cases moved from tests/composition/A2-entry-plan-platform.test.ts
// ---------------------------------------------------------------------------

const C6_AT = '2026-10-05T00:00:00.000Z';
const c6ProjectId = 'a2-c6-project';
const c6WorkspaceId = 'a2-c6-workspace';
const c6Scope = { projectId: c6ProjectId, workspaceId: c6WorkspaceId };
const c6HostActor = { kind: 'human' as const, id: 'a2-c6-host' };
const c6ProjectRef = { aggregateType: 'Project' as const, projectId: c6ProjectId };
const c6WorkspaceRef = { aggregateType: 'Workspace' as const, projectId: c6ProjectId, workspaceId: c6WorkspaceId };
const c6GoalRef = { aggregateType: 'Goal' as const, projectId: c6ProjectId, goalId: 'a2-c6-goal' };
const c6PolicyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: c6ProjectId, policyId: 'a2-c6-policy', revision: 1 };
const c6ActiveRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: c6ProjectId };
const c6RoleBinding = { schemaVersion: 1 as const, bindingId: 'a2-c6-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };

/** A moved case's files and its Goal display log, by platform. */
type MovedTarget = { target: InvariantTarget; phases: PhaseLog; label: string };
const movedTargets = new WeakMap<Platform, MovedTarget>();
function movedTargetOf(platform: Platform): MovedTarget {
  const moved = movedTargets.get(platform);
  if (moved === undefined) throw new Error('the platform was not opened by a moved case environment');
  return moved;
}

function c6Ctx(): CoreCallContext {
  return { projectId: c6ProjectId, workspaceId: c6WorkspaceId, principal: { kind: 'host', actor: c6HostActor },
    materialReader: { kind: 'host', projectId: c6ProjectId, workspaceId: c6WorkspaceId, actor: c6HostActor }, signal: new AbortController().signal };
}

function c6WorkspaceBindings(directory: string, revision: { value: number }): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== c6ProjectId || requested.workspaceId !== c6WorkspaceId) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: revision.value } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 'a2-c6-host', permissionRevision: 'a2-c6-grant-1', allowsRead: () => true } };
    },
  };
}

function c6RuntimeHost(scripted: ScriptedModel): RuntimeHostBindings {
  return {
    async resolveConfiguration(context, request) {
      if (context.projectId !== c6ProjectId || context.workspaceId !== c6WorkspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the runtime Host is not bound to this workspace' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'the current Role binding is inadmissible' };
      }
      return { status: 'ready', value: {
        configurationRevision: 'a2-c6-host-config@1',
        model: { configuration: { revision: 'a2-c6-host-config@1', provider: 'deepseek', model: 'a2-c6-scripted',
          baseUrl: 'http://127.0.0.1' },
        client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
          tokenizer: 'a2-c6-counter' }) } },
        budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
          maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 },
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex('A2 C6 trusted static role guidance') } : null,
        tools: ['read'], writeScope: [], skills: { resourceRoot: fileURLToPath(new URL('../../../vendor/coding-agent/resources/skills',
          import.meta.url)), enabledIds: [] },
        systemInstruction: 'A2 C6 trusted static role guidance', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

function c6PlanDraft(): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'a2-c6-plan', planRevision: 1, goalId: c6GoalRef.goalId, stages: [],
    tasks: [
      { taskId: 'work-1', title: 'First ordinary work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'work-1', role: 'builder', instruction: 'Do the first ordinary work' }],
    obligations: [{ obligationId: 'a2-c6-obligation', title: 'Deliver the work', requirementLevel: 'required',
      taskIds: ['work-1', 'goal-gate'],
      verificationRequirements: [{ requirementId: 'a2-c6-static', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

type C6Environment = { platform: Platform; scripted: ScriptedModel; directory: string; p1: PlanRevisionRef };

async function c6OpenEnvironment(): Promise<C6Environment> {
  const directory = await mkdtemp(join(tmpdir(), 'next-a2-c6-'));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-a2-c6-source-'));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), 'A2 C6 registered workspace source\n');
  const revision = { value: 1 };
  const scripted = createScriptedModel([{ kind: 'text', text: 'A2 C6 work result' }]);
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'a2-c6-checks-1', workspace: c6WorkspaceRef, executor: c6HostActor, permissionRevision: 'a2-c6-grant-1',
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 'a2-c6-check', kind: 'static', command: 'echo A2_C6_OK', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'a2-c6-consumer',
    bindings: [{ workspace: c6Scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: c6RoleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: c6WorkspaceBindings(workspaceRoot, revision), now: () => C6_AT,
    kernelStores: { entries: [{ adapterId: 'a2-c6-kernel', storeKey: 'a2-c6-kernel-store',
      workspace: c6Scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: c6RuntimeHost(scripted), checks, workflow,
  });
  platforms.push(platform);
  movedTargets.set(platform, { target: { database: directory, projectId: c6ProjectId }, phases: [], label: 'a2-c6' });
  const host = c6Ctx();
  expect(await platform.projects.createProject(host, { meta: { requestId: 'a2-c6-project',
    expected: [{ ref: c6ProjectRef, revision: 0 }] }, input: { projectId: c6ProjectId } })).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(host, { meta: { requestId: 'a2-c6-workspace',
    expected: [{ ref: c6ProjectRef, revision: 1 }, { ref: c6WorkspaceRef, revision: 0 }] }, input: { workspace: c6Scope } });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  revision.value = registered.value.revision;
  const installed = await platform.completionPolicies.installCompletionPolicy(host, { meta: { requestId: 'a2-c6-policy',
    expected: [{ ref: c6ProjectRef, revision: 1 }, { ref: c6PolicyRef, revision: 0 }] },
    input: { policyId: 'a2-c6-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'a2-c6-policy-active',
    expected: [{ ref: c6ProjectRef, revision: 1 }, { ref: c6ActiveRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'a2-c6-baseline',
    expected: [{ ref: c6ProjectRef, revision: 1 }, { ref: c6WorkspaceRef, revision: revision.value }] },
    input: { baselineId: 'a2-c6-baseline', description: 'The A2 C6 module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId: c6ProjectId, moduleId: 'a2-c6' }, name: 'A2 C6',
        responsibility: 'Verify work', paths: ['src'], interfaces: [] }] } } })).toMatchObject({ status: 'committed' });
  expect(await platform.goals.createGoal(host, { meta: { requestId: 'a2-c6-goal',
    expected: [{ ref: c6ProjectRef, revision: 1 }, { ref: c6WorkspaceRef, revision: revision.value }] },
    input: { goalId: c6GoalRef.goalId, workspace: c6Scope, objective: 'Run a claimed Task across an unrelated adoption' } }))
    .toMatchObject({ status: 'committed' });
  const proposed = await platform.plans.proposePlan(host, { meta: { requestId: 'a2-c6-plan-propose', expected: [] },
    input: { goalRef: c6GoalRef, basedOn: null, draft: c6PlanDraft(), reason: { text: 'Initial A2 C6 plan', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error('Plan proposal failed');
  const applied = await platform.plans.applyPlanChange(host, { meta: { requestId: 'a2-c6-plan-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');
  await c6Check(platform, 'seeded');
  return { platform, scripted, directory, p1: applied.value.ref };
}

/** §11 invariants (and the Goal display phase) on a moved C6 case's files after an owner write outside `drive`. */
async function c6Check(platform: Platform, label: string, step?: Omit<FuzzStep, 'automationPolicy'>): Promise<void> {
  const moved = movedTargetOf(platform);
  await assertInvariantsAt(moved.target, `${moved.label} ${label}`, step === undefined ? undefined
    : { ...step, automationPolicy: { ...DEFAULT_TASK_AUTOMATION_POLICY }, label });
  const display = await platform.plans.queryGoalDisplay!(c6Ctx(), { goalRef: c6GoalRef });
  if (display.status === 'ready') moved.phases.push(display.value.display.phase);
}

/**
 * A real W16 future-only adoption adding one unrelated plan_only Task; work-1 keeps its definition and basis.
 * The §11 invariants after it (`plan_adopted` by the caller's Host actor) when the platform is a moved C6 one.
 */
async function c6AdoptUnrelatedFuture(
  plans: Platform['plans'], context: CoreCallContext, goal: { aggregateType: 'Goal'; projectId: string; goalId: string },
  suffix: string,
): Promise<PlanRevisionSnapshot> {
  const graph = await plans.queryTaskGraph(context, { goalRef: goal });
  const goalRead = await plans.queryGoal(context, goal);
  if (graph.status !== 'ready' || goalRead.status !== 'ready') throw new Error('the Goal and its graph must be readable');
  const plan = graph.value.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `a2-c6-plan-${suffix}`, planRevision: plan.planRevision + 1, goalId: goal.goalId,
    stages: structuredClone(plan.stages), tasks: [...structuredClone(plan.tasks), { taskId: `future-${suffix}`,
      title: 'Unrelated future intent', requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending',
      scope: { kind: 'goal' }, executionIntent: 'plan_only' }],
    assignments: structuredClone(plan.assignments ?? []), obligations: structuredClone(plan.obligations),
    taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
    taskRelations: plan.schemaVersion === 2 ? structuredClone(plan.taskRelations ?? []) : [],
    inputRequirements: plan.schemaVersion === 2 ? structuredClone(plan.inputRequirements ?? []) : [],
  };
  const expected = [{ ref: goal, revision: goalRead.value.goal.revision }];
  const proposed = await plans.proposePlan(context, { meta: { requestId: `a2-c6-future-${suffix}-propose`, expected },
    input: { goalRef: goal, basedOn: plan.ref, draft, reason: { text: 'An unrelated future-only edit', sources: [] } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) throw new Error(`future proposal failed: ${JSON.stringify(proposed)}`);
  const applied = await plans.applyPlanChange(context, { meta: { requestId: `a2-c6-future-${suffix}-apply`, expected },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`future adoption failed: ${JSON.stringify(applied)}`);
  const actor = context.principal.kind === 'host' ? context.principal.actor : null;
  for (const [platform, moved] of c6PlatformsOf(plans)) {
    if (actor !== null) await c6Check(platform, `future ${suffix} adopted`, { kind: 'plan_adopted', actor: { ...actor } });
    else await assertInvariantsAt(moved.target, `${moved.label} future ${suffix} adopted`);
  }
  return applied.value;
}

/** The moved C6 platform whose `plans` port this is (none for the C2 fixture of the LA-2 case). */
function c6PlatformsOf(plans: Platform['plans']): Array<[Platform, MovedTarget]> {
  return platforms.filter(platform => platform.plans === plans && movedTargets.has(platform))
    .map(platform => [platform, movedTargetOf(platform)]);
}

const c6Select = (flowId: string, taskId: string): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef: c6GoalRef, flowId, sessionHint: null, kind: 'select_work', taskId });

type C6Driven = { stopped: Perform | null; state: string; reason: string | null; receipts: WorkflowStepReceipt[] };
/**
 * The Host drives every returned `next` until `stopBefore` names the next request (not performed) or the
 * Workflow settles. A.2 step 6: after every receipt the §11 invariants with the step's `FuzzStep` and the
 * Goal display phase.
 */
async function c6Drive(platform: Platform, first: WorkflowAdvanceInput,
  stopBefore: (input: WorkflowAdvanceInput) => boolean = () => false): Promise<C6Driven> {
  const receipts: WorkflowStepReceipt[] = [];
  let input = first;
  for (let guard = 0; guard < 64; guard += 1) {
    if (stopBefore(input)) return { stopped: input as Perform, state: 'stopped', reason: null, receipts };
    const result = await platform.workflow.advanceWork(c6Ctx(), input);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    if (result.value.receipt !== null) {
      receipts.push(result.value.receipt);
      const label = `${input.flowId}#${guard} ${result.value.receipt.kind}`;
      const moved = movedTargetOf(platform);
      await assertInvariantsAt(moved.target, `${moved.label} ${label}`,
        stepOfReceipt(result.value.receipt, c6HostActor, DEFAULT_TASK_AUTOMATION_POLICY, label));
      const display = await platform.plans.queryGoalDisplay!(c6Ctx(), { goalRef: c6GoalRef });
      if (display.status === 'ready') moved.phases.push(display.value.display.phase);
    }
    if (result.value.state === 'completed' || result.value.next === null) {
      return { stopped: null, state: result.value.state, reason: result.value.reason, receipts };
    }
    input = result.value.next;
  }
  throw new Error('the Workflow did not settle within the step guard');
}

async function c6TaskRow(platform: Platform, taskId: string): Promise<TaskRow> {
  const graph = await platform.plans.queryTaskGraph(c6Ctx(), { goalRef: c6GoalRef });
  if (graph.status !== 'ready') throw new Error('the task graph must be readable');
  const row = graph.value.tasks.find(candidate => candidate.ref.taskId === taskId);
  if (row === undefined) throw new Error(`task ${taskId} is not in the graph`);
  return row;
}

function c6ClaimOf(receipts: readonly WorkflowStepReceipt[]): TaskClaim {
  const receipt = receipts.find(candidate => candidate.kind === 'claim_task');
  if (receipt?.kind !== 'claim_task' || receipt.result.status !== 'committed') throw new Error('the claim must commit');
  return receipt.result.value;
}

/** The moved C6 helpers, under the source file's names. */
export const c6Case = {
  goalRef: c6GoalRef,
  ctx: c6Ctx,
  openEnvironment: c6OpenEnvironment,
  adoptUnrelatedFuture: c6AdoptUnrelatedFuture,
  select: c6Select,
  performs,
  drive: c6Drive,
  taskRow: c6TaskRow,
  claimOf: c6ClaimOf,
  /** The `ExecutionEntryAuthorized` audit bodies in the ledger (the source file read them after the platform closed). */
  authorizedEvents: authorizedEventsIn,
  check: c6Check,
  /** The Goal display phases the moved case's drive and checks recorded. */
  phasesOf: (platform: Platform): PhaseLog => movedTargetOf(platform).phases,
  targetOf: (platform: Platform): InvariantTarget => movedTargetOf(platform).target,
};

// ---------------------------------------------------------------------------
// 3b. The C7 cases moved from tests/composition/A2-disposition-change-platform.test.ts
// ---------------------------------------------------------------------------

const C7_AT = '2026-10-06T00:00:00.000Z';
const c7ProjectId = 'a2-disposition-project';
const c7WorkspaceId = 'a2-disposition-workspace';
const c7Scope = { projectId: c7ProjectId, workspaceId: c7WorkspaceId };
const c7Operator = { kind: 'human' as const, id: 'a2-disposition-operator' };
const c7ProjectRef = { aggregateType: 'Project' as const, projectId: c7ProjectId };
const c7WorkspaceRef = { aggregateType: 'Workspace' as const, projectId: c7ProjectId, workspaceId: c7WorkspaceId };
const c7GoalRef = { aggregateType: 'Goal' as const, projectId: c7ProjectId, goalId: 'a2-disposition-goal' };
const c7PolicyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: c7ProjectId, policyId: 'a2-disposition-policy', revision: 1 };
const c7ActiveRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: c7ProjectId };
const c7RoleBinding = { schemaVersion: 1 as const, bindingId: 'a2-disposition-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const c7RuntimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const C7_CHECK_ID = 'a2-disposition-check';
const C7_GATE = 'goal-gate';
const C7_TASK = { projectId: c7ProjectId, goalId: c7GoalRef.goalId, taskId: 'work-1' };

function c7Ctx(actor: Extract<ActorRef, { kind: 'human' | 'system' }> = c7Operator): CoreCallContext {
  return { projectId: c7ProjectId, workspaceId: c7WorkspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: c7ProjectId, workspaceId: c7WorkspaceId, actor }, signal: new AbortController().signal };
}
/** A Host acting as the platform automation actor: rework class `system` (§1 `reworkActorClassOf`). */
const c7Automation = (): CoreCallContext => c7Ctx({ ...WORKFLOW_AUTOMATION_ACTOR });

function c7WorkspaceBindings(directory: string, state: { revision: number }): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== c7ProjectId || requested.workspaceId !== c7WorkspaceId) {
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

function c7RuntimeHost(scripted: ScriptedModel): RuntimeHostBindings {
  return {
    async resolveConfiguration(context, request) {
      if (context.projectId !== c7ProjectId || context.workspaceId !== c7WorkspaceId) {
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
        budget: c7RuntimeBudget,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex('A2 disposition trusted static role guidance') } : null,
        tools: ['read'], writeScope: [], skills: { resourceRoot: fileURLToPath(new URL('../../../vendor/coding-agent/resources/skills',
          import.meta.url)), enabledIds: [] },
        systemInstruction: 'A2 disposition trusted static role guidance', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

const C7_OBLIGATION = { obligationId: 'a2-disposition-obligation', title: 'Deliver the work', requirementLevel: 'required' as const,
  verificationRequirements: [{ requirementId: 'a2-disposition-static', requirementLevel: 'required' as const, kind: 'static',
    description: 'Registered static command check' }] };

function c7PlanDraft(): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'a2-disposition-plan-1', planRevision: 1, goalId: c7GoalRef.goalId, stages: [],
    tasks: [workTask('work-1', 'The ordinary work'), { taskId: C7_GATE, title: 'Goal gate', requirementLevel: 'required',
      taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: [{ taskId: 'work-1', role: 'builder', instruction: 'Do the ordinary work' }],
    // The gate carries the obligation too, so work-1 may be deferred without a new carrier.
    obligations: [{ ...C7_OBLIGATION, taskIds: ['work-1', C7_GATE] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

type C7Environment = { platform: Platform; scripted: ScriptedModel; workspaceRoot: string; directory: string;
  /** A.2 step 6: the platform's workspace bindings (a race's requeue owner resolves the same root). */
  workspace: WorkspaceHostBindings };

async function c7OpenEnvironment(replies: number): Promise<C7Environment> {
  const directory = await mkdtemp(join(tmpdir(), 'next-a2-disposition-'));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-a2-disposition-source-'));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), 'A2 disposition registered workspace source\n');
  const state = { revision: 1 };
  const scripted = createScriptedModel(Array.from({ length: replies }, (_, index) => ({ kind: 'text' as const,
    text: `A2 disposition work result ${index + 1}` })));
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'a2-disposition-checks-1', workspace: c7WorkspaceRef, executor: c7Operator,
    permissionRevision: 'a2-disposition-grant-1', sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
    deniedPrefixes: ['.git'],
    checks: [{ checkId: C7_CHECK_ID, kind: 'static', command: 'test -f fixed.txt', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'a2-disposition-consumer',
    bindings: [{ workspace: c7Scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: c7RoleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const workspace = c7WorkspaceBindings(workspaceRoot, state);
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace, now: () => C7_AT,
    kernelStores: { entries: [{ adapterId: 'a2-disposition-kernel', storeKey: 'a2-disposition-kernel-store',
      workspace: c7Scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: c7RuntimeHost(scripted), checks, workflow,
  });
  platforms.push(platform);
  movedTargets.set(platform, { target: { database: directory, projectId: c7ProjectId }, phases: [], label: 'a2-disposition' });
  const host = c7Ctx();
  expect(await platform.projects.createProject(host, { meta: { requestId: 'a2-project',
    expected: [{ ref: c7ProjectRef, revision: 0 }] }, input: { projectId: c7ProjectId } })).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(host, { meta: { requestId: 'a2-workspace',
    expected: [{ ref: c7ProjectRef, revision: 1 }, { ref: c7WorkspaceRef, revision: 0 }] }, input: { workspace: c7Scope } });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  state.revision = registered.value.revision;
  const installed = await platform.completionPolicies.installCompletionPolicy(host, { meta: { requestId: 'a2-policy',
    expected: [{ ref: c7ProjectRef, revision: 1 }, { ref: c7PolicyRef, revision: 0 }] },
    input: { policyId: 'a2-disposition-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'a2-policy-active',
    expected: [{ ref: c7ProjectRef, revision: 1 }, { ref: c7ActiveRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'a2-baseline',
    expected: [{ ref: c7ProjectRef, revision: 1 }, { ref: c7WorkspaceRef, revision: state.revision }] },
    input: { baselineId: 'a2-baseline', description: 'The A2 disposition module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId: c7ProjectId, moduleId: 'a2-disposition' }, name: 'A2 disposition',
        responsibility: 'Change what is planned', paths: ['src'], interfaces: [] }] } } })).toMatchObject({ status: 'committed' });
  expect(await platform.goals.createGoal(host, { meta: { requestId: 'a2-goal',
    expected: [{ ref: c7ProjectRef, revision: 1 }, { ref: c7WorkspaceRef, revision: state.revision }] },
    input: { goalId: c7GoalRef.goalId, workspace: c7Scope, objective: 'Change the plan of work that already ran' } }))
    .toMatchObject({ status: 'committed' });
  const proposedPlan = await platform.plans.proposePlan(host, { meta: { requestId: 'a2-plan-propose', expected: [] },
    input: { goalRef: c7GoalRef, basedOn: null, draft: c7PlanDraft(), reason: { text: 'Initial A2 disposition plan', sources: [] } } });
  if (proposedPlan.status !== 'committed') throw new Error('Plan proposal failed');
  const applied = await platform.plans.applyPlanChange(host, { meta: { requestId: 'a2-plan-apply', expected: [] },
    input: { proposalRef: proposedPlan.value.ref, expectedProposalRevision: proposedPlan.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');
  await c7Check(platform, 'seeded');
  return { platform, scripted, workspaceRoot, directory, workspace };
}

/** §11 invariants (and the Goal display phase) on a moved C7 case's files after an owner write outside `drive`. */
async function c7Check(platform: Platform, label: string, step?: Omit<FuzzStep, 'automationPolicy'>): Promise<void> {
  const moved = movedTargetOf(platform);
  await assertInvariantsAt(moved.target, `${moved.label} ${label}`, step === undefined ? undefined
    : { ...step, automationPolicy: { ...DEFAULT_TASK_AUTOMATION_POLICY }, label });
  const display = await platform.plans.queryGoalDisplay!(c7Ctx(), { goalRef: c7GoalRef });
  if (display.status === 'ready') moved.phases.push(display.value.display.phase);
}

const c7Select = (flowId: string, taskId: string | null = null): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef: c7GoalRef, flowId, sessionHint: null, kind: 'select_work', ...(taskId === null ? {} : { taskId }) });

type C7Driven = { state: string; reason: string | null; receipts: WorkflowStepReceipt[]; stoppedBefore: boolean;
  /** A.2 step 6: the request `stopBefore` matched (not performed), else null. */
  next: WorkflowAdvanceInput | null };
/**
 * The Host drives every returned `next` until the Workflow settles or `stopBefore` names the next step.
 * A.2 step 6: after every receipt the §11 invariants with the step's `FuzzStep` and the Goal display phase.
 */
async function c7Drive(platform: Platform, first: WorkflowAdvanceInput,
  stopBefore: (input: WorkflowAdvanceInput) => boolean = () => false): Promise<C7Driven> {
  const receipts: WorkflowStepReceipt[] = [];
  let input = first;
  for (let guard = 0; guard < 64; guard += 1) {
    if (stopBefore(input)) return { state: 'stopped', reason: null, receipts, stoppedBefore: true, next: input };
    const result = await platform.workflow.advanceWork(c7Ctx(), input);
    if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
    if (result.value.receipt !== null) {
      receipts.push(result.value.receipt);
      const label = `${input.flowId}#${guard} ${result.value.receipt.kind}`;
      const moved = movedTargetOf(platform);
      await assertInvariantsAt(moved.target, `${moved.label} ${label}`,
        stepOfReceipt(result.value.receipt, c7Operator, DEFAULT_TASK_AUTOMATION_POLICY, label));
      const display = await platform.plans.queryGoalDisplay!(c7Ctx(), { goalRef: c7GoalRef });
      if (display.status === 'ready') moved.phases.push(display.value.display.phase);
    }
    if (result.value.state === 'completed' || result.value.next === null) {
      return { state: result.value.state, reason: result.value.reason, receipts, stoppedBefore: false, next: null };
    }
    input = result.value.next;
  }
  throw new Error('the Workflow did not settle within the step guard');
}

async function c7Graph(platform: Platform) {
  const read = await platform.plans.queryTaskGraph(c7Ctx(), { goalRef: c7GoalRef });
  if (read.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(read)}`);
  return read.value;
}
async function c7TaskRow(platform: Platform, taskId: string): Promise<TaskRow> {
  const row = (await c7Graph(platform)).tasks.find(candidate => candidate.ref.taskId === taskId);
  if (row === undefined) throw new Error(`task ${taskId} is not in the graph`);
  return row;
}
async function c7GoalDisplay(platform: Platform): Promise<GoalDisplayV1> {
  const read = await platform.plans.queryGoalDisplay!(c7Ctx(), { goalRef: c7GoalRef });
  if (read.status !== 'ready') throw new Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
  return read.value.display;
}
async function c7ReadRun(platform: Platform, runRef: RunRef): Promise<TaskExecutionRecord> {
  const read = await platform.executions.readExecution(c7Ctx(), runRef);
  if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

/** The next future revision of the active Plan with `edit` applied to a copy of its draft fields. */
async function c7NextDraft(platform: Platform, planId: string, edit: (draft: DraftV2) => DraftV2) {
  const plan = (await c7Graph(platform)).plan;
  return { source: plan, draft: draftFrom(plan, planId, edit) };
}
/** `plans/propose`; A.2 step 6: the §11 invariants after it (nothing but a candidate is written). */
async function c7Propose(platform: Platform, requestId: string, source: PlanRevisionSnapshot, draft: PlanRevisionDraft,
  reason: PlanChangeReason, caller: CoreCallContext = c7Ctx()) {
  const result = await platform.plans.proposePlan(caller, { meta: { requestId, expected: [] }, input: { goalRef: c7GoalRef, basedOn: source.ref, draft, reason } });
  await c7Check(platform, `${requestId} (${result.status})`);
  return result;
}
/**
 * `plans/apply`; A.2 step 6: the §11 invariants after it, as the caller's `plan_adopted` step when it
 * committed (a refusal writes nothing and is checked without a step).
 */
async function c7Apply(platform: Platform, requestId: string, proposal: { ref: PlanProposalRef; revision: number },
  caller: CoreCallContext = c7Ctx()) {
  const result = await platform.plans.applyPlanChange(caller, { meta: { requestId, expected: [] },
    input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] } });
  const actor = caller.principal.kind === 'host' ? caller.principal.actor : null;
  await c7Check(platform, `${requestId} (${result.status})`, result.status === 'committed' && actor !== null
    ? { kind: 'plan_adopted', actor: { ...actor } } : undefined);
  return result;
}
async function c7Proposed(platform: Platform, requestId: string, source: PlanRevisionSnapshot, draft: PlanRevisionDraft,
  reason: PlanChangeReason, caller: CoreCallContext = c7Ctx()) {
  const result = await c7Propose(platform, requestId, source, draft, reason, caller);
  if (result.status !== 'committed') throw new Error(`proposal ${requestId} failed: ${JSON.stringify(result)}`);
  return { ref: result.value.ref, revision: result.value.revision };
}
async function c7ActivePlanRef(platform: Platform) {
  const goal = await platform.plans.queryGoal(c7Ctx(), c7GoalRef);
  if (goal.status !== 'ready') throw new Error('the Goal must be readable');
  return goal.value.goal.activePlanRevision;
}
const c7WithDisposition = (tasks: RuntimeTask[], taskId: string, patch: Partial<RuntimeTask>): RuntimeTask[] =>
  tasks.map(task => task.taskId === taskId ? { ...task, ...patch } : task);

/** The moved C7 helpers, under the source file's names. */
export const c7Case = {
  /** The platform's fixed clock. */
  AT: C7_AT,
  operator: c7Operator,
  goalRef: c7GoalRef,
  CHECK_ID: C7_CHECK_ID,
  GATE: C7_GATE,
  TASK: C7_TASK,
  OBLIGATION: C7_OBLIGATION,
  ctx: c7Ctx,
  automation: c7Automation,
  work: workTask,
  openEnvironment: c7OpenEnvironment,
  select: c7Select,
  performs,
  drive: c7Drive,
  graph: c7Graph,
  taskRow: c7TaskRow,
  goalDisplay: c7GoalDisplay,
  readRun: c7ReadRun,
  nextDraft: c7NextDraft,
  propose: c7Propose,
  apply: c7Apply,
  proposed: c7Proposed,
  activePlanRef: c7ActivePlanRef,
  withDisposition: c7WithDisposition,
  check: c7Check,
  phasesOf: (platform: Platform): PhaseLog => movedTargetOf(platform).phases,
  targetOf: (platform: Platform): InvariantTarget => movedTargetOf(platform).target,
};

/** The agent actor a Run's whiteboard write carries, for the `plan_adopted` step (class `agent`). */
export function agentActorOf(runRef: RunRef): ActorRef {
  return { kind: 'agent', id: runRef.runId, runRef };
}

// ---------------------------------------------------------------------------
// 4. The commit barrier of the §3.6 PLAN-05 races
// ---------------------------------------------------------------------------

/**
 * The owner a race interrupts, by the identity prefix of its commit (`plan-service.ts:196`, `claim-service.ts:88`,
 * `requeue-service.ts:124`, `control-service.ts:95`).
 */
const RACE_PREFIXES = { plans: 'plan-apply:', claims: 'task-claim:', requeues: 'task-requeue:', controls: 'r4-control-submit:' } as const;
export type RaceWriter = keyof typeof RACE_PREFIXES;

export type RaceWindow = {
  plans: Pick<PlanServicePort, 'applyPlanChange'>;
  claims: Pick<TaskClaimPort, 'claimTask'>;
  requeues: Required<Pick<TaskClaimPort, 'requeueTask'>>;
  controls: Pick<RunControlPort, 'submitControl'>;
  /** Whether the interrupted writer's commit arrived, so `inside` ran before it. */
  raced(): boolean;
};

let raceIds = 0;

/**
 * The commit barrier of tests/composition/W1-future-plan-platform.test.ts:280-341 (the pattern §3.6 PLAN-05 names
 * for its races; tests/work-graph/A2-disposition-change.test.ts:475 at the service): the plan, claim, requeue and
 * control owners built as `createTargetPlatform` builds them, over a second record backend on the scenario's
 * `ledger.sqlite`. The first commit of `writer` awaits `inside` before it commits: the other writer, through the
 * platform's (or the Host's) own owners, commits in this writer's read→commit window, and this writer then commits
 * against the ledger as it is now. `inside` keeps its results for the test to assert after the outer call returns.
 * The requeue owner resolves `workspace` (the platform's bindings). Closed by `cleanupPlan`.
 */
export function raceWindow(database: string, writer: RaceWriter, inside: () => Promise<void>,
  host: { now: () => string; workspace?: Pick<WorkspaceHostBindings, 'resolveRoot'> }): RaceWindow {
  const backend = createSqliteRecordBackend({ schemas: platformRecordSchemas(), path: join(database, 'ledger.sqlite') });
  raceBackends.push(backend);
  let raced = false;
  const records: SqliteRecordBackend['records'] = { ...backend.records, async commit(prepared) {
    if (!raced && prepared.identityKey.startsWith(RACE_PREFIXES[writer])) {
      raced = true;
      await inside();
    }
    return backend.records.commit(prepared);
  } };
  const id = (): string => `plan-race-${++raceIds}`;
  const reads = createRunStateReader({ records });
  const workspace: Pick<WorkspaceHostBindings, 'resolveRoot'> = host.workspace ?? { async resolveRoot() {
    return { status: 'rejected', code: 'unsupported', reason: 'this race window reads no workspace' };
  } };
  const policy = (): TaskAutomationPolicyV1 => ({ ...DEFAULT_TASK_AUTOMATION_POLICY });
  return {
    plans: createPlanService({ records, now: host.now, eventId: id, automationPolicy: policy }),
    claims: createTaskClaimService({ records, roles: createRoleConfigurationService({ records, now: host.now, eventId: id }),
      now: host.now, newId: id }),
    requeues: createTaskRequeueService({ records, reads, workspaceHost: workspace, source: new VerificationWorkspaceReader(),
      materials: {
        async storeArtifact() { throw new Error('a race requeue stores no note'); },
        async openArtifact() { throw new Error('a race requeue reads no artifact'); },
      },
      messages: { async readMessage() { return { status: 'not_found' }; } },
      automationPolicy: policy, now: host.now, eventId: id }),
    controls: createRunControlService({ records, authority: createMaterialRecordReaders(records).authority, reads,
      now: host.now, eventId: id }),
    raced: () => raced,
  };
}
