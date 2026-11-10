/**
 * B1-13 of the frozen test sheet (`darr-b1-tests.frozen.md` §2.2, the sheet): one real C/C++ analyzer
 * restart must not count the same `(from,to,specifier)` triple twice.
 *
 * The entry is the module contract `runAnalysis` with the real `scripts/cpp-source-query.py`
 * (the A24 `pythonPath` wrapper pattern): the first process forwards `done(a)` and exits before
 * `b`; the second resumes at `b` (which does not include `shared.h`) and then processes `c.cpp`,
 * which includes `shared.h` -> `leaf.h`. The triple appears once in each process; the count stays
 * 1. No scripted model, no Host, no record.
 */
import { afterEach, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAnalysis, type AnalysisRunOutcome } from '../../src/core/workspace/analysis-runner.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const databaseOf = (root: string) => [
  { directory: root, file: 'a.cpp', arguments: ['c++', '-c', 'a.cpp'] },
  { directory: root, file: 'b.cpp', arguments: ['c++', '-c', 'b.cpp'] },
  { directory: root, file: 'c.cpp', arguments: ['c++', '-c', 'c.cpp'] },
];
const FILES = [
  ['a.cpp', '#include "shared.h"\n'],
  ['b.cpp', 'int b;\n'],
  ['c.cpp', '#include "shared.h"\n'],
  ['shared.h', '#include "leaf.h"\n'],
  ['leaf.h', 'int leaf;\n'],
] as const;

/** The A24 wrapper: forward the real interpreter and exit after the first process's first done. */
async function restartWrapper(): Promise<{ wrapper: string; launches: string }> {
  const directory = await mkdtemp(join(tmpdir(), 's8b1-runner-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const launches = join(directory, 'launches.txt');
  const wrapper = join(directory, 'wrapper.py');
  await writeFile(wrapper, `#!/usr/bin/python3
import json, subprocess, sys

COUNTER = ${JSON.stringify(launches)}
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
script = sys.argv[sys.argv.index('import_graph') - 1]
child = subprocess.Popen([sys.executable, '-I', '-S', script, 'import_graph'], stdout=subprocess.PIPE)
for line in child.stdout:
    sys.stdout.buffer.write(line)
    sys.stdout.buffer.flush()
    if launch != 1:
        continue
    try:
        value = json.loads(line)
    except Exception:
        continue
    if value.get('t') == 'done':
        sys.exit(0)
sys.exit(child.wait())
`);
  await chmod(wrapper, 0o755);
  return { wrapper, launches };
}

const launchCount = async (path: string): Promise<number> =>
  Number((await readFile(path, 'utf8').catch(() => '0')).trim() || '0');

it('B1-13 a shared header read in both analyzer processes keeps shared.h -> leaf.h count 1', async () => {
  const { wrapper, launches } = await restartWrapper();
  const root = await mkdtemp(join(tmpdir(), 's8b1-runner-root-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of FILES) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await writeFile(join(root, 'compile_commands.json'), `${JSON.stringify(databaseOf(root))}\n`);
  const script = fileURLToPath(new URL('../../scripts/cpp-source-query.py', import.meta.url));
  const outcome: AnalysisRunOutcome = await runAnalysis({
    language: 'cpp',
    interpreter: wrapper,
    script,
    paths: ['a.cpp', 'b.cpp', 'c.cpp', 'shared.h', 'leaf.h'],
    files: FILES.map(([path, content]) => ({ path, content })),
    config: {
      libraryPath: '/usr/lib/llvm-18/lib/libclang.so.1',
      databases: [{ path: 'compile_commands.json', content: `${JSON.stringify(databaseOf(root))}\n` }],
      workspaceRoot: root,
      workspaceRealRoot: root,
    },
    unitTimeoutMs: 60_000,
    signal: new AbortController().signal,
  });
  expect(outcome.status).toBe('done');
  if (outcome.status !== 'done') return;
  const edge = (outcome.edges as Array<{ from: string; to: string; count?: number }>)
    .find(candidate => candidate.from === 'shared.h' && candidate.to === 'leaf.h');
  expect(edge).toBeDefined();
  // The restart really happened: launch 1 forwarded done(a) and exited; launch 2 resumed at b.
  expect(await launchCount(launches)).toBe(2);
  expect(edge?.count).toBe(1);

  // Named mutation: count every triple occurrence across units instead of the first
  // `(from,to,specifier)`; this row's `count` then becomes 2.
}, 120_000);
