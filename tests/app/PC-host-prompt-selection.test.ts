/**
 * PC-1a C row: the trusted prompt selection reaches a real Host start.
 *
 * Every fact comes from the Host's own runtime configuration: the direct
 * model, the projected settings catalog, the settings `models/select` install
 * and the re-exported platform Skill root. `promptSelectionOf` is the one
 * reader of `selection`; the tests never derive an id from `revision`.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { PLATFORM_TOKEN_HEADER } from '../../src/app/core-http-types.js';
import { SETTINGS_API_PREFIX } from '../../src/app/host-settings-types.js';
import { PLATFORM_TOKEN_META_NAME, writeHostPage } from '../helpers/host-page.js';
import {
  PLATFORM_SKILL_RESOURCE_ROOT as APP_PLATFORM_SKILL_RESOURCE_ROOT,
  type WorkbenchModelConfiguration,
  type WorkbenchRuntimeConfiguration,
  type WorkbenchRuntimeProviderDependencies,
} from '../../src/app/runtime-configuration.js';
import { PLATFORM_SKILL_RESOURCE_ROOT as RUNTIME_PLATFORM_SKILL_RESOURCE_ROOT } from '../../src/core/agent-runtime/platform-skill-root.js';
import { promptSelectionOf } from '../../src/contracts/prompts/prompt-set.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RuntimeConfigurationInput, RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';

// A3-01: the Host exposes no runtime property. Wrap the public assembly entry
// (as tests/app/RL-34-wiring-resource-caps.test.ts does for its option),
// capture the runtime the Host passes in, and still call the real factory.
const captured = vi.hoisted(() => ({ runtime: undefined as RuntimeHostBindings | undefined }));
vi.mock('../../src/composition/create-platform.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/composition/create-platform.js')>();
  return {
    ...actual,
    createTargetPlatform: (options: Parameters<typeof actual.createTargetPlatform>[0]) => {
      captured.runtime = options.runtime;
      return actual.createTargetPlatform(options);
    },
  };
});

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporary: string[] = [];
const SCOPE: CoreScope = { projectId: 'pc-host-project', workspaceId: 'pc-host-workspace' };
const ROLE = {
  kind: 'legacy_template', templateId: 'pc-template', templateRevision: '1',
} as const satisfies RoleConfigurationRef;
const AT = '2026-10-22T00:00:00.000Z';

/** The direct model the settings catalog projects: no explicit baseUrl or
 * options, so only the provider/model/secret identity contributes. */
const DIRECT_MODEL: WorkbenchModelConfiguration = {
  revision: 'pc-direct@1',
  provider: 'deepseek',
  model: 'pc-direct-model',
  secretEnvironmentVariable: 'PC_HOST_SECRET',
};
/** Hand-computed `runtime-<sha16>` of that hard-coded direct identity. */
const DIRECT_ID = 'runtime-07c99fbf5bc6e3bf';
/** The same identity with `promptPack: 'team-pack'` and `reasoningReplay: 'none'`. */
const WITH_FIELDS_ID = 'runtime-05eaaa44b1ef4c63';

afterAll(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

function hostConfiguration(model: WorkbenchModelConfiguration): WorkbenchRuntimeConfiguration {
  return {
    schemaVersion: 1,
    bindings: [{
      id: 'pc-host-binding',
      label: 'PC prompt selection binding',
      scope: SCOPE,
      role: ROLE,
      configurationRevision: 'pc-config@1',
      model,
      grant: {
        budget: { ...DEFAULT_RUNTIME_BUDGET },
        hostTemplate: { templateId: ROLE.templateId, revision: ROLE.templateRevision, digest: sha256Hex('pc instruction') },
        tools: ['read'],
        writeScope: [],
        skills: { resourceRoot: RUNTIME_PLATFORM_SKILL_RESOURCE_ROOT, enabledIds: [] },
        systemInstruction: null,
        deniedPrefixes: [],
        processSandboxOptions: {},
        materialBasis: null,
      },
    }],
    queryProfiles: [],
  };
}

/** A controlled provider of the frozen registry's narrow shape: the Host still
 * performs its real lookup, secret read and lazy client creation. */
function controlledProvider(): WorkbenchRuntimeProviderDependencies {
  const registry = {
    get: () => ({ secretEnvironmentVariable: 'PC_HOST_SECRET', defaultBaseUrl: 'https://pc.invalid.test' }),
    create: () => ({}) as never,
  } as unknown as NonNullable<WorkbenchRuntimeProviderDependencies['registry']>;
  return { registry, secretSource: { get: () => 'pc-secret' } };
}

type Started = { host: LocalWorkbenchHost; base: string; token: string };

async function startHost(model: WorkbenchModelConfiguration, withSettings: boolean): Promise<Started> {
  captured.runtime = undefined;
  const root = await mkdtemp(join(tmpdir(), 'pc-host-ws-'));
  const database = await mkdtemp(join(tmpdir(), 'pc-host-db-'));
  temporary.push(root, database);
  await writeFile(join(root, 'README.md'), '# pc host workspace\n');
  const publicDir = withSettings ? await mkdtemp(join(tmpdir(), 'pc-host-public-')) : null;
  if (publicDir !== null) {
    temporary.push(publicDir);
    await mkdir(publicDir, { recursive: true });
    await writeHostPage(publicDir);
  }
  const host = await createLocalWorkbenchHost({
    storage: withSettings ? { kind: 'sqlite', directory: database } : { kind: 'memory' },
    actor: { kind: 'human', id: 'pc-host-operator' },
    workspaces: [{ scope: SCOPE, name: 'PC host workspace', root, workspaceRevision: 1, readPrefixes: ['.'] }],
    now: () => AT,
    runtimeConfiguration: hostConfiguration(model),
    runtimeProvider: controlledProvider(),
    ...(publicDir === null ? {} : { settings: { settingsDirectory: join(database, 'host-settings') }, publicDir }),
  });
  const address = await host.listen();
  const token = withSettings ? await readPageToken(address.url) : '';
  return { host, base: address.url, token };
}

async function readPageToken(base: string): Promise<string> {
  const response = await fetch(base);
  expect(response.status).toBe(200);
  const html = await response.text();
  const match = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(html);
  if (match?.[1] === undefined) throw new Error('the page did not expose the runtime token meta');
  return match[1];
}

function callContext(): CoreCallContext {
  const actor = { kind: 'human' as const, id: 'pc-host-operator' };
  return {
    projectId: SCOPE.projectId,
    workspaceId: SCOPE.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: SCOPE.projectId, workspaceId: SCOPE.workspaceId, actor },
    signal: new AbortController().signal,
  };
}

function runtimeInput(runId: string): RuntimeConfigurationInput {
  return {
    runRef: { aggregateType: 'Run', projectId: SCOPE.projectId, goalId: 'pc-goal', runId },
    role: ROLE,
  } as unknown as RuntimeConfigurationInput;
}

async function resolvedModel(runId: string) {
  if (captured.runtime === undefined) throw new Error('the Host passed no trusted runtime binding to createTargetPlatform');
  const resolved = await captured.runtime.resolveConfiguration(callContext(), runtimeInput(runId));
  if (resolved.status !== 'ready') throw new Error(`runtime configuration was not ready: ${resolved.status}`);
  return resolved.value.model;
}

async function resolvedSelection(runId: string) {
  return promptSelectionOf(await resolvedModel(runId));
}

async function settingsPost(base: string, suffix: string, token: string, body: unknown): Promise<Response> {
  return fetch(new URL(SETTINGS_API_PREFIX + suffix, base).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
    body: JSON.stringify(body),
  });
}

describe('PC-1a prompt selection through a full Host start', () => {
  it('resolves a direct configuration pack and replay, with the catalogued runtime id', async () => {
    const started = await startHost({ ...DIRECT_MODEL, promptPack: 'team-pack', reasoningReplay: 'none' }, false);
    try {
      expect(await resolvedSelection('pc-run-direct')).toEqual({
        modelId: WITH_FIELDS_ID, promptPack: 'team-pack', reasoningReplay: 'none',
      });
    } finally {
      await started.host.close();
    }
  });

  it('restores the direct pack and replay when a settings selection rebuilds the binding', async () => {
    const started = await startHost({ ...DIRECT_MODEL, promptPack: 'team-pack', reasoningReplay: 'none' }, true);
    try {
      const snapshot = await (await settingsPost(started.base, 'snapshot', started.token, {})).json() as {
        status: string;
        value?: { models: { id: string; provider: string; model: string }[]; workspaces: { scope: CoreScope; modelId: string | null }[] };
      };
      expect(snapshot.status).toBe('ready');
      const catalogued = snapshot.value?.models.find(entry => entry.id === WITH_FIELDS_ID);
      expect(catalogued).toMatchObject({ provider: 'deepseek', model: 'pc-direct-model' });
      expect(snapshot.value?.workspaces.find(workspace => workspace.scope.workspaceId === SCOPE.workspaceId)?.modelId)
        .toBe(WITH_FIELDS_ID);

      const selected = await (await settingsPost(started.base, 'models/select', started.token,
        { scope: SCOPE, modelId: WITH_FIELDS_ID })).json() as { status: string };
      expect(selected.status).toBe('ready');

      const model = await resolvedModel('pc-run-after-select');
      // The rebuild is the settings binding, not the startup direct binding...
      expect(model.configuration.revision).toBe(`host-settings:${WITH_FIELDS_ID}`);
      // ...and it restored the direct pack and replay beside provider/options.
      expect(promptSelectionOf(model)).toEqual({
        modelId: WITH_FIELDS_ID, promptPack: 'team-pack', reasoningReplay: 'none',
      });
    } finally {
      await started.host.close();
    }
  });

  it('reads back the literal settings item id after models/save and models/select', async () => {
    const started = await startHost(DIRECT_MODEL, true);
    try {
      const saved = await (await settingsPost(started.base, 'models/save', started.token, {
        id: 'settings-item-1', label: 'Settings item', provider: 'deepseek', model: 'settings-item-model',
      })).json() as { status: string };
      expect(saved.status).toBe('ready');

      const selected = await (await settingsPost(started.base, 'models/select', started.token,
        { scope: SCOPE, modelId: 'settings-item-1' })).json() as { status: string };
      expect(selected.status).toBe('ready');

      const model = await resolvedModel('pc-run-settings-item');
      // The rebuilt settings binding carries the settings item's literal id.
      expect(model.configuration.revision).toBe('host-settings:settings-item-1');
      expect(promptSelectionOf(model)).toEqual({
        modelId: 'settings-item-1', promptPack: 'platform', reasoningReplay: 'current_run',
      });
    } finally {
      await started.host.close();
    }
  });

  it('keeps today platform/current_run defaults and today runtime id without direct fields', async () => {
    const started = await startHost(DIRECT_MODEL, false);
    try {
      expect(await resolvedSelection('pc-run-defaults')).toEqual({
        modelId: DIRECT_ID, promptPack: 'platform', reasoningReplay: 'current_run',
      });
    } finally {
      await started.host.close();
    }
  });

  it('keeps the platform Skill root at the identical absolute path and re-exports the same binding', () => {
    expect(APP_PLATFORM_SKILL_RESOURCE_ROOT).toBe(RUNTIME_PLATFORM_SKILL_RESOURCE_ROOT);
    expect(RUNTIME_PLATFORM_SKILL_RESOURCE_ROOT).toBe(resolve(projectRoot, 'resources/skills'));
  });
});
