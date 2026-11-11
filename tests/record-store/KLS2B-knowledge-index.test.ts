/**
 * KLS-2b build rows for the knowledge index protocol (kls2b-build.md [2B-01]–[2B-03]): the index is
 * the store's own port, so its rows put and read through `createKnowledgeIndex` itself, on `:memory:`
 * and on a file.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createKnowledgeIndex } from '../../src/core/record-store/sqlite-knowledge-index.js';
import type { KnowledgeIndex } from '../../src/core/record-store/knowledge-index-ports.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function openIndex(storage: 'memory' | 'sqlite'): KnowledgeIndex {
  if (storage === 'memory') return createKnowledgeIndex('p1', null);
  const directory = mkdtempSync(join(tmpdir(), 'kls2b-index-'));
  directories.push(directory);
  return createKnowledgeIndex('p1', join(directory, 'index.sqlite'));
}

describe.each(['memory', 'sqlite'] as const)('KLS2B knowledge index (%s)', storage => {
  it('KI-1 one blob is kept while any file row uses it, and goes with the last one', () => {
    const index = openIndex(storage);
    index.transaction(tx => {
      tx.setFile({ lineRef: 'A', path: '.workbench/modules/x.json', blobSha: 'b1', kind: 'module' }, '{"id":"x"}');
      tx.setFile({ lineRef: 'B', path: '.workbench/modules/x.json', blobSha: 'b1', kind: 'module' }, '{"id":"x"}');
    });
    index.transaction(tx => tx.deleteFile('A', '.workbench/modules/x.json'));
    expect(index.readBlob('b1')).toEqual({ kind: 'module', parsedJson: '{"id":"x"}' });
    index.transaction(tx => tx.setFile({ lineRef: 'B', path: '.workbench/modules/x.json', blobSha: 'b2', kind: 'module' }, '{}'));
    expect(index.readBlob('b1')).toBeNull();
    expect(index.listFiles('B')).toEqual([{ lineRef: 'B', path: '.workbench/modules/x.json', blobSha: 'b2', kind: 'module' }]);
    expect(index.listFiles('A')).toEqual([]);
    index.close();
  });

  it('KI-2 anchor, prefix and edge reads are per line; a replace swaps the whole group', () => {
    const index = openIndex(storage);
    index.transaction(tx => {
      tx.replaceNoteRows('A', 'n2', { anchorKeys: ['file:src/a.ts', 'module:core'], text: 'alpha', edges: [] });
      tx.replaceNoteRows('A', 'n1', { anchorKeys: ['file:src/a/b.ts'], text: 'beta',
        edges: [{ toRef: 'module:core', kind: 'link_from' }] });
      tx.replaceNoteRows('B', 'n3', { anchorKeys: ['module:core'], text: 'gamma', edges: [] });
    });
    expect(index.noteIdsByAnchor('A', 'module:core')).toEqual(['n2']);
    expect(index.noteIdsByAnchorPrefix('A', 'file:src/a')).toEqual(['n1', 'n2']);
    expect(index.noteIdsByEdge('A', 'link_from', ['module:core'])).toEqual(['n1']);
    expect(index.noteIdsByEdge('B', 'link_from', null)).toEqual([]);
    index.transaction(tx => tx.replaceNoteRows('A', 'n2', { anchorKeys: ['module:other'], text: 'alpha', edges: [] }));
    expect(index.noteIdsByAnchor('A', 'module:core')).toEqual([]);
    index.transaction(tx => tx.clearNoteRows('A', 'n1'));
    expect(index.noteIdsByEdge('A', 'link_from', null)).toEqual([]);
    index.close();
  });

  it('KI-3 the text scan covers the given lines, ascending by noteId, after excluded', () => {
    const index = openIndex(storage);
    index.transaction(tx => {
      tx.replaceNoteRows('A', 'n3', { anchorKeys: [], text: 'retry budget', edges: [] });
      tx.replaceNoteRows('B', 'n1', { anchorKeys: [], text: 'retry once', edges: [] });
      tx.replaceNoteRows('B', 'n2', { anchorKeys: [], text: 'no match', edges: [] });
    });
    const first = index.searchText({ lineRefs: ['A', 'B'], terms: ['retry'], match: 'all', after: null, limit: 1 });
    expect(first).toEqual({ hits: [{ lineRef: 'B', noteId: 'n1' }], next: 'n1', complete: false });
    expect(index.searchText({ lineRefs: ['A', 'B'], terms: ['retry'], match: 'all', after: 'n1', limit: 1 }))
      .toEqual({ hits: [{ lineRef: 'A', noteId: 'n3' }], next: null, complete: true });
    expect(index.searchText({ lineRefs: ['A'], terms: ['once'], match: 'any', after: null, limit: 5 }).hits).toEqual([]);
    index.close();
  });

  it('KI-4 a throw rolls the whole transaction back; the note state row is per (line, blob)', () => {
    const index = openIndex(storage);
    expect(() => index.transaction(tx => {
      tx.setNoteState('A', 'b1', { verifyState: 'needs_verification', verifyReason: 'external_edit' });
      throw new Error('boom');
    })).toThrow('boom');
    expect(index.readNoteState('A', 'b1')).toBeNull();
    index.transaction(tx => tx.setNoteState('A', 'b1', { verifyState: 'needs_verification', verifyReason: 'merged' }));
    expect(index.readNoteState('A', 'b1')).toEqual({ verifyState: 'needs_verification', verifyReason: 'merged' });
    expect(index.readNoteState('B', 'b1')).toBeNull();
    index.transaction(tx => tx.setNoteState('A', 'b1', null));
    expect(index.readNoteState('A', 'b1')).toBeNull();
    index.close();
  });

  it('KI-6 the notes with an edge of one kind on a line, to the given ends or to any', () => {
    const index = openIndex(storage);
    const linkFrom = [{ toRef: 'module:core', kind: 'link_from' as const }];
    index.transaction(tx => {
      tx.replaceNoteRows('A', 'l2', { anchorKeys: ['module:core'], text: 'l', edges: linkFrom });
      tx.replaceNoteRows('A', 'l1', { anchorKeys: ['module:core'], text: 'l', edges: linkFrom });
      tx.replaceNoteRows('A', 'f1', { anchorKeys: ['module:core'], text: 'f',
        edges: [{ toRef: 'l1', kind: 'flow_step' }, { toRef: 'l2', kind: 'flow_step' }] });
      tx.replaceNoteRows('B', 'f2', { anchorKeys: ['module:core'], text: 'f', edges: [{ toRef: 'l2', kind: 'flow_step' }] });
    });
    expect(index.noteIdsByEdge('A', 'link_from', null)).toEqual(['l1', 'l2']);
    expect(index.noteIdsByEdge('A', 'flow_step', ['l2'])).toEqual(['f1']);
    expect(index.noteIdsByEdge('A', 'flow_step', [])).toEqual([]);
    index.close();
  });
});

it('KI-5 an index file that cannot be opened throws with its path (the reads answer unavailable with it)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kls2b-index-'));
  directories.push(directory);
  const path = join(directory, 'gone', 'index.sqlite');
  expect(() => createKnowledgeIndex('p1', path)).toThrow(path);
});
