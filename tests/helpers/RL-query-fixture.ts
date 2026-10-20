/**
 * RE2 Query fixture: the real `createTargetPlatform` with a trusted Query Host
 * binding, one claimed QueryRun and a real Session. It is the Query arm of the
 * RE2 rows (RL-31); the Kernel `ProcessSandbox` is swapped by the test file.
 * Rows: RL-31 (and reused by the wiring row RL-34 if needed).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestOf, createScriptedModel, type ScriptedReply, type ScriptedModel } from './B2-runtime-fixture.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { QueryJobIntentV1, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

const RL_QUERY_AT = '2026-09-26T00:00:00.000Z';
const RL_Q_PROJECT_ID = 'rl-query-project';
const RL_Q_WORKSPACE_ID = 'rl-query-workspace';
const RL_Q_SCOPE = { projectId: RL_Q_PROJECT_ID, workspaceId: RL_Q_WORKSPACE_ID };
const RL_Q_HOST = { kind: 'human' as const, id: 'rl-query-operator' };
const RL_Q_PROJECT_REF = { aggregateType: 'Project' as const, projectId: RL_Q_PROJECT_ID };
const RL_Q_WORKSPACE_REF = { aggregateType: 'Workspace' as const, projectId: RL_Q_PROJECT_ID, workspaceId: RL_Q_WORKSPACE_ID };
const RL_Q_GOAL_REF = { aggregateType: 'Goal' as const, projectId: RL_Q_PROJECT_ID, goalId: 'rl-query-goal' };
const RL_Q_JOB_REF = { aggregateType: 'QueryJob' as const, projectId: RL_Q_PROJECT_ID, workspaceId: RL_Q_WORKSPACE_ID, queryJobId: 'rl-query-job' };
const RL_Q_RUN_REF: QueryRunRef = { aggregateType: 'QueryRun', projectId: RL_Q_PROJECT_ID,
  workspaceId: RL_Q_WORKSPACE_ID, queryJobId: 'rl-query-job', runId: 'rl-query-run' };
const RL_Q_ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'advisor', templateRevision: '1' };
const RL_Q_ROLE_BINDING = { schemaVersion: 1 as const, bindingId: 'rl-query-binding', templateId: 'advisor',
  templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const RL_Q_RUNTIME_BUDGET: RuntimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const INSTRUCTION = 'RL query trusted guidance';
const SKILL_ROOT = join(import.meta.dirname, '../../resources/skills');

export function rlQueryHostCtx(signal: AbortSignal = new AbortController().signal): CoreCallContext {
  return { projectId: RL_Q_PROJECT_ID, workspaceId: RL_Q_WORKSPACE_ID, principal: { kind: 'host', actor: RL_Q_HOST },
    materialReader: { kind: 'host', projectId: RL_Q_PROJECT_ID, workspaceId: RL_Q_WORKSPACE_ID, actor: RL_Q_HOST }, signal };
}

type QueryState = { revision: number | null; authReads: number; revisionFor: (read: number) => string; allowWholeWorkspace: boolean };

export type RLQueryFixture = {
  platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  scripted: ScriptedModel;
  state: QueryState;
  directory: string;
  run(signal?: AbortSignal): Promise<{ started: unknown; observed: { session: { ref: unknown } } }>;
  close(): Promise<void>;
};

type RLQueryFixtureOptions = {
  replies: readonly ScriptedReply[];
  tools?: readonly string[];
  writeScope?: readonly string[];
  readonlyCommandAccess?: boolean;
  allowWholeWorkspace?: boolean;
  revisionFor?: (read: number) => string;
  processSandboxOptions?: { readOnlyPaths?: string[]; executablePath?: string };
  /** L13 wiring: the platform-root resource-cap source the Runtime must read. */
  resourceCaps?: import('../../vendor/coding-agent/dist/public-api.js').ResourceCapSource;
};

export async function createRLQueryFixture(options: RLQueryFixtureOptions): Promise<RLQueryFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'next-rl-query-'));
  await mkdir(join(directory, 'src'), { recursive: true });
  await writeFile(join(directory, 'src', 'module.ts'), 'export const rlQueryMarker = "RL_QUERY";\n');
  const state: QueryState = { revision: null, authReads: 0,
    revisionFor: options.revisionFor ?? (() => 'rl-read-1'), allowWholeWorkspace: options.allowWholeWorkspace ?? true };
  const scripted = createScriptedModel(options.replies);
  const host: RuntimeHostBindings = {
    async resolveConfiguration() { return { status: 'rejected', code: 'unsupported', reason: 'this chain never runs Work execution' }; },
    async resolveQueryConfiguration() {
      return { status: 'ready', value: {
        configurationRevision: 'rl-query-host@1',
        model: { configuration: { revision: 'rl-query-host@1', provider: 'deepseek', model: 'rl-query-scripted', baseUrl: 'http://127.0.0.1' },
          client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'rl-fixture-counter' }) } },
        budget: RL_Q_RUNTIME_BUDGET,
        tools: [...(options.tools ?? ['read', 'run_readonly_command'])],
        writeScope: [...(options.writeScope ?? [])],
        skills: { resourceRoot: SKILL_ROOT, enabledIds: ['platform-work'] },
        systemInstruction: INSTRUCTION,
        hostTemplate: { templateId: 'advisor', revision: '1', digest: digestOf(INSTRUCTION) },
        deniedPrefixes: [], processSandboxOptions: structuredClone(options.processSandboxOptions ?? {}), materialBasis: null,
        ...((options.readonlyCommandAccess ?? true) ? { readonlyCommandAccess: 'all_except_denied' as const } : {}),
      } };
    },
  };
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite' as const, directory },
    workspace: workspaceBindings(state, directory),
    sourcePolicyFor: async () => ({ root: directory, permissionRevision: 'rl-read-1', allowsRead: () => true }),
    runtime: host,
    kernelStores: { entries: [{ adapterId: 'rl-query-kernel', storeKey: 'rl-query-kernel-store', workspace: RL_Q_SCOPE,
      databasePath: join(directory, 'kernel.sqlite') }] },
    now: () => RL_QUERY_AT,
    ...(options.resourceCaps === undefined ? {} : { resourceCaps: options.resourceCaps }),
  });
  await bootstrap(platform, state);
  return {
    platform, scripted, state, directory,
    async run(signal) {
      return await runQuery(platform, state, signal);
    },
    async close() {
      await platform.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function workspaceBindings(state: QueryState, directory: string): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== RL_Q_PROJECT_ID || requested.workspaceId !== RL_Q_WORKSPACE_ID || state.revision === null) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: state.revision } };
    },
    async authorize() {
      state.authReads += 1;
      return { status: 'ready', value: { subjectKey: 'rl-query-host', permissionRevision: state.revisionFor(state.authReads),
        allowsRead: () => state.allowWholeWorkspace } };
    },
  };
}

async function bootstrap(platform: Awaited<ReturnType<typeof createTargetPlatform>>, state: QueryState): Promise<void> {
  await platform.projects.createProject(rlQueryHostCtx(), { meta: { requestId: 'rl-project-1', expected: [{ ref: RL_Q_PROJECT_REF, revision: 0 }] }, input: { projectId: RL_Q_PROJECT_ID } });
  const registered = await platform.projects.registerWorkspace(rlQueryHostCtx(), { meta: { requestId: 'rl-workspace-1', expected: [
    { ref: RL_Q_PROJECT_REF, revision: 1 }, { ref: RL_Q_WORKSPACE_REF, revision: 0 }] }, input: { workspace: RL_Q_SCOPE } });
  if (registered.status !== 'committed') throw new Error('RL query workspace registration failed');
  state.revision = registered.value.revision;
  await platform.goals.createGoal(rlQueryHostCtx(), { meta: { requestId: 'rl-goal-1', expected: [
    { ref: RL_Q_PROJECT_REF, revision: 1 }, { ref: RL_Q_WORKSPACE_REF, revision: 1 }] },
    input: { goalId: RL_Q_GOAL_REF.goalId, workspace: RL_Q_SCOPE, objective: 'Answer one RL reading question' } });
}

function coordinationIntent(): QueryJobIntentV1 {
  return {
    schemaVersion: 1, intentId: RL_Q_JOB_REF.queryJobId, projectId: RL_Q_PROJECT_ID, workspaceId: RL_Q_WORKSPACE_ID,
    goalId: RL_Q_GOAL_REF.goalId, question: 'Read the workspace and answer', focusTaskRefs: [],
    budget: { maxTokens: 200000, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: 'rl-query-corr',
    execution: { kind: 'initial_coordination', roleBinding: RL_Q_ROLE_BINDING, runtimeBudget: RL_Q_RUNTIME_BUDGET },
  };
}

async function runQuery(
  platform: Awaited<ReturnType<typeof createTargetPlatform>>,
  state: QueryState,
  signal?: AbortSignal,
): Promise<{ started: unknown; observed: { session: { ref: unknown } } }> {
  await platform.queries.submitQueryJob(rlQueryHostCtx(signal), { meta: { requestId: 'rl-submit-1', expected: [
    { ref: RL_Q_PROJECT_REF, revision: 1 }, { ref: RL_Q_WORKSPACE_REF, revision: 1 }, { ref: RL_Q_GOAL_REF, revision: 1 },
    { ref: RL_Q_JOB_REF, revision: 0 }, { ref: RL_Q_RUN_REF, revision: 0 }] },
    input: { queryJobId: RL_Q_JOB_REF.queryJobId, runId: RL_Q_RUN_REF.runId, intent: coordinationIntent() } });
  const created = await platform.runtime.createSession(rlQueryHostCtx(signal), { workspace: RL_Q_SCOPE, role: RL_Q_ROLE,
    recommendedRefs: [], initialLinks: [], meta: { requestId: 'rl-session-1', expected: [] } });
  if (created.status !== 'completed') throw new Error('RL query Session creation did not complete');
  const session = created.value.ref;
  const claim = await platform.queries.claimQuery(rlQueryHostCtx(signal), { meta: { requestId: 'rl-claim-1', expected: [
    { ref: RL_Q_JOB_REF, revision: 1 }, { ref: RL_Q_RUN_REF, revision: 1 }, { ref: session, revision: created.value.revision }] },
    input: { queryRunRef: RL_Q_RUN_REF, sessionRef: session } });
  if (claim.status !== 'committed') throw new Error('RL query claim did not commit: ' + JSON.stringify(claim));
  const prepared = await platform.runtime.prepareQuery(rlQueryHostCtx(signal), { queryRunRef: RL_Q_RUN_REF, requestId: 'rl-prepare-1' });
  if (prepared.status !== 'ready') throw new Error('RL query preparation did not become ready: ' + JSON.stringify(prepared));
  const started = await platform.runtime.startQuery(rlQueryHostCtx(signal), { prepared: prepared.value, consumerId: 'rl-consumer', requestId: 'rl-start-1' });
  if (started.status !== 'ready') throw new Error('RL query start did not become ready: ' + JSON.stringify(started));
  const observed = await platform.runtime.observeQuery(rlQueryHostCtx(), { queryRunRef: RL_Q_RUN_REF });
  if (observed.status !== 'ready') throw new Error('RL query observation did not become ready: ' + JSON.stringify(observed));
  return { started: started.value, observed: observed.value as { session: { ref: unknown } } };
}
