/**
 * 8E-2 W 组验收行 E2-31a、E2-31b（8E-2 :862–863）：C++ 单文件查的翻译单元复用和失效。
 * 入口：W 的公开 `lookup`（§2.0 :236–248，§4.1 :711、§3.3 :546）；端口工厂照 lead 11-04 的开工裁定第 1 条。
 * 世界：§4.2 :785–793 的 gate 三个文件，建在 workspaceToolsFixture 的真实临时根上；
 * 真实 python3 和 libclang 18 的默认位置（同 tests/data/cpp-source-index.test.ts:54–57），只在 WSL 跑。
 * 两次 `lookup` 都是 `mode: 'write'`（W11“写” :294：读和写用同一个复用判断）。
 */
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createNativeSingleFile, type NativeLookupV1 } from '../../src/core/workspace/native-single-file.js';
import { workspaceToolsFixture } from '../helpers/workspace-tools-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const fixture = workspaceToolsFixture({
  projectId: 's8e2-w-native', actorId: 's8e2-w-native-reader', permissionRevision: 's8e2-w-native-policy-v1',
  tempPrefix: 's8e2-w-native-', cleanups,
});

const GATE_CPP = '#include "gate.hpp"\n#if defined(API_ENABLED) && GATE_ON\nint pick(int value) { return value + 1; }\n#endif\n';
/** §4.2 :793：`compile_commands.json` 一条，`directory` 是根，`file`、`-I` 写绝对路径。 */
const commandsOf = (root: string, defines: string[]) => JSON.stringify([{
  directory: root, file: join(root, 'src/gate.cpp'),
  arguments: ['clang++', '-std=c++20', ...defines, '-I', join(root, 'include'), '-c', 'src/gate.cpp'],
}]);

/** 一个新临时目录、三个文件、一个新端口；根要等夹具建好才知道，所以配置先放占位再写真内容。 */
async function gateWorld() {
  const c = await fixture([
    ['include/gate.hpp', '#pragma once\n#define GATE_ON 1\n'],
    ['src/gate.cpp', GATE_CPP],
    ['compile_commands.json', '[]'],
  ]);
  await c.edit('compile_commands.json', commandsOf(c.root, ['-DAPI_ENABLED=1']));
  const port = createNativeSingleFile({ readWorkspaceFiles: c.handle.readWorkspaceFiles });
  cleanups.push(() => port.close());
  // ASCII 文件：原始字节和解码文字的 sha256 相同。
  const input = { language: 'cpp', path: 'src/gate.cpp', text: GATE_CPP,
    digest: createHash('sha256').update(GATE_CPP).digest('hex'), mode: 'write' } as const;
  return { c, lookup: () => port.lookup(c.context, input) };
}

/** 下面几条 C++ 用的世界：同 gateWorld 的根和端口，文件和 `-I` 目录（按给的次序）由调用方给；`lookup` 每次给文字和模式。 */
async function cppWorld(files: [string, string][], includes: string[]) {
  const c = await fixture([...files, ['compile_commands.json', '[]']]);
  await c.edit('compile_commands.json', JSON.stringify([{
    directory: c.root, file: join(c.root, 'src/gate.cpp'),
    arguments: ['clang++', '-std=c++20', '-DAPI_ENABLED=1', ...includes.flatMap(dir => ['-I', join(c.root, dir)]), '-c', 'src/gate.cpp'],
  }]));
  const port = createNativeSingleFile({ readWorkspaceFiles: c.handle.readWorkspaceFiles });
  cleanups.push(() => port.close());
  const lookup = (text: string, mode: 'read' | 'write') => port.lookup(c.context, { language: 'cpp', path: 'src/gate.cpp', text,
    digest: createHash('sha256').update(text).digest('hex'), mode });
  return { port, lookup };
}

/** `parsed` 且 `exact: true`（8E-2 :862–863 两次都要），回 `symbols`。 */
function exactSymbols(result: NativeLookupV1): { name: string }[] {
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'parsed', exact: true });
  if (result.status !== 'parsed') throw Error(JSON.stringify(result));
  return result.symbols;
}

it('E2-31a a changed workspace header rebuilds the kept translation unit', async () => {
  const { c, lookup } = await gateWorld();
  // 名字起点 3 行 5 列（`int ` 之后，行列从 1 起，手算）。
  expect(exactSymbols(await lookup())).toContainEqual(expect.objectContaining({ name: 'pick', start: { line: 3, column: 5 } }));
  await c.edit('include/gate.hpp', '#pragma once\n#define GATE_ON 0\n');
  // 改坏（8E-2 :862；W11 :287、:292、:295）：翻译单元按“路径 + 参数”命中后继续向重解析提供上次的头文件内容
  // → 第二次还有 `pick`，这一条红。
  expect(exactSymbols(await lookup()).map(symbol => symbol.name)).not.toContain('pick');
}, 60000);

it('E2-31b changed compile arguments rebuild the kept translation unit', async () => {
  const { c, lookup } = await gateWorld();
  expect(exactSymbols(await lookup()).map(symbol => symbol.name)).toContain('pick');
  await c.edit('compile_commands.json', commandsOf(c.root, []));
  // 改坏（8E-2 :863；W11“复用” :292）：翻译单元只按路径留、不看编译参数 → 第二次还有 `pick`，这一条红。
  expect(exactSymbols(await lookup()).map(symbol => symbol.name)).not.toContain('pick');
}, 60000);

it('WN-R1-01 a read whose new text names a header the kept unit never asked falls back with exact: false', async () => {
  const { lookup } = await cppWorld([
    ['include/gate.hpp', '#pragma once\n#define GATE_ON 1\n'], ['src/gate.cpp', GATE_CPP], ['src/optional.h', '#pragma once\n'],
  ], ['include']);
  // 先写一次：建好并留下翻译单元（8E-2 :294）。GATE_CPP 只 include "gate.hpp"，留着的单元没问过 optional.h。
  expect(await lookup(GATE_CPP, 'write')).toMatchObject({ status: 'parsed', exact: true });
  // 再读，新文字多一个 `__has_include("optional.h")`：它的候选 src/optional.h（引入者的目录，文件在）、include/optional.h（-I）
  // 留着的单元都没问过，它的 VFS 里没有 → 读时这个状态的 preamble 还没建好，照 8E-2 :293 退回单文件解析、`exact: false`。
  // 改坏（8E-2 :293、:241–242；R3 :337–338）：复用分支读时照旧用留着的单元答 → `__has_include` 读成假、没有诊断，
  // 回 `exact: true` 而没有 `extra`（R3 会读成 `symbol_missing`），这一条红。
  const text = GATE_CPP + '#if __has_include("optional.h")\nint extra(int v) { return v; }\n#endif\n';
  expect(await lookup(text, 'read')).toMatchObject({ status: 'parsed', exact: false });
}, 60000);

it('WN-R1-02 a candidate header over the read limit leaves the parse not exact', async () => {
  // -I include 在 -I alt 前面：真实编译用 include/gate.hpp（GATE_ON 1，有 `pick`）。它超过单个文件的读上限 2 MiB
  // （workspace-tools.ts:14 的 maxFileBytes，单文件查照它读）→ 读回 capacity、交不过去；编译器接着找到
  // alt/gate.hpp（GATE_ON 0，没有 `pick`），这次解析没有诊断。
  const big = '#pragma once\n#define GATE_ON 1\n//' + 'x'.repeat(2 * 1024 * 1024) + '\n';
  const { lookup } = await cppWorld([
    ['include/gate.hpp', big], ['alt/gate.hpp', '#pragma once\n#define GATE_ON 0\n'], ['src/gate.cpp', GATE_CPP],
  ], ['include', 'alt']);
  // 期望（lead 裁定，核对的做法 B）：照样接着找，但这次解析不算精确（8E-2 :241–242、:289 第 5 条）：`parsed`、`exact: false`。
  // 改坏（8E-2 :241–242；src/AGENTS.md:36 不静默兜底）：capacity 和 not_found 一样当“没有”、照旧精确 →
  // 回 `exact: true` 而没有 `pick`（R3 会读成 `symbol_missing`），这一条红。
  expect(await lookup(GATE_CPP, 'write')).toMatchObject({ status: 'parsed', exact: false });
}, 60000);

it('WN-R1-04 closing the port lets the C++ process remove its scratch directory', async () => {
  // 起进程的环境只有 PATH、LANG（analysis-runner.ts:132），脚本的 `tempfile` 用 /tmp，不是 vitest 的 TMPDIR。
  const scratch = async () => (await readdir('/tmp')).filter(name => name.startsWith('platform-cpp-single-'));
  const before = new Set(await scratch());
  const { port, lookup } = await cppWorld([['include/gate.hpp', '#pragma once\n#define GATE_ON 1\n'], ['src/gate.cpp', GATE_CPP]], ['include']);
  expect(await lookup(GATE_CPP, 'write')).toMatchObject({ status: 'parsed', exact: true });
  // 进程活着：它的临时目录在（单文件模式的 `TemporaryDirectory`，留着的翻译单元的源文字副本都在里面）。
  const mine = (await scratch()).filter(name => !before.has(name));
  expect(mine.length).toBeGreaterThan(0);
  await port.close();
  // 改坏（8E-2 :280 “Host 关闭时停掉”）：close 不关输入、直接 SIGKILL → 脚本的 `finally`、`with` 都不跑，
  // 目录留在 /tmp，这一条红。
  const after = new Set(await scratch());
  expect(mine.filter(name => after.has(name))).toEqual([]);
}, 60000);

it('WN-R1-05 a Python name span covers every identifier character', async () => {
  // 第 1 行 `def éx(): pass`，é 写成 e + U+0301（组合重音，Mn）；第 2 行 `def ℘y(): pass`，℘ 是 U+2118（Other_ID_Start）。
  // 两个都是合法名字（PEP 3131，`str.isidentifier()` 为真，`ast.parse` 收）。
  const text = 'def éx(): pass\ndef ℘y(): pass\n';
  const c = await fixture([['src/names.py', text]]);
  const port = createNativeSingleFile({ readWorkspaceFiles: c.handle.readWorkspaceFiles });
  cleanups.push(() => port.close());
  const result = await port.lookup(c.context, { language: 'python', path: 'src/names.py', text,
    digest: createHash('sha256').update(text).digest('hex'), mode: 'read' });
  // 期望（8E-2 :238、:296：名字那一段；行列从 1 起，列数 UTF-16 单元，末尾不含）手算：
  //   第 1 行 d=1 e=2 f=3 空格=4，名字 e=5、U+0301=6、x=7，`(`=8 → 起 {1,5}、止 {1,8}；
  //   名字取 AST 的，NFKC 归一成 U+00E9 x（PEP 3131）。
  //   第 2 行同样从 5 列起：℘=5（BMP，一个单元）、y=6，`(`=7 → 起 {2,5}、止 {2,7}；℘ 的 NFKC 是它自己。
  // 改坏（8E-2 :281、:296）：名字那一段用 `[^\W\d]\w*` 找 → 第 1 行止在 {1,6}（\w 不含 Mn），
  // 第 2 行找不到名字（\w 不含 ℘）、整份回 `unavailable`，这一条红。
  expect(result).toEqual({ status: 'parsed', exact: true, symbols: [
    { name: 'éx', kind: 'function', start: { line: 1, column: 5 }, end: { line: 1, column: 8 } },
    { name: '℘y', kind: 'function', start: { line: 2, column: 5 }, end: { line: 2, column: 7 } },
  ] });
}, 60000);

it('W-R2-01 a binary candidate header fails the lookup instead of reading as absent', async () => {
  // `__has_include("optional.h")` 的候选 src/optional.h（引入者的目录）存在，内容里有 NUL → Kernel 的 `binary_file`，
  // 读回 `unsupported`。真实编译看得见它、会编进 `pick`；可工作区头文件只能由主线程经读口取了交给进程（W11 :295），
  // 这份内容交不过去，这次解析就不是真实编译的样子。它不是“有诊断的解析”（:289 第 5 条的 `exact: false`），
  // 是读失败：照 W11 :280 那次回 `unavailable`（读失败不折成“没有”，src/AGENTS.md:36）。
  const text = '#if __has_include("optional.h")\nint pick(int value) { return value + 1; }\n#endif\n';
  const { lookup } = await cppWorld([['src/gate.cpp', text], ['src/optional.h', '#pragma once\n\0\n']], []);
  // 改坏（8E-2 :241–242、:295；R3 :337）：`unsupported` 不分是不是目录、都当没有 → `__has_include` 读成假、没有诊断，
  // 回 `exact: true` 而没有 `pick`（R3 会读成 `symbol_missing`），这一条红。
  // 读失败的原因是 Kernel 对这个文件的消息（`readFailure` 原样带上）。
  expect(await lookup(text, 'write')).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('src/optional.h') });
}, 60000);
