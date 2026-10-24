/**
 * Target-Session conflicts of a request command, classified by where the
 * target came from: a fresh pick answers `revision_conflict` and Workflow
 * re-picks without it; a target the person named (`@`) answers `busy`; only a
 * change in the other request facts re-reads the request. The rule holds at
 * the prepare (the admission re-check) and at the commit.
 *
 * Prepare rows hold the request service's Session facts read of the target at
 * an A3 gate while a real step changes the Session (an archive, a Query
 * claim); those rows build the request owners from the real factories over
 * the Host's records (the A4 backend seam) with only that read gated. Commit
 * rows use the Host's published `requestIntake` and the frozen commit barrier.
 * Every result is read back through the Host's published request read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { SessionOperationsPort } from '../../src/core/agent-runtime/session-operations.js';
import type { SessionFactsPort } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { createSessionDutyResolver } from '../../src/composition/session-duty.js';
import { createProjectSecretaryScope, createSecretarySelection } from '../../src/core/work-graph/tasks/secretary-selection.js';
import { createRequestFacts } from '../../src/core/work-graph/tasks/request-facts.js';
import { createRequestRoundService, SECRETARY_INTAKE_PREFIX } from '../../src/core/work-graph/tasks/request-service.js';
import { createAlwaysAdmitCapacity, createLineCreation } from '../../src/business/workflow/line-creation.js';
import {
  createRequestIntake, type RequestIntakePort, type RequestSubmitResultV1,
} from '../../src/business/workflow/request-intake.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING,
  type S6ARequestWorld, type S6AWorldOptions,
} from '../helpers/S6A-request-fixture.js';
import { commitBarrier, byClaimMove } from '../helpers/S6A-commit-barrier.js';
import { deferred, type Deferred } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID } from '../helpers/AG2b-collaboration-fixture.js';

// ---------------------------------------------------------------------------
// The two backend factories: remember the shared records port (A4) and keep the
// commit barrier. Every other export is the real one.
// ---------------------------------------------------------------------------
const captured = vi.hoisted(() => ({ records: undefined as unknown }));

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  const mod = await barrier.inMemoryBarrierModule(importOriginal);
  return {
    ...mod,
    createInMemoryRecordBackend: (options: Parameters<typeof mod.createInMemoryRecordBackend>[0]) => {
      const backend = mod.createInMemoryRecordBackend(options);
      captured.records = backend.records;
      return backend;
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
      return backend;
    },
  };
});

type RealRecords = GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;

/** The Host's Workflow binding (A8), as the fixture configures it: the duty resolver reads it. */
const WORKFLOW: WorkflowHostConfiguration = {
  consumerId: AG2B_CONSUMER_ID,
  bindings: [{ workspace: S6A_SCOPE, sessionRole: S6A_WORK_ROLE, roleBinding: S6A_WORK_ROLE_BINDING,
    budget: { tokenBudget: 1_000_000, deadline: null } }],
};

type Gate = { reached: Promise<void>; release(): void };

/**
 * A3: the request service's Session facts read. A row arms it for one Session;
 * the next read of that Session waits at the gate before the real read runs,
 * then returns the real result unchanged. Every other read passes straight on.
 */
function gatedSessionFacts(real: Pick<SessionFactsPort, 'readSessionFacts'>) {
  let armed: { session: SessionRef; reached: Deferred; release: Deferred } | null = null;
  const opened: Deferred[] = [];
  const port: Pick<SessionFactsPort, 'readSessionFacts'> = {
    readSessionFacts: async (ctx, session) => {
      const gate = armed;
      if (gate !== null && gate.session.projectId === session.projectId && gate.session.sessionId === session.sessionId) {
        armed = null;
        gate.reached.resolve();
        await gate.release.promise;
      }
      return real.readSessionFacts(ctx, session);
    },
  };
  return {
    port,
    arm(session: SessionRef): Gate {
      const reached = deferred();
      const release = deferred();
      armed = { session: { ...session }, reached, release };
      opened.push(release);
      return { reached: reached.promise, release: () => release.resolve() };
    },
    releaseAll(): void {
      armed = null;
      for (const release of opened.splice(0)) release.resolve();
    },
  };
}

type Gated = { intake: RequestIntakePort; gate: ReturnType<typeof gatedSessionFacts> };

/** The real request owners over the Host's records; only the service's Session facts read is gated. */
function gatedIntake(world: S6ARequestWorld): Gated {
  const records = captured.records as RealRecords;
  const gate = gatedSessionFacts(world.platform.sessionFacts);
  const duty = createSessionDutyResolver({ readRoleSpec: world.platform.roles.readRoleSpec, configuration: WORKFLOW });
  const profiles = world.platform.secretaryProfiles;
  const facts = createRequestFacts({ records });
  let sequence = 0;
  const rounds = createRequestRoundService({
    records, facts, sessionFacts: gate.port, duty, profiles,
    now: () => world.clock.now(), operationId: () => `s6a-conflicts-${world.backend}-${++sequence}`,
  });
  const intake = createRequestIntake({
    rounds, facts,
    selection: createSecretarySelection({ records, sessionFacts: world.platform.sessionFacts, profiles,
      scope: createProjectSecretaryScope(), duty }),
    lineCreation: createLineCreation({
      // The public runtime port is the same real owner; its wrapper only widens
      // the return with the platform's closing rejection.
      sessions: { createSession: world.platform.runtime.createSession as SessionOperationsPort['createSession'] },
      operations: world.platform.sessions,
      capacity: createAlwaysAdmitCapacity(),
    }),
    profiles, sessionFacts: world.platform.sessionFacts,
  });
  return { intake, gate };
}

function submitInput(commandId: string, text: string, overrides: Partial<{
  continues: QueryJobRef | null; recipient: SessionRef | null;
}> = {}): { commandId: string; goalId: string | null; text: string; continues: QueryJobRef | null; recipient: SessionRef | null } {
  return { commandId, goalId: S6A_GOAL_1.goalId, text, continues: null, recipient: null, ...overrides };
}

function assigned(result: RequestSubmitResultV1): Extract<RequestSubmitResultV1, { assignment: 'assigned' }> {
  if (result.status !== 'queued' || result.assignment !== 'assigned') {
    throw new Error(`the submit was not assigned: ${JSON.stringify(result)}`);
  }
  return result;
}

function requestRootOf(result: RequestSubmitResultV1): QueryJobRef {
  if (result.status !== 'queued') throw new Error(`the submit was refused: ${JSON.stringify(result)}`);
  return result.requestRoot;
}

/** The Host-published request read (the owner the routes expose). */
async function hostView(world: S6ARequestWorld, ctx: CoreCallContext, root: QueryJobRef) {
  const read = await world.platform.requestFacts.readRequest(ctx, { requestRoot: root });
  if (read.status !== 'ready') throw new Error(`the request view is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

const BACKENDS = ['memory', 'sqlite'] as const;

for (const backend of BACKENDS) {
  describe(`S6A request target conflicts (${backend})`, () => {
    const worlds: S6ARequestWorld[] = [];
    const gates: Gated['gate'][] = [];

    async function open(options: Omit<S6AWorldOptions, 'backend'> = {}): Promise<S6ARequestWorld> {
      captured.records = undefined;
      const world = await openS6ARequestWorld({ backend, ...options });
      worlds.push(world);
      return world;
    }

    function gated(world: S6ARequestWorld): Gated {
      const built = gatedIntake(world);
      gates.push(built.gate);
      return built;
    }

    afterEach(async () => {
      for (const gate of gates.splice(0)) gate.releaseAll();
      const left = commitBarrier.reset();
      const closing = worlds.splice(0);
      await Promise.allSettled(closing.map((world) => world.close()));
      expect(left).toEqual([]);
    });

    describe('at the prepare', () => {
      it('a fresh pick whose target is archived before the admission re-check re-picks another secretary', async () => {
        const world = await open();
        // The pick prefers the latest activity: b, then c.
        const c = await world.createSecretary('secretary-c', { at: '2026-10-23T09:01:00.000Z' });
        const b = await world.createSecretary('secretary-b', { at: '2026-10-23T09:02:00.000Z' });
        const { intake, gate } = gated(world);
        const ctx = world.humanContext();

        const held = gate.arm(b.ref);
        const submitted = intake.submitRequest(ctx, submitInput('conflict-fresh-archived', 'first'));
        await held.reached;
        await world.archive(b);
        held.release();

        const result = assigned(await submitted);
        expect(result.secretary).toEqual(c.ref);
        expect(result.created).toBe(false);
        const view = await hostView(world, ctx, result.requestRoot);
        expect(view.owner).toEqual(c.ref);
        expect(view.rounds).toHaveLength(1);
        expect(view.rounds[0]!.assignedSession).toEqual(c.ref);
        expect((await world.readSession(b)).record.lifecycle).toBe('archived');
      });

      it('an @ target that changed between the request read and the admission re-check is busy', async () => {
        const world = await open();
        const a = await world.createSecretary('secretary-a');
        const { intake, gate } = gated(world);
        const ctx = world.humanContext();
        const root = assigned(await intake.submitRequest(ctx, submitInput('conflict-at-root', 'first')));
        expect(root.secretary).toEqual(a.ref);

        // The follow-up names the owner itself: the request facts read the
        // owner's Session, then the admission re-check reads it again after a
        // Query claim moved its revision.
        const held = gate.arm(a.ref);
        const follow = intake.submitRequest(ctx,
          submitInput('conflict-at-follow', 'second', { continues: root.round, recipient: a.ref }));
        await held.reached;
        await world.occupy(a);
        held.release();

        expect(await follow).toEqual({ status: 'rejected', code: 'busy',
          reason: 'the target Session changed while the request was read' });
        const view = await hostView(world, ctx, root.requestRoot);
        expect(view.owner).toEqual(a.ref);
        expect(view.rounds).toHaveLength(1);
      });

      it('a drain whose pick is archived before the assigned re-check leaves the request blocked, then re-picks', async () => {
        // Waiting under the real Host cap (1): the only secretary is busy; it is
        // then archived, and two idle secretaries are created.
        const world = await open({ extraHostOptions: { secretaryOpenCap: 1 } });
        const a = await world.createSecretary('secretary-a');
        const aBusy = await world.occupy(a);
        const ctx = world.humanContext();
        const root = requestRootOf(await world.platform.requestIntake.submitRequest(ctx,
          submitInput('conflict-drain-root', 'first')));
        await world.finishQuery(aBusy);
        await world.archive(a);
        const c = await world.createSecretary('secretary-c', { at: '2026-10-23T09:01:00.000Z' });
        const b = await world.createSecretary('secretary-b', { at: '2026-10-23T09:02:00.000Z' });
        const { intake, gate } = gated(world);

        const held = gate.arm(b.ref);
        const first = intake.drainUnassigned(world.systemContext(), S6A_SCOPE, { maxRequests: 20, continuation: null });
        await held.reached;
        await world.archive(b);
        held.release();

        expect(await first).toEqual({ status: 'ready',
          value: { progressed: 0, more: false, continuation: null, wrapped: true, blocked: 1 } });
        expect((await hostView(world, ctx, root)).ownerState).toBe('waiting');
        const second = await intake.drainUnassigned(world.systemContext(), S6A_SCOPE, { maxRequests: 20, continuation: null });
        expect(second).toEqual({ status: 'ready',
          value: { progressed: 1, more: false, continuation: null, wrapped: true, blocked: 0 } });
        const view = await hostView(world, ctx, root);
        expect(view.owner).toEqual(c.ref);
        expect(view.ownerState).toBe('owned');
      });
    });

    describe('at the commit', () => {
      it('a fresh pick whose target is archived while its commit is held re-picks another secretary', async () => {
        const world = await open();
        const c = await world.createSecretary('secretary-c', { at: '2026-10-23T09:01:00.000Z' });
        const b = await world.createSecretary('secretary-b', { at: '2026-10-23T09:02:00.000Z' });
        const ctx = world.humanContext();

        const hold = commitBarrier.hold(byClaimMove(SECRETARY_INTAKE_PREFIX), 'fresh pick of b');
        const submitted = world.platform.requestIntake.submitRequest(ctx, submitInput('conflict-commit-fresh', 'first'));
        await hold.reached;
        await world.archive(b);
        hold.release();

        const result = assigned(await submitted);
        expect(result.secretary).toEqual(c.ref);
        expect(result.created).toBe(false);
        const view = await hostView(world, ctx, result.requestRoot);
        expect(view.owner).toEqual(c.ref);
        expect(view.rounds).toHaveLength(1);
      });

      it('an @ target that changes while its commit is held is busy and keeps its intake free', async () => {
        const world = await open();
        const b = await world.createSecretary('secretary-b');
        const ctx = world.humanContext();
        const intake = world.platform.requestIntake;

        const hold = commitBarrier.hold(byClaimMove(SECRETARY_INTAKE_PREFIX), '@ b');
        const submitted = intake.submitRequest(ctx, submitInput('conflict-commit-at', 'first', { recipient: b.ref }));
        await hold.reached;
        await world.occupy(b);
        hold.release();

        expect(await submitted).toMatchObject({ status: 'rejected', code: 'busy' });
        // Nothing was written: b's intake is free, so a later `@ b` request is taken.
        const later = assigned(await intake.submitRequest(ctx,
          submitInput('conflict-commit-at-later', 'second', { recipient: b.ref })));
        expect(later.secretary).toEqual(b.ref);
        expect((await hostView(world, ctx, later.requestRoot)).rounds).toHaveLength(1);
      });
    });
  });
}
