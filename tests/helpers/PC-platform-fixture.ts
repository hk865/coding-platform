/**
 * PC-1b platform fixture (frozen; written by Codex, checked and frozen by the lead, 2026-10-22).
 * Work, Query and K3 review worlds through public steps, an injectable prompt-pack source, a custom
 * Skill directory, an async counter, a failing body store, a Host whose binding changes, captured
 * and replayable commands, readPromptRecord access and frozenPromptInputs. Tests may not edit this
 * file; expectations never come from it.
 *
 * Expectations belong in tests. This file supplies inputs, public transitions,
 * captured commands and production reads; it never builds persisted facts.
 *
 * Construct fixtures serially. K3 callers install the existing shellSeam
 * module mock before opening the review fixture, just as the K3 tests do.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { vi } from 'vitest';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { PreparedTaskExecution } from '../../src/contracts/core/prepared-execution.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import {
  createPlatformPromptPackSource,
  type PromptPackSourcePort, type ResolvedPromptPackV1,
} from '../../src/contracts/prompts/prompt-pack.js';
import {
  decodePromptSetV1, promptSelectionOf,
} from '../../src/contracts/prompts/prompt-set.js';
import { createHostRuntimeResolverRegistry } from '../../src/app/host-settings.js';
import * as runtimeModule from '../../src/core/agent-runtime/runtime.js';
import type {
  ResolvedRuntimeConfiguration, RuntimeExecutionDependencies, RuntimeHostBindings,
} from '../../src/core/agent-runtime/execution-contracts.js';
import type { AgentRuntimePort } from '../../src/core/agent-runtime/ports.js';
import type { ModelInputCounter } from '../../src/core/agent-runtime/model-budget.js';
import type { ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';
import { readPromptTexts } from '../../src/core/agent-runtime/prompt-set-texts.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { ScriptedProvider, type ScriptedStep } from './PC-kernel-fixture.js';
import { B2_AT, createScriptedModel } from './B2-runtime-fixture.js';
import { createWP2Platform, claimSuccessorRun } from './WP2-platform-support.js';
import { createRLQueryFixture, rlQueryHostCtx } from './RL-query-fixture.js';
import { openK3ReviewCardWorld, createK3PendingReview, k3RequestId } from './K3-proposal-round.js';
import { openRealRunHarness } from './K3-35-continuation-fixture.js';
import { createK3_35Runtime } from './K3-35-runtime.js';
import { shellSeam } from './K3-tool-seams.js';
import { GOAL_B, PLAN_B2 } from './S5-decision-fixture.js';

export type PCReply = ScriptedStep;
type Selection = ReturnType<typeof promptSelectionOf>;
type SkillSelection = ResolvedRuntimeConfiguration['skills'];
type FrozenPrompt = ObservedModelRunOptions['prompt'];

export type PCBinding = {
  model?: ReturnType<typeof scriptedModel>;
  selection?: Partial<Selection>;
  skills?: SkillSelection;
  systemInstruction?: string | null;
  budget?: Partial<ResolvedRuntimeConfiguration['budget']>;
  /** null selects the production byte meter; undefined keeps the helper's counter. */
  inputCounter?: ModelInputCounter | null;
};

export type PCOptions = PCBinding & {
  promptPacks?: PromptPackSourcePort;
  /** Work resident-context budget; omitted keeps WP2's default. */
  contextResidentBytes?: number;
  failPutContentType?: string;
  tools?: readonly string[];
  /** Opt in to the whole-workspace Work grant; tools remain explicitly selected. */
  writable?: boolean;
  /** Bypass registry pinning deliberately, for PC-08's changing Host. */
  secondSelection?: Partial<Selection>;
};

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  return result.value;
}

function committed<T>(result: WriteResult<T>): T {
  if (result.status !== 'committed') throw new Error(JSON.stringify(result));
  return result.value;
}

/** Reuses the frozen PC Kernel provider, including its request deep copies. */
export function scriptedModel(steps: readonly PCReply[]) {
  const provider = new ScriptedProvider(steps);
  return {
    client: provider,
    requests: provider.requests,
    calls: () => provider.callCount,
    lastRequest: () => provider.requests.at(-1),
  };
}

/** Attach beforeReply to a scripted tool-call reply; release after submitting pause. */
export function replyGate() {
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return {
    reached, release,
    beforeReply: async () => { entered(); await released; },
  };
}

/** Each resolution owns a snapshot; replacing the source cannot mutate it. */
export async function mutablePromptPacks(initial?: ResolvedPromptPackV1) {
  const defaultPack = initial ?? ready(await createPlatformPromptPackSource()
    .resolve('platform', new AbortController().signal));
  let current = structuredClone(defaultPack);
  const resolutions: string[] = [];
  const source: PromptPackSourcePort = {
    async resolve(packId, signal) {
      signal.throwIfAborted();
      resolutions.push(packId);
      if (packId !== current.manifest.packId) {
        return { status: 'rejected', code: 'invalid',
          reason: `prompt pack ${packId} is not available` };
      }
      return { status: 'ready', value: structuredClone(current) };
    },
  };
  return {
    ...source, resolutions,
    snapshot: () => structuredClone(current),
    replace(pack: ResolvedPromptPackV1) { current = structuredClone(pack); },
    change(input: { base?: string; strings?: Record<string, string> }) {
      for (const key of Object.keys(input.strings ?? {})) {
        if (!Object.hasOwn(current.strings, key)) {
          throw new Error(`PC: unknown string-table key ${key}`);
        }
      }
      current = {
        ...current,
        templates: { ...current.templates,
          ...(input.base === undefined ? {} : { base: input.base }) },
        strings: { ...current.strings, ...input.strings },
      };
    },
  };
}

/** A real FileSkillLoader directory, selected through the Host's skills grant. */
export async function customSkillDirectory(content = 'PC_CUSTOM_SKILL_V1') {
  const root = await mkdtemp(join(tmpdir(), 'pc-platform-skills-'));
  const id = 'pc-custom';
  const directory = join(root, id);
  try {
    await mkdir(directory);
    await writeFile(join(directory, 'skill.json'), JSON.stringify({
      schemaVersion: 1, id, title: 'PC custom skill', kind: 'instruction',
      priority: 10, contentFile: 'content.md',
    }));
    await writeFile(join(directory, 'content.md'), content);
    return {
      selection: { resourceRoot: root, enabledIds: [id] },
      rewrite: (text: string) => writeFile(join(directory, 'content.md'), text),
      close: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export function asyncCounter(count: number) {
  const requests: ModelRequest[] = [];
  const counter: ModelInputCounter = {
    async count(request) {
      requests.push(structuredClone(request));
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      return { tokens: count, method: 'model_tokenizer', tokenizer: 'pc-fixed-async' };
    },
  };
  return { ...counter, requests };
}

export function failBodyPuts(
  store: Pick<RawArtifactStorePort, 'put' | 'read'>, contentType: string,
): Pick<RawArtifactStorePort, 'put' | 'read'> {
  return {
    read: ref => store.read(ref),
    put: input => input.contentType === contentType
      ? Promise.resolve({ status: 'rejected', code: 'unavailable',
          reason: `PC injected put failure: ${contentType}` })
      : store.put(input),
  };
}

/** First resolution uses first; every subsequent resolution uses second. */
export function hostOnSecondResolution(
  first: RuntimeHostBindings, second: RuntimeHostBindings,
): RuntimeHostBindings {
  let workCalls = 0;
  let queryCalls = 0;
  return {
    ...first,
    resolveConfiguration(ctx, input) {
      return (++workCalls === 1 ? first : second).resolveConfiguration(ctx, input);
    },
    async resolveQueryConfiguration(ctx, input) {
      const host = ++queryCalls === 1 ? first : second;
      if (!host.resolveQueryConfiguration) {
        throw new Error('PC changing Host has no Query resolver');
      }
      return host.resolveQueryConfiguration(ctx, input);
    },
  };
}

type CapturedCommand<A, R> = {
  context: CoreCallContext;
  command: A;
  result?: R;
  replay(change?: (command: A) => void): Promise<R>;
};

/** Preserve the original command identity, pins and input, including on replay. */
export function captureCommands<A, R>(
  send: (ctx: CoreCallContext, command: A) => Promise<R>,
) {
  const calls: CapturedCommand<A, R>[] = [];
  return {
    calls,
    async invoke(ctx: CoreCallContext, command: A): Promise<R> {
      const { signal, ...contextData } = ctx;
      const savedContext = structuredClone(contextData);
      const savedCommand = structuredClone(command);
      const captured: CapturedCommand<A, R> = {
        context: { ...structuredClone(savedContext), signal },
        command: structuredClone(savedCommand),
        replay(change) {
          const copy = structuredClone(savedCommand);
          change?.(copy);
          return send({ ...structuredClone(savedContext), signal }, copy);
        },
      };
      calls.push(captured);
      const result = await send(ctx, command);
      captured.result = structuredClone(result);
      return result;
    },
  };
}

async function parts(options: PCOptions) {
  const packs = await mutablePromptPacks();
  const skill = await customSkillDirectory();
  const model = options.model ?? scriptedModel([{ text: 'PC answer' }]);
  return {
    packs, skill, model,
    options: {
      ...options, model,
      skills: structuredClone(options.skills ?? skill.selection),
      promptPacks: options.promptPacks ?? packs,
    },
  };
}

type WiredOptions = Awaited<ReturnType<typeof parts>>['options'];

function wireRuntime(
  deps: RuntimeExecutionDependencies, options: WiredOptions,
  create: typeof runtimeModule.createAgentRuntime,
) {
  // The entry and Query authorization owners retain this same Host object.
  // Replace its methods in place so every owner sees the same registry.
  const original: RuntimeHostBindings = {
    ...deps.host,
    resolveConfiguration: deps.host.resolveConfiguration.bind(deps.host),
    ...(deps.host.resolveQueryConfiguration === undefined ? {} : {
      resolveQueryConfiguration: deps.host.resolveQueryConfiguration.bind(deps.host),
    }),
  };
  function binding(change: PCBinding = {}): RuntimeHostBindings {
    const selected = structuredClone({ ...options.selection, ...change.selection });
    const budget = structuredClone({ ...options.budget, ...change.budget });
    const skills = structuredClone(change.skills ?? options.skills);
    const model = change.model ?? options.model;
    const instruction = change.systemInstruction === undefined
      ? options.systemInstruction : change.systemInstruction;
    const counter = change.inputCounter === undefined
      ? options.inputCounter : change.inputCounter;
    function project(value: ResolvedRuntimeConfiguration): ResolvedRuntimeConfiguration {
      const bound = {
        ...value.model,
        configuration: { ...value.model.configuration },
        client: model.client,
        selection: { ...promptSelectionOf(value.model), ...selected },
      };
      if (counter === null) delete bound.inputCounter;
      else if (counter !== undefined) bound.inputCounter = counter;
      return {
        ...value, model: bound, budget: { ...value.budget, ...budget },
        skills: structuredClone(skills),
        systemInstruction: instruction === undefined ? value.systemInstruction : instruction,
      };
    }
    return {
      ...original,
      async resolveConfiguration(ctx, input) {
        const result = await original.resolveConfiguration(ctx, input);
        return result.status === 'ready'
          ? { status: 'ready', value: project(result.value) } : result;
      },
      ...(original.resolveQueryConfiguration === undefined ? {} : {
        async resolveQueryConfiguration(
          ...args: Parameters<NonNullable<RuntimeHostBindings['resolveQueryConfiguration']>>
        ) {
          const result = await original.resolveQueryConfiguration!(...args);
          return result.status === 'ready'
            ? { status: 'ready' as const, value: project(result.value) } : result;
        },
      }),
    };
  }
  const first = binding();
  const registry = createHostRuntimeResolverRegistry(first);
  const active = options.secondSelection === undefined ? registry
    : hostOnSecondResolution(first, binding({ selection: options.secondSelection }));
  deps.host.resolveConfiguration = active.resolveConfiguration.bind(active);
  if (active.resolveQueryConfiguration) {
    deps.host.resolveQueryConfiguration = active.resolveQueryConfiguration.bind(active);
  }
  const authorization = captureCommands(
    deps.modelRequests.authorizeModelRequest.bind(deps.modelRequests));
  const query = deps.queryExecution;
  const usage = query === undefined ? undefined
    : captureCommands(query.recordQueryUsage.bind(query));
  const admission = query === undefined ? undefined
    : captureCommands(query.admitQueryModelRequest.bind(query));
  const wired: RuntimeExecutionDependencies = {
    ...deps,
    promptPacks: options.promptPacks,
    bodies: options.failPutContentType === undefined ? deps.bodies
      : failBodyPuts(deps.bodies, options.failPutContentType),
    modelRequests: {
      authorizeModelRequest: authorization.invoke,
      recordModelRequestAttempt: deps.modelRequests.recordModelRequestAttempt.bind(deps.modelRequests),
    },
    ...(query === undefined ? {} : {
      queryExecution: { ...query,
        recordQueryUsage: usage!.invoke, admitQueryModelRequest: admission!.invoke },
    }),
  };
  return {
    deps: wired, runtime: create(wired), registry,
    installBinding(change: PCBinding) {
      if (options.secondSelection !== undefined) {
        throw new Error('PC: this fixture uses the deliberately unpinned Host');
      }
      return registry.install(binding(change));
    },
    commands: {
      authorization, usage, admission,
      get reservations() {
        return usage?.calls.filter(call =>
          call.command.input.entries.some(entry => entry.usageStatus === 'reserved')) ?? [];
      },
    },
  };
}

async function injected<T>(make: () => Promise<T>, options: WiredOptions) {
  const original = runtimeModule.createAgentRuntime;
  let wired: ReturnType<typeof wireRuntime> | undefined;
  const spy = vi.spyOn(runtimeModule, 'createAgentRuntime').mockImplementation(deps => {
    if (deps === undefined) return original();
    wired = wireRuntime(deps, options, original);
    return wired.runtime;
  });
  try {
    const value = await make();
    if (wired === undefined) throw new Error('PC: helper did not construct a wired Runtime');
    return { value, wire: wired };
  } finally {
    spy.mockRestore();
  }
}

function readRecord(port: AgentRuntimePort, ctx: CoreCallContext, ref: RunRef | QueryRunRef) {
  if (port.readPromptRecord === undefined) throw new Error('PC: readPromptRecord is not published');
  return port.readPromptRecord(ctx, ref);
}

function workHandle(
  port: AgentRuntimePort, deps: RuntimeExecutionDependencies,
  ctx: CoreCallContext, runRef: RunRef,
) {
  let prepared: PreparedTaskExecution | undefined;
  let sequence = 0;
  const id = (kind: string) => `pc-${kind}:${runRef.runId}:${++sequence}`;
  const consumerId = `pc-consumer:${runRef.runId}`;
  const currentPrepared = () => {
    if (prepared === undefined) throw new Error('PC: prepare this Work first');
    return prepared;
  };
  async function control(kind: 'pause' | 'resume') {
    if (!deps.controls || !port.deliverControl) throw new Error('PC: Work controls are not wired');
    const current = ready(await deps.executions.readExecution(ctx, runRef));
    const submitted = committed(await deps.controls.submitControl(ctx, {
      input: { runRef, kind, reason: `PC ${kind}` },
      meta: { requestId: id(kind), expected: [{ ref: runRef, revision: current.run.revision }] },
    }));
    return ready(await port.deliverControl(ctx, { intentRef: submitted.intent.ref }));
  }
  async function preparedTexts() {
    const body = ready(await deps.materials.openArtifact(ctx, {
      ref: currentPrepared().envelope.bundleRef, usage: 'historical_explanation',
    }));
    const manifest = JSON.parse(body.body) as { promptSet?: unknown; input?: unknown };
    const set = decodePromptSetV1(manifest.promptSet);
    if (set === null || typeof manifest.input !== 'string') {
      throw new Error('PC: the production manifest has no valid prompt set/input');
    }
    const texts = ready(await readPromptTexts(deps.bodies, set));
    const prompt: FrozenPrompt = {
      base: texts.base, skills: texts.skills, reasoningReplay: set.reasoningReplay,
    };
    return { input: manifest.input, set, texts, prompt };
  }
  const start = () => port.startRun(ctx, {
    prepared: currentPrepared(), consumerId, requestId: id('start'),
  });
  return {
    runRef,
    async prepare() {
      prepared = ready(await port.prepareExecution(ctx, { runRef, requestId: id('prepare') }));
      return prepared;
    },
    start,
    pause: () => control('pause'),
    async resume() {
      await control('resume');
      return start();
    },
    observe: () => port.observeRun(ctx, { runRef }),
    preparedTexts,
    readPromptRecord: () => readRecord(port, ctx, runRef),
  };
}

/** WP2 owns the real platform, claim, control owner and constant B2_AT clock. */
export async function openPCWorkFixture(options: PCOptions = {}) {
  const p = await parts(options);
  try {
    const opened = await injected(() => createWP2Platform({
      kind: 'sqlite', tools: options.tools ?? ['read'],
      ...(options.writable === undefined ? {} : { writable: options.writable }),
      ...(options.contextResidentBytes === undefined ? {} : { contextResidentBytes: options.contextResidentBytes }),
      allowSourceRead: true, allowAnyRun: true, skillIds: [],
    }), p.options);
    const base = opened.value;
    const wire = opened.wire;
    if (base.claim === null) {
      await base.close();
      throw new Error('PC: WP2 did not claim its Work');
    }
    const claim = base.claim;
    const work = (ref: RunRef) => workHandle(wire.runtime.port, wire.deps, base.ctx, ref);
    return {
      base, runtime: wire.runtime.port, model: p.model, packs: p.packs,
      skill: p.skill, hostRegistry: wire.registry,
      installBinding: wire.installBinding, commands: wire.commands,
      work: work(claim.runRef),
      // WP2 supplies this same fixed clock to the real authorization service.
      clock: wire.deps.now,
      async continuation(afterRunRef: RunRef = claim.runRef, note = 'Continue PC work') {
        const prior = ready(await base.platform.executions.readExecution(base.ctx, afterRunRef));
        const goal = ready(await base.platform.plans.queryGoal(base.ctx, base.goalRef));
        const requeue = committed(await base.platform.claims.requeueTask!(base.ctx, {
          input: { taskRef: claim.task, afterRunRef, reason: 'Continue PC work', note },
          meta: { requestId: `pc-requeue:${afterRunRef.runId}`, expected: [
            { ref: base.goalRef, revision: goal.goal.revision },
            { ref: afterRunRef, revision: prior.run.revision },
          ] },
        }));
        if (requeue.kind !== 'requeued') throw new Error(JSON.stringify(requeue));
        const ref = await claimSuccessorRun(base, base.goalRef, claim.task.taskId,
          claim.sessionRef, `pc-successor:${afterRunRef.runId}`, claim.planRef, requeue.requeue.ref);
        return work(ref);
      },
      async close() {
        try { await base.close(); } finally { await p.skill.close(); }
      },
    };
  } catch (error) {
    await p.skill.close();
    throw error;
  }
}

/**
 * Reuse RL's complete submit/Session/claim/prepare chain. Stop at its PUBLIC
 * startQuery call, before executing it, and retain the exact arguments.
 */
export async function openPCQueryFixture(options: PCOptions = {}) {
  const p = await parts(options);
  try {
    const opened = await injected(() => createRLQueryFixture({
      replies: [], tools: options.tools ?? ['read'], readonlyCommandAccess: false,
    }), p.options);
    const base = opened.value;
    const wire = opened.wire;
    const actualStart = base.platform.runtime.startQuery.bind(base.platform.runtime);
    type StartArgs = Parameters<typeof actualStart>;
    let captured: StartArgs | undefined;
    let preparing = false;
    return {
      base, runtime: wire.runtime.port, model: p.model, packs: p.packs,
      skill: p.skill, hostRegistry: wire.registry,
      installBinding: wire.installBinding, commands: wire.commands,
      async prepare() {
        if (preparing || captured !== undefined) throw new Error('PC: Query preparation is one-shot');
        preparing = true;
        const stopped = new Error('PC: stopped before public Query start');
        const spy = vi.spyOn(base.platform.runtime, 'startQuery').mockImplementation(async (ctx, request) => {
          captured = [ctx, structuredClone(request)];
          throw stopped;
        });
        try {
          await base.run();
          throw new Error('PC: RL did not reach startQuery');
        } catch (error) {
          if (error !== stopped) throw error;
        } finally {
          preparing = false;
          spy.mockRestore();
        }
        if (captured === undefined) throw new Error('PC: Query start arguments were not captured');
        return structuredClone((captured as StartArgs)[1].prepared);
      },
      start() {
        if (captured === undefined) throw new Error('PC: prepare this Query first');
        return actualStart(captured[0], structuredClone(captured[1]));
      },
      readPromptRecord() {
        if (captured === undefined) throw new Error('PC: prepare this Query first');
        return readRecord(wire.runtime.port, rlQueryHostCtx(), captured[1].prepared.queryRunRef);
      },
      async close() {
        try { await base.close(); } finally { await p.skill.close(); }
      },
    };
  } catch (error) {
    await p.skill.close();
    throw error;
  }
}

/**
 * Requires the existing K3 shellSeam mock in the calling test.
 * The pending review is produced by RUN-20/RUN-22 over a real blocked Kernel
 * call; the new review round is claimed publicly and prepared separately.
 */
export async function openPCK3ReviewFixture(
  options: PCOptions & { sourceHistory?: 'empty' | 'completed_turn' } = {},
) {
  const p = await parts(options);
  const world = await openK3ReviewCardWorld('memory', { realKernelCommandFacts: true })
    .catch(async error => { await p.skill.close(); throw error; });
  let harness: Awaited<ReturnType<typeof openRealRunHarness>> | undefined;
  let live: ReturnType<typeof runtimeModule.createAgentRuntime> | undefined;
  try {
    let review: Awaited<ReturnType<typeof createK3PendingReview>>;
    if (options.sourceHistory === 'completed_turn') {
      harness = await openRealRunHarness(world, { finalizeCompletedBeforeRequeue: true });
      const sourceSession = await world.fixture.createRealS5Session('pc-history-source');
      const taskId = world.tasks[0]!;
      const first = await harness.claimRun({
        sessionRef: sourceSession, planRef: PLAN_B2, taskId,
        requestId: k3RequestId(world, 'pc-history-claim'),
      });
      const completed = await harness.prepareAndStart(first, {
        model: createScriptedModel([{ kind: 'text', text: 'PC completed source history.' }]),
        tools: ['read'], writeScope: [], blockOnShell: false,
      });
      const ended = ready(await completed.started);
      if (ended.run.status !== 'ended' || ended.run.outcome !== 'completed') {
        throw new Error('PC: the source history turn did not complete');
      }
      const requeue = await harness.requeue(first, 'Create the PC blocked source Run');
      const blocked = await harness.claimRun({
        sessionRef: sourceSession, planRef: PLAN_B2, taskId, requeueRef: requeue.ref,
        requestId: k3RequestId(world, 'pc-pending-claim'),
      });
      let running: Awaited<ReturnType<typeof harness.prepareAndStart>> | undefined;
      try {
        running = await harness.prepareAndStart(blocked, {
          model: createScriptedModel([{ kind: 'calls', calls: [{
            callId: 'pc-pending-call', name: 'shell', args: { command: 'printf PC' },
          }] }]),
          tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true,
        });
        await harness.createRecord(blocked);
      } finally {
        shellSeam.release();
        await running?.started.catch(() => undefined);
      }
      review = ready(await world.reviews.readReview(world.fixture.ctx, { runRef: blocked.runRef }));
      if (review.status !== 'pending_review' || review.items.length !== 1) {
        throw new Error('PC: the blocked Run did not leave one pending review item');
      }
    } else {
      review = await createK3PendingReview(world, {
        label: 'pc-pending-review', command: 'printf PC', callId: 'pc-pending-call',
      });
    }
    const sessionRef = await world.fixture.createRealS5Session('pc-review-session');
    const claim = await world.fixture.claimRun({
      requestId: k3RequestId(world, 'pc-review-claim'),
      goalRef: GOAL_B, planRef: PLAN_B2, taskId: review.task.taskId, sessionRef,
      review: { reviewRef: review.ref, expectedRevision: review.revision, phase: 'review' },
    });
    harness ??= await openRealRunHarness(world);
    let deps!: RuntimeExecutionDependencies;
    const opened = await injected(async () => createK3_35Runtime(world, {
      model: p.model, tools: ['read', 'run_readonly_command'], writeScope: [],
      now: () => world.fixture.now(),
      eventId: () => k3RequestId(world, 'pc-review-event'),
      newId: () => world.fixture.newId(), kernelStores: harness!.kernelStores,
      workspaceRevision: async () => ready(await deps.executions
        .readExecution(world.fixture.ctx, claim.runRef)).run.workspaceSnapshot.revision,
    }), p.options);
    deps = opened.wire.deps;
    live = opened.wire.runtime;
    return {
      world, review, claim, runtime: live.port,
      model: p.model, packs: p.packs, skill: p.skill,
      work: workHandle(live.port, deps, world.fixture.ctx, claim.runRef),
      async close() {
        try { await live?.close?.(); }
        finally {
          try { await harness?.closeUnion(); }
          finally { try { await world.close(); } finally { await p.skill.close(); } }
        }
      },
    };
  } catch (error) {
    try { await live?.close?.(); }
    finally {
      try { await harness?.closeUnion(); }
      finally { try { await world.close(); } finally { await p.skill.close(); } }
    }
    throw error;
  }
}

/**
 * Argument plumbing for direct runObservedModel callers.
 * Production preparation resolves/renders/merges/selects; readPromptTexts
 * reconstructs its frozen inputs. No expected system text is computed here.
 */
export async function frozenPromptInputs(options: {
  skills?: SkillSelection;
  systemInstruction?: string;
  promptPacks?: PromptPackSourcePort;
  promptPack?: string;
  reasoningReplay?: Selection['reasoningReplay'];
} = {}): Promise<FrozenPrompt> {
  const fixture = await openPCWorkFixture({
    model: scriptedModel([]), tools: [],
    skills: options.skills ?? {
      resourceRoot: resolve(import.meta.dirname, '../../vendor/coding-agent/resources/skills'),
      enabledIds: ['coding-safety'],
    },
    systemInstruction: options.systemInstruction ?? null,
    selection: {
      promptPack: options.promptPack ?? 'platform',
      reasoningReplay: options.reasoningReplay ?? 'current_run',
    },
    ...(options.promptPacks === undefined ? {} : { promptPacks: options.promptPacks }),
  });
  try {
    await fixture.work.prepare();
    return (await fixture.work.preparedTexts()).prompt;
  } finally {
    await fixture.close();
  }
}

/** The literal clock used by WP2 for PC-09's equal-issuedAt permits. */
export const PC_WORK_TIME = B2_AT;
