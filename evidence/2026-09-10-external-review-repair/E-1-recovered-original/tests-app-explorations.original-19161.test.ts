import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createGuiServer } from '../../src/app/server.js';
import type { RuntimeRecord } from '../../src/runtime/coding-agent-runtime.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
type State = { executor: string; liveRuns: RuntimeRecord[]; exploration: { reports: Array<{ taskId: string; runId: string; report: string; sourceReads: Array<{ path: string }> }>; reviews: Array<{ taskId: string; verdict: string; control: { status: string; taskPhase: string; goalPhase: string } }>; reportErrors: unknown[] }; matrix: { matrix?: { rows: Array<{ taskId: string; livePhase: string }> } }; goalStatus: unknown };
async function start(model = 'read-report', contextOnly = true) {
  const dir = await mkdtemp(join(tmpdir(), 'exploration-api-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'source'); await mkdir(root); await writeFile(join(root, 'README.md'), '# Demo\nThe actual entry point is src/main.ts.\n'); await writeFile(join(root, 'FILE_INDEX.txt'), 'README.md\n'); await writeFile(join(root, 'SOURCE_MANIFEST.json'), '{"testFixture":true}\n');
  let requests = 0; const payloads: Array<Record<string, unknown>> = [];
  const provider = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c; const input = JSON.parse(body); payloads.push(input); requests++;
    if (input.model === 'hang') return;
    res.writeHead(200, { 'content-type': 'text/event-stream' }); const emit = (value: unknown) => res.write('data: ' + JSON.stringify(value) + '\n\n');
    const readCount = input.messages.filter((m: { role: string }) => m.role === 'tool').length;
    const call = readCount === 0 && input.model !== 'no-read' ? { name: 'read', arguments: JSON.stringify({ path: input.model === 'read-dist' ? 'dist/observed.txt' : 'README.md', startLine: 1, endLine: 2 }) } : null;
    emit({ choices: [{ index: 0, delta: call ? { tool_calls: [{ index: 0, id: 'call-' + requests, type: 'function', function: call }] } : { content: '## Project exploration\nREADME.md:1-2 identifies src/main.ts as the entry point. This is a static observation; no build or runtime test was executed.' }, finish_reason: null }] });
    emit({ choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 50, prompt_cache_hit_tokens: 20 } }); res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(r => provider.listen(0, '127.0.0.1', r)); cleanup.push(async () => { provider.closeAllConnections(); await new Promise<void>(r => provider.close(() => r())); });
  const a = provider.address(); if (!a || typeof a === 'string') throw Error();
  const data = join(dir, 'data'), options = { modelSettings: { directory: join(dir, 'credentials') }, explorationContextOnlyRoots: contextOnly ? [root] : [] };
  let app = await createGuiServer(data, options), base = '', token = '';
  async function listen() { await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r)); const a = app.server.address(); if (!a || typeof a === 'string') throw Error(); base = 'http://127.0.0.1:' + a.port; token = ((await (await fetch(base + '/api/meta')).json()) as {workspaceToken:string}).workspaceToken; }
  await listen(); cleanup.push(() => app.close());
  async function post(path: string, input: unknown) { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(input) }); return { status: r.status, body: await r.json() }; }
  await post('/api/model-settings', { provider: 'deepseek', model, baseUrl: 'http://127.0.0.1:' + a.port, apiKey: 'synthetic-exploration-key' });
  const project = (await post('/api/projects/add', { path: root })).body as {projectId:string;workspaceId:string}; const scope = { projectId: project.projectId as string, workspaceId: project.workspaceId as string, goalId: 'explore-test' };
  await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Explore the actual project without changing it' });
  const tasks = [{ taskId: 'inventory', title: 'Inventory', instruction: 'Read README and identify entry points', dependsOn: [] }, { taskId: 'synthesis', title: 'Synthesis', instruction: 'Verify and synthesize the inventory', dependsOn: ['inventory'] }];
  const plan = { ...scope, requestId: 'plan-test', tasks };
  const install = () => post('/api/real/explorations/plan', plan);
  const run = (taskId: string) => post('/api/real/explorations/run', { ...scope, requestId: 'run-' + taskId, taskId });
  const reviewInput = (taskId: string) => ({ ...scope, requestId: 'review-' + taskId, taskId, ...(taskId === 'gate-goal' ? {} : { runId: 'real-explore-run-' + taskId }), reviewVerdict: 'PASS', reviewOrigin: 'operator', reviewText: 'Independently checked README.md lines 1-2 against the report; uncertainty and no-runtime-test limits are accurate.' });
  const review = (taskId: string) => post('/api/real/explorations/review', reviewInput(taskId));
  const state = async (goalId = scope.goalId) => await (await fetch(base + '/api/state?' + new URLSearchParams({ ...scope, goalId }))).json() as State;
  return { root, dir, data, scope, plan, install, run, review, reviewInput, state, post, payloads, requests: () => requests, restart: async () => { await app.close(); app = await createGuiServer(data, options); await listen(); } };
}
async function until<T>(fn: () => Promise<T>, check: (value: T) => boolean) { const deadline = Date.now() + 20000; for (;;) { const value = await fn(); if (check(value)) return value; if (Date.now() > deadline) throw Error('timed out: ' + JSON.stringify(value)); await new Promise(r => setTimeout(r, 30)); } }
it('executes a real read-only dependency chain, requires operator review and preserves reports across restart', async () => {
  const t = await start(); expect(await t.install()).toMatchObject({ status: 200, body: { planOrigin: 'operator', gateTaskId: 'gate-goal' } });
  expect((await t.run('synthesis')).status).toBe(400); expect(t.requests()).toBe(0);
  expect(await t.run('inventory')).toMatchObject({ status: 200, body: { status: 'accepted' } });
  let state = await until(t.state, s => s.exploration.reports.some(r => r.taskId === 'inventory'));
  expect(state.exploration.reportErrors).toEqual([]); expect(state.exploration.reports[0]?.sourceReads[0]?.path).toBe('README.md');
  expect(state.matrix.matrix?.rows.find(r => r.taskId === 'inventory')?.livePhase).not.toBe('satisfied');
  expect((await t.run('synthesis')).status).toBe(400); expect((await t.review('gate-goal')).status).toBe(400);
  expect(await t.review('inventory')).toMatchObject({ status: 200, body: { review: { verdict: 'PASS', reviewOrigin: 'operator', control: { status: 'applied', taskPhase: 'satisfied' } } } });
  const count = t.requests(); expect(await t.run('inventory')).toMatchObject({ status: 200 }); expect(t.requests()).toBe(count);
  expect(await t.run('synthesis')).toMatchObject({ status: 200 });
  state = await until(t.state, s => s.exploration.reports.some(r => r.taskId === 'synthesis'));
  expect(state.liveRuns.find(r => r.spec.taskId === 'synthesis')?.context?.input).toContain('直接前驱报告');
  // P1-18: the predecessor report body reached the consumer through the vault
  // under a recorded, version-bound grant — it was not copied out of the app
  // store, and the grant names exactly the consuming run.
  const grantsDb = new DatabaseSync(join(t.data, 'projects', encodeURIComponent(t.scope.projectId), 'readmodel.sqlite'));
  const grantRows = grantsDb.prepare('SELECT entry_json FROM material_access_grant_rows').all() as Array<{ entry_json: string }>;
  grantsDb.close();
  const grants = grantRows.map(row => JSON.parse(row.entry_json) as { grant: { reader: { runId: string }; issuedBy: { aggregateType: string }; basis: { workspaceRevision: number | null }; materials: unknown[] } });
  expect(grants.length).toBeGreaterThan(0);
  expect(grants.every(g => g.grant.reader.runId === 'real-explore-run-synthesis' && g.grant.issuedBy.aggregateType === 'Control' && g.grant.materials.length > 0)).toBe(true);
  expect(grants.every(g => g.grant.basis.workspaceRevision !== null)).toBe(true);
  expect(state.liveRuns.every(r => r.spec.mode === 'explore' && r.spec.budget.inputTokens === null)).toBe(true);
  for (const input of t.payloads) expect((input['tools'] as Array<{ function: { name: string } }>).map(t => t.function.name)).toEqual(['code_index','cpp_index','list_files','project_index','python_index','read','search','source_excerpt','symbols']);
  expect(await readdir(t.root)).toEqual(expect.not.arrayContaining(['.platform-runtime'])); expect(await readFile(join(t.root, 'README.md'), 'utf8')).toContain('The actual entry point');
  expect(await t.review('synthesis')).toMatchObject({ status: 200, body: { review: { control: { taskPhase: 'satisfied' } } } });
  expect(await t.review('gate-goal')).toMatchObject({ status: 200, body: { review: { control: { taskPhase: 'satisfied', goalPhase: 'COMPLETED' } } } });
  const before = await t.state(), calls = t.requests(); await t.restart();
  expect((await t.state()).exploration).toEqual(before.exploration); expect(await t.install()).toMatchObject({ status: 200, body: { replayed: true } });
  expect(await t.run('synthesis')).toMatchObject({ status: 200 }); expect(await t.review('gate-goal')).toMatchObject({ status: 200, body: { replayed: true } }); expect(t.requests()).toBe(calls);
}, 60000);
it('rejects mismatched, fabricated and changed review requests and changed source snapshots', async () => {
  const t = await start(); await t.install();
  expect((await t.post('/api/real/explorations/review', t.reviewInput('inventory'))).status).toBe(400);
  await t.run('inventory'); await until(t.state, s => s.exploration.reports.length > 0);
  expect((await t.post('/api/real/explorations/review', { ...t.reviewInput('inventory'), workspaceId: 'wrong' })).status).toBe(400);
  expect((await t.post('/api/real/explorations/review', { ...t.reviewInput('inventory'), runId: 'real-fabricated' })).status).toBe(400);
  expect((await t.post('/api/real/explorations/review', { ...t.reviewInput('inventory'), reviewOrigin: 'model' })).status).toBe(400);
  expect((await t.post('/api/real/explorations/review', { ...t.reviewInput('inventory'), reviewText: '' })).status).toBe(400);
  expect((await t.review('inventory')).status).toBe(200);
  expect((await t.post('/api/real/explorations/review', { ...t.reviewInput('inventory'), reviewVerdict: 'FAIL' })).status).toBe(400);
  await writeFile(join(t.root, 'README.md'), 'changed after frozen exploration\n'); expect((await t.run('synthesis')).status).toBe(400);
}, 60000);
it('does not admit a completed answer with no successful read as exploration evidence', async () => {
  const t = await start('no-read'); await t.install(); await t.run('inventory');
  const state = await until(t.state, s => s.exploration.reportErrors.length > 0); expect(state.exploration.reports).toHaveLength(0); expect(state.exploration.reportErrors).toHaveLength(1); expect((await t.review('inventory')).status).toBe(400);
}, 30000);
it('keeps source-only exploration on the ordinary declared capacities with no cumulative limit outside the configured snapshot roots', async () => {
  const { DEFAULT_RUNTIME_BUDGET } = await import('../../src/runtime/model-budget.js');
  const t = await start('read-report', false); await t.install(); await t.run('inventory');
  const state = await until(t.state, s => s.liveRuns[0]?.status === 'completed');
  // No cumulative cap is invented for an ordinary project: the operator configured none.
  expect(state.liveRuns[0]?.spec.budget).toMatchObject({ inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, contextWindowTokens: DEFAULT_RUNTIME_BUDGET.contextWindowTokens });
}, 30000);
it('refuses cycles, duplicate nodes and replacement plans before any model call', async () => {
  const t = await start(); expect((await t.post('/api/real/explorations/plan', { ...t.plan, tasks: t.plan.tasks.map(t => ({ ...t, dependsOn: t.taskId === 'inventory' ? ['synthesis'] : ['inventory'] })) })).status).toBe(400);
  expect((await t.post('/api/real/explorations/plan', { ...t.plan, tasks: [t.plan.tasks[0], t.plan.tasks[0]] })).status).toBe(400);
  expect((await t.install()).status).toBe(200); expect((await t.post('/api/real/explorations/plan', { ...t.plan, requestId: 'replacement' })).status).toBe(400); expect(t.requests()).toBe(0);
}, 30000);

it('serializes independent real dispatch requests without duplicate model calls or unknown outcomes', async () => {
  const t = await start();
  expect((await t.post('/api/real/explorations/plan', { ...t.plan, tasks: t.plan.tasks.map(task => ({ ...task, dependsOn: [] })) })).status).toBe(200);
  const started = await Promise.all([t.run('inventory'), t.run('synthesis')]); expect(started.every(r => r.status === 200)).toBe(true);
  const state = await until(t.state, s => s.exploration.reports.length === 2);
  expect(state.liveRuns).toHaveLength(2); expect(state.liveRuns.every(r => r.status === 'completed')).toBe(true); expect(t.requests()).toBe(4);
  expect(state.exploration.reportErrors).toEqual([]);
}, 60000);

it('rejects review when an actually read dist file changes after exploration was frozen', async () => {
  const t = await start('read-dist'); await mkdir(join(t.root, 'dist')); await writeFile(join(t.root, 'dist/observed.txt'), 'Observed generated entry.\nStatic source evidence.\n');
  expect((await t.install()).status).toBe(200); expect((await t.run('inventory')).status).toBe(200);
  const state = await until(t.state, s => s.exploration.reports.length === 1); expect(state.exploration.reports[0]?.sourceReads[0]?.path).toBe('dist/observed.txt');
  await writeFile(join(t.root, 'dist/observed.txt'), 'Changed after report generation.\nStatic source evidence.\n');
  expect(await t.review('inventory')).toMatchObject({ status: 400, body: { error: expect.stringContaining('来源快照已改变') } });
  expect((await t.state()).exploration.reviews).toHaveLength(0);
}, 30000);

it('inherits only directly required applied PASS review notes, keeping reports and failed-goal history separate', async () => {
  const t = await start(), failedGoal = 'prior-failed-goal';
  const ancestorNote = 'ANCESTOR_NOTE: check the count again';
  const directNote = 'DIRECT_NOTE: cite README.md lines 1-2 accurately';
  const failedNote = 'FAILED_GOAL_BASELINE: never inherit this unrelated history';
  await t.post('/api/goals', { ...t.scope, requestId: failedGoal, objective: 'Earlier operator trial' });
  expect((await t.post('/api/real/explorations/plan', { ...t.plan, goalId: failedGoal, requestId: 'failed-plan' })).status).toBe(200);
  expect((await t.post('/api/real/explorations/run', { ...t.scope, goalId: failedGoal, taskId: 'inventory', requestId: 'failed-inventory' })).status).toBe(200);
  await until(() => t.state(failedGoal), s => s.exploration.reports.length === 1);
  expect((await t.post('/api/real/explorations/review', { ...t.reviewInput('inventory'), goalId: failedGoal, requestId: 'failed-review', runId: 'real-explore-failed-inventory', reviewVerdict: 'FAIL', reviewText: failedNote })).status).toBe(200);
  const tasks = [t.plan.tasks[0], { taskId: 'middle', title: 'Middle analysis', instruction: 'Read sources and refine the inventory', dependsOn: ['inventory'] }, { ...t.plan.tasks[1], dependsOn: ['middle'] }];
  expect((await t.post('/api/real/explorations/plan', { ...t.plan, tasks })).status).toBe(200);
  await t.run('inventory'); await until(t.state, s => s.exploration.reports.some(r => r.taskId === 'inventory'));
  expect((await t.post('/api/real/explorations/review', { ...t.reviewInput('inventory'), reviewText: ancestorNote })).status).toBe(200);
  await t.run('middle'); const middleState = await until(t.state, s => s.exploration.reports.some(r => r.taskId === 'middle'));
  expect(middleState.liveRuns.find(r => r.spec.taskId === 'middle')?.context?.input).toContain(ancestorNote);
  const middleReview = { ...t.reviewInput('middle'), reviewText: directNote };
  const reviewed = await t.post('/api/real/explorations/review', middleReview); expect(reviewed.status).toBe(200);
  const reviewId = (reviewed.body as { review: { reviewId: string } }).review.reviewId;
  // Model a crash after formal reduction but before the review's final applied marker was saved.
  const reviewFile = join(t.data, 'projects', encodeURIComponent(t.scope.projectId), 'explorations', 'review-' + reviewId + '.json');
  const pendingReview = JSON.parse(await readFile(reviewFile, 'utf8')); pendingReview.control.status = 'pending'; await writeFile(reviewFile, JSON.stringify(pendingReview));
  // A persisted prior-version prompt must remain immutable when the run request is replayed after upgrade.
  const recordsDir = join(t.data, 'real-runs'); let historicalInstruction = '';
  for (const name of await readdir(recordsDir)) {
    if (!name.endsWith('.json')) continue;
    const path = join(recordsDir, name), record = JSON.parse(await readFile(path, 'utf8'));
    if (record.spec.goalId !== t.scope.goalId || record.spec.taskId !== 'middle') continue;
    historicalInstruction = record.spec.instruction.split('\n\n操作者审阅备注')[0]; record.spec.instruction = historicalInstruction;
    await writeFile(path, JSON.stringify(record));
  }
  await t.restart();
  const calls = t.requests(); expect((await t.run('middle')).status).toBe(200); expect(t.requests()).toBe(calls);
  expect((await t.state()).liveRuns.find(r => r.spec.taskId === 'middle')?.spec.instruction).toBe(historicalInstruction);
  expect((await t.run('synthesis')).status).toBe(400); expect(t.requests()).toBe(calls);
  expect(await t.post('/api/real/explorations/review', middleReview)).toMatchObject({ status: 200, body: { replayed: true, review: { control: { status: 'applied' } } } });
  expect((await t.run('synthesis')).status).toBe(200); const state = await until(t.state, s => s.exploration.reports.some(r => r.taskId === 'synthesis'));
  const instruction = state.liveRuns.find(r => r.spec.taskId === 'synthesis')!.context!.input;
  expect(state.liveRuns.find(r => r.spec.taskId === 'synthesis')!.spec.instruction).not.toContain(directNote);
  expect(instruction).toContain(directNote); expect(instruction).toContain(reviewId);
  expect(instruction).toContain('操作者审阅备注（来源 operator，非模型原报告）');
  expect(instruction).not.toContain(ancestorNote); expect(instruction).not.toContain(failedNote);
  expect(state.exploration.reports.every(r => !r.report.includes(directNote) && !r.report.includes(ancestorNote))).toBe(true);
  expect((await t.state(failedGoal)).exploration.reviews[0]?.verdict).toBe('FAIL');
}, 60000);
