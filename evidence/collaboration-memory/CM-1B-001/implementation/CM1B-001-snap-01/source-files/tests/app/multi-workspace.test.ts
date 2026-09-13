import { expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGuiServer } from '../../src/app/server.js';
import { createBuiltinProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';

it('registers a second workspace in one Project, isolates files and goals, explicitly grants original reports and preserves scope after restart', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'multi-workspace-app-')), source = join(temp, 'source'), target = join(temp, 'target'), other = join(temp, 'other'), data = join(temp, 'data');
  await Promise.all([source, target, other, data].map(path => mkdir(path))); await writeFile(join(source, 'scope.txt'), 'source workspace'); await writeFile(join(target, 'scope.txt'), 'target workspace');
  const builtin = createBuiltinProviderRegistry(); let calls = 0;
  const options = { workspaceRoots: { 'acceptance-alpha': source, 'acceptance-beta': other }, modelSettings: { directory: join(temp, 'settings'), registry: { list: () => builtin.list(), get: (id: string) => builtin.get(id), create: () => ({ async *stream(request: import('../../vendor/coding-agent/dist/public-api.js').ModelRequest) { calls++; yield { schemaVersion: 1 as const, requestId: request.requestId, sequence: 1, type: 'text_delta' as const, delta: 'Labelled test setup report; independent verification remains required.' }; yield { schemaVersion: 1 as const, requestId: request.requestId, sequence: 2, type: 'completed' as const, reason: 'final_answer' as const }; } }) } } };
  let app = await createGuiServer(data, options), base = '', token = '';
  const listen = async () => { await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done)); const address = app.server.address(); if (!address || typeof address === 'string') throw Error('missing port'); base = 'http://127.0.0.1:' + address.port; token = (await (await fetch(base + '/api/meta')).json() as { workspaceToken: string }).workspaceToken; };
  const post = async (path: string, body: object) => { const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() as any }; };
  const state = async (scope: Record<string, string>) => await (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json() as any;
  const setup = async (scope: { projectId: string; workspaceId: string; goalId: string }) => {
    expect((await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Exact workspace ' + scope.workspaceId })).status).toBe(200);
    expect((await post('/api/real/tasks', { ...scope, requestId: scope.goalId, instruction: 'Return the labelled public setup report.', allowWrite: true })).status).toBe(200);
    const end = Date.now() + 20000; for (;;) { const value = await state(scope); if (value.liveRuns?.[0]?.status === 'completed') return value; if (Date.now() > end) throw Error('setup incomplete'); await new Promise(done => setTimeout(done, 25)); }
  };
  try {
    await listen(); await post('/api/model-settings', { provider: 'deepseek', model: 'labelled-multi-workspace-stub', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' });
    const unauthorized = await fetch(base + '/api/workspaces/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'acceptance-alpha', path: target }) }); expect(unauthorized.status).toBe(403);
    expect((await post('/api/workspaces/add', { projectId: 'missing', path: target })).status).toBe(400);
    const added = await post('/api/workspaces/add', { projectId: 'acceptance-alpha', path: target }); expect(added.status).toBe(200);
    const from = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'source-goal' }, to = { projectId: 'acceptance-alpha', workspaceId: added.body.workspaceId, goalId: 'target-goal' };
    expect((await post('/api/workspaces/add', { projectId: 'acceptance-alpha', path: target })).body).toEqual(added.body);
    expect((await post('/api/workspaces/add', { projectId: 'acceptance-beta', path: target })).status).toBe(400);
    for (const [scope, content] of [[from, 'source workspace'], [to, 'target workspace']] as const) { const response = await fetch(base + '/api/files/preview?' + new URLSearchParams({ ...scope, path: 'scope.txt' }), { headers: { 'x-platform-token': token } }); expect(await response.json()).toMatchObject({ content }); }
    await setup(from); const consumer = await setup(to); expect(consumer.goals.map((view: any) => view.goal?.goalId)).toEqual(['target-goal']);
    const report = await post('/api/real/verifications/run-check', { ...from, runId: 'real-source-goal', requestId: 'history-report', kind: 'dynamic', command: 'printf cross-workspace-original-report', timeoutMs: 3000, allowExecute: true }); expect(report.status).toBe(200);
    const catalog = await post('/api/real/history/view', to); expect(catalog.body.materials).toHaveLength(1); expect(catalog.body.grants.grants).toHaveLength(0);
    const input = { ...to, requestId: 'explicit-history', runId: 'real-target-goal', materialId: catalog.body.materials[0].id, purpose: 'Compare the original source report as history', allowHistoricalRead: true };
    expect((await post('/api/real/history/grant', { ...input, allowHistoricalRead: false })).status).toBe(400);
    const grant = await post('/api/real/history/grant', input); expect(grant.status).toBe(200); expect(grant.body.grant.history.crossWorkspace).toMatchObject({ sourceWorkspaceId: from.workspaceId, authorizedBy: { kind: 'human', id: 'local-gui' } });
    const read = await post('/api/real/history/read', { ...to, grantId: grant.body.grant.grantId }); expect(read.body).toMatchObject({ applicability: 'historical_explanation', result: { status: 'ready', record: { ownerRunRef: { runId: 'real-source-goal' } } } });
    const count = calls; await app.close(); app = await createGuiServer(data, options); await listen();
    expect((await state(to)).goals.map((view: any) => view.goal?.goalId)).toEqual(['target-goal']); expect(calls).toBe(count);
    expect((await post('/api/real/history/read', { ...to, grantId: grant.body.grant.grantId })).body.result.status).toBe('ready');
    expect((await post('/api/real/history/revoke', { ...to, grantId: grant.body.grant.grantId, requestId: 'revoke-history', reason: 'End explicit sharing' })).status).toBe(200);
    expect((await post('/api/real/history/read', { ...to, grantId: grant.body.grant.grantId })).status).toBe(400);
  } finally { await app.close(); await rm(temp, { recursive: true, force: true }); }
}, 60000);
