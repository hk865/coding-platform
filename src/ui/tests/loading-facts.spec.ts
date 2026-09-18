import { expect, test } from '@playwright/test';
import { openApp, waitForSynced } from './helpers';

test('初次状态未到达时不把未知执行能力显示成fixture', async ({ page }) => {
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/state**', async route => { await released; await route.continue(); });
  try {
    await openApp(page);
    await expect(page.getByTestId('conversation')).toContainText('执行 正在读取');
    await expect(page.getByTestId('conversation')).not.toContainText('执行 fixture');
    release(); await waitForSynced(page);
    await expect(page.getByTestId('conversation')).not.toContainText('执行 正在读取');
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});
