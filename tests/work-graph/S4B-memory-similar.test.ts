/**
 * Slice 4B G3 — M-13 similar notes. The candidate notes come from the real 4A
 * writer; `similar` is read through the public `NoteCheckPort.checkNotes(...,
 * { withSimilar: true })`. Expected Jaccard values are the spec's literals
 * (10/11 ≈ 0.909).
 */
import { describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'sim', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function pendingCandidate(f: Awaited<ReturnType<typeof createS4BNoteCheckFixture>>, runCtx: CoreCallContext,
  topic: string, conclusion: string): Promise<string> {
  const result = await f.inner.write(runCtx, draft({ topic, conclusion, structural: true }), null);
  if (result.status === 'rejected') throw new Error(`candidate rejected: ${JSON.stringify(result)}`);
  if (result.status !== 'pending_review') throw new Error(`candidate not pending: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('S4B M-13 similar notes', () => {
  it.each(['memory', 'sqlite'] as const)('M-13 %s: a candidate with a 10/11 window overlap is listed and an unrelated one is not', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const run = await f.inner.claimRun('m13');
      const related = await pendingCandidate(f, f.inner.workCtx(run), 'auth flow', 'use jwt now');
      const unrelated = await pendingCandidate(f, f.inner.workCtx(run), '认证流程', '用令牌');
      // The subject is a user note, so the same-topic gate passes over the
      // pending candidates and it is accepted.
      const subject = await f.inner.write(f.ctx(), draft({ topic: 'auth flow', conclusion: 'use jwt' }), null);
      if (subject.status === 'rejected') throw new Error(JSON.stringify(subject));

      const checks = await f.inner.platform.notes.checkNotes(f.ctx(), { items: [{ noteId: subject.noteId, version: 1 }],
        withSimilar: true });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      const similar = checks.value[0]!.similar ?? [];
      expect(similar).toHaveLength(1);
      expect(similar[0]!.noteId).toBe(related);
      expect(similar[0]!.version).toBe(1);
      expect(similar[0]!.similarity).toBeCloseTo(10 / 11, 10);
      expect(similar.some(item => item.noteId === unrelated)).toBe(false);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-13 %s: at most three candidates are returned, ties by noteId', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const run = await f.inner.claimRun('m13b');
      const candidates: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        candidates.push(await pendingCandidate(f, f.inner.workCtx(run), 'same topic', 'identical words here'));
      }
      const subject = await f.inner.write(f.ctx(), draft({ topic: 'same topic', conclusion: 'identical words here' }), null);
      if (subject.status === 'rejected') throw new Error(JSON.stringify(subject));
      const checks = await f.inner.platform.notes.checkNotes(f.ctx(), { items: [{ noteId: subject.noteId, version: 1 }],
        withSimilar: true });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      const similar = checks.value[0]!.similar ?? [];
      expect(similar).toHaveLength(3);
      expect(similar.map(item => item.noteId)).toEqual([...candidates].sort().slice(0, 3));
    } finally { await f.close(); }
  });
});
