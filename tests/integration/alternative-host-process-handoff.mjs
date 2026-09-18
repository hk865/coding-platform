import '../coordination/process-loader.mjs';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
const { createGuiServer } = await import('../../src/app/server.ts');
const { HandoffRequest } = await import('../../src/control/dispatch-engine/handoff/handoff-request.ts');
const { RuntimeDispatch } = await import('../../src/control/dispatch-engine/runtime-dispatch.ts');
const { createBuiltinProviderRegistry } = await import('../../vendor/coding-agent/dist/public-api.js');
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'handoff-process' };
let writerCalls = 0, hold = false;
const originalDrive = RuntimeDispatch.prototype.drive;
RuntimeDispatch.prototype.drive = function (request) { return hold ? Promise.resolve({ scanned: 0, started: 0, completed: 0, pendingRemaining: 1, failures: [] }) : originalDrive.call(this, request); };
if (config.fault === 'after_commit') {
  const submit = HandoffRequest.prototype.submit;
  HandoffRequest.prototype.submit = async function (input) { const result = await submit.call(this, input); writeFileSync(config.receipt, JSON.stringify({ pid: process.pid, result }), { flush: true }); process.exit(86); };
}
const registry = createBuiltinProviderRegistry();
const client = { async *stream(request, options) {
  const writer = request.tools.some(tool => tool.name === 'edit');
  appendFileSync(config.counter, JSON.stringify({ pid: process.pid, writer, requestId: request.requestId }) + '\n', { flush: true });
  if (writer && config.fault && ++writerCalls === 1) {
    await new Promise(done => { if (options.signal?.aborted) done(); else options.signal?.addEventListener('abort', done, { once: true }); }); return;
  }
  if (writer && config.fault === 'provider_effect') process.exit(86);
  yield { schemaVersion: 1, requestId: request.requestId, sequence: 1, type: 'text_delta', delta: 'Work finished; independent verification remains.' };
  yield { schemaVersion: 1, requestId: request.requestId, sequence: 2, type: 'completed', reason: 'final_answer' };
} };
const app = await createGuiServer(config.data, { workspaceRoots: { 'acceptance-alpha': config.root, 'acceptance-beta': config.root }, modelSettings: { directory: config.settings, registry: { list: () => registry.list(), get: id => registry.get(id), create: () => client } } });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + app.server.address().port;
const token = (await (await fetch(base + '/api/meta')).json()).workspaceToken;
async function post(path, body) { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); const value = await r.json(); if (r.status !== 200) throw Error(path + ': ' + JSON.stringify(value)); return value; }
const input = { ...scope, requestId: 'replace', sourceRunId: 'real-writer', reason: 'Continue without assuming verification.' };
async function until(check) { const end = Date.now() + 30000; for (;;) { const value = await (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json(); if (check(value)) return value; if (Date.now() > end) throw Error('Handoff process timeout: ' + JSON.stringify(value.liveRuns)); await new Promise(resolve => setTimeout(resolve, 20)); } }
try {
  if (config.fault) {
    await post('/api/model-settings', { provider: 'deepseek', model: 'labelled-handoff-process-stub', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' });
    await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Preserve handoff authority across host process loss.' });
    await post('/api/real/tasks', { ...scope, requestId: 'writer', instruction: 'Wait.', allowWrite: true });
    await until(() => writerCalls === 1);
    await post('/api/real/cancel', { ...scope, runId: 'real-writer' });
    await until(s => s.liveRuns.some(r => r.spec.runId === 'real-writer' && r.canonicalStatus === 'ended'));
    hold = config.fault === 'after_commit';
    const result = await post('/api/real/handoff', input);
    writeFileSync(config.receipt, JSON.stringify({ pid: process.pid, result }), { flush: true });
    await until(() => false);
  } else {
    const replay = await post('/api/real/handoff', input);
    const state = await until(s => s.liveRuns.some(r => r.spec.runId === replay.runId && r.canonicalStatus === 'ended'));
    const run = state.liveRuns.find(r => r.spec.runId === replay.runId);
    process.stdout.write(JSON.stringify({ pid: process.pid, replay, run: { status: run.status, canonicalStatus: run.canonicalStatus, runId: run.spec.runId } }) + '\n');
  }
} finally { await app.close(); }
