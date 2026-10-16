/**
 * Slice 4B G3 — T-07 (`'any'` ranking, hand-computed in spec §5.2) and T-09
 * (partial ranking when the match set exceeds the read model's candidate cap).
 * Notes come from the real 4A writer; assertions go through the real
 * `memoryFind`. The expected scores are the spec's literals.
 */
import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'rank', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function write(f: Awaited<ReturnType<typeof createS4BNoteCheckFixture>>, note: NoteDraftV1): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, null);
  if (result.status === 'rejected') throw new Error(JSON.stringify(result));
  return result.noteId;
}

describe('S4B T-07 any ranking', () => {
  it.each(['memory', 'sqlite'] as const)('T-07 %s: the three notes score 3.9120, 2.3026, 0.6931 and order n1, n2, n3', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const n1 = await write(f, draft({ topic: 'alpha topic', conclusion: 'beta conclusion', body: 'plain' }));
      const n2 = await write(f, draft({ topic: 'neutral two', conclusion: 'alpha conclusion', body: 'beta body' }));
      const n3 = await write(f, draft({ topic: 'neutral three', conclusion: 'plain conclusion', body: 'alpha body' }));

      const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha', 'beta'],
        match: 'any', limit: 20, cursor: null });
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
    } finally { await f.close(); }
  });
});

describe('S4B R7 all-match results carry no ranking', () => {
  it.each(['memory', 'sqlite'] as const)('R7 %s: an explicitly empty term list is invalid', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      await write(f, draft({ topic: 'alpha topic' }));
      const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: [], match: 'any',
        limit: 20, cursor: null });
      expect(read.status).toBe('rejected');
      if (read.status !== 'rejected') return;
      expect(read.code).toBe('invalid');
      expect(read.reason).toBe('terms must be 1–8');
    } finally { await f.close(); }
  });
});

describe('S4B MF7a all-match paging', () => {
  it.each(['memory', 'sqlite'] as const)('MF7a %s: all matching notes come back in byte order with the full ln-2 score, despite a small read-model cap', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { textSearchCandidateMax: 2 });
    try {
      const ids = [
        await write(f, draft({ topic: 'alpha flow one' })),
        await write(f, draft({ topic: 'alpha flow two' })),
        await write(f, draft({ topic: 'alpha flow three' })),
      ];
      await write(f, draft({ topic: 'alpha only' }));
      const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha', 'flow'],
        match: 'all', limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items.map(item => item.noteId)).toEqual([...ids].sort());
      expect(read.value.ranking).toBeUndefined();
      expect(read.value.complete).toBe(true);
      expect(read.value.warnings).toEqual([]);
      for (const item of read.value.items) {
        expect(item.matchedTerms).toEqual(['alpha', 'flow']);
        expect(item.score).toBeCloseTo(6 * Math.LN2, 6);
      }
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF7a %s: limit 1 pages the three all-matches and the last page completes', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { textSearchCandidateMax: 2 });
    try {
      const ids = [
        await write(f, draft({ topic: 'alpha flow one' })),
        await write(f, draft({ topic: 'alpha flow two' })),
        await write(f, draft({ topic: 'alpha flow three' })),
      ];
      const expected = [...ids].sort();
      const request = { v: 1 as const, op: 'find' as const, terms: ['alpha', 'flow'],
        match: 'all' as const, limit: 1, cursor: null as string | null };
      const first = await f.memory.memoryFind(f.ctx(), request);
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(first.value.items.map(item => item.noteId)).toEqual([expected[0]]);
      expect(first.value.complete).toBe(false);
      const second = await f.memory.memoryFind(f.ctx(), { ...request, cursor: first.value.next });
      expect(second.status).toBe('ready');
      if (second.status !== 'ready') return;
      expect(second.value.items.map(item => item.noteId)).toEqual([expected[1]]);
      expect(second.value.complete).toBe(false);
      const third = await f.memory.memoryFind(f.ctx(), { ...request, cursor: second.value.next });
      expect(third.status).toBe('ready');
      if (third.status !== 'ready') return;
      expect(third.value.items.map(item => item.noteId)).toEqual([expected[2]]);
      expect(third.value.next).toBe(null);
      expect(third.value.complete).toBe(true);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF7a %s: an all-match page trimmed by the byte bound resumes from the port refKey', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { resultMaxBytes: 5000 });
    try {
      const ids: string[] = [];
      for (let k = 0; k < 6; k += 1) {
        const paths: string[] = [];
        for (let j = 0; j < 4; j += 1) {
          const path = `src/a/t${String(k)}-${'z'.repeat(200)}-${String(j)}.ts`;
          await writeFile(join(f.root, path), `export const t${String(k)}_${String(j)} = 1;\n`);
          paths.push(path);
        }
        ids.push(await write(f, draft({ topic: `alpha flow ${String(k)}`, basisFiles: paths })));
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha', 'flow'],
          match: 'all', limit: 100, cursor });
        expect(page.status).toBe('ready');
        if (page.status !== 'ready') return;
        expect(Buffer.byteLength(JSON.stringify(page.value), 'utf8')).toBeLessThanOrEqual(5000);
        seen.push(...page.value.items.map(item => item.noteId));
        if (page.value.next !== null) expect(page.value.complete).toBe(false);
        cursor = page.value.next;
        pages += 1;
        // A noteId-based `'all'` cursor would restart the port and loop forever.
        expect(pages).toBeLessThan(20);
      } while (cursor !== null);
      expect(new Set(seen).size).toBe(ids.length);
      expect([...seen].sort()).toEqual([...ids].sort());
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF7a %s: a filtered record inside a port page does not drop later matches', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      // Half the matching records are out of scope, so with `limit:2` the
      // collected count reaches the limit mid-port-page for some page (the
      // refKey order is by noteId, so the exact positions vary).
      const pitfallIds: string[] = [];
      for (let k = 0; k < 12; k += 1) {
        pitfallIds.push(await write(f, draft({ kind: 'pitfall', topic: `alpha p${String(k)}` })));
        await write(f, draft({ kind: 'decision', topic: `alpha d${String(k)}` }));
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha'],
          match: 'all', kind: 'pitfall', limit: 2, cursor });
        expect(page.status).toBe('ready');
        if (page.status !== 'ready') return;
        expect(page.value.items.every(item => item.kind === 'pitfall')).toBe(true);
        expect(page.value.complete).toBe(page.value.next === null);
        seen.push(...page.value.items.map(item => item.noteId));
        cursor = page.value.next;
        pages += 1;
        expect(pages).toBeLessThan(40);
      } while (cursor !== null);
      expect(new Set(seen).size).toBe(pitfallIds.length);
      expect([...seen].sort()).toEqual([...pitfallIds].sort());
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)(
    'R7 %s: an all page is one port call, so a fully filtered first port page still returns its cursor', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        // All four matches are out of scope for the requested kind. One port
        // page holds the first two; the memory page must not keep scanning
        // later port pages to refill `limit`.
        for (let k = 0; k < 4; k += 1) {
          await write(f, draft({ kind: 'decision', topic: `alpha ${String(k)}` }));
        }
        const first = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha'],
          match: 'all', kind: 'pitfall', limit: 2, cursor: null });
        expect(first.status).toBe('ready');
        if (first.status !== 'ready') return;
        expect(first.value.items).toEqual([]);
        expect(first.value.complete).toBe(false);
        expect(first.value.next).not.toBe(null);
      } finally { await f.close(); }
    });
});

describe('S4B T-09 partial ranking', () => {
  it.each(['memory', 'sqlite'] as const)('T-09 %s: a match set over the injected candidate cap returns the first two sorted ids as partial', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { textSearchCandidateMax: 2 });
    try {
      const ids = [
        await write(f, draft({ topic: 'alpha one' })),
        await write(f, draft({ topic: 'alpha two' })),
        await write(f, draft({ topic: 'alpha three' })),
      ];
      const expected = [...ids].sort().slice(0, 2);
      const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha'], match: 'any',
        limit: 20, cursor: null });
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

  it.each(['memory', 'sqlite'] as const)('T-09 %s: limit 1 paging keeps the partial ranking and returns the second id on page 2', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { textSearchCandidateMax: 2 });
    try {
      const ids = [
        await write(f, draft({ topic: 'alpha one' })),
        await write(f, draft({ topic: 'alpha two' })),
        await write(f, draft({ topic: 'alpha three' })),
      ];
      const expected = [...ids].sort();
      const request = { v: 1 as const, op: 'find' as const, terms: ['alpha'], match: 'any' as const,
        limit: 1, cursor: null as string | null };
      const first = await f.memory.memoryFind(f.ctx(), request);
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(first.value.items.map(item => item.noteId)).toEqual([expected[0]]);
      expect(first.value.ranking).toBe('partial');
      expect(first.value.complete).toBe(false);
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
