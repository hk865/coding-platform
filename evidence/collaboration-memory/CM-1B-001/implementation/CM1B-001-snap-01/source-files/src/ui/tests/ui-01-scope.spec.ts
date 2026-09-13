import { expect, test } from '@playwright/test';
import { api, openApp, selectProject, waitForSynced } from './helpers';

test.describe('UI-01 作用域隔离与旧响应忽略', () => {
  test('草稿、目标与文件引用不跨项目串用，延迟的旧请求不覆盖新作用域', async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);

    // Alpha: create a distinct goal and start a draft with a file reference.
    const created = await api(page, '/api/goals', { projectId: 'acceptance-alpha', workspaceId: 'workspace-main', requestId: 'ui01-alpha-goal', objective: 'Alpha 专属目标：验证作用域隔离' }) as { status: number; body: { goalId: string } };
    expect(created.status).toBe(200);
    await page.getByTestId('goal-' + created.body.goalId).click();
    await expect(page.getByTestId('goal-' + created.body.goalId)).toBeVisible();

    await page.getByTestId('composer-input').fill('Alpha 草稿：修改 src/app.py');
    await expect(page.getByTestId('composer-input')).toHaveValue('Alpha 草稿：修改 src/app.py');

    // A file reference captured in alpha must not appear in beta.
    await page.getByTestId('tab-files').click();
    await page.getByText('src', { exact: true }).click();
    await page.getByText('app.py', { exact: true }).click();
    await expect(page.getByTestId('file-content')).toBeVisible();
    await page.locator('[data-line="2"]').click();
    await page.getByTestId('add-reference').click();
    await expect(page.getByTestId('reference-chips')).toContainText('src/app.py:2');

    // Switch to beta while an alpha state request is still in flight.
    let delayed = false;
    await page.route('**/api/state**', async route => {
      if (!delayed && route.request().url().includes('acceptance-alpha')) {
        delayed = true;
        await new Promise(resolve => setTimeout(resolve, 4000));
      }
      try { await route.continue(); } catch { /* the client aborted the stale request */ }
    });
    await selectProject(page, 'acceptance-beta');
    await expect(page.getByTestId('composer-input')).toHaveValue('');
    await expect(page.getByTestId('reference-chips')).toHaveCount(0);
    await expect(page.getByTestId('goal-acceptance-demo')).toBeVisible();

    // The late alpha answer must not replace the beta screen.
    await page.waitForTimeout(5000);
    await expect(page.getByTestId('goal-acceptance-demo')).toBeVisible();
    await expect(page.getByText('Alpha 专属目标：验证作用域隔离')).toHaveCount(0);

    // Returning to alpha restores its own draft and reference.
    await selectProject(page, 'acceptance-alpha');
    await page.getByTestId('goal-' + created.body.goalId).click();
    await expect(page.getByTestId('composer-input')).toHaveValue('Alpha 草稿：修改 src/app.py');
    await expect(page.getByTestId('reference-chips')).toContainText('src/app.py:2');
  });
});

