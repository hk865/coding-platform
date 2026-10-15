/**
 * Slice 4A round 2 item 4 (NE1): there is no silent 200-record stop in lookups,
 * counts and listings. The real `createS4ANoteFixture` builds everything through
 * public services on both backends (no double); the platform option
 * `noteLimits:{anchorQuota:1000, goalQuota:201}` leaves the goal quota as the
 * only boundary. Assertions go only through `platform.notes`
 * (`readNote`/`listByAnchor`); the record store is never read.
 *
 * Expected values are literal from item 4 of the round-2 task: 201 accepted
 * `convention` notes in goal `g1` on the project anchor keep `overQuota:false`;
 * note #202 is `accepted` with `overQuota:true`; `readNote(#1).overQuota` is
 * true; `listByAnchor(project, 100)` yields 100/100/2 pages with
 * complete false/false/true and the union of all 202 ids. The same-topic gate
 * sees every head past 200, so each repeated topic is refused.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const PROJECT_ANCHOR = { kind: 'project' } as const;
const LIMITS = { anchorQuota: 1000, goalQuota: 201 };

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'convention', topic: 'default topic', conclusion: 'default conclusion',
    anchor: PROJECT_ANCHOR, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'body',
    ...overrides,
  } as NoteDraftV1;
}

const topicOf = (index: number): string => `t${String(index).padStart(3, '0')}`;
const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;

/** Writes `count` accepted `convention` notes on the project anchor in goal g1. */
async function seed(f: S4ANoteFixture, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const result = await f.write(f.ctx(), general({ topic: topicOf(index) }), f.goalRef.goalId,
      { commandId: `seed-${topicOf(index)}` });
    if (result.status !== 'accepted') throw new Error(`seed ${topicOf(index)}: ${JSON.stringify(result)}`);
    if (index <= 201 && result.overQuota !== false) throw new Error(`seed ${topicOf(index)} overQuota`);
    ids.push(idOf(result));
  }
  return ids;
}

describe('S4A item 4 N-07 no 200-record stop in counts and listings', () => {
  it.each(KINDS)('N-07 %s 202 accepted notes in one goal read overQuota', async kind => {
    const f = await createS4ANoteFixture(kind, LIMITS);
    try {
      const ids = await seed(f, 201);
      const last = await f.write(f.ctx(), general({ topic: topicOf(202) }), f.goalRef.goalId,
        { commandId: 'write-202' });
      expect(last).toMatchObject({ status: 'accepted', overQuota: true });
      const first = await f.platform.notes.readNote(f.ctx(), { noteId: ids[0]! });
      if (first.status !== 'ready') throw Error('unreachable');
      expect(first.value.overQuota).toBe(true);
    } finally { await f.close(); }
  });

  it.each(KINDS)('N-07 %s listByAnchor returns every note past 200', async kind => {
    const f = await createS4ANoteFixture(kind, LIMITS);
    try {
      const ids = await seed(f, 201);
      const last = await f.write(f.ctx(), general({ topic: topicOf(202) }), f.goalRef.goalId,
        { commandId: 'write-202' });
      if (last.status !== 'accepted') throw Error('unreachable');
      const expected = new Set([...ids, idOf(last)]);
      const seen = new Set<string>();
      const sizes: number[] = [];
      const completes: boolean[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 3; page += 1) {
        const result = await f.platform.notes.listByAnchor(f.ctx(), { anchor: PROJECT_ANCHOR, limit: 100, cursor });
        if (result.status !== 'ready') throw Error(`unreachable: ${JSON.stringify(result)}`);
        sizes.push(result.value.items.length);
        completes.push(result.value.complete);
        for (const item of result.value.items) {
          expect(seen.has(item.noteId)).toBe(false);
          seen.add(item.noteId);
        }
        cursor = result.value.next;
      }
      expect(sizes).toEqual([100, 100, 2]);
      expect(completes).toEqual([false, false, true]);
      expect(cursor).toBeNull();
      expect(seen).toEqual(expected);
    } finally { await f.close(); }
  });

  it.each(KINDS)('N-07 %s listByAnchor rejects a cursor whose note is not in the set', async kind => {
    const f1 = await createS4ANoteFixture(kind, LIMITS);
    const f2 = await createS4ANoteFixture(kind, LIMITS);
    try {
      await seed(f1, 2);
      const firstPage = await f1.platform.notes.listByAnchor(f1.ctx(), { anchor: PROJECT_ANCHOR, limit: 1, cursor: null });
      if (firstPage.status !== 'ready' || firstPage.value.next === null) throw Error('unreachable');
      await seed(f2, 1);
      const result = await f2.platform.notes.listByAnchor(f2.ctx(),
        { anchor: PROJECT_ANCHOR, limit: 1, cursor: firstPage.value.next });
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' });
    } finally { await f1.close(); await f2.close(); }
  });

  it.each(KINDS)('N-04 %s the same-topic gate sees every note past 200', async kind => {
    const f = await createS4ANoteFixture(kind, LIMITS);
    try {
      await seed(f, 201);
      for (let index = 1; index <= 201; index += 1) {
        const repeat = await f.write(f.ctx(), general({ topic: topicOf(index), conclusion: 'repeat' }),
          f.goalRef.goalId, { commandId: `repeat-${topicOf(index)}` });
        expect(repeat).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'same_topic_unresolved' });
      }
    } finally { await f.close(); }
  });
});
