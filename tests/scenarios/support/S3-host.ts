/**
 * The §5.1 composition root shared by the S3 scenario files.
 *
 * The AG2b harness Host has a fixed scope, a fixed plan and a fixed grant
 * without `look_graph`/`find_graph` (lead decision 3, `tests/scenarios/harness.ts`
 * stays unchanged), so SC01/SC02 build their OWN composition root with the same
 * exported building blocks and the same pattern the harness's platform mode
 * uses: one SQLite ledger + Kernel store, the real owners, a scripted provider,
 * and the real `claim_task` / `prepare` / `start` performed through the
 * Workflow (`platform.workflow.advanceWork`).
 *
 * `openS3Host` seeds the §5.1 graph through the real owners, runs the real `tA`
 * Run to completion (stopping before `open_checks`), and stores the legacy body
 * `old-A` under that real RunRef. The caller owns the returned Host and closes
 * it in `finally`.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTargetPlatform } from '../../../src/composition/create-platform.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../../src/business/workflow/ports.js';
import type { ArtifactRef } from '../../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../../src/contracts/core/call-context.js';
import type { RunRef } from '../../../src/contracts/dispatch.js';
import { sha256Hex } from '../../../src/contracts/fingerprint.js';
import type { GoalRef } from '../../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../../src/contracts/plan.js';
import type { TrustedCheckConfiguration } from '../../../src/contracts/verification.js';
import type { RuntimeHostBindings } from '../../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../../src/core/workspace/access.js';
import type { WorkbenchActor } from '../../../src/app/core-http-types.js';
import type { ModelRequest } from '../../../vendor/coding-agent/dist/public-api.js';
import { createScriptedModel, type ScriptedModel, type ScriptedReply } from '../../helpers/B2-runtime-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_INSTRUCTION, AG2B_RUNTIME_BUDGET, AG2B_WORK_INSTRUCTION, AG2B_WORK_ROLE,
  AG2B_WORK_ROLE_BINDING, graphWrite, permissionRevision, writeAG2bWorkspace,
} from '../../helpers/AG2b-collaboration-fixture.js';
import { tempDir } from '../../helpers/A2-restart-fixture.js';
import type { Platform } from '../harness.js';
import { performs, SCENARIO_OPERATOR } from '../harness.js';

// ---------------------------------------------------------------------------
// §5.1 identities
// ---------------------------------------------------------------------------

const AT = '2026-10-09T00:00:00.000Z';
export const P = 'p';
const W = 'w';
export const G = 'g';
const PLAN = 'p1';
export const SCOPE = { projectId: P, workspaceId: W };
const PROJECT_REF = { aggregateType: 'Project' as const, projectId: P };
const WORKSPACE_REF = { aggregateType: 'Workspace' as const, projectId: P, workspaceId: W };
export const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: P, goalId: G };
export const PLAN_REF: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: PLAN };
const POLICY_REF = { aggregateType: 'CompletionPolicyRevision' as const, projectId: P, policyId: 's3-policy', revision: 1 };
const POLICY_ACTIVE_REF = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: P };
export const WORK_TASK = { projectId: P, goalId: G, taskId: 'tB' };
export const TA = { projectId: P, goalId: G, taskId: 'tA' };
export const LEGACY_BODY = 'old-A';
export const EDGE_LABEL = 'A.out';
const SKILLS_ROOT = fileURLToPath(new URL('../../../vendor/coding-agent/resources/skills', import.meta.url));
const WORK_TOOLS = ['read', 'write', 'send_session_message', 'look_graph', 'find_graph'] as const;
const QUERY_TOOLS = ['read', 'project_source', 'look_graph', 'find_graph'] as const;

// ---------------------------------------------------------------------------
// The self-contained composition root (§5.1 fixture)
// ---------------------------------------------------------------------------

export type S3Host = {
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
  /** The real completed `tA` Run the legacy `old-A` body is stored under. */
  runA: RunRef;
  /** Release the SQLite ledger, Kernel store and workspace for this Host. */
  close(): Promise<void>;
};

export function workspaceBindings(root: string, grant: string): WorkspaceHostBindings {
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

export function s3Checks(actor: WorkbenchActor, command: string, revision: string): TrustedCheckConfiguration {
  return {
    configurationRevision: revision, workspace: WORKSPACE_REF, executor: actor,
    permissionRevision: permissionRevision(actor, SCOPE, ['.']),
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 'vB', kind: 'static', command, cwd: '.', timeoutMs: 30_000, taskIds: 'all' }],
  };
}

/** The custom Host binding: the §5.1 grants with `look_graph`/`find_graph` in Work and Query. */
export function s3Runtime(work: ScriptedModel, query: ScriptedModel | null): RuntimeHostBindings {
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
      async resolveQueryConfiguration(context: CoreCallContext) {
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

export function s3Ctx(actor: WorkbenchActor): CoreCallContext {
  return { ...SCOPE, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', ...SCOPE, actor }, signal: new AbortController().signal };
}

function runACtx(runRef: RunRef): CoreCallContext {
  return { ...SCOPE, principal: { kind: 'work_run', runRef, roleBinding: AG2B_WORK_ROLE_BINDING },
    materialReader: { kind: 'run', requester: runRef }, signal: new AbortController().signal };
}

/**
 * The exact content address the body store will mint for `old-A`, computed by
 * hand: SHA-256 of the 5 UTF-8 bytes `old-A` is
 * dd7a346236273d4fd019c7bf806b00a7eea9d992583b6aed9ed2231cf345f4b7.
 * Plan validation never checks availability, so the single revision can name
 * `old-A` before the real `tA` Run stores the body.
 */
function legacyArtifactRef(): ArtifactRef {
  return { kind: 'artifact', contentType: 'text/plain',
    digest: 'dd7a346236273d4fd019c7bf806b00a7eea9d992583b6aed9ed2231cf345f4b7', sizeBytes: 5,
    source: { kind: 'artifact', refId: 'old-A', revision: '1' } };
}

export function planDraft(oldRef: ArtifactRef): PlanRevisionDraft {
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
export async function seedS3Graph(platform: Platform, actor: WorkbenchActor, oldRef: ArtifactRef): Promise<void> {
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

async function taskRowOf(h: S3Host, taskId: string): Promise<{ effectivePhase: string; execution: RunRef | null }> {
  const read = await h.platform.plans.queryTaskGraph(h.ctx(), { goalRef: GOAL_REF });
  if (read.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(read)}`);
  const row = read.value.tasks.find(candidate => candidate.ref.taskId === taskId);
  if (row === undefined) throw new Error(`the Task ${taskId} must be in the graph`);
  return row;
}

/**
 * Open a Host, seed the §5.1 graph, run the real `tA` Run to completion without
 * opening checks, and store the legacy `old-A` body under its real RunRef.
 * `prefix` names the two temporary directories so scenarios stay distinguishable.
 */
export async function openS3Host(
  prefix: string,
  options: { replies?: readonly ScriptedReply[]; queryReplies?: readonly ScriptedReply[] } = {},
): Promise<S3Host> {
  const root = await tempDir(`${prefix}-ws-`);
  const database = await tempDir(`${prefix}-db-`);
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
  const close = async (): Promise<void> => { await platform.close().catch(() => undefined); };
  try {
    platform.registerAutomationPolicy({ schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'off' });

    const host: S3Host = {
      platform, database, work, query, actor,
      runA: { aggregateType: 'Run', projectId: P, goalId: G, runId: 'unresolved-tA-run' },
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
      close,
    };

    // One Plan revision names `old-A` by its content address before it exists.
    await seedS3Graph(platform, actor, legacyArtifactRef());

    // Run the real `tA` to its end; the Workflow stops before opening checks, so
    // the owner Run is completed without a reducing round.
    const ta = await host.advance(host.select('s3-ta-run', TA.taskId), { stopBefore: performs('open_checks') });
    if (ta.state !== 'stopped') throw new Error(`tA must stop before its checks: ${JSON.stringify(ta)}`);
    const taRow = await taskRowOf(host, TA.taskId);
    if (taRow.execution === null) throw new Error('the completed tA Run must be selected');
    const runA = taRow.execution;

    // The real owner Run stores the legacy body under its own RunRef.
    const stored = await platform.materials.storeArtifact(runACtx(runA), {
      contentType: 'text/plain', body: LEGACY_BODY, sources: [{ kind: 'artifact', refId: 'old-A', revision: '1' }],
      origin: { kind: 'execution', ref: runA },
    });
    if (stored.status !== 'stored') throw new Error(`the legacy body must be stored: ${JSON.stringify(stored)}`);
    if (stored.ref.digest !== legacyArtifactRef().digest) throw new Error('the stored body must keep the declared content address');
    return { ...host, runA };
  } catch (error) {
    await close();
    throw error;
  }
}
