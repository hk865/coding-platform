/**
 * Slice 4A round 2 item 3 (NE1): read failures never become a definite answer.
 * The tests run against the real public `platform.notes` on the memory backend
 * (the read-fault double is memory-only) plus the real scope fixture on both
 * backends for the forbidden-path case. Expected values are literal from item 3
 * of the round-2 task; the record store is never read to answer an assertion.
 */
import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NoteDraftAnchorV1, NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import { createS4ANoteFaultFixture } from '../helpers/S4A-note-fault-fixture.js';
import { createS4ANoteScopeFixture, type S4ANoteScopeFixtureKind } from '../helpers/S4A-note-scope-fixture.js';

const PROJECT_ANCHOR: NoteDraftAnchorV1 = { kind: 'project' };

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'pitfall', topic: 'default topic', conclusion: 'default conclusion',
    anchor: PROJECT_ANCHOR, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'body',
    ...overrides,
  } as NoteDraftV1;
}

function understanding(anchor: NoteDraftAnchorV1, overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  const sections: NoteSectionsV1 = { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' };
  return { kind: 'understanding', topic: 'understanding', conclusion: 'current', anchor, extraAnchors: [],
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], sections,
    ...overrides } as NoteDraftV1;
}

const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;

describe('S4A item 3 read failures (fault double, memory)', () => {
  it('N-04 a failed anchor lookup refuses the write', async () => {
    const f = await createS4ANoteFaultFixture();
    try {
      const ctx = f.ctx();
      const n1 = await f.write(ctx, general({ topic: 'auth', conclusion: 'first' }), null, { commandId: 'a-1' });
      expect(n1.status).toBe('accepted');
      f.arm({ kind: 'lookup', index: 's4-note-by-anchor-0' });
      const secondDraft = general({ topic: 'auth', conclusion: 'second' });
      const second = await f.write(ctx, secondDraft, null, { commandId: 'a-2' });
      expect(second).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect((second as unknown as { draft: unknown }).draft)
        .toEqual({ commandId: 'a-2', note: secondDraft, expectedPointerRevision: null, goalId: null });
      f.disarm();
      const page = await f.notes.listByAnchor(ctx, { anchor: PROJECT_ANCHOR, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items.map(item => item.noteId)).toEqual([idOf(n1)]);
      expect(page.value.complete).toBe(true);
    } finally { await f.close(); }
  });

  it('N-07 a failed goal-state lookup refuses the write', async () => {
    const f = await createS4ANoteFaultFixture();
    try {
      const ctx = f.ctx();
      const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: f.goalRef.goalId };
      f.arm({ kind: 'lookup', index: 's4-note-by-review-status' });
      const result = await f.write(ctx, general({ topic: 'goal topic', anchor: goalAnchor }), f.goalRef.goalId,
        { commandId: 'b-1' });
      expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
      f.disarm();
      const page = await f.notes.listByAnchor(ctx, { anchor: goalAnchor, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items).toEqual([]);
    } finally { await f.close(); }
  });

  it('N-08 an unreadable current understanding blocks the pointer move', async () => {
    const f = await createS4ANoteFaultFixture();
    try {
      const ctx = f.ctx();
      const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: f.goalRef.goalId };
      const u1 = await f.write(ctx, understanding(goalAnchor, { topic: 'u1' }), f.goalRef.goalId,
        { commandId: 'c-1', expectedPointerRevision: null });
      expect(u1.status).toBe('accepted');
      const u1Id = idOf(u1);
      f.arm({ kind: 'readMany', refKeyIncludes: u1Id });
      const u2 = await f.write(ctx, understanding(goalAnchor, { topic: 'u2' }), f.goalRef.goalId,
        { commandId: 'c-2', expectedPointerRevision: 1 });
      expect(u2).toMatchObject({ status: 'rejected', code: 'unavailable' });
      f.disarm();
      const page = await f.notes.listByAnchor(ctx, { anchor: goalAnchor, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.pointer).toEqual({ noteId: u1Id, revision: 1 });
      const read = await f.notes.readNote(ctx, { noteId: u1Id });
      if (read.status !== 'ready') throw Error('unreachable');
      expect(read.value.storedState).toBe('accepted');
    } finally { await f.close(); }
  });

  it('N-08 an unreadable pointer is unavailable, not absent', async () => {
    const f = await createS4ANoteFaultFixture();
    try {
      const ctx = f.ctx();
      const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: f.goalRef.goalId };
      expect((await f.write(ctx, understanding(goalAnchor, { topic: 'd1' }), f.goalRef.goalId,
        { commandId: 'd-1', expectedPointerRevision: null })).status).toBe('accepted');
      f.arm({ kind: 'readMany', refKeyIncludes: 'CurrentPointer' });
      const page = await f.notes.listByAnchor(ctx, { anchor: goalAnchor, limit: 100, cursor: null });
      expect(page).toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally { await f.close(); }
  });

  it('N-11 an unreadable head is unavailable, not not_found', async () => {
    const f = await createS4ANoteFaultFixture();
    try {
      const ctx = f.ctx();
      const n1 = await f.write(ctx, general({ topic: 'e1' }), null, { commandId: 'e-1' });
      expect(n1.status).toBe('accepted');
      const n1Id = idOf(n1);
      f.arm({ kind: 'readMany', refKeyIncludes: n1Id });
      expect(await f.notes.readNote(ctx, { noteId: n1Id })).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(await f.notes.readNote(ctx, { noteId: n1Id, version: 1 }))
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally { await f.close(); }
  });

  it('N-02 a failed catalog read is not anchor_not_found', async () => {
    const f = await createS4ANoteFaultFixture();
    try {
      const ctx = f.ctx();
      f.arm({ kind: 'readMany' });
      const result = await f.write(ctx, general({ topic: 'f1', anchor: { kind: 'module', moduleId: 'A' } }), null,
        { commandId: 'f-1' });
      expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally { await f.close(); }
  });

  it('N-10 count unavailable', async () => {
    const f = await createS4ANoteFaultFixture();
    try {
      const ctx = f.ctx();
      f.arm({ kind: 'readArchitectureRevision' });
      expect(await f.notes.countCurrentNotes(ctx, { scope: { kind: 'region', moduleId: 'A1' } }))
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
      f.disarm();
      f.arm({ kind: 'findSessions' });
      expect(await f.notes.countCurrentNotes(ctx, { scope: { kind: 'region', moduleId: 'A1' } }))
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally { await f.close(); }
  });
});

const KINDS: readonly S4ANoteScopeFixtureKind[] = ['memory', 'sqlite'];

describe('S4A item 3 forbidden file anchors (real scope fixture)', () => {
  it.each(KINDS)('N-20 %s a forbidden path is never a missing file', async kind => {
    const f = await createS4ANoteScopeFixture(kind);
    try {
      const ctx = f.ctx();
      await writeFile(join(f.root, '.env'), 'S4A_SECRET=1\n');
      const deleted = await f.write(ctx, general({ topic: 'h-1', anchor: PROJECT_ANCHOR,
        extraAnchors: [{ kind: 'file', path: '.env', deleted: true }],
        facts: [{ kind: 'commit', sha: 'a'.repeat(40) }] }), null, { commandId: 'h-1' });
      expect(deleted).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'anchor_forbidden' });
      expect(deleted).not.toHaveProperty('anchorCandidates');
      const live = await f.write(ctx, general({ topic: 'h-2', anchor: { kind: 'file', path: '.env' } }), null,
        { commandId: 'h-2' });
      expect(live).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'anchor_forbidden' });
      expect(live).not.toHaveProperty('anchorCandidates');
      const page = await f.notes.listByAnchor(ctx, { anchor: PROJECT_ANCHOR, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items).toEqual([]);
    } finally { await f.close(); }
  });
});
