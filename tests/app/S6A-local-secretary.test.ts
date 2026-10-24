/**
 * The local workbench's secretary: a directory opened through Host settings and
 * given a selected model publishes the builtin local-workbench profile FIRST and
 * a platform-secretary profile second, so a request written in that directory
 * finds a secretary binding while plain Queries keep the local profile.
 *
 * Every state below is reached through the Host-settings and core HTTP routes;
 * no store is opened and no record is written by hand.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorkbenchHost, type LocalWorkbenchHost, type LocalWorkbenchHostOptions } from '../../src/app/host.js';
import type { HostSettingsModelDefinition } from '../../src/app/host-settings.js';
import {
  type HostSettingsSnapshot,
  type SettingsResponse,
  type SettingsRoutes,
} from '../../src/app/host-settings-types.js';
import {
  BOOTSTRAP_SUFFIX,
  CORE_API_PREFIX,
  PLATFORM_TOKEN_HEADER,
  type BootstrapExecutionQueryProfile,
  type BootstrapResponse,
  type CoreScope,
  type SessionRef,
} from '../../src/app/core-http-types.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { writeHostPage } from '../helpers/host-page.js';
import { readPageToken } from '../helpers/AG2b-collaboration-fixture.js';
import { createScriptedModel, type ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { corePost, graphWrite, plain, settingsPost, workspaceRef } from './support/S8A-L8-host.js';

const at = '2026-10-29T00:00:00.000Z';
const STARTUP_SCOPE: CoreScope = { projectId: 'local-secretary-startup', workspaceId: 'local-secretary-startup-ws' };
const SECRET_VAR = 'LOCAL_SECRETARY_TEST_SECRET';
const SECRET_VALUE = 'sk-local-secretary-test';
const STARTUP_MODELS: HostSettingsModelDefinition[] = [{
  id: 'local-secretary-model', label: 'Local secretary model', provider: 'deepseek', model: 'deepseek-chat',
  baseUrl: 'http://127.0.0.1:9', secretEnvironmentVariable: SECRET_VAR,
}];

let publicDir = '';
const temporary: string[] = [];

beforeAll(async () => {
  publicDir = await mkdtemp(join(tmpdir(), 'local-secretary-public-'));
  temporary.push(publicDir);
  await writeHostPage(publicDir);
});

afterAll(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

type Started = { host: LocalWorkbenchHost; base: string; token: string };

function scriptedProvider(replies: readonly ScriptedReply[]): NonNullable<LocalWorkbenchHostOptions['runtimeProvider']> {
  const scripted = createScriptedModel(replies);
  const definition = {
    id: 'deepseek' as const,
    secretEnvironmentVariable: SECRET_VAR,
    defaultBaseUrl: 'http://127.0.0.1:9',
    capabilities: { streaming: true as const, toolCalls: true as const, usage: true as const },
    create: () => scripted.client,
  };
  return {
    registry: { get: () => definition, create: () => scripted.client },
    secretSource: { get: (name: string) => (name === SECRET_VAR ? SECRET_VALUE : undefined) },
  };
}

async function startLocalSecretaryHost(replies: readonly ScriptedReply[]): Promise<Started> {
  const root = await mkdtemp(join(tmpdir(), 'local-secretary-ws-'));
  const database = await mkdtemp(join(tmpdir(), 'local-secretary-db-'));
  temporary.push(root, database);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# local secretary workspace\n');
  const host = await createLocalWorkbenchHost({
    storage: { kind: 'sqlite', directory: database },
    actor: { kind: 'human', id: 'local-secretary-operator' },
    publicDir,
    now: () => at,
    architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    workspaces: [{ scope: STARTUP_SCOPE, name: 'Startup workspace', root, workspaceRevision: 1, readPrefixes: ['.'] }],
    settings: { settingsDirectory: join(database, 'host-settings'), models: structuredClone(STARTUP_MODELS) },
    runtimeProvider: scriptedProvider(replies),
    requestDriver: 'off',
  });
  const address = await host.listen();
  return { host, base: address.url, token: await readPageToken(address.url) };
}

async function coreGet(base: string, suffix: string, token: string): Promise<Response> {
  return fetch(new URL(CORE_API_PREFIX + suffix, base).toString(), { headers: { [PLATFORM_TOKEN_HEADER]: token } });
}

function expectReady<T>(response: SettingsResponse<T>): T {
  if (response.status !== 'ready') throw new Error(`expected a ready settings response, got ${response.code}: ${response.reason}`);
  return response.value;
}

type OpenValue = SettingsRoutes['workspaces/open']['value'];
type QueryRead = { job: Record<string, unknown>; run: { run: Record<string, unknown> } };

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const hashOf = (scope: CoreScope): string => sha256(`${scope.projectId}\u0000${scope.workspaceId}`).slice(0, 16);

/** Open a real directory, select a catalog model, and return the opened scope.
 * `writable` opens it with the real write and command grant. */
async function openAndSelect(started: Started, writable = false): Promise<{ scope: CoreScope; modelId: string }> {
  const root = await mkdtemp(join(tmpdir(), 'local-secretary-opened-'));
  temporary.push(root);
  await writeFile(join(root, 'notes.md'), '# opened directory\n');
  const opened = expectReady(await (await settingsPost(started.base, 'workspaces/open', started.token,
    { path: root, writeAllowed: writable, commandsAllowed: writable })).json() as SettingsResponse<OpenValue>);
  const snapshot = expectReady(await (await settingsPost(started.base, 'snapshot', started.token, {}))
    .json() as SettingsResponse<HostSettingsSnapshot>);
  const model = snapshot.models.find(entry => entry.model === 'deepseek-chat');
  if (model === undefined) throw new Error('the catalog did not project the startup model');
  const selected = await settingsPost(started.base, 'models/select', started.token,
    { scope: opened.scope, modelId: model.id });
  expect(selected.status).toBe(200);
  return { scope: opened.scope, modelId: model.id };
}

async function profilesOf(started: Started, scope: CoreScope): Promise<BootstrapExecutionQueryProfile[]> {
  const bootstrap = await (await coreGet(started.base, BOOTSTRAP_SUFFIX, started.token)).json() as BootstrapResponse;
  return bootstrap.execution.queryProfiles.filter(profile =>
    profile.scope.projectId === scope.projectId && profile.scope.workspaceId === scope.workspaceId);
}

/** Drive the real public submit -> claim -> prepare -> start path for one plain
 * Query with the given published profile, then read the settled run through
 * `queries/read`. */
async function runPlainQuery(started: Started, scope: CoreScope,
  profile: BootstrapExecutionQueryProfile, suffix: string): Promise<QueryRead> {
  const registration = await (await corePost(started.base, 'workspaces/registration', started.token, plain(scope, scope)))
    .json() as ReadResult<{ project: { revision: number }; workspace: { revision: number } }>;
  if (registration.status !== 'ready') throw new Error(`registration was not ready: ${JSON.stringify(registration)}`);

  const projectRef = { aggregateType: 'Project' as const, projectId: scope.projectId };
  const scopeWorkspaceRef = workspaceRef(scope);
  const goalId = `local-secretary-goal-${suffix}`;
  const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId };
  const goalCreated = await corePost(started.base, 'goals/create', started.token, graphWrite(scope,
    { goalId, workspace: scope, objective: 'Run one plain Query with a published profile' }, `local-secretary-goal-${suffix}`,
    [{ ref: projectRef, revision: registration.value.project.revision },
      { ref: scopeWorkspaceRef, revision: registration.value.workspace.revision }]));
  if ((await goalCreated.json() as { status?: string }).status !== 'committed')
    throw new Error('goal creation did not commit');
  const goalRead = await (await corePost(started.base, 'goals/read', started.token, plain(scope, goalRef)))
    .json() as ReadResult<{ goal: { revision: number } }>;
  if (goalRead.status !== 'ready') throw new Error('the goal was not readable');

  const sessionCreated = await (await corePost(started.base, 'sessions/create', started.token, plain(scope, {
    workspace: scope, role: profile.sessionRole, recommendedRefs: [], initialLinks: [],
    meta: { requestId: `local-secretary-session-${suffix}`, expected: [] },
  }))).json() as { status: string; value?: { ref: { projectId: string; sessionId: string }; revision: number } };
  if (sessionCreated.status !== 'completed' || sessionCreated.value === undefined)
    throw new Error(`session creation did not complete: ${JSON.stringify(sessionCreated)}`);
  const sessionAggregateRef = sessionCreated.value.ref;
  const sessionRef: SessionRef = { projectId: sessionAggregateRef.projectId, sessionId: sessionAggregateRef.sessionId };

  const queryJobId = `local-secretary-query-${suffix}`;
  const runId = `local-secretary-run-${suffix}`;
  const queryJobRef = { aggregateType: 'QueryJob' as const, ...scope, queryJobId };
  const queryRunRef = { aggregateType: 'QueryRun', ...scope, queryJobId, runId };
  const submitted = await corePost(started.base, 'queries/submit', started.token, graphWrite(scope, {
    queryJobId, runId,
    intent: {
      schemaVersion: 1, intentId: queryJobId, projectId: scope.projectId, workspaceId: scope.workspaceId,
      goalId, question: 'Which profile does this directory publish?', focusTaskRefs: [],
      budget: profile.budget, multiTurn: { maxRounds: 1 }, correlationId: `local-secretary-corr-${suffix}`,
      execution: { kind: 'semantic_query', roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget },
    },
  }, `local-secretary-submit-${suffix}`,
  [{ ref: projectRef, revision: registration.value.project.revision },
    { ref: scopeWorkspaceRef, revision: registration.value.workspace.revision },
    { ref: goalRef, revision: goalRead.value.goal.revision },
    { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }]));
  if ((await submitted.json() as { status?: string }).status !== 'committed')
    throw new Error('the query submit did not commit');

  const claimed = await corePost(started.base, 'queries/claim', started.token, graphWrite(scope,
    { queryRunRef, sessionRef }, `local-secretary-claim-${suffix}`,
    [{ ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
      { ref: sessionAggregateRef, revision: sessionCreated.value.revision }]));
  if ((await claimed.json() as { status?: string }).status !== 'committed')
    throw new Error('the query claim did not commit');

  const prepared = await (await corePost(started.base, 'queries/prepare', started.token, plain(scope,
    { queryRunRef, requestId: `local-secretary-prepare-${suffix}` }))).json() as ReadResult<unknown>;
  if (prepared.status !== 'ready') throw new Error(`query preparation was not ready: ${JSON.stringify(prepared)}`);

  const startedResponse = await corePost(started.base, 'queries/start', started.token, plain(scope,
    { prepared: prepared.value, consumerId: `local-secretary-${suffix}`, requestId: `local-secretary-start-${suffix}` }));
  expect(startedResponse.status).toBe(200);
  const begun = await startedResponse.json() as { status?: string };
  expect(begun.status).toBe('ready');

  const read = await (await corePost(started.base, 'queries/read', started.token, plain(scope, queryJobRef)))
    .json() as ReadResult<QueryRead>;
  if (read.status !== 'ready') throw new Error(`the Query read was not ready: ${JSON.stringify(read)}`);
  return read.value;
}

function executionStateOf(read: QueryRead): Record<string, unknown> {
  const state = read.run.run['executionState'];
  if (typeof state !== 'object' || state === null) throw new Error('the Query run carries no execution state');
  return state as Record<string, unknown>;
}

function entryOf(read: QueryRead): { hostConfigurationRevision: string; permissions: unknown } {
  const entry = executionStateOf(read)['entry'];
  if (typeof entry !== 'object' || entry === null) throw new Error('the Query run carries no entry state');
  return entry as { hostConfigurationRevision: string; permissions: unknown };
}

const localTools = ['read', 'look_graph', 'find_graph', 'run_readonly_command'];
const secretaryTools = ['read', 'look_graph', 'find_graph'];

// The revision material written out as canonical JSON text: keys in sorted
// order (duty, modelRevision, residentBytes, scope, tools, writeScope; inside
// scope projectId, workspaceId), no spaces, hashed here with node:crypto.
function localRevision(scope: CoreScope, modelRevision: string): string {
  return `local-workbench:s3@${sha256(JSON.stringify({
    duty: 'executor', modelRevision, residentBytes: 4096,
    scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
    tools: localTools, writeScope: [],
  })).slice(0, 16)}`;
}

function secretaryRevision(scope: CoreScope, modelRevision: string): string {
  return `local-secretary:s3@${sha256(JSON.stringify({
    duty: 'secretary', modelRevision, residentBytes: 4096,
    scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
    tools: secretaryTools, writeScope: [],
  })).slice(0, 16)}`;
}

describe('the local workbench publishes a secretary profile', () => {
  it('publishes the local profile first and the platform-secretary profile second', async () => {
    const started = await startLocalSecretaryHost([{ kind: 'text', text: 'read-only answer' }]);
    try {
      // The directory itself is writable with commands allowed, so the
      // secretary's empty write scope and missing command tool are its own.
      const { scope, modelId } = await openAndSelect(started, true);
      const profiles = await profilesOf(started, scope);
      const hash = hashOf(scope);
      expect(profiles.map(profile => profile.id))
        .toEqual([`local-workbench-query-${hash}`, `local-secretary-query-${hash}`]);
      expect(profiles.map(profile => profile.label)).toEqual(['Local workbench', 'Local secretary']);
      expect(profiles[0]?.sessionRole)
        .toEqual({ kind: 'legacy_template', templateId: 'local-workbench', templateRevision: '1' });
      expect(profiles[1]?.sessionRole)
        .toEqual({ kind: 'legacy_template', templateId: 'platform-secretary', templateRevision: 's3.1' });
      expect(profiles[1]?.roleBinding).not.toEqual(profiles[0]?.roleBinding);
      expect(profiles[1]?.runtimeBudget).toEqual(profiles[0]?.runtimeBudget);
      expect(profiles[1]?.budget).toEqual(profiles[0]?.budget);

      // The exact platform-secretary template is what the duty resolver reads as
      // `secretary`; the started plain Query shows the read-only grant the
      // binding carries (no write scope, no command tool).
      const run = await runPlainQuery(started, scope, profiles[1]!, 'secretary-grant');
      expect(executionStateOf(run)['role'])
        .toEqual({ kind: 'legacy_template', templateId: 'platform-secretary', templateRevision: 's3.1' });
      expect(entryOf(run).permissions).toEqual({ tools: secretaryTools, writeScope: [] });
      // The hand-computed revision covers the binding's duty, resident bytes,
      // tools, write scope and model revision; the local profile's prefix and
      // material are the only difference.
      expect(entryOf(run).hostConfigurationRevision).toBe(secretaryRevision(scope, `host-settings:${modelId}`));
    } finally {
      await started.host.close();
    }
  });

  it('creates a secretary line with the platform secretary role from requests/submit', async () => {
    const started = await startLocalSecretaryHost([]);
    try {
      const { scope } = await openAndSelect(started);
      const submitted = await (await corePost(started.base, 'requests/submit', started.token, plain(scope, {
        commandId: 'local-secretary-request-1', goalId: null, text: 'Who is the secretary here?',
        continues: null, recipient: null,
      }))).json() as Record<string, unknown>;
      expect(submitted).toMatchObject({
        status: 'queued', assignment: 'assigned', created: true, waitReason: null,
      });
      const secretary = submitted['secretary'] as SessionRef;
      expect(secretary.sessionId.length).toBeGreaterThan(0);
      const card = await (await corePost(started.base, 'sessions/read', started.token, plain(scope, secretary)))
        .json() as ReadResult<{ record: { role: unknown; lifecycle: string } }>;
      if (card.status !== 'ready') throw new Error(`the secretary line was not readable: ${JSON.stringify(card)}`);
      expect(card.value.record.role)
        .toEqual({ kind: 'legacy_template', templateId: 'platform-secretary', templateRevision: 's3.1' });
      expect(card.value.record.lifecycle).toBe('active');
    } finally {
      await started.host.close();
    }
  });

  it('publishes neither profile for a directory with no selected model', async () => {
    const started = await startLocalSecretaryHost([]);
    try {
      const root = await mkdtemp(join(tmpdir(), 'local-secretary-unselected-'));
      temporary.push(root);
      await writeFile(join(root, 'notes.md'), '# no model here\n');
      const opened = expectReady(await (await settingsPost(started.base, 'workspaces/open', started.token,
        { path: root, writeAllowed: false, commandsAllowed: false })).json() as SettingsResponse<OpenValue>);
      expect(await profilesOf(started, opened.scope)).toEqual([]);
    } finally {
      await started.host.close();
    }
  });

  it('keeps a plain Query on the local profile', async () => {
    const started = await startLocalSecretaryHost([{ kind: 'text', text: 'local answer' }]);
    try {
      const { scope, modelId } = await openAndSelect(started);
      const profiles = await profilesOf(started, scope);
      expect(profiles[0]?.id).toBe(`local-workbench-query-${hashOf(scope)}`);
      const run = await runPlainQuery(started, scope, profiles[0]!, 'local-only');
      expect(executionStateOf(run)['role'])
        .toEqual({ kind: 'legacy_template', templateId: 'local-workbench', templateRevision: '1' });
      expect(entryOf(run).permissions).toEqual({ tools: localTools, writeScope: [] });
      expect(entryOf(run).hostConfigurationRevision).toBe(localRevision(scope, `host-settings:${modelId}`));
    } finally {
      await started.host.close();
    }
  });

  it('changes both configuration revisions when the selected model changes', async () => {
    const started = await startLocalSecretaryHost([
      { kind: 'text', text: 'first local answer' },
      { kind: 'text', text: 'first secretary answer' },
      { kind: 'text', text: 'second local answer' },
      { kind: 'text', text: 'second secretary answer' },
    ]);
    try {
      const { scope, modelId } = await openAndSelect(started);
      const first = await profilesOf(started, scope);
      expect(first).toHaveLength(2);
      const localFirstRevision = entryOf(await runPlainQuery(started, scope, first[0]!, 'local-first'))
        .hostConfigurationRevision;
      const secretaryFirstRevision = entryOf(await runPlainQuery(started, scope, first[1]!, 'secretary-first'))
        .hostConfigurationRevision;
      expect(localFirstRevision).toBe(localRevision(scope, `host-settings:${modelId}`));
      expect(secretaryFirstRevision).toBe(secretaryRevision(scope, `host-settings:${modelId}`));
      expect(secretaryFirstRevision).not.toBe(localFirstRevision);

      const saved = expectReady(await (await settingsPost(started.base, 'models/save', started.token, {
        label: 'Local secretary second model', provider: 'deepseek', model: 'deepseek-reasoner',
        baseUrl: 'http://127.0.0.1:9', apiKey: SECRET_VALUE,
      })).json() as SettingsResponse<HostSettingsSnapshot>);
      const secondModel = saved.models.find(entry => entry.label === 'Local secretary second model');
      if (secondModel === undefined) throw new Error('the saved model is missing from the catalog');
      expect((await settingsPost(started.base, 'models/select', started.token,
        { scope, modelId: secondModel.id })).status).toBe(200);

      const second = await profilesOf(started, scope);
      expect(second.map(profile => profile.id)).toEqual(first.map(profile => profile.id));
      const localSecondRevision = entryOf(await runPlainQuery(started, scope, second[0]!, 'local-second'))
        .hostConfigurationRevision;
      const secretarySecondRevision = entryOf(await runPlainQuery(started, scope, second[1]!, 'secretary-second'))
        .hostConfigurationRevision;
      expect(localSecondRevision).toBe(localRevision(scope, `host-settings:${secondModel.id}`));
      expect(secretarySecondRevision).toBe(secretaryRevision(scope, `host-settings:${secondModel.id}`));
      expect(localSecondRevision).not.toBe(localFirstRevision);
      expect(secretarySecondRevision).not.toBe(secretaryFirstRevision);
    } finally {
      await started.host.close();
    }
  });
});
