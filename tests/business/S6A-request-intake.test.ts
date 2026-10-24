/**
 * Slice 6A-1 group M2: Workflow's `submit`/`route`/`selectIdea` over the request
 * round service, and the drain (book-6a §3.5, §3.12) on the frozen SE1 world.
 *
 * The intake is not wired into the Host until H, so the test builds the landed
 * ports itself. A4 (the backend seam): the two real backend factories are
 * wrapped to remember the one records port the Host's platform shares and to
 * apply `S6A-commit-barrier`'s holds; every result passes through unchanged.
 * The selection, line creation and request-round owners are the real ones.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { GoalRecordTransactionPort, PreparedCommit } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { SecretaryProfilePort, SecretaryProfileV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { createSessionDutyResolver } from '../../src/composition/session-duty.js';
import type { SessionOperationsPort } from '../../src/core/agent-runtime/session-operations.js';
import { createProjectSecretaryScope, createSecretarySelection } from '../../src/core/work-graph/tasks/secretary-selection.js';
import { createRequestFacts } from '../../src/core/work-graph/tasks/request-facts.js';
import {
  createRequestRoundService, REQUEST_TAIL_PREFIX, SECRETARY_INTAKE_PREFIX,
  type RequestFactsReader,
} from '../../src/core/work-graph/tasks/request-service.js';
import {
  createAlwaysAdmitCapacity, createLineCreation,
} from '../../src/business/workflow/line-creation.js';
import {
  createRequestIntake, type RequestIntakePort, type RequestSubmitResultV1,
} from '../../src/business/workflow/request-intake.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import { createSecretaryProfiles } from '../../src/app/secretary-profiles.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import type { RoleSpecContentV1 } from '../../src/contracts/role-spec.js';
import { roleSpecContentDigest } from '../../src/contracts/role-spec.js';
import type { WorkbenchQueryProfile } from '../../src/app/runtime-configuration.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_GOAL_2, S6A_SCOPE, S6A_SECRETARY_ROLE, S6A_WORK_ROLE,
  S6A_WORK_ROLE_BINDING, type S6ARequestWorld, type S6ASession, type S6AWorldOptions,
} from '../helpers/S6A-request-fixture.js';
import { commitBarrier, byClaimMove } from '../helpers/S6A-commit-barrier.js';
import { registrationDouble } from '../helpers/S6A-registration-double.js';
import { AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET } from '../helpers/AG2b-collaboration-fixture.js';

// ---------------------------------------------------------------------------
// The two backend factories: remember the shared records port (A4) and keep the
// commit barrier. A3: each backend's `close` tells `onStoreClose` which records
// port it closes, then runs the real close. Every other export is the real one.
// ---------------------------------------------------------------------------
const captured = vi.hoisted(() => ({
  records: undefined as unknown,
  onStoreClose: null as ((records: unknown) => void) | null,
  observeClose<B extends { records: unknown; close(): Promise<void> }>(backend: B): B {
    return { ...backend, close: () => {
      captured.onStoreClose?.(backend.records);
      return backend.close();
    } };
  },
}));

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  const mod = await barrier.inMemoryBarrierModule(importOriginal);
  return {
    ...mod,
    createInMemoryRecordBackend: (options: Parameters<typeof mod.createInMemoryRecordBackend>[0]) => {
      const backend = mod.createInMemoryRecordBackend(options);
      captured.records = backend.records;
      return captured.observeClose(backend);
    },
  };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  const mod = await barrier.sqliteBarrierModule(importOriginal);
  return {
    ...mod,
    createSqliteRecordBackend: (options: Parameters<typeof mod.createSqliteRecordBackend>[0]) => {
      const backend = mod.createSqliteRecordBackend(options);
      captured.records = backend.records;
      return captured.observeClose(backend);
    },
  };
});
vi.mock('../../src/core/work-graph/sessions/session-directory.js', async (importOriginal) =>
  (await import('../helpers/S6A-registration-double.js')).registrationDoubleModule(importOriginal));

type RealRecords = GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;

// ---------------------------------------------------------------------------
// The Host input the real composition would supply (A8): the Workflow binding
// and the published query profiles.
// ---------------------------------------------------------------------------
const WORKFLOW: WorkflowHostConfiguration = {
  consumerId: AG2B_CONSUMER_ID,
  bindings: [{ workspace: S6A_SCOPE, sessionRole: S6A_WORK_ROLE, roleBinding: S6A_WORK_ROLE_BINDING,
    budget: { tokenBudget: 1_000_000, deadline: null } }],
};

function sameRole(left: unknown, right: unknown): boolean {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
}

function sameSession(left: SessionRef | null, right: SessionRef | null): boolean {
  return canonicalJson(left as unknown as JsonValue) === canonicalJson(right as unknown as JsonValue);
}

/** The published secretary profiles over the Host's real bootstrap read. */
async function profilePortOf(world: S6ARequestWorld): Promise<SecretaryProfilePort> {
  const published = (await world.readProfiles()).filter((profile) => sameRole(profile.sessionRole, S6A_SECRETARY_ROLE));
  const asProfile = (profile: (typeof published)[number]): SecretaryProfileV1 => ({
    profileId: profile.id,
    sessionRole: structuredClone(profile.sessionRole),
    roleBinding: structuredClone(profile.roleBinding),
    runtimeBudget: structuredClone(profile.runtimeBudget),
    budget: structuredClone(profile.budget),
    consumerId: profile.consumerId,
  });
  return {
    forSession: (input) => {
      const found = published.find((profile) => sameRole(profile.sessionRole, input.sessionRole));
      return found === undefined ? null : asProfile(found);
    },
    forNewLine: async () => ({ status: 'ready', value: published[0] === undefined ? null : asProfile(published[0]) }),
  };
}

type FailureKind = 'facts' | 'selection' | 'profile';

type FailureArm = { kind: FailureKind; skip: number } | null;

type Harness = {
  intake: RequestIntakePort;
  facts: RequestFactsReader;
  commits: PreparedCommit[];
  wakes: { scope: WorkspaceScope; source: 'request_command' }[];
  /** A2: the named read throws once (or after `skip` successes) from the next call on. */
  failNextRead(kind: FailureKind, options?: { skip?: number }): void;
};

async function harnessOf(world: S6ARequestWorld, options: {
  /** A2: the named commit identity prefix throws once before the store. */
  failCommitOnce?: string;
  /** A profile port the row supplies instead of the Host's published one (MH-01). */
  profiles?: SecretaryProfilePort;
} = {}): Promise<Harness> {
  const real = captured.records as RealRecords;
  const commits: PreparedCommit[] = [];
  // A3: the real port with a commit recorder and a one-shot named failure; every
  // other result passes through unchanged.
  let failedCommit: string | null = options.failCommitOnce ?? null;
  const counted: RealRecords = {
    ...real,
    commit: (input) => {
      if (failedCommit !== null && input.identityKey.startsWith(failedCommit)) {
        failedCommit = null;
        // A2: the named commit fails before the store; nothing is written.
        throw new Error('S6A injected request commit failure');
      }
      commits.push(structuredClone(input));
      return real.commit(input);
    },
  };
  let armed: FailureArm = null;
  const consume = (kind: FailureKind): boolean => {
    if (armed === null || armed.kind !== kind) return false;
    if (armed.skip > 0) { armed.skip -= 1; return false; }
    armed = null;
    return true;
  };
  // The round service's own named read keeps the real facts reader; only the
  // intake's per-request drain read is the A2 wrapper, so the row names exactly
  // the read under test.
  const roundFacts = createRequestFacts({ records: counted });
  const facts: RequestFactsReader = {
    ...roundFacts,
    readFacts: async (ctx, input) => {
      if (consume('facts')) throw new Error('S6A injected request facts failure');
      return roundFacts.readFacts(ctx, input);
    },
  };
  const publishedProfiles = options.profiles ?? await profilePortOf(world);
  const profiles: SecretaryProfilePort = {
    forSession: publishedProfiles.forSession,
    forNewLine: async (ctx, input) => {
      if (consume('profile')) throw new Error('S6A injected secretary profile failure');
      return publishedProfiles.forNewLine(ctx, input);
    },
  };
  const realSelection = createSecretarySelection({
    records: counted,
    sessionFacts: world.platform.sessionFacts,
    profiles,
    scope: createProjectSecretaryScope(),
    duty: createSessionDutyResolver({ readRoleSpec: world.platform.roles.readRoleSpec, configuration: WORKFLOW }),
  });
  const selection = {
    ...realSelection,
    readSecretarySelectionFacts: async (
      ctx: CoreCallContext, input: Parameters<typeof realSelection.readSecretarySelectionFacts>[1],
    ) => {
      if (consume('selection')) throw new Error('S6A injected secretary selection failure');
      return realSelection.readSecretarySelectionFacts(ctx, input);
    },
  };
  const lineCreation = createLineCreation({
    // The public runtime port is the same real owner; its `sessionCall` wrapper
    // only widens the return with the platform's closing rejection.
    sessions: { createSession: world.platform.runtime.createSession as SessionOperationsPort['createSession'] },
    operations: world.platform.sessions,
    capacity: createAlwaysAdmitCapacity(),
  });
  let sequence = 0;
  const rounds = createRequestRoundService({
    records: counted,
    facts: roundFacts,
    profiles,
    sessionFacts: world.platform.sessionFacts,
    duty: createSessionDutyResolver({ readRoleSpec: world.platform.roles.readRoleSpec, configuration: WORKFLOW }),
    now: () => world.clock.now(),
    operationId: () => `s6a-intake-${world.backend}-${++sequence}`,
  });
  const wakes: Harness['wakes'] = [];
  const intake = createRequestIntake({
    rounds,
    facts,
    selection,
    lineCreation,
    profiles,
    sessionFacts: world.platform.sessionFacts,
    wake: (scope, source) => { wakes.push({ scope, source }); },
  });
  return { intake, facts, commits, wakes,
    failNextRead: (kind, armOptions = {}) => { armed = { kind, skip: armOptions.skip ?? 0 }; } };
}

function submitInput(commandId: string, text: string, overrides: Partial<{
  goalId: string | null; continues: QueryJobRef | null; recipient: SessionRef | null;
}> = {}): { commandId: string; goalId: string | null; text: string; continues: QueryJobRef | null; recipient: SessionRef | null } {
  return { commandId, goalId: S6A_GOAL_1.goalId, text, continues: null, recipient: null, ...overrides };
}

async function readView(harness: Harness, ctx: CoreCallContext, root: QueryJobRef) {
  const read = await harness.facts.readRequest(ctx, { requestRoot: root });
  if (read.status !== 'ready') throw new Error(`the request view is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function readFacts(harness: Harness, ctx: CoreCallContext, root: QueryJobRef) {
  const read = await harness.facts.readFacts(ctx, { requestRoot: root });
  if (read.status !== 'ready') throw new Error(`the request facts are not readable: ${JSON.stringify(read)}`);
  return read.value;
}

/** The Host-published request read (the same owner the routes and the platform expose). */
async function hostView(world: S6ARequestWorld, ctx: CoreCallContext, root: QueryJobRef) {
  const read = await world.platform.requestFacts.readRequest(ctx, { requestRoot: root });
  if (read.status !== 'ready') throw new Error(`the Host request view is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function hostFacts(world: S6ARequestWorld, ctx: CoreCallContext, root: QueryJobRef) {
  const read = await world.platform.requestFacts.readFacts(ctx, { requestRoot: root });
  if (read.status !== 'ready') throw new Error(`the Host request facts are not readable: ${JSON.stringify(read)}`);
  return read.value;
}

function requestRootOf(result: RequestSubmitResultV1): QueryJobRef {
  if (result.status !== 'queued') throw new Error(`the submit was refused: ${JSON.stringify(result)}`);
  return result.requestRoot;
}

function assigned(result: RequestSubmitResultV1): Extract<RequestSubmitResultV1, { assignment: 'assigned' }> {
  if (result.status !== 'queued' || result.assignment !== 'assigned') {
    throw new Error(`the submit was not assigned: ${JSON.stringify(result)}`);
  }
  return result;
}

const BACKENDS = ['memory', 'sqlite'] as const;

for (const backend of BACKENDS) {
  describe(`S6A request intake (${backend})`, () => {
    const worlds: S6ARequestWorld[] = [];

    async function open(options: Omit<S6AWorldOptions, 'backend'> = {}): Promise<S6ARequestWorld> {
      captured.records = undefined;
      const world = await openS6ARequestWorld({ backend, ...options });
      worlds.push(world);
      return world;
    }

    afterEach(async () => {
      captured.onStoreClose = null;
      const left = commitBarrier.reset();
      registrationDouble.reset();
      const closing = worlds.splice(0);
      await Promise.allSettled(closing.map((world) => world.close()));
      expect(left).toEqual([]);
    });

    /**
     * A fresh pick of `target` (the only idle secretary) held at its commit,
     * once its picking reads are done. The pick takes `target`'s intake when it
     * commits, so it lands on `target` only if nothing took that intake while it
     * was held; a conflict there would make Workflow re-pick another secretary.
     */
    async function holdFreshPickOn(world: S6ARequestWorld, commandId: string) {
      const hold = commitBarrier.hold(byClaimMove(SECRETARY_INTAKE_PREFIX), `fresh pick ${commandId}`);
      const pick = world.platform.requestIntake.submitRequest(world.humanContext(),
        submitInput(commandId, 'a separate request'));
      await hold.reached;
      return { pick, release: () => hold.release() };
    }

    it('a fresh pick assigns the fixture secretary and wakes once, not on the replay', async () => {
      const world = await open();
      const secretary = await world.createSecretary('secretary-a');
      const harness = await harnessOf(world);
      const ctx = world.humanContext();

      const first = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-pick-1', 'first request')));
      expect(first).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: secretary.ref,
        created: false, waitReason: null });
      expect(harness.wakes).toEqual([{ scope: S6A_SCOPE, source: 'request_command' }]);
      const view = await readView(harness, ctx, first.requestRoot);
      expect(view.owner).toEqual(secretary.ref);
      expect(view.ownerState).toBe('owned');
      expect(view.rounds).toHaveLength(1);
      expect(view.rounds[0]!.assignedSession).toEqual(secretary.ref);

      const replay = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-pick-1', 'first request')));
      expect(replay).toEqual(first);
      expect(harness.wakes).toHaveLength(1);
    });

    it('an @ recipient takes a new request; a second request to the same recipient is busy', async () => {
      const world = await open();
      // A first, B second: the pick's later-activity key prefers B, so the
      // receipt naming A proves the person's @ won and no pick ran.
      const secretary = await world.createSecretary('secretary-a');
      const preferred = await world.createSecretary('secretary-b');
      expect(preferred.createdAt >= secretary.createdAt).toBe(true);
      const harness = await harnessOf(world);
      const ctx = world.humanContext();

      const first = assigned(await harness.intake.submitRequest(ctx,
        submitInput('m2-at-1', 'for you', { recipient: secretary.ref })));
      expect(first.created).toBe(false);
      expect(sameSession(first.secretary, secretary.ref)).toBe(true);
      expect((await readView(harness, ctx, first.requestRoot)).owner).toEqual(secretary.ref);

      const second = await harness.intake.submitRequest(ctx,
        submitInput('m2-at-2', 'for you too', { recipient: secretary.ref }));
      expect(second.status).toBe('rejected');
      if (second.status !== 'rejected') throw new Error('unreachable');
      expect(second.code).toBe('busy');
      expect(second.reason.length).toBeGreaterThan(0);
    });

    it('an @ recipient with a pending archive request is unavailable with the reason', async () => {
      const world = await open();
      const recipient = await world.createSecretary('secretary-a');
      await world.requestArchive(recipient);
      const harness = await harnessOf(world);

      const result = await harness.intake.submitRequest(world.humanContext(),
        submitInput('m2-at-3', 'not now', { recipient: recipient.ref }));
      expect(result).toEqual({
        status: 'rejected', code: 'unavailable', reason: 'the target Session has a pending archive request',
      });
    });

    it('a follow-up on a request A owns queues on A without an intake', async () => {
      const world = await open();
      const secretary = await world.createSecretary('secretary-a');
      const harness = await harnessOf(world);
      const ctx = world.humanContext();
      const root = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-r03-root', 'first')));

      const follow = assigned(await harness.intake.submitRequest(ctx,
        submitInput('m2-r03-follow', 'second', { continues: root.round })));
      expect(follow.created).toBe(false);
      expect(sameSession(follow.secretary, secretary.ref)).toBe(true);
      const view = await readView(harness, ctx, root.requestRoot);
      expect(view.owner).toEqual(secretary.ref);
      expect(view.rounds).toHaveLength(2);
      expect(view.rounds[1]!.assignedSession).toEqual(secretary.ref);
    });

    it('a follow-up whose tail moved under it is retried and still commits', async () => {
      const world = await open();
      await world.createSecretary('secretary-a');
      const harness = await harnessOf(world);
      const ctx = world.humanContext();
      const root = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-tail-root', 'first')));

      const hold = commitBarrier.hold(byClaimMove(REQUEST_TAIL_PREFIX), 'first follow-up');
      const first = harness.intake.submitRequest(ctx, submitInput('m2-tail-1', 'second', { continues: root.round }));
      await hold.reached;
      const second = assigned(await harness.intake.submitRequest(ctx,
        submitInput('m2-tail-2', 'third', { continues: root.round })));
      hold.release();
      const firstResult = assigned(await first);

      const view = await readView(harness, ctx, root.requestRoot);
      expect(view.rounds).toHaveLength(3);
      expect(view.rounds.map((round) => round.kind)).toEqual(['request', 'followup', 'followup']);
      expect(view.rounds.map((round) => round.assignedSession)).toEqual([
        view.owner, view.owner, view.owner,
      ]);
      // The held attempt re-read the moved tail and committed after the other
      // follow-up; the last tail owner is the later round.
      expect([firstResult.round, second.round]).toContainEqual(view.rounds[2]!.ref);
      const facts = await readFacts(harness, ctx, root.requestRoot);
      expect(facts.tail.ref).toEqual(view.rounds[2]!.ref);
    });

    it('an @ on a follow-up of a request A owns moves it to B', async () => {
      const world = await open();
      const a = await world.createSecretary('secretary-a');
      const harness = await harnessOf(world);
      const ctx = world.humanContext();
      const root = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-r04-root', 'first')));
      expect(sameSession(root.secretary, a.ref)).toBe(true);
      const b = await world.createSecretary('secretary-b');

      const follow = assigned(await harness.intake.submitRequest(ctx,
        submitInput('m2-r04-follow', 'second', { continues: root.round, recipient: b.ref })));
      expect(follow.created).toBe(false);
      expect(sameSession(follow.secretary, b.ref)).toBe(true);
      const view = await readView(harness, ctx, root.requestRoot);
      expect(view.owner).toEqual(b.ref);
      expect(view.rounds[1]!.assignedSession).toEqual(b.ref);
    });

    it('a follow-up on its owner takes no intake: a fresh pick held on that owner still lands there', async () => {
      // A owns the request without holding an intake of its own (the request
      // reached A through an `@` on an owned request). The follow-up queues on
      // A; had it taken A's intake, the held pick of A would conflict and re-pick.
      const world = await open();
      const b = await world.createSecretary('secretary-b');
      const ctx = world.humanContext();
      const intake = world.platform.requestIntake;
      const request = assigned(await intake.submitRequest(ctx, submitInput('m2-own-root', 'first')));
      expect(request.secretary).toEqual(b.ref);
      const a = await world.createSecretary('secretary-a');
      const sessionsBefore = (await world.listSessions()).length;

      const fresh = await holdFreshPickOn(world, 'm2-own-fresh');
      const moved = assigned(await intake.submitRequest(ctx,
        submitInput('m2-own-move', 'to a', { continues: request.round, recipient: a.ref })));
      expect(moved.secretary).toEqual(a.ref);
      const follow = assigned(await intake.submitRequest(ctx,
        submitInput('m2-own-follow', 'again', { continues: request.round })));
      expect(follow).toMatchObject({ secretary: a.ref, created: false });
      fresh.release();

      expect(assigned(await fresh.pick)).toMatchObject({ secretary: a.ref, created: false });
      expect((await world.listSessions()).length).toBe(sessionsBefore);
      const view = await hostView(world, ctx, request.requestRoot);
      expect(view.owner).toEqual(a.ref);
      expect(view.rounds.map((round) => round.assignedSession)).toEqual([b.ref, a.ref, a.ref]);
    });

    it('an @ on an owned request takes no intake from the recipient: a fresh pick held on it still lands there', async () => {
      // A owns the request; B is the only idle secretary, so the held fresh pick
      // chose B. The `@ B` follow-up moves the request to B without B's intake.
      const world = await open();
      const a = await world.createSecretary('secretary-a');
      const ctx = world.humanContext();
      const intake = world.platform.requestIntake;
      const request = assigned(await intake.submitRequest(ctx, submitInput('m2-at-own-root', 'first')));
      expect(request.secretary).toEqual(a.ref);
      const b = await world.createSecretary('secretary-b');
      const sessionsBefore = (await world.listSessions()).length;

      const fresh = await holdFreshPickOn(world, 'm2-at-own-fresh');
      const moved = assigned(await intake.submitRequest(ctx,
        submitInput('m2-at-own-move', 'to b', { continues: request.round, recipient: b.ref })));
      expect(moved).toMatchObject({ secretary: b.ref, created: false });
      fresh.release();

      expect(assigned(await fresh.pick)).toMatchObject({ secretary: b.ref, created: false });
      expect((await world.listSessions()).length).toBe(sessionsBefore);
      expect((await hostView(world, ctx, request.requestRoot)).owner).toEqual(b.ref);
    });

    it('a follow-up copies the request goal and refuses another goal', async () => {
      const world = await open();
      await world.createSecretary('secretary-a');
      const harness = await harnessOf(world);
      const ctx = world.humanContext();
      const root = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-goal-root', 'first')));

      const follow = assigned(await harness.intake.submitRequest(ctx,
        submitInput('m2-goal-follow', 'second', { continues: root.round, goalId: null })));
      const view = await readView(harness, ctx, root.requestRoot);
      expect(view.goalId).toBe(S6A_GOAL_1.goalId);
      expect(view.rounds[1]!.ref).toEqual(follow.round);

      const wrong = await harness.intake.submitRequest(ctx,
        submitInput('m2-goal-wrong', 'third', { continues: root.round, goalId: S6A_GOAL_2.goalId }));
      expect(wrong).toEqual({ status: 'rejected', code: 'invalid', reason: 'goalId must be null or the request goal' });
    });

    it('no candidate with a full capacity leaves the request waiting, and its follow-up waits too', async () => {
      // MH-12: the real Host `secretaryOpenCap` over the real Session state, not
      // a scripted capacity array. The only secretary is busy (a claimed Query),
      // so the pick has no candidate and a new line is refused by the cap.
      const world = await open({ extraHostOptions: { secretaryOpenCap: 1 } });
      const secretary = await world.createSecretary('secretary-a');
      const busy = await world.occupy(secretary);
      const ctx = world.humanContext();
      const intake = world.platform.requestIntake;
      const sessionsBefore = (await world.listSessions()).length;

      const root = await intake.submitRequest(ctx, submitInput('m2-wait-root', 'first'));
      expect(root).toMatchObject({ status: 'queued', assignment: 'unassigned', secretary: null,
        created: false, waitReason: 'secretary_open_cap' });
      const rootView = await hostView(world, ctx, requestRootOf(root));
      expect(rootView.ownerState).toBe('waiting');
      expect(rootView.waitReason).toBe('secretary_open_cap');
      expect(rootView.rounds[0]!.assignedSession).toBeNull();
      expect((await world.listSessions()).length).toBe(sessionsBefore);

      const follow = await intake.submitRequest(ctx,
        submitInput('m2-wait-follow', 'second', { continues: rootView.requestRoot }));
      expect(follow).toMatchObject({ status: 'queued', assignment: 'unassigned', secretary: null, created: false });
      const view = await hostView(world, ctx, rootView.requestRoot);
      expect(view.rounds).toHaveLength(2);
      expect(view.rounds.map((round) => round.assignedSession)).toEqual([null, null]);

      const drained = await intake.drainUnassigned(world.systemContext(), S6A_SCOPE,
        { maxRequests: 20, continuation: null });
      if (drained.status !== 'ready') throw new Error(`the drain failed: ${JSON.stringify(drained)}`);
      expect(drained.value).toEqual({ progressed: 0, more: false, continuation: null, wrapped: true, blocked: 1 });
      await world.finishQuery(busy);
    });

    it('no secretary profile rejects no_secretary_binding and creates no line', async () => {
      const world = await open({ configuration: 'no_secretary' });
      const harness = await harnessOf(world);
      const result = await harness.intake.submitRequest(world.humanContext(), submitInput('m2-unbound', 'hello'));
      expect(result).toEqual({ status: 'rejected', code: 'unavailable', reason: 'no_secretary_binding' });
      expect(harness.commits.filter((commit) => commit.identityKey.startsWith('request.submit:'))).toHaveLength(0);
      expect(await world.listSessions()).toHaveLength(0);
    });

    it('a new line is created once and its replay returns the same receipt', async () => {
      const world = await open();
      const harness = await harnessOf(world);
      const ctx = world.humanContext();

      const first = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-line-1', 'first')));
      expect(first.created).toBe(true);
      const sessions = await world.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.record.ref.sessionId).toBe(first.secretary.sessionId);

      const replay = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-line-1', 'first')));
      expect(replay).toEqual(first);
      expect(await world.listSessions()).toHaveLength(1);
      expect(harness.wakes).toHaveLength(1);
    });

    it('line_pending is unavailable and the retry replays the created line once', async () => {
      const world = await open();
      const harness = await harnessOf(world);
      const ctx = world.humanContext();
      const input = submitInput('m2-pending-1', 'first');

      registrationDouble.failNext(1);
      const first = await harness.intake.submitRequest(ctx, input);
      expect(first).toEqual({ status: 'rejected', code: 'unavailable', reason: 'line_pending' });
      expect(registrationDouble.injected).toBe(1);
      expect(await world.listSessions()).toHaveLength(0);

      const retry = assigned(await harness.intake.submitRequest(ctx, input));
      expect(retry.created).toBe(true);
      expect(registrationDouble.forwarded).toBe(1);
      expect(await world.listSessions()).toHaveLength(1);
      const view = await readView(harness, ctx, retry.requestRoot);
      expect(view.rounds).toHaveLength(1);
      expect(view.owner).toEqual(retry.secretary);

      const commits = harness.commits.length;
      const replay = assigned(await harness.intake.submitRequest(ctx, input));
      expect(replay).toEqual(retry);
      expect(harness.commits).toHaveLength(commits);
      expect(await world.listSessions()).toHaveLength(1);
    });

    it('a retried submit reads the replayed line current revision after the line legitimately changed', async () => {
      // MH-03: the line was created before a failed append; the Session then
      // moved (archive + reactivate), so the replay's guard must be the CURRENT
      // revision read through the real Session facts, not revision 1.
      const world = await open();
      const harness = await harnessOf(world, { failCommitOnce: 'request.submit:' });
      const ctx = world.humanContext();
      const input = submitInput('m2-after-line', 'first');

      const failed = await harness.intake.submitRequest(ctx, input);
      expect(failed).toMatchObject({ status: 'rejected', code: 'unavailable' });
      const created = await world.listSessions();
      expect(created).toHaveLength(1);
      const line: S6ASession = { label: 'created-line',
        ref: { projectId: created[0]!.record.ref.projectId, sessionId: created[0]!.record.ref.sessionId },
        aggregateRef: created[0]!.record.ref, role: created[0]!.record.role, createdAt: created[0]!.record.createdAt };
      const moved = await world.bumpRevision(line);
      expect(moved.after).toBeGreaterThan(moved.before);

      const retry = assigned(await harness.intake.submitRequest(ctx, input));
      expect(retry.created).toBe(true);
      expect(retry.secretary.sessionId).toBe(created[0]!.record.ref.sessionId);
      expect(await world.listSessions()).toHaveLength(1);
      expect((await readView(harness, ctx, retry.requestRoot)).owner).toEqual(retry.secretary);
    });

    it('a retried drain replaying a created line reads its current revision', async () => {
      // MH-03's drain half: the line creation committed before the `assigned`
      // append failed; the line then moved, and the retried drain replays it.
      const world = await open({ extraHostOptions: { secretaryOpenCap: 1 } });
      const secretary = await world.createSecretary('secretary-a');
      const busy = await world.occupy(secretary);
      const ctx = world.humanContext();
      const waiting = await world.platform.requestIntake.submitRequest(ctx, submitInput('m2-drain-line', 'first'));
      const root = requestRootOf(waiting);
      await world.finishQuery(busy);
      await world.archive(secretary);

      const harness = await harnessOf(world, { failCommitOnce: 'request.assigned:' });
      const failed = await harness.intake.drainUnassigned(world.systemContext(), S6A_SCOPE,
        { maxRequests: 20, continuation: null });
      expect(failed).toMatchObject({ status: 'rejected', code: 'unavailable' });
      const created = (await world.listSessions()).filter((card) =>
        card.record.ref.sessionId !== secretary.aggregateRef.sessionId);
      expect(created).toHaveLength(1);
      const line: S6ASession = { label: 'created-line',
        ref: { projectId: created[0]!.record.ref.projectId, sessionId: created[0]!.record.ref.sessionId },
        aggregateRef: created[0]!.record.ref, role: created[0]!.record.role, createdAt: created[0]!.record.createdAt };
      const moved = await world.bumpRevision(line);
      expect(moved.after).toBeGreaterThan(moved.before);

      const retried = await harness.intake.drainUnassigned(world.systemContext(), S6A_SCOPE,
        { maxRequests: 20, continuation: null });
      if (retried.status !== 'ready') throw new Error(`the retried drain failed: ${JSON.stringify(retried)}`);
      expect(retried.value).toMatchObject({ progressed: 1, blocked: 0 });
      const view = await hostView(world, ctx, root);
      expect(view.ownerState).toBe('owned');
      expect(view.owner).toEqual(line.ref);
    });

    it('the drain writes exactly one assigned routing round, and a replayed drain writes none', async () => {
      // MH-12: the request is waiting because the real Host cap (1) is full and
      // its only secretary is busy; a second, idle secretary is created through
      // the public Session route, then the drain assigns it.
      const world = await open({ extraHostOptions: { secretaryOpenCap: 1 } });
      const a = await world.createSecretary('secretary-a');
      const aBusy = await world.occupy(a);
      const ctx = world.humanContext();
      const waiting = await world.platform.requestIntake.submitRequest(ctx, submitInput('m2-drain-1', 'first'));
      const requestRoot = requestRootOf(waiting);
      const b = await world.createSecretary('secretary-b');
      await world.finishQuery(aBusy);

      const first = await world.platform.requestIntake.drainUnassigned(world.systemContext(), S6A_SCOPE,
        { maxRequests: 20, continuation: null });
      if (first.status !== 'ready') throw new Error(`the drain failed: ${JSON.stringify(first)}`);
      expect(first.value).toEqual({ progressed: 1, more: false, continuation: null, wrapped: true, blocked: 0 });
      const facts = await hostFacts(world, ctx, requestRoot);
      expect(facts.rounds).toHaveLength(2);
      expect(facts.rounds[1]!.job.roundKind).toBe('routing');
      expect(facts.rounds[1]!.job.routing).toEqual({ from: null, to: b.ref, reason: 'assigned' });
      const view = await hostView(world, ctx, requestRoot);
      expect(view.owner).toEqual(b.ref);
      expect(view.ownerState).toBe('owned');

      const replay = await world.platform.requestIntake.drainUnassigned(world.systemContext(), S6A_SCOPE,
        { maxRequests: 20, continuation: first.value.continuation });
      if (replay.status !== 'ready') throw new Error(`the replay failed: ${JSON.stringify(replay)}`);
      expect(replay.value).toEqual({ progressed: 0, more: false, continuation: null, wrapped: true, blocked: 0 });
      expect((await hostFacts(world, ctx, requestRoot)).rounds).toHaveLength(2);
    });

    it('a blocked request does not stop the drain', async () => {
      // MH-12: the older request's line registration fails once (the frozen
      // registration double), so it is blocked; the newer one creates its line
      // with the real Host cap and progresses. Both waited under the real cap.
      const world = await open({ extraHostOptions: { secretaryOpenCap: 1 } });
      const a = await world.createSecretary('secretary-a');
      const aBusy = await world.occupy(a);
      const ctx = world.humanContext();
      const older = await world.platform.requestIntake.submitRequest(ctx, submitInput('m2-blocked-older', 'first'));
      const olderRoot = requestRootOf(older);
      const newer = await world.platform.requestIntake.submitRequest(ctx, submitInput('m2-blocked-newer', 'second'));
      const newerRoot = requestRootOf(newer);
      await world.finishQuery(aBusy);
      await world.archive(a);
      registrationDouble.failNext(1);

      const drained = await world.platform.requestIntake.drainUnassigned(world.systemContext(), S6A_SCOPE,
        { maxRequests: 20, continuation: null });
      if (drained.status !== 'ready') throw new Error(`the drain failed: ${JSON.stringify(drained)}`);
      expect(drained.value).toEqual({ progressed: 1, more: false, continuation: null, wrapped: true, blocked: 1 });

      const olderView = await hostView(world, ctx, olderRoot);
      expect(olderView.ownerState).toBe('waiting');
      expect(olderView.rounds).toHaveLength(1);
      const newerView = await hostView(world, ctx, newerRoot);
      expect(newerView.ownerState).toBe('owned');
      expect(newerView.rounds).toHaveLength(2);
      const newerFacts = await hostFacts(world, ctx, newerRoot);
      expect(newerFacts.rounds[1]!.job.roundKind).toBe('routing');
      expect(newerFacts.rounds[1]!.job.routing?.reason).toBe('assigned');
    });

    it('the drain moves an archived owner request to another secretary', async () => {
      const world = await open();
      const a = await world.createSecretary('secretary-a');
      const harness = await harnessOf(world);
      const ctx = world.humanContext();
      const root = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-archived-1', 'first')));
      expect(sameSession(root.secretary, a.ref)).toBe(true);
      const b = await world.createSecretary('secretary-b');
      await world.archive(a);
      // A second round (a new pick after A archived) takes B's intake on THAT
      // round; the drain then moves it from B to C with the root round as the
      // intake's new holder (the book's `owner_archived` row).
      const follow = assigned(await harness.intake.submitRequest(ctx,
        submitInput('m2-archived-2', 'second', { continues: root.round })));
      expect(sameSession(follow.secretary, b.ref)).toBe(true);
      const c = await world.createSecretary('secretary-c');
      await world.archive(b);
      expect((await readView(harness, ctx, root.requestRoot)).ownerState).toBe('owner_archived');

      const drained = await harness.intake.drainUnassigned(world.systemContext(), S6A_SCOPE,
        { maxRequests: 20, continuation: null });
      if (drained.status !== 'ready') throw new Error(`the drain failed: ${JSON.stringify(drained)}`);
      expect(drained.value).toEqual({ progressed: 1, more: false, continuation: null, wrapped: true, blocked: 0 });
      const facts = await readFacts(harness, ctx, root.requestRoot);
      expect(facts.rounds).toHaveLength(3);
      expect(facts.rounds[2]!.job.routing).toEqual({ from: b.ref, to: c.ref, reason: 'assigned' });
      expect((await readView(harness, ctx, root.requestRoot)).owner).toEqual(c.ref);
    });

    it('route moves an owned request by hand and a drop ends its pending round', async () => {
      const world = await open();
      await world.createSecretary('secretary-a');
      const harness = await harnessOf(world);
      const ctx = world.humanContext();
      const root = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-route-root', 'first')));
      const b = await world.createSecretary('secretary-b');

      const routed = await harness.intake.route(ctx, { commandId: 'm2-route-1', round: root.round, to: b.ref, reason: 'manual' });
      if (routed.status !== 'routed') throw new Error(`the route failed: ${JSON.stringify(routed)}`);
      let view = await readView(harness, ctx, root.requestRoot);
      expect(view.owner).toEqual(b.ref);
      expect(view.rounds.at(-1)!.kind).toBe('routing');

      const dropped = await harness.intake.route(ctx, { commandId: 'm2-drop-1', round: root.round, to: null, reason: 'dropped' });
      if (dropped.status !== 'routed') throw new Error(`the drop failed: ${JSON.stringify(dropped)}`);
      view = await readView(harness, ctx, root.requestRoot);
      expect(view.owner).toBeNull();
      expect(view.ownerState).toBe('dropped');
      expect(view.rounds[0]!.status).toBe('ended');
      expect(view.rounds[0]!.closeCode).toBe('cancelled');
      expect(view.rounds[0]!.closeDetail).toBe('dropped');
    });

    it('a manual route of an owned request takes no intake from the target: a fresh pick held on it still lands there', async () => {
      // A owns the request; B is the only idle secretary, so the held fresh pick
      // chose B. The person routes the owned request to B by hand; a manual route
      // from `owned` takes no intake.
      const world = await open();
      const a = await world.createSecretary('secretary-a');
      const ctx = world.humanContext();
      const intake = world.platform.requestIntake;
      const request = assigned(await intake.submitRequest(ctx, submitInput('m2-route-own-root', 'first')));
      expect(request.secretary).toEqual(a.ref);
      const b = await world.createSecretary('secretary-b');
      const sessionsBefore = (await world.listSessions()).length;

      const fresh = await holdFreshPickOn(world, 'm2-route-own-fresh');
      const routed = await intake.route(ctx, { commandId: 'm2-route-own', round: request.round, to: b.ref, reason: 'manual' });
      expect(routed.status).toBe('routed');
      fresh.release();

      expect(assigned(await fresh.pick)).toMatchObject({ secretary: b.ref, created: false });
      expect((await world.listSessions()).length).toBe(sessionsBefore);
      expect((await hostView(world, ctx, request.requestRoot)).owner).toEqual(b.ref);
    });

    it('close waits for an in-flight request held at its commit, then closes the store', async () => {
      // The published request owners drain through `trackedCall`, so the close
      // drain takes the in-flight request and the platform store closes only
      // after it settles. Two A3 observations, both pass-through: the close
      // drain subscribing to the request's promise (`Promise.allSettled` calls
      // its `then`), and the platform store's `close`.
      const world = await open();
      const secretary = await world.createSecretary('secretary-a');
      const platformRecords = captured.records;
      const order: string[] = [];
      let storeClosed!: () => void;
      const storeClosing = new Promise<string>((resolve) => { storeClosed = () => resolve('store closed'); });
      captured.onStoreClose = (records) => {
        if (records !== platformRecords) return;
        order.push('store closed');
        storeClosed();
      };

      const hold = commitBarrier.hold(byClaimMove(SECRETARY_INTAKE_PREFIX), 'submit held before close');
      const inflight = world.platform.requestIntake.submitRequest(world.humanContext(),
        submitInput('m2-close-1', 'first'));
      let tookRequest!: () => void;
      const drainTook = new Promise<string>((resolve) => { tookRequest = () => resolve('drain took the request'); });
      const realThen = inflight.then;
      Object.defineProperty(inflight, 'then', {
        configurable: true,
        value(this: typeof inflight, ...args: Parameters<typeof inflight.then>) {
          tookRequest();
          return realThen.apply(this, args);
        },
      });
      // `await` does not read the `then` property of a native promise, so this
      // waiter is not mistaken for the close drain.
      const settled = (async () => {
        const result = await inflight;
        order.push('request settled');
        return result;
      })();
      await hold.reached;

      const closing = world.host.close();
      expect(await Promise.race([drainTook, storeClosing])).toBe('drain took the request');
      hold.release();
      const result = await settled;
      expect(result).toMatchObject({ status: 'queued', assignment: 'assigned', secretary: secretary.ref });
      await closing;
      expect(order).toEqual(['request settled', 'store closed']);
    });

    it('a role_spec secretary profile is reused by forSession, so a second submit adds no line', async () => {
      // MH-01/L1: the only secretary profile is a role_spec role installed and
      // activated through the public role owner. The first submit creates its
      // line; after that request is dropped the line is idle, and the second
      // submit must be assigned to the same line (no duty test in forSession).
      const world = await open();
      const ctx = world.humanContext();
      if (ctx.principal.kind !== 'host') throw new Error('the world context is a Host context');
      const hostActor = ctx.principal.actor;
      const content: RoleSpecContentV1 = {
        schemaVersion: 1, platformDuty: 'secretary', label: 'S6A role_spec secretary',
        purpose: 'Answer the person', responsibility: ['human_decision_support'],
        requiredMaterials: [{ kind: 'contract', reason: 'Read the request' }], optionalMaterials: [],
        permissions: { tools: ['read'], writeScope: 'none' },
        budget: { source: 'task-budget', scope: 'assigned-task' },
        requiredOutputs: [{ kind: 'answer-with-sources', reason: 'Answer the person' }],
        exit: { success: 'Answer', stop: 'Stop on missing material', handoff: 'Keep references' },
      };
      const roleId = 's6a-mh01-role-spec-secretary';
      const identity = (key: string) => ({ projectId: S6A_SCOPE.projectId, actor: { ...hostActor }, idempotencyKey: key });
      const installed = await world.platform.roles.installRoleSpec(ctx, {
        commandId: 's6a-mh01-role-install', commandType: 'InstallRoleSpecRevision', schemaVersion: 1,
        correlationId: 's6a-mh01-role', submittedAt: world.clock.now(), identity: identity('s6a-mh01-role-install'),
        payload: { roleId, revision: 1, content, contentDigest: roleSpecContentDigest(content, roleId, 1) },
      });
      if (installed.status !== 'committed') throw new Error(`the RoleSpec install failed: ${JSON.stringify(installed)}`);
      const pin = { ref: installed.revisionRef, digest: installed.contentDigest };
      const activated = await world.platform.roles.activateRoleSpec(ctx, {
        commandId: 's6a-mh01-role-activate', commandType: 'ActivateRoleSpecRevision', schemaVersion: 1,
        correlationId: 's6a-mh01-role', submittedAt: world.clock.now(), identity: identity('s6a-mh01-role-activate'),
        aggregateId: roleId, expectedRevision: 1, payload: { target: pin },
      });
      if (activated.status !== 'committed') throw new Error(`the RoleSpec activation failed: ${JSON.stringify(activated)}`);
      const sessionRole = { kind: 'role_spec' as const, pin };
      const profile: WorkbenchQueryProfile = {
        id: 's6a-mh01-role-spec-profile', label: 'S6A role_spec secretary', scope: S6A_SCOPE,
        runtimeBindingId: 's6a-mh01-role-spec-binding', sessionRole,
        roleBinding: { schemaVersion: 1, bindingId: 's6a-mh01-role-spec-binding',
          templateId: 'platform-secretary', templateRevision: 's3.1', bindingVersion: 1, policyRevision: 'role-spec' },
        runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
      };
      const profiles = createSecretaryProfiles({ profiles: () => [profile],
        duty: createSessionDutyResolver({ readRoleSpec: world.platform.roles.readRoleSpec, configuration: WORKFLOW }) });
      const harness = await harnessOf(world, { profiles });

      const first = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-mh01-first', 'first')));
      expect(first.created).toBe(true);
      expect((await world.readSession(first.secretary)).record.role).toEqual(sessionRole);
      const dropped = await harness.intake.route(ctx,
        { commandId: 'm2-mh01-drop', round: first.round, to: null, reason: 'dropped' });
      expect(dropped.status).toBe('routed');

      const second = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-mh01-second', 'second')));
      expect(second.created).toBe(false);
      expect(second.secretary).toEqual(first.secretary);
      expect(await world.listSessions()).toHaveLength(1);
    });

    it('a follow-up whose owner was dropped before its commit re-plans and picks a new secretary', async () => {
      // MH-04/L2: precheck reads `owned` (follow the owner), the drop commits
      // before the follow-up's append, and the append's facts now need a pick.
      // The no-pick plan is stale, so Workflow re-runs precheck and re-plans.
      const world = await open();
      const a = await world.createSecretary('secretary-a');
      const harness = await harnessOf(world);
      const ctx = world.humanContext();
      const root = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-replan-root', 'first')));
      expect(a.ref).toEqual(root.secretary);
      const b = await world.createSecretary('secretary-b');

      const hold = commitBarrier.hold(byClaimMove(REQUEST_TAIL_PREFIX), 'follow-up before the drop');
      const follow = harness.intake.submitRequest(ctx,
        submitInput('m2-replan-follow', 'second', { continues: root.round }));
      await hold.reached;
      const dropped = await harness.intake.route(ctx,
        { commandId: 'm2-replan-drop', round: root.round, to: null, reason: 'dropped' });
      expect(dropped.status).toBe('routed');
      hold.release();

      const result = assigned(await follow);
      expect(result.secretary).toEqual(b.ref);
      const view = await readView(harness, ctx, root.requestRoot);
      expect(view.owner).toEqual(b.ref);
      expect(view.ownerState).toBe('owned');
      expect(view.rounds).toHaveLength(3);
      expect(view.rounds[0]!.status).toBe('ended');
      expect(view.rounds[1]!.kind).toBe('routing');
      expect(view.rounds[2]!.assignedSession).toEqual(b.ref);
    });

    it('an exhausted tail retry answers busy and never re-picks or creates a line', async () => {
      // MH-05/L3: four concurrent writes move the request tail while a fresh
      // pick retries; the service answers busy after SECRETARY_TAIL_RETRIES and
      // Workflow must return it, not re-pick or create a line. Each hold matches
      // the follow-up's own identity, so the movers' commits pass the barrier.
      const world = await open();
      const first = await world.createSecretary('secretary-first');
      const harness = await harnessOf(world);
      const ctx = world.humanContext();
      const root = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-busy-root', 'first')));
      const dropped = await harness.intake.route(ctx,
        { commandId: 'm2-busy-drop', round: root.round, to: null, reason: 'dropped' });
      expect(dropped.status).toBe('routed');
      await world.archive(first);
      const movers = [
        await world.createSecretary('mover-r1'), await world.createSecretary('mover-r2'),
        await world.createSecretary('mover-r3'), await world.createSecretary('mover-r4'),
      ];
      // The movers are busy, so the pick's only idle candidate is the target;
      // they are still admissible `@` recipients (occupancy is not a refusal).
      const moverRuns = [];
      for (const mover of movers) moverRuns.push(await world.occupy(mover));
      const target = await world.createSecretary('secretary-target');
      const firstHold = commitBarrier.hold(byClaimMove(REQUEST_TAIL_PREFIX), 'follow attempt 1');
      const sessionsBefore = (await world.listSessions()).length;

      const follow = harness.intake.submitRequest(ctx,
        submitInput('m2-busy-follow', 'second', { continues: root.round }));
      const held = await firstHold.reached;
      const retries = [2, 3, 4].map(attempt => commitBarrier.hold(
        commit => commit.identityKey === held.identityKey && byClaimMove(REQUEST_TAIL_PREFIX)(commit),
        `follow attempt ${attempt}`));
      const holds = [firstHold, ...retries];

      for (const [index, mover] of movers.entries()) {
        const moved = await harness.intake.submitRequest(ctx,
          submitInput(`m2-busy-move-${index}`, `move ${index}`, { continues: root.round, recipient: mover.ref }));
        expect(moved.status).toBe('queued');
        // The recipient owns the request now; release its Query and archive it,
        // so the request reads owner_archived for the next fresh pick.
        await world.finishQuery(moverRuns[index]!);
        await world.archive(mover);
        holds[index]!.release();
        if (index < retries.length) await retries[index]!.reached;
      }

      expect(await follow).toEqual({ status: 'rejected', code: 'busy',
        reason: 'the request tail changed during the append' });
      expect((await world.listSessions()).length).toBe(sessionsBefore);
      expect(await world.readSession(target)).toBeDefined();
      expect((await readView(harness, ctx, root.requestRoot)).ownerState).toBe('owner_archived');
    });

    it('a failed facts read during the drain is unavailable, and a progressed round stays committed', async () => {
      // MH-06/L4: the second request's facts read throws after the first request
      // was assigned; the drain answers `unavailable` (never `ready`/`blocked`)
      // and the committed routing round remains.
      const world = await open({ extraHostOptions: { secretaryOpenCap: 1 } });
      const a = await world.createSecretary('secretary-a');
      const aBusy = await world.occupy(a);
      const ctx = world.humanContext();
      const older = await world.platform.requestIntake.submitRequest(ctx, submitInput('m2-read-older', 'first'));
      const olderRoot = requestRootOf(older);
      const newer = await world.platform.requestIntake.submitRequest(ctx, submitInput('m2-read-newer', 'second'));
      await world.finishQuery(aBusy);
      await world.archive(a);

      const harness = await harnessOf(world);
      harness.failNextRead('facts', { skip: 1 });
      const drained = await harness.intake.drainUnassigned(world.systemContext(), S6A_SCOPE,
        { maxRequests: 20, continuation: null });
      expect(drained).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect((await hostView(world, ctx, olderRoot)).ownerState).toBe('owned');
    });

    it.each(['selection', 'profile'] as const)('a failed %s read during the drain is unavailable, never blocked', async kind => {
      const world = await open({ extraHostOptions: { secretaryOpenCap: 1 } });
      const a = await world.createSecretary('secretary-a');
      const aBusy = await world.occupy(a);
      const ctx = world.humanContext();
      const waiting = await world.platform.requestIntake.submitRequest(ctx, submitInput('m2-read', 'first'));
      const root = requestRootOf(waiting);
      await world.finishQuery(aBusy);
      await world.archive(a);

      const harness = await harnessOf(world);
      harness.failNextRead(kind);
      const drained = await harness.intake.drainUnassigned(world.systemContext(), S6A_SCOPE,
        { maxRequests: 20, continuation: null });
      expect(drained).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect((await hostView(world, ctx, root)).ownerState).toBe('waiting');
    });

    describe('rejects: request commands', () => {
      it('a second drop is invalid and leaves the dropped request unchanged', async () => {
        const world = await open();
        await world.createSecretary('secretary-a');
        const harness = await harnessOf(world);
        const ctx = world.humanContext();
        const root = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-reject-drop-root', 'first')));
        const dropped = await harness.intake.route(ctx,
          { commandId: 'm2-reject-drop-1', round: root.round, to: null, reason: 'dropped' });
        expect(dropped.status).toBe('routed');
        const before = await readView(harness, ctx, root.requestRoot);

        const again = await harness.intake.route(ctx,
          { commandId: 'm2-reject-drop-2', round: root.round, to: null, reason: 'dropped' });
        expect(again).toEqual({ status: 'rejected', code: 'invalid', reason: 'the request is already dropped' });
        expect(await readView(harness, ctx, root.requestRoot)).toEqual(before);
      });

      it('selectIdea on a pending round is invalid and leaves the request unchanged', async () => {
        const world = await open();
        await world.createSecretary('secretary-a');
        const harness = await harnessOf(world);
        const ctx = world.humanContext();
        const root = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-reject-pending-root', 'first')));
        const before = await readView(harness, ctx, root.requestRoot);

        const pending = await harness.intake.selectIdea(ctx,
          { commandId: 'm2-reject-pending', round: root.round, index: 0 });
        expect(pending).toEqual({ status: 'rejected', code: 'invalid', reason: 'the round has no answer yet' });
        expect(await readView(harness, ctx, root.requestRoot)).toEqual(before);
      });

      it('selectIdea on a plain Query is not_found and leaves the request unchanged', async () => {
        const world = await open();
        await world.createSecretary('secretary-a');
        const harness = await harnessOf(world);
        const ctx = world.humanContext();
        const root = assigned(await harness.intake.submitRequest(ctx, submitInput('m2-reject-plain-root', 'first')));
        const before = await readView(harness, ctx, root.requestRoot);
        const plain = await world.submitPlanningQuery('m2-reject-plain');

        const notRequest = await harness.intake.selectIdea(ctx,
          { commandId: 'm2-reject-plain-select', round: plain.queryJobRef, index: 0 });
        expect(notRequest).toEqual({
          status: 'rejected', code: 'not_found', reason: 'the round is not a request round of this workspace',
        });
        expect(await readView(harness, ctx, root.requestRoot)).toEqual(before);
      });

      it.each(['handoff', 'archived'] as const)(
        'a non-person route with the internal reason %s is forbidden and leaves the request unchanged',
        async reason => {
          // MH-08: the identity-first precheck refuses a non-person before the
          // pure input check can answer `invalid`.
          const world = await open();
          await world.createSecretary('secretary-a');
          const harness = await harnessOf(world);
          const ctx = world.humanContext();
          const root = assigned(await harness.intake.submitRequest(ctx, submitInput(`m2-reject-${reason}-root`, 'first')));
          const b = await world.createSecretary('secretary-b');
          const before = await readView(harness, ctx, root.requestRoot);

          const refused = await harness.intake.route(world.systemContext(),
            { commandId: `m2-reject-${reason}`, round: root.round, to: b.ref, reason: reason as never });
          expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });
          expect(await readView(harness, ctx, root.requestRoot)).toEqual(before);
        });
    });
  });}
