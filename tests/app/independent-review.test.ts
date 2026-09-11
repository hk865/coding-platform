import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createGuiServer } from '../../src/app/server.js';
import { independentReviewFixture } from './independent-review-fixture.js';
import type { ReviewRequestResult, ReviewRequestView } from '../../src/contracts/reviewer-verification.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
type Fixture = Awaited<ReturnType<typeof independentReviewFixture>>;
function snapshots(fixture: Fixture, type: string) {
  const database = new DatabaseSync(join(fixture.data, 'projects', encodeURIComponent(fixture.scope.projectId), 'ledger.sqlite'), { readOnly: true });
  try {
    return database.prepare("SELECT snapshot_json FROM snapshots WHERE json_extract(snapshot_json, '$.ref.aggregateType') = ? ORDER BY ref_key").all(type).map(row => JSON.parse(row['snapshot_json'] as string));
  } finally { database.close(); }
}
async function settle(fixture: Fixture, requestId = 'independent'): Promise<ReviewRequestView> {
  let current: ReviewRequestView | undefined;
  try { await expect.poll(async () => {
    const response = await fixture.read(requestId);
    if (response.status !== 200) throw Error(JSON.stringify(response));
    current = response.body;
    return ['settled', 'assessment_rejected', 'work_rejected'].includes(current.phase);
  }, { timeout: 25000, interval: 100 }).toBe(true); }
  catch (error) { throw Error(String(error) + '\nLast canonical Reviewer view: ' + JSON.stringify(current)); }
  return current!;
}

it('runs a real independent read-only Reviewer, admits its cited report, preserves the original lease, and never copies Task evidence to the Goal gate', async () => {
  const fixture = await independentReviewFixture(cleanup, createGuiServer);
  const round = await fixture.round();
  expect(round.status, JSON.stringify(round.body)).toBe(200);
  expect(round.body.round.outcome).toBe('INCONCLUSIVE');
  const lease = snapshots(fixture, 'TaskLease');
  const original = (await fixture.state()).liveRuns.find(run => run.spec.runId === fixture.runId)!;
  const started = await fixture.start();
  expect(started.response.status, JSON.stringify(started.response.body)).toBe(200);
  const result = await settle(fixture);
  expect(result.assessment?.body.decision, JSON.stringify(result)).toMatchObject({ status: 'accepted', requirements: [expect.objectContaining({ outcome: 'PASS' })] });
  expect(result.formal.taskPhase).toBe('satisfied');
  expect(result.formal.goalPhase).not.toBe('COMPLETED');
  expect(result.formal.evidenceRefs).toHaveLength(1);
  expect(snapshots(fixture, 'TaskLease')).toEqual(lease);
  const state = await fixture.state();
  const reviewer = state.liveRuns.find(run => run.spec.runId === result.work!.reviewerRunRef.runId)!;
  expect(reviewer.status).toBe('completed');
  expect(reviewer.spec.mode).toBe('review');
  expect(reviewer.sessionId).not.toBe(original.sessionId);
  expect(reviewer.spec.budget.maxRequests).toBeNull();
  expect(reviewer.spec.budget.maxToolCalls).toBeNull();
  expect(reviewer.spec.budget.timeoutMs).toBeNull();
  expect(fixture.reviewerRequests.length).toBeGreaterThan(2);
  for (const request of fixture.reviewerRequests) {
    const tools = request.tools!.map(tool => tool.function!.name);
    expect(tools).toContain('read_source'); expect(tools).toContain('read_material');
    expect(tools).not.toContain('read'); expect(tools).not.toContain('edit'); expect(tools).not.toContain('shell');
  }
  expect(reviewer.trace.some(event => event.type === 'tool.completed')).toBe(true);
  const raw = await fixture.post<{ body: string }>('/api/real/verifications/reviews/report', { ...fixture.reviewScope, requestId: 'independent' });
  expect(raw.status).toBe(200); expect(JSON.parse(raw.body.body).kind).toBe('independent-review-result');
  const calls = fixture.modelRequests(), work = snapshots(fixture, 'ReviewWork'), evidence = snapshots(fixture, 'Evidence');
  await fixture.restart();
  const replay = await fixture.post<ReviewRequestResult>('/api/real/verifications/reviews/start', started.input);
  expect(replay).toMatchObject({ status: 200, body: { replayed: true } });
  expect(fixture.modelRequests()).toBe(calls);
  expect(snapshots(fixture, 'ReviewWork')).toEqual(work);
  expect(snapshots(fixture, 'Evidence')).toEqual(evidence);
  expect((await fixture.post('/api/receipts', { ...fixture.scope, kind: 'independent-review', requestId: 'independent' })).body).toMatchObject({ found: true, review: { phase: 'settled' } });
  await writeFile(join(fixture.root, 'subject.txt'), 'changed after the admitted review\n');
  expect((await fixture.read()).body.current.status).not.toBe('current');
  const historical = await fixture.post('/api/real/verifications/reviews/report', { ...fixture.reviewScope, requestId: 'independent' });
  expect(historical).toMatchObject({ status: 200, body: { body: raw.body.body, applicability: 'historical_explanation' } });
  expect(snapshots(fixture, 'Evidence')).toEqual(evidence);
  expect(fixture.modelRequests()).toBe(calls);
}, 60000);

it.each(['FAIL', 'INCONCLUSIVE'] as const)('preserves a valid Reviewer %s as blocking evidence without restarting the original Task', async result => {
  const fixture = await independentReviewFixture(cleanup, createGuiServer, { result });
  await fixture.round();
  const lease = snapshots(fixture, 'TaskLease');
  expect((await fixture.start()).response.status).toBe(200);
  const review = await settle(fixture);
  expect(review.assessment?.body.decision, JSON.stringify(review)).toMatchObject({ status: 'accepted', requirements: [expect.objectContaining({ outcome: result })] });
  expect(review.formal.taskPhase).not.toBe('satisfied');
  expect(review.formal.goalPhase).not.toBe('COMPLETED');
  expect(snapshots(fixture, 'TaskLease')).toEqual(lease);
  const calls = fixture.modelRequests();
  const second = await fixture.start('cannot-reroll');
  expect(second.response.status).toBe(200);
  expect(second.response.body.review.work).toBeNull();
  expect(fixture.modelRequests()).toBe(calls);
}, 60000);

it('never dispatches when an applicable tool failed, and permanently rejects a report that omits required coverage', async () => {
  const failed = await independentReviewFixture(cleanup, createGuiServer);
  await failed.round('review-tools', 'exit 1');
  const started = await failed.start();
  expect(started.response.status).toBe(200);
  expect(started.response.body.review.work).toBeNull();
  expect(failed.reviewerRequests).toHaveLength(0);
  const bad = await independentReviewFixture(cleanup, createGuiServer, { transformReport: report => ({ ...report, requirements: [] }) });
  await bad.round(); await bad.start();
  const result = await settle(bad);
  expect(result.assessment?.body.decision).toMatchObject({ status: 'rejected' });
  expect(result.formal.evidenceRefs).toHaveLength(0);
  expect(result.formal.taskPhase).not.toBe('satisfied');
}, 60000);

it('source changed after actual material reads cannot produce newly accepted Reviewer evidence', async () => {
  let fixture: Fixture;
  fixture = await independentReviewFixture(cleanup, createGuiServer, { beforeReport: async () => { await writeFile(join(fixture.root, 'subject.txt'), 'changed during review\n'); } });
  await fixture.round(); await fixture.start();
  await expect.poll(async () => (await fixture.state()).liveRuns.some(run => run.spec.mode === 'review' && ['failed', 'cancelled', 'outcome_unknown'].includes(run.status)), { timeout: 20000, interval: 100 }).toBe(true);
  const result = (await fixture.read()).body;
  expect(result.formal.evidenceRefs).toHaveLength(0);
  expect(result.current.status).not.toBe('current');
  expect(result.formal.taskPhase).not.toBe('satisfied');
}, 60000);

it('clearing the saved model configuration during review cannot silently switch the profile or admit its answer', async () => {
  let fixture: Fixture;
  fixture = await independentReviewFixture(cleanup, createGuiServer, { beforeReport: async () => {
    expect((await fixture.post('/api/model-settings/clear', {})).status).toBe(200);
  } });
  await fixture.round(); await fixture.start();
  await expect.poll(async () => (await fixture.state()).liveRuns.some(run => run.spec.mode === 'review' && run.status === 'failed'), { timeout: 20000, interval: 100 }).toBe(true);
  const result = (await fixture.read()).body;
  expect(result.formal.evidenceRefs).toHaveLength(0);
  expect(result.current.status).not.toBe('current');
  expect((await fixture.profile()).body.status).toBe('incomplete');
}, 60000);

it('a real human revocation after Reviewer material reads prevents admission and remains revoked after restart', async () => {
  let fixture: Fixture, revoked = '';
  let revokeResult: Awaited<ReturnType<Fixture['post']>> | null = null;
  let expectedGrantRef: unknown;
  fixture = await independentReviewFixture(cleanup, createGuiServer, { beforeReport: async () => {
    const work = snapshots(fixture, 'ReviewWork')[0];
    revoked = work.input.grantRefs[0].grantId;
    expectedGrantRef = work.input.grantRefs[0];
    revokeResult = await fixture.post('/api/real/history/revoke', { ...fixture.scope, grantId: revoked, requestId: 'revoke-reviewer-grant', reason: 'Explicit real Reviewer revocation regression' });
  } });
  await fixture.round(); await fixture.start();
  await expect.poll(() => revokeResult, { timeout: 20000, interval: 100 }).not.toBeNull();
  const receipt = revokeResult as unknown as Awaited<ReturnType<Fixture['post']>>;
  expect(receipt.status, JSON.stringify(receipt)).toBe(200);
  expect(receipt.body).toMatchObject({ status: 'committed', grantRef: expectedGrantRef });
  const revokedGrant = snapshots(fixture, 'MaterialAccessGrant').find(item => item.ref.grantId === revoked);
  expect(revokedGrant.revision, JSON.stringify(revokedGrant)).toBe(2);
  expect(revokedGrant.revocation?.reason).toBe('Explicit real Reviewer revocation regression');
  await expect.poll(async () => (await fixture.state()).liveRuns.some(run => run.spec.mode === 'review' && run.status === 'failed'), { timeout: 20000, interval: 100 }).toBe(true);
  expect(revoked).not.toBe('');
  const before = (await fixture.read()).body;
  expect(before.formal.evidenceRefs).toHaveLength(0);
  const grants = snapshots(fixture, 'MaterialAccessGrant');
  expect(grants.find(grant => grant.ref.grantId === revoked).revision).toBe(2);
  expect(before.current.status, JSON.stringify({ work: before.work, grants, current: before.current })).not.toBe('current');
  const calls = fixture.modelRequests();
  await fixture.restart();
  expect(snapshots(fixture, 'MaterialAccessGrant')).toEqual(grants);
  expect((await fixture.read()).body.formal.evidenceRefs).toHaveLength(0);
  expect(fixture.modelRequests()).toBe(calls);
}, 60000);
