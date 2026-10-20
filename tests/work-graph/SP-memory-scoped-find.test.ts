/**
 * SP (decision 66, S2.1 / S2.2) — scoped `find` candidates: with an anchor or a
 * path prefix the read model never calls the text port; the candidates are the
 * in-scope heads, matched on the shared comparison text and ordered by refKey.
 *
 * Data through the real 4A writer; assertions through the real `memoryFind`.
 * Every expected value is a literal (the T-07 scores are the spec's literals).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'sp-find', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function write(f: S4BNoteCheckFixture, note: NoteDraftV1): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, null);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('SP-6 T-07 scoring under an anchor with off-anchor noise', () => {
  it.each(['memory', 'sqlite'] as const)(
    'SP-6 %s: off-anchor notes holding the same terms do not change the scores or order', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        const n1 = await write(f, draft({ topic: 'alpha topic', conclusion: 'beta conclusion', body: 'plain' }));
        const n2 = await write(f, draft({ topic: 'neutral two', conclusion: 'alpha conclusion', body: 'beta body' }));
        const n3 = await write(f, draft({ topic: 'neutral three', conclusion: 'plain conclusion', body: 'alpha body' }));
        // Off-anchor noise with the same two terms.
        await write(f, draft({ topic: 'alpha off', conclusion: 'beta off', body: 'alpha beta',
          anchor: { kind: 'file', path: 'src/a/x.ts' } }));
        await write(f, draft({ topic: 'beta off', conclusion: 'alpha off', body: 'beta alpha',
          anchor: { kind: 'file', path: 'src/b/y.ts' } }));

        const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha', 'beta'],
          match: 'any', anchor: { kind: 'project' }, limit: 20, cursor: null });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        expect(read.value.items.map(item => item.noteId)).toEqual([n1, n2, n3]);
        expect(read.value.items[0]!.score).toBeCloseTo(3.9120, 3);
        expect(read.value.items[1]!.score).toBeCloseTo(2.3026, 3);
        expect(read.value.items[2]!.score).toBeCloseTo(0.6931, 3);
        expect(read.value.items[0]!.matchedTerms).toEqual(['alpha', 'beta']);
        expect(read.value.items[1]!.matchedTerms).toEqual(['alpha', 'beta']);
        expect(read.value.items[2]!.matchedTerms).toEqual(['alpha']);
        expect(read.value.ranking).toBe('full');
        expect(read.value.complete).toBe(true);
        expect(read.value.warnings).toEqual([]);
      } finally { await f.close(); }
    });
});

describe('SP-7 the read-model candidate cap on a scoped any find', () => {
  it.each(['memory', 'sqlite'] as const)(
    'SP-7 %s: anchor + common term with textSearchCandidateMax 2 is the first two ids, partial, warned', async kind => {
      const f = await createS4BNoteCheckFixture(kind, { textSearchCandidateMax: 2 });
      try {
        const ids = [
          await write(f, draft({ topic: 'alpha one' })),
          await write(f, draft({ topic: 'alpha two' })),
          await write(f, draft({ topic: 'alpha three' })),
        ];
        const expected = [...ids].sort().slice(0, 2);
        const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha'],
          match: 'any', anchor: { kind: 'project' }, limit: 20, cursor: null });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        expect(read.value.items.map(item => item.noteId)).toEqual(expected);
        for (const item of read.value.items) {
          expect(item.matchedTerms).toEqual(['alpha']);
          expect(item.score).toBeCloseTo(3 * Math.LN2, 6);
        }
        expect(read.value.ranking).toBe('partial');
        expect(read.value.complete).toBe(false);
        expect(read.value.warnings.join('')).toContain('锚点');
      } finally { await f.close(); }
    });

  it.each(['memory', 'sqlite'] as const)(
    'SP-7 %s: limit-1 paging keeps the partial ranking and returns the second id on page 2', async kind => {
      const f = await createS4BNoteCheckFixture(kind, { textSearchCandidateMax: 2 });
      try {
        const ids = [
          await write(f, draft({ topic: 'alpha one' })),
          await write(f, draft({ topic: 'alpha two' })),
          await write(f, draft({ topic: 'alpha three' })),
        ];
        const expected = [...ids].sort();
        const request = { v: 1 as const, op: 'find' as const, terms: ['alpha'], match: 'any' as const,
          anchor: { kind: 'project' as const }, limit: 1, cursor: null as string | null };
        const first = await f.memory.memoryFind(f.ctx(), request);
        expect(first.status).toBe('ready');
        if (first.status !== 'ready') return;
        expect(first.value.items.map(item => item.noteId)).toEqual([expected[0]]);
        expect(first.value.ranking).toBe('partial');
        expect(first.value.complete).toBe(false);
        expect(first.value.warnings.join('')).toContain('锚点');
        const second = await f.memory.memoryFind(f.ctx(), { ...request, cursor: first.value.next });
        expect(second.status).toBe('ready');
        if (second.status !== 'ready') return;
        expect(second.value.items.map(item => item.noteId)).toEqual([expected[1]]);
        expect(second.value.next).toBe(null);
        expect(second.value.ranking).toBe('partial');
        expect(second.value.complete).toBe(false);
      } finally { await f.close(); }
    });
});

describe('SP-8 path prefix over main and extra file slots', () => {
  it.each(['memory', 'sqlite'] as const)(
    'SP-8 %s: a term matches the main and extra slots under src/a but not the siblings src/a-b or src/ab', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        await mkdir(join(f.root, 'src/a-b'), { recursive: true });
        await mkdir(join(f.root, 'src/ab'), { recursive: true });
        await writeFile(join(f.root, 'src/a-b/y.ts'), 'export const dash = 1;\n');
        await writeFile(join(f.root, 'src/ab/y.ts'), 'export const ab = 1;\n');
        const main = await write(f, draft({ topic: 'alpha main', anchor: { kind: 'file', path: 'src/a/x.ts' } }));
        const extra = await write(f, draft({ topic: 'alpha extra', anchor: { kind: 'project' },
          extraAnchors: [{ kind: 'file', path: 'src/a/one/x.ts' }] }));
        const dash = await write(f, draft({ topic: 'alpha dash', anchor: { kind: 'file', path: 'src/a-b/y.ts' } }));
        const ab = await write(f, draft({ topic: 'alpha ab', anchor: { kind: 'file', path: 'src/ab/y.ts' } }));
        const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha'],
          match: 'all', pathPrefix: 'src/a', limit: 20, cursor: null });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        expect([...read.value.items.map(item => item.noteId)].sort()).toEqual([main, extra].sort());
        expect(read.value.items.some(item => item.noteId === dash)).toBe(false);
        expect(read.value.items.some(item => item.noteId === ab)).toBe(false);
        expect(read.value.complete).toBe(true);
      } finally { await f.close(); }
    });
});

describe('SP-9 anchor AND path prefix intersect', () => {
  it.each(['memory', 'sqlite'] as const)(
    'SP-9 %s: an anchor outside the prefix gives an empty complete result', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        await write(f, draft({ topic: 'alpha b', anchor: { kind: 'file', path: 'src/b/y.ts' } }));
        const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha'],
          match: 'all', anchor: { kind: 'file', path: 'src/b/y.ts' }, pathPrefix: 'src/a',
          limit: 20, cursor: null });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        expect(read.value.items).toEqual([]);
        expect(read.value.next).toBe(null);
        expect(read.value.complete).toBe(true);
      } finally { await f.close(); }
    });
});

describe('SP-10 term validation with and without an anchor', () => {
  it.each(['memory', 'sqlite'] as const)(
    'SP-10 %s: a U+0085 term is the same invalid reason with and without an anchor', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        const term = 'a\u0085b';
        const anchored = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: [term],
          match: 'any', anchor: { kind: 'project' }, limit: 20, cursor: null });
        const plain = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: [term],
          match: 'any', limit: 20, cursor: null });
        expect(anchored.status).toBe('rejected');
        expect(plain.status).toBe('rejected');
        if (anchored.status !== 'rejected' || plain.status !== 'rejected') return;
        expect(anchored.code).toBe('invalid');
        expect(plain.code).toBe('invalid');
        expect(anchored.reason).toBe('a text search term must not contain whitespace');
        expect(anchored.reason).toBe(plain.reason);
      } finally { await f.close(); }
    });

  it.each(['memory', 'sqlite'] as const)(
    'SP-10 %s: a J+U+030C term is the same invalid reason with and without an anchor', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        // `J + U+030C` is 2 code points after the first pass but composes to
        // U+01F0 (1 code point) on the second pass, so both routes refuse it
        // with the same length reason (S1.10 keeps the double normalization).
        const term = 'J\u030C';
        const anchored = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: [term],
          match: 'any', anchor: { kind: 'project' }, limit: 20, cursor: null });
        const plain = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: [term],
          match: 'any', limit: 20, cursor: null });
        expect(anchored.status).toBe('rejected');
        expect(plain.status).toBe('rejected');
        if (anchored.status !== 'rejected' || plain.status !== 'rejected') return;
        expect(anchored.code).toBe('invalid');
        expect(plain.code).toBe('invalid');
        expect(anchored.reason).toBe('a text search term must be 2 to 64 code points');
        expect(anchored.reason).toBe(plain.reason);
      } finally { await f.close(); }
    });

  it.each(['memory', 'sqlite'] as const)(
    'SP-10 %s: the first error in term order is the reason (term 1 length beats term 2 whitespace)', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        // Term 1 `J + U+030C` is 2 code points after the first pass, but its
        // second pass composes to U+01F0 (1 code point): a length error. Term 2
        // has a whitespace error. Per-term order reports term 1's reason.
        const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find',
          terms: ['J\u030C', 'a\u0085b'], match: 'any', anchor: { kind: 'project' }, limit: 20, cursor: null });
        expect(read.status).toBe('rejected');
        if (read.status !== 'rejected') return;
        expect(read.code).toBe('invalid');
        expect(read.reason).toBe('a text search term must be 2 to 64 code points');
      } finally { await f.close(); }
    });
});

describe('SP-11 ranking uses the first-pass terms with and without an anchor, all and any', () => {
  // One note whose topic holds the first-pass term `j + U+030C + x` and whose
  // body holds the second-pass term U+01F0 + x. Matching is by the second pass,
  // ranking and matchedTerms by the first pass (4B's ranking), so the score is
  // the TOPIC weight (3) times ln 2, not the BODY weight (1) times ln 2.
  it.each(['memory', 'sqlite'] as const)(
    'SP-11 %s: J+U+030C+x gives literal matchedTerms and score with and without an anchor', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        const note = await write(f, draft({ topic: 'J\u030Cx alpha', conclusion: 'plain conclusion',
          body: '\u01F0x body' }));
        const cases: readonly { anchor: boolean; match: 'all' | 'any' }[] = [
          { anchor: false, match: 'all' }, { anchor: false, match: 'any' },
          { anchor: true, match: 'all' }, { anchor: true, match: 'any' },
        ];
        for (const { anchor, match } of cases) {
          const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['J\u030Cx'],
            match, ...(anchor ? { anchor: { kind: 'project' as const } } : {}), limit: 20, cursor: null });
          expect(read.status).toBe('ready');
          if (read.status !== 'ready') return;
          expect(read.value.items.map(item => item.noteId)).toEqual([note]);
          expect(read.value.items.map(item => item.matchedTerms)).toEqual([['j\u030Cx']]);
          expect(read.value.items[0]!.score).toBeCloseTo(3 * Math.LN2, 10);
        }
      } finally { await f.close(); }
    });
});

describe('SP-12 scoped all paging', () => {
  it.each(['memory', 'sqlite'] as const)(
    'SP-12 %s: full pages, the last page complete, the union equals the in-scope matches in refKey order', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        const ids: string[] = [];
        for (let index = 0; index < 5; index += 1) {
          ids.push(await write(f, draft({ topic: `alpha flow ${String(index)}` })));
        }
        // Off-anchor matches must not enter the scoped union.
        await write(f, draft({ topic: 'alpha flow off', anchor: { kind: 'file', path: 'src/a/x.ts' } }));
        const expected = [...ids].sort();
        const pageSizes: number[] = [];
        const seen: string[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 5; page += 1) {
          const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha', 'flow'],
            match: 'all', anchor: { kind: 'project' }, limit: 2, cursor });
          expect(read.status).toBe('ready');
          if (read.status !== 'ready') return;
          const pageIds = read.value.items.map(item => item.noteId);
          // Each page is itself in refKey (noteId) order.
          expect(pageIds).toEqual([...pageIds].sort());
          pageSizes.push(pageIds.length);
          seen.push(...pageIds);
          if (read.value.next === null) {
            expect(read.value.complete).toBe(true);
            break;
          }
          expect(read.value.complete).toBe(false);
          cursor = read.value.next;
        }
        expect(pageSizes).toEqual([2, 2, 1]);
        expect(seen).toEqual(expected);
      } finally { await f.close(); }
    });
});

describe('SP-13 scoped all continuation-key validation', () => {
  it.each(['memory', 'sqlite'] as const)(
    'SP-13 %s: a tampered scoped all cursor is invalid, a canonical missing key is a valid position', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        for (let index = 0; index < 3; index += 1) {
          await write(f, draft({ topic: `alpha cursor ${String(index)}` }));
        }
        const request = { v: 1 as const, op: 'find' as const, terms: ['alpha'], match: 'all' as const,
          anchor: { kind: 'project' as const }, limit: 1, cursor: null as string | null };
        const first = await f.memory.memoryFind(f.ctx(), request);
        expect(first.status).toBe('ready');
        if (first.status !== 'ready' || first.value.next === null) return;
        const parsed = JSON.parse(first.value.next) as Record<string, unknown>;
        for (const bad of ['}', '{"aggregateType":"Widget","id":"x"}', 'not-a-ref']) {
          const cursor = JSON.stringify({ ...parsed, after: bad });
          const read = await f.memory.memoryFind(f.ctx(), { ...request, cursor });
          expect(read.status).toBe('rejected');
          if (read.status !== 'rejected') continue;
          expect(read.code).toBe('invalid');
        }
        // A canonical NoteHead key that names no note still resumes the page.
        const after = parsed['after'] as string;
        const missing = JSON.stringify({ ...JSON.parse(after) as Record<string, unknown>, noteId: 'missing-note' });
        const read = await f.memory.memoryFind(f.ctx(), { ...request, cursor: JSON.stringify({ ...parsed, after: missing }) });
        expect(read.status).toBe('ready');
      } finally { await f.close(); }
    });
});
