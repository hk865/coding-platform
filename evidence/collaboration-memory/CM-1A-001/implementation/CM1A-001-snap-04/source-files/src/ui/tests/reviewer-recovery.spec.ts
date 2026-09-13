import { expect, test, type Page } from '@playwright/test';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reviewerRecoveryFixture } from '../../../tests/app/reviewer-recovery-fixture.js';
import type { ReviewRequestResult } from '../../contracts/reviewer-verification.js';
import type { ReviewWorkSnapshot } from '../../contracts/reviewer-work.js';

type Fixture = Awaited<ReturnType<typeof reviewerRecoveryFixture>>;
const cleanup: Array<() => Promise<void>> = [];
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const built = await import(new URL('../../../dist/app/server.js', import.meta.url).href);
  const app = await reviewerRecoveryFixture(cleanup, built.createGuiServer);
  expect((await app.round()).status).toBe(200);
  await app.holdConflict();
  expect((await app.start()).response.status).toBe(200);
  await app.waitForFailed();
  await app.releaseConflict();
  return app;
}
async function open(page: Page, app: Fixture, requestId = 'independent') {
  await page.goto(app.baseUrl() + '/workbench?' + new URLSearchParams(app.scope), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('app')).toBeVisible();
  await page.getByTestId('tab-verification').click();
  await page.getByTestId('open-review-' + requestId).click();
}

test('authorizes a real lease-conflict recovery, preserves a lost receipt through reload, and completes the actual Reviewer result chain once', async ({ page }) => {
  const app = await fixture();
  const oldWork = app.snapshots<ReviewWorkSnapshot>('ReviewWork')[0]!;
  const oldRun = app.snapshots('Run').find(run => (run.ref as { runId: string }).runId === oldWork.reviewerRunRef.runId);
  await open(page, app);
  await expect(page.getByTestId('review-recovery')).toContainText('读租约被拒绝');
  await expect(page.getByTestId('recover-review')).toBeEnabled();
  const network = { result: null as ReviewRequestResult | null, submissions: 0 };
  const path = '/api/real/verifications/reviews/recover';
  page.on('request', request => { if (new URL(request.url()).pathname === path) network.submissions++; });
  await page.route('**' + path, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    network.result = await response.json() as ReviewRequestResult;
    await route.abort('failed');
  }, { times: 1 });
  await page.getByTestId('recover-review').dblclick();
  await expect(page.getByTestId('review-message')).toContainText('恢复提交结果未知');
  if (!network.result) throw Error('No actual recovery response was intercepted');
  const recoveryId = network.result.review.requestId;
  await expect(page.getByTestId('review-pending')).toContainText(recoveryId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('tab-verification').click();
  await expect(page.getByTestId('review-pending')).toContainText(recoveryId);
  await page.getByTestId('review-query-receipt').click();
  await expect(page.getByTestId('review-pending')).toHaveCount(0);
  await expect(page.getByTestId('review-requirements')).toContainText('PASS', { timeout: 30000 });
  await expect(page.getByTestId('review-detail')).toContainText('satisfied');
  expect(network.submissions).toBe(1);
  const view = (await app.read(recoveryId)).body;
  expect(view.formal.evidenceRefs).toHaveLength(1);
  expect(view.formal.goalPhase).not.toBe('COMPLETED');
  expect(app.reviewerRequests.length).toBeGreaterThan(2);
  expect(app.snapshots<ReviewWorkSnapshot>('ReviewWork').find(work => work.ref.reviewId === oldWork.ref.reviewId)).toEqual(oldWork);
  expect(app.snapshots('Run').find(run => (run.ref as { runId: string }).runId === oldWork.reviewerRunRef.runId)).toEqual(oldRun);
  const calls = app.modelRequests(), evidence = app.snapshots('Evidence');
  await app.restart(); await open(page, app, recoveryId);
  await expect(page.getByTestId('review-requirements')).toContainText('PASS');
  expect(app.modelRequests()).toBe(calls);
  expect(app.snapshots('Evidence')).toEqual(evidence);
  expect(app.snapshots('ReviewWork')).toHaveLength(2);
});

test('a persisted unknown checkpoint displays a refusal and cannot be authorized from the UI', async ({ page }) => {
  const app = await fixture();
  const run = (await app.state()).liveRuns.find(run => run.spec.mode === 'review')!;
  // Isolated fault injection: a lost/unknown runtime checkpoint must fail closed
  // even when the canonical Run retains an earlier crashed observation.
  const directory = join(app.data, 'real-runs');
  let changed = false;
  for (const file of await readdir(directory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    const path = join(directory, file), record = JSON.parse(await readFile(path, 'utf8'));
    if (record.spec.runId !== run.spec.runId) continue;
    record.status = 'outcome_unknown'; record.error = 'Injected unknown durable checkpoint';
    await writeFile(path, JSON.stringify(record)); changed = true;
  }
  expect(changed).toBe(true);
  await app.restart(); await open(page, app);
  await expect(page.getByTestId('review-recovery')).toContainText('不允许重新执行');
  await expect(page.getByTestId('recover-review')).toBeDisabled();
  expect((await app.read()).body.recovery.allowed).toBe(false);
  expect(app.reviewerRequests).toHaveLength(0);
  expect(app.snapshots('ReviewWork')).toHaveLength(1);
});
