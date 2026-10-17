/**
 * Slice 8 §11.5 (as amended by §10): the pure formal-vs-observed comparison
 * carries each unresolved entry's provider reason into the finding `detail`.
 * `null` keeps the bare specifier; otherwise `detail` is `<specifier>（<reason>）`.
 */
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { LanguageCoverageV1 } from '../../src/contracts/architecture-inspection.js';
import type { ModuleRef } from '../../src/contracts/core/identity.js';
import type { ProjectFileGraphV1 } from '../../src/core/workspace/architecture-language-provider.js';
import { compareFormalObservedGraphs } from '../../src/core/work-graph/architecture/formal-comparison.js';

const ref = (moduleId: string): ModuleRef => ({ projectId: 'p1', moduleId });
const moduleDef = (moduleId: string, paths: string[]): ModuleDefinition => ({
  ref: ref(moduleId), name: moduleId, responsibility: `${moduleId} responsibility`, paths, interfaces: [],
});
const coverage = (files: number): LanguageCoverageV1 => ({
  language: 'typescript', files, parsed: files, edges: 'supported', reason: null,
  notes: [], issues: [], issueCount: 0, complete: true,
});

describe('S8D formal unresolved reason', () => {
  it('uses the bare specifier for reason null and <specifier>（<reason>） when a reason exists', () => {
    const architecture: AdoptedArchitecture = {
      modules: [moduleDef('A', ['src'])],
      dependencies: [],
      requireDag: true,
    };
    const fileGraph = {
      nodes: [
        { path: 'src/a.ts', nonBlankLines: 1, language: 'typescript' },
        { path: 'src/b.ts', nonBlankLines: 1, language: 'typescript' },
      ],
      edges: [],
      unresolved: [
        { from: 'src/a.ts', specifier: './nowhere', reason: null },
        { from: 'src/a.ts', specifier: 'NOPE', reason: 'include 后面跟宏' },
      ],
      languages: [coverage(2)],
      complete: true,
      inventory: { source: 'skip_list', reason: '不是 git 仓库' },
    } as unknown as ProjectFileGraphV1;

    const unresolved = compareFormalObservedGraphs({ architecture, fileGraph })
      .filter(finding => finding.kind === 'unresolved');

    expect(unresolved).toEqual([
      { kind: 'unresolved', moduleRef: ref('A'), path: 'src/a.ts', detail: './nowhere', certainty: 'unknown' },
      { kind: 'unresolved', moduleRef: ref('A'), path: 'src/a.ts', detail: 'NOPE（include 后面跟宏）', certainty: 'unknown' },
    ]);
  });
});
