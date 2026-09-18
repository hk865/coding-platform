import '../coordination/process-loader.mjs';
import { readFileSync, appendFileSync } from 'node:fs';
const { createGuiServer } = await import('../../src/app/server.ts');
const { ControlEngineImpl } = await import('../../src/control/control-engine/control-engine.ts');
const { createBuiltinProviderRegistry } = await import('../../vendor/coding-agent/dist/public-api.js');
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'query-process-goal' };
const registry = createBuiltinProviderRegistry();
const client = { async *stream(request) {
  if (request.tools.some(tool => ['edit', 'shell'].includes(tool.name))) throw Error('Query gained writer authority');
  appendFileSync(config.counter, JSON.stringify({ pid: process.pid, requestId: request.requestId }) + '\n', { flush: true });
  if (config.fault === 'provider_effect') process.exit(86);
  yield { schemaVersion: 1, requestId: request.requestId, sequence: 1, type: 'text_delta', delta: JSON.stringify({ schemaVersion: 1, language: 'en', blocks: [{ kind: 'explanation', text: 'Durable query process witness.', basis: [] }] }) };
  yield { schemaVersion: 1, requestId: request.requestId, sequence: 2, type: 'completed', reason: 'final_answer' };
} };
if (config.fault === 'before_answer_commit') {
  ControlEngineImpl.prototype.recordQueryAnswer = async function () { process.exit(86); };
}
const app = await createGuiServer(config.data, {
  workspaceRoots: { 'acceptance-alpha': config.root, 'acceptance-beta': config.root },
  modelSettings: { directory: config.settings, registry: { list: () => registry.list(), get: id => registry.get(id), create: () => client } },
});
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + app.server.address().port;
const token = (await (await fetch(base + '/api/meta')).json()).workspaceToken;
async function post(path, body) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) });
  const result = await response.json();
  if (response.status !== 200) throw Error(path + ': ' + JSON.stringify(result));
  return result;
}
try {
  if (config.fault) {
    await post('/api/model-settings', { provider: 'deepseek', model: 'labelled-process-query-stub', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' });
    await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Keep a read-only answer across process loss.' });
    await post('/api/real/queries', { ...scope, requestId: 'process-query', question: 'Explain the current public status.' });
  }
  const deadline = Date.now() + 30000;
  for (;;) {
    const state = await (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json();
    const runs = (await post('/api/real/queries/runs', scope)).runs;
    const job = state.queries?.find(row => row.queryJobId === 'real-query-process-query' || row.jobRef?.queryJobId === 'real-query-process-query');
    if (!config.fault && runs.length && runs.every(run => run.status !== 'running') && (state.queries?.some(row => row.currentAnswer) || runs[0].status === 'outcome_unknown')) {
      process.stdout.write(JSON.stringify({ pid: process.pid, queries: state.queries, runs: runs.map(({ status, result, runRef }) => ({ status, result, runRef })) }) + '\n');
      break;
    }
    if (Date.now() > deadline) throw Error('Host did not reach expected process boundary: ' + JSON.stringify({ job, runs }));
    await new Promise(resolve => setTimeout(resolve, 20));
  }
} finally { await app.close(); }
