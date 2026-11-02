import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHostClient, fetchPageText, readPlatformToken } from '../../src/ui/host-client.js';

/**
 * E32-4 (ruling item 5): both an HTTP failure and a 200 body with
 * `status: 'rejected'` are failures; the token travels in the header, never in
 * the URL, and the route body is `{scope, input}`.
 */
const scope = { projectId: 'e32-project', workspaceId: 'e32-workspace' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('E32-4 host client', () => {
  it.each([
    ['HTTP 500', 500, { status: 'rejected', code: 'unavailable', reason: 'the Host failed the route' }],
    ['HTTP 200 rejected body', 200, { status: 'rejected', code: 'forbidden', reason: 'the scope is not trusted' }],
  ])('%s rejects', async (_label, status, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })));
    const client = createHostClient('e32-token');
    const error = await client.post('goals/read', scope, {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(body.code);
    expect((error as Error).message).toContain(body.reason);
  });

  it('sends the route body and token without putting the token in the URL', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ status: 'ok', value: { goals: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));
    const client = createHostClient('e32-token');
    const reply = await client.post('goals/read', scope, { goalId: 'goal-1' });
    expect(reply).toEqual({ status: 'ok', value: { goals: [] } });
    expect(new URL(capturedUrl, 'http://localhost').pathname).toBe('/api/real/core/goals/read');
    expect(capturedUrl).not.toContain('e32-token');
    expect(capturedInit?.headers).toEqual({ 'content-type': 'application/json', 'x-platform-token': 'e32-token' });
    expect(JSON.parse(capturedInit?.body as string)).toEqual({ scope, input: { goalId: 'goal-1' } });
  });

  it('reads no token from a page without the meta', () => {
    expect(readPlatformToken({ querySelector: () => null })).toBeNull();
  });
});

describe('R8 the page text is fetched through the host client', () => {
  it('R8 fetchPageText reads the page and boot.ts has no direct fetch(', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('board page text', { status: 200 })));
    expect(await fetchPageText('http://host/workbench/TaskMap.dc.html')).toBe('board page text');
    const bootSource = readFileSync(fileURLToPath(new URL('../../src/ui/boot.ts', import.meta.url)), 'utf8');
    expect(bootSource).not.toContain('fetch(');
  });
});
