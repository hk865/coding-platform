/**
 * Slice 1 §5.3 SV02, SV04, SV05, SV42–SV44: the new codecs and the six new
 * lookup indexes.
 *
 * Service rows run on both real backends. The backend is opened exactly like
 * `tests/work-graph/A2-requeue-service.test.ts:74` (`open`): the B2 execution
 * fixture over the real Memory/SQLite RecordStore, extended here with the
 * slice-1 registrations (`SessionMessage`, `SessionAnomalyAnchor`, `QueryRun`,
 * `SessionWorkLinkChanged`) so every one of the six indexes is registered in
 * the store (CORRECTION G2).
 *
 * SV04/SV05 reach the real Session creation entry. SV05/SV42/SV43/SV44 feed a
 * malformed encoding straight to the pure decoders and registered validators; a
 * broken record is never written to a database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EncodedRecord, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { LookupValue } from '../../src/core/record-store/lookup-ports.js';
import type { SessionProvenanceV1, SessionRecord } from '../../src/contracts/core/session.js';
import type { SessionAnomalyAnchorV1 } from '../../src/contracts/session-anomaly.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import {
  SESSION_RECORD_SCHEMAS, decodeSessionRecord,
  sessionAggregateRefKey,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';
import {
  SESSION_MESSAGE_RECORD_SCHEMAS,
  sessionMessageRefKey,
} from '../../src/core/work-graph/sessions/message-record-codecs.js';
import {
  SESSION_ANOMALY_RECORD_SCHEMAS, SESSION_ANOMALY_SCHEMA_ID, decodeSessionAnomalyAnchor,
} from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import {
  QUERY_JOB_RECORD_SCHEMAS,
} from '../../src/core/work-graph/queries/query-record-codecs.js';
import {
  TASK_CLAIM_RECORD_SCHEMAS, dispatchOutboxRefKey,
} from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import {
  QUERY_RUN_BY_SESSION_LOOKUP, SESSION_ANOMALY_BY_GOAL_LOOKUP, SESSION_ANOMALY_BY_TASK_LOOKUP,
  SESSION_BY_PROVENANCE_LOOKUP, SESSION_REPLY_BY_HANDLER_LOOKUP, SLICE1_LOOKUP_INDEXES,
  WORK_EXECUTION_BY_SESSION_LOOKUP, type Slice1LookupIndexV1,
} from '../../src/core/work-graph/model/session-facts-contracts.js';
import { createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';

import { t0, key, committed, s1Schemas, observeStore, sessionOwners,
  createSession, plannedSession, workHistory, pendingQuery, archiveWait, archiveControlRequest } from '../helpers/S1-session-facts-fixture.js';
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

function baseSessionRecord(sessionId = 'S'): SessionRecord {
  return {
    ref: { aggregateType: 'Session', projectId: P, sessionId },
    revision: 1,
    kernel: { adapterId: 's1-codec-adapter', kernelSessionId: `kernel-${sessionId}` },
    lifecycle: 'active', health: 'available', healthConclusion: null,
    role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
    workspaceId: W, lastExecutionRef: null, occupancy: null, historyCursor: null,
    createdAt: T0, archivedAt: null, provenance: { schemaVersion: 1, kind: 'new' },
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
// Cases                                                                      //
// -------------------------------------------------------------------------- //

describe.each(['memory', 'sqlite'] as const)('S1 codecs and indexes (%s)', (kind) => {
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
        executionPins: [], confirmUnknownStopped: false, condition: null,
        receipt: { identityKey: 'i', fingerprint: 'f' },
      },
    } as unknown as Record<string, unknown>);
    expect(decodeSessionRecord(encoded).status).toBe('invalid');
  });

  it.each([
    ['SV45: a secretary archive request carrying its trusted condition decodes with the condition intact',
      'secretary_handoff', 'the handoff completed',
      { kind: 'secretary_handoff', operation: { aggregateType: 'CoreOperation', projectId: P, operationId: 'op-1' } }, 'decoded', ''],
    ['SV46: an archive condition whose operation ref is malformed is refused with one reason naming the condition',
      'secretary_handoff', 'the handoff completed',
      { kind: 'secretary_handoff', operation: { aggregateType: 'CoreOperation', projectId: P, operationId: '' } }, 'invalid', 'condition'],
    ['SV48: a secretary archive request with a null condition is refused',
      'secretary_handoff', 'the handoff completed',
      null, 'invalid', 'archiveRequest condition must match its secretary mode'],
    ['SV48: an operator archive request carrying a condition is refused',
      'operator', 'archive',
      { kind: 'secretary_handoff', operation: { aggregateType: 'CoreOperation', projectId: P, operationId: 'op-1' } },
      'invalid', 'the archiveRequest condition is only allowed for a secretary mode'],
  ] as [string, 'secretary_handoff' | 'operator', string, unknown, 'decoded' | 'invalid', string][])('%s',
  (_name, mode, reason, condition, expected, reasonFragment) => {
    const encoded = encodedSessionJson({
      ...baseSessionRecord(),
      archiveRequest: {
        schemaVersion: 1, requestId: 'a', requestedBy: { kind: 'system', id: 'workflow' }, requestedAt: T0,
        reason, mode, tasks: [], wait: null, execution: { kind: 'none' }, executionPins: [],
        confirmUnknownStopped: false, condition, receipt: { identityKey: 'i', fingerprint: 'f' },
      },
    } as unknown as Record<string, unknown>);
    const decoded = decodeSessionRecord(encoded);
    if (expected === 'decoded') {
      expect(decoded).toMatchObject({ status: 'decoded', value: { archiveRequest: { mode: 'secretary_handoff', condition } } });
      return;
    }
    expect(decoded.status).toBe('invalid');
    if (decoded.status !== 'invalid') throw new Error('a malformed archive condition must be refused');
    expect(decoded.reason).toContain(reasonFragment);
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


