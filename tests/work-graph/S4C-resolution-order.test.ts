/**
 * RW-8 order (rework item 2): `resolution_not_applicable` is answered before the
 * scribe's `managingScopeOf` and before any relation/target read. The seam is a
 * `readMany` wrapper (the accepted `S4C-note-supersede-race.test.ts` pattern):
 * the wrapper is inert until armed, then rejects any read of the target's head.
 * If the service still reaches the scribe scope block first, it maps that
 * rejected read to `unavailable`; the expected answer is the verdict check's
 * `invalid`/`resolution_not_applicable`.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import * as memoryBackend from '../../src/core/record-store/in-memory-record-store.js';
import * as sqliteBackend from '../../src/core/record-store/sqlite-record-store.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const FILE_A = { kind: 'file', path: 'src/a/x.ts' } as const;

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'pitfall', topic: 'default topic', conclusion: 'default conclusion', anchor: FILE_A,
    extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
    coexistWith: [], body: 'body', ...overrides,
  } as NoteDraftV1;
}
const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;

type BlockingSeam = { arm(noteId: string): void };

/** The real fixture over a `readMany`-wrapped backend; inert until `arm`. */
async function buildBlockingFixture(kind: S4ANoteFixtureKind): Promise<{ f: S4ANoteFixture; seam: BlockingSeam }> {
  let armed = false;
  let target = '';
  const observe = <T,>(backend: T): T => {
    const records = (backend as unknown as { records: GoalRecordTransactionPort }).records;
    const rawReadMany = records.readMany.bind(records);
    return { ...(backend as object), records: { ...records,
      async readMany(refKeys: readonly string[]): Promise<unknown> {
        if (armed && refKeys.some(key => key.includes(target))) {
          return { status: 'rejected', code: 'unavailable', reason: 'relation read blocked by the test' };
        }
        return rawReadMany(refKeys as string[]);
      } } } as unknown as T;
  };
  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
    .mockImplementation(options => observe(originalMemory(options)) as never);
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(options => observe(originalSqlite(options)) as never);
  let f: S4ANoteFixture;
  try {
    // goalQuota 1 leaves the scribe's contradicting note pending, so a real
    // review/reject is a legal disposition to attempt.
    f = await createS4ANoteFixture(kind, { goalQuota: 1 });
  } finally {
    memorySpy.mockRestore();
    sqliteSpy.mockRestore();
  }
  return { f, seam: { arm(noteId) { target = noteId; armed = true; } } };
}

/** Write an accepted target and a pending contradicting subject, then arm the block on the target. */
async function pendingAndArm(f: S4ANoteFixture, seam: BlockingSeam, suffix: string):
Promise<{ ctx: CoreCallContext; subjectId: string; targetId: string }> {
  const scribe = f.workCtx(await f.claimRun(`order-${suffix}-scribe`, 't3', 'scribe'));
  const target = await f.write(scribe, general({ topic: `order-${suffix}-target`, anchor: FILE_A }), 's4a-goal');
  expect(target.status).toBe('accepted');
  const subject = await f.write(scribe, general({ topic: `order-${suffix}-subject`, anchor: FILE_A,
    contradicts: [idOf(target)] }), 's4a-goal');
  expect(subject).toMatchObject({ status: 'pending_review' });
  const targetId = idOf(target);
  seam.arm(targetId);
  return { ctx: scribe, subjectId: idOf(subject), targetId };
}

describe('RW-8 order: a verdict carrying a resolution never reads a relation target', () => {
  it.each(KINDS)('RW-8 order review %s: resolution_not_applicable even when the target read fails', async kind => {
    const { f, seam } = await buildBlockingFixture(kind);
    try {
      const { ctx, subjectId } = await pendingAndArm(f, seam, 'review');
      const refused = await f.platform.notes.reviewNote(ctx, { commandId: `order-review-${kind}`, noteId: subjectId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', resolution: 'coexist', reason: null });
      expect(refused).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'resolution_not_applicable' });
    } finally { await f.close(); }
  });

  it.each(KINDS)('RW-8 order reject %s: resolution_not_applicable even when the target read fails', async kind => {
    const { f, seam } = await buildBlockingFixture(kind);
    try {
      const { ctx, subjectId } = await pendingAndArm(f, seam, 'reject');
      const refused = await f.platform.notes.reviewNote(ctx, { commandId: `order-reject-${kind}`, noteId: subjectId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'reject', resolution: 'supersede', reason: null });
      expect(refused).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'resolution_not_applicable' });
    } finally { await f.close(); }
  });
});
