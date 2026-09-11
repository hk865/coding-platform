import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VerificationRoundResult } from '../../contracts/verification-round.js';
import { verificationRoundFixture } from '../../../tests/app/verification-round-fixture.js';

type Fixture = Awaited<ReturnType<typeof verificationRoundFixture>>;
type ServerFactory = NonNullable<Parameters<typeof verificationRoundFixture>[2]>;
const cleanup: Array<() => Promise<void>> = [];
const startPath = '/api/real/verifications/rounds/start';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(): Promise<Fixture> {
  // Load the built host used by browser acceptance and pass it explicitly to
  // the shared fixture; no source-host implementation is imported by this spec.
  const built = await import(new URL('../../../dist/app/server.js', import.meta.url).href) as { createGuiServer: ServerFactory };
  return verificationRoundFixture(cleanup, true, built.createGuiServer);
}

async function openVerification(page: Page, app: Fixture): Promise<void> {
  await page.goto(app.baseUrl() + '/workbench?' + new URLSearchParams(app.scope), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('app')).toBeVisible();
  await page.getByTestId('tab-verification').click();
  await expect(page.getByTestId('verification-rounds')).toBeVisible();
  await expect(page.getByTestId('round-run')).toHaveValue(new RegExp(app.runId));
}

async function configure(page: Page, checks: Array<{ id: string; command: string }>): Promise<void> {
  for (const [index, check] of checks.entries()) {
    if (index > 0) await page.getByTestId('round-add-check').click();
    await page.getByTestId(`round-check-id-${index}`).fill(check.id);
    await page.getByTestId(`round-check-command-${index}`).fill(check.command);
    await page.getByTestId(`round-check-cwd-${index}`).fill('.');
    await page.getByTestId(`round-check-timeout-${index}`).fill('3');
    await expect(page.getByTestId(`round-check-kind-${index}`)).toHaveValue('行为测试');
  }
}

/** Real browser → built HTTP host → command sandbox → Vault/Control/SQLite.
 * Only the external model is replaced with the shared local SSE protocol stub. */
test.describe('VR-01 工具验证轮次', () => {
  test('FAIL 与 PASS 按同一要求聚合，保留 Reviewer 缺项和服务重开后的原始失败报告', async ({ page }) => {
    const app = await fixture();
    await openVerification(page, app);
    await configure(page, [
      { id: 'a-fail', command: "mkdir -p .cache && printf 'fail-once\\n' >> .cache/browser-checks && printf 'browser-original-failure\\n' && exit 1" },
      { id: 'b-pass', command: "printf 'pass-once\\n' >> .cache/browser-checks && printf 'browser-original-pass\\n' && test \"$(cat subject.txt)\" = expected" },
    ]);
    const response = page.waitForResponse(value => new URL(value.url()).pathname === startPath && value.request().method() === 'POST');
    await page.getByTestId('start-verification-round').click();
    const received = await response;
    expect(received.status()).toBe(200);
    const result = await received.json() as VerificationRoundResult;
    expect(result.round.scope).toEqual({ ...app.scope, runId: app.runId, taskId: app.taskId });
    expect(result.round.control.taskPhase).not.toBe('satisfied');
    expect(result.round.control.goalPhase).not.toBe('COMPLETED');
    await expect(page.getByTestId('round-outcome')).toHaveText('FAIL');
    await expect(page.getByTestId('round-result-a-fail').getByText('FAIL', { exact: true })).toBeVisible();
    await expect(page.getByTestId('round-result-b-pass').getByText('PASS', { exact: true })).toBeVisible();
    const coverage = page.getByTestId('round-coverage');
    const tools = coverage.getByRole('row').filter({ hasText: 'file-contract / behavior' });
    await expect(tools).toContainText('a-fail、b-pass');
    await expect(tools).toContainText('FAIL');
    const reviewer = coverage.getByRole('row').filter({ hasText: 'file-contract / semantics' });
    await expect(reviewer).toContainText('独立 Reviewer');
    await expect(reviewer).toContainText('尚未满足');
    await expect(page.getByTestId('round-gaps')).toContainText('工具检查不能代替审阅');
    await expect(page.getByTestId('verification-round-detail')).toContainText('behavior: 已接纳');
    await page.getByTestId('round-report-a-fail').click();
    await expect(page.getByTestId('check-report')).toBeVisible();
    await expect(page.getByTestId('report-stdout-0')).toHaveText('browser-original-failure\n');
    await expect(page.getByTestId('report-body-0')).toContainText('FAIL');
    const executions = await readFile(join(app.root, '.cache', 'browser-checks'), 'utf8');
    expect(executions).toBe('fail-once\npass-once\n');
    const modelCalls = app.modelRequests();

    // This also exercises durable report retrieval from a new built host,
    // not a synthetic state/report response or the browser's previous detail.
    await app.restart();
    await openVerification(page, app);
    await page.getByTestId(`open-round-${result.round.requestId}`).click();
    await expect(page.getByTestId('round-outcome')).toHaveText('FAIL');
    await expect(page.getByTestId('round-gaps')).toContainText('工具检查不能代替审阅');
    await page.getByTestId('round-report-a-fail').click();
    await expect(page.getByTestId('report-stdout-0')).toHaveText('browser-original-failure\n');
    expect(await readFile(join(app.root, '.cache', 'browser-checks'), 'utf8')).toBe(executions);
    expect(app.modelRequests()).toBe(modelCalls);
  });

  test('提交后丢响应保留请求，reload 查询原回执不重跑；源文件改变只把旧轮次标为过期', async ({ page }) => {
    const app = await fixture();
    await openVerification(page, app);
    await configure(page, [
      { id: 'a-pass', command: "mkdir -p .cache && printf 'a-once\\n' >> .cache/browser-checks && printf 'browser-recoverable-pass\\n' && test \"$(cat subject.txt)\" = expected" },
      { id: 'b-pass', command: "printf 'b-once\\n' >> .cache/browser-checks && test \"$(cat subject.txt)\" = expected" },
    ]);
    const network = { submissions: 0, committed: null as { status: number; body: VerificationRoundResult } | null };
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === startPath) network.submissions++;
    });
    await page.route('**' + startPath, async route => {
      // The server actually completes the round. Lose only its browser response.
      const response = await route.fetch({ timeout: 60000 });
      network.committed = { status: response.status(), body: await response.json() as VerificationRoundResult };
      await route.abort('failed');
    }, { times: 1 });
    await page.getByTestId('start-verification-round').click();
    await expect(page.getByTestId('round-message')).toContainText('提交结果未知', { timeout: 60000 });
    expect(network.committed).not.toBeNull();
    if (!network.committed) throw Error('The intercepted request never received a real server response.');
    expect(network.committed.status).toBe(200);
    const original = network.committed.body.round;
    expect(original.outcome).toBe('INCONCLUSIVE');
    expect(original.aggregate?.artifactRef.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(original.control.taskPhase).not.toBe('satisfied');
    expect(original.control.goalPhase).not.toBe('COMPLETED');
    await expect(page.getByTestId('round-pending')).toContainText(original.requestId);
    const executions = await readFile(join(app.root, '.cache', 'browser-checks'), 'utf8');
    expect(executions).toBe('a-once\nb-once\n');
    const modelCalls = app.modelRequests();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('app')).toBeVisible();
    await page.getByTestId('tab-verification').click();
    await expect(page.getByTestId('round-pending')).toContainText(original.requestId);
    await page.getByTestId('round-query-receipt').click();
    await expect(page.getByTestId('round-pending')).toHaveCount(0);
    await expect(page.getByTestId('round-outcome')).toHaveText('INCONCLUSIVE');
    await expect(page.getByTestId('verification-round-detail')).toContainText('当前有效来源');
    const tools = page.getByTestId('round-coverage').getByRole('row').filter({ hasText: 'file-contract / behavior' });
    await expect(tools).toContainText('a-pass、b-pass');
    await expect(tools).toContainText('PASS');
    await expect(page.getByTestId('round-gaps')).toContainText('工具检查不能代替审阅');
    await expect(page.getByTestId(`open-round-${original.requestId}`)).toHaveCount(1);
    expect(network.submissions).toBe(1);
    expect(await readFile(join(app.root, '.cache', 'browser-checks'), 'utf8')).toBe(executions);

    await writeFile(join(app.root, 'subject.txt'), 'changed externally after reports\n');
    await page.getByTestId('verification-round-detail').getByRole('button', { name: '刷新来源与进度', exact: true }).click();
    await expect(page.getByTestId('verification-round-detail')).toContainText('已过期，只保留历史解释');
    await expect(page.getByTestId('round-outcome')).toHaveText('INCONCLUSIVE');
    await expect(page.getByTestId('verification-round-detail')).toContainText(original.aggregate!.artifactRef.digest);
    await page.getByTestId('round-report-a-pass').click();
    await expect(page.getByTestId('report-stdout-0')).toHaveText('browser-recoverable-pass\n');
    expect(network.submissions).toBe(1);
    expect(await readFile(join(app.root, '.cache', 'browser-checks'), 'utf8')).toBe(executions);
    expect(app.modelRequests()).toBe(modelCalls);
  });
});
