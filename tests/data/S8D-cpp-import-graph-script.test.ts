import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Direct tracer tests for `scripts/cpp-source-query.py import_graph` (slice-8
 * §11.4 / §11.5). They speak the NDJSON protocol of the TS executor: one
 * header line, one line per frozen file, then EOF. Every case builds its own
 * workspace-equivalent header; paths never touch the disk, so `workspaceRoot`
 * is only the lexical root the executor would pass.
 */
const SCRIPT = resolve(import.meta.dirname, '../../scripts/cpp-source-query.py');
const LIB = '/usr/lib/llvm-18/lib/libclang.so.1';
const ROOT = '/tmp/s8d-cpp-import-graph-workspace';
const CPP = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|inc|ipp|inl|tcc)$/i;

type DbEntry = { directory: string; file: string; arguments?: string[]; command?: string };
type FileResult = { path: string; status: 'parsed' | 'failed'; reason?: string };
type Done = { t: 'done'; i: number; files: FileResult[]; edges: Array<[string, string, string]>; unresolved: Array<{ from: string; specifier: string; reason: string | null }> };
type Line = { t: string } & Record<string, unknown>;
type Config = {
  files: Record<string, string>;
  paths?: string[];
  databases?: Array<{ path: string; content: string }>;
  resumeFrom?: number;
  libraryPath?: string;
  workspaceRoot?: string | null;
  workspaceRealRoot?: string | null;
};

const rootDb = (entries: unknown[]) => [{ path: 'compile_commands.json', content: JSON.stringify(entries) }];
const dbAt = (path: string, entries: unknown[]) => ({ path, content: JSON.stringify(entries) });
const unit = (file: string, extra: string[] = [], directory = '.') => ({ directory, file, arguments: ['c++', '-c', file, ...extra] });
const absoluteUnit = (file: string, extra: string[] = []) => ({
  directory: ROOT, file: `${ROOT}/${file}`,
  arguments: ['clang++', '-std=c++20', '-I', `${ROOT}/include`, '-c', file, ...extra],
});
const claimed = (files: Record<string, string>) => Object.keys(files).filter(path => CPP.test(path));

async function run(config: Config) {
  const header = {
    t: 'header', v: 1, paths: config.paths ?? claimed(config.files),
    config: {
      libraryPath: config.libraryPath ?? LIB, databases: config.databases ?? [],
      workspaceRoot: config.workspaceRoot === undefined ? ROOT : config.workspaceRoot,
      workspaceRealRoot: config.workspaceRealRoot === undefined ? ROOT : config.workspaceRealRoot,
    },
    resumeFrom: config.resumeFrom ?? 0,
  };
  const input = [JSON.stringify(header), ...Object.entries(config.files).map(([path, content]) => JSON.stringify({ t: 'file', path, content }))].join('\n') + '\n';
  const child = spawn('python3', ['-I', '-S', SCRIPT, 'import_graph'], { env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exited = new Promise<number | null>((resolveExit, rejectExit) => {
    child.on('error', rejectExit);
    child.on('close', code => resolveExit(code));
  });
  child.stdin.end(input);
  const code = await exited;
  if (code !== 0) throw Error(`script exited ${code}: ${stderr}`);
  const lines = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line) as Line);
  return {
    lines, stderr,
    ready: lines.find(line => line.t === 'ready') as (Line & { engine: string; engineVersion: string; units: string[]; notes: string[] }) | undefined,
    done: (i = 0) => lines.find(line => line.t === 'done' && line.i === i) as unknown as Done | undefined,
    failed: lines.find(line => line.t === 'failed') as (Line & { reason: string }) | undefined,
    unavailable: lines.find(line => line.t === 'unavailable') as (Line & { message: string }) | undefined,
    ended: lines.some(line => line.t === 'end'),
  };
}

it('A-22 (a) reads a quoted header and leaves an unavailable system header unresolved', async () => {
  const result = await run({
    files: { 'main.cpp': '#include <vector>\n#include "x.h"\n', 'x.h': '' },
    databases: rootDb([unit('main.cpp')]),
  });
  expect(result.ready).toMatchObject({ engine: 'libclang', engineVersion: expect.stringContaining('18.'), units: ['main.cpp'], notes: [] });
  expect(result.done(0)).toEqual({
    t: 'done', i: 0,
    files: [{ path: 'main.cpp', status: 'parsed' }, { path: 'x.h', status: 'parsed' }],
    edges: [['main.cpp', 'x.h', '"x.h"']],
    unresolved: [{ from: 'main.cpp', specifier: '<vector>', reason: null }],
  });
  expect(result.ended).toBe(true);
});

it('A-22 (b) fails only the header with an unterminated conditional and drops its edge', async () => {
  const result = await run({
    files: { 'main.cpp': '#include "h.h"\n', 'h.h': '#include "y.h"\n#if 1\n', 'y.h': '' },
    databases: rootDb([unit('main.cpp')]),
  });
  expect(result.done(0)?.files).toEqual([
    { path: 'h.h', status: 'failed', reason: '预处理出错：unterminated conditional directive' },
    { path: 'main.cpp', status: 'parsed' },
    { path: 'y.h', status: 'parsed' },
  ]);
  expect(result.done(0)?.edges).toEqual([['main.cpp', 'h.h', '"h.h"']]);
  expect(result.done(0)?.unresolved).toEqual([]);
});

it('A-22 (c) does not fail a file for #error or for ordinary syntax errors', async () => {
  const result = await run({
    files: { 'main.cpp': '#error stop\n#include "x.h"\n}\n', 'x.h': '' },
    databases: rootDb([unit('main.cpp')]),
  });
  expect(result.done(0)?.files).toEqual([{ path: 'main.cpp', status: 'parsed' }, { path: 'x.h', status: 'parsed' }]);
  expect(result.done(0)?.edges).toEqual([['main.cpp', 'x.h', '"x.h"']]);
});

it('A-22 (f) keeps an include inside a function body with SkipFunctionBodies', async () => {
  const result = await run({
    files: { 'main.cpp': 'void f() {\n#include "f.h"\n}\n', 'f.h': 'int x = 1;\n' },
    databases: rootDb([unit('main.cpp')]),
  });
  expect(result.done(0)?.files).toEqual([{ path: 'f.h', status: 'parsed' }, { path: 'main.cpp', status: 'parsed' }]);
  expect(result.done(0)?.edges).toEqual([['main.cpp', 'f.h', '"f.h"']]);
});

it('A-22 (i) merges per-unit results and starts each deduplicated unit once', async () => {
  const result = await run({
    files: {
      'a.cpp': '#include "h.h"\n', 'b.cpp': '#include "h.h"\n',
      'h.h': '#ifdef A\n#if FOO(1)\n#endif\n#endif\n#include "k.h"\n', 'k.h': '',
    },
    databases: rootDb([
      { directory: '.', file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp', '-DA'] },
      unit('b.cpp'), unit('b.cpp'),
    ]),
  });
  expect(result.ready?.units).toEqual(['a.cpp', 'b.cpp']);
  expect(result.lines.filter(line => line.t === 'start')).toEqual([{ t: 'start', i: 0, path: 'a.cpp' }, { t: 'start', i: 1, path: 'b.cpp' }]);
  expect(result.done(0)?.files).toEqual(expect.arrayContaining([{ path: 'h.h', status: 'failed', reason: expect.stringContaining('预处理出错：') }]));
  expect(result.done(1)?.files).toEqual(expect.arrayContaining([{ path: 'h.h', status: 'parsed' }, { path: 'k.h', status: 'parsed' }]));
  expect(result.done(0)?.edges).toEqual([['a.cpp', 'h.h', '"h.h"']]);
  expect(result.done(1)?.edges).toEqual([['b.cpp', 'h.h', '"h.h"'], ['h.h', 'k.h', '"k.h"']]);
});

it('A-22 includes .def and extensionless text files as headers, not as claimed files', async () => {
  const result = await run({
    files: { 'main.cpp': '#include "defs.def"\n#include "EXTRA"\n', 'defs.def': '#define X 1\n', 'EXTRA': 'int extra;\n' },
    databases: rootDb([unit('main.cpp')]),
  });
  expect(result.ready?.units).toEqual(['main.cpp']);
  expect(result.done(0)?.files).toEqual([{ path: 'main.cpp', status: 'parsed' }]);
  expect(result.done(0)?.edges).toEqual([
    ['main.cpp', 'EXTRA', '"EXTRA"'],
    ['main.cpp', 'defs.def', '"defs.def"'],
  ]);
});

it('A-22 does not emit a self-edge for an ordinary self include', async () => {
  const result = await run({
    files: { 'main.cpp': '#ifndef M_H\n#define M_H\n#include "main.cpp"\n#endif\n' },
    databases: rootDb([unit('main.cpp')]),
  });
  expect(result.done(0)?.files).toEqual([{ path: 'main.cpp', status: 'parsed' }]);
  expect(result.done(0)?.edges).toEqual([]);
  expect(result.done(0)?.unresolved).toEqual([]);
});

it('resumes from the requested unit without repeating earlier units', async () => {
  const result = await run({
    files: { 'a.cpp': 'int a;\n', 'b.cpp': 'int b;\n' },
    databases: rootDb([unit('a.cpp'), unit('b.cpp')]),
    resumeFrom: 1,
  });
  expect(result.ready?.units).toEqual(['a.cpp', 'b.cpp']);
  expect(result.lines.filter(line => line.t === 'start')).toEqual([{ t: 'start', i: 1, path: 'b.cpp' }]);
  expect(result.done(0)).toBeUndefined();
  expect(result.done(1)?.files).toEqual([{ path: 'b.cpp', status: 'parsed' }]);
  expect(result.ended).toBe(true);
});

it('deduplicates identical main file and filtered arguments, numbering continuously', async () => {
  const result = await run({
    files: { 'a.cpp': 'int a;\n', 'b.cpp': 'int b;\n' },
    databases: rootDb([unit('a.cpp'), unit('a.cpp'), unit('b.cpp')]),
  });
  expect(result.ready?.units).toEqual(['a.cpp', 'b.cpp']);
  expect(result.done(0)?.i).toBe(0);
  expect(result.done(1)?.i).toBe(1);
});

it('A-23 keeps -idirafter as a working search directory', async () => {
  const result = await run({
    files: { 'main.cpp': '#include "i.h"\n', 'sub/i.h': '' },
    databases: rootDb([{ directory: '.', file: 'main.cpp', arguments: ['c++', '-c', 'main.cpp', '-idirafter', 'sub'] }]),
  });
  expect(result.ready?.notes).toEqual([]);
  expect(result.done(0)?.edges).toEqual([['main.cpp', 'sub/i.h', '"i.h"']]);
});

it('A-22 (d) records a defined macro include as written and an unexpanded macro as unresolved', async () => {
  const result = await run({
    files: { 'main.cpp': '#include HDR\n#include NOPE\n', 'x.h': '' },
    databases: rootDb([{ directory: '.', file: 'main.cpp', arguments: ['c++', '-c', 'main.cpp', '-DHDR="x.h"'] }]),
  });
  expect(result.done(0)?.files).toEqual([{ path: 'main.cpp', status: 'parsed' }, { path: 'x.h', status: 'parsed' }]);
  expect(result.done(0)?.edges).toEqual([['main.cpp', 'x.h', 'HDR']]);
  expect(result.done(0)?.unresolved).toEqual([{ from: 'main.cpp', specifier: 'NOPE', reason: 'include 后面跟宏' }]);
});

it('A-22 macro comment keeps the written macro word after a line comment', async () => {
  const result = await run({
    files: { 'main.cpp': '#include HDR // note\n#include NOPE // n\n', 'x.h': '' },
    databases: rootDb([{ directory: '.', file: 'main.cpp', arguments: ['c++', '-c', 'main.cpp', '-DHDR="x.h"'] }]),
  });
  expect(result.done(0)?.files).toEqual([{ path: 'main.cpp', status: 'parsed' }, { path: 'x.h', status: 'parsed' }]);
  expect(result.done(0)?.edges).toEqual([['main.cpp', 'x.h', 'HDR']]);
  expect(result.done(0)?.unresolved).toEqual([{ from: 'main.cpp', specifier: 'NOPE', reason: 'include 后面跟宏' }]);
});

it('script: a macro specifier after a block comment longer than 400 bytes is read from source', async () => {
  // The 400-byte cut used to truncate the comment so the extractor gave up and
  // clang's expanded spelling replaced the written macro word.
  const filler = 'x'.repeat(450);
  const result = await run({
    files: { 'main.cpp': `#include /*${filler}*/ HDR\n`, 'x.h': '' },
    databases: rootDb([{ directory: '.', file: 'main.cpp', arguments: ['c++', '-DHDR="x.h"', '-c', 'main.cpp'] }]),
  });
  expect(result.done(0)?.files).toEqual([{ path: 'main.cpp', status: 'parsed' }, { path: 'x.h', status: 'parsed' }]);
  expect(result.done(0)?.edges).toEqual([['main.cpp', 'x.h', 'HDR']]);
  expect(result.done(0)?.unresolved).toEqual([]);
});

it('script: a continued unexpanded macro directive across more than two physical lines is read from source', async () => {
  // After line splicing this is `#include /* c */ NOPE`; the old two-line
  // window stopped before NOPE, so the extractor never saw a specifier.
  const result = await run({
    files: { 'main.cpp': '#include \\\n/* c */ \\\nNOPE\n' },
    databases: rootDb([unit('main.cpp')]),
  });
  expect(result.done(0)?.files).toEqual([{ path: 'main.cpp', status: 'parsed' }]);
  expect(result.done(0)?.edges).toEqual([]);
  expect(result.done(0)?.unresolved).toEqual([{ from: 'main.cpp', specifier: 'NOPE', reason: 'include 后面跟宏' }]);
});

it('script: per-file line cache keeps two files with different continuation positions apart', async () => {
  // Both files carry an unexpanded macro directive, but `a.h` continues on
  // line 2 while `b.h` starts on line 4. A cache that reuses one file's
  // physical lines for another would read the wrong line (or nothing) for the
  // second directive. This is a correctness regression test for the shared
  // per-file cache, not a timing test.
  const result = await run({
    files: {
      'main.cpp': '#include "a.h"\n#include "b.h"\n',
      'a.h': '#include \\\nHDR_A\n',
      'b.h': '\n\n\n#include \\\nHDR_B\n',
    },
    databases: rootDb([unit('main.cpp')]),
  });
  expect(result.done(0)?.files).toEqual([
    { path: 'a.h', status: 'parsed' },
    { path: 'b.h', status: 'parsed' },
    { path: 'main.cpp', status: 'parsed' },
  ]);
  expect(result.done(0)?.edges).toEqual([
    ['main.cpp', 'a.h', '"a.h"'],
    ['main.cpp', 'b.h', '"b.h"'],
  ]);
  expect(result.done(0)?.unresolved).toEqual([
    { from: 'a.h', specifier: 'HDR_A', reason: 'include 后面跟宏' },
    { from: 'b.h', specifier: 'HDR_B', reason: 'include 后面跟宏' },
  ]);
});

it('A-22 (e) does not connect an angled include recovered by the quoted lookup', async () => {
  const result = await run({
    files: { 'src/main.cpp': '#include <local.h>\n', 'src/local.h': '#include "z.h"\n', 'src/z.h': '' },
    databases: rootDb([unit('src/main.cpp')]),
  });
  expect(result.ready?.units).toEqual(['src/main.cpp']);
  expect(result.done(0)?.files).toEqual([{ path: 'src/main.cpp', status: 'parsed' }]);
  expect(result.done(0)?.edges).toEqual([]);
  expect(result.done(0)?.unresolved).toEqual([{ from: 'src/main.cpp', specifier: '<local.h>', reason: '尖括号引用只能按引号规则找到' }]);
});

it('A-22 (m) reports an angled fallback that finds the including file itself as a null reason', async () => {
  const result = await run({
    files: {
      'main.cpp': '#include "uv/errno.h"\n',
      'uv/errno.h': '#ifndef E_H\n#define E_H\n#include <errno.h>\n#endif\n',
    },
    databases: rootDb([unit('main.cpp')]),
  });
  expect(result.done(0)?.files).toEqual([
    { path: 'main.cpp', status: 'parsed' },
    { path: 'uv/errno.h', status: 'parsed' },
  ]);
  expect(result.done(0)?.edges).toEqual([['main.cpp', 'uv/errno.h', '"uv/errno.h"']]);
  expect(result.done(0)?.unresolved).toEqual([{ from: 'uv/errno.h', specifier: '<errno.h>', reason: null }]);
});

it('A-22 (k) fails only the translation unit libclang cannot parse', async () => {
  const result = await run({
    files: {
      'include/used.hpp': '#pragma once\nint used();\n',
      'include/orphan.hpp': '#pragma once\nint orphan();\n',
      'src/main.cpp': '#include "used.hpp"\nint main() { return 0; }\n',
      'src/broken.cpp': 'int broken( { return 1; }\n',
    },
    databases: rootDb([
      absoluteUnit('src/main.cpp'),
      absoluteUnit('src/broken.cpp', ['--target=bogus']),
    ]),
  });
  expect(result.ready?.units).toEqual(['src/main.cpp', 'src/broken.cpp']);
  expect(result.done(0)?.files).toEqual([
    { path: 'include/used.hpp', status: 'parsed' },
    { path: 'src/main.cpp', status: 'parsed' },
  ]);
  expect(result.done(0)?.edges).toEqual([['src/main.cpp', 'include/used.hpp', '"used.hpp"']]);
  expect(result.done(1)?.files).toEqual([{ path: 'src/broken.cpp', status: 'failed', reason: 'libclang 解析不了（code 1）' }]);
});

it('A-22 (l) keeps a header with a semantic error parsed and connected', async () => {
  const result = await run({
    files: { 'src/main.cpp': '#include "bad.hpp"\n', 'include/bad.hpp': '#pragma once\nint value = undeclared_name;\n' },
    databases: rootDb([{ directory: ROOT, file: `${ROOT}/src/main.cpp`, arguments: ['clang++', '-I', `${ROOT}/include`, '-c', 'src/main.cpp'] }]),
  });
  expect(result.done(0)?.files).toEqual([
    { path: 'include/bad.hpp', status: 'parsed' },
    { path: 'src/main.cpp', status: 'parsed' },
  ]);
  expect(result.done(0)?.edges).toEqual([['src/main.cpp', 'include/bad.hpp', '"bad.hpp"']]);
});

it('A-23 computes the merge note from the databases the provider selected', async () => {
  const result = await run({
    files: { 'p1/a.cpp': '#include "a.h"\n', 'p1/a.h': '', 'p2/b.cpp': '#include "b.h"\n', 'p2/b.h': '' },
    databases: [
      dbAt('dbs/p1/compile_commands.json', [{ directory: '../../p1', file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp'] }]),
      dbAt('dbs/p2/compile_commands.json', [{ directory: '../../p2', file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp'] }]),
    ],
  });
  expect(result.ready?.units).toEqual(['p1/a.cpp', 'p2/b.cpp']);
  expect(result.ready?.notes).toEqual(['合并了 2 个编译数据库']);
  expect(result.done(0)?.edges).toEqual([['p1/a.cpp', 'p1/a.h', '"a.h"']]);
  expect(result.done(1)?.edges).toEqual([['p2/b.cpp', 'p2/b.h', '"b.h"']]);
});

it('A-23 merges two databases under a nested common build directory', async () => {
  const result = await run({
    files: { 'a/a.cpp': '#include "a.h"\n', 'a/a.h': '', 'b/b.cpp': '#include "b.h"\n', 'b/b.h': '' },
    databases: [
      dbAt('out/build/a/compile_commands.json', [{ directory: '../../../a', file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp'] }]),
      dbAt('out/build/b/compile_commands.json', [{ directory: '../../../b', file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp'] }]),
    ],
  });
  expect(result.ready?.units).toEqual(['a/a.cpp', 'b/b.cpp']);
  expect(result.ready?.notes).toEqual(['合并了 2 个编译数据库']);
  expect(result.done(0)?.edges).toEqual([['a/a.cpp', 'a/a.h', '"a.h"']]);
  expect(result.done(1)?.edges).toEqual([['b/b.cpp', 'b/b.h', '"b.h"']]);
});

it('A-23 adds the fixed target so __x86_64__ and __linux__ select the include', async () => {
  const result = await run({
    files: { 'main.cpp': '#if defined(__x86_64__) && defined(__linux__)\n#include "x.h"\n#endif\n', 'x.h': '' },
    databases: rootDb([unit('main.cpp')]),
  });
  expect(result.done(0)?.edges).toEqual([['main.cpp', 'x.h', '"x.h"']]);
});

it('A-23 validates the whole database and every entry with the numbered literals', async () => {
  const cases: Array<[string, unknown, string]> = [
    ['not-array', {}, '配置错误：compile_commands.json 不是数组'],
    ['parse', 'not json', '配置错误：compile_commands.json 解析不了'],
    ['entry-object', [1], '配置错误：compile_commands.json 的第 1 条不是对象'],
    ['no-file', [{ directory: '.' }], '配置错误：compile_commands.json 的第 1 条没有 file'],
    ['no-directory', [{ file: 'main.cpp' }], '配置错误：compile_commands.json 的第 1 条没有 directory'],
    ['file-type', [{ directory: '.', file: 1 }], '配置错误：compile_commands.json 的第 1 条的 file 不是字符串'],
    ['directory-type', [{ directory: 1, file: 'main.cpp' }], '配置错误：compile_commands.json 的第 1 条的 directory 不是字符串'],
    ['arguments-type', [{ directory: '.', file: 'main.cpp', arguments: 'c++ -c main.cpp' }], '配置错误：compile_commands.json 的第 1 条的 arguments 不是字符串列表'],
    ['no-command', [{ directory: '.', file: 'main.cpp' }], '配置错误：compile_commands.json 的第 1 条没有 arguments 也没有 command'],
  ];
  for (const [name, content, reason] of cases) {
    const result = await run({
      files: { 'main.cpp': 'int m;\n' },
      databases: [{ path: 'compile_commands.json', content: typeof content === 'string' ? content : JSON.stringify(content) }],
    });
    expect(result.failed?.reason, name).toBe(reason);
    expect(result.ready, name).toBeUndefined();
  }
});

it('A-23 reports a missing libclang as unavailable', async () => {
  const result = await run({
    files: { 'main.cpp': 'int m;\n' },
    databases: rootDb([unit('main.cpp')]),
    libraryPath: '/no-such-libclang.so',
  });
  expect(result.unavailable?.message).toEqual(expect.stringContaining('libclang'));
  expect(result.ready).toBeUndefined();
});

it('A-23 maps relative paths through the virtual root when there is no host root', async () => {
  const result = await run({
    workspaceRoot: null, workspaceRealRoot: null,
    files: { 'main.cpp': '#include "x.h"\n', 'x.h': '' },
    databases: rootDb([unit('main.cpp')]),
  });
  expect(result.ready?.units).toEqual(['main.cpp']);
  expect(result.ready?.notes).toEqual([]);
  expect(result.done(0)?.edges).toEqual([['main.cpp', 'x.h', '"x.h"']]);
});

it('A-23 treats an absolute main file as outside when there is no host root', async () => {
  const result = await run({
    workspaceRoot: null, workspaceRealRoot: null,
    files: { 'main.cpp': 'int m;\n' },
    databases: rootDb([{ directory: '/outside/build', file: `${ROOT}/main.cpp`, arguments: ['c++', '-c', `${ROOT}/main.cpp`] }]),
  });
  expect(result.ready?.units).toEqual([]);
  expect(result.ready?.notes).toEqual(['1 个编译单元的主文件不在观测的文件里']);
});

it('A-23 treats absolute include paths and forced includes as outside without a host root', async () => {
  const result = await run({
    workspaceRoot: '', workspaceRealRoot: '',
    files: { 'main.cpp': 'int m;\n' },
    databases: rootDb([{ directory: '.', file: 'main.cpp', arguments: ['c++', '-I', '/outside/include', '-include', '/outside/pre.h', '-c', 'main.cpp'] }]),
  });
  expect(result.ready?.notes).toEqual(expect.arrayContaining(['忽略了 1 个工作区外的查找目录', '忽略了 1 个读不到的强制包含文件']));
  expect(result.done(0)?.files).toEqual([{ path: 'main.cpp', status: 'parsed' }]);
});
