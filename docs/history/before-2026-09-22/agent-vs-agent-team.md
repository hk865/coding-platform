# Agent 与 Agent Team：关系、模块架构、交互面与任务视图

> **状态**：设计／决策文档。本轮**只交付文档，不改代码、不做重构**。
> **日期**：2026-09-19
> **依据**：所有结论都指到本工作区的真实实现。路径锚点：
> `W` = `/home/hyh001/projects/coding-platform`（工作区根，本文档所在）·
> `C` = `W/coding-platform`（产品代码仓）·
> `D` = `W/my-coding-platform-docs/agent_platform`（文档仓）·
> `K` = `C/vendor/coding-agent`（内置执行内核副本）
> 找不到实现的地方一律标注 **「未找到实现」**，不做推测性补写。需要人决策的地方标注 **【待拍板】**。

---

> ## ⚠️ 前提更正（2026-09-19 追加）
>
> 本文档初版把 **Agent Team 当作一个泛化的产品概念**来讨论，并据此论证"本仓库不存在 Agent Team"。**那个前提是错的，本版已更正。**
>
> **更正后的前提：agent-team 不是 Agent Platform 产品线的能力，而是 dsh（DeepSeek Harness）里一个仍在测试中的功能。**
>
> - dsh = DeepSeek Harness，本地检出 `/home/hyh001/projects/deepseek-harness/deepseek-harness-master`
> - agent-team 的实现位于 `packages/experimental/` 下的 5 个包，版本均为 `0.1.6-alpha.1`，**默认不启用**
> - dsh 自己的规定：**「组外已发布产品不得依赖实验性包。」**（`packages/experimental/README.zh.md`）
>
> 因此本文档中**凡把 agent-team 当作既有能力、或把它当作本产品可依赖项的论述，均已按此更正**。
> 详细调研见同目录 `agent-team-dsh-research.md`；**因这条更正而改变或推翻的结论单列在 §15**。

## 0. 结论摘要（一屏）

| # | 主题 | 结论 | 关键依据 |
|---|---|---|---|
| 1 | Agent vs Agent Team | **Agent Platform 产品仓里没有 Agent Team 的实现**；**Agent Team 是 dsh（DeepSeek Harness）里一个仍在测试中的功能**（`packages/experimental/` 下 5 个包、`0.1.6-alpha.1`、**默认不启用**、且 dsh 规定"组外已发布产品不得依赖实验性包"）。平台不是"大号 Agent"，它是**事实与协调层**。Agent 在产品仓有两层：`AgentInstance`（连续身份）与 `AgentRun`（一次运行）。 | 产品仓 grep 命中 **0**；dsh 侧见 §1.1.1 与 `agent-team-dsh-research.md` |
| 2 | 要不要基于它做 | **要基于本产品自己的底座做，但不得依赖 agent-team**：① 以「同模块连续工作」作首个消费者，不要先造没有消费者的架构基线（违反不变量 #11）；② **agent-team 是 dsh 的实验功能，dsh 明文禁止组外已发布产品依赖实验包**。 | `D/ARCHITECTURE.md:291`；`D/dev_docs/design/2026-09-18-agent-lifecycle-session-reuse.md:70`；dsh `packages/experimental/README.zh.md` |
| 3 | 模块架构可视化 | **契约已完备（节点/边/映射/未解析/容量上限都已定义），缺的是数据源适配与渲染层**。UI 视图位已注册但当前是 `UnavailableState`。 | `C/src/contracts/architecture-source.ts:4-39`；`C/src/contracts/architecture-inspection.ts:139-185`；`C/src/ui/src/features/misc.tsx:82-86` |
| 4 | 模块 Agent 与联系 | **未找到实现**：`RoleSpec`/`Plan` 里**没有模块级绑定**（`moduleId` grep 为空）。边界只能来自 `ArchitectureSourceMapping` 显式映射。 | grep `moduleId` in `C/src/contracts/role-spec.ts`/`plan.ts` → 空；`architecture-source.ts:4-5` |
| 5 | 注意力集中两侧 | Agent 侧**已有 20+ 个按消费者分的 ContextCompiler**；人侧只有 `scope`(workspace/goal/global) 一个收拢维度，**19 个视图平铺**，收拢不足。 | `C/src/data/context-compiler/`（20 个文件）；`C/src/ui/src/state/layout.ts:41-69` |
| 6 | 交互面 | **"一个面决定所有交互"目前不成立**：「主对话」只是右侧面板的一个页签，与其余 18 个视图平级；它只读（`read-only-v1`）、单轮（`maxRounds=1`）。 | `layout.ts:42`；实测 roleBinding `query-reader/read-only-v1`、`multiTurn.maxRounds=1` |
| 7 | 计划与目标可改 | **目标可以改，但入口没接出来**：`AmendGoalRequestV1` 契约与 `HumanCollaboration.amend` 实现都在，**全仓零调用者、无 HTTP 路由、UI 不可达**；唯一可达入口是 feedback。 | `goal-change.ts:32-55`；`human-collaboration.ts:112`；`feedback-decision-compiler.ts:19`；3 个 grep 全空 |
| 8 | 秘书常驻化 | 秘书现在**只是一个 query response guide**，不是常驻 Agent；冷启动无身份可续。设计方向已在设计文档中认可（"身份持续不要求进程常驻"），**未实现**。 | `query-execution-context.ts:20`；`module-status.md:134,164`；`lifecycle-session-reuse.md:19` |
| 9 | task graph ↔ 架构图 | **契约层已设计联动**（图快照同时带 `planRef`+`baselinePin`，不变量 #12），**实现层完全脱节**：task graph 只有"工作分解"维度、没有"模块"维度，所以退化成 ToDoList。 | `architecture-inspection.ts:166-185`；`D/ARCHITECTURE.md:292`；`layout.ts:47,53`；`misc.tsx:82-86` |
| 10 | 测试功能承载 | 人在**右侧「检查与验证」面板**输入文字（检查命令、必读文件、超时），不在主对话。**这确实背离"一个面决定所有交互"**——但该原则本来也未成立。 | `layout.ts:49`；`C/src/ui/src/features/verification.tsx:129-134`；`verification-check-editor.tsx:33-44` |
| 11 | 上手难度 | 有 **8 个具体卡点**，其中 4 个是"界面看着能用、实际点了没用"。 | 见 §11 |

**一句话总结**：这个产品的**底座（账本、唯一写者、版本化角色、治理 install/activate、只读探索流水线）是真材实料且已被实测跑通**；断的地方几乎全在**"契约有了但入口没接"**和**"两个视图各说各话"**。因此本轮的方向不应是"再造一个更大的 Agent"，而是**把已有的契约接到面上、把两张图接起来**。

---

## 1. Agent 和 Agent Team 的区别

### 1.1 结论

**在 Agent Platform 产品仓里不存在 "Agent Team" 的实现；但 Agent Team 本身是存在的——它是 dsh（DeepSeek Harness）里一个仍在测试中的功能。**

复核方法（产品仓）：在 `C/src`、`C/tests`、`D` 下 grep `Agent Team` / `agent team` / `agent-team` / `AgentTeam` → **命中 0**。
**注意：这个 0 只能说明"本产品没有实现它"，不能说明"它不存在"。** 初版把两者混为一谈，是本轮更正的核心。dsh 侧的实际情况见 §1.1.1。

**平台不是"大号 Agent"。** 领域词典在定义 `Agent Platform` 时就写了明确禁令：

> `D/CONTEXT.md:13-15`
> **Agent Platform**：保存长期工作事实，并协调用户、多个 Agent 与执行内核的产品。
> _Avoid_: Secretary Agent、超级 Agent、M7

**"大号的 Agent Team"也不成立。** 三个决定性差别：

1. **没有共享对话上下文**。每个 Run 拿到的是有界的 `TaskEnvelope`／`ContextBundle`，不继承完整 transcript（`D/dev_docs/modules/execution/worker-runtime.md:50` 记 `maxEnvelopeBytes=64KiB`；`C/src/execution/worker-runtime/coding-agent-runtime.ts:128` 的 `capabilities()` 同时声明 `replayable:false, supportsSnapshot:false`）。
2. **状态不由 Agent 持有**。`D/CONTEXT.md:173-174`：**TodoView** 是 "Runtime Task 状态的 ReadModel，**不拥有独立状态**"；`D/ARCHITECTURE.md:284` 不变量 #4：UI、Todo、Plan Matrix、Timeline 都是 ReadModel，不接受直接状态写入。
3. **角色不是"团队成员"，是版本化规格 + 绑定**。`RoleSpecRevision` 是五种治理种类之一，走 install/activate 与 CAS，revision **持久且不可变**（`D/ARCHITECTURE.md:291` 不变量 #11）。

一句话：**dsh 的 Agent Team 是"一个会话里的 Lead + 具名 teammate，靠持久消息与共享任务板协作"；Agent Platform 是"唯一状态写入者 + 持久账本 + 版本化角色绑定"。** 两者不是同一个东西，量级也不同——前者是**编码会话内的团队编排**，后者是**跨 Run 的事实与协调层**。

### 1.1.1 Agent Team 在 dsh 里的实际位置与状态（本次更正的事实基准）

| 项 | 事实 | 依据 |
|---|---|---|
| 归属 | dsh（DeepSeek Harness），**不是** Agent Platform 产品线 | 用户 2026-09-19 澄清；检出 `/home/hyh001/projects/deepseek-harness/deepseek-harness-master` |
| 位置 | `packages/experimental/` 下 5 个包 | `agent-team`、`agent-team-profile`、`agent-team-web-profile`、`tool-agent-team`、`client-ui-agent-team` |
| 版本 | 全部 `0.1.6-alpha.1` | 各包 `package.json` |
| 命名 | 全部以 `@deepseek-ai/dsh-experimental-*` 发布 | `packages/experimental/README.zh.md` |
| 默认状态 | **默认不启用** | `agent-team-profile/README.zh.md`：「本包公开发布，但随附 CLI、Web、SDK、ACP 与 Python profile 都不会启用它」 |
| 启用方式 | 必须显式 `dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-agent-team-profile` | 同上「使用本包」 |
| **依赖禁令** | **「组外已发布产品不得依赖实验性包。」** | `packages/experimental/README.zh.md` 概述 |
| 稳定承诺 | 「实验组包含约定可能变更且**不提供支持承诺**的原型能力」 | 同上 |
| 它是什么 | "把一个编码会话变成一个小型工作团队：会话中的 agent 成为 **Lead**，创建**具名 teammate** 处理委派的工作，与它们交换**持久消息**，并在**公共任务板**上跟踪共享任务" | `agent-team/README.zh.md` 概述 |
| 核心限制 | 实验原型无稳定性承诺 · **单进程共享 checkout**（无 worktree／文件锁）· write scope **仅作提示**（Bash／formatter 可绕过）· roster **扁平不可变**（不支持嵌套／重命名／删除）· **owner 不会自动释放** · **mailbox 不保证跨进程 exactly-once** | `agent-team/README.zh.md`「已知限制与延期工作」 |
| 与既有 subagent 的关系 | profile patch 会"插入 Team domain 与 Team-scoped 工具，并**禁用普通 subagent 委派**和名称重叠的全局 continuable-child control。**Workflow 仍可创建 fresh 子代理**" | `agent-team-profile/README.zh.md` 概述 |

**对本文档最直接的影响**：§2 的"要不要基于它来做"，从"要不要采用一种协作模型"变成了**"要不要依赖另一个项目的实验包"**——而 dsh 自己已经用一条明文规定回答了这个问题（**不得依赖**）。

### 1.2 "Agent" 在本仓库对应哪些代码

必须把两层分开，混用是当前很多困惑的根源：

| 层 | 定义 | 代码位置 |
|---|---|---|
| `AgentInstance` | 具有能力描述和**连续身份**的逻辑执行者（`D/CONTEXT.md:51-52`） | 由 `RoleSpec`（角色规格）+ 绑定事实表达；**没有独立的 Agent 实例表/进程** |
| `AgentRun` | `AgentInstance` 的**一次实际运行**（`D/CONTEXT.md:54-55`） | `C/src/execution/worker-runtime/coding-agent-runtime.ts`，落在 `liveRuns`／`real-runs/` |
| 角色分工 | 两类角色，职责不同 | `D/CONTEXT.md:164-168` |
| 规格与绑定 | 版本化、可审计 | `C/src/contracts/role-spec.ts`；治理入口 `C/src/app/service.ts:574-579` |

**两类角色**（`D/CONTEXT.md:164-168`，原文）：

- **Coordination Role**：「对目标澄清、任务分工、耦合与测试设计、结果集成和返工承担语义协调责任的角色；**秘书／参谋是其面向人的决策支持视角，书记是事实整理与汇报视角**；规划／集成者组织执行及跨工作包协调。」
- **Execution Role**：「在已分配任务和权限内产生实现、观察及验证材料的角色；**角色身份不同于某一次 Run 或读写能力**。」

**实测确认**（2026-09-19，对 `slam6_navigation (test)` 项目）：添加项目时自动 bootstrap 安装了 **8 个 RoleSpec** 并逐一激活：`advisor`、`executor`、`independent-reviewer`、`integrator`、`investigator`、`planner`、`recorder`、`secretary`（账本事件 `RoleSpecInstalled`/`RoleSpecActivated` 各 8 条）。

**Module Registry**：12 个 Module、4 个 Plane（`D/ARCHITECTURE.md:171-185`）——Human Interaction / Control / Execution / Data。

### 1.3 唯一真实写入权在 Control

`D/ARCHITECTURE.md:281-283` 不变量 #1–#3：

1. Planner 只提出 Proposal/Patch；**ControlEngine 才能接受并推进长期状态**。
2. Worker 和 Reviewer 只提交事实、Claim 或 Verdict，**不能直接完成 Task**。
3. ControlEngine 从版本校验后的 transition 生成 snapshot/Event；StateLedger 只原子提交两者。

这解释了为什么本仓库**不可能**是 "Agent Team"：它的设计前提就是**没有**一个 Agent 能自行改变长期状态。

---

## 2. 要不要基于它来做

### 2.1 建议

> **建议：基于它做，但落点必须是"同模块连续工作"，不是"先建架构图"。**

### 2.2 判断依据

**它能带来什么（已被实测证实）**

| 能力 | 实测证据 |
|---|---|
| 只读探索流水线可跑通 | 2026-09-19 对 `slam6_navigation (test)` 跑通 5 任务 + 门禁：64 次模型调用、200 次工具调用、实读 101 个文件，目标 `COMPLETED`，全程零改动仓库 |
| 任务级依赖与人工复核有效 | `slam6-explore-6` 6 个节点全部 `satisfied`，每个节点一份报告 + 一次操作者 PASS 复核 |
| 治理 install/activate 可用 | 项目 bootstrap 自动安装并激活 CompletionPolicy、ArchitectureBaseline、8 个 RoleSpec |
| 证据链可查 | `/api/real/plan-changes/view` 一次取回提案／决定／Goal revision／任务处置行 |

**代价与冲突（必须承认）**

| 冲突 | 证据 | 后果 |
|---|---|---|
| **agent-team 是 dsh 的实验功能** | dsh `packages/experimental/README.zh.md`：「**组外已发布产品不得依赖实验性包。**」；`agent-team-profile/README.zh.md`：默认不启用，需显式 `dsh plugin add` | **Agent Platform 不得依赖 agent-team**——这不是取舍问题，是 dsh 的明文禁令（见 §15） |
| **不变量 #11 禁止"先建没有消费者的治理种类"** | `D/ARCHITECTURE.md:291`：五种治理种类"**只在存在首个消费者的切片中**"建立；"不存在内置默认值" | **不能**为了让架构图好看而先装一份没人消费的基线 |
| ArchitectureReconciler 契约状态 = **planned** | `D/ARCHITECTURE.md:180` | 架构对账没有产品入口 |
| 代码图端口只做 TS/JS | `C/src/app/service.ts:209-211` 的 `capabilityNote: 'TS/JS semantic imports with explicit source mapping'` | 对 C++/Python 仓库（如 slam6）**必然 unsupported** |
| 三类图不得互为真相源 | `D/ARCHITECTURE.md:285` 不变量 #5 | 联动是"互映"而不是"合并成一张图" |
| 失败任务在同一目标内不可重试 | 任务派发租约不释放，`C/src/control/control-engine/policies/task-eligibility.ts:100-107` | 一轮 provider 抖动 = 整份计划作废，只能换目标重跑 |

### 2.3 落点建议

选 **"同模块连续工作"** 作为首个消费者，理由是这与已经认可的设计方向一致，且不触发上面任何一条冲突：

> `D/dev_docs/design/2026-09-18-agent-lifecycle-session-reuse.md:70`
> 「先建立现有规范—真实实现—用户可见能力对照，识别已实现、接线缺口、测试缺口与待决定策略；**再选择同模块连续工作作为最小消费者**。」

**【待拍板】** 三条路线，请择一：

| 选项 | 内容 | 代价 | 风险 |
|---|---|---|---|
| A（建议） | 同模块连续工作 + 把 `amend` 接到交互面（§7） | 中 | 低：复用现有 RoleSpec/RoleBinding，不新增 Module |
| B | 先做架构图可视化（§3），再谈模块 Agent | 中高 | 违反 #11（无消费者）；C++ 仓库直接 unsupported |
| C | 先做 task graph ↔ 架构图联动（§9） | 高 | 依赖 B 的数据源，等于把 B 的阻塞点提前 |

---

## 3. 支持探索的模块架构与可视化

### 3.1 图怎么表示：契约已经完备，直接可用

**节点** `CodeGraphNode`（`C/src/contracts/architecture-inspection.ts:139-148`）：

| 字段 | 含义 |
|---|---|
| `nodeId` | 稳定标识 |
| `kind` | `module` \| `interface` \| `type` \| `function` \| `file` |
| `name` | 展示名 |
| `path` | 源码路径（校验：非空、不以 `/` 开头、无 `\\`/`:`/`\0`、无 `.`/`..` 段） |
| `structuralKey` | **差分用的确定性身份**（不可重复） |
| `contentDigest` | 节点归一化内容的 sha256（变更检测） |

**边** `CodeGraphEdge`（`:150-156`）：

| 字段 | 含义 |
|---|---|
| `edgeId` / `structuralKey` | 身份 |
| `fromNode` / `toNode` | 端点（校验：**不允许悬空边**） |
| `kind` | `module_dependency` \| `interface_uses` \| `type_references` \| `calls` |

**模块 ↔ 路径的映射必须显式**（`C/src/contracts/architecture-source.ts:4-5`）：

> `ArchitectureSourceMapping = { id, kind: 'module' | 'interface', paths: string[] }`
> 原文注释：**"Explicit, versioned mapping; a directory name is not implicitly a product Module."**

这一句是**主题 4 的边界依据**：目录名不自动等于模块，模块边界只能由显式映射声明。

**未解析关系必须保留**（`:19-20`）：

> `unresolved: string[]` —— 原文注释：**"Unknown imports/unmapped sources are evidence gaps, never absent dependencies."**

**硬容量上限**（`architectureSourceIssues`，`:31-38`）：`mappings ≤ 512`、`nodes ≤ 512`、`edges ≤ 1024`、`unresolved ≤ 2048`、**总 JSON ≤ 240 KiB**。
→ **这是可视化设计最硬的约束**：不可能整仓铺开，必须做聚合/分层。

**快照绑定**（`architecture-inspection.ts:166-185`）：`CodeGraphSnapshotV1` 同时携带 `planRef`、`baselinePin`、`gitRef`、`nodes`、`edges`、`indexCapabilities`、可选 `sourceSnapshot`。其中 `baselinePin` 的注释是：

> **"The ONLY admissible baseline input: the plan pin (invariant #12)."**

**变更表达**（`:193-205`）`ArchitectureDeltaChange = { changeId, level: node|edge, kind: added|removed|modified|moved, structuralKey, beforeDigest, afterDigest, label }`，`label` 注释明确 **"mechanical, no verdict"**。

**索引能力必须显示**（`:158-164`）`CodeGraphIndexCapabilities = { hasCodeGraph, degradesToText, graphRevision }`；`degradesToText` 注释：**"Text/source search fallback available (coverage-limited)"**。

### 3.2 在哪个界面呈现

- 视图位**已注册**：`C/src/ui/src/workbench/registry.ts:37` 的 `architecture: ArchitectureView`
- 布局定义：`C/src/ui/src/state/layout.ts:53` —— `{ title: '架构', placement: 'right', scope: 'goal', singleton: true }`
- 当前实现是**不可用态**（`C/src/ui/src/features/misc.tsx:82-86`，原文）：

> **真实架构图** —— 真实应用的 WorkspaceReader 图读取返回 unsupported：没有正式架构快照绑定，也没有图基线来源映射。
> 依赖：① WorkspaceReader 架构快照契约与 Adapter　② 基线到源码快照的映射　③ 关系违规规则

它同时已经能显示"已有事实"（`:89-97`）：计划 / 计划版本 / **架构基线（`pinnedArchitectureBaseline`）** / 完成策略，并附一句"以上为计划固定的基线版本；**它不代表已生成架构图**"。

### 3.3 设计：用户怎么在这张图上看出模块关系

以下为**设计提案**（实现不存在）：

**① 视觉编码（用已定的 kind 直接映射，不新增语义）**

| 图元素 | 来源字段 | 呈现 |
|---|---|---|
| 节点形状 | `CodeGraphNode.kind` | `module`=圆角矩形 · `interface`=菱形 · `type`/`function`/`file`=小圆点（仅在展开时出现） |
| 节点描边 | `contentDigest` 变化 | 本轮 delta 里 `modified` 的节点加高亮描边 |
| 边线型 | `CodeGraphEdge.kind` | `module_dependency`=实线 · `interface_uses`=虚线 · `type_references`/`calls`=点线（默认折叠） |
| 边方向 | `fromNode → toNode` | 箭头；`module_dependency` 反向即"被依赖" |
| 独立图例 | `unresolved[]` | **单独的"未知"图例区**，绝不画成实边 |

**② 容量策略（对 240 KiB / 512 节点硬上限）**
- 默认只画 `kind === 'module'` 的节点（12 个 Module 量级，一屏可读）；
- 选中某模块才展开它的 `interface` 与相邻边（"邻域展开"，不是全图）；
- 按 `Plane` 分组布局（Human Interaction / Control / Execution / Data），与 `D/ARCHITECTURE.md:79-84` 一致。

**③ 必须同时显示的"可信度脚注"**
- `indexCapabilities.hasCodeGraph`（是否真图，还是 `degradesToText` 回退）
- `graphRevision` 与当前 workspace revision 是否一致（stale 提示）
- `unresolved` 条数
- `gitRef`（commitHash/treeDigest）或 null

理由：探索实践中已证明这个仓库**会**产出"看着完整其实有缺口"的报告——见 §3.4。

### 3.4 现有功能的实际用法与可疑之处

**实际用法**：今天要"看架构"，唯一可用的东西是**只读探索**（「只读探索」视图，`layout.ts:51`），而不是「架构」视图。可用流程见 §6.4。

**可疑之处（提醒）**：
1. **对 C++/Python 仓库，代码图必然降级**。`C/src/execution/worker-runtime/exploration-tools.ts:56` 对无 AST 的语言返回 `unsupported_ast` + `ast:false`，诊断原文："No AST provider for this language. Only textual include references are extracted… **No semantic or call-graph coverage.**"
2. **实测印证**：对 slam6（ROS2/C++）的探索报告里，`sources` 任务明确写了"C++ 无 AST/cpp_index 能力…**调用关系不是完整调用图**"。
3. **文档滞后会被图固化**。同一份报告发现 `docs/架构.md` 全文 **0 次**提到 `fast_livo2_nav`。若把报告直接转成基线而不带 `unresolved`，会把推断固化成权威架构。

---

## 4. 模块探索完成后建立的模块 Agent，及其"自然形成"的联系

### 4.1 现状：未找到实现

| 检查 | 结果 |
|---|---|
| `RoleSpec` 是否有模块级绑定 | grep `moduleId`/`moduleIds`/`scope.*module` in `C/src/contracts/role-spec.ts`、`C/src/contracts/plan.ts` → **空** |
| `Plan` 的 Task 是否有模块引用 | 同上 → **空** |
| 是否有"模块 Agent"概念 | `D/CONTEXT.md` 无此词条 |

→ **「模块 Agent」目前完全未找到实现。** 现有 Agent 的绑定维度是 `projectId + workspaceId + goalId + taskId`（`C/src/app/service.ts:808` 的 `spec`），**没有模块维度**。

### 4.2 设计：谁和谁连、连的依据、连上看到什么、边界怎么划

**谁和谁连** —— 模块 Agent 与其"邻居模块"的 Agent。邻居由**图边**决定，不由人手工维护。

**连的依据**（三层，从硬到软）：
1. **`ArchitectureSourceMapping.id`**：模块的显式身份（`architecture-source.ts:4-5`）。**目录名不算模块**，所以模块 Agent 的负责范围只能从这个映射来。
2. **`ArchitectureBaselineContentV1.dependencyRules`**：机器可校验的依赖边 `{ kind: 'forbid_dependency', fromModule, toModule }`（`C/src/contracts/governance.ts:92-100`）。
3. **不变量 #12 的计划钉住**：PlanRevision 接受时固定解析出的 ArchitectureBaseline revision（`D/ARCHITECTURE.md:292`）。**这保证"连的依据"不会在任务执行中途漂移。**

**连上之后 Agent 能看到什么** —— 有界 `ContextBundle`，不是全图：
- 本模块 `paths` 下的源码（经 `WorkspaceReader` 权限过滤）
- 直接相邻模块的 **`interface` 节点**（不带 implementation）
- 相关 `unresolved` 条目（作为"证据缺口"显式告知，而不是隐藏）

**边界怎么划** —— 边界就是让注意力集中的手段，具体做法：
- 边界的**唯一来源**是 `ArchitectureSourceMapping`；一个路径不能被两个模块声明（该契约已校验重复映射，`architecture-source.ts:32`）
- 越界读取不是"报错"而是"**不在 ContextBundle 里**"——即靠**不给材料**来集中注意力，而不是靠事后拦截
- 需要跨界时走**显式协作**（`CoordinationIssue`，`D/CONTEXT.md:152-153`），留下来源与参与职责

**【待拍板】** 模块 Agent 的粒度：
- 选项 1：**一模块一 Agent 身份**（12 个 Module → 12 个身份），简单、与 Registry 对齐，但目标项目自身的模块可能远超 12 个；
- 选项 2：**按 `ArchitectureSourceMapping` 动态生成身份**（与项目的真实模块结构一致），灵活但需要新的身份持久化；
- 选项 3（我倾向）：**先只做"同模块连续工作"**，即模块只是**绑定范围**、不是独立身份——这与 `lifecycle-session-reuse.md:30`"不预先增加独立 Module 或平行状态系统"一致，代价最小。

---

## 5. 注意力集中的两侧

### 5.1 Agent 侧：靠模块边界让上下文只保留相关部分

**已有机制**：`C/src/data/context-compiler/` 下 **20 个按消费者划分的编译器**，每个负责一类材料的有界选取：

`architecture-context-compiler.ts`、`baseline-evolution-context.ts`、`completed-work-context-compiler.ts`、`context-compiler.ts`、`coordination-context-compiler.ts`、`execution-feedback-context.ts`、`exploration-context-compiler.ts`、`exploration-session-context.ts`、`feedback-decision-context.ts`、`handoff-context-compiler.ts`、`history-materials-context.ts`、`material-selection.ts`、`memory-context.ts`、`operator-planning-context.ts`、`plainning-context-compiler.ts`（Planning）、`producer-collaboration-facts.ts` 等。

**实测证据（一次真实回复请求）**：对 slam6 的一次只读提问，服务端装配出的选材是**恰好 5 类**：

```
selectedSources = [ goal, architecture-activation, collaboration-fact-set, verification-stages, human-actions ]
roleBinding     = query-reader @ read-only-v1
budget          = maxTokens 1,000,000
multiTurn       = maxRounds 1
```

也就是说"注意力集中"在 Agent 侧**已经实现**，而且是有界的、可解释的（每一类来源都有 `refKey` 与版本）。

**要补的**：模块边界目前**不参与选材**。建议把 `ArchitectureSourceMapping` 作为 `material-selection.ts` 的一个筛选维度，使"只给当前模块 + 直接邻居的 interface"成为默认，而不是靠任务描述里的自然语言。

### 5.2 人侧：靠界面把相关信息收拢

**已有机制（很弱）**：视图带 `scope`（`layout.ts:41-62`）——`workspace` / `goal` / `global` 三档。切换目标时只有 `goal` 作用域的视图会跟着换。

**不足（实测）**：`DEFAULT_TABS`（`layout.ts:64-69`）一次打开 **4 个右侧页签**（任务／文件／Agent／检查与验证），而右侧一共 **19 个视图**、`DEFAULT_RIGHT = 440px`（`:14`）。用户的真实体验是"满屏找"。

**建议的具体做法**：
1. **目标作用域收拢**：把 `scope` 从三档细化为"当前 Task"一档，视图默认跟随**当前选中的 Task**，而不是整个 goal；
2. **上下文条（Context Bar）**：在右侧面板顶部固定一条，只显示"当前目标 / 当前任务 / 当前模块 / 当前运行"，点击可切换，**不再靠页签找**；
3. **按需侧栏**：把 19 个视图分成"常驻 3 个 + 按需唤起 16 个"，未接通的视图（架构、差异、任务续跑）**默认不出现在页签里**，避免"点开就是不可用"；
4. **失败可见性前置**：把 `rework`／`plan-changes` 的未处置事项计数显示在上下文条上，而不是藏在页签里。

**【待拍板】** 右侧面板是否要从"多页签"改为"单视图 + 上下文条"。这是**信息架构级别的改动**，影响所有视图，需要你确认方向后再谈实现。

---

## 6. 交互面：一个面决定所有交互

### 6.1 现状：这个原则目前不成立

`C/src/ui/src/state/layout.ts:41-62` 里，**19 个视图全部是右侧面板页签**（除 `terminal`/`logs` 在底部）：

```ts
conversation: { title: '主对话', placement: 'right', scope: 'goal', singleton: true },   // :42
files / file / diff / tasks / task-graph / agents / verification / activity /
exploration / settings / architecture / reviewer / memory / continuation /
rework / plan-changes                                                                     // :43-59
terminal / logs → placement: 'bottom'                                                     // :60-61
```

**「主对话」是 19 个平级页签里的一个**，不是承载一切的"面"。所以"一个面决定所有交互"是**目标状态**，不是现状。

### 6.2 这个面与主 Agent 的区别与相同点（一开始就要分清）

| 维度 | 「主对话」这个面 | 执行工作的主 Agent（Run） |
|---|---|---|
| 请求装配 | `ContextBundle`（`selectedSources` 5 类，实测） | 同样是 `ContextBundle`（`TaskEnvelope`） |
| 角色绑定 | `query-reader @ read-only-v1`（**只读**） | `executor` 等可写角色，受 `allowWrite` 显式授权 |
| 轮数 | `multiTurn.maxRounds = 1`（实测） | 单次 Run 内多轮工具调用（实测 slam6 单任务最多 20 次模型请求） |
| 能否改状态 | **不能**。产出是回答，不是命令 | 不能直接改：只提交事实/Claim/Verdict（不变量 #2） |
| 写权 | 无 | 有，但必须 `allowWrite: true`（`C/src/app/service.ts:800-801`） |

**相同点**：两者都受同一套角色绑定、预算、来源权限约束；都走 `ContextCompiler`；都不能自行推进长期状态。
**不同点（务必区分）**：这个面**只读、单轮、不改状态**；主 Agent **可写、多轮、但仍不能自行完成 Task**。

**响应用途机制**：这个面通过 `responsePurpose` 切换语气与内容组织（`C/src/contracts/query-execution-context.ts:20-26`）：`architecture` → adviser，`handoff` → scribe，其余 → secretary。这是**同一个面上的三种"人格"**，不是三个 Agent。

### 6.3 工具、搜索、记忆如何构成一次回复的请求

实测一次真实回复请求的装配：

| 组成 | 来源 | 证据 |
|---|---|---|
| 事实 | `selectedSources` 的 `goal` / `collaboration-fact-set` / `human-actions` | 实测 dump |
| 架构与验证 | `architecture-activation` / `verification-stages` | 同上 |
| 记忆 | `memory-context.ts`，按 profile/project scope + revision | `C/src/data/context-compiler/memory-context.ts` |
| 搜索/读取工具 | 探索工具集：`code_index / cpp_index / list_files / project_index / python_index / read / search / source_excerpt / symbols` | 实测（探索运行时）与 `C/tests/app/explorations.test.ts:81` 的工具名断言 |
| 工具执行 | 内核 `ToolExecutor`，进程沙箱 PATH 固定 `/usr/bin:/bin` | `K/src/tools/dispatcher/tool-dispatcher.ts` |

**注意**：沙箱 PATH 固定这件事有真实后果——探索一个项目时若要用项目内的工具链，**必须把可执行文件放进项目**（实测做法：`cp <node> <项目>/.cache/node`）。这是使用上的一个隐形门槛（见 §11）。

### 6.4 「最近的 run」在界面上以什么形式存在

| 形式 | 位置 | 证据 |
|---|---|---|
| 运行日志（工具调用、模型事件、用量） | 底部 `logs` 视图，goal 作用域 | `layout.ts:61`；数据来自 `liveRuns[].trace` |
| 任务行 + 详情/日志按钮 | 右侧 `tasks` / `task-graph` 视图 | `layout.ts:46-47` |
| 终端会话 | 底部 `terminal` 视图，workspace 作用域 | `layout.ts:60` |
| 状态查询 | `GET /api/state?projectId=&workspaceId=&goalId=` 的 `liveRuns` | `C/src/app/service.ts:436` |

**可疑之处**：`liveRuns` 只在 `agents.status === 'ready'` 时才投影出来（`C/src/app/service.ts:436` 的条件）。实测在目标刚建好、agent 面板未就绪时 `liveRuns` 是空的——**用户会以为没跑起来**。

---

## 7. 计划：人应当能直接提出请求，也应当能直接更改目标和计划

### 7.1 目标可改——这一点单独写清楚

**结论：目标在契约上可以改，而且只能"有界地改"；但目前没有任何入口，所以实际上改不了。**

**契约（存在）** `C/src/contracts/goal-change.ts:32-55`：

```ts
export type AmendGoalRequestV1 = {
  goalRef: GoalRef;
  planRef: PlanRevisionRef | null;
  /** The requested objective/obligation DELTA (bounded; never raw rewrite). */
  objectiveDelta: { kind: "change" | "clarify" | "restore";
                    newObjective: string | null; summary: string } | null;
  obligationDeltas: { obligationId; action: "add" | "change" | "remove";
                      newText: string | null; justification: string }[];
  requestedBy: ActorRef;
  ...
};
```

注意注释原文：**"有界增量，永远不是整段重写"**。任务集的改动规则更严（`:57-69`）：增量**只能改"谁承担义务"**，**不能改义务正文与验收语义**；`addTask` 必须同时给指派，否则守卫 f1 拒绝；不允许链式取代。

**实现（存在）**：`C/src/interaction/human-collaboration/human-collaboration.ts:112` 的 `amend(request)` 已实现，返回 `accepted{proposalRef}` / `needs_material{gaps}` / `rejected`。

**入口（不存在）——三个 grep 全空**：

| 检查 | 命令 | 结果 |
|---|---|---|
| 调用者 | grep `\.amend(` in `C/src`（排除 contracts） | **空** |
| HTTP 路由 | grep `amend` in `C/src/app/service.ts`、`server.ts` | **空** |
| UI | grep `amend` in `C/src/ui/src` | **空** |

**唯一可达的修订入口是 feedback**：`C/src/control/plan-compiler/feedback-decision-compiler.ts:19` 调用的是**同一个** `planning.request(AmendGoalRequestV1)`，只是从"人对某个回答做选择"进来。完整链路见 `C/src/app/service.ts:677-685`：

```ts
if (path === '/api/real/feedback/options') ...
if (path === '/api/real/feedback/choose') {
  feedbackDecisions.choose(...) → feedbackCompiler.requestDecision(...)
  → h.driveQuery({reason:'human-feedback-decision'}) → triggerRework(...) → project()
  return { status, decisionRef, planRef, queryJobRef }
}
```

**所以现在的实际状况是**：人想改目标，只能"先提一个只读提问 → 拿到回答 → 在回答下方选一个反馈选项"。**人不能直接说"把目标改成 X"。**

**【待拍板】** 是否把 `amend` 接到交互面？这是**最小改动就能让人直接改目标**的路径（契约与实现都在，只缺一个 HTTP 入口 + 一个输入框）。我建议做，但"目标可改到什么程度"（哪些字段允许人直接改、哪些必须走提案）属于产品取舍，请你定。

### 7.2 自动化改动必须经过人

**已有保障**（`C/src/control/control-engine/autonomous-rework.ts:436` 注释原文）：

> 「守卫链在这里原样复跑：`applyPlanChange` 的 a–i（形状、提案/决定存在、**仅 accept 可应用**、…）」

即自动返工是"记录提案 → 以 `actor=system` 记录决定 → `applyPlanChange`"，**并且应用时把同一条守卫链再跑一遍**。`module-status.md:156` 也确认："自动受理仍受既有授权/预算/**人的拒绝**/版本守卫约束"。

**可疑之处**：自动返工以 `actor=system` **自行记录决定**。守卫链保证了"只有 accept 才能应用"，但"这个 accept 是系统给的"。**建议**：对影响 Goal 正文（`objectiveDelta`）的改动，强制要求 `actor=human`；对只改任务承担者的（`PlanTaskSetDeltaV1`）允许 `actor=system`。**【待拍板】**

### 7.3 计划修订的三条通路（现状）

| 通路 | 谁发起 | 入口 | 前提 |
|---|---|---|---|
| 反馈决定 | **人** | `/api/real/feedback/options` → `/choose` | 必须有一个已回答的只读提问（`answerRef`） |
| 自动返工 | **系统** | `triggerRework` → `autonomous-rework.ts` | 该目标下有未处置 FAIL/issue |
| 换新目标 | 人 | 新建目标 → `/api/real/work` | 探索计划的 `install` **拒绝原地替换** |

**实测坑**：探索计划**不能原地替换**（`C/tests/app/explorations.test.ts:115` 断言 replacement 返回 400）。所以探索范围一旦要改，只能换目标——而失败的任务因租约不释放，**换目标也是唯一出路**（见 §2.2）。

---

## 8. 秘书这类 Agent 的常驻化

### 8.1 现状：秘书不是 Agent，是一段提示词

`secretary` 在本仓库里**只是 query response guide 的一个分支**（`C/src/contracts/query-execution-context.ts:20`）：

```ts
secretary: { id: 'semantic-query-secretary-summary-v11', instruction: SECRETARY_SUMMARY_V11 }
```

并且 `:24` 把它设为**默认**（非 architecture / handoff 的用途都走它）。此外 `RoleSpec` 里确实装了一个名为 `secretary` 的角色（slam6 实测 8 个角色之一），但**没有任何地方把它当成常驻实例**。

`D/human/module-status.md:134`（HumanCollaboration 审查结论）原文：

> 「已有目标澄清决定回流；**完整秘书/参谋对话和跨工作包协调仍缺**」

`D/human/module-status.md:164`（剩余产品能力第 1 项）原文：

> 「秘书/参谋/书记/规划/集成的**真实角色生成、持续分工和跨工作包收敛**。」

**冷启动为什么会难**：秘书没有可续的身份与记忆。每次提问都是一次全新的、`maxRounds=1` 的只读调用（实测），它不知道"上次说过什么"，也不持有"当前关注点"。用户感受到的就是"每次都要从头解释一遍"。

### 8.2 常驻化方案（三步，最小消费者优先）

**关键前提**（已认可的设计方向，`lifecycle-session-reuse.md:19` 原文）：

> 「持续管理有身份和负责范围的 Agent，让其探索、执行、返工和协作经历可以复用。**身份持续不要求进程常驻**，也不意味着所有工作共享一个无限增长的上下文。」

也就是说：**"常驻"应该是身份的持续 + 记忆的可续，不是常驻进程。**

| 步骤 | 做什么 | 复用什么 | 新增什么 |
|---|---|---|---|
| **S1（建议先做）** | 给秘书一个**稳定的 Agent 身份**（`RoleSpec=secretary` + 一个 `WorkContext`），让它的历次回复进入 `ExecutionMemory` 并可被下次选取 | `RoleSpec`/`RoleBinding`（已有）、`ExecutionMemory`（`D/CONTEXT.md:149-150`，已有契约）、`memory-context.ts`（已有） | 一个"当前关注点"的持久位置 |
| **S2** | 允许秘书**跨会话续接**：同一 `WorkContext` 下多轮，而不是每次 `maxRounds=1` | `WorkContext`（`D/CONTEXT.md:146-147`）可跨 Run | `multiTurn.maxRounds` 的下发策略 |
| **S3** | 秘书可**主动**（被唤醒时）汇总，而不是只被动回答 | `durable-wake`／`dispatch-wake`（`C/tests/app/durable-wake.test.ts`、`dispatch-wake.test.ts` 已有测试） | 唤醒条件的策略 |

**不要做**（与现有规范冲突）：
- ❌ 不要新增"MemoryStore"——`lifecycle-session-reuse.md:349` 的收敛要点明确「不建 MemoryStore」「秘书/参谋＝消费执行记忆做选项/影响/升级」
- ❌ 不要新增平行编排系统——`module-status.md:160`：「契约应先复用现有 RoleSpec/RoleBinding，不另建平行编排系统」
- ❌ 不要用"固定常驻 Agent 数量"冒充方案——`lifecycle-session-reuse.md:38`：「不得以固定常驻 Agent 数量或新增进程管理器代替需求分析」

**【待拍板】** S1 的"当前关注点"存在哪里：挂在 `WorkContext` 上（复用），还是新建一个轻量投影（会触及"不新增 Module"的约束）。我倾向前者。

---

## 9. task graph 与架构图为什么脱节，以及怎么联动

### 9.1 为什么现在脱节

**三层原因，从深到浅：**

**① 数据来源根本不同**

| 图 | 数据来源 | 节点 | 边 |
|---|---|---|---|
| task graph | `GET /api/state` 的 `state.graph`（**计划投影**，由 `ReadModelIndex` 从账本重建） | Runtime Task | `parent_of` 层级 + 执行依赖 |
| 架构图 | 应由 `ArchitectureSourceSnapshotV1` 提供（**代码图**） | `CodeGraphNode` | `CodeGraphEdge` |

**② 契约层其实已经设计好联动，但没人接**

关键证据 —— `C/src/contracts/architecture-inspection.ts:166-185`：

```ts
export type CodeGraphSnapshotV1 = {
  ...
  planRef: PlanRevisionRef;                       // ← 绑定到计划版本
  /** The ONLY admissible baseline input: the plan pin (invariant #12). */
  baselinePin: ArchitectureBaselinePin;           // ← 绑定到计划钉住的基线
  gitRef: { commitHash; treeDigest } | null;
  nodes: CodeGraphNode[]; edges: CodeGraphEdge[];
  indexCapabilities: CodeGraphIndexCapabilities;
  ...
};
```

配合 `D/ARCHITECTURE.md:292` 不变量 #12（"PlanRevision 在接受时固定解析出的 ArchitectureBaseline 与 CompletionPolicy revision"）——**"计划 → 基线 → 代码图快照"这条链是设计要求**。

**③ 实现层缺数据源，所以 task graph 只能显示"工作分解"**

`ArchitectureReconciler` 契约状态 = **planned**（`D/ARCHITECTURE.md:180`）；`codeGraph` 端口只做 TS/JS（`C/src/app/service.ts:211`）；`architecture` 视图是 `UnavailableState`（`misc.tsx:82-86`）。

**结论**：task graph 只有"谁依赖谁"（`TaskHierarchy` 的 `parent_of` + `executionDag`），**没有"这件事动的是哪个模块"**这一维度。而 `D/CONTEXT.md:138-139` 明确 `TaskHierarchy` "只用于层级表达而不产生执行依赖或完成豁免"。

**所以它退化成 ToDoList 的机制性原因是**：它只有"状态 + 层级"，没有"空间归属"。而 `D/CONTEXT.md:173-174` 定义的 `TodoView` 恰好就是"Runtime Task 状态的 ReadModel"——**task graph 现在展示的信息量，确实等同于 TodoView**。原先设想的优势（在图上看出模块耦合、看出改动影响面）**需要模块维度才能体现**，而这个维度只能来自架构图。

### 9.2 怎么让两者联动

**联动的数据来源**（遵守不变量 #5：三类图**不互相充当真相源**，是"互映"不是"合并"）：

| 方向 | 数据来源 | 实现手段 |
|---|---|---|
| 计划 → 架构 | `CodeGraphSnapshotV1.planRef` + `baselinePin`（**已有**） | 已有契约，只需接线 |
| 架构 → 计划（**缺**） | 需要 `Task → moduleId` 映射 | **未找到实现**：任务没有模块引用（§4.1）。**建议新增**：允许 PlanRevision 的 Task 声明一个或多个 `ArchitectureSourceMapping.id`（作为可选字段，不破坏既有计划） |
| 两边互映的差异 | `ArchitectureDeltaChange`（`:193-205`，机械差分） | 把 delta 作为 task graph 上的"结构变化"图层 |

**两边怎么互相反映（具体设计）**：

1. **task graph 侧**：按模块对任务分组/着色（一个任务可属多个模块，用堆叠色带）；选中某模块时高亮所有触及它的任务；模块边界冲突的任务（违反 `dependencyRules`）加红色描边。
2. **架构图侧**：在 `module_dependency` 边上标注"本轮有几个任务在动这条边"；节点上标注"是否出现在本计划内"。
3. **共同的时间轴**：两个图都显示同一个 `planRevision` 与 `baselinePin`，并显式提示"计划已换版、图快照尚未刷新"这类不一致（stale）。
4. **不合并成一张图**：因为不变量 #5 禁止互为真相源，也因为这会让 512 节点 / 1024 边 / 240 KiB 的容量上限被击穿。

**【待拍板】** 是否允许 Task 声明 `moduleId`？这是一个**契约扩展**（会影响 `plan.ts`、`goal-change.ts` 的 `PlanTaskSetDeltaV1`、ReadModel 投影），需要你先定"任务与模块是否一对一"——`D/dev_docs/design/执行agent生命周期与执行记忆-对话记录与答复.md:354` 的开放问题 Q1 正是这一条（"Work=Runtime Task？任务组？还是契约/模块变更单元？"）。

---

## 10. 测试功能：人提需求 → Agent 完善 → 人输入文字

### 10.1 现状：这段流程在右侧面板，不在主对话

**证据**：人在「检查与验证」视图里输入文字：

| 输入点 | 控件 | 位置 |
|---|---|---|
| 检查命令 | `TextInput` `data-testid="check-command"` | `C/src/ui/src/features/verification.tsx:130` |
| 针对运行 | `Select` `data-testid="check-run"` | `:129` |
| 单次超时 | `TextInput` | `:133` |
| 执行并保存报告 | `Button` `data-testid="run-check"` | `:134` |
| 目标级验证对象 | `Select` `data-testid="round-gate"` | `verification-round.tsx:124` |
| 检查标识 / 必读文件 / 命令 / 目录 / 超时 | `TextInput`+`Textarea` `data-testid="round-check-*"` | `verification-check-editor.tsx:33-44` |

而 `layout.ts:49` 定义 `verification: { title: '检查与验证', placement: 'right', scope: 'goal' }`——**它是一个独立的面板，不经过「主对话」**。

### 10.2 为什么现在依赖侧边栏，这样是否背离"一个面决定所有交互"

**为什么会这样（机制性原因）**：因为验证数据的权威在 `VerificationEngine`，界面消费的是 `/api/real/verifications/*` 的正式结果（`C/src/app/service.ts:701-775`），而这些是**结构化表单**（命令、cwd、超时、必读路径、判定）。把它塞进"一段自然语言对话"里，需要额外的"结构化输入"能力，**目前没有**。

**是否背离**：**是，背离。** 但要精确地说：

- "一个面决定所有交互"**从来不是现状**（§6.1），所以谈不上"背离了既有实现"，而是"背离了目标原则"；
- 真正的问题是**同一个人要做两件事（说需求、填验证），却要在两个面板之间切换**，而且两者不共享上下文（对话里说的需求，验证面板不知道）。

### 10.3 承载设计：让主对话成为入口，验证面板成为"卡片展开"

**建议机制（可实现的粒度）**：

1. **需求 → 验证草案**：在「主对话」里人用自然语言说需求；Agent 返回时**附一个"验证草案卡片"**（不是直接执行），内容是它建议的检查命令/必读文件/超时。
2. **卡片可编辑**：卡片内联可编辑字段（复用现有 `verification-check-editor.tsx` 的控件），人在这里输入文字 = 满足"人要能输入文字"。
3. **确认后才进正式入口**：点"确认"才调用 `/api/real/verifications/rounds/start`；**未确认的草案不产生任何状态**（符合不变量 #4：UI 不接受直接状态写入）。
4. **执行结果回到同一个面**：报告、退出码、stdout/stderr 作为同一条对话消息的后续展开（复用 `verification.tsx:221-229` 已有的 `readonly-report`/`report-stdout`/`report-stderr` 展示）。
5. **保留侧边栏作为"全量视图"**：检查与验证面板不退场，承担"跨任务对比/历史报告"的职责，而不是唯一入口。

**【待拍板】** 验证草案的生成方：由**当前对话的模型**顺手生成（简单、但可能不准确），还是**单独派一个验证角色**（准确、但多一次模型调用与一轮授权）？我倾向后者，因为验证语义重要且产品已有 `independent-reviewer` 角色。

---

## 11. 上手难度：具体卡在哪一步

以下 8 条全部来自实测或代码，按"用户实际会撞到的顺序"排列。

| # | 卡点 | 症状 | 证据 | 改进方向 |
|---|---|---|---|---|
| 1 | **必须先配模型** | 不配模型时，填了需求点「执行开发任务」不会工作 | `/api/model-settings/test` 是独立入口；真实运行需要已保存配置 | 首次启动时把"配模型"做成引导步骤，而不是藏在「设置」页签里 |
| 2 | **「允许在当前项目内修改文件」不勾，按钮是灰的** | 用户以为界面卡了 | 后端硬性要求 `allowWrite === true`，否则 400「请明确允许在当前项目内修改文件」（`C/src/app/service.ts:800-801`） | 勾选框加默认说明；按钮 disabled 时给出**原因文案**而不是只变灰 |
| 3 | **服务一重启，页面必须刷新** | 一路 `403 本地会话已过期，请刷新页面` | `workspaceToken = randomUUID()` 每次启动重生成（`C/src/app/server.ts:23`）；所有工具/设置/`/api/real/*` 请求校验它（`:50`） | 403 时前端自动重新拉 `/api/meta` 并重试一次，而不是让用户手动刷新 |
| 4 | **新建目标后没有计划，只有一个「安装样例计划（测试适配器）」** | 点了它，任务列表变成与目标无关的 `task-install-contract`「安装 CompletionPolicy / ArchitectureBaseline」 | 实测（slam6 目标 `a8d6423f…` 的 matrix 行） | 该按钮改为明确的"演示夹具"标识；真实计划走 planning 入口 |
| 5 | **探索流水线普通用户用不了** | 「只读探索」视图打开后，没有"制定探索计划"的入口 | 探索计划由 `OperatorPlanCompiler` 制定（操作者给出 tasks+依赖），**UI 无入口**（实测：我用 HTTP 直接装计划才跑通） | 提供"按目标自动生成探索计划草案 → 人确认"的入口（与 §10.3 的卡片式确认同构） |
| 6 | **失败的任务在同一目标内永远重试不了** | 换 requestId 被判竞争；原 requestId 只重放已结束的运行 | 任务派发租约不释放（`C/src/control/control-engine/policies/task-eligibility.ts:100-107`，detail=`leased`） | 提供"对账并释放租约"的正式入口；或让 provider 类失败可重试（当前 `maxModelRetries` 恒为 0，见下） |
| 7 | **「架构」「差异」「任务续跑」三个视图点开就是"不支持"** | 用户以为产品坏了 | `misc.tsx:82-86`（架构）、`diff.tsx:56-59`（差异）、`misc.tsx:143-146`（续跑） | 未接通视图默认不出现在页签里；或做成"路线图卡片"说明缺什么、什么时候有 |
| 8 | **19 个视图、4 个默认页签，没有引导** | 满屏找；不知道从哪开始 | `layout.ts:41-69` | 上下文条 + 按需侧栏（§5.2） |

**额外提醒（跨条）**：一个 provider 瞬时失败会让整份计划作废并锁死——`provider-support.ts:48` 把无 HTTP 状态码的网络类失败归为 `provider_request_failed`（`retryable:false`），而 `runtime-runner.ts:254` 的 `maxModelRetries` 默认 0、`K/src/app/composition/composition-root.ts:309` 写死 0、平台侧从未覆盖。**这是"上手难度"里最贵的一条**：用户跑长计划时会被随机中断，且无法在同目标内恢复。

---

## 12. 未找到实现清单（汇总）

| # | 能力 | 结论 |
|---|---|---|
| 1 | `Agent Team` 实体 | **Agent Platform 产品仓命中 0**；但 **dsh 中存在**（`packages/experimental/`，实验功能，默认不启用）——本产品的"未找到实现"不等于"它不存在" |
| 2 | 模块级 Agent 绑定（`moduleId`） | `role-spec.ts`/`plan.ts` grep 为空 |
| 3 | 架构图渲染层（nodes/edges → 画面） | `misc.tsx:82-86` 为 `UnavailableState` |
| 4 | WorkspaceReader 的架构快照 Adapter | 同上列为首个缺失依赖 |
| 5 | `codeGraph` 对 C++/Python 的支持 | `service.ts:211` 仅 TS/JS；`exploration-tools.ts:56` 无 AST |
| 6 | `amend` 的 HTTP 入口与 UI | 三个 grep 全空（实现类存在） |
| 7 | `Task → moduleId` 映射 | 未找到；§9.2 建议新增 |
| 8 | 探索计划的 UI 制定入口 | 只有 `OperatorPlanCompiler`（操作者输入） |
| 9 | 常驻/可续的秘书身份 | 秘书仅为 query response guide |
| 10 | 失败任务的同目标重试 | 租约不释放 |
| 11 | `Git 工作区差异` | `diff.tsx:58` 明说"后端没有提供工作区版本比较接口"；而 `D/dev_docs/modules/data/workspace-reader.md:14` 声明该模块能读 Git 差异——**文档与代码冲突** |
| 12 | 同 Run 暂停/继续/steer | `coding-agent-runtime.ts:128` `supportsSnapshot:false`；`module-status.md:140` 与 `:169` 均承认 |

---

## 13. 需要你拍板的问题（汇总）

| ID | 问题 | 我的倾向 | 影响面 |
|---|---|---|---|
| Q1 | §2.3 路线 A/B/C 择一 | **A**（同模块连续工作 + 接通 amend） | 全局 |
| Q2 | §4.2 模块 Agent 粒度：一模块一身份 / 动态生成 / 只做绑定范围 | **选项 3**（只做绑定范围） | 契约是否新增身份持久化 |
| Q3 | §5.2 右侧面板是否从"多页签"改为"单视图 + 上下文条" | 建议改 | **信息架构级**，影响全部 19 个视图 |
| Q4 | §7.1 是否把 `amend` 接到交互面；人可直接改目标的**范围**到哪里 | 建议接，范围需你定 | 契约入口 + UI |
| Q5 | §7.2 改 Goal 正文是否强制 `actor=human`（禁止系统自动 accept） | 建议强制 | 返工守卫 |
| Q6 | §8.2 秘书"当前关注点"挂 `WorkContext` 还是新建轻量投影 | 挂 `WorkContext` | 是否新增 Module |
| Q7 | §9.2 是否允许 Task 声明 `moduleId`（任务与模块是否一对一） | 允许、可多值 | 契约扩展 + 投影改造 |
| Q8 | §10.3 验证草案由当前对话生成，还是单独派验证角色 | 单独派 | 模型调用与授权 |

---

## 14. 本文档的方法与边界

- **方法**：只读勘察 `C/src`、`C/tests`、`K/src`、`D`，并对运行中的产品做了实测（slam6 只读探索一轮、查询与状态 dump、账本与租约核查）。所有 `file:line` 均为本次实际读取。
- **未做**：未运行全量测试；未验证 §3.3/§4.2/§5.2/§9.2/§10.3 的设计提案能否通过既有守卫链——它们**是提案，不是已验证方案**。
- **不改代码**：本轮零源码改动。本文档之外，相关联的**已实现能力缺口**另见 `C/AGENT-REFACTOR-LOG.md` 的 B 节（架构图未实现、模型不重试且失败锁死任务）。

---

## 15. 因前提更正而改变或推翻的结论

> 本节是 2026-09-19 前提更正的**差异记录**。初版把 Agent Team 当作泛化的产品概念；更正后：**agent-team 属 dsh 测试中功能**。

| # | 位置 | 改前（初版） | 改后（本版） | 性质 |
|---|---|---|---|---|
| C1 | §0 摘要 主题 1 | 「**仓库里不存在 "Agent Team" 实体**」 | 「**Agent Platform 产品仓里没有实现**；Agent Team 是 **dsh 的测试中功能**」 | **推翻** |
| C2 | §1.1 首句 | 「本仓库里不存在 "Agent Team" 这个实体」＋「这个概念既没有代码，也没有文档，也没有界面」 | 限定在产品仓；明确「这个 0 只说明本产品没有实现它，**不能说明它不存在**」 | **推翻** |
| C3 | §1.1 定位 | 「**"大号的 Agent Team"也不成立**」——把 Agent Team 当作泛化协作模型来对比 | 改为与 **dsh 实际模型**对比：Lead + 具名 teammate + 持久消息 + 共享任务板（§1.1.1） | **更正** |
| C4 | §1.1 收尾 | 「**Agent Team 是"多个平级主体自由协作"**」 | 「dsh 的 Agent Team 是**一个会话里的 Lead + teammate**」——**不是"平级"** | **推翻** |
| C5 | §2 议题性质 | 「要不要**基于它**来做」中的"它" = 产品自己的底座 | 拆成两问：① 要不要基于**本产品底座**做（**要**）；② 要不要**依赖 agent-team**（**不得**，dsh 明文禁止） | **更正** |
| C6 | §2.2 冲突表 | 无 dsh 相关条目 | 新增：**agent-team 是 dsh 实验功能，组外已发布产品不得依赖** | **新增** |
| C7 | §12 清单第 1 条 | 「`Agent Team` 实体｜全仓命中 0」 | 「**产品仓**命中 0；**dsh 中存在**（实验、默认不启用）」 | **更正** |

### 15.1 没有被推翻的部分（一并说明）

以下结论**不依赖**"Agent Team 是什么"这个前提，因此保持不变：

- §1.2 及之后关于 **Agent Platform 自身 Agent 模型**（`AgentInstance`／`AgentRun`／Coordination Role／Execution Role）的全部结论——它们本来就只描述本产品；
- §3–§11 的全部设计与勘察结论；
- §14 的方法与边界。

### 15.2 由这次更正**新产生**的约束

1. **不得把 agent-team 作为本产品的依赖或设计前提**（dsh 组外依赖禁令）。
2. **不得把 dsh 的 agent-team 术语**（Lead／teammate／roster／mailbox／task board）**直接搬进本产品的领域词典**——本产品的对应词是 `Coordination Role`／`Execution Role`／`RoleSpec`／`RoleBinding`／`Run`（`D/CONTEXT.md`）。
3. 若将来确实要参考它，只能作为**设计参考**（读它的已知限制以避免重犯），**不能作为运行时依赖**；且必须等它离开 `experimental/` 并给出稳定承诺之后再评估。
4. §2.3 的路线 A／B／C 不因本次更正而改变顺序，但**路线 B／C 的风险等级上调**：它们更容易诱导"顺手把 agent-team 拿来当参考实现"。

**【待拍板】** 是否需要在本产品的文档里显式登记"不得依赖 dsh 实验包"这一条（例如写入 `D/ARCHITECTURE.md` 的全局不变量或 `D/CONTEXT.md` 的边界说明）。我建议登记，但这是跨仓库的规范动作，需要你确认。
