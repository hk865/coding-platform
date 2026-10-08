/**
 * Slice 1 §5.3 SV01–SV05, SV42–SV44: the new codecs, the six new lookup
 * indexes and the old-data compatibility defaults.
 *
 * Service rows run on both real backends. The backend is opened exactly like
 * `tests/work-graph/A2-requeue-service.test.ts:74` (`open`): the B2 execution
 * fixture over the real Memory/SQLite RecordStore, extended here with the
 * slice-1 registrations (`SessionMessage`, `SessionAnomalyAnchor`, `QueryRun`,
 * `SessionWorkLinkChanged`) so every one of the six indexes is registered in
 * the store (CORRECTION G2).
 *
 * SV01 feeds frozen PRE-slice-1 encodings (literal old bytes, never today's
 * encoder output) to the pure decoders. SV03 writes the outbox under the OLD
 * schema set and reopens the same SQLite ledger under the new one. SV04/SV05
 * reach the real Session creation entry. SV05/SV42/SV43/SV44 feed a malformed
 * encoding straight to the pure decoders and registered validators; a broken
 * record is never written to a database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EncodedDomainEvent, EncodedRecord, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { LookupValue } from '../../src/core/record-store/lookup-ports.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { SessionProvenanceV1, SessionRecord } from '../../src/contracts/core/session.js';
import type { QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { SessionAnomalyAnchorV1 } from '../../src/contracts/session-anomaly.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import { continuationBriefDigest, type ContinuationBriefV1 } from '../../src/contracts/continuation-brief.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import {
  CORE_OPERATION_SCHEMA_ID, SESSION_RECORD_SCHEMAS, decodeSessionOperationRecord, decodeSessionRecord,
  encodeSessionRecord, sessionAggregateRefKey,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';
import {
  SESSION_MESSAGE_RECORD_SCHEMAS, decodeSessionMessageRecord, encodeSessionMessageRecord,
  sessionMessageRefKey,
} from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import {
  SESSION_ANOMALY_RECORD_SCHEMAS, SESSION_ANOMALY_SCHEMA_ID, decodeSessionAnomalyAnchor,
  encodeSessionAnomalyAnchor,
} from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import {
  QUERY_JOB_RECORD_SCHEMAS, encodeQueryRunSnapshotRecord,
} from '../../src/core/work-graph/queries/query-record-codecs.js';
import {
  TASK_CLAIM_RECORD_SCHEMAS, TASK_CLAIM_OUTBOX_SCHEMA_ID, decodeDispatchOutboxEntry, dispatchOutboxRefKey,
} from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import {
  QUERY_RUN_BY_SESSION_LOOKUP, SESSION_ANOMALY_BY_GOAL_LOOKUP, SESSION_ANOMALY_BY_TASK_LOOKUP,
  SESSION_BY_PROVENANCE_LOOKUP, SESSION_REPLY_BY_HANDLER_LOOKUP, SLICE1_LOOKUP_INDEXES,
  WORK_EXECUTION_BY_SESSION_LOOKUP, type Slice1LookupIndexV1,
} from '../../src/core/work-graph/model/session-facts-contracts.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';
import type { ClaimFixtureKind, Records } from '../helpers/task-claim-fixture.js';

import { t0, key, ready, committed, s1Schemas, observeStore, sqliteCounts, sessionOwners,
  createSession, plannedSession, workHistory, pendingQuery, archiveWait, archiveControlRequest } from '../helpers/S1-session-facts-fixture.js';
import { seqOfCommitCursor } from '../../src/contracts/ledger.js';
import { createSessionAnomalyService } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
// -------------------------------------------------------------------------- //
// Backend lifecycle (the `open` shape of A2-requeue-service.test.ts:74)       //
// -------------------------------------------------------------------------- //

const opened: B2ExecutionFixture[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t0); });

const S1_ADDITIONAL_SCHEMAS = s1Schemas();

afterEach(async () => {
  for (const fixture of opened.splice(0)) await fixture.close(); vi.restoreAllMocks(); vi.useRealTimers();
});

async function open(kind: ClaimFixtureKind): Promise<B2ExecutionFixture> {
  const b2 = await createB2ExecutionFixture(kind, S1_ADDITIONAL_SCHEMAS);
  opened.push(b2);
  return b2;
}

// -------------------------------------------------------------------------- //
// Fixed pure fixtures                                                        //
// -------------------------------------------------------------------------- //

const P = 'p';
const W = 'w';
const T0 = '2026-10-08T00:00:00.000Z';
const SHA = 'a'.repeat(64);

/** The frozen bytes of a pre-slice-1 brief: no `anomalies` key is ever added. */
const OLD_BRIEF_JSON = '{"schemaVersion":1,"runRef":{"aggregateType":"Run","projectId":"p","goalId":"g","runId":"r2"},'
  + '"task":{"projectId":"p","goalId":"g","taskId":"A"},'
  + '"requeueRef":{"aggregateType":"TaskRequeue","projectId":"p","goalId":"g","taskId":"A","afterRunId":"r1"},'
  + '"mode":"rework","failureClass":"run_failed",'
  + '"trigger":{"actorClass":"agent","goalResume":false,"requeueNumber":1,"autoRework":null,"earlierRequeues":[]},'
  + '"previous":{"runRef":{"aggregateType":"Run","projectId":"p","goalId":"g","runId":"r1"},'
  + '"attemptRef":{"aggregateType":"TaskAttempt","projectId":"p","goalId":"g","taskId":"A","attemptId":"at1"},'
  + '"sessionRef":{"projectId":"p","sessionId":"S"},"outcome":"failed","origin":"observed","interruption":null,'
  + '"cancelledBy":null,"error":null,"limit":null,"budget":null,"wait":null,"unacceptedSteers":[],'
  + '"endedAt":"2026-10-08T00:00:00.000Z"},'
  + '"factsFrom":{"runRef":{"aggregateType":"Run","projectId":"p","goalId":"g","runId":"r1"},"hops":0,"truncated":false},'
  + '"stoppedAt":{"kernel":"read","reason":null,"turnStatus":"failed","lastPosition":1,"lastToolGroup":null,'
  + '"lastAssistant":null,"window":null},'
  + '"toolCalls":{"confirmed":[],"notExecuted":[],"unknown":[],"confirmedOmitted":0,"notExecutedOmitted":0,"unknownOmitted":0},'
  + '"acceptedInputs":{"steers":[],"steersOmitted":0,"messages":[],"messagesOmitted":0},"checks":null,'
  + '"requeue":{"reason":{"text":"retry","truncated":false},"reasonAuthor":"agent","newInputs":[]},'
  + '"workspace":{"selfChanged":{"status":"known","confirmed":[],"possible":[],"omitted":0},"checkpoints":[],"segments":[],'
  + '"unobserved":{"from":"previous_run_end","to":null,"previousEndedAt":"2026-10-08T00:00:00.000Z"},'
  + '"uncommitted":{"status":"not_git","baseCommit":null,"paths":[],"omitted":0,"reason":null}},'
  + '"session":{"continuity":"same_session_history","sessionRef":{"projectId":"p","sessionId":"S"},"seededFrom":null,'
  + '"boundaryPosition":null},"standingInstructionVersion":1}';
const OLD_BRIEF = JSON.parse(OLD_BRIEF_JSON) as ContinuationBriefV1;
/** sha256(canonicalJson(OLD_BRIEF)) recorded before slice 1 added `anomalies`. */
const OLD_BRIEF_DIGEST = 'c05bfdcbd91447ad3ac48114c80ebacfb50186e7d86b3ba384a32fc04d25cd9b';

/**
 * Frozen PRE-slice-1 bytes. These literals, not `encodeSessionRecord` /
 * `encodeSessionMessageRecord`, are the old encodings under test: today's
 * encoder must never be asked to produce (and therefore may never add keys to)
 * the historical bytes.
 */
const OLD_SESSION_JSON = '{"ref":{"aggregateType":"Session","projectId":"p","sessionId":"S"},'
  + '"revision":1,"kernel":{"adapterId":"s1-codec-adapter","kernelSessionId":"kernel-S"},'
  + '"lifecycle":"active","health":"available","healthConclusion":null,'
  + '"role":{"kind":"legacy_template","templateId":"builder","templateRevision":"1"},'
  + '"workspaceId":"w","lastExecutionRef":null,"occupancy":null,"historyCursor":null,'
  + '"createdAt":"2026-10-08T00:00:00.000Z","archivedAt":null}';
const OLD_OPERATION_JSON = '{"ref":{"aggregateType":"CoreOperation","projectId":"p","operationId":"op-old"},'
  + '"revision":1,"action":{"kind":"create","plannedSessionRef":{"projectId":"p","sessionId":"S"},'
  + '"workspace":{"projectId":"p","workspaceId":"w"},'
  + '"kernelStore":{"adapterId":"s1-codec-adapter","storeKey":"s1-store"},'
  + '"role":{"kind":"legacy_template","templateId":"builder","templateRevision":"1"},'
  + '"recommendedRefs":[],"initialLinks":[]},'
  + '"phase":"accepted","requestedAt":"2026-10-08T00:00:00.000Z","updatedAt":"2026-10-08T00:00:00.000Z",'
  + '"observation":null,"failure":null}';
const OLD_MESSAGE_JSON = '{"ref":{"aggregateType":"SessionMessage","projectId":"p","workspaceId":"w","messageId":"m1"},'
  + '"schemaVersion":1,"revision":1,"sender":{"kind":"host","actor":{"kind":"human","id":"u1"}},'
  + '"recipient":{"projectId":"p","sessionId":"S"},'
  + `"bodyRef":{"kind":"artifact","contentType":"text/plain","digest":"${SHA}","sizeBytes":1,`
  + '"source":{"kind":"workspace","refId":"w","revision":"1"}},'
  + '"sourceRef":{"kind":"workspace","refId":"w","revision":"1"},'
  + '"createdAt":"2026-10-08T00:00:00.000Z","status":"pending","readAt":null,"response":null}';

function encodedLiteral(json: string, schemaId: string, revision: number): EncodedRecord {
  const body = JSON.parse(json) as { ref: unknown };
  return { refKey: canonicalJson(body.ref as JsonValue), schemaId, revision, json };
}

function oldSessionEncoding(): EncodedRecord {
  return encodedLiteral(OLD_SESSION_JSON, 'SessionRecord@1', 1);
}
function oldOperationEncoding(): EncodedRecord {
  return encodedLiteral(OLD_OPERATION_JSON, CORE_OPERATION_SCHEMA_ID, 1);
}
function oldMessageEncoding(): EncodedRecord {
  return encodedLiteral(OLD_MESSAGE_JSON, 'SessionMessage@1', 1);
}

function baseSessionRecord(sessionId = 'S'): SessionRecord {
  return {
    ref: { aggregateType: 'Session', projectId: P, sessionId },
    revision: 1,
    kernel: { adapterId: 's1-codec-adapter', kernelSessionId: `kernel-${sessionId}` },
    lifecycle: 'active', health: 'available', healthConclusion: null,
    role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
    workspaceId: W, lastExecutionRef: null, occupancy: null, historyCursor: null,
    createdAt: T0, archivedAt: null,
  };
}

/** Encode arbitrary (possibly malformed) session JSON without a Store write. */
function encodedSessionJson(body: Record<string, unknown>): EncodedRecord {
  return {
    refKey: canonicalJson(body['ref'] as JsonValue),
    schemaId: 'SessionRecord@1',
    revision: body['revision'] as number,
    json: JSON.stringify(body),
  };
}

function sessionRecordValidator(record: EncodedRecord) {
  const schema = SESSION_RECORD_SCHEMAS.records.find((entry) => entry.aggregateType === 'Session');
  if (schema === undefined) throw new Error('Session record schema is not registered');
  return schema.validate(record);
}

function slice1LookupRegistrations(): Slice1LookupIndexV1[] {
  const bundles: RecordBackendSchemas[] = [
    SESSION_RECORD_SCHEMAS, TASK_CLAIM_RECORD_SCHEMAS, QUERY_JOB_RECORD_SCHEMAS,
    SESSION_ANOMALY_RECORD_SCHEMAS, SESSION_MESSAGE_RECORD_SCHEMAS,
  ];
  const wanted = new Set(SLICE1_LOOKUP_INDEXES.map((entry) => entry.name));
  return bundles.flatMap((bundle) => [...(bundle.lookups ?? [])])
    .filter((index) => wanted.has(index.name))
    .map((index) => ({ name: index.name, aggregateType: index.aggregateType, paths: [...index.paths] }));
}

function indexOf(name: string): Slice1LookupIndexV1 {
  const found = SLICE1_LOOKUP_INDEXES.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no slice-1 lookup index named ${name}`);
  return found;
}

/** Read one nested field the way the Store resolves a lookup path. */
function valueAt(source: unknown, path: string): LookupValue {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return (current ?? null) as LookupValue;
}

// -------------------------------------------------------------------------- //
// SV03 store helpers: write under the old schema set, read under the new one  //
// -------------------------------------------------------------------------- //

const S1_SEED_EVENT_TYPE = 'TrustedScopeSeeded';
const S1_SEED_EVENT: EncodedDomainEvent = { eventId: 's1-sv03-seed-event', eventType: S1_SEED_EVENT_TYPE,
  schemaVersion: 1, occurredAt: T0, json: JSON.stringify({ eventId: 's1-sv03-seed-event',
    eventType: S1_SEED_EVENT_TYPE, schemaVersion: 1, occurredAt: T0 }) };
const S1_SEED_EVENT_SCHEMA = { eventType: S1_SEED_EVENT_TYPE, schemaVersion: 1,
  validate: (event: EncodedDomainEvent) => ({ status: 'decoded' as const, value: event }) };

/** Only the outbox codec, with or without the new IDX-S2 lookup registration. */
function outboxSchemas(withSessionIndex: boolean): RecordBackendSchemas {
  return {
    records: TASK_CLAIM_RECORD_SCHEMAS.records,
    events: [...TASK_CLAIM_RECORD_SCHEMAS.events, S1_SEED_EVENT_SCHEMA],
    lookups: [...(withSessionIndex ? (TASK_CLAIM_RECORD_SCHEMAS.lookups ?? []) : []),
      ...TASK_CLAIM_RECORD_SCHEMAS.records.map(schema => ({ name: `sv03-census-${schema.aggregateType}`,
        aggregateType: schema.aggregateType, paths: ['ref.projectId'] }))],
  };
}

async function memoryOutboxCounts(records: Records, receipts: ReadonlyMap<string, string>) {
  let total = 0;
  for (const schema of TASK_CLAIM_RECORD_SCHEMAS.records) {
    const page = await records.lookup({ index: `sv03-census-${schema.aggregateType}`,
      values: ['r4c-claim-project'], limit: 200 });
    if (page.status !== 'ready') throw new Error(JSON.stringify(page));
    expect(page.value.next).toBeNull();
    total += page.value.records.length;
  }
  const horizon = await records.readMany([]);
  if (horizon.status !== 'ready') throw new Error(JSON.stringify(horizon));
  for (const [identityKey, fingerprint] of receipts) {
    const receipt = await records.lookupCommit({ identityKey, fingerprint });
    if (receipt.status !== 'ready') throw new Error(JSON.stringify(receipt));
  }
  return { records: total, events: horizon.value.readThrough === null ? 0 : seqOfCommitCursor(horizon.value.readThrough), receipts: receipts.size };
}
async function seedOldOutbox(records: Records, outbox: EncodedRecord): Promise<void> {
  const result = await records.commit({
    identityKey: 's1-sv03-seed', fingerprint: 's1-sv03-seed-v1',
    guards: [{ refKey: outbox.refKey, expectedRevision: null }],
    records: [structuredClone(outbox)], events: [structuredClone(S1_SEED_EVENT)],
    claims: [], indexGuards: [], indexChanges: [],
  });
  if (result.status !== 'committed') throw new Error(`SV03 outbox seed failed: ${JSON.stringify(result)}`);
}

// -------------------------------------------------------------------------- //
// Cases                                                                      //
// -------------------------------------------------------------------------- //

describe.each(['memory', 'sqlite'] as const)('S1 codecs and indexes (%s)', (kind) => {
  it('SV01: frozen old Session/Operation/Message bytes decode to the legacy defaults and the old brief digest is byte-identical', () => {
    const decodedSession = decodeSessionRecord(oldSessionEncoding());
    expect(decodedSession.status).toBe('decoded');
    if (decodedSession.status === 'decoded') {
      expect(decodedSession.value.provenance).toBeNull();
      expect(decodedSession.value.archiveRequest).toBeNull();
    }

    // An old accepted CoreOperation has no `provenance` in its action: it decodes
    // to the legacy null default and no `provenance` key is invented (the
    // historical request key set stays as it was).
    const decodedOperation = decodeSessionOperationRecord(oldOperationEncoding());
    expect(decodedOperation.status).toBe('decoded');
    if (decodedOperation.status === 'decoded') {
      expect(decodedOperation.value.action.provenance ?? null).toBeNull();
    }

    const decodedMessage = decodeSessionMessageRecord(oldMessageEncoding());
    expect(decodedMessage.status).toBe('decoded');
    if (decodedMessage.status === 'decoded') {
      expect(decodedMessage.value.replyHandler).toBeNull();
      expect(decodedMessage.value.archiveWaitDisposition).toBeNull();
    }

    expect(continuationBriefDigest(OLD_BRIEF)).toBe(OLD_BRIEF_DIGEST);
  });

  it('SV02: the six lookups are registered once with exact paths; each returns only its own ref and the foreign workspace changes nothing else', async () => {
    // Pure registration: one registration per index, exact aggregateType/paths,
    // and no duplicate lookup schema name.
    const registrations = slice1LookupRegistrations();
    for (const expected of SLICE1_LOOKUP_INDEXES) {
      const found = registrations.filter((entry) => entry.name === expected.name);
      expect(found, `index ${expected.name}`).toHaveLength(1);
      expect(found[0]).toMatchObject({ aggregateType: expected.aggregateType, paths: expected.paths });
    }
    const names = registrations.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);

    const b2 = await open(kind);
    const base = b2.base;
    const scope = base.scope;
    const audit = await observeStore(base);
    const owners = sessionOwners(base);
    const history = workHistory(b2);
    const predecessor = b2.claim.sessionRef;
    const continuation: SessionProvenanceV1 = { schemaVersion: 1, kind: 'continuation',
      from: predecessor, reason: 'interrupted', task: b2.claim.task };
    const first = (await createSession(base, 'sv02-successor-1', { provenance: continuation })).created.value;
    const second = (await createSession(base, 'sv02-successor-2', { provenance: continuation })).created.value;
    const question = await history.wait(false);
    const { disposed } = await archiveWait(b2, question, 'transfer', { projectId: second.ref.projectId, sessionId: second.ref.sessionId });
    const message = disposed.value;
    // r1 has a real claim but has not entered. Its formal cancel is applied by
    // the control owner immediately, releasing its Run/Attempt/Outbox/Lease.
    const requested = committed(await owners.lifecycle.requestSessionArchive(base.ctx, {
      input: { sessionRef: b2.secondClaim.sessionRef, reason: 'archive r1 before entry', tasks: [], wait: null },
      meta: { requestId: 'sv02-anchor-archive', expected: [await base.sessionPin(b2.secondClaim.sessionRef)] },
    }));
    const request = requested.value.archiveRequest;
    if (request == null) throw new Error('missing persisted anchor archive request');
    const controls = createRunControlService({ records: base.records, reads: createRunStateReader({ records: base.records }),
      authority: createMaterialRecordReaders(base.records).authority, now: () => T0, eventId: () => 'sv02-cancel-r1' });
    committed(await controls.submitControl(base.ctx, archiveControlRequest(request, b2.secondClaim.runRef)));
    expect((await b2.read(b2.secondClaim)).run.outcome).toBe('cancelled');
    const anchor = committed(await createSessionAnomalyService({ records: base.records, lookups: base.records,
      sessionFacts: owners.facts, now: () => T0 }).recordSessionAnomaly(base.ctx, {
      step: { sessionRef: b2.secondClaim.sessionRef, archiveRequestId: request.requestId,
        requestReceipt: request.receipt, step: 'anchor', subjectKey: key(b2.secondClaim.runRef) },
      files: { source: 'unknown', status: 'not_entered', confirmed: [], possible: [], omitted: 0,
        baseCommit: null, runBaselineKnown: false, reason: 'Run never entered' },
    })).value;
    const query = await pendingQuery(b2, 'sv02-query');
    const queryRun = committed(await query.execution.claimQuery(base.ctx,
      await query.request({ projectId: first.ref.projectId, sessionId: first.ref.sessionId }))).value.run;
    await audit.check();
    const cases: { index: Slice1LookupIndexV1; source: unknown; expected: string[] }[] = [
      { index: indexOf(SESSION_BY_PROVENANCE_LOOKUP), source: first,
        expected: [sessionAggregateRefKey(first.ref), sessionAggregateRefKey(second.ref)] },
      { index: indexOf(WORK_EXECUTION_BY_SESSION_LOOKUP), source: { claim: b2.claim },
        expected: [dispatchOutboxRefKey(b2.claim.outboxRef)] },
      { index: indexOf(WORK_EXECUTION_BY_SESSION_LOOKUP), source: { claim: b2.secondClaim },
        expected: [dispatchOutboxRefKey(b2.secondClaim.outboxRef)] },
      { index: indexOf(QUERY_RUN_BY_SESSION_LOOKUP), source: queryRun,
        expected: [canonicalJson(queryRun.ref as unknown as JsonValue)] },
      { index: indexOf(SESSION_ANOMALY_BY_TASK_LOOKUP), source: anchor,
        expected: [canonicalJson(anchor.ref as unknown as JsonValue)] },
      { index: indexOf(SESSION_ANOMALY_BY_GOAL_LOOKUP), source: anchor,
        expected: [canonicalJson(anchor.ref as unknown as JsonValue)] },
      { index: indexOf(SESSION_REPLY_BY_HANDLER_LOOKUP), source: message,
        expected: [sessionMessageRefKey(message.ref)] },
    ];
    for (const entry of cases) {
      const values = entry.index.paths.map((path) => valueAt(entry.source, path));
      const found = await base.records.lookup({ index: entry.index.name, values, limit: 10 });
      expect(found.status, entry.index.name).toBe('ready');
      if (found.status === 'ready') {
        expect(found.value.records.map((record) => record.refKey).sort(), entry.index.name)
          .toEqual([...entry.expected].sort());
      }
      // The foreign probe changes ONLY the workspace path value.
      const foreign = entry.index.paths.map((path, position) =>
        path.endsWith('workspaceId') ? 's1-other-workspace' : values[position]!);
      const empty = await base.records.lookup({ index: entry.index.name, values: foreign, limit: 10 });
      expect(empty.status, `${entry.index.name} foreign`).toBe('ready');
      if (empty.status === 'ready') expect(empty.value.records, `${entry.index.name} foreign`).toEqual([]);
    }
  });

  it('SV03: IDX-S2 returns the original claim runRef from old-format outbox bytes, and SQLite indexes a row written before the new schema existed', async () => {
    const b2 = await open(kind);
    const claim = b2.claim;
    const values: LookupValue[] = [claim.task.projectId, claim.workspaceId, claim.sessionRef.sessionId];
    // Select the frozen pre-S1 keys explicitly. Do not ask today's outbox
    // encoder to manufacture the legacy encoding used by both backends.
    const oldClaim = { task: claim.task, planRef: claim.planRef, workspaceId: claim.workspaceId,
      sessionRef: claim.sessionRef, sessionRevision: claim.sessionRevision, generation: claim.generation,
      runRef: claim.runRef, attemptRef: claim.attemptRef, outboxRef: claim.outboxRef, claimedAt: claim.claimedAt };
    const outbox = encodedLiteral(JSON.stringify({ ref: claim.outboxRef, revision: 1,
      schemaVersion: 1, status: 'pending', claim: oldClaim }), TASK_CLAIM_OUTBOX_SCHEMA_ID, 1);
    const decoded = decodeDispatchOutboxEntry(outbox);
    expect(decoded.status).toBe('decoded');
    if (decoded.status === 'decoded') expect(decoded.value.claim.runRef).toEqual(claim.runRef);

    const assertLookup = async (records: Records): Promise<void> => {
      const first = await records.lookup({ index: WORK_EXECUTION_BY_SESSION_LOOKUP, values, limit: 10 });
      expect(first.status, 'first IDX-S2 read').toBe('ready');
      if (first.status !== 'ready') throw new Error(JSON.stringify(first));
      expect(first.value.records).toHaveLength(1);
      const found = first.value.records[0];
      if (found === undefined) throw new Error('IDX-S2 did not return the seeded outbox row');
      expect(found.refKey).toBe(dispatchOutboxRefKey(claim.outboxRef));
      const reopened = decodeDispatchOutboxEntry(found);
      expect(reopened.status).toBe('decoded');
      if (reopened.status === 'decoded') expect(reopened.value.claim.runRef).toEqual(claim.runRef);
      const second = await records.lookup({ index: WORK_EXECUTION_BY_SESSION_LOOKUP, values, limit: 10 });
      expect(second.status, 'second IDX-S2 read').toBe('ready');
    };

    if (kind === 'memory') {
      const backend = createInMemoryRecordBackend({ schemas: outboxSchemas(true) });
      const receipts = new Map<string, string>();
      const commit = backend.records.commit.bind(backend.records);
      backend.records.commit = async batch => {
        const result = await commit(batch);
        if (result.status === 'committed') receipts.set(result.identityKey, batch.fingerprint);
        return result;
      };
      try {
        await seedOldOutbox(backend.records, outbox);
        const before = await memoryOutboxCounts(backend.records, receipts);
        expect(before).toEqual({ records: 1, events: 1, receipts: 1 });
        await assertLookup(backend.records);
        expect(await memoryOutboxCounts(backend.records, receipts)).toEqual(before);
      } finally { await backend.close(); }
    } else {
      const directory = await mkdtemp(join(tmpdir(), 's1-sv03-'));
      try {
        const ledger = join(directory, 'ledger.sqlite');
        const writing = createSqliteRecordBackend({ path: ledger, schemas: outboxSchemas(false) });
        let before: ReturnType<typeof sqliteCounts>;
        try {
          expect(sqliteCounts(ledger)).toEqual({ records: 0, events: 0, receipts: 0 });
          await seedOldOutbox(writing.records, outbox);
          before = sqliteCounts(ledger);
          expect(before).toEqual({ records: 1, events: 1, receipts: 1 });
        } finally { await writing.close(); }
        const reopened = createSqliteRecordBackend({ path: ledger, schemas: outboxSchemas(true) });
        try {
          expect(sqliteCounts(ledger)).toEqual(before);
          await assertLookup(reopened.records);
          expect(sqliteCounts(ledger)).toEqual(before);
          const persisted = await reopened.records.readMany([outbox.refKey]);
          if (persisted.status !== 'ready') throw new Error(JSON.stringify(persisted));
          expect(JSON.parse(persisted.value.records[0]!.json)).toEqual(JSON.parse(outbox.json));
        } finally { await reopened.close(); }
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
  });
  it('SV04: a copy stays distinct from two continuation successors of the same predecessor', async () => {
    const b2 = await open(kind);
    const base = b2.base;
    await observeStore(base);
    const history = workHistory(b2);
    const predecessor = b2.claim.sessionRef;
    const continuation: SessionProvenanceV1 = { schemaVersion: 1, kind: 'continuation', from: predecessor,
      reason: 'interrupted', task: b2.claim.task };
    const first = await createSession(base, 'sv04-continuation-1', { provenance: continuation });
    const second = await createSession(base, 'sv04-continuation-2', { provenance: continuation });
    const copyRequestId = 'sv04-copy-1';
    const planned = plannedSession(base, copyRequestId);
    const message = await history.copyMessage(predecessor, planned);
    const copyProvenance: SessionProvenanceV1 = { schemaVersion: 1, kind: 'readonly_copy', from: predecessor, messageRef: message.ref };
    const copy = await createSession(base, copyRequestId, { provenance: copyProvenance });
    expect(copy.ref).toEqual(planned);
    const found = await base.records.lookup({ index: SESSION_BY_PROVENANCE_LOOKUP,
      values: [base.scope.projectId, base.scope.workspaceId, predecessor.sessionId], limit: 10 });
    if (found.status !== 'ready') throw new Error(JSON.stringify(found));
    const decoded = found.value.records.map(record => {
      const value = decodeSessionRecord(record);
      if (value.status !== 'decoded') throw new Error(value.reason);
      return { ref: value.value.ref, provenance: value.value.provenance };
    }).sort((a, b) => key(a.ref).localeCompare(key(b.ref)));
    expect(decoded).toEqual([
      { ref: first.created.value.ref, provenance: continuation },
      { ref: second.created.value.ref, provenance: continuation },
      { ref: copy.created.value.ref, provenance: copyProvenance },
    ].sort((a, b) => key(a.ref).localeCompare(key(b.ref))));
    expect(found.value.next).toBeNull();
  });
  it('SV05: a bogus provenance kind is refused by the decoder AND by the creation entry, which writes nothing', async () => {
    const encoded = encodedSessionJson({
      ...baseSessionRecord(),
      provenance: { schemaVersion: 1, kind: 'bogus', from: { projectId: P, sessionId: 'S0' } },
    } as unknown as Record<string, unknown>);
    const decoded = decodeSessionRecord(encoded);
    expect(decoded.status).toBe('invalid');
    expect(sessionRecordValidator(encoded).status).toBe('invalid');
    // Never swallowed into the legacy null default.
    expect(decoded.status === 'decoded').toBe(false);

    // The same bad field through the real creation entry: invalid, zero writes.
    const b2 = await open(kind);
    const base = b2.base;
    // Read physical counts on the backend shared by the directory owner.
    const audit = await observeStore(base);
    const before = await audit.counts();
    const directory = sessionOwners(base).directory;
    const admitted = await directory.admitSessionCreation(base.ctx, {
      meta: { requestId: 's1-sv05-bogus-admission', expected: [] },
      input: { workspace: base.scope,
        kernelStore: { adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store' },
        role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
        recommendedRefs: [], initialLinks: [],
        provenance: { schemaVersion: 1, kind: 'bogus' } as unknown as SessionProvenanceV1 },
    });
    expect(admitted).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (admitted.status !== 'rejected') throw new Error('bogus provenance must be rejected');
    expect(admitted.reason.length).toBeGreaterThan(0);
    expect(await audit.counts(), 'a refused creation writes nothing').toEqual(before);
  });

  it('SV42: a Session archive request whose execution kind is bogus is refused by the decoder', () => {
    const encoded = encodedSessionJson({
      ...baseSessionRecord(),
      archiveRequest: {
        schemaVersion: 1, requestId: 'a', requestedBy: { kind: 'human', id: 'u1' }, requestedAt: T0,
        reason: 'archive', mode: 'operator', tasks: [], wait: null, execution: { kind: 'bogus' },
        executionPins: [], confirmUnknownStopped: false, receipt: { identityKey: 'i', fingerprint: 'f' },
      },
    } as unknown as Record<string, unknown>);
    expect(decodeSessionRecord(encoded).status).toBe('invalid');
  });

  it('SV43: a complete valid anchor whose outer revision disagrees with its body revision is refused by the decoder', () => {
    const body: SessionAnomalyAnchorV1 = {
      ref: { aggregateType: 'SessionAnomalyAnchor', projectId: P, goalId: 'g', runId: 'r0' },
      revision: 1, schemaVersion: 1, workspaceId: W, task: { projectId: P, goalId: 'g', taskId: 'A' },
      planRef: { aggregateType: 'PlanRevision', projectId: P, planId: 'plan' },
      lineHead: { projectId: P, sessionId: 'S' }, sessionRef: { projectId: P, sessionId: 'S' },
      role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      runRef: { aggregateType: 'Run', projectId: P, goalId: 'g', runId: 'r0' },
      attemptRef: { aggregateType: 'TaskAttempt', projectId: P, goalId: 'g', taskId: 'A', attemptId: 'at0' },
      cause: 'archive_interrupted', archiveRequestId: 'a',
      archiveRequestReceipt: { identityKey: 'a-identity', fingerprint: 'a-fingerprint' },
      archivedBy: { kind: 'human', id: 'u1' }, recordedAt: T0,
      changedFiles: { source: 'kernel', status: 'known', confirmed: [], possible: [], omitted: 0,
        baseCommit: null, runBaselineKnown: false, reason: null },
      resultVerification: 'not_checked',
    };
    // Only the outer revision is wrong; the body itself is complete and valid.
    const record: EncodedRecord = {
      refKey: canonicalJson(body.ref as unknown as JsonValue),
      schemaId: SESSION_ANOMALY_SCHEMA_ID,
      revision: 2,
      json: JSON.stringify(body),
    };
    expect(decodeSessionAnomalyAnchor(record).status).toBe('invalid');
  });

  it('SV44: provenance.from.projectId disagreeing with the session ref project is refused by the decoder', () => {
    const encoded = encodedSessionJson({
      ...baseSessionRecord(),
      provenance: { schemaVersion: 1, kind: 'continuation', from: { projectId: 'other-project', sessionId: 'S0' },
        reason: 'archived', task: { projectId: P, goalId: 'g', taskId: 'A' } },
    } as unknown as Record<string, unknown>);
    expect(decodeSessionRecord(encoded).status).toBe('invalid');
  });
});


