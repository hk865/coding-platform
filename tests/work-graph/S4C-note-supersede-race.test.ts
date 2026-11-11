/**
 * RW-2: a concurrent USER confirmation must not be superseded.
 *
 * The bug: `dispose` decides the live user reasons from target reads at v1, then
 * `supersessionOf(..., prereadHeads = null, ...)` re-reads the target (now the
 * user-confirmed v2) and supersedes it. The interleave is the one permitted
 * storage-boundary seam: both record-backend factories are spied (the WP2 /
 * `task-claim-fixture.ts` `wrapRecords` pattern) before `createS4ANoteFixture`,
 * so only the real `readMany` is wrapped; on the SECOND read of the target head
 * (the disposition-decision read, after the scribe-scope check already read it
 * once) the person accepts that pending target through the real
 * `platform.notes.reviewNote`. No record-store read answers an assertion.
 * KLS-2b [2B-06]: the disposition's reads and commit now run in the project's
 * in-process write queue, so the person's accept lands before the scribe's
 * call (an accept inside the read would wait on the queue the scribe holds).
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
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

/** The real fixture; goalQuota 1 makes the second agent note pending_review, so the person can really `accept` it. */
async function buildRaceFixture(kind: S4ANoteFixtureKind): Promise<{ f: S4ANoteFixture }> {
  return { f: await createS4ANoteFixture(kind, { goalQuota: 1 }) };
}

async function itemOf(f: S4ANoteFixture, noteId: string): Promise<{ storedState: string; version: number;
  confirmedByUser: boolean; replaces: string[]; coexistWith: string[] }> {
  const read = await f.platform.notes.readNote(f.ctx(), { noteId });
  if (read.status !== 'ready') throw new Error(`note ${noteId} is not readable: ${JSON.stringify(read)}`);
  return { ...read.value, version: read.value.version!, storedState: read.value.storedState! };
}

describe('RW-2 a concurrent user confirmation is not superseded', () => {
  it.each(KINDS)('RW-2 %s: a user accept that lands first keeps the target out of the scribe supersede', async kind => {
    const { f } = await buildRaceFixture(kind);
    try {
      const user = f.ctx();
      // z: a live agent contradiction (accepted, agent source).
      const z = await f.write(f.workCtx(await f.claimRun('rw2-z')), general({ topic: 'z', anchor: FILE_A }),
        's4a-goal');
      const zId = idOf(z);
      expect(z.status).toBe('accepted');
      // x: the pending agent target note y replaces; the person accepts it mid-commit.
      const x = await f.write(f.workCtx(await f.claimRun('rw2-x', 't2')), general({ topic: 'x', anchor: FILE_A }),
        's4a-goal');
      const xId = idOf(x);
      expect(x).toMatchObject({ status: 'pending_review', reasons: ['quota_full'] });
      // y: pending (a live contradiction with z; the goal is over quota) and it
      // replaces the pending agent note x. The scribe wrote it (t3).
      const scribeRun = await f.claimRun('rw2-scribe', 't3', 'scribe');
      const scribe = f.workCtx(scribeRun);
      const y = await f.write(scribe, general({ topic: 'y', anchor: FILE_A, replaces: [xId], contradicts: [zId] }),
        's4a-goal');
      const yId = idOf(y);
      expect(y).toMatchObject({ status: 'pending_review' });

      // KLS-2b [2B-06]: the scribe's decision read and its commit run in the project's write queue, so the
      // person's accept can no longer land between them; it lands first and the scribe decides on the confirmed x.
      const confirmed = await f.platform.notes.reviewNote(user, { commandId: 'rw2-user-confirm',
        noteId: xId, expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '我确认这条' });
      expect(confirmed).toMatchObject({ status: 'done', state: 'accepted' });

      const result = await f.platform.notes.reviewNote(scribe, { commandId: 'rw2-scribe-accept', noteId: yId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', resolution: 'supersede', reason: '收下' });
      // The scribe decides on the user-confirmed x: its supersede no longer applies.
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'resolution_not_applicable' });

      // The user-confirmed target is still current and was not superseded.
      const xItem = await itemOf(f, xId);
      expect(xItem).toMatchObject({ storedState: 'accepted', confirmedByUser: true, version: 2 });
      // The live contradiction was not superseded either; the scribe's note stayed pending.
      expect((await itemOf(f, zId)).storedState).toBe('accepted');
      expect((await itemOf(f, yId)).storedState).toBe('pending_review');
    } finally { await f.close(); }
  });
});
