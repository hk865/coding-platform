/**
 * AG2b Stage-1 continuous-communication fixture.
 *
 * It reuses the R6 execution-entry Host pattern (a real `loadWorkbenchCliConfig`
 * startup file, a real SQLite ledger + Kernel store and a controlled Kernel
 * provider with the repository vendor Skill root and the real instruction
 * digest) and the R5c workflow bootstrap over the public HTTP routes. The AG1
 * formal work-link is created by the REAL `sessions/create` writer through its
 * `initialLinks` input, so B is discoverable from A's Task without any direct
 * record write.
 *
 * Stage 1 publishes no driver route; the scenarios' FIRST red is therefore the
 * real HTTP `404 unpublished core route workflow/driver-start` (or
 * `workflow/driver-read`), never an import/type failure or a wrong Host.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import { loadWorkbenchCliConfig } from '../../src/app/main.js';
import { ProviderRegistry, type ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { createScriptedModel, type ScriptedReply } from './B2-runtime-fixture.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import {
  BOOTSTRAP_SUFFIX,
  CORE_API_PREFIX,
  PLATFORM_TOKEN_HEADER,
  PLATFORM_TOKEN_META_NAME,
  type BootstrapResponse,
  type CoreScope,
  type CreateSessionRequest,
  type OperationReceipt,
  type PreparedQueryExecution,
  type QueryExecutionRecord,
  type QueryJobRef,
  type QueryRunRef,
  type SessionCard,
  type SessionMessage,
  type SessionPage,
  type SessionRecord,
  type SessionRef,
  type WorkbenchActor,
} from '../../src/app/core-http-types.js';

export const AG2B_AT = '2026-09-28T00:00:00.000Z';
export const AG2B_SCOPE: CoreScope = { projectId: 'ag2b-collab-project', workspaceId: 'ag2b-collab-workspace' };
export const AG2B_PROJECT_REF = { aggregateType: 'Project' as const, projectId: AG2B_SCOPE.projectId };
export const AG2B_WORKSPACE_REF = { aggregateType: 'Workspace' as const, ...AG2B_SCOPE };
export const AG2B_GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal' };
export const AG2B_POLICY_REF = { aggregateType: 'CompletionPolicyRevision' as const, projectId: AG2B_SCOPE.projectId,
  policyId: 'ag2b-policy', revision: 1 };
export const AG2B_POLICY_ACTIVE_REF = { aggregateType: 'ProjectCompletionPolicyActive' as const,
  projectId: AG2B_SCOPE.projectId };
export const AG2B_WORK_TASK_ID = 'ag2b-work';
export const AG2B_GATE_TASK_ID = 'ag2b-gate';

export const AG2B_WORK_ROLE = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
export const AG2B_QUERY_ROLE = { kind: 'legacy_template' as const, templateId: 'advisor', templateRevision: '1' };
export const AG2B_WORK_ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'ag2b-work-binding', templateId: 'builder', templateRevision: '1',
  bindingVersion: 1, policyRevision: 'legacy-template',
};
export const AG2B_QUERY_ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'ag2b-query-binding', templateId: 'advisor', templateRevision: '1',
  bindingVersion: 1, policyRevision: 'legacy-template',
};
export const AG2B_CONSUMER_ID = 'ag2b-consumer';
export const AG2B_QUERY_PROFILE_ID = 'ag2b-consult';
export const AG2B_WORK_INSTRUCTION = 'AG2b trusted work instruction: consult then write through the real tools';
export const AG2B_QUERY_INSTRUCTION = 'AG2b trusted read-only consultation guidance';

export const AG2B_RUNTIME_BUDGET: RuntimeBudget = {
  contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 16,
  maxToolCalls: 16, timeoutMs: 60000, perResponseTokens: 512,
};
export const AG2B_QUERY_BUDGET = { maxTokens: 200000, deadline: null };
export const AG2B_SECRET_VAR = 'AG2B_CONTROLLED_SECRET';
export const AG2B_SECRET_VALUE = 'ag2b-controlled-secret-value';
export const AG2B_RESULT_FILE = 'src/ag2b-result.txt';
export const AG2B_RESULT_TEXT = 'AG2B_RESULT_FROM_A';

/** A read-only registered check proves the actual artifact. It never changes
 * the source snapshot it is checking; missing/mismatched output fails. */
const AG2B_CHECK_COMMAND = `node -e "const fs=require('node:fs');const text=fs.readFileSync('${AG2B_RESULT_FILE}','utf8');if(text.trim()!=='${AG2B_RESULT_TEXT}'){process.exit(3)}console.log('AG2B_CHECK_OK')"`;

const temporary: string[] = [];

/** Remove every Host workspace/database/config directory this fixture created. */
export async function cleanupAG2b(): Promise<void> {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
}

/** The exact Host permission generation (see `host.ts`); the checks configuration
 * must bind the same revision the live Host authorization returns. */
export function permissionRevision(actor: WorkbenchActor, scope: CoreScope, readPrefixes: readonly string[]): string {
  const material = JSON.stringify({
    subject: { kind: actor.kind, id: actor.id },
    scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
    readPrefixes: [...new Set(readPrefixes)].sort(),
  });
  return `host-permission-v1:${createHash('sha256').update(material).digest('hex')}`;
}

export type AG2bHost = {
  host: LocalWorkbenchHost;
  base: string;
  token: string;
  root: string;
  database: string;
  publicDir: string;
  actor: WorkbenchActor;
  scripted: ReturnType<typeof createScriptedModel>;
  /** The query/advisor model used by the derived child A′ and busy Queries. */
  queryScripted: ReturnType<typeof createScriptedModel>;
};

export type AG2bOverrides = {
  builderQueryProfile?: boolean;
  hostOptions?: Pick<import('../../src/app/host.js').LocalWorkbenchHostOptions, 'attention' | 'inputConsumers'>;
  root?: string;
  database?: string;
  replies?: readonly ScriptedReply[];
  beforeReply?: (request: ModelRequest, index: number, signal: AbortSignal) => Promise<void>;
  queryReplies?: readonly ScriptedReply[];
  queryBeforeReply?: (request: ModelRequest, index: number, signal: AbortSignal) => Promise<void>;
  checkCommand?: string;
};

/** One real Host over the CLI startup file, a real SQLite ledger/Kernel and a
 * controlled Kernel provider. The vendor Skill root and the real instruction
 * digests are trusted startup facts; nothing here is request input. */
export async function startAG2bHost(publicDir: string, overrides: AG2bOverrides = {}): Promise<AG2bHost> {
  const root = overrides.root ?? await mkdtemp(join(tmpdir(), 'ag2b-collab-ws-'));
  const database = overrides.database ?? await mkdtemp(join(tmpdir(), 'ag2b-collab-db-'));
  const configDir = await mkdtemp(join(tmpdir(), 'ag2b-collab-config-'));
  if (overrides.root === undefined) temporary.push(root);
  if (overrides.database === undefined) temporary.push(database);
  temporary.push(configDir);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'module.ts'), 'export const ag2bMarker = "AG2B_ISOLATED_SOURCE";\n');
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['src/**/*.ts'],
  }));
  const skillsRoot = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
  const actor: WorkbenchActor = { kind: 'human', id: 'ag2b-operator' };
  const scripted = createScriptedModel(overrides.replies ?? [], overrides.beforeReply);
  const queryScripted = createScriptedModel(overrides.queryReplies ?? [], overrides.queryBeforeReply);
  const registry = new ProviderRegistry().register({
    id: 'deepseek', secretEnvironmentVariable: AG2B_SECRET_VAR, defaultBaseUrl: 'https://invalid.test',
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: context => context.model.includes('scripted-query') ? queryScripted.client : scripted.client,
  });
  const runtime: WorkbenchRuntimeConfiguration = {
    schemaVersion: 1,
    bindings: [
      {
        id: 'ag2b-work-binding', label: 'AG2b work runtime', scope: AG2B_SCOPE, role: AG2B_WORK_ROLE,
        configurationRevision: 'ag2b-work-host@1',
        model: { revision: 'ag2b-work-model@1', provider: 'deepseek', model: 'ag2b-scripted-work', secretEnvironmentVariable: AG2B_SECRET_VAR },
        grant: {
          budget: AG2B_RUNTIME_BUDGET,
          hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex(AG2B_WORK_INSTRUCTION) },
          tools: ['read', 'write', 'find_related_sessions', 'read_session_card', 'send_session_message'],
          writeScope: ['.'], skills: { resourceRoot: skillsRoot, enabledIds: [] },
          systemInstruction: AG2B_WORK_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
        },
      },
      {
        id: 'ag2b-query-binding', label: 'AG2b query runtime', scope: AG2B_SCOPE, role: AG2B_QUERY_ROLE,
        configurationRevision: 'ag2b-query-host@1',
        model: { revision: 'ag2b-query-model@1', provider: 'deepseek', model: 'ag2b-scripted-query', secretEnvironmentVariable: AG2B_SECRET_VAR },
        grant: {
          budget: AG2B_RUNTIME_BUDGET,
          hostTemplate: { templateId: 'advisor', revision: '1', digest: sha256Hex(AG2B_QUERY_INSTRUCTION) },
          tools: ['read', 'project_source'], writeScope: [], skills: { resourceRoot: skillsRoot, enabledIds: [] },
          systemInstruction: AG2B_QUERY_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
        },
      },
    ],
    queryProfiles: [{
      id: AG2B_QUERY_PROFILE_ID, label: 'AG2b read-only consultation', scope: AG2B_SCOPE,
      runtimeBindingId: 'ag2b-query-binding', sessionRole: AG2B_QUERY_ROLE, roleBinding: AG2B_QUERY_ROLE_BINDING,
      runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
    }],
  };
  if (overrides.builderQueryProfile) runtime.queryProfiles.push({
    id: 'ag2b-builder-query', label: 'Builder read-only continuation', scope: AG2B_SCOPE,
    runtimeBindingId: 'ag2b-work-binding', sessionRole: AG2B_WORK_ROLE, roleBinding: AG2B_WORK_ROLE_BINDING,
    runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
  });
  const workflow: WorkflowHostConfiguration = {
    consumerId: AG2B_CONSUMER_ID,
    bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE, roleBinding: AG2B_WORK_ROLE_BINDING,
      budget: { tokenBudget: 1000000, deadline: null } }],
  };
  const checks: TrustedCheckConfiguration = {
    configurationRevision: 'ag2b-checks@1', workspace: AG2B_WORKSPACE_REF, executor: actor,
    permissionRevision: permissionRevision(actor, AG2B_SCOPE, ['.']),
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 'ag2b-static', kind: 'static', command: overrides.checkCommand ?? AG2B_CHECK_COMMAND,
      cwd: '.', timeoutMs: 30000, taskIds: 'all' }],
  };
  const configPath = join(configDir, 'workbench.json');
  await writeFile(configPath, JSON.stringify({
    sqliteDirectory: database,
    actor,
    workspaces: [{ scope: AG2B_SCOPE, name: 'AG2b isolated project', root, workspaceRevision: 1, readPrefixes: ['.'] }],
    architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    kernelStores: { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE,
      databasePath: join(database, 'kernel.sqlite') }] },
    runtime,
    workflow,
    checks,
  }));
  const loaded = await loadWorkbenchCliConfig(configPath);
  const host = await createLocalWorkbenchHost({
    ...loaded,
    ...overrides.hostOptions,
    publicDir,
    now: () => AG2B_AT,
    runtimeProvider: { registry, secretSource: { get: (name: string) => name === AG2B_SECRET_VAR ? AG2B_SECRET_VALUE : undefined } },
  });
  const address = await host.listen();
  const token = await readPageToken(address.url);
  return { host, base: address.url, token, root, database, publicDir, actor, scripted, queryScripted };
}

export async function readPageToken(base: string): Promise<string> {
  const response = await fetch(base);
  if (response.status !== 200) throw new Error(`the workbench page did not load: ${response.status}`);
  const html = await response.text();
  const match = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(html);
  if (match?.[1] === undefined) throw new Error('the page did not expose the runtime token meta');
  return match[1];
}

export const coreUrl = (base: string, suffix: string): string => new URL(CORE_API_PREFIX + suffix, base).toString();

export async function coreGet(base: string, suffix: string, token: string): Promise<Response> {
  return fetch(coreUrl(base, suffix), { headers: { [PLATFORM_TOKEN_HEADER]: token } });
}

export async function corePost(base: string, suffix: string, token: string | undefined, body: unknown): Promise<Response> {
  return fetch(coreUrl(base, suffix), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { [PLATFORM_TOKEN_HEADER]: token }) },
    body: JSON.stringify(body),
  });
}

export const graphWrite = (scope: CoreScope, input: unknown, requestId: string, expected: unknown[] = []) =>
  ({ scope, request: { input, meta: { requestId, expected } } });
export const plain = (scope: CoreScope, input: unknown) => ({ scope, input });

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};

/** The frozen R5c graph relationship seed over the real HTTP routes: project,
 * workspace, completion policy, initial architecture, Goal and an adopted Plan
 * with one ordinary work plus the Goal gate. */
export async function seedAG2bWorkGraph(host: AG2bHost, workIds: readonly string[] = [AG2B_WORK_TASK_ID]): Promise<{ workTarget: WorkLinkTarget; goalRef: GoalRef }> {
  const post = (suffix: string, body: unknown) => corePost(host.base, suffix, host.token, body);
  const committed = async (response: Response): Promise<unknown> => {
    const body = await response.json() as unknown;
    if (asRecord(body)['status'] !== 'committed') {
      throw new Error(`the formal seed write did not commit: ${JSON.stringify(body)}`);
    }
    return asRecord(body)['value'];
  };
  await committed(await post('projects/create', graphWrite(AG2B_SCOPE, { projectId: AG2B_SCOPE.projectId },
    'ag2b-project', [{ ref: AG2B_PROJECT_REF, revision: 0 }])));
  await committed(await post('workspaces/register', graphWrite(AG2B_SCOPE, { workspace: AG2B_SCOPE },
    'ag2b-workspace', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 0 }])));
  const installed = await committed(await post('completion-policies/install', graphWrite(AG2B_SCOPE, {
    policyId: 'ag2b-policy', contentRevision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 },
  }, 'ag2b-policy-install', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_POLICY_REF, revision: 0 }]))) as Record<string, unknown>;
  await committed(await post('completion-policies/activate', graphWrite(AG2B_SCOPE, {
    target: { ref: asRecord(installed)['ref'], digest: asRecord(installed)['contentDigest'] },
  }, 'ag2b-policy-activate', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_POLICY_ACTIVE_REF, revision: 0 }])));
  await committed(await post('architecture/adopt-initial', graphWrite(AG2B_SCOPE, {
    baselineId: 'ag2b-baseline', description: 'AG2b isolated module boundary', constraints: [],
    catalog: { requireDag: true, dependencies: [], modules: [{ ref: { projectId: AG2B_SCOPE.projectId, moduleId: 'ag2b-work' },
      name: 'AG2b work', responsibility: 'Consult then write the isolated project', paths: ['src'], interfaces: [] }] },
  }, 'ag2b-architecture', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 }])));
  await committed(await post('goals/create', graphWrite(AG2B_SCOPE, {
    goalId: AG2B_GOAL_REF.goalId, workspace: AG2B_SCOPE, objective: 'Deliver the AG2b continuous communication closure',
  }, 'ag2b-goal', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 }])));
  const draft = {
    schemaVersion: 2, planId: 'ag2b-plan', planRevision: 1, goalId: AG2B_GOAL_REF.goalId, stages: [],
    tasks: [
      ...workIds.map(taskId => ({ taskId, title: `Independent work ${taskId}`, requirementLevel: 'required',
        taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' })),
      { taskId: AG2B_GATE_TASK_ID, title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: workIds.map(taskId => ({ taskId, role: 'builder', instruction: `Perform independent work ${taskId}` })),
    obligations: [{ obligationId: 'ag2b-obligation', title: 'Deliver the AG2b work', requirementLevel: 'required',
      taskIds: [...workIds, AG2B_GATE_TASK_ID],
      verificationRequirements: [{ requirementId: 'ag2b-static', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
  const proposed = await committed(await post('plans/propose', graphWrite(AG2B_SCOPE, {
    goalRef: AG2B_GOAL_REF, basedOn: null, draft, reason: { text: 'AG2b initial plan', sources: [] },
  }, 'ag2b-plan-propose', []))) as Record<string, unknown>;
  await committed(await post('plans/apply', graphWrite(AG2B_SCOPE, {
    proposalRef: asRecord(proposed)['ref'], expectedProposalRevision: asRecord(proposed)['revision'], decisionRefs: [],
  }, 'ag2b-plan-apply', [])));
  return {
    workTarget: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: AG2B_WORK_TASK_ID } },
    goalRef: AG2B_GOAL_REF,
  };
}

export type AG2bSession = { sessionRef: SessionRef; sessionAggregateRef: SessionRef; revision: number };

/** Create one real Session through the HTTP route, optionally joining the real
 * AG1 work-link to the seeded Task in the SAME formal writer call. */
export async function createAG2bSession(
  host: AG2bHost, requestId: string, role = AG2B_QUERY_ROLE,
  initialLinks: CreateSessionRequest['initialLinks'] = [],
): Promise<AG2bSession> {
  const response = await corePost(host.base, 'sessions/create', host.token, plain(AG2B_SCOPE, {
    workspace: AG2B_SCOPE, role, recommendedRefs: [], initialLinks, meta: { requestId, expected: [] },
  } satisfies CreateSessionRequest));
  if (response.status !== 200) throw new Error(`Session creation failed with ${response.status}`);
  const body = await response.json() as OperationReceipt<SessionRecord>;
  if (body.status !== 'completed') throw new Error(`Session creation did not complete: ${JSON.stringify(body)}`);
  const sessionRef: SessionRef = { projectId: body.value.ref.projectId, sessionId: body.value.ref.sessionId };
  return { sessionRef, sessionAggregateRef: body.value.ref, revision: body.value.revision };
}

export async function listSessions(host: AG2bHost): Promise<SessionCard[]> {
  const response = await corePost(host.base, 'sessions/find', host.token,
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, includeArchived: true, page: { limit: 50 } }));
  const body = await response.json() as ReadResult<SessionPage<SessionCard>>;
  if (body.status !== 'ready') throw new Error(`Session directory read was not ready: ${JSON.stringify(body)}`);
  return body.value.items;
}

export async function sessionCount(host: AG2bHost): Promise<number> {
  return (await listSessions(host)).length;
}

export async function readBootstrap(host: AG2bHost): Promise<BootstrapResponse> {
  const response = await coreGet(host.base, BOOTSTRAP_SUFFIX, host.token);
  if (response.status !== 200) throw new Error(`bootstrap failed with ${response.status}`);
  return await response.json() as BootstrapResponse;
}

export type AG2bQueryRefs = { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef };

/**
 * Occupy B through the real formal Query writer: submit a pending semantic
 * Query and claim it onto the Session. Nothing here rewrites storage or invents
 * an occupancy. Returns the deterministic refs the caller can later drive to a
 * settled answer.
 */
export async function claimBusyQuery(host: AG2bHost, session: AG2bSession, suffix: string): Promise<AG2bQueryRefs> {
  const goalReadResponse = await corePost(host.base, 'goals/read', host.token, plain(AG2B_SCOPE, AG2B_GOAL_REF));
  const goalRead = await goalReadResponse.json() as ReadResult<{ goal: { revision: number } }>;
  if (goalRead.status !== 'ready') throw new Error('the seeded Goal was not readable for the busy Query');
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', ...AG2B_SCOPE, queryJobId: `ag2b-busy-job-${suffix}` };
  const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', ...AG2B_SCOPE,
    queryJobId: queryJobRef.queryJobId, runId: `ag2b-busy-run-${suffix}` };
  const intent = {
    schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId: AG2B_SCOPE.projectId, workspaceId: AG2B_SCOPE.workspaceId,
    goalId: AG2B_GOAL_REF.goalId, question: `AG2b busy release query ${suffix}`, focusTaskRefs: [], budget: AG2B_QUERY_BUDGET,
    multiTurn: { maxRounds: 1 }, correlationId: `ag2b-busy-corr-${suffix}`,
    execution: { kind: 'semantic_query', roleBinding: AG2B_QUERY_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET },
  };
  const submitted = await corePost(host.base, 'queries/submit', host.token, graphWrite(AG2B_SCOPE, {
    queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent,
  }, `ag2b-busy-submit-${suffix}`, [
    { ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 },
    { ref: AG2B_GOAL_REF, revision: goalRead.value.goal.revision },
    { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 },
  ]));
  const submittedBody = await submitted.json() as unknown;
  if (asRecord(submittedBody)['status'] !== 'committed') {
    throw new Error(`the busy Query submit did not commit: ${JSON.stringify(submittedBody)}`);
  }
  const claimed = await corePost(host.base, 'queries/claim', host.token, graphWrite(AG2B_SCOPE, {
    queryRunRef, sessionRef: session.sessionAggregateRef,
  }, `ag2b-busy-claim-${suffix}`, [
    { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
    { ref: session.sessionAggregateRef, revision: session.revision },
  ]));
  const claimedBody = await claimed.json() as unknown;
  if (asRecord(claimedBody)['status'] !== 'committed') {
    throw new Error(`the busy Query claim did not commit: ${JSON.stringify(claimedBody)}`);
  }
  return { queryJobRef, queryRunRef };
}

/** Drive the already-claimed Query to its real settled answer through the
 * existing public prepare/start routes; completing it releases the occupancy. */
export async function startBusyQuery(host: AG2bHost, refs: AG2bQueryRefs, suffix: string): Promise<QueryExecutionRecord> {
  const preparedResponse = await corePost(host.base, 'queries/prepare', host.token,
    plain(AG2B_SCOPE, { queryRunRef: refs.queryRunRef, requestId: `ag2b-busy-prepare-${suffix}` }));
  const prepared = await preparedResponse.json() as ReadResult<PreparedQueryExecution>;
  if (prepared.status !== 'ready') throw new Error(`the busy Query prepare was not ready: ${JSON.stringify(prepared)}`);
  const startedResponse = await corePost(host.base, 'queries/start', host.token,
    plain(AG2B_SCOPE, { prepared: prepared.value, consumerId: AG2B_CONSUMER_ID, requestId: `ag2b-busy-start-${suffix}` }));
  const started = await startedResponse.json() as ReadResult<QueryExecutionRecord>;
  if (started.status !== 'ready') throw new Error(`the busy Query start was not ready: ${JSON.stringify(started)}`);
  return started.value;
}

/** One real Graph `messages/send` used to prove durable, non-waking mail. */
export async function sendPlainNotify(host: AG2bHost, recipient: SessionRef, text: string, requestId: string): Promise<WriteResult<SessionMessage>> {
  const response = await corePost(host.base, 'messages/send', host.token,
    graphWrite(AG2B_SCOPE, { recipient, text }, requestId, []));
  return await response.json() as WriteResult<SessionMessage>;
}

/** A tiny deterministic value hash used by callers that assert real identities. */
export function ag2bJson(value: unknown): string {
  return canonicalJson(value as never);
}
