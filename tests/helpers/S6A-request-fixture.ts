/**
 * Slice 6A-1 fixture (book-6a §5.1, the 6A-1 bullet; spec §5.1 SE1): the request world on a REAL Host, on the
 * memory or the SQLite backend. The 6A-1 rows (R-01a, R-02, R-03a, R-04, R-06a, R-07′, route, replay, routes)
 * start from it and call 6A's request commands themselves; this file names none of them.
 *
 * What it provides, and the public step behind each item:
 * - A real `createLocalWorkbenchHost` (the K-readonly-host-support pattern: a trusted startup runtime
 *   configuration, a controlled provider registry) with three runtime bindings (secretary, plain consultation,
 *   Work), the query profiles of the chosen configuration, the Host Workflow binding for the Work role, one
 *   scripted model (no network, no real model) and a Kernel store. The Host's own platform object comes from the
 *   real `createTargetPlatform` call through a delegating spy that records the result and returns it unchanged
 *   (rule sheet A3; installed only while the Host starts). Reopen (restart on the same directory) is SQLite only.
 * - Secretary profiles come from the Host configuration (book ruling 4.1). `with_secretary` publishes a
 *   secretary profile, whose `sessionRole` is the platform secretary template
 *   (`platformRoleProfile('secretary').template`, which `src/composition/session-duty.ts` reads as `secretary`),
 *   and a plain profile (the AG2b advisor role, duty not `secretary`); `order` picks which comes first.
 *   `no_secretary` publishes the plain profile only. The book's third configuration is
 *   `reopen({ configuration: 'no_secretary' })` of a `with_secretary` world. The runtime bindings are the same in
 *   every configuration; only the profile list changes.
 * - `extraHostOptions`: Host options 6A adds (`secretaryOpenCap`) do not exist yet; they are spread, untyped,
 *   into the real Host options on open and on every reopen (a reopen may pass a new value). An extra key that
 *   would replace a fixture option is refused.
 * - The request driver (the Host's wake loop that claims and runs request rounds on its own) is OFF in every
 *   world unless `extraHostOptions` names `requestDriver: 'on'`: the rows of the request owners' rules hold a
 *   submitted round where the command left it and drive the Query steps through their routes themselves. The
 *   rows of the driver turn it on. A reopen that passes new extra options passes `requestDriver` again.
 * - The clock is the process `Date`, faked alone (never the timers), because the Session directory and the
 *   archive stamp `new Date()`; the Host's `now` reads the same value. Worlds open at once share it.
 * - The seed, through the HTTP routes: `projects/create`, `workspaces/register`, `goals/create` twice (goal 1 is
 *   the AG2b goal id, so the A2 `claimQueryOn` helper applies). The automatic architecture capture that the
 *   registration starts runs as the platform's detached work: the fixture waits for it through a delegating wrapper
 *   around `platform.trackDetached` (A3: the real tracker, its result unchanged), then reads
 *   `architecture/observation-state` once and fails if the capture is still pending. No polling, no timer.
 * - Sessions through `sessions/create` (AG2b `createAG2bSession`): secretaries with the profile's role; a
 *   secretary-duty Session whose role matches no profile (a RoleSpec with `platformDuty: 'secretary'`, installed
 *   and activated through the public `roles` owner); a plain Work Session (the Workflow binding's role, duty
 *   `executor`). A creation may set the clock first; otherwise it keeps the clock as it is.
 * - Session states, each through the steps real use takes:
 *   busy — a plain Query submitted and claimed on the line (`queries/submit` + `queries/claim`, A2
 *   `claimQueryOn`); released — that Query prepared, started and answered by the scripted model
 *   (`queries/prepare` + `queries/start`, AG2b `startBusyQuery`; the line keeps that QueryRun as its last
 *   execution, and its model requests report no usage); archived — `sessions/archive-line`; archive requested
 *   and not occupied — `sessions/archive-line` while such a Query holds the line (`pending`), then the Query
 *   answers and releases it (nothing continues the archive; a later Host start's maintenance does, so after a
 *   reopen the line is archived); revision changed and still admissible and idle — `sessions/archive-line` then
 *   `sessions/reactivate`; a read-only copy — the real copy path (`messages/send` of an inquiry, then
 *   `workflow/consultation`, which creates the copy and runs its Query; the scripted model fails that one call,
 *   so the copy has no answer and stays active, available and unoccupied, also across a reopen); health
 *   unavailable — SQLite only, the A8 Q-04 crash path (tests/scenarios/A8-host-restart-lease.test.ts:352): a
 *   plain Query is held inside the scripted model, the Host is abandoned with a stale lock, and the next Host's
 *   start-up reconcile closes the Query `failed` and retires the line `unavailable` / `kernel_turn_open`. The
 *   abandoned Host stays open, holding that call, until `close`.
 * - Access: the Host and its platform; HTTP routes as the Host's actor (`post`); any route in process with a
 *   chosen trusted call context (`dispatch`: the tests/app/S2B-35-activity-routes.test.ts pattern,
 *   `createPlatformCoreRouteBindings` over the Host's platform + `dispatchCoreRoute`; the Host's own lease gate
 *   and driver are not in those bindings); a human-operator and a non-human (`system`) Host context.
 *
 * No record, event or Session field is written by hand, and no setup is checked by reading the store: every
 * check here reads a public route.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { ProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';
import * as platformModule from '../../src/composition/create-platform.js';
import { createLocalWorkbenchHost, type LocalWorkbenchHost, type LocalWorkbenchHostOptions } from '../../src/app/host.js';
import { createHostCoreCallContext } from '../../src/app/core-call-context.js';
import {
  CORE_ROUTE_SPECS, createPlatformCoreRouteBindings, CoreRouteRejectionError, dispatchCoreRoute, parseCoreRouteRequest,
} from '../../src/app/core-routes.js';
import type {
  BootstrapExecutionQueryProfile, CoreRouteSuffix, QueryJobRef, QueryRunRef, SessionCard, SessionMessage, WorkbenchActor,
} from '../../src/app/core-http-types.js';
import type {
  WorkbenchQueryProfile, WorkbenchRuntimeBinding, WorkbenchRuntimeConfiguration,
} from '../../src/app/runtime-configuration.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionAggregateRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { roleSpecContentDigest, type RoleSpecContentV1 } from '../../src/contracts/role-spec.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { createScriptedModel, type ScriptedModel, type ScriptedReply } from './B2-runtime-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_PROJECT_REF, AG2B_QUERY_BUDGET, AG2B_QUERY_ROLE, AG2B_QUERY_ROLE_BINDING,
  AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, AG2B_WORKSPACE_REF, corePost,
  createAG2bSession, graphWrite, listSessions, plain, readBootstrap, readPageToken,
  startBusyQuery, writeAG2bWorkspace, type AG2bHost,
} from './AG2b-collaboration-fixture.js';
import {
  answer, claimQueryOn, deferred, post, publicDirectory, writeStaleLock, type Deferred,
} from './A2-restart-fixture.js';

// ---------------------------------------------------------------------------
// The trusted startup configuration
// ---------------------------------------------------------------------------

/** The world's workspace: the AG2b scope, so the AG2b and A2 route helpers apply unchanged. */
export const S6A_SCOPE = AG2B_SCOPE;
/** The clock's first instant (the controlled `now` of the Host and its platform). */
export const S6A_AT = '2026-10-23T09:00:00.000Z';
/** The two goals, created in this order by `goals/create`. */
export const S6A_GOAL_1: GoalRef = AG2B_GOAL_REF;
export const S6A_GOAL_2: GoalRef = { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: 's6a-goal-2' };

/** The platform secretary template; the duty resolver reads it as `secretary`. */
export const S6A_SECRETARY_ROLE: Extract<RoleConfigurationRef, { kind: 'legacy_template' }> =
  platformRoleProfile('secretary').template;
export const S6A_SECRETARY_ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 's6a-secretary-binding', templateId: S6A_SECRETARY_ROLE.templateId,
  templateRevision: S6A_SECRETARY_ROLE.templateRevision, bindingVersion: 1, policyRevision: 'legacy-template',
};
/** The plain (not a secretary) consultation role and the Work role: the AG2b ones. */
export const S6A_PLAIN_ROLE = AG2B_QUERY_ROLE;
export const S6A_PLAIN_ROLE_BINDING = AG2B_QUERY_ROLE_BINDING;
export const S6A_WORK_ROLE = AG2B_WORK_ROLE;
export const S6A_WORK_ROLE_BINDING = AG2B_WORK_ROLE_BINDING;

export const S6A_SECRETARY_PROFILE_ID = 's6a-secretary-profile';
export const S6A_PLAIN_PROFILE_ID = 's6a-plain-profile';
/** The id of the RoleSpec that gives a Session the secretary duty without matching any profile. */
export const S6A_UNPROFILED_ROLE_ID = 's6a-unprofiled-secretary';

const SECRET_VAR = 'S6A_CONTROLLED_SECRET';
const SECRET_VALUE = 's6a-controlled-secret-value';
const SECRETARY_INSTRUCTION = 'S6A trusted secretary guidance';
const PLAIN_INSTRUCTION = 'S6A trusted read-only consultation guidance';
const WORK_INSTRUCTION = 'S6A trusted work guidance';
const OPERATOR: WorkbenchActor = { kind: 'human', id: 's6a-operator' };
const AUTOMATION: WorkbenchActor = { kind: 'system', id: 's6a-automation' };

export type S6ABackend = 'memory' | 'sqlite';
export type S6AConfiguration = 'with_secretary' | 'no_secretary';
export type S6AProfileOrder = 'secretary_first' | 'plain_first';

/** One configured query profile, as the rows compare it with what 6A reads. */
export type S6AProfileFacts = {
  id: string;
  kind: 'secretary' | 'plain';
  sessionRole: RoleConfigurationRef;
  roleBinding: RoleBindingRefV1;
};

const SECRETARY_PROFILE: S6AProfileFacts = {
  id: S6A_SECRETARY_PROFILE_ID, kind: 'secretary', sessionRole: S6A_SECRETARY_ROLE, roleBinding: S6A_SECRETARY_ROLE_BINDING,
};
const PLAIN_PROFILE: S6AProfileFacts = {
  id: S6A_PLAIN_PROFILE_ID, kind: 'plain', sessionRole: S6A_PLAIN_ROLE, roleBinding: S6A_PLAIN_ROLE_BINDING,
};

/** The configured profiles, in configuration order. */
function profileFactsOf(configuration: S6AConfiguration, order: S6AProfileOrder): S6AProfileFacts[] {
  if (configuration === 'no_secretary') return [PLAIN_PROFILE];
  return order === 'secretary_first' ? [SECRETARY_PROFILE, PLAIN_PROFILE] : [PLAIN_PROFILE, SECRETARY_PROFILE];
}

const BINDING_OF_PROFILE: Record<string, string> = {
  [S6A_SECRETARY_PROFILE_ID]: 's6a-secretary-binding',
  [S6A_PLAIN_PROFILE_ID]: 's6a-plain-binding',
};

function runtimeConfigurationOf(configuration: S6AConfiguration, order: S6AProfileOrder): WorkbenchRuntimeConfiguration {
  const skillsRoot = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));
  const binding = (id: string, role: Extract<RoleConfigurationRef, { kind: 'legacy_template' }>, instruction: string):
  WorkbenchRuntimeBinding => ({
    id, label: `S6A ${id}`, scope: S6A_SCOPE, role, configurationRevision: `${id}@1`,
    model: { revision: `${id}-model@1`, provider: 'deepseek', model: `s6a-scripted-${id}`, secretEnvironmentVariable: SECRET_VAR },
    grant: {
      budget: AG2B_RUNTIME_BUDGET,
      hostTemplate: { templateId: role.templateId, revision: role.templateRevision, digest: sha256Hex(instruction) },
      tools: ['read'], writeScope: [], skills: { resourceRoot: skillsRoot, enabledIds: [] },
      systemInstruction: instruction, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
    },
  });
  const queryProfiles: WorkbenchQueryProfile[] = profileFactsOf(configuration, order).map(profile => ({
    id: profile.id, label: profile.kind === 'secretary' ? 'S6A secretary' : 'S6A plain consultation', scope: S6A_SCOPE,
    runtimeBindingId: BINDING_OF_PROFILE[profile.id]!, sessionRole: structuredClone(profile.sessionRole),
    roleBinding: structuredClone(profile.roleBinding), runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET,
    consumerId: AG2B_CONSUMER_ID,
  }));
  return {
    schemaVersion: 1,
    bindings: [
      binding('s6a-secretary-binding', S6A_SECRETARY_ROLE, SECRETARY_INSTRUCTION),
      binding('s6a-plain-binding', S6A_PLAIN_ROLE, PLAIN_INSTRUCTION),
      binding('s6a-work-binding', S6A_WORK_ROLE, WORK_INSTRUCTION),
    ],
    queryProfiles,
  };
}

const WORKFLOW: WorkflowHostConfiguration = {
  consumerId: AG2B_CONSUMER_ID,
  bindings: [{ workspace: S6A_SCOPE, sessionRole: S6A_WORK_ROLE, roleBinding: S6A_WORK_ROLE_BINDING,
    budget: { tokenBudget: 1_000_000, deadline: null } }],
};

// ---------------------------------------------------------------------------
// The Host's platform object (A3: a delegating spy around the real factory)
// ---------------------------------------------------------------------------

export type S6APlatform = Awaited<ReturnType<typeof platformModule.createTargetPlatform>>;

/** Host starts are serialized, so each captured platform belongs to exactly one Host. */
let starting: Promise<void> = Promise.resolve();

type StartedHost = {
  host: LocalWorkbenchHost;
  platform: S6APlatform;
  /** Resolves once every detached task the platform tracked (the automatic capture) has settled. */
  settleDetached(): Promise<void>;
};

async function startCapturingPlatform(options: LocalWorkbenchHostOptions): Promise<StartedHost> {
  const previous = starting;
  let done!: () => void;
  starting = new Promise<void>(resolve => { done = resolve; });
  await previous;
  const real = platformModule.createTargetPlatform;
  const built: S6APlatform[] = [];
  // The Host hands its detached work (the automatic capture driver, `src/app/host.ts:577`,
  // `src/app/auto-capture-driver.ts:97`) to `platform.trackDetached`, which it reads after this factory returns.
  // The wrapper calls the real tracker and returns its result unchanged; it only remembers when each task settles.
  const detached = new Set<Promise<void>>();
  const spy = vi.spyOn(platformModule, 'createTargetPlatform').mockImplementation(async (platformOptions) => {
    const platform = await real(platformOptions);
    built.push(platform);
    const track = platform.trackDetached;
    platform.trackDetached = <T>(work: Promise<T>): Promise<T> => {
      const result = track(work);
      const settled = result.then(() => undefined, () => undefined);
      detached.add(settled);
      void settled.then(() => { detached.delete(settled); });
      return result;
    };
    return platform;
  });
  try {
    let host: LocalWorkbenchHost;
    try {
      host = await createLocalWorkbenchHost(options);
    } catch (error) {
      // As tests/helpers/PC2-host-fixture.ts:191: a platform built before the Host failed is closed here.
      await Promise.allSettled(built.map(platform => platform.close()));
      throw error;
    }
    const platform = built[0];
    if (built.length !== 1 || platform === undefined) {
      await host.close();
      throw new Error(`S6A: the Host built ${built.length} platforms; the capture expects exactly one`);
    }
    return {
      host, platform,
      async settleDetached() { while (detached.size > 0) await Promise.all([...detached]); },
    };
  } finally {
    spy.mockRestore();
    done();
  }
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

export type S6AWorldOptions = {
  backend: S6ABackend;
  /** Default `with_secretary`. */
  configuration?: S6AConfiguration;
  /** Default `secretary_first`; only meaningful with `with_secretary`. */
  order?: S6AProfileOrder;
  /** 6A Host options that do not exist yet (e.g. `{ secretaryOpenCap: 2 }`), spread untyped into the Host options. */
  extraHostOptions?: Record<string, unknown>;
  /** The Host's HTTP actor; default the human operator. */
  actor?: WorkbenchActor;
  /** The clock's first instant; default `S6A_AT`. */
  at?: string;
};

export type S6AReopenOptions = {
  configuration?: S6AConfiguration;
  order?: S6AProfileOrder;
  /** Replaces the previous extra options; omitted keeps them, `{}` clears them. */
  extraHostOptions?: Record<string, unknown>;
};

/** One Session the world created, with the role it was created with. */
export type S6ASession = {
  label: string;
  ref: SessionRef;
  aggregateRef: SessionAggregateRef;
  role: RoleConfigurationRef;
  /** The record's `createdAt` as `sessions/read` returned it after the creation. */
  createdAt: string;
};

/** A plain Query the world submitted (and possibly claimed). */
export type S6AQueryRefs = { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef; suffix: string };

export type S6AClock = { now(): string; set(at: string): void; advance(ms: number): string };

/**
 * An HTTP answer: the status code and the parsed body. A refusal the route raises is a non-200 carrying the
 * rejection; a rejection the owner returns is a 200 body.
 */
export type S6AHttpAnswer = { httpStatus: number; body: unknown };

export type S6ARequestWorld = {
  readonly backend: S6ABackend;
  readonly scope: typeof S6A_SCOPE;
  readonly root: string;
  /** The SQLite directory (memory: the directory that holds only the Kernel store file). */
  readonly database: string;
  readonly clock: S6AClock;
  /** The current Host, its platform and its HTTP address; replaced by `reopen`. */
  readonly host: LocalWorkbenchHost;
  readonly platform: S6APlatform;
  readonly base: string;
  readonly token: string;
  /** The current Host in the AG2b helper shape, for the AG2b/A2 route helpers. */
  readonly ag2b: AG2bHost;
  readonly configuration: S6AConfiguration;
  /** The configured query profiles, in configuration order. */
  readonly profiles: readonly S6AProfileFacts[];
  readonly secretaryProfile: S6AProfileFacts | null;
  readonly plainProfile: S6AProfileFacts;
  /** The extra Host options the current Host was started with. */
  readonly extraHostOptions: Readonly<Record<string, unknown>>;
  readonly goals: { readonly first: GoalRef; readonly second: GoalRef };
  /** The one scripted model every binding uses (calls are counted). */
  readonly model: ScriptedModel;
  /** Resolves once the current Host's detached platform work (the automatic architecture capture) has settled. */
  settleDetached(): Promise<void>;
  /** Fresh trusted call contexts: the human operator (the Host's HTTP actor) and a non-human Host actor. */
  humanContext(): CoreCallContext;
  systemContext(): CoreCallContext;
  /** A core route over HTTP as the Host's actor. */
  post(suffix: string, body: unknown): Promise<S6AHttpAnswer>;
  /** A core route in process with the given trusted context (the Host's platform, its real route bindings). */
  dispatch(suffix: string, ctx: CoreCallContext, body: unknown): Promise<unknown>;
  /** The published query profiles (`GET bootstrap`, `execution.queryProfiles`). */
  readProfiles(): Promise<BootstrapExecutionQueryProfile[]>;
  readSession(session: S6ASession | SessionRef): Promise<SessionCard>;
  listSessions(): Promise<SessionCard[]>;
  createSecretary(label: string, options?: { at?: string }): Promise<S6ASession>;
  createUnprofiledSecretary(label: string, options?: { at?: string }): Promise<S6ASession>;
  createWorkSession(label: string, options?: { at?: string }): Promise<S6ASession>;
  /**
   * R-07′'s planning Query: `queries/submit` of an `initial_coordination` Query on goal 1 with the plain profile's
   * binding, not claimed (it is prepared with the planning template when it runs).
   */
  submitPlanningQuery(label: string): Promise<S6AQueryRefs>;
  /** A plain Query on goal 1 submitted and claimed on the Session: the line is busy, its revision moves. */
  occupy(session: S6ASession): Promise<S6AQueryRefs>;
  /** The claimed plain Query prepared, started and answered by the scripted model: the line is released. */
  finishQuery(refs: S6AQueryRefs): Promise<void>;
  /** `sessions/archive-line` on an unoccupied line: archived. */
  archive(session: S6ASession): Promise<SessionCard>;
  /** Archive requested and not occupied (see the header); the line stays active and available. */
  requestArchive(session: S6ASession): Promise<SessionCard>;
  /** `sessions/archive-line` then `sessions/reactivate`: the revision moves, the line stays admissible and idle. */
  bumpRevision(session: S6ASession): Promise<{ before: number; after: number }>;
  /** The real copy path on `source`; returns the copy (active, available, unoccupied) and its Query and message. */
  makeReadonlyCopy(source: S6ASession, label: string): Promise<{
    copy: S6ASession; message: SessionMessage['ref']; query: { queryJobRef: QueryJobRef; queryRunRef: QueryRunRef };
  }>;
  /** SQLite only: a secretary retired `unavailable` / `kernel_turn_open` by the A8 Q-04 crash path (restarts the Host). */
  makeUnavailableSecretary(label: string, options?: { at?: string }): Promise<S6ASession>;
  /** SQLite only: close the Host and start a new one on the same directory. */
  reopen(options?: S6AReopenOptions): Promise<void>;
  close(): Promise<void>;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function committedValue(body: unknown, what: string): Record<string, unknown> {
  if (asRecord(body)['status'] !== 'committed') throw new Error(`S6A: ${what} did not commit: ${JSON.stringify(body)}`);
  return asRecord(asRecord(body)['value']);
}

/** Worlds holding the fake `Date`; the first one installs it unless the test already did. */
let fakeDateHolders = 0;
let fakeDateInstalled = false;
function holdFakeDate(): () => void {
  if (fakeDateHolders === 0 && !vi.isFakeTimers()) {
    vi.useFakeTimers({ toFake: ['Date'] });
    fakeDateInstalled = true;
  }
  fakeDateHolders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    fakeDateHolders -= 1;
    if (fakeDateHolders === 0 && fakeDateInstalled) {
      vi.useRealTimers();
      fakeDateInstalled = false;
    }
  };
}

/** One scripted model call: answer, fail (the provider throws) or hold until released. */
type ModelStep = { kind: 'answer' } | { kind: 'fail' } | { kind: 'hold'; reached: Deferred; release: Deferred };

/**
 * Open the request world: the seed runs once, on the first open. Several worlds may be open at once (each has its
 * own directories); their Host starts are serialized.
 */
export async function openS6ARequestWorld(options: S6AWorldOptions): Promise<S6ARequestWorld> {
  const backend = options.backend;
  // The directories, the workspace files and the clock; a failure here removes what was made before `world` exists.
  // The clock is the process `Date` (the Session directory and the archive stamp `new Date()`, the platform reads
  // the Host's `now`): only `Date` is faked, never the timers, as the S2B BE1 and WP1 fixtures do. Worlds open at
  // the same time share it; the last one to close gives the real `Date` back.
  const made: string[] = [];
  let releaseClock: () => void = () => undefined;
  const allocate = async (): Promise<{ root: string; database: string; publicDir: string }> => {
    const root = await mkdtemp(join(tmpdir(), 's6a-request-ws-'));
    made.push(root);
    const database = await mkdtemp(join(tmpdir(), 's6a-request-db-'));
    made.push(database);
    const publicDir = await publicDirectory();
    made.push(publicDir);
    await writeAG2bWorkspace(root);
    releaseClock = holdFakeDate();
    vi.setSystemTime(new Date(options.at ?? S6A_AT));
    return { root, database, publicDir };
  };
  let allocated: { root: string; database: string; publicDir: string };
  try {
    allocated = await allocate();
  } catch (error) {
    releaseClock();
    await Promise.allSettled(made.map(path => rm(path, { recursive: true, force: true })));
    throw error;
  }
  const { root, database, publicDir } = allocated;
  const clock: S6AClock = {
    now: () => new Date().toISOString(),
    set: (next: string) => { vi.setSystemTime(new Date(next)); },
    advance: (ms: number) => { vi.setSystemTime(new Date(Date.now() + ms)); return new Date().toISOString(); },
  };

  // One scripted model for every binding. Each call takes the next scripted step; a step is added only by the
  // world's own helpers right before the call they cause.
  const replies: ScriptedReply[] = [];
  const steps: ModelStep[] = [];
  const model = createScriptedModel(replies, async (_request, index) => {
    const step = steps[index];
    if (step === undefined) throw new Error(`S6A: no scripted model step for call ${index}`);
    if (step.kind === 'fail') throw new Error('S6A scripted model failure');
    if (step.kind === 'hold') { step.reached.resolve(); await step.release.promise; }
  });
  const script = (step: ModelStep): void => {
    replies.push({ kind: 'text', text: `S6A scripted answer ${replies.length + 1}` });
    steps.push(step);
  };
  const registry = new ProviderRegistry().register({
    id: 'deepseek', secretEnvironmentVariable: SECRET_VAR, defaultBaseUrl: 'https://invalid.test',
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: () => model.client,
  });

  const actor: WorkbenchActor = options.actor === undefined ? { ...OPERATOR } : { ...options.actor };
  let configuration: S6AConfiguration = options.configuration ?? 'with_secretary';
  let order: S6AProfileOrder = options.order ?? 'secretary_first';
  let extraHostOptions: Record<string, unknown> = { ...(options.extraHostOptions ?? {}) };

  type Live = StartedHost & { base: string; token: string };
  let live: Live | null = null;
  /** Hosts left running by the crash path; released and closed by `close`. */
  const abandoned: { host: LocalWorkbenchHost; release: Deferred; inFlight: Promise<unknown> }[] = [];
  let closed = false;

  const hostOptions = (): LocalWorkbenchHostOptions => ({
    storage: backend === 'sqlite' ? { kind: 'sqlite', directory: database } : { kind: 'memory' },
    actor: { ...actor },
    workspaces: [{ scope: S6A_SCOPE, name: 'S6A request world', root, workspaceRevision: 1, readPrefixes: ['.'] }],
    architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    kernelStores: { entries: [{ adapterId: 's6a-kernel', storeKey: 's6a-kernel-store', workspace: S6A_SCOPE,
      databasePath: join(database, 'kernel.sqlite') }] },
    runtimeConfiguration: runtimeConfigurationOf(configuration, order),
    workflow: structuredClone(WORKFLOW),
    publicDir,
    now: () => clock.now(),
    runtimeProvider: { registry, secretSource: { get: (name: string) => name === SECRET_VAR ? SECRET_VALUE : undefined } },
  });

  async function startHost(): Promise<void> {
    const base = hostOptions();
    for (const key of Object.keys(extraHostOptions)) {
      if (key in base) throw new Error(`S6A: the extra Host option ${key} would replace a fixture option`);
    }
    // The 6A options are not in today's Host type; they pass through untyped until 6A-1 group H adds them.
    const started = await startCapturingPlatform(
      { requestDriver: 'off', ...extraHostOptions, ...base } as LocalWorkbenchHostOptions);
    try {
      const address = await started.host.listen();
      const token = await readPageToken(address.url);
      live = { ...started, base: address.url, token };
    } catch (error) {
      await started.host.close();
      throw error;
    }
  }

  const current = (): Live => {
    if (live === null) throw new Error('S6A: the world has no running Host');
    return live;
  };
  const ag2b = (): AG2bHost => {
    const now = current();
    return { host: now.host, base: now.base, token: now.token, root, database, publicDir, actor, scripted: model,
      queryScripted: model };
  };
  const contextOf = (as: WorkbenchActor): CoreCallContext =>
    createHostCoreCallContext({ scope: S6A_SCOPE, actor: as, signal: new AbortController().signal });

  async function readSession(session: S6ASession | SessionRef): Promise<SessionCard> {
    const ref: SessionRef = 'aggregateRef' in session ? session.ref : session;
    const read = await post<ReadResult<SessionCard>>(ag2b(), 'sessions/read', plain(S6A_SCOPE, ref));
    if (read.status !== 'ready') throw new Error(`S6A: the Session ${ref.sessionId} is not readable: ${JSON.stringify(read)}`);
    return read.value;
  }

  async function createSession(label: string, role: RoleConfigurationRef, at?: string): Promise<S6ASession> {
    if (at !== undefined) clock.set(at);
    // `createAG2bSession`'s parameter is typed by its default legacy role; the route takes any complete role.
    const created = await createAG2bSession(ag2b(), `s6a-session-${label}`, role as never);
    const card = await readSession(created.sessionRef);
    return { label, ref: created.sessionRef, aggregateRef: card.record.ref, role: structuredClone(role),
      createdAt: card.record.createdAt };
  }

  /** The RoleSpec secretary role: installed and activated once per world through the public `roles` owner. */
  let unprofiledRole: RoleConfigurationRef | null = null;
  async function unprofiledSecretaryRole(): Promise<RoleConfigurationRef> {
    if (unprofiledRole !== null) return unprofiledRole;
    const ctx = contextOf(OPERATOR);
    const content: RoleSpecContentV1 = {
      schemaVersion: 1, platformDuty: 'secretary', label: 'S6A secretary without a profile',
      purpose: 'A secretary whose role no Host query profile names', responsibility: ['human_decision_support'],
      requiredMaterials: [{ kind: 'contract', reason: 'Read the request' }], optionalMaterials: [],
      permissions: { tools: ['read'], writeScope: 'none' },
      budget: { source: 'task-budget', scope: 'assigned-task' },
      requiredOutputs: [{ kind: 'answer-with-sources', reason: 'Answer the person' }],
      exit: { success: 'Answer', stop: 'Stop on missing material', handoff: 'Keep references' },
    };
    const identity = (key: string) => ({ projectId: S6A_SCOPE.projectId, actor: { ...OPERATOR }, idempotencyKey: key });
    const installed = await current().platform.roles.installRoleSpec(ctx, {
      commandId: 's6a-role-install', commandType: 'InstallRoleSpecRevision', schemaVersion: 1,
      correlationId: 's6a-role', submittedAt: clock.now(), identity: identity('s6a-role-install'),
      payload: { roleId: S6A_UNPROFILED_ROLE_ID, revision: 1, content,
        contentDigest: roleSpecContentDigest(content, S6A_UNPROFILED_ROLE_ID, 1) },
    });
    if (installed.status !== 'committed') throw new Error(`S6A: the RoleSpec install failed: ${JSON.stringify(installed)}`);
    const pin = { ref: installed.revisionRef, digest: installed.contentDigest };
    const activated = await current().platform.roles.activateRoleSpec(ctx, {
      commandId: 's6a-role-activate', commandType: 'ActivateRoleSpecRevision', schemaVersion: 1,
      correlationId: 's6a-role', submittedAt: clock.now(), identity: identity('s6a-role-activate'),
      aggregateId: S6A_UNPROFILED_ROLE_ID, expectedRevision: 1, payload: { target: pin },
    });
    if (activated.status !== 'committed') throw new Error(`S6A: the RoleSpec activation failed: ${JSON.stringify(activated)}`);
    unprofiledRole = { kind: 'role_spec', pin };
    return unprofiledRole;
  }

  function roleBindingFor(session: S6ASession): RoleBindingRefV1 {
    if (session.role.kind === 'legacy_template') {
      if (session.role.templateId === S6A_SECRETARY_ROLE.templateId) return S6A_SECRETARY_ROLE_BINDING;
      if (session.role.templateId === S6A_PLAIN_ROLE.templateId) return S6A_PLAIN_ROLE_BINDING;
      if (session.role.templateId === S6A_WORK_ROLE.templateId) return S6A_WORK_ROLE_BINDING;
    }
    throw new Error(`S6A: no plain Query binding for the role of ${session.label}`);
  }

  let querySeq = 0;
  async function occupy(session: S6ASession): Promise<S6AQueryRefs> {
    const card = await readSession(session);
    const suffix = `s6a-${session.label}-${++querySeq}`;
    const claimed = await claimQueryOn(ag2b(), { ref: card.record.ref, revision: card.record.revision }, suffix,
      roleBindingFor(session));
    committedValue(claimed.claim, `the plain Query claim on ${session.label}`);
    return { queryJobRef: claimed.queryJobRef, queryRunRef: claimed.queryRunRef, suffix };
  }

  async function finishQuery(refs: S6AQueryRefs): Promise<void> {
    script({ kind: 'answer' });
    await startBusyQuery(ag2b(), refs, refs.suffix);
  }

  async function archiveLine(session: S6ASession, label: string): Promise<Record<string, unknown>> {
    const card = await readSession(session);
    const result = await answer(ag2b(), 'sessions/archive-line', graphWrite(S6A_SCOPE, {
      sessionRef: session.ref, reason: `S6A ${label}`, tasks: [], wait: null,
    }, `s6a-archive-${session.label}-${card.record.revision}`, [{ ref: card.record.ref, revision: card.record.revision }]));
    if (result['status'] !== 'ready') throw new Error(`S6A: archive-line on ${session.label}: ${JSON.stringify(result)}`);
    return asRecord(result['value']);
  }

  const world: S6ARequestWorld = {
    backend, scope: S6A_SCOPE, root, database, clock,
    get host() { return current().host; },
    get platform() { return current().platform; },
    get base() { return current().base; },
    get token() { return current().token; },
    get ag2b() { return ag2b(); },
    get configuration() { return configuration; },
    get profiles() { return profileFactsOf(configuration, order); },
    get secretaryProfile() { return configuration === 'with_secretary' ? SECRETARY_PROFILE : null; },
    plainProfile: PLAIN_PROFILE,
    get extraHostOptions() { return { ...extraHostOptions }; },
    goals: { first: S6A_GOAL_1, second: S6A_GOAL_2 },
    model,
    settleDetached: () => current().settleDetached(),
    humanContext: () => contextOf(actor.kind === 'human' ? actor : OPERATOR),
    systemContext: () => contextOf(AUTOMATION),

    async post(suffix, body) {
      const response = await corePost(current().base, suffix, current().token, body);
      return { httpStatus: response.status, body: await response.json() as unknown };
    },

    async dispatch(suffix, ctx, body) {
      // A suffix 6A adds is not in today's route table type; the real table decides at run time, and a suffix it
      // does not publish gets the HTTP server's answer (`src/app/server.ts:415`).
      if (!(suffix in CORE_ROUTE_SPECS)) {
        return { status: 'rejected', code: 'not_found', reason: `unpublished core route ${suffix}` };
      }
      const route = suffix as CoreRouteSuffix;
      const bindings = createPlatformCoreRouteBindings(current().platform);
      try {
        return await dispatchCoreRoute(bindings, route, ctx, parseCoreRouteRequest(route, body));
      } catch (error) {
        if (error instanceof CoreRouteRejectionError) return error.rejection;
        throw error;
      }
    },

    async readProfiles() { return (await readBootstrap(ag2b())).execution.queryProfiles; },
    readSession,
    async listSessions() { return await listSessions(ag2b()); },

    createSecretary: (label, opts = {}) => createSession(label, S6A_SECRETARY_ROLE, opts.at),
    async createUnprofiledSecretary(label, opts = {}) { return createSession(label, await unprofiledSecretaryRole(), opts.at); },
    createWorkSession: (label, opts = {}) => createSession(label, S6A_WORK_ROLE, opts.at),

    async submitPlanningQuery(label) {
      const goal = await post<ReadResult<{ goal: { revision: number } }>>(ag2b(), 'goals/read', plain(S6A_SCOPE, S6A_GOAL_1));
      if (goal.status !== 'ready') throw new Error(`S6A: goal 1 is not readable: ${JSON.stringify(goal)}`);
      const suffix = `s6a-planning-${label}`;
      const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', ...S6A_SCOPE, queryJobId: `${suffix}-job` };
      const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', ...S6A_SCOPE, queryJobId: queryJobRef.queryJobId,
        runId: `${suffix}-run` };
      const intent = {
        schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId,
        goalId: S6A_GOAL_1.goalId, question: `S6A planning Query ${label}`, focusTaskRefs: [], budget: AG2B_QUERY_BUDGET,
        multiTurn: { maxRounds: 1 }, correlationId: `${suffix}-corr`,
        execution: { kind: 'initial_coordination', roleBinding: S6A_PLAIN_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET },
      };
      committedValue(await answer(ag2b(), 'queries/submit', graphWrite(S6A_SCOPE, {
        queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent,
      }, `${suffix}-submit`, [
        { ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 },
        { ref: S6A_GOAL_1, revision: goal.value.goal.revision }, { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 },
      ])), `the planning Query ${label}`);
      return { queryJobRef, queryRunRef, suffix };
    },

    occupy,
    finishQuery,

    async archive(session) {
      const value = await archiveLine(session, 'archive');
      if (value['state'] !== 'archived') throw new Error(`S6A: ${session.label} was not archived: ${JSON.stringify(value)}`);
      return await readSession(session);
    },

    async requestArchive(session) {
      const refs = await occupy(session);
      const value = await archiveLine(session, 'archive request');
      if (value['state'] !== 'pending') throw new Error(`S6A: ${session.label}'s archive is not pending: ${JSON.stringify(value)}`);
      await finishQuery(refs);
      const card = await readSession(session);
      if (card.record.archiveRequest == null || card.record.occupancy !== null || card.record.lifecycle !== 'active') {
        throw new Error(`S6A: ${session.label} is not an unoccupied line with an archive request: ${JSON.stringify(card.record)}`);
      }
      return card;
    },

    async bumpRevision(session) {
      const before = (await readSession(session)).record.revision;
      const archived = await world.archive(session);
      committedValue(await answer(ag2b(), 'sessions/reactivate', graphWrite(S6A_SCOPE, {
        sessionRef: session.ref, reason: 'S6A reactivate',
      }, `s6a-reactivate-${session.label}-${archived.record.revision}`, [
        { ref: archived.record.ref, revision: archived.record.revision }])), `the reactivation of ${session.label}`);
      const after = await readSession(session);
      if (after.record.lifecycle !== 'active') throw new Error(`S6A: ${session.label} is not active again`);
      return { before, after: after.record.revision };
    },

    async makeReadonlyCopy(source, label) {
      const sent = committedValue(await answer(ag2b(), 'messages/send', graphWrite(S6A_SCOPE, {
        recipient: source.ref, text: `S6A copy question ${label}`, intent: 'inquiry', needsReply: true,
      }, `s6a-copy-message-${label}`, [])), `the inquiry to ${source.label}`);
      const messageRef = sent['ref'] as SessionMessage['ref'];
      // The copy's one model call fails, so the copy ends with no answer and is not archived as an answered copy.
      script({ kind: 'fail' });
      const consulted = await answer(ag2b(), 'workflow/consultation', plain(S6A_SCOPE, {
        schemaVersion: 1, messageRef, goalRef: S6A_GOAL_1, roleBinding: roleBindingFor(source),
        runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
      }));
      if (consulted['status'] !== 'ready') throw new Error(`S6A: the consultation was refused: ${JSON.stringify(consulted)}`);
      const message = await post<ReadResult<SessionMessage>>(ag2b(), 'messages/read', plain(S6A_SCOPE, messageRef));
      if (message.status !== 'ready' || message.value.consultationDerivation === undefined) {
        throw new Error(`S6A: the inquiry recorded no copy: ${JSON.stringify(message)} after ${JSON.stringify(consulted)}`);
      }
      const childRef = message.value.consultationDerivation.childSessionRef;
      const card = await readSession(childRef);
      const copy: S6ASession = { label, ref: { projectId: childRef.projectId, sessionId: childRef.sessionId },
        aggregateRef: card.record.ref, role: structuredClone(card.record.role), createdAt: card.record.createdAt };
      // The copy's Query as the consultation returned it.
      const record = asRecord(asRecord(consulted['value'])['query']);
      const queryJobRef = asRecord(record['job'])['ref'] as QueryJobRef | undefined;
      const queryRunRef = asRecord(record['run'])['ref'] as QueryRunRef | undefined;
      if (queryJobRef === undefined || queryRunRef === undefined) {
        throw new Error(`S6A: the consultation returned no copy Query: ${JSON.stringify(consulted)}`);
      }
      return { copy, message: messageRef, query: { queryJobRef, queryRunRef } };
    },

    async makeUnavailableSecretary(label, opts = {}) {
      if (backend !== 'sqlite') throw new Error('S6A: the unavailable secretary needs a Host restart (SQLite only)');
      const session = await createSession(label, S6A_SECRETARY_ROLE, opts.at);
      const refs = await occupy(session);
      const hold: ModelStep & { kind: 'hold' } = { kind: 'hold', reached: deferred(), release: deferred() };
      script(hold);
      const crashed = current();
      const inFlight = startBusyQuery(ag2b(), refs, refs.suffix).catch(() => undefined);
      // Registered for `close` at once: whatever fails below, the hold is released and this Host is closed.
      abandoned.push({ host: crashed.host, release: hold.release, inFlight });
      const reached = await Promise.race([hold.reached.promise.then(() => true), inFlight.then(() => false)]);
      if (!reached) throw new Error(`S6A: the Query on ${label} ended before it reached the model`);
      // The crash: the Host is left running inside the model call, its lock names an exited process.
      await writeStaleLock(database);
      live = null;
      await startHost();
      const card = await readSession(session);
      if (card.record.health !== 'unavailable' || card.record.occupancy !== null || card.record.lifecycle !== 'active') {
        throw new Error(`S6A: ${label} is not an unoccupied unavailable line: ${JSON.stringify(card.record)}`);
      }
      return session;
    },

    async reopen(reopenOptions = {}) {
      if (backend !== 'sqlite') throw new Error('S6A: reopen restarts the Host on the same directory (SQLite only)');
      await current().host.close();
      live = null;
      if (reopenOptions.configuration !== undefined) configuration = reopenOptions.configuration;
      if (reopenOptions.order !== undefined) order = reopenOptions.order;
      if (reopenOptions.extraHostOptions !== undefined) extraHostOptions = { ...reopenOptions.extraHostOptions };
      await startHost();
    },

    async close() {
      if (closed) return;
      closed = true;
      // Every hold is released first, then every Host is closed; one failure never skips the others.
      const entries = abandoned.splice(0);
      const hosts = new Set([...(live === null ? [] : [live.host]), ...entries.map(entry => entry.host)]);
      live = null;
      for (const entry of entries) entry.release.reject(new Error('S6A: the abandoned Host is closed'));
      await Promise.allSettled(entries.map(entry => entry.inFlight));
      const stopped = await Promise.allSettled([...hosts].map(host => host.close()));
      releaseClock();
      const removed = await Promise.allSettled([root, database, publicDir]
        .map(path => rm(path, { recursive: true, force: true })));
      const failures = [...stopped, ...removed]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason as unknown);
      if (failures.length > 0) throw new AggregateError(failures, 'S6A cleanup failed');
    },
  };

  try {
    await startHost();
    // The seed (first open only): project, workspace, two goals, through the HTTP routes.
    const seed = async (suffix: string, body: unknown): Promise<void> => {
      committedValue((await world.post(suffix, body)).body, `the seed write ${suffix}`);
    };
    await seed('projects/create', graphWrite(S6A_SCOPE, { projectId: S6A_SCOPE.projectId }, 's6a-project',
      [{ ref: AG2B_PROJECT_REF, revision: 0 }]));
    await seed('workspaces/register', graphWrite(S6A_SCOPE, { workspace: S6A_SCOPE }, 's6a-workspace',
      [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 0 }]));
    for (const [goal, objective] of [[S6A_GOAL_1, 'S6A goal one'], [S6A_GOAL_2, 'S6A goal two']] as const) {
      await seed('goals/create', graphWrite(S6A_SCOPE, { goalId: goal.goalId, workspace: S6A_SCOPE, objective },
        `s6a-${goal.goalId}`, [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 }]));
    }
    // The automatic capture the registration started: wait for its detached work, then read its state once.
    await current().settleDetached();
    const state = asRecord((await world.post('architecture/observation-state',
      plain(S6A_SCOPE, { workspace: S6A_SCOPE }))).body);
    const capture = state['status'] === 'ready' ? asRecord(state['value'])['autoCapture'] : undefined;
    if (capture === undefined || (capture !== null && asRecord(capture)['pending'] === true
      && asRecord(capture)['status'] !== 'failed')) {
      throw new Error(`S6A: the automatic capture has not settled: ${JSON.stringify(state)}`);
    }
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
  return world;
}

// ---------------------------------------------------------------------------
// A second workspace of the same project in the same Host
// ---------------------------------------------------------------------------
import { dirname } from 'node:path';
import * as hostModule from '../../src/app/host.js';

/** The second workspace `openS6ATwoWorkspaceWorld` configures: the same project, its own root and Kernel store. */
export const S6A_SECOND_SCOPE = { projectId: S6A_SCOPE.projectId, workspaceId: 's6a-second-workspace' } as const;

export type S6ASecondWorkspace = {
  readonly scope: typeof S6A_SECOND_SCOPE;
  /** A fresh trusted call context of the second workspace for the human operator. */
  humanContext(): CoreCallContext;
  /** `sessions/read` in the second workspace (in process, its trusted context). */
  readSession(session: S6ASession | SessionRef): Promise<SessionCard>;
  /** `sessions/create` in the second workspace with the platform secretary template role. */
  createSecretary(label: string): Promise<S6ASession>;
};

/**
 * The request world whose Host also configures a second workspace of the same
 * project: its own root (written like the first) and its own Kernel store, both
 * Host inputs (rule sheet A8). The runtime bindings, the query profiles and the
 * Workflow binding stay the first workspace's. The Host factory is reached
 * through a delegating spy, installed only while the world opens, that adds
 * those two entries to the options the world builds and changes nothing else;
 * the Host it returns is the real one. The second workspace is then registered
 * through `workspaces/register`, in process with its own trusted context.
 * Memory or SQLite; the world is not reopened. `world.close` also removes the
 * second root.
 */
export async function openS6ATwoWorkspaceWorld(options: S6AWorldOptions):
Promise<{ world: S6ARequestWorld; second: S6ASecondWorkspace }> {
  const root = await mkdtemp(join(tmpdir(), 's6a-request-ws2-'));
  let world: S6ARequestWorld;
  try {
    await writeAG2bWorkspace(root);
    const real = hostModule.createLocalWorkbenchHost;
    const spy = vi.spyOn(hostModule, 'createLocalWorkbenchHost').mockImplementation(async (hostOptions) => {
      const entries = hostOptions.kernelStores?.entries ?? [];
      const first = entries[0];
      if (first === undefined) throw new Error('S6A: the world configures no Kernel store');
      return real({
        ...hostOptions,
        workspaces: [...hostOptions.workspaces, { scope: { ...S6A_SECOND_SCOPE }, name: 'S6A second workspace', root,
          workspaceRevision: 1, readPrefixes: ['.'] }],
        kernelStores: { entries: [...entries, { adapterId: 's6a-kernel-2', storeKey: 's6a-kernel-store-2',
          workspace: { ...S6A_SECOND_SCOPE }, databasePath: join(dirname(first.databasePath), 'kernel-2.sqlite') }] },
      });
    });
    try {
      world = await openS6ARequestWorld(options);
    } finally {
      spy.mockRestore();
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  const closeWorld = world.close.bind(world);
  world.close = async () => {
    try { await closeWorld(); } finally { await rm(root, { recursive: true, force: true }); }
  };

  const contextOf = (): CoreCallContext =>
    createHostCoreCallContext({ scope: { ...S6A_SECOND_SCOPE }, actor: { ...OPERATOR }, signal: new AbortController().signal });

  async function readSecond(session: S6ASession | SessionRef): Promise<SessionCard> {
    const ref: SessionRef = 'aggregateRef' in session ? session.ref : session;
    const read = await world.dispatch('sessions/read', contextOf(), plain(S6A_SECOND_SCOPE, ref)) as ReadResult<SessionCard>;
    if (read.status !== 'ready') throw new Error(`S6A: the second workspace Session ${ref.sessionId} is not readable: ${JSON.stringify(read)}`);
    return read.value;
  }

  const second: S6ASecondWorkspace = {
    scope: S6A_SECOND_SCOPE,
    humanContext: contextOf,
    readSession: readSecond,
    async createSecretary(label) {
      const created = asRecord(await world.dispatch('sessions/create', contextOf(), plain(S6A_SECOND_SCOPE, {
        workspace: { ...S6A_SECOND_SCOPE }, role: S6A_SECRETARY_ROLE, recommendedRefs: [], initialLinks: [],
        meta: { requestId: `s6a-second-session-${label}`, expected: [] },
      })));
      if (created['status'] !== 'completed') {
        throw new Error(`S6A: the second workspace Session ${label} was not created: ${JSON.stringify(created)}`);
      }
      const aggregate = asRecord(created['value'])['ref'] as SessionAggregateRef;
      const ref: SessionRef = { projectId: aggregate.projectId, sessionId: aggregate.sessionId };
      const card = await readSecond(ref);
      return { label, ref, aggregateRef: card.record.ref, role: structuredClone(S6A_SECRETARY_ROLE),
        createdAt: card.record.createdAt };
    },
  };

  try {
    committedValue(await world.dispatch('workspaces/register', contextOf(), graphWrite(S6A_SECOND_SCOPE,
      { workspace: { ...S6A_SECOND_SCOPE } }, 's6a-second-workspace', [
        { ref: AG2B_PROJECT_REF, revision: 1 },
        { ref: { aggregateType: 'Workspace', ...S6A_SECOND_SCOPE }, revision: 0 },
      ])), 'the second workspace registration');
    // The registration starts the automatic capture of the second root; wait for it.
    await world.settleDetached();
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
  return { world, second };
}
