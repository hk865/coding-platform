/**
 * Slice 4A (NE1): the two storage-boundary interleaved-commit doubles of N-07
 * (last case) and N-14. The REAL `createS4ANoteFixture` is composed while a gate
 * wraps the real backends' `records.commit` (see
 * `tests/helpers/S4A-note-interleave-fixture.ts`); the callers are two real
 * executor Runs claimed on `t1`/`t2` of the real `s4a-goal`. Item 15d: the
 * anchor is the required real file anchor `src/a/x.ts`, and N-14 adds a
 * sequential control proving the gate is what admitted both interleaved writes.
 * Assertions go only through `readNote`; both backends run the same cases.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftAnchorV1, NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import { createS4AInterleaveFixture } from '../helpers/S4A-note-interleave-fixture.js';

const KINDS = ['memory', 'sqlite'] as const;
const FILE_ANCHOR = { kind: 'file', path: 'src/a/x.ts' } as const;
const GOAL_ANCHOR: NoteDraftAnchorV1 = { kind: 'goal', goalId: 's4a-goal' };

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'pitfall', topic: 'default topic', conclusion: 'default conclusion',
    anchor: FILE_ANCHOR, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'body',
    ...overrides,
  } as NoteDraftV1;
}

function understanding(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  const sections: NoteSectionsV1 = { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' };
  return { kind: 'understanding', topic: 'understanding', conclusion: 'current', anchor: GOAL_ANCHOR,
    extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
    sections, ...overrides } as NoteDraftV1;
}

const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;

describe('S4A N-07 storage-boundary interleaved commit', () => {
  it.each(KINDS)('N-07 %s two callers writing the 5th and 6th item are both admitted and read overQuota', async kind => {
    const f = await createS4AInterleaveFixture(kind, { anchorQuota: 5 });
    try {
      const callerA = f.workCtxA();
      const callerB = f.workCtxB();
      for (let index = 1; index <= 4; index += 1) {
        const result = await f.notes.writeNote(callerA, { commandId: `s4a-n07-pre-${String(index)}`,
          note: general({ topic: `n07-${String(index)}` }), expectedPointerRevision: null, goalId: null });
        expect(result.status).toBe('accepted');
      }
      const [fifth, sixth] = await f.interleave(
        () => f.notes.writeNote(callerA, { commandId: 's4a-n07-fifth',
          note: general({ topic: 'n07-5' }), expectedPointerRevision: null, goalId: null }),
        () => f.notes.writeNote(callerB, { commandId: 's4a-n07-sixth',
          note: general({ topic: 'n07-6' }), expectedPointerRevision: null, goalId: null }),
      );
      expect(fifth).toMatchObject({ status: 'accepted' });
      expect(sixth).toMatchObject({ status: 'accepted' });
      for (const result of [fifth, sixth]) {
        if (result.status === 'rejected') throw Error('unreachable');
        const item = await f.notes.readNote(f.hostCtx(), { noteId: result.noteId });
        if (item.status !== 'ready') throw Error('unreachable');
        expect(item.value.overQuota).toBe(true);
      }
    } finally { await f.close(); }
  });
});

describe('S4A N-14 storage-boundary interleaved same-topic writes', () => {
  it.each(KINDS)('N-14 %s two callers writing the same topic are both admitted and read conflicting', async kind => {
    const f = await createS4AInterleaveFixture(kind);
    try {
      const [first, second] = await f.interleave(
        () => f.notes.writeNote(f.workCtxA(), { commandId: 's4a-n14-a',
          note: general({ topic: 'same topic' }), expectedPointerRevision: null, goalId: null }),
        () => f.notes.writeNote(f.workCtxB(), { commandId: 's4a-n14-b',
          note: general({ topic: 'same topic' }), expectedPointerRevision: null, goalId: null }),
      );
      expect(first).toMatchObject({ status: 'accepted' });
      expect(second).toMatchObject({ status: 'accepted' });
      for (const result of [first, second]) {
        if (result.status === 'rejected') throw Error('unreachable');
        const item = await f.notes.readNote(f.hostCtx(), { noteId: result.noteId });
        if (item.status !== 'ready') throw Error('unreachable');
        expect(item.value.conflicting).toBe(true);
      }
      // The sequential control: with both interleaved writes committed, a third
      // relation-free write on the same topic sees them and is refused. This is
      // what proves the gate (not a missing same-topic check) admitted both.
      const control = await f.notes.writeNote(f.workCtxA(), { commandId: 's4a-n14-control',
        note: general({ topic: 'same topic' }), expectedPointerRevision: null, goalId: null });
      expect(control).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'same_topic_unresolved' });
      // The two accepted ids are real, distinct notes.
      expect(idOf(first)).not.toBe(idOf(second));
    } finally { await f.close(); }
  });
});

describe('S4A N-08 storage-boundary interleaved understanding writes', () => {
  it.each(KINDS)('N-08 %s a commit-time pointer conflict returns the current pointer', async kind => {
    const f = await createS4AInterleaveFixture(kind);
    try {
      const leftInput = understanding({ topic: 'n08-left' });
      const rightInput = understanding({ topic: 'n08-right' });
      const leftRequest = { commandId: 's4a-n08-interleave-a', note: leftInput, expectedPointerRevision: null,
        goalId: 's4a-goal' };
      const rightRequest = { commandId: 's4a-n08-interleave-b', note: rightInput, expectedPointerRevision: null,
        goalId: 's4a-goal' };
      const [left, right] = await f.interleave(
        () => f.notes.writeNote(f.workCtxA(), leftRequest),
        () => f.notes.writeNote(f.workCtxB(), rightRequest),
      );
      const results = [{ result: left, request: leftRequest }, { result: right, request: rightRequest }];
      const accepted = results.filter(entry => entry.result.status === 'accepted');
      const rejected = results.filter(entry => entry.result.status === 'rejected');
      expect(accepted).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const winner = accepted[0]!;
      const loser = rejected[0]!;
      const winnerId = idOf(winner.result);
      // L8: the losing commit re-reads and carries the pointer it lost to.
      expect(loser.result).toMatchObject({ status: 'rejected', code: 'revision_conflict',
        pointer: { noteId: winnerId, revision: 1 } });
      expect((loser.result as unknown as { draft: unknown }).draft).toEqual(loser.request);
      const page = await f.notes.listByAnchor(f.hostCtx(), { anchor: GOAL_ANCHOR, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.pointer).toEqual({ noteId: winnerId, revision: 1 });
    } finally { await f.close(); }
  });
});

describe('S4A N-12 memory racing replay', () => {
  it('N-12 memory two identical writes racing return one note', async () => {
    const f = await createS4AInterleaveFixture('memory');
    try {
      const ctx = f.hostCtx();
      const request = { commandId: 's4a-n12-race', note: general({ topic: 'n12-race' }),
        expectedPointerRevision: null, goalId: null };
      const [left, right] = await f.interleave(
        () => f.notes.writeNote(ctx, request),
        () => f.notes.writeNote(ctx, request),
      );
      expect(left).toEqual(right);
      expect(left.status).toBe('accepted');
      const noteId = idOf(left);
      const page = await f.notes.listByAnchor(ctx, { anchor: FILE_ANCHOR, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items.filter(item => item.noteId === noteId)).toHaveLength(1);
    } finally { await f.close(); }
  });

  it('N-12 memory a failed replay recovery is unavailable', async () => {
    const f = await createS4AInterleaveFixture('memory');
    try {
      const ctx = f.hostCtx();
      const request = { commandId: 's4a-n12-race-fail', note: general({ topic: 'n12-race-fail' }),
        expectedPointerRevision: null, goalId: null };
      // The replayed side must restore its result through `eventAt`; the injected
      // read failure must come back `unavailable`, never as a rebuilt success.
      f.failNextEventAtOnce();
      const [left, right] = await f.interleave(
        () => f.notes.writeNote(ctx, request),
        () => f.notes.writeNote(ctx, request),
      );
      const results = [left, right];
      const accepted = results.filter(result => result.status === 'accepted');
      const rejected = results.filter(result => result.status === 'rejected');
      expect(accepted).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ status: 'rejected', code: 'unavailable', draft: request });
      expect((rejected[0] as unknown as { noteId?: unknown }).noteId).toBeUndefined();
      const page = await f.notes.listByAnchor(ctx, { anchor: FILE_ANCHOR, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items).toHaveLength(1);
      expect(page.value.items[0]!.noteId).toBe(idOf(accepted[0]!));
    } finally { await f.close(); }
  });
});
