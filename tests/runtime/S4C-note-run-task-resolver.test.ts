/**
 * Slice 4C C2.2: the concrete `NoteRunTaskResolver` in `plan-readers.ts`.
 * One `readMany` of the trusted Run snapshot from `ctx.principal.runRef`.
 *
 * GTN20 builds its own real p/g world: the public Project/Workspace/policy/
 * baseline/Goal owners, one real scripted `initial_coordination` Query whose
 * SAVED Answer becomes the one adopted Plan, a real Runtime Session and a real
 * `claimTask` for t1. The resolver runs over the platform's OWN real records
 * port (the A4 backend factory seam below), wrapped by a counting delegate.
 * Every row runs on the memory and the SQLite backend (R-19).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNoteRunTaskResolver } from '../../src/core/work-graph/tasks/plan-readers.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { RoleBindingRefV1, RunRef, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { InitialPlanningResponseV2 } from '../../src/contracts/initial-planning.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';

// A4 (rule sheet v1 A4, finding table R-21): wrap the real backend factories
// only to hand the production reader under test the platform's OWN real
// records port. Each wrapper returns the real backend unchanged; it changes no
// value and is not a stand-in for the platform.
const platformBackend = vi.hoisted(() => ({ records: undefined as GoalRecordTransactionPort | undefined }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    const backend = actual.createInMemoryRecordBackend(options);
    platformBackend.records = backend.records;
    return backend;
  } };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/sqlite-record-store.js')>();
  return { ...actual, createSqliteRecordBackend: (options: Parameters<typeof actual.createSqliteRecordBackend>[0]) => {
    const backend = actual.createSqliteRecordBackend(options);
    platformBackend.records = backend.records;
    return backend;
  } };
});

/** R-19: every row runs on both backends. */
const STORAGE_KINDS = ['memory', 'sqlite'] as const;
type StorageKind = typeof STORAGE_KINDS[number];

const P = 'p';
const G = 'g';
const W = 'w';
const TASK_ID = 't1';
const AT = '2026-10-15T00:00:00.000Z';
const projectRef = { aggregateType: 'Project' as const, projectId: P };
const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: P, workspaceId: W };
const goalRef: GoalRef = { aggregateType: 'Goal', projectId: P, goalId: G };
const signal = (): AbortSignal => new AbortController().signal;
const HUMAN = { kind: 'human' as const, id: 'u' };

const ROLE_BINDING: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 's4c-resolver-binding',
  templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const BUDGET: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };
const WORK_ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
const QUERY_ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'advisor', templateRevision: '1' };
const QUERY_BINDING: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 's4c-resolver-query-binding',
  templateId: 'advisor', templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };

const PLAN_ANSWER: InitialPlanningResponseV2 = {
  schemaVersion: 2, kind: 'plan', summary: 'S4C resolver fixture plan',
  plan: {
    schemaVersion: 2,
    stages: [],
    tasks: [
      { taskId: TASK_ID, title: 'Resolve this Run', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: TASK_ID, role: 'builder', instruction: 'Do the work' }],
    obligations: [{ obligationId: 'obligation', title: 'Deliver the work', requirementLevel: 'required',
      taskIds: [TASK_ID, 'gate'],
      verificationRequirements: [{ requirementId: 'check', requirementLevel: 'required', kind: 'static',
        description: 'node --test' }] }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
    taskRelations: [],
    inputRequirements: [],
  },
};

function hostContext(): CoreCallContext {
  return { projectId: P, workspaceId: W,
    principal: { kind: 'host', actor: HUMAN },
    materialReader: { kind: 'host', projectId: P, workspaceId: W, actor: HUMAN },
    signal: signal() };
}

function workContext(runRef: RunRef, roleBinding: RoleBindingRefV1): CoreCallContext {
  return { projectId: P, workspaceId: W,
    principal: { kind: 'work_run', runRef: { ...runRef }, roleBinding: { ...roleBinding } },
    materialReader: { kind: 'run', requester: { ...runRef } }, signal: signal() };
}

type ResolverWorld = {
  platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  planRef: PlanRevisionRef;
  runRef: RunRef;
  roleBinding: RoleBindingRefV1;
  /** The platform's own real records port (A4), for the resolver read. */
  records: GoalRecordTransactionPort;
  hostContext(): CoreCallContext;
  workContext(): CoreCallContext;
  close(): Promise<void>;
};

async function openResolverWorld(storage: StorageKind): Promise<ResolverWorld> {
  const directory = await mkdtemp(join(tmpdir(), 'next-s4c-resolver-'));
  const root = join(directory, 'workspace');
  await mkdir(root, { recursive: true });
  const skillsRoot = join(directory, 'skills');
  await mkdir(skillsRoot, { recursive: true });
  const hostActor = { kind: 'human' as const, id: 's4c-resolver-operator' };
  const ctx = (): CoreCallContext => ({ projectId: P, workspaceId: W,
    principal: { kind: 'host', actor: hostActor },
    materialReader: { kind: 'host', projectId: P, workspaceId: W, actor: hostActor },
    signal: signal() });
  const workspace: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === P && requested.workspaceId === W
        ? { status: 'ready', value: { root, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 's4c-resolver-host',
        permissionRevision: 's4c-resolver-grant', allowsRead: () => true } };
    },
  };
  const answerText = JSON.stringify(PLAN_ANSWER);
  const model = createScriptedModel([{ kind: 'text', text: answerText }]);
  const runtime: RuntimeHostBindings = {
    async resolveConfiguration() {
      return { status: 'rejected', code: 'unsupported', reason: 'this fixture runs no Work execution' };
    },
    async resolveQueryConfiguration() {
      return { status: 'ready', value: {
        configurationRevision: 's4c-resolver-host@1',
        model: { configuration: { revision: 's4c-resolver-host@1', provider: 'deepseek',
          model: 's4c-resolver-scripted', baseUrl: 'http://127.0.0.1' }, client: model.client,
          inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
            tokenizer: 's4c-resolver-counter' }) } },
        budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
          maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 },
        tools: ['read', 'project_source'], writeScope: [],
        skills: { resourceRoot: skillsRoot, enabledIds: [] },
        systemInstruction: 'S4C resolver fixture read-only guidance',
        hostTemplate: { templateId: 'advisor', revision: '1',
          digest: sha256Hex('S4C resolver fixture read-only guidance') },
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
  platformBackend.records = undefined;
  const platform = await createTargetPlatform({
    storage: storage === 'memory' ? { kind: 'memory' as const }
      : { kind: 'sqlite' as const, directory: join(directory, 'storage') },
    workspace,
    sourcePolicyFor: async (projectId, workspaceId) => projectId === P && workspaceId === W
      ? { root, permissionRevision: 's4c-resolver-grant', allowsRead: () => true } : null,
    runtime,
    kernelStores: { entries: [{ adapterId: 's4c-resolver-kernel', storeKey: 's4c-resolver-kernel-store',
      workspace: { projectId: P, workspaceId: W }, databasePath: join(directory, 'kernel.sqlite') }] },
    now: () => AT,
  });
  // A4: the records port of the ONE backend this platform has just opened.
  const records = platformBackend.records;
  try {
    if (records === undefined) throw new Error('the platform opened no record backend');
    const createdProject = await platform.projects.createProject(ctx(), {
      meta: { requestId: 's4c-resolver-project', expected: [{ ref: projectRef, revision: 0 }] },
      input: { projectId: P } });
    if (createdProject.status !== 'committed') throw new Error(`resolver project failed: ${JSON.stringify(createdProject)}`);
    const registered = await platform.projects.registerWorkspace(ctx(), {
      meta: { requestId: 's4c-resolver-workspace', expected: [
        { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] },
      input: { workspace: { projectId: P, workspaceId: W } } });
    if (registered.status !== 'committed') throw new Error(`resolver workspace failed: ${JSON.stringify(registered)}`);
    const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: P,
      policyId: 's4c-resolver-policy', revision: 1 };
    const installed = await platform.completionPolicies.installCompletionPolicy(ctx(), {
      meta: { requestId: 's4c-resolver-install-policy', expected: [
        { ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
      input: { policyId: policyRef.policyId, contentRevision: 1,
        content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } } });
    if (installed.status !== 'committed') throw new Error(`resolver policy failed: ${JSON.stringify(installed)}`);
    const activated = await platform.completionPolicies.activateCompletionPolicy(ctx(), {
      meta: { requestId: 's4c-resolver-activate-policy', expected: [
        { ref: projectRef, revision: 1 },
        { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: P }, revision: 0 }] },
      input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } });
    if (activated.status !== 'committed') throw new Error(`resolver policy activation failed: ${JSON.stringify(activated)}`);
    const architecture = await platform.architecture.adoptInitialArchitecture(ctx(), {
      meta: { requestId: 's4c-resolver-architecture', expected: [
        { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
      input: { baselineId: 's4c-resolver-baseline', description: 'S4C resolver baseline',
        constraints: [], catalog: { requireDag: true, dependencies: [], modules: [{
          ref: { projectId: P, moduleId: 's4c-resolver' }, name: 'S4C resolver',
          responsibility: 'Resolve the Run for a note request', paths: ['src'], interfaces: [] }] } } });
    if (architecture.status !== 'committed') throw new Error(`resolver architecture failed: ${JSON.stringify(architecture)}`);
    const createdGoal = await platform.goals.createGoal(ctx(), {
      meta: { requestId: 's4c-resolver-goal', expected: [
        { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
      input: { goalId: G, workspace: { projectId: P, workspaceId: W }, objective: 'Resolve the note Run' } });
    if (createdGoal.status !== 'committed') throw new Error(`resolver Goal failed: ${JSON.stringify(createdGoal)}`);

    const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: P, workspaceId: W,
      queryJobId: 's4c-resolver-job' };
    const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: P, workspaceId: W,
      queryJobId: queryJobRef.queryJobId, runId: 's4c-resolver-run' };
    const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: queryJobRef.queryJobId,
      projectId: P, workspaceId: W, goalId: G, question: 'Propose the initial plan',
      focusTaskRefs: [], budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 },
      correlationId: 's4c-resolver-correlation',
      execution: { kind: 'initial_coordination', roleBinding: QUERY_BINDING,
        runtimeBudget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
          maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 } } };
    const submitted = await platform.queries.submitQueryJob(ctx(), {
      meta: { requestId: 's4c-resolver-submit', expected: [
        { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 },
        { ref: goalRef, revision: 1 }, { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] },
      input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent } });
    if (submitted.status !== 'committed') throw new Error(`resolver query submit failed: ${JSON.stringify(submitted)}`);
    const querySession = await platform.runtime.createSession(ctx(), {
      workspace: { projectId: P, workspaceId: W }, role: QUERY_ROLE, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 's4c-resolver-query-session', expected: [] } });
    if (querySession.status !== 'completed') throw new Error(`resolver query Session failed: ${JSON.stringify(querySession)}`);
    const claimedQuery = await platform.queries.claimQuery(ctx(), {
      meta: { requestId: 's4c-resolver-query-claim', expected: [
        { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
        { ref: querySession.value.ref, revision: querySession.value.revision }] },
      input: { queryRunRef, sessionRef: querySession.value.ref } });
    if (claimedQuery.status !== 'committed') throw new Error(`resolver query claim failed: ${JSON.stringify(claimedQuery)}`);
    const preparedQuery = await platform.runtime.prepareQuery(ctx(), {
      queryRunRef, requestId: 's4c-resolver-query-prepare' });
    if (preparedQuery.status !== 'ready') throw new Error(`resolver query prepare failed: ${JSON.stringify(preparedQuery)}`);
    const startedQuery = await platform.runtime.startQuery(ctx(), {
      prepared: preparedQuery.value, consumerId: 's4c-resolver-query-consumer',
      requestId: 's4c-resolver-query-start' });
    if (startedQuery.status !== 'ready') throw new Error(`resolver query start failed: ${JSON.stringify(startedQuery)}`);
    const answerRef = startedQuery.value.answer?.ref;
    if (answerRef === undefined) throw new Error('the resolver query recorded no formal answer');
    const proposed = await platform.plans.proposeInitialPlanFromAnswer(ctx(), {
      meta: { requestId: 's4c-resolver-propose', expected: [] },
      input: { answerRef,
        reason: { text: 'S4C resolver plan from the real coordination answer', sources: [] } } });
    if (proposed.status !== 'committed' || proposed.value.kind !== 'candidate_v2') {
      throw new Error(`resolver initial plan proposal failed: ${JSON.stringify(proposed)}`);
    }
    const applied = await platform.plans.applyPlanChange(ctx(), {
      meta: { requestId: 's4c-resolver-apply', expected: [{ ref: goalRef, revision: 1 }] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision,
        decisionRefs: [] } });
    if (applied.status !== 'committed') throw new Error(`resolver initial plan adoption failed: ${JSON.stringify(applied)}`);
    const planRef = applied.value.ref;

    const workSession = await platform.runtime.createSession(ctx(), {
      workspace: { projectId: P, workspaceId: W }, role: WORK_ROLE, recommendedRefs: [], initialLinks: [],
      meta: { requestId: 's4c-resolver-work-session', expected: [] } });
    if (workSession.status !== 'completed') throw new Error(`resolver work Session failed: ${JSON.stringify(workSession)}`);
    const goalRead = await platform.plans.queryGoal(ctx(), goalRef);
    if (goalRead.status !== 'ready') throw new Error(`resolver Goal read failed: ${JSON.stringify(goalRead)}`);
    const claimed = await platform.claims.claimTask(ctx(), {
      meta: { requestId: 's4c-resolver-claim', expected: [
        { ref: goalRef, revision: goalRead.value.goal.revision },
        { ref: workspaceRef, revision: 1 },
        { ref: workSession.value.ref, revision: workSession.value.revision }] },
      input: { goalRef, planRef, taskId: TASK_ID, sessionRef: workSession.value.ref,
        roleBinding: ROLE_BINDING, budget: BUDGET } });
    if (claimed.status !== 'committed') throw new Error(`resolver claim failed: ${JSON.stringify(claimed)}`);
    const runRef = claimed.value.runRef;
    const execution = await platform.executions.readExecution(ctx(), runRef);
    if (execution.status !== 'ready') throw new Error(`resolver Run read failed: ${JSON.stringify(execution)}`);
    const roleBinding = execution.value.run.roleBinding;

    return {
      platform, planRef, runRef, roleBinding, records,
      hostContext,
      workContext: () => workContext(runRef, roleBinding),
      async close() { await platform.close(); await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) {
    await platform.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

const worlds: ResolverWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });
const world = async (storage: StorageKind): Promise<ResolverWorld> => {
  const opened = await openResolverWorld(storage);
  worlds.push(opened);
  return opened;
};

describe.each(STORAGE_KINDS)('S4C NoteRunTaskResolver (%s)', storage => {
  it('GTN20 resolves a work Run in one readMany and returns goalId/taskId/planRef', async () => {
    const f = await world(storage);
    let reads = 0;
    const records = {
      async readMany(keys: readonly string[]) {
        reads += 1;
        return f.records.readMany(keys);
      },
    } as unknown as GoalRecordTransactionPort;
    const resolve = createNoteRunTaskResolver(records);
    // The expected planRef is the one the public apply returned, not a
    // hand-written identity: the Plan owner derives it from the saved intent.
    expect(await resolve(f.workContext())).toEqual({
      status: 'ready', value: { goalId: G, taskId: TASK_ID, planRef: f.planRef } });
    expect(reads).toBe(1);
  });

  describe('rejects: an unsupported Run is refused and the real world is unchanged', () => {
    it('GTN21 a non-work principal is unavailable', async () => {
      const f = await world(storage);
      // Public read before the refusal: the real claimed Run.
      const before = await f.platform.executions.readExecution(f.hostContext(), f.runRef);
      expect(before).toMatchObject({ status: 'ready', value: { run: { ref: { ...f.runRef } } } });
      expect(await createNoteRunTaskResolver(f.records)(f.hostContext()))
        .toEqual({ status: 'rejected', code: 'unavailable', reason: 'the caller is not a work Run' });
      // The same public read after the refusal returns the whole execution unchanged.
      expect(await f.platform.executions.readExecution(f.hostContext(), f.runRef)).toEqual(before);
    });

    it('GTN21 a missing Run is unavailable', async () => {
      const f = await world(storage);
      const missing: RunRef = { aggregateType: 'Run', projectId: P, goalId: G, runId: 'missing-run' };
      const context = workContext(missing, f.roleBinding);
      // Public read before the refusal: the real claimed Run.
      const before = await f.platform.executions.readExecution(f.hostContext(), f.runRef);
      expect(before).toMatchObject({ status: 'ready', value: { run: { ref: { ...f.runRef } } } });
      expect(await createNoteRunTaskResolver(f.records)(context))
        .toEqual({ status: 'rejected', code: 'unavailable', reason: 'the caller Run is missing' });
      // Public reads after: the missing identity is still absent, and the same
      // read of the real Run returns the whole execution unchanged.
      expect(await f.platform.executions.readExecution(f.hostContext(), missing))
        .toMatchObject({ status: 'not_found' });
      expect(await f.platform.executions.readExecution(f.hostContext(), f.runRef)).toEqual(before);
    });
  });
});
