/**
 * H-records (pure codec, memory only, A5): record 5's one bundle — the record
 * round trip with and without `consumedBy`, the cross-field refusal against its
 * binding, both replay-event registrations, the lookup declaration, and the
 * non-committing consumption contribution's CAS shape.
 */
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type {
  HandoffBriefBindingV1, HandoffBriefMaterialV1,
} from '../../src/contracts/handoff-brief.js';
import type {
  OperationRef,
} from '../../src/contracts/core/operations.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import {
  HANDOFF_BRIEF_RECORD_SCHEMAS, handoffBriefConsumedCodec, handoffBriefRecordedCodec, workHandoffBriefCodec,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';
import {
  workHandoffBriefConsumption, type WorkHandoffBriefV1,
} from '../../src/core/work-graph/state/work-handoff-brief.js';

const projectId = 'p1';
const workspaceId = 'w1';
const operation: OperationRef = { aggregateType: 'CoreOperation', projectId, operationId: 'op1' };
const source: SessionRef = { projectId, sessionId: 's1' };
const successor: SessionRef = { projectId, sessionId: 's2' };
const task: TaskTriple = { projectId, goalId: 'g1', taskId: 't1' };
const run: RunRef = { aggregateType: 'Run', projectId, goalId: 'g1', runId: 'r1' };
const otherRun: RunRef = { aggregateType: 'Run', projectId, goalId: 'g1', runId: 'r2' };
const digest = 'a'.repeat(64);

const material: HandoffBriefMaterialV1 = {
  duty: 'executor',
  tasks: [{ task, phase: 'running', lastResult: null }],
  conclusion: { absent: 'no_formal_final_answer' },
  noteIndex: [],
  understanding: [{ noteId: 'u1', version: 1 }],
  oldLine: source,
};

const binding: HandoffBriefBindingV1 = {
  operation, source, successor, duty: 'executor', digest,
};

const record: WorkHandoffBriefV1 = {
  ref: { aggregateType: 'HandoffBrief', projectId, sessionId: successor.sessionId, operationId: operation.operationId },
  revision: 3,
  workspaceId,
  operation,
  source,
  duty: 'executor',
  tasks: [task],
  binding,
  digest,
  material,
  consumedBy: null,
  since: 'c0000000001' as CommitCursor,
};

type Body = Record<string, unknown>;
const edit = (value: object, change: (body: Body) => void): Body => {
  const body = structuredClone(value) as Body;
  change(body);
  return body;
};

describe('S7C-H record 5: the codec round trip', () => {
  it('stores and reads back an unconsumed record', () => {
    const encoded = workHandoffBriefCodec.encode(record);
    expect(workHandoffBriefCodec.decode(encoded)).toEqual({ status: 'decoded', value: record });
  });

  it('stores and reads back a consumed record', () => {
    const consumed: WorkHandoffBriefV1 = { ...record, consumedBy: run, revision: 4 };
    const encoded = workHandoffBriefCodec.encode(consumed);
    expect(workHandoffBriefCodec.decode(encoded)).toEqual({ status: 'decoded', value: consumed });
  });

  it('registers the record, both replay events and the by-session lookup', () => {
    expect(HANDOFF_BRIEF_RECORD_SCHEMAS.records.map(entry => entry.aggregateType)).toEqual(['HandoffBrief']);
    expect(HANDOFF_BRIEF_RECORD_SCHEMAS.events.map(entry => entry.eventType).sort())
      .toEqual(['HandoffBriefConsumed', 'HandoffBriefRecorded']);
    expect(HANDOFF_BRIEF_RECORD_SCHEMAS.lookups).toContainEqual({
      name: 'work-handoff-brief-by-session',
      aggregateType: 'HandoffBrief',
      paths: ['ref.projectId', 'workspaceId', 'ref.sessionId'],
      orderBy: { path: 'since', valueType: 'text' },
    });
    const recorded = handoffBriefRecordedCodec.encode({
      eventId: 'e1', eventType: 'HandoffBriefRecorded', schemaVersion: 1, occurredAt: '2026-11-01T00:00:00.000Z',
      handoffBrief: record,
    });
    const consumed = handoffBriefConsumedCodec.encode({
      eventId: 'e2', eventType: 'HandoffBriefConsumed', schemaVersion: 1, occurredAt: '2026-11-01T00:00:01.000Z',
      handoffBrief: { ...record, consumedBy: run, revision: 4 },
    });
    expect(handoffBriefRecordedCodec.decode(recorded)).toMatchObject({ status: 'decoded' });
    expect(handoffBriefConsumedCodec.decode(consumed)).toMatchObject({ status: 'decoded' });
  });

  it('accepts the pending record the creation commit writes before `since` is bound', () => {
    const pending = { ...record, since: null };
    const encoded = handoffBriefRecordedCodec.encode({
      eventId: 'e3', eventType: 'HandoffBriefRecorded', schemaVersion: 1, occurredAt: '2026-11-01T00:00:00.000Z',
      handoffBrief: pending,
    });
    expect(handoffBriefRecordedCodec.decode(encoded)).toMatchObject({ status: 'decoded' });
  });
});

describe('rejects: a record whose identity fields disagree with its binding', () => {
  it.each<[string, Body, string]>([
    ['the operation', edit(record, (body) => {
      body.operation = { aggregateType: 'CoreOperation', projectId, operationId: 'op2' };
    }), 'the handoff brief operation disagrees with its binding'],
    ['the source', edit(record, (body) => {
      body.source = { projectId, sessionId: 's9' };
    }), 'the handoff brief source disagrees with its binding'],
    ['the duty', edit(record, (body) => { body.duty = 'adviser'; }),
      'the handoff brief duty disagrees with its binding'],
    ['the digest', edit(record, (body) => { body.digest = 'b'.repeat(64); }),
      'the handoff brief digest disagrees with its binding'],
  ])('refuses a record where %s differs', (_what, body, reason) => {
    expect(workHandoffBriefCodec.check(body)).toBe(reason);
  });
});

describe('S7C-H record 5: the one consumption contribution', () => {
  it('sets consumedBy and returns the old revision as the guard', () => {
    const consumed = workHandoffBriefConsumption(record, run, '2026-11-01T00:00:02.000Z');
    expect(consumed.record.consumedBy).toEqual(run);
    expect(consumed.record.revision).toBe(4);
    expect(consumed.record.since).toBe(record.since);
    expect(consumed.guard).toEqual({
      refKey: '{"aggregateType":"HandoffBrief","operationId":"op1","projectId":"p1","sessionId":"s2"}',
      expectedRevision: 3,
    });
  });

  it('returns the new revision for a second contribution', () => {
    const first = workHandoffBriefConsumption(record, run, '2026-11-01T00:00:02.000Z');
    const second = workHandoffBriefConsumption(first.record, otherRun, '2026-11-01T00:00:03.000Z');
    expect(second.guard.expectedRevision).toBe(4);
    expect(second.record.revision).toBe(5);
    expect(second.record.consumedBy).toEqual(otherRun);
  });
});
