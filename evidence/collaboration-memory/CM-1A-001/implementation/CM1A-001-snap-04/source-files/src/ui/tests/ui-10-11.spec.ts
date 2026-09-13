import { expect, test } from '@playwright/test';
import { openApp, waitForSynced } from './helpers';

test.describe('UI-10 未接通能力的准确呈现', () => {
  test('架构、记忆与续跑说明缺项，Reviewer只呈现真实材料状态而不使用固定示例', async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);
    const views: Array<[string, string, string]> = [
      ['open-architecture', '真实架构图', 'architecture'],
      ['open-memory', '长期记忆与规则管理', 'memory'],
      ['open-continuation', '中断任务续跑', 'continuation'],
    ];
    for (const [testId, title, view] of views) {
      await page.getByTestId('add-view').click();
      await page.getByTestId(testId).click();
      await expect(page.getByTestId('right-workbench')).toContainText('后端未支持');
      await expect(page.getByTestId('right-workbench')).toContainText(title);
      await expect(page.getByTestId('right-workbench')).toContainText('缺少的依赖');
      await page.getByTestId('close-' + view).click();
    }
    await page.getByTestId('add-view').click();
    await page.getByTestId('open-reviewer').click();
    await expect(page.getByTestId('independent-reviews')).toBeVisible();
    await expect(page.getByTestId('start-review')).toBeDisabled();
    await expect(page.getByTestId('independent-reviews')).toContainText('已保存审阅（0）');
    await expect(page.getByTestId('review-issue')).toHaveCount(0);
    await page.getByTestId('close-reviewer').click();
  });
});

test.describe('UI-11 三种尺寸与键盘操作', () => {
  for (const [width, height, label] of [[1440, 900, '桌面'], [1024, 768, '平板'], [390, 844, '手机']] as const) {
    test(label + ' ' + width + 'x' + height + ' 核心操作可达且无横向溢出', async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openApp(page);
      await waitForSynced(page);
      await expect(page.getByTestId('composer-input')).toBeVisible();
      await expect(page.getByTestId('submit-task')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      if (width <= 1024) {
        await expect(page.getByTestId('toggle-rail')).toBeVisible();
        await page.getByTestId('toggle-rail').click();
        await expect(page.getByTestId('project-rail')).toBeVisible();
        await expect(page.getByTestId('new-goal')).toBeVisible();
      }
      if (width <= 560) {
        await page.getByTestId('toggle-rail').click(); // close the drawer before using the floating control
        await expect(page.getByTestId('open-dock')).toBeVisible();
        await page.getByTestId('open-dock').click();
        await expect(page.getByTestId('right-workbench')).toBeVisible();
      }
    });
  }

  test('标签方向键、菜单 Escape 焦点返回、分隔条键盘调整与主题切换', async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);
    const tasks = page.getByTestId('tab-tasks');
    await tasks.focus();
    await tasks.press('ArrowRight');
    await expect(page.getByTestId('tab-files')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('tab-files').press('Home');
    await expect(tasks).toHaveAttribute('aria-selected', 'true');

    // Opening the view menu and pressing Escape returns focus to its trigger.
    await page.getByTestId('add-view').click();
    await expect(page.getByTestId('open-diff')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('open-diff')).toHaveCount(0);
    await expect(page.getByTestId('add-view')).toBeFocused();

    // The splitter is keyboard operable and reports its value.
    const handle = page.getByRole('separator', { name: '调整左侧项目栏宽度' });
    await handle.focus();
    const before = Number(await handle.getAttribute('aria-valuenow'));
    await handle.press('ArrowRight');
    expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    await handle.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', '160');

    // Theme switching is visible and persisted in the document.
    const schemeBefore = await page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme'));
    await page.getByTestId('toggle-theme').click();
    await expect.poll(async () => page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme'))).not.toBe(schemeBefore);
  });
});
