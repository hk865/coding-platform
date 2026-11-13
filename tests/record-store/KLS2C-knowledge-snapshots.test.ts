/**
 * KLS-2c-1 knowledge snapshot store protocol (A9; KS1, KS2; [2C1-18], [2C1-22]). The store is the library the
 * reconcile keeps a line's file versions in and the recovery items in; these rows prove its own protocol through its
 * exported port, with the test's own line, paths and contents: the same content is not kept twice in a row, a key
 * keeps its newest 20, and a snapshot a recovery item names is not pruned when the file is committed. On the
 * in-memory database and on a file.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { KnowledgeSnapshots } from '../../src/core/record-store/knowledge-snapshot-ports.js';
import { openKnowledgeSnapshots } from '../../src/core/record-store/sqlite-knowledge-snapshots.js';

const LINE = '["kls2c-ws",""]';
const MODULE_A = '.workbench/modules/a.json';
const MODULE_B = '.workbench/modules/b.json';
const takenAt = (second: number): string => `2026-11-12T00:00:${String(second).padStart(2, '0')}.000Z`;
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const BACKENDS: [string, () => KnowledgeSnapshots][] = [
  [':memory:', () => openKnowledgeSnapshots(null)],
  ['file', () => {
    const folder = mkdtempSync(join(tmpdir(), 'kls2c-snapshots-'));
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
    return openKnowledgeSnapshots(join(folder, 'knowledge-snapshots.sqlite'));
  }],
];

describe.each(BACKENDS)('%s', (_, open) => {
  function opened(): KnowledgeSnapshots {
    const store = open();
    cleanups.push(() => store.close());
    return store;
  }

  it('KS1 the same content twice in a row is kept once, and a key keeps only its newest 20', () => {
    const store = opened();
    store.put(LINE, MODULE_A, takenAt(1), utf8('same'));
    store.put(LINE, MODULE_A, takenAt(2), utf8('same'));
    expect(store.listRefs(LINE, MODULE_A).map(ref => ref.takenAt)).toEqual([takenAt(1)]);

    for (let n = 1; n <= 22; n += 1) store.put(LINE, MODULE_B, takenAt(n), utf8(`v${n}`));
    const kept = store.listRefs(LINE, MODULE_B);
    expect(kept.map(ref => ref.takenAt)).toEqual(Array.from({ length: 20 }, (__, i) => takenAt(i + 3)));
    expect(kept.map(ref => new TextDecoder().decode(ref.content))).toEqual(Array.from({ length: 20 }, (__, i) => `v${i + 3}`));
  });

  // U5 (KC-2, 计划 :136、:162): a snapshot either kind of recovery item names survives the prune; today the `unreadable`
  // entry is red at the second `listRefs` (REFERENCED only knows `reverted`, so `deletePath` drops it).
  it.each(['reverted', 'unreadable'] as const)('KS2 a snapshot a recovery item names survives the committed-file prune, '
    + 'and goes once the item is gone: %s', kind => {
    const store = opened();
    store.put(LINE, MODULE_A, takenAt(5), utf8('w'));
    store.recordRecovery([{ noticeId: 'kls2c-ks2', itemNo: 1, kind, writeId: null, lineRef: LINE,
      path: MODULE_A, takenAt: takenAt(5), expectedBlob: null }]);
    store.deletePath(LINE, MODULE_A);
    expect(store.listRefs(LINE, MODULE_A).map(ref => ref.takenAt)).toEqual([takenAt(5)]);

    store.deleteRecovery('kls2c-ks2', 1);
    store.deletePath(LINE, MODULE_A);
    expect(store.listRefs(LINE, MODULE_A)).toEqual([]);
  });
});
