/**
 * L8 (P16, ruling 7): the public manual `architecture/capture` input never
 * carries the driver's trusted start watermark.
 *
 * The HTTP body and its runtime parse reject `request.input.requestSeq` with one
 * clear invalid reason, so a manual caller cannot move the watermark that decides
 * `pending`. The refusal row lives under `describe('rejects: …')` and, after the
 * single error, reads the public observation-state to show that neither the
 * current observation nor the request watermark moved. Only the driver passes the
 * watermark, through the non-public direct owner call.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupTemporary, completed, corePost, graphWrite, makeWorkspace, routeRegistered,
  scopeOf, setupPublicDir, startHost, waitState, workspaceConfig,
} from './support/S8A-L8-host.js';

beforeAll(async () => { await setupPublicDir(); });
afterAll(async () => { await cleanupTemporary(); });

const pins = (scope: { projectId: string; workspaceId: string }) => [
  { ref: { aggregateType: 'Project' as const, projectId: scope.projectId }, revision: 1 },
  { ref: { aggregateType: 'Workspace' as const, ...scope }, revision: 1 },
];

describe.each(['memory', 'sqlite'] as const)('L8 manual capture watermark over HTTP [%s]', backend => {
  describe('rejects: a manual capture that carries the internal requestSeq', () => {
    it('rejects requestSeq, and the public observation and request are unchanged', async () => {
      const scope = scopeOf(`l8-watermark-${backend}`, `l8-watermark-ws-${backend}`);
      const started = await startHost({ backend, workspaces: [workspaceConfig(scope, await makeWorkspace())] });
      try {
        await routeRegistered(started, scope);
        const before = await waitState(started.base, started.token, scope, completed);
        const baselineCapture = before.current?.captureRef.captureId;
        const baselineSeq = before.autoCapture?.requestSeq;
        expect(baselineCapture).toBeTruthy();
        expect(baselineSeq).toBe(1);

        const rejected = await corePost(started.base, 'architecture/capture', started.token,
          graphWrite(scope, { workspace: scope, mappings: [], previous: null, requestSeq: 999 },
            `l8-watermark-rejected-${backend}`, pins(scope)));
        // ONE error: the route refuses before any owner call.
        expect(rejected.status).toBe(400);
        expect(await rejected.json()).toMatchObject({
          status: 'rejected', code: 'invalid',
          reason: 'architecture/capture request.input may not carry "requestSeq"',
        });

        // The parse refused before any owner call: the public current
        // observation and the request watermark are unchanged.
        const unchanged = await waitState(started.base, started.token, scope, () => true);
        expect(unchanged.current?.captureRef.captureId).toBe(baselineCapture);
        expect(unchanged.autoCapture).toMatchObject({ requestSeq: baselineSeq, pending: false });
      } finally { await started.host.close(); }
    });
  });
});
