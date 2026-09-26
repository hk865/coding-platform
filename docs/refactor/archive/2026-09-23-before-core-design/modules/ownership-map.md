# 模块承载总表（跨模块职责的落点）

```yaml
status: draft-for-review
updated: 2026-09-22
依据: docs/refactor/ARCHITECTURE.md（2026-09-21）
作用: 把"同一事实被多个 Module 共同承载"的切分写在一处，供各模块文档链接；模块文档只写自己那一片
```

> **权威关系**：本表是**导航与一致性对照**，不是新的规范来源。分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状以 `my-coding-platform-docs/agent_platform/human/module-status.md` 为准。本表与两者冲突时，以它们为准并登记修订。
>
> **为什么需要这张表**：两张图、生命周期、复用决策、关联读写等事实天然横跨 4–7 个 Module。若每个模块文档各写一套完整叙述，同一事实会产生多份副本并在后续维护中分叉（`document-ownership.md`：「不为两类读者复制两套事实」）。因此：**模块文档写本模块那一片并指回架构稿；完整切分读本表。**

---

## 1. 两张图（架构图／任务图）

| 环节 | 承载模块 | 承担什么 | 明确不承担 |
| --- | --- | --- | --- |
| 原生来源捕获 | **WorkspaceReader** | `ArchitectureSourceCapturePort`（`architecture-source.ts`）捕获源码与原图来源；路径边界、来源 pin、语言能力差异 | 不编译图正文、不保存 Vault、不查 Ledger；**不反向调用 Vault** |
| 图正文与来源绑定 | **ContextCompiler** | `SourceGraphContextCompiler`／`source-graph-context.ts`：校验 reader Run／Plan pin／Workspace 版本、把图正文保存 Vault、保留旧 `WorkspaceReadPort` 返回形状 | 不做结构差分、不裁决漂移 |
| 结构差分与候选 | **ArchitectureReconciler** | 图差分 → `ArchitectureFinding`／Brief → 候选物化；`sourceBinding`、`structuralKey`、风险分档 | **不激活 baseline**；不把目录名猜作产品 Module；不把静态 imports 称为运行时调用图 |
| 结构归约与关联写入 | **ControlEngine** | 已接受的模块／接口／依赖经治理（`ArchitectureBaseline`，不可改写 + CAS 激活）；**"谁负责哪个模块、当前关联哪些 Session"按普通记录路径落账**（日常事实，**不进 install／activate 审批**） | 不自造结构、不自行选人 |
| 图正文承载 | **ArtifactVault** | 图结构与关联正文的不可变持久化（`bodyRef` 引用） | 不判定正文业务结论 |
| 图查询与关联读取 | **ReadModelIndex** | 架构图查询视图（**规划中**）＋任务图查询（`planGraph` 已存在）＋**任务图内的协作边投影**（消费 `CoordinationIssue`／`MailboxViewV1`／`communication-view.ts` 的既有事实，与阻塞依赖 DAG 分开、允许往返）＋关联读取 | 图不是可丢弃投影；查询视图不得成为第二权威（不变量 #20／#21）；**协作边不并入依赖 DAG**，不制造依赖环 |
| 图检索的读侧入口 | **HumanCollaboration** | 既有直连的图检索／邻域查询／白板读取；统一侧栏读侧（D-6） | **不经 ContextCompiler**；不分析 trace |

### 1.1 任务图单独一条链（与架构图不同源）

`人提出需求` → **PlanCompiler** 生成候选计划（初始协调 `requestInitial`，交付候选与具体方案版本） → **HumanCollaboration 收「绑定方案引用与版本」的确认**（人的确认是**唯一生效点**） → **ControlEngine 核对确认与候选一致**后接受为 `PlanRevision`（结构权威） → **ReadModelIndex** 投影任务图（`planGraph`）。

- **确认守卫**：**未确认**、以及**确认后版本已变化**，都不能直接应用——内部或外部的候选必须重新取得绑定当前版本的确认（`docs/PRODUCT.md` §5.1 第 5 步「人确认——唯一生效点」；架构稿 §5.2「方案在人确认之前只是方案」）。
- 权威：**不变量 #23** —— 任务图的权威是 `PlanRevision` 与已提交状态；任务图承载编排结果与状态，**不替代编排决策本身**，也**不给它单独立模块**（否则会把"投影"升级成"真相源"，与 #4／#5 冲突）。
- 缺口：任务图目前只有"状态 + 层级"，**没有"这件事动的是哪个模块"这一维度**，因此退化成 `TodoView`；`Task → moduleId` 见 §6。
- 缺口：**Agent 间协作关系**尚未进入任务图——`CoordinationIssue`、`MailboxViewV1`、`communication-view` 契约已存在，需要的是**投影与展示**（协作边，与阻塞依赖 DAG 分开、允许往返），不是新机制（§5.2 缺口②；见 §1 末行与 §8.1）。

### 1.2 两类索引必须分开（§5.3）

| 索引 | 承担什么 | 检索 |
| --- | --- | --- |
| **agent 的索引** | 哪个 agent 负责哪个模块、它对哪个模块有认识 | 角色咨询：按模块路由到 agent，直接问它 |
| **事实的索引** | 事实落在哪个模块、来自哪次状态或哪段历史 | 状态／记忆查询：按模块与版本取回事实与校验结果 |

静态搜索（`rg`／文件读取）**不强制归属这两类**：它直接面向当前文件，架构图只提供**路径范围与候选模块**。

---

## 2. 生命周期五阶段（§4.1）的承载切分

| 阶段 | 决策 | 执行 | 正式登记／归约 | 持久与投影 |
| --- | --- | --- | --- | --- |
| **1 创建** | **AgentLifecycle**（用哪个角色配置、创建还是复用哪条 Session、关联哪些必要任务） | **DispatchEngine**（在派发收口落实 Session 创建／打开与配置、任务关联，并启动执行） | **ControlEngine**（需要时才归约 `registerAgentInstance`／`startWorkParticipation` 一类命令；受理 Dispatch 按矩阵 pin 生成的绑定，签发调用见 §9） | **StateLedger**（原子提交）／**ReadModelIndex**（工作卡片视图）／**WorkerRuntime**（`RuntimeRecord`） |
| **2 初始化＝项目认知初始化** | — | **DispatchEngine** 派发只读探索运行 → **WorkerRuntime** 执行探索 → **ArchitectureReconciler** 形成候选结构 → **ContextCompiler** 必要材料编译 | **ControlEngine** 接受候选并落正式状态 | **ArtifactVault**（正文）／**ReadModelIndex**（投影） |
| **3 运行** | **AgentLifecycle**（运行中不介入，除容量决策） | **DispatchEngine**（唯一 `drive` 目标口径 + 顺序）／**WorkerRuntime**（承载执行与公开观察） | **ControlEngine**（状态归约与租约权威） | **StateLedger**／**ContextCompiler**（材料） |
| **4 挂起·恢复** | **AgentLifecycle**（恢复哪条 Session 的决策与提案） | **DispatchEngine**（恢复入口与后继 Run）／**WorkerRuntime**（能力探测与适配，如实公开 `restored_original`／`took_over`／`unsupported`／`rejected`） | **ControlEngine**（控制请求归约与自身状态同步） | **ContextCompiler**（恢复触发的选材）／**StateLedger**／**ArtifactVault** |
| **5 销毁＝归档** | **AgentLifecycle**（归档提案） | — | **ControlEngine**（归约；**不删除**任何模块或图节点） | **StateLedger**／**ArtifactVault**（保留记录与产物）／**ReadModelIndex**（投影随之更新） |

**阶段 3 的边界**：`WorkerRuntime` 不编排、不规划、不归约；**租约持有者是 Run 而不是 Agent**（`TaskLeaseSnapshot.holderRunId`）；MSG 类普通消息**不是** `RuntimeExecutionDAG` 的阻塞边。

**阶段 4 的边界**：平台只处理**自己拥有的**状态；Kernel 拥有会话日志、检查点、压缩与恢复（`Kernel 持有的不进平台`）；平台**不承诺同会话热恢复**，**不建设第二套执行恢复系统**。

---

## 3. 生命周期四动作（§4.2）的承载切分

| 动作 | 决策／提案 | 执行 | 归约／登记 |
| --- | --- | --- | --- |
| **产生** | **AgentLifecycle** | **DispatchEngine**（按矩阵 pin 签发绑定并启动执行） | **ControlEngine**（**需要时**才归约 `registerAgentInstance`／`startWorkParticipation`） |
| **拆解** | **PlanCompiler**（工作分解与提案）／**AgentLifecycle**（承担角色与复用决策） | **DispatchEngine**（派发） | **ControlEngine**（受理与义务）；状态＝`PlanRevision` 的任务集与指派／`TaskHierarchy.parentOf`／`RuntimeExecutionDAG` |
| **压缩** | **AgentLifecycle**（在延续／压缩／重组／归档中选择） | **WorkerRuntime／Kernel**（实际执行压缩并如实报告） | **ControlEngine**（接受结果、归约正式状态）；**ArtifactVault**（记录正文）；**ContextCompiler**（**仅在必要时**做初始化或重组） |
| **归档** | **AgentLifecycle**（提案，**携带义务处置依据**：仍有活跃义务／已交接／无义务三种情况） | — （**平台归档不由 Kernel 执行**） | **ControlEngine**（受理时**复核义务处置依据**——存在未完成交接则不能正式归档；归约）；**ArtifactVault**（保留正文）；**ReadModelIndex**（更新投影）；**DispatchEngine 消费正式归档状态以阻止普通派发** |
| **重新启用** | **AgentLifecycle**（决策与提案） | **DispatchEngine**（派发与换手）／**WorkerRuntime**（能力适配） | **ControlEngine**（走既有 handoff／continuation 路径）；**ContextCompiler**（新 Session 接续触发的选材） |

**§4.3 硬约束（对四动作全部生效）**：先落盘再生效；压缩不得把推断写成事实／不得丢弃关键不确定性／**不得把历史授权带入新任务**；**复用不得沿用旧授权**（沿用既有 `MaterialAccessGrantV1`，执行端真实权限不能由 prompt 绕过）；**跨项目复用首版不做**（显式拒绝并说明原因，不静默降级）；**可解释**；不得以"固定常驻 Agent 数量"或新增进程管理器代替需求分析；**连续复用为默认**，成本比较口径是**整个任务的费用与延迟**。

**四种"复用"必须分开**：① 业务复用；② 会话复用；③ 本地制品复用；④ 模型提示词缓存命中。四者有关联，**但不能互相推出**。

**归档的进入条件（`docs/PRODUCT.md` §7.1 动作表）**：**没有未交接的活跃义务**，且近期不再需要参与。三种情况：**仍有活跃义务** → 先办交接；**已交接** → 义务有接收方、处置依据随提案提交；**无义务** → 可直接归档。**归档 ≠ 删除记录**：身份、Session、产物与来源关系保留，读取归档内容不会自动解除归档（#19／§4.6）。

---

## 4. 生命周期四态（§4.6）的承载切分

四态 `working`／`standby`／`paused`／`archived` 描述的是 **Session／工作卡片**，**不是持久 `AgentInstance` 的人格状态**（撤回"把四态强塞进 `AgentInstanceStatus`"）。

| 面 | 承载模块 | 承担什么 |
| --- | --- | --- |
| canonical 归约 | **ControlEngine** | 把命令归约为 Session／工作卡片相关的 canonical 事实（不变量 #1／#3／#16） |
| 原子提交 | **StateLedger** | events／snapshots／幂等回执／outbox intents 原子提交；**不 fold** |
| 正式归档链路的停派 | **DispatchEngine** | **消费正式归档状态以阻止普通派发**（归档对象退出普通调度与默认展示；平台归档**不由 Kernel 执行**，压缩的执行才归 WorkerRuntime／Kernel） |
| 处置方式决策 | **AgentLifecycle** | 在**延续／压缩／重组／归档**中选择（§4.7），**只提案不写** |
| 展示投影 | **ReadModelIndex** | 以**工作卡片**呈现（角色／模型／工具／Skills、当前任务与关联模块、使用哪条 Session 与当前 Run、运行／空闲／暂停／归档、产物与继续入口） |
| 执行态与能力 | **WorkerRuntime** | `RuntimeRecord`、prepared／running／终态、safe-point、`outcome_unknown`；能力**如实**报告 |

**归档语义**：`archived` 退出普通调度与默认展示、**只读保留**；**读取归档内容不会自动解除归档**；解除归档后**必须重新检查权限、工作范围与材料有效性**；归档**不删除**身份、Session、产物与来源关系，**不删除模块或图节点**——图上隐藏的是 **Agent／Session 的活跃关联**，仍存在的代码模块保留，其负责人被归档时显示"**当前无活跃负责人**"。

**候选接口**（属 I4 命令面与 I6 查询面扩展）：`archiveSession(sessionId)`、`archiveAgent(agentId)`、`readArchived(...)`、`unarchiveSession(...)`、`unarchiveAgent(...)`。

---

## 5. 复用决策 vs 取材 vs 派发（三者最容易重叠）

| 环节 | 唯一承载 | 产出 | **不产出／不做** |
| --- | --- | --- | --- |
| 复用决策 | **AgentLifecycle** | 复用决策 + **推荐范围**（用哪个角色配置／哪条 Session、复用哪段工作与哪些来源范围、预算与触发原因）+ 排除理由 | **不产出 `selectedRefs`／`gaps`／manifest**；不取材、不组装 `ContextBundle` |
| 取材与组装 | **ContextCompiler** | `ContextBundle`（稳定前缀 + 动态尾部）＋ manifest（`selectedRefs`／`gaps`／`freshness`）；三态 `ready`／`needs_material`／`rejected` | 不选人、不调度、不归约正式状态；**不启动 Agent** |
| 派发与准入 | **DispatchEngine** | 取复用决策并在派发收口落实 Session 创建／打开与配置、任务关联，启动执行；记录复用决策与其排除理由 | 不自行选人；**不自造身份** |

### 5.1 跨模块工作包的责任安排

| 环节 | 唯一承载 | 产出 | **不产出／不做** |
| --- | --- | --- | --- |
| 责任安排 | **PlanCompiler** | 每个工作单元的**交付 owner**、关联模块、**协作角色**、**结果回流位置**、**负责人替换规则**；**父任务继续承担汇总义务** | 不自行受理、不写 canonical；**不新增治理对象** |
| 正式受理 | **ControlEngine** | 责任关联的正式归约（与任务集／指派同一条受理路径） | 不替规划方选人 |
| 参与／替换建议 | **AgentLifecycle** | 承担角色、复用／替换建议与排除理由 | 不写 canonical、不派发 |
| 展示 | **ReadModelIndex** | 工作卡片／任务图上的责任与协作呈现 | 不作为责任权威（可重建投影） |

**复用范围＝推荐线索，不是硬白名单**：Skill／prompt 指导阅读（先看哪个模块、需要时看哪些提交／diff、设计理由在哪份说明、仍有疑问再查关联 Session 的历史），并推荐材料与检索入口；执行者能用工具自主查找、按需扩大阅读，**不被固定 `selectedRefs` 白名单卡住**。

**保留的两条边界**：① 执行端的真实权限不能由 prompt 绕过（能不能读某目录由 Kernel／工具／沙箱与既有授权规则决定）；② 文档**不同时承诺**"只靠 Skill"与"形式化保证撤权材料永不再次进入模型"。

---

## 6. 标识、关联与归属

### 6.1 标识取舍（§4.5 A5 收口）

| 标识 | 作用 | 首版处置 | 主要承载 |
| --- | --- | --- | --- |
| role／配置引用 | 这次用什么能力与规范 | **保留、可复用**；不是独占主体 | ControlEngine（`RoleSpecRevision` 治理）／StateLedger（持久） |
| `sessionRef` | 消息发往哪里、继续哪段上下文 | **保留**；多 Kernel 时能定位 provider 与原生 Session ID | 平台只保存**引用与映射**（Kernel 拥有正文） |
| `runId` | 区分这一次执行、结果与重试 | **保留**（沿用可满足需求的现有表示） | StateLedger／WorkerRuntime |
| `taskId` | 任务图上做什么、依赖谁、产物属于哪里 | **保留**；有协作、换手或重试时仍须追踪任务 | PlanCompiler／ControlEngine／ReadModelIndex |
| `workId` | 是否存在独立于图节点的一项持续工作 | **不先宣布必需**：若仅重复 `taskId` 就合并；若跨计划／任务仍有明确消费者再保留 | 见 §6.2 |
| `agentId` | 标记运行实例或通信参与者 | **有消费者时保留轻量标识**；不为它扩建跨任务长期身份体系 | 见 §6.2 |

### 6.2 旧标识（AgentInstance／Work）的最小迁移口径（§9.3 + R-1）

**本轮不把"迁移到稳定新主体"当作强制方向。**

| # | 规则 |
| --- | --- |
| 1 | **旧事件语义不变**（既有事件不可原地改变 v1 含义）；旧 Agent／Work 标识**保留可查**，需要时提供兼容映射 |
| 2 | 新运行使用**显式关联**：标识服务收件、运行与记录区分；**不要求**把每条历史工作迁移成"稳定主体" |
| 3 | 需要映射的历史关系**记录来源**（映射本身也是可追溯事实） |
| 4 | 老 Session 缺乏可恢复记录时，**明确只支持查询或有界交接**，不假装可恢复 |
| 5 | **投影能重建**；升级失败仍能继续读取旧数据 |
| 6 | `schemaVersion`、切换点与回滚方式写在**接口／重构计划**中 |
| 7 | **Kernel 原始记录落盘与平台正式状态提交不是同一事务**：先有可定位的 Kernel 结果，再**幂等**接纳为平台事实；**创建请求重试以"不产生两份会话"为幂等判据**；中断按事件 ID／游标对账，副作用未知就核对，**不自动重跑** |

**`AgentInstanceV1.agentInstanceId`**：保留作为平台侧标识（R-1）；**不要求为守旧写法继续由 `(work, run)` 派生**，但**也不把迁移到稳定新主体当作强制方向**。

**`workId` 合并前必须确认**：若 `workId` 正在维系跨 Run 或换手后的连续性，删除时要把该关系移到任务图或等效既有记录，**不能把"删掉 ID 字段"与"去掉开销"直接画等号**。

**`AgentInstanceStatus`**：`"active" | "retired"` 字段存在，但 **`retired`／`retiredAt` 没有任何命令／事件写入**（退役写路径缺失）；**四态不扩写到本字段**。

### 6.3 module ↔ 文件夹 ↔ Agent ↔ session 关联

**今天没有权威，是本轮需要新增的正式事实**（若不落账，图就真的成了可丢弃投影）。

| 面 | 承载 | 约束 |
| --- | --- | --- |
| 结构（已接受的模块／接口／依赖） | **ArchitectureBaseline**（治理） | 不可改写、CAS 激活（不变量 #13）；显式映射 `ArchitectureSourceMapping = {id, kind:'module'\|'interface', paths}`；契约原话：*"Explicit, versioned mapping; a directory name is not implicitly a product Module."* |
| 关联（谁负责哪个模块、当前关联哪些 Session） | **写入**：ControlEngine 既有协调／记录命令族；**读取**：ReadModelIndex 图查询视图 | **日常事实，不进 install／activate 审批**；用现有记录与查询生成"工作卡片"式展示；**不新增"身份治理聚合"** |

### 6.4 `Task → moduleId`（U4 已定＝允许）

| 面 | 承载 |
| --- | --- |
| 声明 | **PlanCompiler**（可选字段） |
| 受理与归约 | **ControlEngine**（影响 `plan.ts`、`goal-change.ts` 的 `PlanTaskSetDeltaV1`） |
| 投影 | **ReadModelIndex** |

**约束**：探索类任务**可以为空，但必须显式表达"尚未判定／不适用"**——**不能把缺字段当成"不受任何模块影响"**。一个单元跨多模块时**声明多个模块，不拆成多张图**；**不按模块数自动生成同等数量的执行任务与主负责人**。

### 6.5 skill／prompt 版本化资产的追溯链（架构稿 §6.4）

| 环节 | 承载 | 约束 |
| --- | --- | --- |
| 资产本体与版本 | **ArtifactVault** | 版本化产物，记录**来源、版本、适用范围、已验证的真实任务与失败例** |
| 这次选了谁 | **`RoleSpec` 引用 + 运行记录** | Run 记录所用版本，可回退 |
| 改动影响谁 | **由引用了该版本的 `RoleSpec`／Session 反查** | 反查关系是**派生副本**，来源写 `RoleSpec`／Run |
| 撤回 | **显式版本失效** | **不静默放开**（`docs/PRODUCT.md` §7.6） |
| 追溯 | **Vault 本体与版本 → `RoleSpec`／Run 的精确引用 → 查询反查验证结果、失败例与失效** | **不扩成技能市场**；不新增注册体系与逐条材料授权系统 |

### 6.6 目标变更链（§5.5）

本表列出目标变更时**停派、旧运行处置与迟到结果**的责任交接；完整口径见 `docs/PRODUCT.md` §5.5。

| 环节 | 承载 | 必须保留的判据 |
| --- | --- | --- |
| 影响与未知项 | **PlanCompiler** | 输出**已知影响**与**未知项**；影响范围无法确定时**不冒充"无影响"** |
| 停派与控制意图 | **ControlEngine** | 受理变更、确定**停派状态**、**控制意图**与**迟到结果守卫**；**影响范围无法确定时先暂停该 Goal 的新派发** |
| 控制交接执行 | **DispatchEngine** | 按停派范围停止受影响 Run 的后续派发、维持准入守卫、把控制请求交 WorkerRuntime |
| 向 Kernel 发请求并回传 | **WorkerRuntime** | 执行侧如实回报；`unsupported`／未知不伪装成已停止 |
| 归约与迟到结果 | **ControlEngine** | 消费已持久 Run 事实归约；**无关 Run 继续**；**迟到 Evidence 重新做适用性检查后才能推进** |
| 未完成处置展示 | **HumanCollaboration** | 展示受影响工作、已停／待停 Run 与迟到结果；**不代行控制** |

**边界**：**规划模块不直接取消 Runtime**；旧 Run 保存的结果**只有通过新版本适用性检查后才能推进当前状态**（`docs/PRODUCT.md` §5.5）。

---

## 7. 派发入口：目标口径 vs 现状（C-13）

| 项 | 内容 |
| --- | --- |
| **目标口径** | `DispatchEngine.drive` 是**公开唯一派发入口** |
| **现状（源码事实）** | 存在**普通／协作、Reviewer、Handoff 三条生产 `runtime.start` 路径**（`dispatch-engine.ts`、`reviewer-dispatch.ts`、`handoff/handoff-drive.ts`） |
| **必须二选一** | (a) 统一公开 `drive`，内部按运行类型分派；或 (b) 保留多入口，但**共用不可绕过的准入、Session 占用、授权与租约逻辑** |
| **附带要求** | 对照真实生产调用点给出**迁移清单**；**不能只把普通 Worker 改成 Session 复用而让 Reviewer／Handoff 留在旧语义** |
| **状态** | **待定项**，登记在 `ARCHITECTURE.md` §11.2 C-13；不是产品待决 |

**反向编排不改变派发权**：图给的是**范围与依据**（谁承担、向谁要状态、改到哪一层），**不是绕过控制面的通道**。

---

## 8. 三种记录与材料分级（不得互相冒充）

### 8.1 三种记录必须分开（§6.2.3）

| 记录 | owner | 含义 | 首版承载（既有，**不新建**） |
| --- | --- | --- | --- |
| **初始化选材清单**（`selectedRefs`／`gaps`／manifest） | **ContextCompiler** | 本次编译选择了哪些材料、哪些缺失 | 本次初始消息／编译结果中的引用，必要时记录配置版本 |
| **运行中实际读取记录** | **Kernel／WorkerRuntime 记录，平台保存引用** | 工具实际打开了什么、哪次调用消费了什么 | Kernel 已有会话与工具日志；**平台不重复抄一份** |
| **当前可用历史材料索引** | **由已发生读取与失效信息形成的可重建视图** | 需要更多背景时到哪里找 | Git、文档索引、两张图、Session 查询入口；**优先使用现有检索能力** |

**两条禁令**：「初始化选材清单」**不能冒充**「整个 Session 的消费历史」；反之，为了维护清单也**不能让每次读取都重新经过 Compiler**。

### 8.2 材料的三个等级（§6.2.2）

| 等级 | 形态 | 能证明什么 | **不得**用于 |
| --- | --- | --- | --- |
| **L1 路径级** | 路径 + 内容版本／摘要 | "去哪里取、取的是哪个版本" | 完成归约、授权判定、审批 |
| **L2 摘录级** | 短摘录／结论 + 链接 + 取用日期 + "未经验证"标注 | 参考与解释 | 充当项目事实 |
| **L3 引用级** | `kind` + `refId` + `revision` + `digest` | 来源适用性、幂等与 CAS 复核、撤权后再判定、完成归约 | — |

**三条配套规则**：给出索引 **≠** 原文已被消费（manifest 只标记**实际读入**的内容）；图上的摘要**不是事实本身**（必须能回到来源核验）；**L1／L2 不能提升授权级别**。

**L3 的现状限定**：**不能把 L3 宣称为"已经完整实现"**（存在 `digest` 被填成 `planId` 或缺失的情况）；进入接口设计前必须先定义 `digest` 与 `revision` 各自含义、旧数据兼容规则、校验失败拒绝规则（**缺 digest 不是"匹配"**）。

**普通消息不要求先转成正式引用**（U13）：消息本身走 Session 与定向邮箱；**版本化引用可以通过邮箱直接传给 Agent，这不意味着消息必须经过 ContextCompiler**。

---

## 9. 角色规格、绑定与矩阵（I9 的落点）

| 事项 | 承载 | 约束 |
| --- | --- | --- |
| `RoleSpecRevision` 治理 | **ControlEngine**（第 5 个治理种类） | `install`／`activate` 显式版本化；每个 `(projectId, roleId, revision)` 独立 `CAS@0`；**无内置默认值**；写入仍只有 `StateLedger.commit` 一条路径 |
| 角色矩阵 | `CoordinationPolicyContentV1.roles`（`CoordinationPolicy` 的**可选字段**） | **无矩阵不编造默认目录** |
| 绑定签发 | **DispatchEngine** 的 `issueMatrixRoleBinding`（`role-spec-read.ts`） | `templateId`／`templateRevision` 取自 pin；`policyRevision`＝`matrix:<policyId>@<contentRevision>#<pin 摘要前16位>`；`source: 'matrix' \| 'static-fallback'`；**签发不代替守卫**（"签发放行、守卫拒绝"的分叉必须避免） |
| 绑定消费 | **ContextCompiler** | 消费绑定作为选材依据 |
| 绑定有效性核对 | **DispatchEngine** | 在启动与安全检查点核对；**失效绑定不得启动新 Run**；模板变更**不追溯改写**已有绑定 |
| 绑定接受与撤销 | **ControlEngine** | 正式受理与撤销 |
| 绑定事实持久化 | **StateLedger** | `StateLedger.commit` 唯一写入路径 |

**工作区能力受理的归属澄清**：`WorkspaceCapabilityPort` 的**纯受理政策归 ControlEngine**（`ConfiguredWorkspaceCapabilityPolicy`）；此澄清**消除旧文档把该政策标为 WorkerRuntime 而导致的 Control→Runtime 反向依赖**；该政策**不调用活 WorkerRuntime**，实际启动／沙箱预检仍走 Runtime／Dispatch。

---

## 10. 判据唯一性清单（出现第二份就会分叉）

| 判据 | 唯一来源 |
| --- | --- |
| canonical 状态转换与授权 | **ControlEngine**（不变量 #1） |
| Command→snapshot/Event 的 fold | **ControlEngine**；`StateLedger` 只提交，**不 fold** |
| 完成归约 | **ControlEngine + CompletionPolicy**（不变量 #2；`CompletionClaim` 不是完成事实） |
| claim 守卫判据 | **ControlEngine**（"只有守卫那一份"） |
| 「一个任务一个身份」解析 | **ControlEngine** 的 `resolveTaskWorkIdentity` 权威只读解析（读取正式事实，不能称为无 I/O 纯函数） |
| 选材清单（`selectedRefs`／`gaps`／manifest） | **ContextCompiler** |
| 复用决策与推荐范围 | **AgentLifecycle** |
| 材料授权判定 | **ArtifactVault**（`material-access-policy`；"只有 Vault／Control 那一份"） |
| 跨工作历史准入 | **ArtifactVault／Control** 的显式授权（派发面 `selectHistory` **不复制、不放宽**） |
| 验证结论 | **VerificationEngine**（不裁决完成） |
| 结构权威 | **ArchitectureBaseline** revision（不变量 #13） |
| 任务结构权威 | **PlanRevision**（不变量 #23） |
| 事实权威 | **账本与 session 记录**（不变量 #22；图上摘要不是事实本身） |
| 投影 | **ReadModelIndex**（不变量 #4；可重建，**不是完成判定器**） |

---

## 11. 明确不新增的东西（避免重复实现）

| 不新增 | 理由 |
| --- | --- |
| **图模块**（`GraphIndex` 一类） | 图能力的生产者与关联是既有 Module 的职责扩展；再建一个会与 ReadModelIndex 的投影职责重复，并触碰"不要新建第五个机制去实现图索引编排"的既有禁令。**但图能力必须有独立源码单元**，落在拥有它的 Module 目录内（子目录不产生新 DAG 边） |
| **能力注册／技能市场模块** | `docs/PRODUCT.md` §7.6 明写「不建设独立技能市场、自动生成技能工厂或新的注册体系」；能力与 skill 承载在 `RoleSpec` + 既有治理路径 + ArtifactVault |
| **记忆模块** | 长期领域专家＝**角色配置 + 知识库 + 可积累记忆**的**扩展预留**：只写接口与积累方案，**明确声明未交付**；不新增独立记忆存储或每角色常驻进程 |
| **`MemoryStore` Module** | 契约明确不新增 |
| **问答模块** | "问负责人"复用既有 `QueryRun` 即可 |
| **身份治理聚合** | 用现有记录与查询生成工作卡片（L-4） |
| **逐条材料授权系统** | 复用范围是推荐线索（L-1 撤回） |
| **通用外部副作用对账系统／复杂自动接管平台／逐工具停机复查** | 首版扩大项，本轮撤回（A4／A6） |
| **草案治理平台** | L-5：草案有来源约束（不参与漂移裁决、不产生正式关联），但**不建平台** |
| **新的治理种类（无首个消费者时）** | 不变量 #11：治理种类只在存在首个消费者的切片中建立 |

---

## 12. 两条并发限制（撤回"单活跃工作线"后仍然保留）

1. **同一 Session 只允许一个拥有执行控制权的活跃 Run**（内核在已有活动 Run 时抛错，与此一致）；并行调查用**子 Session／同角色的另一条独立 Session**。
2. **同一共享工作区的写入沿用现有协调机制**：唯一 Writer 写租约（不变量 #7）。

**"同一 Agent 单活跃工作线"已撤回**（限制在 Session 上，不在 Agent 上）。**同一角色可并行多条独立 Session。**

**写租约口径（U5 收口）**：**首版保持租约绑定 Run**（`TaskLeaseSnapshot.holderRunId` 不改），**后继 Run 重新获取租约**；**不得仅凭超时就把写权交出去**；无需为了稳定身份让 Session 常驻持锁。

---

## 13. 共用实现与旧路径去向

本节是本轮重构的**目标分工**，不是实现完成声明。接口规定调用边界，共用实现减少重复：多个入口可以共用一套规则，不必强行合成一个入口。下表给出责任和迁移方向，具体函数/文件名、切换顺序与回滚由后续契约和 Prompt 6 确定。各模块 §1/§7 承接自己那一片，不复制其他模块的流程。

| 编号／共用内容 | 唯一 owner 与实际消费者 | 保留的业务差异 | 旧路径去向与验证方向 |
| --- | --- | --- | --- |
| S01 提交回执与机械构造 | **ControlEngine 内部提交支持**；各命令族共用 | 各领域的业务拒码、CAS 集合、受理政策分别保留 | `role-spec`／`human-role-collaboration`／`baseline-evolution` 等已证实等价的映射归一；变体先核对再迁移，新生命周期命令不再复制样板。 |
| S02 权威政策复用 | **ControlEngine 公共窄面**；PlanCompiler／DispatchEngine／ReadModelIndex 消费 | 预检/解释不是正式许可；最终命令在提交前按当前事实复核 | 逐符号替换 `control-engine/policies/**` 私有直引。初始候选来源规范化、角色准入仍归 Control；不因纯函数无 I/O 就下移 Contracts。 |
| S03 领域事件投影 | **ReadModelIndex 内部领域投影单元**；内存/SQLite Adapter 共用 | Adapter 各自承担必要前态读取、事务、游标与存储 | 两后端同义 event→row/change 规则只保留一份；先按事件和精确引用筛选再读前态。已有 `reviewer-projection` 可复用，不能把两大类各自拆小后仍留两份规则。 |
| S04 验证准备与执行 | **VerificationEngine 内部**；单项检查/轮次服务 | 单项 checkpoint/租约/副作用与轮次冻结配置/覆盖/恢复/聚合分开 | 沿用 `compileVerificationPlan`／`executePlannedCheck`，共用材料准备与能力规范化；`VerificationEngineImpl` 仍有生产内部消费者，迁移后才决定入口去留。 |
| S05 派发准备与通信驱动 | **DispatchEngine 内部**；普通/并行/Reviewer/Handoff 的适用步骤 | 独立审阅、只读隔离、换手来源不同，不要求整条流水线相同 | 共用不可绕过的必要准入/占用/租约逻辑；`coordination-drive` 按扫描输入、纯提案、持久协议、准入桥接分责。统一外部入口不代替内部减负。 |
| S06 材料共同步骤 | **ContextCompiler 内部**；Task/Planning/Query/Reviewer/Verification/Architecture 等材料消费者 | trigger 与消费用途分别表达；Reviewer 见证、Query 位置读取、图来源等专用约束保留 | 读取/引用/缺口/增量处理按真实重复提取；旧消费者接共同步骤，普通消息/成功恢复不绕回全量编译。不预设最终端口数量，不额外包一层万能 Compiler。 |
| S07 受限调用与结构检查 | **WorkerRuntime 内部**；回答自动复核与用户审计等确认同构路径 | verdict、预算归属、请求身份和审计记录生命周期保留 | 共用 block/index/quote/citation 检查和取消/结束/容量处理；复用既有 `runObservedModel`，不新建平台推理循环。 |
| S08 Kernel 引用与平台观察 | **WorkerRuntime 选择必要平台观察、ArtifactVault 持久化**；Dispatch/查询/运行报告消费 | 正式平台事实、必要公开投影与 Kernel 原始消息/工具日志不同 | 先清点 `RuntimeRecord.trace` 消费者，迁移 Kernel 正文到引用/游标；必要平台观察再增量写入。不能只把重复正文改成分条副本，也不能删掉仍被消费的正式事实。 |
| S09 工作区拒绝路径 | **当前 WorkspaceReader 定义**，Runtime 已有消费边；Verification 的目标共享位置待 §14 决定 | 安全拒绝与索引扫描忽略不是同一规则 | Runtime 替换字面副本；Verification 先确定合法共享依赖，不能用 Host 注入隐藏逻辑边。近似 ignore 清单先辨析语义。 |
| S10 协议机械原语 | **已有 Contracts 中有归属的协议单元**；真实同协议消费者 | 编码、undefined、拒码路径、限额不相同者不得机械合并 | 优先使用 `fingerprint`／`validation` 已有原语；类型守卫先区分仅判 aggregateType 与完整结构校验。不把业务受理算法塞进共享目录。 |
| S11 账本结构校验 | **StateLedger 内部 validation**；两存储 Adapter | 事务内 CAS、身份槽、幂等与原子提交仍由 Adapter 执行 | 沿用现有 `ledger-validation`，再核对分派和拒绝构造的重复；不能把交易约束迁到事务外预检。 |
| S12 正文与存储薄适配 | **ArtifactVault 共用核心**；内存/SQLite 后端 | 不可变 Artifact、可变公开观察和 canonical Ledger 的语义不同 | 保留现有 put/open、完整性和授权共用实现；不合成通用 Repository。纯原子文件操作继续复用已有 Storage。 |

**检查减负是否成立**：同义规则的实际消费者已指向一处实现，旧副本退役或仅保留兼容薄适配；不同业务场景仍保留原行为；按需读取、事件写入和连续消息路径的成本有真实证据。文件数、接口数、代码行数的单独变化不能证明重构完成。

**与质量要求的衔接**：共同目标和规则见 [RG-01～RG-06／CQ-01～CQ-12](../CODE-QUALITY-GUIDELINES.md)。各模块 §9 引用本表 S 编号，给出自身的改动边界和验收证据；本表继续维护共享 owner 与保留差异，不复制 13 篇的专项验收内容。尚待 §14 决定的共享位置，必须在决策与合法接线完成后才能将对应去重目标记为已达成。

## 14. 尚待确定的共享边界

### 14.1 路径拒绝政策（S09）

架构要求去掉 `denied-prefixes` 字面副本，但当前不含 `VerificationEngine → WorkspaceReader`。必须在 Prompt 4 对下列候选作取舍，再同步上位架构与模块边表；本轮仍沿用现有 38 条边。

| 候选 | owner／调用关系 | 采用条件与代价 |
| --- | --- | --- |
| 保留 Reader 政策 owner | WorkspaceReader 提供窄公开政策面，Verification 明确消费 | 若拒绝语义需随 Reader 访问政策演进，新增逻辑边须先获架构依据、核对无环；Host 注入不会消除这条边。 |
| 有归属的共享协议值 | 将经确认稳定的共同拒绝值与语义放入 Contracts；各模块消费共同协议 | 仅适用于跨模块同义的稳定值。路径规范化、符号链接/穿越判定和沙箱执行仍在 Reader/执行适配器，不能把整个访问政策迁走。 |

不能仅为避免新边而选第二种；不能为了消除重复而混合安全拒绝与索引忽略。本阶段给出决策范围，精确类型、装配和旧数组删除顺序后置。

### 14.2 私有 policies 的公开边界（S02）

`normalizeInitialPlanProposal` 和角色准入判据包含来源、版本与权限语义，即使无 I/O，也保留 Control owner。候选为公开的纯政策函数或只读解释端口，不必新增运行时服务。结构深拷贝、编码等无业务权威的共同计算才可考虑下移。逐符号分类后更新实际消费端口，不整目录搬迁，也不新增命令总线。

## 15. 非 Module 的承接范围

| 代码面 | 本轮责任与减负方向 | 不承接 |
| --- | --- | --- |
| Host／Composition | 将 `createScopedGuiService` 的 transport 路由、模块装配、后台唤醒/关闭、视图聚合分责；保持真实入口、请求身份、错误及关闭顺序 | 不因装配方便复制规划、准入、验证或完成政策；不把内部实现升级为 Host 的状态权威 |
| Contracts | 类型、稳定协议值、规范编码、结构校验；各单元仍有明确语义 owner | 不调数据库/Runtime，不拥有调度和授权决定；不给 DAG 隐藏业务依赖 |
| Storage | 复用已有原子文件写入等无业务语义原语 | 不定义记录模型、权限或恢复协议，不统一三种不同的持久语义 |
| 模块内部责任单元 | 根据变化原因拆分纯计算、协议编排、I/O 适配；只有真实复用价值时才提取 | 不为了文件变小新增 Module/Port，不制造第二套同义规则 |

本节承接架构 §9.1 的跨模块清理，不新增 Module 或领域权威。施工步骤、兼容/回滚和共享实现测试由 Prompt 6 及实施阶段交付。
