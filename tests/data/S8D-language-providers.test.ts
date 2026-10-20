import { afterEach, expect, it } from 'vitest';
import { createCppLanguageProvider, type ProjectFileGraphV1 } from '../../src/core/workspace/architecture-language-provider.js';
import type { ProjectSourceAccess } from '../../src/core/workspace/project-source-snapshot.js';
import { ready, workspaceToolsFixture } from '../helpers/workspace-tools-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A real temporary workspace behind the real permission-filtered sandbox. `sourceAnalyzers`
 * is the same trusted injection seam the composition passes in production.
 */
const fixture = workspaceToolsFixture({
  projectId: 's8d-language-providers',
  actorId: 's8d-language-providers-reader',
  permissionRevision: 's8d-language-providers-policy-v1',
  tempPrefix: 's8d-language-providers-',
  cleanups,
});

const coverageOf = (graph: ProjectFileGraphV1, language: string) => graph.languages.find(entry => entry.language === language);

it('S8D-PROV-01 fails one language without affecting another and keeps both coverages and the python edge', async () => {
  const f = await fixture([
    ['native/c.cpp', '#include "d.h"\nint f() { return g(); }\n'],
    ['native/d.h', 'int g();\n'],
    ['e.py', 'import g\n'],
    ['g.py', 'x = 1\n'],
  ]);
  const graph = ready(await f.graph());

  expect(coverageOf(graph, 'cpp')).toEqual({
    language: 'cpp', files: 2, parsed: 0, edges: 'failed', reason: '没有 compile_commands.json', notes: [], issues: [], issueCount: 0, complete: false,
  });
  expect(coverageOf(graph, 'python')).toEqual({
    language: 'python', files: 2, parsed: 2, edges: 'supported', reason: null, notes: [], issues: [], issueCount: 0, complete: true,
  });
  expect(graph.edges).toEqual([{ from: 'e.py', to: 'g.py' }]);
}, 60000);

it('S8D-PROV-02 uses the workspace-root compilation database when several exist', async () => {
  const f = await fixture([
    ['native/c.cpp', '#include "d.h"\nint f() { return g(); }\n'],
    ['native/d.h', 'int g();\n'],
    ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'native/c.cpp', arguments: ['c++', '-c', 'native/c.cpp'] }]) + '\n'],
    ['build/compile_commands.json', '[]\n'],
  ]);
  const graph = ready(await f.graph());

  expect(coverageOf(graph, 'cpp')).toEqual({
    language: 'cpp', files: 2, parsed: 2, edges: 'supported', reason: null,
    notes: ['近似：不读系统头文件和观测以外的头文件'], issues: [], issueCount: 0, complete: true,
  });
  expect(graph.edges).toEqual([{ from: 'native/c.cpp', to: 'native/d.h' }]);
}, 60000);

it('S8D-PROV-02 uses the colcon aggregate alone when its siblings are per-subdirectory databases', async () => {
  const f = await fixture([
    ['native/c.cpp', '#include "d.h"\nint f() { return g(); }\n'],
    ['native/d.h', 'int g();\n'],
    ['build/compile_commands.json', JSON.stringify([{ directory: '..', file: 'native/c.cpp', arguments: ['c++', '-c', 'native/c.cpp'] }]) + '\n'],
    ['build/pkg/compile_commands.json', '[]\n'],
  ]);
  const graph = ready(await f.graph());

  expect(coverageOf(graph, 'cpp')).toEqual({
    language: 'cpp', files: 2, parsed: 2, edges: 'supported', reason: null,
    notes: ['近似：不读系统头文件和观测以外的头文件'], issues: [], issueCount: 0, complete: true,
  });
  expect(graph.edges).toEqual([{ from: 'native/c.cpp', to: 'native/d.h' }]);
}, 60000);

it('S8D-PROV-02 merges sibling databases under one non-root directory and takes the merge note from the script', async () => {
  const f = await fixture([
    ['native/c.cpp', '#include "d.h"\nint f() { return g(); }\n'],
    ['native/d.h', 'int g();\n'],
    ['build/a/compile_commands.json', JSON.stringify([{ directory: '../..', file: 'native/c.cpp', arguments: ['c++', '-c', 'native/c.cpp'] }]) + '\n'],
    ['build/b/compile_commands.json', '[]\n'],
  ]);
  const graph = ready(await f.graph());

  expect(coverageOf(graph, 'cpp')).toEqual({
    language: 'cpp', files: 2, parsed: 2, edges: 'supported', reason: null,
    notes: ['合并了 2 个编译数据库', '近似：不读系统头文件和观测以外的头文件'],
    issues: [], issueCount: 0, complete: true,
  });
  expect(graph.edges).toEqual([{ from: 'native/c.cpp', to: 'native/d.h' }]);
}, 60000);

it('S8D-PROV-02 merges nested databases under one non-root directory', async () => {
  const f = await fixture([
    ['native/c.cpp', '#include "d.h"\nint f() { return g(); }\n'],
    ['native/d.h', 'int g();\n'],
    ['out/build/a/compile_commands.json', JSON.stringify([{ directory: '../../..', file: 'native/c.cpp', arguments: ['c++', '-c', 'native/c.cpp'] }]) + '\n'],
    ['out/build/b/compile_commands.json', '[]\n'],
  ]);
  const graph = ready(await f.graph());

  expect(coverageOf(graph, 'cpp')).toEqual({
    language: 'cpp', files: 2, parsed: 2, edges: 'supported', reason: null,
    notes: ['合并了 2 个编译数据库', '近似：不读系统头文件和观测以外的头文件'],
    issues: [], issueCount: 0, complete: true,
  });
  expect(graph.edges).toEqual([{ from: 'native/c.cpp', to: 'native/d.h' }]);
}, 60000);

it('S8D-PROV-02 leaves the merge note to the script instead of emitting it twice', async () => {
  const files = new Map<string, string>([
    ['native/c.cpp', '#include "d.h"\nint f() { return g(); }\n'],
    ['native/d.h', 'int g();\n'],
    ['build/a/compile_commands.json', JSON.stringify([{ directory: '../..', file: 'native/c.cpp', arguments: ['c++', '-c', 'native/c.cpp'] }]) + '\n'],
    ['build/b/compile_commands.json', '[]\n'],
  ]);
  const source: ProjectSourceAccess = {
    inventory: async () => ({ paths: [...files.keys()].sort(), truncated: false }),
    allowed: () => true,
    read: async path => ({ content: files.get(path)! }),
    sourceIdentity: async () => ({ workspace: 's8d-language-providers', commit: null }),
  };
  const result = await createCppLanguageProvider({ workspaceRoot: '/work', workspaceRealRoot: '/work' }).extractImports({
    source, skipped: [], configOnly: new Map(), signal: new AbortController().signal,
  });

  expect(result.coverage).toEqual({
    parsed: 2, edges: 'supported', reason: null,
    notes: ['合并了 2 个编译数据库', '近似：不读系统头文件和观测以外的头文件'],
    issues: [],
  });
  expect(result.edges).toEqual([{ from: 'native/c.cpp', to: 'native/d.h' }]);
}, 60000);

it('S8D-PROV-02 fails C/C++ when several nested compilation databases exist without a root one', async () => {
  const f = await fixture([
    ['native/c.cpp', '#include "d.h"\nint f() { return g(); }\n'],
    ['native/d.h', 'int g();\n'],
    ['build/compile_commands.json', '[]\n'],
    ['out/compile_commands.json', '[]\n'],
  ]);
  const graph = ready(await f.graph());

  expect(coverageOf(graph, 'cpp')).toEqual({
    language: 'cpp', files: 2, parsed: 0, edges: 'failed', reason: '有多个编译数据库', notes: [], issues: [], issueCount: 0, complete: false,
  });
}, 60000);

it('S8D-PROV-03 reports a missing Python interpreter as a whole-language failure and leaves TypeScript intact', async () => {
  const f = await fixture([
    ['e.py', 'import g\n'],
    ['g.py', 'x = 1\n'],
    ['src/a.ts', 'import { b } from "./b";\n'],
    ['src/b.ts', 'export const b = 1;\n'],
  ], { sourceAnalyzers: { pythonPath: '/no-such-python3' } });
  const graph = ready(await f.graph());

  expect(coverageOf(graph, 'python')).toEqual({
    language: 'python', files: 2, parsed: 0, edges: 'failed', reason: '分析器不可用', notes: [], issues: [], issueCount: 0, complete: false,
  });
  expect(coverageOf(graph, 'typescript')).toEqual({
    language: 'typescript', files: 2, parsed: 2, edges: 'supported', reason: null, notes: [], issues: [], issueCount: 0, complete: true,
  });
  expect(graph.edges).toEqual([{ from: 'src/a.ts', to: 'src/b.ts' }]);
}, 60000);

it('S8D-PROV-04 reports a missing C/C++ library as a whole-language failure and leaves Python intact', async () => {
  const f = await fixture([
    ['native/c.cpp', '#include "d.h"\nint f() { return g(); }\n'],
    ['native/d.h', 'int g();\n'],
    ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'native/c.cpp', arguments: ['c++', '-c', 'native/c.cpp'] }]) + '\n'],
    ['e.py', 'import g\n'],
    ['g.py', 'x = 1\n'],
  ], { sourceAnalyzers: { cppLibraryPath: '/no-such-libclang.so' } });
  const graph = ready(await f.graph());

  expect(coverageOf(graph, 'cpp')).toEqual({
    language: 'cpp', files: 2, parsed: 0, edges: 'failed', reason: '分析器不可用', notes: [], issues: [], issueCount: 0, complete: false,
  });
  expect(coverageOf(graph, 'python')).toEqual({
    language: 'python', files: 2, parsed: 2, edges: 'supported', reason: null, notes: [], issues: [], issueCount: 0, complete: true,
  });
  expect(graph.edges).toEqual([{ from: 'e.py', to: 'g.py' }]);
}, 60000);

it('S8D-PROV-05 parses a unit with an outside-workspace lookup directory and records the note', async () => {
  const f = await fixture([
    ['native/c.cpp', 'int f() { return 0; }\n'],
    ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'native/c.cpp', arguments: ['c++', '-I', '/etc', '-c', 'native/c.cpp'] }]) + '\n'],
  ]);
  const graph = ready(await f.graph());

  expect(coverageOf(graph, 'cpp')).toEqual({
    language: 'cpp', files: 1, parsed: 1, edges: 'supported', reason: null,
    notes: ['忽略了 1 个工作区外的查找目录', '近似：不读系统头文件和观测以外的头文件'],
    issues: [], issueCount: 0, complete: true,
  });
  expect(graph.edges).toEqual([]);
}, 60000);
