/**
 * Row C-codec (pure, A5): the `NoteHead@1` codec round-trips a link body (its ends, key, evidence,
 * analysis config and stored verification), still decodes an old head without the new optional
 * field, and the strict key table refuses `link` on another kind. The input is the K1 literal from
 * the 8E world (injects `runModel` → `authorize` through `beforeCall`); no store, platform or Host.
 */
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { LinkPayloadV1, PendingNoteHeadSnapshot } from '../../src/contracts/note.js';
import { decodeNoteHeadSnapshot, encodeNoteHeadSnapshot } from '../../src/core/work-graph/persistence/note-record-codecs.js';

const SINCE = 'c0000000001' as CommitCursor;

/**
 * `src/runtime/run.ts` as hashed once for the K1 evidence: the fixed source text of the 8E world.
 * The digest below is its sha256, computed outside the test and asserted here as a literal.
 *
 *   import type { Access } from '../contracts/access.js';
 *   import { handlers } from '../wg/registry.js';
 *   export async function runModel(access: Access, id: string) {
 *     await access.beforeCall(id);
 *   }
 *   export function dispatch(id: string) {
 *     handlers.get('wg.audit')?.(id);
 *   }
 *   export function saveReport(write: (path: string, text: string) => void) {
 *     write('reports/latest.json', '{}');
 *   }
 */
const k1Link: LinkPayloadV1 = {
  relation: 'injects',
  ends: {
    from: { kind: 'file', path: 'src/runtime/run.ts', symbolRequest: { language: 'typescript', name: 'runModel' } },
    to: { kind: 'file', path: 'src/wg/permit.ts', symbolRequest: { language: 'typescript', name: 'authorize' } },
    via: { kind: 'file', path: 'src/contracts/access.ts', symbolRequest: { language: 'typescript', name: 'beforeCall' } },
  },
  key: null,
  evidence: [
    {
      role: 'use',
      at: { path: 'src/runtime/run.ts', symbolRequest: { language: 'typescript', name: 'runModel' } },
      fileDigest: '22f784dd2505bf4aaa6cd3a2dfa400b7a21021bfd8fea2ca4c705f80c820e1e9',
      digestBasis: 'raw_bytes',
    },
    {
      role: 'wire',
      at: { path: 'src/compose.ts', range: { startLine: 7, endLine: 7 } },
      fileDigest: null,
      digestBasis: 'raw_bytes',
    },
  ],
  analysisConfig: { path: null, digest: null },
  verification: { status: 'verified' },
};

/** An old head written before `link` existed: no `link` key at all. */
const OLD_PITFALL_HEAD: PendingNoteHeadSnapshot = {
  ref: { aggregateType: 'NoteHead', projectId: 's8e-codec', noteId: 'n1' },
  noteId: 'n1',
  version: 1,
  state: 'accepted',
  goalId: null,
  source: { kind: 'platform' },
  stagedRunKey: null,
  reviewReasons: [],
  confirmedByUser: false,
  anchorKey0: 'file:src/runtime/run.ts',
  anchorKey1: null,
  anchorKey2: null,
  anchorKey3: null,
  anchorKey4: null,
  createdAt: '2026-11-03T00:00:00.000Z',
  since: SINCE,
  kind: 'pitfall',
  topic: 'K1',
  topicKey: 'k1',
  conclusion: 'runModel authorizes through beforeCall',
  body: 'the access slot is wired to permit.authorize',
  anchor: { kind: 'file', path: 'src/runtime/run.ts' },
  extraAnchors: [],
  facts: [],
  basis: { planRevision: null, catalogRevision: null, files: [] },
  structural: false,
  replaces: [],
  contradicts: [],
  coexistWith: [],
};

const LINK_HEAD: PendingNoteHeadSnapshot = {
  ...OLD_PITFALL_HEAD,
  kind: 'link',
  anchor: { kind: 'file', path: 'src/runtime/run.ts' },
  extraAnchors: [{ kind: 'file', path: 'src/wg/permit.ts' }, { kind: 'file', path: 'src/contracts/access.ts' }],
  link: k1Link,
};

function decodedValue(record: ReturnType<typeof encodeNoteHeadSnapshot>): PendingNoteHeadSnapshot {
  const decoded = decodeNoteHeadSnapshot(record);
  expect(decoded.status, JSON.stringify(decoded)).toBe('decoded');
  if (decoded.status !== 'decoded') throw new Error(`not decoded: ${decoded.reason}`);
  return decoded.value;
}

describe('S8E NoteHead codec: the link body round trip', () => {
  it('stores and reads back the K1 link payload', () => {
    const value = decodedValue(encodeNoteHeadSnapshot(LINK_HEAD));
    expect(value.kind).toBe('link');
    expect(value.version).toBe(1);
    expect(value.link?.ends).toEqual(k1Link.ends);
    expect(value.link?.key).toBeNull();
    expect(value.link?.evidence).toEqual(k1Link.evidence);
    expect(value.link?.evidence[0]?.fileDigest).toBe('22f784dd2505bf4aaa6cd3a2dfa400b7a21021bfd8fea2ca4c705f80c820e1e9');
    expect(value.link?.analysisConfig).toEqual({ path: null, digest: null });
    expect(value.link?.verification).toEqual({ status: 'verified' });
    expect(value.link).toEqual(k1Link);
  });

  it('decodes an old head without the optional field and keeps it absent', () => {
    const value = decodedValue(encodeNoteHeadSnapshot(OLD_PITFALL_HEAD));
    expect(value).toEqual({ ...OLD_PITFALL_HEAD, revision: 1 });
    expect(Object.hasOwn(value, 'link')).toBe(false);
  });

  it('rejects a link payload on another kind through the payload-kind gate', () => {
    const decoded = decodeNoteHeadSnapshot(encodeNoteHeadSnapshot({ ...OLD_PITFALL_HEAD, link: k1Link }));
    expect(decoded.status).toBe('invalid');
    if (decoded.status !== 'invalid') throw new Error('a pitfall head carrying link decoded');
    expect(decoded.reason.startsWith('NoteHead record payload is invalid: ')).toBe(true);
  });
});
