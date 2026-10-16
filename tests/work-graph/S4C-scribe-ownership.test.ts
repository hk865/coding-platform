/**
 * RW-13 (U2 / decision 72): the scribe-scope caller of the ONE path-ownership
 * function. `moduleOfAnchor` must delegate to `pathOwnershipOf`
 * (`notes/note-path-ownership.ts`): A = `src`, B = `src/deep`, file
 * `src/deep/x.ts` -> B only; two candidates at the same longest length -> no
 * owner (`null`). This is the shared-function seam; `writeAdmission` consumes it
 * through the same call.
 */
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import { moduleOfAnchor } from '../../src/core/work-graph/notes/scribe-scope.js';

function moduleDef(moduleId: string, paths: string[]): ModuleDefinition {
  return { ref: { projectId: 'p', moduleId }, name: moduleId, responsibility: moduleId, paths, interfaces: [] };
}

function catalog(modules: ModuleDefinition[]): AdoptedArchitecture {
  return { modules, dependencies: [], requireDag: true };
}

const FILE_DEEP = { kind: 'file', path: 'src/deep/x.ts' } as const;

describe('RW-13 the scribe-scope path ownership comes from the shared function', () => {
  it('RW-13 longest prefix wins: src/deep belongs to B, not A', () => {
    const adopted = catalog([moduleDef('A', ['src']), moduleDef('B', ['src/deep'])]);
    expect(moduleOfAnchor(adopted, FILE_DEEP)).toBe('B');
  });

  it('RW-13 a tie at the longest matched length has no owner', () => {
    const adopted = catalog([moduleDef('A', ['src']), moduleDef('B', ['src'])]);
    expect(moduleOfAnchor(adopted, FILE_DEEP)).toBeNull();
  });

  it('RW-13 a trailing slash and a directory boundary both match', () => {
    const adopted = catalog([moduleDef('A', ['src/']), moduleDef('B', ['src/deep/'])]);
    expect(moduleOfAnchor(adopted, FILE_DEEP)).toBe('B');
    // `src/deeper` is a DIFFERENT directory from `src/deep`; A owns it.
    expect(moduleOfAnchor(adopted, { kind: 'file', path: 'src/deeper/x.ts' })).toBe('A');
    // A file named like the prefix is not inside it.
    expect(moduleOfAnchor(adopted, { kind: 'file', path: 'src/deepx.ts' })).toBe('A');
  });

  it('RW-13 a module/interface anchor keeps its own module id and no catalog is null', () => {
    expect(moduleOfAnchor(null, { kind: 'module', moduleId: 'M' })).toBe('M');
    expect(moduleOfAnchor(null, { kind: 'file', path: 'src/a.ts' })).toBeNull();
  });
});
