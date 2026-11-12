/**
 * KLS-2c-1b1, the knowledge snapshots' recovery rows ([2C1-22], A9 protocol file; KS1, KS2 are the test writer's):
 * a notice's recovery row is written once and a second write under the same (notice, item) keeps the first (errata
 * 2c1#8, G9); and a copy a recovery item points at outlives the key's 20-copy cap ([2C1-18]). Both backends: the rows
 * are the store's own.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { KnowledgeRecoveryRow } from '../../src/core/record-store/knowledge-snapshot-ports.js';
import { openKnowledgeSnapshots } from '../../src/core/record-store/sqlite-knowledge-snapshots.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const backends = [
  ['memory', () => openKnowledgeSnapshots(null)],
  ['file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kls2c1b1-snap-'));
    dirs.push(dir);
    return openKnowledgeSnapshots(join(dir, 'knowledge-snapshots.sqlite'));
  }],
] as const;

const LINE = '["ws","main"]';
const PATH = '.workbench/notes/ws/aaaa.md';
const row = (itemNo: number, change: Partial<KnowledgeRecoveryRow> = {}): KnowledgeRecoveryRow => ({
  noticeId: 'n1', itemNo, kind: 'write_unconfirmed', writeId: `w${itemNo}`, lineRef: LINE, path: `${PATH}.${itemNo}`,
  takenAt: null, expectedBlob: null, ...change });
const stamp = (second: number): string => `2026-11-12T00:00:${String(second).padStart(2, '0')}.000Z`;

describe.each(backends)('knowledge recovery rows (%s)', (_name, open) => {
  it('a row is written once by (notice, item), read by item, found by write, and gone once recovered', () => {
    const snapshots = open();
    try {
      snapshots.recordRecovery([row(2), row(1)]);
      snapshots.recordRecovery([row(1, { writeId: 'w9', expectedBlob: 'b9' })]);
      expect(snapshots.readRecovery('n1')).toEqual([row(1), row(2)]);
      expect([snapshots.hasRecoveryForWrite('w1'), snapshots.hasRecoveryForWrite('w9')]).toEqual([true, false]);
      snapshots.deleteRecovery('n1', 1);
      expect(snapshots.readRecovery('n1')).toEqual([row(2)]);
      expect(snapshots.hasRecoveryForWrite('w1')).toBe(false);
    } finally { snapshots.close(); }
  });

  it('a copy a recovery item points at outlives the 20-copy cap', () => {
    const snapshots = open();
    try {
      snapshots.put(LINE, PATH, stamp(0), Buffer.from('v0'));
      snapshots.recordRecovery([row(1, { kind: 'reverted', writeId: null, path: PATH, takenAt: stamp(0) })]);
      for (let version = 1; version <= 21; version += 1) snapshots.put(LINE, PATH, stamp(version), Buffer.from(`v${version}`));
      const kept = snapshots.listRefs(LINE, PATH).map(ref => [ref.takenAt, Buffer.from(ref.content).toString()]);
      expect(kept).toEqual([[stamp(0), 'v0'], ...Array.from({ length: 20 }, (_, i) => [stamp(i + 2), `v${i + 2}`])]);
    } finally { snapshots.close(); }
  });
});
