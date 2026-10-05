/**
 * A.2 step 5.4b through the public composition root on SQLite
 * (docs/refactor/STATE-MACHINES-SPEC.md §3.3 point 5, §6 RUN-02/RUN-04, §6.1
 * contract (g), §12 W-01 note; C6, LA-2).
 *
 * 1. C6: the Workflow claims work-1 on P1; an unrelated future-only adoption
 *    moves the Goal to P2 before the start (and, in the second case, before the
 *    prepare, with a fresh selection). W3 used to refuse the claim on P1 with
 *    `revision_conflict`; now the Run keeps its Session, Lease and claim Plan,
 *    is authorized (the audit names P2), enters, completes, its round opens
 *    under P2 (VD-7) and PASS satisfies the Task. Nothing is requeued.
 * 2. LA-2: a consumer Run that reads a granted Plan-selected material is
 *    granted after an unrelated adoption, prepared, authorized and begun, and
 *    a further adoption while it is in the Kernel does not stop its second
 *    model request.
 *
 * No real model is called: the scripted model answers.
 */
import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkflowAdvanceInput, WorkflowOperation, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { createC2RuntimePlatform, type C2RuntimePlatformFixture } from '../helpers/C2-runtime-platform-fixture.js';

const AT = '2026-10-05T00:00:00.000Z';
const projectId = 'a2-c6-project';
const workspaceId = 'a2-c6-workspace';
const scope = { projectId, workspaceId };
const hostActor = { kind: 'human' as const, id: 'a2-c6-host' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'a2-c6-goal' };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'a2-c6-policy', revision: 1 };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'a2-c6-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
const directories: string[] = [];
const platforms: Platform[] = [];
const c2Fixtures: C2RuntimePlatformFixture[] = [];
afterEach(async () => {
  for (const platform of platforms.splice(0)) await platform.close().catch(() => undefined);
  for (const fixture of c2Fixtures.splice(0)) await fixture.close().catch(() => undefined);
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function ctx(): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor: hostActor },
    materialReader: { kind: 'host', projectId, workspaceId, actor: hostActor }, signal: new AbortController().signal };
}

function workspaceBindings(directory: string, revision: { value: number }): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== projectId || requested.workspaceId !== workspaceId) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: revision.value } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 'a2-c6-host', permissionRevision: 'a2-c6-grant-1', allowsRead: () => true } };
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
        configurationRevision: 'a2-c6-host-config@1',
        model: { configuration: { revision: 'a2-c6-host-config@1', provider: 'deepseek', model: 'a2-c6-scripted',
          baseUrl: 'http://127.0.0.1' },
        client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
          tokenizer: 'a2-c6-counter' }) } },
        budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
          maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 },
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex('A2 C6 trusted static role guidance') } : null,
        tools: ['read'], writeScope: [], skills: { resourceRoot: fileURLToPath(new URL('../../vendor/coding-agent/resources/skills',
          import.meta.url)), enabledIds: [] },
        systemInstruction: 'A2 C6 trusted static role guidance', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

function planDraft(): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'a2-c6-plan', planRevision: 1, goalId: goalRef.goalId, stages: [],
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

type Environment = { platform: Platform; scripted: ReturnType<typeof createScriptedModel>; directory: string; p1: PlanRevisionRef };

async function openEnvironment(): Promise<Environment> {
  const directory = await mkdtemp(join(tmpdir(), 'next-a2-c6-'));
  directories.push(directory);
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-a2-c6-source-'));
  directories.push(workspaceRoot);
  await writeFile(join(workspaceRoot, 'source.txt'), 'A2 C6 registered workspace source\n');
  const revision = { value: 1 };
  const scripted = createScriptedModel([{ kind: 'text', text: 'A2 C6 work result' }]);
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'a2-c6-checks-1', workspace: workspaceRef, executor: hostActor, permissionRevision: 'a2-c6-grant-1',
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 'a2-c6-check', kind: 'static', command: 'echo A2_C6_OK', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: 'a2-c6-consumer',
    bindings: [{ workspace: scope, sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding, budget: { tokenBudget: 100000, deadline: null } }],
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory }, workspace: workspaceBindings(workspaceRoot, revision), now: () => AT,
    kernelStores: { entries: [{ adapterId: 'a2-c6-kernel', storeKey: 'a2-c6-kernel-store',
      workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: runtimeHost(scripted), checks, workflow,
  });
  platforms.push(platform);
  const host = ctx();
  expect(await platform.projects.createProject(host, { meta: { requestId: 'a2-c6-project',
    expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } })).toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(host, { meta: { requestId: 'a2-c6-workspace',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  revision.value = registered.value.revision;
  const installed = await platform.completionPolicies.installCompletionPolicy(host, { meta: { requestId: 'a2-c6-policy',
    expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
    input: { policyId: 'a2-c6-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
  if (installed.status !== 'committed') throw new Error('policy install failed');
  expect(await platform.completionPolicies.activateCompletionPolicy(host, { meta: { requestId: 'a2-c6-policy-active',
    expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } })).toMatchObject({ status: 'committed' });
  expect(await platform.architecture.adoptInitialArchitecture(host, { meta: { requestId: 'a2-c6-baseline',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: revision.value }] },
    input: { baselineId: 'a2-c6-baseline', description: 'The A2 C6 module boundary', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [{ ref: { projectId, moduleId: 'a2-c6' }, name: 'A2 C6',
        responsibility: 'Verify work', paths: ['src'], interfaces: [] }] } } })).toMatchObject({ status: 'committed' });
  expect(await platform.goals.createGoal(host, { meta: { requestId: 'a2-c6-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: revision.value }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Run a claimed Task across an unrelated adoption' } }))
    .toMatchObject({ status: 'committed' });
  const proposed = await platform.plans.proposePlan(host, { meta: { requestId: 'a2-c6-plan-propose', expected: [] },
    input: { goalRef, basedOn: null, draft: planDraft(), reason: { text: 'Initial A2 C6 plan', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error('Plan proposal failed');
  const applied = await platform.plans.applyPlanChange(host, { meta: { requestId: 'a2-c6-plan-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error('Plan adoption failed');
  return { platform, scripted, directory, p1: applied.value.ref };
}

/** A real W16 future-only adoption adding one unrelated plan_only Task; work-1 keeps its definition and basis. */
async function adoptUnrelatedFuture(
  plans: Platform['plans'], context: CoreCallContext, goal: typeof goalRef | C2RuntimePlatformFixture['fixture']['goalRef'],
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
  return applied.value;
}

const select = (flowId: string, taskId: string): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work', taskId });
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

function claimOf(receipts: readonly WorkflowStepReceipt[]): TaskClaim {
  const receipt = receipts.find(candidate => candidate.kind === 'claim_task');
  if (receipt?.kind !== 'claim_task' || receipt.result.status !== 'committed') throw new Error('the claim must commit');
  return receipt.result.value;
}

/** The `ExecutionEntryAuthorized` audit bodies in the ledger (read after the platform closed). */
function authorizedEvents(directory: string): Array<{ permit: { claim: TaskClaim }; activePlanRef?: PlanRevisionRef }> {
  const database = new DatabaseSync(join(directory, 'ledger.sqlite'), { readOnly: true });
  try {
    const rows = database.prepare('SELECT event_json FROM events ORDER BY id').all() as Array<{ event_json: string }>;
    type Authorized = { eventType: string; permit: { claim: TaskClaim }; activePlanRef?: PlanRevisionRef };
    return rows.map(row => JSON.parse(row.event_json) as Authorized)
      .filter(event => event.eventType === 'ExecutionEntryAuthorized');
  } finally { database.close(); }
}

it('C6: an unrelated adoption after the claim does not stop the claimed Run; it completes under the new Plan', async () => {
  const { platform, scripted, directory, p1 } = await openEnvironment();
  // The Workflow creates a Session, claims work-1 on P1 and prepares it; the adoption lands before the start.
  const toStart = await drive(platform, select('a2-c6-flow', 'work-1'), performs('start'));
  const start = toStart.stopped;
  if (start === null || start.operation.kind !== 'start') throw new Error('the Workflow must reach the start');
  const claim = claimOf(toStart.receipts);
  expect(claim.planRef).toEqual(p1);
  const p2 = await adoptUnrelatedFuture(platform.plans, ctx(), goalRef, 'p2');
  // W3 used to answer `revision_conflict` here; the claim on P1 is authorized because P2 carries work-1 unchanged.
  const toOpen = await drive(platform, start, performs('open_checks'));
  expect(toOpen.receipts[0]).toMatchObject({ kind: 'start', result: { status: 'ready',
    value: { run: { ref: claim.runRef, status: 'ended', outcome: 'completed', planRef: p1 }, session: { occupancy: null } } } });
  const open = toOpen.stopped;
  if (open === null || open.operation.kind !== 'open_checks') throw new Error('the Workflow must reach the open');
  // VD-7: the round opens under the Goal's current Plan.
  expect(open.operation.request.input.planRef).toEqual(p2.ref);
  expect(await drive(platform, open)).toMatchObject({ state: 'completed' });
  const row = await taskRow(platform, 'work-1');
  expect(row).toMatchObject({ effectivePhase: 'satisfied', execution: claim.runRef });
  expect(row.requeueRef ?? null).toBeNull();
  expect(scripted.calls(), 'one model call, no rework').toBe(1);
  await platform.close();
  // The audit of the authorization names the active Plan that carried the Task.
  expect(authorizedEvents(directory)).toEqual([expect.objectContaining({ activePlanRef: p2.ref,
    permit: expect.objectContaining({ claim }) })]);
});

it('C6 (W-01 note): an adoption before the prepare and a fresh selection continue the same claim', async () => {
  const { platform, scripted, directory, p1 } = await openEnvironment();
  const toPrepare = await drive(platform, select('a2-c6-flow-a', 'work-1'), performs('prepare'));
  if (toPrepare.stopped === null) throw new Error('the Workflow must reach the prepare');
  const claim = claimOf(toPrepare.receipts);
  const p2 = await adoptUnrelatedFuture(platform.plans, ctx(), goalRef, 'p2');
  // The claimed Run is visible under P2 and the Workflow resumes it: no second claim, no new Session.
  const resumed = await drive(platform, select('a2-c6-flow-b', 'work-1'));
  expect(resumed.receipts.map(receipt => receipt.kind)).not.toContain('claim_task');
  expect(resumed.receipts.map(receipt => receipt.kind)).not.toContain('create_session');
  expect(resumed.receipts.find(receipt => receipt.kind === 'start')).toMatchObject({ result: { status: 'ready',
    value: { run: { ref: claim.runRef, planRef: p1, outcome: 'completed' } } } });
  expect(resumed.receipts.find(receipt => receipt.kind === 'open_checks'))
    .toMatchObject({ result: { status: 'committed', value: { adoptedPlanRef: p2.ref } } });
  expect(resumed).toMatchObject({ state: 'completed' });
  expect(await taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'satisfied' });
  expect(scripted.calls()).toBe(1);
  await platform.close();
  expect(authorizedEvents(directory)).toEqual([expect.objectContaining({ activePlanRef: p2.ref })]);
});

it('LA-2: a consumer reading a granted Plan input runs through two unrelated adoptions', async () => {
  const holder: { fx?: C2RuntimePlatformFixture; p4?: PlanRevisionSnapshot } = {};
  const fx = await createC2RuntimePlatform({ toolNames: ['read'], allowSourceRead: true,
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'la2-read', name: 'read', args: { path: 'c2-read.txt' } }] },
      { kind: 'text', text: 'LA-2 consumer finished' },
    ],
    beforeReply: async (_request, index) => {
      // The consumer Run is in the Kernel: one more unrelated adoption before its second model request.
      if (index === 0) holder.p4 = await adoptUnrelatedFuture(holder.fx!.platform.plans, holder.fx!.ctx, holder.fx!.fixture.goalRef, 'p4');
    } });
  holder.fx = fx;
  c2Fixtures.push(fx);
  const goal = fx.fixture.goalRef;
  const goalPin = async () => {
    const read = await fx.platform.plans.queryGoal(fx.ctx, goal);
    if (read.status !== 'ready') throw new Error('the Goal must be readable');
    return { ref: goal, revision: read.value.goal.revision };
  };
  // The producer stores a material; P2 selects it as implement-b's input; implement-b is claimed on P2.
  const stored = await fx.platform.materials.storeArtifact({ projectId: fx.scope.projectId, workspaceId: fx.scope.workspaceId,
    principal: { kind: 'work_run', runRef: fx.claim.runRef, roleBinding: fx.fixture.roleBinding },
    materialReader: { kind: 'run', requester: fx.claim.runRef }, signal: new AbortController().signal }, {
    body: 'LA-2 producer material, read by the consumer', contentType: 'text/plain',
    sources: [{ kind: 'workspace', refId: fx.scope.workspaceId, revision: '1' }],
    origin: { kind: 'execution', ref: fx.claim.runRef } });
  if (stored.status !== 'stored') throw new Error(`store failed: ${JSON.stringify(stored)}`);
  const base = fx.fixture.plan;
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: 'la2-input-plan', planRevision: base.planRevision + 1,
    goalId: goal.goalId, stages: structuredClone(base.stages), tasks: structuredClone(base.tasks),
    assignments: structuredClone(base.assignments ?? []), obligations: structuredClone(base.obligations),
    taskHierarchy: structuredClone(base.taskHierarchy), executionDag: structuredClone(base.executionDag), taskRelations: [],
    inputRequirements: [{ requirementId: 'producer-note', consumerTaskId: 'implement-b', kind: 'artifact', artifactRef: stored.ref }] };
  const proposal = await fx.platform.plans.proposePlan(fx.ctx, { meta: { requestId: 'la2-input-propose', expected: [await goalPin()] },
    input: { goalRef: goal, basedOn: fx.fixture.planRef, draft, reason: { text: 'Select the producer note', sources: [] } } });
  if (proposal.status !== 'committed') throw new Error(`proposal failed: ${JSON.stringify(proposal)}`);
  const p2 = await fx.platform.plans.applyPlanChange(fx.ctx, { meta: { requestId: 'la2-input-apply', expected: [await goalPin()] },
    input: { proposalRef: proposal.value.ref, expectedProposalRevision: proposal.value.revision, decisionRefs: [] } });
  if (p2.status !== 'committed') throw new Error(`adoption failed: ${JSON.stringify(p2)}`);
  const card = await fx.platform.sessions.readSession(fx.ctx, fx.secondSession);
  if (card.status !== 'ready') throw new Error('the consumer Session must be readable');
  const consumer = await fx.platform.claims.claimTask(fx.ctx, {
    meta: { requestId: 'la2-consumer-claim', expected: [await goalPin(), { ref: fx.fixture.workspaceRef, revision: 1 },
      { ref: card.value.record.ref, revision: card.value.record.revision }] },
    input: { goalRef: goal, planRef: p2.value.ref, taskId: 'implement-b', sessionRef: fx.secondSession,
      roleBinding: fx.fixture.roleBinding, budget: fx.fixture.budget } });
  if (consumer.status !== 'committed') throw new Error(`consumer claim failed: ${JSON.stringify(consumer)}`);

  // P3: an unrelated adoption. The Host still grants the reader (LA-2), bound to its claim Plan P2.
  const p3 = await adoptUnrelatedFuture(fx.platform.plans, fx.ctx, goal, 'p3');
  const granted = await fx.platform.materials.grantMaterialAccess(fx.ctx, {
    meta: { requestId: 'la2-grant', expected: [await goalPin(), { ref: fx.fixture.workspaceRef, revision: 1 }] },
    input: { goalRef: goal, reader: consumer.value.runRef, materials: [stored.ref],
      sourceSet: { kind: 'workspace_paths', paths: ['c2-read.txt'] }, purpose: 'Read the producer note after P3' } });
  expect(granted, JSON.stringify(granted)).toMatchObject({ status: 'committed',
    value: { grant: { basis: { planRef: p2.value.ref } } } });
  if (granted.status !== 'committed') return;
  fx.allowRun(consumer.value.runRef);
  fx.setMaterialBasis(granted.value.grant.basis);

  // Prepare, W3 (the claim on P2 under the active P3), W4 and the first model request.
  const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: consumer.value.runRef, requestId: 'la2-prepare' });
  expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
  if (prepared.status !== 'ready') return;
  const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'la2-driver',
    requestId: 'la2-start' });
  expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready',
    value: { run: { status: 'ended', outcome: 'completed', planRef: p2.value.ref }, session: { occupancy: null } } });
  // P4 landed while the Run was in the Kernel; the second model request still passed the material barrier.
  expect(holder.p4?.planRevision).toBe(p3.planRevision + 1);
  expect(fx.scripted.calls()).toBe(2);
  const firstUser = fx.scripted.requests[0]?.messages.find(message => message.role === 'user');
  expect(firstUser?.content).toContain('LA-2 producer material, read by the consumer');
  const goalNow = await fx.platform.plans.queryGoal(fx.ctx, goal);
  expect(goalNow).toMatchObject({ status: 'ready', value: { goal: { activePlanRevision: holder.p4?.ref } } });
});
