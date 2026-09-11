import { expect, test } from '@playwright/test';
import { api, openApp, waitForSynced } from './helpers';

const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main' };
const run = 'ui0608-' + Date.now();

test.describe('UI-06 检查与报告', () => {
  test('真实运行前不提供假报告；检查入口只在有真实运行时出现', async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);
    const created = await api(page, '/api/goals', { ...scope, requestId: run + '-goal', objective: 'UI-06 检查报告目标' }) as { status: number; body: { goalId: string } };
    await api(page, '/api/plans/sample', { ...scope, goalId: created.body.goalId });
    await api(page, '/api/tasks/run', { ...scope, goalId: created.body.goalId, taskId: 'task-install-contract' });
    await page.getByTestId('goal-' + created.body.goalId).click();
    await page.waitForTimeout(2500);

    await page.getByTestId('tab-verification').click();
    // Fixture runs are not real sandboxed runs: the view must state that instead of offering a fake report.
    await expect(page.getByTestId('right-workbench')).toContainText('还没有真实运行');
    await expect(page.getByTestId('run-check')).toHaveCount(0);
    await expect(page.getByTestId('right-workbench')).toContainText('尚无命令检查记录');
    await expect(page.getByTestId('right-workbench')).toContainText('尚无独立验收记录');
    await expect(page.getByTestId('right-workbench')).toContainText('授权返工与重验');
    await expect(page.getByTestId('right-workbench')).toContainText('后端未支持');
  });
});

test.describe('UI-07 终端', () => {
  test('真实命令输出、显式中断、折叠与重连', async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);
    await page.getByTestId('toggle-bottom').click();
    const beforeCreate = await page.getByTestId('terminal-session').getAttribute('data-session-id');
    await page.getByTestId('terminal-new').click();
    // Wait until the view actually switched to the session this test created.
    await expect.poll(async () => page.getByTestId('terminal-session').getAttribute('data-session-id'), { timeout: 20_000 }).not.toBe(beforeCreate);
    const sessionId = (await page.getByTestId('terminal-session').getAttribute('data-session-id')) ?? '';
    expect(sessionId).not.toBe('');

    const readOutput = async (): Promise<string> => page.evaluate(async (sessionId) => {
      const meta = await (await fetch('/api/meta')).json() as { workspaceToken: string };
      const query = new URLSearchParams({ projectId: 'acceptance-alpha', workspaceId: 'workspace-main', sessionId, after: '0' });
      const output = await (await fetch('/api/terminals/output?' + query, { headers: { 'x-platform-token': meta.workspaceToken } })).json() as { chunks?: Array<{ data: string }> };
      return (output.chunks ?? []).map(chunk => chunk.data).join('');
    }, sessionId);

    // Wait for the restricted shell prompt, then type into the real PTY.
    await expect.poll(async () => (await readOutput()).includes('$'), { timeout: 30_000 }).toBe(true);
    await page.getByTestId('terminal-host').click();
    await page.keyboard.type("printf 'TERM_%s\\n' OK");
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await readOutput()).includes('TERM_OK'), { timeout: 30_000 }).toBe(true);

    // Collapsing the dock keeps the session; reopening reconnects to the same session.
    await page.getByTestId('toggle-bottom').click();
    await expect(page.getByTestId('terminal-host')).toHaveCount(0);
    await page.getByTestId('toggle-bottom').click();
    await expect(page.getByTestId('terminal-session')).toHaveAttribute('data-session-id', sessionId);

    // Reloading the page must reattach to the server-side session, not create a new one.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('bottom-dock')).toBeVisible();
    if ((await page.getByTestId('bottom-dock').getAttribute('data-open')) !== 'true') await page.getByTestId('toggle-bottom').click();
    await expect(page.getByTestId('terminal-session')).toHaveAttribute('data-session-id', sessionId, { timeout: 20_000 });

    // Explicit interrupt reaches the process, and closing ends it with a reported exit.
    await page.getByTestId('terminal-interrupt').click();
    await page.getByTestId('terminal-close').click();
    await expect.poll(async () => page.getByTestId('terminal-status').innerText(), { timeout: 20_000 }).toContain('会话已退出');
  });
});

test.describe('UI-08 模型设置', () => {
  test('保存回执、密钥不泄漏，消费者版本对照可见', async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('model-name')).toBeVisible();
    await page.getByTestId('model-name').fill('deepseek-chat');
    await page.getByTestId('model-base-url').fill('https://api.deepseek.com');
    await page.getByTestId('save-settings').click();
    await expect(page.getByTestId('right-workbench')).toContainText('配置已保存，版本', { timeout: 20_000 });
    await expect(page.getByTestId('right-workbench')).toContainText('运行使用版本');
    await expect(page.getByTestId('model-key')).toHaveValue('');
    await expect(page.getByTestId('right-workbench')).toContainText('尚未设置密钥');
    const leaked = await page.evaluate(() => document.body.innerHTML.includes('apiKey'));
    expect(leaked).toBe(false);
  });
});
