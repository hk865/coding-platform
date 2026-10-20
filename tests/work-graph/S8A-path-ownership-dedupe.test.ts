/**
 * Slice 8A (task book item 6): ONE shared file-to-module ownership function.
 * `src/contracts/path-ownership.ts` is the canonical implementation; the
 * architecture-source contract and the note path-ownership module re-export the
 * very same function (object identity), never a second copy.
 */
import { describe, expect, it } from 'vitest';
import { pathOwnershipOf as canonical } from '../../src/contracts/path-ownership.js';
import { pathOwnershipOf as fromArchitectureSource } from '../../src/contracts/architecture-source.js';
import { pathOwnershipOf as fromNote } from '../../src/core/work-graph/notes/note-path-ownership.js';

describe('S8A-06 one path-ownership implementation', () => {
  it('S8A-06a both public entry points re-export the canonical function identity', () => {
    expect(fromArchitectureSource).toBe(canonical);
    expect(fromNote).toBe(canonical);
  });
});
