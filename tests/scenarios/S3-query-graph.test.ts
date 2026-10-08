/**
 * Slice 3 §5.11, case SC02 (one run on SQLite, scripted provider only).
 *
 * The AG2b harness Host has a fixed scope, a fixed plan and a fixed grant
 * without `look_graph`/`find_graph` (lead decision 3, `tests/scenarios/harness.ts`
 * stays unchanged), so this scenario builds its OWN composition root INSIDE the
 * test file with the same exported building blocks and the same pattern the
 * harness's platform mode uses: one SQLite ledger + Kernel store, the real
 * owners, a scripted provider, and the real `claim_task` / `prepare` / `start`
 * performed through the Workflow (`platform.workflow.advanceWork`).
 *
 * It seeds the §5.1 graph (scope `p/w`, Goal `g`, Plan `p1`, stage `Main`,
 * tA/tB, obligation `oB` with verification `vB`, the edge `tB -> tA: artifact
 * A.out`, the legacy declaration `old-A` under the canonical owner Run `runA`
 * completed) and grants `look_graph`/`find_graph` in the Work AND Query
 * bindings.
 *
 * A work Run asks the old main conversation ("进度如何") and waits; the derived
 * read-only Query answers through the scripted query provider, which first asks
 * for the read-only graph tools (`find_graph`, `look_graph` node, `look_graph`
 * history) and then answers. The Answer is saved as the message response body.
 * The second half of the row reads the saved body, checks the tool results carry
 * `tB`'s status/obligations and the history versions, proves graph expansion and
 * history paging add 0 model requests, and drives the Host attention loop over
 * a large graph change (one notification <= 16384 bytes, consumed once, a second
 * scan sends 0).
 *
 * Part 1 has stubs (`createGraphTools` is unwired, `renderAttentionChanges` is a
 * stub), so this scenario is RED by design; the failure must be an assertion or
 * `not implemented: ...`, never a fixture/setup error.
 */
import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAttentionObserver, createAttentionScanner, type AttentionSnapshot } from '../../src/app/attention-observer.js';
import { renderAttentionChanges } from '../../src/core/agent-runtime/context-assembler.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { AttentionChangesV1, GraphAttentionDetailV1 } from '../../src/contracts/graph-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { TaskExecutionHistoryRequest } from '../../src/core/agent-runtime/execution-history-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { WorkbenchActor } from '../../src/app/core-http-types.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { createScriptedModel, type ScriptedModel, type ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_QUERY_INSTRUCTION, AG2B_QUERY_ROLE, AG2B_QUERY_ROLE_BINDING,
  AG2B_RUNTIME_BUDGET, AG2B_WORK_INSTRUCTION, AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, graphWrite, permissionRevision,
  writeAG2bWorkspace,
} from '../helpers/AG2b-collaboration-fixture.js';
import { tempDir } from '../helpers/A2-restart-fixture.js';
import { attentionConfig } from '../helpers/orchestration-fixture.js';
import type { Platform } from './harness.js';
import { cleanupScenarios, SCENARIO_OPERATOR } from './harness.js';
import { toolOutputJson } from './support/common.js';

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
const EDGE_LABEL = 'A.out';
const QUESTION = '进度如何';
const ANSWER = 'SC02: the graph facts say the work is on track';
const SKILLS_ROOT = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
const WORK_TOOLS = ['read', 'write', 'send_session_message', 'look_graph', 'find_graph'] as const;
const QUERY_TOOLS = ['read', 'project_source', 'look_graph', 'find_graph'] as const;
const B = (value: string): number => Buffer.byteLength(value, 'utf8');

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
  const root = await tempDir('s3-query-ws-');
  const database = await tempDir('s3-query-db-');
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
// Host attention loop over the real scanner/observer (§4.5)
// ---------------------------------------------------------------------------

function taskRef(taskId: string): import('../../src/contracts/graph-context.js').GraphNodeRefV1 {
  return { kind: 'task', ref: { projectId: P, goalId: G, taskId }, planRef: PLAN_REF };
}

function attentionDetail(key: string, state: string, version: string, digest: string): GraphAttentionDetailV1 {
  return { node: taskRef(key.replace(/^task:/, '')), name: key, summary: key, state, version,
    contentDigest: digest, sources: [] };
}

/** The large graph change: the baseline plus 2000 added task nodes. */
function largeChange(baseline: AttentionSnapshot): AttentionSnapshot {
  const graph = baseline.graph ?? { nodes: [], edges: [], statuses: {} };
  const added = Array.from({ length: 2_000 }, (_v, index) => `task:n${String(index).padStart(4, '0')}`);
  const statuses: Record<string, string> = { ...graph.statuses };
  const details: Record<string, GraphAttentionDetailV1> = { ...(graph.details ?? {}) };
  for (const key of added) {
    statuses[key] = 'ready';
    details[key] = attentionDetail(key, 'ready', 'v1', 'd1');
  }
  return { ...baseline, graph: { ...graph, nodes: [...graph.nodes, ...added], statuses, details } };
}

/** The Host renders the change DTO the observer attached to its `graph_delta` signal. */
function attentionChanges(delivery: import('../../src/app/attention-observer.js').AttentionDelivery | null): AttentionChangesV1 {
  const signal = delivery?.signals.find(candidate => candidate.kind === 'graph_delta');
  const graph = signal?.kind === 'graph_delta' ? signal.changes : undefined;
  return { scope: SCOPE, goalRef: GOAL_REF, nodes: graph?.nodes ?? [], edges: graph?.edges ?? [],
    revision: graph?.revision ?? null, files: [], heartbeat: null, feedbackIds: [] };
}

// ---------------------------------------------------------------------------

it('SC02: the old main-conversation Query answers through the read-only graph tools and the Answer is saved', async () => {
  const send = { callId: 'sc02-send', name: 'send_session_message',
    args: { recipient: {}, text: QUESTION, replyMode: 'wait' } as Record<string, unknown> };
  const queryReplies: ScriptedReply[] = [
    { kind: 'calls', calls: [{ callId: 'sc02-find', name: 'find_graph', args: { needle: WORK_TASK.taskId } }] },
    { kind: 'calls', calls: [{ callId: 'sc02-look', name: 'look_graph', args: { mode: 'node', target: { kind: 'task', ref: WORK_TASK, planRef: PLAN_REF } } }] },
    { kind: 'calls', calls: [{ callId: 'sc02-history', name: 'look_graph', args: { mode: 'history', runRef: RUN_A } }] },
    { kind: 'text', text: ANSWER },
  ];
  const h = await openS3Host({ replies: [{ kind: 'calls', calls: [send] }, { kind: 'text', text: 'SC02: the reply was read' }],
    queryReplies });

  // The read-only participant Session the work Run asks.
  const created = await h.platform.runtime.createSession(h.ctx(), {
    workspace: SCOPE, role: AG2B_QUERY_ROLE, recommendedRefs: [],
    initialLinks: [{ target: { kind: 'task', ref: WORK_TASK }, relation: 'participates' }],
    meta: { requestId: 'sc02-recipient', expected: [] },
  });
  if (created.status !== 'completed') throw new Error(`the recipient Session was not created: ${JSON.stringify(created)}`);
  const recipient: SessionRef = { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };
  send.args['recipient'] = { projectId: recipient.projectId, sessionId: recipient.sessionId };

  // The work Run asks and yields with a durable continuation (P5).
  const waiting = await h.advance(h.select('sc02-1', WORK_TASK.taskId));
  expect(waiting.state).toBe('waiting');
  const yielded = await executionOf(h, await selectedRunOf(h));
  const messageRef = yielded.run.continuation?.messageRef;
  expect(messageRef).toBeDefined();
  if (messageRef === undefined) return;

  // The derived read-only Query answers; its Answer is saved as a real
  // content-addressed response body, not a transient string.
  const answered = await h.platform.workflow.consumeConsultation(h.ctx(), {
    schemaVersion: 1, messageRef, goalRef: GOAL_REF, roleBinding: AG2B_QUERY_ROLE_BINDING,
    runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
  });
  expect(answered).toMatchObject({ status: 'ready', value: { state: 'responded' } });
  const messageRead = await h.platform.messages.readMessage(h.ctx(), messageRef);
  expect(messageRead).toMatchObject({ status: 'ready',
    value: { status: 'responded', response: { bodyRef: { kind: 'artifact', digest: expect.any(String) } } } });
  // Read the saved Answer body and compare its exact text.
  const answerBody = await h.platform.messages.readMessageBody(h.ctx(), { messageRef, part: 'response' });
  expect(answerBody).toMatchObject({ status: 'ready', value: { part: 'response', text: ANSWER } });

  // The Query provider really asked for the graph tools; their results report
  // the Task status/obligations and the history version (not a workspace write).
  const queryRequests = h.query?.requests ?? [];
  expect(queryRequests.length).toBeGreaterThan(0);
  const nodeResult = queryRequests.map(request => toolOutputJson(request, 'sc02-look')).find(value => value !== undefined);
  expect(nodeResult).toMatchObject({ status: 'ready' });
  expect(JSON.stringify(nodeResult)).toContain(WORK_TASK.taskId);
  expect(JSON.stringify(nodeResult)).toContain('oB');
  expect(JSON.stringify(nodeResult)).toContain('vB');
  const historyResult = queryRequests.map(request => toolOutputJson(request, 'sc02-history')).find(value => value !== undefined);
  expect(historyResult).toBeDefined();
  expect(JSON.stringify(historyResult)).toContain(RUN_A.runId);
  // A Query never receives a workspace-write tool.
  const toolNames = queryRequests.flatMap(request => request.tools.map(tool => tool.name));
  expect(toolNames).not.toContain('write');
  expect(toolNames).not.toContain('edit');

  // Graph expansion and history paging add 0 model requests.
  const queryCallsBefore = h.query?.calls() ?? 0;
  const workCallsBefore = h.work.calls();
  const graphRead = await h.platform.plans.queryTaskGraph(h.ctx(), { goalRef: GOAL_REF });
  expect(graphRead.status).toBe('ready');
  const pageRequest: TaskExecutionHistoryRequest = { runRef: await selectedRunOf(h), afterCursor: null, limit: 20 };
  await h.platform.runtime.readTaskExecutionHistory(h.ctx(), pageRequest);
  expect(h.query?.calls() ?? 0).toBe(queryCallsBefore);
  expect(h.work.calls()).toBe(workCallsBefore);

  // After a large graph change the Host sends one notification of at most
  // 16384 bytes, it is consumed once, and a second scan sends 0.
  const scanner = createAttentionScanner({ workspace: h.platform.workspace, plans: h.platform.plans,
    architecture: h.platform.architecture, messages: h.platform.messages });
  const scope = { scope: SCOPE, paths: [], maxBytes: 1024, goalRef: GOAL_REF, targetSession: null,
    config: attentionConfig({ graph: { minChangedElements: 1, minRatio: 0 } }) };
  const baseline = await scanner.scan(h.ctx(), scope);
  const observer = createAttentionObserver(attentionConfig({ graph: { minChangedElements: 1, minRatio: 0 } }));
  observer.prime(baseline);
  const after = largeChange(baseline);
  const delivery = observer.observe(after, 1_000);
  expect(delivery?.signals.some(signal => signal.kind === 'graph_delta')).toBe(true);
  const sends: string[] = [];
  const text = renderAttentionChanges(attentionChanges(delivery));
  expect(B(text)).toBeLessThanOrEqual(16_384);
  sends.push(text);
  observer.markDelivered(after, delivery?.signals);
  observer.markProcessed(after, delivery?.signals);
  expect(sends).toHaveLength(1);
  expect(observer.observe(after, 2_000)).toBeNull();
  expect(sends).toHaveLength(1);
}, 120_000);

// ---------------------------------------------------------------------------
// Platform readers
// ---------------------------------------------------------------------------

async function selectedRunOf(h: S3Host): Promise<RunRef> {
  const read = await h.platform.plans.queryTaskGraph(h.ctx(), { goalRef: GOAL_REF });
  if (read.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(read)}`);
  const row = read.value.tasks.find(candidate => candidate.ref.taskId === WORK_TASK.taskId);
  if (row === undefined || row.execution === null) throw new Error(`the Task ${WORK_TASK.taskId} must select a Run`);
  return row.execution;
}

async function executionOf(h: S3Host, runRef: RunRef): Promise<{ run: { inputBinding?: unknown; continuation?: { messageRef: import('../../src/contracts/core/session-message.js').SessionMessageRef } } }> {
  const read = await h.platform.executions.readExecution(h.ctx(), runRef);
  if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
  return read.value as unknown as { run: { continuation?: { messageRef: import('../../src/contracts/core/session-message.js').SessionMessageRef } } };
}
