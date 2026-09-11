import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'err-default-cli-'));
let logs = '', errors = '';
const server = spawn(process.execPath, [resolve('dist/app/server.js')], {
  cwd: directory, env: { ...process.env, PLATFORM_GUI_DATA: join(directory, 'data'), PORT: '44319' }, stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', b => { logs += b; }); server.stderr.on('data', b => { errors += b; });
try {
  const base = 'http://127.0.0.1:44319';
  let ready = false;
  for (let i = 0; i < 600; i++) {
    if (server.exitCode !== null) throw Error(errors);
    try { ready = (await fetch(base + '/api/meta')).ok; if (ready) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true);
  const meta = await (await fetch(base + '/api/meta')).json();
  assert.equal(meta.executionCapability.fixtureEnabled, true);
  const post = async (path, input) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'acceptance-demo', ...input }) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  await post('/api/plans/sample', {});
  const result = await post('/api/tasks/run', { taskId: 'task-install-contract' });
  assert.equal(result.drive.started, 1); assert.equal(result.drive.completed, 1); assert.deepEqual(result.drive.failures, []);
  console.log(JSON.stringify({ status: 'PASS', entry: 'node dist/app/server.js (actual default CLI)', fixtureEnabled: true, drive: result.drive, dataDirectory: directory }));
} finally {
  server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve));
  console.log(logs); if (errors) console.error(errors);
}
