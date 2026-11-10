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
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import { loadWorkbenchCliConfig } from '../../src/app/main.js';
import { ProviderRegistry, type ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { createScriptedModel, type ScriptedReply } from './B2-runtime-fixture.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import type { WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import { ROLE_LINE_STEP_KEYS } from '../../src/core/work-graph/state/role-line-action.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import {
  BOOTSTRAP_SUFFIX,
  CORE_API_PREFIX,
  PLATFORM_TOKEN_HEADER,
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
import { PLATFORM_TOKEN_META_NAME } from './host-page.js';
import { hostReconcile, rememberHostStore } from './KLS1B-host-store.js';

export const AG2B_AT = '2026-09-28T00:00:00.000Z';
export const AG2B_SCOPE: CoreScope = { projectId: 'ag2b-collab-project', workspaceId: 'ag2b-collab-workspace' };
export const AG2B_PROJECT_REF = { aggregateType: 'Project' as const, projectId: AG2B_SCOPE.projectId };
export const AG2B_WORKSPACE_REF = { aggregateType: 'Workspace' as const, ...AG2B_SCOPE };
export const AG2B_GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: AG2B_SCOPE.projectId, goalId: 'ag2b-goal' };
const AG2B_POLICY_REF = { aggregateType: 'CompletionPolicyRevision' as const, projectId: AG2B_SCOPE.projectId,
  policyId: 'ag2b-policy', revision: 1 };
const AG2B_POLICY_ACTIVE_REF = { aggregateType: 'ProjectCompletionPolicyActive' as const,
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
/** The platform secretary template (the opening secretary line's role, O1b) and its Query profile's binding;
 *  configured only with `secretaryQueryProfile`. */
const AG2B_SECRETARY_ROLE = platformRoleProfile('secretary').template;
const AG2B_SECRETARY_ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'ag2b-secretary-binding', templateId: AG2B_SECRETARY_ROLE.templateId,
  templateRevision: AG2B_SECRETARY_ROLE.templateRevision, bindingVersion: 1, policyRevision: 'legacy-template',
};
const AG2B_SECRETARY_INSTRUCTION = 'AG2b trusted secretary guidance';

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
export const AG2B_CHECK_COMMAND = `node -e "const fs=require('node:fs');const text=fs.readFileSync('${AG2B_RESULT_FILE}','utf8');if(text.trim()!=='${AG2B_RESULT_TEXT}'){process.exit(3)}console.log('AG2B_CHECK_OK')"`;

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
  /**
   * O4b-1 (BK-15): also configure the platform secretary's binding and Query profile, as the local workbench
   * publishes one per workspace (`src/app/host.ts` `localSecretaryProfile`). Only then is the opening secretary
   * line (O1b) an admitted secretary of the request intake's selection, which the Goal secretary's last fallback
   * reads (`src/core/work-graph/tasks/goal-secretary.ts`): the rework notice's recipient.
   */
  secretaryQueryProfile?: boolean;
  hostOptions?: Pick<import('../../src/app/host.js').LocalWorkbenchHostOptions, 'attention' | 'inputConsumers'>;
  root?: string;
  database?: string;
  replies?: readonly ScriptedReply[];
  beforeReply?: (request: ModelRequest, index: number, signal: AbortSignal) => Promise<void>;
  queryReplies?: readonly ScriptedReply[];
  queryBeforeReply?: (request: ModelRequest, index: number, signal: AbortSignal) => Promise<void>;
  checkCommand?: string;
  /** A.2 step 6: the registered check's timeout (default 30 s), so a scenario can make it time out. */
  checkTimeoutMs?: number;
  /** A.2 step 6: the check configuration revision (default `ag2b-checks@1`); a restart with another check names a new one (LA-4). */
  checkConfigurationRevision?: string;
  /** A.2 step 6: the Host's startup actor (default the human `ag2b-operator`); a `kind:'system'` Host is still an operator. */
  actor?: WorkbenchActor;
  /** A.2 step 5.6: start without the trusted Kernel Store entry (the mapped adapter is then unregistered, `host_config`). */
  noKernelStores?: boolean;
  /** KLS-1b row 03: a second command-line workspace of the same project, after the AG2b one, with its own work and
   * query bindings and query profile (the AG2b ones over its scope). The scenario registers no Workspace record for it. */
  extraWorkspace?: { scope: CoreScope; root: string };
};

/** The isolated project's source files. Only missing files are written, so a Host restarted on the same
 * root (tests/scenarios/harness.ts) keeps what a Run or the test changed there. */
export async function writeAG2bWorkspace(root: string): Promise<void> {
  await mkdir(join(root, 'src'), { recursive: true });
  const files: Array<[string, string]> = [
    [join(root, 'src', 'module.ts'), 'export const ag2bMarker = "AG2B_ISOLATED_SOURCE";\n'],
    [join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['src/**/*.ts'],
    })],
  ];
  for (const [path, text] of files) {
    if (!existsSync(path)) await writeFile(path, text);
  }
}

/** The one registered check configuration (`ag2b-static`, every Task): the Host's startup configuration and the
 * scenario harness's in-process platforms build it here, so every copy is the same object (tests/scenarios/harness.ts). */
export function ag2bChecksConfiguration(options: {
  actor: WorkbenchActor;
  command?: string;
  timeoutMs?: number;
  revision?: string;
  kind?: TrustedCheckConfiguration['checks'][number]['kind'];
}): TrustedCheckConfiguration {
  return {
    configurationRevision: options.revision ?? 'ag2b-checks@1', workspace: AG2B_WORKSPACE_REF, executor: options.actor,
    permissionRevision: permissionRevision(options.actor, AG2B_SCOPE, ['.']),
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: ['.git'],
    checks: [{ checkId: 'ag2b-static', kind: options.kind ?? 'static', command: options.command ?? AG2B_CHECK_COMMAND,
      cwd: '.', timeoutMs: options.timeoutMs ?? 30000, taskIds: 'all' }],
  };
}

export type CliHostOptions = {
  publicDir: string;
  root?: string;
  database?: string;
  /** Prefix for the temporary workspace/database/config directories this constructor creates. */
  tempPrefix: string;
  scope: CoreScope;
  actor: WorkbenchActor;
  at: string;
  workspaceName: string;
  /** Workspace files relative to the root; a file a previous Host changed is kept. */
  files: Readonly<Record<string, string>>;
  readPrefixes: string[];
  bindings: WorkbenchRuntimeConfiguration['bindings'];
  queryProfiles: WorkbenchRuntimeConfiguration['queryProfiles'];
  checks?: TrustedCheckConfiguration;
  workflow: WorkflowHostConfiguration;
  kernelStore?: { adapterId: string; storeKey: string };
  secret: { variable: string; value: string };
  /** Further command-line workspaces after the main one (same read prefixes); their bindings come in `bindings`. */
  extraWorkspaces?: ReadonlyArray<{ scope: CoreScope; name: string; root: string }>;
  /** Which model name routes to the query scripted client (the default mirrors the AG2b fixture). */
  queryModel?: (model: string) => boolean;
  replies?: readonly ScriptedReply[];
  beforeReply?: (request: ModelRequest, index: number, signal: AbortSignal) => Promise<void>;
  queryReplies?: readonly ScriptedReply[];
  queryBeforeReply?: (request: ModelRequest, index: number, signal: AbortSignal) => Promise<void>;
  hostOptions?: Pick<import('../../src/app/host.js').LocalWorkbenchHostOptions, 'attention' | 'inputConsumers'>;
};

/**
 * One real Host over a CLI startup file, a real SQLite ledger/Kernel and a controlled
 * Kernel provider: the shared constructor of the AG2b, AG2-consultation and R6 execution
 * Hosts. Only its public inputs are parameters (scope, bindings/profiles, checks, workspace
 * files and read prefixes); the vendor Skill root and the instruction digests stay trusted
 * startup facts.
 */
export async function startCliHost(options: CliHostOptions): Promise<AG2bHost> {
  const root = options.root ?? await mkdtemp(join(tmpdir(), `${options.tempPrefix}-ws-`));
  const database = options.database ?? await mkdtemp(join(tmpdir(), `${options.tempPrefix}-db-`));
  const configDir = await mkdtemp(join(tmpdir(), `${options.tempPrefix}-config-`));
  if (options.root === undefined) temporary.push(root);
  if (options.database === undefined) temporary.push(database);
  temporary.push(configDir);
  for (const [path, text] of Object.entries(options.files)) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    if (!existsSync(absolute)) await writeFile(absolute, text);
  }
  const scripted = createScriptedModel(options.replies ?? [], options.beforeReply);
  const queryScripted = createScriptedModel(options.queryReplies ?? [], options.queryBeforeReply);
  const isQueryModel = options.queryModel ?? (model => model.includes('scripted-query'));
  const registry = new ProviderRegistry().register({
    id: 'deepseek', secretEnvironmentVariable: options.secret.variable, defaultBaseUrl: 'https://invalid.test',
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: context => isQueryModel(context.model) ? queryScripted.client : scripted.client,
  });
  const runtime: WorkbenchRuntimeConfiguration = {
    schemaVersion: 1, bindings: options.bindings, queryProfiles: options.queryProfiles,
  };
  const configPath = join(configDir, 'workbench.json');
  await writeFile(configPath, JSON.stringify({
    sqliteDirectory: database,
    actor: options.actor,
    workspaces: [{ scope: options.scope, name: options.workspaceName, root, workspaceRevision: 1,
      readPrefixes: options.readPrefixes },
    ...(options.extraWorkspaces ?? []).map(extra => ({ scope: extra.scope, name: extra.name, root: extra.root,
      workspaceRevision: 1, readPrefixes: options.readPrefixes }))],
    architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    ...(options.kernelStore === undefined ? {} : { kernelStores: { entries: [{ adapterId: options.kernelStore.adapterId,
      storeKey: options.kernelStore.storeKey, workspace: options.scope, databasePath: join(database, 'kernel.sqlite') }] } }),
    runtime,
    ...(options.checks === undefined ? {} : { checks: options.checks }),
    workflow: options.workflow,
  }));
  // KLS-1b: the Host keeps this project's store by its location rule; the old readers of `database` follow it.
  await rememberHostStore(database, options.scope.projectId, root);
  const loaded = await loadWorkbenchCliConfig(configPath);
  const host = await createLocalWorkbenchHost({
    ...loaded,
    ...options.hostOptions,
    publicDir: options.publicDir,
    now: () => options.at,
    runtimeProvider: { registry, secretSource: { get: (name: string) => name === options.secret.variable ? options.secret.value : undefined } },
  });
  const address = await host.listen();
  const token = await readPageToken(address.url);
  return { host, base: address.url, token, root, database, publicDir: options.publicDir, actor: options.actor, scripted, queryScripted };
}

/** One real Host over the CLI startup file, a real SQLite ledger/Kernel and a
 * controlled Kernel provider. The vendor Skill root and the real instruction
 * digests are trusted startup facts; nothing here is request input. */
export async function startAG2bHost(publicDir: string, overrides: AG2bOverrides = {}): Promise<AG2bHost> {
  const skillsRoot = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
  const actor: WorkbenchActor = overrides.actor ?? { kind: 'human', id: 'ag2b-operator' };
  const bindings: WorkbenchRuntimeConfiguration['bindings'] = [
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
  ];
  const queryProfiles: WorkbenchRuntimeConfiguration['queryProfiles'] = [{
    id: AG2B_QUERY_PROFILE_ID, label: 'AG2b read-only consultation', scope: AG2B_SCOPE,
    runtimeBindingId: 'ag2b-query-binding', sessionRole: AG2B_QUERY_ROLE, roleBinding: AG2B_QUERY_ROLE_BINDING,
    runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
  }];
  if (overrides.builderQueryProfile) queryProfiles.push({
    id: 'ag2b-builder-query', label: 'Builder read-only continuation', scope: AG2B_SCOPE,
    runtimeBindingId: 'ag2b-work-binding', sessionRole: AG2B_WORK_ROLE, roleBinding: AG2B_WORK_ROLE_BINDING,
    runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
  });
  if (overrides.secretaryQueryProfile) {
    bindings.push({
      id: 'ag2b-secretary-binding', label: 'AG2b secretary runtime', scope: AG2B_SCOPE, role: AG2B_SECRETARY_ROLE,
      configurationRevision: 'ag2b-secretary-host@1',
      model: { revision: 'ag2b-secretary-model@1', provider: 'deepseek', model: 'ag2b-scripted-query', secretEnvironmentVariable: AG2B_SECRET_VAR },
      grant: {
        budget: AG2B_RUNTIME_BUDGET,
        hostTemplate: { templateId: AG2B_SECRETARY_ROLE.templateId, revision: AG2B_SECRETARY_ROLE.templateRevision,
          digest: sha256Hex(AG2B_SECRETARY_INSTRUCTION) },
        tools: ['read'], writeScope: [], skills: { resourceRoot: skillsRoot, enabledIds: [] },
        systemInstruction: AG2B_SECRETARY_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      },
    });
    queryProfiles.push({
      id: 'ag2b-secretary-profile', label: 'AG2b secretary', scope: AG2B_SCOPE,
      runtimeBindingId: 'ag2b-secretary-binding', sessionRole: AG2B_SECRETARY_ROLE, roleBinding: AG2B_SECRETARY_ROLE_BINDING,
      runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
    });
  }
  const extra = overrides.extraWorkspace;
  if (extra !== undefined) {
    for (const binding of bindings.filter(entry => entry.scope === AG2B_SCOPE)) {
      bindings.push({ ...binding, id: `${binding.id}-${extra.scope.workspaceId}`, scope: extra.scope });
    }
    for (const profile of queryProfiles.filter(entry => entry.scope === AG2B_SCOPE)) {
      queryProfiles.push({ ...profile, id: `${profile.id}-${extra.scope.workspaceId}`, scope: extra.scope,
        runtimeBindingId: `${profile.runtimeBindingId}-${extra.scope.workspaceId}` });
    }
  }
  const workflow: WorkflowHostConfiguration = {
    consumerId: AG2B_CONSUMER_ID,
    bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE, roleBinding: AG2B_WORK_ROLE_BINDING,
      budget: { tokenBudget: 1000000, deadline: null } }],
  };
  const checks = ag2bChecksConfiguration({ actor, ...(overrides.checkCommand === undefined ? {} : { command: overrides.checkCommand }),
    ...(overrides.checkTimeoutMs === undefined ? {} : { timeoutMs: overrides.checkTimeoutMs }),
    ...(overrides.checkConfigurationRevision === undefined ? {} : { revision: overrides.checkConfigurationRevision }) });
  return await startCliHost({
    publicDir,
    tempPrefix: 'ag2b-collab',
    ...(overrides.root === undefined ? {} : { root: overrides.root }),
    ...(overrides.database === undefined ? {} : { database: overrides.database }),
    scope: AG2B_SCOPE, actor, at: AG2B_AT, workspaceName: 'AG2b isolated project',
    files: {
      'src/module.ts': 'export const ag2bMarker = "AG2B_ISOLATED_SOURCE";\n',
      'tsconfig.json': JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['src/**/*.ts'],
      }),
    },
    readPrefixes: ['.'], bindings, queryProfiles, checks, workflow,
    ...(overrides.noKernelStores === true ? {} : { kernelStore: { adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store' } }),
    secret: { variable: AG2B_SECRET_VAR, value: AG2B_SECRET_VALUE },
    ...(overrides.replies === undefined ? {} : { replies: overrides.replies }),
    ...(overrides.beforeReply === undefined ? {} : { beforeReply: overrides.beforeReply }),
    ...(overrides.queryReplies === undefined ? {} : { queryReplies: overrides.queryReplies }),
    ...(overrides.queryBeforeReply === undefined ? {} : { queryBeforeReply: overrides.queryBeforeReply }),
    ...(overrides.hostOptions === undefined ? {} : { hostOptions: overrides.hostOptions }),
    ...(extra === undefined ? {} : { extraWorkspaces: [{ scope: extra.scope, name: 'AG2b second workspace', root: extra.root }] }),
  });
}

export async function readPageToken(base: string): Promise<string> {
  const response = await fetch(base);
  if (response.status !== 200) throw new Error(`the workbench page did not load: ${response.status}`);
  const html = await response.text();
  const match = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(html);
  if (match?.[1] === undefined) throw new Error('the page did not expose the runtime token meta');
  return match[1];
}

const coreUrl = (base: string, suffix: string): string => new URL(CORE_API_PREFIX + suffix, base).toString();

async function coreGet(base: string, suffix: string, token: string): Promise<Response> {
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

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};

/** The seed Plan: the required work Tasks plus the Goal gate, all carrying one
 * obligation with one registered static requirement. Also seeded by the
 * scenario harness's platform mode (tests/scenarios/harness.ts). */
export function ag2bPlanDraft(workIds: readonly string[] = [AG2B_WORK_TASK_ID]): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'ag2b-plan', planRevision: 1, goalId: AG2B_GOAL_REF.goalId, stages: [],
    tasks: [
      ...workIds.map(taskId => ({ taskId, title: `Independent work ${taskId}`, requirementLevel: 'required' as const,
        taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const },
        executionIntent: 'request_execution' as const })),
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
}

/** The frozen R5c graph relationship seed over the real HTTP routes: project,
 * workspace, completion policy, initial architecture, Goal and an adopted Plan
 * with one ordinary work plus the Goal gate. The automatic captures the seed starts settle before it
 * returns (`settleAutoCapture`) unless `settle: false` leaves them running. */
export async function seedAG2bWorkGraph(host: AG2bHost, workIds: readonly string[] = [AG2B_WORK_TASK_ID],
  options: { settle?: boolean; lineTaskIds?: readonly string[] } = {}): Promise<{ workTarget: WorkLinkTarget; goalRef: GoalRef }> {
  await seedAG2bWorkGraphThrough(async (suffix, body) => await (await corePost(host.base, suffix, host.token, body)).json() as unknown, workIds, options.lineTaskIds);
  if (options.settle !== false) await settleAutoCapture(host);
  return {
    workTarget: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: AG2B_WORK_TASK_ID } },
    goalRef: AG2B_GOAL_REF,
  };
}

/**
 * L8: a Host with the lease starts an automatic architecture capture on its own (workspace
 * registration, catalog adoption or revision, a check PASS). It runs detached and commits later;
 * a close leaves it pending and the next start retries it. A case whose next window must write
 * nothing (a restart, a crash, a replay) lets it settle first, through the ONE public
 * `architecture/observation-state` read, polled every 10 ms for at most 30 s: settled when the
 * workspace has no request record, its request is satisfied (`pending: false`) or its failure is
 * recorded. A Host without the lease never captures, so nothing is awaited there.
 */
export async function settleAutoCapture(host: AG2bHost): Promise<void> {
  if (hostReconcile(host.host, AG2B_SCOPE.projectId).lease !== 'owned') return;
  const deadline = Date.now() + 30_000;
  for (;;) {
    const state = await (await corePost(host.base, 'architecture/observation-state', host.token,
      plain(AG2B_SCOPE, { workspace: AG2B_SCOPE }))).json() as ReadResult<ArchitectureObservationStateV1>;
    if (state.status === 'ready') {
      const capture = state.value.autoCapture;
      if (capture === null || !capture.pending || capture.status === 'failed') return;
    }
    if (Date.now() >= deadline) throw new Error(`the automatic capture did not settle within 30 s: ${JSON.stringify(state)}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/**
 * O1b (L26): a Host with the lease drives the project's `start_lines` operation in the background (born by the first
 * workspace's registration). A case whose next window must write nothing lets it end first, through the ONE public
 * `role-lines/operations` read and the one wait (`startLinesEnded`, 30 s, loud on timeout). A Host without the lease
 * drives nothing, and an actor the read answers `forbidden` cannot see it, so nothing is awaited there.
 */
export async function settleStartLines(host: Pick<AG2bHost, 'host' | 'base' | 'token'>,
  scope: CoreScope = AG2B_SCOPE): Promise<void> {
  if (hostReconcile(host.host, scope.projectId).lease !== 'owned') return;
  const workspace = { projectId: scope.projectId, workspaceId: scope.workspaceId };
  await startLinesEnded(async () => await (await corePost(host.base, 'role-lines/operations', host.token,
    plain(scope, { workspace }))).json() as unknown);
}

/** The project's `start_lines` row of `role-lines/operations`: the one `role_line` row whose steps are the three
 *  opening keys, in order (O1b, L26). */
export type StartLinesRow = Extract<RoleLineOperationReadV1, { action: 'role_line' }>;

function startLinesRowOf(rows: readonly RoleLineOperationReadV1[]): StartLinesRow | null {
  const keys = ROLE_LINE_STEP_KEYS.join(',');
  for (const row of rows) {
    if (row.action === 'role_line' && row.steps.map(step => step.key).join(',') === keys) return row;
  }
  return null;
}

/**
 * O1b (L26): the first workspace's registration births the project's `start_lines` operation, and the Host opens the
 * three opening lines (secretary, adviser, scribe) in the background, each taking a seat. THE one wait for it: `read`
 * is one `role-lines/operations` answer of the workspace, polled every 10 ms for at most 30 s until the operation is
 * completed or failed; answers that row, or null when the read answers `forbidden` (an actor that may not read it).
 * Past the deadline it throws with the last answer: a wait that never ends is a red, never a silent pass.
 */
export async function startLinesEnded(read: () => Promise<unknown>): Promise<StartLinesRow | null> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const answer = await read() as ReadResult<readonly RoleLineOperationReadV1[]>;
    if (answer.status === 'rejected' && answer.code === 'forbidden') return null;
    const row = answer.status === 'ready' ? startLinesRowOf(answer.value) : null;
    if (row !== null && (row.phase === 'completed' || row.phase === 'failed')) return row;
    if (Date.now() >= deadline) throw new Error(`the start_lines operation did not end within 30 s: ${JSON.stringify(answer)}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** One formal seed write: a core route suffix and its `graphWrite` body; answers the owner's result. */
type AG2bSeedWrite = (suffix: string, body: ReturnType<typeof graphWrite> | ReturnType<typeof plain>) => Promise<unknown>;

/** The same seed through any writer: the HTTP routes above, or the owners in process (the scenario
 * harness's platform mode, tests/scenarios/harness.ts). Every write must commit. */
export async function seedAG2bWorkGraphThrough(write: AG2bSeedWrite, workIds: readonly string[] = [AG2B_WORK_TASK_ID],
  lineTaskIds: readonly string[] = workIds): Promise<void> {
  const committed = async (suffix: string, request: ReturnType<typeof graphWrite>): Promise<unknown> => {
    const body = await write(suffix, request);
    if (asRecord(body)['status'] !== 'committed') {
      throw new Error(`the formal seed write did not commit: ${JSON.stringify(body)}`);
    }
    return asRecord(body)['value'];
  };
  await committed('projects/create', graphWrite(AG2B_SCOPE, { projectId: AG2B_SCOPE.projectId },
    'ag2b-project', [{ ref: AG2B_PROJECT_REF, revision: 0 }]));
  await committed('workspaces/register', graphWrite(AG2B_SCOPE, { workspace: AG2B_SCOPE },
    'ag2b-workspace', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 0 }]));
  const installed = await committed('completion-policies/install', graphWrite(AG2B_SCOPE, {
    policyId: 'ag2b-policy', contentRevision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 },
  }, 'ag2b-policy-install', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_POLICY_REF, revision: 0 }])) as Record<string, unknown>;
  await committed('completion-policies/activate', graphWrite(AG2B_SCOPE, {
    target: { ref: asRecord(installed)['ref'], digest: asRecord(installed)['contentDigest'] },
  }, 'ag2b-policy-activate', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_POLICY_ACTIVE_REF, revision: 0 }]));
  await committed('architecture/adopt-initial', graphWrite(AG2B_SCOPE, {
    baselineId: 'ag2b-baseline', description: 'AG2b isolated module boundary', constraints: [],
    catalog: { requireDag: true, dependencies: [], modules: [{ ref: { projectId: AG2B_SCOPE.projectId, moduleId: 'ag2b-work' },
      name: 'AG2b work', responsibility: 'Consult then write the isolated project', paths: ['src'], interfaces: [] }] },
  }, 'ag2b-architecture', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 }]));
  await committed('goals/create', graphWrite(AG2B_SCOPE, {
    goalId: AG2B_GOAL_REF.goalId, workspace: AG2B_SCOPE, objective: 'Deliver the AG2b continuous communication closure',
  }, 'ag2b-goal', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 }]));
  const proposed = await committed('plans/propose', graphWrite(AG2B_SCOPE, {
    goalRef: AG2B_GOAL_REF, basedOn: null, draft: ag2bPlanDraft(workIds), reason: { text: 'AG2b initial plan', sources: [] },
  }, 'ag2b-plan-propose', [])) as Record<string, unknown>;
  await committed('plans/apply', graphWrite(AG2B_SCOPE, {
    proposalRef: asRecord(proposed)['ref'], expectedProposalRevision: asRecord(proposed)['revision'], decisionRefs: [],
  }, 'ag2b-plan-apply', []));
  // A-25: picking no longer makes a line, so the seed holds one executor line per work Task, each with the removed
  // create step's open responsible link (an occupied line cannot serve another Task).
  for (const taskId of lineTaskIds) {
    const line = await write('sessions/create', plain(AG2B_SCOPE, {
      workspace: AG2B_SCOPE, role: AG2B_WORK_ROLE, recommendedRefs: [],
      initialLinks: [{ target: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId } },
        relation: 'responsible' }],
      meta: { requestId: `ag2b-line-${taskId}`, expected: [] },
    } satisfies CreateSessionRequest));
    if (asRecord(line)['status'] !== 'completed') throw new Error(`the seeded line did not complete: ${JSON.stringify(line)}`);
  }
}

type AG2bSession = { sessionRef: SessionRef; sessionAggregateRef: SessionRef; revision: number };

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

type AG2bQueryRefs = { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef };

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
