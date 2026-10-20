/**
 * Speed round 2 (R2-5, decision 66): the open-time lookup-index migration seen
 * only through the public RecordStore ports. Every assertion goes through
 * `commit`, `lookup` or `countLookup`; no test reads `sqlite_master`, dbstat or
 * the file. Whether an index exists never changes an answer, so these are
 * characterization tests (they pass before round 2 as well): T4 (two backends
 * on one file), the (C') drop rule in both orders, and a fresh full-platform
 * open. Sizes, timings and re-prepare counts are the lead's copy measurement.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { GoalRecordTransactionPort, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordCountPort, RecordLookupIndex, RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { commitRow, keyV, keyW, recordSchema, typed } from '../helpers/SP-record-store-support.js';
import { platformRecordSchemas } from '../state/invariants.js';
import { NOTE_RECORD_SCHEMAS, S4_NOTE_BY_REVIEW_STATUS_LOOKUP } from '../../src/core/work-graph/persistence/note-record-codecs.js';
import { DECISION_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { LINE_SETTINGS_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/line-settings-codecs.js';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

const changedEvents: RecordBackendSchemas['events'] = [
  { eventType: 'Changed', schemaVersion: 1, validate: (value) => ({ status: 'decoded', value }) },
];

type Backend = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordCountPort;
  close(): Promise<void>;
};

async function openSqlite(path: string, schemas: RecordBackendSchemas): Promise<Backend> {
  return createSqliteRecordBackend({ path, schemas }) as unknown as Backend;
}

async function newPath(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return join(dir, 'records.sqlite');
}

// W and V share the value `shared`; both indexes exist under the same names.
const wIndex: RecordLookupIndex = { name: 'r2-w', aggregateType: 'W', paths: ['group'] };
const vIndex: RecordLookupIndex = { name: 'r2-v', aggregateType: 'V', paths: ['group'] };

const bothSchemas: RecordBackendSchemas = {
  records: [recordSchema('W'), recordSchema('V')], events: changedEvents, lookups: [wIndex, vIndex],
};
const wOnlySchemas: RecordBackendSchemas = {
  records: [recordSchema('W'), recordSchema('V')], events: changedEvents, lookups: [wIndex],
};
// B registers W with a changed path set under the same name, so B's plan drops
// A's W index and creates a new one while A holds cached W and V statements.
const wChangedSchemas: RecordBackendSchemas = {
  records: [recordSchema('W'), recordSchema('V')], events: changedEvents,
  lookups: [{ name: 'r2-w', aggregateType: 'W', paths: ['group', 'status'] }],
};

// --------------------------------------------------------------------------
// T4: two backends on one file; B changes W only.
// --------------------------------------------------------------------------

it('SP-40 sqlite: a second backend changing one type leaves the first backend\'s answers and commits intact', async () => {
  const path = await newPath('sp40-');
  const a = await openSqlite(path, bothSchemas);
  let b: Backend | undefined;
  try {
    expect(await commitRow(a, 'w1', typed('W', 'w1', { group: 'shared' }))).toMatchObject({ status: 'committed' });
    expect(await commitRow(a, 'w2', typed('W', 'w2', { group: 'shared' }))).toMatchObject({ status: 'committed' });
    expect(await commitRow(a, 'v1', typed('V', 'v1', { group: 'shared' }))).toMatchObject({ status: 'committed' });
    const wBefore = await a.records.lookup({ index: 'r2-w', values: ['shared'], limit: 10 });
    const vBefore = await a.records.lookup({ index: 'r2-v', values: ['shared'], limit: 10 });
    expect(wBefore).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w1') }, { refKey: keyW('w2') }] } });
    expect(vBefore).toMatchObject({ status: 'ready', value: { records: [{ refKey: keyV('v1') }] } });

    b = await openSqlite(path, wChangedSchemas);
    // B answers on the W index it just dropped and recreated.
    expect(await b.records.lookup({ index: 'r2-w', values: ['shared', null], limit: 10 }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w1') }, { refKey: keyW('w2') }] } });

    // A's W and V pages are unchanged by B's DDL.
    expect(await a.records.lookup({ index: 'r2-w', values: ['shared'], limit: 10 })).toEqual(wBefore);
    expect(await a.records.lookup({ index: 'r2-v', values: ['shared'], limit: 10 })).toEqual(vBefore);

    // A commit A makes to V after the migration is visible to A.
    expect(await commitRow(a, 'v2', typed('V', 'v2', { group: 'shared' }))).toMatchObject({ status: 'committed' });
    expect(await a.records.lookup({ index: 'r2-v', values: ['shared'], limit: 10 }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyV('v1') }, { refKey: keyV('v2') }] } });
  } finally {
    if (b !== undefined) await b.close();
    await a.close();
  }

  const reopened = await openSqlite(path, bothSchemas);
  try {
    expect(await reopened.records.lookup({ index: 'r2-w', values: ['shared'], limit: 10 }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w1') }, { refKey: keyW('w2') }] } });
    expect(await reopened.records.lookup({ index: 'r2-v', values: ['shared'], limit: 10 }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyV('v1') }, { refKey: keyV('v2') }] } });
  } finally {
    await reopened.close();
  }
});

// --------------------------------------------------------------------------
// Drop rule (C'), order 1: the full set creates the file, a partial open keeps
// answering, a later full open answers for all.
// --------------------------------------------------------------------------

it('SP-41 sqlite: a partial open keeps answering on a file the full set created', async () => {
  const path = await newPath('sp41-');
  const seeded = await openSqlite(path, bothSchemas);
  try {
    expect(await commitRow(seeded, 'w1', typed('W', 'w1', { group: 'shared' }))).toMatchObject({ status: 'committed' });
    expect(await commitRow(seeded, 'v1', typed('V', 'v1', { group: 'shared' }))).toMatchObject({ status: 'committed' });
  } finally {
    await seeded.close();
  }

  const partial = await openSqlite(path, wOnlySchemas);
  try {
    expect(await partial.records.lookup({ index: 'r2-w', values: ['shared'], limit: 10 }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w1') }] } });
  } finally {
    await partial.close();
  }

  const full = await openSqlite(path, bothSchemas);
  try {
    expect(await full.records.lookup({ index: 'r2-w', values: ['shared'], limit: 10 }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w1') }] } });
    expect(await full.records.lookup({ index: 'r2-v', values: ['shared'], limit: 10 }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyV('v1') }] } });
  } finally {
    await full.close();
  }
});

// --------------------------------------------------------------------------
// Drop rule (C'), order 2: the partial set creates the file, the full open adds
// the missing type and answers for all, a later partial open still answers.
// --------------------------------------------------------------------------

it('SP-42 sqlite: a full open adds the missing type to a partial file and answers for all', async () => {
  const path = await newPath('sp42-');
  const partial = await openSqlite(path, wOnlySchemas);
  try {
    expect(await commitRow(partial, 'w1', typed('W', 'w1', { group: 'shared' }))).toMatchObject({ status: 'committed' });
  } finally {
    await partial.close();
  }

  const full = await openSqlite(path, bothSchemas);
  try {
    expect(await full.records.lookup({ index: 'r2-w', values: ['shared'], limit: 10 }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w1') }] } });
    expect(await full.records.lookup({ index: 'r2-v', values: ['shared'], limit: 10 }))
      .toMatchObject({ status: 'ready', value: { records: [] } });
    expect(await commitRow(full, 'v1', typed('V', 'v1', { group: 'shared' }))).toMatchObject({ status: 'committed' });
    expect(await full.records.lookup({ index: 'r2-v', values: ['shared'], limit: 10 }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyV('v1') }] } });
  } finally {
    await full.close();
  }

  const reopenedPartial = await openSqlite(path, wOnlySchemas);
  try {
    expect(await reopenedPartial.records.lookup({ index: 'r2-w', values: ['shared'], limit: 10 }))
      .toMatchObject({ status: 'ready', value: { records: [{ refKey: keyW('w1') }] } });
  } finally {
    await reopenedPartial.close();
  }
});

// --------------------------------------------------------------------------
// Fresh open with the full platform registration (characterization).
// --------------------------------------------------------------------------

it('SP-43 sqlite: a fresh open with the full platform registration succeeds and answers lookups', async () => {
  const platform = platformRecordSchemas();
  const schemas: RecordBackendSchemas = {
    records: [...platform.records, ...NOTE_RECORD_SCHEMAS.records, ...DECISION_RECORD_SCHEMAS.records, ...LINE_SETTINGS_RECORD_SCHEMAS.records],
    events: [...platform.events, ...NOTE_RECORD_SCHEMAS.events, ...DECISION_RECORD_SCHEMAS.events, ...LINE_SETTINGS_RECORD_SCHEMAS.events],
    lookups: [...(platform.lookups ?? []), ...(NOTE_RECORD_SCHEMAS.lookups ?? []), ...(DECISION_RECORD_SCHEMAS.lookups ?? []), ...(LINE_SETTINGS_RECORD_SCHEMAS.lookups ?? [])],
  };
  const path = await newPath('sp43-');
  const backend = await openSqlite(path, schemas);
  try {
    expect(await backend.records.lookup({
      index: S4_NOTE_BY_REVIEW_STATUS_LOOKUP, values: ['project-1', 'goal-1', 'open'], limit: 5,
    })).toMatchObject({ status: 'ready', value: { records: [] } });
  } finally {
    await backend.close();
  }
});
