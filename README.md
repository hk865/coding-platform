# Coding Platform

**2026-09-29 正常 UI 冷启动与双图纠偏：** 隔离新项目已从主对话目标、只读调查、候选审阅和明确采用，进入两个同 Session Work；唯一预期源码变更、三轮正式检查 PASS、GoalPhase COMPLETED。双图恢复稀疏节点/真实连线、下方独立滚动详情、按需展开及固定，未来节点保留。检查恢复不重开模型、不把已 finalized 非 PASS 当成无结果。按工作区保存显示选择及两标签页切换/刷新恢复已通过浏览器复验；取消/失败后新 Attempt 等缺口仍保留，不能宣告整个 MVP。产品模型 10 次，曾有 2 次沙箱工具失败；正常终端 Host 保留沙箱后检查通过，用户级服务已停止。 [本批证据与边界](docs/refactor/reviews/evidence/goal-cold-start-2026-09-29/README.md)。

**本机设置接线（2026-09-29）：本批集成、浏览器与常用启动器核验完成。** 左下角“设置”提供工作区与模型两类操作：空 Host 可打开第一个本机目录；选择新项目或向已有项目添加工作区，默认只读，文件写入与命令执行需显式勾选。模型支持新增、编辑和按工作区选择；API key 留空保留，输入的密钥只保存在本机私有配置，不返回 UI、不进入仓库，未另设密钥时可沿用 provider 原环境来源。新选择用于后续新运行，已开始的 Run 保持其固定配置；切换工作区保留各自草稿与 Session。设置保存不调用模型，本批未重测真实模型连接。根类型、构建与 2 文件 15 项检查通过；浏览器已验证 2 项目 3 工作区、草稿保留、模型选择隔离及重启恢复。常用 44797 已替换为正常启动器并复验，沿用原配置与数据库，没有验收调用上限或请求记录包装；本批实际模型调用为 0，未提交、未推送。操作与验收边界见[本批记录](docs/refactor/reviews/evidence/host-settings-2026-09-29/README.md)；以下较早批次的“只能预配置目录”等限制保留其当时含义，不作为本批验收结论。

**原型 UI 纠偏更新（2026-09-28）：已按原会话完成本批返修及实际浏览器核对。** 前批误将原型降格为风格参考，重组了项目导航、持续对话、辅助页和图交互；该交付口径已撤回。现恢复项目树、统一输入、项目共享辅助页、独立对话草稿、节点下方详情、双击固定/右键新页及 Task 图内连续纵向焦点。复用正式后端数据，未复制原型示例或新建业务机制；无时间 gate/未来节点仍在图上。四个前端文件及一处既有 UI 测试断言更新，类型、构建、2 文件 16 项检查通过。浏览器核对范围与限制见[纠偏记录](docs/refactor/reviews/evidence/ui-prototype-correction-2026-09-28/README.md)；本批未触发模型执行，不宣告整个 MVP 或任意规模 UI 验收完成。工作台仍为 http://127.0.0.1:44797/workbench/ ，用户级服务继续运行；未提交、未推送。

**此前 UI 后端接线验收（2026-09-28，保留原范围）：** 工作台使用真实 owner/Kernel 接口，已确认原型是界面与交互验收基线，示例数据不复制。FUGeXf 隔离 retry 工程沿原 Goal 与数据库，在 stage scope 修复后由界面点击“采用并执行”，最终正式 `complete_goal / COMPLETED`；Work、stage 与 Goal 三项 satisfied，三轮正式检查均 exit 0 / PASS，详见 [live-final](docs/refactor/reviews/evidence/mvp-ui-2026-09-28/live-final.json)。

最终验收轮 14 次模型调用（本批较早失败轮次另计，见证据），provider/transport 错误为 0；有 1 次模型猜错另一项目收件人的语义工具错误，后续已修正，不能写成零工具错误。普通读取、重开及继续 gate 未增加模型调用；此前失败保留。浏览器已核对文件保存与 CAS 冲突、命令隐藏保留/运行/取消、Git↔working tree 行级 diff、未保存选区进入真实请求并返回 marker、成员原 Session 咨询答复、双图节点/固定/新页、Task→Run→原历史，以及固定高度/调宽。[本批验收与失败记录](docs/refactor/reviews/evidence/mvp-ui-2026-09-28/README.md)。

边界：命令页无 PTY/stdin；架构初始化仍需人工审阅 JSON；Host 内存句柄不代表任意崩溃自动恢复；本次使用隔离 retry 工程，未修改三个候选真实仓库。无默认四 Agent 或 AG 专用生产流程。DSH 已停止，未提交或推送。临时工作台 [查看当前界面](http://127.0.0.1:44797/workbench/)（PID 2247899）保留运行供查看，启动本身不调用模型；这是临时地址，不承诺长期可用。

下述较早批次结论仅代表其当时的范围与证据，不替代本批终验。

独立于旧产品的五模块 Agent 工作台。2026-09-27 从原 `coding-platform/next` 提取，源码和当前文档一起保存在本仓库的 `main` 分支。[有界 MVP 审计](docs/refactor/reviews/completion-audit-2026-09-27.md)和限定真实模型路径已完成，随后按用户要求恢复 Agent 行为施工；2026-09-28 已有 AG1 发现/发送、AG6 行为装配，已沿[到达 MVP 的路线](docs/refactor/AGENT-BEHAVIOR-PLAN.md#8-到达-mvp-的路线与证据导航)接入 AG2a 显式咨询处理与正式 Answer 回复，并完成 AG2b 存活 Host 内原 Run 多轮通信、工作台接线及隔离工程真实 E2E。尚未宣告整个 MVP 完成。冻结提交的 124 文件 / 1,102 项只是当时快照，后续改动使用各批独立证据，最新状态见交接。

源码远程：[coding-platform / next-main](https://github.com/hk865/coding-platform/tree/next-main)；文档远程：[my-coding-platform-docs / next-main/docs](https://github.com/hk865/my-coding-platform-docs/tree/next-main/docs)。两个旧 main 保留原历史。

## 入口

- [恢复要求](CONTINUE.md)与[已完成的有界审计](docs/refactor/reviews/completion-audit-2026-09-27.md)；最新施工落点以交接为准，不重复全仓审计。
- [当前交接](docs/refactor/HANDOFF.md)、[实现能力](docs/refactor/IMPLEMENTED-CAPABILITIES.md)、[MVP 行为](docs/MVP-BEHAVIOR.md)。
- [到达 MVP 的路线](docs/refactor/AGENT-BEHAVIOR-PLAN.md#8-到达-mvp-的路线与证据导航)、[异步感知与控制](docs/refactor/AGENT-BEHAVIOR-PLAN.md#6-对齐注意力与异步感知)、[冷启动与再次进入](docs/refactor/AGENT-BEHAVIOR-PLAN.md#7-冷启动与再次进入项目)。
- [已认可的协作主图](docs/refactor/ORCHESTRATION-STATE-MACHINES.md#shared-mechanism-review)、[角色、全局判断与决定回流](docs/refactor/ORCHESTRATION-STATE-MACHINES.md#project-guidance-loop)、[Agent 状态与转换条件](docs/refactor/ORCHESTRATION-STATE-MACHINES.md#agent-state-transitions)；目标设计与当前实现分别标注。
- [产品](docs/PRODUCT.md)、[架构](docs/refactor/ARCHITECTURE.md)、[UI 方向](docs/UI-WORKBENCH.md)。
- [提取与独立验收](docs/refactor/reviews/evidence/standalone-2026-09-27/extraction.json)。

## 安装与验证

使用 Node.js 24（`>=24.15.0 <25`）、npm、Git；语言分析使用 Python 3。仓库包含冻结 Kernel 产物、受管补丁源码、技能资源及 Python 分析器资源包。运行依赖从两个锁文件安装，不依赖旧工程的 node_modules。

```sh
npm ci --ignore-scripts
npm ci --prefix vendor/coding-agent --omit=dev --ignore-scripts
node --run build
node --run verify:isolated
```

也可单独运行 `node --run typecheck`、`node --run check:architecture` 和 `node --run test`。`verify:isolated` 在临时物理副本检查 Kernel 补丁再生、边界、类型、构建、测试及真实 Host 启停。依赖目录不提交。

构建后，使用本机自行保存的配置启动：

```sh
node dist/app/main.js /absolute/path/to/workbench-config.json
```

配置契约见 [src/app/main.ts](src/app/main.ts) 的 `WorkbenchCliConfig`，执行配置见 [runtime-configuration.ts](src/app/runtime-configuration.ts)。启动服务本身不发模型请求；需要真实模型时另在本机配置 provider/secret。不要将凭据、实际数据库或私有工作区内容提交进仓库。

### 按需装配 Agent 行为

受信 `runtimeConfiguration.bindings[].grant.skills` 可以选择平台行为包，例如：

```json
{ "bundle": "platform", "behaviors": ["secretary", "scribe"] }
```

可选 `secretary`（用户交流、可视化/文档/提示词、项目掌控）、`adviser`（技术调查、实践取舍、架构决策辅助）、`scribe`（事实核查、历史设计文档和流程支持）、`reviewer`（按任务审查）。共同 `platform-work` 指令随平台包装入；`behaviors: []` 只装共同指令。上例是一名 Agent 的指令组合，不创建两名 Agent，也不自动授予文件、图或邮箱工具；工具仍由原 Role/Host grant 指定。普通协调先由相关成员直接沟通，需要时按范围委托局部参谋。

已有 `{ "resourceRoot": "/absolute/skills", "enabledIds": [] }` 配置继续有效，显式空列表不启用任何 Skill。平台包使用本仓库 `resources/skills`，不自动合并 vendor 目录；需要自定义资源仍用原显式形状。Work/Query 共用装配，Query 的实际工具限制和未接消费者不会因加载指令而消失。统一 UI 可逐个查看成员，不新建按职责分开的工作台。

冷启动与生命周期策略见 [Agent 行为计划](docs/refactor/AGENT-BEHAVIOR-PLAN.md#3-创建复用派生与停止条件)，职责详见[行为表](docs/refactor/AGENT-ROLE-ACTIONS.md)。规模自适应和原生压缩属于已记录的未来方向，不把配置成功当作完整编排交付。

### 启动后怎样开始工作

当前实际 CLI 仍是上面的 `node dist/app/main.js /absolute/path/to/workbench-config.json`；端口取配置或 Host 实际分配值，以启动输出的地址为准，不沿用历史截图端口。配置文件是本机明确指定的文件，没有默认搜索或自动生成的全局配置。

| 本机配置项 | 用途 |
| --- | --- |
| `sqliteDirectory`、`actor`、`workspaces` | 原平台存储、固定操作者与明确目录/scope映射；配置目录映射不等于已完成正式项目登记 |
| `kernelStores.entries` | 既有 Kernel Session 存储映射；重启保持原路径，不能通过换空库掩盖未知执行 |
| `runtime.bindings`、`runtime.queryProfiles` | 模型/职责/工具授权与可选调查配置；密钥只按 `secretEnvironmentVariable` 从本机环境读取 |
| `checks`、`workflow` | 既有检查命令与工作推进配置；缺少配置时说明不支持，不能伪造检查通过 |

首次接项目：打开统一工作台，选择已配置工作区，经现有初始化入口登记项目/Goal；按目标发起有界调查，保存真实回答和计划候选后，在授权内采用并执行。探索可以先于完整架构图；没有依据的模块或任务关系保留未知。原型中的视觉和交互方向不等于所有生产动作均已接通，余项见路线。

工作推进现在由 Host 持有：在工作台选择已有 Goal 后点击“继续执行”，原 Work Agent 可发送显式等待回复的咨询；原收件 Session 回答后，回复进入原工具结果，发信 Agent 可继续并再次咨询。刷新页面后输入原 Goal，点击“刷新执行状态”可查看相同句柄；停止推进调用正式取消与排空。普通通知仍不自动触发咨询。限定真实验收为13次 DeepSeek 请求、两轮回复、实际修改与正式 Goal COMPLETED，详见 [AG2b 证据](docs/refactor/reviews/evidence/agent-behavior-2026-09-28/ag2b/README.md)。崩溃/已结束/暂停后的自动续跑仍未完成。

再次打开应用：使用原配置、平台库和 Kernel 库读取状态与历史；普通读取不启动模型。待命成员处理一条新咨询是沿原 Session 的一次显式执行，不是重新建立整个项目。运行状态未知时先观察原记录；邮件入箱、接收方处理、暂停/取消实际生效分别显示，收到“请停止”不等于工具已停止。自动恢复、事件阈值唤醒和心跳消费者的交付状态按路线及证据判断。

## 本次保存范围

已接通的限定路径包括调查/初始规划→采用→两个 Work 复用 Session→检查→正式 Goal 完成，以及 Task→当前 Run→原 claim Session→执行窗口/完整原历史。辅助历史重复渲染已删除，完整原始记录按需展开保留。早期验证使用受控 provider；本轮已接真实 DeepSeek 完成相同 coding 路径，12 次调用、2 次真实编辑、3 次实际检查和正式 Goal COMPLETED，最终模型/工具错误均为 0。见[真实模型验收](docs/refactor/reviews/evidence/standalone-2026-09-27/e01-live-deepseek/README.md)。

完整暂停/恢复 UI、独立 Reviewer、部分协调/治理消费者、最终 UI 与旧产品切换仍需按已确认 MVP 范围审计；AG2b 只完成当前 Host 推进句柄的停止入口。A1 新批仅准备了旧 lane，未启动；其候选没有混入本提交。暂停/取消消费者骨架已留在独立 lane，尚未导入；真实模型限定验收已完成并停工，完整余项见审计，不将限定链等同产品 MVP。

## 路径与历史

原 `W/coding-platform/next/` 对应本仓库根；原 `W/docs/` 对应 `docs/`。证据、原话与历史任务书保留当时路径、哈希和状态，不批量改写成当前事实。根 [AGENTS.md](AGENTS.md) 对旧路径说明优先。旧工程、临时数据库与 DSH lane 留在原机器，未复制或退役；[原施工工具快照](docs/refactor/archive/2026-09-27-workspace-tooling/README.md)只作继续时适配依据。
