/**
 * KLS-2b index-library protocol rows BI1–BI4 (A9): `createKnowledgeIndex` proves its own tables and transactions with
 * the test's own rows (a line key, file rows, anchor keys and texts written here), never the production note format,
 * a platform or a store. BI1–BI3 run on `:memory:` and on a SQLite file the test creates; BI4 closes and reopens a
 * file, so it runs on the file only.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createKnowledgeIndex } from '../../src/core/record-store/sqlite-knowledge-index.js';
import type {
  KnowledgeDerivedRows, KnowledgeFileRow, KnowledgeIndex,
} from '../../src/core/record-store/knowledge-index-ports.js';

const PROJECT = 'kls2b-index-project';
const LINE = '["ws","main"]';

const opened: KnowledgeIndex[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const index of opened.splice(0)) index.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function indexFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'kls2b-index-'));
  directories.push(directory);
  return join(directory, 'index.sqlite');
}

async function openIndex(kind: 'memory' | 'file'): Promise<KnowledgeIndex> {
  const index = createKnowledgeIndex(PROJECT, kind === 'memory' ? null : await indexFile());
  opened.push(index);
  return index;
}

const noteFile = (noteId: string, blobSha: string): KnowledgeFileRow =>
  ({ lineRef: LINE, path: `.workbench/notes/ws/${noteId}.md`, blobSha, kind: 'note' });
const rows = (anchorKeys: string[], text: string): KnowledgeDerivedRows => ({ anchorKeys, text, edges: [] });

describe.each(['memory', 'file'] as const)('the knowledge index (%s)', kind => {
  it('BI1 a transaction whose body throws leaves none of its rows', async () => {
    const index = await openIndex(kind);
    expect(() => index.transaction(tx => {
      tx.setFile(noteFile('n1', 'b1'), '{}');
      tx.setFile(noteFile('n2', 'b2'), '{}');
      throw new Error('BI1 stops the body');
    })).toThrow();
    expect(index.listFiles(LINE)).toEqual([]);
  });

  it('BI2 an anchor prefix read stops at the path boundary', async () => {
    const index = await openIndex(kind);
    index.transaction(tx => {
      tx.replaceNoteRows(LINE, 'n1', rows(['file:src/a/x.ts'], 'x'));
      tx.replaceNoteRows(LINE, 'n2', rows(['file:src/ab.ts'], 'y'));
      tx.replaceNoteRows(LINE, 'n3', rows(['file:src/a/y/z.ts'], 'z'));
    });
    expect([...index.noteIdsByAnchorPrefix(LINE, 'file:src/a/')].sort()).toEqual(['n1', 'n3']);
  });

  it('BI3 the text search pages by note id, the next page starting after the last one', async () => {
    const index = await openIndex(kind);
    index.transaction(tx => {
      tx.replaceNoteRows(LINE, 'n1', rows([], 'quiet one'));
      tx.replaceNoteRows(LINE, 'n2', rows([], 'quiet two'));
      tx.replaceNoteRows(LINE, 'n3', rows([], 'quiet three'));
    });
    const quietPage = (after: string | null) =>
      index.searchText({ lineRefs: [LINE], terms: ['quiet'], match: 'all', after, limit: 2 });
    const first = quietPage(null);
    expect(first.hits).toEqual([{ lineRef: LINE, noteId: 'n1' }, { lineRef: LINE, noteId: 'n2' }]);
    expect(first.next).toBe('n2');
    const second = quietPage(first.next);
    expect(second.hits).toEqual([{ lineRef: LINE, noteId: 'n3' }]);
    expect(second.complete).toBe(true);
  });
});

it('BI4 (file only) a closed index file opened again still has its file row and its anchor rows', async () => {
  const path = await indexFile();
  const written = createKnowledgeIndex(PROJECT, path);
  written.transaction(tx => {
    tx.setFile(noteFile('n1', 'b1'), '{"kind":"note"}');
    tx.replaceNoteRows(LINE, 'n1', rows(['module:core'], 't'));
  });
  written.close();
  const reopened = createKnowledgeIndex(PROJECT, path);
  opened.push(reopened);
  expect(reopened.listFiles(LINE)).toEqual([noteFile('n1', 'b1')]);
  expect(reopened.noteIdsByAnchor(LINE, 'module:core')).toEqual(['n1']);
});
