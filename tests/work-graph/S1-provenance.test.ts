/**
 * Slice 1 §5.3 service rows SV12–SV15, SV45 and SV46: the trusted legacy
 * provenance reader (`tasks/session-provenance-facts.ts`) and the one-time
 * Session directory backfill (`SessionDirectoryPort.backfillSessionProvenance`).
 *
 * Every row opens the real Memory/SQLite backend through the B2 execution
 * fixture (`createB2ExecutionFixture`, with the extra registrations the real
 * writers need) and builds its "given" through real entries: Session
 * creation/registration, the formal claim, the requeue owner and the Session
 * lifecycle link writer. Only old accepted creation operations and the legacy
 * provenance cycle are seeded directly, as spec §5.1 and lead D4 allow.
 *
 * Fixed fixtures (spec §5.1): `t0`/`t1`, project `p`, workspace `w`, source
 * Session `S`, target/child Session `D`, Tasks `A`/`B`, Runs `r0`/`r1`, message
 * `m`, request `a`. SV12/SV13 commit through the real backfill and read the stored
 * provenance/revision/cursor and `replayed` back; SV14 creates two successors
 * of the predecessor; SV15/SV45/SV46 seed the conflict, the cycle and the
 * reopened link. Part 1 ships throwing stubs, so every row is expected RED at
 * its first `not implemented:` call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { AggregateRef } from '../../src/contracts/ledger.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type {
  SessionRef, SessionWorkLinkRef, VersionPin, WorkLinkRelation, WorkLinkTarget,
} from '../../src/contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type {
  LegacyProvenanceBasisV1, SessionProvenanceV1, SessionRecord, SessionWorkLink,
} from '../../src/contracts/core/session.js';
import type { TaskRequeueRef, TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GraphWrite, SessionPageRequest } from '../../src/core/work-graph/model/session-contracts.js';
import type { LegacySessionProvenancePort } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type { SessionFactsPort } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type { AuthorizeConfiguration } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { LinkSessionWorkInput } from '../../src/core/work-graph/sessions/lifecycle-contracts.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createLegacySessionProvenanceReader } from '../../src/core/work-graph/tasks/session-provenance-facts.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { sessionProvenanceBackfilledEventFromEvent,
  type SessionWorkLinkChangedEventV1 } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import {
  encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import {
  createB2ExecutionFixture, type B2ExecutionFixture, type B2Records,
} from '../helpers/B2-execution-fixture.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';
import { checkAllInvariants, invariantStoreOf, readInvariantWorld } from '../state/invariants.js';

import { s1Schemas, observeStore, sessionOwners, createLegacySession, createSession as createNewSession, workHistory, pendingQuery, type StoreObservation } from '../helpers/S1-session-facts-fixture.js';

/** Frozen service-fixture clock values (spec §5.1). */
const t0 = '2026-10-08T00:00:00.000Z';
const t1 = '2026-10-09T00:00:00.000Z';

/** The per-row registrations the real writers/readers use (G2). */
const ADDITIONAL_SCHEMAS = s1Schemas();

type Given = {
  /** The legacy child whose provenance is derived/backfilled. */
  child: SessionRef;
  operationRef: OperationRef;
  requeueRef: TaskRequeueRef;
  firstClaim: TaskClaim;
  /** The child's initial responsible link; null when the row means a reused Session. */
  creationLink: SessionWorkLink | null;
};

type Opened = {
  b2: B2ExecutionFixture;
  records: B2Records;
  facts: SessionFactsPort;
  provenance: LegacySessionProvenancePort;
  lifecycle: ReturnType<typeof createSessionLifecycleService>;
  ctx: CoreCallContext;
  p: string;
  w: string;
  /** The source/predecessor Session S that holds the failed r0 (the requeue's historySource). */
  S: SessionRef;
  A: TaskTriple;
  B: TaskTriple;
  r0: RunRef;
  m: SessionMessageRef;
  a: string;
  endRun(requestId: string): Promise<void>;
  requeue(requestId: string): Promise<{ ref: TaskRequeueRef; outcome: TaskRequeueOutcomeV1 }>;
  createChild(
    requestId: string,
    initialLinks: { target: WorkLinkTarget; relation: WorkLinkRelation }[],
    provenance?: SessionProvenanceV1,
  ): Promise<{ ref: SessionRef; operationRef: OperationRef }>;
  claimAfterRequeue(session: SessionRef, requeueRef: TaskRequeueRef, requestId: string): Promise<TaskClaim>;
  link(ref: SessionRef, target: WorkLinkTarget, relation: WorkLinkRelation, active: boolean,
    requestId: string): Promise<SessionWorkLink>;
  readSession(ref: SessionRef): Promise<SessionRecord>;
  backfill(ref: SessionRef, provenance: SessionProvenanceV1, basis: LegacyProvenanceBasisV1,
    requestId: string): Promise<WriteResult<SessionRecord>>;
  audit: StoreObservation;
  assertInvariants(): Promise<void>;
};

const opened: Opened[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t0); });
afterEach(async () => {
  for (const fixture of opened.splice(0)) await fixture.b2.close(); vi.restoreAllMocks(); vi.useRealTimers();
});

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected a ready read, got ${JSON.stringify(result)}`);
  return result.value;
}

function rejected<T>(result: ReadResult<T>): CoreRejection {
  if (result.status !== 'rejected') throw new Error(`expected a rejected read, got ${JSON.stringify(result)}`);
  return result;
}

function firstPage(limit = 100): SessionPageRequest {
  return { limit };
}

function taskTarget(ref: TaskTriple): WorkLinkTarget {
  return { kind: 'task', ref };
}

async function open(kind: ClaimFixtureKind): Promise<Opened> {
  const b2 = await createB2ExecutionFixture(kind, ADDITIONAL_SCHEMAS);
  const base = b2.base;
  const records = base.records;
  const audit = await observeStore(base);
  const history = workHistory(b2);
  const directory = sessionOwners(base).directory;
  const backfillRequests = new Map<string, GraphWrite<{
    sessionRef: SessionRef; provenance: SessionProvenanceV1; basis: LegacyProvenanceBasisV1;
  }>>();
  const now = () => new Date().toISOString();
  const facts = createSessionFactsService({ records });
  const provenance = createLegacySessionProvenanceReader(records, facts);
  const lifecycle = createSessionLifecycleService({ records, lookups: records, sessionFacts: facts });
  const p = base.scope.projectId;
  const w = base.scope.workspaceId;
  const S = base.sessions.first;
  const A = base.tasks.first;
  const B = base.tasks.second;
  const r0 = b2.claim.runRef;
  const m: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: p, workspaceId: w, messageId: 'm' };

  let seq = 0;
  const reads = createRunStateReader({ records });
  const roles = createRoleConfigurationService({ records, now, eventId: () => `s1-provenance-role-${++seq}` });
  const authorizeConfiguration: AuthorizeConfiguration = async () =>
    ({ status: 'rejected', code: 'forbidden', reason: 'the provenance fixture performs no Agent requeue' });
  const materialReads = createMaterialRecordReaders(records);
  const materials = createMaterialService({ bodies: b2.bodies, authority: materialReads.authority, now });
  const requeueService = createTaskRequeueService({
    records, reads,
    workspaceHost: { async resolveRoot(workspace) {
      return workspace.workspaceId === w
        ? { status: 'ready', value: { root: base.directory, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'not_found', reason: 'not a registered workspace' };
    } },
    source: { async captureDigest() { return { status: 'ready', sourceDigest: 'a'.repeat(64) }; } },
    materials,
    messages: { async readMessage() { return { status: 'not_found' }; } },
    delegatedWrites: { reads, roles, bodies: b2.bodies, authorizeConfiguration },
    now, eventId: () => `s1-provenance-event-${++seq}`,
  });

  async function pinOf(ref: AggregateRef): Promise<VersionPin> {
    const key = canonicalJson(ref as unknown as JsonValue);
    const read = await records.readMany([key]);
    if (read.status !== 'ready') throw new Error(`pin read failed: ${JSON.stringify(read)}`);
    return { ref, revision: read.value.records.find(record => record.refKey === key)?.revision ?? 0 };
  }
  async function readSession(ref: SessionRef): Promise<SessionRecord> {
    const card = await base.sessionsPort.readSession(base.ctx, ref);
    if (card.status !== 'ready') throw new Error(`session read failed: ${JSON.stringify(card)}`);
    return card.value.record;
  }
  function linkRefOf(ref: SessionRef, target: WorkLinkTarget, relation: WorkLinkRelation): SessionWorkLinkRef {
    return { ...ref, aggregateType: 'SessionWorkLink', target, relation };
  }

  const fixture: Opened = {
    b2, records, facts, provenance, lifecycle, ctx: base.ctx, p, w, S, A, B, r0, m, a: 'a',
    async endRun(requestId) {
      await history.crash(await history.enter());
      const archived = await lifecycle.archiveSession(base.ctx, { input: { sessionRef: S, reason: 'predecessor archived' }, meta: { requestId: requestId + '-archive', expected: [await base.sessionPin(S)] } });
      if (archived.status !== 'committed') throw new Error(JSON.stringify(archived));
    },
    async requeue(requestId) {
      const result = await requeueService.requeueTask(base.ctx, {
        input: { taskRef: A, afterRunRef: r0, reason: 'retry the failed work for the continuation' },
        meta: { requestId, expected: [await base.goalPin(), await b2.runPin()] },
      });
      if (result.status !== 'committed' || result.value.kind !== 'requeued') {
        throw new Error(`the formal requeue did not commit a TaskRequeue: ${JSON.stringify(result)}`);
      }
      return { ref: result.value.requeue.ref, outcome: result.value };
    },
    async createChild(requestId, initialLinks, provenanceValue) {
      return provenanceValue === undefined
        ? createLegacySession(base, requestId, initialLinks)
        : createNewSession(base, requestId, { initialLinks, provenance: provenanceValue });
    },
    async claimAfterRequeue(session, requeueRef, requestId) {
      const request = await base.buildRequest({ input: { sessionRef: session, taskId: A.taskId }, requestId });
      request.input.requeueRef = requeueRef;
      // The continuation claim is the later event: it takes the row's `t1`.
      const claimed = await base.makeService(records, () => t1).claimTask(base.ctx, request);
      if (claimed.status !== 'committed') throw new Error(`the requeue claim did not commit: ${JSON.stringify(claimed)}`);
      return claimed.value;
    },
    async link(ref, target, relation, active, requestId) {
      const request: GraphWrite<LinkSessionWorkInput> = {
        input: { sessionRef: ref, target, relation, active },
        meta: { requestId, expected: [
          await pinOf(plainSessionRefToAggregate(ref)), await pinOf(linkRefOf(ref, target, relation)),
        ] },
      };
      const linked = await lifecycle.linkSessionWork(base.ctx, request);
      if (linked.status !== 'committed') throw new Error(`linkSessionWork failed: ${JSON.stringify(linked)}`);
      return linked.value;
    },
    readSession,
    async backfill(ref, provenanceValue, basis, requestId) {
      const backfill = directory.backfillSessionProvenance;
      if (backfill === undefined) throw new Error('SessionDirectoryPort.backfillSessionProvenance is not wired');
      const request = backfillRequests.get(requestId) ?? {
        input: { sessionRef: ref, provenance: provenanceValue, basis },
        meta: { requestId, expected: [await base.sessionPin(ref)] },
      };
      backfillRequests.set(requestId, request);
      return backfill.call(directory, base.ctx, request);
    },
    audit,
    async assertInvariants() {
      // The invariant world read snapshots the real SQLite ledger; the
      // in-memory backend has no ledger file to read.
      if (base.kind !== 'sqlite') return;
      const world = await readInvariantWorld(invariantStoreOf(base.directory), p);
      const violations = checkAllInvariants(world);
      expect(violations, violations.map(entry => `${entry.invariant} ${entry.message}`).join('\n')).toEqual([]);
    },
  };
  opened.push(fixture);
  return fixture;
}

/** Read the child's initial responsible link to A (null when the child was not created for A). */
async function responsibleLink(f: Opened, child: SessionRef): Promise<SessionWorkLink | null> {
  const card = await f.b2.base.sessionsPort.readSession(f.ctx, child);
  if (card.status !== 'ready') throw new Error(`child link read failed: ${JSON.stringify(card)}`);
  return card.value.links.find(entry => entry.ref.target.kind === 'task'
    && entry.ref.target.ref.taskId === f.A.taskId && entry.ref.relation === 'responsible') ?? null;
}

/**
 * The common continuation given: end the predecessor's r0, requeue it through
 * the real requeue owner (its derived `historySource` names S), create the
 * legacy child/target D through the real Session directory with an initial link to A
 * when the row means "created for this Task", and take the child's first claim
 * through the formal claim port with the TaskRequeue ref.
 */
async function buildRequeueContinuation(f: Opened, matchTask: boolean, prefix: string): Promise<Given> {
  const target = taskTarget(f.A);
  await f.endRun(`${prefix}-end-run`);
  const reused = matchTask ? null : await f.createChild(`${prefix}-child`, []);
  vi.setSystemTime(matchTask ? t0 : t1);
  const requeued = await f.requeue(`${prefix}-requeue`);
  vi.setSystemTime(t1);
  const child = reused ?? await f.createChild(`${prefix}-child`, [{ target, relation: 'responsible' }]);
  if (requeued.outcome.kind !== 'requeued') throw new Error(`requeue was refused: ${JSON.stringify(requeued.outcome)}`);
  expect(requeued.outcome.requeue.historySource?.sessionRef).toEqual(f.S);
  const firstClaim = await f.claimAfterRequeue(child.ref, requeued.ref, `${prefix}-first-claim`);
  const creationLink = matchTask ? await responsibleLink(f, child.ref) : null;
  if (matchTask && creationLink === null) throw new Error('the child initial responsible link was not written');
  return { child: child.ref, operationRef: child.operationRef, requeueRef: requeued.ref, firstClaim, creationLink };
}

describe.each(['memory', 'sqlite'] as const)('S1 legacy Session provenance reader (%s)', (kind) => {
  it('SV12 an old first claim plus a new creation operation with a unique requeue.historySource backfills a '
    + 'continuation once; the same request replays the original cursor', async () => {
    const f = await open(kind);
    const given = await buildRequeueContinuation(f, true, 'sv12');
    await f.assertInvariants();

    const expected: SessionProvenanceV1 = {
      schemaVersion: 1, kind: 'continuation', from: f.S, reason: 'archived', task: f.A,
    };
    const basis: LegacyProvenanceBasisV1 = {
      kind: 'requeue_creation', operationRef: given.operationRef,
      creationCursor: (given.creationLink as SessionWorkLink).since,
      requeueRef: given.requeueRef, firstClaimRef: given.firstClaim.outboxRef,
    };
    const before = await f.readSession(given.child);
    const first = await f.backfill(given.child, expected, basis, 'a');
    expect(first.status).toBe('committed');
    if (first.status !== 'committed') throw new Error(`the first backfill did not commit: ${JSON.stringify(first)}`);
    expect(first.replayed).toBe(false);
    expect(first.value).toEqual({ ...before, revision: before.revision + 1, provenance: expected });
    const stored = await f.readSession(given.child);
    expect(stored.provenance).toEqual(expected);
    expect(stored.revision).toBe(first.value.revision);
    const event = await f.records.eventAt(first.cursor);
    if (event.status !== 'ready') throw new Error(JSON.stringify(event));
    const payload = sessionProvenanceBackfilledEventFromEvent(event.value.event);
    if (payload.status !== 'decoded') throw new Error(payload.reason);
    expect(payload.value.basis).toEqual(basis);
    expect(payload.value.session).toEqual(first.value);

    const replayCounts = await f.audit.counts();
    const hostCalls = f.b2.host.calls;
    const modelAttempt = vi.spyOn(f.b2.model, 'recordModelRequestAttempt');
    const replay = await f.backfill(given.child, expected, basis, 'a');
    expect(replay.status).toBe('committed');
    if (replay.status !== 'committed') throw new Error(`the replayed backfill did not commit: ${JSON.stringify(replay)}`);
    expect(replay.replayed).toBe(true);
    expect(replay.cursor).toEqual(first.cursor);
    expect(replay.value).toEqual(first.value);
    expect(await f.audit.counts()).toEqual(replayCounts);
    expect(f.b2.host.calls).toBe(hostCalls);
    expect(modelAttempt).toHaveBeenCalledTimes(0);
    expect(await f.readSession(given.child)).toEqual(stored);
  });

  it('SV13 an existing old Session was reused and historySource points at another Session: backfill is new '
    + 'with basis no_reliable_predecessor and no false link', async () => {
    const f = await open(kind);
    const given = await buildRequeueContinuation(f, false, 'sv13');
    await f.assertInvariants();

    const expected: SessionProvenanceV1 = { schemaVersion: 1, kind: 'new' };
    const basis: LegacyProvenanceBasisV1 = { kind: 'no_reliable_predecessor' };
    const before = await f.readSession(given.child);
    const result = await f.backfill(given.child, expected, basis, 'a');
    expect(result.status).toBe('committed');
    if (result.status !== 'committed') throw new Error(`the new backfill did not commit: ${JSON.stringify(result)}`);
    expect(result.value.provenance).toEqual(expected);
    expect(result.value).toEqual({ ...before, revision: before.revision + 1, provenance: expected });
    const event = await f.records.eventAt(result.cursor);
    if (event.status !== 'ready') throw new Error(JSON.stringify(event));
    const payload = sessionProvenanceBackfilledEventFromEvent(event.value.event);
    if (payload.status !== 'decoded') throw new Error(payload.reason);
    expect(payload.value.basis).toEqual(basis);
    expect(payload.value.session).toEqual(result.value);
    // Reusing the same Task history is not enough to claim a continuation.
    expect(result.value.provenance).not.toHaveProperty('from');
    const stored = await f.readSession(given.child);
    expect(stored.provenance).toEqual(expected);
  });

  it('SV14 two different successors share one predecessor: findSuccessors returns both, each trace contains '
    + 'the predecessor and there is no unique conflict', async () => {
    const f = await open(kind);
    const predecessor = f.S;
    const continuation: SessionProvenanceV1 = {
      schemaVersion: 1, kind: 'continuation', from: predecessor, reason: 'interrupted', task: f.A,
    };
    const first = await f.createChild('sv14-successor-one', [], continuation);
    const second = await f.createChild('sv14-successor-two', [], continuation);
    await f.assertInvariants();
    expect(first.ref.sessionId).not.toBe(second.ref.sessionId);

    const page = ready(await f.facts.findSessionSuccessors(f.ctx, { sessionRef: predecessor, page: firstPage() }));
    expect(page.items).toHaveLength(2);
    expect(page.items.map(item => item.ref).sort((a, b) => a.sessionId.localeCompare(b.sessionId)))
      .toEqual([plainSessionRefToAggregate(first.ref), plainSessionRefToAggregate(second.ref)]
        .sort((a, b) => a.sessionId.localeCompare(b.sessionId)));
    expect(page.nextCursor).toBeNull();
    for (const item of page.items) {
      // Both successors disclose the same predecessor; the reader does not
      // collapse them into a single line head.
      expect(item.provenance).toEqual(continuation);
      expect(item.provenance).toHaveProperty('from', predecessor);
      const trace = ready(await f.facts.readSessionFacts(f.ctx,
        { projectId: item.ref.projectId, sessionId: item.ref.sessionId }));
      expect(trace.predecessor).toEqual(continuation);
    }
  });

  it('SV15 two reliable legacy evidence sources conflict: incomplete/legacy_provenance_ambiguous, '
    + 'provenance stays null and nothing is committed', async () => {
    const f = await open(kind);
    const given = await buildRequeueContinuation(f, true, 'sv15');
    // A legacy consultation message + its QueryJob point the copy at another
    // real predecessor E, while the unique requeue evidence points at S.
    const source = await f.createChild('sv15-consultation-source', []);
    const E = source.ref;
    const message = await workHistory(f.b2).copyMessage(E, given.child);
    await pendingQuery(f.b2, 'sv15-consultation', true, message);
    await f.assertInvariants();

    const before = await f.audit.counts();
    const result = await f.provenance.deriveLegacySessionProvenance(f.ctx, given.child);
    const rejection = rejected(result);
    expect(rejection.code).toBe('incomplete');
    expect(rejection.reason.startsWith('legacy_provenance_ambiguous:')).toBe(true);
    // A conflicted derivation never writes; the Session keeps provenance null.
    expect(await f.audit.counts()).toEqual(before);
    expect((await f.readSession(given.child)).provenance ?? null).toBeNull();
  });

  it('SV45 an old provenance trace closes a cycle: cycle/session_provenance_cycle, nothing is written',
    async () => {
    const f = await open(kind);
    const given = await buildRequeueContinuation(f, true, 'sv45');
    // Seed the old trace S -> child/target D (a continuation back to the
    // target), so the derived child D -> S -> D chain closes a cycle.
    const cyc: SessionProvenanceV1 = {
      schemaVersion: 1, kind: 'continuation', from: given.child, reason: 'archived', task: f.A,
    };
    const current = await f.readSession(f.S);
    const rewritten = await f.b2.base.commitRaw([encodeSessionRecord({
      ...current, revision: current.revision + 1, provenance: cyc,
    })], [{ refKey: sessionAggregateRefKey(current.ref), expectedRevision: current.revision }]);
    expect(rewritten.status).toBe('committed');
    await f.assertInvariants();

    const before = await f.audit.counts();
    const result = await f.provenance.deriveLegacySessionProvenance(f.ctx, given.child);
    const rejection = rejected(result);
    expect(rejection.code).toBe('cycle');
    expect(rejection.reason.startsWith('session_provenance_cycle:')).toBe(true);
    expect(await f.audit.counts()).toEqual(before);
    expect((await f.readSession(given.child)).provenance ?? null).toBeNull();
  });

  it('SV46 the initial link.since points at a later linkChanged, not SessionCreated: requeue_creation is not '
    + 'accepted and with no other evidence the result is new', async () => {
    const f = await open(kind);
    const given = await buildRequeueContinuation(f, true, 'sv46');
    // Close and reopen the initial responsible link: the reopen binds a LATER
    // SessionWorkLinkChanged cursor, so `since` no longer locates SessionCreated.
    await f.link(given.child, taskTarget(f.A), 'responsible', false, 'sv46-close-link');
    const reopened = await f.link(given.child, taskTarget(f.A), 'responsible', true, 'sv46-reopen-link');
    expect(reopened.since).not.toEqual((given.creationLink as SessionWorkLink).since);
    const located = await f.records.eventAt(reopened.since);
    if (located.status !== 'ready') throw new Error(JSON.stringify(located));
    expect(located.value.cursor).toBe(reopened.since);
    expect(located.value.event.eventType).toBe('SessionWorkLinkChanged');
    const changed = JSON.parse(located.value.event.json) as SessionWorkLinkChangedEventV1;
    expect(changed.sessionRef).toEqual(given.child);
    expect(changed.active).toBe(true);
    expect(changed.boundField).toBe('since');
    expect(changed.link).toEqual({ ...reopened, since: null });
    const original = await f.records.eventAt((given.creationLink as SessionWorkLink).since);
    if (original.status !== 'ready') throw new Error(JSON.stringify(original));
    expect(original.value.event.eventType).toBe('SessionCreated');
    await f.assertInvariants();

    const result = await f.provenance.deriveLegacySessionProvenance(f.ctx, given.child);
    const value = ready(result);
    expect(value.provenance).toEqual({ schemaVersion: 1, kind: 'new' });
    expect(value.basis).toEqual({ kind: 'no_reliable_predecessor' });
    // The later link revision is not the creation cursor; it must not be
    // adopted as the requeue_creation basis.
    expect(value.basis.kind).not.toBe('requeue_creation');
  });
});


