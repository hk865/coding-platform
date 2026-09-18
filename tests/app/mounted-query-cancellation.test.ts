import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { createGuiServer } from '../../src/app/server.js';
import { createBuiltinProviderRegistry, type ModelClientPort } from '../../vendor/coding-agent/dist/public-api.js';

it.each(['project', 'workspace'])('cancels the exact Query in a user-added %s and preserves it across reopen', async kind => {
  const directory = await mkdtemp(join(tmpdir(), 'mounted-query-cancel-'));
  const root = join(directory, 'source'); await mkdir(root); await writeFile(join(root, 'README.md'), 'Query cancellation source.');
  let entered!: () => void;
  const providerEntered = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0, aborted = false;
  const builtin = createBuiltinProviderRegistry();
  const client: ModelClientPort = { async *stream(request, options) {
    calls++; entered();
    await new Promise<void>(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', () => resolve(), { once: true }); });
    aborted = true;
    yield { schemaVersion: 1, requestId: request.requestId, sequence: 1, type: 'cancelled', reason: 'User cancelled the exact query.' };
  } };
  const data = join(directory, 'data');
  const options = { modelSettings: { directory: join(directory, 'settings'), registry: { list: () => builtin.list(), get: (id: string) => builtin.get(id), create: () => client } } };
  let app = await createGuiServer(data, options), base = '', token = '';
  const listen = async () => {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address(); if (!address || typeof address === 'string') throw Error('Missing address');
    base = 'http://127.0.0.1:' + address.port;
    token = ((await (await fetch(base + '/api/meta')).json()) as { workspaceToken: string }).workspaceToken;
  };
  const post = async (path: string, body: unknown) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    await listen();
    expect((await post('/api/model-settings', { provider: 'deepseek', model: 'labelled-cancel-barrier', baseUrl: 'http://127.0.0.1', apiKey: 'LOCAL_TEST_KEY' })).status).toBe(200);
    const mounted = await post(kind === 'project' ? '/api/projects/add' : '/api/workspaces/add', { path: root, ...(kind === 'workspace' ? { projectId: 'acceptance-alpha' } : {}) });
    expect(mounted.status).toBe(200); expect(mounted.body.root).toBe(root);
    const scope = { projectId: mounted.body.projectId, workspaceId: mounted.body.workspaceId, goalId: 'cancel-goal' };
    expect((await post('/api/goals', { ...scope, requestId: scope.goalId, objective: 'Cancel an actual in-flight query.' })).status).toBe(200);
    const input = { ...scope, requestId: 'cancel-in-flight', question: 'Read the source without writing.', budget: { timeoutMs: 60000 } };
    const submitted = await post('/api/real/queries', input); expect(submitted.status).toBe(200);
    await providerEntered;
    const cancellation = { ...scope, queryJobId: submitted.body.queryJobId };
    expect((await post('/api/real/queries/cancel', { ...cancellation, goalId: 'another-goal' })).status).toBe(400);
    expect(await post('/api/real/queries/cancel', cancellation)).toMatchObject({ status: 200, body: { status: 'cancelled' } });
    expect(aborted).toBe(true);
    expect(await post('/api/real/queries/cancel', cancellation)).toMatchObject({ status: 200 });
    expect(await post('/api/real/queries', input)).toMatchObject({ status: 200, body: { receipt: { replayed: true } } });
    const state = async () => (await (await fetch(base + '/api/state?' + new URLSearchParams(scope))).json()) as any;
    const cancelled = (await state()).queries.find((row: any) => row.job.queryJobId === cancellation.queryJobId);
    expect(cancelled).toMatchObject({ job: { status: 'closed', closeReason: { code: 'cancelled' } }, run: { outcome: 'cancelled' }, currentAnswer: null });
    await app.close(); app = await createGuiServer(data, options); await listen();
    expect((await state()).queries.find((row: any) => row.job.queryJobId === cancellation.queryJobId)).toMatchObject({ job: { status: 'closed', closeReason: { code: 'cancelled' } }, currentAnswer: null });
    expect(calls).toBe(1);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
}, 60000);
