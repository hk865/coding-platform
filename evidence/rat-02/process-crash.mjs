import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const dir = await mkdtemp('/tmp/rat02-crash-'), data = join(dir, 'data'), root = join(dir, 'project'); await mkdir(root);
let requests = 0, child;
const provider = createServer(async (req) => { for await (const _ of req) { /* consume, then hang */ } requests++; });
await new Promise(r => provider.listen(0, '127.0.0.1', r));
const providerUrl = `http://127.0.0.1:${provider.address().port}`;
async function start() {
  const code = `import {createGuiServer} from ${JSON.stringify(new URL('../../dist/app/server.js', import.meta.url).href)}; const app = await createGuiServer(${JSON.stringify(data)}, {modelSettings:{directory:${JSON.stringify(join(dir, 'secret'))}}}); app.server.listen(0,'127.0.0.1',()=>console.log(app.server.address().port)); process.on('SIGTERM',()=>app.close().then(()=>process.exit(0)));`;
  child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((r, reject) => { let text = ''; child.stdout.on('data', chunk => { text += chunk; if (/^\d+\n/.test(text)) r(Number(text.trim())); }); child.once('exit', () => reject(Error('GUI child exited before listening'))); });
  const base = `http://127.0.0.1:${port}`; const token = (await (await fetch(base + '/api/meta')).json()).workspaceToken;
  return { base, post: async (path, body) => { const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); const value = await res.json(); assert.equal(res.status, 200, JSON.stringify(value)); return value; } };
}
try {
  let gui = await start();
  await gui.post('/api/model-settings', { provider: 'deepseek', model: 'hang', apiKey: 'synthetic-only', baseUrl: providerUrl });
  const project = await gui.post('/api/projects/add', { path: root }); const scope = { projectId: project.projectId, workspaceId: project.workspaceId, goalId: 'crash-goal' };
  await gui.post('/api/goals', { ...scope, requestId: 'crash-goal', objective: 'crash recovery verification' });
  await gui.post('/api/real/tasks', { ...scope, requestId: 'crash-run', instruction: 'Wait for model response', allowWrite: true });
  const deadline = Date.now() + 10000; while (requests !== 1) { if (Date.now() > deadline) throw Error('model did not start'); await new Promise(r => setTimeout(r, 25)); }
  const killed = new Promise(r => child.once('exit', r)); child.kill('SIGKILL'); await killed;
  gui = await start();
  const state = await (await fetch(gui.base + '/api/state?' + new URLSearchParams(scope))).json();
  assert.equal(state.liveRuns[0].status, 'outcome_unknown');
  assert.equal(state.agents.agents.rows[0].runOutcome, 'outcome_unknown');
  assert.equal(requests, 1); assert(await readFile(join(root, '.platform-runtime/run.lock'), 'utf8'));
  const report = { status: 'PASS', actualHostKilled: true, modelRequestsBeforeAndAfter: 1, runtimeStatus: state.liveRuns[0].status, canonicalRunOutcome: state.agents.agents.rows[0].runOutcome, staleWorkspaceLockPreserved: true, automaticRetry: false, liveProviderCalls: 0 };
  await writeFile('evidence/rat-02/process-crash.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
} finally {
  if (child && child.exitCode === null) { const end = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await end; }
  provider.closeAllConnections(); await new Promise(r => provider.close(r)); await rm(dir, { recursive: true, force: true });
}
