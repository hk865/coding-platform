import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createGuiServer } from '../../src/app/server.js';
import { createWorkspaceTools } from '../../src/app/workspace-tools.js';

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main' };
async function fixture() {
  const root = await mkdtemp('/tmp/platform-workspace-test-');
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const alpha = root + '/alpha', beta = root + '/beta', extra = root + '/new-project';
  await Promise.all([alpha, beta, extra].map(path => mkdir(path)));
  const options = { workspaceRoots: { 'acceptance-alpha': alpha, 'acceptance-beta': beta } };
  return { root, alpha, beta, extra, options, dir: root + '/data' };
}
async function http(f: Awaited<ReturnType<typeof fixture>>) {
  const app = await createGuiServer(f.dir, f.options);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const addr = app.server.address(); if (!addr || typeof addr === 'string') throw Error('missing port');
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await app.close(); } }; cleanup.push(close);
  const base = `http://127.0.0.1:${addr.port}`;
  const meta = await (await fetch(base + '/api/meta')).json() as {workspaceToken: string};
  const post = async (path: string, input: object) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': meta.workspaceToken }, body: JSON.stringify(input) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  return { base, close, meta, post };
}

it('persists added project folders, deduplicates canonical paths and starts without an invented goal', async () => {
  const f = await fixture(), app = await http(f);
  const denied = await fetch(app.base + '/api/files?' + new URLSearchParams(scope));
  expect(denied.status).toBe(403);
  const cross = await fetch(app.base + '/api/files?' + new URLSearchParams(scope), { headers: { 'x-platform-token': app.meta.workspaceToken, origin: 'https://other.example' } });
  expect(cross.status).toBe(403);
  expect((await app.post('/api/projects/add', {path: f.root + '/missing'})).status).toBe(400);
  const created = await app.post('/api/projects/add', {path: f.extra});
  expect(created.status).toBe(200);
  const project = {projectId: String(created.body['projectId']), workspaceId: 'workspace-main'};
  await symlink(f.extra, f.root + '/alias');
  expect((await app.post('/api/projects/add', {path: f.root + '/alias'})).body).toEqual(created.body);
  const state = await (await fetch(app.base + '/api/state?' + new URLSearchParams(project))).json() as {goals: unknown[]; goalId: string};
  expect(state.goals).toEqual([]); expect(state.goalId).toBe('');
  expect((await app.post('/api/goals', {...project, requestId: 'new-goal', objective: '新目录验收目标'})).status).toBe(200);
  await app.close();
  const reopened = await http(f);
  const meta = await (await fetch(reopened.base + '/api/meta')).json() as {scopes: unknown[]};
  expect(meta.scopes).toContainEqual(created.body); expect(meta.scopes).toHaveLength(3);
  const restored = await (await fetch(reopened.base + '/api/state?' + new URLSearchParams(project))).json() as {goals: unknown[]};
  expect(restored.goals).toHaveLength(1);
});

it('previews real files, creates nested folders, and rejects traversal and external symlinks', async () => {
  const f = await fixture(), api = await createWorkspaceTools(f.dir, f.options); cleanup.push(api.close);
  await writeFile(f.alpha + '/hello.txt', '<script>你好</script>');
  await writeFile(f.alpha + '/binary', Buffer.from([0, 1, 2]));
  await writeFile(f.alpha + '/large', Buffer.alloc(256 * 1024 + 1, 65));
  await writeFile(f.beta + '/private', 'other project');
  await symlink(f.beta, f.alpha + '/outside');
  const read = (path: string, extra = {}) => api.read(path, {...scope, ...extra});
  expect(await read('/api/files/preview', {path: 'hello.txt'})).toMatchObject({kind: 'text', content: '<script>你好</script>'});
  expect(await read('/api/files/preview', {path: 'binary'})).toMatchObject({kind: 'binary'});
  expect(await read('/api/files/preview', {path: 'large'})).toMatchObject({kind: 'too_large'});
  for (const path of ['../beta/private', f.beta + '/private', 'outside/private']) await expect(read('/api/files/preview', {path})).rejects.toThrow(/目录|相对路径/);
  await api.write('/api/files/mkdir', {...scope, name: 'docs'});
  await api.write('/api/files/mkdir', {...scope, path: 'docs', name: 'notes'});
  expect(await read('/api/files', {path: 'docs'})).toMatchObject({entries: [{name: 'notes', kind: 'directory'}]});
  await expect(api.write('/api/files/mkdir', {...scope, name: '../escape'})).rejects.toThrow();
  await expect(api.write('/api/files/mkdir', {...scope, path: 'outside', name: 'escape'})).rejects.toThrow();
});

it('runs a scoped PTY with deduplicated input, resize, interruption and enforced filesystem/network restrictions', async () => {
  const f = await fixture(), api = await createWorkspaceTools(f.dir, f.options); cleanup.push(api.close);
  await mkdir(f.alpha + '/sub');
  await writeFile(f.beta + '/protected', 'unchanged');
  await symlink(f.beta, f.alpha + '/outside');
  const create = () => api.write('/api/terminals/create', {...scope, requestId: 'one'});
  const [created, retry] = await Promise.all([create(), create()]);
  expect(retry).toEqual(created);
  const s = created as {id: string}; const input = {...scope, sessionId: s.id};
  let id = 0;
  const send = (data: string) => api.write('/api/terminals/input', {...input, data, requestId: String(++id)});
  type Output = {status: string; chunks: Array<{data: string}>; through: number; cols: number; rows: number};
  const output = async () => await api.read('/api/terminals/output', input) as Output;
  const waitFor = async (needle: string) => {
    let text = '';
    for (let i = 0; i < 100; i++) { const value = await output(); text = value.chunks.map(c => c.data).join(''); if (text.includes(needle)) return text; if (value.status === 'exited') throw Error(text); await new Promise(resolve => setTimeout(resolve, 30)); }
    throw Error('Terminal output timeout: ' + text);
  };
  await send("printf 'SHELL_%s\\n' READY\r"); await waitFor('SHELL_READY');
  const once = {...input, data: "printf x >> count.txt\r", requestId: 'once'};
  await api.write('/api/terminals/input', once); await api.write('/api/terminals/input', once);
  await api.write('/api/terminals/resize', {...input, cols: 104, rows: 30});
  await send("cd sub; pwd; stty size; printf 'CWD_%s\\n' OK\r"); await waitFor('CWD_OK');
  expect((await output()).chunks.map(c=>c.data).join('')).toContain('30 104');
  expect((await output()).chunks.map(c=>c.data).join('')).toContain(f.alpha + '/sub');
  expect(await readFile(f.alpha + '/count.txt', 'utf8')).toBe('x');
  await send(`printf denied > '${f.beta}/protected'; printf denied > ../outside/escape; python3 -c 'import socket; socket.socket()'; printf 'GUARD_%s\\n' CHECKED\r`);
  const guard = await waitFor('GUARD_CHECKED');
  expect(guard).toContain('Permission denied'); expect(guard).toContain('Operation not permitted');
  expect(await readFile(f.beta + '/protected', 'utf8')).toBe('unchanged');
  await expect(readFile(f.beta + '/escape')).rejects.toMatchObject({code: 'ENOENT'});
  await expect(api.read('/api/terminals/output', {...input, projectId: 'acceptance-beta'})).rejects.toThrow('当前工作区');
  await send("printf 'WAIT_%s\\n' READY; sleep 20\r"); await waitFor('WAIT_READY');
  await send('\x03'); await send("printf 'INTERRUPT_%s\\n' OK\r"); await waitFor('INTERRUPT_OK');
  const before = await output();
  expect(await api.read('/api/terminals/output', {...input, after: before.through})).toMatchObject({chunks: []});
  await send('exit\r');
  await expect.poll(async () => (await output()).status).toBe('exited');
}, 15000);
