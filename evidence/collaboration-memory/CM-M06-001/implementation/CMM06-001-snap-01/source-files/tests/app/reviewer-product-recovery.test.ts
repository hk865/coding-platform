import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGuiServer } from '../../src/app/server.js';
import { ReviewerDispatch } from '../../src/control/dispatch-engine/reviewer-dispatch.js';
import { reviewerRecoveryFixture } from './reviewer-recovery-fixture.js';
import type { ReviewRequestResult } from '../../src/contracts/reviewer-verification.js';
import type { ReviewWorkSnapshot } from '../../src/contracts/reviewer-work.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
type Fixture = Awaited<ReturnType<typeof reviewerRecoveryFixture>>;
const route = '/api/real/verifications/reviews/recover';
async function failed(result: 'PASS' | 'FAIL' = 'PASS') {
  const f = await reviewerRecoveryFixture(cleanup, createGuiServer, { result });
  expect((await f.round()).status).toBe(200);
  await f.holdConflict();
  expect((await f.start()).response.status).toBe(200);
  const failure = await f.waitForFailed();
  expect(failure.recovery, JSON.stringify(failure)).toMatchObject({ allowed: true });
  expect(failure.recovery.failureReason).toContain('read_lease_conflict');
  await f.releaseConflict();
  return f;
}
function reviewerWorks(f: Fixture) { return f.snapshots<ReviewWorkSnapshot>('ReviewWork'); }

it('reopens the complete host after replacement admission before dispatch and executes the persisted Reviewer exactly once', async () => {
  const f = await failed();
  const oldWork = reviewerWorks(f)[0]!;
  const drive = ReviewerDispatch.prototype.drive;
  const withheld: string[] = [];
  // Inject only a temporarily unavailable dispatch boundary after the real
  // HTTP authorization and Control commit. No replacement Runtime record or
  // model execution is created; the old failed Work still uses real dispatch.
  const unavailable = vi.spyOn(ReviewerDispatch.prototype, 'drive').mockImplementation(function (this: ReviewerDispatch, workRef) {
    if (workRef.reviewId !== oldWork.ref.reviewId) {
      withheld.push(workRef.reviewId);
      return Promise.resolve({ status: 'incomplete', workRef, code: 'test_dispatch_temporarily_unavailable' });
    }
    return drive.call(this, workRef);
  });
  let replacement: ReviewWorkSnapshot;
  try {
    const accepted = await f.recover();
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.review.work).not.toBeNull();
    replacement = accepted.body.review.work!;
    expect(replacement.ref).not.toEqual(oldWork.ref);
    await expect.poll(() => withheld, { timeout: 5000 }).toContain(replacement.ref.reviewId);
    expect(reviewerWorks(f)).toHaveLength(2);
    expect(f.snapshots<RunSnapshot>('Run').find(run => run.ref.runId === replacement.reviewerRunRef.runId))
      .toMatchObject({ status: 'starting', outcome: null, envelope: null, lastEventSeq: 0 });
    expect((await f.state()).liveRuns.some(run => run.spec.runId === replacement.reviewerRunRef.runId)).toBe(false);
    expect(f.reviewerRequests).toHaveLength(0);
    expect(f.snapshots('ReviewResult')).toHaveLength(0);
  } finally { unavailable.mockRestore(); }

  // restart() closes and reconstructs the HTTP host, SQLite/Vault handles,
  // CodingAgentRuntime and Verification service. Startup finds the admitted
  // authorization and drives its already-created Work with the real adapter.
  await f.restart();
  const settled = await f.settle();
  expect(settled.work!.ref).toEqual(replacement!.ref);
  expect(settled.assessment?.body.decision, JSON.stringify(settled)).toMatchObject({ status: 'accepted', requirements: [expect.objectContaining({ outcome: 'PASS' })] });
  expect(settled.formal.taskPhase).toBe('satisfied');
  expect(settled.formal.resultRef).not.toBeNull();
  expect(settled.formal.evidenceRefs).toHaveLength(1);
  const runtime = (await f.state()).liveRuns.filter(run => run.spec.runId === replacement!.reviewerRunRef.runId);
  expect(runtime).toHaveLength(1);
  expect(runtime[0]!.status).toBe('completed');
  expect(runtime[0]!.trace.some(event => event.type === 'tool.completed')).toBe(true);
  expect(f.reviewerRequests.length).toBeGreaterThan(2);
  expect(reviewerWorks(f).find(work => work.ref.reviewId === oldWork.ref.reviewId)).toEqual(oldWork);
  const calls = f.modelRequests(), works = reviewerWorks(f), results = f.snapshots('ReviewResult'), evidence = f.snapshots('Evidence');
  expect(results).toHaveLength(1);
  await f.restart();
  expect(await f.recover()).toMatchObject({ status: 200, body: { replayed: true } });
  expect(reviewerWorks(f)).toEqual(works); expect(f.snapshots('ReviewResult')).toEqual(results); expect(f.snapshots('Evidence')).toEqual(evidence);
  expect(f.modelRequests()).toBe(calls);
}, 90000);

it.each(['PASS', 'FAIL'] as const)('authorizes a real lease-conflict recovery through HTTP and admits actual Reviewer %s evidence', async result => {
  const f = await failed(result);
  const oldWork = reviewerWorks(f)[0]!, oldRun = f.snapshots<RunSnapshot>('Run').find(run => run.ref.runId === oldWork.reviewerRunRef.runId)!;
  const oldEvidence = f.snapshots('Evidence');
  const accepted = await f.recover();
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  expect(accepted.body.review.work?.ref).not.toEqual(oldWork.ref);
  const settled = await f.settle();
  expect(settled.assessment?.body.decision, JSON.stringify(settled)).toMatchObject({ status: 'accepted', requirements: [expect.objectContaining({ outcome: result })] });
  expect(settled.formal.resultRef).not.toBeNull();
  expect(settled.formal.evidenceRefs).toHaveLength(1);
  if (result === 'PASS') expect(settled.formal.taskPhase).toBe('satisfied');
  else expect(settled.formal.taskPhase).not.toBe('satisfied');
  expect(settled.formal.goalPhase).not.toBe('COMPLETED');
  expect(reviewerWorks(f)).toHaveLength(2);
  expect(reviewerWorks(f).find(work => work.ref.reviewId === oldWork.ref.reviewId)).toEqual(oldWork);
  expect(f.snapshots<RunSnapshot>('Run').find(run => run.ref.runId === oldRun.ref.runId)).toEqual(oldRun);
  for (const evidence of oldEvidence) expect(f.snapshots('Evidence')).toContainEqual(evidence);
  const record = (await f.state()).liveRuns.find(run => run.spec.runId === settled.work!.reviewerRunRef.runId)!;
  expect(record).toMatchObject({ status: 'completed', spec: { mode: 'review' } });
  expect(record.trace.some(event => event.type === 'tool.completed')).toBe(true);
  expect(f.reviewerRequests.length).toBeGreaterThan(2);
  for (const request of f.reviewerRequests) {
    const tools = request.tools!.map(tool => tool.function!.name);
    expect(tools).toContain('read_source'); expect(tools).toContain('read_material');
    expect(tools).not.toContain('edit'); expect(tools).not.toContain('shell');
  }
  // A settled FAIL also permits a separate coordination Query. Recovery must
  // never repeat this Reviewer or its canonical execution and evidence.
  const calls = f.modelRequests(), reviewCalls = f.reviewerRequests.length, works = reviewerWorks(f), evidence = f.snapshots('Evidence'), results = f.snapshots('ReviewResult');
  const reviewRuns = f.snapshots<RunSnapshot>('Run').filter(run=>works.some(work=>work.reviewerRunRef.runId===run.ref.runId));
  expect(await f.recover()).toMatchObject({ status: 200, body: { replayed: true } });
  const denied = await f.recover('cannot-reroll', 'recovery');
  expect(denied.body.review.work).toBeNull();
  expect((await f.read('recovery')).body.recovery.allowed).toBe(false);
  await f.restart();
  expect(await f.recover()).toMatchObject({ status: 200, body: { replayed: true } });
  expect((await f.post('/api/receipts', { ...f.scope, kind: 'independent-review', requestId: 'recovery' })).body).toMatchObject({ found: true, review: { phase: 'settled' } });
  expect(reviewerWorks(f)).toEqual(works); expect(f.snapshots('Evidence')).toEqual(evidence); expect(f.snapshots('ReviewResult')).toEqual(results);
  expect(f.reviewerRequests).toHaveLength(reviewCalls);
  expect(f.snapshots<RunSnapshot>('Run').filter(run=>works.some(work=>work.reviewerRunRef.runId===run.ref.runId))).toEqual(reviewRuns);
  if(result==='PASS') expect(f.modelRequests()).toBe(calls);
}, 90000);

it('deduplicates same-key and different-key concurrent authorizations and rejects altered identity payloads', async () => {
  const f = await failed();
  const responses = await Promise.all([f.recover('racing-a'), f.recover('racing-a'), f.recover('racing-b')]);
  expect(responses.every(response => response.status === 200), JSON.stringify(responses)).toBe(true);
  const accepted = responses.filter(response => response.body.review.work !== null);
  expect(accepted.length).toBeGreaterThan(0);
  expect(new Set(accepted.map(response => response.body.review.work!.ref.reviewId)).size).toBe(1);
  const winner = accepted[0]!.body.review.requestId;
  const settled = await f.settle(winner);
  expect(settled.formal.taskPhase).toBe('satisfied');
  expect(reviewerWorks(f)).toHaveLength(2);
  const calls = f.modelRequests();
  const changed = await f.recover(winner, 'independent', 'Changed authorization reason under the same identity');
  expect(changed.status).toBe(400);
  expect(f.modelRequests()).toBe(calls);
  expect(f.snapshots('ReviewResult')).toHaveLength(1);
  expect(f.snapshots('DispatchOutboxEntry').filter(value => (value['intent'] as { work?: { kind: string } }).work?.kind === 'review')).toHaveLength(2);
}, 90000);

it('keeps a durable recovery receipt when the HTTP response is lost and replays it after restart', async () => {
  const f = await failed();
  let committed: ReviewRequestResult | undefined;
  const proxy = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const upstream = await f.post<ReviewRequestResult>(route, JSON.parse(raw));
    if (upstream.status === 200) committed = upstream.body;
    // The host has sent its real response, but this connection loses it.
    response.destroy();
  });
  cleanup.push(async () => { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address(); if (!address || typeof address === 'string') throw Error('Proxy missing');
  await expect(fetch(`http://127.0.0.1:${address.port}`, { method: 'POST', body: JSON.stringify(f.recoverInput()) })).rejects.toThrow();
  expect(committed).toBeDefined();
  expect(committed!.review.work).not.toBeNull();
  const settled = await f.settle();
  const calls = f.modelRequests(), works = reviewerWorks(f), evidence = f.snapshots('Evidence');
  await f.restart();
  expect(await f.recover()).toMatchObject({ status: 200, body: { replayed: true } });
  expect((await f.read('recovery')).body.formal.resultRef).toEqual(settled.formal.resultRef);
  expect(reviewerWorks(f)).toEqual(works); expect(f.snapshots('Evidence')).toEqual(evidence); expect(f.modelRequests()).toBe(calls);
}, 90000);

it('rejects missing authentication and client-supplied proof, actor, or verdict before any replacement', async () => {
  const f = await failed();
  const body = f.recoverInput();
  const unauthenticated = await fetch(f.baseUrl() + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, actor: { kind: 'human', id: 'trusted' } }) });
  expect(unauthenticated.status).toBe(403);
  for (const forged of [{ proof: { modelStarted: false, toolStarted: false } }, { actor: { kind: 'human', id: 'trusted' } }, { verdict: 'PASS' }]) {
    const refused = await f.post(route, { ...body, ...forged });
    expect(refused.status, JSON.stringify(refused)).toBe(400);
  }
  expect((await f.post(route, { ...body, allowExecute: false })).status).toBe(400);
  expect(reviewerWorks(f)).toHaveLength(1); expect(f.reviewerRequests).toHaveLength(0);
}, 60000);

it.each(['unknown', 'duplicate'] as const)('does not turn an ambiguous persisted runtime checkpoint into restart authorization (%s)', async corruption => {
  let injectUnknown = false;
  const f = await reviewerRecoveryFixture(cleanup, async (directory, options) => {
    if (injectUnknown) {
      // Dedicated persistence fault injection between shutdown and reopen.
      // Canonical facts stay untouched; the contradictory observation must
      // never be replaced with client-provided claims of absent effects.
      for (const file of await readdir(join(directory, 'real-runs'))) {
        if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
        const path = join(directory, 'real-runs', file), record = JSON.parse(await readFile(path, 'utf8'));
        if (record.spec.mode !== 'review') continue;
        record.status = 'outcome_unknown';
        record.error = 'Injected ambiguous checkpoint: execution side effects cannot be established';
        const target = corruption === 'duplicate' ? join(directory, 'real-runs', 'f'.repeat(64) + '.json') : path;
        await writeFile(target, JSON.stringify(record) + '\n');
      }
      injectUnknown = false;
    }
    return createGuiServer(directory, options);
  });
  await f.round(); await f.holdConflict(); await f.start(); await f.waitForFailed(); await f.releaseConflict();
  const work = reviewerWorks(f), runs = f.snapshots('Run');
  injectUnknown = true; await f.restart();
  const view = (await f.read()).body;
  expect(view.recovery.allowed, JSON.stringify(view)).toBe(false);
  expect(view.recovery.code).toBe(corruption === 'duplicate' ? 'recovery_observation_integrity' : 'recovery_outcome_unknown');
  const refused = await f.recover();
  expect(refused.status).toBe(200); expect(refused.body.review.work).toBeNull();
  expect(reviewerWorks(f)).toEqual(work); expect(f.snapshots('Run')).toEqual(runs); expect(f.reviewerRequests).toHaveLength(0);
}, 90000);
