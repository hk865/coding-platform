import assert from 'node:assert/strict';

type TransportObservation = { path: string; method: 'GET' | 'POST'; code: string | null; retry?: number };
/** Scenario transport only. Never replay a mutation with an unknown receipt. */
export function createCollaborationHttpClient(base: string, token: string, observe: (kind: 'retry' | 'failure', observation: TransportObservation) => void) {
  let readRetries = 0;
  const readOnlyPosts = new Set(['/api/real/architecture-reviews/view', '/api/real/queries/runs', '/api/real/verifications/reviews/read']);
  async function send(path: string, method: 'GET' | 'POST', body: unknown, expectedStatus: number) {
    const operation = async () => {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-platform-token': token }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json();
      assert.equal(response.status, expectedStatus, path + ':' + JSON.stringify(value));
      return value as any;
    };
    const safeRead = method === 'GET' ? path.startsWith('/api/state?') : readOnlyPosts.has(path);
    try {
      try { return await operation(); }
      catch (error) {
        const code = (error as { cause?: { code?: string } }).cause?.code;
        if (!safeRead || code !== 'ECONNRESET' || readRetries >= 3) throw error;
        observe('retry', { path, method, code, retry: ++readRetries });
        return await operation();
      }
    } catch (error) {
      observe('failure', { path, method, code: (error as { cause?: { code?: string } }).cause?.code ?? null });
      throw error;
    }
  }
  return {
    post: (path: string, body: unknown, expectedStatus = 200) => send(path, 'POST', body, expectedStatus),
    state: (scope: Record<string, string>) => send('/api/state?' + new URLSearchParams(scope), 'GET', undefined, 200),
  };
}
