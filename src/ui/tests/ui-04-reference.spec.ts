import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { api, openApp, waitForSynced } from './helpers';

/**
 * The fixture path comes from the server's own project registry (/api/meta), not
 * from a hard-coded relative path: a test that edits a different file than the one
 * the server serves would otherwise fail for the wrong reason. The original bytes
 * are restored in `finally`, so a failure cannot leak into later tests.
 */
async function fixtureFile(page: import('@playwright/test').Page): Promise<string> {
  const meta = await api(page, '/api/meta') as { body: { scopes: Array<{ projectId: string; root: string }> } };
  const entry = meta.body.scopes.find(scope => scope.projectId === 'acceptance-alpha');
  if (!entry) throw new Error('fixture server did not register acceptance-alpha');
  return join(entry.root, 'src/app.py');
}

test.describe('UI-04 文件引用与版本核对', () => {
  test('定位行、选择片段、加入草稿；提交前文件变化会被服务器拒绝', async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);
    const target = await fixtureFile(page);
    const original = await readFile(target, 'utf8');
    try {
      // Open the file from the explorer and locate a line range.
      await page.getByTestId('tab-files').click();
      await page.getByText('src', { exact: true }).click();
      await page.getByText('app.py', { exact: true }).click();
      await expect(page.getByTestId('file-content')).toBeVisible();
      await expect(page.getByTestId('file-content')).toContainText('def add(a, b):');
      await page.locator('[data-line="1"]').click();
      await page.locator('[data-line="2"]').click({ modifiers: ['Shift'] });
      await expect(page.getByText('已选 第 1-2 行')).toBeVisible();

      // The reference chip carries path, line range and the version captured at read time.
      await page.getByTestId('add-reference').click();
      const chip = page.getByTestId('reference-chips');
      await expect(chip).toContainText('src/app.py:1-2');
      await expect(chip).toContainText('v');

      // Change the file after the reference was captured, then submit.
      await writeFile(target, original.replace('return a + b', 'return a + b  # changed after reference'));
      await page.getByTestId('composer-input').fill('按引用修改 src/app.py 的实现');
      await page.getByTestId('allow-write').check();
      await page.getByTestId('submit-task').click();
      await expect(page.getByTestId('submit-error')).toContainText('引用文件已变化', { timeout: 20_000 });

      // The rejected submission must not create a run.
      const state = await api(page, '/api/state?' + new URLSearchParams({ projectId: 'acceptance-alpha', workspaceId: 'workspace-main', goalId: 'acceptance-demo' })) as { body: { liveRuns?: unknown[] } };
      expect(state.body.liveRuns?.length ?? 0).toBe(0);

      // Re-reading shows the new content and updating the reference captures the new version.
      await page.getByTestId('reload-file').click();
      await expect(page.getByTestId('file-content')).toContainText('changed after reference', { timeout: 20_000 });
    } finally {
      await writeFile(target, original);
    }
  });
});
