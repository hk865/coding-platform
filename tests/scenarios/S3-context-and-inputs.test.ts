/**
 * Slice 3 §5.11, case SC01 (one run on SQLite, scripted provider only).
 *
 * The AG2b harness Host has a fixed scope, a fixed plan and a fixed grant
 * without `look_graph`/`find_graph` (lead decision 3, `tests/scenarios/harness.ts`
 * stays unchanged), so this scenario builds its OWN composition root INSIDE the
 * test file with the same exported building blocks and the same pattern the
 * harness's platform mode uses: one SQLite ledger + Kernel store, the real
 * owners, a scripted provider, and the real `claim_task` / `prepare` / `start`
 * performed through the Workflow (`platform.workflow.advanceWork`).
 *
 * It seeds the §5.1 graph: scope `p/w`, Goal `g`, Plan `p1`, stage `Main` with
 * the work tasks `tA`/`tB` (tB instruction `Implement B`), obligation `oB`
 * (`Deliver B`) with verification `vB` (`node check-b.js`), the edge
 * `tB -> tA: artifact A.out`, the legacy declaration `old-A` (exactly the
 * stored body, canonical owner Run `runA` completed), and grants
 * `look_graph`/`find_graph` in the Work binding.
 *
 * The scenario follows the row: claim and prepare `tB` while `A.out` has no
 * output; the scripted model finds `A.out`, looks at `tA` and `tA`'s history,
 * then reads the declared legacy `old-A`; the second prepare of the same Run
 * returns the original manifest; `tB` is not satisfied by `tA`'s completed Run.
 *
 * Part 1 has stubs (`createGraphTools` is unwired, `contextAssembly` is never
 * attached), so this scenario is RED by design; the failure must be an
 * assertion or `not implemented: ...`, never a fixture/setup error.
 */
import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { WorkbenchActor } from '../../src/app/core-http-types.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { createScriptedModel, type ScriptedModel, type ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_INSTRUCTION,
  AG2B_RUNTIME_BUDGET, AG2B_WORK_INSTRUCTION, AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, graphWrite, permissionRevision,
  writeAG2bWorkspace,
} from '../helpers/AG2b-collaboration-fixture.js';
import { tempDir } from '../helpers/A2-restart-fixture.js';
import type { Platform } from './harness.js';
import { cleanupScenarios, performs, SCENARIO_OPERATOR } from './harness.js';
import { manifestOf } from './support/brief.js';
import { preparedOf, toolOutputJson } from './support/common.js';

// ---------------------------------------------------------------------------
// §5.1 identities
// ---------------------------------------------------------------------------

const AT = '2026-10-09T00:00:00.000Z';
const P = 'p';
const W = 'w';
const G = 'g';
const PLAN = 'p1';
const SCOPE = { projectId: P, workspaceId: W };
const PROJECT_REF = { aggregateType: 'Project' as const, projectId: P };
const WORKSPACE_REF = { aggregateType: 'Workspace' as const, projectId: P, workspaceId: W };
const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: P, goalId: G };
const PLAN_REF: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: PLAN };
const POLICY_REF = { aggregateType: 'CompletionPolicyRevision' as const, projectId: P, policyId: 's3-policy', revision: 1 };
const POLICY_ACTIVE_REF = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: P };
const WORK_TASK = { projectId: P, goalId: G, taskId: 'tB' };
const TA = { projectId: P, goalId: G, taskId: 'tA' };
const GATE_TASK = { projectId: P, goalId: G, taskId: 'gate' };
const RUN_A: RunRef = { aggregateType: 'Run', projectId: P, goalId: G, runId: 'runA' };
const LEGACY_BODY = 'old-A';
const LEGACY_DECLARATION_ID = 'legacy:old-A';
const EDGE_LABEL = 'A.out';
const SKILLS_ROOT = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
const WORK_TOOLS = ['read', 'write', 'send_session_message', 'look_graph', 'find_graph'] as const;
const QUERY_TOOLS = ['read', 'project_source', 'look_graph', 'find_graph'] as const;

/** `H(s)` of spec §5.1: the exact sha256 expression, not a fuzzy "valid digest". */
const H = (s: string): string => sha256Hex(s);

// ---------------------------------------------------------------------------
// The self-contained composition root (§5.1 fixture)
// ---------------------------------------------------------------------------

type S3Host = {
  platform: Platform;
  database: string;
  work: ScriptedModel;
  query: ScriptedModel | null;
  actor: WorkbenchActor;
  ctx(): CoreCallContext;
  select(flowId: string, taskId?: string): WorkflowAdvanceInput;
  advance(input: WorkflowAdvanceInput, options?: { stopBefore?: (candidate: WorkflowAdvanceInput) => boolean }): Promise<{
    receipts: WorkflowStepReceipt[]; state: string; reason: string | null; next: WorkflowAdvanceInput | null;
  }>;
  modelRequests(): ModelRequest[];
};

const openHosts: Array<{ platform: Platform }> = [];

afterEach(async () => {
  for (const host of openHosts.splice(0).reverse()) await host.platform.close().catch(() => undefined);
  await cleanupScenarios();
});

function workspaceBindings(root: string, grant: string): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== P || requested.workspaceId !== W) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this scenario' };
      }
      return { status: 'ready', value: { root, workspaceRevision: 1 } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 's3-host', permissionRevision: grant, allowsRead: () => true } };
    },
  };
}

function s3Checks(actor: WorkbenchActor, command: string, revision: string): TrustedCheckConfiguration {
  return {
    configurationRevision: revision, workspace: WORKSPACE_REF, executor: actor,
    permissionRevision: permissionRevision(actor, SCOPE, ['.']),
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 'vB', kind: 'static', command, cwd: '.', timeoutMs: 30_000, taskIds: 'all' }],
  };
}

/** The custom Host binding: the §5.1 grants with `look_graph`/`find_graph` in Work and Query. */
function s3Runtime(work: ScriptedModel, query: ScriptedModel | null): RuntimeHostBindings {
  return {
    async resolveConfiguration(context, request) {
      if (context.projectId !== P || context.workspaceId !== W) {
        return { status: 'rejected', code: 'forbidden', reason: 'the runtime Host is not bound to this workspace' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'the current Role binding is inadmissible' };
      }
      return { status: 'ready', value: {
        configurationRevision: 's3-work-host@1',
        model: { configuration: { revision: 's3-work-model@1', provider: 'deepseek', model: 's3-scripted-work', baseUrl: 'http://127.0.0.1' },
          client: work.client,
          inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'scenario-counter' }) } },
        budget: AG2B_RUNTIME_BUDGET,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex(AG2B_WORK_INSTRUCTION) } : null,
        tools: [...WORK_TOOLS], writeScope: ['.'],
        skills: { resourceRoot: SKILLS_ROOT, enabledIds: [] }, systemInstruction: AG2B_WORK_INSTRUCTION,
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
    ...(query === null ? {} : {
      async resolveQueryConfiguration(context: import('../../src/contracts/core/call-context.js').CoreCallContext) {
        if (context.projectId !== P || context.workspaceId !== W) {
          return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'the runtime Host is not bound to this workspace' };
        }
        return { status: 'ready' as const, value: {
          configurationRevision: 's3-query-host@1',
          model: { configuration: { revision: 's3-query-model@1', provider: 'deepseek', model: 's3-scripted-query', baseUrl: 'http://127.0.0.1' },
            client: query.client,
            inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'scenario-counter' }) } },
          budget: AG2B_RUNTIME_BUDGET,
          hostTemplate: { templateId: 'advisor', revision: '1', digest: sha256Hex(AG2B_QUERY_INSTRUCTION) },
          tools: [...QUERY_TOOLS], writeScope: [],
          skills: { resourceRoot: SKILLS_ROOT, enabledIds: [] }, systemInstruction: AG2B_QUERY_INSTRUCTION,
          deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
        } };
      },
    }),
  };
}

function s3Ctx(actor: WorkbenchActor): CoreCallContext {
  return { ...SCOPE, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', ...SCOPE, actor }, signal: new AbortController().signal };
}

function runACtx(): CoreCallContext {
  return { ...SCOPE, principal: { kind: 'work_run', runRef: RUN_A, roleBinding: AG2B_WORK_ROLE_BINDING },
    materialReader: { kind: 'run', requester: RUN_A }, signal: new AbortController().signal };
}

/**
 * The canonical owner `runA` completed: the §5.1 fixture names a Run that no
 * public owner can create without executing `tA`, so the fixture seeds the
 * RunSnapshot record directly on the same SQLite ledger (the RecordStore's
 * `snapshots` row the claim owner itself writes). The snapshot is read back
 * through the real record readers when `old-A` is stored under its owner.
 */
function seedCompletedRun(database: string, run: RunSnapshot): void {
  const ledger = new DatabaseSync(join(database, 'ledger.sqlite'));
  try {
    ledger.prepare('INSERT INTO snapshots (ref_key, snapshot_json) VALUES (?, ?) '
      + 'ON CONFLICT(ref_key) DO UPDATE SET snapshot_json = excluded.snapshot_json')
      .run(canonicalJson(run.ref as unknown as JsonValue), JSON.stringify(run));
  } finally {
    ledger.close();
  }
}

function runASnapshot(): RunSnapshot {
  return { ref: RUN_A, revision: 1, schemaVersion: 1, task: TA, attemptId: 's3-attempt-tA',
    planRef: PLAN_REF, roleBinding: AG2B_WORK_ROLE_BINDING, budget: { tokenBudget: 100_000, deadline: null },
    workspaceSnapshot: { workspaceId: W, revision: 1 }, status: 'ended', outcome: 'completed', exitCode: 0,
    lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '', envelope: null, startedAt: AT, endedAt: AT };
}

function planDraft(oldRef: ArtifactRef): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: PLAN, planRevision: 1, goalId: G, stages: [{ stageId: 's', title: 'Main' }],
    tasks: [
      { taskId: 'tA', stageId: 's', title: 'A', requirementLevel: 'required', taskKind: 'work', disposition: 'active',
        phase: 'pending', scope: { kind: 'stage', stageId: 's' }, executionIntent: 'request_execution' },
      { taskId: 'tB', stageId: 's', title: 'B', requirementLevel: 'required', taskKind: 'work', disposition: 'active',
        phase: 'pending', scope: { kind: 'stage', stageId: 's' }, executionIntent: 'request_execution' },
      { taskId: 'gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active',
        phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [
      { taskId: 'tA', role: 'builder', instruction: 'Implement A' },
      { taskId: 'tB', role: 'builder', instruction: 'Implement B' },
    ],
    obligations: [{ obligationId: 'oB', title: 'Deliver B', requirementLevel: 'required', taskIds: ['tA', 'tB', 'gate'],
      verificationRequirements: [{ requirementId: 'vB', requirementLevel: 'required', kind: 'static', description: 'node check-b.js' }] }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [{ taskId: 'tB', dependsOnId: 'tA', requires: { kind: 'artifact', label: EDGE_LABEL } }] },
    inputRequirements: [{ requirementId: 'old-A', consumerTaskId: 'tB', kind: 'artifact', artifactRef: oldRef }],
  };
}

/** The §5.1 graph through the real owners (the same route writers the AG2b seed uses). */
async function seedS3Graph(platform: Platform, actor: WorkbenchActor, oldRef: ArtifactRef): Promise<void> {
  type OwnerCall = (ctx: CoreCallContext, request: never) => Promise<unknown>;
  const owners: Record<string, OwnerCall> = {
    'projects/create': (ctx, request) => platform.projects.createProject(ctx, request),
    'workspaces/register': (ctx, request) => platform.projects.registerWorkspace(ctx, request),
    'completion-policies/install': (ctx, request) => platform.completionPolicies.installCompletionPolicy(ctx, request),
    'completion-policies/activate': (ctx, request) => platform.completionPolicies.activateCompletionPolicy(ctx, request),
    'architecture/adopt-initial': (ctx, request) => platform.architecture.adoptInitialArchitecture(ctx, request),
    'goals/create': (ctx, request) => platform.goals.createGoal(ctx, request),
    'plans/propose': (ctx, request) => platform.plans.proposePlan(ctx, request),
    'plans/apply': (ctx, request) => platform.plans.applyPlanChange(ctx, request),
  };
  const ctx = s3Ctx(actor);
  const committed = async (suffix: string, body: ReturnType<typeof graphWrite>): Promise<Record<string, unknown>> => {
    const owner = owners[suffix];
    if (owner === undefined) throw new Error(`no owner for the seed route ${suffix}`);
    const result = await owner(ctx, body.request as never) as Record<string, unknown>;
    if (result['status'] !== 'committed') {
      throw new Error(`the §5.1 seed write ${suffix} did not commit: ${JSON.stringify(result)}`);
    }
    return result['value'] as Record<string, unknown>;
  };
  await committed('projects/create', graphWrite(SCOPE, { projectId: P }, 's3-project', [{ ref: PROJECT_REF, revision: 0 }]));
  await committed('workspaces/register', graphWrite(SCOPE, { workspace: SCOPE }, 's3-workspace',
    [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 0 }]));
  const installed = await committed('completion-policies/install', graphWrite(SCOPE, { policyId: 's3-policy', contentRevision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } },
  's3-policy-install', [{ ref: PROJECT_REF, revision: 1 }, { ref: POLICY_REF, revision: 0 }]));
  await committed('completion-policies/activate', graphWrite(SCOPE, {
    target: { ref: installed['ref'], digest: installed['contentDigest'] },
  }, 's3-policy-activate', [{ ref: PROJECT_REF, revision: 1 }, { ref: POLICY_ACTIVE_REF, revision: 0 }]));
  await committed('architecture/adopt-initial', graphWrite(SCOPE, {
    baselineId: 's3-baseline', description: 'S3 context and inputs fixture', constraints: [],
    catalog: { requireDag: true, dependencies: [], modules: [{ ref: { projectId: P, moduleId: 's3-work' },
      name: 'S3 work', responsibility: 'Implement B', paths: ['src'], interfaces: [] }] },
  }, 's3-architecture', [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 1 }]));
  await committed('goals/create', graphWrite(SCOPE, {
    goalId: G, workspace: SCOPE, objective: 'Ship platform',
  }, 's3-goal', [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 1 }]));
  const proposed = await committed('plans/propose', graphWrite(SCOPE, {
    goalRef: GOAL_REF, basedOn: null, draft: planDraft(oldRef), reason: { text: 'S3 initial plan', sources: [] },
  }, 's3-plan-propose', []));
  await committed('plans/apply', graphWrite(SCOPE, {
    proposalRef: proposed['ref'], expectedProposalRevision: proposed['revision'], decisionRefs: [],
  }, 's3-plan-apply', []));
}

async function openS3Host(options: { replies?: readonly ScriptedReply[]; queryReplies?: readonly ScriptedReply[] } = {}): Promise<S3Host> {
  const root = await tempDir('s3-context-ws-');
  const database = await tempDir('s3-context-db-');
  await writeAG2bWorkspace(root);
  const actor = SCENARIO_OPERATOR;
  const work = createScriptedModel(options.replies ?? []);
  const query = options.queryReplies === undefined ? null : createScriptedModel(options.queryReplies);
  const workflow: WorkflowHostConfiguration = { consumerId: AG2B_CONSUMER_ID,
    bindings: [{ workspace: SCOPE, sessionRole: AG2B_WORK_ROLE, roleBinding: AG2B_WORK_ROLE_BINDING,
      budget: { tokenBudget: 1_000_000, deadline: null } }] };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory: database },
    workspace: workspaceBindings(root, permissionRevision(actor, SCOPE, ['.'])),
    now: () => AT,
    kernelStores: { entries: [{ adapterId: 's3-kernel', storeKey: 's3-kernel-store', workspace: SCOPE,
      databasePath: join(database, 'kernel.sqlite') }] },
    runtime: s3Runtime(work, query),
    checks: s3Checks(actor, 'node -e "process.exit(0)"', 's3-checks@1'),
    workflow,
  });
  platform.registerAutomationPolicy({ schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false });
  openHosts.push({ platform });

  // The canonical owner Run `runA` completed, then the legacy `old-A` stored under it.
  seedCompletedRun(database, runASnapshot());
  const stored = await platform.materials.storeArtifact(runACtx(), {
    contentType: 'text/plain', body: LEGACY_BODY, sources: [{ kind: 'artifact', refId: 'old-A', revision: '1' }],
    origin: { kind: 'execution', ref: RUN_A },
  });
  if (stored.status !== 'stored') throw new Error(`the legacy body must be stored: ${JSON.stringify(stored)}`);
  await seedS3Graph(platform, actor, stored.ref);

  return {
    platform, database, work, query, actor,
    ctx: () => s3Ctx(actor),
    select: (flowId, taskId) => ({ schemaVersion: 1, goalRef: GOAL_REF, flowId, sessionHint: null, kind: 'select_work',
      ...(taskId === undefined ? {} : { taskId }) }),
    async advance(input, options = {}) {
      const stopBefore = options.stopBefore ?? (() => false);
      const receipts: WorkflowStepReceipt[] = [];
      let current = input;
      for (let step = 0; step < 64; step += 1) {
        if (stopBefore(current)) return { receipts, state: 'stopped', reason: null, next: current };
        const result = await platform.workflow.advanceWork(s3Ctx(actor), current);
        if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
        if (result.value.receipt !== null) receipts.push(result.value.receipt);
        if (result.value.state === 'completed' || result.value.next === null) {
          return { receipts, state: result.value.state, reason: result.value.reason, next: null };
        }
        current = result.value.next;
      }
      throw new Error('the Workflow did not settle within 64 steps');
    },
    modelRequests: () => [...work.requests],
  };
}

// ---------------------------------------------------------------------------

it('SC01: the real claim, prepare and start assemble the declared legacy input, and a repeated prepare keeps the original manifest', async () => {
  const replies: ScriptedReply[] = [
    { kind: 'calls', calls: [{ callId: 'sc01-find', name: 'find_graph', args: { needle: EDGE_LABEL } }] },
    { kind: 'calls', calls: [{ callId: 'sc01-look', name: 'look_graph', args: { mode: 'node', target: { kind: 'task', ref: TA, planRef: PLAN_REF } } }] },
    { kind: 'calls', calls: [{ callId: 'sc01-history', name: 'look_graph', args: { mode: 'history', runRef: RUN_A } }] },
    { kind: 'calls', calls: [{ callId: 'sc01-input', name: 'look_graph', args: { mode: 'input',
      consumer: WORK_TASK, planRef: PLAN_REF, declarationId: LEGACY_DECLARATION_ID } }] },
    { kind: 'text', text: 'SC01: the declared legacy input was read' },
  ];
  const h = await openS3Host({ replies });

  // Formal claim → prepare; the Run is authorized and its input binding is
  // fixed, but the Kernel has not started (stop before `start`).
  const first = await h.advance(h.select('sc01-1', WORK_TASK.taskId), { stopBefore: performs('start') });
  expect(first.state).toBe('stopped');
  expect(first.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining(['claim_task', 'prepare']));
  const prepared = preparedOf(first.next);

  // The same Run prepared again returns the original immutable manifest.
  const second = await h.advance(h.select('sc01-1b', WORK_TASK.taskId), { stopBefore: performs('start') });
  const repeated = preparedOf(second.next);
  expect(repeated.inputBinding).toEqual(prepared.inputBinding);
  if (second.next === null) throw new Error('the repeated prepare must leave a start to perform');

  // The real start reaches the scripted model, which asks the read-only graph
  // tools; stop before the registered round opens (no sandboxed check needed).
  const started = await h.advance(second.next, { stopBefore: performs('open_checks') });
  expect(started.state).toBe('stopped');
  expect(started.receipts.map(receipt => receipt.kind)).toContain('start');
  const runRef = await selectedRunOf(h);
  const record = await executionOf(h, runRef);
  // The recorded Run keeps the original input binding byte for byte.
  expect(record.run.inputBinding).toEqual(prepared.inputBinding);
  expect(record.run.inputBinding?.inputDigest).toBe(prepared.inputBinding.inputDigest);

  // The first input carries the assembled context: the required obligation and
  // its verification, and the declared legacy input read as missing.
  const manifest = manifestOf(h.database, prepared.inputBinding.manifestDigest);
  expect(manifest.contextAssembly).toBeDefined();
  expect(manifest.contextAssembly).toMatchObject({ formatVersion: 's3-context-v1', callKind: 'work', duty: 'executor' });
  expect(manifest.input).toContain('Deliver B');
  expect(manifest.input).toContain('node check-b.js');
  expect(manifest.contextAssembly?.inputSelections).toEqual(expect.arrayContaining([
    expect.objectContaining({ declaration: expect.objectContaining({ requires: { kind: 'artifact', label: EDGE_LABEL } }),
      state: 'missing' }),
  ]));

  const requests = h.modelRequests();
  const firstRequest = requests[0];
  expect(firstRequest).toBeDefined();
  expect(JSON.stringify(firstRequest?.messages)).toContain('## Goal');
  // The declared legacy artifact `old-A` reaches the model only through the
  // graph tool result, whose source keeps the exact content digest H('old-A').
  const inputCall = requests.find(request => toolOutputJson(request, 'sc01-input') !== undefined);
  expect(toolOutputJson(inputCall, 'sc01-input')).toMatchObject({ status: 'ready',
    value: { selection: { source: { kind: 'artifact', ref: { digest: H(LEGACY_BODY) } } } } });

  // The read-only find/look/history calls created no second Session; and the
  // completed upstream Run `runA` never made `tB` satisfied.
  expect(await sessionCount(h)).toBe(1);
  expect((await taskRowOf(h, WORK_TASK.taskId)).effectivePhase).not.toBe('satisfied');
}, 120_000);

async function selectedRunOf(h: S3Host): Promise<RunRef> {
  const row = await taskRowOf(h, WORK_TASK.taskId);
  if (row.execution === null) throw new Error(`the Task ${WORK_TASK.taskId} must select a Run`);
  return row.execution;
}

async function taskRowOf(h: S3Host, taskId: string): Promise<{ effectivePhase: string; execution: RunRef | null }> {
  const read = await h.platform.plans.queryTaskGraph(h.ctx(), { goalRef: GOAL_REF });
  if (read.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(read)}`);
  const row = read.value.tasks.find(candidate => candidate.ref.taskId === taskId);
  if (row === undefined) throw new Error(`the Task ${taskId} must be in the graph`);
  return row;
}

async function executionOf(h: S3Host, runRef: RunRef): Promise<{ run: { inputBinding?: { inputDigest: string } } }> {
  const read = await h.platform.executions.readExecution(h.ctx(), runRef);
  if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
  return read.value as unknown as { run: { inputBinding?: { inputDigest: string } } };
}

async function sessionCount(h: S3Host): Promise<number> {
  const read = await h.platform.sessions.findSessions(h.ctx(), { workspace: SCOPE, includeArchived: true, page: { limit: 50 } });
  if (read.status !== 'ready') throw new Error(`the Session directory must be readable: ${JSON.stringify(read)}`);
  return read.value.items.length;
}
