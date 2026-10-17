/**
 * Slice 8A formal-vs-observed comparison (spec L7 lines 116-123; §2 lines
 * 264-291; §5.2 A-02 lines 378-388 and A-02b lines 389-396; task book item 5).
 *
 * Pure function: the catalog and the file graph are built by hand, the expected
 * findings are literal and hand-computed. Reuses the one ownership rule
 * `pathOwnershipOf` (`.` match length 0, longest prefix wins, tie -> no owner).
 */
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { LanguageCoverageV1 } from '../../src/contracts/architecture-inspection.js';
import type { ModuleRef } from '../../src/contracts/core/identity.js';
import type { ProjectFileGraphNodeV1, ProjectFileGraphV1 } from '../../src/core/workspace/architecture-language-provider.js';
import { compareFormalObservedGraphs } from '../../src/core/work-graph/architecture/formal-comparison.js';
import { stronglyConnectedCycles } from '../../src/core/work-graph/architecture/architecture-delta.js';

const ref = (moduleId: string): ModuleRef => ({ projectId: 'p1', moduleId });

const moduleDef = (moduleId: string, paths: string[]): ModuleDefinition => ({
  ref: ref(moduleId),
  name: moduleId,
  responsibility: `${moduleId} responsibility`,
  paths,
  interfaces: [],
});

const node = (path: string, language = 'typescript'): ProjectFileGraphNodeV1 =>
  ({ path, digest: 'a'.repeat(64), byteSize: 1, language, nonBlankLines: 1, indexed: true });

/** One coverage entry; every omitted field has the "complete and supported" default. */
const coverage = (overrides: Partial<LanguageCoverageV1> & { language: string }): LanguageCoverageV1 => ({
  files: 0, parsed: 0, edges: 'supported', reason: null, notes: [], issues: [], issueCount: 0, complete: true, ...overrides,
});

/** The A-02/A-02b coverage: every file of the language parsed, edges supported. */
const supportedCoverage = (files: number): LanguageCoverageV1 => ({
  language: 'typescript',
  files,
  parsed: files,
  edges: 'supported',
  reason: null,
  notes: [],
  issues: [],
  issueCount: 0,
  complete: true,
});

const graph = (overrides: Partial<ProjectFileGraphV1> = {}): ProjectFileGraphV1 => ({
  nodes: [],
  edges: [],
  unresolved: [],
  languages: [supportedCoverage(overrides.nodes?.length ?? 0)],
  complete: true,
  inventory: { source: 'skip_list', reason: '不是 git 仓库' },
  ...overrides,
});

// --------------------------------------------------------------------------
// A-02 (spec lines 378-388)
// --------------------------------------------------------------------------

describe('S8A-formal-comparison A-02', () => {
  it('A-02 compares the A-02 catalog and file graph into exactly the five findings', () => {
    const architecture: AdoptedArchitecture = {
      modules: [
        moduleDef('A', ['src/a']),
        moduleDef('B', ['src/b']),
        moduleDef('C', ['src/c']),
        moduleDef('D', ['src/d']),
        moduleDef('P1', ['src/dup']),
        moduleDef('P2', ['src/dup']),
      ],
      dependencies: [{ from: ref('A'), to: ref('B'), reason: 'x' }],
      requireDag: true,
    };
    const fileGraph = graph({
      nodes: [
        node('src/a/one.ts'),
        node('src/b/lib.ts'),
        node('src/c/one.ts'),
        node('src/d/one.ts'),
        node('src/a/broken.ts'),
        node('src/loose.ts'),
        node('src/dup/one.ts'),
      ],
      edges: [{ from: 'src/c/one.ts', to: 'src/d/one.ts' }],
      unresolved: [{ from: 'src/a/broken.ts', specifier: 'src/nowhere.ts', reason: null }],
    });

    expect(compareFormalObservedGraphs({ architecture, fileGraph })).toEqual([
      { kind: 'dependency_missing', moduleRef: ref('A'), path: 'src/a', detail: 'A→B', certainty: 'unknown' },
      { kind: 'unresolved', moduleRef: ref('A'), path: 'src/a/broken.ts', detail: 'src/nowhere.ts', certainty: 'unknown' },
      { kind: 'import_undeclared', moduleRef: ref('C'), path: 'src/c/one.ts', detail: 'src/d/one.ts', certainty: 'proven' },
      { kind: 'ambiguous', moduleRef: null, path: 'src/dup/one.ts', detail: 'src/dup 命中 P1、P2', certainty: 'unknown' },
      { kind: 'ungrouped', moduleRef: null, path: 'src/loose.ts', detail: '不在任何模块 path 下', certainty: 'unknown' },
    ]);
  });
});

// --------------------------------------------------------------------------
// A-02b (spec lines 389-396)
// --------------------------------------------------------------------------

describe('S8A-formal-comparison A-02b', () => {
  it('A-02b reports the file cycle and the undeclared reverse import, not the observed A→B', () => {
    const architecture: AdoptedArchitecture = {
      modules: [moduleDef('A', ['src/a']), moduleDef('B', ['src/b'])],
      dependencies: [{ from: ref('A'), to: ref('B'), reason: 'x' }],
      requireDag: true,
    };
    const fileGraph = graph({
      nodes: [node('src/a/one.ts'), node('src/b/lib.ts')],
      edges: [
        { from: 'src/a/one.ts', to: 'src/b/lib.ts' },
        { from: 'src/b/lib.ts', to: 'src/a/one.ts' },
      ],
      languages: [supportedCoverage(2)],
    });

    expect(compareFormalObservedGraphs({ architecture, fileGraph })).toEqual([
      { kind: 'cycle', moduleRef: null, path: 'src/a/one.ts', detail: 'src/a/one.ts ⇄ src/b/lib.ts', certainty: 'proven' },
      { kind: 'import_undeclared', moduleRef: ref('B'), path: 'src/b/lib.ts', detail: 'src/a/one.ts', certainty: 'proven' },
    ]);
  });
});

// --------------------------------------------------------------------------
// Root module `.` (spec L7; A-05 ownership shape)
// --------------------------------------------------------------------------

describe('S8A-formal-comparison root prefix `.`', () => {
  it('the root module owns src/loose.ts while the concrete src/a still owns src/a/one.ts', () => {
    const architecture: AdoptedArchitecture = {
      modules: [moduleDef('R', ['.']), moduleDef('A', ['src/a'])],
      dependencies: [{ from: ref('R'), to: ref('A'), reason: 'x' }],
      requireDag: true,
    };
    const fileGraph = graph({
      nodes: [node('src/a/one.ts'), node('src/loose.ts')],
      edges: [{ from: 'src/a/one.ts', to: 'src/loose.ts' }],
      languages: [supportedCoverage(2)],
    });

    expect(compareFormalObservedGraphs({ architecture, fileGraph })).toEqual([
      { kind: 'dependency_missing', moduleRef: ref('R'), path: '.', detail: 'R→A', certainty: 'proven' },
      { kind: 'import_undeclared', moduleRef: ref('A'), path: 'src/a/one.ts', detail: 'src/loose.ts', certainty: 'proven' },
    ]);
  });
});

// --------------------------------------------------------------------------
// A declared dependency that IS observed produces no dependency_missing
// --------------------------------------------------------------------------

describe('S8A-formal-comparison observed declared dependency', () => {
  it('reports only the declared dependency that has no observed edge', () => {
    const architecture: AdoptedArchitecture = {
      modules: [
        moduleDef('A', ['src/a']),
        moduleDef('B', ['src/b']),
        moduleDef('C', ['src/c']),
        moduleDef('D', ['src/d']),
      ],
      dependencies: [
        { from: ref('A'), to: ref('B'), reason: 'x' },
        { from: ref('C'), to: ref('D'), reason: 'y' },
      ],
      requireDag: true,
    };
    const fileGraph = graph({
      nodes: [node('src/a/one.ts'), node('src/b/lib.ts'), node('src/c/one.ts'), node('src/d/one.ts')],
      edges: [{ from: 'src/a/one.ts', to: 'src/b/lib.ts' }],
      languages: [supportedCoverage(4)],
    });

    expect(compareFormalObservedGraphs({ architecture, fileGraph })).toEqual([
      { kind: 'dependency_missing', moduleRef: ref('C'), path: 'src/c', detail: 'C→D', certainty: 'proven' },
    ]);
  });
});

// --------------------------------------------------------------------------
// Item 3: same-module edges and the "unknown" reach rules
// --------------------------------------------------------------------------

describe('S8A-formal-comparison same-module imports', () => {
  it('S8A-08 one module importing itself never produces import_undeclared', () => {
    const architecture: AdoptedArchitecture = {
      modules: [moduleDef('A', ['src/a'])],
      dependencies: [],
      requireDag: true,
    };
    const fileGraph = graph({
      nodes: [node('src/a/one.ts'), node('src/a/two.ts')],
      edges: [{ from: 'src/a/one.ts', to: 'src/a/two.ts' }],
      languages: [supportedCoverage(2)],
    });
    expect(compareFormalObservedGraphs({ architecture, fileGraph })).toEqual([]);
  });
});

describe('S8A-formal-comparison unknown reach', () => {
  it('S8A-09 an outgoing edge to an unowned file makes the missing dependency unknown', () => {
    const architecture: AdoptedArchitecture = {
      modules: [moduleDef('A', ['src/a']), moduleDef('B', ['src/b'])],
      dependencies: [{ from: ref('A'), to: ref('B'), reason: 'x' }],
      requireDag: true,
    };
    const fileGraph = graph({
      nodes: [node('src/a/one.ts'), node('src/loose.ts')],
      edges: [{ from: 'src/a/one.ts', to: 'src/loose.ts' }],
      languages: [supportedCoverage(2)],
    });
    expect(compareFormalObservedGraphs({ architecture, fileGraph })).toEqual([
      { kind: 'dependency_missing', moduleRef: ref('A'), path: 'src/a', detail: 'A→B', certainty: 'unknown' },
      { kind: 'ungrouped', moduleRef: null, path: 'src/loose.ts', detail: '不在任何模块 path 下', certainty: 'unknown' },
    ]);
  });

  it('S8A-10 an outgoing edge to a tied file makes the missing dependency unknown', () => {
    const architecture: AdoptedArchitecture = {
      modules: [moduleDef('A', ['src/a']), moduleDef('B', ['src/b']),
        moduleDef('P1', ['src/dup']), moduleDef('P2', ['src/dup'])],
      dependencies: [{ from: ref('A'), to: ref('B'), reason: 'x' }],
      requireDag: true,
    };
    const fileGraph = graph({
      nodes: [node('src/a/one.ts'), node('src/dup/one.ts')],
      edges: [{ from: 'src/a/one.ts', to: 'src/dup/one.ts' }],
      languages: [supportedCoverage(2)],
    });
    expect(compareFormalObservedGraphs({ architecture, fileGraph })).toEqual([
      { kind: 'dependency_missing', moduleRef: ref('A'), path: 'src/a', detail: 'A→B', certainty: 'unknown' },
      { kind: 'ambiguous', moduleRef: null, path: 'src/dup/one.ts', detail: 'src/dup 命中 P1、P2', certainty: 'unknown' },
    ]);
  });

  it('S8A-11 a skipped issue path owned by the module makes the missing dependency unknown', () => {
    const architecture: AdoptedArchitecture = {
      modules: [moduleDef('A', ['src/a']), moduleDef('B', ['src/b'])],
      dependencies: [{ from: ref('A'), to: ref('B'), reason: 'x' }],
      requireDag: true,
    };
    const fileGraph = graph({
      nodes: [],
      edges: [],
      languages: [coverage({ language: 'typescript', files: 1, parsed: 0, complete: false,
        issues: [{ path: 'src/a/big.ts', kind: 'skipped', reason: 'too large' }], issueCount: 1 })],
    });
    expect(compareFormalObservedGraphs({ architecture, fileGraph })).toEqual([
      { kind: 'dependency_missing', moduleRef: ref('A'), path: 'src/a', detail: 'A→B', certainty: 'unknown' },
    ]);
  });

  it('S8A-12 truncated issues in a source language make every missing dependency unknown', () => {
    const architecture: AdoptedArchitecture = {
      modules: [moduleDef('A', ['src/a']), moduleDef('B', ['src/b']),
        moduleDef('C', ['src/c']), moduleDef('D', ['src/d'])],
      dependencies: [
        { from: ref('A'), to: ref('B'), reason: 'x' },
        { from: ref('C'), to: ref('D'), reason: 'y' },
      ],
      requireDag: true,
    };
    const fileGraph = graph({
      nodes: [node('src/a/one.ts'), node('src/b/lib.ts'), node('src/c/one.ts'), node('src/d/one.ts')],
      edges: [],
      languages: [coverage({ language: 'typescript', files: 4, parsed: 4,
        issues: [{ path: 'src/loose/big.ts', kind: 'skipped', reason: 'too large' }], issueCount: 3, complete: false })],
    });
    expect(compareFormalObservedGraphs({ architecture, fileGraph })).toEqual([
      { kind: 'dependency_missing', moduleRef: ref('A'), path: 'src/a', detail: 'A→B', certainty: 'unknown' },
      { kind: 'dependency_missing', moduleRef: ref('C'), path: 'src/c', detail: 'C→D', certainty: 'unknown' },
    ]);
  });

  it('S8A-13 an edge from loose code into the module cannot make its missing dependency unknown', () => {
    const architecture: AdoptedArchitecture = {
      modules: [moduleDef('A', ['src/a']), moduleDef('B', ['src/b'])],
      dependencies: [{ from: ref('A'), to: ref('B'), reason: 'x' }],
      requireDag: true,
    };
    const fileGraph = graph({
      nodes: [node('src/a/one.ts'), node('src/loose.ts')],
      edges: [{ from: 'src/loose.ts', to: 'src/a/one.ts' }],
      languages: [supportedCoverage(2)],
    });
    expect(compareFormalObservedGraphs({ architecture, fileGraph })).toEqual([
      { kind: 'dependency_missing', moduleRef: ref('A'), path: 'src/a', detail: 'A→B', certainty: 'proven' },
      { kind: 'ungrouped', moduleRef: null, path: 'src/loose.ts', detail: '不在任何模块 path 下', certainty: 'unknown' },
    ]);
  });

  it('S8A-14 an `other` file in the module does not make the missing dependency unknown', () => {
    const architecture: AdoptedArchitecture = {
      modules: [moduleDef('A', ['src/a']), moduleDef('B', ['src/b'])],
      dependencies: [{ from: ref('A'), to: ref('B'), reason: 'x' }],
      requireDag: true,
    };
    const fileGraph = graph({
      nodes: [node('src/a/one.ts'), node('src/a/readme.md', 'other')],
      edges: [],
      languages: [
        supportedCoverage(1),
        coverage({ language: 'other', files: 1, parsed: 0, edges: 'unsupported', complete: false }),
      ],
    });
    expect(compareFormalObservedGraphs({ architecture, fileGraph })).toEqual([
      { kind: 'dependency_missing', moduleRef: ref('A'), path: 'src/a', detail: 'A→B', certainty: 'proven' },
    ]);
  });

  it('S8A-18 a tie on an `other` file never makes the missing dependency unknown', () => {
    const architecture: AdoptedArchitecture = {
      modules: [moduleDef('X', ['src/dup']), moduleDef('Y', ['src/dup']), moduleDef('Z', ['src/z'])],
      dependencies: [{ from: ref('X'), to: ref('Z'), reason: 'x' }],
      requireDag: true,
    };
    const readings = (tiedFile: ProjectFileGraphNodeV1) => graph({
      nodes: [tiedFile, node('src/z/lib.ts')],
      edges: [],
      languages: [
        supportedCoverage(1),
        coverage({ language: 'other', files: 1, parsed: 0, edges: 'unsupported', complete: false }),
      ],
    });
    // The doc tie is still reported `ambiguous`, but it cannot poison the
    // reference evidence: X→Z stays `proven`.
    expect(compareFormalObservedGraphs({ architecture, fileGraph: readings(node('src/dup/readme.md', 'other')) })).toEqual([
      { kind: 'dependency_missing', moduleRef: ref('X'), path: 'src/dup', detail: 'X→Z', certainty: 'proven' },
      { kind: 'ambiguous', moduleRef: null, path: 'src/dup/readme.md', detail: 'src/dup 命中 X、Y', certainty: 'unknown' },
    ]);
    // The same tie on a source file does make it unknown.
    expect(compareFormalObservedGraphs({ architecture, fileGraph: readings(node('src/dup/readme.ts')) })).toEqual([
      { kind: 'dependency_missing', moduleRef: ref('X'), path: 'src/dup', detail: 'X→Z', certainty: 'unknown' },
      { kind: 'ambiguous', moduleRef: null, path: 'src/dup/readme.ts', detail: 'src/dup 命中 X、Y', certainty: 'unknown' },
    ]);
  });
});

// --------------------------------------------------------------------------
// Item 10: the ONE exported strongly-connected-components detector
// --------------------------------------------------------------------------

describe('S8A-formal-comparison shared cycle detector', () => {
  it('S8A-15 architecture-delta exports the one stronglyConnectedCycles function', () => {
    expect(stronglyConnectedCycles(
      ['b', 'a'],
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    )).toEqual([['a', 'b']]);
    expect(stronglyConnectedCycles(['a'], [{ from: 'a', to: 'a' }])).toEqual([['a']]);
    expect(stronglyConnectedCycles(['a', 'b'], [{ from: 'a', to: 'b' }])).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// Rework 2 item 2: a skipped/failed file on an equal-longest tie is not
// dropped; every tied module's missing dependencies become unknown.
// --------------------------------------------------------------------------

describe('S8A-formal-comparison tied skipped path', () => {
  it('S8A-19 a skipped file on a tied path makes the tied modules unknown', () => {
    const architecture: AdoptedArchitecture = {
      modules: [
        moduleDef('A', ['src/dup']),
        moduleDef('P', ['src/dup']),
        moduleDef('B', ['src/b']),
      ],
      dependencies: [{ from: ref('A'), to: ref('B'), reason: 'x' }],
      requireDag: true,
    };
    const fileGraph = graph({
      nodes: [node('src/b/lib.ts')],
      edges: [],
      languages: [coverage({ language: 'typescript', files: 2, parsed: 1, complete: false,
        issues: [{ path: 'src/dup/bad.ts', kind: 'skipped', reason: 'binary source' }], issueCount: 1 })],
    });
    // The skipped file is not a node, so there is no `ambiguous` finding; the
    // tie must still reach A (and P), making A→B `unknown` rather than `proven`.
    expect(compareFormalObservedGraphs({ architecture, fileGraph })).toEqual([
      { kind: 'dependency_missing', moduleRef: ref('A'), path: 'src/dup', detail: 'A→B', certainty: 'unknown' },
    ]);
  });
});
