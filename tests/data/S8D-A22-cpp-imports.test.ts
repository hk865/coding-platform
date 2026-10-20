import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKENDS, fixture, type Entry, type GraphShape,
  type SourceAnalyzers } from '../helpers/S8D-platform-fixture.js';

const CPP_LIBRARY = '/usr/lib/llvm-18/lib/libclang.so.1';

const coverageOf = (graph: GraphShape, language: string) => graph.languages.find(entry => entry.language === language);
const defaultDatabase = JSON.stringify([{ directory: '.', file: 'main.cpp', arguments: ['c++', '-c', 'main.cpp'] }]);

describe.each(BACKENDS)('A-22 C/C++ includes [%s]', backend => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  /**
   * The A-06 platform fixture: real root, explicit per-file source grant,
   * captureSourceChanges -> listFiles, and unresolved specifiers read from
   * compareFormalObserved's findings. Every C/C++ case pins libclang 18.
   */
  const open = async (slug: string, entries: Entry[], sourceAnalyzers: SourceAnalyzers = {}) => {
    const f = await fixture(backend, `s8d-a22-cpp-${slug}-${backend}`, entries, {
      sourceAnalyzers: { cppLibraryPath: CPP_LIBRARY, ...sourceAnalyzers },
    });
    cleanups.push(() => f.close());
    return f;
  };

  /**
   * §11.6 〔§10 段〕: the formal comparison's `unresolved` `detail` is the bare
   * specifier when the reason is null, otherwise `<specifier>（<reason>）`
   * (full-width parentheses, §11.5).
   */
  const unresolvedDetails = async (f: Awaited<ReturnType<typeof open>>): Promise<string[]> => {
    const capture = await f.capture();
    const catalog = await f.adopt();
    const comparison = await f.platform.architecture.compareFormalObserved(f.ctx, { catalog, captureRef: capture });
    if (comparison.status !== 'ready') throw Error(`compareFormalObserved ${comparison.status}`);
    return comparison.value.findings.flatMap(finding => finding.kind === 'unresolved' ? [finding.detail] : []);
  };

  it('A-22 (a): resolves a quoted include, keeps <vector> unresolved and notes the approximation', async () => {
    const f = await open('a', [
      ['main.cpp', '#include <vector>\n#include "x.h"\n'],
      ['x.h', 'int x;\n'],
      ['compile_commands.json', defaultDatabase],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 2, parsed: 2, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'], issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([{ from: 'main.cpp', to: 'x.h' }]);
    expect(graph.unresolved).toEqual([{ from: 'main.cpp', specifier: '<vector>', reason: null }]);
    expect(await unresolvedDetails(f)).toEqual(['<vector>']);
  }, 60000);

  it('A-22 (b): a preprocessor error fails the header and drops its edges', async () => {
    const f = await open('b', [
      ['main.cpp', '#include "h.h"\n'],
      ['h.h', '#include "y.h"\n#if 1\n'],
      ['y.h', 'int y;\n'],
      ['compile_commands.json', defaultDatabase],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 3, parsed: 2, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [{ path: 'h.h', kind: 'failed', reason: '预处理出错：unterminated conditional directive' }],
      issueCount: 1, complete: false,
    });
    expect(graph.edges).toEqual([{ from: 'main.cpp', to: 'h.h' }]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);

  it('A-22 (c): #error and a syntax error do not fail the file', async () => {
    const f = await open('c', [
      ['main.cpp', '#error stop\n#include "x.h"\n}\n'],
      ['x.h', 'int x;\n'],
      ['compile_commands.json', defaultDatabase],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 2, parsed: 2, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'], issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([{ from: 'main.cpp', to: 'x.h' }]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);

  it('A-22 (d): expands a defined include macro and reports an undefined one', async () => {
    // -DHDR="x.h" is one argument, so the macro expands to the quoted name.
    const f = await open('d', [
      ['main.cpp', '#include HDR\n#include NOPE\n'],
      ['x.h', 'int x;\n'],
      ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'main.cpp',
        arguments: ['c++', '-DHDR="x.h"', '-c', 'main.cpp'] }])],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 2, parsed: 2, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'], issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([{ from: 'main.cpp', to: 'x.h' }]);
    expect(graph.unresolved).toEqual([{ from: 'main.cpp', specifier: 'NOPE', reason: 'include 后面跟宏' }]);
    expect(await unresolvedDetails(f)).toEqual(['NOPE（include 后面跟宏）']);
  }, 60000);

  it('A-22 (e): an angled include found only by the quoted fallback stays unresolved', async () => {
    const f = await open('e', [
      ['src/main.cpp', '#include <local.h>\n'],
      ['src/local.h', '#include "z.h"\n'],
      ['src/z.h', 'int z;\n'],
      ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'src/main.cpp',
        arguments: ['c++', '-c', 'src/main.cpp'] }])],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 3, parsed: 1, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [
        { path: 'src/local.h', kind: 'skipped', reason: '没有编译单元包含它' },
        { path: 'src/z.h', kind: 'skipped', reason: '没有编译单元包含它' },
      ],
      issueCount: 2, complete: false,
    });
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([{ from: 'src/main.cpp', specifier: '<local.h>', reason: '尖括号引用只能按引号规则找到' }]);
    expect(await unresolvedDetails(f)).toEqual(['<local.h>（尖括号引用只能按引号规则找到）']);
  }, 60000);

  it('A-22 (f): records an include inside a function body', async () => {
    const f = await open('f', [
      ['main.cpp', 'void f() {\n#include "f.h"\n}\n'],
      ['f.h', 'int x = 1;\n'],
      ['compile_commands.json', defaultDatabase],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 2, parsed: 2, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'], issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([{ from: 'main.cpp', to: 'f.h' }]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);

  it('A-22 (g): ignores an outside lookup directory and notes it', async () => {
    const f = await open('g', [
      ['main.cpp', '#include "o.h"\n'],
      ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'main.cpp',
        arguments: ['c++', '-I/outside', '-c', 'main.cpp'] }])],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 1, parsed: 1, edges: 'supported', reason: null,
      notes: ['忽略了 1 个工作区外的查找目录', '近似：不读系统头文件和观测以外的头文件'],
      issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([{ from: 'main.cpp', specifier: '"o.h"', reason: null }]);
    expect(await unresolvedDetails(f)).toEqual(['"o.h"']);
  }, 60000);

  it('A-22 (h): a disabled conditional branch contributes no edge', async () => {
    const f = await open('h', [
      ['main.cpp', '#if 0\n#include "x.h"\n#endif\n'],
      ['x.h', 'int x;\n'],
      ['compile_commands.json', defaultDatabase],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 2, parsed: 1, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [{ path: 'x.h', kind: 'skipped', reason: '没有编译单元包含它' }],
      issueCount: 1, complete: false,
    });
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);

  it('A-22 (i): starts one unit per deduplicated entry and merges per-file results', async () => {
    const wrappers = await mkdtemp(join(tmpdir(), 's8d-a22-i-wrapper-'));
    cleanups.push(() => rm(wrappers, { recursive: true, force: true }));
    const counter = join(wrappers, 'starts.txt');
    const wrapper = join(wrappers, 'python3-wrapper');
    await writeFile(wrapper, `#!/usr/bin/python3
import json
import subprocess
import sys
COUNTER = ${JSON.stringify(counter)}
data = sys.stdin.buffer.read()
proc = subprocess.run(['/usr/bin/python3'] + sys.argv[1:], input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
count = 0
for line in proc.stdout.splitlines(True):
    sys.stdout.buffer.write(line)
    try:
        message = json.loads(line)
    except Exception:
        continue
    if isinstance(message, dict) and message.get('t') == 'start':
        count += 1
sys.stdout.buffer.flush()
with open(COUNTER, 'w') as handle:
    handle.write(str(count) + '\\n')
sys.exit(proc.returncode)
`);
    await chmod(wrapper, 0o755);

    const f = await open('i', [
      ['a.cpp', '#include "h.h"\n'],
      ['b.cpp', '#include "h.h"\n'],
      ['h.h', '#ifdef A\n#if FOO(1)\n#endif\n#endif\n#include "k.h"\n'],
      ['k.h', 'int k;\n'],
      ['compile_commands.json', JSON.stringify([
        { directory: '.', file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp', '-DA'] },
        { directory: '.', file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp'] },
        { directory: '.', file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp'] },
      ])],
    ], { pythonPath: wrapper });
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 4, parsed: 4, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'], issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([
      { from: 'a.cpp', to: 'h.h' },
      { from: 'b.cpp', to: 'h.h' },
      { from: 'h.h', to: 'k.h' },
    ]);
    expect(graph.unresolved).toEqual([]);
    // The duplicate b.cpp entry is deduplicated, so exactly two units start.
    expect((await readFile(counter, 'utf8')).trim()).toBe('2');
  }, 60000);

  it('A-22 (j): notes a unit whose main file is not observed', async () => {
    const f = await open('j', [
      ['main.cpp', '#include "x.h"\n'],
      ['x.h', 'int x;\n'],
      ['compile_commands.json', JSON.stringify([
        { directory: '.', file: 'main.cpp', arguments: ['c++', '-c', 'main.cpp'] },
        { directory: '.', file: 'gen/x.cpp', arguments: ['c++', '-c', 'gen/x.cpp'] },
      ])],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 2, parsed: 2, edges: 'supported', reason: null,
      notes: ['1 个编译单元的主文件不在观测的文件里', '近似：不读系统头文件和观测以外的头文件'],
      issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([{ from: 'main.cpp', to: 'x.h' }]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);

  it('A-22 (k): the S8D-CPP-01 fixture fails the unparseable unit and skips the orphan header', async () => {
    const f = await open('k', [
      ['include/used.hpp', '#pragma once\nint used();\n'],
      ['include/orphan.hpp', '#pragma once\nint orphan();\n'],
      ['src/main.cpp', '#include "used.hpp"\nint main() { return 0; }\n'],
      ['src/broken.cpp', 'int broken( { return 1; }\n'],
    ]);
    // The original fixture's absolute paths, written once the temporary root is known.
    await f.write('compile_commands.json', JSON.stringify([
      { directory: f.root, file: join(f.root, 'src/main.cpp'),
        arguments: ['clang++', '-std=c++20', '-I', join(f.root, 'include'), '-c', 'src/main.cpp', '-o', 'src/main.cpp.o'] },
      { directory: f.root, file: join(f.root, 'src/broken.cpp'),
        arguments: ['clang++', '--target=bogus', '-std=c++20', '-I', join(f.root, 'include'), '-c', 'src/broken.cpp', '-o', 'src/broken.cpp.o'] },
    ]));
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 4, parsed: 2, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [
        { path: 'include/orphan.hpp', kind: 'skipped', reason: '有编译单元没有做完' },
        { path: 'src/broken.cpp', kind: 'failed', reason: 'libclang 解析不了（code 1）' },
      ],
      issueCount: 2, complete: false,
    });
    expect(graph.edges).toEqual([{ from: 'src/main.cpp', to: 'include/used.hpp' }]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);

  it('A-22 (l): a semantic error in a header no longer fails it and keeps the edge', async () => {
    const f = await open('l', [
      ['include/bad.hpp', '#pragma once\nint value = undeclared_name;\n'],
      ['src/main.cpp', '#include "bad.hpp"\nint main() { return 0; }\n'],
    ]);
    await f.write('compile_commands.json', JSON.stringify([
      { directory: f.root, file: join(f.root, 'src/main.cpp'),
        arguments: ['clang++', '-std=c++20', '-I', join(f.root, 'include'), '-c', 'src/main.cpp', '-o', 'src/main.cpp.o'] },
    ]));
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 2, parsed: 2, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'], issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([{ from: 'src/main.cpp', to: 'include/bad.hpp' }]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);

  it('A-22 (m): an angled fallback that finds the including file itself stays unresolved', async () => {
    const f = await open('m', [
      ['main.cpp', '#include "uv/errno.h"\n'],
      ['uv/errno.h', '#ifndef E_H\n#define E_H\n#include <errno.h>\n#endif\n'],
      ['compile_commands.json', defaultDatabase],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 2, parsed: 2, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'], issues: [], issueCount: 0, complete: true,
    });
    expect(graph.edges).toEqual([{ from: 'main.cpp', to: 'uv/errno.h' }]);
    expect(graph.unresolved).toEqual([{ from: 'uv/errno.h', specifier: '<errno.h>', reason: null }]);
    expect(await unresolvedDetails(f)).toEqual(['<errno.h>']);
  }, 60000);

  it('A-22 (n): separates source files absent from the database from unread headers', async () => {
    const f = await open('n', [
      ['main.cpp', '#include "x.h"\n'],
      ['x.h', 'int x;\n'],
      ['orphan.cpp', 'int o;\n'],
      ['orphan.h', 'int p;\n'],
      ['compile_commands.json', defaultDatabase],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 4, parsed: 2, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [
        { path: 'orphan.cpp', kind: 'skipped', reason: '源文件不在编译数据库里' },
        { path: 'orphan.h', kind: 'skipped', reason: '没有编译单元包含它' },
      ],
      issueCount: 2, complete: false,
    });
    expect(graph.edges).toEqual([{ from: 'main.cpp', to: 'x.h' }]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);

  it('A-22 (o): a completed unit with a preprocessing error is not an unfinished unit', async () => {
    const f = await open('o', [
      ['main.cpp', '#if 1\n'],
      ['orphan.h', 'int p;\n'],
      ['compile_commands.json', defaultDatabase],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 2, parsed: 0, edges: 'supported', reason: null,
      notes: ['近似：不读系统头文件和观测以外的头文件'],
      issues: [
        { path: 'main.cpp', kind: 'failed', reason: '预处理出错：unterminated conditional directive' },
        { path: 'orphan.h', kind: 'skipped', reason: '没有编译单元包含它' },
      ],
      issueCount: 2, complete: false,
    });
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);

  it('A-22 (p): a trailing comment on a macro include is not part of the specifier', async () => {
    const f = await open('p', [
      ['main.cpp', '#include HDR // note\n#include NOPE // n\n'],
      ['x.h', 'int x;\n'],
      ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'main.cpp',
        arguments: ['c++', '-DHDR="x.h"', '-c', 'main.cpp'] }])],
    ]);
    const graph = await f.graph();

    expect(graph.edges).toEqual([{ from: 'main.cpp', to: 'x.h' }]);
    expect(graph.unresolved).toEqual([{ from: 'main.cpp', specifier: 'NOPE', reason: 'include 后面跟宏' }]);
  }, 60000);

  it('A-22 (q): a block comment before a quoted include keeps the quotes', async () => {
    const f = await open('q', [
      ['main.cpp', '#include /*c*/ "missing.h"\n'],
      ['compile_commands.json', defaultDatabase],
    ]);
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toMatchObject({ files: 1, parsed: 1 });
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([{ from: 'main.cpp', specifier: '"missing.h"', reason: null }]);
  }, 60000);

  it('A-22 (r): a block comment longer than 400 bytes before a macro include keeps the edge', async () => {
    const filler = 'x'.repeat(450);
    const f = await open('r', [
      ['main.cpp', `#include /*${filler}*/ HDR\n`],
      ['x.h', 'int x;\n'],
      ['compile_commands.json', JSON.stringify([{ directory: '.', file: 'main.cpp',
        arguments: ['c++', '-DHDR="x.h"', '-c', 'main.cpp'] }])],
    ]);
    const graph = await f.graph();

    expect(graph.edges).toEqual([{ from: 'main.cpp', to: 'x.h' }]);
    expect(graph.unresolved).toEqual([]);
  }, 60000);
});
