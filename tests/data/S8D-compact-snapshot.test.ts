/**
 * Slice 8D compact module snapshot (§10 item 2, §11.2 "模块快照的没解析").
 *
 * The seams are the public `mapArchitectureSource` mapper and the shared
 * Contracts helper `compactUnresolvedLines`. Every input here is constructed;
 * the expected values are hand-computed from the spec caps (500 lines and
 * 64 KiB of the kept lines joined by a newline, summary line excluded).
 */
import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_UNRESOLVED_MAX_BYTES, SNAPSHOT_UNRESOLVED_MAX_LINES, compactUnresolvedLines,
} from '../../src/contracts/architecture-source.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import {
  mapArchitectureSource, type ArchitectureSourceMaterial,
} from '../../src/core/workspace/architecture-source.js';

const SUMMARY = (removed: number): string => '另有 ' + removed + ' 条没列出，逐条见文件层';

/** A ~57-character path so the snapshot-with-`indexedSources` input is large. */
const sourcePath = (index: number): string =>
  'src/pkg-' + String(index).padStart(4, '0') + '/nested-directory-name-for-scale/file-'
  + String(index).padStart(4, '0') + '.ts';

function largeMaterial(): ArchitectureSourceMaterial {
  const sources = Array.from({ length: 1_500 }, (_, index) => ({
    path: sourcePath(index), digest: sha256Hex('source-' + index),
  }));
  const imports = Array.from({ length: 2_000 }, (_, index) => ({
    path: sourcePath(index % sources.length),
    digest: sha256Hex('import-' + index),
    line: index + 1,
    module: './missing-' + String(index).padStart(4, '0'),
    resolution: 'unresolved',
    targets: [],
  }));
  return {
    sources, imports, manifestDigest: sha256Hex('manifest'), commit: null,
    engine: 'typescript', engineVersion: '6.0.3', configPath: null,
  };
}

describe('S8D mapArchitectureSource returns a compact snapshot (§10 item 2)', () => {
  it('omits indexedSources, stays under 240 KiB and cuts unresolved at 500 lines plus the summary', () => {
    const material = largeMaterial();
    const snapshot = mapArchitectureSource(material,
      { projectId: 'p', workspaceId: 'w', workspaceRevision: 1 },
      [{ id: 'All', kind: 'module', paths: ['.'] }], 'observation');

    expect('indexedSources' in snapshot).toBe(false);
    expect(snapshot.nodes).toHaveLength(1);
    const expectedMembers = material.sources.map(source => ({ path: source.path, digest: source.digest }));
    const expectedDigest = sha256Hex(canonicalJson(expectedMembers as unknown as JsonValue));
    for (const node of snapshot.nodes) expect(node.contentDigest).toBe(expectedDigest);

    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeLessThanOrEqual(240 * 1024);

    // The mapper's own unresolved wording is the independent expected source here.
    const expectedLines = [...new Set(material.imports.map(relation =>
      'unresolved import: ' + relation.path + ':' + relation.line + ' -> ' + relation.module))].sort();
    expect(expectedLines).toHaveLength(2_000);
    expect(snapshot.unresolved).toHaveLength(SNAPSHOT_UNRESOLVED_MAX_LINES + 1);
    expect(snapshot.unresolved.slice(0, SNAPSHOT_UNRESOLVED_MAX_LINES))
      .toEqual(expectedLines.slice(0, SNAPSHOT_UNRESOLVED_MAX_LINES));
    expect(snapshot.unresolved[SNAPSHOT_UNRESOLVED_MAX_LINES])
      .toBe(SUMMARY(expectedLines.length - SNAPSHOT_UNRESOLVED_MAX_LINES));
  });
});

describe('S8D compactUnresolvedLines caps (§11.2)', () => {
  it('deduplicates and sorts without appending a summary when nothing is cut', () => {
    expect(compactUnresolvedLines(['b', 'a', 'a', 'c'])).toEqual(['a', 'b', 'c']);
    expect(compactUnresolvedLines([])).toEqual([]);
  });

  it('keeps the first 500 sorted lines and reports the exact number of removed lines', () => {
    const lines = Array.from({ length: 502 }, (_, index) => 'line ' + String(index).padStart(3, '0'));
    const compact = compactUnresolvedLines(lines);
    expect(compact).toHaveLength(SNAPSHOT_UNRESOLVED_MAX_LINES + 1);
    expect(compact.slice(0, SNAPSHOT_UNRESOLVED_MAX_LINES)).toEqual(lines.slice(0, SNAPSHOT_UNRESOLVED_MAX_LINES));
    expect(compact[SNAPSHOT_UNRESOLVED_MAX_LINES]).toBe(SUMMARY(2));
  });

  it('cuts at 64 KiB of the kept lines and does not count the summary line against that cap', () => {
    // 400 unique 200-character lines: k kept lines joined by '\n' are 201*k - 1
    // bytes, so k = 326 is 65,525 bytes and 74 lines are removed.
    const lines = Array.from({ length: 400 }, (_, index) => String(index).padStart(4, '0') + 'x'.repeat(196));
    const compact = compactUnresolvedLines(lines);
    expect(compact).toHaveLength(327);
    expect(compact.slice(0, 326)).toEqual(lines.slice(0, 326));
    const keptBytes = Buffer.byteLength(compact.slice(0, 326).join('\n'), 'utf8');
    expect(keptBytes).toBe(65_525);
    expect(keptBytes).toBeLessThanOrEqual(SNAPSHOT_UNRESOLVED_MAX_BYTES);
    expect(Buffer.byteLength(compact.join('\n'), 'utf8')).toBeGreaterThan(SNAPSHOT_UNRESOLVED_MAX_BYTES);
    expect(compact[326]).toBe(SUMMARY(74));
  });
});
