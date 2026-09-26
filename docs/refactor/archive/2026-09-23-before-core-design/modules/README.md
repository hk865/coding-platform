# 模块文档索引（第三阶段产物）

```yaml
status: draft-for-review
updated: 2026-09-22
依据: docs/refactor/ARCHITECTURE.md（2026-09-21）§2 Module Registry / §3 ModuleDependencyDAG / §7.1 接口演进
上位产物: docs/refactor/ARCHITECTURE.md（Prompt 2）；本目录为 Prompt 3 产物
落点: docs/refactor/modules/（仓库权威版由 Prompt 7 按维护流程回填 my-coding-platform-docs/agent_platform/dev_docs/modules/）
篇数: 13 个 Module（control 6／data 5／execution 1／interaction 1）
```

> 本目录是**本轮重构稿**，不是仓库权威版。分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状以 `my-coding-platform-docs/agent_platform/human/module-status.md` 为准。每篇模块文档只写**本模块的局部设计与跨模块契约**，跨模块重复承载的部分见 [`ownership-map.md`](ownership-map.md)。

本次修订落实代码规范、重构目标、接口清晰和职责／功能清晰四类要求：以架构中的 13 个 Module 为基础，分别写清现有入口、目标变化、内部共用逻辑和旧路径去向，并在各篇 §9 给出目标与验收证据。设计描述不表示源码已经完成；源码与旧状态页不一致时，记录实际调用证据，不把旧状态标签作为新的实现证明。

**共同规范**：[代码规范、重构目标与质量验收](../CODE-QUALITY-GUIDELINES.md)。CQ-01～CQ-12 规定实现和审查要求，RG-01～RG-06 规定应达到的重构结果。各模块引用适用编号并给出自己的具体要求，不复制整套规范。外部来源、既有 R2 数值标准与采用边界见 [调研报告](../CODE-QUALITY-RESEARCH.md)。

### 接口与重构内容的统一读法

- **§2 提供接口**：本模块向谁提供什么能力，以“调用者 + 输入 → 输出”表达方向。现状与目标分别标注；候选名用于 Prompt 4 引用，尚未冻结名称和 wire schema。
- **§2 内部映射**：实现类、内部 helper 和存储 Adapter 用来说明如何承载能力。源码导出不自动等于新的公共业务端口；已有真实调用方的入口不能未经迁移直接删掉。
- **§3／§4**：分别说明本模块消费谁、谁消费本模块。消费接口不混入提供面。Host 注入不消除模块间的逻辑依赖。
- **§1 内部责任与 §7 变化方向**：共用什么、保留哪些业务差异、旧副本改走哪里。拆文件不增加 Module，共用纯函数也不自动改变业务 owner。
- **§8**：未冻结的字段、迁移步骤和真实能力接线保留为缺口；它们不能被【代码】标签掩盖。
- **§9 重构目标与质量验收**：按“当前问题／依据 → 本次目标及边界 → 共同实现与旧路径去向 → 验收证据”串起本模块的重构工作；文档要求已纳入，源码结果待验证。此章承接用户本轮新增要求，不改变 §7 供 Prompt 4 提取接口变化方向的用途。

共用实现的 owner、消费者和旧路径去向集中见 [ownership-map §13](ownership-map.md#13-共用实现与旧路径去向)。涉及共享路径政策的架构选择见 [§14](ownership-map.md#14-尚待确定的共享边界)，本轮不擅自加边。模块／边数是当前设计的一致性检查，不是优化指标；若后续有证据需要调整，先同步上位架构与接口设计，不能为守数字保留无必要依赖。

### 每篇文档的章节分工

| 章 | 回答的问题 |
| --- | --- |
| 1. 职责 | 模块做什么、不做什么，内部由哪些责任单元承接功能与副作用。 |
| 2. 对外接口 | 谁提供、谁调用，输入输出、失败、约束、现状与目标怎样区分。 |
| 3. 依赖 | 本模块消费谁的哪个接口、为了什么。 |
| 4. 被依赖 | 哪些模块或宿主消费本模块的哪个能力。 |
| 5. 状态归属 | 对象与状态由谁拥有、谁写，哪些只是引用或投影。 |
| 6. 旧标识去向 | 旧身份、兼容映射与迁移责任落在哪里。 |
| 7. 本次接口变化方向 | I 编号和一句话演进方向，继续作为 Prompt 4 的交接输入。 |
| 8. 信息缺口 | 尚未确定的协议、共享归属和实现前提由何处解决。 |
| 9. 重构目标与质量验收 | 为什么改、要改善到什么程度、怎样共用与退出旧路径、用什么证据验收。 |

原 §1～§8 保持职责，第 9 章是此次确认需求的补充。索引负责导航，共同规范负责 CQ／RG，ownership-map 负责跨模块 owner，模块页负责专项要求；不另造一份重复的实现状态账本。

---

## 1. 模块清单（13）

| Plane | Module | 文档 | 一句话职责 | 代码目录 | 契约状态 |
| --- | --- | --- | --- | --- | --- |
| Human Interaction | **HumanCollaboration** | [interaction/human-collaboration.md](interaction/human-collaboration.md) | 面向人的统一入口：目标／决定／查询／架构协商与接管**读**侧 | `coding-platform/src/interaction/human-collaboration/` | first-slice draft |
| Control | **PlanCompiler** | [control/plan-compiler.md](control/plan-compiler.md) | 有界协调：初始协调、人工计划、修订提案、机械返工提案 | `coding-platform/src/control/plan-compiler/` | extension draft |
| Control | **ControlEngine** | [control/control-engine.md](control/control-engine.md) | 唯一的状态推进者与守卫：授权／CAS／幂等／归约／治理激活 | `coding-platform/src/control/control-engine/` | first-slice draft（扩展面极宽） |
| Control | **DispatchEngine** | [control/dispatch-engine.md](control/dispatch-engine.md) | 派发与运行准入：outbox 执行、准备与 claim 顺序、租约、运行事实对账 | `coding-platform/src/control/dispatch-engine/` | extension draft |
| Control | **VerificationEngine** | [control/verification-engine.md](control/verification-engine.md) | 验证编排：检查生命周期、Evidence 受理、Reviewer 工作、探索报告资格 | `coding-platform/src/control/verification-engine/` | planned |
| Control | **ArchitectureReconciler** | [control/architecture-reconciler.md](control/architecture-reconciler.md) | 架构对账：图差分 → Finding／Brief → 候选物化 | `coding-platform/src/control/architecture-reconciler/` | planned |
| Control | **AgentLifecycle**（新增） | [control/agent-lifecycle.md](control/agent-lifecycle.md) | Agent/Session 生命周期**决策与提案**：复用／产生／拆解／压缩／归档／重新启用；决定用哪个角色配置、创建／解析哪条 Session、关联哪些必要任务 | 规划 `coding-platform/src/control/agent-lifecycle/`（**当前无目录、无契约**） | **【设计新增】proposed** |
| Execution | **WorkerRuntime** | [execution/worker-runtime.md](execution/worker-runtime.md) | 一次真实内核运行：启动、取消、能力探测、公开观察与快照 | `coding-platform/src/execution/worker-runtime/` | extension draft |
| Data | **StateLedger** | [data/state-ledger.md](data/state-ledger.md) | 原子提交 snapshot + Event；CAS、幂等、事件页 | `coding-platform/src/data/state-ledger/` | first-slice draft |
| Data | **ArtifactVault** | [data/artifact-vault.md](data/artifact-vault.md) | 不可变正文持久化与材料授权适用性 | `coding-platform/src/data/artifact-vault/` | planned |
| Data | **ReadModelIndex** | [data/read-model-index.md](data/read-model-index.md) | 从已提交事件重建查询投影（含**任务图**与**架构图查询**） | `coding-platform/src/data/read-model-index/` | first-slice draft |
| Data | **ContextCompiler** | [data/context-compiler.md](data/context-compiler.md) | **五类触发点**的有界选材（边界本稿收缩） | `coding-platform/src/data/context-compiler/` | extension draft |
| Data | **WorkspaceReader** | [data/workspace-reader.md](data/workspace-reader.md) | 路径边界内的源码与原图来源捕获 | `coding-platform/src/data/workspace-reader/` | extension draft |

**计数核对**：control 6（PlanCompiler／ControlEngine／DispatchEngine／VerificationEngine／ArchitectureReconciler／**AgentLifecycle**）、data 5（StateLedger／ArtifactVault／ReadModelIndex／ContextCompiler／WorkspaceReader）、execution 1（WorkerRuntime）、interaction 1（HumanCollaboration）= **13**，与架构稿 §2 Module Registry 逐条一致。

**代码侧归属**：`coding-platform/scripts/module-map.mjs` 的 `owner()` 按**路径前缀**判定，是模块归属的**唯一可判定来源**（手写数组顺序 + `Array.prototype.find` 首次匹配，非最长前缀算法）。`src/contracts/`、`src/app/`、`src/harness/`、`src/composition/`、`src/ui/`、`src/storage/`、`src/fixtures/`、`src/testing/` 是共享面与组合根，**不是 Module**。

---

## 2. 与旧文档的对应关系

| 情况 | 本轮处置 |
| --- | --- |
| 12 个既有 Module | 全部**改版**，落到本目录同 plane 同名文件。每模块都有接口演进工作，不等于每个方法都必须改签名；稳定完成策略、身份与存储语义按架构 §7.1 保留。 |
| 新增 `AgentLifecycle` | **无现行文档**，按同一模板新建（[control/agent-lifecycle.md](control/agent-lifecycle.md)） |
| 被拆解／合并／归档的 Module | **本轮没有**。13 个 Module 中 12 个保留原名原目录、1 个新增，**没有模块被拆解、合并或归档**，因此旧文档位置**不需要**留指向新位置的跳转行 |
| `ContextCompiler` 边界收缩 | 不是模块拆分：仍在原模块与原目录内，收缩的是**职责**（架构稿 §6.2），已在 [data/context-compiler.md](data/context-compiler.md) 的"不负责"中写明 |
| 两张图能力 | 不是新模块：由既有 Module 职责扩展承担（架构稿 §5.1／U2），切分见 [`ownership-map.md`](ownership-map.md) §1 |

> 旧文档（`my-coding-platform-docs/agent_platform/dev_docs/modules/**`）本轮**只读**、**不改动**；按架构稿 §10，回填由 Prompt 7 按维护流程执行。

---

## 3. 跨模块承载总表

[`ownership-map.md`](ownership-map.md) —— 集中写跨模块事实分工，以及**共用实现与旧路径去向**：两张图、生命周期、身份与责任关联、派发入口、记录与材料、角色绑定、唯一判据、共用逻辑、非 Module 的 Host／Contracts／Storage 边界。

**模块文档只写自己那一片并指回架构稿；完整切分读这张总表**（避免同一事实在 13 篇里各写一套而分叉）。

---

## 4. 本次接口变化方向汇总（13 篇的「本次接口变化方向」一行，供 Prompt 4 边表使用）

| Module | 对应项号 | 一句话方向 |
| --- | --- | --- |
| HumanCollaboration | **I11** | 给卡片查询、具体方案解释与人的控制请求提供可引用候选接口；现有 query／决定路径优先复用，受理与执行结果分开 |
| PlanCompiler | **I12** | 新增"材料触发声明"；**解释 ≠ 重新提案**（解释不得再触发一次 `requestInitial`） |
| ControlEngine | **I4**（＋I5 归约侧、I9 治理侧） | 命令面必须明确选择**命名命令端口**还是**统一命令入口**；不得由生成模型自行补一条命令总线；新增生命周期 commitKind 与事件类型由它归约后交 StateLedger |
| DispatchEngine | **I2**（＋I9 签发侧） | `drive` 结果包含角色配置／Session 复用决策与**推荐范围**；trigger 语义扩展；**并声明多入口的收敛方式**（C-13） |
| VerificationEngine | **I7** | 绑定 Agent/Session 与来源，审查按 L3 引用取材；共用检查准备/执行，保留单项检查与轮次恢复/聚合差异 |
| ArchitectureReconciler | **I10** | baseline 演进后**重新定义"漂移"判据**；接入真实图来源与产品 inspect 入口；**首次建立与后续演进分两条路径** |
| **AgentLifecycle** | **新增模块，无既有接口可改**（§7.1 注） | 新增候选接口 `decide(request)`／`propose(action)`，并**补齐候选结果集**；对应 §3 的 4 条新增边 |
| WorkerRuntime | **I3** | 增加 Session 能力适配且如实声明；共用受限调用/结构检查，分开环境准备与结果适配，迁移 Kernel 原始正文副本 |
| StateLedger | **I5** | **新增 commitKind 与事件类型**（Agent/Session 生命周期、复用、压缩、归档） |
| ArtifactVault | **I8**（＋A6） | Work/Session 记录**正文 body-first 持久化**（扩展 owner 与范围）；复用时的授权复核沿用既有 `MaterialAccessGrantV1` 判定 |
| ReadModelIndex | **I6** | 新增卡片/图/协作查询；内存与 SQLite 共用领域投影规则，存储/游标由各 Adapter 承担；既有 `ActiveAgentView` 仍按 `(project,goal,task)` 查询 |
| ContextCompiler | **I1**（＋I9 消费侧） | 输入增加**触发原因**与**增量基线**；输出增加**复用／增量**语义；新增**稳定前缀 vs 动态尾部**分离契约；选人／调度／正式状态归约**移出** |
| WorkspaceReader | **I-补** | **一次不可变捕获对应多页读取**；变更检测失败时显式重试／标 `stale`；能力差异与允许的 Kernel 边显式登记 |

**边动作汇总**（Prompt 4 用）：**新增 4 条边** —— `DispatchEngine → AgentLifecycle`，以及 `AgentLifecycle → ControlEngine / StateLedger / ReadModelIndex`；**语义切断 2 类** —— ContextCompiler 的"每次 compile 全量取料"与其"选人／调度／正式状态归约"；**明确不新增** —— 无 `WorkerRuntime → ControlEngine` 边、无 `ContextCompiler → 角色目录/AgentLifecycle` 边、无图模块边。**38 条 = 34 条既有（保留）+ 4 条新增**，边数不是目标（已无必要的边应当删除）。

---

## 5. 信息缺口清单

### 5.1 与架构稿 §11.4.3 对齐（**引用，不重新推导**）

架构稿 §11.4.3 的结论是：**没有仍待用户拍板的产品决定**，剩余项全部是**接口设计参数或实现前提**，由 §9.2 的四份契约内容确定。下列七类**不是新缺口**，各模块文档按适用性引用：

| # | §11.4.3 剩余项 | 类别 | 由谁／在哪定 | 涉及本目录的模块 |
| --- | --- | --- | --- | --- |
| ① | 持久字段、主键与基数约束（Session 承载形态、Agent 实例标识、旧标识兼容映射） | 接口参数 | §9.2 第 1 份契约（对象与关系表） | AgentLifecycle、ControlEngine、StateLedger、ReadModelIndex、ArtifactVault |
| ② | 各 Port 的精确形状、字段命名、装配点（含 Kernel 适配面"创建／打开、消息、执行、控制、状态、增量事件"的具体划分） | 接口参数 | §9.2 第 2／4 份契约 | WorkerRuntime、ContextCompiler、DispatchEngine、ControlEngine、ArtifactVault |
| ③ | 工作卡片与三种记录的查询接口、筛选字段 | 接口参数 | §9.2 第 3 份契约 | ReadModelIndex、HumanCollaboration、ContextCompiler |
| ④ | 迁移切换点、删除顺序与回滚方式（含普通／Reviewer／Handoff 调用点） | 接口参数 | §9.2 第 4 份契约；重构计划（Prompt 6） | DispatchEngine、VerificationEngine、WorkspaceReader |
| ⑤ | 草案承载形态与转换门禁判定者；探索计划的 UI 入口是否开 | 接口参数 | §9.2 第 1／4 份契约 | ArchitectureReconciler、HumanCollaboration |
| ⑥ | 度量口径的具体采集实现（前缀度量、扫描次数） | 实现参数 | 按 U12 指标表；**标为"待测"，不得以文件数证明收益** | ContextCompiler、ReadModelIndex |
| ⑦ | 生产 `lifecycleControl`／continuation 能力开关的放开与 Kernel 接线验证 | 实现前提 | §11.4.2 第一行；真实连续任务验收 | WorkerRuntime、DispatchEngine、AgentLifecycle |

### 5.2 本轮模块文档**确实新增**的缺口（§11.4.3 未覆盖）

以下 **8 条**是写模块文档时发现的、§11.4.3 的七类**没有覆盖**的缺口。已逐条核实来源，**未在模块文档中替它们编造结论**。

| # | 缺口 | 事实与出处 | 涉及模块 | 建议处置 |
| --- | --- | --- | --- | --- |
| N-1 | **`CONTEXT.md` 的 `AgentInstance` 词条与本轮口径漂移** | 词典定义 `AgentInstance` = "具有**能力描述和连续身份**的逻辑执行者"（`CONTEXT.md:51`）；而本轮 §4.5（A1／U11）定为"Agent ≈ **运行实例／通信参与者的轻量标识**，**不默认要求跨任务持久主体**"。C-6 只登记了 `Session`／`Run`／`Skill`／`Prompt`／`架构图`／`任务图`／`产品图` 的**缺词条**，**没有登记这条既有词条的口径冲突** | ControlEngine、AgentLifecycle、HumanCollaboration、ReadModelIndex | **维护工作**：词条层同步（C-6 的同类工作），本阶段不改 `CONTEXT.md` |
| N-2 | **`paused` 的 canonical 承载没有唯一落点** | §4.6 说四态"由 **Session 元数据与工作卡片**用**现有记录与查询生成**"；§4.1 阶段 4 说平台"**停止新派发** + 把**控制请求交 Kernel**"并接收成功／失败。但"**暂停成功**"这一事实**由谁归约成哪条 canonical 记录**（`ControlIntentReconciled`？Run 状态？Kernel 回报？）架构文档**没有唯一落点**。§11.4.3 第 ③ 项只覆盖"查询接口与筛选字段"，未覆盖归属 | ControlEngine、StateLedger、ReadModelIndex、WorkerRuntime、AgentLifecycle | **接口参数**：并入 §9.2 第 1／3 份契约（对象与关系表 ＋ 卡片查询），需在接口设计时定 |
| N-3 | **`AgentLifecycle` 的候选结果集不完整，且 `decide`／`propose` 之间的协议未定** | §2 自认"**候选结果集不完整**"：还须表达**没有可复用 Session 时如何创建、复用范围作为推荐线索如何交给 ContextCompiler、何时只读分叉、返回 `needs_material` 后由谁解除等待**，并定义与 `propose(action)` 之间的协议。这是**设计缺口**，不只是 §11.4.3 第 ② 项的"字段命名" | AgentLifecycle、DispatchEngine、ContextCompiler | **接口设计**：§9.2 第 2／3 份契约；本阶段按候选写并标注 |
| N-4 | **`runtime-collaboration.md` 无"`WorkerRuntime` 不得依赖 `ControlEngine`"的字面禁止条款** | §6.3 明确"**没有 `WorkerRuntime → ControlEngine` 的边**"，§3.1 也写了该边随准入要求一并撤回；但接口契约里**没有对应条款**（契约中只有 `ArtifactVault`"不依赖 ControlEngine"、`ContextCompiler`"不依赖 PlanCompiler／DispatchEngine"这类表述） | WorkerRuntime、ControlEngine | **维护工作**：在接口契约补写该禁止条款，使其可被独立核对 |
| N-5 | **`state-ledger.md` 接口契约缺 `P1-07` 六个 commitKind 的逐项名称** | 契约只写"新增**六个** commitKind"（`dev_docs/interfaces/state-ledger.md:211`），未列名称；名称实际存在于现行**模块**文档（`workspace-read-lease-acquire`／`release`、`workspace-write-lease-acquire`／`release`、`integration-record`、`patch-record`）。**I5 的新增 commitKind 要求以完整清单为基线**，契约侧缺基线 | StateLedger | **维护工作**：接口契约补齐清单 |
| N-6 | **`GoalPhaseSnapshot.phase` 的"§9 封闭 10 值"在契约中未枚举** | `dev_docs/interfaces/state-ledger.md:198` 写"`GoalPhaseSnapshot` 记录 phase（**§9 封闭 10 值**）"，但该文件**没有列出这 10 个值** | StateLedger、ControlEngine、ReadModelIndex | **维护工作**：补齐枚举（或明确指向权威处） |
| N-7 | **`module-status.md` 没有逐模块的状态标签体系** | 该文件对 12 Module**未使用** implemented／partial／contract-only／unsupported 这套分类，实际用的是"已接／已消费 vs 未接／仍缺"的散文表述；显式出现 `unsupported` 的只有 `MigrationGatePort` 与 WorkerRuntime 的暂停／继续／steer／快照两处。因此模块文档**无法引用统一状态标签**，只能用架构稿 §2 的 `契约状态` 列 ＋ 【代码】／【契约未接】／【设计新增】标记 | 全部 13 篇 | **维护工作**：若要机器可读的状态标签，需先在 `module-status.md` 建立口径 |
| N-8 | **`PlanRevisionDraft` 的归属文档与源码不一致** | `module-boundaries.md` 写"计划变更提案与规划 Context 的公开形状统一位于 `contracts/planning.ts`"；但**类型本体定义在 `src/contracts/plan.ts`**，`goal-change.ts:1` 与 `initial-planning.ts:1` 都从 `./plan.js` 导入；`contracts/planning.ts` 暴露的是规划**公开形状**（`PlanCompilerPort`／`PlanningMaterialPort`／`PlanningContextPort`／`PlanningTaskWorkMaterial`／`PlanningContextRejectionCode` 等）。**模块文档已按源码写准**（`control/plan-compiler.md` 采用"类型在 `contracts/plan.ts`、规划公开形状经 `contracts/planning.ts`"的写法） | PlanCompiler、DispatchEngine、HumanCollaboration | **维护工作**：接口文档的归属表述与源码对齐（按 `document-ownership.md`，冲突由 Agent 记录并提出修订） |

**未登记的候选（说明理由）**：§7.1 提到的"契约中无名为 `WorkerRuntime`／`ContextCompiler` 的接口"已由 **C-9** 登记为迁移工作，故不重复列为新缺口；`control-engine/policies/**` 被跨模块直接 import 已由 **C-10** 登记；"唯一派发入口与源码不一致"已由 **C-13** 登记；检查器盲区已由 **C-14** 登记。

---

## 6. 阅读顺序建议

1. 先读 `docs/refactor/ARCHITECTURE.md` §1–§3（Plane／Module Registry／DAG）与 §4（生命周期专章）、§5（两张图专章）、§7（接口演进）。
2. 再读本目录 [`ownership-map.md`](ownership-map.md)，建立"同一事实落在哪个模块"的整体印象。
3. 阅读 [共同规范](../CODE-QUALITY-GUIDELINES.md)：先看 §7 的 RG 目标，再看 §2 的 CQ 规则；既有 R2 长度指标保留原评估口径，外部工具默认值不自动成为项目门禁。
4. 按需读具体模块文档：**改接口读 §2 提供接口 ＋ §7 变化方向**；**判断职责和复用读 §1 ＋ ownership-map §13**；**查依赖读 §3／§4**；**查状态与旧标识读 §5／§6**；**安排重构与验收读 §9，未决条件回看 §8**。
5. 实现现状回到 `my-coding-platform-docs/agent_platform/human/module-status.md` 及当前源码核对，**不要从本目录推断某能力已实现**。

---

## 7. 本目录的验证状态与后续阶段

| 项 | 状态 |
| --- | --- |
| 13 篇齐全（含新增 `agent-lifecycle`） | ✅ 与架构稿 §2 Module Registry 逐条一致 |
| 每篇五要素齐全 | ✅ 职责／对外接口／依赖／被依赖／状态归属 齐全，"不负责什么"与"状态归属"均已写到 |
| 每篇另有「旧标识去向」独立一节 | ✅ 13 篇均有；不持有旧标识的模块也明确写出并给理由 |
| 对外接口写到"接口名 + 方向 + 传递内容" | 按提供面、调用者、输入输出整理；内部实现与消费面分列。目标候选可供 Prompt 4 引用，精确协议尚需后续冻结。 |
| 依赖／被依赖写到**接口** | ✅ 依赖侧覆盖 38 条逻辑边（`allowedModuleDependencies` 现有 34 条 ＋ 本次新增 4 条；后 4 条尚未写入该表，见 `agent-lifecycle.md` §8）；被依赖侧覆盖全部反向边；宿主／UI 调用单列并注明不计入 38 条 |
| **机械核对范围** | 校验 13 Module、架构与模块正反表的 38 条边及无环性；源码仍是迁移前的 12 Module/34 边。结构一致不证明端口已装配、共享逻辑已去重或目标功能已实现。 |
| 每篇给出「本次接口变化方向」一行 | 13 篇逐行核对接口与变化方向、边动作、理由和不变量编号；“理由／不变量”保留在交接行内，段外补充不能代替。见 §4 汇总表及各篇 §7。 |
| **不含已被本轮撤回的要求** | ✅ 已按撤回清单逐条排除（跨任务持久主体、单活跃工作线、身份登记必经仪式、逐条材料授权、每轮继承历史复核、四态强塞 `AgentInstanceStatus`、通用副作用对账／自动接管、新增 `WorkerRuntime → ControlEngine` 边、最小闭环验收、草案治理平台等） |
| 信息缺口清单与 §11.4.3 对齐 | ✅ 见 §5.1（引用）与 §5.2（**新增 8 条**，均已核实来源） |
| 共用实现与减负 | 模块内部责任和总表给出 owner、保留差异、旧路径去向；属于目标设计，不能据此宣称已删除代码或取得性能收益。 |
| 代码规范与重构目标落实 | 13 篇均以 §9 承接具体目标、共同实现／旧路径去向、适用 RG／CQ 与验收场景；共同规范集中维护。这里只确认设计要求齐全，源码达成、真实接线与成本收益尚待证据。 |
| 本阶段**未做**的事 | 未改架构、产品、旧文档仓或源码；未冻结完整 schema；未运行产品测试或给工作量/金额估算。 |

**交给 Prompt 4**：从 §2 的提供接口、§3/§4 的调用关系和 §7 的动作提取边表，处理 [`ownership-map.md`](ownership-map.md) §14 的共享边界候选，并核对 §9 的接口与功能保真要求。**交给 Prompt 6**：依据各模块 §9 与 [`ownership-map.md`](ownership-map.md) §13 将目标分解为旧副本/入口迁移步骤，给兼容与回滚、消费者验证和成本测量。不能把新增包装层可运行当作去冗余完成。


**2026-09-22 修订核对**：13 篇模块稿及本索引、分工总表已修订。分组初稿经过交叉复核与主审迭代；核查了实际调用者、已有 Port/方法、返回形状、目标能力标签和旧路径去向，修正了快照契约重复设计、工作区能力 owner、生命周期提案方向、Runtime 对账形状及多处真实消费面遗漏。结构检查结果为 13 模块、38 条正向边、38 条反向边，与架构一致且无环；Markdown 文件链接与表格列数检查通过。范围外文档与源码保持原样。

本轮形成的是可继续开展 Prompt 4 的模块设计输入：候选接口与共享实现有明确归属，但完整协议、迁移步骤和性能收益仍需后续设计与实现验证。路径拒绝政策的跨模块共享位置、I4 命令面形态及生产 Kernel 接线等未决项继续显式保留。

**同日质量要求落地**：在前述接口修订基础上，统一补入第 9 章，并按模块核对 §1 内部分责和 §2 接口表达；共同规范增加 6 项重构结果要求，与 12 项质量规则关联。13 篇共形成 42 项模块专项要求，经过分组编辑、交叉审阅及主审修正；补清了 Runtime／Dispatch 责任、快照适配、旧路径存在性和架构章节引用。机械核对通过：13 篇均有 9 章、38 条正反依赖与架构一致且无环、依赖／状态章节和接口交接行语义保持，109 个本地文件引用及表格列数有效。范围限于本轮模块文档、索引及共用说明，不代表已完成源码重构或回填旧文档仓。
