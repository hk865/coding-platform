/** Real entered/input-bound prerequisite; durable single-consumption semantics. */
import { afterEach, describe, expect, it } from 'vitest';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import { modelRequestPermitIdFor } from '../../src/core/work-graph/tasks/model-call-contracts.js';
import { B2_AT, B2_PROMPT_FACTS, b2Key, createB2ExecutionFixture, synchronizeB2Commits, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';

const fixtures: B2ExecutionFixture[] = [];
async function open(kind: 'memory' | 'sqlite' = 'memory') { const f = await createB2ExecutionFixture(kind); fixtures.push(f); return f; }
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

describe('B2 model request', () => {
  it('binds the issued permit to the actual entered input and denies request or context digest substitution', async () => {
    const f = await open(); const admitted = await f.enter(); const request = f.actualRequest(admitted);
    const issued = await f.model.authorizeModelRequest(f.ctx, { input: request, meta: { requestId: 'issue-model-request', expected: [await f.pin()] } });
    expect(issued).toMatchObject({ status: 'committed', replayed: false });
    if (issued.status !== 'committed') throw Error('real permit issuance required');
    expect(issued.value.permitRef.permitId).toBe(modelRequestPermitIdFor(f.claim.runRef, request.requestId));
    expect(issued.value.permit).toMatchObject({ runRef: f.claim.runRef, requestId: request.requestId,
      requestDigest: request.requestDigest, contextInputDigest: request.contextInputDigest, manifestDigest: request.manifestDigest,
      prompt: B2_PROMPT_FACTS, sequence: 1, consumedByAttemptId: null, consumedAt: null });
    const before = await f.read();
    for (const [field, value] of Object.entries({ requestDigest: artifactBodyDigest('other request'),
      contextInputDigest: artifactBodyDigest('other context'), manifestDigest: artifactBodyDigest('other manifest') })) {
      expect(await f.model.authorizeModelRequest(f.ctx, { input: { ...request, [field]: value },
        meta: { requestId: `changed-${field}`, expected: [await f.pin()] } })).toMatchObject({ status: 'rejected' });
      expect(await f.read()).toEqual(before);
    }
  });

  it('rejects unknown keys nested in the tool-spec ref and its source before writing a permit', async () => {
    const f = await open(); const admitted = await f.enter(); const request = f.actualRequest(admitted, 'nested-unknown');
    const before = await f.read();
    const refExtra = { ...request, prompt: { ...request.prompt,
      toolSpecsRef: { ...request.prompt.toolSpecsRef, extra: true } } };
    expect(await f.model.authorizeModelRequest(f.ctx, { input: refExtra,
      meta: { requestId: 'nested-ref-extra', expected: [await f.pin()] } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    const sourceExtra = { ...request, prompt: { ...request.prompt,
      toolSpecsRef: { ...request.prompt.toolSpecsRef,
        source: { ...request.prompt.toolSpecsRef.source, extra: true } } } };
    expect(await f.model.authorizeModelRequest(f.ctx, { input: sourceExtra,
      meta: { requestId: 'nested-source-extra', expected: [await f.pin()] } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await f.read()).toEqual(before);
  });

  it('stores the prompt facts with the permit and compares them again at consumption (ruling 26)', async () => {
    const f = await open(); const admitted = await f.enter();
    const request = f.actualRequest(admitted, 'prompt-facts-request');
    expect(request.prompt).toEqual(B2_PROMPT_FACTS);
    const issued = await f.model.authorizeModelRequest(f.ctx, { input: request,
      meta: { requestId: 'issue-prompt-facts', expected: [await f.pin()] } });
    expect(issued).toMatchObject({ status: 'committed' });
    if (issued.status !== 'committed') throw Error('real permit issuance required');
    expect(issued.value.permit).toMatchObject({ prompt: B2_PROMPT_FACTS, sequence: 1 });
    const expected = [await f.pin(), { ref: issued.value.permitRef, revision: 1 }];
    const changed = { ...request, prompt: { ...request.prompt, systemDigest: artifactBodyDigest('another system') } };
    expect(await f.model.recordModelRequestAttempt(f.ctx, { input: { request: changed, permitRef: issued.value.permitRef,
      attemptId: 'prompt-mismatch', observedAt: B2_AT }, meta: { requestId: 'consume-prompt-mismatch', expected } }))
      .toMatchObject({ status: 'rejected', code: 'forbidden',
        reason: expect.stringMatching(/the stored permit does not match the actual request/) });
    const consumed = await f.model.recordModelRequestAttempt(f.ctx, { input: { request, permitRef: issued.value.permitRef,
      attemptId: 'prompt-exact', observedAt: B2_AT }, meta: { requestId: 'consume-prompt-exact', expected } });
    expect(consumed).toMatchObject({ status: 'committed', value: { permit: { prompt: B2_PROMPT_FACTS, sequence: 1,
      consumedByAttemptId: 'prompt-exact' } } });
  });

  it('SQLite concurrent consumption has one fresh winner; restart replay never changes the consumed permit', async () => {
    const f = await open('sqlite'); const admitted = await f.enter(); const request = f.actualRequest(admitted);
    const issued = await f.model.authorizeModelRequest(f.ctx, { input: request, meta: { requestId: 'issue-race', expected: [await f.pin()] } });
    expect(issued).toMatchObject({ status: 'committed' });
    if (issued.status !== 'committed') throw Error('real permit issuance required');
    const expected = [await f.pin(), { ref: issued.value.permitRef, revision: 1 }];
    const race = synchronizeB2Commits(f.base.records); const model = f.ports(race.records).model;
    const writes = ['a', 'b'].map(id => ({ input: { request, permitRef: issued.value.permitRef, attemptId: `model-attempt-${id}`, observedAt: B2_AT },
      meta: { requestId: `consume-${id}`, expected } }));
    const results = await Promise.all(writes.map(write => model.recordModelRequestAttempt(f.ctx, write)));
    expect(results.filter(r => r.status === 'committed' && !r.replayed)).toHaveLength(1); expect(race.arrivals()).toBe(2);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    const winnerIndex = results.findIndex(r => r.status === 'committed'); const winner = results[winnerIndex];
    if (!winner || winner.status !== 'committed') throw Error('one real consumption required');
    const permitRows = await f.base.records.readMany([b2Key(issued.value.permitRef)]);
    expect(permitRows.status).toBe('ready');
    if (permitRows.status !== 'ready') throw Error('consumed permit must be readable');
    const row = permitRows.value.records[0]; expect(row?.revision).toBe(2);
    expect(JSON.parse(row!.json).permit).toMatchObject({ consumedByAttemptId: writes[winnerIndex]!.input.attemptId, consumedAt: B2_AT });
    await f.base.closeBackend(); const reopened = await f.base.reopenService();
    try {
      const replay = await f.ports(reopened.records).model.recordModelRequestAttempt(f.ctx, writes[winnerIndex]!);
      expect(replay).toEqual({ ...winner, replayed: true });
      expect(await reopened.records.readMany([b2Key(issued.value.permitRef)])).toEqual(permitRows);
      // WG returns a replayed receipt. The Runtime consumer must separately prove
      // provider=0; this WG test deliberately does not invent a provider wrapper.
      expect(await f.ports(reopened.records).model.authorizeModelRequest(f.ctx, { input: request,
        meta: { requestId: 'cannot-issue-again', expected: [await f.pin(f.claim, reopened.records)] } })).toMatchObject({ status: 'rejected' });
    } finally { await reopened.close(); }
  });

  it('Host revocation between issuance and attempted consumption denies the actual call and leaves permit revision 1', async () => {
    const f = await open(); const admitted = await f.enter(); const request = f.actualRequest(admitted);
    const issued = await f.model.authorizeModelRequest(f.ctx, { input: request, meta: { requestId: 'issue-before-revoke', expected: [await f.pin()] } });
    expect(issued).toMatchObject({ status: 'committed' });
    if (issued.status !== 'committed') throw Error('real permit issuance required');
    const before = await f.read(); f.host.enabled = false;
    expect(await f.model.recordModelRequestAttempt(f.ctx, { input: { request, permitRef: issued.value.permitRef, attemptId: 'revoked-attempt', observedAt: B2_AT },
      meta: { requestId: 'consume-after-revoke', expected: [await f.pin(), { ref: issued.value.permitRef, revision: 1 }] } }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await f.read()).toEqual(before);
    const rows = await f.base.records.readMany([b2Key(issued.value.permitRef)]);
    expect(rows.status).toBe('ready'); if (rows.status === 'ready') expect(rows.value.records[0]?.revision).toBe(1);
  });

  it('missing entry and missing Run/permit expected pins never create a model permit', async () => {
    const f = await open(); const prepared = await f.buildPrepared(); const unentered = f.actualRequest({ prepared, permit: f.permit() });
    const before = await f.read();
    expect(await f.model.authorizeModelRequest(f.ctx, { input: unentered, meta: { requestId: 'unentered-model', expected: [await f.pin()] } }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await f.read()).toEqual(before);
    const admitted = await f.enter(); const request = f.actualRequest(admitted);
    expect(await f.model.authorizeModelRequest(f.ctx, { input: request, meta: { requestId: 'no-run-pin', expected: [] } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    const issued = await f.model.authorizeModelRequest(f.ctx, { input: request, meta: { requestId: 'issue-pin-check', expected: [await f.pin()] } });
    expect(issued).toMatchObject({ status: 'committed' }); if (issued.status !== 'committed') throw Error('real permit required');
    expect(await f.model.recordModelRequestAttempt(f.ctx, { input: { request, permitRef: issued.value.permitRef, attemptId: 'no-permit-pin', observedAt: B2_AT },
      meta: { requestId: 'missing-permit-pin', expected: [await f.pin()] } })).toMatchObject({ status: 'rejected', code: 'invalid' });
  });
});
