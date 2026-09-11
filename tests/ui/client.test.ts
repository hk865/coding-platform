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
