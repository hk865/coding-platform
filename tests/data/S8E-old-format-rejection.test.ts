/**
 * Decision 79: the current codecs read only the current format. An earlier-shape
 * body, chunk or record is rejected by the pure decoder — never migrated and
 * never accepted as a `previous` observation.
 *
 * This is a pure-function contract test: every value is a constructed literal,
 * no workspace, store or platform is built.
 */
import { expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import {
  decodeObservedArchitectureBody, decodeObservedArchitectureRecord, decodeObservedFileGraphChunk,
} from '../../src/core/work-graph/architecture/architecture-record-codecs.js';

const digest = (character: string): string => character.repeat(64);
const SCOPE = { projectId: 'p1', workspaceId: 'w1' };

const CAPTURE = {
  projectId: 'p1', workspaceId: 'w1', captureId: 'c1', workspaceRevision: 1,
  sourceDigest: digest('a'), configDigest: digest('b'), indexVersion: 'typescript@6.0.3',
};
const architecture = {
  schemaVersion: 1, projectId: 'p1', workspaceId: 'w1', workspaceRevision: 1,
  sourceDigest: digest('a'), commitHash: null, indexVersion: 'typescript@6.0.3', configPath: null,
  mappings: [], nodes: [], edges: [], unresolved: [],
};
const body = {
  schemaVersion: 2, capture: CAPTURE, observedAt: '2026-10-17T00:00:00.000Z',
  summary: { files: 0, languages: [], changes: { added: 0, modified: 0, deleted: 0 } },
  architecture,
};
const node = {
  path: 'a.ts', digest: digest('c'), byteSize: 1, language: 'typescript', nonBlankLines: 1, indexed: true,
};
const artifact = (character: string) => ({
  kind: 'artifact', contentType: 'application/json', digest: digest(character), sizeBytes: 10,
  source: { kind: 'workspace', refId: 'w1', revision: '1' },
});
const recordBase = {
  ref: { aggregateType: 'ObservedArchitecture', projectId: 'p1', workspaceId: 'w1', captureId: 'c1' },
  revision: 1, schemaVersion: 1,
  source: { capture: CAPTURE, material: artifact('d') },
  observedAt: '2026-10-17T00:00:00.000Z',
  fileGraph: { schemaVersion: 2, chunks: [], nodeCount: 0, edgeCount: 0, unresolvedCount: 0 },
  languages: [], inventory: { source: 'skip_list', reason: '不是 git 仓库' },
};
const decodeRecord = (record: Record<string, unknown>) => decodeObservedArchitectureRecord({
  refKey: canonicalJson(record['ref'] as unknown as JsonValue),
  schemaId: 'ObservedArchitecture@1', revision: 1, json: JSON.stringify(record),
});

it('rejects an earlier body, chunk and record shape instead of migrating it', () => {
  // The current shapes decode, so each rejection below is about the old shape.
  expect(decodeObservedArchitectureBody(JSON.stringify(body), [])).toMatchObject({ status: 'decoded' });
  expect(decodeObservedFileGraphChunk(JSON.stringify({
    schemaVersion: 2, ...SCOPE, nodes: [], edges: [], unresolved: [],
  }), SCOPE)).toMatchObject({ status: 'decoded' });
  // The v2 chunk without the two scope fields is the earlier shape: rejected,
  // never filled in from the record.
  expect(decodeObservedFileGraphChunk(JSON.stringify({ schemaVersion: 2, nodes: [], edges: [], unresolved: [] }), SCOPE))
    .toMatchObject({ status: 'invalid' });
  expect(decodeRecord(recordBase)).toMatchObject({ status: 'decoded' });

  // The 8A v1 body (`files` + a full capture summary + indexedSources) is invalid.
  expect(decodeObservedArchitectureBody(JSON.stringify({ ...body, schemaVersion: 1 }), []).status).toBe('invalid');
  expect(decodeObservedArchitectureBody(JSON.stringify({ ...body, files: [] }), []).status).toBe('invalid');

  // The 8A v1 chunk (node/edge object shape, no unresolved list) and a v2 chunk
  // carrying a path-shaped edge instead of global index pairs are invalid.
  expect(decodeObservedFileGraphChunk(JSON.stringify({ schemaVersion: 1, nodes: [], edges: [] }), SCOPE).status).toBe('invalid');
  expect(decodeObservedFileGraphChunk(JSON.stringify({
    schemaVersion: 2, ...SCOPE, nodes: [node], edges: [['a.ts', 'b.ts']], unresolved: [],
  }), SCOPE).status).toBe('invalid');

  // A record missing any current required field is unreadable (not a migration
  // and not an empty success page).
  for (const field of ['fileGraph', 'languages', 'inventory'] as const) {
    const earlier: Record<string, unknown> = { ...recordBase };
    delete earlier[field];
    expect(decodeRecord(earlier).status).not.toBe('decoded');
  }
  // The whole-`null` inventory belongs to earlier records only (decision 79);
  // the current format always writes the object.
  expect(decodeRecord({ ...recordBase, inventory: null }).status).toBe('invalid');
  // An 8A manifest without `schemaVersion` is an earlier shape too.
  expect(decodeRecord({ ...recordBase,
    fileGraph: { chunks: [], nodeCount: 0, edgeCount: 0, unresolved: [] } }).status).not.toBe('decoded');
});
