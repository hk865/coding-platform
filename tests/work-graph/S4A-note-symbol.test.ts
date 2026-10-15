/**
 * Slice 4A NE1 writer half of G-01: write-side `symbolRequest` resolution
 * (item 14 / spec §0.1, L11, L14, §4 rule 14, §6 4A line, §7 G-01 exception).
 *
 * Both backends, real workspace tools on the temp workspace: the TypeScript
 * provider is captured and queried for real; no provider is doubled. The
 * literal hex digests below are sha256 of the exact literal file text (and of
 * the folded hit-range text), computed by hand with node:crypto in
 * `./.dsh-scratch/digests.mjs`, never through product code.
 *
 * Probe fact (this repo, typescript 6.0.3, real provider): a `SourceHit`'s
 * `location` is the symbol NAME span, not the whole declaration
 * (`typescript-source-query.ts` uses `item.nameSpan ?? item.spans[0]`). So an
 * `alpha` function declared on lines 1–3 yields the range `{startLine:1,
 * endLine:1}`; item 14's prose "lines 1–3" is the declaration extent. The
 * frozen port exposes no declaration span, so the locator stores the hit range
 * exactly as L14 says.
 */
import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NoteDraftAnchorV1, NoteDraftV1, SymbolRequestV1 } from '../../src/contracts/note.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];

const SYM_CONTENT = [
  'export function alpha() {',
  '  return 1;',
  '}',
  '',
  'export class First {',
  '  run(): void {}',
  '}',
  '',
  'export class Second {',
  '  run(): void {}',
  '}',
  '',
].join('\n');
const SYM_DIGEST = 'b81b9b8f91a7d850a6169b17c85672d00d4e2b4ff015dc06de0b1164f416023e';
const ALPHA_SIG = '8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8';
const RUN_SIG = 'acba25512100f80b56fc3ccd14c65be55d94800cda77585c5f41a887e398f9be';

const pad2 = (value: number): string => String(value).padStart(2, '0');
/** 60 functions f01..f60, four lines per block: function i starts at line (i-1)*4+1. */
const PAGED_CONTENT = Array.from({ length: 60 }, (_, index) => {
  const number = index + 1;
  return [`export function f${pad2(number)}() {`, `  return ${number};`, '}', ''];
}).flat().join('\n');
const PAGED_DIGEST = 'af9f4f3ec64968e0d2794cecf86d66a80d93358a3d3efc46295ccd52687fe3c4';
const F55_SIG = 'c4e043842448b9c10545394fcbfcd2054c6db96ddb8cb50f7345b75416d36dde';

const THREE_CONTENT = [
  'export function f01() {',
  '  return 1;',
  '}',
  '',
  'export function f02() {',
  '  return 2;',
  '}',
  '',
  'export function f03() {',
  '  return 3;',
  '}',
  '',
].join('\n');

function general(anchor: NoteDraftAnchorV1, overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'pitfall', topic: 'symbol topic', conclusion: 'symbol conclusion', anchor, extraAnchors: [],
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
    body: 'body', ...overrides,
  } as NoteDraftV1;
}

function symAnchor(path: string, symbolRequest: SymbolRequestV1): NoteDraftAnchorV1 {
  return { kind: 'file', path, symbolRequest };
}

async function withFixture<T>(kind: S4ANoteFixtureKind,
  options: { anchorQuota?: number; goalQuota?: number; symbolHitsMax?: number } = {},
  body: (fixture: S4ANoteFixture) => Promise<T>): Promise<T> {
  const fixture = await createS4ANoteFixture(kind, options);
  try { return await body(fixture); } finally { await fixture.close(); }
}

const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;
const warningsOf = (result: unknown): string[] => (result as { warnings: string[] }).warnings;

async function readAnchor(f: S4ANoteFixture, ctx: ReturnType<S4ANoteFixture['ctx']>, result: unknown): Promise<unknown> {
  const read = await f.platform.notes.readNote(ctx, { noteId: idOf(result as { status: string }) });
  if (read.status !== 'ready') throw new Error(`the note is not readable: ${JSON.stringify(read)}`);
  return read.value.anchor;
}

describe('S4A G-01(4A) write-side symbolRequest resolution', () => {
  it.each(KINDS)('G-01(4A) %s a unique symbol is stored as a locator', async kind => {
    await withFixture(kind, {}, async f => {
      await writeFile(join(f.root, 'src/sym.ts'), SYM_CONTENT);
      const ctx = f.ctx();
      const result = await f.write(ctx,
        general(symAnchor('src/sym.ts', { language: 'typescript', name: 'alpha' })), null);
      expect(result.status).toBe('accepted');
      expect(warningsOf(result)).toEqual([]);
      expect(await readAnchor(f, ctx, result)).toEqual({
        kind: 'file', path: 'src/sym.ts',
        symbol: { language: 'typescript', qualifiedName: 'alpha', range: { startLine: 1, endLine: 1 },
          fileDigest: SYM_DIGEST, signatureDigest: ALPHA_SIG },
      });
    });
  });

  it.each(KINDS)('G-01(4A) %s two same-name symbols are refused symbol_ambiguous with ordered candidates', async kind => {
    await withFixture(kind, {}, async f => {
      await writeFile(join(f.root, 'src/sym.ts'), SYM_CONTENT);
      const ctx = f.ctx();
      const result = await f.write(ctx,
        general(symAnchor('src/sym.ts', { language: 'typescript', name: 'run' })), null);
      expect(result).toMatchObject({
        status: 'rejected', code: 'invalid', reason: 'symbol_ambiguous',
        symbolCandidates: [
          { name: 'run', range: { startLine: 6, endLine: 6 } },
          { name: 'run', range: { startLine: 10, endLine: 10 } },
        ],
      });
      const echoed = (result as unknown as { draft: { note: { anchor: NoteDraftAnchorV1 } } }).draft.note.anchor;
      expect(echoed).toEqual({ kind: 'file', path: 'src/sym.ts',
        symbolRequest: { language: 'typescript', name: 'run' } });
      const page = await f.platform.notes.listByAnchor(ctx,
        { anchor: { kind: 'file', path: 'src/sym.ts' }, limit: 100, cursor: null });
      if (page.status !== 'ready') throw new Error('unreachable');
      expect(page.value.items).toEqual([]);
    });
  });

  it.each(KINDS)('G-01(4A) %s a range disambiguates the same-name symbols', async kind => {
    await withFixture(kind, {}, async f => {
      await writeFile(join(f.root, 'src/sym.ts'), SYM_CONTENT);
      const ctx = f.ctx();
      const result = await f.write(ctx, general(symAnchor('src/sym.ts',
        { language: 'typescript', name: 'run', range: { startLine: 10, endLine: 10 } })), null);
      expect(result.status).toBe('accepted');
      expect(await readAnchor(f, ctx, result)).toEqual({
        kind: 'file', path: 'src/sym.ts',
        symbol: { language: 'typescript', qualifiedName: 'run', range: { startLine: 10, endLine: 10 },
          fileDigest: SYM_DIGEST, signatureDigest: RUN_SIG },
      });
    });
  });

  it.each(KINDS)('G-01(4A) %s an unmatched name keeps the file anchor with the success warning', async kind => {
    await withFixture(kind, {}, async f => {
      await writeFile(join(f.root, 'src/sym.ts'), SYM_CONTENT);
      const ctx = f.ctx();
      const result = await f.write(ctx,
        general(symAnchor('src/sym.ts', { language: 'typescript', name: 'nope' })), null);
      expect(result.status).toBe('accepted');
      expect(warningsOf(result)).toEqual(['symbol_unresolved']);
      expect(await readAnchor(f, ctx, result)).toEqual({ kind: 'file', path: 'src/sym.ts' });
    });
  });

  it.each(KINDS)('G-01(4A) %s an unsupported language is a success warning, not an error', async kind => {
    await withFixture(kind, {}, async f => {
      await writeFile(join(f.root, 'src/sym.ts'), SYM_CONTENT);
      const ctx = f.ctx();
      const result = await f.write(ctx,
        general(symAnchor('src/sym.ts', { language: 'cobol', name: 'alpha' })), null);
      expect(result.status).toBe('accepted');
      expect(warningsOf(result)).toEqual(['symbol_unresolved']);
      expect(await readAnchor(f, ctx, result)).toEqual({ kind: 'file', path: 'src/sym.ts' });
    });
  });

  it.each(KINDS)('G-01(4A) %s the symbol scan follows cursors across pages', async kind => {
    await withFixture(kind, {}, async f => {
      await writeFile(join(f.root, 'src/paged.ts'), PAGED_CONTENT);
      const ctx = f.ctx();
      const result = await f.write(ctx,
        general(symAnchor('src/paged.ts', { language: 'typescript', name: 'f55' })), null);
      expect(result.status).toBe('accepted');
      expect(await readAnchor(f, ctx, result)).toEqual({
        kind: 'file', path: 'src/paged.ts',
        symbol: { language: 'typescript', qualifiedName: 'f55', range: { startLine: 217, endLine: 217 },
          fileDigest: PAGED_DIGEST, signatureDigest: F55_SIG },
      });
    });
  });

  it.each(KINDS)('G-01(4A) %s hitting the hits cap never stores a locator', async kind => {
    await withFixture(kind, { symbolHitsMax: 2 }, async f => {
      await writeFile(join(f.root, 'src/three.ts'), THREE_CONTENT);
      const ctx = f.ctx();
      const result = await f.write(ctx,
        general(symAnchor('src/three.ts', { language: 'typescript', name: 'f03' })), null);
      expect(result.status).toBe('accepted');
      expect(warningsOf(result)).toEqual(['symbol_unresolved']);
      expect(await readAnchor(f, ctx, result)).toEqual({ kind: 'file', path: 'src/three.ts' });
    });
  });

  it.each(KINDS)('G-01(4A) %s a malformed symbolRequest is refused invalid with the draft', async kind => {
    await withFixture(kind, {}, async f => {
      // The file exists, so only the symbolRequest shape can refuse the write.
      await writeFile(join(f.root, 'src/sym.ts'), SYM_CONTENT);
      const ctx = f.ctx();
      const result = await f.write(ctx, general(symAnchor('src/sym.ts',
        { language: 'typescript', name: 'alpha', range: { startLine: 0, endLine: 1 } })), null);
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      const echoed = (result as unknown as { draft: { note: { anchor: NoteDraftAnchorV1 } } }).draft.note.anchor;
      expect(echoed).toMatchObject({ kind: 'file', path: 'src/sym.ts',
        symbolRequest: { range: { startLine: 0, endLine: 1 } } });
    });
  });
});
