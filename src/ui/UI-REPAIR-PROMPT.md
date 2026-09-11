# 独立 Agent 修复 Prompt：UI 交付缺陷与后端联动

以下正文可直接作为独立 Agent 的任务输入。状态依据为 2026-09-08 的源码复核；开始前再次核对当前代码，已被其他工作修复的条目直接验证，不重复覆盖。

## 委托目标

修复 React 工作台的构建发布、累计预算、检查报告展示、请求幂等与恢复缺陷，补足实际用户路径的验收。完成实现、测试和交接，不仅提交报告或静态页面。此次是有边界的 UI 修复，不接管全部平台后端开发。

## 位置、权限与协作

- 产品代码：D:\1.project\Software\agent_platform
- WSL 产品路径：/mnt/d/1.project/Software/agent_platform
- 权威文档：D:\1.project\Software\agent_learn\agent_dev\agent_platform
- 保留无关未提交修改；先检查 git status，逐个核对拟修改文件。其他 Agent 可能正在修改材料权限等后端模块，不要覆盖。
- 内置 vendor/coding-agent 有平台适配。默认不修改内核；确需修改先读其 AGENTS.md 和 INTEGRATION.md，不能用外部 coding-agent 覆盖。
- 不自行创建子 Agent、提交或推送代码、删除 /legacy 或修改用户凭据。本任务授权实现和验证，不要求 Git 提交。
- 历史 AGENTS／记录中的旧 /home/... 产品目录只可用于已确认的宿主工具链，实际源码和测试来自当前 D 盘副本。

## 当前事实

1. React＋TypeScript＋Vite＋Mantine＋TanStack Query 工作台已实现；默认入口 / 与 /workbench，旧前端 /legacy 保留。
2. 项目、目标、任务／Agent 事实视图、文件读取与引用、真实开发运行、终端、命令检查报告和模型设置已有真实后端消费者。报告展示仍有字段接线错误。
3. 真实架构图、语义角色协作、Reviewer 返工、长期记忆完整管理、平台任务续跑和真实语义查询仍未闭环。不可用视图不等于能力已完成。
4. 原 UI-12 记录有 5 次真实模型调用、6 次工具调用、PASS／FAIL／INCONCLUSIVE 检查结果和报告重开一致性，Goal 仍 not_ready；它不证明自治协作或中断续跑。
5. 独立复核：前后端类型检查及构建通过；UI 单测 9/9；浏览器首轮 14/15，UI-04 因硬编码原夹具路径而失败，按路径约定补跑 1/1；verification-imports 和 workspace-tools 两文件 11/11。未重新调用模型，也未重新跑完整后端套件。
6. 上述通过没有覆盖本次全部缺陷，不能直接复述为交付完成。

## 必须读什么

按顺序读取相关内容，不整目录加载历史：

1. 产品 AGENTS.md、README.md、src/app/README.md、src/ui/README.md，以及文档根 AGENTS.md。
2. 文档根 dev_docs/product/frontend-workbench.md、human/module-status.md 的 UI／验证／运行条目。
3. .local/ui-independent-review.md（如存在）；dev_docs/verification/2026-09-08-ui-workbench-acceptance.md（若已归档，沿入口读取）。历史成绩按原版本理解。
4. package.json、src/ui/package.json、src/ui/vite.config.ts、scripts/copy-ui.mjs、tsconfig.app.json、scripts/test-wsl.sh。
5. src/ui/src/api/{client.ts,hooks.ts,types.ts}、features/{conversation.tsx,verification.tsx}、state/、workbench/Workbench.tsx，以及实际调用到的设置／终端视图。
6. src/app/{server.ts,service.ts,verification-imports.ts,model-settings.ts}、src/runtime/model-budget.ts、src/verification/command-check-provider.ts、src/contracts/verification.ts。
7. src/ui/tests/{playwright.config.ts,fixture-server.mjs,ui-04-reference.spec.ts,ui-05-09-detail.spec.ts,ui-06-07-08.spec.ts,ui12-acceptance.mjs}、tests/ui/、tests/app/{verification-imports.test.ts,workspace-tools.test.ts,model-budget.test.ts}。
8. 涉及契约时读文档根 dev_docs/interfaces/local-gui-verification.md、human-design-status.md；涉及恢复和作用域时按需读 context-lifecycle.md、runtime-collaboration.md。

## 需要完成的修复

### A. 构建产物必须就是服务使用的产物

当前 package build 先 copy-ui，后 ui:build；Vite 写 src/app/public/workbench，服务读取 dist/app/public/workbench。新构建可能漏复制，已有目录可能服务上一版。

统一产物路径或调整构建顺序，并明确 ui:build 单独运行的语义。保留 /legacy 回退。测试必须覆盖干净输出目录与已有旧产物两种场景，不能依赖开发者额外手动复制。更新 README 与实际命令。

### B. 移除未经用户配置的累计运行预算

当前 conversation.tsx 的 DEFAULT_BUDGET 默认累计输入 200000、输出 16384、模型调用 16、工具调用 40、运行时长 120000ms，提交时总会发送，UI 也没有不限制状态。

要求：累计项默认 null／契约认可的“不限制”；用户明确配置才生效。上下文窗口与单次响应输出容量仍按模型能力约束；工具单次超时单独处理。追踪 UI → API → validateRuntimeBudget → RunSpec → 内核 limits，防止任一层把 null 转回隐含默认值。累计用量仍真实记录。若默认窗口缺乏模型能力依据，明确配置与校验，不声称所有模型支持百万窗口。

### C. 正确呈现真实检查报告

后端 checkReports 返回 {requestId,status,reports}；前端错误读取 command 和 observations。已有真实 UI 报告只显示“命令 —、状态 finished”，输出只能在原始 JSON 查找。列表还读取后端没有提供的 command／startedAt／finishedAt。

依据真实返回类型建立明确适配或共享类型，展示命令、检查分类、PASS／FAIL／INCONCLUSIVE、退出码／超时、stdout／stderr、来源摘要、工作区与计划版本。区分记录生命周期 finished 与检查通过。旧记录没有字段时准确显示缺失，不能凭空补值。

检查列表与报告详情都验收；原始 JSON 仅作为补充。切换项目／目标时清理旧详情或按作用域隔离，延迟的旧报告响应不能出现在新目标下。

### D. 幂等必须覆盖请求生命周期

useIdempotency 当前只用 useRef 保存最后一次请求：刷新丢 ID；成功后相同内容仍复用旧 ID；开发任务 fingerprint 漏 budget。

区分“同一未决请求重试”和“用户再次发起相同操作”。按作用域持久保存未决命令 ID 及完整有效载荷标识，收到正式回执后结束该逻辑请求；新执行生成新 ID。避免把密钥或无关敏感材料写进浏览器持久缓存。

结果未知时先查询实际回执／运行事实；重试使用原 ID 和原载荷。改变预算、命令或引用不能静默冒充原请求。需要增加最小后端查询／幂等接纳接口时说明依据并同步契约；不在前端推断成功或绕过控制层。

### E. 修正测试过度声明和环境依赖

- UI-09 目前首次 abort、第二次模拟 400，两次都没完成后端创建；补“后端已提交但响应被丢弃 → 页面刷新 → 查回执／重试 → 不重复创建”。
- 同一检查成功后再次执行相同命令，应有新的真实执行和独立报告；未决重试只能重放同一请求。
- UI-12 目前等待报告容器出现；补对正常展示区的命令、结果、输出与来源断言，不只断言原始 JSON。
- UI-04 的文件路径须从同一 fixture 配置取得；使用 try/finally 恢复文件，失败时也不污染后续测试。
- 验收默认启动独立服务，避免 reuseExistingServer 使用旧代码；浏览器必须服务刚构建的产物。
- 补未知回执、预算 null 传递、报告契约和跨作用域延迟响应测试。

## 修改边界

主要范围：src/ui/、package 构建脚本、相关测试与 README。可修改必要的报告投影／命令回执／预算适配，但只补本任务需要的真实接口。

不扩展架构规则、Reviewer 问题领域模型、自动返工、长期记忆或任务恢复状态机。发现相关缺项记录为依赖，不使用夹具填充。不能削弱文件权限、材料版本校验、工作区锁或证据完成守卫。

保留现有稳定阅读、三种窗口布局、引用隔离、摘要非 sticky、用量默认折叠和中栏 280px 下限。

## 如何验收

先复现缺陷再修复。使用既有工具链，Windows 与 Linux node_modules 不互相覆盖，运行前确认 bubblewrap 与浏览器可用。

| 编号 | 必须实测的行为 | 通过标准 |
| --- | --- | --- |
| R1 | 干净构建；改动后再次单次构建；启动 / 与 /workbench | 服务实际提供新构建内容与资源，资源无 404；/legacy 仍可用 |
| R2 | 默认提交与显式设置预算两种情况 | 实际 RunSpec／内核消费者保留 null 或用户值；不新增默认累计限制；用量照常报告 |
| R3 | 真实成功、失败、超时检查；打开详情；重启再读 | 普通展示区有命令、结果、输出与来源；与持久报告一致；Goal 不自动完成 |
| R4 | 后端已提交后丢响应，刷新再恢复／重试 | 同一逻辑操作不重复创建；能定位原请求；状态明确 |
| R5 | 同命令连续两次新检查，与未决请求重试分别测试 | 新执行两条记录；重试同一条；载荷改变不能污染旧请求 |
| R6 | 报告请求延迟期间切换项目／目标 | 旧报告不展示到新作用域，草稿、引用及布局隔离保留 |
| R7 | UI-01～UI-11 全部浏览器回归和相关单元／后端测试 | 同一当前产物可复跑；失败先分类，不能删断言凑通过 |
| R8 | 真实模型小任务的预算与材料消费、实际检查及重开 | 模型／工具／用量／配置版本有真实记录；无凭据则标记未验收，不用模拟替代 |

R1 在独立输出目录或隔离副本测试，删除任何目录前核对路径，避免删除未提交源码。R3／R8 使用独立小型项目，隐藏测试、标准答案、平台凭据不进入 Agent 上下文；不要直接重跑会清空现存 .local/ui12-data 的脚本而破坏原证据。

类型检查覆盖前后端，构建验证实际启动产物。至少复跑 tests/ui、相关 tests/app 以及浏览器验收。测试时限可依实际启动条件设置，不能改成产品累计预算。纯查询不额外调用模型。

## 输出与完成标准

简短报告实际修改、R1～R8 每项结果、源码／构建身份、执行命令、截图或测试记录、API／持久化证据，以及剩余限制。明确区分真实模型、真实后端和夹具。

当前完成状态统一更新 human/module-status.md 的对应条目；验收文档修正被夸大的结论，保留历史记录。文档修改需在权威文档根运行 validate-docs.mjs；该目录若不在可写范围，按工具权限流程处理，不能假装已同步。

只有本任务缺陷已修复且对应真实验收成立，才声明“UI 交付缺陷修复完成”；不能据此宣称完整多 Agent 平台完成。
