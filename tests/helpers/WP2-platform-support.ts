/**
 * Wiring package 2, group D support: a REAL `createTargetPlatform` composition
 * root over a real SQLite ledger, with exact pinned `role_spec` Sessions (a
 * chosen platform duty), a scripted Kernel model and claimed (not yet entered)
 * Work Runs. It reuses the delivered Goal/Plan/Session/claim fixture and the
 * delivered role install/activate writers; only the coordination matrix seed and
 * the trusted Host bindings are fixture data.
 *
 * It never fabricates a claim, a Run terminal, a model call or an HTTP route.
 * The caller drives the formal Runtime and platform ports.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { expect, vi } from 'vitest';
import { join } from 'node:path';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RoleBindingRefV1, RunRef } from '../../src/contracts/dispatch.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type {
  RuntimeHostBindings, RuntimeExecutionDependencies,
} from '../../src/core/agent-runtime/execution-contracts.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import type { RecordCommitNotice } from '../../src/composition/commit-observer.js';
import * as sqliteBackend from '../../src/core/record-store/sqlite-record-store.js';
import * as memoryBackend from '../../src/core/record-store/in-memory-record-store.js';
import * as goalSettingsSource from '../../src/core/work-graph/tasks/goal-settings-service.js';
import * as decisionReadSource from '../../src/core/work-graph/views/decision-read-model.js';
import type { PreparedTaskExecution } from '../../src/contracts/core/prepared-execution.js';
import { roleSpecContentDigest, type RoleSpecContentV1 } from '../../src/contracts/role-spec.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import { coordinationPolicyContentDigest, type CoordinationPolicyContentV1 } from '../../src/contracts/human-role-collaboration.js';
import { SESSION_MAILBOX_TOOL_NAMES, USER_DECISION_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { WHITEBOARD_TOOL_NAMES } from '../../src/core/agent-runtime/whiteboard-tools.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import {
  createTaskClaimFixture, type TaskClaimFixture,
} from './task-claim-fixture.js';
import { B2_AT, createScriptedModel, type ScriptedModel, type ScriptedReply } from './B2-runtime-fixture.js';
import { C2_SKILL_ROOT, C2_SAFETY_PATH, C2_SKILL_IDS } from './C2-runtime-platform-fixture.js';

const WP2_ALL_TOOL_NAMES: readonly string[] = [
  ...SESSION_MAILBOX_TOOL_NAMES, ...USER_DECISION_TOOL_NAMES, ...WHITEBOARD_TOOL_NAMES,
];

type WP2PlatformOptions = {
  kind?: 'memory' | 'sqlite';
  /** The Session's fixed platform duty (spec L1). */
  duty?: PlatformDutyV1;
  /** The model-visible Host/role tool grant. Defaults to the full platform set. */
  tools?: readonly string[];
  scriptedReplies?: readonly ScriptedReply[];
  beforeReply?: (request: import('../../vendor/coding-agent/dist/public-api.js').ModelRequest,
    index: number, signal: AbortSignal) => Promise<void>;
  /** Whole-workspace Work grant; true overrides writeScope, without adding tools. */
  writable?: boolean;
  writeScope?: string[];
  systemInstruction?: string | null;
  skillIds?: string[];
  /** The Host source-read policy; false returns a real `forbidden`. */
  allowSourceRead?: boolean;
  /** The Session provenance kind; `readonly_copy` drives L2's readOnlyCopy. */
  provenanceKind?: 'readonly_copy' | 'standard';
  /** Skip the first claim (F03 proves the real admission refuses it instead). */
  skipClaim?: boolean;
  /**
   * F11: the composition always generates Run ids with `randomUUID`, so a
   * message pair sent by the memory world's Run sorts by a random digest. When
   * set, the memory seed worlds are claimed through the fixture's deterministic
   * id source (the same real claim owner, over the composition's own records /
   * role service) so a message-id order can be pinned as a literal on both
   * backends. Never used to fabricate a claim result.
   */
  deterministicClaimIds?: boolean;
  /** Build a second independent Goal/Plan/Session/claim (E3 reply world). */
  secondWorld?: boolean;
  /** Build a Goal whose required work Task is DEFERRED through the real Plan
   * writers, so its Goal display carries `required_task_deferred` and the
   * goal-decision reader prepares a real Task-linked `goal_cause` card (F07). */
  deferredGoal?: boolean;
  /** The trusted Workflow selection configuration (E0 automatic advancement). */
  workflow?: WorkflowHostConfiguration;
  /** Bind the trusted Workflow selection to this Session's pinned role (E0). */
  workflowBound?: boolean;
  /** Accept every Run in the bound scope (the Workflow claims it after construction). */
  allowAnyRun?: boolean;
  /** This Host holds the instance lease (health observation / reconciliation). */
  ownedHost?: boolean;
  /** The Host's resident context budget in bytes (E2 budget rows; default 4096). */
  contextResidentBytes?: number;
  /** Register a passing static check so the Workflow can advance past `open_checks`. */
  check?: boolean;
  /**
   * The requirement kind the memory world's governance and plan use, so the
   * registered `check` covers it. The memory world supports `static` (matching
   * `wp2-static`); the SQLite world seeds its Plan through `task-claim-fixture`,
   * which fixes `test`, and refuses `static`. Default `test` (unchanged).
   */
  checkRequirementKind?: 'test' | 'static';
  /** Scripted replies for the read-only Query Host binding (E3 F14 Query Answer). */
  queryReplies?: readonly ScriptedReply[];
  /** Before each Query model stream; a real gate for an in-flight QueryRun. */
  beforeQueryReply?: (request: import('../../vendor/coding-agent/dist/public-api.js').ModelRequest,
    index: number, signal: AbortSignal) => Promise<void>;
  /** The Query Host's system instruction (defaults to a read-only consultation). */
  queryInstruction?: string | null;
  /** The Query Host's tool grant (defaults to `read`). */
  queryTools?: readonly string[];
  /** F08 fault injection: the installed Goal-settings extension source throws on read. */
  failGoalSettingsRead?: boolean;
  /** F08 fault injection: the installed decision-queue extension source throws on read. */
  failDecisionsRead?: boolean;
  /**
   * OPT-IN advancing clock (default fixed at `B2_AT`, so no existing test
   * changes): each `now()` call returns the previous timestamp + 1 s. A test
   * that needs a real write to happen strictly after an earlier one (e.g. a
   * requeue trigger after the understanding it makes due) turns this on.
   */
  advancingClock?: boolean;
  /**
   * Observe the real commit log live. C-03 uses it to abort a `runtime.startRun`
   * right after the Run entry-authorization commit (W-02), leaving the Run
   * `starting` with a persisted `inputBinding` so a later prepare replays it.
   */
  onCommit?: (notice: RecordCommitNotice) => void;
};

export type WP2PlatformFixture = {
  fixture: TaskClaimFixture;
  /** The live composition root; replaced by `reopen()`. */
  platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  scripted: ScriptedModel;
  /** The read-only Query Host's scripted model (E3 F14 Query Answer). */
  queryScripted: ScriptedModel;
  host: RuntimeHostBindings;
  ctx: CoreCallContext;
  scope: TaskClaimFixture['scope'];
  goalRef: GoalRef;
  /** The exact claim request the first Run would use (F03 calls it itself). */
  claimRequest: Awaited<ReturnType<TaskClaimFixture['buildRequest']>>;
  claim: TaskClaim | null;
  runRef: RunRef | null;
  sessionRef: SessionRef;
  /** The second independent world (only with `secondWorld`). */
  secondGoalRef: GoalRef | null;
  secondPlanRef: PlanRevisionRef | null;
  secondTaskId: string;
  secondSessionRef: SessionRef | null;
  secondClaim: TaskClaim | null;
  secondRunRef: RunRef | null;
  /** The deferred-required-work Goal (only with `deferredGoal`). */
  deferredGoalRef: GoalRef | null;
  /** The primary world's Role binding (role_spec on sqlite, legacy on memory). */
  roleBinding: RoleBindingRefV1;
  /** The formal `work_run` caller context for a Run (default the first). */
  workCtx(runRef?: RunRef): CoreCallContext;
  /** The formal `work_run` caller context for the second world's Run. */
  secondWorkCtx(): CoreCallContext;
  directory: string;
  /** Fail the NEXT backend write once (real beforeWrite fault injection). */
  failNextWrite(): void;
  /** How many backend writes were attempted through the fault seam. */
  beforeWrites(): number;
  /** The real commit log: one notice per non-replayed RecordStore commit of THIS
   * fixture's composition instance(s), in commit order. The `cursor` is the
   * committed ledger cursor and `aggregates` the coarse record types; this is the
   * spec's independent source for a health/reply commit position (not a readback
   * of the record under test). */
  commits(): readonly RecordCommitNotice[];
  /** The approved full-commit observation seam (the same one the scenario
   * harness uses): every non-replayed prepared commit of this fixture's
   * composition instance(s), with its cursor and encoded events. This is an
   * independent source for an original request id / reply body ref. */
  preparedCommits(): readonly WP2ObservedCommit[];
  /** Close the composition root and reopen it on the same SQLite files. */
  reopen(): Promise<void>;
  close(): Promise<void>;
};

/** One observed prepared commit: the receipt cursor plus the encoded events. */
type WP2ObservedCommit = { cursor: string; events: readonly { eventType: string; json: string }[] };

/** Model-request text of the most recent scripted call. */
export function requestText(model: ScriptedModel): string {
  const last = model.lastRequest();
  if (last === undefined) throw new Error('the scripted model made no call');
  return last.messages.map(message => message.role === 'user' ? String(message.content) : '').join('\n');
}

type Wp2Platform = Awaited<ReturnType<typeof createTargetPlatform>>;

function mustCommit<T>(result: { status: string }): T {
  if (result.status !== 'committed') throw new Error(`WP2 memory seed write did not commit: ${JSON.stringify(result)}`);
  return (result as unknown as { value: T }).value;
}
function mustComplete<T>(result: { status: string }): T {
  if (result.status !== 'completed') throw new Error(`WP2 memory seed operation did not complete: ${JSON.stringify(result)}`);
  return (result as unknown as { value: T }).value;
}
/** The platform clock: fixed at `B2_AT` unless the caller opts into an advancing clock. */
function platformClock(options: WP2PlatformOptions): () => string {
  if (options.advancingClock !== true) return () => B2_AT;
  let ticks = 0;
  return () => new Date(Date.parse(B2_AT) + (++ticks) * 1000).toISOString();
}

/**
 * Spec §5.2 line 308/§8.5: one tested preparation or read stage makes no new
 * production commit and calls neither scripted model. The composition's own
 * `commitObserver` log and both model counters are the independent observation.
 */
export async function observeStage<T>(f: WP2PlatformFixture, action: () => Promise<T>): Promise<T> {
  const commitsBefore = f.commits().length;
  const scriptedBefore = f.scripted.calls();
  const queryBefore = f.queryScripted.calls();
  const value = await action();
  expect(f.commits().length).toBe(commitsBefore);
  expect(f.scripted.calls()).toBe(scriptedBefore);
  expect(f.queryScripted.calls()).toBe(queryBefore);
  return value;
}

/** F08: one installed upstream extension source throws on its read method; the
 * rest of the port is the real one. Only the failing boundary is replaced. */
function withThrowingMethod<T extends object>(port: T, method: string, message: string): T {
  return { ...(port as object), [method]: () => { throw new Error(message); } } as T;
}

/**
 * F08/E2 fault injection at the installed settings/decisions boundary. The
 * spies wrap the same production factories `createTargetPlatform` calls, exactly
 * like `withBackendFault` wraps the record-backend factories; nothing else is
 * replaced.
 */
async function withSourceFault<T>(options: WP2PlatformOptions, action: () => Promise<T>): Promise<T> {
  const spies: Array<{ mockRestore: () => void }> = [];
  if (options.failGoalSettingsRead === true) {
    const original = goalSettingsSource.createGoalSettingsService;
    spies.push(vi.spyOn(goalSettingsSource, 'createGoalSettingsService').mockImplementation(
      (deps: Parameters<typeof original>[0]) =>
        withThrowingMethod(original(deps), 'readGoalSettings', 'WP2 injected Goal settings read failure')));
  }
  if (options.failDecisionsRead === true) {
    const original = decisionReadSource.createDecisionReadModel;
    spies.push(vi.spyOn(decisionReadSource, 'createDecisionReadModel').mockImplementation(
      (...args: Parameters<typeof original>) =>
        withThrowingMethod(original(...args), 'queryDecisionQueue', 'WP2 injected decision queue read failure')));
  }
  try { return await action(); } finally { for (const spy of spies) spy.mockRestore(); }
}

/** The shared scope/governance seed through the composition's own owner ports. */
async function seedMemoryFoundation(platform: Wp2Platform, ctx: CoreCallContext,
  scope: TaskClaimFixture['scope'], projectRef: TaskClaimFixture['projectRef'],
  workspaceRef: TaskClaimFixture['workspaceRef'], prefix: string,
  requirementKind: 'test' | 'static'): Promise<void> {
  const projectId = scope.projectId;
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: `${prefix}-policy`, revision: 1 };
  const policyActiveRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
  mustCommit(await platform.projects.createProject(ctx, { input: { projectId },
    meta: { requestId: `${prefix}-project`, expected: [{ ref: projectRef, revision: 0 }] } }));
  mustCommit(await platform.projects.registerWorkspace(ctx, { input: { workspace: scope },
    meta: { requestId: `${prefix}-workspace`, expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] } }));
  const installed = mustCommit<{ ref: unknown; contentDigest: string }>(await platform.completionPolicies.installCompletionPolicy(ctx, {
    input: { policyId: `${prefix}-policy`, contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: [requirementKind], minimumRequiredRequirementsPerObligation: 1 } },
    meta: { requestId: `${prefix}-policy`, expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] } }));
  mustCommit(await platform.completionPolicies.activateCompletionPolicy(ctx, {
    input: { target: { ref: installed.ref as never, digest: installed.contentDigest } },
    meta: { requestId: `${prefix}-policy-active`, expected: [{ ref: projectRef, revision: 1 }, { ref: policyActiveRef, revision: 0 }] } }));
  mustCommit(await platform.architecture.adoptInitialArchitecture(ctx, {
    input: { baselineId: `${prefix}-baseline`, description: 'WP2 memory world', constraints: [],
      catalog: { requireDag: true, dependencies: [], modules: [] } },
    meta: { requestId: `${prefix}-architecture`, expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] } }));
}

/** One independent Goal + accepted Plan + Session + claim through the owners. */
async function seedMemoryWorld(platform: Wp2Platform, ctx: CoreCallContext, scope: TaskClaimFixture['scope'],
  projectRef: TaskClaimFixture['projectRef'], workspaceRef: TaskClaimFixture['workspaceRef'],
  roleSpec: RoleConfigurationRef, roleBinding: TaskClaimFixture['roleBinding'], budget: TaskClaimFixture['budget'],
  goalId: string, planId: string, taskId: string, prefix: string,
  requirementKind: 'test' | 'static' = 'test',
  claimTask: Wp2Platform['claims']['claimTask'] = platform.claims.claimTask.bind(platform.claims)):
  Promise<{ goalRef: GoalRef; planRef: PlanRevisionRef; sessionRef: SessionRef; claim: TaskClaim }> {
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId };
  mustCommit(await platform.goals.createGoal(ctx, { input: { goalId, workspace: scope, objective: `WP2 ${prefix}` },
    meta: { requestId: `${prefix}-goal`, expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] } }));
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId, planRevision: 1, goalId, stages: [],
    tasks: [
      { taskId, title: 'WP2 work', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: `${taskId}-gate`, title: 'WP2 gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId, role: roleBinding.templateId, instruction: 'WP2 work' }],
    obligations: [{ obligationId: `${prefix}-obligation`, title: 'WP2 delivery', requirementLevel: 'required',
      taskIds: [taskId, `${taskId}-gate`],
      verificationRequirements: [{ requirementId: `${prefix}-check`, requirementLevel: 'required', kind: requirementKind, description: 'WP2 test' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
  const proposed = mustCommit<{ ref: unknown; revision: number; issues: unknown[] }>(await platform.plans.proposePlan(ctx, {
    input: { goalRef, basedOn: null, draft, reason: { text: `WP2 ${prefix} plan`, sources: [] } },
    meta: { requestId: `${prefix}-propose`, expected: [{ ref: goalRef, revision: 1 }] } }));
  if (proposed.issues.length > 0) throw new Error(`WP2 ${prefix} plan issues`);
  mustCommit(await platform.plans.applyPlanChange(ctx, {
    input: { proposalRef: proposed.ref as never, expectedProposalRevision: proposed.revision, decisionRefs: [] },
    meta: { requestId: `${prefix}-apply`, expected: [{ ref: goalRef, revision: 1 }] } }));
  const sessionRecord = mustComplete<{ ref: { projectId: string; sessionId: string }; revision: number }>(
    await platform.runtime.createSession(ctx, { workspace: scope, role: roleSpec, recommendedRefs: [], initialLinks: [],
      meta: { requestId: `${prefix}-session`, expected: [] } }));
  const sessionRef: SessionRef = { projectId: sessionRecord.ref.projectId, sessionId: sessionRecord.ref.sessionId };
  const goalRead = await platform.plans.queryGoal(ctx, goalRef);
  if (goalRead.status !== 'ready') throw new Error(`WP2 ${prefix} goal read`);
  const wsRead = await platform.projects.readWorkspaceRegistration(ctx, scope);
  if (wsRead.status !== 'ready') throw new Error(`WP2 ${prefix} workspace read`);
  const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: scope.projectId, planId };
  const claim = mustCommit<TaskClaim>(await claimTask(ctx, {
    input: { goalRef, planRef, taskId, sessionRef, roleBinding, budget },
    meta: { requestId: `${prefix}-claim`, expected: [
      { ref: goalRef, revision: goalRead.value.goal.revision },
      { ref: workspaceRef, revision: wsRead.value.workspace.revision },
      { ref: plainSessionRefToAggregate(sessionRef), revision: sessionRecord.revision },
    ] } }));
  return { goalRef, planRef, sessionRef, claim };
}


/** The memory-storage variant: the composition's own owners build the world. */
async function createWP2MemoryPlatform(options: WP2PlatformOptions): Promise<WP2PlatformFixture> {
  const toolNames = [...(options.tools ?? WP2_ALL_TOOL_NAMES)];
  const duty = options.duty ?? 'secretary';
  const systemInstruction = options.systemInstruction === undefined
    ? await readFile(C2_SAFETY_PATH, 'utf8') : options.systemInstruction;
  const f = await createTaskClaimFixture('memory');
  await writeFile(join(f.directory, 'wp2-read.txt'), 'WP2_REAL_READ_CONTENT');
  const scripted = createScriptedModel(options.scriptedReplies ?? [{ kind: 'text', text: 'WP2 scripted answer' }], options.beforeReply);
  const queryScripted = createScriptedModel(options.queryReplies ?? [{ kind: 'text', text: 'WP2 query answer' }], options.beforeQueryReply);
  const queryInstruction = options.queryInstruction === undefined
    ? 'WP2 trusted read-only consultation guidance' : options.queryInstruction;
  const allowedRuns = new Set<string>();
  const host: RuntimeHostBindings = {
    async resolveConfiguration(ctx, request) {
      if (ctx.projectId !== f.scope.projectId || ctx.workspaceId !== f.scope.workspaceId
        || (!options.allowAnyRun && !allowedRuns.has(canonicalJson(request.runRef as unknown as JsonValue)))) {
        return { status: 'rejected', code: 'forbidden', reason: 'WP2 Host is not bound to this complete Run/scope' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'WP2 Host refuses the current Role' };
      }
      return { status: 'ready', value: {
        configurationRevision: 'wp2-host-config@1',
        model: { configuration: { revision: 'wp2-host-config@1', provider: 'deepseek', model: 'wp2-local-scripted', baseUrl: 'http://127.0.0.1' },
          client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'wp2-fixture-counter' }) } },
        budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 12, maxToolCalls: 16, timeoutMs: 30000, perResponseTokens: 512 },
        tools: [...toolNames], writeScope: [...(options.writable === true ? ['.'] : options.writeScope ?? [])],
        ...(options.writable === true ? { shellWorkspaceAccess: 'all_except_denied' as const } : {}),
        ...(options.contextResidentBytes === undefined ? {} : { contextResidentBytes: options.contextResidentBytes }),
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: request.role.templateId, revision: request.role.templateRevision, digest: sha256Hex(systemInstruction ?? '') } : null,
        skills: { resourceRoot: C2_SKILL_ROOT, enabledIds: [...(options.skillIds ?? C2_SKILL_IDS)] },
        systemInstruction, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
    async resolveQueryConfiguration(ctx, request) {
      if (ctx.projectId !== f.scope.projectId || ctx.workspaceId !== f.scope.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'WP2 query Host is not bound to this workspace' };
      }
      return { status: 'ready', value: {
        configurationRevision: 'wp2-query-host@1',
        model: { configuration: { revision: 'wp2-query-host@1', provider: 'deepseek', model: 'wp2-local-scripted-query', baseUrl: 'http://127.0.0.1' },
          client: queryScripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'wp2-query-counter' }) } },
        budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 },
        tools: [...(options.queryTools ?? ['read'])], writeScope: [],
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: request.role.templateId, revision: request.role.templateRevision, digest: sha256Hex(queryInstruction ?? '') } : null,
        skills: { resourceRoot: C2_SKILL_ROOT, enabledIds: [] },
        systemInstruction: queryInstruction,
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
  const workspaceHost: RuntimeExecutionDependencies['workspaceHost'] = {
    async resolveRoot(scope) {
      return scope.projectId === f.scope.projectId && scope.workspaceId === f.scope.workspaceId
        ? { status: 'ready', value: { root: f.directory, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'WP2 unknown workspace' };
    },
    async authorize(ctx, scope) {
      if (ctx.projectId !== f.scope.projectId || ctx.workspaceId !== f.scope.workspaceId
        || scope.projectId !== ctx.projectId || scope.workspaceId !== ctx.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'WP2 Host workspace scope mismatch' };
      }
      if (options.allowSourceRead !== true) {
        return { status: 'rejected', code: 'forbidden', reason: 'WP2 Host denies the workspace source read' };
      }
      return { status: 'ready', value: { subjectKey: canonicalJson(ctx.principal as unknown as JsonValue),
        permissionRevision: 'wp2-workspace-read@1', allowsRead: (path: string) => path === 'wp2-read.txt' } };
    },
  };
  const directory = f.directory;
  const notices: RecordCommitNotice[] = [];
  // The memory world uses the exact versioned `platform-<duty>@s3.1` legacy
  // template; the coordination matrix has no production writer.
  const memTemplate = { kind: 'legacy_template' as const, templateId: `platform-${duty}`, templateRevision: 's3.1' };
  const memBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 'wp2-memory-binding',
    templateId: memTemplate.templateId, templateRevision: memTemplate.templateRevision,
    bindingVersion: 1, policyRevision: 'legacy-template' };
  const memWorkflow: WorkflowHostConfiguration | undefined = options.workflowBound === true
    ? { consumerId: 'wp2-scenario-consumer', bindings: [{ workspace: f.scope, sessionRole: memTemplate,
      roleBinding: memBinding, budget: { tokenBudget: 1_000_000, deadline: null } }] }
    : options.workflow;
  const platformOptions: Parameters<typeof createTargetPlatform>[0] = {
    storage: { kind: 'memory' }, workspace: workspaceHost, now: platformClock(options),
    operatorActor: { kind: 'human', id: 'r4c-claim-operator' },
    ...(options.ownedHost === true ? { hostInstance: { hostInstanceId: 'wp2-host', lease: 'owned' as const } } : {}),
    commitObserver: { started: () => undefined, committed: notice => { notices.push(notice); options.onCommit?.(notice); } },
    ...(options.check === true ? { checks: wp2ChecksConfiguration(f) } : {}),
    ...(memWorkflow === undefined ? {} : { workflow: memWorkflow }),
    kernelStores: { entries: [{ adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
      workspace: f.scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: host,
  };
  let failBeforeWrite = false;
  let beforeWrites = 0;
  const preparedCommits: WP2ObservedCommit[] = [];
  const beforeWrite = (): void => {
    beforeWrites += 1;
    if (failBeforeWrite) { failBeforeWrite = false; throw new Error('WP2 injected beforeWrite failure'); }
  };
  const observe = <T,>(backend: T): T => {
    const records = (backend as { records: { commit(input: unknown): Promise<unknown> } }).records;
    const raw = records.commit.bind(records);
    const wrapped = { ...records, async commit(input: unknown) {
      const receipt = await raw(input) as { status: string; replayed?: boolean; cursor?: string };
      if (receipt.status === 'committed' && receipt.replayed !== true) {
        try {
          const events = (input as { events?: readonly { eventType: string; json: string }[] }).events ?? [];
          preparedCommits.push({ cursor: String(receipt.cursor),
            events: events.map(event => ({ eventType: event.eventType, json: event.json })) });
        } catch { /* an observer never affects a commit */ }
      }
      return receipt;
    } };
    // F11: the composition always generates Run ids with randomUUID. The
    // observed in-memory records are also the seed target for the fixture's
    // deterministic claim owner (option below), so a message pair's id order can
    // be pinned without changing production.
    composedRecords = wrapped as unknown;
    return { ...(backend as object), records: wrapped } as T;
  };
  async function withBackendFault<T>(action: () => Promise<T>): Promise<T> {
    const originalMemory = memoryBackend.createInMemoryRecordBackend;
    const originalSqlite = sqliteBackend.createSqliteRecordBackend;
    const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend').mockImplementation(
      backendOptions => observe(originalMemory({ ...backendOptions, beforeWrite })));
    const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend').mockImplementation(
      backendOptions => observe(originalSqlite({ ...backendOptions, beforeWrite })));
    try { return await action(); } finally { memorySpy.mockRestore(); sqliteSpy.mockRestore(); }
  }
  // F11: the composition's observed in-memory records, the seed target of the
  // deterministic claim owner when `deterministicClaimIds` is set.
  let composedRecords: unknown = null;
  let livePlatform = await withSourceFault(options, () => withBackendFault(() => createTargetPlatform(platformOptions)));
  const requirementKind = options.checkRequirementKind ?? 'test';
  await seedMemoryFoundation(livePlatform, f.ctx, f.scope, f.projectRef, f.workspaceRef, 'wp2-memory', requirementKind);
  // The coordination matrix has no production writer, and a `role_spec` Session
  // needs one to resolve; the memory world therefore uses the exact versioned
  // `platform-secretary@s3.1` legacy template, which the composition's
  // `legacyDuty` matcher resolves to the same duty.
  const deterministicClaims = options.deterministicClaimIds === true && composedRecords !== null
    ? f.makeService(composedRecords as never, () => B2_AT)
    : null;
  const first = await seedMemoryWorld(livePlatform, f.ctx, f.scope, f.projectRef, f.workspaceRef, memTemplate,
    memBinding, f.budget, f.goalRef.goalId, f.planRef.planId, f.tasks.first.taskId, 'wp2-memory-first',
    requirementKind, deterministicClaims?.claimTask.bind(deterministicClaims));
  allowedRuns.add(canonicalJson(first.claim.runRef as unknown as JsonValue));
  let second: Awaited<ReturnType<typeof seedMemoryWorld>> | null = null;
  if (options.secondWorld === true) {
    second = await seedMemoryWorld(livePlatform, f.ctx, f.scope, f.projectRef, f.workspaceRef, memTemplate,
      memBinding, f.budget, 'wp2-second-goal', 'wp2-second-plan', 'wp2-second-task', 'wp2-memory-second',
      requirementKind, deterministicClaims?.claimTask.bind(deterministicClaims));
    allowedRuns.add(canonicalJson(second.claim.runRef as unknown as JsonValue));
  }
  const workCtx = (runRef: RunRef = first.claim.runRef): CoreCallContext => ({
    projectId: f.scope.projectId, workspaceId: f.scope.workspaceId,
    principal: { kind: 'work_run', runRef, roleBinding: memBinding },
    materialReader: { kind: 'run', requester: runRef }, signal: f.ctx.signal,
  });
  const secondWorkCtx = (): CoreCallContext => {
    if (second === null) throw new Error('WP2 has no second claim');
    return workCtx(second.claim.runRef);
  };
  return {
    fixture: f, get platform() { return livePlatform; }, scripted, queryScripted, host, ctx: f.ctx, scope: f.scope, goalRef: first.goalRef,
    claimRequest: {} as Awaited<ReturnType<TaskClaimFixture['buildRequest']>>, claim: first.claim, runRef: first.claim.runRef, sessionRef: first.sessionRef,
    secondGoalRef: second?.goalRef ?? null, secondPlanRef: second?.planRef ?? null, secondTaskId: 'wp2-second-task',
    secondSessionRef: second?.sessionRef ?? null, secondClaim: second?.claim ?? null, secondRunRef: second?.claim.runRef ?? null,
    deferredGoalRef: null,
    roleBinding: memBinding,
    directory, workCtx, secondWorkCtx,
    failNextWrite() { failBeforeWrite = true; },
    beforeWrites: () => beforeWrites,
    commits: () => notices,
    preparedCommits: () => preparedCommits,
    async reopen() {
      await livePlatform.close();
      livePlatform = await withSourceFault(options, () => withBackendFault(() => createTargetPlatform(platformOptions)));
      // The memory store is recreated empty; the seeded world cannot be replayed.
      throw new Error('WP2 memory reopen is not supported');
    },
    async close() { await livePlatform.close(); await f.close(); },
  };
}

/**
 * A REAL read-only-copy derivation through the production Session lifecycle:
 * `admitSessionCreation` + `recordSessionCreated` with the `readonly_copy`
 * provenance, the same two writers `runtime.createSession` drives. It creates a
 * new Session through the lifecycle; it never overwrites an existing record
 * (F03 audit fix: no fabricated provenance on a normal Session).
 */
async function createDerivedReadOnlyCopy(f: TaskClaimFixture, role: RoleConfigurationRef,
  source: SessionRef, messageRef: SessionMessageRef, requestId: string): Promise<SessionRef> {
  const admitted = await f.sessionsPort.admitSessionCreation(f.ctx, {
    meta: { requestId: `admit-${requestId}`, expected: [] },
    input: { workspace: f.scope, kernelStore: { adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store' },
      role, recommendedRefs: [], initialLinks: [],
      provenance: { schemaVersion: 1, kind: 'readonly_copy', from: source, messageRef } },
  });
  if (admitted.status !== 'committed') throw new Error(`WP2 copy admission failed: ${JSON.stringify(admitted)}`);
  const registered = await f.sessionsPort.recordSessionCreated(f.ctx, {
    meta: { requestId: `register-${requestId}`, expected: [] },
    input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
      adapterId: 'r4c-claim-kernel', kernelSessionId: `wp2-copy-kernel-${requestId}`,
      historyCursor: null, observedAt: B2_AT },
  });
  if (registered.status !== 'committed') throw new Error(`WP2 copy registration failed: ${JSON.stringify(registered)}`);
  return { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };
}

export async function createWP2Platform(options: WP2PlatformOptions = {}): Promise<WP2PlatformFixture> {
  if ((options.kind ?? 'sqlite') === 'memory') return createWP2MemoryPlatform(options);
  if (options.checkRequirementKind === 'static') {
    throw new Error('WP2 static check requirements are only supported by the memory world');
  }
  const toolNames = [...(options.tools ?? WP2_ALL_TOOL_NAMES)];
  const duty = options.duty ?? 'secretary';
  const systemInstruction = options.systemInstruction === undefined
    ? await readFile(C2_SAFETY_PATH, 'utf8') : options.systemInstruction;
  const f = await createTaskClaimFixture(options.kind ?? 'sqlite');
  await writeFile(join(f.directory, 'wp2-read.txt'), 'WP2_REAL_READ_CONTENT');

  const actor = f.ctx.principal.kind === 'host' ? f.ctx.principal.actor : { kind: 'system' as const, id: 'wp2-unreachable' };
  const content: RoleSpecContentV1 = {
    schemaVersion: 1, platformDuty: duty, label: 'WP2 platform role', purpose: 'WP2_PLATFORM_DUTY_PIN',
    responsibility: ['human_decision_support'],
    requiredMaterials: [{ kind: 'contract', reason: 'Read the assigned Plan/Task' }],
    optionalMaterials: [], permissions: {
      tools: [...toolNames], writeScope: options.writable === true ? 'workspace' : 'none',
    },
    budget: { source: 'task-budget', scope: 'assigned-task' },
    requiredOutputs: [{ kind: 'answer-with-sources', reason: 'Report the actual result' }],
    exit: { success: 'Report result', stop: 'Stop on missing permission', handoff: 'Keep references' },
  };
  const installed = await f.roleService.installRoleSpec(f.ctx, {
    commandId: 'wp2-install-role', commandType: 'InstallRoleSpecRevision', schemaVersion: 1,
    correlationId: 'wp2-role', submittedAt: B2_AT,
    identity: { projectId: f.scope.projectId, actor, idempotencyKey: 'wp2-install-role' },
    payload: { roleId: 'builder', revision: 1, content, contentDigest: roleSpecContentDigest(content, 'builder', 1) },
  });
  if (installed.status !== 'committed') throw new Error(`WP2 Role install: ${JSON.stringify(installed)}`);
  const pin = { ref: installed.revisionRef, digest: installed.contentDigest };
  const activated = await f.roleService.activateRoleSpec(f.ctx, {
    commandId: 'wp2-activate-role', commandType: 'ActivateRoleSpecRevision', schemaVersion: 1,
    correlationId: 'wp2-role', submittedAt: B2_AT,
    identity: { projectId: f.scope.projectId, actor, idempotencyKey: 'wp2-activate-role' },
    aggregateId: 'builder', expectedRevision: 1, payload: { target: pin },
  });
  if (activated.status !== 'committed') throw new Error(`WP2 Role activation: ${JSON.stringify(activated)}`);
  const policy: CoordinationPolicyContentV1 = {
    schemaVersion: 1, budget: { maxAutonomousReworks: 0, maxClarifications: 0 },
    allowed: { inScopeRework: false, inScopeTesting: true },
    scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] },
    upgrade: { path: 'manual-decision', note: 'Host decides' },
    roles: { catalog: { builder: pin }, coordinator: { roleId: 'builder', note: 'Coordinate' } },
  };
  const policyId = 'wp2-platform-policy';
  const policyRef = { aggregateType: 'CoordinationPolicyRevision' as const, projectId: f.scope.projectId, policyId, revision: 1 };
  const matrix = await f.commitRaw([
    { refKey: canonicalJson(policyRef as unknown as JsonValue), schemaId: 'CoordinationPolicyRevisionSnapshot@1', revision: 1,
      json: JSON.stringify({ ref: policyRef, revision: 1, schemaVersion: 1, policyId, contentRevision: 1, content: policy,
        contentDigest: coordinationPolicyContentDigest(policy, policyId, 1), installedAt: B2_AT }) },
    { refKey: canonicalJson({ aggregateType: 'ProjectCoordinationPolicyActive', projectId: f.scope.projectId } as unknown as JsonValue),
      schemaId: 'ProjectCoordinationPolicyActiveSnapshot@1', revision: 1,
      json: JSON.stringify({ ref: { aggregateType: 'ProjectCoordinationPolicyActive', projectId: f.scope.projectId }, revision: 1,
        projectId: f.scope.projectId, activeRevision: policyRef }) },
  ]);
  if (matrix.status !== 'committed') throw new Error(`WP2 matrix seed: ${JSON.stringify(matrix)}`);

  const roleSpec: RoleConfigurationRef = { kind: 'role_spec', pin };
  let sessionRef = await f.createSession('wp2-session-first', roleSpec);
  if (options.provenanceKind === 'readonly_copy') {
    // F03: derive a REAL read-only copy through the session lifecycle instead of
    // overwriting the primary Session's provenance in the fixture.
    sessionRef = await createDerivedReadOnlyCopy(f, roleSpec, f.sessions.first,
      { aggregateType: 'SessionMessage', projectId: f.scope.projectId, workspaceId: f.scope.workspaceId,
        messageId: 'wp2-copy-source' }, 'wp2-copy');
  }
  const claimRequest = await f.buildRequest({ input: { sessionRef } });
  let claim: TaskClaim | null = null;
  if (options.skipClaim !== true) {
    const claimed = await f.service.claimTask(f.ctx, claimRequest);
    if (claimed.status !== 'committed') throw new Error(`WP2 claim failed: ${JSON.stringify(claimed)}`);
    claim = claimed.value;
  }

  // A second independent world: its own Goal, accepted Plan, Session and claim.
  // No executionDag edge, so its Run is independently preparable (E3 reply world).
  const SECOND_TASK = 'wp2-second-task';
  let secondGoalRef: GoalRef | null = null;
  let secondPlanRef: PlanRevisionRef | null = null;
  let secondSessionRef: SessionRef | null = null;
  let secondClaim: TaskClaim | null = null;
  if (options.secondWorld === true) {
    secondGoalRef = { aggregateType: 'Goal', projectId: f.scope.projectId, goalId: 'wp2-second-goal' };
    secondPlanRef = { aggregateType: 'PlanRevision', projectId: f.scope.projectId, planId: 'wp2-second-plan' };
    const created = await f.goals.createGoal(f.ctx, { meta: { requestId: 'wp2-create-goal-2',
      expected: [{ ref: f.projectRef, revision: 1 }, { ref: f.workspaceRef, revision: 1 }] },
      input: { goalId: secondGoalRef.goalId, workspace: f.scope, objective: 'WP2 second independent run' } });
    if (created.status !== 'committed') throw new Error(`WP2 second Goal: ${JSON.stringify(created)}`);
    const draft: PlanRevisionDraft = { schemaVersion: 2, planId: secondPlanRef.planId, planRevision: 1,
      goalId: secondGoalRef.goalId, stages: [],
      tasks: [
        { taskId: SECOND_TASK, title: 'Second task', requirementLevel: 'required', taskKind: 'work',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
        { taskId: 'wp2-second-gate', title: 'Second gate', requirementLevel: 'required', taskKind: 'gate',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      ],
      assignments: [{ taskId: SECOND_TASK, role: 'builder', instruction: 'Second task' }],
      obligations: [{ obligationId: 'wp2-second-obligation', title: 'Second delivery', requirementLevel: 'required',
        taskIds: [SECOND_TASK, 'wp2-second-gate'],
        verificationRequirements: [{ requirementId: 'wp2-second-check', requirementLevel: 'required', kind: 'test',
          description: 'Second test' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
    const proposed = await f.plans.proposePlan(f.ctx, { meta: { requestId: 'wp2-propose-2',
      expected: [{ ref: secondGoalRef, revision: 1 }] },
      input: { goalRef: secondGoalRef, basedOn: null, draft, reason: { text: 'Second plan', sources: [] } } });
    if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
      throw new Error(`WP2 second Plan proposal: ${JSON.stringify(proposed)}`);
    }
    const applied = await f.plans.applyPlanChange(f.ctx, { meta: { requestId: 'wp2-apply-2',
      expected: [{ ref: secondGoalRef, revision: 1 }] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    if (applied.status !== 'committed') throw new Error(`WP2 second Plan adoption: ${JSON.stringify(applied)}`);
    secondSessionRef = await f.createSession('wp2-session-second', roleSpec);
    const goal2Read = await f.plans.queryGoal(f.ctx, secondGoalRef);
    if (goal2Read.status !== 'ready') throw new Error(`WP2 second Goal read: ${JSON.stringify(goal2Read)}`);
    const session2Card = await f.sessionsPort.readSession(f.ctx, secondSessionRef);
    if (session2Card.status !== 'ready') throw new Error(`WP2 second Session read: ${JSON.stringify(session2Card)}`);
    const request2: GraphWrite<ClaimTaskInput> = {
      input: { goalRef: secondGoalRef, planRef: secondPlanRef, taskId: SECOND_TASK, sessionRef: secondSessionRef,
        roleBinding: f.roleBinding, budget: f.budget },
      meta: { requestId: 'wp2-claim-second', expected: [
        { ref: secondGoalRef, revision: goal2Read.value.goal.revision },
        { ref: f.workspaceRef, revision: 1 },
        { ref: plainSessionRefToAggregate(secondSessionRef), revision: session2Card.value.record.revision },
      ] },
    };
    const claimed2 = await f.service.claimTask(f.ctx, request2);
    if (claimed2.status !== 'committed') throw new Error(`WP2 second claim: ${JSON.stringify(claimed2)}`);
    secondClaim = claimed2.value;
  }

  // A Goal whose required work Task is deferred through the real Plan writers:
  // the Goal display then carries `required_task_deferred`, and the product's
  // goal-decision reader prepares a Task-linked `goal_cause` card (F07).
  let deferredGoalRef: GoalRef | null = null;
  if (options.deferredGoal === true) {
    deferredGoalRef = { aggregateType: 'Goal', projectId: f.scope.projectId, goalId: 'wp2-deferred-goal' };
    const deferredPlanRef = { aggregateType: 'PlanRevision' as const, projectId: f.scope.projectId, planId: 'wp2-deferred-plan' };
    const created = await f.goals.createGoal(f.ctx, { meta: { requestId: 'wp2-deferred-goal',
      expected: [{ ref: f.projectRef, revision: 1 }, { ref: f.workspaceRef, revision: 1 }] },
      input: { goalId: deferredGoalRef.goalId, workspace: f.scope, objective: 'WP2 deferred required work' } });
    if (created.status !== 'committed') throw new Error(`WP2 deferred Goal: ${JSON.stringify(created)}`);
    const draft: PlanRevisionDraft = { schemaVersion: 2, planId: deferredPlanRef.planId, planRevision: 1,
      goalId: deferredGoalRef.goalId, stages: [],
      tasks: [
        { taskId: 'wp2-deferred-work', title: 'Deferred work', requirementLevel: 'required', taskKind: 'work',
          disposition: 'deferred', phase: 'pending', scope: { kind: 'goal' } },
        { taskId: 'wp2-deferred-blocker', title: 'Blocked active work', requirementLevel: 'required', taskKind: 'work',
          disposition: 'active', phase: 'pending', executionIntent: 'plan_only', scope: { kind: 'goal' } },
        { taskId: 'wp2-deferred-gate', title: 'Deferred gate', requirementLevel: 'required', taskKind: 'gate',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      ],
      assignments: [{ taskId: 'wp2-deferred-work', role: 'builder', instruction: 'Deferred work' }],
      obligations: [{ obligationId: 'wp2-deferred-obligation', title: 'Deferred delivery', requirementLevel: 'required',
        taskIds: ['wp2-deferred-work', 'wp2-deferred-blocker', 'wp2-deferred-gate'],
        verificationRequirements: [{ requirementId: 'wp2-deferred-check', requirementLevel: 'required', kind: 'test',
          description: 'Deferred test' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
    const proposed = await f.plans.proposePlan(f.ctx, { meta: { requestId: 'wp2-deferred-propose',
      expected: [{ ref: deferredGoalRef, revision: 1 }] },
      input: { goalRef: deferredGoalRef, basedOn: null, draft, reason: { text: 'Deferred plan', sources: [] } } });
    if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
      throw new Error(`WP2 deferred Plan proposal: ${JSON.stringify(proposed)}`);
    }
    const applied = await f.plans.applyPlanChange(f.ctx, { meta: { requestId: 'wp2-deferred-apply',
      expected: [{ ref: deferredGoalRef, revision: 1 }] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    if (applied.status !== 'committed') throw new Error(`WP2 deferred Plan adoption: ${JSON.stringify(applied)}`);
  }

  const scripted = createScriptedModel(options.scriptedReplies ?? [{ kind: 'text', text: 'WP2 scripted answer' }], options.beforeReply);
  const queryScripted = createScriptedModel(options.queryReplies ?? [{ kind: 'text', text: 'WP2 query answer' }], options.beforeQueryReply);
  const queryInstruction = options.queryInstruction === undefined
    ? 'WP2 trusted read-only consultation guidance' : options.queryInstruction;
  const allowedRuns = new Set<string>();
  if (claim !== null) allowedRuns.add(canonicalJson(claim.runRef as unknown as JsonValue));
  if (secondClaim !== null) allowedRuns.add(canonicalJson(secondClaim.runRef as unknown as JsonValue));
  const host: RuntimeHostBindings = {
    async resolveConfiguration(ctx, request) {
      if (ctx.projectId !== f.scope.projectId || ctx.workspaceId !== f.scope.workspaceId
        || (!options.allowAnyRun && !allowedRuns.has(canonicalJson(request.runRef as unknown as JsonValue)))) {
        return { status: 'rejected', code: 'forbidden', reason: 'WP2 Host is not bound to this complete Run/scope' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'WP2 Host refuses the current Role' };
      }
      return { status: 'ready', value: {
        configurationRevision: 'wp2-host-config@1',
        model: { configuration: { revision: 'wp2-host-config@1', provider: 'deepseek', model: 'wp2-local-scripted', baseUrl: 'http://127.0.0.1' },
          client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'wp2-fixture-counter' }) } },
        budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 12, maxToolCalls: 16, timeoutMs: 30000, perResponseTokens: 512 },
        tools: [...toolNames], writeScope: [...(options.writable === true ? ['.'] : options.writeScope ?? [])],
        ...(options.writable === true ? { shellWorkspaceAccess: 'all_except_denied' as const } : {}),
        hostTemplate: null,
        ...(options.contextResidentBytes === undefined ? {} : { contextResidentBytes: options.contextResidentBytes }),
        skills: { resourceRoot: C2_SKILL_ROOT, enabledIds: [...(options.skillIds ?? C2_SKILL_IDS)] },
        systemInstruction,
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
    async resolveQueryConfiguration(ctx, request) {
      if (ctx.projectId !== f.scope.projectId || ctx.workspaceId !== f.scope.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'WP2 query Host is not bound to this workspace' };
      }
      return { status: 'ready', value: {
        configurationRevision: 'wp2-query-host@1',
        model: { configuration: { revision: 'wp2-query-host@1', provider: 'deepseek', model: 'wp2-local-scripted-query', baseUrl: 'http://127.0.0.1' },
          client: queryScripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'wp2-query-counter' }) } },
        budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 },
        tools: [...(options.queryTools ?? ['read'])], writeScope: [],
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: request.role.templateId, revision: request.role.templateRevision, digest: sha256Hex(queryInstruction ?? '') } : null,
        skills: { resourceRoot: C2_SKILL_ROOT, enabledIds: [] },
        systemInstruction: queryInstruction,
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
  const workspaceHost: RuntimeExecutionDependencies['workspaceHost'] = {
    async resolveRoot(scope) {
      return scope.projectId === f.scope.projectId && scope.workspaceId === f.scope.workspaceId
        ? { status: 'ready', value: { root: f.directory, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'WP2 unknown workspace' };
    },
    async authorize(ctx, scope) {
      if (ctx.projectId !== f.scope.projectId || ctx.workspaceId !== f.scope.workspaceId
        || scope.projectId !== ctx.projectId || scope.workspaceId !== ctx.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'WP2 Host workspace scope mismatch' };
      }
      if (options.allowSourceRead !== true) {
        return { status: 'rejected', code: 'forbidden', reason: 'WP2 Host denies the workspace source read' };
      }
      return { status: 'ready', value: { subjectKey: canonicalJson(ctx.principal as unknown as JsonValue),
        permissionRevision: 'wp2-workspace-read@1', allowsRead: (path: string) => path === 'wp2-read.txt' } };
    },
  };

  const boundWorkflow: WorkflowHostConfiguration | undefined = options.workflowBound === true
    ? { consumerId: 'wp2-scenario-consumer', bindings: [{ workspace: f.scope, sessionRole: roleSpec,
      roleBinding: f.roleBinding, budget: { tokenBudget: 1_000_000, deadline: null } }] }
    : options.workflow;
  const directory = f.directory;
  await f.closeBackend();
  const notices: RecordCommitNotice[] = [];
  const platformOptions: Parameters<typeof createTargetPlatform>[0] = {
    storage: { kind: 'sqlite', directory }, workspace: workspaceHost, now: platformClock(options),
    operatorActor: { kind: 'human', id: 'r4c-claim-operator' },
    ...(options.ownedHost === true ? { hostInstance: { hostInstanceId: 'wp2-host', lease: 'owned' as const } } : {}),
    commitObserver: { started: () => undefined, committed: notice => { notices.push(notice); options.onCommit?.(notice); } },
    ...(options.check === true ? { checks: wp2ChecksConfiguration(f) } : {}),
    ...(boundWorkflow === undefined ? {} : { workflow: boundWorkflow }),
    kernelStores: { entries: [{ adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
      workspace: f.scope, databasePath: join(directory, 'kernel.sqlite') }] },
    runtime: host,
  };
  let failBeforeWrite = false;
  let beforeWrites = 0;
  const preparedCommits: WP2ObservedCommit[] = [];
  const beforeWrite = (): void => {
    beforeWrites += 1;
    if (failBeforeWrite) { failBeforeWrite = false; throw new Error('WP2 injected beforeWrite failure'); }
  };
  const observe = <T,>(backend: T): T => {
    const records = (backend as { records: { commit(input: unknown): Promise<unknown> } }).records;
    const raw = records.commit.bind(records);
    return { ...(backend as object), records: { ...records, async commit(input: unknown) {
      const receipt = await raw(input) as { status: string; replayed?: boolean; cursor?: string };
      if (receipt.status === 'committed' && receipt.replayed !== true) {
        try {
          const events = (input as { events?: readonly { eventType: string; json: string }[] }).events ?? [];
          preparedCommits.push({ cursor: String(receipt.cursor),
            events: events.map(event => ({ eventType: event.eventType, json: event.json })) });
        } catch { /* an observer never affects a commit */ }
      }
      return receipt;
    } } } as T;
  };
  // The injected callback belongs to the real backend the composition builds.
  async function withBackendFault<T>(action: () => Promise<T>): Promise<T> {
    const original = sqliteBackend.createSqliteRecordBackend;
    const spy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend').mockImplementation(
      options => observe(original({ ...options, beforeWrite })));
    try { return await action(); } finally { spy.mockRestore(); }
  }
  let livePlatform = await withSourceFault(options, () => withBackendFault(() => createTargetPlatform(platformOptions)));

  const workCtx = (runRef: RunRef = claim?.runRef ?? (() => { throw new Error('WP2 has no first claim'); })()): CoreCallContext => ({
    projectId: f.scope.projectId, workspaceId: f.scope.workspaceId,
    principal: { kind: 'work_run', runRef, roleBinding: f.roleBinding },
    materialReader: { kind: 'run', requester: runRef }, signal: f.ctx.signal,
  });
  const secondWorkCtx = (): CoreCallContext => {
    if (secondClaim === null) throw new Error('WP2 has no second claim');
    return workCtx(secondClaim.runRef);
  };

  return {
    fixture: f, get platform() { return livePlatform; }, scripted, queryScripted, host, ctx: f.ctx, scope: f.scope, goalRef: f.goalRef,
    claimRequest, claim, runRef: claim?.runRef ?? null, sessionRef,
    secondGoalRef, secondPlanRef, secondTaskId: SECOND_TASK, secondSessionRef, secondClaim,
    secondRunRef: secondClaim?.runRef ?? null,
    deferredGoalRef,
    roleBinding: f.roleBinding,
    directory, workCtx, secondWorkCtx,
    failNextWrite() { failBeforeWrite = true; },
    beforeWrites: () => beforeWrites,
    commits: () => notices,
    preparedCommits: () => preparedCommits,
    async reopen() {
      await livePlatform.close();
      livePlatform = await withSourceFault(options, () => withBackendFault(() => createTargetPlatform(platformOptions)));
    },
    async close() { await livePlatform.close(); await f.close(); },
  };
}

/** The exact secret/decision request args the scripted model passes. */
export function decisionRequestArgs(goalRef: GoalRef, overrides: Partial<{
  intent: 'notify' | 'decision_request'; text: string; needsReply: boolean; waitAfterSend: boolean;
  options: Array<{ id: string; label: string; effect: 'apply' | 'reject' | 'defer' }>;
}> = {}): Record<string, unknown> {
  const intent = overrides.intent ?? 'decision_request';
  return {
    goalRef,
    intent,
    text: overrides.text ?? '请决定是否继续',
    needsReply: overrides.needsReply ?? intent === 'decision_request',
    waitAfterSend: overrides.waitAfterSend ?? false,
    options: overrides.options ?? (intent === 'decision_request'
      ? [{ id: 'continue', label: '继续', effect: 'apply' }, { id: 'stop', label: '停止', effect: 'reject' }] : []),
    objects: [],
  };
}

/** One trusted passing static check on the WP2 workspace (E0 next-round rows). */
function wp2ChecksConfiguration(f: TaskClaimFixture): TrustedCheckConfiguration {
  return {
    configurationRevision: 'wp2-checks@1',
    workspace: f.workspaceRef,
    executor: { kind: 'human', id: 'r4c-claim-operator' },
    permissionRevision: 'wp2-workspace-read@1',
    sourceAccess: 'verification_workspace',
    processAccess: 'all_except_denied',
    deniedPrefixes: ['.git'],
    checks: [{ checkId: 'wp2-static', kind: 'static', command: 'node -e "process.exit(0)"',
      cwd: '.', timeoutMs: 30000, taskIds: 'all' }],
  };
}

/**
 * Claim the next Run for `taskId` through the public claim owner on an idle
 * Session. The Run stays `starting` (no start), so `preparedBundleInput` may be
 * called repeatedly to read a fresh assembly (E2/E0 next-round rows).
 */
export async function claimSuccessorRun(f: WP2PlatformFixture, goalRef: GoalRef, taskId: string,
  sessionRef: SessionRef, requestId: string, planRef: PlanRevisionRef = f.fixture.planRef,
  requeueRef?: TaskRequeueRef): Promise<RunRef> {
  const goal = await f.platform.plans.queryGoal(f.ctx, goalRef);
  if (goal.status !== 'ready') throw new Error(`successor Goal: ${JSON.stringify(goal)}`);
  const workspace = await f.platform.projects.readWorkspaceRegistration(f.ctx, f.scope);
  if (workspace.status !== 'ready') throw new Error(`successor workspace: ${JSON.stringify(workspace)}`);
  const card = await f.platform.sessions.readSession(f.ctx, sessionRef);
  if (card.status !== 'ready') throw new Error(`successor Session: ${JSON.stringify(card)}`);
  const claimed = await f.platform.claims.claimTask(f.ctx, { input: {
    goalRef, planRef, taskId, sessionRef,
    roleBinding: f.fixture.roleBinding, budget: f.fixture.budget,
    ...(requeueRef === undefined ? {} : { requeueRef }) },
    meta: { requestId, expected: [
      { ref: goalRef, revision: goal.value.goal.revision },
      { ref: f.fixture.workspaceRef, revision: workspace.value.workspace.revision },
      { ref: card.value.record.ref, revision: card.value.record.revision }] } });
  if (claimed.status !== 'committed') throw new Error(`successor claim: ${JSON.stringify(claimed)}`);
  return claimed.value.runRef;
}

/** The exact assembled input of a not-yet-started Run (repeatable before start). */
/** One E2 preparation stage: the prepared value plus its saved manifest input,
 * read with the `observeStage` bracket (no commit, no model call). */
export async function preparedBundle(f: WP2PlatformFixture, runRef: RunRef, requestId: string):
  Promise<{ prepared: PreparedTaskExecution; input: string }> {
  return observeStage(f, async () => {
    const prepared = await f.platform.runtime.prepareExecution(f.ctx, { runRef, requestId });
    if (prepared.status !== 'ready') throw new Error(`prepared input: ${JSON.stringify(prepared)}`);
    const bundle = await f.platform.materials.openArtifact(f.workCtx(runRef), {
      ref: prepared.value.envelope.bundleRef, usage: 'historical_explanation' });
    if (bundle.status !== 'ready') throw new Error(`prepared bundle: ${JSON.stringify(bundle)}`);
    return { prepared: prepared.value, input: (JSON.parse(bundle.value.body) as { input: string }).input };
  });
}

/** The exact assembled input of a not-yet-started Run (repeatable before start). */
export async function preparedBundleInput(f: WP2PlatformFixture, runRef: RunRef, requestId: string): Promise<string> {
  return (await preparedBundle(f, runRef, requestId)).input;
}
