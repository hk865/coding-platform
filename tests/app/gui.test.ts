import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { createGuiService } from '../../src/app/service.js';
type GuiState = Awaited<ReturnType<Awaited<ReturnType<typeof createGuiService>>['state']>>;
type ActionBody = { drive?: { started: number; completed?: number; answered?: number; failures: unknown[] } };
import { createGuiServer } from '../../src/app/server.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function start(dir?: string) {
  if (!dir) { dir = await mkdtemp(join(tmpdir(), 'platform-gui-test-')); const path = dir; cleanup.push(() => rm(path, { recursive: true, force: true })); }
  // The sample/fixture executor is enabled explicitly here; it is never inferred
  // from a plan identifier shape.
  const app = await createGuiServer(dir, { fixtureExecution: true });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const addr = app.server.address(); if (!addr || typeof addr === 'string') throw Error('missing port');
  const base = `http://127.0.0.1:${addr.port}`;
  let closed = false; const close = async () => { if (!closed) { closed = true; await app.close(); } }; cleanup.push(close);
  const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'acceptance-demo' };
  return { dir, base, close, scope, post: async (path: string, body = {}) => { const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...scope, ...body }) }); return { status: res.status, body: await res.json() as ActionBody }; }, state: async (extra = {}) => (await fetch(base + '/api/state?' + new URLSearchParams({ ...scope, ...extra }))).json() as Promise<GuiState> };
}
it('serves the GUI and persists scoped goals, plans, runs and sourced queries across restart', async () => {
  const app = await start();
  expect((await fetch(app.base)).status).toBe(200);
  for (const asset of ['/app.js', '/layout.js', '/workspace.js', '/styles.css', '/vendor/xterm.js', '/vendor/addon-fit.js', '/vendor/xterm.css']) expect((await fetch(app.base + asset)).status).toBe(200);
  const created = await app.post('/api/goals', { requestId: 'new-goal', objective: '保存新的验收目标' });
  expect(created.status).toBe(200);
  expect((await app.post('/api/goals', { requestId: 'new-goal', objective: '保存新的验收目标' })).status).toBe(200);
  expect((await app.state()).goals).toHaveLength(2);
  expect((await app.post('/api/plans/sample')).status).toBe(200);
  const run = await app.post('/api/tasks/run', { taskId: 'task-install-contract' });
  expect(run.body.drive).toMatchObject({ started: 1, completed: 1, failures: [] });
  const query = await app.post('/api/queries', { requestId: 'query-one', question: '当前任务是什么？' });
  expect(query.body.drive).toMatchObject({ started: 1, answered: 1, failures: [] });
  const before = await app.state();
  const answer = before.queries[0];
  if (answer?.status !== 'ready' || !answer.currentAnswer || before.agents.status !== 'ready' || before.matrix.status !== 'ready') throw Error('missing views');
  expect(answer.currentAnswer.answer).toBeTruthy();
  expect(answer.currentAnswer.answeredAt >= answer.job.submittedAt).toBe(true);
  expect(answer.currentAnswer.sources.length).toBeGreaterThan(0);
  const row = before.agents.agents.rows[0]!;
  expect(row.endedAt! >= row.startedAt!).toBe(true);
  expect(before.matrix.matrix.rows[0]!.livePhase).not.toBe('satisfied');
  const other = await app.state({ projectId: 'acceptance-beta' });
  expect(other.queries).toHaveLength(0); expect(other.goals).toHaveLength(1);
  await app.close();
  const reopened = await start(app.dir);
  const after = await reopened.state();
  expect(after.goals).toEqual(before.goals);
  expect(after.agents).toEqual(before.agents);
  expect(after.queries).toEqual(before.queries);
  expect((await reopened.post('/api/tasks/run', { taskId: 'task-install-contract' })).body.drive?.started).toBe(0);
});
it('rejects invalid scope, unplanned query, conflicting goal retry and cross-origin writes', async () => {
  const app = await start();
  expect((await app.post('/api/plans/sample', { projectId: 'unknown' })).status).toBe(400);
  expect((await app.post('/api/queries', { requestId: 'no-context', question: '问题' })).status).toBe(400);
  await app.post('/api/goals', { requestId: 'same-id', objective: 'first' });
  expect((await app.post('/api/goals', { requestId: 'same-id', objective: 'different' })).status).toBe(400);
  expect((await fetch(app.base + '/api/goals', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://other.example' }, body: '{}' })).status).toBe(403);
  expect((await fetch(app.base + '/api/goals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status).toBe(400);
});

it('answers a formal receipt for a goal whose response was lost and replays the retry', async () => {
  const app = await start();
  expect((await app.post('/api/receipts', { requestId: 'never-sent', kind: 'goal' })).body).toMatchObject({ found: false, kind: 'goal' });
  expect((await app.post('/api/receipts', { requestId: 'never-sent', kind: 'not-a-kind' })).status).toBe(400);
  expect((await app.post('/api/goals', { requestId: 'lost-goal', objective: '响应丢失的目标' })).status).toBe(200);
  const receipt = await app.post('/api/receipts', { requestId: 'lost-goal', kind: 'goal' });
  expect(receipt.body).toMatchObject({ found: true, requestId: 'lost-goal', goalStatus: 'lost-goal' });
  // The retry with the same identifier replays: no second goal is created.
  expect((await app.post('/api/goals', { requestId: 'lost-goal', objective: '响应丢失的目标' })).status).toBe(200);
  expect((await app.state()).goals).toHaveLength(2);
});
it('scopes agent-focused chat to its task and exposes the formal project view without inventing completion', async () => {
  const app = await start();
  await app.post('/api/plans/sample');
  const answer = await app.post('/api/queries', { requestId: 'agent-focused', question: '这项任务的范围是什么？', focusTaskId: 'task-install-contract' });
  expect(answer.body.drive).toMatchObject({ answered: 1, failures: [] });
  const state = await app.state();
  const query = state.queries[0];
  if (query?.status !== 'ready' || !query.currentAnswer) throw Error('missing answer');
  const taskSources = query.currentAnswer.sources.filter(source => source.kind === 'task');
  expect(taskSources).toHaveLength(1);
  expect(taskSources[0]?.refKey).toContain('task-install-contract');
  expect(query.currentAnswer.sources.filter(source => source.kind === 'artifact')).toEqual([
    expect.objectContaining({ refKey: expect.stringMatching(/^[a-f0-9]{64}$/), version: '1' }),
  ]);
  expect(state.goalStatus.status).not.toBe('ready');
  const rejected = await app.post('/api/queries', { requestId: 'wrong-task', question: '读取其他任务', focusTaskId: 'task-from-other-goal' });
  expect(rejected.status).toBe(400);
  expect((await app.state()).queries).toHaveLength(1);
});
