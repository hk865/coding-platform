# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: independent-review.spec.ts >> a committed response can be lost; reload finds the original Reviewer, keeps FAIL and shows its actual issue location
- Location: src/ui/tests/independent-review.spec.ts:61:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 7
Received: 9
```

# Page snapshot

```yaml
- generic [ref=f2e3]:
  - generic [ref=f2e4]:
    - paragraph [ref=f2e5]: Agent Platform 工作台
    - paragraph [ref=f2e6]: /tmp/verification-round-http-n61Bvj/project
    - paragraph [ref=f2e7]: 已连接 · 本地服务
    - button "切换明暗主题" [ref=f2e8] [cursor=pointer]:
      - generic [ref=f2e9]: ☾
    - button "刷新项目状态" [ref=f2e11] [cursor=pointer]:
      - generic [ref=f2e12]: 刷新
  - generic [ref=f2e14]:
    - navigation "项目与目标" [ref=f2e15]:
      - generic [ref=f2e16]:
        - combobox "切换项目" [ref=f2e19] [cursor=pointer]: project
        - button "添加项目文件夹" [ref=f2e20] [cursor=pointer]:
          - generic [ref=f2e21]: ＋
      - button "＋ 新建目标" [ref=f2e24] [cursor=pointer]
      - paragraph [ref=f2e27]: 项目会话
      - list [ref=f2e29]:
        - listitem [ref=f2e30] [cursor=pointer]:
          - paragraph [ref=f2e33]: Verify subject.txt through registered checks and independent review
      - separator [ref=f2e34]
      - generic [ref=f2e35]:
        - generic [ref=f2e36]:
          - paragraph [ref=f2e37]: 活跃 Agent
          - paragraph [ref=f2e38]: "0"
        - paragraph [ref=f2e39]: 当前没有运行中的 Agent
      - separator [ref=f2e40]
      - generic [ref=f2e41]:
        - button "设置" [ref=f2e42] [cursor=pointer]
        - button "动态" [ref=f2e45] [cursor=pointer]
    - separator "调整左侧项目栏宽度" [ref=f2e48]
    - generic [ref=f2e50]:
      - generic "项目对话记录" [ref=f2e51]:
        - generic [ref=f2e52]:
          - generic [ref=f2e53]:
            - paragraph [ref=f2e54]: Verify subject.txt through registered checks and independent review
            - generic [ref=f2e55]:
              - generic [ref=f2e56]: 目标：FAILED
              - paragraph [ref=f2e58]: 已验证任务 0 / 2
              - paragraph [ref=f2e59]: 存储 SQLite · 执行 coding-agent
          - generic [ref=f2e61]:
            - generic [ref=f2e62]:
              - paragraph [ref=f2e63]: 协调与规划
              - generic [ref=f2e64]: 计划已接纳
            - paragraph [ref=f2e66]: Check the actual file with tools, then independently review its semantics.
            - paragraph [ref=f2e68]: coding-task · executor：Inspect subject.txt and report its public result; independent tools and Reviewer must verify it.
            - paragraph [ref=f2e69]: 任务按依赖派发；执行报告仍需独立验收。
            - paragraph [ref=f2e70]: 只读协调 · completed · deepseek / verification-protocol-stub · 1 次模型请求
          - generic [ref=f2e72]:
            - article [ref=f2e73]:
              - strong [ref=f2e75]: 执行反馈
              - generic [ref=f2e76]:
                - paragraph [ref=f2e77]: Investigate these exact verification failures against the accepted obligations and current source. Return adjust_plan with a specific repair instruction, or explain the blocker/necessary human decision.
                - paragraph [ref=f2e78]: 任务 coding-task · Run review-50896479590f6a4dfb27d26e489ba2917c5d901b-run · 来源 868a4ac32db63cf00b387429901cbccfa16e7856fd59cb4b4f65beab95af17d7
            - article [ref=f2e79]:
              - generic [ref=f2e80]:
                - strong [ref=f2e81]: 项目助手
                - generic [ref=f2e82]: 协调角色调查
              - generic [ref=f2e84]:
                - paragraph [ref=f2e85]: "{\"kind\":\"feedback_resolution\",\"action\":\"adjust_plan\",\"availability\":\"available\",\"summary\":\"Read current subject.txt and investigate the retained verification failure.\",\"material\":\"Inspect the current subject.txt, whose expected fixture content is expected followed by a newline. Address the reported failure while preserving all existing acceptance obligations, registered checks and independent Reviewer requirements. A tool failure remains unresolved until a current successful verification.\",\"sourcePaths\":[\"subject.txt\"]}"
                - group [ref=f2e86]:
                  - generic "7 项事实与源码来源" [ref=f2e87] [cursor=pointer]
          - generic [ref=f2e88]:
            - article [ref=f2e89]:
              - generic [ref=f2e90]:
                - strong [ref=f2e91]: 你
                - paragraph [ref=f2e92]: 开发任务
              - paragraph [ref=f2e95]: Inspect subject.txt and report its public result; independent tools and Reviewer must verify it.
            - article [ref=f2e96]:
              - generic [ref=f2e97]:
                - strong [ref=f2e98]: 执行 Agent
                - generic [ref=f2e99]: completed
                - paragraph [ref=f2e101]: real-round-task
              - generic [ref=f2e102]:
                - paragraph [ref=f2e104]: verification-protocol-stub · 配置版本 3ae070ed · 单次上下文 128,000 tokens
                - paragraph [ref=f2e107]: Ready for independent verification.
                - group [ref=f2e108]:
                  - generic "本次运行用量 · 1 次模型调用" [ref=f2e109] [cursor=pointer]
                - group [ref=f2e110]:
                  - generic "命令检查 · 1 次" [ref=f2e111] [cursor=pointer]
                  - generic [ref=f2e113]:
                    - generic [ref=f2e114]: 检查结束
                    - generic [ref=f2e116]:
                      - paragraph [ref=f2e117]: test "$(cat subject.txt)" = expected
                      - paragraph [ref=f2e118]: 21:22:23 · 检查结果 PASS（通过）
                - generic [ref=f2e119]:
                  - button "检查与验证" [ref=f2e120] [cursor=pointer]
                  - button "运行日志" [ref=f2e123] [cursor=pointer]
          - generic [ref=f2e126]:
            - article [ref=f2e127]:
              - generic [ref=f2e128]:
                - strong [ref=f2e129]: 独立 Reviewer
                - paragraph [ref=f2e130]: 只读审阅
              - paragraph [ref=f2e133]: Independently review the pinned task, current source, and complete tool reports. Use the read-only source and material tools. Return exactly the independent-review-result JSON schema supplied in the packet. Report every required reviewer item with citations and concrete rationale; do not infer PASS from process completion.
            - article [ref=f2e134]:
              - generic [ref=f2e135]:
                - strong [ref=f2e136]: 执行 Agent
                - generic [ref=f2e137]: completed
                - paragraph [ref=f2e139]: review-50896479590f6a4dfb27d26e489ba2917c5d901b-run
              - generic [ref=f2e140]:
                - paragraph [ref=f2e142]: verification-protocol-stub · 配置版本 3ae070ed · 单次上下文 128,000 tokens
                - group [ref=f2e143]:
                  - generic "read_source subject.txt 执行中" [ref=f2e144] [cursor=pointer]:
                    - generic [ref=f2e145]: read_source
                    - generic [ref=f2e146]: subject.txt
                    - generic [ref=f2e147]: 执行中
                - group [ref=f2e149]:
                  - generic "read_source subject.txt 已结束" [ref=f2e150] [cursor=pointer]:
                    - generic [ref=f2e151]: read_source
                    - generic [ref=f2e152]: subject.txt
                    - generic [ref=f2e153]: 已结束
                - group [ref=f2e155]:
                  - generic "read_material read_material 执行中" [ref=f2e156] [cursor=pointer]:
                    - generic [ref=f2e157]: read_material
                    - generic [ref=f2e158]: read_material
                    - generic [ref=f2e159]: 执行中
                - group [ref=f2e161]:
                  - generic "read_material read_material 已结束" [ref=f2e162] [cursor=pointer]:
                    - generic [ref=f2e163]: read_material
                    - generic [ref=f2e164]: read_material
                    - generic [ref=f2e165]: 已结束
                - group [ref=f2e167]:
                  - generic "read_material read_material 执行中" [ref=f2e168] [cursor=pointer]:
                    - generic [ref=f2e169]: read_material
                    - generic [ref=f2e170]: read_material
                    - generic [ref=f2e171]: 执行中
                - group [ref=f2e173]:
                  - generic "read_material read_material 已结束" [ref=f2e174] [cursor=pointer]:
                    - generic [ref=f2e175]: read_material
                    - generic [ref=f2e176]: read_material
                    - generic [ref=f2e177]: 已结束
                - group [ref=f2e179]:
                  - generic "read_material read_material 执行中" [ref=f2e180] [cursor=pointer]:
                    - generic [ref=f2e181]: read_material
                    - generic [ref=f2e182]: read_material
                    - generic [ref=f2e183]: 执行中
                - group [ref=f2e185]:
                  - generic "read_material read_material 已结束" [ref=f2e186] [cursor=pointer]:
                    - generic [ref=f2e187]: read_material
                    - generic [ref=f2e188]: read_material
                    - generic [ref=f2e189]: 已结束
                - paragraph [ref=f2e193]: "{\"schemaVersion\":1,\"kind\":\"independent-review-result\",\"reviewId\":\"review-50896479590f6a4dfb27d26e489ba2917c5d901b\",\"descriptorDigest\":\"0dd7d67c0122e93db7880a4290f00808859d9ff15e795a203a2942fec51fe6a4\",\"packetDigest\":\"3e19b949e6405e9bad242db46f9a38e145703696415f4f0c250bad1d2d77ab06\",\"sourceDigest\":\"f9359bfcce2b328e0dfc60d906a298776f6afcf7c78bc85f745f843bb2e1aa49\",\"citations\":[{\"citationId\":\"source\",\"materialId\":\"source:subject.txt\",\"digest\":\"1ea7a9b77da8c725742658e48d686d50bdaaf7f8b0289b1061adec3d249e5071\",\"location\":{\"kind\":\"source-lines\",\"path\":\"subject.txt\",\"startLine\":1,\"endLine\":1}},{\"citationId\":\"tool\",\"materialId\":\"artifact:69a7dec7126098c089dee97ee20eface3c4e43ba6d4934ab65e105cc73724abe\",\"digest\":\"69a7dec7126098c089dee97ee20eface3c4e43ba6d4934ab65e105cc73724abe\",\"location\":{\"kind\":\"artifact-section\",\"pointer\":\"/result\"}}],\"requirements\":[{\"obligationId\":\"file-contract\",\"requirementId\":\"semantics\",\"result\":\"FAIL\",\"rationale\":\"This deterministic protocol case preserves an independent reviewer finding or uncertainty against the cited current source and original tool report.\",\"citationIds\":[\"source\",\"tool\"],\"issueIds\":[\"finding\"],\"unknowns\":[]}],\"issues\":[{\"issueId\":\"finding\",\"coverage\":[{\"obligationId\":\"file-contract\",\"requirementId\":\"semantics\"}],\"description\":\"Deterministic reviewer failure for lifecycle verification.\",\"impact\":\"Blocks the required semantic requirement.\",\"citationIds\":[\"source\"]}]}"
                - group [ref=f2e194]:
                  - generic "本次运行用量 · 5 次模型调用" [ref=f2e195] [cursor=pointer]
                - generic [ref=f2e196]:
                  - button "检查与验证" [ref=f2e197] [cursor=pointer]
                  - button "运行日志" [ref=f2e200] [cursor=pointer]
      - generic [ref=f2e203]:
        - generic [ref=f2e204]:
          - generic [ref=f2e205]:
            - generic [ref=f2e206]: 独立只读提问
            - textbox "独立只读提问" [ref=f2e208]
          - button "提问" [disabled] [ref=f2e209]
        - paragraph [ref=f2e212]: 使用当前模型设置读取公开事实与源码，不中断开发运行。
      - generic [ref=f2e213]:
        - textbox "开发任务要求" [ref=f2e216]:
          - /placeholder: 描述要实现或修复的内容，以及验收条件（Ctrl/Cmd + Enter 提交）
        - generic [ref=f2e217]:
          - generic [ref=f2e218]:
            - generic [ref=f2e220]:
              - checkbox "允许在当前项目内修改文件（工具网络关闭）" [ref=f2e222]
              - generic [ref=f2e223]: 允许在当前项目内修改文件（工具网络关闭）
            - button "本次运行限额" [ref=f2e225] [cursor=pointer]
          - button "执行开发任务" [disabled] [ref=f2e229]
    - separator "调整右侧工作台宽度" [ref=f2e232]
    - generic [ref=f2e233]:
      - tablist "工作台视图" [ref=f2e234]:
        - generic [ref=f2e235]:
          - generic [ref=f2e236]:
            - tab "任务" [ref=f2e237] [cursor=pointer]
            - button "固定 任务" [ref=f2e240] [cursor=pointer]:
              - generic [ref=f2e241]: ☆
            - button "关闭 任务" [ref=f2e242] [cursor=pointer]:
              - generic [ref=f2e243]: ×
          - generic [ref=f2e244]:
            - tab "文件" [ref=f2e245] [cursor=pointer]
            - button "固定 文件" [ref=f2e248] [cursor=pointer]:
              - generic [ref=f2e249]: ☆
            - button "关闭 文件" [ref=f2e250] [cursor=pointer]:
              - generic [ref=f2e251]: ×
          - generic [ref=f2e252]:
            - tab "Agent" [ref=f2e253] [cursor=pointer]
            - button "固定 Agent" [ref=f2e256] [cursor=pointer]:
              - generic [ref=f2e257]: ☆
            - button "关闭 Agent" [ref=f2e258] [cursor=pointer]:
              - generic [ref=f2e259]: ×
          - generic [ref=f2e260]:
            - tab "检查与验证" [selected] [ref=f2e261] [cursor=pointer]
            - button "固定 检查与验证" [ref=f2e264] [cursor=pointer]:
              - generic [ref=f2e265]: ☆
            - button "关闭 检查与验证" [ref=f2e266] [cursor=pointer]:
              - generic [ref=f2e267]: ×
        - button "打开视图" [ref=f2e268] [cursor=pointer]:
          - generic [ref=f2e269]: ＋ 视图
        - button "收起工作台" [ref=f2e271] [cursor=pointer]:
          - generic [ref=f2e272]: ⟩
      - generic [ref=f2e274]:
        - generic [ref=f2e276]:
          - paragraph [ref=f2e277]: 检查与验证
          - paragraph [ref=f2e278]: 命令检查、持久报告与独立验收结果
        - generic [ref=f2e280]:
          - generic [ref=f2e281]:
            - generic [ref=f2e283]:
              - paragraph [ref=f2e284]: 任务验证轮次
              - paragraph [ref=f2e285]: 配置此任务适用的全部工具检查。每轮固定计划、来源与检查配置；工具覆盖和独立审阅分别显示。
              - generic [ref=f2e286]:
                - generic [ref=f2e287]: 针对任务运行
                - combobox "针对任务运行" [ref=f2e289] [cursor=pointer]: coding-task · real-round-task
              - generic [ref=f2e290]:
                - generic [ref=f2e292]:
                  - generic [ref=f2e293]:
                    - paragraph [ref=f2e294]: 检查 1
                    - button "删除检查 1" [ref=f2e295] [cursor=pointer]:
                      - generic [ref=f2e296]: 删除
                  - generic [ref=f2e298]:
                    - generic [ref=f2e299]:
                      - generic [ref=f2e300]: 检查标识
                      - textbox "检查标识" [ref=f2e302]: check-1
                    - generic [ref=f2e303]:
                      - generic [ref=f2e304]: 类型
                      - combobox "类型" [ref=f2e306] [cursor=pointer]: 行为测试
                  - generic [ref=f2e307]:
                    - generic [ref=f2e308]: 检查命令
                    - textbox "检查命令" [ref=f2e310]:
                      - /placeholder: 填写此项目实际使用的检查命令
                  - generic [ref=f2e311]:
                    - generic [ref=f2e312]:
                      - generic [ref=f2e313]: 项目内执行目录
                      - textbox "项目内执行目录" [ref=f2e315]: .
                    - generic [ref=f2e316]:
                      - generic [ref=f2e317]: 单次超时（秒）
                      - spinbutton "单次超时（秒）" [ref=f2e319]: "120"
                - button "添加检查" [ref=f2e320] [cursor=pointer]
              - paragraph [ref=f2e323]: 以上检查仅适用于所选任务。点击后将在该工作区执行命令，并保存配置、报告和正式接纳结果。
              - button "执行本轮全部检查" [ref=f2e324] [cursor=pointer]
            - paragraph [ref=f2e327]: 已保存轮次（1）
            - generic [ref=f2e328]:
              - generic [ref=f2e329]:
                - paragraph [ref=f2e330]: coding-task · 21:22:23
                - paragraph [ref=f2e331]: 本轮处理结束 · INCONCLUSIVE
              - button "查看并核对来源" [ref=f2e332] [cursor=pointer]
          - generic [ref=f2e336]:
            - paragraph [ref=f2e337]: 独立 Reviewer
            - paragraph [ref=f2e338]: 先完成此任务的全部工具检查，再由独立只读运行审阅同一份源码和原始报告。任务是否完成由正式证据与归约结果决定。
            - generic [ref=f2e339]:
              - generic [ref=f2e340]: 审阅所依据的工具轮次
              - combobox "审阅所依据的工具轮次" [ref=f2e342] [cursor=pointer]: coding-task · review-tools · INCONCLUSIVE
            - generic [ref=f2e343]:
              - button "核对材料与审阅配置" [ref=f2e344] [cursor=pointer]
              - button "发起独立审阅" [disabled] [ref=f2e347]
            - paragraph [ref=f2e350]: 已保存审阅（1）
            - generic [ref=f2e351]:
              - paragraph [ref=f2e352]: coding-task · 审阅处理结束
              - button "查看审阅" [ref=f2e353] [cursor=pointer]
            - generic [ref=f2e356]:
              - generic [ref=f2e357]:
                - paragraph [ref=f2e358]: 审阅状态
                - paragraph [ref=f2e359]: 审阅处理结束
              - generic [ref=f2e360]:
                - paragraph [ref=f2e361]: 独立运行
                - paragraph [ref=f2e362]: review-50896479590f6a4dfb27d26e489ba2917c5d901b-run
              - generic [ref=f2e363]:
                - paragraph [ref=f2e364]: 当前材料资格
                - paragraph [ref=f2e365]: 当前有效
              - table [ref=f2e366]:
                - rowgroup [ref=f2e367]:
                  - row [ref=f2e368]:
                    - columnheader "义务 / 要求" [ref=f2e369]
                    - columnheader "结果" [ref=f2e370]
                    - columnheader "依据摘要" [ref=f2e371]
                - rowgroup [ref=f2e372]:
                  - row [ref=f2e373]:
                    - cell "file-contract / semantics" [ref=f2e374]
                    - cell "FAIL" [ref=f2e375]
                    - cell "This deterministic protocol case preserves an independent reviewer finding or uncertainty against the cited current source and original tool report." [ref=f2e378]
              - generic [ref=f2e379]:
                - paragraph [ref=f2e380]: 正式证据接纳
                - paragraph [ref=f2e381]: 1 条证据
              - generic [ref=f2e382]:
                - paragraph [ref=f2e383]: 正式任务状态
                - paragraph [ref=f2e384]: failed
              - generic [ref=f2e385]:
                - paragraph [ref=f2e386]: 正式目标状态
                - paragraph [ref=f2e387]: FAILED
              - generic [ref=f2e388]:
                - button "刷新审阅状态" [ref=f2e389] [cursor=pointer]
                - button "查看原始审阅报告" [ref=f2e392] [cursor=pointer]
              - group [ref=f2e395]:
                - generic "查看完整审阅记录" [ref=f2e396] [cursor=pointer]
          - generic [ref=f2e397]:
            - paragraph [ref=f2e398]: 运行独立检查
            - generic [ref=f2e399]:
              - generic [ref=f2e400]:
                - generic [ref=f2e401]: 针对运行
                - combobox "针对运行" [ref=f2e403] [cursor=pointer]: real-round-task · coding-task
              - generic [ref=f2e404]:
                - generic [ref=f2e405]: 检查命令
                - textbox "检查命令" [ref=f2e407]: python3 -m unittest discover -s tests -v
              - generic [ref=f2e408]:
                - generic [ref=f2e409]:
                  - generic [ref=f2e410]: 类型
                  - combobox "类型" [ref=f2e412] [cursor=pointer]: 行为测试
                - generic [ref=f2e413]:
                  - generic [ref=f2e414]: 单次超时（秒）
                  - textbox "单次超时（秒）" [ref=f2e416]: "120"
                - button "执行并保存报告" [ref=f2e417] [cursor=pointer]
              - paragraph [ref=f2e420]: 检查在项目沙箱内执行；单次超时只约束这一条命令。结果会保存但不直接完成任务，也不会自动完成目标。
          - paragraph [ref=f2e421]: 命令检查记录（1）
          - table [ref=f2e422]:
            - rowgroup [ref=f2e423]:
              - row [ref=f2e424]:
                - columnheader "记录状态" [ref=f2e425]
                - columnheader "命令" [ref=f2e426]
                - columnheader "类型" [ref=f2e427]
                - columnheader "时间" [ref=f2e428]
                - columnheader "检查结果" [ref=f2e429]
                - columnheader [ref=f2e430]
            - rowgroup [ref=f2e431]:
              - row [ref=f2e432]:
                - cell "检查结束" [ref=f2e433]
                - cell [ref=f2e436]:
                  - paragraph [ref=f2e437]: test "$(cat subject.txt)" = expected
                - cell [ref=f2e438]:
                  - paragraph [ref=f2e439]: 行为测试
                - cell [ref=f2e440]:
                  - paragraph [ref=f2e441]: 21:22:23
                - cell [ref=f2e442]:
                  - paragraph [ref=f2e443]: PASS（通过）
                - cell [ref=f2e444]:
                  - button "查看报告" [ref=f2e445] [cursor=pointer]
          - paragraph [ref=f2e448]: 独立验收记录（0）
          - paragraph [ref=f2e449]: 尚无独立验收记录。模型完成声明不会自动变成通过。
          - generic [ref=f2e451]:
            - generic [ref=f2e452]:
              - generic [ref=f2e453]: 后端未支持
              - paragraph [ref=f2e455]: 授权返工与重验
            - paragraph [ref=f2e456]: 独立审阅的阻断问题会保留。范围内的自动返工已接通：验证留下问题 → 生成返工提案 → 在协调策略授权内自动受理成新的计划修订 → 按新修订派发返工任务；这些事实在「返工与问题」与「计划变更」两个视图中查看，本视图不重复。尚缺的是：需要人决定的越界返工没有提交入口；返工后的最新版本还没有自动重新验证与再次归约。
            - paragraph [ref=f2e457]: 缺少的依赖
            - generic [ref=f2e458]:
              - paragraph [ref=f2e459]: · 需人决定的返工提交入口
              - paragraph [ref=f2e460]: · 返工后最新版本的重新验证与再次归约
  - generic [ref=f2e462]:
    - tablist "底部工具" [ref=f2e463]:
      - tab "终端" [selected] [ref=f2e464] [cursor=pointer]
      - tab "运行日志" [ref=f2e467] [cursor=pointer]
    - paragraph [ref=f2e470]: 已折叠 · 后台会话继续运行
    - button "展开" [ref=f2e471] [cursor=pointer]
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
  38 |   await expect(page.getByTestId('review-requirements')).toContainText('PASS', { timeout: 30000 });
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
> 92 |   expect(app.modelRequests()).toBe(calls);
     |                               ^ Error: expect(received).toBe(expected) // Object.is equality
  93 | });
  94 | 
```