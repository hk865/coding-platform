/**
 * The pure "未细分" classification (decision 61-2): a module is undivided only when it is the catalog's one module and
 * its declared paths are exactly `['.']`; containment plays no part, one module has no children.
 * Constructed catalogs only, and every expected boolean is written by hand from that rule.
 */
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { ModuleRef } from '../../src/contracts/core/identity.js';
import { isUndividedModule } from '../../src/contracts/architecture-catalog.js';

const PROJECT = 'p1';

const moduleOf = (moduleId: string, paths: string[]): ModuleDefinition => ({
  ref: { projectId: PROJECT, moduleId }, name: moduleId, responsibility: `Own ${moduleId}`, paths, interfaces: [],
});

const catalogOf = (modules: ModuleDefinition[], parentOf?: { parent: string; child: string }[]): AdoptedArchitecture => ({
  modules, dependencies: [], requireDag: true,
  ...(parentOf === undefined ? {} : { containment: { parentOf: parentOf.map(edge => ({
    parent: { projectId: PROJECT, moduleId: edge.parent }, child: { projectId: PROJECT, moduleId: edge.child },
  })) } }),
});

const root = moduleOf('root', ['.']);
const ref = (moduleId: string): ModuleRef => ({ projectId: PROJECT, moduleId });

describe('R-undivided: isUndividedModule', () => {
  it.each<[string, AdoptedArchitecture, ModuleRef, boolean]>([
    ['the one module at the root', catalogOf([root]), ref('root'), true],
    ['the one module at the root with an explicitly empty containment', catalogOf([root], []), ref('root'), true],
    ['a root module beside a declared child', catalogOf([root, moduleOf('src', ['src'])],
      [{ parent: 'root', child: 'src' }]), ref('root'), false],
    ['a root module beside other modules with no declared containment', catalogOf([root, moduleOf('src', ['src'])]),
      ref('root'), false],
    ['a non-root module beside the root', catalogOf([root, moduleOf('n', ['n'])]), ref('n'), false],
    ['the one module, not at the root', catalogOf([moduleOf('n', ['n'])]), ref('n'), false],
    ['the one module, the root among several paths', catalogOf([moduleOf('r', ['.', 'src'])]), ref('r'), false],
    ['a module the catalog does not have', catalogOf([root]), ref('other'), false],
  ])('%s', (_case, catalog, module, expected) => {
    expect(isUndividedModule(catalog, module)).toBe(expected);
  });
});
