/**
 * FX-7D1-02a: one real Host world for the allocation rows. Every number the rows read is the platform's own:
 * `createLine` is the public
 * `sessions/create` with a real `creation` intent, `operation` is `sessions/operation`, `restart` is the same SQLite
 * directory reopened, `retire` is the fixture's real unavailable-secretary step. `archiveS7D1Session` and
 * `reactivateS7D1Session` are the real `sessions/archive` and `sessions/reactivate` steps for a line. `allocation` and
 * `setOpen` are the frozen public steps W adds; before W they answer the transport's unpublished-route 404, which this
 * file names and never reads as a business answer (D2). No store is read, no record/cursor/context is hand-built, and
 * no second world is opened for a restart.
 */
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import type {
  RoleConfigurationRef, SessionAggregateRef, SessionRef,
} from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { RoleLineAllocationReportV1, RoleLineDutyV1 } from '../../src/contracts/role-lines.js';
import type { HandoffActionV1 } from '../../src/core/work-graph/model/session-operation-arms.js';
import type { SessionOperationRecordOf } from '../../src/core/work-graph/model/session-contracts.js';
import { plainSessionRef } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { RoleLimitsNumbersV1, RoleLimitsViewV1 } from '../../src/contracts/role-lines.js';
import type { SessionProvenanceV1 } from '../../src/contracts/core/session.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from './S6A-commit-barrier.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { asRecord, openS6AHostWorld, type S6AHostWorld } from './S6A-host-fixture.js';
import { driveS6BHandoff } from './S6B2-fixture.js';
import { sessionOf } from './S7A-fixture.js';
import { valueOf } from './S6B3-fixture.js';
import { S6A_SCOPE, S6A_SECRETARY_ROLE, type S6ABackend, type S6AHttpAnswer, type S6ASession } from './S6A-request-fixture.js';

export const S7D1_ALLOCATION_DEFERRED = 'S7D1-DEFERRED: role-lines/allocation is not in the frozen table on '
  + "G3-1's tree (W, §3.16 item 1); the call answers the transport's 404 (A/server.ts:415)";
export const S7D1_LIMITS_DEFERRED = 'S7D1-DEFERRED: projects/role-limits/set is not in the frozen table on '
  + "G3-1's tree (W, §3.16 item 1); the call answers the transport's 404 (A/server.ts:415)";

export type S7D1Create = {
  label: string; answer: S6AHttpAnswer; session: S6ASession | null; operationRef: OperationRef | null;
  /** `true` only for a first completion; an idempotent replay answers `completed` with `replayed: true`. */
  created: boolean;
};

export type S7D1AllocationWorld = {
  readonly world: S6AHostWorld;
  readonly main: S6ACardsWorkspace;
  createLine(input: { label: string; role?: RoleConfigurationRef; duty?: PlatformDutyV1 }): Promise<S7D1Create>;
  allocation(): Promise<RoleLineAllocationReportV1>;
  operation(ref: OperationRef): Promise<Record<string, unknown>>;
  setOpen(duty: RoleLineDutyV1, n: number): Promise<Record<string, unknown>>;
  restart(): Promise<void>;
  retire(label: string, options?: { at?: string }): Promise<S6ASession>;
  close(): Promise<void>;
};

/** The D2 deferred public read: an unpublished core route is never a business answer. */
export async function readS7D1Allocation(world: S6AHostWorld): Promise<RoleLineAllocationReportV1> {
  const answer = await world.post('role-lines/allocation', plain(S6A_SCOPE, {}));
  if (answer.httpStatus === 404) throw new Error(S7D1_ALLOCATION_DEFERRED);
  const body = asRecord(answer.body);
  if (body['status'] !== 'ready') throw new Error(`S7D1: the allocation read did not answer: ${JSON.stringify(answer.body)}`);
  return body['value'] as RoleLineAllocationReportV1;
}

/** One limits write carrying only the levels the change names; the absent route is named, never read as an answer. */
export async function setS7D1Limits(world: S6AHostWorld,
  change: { running?: Partial<RoleLimitsNumbersV1>; open?: Partial<RoleLimitsNumbersV1> },
  expectedRevision: number, commandId: string): Promise<S6AHttpAnswer> {
  const answer = await world.post('projects/role-limits/set', plain(S6A_SCOPE, {
    commandId, expectedRevision, ...change,
  }));
  if (answer.httpStatus === 404) throw new Error(S7D1_LIMITS_DEFERRED);
  return answer;
}

/** The limits write; `expectedRevision` is always the revision the previous call returned (0 for the first). */
export async function setS7D1Open(world: S6AHostWorld, duty: RoleLineDutyV1, n: number,
  expectedRevision: number, commandId: string): Promise<Record<string, unknown>> {
  const answer = await setS7D1Limits(world, { open: { [duty]: n } }, expectedRevision, commandId);
  return valueOf<Record<string, unknown>>(answer.body, 'committed', 'the limits write');
}

export async function openS7D1AllocationWorld(options: { backend: S6ABackend }): Promise<S7D1AllocationWorld> {
  const world = await openS6AHostWorld({ backend: options.backend });
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const principal = world.humanContext().principal;
  if (principal.kind !== 'host') throw new Error('S7D1: the world has no Host actor');
  const creator = principal.actor;
  let limitsRevision = 0;
  let limitsCount = 0;

  async function createAllocationLine(input: Parameters<S7D1AllocationWorld['createLine']>[0]): Promise<S7D1Create> {
    const duty = input.duty ?? 'secretary';
    const creation = { duty, scope: { kind: 'project' as const }, reason: 'secretary_needed', creator };
    const answer = await world.post('sessions/create', plain(S6A_SCOPE, {
      workspace: S6A_SCOPE, role: input.role ?? S6A_SECRETARY_ROLE, recommendedRefs: [], initialLinks: [],
      meta: { requestId: `s7d1-${input.label}`, expected: [] }, creation,
    }));
    const body = asRecord(answer.body);
    if (body['status'] === 'completed') {
      const record = asRecord(body['value']);
      const ref = plainSessionRef(record['ref'] as SessionAggregateRef);
      return {
        label: input.label, answer, created: body['replayed'] === false,
        operationRef: body['operationRef'] as OperationRef,
        session: await sessionOf(world, {
          label: input.label, ref, operation: body['operationRef'] as OperationRef,
        }),
      };
    }
    return {
      label: input.label, answer, session: null, created: false,
      operationRef: typeof body['operationRef'] === 'object' ? body['operationRef'] as OperationRef : null,
    };
  }

  return {
    world, main, createLine: createAllocationLine,
    allocation: () => readS7D1Allocation(world),
    operation: async (ref) => asRecord((await world.post('sessions/operation', plain(S6A_SCOPE, ref))).body),
    setOpen: async (duty, n) => {
      const value = await setS7D1Open(world, duty, n, limitsRevision, `s7d1-limits-${String(++limitsCount)}`);
      limitsRevision = value['revision'] as number;
      return value;
    },
    restart: () => world.reopen(),
    retire: (label, retireOptions) => world.makeUnavailableSecretary(label, retireOptions),
    close: () => world.close(),
  };
}

export const S7D1_LIMITS_READ_DEFERRED = 'S7D1-DEFERRED: projects/role-limits is not in the frozen table on '
  + "G3-2's tree (W, §3.16 item 1); the call answers the transport's 404 (A/server.ts:415)";

export type S7D1LimitsSeed = {
  /** The defaults the read returned before the first write (`revision` 0). */
  readonly before: RoleLimitsViewV1;
  /** The first write's committed view. */
  readonly first: RoleLimitsViewV1;
  /** The second write's refusal: the same `expectedRevision`, read after the first commit landed. */
  readonly conflict: Record<string, unknown>;
  /** The record as `projects/role-limits` reads it after the two writes. */
  readonly after: RoleLimitsViewV1;
  readonly revisions: { readonly before: number; readonly first: number; readonly after: number };
};

/** The limits record or the defaults; the route is absent on G3-2's tree and answers the transport's 404. */
export async function readS7D1Limits(world: S6AHostWorld): Promise<RoleLimitsViewV1> {
  const answer = await world.post('projects/role-limits',
    plain(S6A_SCOPE, { projectRef: { projectId: S6A_SCOPE.projectId } }));
  if (answer.httpStatus === 404) throw new Error(S7D1_LIMITS_READ_DEFERRED);
  const body = asRecord(answer.body);
  if (body['status'] !== 'ready') throw new Error(`S7D1: the limits read did not answer: ${JSON.stringify(answer.body)}`);
  return body['value'] as RoleLimitsViewV1;
}

/**
 * 02b: the limits CAS on 02a's world, before its first create. The read before the writes supplies the
 * `expectedRevision` (0 for the absent record, never a literal); the first write commits one duty's merge and is
 * observed through `holdAfter`'s real commit; the second write sends the same `expectedRevision` and conflicts;
 * the read after returns the stored record.
 */
export async function seedS7D1Limits(world: S7D1AllocationWorld): Promise<S7D1LimitsSeed> {
  const before = await readS7D1Limits(world.world);
  const expectedRevision = before.revision;
  const hold = commitBarrier.holdAfter(byIdentityPrefix('roleLimits.set:'), 'S7D1 limits CAS');
  let first!: RoleLimitsViewV1;
  let conflict!: Record<string, unknown>;
  try {
    const pending = setS7D1Open(world.world, 'secretary', 9, expectedRevision, 's7d1-limits-first');
    const raced = await Promise.race([
      hold.reached.then(() => null),
      pending.then(value => ({ kind: 'value' as const, value })),
    ]);
    if (raced !== null) throw new Error('S7D1: the first limits write finished without its held commit');
    const second = await world.world.post('projects/role-limits/set', plain(S6A_SCOPE, {
      commandId: 's7d1-limits-second', expectedRevision, open: { executor: 7 },
    }));
    if (second.httpStatus === 404) throw new Error(S7D1_LIMITS_DEFERRED);
    conflict = asRecord(second.body);
    hold.release();
    first = await pending as unknown as RoleLimitsViewV1;
  } finally {
    hold.release();
  }
  const after = await readS7D1Limits(world.world);
  return { before, first, conflict, after,
    revisions: { before: before.revision, first: first.revision, after: after.revision } };
}

/** Unique request ids for the line steps: the same line is archived and reactivated more than once in a row. */
let lineStepSequence = 0;

/**
 * The real `sessions/reactivate` for one line. The expected revision is the one the public `sessions/read` gives,
 * never a literal; the line must have been archived first.
 */
export async function reactivateS7D1Session(world: S6AHostWorld, session: SessionRef, reason: string): Promise<void> {
  const card = await world.readSession(session);
  const answer = await world.post('sessions/reactivate', graphWrite(S6A_SCOPE, { sessionRef: session, reason },
    `s7d1-line-reactivate-${String(++lineStepSequence)}`, [{ ref: card.record.ref, revision: card.record.revision }]));
  valueOf(answer.body, 'committed', 'the S7D1 reactivation');
}

/**
 * The real `sessions/archive` as an ordinary archive: the caller has disposed the open responsible Task links (the
 * setup's `linkTask` closes), and the commit is observed through its own `committed` answer.
 */
export async function archiveS7D1Session(world: S6AHostWorld, session: SessionRef, reason: string): Promise<void> {
  const card = await world.readSession(session);
  const answer = await world.post('sessions/archive', graphWrite(S6A_SCOPE, {
    sessionRef: session, reason,
  }, `s7d1-line-archive-${String(++lineStepSequence)}`, [{ ref: card.record.ref, revision: card.record.revision }]));
  valueOf(answer.body, 'committed', 'the S7D1 archive');
}

export type S7D1CapSeed = {
  /** The allocation read the limit is computed from: the real holders and reservations of all four duties. */
  readonly report: RoleLineAllocationReportV1;
  /** The committed limits view after `open[duty]` became the duty's holders + reservations. */
  readonly view: RoleLimitsViewV1;
};

/**
 * 02c: put one duty exactly at its current line count, so the next create meets the cap. The holders and reservations
 * are the D2 `role-lines/allocation` read; the CAS revision is the `projects/role-limits` read's revision (the
 * preparation step's record, never a literal 0). Only the named duty changes, so no other duty's seat is borrowed.
 */
export async function seedS7D1Cap(world: S6AHostWorld, duty: RoleLineDutyV1): Promise<S7D1CapSeed> {
  const report = await readS7D1Allocation(world);
  const current = report.duties[duty];
  const open = current.holders.length + current.reservations.length;
  const limits = await readS7D1Limits(world);
  const view = await setS7D1Open(world, duty, open, limits.revision,
    `s7d1-cap-${duty}-${limits.revision}-${open}`) as unknown as RoleLimitsViewV1;
  return { report, view };
}

/**
 * 02d: SQLite only. Read the operation's current advance generation through the public `sessions/operation` and
 * drive with the existing crash hold at the archive registration: the driver crashes the Host, reopens the same
 * directory and resumes the same operation. The hold and the abandoned calls go to `teardownS6BHandoff` after the
 * row's assertions.
 */
export async function restartBeforeArchive(world: S6AHostWorld, operation: OperationRef):
Promise<Awaited<ReturnType<typeof driveS6BHandoff>>> {
  const record = valueOf<SessionOperationRecordOf<HandoffActionV1>>(
    (await world.post('sessions/operation', plain(S6A_SCOPE, operation))).body, 'ready', 'the handoff operation');
  const generation = record.action.progress.advanceGeneration;
  return await driveS6BHandoff(world, { operation, hold: [{ stage: 'archive', item: '-', phase: 'before', generation }] });
}

/**
 * 02d, the secretary entry: hold the real archive registration, post the person's `secretaries/handoff` without
 * waiting, crash, re-post the same command, take the operation from the returned progress and continue with the
 * existing driver. The abandoned call is the caller's to await after the row's assertions.
 */
export async function restartSecretaryHandoff(world: S6AHostWorld, source: SessionRef): Promise<{
  operation: OperationRef; resumed: Awaited<ReturnType<typeof driveS6BHandoff>>; pending: Promise<unknown>;
}> {
  const hold = commitBarrier.hold(byIdentityPrefix('session-archive:'), 'S7D1 handoff archive');
  const body = plain(S6A_SCOPE, { commandId: 's7d1-full-cap-secretary-handoff', session: source });
  const pending = world.post('secretaries/handoff', body).catch(() => undefined);
  await hold.reached;
  await world.crash();
  const { operation } = valueOf<{ operation: OperationRef }>(
    (await world.post('secretaries/handoff', body)).body, 'ready', 'the resumed handoff route');
  return { operation, resumed: await driveS6BHandoff(world, { operation }), pending };
}
