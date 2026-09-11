# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui-05-09-detail.spec.ts >> UI-09 重复提交与未知结果 >> 网络失败显示结果未知，重试复用同一请求标识且不重复创建
- Location: src/ui/tests/ui-05-09-detail.spec.ts:142:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('submit-error')
Expected substring: "结果未知"
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByTestId('submit-error') with timeout 20000ms
  - waiting for getByTestId('submit-error')

```

```yaml
- paragraph: Agent Platform 工作台
- paragraph: /mnt/d/1.project/Software/agent_platform/.local/architecture-rebuild-browser-20260909-chromium/fixture/alpha
- paragraph: 正在同步…
- button "切换明暗主题": ☾
- button "刷新项目状态": 刷新
- navigation "项目与目标":
  - combobox "切换项目": 主验收项目
  - img
  - button "添加项目文件夹": ＋
  - button "＋ 新建目标"
  - paragraph: 项目会话
  - list:
    - listitem:
      - paragraph: 验收核心流程：计划、运行、查询与持久化
    - listitem:
      - paragraph: Alpha 专属目标：验证作用域隔离
    - listitem:
      - paragraph: UI-03 阅读目标：验证历史消息稳定
    - listitem:
      - paragraph: UI-05 任务与 Agent 详情目标
    - listitem:
      - paragraph: UI-09 已提交但响应丢失的目标 ui0509-1788951375624dropped
    - listitem:
      - paragraph: UI-09 已提交但响应丢失的目标 ui0509-1788951375624malformed
    - listitem:
      - paragraph: UI-09 回执查询目标 ui0509-1788951375624
    - listitem:
      - paragraph: UI-09 重复提交防护目标
  - separator
  - paragraph: 活跃 Agent
  - paragraph: "0"
  - paragraph: 当前没有运行中的 Agent
  - separator
  - button "设置"
  - button "动态"
- separator "调整左侧项目栏宽度"
- paragraph: UI-09 重复提交防护目标
- text: 目标尚无正式完成判定
- paragraph: 已验证任务 0 / 0
- paragraph: 存储 SQLite · 执行 fixture
- paragraph: 协调与规划
- text: 协调已停止
- paragraph: 请先填写提供方、模型、接口地址和 API Key。
- paragraph: 只读协调 · failed · 等待模型 · 0 次模型请求
- text: 独立只读提问
- textbox "独立只读提问"
- button "提问" [disabled]
- paragraph: 使用当前模型设置读取公开事实与源码，不中断开发运行。
- textbox "开发任务要求":
  - /placeholder: 描述要实现或修复的内容，以及验收条件（Ctrl/Cmd + Enter 提交）
- checkbox "允许在当前项目内修改文件（工具网络关闭）"
- text: 允许在当前项目内修改文件（工具网络关闭）
- button "本次运行限额"
- button "执行开发任务" [disabled]
- paragraph: 提交后先分析源码并提出计划，计划接纳后按依赖执行；累计限制只在你填写时生效。
- separator "调整右侧工作台宽度"
- tablist "工作台视图":
  - tab "任务" [selected]
  - button "固定 任务": ☆
  - button "关闭 任务": ×
  - tab "文件"
  - button "固定 文件": ☆
  - button "关闭 文件": ×
  - tab "Agent"
  - button "固定 Agent": ☆
  - button "关闭 Agent": ×
  - tab "检查与验证"
  - button "固定 检查与验证": ☆
  - button "关闭 检查与验证": ×
  - button "打开视图": ＋ 视图
  - button "收起工作台": ⟩
- paragraph: 任务
- paragraph: 0 项 · 0 项已验证
- button "任务图"
- paragraph: 还没有执行计划
- paragraph: 在下方提交开发任务后，服务器会创建真实计划。若只想走通本地测试适配器，可以安装样例计划。
- button "安装样例计划（测试适配器）"
- tablist "底部工具":
  - tab "终端" [selected]
  - tab "运行日志"
- paragraph: 已折叠 · 后台会话继续运行
- button "展开"
- status:
  - paragraph: 服务器已受理开发任务：real-447f773f-40df-49ad-9984-7d892c6b5aa2
  - paragraph: 受理不等于完成，运行结果以服务器事实为准。
  - button:
    - img
```

# Test source

```ts
  62  |       requestIds.push((route.request().postDataJSON() as { requestId: string }).requestId);
  63  |       if (!dropped) {
  64  |         dropped = true;
  65  |         await route.fetch(); // Commit to the real server before damaging the reply.
  66  |         if (responseFault === 'malformed') await route.fulfill({ status: 200, contentType: 'application/json', body: '{truncated' });
  67  |         else await route.abort('failed');
  68  |         return;
  69  |       }
  70  |       await route.continue();
  71  |     });
  72  | 
  73  |     await page.getByTestId('new-goal').click();
  74  |     await page.getByTestId('goal-objective').fill(objective);
  75  |     await page.getByTestId('create-goal').click();
  76  |     await expect(page.getByTestId('goal-error')).toContainText('结果未知', { timeout: 20_000 });
  77  |     expect(requestIds).toHaveLength(1);
  78  | 
  79  |     // The goal exists on the server even though the page never saw the receipt.
  80  |     const created = await page.evaluate(async objective => {
  81  |       const meta = await (await fetch('/api/meta')).json() as { workspaceToken: string };
  82  |       const state = await (await fetch('/api/state?' + new URLSearchParams({ projectId: 'acceptance-alpha', workspaceId: 'workspace-main' }), { headers: { 'x-platform-token': meta.workspaceToken } })).json() as { goals: Array<{ status: string; goal?: { objective: string } }> };
  83  |       return state.goals.filter(goal => goal.status === 'ready' && goal.goal?.objective === objective).length;
  84  |     }, objective);
  85  |     expect(created).toBe(1);
  86  | 
  87  |     await page.getByTestId('goal-objective').fill(objective + '-changed');
  88  |     await page.getByTestId('create-goal').click();
  89  |     await expect(page.getByTestId('goal-error')).toContainText('旧请求结果仍未确定');
  90  |     expect(requestIds).toHaveLength(1); // Changed content never reaches the server.
  91  | 
  92  |     // Reload: the pending request survives, and the retry reuses its identifier.
  93  |     await page.reload({ waitUntil: 'domcontentloaded' });
  94  |     await waitForSynced(page);
  95  |     await page.getByTestId('new-goal').click();
  96  |     await expect(page.getByTestId('pending-goal')).toContainText(requestIds[0]!);
  97  |     await page.getByTestId('goal-objective').fill(objective);
  98  |     await page.getByTestId('create-goal').click();
  99  |     // Mantine keeps the modal root node after closing, so assert the dialog is gone
  100 |     // from view rather than absent from the DOM.
  101 |     await expect(page.getByTestId('goal-dialog')).toBeHidden({ timeout: 20_000 });
  102 |     expect(requestIds).toHaveLength(2);
  103 |     expect(requestIds[1]).toBe(requestIds[0]);
  104 |     expect((await page.evaluate(async objective => {
  105 |       const meta = await (await fetch('/api/meta')).json() as { workspaceToken: string };
  106 |       const state = await (await fetch('/api/state?' + new URLSearchParams({ projectId: 'acceptance-alpha', workspaceId: 'workspace-main' }), { headers: { 'x-platform-token': meta.workspaceToken } })).json() as { goals: Array<{ status: string; goal?: { objective: string } }> };
  107 |       return state.goals.filter(goal => goal.status === 'ready' && goal.goal?.objective === objective).length;
  108 |     }, objective))).toBe(1);
  109 |   });
  110 |   }
  111 | 
  112 |   test('后端已提交但响应丢失：刷新后查询回执即可确认，不重复创建', async ({ page }) => {
  113 |     await openApp(page);
  114 |     await waitForSynced(page);
  115 |     const objective = 'UI-09 回执查询目标 ' + run;
  116 |     let requestId = '';
  117 |     await page.route('**/api/goals', async route => {
  118 |       requestId = (route.request().postDataJSON() as { requestId: string }).requestId;
  119 |       await route.fetch();
  120 |       await route.abort('failed');
  121 |     });
  122 |     await page.getByTestId('new-goal').click();
  123 |     await page.getByTestId('goal-objective').fill(objective);
  124 |     await page.getByTestId('create-goal').click();
  125 |     await expect(page.getByTestId('goal-error')).toContainText('结果未知', { timeout: 20_000 });
  126 | 
  127 |     await page.reload({ waitUntil: 'domcontentloaded' });
  128 |     await waitForSynced(page);
  129 |     await page.getByTestId('new-goal').click();
  130 |     await expect(page.getByTestId('pending-goal')).toContainText(requestId);
  131 |     await page.getByTestId('query-goal-receipt').click();
  132 |     // A found receipt closes the dialog, selects the committed goal and creates nothing new.
  133 |     await expect(page.getByTestId('goal-dialog')).toBeHidden({ timeout: 20_000 });
  134 |     await expect(page.getByTestId('goal-' + requestId)).toBeVisible();
  135 |     expect((await page.evaluate(async objective => {
  136 |       const meta = await (await fetch('/api/meta')).json() as { workspaceToken: string };
  137 |       const state = await (await fetch('/api/state?' + new URLSearchParams({ projectId: 'acceptance-alpha', workspaceId: 'workspace-main' }), { headers: { 'x-platform-token': meta.workspaceToken } })).json() as { goals: Array<{ status: string; goal?: { objective: string } }> };
  138 |       return state.goals.filter(goal => goal.status === 'ready' && goal.goal?.objective === objective).length;
  139 |     }, objective))).toBe(1);
  140 |   });
  141 | 
  142 |   test('网络失败显示结果未知，重试复用同一请求标识且不重复创建', async ({ page }) => {
  143 |     await openApp(page);
  144 |     await waitForSynced(page);
  145 |     const created = await api(page, '/api/goals', { ...scope, requestId: run + '-goal-2', objective: 'UI-09 重复提交防护目标' }) as { status: number; body: { goalId: string } };
  146 |     await page.getByTestId('goal-' + created.body.goalId).click();
  147 |     await page.waitForTimeout(2000);
  148 | 
  149 |     const requestIds: string[] = [];
  150 |     let attempt = 0;
  151 |     await page.route('**/api/real/tasks', async route => {
  152 |       attempt += 1;
  153 |       const body = route.request().postDataJSON() as { requestId: string };
  154 |       requestIds.push(body.requestId);
  155 |       if (attempt === 1) { await route.abort('failed'); return; }
  156 |       await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '测试注入的拒绝回执' }) });
  157 |     });
  158 | 
  159 |     await page.getByTestId('composer-input').fill('实现一个函数并运行测试');
  160 |     await page.getByTestId('allow-write').check();
  161 |     await page.getByTestId('submit-task').click();
> 162 |     await expect(page.getByTestId('submit-error')).toContainText('结果未知', { timeout: 20_000 });
      |                                                    ^ Error: expect(locator).toContainText(expected) failed
  163 |     await expect(page.getByTestId('composer-input')).toHaveValue('实现一个函数并运行测试');
  164 | 
  165 |     await page.getByTestId('submit-task').click();
  166 |     await expect(page.getByTestId('submit-error')).toContainText('测试注入的拒绝回执', { timeout: 20_000 });
  167 |     expect(requestIds).toHaveLength(2);
  168 |     expect(requestIds[0]).toBe(requestIds[1]);
  169 |   });
  170 | });
  171 | 
```