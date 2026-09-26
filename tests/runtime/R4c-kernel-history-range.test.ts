/**
 * R4c.2b Kernel Session history range-read acceptance (DSH test-only stage).
 *
 * Frozen contract under test: `SqliteStores.read(sessionId, afterPosition, limit, options)`
 * resolves to `ReadSessionPage & { lastPosition: number }` where `lastPosition` is the
 * original Session tail position of the same read snapshot. It is the real last
 * `position`, not the header revision, not the returned page tail and not a record
 * COUNT. The existing field meanings stay: records with `position <= afterPosition`
 * are excluded, `nextPosition` drives the next page and `nextPosition === null` means
 * the page reached the snapshot tail.
 *
 * The current adapter is the frozen production skeleton: it still materializes the
 * whole Session (`#allRecords`) and slices a page, so the range cases here are
 * deliberately red. This file must keep loading and must not be skipped; it must not
 * fake the adapter, weaken the physical-read assertions or assert on wall-clock time.
 *
 * The range cases are observed without timing:
 *  - damage outside the requested page must not block a local page read;
 *  - a tail payload that is damaged must not hide the tail position;
 *  - an instrumented `node:sqlite` spy shows the statements and fetched row count
 *    during `read` only (fixture seeding happens before the spy is armed).
 *
 * Kernel `append`/replay full-history validation is intentionally kept, so a fresh
 * store must still fail closed when the history is corrupted.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import * as kernel from '../../vendor/coding-agent/dist/public-api.js';

const AT = '2026-09-25T00:00:00.000Z';
const SESSION_CREATED_POSITION = 1;

type Store = kernel.SqliteStores;
type Draft = kernel.SessionRecordDraft;

/** A structurally valid `turn.started` config that never reaches a provider. */
const CONFIG = {
  modelConfigId: 'r4c-range-fixture',
  limits: kernel.UNLIMITED_RUN_LIMITS,
  enabledToolSchemaDigest: 'a'.repeat(64),
  policyVersion: 'r4c-range-policy',
  sandboxProfileVersion: 'r4c-range-sandbox',
  baseConfigDigest: 'b'.repeat(64),
} as const;

const WORKSPACE = {
  identity: 'workspace-range',
  revision: '1',
  reference: 'workspace://range',
} as const;

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function options(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

function eventMeta(runId: string, turnId: string, sequence: number): kernel.EventMeta {
  return {
    schemaVersion: 1,
    eventId: `event-${runId}-${sequence}`,
    runId,
    turnId,
    sequence,
    occurredAt: AT,
    elapsedMs: 0,
  };
}

/**
 * One synthetic Turn that replays through the real projection: `turn.started` plus a
 * terminal `run.started` -> `run.cancelled` pair. No model or network is involved and
 * every draft is validated by the public `runSchema`/`agentEventSchema` before append.
 */
function turnDrafts(index: number, scope = 'fixture'): Draft[] {
  const run = kernel.runSchema.parse({
    schemaVersion: 1,
    runId: `${scope}-run-${index}`,
    turn: {
      turnId: `${scope}-turn-${index}`,
      userMessage: {
        schemaVersion: 1,
        messageId: `${scope}-user-${index}`,
        role: 'user',
        content: `question ${index}`,
      },
    },
    createdAt: AT,
  });
  const started = kernel.agentEventSchema.parse({
    type: 'run.started',
    meta: eventMeta(`${scope}-run-${index}`, `${scope}-turn-${index}`, 1),
    payload: {},
  });
  const cancelled = kernel.agentEventSchema.parse({
    type: 'run.cancelled',
    meta: eventMeta(`${scope}-run-${index}`, `${scope}-turn-${index}`, 2),
    payload: { reason: 'caller_requested' },
  });
  return [
    {
      recordId: `${scope}-turn-started-${index}`,
      schemaVersion: 1,
      recordedAt: AT,
      recordType: 'turn.started',
      payload: { run, config: CONFIG, workspace: WORKSPACE },
    },
    {
      recordId: `${scope}-run-started-${index}`,
      schemaVersion: 1,
      recordedAt: AT,
      recordType: 'agent.event',
      payload: { event: started },
    },
    {
      recordId: `${scope}-run-cancelled-${index}`,
      schemaVersion: 1,
      recordedAt: AT,
      recordType: 'agent.event',
      payload: { event: cancelled },
    },
  ];
}

async function newDatabase(prefix: string): Promise<{ root: string; databasePath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return { root, databasePath: path.join(root, 'kernel.sqlite') };
}

async function openStore(databasePath: string): Promise<Store> {
  const store = await kernel.SqliteStores.open(databasePath);
  cleanups.push(() => store.close());
  return store;
}

/**
 * Seed a real Session through the public `create`/`append` definitions. One batch
 * produces `1 + turns * 3` records (session.created plus one terminal Turn each) and
 * returns the true tail position.
 */
async function seedSession(store: Store, sessionId: string, turns: number): Promise<number> {
  await store.create({ sessionId, recordId: `created-${sessionId}`, createdAt: AT }, options());
  const drafts: Draft[] = [];
  for (let index = 0; index < turns; index += 1) drafts.push(...turnDrafts(index, sessionId));
  await store.append(sessionId, 1, drafts, options());
  return SESSION_CREATED_POSITION + drafts.length;
}

async function mutateDatabase(databasePath: string, mutate: (database: DatabaseSync) => void): Promise<void> {
  const database = new DatabaseSync(databasePath);
  try {
    mutate(database);
  } finally {
    database.close();
  }
}

function positionsOf(page: { records: readonly kernel.SessionRecord[] }): number[] {
  return page.records.map((record) => record.position);
}

/**
 * Minimal `node:sqlite` spy. `prepare`/`exec` are recorded and `StatementSync.all`/
 * `get` count the rows actually fetched, but only while `state.recording` is true.
 * Fixture seeding is never recorded, so `append`'s own reads cannot be mistaken for a
 * `read` regression.
 */
function installSqlSpy(afterHeaderRead?: () => void) {
  type MutablePrototype = {
    prepare: (this: unknown, sql: string) => unknown;
    exec: (this: unknown, sql: string) => unknown;
  };
  type MutableStatement = {
    all: (...args: unknown[]) => unknown[];
    get: (...args: unknown[]) => unknown;
  };
  const databasePrototype = DatabaseSync.prototype as unknown as MutablePrototype;
  const statementPrototype = StatementSync.prototype as unknown as MutableStatement;
  const original = {
    prepare: databasePrototype.prepare,
    exec: databasePrototype.exec,
    all: statementPrototype.all,
    get: statementPrototype.get,
  };
  const state = { recording: false, sql: [] as string[], fetchedRows: 0 };
  const statementSql = new WeakMap<object, string>();
  let headerReadNotified = false;
  databasePrototype.prepare = function (this: unknown, sql: string) {
    if (state.recording) state.sql.push(sql);
    const statement = original.prepare.call(this, sql);
    statementSql.set(statement as object, sql);
    return statement;
  };
  databasePrototype.exec = function (this: unknown, sql: string) {
    if (state.recording) state.sql.push(sql);
    return original.exec.call(this, sql);
  };
  statementPrototype.all = function (this: unknown, ...args: unknown[]) {
    const rows = original.all.apply(this, args);
    if (state.recording && Array.isArray(rows)) state.fetchedRows += rows.length;
    return rows;
  };
  statementPrototype.get = function (this: unknown, ...args: unknown[]) {
    const row = original.get.apply(this, args);
    if (state.recording && row !== undefined) state.fetchedRows += 1;
    if (
      state.recording && !headerReadNotified && row !== undefined
      && /\bfrom\s+sessions\b/i.test(statementSql.get(this as object) ?? '')
    ) {
      // The row has already been read: a second WAL connection can now commit
      // between the header and subsequent tail/page reads without using timers.
      headerReadNotified = true;
      afterHeaderRead?.();
    }
    return row;
  };
  return {
    state,
    restore() {
      databasePrototype.prepare = original.prepare;
      databasePrototype.exec = original.exec;
      statementPrototype.all = original.all;
      statementPrototype.get = original.get;
    },
  };
}

const SQL_PARAMETER = String.raw`(?:\?|[:@$][A-Za-z_][A-Za-z0-9_]*)`;
const LIMIT_CLAUSE = new RegExp(String.raw`\blimit\s+(?:${SQL_PARAMETER}|\d+)`, 'i');
const POSITION_RANGE = new RegExp(
  String.raw`\bposition\s*(?:[<>]=?\s*${SQL_PARAMETER}|between\s+${SQL_PARAMETER}\s+and\s+${SQL_PARAMETER})`,
  'i',
);
const TAIL_AGGREGATE = /^select\s+max\(\s*position\s*\)(?:\s+as\s+\w+)?\s+from\s+session_records\b/i;

describe('R4c.2b Kernel Session history range read', () => {
  it('reports the whole-Session last position, not the page tail, revision or COUNT', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-tail-');
    const store = await openStore(databasePath);
    const total = await seedSession(store, 'session-tail', 40);
    const header = await store.get('session-tail', options());
    expect(total).toBeGreaterThan(100);
    expect(header.revision).not.toBe(total);

    const middle = await store.read('session-tail', 1, 2, options());
    expect(positionsOf(middle)).toEqual([2, 3]);
    expect(middle.lastPosition).toBe(total);
    expect(middle.revision).toBe(header.revision);
    expect(middle.nextPosition).toBe(3);

    const tail = await store.read('session-tail', total - 2, 2, options());
    expect(positionsOf(tail)).toEqual([total - 1, total]);
    expect(tail.nextPosition).toBeNull();
    expect(tail.lastPosition).toBe(total);
  });

  it('paginates every position exactly once and derives nextPosition from the real page', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-walk-');
    const store = await openStore(databasePath);
    const total = await seedSession(store, 'session-walk', 16);
    const header = await store.get('session-walk', options());

    const seen: number[] = [];
    let after = 0;
    for (let guard = 0; guard < 100; guard += 1) {
      const page = await store.read('session-walk', after, 5, options());
      expect(page.lastPosition).toBe(total);
      expect(page.revision).toBe(header.revision);
      seen.push(...positionsOf(page));
      if (page.nextPosition === null) {
        expect(page.records.length).toBeLessThanOrEqual(5);
        break;
      }
      expect(page.nextPosition).toBe(page.records.at(-1)?.position);
      after = page.nextPosition;
    }
    expect(seen).toEqual(Array.from({ length: total }, (_value, index) => index + 1));
  });

  it('keeps header, tail and page in one snapshot when a WAL writer commits after the header read', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-snapshot-');
    const store = await openStore(databasePath);
    const sessionId = 'session-snapshot';
    const total = await seedSession(store, sessionId, 4);
    const header = await store.get(sessionId, options());
    const writer = await openStore(databasePath);
    let appended: ReturnType<Store['append']> | undefined;
    let committedDuringRead: ReturnType<Store['get']> | undefined;
    let injected = false;
    const spy = installSqlSpy(() => {
      injected = true;
      // SqliteStores.append performs its transaction synchronously before returning
      // its Promise. The independent WAL connection commits while read is paused.
      appended = writer.append(sessionId, header.revision, turnDrafts(99, sessionId), options());
      committedDuringRead = writer.get(sessionId, options());
    });
    let page: Awaited<ReturnType<Store['read']>>;
    let appendResult: Awaited<ReturnType<Store['append']>> | undefined;
    let committedHeader: Awaited<ReturnType<Store['get']>> | undefined;
    try {
      spy.state.recording = true;
      const pendingRead = store.read(sessionId, total - 1, 4, options());
      // Attach handlers to every Promise, including a failed concurrent append.
      [page, appendResult, committedHeader] = await Promise.all([pendingRead, appended, committedDuringRead]);
    } finally {
      spy.state.recording = false;
      spy.restore();
    }
    expect(injected).toBe(true);
    expect(appended).toBeDefined();
    expect(appendResult?.revision).toBe(header.revision + 1);
    expect(appendResult?.positions).toEqual([total + 1, total + 2, total + 3]);
    expect(committedHeader?.revision).toBe(header.revision + 1);

    expect(page.revision).toBe(header.revision);
    expect(page.lastPosition).toBe(total);
    expect(positionsOf(page)).toEqual([total]);
    expect(page.nextPosition).toBeNull();

    // The commit is real and becomes visible once that read snapshot has ended.
    const later = await store.read(sessionId, total - 1, 4, options());
    expect(later.revision).toBe(header.revision + 1);
    expect(later.lastPosition).toBe(total + 3);
    expect(positionsOf(later)).toEqual([total, total + 1, total + 2, total + 3]);
    expect(later.nextPosition).toBeNull();
  });

  it('handles the last page, an empty page at the tail and an afterPosition beyond the tail', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-edges-');
    const store = await openStore(databasePath);
    const total = await seedSession(store, 'session-edges', 10);

    const last = await store.read('session-edges', total - 1, 4, options());
    expect(positionsOf(last)).toEqual([total]);
    expect(last.nextPosition).toBeNull();
    expect(last.lastPosition).toBe(total);

    const atTail = await store.read('session-edges', total, 4, options());
    expect(atTail.records).toEqual([]);
    expect(atTail.nextPosition).toBeNull();
    expect(atTail.lastPosition).toBe(total);

    const beyond = await store.read('session-edges', total + 1000, 4, options());
    expect(beyond.records).toEqual([]);
    expect(beyond.nextPosition).toBeNull();
    expect(beyond.lastPosition).toBe(total);

    const beyondSafe = await store.read('session-edges', Number.MAX_SAFE_INTEGER, 4, options());
    expect(beyondSafe.records).toEqual([]);
    expect(beyondSafe.nextPosition).toBeNull();
    expect(beyondSafe.lastPosition).toBe(total);
  });

  it('accepts Number.MAX_SAFE_INTEGER as a limit without overflow', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-max-');
    const store = await openStore(databasePath);
    const total = await seedSession(store, 'session-max', 20);

    const full = await store.read('session-max', 0, Number.MAX_SAFE_INTEGER, options());
    expect(positionsOf(full)).toEqual(Array.from({ length: total }, (_value, index) => index + 1));
    expect(full.nextPosition).toBeNull();
    expect(full.lastPosition).toBe(total);

    const fromMiddle = await store.read('session-max', 2, Number.MAX_SAFE_INTEGER, options());
    expect(fromMiddle.records).toHaveLength(total - 2);
    expect(fromMiddle.records[0]?.position).toBe(3);
    expect(fromMiddle.records.at(-1)?.position).toBe(total);
    expect(fromMiddle.nextPosition).toBeNull();

    const fromTail = await store.read('session-max', total, Number.MAX_SAFE_INTEGER, options());
    expect(fromTail.records).toEqual([]);
    expect(fromTail.lastPosition).toBe(total);
  });

  it('reads a small back page through a bounded primary-key range instead of a full scan', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-spy-');
    const store = await openStore(databasePath);
    const total = await seedSession(store, 'session-spy', 120);
    expect(total).toBeGreaterThan(300);

    const spy = installSqlSpy();
    let page: Awaited<ReturnType<Store['read']>>;
    try {
      spy.state.recording = true;
      page = await store.read('session-spy', total - 3, 3, options());
      spy.state.recording = false;
    } finally {
      spy.restore();
    }
    expect(positionsOf(page)).toEqual([total - 2, total - 1, total]);

    const statements = spy.state.sql.map((sql) => sql.replace(/\s+/g, ' ').trim());
    const recordReads = statements.filter((sql) => /from session_records/i.test(sql));
    expect(recordReads.length).toBeGreaterThan(0);
    // No aggregate over the Session and no write transaction during a read.
    expect(statements.some((sql) => /count\s*\(/i.test(sql))).toBe(false);
    expect(statements.some((sql) => /begin\s+immediate/i.test(sql))).toBe(false);
    // Entity rows must be bounded. MAX(position) may use the existing primary key
    // for tail metadata without a LIMIT; it must not materialize record payloads.
    for (const sql of recordReads) {
      expect(LIMIT_CLAUSE.test(sql) || TAIL_AGGREGATE.test(sql)).toBe(true);
    }
    // At least one statement must show a real primary-key range predicate, not just a
    // returned row count.
    expect(recordReads.some((sql) => POSITION_RANGE.test(sql))).toBe(true);
    // Rows actually fetched are bounded by the page instead of the Session length.
    expect(spy.state.fetchedRows).toBeLessThanOrEqual(3 + 8);
  });

  it('reads a back page even when a front record payload is damaged outside the range', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-outside-');
    const store = await openStore(databasePath);
    const total = await seedSession(store, 'session-outside', 120);
    await mutateDatabase(databasePath, (database) => {
      database
        .prepare('UPDATE session_records SET record_json = ? WHERE session_id = ? AND position = 2')
        .run('{}', 'session-outside');
    });

    const page = await store.read('session-outside', total - 3, 3, options());
    expect(positionsOf(page)).toEqual([total - 2, total - 1, total]);
    expect(page.lastPosition).toBe(total);
    expect(page.nextPosition).toBeNull();
  });

  it('still reports the tail position when the tail payload is damaged outside the range', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-tail-damaged-');
    const store = await openStore(databasePath);
    const total = await seedSession(store, 'session-tail-damaged', 20);
    await mutateDatabase(databasePath, (database) => {
      database
        .prepare('UPDATE session_records SET record_json = ? WHERE session_id = ? AND position = ?')
        .run('{}', 'session-tail-damaged', total);
    });

    const page = await store.read('session-tail-damaged', 0, 3, options());
    expect(positionsOf(page)).toEqual([1, 2, 3]);
    expect(page.lastPosition).toBe(total);
    expect(page.nextPosition).toBe(3);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['unsafe', 9007199254740992n],
  ] as const)('rejects a %s tail key as corrupt and cleans up the read snapshot', async (_name, position) => {
    const { databasePath } = await newDatabase('next-r4c-range-tail-key-');
    const store = await openStore(databasePath);
    const sessionId = 'session-tail-key';
    await store.create({ sessionId, recordId: 'created-tail-key', createdAt: AT }, options());
    await mutateDatabase(databasePath, (database) => {
      database.prepare('UPDATE session_records SET position = ? WHERE session_id = ?')
        .run(position, sessionId);
    });

    let failure: unknown;
    try {
      await store.read(sessionId, 0, 1, options());
    } catch (error) {
      failure = error;
    } finally {
      // Restore the actual key while retaining the same reader connection. A
      // leaked transaction would either retain stale data or reject the next read.
      await mutateDatabase(databasePath, (database) => {
        database.prepare('UPDATE session_records SET position = 1 WHERE session_id = ?').run(sessionId);
      });
    }
    const restored = await store.read(sessionId, 0, 1, options());
    expect(restored.revision).toBe(1);
    expect(positionsOf(restored)).toEqual([1]);
    expect(restored.lastPosition).toBe(1);
    expect(restored.nextPosition).toBeNull();
    expect(failure).toMatchObject({ code: 'corrupt' });
  });

  it('rejects damaged, schema-invalid and checksum-invalid records inside the requested page', async () => {
    const cases: Array<[string, (database: DatabaseSync, sessionId: string) => void]> = [
      ['not JSON', (database, sessionId) => {
        database
          .prepare('UPDATE session_records SET record_json = ? WHERE session_id = ? AND position = 2')
          .run('not-json', sessionId);
      }],
      ['schema-invalid', (database, sessionId) => {
        database
          .prepare('UPDATE session_records SET record_json = ? WHERE session_id = ? AND position = 2')
          .run('{}', sessionId);
      }],
      ['checksum-invalid', (database, sessionId) => {
        const row = database
          .prepare('SELECT record_json FROM session_records WHERE session_id = ? AND position = 2')
          .get(sessionId) as { record_json: string };
        const record = JSON.parse(row.record_json) as { recordedAt: string };
        record.recordedAt = '2026-09-26T00:00:00.000Z';
        database
          .prepare('UPDATE session_records SET record_json = ? WHERE session_id = ? AND position = 2')
          .run(JSON.stringify(record), sessionId);
      }],
    ];

    for (const [name, mutate] of cases) {
      const { databasePath } = await newDatabase('next-r4c-range-inpage-');
      const store = await openStore(databasePath);
      await seedSession(store, 'session-inpage', 4);
      await mutateDatabase(databasePath, (database) => mutate(database, 'session-inpage'));
      await expect(store.read('session-inpage', 0, 3, options()), name).rejects.toMatchObject({ code: 'corrupt' });
      await store.close();
    }
  });

  it('rejects a gap in the middle of the requested range', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-gap-');
    const store = await openStore(databasePath);
    await seedSession(store, 'session-gap', 4);
    await mutateDatabase(databasePath, (database) => {
      database.prepare('DELETE FROM session_records WHERE session_id = ? AND position = 3').run('session-gap');
    });

    await expect(store.read('session-gap', 0, 5, options())).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('rejects a database position that contradicts the record payload position', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-position-');
    const store = await openStore(databasePath);
    await seedSession(store, 'session-position', 4);
    // Swap the primary-key position columns of two in-page records while leaving both
    // payloads (and their checksums) intact: the key order now disagrees with the
    // payload position.
    await mutateDatabase(databasePath, (database) => {
      const sessionId = 'session-position';
      database.prepare('UPDATE session_records SET position = -1 WHERE session_id = ? AND position = 2').run(sessionId);
      database.prepare('UPDATE session_records SET position = 2 WHERE session_id = ? AND position = 3').run(sessionId);
      database.prepare('UPDATE session_records SET position = 3 WHERE session_id = ? AND position = -1').run(sessionId);
    });

    await expect(store.read('session-position', 0, 4, options())).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('rejects a database Session key that contradicts the record payload Session', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-session-key-');
    const store = await openStore(databasePath);
    await seedSession(store, 'session-key-a', 4);
    await seedSession(store, 'session-key-b', 4);
    // Move a perfectly valid record from Session B into Session A's row at the same
    // position. The checksum stays valid; only the payload sessionId disagrees with
    // the database key.
    await mutateDatabase(databasePath, (database) => {
      const borrowed = database
        .prepare('SELECT record_json FROM session_records WHERE session_id = ? AND position = 2')
        .get('session-key-b') as { record_json: string };
      database
        .prepare('UPDATE session_records SET record_json = ? WHERE session_id = ? AND position = 2')
        .run(borrowed.record_json, 'session-key-a');
    });

    await expect(store.read('session-key-a', 0, 4, options())).rejects.toMatchObject({ code: 'corrupt' });
    // Session B is untouched by Session A's damage.
    const healthy = await store.read('session-key-b', 0, 4, options());
    expect(positionsOf(healthy)).toEqual([1, 2, 3, 4]);
  });

  it('keeps append/replay full-history validation after a reopen even though read is ranged', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-append-');
    const store = await openStore(databasePath);
    await seedSession(store, 'session-append', 4);
    await mutateDatabase(databasePath, (database) => {
      database
        .prepare('UPDATE session_records SET record_json = ? WHERE session_id = ? AND position = 2')
        .run('{}', 'session-append');
    });
    await store.close();

    const reopened = await openStore(databasePath);
    const header = await reopened.get('session-append', options());
    await expect(reopened.append('session-append', header.revision, turnDrafts(99, 'append-retry'), options()))
      .rejects.toMatchObject({ code: 'corrupt' });
  });

  it('isolates Sessions so damage and tails never leak across them', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-isolation-');
    const store = await openStore(databasePath);
    const totalA = await seedSession(store, 'session-iso-a', 30);
    const totalB = await seedSession(store, 'session-iso-b', 12);
    expect(totalA).not.toBe(totalB);
    await mutateDatabase(databasePath, (database) => {
      database
        .prepare('UPDATE session_records SET record_json = ? WHERE session_id = ? AND position = 2')
        .run('{}', 'session-iso-a');
    });

    const pageA = await store.read('session-iso-a', totalA - 2, 2, options());
    expect(positionsOf(pageA)).toEqual([totalA - 1, totalA]);
    expect(pageA.lastPosition).toBe(totalA);
    expect(pageA.records.every((record) => record.sessionId === 'session-iso-a')).toBe(true);

    const pageB = await store.read('session-iso-b', 0, 3, options());
    expect(positionsOf(pageB)).toEqual([1, 2, 3]);
    expect(pageB.lastPosition).toBe(totalB);
    expect(pageB.records.every((record) => record.sessionId === 'session-iso-b')).toBe(true);
  });

  it('returns the same page and tail after reopening the database', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-restart-');
    const store = await openStore(databasePath);
    const total = await seedSession(store, 'session-restart', 12);
    const before = await store.read('session-restart', total - 4, 4, options());
    await store.close();

    const reopened = await openStore(databasePath);
    const after = await reopened.read('session-restart', total - 4, 4, options());
    expect(after.records).toEqual(before.records);
    expect(after.revision).toBe(before.revision);
    expect(after.nextPosition).toBe(before.nextPosition);
    expect(after.lastPosition).toBe(before.lastPosition);
  });

  it('preserves cancellation and unknown-Session semantics', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-cancel-');
    const store = await openStore(databasePath);
    const total = await seedSession(store, 'session-cancel', 3);

    const aborted = new AbortController();
    aborted.abort();
    await expect(store.read('session-cancel', 0, 2, { signal: aborted.signal }))
      .rejects.toMatchObject({ code: 'cancelled' });
    await expect(store.read('session-missing', 0, 2, options()))
      .rejects.toMatchObject({ code: 'not_found' });

    const page = await store.read('session-cancel', 0, 2, options());
    expect(positionsOf(page)).toEqual([1, 2]);
    expect(page.lastPosition).toBe(total);
  });

  it('rejects non-positive, non-integer or unsafe page parameters', async () => {
    const { databasePath } = await newDatabase('next-r4c-range-params-');
    const store = await openStore(databasePath);
    await seedSession(store, 'session-params', 2);

    for (const afterPosition of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(store.read('session-params', afterPosition, 2, options()))
        .rejects.toMatchObject({ code: 'invalid_record' });
    }
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(store.read('session-params', 0, limit, options()))
        .rejects.toMatchObject({ code: 'invalid_record' });
    }
  });
});
