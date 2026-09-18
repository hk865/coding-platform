import { expect, test, type Page } from '@playwright/test';
import { openApp } from './helpers';

const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'perf41-goal' };
const observedAt = '2026-09-17T08:00:00.000Z';

test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); });

async function overview(page: Page) {
  let answerId = 'answer-one';
  const views: Array<string | null> = [];
  await page.route('**/api/state?**', async route => {
    views.push(new URL(route.request().url()).searchParams.get('view'));
    // Fetch a registered scope's real overview before injecting this UI-only
    // answer. The display goal is synthetic and must not be queried on the host.
    const hostUrl = new URL(route.request().url()); hostUrl.searchParams.delete('goalId');
    const response = await route.fetch({ url: hostUrl.href });
    const data = await response.json();
    await route.fulfill({ json: { ...data, goalId: scope.goalId, applicability: { status: 'not_checked', observedAt }, queries: [{
      status: 'ready', job: { queryJobId: 'query-one', goalId: scope.goalId, submittedAt: observedAt, status: 'answered', closeReason: null,
        intent: { question: '当前回答适用吗？', focusTaskRefs: [] } },
      currentAnswer: { schemaVersion: 1, answerId, queryJobRef: { aggregateType: 'QueryJob', ...scope, queryJobId: 'query-one' },
        runRef: { aggregateType: 'QueryRun', ...scope, queryJobId: 'query-one', runId: 'query-run' },
        answer: '已保存的回答', sources: [], stale: false, staleReason: null, answeredAt: observedAt, roundIndex: 0,
        followsAnswerRef: null, bodyRef: { digest: 'a'.repeat(64) } },
    }] } });
  });
  return { views, replaceAnswer: () => { answerId = 'answer-two'; } };
}

test('概览只显示历史回答，适用性检查由用户触发并保留观察时间', async ({ page }) => {
  const fixture = await overview(page);
  let checks = 0;
  await page.route('**/api/query-applicability?**', async route => {
    checks++;
    const url = new URL(route.request().url());
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...scope, queryJobId: 'query-one', answerId: 'answer-one' });
    await route.fulfill({ json: { status: 'current', observedAt, observedCursor: '42', queryJobId: 'query-one', answerId: 'answer-one' } });
  });
  await openApp(page, '?' + new URLSearchParams(scope));
  const panel = page.getByTestId('answer-applicability');
  await expect(panel).toContainText('尚未检查');
  expect(checks).toBe(0);
  await page.getByTestId('refresh').click();
  await expect(panel).toContainText('尚未检查');
  expect(checks).toBe(0);
  expect(fixture.views.length).toBeGreaterThan(0);
  expect(fixture.views.every(view => view === 'overview')).toBe(true);
  await panel.getByRole('button', { name: '检查当前适用性' }).click();
  await expect(panel.getByTestId('answer-applicability-result')).toContainText('不代表之后仍然有效');
  await expect(panel).toContainText('观察版本：42');
  expect(checks).toBe(1);
});

test('回答替换取消在途检查，旧结果不能成为新回答的适用性', async ({ page }) => {
  const fixture = await overview(page);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/query-applicability?**', async route => {
    entered(); await released;
    await route.fulfill({ json: { status: 'current', observedAt, observedCursor: '42', queryJobId: 'query-one', answerId: 'answer-one' } });
  });
  try {
    await openApp(page, '?' + new URLSearchParams(scope));
    const panel = page.getByTestId('answer-applicability');
    await panel.getByRole('button', { name: '检查当前适用性' }).click();
    await started;
    await expect(panel).toContainText('正在检查');
    const aborted = page.waitForEvent('requestfailed', request => request.url().includes('/api/query-applicability?'));
    fixture.replaceAnswer();
    await page.getByTestId('refresh').click();
    await expect(panel).toHaveAttribute('data-answer-id', 'answer-two');
    await aborted;
    release();
    await expect(panel).toContainText('尚未检查');
    await expect(panel.getByTestId('answer-applicability-result')).toHaveCount(0);
  } finally { release(); await page.unrouteAll({ behavior: 'ignoreErrors' }); }
});

test('检查无法确认与请求失败不显示为来源已变化或适用', async ({ page }) => {
  await overview(page);
  let checks = 0;
  await page.route('**/api/query-applicability?**', async route => {
    checks++;
    if (checks === 1) await route.fulfill({ json: { status: 'not_current', observedAt, observedCursor: '42', queryJobId: 'query-one', answerId: 'answer-one' } });
    else await route.fulfill({ status: 503, json: { error: 'unavailable' } });
  });
  await openApp(page, '?' + new URLSearchParams(scope));
  const panel = page.getByTestId('answer-applicability');
  await panel.getByRole('button', { name: '检查当前适用性' }).click();
  await expect(panel).toContainText('不能据此断言某个来源已经变化');
  await panel.getByRole('button', { name: '检查当前适用性' }).click();
  await expect(panel.getByRole('alert')).toContainText('适用性检查失败');
  await expect(panel.getByTestId('answer-applicability-result')).toHaveCount(0);
});
