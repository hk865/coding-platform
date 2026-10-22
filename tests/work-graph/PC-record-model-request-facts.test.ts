/**
 * PC-1b ruling 26: the Work model-request permit records the frozen prompt
 * facts and a per-Run `sequence`, and consumption compares every fact again.
 *
 * State is reached only through the real B2 owner writes (`authorizeModelRequest`
 * and `recordModelRequestAttempt`) over the real memory/SQLite RecordStore; the
 * test never writes a permit record or a sequence claim itself.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import type { ModelRequestPromptFactsV1 } from '../../src/contracts/prompts/prompt-set.js';
import type { UniqueClaimChange } from '../../src/core/record-store/ports.js';
import { createModelRequestReadPort } from '../../src/core/work-graph/tasks/model-call-service.js';
import {
  B2_AT, B2_PROMPT_FACTS, createB2ExecutionFixture, synchronizeB2Commits, type B2ExecutionFixture,
} from '../helpers/B2-execution-fixture.js';

const fixtures: B2ExecutionFixture[] = [];
async function open(kind: 'memory' | 'sqlite' = 'memory') {
  const f = await createB2ExecutionFixture(kind);
  fixtures.push(f);
  return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

type CommittedIssue = Extract<Awaited<ReturnType<B2ExecutionFixture['model']['authorizeModelRequest']>>, { status: 'committed' }>;
type PromptFacts = ModelRequestPromptFactsV1 & { maxOutputTokens: number };

async function authorize(f: B2ExecutionFixture, request: ReturnType<B2ExecutionFixture['actualRequest']>): Promise<CommittedIssue> {
  const issued = await f.model.authorizeModelRequest(f.ctx, { input: request,
    meta: { requestId: `pc-authorize:${request.requestId}`, expected: [await f.pin()] } });
  expect(issued, request.requestId).toMatchObject({ status: 'committed' });
  if (issued.status !== 'committed') throw new Error('real permit issuance required');
  return issued;
}

async function consume(f: B2ExecutionFixture, issued: CommittedIssue,
  request: ReturnType<B2ExecutionFixture['actualRequest']>, attemptId: string) {
  return f.model.recordModelRequestAttempt(f.ctx, { input: { request, permitRef: issued.value.permitRef,
    attemptId, observedAt: B2_AT },
  meta: { requestId: `pc-consume:${attemptId}`, expected: [await f.pin(), { ref: issued.value.permitRef, revision: 1 }] } });
}

describe('Work model-request prompt facts and sequence (PC-1b ruling 26)', () => {
  it.each(['memory', 'sqlite'] as const)(
    '%s: two permits are authorized before the first is consumed, with sequences 1 and 2', async kind => {
      const f = await open(kind);
      const admitted = await f.enter();
      const first = f.actualRequest(admitted, 'pc-request-1');
      const firstIssued = await authorize(f, first);
      expect(firstIssued.value.permit).toMatchObject({ prompt: B2_PROMPT_FACTS, sequence: 1 });
      // Authorize the second while the first is still unconsumed: the slot is
      // counted over every authorized permit, not only consumed ones.
      const second = f.actualRequest(admitted, 'pc-request-2');
      const secondIssued = await authorize(f, second);
      expect(secondIssued.value.permit).toMatchObject({ prompt: B2_PROMPT_FACTS, sequence: 2 });
      expect(await consume(f, firstIssued, first, 'pc-attempt-1')).toMatchObject({ status: 'committed' });

      const listed = await createModelRequestReadPort({ records: f.base.records })
        .listRunModelRequests(f.ctx, f.claim.runRef);
      expect(listed).toMatchObject({ status: 'ready' });
      if (listed.status !== 'ready') throw new Error('the Run permits must be readable');
      expect(listed.value.map(permit => ({ requestId: permit.requestId, sequence: permit.sequence,
        prompt: permit.prompt, consumedByAttemptId: permit.consumedByAttemptId }))).toEqual([
        { requestId: 'pc-request-1', sequence: 1, prompt: B2_PROMPT_FACTS, consumedByAttemptId: 'pc-attempt-1' },
        { requestId: 'pc-request-2', sequence: 2, prompt: B2_PROMPT_FACTS, consumedByAttemptId: null },
      ]);
    });

  it('consumption compares every prompt fact and leaves the permit at revision 1 after a difference', async () => {
    const f = await open();
    const admitted = await f.enter();
    const request = f.actualRequest(admitted, 'pc-mismatch-request');
    const issued = await authorize(f, request);
    const base = request.prompt;
    const removedKeys = Object.keys(base.selection.removed) as (keyof typeof base.selection.removed)[];
    const changed: [string, PromptFacts][] = [
      ['systemDigest', { ...base, systemDigest: artifactBodyDigest('another system') }],
      ['toolsDigest', { ...base, toolsDigest: artifactBodyDigest('another tools') }],
      ['toolSpecsRef', { ...base, toolSpecsRef: { ...base.toolSpecsRef, digest: artifactBodyDigest('another specs') } }],
      ['maxOutputTokens', { ...base, maxOutputTokens: base.maxOutputTokens + 1 }],
      ['selection.inputTokens', { ...base, selection: { ...base.selection, inputTokens: base.selection.inputTokens + 1 } }],
      ['selection.budget', { ...base, selection: { ...base.selection, budget: base.selection.budget + 1 } }],
      ...removedKeys.map((key): [string, PromptFacts] => [`selection.removed.${key}`,
        { ...base, selection: { ...base.selection,
          removed: { ...base.selection.removed, [key]: base.selection.removed[key] + 1 } } }]),
    ];
    for (const [label, prompt] of changed) {
      const attempted = await consume(f, issued, { ...request, prompt }, `pc-mismatch-${label.replaceAll('.', '-')}`);
      expect(attempted, label).toMatchObject({ status: 'rejected', code: 'forbidden',
        reason: expect.stringMatching(/the stored permit does not match the actual request/) });
    }
    // The public read port still shows the untouched revision-1 permit.
    const listed = await createModelRequestReadPort({ records: f.base.records })
      .listRunModelRequests(f.ctx, f.claim.runRef);
    expect(listed).toMatchObject({ status: 'ready' });
    if (listed.status !== 'ready') throw new Error('the permit must be readable');
    expect(listed.value).toEqual([expect.objectContaining({ requestId: 'pc-mismatch-request',
      sequence: 1, prompt: B2_PROMPT_FACTS, consumedByAttemptId: null, consumedAt: null })]);
    // The exact facts still consume the untouched permit.
    expect(await consume(f, issued, request, 'pc-exact')).toMatchObject({ status: 'committed' });
  });

  it('claims the exact Run+sequence slot with the permit id as the new owner', async () => {
    const f = await open();
    const admitted = await f.enter();
    let claims: UniqueClaimChange[] = [];
    const records = { ...f.base.records, async commit(batch: Parameters<typeof f.base.records.commit>[0]) {
      claims = [...batch.claims];
      return f.base.records.commit(batch);
    } };
    const request = f.actualRequest(admitted, 'pc-claim-shape');
    const issued = await f.ports(records).model.authorizeModelRequest(f.ctx, { input: request,
      meta: { requestId: 'pc-claim-shape-authorize', expected: [await f.pin()] } });
    expect(issued).toMatchObject({ status: 'committed' });
    if (issued.status !== 'committed') throw new Error('real permit issuance required');
    expect(claims).toEqual([{
      // Hand-written canonical slot shape: keys in the canonical sorted order,
      // built with plain JSON, never the production canonicalizer.
      claimKey: `model-request-sequence:${JSON.stringify({ aggregateType: 'Run',
        goalId: 'r4c-claim-goal', projectId: 'r4c-claim-project', runId: f.claim.runRef.runId })}:1`,
      expectedOwner: null,
      nextOwner: issued.value.permitRef.permitId,
    }]);
  });

  it('two concurrent authorizations of one Run claim one sequence slot; the loser is busy and is not retried', async () => {
    const f = await open();
    const admitted = await f.enter();
    const race = synchronizeB2Commits(f.base.records);
    const model = f.ports(race.records).model;
    const pin = await f.pin();
    const requests = ['pc-race-a', 'pc-race-b'].map(id => f.actualRequest(admitted, id));
    const results = await Promise.all(requests.map(request => model.authorizeModelRequest(f.ctx, {
      input: request, meta: { requestId: `pc-race-authorize:${request.requestId}`, expected: [pin] } })));
    expect(race.arrivals()).toBe(2);
    expect(results.filter(result => result.status === 'committed' && !result.replayed)).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toEqual([
      { status: 'rejected', code: 'busy', reason: 'the model request sequence slot is already taken' },
    ]);
    const listed = await createModelRequestReadPort({ records: f.base.records })
      .listRunModelRequests(f.ctx, f.claim.runRef);
    expect(listed).toMatchObject({ status: 'ready' });
    if (listed.status !== 'ready') throw new Error('the Run permits must be readable');
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]).toMatchObject({ sequence: 1, prompt: B2_PROMPT_FACTS });
  });
});
