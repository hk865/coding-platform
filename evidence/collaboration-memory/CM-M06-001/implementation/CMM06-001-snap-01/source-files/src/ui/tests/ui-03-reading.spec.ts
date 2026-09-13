import { expect, test, type Page } from '@playwright/test';
import { api, openApp, waitForSynced } from './helpers';

const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main' };
const run = 'ui03-' + Date.now();

async function seedConversation(page: Page, goalId: string): Promise<void> {
  const target = { ...scope, goalId };
  const plan = await api(page, '/api/plans/sample', target) as { status: number };
  expect(plan.status).toBe(200);
  for (let index = 0; index < 6; index += 1) {
    const result = await api(page, '/api/queries', { ...target, requestId: run + '-query-' + index, question: '第 ' + (index + 1) + ' 个问题：当前进展如何？' }) as { status: number };
    expect(result.status).toBe(200);
  }
}

test.describe('UI-03 稳定阅读', () => {
  test('向上阅读时刷新不抢滚动、不丢焦点与草稿，新消息提示可用', async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);
    const created = await api(page, '/api/goals', { ...scope, requestId: run + '-goal', objective: 'UI-03 阅读目标：验证历史消息稳定' }) as { status: number; body: { goalId: string } };
    expect(created.status).toBe(200);
    await seedConversation(page, created.body.goalId);
    await page.getByTestId('goal-' + created.body.goalId).click();
    await page.waitForTimeout(3500);

    const scroller = page.getByTestId('conversation-scroll');
    await expect(scroller).toBeVisible();
    const messageCount = await page.locator('.message').count();
    expect(messageCount).toBeGreaterThanOrEqual(12);

    // Read from the top and keep the caret in the composer.
    await scroller.evaluate(node => { node.scrollTop = 0; });
    await page.getByTestId('composer-input').fill('阅读中的草稿');
    await page.getByTestId('composer-input').focus();
    await page.locator('.usage-details').first().evaluate(node => node.setAttribute('open', ''));
    await page.waitForTimeout(6000); // at least two background refreshes

    expect(await scroller.evaluate(node => node.scrollTop)).toBeLessThanOrEqual(2);
    await expect(page.getByTestId('composer-input')).toHaveValue('阅读中的草稿');
    await expect(page.getByTestId('composer-input')).toBeFocused();
    await expect(page.locator('.usage-details').first()).toHaveAttribute('open', '');

    // A new server message must not move the reader; it offers a jump control instead.
    await api(page, '/api/queries', { ...scope, goalId: created.body.goalId, requestId: run + '-query-late', question: '滚动时的第 7 个问题？' });
    await expect(page.getByTestId('new-messages')).toBeVisible({ timeout: 20_000 });
    expect(await scroller.evaluate(node => node.scrollTop)).toBeLessThanOrEqual(2);
    await page.getByTestId('new-messages').click();
    await expect(page.getByTestId('new-messages')).toHaveCount(0);
    expect(await scroller.evaluate(node => node.scrollTop)).toBeGreaterThan(0);

    // The summary and usage blocks scroll with the content instead of covering it.
    expect(await page.locator('.goal-heading').evaluate(node => getComputedStyle(node).position)).toBe('static');
    expect(await page.locator('.usage-details').first().evaluate(node => getComputedStyle(node).position)).toBe('static');
  });
});

