/**
 * Slice 8A (task book item 6): ONE shared file-to-module ownership function.
 * `src/contracts/path-ownership.ts` is the canonical implementation; the
 * architecture-source contract and the note path-ownership module re-export the
 * very same function (object identity), never a second copy.
 */
import { describe, expect, it } from 'vitest';
import { pathOwnershipOf as canonical, type PathOwnershipV1 } from '../../src/contracts/path-ownership.js';
import { pathOwnershipOf as fromArchitectureSource } from '../../src/contracts/architecture-source.js';
import { pathOwnershipOf as fromNote } from '../../src/core/work-graph/notes/note-path-ownership.js';

describe('S8A-06 one path-ownership implementation', () => {
  it('S8A-06a both public entry points re-export the canonical function identity', () => {
    expect(fromArchitectureSource).toBe(canonical);
    expect(fromNote).toBe(canonical);
  });

  it('S8A-06b the canonical decision keeps the 4C-1/8A semantics', () => {
    const root = { value: 'Root', paths: ['.'] } as const;
    const concrete = { value: 'A', paths: ['src/a'] } as const;
    const resolved: PathOwnershipV1<string> = canonical('src/a/one.ts', [root, concrete]);
    expect(resolved).toEqual({ status: 'owner', owner: 'A', prefix: 'src/a' });
    expect(canonical('src/loose.ts', [root])).toEqual({ status: 'owner', owner: 'Root', prefix: '.' });
    expect(canonical('src/loose.ts', [
      { value: 'R1', paths: ['.'] }, { value: 'R2', paths: ['.'] },
    ])).toEqual({ status: 'tie', owners: ['R1', 'R2'], prefix: '.' });
    expect(canonical('', [root])).toEqual({ status: 'none' });
  });
});
