import { afterEach, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAnalysis, type AnalysisRunInput, type AnalysisRunOutcome } from '../../src/core/workspace/analysis-runner.js';

/**
 * §11.5 runner rows. Every case runs the real `scripts/cpp-source-query.py` against
 * real source files; the interpreter is either the system `python3` or a wrapper that
 * forwards the real interpreter and injects only a fault (garbage, hang, exit code,
 * kill, closed stdout, padding). No protocol facts are fabricated.
 */
const CPP_SCRIPT = fileURLToPath(new URL('../../scripts/cpp-source-query.py', import.meta.url));
const LIBRARY = '/usr/lib/llvm-18/lib/libclang.so.1';
const APPROXIMATE = '近似：不读系统头文件和观测以外的头文件';
const READ_FAILED = '分析运行失败：输出读不了';
const OVER_LIMIT = '分析运行失败：输出超过 64 MiB';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Entry = [path: string, content: string];
type Database = { directory: string; file: string; arguments: string[] }[];

async function writeTree(entries: Entry[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'analysis-runner-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of entries) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const databaseFor = (entries: Entry[]): Database => entries
  .filter(([path]) => /\.(c|cc|cpp|cxx)$/i.test(path))
  .map(([file]) => ({ directory: '.', file, arguments: ['c++', '-c', file] }));

function cppInput(root: string, entries: Entry[], database: Database,
  extra: Partial<AnalysisRunInput> & { libraryPath?: string; databaseContent?: string } = {}): AnalysisRunInput {
  const sorted = [...entries].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const { libraryPath, databaseContent, ...overrides } = extra;
  return {
    language: 'cpp', interpreter: 'python3', script: CPP_SCRIPT,
    paths: sorted.map(([path]) => path),
    files: sorted.map(([path, content]) => ({ path, content })),
    config: {
      libraryPath: libraryPath ?? LIBRARY,
      databases: [{ path: 'compile_commands.json', content: databaseContent ?? JSON.stringify(database) }],
      workspaceRoot: root, workspaceRealRoot: root,
    },
    unitTimeoutMs: 5_000, languageTimeoutMs: 30_000, signal: new AbortController().signal,
    ...overrides,
  };
}

/**
 * A `pythonPath` wrapper: it discovers the real script from its own argv and runs
 * `python3 -I -S <script> import_graph`. `body` may forward the child's stdout,
 * inject one fault and hang. Prelude names: REAL, COUNTER, MARKER, RECORD, LAUNCH,
 * bump(), spawn_real(stdin), forward(line), parse(line), lines(child).
 */
async function wrapperScript(body: string): Promise<{ wrapper: string; counter: string; marker: string; record: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'analysis-runner-wrapper-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const counter = join(directory, 'launches.txt');
  const marker = join(directory, 'marker.txt');
  const record = join(directory, 'record.json');
  const wrapper = join(directory, 'wrapper.py');
  await writeFile(wrapper, `#!/usr/bin/python3
import json, os, signal, subprocess, sys, time

REAL = sys.argv[sys.argv.index('import_graph') - 1]
COUNTER = ${JSON.stringify(counter)}
MARKER = ${JSON.stringify(marker)}
RECORD = ${JSON.stringify(record)}

def bump():
    try:
        with open(COUNTER) as handle:
            count = int(handle.read().strip() or '0')
    except OSError:
        count = 0
    count += 1
    with open(COUNTER, 'w') as handle:
        handle.write(str(count))
    return count

LAUNCH = bump()

def spawn_real(stdin=sys.stdin):
    return subprocess.Popen([sys.executable, '-I', '-S', REAL, 'import_graph'],
                            stdin=stdin, stdout=subprocess.PIPE)

def forward(line):
    sys.stdout.buffer.write(line)
    sys.stdout.buffer.flush()

def parse(line):
    return json.loads(line)

def lines(child):
    for line in child.stdout:
        yield line

${body}
`);
  await chmod(wrapper, 0o755);
  return { wrapper, counter, marker, record };
}

const launchCount = async (counter: string) =>
  Number((await readFile(counter, 'utf8').catch(() => '0')).trim() || '0');

const filesOf = (outcome: AnalysisRunOutcome) => outcome.status === 'done' ? [...outcome.files.values()] : [];

async function waitFor<T>(probe: () => Promise<T | null> | T | null, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw Error('timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

it('S8D-RUN-01 merges real units: edge dedupe, unresolved reason precedence and claimed-file completion', async () => {
  const entries: Entry[] = [
    ['a.cpp', '#include "shared.h"\n#include <system.h>\n'],
    ['b.cpp', '#include HDR\n#include "shared.h"\n'],
    ['shared.h', '#pragma once\nint shared;\n'],
    ['orphan.cpp', 'int o;\n'],
    ['never.h', '#pragma once\n'],
  ];
  const database: Database = [
    { directory: '.', file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp', '-DA'] },
    { directory: '.', file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp', '-DB'] },
    { directory: '.', file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp', '-DHDR="missing.h"'] },
    { directory: '.', file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp'] },
  ];
  const root = await writeTree(entries);
  await writeFile(join(root, 'compile_commands.json'), JSON.stringify(database));
  const databaseContent = await readFile(join(root, 'compile_commands.json'), 'utf8');
  const outcome = await runAnalysis(cppInput(root, entries, database, { databaseContent }));

  expect(outcome.status).toBe('done');
  if (outcome.status !== 'done') return;
  expect(outcome.engine).toBe('libclang');
  expect(outcome.units).toEqual(['a.cpp', 'a.cpp', 'b.cpp', 'b.cpp']);
  expect(outcome.notes).toEqual([APPROXIMATE]);
  // The two a.cpp units and the two b.cpp units each yield the same edge; the
  // HDR pair is first unresolved with a null reason, then with the macro reason.
  expect(outcome.edges).toEqual([{ from: 'a.cpp', to: 'shared.h' }, { from: 'b.cpp', to: 'shared.h' }]);
  expect(outcome.unresolved).toEqual([
    { from: 'a.cpp', specifier: '<system.h>', reason: null },
    { from: 'b.cpp', specifier: 'HDR', reason: 'include 后面跟宏' },
  ]);
  expect(filesOf(outcome)).toEqual([
    { path: 'a.cpp', status: 'parsed' },
    { path: 'b.cpp', status: 'parsed' },
    { path: 'never.h', status: 'skipped', reason: '没有编译单元包含它' },
    { path: 'orphan.cpp', status: 'skipped', reason: '源文件不在编译数据库里' },
    { path: 'shared.h', status: 'parsed' },
  ]);
}, 60_000);

it('S8D-RUN-02 forwards the real header and file lines unchanged', async () => {
  const entries: Entry[] = [['a.cpp', '#include "a.h"\n'], ['a.h', '#pragma once\n']];
  const database = databaseFor(entries);
  const root = await writeTree(entries);
  const { wrapper, record } = await wrapperScript(`
data = sys.stdin.read()
rows = [parse(line) for line in data.splitlines() if line.strip()]
with open(RECORD, 'w') as handle:
    handle.write(json.dumps(rows))
child = subprocess.run([sys.executable, '-I', '-S', REAL, 'import_graph'], input=data.encode(), stdout=sys.stdout)
sys.exit(child.returncode)
`);
  const input = cppInput(root, entries, database, { interpreter: wrapper });
  const outcome = await runAnalysis(input);
  expect(outcome.status).toBe('done');
  if (outcome.status !== 'done') return;
  expect(outcome.edges).toEqual([{ from: 'a.cpp', to: 'a.h' }]);
  const rows = JSON.parse(await readFile(record, 'utf8')) as Record<string, unknown>[];
  expect(rows[0]).toEqual({ t: 'header', v: 1, paths: input.paths, config: input.config, resumeFrom: 0 });
  expect(rows.slice(1)).toEqual(input.files.map(file => ({ t: 'file', path: file.path, content: file.content })));
}, 60_000);

it('S8D-RUN-03 fails the language when the first launch exits before the first unit', async () => {
  const entries: Entry[] = [['a.cpp', 'int a;\n']];
  const root = await writeTree(entries);
  const { wrapper } = await wrapperScript('sys.exit(3)');
  expect(await runAnalysis(cppInput(root, entries, databaseFor(entries), { interpreter: wrapper }))).toEqual({
    status: 'failed', reason: '分析运行失败：进程在第一个单元前退出（退出码 3）',
  });
}, 60_000);

it('S8D-RUN-04 fails the language when the first launch never reports the unit list before the language timeout', async () => {
  const entries: Entry[] = [['a.cpp', 'int a;\n']];
  const root = await writeTree(entries);
  const { wrapper } = await wrapperScript('time.sleep(60)');
  expect(await runAnalysis(cppInput(root, entries, databaseFor(entries), {
    interpreter: wrapper, unitTimeoutMs: 60_000, languageTimeoutMs: 300,
  }))).toEqual({ status: 'failed', reason: '分析运行失败：没有给出单元清单就到时' });
}, 60_000);

it('S8D-RUN-05 reports a restart whose ready differs from the first as unreadable output', async () => {
  const entries: Entry[] = [['a.cpp', 'int a;\n'], ['b.cpp', 'int b;\n'], ['c.cpp', 'int c;\n']];
  const root = await writeTree(entries);
  const { wrapper } = await wrapperScript(`
child = spawn_real()
for line in lines(child):
    value = parse(line)
    if LAUNCH == 1:
        forward(line)
        if value.get('t') == 'start' and value.get('path') == 'b.cpp':
            os.kill(0, signal.SIGKILL)
    elif value.get('t') == 'ready':
        value['units'] = value['units'] + ['d.cpp']
        forward(json.dumps(value).encode() + b'\\n')
        time.sleep(60)
    else:
        forward(line)
sys.exit(child.wait())
`);
  expect(await runAnalysis(cppInput(root, entries, databaseFor(entries), { interpreter: wrapper }))).toEqual({
    status: 'failed', reason: READ_FAILED,
  });
}, 60_000);

it('S8D-RUN-06 maps only a missing interpreter and the script unavailable line to 分析器不可用', async () => {
  const entries: Entry[] = [['a.cpp', 'int a;\n']];
  const root = await writeTree(entries);
  expect(await runAnalysis(cppInput(root, entries, databaseFor(entries), {
    interpreter: '/no/such/interpreter',
  }))).toEqual({ status: 'failed', reason: '分析器不可用' });
  expect(await runAnalysis(cppInput(root, entries, databaseFor(entries), {
    libraryPath: '/no/such/libclang.so.1',
  }))).toEqual({ status: 'failed', reason: '分析器不可用' });
}, 60_000);

it('S8D-RUN-07 keeps another spawn error in its own class (ENOTDIR)', async () => {
  const entries: Entry[] = [['a.cpp', 'int a;\n']];
  const root = await writeTree(entries);
  await writeFile(join(root, 'not-a-dir'), 'x');
  expect(await runAnalysis(cppInput(root, entries, databaseFor(entries), {
    interpreter: join(root, 'not-a-dir', 'python3'),
  }))).toEqual({ status: 'failed', reason: 'Error: spawn ENOTDIR' });
}, 60_000);

it('S8D-RUN-08 treats a completed per-file preprocessing failure as done, not unfinished', async () => {
  const entries: Entry[] = [['main.cpp', '#if 1\n'], ['orphan.h', 'int o;\n']];
  const database: Database = [{ directory: '.', file: 'main.cpp', arguments: ['c++', '-c', 'main.cpp'] }];
  const root = await writeTree(entries);
  const outcome = await runAnalysis(cppInput(root, entries, database));
  expect(outcome.status).toBe('done');
  if (outcome.status !== 'done') return;
  expect(filesOf(outcome)).toEqual([
    { path: 'main.cpp', status: 'failed', reason: '预处理出错：unterminated conditional directive' },
    { path: 'orphan.h', status: 'skipped', reason: '没有编译单元包含它' },
  ]);
  expect(outcome.edges).toEqual([]);
}, 60_000);

it('S8D-RUN-09 accumulates the 64 MiB output cap across restarts', async () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(name => `${name}.cpp`);
  const entries: Entry[] = names.map(name => [name, 'int x;\n']);
  const database = databaseFor(entries);
  const root = await writeTree(entries);
  const { wrapper } = await wrapperScript(`
PAD = 'x' * (8 * 1024 * 1024)
child = spawn_real()
for line in lines(child):
    value = parse(line)
    if LAUNCH == 1 and value.get('t') == 'start' and value.get('path') == 'f.cpp':
        forward(line)
        os.kill(0, signal.SIGKILL)
    if value.get('t') == 'done':
        value['pad'] = PAD
        forward(json.dumps(value).encode() + b'\\n')
    else:
        forward(line)
sys.exit(child.wait())
`);
  expect(await runAnalysis(cppInput(root, entries, database, {
    interpreter: wrapper, unitTimeoutMs: 60_000, languageTimeoutMs: 120_000,
  }))).toEqual({ status: 'failed', reason: OVER_LIMIT });
}, 180_000);

it('S8D-RUN-10 still reads after the protocol end: a garbage line wins', async () => {
  const entries: Entry[] = [['a.cpp', 'int a;\n'], ['b.cpp', 'int b;\n']];
  const root = await writeTree(entries);
  const { wrapper } = await wrapperScript(`
child = spawn_real()
for line in lines(child):
    forward(line)
    if parse(line).get('t') == 'end':
        sys.stdout.write('garbage\\n')
        sys.stdout.flush()
        time.sleep(60)
sys.exit(child.wait())
`);
  expect(await runAnalysis(cppInput(root, entries, databaseFor(entries), { interpreter: wrapper }))).toEqual({
    status: 'failed', reason: READ_FAILED,
  });
}, 60_000);

it('S8D-RUN-11 stops a process that closes stdout and hangs at the language limit', async () => {
  const entries: Entry[] = [['a.cpp', '#include "a.h"\n'], ['a.h', '#pragma once\n'], ['b.cpp', 'int b;\n']];
  const root = await writeTree(entries);
  const { wrapper } = await wrapperScript(`
child = spawn_real()
for line in lines(child):
    forward(line)
    if parse(line).get('t') == 'ready':
        os.close(1)
        with open(MARKER, 'w') as handle:
            handle.write('closed')
        time.sleep(60)
sys.exit(child.wait())
`);
  const outcome = await runAnalysis(cppInput(root, entries, databaseFor(entries), {
    interpreter: wrapper, unitTimeoutMs: 60_000, languageTimeoutMs: 500,
  }));
  expect(outcome.status).toBe('done');
  if (outcome.status !== 'done') return;
  expect(filesOf(outcome)).toEqual([
    { path: 'a.cpp', status: 'failed', reason: '超时' },
    { path: 'a.h', status: 'skipped', reason: '有编译单元没有做完' },
    { path: 'b.cpp', status: 'failed', reason: '超时' },
  ]);
}, 60_000);

it('S8D-RUN-12 cancels a process that closes stdout and hangs', async () => {
  const entries: Entry[] = [['a.cpp', 'int a;\n'], ['b.cpp', 'int b;\n']];
  const root = await writeTree(entries);
  const { wrapper, marker } = await wrapperScript(`
child = spawn_real()
for line in lines(child):
    forward(line)
    if parse(line).get('t') == 'ready':
        os.close(1)
        with open(MARKER, 'w') as handle:
            handle.write('closed')
        time.sleep(60)
sys.exit(child.wait())
`);
  const controller = new AbortController();
  const pending = runAnalysis(cppInput(root, entries, databaseFor(entries), {
    interpreter: wrapper, unitTimeoutMs: 60_000, languageTimeoutMs: 120_000, signal: controller.signal,
  }));
  await waitFor(async () => await readFile(marker, 'utf8').then(() => true).catch(() => null));
  controller.abort();
  expect(await pending).toEqual({ status: 'cancelled' });
}, 60_000);

it('S8D-RUN-13 restarts when the process exits between units without a protocol end', async () => {
  const entries: Entry[] = [['a.cpp', 'int a;\n'], ['b.cpp', 'int b;\n']];
  const root = await writeTree(entries);
  const { wrapper, counter } = await wrapperScript(`
child = spawn_real()
for line in lines(child):
    value = parse(line)
    forward(line)
    if LAUNCH == 1 and value.get('t') == 'done' and value.get('i') == 0:
        child.kill()
        sys.exit(0)
sys.exit(child.wait())
`);
  const outcome = await runAnalysis(cppInput(root, entries, databaseFor(entries), { interpreter: wrapper }));
  expect(outcome.status).toBe('done');
  if (outcome.status !== 'done') return;
  expect(filesOf(outcome)).toEqual([
    { path: 'a.cpp', status: 'parsed' },
    { path: 'b.cpp', status: 'parsed' },
  ]);
  expect(await launchCount(counter)).toBe(2);
}, 60_000);

it('S8D-RUN-14 rejects an unreadable line that follows the protocol end and unknown index', async () => {
  const entries: Entry[] = [['a.cpp', 'int a;\n'], ['b.cpp', 'int b;\n']];
  const root = await writeTree(entries);
  const { wrapper } = await wrapperScript(`
child = spawn_real()
for line in lines(child):
    forward(line)
    if parse(line).get('t') == 'start':
        sys.stdout.write(json.dumps({'t': 'done', 'i': 9, 'files': [], 'edges': [], 'unresolved': []}) + '\\n')
        sys.stdout.flush()
        time.sleep(60)
sys.exit(child.wait())
`);
  expect(await runAnalysis(cppInput(root, entries, databaseFor(entries), { interpreter: wrapper }))).toEqual({
    status: 'failed', reason: READ_FAILED,
  });
}, 60_000);

it('S8D-RUN-15 rejects a garbage line before any unit while the process is alive', async () => {
  const entries: Entry[] = [['a.cpp', 'int a;\n']];
  const root = await writeTree(entries);
  const { wrapper } = await wrapperScript(`
child = spawn_real()
for line in lines(child):
    forward(line)
    if parse(line).get('t') == 'ready':
        sys.stdout.write('garbage\\n')
        sys.stdout.flush()
        time.sleep(60)
sys.exit(child.wait())
`);
  expect(await runAnalysis(cppInput(root, entries, databaseFor(entries), { interpreter: wrapper }))).toEqual({
    status: 'failed', reason: READ_FAILED,
  });
}, 60_000);

it('S8D-RUN-16 merges a header that fails in every unit by the main-file rule', async () => {
  const entries: Entry[] = [
    ['z.cpp', '#include "h.h"\n'],
    ['a.cpp', '#include "h.h"\n'],
    ['h.h', '#ifdef A\n#if FOO(1)\n#endif\n#else\n#if BAR(1)\n#endif\n#endif\n'],
  ];
  const database: Database = [
    { directory: '.', file: 'z.cpp', arguments: ['c++', '-c', 'z.cpp', '-DA'] },
    { directory: '.', file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp'] },
  ];
  const root = await writeTree(entries);
  const outcome = await runAnalysis(cppInput(root, entries, database));
  expect(outcome.status).toBe('done');
  if (outcome.status !== 'done') return;
  expect(outcome.units).toEqual(['z.cpp', 'a.cpp']);
  // libclang 18: the -DA unit fails h.h with FOO (its main file is z.cpp); the
  // unit without -DA fails it with BAR (its main file is a.cpp). a.cpp sorts
  // first, so the merged reason is BAR, not the unit-0 reason.
  expect(filesOf(outcome)).toEqual([
    { path: 'a.cpp', status: 'parsed' },
    { path: 'h.h', status: 'failed', reason: "预处理出错：function-like macro 'BAR' is not defined" },
    { path: 'z.cpp', status: 'parsed' },
  ]);
  expect(outcome.edges).toEqual([
    { from: 'z.cpp', to: 'h.h' },
    { from: 'a.cpp', to: 'h.h' },
  ]);
  expect(outcome.unresolved).toEqual([]);
}, 60_000);

it('S8D-RUN-17 lets an edge suppress the same specifier unresolved from another unit', async () => {
  const entries: Entry[] = [
    ['main.cpp', '#include HDR\n'],
    ['x.h', '#pragma once\nint x;\n'],
  ];
  const database: Database = [
    { directory: '.', file: 'main.cpp', arguments: ['c++', '-c', 'main.cpp'] },
    { directory: '.', file: 'main.cpp', arguments: ['c++', '-DHDR="x.h"', '-c', 'main.cpp'] },
  ];
  const root = await writeTree(entries);
  const outcome = await runAnalysis(cppInput(root, entries, database));
  expect(outcome.status).toBe('done');
  if (outcome.status !== 'done') return;
  expect(outcome.units).toEqual(['main.cpp', 'main.cpp']);
  // Unit 0 has no HDR definition, so the script records the macro-unexpanded
  // unresolved row; unit 1 defines HDR and yields the edge. The edge retires
  // that (from, specifier) row across units.
  expect(outcome.edges).toEqual([{ from: 'main.cpp', to: 'x.h' }]);
  expect(outcome.unresolved).toEqual([]);
  expect(filesOf(outcome)).toEqual([
    { path: 'main.cpp', status: 'parsed' },
    { path: 'x.h', status: 'parsed' },
  ]);
}, 60_000);
