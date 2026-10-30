/**
 * PC-1b P — rulings 14 and 18: preparation takes the selection and the bound
 * provider/model BEFORE the pack await, resolves the pack once, renders every
 * prompt text from it, merges the Host instruction and records the projected
 * section order.
 *
 * Work and Query are driven through the frozen PC fixture's public prepare
 * steps with a pausable, counting `PromptPackSourcePort`. While the source is
 * paused the test mutates the very Host configuration object preparation
 * already has; the frozen values must stay the originals. Every expected value
 * is a hand-written literal or the SHA-256 of one.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ModelClientPort } from '../../vendor/coding-agent/dist/public-api.js';
import type { PromptPackSourcePort } from '../../src/contracts/prompts/prompt-pack.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { resolvePromptPack } from '../../src/core/agent-runtime/prompt-set-texts.js';
import { snapshotRuntimeConfiguration } from '../../src/core/agent-runtime/execution-preparation.js';
import { PLATFORM_SKILL_RESOURCE_ROOT } from '../../src/core/agent-runtime/platform-skill-root.js';
import type {
  ResolvedRuntimeConfiguration, RuntimeHostBindings,
} from '../../src/core/agent-runtime/execution-contracts.js';
import {
  mutablePromptPacks, openPCQueryFixture, openPCWorkFixture, scriptedModel,
} from '../helpers/PC-platform-fixture.js';
import { rlQueryHostCtx } from '../helpers/RL-query-fixture.js';
import { DELIVERY_SET_IDS } from '../helpers/S7B-delivery-samples.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const BASE_A = 'PC_BASE_A';
const WORK_INSTRUCTION = 'PC_WORK_HOST_INSTRUCTION';
const QUERY_INSTRUCTION = 'PC_QUERY_HOST_INSTRUCTION';

const WORK_ORDER = {
  work: ['role', 'goal', 'task', 'footprint', 'notes', 'inputs', 'unknown_call_review', 'reminders'],
  continuation: ['role', 'goal', 'task', 'footprint', 'notes', 'inputs', 'continuation', 'reminders'],
};
const QUERY_ORDER = {
  planning: ['role', 'goal', 'task', 'footprint'],
  copy: ['role', 'goal', 'task'],
  // The platform pack also declares the secretary round, a Query call kind with its own template.
  secretary: ['role', 'goal', 'notes', 'task'],
  intervention_planning: ['role', 'goal', 'task'],
};

/** A source that publishes where it pauses and how many times it was asked to resolve. */
function pausableSource(inner: PromptPackSourcePort) {
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const source: PromptPackSourcePort = {
    async resolve(packId, signal) {
      calls += 1;
      entered();
      await released;
      return inner.resolve(packId, signal);
    },
  };
  return { source, reached, release, calls: () => calls };
}

type Selection = NonNullable<ResolvedRuntimeConfiguration['model']['selection']>;

function workHostConfig(client: ModelClientPort, selection: Selection): ResolvedRuntimeConfiguration {
  return {
    configurationRevision: 'pc-p10-work-host@1',
    model: {
      configuration: { revision: 'pc-p10-work-host@1', provider: 'deepseek',
        model: 'wp2-local-scripted', baseUrl: 'http://127.0.0.1' },
      client, selection: { ...selection },
    },
    budget: { contextWindowTokens: 200_000, inputTokens: null, outputTokens: null,
      maxRequests: 12, maxToolCalls: 16, timeoutMs: 30_000, perResponseTokens: 512 },
    tools: ['read'], writeScope: [], hostTemplate: null,
    skills: { resourceRoot: PLATFORM_SKILL_RESOURCE_ROOT, enabledIds: [] },
    systemInstruction: WORK_INSTRUCTION,
    deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
  };
}

function queryHostConfig(client: ModelClientPort, selection: Selection): ResolvedRuntimeConfiguration {
  return {
    configurationRevision: 'pc-p10-query-host@1',
    model: {
      configuration: { revision: 'pc-p10-query-host@1', provider: 'deepseek',
        model: 'rl-query-scripted', baseUrl: 'http://127.0.0.1' },
      client, selection: { ...selection },
    },
    budget: { contextWindowTokens: 200_000, inputTokens: null, outputTokens: null,
      maxRequests: 8, maxToolCalls: 8, timeoutMs: 30_000, perResponseTokens: 512 },
    tools: ['read'], writeScope: [],
    hostTemplate: { templateId: 'advisor', revision: '1', digest: sha('PC_P10_QUERY_TEMPLATE') },
    skills: { resourceRoot: PLATFORM_SKILL_RESOURCE_ROOT, enabledIds: [] },
    systemInstruction: QUERY_INSTRUCTION,
    deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
  };
}

function installConfig(
  registry: { install(bindings: RuntimeHostBindings): number },
  config: ResolvedRuntimeConfiguration,
): void {
  registry.install({
    async resolveConfiguration() { return { status: 'ready' as const, value: config }; },
    async resolveQueryConfiguration() { return { status: 'ready' as const, value: config }; },
  });
}

describe('ruling 14: a Work preparation freezes before the pack await (and ruling 18 order)', () => {
  it('keeps the original selection, provider and model when the Host object changes while paused', async () => {
    const inner = await mutablePromptPacks();
    inner.change({ base: BASE_A, strings: {
      'context.prelude.work': 'PC_WORK_PRELUDE_A',
      'context.section.role': 'PC_ROLE_HEADER_A',
    } });
    const gate = pausableSource(inner);
    const fixture = await openPCWorkFixture({ systemInstruction: WORK_INSTRUCTION, promptPacks: gate.source });
    try {
      const selection: Selection = { modelId: 'pc-model-A', promptPack: 'platform', reasoningReplay: 'none' };
      const config = workHostConfig(fixture.model.client, selection);
      installConfig(fixture.hostRegistry, config);

      const preparing = fixture.work.prepare();
      await gate.reached;
      // The original object is what preparation was handed; change every field
      // the frozen set must not re-read after the await.
      config.model.selection!.modelId = 'pc-model-CHANGED';
      config.model.selection!.promptPack = 'person-changed';
      config.model.selection!.reasoningReplay = 'current_run';
      config.model.configuration.provider = 'changed-provider';
      config.model.configuration.model = 'changed-model';
      gate.release();
      await preparing;

      const prepared = await fixture.work.preparedTexts();
      expect(prepared.set).toMatchObject({
        modelId: 'pc-model-A', provider: 'deepseek', model: 'wp2-local-scripted',
        packId: 'platform', reasoningReplay: 'none',
      });
      expect(gate.calls()).toBe(1);
      expect(prepared.set.base.digest).toBe(sha(`${BASE_A}\n\n${WORK_INSTRUCTION}`));
      expect(prepared.texts.base).toEqual({ templateId: 'base', version: 2, text: `${BASE_A}\n\n${WORK_INSTRUCTION}` });
      expect(prepared.texts.strings['context.prelude.work']).toBe('PC_WORK_PRELUDE_A');
      expect(prepared.input.startsWith('PC_WORK_PRELUDE_A')).toBe(true);
      expect(prepared.input).toContain('PC_ROLE_HEADER_A');
      // Only the templates this preparation really read are frozen, by observation, then the delivery set.
      expect(prepared.set.templates.map(template => template.id)).toEqual(['work-input', 'base', ...DELIVERY_SET_IDS]);
      // Ruling 18: today's order, projected onto the call kinds Work can produce.
      expect(prepared.set.sectionOrder).toEqual(WORK_ORDER);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('keeps selection when snapshotting the Host configuration', () => {
    const selection: Selection = { modelId: 'pc-snapshot-model', promptPack: 'platform', reasoningReplay: 'none' };
    const config = workHostConfig(scriptedModel([]).client, selection);
    const snapshot = snapshotRuntimeConfiguration(config);
    config.model.selection!.modelId = 'pc-snapshot-CHANGED';
    config.model.selection!.promptPack = 'person-changed';
    expect(snapshot.model.selection).toEqual(
      { modelId: 'pc-snapshot-model', promptPack: 'platform', reasoningReplay: 'none' });
  });
});

describe('ruling 14: a Query preparation freezes before the pack await (and ruling 18 order)', () => {
  it('keeps the original selection, provider and model when the Host object changes while paused', async () => {
    const inner = await mutablePromptPacks();
    const pack = inner.snapshot();
    inner.replace({ ...pack, templates: { ...pack.templates,
      base: 'PC_QUERY_BASE', 'initial-planning-answer': 'PC_PLANNING_GUIDE_A' },
    strings: { ...pack.strings, 'context.prelude.query': 'PC_QUERY_PRELUDE_A' } });
    const gate = pausableSource(inner);
    const fixture = await openPCQueryFixture({ systemInstruction: QUERY_INSTRUCTION, promptPacks: gate.source });
    try {
      const selection: Selection = { modelId: 'pc-query-model', promptPack: 'platform', reasoningReplay: 'none' };
      const config = queryHostConfig(fixture.model.client, selection);
      installConfig(fixture.hostRegistry, config);

      const preparing = fixture.prepare();
      await gate.reached;
      config.model.selection!.modelId = 'pc-query-CHANGED';
      config.model.selection!.promptPack = 'person-changed';
      config.model.selection!.reasoningReplay = 'current_run';
      config.model.configuration.provider = 'changed-provider';
      config.model.configuration.model = 'changed-model';
      gate.release();
      const prepared = await preparing;

      const opened = await fixture.base.platform.materials.openArtifact(rlQueryHostCtx(), {
        ref: prepared.bundleRef, usage: 'historical_explanation',
      });
      expect(opened.status, JSON.stringify(opened)).toBe('ready');
      if (opened.status !== 'ready') return;
      const manifest = JSON.parse(opened.value.body) as {
        input: string; promptSet: { modelId: string; provider: string; model: string;
          packId: string; reasoningReplay: string; sectionOrder: unknown; base: { digest: string } };
      };
      expect(manifest.promptSet).toMatchObject({
        modelId: 'pc-query-model', provider: 'deepseek', model: 'rl-query-scripted',
        packId: 'platform', reasoningReplay: 'none',
      });
      expect(gate.calls()).toBe(1);
      expect(manifest.promptSet.base.digest).toBe(sha(`PC_QUERY_BASE\n\n${QUERY_INSTRUCTION}`));
      expect(manifest.input.startsWith('PC_QUERY_PRELUDE_A')).toBe(true);
      expect(manifest.input).toContain('PC_PLANNING_GUIDE_A');
      expect(manifest.promptSet.sectionOrder).toEqual(QUERY_ORDER);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});

describe('ruling 14: the pack is resolved once and never falls back', () => {
  it('uses the ruling-30 default when no source is wired, and still names a rejected pack', async () => {
    const defaultValue = await resolvePromptPack(undefined, 'platform', new AbortController().signal);
    expect(defaultValue.status).toBe('ready');
    if (defaultValue.status === 'ready') expect(defaultValue.value.manifest.packId).toBe('platform');
    const missing = await resolvePromptPack(undefined, 'person-a', new AbortController().signal);
    expect(missing).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (missing.status === 'rejected') expect(missing.reason).toContain('person-a');
  });

  it('turns a rejection into invalid, naming the pack and keeping the reason', async () => {
    const source: PromptPackSourcePort = {
      async resolve() { return { status: 'rejected', code: 'unavailable', reason: 'PC disk pack unreadable' }; },
    };
    const result = await resolvePromptPack(source, 'person-a', new AbortController().signal);
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') return;
    expect(result.code).toBe('invalid');
    expect(result.reason).toContain('person-a');
    expect(result.reason).toContain('PC disk pack unreadable');
  });

  it('takes the role label and purpose from the resolved strings and keeps the code metadata', () => {
    const profile = platformRoleProfile('executor', {
      templates: {},
      strings: { 'role.executor.label': 'PC_EXECUTOR_LABEL', 'role.executor.purpose': 'PC_EXECUTOR_PURPOSE' },
    });
    expect(profile.label).toBe('PC_EXECUTOR_LABEL');
    expect(profile.purpose).toBe('PC_EXECUTOR_PURPOSE');
    expect(profile.template).toEqual({ kind: 'legacy_template', templateId: 'platform-executor', templateRevision: 's3.1' });
    expect(profile.responsibility).toEqual(['execution']);
  });
});
