/**
 * HOST real-directory / model-settings backend Stage-1 acceptance.
 *
 * Stage-1 contract (docs/refactor/tasks/HOST-settings-backend-2026-09-29.md):
 *   - EVERY settings suffix is POST-only, token-protected and same-origin, and
 *     answers the shared `SettingsResponse` envelope. These transport facts are
 *     real and must stay green.
 *   - the directory/model/workspace behaviors and the immutable resolver
 *     versioning below are the Stage-2 acceptance and are EXPECTED to be red
 *     until the implementation lands. No test accepts an empty ready result and
 *     no fake success is asserted; a red test fails with the real `unsupported`
 *     reason (or the real rejection) instead of a silent pass.
 *
 * The Host and its real composition are exercised over real HTTP, real temp
 * directories with spaces/non-ASCII names, and a controlled provider/secret
 * seam. No real model, real credential or candidate project is used.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalWorkbenchHost, type LocalWorkbenchHost, type LocalWorkbenchHostOptions } from '../../src/app/host.js';
import {
  createHostRuntimeResolverRegistry,
  createHostSettings,
  type HostSettingsAssembly,
  type HostSettingsWorkspaceFacts,
  validateSettingsBaseUrl,
  type HostSettingsModelDefinition,
} from '../../src/app/host-settings.js';
import {
  createWorkbenchRuntimeHostBindings,
  type WorkbenchRuntimeConfiguration,
  type WorkbenchRuntimeProviderDependencies,
} from '../../src/app/runtime-configuration.js';
import {
  SETTINGS_API_PREFIX,
  type DirectoryListing,
  type HostSettingsSnapshot,
  type SettingsResponse,
  type SettingsRoutes,
} from '../../src/app/host-settings-types.js';
import {
  BOOTSTRAP_SUFFIX,
  CORE_API_PREFIX,
  PLATFORM_TOKEN_HEADER,
  PLATFORM_TOKEN_META_NAME,
  type BootstrapResponse,
  type CoreScope,
  type SessionRef,
} from '../../src/app/core-http-types.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/core/agent-runtime/model-budget.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import type {
  QueryRuntimeConfigurationInput,
  ResolvedRuntimeConfiguration,
  RuntimeConfigurationInput,
} from '../../src/core/agent-runtime/execution-contracts.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';

const projectDir = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const at = '2026-09-29T00:00:00.000Z';
const STARTUP_SCOPE: CoreScope = { projectId: 'host-settings-startup', workspaceId: 'host-settings-startup-ws' };
const STARTUP_MODELS: HostSettingsModelDefinition[] = [{
  id: 'startup-deepseek', label: 'Startup DeepSeek', provider: 'deepseek', model: 'deepseek-chat',
  baseUrl: 'http://127.0.0.1:9', secretEnvironmentVariable: 'HOST_SETTINGS_TEST_SECRET',
}];

let publicDir = '';
const temporary: string[] = [];

beforeAll(async () => {
  publicDir = await mkdtemp(join(tmpdir(), 'host-settings-public-'));
  temporary.push(publicDir);
  const build = spawnSync(process.execPath, ['scripts/build-workbench.mjs'], {
    cwd: projectDir, encoding: 'utf8', env: { ...process.env, WORKBENCH_OUT_DIR: publicDir },
  });
  if (build.status !== 0) throw new Error(`workbench build failed: ${build.stdout}\n${build.stderr}`);
}, 120_000);

afterAll(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

type StartOptions = {
  root?: string;
  database?: string;
  settingsDirectory?: string;
  withSettings?: boolean;
  storageKind?: 'sqlite' | 'memory';
  emptyStartup?: boolean;
  runtimeConfiguration?: WorkbenchRuntimeConfiguration;
  runtimeProvider?: WorkbenchRuntimeProviderDependencies;
  kernelStores?: LocalWorkbenchHostOptions['kernelStores'];
};
type Started = {
  host: LocalWorkbenchHost; base: string; token: string; root: string; database: string; settingsDirectory: string;
};

async function startHost(options: StartOptions = {}): Promise<Started> {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'host-settings-ws-'));
  const database = options.database ?? await mkdtemp(join(tmpdir(), 'host-settings-db-'));
  if (options.root === undefined) temporary.push(root);
  if (options.database === undefined) temporary.push(database);
  const settingsDirectory = options.settingsDirectory ?? join(database, 'host-settings');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# host settings startup workspace\n');
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['src/**/*.ts'],
  }));
  const host = await createLocalWorkbenchHost({
    storage: options.storageKind === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory: database },
    actor: { kind: 'human', id: 'host-settings-operator' },
    publicDir,
    now: () => at,
    architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    workspaces: options.emptyStartup === true ? []
      : [{ scope: STARTUP_SCOPE, name: 'Startup workspace', root, workspaceRevision: 1, readPrefixes: ['.'] }],
    ...(options.withSettings === false ? {} : {
      settings: { settingsDirectory, models: structuredClone(STARTUP_MODELS) },
    }),
    ...(options.runtimeConfiguration === undefined ? {} : { runtimeConfiguration: options.runtimeConfiguration }),
    ...(options.runtimeProvider === undefined ? {} : { runtimeProvider: options.runtimeProvider }),
    ...(options.kernelStores === undefined ? {} : { kernelStores: options.kernelStores }),
  });
  const address = await host.listen();
  const token = await readPageToken(address.url);
  return { host, base: address.url, token, root, database, settingsDirectory };
}

async function readPageToken(base: string): Promise<string> {
  const response = await fetch(base);
  expect(response.status).toBe(200);
  const html = await response.text();
  const match = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(html);
  if (match?.[1] === undefined) throw new Error('the page did not expose the runtime token meta');
  return match[1];
}

const settingsUrl = (base: string, suffix: string): string => new URL(SETTINGS_API_PREFIX + suffix, base).toString();

async function settingsPost(base: string, suffix: string, token: string | undefined, body: unknown): Promise<Response> {
  return fetch(settingsUrl(base, suffix), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { [PLATFORM_TOKEN_HEADER]: token }) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function coreGet(base: string, suffix: string, token: string): Promise<Response> {
  return fetch(new URL(CORE_API_PREFIX + suffix, base).toString(), { headers: { [PLATFORM_TOKEN_HEADER]: token } });
}

async function corePost(base: string, suffix: string, token: string, scope: CoreScope, input: unknown): Promise<Response> {
  return fetch(new URL(CORE_API_PREFIX + suffix, base).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
    body: JSON.stringify({ scope, input }),
  });
}

async function coreGraphPost(base: string, suffix: string, token: string, scope: CoreScope,
  input: unknown, requestId: string, expected: unknown[]): Promise<Response> {
  return fetch(new URL(CORE_API_PREFIX + suffix, base).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
    body: JSON.stringify({ scope, request: { input, meta: { requestId, expected } } }),
  });
}

const workspaceRef = (scope: CoreScope) => ({ aggregateType: 'Workspace' as const, ...scope });

/** Stage-1 skeleton failure aid: surface the real rejection reason instead of a
 * downstream TypeError when a route is still unimplemented. */
function expectReady<T>(response: SettingsResponse<T>): T {
  if (response.status !== 'ready') throw new Error(`expected a ready settings response, got ${response.code}: ${response.reason}`);
  return response.value;
}

type OpenValue = SettingsRoutes['workspaces/open']['value'];

describe('HOST settings Stage-1 transport wiring', () => {
  it('publishes every settings suffix as a POST-only, token-protected same-origin route', async () => {
    // The base URL contract is a pure function of this seam: only an absolute
    // http(s) URL without userinfo/credential query is accepted, so a snapshot
    // that echoes baseUrl back can never leak a secret.
    expect(validateSettingsBaseUrl('https://api.example.com/v1')).toBeNull();
    expect(validateSettingsBaseUrl('http://127.0.0.1:8080/v1')).toBeNull();
    expect(validateSettingsBaseUrl('https://api.example.com/v1?model=deepseek-chat')).toBeNull();
    expect(validateSettingsBaseUrl('ftp://api.example.com/v1')).not.toBeNull();
    expect(validateSettingsBaseUrl('https://user:secret@api.example.com/v1')).not.toBeNull();
    expect(validateSettingsBaseUrl('https://api.example.com/v1?api_key=sk-secret')).not.toBeNull();

    const started = await startHost();
    try {
      const get = await fetch(settingsUrl(started.base, 'snapshot'));
      expect(get.status).toBe(405);

      const noToken = await settingsPost(started.base, 'snapshot', undefined, {});
      expect(noToken.status).toBe(403);

      const valid = await settingsPost(started.base, 'snapshot', started.token, {});
      expect(valid.status).not.toBe(404);
      const payload = await valid.json() as { status?: unknown };
      expect(['ready', 'rejected']).toContain(payload.status);

      const unknown = await settingsPost(started.base, 'not-a-route', started.token, {});
      expect(unknown.status).toBe(404);

      const malformed = await settingsPost(started.base, 'snapshot', started.token, '{not json');
      expect(malformed.status).toBe(400);

      const crossOrigin = await fetch(settingsUrl(started.base, 'snapshot'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: started.token, origin: 'http://evil.example' },
        body: '{}',
      });
      expect(crossOrigin.status).toBe(403);
    } finally {
      await started.host.close();
    }
  });

  it('fails startup explicitly on a corrupt private settings file instead of an empty configuration', async () => {
    const database = await mkdtemp(join(tmpdir(), 'host-settings-corrupt-db-'));
    temporary.push(database);
    const settingsDirectory = join(database, 'host-settings');
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(join(settingsDirectory, 'host-settings.json'), '{ this is not valid settings json');
    await expect(startHost({ database, settingsDirectory })).rejects.toThrow(/host settings file/i);

    // A persisted catalog whose baseUrl would echo a secret is rejected too.
    await writeFile(join(settingsDirectory, 'host-settings.json'), JSON.stringify({
      schemaVersion: 1,
      models: [{ id: 'm', label: 'M', provider: 'deepseek', model: 'deepseek-chat',
        baseUrl: 'https://user:secret@api.example.com/v1' }],
      selection: {}, workspaces: [],
    }));
    await expect(startHost({ database, settingsDirectory })).rejects.toThrow(/host settings file/i);
  });

  it('keeps an in-memory Host with no persistent directory unsupported', async () => {
    const started = await startHost({ storageKind: 'memory', withSettings: false });
    try {
      const response = await settingsPost(started.base, 'snapshot', started.token, {});
      expect(response.status).toBe(501);
      expect(await response.json()).toMatchObject({ status: 'rejected', code: 'unsupported' });
    } finally {
      await started.host.close();
    }
  });
});

describe('HOST settings real directories', () => {
  it('lists a real directory with spaces and non-ASCII names canonically', async () => {
    const started = await startHost();
    try {
      const baseDir = await mkdtemp(join(tmpdir(), 'host-settings-dirs-'));
      temporary.push(baseDir);
      await mkdir(join(baseDir, '日本語 with space'));
      await mkdir(join(baseDir, '.hidden-dir'));
      await writeFile(join(baseDir, 'README.md'), '# listing\n');

      const listing = expectReady(await (await settingsPost(started.base, 'directories', started.token,
        { path: baseDir, showHidden: true })).json() as SettingsResponse<DirectoryListing>);
      const canonical = await realpath(baseDir);
      expect(listing.path).toBe(canonical);
      expect(listing.truncated).toBe(false);
      const names = listing.directories.map(entry => entry.name);
      expect(names).toContain('日本語 with space');
      expect(names).toContain('.hidden-dir');
      expect(listing.directories.find(entry => entry.name === '日本語 with space')?.path)
        .toBe(join(canonical, '日本語 with space'));
    } finally {
      await started.host.close();
    }
  });

  it('rejects a missing directory without registering anything', async () => {
    const started = await startHost();
    try {
      const missing = join(await mkdtemp(join(tmpdir(), 'host-settings-missing-')), 'does-not-exist');
      const response = await settingsPost(started.base, 'workspaces/open', started.token,
        { path: missing, writeAllowed: true, commandsAllowed: true });
      expect(await response.json()).toMatchObject({ status: 'rejected', code: 'not_found' });
    } finally {
      await started.host.close();
    }
  });
});

describe('HOST settings workspace open and isolation', () => {
  it('opens a real directory as a new project and serves a formal read in the new scope', async () => {
    const started = await startHost();
    try {
      const root = await mkdtemp(join(tmpdir(), 'host-settings-open-'));
      temporary.push(root);
      await writeFile(join(root, 'hello world.txt'), 'opened directory content\n');

      const open = await settingsPost(started.base, 'workspaces/open', started.token,
        { path: root, writeAllowed: false, commandsAllowed: false });
      const opened = expectReady(await open.json() as SettingsResponse<OpenValue>);
      expect(opened.bootstrap.workspaces.some(workspace =>
        workspace.scope.projectId === opened.scope.projectId
        && workspace.scope.workspaceId === opened.scope.workspaceId)).toBe(true);

      // Frozen bootstrap semantics: a directory opened with NO selected model
      // has NO executable profile. Neither the open response nor the public GET
      // bootstrap may advertise a profile whose scope has no successfully
      // installed runtime binding.
      const openedScopeProfiles = (bootstrap: BootstrapResponse) =>
        bootstrap.execution.queryProfiles.filter(profile =>
          profile.scope.projectId === opened.scope.projectId
          && profile.scope.workspaceId === opened.scope.workspaceId);
      expect(openedScopeProfiles(opened.bootstrap)).toEqual([]);
      const publishedBootstrap = await (await coreGet(started.base, BOOTSTRAP_SUFFIX, started.token))
        .json() as BootstrapResponse;
      expect(openedScopeProfiles(publishedBootstrap)).toEqual([]);

      const file = await corePost(started.base, 'files/read', started.token, opened.scope,
        { workspace: workspaceRef(opened.scope), path: 'hello world.txt', maxBytes: 4096, version: { kind: 'working_tree' } });
      expect(await file.json()).toMatchObject({
        status: 'ready', value: { path: 'hello world.txt', content: 'opened directory content\n' },
      });

      // A command grant always requires write access.
      const deniedCommands = await settingsPost(started.base, 'workspaces/open', started.token,
        { path: root, writeAllowed: false, commandsAllowed: true });
      expect(await deniedCommands.json()).toMatchObject({ status: 'rejected', code: 'invalid' });

      // Opening a directory never writes into the target project.
      expect(await readdir(root)).toEqual(['hello world.txt']);

      // Re-opening the same canonical root WITHOUT a project is a ready
      // idempotent lookup of the SAME scope, never a new project.
      const retry = await settingsPost(started.base, 'workspaces/open', started.token,
        { path: root, writeAllowed: false, commandsAllowed: false });
      expect(expectReady(await retry.json() as SettingsResponse<OpenValue>).scope).toEqual(opened.scope);

      // A wider duplicate under the same project returns the SAME scope and does
      // NOT silently widen the stored/mounted permissions.
      const duplicate = await settingsPost(started.base, 'workspaces/open', started.token,
        { path: root, projectId: opened.scope.projectId, writeAllowed: true, commandsAllowed: true });
      const duplicateValue = expectReady(await duplicate.json() as SettingsResponse<OpenValue>);
      expect(duplicateValue.scope).toEqual(opened.scope);
      expect(duplicateValue.settings.workspaces.find(workspace => workspace.scope.workspaceId === opened.scope.workspaceId))
        .toMatchObject({ writeAllowed: false, commandsAllowed: false });

      // A public explicit projectId must be a CURRENT Host project.
      const unknownProject = await settingsPost(started.base, 'workspaces/open', started.token,
        { path: root, projectId: 'no-such-host-project', writeAllowed: false, commandsAllowed: false });
      expect(await unknownProject.json()).toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await started.host.close();
    }
  });

  it('starts an empty settings shell with no startup workspace and opens the first directory', async () => {
    const started = await startHost({ emptyStartup: true });
    try {
      const empty = expectReady(await (await settingsPost(started.base, 'snapshot', started.token, {}))
        .json() as SettingsResponse<HostSettingsSnapshot>);
      expect(empty.workspaces).toEqual([]);
      const root = await mkdtemp(join(tmpdir(), 'host-settings-shell-'));
      temporary.push(root);
      await writeFile(join(root, 'only.txt'), 'shell\n');
      const opened = expectReady(await (await settingsPost(started.base, 'workspaces/open', started.token,
        { path: root, writeAllowed: false, commandsAllowed: false })).json() as SettingsResponse<OpenValue>);
      const file = await corePost(started.base, 'files/read', started.token, opened.scope,
        { workspace: workspaceRef(opened.scope), path: 'only.txt', maxBytes: 1024, version: { kind: 'working_tree' } });
      expect(await file.json()).toMatchObject({ status: 'ready', value: { content: 'shell\n' } });
    } finally {
      await started.host.close();
    }
  });

  it('keeps two workspaces of one project and another project isolated for real reads', async () => {
    const started = await startHost();
    try {
      const dirA = await mkdtemp(join(tmpdir(), 'host-settings-a-'));
      const dirB = await mkdtemp(join(tmpdir(), 'host-settings-b-'));
      const dirC = await mkdtemp(join(tmpdir(), 'host-settings-c-'));
      temporary.push(dirA, dirB, dirC);
      await writeFile(join(dirA, 'only-a.txt'), 'A\n');
      await writeFile(join(dirC, 'only-c.txt'), 'C\n');

      const open = async (path: string, projectId?: string) => expectReady(
        await (await settingsPost(started.base, 'workspaces/open', started.token,
          { path, ...(projectId === undefined ? {} : { projectId }), writeAllowed: true, commandsAllowed: false }))
          .json() as SettingsResponse<OpenValue>);
      const a = await open(dirA);
      const b = await open(dirB, a.scope.projectId);
      const c = await open(dirC);

      expect(b.scope.projectId).toBe(a.scope.projectId);
      expect(b.scope.workspaceId).not.toBe(a.scope.workspaceId);
      expect(c.scope.projectId).not.toBe(a.scope.projectId);

      const readA = await corePost(started.base, 'files/read', started.token, a.scope,
        { workspace: workspaceRef(a.scope), path: 'only-a.txt', maxBytes: 1024, version: { kind: 'working_tree' } });
      expect(await readA.json()).toMatchObject({ status: 'ready', value: { path: 'only-a.txt', content: 'A\n' } });

      const cross = await corePost(started.base, 'files/read', started.token, c.scope,
        { workspace: workspaceRef(c.scope), path: 'only-a.txt', maxBytes: 1024, version: { kind: 'working_tree' } });
      expect(await cross.json()).toMatchObject({ status: 'rejected' });
    } finally {
      await started.host.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Model catalog, selection and the real Host effect. The controlled provider
// records the exact model/baseUrl/apiKey used to create a client; the Query
// chain below is the real public `submit -> claim -> prepare` path, so a green
// result proves the settings selection actually reached the Host client.
// ---------------------------------------------------------------------------

const HOST_SECRET_VAR = 'HOST_SETTINGS_CONTROLLED_SECRET';
const HOST_SECRET_VALUE = 'host-settings-startup-secret';
const HOST_QUERY_ROLE = { kind: 'legacy_template' as const, templateId: 'advisor', templateRevision: '1' };
const HOST_QUERY_ROLE_BINDING = {
  schemaVersion: 1 as const, bindingId: 'host-settings-query-binding', templateId: 'advisor', templateRevision: '1',
  bindingVersion: 1, policyRevision: 'legacy-template',
};
const HOST_RUNTIME_BUDGET = { ...DEFAULT_RUNTIME_BUDGET, maxRequests: 8, maxToolCalls: 8, timeoutMs: 30_000 };

function controlledHostProvider() {
  const createCalls: { provider: string; model: string; baseUrl: string | undefined; apiKey: string | undefined }[] = [];
  const secretReads: string[] = [];
  const client = { async *stream() { throw new Error('the Host settings test never streams a model'); } } as unknown as kernel.ModelClientPort;
  const definition = {
    id: 'deepseek' as const,
    secretEnvironmentVariable: HOST_SECRET_VAR,
    defaultBaseUrl: 'http://127.0.0.1:9',
    capabilities: { streaming: true as const, toolCalls: true as const, usage: true as const },
    create: () => client,
  };
  const registry: NonNullable<WorkbenchRuntimeProviderDependencies['registry']> = {
    get: () => definition,
    create: (id, options) => {
      createCalls.push({ provider: id, model: options.model, baseUrl: options.baseUrl, apiKey: options.apiKey });
      return client;
    },
  };
  const secretSource = {
    get: (name: string) => { secretReads.push(name); return name === HOST_SECRET_VAR ? HOST_SECRET_VALUE : undefined; },
  };
  return { registry, secretSource, createCalls, secretReads, client };
}

function hostRuntimeConfiguration(): WorkbenchRuntimeConfiguration {
  const skillsRoot = resolve(import.meta.dirname, '../../resources/skills');
  return {
    schemaVersion: 1,
    bindings: [{
      id: 'host-settings-startup-binding', label: 'Host settings startup query', scope: STARTUP_SCOPE,
      role: HOST_QUERY_ROLE, configurationRevision: 'host-settings-startup@1',
      model: { revision: 'host-settings-startup-model@1', provider: 'deepseek', model: 'startup-model',
        secretEnvironmentVariable: HOST_SECRET_VAR },
      grant: {
        budget: HOST_RUNTIME_BUDGET,
        hostTemplate: { templateId: 'advisor', revision: '1', digest: sha256Hex('host-settings startup guidance') },
        tools: ['read'], writeScope: [], skills: { resourceRoot: skillsRoot, enabledIds: ['platform-work'] },
        systemInstruction: 'host-settings startup guidance', deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      },
    }],
    queryProfiles: [{
      id: 'host-settings-startup-query', label: 'Startup query', scope: STARTUP_SCOPE,
      runtimeBindingId: 'host-settings-startup-binding', sessionRole: HOST_QUERY_ROLE,
      roleBinding: HOST_QUERY_ROLE_BINDING, runtimeBudget: HOST_RUNTIME_BUDGET,
      budget: { maxTokens: 200_000, deadline: null }, consumerId: 'host-settings-consumer',
    }],
  };
}

/** Drive the real public submit -> claim -> prepare path for one scope and
 * return the prepared result; the caller asserts which client the controlled
 * provider built. */
async function prepareHostQuery(started: Started, scope: CoreScope, suffix: string): Promise<unknown> {
  const registration = await (await corePost(started.base, 'workspaces/registration', started.token, scope, scope))
    .json() as ReadResult<{ project: { revision: number }; workspace: { revision: number } }>;
  if (registration.status !== 'ready') throw new Error(`registration was not ready: ${JSON.stringify(registration)}`);

  const bootstrap = await (await coreGet(started.base, BOOTSTRAP_SUFFIX, started.token)).json() as BootstrapResponse;
  const profile = bootstrap.execution.queryProfiles.find(entry =>
    entry.scope.projectId === scope.projectId && entry.scope.workspaceId === scope.workspaceId);
  if (profile === undefined) throw new Error('the opened scope has no trusted query profile in bootstrap');

  const projectRef = { aggregateType: 'Project' as const, projectId: scope.projectId };
  const scopeWorkspaceRef = workspaceRef(scope);
  const goalId = `host-settings-goal-${suffix}`;
  const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId };
  const goalCreated = await coreGraphPost(started.base, 'goals/create', started.token, scope,
    { goalId, workspace: scope, objective: 'Prove the selected model reaches the Host client' }, `host-settings-goal-${suffix}`,
    [{ ref: projectRef, revision: registration.value.project.revision },
      { ref: scopeWorkspaceRef, revision: registration.value.workspace.revision }]);
  if ((await goalCreated.json() as { status?: string }).status !== 'committed')
    throw new Error('goal creation did not commit');
  const goalRead = await (await corePost(started.base, 'goals/read', started.token, scope, goalRef))
    .json() as ReadResult<{ goal: { revision: number } }>;
  if (goalRead.status !== 'ready') throw new Error('the goal was not readable');

  const sessionCreated = await (await corePost(started.base, 'sessions/create', started.token, scope, {
    workspace: scope, role: profile.sessionRole, recommendedRefs: [], initialLinks: [],
    meta: { requestId: `host-settings-session-${suffix}`, expected: [] },
  })).json() as { status: string; value?: { ref: { projectId: string; sessionId: string }; revision: number } };
  if (sessionCreated.status !== 'completed' || sessionCreated.value === undefined)
    throw new Error(`session creation did not complete: ${JSON.stringify(sessionCreated)}`);
  const sessionAggregateRef = sessionCreated.value.ref;
  const sessionRef: SessionRef = { projectId: sessionAggregateRef.projectId, sessionId: sessionAggregateRef.sessionId };

  const queryJobId = `host-settings-query-${suffix}`;
  const runId = `host-settings-run-${suffix}`;
  const queryJobRef = { aggregateType: 'QueryJob' as const, ...scope, queryJobId };
  const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', ...scope, queryJobId, runId };
  const intent = {
    schemaVersion: 1, intentId: queryJobId, projectId: scope.projectId, workspaceId: scope.workspaceId,
    goalId, question: 'Which model does this workspace use?', focusTaskRefs: [],
    budget: profile.budget, multiTurn: { maxRounds: 1 }, correlationId: `host-settings-corr-${suffix}`,
    execution: { kind: 'semantic_query', roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget },
  };
  const submitted = await coreGraphPost(started.base, 'queries/submit', started.token, scope,
    { queryJobId, runId, intent }, `host-settings-submit-${suffix}`,
    [{ ref: projectRef, revision: registration.value.project.revision },
      { ref: scopeWorkspaceRef, revision: registration.value.workspace.revision },
      { ref: goalRef, revision: goalRead.value.goal.revision },
      { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }]);
  if ((await submitted.json() as { status?: string }).status !== 'committed')
    throw new Error('the query submit did not commit');

  const claimed = await coreGraphPost(started.base, 'queries/claim', started.token, scope,
    { queryRunRef, sessionRef }, `host-settings-claim-${suffix}`,
    [{ ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
      { ref: sessionAggregateRef, revision: sessionCreated.value.revision }]);
  if ((await claimed.json() as { status?: string }).status !== 'committed')
    throw new Error('the query claim did not commit');

  const prepared = await (await corePost(started.base, 'queries/prepare', started.token, scope,
    { queryRunRef, requestId: `host-settings-prepare-${suffix}` })).json() as ReadResult<unknown>;
  if (prepared.status !== 'ready') throw new Error(`query preparation was not ready: ${JSON.stringify(prepared)}`);
  return prepared.value;
}

describe('HOST settings model catalog, selection and Host effect', () => {
  it('saves a model without echoing the key, isolates per-workspace selection, restores after reopen and uses it in the real Query prepare chain', async () => {
    const secret = 'sk-host-settings-stage1-secret';
    const provider = controlledHostProvider();
    const database = await mkdtemp(join(tmpdir(), 'host-settings-models-db-'));
    temporary.push(database);
    const started = await startHost({
      database,
      settingsDirectory: join(database, 'host-settings'),
      runtimeConfiguration: hostRuntimeConfiguration(),
      runtimeProvider: provider,
      kernelStores: { entries: [{ adapterId: 'host-settings-kernel', storeKey: 'host-settings-kernel-store',
        workspace: STARTUP_SCOPE, databasePath: join(database, 'kernel.sqlite') }] },
    });
    let reopened: Started | undefined;
    try {
      // First startup projects the trusted runtime configuration: the existing
      // model is visible (with its env credential reference only) and the scope
      // already has that model selected.
      const initial = expectReady(await (await settingsPost(started.base, 'snapshot', started.token, {}))
        .json() as SettingsResponse<HostSettingsSnapshot>);
      expect(initial.models.some(entry => entry.model === 'startup-model' && entry.credentialConfigured)).toBe(true);
      expect(JSON.stringify(initial)).not.toContain(HOST_SECRET_VALUE);
      expect(initial.workspaces.find(workspace => workspace.scope.workspaceId === STARTUP_SCOPE.workspaceId)?.modelId)
        .not.toBeNull();

      const savedText = await (await settingsPost(started.base, 'models/save', started.token, {
        label: 'Host Settings Selected', provider: 'deepseek', model: 'selected-model-x',
        baseUrl: 'http://127.0.0.1:9', apiKey: secret,
      })).text();
      expect(savedText).not.toContain(secret);
      const saved = expectReady(JSON.parse(savedText) as SettingsResponse<HostSettingsSnapshot>);
      const model = saved.models.find(entry => entry.label === 'Host Settings Selected');
      expect(model).toBeDefined();
      expect(model?.credentialConfigured).toBe(true);
      // The private file is persisted with owner-only permissions.
      const persistedMode = (await stat(join(started.settingsDirectory, 'host-settings.json'))).mode & 0o777;
      expect(persistedMode).toBe(0o600);

      // Concurrent settings writes are serialized by the Host-local queue, so
      // neither save is lost to an interleaved rollback.
      const [concurrentA, concurrentB] = await Promise.all([
        settingsPost(started.base, 'models/save', started.token, { label: 'Concurrent A', provider: 'deepseek', model: 'concurrent-a' }),
        settingsPost(started.base, 'models/save', started.token, { label: 'Concurrent B', provider: 'deepseek', model: 'concurrent-b' }),
      ]);
      expect(concurrentA.status).toBe(200);
      expect(concurrentB.status).toBe(200);
      const afterConcurrent = expectReady(await (await settingsPost(started.base, 'snapshot', started.token, {}))
        .json() as SettingsResponse<HostSettingsSnapshot>);
      expect(afterConcurrent.models.some(entry => entry.label === 'Concurrent A')).toBe(true);
      expect(afterConcurrent.models.some(entry => entry.label === 'Concurrent B')).toBe(true);

      // Two workspaces of ONE project keep independent selections.
      const dirOne = await mkdtemp(join(tmpdir(), 'host-settings-one-'));
      const dirTwo = await mkdtemp(join(tmpdir(), 'host-settings-two-'));
      temporary.push(dirOne, dirTwo);
      const one = expectReady(await (await settingsPost(started.base, 'workspaces/open', started.token,
        { path: dirOne, writeAllowed: false, commandsAllowed: false })).json() as SettingsResponse<OpenValue>);
      const two = expectReady(await (await settingsPost(started.base, 'workspaces/open', started.token,
        { path: dirTwo, projectId: one.scope.projectId, writeAllowed: false, commandsAllowed: false }))
        .json() as SettingsResponse<OpenValue>);
      expect(two.scope.projectId).toBe(one.scope.projectId);

      // Before any selection, neither newly opened scope may publish an
      // executable profile: the installed runtime has no binding for them. The
      // startup scope keeps its real, already-installed profile.
      const beforeSelect = await (await coreGet(started.base, BOOTSTRAP_SUFFIX, started.token))
        .json() as BootstrapResponse;
      const profilesFor = (bootstrap: BootstrapResponse, scope: CoreScope) =>
        bootstrap.execution.queryProfiles.filter(profile =>
          profile.scope.projectId === scope.projectId && profile.scope.workspaceId === scope.workspaceId);
      expect(profilesFor(beforeSelect, one.scope)).toEqual([]);
      expect(profilesFor(beforeSelect, two.scope)).toEqual([]);
      expect(profilesFor(beforeSelect, STARTUP_SCOPE).map(profile => profile.id))
        .toEqual(['host-settings-startup-query']);

      const selected = expectReady(await (await settingsPost(started.base, 'models/select', started.token,
        { scope: one.scope, modelId: model!.id })).json() as SettingsResponse<HostSettingsSnapshot>);
      expect(selected.workspaces.find(workspace => workspace.scope.workspaceId === one.scope.workspaceId)?.modelId)
        .toBe(model!.id);
      expect(selected.workspaces.find(workspace => workspace.scope.workspaceId === two.scope.workspaceId)?.modelId)
        .toBeNull();

      // A successful selection installs that scope's runtime binding, and only
      // then does the published bootstrap expose exactly that one executable
      // profile; the untouched second scope stays without one.
      const afterSelect = await (await coreGet(started.base, BOOTSTRAP_SUFFIX, started.token))
        .json() as BootstrapResponse;
      const installedProfiles = profilesFor(afterSelect, one.scope);
      expect(installedProfiles).toHaveLength(1);
      expect(profilesFor(afterSelect, two.scope)).toEqual([]);
      // Frozen default installed by the local workbench: no hidden cumulative
      // Query token cap. null is neither 0 nor Infinity.
      expect(installedProfiles[0]?.budget).toEqual({ maxTokens: null, deadline: null });

      // The REAL public Host Query prepare chain must build its client from the
      // selected model and key, not from the startup binding.
      await prepareHostQuery(started, one.scope, 'selected');
      expect(provider.createCalls.some(call =>
        call.model === 'selected-model-x' && call.apiKey === secret)).toBe(true);

      // Omitted/empty key retains the stored credential.
      const retained = expectReady(await (await settingsPost(started.base, 'models/save', started.token,
        { id: model!.id, label: model!.label, provider: model!.provider, model: model!.model, apiKey: '' }))
        .json() as SettingsResponse<HostSettingsSnapshot>);
      expect(retained.models.find(entry => entry.id === model!.id)?.credentialConfigured).toBe(true);

      await started.host.close();
      reopened = await startHost({
        database: started.database, settingsDirectory: started.settingsDirectory,
        runtimeConfiguration: hostRuntimeConfiguration(), runtimeProvider: provider,
        kernelStores: { entries: [{ adapterId: 'host-settings-kernel', storeKey: 'host-settings-kernel-store',
          workspace: STARTUP_SCOPE, databasePath: join(started.database, 'kernel.sqlite') }] },
      });
      const restored = expectReady(await (await settingsPost(reopened.base, 'snapshot', reopened.token, {}))
        .json() as SettingsResponse<HostSettingsSnapshot>);
      expect(restored.models.some(entry => entry.id === model!.id && entry.credentialConfigured)).toBe(true);
      expect(restored.workspaces.find(workspace => workspace.scope.workspaceId === one.scope.workspaceId)?.modelId)
        .toBe(model!.id);
      expect(restored.workspaces.find(workspace => workspace.scope.workspaceId === two.scope.workspaceId)?.modelId)
        .toBeNull();
    } finally {
      await reopened?.host.close().catch(() => { /* already closed */ });
      await started.host.close().catch(() => { /* already closed */ });
    }
  });
});

// ---------------------------------------------------------------------------
// Immutable resolver versioning seam. This is a real Host-binding exercise with
// a controlled provider registry and a controlled SecretSource; it never starts
// a model stream. It pins: first resolve wins, a model/key change only creates a
// new version, and a Work and a Query ref are pinned independently.
// ---------------------------------------------------------------------------

const RESOLVER_PROJECT = 'host-settings-resolver';
const RESOLVER_WS = 'host-settings-resolver-ws';
const RESOLVER_ROLE = {
  kind: 'role_spec',
  pin: {
    ref: { aggregateType: 'RoleSpecRevision', projectId: RESOLVER_PROJECT, roleId: 'builder', revision: 1 },
    digest: 'a'.repeat(64),
  },
} as const;

function runtimeConfig(revision: string): WorkbenchRuntimeConfiguration {
  const configuration = {
    schemaVersion: 1,
    bindings: [{
      id: 'host-settings-binding',
      label: 'HOST settings resolver test',
      scope: { projectId: RESOLVER_PROJECT, workspaceId: RESOLVER_WS },
      role: RESOLVER_ROLE,
      configurationRevision: revision,
      model: { revision, provider: 'deepseek', model: 'host-settings-scripted', baseUrl: 'http://127.0.0.1:9' },
      grant: {
        budget: { ...DEFAULT_RUNTIME_BUDGET, maxRequests: 4, timeoutMs: 30_000 },
        hostTemplate: null,
        tools: ['read'],
        writeScope: [],
        skills: { resourceRoot: resolve(import.meta.dirname, '../../resources/skills'), enabledIds: ['platform-work'] },
        systemInstruction: null,
        deniedPrefixes: [],
        processSandboxOptions: {},
        materialBasis: null,
      },
    }],
    queryProfiles: [],
  };
  return JSON.parse(JSON.stringify(configuration)) as WorkbenchRuntimeConfiguration;
}

function controlledProvider(label: string) {
  const createCalls: { model: string; apiKey: string }[] = [];
  const client = { async *stream() { throw new Error('the resolver test never streams'); } } as unknown as kernel.ModelClientPort;
  const definition = {
    id: 'deepseek' as const,
    secretEnvironmentVariable: `HOST_SETTINGS_${label.toUpperCase()}_SECRET`,
    defaultBaseUrl: 'http://127.0.0.1:9',
    capabilities: { streaming: true as const, toolCalls: true as const, usage: true as const },
    create: () => client,
  };
  const registry: NonNullable<WorkbenchRuntimeProviderDependencies['registry']> = {
    get: () => definition,
    create: (_id, options) => { createCalls.push({ model: options.model, apiKey: options.apiKey }); return client; },
  };
  const secretReads: string[] = [];
  return {
    registry, createCalls, secretReads, client,
    secretSource: { get: (name: string) => { secretReads.push(name); return `${label}-key`; } },
  };
}

function resolverContext(): CoreCallContext {
  const actor = { kind: 'system' as const, id: 'host-settings-resolver-test' };
  return {
    projectId: RESOLVER_PROJECT, workspaceId: RESOLVER_WS,
    principal: { kind: 'host', actor }, materialReader: { kind: 'host', projectId: RESOLVER_PROJECT, workspaceId: RESOLVER_WS, actor },
    signal: new AbortController().signal,
  };
}

function expectResolved(result: ReadResult<ResolvedRuntimeConfiguration>): ResolvedRuntimeConfiguration {
  if (result.status !== 'ready') throw new Error(`expected a ready runtime resolution, got ${result.status}`);
  return result.value;
}

const workInput = (runId: string): RuntimeConfigurationInput => ({
  runRef: { aggregateType: 'Run', projectId: RESOLVER_PROJECT, goalId: 'resolver-goal', runId } as RunRef,
  role: RESOLVER_ROLE, roleResolution: { status: 'absent', roleId: 'builder', reason: 'stage-1 test' },
} as unknown as RuntimeConfigurationInput);

const queryInput = (runId: string): QueryRuntimeConfigurationInput => ({
  queryRunRef: {
    aggregateType: 'QueryRun', projectId: RESOLVER_PROJECT, workspaceId: RESOLVER_WS,
    queryJobId: 'resolver-query', runId,
  } as QueryRunRef,
  sessionRef: { aggregateType: 'Session', projectId: RESOLVER_PROJECT, workspaceId: RESOLVER_WS, sessionId: 'resolver-session' },
  role: RESOLVER_ROLE, roleResolution: { status: 'absent', roleId: 'builder', reason: 'stage-1 test' },
} as unknown as QueryRuntimeConfigurationInput);

describe('HOST settings immutable resolver versions', () => {
  it('pins only after a ready resolve, retries a rejected ref, and never swaps an old ref credential', async () => {
    const a = controlledProvider('a');
    const b = controlledProvider('b');
    const bindingsNoKey = createWorkbenchRuntimeHostBindings(runtimeConfig('rev-1'), { registry: a.registry, secretSource: { get: () => undefined } });
    const bindingsA = createWorkbenchRuntimeHostBindings(runtimeConfig('rev-1'), { registry: a.registry, secretSource: a.secretSource });
    const bindingsB = createWorkbenchRuntimeHostBindings(runtimeConfig('rev-1'), { registry: b.registry, secretSource: b.secretSource });
    const resolvers = createHostRuntimeResolverRegistry(bindingsNoKey);
    const ctx = resolverContext();

    // No key yet: the resolution is rejected and MUST NOT be pinned, so the same
    // not-yet-prepared Run can retry after the settings change.
    expect((await resolvers.resolveConfiguration(ctx, workInput('retry-run'))).status).toBe('rejected');
    resolvers.install(bindingsA);
    const retried = expectResolved(await resolvers.resolveConfiguration(ctx, workInput('retry-run')));
    expect(retried.model.client).toBe(a.client);

    // First SUCCESSFUL resolution of the old Work Run (the prepare path) pins A.
    const prepared = expectResolved(await resolvers.resolveConfiguration(ctx, workInput('old-run')));
    expect(prepared.model.client).toBe(a.client);
    expect(a.createCalls.map(call => call.apiKey)).toEqual(['a-key']);
    expect(b.createCalls).toEqual([]);

    // The Query ref must ALSO be pinned before the newer version exists.
    const oldQueryBefore = expectResolved(await resolvers.resolveQueryConfiguration!(ctx, queryInput('old-query')));
    expect(oldQueryBefore.model.client).toBe(a.client);

    // A model/key change installs a NEW immutable version. The old Work/Query
    // refs, already prepared but not started, keep A's client and credential.
    const installed = resolvers.install(bindingsB);
    expect(installed).toBeGreaterThan(0);
    const started = expectResolved(await resolvers.resolveConfiguration(ctx, workInput('old-run')));
    expect(started.model.client).toBe(a.client);
    const oldQueryAfter = expectResolved(await resolvers.resolveQueryConfiguration!(ctx, queryInput('old-query')));
    expect(oldQueryAfter.model.client).toBe(a.client);
    // A's one binding caches one client shared by its Work and Query branches.
    expect(a.createCalls.map(call => call.apiKey)).toEqual(['a-key']);
    expect(b.createCalls).toEqual([]);

    // Only NEW refs use the newest version and its updated credential.
    const fresh = expectResolved(await resolvers.resolveConfiguration(ctx, workInput('new-run')));
    expect(fresh.model.client).toBe(b.client);
    const freshQuery = expectResolved(await resolvers.resolveQueryConfiguration!(ctx, queryInput('new-query')));
    expect(freshQuery.model.client).toBe(b.client);
    expect(b.createCalls.map(call => call.apiKey)).toEqual(['b-key']);
  });
});

// ---------------------------------------------------------------------------
// R6 cold-start Stage-1 contract: explicit per-workspace approval of the checks
// suggested by one saved initial-plan Answer. Stage 1 publishes the route/DTO
// and stays `unsupported`; the behavior below is the Stage-2 acceptance.
// ---------------------------------------------------------------------------

const checkBody = (checkId: string, command: string) => ({
  checkId, kind: 'static' as const, command, cwd: '.', timeoutMs: 60_000, taskIds: 'all' as const,
});
const answerRefForScope = (scope: CoreScope, suffix: string) => ({
  aggregateType: 'QueryJobAnswer' as const, ...scope, queryJobId: `job-${suffix}`, answerId: `answer-${suffix}`,
});

describe('HOST settings workspace check approval (R6 cold-start)', () => {
  it('uses authoritative saved proposal facts, persists checks per scope and keeps command grants', async () => {
    const database = await mkdtemp(join(tmpdir(), 'host-settings-checks-db-'));
    temporary.push(database);
    const facts: HostSettingsWorkspaceFacts[] = [];
    const reads: { scope: CoreScope; answerRef: ReturnType<typeof answerRefForScope> }[] = [];
    const proposals = new Map<string, { answerRef: ReturnType<typeof answerRefForScope>; answerDigest: string; checks: ReturnType<typeof checkBody>[] }>();
    const assembly: HostSettingsAssembly = {
      listWorkspaces: () => facts,
      listProjectIds: () => ['checks-project'],
      secretConfigured: () => false,
      bootstrap: () => ({}) as BootstrapResponse, // not consumed by these direct settings assertions
      async openWorkspace(request) {
        let fact = facts.find(item => item.root === request.path);
        if (fact === undefined) {
          fact = { scope: { projectId: 'checks-project', workspaceId: request.workspaceId ?? `workspace-${facts.length}` },
            name: request.name ?? 'checks', root: request.path, workspaceRevision: 1, modelId: null,
            writeAllowed: request.writeAllowed, commandsAllowed: request.commandsAllowed };
          facts.push(fact);
        }
        return { status: 'ready', value: { scope: fact.scope } };
      },
      async readCheckProposal(scope, answerRef) {
        reads.push({ scope: structuredClone(scope), answerRef: structuredClone(answerRef) });
        const saved = proposals.get(answerRef.answerId);
        if (saved === undefined || JSON.stringify(saved.answerRef) !== JSON.stringify(answerRef)
          || answerRef.projectId !== scope.projectId || answerRef.workspaceId !== scope.workspaceId) {
          return { status: 'rejected', code: 'not_found', reason: 'saved Answer not found in this scope' };
        }
        return { status: 'ready', value: structuredClone(saved) };
      },
    };
    const options = { settingsDirectory: join(database, 'settings'), assembly };
    const callbacks = { onConfigurationChanged() {} };
    const settings = await createHostSettings(options, callbacks);
    const opened = [];
    for (const commandsAllowed of [true, true, false]) {
      const dir = await mkdtemp(join(tmpdir(), 'checks-source-')); temporary.push(dir);
      opened.push(expectReady(await settings.call('workspaces/open', { path: dir, writeAllowed: true, commandsAllowed })));
    }
    const [a, b, locked] = opened;
    if (a === undefined || b === undefined || locked === undefined) throw Error('missing workspace fixture');
    const save = (scope: CoreScope, suffix: string) => {
      const saved = { answerRef: answerRefForScope(scope, suffix), answerDigest: `saved-digest-${suffix}`,
        checks: [checkBody(`c-${suffix}`, `node --test ${suffix}`)] };
      proposals.set(saved.answerRef.answerId, saved);
      return { scope, answerRef: saved.answerRef, checks: saved.checks };
    };
    const inputA = save(a.scope, 'a'), inputB = save(b.scope, 'b');
    const first = expectReady(await settings.call('checks/approve', inputA));
    expect(reads).toContainEqual({ scope: a.scope, answerRef: inputA.answerRef });
    expect(first.workspaces.find(item => item.scope.workspaceId === a.scope.workspaceId)?.checks).toEqual(inputA.checks);
    const second = expectReady(await settings.call('checks/approve', inputB));
    expect(second.workspaces.find(item => item.scope.workspaceId === a.scope.workspaceId)?.checks).toEqual(inputA.checks);
    expect(second.workspaces.find(item => item.scope.workspaceId === b.scope.workspaceId)?.checks).toEqual(inputB.checks);
    expect(await settings.call('checks/approve', { ...inputA, answerRef: answerRefForScope(a.scope, 'missing') })).toMatchObject({ status: 'rejected', code: 'not_found' });
    expect(await settings.call('checks/approve', save(locked.scope, 'locked'))).toMatchObject({ status: 'rejected' });
    const reopened = await createHostSettings(options, callbacks);
    const restored = expectReady(await reopened.call('snapshot', {}));
    expect(restored.workspaces.find(item => item.scope.workspaceId === a.scope.workspaceId)?.checks).toEqual(inputA.checks);
    expect(restored.workspaces.find(item => item.scope.workspaceId === b.scope.workspaceId)?.checks).toEqual(inputB.checks);
  });
});
