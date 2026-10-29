/**
 * K slice part B, entry KE6 (test-first).
 *
 * A scripted-model read-only execution: one real Query through the public
 * Runtime `prepareQuery`/`startQuery`/`observeQuery`, and one Work with an empty
 * write scope through the same Runtime's `prepareExecution`/`startRun`/
 * `observeRun`. The only stand-in is the Kernel ProcessSandbox capability
 * (spec §5.1 KE6: “沙箱可用与否经 Kernel 的能力探测替身控制”); commands never
 * touch a real host process. Rows KB-07..KB-10 and the KE6 half of KB-11.
 *
 * History is read through the public `readSessionHistory` page and decoded with
 * the public Kernel `sessionRecordSchema`; no Runtime-internal decoder is used.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { QueryJobIntentV1, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { SessionHistoryEntry, SessionOperationsPort } from '../../src/core/agent-runtime/session-operations.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import { createScriptedModel, createB2RuntimeFixture, digestOf } from '../helpers/B2-runtime-fixture.js';
import { createKReadonlyWorkFixture } from '../helpers/K-readonly-work-support.js';
import { startKReadonlyRealHost } from '../helpers/K-readonly-host-support.js';
import {
  AG2B_GOAL_REF, AG2B_QUERY_PROFILE_ID, AG2B_SCOPE, corePost, plain as ag2bPlain, seedAG2bWorkGraph,
} from '../helpers/AG2b-collaboration-fixture.js';
import { ProcessSandboxError, ProviderRegistry, sessionRecordSchema, type ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import { READONLY_COMMAND_TOOL_NAME } from '../../src/core/agent-runtime/readonly-command-tool.js';
import { createLocalWorkbenchHost, readonlyCommandsDisabledScopes, type LocalWorkbenchHostOptions, type WorkbenchWorkspaceConfig } from '../../src/app/host.js';
import { CORE_API_PREFIX, PLATFORM_TOKEN_HEADER, PLATFORM_TOKEN_PLACEHOLDER } from '../../src/app/core-http-types.js';
import { PLATFORM_TOKEN_META_NAME } from '../helpers/host-page.js';
import { createWorkbenchRuntimeHostBindings, type WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';

const AT = '2026-09-26T00:00:00.000Z';
/** D-BOUND/D-CODES fixes the external-change message verbatim (spec §9 M10/M11). */
const WORKSPACE_CHANGED_MESSAGE = 'workspace_changed_during_readonly_command: the workspace was changed by another '
  + 'writer during the command; the changed paths are in the output';

/**
 * The Kernel sandbox capability stand-in. `available` is exactly the fact the
 * frozen composition root reads from `ProcessSandbox.probe` to build the
 * capability set; `next` produces the real `ProcessExecutionResult` shape the
 * read-only handler consumes. It never runs a host process.
 */
const sandbox = vi.hoisted(() => ({
  available: true as boolean,
  commands: [] as string[],
  /** Every `ProcessSandbox.probe` option object, in call order. */
  probes: [] as Array<Record<string, unknown>>,
  /**
   * D-PROBE test seam: when set, a read-only `probe`/`execute` only succeeds
   * when the options it handles declare exactly these `readOnlyPaths` and
   * `executablePath`. The composition-root capability probe (no read-only
   * options) is never affected. `execute` reads the options its own instance
   * was CONSTRUCTED with, so a tool that probes correctly but then constructs
   * or runs the sandbox with different options is refused.
   */
  expectedReadOnlyOptions: null as { readOnlyPaths?: string[]; executablePath?: string } | null,
  next: ((): unknown => ({
    exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: '', totalBytes: 0, truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1',
    timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 },
  })) as (command: string) => unknown,
}));

vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  // D-DOUBLE: the instance keeps the constructor options; `execute` refuses
  // (the real `ProcessSandboxError`) unless the instance's own options are the
  // read-only options the command needs. The behaviour depends on the options
  // the instance was built with, not on a global the capability probe set.
  const matchesReadOnlyOptions = (options: Record<string, unknown> | undefined): boolean => {
    if (options?.['workspaceMode'] !== 'read_only') return false;
    const expected = sandbox.expectedReadOnlyOptions;
    if (expected === null) return true;
    return JSON.stringify(options['readOnlyPaths'] ?? null) === JSON.stringify(expected.readOnlyPaths ?? null)
      && options['executablePath'] === expected.executablePath;
  };
  class KProcessSandbox {
    private readonly instanceOptions: Record<string, unknown> | undefined;
    constructor(_profile: unknown, _root: string, _workspace: unknown, options?: Record<string, unknown>) {
      this.instanceOptions = options;
    }
    get effectiveOptions(): { protectedPaths: string[]; readOnlyPaths: string[]; executablePath: string } {
      return { protectedPaths: [], readOnlyPaths: [], executablePath: '/usr/bin:/bin' };
    }
    static async probe(_root: unknown, _workspace: unknown, options?: Record<string, unknown>): Promise<unknown> {
      sandbox.probes.push(options ?? {});
      const wanted = options ?? {};
      if (wanted['workspaceMode'] === 'read_only' && !matchesReadOnlyOptions(wanted)) {
        return { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: read-only options mismatch' };
      }
      return sandbox.available
        ? { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
        : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: bubblewrap unavailable' };
    }
    async execute(request: { command: string; cwd: string; timeoutMs: number; outputLimitBytes: number }): Promise<unknown> {
      if (!matchesReadOnlyOptions(this.instanceOptions)) {
        throw new actual.ProcessSandboxError('sandbox_unavailable', 'stub: read-only options mismatch');
      }
      sandbox.commands.push(request.command);
      return sandbox.next(request.command);
    }
  }
  return { ...actual, ProcessSandbox: KProcessSandbox };
});

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  sandbox.available = true;
  sandbox.commands = [];
  sandbox.probes = [];
  sandbox.expectedReadOnlyOptions = null;
  sandbox.next = () => ({
    exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: '', totalBytes: 0, truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1',
    timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 },
  });
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------- //
// Query chain                                                                  //
// --------------------------------------------------------------------------- //

const projectId = 'k-readonly-project';
const workspaceId = 'k-readonly-workspace';
const scope = { projectId, workspaceId };
const human = { kind: 'human' as const, id: 'k-readonly-operator' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'k-readonly-goal' };
const queryJobRef = { aggregateType: 'QueryJob' as const, projectId, workspaceId, queryJobId: 'k-readonly-job' };
const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId, workspaceId, queryJobId: 'k-readonly-job', runId: 'k-readonly-run' };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'k-readonly-binding', templateId: 'advisor', templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const sessionRole: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'advisor', templateRevision: '1' };
const runtimeBudget: RuntimeBudget = { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 };
const hostInstruction = 'K readonly trusted query guidance';
const skillRoot = resolve(import.meta.dirname, '../../resources/skills');

function hostCtx(signal: AbortSignal = new AbortController().signal): CoreCallContext {
  return { projectId, workspaceId, principal: { kind: 'host', actor: human },
    materialReader: { kind: 'host', projectId, workspaceId, actor: human }, signal };
}

/**
 * The REAL Host runtime-binding resolution boundary over one explicit binding.
 * `switchOff` is the D-SWITCH narrowing computed by the production Host helper
 * from a `WorkbenchWorkspaceConfig` whose `allowReadonlyCommands` is false.
 */
function realReadonlyHost(input: {
  scripted: ReturnType<typeof createScriptedModel>;
  scope: WorkspaceScope;
  role: RoleConfigurationRef;
  configurationRevision: string;
  tools: string[];
  hostTemplate: { templateId: string; revision: string; digest: string };
  systemInstruction: string;
  skills: { resourceRoot: string; enabledIds: string[] };
  switchOff: boolean;
}): RuntimeHostBindings {
  const configuration: WorkbenchRuntimeConfiguration = {
    schemaVersion: 1,
    bindings: [{
      id: 'k-readonly-real-host-binding', label: 'K readonly real Host binding', scope: input.scope, role: input.role,
      configurationRevision: input.configurationRevision,
      model: { revision: input.configurationRevision, provider: 'deepseek', model: 'k-readonly-scripted' },
      grant: {
        budget: runtimeBudget,
        hostTemplate: input.hostTemplate,
        tools: [...input.tools],
        writeScope: [],
        skills: { resourceRoot: input.skills.resourceRoot, enabledIds: [...input.skills.enabledIds] },
        systemInstruction: input.systemInstruction,
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
        readonlyCommandAccess: 'all_except_denied',
      },
    }],
    queryProfiles: [],
  };
  const registry = {
    get: () => ({ id: 'deepseek', secretEnvironmentVariable: 'K_READONLY_HOST_SECRET', defaultBaseUrl: 'http://127.0.0.1',
      capabilities: { streaming: true, toolCalls: true, usage: true }, create: () => input.scripted.client }),
    create: () => input.scripted.client,
  };
  const switchOffWorkspace: WorkbenchWorkspaceConfig = {
    scope: input.scope, name: 'K readonly switch-off workspace', root: '/k/readonly/switch-off',
    workspaceRevision: 1, readPrefixes: ['.'], allowReadonlyCommands: false,
  };
  return createWorkbenchRuntimeHostBindings(configuration, {
    registry: registry as never, secretSource: { get: () => 'k-readonly-host-secret' },
  }, { readonlyCommandsDisabledScopes: readonlyCommandsDisabledScopes(input.switchOff ? [switchOffWorkspace] : []) });
}

function coordinationIntent(): QueryJobIntentV1 {
  return {
    schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId, workspaceId, goalId: goalRef.goalId,
    question: 'Read the workspace and answer', focusTaskRefs: [],
    budget: { maxTokens: 200000, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: 'k-readonly-corr',
    execution: { kind: 'initial_coordination', roleBinding, runtimeBudget },
  };
}

type QueryHostState = { revision: number | null; authReads: number; revisionFor: (read: number) => string; allowWholeWorkspace: boolean };
function workspaceBindings(state: QueryHostState, directory: string): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== projectId || requested.workspaceId !== workspaceId || state.revision === null) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready', value: { root: directory, workspaceRevision: state.revision } };
    },
    async authorize() {
      state.authReads += 1;
      return { status: 'ready', value: { subjectKey: 'k-readonly-host', permissionRevision: state.revisionFor(state.authReads),
        allowsRead: () => state.allowWholeWorkspace } };
    },
  };
}

async function bootstrap(platform: Awaited<ReturnType<typeof createTargetPlatform>>, state: QueryHostState) {
  await platform.projects.createProject(hostCtx(), { meta: { requestId: 'k-project-1', expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } });
  const registered = await platform.projects.registerWorkspace(hostCtx(), { meta: { requestId: 'k-workspace-1', expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  if (registered.status !== 'committed') throw new Error('workspace registration failed');
  state.revision = registered.value.revision;
  await platform.goals.createGoal(hostCtx(), { meta: { requestId: 'k-goal-1', expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Answer one reading question' } });
}

async function queryPlatform(options: {
  replies: Parameters<typeof createScriptedModel>[0];
  tools?: string[];
  writeScope?: string[];
  readonlyCommandAccess?: boolean;
  allowWholeWorkspace?: boolean;
  revisionFor?: (read: number) => string;
  /** The trusted read-only sandbox options the tool must run and probe with. */
  processSandboxOptions?: { readOnlyPaths?: string[]; executablePath?: string };
  /** Install the REAL Host resolution boundary with a switch-off narrowing. */
  realHost?: { switchOff: boolean; tools: string[] };
  storage?: Parameters<typeof createTargetPlatform>[0]['storage'];
}): Promise<{ platform: Awaited<ReturnType<typeof createTargetPlatform>>; scripted: ReturnType<typeof createScriptedModel>; state: QueryHostState }> {
  const directory = await mkdtemp(join(tmpdir(), 'next-k-readonly-'));
  directories.push(directory);
  await mkdir(join(directory, 'src'), { recursive: true });
  await writeFile(join(directory, 'src', 'module.ts'), 'export const kReadonlyMarker = "K_READONLY";\n');
  const state: QueryHostState = { revision: null, authReads: 0,
    revisionFor: options.revisionFor ?? (() => 'k-read-1'), allowWholeWorkspace: options.allowWholeWorkspace ?? true };
  const scripted = createScriptedModel(options.replies);
  const host: RuntimeHostBindings = options.realHost === undefined ? {
    async resolveConfiguration() { return { status: 'rejected', code: 'unsupported', reason: 'this chain never runs Work execution' }; },
    async resolveQueryConfiguration() {
      return { status: 'ready', value: {
        configurationRevision: 'k-readonly-host@1',
        model: { configuration: { revision: 'k-readonly-host@1', provider: 'deepseek', model: 'k-readonly-scripted', baseUrl: 'http://127.0.0.1' },
          client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'k-fixture-counter' }) } },
        budget: runtimeBudget,
        tools: [...(options.tools ?? ['read', 'run_readonly_command'])],
        writeScope: [...(options.writeScope ?? [])],
        skills: { resourceRoot: skillRoot, enabledIds: ['platform-work'] },
        systemInstruction: hostInstruction,
        hostTemplate: { templateId: 'advisor', revision: '1', digest: digestOf(hostInstruction) },
        deniedPrefixes: [], processSandboxOptions: structuredClone(options.processSandboxOptions ?? {}), materialBasis: null,
        ...((options.readonlyCommandAccess ?? true) ? { readonlyCommandAccess: 'all_except_denied' as const } : {}),
      } };
    },
  } : realReadonlyHost({
    scripted, scope, role: sessionRole, configurationRevision: 'k-readonly-host@1',
    tools: options.realHost.tools,
    hostTemplate: { templateId: 'advisor', revision: '1', digest: digestOf(hostInstruction) },
    systemInstruction: hostInstruction, skills: { resourceRoot: skillRoot, enabledIds: ['platform-work'] },
    switchOff: options.realHost.switchOff,
  });
  const platform = await createTargetPlatform({
    storage: options.storage ?? { kind: 'sqlite' as const, directory },
    workspace: workspaceBindings(state, directory),
    sourcePolicyFor: async () => ({ root: directory, permissionRevision: 'k-read-1', allowsRead: () => true }),
    runtime: host,
    kernelStores: { entries: [{ adapterId: 'k-readonly-kernel', storeKey: 'k-readonly-kernel-store', workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    now: () => AT,
  });
  return { platform, scripted, state };
}

async function runQuery(platform: Awaited<ReturnType<typeof createTargetPlatform>>, state: QueryHostState, signal?: AbortSignal) {
  await bootstrap(platform, state);
  await platform.queries.submitQueryJob(hostCtx(signal), { meta: { requestId: 'k-submit-1', expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }, { ref: goalRef, revision: 1 },
    { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] },
    input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent: coordinationIntent() } });
  const created = await platform.runtime.createSession(hostCtx(signal), { workspace: scope, role: sessionRole, recommendedRefs: [], initialLinks: [], meta: { requestId: 'k-session-1', expected: [] } });
  if (created.status !== 'completed') throw new Error('Session creation did not complete');
  const session = created.value.ref;
  const claim = await platform.queries.claimQuery(hostCtx(signal), { meta: { requestId: 'k-claim-1', expected: [
    { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 }, { ref: session, revision: created.value.revision }] },
    input: { queryRunRef, sessionRef: session } });
  if (claim.status !== 'committed') throw new Error('Query claim did not commit: ' + JSON.stringify(claim));
  const prepared = await platform.runtime.prepareQuery(hostCtx(signal), { queryRunRef, requestId: 'k-prepare-1' });
  if (prepared.status !== 'ready') throw new Error('Query preparation did not become ready: ' + JSON.stringify(prepared));
  const started = await platform.runtime.startQuery(hostCtx(signal), { prepared: prepared.value, consumerId: 'k-consumer', requestId: 'k-start-1' });
  if (started.status !== 'ready') throw new Error('Query start did not become ready: ' + JSON.stringify(started));
  // KE6 names all three public Query entry points; observation is a read of the
  // already-recorded execution, so it uses a fresh Host signal.
  const observed = await platform.runtime.observeQuery(hostCtx(), { queryRunRef });
  if (observed.status !== 'ready') throw new Error('Query observation did not become ready: ' + JSON.stringify(observed));
  return { started: started.value, observed: observed.value };
}

function isKernelRecordBody(body: SessionHistoryEntry['body']): body is { encoding: 'kernel_session_record_json'; text: string } {
  return typeof body === 'object' && body !== null && 'encoding' in body
    && (body as { encoding?: unknown }).encoding === 'kernel_session_record_json'
    && typeof (body as { text?: unknown }).text === 'string';
}

/**
 * Read the tool result persisted in the public `readSessionHistory` page. It
 * uses only the public Runtime reader and the public Kernel record schema.
 */
async function storedToolResult(
  port: Pick<SessionOperationsPort, 'readSessionHistory'>,
  ctx: CoreCallContext,
  sessionRef: SessionRef,
  callId: string,
): Promise<ToolResult | undefined> {
  const history = await port.readSessionHistory(ctx, { sessionRef, afterCursor: null, throughCursor: null, limit: 200 });
  if (history.status !== 'ready') throw new Error('the Session history was not readable: ' + JSON.stringify(history));
  for (const item of history.value.items) {
    if (!isKernelRecordBody(item.body)) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(item.body.text); } catch { continue; }
    const record = sessionRecordSchema.safeParse(parsed);
    if (!record.success || record.data.recordType !== 'agent.event') continue;
    const event = record.data.payload.event;
    if (event.type === 'tool.completed' || event.type === 'tool.failed' || event.type === 'tool.cancelled') {
      if (event.payload.callId === callId) return event.payload.result;
    }
  }
  return undefined;
}

function toolMessage(scripted: ReturnType<typeof createScriptedModel>, callId: string) {
  const request = scripted.requests.find(entry => entry.messages.some(message => message.role === 'tool' && message.callId === callId));
  if (request === undefined) return undefined;
  return request.messages.find(message => message.role === 'tool' && message.callId === callId);
}

// --------------------------------------------------------------------------- //
// Real Host (`createLocalWorkbenchHost`) integration for D-SWITCH            //
// --------------------------------------------------------------------------- //

const REAL_HOST_SECRET_VAR = 'K_REAL_HOST_SECRET';

type RealHost = {
  base: string; token: string; scripted: ReturnType<typeof createScriptedModel>;
  close(): Promise<void>;
};

async function readRealHostToken(base: string): Promise<string> {
  const response = await fetch(base);
  expect(response.status).toBe(200);
  const html = await response.text();
  const match = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(html);
  if (match?.[1] === undefined) throw new Error('the page did not expose the runtime token meta');
  return match[1];
}

/**
 * The REAL Host creation path (`createLocalWorkbenchHost`). `runtimeConfiguration`
 * exercises the startup call site (memory store, no settings) or the settings
 * rebuild call site (SQLite store, settings restore); `programmatic` installs an
 * explicit `options.runtime` the Host must narrow itself. The explicit binding
 * always lists `run_readonly_command` with `readonlyCommandAccess:'all_except_denied'`.
 */
async function startRealReadonlyHost(input: {
  switchOff: boolean;
  withSettings: boolean;
  programmatic?: boolean;
  explicitTools?: string[];
  replies: Parameters<typeof createScriptedModel>[0];
}): Promise<RealHost> {
  const root = await mkdtemp(join(tmpdir(), 'k-real-host-ws-'));
  const database = await mkdtemp(join(tmpdir(), 'k-real-host-db-'));
  const publicDir = await mkdtemp(join(tmpdir(), 'k-real-host-public-'));
  directories.push(root, database, publicDir);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'module.ts'), 'export const kRealHostMarker = "K_REAL_HOST";\n');
  await writeFile(join(publicDir, 'index.html'),
    `<meta name="${PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
  const scripted = createScriptedModel(input.replies);
  const registry = new ProviderRegistry().register({
    id: 'deepseek', secretEnvironmentVariable: REAL_HOST_SECRET_VAR, defaultBaseUrl: 'http://127.0.0.1:9',
    capabilities: { streaming: true, toolCalls: true, usage: true }, create: () => scripted.client,
  });
  const secretSource = { get: (name: string): string | undefined =>
    name === REAL_HOST_SECRET_VAR ? 'k-real-host-secret' : undefined };
  const configuration: WorkbenchRuntimeConfiguration = {
    schemaVersion: 1,
    bindings: [{
      id: 'k-real-host-binding', label: 'K real Host binding', scope, role: sessionRole,
      configurationRevision: 'k-real-host@1',
      model: { revision: 'k-real-host@1', provider: 'deepseek', model: 'k-real-scripted',
        secretEnvironmentVariable: REAL_HOST_SECRET_VAR },
      grant: {
        budget: runtimeBudget,
        hostTemplate: { templateId: 'advisor', revision: '1', digest: digestOf(hostInstruction) },
        tools: [...(input.explicitTools ?? ['read', READONLY_COMMAND_TOOL_NAME])],
        writeScope: [],
        skills: { resourceRoot: skillRoot, enabledIds: ['platform-work'] },
        systemInstruction: hostInstruction,
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
        readonlyCommandAccess: 'all_except_denied',
      },
    }],
    queryProfiles: [],
  };
  const options: LocalWorkbenchHostOptions = {
    storage: input.withSettings ? { kind: 'sqlite', directory: database } : { kind: 'memory' },
    actor: { kind: 'human', id: 'k-real-host-operator' },
    workspaces: [{ scope, name: 'K real Host workspace', root, workspaceRevision: 1, readPrefixes: ['.'],
      ...(input.switchOff ? { allowReadonlyCommands: false } : {}) }],
    kernelStores: { entries: [{ adapterId: 'k-real-host-kernel', storeKey: 'k-real-host-kernel-store', workspace: scope,
      databasePath: join(database, 'kernel.sqlite') }] },
    publicDir, now: () => AT,
    runtimeProvider: { registry, secretSource },
    ...(input.programmatic
      ? { runtime: createWorkbenchRuntimeHostBindings(configuration, { registry, secretSource }) }
      : { runtimeConfiguration: configuration }),
    ...(input.withSettings ? { settings: { settingsDirectory: join(database, 'host-settings') } } : {}),
  };
  const host = await createLocalWorkbenchHost(options);
  const address = await host.listen();
  const token = await readRealHostToken(address.url);
  return { base: address.url, token, scripted, close: () => host.close() };
}

/** The public HTTP Query chain over the real Host (submit → claim → prepare → start). */
async function driveRealHostQuery(base: string, token: string, tag: string): Promise<void> {
  const post = async (suffix: string, body: unknown): Promise<Record<string, unknown>> => {
    const response = await fetch(new URL(CORE_API_PREFIX + suffix, base).toString(), {
      method: 'POST', headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    return await response.json() as Record<string, unknown>;
  };
  const wire = (input: unknown, requestId: string, expected: unknown[]) =>
    ({ scope, request: { input, meta: { requestId, expected } } });
  const plain = (input: unknown) => ({ scope, input });

  expect(await post('projects/create', wire({ projectId: scope.projectId }, `k-real-project-${tag}`, [{ ref: projectRef, revision: 0 }])))
    .toMatchObject({ status: 'committed' });
  expect(await post('workspaces/register', wire({ workspace: scope }, `k-real-workspace-${tag}`,
    [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }]))).toMatchObject({ status: 'committed' });
  expect(await post('goals/create', wire({ goalId: goalRef.goalId, workspace: scope, objective: 'K real Host goal' },
    `k-real-goal-${tag}`, [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }]))).toMatchObject({ status: 'committed' });

  const created = await post('sessions/create', plain({ workspace: scope, role: sessionRole, recommendedRefs: [],
    initialLinks: [], meta: { requestId: `k-real-session-${tag}`, expected: [] } }));
  expect(created).toMatchObject({ status: 'completed' });
  const createdValue = created['value'] as { ref?: { projectId: string; sessionId: string }; revision?: number } | undefined;
  if (createdValue?.ref === undefined || createdValue.revision === undefined) throw new Error('real Host session creation did not complete');
  const sessionRef = createdValue.ref;

  expect(await post('queries/submit', wire({ queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId,
    intent: coordinationIntent() }, `k-real-submit-${tag}`, [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 },
    { ref: goalRef, revision: 1 }, { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }])))
    .toMatchObject({ status: 'committed' });
  expect(await post('queries/claim', wire({ queryRunRef, sessionRef }, `k-real-claim-${tag}`,
    [{ ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
      { ref: sessionRef, revision: createdValue.revision }]))).toMatchObject({ status: 'committed' });

  const prepared = await post('queries/prepare', plain({ queryRunRef, requestId: `k-real-prepare-${tag}` }));
  expect(prepared).toMatchObject({ status: 'ready' });
  const started = await post('queries/start', plain({ prepared: prepared['value'], consumerId: 'k-real-consumer',
    requestId: `k-real-start-${tag}` }));
  expect(started).toMatchObject({ status: 'ready' });
}

it('KB-07 authorized Query sees run_readonly_command, runs it and stores the output in this execution', async () => {
  sandbox.next = (command: string) => ({
    exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: `ran:${command}\n`, totalBytes: Buffer.byteLength(`ran:${command}\n`), truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1',
    timings: { snapshotBeforeMs: 0, executionMs: 3, snapshotAfterMs: 0 },
  });
  const { platform, scripted, state } = await queryPlatform({ replies: [
    { kind: 'calls', calls: [{ callId: 'k-readonly-call-1', name: 'run_readonly_command', args: { command: 'echo hello' } }] },
    { kind: 'text', text: 'K readonly query answer after the command' },
  ] });
  try {
    const { observed } = await runQuery(platform, state);
    expect(scripted.requests[0]?.tools.map(tool => tool.name)).toContain(READONLY_COMMAND_TOOL_NAME);
    const delivered = toolMessage(scripted, 'k-readonly-call-1');
    expect(delivered).toBeDefined();
    expect(delivered?.role === 'tool' ? delivered.result.status : undefined).toBe('success');
    if (delivered?.role !== 'tool') throw new Error('the Kernel did not deliver the run_readonly_command result');
    const text = delivered.result.output.find(part => part.kind === 'text');
    expect(text?.kind === 'text' ? text.text : undefined).toBe('ran:echo hello\n');
    expect(sandbox.commands).toEqual(['echo hello']);
    expect(observed.run.run.status).toBe('answered');
    // The stored Kernel turn carries the exact tool result (the output is
    // persisted, not just a request count).
    const stored = await storedToolResult(platform.runtime, hostCtx(), observed.session.ref, 'k-readonly-call-1');
    expect(stored?.status).toBe('success');
    const storedText = stored?.output.find(part => part.kind === 'text');
    expect(storedText?.kind === 'text' ? storedText.text : undefined).toBe('ran:echo hello\n');
  } finally { await platform.close(); }
});

it('KB-07 the run_readonly_command description discloses timeout retention, cancellation replacement, read-only git and hidden denied paths', async () => {
  const { platform, scripted, state } = await queryPlatform({ replies: [{ kind: 'text', text: 'K readonly description answer' }] });
  try {
    await runQuery(platform, state);
    const spec = scripted.requests[0]?.tools.find(tool => tool.name === READONLY_COMMAND_TOOL_NAME);
    expect(spec).toBeDefined();
    const description = spec?.description ?? '';
    expect(description).toContain('subprocess timeout keeps the captured output');
    expect(description).toContain('cancellation or the dispatcher timeout replaces it with empty output');
    expect(description).toContain('.git is readable but read-only');
    expect(description).toContain('Host-denied paths are hidden');
  } finally { await platform.close(); }
});

it('KB-07 authorized empty-write Work sees run_readonly_command, runs it and stores the output in this execution', async () => {
  sandbox.next = (command: string) => ({
    exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: `work:${command}\n`, totalBytes: Buffer.byteLength(`work:${command}\n`), truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1',
    timings: { snapshotBeforeMs: 0, executionMs: 4, snapshotAfterMs: 0 },
  });
  const fixture = await createKReadonlyWorkFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k-work-call-1', name: 'run_readonly_command', args: { command: 'echo work' } }] },
    { kind: 'text', text: 'K readonly work answer' },
  ] });
  try {
    const prepared = await fixture.runtime.port.prepareExecution(fixture.ctx, { runRef: fixture.runRef, requestId: 'k-work-prepare-1' });
    if (prepared.status !== 'ready') throw new Error('K readonly Work prepare did not become ready: ' + JSON.stringify(prepared));
    const started = await fixture.runtime.port.startRun(fixture.ctx, { prepared: prepared.value, consumerId: 'k-work-consumer', requestId: 'k-work-start-1' });
    if (started.status !== 'ready') throw new Error('K readonly Work start did not become ready: ' + JSON.stringify(started));
    expect(fixture.scripted.requests[0]?.tools.map(tool => tool.name)).toContain(READONLY_COMMAND_TOOL_NAME);
    const delivered = toolMessage(fixture.scripted, 'k-work-call-1');
    expect(delivered?.role === 'tool' ? delivered.result.status : undefined).toBe('success');
    if (delivered?.role !== 'tool') throw new Error('the Kernel did not deliver the Work run_readonly_command result');
    const text = delivered.result.output.find(part => part.kind === 'text');
    expect(text?.kind === 'text' ? text.text : undefined).toBe('work:echo work\n');
    expect(sandbox.commands).toEqual(['echo work']);
    expect(started.value.run).toMatchObject({ status: 'ended' });
    const observed = await fixture.runtime.port.observeRun(fixture.ctx, { runRef: fixture.runRef });
    expect(observed.status).toBe('ready');
    if (observed.status === 'ready') {
      expect(observed.value.run).toMatchObject({ status: 'ended' });
      expect(typeof observed.value.run.executionHistory?.endPosition).toBe('number');
    }
    const stored = await storedToolResult(fixture.sessionHistory, fixture.ctx, fixture.sessionRef, 'k-work-call-1');
    expect(stored?.status).toBe('success');
    const storedText = stored?.output.find(part => part.kind === 'text');
    expect(storedText?.kind === 'text' ? storedText.text : undefined).toBe('work:echo work\n');
  } finally { await fixture.close(); }
});

// --------------------------------------------------------------------------- //
// KB-08: each missing grant layer hides the tool                             //
// --------------------------------------------------------------------------- //

it('KB-08 the real Host startup with the switch off hides run_readonly_command from a Query', async () => {
  const host = await startRealReadonlyHost({ switchOff: true, withSettings: false,
    replies: [{ kind: 'text', text: 'K real Host startup answer' }] });
  try {
    await driveRealHostQuery(host.base, host.token, 'startup');
    expect(host.scripted.requests[0]?.tools.map(tool => tool.name)).not.toContain(READONLY_COMMAND_TOOL_NAME);
  } finally { await host.close(); }
});

it('KB-08 the real Host settings rebuild with the switch off hides run_readonly_command from a Query', async () => {
  const host = await startRealReadonlyHost({ switchOff: true, withSettings: true,
    replies: [{ kind: 'text', text: 'K real Host rebuild answer' }] });
  try {
    await driveRealHostQuery(host.base, host.token, 'rebuild');
    expect(host.scripted.requests[0]?.tools.map(tool => tool.name)).not.toContain(READONLY_COMMAND_TOOL_NAME);
  } finally { await host.close(); }
});

it('KB-08 the real Host startup with the switch on still grants run_readonly_command (positive control)', async () => {
  const host = await startRealReadonlyHost({ switchOff: false, withSettings: false,
    replies: [{ kind: 'text', text: 'K real Host switch on answer' }] });
  try {
    await driveRealHostQuery(host.base, host.token, 'on');
    expect(host.scripted.requests[0]?.tools.map(tool => tool.name)).toContain(READONLY_COMMAND_TOOL_NAME);
  } finally { await host.close(); }
});

it('KB-08 the real Host narrows a programmatic runtime that lists run_readonly_command', async () => {
  const host = await startRealReadonlyHost({ switchOff: true, withSettings: false, programmatic: true,
    replies: [{ kind: 'text', text: 'K real Host programmatic answer' }] });
  try {
    await driveRealHostQuery(host.base, host.token, 'programmatic');
    expect(host.scripted.requests[0]?.tools.map(tool => tool.name)).not.toContain(READONLY_COMMAND_TOOL_NAME);
  } finally { await host.close(); }
});

it('KB-08 a Query from the real Host with the switch off does not see run_readonly_command', async () => {
  const { platform, scripted, state } = await queryPlatform({
    replies: [{ kind: 'text', text: 'K readonly host switch off answer' }],
    realHost: { switchOff: true, tools: ['read', READONLY_COMMAND_TOOL_NAME, 'shell', 'write'] },
  });
  try {
    await runQuery(platform, state);
    expect(scripted.requests[0]?.tools.map(tool => tool.name)).not.toContain(READONLY_COMMAND_TOOL_NAME);
  } finally { await platform.close(); }
});

it('KB-08 a read-only Work started by the real Host with the switch off never sees run_readonly_command', async () => {
  // DB (review second round, problem 3 coverage): the REAL
  // `createLocalWorkbenchHost` starts from a workspace with
  // `allowReadonlyCommands: false` and an explicit binding that lists the tool
  // with `readonlyCommandAccess: 'all_except_denied'`; the narrowing can only
  // come from the Host, so an omitted Work-side Host wiring fails here.
  const started = await startKReadonlyRealHost({ allowReadonlyCommands: false,
    replies: [{ kind: 'text', text: 'K readonly real work answer' }] });
  try {
    await seedAG2bWorkGraph(started);
    const response = await corePost(started.base, 'workflow/driver-start', started.token,
      ag2bPlain(AG2B_SCOPE, { advance: { schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId: 'k-ro-real-flow',
        sessionHint: null, kind: 'select_work' }, queryProfileIds: [AG2B_QUERY_PROFILE_ID] }));
    expect(response.status).toBe(200);
    await expect.poll(() => started.scripted.requests.length, { timeout: 15_000, interval: 50,
      message: 'the real Host work Run must reach the model' }).toBeGreaterThan(0);
    const names = started.scripted.requests[0]?.tools.map(tool => tool.name) ?? [];
    expect(names).toContain('read');
    expect(names).not.toContain(READONLY_COMMAND_TOOL_NAME);
  } finally { await started.close(); }
});

it('KB-08 the same real Host Work with the switch on still sees run_readonly_command (positive control)', async () => {
  const started = await startKReadonlyRealHost({ allowReadonlyCommands: true,
    replies: [{ kind: 'text', text: 'K readonly real work on answer' }] });
  try {
    await seedAG2bWorkGraph(started);
    const response = await corePost(started.base, 'workflow/driver-start', started.token,
      ag2bPlain(AG2B_SCOPE, { advance: { schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId: 'k-ro-real-flow-on',
        sessionHint: null, kind: 'select_work' }, queryProfileIds: [AG2B_QUERY_PROFILE_ID] }));
    expect(response.status).toBe(200);
    await expect.poll(() => started.scripted.requests.length, { timeout: 15_000, interval: 50,
      message: 'the real Host work Run must reach the model' }).toBeGreaterThan(0);
    const names = started.scripted.requests[0]?.tools.map(tool => tool.name) ?? [];
    expect(names).toContain(READONLY_COMMAND_TOOL_NAME);
  } finally { await started.close(); }
});

it('KB-08 a Query with only a partial read prefix does not see run_readonly_command', async () => {
  const { platform, scripted, state } = await queryPlatform({
    replies: [{ kind: 'text', text: 'K readonly partial prefix answer' }],
    readonlyCommandAccess: true,
    allowWholeWorkspace: false,
  });
  try {
    await runQuery(platform, state);
    expect(scripted.requests[0]?.tools.map(tool => tool.name)).not.toContain(READONLY_COMMAND_TOOL_NAME);
  } finally { await platform.close(); }
});

it('KB-08 a Work whose RoleSpec ceiling omits run_readonly_command does not see it', async () => {
  const fixture = await createB2RuntimeFixture({ scriptedReplies: [{ kind: 'text', text: 'K readonly role ceiling answer' }] });
  try {
    const base = fixture.host;
    const runtime = fixture.rebuild({
      host: { async resolveConfiguration(ctx, request) {
        const result = await base.resolveConfiguration(ctx, request);
        if (result.status !== 'ready') return result;
        return { ...result, value: { ...result.value, tools: ['read', 'run_readonly_command'],
          readonlyCommandAccess: 'all_except_denied' as const } };
      } },
      workspaceHost: { ...fixture.deps.workspaceHost, async authorize(ctx, workspace) {
        const current = await fixture.deps.workspaceHost.authorize(ctx, workspace);
        return current.status === 'ready' ? { ...current, value: { ...current.value, allowsRead: () => true } } : current;
      } },
    });
    const prepared = await runtime.port.prepareExecution(fixture.ctx, { runRef: fixture.claim.runRef, requestId: 'k-role-ceiling-prepare' });
    if (prepared.status !== 'ready') throw new Error('K role ceiling prepare failed: ' + JSON.stringify(prepared));
    expect(prepared.value.envelope.permissions.tools).toEqual(['read']);
    const started = await runtime.port.startRun(fixture.ctx, { prepared: prepared.value, consumerId: 'k-role-ceiling-consumer', requestId: 'k-role-ceiling-start' });
    expect(started).toMatchObject({ status: 'ready' });
    const observed = await runtime.port.observeRun(fixture.ctx, { runRef: fixture.claim.runRef });
    expect(observed.status).toBe('ready');
    expect(fixture.scripted.requests[0]?.tools.map(tool => tool.name)).not.toContain(READONLY_COMMAND_TOOL_NAME);
  } finally { await fixture.close(); }
});

it('KB-08 a Work with a non-empty write scope does not see run_readonly_command', async () => {
  const fixture = await createKReadonlyWorkFixture({
    scriptedReplies: [{ kind: 'text', text: 'K readonly write Work answer' }],
    tools: ['read', 'write', 'run_readonly_command'], writeScope: ['.'],
  });
  try {
    const prepared = await fixture.runtime.port.prepareExecution(fixture.ctx, { runRef: fixture.runRef, requestId: 'k-write-scope-prepare' });
    if (prepared.status !== 'ready') throw new Error('K write scope prepare failed: ' + JSON.stringify(prepared));
    expect(prepared.value.envelope.permissions.writeScope).toEqual(['.']);
    const started = await fixture.runtime.port.startRun(fixture.ctx, { prepared: prepared.value, consumerId: 'k-write-scope-consumer', requestId: 'k-write-scope-start' });
    expect(started).toMatchObject({ status: 'ready' });
    const observed = await fixture.runtime.port.observeRun(fixture.ctx, { runRef: fixture.runRef });
    expect(observed.status).toBe('ready');
    expect(fixture.scripted.requests[0]?.tools.map(tool => tool.name)).not.toContain(READONLY_COMMAND_TOOL_NAME);
  } finally { await fixture.close(); }
});

it('KB-08 a Query whose Host read permission changed during execution gets forbidden and starts nothing', async () => {
  sandbox.next = () => ({ exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: 'should-not-run', totalBytes: 0, truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1', timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 } });
  const { platform, scripted, state } = await queryPlatform({
    replies: [
      { kind: 'calls', calls: [{ callId: 'k-forbidden-call-1', name: 'run_readonly_command', args: { command: 'echo forbidden' } }] },
      { kind: 'text', text: 'K readonly forbidden answer' },
    ],
    tools: ['run_readonly_command'],
    revisionFor: read => read <= 2 ? 'k-read-1' : 'k-read-2',
  });
  try {
    const { observed } = await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-forbidden-call-1');
    // D-CODES: the frozen Kernel enum has no `forbidden`; the compatible code is
    // `permission_denied` and the message keeps the stable `forbidden:` prefix.
    expect(delivered?.role === 'tool' && delivered.result.status === 'error'
      ? delivered.result.error.code : undefined).toBe('permission_denied');
    expect(delivered?.role === 'tool' && delivered.result.status === 'error'
      ? delivered.result.error.message.startsWith('forbidden:') : false).toBe(true);
    expect(observed.run.run.status).toBe('answered');
    expect(sandbox.commands).toEqual([]);
  } finally { await platform.close(); }
});

// --------------------------------------------------------------------------- //
// KB-09: adding the read-only tool never revives a write tool                //
// --------------------------------------------------------------------------- //

it('KB-09 an authorized Query granted shell, edit and write still sees none of them', async () => {
  const { platform, scripted, state } = await queryPlatform({
    replies: [{ kind: 'text', text: 'K readonly no writers answer' }],
    tools: ['read', 'run_readonly_command', 'shell', 'write', 'edit'],
  });
  try {
    await runQuery(platform, state);
    const names = scripted.requests[0]?.tools.map(tool => tool.name) ?? [];
    expect(names).toContain(READONLY_COMMAND_TOOL_NAME);
    for (const forbidden of ['shell', 'edit', 'write']) expect(names).not.toContain(forbidden);
  } finally { await platform.close(); }
});

it('KB-09 an empty-write Work granted shell, edit and write publicly rejects instead of exposing them', async () => {
  const fixture = await createKReadonlyWorkFixture({
    scriptedReplies: [{ kind: 'text', text: 'K readonly no writers work answer' }],
    tools: ['read', 'run_readonly_command', 'shell', 'write', 'edit'],
  });
  try {
    const prepared = await fixture.runtime.port.prepareExecution(fixture.ctx, { runRef: fixture.runRef, requestId: 'k-no-writers-prepare' });
    // The write tools are granted, but an empty write scope cannot expose them:
    // the preparation refuses publicly before any model request.
    expect(prepared).toMatchObject({ status: 'rejected', code: 'unsupported' });
    expect(fixture.scripted.calls()).toBe(0);
  } finally { await fixture.close(); }
});

it('KB-09 an empty-write Work granted write alone never hands a write tool to the model', async () => {
  const fixture = await createKReadonlyWorkFixture({
    scriptedReplies: [{ kind: 'text', text: 'K readonly write only answer' }],
    tools: ['read', 'run_readonly_command', 'write'],
  });
  try {
    const prepared = await fixture.runtime.port.prepareExecution(fixture.ctx, { runRef: fixture.runRef, requestId: 'k-write-only-prepare' });
    // Preparation succeeds; the refusal is the EXISTING start-time guard in
    // observed-model-run.ts:239 ('Read-only runtime cannot expose mutation
    // tools'), not a prepare-time guard.
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') throw new Error('the write-alone Work did not prepare: ' + JSON.stringify(prepared));
    await fixture.runtime.port.startRun(fixture.ctx, { prepared: prepared.value, consumerId: 'k-write-only-consumer', requestId: 'k-write-only-start' });
    // The guard refuses before any model request: no model call, so no write
    // tool ever reaches the model, and the Run never ends as completed. (Lead
    // 2026-10-14: today the Run stays `starting` because the driver swallows the
    // guard error; that is a recorded defect, deliberately not asserted here.)
    const observed = await fixture.runtime.port.observeRun(fixture.ctx, { runRef: fixture.runRef });
    expect(observed.status).toBe('ready');
    if (observed.status === 'ready') expect(observed.value.run.outcome).not.toBe('completed');
    expect(fixture.scripted.calls()).toBe(0);
  } finally { await fixture.close(); }
});

it('KB-09 an empty-write Work granted the model name edit alone is publicly rejected', async () => {
  const fixture = await createKReadonlyWorkFixture({
    scriptedReplies: [{ kind: 'text', text: 'K readonly edit only answer' }],
    tools: ['read', 'run_readonly_command', 'edit'],
  });
  try {
    const prepared = await fixture.runtime.port.prepareExecution(fixture.ctx, { runRef: fixture.runRef, requestId: 'k-edit-only-prepare' });
    if (prepared.status === 'ready') {
      const started = await fixture.runtime.port.startRun(fixture.ctx, { prepared: prepared.value, consumerId: 'k-edit-only-consumer', requestId: 'k-edit-only-start' });
      expect(started).toMatchObject({ status: 'rejected', code: 'unsupported' });
      expect(fixture.scripted.calls()).toBe(0);
    } else {
      expect(prepared).toMatchObject({ status: 'rejected', code: 'unsupported' });
      expect(fixture.scripted.calls()).toBe(0);
    }
  } finally { await fixture.close(); }
});

// --------------------------------------------------------------------------- //
// KB-10: handler and dispatcher result mapping                               //
// --------------------------------------------------------------------------- //

function readonlyCall(command: unknown, callId = 'k-map-call'): { kind: 'calls'; calls: Array<{ callId: string; name: string; args: Record<string, unknown> }> } {
  return { kind: 'calls', calls: [{ callId, name: 'run_readonly_command', args: command as Record<string, unknown> }] };
}

/**
 * D-ID (spec §9 M11 qualification): the 128 KiB budget measures everything the
 * tool produces except the provider-supplied call ID. Tests therefore measure
 * the complete handler result with the identity replaced by an empty string,
 * exactly as the production `boundResult` does; the returned identity itself is
 * asserted separately.
 */
function toolPayloadBytes(result: unknown): number {
  return Buffer.byteLength(JSON.stringify({ ...(result as Record<string, unknown>), callId: '' }), 'utf8');
}

it('KB-10 a non-zero exit maps to execution_failed with the captured output', async () => {
  sandbox.next = () => ({ exitCode: 7, signal: null, timedOut: false, cancelled: false,
    stdout: { text: 'before failure\n', totalBytes: 15, truncated: false },
    stderr: { text: 'k boom\n', totalBytes: 7, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1', timings: { snapshotBeforeMs: 0, executionMs: 1, snapshotAfterMs: 0 } });
  const { platform, scripted, state } = await queryPlatform({ replies: [readonlyCall({ command: 'false' }), { kind: 'text', text: 'K map exit answer' }] });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    expect(delivered?.role === 'tool' && delivered.result.status === 'error' ? delivered.result.error.code : undefined).toBe('execution_failed');
    if (delivered?.role !== 'tool' || delivered.result.status !== 'error') throw new Error('no failed read-only result');
    expect(delivered.result.error.message).toContain('命令退出码 7');
    expect(delivered.result.output.find(part => part.kind === 'text')).toMatchObject({ text: 'before failure\n' });
  } finally { await platform.close(); }
});

it('KB-10 a subprocess timeout maps to timeout with the captured output', async () => {
  sandbox.next = () => ({ exitCode: null, signal: null, timedOut: true, cancelled: false,
    stdout: { text: 'partial result\n', totalBytes: 16, truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1', timings: { snapshotBeforeMs: 0, executionMs: 30_000, snapshotAfterMs: 0 } });
  const { platform, scripted, state } = await queryPlatform({ replies: [readonlyCall({ command: 'sleep 999', timeoutMs: 1000 }), { kind: 'text', text: 'K map timeout answer' }] });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    expect(delivered?.role === 'tool' && delivered.result.status === 'error' ? delivered.result.error.code : undefined).toBe('timeout');
    if (delivered?.role !== 'tool') throw new Error('no timeout read-only result');
    expect(delivered.result.output.find(part => part.kind === 'text')).toMatchObject({ text: 'partial result\n' });
  } finally { await platform.close(); }
});

it('KB-10 an out-of-range timeoutMs is invalid_arguments and never starts a command', async () => {
  const { platform, scripted, state } = await queryPlatform({ replies: [readonlyCall({ command: 'echo never', timeoutMs: 500 }), { kind: 'text', text: 'K map range answer' }] });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    expect(delivered?.role === 'tool' && delivered.result.status === 'error' ? delivered.result.error.code : undefined).toBe('invalid_arguments');
    expect(sandbox.commands).toEqual([]);
  } finally { await platform.close(); }
});

it('KB-10 a missing command and a wrong-typed timeoutMs are invalid_arguments naming both fields', async () => {
  const { platform, scripted, state } = await queryPlatform({ replies: [
    readonlyCall({ timeoutMs: 'x' }), { kind: 'text', text: 'K map fields answer' }],
    storage: { kind: 'memory' } });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    expect(delivered?.role === 'tool' && delivered.result.status === 'error' ? delivered.result.error.code : undefined).toBe('invalid_arguments');
    if (delivered?.role !== 'tool' || delivered.result.status !== 'error') throw new Error('no invalid_arguments read-only result');
    expect(delivered.result.error.message).toContain('command');
    expect(delivered.result.error.message).toContain('timeoutMs');
    expect(sandbox.commands).toEqual([]);
  } finally { await platform.close(); }
});

it('KB-10 an unavailable sandbox is rejected by the dispatcher before the handler and starts nothing', async () => {
  sandbox.available = false;
  const { platform, scripted, state } = await queryPlatform({ replies: [readonlyCall({ command: 'echo never' }), { kind: 'text', text: 'K map sandbox answer' }] });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    expect(delivered?.role === 'tool' && delivered.result.status === 'error' ? delivered.result.error.code : undefined).toBe('sandbox_unavailable');
    expect(sandbox.commands).toEqual([]);
  } finally { await platform.close(); }
});

it('KB-10 the read-only sandbox capability is probed with the command\'s actual options', async () => {
  // D-PROBE: the Kernel double refuses the read-only capability unless the
  // probe receives exactly the options the command must run with. A tool that
  // probed with defaults (or ran with different options) would fail this and
  // never start a command.
  sandbox.expectedReadOnlyOptions = { readOnlyPaths: ['secret'], executablePath: '/opt/bin:/bin' };
  const { platform, scripted, state } = await queryPlatform({
    replies: [readonlyCall({ command: 'echo probe' }), { kind: 'text', text: 'K probe options answer' }],
    processSandboxOptions: { readOnlyPaths: ['secret'], executablePath: '/opt/bin:/bin' },
  });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    expect(delivered?.role === 'tool' ? delivered.result.status : undefined).toBe('success');
    expect(sandbox.commands).toEqual(['echo probe']);
  } finally { await platform.close(); }
});

it('KB-10 a read-only capability probe that does not match the command options refuses and starts nothing', async () => {
  // The same option-dependent double shows the seam is live: when the Host
  // grants no read-only paths but the capability is asserted for a different
  // configuration, the probe refuses and `execute` never runs a command.
  sandbox.expectedReadOnlyOptions = { readOnlyPaths: ['secret'], executablePath: '/opt/bin:/bin' };
  const { platform, scripted, state } = await queryPlatform({
    replies: [readonlyCall({ command: 'echo never' }), { kind: 'text', text: 'K probe mismatch answer' }],
    processSandboxOptions: {},
  });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    expect(delivered?.role === 'tool' && delivered.result.status === 'error'
      ? delivered.result.error.code : undefined).toBe('sandbox_unavailable');
    expect(sandbox.commands).toEqual([]);
  } finally { await platform.close(); }
});

it('KB-10 more than 100 external changed paths are named 100 in byte order plus the omitted count', async () => {
  // The input is SHUFFLED and includes byte-order-sensitive names: uppercase
  // 'A'/'Z' byte-sort before lowercase 'a', and the multi-byte UTF-8 'Ä' sorts
  // last. The expected prefix is the hand-written byte-ordered list, never a
  // slice of the shuffled input, so removing the code's sort fails this.
  const byteOrdered = [
    'changed/Apple.txt',
    'changed/Zebra.txt',
    'changed/apple.txt',
    ...Array.from({ length: 100 }, (_, index) => `changed/file-${String(index).padStart(3, '0')}.txt`),
    'changed/Ärger.txt',
  ];
  const paths = [...byteOrdered].reverse();
  sandbox.next = () => ({ exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: '', totalBytes: 0, truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [], externalChangedPaths: paths },
    sandboxProfileVersion: 'stub-v1', timings: { snapshotBeforeMs: 0, executionMs: 1, snapshotAfterMs: 0 } });
  const { platform, scripted, state } = await queryPlatform({ replies: [readonlyCall({ command: 'touch many' }), { kind: 'text', text: 'K map paths answer' }] });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    expect(delivered?.role === 'tool' && delivered.result.status === 'error'
      ? delivered.result.error.code : undefined).toBe('execution_failed');
    if (delivered?.role !== 'tool') throw new Error('no external change result');
    const json = delivered.result.output.find(part => part.kind === 'json');
    if (json?.kind !== 'json') throw new Error('no json part');
    const value = json.value as { reason?: unknown; externalChangedPaths?: unknown; externalChangedPathsOmitted?: unknown };
    expect(value.reason).toBe('workspace_changed_during_readonly_command');
    // The expected prefix is the HANDWRITTEN byte-ordered list, not the code's sort.
    const named = Array.isArray(value.externalChangedPaths) ? value.externalChangedPaths as string[] : [];
    expect(named).toEqual(byteOrdered.slice(0, 100));
    expect(value.externalChangedPathsOmitted).toBe(4);
    expect(toolPayloadBytes(delivered.result)).toBeLessThanOrEqual(128 * 1024);
  } finally { await platform.close(); }
});

it('KB-10 long external changed paths name a literal byte-ordered prefix and bound the COMPLETE result at 128 KiB', async () => {
  // Every long path is padded to the SAME UTF-8 byte length (1516), so the
  // 131072-byte budget names exactly 85 of them and omits 15 (the same literal
  // arithmetic as before: fixed envelope + one 1518-byte JSON path record).
  // The list is in byte order by hand and fed reversed (shuffled); the prefix is
  // compared against this hand-written list, never against the shuffled input.
  const expectedNamed = 85;
  const longPath = (name: string) => `changed/${name}/${'x'.repeat(1500 + (3 - Buffer.byteLength(name)))}.txt`;
  const byteOrdered = [
    longPath('App'), longPath('Zeb'), longPath('app'),
    ...Array.from({ length: 96 }, (_, index) => longPath(`file-${String(index).padStart(3, '0')}`)),
    longPath('Ärger'),
  ];
  const paths = [...byteOrdered].reverse();
  sandbox.next = () => ({ exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: '', totalBytes: 0, truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [], externalChangedPaths: paths },
    sandboxProfileVersion: 'stub-v1', timings: { snapshotBeforeMs: 0, executionMs: 1, snapshotAfterMs: 0 } });
  const { platform, scripted, state } = await queryPlatform({ replies: [readonlyCall({ command: 'touch long' }), { kind: 'text', text: 'K map long answer' }] });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    expect(delivered?.role === 'tool' && delivered.result.status === 'error' ? delivered.result.error.code : undefined).toBe('execution_failed');
    if (delivered?.role !== 'tool' || delivered.result.status !== 'error') throw new Error('no long external change result');
    expect(delivered.result.error.message).toBe(WORKSPACE_CHANGED_MESSAGE);
    expect(delivered.result.error.retryable).toBe(false);
    const json = delivered.result.output.find(part => part.kind === 'json');
    if (json?.kind !== 'json') throw new Error('no json part');
    const value = json.value as { externalChangedPaths?: unknown; externalChangedPathsOmitted?: unknown };
    const named = Array.isArray(value.externalChangedPaths) ? value.externalChangedPaths as string[] : [];
    // Independent expectation: the literal first K of the hand-written list, and
    // the literal omitted count. A degenerate always-1-path result cannot pass.
    expect(named).toEqual(byteOrdered.slice(0, expectedNamed));
    expect(value.externalChangedPathsOmitted).toBe(100 - expectedNamed);
    expect(named).toHaveLength(expectedNamed);
    expect(toolPayloadBytes(delivered.result)).toBeLessThanOrEqual(128 * 1024);
  } finally { await platform.close(); }
});

it('KB-10 the complete serialized handler result stays within the 128 KiB definition limit', async () => {
  sandbox.next = () => ({ exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: 'A'.repeat(200 * 1024), totalBytes: 200 * 1024, truncated: false },
    stderr: { text: 'B'.repeat(200 * 1024), totalBytes: 200 * 1024, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1', timings: { snapshotBeforeMs: 0, executionMs: 1, snapshotAfterMs: 0 } });
  const { platform, scripted, state } = await queryPlatform({ replies: [readonlyCall({ command: 'yes' }), { kind: 'text', text: 'K map limit answer' }] });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    expect(delivered?.role === 'tool' ? delivered.result.status : undefined).toBe('success');
    if (delivered?.role !== 'tool') throw new Error('no bounded result');
    expect(toolPayloadBytes(delivered.result)).toBeLessThanOrEqual(128 * 1024);
  } finally { await platform.close(); }
});

it('KB-10 an oversized launch-failure message is bounded and still reaches the model', async () => {
  const huge = 'cwd:' + 'x'.repeat(200 * 1024);
  sandbox.next = () => { throw new ProcessSandboxError('invalid_arguments', huge); };
  const { platform, scripted, state } = await queryPlatform({ replies: [readonlyCall({ command: 'echo huge' }), { kind: 'text', text: 'K huge message answer' }] });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    expect(delivered?.role === 'tool' && delivered.result.status === 'error' ? delivered.result.error.code : undefined).toBe('invalid_arguments');
    if (delivered?.role !== 'tool' || delivered.result.status !== 'error') throw new Error('no bounded launch-failure result');
    expect(delivered.result.error.message.length).toBeLessThan(huge.length);
    expect(toolPayloadBytes(delivered.result)).toBeLessThanOrEqual(128 * 1024);
  } finally { await platform.close(); }
});

it('KB-10 a provider call identity larger than the budget never shortens a bounded launch diagnostic', async () => {
  // D-ID (spec §9 M11 qualification): the 128 KiB budget measures everything
  // the tool produces EXCEPT the provider-supplied call ID. A provider ID
  // larger than the whole budget must not squeeze the tool's own payload, and
  // the original identity must still come back unchanged.
  const callId = 'k-id-' + 'c'.repeat(128 * 1024);
  sandbox.next = () => { throw new ProcessSandboxError('invalid_arguments', 'cwd: not a directory'); };
  const { platform, scripted, state } = await queryPlatform({
    replies: [readonlyCall({ command: 'echo huge' }, callId), { kind: 'text', text: 'K huge id answer' }],
  });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, callId);
    expect(delivered?.role).toBe('tool');
    if (delivered?.role !== 'tool' || delivered.result.status !== 'error') throw new Error('no oversized-identity result');
    expect(delivered.result.callId).toBe(callId);
    expect(delivered.result.error.code).toBe('invalid_arguments');
    expect(delivered.result.error.message).toBe('cwd: not a directory');
    // The tool's own payload, measured the way D-ID defines the budget.
    expect(toolPayloadBytes(delivered.result)).toBeLessThanOrEqual(128 * 1024);
  } finally { await platform.close(); }
});

it('KB-10 an early permission refusal with an oversized input is bounded and names the public code', async () => {
  // D-ID: every return, including the handler's early refusals, goes through
  // the same complete-result bounding function. The oversized input is a
  // caller-supplied command that never starts; the refusal is the Host-read
  // permission no longer being current (L18 layer 3).
  const oversizedCommand = 'echo ' + 'x'.repeat(200 * 1024);
  const { platform, scripted, state } = await queryPlatform({
    replies: [readonlyCall({ command: oversizedCommand }), { kind: 'text', text: 'K oversized refusal answer' }],
    tools: ['run_readonly_command'],
    revisionFor: read => read <= 2 ? 'k-read-1' : 'k-read-2',
  });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    expect(delivered?.role === 'tool' && delivered.result.status === 'error'
      ? delivered.result.error.code : undefined).toBe('permission_denied');
    if (delivered?.role !== 'tool' || delivered.result.status !== 'error') throw new Error('no bounded permission refusal');
    expect(delivered.result.error.message.startsWith('forbidden:')).toBe(true);
    expect(sandbox.commands).toEqual([]);
    expect(toolPayloadBytes(delivered.result)).toBeLessThanOrEqual(128 * 1024);
  } finally { await platform.close(); }
});

it('KB-10 a sandbox-reported cancellation reports empty output, not the captured text', async () => {
  sandbox.next = () => ({ exitCode: null, signal: null, timedOut: false, cancelled: true,
    stdout: { text: 'must not survive\n', totalBytes: 17, truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1', timings: { snapshotBeforeMs: 0, executionMs: 1, snapshotAfterMs: 0 } });
  const { platform, scripted, state } = await queryPlatform({ replies: [readonlyCall({ command: 'echo cancel' }), { kind: 'text', text: 'K handler cancel answer' }] });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    expect(delivered?.role).toBe('tool');
    if (delivered?.role !== 'tool') throw new Error('no handler cancellation result');
    // D-DESC: the handler's cooperative-cancellation branch empties the captured
    // output (the Kernel maps it to a failed tool result carrying that empty list).
    expect(delivered.result.output).toEqual([]);
    expect(JSON.stringify(delivered.result)).not.toContain('must not survive');
    expect(delivered.result.status === 'error' ? delivered.result.error.message : '')
      .toContain('run_readonly_command 已取消');
  } finally { await platform.close(); }
});

it('KB-10 a real Query whose execution is cancelled mid-command stores cancelled with empty output', async () => {
  const controller = new AbortController();
  sandbox.next = (command: string) => {
    controller.abort();
    return {
      exitCode: 0, signal: null, timedOut: false, cancelled: false,
      stdout: { text: `must-not-survive:${command}\n`, totalBytes: 20, truncated: false },
      stderr: { text: '', totalBytes: 0, truncated: false },
      effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
      sandboxProfileVersion: 'stub-v1', timings: { snapshotBeforeMs: 0, executionMs: 1, snapshotAfterMs: 0 },
    };
  };
  const { platform, state } = await queryPlatform({
    replies: [readonlyCall({ command: 'echo cancel' }), { kind: 'text', text: 'K runtime cancel answer' }],
  });
  try {
    const { observed } = await runQuery(platform, state, controller.signal);
    expect(sandbox.commands).toEqual(['echo cancel']);
    const stored = await storedToolResult(platform.runtime, hostCtx(), observed.session.ref, 'k-map-call');
    expect(stored?.status).toBe('cancelled');
    expect(stored?.output).toEqual([]);
  } finally { await platform.close(); }
});

// --------------------------------------------------------------------------- //
// KB-11 (KE6 half): an external writer during the command                    //
// --------------------------------------------------------------------------- //

it('KB-11 (KE6) an external change during the command is reported as a path, never as this command\'s effect', async () => {
  sandbox.next = () => ({ exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: 'listed\n', totalBytes: 7, truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [],
      externalChangedPaths: ['src/racy.txt'] },
    sandboxProfileVersion: 'stub-v1', timings: { snapshotBeforeMs: 0, executionMs: 1, snapshotAfterMs: 0 } });
  const { platform, scripted, state } = await queryPlatform({ replies: [readonlyCall({ command: 'ls src' }), { kind: 'text', text: 'K external change answer' }] });
  try {
    await runQuery(platform, state);
    const delivered = toolMessage(scripted, 'k-map-call');
    // D-CODES: the frozen Kernel enum has no
    // `workspace_changed_during_readonly_command`; the compatible code is
    // `execution_failed` with `retryable:false`, the fixed message and the
    // structured `reason` discriminator.
    expect(delivered?.role === 'tool' && delivered.result.status === 'error'
      ? delivered.result.error.code : undefined).toBe('execution_failed');
    if (delivered?.role !== 'tool' || delivered.result.status !== 'error') throw new Error('no external change result');
    expect(delivered.result.error.message).toBe(WORKSPACE_CHANGED_MESSAGE);
    expect(delivered.result.error.retryable).toBe(false);
    expect(delivered.result.effects).toMatchObject({ sideEffect: 'none', changedPaths: [] });
    const json = delivered.result.output.find(part => part.kind === 'json');
    if (json?.kind !== 'json') throw new Error('no json part');
    expect(json.value).toMatchObject({ reason: 'workspace_changed_during_readonly_command',
      externalChangedPaths: ['src/racy.txt'], externalChangedPathsOmitted: 0 });
    expect(sandbox.commands).toEqual(['ls src']);
  } finally { await platform.close(); }
});
