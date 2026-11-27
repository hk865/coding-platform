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
 *   `scripted.boundary` lists every request a Session's runs made at this boundary (held or cancelled ones too) with
 *   the call's own `signal`, so a row reads a cancellation there (the DEXC rows); nothing is changed.
 * - The Session a Kernel run belongs to: a delegating spy on the Kernel's `runCodingAgent` (the Runtime's Kernel
 *   entry, `src/core/agent-runtime/observed-model-run.ts`), installed while a host world is open. It forwards the
 *   real call unchanged inside an async context naming the run's Kernel Session, which the router reads; it is
 *   also where gate (d) and the tool holds sit, and it injects the Runner's no-op retry wait (`retryDelay`) so a
 *   real-Host row with retryable failures does not sit out the production 2/4/8/16 s. It also registers each run
 *   (its Host and run id) until the run returns, for the crash check below (FLK rework ruling 6).
 * - Gates (rule sheet A3: each holds one real step and then lets it go on unchanged), independent per Session:
 *   (a) the claim commit of a Query on a Session (`r5b-query-execution:claimed:`), so after an `assigned` commit
 *   the round is not yet claimed; (b) the bind-prepared commit (`…:prepared:`), so the round is claimed and not yet
 *   prepared; (c) the start commit (`…:entering:`), so it is prepared and not yet started; (e) a drop commit
 *   (`request.route:` writing a routing round with reason `dropped`). (a)–(c) and (e) hold the prepared commit
 *   before `records.commit` through the commit barrier's pre-commit `hold` (tests/helpers/S6A-commit-barrier.ts,
 *   which wraps the real backend's `records.commit` and `records.readMany`; these gates use neither its `holdAfter`
 *   nor its store faults), so THE TEST FILE MUST INSTALL THE BARRIER'S TWO `vi.mock`s (see that file); matching
 *   reads only the held commit's own records.
 *   (d) holds `runCodingAgent` for a Session: the start commit has landed, the Kernel has not been
 *   entered. A model hold holds a Session's next model request before its reply, whether the Session's queue or
 *   the world's model would serve it (holds of one Session in the order they were set); a tool hold holds the real
 *   handler of a named Kernel extension tool (`list_files`, `look_graph`, …) once the Kernel has started the call,
 *   so the call has no result (R-09). Plain Queries make the claim, prepared and start commits today.
 *   A gate belongs to the Host running when it is set: every kind checks, when a step arrives, that this Host is
 *   still the world's live one, so after a crash or a reopen a gate not reached yet never catches a step of the new
 *   Host (or of the abandoned one). A step that already arrived stays held until its gate is released.
 * - Crash and restart (SQLite; rule sheet A2 v3, the `restart({ crash: true })` shape of tests/scenarios/harness.ts):
 *   `crash()` stops the running Host's writes, abandons it (no `close`; it keeps whatever it holds), rewrites the lock
 *   to an exited process (`writeStaleLock`) and starts a new Host on the same directory through the base world's
 *   `reopen`. A crashed process writes nothing more: every record store the Host built at its start fails each commit that
 *   arrives after the crash with an I/O error (`stopsAtCrash`; one already under way goes on), so the old Host's
 *   timers, drivers and late steps stop at their next write, a request still open on it ends with that failure as
 *   a dead process's would, and the new Host alone moves the records the row reads. Its artifact body store (the
 *   bodies the ledger points into, `src/composition/create-platform.ts:1289`) fails each put after the crash the same
 *   way (`bodiesStopAtCrash`). A step held at a gate stays held (its commit arrived before the crash); a commit held at
 *   a `before` hold of the commit barrier is looked at once more when the row lets it go and is refused then too
 *   (FLK rework ruling 5), while a `holdAfter` commit has already landed and keeps its result. A row that races the
 *   old Host's held commit against the new Host's write on purpose says so with `crash({ heldCommitsRace: true })`:
 *   the commits the old Host had held before the crash then reach the store on release and production's
 *   compare-and-swap decides between the two writers (the S7B2-R two-version race). A write stop cannot stop a Kernel
 *   run the old Host had entered and not held, so the row crashes only once that run has ended or while a gate of
 *   the row holds it (the rule of tests/scenarios/harness.ts:32): `crash()` first looks at the Kernel runs the
 *   Kernel entry registered, and if one of this Host's is still going and no gate holds it (the Kernel entry,
 *   model and tool gates, or a commit-barrier hold or K3 tool seam its own step waits at), it throws naming the
 *   cell, the Host and the run, and crashes nothing (FLK rework ruling 6).
 *   A peer start (`crash({ keepLease: true })`) is no crash of the old Host: it keeps running as the lease holder (its
 *   live lock still names this process), its writes are not stopped, and the new Host starts `held_by_other` (HL-02,
 *   a second workbench on one data directory). The abandoned Host is closed only by `close()`, after every gate of
 *   the world is released.
 * - The Host setting `automation.resumeOnStartup` through its route `automation/save` (takes effect at the next
 *   start). A person's prompt pack through PC-2's routes: `prompts/packs/create`, `prompts/templates/read|save`,
 *   and the selection `models/save` with `promptPack` + `models/select` on a model of the Host's own catalog
 *   (the startup bindings' model, so its secret stays the configured one).
 * - The request commands through their HTTP routes (`requests/submit`, `requests/route` manual or `dropped`,
 *   `requests/select-idea`) as the Host's human actor, the owner read `requestFacts.readRequest`, and bounded
 *   polling of that read (`waitFor` of tests/scenarios/harness.ts) for states the Host reaches on its own.
 * - The project's three opening lines (`openingLinesOf`, O1b L26): the seed's first workspace registration births
 *   `start_lines` and the Host opens them in the background; the helper waits through `role-lines/operations`
 *   (`startLinesEnded`, the one wait) and names each line from its step's child create (`sessions/operation`).
 * - The project's two pointers (`ensureProjectPointers`) through the governance of the memory fixture
 *   (tests/helpers/S6A-memory-fixture.ts, `seedS6AMemory(...).governance`): it reads both pointers and every guard
 *   revision through public reads, then installs and activates the policy and adopts the architecture where missing.
 *
 * Host starts of host worlds are serialized; do not open another S6A world while one starts. No record, event or
 * Session field is written by hand and nothing is asserted by reading the store.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { expect, vi } from 'vitest';
import * as kernelModule from '../../vendor/coding-agent/dist/public-api.js';
import type {
  ModelClientPort, ModelRequest, ToolCall, ToolDefinition,
} from '../../vendor/coding-agent/dist/public-api.js';
import * as hostModule from '../../src/app/host.js';
import * as sqliteStoreModule from '../../src/core/record-store/sqlite-record-store.js';
import * as sqliteBodyModule from '../../src/core/record-store/sqlite-body-store.js';
import type { CloseableRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import type { LocalWorkbenchHost, LocalWorkbenchHostOptions } from '../../src/app/host.js';
import { PLATFORM_TOKEN_HEADER } from '../../src/app/core-http-types.js';
import { createHostCoreCallContext } from '../../src/app/core-call-context.js';
import {
  SETTINGS_API_PREFIX, type HostSettingsSnapshot, type SettingsResponse, type SettingsRoutes,
} from '../../src/app/host-settings-types.js';
import type { WorkbenchRuntimeConfiguration, WorkbenchRuntimeProviderDependencies } from '../../src/app/runtime-configuration.js';
import type {
  RequestRouteResultV1, RequestSelectIdeaResultV1, RequestSubmitResultV1,
} from '../../src/business/workflow/request-intake.js';
import type { SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { PreparedCommit, StoreCommitReceipt } from '../../src/core/record-store/ports.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import type { SessionCard, SessionCreateOperationRecord } from '../../src/core/work-graph/model/session-contracts.js';
import { ROLE_LINE_STEP_KEYS } from '../../src/core/work-graph/state/role-line-action.js';
import { waitFor } from '../scenarios/harness.js';
import { deferred, driveWorkflow, writeStaleLock, type Deferred } from './A2-restart-fixture.js';
import {
  AG2B_WORK_TASK_ID, ag2bPlanDraft, createAG2bSession, graphWrite, plain, startLinesEnded,
} from './AG2b-collaboration-fixture.js';
import { onToolSeamHeld } from './K3-tool-seams.js';
import { commitBarrier, releasedCommitCheck, type CommitMatch } from './S6A-commit-barrier.js';
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

/**
 * One Kernel run the Kernel entry let in, registered there from its entry until it returns (FLK rework ruling 6):
 * its execution identity (null when the platform gives the Kernel none, as a summary run), its Kernel Session and
 * store, its Host and the named gates that stopped it. The spy is shared by every Host, so the Host is the one whose
 * model client the run calls: each Host's Runtime builds one client per binding through the provider registry this
 * fixture patches per Host (`patchOptions`; `src/app/runtime-configuration.ts:478`), and the Kernel reaches that
 * client only through the run's own registry (`src/core/agent-runtime/observed-model-run.ts:372`), so `routed`
 * names the Host at the run's first model call, refused or not. `holds`: one probe per gate that held the run, true
 * until that gate is released.
 */
type KernelRun = {
  runId: string | null; kernelSessionId: string | undefined; kernelStore: string;
  host: HostInstance | null; holds: (() => boolean)[];
};
const kernelRuns = new Set<KernelRun>();

type RunScope = { kernelSessionId: string | undefined; served: 'session' | 'world' | null; run: KernelRun };
const runScope = new AsyncLocalStorage<RunScope>();

/** `active`: the Host the gate was set on is still the world's live Host (checked when a step arrives). */
type EntryHold = {
  owner: number; kernelSessionId: string; active: () => boolean; matched: boolean; released: boolean;
  reached: Deferred<S6AKernelEntry>; gate: Deferred;
};
type ToolHold = {
  owner: number; kernelSessionId: string; toolName: string; active: () => boolean; matched: boolean; released: boolean;
  reached: Deferred<S6AToolCall>; gate: Deferred;
};
const entryHolds: EntryHold[] = [];
const toolHolds: ToolHold[] = [];
let kernelUsers = 0;
/** Remove the listeners that mark a run whose own step waits at a commit-barrier hold or a K3 tool seam. */
let unwatchHolds: (() => void)[] | null = null;

type RunCodingAgent = typeof kernelModule.runCodingAgent;
type RunInput = Parameters<RunCodingAgent>[0];

function heldTool(tool: ToolDefinition, hold: ToolHold): ToolDefinition {
  const real = tool.handler;
  return { ...tool, handler: { ...real, execute: async (call: Readonly<ToolCall>, options) => {
    if (!hold.matched && hold.active()) {
      hold.matched = true;
      runScope.getStore()?.run.holds.push(() => !hold.released);
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
    const run: KernelRun = { runId: input.executionIdentity?.runId ?? null, kernelSessionId,
      kernelStore: input.config.storage.databasePath, host: null, holds: [] };
    kernelRuns.add(run);
    try {
      const entry = kernelSessionId === undefined ? undefined
        : entryHolds.find(hold => !hold.matched && hold.active() && hold.kernelSessionId === kernelSessionId);
      if (entry !== undefined && kernelSessionId !== undefined) {
        entry.matched = true;
        run.holds.push(() => !entry.released);
        entry.reached.resolve({ kernelSessionId, runId: run.runId });
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
      return await runScope.run({ kernelSessionId, served: null, run },
        () => real({ ...forwarded, retryDelay: async () => {} }));
    } finally {
      kernelRuns.delete(run);
    }
  });
}

function acquireKernelEntry(): void {
  kernelUsers += 1;
  installKernelEntry();
  // A step of a run (a commit its tools or input supply make, a tool call) waiting at a commit-barrier hold or at a
  // K3 tool seam the row armed (tests/helpers/K3-tool-seams.ts) holds that run.
  const held = (holding: () => boolean): void => { runScope.getStore()?.run.holds.push(holding); };
  unwatchHolds ??= [commitBarrier.onHeld(held), onToolSeamHeld(held)];
}

function releaseKernelEntry(owner: number): void {
  for (const list of [entryHolds, toolHolds] as const) {
    for (let index = list.length - 1; index >= 0; index -= 1) if (list[index]!.owner === owner) list.splice(index, 1);
  }
  kernelUsers = Math.max(0, kernelUsers - 1);
  if (kernelUsers === 0 && vi.isMockFunction(kernelModule.runCodingAgent)) {
    vi.mocked(kernelModule.runCodingAgent).mockRestore();
  }
  if (kernelUsers === 0) {
    for (const unwatch of unwatchHolds ?? []) unwatch();
    unwatchHolds = null;
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
type ModelHold = {
  active: () => boolean; matched: boolean; released: boolean; reached: Deferred<ModelRequest>; gate: Deferred;
};

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

/**
 * One Host start of the world. `crashed`: `crash()` stopped its writes (a peer start does not). `heldCommitsRace`:
 * the crash let the commits it had held at a `before` hold reach the store on release. `kernelStores`: the Kernel
 * store paths the Host was given, canonical as the Runtime passes them to the Kernel (`canonicalKernelStore`).
 */
type HostInstance = {
  index: number; abandoned: boolean; crashed: boolean; crashOnClose: boolean; keepsLease?: true; heldCommitsRace?: true;
  kernelStores: ReadonlySet<string>;
};

/** A Kernel store path as the Kernel store locator hands it on (`src/core/agent-runtime/kernel-store-locator.ts:42`). */
const canonicalKernelStore = (path: string): string => join(realpathSync(dirname(path)), basename(path));

/**
 * A record store the Host built, which fails every commit that arrives after the Host's crash with an I/O error:
 * the crashed Host writes nothing more. A commit that arrived before the crash and waits at a `before` hold of the
 * commit barrier is checked again when the hold lets it go (`releasedCommitCheck`, FLK rework ruling 5), unless the
 * row races it on purpose. The store builds `records` from closures without `this` (as the commit barrier relies on),
 * so the spread keeps every other method.
 */
function stopsAtCrash<B extends { records: { commit(input: PreparedCommit): Promise<StoreCommitReceipt> } }>(
  backend: B, instance: HostInstance): B {
  const real = backend.records;
  const crashedCommit = () => new Error(`S6A: Host ${instance.index} has crashed; its store takes no more commits`);
  const released = (): void => {
    if (instance.crashed && instance.heldCommitsRace !== true) throw crashedCommit();
  };
  return { ...backend, records: { ...real, commit: async (input: PreparedCommit) => {
    if (instance.crashed) throw crashedCommit();
    return releasedCommitCheck.run(released, () => real.commit(input));
  } } };
}

/**
 * The artifact body store the Host built (`src/composition/create-platform.ts:1289`), which fails every put after the
 * Host's crash with an I/O error, as `stopsAtCrash` fails a commit (FLK rework ruling 5). Its methods are closures
 * without `this`, so the spread keeps `read` and `close`.
 */
function bodiesStopAtCrash(store: CloseableRawArtifactStore, instance: HostInstance): CloseableRawArtifactStore {
  return { ...store, put: async input => {
    if (instance.crashed) throw new Error(`S6A: Host ${instance.index} has crashed; its body store takes no more puts`);
    return store.put(input);
  } };
}

export type S6AAbandonedCall = { instance: number; request: ModelRequest };

/** The scripted model of the SE2 world. */
export type S6AScriptedModel = {
  /** Appends replies to the Session's queue; the next runs on that Session consume them in order. `scope`: the
   * Session's own workspace when it is not the main one (XWR R3's second-workspace line). */
  script(session: S6ASession, replies: readonly S6AReply[], scope?: WorkspaceScope): Promise<void>;
  /** Replies of the Session's queue not consumed yet. */
  pending(session: S6ASession): Promise<number>;
  /** The model requests served from the Session's queue, in order. */
  requests(session: S6ASession, scope?: WorkspaceScope): Promise<ModelRequest[]>;
  /** Model calls an abandoned Host started after its crash (refused, never served). */
  abandonedCalls(): readonly S6AAbandonedCall[];
  /** Every model request of the Session at the model boundary, held or cancelled ones too, with its call's signal. */
  boundary(session: S6ASession): Promise<ReadonlyArray<{ request: ModelRequest; signal: AbortSignal }>>;
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
  /**
   * The secretary binding's Host tool grant; default the base world's (`['read']`). 列了 `run_readonly_command` 时
   * 同时给 L18 的整工作区授权（`readonlyCommandAccess`），这个工具才挂得上。
   */
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
  /** The settings directory this world's Host starts with, derived once from the Host options (as `patchOptions` does).
   *  A method, not a property: worlds without a settings directory read `settingsDirectory` as absent (PL-25). */
  readonly settingsDirectoryOf: () => string;
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
  /** SQLite: abandon the running Host (stale lock) and start a new one on the same directory. `keepLease: true`
   *  keeps the abandoned Host's live lock, so the new Host starts `held_by_other` instead of taking the lease over.
   *  `heldCommitsRace: true` lets the commits the old Host had held at a `before` hold reach the store when the row
   *  releases them, so production's compare-and-swap decides between them and the new Host's writes. */
  crash(options?: S6AReopenOptions & { keepLease?: true; heldCommitsRace?: true }): Promise<void>;
  /** The Host's consume barrier (SR9 §2.4): resolves after the next real `consumeIdle` pass settles. */
  consumeBarrier(): Promise<void>;
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

export const refOf = (session: S6ASession | SessionRef): SessionRef =>
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
  const boundaryLog = new Map<string, { request: ModelRequest; signal: AbortSignal }[]>();
  const gates: GateEntry[] = [];
  /** The settings directory the Host starts with; `patchOptions` records it once (the Host derives the same one). */
  let resolvedSettingsDirectory: string | undefined;
  const window = options.secretaryBudget?.contextWindowTokens ?? S6A_SECRETARY_WINDOW_TOKENS;
  const maxTokens = options.secretaryBudget?.maxTokens === undefined ? null : options.secretaryBudget.maxTokens;
  const secretaryWork = options.secretaryWork === true;
  const secretaryTools = options.secretaryTools === undefined && !secretaryWork ? undefined
    : [...new Set([...(options.secretaryTools ?? ['read']), ...(secretaryWork ? ['send_session_message'] : [])])];

  const routed = (instance: HostInstance, fallback: ModelClientPort): ModelClientPort => ({
    async *stream(request, streamOptions) {
      const scope = runScope.getStore();
      // The run calling this Host's model client is this Host's run (see `KernelRun`).
      if (scope !== undefined) scope.run.host ??= instance;
      if (instance.abandoned) {
        abandonedCalls.push({ instance: instance.index, request: structuredClone(request) });
        throw new Error(`S6A: the abandoned Host ${instance.index} started a model call after its crash`);
      }
      if (scope?.kernelSessionId !== undefined) {
        const log = boundaryLog.get(scope.kernelSessionId) ?? [];
        log.push({ request: structuredClone(request) as ModelRequest, signal: streamOptions.signal });
        boundaryLog.set(scope.kernelSessionId, log);
      }
      const hold = scope?.kernelSessionId === undefined ? undefined
        : modelHolds.get(scope.kernelSessionId)?.find(candidate => !candidate.matched && candidate.active());
      if (hold !== undefined) {
        hold.matched = true;
        scope!.run.holds.push(() => !hold.released);
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
        ...(secretaryTools === undefined ? {} : { tools: [...secretaryTools] }),
        // 只读命令只在 L18 的整工作区授权下才挂上（QRR：用它造“不在只读名单里”的结果未知）。
        ...(secretaryTools?.includes('run_readonly_command') === true
          ? { readonlyCommandAccess: 'all_except_denied' as const } : {}) };
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
    resolvedSettingsDirectory ??= settings?.settingsDirectory
      ?? (hostOptions.storage.kind === 'sqlite' ? join(hostOptions.storage.directory, 'host-settings') : undefined);
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
      // A peer start keeps the live lock: the abandoned Host still runs and holds the instance lease (HL-02).
      if (instance.keepsLease !== true) await writeStaleLock(database);
    },
    reconcileOf: projectId => real.reconcileOf(projectId),
    get consumeStatus() { return real.consumeStatus; },
    consumeBarrier: () => real.consumeBarrier(),
  });

  /** Runs `start` with the Host factory wrapper installed; host-world starts are serialized. */
  async function hostStart<T>(start: () => Promise<T>): Promise<T> {
    const previous = hostStarts;
    let done!: () => void;
    hostStarts = new Promise<void>(resolve => { done = resolve; });
    await previous;
    const real = hostModule.createLocalWorkbenchHost;
    const wrapper: typeof real = async hostOptions => {
      const instance: HostInstance = { index: instances.length + 1, abandoned: false, crashed: false, crashOnClose: false,
        kernelStores: new Set((hostOptions.kernelStores?.entries ?? [])
          .map(entry => canonicalKernelStore(entry.databasePath))) };
      instances.push(instance);
      const database = hostOptions.storage.kind === 'sqlite' ? hostOptions.storage.directory : null;
      // Installed over whatever builds stores now (a world's own spy too, `tests/helpers/S7C-member-fixture.ts:183`)
      // and put back after the start, as the Host factory is below.
      const buildStore = sqliteStoreModule.createSqliteRecordBackend;
      const stoppable: typeof buildStore = storeOptions => stopsAtCrash(buildStore(storeOptions), instance);
      Object.defineProperty(sqliteStoreModule, 'createSqliteRecordBackend',
        { value: stoppable, configurable: true, writable: true });
      // The body store the same way (FLK rework ruling 5); the platform builds it at its start, beside the records.
      const buildBodies = sqliteBodyModule.createSqliteRawArtifactStore;
      const stoppableBodies: typeof buildBodies = path => bodiesStopAtCrash(buildBodies(path), instance);
      Object.defineProperty(sqliteBodyModule, 'createSqliteRawArtifactStore',
        { value: stoppableBodies, configurable: true, writable: true });
      try {
        return crashable(await real(patchOptions(hostOptions, instance)), instance, database);
      } finally {
        Object.defineProperty(sqliteStoreModule, 'createSqliteRecordBackend',
          { value: buildStore, configurable: true, writable: true });
        Object.defineProperty(sqliteBodyModule, 'createSqliteRawArtifactStore',
          { value: buildBodies, configurable: true, writable: true });
      }
    };
    Object.defineProperty(hostModule, 'createLocalWorkbenchHost',
      { value: wrapper, configurable: true, writable: true });
    try {
      return await start();
    } finally {
      Object.defineProperty(hostModule, 'createLocalWorkbenchHost',
        { value: real, configurable: true, writable: true });
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

  async function kernelSessionOf(session: S6ASession, scope?: WorkspaceScope): Promise<string> {
    if (scope === undefined) return (await base.readSession(session)).record.kernel.kernelSessionId;
    const read = (await base.post('sessions/read', plain(scope, session.ref))).body as ReadResult<SessionCard>;
    if (read.status !== 'ready') throw new Error(`S6A: the Session ${session.ref.sessionId} is not readable: ${JSON.stringify(read)}`);
    return read.value.record.kernel.kernelSessionId;
  }
  async function scriptOf(session: S6ASession, scope?: WorkspaceScope): Promise<SessionScript> {
    const key = await kernelSessionOf(session, scope);
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

  /**
   * FLK rework ruling 6: the one part of a running Host the write stop cannot stop is a Kernel run it had entered
   * and not held. Before anything changes, a crash looks at the runs the Kernel entry registered; one of this Host's
   * that is still going while no gate holds it fails the crash, naming the cell, the Host and the run. A run that has
   * called no model yet has no Host named; one on this Host's Kernel store is counted as this Host's, the world's only
   * Host running then (an abandoned Host's run let in after its crash calls its own, refusing client first).
   * The check runs at the crash because that is when the fact holds: it names the very crash call, leaves the old
   * Host running and the world closable as usual, and lets no later assertion of the row bury it.
   */
  const refuseCrashWhileRunsGoOn = (crashed: HostInstance): void => {
    const going = [...kernelRuns].filter(run => run.holds.every(holding => !holding())
      && (run.host === crashed || (run.host === null && crashed.kernelStores.has(run.kernelStore))));
    if (going.length === 0) return;
    const cell = expect.getState().currentTestName ?? 'the cell';
    const named = going.map(run => `${run.runId ?? 'with no platform run id'} (Kernel Session `
      + `${run.kernelSessionId ?? 'none'})`).join(', ');
    throw new Error(`S6A: ${cell} crashed Host ${crashed.index} while its Kernel run ${named} still went on and no `
      + 'gate of the row held it; crash once that run has ended or while a gate holds it');
  };

  const world = Object.create(base) as S6AHostWorld;
  const extra: Omit<S6AHostWorld, keyof S6ARequestWorld> & Pick<S6ARequestWorld, 'reopen' | 'makeUnavailableSecretary' | 'close'> = {
    settingsDirectoryOf() {
      if (resolvedSettingsDirectory === undefined) throw new Error('S6A: the Host start captured no settings directory');
      return resolvedSettingsDirectory;
    },
    scripted: {
      async script(session, replies, scope) {
        const script = await scriptOf(session, scope);
        for (const reply of replies) script.push(reply);
      },
      async pending(session) { return (await scriptOf(session)).pending(); },
      async requests(session, scope) { return structuredClone((await scriptOf(session, scope)).model.requests); },
      abandonedCalls: () => [...abandonedCalls],
      async boundary(session) { return [...(boundaryLog.get(await kernelSessionOf(session)) ?? [])]; },
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
          released: false, reached: deferred<S6AKernelEntry>(), gate: deferred() };
        entryHolds.push(hold);
        return register(`before the Kernel entry on ${session.label} #${++gateSeq}`, hold.reached.promise,
          () => { hold.released = true; hold.gate.resolve(); },
          () => { hold.released = true; hold.gate.reject(new Error('S6A: the world is closed')); });
      },
      beforeDrop: (input = {}) => commitGate(dropCommitOf({
        ...(input.requestRoot === undefined ? {} : { requestRoot: input.requestRoot }),
        ...(input.from === undefined ? {} : { from: input.from === null ? null : input.from.ref }),
      }), `before a drop commit #${++gateSeq}`),
      async modelRequest(session) {
        const active = gateScope();
        const key = await kernelSessionOf(session);
        const hold: ModelHold = { active, matched: false, released: false, reached: deferred<ModelRequest>(),
          gate: deferred() };
        const list = modelHolds.get(key) ?? [];
        list.push(hold);
        modelHolds.set(key, list);
        return register(`model request on ${session.label} #${++gateSeq}`, hold.reached.promise,
          () => { hold.released = true; hold.gate.resolve(); },
          () => { hold.released = true; hold.gate.reject(new Error('S6A: the world is closed')); });
      },
      async toolCall(session, toolName) {
        const active = gateScope();
        const hold: ToolHold = { owner, kernelSessionId: await kernelSessionOf(session), toolName, active, matched: false,
          released: false, reached: deferred<S6AToolCall>(), gate: deferred() };
        toolHolds.push(hold);
        return register(`tool ${toolName} on ${session.label} #${++gateSeq}`, hold.reached.promise,
          () => { hold.released = true; hold.gate.resolve(); },
          () => { hold.released = true; hold.gate.reject(new Error('S6A: the world is closed')); });
      },
      unreleased: () => gates.filter(entry => !entry.released).map(entry => entry.label),
    },

    async crash(reopenOptions = {}) {
      if (world.backend !== 'sqlite') throw new Error('S6A: a crash restarts the Host on the same directory (SQLite only)');
      const live = instances.at(-1);
      if (live === undefined) throw new Error('S6A: the world has no Host');
      const { keepLease, heldCommitsRace, ...reopen } = reopenOptions;
      if (keepLease !== true) refuseCrashWhileRunsGoOn(live);
      live.crashOnClose = true;
      if (keepLease === true) live.keepsLease = true;
      else {
        live.crashed = true;
        if (heldCommitsRace === true) live.heldCommitsRace = true;
      }
      await hostStart(() => base.reopen(reopen));
    },
    reopen: reopenOptions => hostStart(() => base.reopen(reopenOptions)),
    consumeBarrier: () => world.host.consumeBarrier(),
    makeUnavailableSecretary: (label, unavailableOptions) =>
      hostStart(() => base.makeUnavailableSecretary(label, unavailableOptions)),

    async setResumeOnStartup(on) {
      const snapshot = await settingsValue('snapshot', {});
      return await settingsValue('automation/save', { autoReworkLimit: snapshot.automation.autoReworkLimit,
        resumeOnStartup: on ? 'auto' : 'off' });
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
      // A-25/A-09: the hinted Session must be the key-1 holder, so the line is created through the real route with
      // an open `responsible` link to the Work Task (the old create step's own link).
      const linked = await createAG2bSession(world.ag2b, `s6a-session-${label}`, S6A_SECRETARY_ROLE, [{
        target: { kind: 'task' as const, ref: { projectId: S6A_SCOPE.projectId, goalId: S6A_GOAL_1.goalId,
          taskId: AG2B_WORK_TASK_ID } }, relation: 'responsible' as const }]);
      const linkedCard = await world.readSession(linked.sessionRef);
      const session: S6ASession = { label, ref: linked.sessionRef, aggregateRef: linkedCard.record.ref,
        role: structuredClone(S6A_SECRETARY_ROLE), createdAt: linkedCard.record.createdAt };
      await world.scripted.script(session, [{ kind: 'calls', calls: [{ callId: `s6a-wait-${label}`, name: 'send_session_message',
        args: { recipient: recipient.ref, text: `S6A Work question from ${label}`, needsReply: true,
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

/**
 * A published platform owner called in process as the Host's human operator bound to `scope`, for a case an HTTP
 * body cannot carry: the caller's own signal (an aborted one for a cancelled caller) or the caller's own input
 * object. `prefix` names the fixture in the stable error. The published member is called directly and its whole
 * result envelope comes back; this helper composes no fact.
 */
export function callPublishedOwnerAsHost(world: S6AHostWorld, prefix: string, call: {
  owner: string; wave: string; scope: { projectId: string; workspaceId: string }; signal?: AbortSignal;
}, input: unknown): Promise<unknown> {
  const [group, member] = call.owner.split('.') as [string, string];
  const target = asRecord(asRecord(world.platform as unknown as Record<string, unknown>)[group]);
  const method = target[member];
  if (typeof method !== 'function') {
    return Promise.reject(new Error(`${prefix}: the ${call.owner} command is not a published owner method`));
  }
  const principal = world.humanContext().principal;
  if (principal.kind !== 'host') throw new Error(`${prefix}: the world has no Host human context`);
  const ctx = createHostCoreCallContext({
    scope: call.scope, actor: { ...principal.actor }, signal: call.signal ?? new AbortController().signal,
  });
  return (method as (ctx: CoreCallContext, input: unknown) => Promise<unknown>).call(target, ctx, input);
}

export { asRecord };

/** The project's three opening lines (O1b, L26). */
export type S6AOpeningLines = { readonly secretary: S6ASession; readonly adviser: S6ASession; readonly scribe: S6ASession };

/**
 * O1b (L26): the seed's first workspace registration births the project's `start_lines` operation, and the Host opens
 * the secretary, adviser and scribe lines in the background, each taking a seat. Waits until the operation ends
 * (`startLinesEnded`, the one wait), fails unless it completed, and names each line from its step's `childOperation`:
 * `sessions/operation` gives the create's planned Session, `sessions/read` its card.
 */
export async function openingLinesOf(world: Pick<S6AHostWorld, 'post' | 'readSession'>,
  scope: WorkspaceScope = S6A_SCOPE): Promise<S6AOpeningLines> {
  const workspace = { projectId: scope.projectId, workspaceId: scope.workspaceId };
  const row = await startLinesEnded(async () => (await world.post('role-lines/operations', plain(scope, { workspace }))).body);
  if (row === null || row.phase !== 'completed') {
    throw new Error(`S6A: the start_lines operation did not complete: ${JSON.stringify(row)}`);
  }
  const lines: Partial<Record<(typeof ROLE_LINE_STEP_KEYS)[number], S6ASession>> = {};
  for (const step of row.steps) {
    const duty = ROLE_LINE_STEP_KEYS.find(key => key === step.key);
    if (duty === undefined || step.childOperation === null) {
      throw new Error(`S6A: a start_lines step names no opening line: ${JSON.stringify(step)}`);
    }
    const child = (await world.post('sessions/operation', plain(scope, step.childOperation))).body as
      ReadResult<SessionCreateOperationRecord>;
    if (child.status !== 'ready') throw new Error(`S6A: the ${duty} step's child create: ${JSON.stringify(child)}`);
    const ref = child.value.action.plannedSessionRef;
    const card = await world.readSession(ref);
    lines[duty] = { label: `opening-${duty}`, ref, aggregateRef: card.record.ref,
      role: structuredClone(card.record.role), createdAt: card.record.createdAt };
  }
  const { secretary, adviser, scribe } = lines;
  if (secretary === undefined || adviser === undefined || scribe === undefined) {
    throw new Error(`S6A: the start_lines operation does not name all three opening lines: ${JSON.stringify(row.steps)}`);
  }
  return { secretary, adviser, scribe };
}
