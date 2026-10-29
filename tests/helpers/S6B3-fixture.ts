/**
 * The goal-card world: one explicitly scoped Host world (tests/helpers/S6A-host-fixture.ts), the main workspace
 * seeded without a goal, a second workspace opened through the Host's own `workspaces/open` settings route, and the
 * public request/Query steps that hold a round at its model gate or its start commit and read the saved answer back.
 *
 * Rules:
 * - Every state comes from a public step: core routes over HTTP as the Host's human operator, a published platform
 *   owner called in process as that operator bound to a scope (for a caller's own signal or input object), the Host's
 *   settings routes, the scripted provider replies, and the request/Query routes. The one hold delays a real step (the model
 *   gate of the host world, or its start commit) and returns the real route result; no record, event, cursor, pin or
 *   prepared value is built here.
 * - Every pin is the revision a public read returned just before the write; the held value carries no answer and no
 *   draft, and every returned fact is a property of a route view or of a published owner's own result envelope.
 * - `close()` releases and awaits every in-flight held call (the armed store faults included), runs
 *   `commitBarrier.reset()`, then removes the fixture's temporary settings directory and every workspace root it
 *   opened, after the world's own close; a failure while opening removes what it made.
 * - The commit gates only delay the real commit the platform prepared, or its answer after it ran (the commit barrier
 *   the Host fixture already uses); the prepared commit's content is never returned, and `commitBarrier.reset()` runs
 *   before the world closes, so a gate whose commit never arrived catches no commit of a later world.
 * - The store faults are the same barrier's delegating wrapper: a real `readMany` of one record key, or one real child
 *   commit, throws an I/O error instead of reaching the store; every other call is the real one, returned unchanged.
 *   The faults live in the module-level `commitBarrier`: while armed, a fault applies to every wrapped backend in the
 *   test file, a crashed or reopened Host's included. The world's `close()` releases its arms and
 *   `commitBarrier.reset()` disarms every fault, so none survives the world; a fault that never matches is a no-op.
 * - The settings wrapper is a module spy around the real `createHostSettings` factory, installed before the world
 *   opens and restored by the row file; it changes one input only, the `onConfigurationChanged` callback of the Host
 *   start that captured the current instance token, and its named points delegate to that real callback. A persist
 *   failure is a real file fault on the fixture's own settings directory, put back by `disposeS6B3SettingsWrapper()`
 *   before the world closes; no fault survives a test, a crash or a reopen.
 */
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { CORE_ROUTE_SPECS } from '../../src/app/core-routes.js';
import * as hostSettingsModule from '../../src/app/host-settings.js';
import type { HostSettingsCallbacks } from '../../src/app/host-settings.js';
import type { HostSettingsSnapshot, SettingsResponse } from '../../src/app/host-settings-types.js';
import type { BootstrapExecutionQueryProfile, WorkbenchActor } from '../../src/app/core-http-types.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { GoalConfirmDraftInputV1 } from '../../src/contracts/goal-card.js';
import type { GoalAutonomyV1 } from '../../src/contracts/goal-decisions.js';
import { GoalRefShape } from '../../src/contracts/data-format-refs.js';
import type { GoalContinuationV1, GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type {
  InitializationAdoptResultV1, InitializationAdoptStageV1, InitializationAdoptionRef,
} from '../../src/contracts/initialization-adoption.js';
import type { InitializationBindingRef, InitializationBindingV1 } from '../../src/contracts/initialization-binding.js';
import type { NoteSectionsV1 } from '../../src/contracts/note.js';
import type { InitialPlanningSetupV2 } from '../../src/contracts/initial-planning.js';
import type {
  GoalCardDraftV1, GoalScreeningV1, QueryJobAnswerRef, QueryJobAnswerSnapshot, QueryJobRef,
} from '../../src/contracts/query-job.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RegisteredCommandCheck } from '../../src/contracts/verification.js';
import type {
  PreparedQueryExecution, PreparedQueryManifestV1,
} from '../../src/contracts/core/prepared-execution.js';
import { checkShape } from '../../src/contracts/validation/data-format.js';
import { canonicalKey, sha256Hex } from '../../src/contracts/fingerprint.js';
import { isRecord } from '../../src/contracts/validation/common.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { NoteItemV1, NoteListResultV1, WriteNoteEnvelopeV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import type { InitializationBindingReadPort } from '../../src/core/work-graph/model/goal-card-contracts.js';
import type { RequestReadV1 } from '../../src/core/work-graph/views/main-surface-read-model.js';
import { deferred, type Deferred } from './A2-restart-fixture.js';
import type { ScriptedReply } from './B2-runtime-fixture.js';
import { AG2B_CONSUMER_ID, ag2bChecksConfiguration, graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { allOf, byIdentityPrefix, commitBarrier, type CommitMatch } from './S6A-commit-barrier.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import { claimProfile as claimProfileOf, claimWithSecretaryProfile } from './request-claim-steps.js';
import { holdS6BRequestRound } from './S6B1-fixture.js';
import {
  callPublishedOwnerAsHost, openS6AHostWorld, type S6AGate, type S6AHostWorld, type S6AReply,
} from './S6A-host-fixture.js';
import {
  OPERATOR, S6A_SCOPE, S6A_SECRETARY_ROLE, type S6ABackend, type S6ASession,
} from './S6A-request-fixture.js';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The fixture's Host-instance counter; a later step bumps it when it starts a new Host. */
export type S6B3InstanceSeq = { current: number };

/** The one world the steps take; `host` is the real host world behind it. */
export type S6B3World = {
  readonly host: S6AHostWorld;
  readonly mainScope: typeof S6A_SCOPE;
  /** The fixture's own temporary settings directory (removed by `close`). */
  readonly settingsDirectory: string;
  readonly instanceSeq: S6B3InstanceSeq;
  /**
   * Every in-flight held call: how to let it go and the call it finishes. It also holds the armed store faults (their
   * `done` already resolved), which `close` disarms; `close` releases and awaits every entry.
   */
  readonly held: { release(): void; done: Promise<unknown> }[];
  close(): Promise<void>;
};

/** One workspace the Host registered through its settings route. */
export type S6B3Workspace = {
  scope: { projectId: string; workspaceId: string };
  goals: readonly GoalSnapshot[];
  /** The scope's real published secretary profile, as `bootstrap` lists it. */
  profile: BootstrapExecutionQueryProfile;
};

/** A held answer round: the public submit result, its round and the held step; no answer and no draft. */
export type S6B3Held = {
  request: { requestRoot: QueryJobRef; round: QueryJobRef; secretary: SessionRef | null };
  round: QueryJobRef;
  gate: S6AGate<unknown>;
  /** Releases the held step and answers the real `queries/start` body when the round ends. */
  release(): Promise<Record<string, unknown>>;
};

/** One draft as the request view returned it; `confirmedGoalRef` is read from the view at call time. */
export type S6B3Draft = {
  index: number;
  objective: string;
  completion: string[];
  autonomy: GoalCardDraftV1['autonomy'];
  screening: GoalScreeningV1 | null;
  confirmedGoalRef: GoalRef | null;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function field(body: unknown, key: string): unknown {
  return isRecord(body) ? body[key] : undefined;
}

/** The `value` of a route answer with `status`; any other answer throws with what the platform said. */
function valueOf<T>(body: unknown, status: 'ready' | 'committed' | 'completed', what: string): T {
  if (field(body, 'status') !== status) throw new Error(`S6B3: ${what} is not ${status}: ${JSON.stringify(body)}`);
  return field(body, 'value') as T;
}

/** The value of a port's `ReadResult`; a failed read is thrown, never turned into a branch. */
function readReady<T>(read: ReadResult<T>, what: string): T {
  if (read.status !== 'ready') throw new Error(`S6B3: ${what} is not ready: ${JSON.stringify(read)}`);
  return read.value;
}

const sameScope = (left: { projectId: string; workspaceId: string }, right: { projectId: string; workspaceId: string }) =>
  left.projectId === right.projectId && left.workspaceId === right.workspaceId;

const scopeOfQuery = (ref: QueryJobRef) => ({ projectId: ref.projectId, workspaceId: ref.workspaceId });

/** The fixture's temporary roots per world, removed by `close`. */
const extraRoots = new WeakMap<S6B3World, string[]>();

function rootsOf(world: S6B3World): string[] {
  let roots = extraRoots.get(world);
  if (roots === undefined) { roots = []; extraRoots.set(world, roots); }
  return roots;
}

/** A route the tree does not publish yet: named at call time with the wave that brings it. */
function requireRoute(suffix: string, wave: string): void {
  if (!(suffix in CORE_ROUTE_SPECS)) throw new Error(`S6B3: ${suffix} is not published yet (${wave})`);
}

async function postValue<T>(world: S6B3World, suffix: string, body: unknown,
  status: 'ready' | 'committed' | 'completed', what: string): Promise<T> {
  return valueOf<T>((await world.host.post(suffix, body)).body, status, what);
}

async function registrationOf(world: S6B3World, scope: { projectId: string; workspaceId: string }) {
  return await postValue<{ project: { revision: number }; workspace: { revision: number } }>(world,
    'workspaces/registration', plain(scope, scope), 'ready', 'the workspace registration');
}

/** A Goal through the existing cards step, answered by the public Goal read so a caller has the whole snapshot. */
async function createS6B3Goal(world: S6B3World, scope: { projectId: string; workspaceId: string }, goalId: string,
  objective: string): Promise<GoalSnapshot> {
  await s6aCardsWorkspace(world.host, scope).createGoal(goalId, objective);
  const ref: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId };
  return (await readS6B3Goal(world, scope, ref)).goal;
}

async function readS6B3Goal(world: S6B3World, scope: { projectId: string; workspaceId: string }, goalRef: GoalRef) {
  return await postValue<{ goal: GoalSnapshot }>(world, 'goals/read', plain(scope, goalRef),
    'ready', `the Goal ${goalRef.goalId}`);
}

/** The scope's published secretary profile: the one whose Session role is the platform secretary template. */
async function secretaryProfileOf(world: S6B3World, scope: { projectId: string; workspaceId: string }):
Promise<BootstrapExecutionQueryProfile> {
  const profile = (await world.host.readProfiles()).find(candidate => sameScope(candidate.scope, scope)
    && candidate.sessionRole.kind === 'legacy_template'
    && candidate.sessionRole.templateId === S6A_SECRETARY_ROLE.templateId
    && candidate.sessionRole.templateRevision === S6A_SECRETARY_ROLE.templateRevision);
  if (profile === undefined) throw new Error(`S6B3: the scope ${scope.workspaceId} publishes no secretary profile`);
  return profile;
}

async function readSessionIn(world: S6B3World, scope: { projectId: string; workspaceId: string },
  ref: { projectId: string; sessionId: string }): Promise<S6ASession & { revision: number }> {
  const card = await postValue<{ record: { ref: S6ASession['aggregateRef']; revision: number; role: S6ASession['role'];
    createdAt: string } }>(world, 'sessions/read', plain(scope, ref), 'ready', `the Session ${ref.sessionId}`);
  return { label: ref.sessionId, ref: { projectId: ref.projectId, sessionId: ref.sessionId },
    aggregateRef: card.record.ref, role: card.record.role, createdAt: card.record.createdAt,
    revision: card.record.revision };
}

/** `sessions/create` in `scope` with the profile's Session role; answers the real card read back. */
async function createLine(world: S6B3World, scope: { projectId: string; workspaceId: string },
  profile: BootstrapExecutionQueryProfile, label: string): Promise<S6ASession & { revision: number }> {
  const created = await postValue<{ ref: S6ASession['aggregateRef'] }>(world, 'sessions/create',
    plain(scope, { workspace: scope, role: profile.sessionRole, recommendedRefs: [], initialLinks: [],
      meta: { requestId: `s6b3-line-${label}`, expected: [] } }), 'completed', `the line ${label}`);
  return await readSessionIn(world, scope, { projectId: created.ref.projectId, sessionId: created.ref.sessionId });
}

// ---------------------------------------------------------------------------
// Step 1: the world
// ---------------------------------------------------------------------------

/** Open the one explicitly scoped Host world: no Goal in the main workspace and the fixture's own settings path.
 *  `actor` is the Host's HTTP actor (default the human operator), so a row can post as a non-person Host.
 *  `staticChecks` is the operator's static `checks` Host option (the CLI config's), so the main scope has a fallback. */
export async function openS6B3World(
  options: { backend: S6ABackend; mainGoals?: 'none'; actor?: WorkbenchActor; staticChecks?: true }): Promise<S6B3World> {
  const settingsDirectory = await mkdtemp(join(tmpdir(), 's6b3-settings-'));
  let host: S6AHostWorld;
  try {
    host = await openS6AHostWorld({
      backend: options.backend,
      defaultGoals: false,
      ...(options.actor === undefined ? {} : { actor: options.actor }),
      extraHostOptions: { settings: { settingsDirectory }, ...(options.staticChecks === true
        ? { checks: ag2bChecksConfiguration({ actor: OPERATOR, command: 'node --test' }) } : {}) },
    });
  } catch (error) {
    await rm(settingsDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  let closed = false;
  const world: S6B3World = {
    host,
    mainScope: S6A_SCOPE,
    settingsDirectory,
    instanceSeq: { current: 1 },
    held: [],
    async close() {
      if (closed) return;
      closed = true;
      const roots = rootsOf(world);
      const failures: unknown[] = [];
      for (const held of world.held.splice(0)) {
        try { held.release(); await held.done; } catch (error) { failures.push(error); }
      }
      // A gate whose commit never arrived is in no held entry; the reset disarms it before a later world opens.
      commitBarrier.reset();
      try { await host.close(); } catch (error) { failures.push(error); }
      for (const root of roots.splice(0)) {
        try { await rm(root, { recursive: true, force: true }); } catch (error) { failures.push(error); }
      }
      try { await rm(settingsDirectory, { recursive: true, force: true }); } catch (error) { failures.push(error); }
      extraRoots.delete(world);
      if (failures.length > 0) throw new AggregateError(failures, 'S6B3 world cleanup failed');
    },
  };
  extraRoots.set(world, []);
  return world;
}

// ---------------------------------------------------------------------------
// Step 2: the second workspace
// ---------------------------------------------------------------------------

/** Open the second workspace through the Host's real settings route and create its two Goals through `goals/create`. */
export async function configureS6B3SecondWorkspace(world: S6B3World,
  input: { name: string; goals: 2 }): Promise<S6B3Workspace> {
  const root = await mkdtemp(join(tmpdir(), 's6b3-workspace-'));
  rootsOf(world).push(root);
  return await openSecond(world, root, input.name);
}

async function openSecond(world: S6B3World, root: string, name: string): Promise<S6B3Workspace> {
  const settings = await world.host.settings('snapshot', {});
  if (settings.status !== 'ready') throw new Error(`S6B3: the Host settings snapshot is not ready: ${JSON.stringify(settings)}`);
  const model = settings.value.models[0];
  if (model === undefined) throw new Error('S6B3: the Host settings publish no model');
  const opened = await world.host.settings('workspaces/open', {
    path: root, name, projectId: world.mainScope.projectId, modelId: model.id,
    writeAllowed: true, commandsAllowed: true,
  });
  if (opened.status !== 'ready') throw new Error(`S6B3: workspaces/open was refused: ${JSON.stringify(opened)}`);
  const scope = { projectId: opened.value.scope.projectId, workspaceId: opened.value.scope.workspaceId };
  await world.host.settleDetached();
  const profile = await secretaryProfileOf(world, scope);
  const goals: GoalSnapshot[] = [];
  for (let index = 0; index < 2; index += 1) {
    goals.push(await createS6B3Goal(world, scope, `s6b3-goal-${name}-${String(index + 1)}`,
      `S6B3 ${name} goal ${String(index + 1)}`));
  }
  return { scope, goals, profile };
}

// ---------------------------------------------------------------------------
// The shared public request path (steps 3, 5 and 6)
// ---------------------------------------------------------------------------

const PLAN_BODY = {
  schemaVersion: 2, stages: [],
  tasks: [{
    taskId: 's6b3-initial-work', title: 'Initial work',
    requirementLevel: 'required', taskKind: 'work',
    disposition: 'active', phase: 'pending',
    scope: { kind: 'goal' }, executionIntent: 'plan_only',
  }],
  obligations: [], taskHierarchy: { parentOf: [] },
  executionDag: { dependsOn: [] },
} as const;

/** The model's two goal-card drafts: proposals only, generated here as the scripted reply's content. */
function draftsOf(label: string, count: number, screening: GoalScreeningV1 | null): GoalCardDraftV1[] {
  return Array.from({ length: count }, (_, index) => ({
    objective: `S6B3 ${label} draft ${String(index + 1)}`,
    completion: [`S6B3 ${label} criterion ${String(index + 1)}`],
    autonomy: index === 0 ? 'every_step' : 'after_plan_confirmation',
    screening: index === 0 ? screening : null,
  }));
}

/** The saved answer of a released round: both refs and the answer text the start route returned. */
function answerOf(start: Record<string, unknown>, what: string): {
  answerRef: QueryJobAnswerRef; answerText: string;
} {
  if (start['status'] !== 'ready') throw new Error(`S6B3: ${what} is not ready: ${JSON.stringify(start)}`);
  const value = asRecord(start['value']);
  const answer = value['answer'];
  if (!isRecord(answer)) throw new Error(`S6B3: ${what} ended without a saved answer: ${JSON.stringify(start)}`);
  const answerRef = answer['ref'] as QueryJobAnswerRef | undefined;
  const formal = asRecord(answer['answer']);
  if (answerRef === undefined || typeof formal['answer'] !== 'string') {
    throw new Error(`S6B3: ${what} carries no complete answer: ${JSON.stringify(answer)}`);
  }
  return { answerRef, answerText: formal['answer'] };
}

async function readQueryIn(world: S6B3World, scope: { projectId: string; workspaceId: string }, round: QueryJobRef):
Promise<QueryJobRecord> {
  return await postValue<QueryJobRecord>(world, 'queries/read', plain(scope, round), 'ready', 'the Query read');
}

async function readManifest(world: S6B3World, scope: { projectId: string; workspaceId: string },
  prepared: PreparedQueryExecution): Promise<PreparedQueryManifestV1> {
  const opened = await postValue<{ body: string }>(world, 'materials/open',
    plain(scope, { ref: prepared.bundleRef, usage: 'historical_explanation' }), 'ready', 'the frozen manifest');
  return JSON.parse(opened.body) as PreparedQueryManifestV1;
}

type S6B3ExecutionKind = NonNullable<PreparedQueryManifestV1['request']>['executionKind'];

type HeldInput = {
  scope: { projectId: string; workspaceId: string };
  label: string;
  goalId: string | null;
  reply(manifest: PreparedQueryManifestV1): ScriptedReply;
  /** The kind the frozen manifest must carry on a second scope; `initial_coordination` when absent. */
  executionKind?: S6B3ExecutionKind;
  /** A real post-release read on the prepared value (step 6 checks the frozen manifest). */
  after?(prepared: PreparedQueryExecution): Promise<void>;
};

/**
 * The one unexported public request path: `requests/submit` → the secretary claim → `queries/prepare` → the frozen
 * manifest → the scripted reply → `queries/start`, held at the scope's gate. The main scope reuses the frozen
 * `holdS6BRequestRound` (its model gate); any other scope runs the same five routes with its own scope and profile,
 * because that helper pins `S6A_SCOPE`. The second scope holds the real start commit: the frozen model gate reads
 * its Session through the main scope, so a second-scope Session cannot be armed there.
 */
async function holdAnswer(world: S6B3World, input: HeldInput): Promise<S6B3Held> {
  const host = world.host;
  const main = sameScope(input.scope, world.mainScope);
  const id = `s6b3-round-${input.label}`;
  let start: Promise<unknown>;
  let prepared: PreparedQueryExecution;
  let gate: S6AGate<unknown>;
  let request: S6B3Held['request'];

  if (main) {
    const reached = deferred<void>();
    const open = deferred<void>();
    let captured: { request: S6B3Held['request']; prepared: PreparedQueryExecution } | null = null;
    const running = holdS6BRequestRound(host, {
      label: input.label, goalId: input.goalId, replies: manifest => [input.reply(manifest) as S6AReply],
    }, async round => {
      captured = {
        request: { requestRoot: round.request.requestRoot, round: round.request.round, secretary: round.request.secretary },
        prepared: round.prepared,
      };
      reached.resolve();
      await open.promise;
    }).then(result => result.started);
    running.catch(() => undefined);
    world.held.push({ release: () => open.resolve(), done: running });
    const endedFirst = running.then(body => {
      throw new Error(`S6B3: the round ended before its model gate: ${JSON.stringify(body)}`);
    });
    endedFirst.catch(() => undefined);
    gate = { label: `S6B3 model gate ${input.label}`, reached: Promise.race([reached.promise, endedFirst]),
      release: () => open.resolve() };
    await gate.reached;
    const taken = captured as { request: S6B3Held['request']; prepared: PreparedQueryExecution } | null;
    if (taken === null) throw new Error('S6B3: the main-scope round reached no capture');
    request = taken.request;
    prepared = taken.prepared;
    start = running;
  } else {
    const profile = await secretaryProfileOf(world, input.scope);
    const line = await createLine(world, input.scope, profile, input.label);
    const submitted = await s6aCardsWorkspace(host, input.scope).submit({ label: id, goalId: input.goalId,
      text: `S6B3 round ${input.label}`, recipient: line.ref });
    const query = await readQueryIn(world, input.scope, submitted.round);
    const claimProfile = await claimProfileOf(host, profile.id);
    const claimed = asRecord((await host.post('queries/claim', graphWrite(input.scope, {
      queryRunRef: query.run.ref, sessionRef: line.ref, profile: claimProfile,
    }, `${id}-claim`, [
      { ref: query.job.ref, revision: query.job.revision },
      { ref: query.run.ref, revision: query.run.revision },
      { ref: line.aggregateRef, revision: line.revision },
    ]))).body);
    if (claimed['status'] !== 'committed') throw new Error(`S6B3: the secretary claim was refused: ${JSON.stringify(claimed)}`);
    prepared = await postValue<PreparedQueryExecution>(world, 'queries/prepare',
      plain(input.scope, { queryRunRef: query.run.ref, requestId: `${id}-prepare` }), 'ready', 'the preparation');
    const manifest = await readManifest(world, input.scope, prepared);
    const kind = input.executionKind ?? 'initial_coordination';
    if (manifest.request === null || manifest.request.executionKind !== kind) {
      throw new Error(`S6B3: the round's manifest is not a ${kind} request: ${JSON.stringify(manifest.request)}`);
    }
    host.scriptReplies([input.reply(manifest)]);
    const startGate = host.gates.beforeStart(line, submitted.round);
    const started = host.post('queries/start', plain(input.scope, { prepared, consumerId: AG2B_CONSUMER_ID,
      requestId: `${id}-start` })).then(answer => answer.body);
    started.catch(() => undefined);
    const endedFirst = started.then(body => {
      throw new Error(`S6B3: the round ended before its start commit: ${JSON.stringify(body)}`);
    });
    endedFirst.catch(() => undefined);
    await Promise.race([startGate.reached, endedFirst]);
    world.held.push({ release: () => startGate.release(), done: started });
    gate = startGate;
    start = started;
    request = { requestRoot: submitted.requestRoot, round: submitted.round, secretary: submitted.secretary };
  }

  let released = false;
  return {
    request, round: request.round, gate,
    async release() {
      if (released) throw new Error('S6B3: the held round was already released');
      released = true;
      gate.release();
      const body = asRecord(await start);
      answerOf(body, `the round ${input.label}`);
      if (input.after !== undefined) await input.after(prepared);
      return body;
    },
  };
}

/**
 * A request round on a granted scope, held at its gate like steps 3, 5 and 6, whose kind the scope's governance
 * decides: on a second scope `executionKind` names the kind the frozen manifest must carry (a `semantic_query` once
 * governance is installed). `reply` builds the scripted answer from the frozen manifest; nothing else is composed.
 */
export async function holdS6B3RequestAnswer(world: S6B3World, input: {
  scope: { projectId: string; workspaceId: string };
  label: string;
  goalId: string | null;
  executionKind: S6B3ExecutionKind;
  reply(manifest: PreparedQueryManifestV1): ScriptedReply;
}): Promise<S6B3Held> {
  return holdAnswer(world, input);
}

/** A no-goal `initial_coordination` answer with two drafts, the optional screening and the named plan draft. */
export async function holdS6B3DraftAnswer(world: S6B3World, input: {
  scope: { projectId: string; workspaceId: string };
  label: string;
  drafts: 2;
  screening?: GoalScreeningV1;
  planDraftIndex?: number;
  setup?: InitialPlanningSetupV2;
}): Promise<S6B3Held> {
  const index = input.planDraftIndex ?? 0;
  return await holdAnswer(world, {
    scope: input.scope, label: input.label, goalId: null,
    reply: () => ({ kind: 'text', text: JSON.stringify({
      schemaVersion: 2, kind: 'plan', summary: `S6B3 ${input.label} coordination`, plan: PLAN_BODY,
      goalCardDrafts: draftsOf(input.label, 2, input.screening ?? null), planDraftIndex: index,
      ...(input.setup === undefined ? {} : { setup: input.setup }),
    }) }),
  });
}

// ---------------------------------------------------------------------------
// Step 4: release and the two reads
// ---------------------------------------------------------------------------

const sameJob = (left: QueryJobRef, right: QueryJobRef) =>
  left.projectId === right.projectId && left.workspaceId === right.workspaceId
  && left.queryJobId === right.queryJobId;

/** The draft's `confirmedGoalRef` as the view carried it now; absent is null. */
function confirmedGoalRefOf(entry: Record<string, unknown>): GoalRef | null {
  const value = entry['confirmedGoalRef'];
  if (value === undefined || value === null) return null;
  const problem = checkShape(GoalRefShape, value, 'stored');
  if (problem !== null) throw new Error(`S6B3: the draft confirmedGoalRef is invalid: ${problem}`);
  return value as GoalRef;
}

/**
 * Release the held answer, await the terminal `queries/start`, then read the saved answer through `queries/read`
 * and the drafts through `requests/read`. Each draft is a property of the returned view, never built here.
 */
export async function releaseS6B3DraftAnswer(world: S6B3World, held: S6B3Held): Promise<{
  answerRef: QueryJobAnswerRef;
  answerText: string;
  drafts: readonly S6B3Draft[];
}> {
  const started = asRecord(await held.release());
  const { answerRef, answerText } = answerOf(started, `the round ${held.round.queryJobId}`);
  const scope = scopeOfQuery(held.round);
  const query = await readQueryIn(world, scope, held.round);
  if (query.run.run.outcome !== 'answered') {
    throw new Error(`S6B3: the round ${held.round.queryJobId} is not answered: ${JSON.stringify(query.run.run)}`);
  }
  const view = await postValue<RequestReadV1>(world, 'requests/read',
    plain(scope, { requestRoot: held.request.requestRoot }), 'ready', 'the request view');
  const round = view.rounds.find(entry => sameJob(entry.ref, held.round));
  if (round === undefined) throw new Error(`S6B3: the request view does not list the round ${held.round.queryJobId}`);
  const drafts = round.goalCardDrafts.map(entry => ({
    index: entry.index,
    objective: entry.draft.objective,
    completion: [...entry.draft.completion],
    autonomy: entry.draft.autonomy,
    screening: entry.draft.screening ?? null,
    confirmedGoalRef: confirmedGoalRefOf(asRecord(entry)),
  }));
  return { answerRef, answerText, drafts };
}

// ---------------------------------------------------------------------------
// Step 5: the needs_decision answer, the two confirmations and the question keys
// ---------------------------------------------------------------------------

/** The same shared public request path with a `needs_decision` body and two drafts; the held gate. */
export async function holdS6B3NeedsDecisionAnswer(world: S6B3World, input: {
  scope: { projectId: string; workspaceId: string };
  drafts: 2;
}): Promise<S6B3Held> {
  return await holdAnswer(world, {
    scope: input.scope, label: `needs-${input.scope.workspaceId}`, goalId: null,
    reply: () => ({ kind: 'text', text: JSON.stringify({
      schemaVersion: 2, kind: 'needs_decision', summary: 'S6B3 needs a decision',
      questions: ['S6B3 first question', 'S6B3 second question'],
      goalCardDrafts: draftsOf('needs', 2, null),
    }) }),
  });
}

const sameGoalRef = (left: GoalRef, right: GoalRef) =>
  left.projectId === right.projectId && left.goalId === right.goalId;

/** The planning-question card keys the decision queue lists for the named Goals, after the two confirmations. */
export async function readS6B3DecisionQuestionKeys(world: S6B3World, input: {
  scope: { projectId: string; workspaceId: string };
  goals: readonly GoalRef[];
}): Promise<readonly string[]> {
  const queue = await postValue<DecisionQueueReadV1>(world, 'decisions/queue', plain(input.scope, {
    workspace: input.scope, sections: ['waiting_answer'], page: { limit: 100 },
  }), 'ready', 'the decision queue');
  const keys: string[] = [];
  for (const card of queue.waitingAnswer) {
    if (card.source.kind !== 'planning_question') continue;
    const subject = card.source.subject;
    if (subject.kind !== 'goal') continue;
    const goalRef = subject.goalRef;
    if (!input.goals.some(goal => sameGoalRef(goal, goalRef))) continue;
    keys.push(card.source.key);
  }
  return keys;
}

/**
 * Release the needs_decision answer, make the two `goals/confirm-draft` calls (one per draft) and only then read
 * the question keys from the decision queue, filtered to the two Goals the confirmations created.
 */
export async function confirmS6B3NeedsDecisionDrafts(world: S6B3World, held: S6B3Held): Promise<{
  goals: readonly GoalRef[];
  questionKeys: readonly string[];
}> {
  const started = asRecord(await held.release());
  answerOf(started, `the round ${held.round.queryJobId}`);
  const scope = scopeOfQuery(held.round);
  const goals: GoalRef[] = [];
  for (const index of [0, 1]) {
    requireRoute('goals/confirm-draft', '6b3-w3');
    const request: GoalConfirmDraftInputV1 = {
      commandId: `s6b3-confirm-${held.round.queryJobId}-${String(index)}`, round: held.round, index,
    };
    const value = await postValue<{ goal: GoalSnapshot }>(world, 'goals/confirm-draft',
      plain(scope, request), 'committed', `the draft confirmation ${String(index)}`);
    goals.push(value.goal.ref);
  }
  return { goals, questionKeys: await readS6B3DecisionQuestionKeys(world, { scope, goals }) };
}

// ---------------------------------------------------------------------------
// Step 6: the goal request's prepared_goal answer
// ---------------------------------------------------------------------------

/**
 * A goal request's `initial_coordination` answer through the same public path: the frozen manifest names the
 * prepared Goal, and `setup` is the answer's own setup proposal (the only source L's adoption later installs).
 * After release the step reads `materials/open` again and checks the manifest's request kind and Goal.
 */
export async function holdS6B3PreparedGoalAnswer(world: S6B3World, input: {
  scope: { projectId: string; workspaceId: string };
  goal: GoalRef;
  /** The setup proposal the real adoption later installs; the answer is its only source. */
  setup?: InitialPlanningSetupV2;
}): Promise<S6B3Held> {
  return await holdAnswer(world, {
    scope: input.scope, label: `prepared-${input.goal.goalId}`, goalId: input.goal.goalId,
    reply: () => ({ kind: 'text', text: JSON.stringify({
      schemaVersion: 2, kind: 'plan', summary: `S6B3 ${input.goal.goalId} prepared goal`, plan: PLAN_BODY,
      ...(input.setup === undefined ? {} : { setup: input.setup }),
    }) }),
    after: async prepared => {
      const manifest = await readManifest(world, input.scope, prepared);
      if (manifest.request?.executionKind !== 'initial_coordination') {
        throw new Error(`S6B3: the prepared manifest is not an initial_coordination request: ${JSON.stringify(manifest.request)}`);
      }
      if (manifest.goal === null || !sameGoalRef(manifest.goal.ref, input.goal)) {
        throw new Error(`S6B3: the prepared manifest names another Goal: ${JSON.stringify(manifest.goal)}`);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Step 7: the explicit public planning Query
// ---------------------------------------------------------------------------

/**
 * One planning Query for `goalRef` through the public routes: `queries/submit` → `queries/claim` on a line of the
 * scope's secretary profile → `queries/prepare` → the scripted v2 answer → `queries/start` → `queries/read`.
 */
export async function runS6B3PlanningQuery(world: S6B3World, input: {
  scope: { projectId: string; workspaceId: string };
  goalRef: GoalRef;
  label: string;
}): Promise<{ round: QueryJobRef; answerRef: QueryJobAnswerRef; answerText: string }> {
  const profile = await secretaryProfileOf(world, input.scope);
  const line = await createLine(world, input.scope, profile, `planning-${input.label}`);
  const goal = await readS6B3Goal(world, input.scope, input.goalRef);
  const registration = await registrationOf(world, input.scope);
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', ...input.scope,
    queryJobId: `s6b3-planning-${input.label}` };
  const queryRunRef = { aggregateType: 'QueryRun', ...input.scope, queryJobId: queryJobRef.queryJobId,
    runId: `s6b3-planning-run-${input.label}` } as const;
  const intent = {
    schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId: input.scope.projectId,
    workspaceId: input.scope.workspaceId, goalId: input.goalRef.goalId, question: `S6B3 planning ${input.label}`,
    focusTaskRefs: [], budget: profile.budget, multiTurn: { maxRounds: 1 },
    correlationId: `s6b3-planning-corr-${input.label}`,
    execution: { kind: 'initial_coordination', roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget },
  };
  await postValue<QueryJobRecord>(world, 'queries/submit',
    graphWrite(input.scope, { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent },
      `s6b3-planning-submit-${input.label}`, [
        { ref: { aggregateType: 'Project', projectId: input.scope.projectId }, revision: registration.project.revision },
        { ref: { aggregateType: 'Workspace', ...input.scope }, revision: registration.workspace.revision },
        { ref: input.goalRef, revision: goal.goal.revision },
        { ref: queryJobRef, revision: 0 },
        { ref: queryRunRef, revision: 0 },
      ]), 'committed', `the planning Query ${input.label}`);
  const query = await readQueryIn(world, input.scope, queryJobRef);
  await postValue<unknown>(world, 'queries/claim', graphWrite(input.scope, {
    queryRunRef: query.run.ref, sessionRef: line.ref,
  }, `s6b3-planning-claim-${input.label}`, [
    { ref: query.job.ref, revision: query.job.revision },
    { ref: query.run.ref, revision: query.run.revision },
    { ref: line.aggregateRef, revision: line.revision },
  ]), 'committed', `the planning claim ${input.label}`);
  const prepared = await postValue<PreparedQueryExecution>(world, 'queries/prepare',
    plain(input.scope, { queryRunRef: query.run.ref, requestId: `s6b3-planning-prepare-${input.label}` }),
    'ready', `the planning preparation ${input.label}`);
  world.host.scriptReplies([{ kind: 'text', text: JSON.stringify({
    schemaVersion: 2, kind: 'needs_decision', summary: `S6B3 planning ${input.label}`,
    questions: [`S6B3 planning question ${input.label}`],
  }) }]);
  const started = asRecord((await world.host.post('queries/start', plain(input.scope, {
    prepared, consumerId: AG2B_CONSUMER_ID, requestId: `s6b3-planning-start-${input.label}`,
  }))).body);
  const { answerRef, answerText } = answerOf(started, `the planning Query ${input.label}`);
  const read = await readQueryIn(world, input.scope, queryJobRef);
  if (read.run.run.outcome !== 'answered') {
    throw new Error(`S6B3: the planning Query ${input.label} is not answered: ${JSON.stringify(read.run.run)}`);
  }
  return { round: queryJobRef, answerRef, answerText };
}

// ---------------------------------------------------------------------------
// Step 8: the cancelled Goal with its real understanding
// ---------------------------------------------------------------------------

/**
 * A Goal through `goals/create`, its real understanding through `notes/write` while the Goal is active, its settings,
 * then cancellation through `goals/control`; the understanding is read back through `notes/list`, never the pointer.
 */
export async function seedS6B3CancelledGoal(world: S6B3World, input: {
  scope: { projectId: string; workspaceId: string };
  settings: { autonomy: GoalAutonomyV1 };
  understanding: { topic: string; conclusion: string; sections: NoteSectionsV1 };
}): Promise<{
  goal: GoalSnapshot;
  cancelledRevision: number;
  understanding: { noteId: string; version: number; text: string };
}> {
  const goal = await createS6B3Goal(world, input.scope, `s6b3-cancelled-${randomUUID()}`,
    `S6B3 ${input.understanding.conclusion}`);
  const noteBody = (await world.host.post('notes/write', plain(input.scope, {
    commandId: `s6b3-understanding-${randomUUID()}`,
    note: {
      kind: 'understanding', topic: input.understanding.topic, conclusion: input.understanding.conclusion,
      anchor: { kind: 'goal', goalId: goal.ref.goalId }, extraAnchors: [], facts: [], basisFiles: [],
      structural: false, replaces: [], contradicts: [], coexistWith: [], sections: input.understanding.sections,
    },
    // The Goal was created a moment ago, so no understanding pointer exists for it yet (null = none stored).
    expectedPointerRevision: null, goalId: goal.ref.goalId,
  }))).body as WriteNoteEnvelopeV1;
  const written = noteBody.write;
  if (written.status !== 'accepted') {
    throw new Error(`S6B3: the Goal understanding was not accepted: ${JSON.stringify(written)}`);
  }
  const noteId = written.noteId;
  const version = written.version;
  const withSettings = await postValue<GoalSnapshot>(world, 'goals/settings/set', graphWrite(input.scope, {
    goalRef: goal.ref, autonomy: input.settings.autonomy, waitForGoalRef: null,
  }, `s6b3-settings-${randomUUID()}`, [{ ref: goal.ref, revision: goal.revision }]), 'committed', 'the Goal settings');
  const outcome = await postValue<{ goal: GoalSnapshot }>(world, 'goals/control', graphWrite(input.scope, {
    goalRef: goal.ref, control: 'cancel', reason: 'S6B3 cancelled Goal',
  }, `s6b3-cancel-${randomUUID()}`, [
    { ref: goal.ref, revision: withSettings.revision },
    { ref: { aggregateType: 'GoalPhase', projectId: goal.ref.projectId, goalId: goal.ref.goalId }, revision: 0 },
  ]), 'committed', 'the Goal cancellation');
  const cancelled = outcome.goal;
  const listed = await postValue<NoteListResultV1>(world, 'notes/list', plain(input.scope, {
    anchor: { kind: 'goal', goalId: goal.ref.goalId }, state: 'accepted', limit: 100, cursor: null,
  }), 'ready', 'the Goal notes');
  const item = listed.items.find(candidate => candidate.noteId === noteId && candidate.version === version);
  if (item === undefined) throw new Error(`S6B3: the understanding ${noteId}@${String(version)} is not listed`);
  return {
    goal: cancelled, cancelledRevision: cancelled.revision,
    understanding: { noteId: item.noteId, version: item.version, text: item.conclusion },
  };
}

// ---------------------------------------------------------------------------
// Steps 9-11: the one commit-gate shell
// ---------------------------------------------------------------------------

/** What a gate's `use` may do while the real commit is held: act on the world, or let the commit through. */
type GateUse = (world: S6B3World, cancel: () => void) => void | Promise<void>;

/**
 * The shell behind steps 9, 10, 11 and 17: arm the commit barrier on the step's own predicate — before the real commit
 * runs, or (`after-commit`) after it ran and before its answer returns — run `use` while it is held, then release in
 * `finally`. The held commit never leaves this function — `use` gets the world and the cancel that lets the commit
 * through early, and nothing else — so a gate can only delay, never report.
 */
async function throughCommitGate(world: S6B3World, match: CommitMatch, label: string, use: GateUse,
  at: 'before-commit' | 'after-commit' = 'before-commit'): Promise<void> {
  const hold = at === 'before-commit' ? commitBarrier.hold(match, label) : commitBarrier.holdAfter(match, label);
  const cancel = (): void => { hold.release(); };
  try {
    await hold.reached;
    await use(world, cancel);
  } finally {
    hold.release();
  }
}

/**
 * The commit identity prefix of a command whose route and platform owner L publishes: the owner path and the route
 * are checked at call time, and the returned prefix is the command's own identity, never the owner's member name.
 */
function publishedCommandPrefix(world: S6B3World, route: string, ownerPath: string, identityPrefix: string): string {
  requireRoute(route, '6b3-w3');
  const [owner, member] = ownerPath.split('.') as [string, string];
  const platform = asRecord(world.host.platform as unknown as Record<string, unknown>);
  if (!(member in asRecord(platform[owner]))) {
    throw new Error(`S6B3: the ${ownerPath} command is not published yet (6b3-w3)`);
  }
  return identityPrefix;
}

/**
 * Step 9: the confirm command's commit held before it lands, after its basis read. `use` runs while the commit is
 * held; the gate returns no fact and is released in `finally`.
 */
export async function holdS6B3ConfirmGate(world: S6B3World, use: GateUse): Promise<void> {
  const prefix = publishedCommandPrefix(world, 'goals/confirm-draft', 'goals.confirmDraft', 'goal.confirmDraft:');
  await throughCommitGate(world, byIdentityPrefix(prefix), 'S6B3 confirm pre-commit gate', use);
}

/** The round's terminal commit: the one carrying its `QueryJobAnswered` event, read from the prepared commit. */
function answeredCommitOf(round: QueryJobRef): CommitMatch {
  return commit => commit.events.some(event => {
    if (event.eventType !== 'QueryJobAnswered') return false;
    let parsed: unknown;
    try { parsed = JSON.parse(event.json); } catch { return false; }
    const answer = asRecord(asRecord(parsed)['payload'])['answer'];
    const ref = asRecord(asRecord(answer)['ref']);
    return ref['queryJobId'] === round.queryJobId && ref['projectId'] === round.projectId
      && ref['workspaceId'] === round.workspaceId;
  });
}

/**
 * Step 10: the answer's terminal commit held while `use` runs. The match is the prepared commit's own
 * `QueryJobAnswered` event and the round its answer names; that commit carries no request-tail claim, and the
 * event's content is never handed out. Same shell as step 9.
 */
export async function holdS6B3AnswerTerminalGate(world: S6B3World, use: GateUse, round: QueryJobRef): Promise<void> {
  await throughCommitGate(world, answeredCommitOf(round), `S6B3 answer terminal gate ${round.queryJobId}`, use);
}

/**
 * Step 11: the copy's commit held after its understanding read, so a rewrite of the old understanding can land
 * between the read and the commit. Same shell as step 9.
 */
export async function holdS6B3CopyReadGate(world: S6B3World, use: GateUse): Promise<void> {
  const prefix = publishedCommandPrefix(world, 'goals/copy-confirm', 'goals.confirmGoalCopy', 'goal.copyConfirm:');
  await throughCommitGate(world, byIdentityPrefix(prefix), 'S6B3 copy read gate', use);
}

/**
 * A public route one of the later groups publishes: the route is looked up and the body is sent through the Host's
 * own `post` at call time, so an unpublished suffix is the stable named error. It composes no fact.
 */
export async function callS6B3LateRoute(world: S6B3World, suffix: string, wave: string, body: unknown):
Promise<unknown> {
  requireRoute(suffix, wave);
  return (await world.host.post(suffix, body)).body;
}

/**
 * A platform owner one of the later groups publishes, called in process as the Host's human operator bound to
 * `scope`, for a case an HTTP body cannot carry: the caller's own signal (an aborted one for a cancelled caller) or
 * the caller's own input object. The member is looked up at call time and started before this returns, so a change
 * the caller makes to its object afterwards is a change after the call; an unpublished member is the stable named
 * error. The owner's whole result envelope comes back; it composes no fact.
 */
export function callS6B3PublishedOwner(world: S6B3World, call: {
  owner: string; wave: string; scope: { projectId: string; workspaceId: string }; signal?: AbortSignal;
}, input: unknown): Promise<unknown> {
  return callPublishedOwnerAsHost(world.host, 'S6B3', call, input);
}

// ---------------------------------------------------------------------------
// Steps 12 and 13: the crash and the normal reopen
// ---------------------------------------------------------------------------

/** The live Host and platform of the world's current start, taken from the current getters. */
type S6B3HostHandle = { host: S6AHostWorld['host']; platform: S6AHostWorld['platform'] };

/** Ends the old instance's settings faults: every changed directory mode back, its arms out of the active table. */
async function endS6B3SettingsInstance(world: S6B3World): Promise<void> {
  await restoreS6B3SettingsModes();
  settingsWrapper.active.delete(world.settingsDirectory);
}

/**
 * Step 12: the crash. With a `hold` the named commit (the parent's) is awaited first, then the settings wrapper's
 * file modes are restored and the old instance's arms dropped, the instance token is bumped, and the Host's own
 * `crash()` abandons the live Host and starts a new one on the same directory. The new instances come from the
 * current getters; a test never reopens after this, and a commit this row still holds stays held for
 * `commitBarrier.reset()` at teardown. SQLite only. A `peer` of `'keeps-lease'` keeps the abandoned Host's live
 * lock, so the new Host is a second workbench on the same directory and starts `held_by_other` (HL-02).
 */
export async function crashS6B3Host(world: S6B3World,
  hold?: { readonly reached: Promise<unknown> }, peer?: 'keeps-lease'): Promise<S6B3HostHandle> {
  if (hold !== undefined) await hold.reached;
  await endS6B3SettingsInstance(world);
  world.instanceSeq.current += 1;
  await world.host.crash(peer === 'keeps-lease' ? { keepLease: true } : {});
  return { host: world.host.host, platform: world.host.platform };
}

/** Step 13: the normal close-and-reopen on the same file and settings directory; the new instances. */
export async function reopenS6B3Host(world: S6B3World): Promise<S6B3HostHandle> {
  await endS6B3SettingsInstance(world);
  await world.host.reopen();
  return { host: world.host.host, platform: world.host.platform };
}

// ---------------------------------------------------------------------------
// Step 14: the settings wrapper and one real checks save
// ---------------------------------------------------------------------------

/** The two named points a settings callback can fail or hang at; a persist failure is a real file fault instead. */
export type S6B3SettingsPoint = 'before-notify' | 'inside-notify';
/** What the one real `settings/checks/approve` save is asked to do. */
export type S6B3SettingsEffect = 'ok' | 'fail-persist' | 'fail-notify' | 'hang-notify';

type S6B3SettingsArm = {
  point: S6B3SettingsPoint;
  token: number;
  reached: Deferred<void>;
  gate: Deferred<void>;
  released: boolean;
};

/**
 * The module spy, the instance token of every settings directory (one per `createHostSettings` call, so per Host
 * start), the current instance's arms and — separately — every arm ever made, plus the modes a fault changed.
 */
const settingsWrapper = {
  spy: null as { mockRestore(): void } | null,
  tokens: new Map<string, number>(),
  active: new Map<string, Map<S6B3SettingsPoint, S6B3SettingsArm>>(),
  cleanup: new Set<S6B3SettingsArm>(),
  modes: new Map<string, number>(),
};

/**
 * The callbacks one settings port is built with: every real callback, with the notify one wrapped by its instance
 * token and the arms of that instance only.
 */
function settingsCallbacks(directory: string | undefined, real: HostSettingsCallbacks): HostSettingsCallbacks {
  if (directory === undefined) throw new Error('S6B3: the settings wrapper needs the fixture settings directory');
  const token = (settingsWrapper.tokens.get(directory) ?? 0) + 1;
  settingsWrapper.tokens.set(directory, token);
  const armed = (point: S6B3SettingsPoint): S6B3SettingsArm | undefined => {
    if (settingsWrapper.tokens.get(directory) !== token) return undefined;
    const arm = settingsWrapper.active.get(directory)?.get(point);
    return arm !== undefined && arm.token === token ? arm : undefined;
  };
  return {
    ...real,
    async onConfigurationChanged(snapshot) {
      const failing = armed('before-notify');
      if (failing !== undefined) {
        failing.reached.resolve();
        throw new Error('S6B3: the settings notify fails before the real callback');
      }
      const held = armed('inside-notify');
      if (held !== undefined) {
        held.reached.resolve();
        await held.gate.promise;
      }
      await real.onConfigurationChanged(snapshot);
    },
  };
}

/**
 * The one seam (no production option): wrap the real factory before the world opens, so every Host start's settings
 * port gets the fixture's callback. Returns the restore the row file's `finally` runs.
 */
export function installS6B3SettingsSpy(): () => void {
  if (settingsWrapper.spy !== null) throw new Error('S6B3: the settings wrapper is already installed');
  const real = hostSettingsModule.createHostSettings;
  const spy = vi.spyOn(hostSettingsModule, 'createHostSettings').mockImplementation(
    async (options, callbacks) => await real(options, settingsCallbacks(options.settingsDirectory, callbacks)));
  settingsWrapper.spy = spy;
  return () => {
    settingsWrapper.spy = null;
    spy.mockRestore();
  };
}

/**
 * Arm one named point on the current instance token. A second arm for the same point on the same instance is an
 * error, so a row cannot accumulate faults; `release` drops it from the active table and lets a held callback run
 * the real one, while the handle stays in the cleanup list until `disposeS6B3SettingsWrapper`.
 */
export function armS6B3SettingsFaults(world: S6B3World, point: S6B3SettingsPoint): {
  reached: Promise<void>; release(): void;
} {
  const directory = world.settingsDirectory;
  const token = settingsWrapper.tokens.get(directory);
  if (token === undefined) throw new Error('S6B3: no Host start captured a settings instance token for this world');
  const arms = settingsWrapper.active.get(directory) ?? new Map<S6B3SettingsPoint, S6B3SettingsArm>();
  if (arms.has(point)) {
    throw new Error(`S6B3: the settings point ${point} is already armed on instance ${String(token)}`);
  }
  const arm: S6B3SettingsArm = { point, token, reached: deferred(), gate: deferred(), released: false };
  arms.set(point, arm);
  settingsWrapper.active.set(directory, arms);
  settingsWrapper.cleanup.add(arm);
  return {
    reached: arm.reached.promise,
    release() {
      if (arm.released) return;
      arm.released = true;
      const table = settingsWrapper.active.get(directory);
      if (table?.get(point) === arm) table.delete(point);
      arm.gate.resolve();
    },
  };
}

/** The one real persist fault: the fixture's own settings directory loses write permission for this call. */
async function withReadOnlySettingsDirectory<T>(directory: string, run: () => Promise<T>): Promise<T> {
  settingsWrapper.modes.set(directory, (await stat(directory)).mode & 0o777);
  await chmod(directory, 0o500);
  try {
    return await run();
  } finally {
    await restoreS6B3SettingsModes();
  }
}

/**
 * Puts back every directory mode a fault changed, trying every directory and throwing once; the crash, the reopen
 * and the cleanup all come through here.
 */
async function restoreS6B3SettingsModes(): Promise<void> {
  const failures: unknown[] = [];
  for (const [directory, mode] of [...settingsWrapper.modes]) {
    try {
      await chmod(directory, mode);
      settingsWrapper.modes.delete(directory);
    } catch (error) { failures.push(error); }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'S6B3: the settings directory modes were not restored');
}

/**
 * Step 14's cleanup, before the world closes: release every old and new handle, empty both tables and restore every
 * directory mode, so no fault survives a test, a crash or a reopen.
 */
export async function disposeS6B3SettingsWrapper(): Promise<void> {
  for (const arm of settingsWrapper.cleanup) {
    arm.released = true;
    arm.gate.resolve();
  }
  settingsWrapper.cleanup.clear();
  settingsWrapper.active.clear();
  await restoreS6B3SettingsModes();
}

/** The armed point a row may let go itself (`hang-notify`), or nothing when the call was not held. */
export type S6B3SettingsHeld = { reached: Promise<void>; release(): void };

/** What step 14 answers: the direct approval's snapshot, or the adoption route's own answer for the narrow entry. */
export type S6B3SettingsSave =
  | { entry: 'approve'; done: Promise<SettingsResponse<HostSettingsSnapshot>>;
      held: S6B3SettingsHeld | null; release(): void }
  | { entry: 'narrow'; done: Promise<InitializationAdoptResultV1>; held: S6B3SettingsHeld | null; release(): void };

/** Step 14's two real inputs: the direct approval's exact check list, or J's entry on the Goal the answer serves. */
export type S6B3SettingsRequest =
  | { scope: { projectId: string; workspaceId: string }; answerRef: QueryJobAnswerRef; effect: S6B3SettingsEffect;
      entry?: 'approve'; checks: readonly RegisteredCommandCheck[] }
  | { scope: { projectId: string; workspaceId: string }; answerRef: QueryJobAnswerRef; effect: S6B3SettingsEffect;
      entry: 'narrow'; goal: GoalRef; commandId?: string };

/**
 * The one step 14 fault shell over either real call: arm the named point, then wait for whichever comes first — the
 * point, or the call's own end (a call that ends before its point is named, never waited on). A held arm is handed
 * to the row with `release`; every other path releases the arm and awaits the call before it answers.
 */
async function withS6B3SettingsFault<T>(world: S6B3World, effect: S6B3SettingsEffect, save: () => Promise<T>):
Promise<{ done: Promise<T>; held: S6B3SettingsHeld | null; release(): void }> {
  if (effect === 'fail-persist') {
    return { done: withReadOnlySettingsDirectory(world.settingsDirectory, save), held: null, release() {} };
  }
  if (effect === 'ok') return { done: save(), held: null, release() {} };
  const arm = armS6B3SettingsFaults(world, effect === 'fail-notify' ? 'before-notify' : 'inside-notify');
  const done = save();
  done.catch(() => undefined);
  world.held.push({ release: arm.release, done });
  let held: S6B3SettingsHeld | null = null;
  try {
    const ended = done.then(() => 'ended' as const, () => 'ended' as const);
    const first = await Promise.race([arm.reached.then(() => 'point' as const), ended]);
    if (first === 'ended') throw new Error(`S6B3: the settings call ended before its ${effect} point`);
    if (effect === 'hang-notify') held = arm;
  } finally {
    if (held === null) { arm.release(); await done.catch(() => undefined); }
  }
  return { done, held, release: arm.release };
}

/**
 * The narrow entry's real body: J's entry runs only inside L's `initialization.adopt`, so the body is the earlier
 * steps' own facts — a goal request's released answer (the `prepared_goal` source), the digest of its saved text
 * hashed here and the Goal read now — never an argument the fixture composes. An unpublished route is the named
 * error at call time.
 */
async function narrowAdoptBody(world: S6B3World, input: {
  scope: { projectId: string; workspaceId: string }; answerRef: QueryJobAnswerRef; goal: GoalRef; commandId?: string;
}): Promise<unknown> {
  requireRoute('initialization/adopt', '6b3-w3');
  const answer = await postValue<QueryJobAnswerSnapshot>(world, 'queries/answer',
    plain(input.scope, input.answerRef), 'ready', 'the saved answer');
  const goal = await readS6B3Goal(world, input.scope, input.goal);
  return plain(input.scope, {
    commandId: input.commandId ?? `s6b3-adopt-${input.answerRef.queryJobId}`,
    source: { kind: 'prepared_goal', answerRef: input.answerRef },
    expectedAnswerDigest: sha256Hex(answer.answer.answer),
    expectedGoal: { ref: goal.goal.ref, revision: goal.goal.revision },
  });
}

/**
 * Step 14: one real settings write on the granted workspace, through the direct `settings/checks/approve` route or
 * (entry `narrow`) through L's `initialization/adopt`, whose checks stage runs J's entry. `ok` installs through the
 * Host's own `installFromSettings`; `fail-notify` throws before the real callback (saved, not installed);
 * `hang-notify` holds the real callback until `release()`; `fail-persist` is the real file fault. The call's own
 * answer is returned unchanged, and nothing a row does not hold survives the step.
 */
export async function settingsWithChecks(world: S6B3World, input: S6B3SettingsRequest): Promise<S6B3SettingsSave> {
  if (input.effect !== 'ok' && settingsWrapper.spy === null) {
    throw new Error('S6B3: install the settings wrapper before the world opens');
  }
  if (input.entry === 'narrow') {
    const body = await narrowAdoptBody(world, input);
    return { entry: 'narrow', ...await withS6B3SettingsFault(world, input.effect,
      async () => (await world.host.post('initialization/adopt', body)).body as InitializationAdoptResultV1) };
  }
  const body = { scope: input.scope, answerRef: input.answerRef, checks: [...input.checks] };
  return { entry: 'approve', ...await withS6B3SettingsFault(world, input.effect,
    async () => await world.host.settings('checks/approve', body)) };
}

// ---------------------------------------------------------------------------
// Step 15: the public reads after a reopen or a crash
// ---------------------------------------------------------------------------

/** The platform's binding owner at call time; L publishes it, and until then the read names the missing member. */
export function readS6B3BindingPort(world: S6B3World): InitializationBindingReadPort {
  const owner = (world.host.platform as unknown as Record<string, unknown>)['bindings'];
  if (owner === undefined) throw new Error('S6B3: platform.bindings is not published yet (6b3-w3)');
  return owner as InitializationBindingReadPort;
}

/**
 * Step 15: the reads a row takes after its reopen or crash, each its own call: the binding through both platform
 * lookups, the original answer through `queries/read` and its own text through `queries/answer`, the prepared
 * products through `materials/open`, the copied pin through `goals/read`, the fixed-version old text through the
 * public note read, and the new Goal's own understanding through `notes/list`. The platform member is taken at
 * call time, so a row sees the instance the current Host publishes.
 */
export async function readS6B3Materials(world: S6B3World, input: {
  scope: { projectId: string; workspaceId: string };
  goal: GoalRef;
  answerRef: QueryJobAnswerRef;
  bindingRef: InitializationBindingRef;
  noteId: string;
  version: number;
}): Promise<{
  bindingByAnswerDraft: InitializationBindingV1;
  bindingsByGoal: readonly InitializationBindingV1[];
  query: QueryJobRecord;
  answer: QueryJobAnswerSnapshot;
  prepared: PreparedQueryManifestV1;
  continuedFrom: GoalContinuationV1 | null;
  oldNote: NoteItemV1;
  newUnderstanding: readonly NoteItemV1[];
}> {
  const bindings = readS6B3BindingPort(world);
  const bindingByAnswerDraft = readReady(await bindings.readBindingByAnswerDraft(world.host.humanContext(), {
    answerRef: input.answerRef, draftIndex: input.bindingRef.draftIndex,
  }), 'the binding by answer and draft');
  const bindingsByGoal = readReady(await bindings.readBindingByGoal(world.host.humanContext(), {
    goalRef: input.goal,
  }), 'the bindings by Goal');
  const round: QueryJobRef = { aggregateType: 'QueryJob', projectId: input.answerRef.projectId,
    workspaceId: input.answerRef.workspaceId, queryJobId: input.answerRef.queryJobId };
  const query = await readQueryIn(world, input.scope, round);
  const answer = await postValue<QueryJobAnswerSnapshot>(world, 'queries/answer',
    plain(input.scope, input.answerRef), 'ready', 'the original answer');
  const bundle = query.run.run.executionState?.prepared?.bundleRef;
  if (bundle === undefined) throw new Error(`S6B3: the Query ${round.queryJobId} carries no prepared bundle`);
  const opened = await postValue<{ body: string }>(world, 'materials/open',
    plain(input.scope, { ref: bundle, usage: 'historical_explanation' }), 'ready', 'the prepared products');
  const goal = await readS6B3Goal(world, input.scope, input.goal);
  const oldNote = readReady(await world.host.platform.notes.readNote(world.host.humanContext(), {
    noteId: input.noteId, version: input.version,
  }), 'the old understanding');
  const listed = await postValue<NoteListResultV1>(world, 'notes/list', plain(input.scope, {
    anchor: { kind: 'goal', goalId: input.goal.goalId }, state: 'accepted', limit: 100, cursor: null,
  }), 'ready', 'the new Goal notes');
  return {
    bindingByAnswerDraft, bindingsByGoal, query, answer,
    prepared: JSON.parse(opened.body) as PreparedQueryManifestV1,
    continuedFrom: goal.goal.continuedFrom,
    oldNote,
    newUnderstanding: listed.items.filter(item => item.kind === 'understanding'),
  };
}

// ---------------------------------------------------------------------------
// Step 16: a follow-up on a main-scope request
// ---------------------------------------------------------------------------

/**
 * A follow-up on `requestRoot` in the main scope through `requests/submit` (`continues`, no recipient), which must
 * queue. With `answer: true` the same public path answers it: the secretary claim with its published profile →
 * `queries/prepare` → the frozen manifest → one draft-free scripted `needs_decision` reply with one question (an
 * `initial_coordination` answer with no goal and no draft carries no `planDraftIndex`) → `queries/start`, which must
 * end answered. Answers the follow-up round.
 */
export async function submitS6B3FollowUp(world: S6B3World, input: {
  requestRoot: QueryJobRef;
  commandId: string;
  answer: boolean;
}): Promise<QueryJobRef> {
  const id = input.commandId;
  const submitted = await world.host.submit({ commandId: id, goalId: null, text: `S6B3 follow-up ${id}`,
    continues: input.requestRoot, recipient: null });
  if (submitted.status !== 'queued') throw new Error(`S6B3: the follow-up ${id} was refused: ${JSON.stringify(submitted)}`);
  if (!input.answer) return submitted.round;
  if (submitted.secretary === null) throw new Error(`S6B3: the follow-up ${id} has no secretary`);
  const secretary = await readSessionIn(world, world.mainScope, submitted.secretary);
  const claimed = await claimWithSecretaryProfile(world.host, submitted.round, secretary, `${id}-claim`);
  if (claimed['status'] !== 'committed') throw new Error(`S6B3: the follow-up ${id} was not claimed: ${JSON.stringify(claimed)}`);
  const query = await readQueryIn(world, world.mainScope, submitted.round);
  const prepared = await postValue<PreparedQueryExecution>(world, 'queries/prepare',
    plain(world.mainScope, { queryRunRef: query.run.ref, requestId: `${id}-prepare` }), 'ready', 'the follow-up preparation');
  const manifest = await readManifest(world, world.mainScope, prepared);
  const summary = `S6B3 follow-up ${id}`;
  world.host.scriptReplies([{ kind: 'text', text: JSON.stringify(manifest.request?.executionKind === 'initial_coordination'
    ? { schemaVersion: 2, kind: 'needs_decision', summary, questions: [`${summary}: which approach?`] }
    : { schemaVersion: 1, body: summary, ideas: [], goalCardDrafts: [] }) }]);
  const started = await postValue<{ answer: unknown; run: { run: { status: string } } }>(world, 'queries/start',
    plain(world.mainScope, { prepared, consumerId: AG2B_CONSUMER_ID, requestId: `${id}-start` }),
    'ready', 'the follow-up start');
  if (started.answer === null || started.run.run.status !== 'answered') {
    throw new Error(`S6B3: the follow-up ${id} did not answer: ${JSON.stringify(started)}`);
  }
  return submitted.round;
}

// ---------------------------------------------------------------------------
// Steps 17-19: the adoption stage gate and the two store faults
// ---------------------------------------------------------------------------

/** The architecture owner's own adopt identity: this prefix, then the canonical key that names its request id. */
const ARCHITECTURE_ADOPT_PREFIX = 'architecture-catalog-adopt:';

function parsedJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

/**
 * The operation's own record in a stage write, read from the prepared commit: its last mark is `stage`, still open
 * (outcome null) in the before-write and carrying its outcome in the after-write.
 */
function adoptionStageMarkOf(operationRef: InitializationAdoptionRef, stage: InitializationAdoptStageV1,
  phase: 'before' | 'after'): CommitMatch {
  const refKey = canonicalKey(operationRef);
  return commit => commit.records.some(record => {
    if (record.refKey !== refKey) return false;
    const marks = asRecord(parsedJson(record.json))['stages'];
    const last = Array.isArray(marks) ? asRecord(marks.at(-1)) : {};
    return last['stage'] === stage && (last['outcome'] === null) === (phase === 'before');
  });
}

/**
 * Step 17: one stage boundary of a real adoption held while `use` runs. `after-before` holds the answer of the real
 * before-write after it landed; `after-child` holds the after-write before it lands, so the child has run and the
 * mark is still open; `after-after` holds the answer of the real after-write after it landed. Same shell as step 9.
 */
export async function holdS6B3AdoptionGate(world: S6B3World, input: {
  operationRef: InitializationAdoptionRef;
  stage: InitializationAdoptStageV1;
  point: 'after-before' | 'after-child' | 'after-after';
}, use: GateUse): Promise<void> {
  const phase = input.point === 'after-before' ? 'before' : 'after';
  const prefix = publishedCommandPrefix(world, 'initialization/adopt',
    phase === 'before' ? 'initializationAdoption.saveBefore' : 'initializationAdoption.saveAfter',
    'initialization.adoptAdvance:');
  const match = allOf(byIdentityPrefix(prefix), adoptionStageMarkOf(input.operationRef, input.stage, phase));
  const at = input.point === 'after-child' ? 'before-commit' : 'after-commit';
  await throughCommitGate(world, match, `S6B3 adoption ${input.stage} ${input.point} gate`, use, at);
}

/**
 * Step 18: the real `readMany` of one record (the adoption operation's or the saved answer's) throws an I/O error,
 * once or until released; `calls()` counts the reads of that record since the arm, so a row can prove a replay never
 * read it. `lookupCommit` and `eventAt` are never touched. The world's `close()` releases the arm.
 */
export function armS6B3ReadManyFault(world: S6B3World, input: {
  ref: InitializationAdoptionRef | QueryJobAnswerRef;
  effect: 'throw-once' | 'throw-always';
}): { calls(): number; release(): void } {
  const fault = commitBarrier.failReads(canonicalKey(input.ref), input.effect);
  world.held.push({ release: fault.release, done: Promise.resolve() });
  return fault;
}

/** The operation's architecture child: the owner's identity whose request id is the stage's P11 label. */
function architectureChildOf(operationRef: InitializationAdoptionRef): CommitMatch {
  return allOf(byIdentityPrefix(ARCHITECTURE_ADOPT_PREFIX), commit => {
    const identity = asRecord(parsedJson(commit.identityKey.slice(ARCHITECTURE_ADOPT_PREFIX.length)));
    return identity['projectId'] === operationRef.projectId
      && identity['idempotencyKey'] === `${operationRef.operationId}/architecture`;
  });
}

/**
 * Step 19: the operation's real architecture child commit throws one I/O error instead of landing; every other
 * commit is the real one. The world's `close()` releases the arm.
 */
export function armS6B3ChildCommitFault(world: S6B3World, input: {
  operationRef: InitializationAdoptionRef;
  stage: 'architecture';
  effect: 'throw-once';
}): { release(): void } {
  const fault = commitBarrier.failCommitOnce(architectureChildOf(input.operationRef));
  world.held.push({ release: fault.release, done: Promise.resolve() });
  return fault;
}

export { valueOf, readReady, postValue };
