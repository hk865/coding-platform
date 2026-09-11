import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { independentReviewFixture } from '../../../tests/app/independent-review-fixture.js';
import type { ReviewRequestResult } from '../../contracts/reviewer-verification.js';

type Fixture = Awaited<ReturnType<typeof independentReviewFixture>>;
type Factory = Parameters<typeof independentReviewFixture>[1];
const cleanup: Array<() => Promise<void>> = [];
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(result: 'PASS' | 'FAIL' = 'PASS') {
  const built = await import(new URL('../../../dist/app/server.js', import.meta.url).href) as { createGuiServer: Factory };
  const app = await independentReviewFixture(cleanup, built.createGuiServer, { result });
  expect((await app.round()).status).toBe(200);
  return app;
}
async function open(page: Page, app: Fixture) {
  await page.goto(app.baseUrl() + '/workbench?' + new URLSearchParams(app.scope), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('app')).toBeVisible();
  await page.getByTestId('tab-verification').click();
  await expect(page.getByTestId('independent-reviews')).toBeVisible();
}
async function prepare(page: Page) {
  await page.getByTestId('prepare-review').click();
  await expect(page.getByTestId('review-profile')).toContainText('verification-protocol-stub');
  await expect(page.getByTestId('start-review')).toBeEnabled();
}

test('independent Reviewer uses actual materials, displays admitted PASS and reopens its original report without another model run', async ({ page }) => {
  const app = await fixture();
  await open(page, app); await prepare(page);
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/real/verifications/reviews/start');
  await page.getByTestId('start-review').click();
  const result = await (await response).json() as ReviewRequestResult;
  await expect(page.getByTestId('review-requirements')).toContainText('PASS', { timeout: 30000 });
  await expect(page.getByTestId('review-detail')).toContainText('satisfied');
  expect((await app.read(result.review.requestId)).body.formal.goalPhase).not.toBe('COMPLETED');
  await page.getByTestId('review-raw-report').click();
  await expect(page.getByTestId('review-raw-body')).toContainText('independent-review-result');
  await expect(page.getByTestId('review-raw-body')).toContainText('source:subject.txt');
  const modelCalls = app.modelRequests();
  await app.restart();
  await open(page, app);
  await page.getByTestId('open-review-' + result.review.requestId).click();
  await expect(page.getByTestId('review-requirements')).toContainText('PASS');
  await page.getByTestId('review-raw-report').click();
  await expect(page.getByTestId('review-raw-body')).toContainText(result.review.reviewId);
  expect(app.modelRequests()).toBe(modelCalls);
  await writeFile(join(app.root, 'subject.txt'), 'changed after review\n');
  await page.getByTestId('review-detail').getByRole('button', { name: '刷新审阅状态', exact: true }).click();
  await expect(page.getByTestId('review-detail')).not.toContainText('当前有效');
  await page.getByTestId('review-raw-report').click();
  await expect(page.getByTestId('review-raw-body')).toContainText(result.review.reviewId);
  await expect(page.getByTestId('review-detail')).toContainText('历史原报告');
  expect(app.modelRequests()).toBe(modelCalls);
});

test('a committed response can be lost; reload finds the original Reviewer, keeps FAIL and shows its actual issue location', async ({ page }) => {
  const app = await fixture('FAIL');
  await open(page, app); await prepare(page);
  const path = '/api/real/verifications/reviews/start';
  const network = { submissions: 0, committed: null as ReviewRequestResult | null };
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === path) network.submissions++; });
  await page.route('**' + path, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    network.committed = await response.json() as ReviewRequestResult;
    await route.abort('failed');
  }, { times: 1 });
  await page.getByTestId('start-review').click();
  await expect(page.getByTestId('review-message')).toContainText('提交结果未知');
  if (!network.committed) throw Error('No real committed Reviewer response was intercepted');
  const original = network.committed.review;
  await expect(page.getByTestId('review-pending')).toContainText(original.requestId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('tab-verification').click();
  await expect(page.getByTestId('review-pending')).toContainText(original.requestId);
  await page.getByTestId('review-query-receipt').click();
  await expect(page.getByTestId('review-pending')).toHaveCount(0);
  await expect(page.getByTestId('review-requirements')).toContainText('FAIL', { timeout: 30000 });
  await page.getByTestId('review-raw-report').click();
  await expect(page.getByTestId('review-issue')).toContainText('subject.txt:1–1');
  expect((await app.read(original.requestId)).body.formal.taskPhase).not.toBe('satisfied');
  expect(network.submissions).toBe(1);
  const calls = app.modelRequests();
  await app.restart(); await open(page, app);
  await page.getByTestId('open-review-' + original.requestId).click();
  await expect(page.getByTestId('review-requirements')).toContainText('FAIL');
  expect(app.modelRequests()).toBe(calls);
});
