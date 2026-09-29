/**
 * AG6 Stage-1 behavior assembly contract.
 *
 * Exercises the trusted preset shorthand `{ bundle: 'platform', behaviors: [...] }`
 * through the REAL Host factory (`createWorkbenchRuntimeHostBindings`, both the
 * Work and the Query resolve branch) and feeds the resolved skills into the REAL
 * frozen Kernel model loop (`runObservedModel`) with a scripted provider. The
 * structured shorthand is built through a real JSON boundary so a not-yet-typed
 * `bundle`/`behaviors` field cannot turn the intended RED into a type failure.
 *
 * These tests assert assembly/wiring only: which instruction content and which
 * tools reach one real request. They do not score the model and do not claim the
 * placeholder `platform-work`/`platform-reviewer` content is finished.
 */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWorkbenchRuntimeHostBindings,
  validateWorkbenchRuntimeConfiguration,
  type WorkbenchRuntimeConfiguration,
  type WorkbenchRuntimeProviderDependencies,
} from '../../src/app/runtime-configuration.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type {
  QueryRuntimeConfigurationInput,
  ResolvedRuntimeConfiguration,
  RuntimeConfigurationInput,
} from '../../src/core/agent-runtime/execution-contracts.js';
import { DEFAULT_RUNTIME_BUDGET, ModelBudget } from '../../src/core/agent-runtime/model-budget.js';
import { runObservedModel, type ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';

const PROJECT_ID = 'ag6-project';
const REPO_SKILLS = resolve(import.meta.dirname, '../../resources/skills');
const VENDOR_SKILLS = resolve(import.meta.dirname, '../../vendor/coding-agent/resources/skills');
const ROLE = {
  kind: 'role_spec',
  pin: {
    ref: { aggregateType: 'RoleSpecRevision', projectId: PROJECT_ID, roleId: 'builder', revision: 1 },
    digest: 'a'.repeat(64),
  },
};

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

const contentOf = (id: string) => readFile(join(REPO_SKILLS, id, 'content.md'), 'utf8');

// --------------------------------------------------------------------------
// JSON-level configuration builder: the shorthand never appears in a TS literal.
// --------------------------------------------------------------------------

function configWith(skillsByWorkspace: Record<string, unknown>): WorkbenchRuntimeConfiguration {
  const configuration = {
    schemaVersion: 1,
    bindings: Object.entries(skillsByWorkspace).map(([workspaceId, skills]) => ({
      id: `ag6-binding-${workspaceId}`,
      label: `AG6 ${workspaceId}`,
      scope: { projectId: PROJECT_ID, workspaceId },
      role: ROLE,
      configurationRevision: 'ag6-config-rev-1',
      model: { revision: 'ag6-model-rev-1', provider: 'deepseek', model: 'ag6-scripted', baseUrl: 'http://127.0.0.1' },
      grant: {
        budget: { ...DEFAULT_RUNTIME_BUDGET, maxRequests: 4, timeoutMs: 30_000 },
        hostTemplate: null,
        tools: ['read'],
        writeScope: [],
        skills,
        systemInstruction: null,
        deniedPrefixes: [],
        processSandboxOptions: {},
        materialBasis: null,
      },
    })),
    queryProfiles: [],
  };
  return JSON.parse(JSON.stringify(configuration)) as WorkbenchRuntimeConfiguration;
}

function hostContext(workspaceId: string): CoreCallContext {
  const actor = { kind: 'system' as const, id: 'ag6-host' };
  return {
    projectId: PROJECT_ID,
    workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: PROJECT_ID, workspaceId, actor },
    signal: new AbortController().signal,
  };
}

function expectReady(result: ReadResult<ResolvedRuntimeConfiguration>): ResolvedRuntimeConfiguration {
  if (result.status !== 'ready') throw Error(`AG6 expected a ready runtime resolution, got ${result.status}`);
  return result.value;
}

function fakeProviderRegistry(client: kernel.ModelClientPort) {
  const calls: string[] = [];
  const definition = {
    id: 'deepseek' as const,
    secretEnvironmentVariable: 'AG6_FAKE_SECRET',
    defaultBaseUrl: 'http://127.0.0.1:9',
    capabilities: { streaming: true as const, toolCalls: true as const, usage: true as const },
    create: () => client,
  };
  const registry: NonNullable<WorkbenchRuntimeProviderDependencies['registry']> = {
    get: id => { calls.push(`get:${id}`); return definition; },
    create: id => { calls.push(`create:${id}`); return client; },
  };
  return { registry, calls };
}

function scriptedTextClient(replies: readonly string[]) {
  let round = 0;
  const requests: kernel.ModelRequest[] = [];
  const client: kernel.ModelClientPort = {
    async *stream(request, options) {
      options.signal.throwIfAborted();
      requests.push(structuredClone(request));
      const text = replies[round++];
      if (text === undefined) throw new Error(`AG6 scripted model ran out of replies at round ${round - 1}`);
      const base = { schemaVersion: 1 as const, requestId: request.requestId };
      yield { ...base, sequence: 1, type: 'text_delta', delta: text };
      yield { ...base, sequence: 2, type: 'completed', reason: 'final_answer' };
    },
  };
  return { client, requests };
}

async function tempWorkspace(name: string) {
  const directory = await mkdtemp(join(tmpdir(), `next-ag6-${name}-`));
  directories.push(directory);
  const root = join(directory, 'workspace');
  await mkdir(root, { recursive: true });
  return { directory, root, databasePath: join(directory, 'kernel.sqlite'), sessionId: `ag6-${name}` };
}

function baseOptions(root: string, databasePath: string, sessionId: string, bound: ObservedModelRunOptions['bound']): ObservedModelRunOptions {
  const budget = { ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: 200_000, perResponseTokens: 512, maxRequests: 4, maxToolCalls: 4, timeoutMs: 30_000 };
  return {
    kernel, bound,
    meter: new ModelBudget(budget, async () => {}, {
      count: () => ({ tokens: 256, method: 'model_tokenizer', tokenizer: 'ag6-labelled-local-counter' }),
    }),
    root, databasePath, sessionId, input: 'AG6 assembly turn.', budget,
    readOnly: true, signal: new AbortController().signal,
    deniedPrefixes: [], processSandboxOptions: {}, publish: async () => {},
  };
}

// --------------------------------------------------------------------------
// 1. Preset through both factory branches -> exactly work+secretary+scribe.
// --------------------------------------------------------------------------

describe('AG6 trusted preset assembly', () => {
  it('resolves through both factory branches and reaches the real request with only work+secretary+scribe', async () => {
    const { client, requests } = scriptedTextClient(['AG6 preset turn']);
    const { registry, calls: providerCalls } = fakeProviderRegistry(client);
    const secretReads: string[] = [];
    const configuration = configWith({ 'ag6-preset': { bundle: 'platform', behaviors: ['secretary', 'scribe'] } });

    const bindings = createWorkbenchRuntimeHostBindings(configuration, {
      registry,
      secretSource: { get: name => { secretReads.push(name); return 'ag6-secret'; } },
    });
    // Construction is pure configuration: no provider, secret or model access.
    expect(providerCalls).toEqual([]);
    expect(secretReads).toEqual([]);
    expect(requests).toEqual([]);

    const ctx = hostContext('ag6-preset');
    const work = expectReady(await bindings.resolveConfiguration(ctx, { role: ROLE } as unknown as RuntimeConfigurationInput));
    const expectedSkills = { resourceRoot: REPO_SKILLS, enabledIds: ['platform-work', 'platform-secretary', 'platform-scribe'] };
    expect(work.skills).toEqual(expectedSkills);
    // tools/writeScope stay the explicit trusted grant, not widened by Skills.
    expect(work.tools).toEqual(['read']);
    expect(work.writeScope).toEqual([]);

    if (!bindings.resolveQueryConfiguration) throw Error('AG6 Host factory must expose the Query branch');
    const query = expectReady(await bindings.resolveQueryConfiguration(ctx, { role: ROLE } as unknown as QueryRuntimeConfigurationInput));
    expect(query.skills).toEqual(expectedSkills);

    // The provider/secret are read lazily on the first real resolution.
    expect(providerCalls.length).toBeGreaterThan(0);
    expect(secretReads).toEqual(['AG6_FAKE_SECRET']);

    const w = await tempWorkspace('preset');
    const result = await runObservedModel({ ...baseOptions(w.root, w.databasePath, w.sessionId, work.model), input: 'AG6 preset turn', skills: work.skills });
    expect(result.state.status).toBe('completed');
    expect(requests).toHaveLength(1);
    const prompt = requests[0]!.systemPrompt;
    expect(prompt).toContain(await contentOf('platform-work'));
    expect(prompt).toContain(await contentOf('platform-secretary'));
    expect(prompt).toContain(await contentOf('platform-scribe'));
    expect(prompt).not.toContain(await contentOf('platform-adviser'));
    expect(prompt).not.toContain(await contentOf('platform-reviewer'));
    const toolNames = requests[0]!.tools.map(tool => tool.name);
    for (const forbidden of ['query_ready_tasks', 'send_session_message', 'find_related_sessions', 'read_session_card']) {
      expect(toolNames, `${forbidden} must not be granted by a Skill`).not.toContain(forbidden);
    }
  }, 60_000);

  // ------------------------------------------------------------------------
  // 2. Explicit legacy shape + common-only + reviewer, without a model run.
  // ------------------------------------------------------------------------

  it('keeps the explicit resourceRoot/empty enabledIds shape and separates common-only from reviewer', async () => {
    const { client, requests } = scriptedTextClient([]);
    const { registry } = fakeProviderRegistry(client);
    const configuration = configWith({
      'ag6-explicit': { resourceRoot: VENDOR_SKILLS, enabledIds: [] },
      'ag6-common': { bundle: 'platform', behaviors: [] },
      'ag6-reviewer': { bundle: 'platform', behaviors: ['reviewer'] },
    });
    const bindings = createWorkbenchRuntimeHostBindings(configuration, { registry, secretSource: { get: () => 'ag6-secret' } });
    const resolveSkills = async (workspaceId: string) => expectReady(
      await bindings.resolveConfiguration(hostContext(workspaceId), { role: ROLE } as unknown as RuntimeConfigurationInput),
    ).skills;

    // The existing explicit shape survives untouched, including empty enabledIds.
    expect(await resolveSkills('ag6-explicit')).toEqual({ resourceRoot: VENDOR_SKILLS, enabledIds: [] });
    // An explicit empty behaviors selects only the shared work instruction.
    expect(await resolveSkills('ag6-common')).toEqual({ resourceRoot: REPO_SKILLS, enabledIds: ['platform-work'] });
    // reviewer is selectable as a bounded, on-demand behavior.
    expect(await resolveSkills('ag6-reviewer')).toEqual({ resourceRoot: REPO_SKILLS, enabledIds: ['platform-work', 'platform-reviewer'] });
    expect(requests).toEqual([]);
  });

  // ------------------------------------------------------------------------
  // 3. Pure validator rejects bad shorthand before provider/secret access.
  // ------------------------------------------------------------------------

  it('rejects an unknown bundle/behavior or a missing behaviors array before any provider or secret access', async () => {
    const { client } = scriptedTextClient([]);
    const { registry, calls: providerCalls } = fakeProviderRegistry(client);
    const secretReads: string[] = [];
    const secretSource = { get: (name: string) => { secretReads.push(name); return 'ag6-secret'; } };
    const badPresets: unknown[] = [
      { bundle: 'unknown-platform', behaviors: ['secretary'] },
      { bundle: 'platform', behaviors: ['unknown-behavior'] },
      { bundle: 'platform' },
    ];
    for (const [index, skills] of badPresets.entries()) {
      const configuration = configWith({ [`ag6-bad-${index}`]: skills });
      expect(validateWorkbenchRuntimeConfiguration(configuration)).not.toBeNull();
      expect(() => createWorkbenchRuntimeHostBindings(configuration, { registry, secretSource })).toThrow();
    }
    expect(providerCalls).toEqual([]);
    expect(secretReads).toEqual([]);
  });
});
