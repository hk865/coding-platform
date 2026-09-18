import { afterEach, expect, it, vi } from 'vitest';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reviewerFixture } from './reviewer-fixture.js';

const roots: string[] = [];
it('cancels verification observation after an in-flight round read instead of returning facts or a failed inventory', async () => {
  const f = await reviewerFixture(roots), controller = new AbortController(), reason = new Error('query disconnected');
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const original = f.service.round.bind(f.service);
  let received: AbortSignal | undefined;
  vi.spyOn(f.service, 'round').mockImplementationOnce(async (scope, requestId, signal) => {
    received = signal; const view = await original(scope, requestId); entered.resolve(); await release.promise; return view;
  });
  const pending = f.service.queryFacts(f.scope, controller.signal);
  await entered.promise; controller.abort(reason); release.resolve();
  await expect(pending).rejects.toBe(reason);
  expect(received).toBe(controller.signal);
});
it('preserves cancellation from Reviewer currentness through the review view and query fact inventory', async () => {
  const f = await reviewerFixture(roots);
  const started = await f.service.startReview(f.scope, f.input);
  expect(started.review.work, JSON.stringify(started.review.gaps)).not.toBeNull();
  const controller = new AbortController(), reason = new Error('review query disconnected');
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const original = f.reviewContext.current.bind(f.reviewContext);
  let received: AbortSignal | undefined;
  vi.spyOn(f.reviewContext, 'current').mockImplementationOnce(async (ref, signal) => {
    received = signal; entered.resolve(); await release.promise;
    signal?.throwIfAborted(); return original(ref, signal);
  });
  const pending = f.service.queryFacts(f.scope, controller.signal);
  await entered.promise; controller.abort(reason); release.resolve();
  await expect(pending).rejects.toBe(reason);
  expect(received).toBe(controller.signal);
});
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, {recursive:true,force:true}); });
it('observes independent verification and current source separately without starting a Reviewer', async () => {
  const f=await reviewerFixture(roots);
  const originalObservations=structuredClone(f.observations);
  const facts=await f.service.queryFacts(f.scope);
  expect(facts.status).toBe('ready');
  expect(facts.scope).toEqual({projectId:f.scope.projectId,workspaceId:f.scope.workspaceId,goalId:f.scope.goalId});
  expect(facts.rounds).toHaveLength(1); expect(facts.reviews).toEqual([]);
  expect(facts.rounds[0]).toMatchObject({scope:f.scope,status:'completed',outcome:'INCONCLUSIVE',applicability:{status:'ready',identity:{sourceDigest:f.round.materialIdentity!.sourceDigest}}});
  expect(f.observations).toEqual(originalObservations);
  const version=facts.version;
  await writeFile(join(f.root,'source.txt'),'different current source\n');
  const changed=await f.service.queryFacts(f.scope);
  expect(changed.rounds[0]!.status).toBe('completed');
  expect(changed.rounds[0]!.applicability.status).toBe('stale');
  expect(changed.version).not.toBe(version);
  expect(f.observations).toEqual(originalObservations);
});

it('keeps scoped ready-empty separate and reads durable facts after service reopen', async () => {
  const f=await reviewerFixture(roots);
  const initial=await f.service.queryFacts(f.scope);
  const other=await f.service.queryFacts({...f.scope,goalId:'other-goal'});
  expect(other).toMatchObject({status:'ready-empty',rounds:[],reviews:[]});
  const reopened=await f.reopen();
  expect((await reopened.queryFacts(f.scope)).version).toBe(initial.version);
});

it('reports a real Reviewer lifecycle and its formal failure without turning successful execution into acceptance', async () => {
  const f = await reviewerFixture(roots);
  const first = await f.service.startReview(f.scope, f.input);
  const ref = first.review.work!.ref;
  const { packet } = await f.begin(ref);
  const running = await f.service.queryFacts(f.scope);
  expect(running.reviews).toHaveLength(1);
  expect(running.reviews[0]).toMatchObject({ phase: 'awaiting_result', formal: { evidenceRefs: [] } });
  await f.complete(ref, await f.report(ref, packet, ['FAIL', 'PASS']));
  await f.service.resumeReview(f.scope, { requestId: f.input.requestId });
  const observations = structuredClone(f.observations);
  const settled = await f.service.queryFacts(f.scope);
  expect(settled.reviews[0]).toMatchObject({ phase: 'settled', formal: { taskPhase: 'failed' } });
  expect(settled.reviews[0]!.formal.evidenceRefs).toHaveLength(2);
  expect(settled.version).not.toBe(running.version);
  const reopened = await f.reopen();
  expect((await reopened.queryFacts(f.scope)).version).toBe(settled.version);
  expect(f.observations).toEqual(observations);
});

it('does not report an empty inventory when a recorded stage cannot be read', async () => {
  const f = await reviewerFixture(roots);
  vi.spyOn(f.service, 'round').mockRejectedValueOnce(Error('observation storage unavailable'));
  const facts = await f.service.queryFacts(f.scope);
  expect(facts).toMatchObject({ status: 'failed', rounds: [], reviews: [] });
  expect(facts.issues.join(' ')).toContain('observation storage unavailable');
});

it('refuses a mixed inventory when a Reviewer is recorded during observation', async () => {
  const f = await reviewerFixture(roots);
  let entered!: () => void, release!: () => void;
  const enteredRead = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const original = f.service.round.bind(f.service);
  vi.spyOn(f.service, 'round').mockImplementationOnce(async (...args) => {
    const view = await original(...args); entered(); await released; return view;
  });
  const pending = f.service.queryFacts(f.scope);
  await enteredRead;
  try { await f.service.startReview(f.scope, f.input); } finally { release(); }
  expect(await pending).toMatchObject({ status: 'stale', rounds: [], reviews: [] });
  expect((await f.service.queryFacts(f.scope)).reviews).toHaveLength(1);
});
