import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm, stat, readFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelSettings } from '../../src/app/model-settings.js';
import { createGuiServer } from '../../src/app/server.js';
const clean: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of clean.splice(0).reverse()) await fn(); });
async function temp() { const dir = await mkdtemp(join(tmpdir(), 'rat01-')); clean.push(() => rm(dir, { recursive: true, force: true })); return dir; }
async function fixture() {
  const requests: Array<{ authorization: string; body: Record<string, unknown> }> = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = JSON.parse(raw) as Record<string, unknown>;
    requests.push({ authorization: req.headers.authorization ?? '', body });
    const model = body['model'];
    if (model === 'timeout') return;
    const status = req.headers.authorization === 'Bearer wrong-key' ? 401 : model === 'absent-model' ? 404 : model === 'limited' ? 429 : model === 'unavailable' ? 503 : 200;
    if (status !== 200) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'secret-should-never-leak', type: 'invalid_request_error' } })); return; }
    if (model === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>not an API</html>'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const sse = (value: unknown) => res.write(`data: ${JSON.stringify(value)}\n\n`);
    const nonce = JSON.stringify(body['messages'] ?? body['input']).match(/[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0];
    const tool = Array.isArray(body['tools']) && body['tools'].length > 0;
    if (req.url === '/responses') {
      if (tool) {
        sse({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'connectivity_probe', arguments: '' } });
        sse({ type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: JSON.stringify({ nonce }) });
      } else sse({ type: 'response.output_text.delta', delta: nonce });
      sse({ type: 'response.completed', response: { usage: { input_tokens: 40, output_tokens: 20, input_tokens_details: { cached_tokens: 10 } } } });
    } else {
      const delta = tool ? { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: model === 'bad-tool' ? 'wrong_tool' : 'connectivity_probe', arguments: JSON.stringify({ nonce: model === 'bad-args' ? 'wrong' : nonce }) } }] } : { content: nonce };
      sse({ choices: [{ index: 0, delta, finish_reason: null }] });
      if (model !== 'no-terminal') sse({ choices: [{ index: 0, delta: {}, finish_reason: model === 'truncated' ? 'length' : tool ? 'tool_calls' : 'stop' }], ...(model === 'no-usage' ? {} : { usage: { prompt_tokens: 40, completion_tokens: 20, prompt_cache_hit_tokens: 10 } }) });
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  clean.push(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
  const addr = server.address(); if (!addr || typeof addr === 'string') throw Error();
  return { baseUrl: `http://127.0.0.1:${addr.port}`, requests };
}
const input = (baseUrl: string, model = 'valid', apiKey = 'synthetic-test-key') => ({ provider: 'deepseek', model, apiKey, baseUrl });
it('saves, reloads, rotates, clears and binds the actual revision without environment fallback', async () => {
  const dir = await temp(), f = await fixture(); const s = await createModelSettings(dir, { directory: join(dir, 'secret') });
  expect((await s.testConnection()).code).toBe('not_configured');
  const saved = await s.save(input(f.baseUrl));
  expect(JSON.stringify(saved)).not.toContain('synthetic-test-key');
  expect((await stat(join(dir, 'secret/settings.json'))).mode & 0o777).toBe(0o600);
  const reopened = await createModelSettings(dir, { directory: join(dir, 'secret') });
  expect(await reopened.read()).toEqual(saved);
  expect((await reopened.bindRun('run-a')).configuration.revision).toBe(saved.configuration?.revision);
  expect(await reopened.testConnection()).toMatchObject({ ok: true, toolsExecuted: 0, calls: [{ kind: 'text', usage: { inputTokens: 40 } }, { kind: 'tool', usage: { inputTokens: 40 } }] });
  expect(f.requests).toHaveLength(2);
  expect(f.requests.every(r => r.body['max_tokens'] === 256)).toBe(true);
  const rotated = await reopened.save(input(f.baseUrl, 'valid', 'new-synthetic-key'));
  expect(rotated.configuration?.revision).not.toBe(saved.configuration?.revision);
  const cleared = await reopened.clear();
  expect(cleared.keyConfigured).toBe(false);
  expect(await readFile(join(dir, 'secret/settings.json'), 'utf8')).not.toContain('new-synthetic-key');
  await expect(reopened.bindRun('run-b')).rejects.toThrow('API Key');
  expect((await reopened.testConnection()).code).toBe('not_configured');
  expect(f.requests).toHaveLength(2);
});
it.each([
  ['wrong-key', 'valid', 'authentication_failed'], ['synthetic', 'absent-model', 'provider_request_failed'],
  ['synthetic', 'limited', 'rate_limited'], ['synthetic', 'unavailable', 'provider_unavailable'],
  ['synthetic', 'html', 'protocol_incompatible'], ['synthetic', 'no-terminal', 'protocol_incompatible'],
  ['synthetic', 'bad-tool', 'protocol_incompatible'], ['synthetic', 'bad-args', 'protocol_incompatible'],
  ['synthetic', 'no-usage', 'protocol_incompatible'], ['synthetic', 'truncated', 'truncated'], ['synthetic', 'timeout', 'timeout'],
])('classifies %s / %s and redacts provider payloads', async (key, model, code) => {
  const dir = await temp(), f = await fixture(); const s = await createModelSettings(dir, { directory: join(dir, 'secret'), timeoutMs: 300 });
  await s.save(input(f.baseUrl, model, key)); const result = await s.testConnection();
  expect(result).toMatchObject({ ok: false, code });
  expect(JSON.stringify(result)).not.toContain('secret-should-never-leak');
  expect(f.requests.length).toBeLessThanOrEqual(2);
});
it('uses the registered OpenAI Responses protocol', async () => {
  const dir = await temp(), f = await fixture(); const s = await createModelSettings(dir, { directory: join(dir, 'secret') });
  await s.save({ ...input(f.baseUrl), provider: 'openai' });
  expect(await s.testConnection()).toMatchObject({ ok: true, configuration: { protocol: 'responses' } });
  expect(f.requests).toHaveLength(2);
});
it('rejects unsafe URLs, unsupported provider, cross-provider key reuse, permissive files and symlinks', async () => {
  const dir = await temp(); const s = await createModelSettings(dir, { directory: join(dir, 'secret') });
  for (const base of ['http://example.com', 'https://user:pass@example.com', 'https://example.com?key=secret', 'file:///tmp/key']) await expect(s.save(input(base))).rejects.toThrow();
  await expect(s.save({ ...input('https://api.deepseek.com'), provider: 'unknown' })).rejects.toThrow('提供方');
  await s.save(input('https://api.deepseek.com'));
  await expect(s.save({ ...input('https://other.example'), apiKey: '' })).rejects.toThrow('重新填写');
  await expect(s.save({ ...input('https://api.deepseek.com'), provider: 'openai', apiKey: '' })).rejects.toThrow('重新填写');
  const file = join(dir, 'secret/settings.json'); await chmod(file, 0o644);
  await expect(s.read()).rejects.toThrow('安全读取');
  await rm(file); await symlink(join(dir, 'outside'), file); await expect(s.read()).rejects.toThrow('安全读取');
});
it('cancels an active probe on clear and rejects concurrent tests', async () => {
  const dir = await temp(), f = await fixture(); const s = await createModelSettings(dir, { directory: join(dir, 'secret'), timeoutMs: 2000 });
  await s.save(input(f.baseUrl, 'timeout')); const running = s.testConnection();
  while (!f.requests.length) await new Promise(r => setTimeout(r, 10));
  expect((await s.testConnection()).code).toBe('busy');
  await s.clear(); expect((await running).code).toBe('configuration_changed');
});
it('guards HTTP settings and hides credentials from project tools across server restart', async () => {
  const dir = await temp(), f = await fixture(), secret = join(dir, 'secret');
  let app = await createGuiServer(join(dir, 'gui'), { modelSettings: { directory: secret } });
  async function listen() { await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r)); const a = app.server.address(); if (!a || typeof a === 'string') throw Error(); return `http://127.0.0.1:${a.port}`; }
  let base = await listen(); clean.push(() => app.close());
  let token = ((await (await fetch(base + '/api/meta')).json()) as { workspaceToken: string }).workspaceToken;
  const call = (path: string, body?: unknown, origin?: string) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'x-platform-token': token, 'content-type': 'application/json', ...(origin ? { origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  expect((await fetch(base + '/api/model-settings')).status).toBe(403);
  expect((await call('/api/model-settings', input(f.baseUrl), 'https://evil.example')).status).toBe(403);
  const saved = await (await call('/api/model-settings', input(f.baseUrl))).json();
  expect(JSON.stringify(saved)).not.toContain('synthetic-test-key');
  expect((await call('/api/projects/add', { path: dir })).status).toBe(400);
  await app.close(); app = await createGuiServer(join(dir, 'gui'), { modelSettings: { directory: secret } }); base = await listen();
  expect((await call('/api/model-settings')).status).toBe(403);
  token = ((await (await fetch(base + '/api/meta')).json()) as { workspaceToken: string }).workspaceToken;
  expect(await (await call('/api/model-settings')).json()).toEqual(saved);
  expect(await (await call('/api/model-settings/test', {})).json()).toMatchObject({ ok: true });
  expect(await (await call('/api/model-settings/clear', {})).json()).toMatchObject({ keyConfigured: false });
  expect(await (await call('/api/model-settings/test', {})).json()).toMatchObject({ code: 'not_configured' });
});

it('reports an unreachable Base URL without falling back to another provider', async () => {
  const dir = await temp(); const s = await createModelSettings(dir, { directory: join(dir, 'secret'), timeoutMs: 1000 });
  await s.save(input('http://127.0.0.1:1'));
  expect(await s.testConnection()).toMatchObject({ ok: false, code: 'provider_request_failed', configuration: { baseUrl: 'http://127.0.0.1:1' } });
});
