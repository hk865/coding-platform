# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: independent-review.spec.ts >> independent Reviewer uses actual materials, displays admitted PASS and reopens its original report without another model run
- Location: src/ui/tests/independent-review.spec.ts:32:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('review-requirements')
Expected substring: "PASS"
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByTestId('review-requirements') with timeout 30000ms
  - waiting for getByTestId('review-requirements')

```

```yaml
- paragraph: Agent Platform 工作台
- paragraph: /tmp/verification-round-http-xfagHr/project
- paragraph: 已连接 · 本地服务
- button "切换明暗主题": ☾
- button "刷新项目状态": 刷新
- navigation "项目与目标":
  - combobox "切换项目": project
  - img
  - button "添加项目文件夹": ＋
  - button "＋ 新建目标"
  - paragraph: 项目会话
  - list:
    - listitem:
      - paragraph: Verify subject.txt through registered checks and independent review
  - separator
  - paragraph: 活跃 Agent
  - paragraph: "0"
  - paragraph: 当前没有运行中的 Agent
  - separator
  - button "设置"
  - button "动态"
- separator "调整左侧项目栏宽度"
- paragraph: Verify subject.txt through registered checks and independent review
- text: 目标：RUNNING
- paragraph: 已验证任务 1 / 2
- paragraph: 存储 SQLite · 执行 coding-agent
- paragraph: 协调与规划
- text: 计划已接纳
- paragraph: Check the actual file with tools, then independently review its semantics.
- paragraph: coding-task · executor：Inspect subject.txt and report its public result; independent tools and Reviewer must verify it.
- paragraph: 任务按依赖派发；执行报告仍需独立验收。
- paragraph: 只读协调 · completed · deepseek / verification-protocol-stub · 1 次模型请求
- article:
  - strong: 你
  - paragraph: 开发任务
  - paragraph: Inspect subject.txt and report its public result; independent tools and Reviewer must verify it.
- article:
  - strong: 执行 Agent
  - text: completed
  - paragraph: real-round-task
  - paragraph: verification-protocol-stub · 配置版本 ea1bc15b · 单次上下文 128,000 tokens
  - paragraph: Ready for independent verification.
  - group: 本次运行用量 · 1 次模型调用
  - group:
    - text: 命令检查 · 1 次 检查结束
    - paragraph: test "$(cat subject.txt)" = expected
    - paragraph: 22:12:22 · 检查结果 PASS（通过）
  - button "检查与验证"
  - button "运行日志"
- article:
  - strong: 独立 Reviewer
  - paragraph: 只读审阅
  - paragraph: Independently review the pinned task, current source, and complete tool reports. Use the read-only source and material tools. Return exactly the independent-review-result JSON schema supplied in the packet. Report every required reviewer item with citations and concrete rationale; do not infer PASS from process completion.
- article:
  - strong: 执行 Agent
  - text: completed
  - paragraph: review-b0e12f954ef6dc6eab1aab18d595101b086b0fa4-run
  - paragraph: verification-protocol-stub · 配置版本 ea1bc15b · 单次上下文 128,000 tokens
  - group: read_source subject.txt 执行中
  - group: read_source subject.txt 已结束
  - group: read_material read_material 执行中
  - group: read_material read_material 已结束
  - group: read_material read_material 执行中
  - group: read_material read_material 已结束
  - group: read_material read_material 执行中
  - group: read_material read_material 已结束
  - paragraph: "{\"schemaVersion\":1,\"kind\":\"independent-review-result\",\"reviewId\":\"review-b0e12f954ef6dc6eab1aab18d595101b086b0fa4\",\"descriptorDigest\":\"f3f6509f8ddf95b4585c9b2a1a0d8f19276280b9819baa8667561e0894804022\",\"packetDigest\":\"c9011a895975b2db4019b0484c30884e4e4665ebe3c2d89240d3f3195758d9c9\",\"sourceDigest\":\"f9359bfcce2b328e0dfc60d906a298776f6afcf7c78bc85f745f843bb2e1aa49\",\"citations\":[{\"citationId\":\"source\",\"materialId\":\"source:subject.txt\",\"digest\":\"1ea7a9b77da8c725742658e48d686d50bdaaf7f8b0289b1061adec3d249e5071\",\"location\":{\"kind\":\"source-lines\",\"path\":\"subject.txt\",\"startLine\":1,\"endLine\":1}},{\"citationId\":\"tool\",\"materialId\":\"artifact:da3d98ecfa76c084bf90cc52c158aae0e3346986ebd1bc8b021af2f9a0a3a399\",\"digest\":\"da3d98ecfa76c084bf90cc52c158aae0e3346986ebd1bc8b021af2f9a0a3a399\",\"location\":{\"kind\":\"artifact-section\",\"pointer\":\"/result\"}}],\"requirements\":[{\"obligationId\":\"file-contract\",\"requirementId\":\"semantics\",\"result\":\"PASS\",\"rationale\":\"The current subject.txt contains expected, and the original behavior check reports PASS at the same source version.\",\"citationIds\":[\"source\",\"tool\"],\"issueIds\":[],\"unknowns\":[]}],\"issues\":[]}"
  - group: 本次运行用量 · 5 次模型调用
  - button "检查与验证"
  - button "运行日志"
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
- separator "调整右侧工作台宽度"
- tablist "工作台视图":
  - tab "任务"
  - button "固定 任务": ☆
  - button "关闭 任务": ×
  - tab "文件"
  - button "固定 文件": ☆
  - button "关闭 文件": ×
  - tab "Agent"
  - button "固定 Agent": ☆
  - button "关闭 Agent": ×
  - tab "检查与验证" [selected]
  - button "固定 检查与验证": ☆
  - button "关闭 检查与验证": ×
  - button "打开视图": ＋ 视图
  - button "收起工作台": ⟩
- paragraph: 检查与验证
- paragraph: 命令检查、持久报告与独立验收结果
- paragraph: 任务验证轮次
- paragraph: 配置此任务适用的全部工具检查。每轮固定计划、来源与检查配置；工具覆盖和独立审阅分别显示。
- text: 针对任务运行
- combobox "针对任务运行": coding-task · real-round-task
- img
- paragraph: 检查 1
- button "删除检查 1": 删除
- text: 检查标识
- textbox "检查标识": check-1
- text: 类型
- combobox "类型": 行为测试
- img
- text: 检查命令
- textbox "检查命令":
  - /placeholder: 填写此项目实际使用的检查命令
- text: 项目内执行目录
- textbox "项目内执行目录": .
- text: 单次超时（秒）
- spinbutton "单次超时（秒）": "120"
- button "添加检查"
- paragraph: 以上检查仅适用于所选任务。点击后将在该工作区执行命令，并保存配置、报告和正式接纳结果。
- button "执行本轮全部检查"
- paragraph: 已保存轮次（1）
- paragraph: coding-task · 22:12:22
- paragraph: 本轮处理结束 · INCONCLUSIVE
- button "查看并核对来源"
- paragraph: 独立 Reviewer
- paragraph: 先完成此任务的全部工具检查，再由独立只读运行审阅同一份源码和原始报告。任务是否完成由正式证据与归约结果决定。
- text: 审阅所依据的工具轮次
- combobox "审阅所依据的工具轮次": coding-task · review-tools · INCONCLUSIVE
- img
- button "核对材料与审阅配置"
- button "发起独立审阅"
- paragraph: 审阅模型：deepseek / verification-protocol-stub
- paragraph: 只读权限；沿用原任务预算。模型配置或来源变化后需重新核对。
- paragraph: 工具材料已核对，待审阅要求 1 项。
- paragraph: 已保存审阅（1）
- paragraph: coding-task · 审阅处理结束
- button "查看审阅"
- paragraph: 审阅状态
- paragraph: 原报告已保存
- paragraph: 独立运行
- paragraph: review-b0e12f954ef6dc6eab1aab18d595101b086b0fa4-run
- paragraph: 当前材料资格
- paragraph: 当前有效
- paragraph: 正式证据接纳
- paragraph: 尚未接纳
- paragraph: 正式任务状态
- paragraph: blocked
- paragraph: 正式目标状态
- paragraph: BLOCKED
- button "刷新审阅状态"
- button "查看原始审阅报告"
- button "对账并继续此审阅"
- group: 查看完整审阅记录
- paragraph: 运行独立检查
- text: 针对运行
- combobox "针对运行": real-round-task · coding-task
- img
- text: 检查命令
- textbox "检查命令": python3 -m unittest discover -s tests -v
- text: 类型
- combobox "类型": 行为测试
- img
- text: 单次超时（秒）
- textbox "单次超时（秒）": "120"
- button "执行并保存报告"
- paragraph: 检查在项目沙箱内执行；单次超时只约束这一条命令。结果会保存但不直接完成任务，也不会自动完成目标。
- paragraph: 命令检查记录（1）
- table:
  - rowgroup:
    - row "记录状态 命令 类型 时间 检查结果":
      - columnheader "记录状态"
      - columnheader "命令"
      - columnheader "类型"
      - columnheader "时间"
      - columnheader "检查结果"
      - columnheader
  - rowgroup:
    - row "检查结束 test \"$(cat subject.txt)\" = expected 行为测试 22:12:22 PASS（通过） 查看报告":
      - cell "检查结束"
      - cell "test \"$(cat subject.txt)\" = expected":
        - paragraph: test "$(cat subject.txt)" = expected
      - cell "行为测试":
        - paragraph: 行为测试
      - cell "22:12:22":
        - paragraph: 22:12:22
      - cell "PASS（通过）":
        - paragraph: PASS（通过）
      - cell "查看报告":
        - button "查看报告"
- paragraph: 独立验收记录（0）
- paragraph: 尚无独立验收记录。模型完成声明不会自动变成通过。
- text: 后端未支持
- paragraph: 授权返工与重验
- paragraph: 独立审阅的阻断问题会保留。自动关联返工任务及修复后的完整重验尚未接通。
- paragraph: 缺少的依赖
- paragraph: · 问题到授权返工任务的关联
- paragraph: · 修复后来源与完整重验证据
- tablist "底部工具":
  - tab "终端" [selected]
  - tab "运行日志"
- paragraph: 已折叠 · 后台会话继续运行
- button "展开"
```

# Test source

```ts
  1  | import { expect, test, type Page } from '@playwright/test';
  2  | import { writeFile } from 'node:fs/promises';
  3  | import { join } from 'node:path';
  4  | import { independentReviewFixture } from '../../../tests/app/independent-review-fixture.js';
  5  | import type { ReviewRequestResult } from '../../contracts/reviewer-verification.js';
  6  | 
  7  | type Fixture = Awaited<ReturnType<typeof independentReviewFixture>>;
  8  | type Factory = Parameters<typeof independentReviewFixture>[1];
  9  | const cleanup: Array<() => Promise<void>> = [];
  10 | test.afterEach(async ({ page }) => {
  11 |   await page.unrouteAll({ behavior: 'wait' });
  12 |   for (const close of cleanup.splice(0).reverse()) await close();
  13 | });
  14 | async function fixture(result: 'PASS' | 'FAIL' = 'PASS') {
  15 |   const built = await import(new URL('../../../dist/app/server.js', import.meta.url).href) as { createGuiServer: Factory };
  16 |   const app = await independentReviewFixture(cleanup, built.createGuiServer, { result });
  17 |   expect((await app.round()).status).toBe(200);
  18 |   return app;
  19 | }
  20 | async function open(page: Page, app: Fixture) {
  21 |   await page.goto(app.baseUrl() + '/workbench?' + new URLSearchParams(app.scope), { waitUntil: 'domcontentloaded' });
  22 |   await expect(page.getByTestId('app')).toBeVisible();
  23 |   await page.getByTestId('tab-verification').click();
  24 |   await expect(page.getByTestId('independent-reviews')).toBeVisible();
  25 | }
  26 | async function prepare(page: Page) {
  27 |   await page.getByTestId('prepare-review').click();
  28 |   await expect(page.getByTestId('review-profile')).toContainText('verification-protocol-stub');
  29 |   await expect(page.getByTestId('start-review')).toBeEnabled();
  30 | }
  31 | 
  32 | test('independent Reviewer uses actual materials, displays admitted PASS and reopens its original report without another model run', async ({ page }) => {
  33 |   const app = await fixture();
  34 |   await open(page, app); await prepare(page);
  35 |   const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/real/verifications/reviews/start');
  36 |   await page.getByTestId('start-review').click();
  37 |   const result = await (await response).json() as ReviewRequestResult;
> 38 |   await expect(page.getByTestId('review-requirements')).toContainText('PASS', { timeout: 30000 });
     |                                                         ^ Error: expect(locator).toContainText(expected) failed
  39 |   await expect(page.getByTestId('review-detail')).toContainText('satisfied');
  40 |   expect((await app.read(result.review.requestId)).body.formal.goalPhase).not.toBe('COMPLETED');
  41 |   await page.getByTestId('review-raw-report').click();
  42 |   await expect(page.getByTestId('review-raw-body')).toContainText('independent-review-result');
  43 |   await expect(page.getByTestId('review-raw-body')).toContainText('source:subject.txt');
  44 |   const modelCalls = app.modelRequests();
  45 |   await app.restart();
  46 |   await open(page, app);
  47 |   await page.getByTestId('open-review-' + result.review.requestId).click();
  48 |   await expect(page.getByTestId('review-requirements')).toContainText('PASS');
  49 |   await page.getByTestId('review-raw-report').click();
  50 |   await expect(page.getByTestId('review-raw-body')).toContainText(result.review.reviewId);
  51 |   expect(app.modelRequests()).toBe(modelCalls);
  52 |   await writeFile(join(app.root, 'subject.txt'), 'changed after review\n');
  53 |   await page.getByTestId('review-detail').getByRole('button', { name: '刷新审阅状态', exact: true }).click();
  54 |   await expect(page.getByTestId('review-detail')).not.toContainText('当前有效');
  55 |   await page.getByTestId('review-raw-report').click();
  56 |   await expect(page.getByTestId('review-raw-body')).toContainText(result.review.reviewId);
  57 |   await expect(page.getByTestId('review-detail')).toContainText('历史原报告');
  58 |   expect(app.modelRequests()).toBe(modelCalls);
  59 | });
  60 | 
  61 | test('a committed response can be lost; reload finds the original Reviewer, keeps FAIL and shows its actual issue location', async ({ page }) => {
  62 |   const app = await fixture('FAIL');
  63 |   await open(page, app); await prepare(page);
  64 |   const path = '/api/real/verifications/reviews/start';
  65 |   const network = { submissions: 0, committed: null as ReviewRequestResult | null };
  66 |   page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === path) network.submissions++; });
  67 |   await page.route('**' + path, async route => {
  68 |     const response = await route.fetch();
  69 |     expect(response.status()).toBe(200);
  70 |     network.committed = await response.json() as ReviewRequestResult;
  71 |     await route.abort('failed');
  72 |   }, { times: 1 });
  73 |   await page.getByTestId('start-review').click();
  74 |   await expect(page.getByTestId('review-message')).toContainText('提交结果未知');
  75 |   if (!network.committed) throw Error('No real committed Reviewer response was intercepted');
  76 |   const original = network.committed.review;
  77 |   await expect(page.getByTestId('review-pending')).toContainText(original.requestId);
  78 |   await page.reload({ waitUntil: 'domcontentloaded' });
  79 |   await page.getByTestId('tab-verification').click();
  80 |   await expect(page.getByTestId('review-pending')).toContainText(original.requestId);
  81 |   await page.getByTestId('review-query-receipt').click();
  82 |   await expect(page.getByTestId('review-pending')).toHaveCount(0);
  83 |   await expect(page.getByTestId('review-requirements')).toContainText('FAIL', { timeout: 30000 });
  84 |   await page.getByTestId('review-raw-report').click();
  85 |   await expect(page.getByTestId('review-issue')).toContainText('subject.txt:1–1');
  86 |   expect((await app.read(original.requestId)).body.formal.taskPhase).not.toBe('satisfied');
  87 |   expect(network.submissions).toBe(1);
  88 |   const calls = app.modelRequests();
  89 |   await app.restart(); await open(page, app);
  90 |   await page.getByTestId('open-review-' + original.requestId).click();
  91 |   await expect(page.getByTestId('review-requirements')).toContainText('FAIL');
  92 |   expect(app.modelRequests()).toBe(calls);
  93 | });
  94 | 
```