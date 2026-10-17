/**
 * Slice 8D acceptance entry A-23 (spec §11.6): C/C++ configuration and
 * argument handling over the SAME public platform fixture A-06 uses
 * (`tests/helpers/S8D-platform-fixture.ts`). Every case runs on memory and
 * SQLite, observes through `captureSourceChanges` -> `listFiles`, and asserts
 * only the literal expectations frozen in §11.6.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { GraphShape, PlatformFixture } from '../helpers/S8D-platform-fixture.js';
import { BACKENDS, fixture } from '../helpers/S8D-platform-fixture.js';

const CPP_LIBRARY = '/usr/lib/llvm-18/lib/libclang.so.1';

const open: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of open.splice(0).reverse()) await f.close();
});

const make = async (backend: (typeof BACKENDS)[number], projectId: string,
  entries: Parameters<typeof fixture>[2]) => {
  const f = await fixture(backend, projectId, entries, {
    sourceAnalyzers: { cppLibraryPath: CPP_LIBRARY },
  });
  open.push(f);
  return f;
};

const coverageOf = (graph: GraphShape, language: string) =>
  graph.languages.find(entry => entry.language === language);
const defaultDatabase = JSON.stringify([{ directory: '.', file: 'main.cpp', arguments: ['c++', '-c', 'main.cpp'] }]);
const mainSource = 'int m;\n';

describe.each(BACKENDS)('A-23 C/C++ configuration and arguments [%s]', backend => {
  it('A-23 hint: CMake is offered when CMakeLists.txt exists and no database does', async () => {
    const f = await make(backend, `s8d-a23-cpp-cmake-hint-${backend}`, [
      ['main.cpp', mainSource],
      ['CMakeLists.txt', 'project(p)\n'],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 0, edges: 'failed',
      reason: '没有 compile_commands.json；可以用 cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON 生成',
      notes: [], issues: [], issueCount: 0, complete: false,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 hint: colcon wins over the CMake hint when package.xml exists', async () => {
    const f = await make(backend, `s8d-a23-cpp-colcon-hint-${backend}`, [
      ['pkg/a.cpp', mainSource],
      ['pkg/package.xml', '<package/>\n'],
      ['pkg/CMakeLists.txt', 'project(p)\n'],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 0, edges: 'failed',
      reason: '没有 compile_commands.json；可以用 colcon build --cmake-args -DCMAKE_EXPORT_COMPILE_COMMANDS=ON 生成',
      notes: [], issues: [], issueCount: 0, complete: false,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 multiple: two databases with different parents fail the language', async () => {
    const f = await make(backend, `s8d-a23-cpp-two-nonroot-${backend}`, [
      ['main.cpp', mainSource],
      ['a/compile_commands.json', '[]\n'],
      ['b/compile_commands.json', '[]\n'],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 0, edges: 'failed', reason: '有多个编译数据库',
      notes: [], issues: [], issueCount: 0, complete: false,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 merge: two database subdirectories under one parent are merged', async () => {
    const f = await make(backend, `s8d-a23-cpp-merge-${backend}`, [
      ['dbs/p1/compile_commands.json', JSON.stringify([{ directory: '../../p1', file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp'] }])],
      ['dbs/p2/compile_commands.json', JSON.stringify([{ directory: '../../p2', file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp'] }])],
      ['p1/a.cpp', '#include "a.h"\n'],
      ['p1/a.h', 'int a;\n'],
      ['p2/b.cpp', '#include "b.h"\n'],
      ['p2/b.h', 'int b;\n'],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 4, parsed: 4, edges: 'supported', reason: null,
      notes: ['合并了 2 个编译数据库', '近似：不读系统头文件和观测以外的头文件'],
      issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([
      { from: 'p1/a.cpp', to: 'p1/a.h' },
      { from: 'p2/b.cpp', to: 'p2/b.h' },
    ]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);

  it('A-23 merge: a nested non-root B (out/build) merges its subdirectories', async () => {
    const f = await make(backend, `s8d-a23-cpp-nested-b-${backend}`, [
      ['out/build/a/compile_commands.json', JSON.stringify([{ directory: '.', file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp'] }])],
      ['out/build/b/compile_commands.json', JSON.stringify([{ directory: '.', file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp'] }])],
      ['out/build/a/a.cpp', '#include "a.h"\n'],
      ['out/build/a/a.h', 'int a;\n'],
      ['out/build/b/b.cpp', '#include "b.h"\n'],
      ['out/build/b/b.h', 'int b;\n'],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 4, parsed: 4, edges: 'supported', reason: null,
      notes: ['合并了 2 个编译数据库', '近似：不读系统头文件和观测以外的头文件'],
      issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([
      { from: 'out/build/a/a.cpp', to: 'out/build/a/a.h' },
      { from: 'out/build/b/b.cpp', to: 'out/build/b/b.h' },
    ]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);

  it('A-23 multiple: moving the second database to another parent stops the merge', async () => {
    const f = await make(backend, `s8d-a23-cpp-split-parent-${backend}`, [
      ['dbs/p1/compile_commands.json', JSON.stringify([{ directory: '../../p1', file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp'] }])],
      ['other/p2/compile_commands.json', JSON.stringify([{ directory: '../../p2', file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp'] }])],
      ['p1/a.cpp', '#include "a.h"\n'],
      ['p1/a.h', 'int a;\n'],
      ['p2/b.cpp', '#include "b.h"\n'],
      ['p2/b.h', 'int b;\n'],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 4, parsed: 0, edges: 'failed', reason: '有多个编译数据库',
      notes: [], issues: [], issueCount: 0, complete: false,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 merge: the aggregate colcon database is used alone', async () => {
    const f = await make(backend, `s8d-a23-cpp-aggregate-${backend}`, [
      ['dbs/p1/compile_commands.json', JSON.stringify([{ directory: '../../p1', file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp'] }])],
      ['dbs/p2/compile_commands.json', JSON.stringify([{ directory: '../../p2', file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp'] }])],
      ['dbs/compile_commands.json', JSON.stringify([
        { directory: '../p1', file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp'] },
        { directory: '../p2', file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp'] },
      ])],
      ['p1/a.cpp', '#include "a.h"\n'],
      ['p1/a.h', 'int a;\n'],
      ['p2/b.cpp', '#include "b.h"\n'],
      ['p2/b.h', 'int b;\n'],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 4, parsed: 4, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([
      { from: 'p1/a.cpp', to: 'p1/a.h' },
      { from: 'p2/b.cpp', to: 'p2/b.h' },
    ]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);

  it('A-23 database: an unreadable root database wins and fails the language', async () => {
    const f = await make(backend, `s8d-a23-cpp-binary-root-${backend}`, [
      ['main.cpp', mainSource],
      ['compile_commands.json', new Uint8Array([0x5b, 0x00, 0x5d, 0x0a])],
      ['build/compile_commands.json', '[]\n'],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 0, edges: 'failed',
      reason: 'compile_commands.json 读不了：binary source',
      notes: [], issues: [], issueCount: 0, complete: false,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 database: {} is rejected as not being an array', async () => {
    const f = await make(backend, `s8d-a23-cpp-not-array-${backend}`, [
      ['main.cpp', mainSource],
      ['compile_commands.json', '{}\n'],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 0, edges: 'failed', reason: '配置错误：compile_commands.json 不是数组',
      notes: [], issues: [], issueCount: 0, complete: false,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 entry: the first entry without file is named by its number', async () => {
    const f = await make(backend, `s8d-a23-cpp-entry-${backend}`, [
      ['main.cpp', mainSource],
      ['compile_commands.json', JSON.stringify([{ directory: '.', arguments: ['c++', '-c', 'main.cpp'] }])],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 0, edges: 'failed', reason: '配置错误：compile_commands.json 的第 1 条没有 file',
      notes: [], issues: [], issueCount: 0, complete: false,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 argument: -Xclang fails only its own unit while the other parses', async () => {
    const f = await make(backend, `s8d-a23-cpp-xclang-${backend}`, [
      ['main.cpp', mainSource],
      ['b.cpp', 'int b;\n'],
      ['compile_commands.json', JSON.stringify([
        { directory: '.', file: 'main.cpp', arguments: ['c++', '-c', 'main.cpp', '-Xclang', '-load'] },
        { directory: '.', file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp'] },
      ])],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 2, parsed: 1, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [{ path: 'main.cpp', kind: 'failed', reason: '不认识的编译参数：-Xclang' }],
      issueCount: 1, complete: false,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 argument: a bare -load names the parameter without its value', async () => {
    const f = await make(backend, `s8d-a23-cpp-load-${backend}`, [
      ['main.cpp', mainSource],
      ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'main.cpp',
        arguments: ['c++', '-c', 'main.cpp', '-load', 'x'] }])],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 0, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [{ path: 'main.cpp', kind: 'failed', reason: '不认识的编译参数：-load' }],
      issueCount: 1, complete: false,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 argument: -march=native is ignored with a note while -o and -c are not listed', async () => {
    const f = await make(backend, `s8d-a23-cpp-march-${backend}`, [
      ['main.cpp', mainSource],
      ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'main.cpp',
        arguments: ['c++', '-march=native', '-o', 'x.o', '-c', 'main.cpp'] }])],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 1, edges: 'supported', reason: null,
      notes: ['忽略的编译参数：-march=native', '近似：不读系统头文件和观测以外的头文件'],
      issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 argument: an unreadable forced include is ignored with a count note', async () => {
    const f = await make(backend, `s8d-a23-cpp-forced-include-${backend}`, [
      ['main.cpp', mainSource],
      ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'main.cpp',
        arguments: ['c++', '-include', '/nonexistent/pch.hxx', '-c', 'main.cpp'] }])],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 1, edges: 'supported', reason: null,
      notes: ['忽略了 1 个读不到的强制包含文件', '近似：不读系统头文件和观测以外的头文件'],
      issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 path: an outside directory with an absolute workspace main file still parses', async () => {
    const f = await make(backend, `s8d-a23-cpp-absolute-${backend}`, [
      ['main.cpp', mainSource],
    ]);
    await f.write('compile_commands.json', JSON.stringify([{ directory: '/tmp', file: join(f.root, 'main.cpp'),
      arguments: ['c++', '-c', join(f.root, 'main.cpp')] }]));
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 1, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 compiler: ccache is refused by file name', async () => {
    const f = await make(backend, `s8d-a23-cpp-ccache-${backend}`, [
      ['main.cpp', mainSource],
      ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'main.cpp',
        arguments: ['ccache', 'c++', '-c', 'main.cpp'] }])],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 0, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [{ path: 'main.cpp', kind: 'failed', reason: '不认识的编译器：ccache' }],
      issueCount: 1, complete: false,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 command: a POSIX-split command line parses', async () => {
    const f = await make(backend, `s8d-a23-cpp-command-${backend}`, [
      ['main.cpp', mainSource],
      ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'main.cpp', command: 'c++ -DX=1 -c main.cpp' }])],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 1, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 command: an unclosed quote fails the unit', async () => {
    const f = await make(backend, `s8d-a23-cpp-quote-${backend}`, [
      ['main.cpp', mainSource],
      ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'main.cpp', command: "c++ 'unclosed -c main.cpp" }])],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 0, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [{ path: 'main.cpp', kind: 'failed', reason: '编译命令拆不开' }],
      issueCount: 1, complete: false,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 argument: an extra positional is refused', async () => {
    const f = await make(backend, `s8d-a23-cpp-positional-${backend}`, [
      ['main.cpp', mainSource],
      ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'main.cpp',
        arguments: ['c++', '-c', 'main.cpp', 'other.cpp'] }])],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 0, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [{ path: 'main.cpp', kind: 'failed', reason: '不认识的编译参数：多出的位置参数' }],
      issueCount: 1, complete: false,
    });
    expect(graph.edges).toEqual([]);
  }, 60000);

  it('A-23 conditional: the default target keeps the linux branch on any host', async () => {
    const f = await make(backend, `s8d-a23-cpp-target-${backend}`, [
      ['main.cpp', '#if defined(__x86_64__) && defined(__linux__)\n#include "x.h"\n#endif\n'],
      ['x.h', 'int x;\n'],
      ['compile_commands.json', defaultDatabase],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 2, parsed: 2, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([{ from: 'main.cpp', to: 'x.h' }]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);
});
