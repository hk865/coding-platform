import { expect, test } from '@playwright/test';
import { openApp, waitForSynced } from './helpers';

test('creates a named document agent template, displays its tool upper bound and preserves both versions', async ({ page }) => {
  await openApp(page);
  await waitForSynced(page);
  await page.getByTestId('open-settings').click();
  const section = page.getByTestId('governance-RoleSpecRevision');
  await expect(section).toBeVisible();
  await section.getByLabel('模板标识', { exact: true }).fill('browser-document-advisor');
  await section.getByLabel('Agent 名称', { exact: true }).fill('文档参谋');
  await section.getByLabel('简介与职责', { exact: true }).fill('核对文档来源并提出建议');
  await section.getByRole('button', { name: '保存模板版本', exact: true }).click();
  const card = section.getByTestId('role-spec-browser-document-advisor');
  await expect(card).toContainText('核对文档来源并提出建议');
  await expect(card).toContainText('工具申请上界：read');
  await section.getByLabel('模板版本', { exact: true }).fill('2');
  await section.getByLabel('简介与职责', { exact: true }).fill('核对多个文档的冲突及来源');
  await section.getByRole('button', { name: '保存模板版本', exact: true }).click();
  await expect(card).toContainText('核对多个文档的冲突及来源');
  await expect(card).toContainText('核对文档来源并提出建议');
  await card.getByRole('button', { name: '激活版本 2', exact: true }).click();
  await expect(card).toContainText('版本 2 · 当前生效');
  await page.reload();
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('role-spec-browser-document-advisor')).toContainText('版本 2 · 当前生效');
});
