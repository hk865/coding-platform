# Agent Platform

```yaml
status: draft
updated: 2026-09-06
scope: 产品入口、文档路由与 Agent Context 规则
execution_kernel: coding-agent (separate repository)
```

Agent Platform 是建立在 `coding-agent` 执行内核之上的独立产品。它保存长期 Goal、Task、Evidence
和 Agent 状态，负责规划、调度、验证、交接与人机协作；`coding-agent` 只负责一次 Run 内的模型、
工具、安全和 Context 循环。

## 平台内置执行内核

`vendor/coding-agent/` 保存随平台交付的 coding-agent 源码。安装、构建、来源版本和当前接入边界见 [内核纳入说明](vendor/coding-agent/INTEGRATION.md)。GUI 已提供模型设置和真实连接测试；RAT-02 已接通有界真实开发任务；带来源的交互查询和自主拆分仍待后续阶段。

## 按角色进入

- **人类管理与审阅**：[human/README](../agent_learn/agent_dev/agent_platform/human/README.md)，日常关注产品、架构、MVP 验收和阶段范围。
- **Agent 执行与维护**：[Agent 维护入口](../agent_learn/agent_dev/agent_platform/dev_docs/agent/README.md)，维护契约细节、Module、Ticket/DAG、验证证据和变更同步。
- **职责规则**：[文档职责与权威关系](../agent_learn/agent_dev/agent_platform/dev_docs/document-ownership.md)，两个入口引用同一规范正文。

## 按主题查阅

建立项目或确认代码位置时，读取 [项目位置与建项入口](../agent_learn/agent_dev/agent_platform/dev_docs/agent/project-location.md)。当前目录是 D 盘产品代码副本；规范和规划位于相邻 agent_learn/agent_dev/agent_platform 文档根。

| 需求                      | 默认只读这些文档                                                      |
| ------------------------- | --------------------------------------------------------------------- |
| 理解产品                  | [PRODUCT](../agent_learn/agent_dev/agent_platform/PRODUCT.md)                                                 |
| 理解术语                  | [CONTEXT](../agent_learn/agent_dev/agent_platform/CONTEXT.md)                                                 |
| 理解 Plane、Module 和依赖 | [ARCHITECTURE](../agent_learn/agent_dev/agent_platform/ARCHITECTURE.md)                                       |
| 查看入口与信息流图        | [工作入口与系统结构图](../agent_learn/agent_dev/agent_platform/dev_docs/design/agent-entry-and-system-map.md) |
| 工作 Agent 开始执行       | [AGENTS](AGENTS.md) + 编排者分配的当前 Ticket                         |
| 追溯用户需求原文          | [用户需求原文](../agent_learn/agent_dev/agent_platform/dev_docs/product/用户需求原文.md)，仅在范围争议时读取  |
| 处理当前规划工作          | [P0 DAG](../agent_learn/agent_dev/agent_platform/dev_docs/planning/active/P0/DAG.md) + 当前 Ticket            |
| 查看候选实现顺序          | [P1 Foundation DAG](../agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/DAG.md)  |
| Context 持续、恢复与历史继承 | [Context 生命周期](../agent_learn/agent_dev/agent_platform/dev_docs/interfaces/context-lifecycle.md) |
| 跨包协作与变更汇报 | [运行时协作](../agent_learn/agent_dev/agent_platform/dev_docs/interfaces/runtime-collaboration.md)、[人类交互](../agent_learn/agent_dev/agent_platform/dev_docs/interfaces/human-design-status.md) |
| 审阅 Task→Goal 完成规则   | [Completion Policy](../agent_learn/agent_dev/agent_platform/dev_docs/interfaces/completion-policy.md)         |
| 查看历史推导              | [Archive Index](../agent_learn/agent_dev/agent_platform/dev_docs/archive/INDEX.md)，仅按需加载                |

## 双入口

- 用户从本 `README.md` 进入产品、架构、状态与审阅视图；
- 构建本产品的开发子 Agent 从 [AGENTS.md](AGENTS.md) 进入，但真正的工作起点必须是开发编排者明确分配的当前 Development Ticket；
- 产品运行后的 Worker 将从版本化 `TaskEnvelope` 进入 `WorkerRuntime.start`；[P1-03](../agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/03-fake-run-visible.md) 已有最小派发与 Fake Run 证据，完整连续性及角色协作由后续票验证。

没有 Ticket ID 的实现子 Agent 不自行选择 backlog。用户直接委托的文档维护按 Agent 维护入口执行。原始需求和归档只在对应 Context pointer 触发时加载。

## 文档层级

```text
PRODUCT / CONTEXT / ARCHITECTURE     稳定、低分辨率地图
                ↓
Module / Interface                   局部机制与契约
                ↓
DAG / Ticket                         当前施工与验收
                ↓
Artifact / Evidence / Handoff        执行产物
```

同一事实只保存在一个层级。顶层地图指向细节，不复制 Module 字段、状态转换或 Ticket 清单。

## 当前目录

```text
agent_platform/
├── README.md                  人类入口与文档路由
├── AGENTS.md                  工作 Agent 入口与 Context 路由
├── PRODUCT.md                 产品承诺与 MVP 边界
├── CONTEXT.md                 唯一领域词典
├── ARCHITECTURE.md            Plane、Module registry 与长期依赖
├── human/                    人类管理与审阅入口
└── dev_docs/
    ├── document-ownership.md 文档职责与权威关系
    ├── agent/                Agent 执行与变更同步流程
    ├── modules/               只展开到达施工前沿的 Module
    ├── interfaces/            跨 Module 的版本化契约
    ├── planning/              ROADMAP、阶段 DAG 与叶子 Ticket
    ├── decisions/             已接受且需要保留理由的决策
    ├── evaluation/            端到端发布门禁
    ├── product/               用户表达、双方对话与推导索引；按需读取
    ├── design/                导航图与候选设计复核；不作为独立真相源
    ├── verification/          文档结构检查与 P0 Evidence
    └── archive/               不进入默认 Context 的历史快照
```

## Agent Context 规则

实现 Agent 默认只加载：

```text
当前 Development Ticket
+ 涉及的 Module 文档
+ 直接跨越的 Interface
+ Ticket DAG 的一跳前驱/后继
+ 上游输出与当前 revision
```

除非当前 Ticket 明确要求，不加载完整产品文档、整张历史计划、其他 Module 的 Implementation、
完整 transcript 或归档文档。需要更多信息时沿引用按需读取。

集成 Agent 额外读取当前纵向切片的验收流程、接口兼容信息、子任务 Artifact/Evidence 与回退方法。

## 三类 DAG

- `ModuleDependencyDAG`：长期源码与 Interface 依赖；
- `DevelopmentTicketDAG`：开发工作的 blocking edges；
- `RuntimeExecutionDAG`：产品运行后管理用户 Task 的真实前置关系。

三者用途、生命周期和所有者不同，不得合并。

## 当前状态

2026-09-09：架构与源码职责重建、VR-01工具验证轮次已按各自范围验收；独立Reviewer的实现及审计缺陷修复已完成，VR-02完整全仓、浏览器、源码身份和独立审计均已通过。唯一当前状态见[模块状态](../agent_learn/agent_dev/agent_platform/human/module-status.md)，本轮入口见[Reviewer验收](../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-09-independent-review/acceptance.md)和[外部审查材料](../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-09-independent-review/external-review.md)。用户要求架构与Reviewer交其他模型审查后，再动工其余核心功能。

以下2026-09-06与RAT段落保留早期阶段的操作记录和边界，不覆盖上方当前状态。已实现能力以模块状态为准，当前容量与运行限制以工作台表单及明确保存的配置为准；阶段记录不自动授权下一票。

2026-09-06 Context 生命周期、执行记忆与编排交互方向已专项确认，正式文档、P1-16／17 及相关票已同步。P0 仍 in_review，P1 仍 proposed；已有 P1-00…06 逐票有限授权与实现记录，阶段状态不代表没有代码，也不自动授权下一票。新增行为的差距与验证归属见 [同步记录](../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-06-context-orchestration-sync.md)。

旧版 v0.3 已原样保存在
[归档快照](../agent_learn/agent_dev/agent_platform/dev_docs/archive/v0.3-2026-09-04/ARCHIVE-NOTE.md)，不进入默认 Agent Context。

## 模型设置与本机启动（RAT-01）

首次准备先安装平台依赖，再运行 `npm run kernel:install`。`pnpm build` 依次构建内置内核、后端，复制 `/legacy` 静态资源，最后由 Vite 直接把工作台写入服务实际读取的 `dist/app/public/workbench/`；单次构建即产出被服务的产物，不需要额外复制。只运行 `pnpm ui:build` 时也只更新该目录中的工作台资源（需要已有一次完整构建以生成服务端）。`pnpm verify:ui-build` 会在干净目录与已有旧产物两种情况下真实构建、启动服务并核对页面引用的资源与磁盘一致。直接运行类型检查或测试前也应先完成一次内核构建。

在已准备的 WSL 环境中，加载 `.local/toolchains/activate.sh` 后运行 `pnpm gui`，浏览器打开 `http://localhost:4317`。默认入口是 React 工作台（源码 `src/ui/`，构建产物 `dist/app/public/workbench/`）；改版前的界面保留在 `/legacy`。首次使用前端需要 `pnpm ui:install`。在左侧“设置”中配置模型：提供方必须与所选协议对应；填写模型、Base URL 和密钥，保存后可测试连接。测试最多两次模型调用，每次输出上限 256 tokens，共 30 秒超时，不执行工具，无自动重试。

密钥存放在当前用户 `~/.config/agent-platform/<数据目录绝对路径的 SHA-256 前 24 位>/settings.json`，目录 0700、文件 0600；不会保存到项目、浏览器持久化或验收文件。使用相同 `PLATFORM_GUI_DATA` 数据目录重启会读取原配置；改变数据目录使用独立配置。界面留空保留原密钥，填写新值更新，“清除密钥”使后续新连接不可使用旧密钥。切换提供方或接口地址必须重新输入密钥。

服务端 `createModelSettings().bindRun(runId)` 返回脱敏配置版本与使用该版本创建的内核客户端，供 RAT-02 接线。RAT-01 只验证此绑定入口；当前 GUI 的项目 Run/Query 仍由测试适配器执行。设置连接成功不能代表项目已切换到真实执行。

## 真实开发任务（RAT-02）

在工作台左侧添加独立项目目录，新建目标，在主对话底部填写要求、确认项目内写入范围并点击“执行开发任务”。（改版前入口在 `/legacy` 的“任务与证据 → 执行真实任务”。）模型读取、编辑和 Shell 都由内置内核执行，工具网络关闭；主对话显示真实结果、用量和活动，可取消运行。一个目标当前只执行一个有界任务，自动拆分、返工编排与交互查询尚未接通。不要将样例计划作为真实任务使用。

上下文容量与累计用量是分开的：单次上下文窗口和单次响应输出是声明容量，默认上下文 128K、单次响应输出 2,048 tokens，可按模型能力在表单调整；它们是操作者声明值，不是对提供方真实窗口的探测，也不表示所有模型支持百万级窗口。累计输入、累计输出、模型调用次数、工具调用次数和运行时长默认全部不限制（`null`）：只有用户显式填写后服务器才执行累计约束，界面、HTTP 层、RunSpec 与内核 limits 都不会把未配置的值换成隐含默认上限。命令检查的单次超时在“检查与验证”中单独设置，不属于运行累计预算。累计用量始终真实记录。调用前按请求字节数加保守开销预留输入、限制剩余输出，返回后使用提供方计量；未知消耗保留预留、不自动重试。没有可验证的提供方精确预分词，因此输入预留是保守估算，实际计量超限会阻断后续调用；美元费用硬上限尚未实现。

服务正常关闭会取消活动运行；异常中断后显示结果未知并保留写锁，须先对账已有文件，当前不支持一键接续该会话或解除未知写锁。Worker 不能读平台本身、文档与验收材料、凭据目录；首次运行会在项目下预置只读 `.platform-runtime` 工具链。独立验收通过前，模型完成不使 Task/Goal 变成已验收。

## WSL 测试入口

在当前产品根运行 `bash scripts/test-wsl.sh --setup [测试路径]`，后续运行省略 `--setup`。Linux Vitest 放在 `.local/linux-test-tools`，不改 Windows node_modules；需要 Node 24、npm 和 bubblewrap。用 `CODING_AGENT_BWRAP_PATH` 指定本机 bubblewrap；脚本先检查沙箱，失败不会启动测试。先构建内置内核。全量可使用 `bash scripts/test-wsl.sh --maxWorkers=2`，并发是测试运行设置，不是产品模型预算。

代码目录导航：[模块 README 索引](src/README.md)。修改顺序以该索引链接的 module-status 为准。
