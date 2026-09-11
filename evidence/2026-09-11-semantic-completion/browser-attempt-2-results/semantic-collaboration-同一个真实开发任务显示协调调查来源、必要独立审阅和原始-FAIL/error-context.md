# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: semantic-collaboration.spec.ts >> 同一个真实开发任务显示协调调查来源、必要独立审阅和原始 FAIL
- Location: src/ui/tests/semantic-collaboration.spec.ts:5:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('执行反馈', { exact: true })
Expected: visible
Error: strict mode violation: getByText('执行反馈', { exact: true }) resolved to 2 elements:
    1) <strong>执行反馈</strong> aka getByRole('article').filter({ hasText: '执行反馈Investigate RULES.md and' }).getByRole('strong')
    2) <strong>执行反馈</strong> aka getByRole('article').filter({ hasText: '执行反馈Investigate these exact' }).getByRole('strong')

Call log:
  - Expect "toBeVisible" getByText('执行反馈', { exact: true }) with timeout 15000ms
  - waiting for getByText('执行反馈', { exact: true })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]:
    - paragraph [ref=e5]: Agent Platform 工作台
    - paragraph [ref=e6]: /tmp/semantic-collaboration-7HvHUi/source
    - paragraph [ref=e7]: 已连接 · 本地服务
    - button "切换明暗主题" [ref=e8] [cursor=pointer]:
      - generic [ref=e9]: ☾
    - button "刷新项目状态" [ref=e11] [cursor=pointer]:
      - generic [ref=e12]: 刷新
  - generic [ref=e14]:
    - navigation "项目与目标" [ref=e15]:
      - generic [ref=e16]:
        - combobox "切换项目" [ref=e19] [cursor=pointer]: 主验收项目
        - button "添加项目文件夹" [ref=e20] [cursor=pointer]:
          - generic [ref=e21]: ＋
      - button "＋ 新建目标" [ref=e24] [cursor=pointer]
      - paragraph [ref=e27]: 项目会话
      - list [ref=e29]:
        - listitem [ref=e30] [cursor=pointer]:
          - paragraph [ref=e33]: 验收核心流程：计划、运行、查询与持久化
        - listitem [ref=e34] [cursor=pointer]:
          - paragraph [ref=e37]: Implement label normalization according to RULES.md and verify edge cases.
      - separator [ref=e38]
      - generic [ref=e39]:
        - generic [ref=e40]:
          - paragraph [ref=e41]: 活跃 Agent
          - paragraph [ref=e42]: "0"
        - paragraph [ref=e43]: 当前没有运行中的 Agent
      - separator [ref=e44]
      - generic [ref=e45]:
        - button "设置" [ref=e46] [cursor=pointer]
        - button "动态" [ref=e49] [cursor=pointer]
    - separator "调整左侧项目栏宽度" [ref=e52]
    - generic [ref=e54]:
      - generic "项目对话记录" [ref=e55]:
        - generic [ref=e56]:
          - generic [ref=e57]:
            - paragraph [ref=e58]: Implement label normalization according to RULES.md and verify edge cases.
            - generic [ref=e59]:
              - generic [ref=e60]: 目标：RUNNING
              - paragraph [ref=e62]: 已验证任务 1 / 3
              - paragraph [ref=e63]: 存储 SQLite · 执行 coding-agent
          - generic [ref=e65]:
            - generic [ref=e66]:
              - paragraph [ref=e67]: 协调与规划
              - generic [ref=e68]: 计划已接纳
            - paragraph [ref=e70]: Normalize a label using the repository rule; ask the coordinator to investigate the missing edge-case rule, then verify mechanically.
            - paragraph [ref=e72]: normalize · executor：Read normalize.py. If the edge-case rule is missing, ask the coordinator to investigate it. Preserve uncertainty. Registered checks determine completion.
            - paragraph [ref=e73]: 任务按依赖派发；执行报告仍需独立验收。
            - paragraph [ref=e74]: 只读协调 · completed · deepseek / labelled-semantic-protocol-stub · 2 次模型请求
          - generic [ref=e75]:
            - generic [ref=e76]:
              - article [ref=e77]:
                - strong [ref=e79]: 执行反馈
                - generic [ref=e80]:
                  - paragraph [ref=e81]: Investigate RULES.md and supply the exact label normalization rule and its source for this work.
                  - paragraph [ref=e82]: 任务 normalize · Run real-normalize-work · 来源 de053e8b393833dce05c8d2fb6107e3e36d4697870a5a118bd94e3084ae94af6
              - article [ref=e83]:
                - generic [ref=e84]:
                  - strong [ref=e85]: 项目助手
                  - generic [ref=e86]: 协调角色调查
                - generic [ref=e88]:
                  - paragraph [ref=e89]: "{\"kind\":\"feedback_resolution\",\"action\":\"supplement\",\"availability\":\"available\",\"summary\":\"Read RULES.md; the edge cases are specified.\",\"material\":\"Label rule v1: trim both ends, lowercase ASCII letters, preserve internal spaces; empty input stays empty. Applies to normalize in this workspace.\",\"sourcePaths\":[\"RULES.md\"]}"
                  - paragraph [ref=e90]: 来源版本已变化，回答保留为历史材料。
                  - group [ref=e91]:
                    - generic "7 项事实与源码来源" [ref=e92] [cursor=pointer]
            - generic [ref=e93]:
              - article [ref=e94]:
                - strong [ref=e96]: 执行反馈
                - generic [ref=e97]:
                  - paragraph [ref=e98]: Investigate these exact verification failures against the accepted obligations and current source. Return adjust_plan with a specific repair instruction, or explain the blocker/necessary human decision.
                  - paragraph [ref=e99]: 任务 normalize · Run real-normalize-work · 来源 19b283c55837589a38dc15a59c31fef6e244d2f2f93d8159319b0edd78df340c
              - article [ref=e100]:
                - generic [ref=e101]:
                  - strong [ref=e102]: 项目助手
                  - generic [ref=e103]: 协调角色调查
                - generic [ref=e105]:
                  - paragraph [ref=e106]: "{\"kind\":\"feedback_resolution\",\"action\":\"adjust_plan\",\"availability\":\"available\",\"summary\":\"Read the failing implementation and RULES.md; retain the acceptance rule and repair its current implementation.\",\"material\":\"The current normalize.py returns its input unchanged. Repair the same normalization task by stripping both ends and translating only ASCII A-Z to a-z, preserving Ä and internal spaces. Keep the existing behavioral and independent Reviewer requirements; do not weaken acceptance.\",\"sourcePaths\":[\"normalize.py\",\"RULES.md\"]}"
                  - paragraph [ref=e107]: 来源版本已变化，回答保留为历史材料。
                  - group [ref=e108]:
                    - generic "8 项事实与源码来源" [ref=e109] [cursor=pointer]
          - generic [ref=e110]:
            - article [ref=e111]:
              - generic [ref=e112]:
                - strong [ref=e113]: 你
                - paragraph [ref=e114]: 开发任务
              - paragraph [ref=e117]: Read normalize.py. If the edge-case rule is missing, ask the coordinator to investigate it. Preserve uncertainty. Registered checks determine completion.
            - article [ref=e118]:
              - generic [ref=e119]:
                - strong [ref=e120]: 执行 Agent
                - generic [ref=e121]: completed
                - paragraph [ref=e123]: real-normalize-work
              - generic [ref=e124]:
                - paragraph [ref=e126]: labelled-semantic-protocol-stub · 配置版本 d439d24d · 单次上下文 128,000 tokens
                - group [ref=e127]:
                  - generic "读取文件 normalize.py 执行中" [ref=e128] [cursor=pointer]:
                    - generic [ref=e129]: 读取文件
                    - generic [ref=e130]: normalize.py
                    - generic [ref=e131]: 执行中
                - group [ref=e133]:
                  - generic "读取文件 normalize.py 已结束" [ref=e134] [cursor=pointer]:
                    - generic [ref=e135]: 读取文件
                    - generic [ref=e136]: normalize.py
                    - generic [ref=e137]: 已结束
                - paragraph [ref=e141]: "{\"kind\":\"execution_feedback\",\"category\":\"missing_material\",\"summary\":\"The implementation does not specify whitespace and case semantics.\",\"question\":\"Investigate RULES.md and supply the exact label normalization rule and its source for this work.\"}"
                - group [ref=e142]:
                  - generic "本次运行用量 · 2 次模型调用" [ref=e143] [cursor=pointer]
                - group [ref=e144]:
                  - generic "命令检查 · 1 次" [ref=e145] [cursor=pointer]
                  - generic [ref=e147]:
                    - generic [ref=e148]: 检查结束
                    - generic [ref=e150]:
                      - paragraph [ref=e151]: python3 -B check.py
                      - paragraph [ref=e152]: 21:24:18 · 检查结果 FAIL（失败）
                - generic [ref=e153]:
                  - button "检查与验证" [ref=e154] [cursor=pointer]
                  - button "运行日志" [ref=e157] [cursor=pointer]
          - generic [ref=e160]:
            - article [ref=e161]:
              - generic [ref=e162]:
                - strong [ref=e163]: 你
                - paragraph [ref=e164]: 开发任务
              - generic [ref=e166]:
                - paragraph [ref=e167]: "协调调查 {\"aggregateType\":\"QueryJobAnswer\",\"answerId\":\"query-answer-e52fc7b73d8e8d2f7964be46b28bf6d8ad1c61e54ef4e1dee9a3c544e2d617ff-1\",\"projectId\":\"acceptance-alpha\",\"queryJobId\":\"failure-819248ed74f440900755a24a52fc28c1\",\"workspaceId\":\"workspace-main\"} @8de5de0cbd48a7477801a6f25f1710fa4fc39b9b4702c31769c113b4a21558b2The current normalize.py returns its input unchanged. Repair the same normalization task by stripping both ends and translating only ASCII A-Z to a-z, preserving Ä and internal spaces. Keep the existing behavioral and independent Reviewer requirements; do not weaken acceptance.返工任务 rework-7f27844bb5afe3f90bcff732d0c2e068：接手任务「Normalize label」在 model-plan-cf8609cb8c902b16bc06fc71f3501e57@1 上承担的同一批义务（同一义务、同一验收语义，只换承担者）。"
                - paragraph [ref=e168]: 验收义务（逐字来自源 revision，不得改写）：
                - list [ref=e169]:
                  - listitem [ref=e170]: label-rule「Label normalization follows RULES.md」
                - paragraph [ref=e171]: · behavior（dynamic／required）：Run check.py against current implementation · semantic-review（reviewer／required）：Independently inspect the actual implementation and original tool report against the ASCII normalization rule.
                - paragraph [ref=e172]: 已提交的失败事实（逐条引用，不重新判定）：
                - list [ref=e173]:
                  - listitem [ref=e174]: 问题 rework-issue-112d501a1ffc1f5bd2f54f4bd32386e45c1afa80（来源：工具验证轮次 a675be122c6eba44a887f5ad181d1eb1b24f37a51be6d8cbce141cbdcadd6130（请求 first-check，轮次结论 FAIL，状态 completed））：未通过 1 项验收要求
                - paragraph [ref=e175]: "· label-rule/behavior（dynamic）：命令检查 label-behavior：分类 tool_check，结论 FAIL；命令「python3 -B check.py」；退出码 1；耗时 61.114574999999604ms；stderr：Traceback (most recent call last):。 检查 label-behavior；同一要求下失败的检查 label-behavior；分类 tool_check；命令 python3 -B check.py；退出码 1；是否超时 false；耗时 61.114574999999604ms；结论 FAIL；源码摘要 1cfcfd12004b66ed5134c8c3892f85b854ca3b88639bd34c26b7a94ea2473674 stderr（有界摘录）：Traceback (most recent call last): File \"/workspace/check.py\", line 2, in <module> assert normalize(' HELLO World ') == 'hello world' ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^AssertionError"
                - paragraph [ref=e176]: 原始报告：workspace-main@1（digest 27109e8103f1c0143cdf103da8c8225d6f736cdfc36034e9aab47ac118f5aab4） 事实缺口：无输入：源 revision 的义务与验收要求（上文逐字引用）、失败要求引用的原始报告（正文保存在 ArtifactVault，按权限读取）、派发信封给出的工作区与计划版本。期望产出：让上述验收要求在新 revision 上可被独立复核的候选实现与运行事实；不要改动义务正文与验收语义。检查：平台既有验证路径在该 revision 上重跑这些要求（static／dynamic 由工具轮次、reviewer 由独立审阅），旧 revision 的失败结论与报告全部保留。
            - article [ref=e177]:
              - generic [ref=e178]:
                - strong [ref=e179]: 执行 Agent
                - generic [ref=e180]: completed
                - paragraph [ref=e182]: real-normalize-work-298739d701e8
              - generic [ref=e183]:
                - paragraph [ref=e185]: labelled-semantic-protocol-stub · 配置版本 d439d24d · 单次上下文 128,000 tokens
                - group [ref=e186]:
                  - generic "读取文件 normalize.py 执行中" [ref=e187] [cursor=pointer]:
                    - generic [ref=e188]: 读取文件
                    - generic [ref=e189]: normalize.py
                    - generic [ref=e190]: 执行中
                - group [ref=e192]:
                  - generic "读取文件 normalize.py 已结束" [ref=e193] [cursor=pointer]:
                    - generic [ref=e194]: 读取文件
                    - generic [ref=e195]: normalize.py
                    - generic [ref=e196]: 已结束
                - group [ref=e198]:
                  - generic "修改文件 normalize.py 执行中" [ref=e199] [cursor=pointer]:
                    - generic [ref=e200]: 修改文件
                    - generic [ref=e201]: normalize.py
                    - generic [ref=e202]: 执行中
                - group [ref=e204]:
                  - generic "修改文件 normalize.py 已结束" [ref=e205] [cursor=pointer]:
                    - generic [ref=e206]: 修改文件
                    - generic [ref=e207]: normalize.py
                    - generic [ref=e208]: 已结束
                - paragraph [ref=e212]: Implemented the sourced rule; tool verification is still required.
                - group [ref=e213]:
                  - generic "本次运行用量 · 3 次模型调用" [ref=e214] [cursor=pointer]
                - group [ref=e215]:
                  - generic "命令检查 · 1 次" [ref=e216] [cursor=pointer]
                  - generic [ref=e218]:
                    - generic [ref=e219]: 检查结束
                    - generic [ref=e221]:
                      - paragraph [ref=e222]: python3 -B check.py
                      - paragraph [ref=e223]: 21:24:26 · 检查结果 PASS（通过）
                - generic [ref=e224]:
                  - button "检查与验证" [ref=e225] [cursor=pointer]
                  - button "运行日志" [ref=e228] [cursor=pointer]
          - generic [ref=e231]:
            - article [ref=e232]:
              - generic [ref=e233]:
                - strong [ref=e234]: 独立 Reviewer
                - paragraph [ref=e235]: 只读审阅
              - paragraph [ref=e238]: Independently review the pinned task, current source, and complete tool reports. Use the read-only source and material tools. Return exactly the independent-review-result JSON schema supplied in the packet. Report every required reviewer item with citations and concrete rationale; do not infer PASS from process completion.
            - article [ref=e239]:
              - generic [ref=e240]:
                - strong [ref=e241]: 执行 Agent
                - generic [ref=e242]: completed
                - paragraph [ref=e244]: review-9df09b6e4b867c0923e578b25aa1b927d1c63faa-run
              - generic [ref=e245]:
                - paragraph [ref=e247]: labelled-semantic-protocol-stub · 配置版本 d439d24d · 单次上下文 128,000 tokens
                - group [ref=e248]:
                  - generic "read_source normalize.py 执行中" [ref=e249] [cursor=pointer]:
                    - generic [ref=e250]: read_source
                    - generic [ref=e251]: normalize.py
                    - generic [ref=e252]: 执行中
                - group [ref=e254]:
                  - generic "read_source normalize.py 已结束" [ref=e255] [cursor=pointer]:
                    - generic [ref=e256]: read_source
                    - generic [ref=e257]: normalize.py
                    - generic [ref=e258]: 已结束
                - group [ref=e260]:
                  - generic "read_source RULES.md 执行中" [ref=e261] [cursor=pointer]:
                    - generic [ref=e262]: read_source
                    - generic [ref=e263]: RULES.md
                    - generic [ref=e264]: 执行中
                - group [ref=e266]:
                  - generic "read_source RULES.md 已结束" [ref=e267] [cursor=pointer]:
                    - generic [ref=e268]: read_source
                    - generic [ref=e269]: RULES.md
                    - generic [ref=e270]: 已结束
                - group [ref=e272]:
                  - generic "read_material read_material 执行中" [ref=e273] [cursor=pointer]:
                    - generic [ref=e274]: read_material
                    - generic [ref=e275]: read_material
                    - generic [ref=e276]: 执行中
                - group [ref=e278]:
                  - generic "read_material read_material 已结束" [ref=e279] [cursor=pointer]:
                    - generic [ref=e280]: read_material
                    - generic [ref=e281]: read_material
                    - generic [ref=e282]: 已结束
                - group [ref=e284]:
                  - generic "read_material read_material 执行中" [ref=e285] [cursor=pointer]:
                    - generic [ref=e286]: read_material
                    - generic [ref=e287]: read_material
                    - generic [ref=e288]: 执行中
                - group [ref=e290]:
                  - generic "read_material read_material 已结束" [ref=e291] [cursor=pointer]:
                    - generic [ref=e292]: read_material
                    - generic [ref=e293]: read_material
                    - generic [ref=e294]: 已结束
                - group [ref=e296]:
                  - generic "read_material read_material 执行中" [ref=e297] [cursor=pointer]:
                    - generic [ref=e298]: read_material
                    - generic [ref=e299]: read_material
                    - generic [ref=e300]: 执行中
                - group [ref=e302]:
                  - generic "read_material read_material 已结束" [ref=e303] [cursor=pointer]:
                    - generic [ref=e304]: read_material
                    - generic [ref=e305]: read_material
                    - generic [ref=e306]: 已结束
                - paragraph [ref=e310]: "{\"schemaVersion\":1,\"kind\":\"independent-review-result\",\"reviewId\":\"review-9df09b6e4b867c0923e578b25aa1b927d1c63faa\",\"descriptorDigest\":\"6af6f685b56d600508b971f00688bebf9f5034fe18493c4d89aae0f44d7de1ac\",\"packetDigest\":\"05606b24887d36b949c9e4402d9f35d44b32f659339c9a964e18dcce1dfe7c28\",\"sourceDigest\":\"68cdb6d28b5cf6fad237497b9a1cb111e0709f4d27c5fd36b970640e5551f7b3\",\"citations\":[{\"citationId\":\"implementation\",\"materialId\":\"source:normalize.py\",\"digest\":\"044735bd7971d26d7381f4fe7b47c2fefda33a0b5db25798ff5f8103fafde606\",\"location\":{\"kind\":\"source-lines\",\"path\":\"normalize.py\",\"startLine\":1,\"endLine\":2}},{\"citationId\":\"tool\",\"materialId\":\"artifact:6cfcd30134501d31c724a5e46afd3bc4590d831bd0a8c0092b599ed9dc675466\",\"digest\":\"6cfcd30134501d31c724a5e46afd3bc4590d831bd0a8c0092b599ed9dc675466\",\"location\":{\"kind\":\"artifact-section\",\"pointer\":\"/result\"}}],\"requirements\":[{\"obligationId\":\"label-rule\",\"requirementId\":\"semantic-review\",\"result\":\"PASS\",\"rationale\":\"The actual source trims ends and translates only ASCII uppercase letters; the current original behavior report covers non-ASCII preservation and empty input.\",\"citationIds\":[\"implementation\",\"tool\"],\"issueIds\":[],\"unknowns\":[]}],\"issues\":[]}"
                - group [ref=e311]:
                  - generic "本次运行用量 · 6 次模型调用" [ref=e312] [cursor=pointer]
                - generic [ref=e313]:
                  - button "检查与验证" [ref=e314] [cursor=pointer]
                  - button "运行日志" [ref=e317] [cursor=pointer]
      - generic [ref=e320]:
        - generic [ref=e321]:
          - generic [ref=e322]:
            - generic [ref=e323]: 独立只读提问
            - textbox "独立只读提问" [ref=e325]
          - button "提问" [disabled] [ref=e326]
        - paragraph [ref=e329]: 使用当前模型设置读取公开事实与源码，不中断开发运行。
      - generic [ref=e330]:
        - textbox "开发任务要求" [ref=e333]:
          - /placeholder: 描述要实现或修复的内容，以及验收条件（Ctrl/Cmd + Enter 提交）
        - generic [ref=e334]:
          - generic [ref=e335]:
            - generic [ref=e337]:
              - checkbox "允许在当前项目内修改文件（工具网络关闭）" [ref=e339]
              - generic [ref=e340]: 允许在当前项目内修改文件（工具网络关闭）
            - button "本次运行限额" [ref=e342] [cursor=pointer]
          - button "执行开发任务" [disabled] [ref=e346]
    - separator "调整右侧工作台宽度" [ref=e349]
    - generic [ref=e350]:
      - tablist "工作台视图" [ref=e351]:
        - generic [ref=e352]:
          - generic [ref=e353]:
            - tab "任务" [selected] [ref=e354] [cursor=pointer]
            - button "固定 任务" [ref=e357] [cursor=pointer]:
              - generic [ref=e358]: ☆
            - button "关闭 任务" [ref=e359] [cursor=pointer]:
              - generic [ref=e360]: ×
          - generic [ref=e361]:
            - tab "文件" [ref=e362] [cursor=pointer]
            - button "固定 文件" [ref=e365] [cursor=pointer]:
              - generic [ref=e366]: ☆
            - button "关闭 文件" [ref=e367] [cursor=pointer]:
              - generic [ref=e368]: ×
          - generic [ref=e369]:
            - tab "Agent" [ref=e370] [cursor=pointer]
            - button "固定 Agent" [ref=e373] [cursor=pointer]:
              - generic [ref=e374]: ☆
            - button "关闭 Agent" [ref=e375] [cursor=pointer]:
              - generic [ref=e376]: ×
          - generic [ref=e377]:
            - tab "检查与验证" [ref=e378] [cursor=pointer]
            - button "固定 检查与验证" [ref=e381] [cursor=pointer]:
              - generic [ref=e382]: ☆
            - button "关闭 检查与验证" [ref=e383] [cursor=pointer]:
              - generic [ref=e384]: ×
        - button "打开视图" [ref=e385] [cursor=pointer]:
          - generic [ref=e386]: ＋ 视图
        - button "收起工作台" [ref=e388] [cursor=pointer]:
          - generic [ref=e389]: ⟩
      - generic [ref=e391]:
        - generic [ref=e392]:
          - generic [ref=e393]:
            - paragraph [ref=e394]: 任务
            - paragraph [ref=e395]: 3 项 · 1 项已验证
          - button "任务图" [ref=e397] [cursor=pointer]
        - generic [ref=e400]:
          - generic [ref=e401]:
            - generic [ref=e403]:
              - generic [ref=e404]:
                - generic [ref=e405]:
                  - paragraph [ref=e406]: Normalize label
                  - generic [ref=e407]: 待处理
                - paragraph [ref=e410]: Normalize label · 运行已结束
              - generic [ref=e411]:
                - button "详情" [ref=e412] [cursor=pointer]
                - button "日志" [ref=e415] [cursor=pointer]
            - generic [ref=e419]:
              - generic [ref=e420]:
                - generic [ref=e421]:
                  - paragraph [ref=e422]: Behavior acceptance
                  - generic [ref=e423]: 待处理
                - paragraph [ref=e426]: 目标验收门禁
                - paragraph [ref=e427]: 依赖：返工：重新证明「Normalize label」承担的义务（1 项要求未通过）
              - button "详情" [ref=e429] [cursor=pointer]
            - generic [ref=e433]:
              - generic [ref=e434]:
                - generic [ref=e435]:
                  - paragraph [ref=e436]: 返工：重新证明「Normalize label」承担的义务（1 项要求未通过）
                  - generic [ref=e437]:
                    - generic [ref=e438]: 已验证
                    - generic [ref=e440]: 不一致
                - paragraph [ref=e442]: Normalize label · 运行已结束
              - generic [ref=e443]:
                - button "详情" [ref=e444] [cursor=pointer]
                - button "日志" [ref=e447] [cursor=pointer]
          - group [ref=e451]:
            - generic "计划与基线版本" [ref=e452] [cursor=pointer]
  - generic [ref=e454]:
    - tablist "底部工具" [ref=e455]:
      - tab "终端" [selected] [ref=e456] [cursor=pointer]
      - tab "运行日志" [ref=e459] [cursor=pointer]
    - paragraph [ref=e462]: 已折叠 · 后台会话继续运行
    - button "展开" [ref=e463] [cursor=pointer]
```

# Test source

```ts
  1  | import {expect,test} from '@playwright/test';
  2  | import {semanticCollaborationFixture} from '../../../tests/app/semantic-collaboration-fixture.js';
  3  | 
  4  | for(const humanChoice of [false,true]){
  5  | test(humanChoice?'真实任务通过界面选择未决产品适用范围后完成必要独立审阅':'同一个真实开发任务显示协调调查来源、必要独立审阅和原始 FAIL',async({page},testInfo)=>{
  6  |   const built=await import(new URL('../../../dist/app/server.js',import.meta.url).href) as {createGuiServer:Parameters<typeof semanticCollaborationFixture>[0]};
  7  |   await semanticCollaborationFixture(built.createGuiServer,async({base,scope,final,review})=>{
  8  |     await page.goto(base+'/workbench?'+new URLSearchParams(scope),{waitUntil:'domcontentloaded'});
  9  |     await expect(page.getByTestId('app')).toBeVisible();
> 10 |     await expect(page.getByText('执行反馈',{exact:true}).first()).toBeVisible();
     |                                                       ^ Error: expect(locator).toBeVisible() failed
  11 |     await expect(page.getByText('协调角色调查',{exact:true}).first()).toBeVisible();
  12 |     const answer=page.locator('article.message.assistant').filter({hasText:'协调角色调查'}).filter({hasText:'Label rule v1'}).first();
  13 |     await expect(answer).toContainText('Label rule v1');
  14 |     await answer.locator('summary').click();
  15 |     await expect(answer).toContainText('RULES.md');
  16 |     await page.screenshot({path:testInfo.outputPath('semantic-conversation.png'),fullPage:true});
  17 |     await page.getByTestId('tab-verification').click();
  18 |     const successor=final.liveRuns.find((r:any)=>r.spec.mode!=='review' && r.spec.taskId.startsWith('rework-'));
  19 |     await page.getByTestId('open-round-'+successor.rounds[0].requestId).click();
  20 |     await expect(page.getByTestId('round-outcome')).toHaveText('INCONCLUSIVE');
  21 |     await expect(page.getByTestId('verification-round-detail')).toContainText('已接纳');
  22 |     await page.getByTestId('open-review-'+review.requestId).click();
  23 |     await expect(page.getByTestId('review-requirements')).toContainText('semantic-review');
  24 |     await expect(page.getByTestId('review-requirements')).toContainText('PASS');
  25 |     await expect(page.getByTestId('review-detail')).toContainText('satisfied');
  26 |     await page.getByTestId('review-raw-report').click();
  27 |     await expect(page.getByTestId('review-raw-body')).toContainText('independent-review-result');
  28 |     await expect(page.getByTestId('review-raw-body')).toContainText('source:normalize.py');
  29 |     await page.screenshot({path:testInfo.outputPath('semantic-independent-review.png'),fullPage:true});
  30 |     await page.getByTestId('open-round-first-check').click();
  31 |     await expect(page.getByTestId('round-outcome')).toHaveText('FAIL');
  32 |     await page.getByTestId('round-report-label-behavior').click();
  33 |     await expect(page.getByTestId('check-report')).toContainText('AssertionError');
  34 |     await page.screenshot({path:testInfo.outputPath('semantic-original-fail.png'),fullPage:true});
  35 |   },humanChoice?{humanChoice:true,chooseHumanOption:async(base,input)=>{
  36 |     await page.goto(base+'/workbench?'+new URLSearchParams({projectId:input.projectId,workspaceId:input.workspaceId,goalId:input.goalId}),{waitUntil:'domcontentloaded'});
  37 |     const choice=page.getByTestId('feedback-choice');
  38 |     await expect(choice).toBeVisible();
  39 |     await expect(choice).toContainText('需要你的目标澄清');
  40 |     await expect(choice).toContainText('USE-CASE.md identifies ingestion as the next integration milestone');
  41 |     await expect(choice).toContainText('Retain the original failed report');
  42 |     await expect(choice).toContainText('User-facing display labels');
  43 |     await expect(choice).toContainText('Authorize the machine-facing catalog ingestion use case');
  44 |     await expect(choice).toContainText('Authorize the presentation-text use case');
  45 |     const option=choice.getByText('Catalog import identifiers（推荐）',{exact:true}).locator('..').getByRole('button',{name:'选择此项',exact:true});
  46 |     await expect(option).toBeEnabled();
  47 |     await page.screenshot({path:testInfo.outputPath('semantic-human-options.png'),fullPage:true});
  48 |     const responsePromise=page.waitForResponse(response=>response.url()===base+'/api/real/feedback/choose' && response.request().method()==='POST');
  49 |     await option.click();
  50 |     const response=await responsePromise;
  51 |     expect(response.request().postDataJSON()).toEqual(input);
  52 |     const body=await response.json();
  53 |     expect(response.status(),JSON.stringify(body)).toBe(200);
  54 |     await expect(page.getByText('关联人的决定：'+body.decisionRef.decisionId,{exact:false}).first()).toBeVisible();
  55 |     await page.screenshot({path:testInfo.outputPath('semantic-human-recorded.png'),fullPage:true});
  56 |     return {status:response.status(),body};
  57 |   }}:{});
  58 | });
  59 | }
  60 | 
```