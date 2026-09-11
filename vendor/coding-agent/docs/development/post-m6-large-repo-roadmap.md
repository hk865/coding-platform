# M6 之后的开发目标与实施交接

```yaml
status: current
updated: 2026-08-28
baseline_branch: codex/m6-completion
baseline_tag: m6-baseline
baseline_commit: beaeaff7b1d830498fd98308a549b154383165c0
audience: 后续负责实现、测试和文档维护的 Agent
```

本文档说明 M6 之后为什么继续开发、最终要解决什么真实问题、优化工作如何分层，以及后续 Agent 应按什么顺序实施。具体源码缺口和文件位置继续参考
[两段 Codex 对话评审形成的修改清单](improvement-plan-from-codex-review.md)。

---
用户prompt：

目前在agents/docs/devlopments下有一个总结的md，看一下是否如此，我目前的感觉主要是三层优化，一个是针对状态保留，runtime和session的，涉及tool的策略以及持久化的策略，针对性能优化，未多agent的性能（存储与时间），中断恢复，意外中断回复，第二个是沙箱，权限类型的，澄清了需要针对不同的状态有不同的设计，而且需要完善相应的工具。一个是除了agent相关的core以及状态等，需要可以留下未来扩展，优化的空间。

目前的真实需求是一个个人用的agent到更大代码库的，支持外部算法/工具进行优化，保留coding-agent核心的一个项目。之后可能要进行大代码库复现实战，即给出需求之后，全自动/人协作实现代码库，项目。

目前看一下git状态，有一个推送的m6-baseline，之前的main是有问题的，目前的baseline只是通过简单的真实使用测试，对了，对于测试案例你应该准备一些真实的业务场景，而不只是模块化测试。要包括写网页游戏，写前端网页素材库，写3D模拟，排查项目bug，优化引擎算法等等。

复述我的需求之后写下一步的文档，需要把我的真实需求（目标），以及各个模块的优化方向进行描述，我会让另一个模型能力没那么高的接手。


## 1. 用户真实需求复述

项目目标不是复制 Pi、DSH 或 Codex，也不是先做一个功能齐全的多 Agent 平台。真实目标是：

1. 保留当前 `coding-agent` 的可靠执行内核，包括事件提交屏障、Reducer、Session 日志、工具执行链、权限链和恢复不变量；
2. 先得到一个适合个人长期使用的 Coding Agent，能够在真实项目中读取、修改、运行、验证和解释代码；
3. 再扩展到大型代码库，允许接入外部算法、代码分析器、搜索/索引、构建系统、仿真器、渲染器和其他工程工具；
4. 最终支持用户给出项目需求后，由 Agent 全自动实施，或者在人类审批、纠偏和验收下协作实施；
5. 为未来多 Agent 留出存储、隔离、调度和合并空间，但当前不因追求平台化而破坏核心的简单性和正确性；
6. 项目是否可用必须由真实业务场景证明，不能只依赖单元测试、模块集成测试或合成 canary。

一句话目标：

> 把 `coding-agent` 建成一个核心可靠、外层可扩展，能够在大型真实代码库中持续完成工程任务的个人 Agent，并为后续人机协作和多 Agent 演进保留清晰边界。

---

## 2. 当前基线与判断边界

### 2.1 唯一开发基线

后续工作必须从以下版本继续：

```text
branch: codex/m6-completion
tag:    m6-baseline
commit: beaeaff7b1d830498fd98308a549b154383165c0
```

旧 `main` 停留在 `a91cde6b2016ddc131839ed77bace86ae67e6056`。它缺少 M6 后续的 Web、Provider、Runtime、Benchmark 和真实隔离修复，不得被当作当前实现起点。开始任何新工作前，先确认 HEAD 基于 `m6-baseline`，不要从旧 `main` 重建功能。

### 2.2 M6 已经证明什么

M6 已经通过基本质量门禁、真实 bubblewrap 路径、DeepSeek Provider smoke、4 个小型 canary 和若干真实使用故障回归。它证明：

- 核心模型—工具闭环可以工作；
- Session、Runtime、Web 时间线和基础恢复路径具备可用骨架；
- read/edit/shell/check 可以在当前隔离模型中完成基本任务；
- 项目已经具备继续演进的工程基线。

### 2.3 M6 尚未证明什么

`m6-baseline` 只是“基本真实使用可通过”的基线，不是大型代码库或生产级自治 Agent 的证明。它尚未证明：

- 多小时、多轮、大量工具调用后的状态和性能稳定性；
- 进程崩溃、机器重启和工具副作用不明确时的完整恢复；
- 仅凭 Session/Artifact 对一次代码修改进行完整审计、核对或回滚；
- 大型仓库中的搜索、构建、测试、调试和增量修改效率；
- 外部算法、仿真器、渲染器或工程工具的稳定接入；
- Agent 能独立完成一个有真实验收标准的完整项目。

因此后续不能把“已有测试全绿”解释为目标已经完成。

---

## 3. 三层优化方向

三层工作相互依赖，但职责必须分开。第一层保证“做过什么以及能否继续”，第二层保证“允许在哪里做什么”，第三层保证“未来还能以什么方式做”。

### 3.1 第一层：Runtime、Session、Tool 与持久化

**目标：**让长任务在正常取消、意外中断和机器/进程故障后仍能准确说明状态并安全恢复，同时控制长轨迹、大仓库和未来多 Agent 的存储与时间成本。

必须优化：

1. 工具生命周期明确区分 `pending`、`started/running`、`completed`、`failed`、`cancelled`、`outcome_unknown` 和 `abandoned`；
2. 正常取消先保存 `tool.cancelled` 及真实 ToolResult/effects；只有结果确实无法确认时才使用 `outcome_unknown`；
3. 分开处理用户取消、超时、进程崩溃、宿主重启和存储失败；产生副作用的工具不得在中断后自动重试；
4. `edit` 使用修改前后 revision/hash 对账；shell 默认 `unknown_on_interrupt`，只有显式声明只读、幂等或可对账时才自动恢复；
5. Session 保存执行事实，不声称自己是 Workspace 备份；增加 Artifact Store 保存完整 patch、截断输出、测试报告、诊断文件和 Run Manifest；
6. 模型长输出分段、批量持久化，并在 Tool、完成、取消和失败边界强制 flush；
7. 从 Session 投影 Runtime State、Model Context、Web Timeline 和 Audit View；
8. 优化 Session 批量写、Reducer、Context Selection、Workspace revision 和 token 估算；为未来并发运行评估 SQLite 写竞争和每 Agent 独立增量存储。

完成标准：

- 正常取消与强制中断产生不同、可解释的终态；
- 在 edit 执行前、执行后未记结果、记录完成后三个时点注入崩溃，都能得到确定对账结论；
- 长任务重启后能够恢复模型上下文和 Web/Audit 视图；
- 事件数、文件数增加时有可重复 benchmark，不出现未解释的数量级退化。

### 3.2 第二层：Sandbox、权限类型与工具完善

**目标：**让个人可信任务、受限 Workspace 任务和需要外部工程环境的任务使用不同策略；既不能锁死真实工程环境，也不能用一次宽泛 shell 授权放开后续高风险操作。

必须优化：

1. 拆分两个配置维度：

   ```text
   sandbox_mode = read_only | workspace_only | danger_full_access
   approval_policy = on_request | never
   ```

2. 管理员或用户配置可声明外部挂载的 host path、虚拟 mount path 和只读/可写权限；模型 ToolCall 不得临时请求任意宿主绝对路径；
3. 普通工作区操作、必须单次确认和直接拒绝三类分开；Git 强推、远程删除、`reset --hard`、`clean`、大范围删除、敏感文件、宿主进程和系统配置不得继承普通 shell 授权；
4. 审批指纹至少绑定命令类别、目标路径、cwd、Sandbox 模式和风险类型；简单字符串黑名单不能作为唯一防线；
5. 区分只读和可写 shell，或让 ToolDefinition 明确声明 effect/recovery 能力；
6. read/edit/check/search/shell 统一路径、错误、effects、changedPaths、revision 和 artifactRefs 协议；
7. 为外部算法、LSP、代码索引、构建系统、测试框架、浏览器和仿真器提供受控 Tool/Adapter 接口；
8. 当前先完善超时、进程组清理、敏感路径和高风险审批；大代码库长任务或多 Agent 前再补 CPU、内存、PID、磁盘配额及容器/cgroup/seccomp 强化。

完成标准：

- 同一核心能运行只读、Workspace 可写和显式全访问三种任务；
- 外部工具只看到授权资源，且授权可审计；
- 普通 shell 授权不能放行破坏性 Git、删除或进程操作；
- 安全拒绝、请求审批和工具失败在 Runtime/Session/UI 中有不同结果。

### 3.3 第三层：稳定 Agent Core 与未来扩展空间

**目标：**保留核心正确性，把变化频繁的上下文工程、工具表达、记忆、外部能力、人机协作和未来多 Agent 放在稳定 Port 之外，避免 RuntimeRunner 变成中央巨类。

必须保留：

- `AgentEvent → required Session Sink → Reducer → RunState` 的事实提交顺序；
- Tool 执行前提交 `tool.started` 的副作用屏障；
- Permission → Approval → Sandbox → ToolResult 的执行链；
- Checkpoint 只是可丢弃缓存，Session 事实才是恢复依据；
- 扩展只能提供输入、策略、能力或事件，不能直接修改 RunState。

应预留：

- `ContextProjectionPort`、`CompactionStrategyPort`；
- `ToolPresentationPort`、`InstructionComposerPort`；
- `MemoryProviderPort`、`AgentDriverPort`；
- `ArtifactStorePort`、`EvaluatorPort`；
- 外部 Tool/Adapter 注册接口。

约束：

- 不照搬 DSH 的完整 Cordis/Profile/Bundle 平台；
- 不为假设中的多 Agent 提前重写整个 Session；
- 新扩展点至少要有两个真实消费者或一个确定业务场景；
- 外部实现可以替换默认实现，但不能绕过核心状态与安全链。

完成标准：

- 接入外部代码分析器或算法工具不需要修改 Runtime 核心循环；
- 新 Context/Compaction 策略不改变 Session 事实协议；
- 人类审批、暂停、继续和纠偏通过 Inbox/Event 进入；
- 未来子 Agent 使用独立 Session 和 Workspace 增量，通过明确协议返回 Artifact 和结论。

---

## 4. 真实业务场景测试是正式门禁

模块测试继续保留，但每个阶段必须至少绑定一个真实业务场景。测试不仅检查函数返回，还要检查 Agent 是否理解需求、修改正确文件、运行验证、处理失败、解释结果并保留可审计轨迹。

### 4.1 必备场景矩阵

| 场景 | 任务示例 | 必须验证 | 验收产物 |
| --- | --- | --- | --- |
| 网页游戏 | 从空目录实现迷宫、塔防或物理小游戏 | 多文件规划、前端实现、运行修复、交互可用 | 可启动项目、自动测试、截图/录屏、Run Manifest |
| 前端素材库 | 建立带搜索、分类、预览和导出的组件/素材页面 | 组件组织、状态管理、批量资源、浏览器验证 | 构建产物、浏览器用例、可访问性/性能报告 |
| 3D 模拟 | 实现 Three.js/WebGL 物理或粒子模拟 | 外部库、渲染循环、数值稳定性、性能测量 | Demo、帧率/内存报告、截图/录屏 |
| 项目 Bug 排查 | 给定带真实缺陷的中型仓库，只描述症状 | 搜索定位、复现、最小修复、回归、不过度改动 | 复现记录、patch、测试、原因说明 |
| 引擎算法优化 | 优化搜索、调度、渲染、物理或增量计算热点 | benchmark、正确性守恒、性能对比、失败回退 | 前后 benchmark、测试、patch、结论报告 |

后续必须加入至少一个大型现有代码库场景，不能全部使用新建小项目。

### 4.2 场景任务包

```text
scenario-id/
  task.md                 用户只会看到的真实需求
  base/                   固定起始仓库或获取方式
  environment.yaml        依赖、工具、权限和预算
  acceptance/             可执行验收器
  oracle/                 仅供 evaluator 使用，Agent 不可见
  interruption-plan.md    取消/崩溃注入点
  expected-artifacts.md   patch、报告、截图等要求
```

统一评价：功能正确性、工程质量、自主性、安全性、恢复性、性能和可审计性。性能至少记录总时间、模型轮次、工具次数、Token、Session/Artifact 大小和 Workspace 扫描成本。

### 4.3 测试分层

```text
L0  单元测试：状态机、Schema、Policy、算法
L1  集成测试：Runtime—Session—Tool—Sandbox 闭环
L2  真实本地业务场景：真实文件、构建、浏览器/仿真器、确定性 evaluator
L3  真实 Provider 场景：固定模型与预算，评价 Agent 联合能力
L4  大型代码库长任务：多小时、中断恢复、人类纠偏，未来加入多 Agent
```

里程碑不能只凭 L0/L1 完成。状态与安全改动至少通过对应 L2 场景；能力版本比较至少使用 L3；宣称支持大型代码库前必须有 L4 证据。

---

## 5. 下一步实施顺序

每一阶段都要小步提交，不要在一个改动中同时重构 Runtime、Session、Sandbox 和 UI。

### 阶段 0：固定基线并建立真实场景骨架

1. 从 `m6-baseline` 创建后续开发分支；
2. 运行现有确定性门禁和 bubblewrap E2E，记录基线；
3. 建立 `tests/scenarios/` 任务包规范与 runner；
4. 先加入“项目 Bug 排查”和“网页游戏”两个场景；
5. 暂时不能通过时保存失败分类和完整 trace，禁止降低验收要求换取绿灯。

### 阶段 1：修正状态与中断语义

1. 实现 `tool.cancelled`；
2. 区分 `cancelled`、`outcome_unknown` 和 `abandoned`；
3. 补用户取消、超时、进程崩溃和存储失败矩阵；
4. 实现 edit revision 对账和模型可见合成 ToolResult；
5. 在真实 Bug 排查场景中注入中断并验证续跑。

### 阶段 2：补齐 Artifact 和长任务持久化

1. 确定 Artifact schema、配额、保留和 GC；
2. 保存完整 patch、截断输出和测试报告；
3. 增加模型输出 segment 批量写入和 flush barrier；
4. 建立 Session → Model/Web/Audit Projection；
5. 用网页游戏验证多轮工具调用、重启后历史恢复和最终 Manifest。

### 阶段 3：重构 Sandbox/Approval 并完善工具

1. 拆分 `sandbox_mode` 与 `approval_policy`；
2. 实现显式外部挂载 grant；
3. 把审批从工具名升级为风险和目标绑定指纹；
4. 补破坏性 Git、文件删除、进程操作和敏感文件策略；
5. 统一 Tool effect/recovery/artifact 协议；
6. 用前端素材库或 3D 场景验证外部 SDK/工具和未授权路径隔离。

### 阶段 4：性能优化与外部扩展

1. 建立大型仓库、长轨迹和并发 Session benchmark；
2. 优化 Session 批量写、Reducer、Context Selection 和 Workspace 增量索引；
3. 实现最小必要 Port，不引入完整插件平台；
4. 接入至少一个外部代码分析器和一个算法/仿真/渲染工具；
5. 用引擎算法优化场景证明“测量—修改—回归—报告”闭环。

### 阶段 5：大型代码库实战与多 Agent 准备

1. 选择可重复获取、依赖可固定的真实大型仓库；
2. 执行 Bug 修复、跨模块功能和性能优化任务；
3. 记录多小时运行、人工纠偏、中断恢复和 Artifact 成本；
4. 单 Agent 稳定后再引入 Durable Inbox、独立 worktree/overlay 和子 Agent；
5. 多 Agent 先用于并行只读研究或隔离实现，不允许直接并发写同一 Workspace。

---

## 6. 后续 Agent 的执行规则

1. 先确认当前提交继承 `m6-baseline`，并检查工作树；不得覆盖用户改动。
2. 一次只做一个条目：先写失败测试，再改最小代码，再运行相关测试和完整门禁。
3. 以代码和可执行测试为当前事实；文档冲突时记录差异，不凭文档猜实现。
4. 除非条目明确要求，不更换 Session 模型、不删除提交屏障、不绕过 Reducer 和权限链。
5. 副作用前后的事件、flush 和恢复顺序必须由故障注入测试证明。
6. 无法判断副作用结果时记录 `outcome_unknown` 并停止自动重试。
7. 每个模块修改说明改善哪个真实场景，并同步更新该场景验收。
8. 性能结论必须保存相同输入下的修改前后数据，不能仅凭代码结构判断。
9. 修改事件、状态、Tool、Sandbox 或持久化协议时，同步更新 ADR、接口、数据流和测试文档。
10. 缺少凭据、浏览器、容器能力或大型仓库证据时标记 pending/blocked，不得用 mock 冒充真实门禁。

每个条目的交付格式：

```text
目标：本次只解决什么
基线：分支、提交、工作树状态
现状证据：源码、测试或失败记录
设计：事件顺序、数据契约、安全边界
改动：文件与职责
测试：L0/L1，以及绑定的 L2/L3 场景
结果：通过、失败、阻塞和实验数据
文档：同步更新位置
后续：明确不在本次范围内的工作
```

---

## 7. 当前第一个可执行任务

> 基于 `m6-baseline` 建立真实业务场景任务包骨架，同时实现并验证“正常取消保存 `tool.cancelled`，异常中断保存 `tool.outcome_unknown`”的最小状态矩阵。

这项工作修复最高优先级状态语义，同时建立以后所有架构改动的真实验收入口。完成后再进入 Artifact Store、Session Projection 和 Sandbox 权限模式重构。
