import { expect, test } from '@playwright/test';
import { api, openApp, waitForSynced } from './helpers';

const scope = { projectId: 'acceptance-alpha', workspaceId: 'workspace-main' };
const run = 'ui0509-' + Date.now();

async function seedPlan(page: import('@playwright/test').Page, goalId: string): Promise<void> {
  await api(page, '/api/plans/sample', { ...scope, goalId });
}

test.describe('UI-05 任务与 Agent 详情一致', () => {
  test('列表、图与 Agent 打开同一对象；运行结束不使任务自动通过', async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);
    const created = await api(page, '/api/goals', { ...scope, requestId: run + '-goal', objective: 'UI-05 任务与 Agent 详情目标' }) as { status: number; body: { goalId: string } };
    await seedPlan(page, created.body.goalId);
    await api(page, '/api/tasks/run', { ...scope, goalId: created.body.goalId, taskId: 'task-install-contract' });
    await page.getByTestId('goal-' + created.body.goalId).click();
    await page.waitForTimeout(3000);

    // List detail and graph node refer to the same task identity.
    await page.getByTestId('tab-tasks').click();
    await page.getByTestId('task-detail-task-install-contract').click();
    await expect(page.getByTestId('task-detail')).toContainText('task-install-contract');
    await expect(page.getByTestId('task-detail')).toContainText('运行已结束');
    await expect(page.getByTestId('task-detail')).toContainText('尚无正式判定');
    await page.getByTestId('task-detail').getByRole('button', { name: '关闭' }).click();

    await page.getByRole('button', { name: '任务图' }).click();
    await expect(page.getByTestId('task-graph')).toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(4);
    await page.getByTestId('close-task-graph').click();

    // The Agent view reports the same run and the same task, without claiming success.
    await page.getByTestId('tab-agents').click();
    await expect(page.getByTestId('right-workbench')).toContainText('运行已结束');
    await page.getByRole('button', { name: '详情' }).first().click();
    await expect(page.getByTestId('agent-detail')).toContainText('task-install-contract');
    await expect(page.getByTestId('agent-detail')).toContainText('尚无正式判定');

    // The task row keeps its formal state: a finished run is not an accepted result.
    await page.getByTestId('tab-tasks').click();
    const row = page.locator('[data-task-id="task-install-contract"]');
    await expect(row).not.toContainText('已验证');
  });
});

test.describe('UI-09 重复提交与未知结果', () => {
  /**
   * The real case the earlier test missed: the server COMMITTED the operation and
   * only the response was lost. `route.fetch()` lets the request reach the server,
   * then `route.abort()` drops the answer — exactly what a dropped connection does.
   */
  for (const responseFault of ['dropped', 'malformed'] as const) {
  test(`后端已提交但响应 ${responseFault}：阻止覆盖，刷新重试不重复创建`, async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);
    const objective = 'UI-09 已提交但响应丢失的目标 ' + run + responseFault;
    const requestIds: string[] = [];
    let dropped = false;
    await page.route('**/api/goals', async route => {
      requestIds.push((route.request().postDataJSON() as { requestId: string }).requestId);
      if (!dropped) {
        dropped = true;
        await route.fetch(); // Commit to the real server before damaging the reply.
        if (responseFault === 'malformed') await route.fulfill({ status: 200, contentType: 'application/json', body: '{truncated' });
        else await route.abort('failed');
        return;
      }
      await route.continue();
    });

    await page.getByTestId('new-goal').click();
    await page.getByTestId('goal-objective').fill(objective);
    await page.getByTestId('create-goal').click();
    await expect(page.getByTestId('goal-error')).toContainText('结果未知', { timeout: 20_000 });
    expect(requestIds).toHaveLength(1);

    // The goal exists on the server even though the page never saw the receipt.
    const created = await page.evaluate(async objective => {
      const meta = await (await fetch('/api/meta')).json() as { workspaceToken: string };
      const state = await (await fetch('/api/state?' + new URLSearchParams({ projectId: 'acceptance-alpha', workspaceId: 'workspace-main' }), { headers: { 'x-platform-token': meta.workspaceToken } })).json() as { goals: Array<{ status: string; goal?: { objective: string } }> };
      return state.goals.filter(goal => goal.status === 'ready' && goal.goal?.objective === objective).length;
    }, objective);
    expect(created).toBe(1);

    await page.getByTestId('goal-objective').fill(objective + '-changed');
    await page.getByTestId('create-goal').click();
    await expect(page.getByTestId('goal-error')).toContainText('旧请求结果仍未确定');
    expect(requestIds).toHaveLength(1); // Changed content never reaches the server.

    // Reload: the pending request survives, and the retry reuses its identifier.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForSynced(page);
    await page.getByTestId('new-goal').click();
    await expect(page.getByTestId('pending-goal')).toContainText(requestIds[0]!);
    await page.getByTestId('goal-objective').fill(objective);
    await page.getByTestId('create-goal').click();
    // Mantine keeps the modal root node after closing, so assert the dialog is gone
    // from view rather than absent from the DOM.
    await expect(page.getByTestId('goal-dialog')).toBeHidden({ timeout: 20_000 });
    expect(requestIds).toHaveLength(2);
    expect(requestIds[1]).toBe(requestIds[0]);
    expect((await page.evaluate(async objective => {
      const meta = await (await fetch('/api/meta')).json() as { workspaceToken: string };
      const state = await (await fetch('/api/state?' + new URLSearchParams({ projectId: 'acceptance-alpha', workspaceId: 'workspace-main' }), { headers: { 'x-platform-token': meta.workspaceToken } })).json() as { goals: Array<{ status: string; goal?: { objective: string } }> };
      return state.goals.filter(goal => goal.status === 'ready' && goal.goal?.objective === objective).length;
    }, objective))).toBe(1);
  });
  }

  test('后端已提交但响应丢失：刷新后查询回执即可确认，不重复创建', async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);
    const objective = 'UI-09 回执查询目标 ' + run;
    let requestId = '';
    await page.route('**/api/goals', async route => {
      requestId = (route.request().postDataJSON() as { requestId: string }).requestId;
      await route.fetch();
      await route.abort('failed');
    });
    await page.getByTestId('new-goal').click();
    await page.getByTestId('goal-objective').fill(objective);
    await page.getByTestId('create-goal').click();
    await expect(page.getByTestId('goal-error')).toContainText('结果未知', { timeout: 20_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForSynced(page);
    await page.getByTestId('new-goal').click();
    await expect(page.getByTestId('pending-goal')).toContainText(requestId);
    await page.getByTestId('query-goal-receipt').click();
    // A found receipt closes the dialog, selects the committed goal and creates nothing new.
    await expect(page.getByTestId('goal-dialog')).toBeHidden({ timeout: 20_000 });
    await expect(page.getByTestId('goal-' + requestId)).toBeVisible();
    expect((await page.evaluate(async objective => {
      const meta = await (await fetch('/api/meta')).json() as { workspaceToken: string };
      const state = await (await fetch('/api/state?' + new URLSearchParams({ projectId: 'acceptance-alpha', workspaceId: 'workspace-main' }), { headers: { 'x-platform-token': meta.workspaceToken } })).json() as { goals: Array<{ status: string; goal?: { objective: string } }> };
      return state.goals.filter(goal => goal.status === 'ready' && goal.goal?.objective === objective).length;
    }, objective))).toBe(1);
  });

  test('网络失败显示结果未知，重试复用同一请求标识且不重复创建', async ({ page }) => {
    await openApp(page);
    await waitForSynced(page);
    const created = await api(page, '/api/goals', { ...scope, requestId: run + '-goal-2', objective: 'UI-09 重复提交防护目标' }) as { status: number; body: { goalId: string } };
    await page.getByTestId('goal-' + created.body.goalId).click();
    await page.waitForTimeout(2000);

    const requestIds: string[] = [];
    let attempt = 0;
    await page.route('**/api/real/work', async route => {
      attempt += 1;
      const body = route.request().postDataJSON() as { requestId: string };
      requestIds.push(body.requestId);
      if (attempt === 1) { await route.abort('failed'); return; }
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '测试注入的拒绝回执' }) });
    });

    await page.getByTestId('composer-input').fill('实现一个函数并运行测试');
    await page.getByTestId('allow-write').check();
    await page.getByTestId('submit-task').click();
    await expect(page.getByTestId('submit-error')).toContainText('结果未知', { timeout: 20_000 });
    await expect(page.getByTestId('composer-input')).toHaveValue('实现一个函数并运行测试');

    await page.getByTestId('submit-task').click();
    await expect(page.getByTestId('submit-error')).toContainText('测试注入的拒绝回执', { timeout: 20_000 });
    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).toBe(requestIds[1]);
  });
});
