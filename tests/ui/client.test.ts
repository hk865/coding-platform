import { afterEach, expect, it, vi } from 'vitest';
import { createApi } from '../../src/ui/src/api/client';

afterEach(() => vi.unstubAllGlobals());
const send = () => createApi('test').createGoal({ projectId: 'p', workspaceId: 'w' }, { requestId: 'r', objective: 'o' });

it.each([200, 400, 500])('keeps a pending identity when HTTP %s has a damaged body', async status => {
  vi.stubGlobal('fetch', async () => new Response('{truncated', { status }));
  await expect(send()).rejects.toMatchObject({ kind: 'malformed', outcomeUnknown: true });
});

it('does not mistake a server failure for a definitive rejection', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ error: 'reply failed' }, { status: 500 }));
  await expect(send()).rejects.toMatchObject({ kind: 'server', outcomeUnknown: true });
});

it('still recognizes a valid rejection receipt', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ error: 'invalid input' }, { status: 400 }));
  await expect(send()).rejects.toMatchObject({ kind: 'rejected', outcomeUnknown: false });
});

it('requests overview explicitly while keeping legacy state reads compatible', async () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => { urls.push(url); return Response.json({}); });
  const api = createApi('test');
  await api.state({ projectId: 'p', workspaceId: 'w', goalId: 'g', view: 'overview' });
  await api.state({ projectId: 'p', workspaceId: 'w', goalId: 'g' });
  expect(new URL(urls[0]!, 'http://local').searchParams.get('view')).toBe('overview');
  expect(new URL(urls[1]!, 'http://local').searchParams.has('view')).toBe(false);
});

it('scopes an applicability read to the exact answer and cancels the request', async () => {
  const controller = new AbortController();
  let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(new URL(url, 'http://local').pathname).toBe('/api/query-applicability');
    expect(Object.fromEntries(new URL(url, 'http://local').searchParams)).toEqual({ projectId: 'p', workspaceId: 'w', goalId: 'g', queryJobId: 'q', answerId: 'a' });
    return new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
      requested();
    });
  });
  const pending = createApi('test').queryApplicability({ projectId: 'p', workspaceId: 'w', goalId: 'g' }, 'q', 'a', { signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  await started; controller.abort();
  await rejected;
});
