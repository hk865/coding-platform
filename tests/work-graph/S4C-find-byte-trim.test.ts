/**
 * Slice 4C-1 rework (spec §11.2/§11.4, §11.7): RW-9's byte trim and `boundary`.
 *
 * (i) an empty-items `match:'all'` segmented page with a non-null port `next`
 *     and a small `resultMaxBytes` that forces a norm trim keeps its cursor;
 * (ii) a two-item segmented page near the bound is trimmed with `boundary`
 *     counted (the final serialized size is ≤ the bound, so no bound warning).
 *
 * Read through `platform.notes.memoryFind` (NE3); expected values literal.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind, type S4ANoteLimits } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const GOAL = 's4a-goal';
// Probed through the public read on both backends: a two-item page serializes
// to 2,181 bytes with `boundary` and 2,128 without it; the post-trim one-item
// page is ~2,012 bytes. 2,150 sits between the boundary-less two-item page and
// the full two-item page, so the trim only happens when `boundary` is measured.
const TWO_ITEM_PAGE_BYTES = 2150;

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'topic', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'module', moduleId: 'B' }, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeNote(f: S4ANoteFixture, d: NoteDraftV1): Promise<string> {
  const result = await f.write(f.ctx(), d, null);
  if (result.status === 'rejected') throw new Error(`note rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

async function build(kind: S4ANoteFixtureKind, resultMaxBytes: number): Promise<S4ANoteFixture> {
  const noteLimits = { resultMaxBytes } as unknown as S4ANoteLimits;
  return createS4ANoteFixture(kind, { noteLimits });
}

describe('S4C find byte trim keeps an empty page cursor and counts boundary (RW-9)', () => {
  it.each(KINDS)('RW-9(i) %s: an empty match:all page with a port next keeps its cursor through a norm trim', async kind => {
    const f = await build(kind, 1);
    try {
      // The header always has one eligible project norm, so the norm-trim loop runs.
      await writeNote(f, draft({ kind: 'convention', topic: 'project norm', conclusion: 'the norm',
        anchor: { kind: 'project' } }));
      // Three pitfalls match the term but fail the `kind: 'convention'` filter,
      // so the port page is incomplete while the filtered page is empty.
      for (let index = 0; index < 3; index += 1) {
        await writeNote(f, draft({ topic: `alpha ${String(index)}` }));
      }
      const read = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        terms: ['alpha'], match: 'all', kind: 'convention',
        related: { kind: 'task', goalId: GOAL, taskId: 't1' }, limit: 2, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items).toHaveLength(0);
      // The empty page still has more to scan; the norm trim must not drop it.
      expect(read.value.next).not.toBe(null);
    } finally { await f.close(); }
  });

  it.each(KINDS)('RW-9(ii) %s: a two-item page is trimmed with boundary counted', async kind => {
    const f = await build(kind, TWO_ITEM_PAGE_BYTES);
    try {
      const run = await f.claimRun('rw9ii', 't3', 'scribe');
      const written = await f.write(f.workCtx(run), draft({ topic: 'r',
        anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }), null);
      if (written.status === 'rejected') throw new Error(JSON.stringify(written));
      await writeNote(f, draft({ topic: 'p' }));

      const read = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        related: { kind: 'task', goalId: GOAL, taskId: 't1' }, limit: 2, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      // `boundary` is inside the measured result, so the second item is trimmed
      // and the one-item page fits under the bound.
      expect(read.value.items).toHaveLength(1);
      expect(read.value.items[0]!.segment).toBe('related');
      expect(Buffer.byteLength(JSON.stringify(read.value), 'utf8')).toBeLessThanOrEqual(TWO_ITEM_PAGE_BYTES);
      expect(read.value.warnings).not.toContain('result_over_byte_bound');
    } finally { await f.close(); }
  });
});

describe('S4C find byte trim keeps checked norms counted (rework item 3)', () => {
  it.each(KINDS)('RW-9(iii) %s: a norm trimmed from the shown header stays in coverage and observedFiles', async kind => {
    const f = await build(kind, 1);
    try {
      // Two eligible project norms, each with a basis file. Norms are listed
      // newest-first, so a trim drops the older one (and, with a bound of 1,
      // the newer one too) from the SHOWN header list.
      await writeNote(f, draft({ kind: 'convention', topic: 'norm a', conclusion: 'a',
        basisFiles: ['src/a/x.ts'], anchor: { kind: 'project' } }));
      await writeNote(f, draft({ kind: 'convention', topic: 'norm b', conclusion: 'b',
        basisFiles: ['src/a/one/x.ts'], anchor: { kind: 'project' } }));

      const read = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        terms: ['no-such-term-xyz'], limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items).toHaveLength(0);
      // The bound trims every shown norm; the project part is still present.
      expect(read.value.project?.norms).toHaveLength(0);
      expect(read.value.project?.omitted).toBe(2);
      // Ruling (rework item 3): while the project header is kept, every checked
      // norm stays counted in coverage/filesRead/observedFiles even when the
      // trim removed it from the shown list.
      expect(read.value.coverage.checkedItems).toBe(2);
      expect(read.value.coverage.filesRead).toBe(2);
      expect(read.value.readBasis.observedFiles.map(observation => observation.path).sort())
        .toEqual(['src/a/one/x.ts', 'src/a/x.ts']);
    } finally { await f.close(); }
  });
});
