/**
 * Slice 4C-2 N2 (item 8 acceptance): the own-line `note_review` notices over a
 * REAL platform (memory and SQLite), seeded only through public writes and real
 * scribe dispositions.
 *
 * The user writes the current goal understanding. The agent writes an ordinary
 * note and an understanding that replaces the user's understanding and
 * contradicts the ordinary note; the real scribe accepts it with the required
 * `resolution: 'supersede'`, so the accepted version supersedes a user-confirmed
 * note and is classified `user_affected`. The agent also writes a structural
 * ordinary note, which the writer accepts directly and classifies `structural`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createS4C2NoteCardFixture,
  generalNote,
  S4C2_PROJECT_ANCHOR,
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

describe('S4C2 N2 own-line note_review notices over a real platform', () => {
  it.each(KINDS)('N2 %s: the replaced understanding and the structural note are own lines', async kind => {
    const f = await createS4C2NoteCardFixture(kind);
    fixtures.push(f);

    // The user-confirmed current understanding and a live agent note.
    const u1 = await f.writeUser(understandingNote({ conclusion: 'user understanding' }), f.goalRef.goalId);
    expect(u1).toMatchObject({ status: 'accepted', confirmedByUser: true, version: 1 });
    const live = await f.writeAgent(f.executor,
      generalNote({ topic: 'live' }), f.goalRef.goalId);
    expect(live.status).toBe('accepted');

    // The agent's understanding replaces the user's and contradicts the live
    // note, so it is pending for a live contradiction with no USER reason.
    const u2 = await f.writeAgent(f.executor, understandingNote({
      conclusion: 'agent understanding', replaces: [idOf(u1)], contradicts: [idOf(live)],
    }), f.goalRef.goalId, { expectedPointerRevision: 1 });
    expect(u2).toMatchObject({ status: 'pending_review', reasons: ['contradiction'], version: 1 });

    // The real scribe must give the resolution; accepting supersedes the user's
    // understanding (user_affected) and the contradicted agent note.
    const accepted = await f.review(f.scribe, idOf(u2), {
      verdict: 'accept', resolution: 'supersede', expectedVersion: 1, expectedPointerRevision: 1,
    });
    expect(accepted).toMatchObject({ status: 'done', state: 'accepted', version: 2 });

    // An agent structural ordinary note: the writer accepts it directly.
    const structural = await f.writeAgent(f.executor, generalNote({
      topic: 'structural', conclusion: 'structural conclusion', structural: true,
      anchor: S4C2_PROJECT_ANCHOR,
    }), f.goalRef.goalId);
    expect(structural).toMatchObject({ status: 'accepted', version: 1, reasons: [] });

    expect([idOf(u1), idOf(live), idOf(u2), idOf(structural)]).toEqual([
      f.noteId(1), f.noteId(2), f.noteId(3), f.noteId(4),
    ]);

    const read = await f.queue({ limit: 50 });
    expect(read.counts.notices.note_review).toBe(2);
    expect(read.notices).toHaveLength(2);
    expect(read.notices.map(item => item.summary)).toEqual([
      '注记 · 收下 · 当前理解(目标 s4a-goal)：agent understanding',
      '注记 · 写入 · 坑(项目)!：structural conclusion',
    ]);
    expect(read.notices.map(item => item.noteClass)).toEqual(['user_affected', 'structural']);
    expect(read.notices.map(item => item.itemKey)).toEqual([
      versionKey(f.noteId(3), 2), versionKey(f.noteId(4), 1),
    ]);
    // Both are own lines: the grouping never attaches a member set to them.
    expect(read.notices.map(item => item.members)).toEqual([undefined, undefined]);
    expect(read.notices.map(item => item.subject))
      .toEqual([{ kind: 'goal', goalRef: f.goalRef }, { kind: 'goal', goalRef: f.goalRef }]);
  });
});
