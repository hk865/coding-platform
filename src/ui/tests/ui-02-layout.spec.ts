import { expect, test } from '@playwright/test';
import { openApp, waitForSynced } from './helpers';

test.describe('UI-02 布局、标签与恢复', () => {
  test('调整宽度、固定与关闭标签、刷新后恢复，中栏不小于 280px', async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);

    // Pin the task tab, close the files tab, keep an Agent tab open.
    await page.getByTestId('tab-tasks').click();
    await page.getByRole('button', { name: '固定 任务' }).click();
    await page.getByTestId('close-files').click();
    await expect(page.getByTestId('tab-files')).toHaveCount(0);
    await expect(page.getByTestId('close-tasks')).toBeDisabled();

    // Widen the right pane with the keyboard (accessible resizer).
    const rightHandle = page.getByRole('separator', { name: '调整右侧工作台宽度' });
    await rightHandle.focus();
    const before = Number(await rightHandle.getAttribute('aria-valuenow'));
    await rightHandle.press('ArrowLeft');
    await rightHandle.press('ArrowLeft');
    const after = Number(await rightHandle.getAttribute('aria-valuenow'));
    expect(after).toBeGreaterThan(before);

    // Drag the left pane to its maximum; the centre column must keep 280px.
    const leftHandle = page.getByRole('separator', { name: '调整左侧项目栏宽度' });
    await leftHandle.focus();
    await leftHandle.press('End');
    const centre = await page.getByTestId('center').evaluate(node => node.getBoundingClientRect().width);
    expect(centre).toBeGreaterThanOrEqual(280);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('app')).toBeVisible();
    await expect(page.getByTestId('tab-files')).toHaveCount(0);
    await expect(page.getByTestId('close-tasks')).toBeDisabled();
    await expect(rightHandle).toHaveAttribute('aria-valuenow', String(after));
    const restoredCentre = await page.getByTestId('center').evaluate(node => node.getBoundingClientRect().width);
    expect(restoredCentre).toBeGreaterThanOrEqual(280);
  });

  test('折叠底部工具区不会终止终端会话', async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);
    await page.getByTestId('toggle-bottom').click();
    await page.getByTestId('terminal-new').click();
    await expect(page.getByTestId('terminal-session')).toBeVisible();
    await expect(page.getByTestId('terminal-session')).not.toHaveAttribute('data-session-id', '', { timeout: 20_000 });
    const session = await page.getByTestId('terminal-session').getAttribute('data-session-id');
    await page.getByTestId('toggle-bottom').click();
    await expect(page.getByTestId('terminal-host')).toHaveCount(0);
    await page.getByTestId('toggle-bottom').click();
    await expect(page.getByTestId('terminal-session')).toHaveAttribute('data-session-id', session ?? '');
    await expect(page.getByTestId('terminal-status')).toContainText('受限 Bash');
  });
});

