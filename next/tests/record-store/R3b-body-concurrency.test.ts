import { afterEach, expect, it } from 'vitest';
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
type WorkerResult = { phase: 'done'; runId: string; result: { status: 'ready'; value: { ref: ArtifactRef; replayed: boolean } } };

function contender(modulePath: string, databasePath: string, runId: string) {
  const workerPath = join(project, 'tests/record-store/sqlite-body-race-worker.mjs');
  const child = fork(workerPath, [modulePath, databasePath, runId], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr += String(chunk); });
  let preopen!: () => void;
  let failPreopen!: (reason: Error) => void;
  const enteredBeforeOpen = new Promise<void>((accept, reject) => { preopen = accept; failPreopen = reject; });
  let ready!: () => void;
  let failReady!: (reason: Error) => void;
  const entered = new Promise<void>((accept, reject) => { ready = accept; failReady = reject; });
  let done!: (value: WorkerResult) => void;
  let failDone!: (reason: Error) => void;
  const completed = new Promise<WorkerResult>((accept, reject) => { done = accept; failDone = reject; });
  // All phase promises may be rejected by an early startup failure before the
  // parent reaches its later await; attach observers to avoid unhandled rejections.
  void enteredBeforeOpen.catch(() => {});
  void entered.catch(() => {});
  void completed.catch(() => {});
  const timer = setTimeout(() => {
    child.kill(); const error = Error(`${runId} timed out: ${stderr}`);
    failPreopen(error); failReady(error); failDone(error);
  }, 10000);
  child.on('message', message => {
    const value = message as { phase?: string; runId?: string; result?: WorkerResult['result']; message?: string };
    if (value.phase === 'preopen') preopen();
    else if (value.phase === 'ready') ready();
    else if (value.phase === 'done' && value.result) { clearTimeout(timer); done({ phase: 'done', runId, result: value.result }); }
    else if (value.phase === 'error') {
      clearTimeout(timer); const error = Error(`${runId}: ${value.message ?? stderr}`);
      failPreopen(error); failReady(error); failDone(error);
    }
  });
  child.on('error', error => { clearTimeout(timer); failPreopen(error); failReady(error); failDone(error); });
  child.on('exit', code => {
    if (code !== 0) {
      clearTimeout(timer); const error = Error(`${runId} exited ${code}: ${stderr}`);
      failPreopen(error); failReady(error); failDone(error);
    }
  });
  return { child, enteredBeforeOpen, entered, completed };
}

it('two real SQLite processes preserve one first owner/source and one content ref after concurrent puts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'next-r3b-body-race-'));
  directories.push(dir);
  const output = join(dir, 'compiled');
  const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
  // Compile only the new raw-body entry and its imported contract closure. This
  // makes the subprocess test independent of a prior full next build or old src.
  execFileSync(process.execPath, [tsc, '--ignoreConfig', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--target', 'ES2024', '--strict', '--skipLibCheck', '--types', 'node', '--outDir', output,
    '--rootDir', join(project, 'src'), join(project, 'src/core/record-store/sqlite-body-store.ts')],
  { cwd: project, stdio: 'pipe' });
  await writeFile(join(output, 'package.json'), '{"type":"module"}');
  const modulePath = join(output, 'core/record-store/sqlite-body-store.js');
  const databasePath = join(dir, 'artifacts.sqlite');
  const a = contender(modulePath, databasePath, 'run-a');
  const b = contender(modulePath, databasePath, 'run-b');
  try {
    await Promise.all([a.enteredBeforeOpen, b.enteredBeforeOpen]);
    a.child.send('open'); b.child.send('open');
    await Promise.all([a.entered, b.entered]);
    a.child.send('put'); b.child.send('put');
    const [first, second] = await Promise.all([a.completed, b.completed]);
    expect(first.result.status).toBe('ready'); expect(second.result.status).toBe('ready');
    const results = [first, second];
    expect(results.filter(item => item.result.value.replayed === false)).toHaveLength(1);
    expect(results.filter(item => item.result.value.replayed === true)).toHaveLength(1);
    expect(first.result.value.ref).toEqual(second.result.value.ref);
    const winner = results.find(item => !item.result.value.replayed)!;
    const reopened = createSqliteRawArtifactStore(databasePath);
    try {
      expect(await reopened.read(winner.result.value.ref)).toMatchObject({ status: 'ready', value: {
        body: 'identical concurrent body', sourceRefs: [{ revision: winner.runId }],
        origin: { kind: 'run', owner: { runId: winner.runId } },
      } });
    } finally { await reopened.close(); }
  } finally { a.child.kill(); b.child.kill(); }
});
