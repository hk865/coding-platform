/**
 * Slice 8D acceptance entry A-24 (spec §11.6 lines 780–784, round-2 item 8):
 * the C/C++ runner's unit timeout, crash and exit handling. A-24 stays memory
 * only, but runs through the SAME public platform fixture A-06 uses:
 * captureSourceChanges -> listFiles. Literal expectations are §11.6's and do
 * not change.
 */
import { afterEach, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, type Entry, type GraphShape } from '../helpers/S8D-platform-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const coverageOf = (graph: GraphShape, language: string) => graph.languages.find(entry => entry.language === language);

const DATABASE = [
  { directory: '.', file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp'] },
  { directory: '.', file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp'] },
  { directory: '.', file: 'c.cpp', arguments: ['c++', '-c', 'c.cpp'] },
  { directory: '.', file: 'd.cpp', arguments: ['c++', '-c', 'd.cpp'] },
];
const ENTRIES: Entry[] = [
  ['compile_commands.json', `${JSON.stringify(DATABASE)}\n`],
  ['a.cpp', '#include "a.h"\n'], ['a.h', 'int a;\n'],
  ['b.cpp', '#include "b.h"\n'], ['b.h', 'int b;\n'],
  ['c.cpp', 'int c;\n'],
  ['d.cpp', '#include "d.h"\n'], ['d.h', 'int d;\n'],
];

type Action = { on: string; action: 'hang' | 'kill' | 'marker' };

/** A `pythonPath` wrapper that forwards the real interpreter's stdin/stdout and keys on
 * the `start` line's main path, or (for A-24 (3)) on its own launch count. */
async function wrapperScript(options: { actions: Action[]; marker?: string; exitOnLaunch?: number }) {
  const directory = await mkdtemp(join(tmpdir(), 's8d-a24-wrapper-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const counter = join(directory, 'launches.txt');
  const wrapper = join(directory, 'wrapper.py');
  const actions = Object.fromEntries(options.actions.map(item => [item.on, item.action]));
  await writeFile(wrapper, `#!/usr/bin/python3
import json, os, signal, subprocess, sys, time

COUNTER = ${JSON.stringify(counter)}
ACTIONS = ${JSON.stringify(actions)}
MARKER = ${JSON.stringify(options.marker ?? '')}
EXIT_ON_LAUNCH = ${options.exitOnLaunch ?? 0}

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

launch = bump()
if EXIT_ON_LAUNCH and launch >= EXIT_ON_LAUNCH:
    sys.exit(3)
script = sys.argv[sys.argv.index('import_graph') - 1]
child = subprocess.Popen([sys.executable, '-I', '-S', script, 'import_graph'], stdout=subprocess.PIPE)
for line in child.stdout:
    sys.stdout.buffer.write(line)
    sys.stdout.buffer.flush()
    try:
        value = json.loads(line)
    except Exception:
        continue
    if value.get('t') != 'start':
        continue
    action = ACTIONS.get(value.get('path'))
    if action == 'hang':
        time.sleep(3600)
    elif action == 'kill':
        os.kill(0, signal.SIGKILL)
    elif action == 'marker':
        with open(MARKER, 'w') as handle:
            handle.write(json.dumps({'pid': os.getpid(), 'pgid': os.getpgid(0)}))
        time.sleep(3600)
sys.exit(child.wait())
`);
  await chmod(wrapper, 0o755);
  return { wrapper, counter };
}

const launchCount = async (counter: string) => Number((await readFile(counter, 'utf8').catch(() => '0')).trim() || '0');

const expectedNotes = ['近似：不读系统头文件和观测以外的头文件'];
const skippedUnfinished = (path: string) => ({ path, kind: 'skipped', reason: '有编译单元没有做完' });

it('A-24 (1) recovers from a unit timeout and a crash by restarting, keeping the done units', async () => {
  const { wrapper, counter } = await wrapperScript({ actions: [
    { on: 'b.cpp', action: 'hang' }, { on: 'c.cpp', action: 'kill' },
  ] });
  const f = await fixture('memory', 's8d-a24-runner', ENTRIES, {
    sourceAnalyzers: { pythonPath: wrapper, unitTimeoutMs: 1000 },
  });
  try {
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 7, parsed: 4, edges: 'supported', reason: null, notes: expectedNotes,
      issues: [
        { path: 'b.cpp', kind: 'failed', reason: '超时' },
        skippedUnfinished('b.h'),
        { path: 'c.cpp', kind: 'failed', reason: '分析进程崩溃' },
      ],
      issueCount: 3, complete: false,
    });
    expect(graph.edges).toEqual([{ from: 'a.cpp', to: 'a.h' }, { from: 'd.cpp', to: 'd.h' }]);
    expect(await launchCount(counter)).toBe(3);
  } finally {
    await f.close();
  }
}, 60000);

it('A-24 (2) gives every undone unit the language timeout and stops the language', async () => {
  const { wrapper, counter } = await wrapperScript({ actions: [{ on: 'b.cpp', action: 'hang' }] });
  const f = await fixture('memory', 's8d-a24-runner', ENTRIES, { sourceAnalyzers: {
    pythonPath: wrapper, unitTimeoutMs: 60000, languageTimeoutMs: 5000,
  } });
  try {
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 7, parsed: 2, edges: 'supported', reason: null, notes: expectedNotes,
      issues: [
        { path: 'b.cpp', kind: 'failed', reason: '超时' },
        skippedUnfinished('b.h'),
        { path: 'c.cpp', kind: 'failed', reason: '超时' },
        { path: 'd.cpp', kind: 'failed', reason: '超时' },
        skippedUnfinished('d.h'),
      ],
      issueCount: 5, complete: false,
    });
    expect(graph.edges).toEqual([{ from: 'a.cpp', to: 'a.h' }]);
    expect(await launchCount(counter)).toBe(1);
  } finally {
    await f.close();
  }
}, 60000);

it('A-24 (3) fails every undone unit when the restarted process exits before its first unit', async () => {
  const { wrapper, counter } = await wrapperScript({
    actions: [{ on: 'b.cpp', action: 'kill' }], exitOnLaunch: 2,
  });
  const f = await fixture('memory', 's8d-a24-runner', ENTRIES, {
    sourceAnalyzers: { pythonPath: wrapper, unitTimeoutMs: 60000 },
  });
  try {
    const graph = await f.graph();

    expect(coverageOf(graph, 'cpp')).toEqual({
      language: 'cpp', files: 7, parsed: 2, edges: 'supported', reason: null, notes: expectedNotes,
      issues: [
        { path: 'b.cpp', kind: 'failed', reason: '分析进程崩溃' },
        skippedUnfinished('b.h'),
        { path: 'c.cpp', kind: 'failed', reason: '分析运行失败：重启后的进程在新单元前退出（退出码 3）' },
        { path: 'd.cpp', kind: 'failed', reason: '分析运行失败：重启后的进程在新单元前退出（退出码 3）' },
        skippedUnfinished('d.h'),
      ],
      issueCount: 5, complete: false,
    });
    expect(graph.edges).toEqual([{ from: 'a.cpp', to: 'a.h' }]);
    expect(await launchCount(counter)).toBe(2);
  } finally {
    await f.close();
  }
}, 60000);

it('A-24 (4) cancels the observation and kills the wrapper process group', async () => {
  const directory = await mkdtemp(join(tmpdir(), 's8d-a24-cancel-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, 'marker.json');
  const { wrapper, counter } = await wrapperScript({
    actions: [{ on: 'b.cpp', action: 'marker' }], marker,
  });
  const controller = new AbortController();
  const f = await fixture('memory', 's8d-a24-runner', ENTRIES, {
    signal: controller.signal,
    sourceAnalyzers: { pythonPath: wrapper, unitTimeoutMs: 60000 },
  });
  try {
    const pending = f.graphResult();
    let group: { pid: number; pgid: number } | null = null;
    const deadline = Date.now() + 30000;
    while (group === null) {
      const text = await readFile(marker, 'utf8').catch(() => null);
      if (text !== null) group = JSON.parse(text) as { pid: number; pgid: number };
      else if (Date.now() > deadline) throw Error('wrapper never reached b.cpp');
      else await new Promise(resolve => setTimeout(resolve, 25));
    }
    controller.abort();
    expect(await pending).toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(group.pgid).toBe(group.pid);
    const alive = () => {
      try { process.kill(-group!.pgid, 0); return true; } catch { return false; }
    };
    const groupDeadline = Date.now() + 5000;
    while (alive()) {
      if (Date.now() > groupDeadline) throw Error('wrapper process group still alive after cancel');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(await launchCount(counter)).toBe(1);
  } finally {
    await f.close();
  }
}, 60000);
