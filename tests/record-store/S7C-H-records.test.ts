/**
 * H-records (storage row, both backends): record 5's own
 * `work-handoff-brief-by-session` order.
 *
 * The row commits two records with the SAME index prefix (project, workspace,
 * successor Session) in one order and reads them back through the store's
 * public `lookupOrdered`; the expected identities are literal refKeys. The two
 * commits carry distinguishable `since` cursors, and the operation ids are
 * named so a `since` order and a refKey order are different sequences.
 *
 * The named mutation is: change the lookup's `orderBy.path` away from `since`
 * (for example to the record revision or the ref key) — the ascending
 * expectation below turns red on the storage row itself.
 *
 * The store's port is the public step here (tests/RULES A1): records are built
 * with the real record/event codecs and committed through `records.commit`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { handoffBriefDigest, type HandoffBriefMaterialV1 } from '../../src/contracts/handoff-brief.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { EncodedDomainEvent, PreparedCommit } from '../../src/core/record-store/ports.js';
import {
  HANDOFF_BRIEF_RECORD_SCHEMAS, handoffBriefRecordedCodec, workHandoffBriefCodec,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';
import {
  WORK_HANDOFF_BRIEF_BY_SESSION_LOOKUP, WORK_HANDOFF_BRIEF_RECORDED_EVENT_TYPE,
  type WorkHandoffBriefV1,
} from '../../src/core/work-graph/state/work-handoff-brief.js';

const projectId = 'p-h';
const workspaceId = 'w-h';
const successor: SessionRef = { projectId, sessionId: 'successor-h' };
const source: SessionRef = { projectId, sessionId: 'source-h' };
const tasks: TaskTriple[] = [{ projectId, goalId: 'g-h', taskId: 't-h' }];
const material: HandoffBriefMaterialV1 = {
  duty: 'executor',
  tasks: [{ task: tasks[0]!, phase: 'running', lastResult: null }],
  conclusion: { absent: 'no_formal_final_answer' },
  noteIndex: [],
  understanding: [{ noteId: 'note-h', version: 1 }],
  oldLine: source,
};

/** Record 5 as a pending write: the commit binds `since`; the value is typed as stored. */
type PendingBrief = Omit<WorkHandoffBriefV1, 'since'> & { since: CommitCursor | null };

function pendingBrief(operationId: string): PendingBrief {
  const operation = { aggregateType: 'CoreOperation' as const, projectId, operationId };
  const digest = handoffBriefDigest(material);
  return {
    ref: { aggregateType: 'HandoffBrief', projectId, sessionId: successor.sessionId, operationId },
    revision: 1, workspaceId, operation, source, duty: 'executor', tasks,
    binding: { operation, source, successor, duty: 'executor', digest },
    digest, material, consumedBy: null, since: null,
  };
}

const at = '2026-11-01T00:00:00.000Z';
let serial = 0;

/** One commit: the record, its replay event and the `since` binding, in the store's own shape. */
function commitOf(operationId: string): PreparedCommit {
  serial += 1;
  const brief = pendingBrief(operationId);
  const record = workHandoffBriefCodec.encode(brief);
  const event: EncodedDomainEvent = handoffBriefRecordedCodec.encode({
    eventId: `h-records-event-${String(serial)}`, eventType: WORK_HANDOFF_BRIEF_RECORDED_EVENT_TYPE,
    schemaVersion: 1, occurredAt: at, handoffBrief: brief,
  });
  return {
    identityKey: `h-records-${String(serial)}`, fingerprint: `h-records-fingerprint-${String(serial)}`,
    guards: [{ refKey: record.refKey, expectedRevision: null }], records: [record],
    claims: [], indexGuards: [], indexChanges: [], events: [event],
    commitCursorBindings: [{ refKey: record.refKey, field: 'since' }],
  };
}

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function openRecordsTestStore(kind: 'memory' | 'sqlite') {
  if (kind === 'memory') {
    return {
      backend: createInMemoryRecordBackend({ schemas: HANDOFF_BRIEF_RECORD_SCHEMAS }),
      close: async () => undefined,
    };
  }
  const dir = await mkdtemp(join(tmpdir(), 's7c-h-records-'));
  dirs.push(dir);
  const backend = createSqliteRecordBackend({ schemas: HANDOFF_BRIEF_RECORD_SCHEMAS, path: join(dir, 'ledger.sqlite') });
  return { backend, close: async () => { await backend.close(); } };
}

// Canonical refKey order: `op-a` sorts before `op-b`, while `op-b` commits first.
const recordKeyOf = (operationId: string): string => canonicalJson({
  aggregateType: 'HandoffBrief', projectId, sessionId: successor.sessionId, operationId,
});

describe.each(['memory', 'sqlite'] as const)('%s record 5 lookup', (kind) => {
  it('H-records: two same-prefix rows are read back in `since` order, not refKey order', async () => {
    const { backend, close } = await openRecordsTestStore(kind);
    try {
      // op-b commits first; op-a commits second and sorts first by refKey.
      const first = await backend.records.commit(commitOf('op-b'));
      const second = await backend.records.commit(commitOf('op-a'));
      expect(first.status).toBe('committed');
      expect(second.status).toBe('committed');
      if (first.status !== 'committed' || second.status !== 'committed') return;
      expect(first.cursor).not.toBe(second.cursor);

      const ascending = await backend.records.lookupOrdered({
        index: WORK_HANDOFF_BRIEF_BY_SESSION_LOOKUP,
        values: [projectId, workspaceId, successor.sessionId],
        direction: 'asc', limit: 10,
      });
      expect(ascending.status).toBe('ready');
      if (ascending.status !== 'ready') return;
      expect(ascending.value.records.map(record => record.refKey))
        .toEqual([recordKeyOf('op-b'), recordKeyOf('op-a')]);

      const descending = await backend.records.lookupOrdered({
        index: WORK_HANDOFF_BRIEF_BY_SESSION_LOOKUP,
        values: [projectId, workspaceId, successor.sessionId],
        direction: 'desc', limit: 10,
      });
      expect(descending.status).toBe('ready');
      if (descending.status !== 'ready') return;
      expect(descending.value.records.map(record => record.refKey))
        .toEqual([recordKeyOf('op-a'), recordKeyOf('op-b')]);

      // Both rows carry their own commit's cursor as `since`.
      const firstDecoded = workHandoffBriefCodec.decode(ascending.value.records[0]!);
      const secondDecoded = workHandoffBriefCodec.decode(ascending.value.records[1]!);
      expect(firstDecoded.status).toBe('decoded');
      expect(secondDecoded.status).toBe('decoded');
      if (firstDecoded.status !== 'decoded' || secondDecoded.status !== 'decoded') return;
      expect(firstDecoded.value.since).toBe(first.cursor);
      expect(secondDecoded.value.since).toBe(second.cursor);
    } finally {
      await close();
    }
  });
});
