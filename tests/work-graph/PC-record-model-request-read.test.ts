/**
 * PC-1b ruling 28: the separate `ModelRequestReadPort` lists one Run's permits
 * by `sequence` through the registered permit lookup. It never scans the
 * RecordStore and never reads Kernel history.
 *
 * State is reached only through the real B2 owner writes; the port is fed the
 * same real RecordStore the service writes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createModelRequestReadPort } from '../../src/core/work-graph/tasks/model-call-service.js';
import {
  B2_AT, B2_PROMPT_FACTS, createB2ExecutionFixture, type B2ExecutionFixture,
} from '../helpers/B2-execution-fixture.js';

const fixtures: B2ExecutionFixture[] = [];
async function open(kind: 'memory' | 'sqlite' = 'memory') {
  const f = await createB2ExecutionFixture(kind);
  fixtures.push(f);
  return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

async function issue(f: B2ExecutionFixture, admitted: Awaited<ReturnType<B2ExecutionFixture['enter']>>, requestId: string) {
  const request = f.actualRequest(admitted, requestId);
  const issued = await f.model.authorizeModelRequest(f.ctx, { input: request,
    meta: { requestId: `pc-read-authorize:${requestId}`, expected: [await f.pin()] } });
  if (issued.status !== 'committed') throw new Error('real permit issuance required');
  return { admitted, request, issued };
}

describe('ModelRequestReadPort (PC-1b ruling 28)', () => {
  it.each(['memory', 'sqlite'] as const)(
    '%s: lists one Run permits in sequence order with facts and consumption, and another Run sees none', async kind => {
      const f = await open(kind);
      const admitted = await f.enter();
      // Authorize both before consuming either: the next slot counts every
      // authorized permit, not merely the consumed ones.
      const first = await issue(f, admitted, 'pc-read-request-1');
      const second = await issue(f, admitted, 'pc-read-request-2');
      expect(second.issued.value.permit.sequence).toBe(2);
      expect(await f.model.recordModelRequestAttempt(f.ctx, { input: { request: first.request,
        permitRef: first.issued.value.permitRef, attemptId: 'pc-read-attempt-1', observedAt: B2_AT },
      meta: { requestId: 'pc-read-consume-1', expected: [await f.pin(), { ref: first.issued.value.permitRef, revision: 1 }] } }))
        .toMatchObject({ status: 'committed' });
      const port = createModelRequestReadPort({ records: f.base.records });
      const listed = await port.listRunModelRequests(f.ctx, f.claim.runRef);
      expect(listed).toMatchObject({ status: 'ready' });
      if (listed.status !== 'ready') throw new Error('the Run permits must be readable');
      expect(listed.value.map(permit => ({ requestId: permit.requestId, sequence: permit.sequence,
        prompt: permit.prompt, consumedByAttemptId: permit.consumedByAttemptId,
        consumedAt: permit.consumedAt }))).toEqual([
        { requestId: 'pc-read-request-1', sequence: 1, prompt: B2_PROMPT_FACTS,
          consumedByAttemptId: 'pc-read-attempt-1', consumedAt: B2_AT },
        { requestId: 'pc-read-request-2', sequence: 2, prompt: B2_PROMPT_FACTS,
          consumedByAttemptId: null, consumedAt: null },
      ]);
      // Another Run in the same store has its own sequence space and no permits.
      expect(await port.listRunModelRequests(f.ctx, f.secondClaim.runRef)).toEqual({ status: 'ready', value: [] });
    });

  it('uses the registered permit lookup, not a store scan', async () => {
    const f = await open();
    const admitted = await f.enter();
    await issue(f, admitted, 'pc-read-no-scan');
    let scanned = 0;
    const records = { ...f.base.records, readMany: async () => {
      scanned += 1;
      throw new Error('the read port must not scan the RecordStore');
    } };
    const listed = await createModelRequestReadPort({ records }).listRunModelRequests(f.ctx, f.claim.runRef);
    expect(scanned).toBe(0);
    expect(listed).toMatchObject({ status: 'ready' });
    if (listed.status !== 'ready') throw new Error('the Run permits must be readable');
    expect(listed.value).toHaveLength(1);
  });

  it('rejects an incomplete RunRef and a Run outside the trusted Project', async () => {
    const f = await open();
    const port = createModelRequestReadPort({ records: f.base.records });
    expect(await port.listRunModelRequests(f.ctx, { ...f.claim.runRef, runId: '' }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await port.listRunModelRequests(f.ctx, { ...f.claim.runRef, projectId: 'other-project' }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  });
});
