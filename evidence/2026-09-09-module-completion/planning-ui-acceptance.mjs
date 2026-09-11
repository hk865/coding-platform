import { createGuiServer } from '../../dist/app/server.js';
import { createBuiltinProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';
import { chromium } from '../../src/ui/node_modules/playwright-core/index.mjs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const out = resolve(import.meta.dirname), temp = await mkdtemp(join(tmpdir(), 'planning-ui-')), root = join(temp, 'source'), data = join(temp, 'data');
await mkdir(root); await mkdir(data); await writeFile(join(root, 'README.md'), 'Public source for planning UI acceptance.');
const requests = [], builtin = createBuiltinProviderRegistry();
function plan(name) { return { kind: 'plan', summary: '实现 ' + name + ' 并独立检查行为。', assignments: [{ taskId: name, role: 'executor', instruction: 'Implement ' + name + ' and report public evidence; independent acceptance remains required.' }], plan: {
  stages: [{ stageId: name + '-stage', title: name + ' 开发' }], tasks: [
    { taskId: name, stageId: name + '-stage', title: name + ' 实现', taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: name + '-stage' } },
    { taskId: name + '-gate', title: name + ' 独立验收', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
  obligations: [{ obligationId: name + '-contract', title: name + ' 行为契约', requirementLevel: 'required', taskIds: [name, name + '-gate'], verificationRequirements: [{ requirementId: name + '-behavior', requirementLevel: 'required', kind: 'dynamic', description: 'Independently validate ' + name }] }],
  taskHierarchy: { parentOf: [{ parentTaskId: name + '-gate', childTaskId: name }] }, executionDag: { dependsOn: [{ taskId: name + '-gate', dependsOnId: name, requires: { kind: 'artifact', label: name + ' 实现产物' } }] } } }; }
const client = { async *stream(request) {
  requests.push(structuredClone(request)); const c = { schemaVersion: 1, requestId: request.requestId }, input = JSON.stringify(request.messages);
  const content = input.includes('initial_coordination') ? JSON.stringify(plan(input.includes('receipt-beta') ? 'beta' : 'alpha')) : request.tools.some(tool => tool.name === 'edit') ? 'Implementation run returned a public report. Independent review is still required.' : '当前公开源码由 README.md 提供；此回答来自独立只读查询。';
  yield { ...c, sequence: 1, type: 'text_delta', delta: content }; yield { ...c, sequence: 2, type: 'usage_snapshot', usage: { inputTokens: 120, outputTokens: 90, cachedInputTokens: 0, costUsdMicros: null } }; yield { ...c, sequence: 3, type: 'completed', reason: 'final_answer' };
} };
const options = { workspaceRoots: { 'acceptance-alpha': root, 'acceptance-beta': root }, modelSettings: { directory: join(temp, 'settings'), registry: { list: () => builtin.list(), get: id => builtin.get(id), create: () => client } } };
let app, base, browser; const results = { realModel: false, kind: 'browser-real-kernel-labelled-model-stub', temp, steps: [] };
const ensure = (condition, message) => { if (!condition) throw Error(message); };
const start = async () => { app = await createGuiServer(data, options); await new Promise(done => app.server.listen(0, '127.0.0.1', done)); base = 'http://127.0.0.1:' + app.server.address().port; };
const api = async (path, body) => { const meta = await (await fetch(base + '/api/meta')).json(); const response = await fetch(base + path, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { 'content-type': 'application/json', 'x-platform-token': meta.workspaceToken } }); const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value; };
const step = value => { results.steps.push(value); console.log(value); };
const state = scope => api('/api/state?' + new URLSearchParams(scope));
async function finished(scope) { const end = Date.now() + 60000; for (;;) { const value = await state(scope); if (value.liveRuns?.some(run => run.status === 'completed')) return value; if (Date.now() > end) throw Error('implementation incomplete: ' + JSON.stringify(value.planning?.map(row => ({status:row.status,issue:row.issue})))); await new Promise(done => setTimeout(done, 100)); } }
try {
  await start(); await api('/api/model-settings', { provider: 'deepseek', model: 'labelled-planning-ui-stub', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] }); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  for (const name of ['alpha', 'beta']) {
    const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'planning-ui-' + name };
    await api('/api/goals', { ...scope, requestId: scope.goalId, objective: name === 'beta' ? 'receipt-beta behavior' : 'alpha behavior' });
    await page.goto(base + '/workbench'); await page.getByTestId('goal-' + scope.goalId).click();
    if (name === 'beta') await page.route('**/api/real/work', async route => { await route.fetch(); await route.abort('connectionreset'); });
    await page.getByTestId('composer-input').fill(name === 'beta' ? 'Implement receipt-beta behavior and independent acceptance.' : 'Implement alpha behavior and independent acceptance.'); await page.getByTestId('allow-write').check(); await page.getByTestId('submit-task').click();
    if (name === 'beta') { await page.getByTestId('pending-request').waitFor(); await page.getByTestId('query-receipt').click(); await page.getByTestId('submit-receipt').filter({ hasText: '服务器已受理' }).waitFor(); await page.unroute('**/api/real/work'); }
    const value = await finished(scope); ensure(value.executor === 'coding-agent', 'executor mislabeled'); ensure(value.graph.graph.tasks.map(task => task.taskId).join(',') === name + ',' + name + '-gate', 'model plan not used'); ensure(value.matrix.matrix.rows.some(row => row.livePhase !== 'satisfied'), 'implementation falsely satisfied goal');
    await page.getByTestId('initial-planning').filter({ hasText: '计划已接纳' }).waitFor(); await page.screenshot({ path: join(out, 'planning-' + name + '-ui.png') }); step(name + ': normal UI proposal, exact source admission, implementation and receipt verified');
    if (name === 'alpha') { await page.getByTestId('semantic-question').fill('公开源码来自哪里？'); await page.getByTestId('semantic-ask').click(); await page.getByText('当前公开源码由 README.md 提供；此回答来自独立只读查询。', { exact: true }).waitFor(); await page.screenshot({ path: join(out, 'semantic-query-ui.png') }); step('independent query UI displayed public model response'); }
  }
  const count = requests.length; await app.close(); app = null; await start(); await page.goto(base + '/workbench'); await page.getByTestId('goal-planning-ui-alpha').click(); await page.getByTestId('initial-planning').filter({ hasText: '计划已接纳' }).waitFor(); ensure(requests.length === count, 'restart repeated model work');
  step('fresh service preserved planner/source/results and did not rerun models'); results.passed = true; results.modelCalls = count;
} catch (error) { results.passed = false; results.error = String(error); process.exitCode = 1; console.error(error); }
finally { await browser?.close(); await app?.close(); await writeFile(join(out, 'planning-ui-results.json'), JSON.stringify(results, null, 2)); }
