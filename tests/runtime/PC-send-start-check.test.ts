/**
 * PC-1b group S, ruling 16: the Work start (and proof-backed resume) and the
 * Query pre-entry check compare the Host binding's prompt selection, provider
 * and model with the prepared `promptSet`. A difference is `forbidden` and the
 * scripted model is called zero times.
 *
 * Every world is opened through the frozen PC fixture and driven through its
 * public prepare/start; the changed Host is the fixture's second resolution.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { ResolvedRuntimeConfiguration, RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import * as executionControlModule from '../../src/core/agent-runtime/execution-control.js';
import * as hostSettingsModule from '../../src/app/host-settings.js';
import { openPCQueryFixture, openPCWorkFixture, replyGate, scriptedModel } from '../helpers/PC-platform-fixture.js';

type StartResult = Awaited<ReturnType<Awaited<ReturnType<typeof openPCWorkFixture>>['work']['start']>>;
type QueryStartResult = Awaited<ReturnType<Awaited<ReturnType<typeof openPCQueryFixture>>['start']>>;

function expectForbiddenResult(result: ReadResult<unknown>) {
  expect(result.status).toBe('rejected');
  if (result.status === 'rejected') expect(result.code).toBe('forbidden');
}

/** A Work start returns the TaskExecutionRecord; the two types are not interchangeable. */
function expectForbidden(result: StartResult) {
  expectForbiddenResult(result);
}

/** A Query start returns the QueryExecutionRecord (its state lives at run.run.executionState). */
function expectQueryForbidden(result: QueryStartResult) {
  expectForbiddenResult(result);
}

/**
 * Ruling 16 also compares the bound provider and model, which the fixture's
 * `secondSelection` knob cannot change. The fixture exposes the same live Host
 * binding its registry resolves; wrapping it after preparation is the input a
 * changed Host provider/model would give the start.
 */
async function workStartWithChangedConfig(
  change: (value: ResolvedRuntimeConfiguration) => ResolvedRuntimeConfiguration,
): Promise<{ result: StartResult; calls: number }> {
  const fixture = await openPCWorkFixture();
  try {
    await fixture.work.prepare();
    const wired = fixture.base.host.resolveConfiguration;
    fixture.base.host.resolveConfiguration = async (ctx, input) => {
      const result = await wired(ctx, input);
      return result.status === 'ready' ? { status: 'ready' as const, value: change(result.value) } : result;
    };
    const result = await fixture.work.start();
    return { result, calls: fixture.model.calls() };
  } finally {
    await fixture.close();
  }
}

async function queryStartWithChangedConfig(
  change: (value: ResolvedRuntimeConfiguration) => ResolvedRuntimeConfiguration,
): Promise<{ result: QueryStartResult; calls: number }> {
  const real = hostSettingsModule.createHostRuntimeResolverRegistry;
  const spy = vi.spyOn(hostSettingsModule, 'createHostRuntimeResolverRegistry').mockImplementation(initial => {
    const original = initial.resolveQueryConfiguration;
    if (original !== undefined) {
      let resolutions = 0;
      initial.resolveQueryConfiguration = async (ctx, input) => {
        const result = await original(ctx, input);
        resolutions += 1;
        return resolutions > 1 && result.status === 'ready'
          ? { status: 'ready' as const, value: change(result.value) } : result;
      };
    }
    return real(initial);
  });
  let fixture: Awaited<ReturnType<typeof openPCQueryFixture>>;
  try {
    fixture = await openPCQueryFixture();
  } finally {
    spy.mockRestore();
  }
  try {
    await fixture.prepare();
    const result = await fixture.start();
    return { result, calls: fixture.model.calls() };
  } finally {
    await fixture.close();
  }
}

function changeProvider(value: ResolvedRuntimeConfiguration): ResolvedRuntimeConfiguration {
  return { ...value, model: { ...value.model,
    configuration: { ...value.model.configuration, provider: 'pc-other-provider' } } };
}

function changeModel(value: ResolvedRuntimeConfiguration): ResolvedRuntimeConfiguration {
  return { ...value, model: { ...value.model,
    configuration: { ...value.model.configuration, model: 'pc-other-bound-model' } } };
}

type WorkFixture = Awaited<ReturnType<typeof openPCWorkFixture>>;
type WorkPrepared = Awaited<ReturnType<WorkFixture['work']['prepare']>>;

/** Start a Work, pause it at its first reply's safe point, and return the prepared value. */
async function pausedWork(): Promise<{ fixture: WorkFixture; prepared: WorkPrepared }> {
  const gate = replyGate();
  const fixture = await openPCWorkFixture({
    model: scriptedModel([
      { toolCalls: [{ callId: 'pc-resume-call', name: 'read', arguments: { path: 'wp2-read.txt' } }],
        beforeReply: gate.beforeReply },
      { text: 'PC resume final answer' },
    ]),
  });
  const prepared = await fixture.work.prepare();
  const running = fixture.work.start();
  await gate.reached;
  await fixture.work.pause();
  gate.release();
  await running.catch(() => undefined);
  return { fixture, prepared };
}

describe('ruling 16: Work start refuses a changed Host prompt binding', () => {
  it('refuses a changed promptPack and calls the model zero times', async () => {
    const fixture = await openPCWorkFixture({ secondSelection: { promptPack: 'pc-other-pack' } });
    try {
      await fixture.work.prepare();
      expectForbidden(await fixture.work.start());
      expect(fixture.model.calls()).toBe(0);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('refuses a changed modelId and calls the model zero times', async () => {
    const fixture = await openPCWorkFixture({ secondSelection: { modelId: 'pc-other-model' } });
    try {
      await fixture.work.prepare();
      expectForbidden(await fixture.work.start());
      expect(fixture.model.calls()).toBe(0);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('refuses a changed reasoningReplay and calls the model zero times', async () => {
    const fixture = await openPCWorkFixture({ secondSelection: { reasoningReplay: 'none' } });
    try {
      await fixture.work.prepare();
      expectForbidden(await fixture.work.start());
      expect(fixture.model.calls()).toBe(0);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('refuses a changed provider and calls the model zero times', async () => {
    const { result, calls } = await workStartWithChangedConfig(value => ({
      ...value,
      model: { ...value.model, configuration: { ...value.model.configuration, provider: 'pc-other-provider' } },
    }));
    expectForbidden(result);
    expect(calls).toBe(0);
  }, 60_000);

  it('refuses a changed model and calls the model zero times', async () => {
    const { result, calls } = await workStartWithChangedConfig(value => ({
      ...value,
      model: { ...value.model, configuration: { ...value.model.configuration, model: 'pc-other-bound-model' } },
    }));
    expectForbidden(result);
    expect(calls).toBe(0);
  }, 60_000);

  it('refuses a selection-less start binding prepared as test/test and calls the model zero times', async () => {
    const fixture = await openPCWorkFixture();
    try {
      let start = false;
      const wired = fixture.base.host.resolveConfiguration;
      fixture.base.host.resolveConfiguration = async (ctx, input) => {
        const result = await wired(ctx, input);
        if (result.status !== 'ready') return result;
        const model = result.value.model;
        const configuration = start
          ? { ...model.configuration, revision: 'pc-other-revision', provider: 'pc-other-provider', model: 'pc-other-model' }
          : { ...model.configuration, revision: 'test-revision', provider: 'test', model: 'test' };
        return { status: 'ready' as const, value: { ...result.value,
          model: { ...model, configuration, selection: undefined } as unknown as typeof model } };
      };
      await fixture.work.prepare();
      start = true;
      expectForbidden(await fixture.work.start());
      expect(fixture.model.calls()).toBe(0);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});

describe('ruling 16: Query start refuses a changed Host prompt binding before entry', () => {
  it('refuses a changed promptPack and calls the model zero times', async () => {
    const fixture = await openPCQueryFixture({ secondSelection: { promptPack: 'pc-other-pack' } });
    try {
      await fixture.prepare();
      expectQueryForbidden(await fixture.start());
      expect(fixture.model.calls()).toBe(0);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('refuses a changed modelId and calls the model zero times', async () => {
    const fixture = await openPCQueryFixture({ secondSelection: { modelId: 'pc-other-model' } });
    try {
      await fixture.prepare();
      expectQueryForbidden(await fixture.start());
      expect(fixture.model.calls()).toBe(0);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('refuses a changed reasoningReplay and calls the model zero times', async () => {
    const fixture = await openPCQueryFixture({ secondSelection: { reasoningReplay: 'none' } });
    try {
      await fixture.prepare();
      expectQueryForbidden(await fixture.start());
      expect(fixture.model.calls()).toBe(0);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('refuses a changed provider and calls the model zero times', async () => {
    const { result, calls } = await queryStartWithChangedConfig(changeProvider);
    expectQueryForbidden(result);
    expect(calls).toBe(0);
  }, 60_000);

  it('refuses a changed model and calls the model zero times', async () => {
    const { result, calls } = await queryStartWithChangedConfig(changeModel);
    expectQueryForbidden(result);
    expect(calls).toBe(0);
  }, 60_000);
});

describe('ruling 16: a resume compares only with a live handle', () => {
  it('refuses a changed binding on a resume with the live handle and makes no new model call', async () => {
    const { fixture } = await pausedWork();
    try {
      const wired = fixture.base.host.resolveConfiguration;
      fixture.base.host.resolveConfiguration = async (ctx, input) => {
        const result = await wired(ctx, input);
        return result.status === 'ready'
          ? { status: 'ready' as const, value: changeProvider(result.value) } : result;
      };
      const callsBefore = fixture.model.calls();
      expectForbidden(await fixture.work.resume());
      expect(fixture.model.calls()).toBe(callsBefore);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('answers busy before the binding check when no live handle exists, with no new model call', async () => {
    let coordinator: ReturnType<typeof executionControlModule.createRuntimeControlCoordinator> | undefined;
    const real = executionControlModule.createRuntimeControlCoordinator;
    const spy = vi.spyOn(executionControlModule, 'createRuntimeControlCoordinator').mockImplementation(deps => {
      const created = real(deps);
      coordinator = created;
      return created;
    });
    const gate = replyGate();
    let fixture: WorkFixture;
    try {
      fixture = await openPCWorkFixture({
        model: scriptedModel([
          { toolCalls: [{ callId: 'pc-busy-call', name: 'read', arguments: { path: 'wp2-read.txt' } }],
            beforeReply: gate.beforeReply },
          { text: 'PC busy final answer' },
        ]),
      });
    } finally {
      spy.mockRestore();
    }
    try {
      await fixture.work.prepare();
      const running = fixture.work.start();
      await gate.reached;
      await fixture.work.pause();
      gate.release();
      await running.catch(() => undefined);
      if (coordinator === undefined) throw new Error('PC did not capture the Runtime control coordinator');
      // The live-handle map is gone: this is the "another process" case.
      await coordinator.close();
      // A changed binding would be forbidden if the check were reached first.
      const wired = fixture.base.host.resolveConfiguration;
      fixture.base.host.resolveConfiguration = async (ctx, input) => {
        const result = await wired(ctx, input);
        return result.status === 'ready'
          ? { status: 'ready' as const, value: changeProvider(result.value) } : result;
      };
      const callsBefore = fixture.model.calls();
      const resumed = await fixture.work.resume();
      expect(resumed.status).toBe('rejected');
      if (resumed.status === 'rejected') expect(resumed.code).toBe('busy');
      expect(fixture.model.calls()).toBe(callsBefore);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});

describe('ruling 16: a Query after entry only observes', () => {
  it('returns the observation on a second start and makes no new model call', async () => {
    // Capture the exact binding object the fixture's resolver registry pins for
    // this QueryRun; changing that object after entry is a Host that answers
    // another provider/model from the second start on.
    let original: RuntimeHostBindings | undefined;
    const real = hostSettingsModule.createHostRuntimeResolverRegistry;
    const spy = vi.spyOn(hostSettingsModule, 'createHostRuntimeResolverRegistry').mockImplementation(initial => {
      original = initial;
      return real(initial);
    });
    let fixture: Awaited<ReturnType<typeof openPCQueryFixture>>;
    try {
      fixture = await openPCQueryFixture({
        model: scriptedModel([{ text: 'PC query observed answer' }]),
      });
    } finally {
      spy.mockRestore();
    }
    try {
      await fixture.prepare();
      const first = await fixture.start();
      expect(first.status, JSON.stringify(first)).toBe('ready');
      if (first.status !== 'ready') return;
      const calls = fixture.model.calls();
      if (original === undefined || original.resolveQueryConfiguration === undefined) {
        throw new Error('PC did not capture the Query Host binding');
      }
      const resolve = original.resolveQueryConfiguration.bind(original);
      original.resolveQueryConfiguration = async (ctx, input) => {
        const result = await resolve(ctx, input);
        return result.status === 'ready'
          ? { status: 'ready' as const, value: changeProvider(changeModel(result.value)) } : result;
      };
      const second = await fixture.start();
      expect(second.status, JSON.stringify(second)).toBe('ready');
      if (second.status !== 'ready') return;
      // The same original execution comes back: same run identity and revision.
      expect(second.value.run.ref).toEqual(first.value.run.ref);
      expect(second.value.run.revision).toBe(first.value.run.revision);
      expect(fixture.model.calls()).toBe(calls);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
