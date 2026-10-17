/**
 * Slice 8D acceptance entry AE6 (spec §5.1 line 373; §5.2 A-06 line 420):
 * the PUBLIC `platform.architecture` capture/query path over a real temporary
 * workspace holding C/C++ and Python sources. Every expected value is literal
 * and hand-computed from the row; no database read verifies an assertion.
 *
 * AE6 wording: the observation is read across `listFiles` pages; the Python
 * provider (only needs system Python 3.11+) extracts import edges from the
 * frozen material through the §11.5 executor, and the observation does not page
 * the analyzer. Both Python interpreter states (available/unavailable) run.
 * The same fixture and literals run on both storage backends. The shared
 * `tests/helpers/S8D-platform-fixture.ts` builds and closes the platform.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { ModuleRef } from '../../src/contracts/core/identity.js';
import { BACKENDS, fixture, type Entry } from '../helpers/S8D-platform-fixture.js';

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

const LLVM_LIBCLANG = '/usr/lib/llvm-18/lib/libclang.so.1';

function moduleDef(projectId: string, moduleId: string, paths: string[]): ModuleDefinition {
  return { ref: { projectId, moduleId }, name: moduleId, responsibility: moduleId + ' responsibility',
    paths, interfaces: [] };
}

const MAPPINGS = [
  { id: 'N', kind: 'module' as const, paths: ['native'] },
  { id: 'S', kind: 'module' as const, paths: ['src'] },
];

/** `src/a.ts` 2, `src/b.ts` 1, `native/c.cpp` 2, `native/d.h` 1, `e.py` 3, `g.py` 1, `f.py` 1, `many.py` 201. */
function baseFiles(): Entry[] {
  return [
    ['src/a.ts', "import { y } from './b';\n\nexport const x = y;\n"],
    ['src/b.ts', 'export const y = 2;\n'],
    ['native/c.cpp', '#include "d.h"\nint f() { return g(); }\n'],
    ['native/d.h', 'int g();\n'],
    ['e.py', 'import g\nimport os\n\nprint(g.x, os.name)\n'],
    ['g.py', 'x = 1\n'],
    ['f.py', 'def broken(:\n'],
    ['many.py', 'import g\n'.repeat(201)],
    // A NUL byte makes this binary: skipped, never a node.
    ['logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])],
  ];
}

const SITUATION1_NODES = [
  { path: 'e.py', nonBlankLines: 3, language: 'python' },
  { path: 'f.py', nonBlankLines: 1, language: 'python' },
  { path: 'g.py', nonBlankLines: 1, language: 'python' },
  { path: 'many.py', nonBlankLines: 201, language: 'python' },
  { path: 'native/c.cpp', nonBlankLines: 2, language: 'cpp' },
  { path: 'native/d.h', nonBlankLines: 1, language: 'cpp' },
  { path: 'src/a.ts', nonBlankLines: 2, language: 'typescript' },
  { path: 'src/b.ts', nonBlankLines: 1, language: 'typescript' },
];

const SITUATION1_EDGES = [
  { from: 'e.py', to: 'g.py' },
  { from: 'many.py', to: 'g.py' },
  { from: 'src/a.ts', to: 'src/b.ts' },
];

const TYPESCRIPT_COVERAGE = {
  language: 'typescript', files: 2, parsed: 2, edges: 'supported', reason: null, notes: [],
  issues: [], issueCount: 0, complete: true,
} as const;

const CPP_NO_DATABASE = {
  language: 'cpp', files: 2, parsed: 0, edges: 'failed', reason: '没有 compile_commands.json', notes: [],
  issues: [], issueCount: 0, complete: false,
} as const;

const PYTHON_PARTIAL = {
  language: 'python', files: 4, parsed: 3, edges: 'supported', reason: null, notes: [],
  issues: [{ path: 'f.py', kind: 'failed', reason: 'SyntaxError: invalid syntax' }], issueCount: 1, complete: false,
} as const;

const coverageOf = <T extends { language: string }>(languages: readonly T[], language: string): T | undefined =>
  languages.find(entry => entry.language === language);

describe.each(BACKENDS)('A-06 multilingual observation [%s]', backend => {
  it('A-06 situation 1: Python interpreter available, no compilation database; 8 nodes, 3 edges and the three coverages', async () => {
    const projectId = 's8d-a06-situation-1';
    const f = await fixture(backend, projectId, baseFiles());
    try {
      const ref = (moduleId: string): ModuleRef => ({ projectId, moduleId });
      const pin = await f.adopt([moduleDef(projectId, 'N', ['native']), moduleDef(projectId, 'S', ['src'])],
        [{ from: ref('N'), to: ref('S'), reason: 'N uses S' }]);
      const captureRef = await f.capture(MAPPINGS, 'a06-situation-1-capture');

      const page = await f.listFiles(captureRef);
      expect(page.nodes).toEqual(SITUATION1_NODES);
      expect(page.edges).toEqual(SITUATION1_EDGES);

      const other = coverageOf(page.languages, 'other');
      expect(other?.issues).toContainEqual({ path: 'logo.png', kind: 'skipped', reason: 'binary source' });
      expect(other?.issueCount).toBe(1);

      expect(coverageOf(page.languages, 'typescript')).toEqual(TYPESCRIPT_COVERAGE);
      expect(coverageOf(page.languages, 'cpp')).toEqual(CPP_NO_DATABASE);
      expect(coverageOf(page.languages, 'python')).toEqual(PYTHON_PARTIAL);

      const comparison = await f.platform.architecture.compareFormalObserved(f.ctx, { catalog: pin, captureRef });
      expect(comparison).toMatchObject({ status: 'ready', value: { noVerdict: true } });
      if (comparison.status !== 'ready') return;
      // `listFiles` exposes no `unresolved` field, so the one public read of it is
      // the comparison's `unresolved` finding.
      expect(comparison.value.findings.filter(finding => finding.kind === 'unresolved')).toEqual([
        { kind: 'unresolved', moduleRef: null, path: 'e.py', detail: 'os（标准库）', certainty: 'unknown' },
      ]);
      expect(comparison.value.findings).toContainEqual({
        kind: 'dependency_missing', moduleRef: ref('N'), path: 'native', detail: 'N→S', certainty: 'unknown',
      });

      // The observation no longer uses `sourceAnalyzers.directory`: an empty
      // analyzers directory leaves the result identical to situation 1.
      const empty = await mkdtemp(join(tmpdir(), 's8d-a06-empty-directory-'));
      directories.push(empty);
      const rerun = await fixture(backend, projectId + '-directory', baseFiles(),
        { sourceAnalyzers: { directory: empty } });
      try {
        const rerunRef = await rerun.capture(MAPPINGS, 'a06-situation-1-directory-capture');
        const rerunPage = await rerun.listFiles(rerunRef);
        expect(rerunPage.nodes).toEqual(SITUATION1_NODES);
        expect(rerunPage.edges).toEqual(SITUATION1_EDGES);
        expect(coverageOf(rerunPage.languages, 'typescript')).toEqual(TYPESCRIPT_COVERAGE);
        expect(coverageOf(rerunPage.languages, 'cpp')).toEqual(CPP_NO_DATABASE);
        expect(coverageOf(rerunPage.languages, 'python')).toEqual(PYTHON_PARTIAL);
      } finally { await rerun.close(); }
    } finally { await f.close(); }
  });

  it('A-06 situation 2: root compile_commands.json plus libclang scores cpp and proves N→S', async () => {
    const projectId = 's8d-a06-situation-2';
    const compileDatabase = JSON.stringify([{ directory: '.', file: 'native/c.cpp',
      arguments: ['c++', '-c', 'native/c.cpp'] }]) + '\n';
    const f = await fixture(backend, projectId, [...baseFiles(), ['compile_commands.json', compileDatabase]],
      { sourceAnalyzers: { cppLibraryPath: LLVM_LIBCLANG } });
    try {
      const ref = (moduleId: string): ModuleRef => ({ projectId, moduleId });
      const pin = await f.adopt([moduleDef(projectId, 'N', ['native']), moduleDef(projectId, 'S', ['src'])],
        [{ from: ref('N'), to: ref('S'), reason: 'N uses S' }]);
      const captureRef = await f.capture(MAPPINGS, 'a06-situation-2-capture');

      const page = await f.listFiles(captureRef);
      expect(page.nodes).toEqual([
        { path: 'compile_commands.json', nonBlankLines: 1, language: 'other' },
        ...SITUATION1_NODES,
      ]);
      expect(page.edges).toEqual([
        { from: 'e.py', to: 'g.py' },
        { from: 'many.py', to: 'g.py' },
        { from: 'native/c.cpp', to: 'native/d.h' },
        { from: 'src/a.ts', to: 'src/b.ts' },
      ]);

      expect(coverageOf(page.languages, 'cpp')).toEqual({
        language: 'cpp', files: 2, parsed: 2, edges: 'supported', reason: null,
        notes: ['近似：不读系统头文件和观测以外的头文件'], issues: [], issueCount: 0, complete: true,
      });
      expect(coverageOf(page.languages, 'typescript')).toEqual(TYPESCRIPT_COVERAGE);
      expect(coverageOf(page.languages, 'python')).toEqual(PYTHON_PARTIAL);

      const comparison = await f.platform.architecture.compareFormalObserved(f.ctx, { catalog: pin, captureRef });
      expect(comparison).toMatchObject({ status: 'ready', value: { noVerdict: true } });
      if (comparison.status !== 'ready') return;
      expect(comparison.value.findings.filter(finding => finding.kind === 'unresolved')).toEqual([
        { kind: 'unresolved', moduleRef: null, path: 'e.py', detail: 'os（标准库）', certainty: 'unknown' },
      ]);
      expect(comparison.value.findings).toContainEqual({
        kind: 'dependency_missing', moduleRef: ref('N'), path: 'native', detail: 'N→S', certainty: 'proven',
      });
    } finally { await f.close(); }
  });

  it('A-06 situation 3: a missing Python interpreter fails only python; nodes, TS, cpp and N→S are unchanged', async () => {
    const projectId = 's8d-a06-situation-3';
    const f = await fixture(backend, projectId, baseFiles(),
      { sourceAnalyzers: { pythonPath: '/no-such-python3' } });
    try {
      const ref = (moduleId: string): ModuleRef => ({ projectId, moduleId });
      const pin = await f.adopt([moduleDef(projectId, 'N', ['native']), moduleDef(projectId, 'S', ['src'])],
        [{ from: ref('N'), to: ref('S'), reason: 'N uses S' }]);
      const captureRef = await f.capture(MAPPINGS, 'a06-situation-3-capture');

      const page = await f.listFiles(captureRef);
      expect(page.nodes).toEqual(SITUATION1_NODES);
      // No Python edges at all; the TS edge is the only one left.
      expect(page.edges).toEqual([{ from: 'src/a.ts', to: 'src/b.ts' }]);

      expect(coverageOf(page.languages, 'python')).toEqual({
        language: 'python', files: 4, parsed: 0, edges: 'failed', reason: '分析器不可用', notes: [],
        issues: [], issueCount: 0, complete: false,
      });
      expect(coverageOf(page.languages, 'typescript')).toEqual(TYPESCRIPT_COVERAGE);
      expect(coverageOf(page.languages, 'cpp')).toEqual(CPP_NO_DATABASE);

      const comparison = await f.platform.architecture.compareFormalObserved(f.ctx, { catalog: pin, captureRef });
      expect(comparison).toMatchObject({ status: 'ready', value: { noVerdict: true } });
      if (comparison.status !== 'ready') return;
      expect(comparison.value.findings.filter(finding => finding.kind === 'unresolved')).toEqual([]);
      expect(comparison.value.findings).toContainEqual({
        kind: 'dependency_missing', moduleRef: ref('N'), path: 'native', detail: 'N→S', certainty: 'unknown',
      });
    } finally { await f.close(); }
  });

  it('A-06 pure non-TS project: python-only capture succeeds with one coverage entry and one edge', async () => {
    const projectId = 's8d-a06-pure-python';
    const f = await fixture(backend, projectId, [
      ['e.py', 'import g\nimport os\n\nprint(g.x, os.name)\n'],
      ['g.py', 'x = 1\n'],
    ]);
    try {
      const captureRef = await f.capture([], 'a06-pure-python-capture');

      const page = await f.listFiles(captureRef);
      expect(page.nodes).toEqual([
        { path: 'e.py', nonBlankLines: 3, language: 'python' },
        { path: 'g.py', nonBlankLines: 1, language: 'python' },
      ]);
      expect(page.edges).toEqual([{ from: 'e.py', to: 'g.py' }]);
      expect(page.nextCursor).toBeNull();
      expect(page.languages).toEqual([{
        language: 'python', files: 2, parsed: 2, edges: 'supported', reason: null, notes: [],
        issues: [], issueCount: 0, complete: true,
      }]);
    } finally { await f.close(); }
  });
});
