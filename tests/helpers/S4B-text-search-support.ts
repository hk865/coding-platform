/**
 * Slice 4B G1 support: a test full-text index and both RecordStore backends.
 *
 * What this file builds and through which public calls:
 *  - `open(kind)` opens the real in-memory or SQLite RecordStore backend with
 *    the `s4b-text` test full-text registration (`text.paths` on a Widget
 *    schema);
 *  - every record is written through the backend's public `commit` and every
 *    assertion goes through the public `searchText` (never the database).
 *
 * Expected values live in the test file as literals; nothing here computes them.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type {
  EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas,
} from '../../src/core/record-store/ports.js';
import type {
  RecordCountPort, RecordLookupIndex, RecordLookupPort, RecordOrderedLookupPort, RecordTextSearchPort,
} from '../../src/core/record-store/lookup-ports.js';

/** A fixed instant so fixtures are deterministic. */
const at = '2026-10-15T00:00:00.000Z';

/** The test full-text index: the project equality prefix + the three text paths. */
export const textIndex: RecordLookupIndex = {
  name: 's4b-text',
  aggregateType: 'Widget',
  // The real `NoteHead` carries the project only inside its ref, so the prefix
  // path is nested; both backends must resolve it from the record body.
  paths: ['ref.projectId'],
  text: { paths: ['topic', 'conclusion', 'body'] },
};

export const widgetSchemas: RecordBackendSchemas = {
  records: [{
    schemaId: 'Widget@1',
    aggregateType: 'Widget',
    validate: (record) => {
      const body: unknown = JSON.parse(record.json);
      if (typeof body !== 'object' || body === null || !('ref' in body)) {
        return { status: 'invalid', reason: 'widget ref missing' };
      }
      return { status: 'decoded', value: record };
    },
  }],
  events: [{ eventType: 'WidgetChanged', schemaVersion: 1, validate: (event) => ({ status: 'decoded', value: event }) }],
  lookups: [textIndex],
};

/** A registered index with no `text` registration; the port must refuse it. */
export const plainIndex: RecordLookupIndex = {
  name: 's4b-plain',
  aggregateType: 'Widget',
  paths: ['ref.projectId'],
};

/** The same Widget schemas with a caller-supplied full-text registration. */
export function withTextIndex(index: RecordLookupIndex): RecordBackendSchemas {
  return { ...widgetSchemas, lookups: [index] };
}

/** The same Widget schemas with a caller-supplied lookup list. */
export function withLookups(indexes: readonly RecordLookupIndex[]): RecordBackendSchemas {
  return { ...widgetSchemas, lookups: [...indexes] };
}

export type TextBackend = {
  records: GoalRecordTransactionPort & RecordTextSearchPort & RecordLookupPort & RecordOrderedLookupPort & RecordCountPort;
  close(): Promise<void>;
};

/** The canonical refKey of a Widget ref, built here so it is not a product call. */
export function keyOf(projectId: string, widgetId: string): string {
  return JSON.stringify({ aggregateType: 'Widget', projectId, widgetId });
}

export function widget(
  projectId: string,
  widgetId: string,
  body: Record<string, unknown>,
  revision = 1,
): EncodedRecord {
  const ref = { aggregateType: 'Widget', projectId, widgetId };
  return {
    refKey: keyOf(projectId, widgetId),
    schemaId: 'Widget@1',
    revision,
    json: JSON.stringify({ ref, revision, ...body }),
  };
}

function event(id: string): EncodedDomainEvent {
  return {
    eventId: id,
    eventType: 'WidgetChanged',
    schemaVersion: 1,
    occurredAt: at,
    json: JSON.stringify({ eventId: id, eventType: 'WidgetChanged', schemaVersion: 1, occurredAt: at }),
  };
}

export function change(
  id: string,
  record: EncodedRecord,
  expectedRevision: number | null = null,
): PreparedCommit {
  return {
    identityKey: id,
    fingerprint: 'fingerprint-' + id,
    guards: [{ refKey: record.refKey, expectedRevision }],
    records: [record],
    events: [event(id)],
    claims: [],
    indexGuards: [],
    indexChanges: [],
  };
}

export type OpenOptions = {
  schemas?: RecordBackendSchemas;
  path?: string;
};

export async function open(
  kind: 'memory' | 'sqlite',
  options: OpenOptions = {},
): Promise<{ backend: TextBackend; path?: string; dir?: string | undefined }> {
  if (kind === 'memory') {
    return {
      backend: createInMemoryRecordBackend({
        schemas: options.schemas ?? widgetSchemas,
      }),
    };
  }
  const dir = options.path === undefined ? await mkdtemp(join(tmpdir(), 's4b-text-')) : undefined;
  const path = options.path ?? join(dir!, 'records.sqlite');
  return {
    backend: createSqliteRecordBackend({
      path,
      schemas: options.schemas ?? widgetSchemas,
    }),
    path,
    dir,
  };
}

export async function seed(
  backend: TextBackend,
  rows: readonly EncodedRecord[],
  prefix: string,
  expectedRevision: number | null = null,
): Promise<void> {
  for (const [position, row] of rows.entries()) {
    const result = await backend.records.commit(change(`${prefix}-${String(position)}`, row, expectedRevision));
    if (result.status !== 'committed') {
      throw new Error(`seed commit failed: ${result.status} ${'reason' in result ? result.reason : ''}`);
    }
  }
}

/** Write many records in ONE commit (used by the >1000-candidate fixture). */
export async function seedBatch(
  backend: TextBackend,
  rows: readonly EncodedRecord[],
  id: string,
): Promise<void> {
  const result = await backend.records.commit({
    identityKey: id,
    fingerprint: 'fingerprint-' + id,
    guards: rows.map((row) => ({ refKey: row.refKey, expectedRevision: null })),
    records: [...rows],
    events: [event(id)],
    claims: [],
    indexGuards: [],
    indexChanges: [],
  });
  if (result.status !== 'committed') {
    throw new Error(`seedBatch commit failed: ${result.status} ${'reason' in result ? result.reason : ''}`);
  }
}

type SearchRequest = {
  index: string;
  values: readonly string[];
  terms: readonly string[];
  /** S1.9: absent means `'all'`; `'any'` matches at least one term. */
  match?: 'all' | 'any';
  limit: number;
  after?: string;
};

export async function search(backend: TextBackend, request: SearchRequest) {
  const result = await backend.records.searchText(request);
  if (result.status !== 'ready') throw new Error(`searchText failed: ${result.code}: ${result.reason}`);
  return result.value;
}

export function refs(page: { records: readonly EncodedRecord[] }): string[] {
  return page.records.map((record) => record.refKey);
}
