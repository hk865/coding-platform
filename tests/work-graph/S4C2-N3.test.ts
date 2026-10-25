/**
 * Slice 4C-2 N3 (item 8 acceptance, lead ruling 8/M3): `seenThrough` advances
 * only over lines this read has already shown, including earlier pages of the
 * same read. The whole seed is public writes and real scribe dispositions over
 * memory and SQLite; no `NoteVersion` is built by hand.
 *
 * Commit order of the three notice versions:
 *   1. g1 scribe result (scribe withdraw)          c1
 *   2. g1 `user_affected` (agent understanding over the user-confirmed one)  c2
 *   3. g1 scribe result (scribe accept)            c3
 * The `scribe_result` versions fold into ONE line at the newest member (c3),
 * so a limit-1 first page shows only the `user_affected` item at c2. It must not
 * claim any `seenThrough`: member c1 of the folded line is still unshown. The
 * second page shows the folded line (members c1 and c3) and, because M3 counts
 * the first page's line too, its `seenThrough` reaches c3; marking it seen
 * empties the `note_review` stream.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import { seqOfCommitCursor } from '../../src/contracts/ledger.js';
import {
  createS4C2NoteCardFixture,
  generalNote,
  moduleAnchor,
  understandingNote,
  type S4C2NoteCardFixture,
} from '../helpers/S4C2-note-card-fixture.js';

const KINDS = ['memory', 'sqlite'] as const;
const PROJECT_ID = 's4a-scope-project';
const fixtures: S4C2NoteCardFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

function versionKey(noteId: string, version: number): string {
  return `note_review:{"aggregateType":"NoteVersion","noteId":"${noteId}",`
    + `"projectId":"${PROJECT_ID}","version":${String(version)}}`;
}
function idOf(result: { status: string }): string {
  return (result as unknown as { noteId: string }).noteId;
}
function cursorOf(result: { status: string }): CommitCursor {
  return (result as unknown as { receipt: { cursor: CommitCursor } }).receipt.cursor;
}

describe('S4C2 N3 seenThrough only over delivered members', () => {
  it.each(KINDS)('N3 %s: a middle own-line page does not authorize the folded predecessor', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);

    // Seeds (their write versions are not notices): the user's current
    // understanding, the note withdrawn at c1, and the live target superseded
    // by the understanding's accept at c2.
    const u1 = await f.writeUser(understandingNote({ conclusion: 'user understanding' }), f.goalRef.goalId);
    const withdrawn = await f.writeAgent(f.executor,
      generalNote({ topic: 'withdrawn', anchor: moduleAnchor('M1') }), f.goalRef.goalId);
    const understandingTarget = await f.writeAgent(f.executor,
      generalNote({ topic: 'understanding-target' }), f.goalRef.goalId);
    const u2 = await f.writeAgent(f.executor, understandingNote({
      conclusion: 'agent understanding', replaces: [idOf(u1)], contradicts: [idOf(understandingTarget)],
    }), f.goalRef.goalId, { expectedPointerRevision: 1 });
    expect(u2).toMatchObject({ status: 'pending_review', version: 1 });
    // The note accepted at c3 and its live contradiction target.
    const acceptedTarget = await f.writeAgent(f.executor,
      generalNote({ topic: 'accepted-target', anchor: moduleAnchor('M3') }), f.goalRef.goalId);
    const accepted = await f.writeAgent(f.executor, generalNote({
      topic: 'accepted', anchor: moduleAnchor('M3'), contradicts: [idOf(acceptedTarget)],
    }), f.goalRef.goalId);
    expect(accepted).toMatchObject({ status: 'pending_review', version: 1 });
    expect([idOf(u1), idOf(withdrawn), idOf(understandingTarget), idOf(u2), idOf(acceptedTarget), idOf(accepted)])
      .toEqual([f.noteId(1), f.noteId(2), f.noteId(3), f.noteId(4), f.noteId(5), f.noteId(6)]);

    // The three notice versions, in exactly this commit order.
    const first = await f.withdraw(f.scribe, idOf(withdrawn));
    const second = await f.review(f.scribe, idOf(u2), {
      verdict: 'accept', resolution: 'supersede', expectedVersion: 1, expectedPointerRevision: 1,
    });
    const third = await f.review(f.scribe, idOf(accepted), {
      verdict: 'accept', resolution: 'supersede', expectedVersion: 1,
    });
    expect(first).toMatchObject({ status: 'done', state: 'withdrawn' });
    expect(second).toMatchObject({ status: 'done', state: 'accepted' });
    expect(third).toMatchObject({ status: 'done', state: 'accepted' });
    const c1 = cursorOf(first), c2 = cursorOf(second), c3 = cursorOf(third);
    // The three notice versions are in commit order: c1 < c2 < c3 literally.
    // (A commit's cursor is its last event, so the gaps are not asserted.)
    expect(seqOfCommitCursor(c1)).toBeLessThan(seqOfCommitCursor(c2));
    expect(seqOfCommitCursor(c2)).toBeLessThan(seqOfCommitCursor(c3));

    const page1 = await f.queue({ limit: 1 });
    expect(page1.notices).toHaveLength(1);
    expect(page1.counts.notices.note_review).toBe(3);
    const middle = page1.notices[0]!;
    expect(middle.noteClass).toBe('user_affected');
    expect(middle.summary).toBe('注记 · 收下 · 当前理解(目标 s4a-goal)：agent understanding');
    expect(middle.position).toEqual({ kind: 'commit', cursor: c2, itemKey: versionKey(f.noteId(4), 2) });
    // The folded line (members c1 and c3) is not shown; member c1 is not
    // delivered, so no note_review watermark may be claimed.
    expect(page1.seenThrough.note_review).toBeUndefined();
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await f.queue({ limit: 1, cursor: page1.nextCursor! });
    expect(page2.notices).toHaveLength(1);
    const folded = page2.notices[0]!;
    expect(folded.summary).toBe('书记整理 · 2 条注记');
    expect(folded.subject).toEqual({ kind: 'goal', goalRef: f.goalRef });
    expect(folded.members?.map(member => member.itemKey)).toEqual([
      versionKey(f.noteId(2), 2), versionKey(f.noteId(6), 2),
    ]);
    expect(folded.members?.map(member => member.position)).toEqual([
      { kind: 'commit', cursor: c1, itemKey: versionKey(f.noteId(2), 2) },
      { kind: 'commit', cursor: c3, itemKey: versionKey(f.noteId(6), 2) },
    ]);
    expect(folded.position).toEqual(folded.members![1]!.position);
    // M3: the first page's `user_affected` line counts as shown, so the folded
    // line authorizes both c1 and c3.
    expect(page2.seenThrough.note_review).toEqual(folded.members![1]!.position);

    await f.markSeen(page2);
    const after = await f.queue({ limit: 10 });
    expect(after.notices).toEqual([]);
    expect(after.counts.notices.note_review ?? 0).toBe(0);
  });
});
