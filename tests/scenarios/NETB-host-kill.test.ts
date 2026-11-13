/**
 * NB-17 (netb-start-rulings §0 item 1, §2.2 item 5, §2.5; SQLite only: a real Host is killed and a new one opens its
 * files): the host a Run's command was connecting to is written before the proxy dials, so it survives a Host crash
 * and the unknown-call review the next Host builds (RUN-25) carries it as `network` for the adviser. Written the way
 * K3-07 is: the child Host (tests/helpers/NETB-host-child.mjs, on `dist/`) has K3-07's startup file (the Work has
 * `shell`), the Host input `networkProvider` (A8) and the clock 2026-09-28T00:00:00.000Z; its one `shell` call fetches
 * `http://pkg.example/hold`, which the stub takes and never answers. Once the stub has it, the parent SIGKILLs the
 * child and opens `startAG2bHost` on the same files, re-drive off. Real bubblewrap; no database read.
 * Red today: the build has no proxy, so the wait for the stub fails (60 s); past it the review has no `network`.
 * Green after B2, on a build of that tree. Mutations: the review draft does not read the host record (no `network`);
 * the host written when the Run ends instead of before the dial (the killed Run never ends: hosts `[]`).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import {
  AG2B_AT, AG2B_SCOPE, AG2B_SECRET_VALUE, AG2B_SECRET_VAR, cleanupAG2b, corePost, plain, readPageToken, seedAG2bWorkGraph,
  startAG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  advanceUntil, cleanupRestart, deferred, post, publicDirectory, selectWork, tempDir, writeAutomationSettings,
} from '../helpers/A2-restart-fixture.js';
import { k307HostConfig, k307RemoteHost, killK307Host } from '../helpers/K3-07-support.js';
import { hostReconcile } from '../helpers/KLS1B-host-store.js';
import { makeRLWorkspace, removeRLWorkspace, requireRLCapabilities } from '../helpers/RL-resource-caps-support.js';
import { redrivePolicy } from './support/common.js';
import { initGitWorkspace } from './support/git-workspace.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await cleanupAG2b();
  await cleanupRestart();
});

/** Spawn the child Host and wait for its one ready line (or its exit, with its stderr). */
async function spawnNetbHost(env: Record<string, string>, cwd: string): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../helpers/NETB-host-child.mjs', import.meta.url))],
    { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  cleanups.push(async () => { await killK307Host(child); });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
  if (child.stdout === null) throw new Error('the NETB child has no stdout');
  const [line] = await Promise.race([once(createInterface({ input: child.stdout }), 'line'),
    once(child, 'exit').then(() => { throw new Error(`the NETB child exited before its ready line:\n${stderr}`); })]) as [string];
  return { child, url: (JSON.parse(line) as { url: string }).url };
}

it('NB-17 (SQLite only, real Host SIGKILL) the review of a Run killed mid-request lists the host its command was connecting to', async () => {
  const sandbox = await makeRLWorkspace();
  try { await requireRLCapabilities(sandbox); } finally { await removeRLWorkspace(sandbox); }
  const missing = ['dist/app/main.js', 'dist/app/host.js'].filter(path => !existsSync(path));
  if (missing.length > 0) throw new Error(`NB-17 needs the build output; run npm run build first (missing ${missing.join(', ')})`);
  const held = deferred();
  const stub = createServer(request => { if (request.url === '/hold') held.resolve(); });
  await new Promise<void>(resolve => { stub.listen(0, '127.0.0.1', resolve); });
  cleanups.push(async () => { stub.closeAllConnections(); stub.close(); });
  const [root, database, configDir, publicDir] = [await tempDir('netb-17-ws-'), await tempDir('netb-17-db-'),
    await tempDir('netb-17-config-'), await publicDirectory()];
  await initGitWorkspace(root);
  await writeFile(join(configDir, 'workbench.json'), JSON.stringify(k307HostConfig({ database, root })));
  const { child, url } = await spawnNetbHost({ NETB_CONFIG: join(configDir, 'workbench.json'), NETB_PUBLIC_DIR: publicDir,
    NETB_NOW: AG2B_AT, NETB_STUB_PORT: String((stub.address() as { port: number }).port),
    NETB_SECRET_VARIABLE: AG2B_SECRET_VAR, NETB_SECRET_VALUE: AG2B_SECRET_VALUE,
    NETB_COMMAND: `python3 -c 'import urllib.request as r; r.urlopen("http://pkg.example/hold", timeout=120)'` }, root);
  const token = await readPageToken(url);
  const remote = k307RemoteHost(url, token);
  await seedAG2bWorkGraph(remote);
  const start = await advanceUntil(remote, selectWork('netb-17'), 'start');
  corePost(url, 'workflow/advance', token, plain(AG2B_SCOPE, start)).catch(() => undefined);
  await Promise.race([held.promise, new Promise((_, reject) => {
    setTimeout(() => { reject(new Error('the command never reached the stub upstream')); }, 60_000).unref();
  })]);
  await killK307Host(child);

  await writeAutomationSettings(database, redrivePolicy(false));
  const second = await startAG2bHost(publicDir, { root, database, replies: [] });
  cleanups.push(async () => { await second.host.close(); });
  const line = hostReconcile(second.host, AG2B_SCOPE.projectId).report?.runs.find(candidate => candidate.row === 'W-26');
  if (line === undefined) throw new Error('the killed Run must be reconciled as W-26');
  const review = await post<ReadResult<UnknownCallReviewV1>>(second, 'unknown-call-reviews/read',
    plain(AG2B_SCOPE, { runRef: JSON.parse(line.ref) as RunRef }));
  if (review.status !== 'ready') throw new Error(`the review must be readable: ${JSON.stringify(review)}`);
  expect(review.value.network).toEqual({ omitted: 0, hosts: [
    { host: 'pkg.example', port: 80, address: '93.184.216.34', verdict: 'allowed', firstAt: '2026-09-28T00:00:00.000Z' }] });
}, 180_000);
