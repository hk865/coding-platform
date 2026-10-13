/**
 * W231 (spec §2.3, §6 W231; second audit): the RecordStore mechanical
 * commit-cursor binding field set is the closed public set `since`, `until`,
 * `unavailableSince` and `responseSince`. W231 is optional mechanical
 * coverage, not E3 domain evidence: it drives only the public RecordStore
 * constructor/commit boundaries and never reads a record back. Domain
 * persistence is proven at E3.
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import type { CommitCursorBinding, EncodedRecord, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';

const refKey = (id: string) => JSON.stringify({ aggregateType: 'Project', projectId: id });

/**
 * Type-level check of W228: these declarations do not compile unless
 * `ports.ts` widened the public `CommitCursorBinding` field union with the two
 * notice positions (no casts here on purpose).
 */
const NOTICE_CURSOR_FIELDS: ReadonlyArray<CommitCursorBinding['field']> = ['unavailableSince', 'responseSince'];

const noticeSchemas: RecordBackendSchemas = {
  records: [{
    schemaId: 'NoticeProbe@1',
    aggregateType: 'Project',
    commitCursorFields: NOTICE_CURSOR_FIELDS,
    validate: record => {
      const body = JSON.parse(record.json) as Record<string, unknown>;
      for (const field of NOTICE_CURSOR_FIELDS) {
        const value = body[field];
        if (value !== null && value !== undefined && typeof value !== 'string') {
          return { status: 'invalid', reason: `${field} must be a cursor string or null` };
        }
      }
      return { status: 'decoded', value: record };
    },
  }],
  events: [{ eventType: 'NoticeProbeEvent', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
};

function noticeRecord(id: string, revision: number): EncodedRecord {
  const ref = { aggregateType: 'Project', projectId: id };
  return {
    refKey: refKey(id), schemaId: 'NoticeProbe@1', revision,
    json: JSON.stringify({ ref, revision, unavailableSince: null, responseSince: null }),
  };
}

function noticeCommit(id: string, fields: ReadonlyArray<CommitCursorBinding['field']>): PreparedCommit {
  const event = { eventId: `event-${id}`, eventType: 'NoticeProbeEvent', schemaVersion: 1, occurredAt: '2026-10-13T00:00:00.000Z' };
  return {
    identityKey: id, fingerprint: id,
    guards: [{ refKey: refKey(id), expectedRevision: null }],
    records: [noticeRecord(id, 1)], claims: [], indexGuards: [], indexChanges: [],
    events: [{ ...event, json: JSON.stringify(event) }],
    commitCursorBindings: fields.map(field => ({ refKey: refKey(id), field })),
  };
}

describe('W231 the binding field set is a closed public whitelist', () => {
  it('W231 accepts a backend schema declaring the two notice cursor fields and refuses one outside the set', async () => {
    // The two new fields are accepted as public `commitCursorFields` values.
    const accepted = createInMemoryRecordBackend({ schemas: noticeSchemas });
    await accepted.close();
    // A field outside the closed set is refused by the public constructor.
    expect(() => createInMemoryRecordBackend({
      schemas: {
        records: [{
          schemaId: 'NoticeProbe@1', aggregateType: 'Project',
          commitCursorFields: ['other'] as unknown as ReadonlyArray<CommitCursorBinding['field']>,
          validate: record => ({ status: 'decoded', value: record }),
        }],
        events: [],
      },
    })).toThrow(/commitCursorFields/);
  });

  it('W231 refuses a public commit binding a notice cursor its record schema did not register', async () => {
    // This schema registers only `since`, so a commit binding `responseSince`
    // must be refused before any write.
    const schemas: RecordBackendSchemas = {
      records: [{ ...noticeSchemas.records[0]!, commitCursorFields: ['since'] }],
      events: noticeSchemas.events,
    };
    const backend = createInMemoryRecordBackend({ schemas });
    try {
      const result = await backend.records.commit(noticeCommit('notice', ['responseSince']));
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally { await backend.close(); }
  });
});
