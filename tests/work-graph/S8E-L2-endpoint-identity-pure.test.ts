/**
 * 8E L2 W-identity: `endpointIdentityOf` is the ONE endpoint identity
 * (book :217–241). A pure row (A5): every request is a literal and nothing
 * opens a workspace, a capture or a world.
 *
 * The file identity is exactly `normalizePath(path)` plus the REQUESTED name
 * and range; no resolved line or digest enters it, so an inserted line above a
 * declaration cannot change the identity (the write-side example is E-42).
 * `src/runtime/./run.ts` is deliberately absent: the shared normalizer
 * drops only a leading `./` (DR-8E L2-11), and the file-anchor entry rejects
 * the middle form before identity is asked.
 */
import { describe, expect, it } from 'vitest';
import { endpointIdentityOf } from '../../src/core/work-graph/notes/link-evidence.js';
import type { LinkEndRequestV1 } from '../../src/contracts/note.js';

const range = { startLine: 10, endLine: 20 };

/** One file request; the symbol selector is optional so the no-symbol end is the same path. */
function runFile(symbolRequest?: { name: string; range?: { startLine: number; endLine: number } }): LinkEndRequestV1 {
  return symbolRequest === undefined
    ? { kind: 'file', path: 'src/runtime/run.ts' }
    : { kind: 'file', path: 'src/runtime/run.ts',
        symbolRequest: { language: 'typescript', ...symbolRequest } };
}

function busFile(symbolRequest?: { name: string; range?: { startLine: number; endLine: number } }): LinkEndRequestV1 {
  return symbolRequest === undefined
    ? { kind: 'file', path: 'src/runtime/bus.ts' }
    : { kind: 'file', path: 'src/runtime/bus.ts',
        symbolRequest: { language: 'typescript', ...symbolRequest } };
}

describe('S8E-L2 W-identity: the pure endpoint identity', () => {
  it.each<[string, LinkEndRequestV1, string]>([
    ['① module', { kind: 'module', moduleId: 'runtime' }, 'module:runtime'],
    ['① interface', { kind: 'interface', moduleId: 'A', interfaceId: 'I1' }, 'interface:A/I1'],
    ['④ E-14 file', { kind: 'file', path: 'src/compose.ts' }, 'file:src/compose.ts'],
  ])('%s is the frozen identity string', (_label, request, expected) => {
    expect(endpointIdentityOf(request)).toBe(expected);
  });

  it.each<[string, LinkEndRequestV1, LinkEndRequestV1, boolean]>([
    ['② same path and the same symbol request are equal',
      runFile({ name: 'runModel', range }),
      runFile({ name: 'runModel', range }), true],
    ['② same path with a different name is unequal',
      runFile({ name: 'runModel', range }),
      runFile({ name: 'runEntry', range }), false],
    ['② same path and name with a different range is unequal',
      runFile({ name: 'runModel', range }),
      runFile({ name: 'runModel', range: { startLine: 11, endLine: 21 } }), false],
    ['② no symbol and a symbol on the same path are unequal',
      runFile(),
      runFile({ name: 'runModel', range }), false],
  ])('%s', (_label, left, right, equal) => {
    const leftIdentity = endpointIdentityOf(left);
    const rightIdentity = endpointIdentityOf(right);
    if (equal) expect(leftIdentity).toBe(rightIdentity);
    else expect(leftIdentity).not.toBe(rightIdentity);
  });

  it.each<[string, LinkEndRequestV1, LinkEndRequestV1]>([
    ['③ E-33 no symbol vs select', busFile(), busFile({ name: 'select', range })],
    ['③ E-33 no symbol vs onSelected', busFile(), busFile({ name: 'onSelected', range })],
    ['③ E-33 select vs onSelected', busFile({ name: 'select', range }), busFile({ name: 'onSelected', range })],
  ])('%s: the two bus endpoints do not share one identity', (_label, left, right) => {
    expect(endpointIdentityOf(left)).not.toBe(endpointIdentityOf(right));
  });
});
