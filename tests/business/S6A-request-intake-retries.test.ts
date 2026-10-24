/**
 * Workflow's request intake: the one pick-retry budget of a command, and the
 * profile and line reads whose only "nothing there" answer is a ready one.
 *
 * The retry budget runs through the Host's published `requestIntake`; the
 * frozen commit barrier holds the command's commits while real steps (a drop,
 * a Query claim) change the facts under it.
 *
 * The read failures need a fault at a named dependency (rule sheet A2), so
 * those rows build the intake from the real owners and wrap only the read
 * under test: the Host's published profile port, and the real line creation's
 * `findLine`. The backend factories are wrapped (A4) to share the Host's one
 * records port with the real selection and request owners; every other result
 * passes through unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { PreparedCommit } from '../../src/core/record-store/ports.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { SessionOperationsPort } from '../../src/core/agent-runtime/session-operations.js';
import type { SecretaryProfilePort } from '../../src/core/work-graph/model/request-contracts.js';
import { createSessionDutyResolver } from '../../src/composition/session-duty.js';
import { createProjectSecretaryScope, createSecretarySelection } from '../../src/core/work-graph/tasks/secretary-selection.js';
import { createRequestFacts } from '../../src/core/work-graph/tasks/request-facts.js';
import { createRequestRoundService, REQUEST_TAIL_PREFIX } from '../../src/core/work-graph/tasks/request-service.js';
import {
  createAlwaysAdmitCapacity, createLineCreation, type LineCreationPort,
} from '../../src/business/workflow/line-creation.js';
import {
  createRequestIntake, type RequestIntakePort, type RequestSubmitResultV1,
} from '../../src/business/workflow/request-intake.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING,
  type S6ARequestWorld, type S6AWorldOptions,
} from '../helpers/S6A-request-fixture.js';
import { commitBarrier, byClaimMove } from '../helpers/S6A-commit-barrier.js';
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

/** A read that did not answer: the two non-ready, non-rejected shapes a `ReadResult` has. */
type ReadFault = 'not_ready' | 'not_found';

function failedRead(kind: ReadFault): { status: 'not_found' } | {
  status: 'not_ready'; observed: null; required: { kind: 'platform'; cursor: CommitCursor };
} {
  return kind === 'not_found'
    ? { status: 'not_found' }
    : { status: 'not_ready', observed: null, required: { kind: 'platform', cursor: 's6a-required' as CommitCursor } };
}

/**
 * The intake over the real owners, with an A2 fault armed once on one named
 * read: the Workflow's profile read, the request service's profile read, or
 * the line lookup. Each fault answers once, then the real port answers.
 */
function faultyIntake(world: S6ARequestWorld, fault: {
  intakeProfile?: ReadFault; serviceProfile?: ReadFault; line?: ReadFault;
}): RequestIntakePort {
  const records = captured.records as RealRecords;
  const real = world.platform.secretaryProfiles;
  const profilePort = (armed: ReadFault | undefined): SecretaryProfilePort => {
    let next = armed ?? null;
    return {
      forSession: (input) => real.forSession(input),
      forNewLine: async (ctx, input) => {
        if (next === null) return real.forNewLine(ctx, input);
        const kind = next;
        next = null;
        return failedRead(kind);
      },
    };
  };
  const duty = createSessionDutyResolver({ readRoleSpec: world.platform.roles.readRoleSpec, configuration: WORKFLOW });
  const facts = createRequestFacts({ records });
  const realLines = createLineCreation({
    // The public runtime port is the same real owner; its wrapper only widens
    // the return with the platform's closing rejection.
    sessions: { createSession: world.platform.runtime.createSession as SessionOperationsPort['createSession'] },
    operations: world.platform.sessions,
    capacity: createAlwaysAdmitCapacity(),
  });
  let lineFault = fault.line ?? null;
  const lineCreation: LineCreationPort = {
    ensureLine: (ctx, input) => realLines.ensureLine(ctx, input),
    findLine: async (ctx, input) => {
      if (lineFault === null) return realLines.findLine(ctx, input);
      const kind = lineFault;
      lineFault = null;
      return failedRead(kind);
    },
  };
  let sequence = 0;
  const rounds = createRequestRoundService({
    records, facts, sessionFacts: world.platform.sessionFacts, duty, profiles: profilePort(fault.serviceProfile),
    now: () => world.clock.now(), operationId: () => `s6a-retries-${world.backend}-${++sequence}`,
  });
  return createRequestIntake({
    rounds, facts,
    selection: createSecretarySelection({ records, sessionFacts: world.platform.sessionFacts, profiles: real,
      scope: createProjectSecretaryScope(), duty }),
    lineCreation, profiles: profilePort(fault.intakeProfile), sessionFacts: world.platform.sessionFacts,
  });
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
const FAULTS = ['not_ready', 'not_found'] as const;

for (const backend of BACKENDS) {
  describe(`S6A request intake retries and reads (${backend})`, () => {
    const worlds: S6ARequestWorld[] = [];

    async function open(options: Omit<S6AWorldOptions, 'backend'> = {}): Promise<S6ARequestWorld> {
      captured.records = undefined;
      const world = await openS6ARequestWorld({ backend, ...options });
      worlds.push(world);
      return world;
    }

    afterEach(async () => {
      const left = commitBarrier.reset();
      const closing = worlds.splice(0);
      await Promise.allSettled(closing.map((world) => world.close()));
      expect(left).toEqual([]);
    });

    it('a stale no-pick plan and the pick conflicts after it share one budget of three retries', async () => {
      // The follow-up plans to follow the owner; a drop commits under it, so the
      // plan is stale (retry 1). Each fresh pick then conflicts because the
      // picked Session is claimed under the held commit (retries 2 and 3); the
      // third conflict leaves no retry, so the request gets a new line and the
      // fourth idle secretary is never picked.
      const world = await open();
      const a = await world.createSecretary('secretary-a');
      const ctx = world.humanContext();
      const intake = world.platform.requestIntake;
      const root = assigned(await intake.submitRequest(ctx, submitInput('mh-budget-root', 'first')));
      expect(root.secretary).toEqual(a.ref);
      // The pick orders idle secretaries by the latest activity: b, c, d, then e.
      const e = await world.createSecretary('secretary-e', { at: '2026-10-23T09:01:00.000Z' });
      const d = await world.createSecretary('secretary-d', { at: '2026-10-23T09:02:00.000Z' });
      const c = await world.createSecretary('secretary-c', { at: '2026-10-23T09:03:00.000Z' });
      const b = await world.createSecretary('secretary-b', { at: '2026-10-23T09:04:00.000Z' });
      const sessionsBefore = (await world.listSessions()).length;
      expect(sessionsBefore).toBe(5);

      const followHold = commitBarrier.hold(byClaimMove(REQUEST_TAIL_PREFIX), 'follow-up on the owner');
      const follow = intake.submitRequest(ctx, submitInput('mh-budget-follow', 'second', { continues: root.round }));
      const held = await followHold.reached;
      const ofFollow = (commit: PreparedCommit): boolean => commit.identityKey === held.identityKey;
      const dropped = await intake.route(ctx,
        { commandId: 'mh-budget-drop', round: root.round, to: null, reason: 'dropped' });
      expect(dropped.status).toBe('routed');
      // The old owner is claimed by a plain Query, so it is no candidate.
      await world.occupy(a);
      const conflicting = [b, c, d];
      const pickHolds = conflicting.map((session) => commitBarrier.hold(ofFollow, `pick ${session.label}`));
      followHold.release();
      for (const [index, picked] of conflicting.entries()) {
        await pickHolds[index]!.reached;
        await world.occupy(picked);
        pickHolds[index]!.release();
      }

      const result = assigned(await follow);
      expect(result.created).toBe(true);
      for (const session of [a, b, c, d, e]) expect(result.secretary).not.toEqual(session.ref);
      expect((await world.listSessions()).length).toBe(sessionsBefore + 1);
      const view = await hostView(world, ctx, root.requestRoot);
      expect(view.owner).toEqual(result.secretary);
      expect(view.ownerState).toBe('owned');
      expect(view.rounds.map((round) => round.kind)).toEqual(['request', 'routing', 'followup']);
      expect(view.rounds[2]!.assignedSession).toEqual(result.secretary);
    });

    it.each(FAULTS)('a submit whose profile read answers %s is unavailable, not no_secretary_binding', async kind => {
      const world = await open();
      const intake = faultyIntake(world, { intakeProfile: kind });

      const result = await intake.submitRequest(world.humanContext(), submitInput(`mh-profile-${kind}`, 'hello'));
      expect(result).toEqual({ status: 'rejected', code: 'unavailable',
        reason: `the secretary profile read is not available (${kind})` });
      expect(await world.listSessions()).toHaveLength(0);
    });

    it.each(FAULTS)('a waiting follow-up whose profile read answers %s is unavailable, not no_secretary_binding', async kind => {
      // The request waits under the real Host cap (1): its only secretary is busy.
      const world = await open({ extraHostOptions: { secretaryOpenCap: 1 } });
      const a = await world.createSecretary('secretary-a');
      await world.occupy(a);
      const ctx = world.humanContext();
      const root = requestRootOf(await world.platform.requestIntake.submitRequest(ctx,
        submitInput(`mh-wait-root-${kind}`, 'first')));
      expect((await hostView(world, ctx, root)).ownerState).toBe('waiting');
      const intake = faultyIntake(world, { serviceProfile: kind });

      const follow = await intake.submitRequest(ctx, submitInput(`mh-wait-follow-${kind}`, 'second', { continues: root }));
      expect(follow).toEqual({ status: 'rejected', code: 'unavailable',
        reason: `the secretary profile read is not available (${kind})` });
      const view = await hostView(world, ctx, root);
      expect(view.ownerState).toBe('waiting');
      expect(view.rounds).toHaveLength(1);
    });

    it.each(FAULTS)('a submit whose line lookup answers %s is unavailable and picks nobody', async kind => {
      const world = await open();
      const b = await world.createSecretary('secretary-b');
      const ctx = world.humanContext();
      const intake = faultyIntake(world, { line: kind });

      const result = await intake.submitRequest(ctx, submitInput(`mh-line-${kind}`, 'hello'));
      expect(result).toEqual({ status: 'rejected', code: 'unavailable',
        reason: `the line lookup is not available (${kind})` });
      // The fault answered once: the same command now picks the idle secretary,
      // and its request has the one round of this command.
      const retry = assigned(await intake.submitRequest(ctx, submitInput(`mh-line-${kind}`, 'hello')));
      expect(retry.secretary).toEqual(b.ref);
      expect(retry.created).toBe(false);
      expect((await hostView(world, ctx, retry.requestRoot)).rounds).toHaveLength(1);
    });

    it.each(FAULTS)('a drain whose profile read answers %s is unavailable, never blocked', async kind => {
      // Waiting under the real cap; then the only secretary is archived, so the
      // drain has no candidate and reads the profile for a new line.
      const world = await open({ extraHostOptions: { secretaryOpenCap: 1 } });
      const a = await world.createSecretary('secretary-a');
      const aBusy = await world.occupy(a);
      const ctx = world.humanContext();
      const root = requestRootOf(await world.platform.requestIntake.submitRequest(ctx,
        submitInput(`mh-drain-profile-${kind}`, 'first')));
      await world.finishQuery(aBusy);
      await world.archive(a);
      const intake = faultyIntake(world, { intakeProfile: kind });

      const drained = await intake.drainUnassigned(world.systemContext(), S6A_SCOPE, { maxRequests: 20, continuation: null });
      expect(drained).toEqual({ status: 'rejected', code: 'unavailable',
        reason: `the secretary profile read is not available (${kind})` });
      const view = await hostView(world, ctx, root);
      expect(view.ownerState).toBe('waiting');
      expect(view.rounds).toHaveLength(1);
    });

    it.each(FAULTS)('a drain whose line lookup answers %s is unavailable and assigns nobody', async kind => {
      // Waiting under the real cap; an idle secretary exists when the drain runs.
      const world = await open({ extraHostOptions: { secretaryOpenCap: 1 } });
      const a = await world.createSecretary('secretary-a');
      const aBusy = await world.occupy(a);
      const ctx = world.humanContext();
      const root = requestRootOf(await world.platform.requestIntake.submitRequest(ctx,
        submitInput(`mh-drain-line-${kind}`, 'first')));
      await world.createSecretary('secretary-b');
      await world.finishQuery(aBusy);
      const intake = faultyIntake(world, { line: kind });

      const drained = await intake.drainUnassigned(world.systemContext(), S6A_SCOPE, { maxRequests: 20, continuation: null });
      expect(drained).toEqual({ status: 'rejected', code: 'unavailable',
        reason: `the line lookup is not available (${kind})` });
      const view = await hostView(world, ctx, root);
      expect(view.ownerState).toBe('waiting');
      expect(view.rounds).toHaveLength(1);
    });
  });
}
