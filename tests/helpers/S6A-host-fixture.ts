/**
 * The SE2 world: the frozen request world (`openS6ARequestWorld`, tests/helpers/S6A-request-fixture.ts) with its
 * real Host, Runtime and frozen Kernel, plus what the secretary-round rows need to run rounds, hold them at named
 * points, crash the Host and change the Host's own settings. Memory or SQLite; a crash is SQLite only (a restart
 * reopens the same directory). A reopen is SQLite, or memory with the A4 seam's `sharedMemoryStore` (the same
 * records, bodies and directory); the start-up switch takes effect at the next start.
 *
 * What it adds, and the public step or allowed double behind each item:
 * - A scripted model per Session (rule sheet A8: the runtime configuration's model provider). Every Host start of
 *   the world goes through a delegating spy on `createLocalWorkbenchHost`, installed only while the start runs
 *   (the `openS6ATwoWorkspaceWorld` pattern), that replaces three Host inputs and nothing else: the provider
 *   registry (its `create` returns a router around the world's own client), the secretary profile's and its
 *   binding's budget (`secretaryBudget`, so a scripted usage of 500,000 is under the model window) and, on the
 *   memory backend, a settings directory beside the Kernel store (SQLite has one by default). The Host it returns
 *   is the real one behind a wrapper whose `close` can abandon it (the crash, below).
 *   The router serves a Kernel run from the queue of the Session it runs in when that queue has a reply left at
 *   the run's first model request, and keeps the whole run there; any other run goes to the world's own model
 *   (so the base world's helpers, which script that model, keep working). Each queued reply is the S2B BE1
 *   scripted model's (`createBe1ScriptedModel`): text or tool calls, each with an optional usage snapshot (absent
 *   = no usage event, so a null usage can follow a non-null one), or a provider failure. The tools the model calls
 *   are the real ones the Runtime gave the Kernel. A model call of an abandoned Host is refused and recorded.
 * - The Session a Kernel run belongs to: a delegating spy on the Kernel's `runCodingAgent` (the Runtime's Kernel
 *   entry, `src/core/agent-runtime/observed-model-run.ts`), installed while a host world is open. It forwards the
 *   real call unchanged inside an async context naming the run's Kernel Session, which the router reads; it is
 *   also where gate (d) and the tool holds sit.
 * - Gates (rule sheet A3: each holds one real step and then lets it go on unchanged), independent per Session:
 *   (a) the claim commit of a Query on a Session (`r5b-query-execution:claimed:`), so after an `assigned` commit
 *   the round is not yet claimed; (b) the bind-prepared commit (`…:prepared:`), so the round is claimed and not yet
 *   prepared; (c) the start commit (`…:entering:`), so it is prepared and not yet started; (e) a drop commit
 *   (`request.route:` writing a routing round with reason `dropped`). (a)–(c) and (e) hold the prepared commit
 *   before `records.commit` through the frozen commit barrier (tests/helpers/S6A-commit-barrier.ts), so THE TEST
 *   FILE MUST INSTALL THE BARRIER'S TWO `vi.mock`s (see that file); matching reads only the held commit's own
 *   records. (d) holds `runCodingAgent` for a Session: the start commit has landed, the Kernel has not been
 *   entered. A model hold holds a Session's next model request before its reply, whether the Session's queue or
 *   the world's model would serve it (holds of one Session in the order they were set); a tool hold holds the real
 *   handler of a named Kernel extension tool (`list_files`, `look_graph`, …) once the Kernel has started the call,
 *   so the call has no result (R-09). Plain Queries make the claim, prepared and start commits today.
 *   A gate belongs to the Host running when it is set: every kind checks, when a step arrives, that this Host is
 *   still the world's live one, so after a crash or a reopen a gate not reached yet never catches a step of the new
 *   Host (or of the abandoned one). A step that already arrived stays held until its gate is released.
 * - Crash and restart (SQLite; rule sheet A2 v3, the `restart({ crash: true })` shape of tests/scenarios/harness.ts):
 *   `crash()` abandons the running Host (no `close`; it keeps whatever it holds), rewrites the lock to an exited
 *   process (`writeStaleLock`) and starts a new Host on the same directory through the base world's `reopen`.
 *   The abandoned Host is closed only by `close()`, after every gate of the world is released. Call `crash()` only
 *   while nothing of the old Host runs on (the rule of tests/scenarios/harness.ts:32; an entered commit of the old
 *   Host keeps waiting at its gate, as at :1068): the abandoned Host keeps its in-memory lease and drivers, and a
 *   held step stops that step only, not the Host's other loops (the request driver is off unless the world's
 *   `extraHostOptions` name `requestDriver: 'on'`, see the base world). A Host with a wake loop of its own is not stopped by
 *   holding one Session's step.
 * - The Host setting `automation.resumeOnStartup` through its route `automation/save` (takes effect at the next
 *   start). A person's prompt pack through PC-2's routes: `prompts/packs/create`, `prompts/templates/read|save`,
 *   and the selection `models/save` with `promptPack` + `models/select` on a model of the Host's own catalog
 *   (the startup bindings' model, so its secret stays the configured one).
 * - The request commands through their HTTP routes (`requests/submit`, `requests/route` manual or `dropped`,
 *   `requests/select-idea`) as the Host's human actor, the owner read `requestFacts.readRequest`, and bounded
 *   polling of that read (`waitFor` of tests/scenarios/harness.ts) for states the Host reaches on its own.
 * - The project's two pointers (`ensureProjectPointers`) through the governance of the memory fixture
 *   (tests/helpers/S6A-memory-fixture.ts, `seedS6AMemory(...).governance`): it reads both pointers and every guard
 *   revision through public reads, then installs and activates the policy and adopts the architecture where missing.
 *
 * Host starts of host worlds are serialized; do not open another S6A world while one starts. No record, event or
 * Session field is written by hand and nothing is asserted by reading the store.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { dirname, join } from 'node:path';
import { vi } from 'vitest';
import * as kernelModule from '../../vendor/coding-agent/dist/public-api.js';
import type {
  ModelClientPort, ModelRequest, ToolCall, ToolDefinition,
} from '../../vendor/coding-agent/dist/public-api.js';
import * as hostModule from '../../src/app/host.js';
import type { LocalWorkbenchHost, LocalWorkbenchHostOptions } from '../../src/app/host.js';
import { PLATFORM_TOKEN_HEADER } from '../../src/app/core-http-types.js';
import {
  SETTINGS_API_PREFIX, type HostSettingsSnapshot, type SettingsResponse, type SettingsRoutes,
} from '../../src/app/host-settings-types.js';
import type { WorkbenchRuntimeConfiguration, WorkbenchRuntimeProviderDependencies } from '../../src/app/runtime-configuration.js';
import type {
  RequestRouteResultV1, RequestSelectIdeaResultV1, RequestSubmitResultV1,
} from '../../src/business/workflow/request-intake.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { PreparedCommit } from '../../src/core/record-store/ports.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { waitFor } from '../scenarios/harness.js';
import { deferred, driveWorkflow, writeStaleLock, type Deferred } from './A2-restart-fixture.js';
import { AG2B_WORK_TASK_ID, ag2bPlanDraft, graphWrite } from './AG2b-collaboration-fixture.js';
import { commitBarrier, type CommitMatch } from './S6A-commit-barrier.js';
import { seedS6AMemory, type S6AGovernance, type S6AMemoryWorld } from './S6A-memory-fixture.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, S6A_SECRETARY_ROLE, S6A_SECRETARY_ROLE_BINDING,
  type S6AReopenOptions, type S6ARequestWorld, type S6ASession, type S6AWorldOptions,
} from './S6A-request-fixture.js';
import { createBe1ScriptedModel, type Be1Reply, type Be1ScriptedModel, type Be1Usage } from './S2B-be1-platform-fixture.js';

// ---------------------------------------------------------------------------
// Scripted replies
// ---------------------------------------------------------------------------

/** A provider usage snapshot (the Kernel's `usage_snapshot` event). */
export type S6AUsage = Be1Usage;

/** One scripted model reply. `usage` absent = the request reports no usage. */
export type S6AReply =
  | { kind: 'text'; text: string; usage?: S6AUsage }
  | { kind: 'calls'; calls: ReadonlyArray<{ callId: string; name: string; args: Record<string, unknown> }>; usage?: S6AUsage }
  /** The provider throws for this request (the Kernel run fails). */
  | { kind: 'fail'; message: string };

/** A usage snapshot that reports `inputTokens` as the measured model input. */
export function usageOf(inputTokens: number): S6AUsage {
  return { inputTokens, outputTokens: 0, cachedInputTokens: 0, costUsdMicros: null };
}

/** The secretary profile's and binding's window and the profile's token budget the SE2 world starts with. */
export const S6A_SECRETARY_WINDOW_TOKENS = 1_000_000;

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/** One held real step. */
export type S6AGate<T> = {
  readonly label: string;
  /** Resolves when the held step arrives, with what it holds. */
  readonly reached: Promise<T>;
  /** Lets the held step go on unchanged (before it arrives: it is not held). */
  release(): void;
};

/** What the Kernel-entry hold saw: the run's Kernel Session and its execution identity. */
export type S6AKernelEntry = { kernelSessionId: string; runId: string | null };

/** What a tool hold saw: the call the Kernel started. */
export type S6AToolCall = { callId: string; name: string; arguments: unknown };

type GateEntry = { label: string; released: boolean; release(): void; abandon(): void };

const QUERY_COMMIT = 'r5b-query-execution:';
const ROUTE_COMMIT = 'request.route:';

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function decodedRecords(commit: PreparedCommit): Record<string, unknown>[] {
  return commit.records.flatMap(record => {
    try { return [asRecord(JSON.parse(record.json) as unknown)]; } catch { return []; }
  });
}

/**
 * The commit of one Query execution step (`claimed`, `prepared` or `entering`) that writes the QueryRun of a Run
 * claimed on `session` (optionally of one round). Matches only the held commit's own identity and records.
 */
export function queryStepCommitOn(operation: 'claimed' | 'prepared' | 'entering', session: SessionRef,
  round?: QueryJobRef): CommitMatch {
  return commit => commit.identityKey.startsWith(`${QUERY_COMMIT}${operation}:`) && decodedRecords(commit).some(value => {
    const ref = asRecord(value['ref']);
    const run = asRecord(value['run']);
    const state = asRecord(run['executionState']);
    return ref['aggregateType'] === 'QueryRun' && state['phase'] === operation
      && asRecord(state['sessionRef'])['sessionId'] === session.sessionId
      && (round === undefined || asRecord(run['queryJobRef'])['queryJobId'] === round.queryJobId);
  });
}

/** A drop commit: `requests/route` writing a routing round with reason `dropped` (of one request, from one owner). */
export function dropCommitOf(input: { requestRoot?: QueryJobRef; from?: SessionRef | null } = {}): CommitMatch {
  return commit => commit.identityKey.startsWith(ROUTE_COMMIT) && decodedRecords(commit).some(value => {
    const job = asRecord(value['job']);
    const routing = asRecord(job['routing']);
    if (asRecord(value['ref'])['aggregateType'] !== 'QueryJob' || job['roundKind'] !== 'routing'
      || routing['reason'] !== 'dropped') return false;
    if (input.requestRoot !== undefined && asRecord(job['requestRoot'])['queryJobId'] !== input.requestRoot.queryJobId) {
      return false;
    }
    if (input.from === undefined) return true;
    const from = routing['from'];
    return input.from === null ? from === null : asRecord(from)['sessionId'] === input.from.sessionId;
  });
}

// ---------------------------------------------------------------------------
// The Kernel entry (one delegating spy shared by every open host world)
// ---------------------------------------------------------------------------

type RunScope = { kernelSessionId: string | undefined; served: 'session' | 'world' | null };
const runScope = new AsyncLocalStorage<RunScope>();

/** `active`: the Host the gate was set on is still the world's live Host (checked when a step arrives). */
type EntryHold = {
  owner: number; kernelSessionId: string; active: () => boolean; matched: boolean;
  reached: Deferred<S6AKernelEntry>; gate: Deferred;
};
type ToolHold = {
  owner: number; kernelSessionId: string; toolName: string; active: () => boolean; matched: boolean;
  reached: Deferred<S6AToolCall>; gate: Deferred;
};
const entryHolds: EntryHold[] = [];
const toolHolds: ToolHold[] = [];
let kernelUsers = 0;

type RunCodingAgent = typeof kernelModule.runCodingAgent;
type RunInput = Parameters<RunCodingAgent>[0];

function heldTool(tool: ToolDefinition, hold: ToolHold): ToolDefinition {
  const real = tool.handler;
  return { ...tool, handler: { ...real, execute: async (call: Readonly<ToolCall>, options) => {
    if (!hold.matched && hold.active()) {
      hold.matched = true;
      hold.reached.resolve({ callId: call.callId, name: call.name, arguments: structuredClone(call.arguments) });
      await hold.gate.promise;
    }
    return real.execute(call, options);
  } } } as ToolDefinition;
}

function installKernelEntry(): void {
  if (vi.isMockFunction(kernelModule.runCodingAgent)) return;
  const real: RunCodingAgent = kernelModule.runCodingAgent;
  vi.spyOn(kernelModule, 'runCodingAgent').mockImplementation(async (input: RunInput) => {
    const kernelSessionId = input.sessionId;
    const entry = kernelSessionId === undefined ? undefined
      : entryHolds.find(hold => !hold.matched && hold.active() && hold.kernelSessionId === kernelSessionId);
    if (entry !== undefined && kernelSessionId !== undefined) {
      entry.matched = true;
      entry.reached.resolve({ kernelSessionId, runId: input.executionIdentity?.runId ?? null });
      await entry.gate.promise;
    }
    // A tool hold armed for this Session before the run enters wraps that one real tool; nothing else changes.
    const holds = toolHolds.filter(hold => !hold.matched && hold.active() && hold.kernelSessionId === kernelSessionId);
    const additional = input.additionalTools;
    const forwarded: RunInput = holds.length === 0 || additional === undefined ? input : {
      ...input,
      additionalTools: workspace => additional(workspace).map(tool => {
        const hold = holds.find(candidate => candidate.toolName === tool.name && !candidate.matched);
        return hold === undefined ? tool : heldTool(tool, hold);
      }),
    };
    return runScope.run({ kernelSessionId, served: null }, () => real(forwarded));
  });
}

function acquireKernelEntry(): void {
  kernelUsers += 1;
  installKernelEntry();
}

function releaseKernelEntry(owner: number): void {
  for (const list of [entryHolds, toolHolds] as const) {
    for (let index = list.length - 1; index >= 0; index -= 1) if (list[index]!.owner === owner) list.splice(index, 1);
  }
  kernelUsers = Math.max(0, kernelUsers - 1);
  if (kernelUsers === 0 && vi.isMockFunction(kernelModule.runCodingAgent)) {
    vi.mocked(kernelModule.runCodingAgent).mockRestore();
  }
}

// ---------------------------------------------------------------------------
// Per-Session scripts and the model router
// ---------------------------------------------------------------------------

class SessionScript {
  readonly replies: Be1Reply[] = [];
  readonly failures = new Map<number, string>();
  readonly model: Be1ScriptedModel;

  constructor() {
    this.model = createBe1ScriptedModel(this.replies, async (_request, index) => {
      const failure = this.failures.get(index);
      if (failure !== undefined) throw new Error(failure);
    });
  }

  /** Replies not consumed yet. */
  pending(): number { return this.replies.length - this.model.calls(); }

  push(reply: S6AReply): void {
    if (reply.kind === 'fail') {
      this.failures.set(this.replies.length, reply.message);
      this.replies.push({ kind: 'text', text: 'S6A: never sent (the provider fails)' });
      return;
    }
    this.replies.push(structuredClone(reply));
  }
}

/** A model hold: the next model request of one Kernel Session (any model serving it) on the Host it was set on. */
type ModelHold = { active: () => boolean; matched: boolean; reached: Deferred<ModelRequest>; gate: Deferred };

/** Waits for a held step's release; the model call's own cancellation ends the wait. */
async function heldUntilRelease(gate: Promise<void>, signal: AbortSignal): Promise<void> {
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('S6A: the held model request was cancelled'));
    if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([gate, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** One Host start of the world. */
type HostInstance = { index: number; abandoned: boolean; crashOnClose: boolean };

export type S6AAbandonedCall = { instance: number; request: ModelRequest };

/** The scripted model of the SE2 world. */
export type S6AScriptedModel = {
  /** Appends replies to the Session's queue; the next runs on that Session consume them in order. */
  script(session: S6ASession, replies: readonly S6AReply[]): Promise<void>;
  /** Replies of the Session's queue not consumed yet. */
  pending(session: S6ASession): Promise<number>;
  /** The model requests served from the Session's queue, in order. */
  requests(session: S6ASession): Promise<ModelRequest[]>;
  /** Model calls an abandoned Host started after its crash (refused, never served). */
  abandonedCalls(): readonly S6AAbandonedCall[];
};

// ---------------------------------------------------------------------------
// Host starts (one delegating spy, installed only while a start runs)
// ---------------------------------------------------------------------------

let hostStarts: Promise<void> = Promise.resolve();

type ProviderRegistryLike = NonNullable<WorkbenchRuntimeProviderDependencies['registry']>;

export type S6ASecretaryBudget = {
  /** The secretary profile's and binding's `contextWindowTokens`; default `S6A_SECRETARY_WINDOW_TOKENS`. */
  contextWindowTokens?: number;
  /** The secretary profile's `budget.maxTokens`; default null (no cumulative cap). */
  maxTokens?: number | null;
};

export type S6AHostWorldOptions = S6AWorldOptions & {
  secretaryBudget?: S6ASecretaryBudget;
  /** The secretary binding's Host tool grant; default the base world's (`['read']`). */
  secretaryTools?: readonly string[];
  /**
   * The Host's Workflow also binds the secretary role for Work and the secretary binding's grant adds
   * `send_session_message` (Host inputs), so `makeWorkWaitingSecretary` can run Work on a secretary line.
   */
  secretaryWork?: boolean;
};

export type S6ASubmitInput = {
  commandId: string; goalId: string | null; text: string;
  continues?: QueryJobRef | null; recipient?: S6ASession | SessionRef | null;
};

export type S6AHostWorld = S6ARequestWorld & {
  readonly scripted: S6AScriptedModel;
  readonly gates: {
    /** (a) The next claim commit of a Query on the Session (after an `assigned` commit: not yet claimed). */
    beforeClaim(session: S6ASession, round?: QueryJobRef): S6AGate<PreparedCommit>;
    /** (b) The next bind-prepared commit on the Session (claimed, not yet prepared). */
    beforePrepared(session: S6ASession, round?: QueryJobRef): S6AGate<PreparedCommit>;
    /** (c) The next start commit on the Session (prepared, not yet started). */
    beforeStart(session: S6ASession, round?: QueryJobRef): S6AGate<PreparedCommit>;
    /** (d) The next Kernel entry on the Session (the start commit landed, the Kernel not entered). */
    beforeKernel(session: S6ASession): Promise<S6AGate<S6AKernelEntry>>;
    /** (e) The next drop commit (of one request, from one owner). */
    beforeDrop(input?: { requestRoot?: QueryJobRef; from?: S6ASession | null }): S6AGate<PreparedCommit>;
    /** The Session's next model request (its queue's or the world model's), held before its reply. */
    modelRequest(session: S6ASession): Promise<S6AGate<ModelRequest>>;
    /** The first call of the named extension tool in the Session's next Kernel run: started, no result yet. */
    toolCall(session: S6ASession, toolName: string): Promise<S6AGate<S6AToolCall>>;
    /** Labels of the gates not released yet. */
    unreleased(): string[];
  };
  /** SQLite: abandon the running Host (stale lock) and start a new one on the same directory. */
  crash(options?: S6AReopenOptions): Promise<void>;
  /** The Host's `automation.resumeOnStartup` through `automation/save` (used by the next start). */
  setResumeOnStartup(on: boolean): Promise<HostSettingsSnapshot>;
  /** Any Host settings route (`/api/real/settings/<route>`) as the Host's page; answers the route's result. */
  settings<K extends keyof SettingsRoutes>(route: K, input: SettingsRoutes[K]['input']):
    Promise<SettingsResponse<SettingsRoutes[K]['value']>>;
  readonly packs: {
    create(packId: string): Promise<SettingsResponse<SettingsRoutes['prompts/packs/create']['value']>>;
    readTemplate(packId: string, templateId: string): Promise<SettingsResponse<SettingsRoutes['prompts/templates/read']['value']>>;
    /** Saves the template's text at the version the read answered (a new version on every save). */
    saveTemplate(packId: string, templateId: string, text: string, mentionsTools?: readonly string[]):
      Promise<SettingsResponse<SettingsRoutes['prompts/templates/save']['value']>>;
    /** `models/save` of the Host catalog's model with `promptPack`, then `models/select` of it for the workspace. */
    select(packId: string): Promise<HostSettingsSnapshot>;
  };
  submit(input: S6ASubmitInput): Promise<RequestSubmitResultV1>;
  route(input: { commandId: string; round: QueryJobRef; to: S6ASession | SessionRef }): Promise<RequestRouteResultV1>;
  drop(input: { commandId: string; round: QueryJobRef }): Promise<RequestRouteResultV1>;
  selectIdea(input: { commandId: string; round: QueryJobRef; index: number }): Promise<RequestSelectIdeaResultV1>;
  readRequest(requestRoot: QueryJobRef): Promise<RequestCoreViewV1>;
  /** Polls `readRequest` (bounded, about 15 s) until `done` holds; fails naming `what`. */
  waitForRequest(requestRoot: QueryJobRef, done: (view: RequestCoreViewV1) => boolean, what: string):
    Promise<RequestCoreViewV1>;
  /**
   * A secretary line waiting on Work (needs `secretaryWork`; once per world): the project's pointers where missing
   * (`ensureProjectPointers`, with the test's own governance when it seeded one), the AG2b Plan on goal 1 with its
   * work Task assigned to the secretary role (`plans/propose` + `plans/apply`), then `workflow/advance` of that Task
   * on the new secretary, whose scripted model sends an inquiry to a Work line with `waitAfterSend: true`, so the
   * Run yields waiting for the reply.
   */
  makeWorkWaitingSecretary(label: string, governance?: S6AGovernance):
    Promise<{ session: S6ASession; recipient: S6ASession }>;
};

/**
 * The project gets both pointers: the governance's public reads first, then the policy installed and activated and
 * the architecture adopted (its detached capture settled) where missing. Without `governance` it seeds a governance
 * with no writes of its own (`seedS6AMemory` with no architecture, policy or notes); a test that seeds the memory
 * fixture itself passes that one, so the two never replay each other's request ids.
 */
export async function ensureProjectPointers(world: S6AMemoryWorld, governance?: S6AGovernance): Promise<S6AGovernance> {
  const owner = governance ?? (await seedS6AMemory(world, { architecture: false, policy: false, notes: false })).governance;
  const current = await owner.read();
  if (current.policy === null) await owner.activatePolicy();
  if (current.architecture === null) await owner.adoptArchitecture({ settle: true });
  return owner;
}

const refOf = (session: S6ASession | SessionRef): SessionRef =>
  'aggregateRef' in session ? { projectId: session.ref.projectId, sessionId: session.ref.sessionId }
    : { projectId: session.projectId, sessionId: session.sessionId };

let worldSeq = 0;

/** Open the SE2 world (see the header). */
export async function openS6AHostWorld(options: S6AHostWorldOptions): Promise<S6AHostWorld> {
  const owner = ++worldSeq;
  const instances: HostInstance[] = [];
  const abandoned: LocalWorkbenchHost[] = [];
  const abandonedCalls: S6AAbandonedCall[] = [];
  const scripts = new Map<string, SessionScript>();
  const modelHolds = new Map<string, ModelHold[]>();
  const gates: GateEntry[] = [];
  const window = options.secretaryBudget?.contextWindowTokens ?? S6A_SECRETARY_WINDOW_TOKENS;
  const maxTokens = options.secretaryBudget?.maxTokens === undefined ? null : options.secretaryBudget.maxTokens;
  const secretaryWork = options.secretaryWork === true;
  const secretaryTools = options.secretaryTools === undefined && !secretaryWork ? undefined
    : [...new Set([...(options.secretaryTools ?? ['read']), ...(secretaryWork ? ['send_session_message'] : [])])];

  const routed = (instance: HostInstance, fallback: ModelClientPort): ModelClientPort => ({
    async *stream(request, streamOptions) {
      if (instance.abandoned) {
        abandonedCalls.push({ instance: instance.index, request: structuredClone(request) });
        throw new Error(`S6A: the abandoned Host ${instance.index} started a model call after its crash`);
      }
      const scope = runScope.getStore();
      const hold = scope?.kernelSessionId === undefined ? undefined
        : modelHolds.get(scope.kernelSessionId)?.find(candidate => !candidate.matched && candidate.active());
      if (hold !== undefined) {
        hold.matched = true;
        hold.reached.resolve(structuredClone(request) as ModelRequest);
        await heldUntilRelease(hold.gate.promise, streamOptions.signal);
      }
      const script = scope?.kernelSessionId === undefined ? undefined : scripts.get(scope.kernelSessionId);
      if (scope !== undefined && scope.served === null) {
        scope.served = script !== undefined && script.pending() > 0 ? 'session' : 'world';
      }
      if (scope?.served === 'session' && script !== undefined) {
        yield* script.model.client.stream(request, streamOptions);
        return;
      }
      yield* fallback.stream(request, streamOptions);
    },
  });

  const patchRuntime = (configuration: WorkbenchRuntimeConfiguration): WorkbenchRuntimeConfiguration => {
    const next = structuredClone(configuration);
    const profile = next.queryProfiles.find(entry => entry.id === S6A_SECRETARY_PROFILE_ID);
    if (profile === undefined) return next;
    profile.runtimeBudget = { ...profile.runtimeBudget, contextWindowTokens: window, timeoutMs: null };
    profile.budget = { maxTokens, deadline: null };
    const binding = next.bindings.find(entry => entry.id === profile.runtimeBindingId);
    if (binding !== undefined) {
      binding.grant = { ...binding.grant, budget: { ...binding.grant.budget, contextWindowTokens: window, timeoutMs: null },
        ...(secretaryTools === undefined ? {} : { tools: [...secretaryTools] }) };
    }
    return next;
  };

  const patchOptions = (hostOptions: LocalWorkbenchHostOptions, instance: HostInstance): LocalWorkbenchHostOptions => {
    const provider = hostOptions.runtimeProvider;
    const registry = provider?.registry;
    if (provider === undefined || registry === undefined) throw new Error('S6A: the world configures no model provider');
    const router: ProviderRegistryLike = {
      get: id => registry.get(id),
      create: (id, clientOptions) => routed(instance, registry.create(id, clientOptions)),
    };
    const kernelPath = hostOptions.kernelStores?.entries[0]?.databasePath;
    const settings = hostOptions.storage.kind === 'memory' && hostOptions.settings === undefined && kernelPath !== undefined
      ? { settingsDirectory: join(dirname(kernelPath), 'host-settings') } : hostOptions.settings;
    const workflow = !secretaryWork || hostOptions.workflow === undefined ? hostOptions.workflow : {
      ...hostOptions.workflow,
      bindings: [...hostOptions.workflow.bindings, { workspace: { ...S6A_SCOPE }, sessionRole: structuredClone(S6A_SECRETARY_ROLE),
        roleBinding: structuredClone(S6A_SECRETARY_ROLE_BINDING), budget: { tokenBudget: 1_000_000, deadline: null } }],
    };
    return {
      ...hostOptions,
      runtimeProvider: { ...provider, registry: router },
      ...(hostOptions.runtimeConfiguration === undefined ? {} : { runtimeConfiguration: patchRuntime(hostOptions.runtimeConfiguration) }),
      ...(settings === undefined ? {} : { settings }),
      ...(workflow === undefined ? {} : { workflow }),
    };
  };

  const crashable = (real: LocalWorkbenchHost, instance: HostInstance, database: string | null): LocalWorkbenchHost => ({
    listen: port => real.listen(port),
    async close() {
      if (!instance.crashOnClose) { await real.close(); return; }
      if (database === null) throw new Error('S6A: a crash needs the SQLite directory');
      instance.abandoned = true;
      abandoned.push(real);
      await writeStaleLock(database);
    },
    get reconcile() { return real.reconcile; },
  });

  /** Runs `start` with the Host factory spy installed; host-world starts are serialized. */
  async function hostStart<T>(start: () => Promise<T>): Promise<T> {
    const previous = hostStarts;
    let done!: () => void;
    hostStarts = new Promise<void>(resolve => { done = resolve; });
    await previous;
    const real = hostModule.createLocalWorkbenchHost;
    const spy = vi.spyOn(hostModule, 'createLocalWorkbenchHost').mockImplementation(async hostOptions => {
      const instance: HostInstance = { index: instances.length + 1, abandoned: false, crashOnClose: false };
      instances.push(instance);
      const database = hostOptions.storage.kind === 'sqlite' ? hostOptions.storage.directory : null;
      return crashable(await real(patchOptions(hostOptions, instance)), instance, database);
    });
    try {
      return await start();
    } finally {
      spy.mockRestore();
      done();
    }
  }

  acquireKernelEntry();
  let base: S6ARequestWorld;
  try {
    base = await hostStart(() => openS6ARequestWorld(options));
  } catch (error) {
    releaseKernelEntry(owner);
    throw error;
  }

  async function kernelSessionOf(session: S6ASession): Promise<string> {
    return (await base.readSession(session)).record.kernel.kernelSessionId;
  }
  async function scriptOf(session: S6ASession): Promise<SessionScript> {
    const key = await kernelSessionOf(session);
    let script = scripts.get(key);
    if (script === undefined) { script = new SessionScript(); scripts.set(key, script); }
    return script;
  }

  const register = <T>(label: string, reached: Promise<T>, release: () => void, abandon: () => void): S6AGate<T> => {
    const entry: GateEntry = { label, released: false, release, abandon };
    gates.push(entry);
    return { label, reached, release: () => { entry.released = true; release(); } };
  };
  let gateSeq = 0;
  /** The live Host when a gate is set; the gate matches only while that Host is still live and not abandoned. */
  const gateScope = (): (() => boolean) => {
    const instance = instances.at(-1);
    if (instance === undefined) throw new Error('S6A: the world has no Host');
    return () => instances.at(-1) === instance && !instance.abandoned;
  };
  const commitGate = (match: CommitMatch, label: string): S6AGate<PreparedCommit> => {
    const active = gateScope();
    const hold = commitBarrier.hold(commit => active() && match(commit), label);
    return register(label, hold.reached, () => hold.release(), () => hold.release());
  };

  async function settingsCall<K extends keyof SettingsRoutes>(route: K, input: SettingsRoutes[K]['input']):
  Promise<SettingsResponse<SettingsRoutes[K]['value']>> {
    const response = await fetch(new URL(`${SETTINGS_API_PREFIX}${route}`, world.base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: world.token },
      body: JSON.stringify(input),
    });
    return await response.json() as SettingsResponse<SettingsRoutes[K]['value']>;
  }
  const settingsValue = async <K extends keyof SettingsRoutes>(route: K, input: SettingsRoutes[K]['input']):
  Promise<SettingsRoutes[K]['value']> => {
    const answer = await settingsCall(route, input);
    if (answer.status !== 'ready') throw new Error(`S6A: settings ${route} was not ready: ${JSON.stringify(answer)}`);
    return answer.value;
  };

  const routeBody = (input: unknown) => ({ scope: S6A_SCOPE, input });
  const routeAnswer = async (suffix: string, input: unknown): Promise<unknown> => (await world.post(suffix, routeBody(input))).body;
  const committed = async (suffix: string, body: unknown, what: string): Promise<Record<string, unknown>> => {
    const answer = asRecord((await world.post(suffix, body)).body);
    if (answer['status'] !== 'committed') throw new Error(`S6A: ${what} did not commit: ${JSON.stringify(answer)}`);
    return asRecord(answer['value']);
  };
  let workPlanAdopted = false;
  let closed = false;

  const world = Object.create(base) as S6AHostWorld;
  const extra: Omit<S6AHostWorld, keyof S6ARequestWorld> & Pick<S6ARequestWorld, 'reopen' | 'makeUnavailableSecretary' | 'close'> = {
    scripted: {
      async script(session, replies) {
        const script = await scriptOf(session);
        for (const reply of replies) script.push(reply);
      },
      async pending(session) { return (await scriptOf(session)).pending(); },
      async requests(session) { return structuredClone((await scriptOf(session)).model.requests); },
      abandonedCalls: () => [...abandonedCalls],
    },

    gates: {
      beforeClaim: (session, round) => commitGate(queryStepCommitOn('claimed', session.ref, round),
        `before the claim on ${session.label} #${++gateSeq}`),
      beforePrepared: (session, round) => commitGate(queryStepCommitOn('prepared', session.ref, round),
        `before the prepared commit on ${session.label} #${++gateSeq}`),
      beforeStart: (session, round) => commitGate(queryStepCommitOn('entering', session.ref, round),
        `before the start commit on ${session.label} #${++gateSeq}`),
      async beforeKernel(session) {
        const active = gateScope();
        const hold: EntryHold = { owner, kernelSessionId: await kernelSessionOf(session), active, matched: false,
          reached: deferred<S6AKernelEntry>(), gate: deferred() };
        entryHolds.push(hold);
        return register(`before the Kernel entry on ${session.label} #${++gateSeq}`, hold.reached.promise,
          () => hold.gate.resolve(), () => hold.gate.reject(new Error('S6A: the world is closed')));
      },
      beforeDrop: (input = {}) => commitGate(dropCommitOf({
        ...(input.requestRoot === undefined ? {} : { requestRoot: input.requestRoot }),
        ...(input.from === undefined ? {} : { from: input.from === null ? null : input.from.ref }),
      }), `before a drop commit #${++gateSeq}`),
      async modelRequest(session) {
        const active = gateScope();
        const key = await kernelSessionOf(session);
        const hold: ModelHold = { active, matched: false, reached: deferred<ModelRequest>(), gate: deferred() };
        const list = modelHolds.get(key) ?? [];
        list.push(hold);
        modelHolds.set(key, list);
        return register(`model request on ${session.label} #${++gateSeq}`, hold.reached.promise,
          () => hold.gate.resolve(), () => hold.gate.reject(new Error('S6A: the world is closed')));
      },
      async toolCall(session, toolName) {
        const active = gateScope();
        const hold: ToolHold = { owner, kernelSessionId: await kernelSessionOf(session), toolName, active, matched: false,
          reached: deferred<S6AToolCall>(), gate: deferred() };
        toolHolds.push(hold);
        return register(`tool ${toolName} on ${session.label} #${++gateSeq}`, hold.reached.promise,
          () => hold.gate.resolve(), () => hold.gate.reject(new Error('S6A: the world is closed')));
      },
      unreleased: () => gates.filter(entry => !entry.released).map(entry => entry.label),
    },

    async crash(reopenOptions = {}) {
      if (world.backend !== 'sqlite') throw new Error('S6A: a crash restarts the Host on the same directory (SQLite only)');
      const live = instances.at(-1);
      if (live === undefined) throw new Error('S6A: the world has no Host');
      live.crashOnClose = true;
      await hostStart(() => base.reopen(reopenOptions));
    },
    reopen: reopenOptions => hostStart(() => base.reopen(reopenOptions)),
    makeUnavailableSecretary: (label, unavailableOptions) =>
      hostStart(() => base.makeUnavailableSecretary(label, unavailableOptions)),

    async setResumeOnStartup(on) {
      const snapshot = await settingsValue('snapshot', {});
      return await settingsValue('automation/save', { autoReworkLimit: snapshot.automation.autoReworkLimit, resumeOnStartup: on });
    },
    settings: settingsCall,
    packs: {
      create: packId => settingsCall('prompts/packs/create', { packId }),
      readTemplate: (packId, templateId) => settingsCall('prompts/templates/read', { packId, templateId }),
      async saveTemplate(packId, templateId, text, mentionsTools = []) {
        const read = await settingsCall('prompts/templates/read', { packId, templateId });
        if (read.status !== 'ready') return read;
        return await settingsCall('prompts/templates/save', {
          packId, templateId, expectedVersion: read.value.version, text, mentionsTools: [...mentionsTools],
        });
      },
      async select(packId) {
        const snapshot = await settingsValue('snapshot', {});
        const model = snapshot.models[0];
        if (model === undefined) throw new Error('S6A: the Host catalog has no model to carry the pack');
        await settingsValue('models/save', {
          id: model.id, label: model.label, provider: model.provider, model: model.model, promptPack: packId,
          ...(model.thinking === undefined ? {} : { thinking: model.thinking }),
          ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
          ...(model.reasoningReplay === undefined ? {} : { reasoningReplay: model.reasoningReplay }),
        });
        return await settingsValue('models/select', { scope: { ...S6A_SCOPE }, modelId: model.id });
      },
    },

    async submit(input) {
      return await routeAnswer('requests/submit', {
        commandId: input.commandId, goalId: input.goalId, text: input.text, continues: input.continues ?? null,
        recipient: input.recipient === undefined || input.recipient === null ? null : refOf(input.recipient),
      }) as RequestSubmitResultV1;
    },
    async route(input) {
      return await routeAnswer('requests/route', { commandId: input.commandId, round: input.round, to: refOf(input.to),
        reason: 'manual' }) as RequestRouteResultV1;
    },
    async drop(input) {
      return await routeAnswer('requests/route', { commandId: input.commandId, round: input.round, to: null,
        reason: 'dropped' }) as RequestRouteResultV1;
    },
    async selectIdea(input) {
      return await routeAnswer('requests/select-idea', { commandId: input.commandId, round: input.round,
        index: input.index }) as RequestSelectIdeaResultV1;
    },
    async readRequest(requestRoot) {
      const read = await world.platform.requestFacts.readRequest(world.humanContext(), { requestRoot });
      if (read.status !== 'ready') throw new Error(`S6A: the request read is not ready: ${JSON.stringify(read)}`);
      return read.value;
    },
    waitForRequest: (requestRoot, done, what) => waitFor(() => world.readRequest(requestRoot), done, what),

    async makeWorkWaitingSecretary(label, governance) {
      if (!secretaryWork) throw new Error('S6A: open the world with secretaryWork to run Work on a secretary line');
      if (workPlanAdopted) throw new Error('S6A: the world has one Work Task; a second waiting secretary needs a new world');
      await ensureProjectPointers(world, governance);
      // The AG2b Plan (one work Task plus the Goal gate), its work assigned to the secretary role.
      const draft = ag2bPlanDraft();
      const assigned = { ...draft, assignments: (draft.assignments ?? []).map(assignment =>
        ({ ...assignment, role: S6A_SECRETARY_ROLE.templateId })) } as typeof draft;
      const proposed = await committed('plans/propose', graphWrite(S6A_SCOPE, {
        goalRef: S6A_GOAL_1, basedOn: null, draft: assigned, reason: { text: 'S6A secretary Work', sources: [] },
      }, 's6a-work-plan-propose', []), 'the Plan proposal');
      await committed('plans/apply', graphWrite(S6A_SCOPE, {
        proposalRef: proposed['ref'], expectedProposalRevision: proposed['revision'], decisionRefs: [],
      }, 's6a-work-plan-apply', []), 'the Plan adoption');
      workPlanAdopted = true;
      await world.settleDetached();
      const recipient = await world.createWorkSession(`${label}-recipient`);
      const session = await world.createSecretary(label);
      await world.scripted.script(session, [{ kind: 'calls', calls: [{ callId: `s6a-wait-${label}`, name: 'send_session_message',
        args: { recipient: recipient.ref, text: `S6A Work question from ${label}`, intent: 'inquiry', needsReply: true,
          waitAfterSend: true } }] }]);
      const steps = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: S6A_GOAL_1, flowId: `s6a-wait-${label}`,
        sessionHint: session.ref, kind: 'select_work', taskId: AG2B_WORK_TASK_ID });
      if (steps.at(-1)?.state !== 'waiting') {
        throw new Error(`S6A: the secretary Work did not wait: ${JSON.stringify(steps.at(-1))}`);
      }
      return { session, recipient };
    },

    async close() {
      if (closed) return;
      closed = true;
      // Every gate first (a held step of an abandoned Host never resolves otherwise), then the abandoned Hosts,
      // then the base world (its live Host, its own abandoned Hosts and the directories).
      for (const entry of gates) { entry.released = true; entry.abandon(); }
      const stopped = await Promise.allSettled(abandoned.splice(0).map(host => host.close()));
      releaseKernelEntry(owner);
      const failures = stopped.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason as unknown);
      try { await base.close(); } catch (error) { failures.push(error); }
      if (failures.length > 0) throw new AggregateError(failures, 'S6A host world cleanup failed');
    },
  };
  Object.assign(world, extra);
  return world;
}
