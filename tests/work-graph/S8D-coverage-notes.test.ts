/**
 * Slice 8D rework spec §11.5: `LanguageCoverageV1` gains `notes`.
 *
 * The exported ObservedArchitecture codec is the seam: a record with a valid
 * notes list keeps it, and a malformed list (missing, more than 10 entries, a
 * 201-character string, a non-string) is rejected like any other malformed
 * coverage. The codec does not sort or truncate; the capture owner normalizes
 * before writing.
 */
import { describe, expect, it } from 'vitest';
import type { LanguageCoverageV1 } from '../../src/contracts/architecture-inspection.js';
import type { ObservedArchitectureRecord } from '../../src/core/work-graph/architecture/contracts.js';
import {
  decodeObservedArchitectureRecord, encodeObservedArchitecture,
} from '../../src/core/work-graph/architecture/architecture-record-codecs.js';
import { normalizeCoverageNotes } from '../../src/core/workspace/capture.js';

const hex = (character: string) => character.repeat(64);

const coverage = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  language: 'typescript', files: 1, parsed: 1, edges: 'supported', reason: null,
  notes: [], issues: [], issueCount: 0, complete: true, ...overrides,
});

const record = (entry: Record<string, unknown>): ObservedArchitectureRecord => ({
  ref: { aggregateType: 'ObservedArchitecture', projectId: 'p1', workspaceId: 'main', captureId: 'c1' },
  revision: 1,
  schemaVersion: 1,
  source: {
    capture: { projectId: 'p1', workspaceId: 'main', captureId: 'c1', workspaceRevision: 1,
      sourceDigest: hex('a'), configDigest: hex('b'), indexVersion: 'typescript-language-service@6.0.3' },
    material: { kind: 'artifact', contentType: 'application/json', digest: hex('c'), sizeBytes: 2,
      source: { kind: 'workspace', refId: 'p1/main', revision: '1' } },
  },
  observedAt: '2026-10-17T00:00:00.000Z',
  fileGraph: { schemaVersion: 2, chunks: [], nodeCount: 0, edgeCount: 0, unresolvedCount: 0 },
  languages: [entry as unknown as LanguageCoverageV1],
  inventory: { source: 'skip_list', reason: '不是 git 仓库' },
});

const decode = (entry: Record<string, unknown>) =>
  decodeObservedArchitectureRecord(encodeObservedArchitecture(record(entry)));

describe('S8D coverage notes codec', () => {
  it('S8D-COV-NOTES-01 rejects a coverage entry without notes (the current format requires it)', () => {
    const { notes: _notes, ...withoutNotes } = coverage();
    expect(decode(withoutNotes).status).toBe('invalid');
  });

  it('S8D-COV-NOTES-02 keeps a valid notes list', () => {
    const decoded = decode(coverage({ notes: ['b', 'a'] }));
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    // No sorting in the codec.
    expect(decoded.value.languages?.[0]?.notes).toEqual(['b', 'a']);
  });

  it('S8D-COV-NOTES-03 rejects more than 10 notes', () => {
    expect(decode(coverage({ notes: Array.from({ length: 11 }, (_, index) => 'note-' + index) })).status).toBe('invalid');
  });

  it('S8D-COV-NOTES-04 rejects a note longer than 200 characters', () => {
    expect(decode(coverage({ notes: ['x'.repeat(201)] })).status).toBe('invalid');
  });

  it('S8D-COV-NOTES-05 rejects a non-string note', () => {
    expect(decode(coverage({ notes: [42] })).status).toBe('invalid');
  });

  it('S8D-COV-NOTES-06 cuts before dedupe, then sorts and keeps the first 10', () => {
    // Cutting after dedupe leaves two identical 200-character `b` notes. The
    // lead ruling (§11.5 item 12) cuts first, so the later duplicate disappears.
    expect(normalizeCoverageNotes(['b'.repeat(300), 'b'.repeat(350), 'a']))
      .toEqual(['a', 'b'.repeat(200)]);
  });
});
