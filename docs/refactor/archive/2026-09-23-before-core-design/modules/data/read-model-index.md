# ReadModelIndex Module

```yaml
status: draft-for-review
updated: 2026-09-22
plane: Data
module: ReadModelIndex
code_dir: coding-platform/src/data/read-model-index/
contract_state: first-slice draft
upstream: docs/refactor/ARCHITECTURE.md（2026-09-21）
```

> 从已提交事件重建查询投影（含任务图与架构图查询视图）：把 `EventPage` 变成面向查询的视图与明确的投影游标，让展示与取材调用者不必读 canonical store 或重放事件。
> 分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状见 `my-coding-platform-docs/agent_platform/human/module-status.md`；本页只写本模块的局部设计与跨模块契约，不复述架构文档或产品文档正文；跨模块切分见 `docs/refactor/modules/ownership-map.md`。

## 1. 职责

**负责**

内部按领域投影族组织一份纯规则：先由事件类型和精确引用判断需要哪些前态，再加载必要前态，得到“事件＋必要前态 → 投影变化”；Goal／任务运行／审查／通信等族分别维护规则。内存与 SQLite 只负责读取必要前态、原子应用变化、cursor、分页和持久布局。`reviewer-projection.ts` 是现有局部样板；不得把同一事件规则拆成两组后端小文件，也不得为无关事件预读整组审查记录。

- **增量投影**：`advance(page: EventPage) → ProjectionReceipt`。成功才同时公开该页视图、去重集合与 cursor；任一处理器失败整页回滚、允许原页重试（内存适配器按该页实际访问条目暂存并写时隔离；SQLite 用事务回滚）。新增投影容器必须纳入页事务及回滚测试。【代码】
- **查询投影（27 项）**：`goal`；任务图 `planGraph`／`taskDetail`（`plan_graph` 表以 `stages`／`tasks`／`task_hierarchy`／`execution_dag` 为 JSON 列）；**任务图内的协作边**——消费既有协调／通信事实（`CoordinationIssue`、`MailboxViewV1`、`communication-view.ts`）投影 Agent 之间的咨询／反馈／讨论关系，供 Human／Host 展示；协作边**与阻塞依赖 DAG 分开表达**，讨论可以往返而**不把任务依赖制造成环**（架构稿 §5.2 两种关系分别表达）；`goalStatus`／`goalTimeline`；`activeAgent` 与 `TaskDetailView.run`；`taskVerification`；`handoffProvenance`；`workspaceLeaseView`／`integrationConflicts`／`workspacePatches`；`console*` 系列；`workContext`；`planChangeView`／`baselineChangeView`／`controlTimelineView`／`queryJobView`；`unifiedStatusView`；`architectureInspectionView`；`completedWorkView`。【代码】
- **材料授权的候选发现**：`materialAccessGrants(query)`（有界展示，最多 256 条，**不得把它的分页当作授权候选**）与 `materialAccessCandidates({reader, material})`（按完整 Run／QueryRun 身份及 `contentType`／`digest`／`sizeBytes` 返回**全部**精确候选，**不能在权限和版本筛选前截断**）。【代码】
- **政策解释的只读出口**：注入 `PolicyExplanationPort`（由 ControlEngine 实现），本模块传投影材料，换回证据适用性／有效集合与计划变更解释；不复制 Control 算法，也不把解释改写为正式 reduction。【代码】
- **治理查询视图**：`GovernanceViewPort`（`governance-view.ts`）按需读取已提交安装／激活事件与 canonical active／revision，组织当前生效内容、操作者及缺口；**不另存 active 权威、不提交治理命令、不作为授权输入**。【代码】
- **投影停滞的显式声明**：`ProjectionStallReason` 的 `unsupported_event_type`——已知 v1 事件类型但无投影 handler 时**整页停止**，绝不部分应用或静默跳过。【代码】
- **通信与审阅投影**：`communication-view.ts`（两种 Ledger 共用的事件重建投影，最多 200 页 × 1000）；`reviewer-projection.ts`（正式 Work／Result／协议投影与解释材料，保留原 TaskLease 来源）；`InitialPlanningView`；`MemoryViewIndex`（只读 `StateLedger` 当前 collection 与 revision）。【代码】
- **图查询投影与关联读取（规划中）**：架构图查询视图＋`module ↔ 文件夹 ↔ Agent ↔ session` 关联的**读取**（写入经 ControlEngine 既有协调／记录命令族）——架构稿 §5.1「关联的落点」。【设计新增】
- **本次新增：Agent／Session 投影与查询**（工作卡片、角色卡片）（I6）。【设计新增】
- **四态里本模块的那一片**：`working`／`standby`／`paused`／`archived` 由 **Session 元数据与工作卡片**用**现有记录与查询生成**；本模块提供**工作卡片投影**与图查询，**不是四态的权威来源**。【设计新增】

**不负责**

| 不负责什么 | 归属 |
| --- | --- |
| 不写 canonical、不接受业务 Command、**不能产生或修改 Domain Event**：投影是可删除、可由 Event 重建的**派生状态** | ControlEngine（归约）＋StateLedger（原子提交，不变量 #1／#3） |
| **不是完成判定器**：**绝不把报告文字投影为正式完成状态** | ControlEngine ＋ CompletionPolicy（完成归约，不变量 #2）；VerificationEngine（验证结论） |
| **`ModuleProgress`／`StageProgress` 只作为投影展示，绝不作为 Goal reducer 输入**（防投影回环） | ControlEngine（Goal phase 只从 canonical 事实归约） |
| 不做选材、不组装 `ContextBundle`、不产出 `selectedRefs`／`gaps`／manifest | ContextCompiler（三者唯一生产者） |
| 不复制或代写 Control 的政策与解释算法；不提交 Control 命令 | ControlEngine（`PolicyExplanationPort` 的唯一实现；claim／完成守卫只有那一份判据） |
| 不承载正文、不作出授权判定 | ArtifactVault（正文持久化与 `material-access-policy`；本模块只做候选发现） |
| 不读取源码、不捕获原生来源、不判来源有效性 | WorkspaceReader |
| 不承诺与 StateLedger **同事务**更新；调用者必须用 cursor 处理延迟 | StateLedger（原子提交路径）；调用者（`HumanCollaboration` 的等待策略等） |
| 图查询视图**不得成为第二权威**；架构图不是可丢弃的派生物 | ArchitectureBaseline revision（结构权威，不变量 #13／#20／#21）；PlanRevision（任务结构权威，#23） |
| 不建立第二份记忆存储、不推测记忆已生效状态（`MemoryViewIndex` 只读现状） | 记忆的查看／更新／检索／作废属**扩展预留、明确未交付**（架构稿 §6.4）；落点是既有 `HumanMemory`／历史记录路径 |

## 2. 对外接口

| 提供接口（现状/目标） | 调用者 | 输入 → 输出 | 必要约束与错误 | 本次变化/旧调用去向 |
| --- | --- | --- | --- | --- |
| `advance(page)`【代码】 | Host 投影驱动 | `EventPage` → receipt/cursor | 页原子、幂等；缺口/乱序/未知 schema/已知无 handler 整页停止 | 保留公共入口；内部改为一份领域投影规则供两 Adapter 使用 |
| `goal`／`planGraph`／`taskDetail`／状态与时间线查询【代码】 | HumanCollaboration、ContextCompiler、Host/UI | scope＋可选 `atLeastCursor` → ready/not_ready/not_found 视图 | `not_ready ≠ not_found`；任务图是 PlanRevision 视图；协作边不并入阻塞 DAG | 保留现入口和查询键；旧调用不迁名 |
| `activeAgent(query)`【代码】 | HumanCollaboration；AgentLifecycle【目标消费者】 | `(projectId, goalId, taskId)` → active agent 视图 | 当前键不是 `agentId`/sessionRef；不得冒充角色卡片查询 | 保留；AgentLifecycle 接线尚未实现；新卡片查询另命名，不改此接口语义 |
| `taskVerification`／通信／Reviewer／governance 等既有查询【代码】 | HumanCollaboration、ContextCompiler、Host/UI；AgentLifecycle【目标消费者】 | 精确 scope → 派生视图 | 不把报告文字、ModuleProgress 或 StageProgress 当正式归约 | 保留；AgentLifecycle 接线未实现；公共查询与内部 projection 文件分开 |
| `materialAccessGrants`／`materialAccessCandidates`【代码】 | ArtifactVault；展示消费者 | 展示查询→≤256 行；精确 reader/material→全部候选 | 展示分页不能授权；候选不得筛选前截断；最终判定归 Vault | 保留两个不同用途入口 |
| `ArchitectureGraphQueryPort.neighborhood`【目标候选，未冻结、未实现】 | HumanCollaboration、ContextCompiler | 项目/工作区范围、基线版本、module/file/agent/session 锚点 → 节点＋直接边＋来源/游标或不可用结果 | 只读索引；ArchitectureBaseline 是结构权威；范围与版本不能省略，精确字段后置 | 新增候选；现有实现无此入口 |
| `WorkSessionProjectionPort.query`【目标候选，未冻结、未实现】 | HumanCollaboration、AgentLifecycle | 项目/工作区范围、`agentId` 或 `sessionRef` 等筛选、游标要求 → 卡片/四态展示或未就绪 | 四态来自正式记录；投影不是权威；查询不修改状态 | 新增查询面；不改 `activeAgent` 原键。Human 的 `WorkSessionViewPort.query` 是提供给 Host/UI 的聚合入口，可委托本 Port，但不是 ReadModel 同名实现 |
| `InitialPlanningView.view(scope)`【代码，公开查询类】 | Host（`app/initial-planning.ts`） | project/workspace/goal → 初始规划请求、提案/决定、Run 与来源游标视图 | 读取 `ScopeCatalogPort.jobs` 与精确 canonical answer/plan；提案不冒充 accepted plan | 保留真实 Host 查询面；可后续收窄 Port，当前不能隐藏为内部 projection |
| `MemoryViewIndex.view(scope)`【代码，公开查询类】 | Host（`app/memory.ts`） | `MemoryScope` → `MemoryReadResult` | 委托 `MemoryLedgerPort.read`；canonical revision 表示新鲜度；缺少可选能力由 Host 显式拒绝 | 保留现查询面；完整记忆管理仍属未交付扩展 |

**接口命名口径**：以真实 Port／实现名为主。`ReadModelIndex`（`src/contracts/goal-view.ts` 的 `interface ReadModelIndex`，27 项查询）；`GovernanceViewPort`（`governance-view.ts`，架构名义名 `governanceView()`）；`PolicyExplanationPort`（`control-engine/policy-explanation.ts` 的 `ControlPolicyExplanation` 实现，架构名义名"政策解释"）；`ActiveAgentView`（源码 `activeAgent`）。

**实现映射**：`reviewer-projection.ts` 及后续按领域族拆出的纯投影规则属于内部实现。`communication-view.ts` 提供通信投影/查询支持；已被 Host 消费的 `InitialPlanningView`、`MemoryViewIndex` 属于上表当前公开查询面，不能因它们是类就隐藏消费者。`PolicyExplanationPort` 是本模块消费 Control 的依赖，归 §3。

**本次变化方向**：见 §7（I6 ＋ 两张图查询面）。

## 3. 依赖

| 依赖的模块 | 依赖哪个接口 | 传递内容 | 边状态 |
| --- | --- | --- | --- |
| StateLedger | catch-up/rebuild 使用 `events`；治理与 Memory 查询按需只读 canonical active/revision；`InitialPlanningView` 使用 `load` 与 `ScopeCatalogPort.jobs`；积压查询使用 `pendingDispatchIntents` | 已提交事件页、精确 canonical 事实、目录与积压记录；各自保持游标和缺口语义 | 既有 |
| ControlEngine | `PolicyExplanationPort`（`ControlPolicyExplanation`）；`work-identity-resolution.ts` 的 `dedupeTaskWorks` | 本模块传投影材料，换回证据适用性／有效集合与计划变更解释；两投影实现复用 Control owner 的 `dedupeTaskWorks` **纯归并规则**，不调用该文件内会扫描 Ledger 的异步 `resolveTaskWorkIdentity` | 既有（**显式 ReadModel→Control 依赖，不能因使用依赖注入而从架构图上省略**） |

> 本模块**本轮不新增依赖边**：I6 的工作卡片／Session 投影与图查询视图都落在上述两条既有边上（`StateLedger` 供事件页、`ControlEngine` 供解释与身份纯函数）；**不得为投影扩展新增边**。

## 4. 被依赖

| 谁依赖它 | 消费哪个接口 | 传递内容 | 依据 |
| --- | --- | --- | --- |
| HumanCollaboration | 既有 `goal`／`planGraph`／`goalStatus`／`goalTimeline`／`console*`／`unifiedStatusView`；目标候选 `WorkSessionProjectionPort.query`／`ArchitectureGraphQueryPort.neighborhood` | 状态、图、时间线、证据展示；角色名册与侧栏读侧 | 架构稿 §3.2：既有边，消费内容扩展（I6/I11） |
| ContextCompiler | 既有 `goal`／`planGraph`／材料引用等查询；目标候选 `ArchitectureGraphQueryPort.neighborhood` | 选材时消费查询结果，不重新实现状态归约 | 架构稿 §3.2／§6.3「保留但语义收紧」 |
| ArtifactVault | `materialAccessCandidates({reader, material})`／`materialAccessGrants(query)` | 候选发现：按精确读者身份与材料返回全部候选；**判定仍由 Vault 作出** | `module-boundaries.md`「Vault 的 material-access-policy 拥有授权适用性解析，依赖 StateLedger、ReadModel 候选发现和 WorkspaceReader 来源校验」 |
| AgentLifecycle（**本次新增**） | 既有 `activeAgent`／通信视图；目标候选 `WorkSessionProjectionPort.query`（只读） | 复用决策所需的忙闲、当前工作、任务与角色视图；消费接线均待实现 | 架构稿 §3.2 新增边第 4 条 |

> 宿主与 UI（`src/app/**`、`src/ui/**`）消费投影（`app/governance` 只委托查询并适配人类命令与回执）；**宿主边，不计入 38 条**。

## 5. 状态归属

| 状态／对象 | 是否 canonical | 权威来源 | 归属生命周期阶段／动作 |
| --- | --- | --- | --- |
| 全部投影行与视图（Goal、任务图、phase、证据、授权行、通信、Reviewer、已完工作、治理、`MemoryViewIndex`） | **否（derived state：可删除、可由 Event 重建的派生状态，不是 canonical）** | ReadModelIndex（投影）；canonical 在 ControlEngine ＋ StateLedger | 运行（`advance(page)`）／重建（catch-up／rebuild）／销毁＝可删除后由 Event 重建 |
| freshness：`observedCursor`／`sourceCursor`／`atLeastCursor` | 否（证明物） | **opaque `CommitCursor`**：只有 ledger Adapter 与 ReadModelIndex 可经 `compareCommitCursor` 使用；**freshness 不由时间延迟或进程内调用顺序推断** | 每次 `advance` 推进 |
| 工作卡片／角色卡片（承载四态展示） | 否（投影） | 本模块只展示；四态由 **Session 元数据与既有记录**生成，归 ControlEngine 归约 ＋ StateLedger 提交 | 运行／挂起·恢复／归档（投影随之更新） |
| 架构图查询视图与关联读取（规划中） | 否（查询索引可重建） | 结构权威＝ArchitectureBaseline revision（#20／#21）；关联是**日常事实**，按普通记录路径落账（**不进 install／activate 审批**） | 初始化（阶段 2）／演进 |
| `PolicyExplanationPort` 的解释结果 | 否（只读解释） | ControlEngine（唯一实现） | 运行 |
| 投影停滞判定（`ProjectionStallReason`） | 否（投影自述） | ReadModelIndex | 运行 |

**本模块拥有的对象**：派生投影与其 cursor／去重集合、查询布局、页事务与回滚边界、投影停滞判定、图查询与关联读取面（规划中）。
**本模块不拥有的**：Role／Session／Run／Work 的任何 canonical 记录；Task／Evidence 的正式状态与完成归约；授权事实与撤销（ControlEngine ＋ StateLedger）；正文（ArtifactVault）；来源与路径边界（WorkspaceReader）；结构权威（ArchitectureBaseline）；任务结构权威（PlanRevision）。

> 生命周期口径（架构稿 §4）：本模块落在**五阶段**的初始化（阶段 2 的图与投影）、运行、销毁＝归档（投影随之更新）；落在**四动作**的归档（投影更新）。四态 `working`／`standby`／`paused`／`archived` 描述 **Session／工作卡片**，本模块只提供展示面。

## 6. 旧标识去向

- 本模块**不拥有标识的正式权威**，但派生行**包含**旧标识：不拥有 `agentId`／`AgentInstanceV1.agentInstanceId`／`workId`／`WorkContextBinding`／`AgentInstanceStatus`，而投影行里**确实保留这些标识**——`work_context_binding` 表与其绑定快照（`WorkContextBindingSnapshot`）、`work_context_notes` 行都带着原有标识与 `sourceCursor`；这些是**可由 Event 重建的派生副本**，来源写 canonical 记录，**不因 owner 在别处而改变原事实的性质**（架构稿 §9.3 第 5 条：投影能重建；升级失败仍能继续读取旧数据）。因此本模块**没有标识迁移动作**，只有**兼容迁移**：旧标识随派生行保留可读，`workId` 若与 `taskId` 合并不改写历史行。
- 但必须表态：**`ActiveAgentView` 当前的查询键是 `(projectId, goalId, taskId)`，不是按 `agentId` 查询**；I6 的**工作卡片／角色卡片投影需要按 `agentId`／`sessionRef` 建新的查询面**，而不是改写既有查询键。
- 承载字段的去向属 **§11.4.3 第 1 份契约**（持久字段、主键与基数约束：Session 承载形态、Agent 实例标识、旧标识兼容映射）与 **第 3 份契约**（工作卡片与三种记录的查询接口、筛选字段）。
- 四态**不写进** `AgentInstanceStatus`：`"active" | "retired"` 字段存在，但 `retired`／`retiredAt` **没有任何命令／事件写入**；本模块也不扩写该字段（架构稿 §4.6）。
- 旧事件语义不变：既有事件不可原地改变 v1 含义；**旧 `GoalView` 形状不隐式扩张**（新增视图须显式 schema）。

## 7. 本次接口变化方向

**共用与去向**：两种存储共用按领域族划分的纯事件投影；先识别事件与精确引用，再加载必要前态，之后由内存/SQLite 薄 Adapter 原子应用。保留两 Adapter 的事务、cursor、分页和物理布局差异。旧后端内重复的事件 switch/规则在等价验证后删除；验证覆盖同事件序列、重复推进、cursor、缺失前态和整页回滚，不只比较最终显示文字。共享方案登记见 `ownership-map.md` §13 S03。

`对应项号：I6 ｜ ReadModelIndex.advance/goal：新增 Agent／Session 投影与查询（工作卡片、角色卡片），并为两张图提供图查询视图与关联读取，**任务图扩展协作边**——消费既有协调／通信事实（`CoordinationIssue`／`MailboxViewV1`／`communication-view.ts`）投影咨询、反馈与讨论关系供 Human／Host 展示，**与阻塞依赖 DAG 分开**、允许往返而不制造依赖环 ｜ 边动作：保留（StateLedger、ControlEngine 两条既有边；本轮不新增边，工作卡片投影与协作边投影仍只用这两条） ｜ 理由：`decision/02` C8 与 I11 需要角色名册与统一侧栏；图检索需要邻域查询面，读取落在本模块、写入经 ControlEngine 既有命令族（§5.1「关联的落点」）；任务图还须标注 agents 之间的协作关系（架构稿 §5.2、`docs/PRODUCT.md` §7.2.5） ｜ 不变量：#4（UI／Todo／Plan Matrix／Timeline 都是 ReadModel，不接受直接状态写入）、#5／#24（三类 DAG 与两张图只互映、不互为真相源）、#20／#21（图查询视图不成为第二权威）、#22（摘要必须能回到来源核验）、#23（任务图权威是 PlanRevision）`

## 8. 信息缺口

- **对齐架构稿 §11.4.3**：
  - **①** 持久字段、主键与基数约束 → 架构稿 §9.2 第 1 份契约：工作卡片与角色卡片的承载字段（Session 承载形态、Agent 实例标识、旧标识兼容映射）。
  - **②** 各 Port 精确形状／字段命名／装配点 → 架构稿 §9.2 第 2／4 份契约：新查询面与图查询视图的 Port 形状、装配点。
  - **③** 工作卡片与三种记录的查询接口、筛选字段 → 架构稿 §9.2 第 3 份契约。
  - **④** 迁移切换点、删除顺序与回滚方式 → 架构稿 §9.2 第 4 份契约与 Prompt 6（旧投影路径与两后端重复规则的迁移）。
  - **⑥** 度量口径的具体采集实现（投影延迟、扫描次数）→ 按 U12 指标表，标"待测"。
- **本模块新增缺口**：
  1. **工作卡片与 Session 投影未做**（I6）：当前 `ActiveAgentView` 按 `(project, goal, taskId)` 查询，**没有按 `agentId`／`sessionRef` 的查询面**。
  2. **图查询视图规划中**：架构图查询面与关联读取尚无实现；`ArchitectureView` 的实现是 `UnavailableState`，`WorkspaceReader` 的图读取返回 `unsupported`（架构稿 §5.1「现状对照」）。
  3. **两种后端尚有重复投影／View 规则**（内存与 SQLite 同语义各写一遍）：属**本模块内部维护债**，**不能说已全部消除**。
  4. `sqlite-read-model-index.ts`（4231 行）与 `read-model-index.ts`（3262 行）**待按职责拆分**；"先按职责拆分、提取共同逻辑并扩展必要投影；是否整体重写依据具体耦合问题决定"（架构稿 §9.1）；排期与回滚点属 Prompt 6（C-11）。
  5. 治理视图是**按需读取，不是跨聚合原子快照**：矩阵与 policy 标识取同一 revision，扫描不足须显式 `gaps`。
  6. `MemoryViewIndex` **未冻结验收**；记忆的查看／更新／检索／作废、适用性与跨任务消费者属**扩展预留、明确未交付**。
  7. 投影落后时的行为必须如实：读返回游标／更新时间，**派发以 canonical 事实复核**（§7.4.1 末行）；`ready.goal.sourceCursor` 不得晚于 `observedCursor`。
  8. 架构稿 §9.2 把本模块的"拆分与投影扩展（I6）"列为**可以后置**项，不阻塞 ContextCompiler 收窄成立。

## 9. 重构目标与质量验收

> 通用依据：[代码规范、重构目标与质量验收](../../CODE-QUALITY-GUIDELINES.md)。本节已纳入本轮模块文档要求；以下均为重构目标与验收条件，**不表示源码已经达成或验收通过**。

| 当前问题／依据 | 本次目标与改动边界 | 共同实现与旧路径去向 | 验收证据（关联规则） |
| --- | --- | --- | --- |
| 内存与 SQLite 对同一事件族仍各有投影／View 规则，新增事件容易漏登记或语义分叉（§1／§7／§8；S03） | 按领域族共用纯事件识别与投影规则；投影继续只读已提交事件，不成为正式状态写者 | 等价验证后删除两后端重复的领域 switch／规则；存储布局、事务、cursor、分页与物理索引仍由各 Adapter 保留 | 同一有效事件序列在两后端产生等价领域结果；未知事件、缺失前态与重复推进保持既有失败／幂等语义（RG-01／RG-02／RG-03；CQ-01／CQ-04／CQ-06／CQ-08） |
| 页推进要求成功后才同时公开视图、去重集合与 cursor，任一处理器失败须整页回滚（§1／§2／§5） | 共同 reducer 不得把 SQLite 事务或内存写时隔离移出正确边界，也不得把 `CommitCursor` 改成业务可解释编号 | 共用领域计算；保留 SQLite 事务回滚、内存页暂存、cursor 编码与分页差异，旧路径只在对应 Adapter 内退役 | 覆盖整页成功、页中失败、原页重试、重复事件、空页和 restart/rebuild；失败后视图与 cursor 均不前进（RG-01／RG-04；CQ-03／CQ-05／CQ-06／CQ-08） |
| 新增卡片／两张图／协作查询及积压扫描可能放大全表读取，精确查询协议和规模基线仍未冻结（§2／§8） | 新查询复用共同领域投影，不以扫描正文或模型报告推断正式状态；性能改善用固定事件量和相同 Adapter 测量 | 保留现有受限查询兼容面；建立直接索引后删除对应全表扫描，未到删除条件前明确兼容期限 | 查询范围、排序、分页、freshness 与来源契约回归；记录固定规模下的扫描行数与耗时，不用文件数或接口数证明收益（RG-01／RG-04／RG-06；CQ-01／CQ-03／CQ-08／CQ-09／CQ-12） |

**专项验收场景**：同一事件页在两后端得到等价投影；页中处理失败后视图、去重集合与 cursor 全部回滚并可原页重试；新图／卡片查询只读投影且不产生 canonical 写入。

**当前状态**：两种 Adapter 与页事务语义已经存在；领域投影规则收敛、新查询接线、旧分支删除和规模测量仍待实现或复核，不能由最终显示文字相同推定通过。
