/**
 * Slice 4C-2 N1 (item 8 acceptance): the `note_review` folded lines over a REAL
 * platform (memory and SQLite), seeded only through public writes and scribe
 * dispositions. No hand-built `NoteVersion`, no hand-filled `noticeClass`.
 *
 * g1's real scribe withdraws two agent notes and accepts one pending agent note
 * (a live contradiction resolved with `supersede`); g2's scribe rejects one
 * pending agent note. The queue then folds g1's three `scribe_result` versions
 * into one line and leaves g2's single one as its own folded line.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import { seqOfCommitCursor } from '../../src/contracts/ledger.js';
import {
  createS4C2NoteCardFixture,
  generalNote,
  moduleAnchor,
  type S4C2NoteCardFixture,
} from '../helpers/S4C2-note-card-fixture.js';

const KINDS = ['memory', 'sqlite'] as const;
const PROJECT_ID = 's4a-scope-project';
const fixtures: S4C2NoteCardFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

/** The literal `itemKey` of one version (`noteVersionRefKey` is canonical JSON). */
function versionKey(noteId: string, version: number): string {
  return `note_review:{"aggregateType":"NoteVersion","noteId":"${noteId}",`
    + `"projectId":"${PROJECT_ID}","version":${String(version)}}`;
}

describe('S4C2 N1 note_review folding over a real platform', () => {
  it.each(KINDS)('N1 %s: one g1 line with three members and one g2 line with one', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);

    // g1: two accepted agent notes to withdraw, one accepted target and one
    // pending contradicting note to accept. g2: one accepted target and one
    // pending contradicting note to reject.
    const a1 = await f.writeAgent(f.executor, generalNote({ topic: 'a1', anchor: moduleAnchor('M1') }), f.goalRef.goalId);
    const a2 = await f.writeAgent(f.executor, generalNote({ topic: 'a2', anchor: moduleAnchor('M2') }), f.goalRef.goalId);
    const target1 = await f.writeAgent(f.executor,
      generalNote({ topic: 'target1', anchor: moduleAnchor('M3') }), f.goalRef.goalId);
    const pending1 = await f.writeAgent(f.executor,
      generalNote({ topic: 'pending1', anchor: moduleAnchor('M3'), contradicts: [idOf(target1)] }), f.goalRef.goalId);
    const target2 = await f.writeAgent(f.executor2,
      generalNote({ topic: 'target2', anchor: moduleAnchor('M4') }), f.goal2Ref.goalId);
    const pending2 = await f.writeAgent(f.executor2,
      generalNote({ topic: 'pending2', anchor: moduleAnchor('M4'), contradicts: [idOf(target2)] }), f.goal2Ref.goalId);

    // Deterministic ids prove the item keys below are literals, not captured values.
    expect([idOf(a1), idOf(a2), idOf(target1), idOf(pending1), idOf(target2), idOf(pending2)])
      .toEqual([f.noteId(1), f.noteId(2), f.noteId(3), f.noteId(4), f.noteId(5), f.noteId(6)]);
    expect([a1.status, a2.status, target1.status, target2.status]).toEqual(
      ['accepted', 'accepted', 'accepted', 'accepted']);
    expect([pending1.status, pending2.status]).toEqual(['pending_review', 'pending_review']);

    // The real scribe dispositions, in commit order: withdraw, withdraw, accept,
    // reject. The accepts carry the required live-contradiction resolution.
    const w1 = await f.withdraw(f.scribe, idOf(a1));
    const w2 = await f.withdraw(f.scribe, idOf(a2));
    const accepted = await f.review(f.scribe, idOf(pending1), { verdict: 'accept', resolution: 'supersede' });
    const rejected = await f.review(f.scribe, idOf(pending2), { verdict: 'reject' });
    expect(w1).toMatchObject({ status: 'done', state: 'withdrawn', version: 2 });
    expect(w2).toMatchObject({ status: 'done', state: 'withdrawn', version: 2 });
    expect(accepted).toMatchObject({ status: 'done', state: 'accepted', version: 2 });
    expect(rejected).toMatchObject({ status: 'done', state: 'rejected', version: 2 });
    const c1 = cursorOf(w1), c2 = cursorOf(w2), c3 = cursorOf(accepted), c4 = cursorOf(rejected);
    // The dispositions commit in the order they were made (cursors are ordered strings).
    expect(seqOfCommitCursor(c1)).toBeLessThan(seqOfCommitCursor(c2));
    expect(seqOfCommitCursor(c2)).toBeLessThan(seqOfCommitCursor(c3));
    expect(seqOfCommitCursor(c3)).toBeLessThan(seqOfCommitCursor(c4));

    const read = await f.queue({ limit: 50 });
    expect(read.counts.notices.note_review).toBe(4);
    expect(read.notices).toHaveLength(2);

    const g1 = read.notices.find(item => item.goalRef.goalId === f.goalRef.goalId)!;
    const g2 = read.notices.find(item => item.goalRef.goalId === f.goal2Ref.goalId)!;
    expect(g1.summary).toBe('书记整理 · 3 条注记');
    expect(g2.summary).toBe('书记整理 · 1 条注记');
    expect(g1.itemKey).toBe(`note_review_scribe:${PROJECT_ID}/${f.goalRef.goalId}`);
    expect(g2.itemKey).toBe(`note_review_scribe:${PROJECT_ID}/${f.goal2Ref.goalId}`);
    expect([g1.members?.length, g2.members?.length]).toEqual([3, 1]);
    expect(g1.goalRef).toEqual(f.goalRef);
    expect(g2.goalRef).toEqual(f.goal2Ref);

    expect(g1.members!.map(member => member.itemKey)).toEqual([
      versionKey(f.noteId(1), 2), versionKey(f.noteId(2), 2), versionKey(f.noteId(4), 2),
    ]);
    expect(g1.members!.map(member => member.position)).toEqual([
      { kind: 'commit', cursor: c1, itemKey: versionKey(f.noteId(1), 2) },
      { kind: 'commit', cursor: c2, itemKey: versionKey(f.noteId(2), 2) },
      { kind: 'commit', cursor: c3, itemKey: versionKey(f.noteId(4), 2) },
    ]);
    expect(g2.members!.map(member => member.itemKey)).toEqual([versionKey(f.noteId(6), 2)]);
    expect(g2.members![0]!.position).toEqual({ kind: 'commit', cursor: c4, itemKey: versionKey(f.noteId(6), 2) });
    // The folded line's own position is its newest member's.
    expect(g1.position).toEqual(g1.members![2]!.position);
    expect(g2.position).toEqual(g2.members![0]!.position);
  });
});

function idOf(result: { status: string }): string {
  return (result as unknown as { noteId: string }).noteId;
}
function cursorOf(result: { status: string }): CommitCursor {
  return (result as unknown as { receipt: { cursor: CommitCursor } }).receipt.cursor;
}
