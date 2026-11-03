/**
 * O1a-03: one ordered event page on both stores.
 *
 * A storage rule (commit order, continuation and its exclusive `after`), so the
 * single row runs on memory and SQLite. Records/events are built as plain
 * values and committed through each backend's public `commit` (RULES v5 A1,
 * the record store's own tests); expected ids are the literals from the task.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { RecordEventPagePort } from '../../src/core/record-store/event-page-ports.js';
import type {
  GoalRecordTransactionPort, RecordBackendSchemas, StoreResult,
} from '../../src/core/record-store/ports.js';
import {
  commitRow, recordSchema, typed,
} from '../helpers/SP-record-store-support.js';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

type Backend = {
  records: GoalRecordTransactionPort;
  eventPage: RecordEventPagePort;
  close(): Promise<void>;
};

const schemas: RecordBackendSchemas = {
  records: [recordSchema('W')],
  events: [{ eventType: 'Changed', schemaVersion: 1, validate: (value) => ({ status: 'decoded', value }) }],
  lookups: [],
};

async function openBackend(kind: 'memory' | 'sqlite'): Promise<Backend> {
  if (kind === 'memory') return createInMemoryRecordBackend({ schemas });
  const dir = await mkdtemp(join(tmpdir(), 's7d2-event-page-'));
  dirs.push(dir);
  return createSqliteRecordBackend({ path: join(dir, 'records.sqlite'), schemas });
}

function valueOf<T>(result: StoreResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${result.status}: ${result.reason}`);
  return result.value;
}

it.each(['memory', 'sqlite'] as const)(
  'O1a-03 %s: eventPage returns E1/E2 then E3 in commit order, with the continuation excluding `after`',
  async (kind) => {
    const backend = await openBackend(kind);
    try {
      for (const identity of ['E1', 'E2', 'E3']) {
        expect(await commitRow(backend, identity, typed('W', identity.toLowerCase(), {})))
          .toMatchObject({ status: 'committed' });
      }

      const first = valueOf(await backend.eventPage.eventPage({ after: null, limit: 2 }));
      expect(first.events.map((step) => step.event.eventId)).toEqual(['E1', 'E2']);
      expect(first.events).toHaveLength(2);
      expect(first.next).not.toBeNull();
      expect(first.next).toBe(first.events[1]!.cursor);

      const second = valueOf(await backend.eventPage.eventPage({ after: first.next, limit: 2 }));
      expect(second.events.map((step) => step.event.eventId)).toEqual(['E3']);
      expect(second.next).toBeNull();

      // The two pages together are exactly the three commits: no duplicate, no omission.
      expect([...first.events, ...second.events].map((step) => step.event.eventId))
        .toEqual(['E1', 'E2', 'E3']);
    } finally {
      await backend.close();
    }
  },
);
