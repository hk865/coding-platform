import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { createWorkspaceAccessFactory, type WorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import type { WorkspaceResult } from '../../src/core/workspace/ports.js';
import { createCppLanguageProvider, type ProjectFileGraphV1 } from '../../src/core/workspace/architecture-language-provider.js';
import type { ProjectSourceAccess } from '../../src/core/workspace/project-source-snapshot.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function ready<T>(result: WorkspaceResult<T>): T {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw Error(`${result.code}: ${result.reason}`);
  return result.value;
}

type Entry = [path: string, content: string | Uint8Array];
type SourceAnalyzers = { directory?: string; pythonPath?: string; cppLibraryPath?: string };

/**
 * A real temporary workspace behind the real permission-filtered sandbox, using the
 * explicit test grant pattern of `tests/data/S8A-file-graph.test.ts`. `sourceAnalyzers`
 * is the same trusted injection seam the composition passes in production.
 */
async function fixture(entries: Entry[], options: { sourceAnalyzers?: SourceAnalyzers } = {}) {
  const root = await mkdtemp(join(tmpdir(), 's8d-language-providers-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const files = new Map<string, string | Uint8Array>(entries);
  for (const [path, content] of entries) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: 's8d-language-providers', workspaceId: 'main' };
  const workspaceRevision = 1;
  const actor = { kind: 'human' as const, id: 's8d-language-providers-reader' };
  const access: WorkspaceAccessFactory = createWorkspaceAccessFactory({
    resolveRoot: async requested => requested.projectId === workspace.projectId && requested.workspaceId === workspace.workspaceId
      ? { status: 'ready', value: { root, workspaceRevision } }
      : { status: 'rejected', code: 'not_found', reason: 'unknown test workspace' },
    authorize: async (ctx, requested) => {
      if (requested.projectId !== workspace.projectId || requested.workspaceId !== workspace.workspaceId ||
          ctx.projectId !== workspace.projectId || ctx.workspaceId !== workspace.workspaceId ||
          ctx.principal.kind !== 'host' || ctx.principal.actor.id !== actor.id ||
          ctx.materialReader.kind !== 'host' || ctx.materialReader.projectId !== workspace.projectId ||
          ctx.materialReader.workspaceId !== workspace.workspaceId || ctx.materialReader.actor.id !== actor.id)
        return { status: 'rejected', code: 'forbidden', reason: 'no matching explicit test grant' };
      return { status: 'ready', value: {
        subjectKey: canonicalJson(['host', actor]), permissionRevision: 's8d-language-providers-policy-v1',
        allowsRead: path => files.has(path),
      } };
    },
  });
  const handle = createWorkspaceTools({
    access, now: () => '2026-10-17T00:00:00.000Z', limits: DEFAULT_WORKSPACE_LIMITS,
    ...(options.sourceAnalyzers === undefined ? {} : { sourceAnalyzers: options.sourceAnalyzers }),
  });
  cleanups.push(() => handle.close());
  const context: CoreCallContext = {
    projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor },
    signal: new AbortController().signal,
  };
  const capture = async () => ready(await handle.tools.captureObservation(context, {
    workspace, workspaceRevision, provider: 'typescript',
  }));
  const graph = async () => {
    const captured = await capture();
    return ready(await handle.tools.captureFileGraph(context, { capture: captured.ref }));
  };
  return { root, workspace, files, handle, context, capture, graph };
}

const coverageOf = (graph: ProjectFileGraphV1, language: string) => graph.languages.find(entry => entry.language === language);

it('S8D-PROV-01 fails one language without affecting another and keeps both coverages and the python edge', async () => {
  const f = await fixture([
    ['native/c.cpp', '#include "d.h"\nint f() { return g(); }\n'],
    ['native/d.h', 'int g();\n'],
    ['e.py', 'import g\n'],
    ['g.py', 'x = 1\n'],
  ]);
  const graph = await f.graph();

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
  const graph = await f.graph();

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
  const graph = await f.graph();

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
  const graph = await f.graph();

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
  const graph = await f.graph();

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
  const graph = await f.graph();

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
  const graph = await f.graph();

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
  const graph = await f.graph();

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
  const graph = await f.graph();

  expect(coverageOf(graph, 'cpp')).toEqual({
    language: 'cpp', files: 1, parsed: 1, edges: 'supported', reason: null,
    notes: ['忽略了 1 个工作区外的查找目录', '近似：不读系统头文件和观测以外的头文件'],
    issues: [], issueCount: 0, complete: true,
  });
  expect(graph.edges).toEqual([]);
}, 60000);
