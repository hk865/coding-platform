# StateLedger Module

```yaml
status: draft-for-review
updated: 2026-09-22
plane: Data
module: StateLedger
code_dir: coding-platform/src/data/state-ledger/
contract_state: first-slice draft
upstream: docs/refactor/ARCHITECTURE.md（2026-09-21）
```

> **canonical state 的权威存储**：原子保存 ControlEngine 已经生成的 Domain Event、canonical aggregate snapshot、幂等回执与 outbox intent，并提供有序 Event 读取；调用者不必了解事务、表、序列化、checkpoint 或崩溃恢复细节。
> 分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状见 `my-coding-platform-docs/agent_platform/human/module-status.md`；本页只写本模块的局部设计与跨模块契约，不复述架构文档或产品文档正文；跨模块切分见 `docs/refactor/modules/ownership-map.md`。

## 1. 职责

**负责**

内部实现按三层保持分离：`ledger-validation.ts` 负责可跨 Adapter 共用的 **commitKind 结构校验**；ControlEngine 负责业务资格、权限和 expected-version 集合；内存／SQLite Adapter 在事务边界内负责 CAS、幂等、身份槽与原子提交。三层可以复用同一编码与守卫辅助，但不得把业务准入塞进结构校验，也不得把事务内检查提前成一次事务外预检。

- **原子提交**：`commit(batch: LedgerCommit) → LedgerCommitReceipt`——Event／canonical snapshot／幂等回执／outbox intent **全部提交或全部不提交**；`committed` 回执只在 Event 持久提交后返回（不变量 #3；架构稿 §7.3「原子提交路径」）。【代码】
- **canonical snapshot 读取**：`load(ref: AggregateRef) → SnapshotResult`；**restart 只加载最后一次原子提交的 canonical snapshot**，本模块**不 fold、不重建** canonical snapshot。【代码】
- **有序 Event 读取**：`events(query: EventQuery) → EventPage`；`afterCursor` 之后**连续**读取，非空页 `throughCursor` 等于最后一个 `PositionedEvent.cursor`，空页 `throughCursor` 等于 `afterCursor`；重复分页不遗漏、不重排。【代码】
- **CAS 与幂等**：按 `expectedVersions` 做版本校验（不匹配无副作用地拒绝）；同一 `CommandIdentity`＋`fingerprint` 重放**不追加第二份 Event**并返回相同 event IDs／revision／cursor；同 identity 异 fingerprint 返回 `idempotency_conflict`。【代码】
- **durable outbox 只读扫描**：`pendingDispatchIntents(limit, selection?) → DispatchOutboxEntrySnapshot[]`；`PendingDispatchSelection` 可按正式 `workKind`（`ordinary`／`review`／`replacement`）在限流前筛选，并支持 `dueAt`／`includeQuarantined`／`scope`；两种后端行为一致，省略 `selection` 保留原查询。【代码】
- **canonical 目录的只读发现**：`ScopeCatalogPort`（`goals(scope)`／`jobs(scope?)`，实现 `ledger-scope-catalog.ts`）按事件增量发现 Goal／QueryJob 再读当前 canonical 快照；**不冒充同一 cursor 下的业务投影视图**，读取失败**不静默返回不完整目录**。【代码】
- **事务内 canonical 身份槽约束**：`identity_claims` 的唯一身份槽 `(projectId, workspaceId, goalId, taskId)`；task 工作绑定提交在同一事务中核对并占用该槽，事件、绑定快照与槽冲突不能部分成功；内存与 SQLite 使用同一身份键规则。【代码】
- **隐藏实现**：SQLite 或内存布局、事务范围、append-only log、snapshot 编码、idempotency 索引、全局 cursor、分页、checkpoint 与崩溃恢复；**存储引擎变化不改变 Interface 语义**。【代码】
- **本次新增**：**新增 commitKind 与事件类型**（Agent／Session 生命周期、复用、压缩、归档），使生命周期事实走同一原子提交路径（I5／#3／#16）。【设计新增】

**不负责**

| 不负责什么 | 归属 |
| --- | --- |
| **不判断业务合法性、不发明 Domain Event、不执行 Command→snapshot/Event fold** | ControlEngine（唯一 transition authority，不变量 #1／#3） |
| 不从 Event Log fold 或修复 canonical snapshot | ControlEngine（本模块只保存已归约结果） |
| **不构建 Portfolio／Goal／Todo View**、不定义等待投影的策略 | ReadModelIndex（投影与 `advance(page)`／查询面） |
| 不执行 Scheduler／Runtime／Verification | DispatchEngine（调度与准入）／WorkerRuntime（执行）／VerificationEngine（验证） |
| 不存 Artifact 大对象正文 | ArtifactVault（`put(record)`／`open(ref, accessScope)`；正文 body-first） |
| **不向用户解释错误** | HumanCollaboration（错误映射：`invalid→invalid_request`、`not_found→scope_not_found`、conflict→`conflict`、`unavailable→temporarily_unavailable`） |
| 不做语义裁决与资格判断（例如 pending intent 的完整来源与语义资格、alternativeReport 的"正文可读或获胜"） | 所属上层 Module（ControlEngine／DispatchEngine 等）；本模块**只核对正式事务及版本** |
| 不解析治理策略、不承载 policy／fold | `governance-records.ts` 只解析治理引用与摘要；policy 与归约在 ControlEngine |
| 不比较或解码 `CommitCursor` | `CommitCursor` 是 **opaque**：只有 ledger Adapter 与 ReadModelIndex 可经 `compareCommitCursor` 使用，其它调用者不得比较或解码（`contracts/ledger.ts`） |
| 不定义外部传输协议或 Host 装配方式；**内部存储 schema 由本模块的内部 Adapter 负责** | 本模块内部的 Adapter（`sqlite-ledger.ts` 的 `initSchema()` 定义 `events`／`snapshots`／`idempotency`／`identity_claims` 表；`in-memory-ledger.ts` 对应内存布局）；Host 组合根（`src/app/**`、`src/composition/**`）**仅装配配置** |

## 2. 对外接口

**接口命名口径**：以真实 Port／实现名为主——契约中**真实存在**同名接口 `StateLedger`（`contracts/ledger.ts`，适配器 `in-memory-ledger.ts`／`sqlite-ledger.ts`）；架构名义名 `StateLedger.load/commit/events` 与真实入口一致（I5）。

| 提供接口（现状/目标） | 调用者 | 输入 → 输出 | 必要约束与错误 | 本次变化/旧调用去向 |
| --- | --- | --- | --- | --- |
| `load(ref)`【代码】 | ControlEngine、DispatchEngine、ContextCompiler、ArtifactVault、ReadModelIndex；AgentLifecycle【目标消费者】 | `AggregateRef` → `found(snapshot) \| not_found` | revision 合法且单调；只读不等于业务裁决 | 保留；旧调用不迁名；新生命周期消费者尚未接线 |
| `commit(batch)`【代码】 | ControlEngine | `LedgerCommit` → committed/rejected receipt | Event/snapshot/idempotency/outbox 全有或全无；CAS、identity、fingerprint 冲突无副作用拒绝 | 签名保留；生命周期只新增 kind/event，旧 kind 语义不改 |
| `events(query)`【代码】 | ControlEngine、DispatchEngine、ReadModelIndex、ContextCompiler 的事实扫描；AgentLifecycle【目标消费者】 | cursor＋limit → 稳定有序 `EventPage` | append-only；空页 cursor 语义不变；未知 schema 由消费者显式拒绝 | 保留；旧调用不迁名；新生命周期消费者尚未接线 |
| `pendingDispatchIntents(limit, selection?)`【代码】 | DispatchEngine、ReadModelIndex 积压视图 | 选择条件 → 稳定有序 pending 快照 | 必须先过滤再限量；不能把全表搬到进程后筛 | 保留；普通/换手消费者继续使用 |
| `ScopeCatalogPort.goals/jobs`【代码，独立 Port】 | ContextCompiler、ReadModelIndex、Host 目录适配 | scope → canonical 记录引用 | 不冒充同 cursor 业务视图；失败不返回残缺目录 | 保留目录语义；不是 `StateLedger` 同名方法 |
| `workDirectory?`／`readonly memory?`【代码，可选能力】 | 既有工作目录/Memory 消费者（ContextCompiler、ReadModelIndex、Host） | 工作目录／Memory 查询 → canonical 结果 | 旧 Adapter 可缺失；消费者显式报能力缺口；不另建记忆权威 | 保留可选能力，未冻结能力不得当成必有 |
| `alternativeReport(waitRef)`【代码，必选方法】 | DispatchEngine | `WaitConditionRef` → canonical alternative-report 选择结果 | 只读选择不代表正文可读或候选已获胜，准入时须重新核对 | 保留；不标成可选能力 |

**本次变化方向**：见 §7（此处只写一句指引，细节放第 7 节）。

## 3. 依赖

`allowedModuleDependencies[StateLedger] = {}`——**本模块是 DAG 的汇之一，没有任何 Module 间依赖边**。

| 依赖的模块 | 依赖哪个接口 | 传递内容 | 边状态 |
| --- | --- | --- | --- |
| （无） | —— | 不依赖 ControlEngine、ReadModelIndex、DispatchEngine 或 UI；**不 fold、不做语义裁决** | 既有（汇） |

**边界说明**：`Event`／`CommandIdentity`／`CommandFingerprint`／`CommitCursor` 等类型来自共享 Contracts（`contracts/command-event.ts`、`contracts/ledger.ts`）与 `src/data/state-ledger/**` 内部实现——**Contracts 与组合根不是 Module**，不构成 Module 间依赖边（架构稿 §3.1「三种边必须分开」）。底层存储与 clock 是**内部 Seam**，至少出现生产与测试两个 Adapter 后才固定该 Seam。

## 4. 被依赖

反向表（架构稿 §3 依赖 DAG 的反向推导）共 **6 条**边：5 条既有 ＋ 1 条本次新增。

| 谁依赖它 | 消费哪个接口 | 传递内容 | 依据 |
| --- | --- | --- | --- |
| ControlEngine | `load(ref)`／`commit(batch)`／`events(query)`；`governance-records.ts` 的 `resolveProjectArchitectureBaseline`／`resolveProjectCompletionPolicy`／`loadProjectArchitectureBaselineActive`（只读解析） | 读 canonical snapshot 做授权、CAS 与幂等校验；**原子提交状态、事件与派发 intent**；治理引用只按精确 ref／revision／digest 解析，不改治理状态 | 【代码】`control-engine/**`；§7.3 原子提交路径；module-status「StateLedger」行 |
| DispatchEngine | `load`／`events`／`pendingDispatchIntents(limit, selection?)`／`alternativeReport` | 读取 Run/Replacement/QueryJob/协调记录、pending outbox 与事件页；选择 alternative-report。**目标**按需要决定续用/编译，始终 outbox-before-side-effect；当前普通派发仍装配材料 | 【代码】`dispatch-engine.ts`、`query-drive.ts`、`coordination-drive.ts`、`handoff/handoff-drive.ts`；I2 是目标演进 |
| ContextCompiler | `load(ref)`（`feedback-materials.ts` 用 `Pick<StateLedger,'load'> & Partial<Pick<StateLedger,'events'>>`）；`ScopeCatalogPort.jobs` | 读取正式事实引用与 canonical 目录作为**有界选材**的来源；**不重新实现状态归约** | 【代码】`data/context-compiler/feedback-materials.ts`、`coordination-context-compiler.ts`、`execution-feedback-context.ts`；§3.2 |
| ArtifactVault | `load(ref)`（`createMaterialAccessResolver` 逐条读 reader／grant／Workspace／Goal／Run） | 材料授权适用性解析所需的 canonical 记录；权限解析在**读取时**重核 canonical grant，**投影落后也不能沿用已撤销授权** | 【代码】`data/artifact-vault/material-access-policy.ts`；module-boundaries 第 79 行 |
| ReadModelIndex | `events`；`pendingDispatchIntents`；治理/初始规划按需 `load`、`ScopeCatalogPort.jobs`；Memory 查询；cursor 编码/比较工具 | 从已提交事件重建投影，按需查询精确 canonical 记录；积压扫描、cursor 与缺口语义保留 | 【代码】`data/read-model-index/**`；§7.1 I6 |
| **AgentLifecycle**（新增 Module） | 【设计新增】`load(ref)`／`events(query)`（**只读**） | 只读 canonical 生命周期事实：`AgentInstanceV1`、`WorkParticipationV1`、`RoleSpecRevision`／矩阵 pin、`WorkContextBinding` | 架构稿 §3.2 新增边 3；§6.1 |
| 宿主边（**不计入 38 条**） | `src/app/**`、`src/composition/**` 构造并注入 Adapter（`app/service.ts` 装配 `LedgerScopeCatalog`） | 装配、HTTP 适配与 data 目录选择；不承接模块权威 | 架构稿 §3.1「三种边必须分开」 |

**边界说明**：PlanCompiler、HumanCollaboration 等只经 `contracts/ledger.js` 使用**共享类型**（如 `AggregateRef`），**不是 Module 间依赖边**；`CommitCursor` 的解码函数虽在 Contracts，仍只有 ledger Adapter 与 ReadModelIndex 可调用。

## 5. 状态归属

**本模块是 canonical state 的权威存储**：只原子保存 ControlEngine 已生成的 Domain Event、canonical aggregate snapshot、幂等回执与 outbox intent；**不 fold、不重建 canonical snapshot**（不变量 #3）。

| 状态／对象 | 是否 canonical | 权威来源 | 归属生命周期阶段／动作 |
| --- | --- | --- | --- |
| canonical aggregate snapshot（各聚合） | 是 | **StateLedger**（内容由 ControlEngine 生成，本模块只原子保存与读取） | 全阶段：创建／初始化／运行／挂起·恢复／销毁＝归档 |
| Domain Event（append-only、不可变） | 是 | **StateLedger**；aggregate revision 与全局 cursor 单调递增 | 全阶段；四动作（产生／拆解／压缩／归档）的事件同路径 |
| 幂等回执（`CommandIdentity`＋`fingerprint` → durable outcome） | 是 | **StateLedger**（重放返回相同 outcome，不追加第二份 Event） | 全阶段 |
| outbox intent（`DispatchOutboxEntry` 等 durable intent） | 是 | **StateLedger**（与 Event／snapshot／幂等同事务；status pending→started→done 各自 CAS 推进） | 运行／派发 |
| `CommitCursor`（提交位置） | 是（**opaque**） | **StateLedger**；只有 ledger Adapter 与 ReadModelIndex 可经 `compareCommitCursor` 使用 | 全阶段（freshness 的唯一凭据） |
| `identity_claims` 唯一身份槽 `(projectId, workspaceId, goalId, taskId)` | 是 | **StateLedger**（事务内约束）；Control 的先查守卫只负责可读拒绝，**不替代事务约束** | 创建（工作绑定提交时） |
| `ScopeCatalogPort` 的目录结果 | 否（只读发现，指向 canonical 记录） | **StateLedger**（`ledger-scope-catalog.ts`） | 全阶段 |
| 投影／视图（Goal View、任务图、工作卡片、时间线…） | 否 | ReadModelIndex | 运行／销毁＝归档 |
| 材料正文与授权适用性 | 否 | ArtifactVault（`put`／`open`；授权由 Vault 判定） | 全阶段 |
| 材料清单 `selectedRefs`／`gaps`／manifest | 否 | ContextCompiler（**唯一生产者**） | 初始化／运行／接续 |
| Kernel Session 正文、执行记录、检查点与压缩日志 | 否 | **Kernel**；平台只保存引用与映射（L-2／R-5） | 创建／挂起·恢复 |

**本模块拥有的对象**：canonical aggregate snapshot、Domain Event、幂等回执、outbox intent、`CommitCursor`、`identity_claims` 身份槽，以及 `ScopeCatalogPort` 的只读发现。它**不拥有**任何业务语义——Task／Goal／Evidence／Run 的归约结果均由 ControlEngine 生成。

**本模块不拥有的**：Task／Goal／Evidence／Run 的语义归约与守卫（ControlEngine）；一切 View 与投影（ReadModelIndex）；材料正文、授权判定与 owner 边界（ArtifactVault）；源码正文与原生来源捕获（WorkspaceReader）；选人／复用／上下文处置决策（AgentLifecycle）；Kernel Session 正文与检查点（Kernel）；`ContextBundle` 与 manifest（ContextCompiler）。

> 生命周期口径（架构稿 §4）：**五阶段**＝创建／初始化（项目认知初始化）／运行／挂起·恢复／销毁＝归档；**四动作**＝产生／拆解／压缩／归档（另 §4.2 列"重新启用"）。四态 `working`／`standby`／`paused`／`archived` 描述 **Session／工作卡片**。

## 6. 旧标识去向

按架构稿 §9.3（七条最小迁移规则）与 §4.5（R-1、标识取舍表）表态，属于本模块的部分如下——**本模块不持有旧 Agent／Work 标识本身，但它是旧库兼容与身份槽约束的落点**。

- **`identity_claims` 唯一身份槽 `(projectId, workspaceId, goalId, taskId)`**：新库身份槽原已具备；**旧库可能已有 `WorkContextBinding` 而没有 `identity_claims` 槽** → 提交在**事务内**检查这些旧快照做 canonical 冲突检查，**不能因槽表为空给同一任务另建身份**。【代码】
- **旧多身份的处理口径**：**不删、不选赢家**；**旧绑定与历史重复原样保留**；**新写入不得扩大重复**。内存与 SQLite 使用同一身份键规则；Control 的先查守卫只负责可读拒绝，不替代事务约束。【代码】
- **旧事件语义不变**：既有事件**不可原地改变 v1 含义**，演进必须新增 `schemaVersion` 与兼容策略，未知版本继续拒绝（§7.3／架构稿 §9.3 规则 1）。
- **旧 Agent／Work 标识保留可查或提供兼容映射**（架构稿 §9.3 规则 1）；需要映射的历史关系**记录来源**（规则 3）；**不把过去多个主体无证据地合并成一个"始终存在的 Agent"**（架构稿 §9.3 首段）——本模块不为这种合并新增 commitKind 或聚合。
- **`AgentInstanceStatus`（含 `retired`／`retiredAt`）不扩写**：四态 `working`／`standby`／`paused`／`archived` 描述 **Session／工作卡片**，**撤回"把四态强塞进持久 `AgentInstanceStatus`"**（§4.6／#19／用户原话 12）；`retired` 至今没有写入路径（§4.0），本模块不为它新增事件或命令。
- **`workId` 的合并不由本模块宣布**：`workId` **不先宣布必需**——若仅重复 `taskId` 就合并；**合并前必须确认**：若 `workId` 正在维系**跨 Run 或换手后的连续性**，删除时要把该关系移到任务图或等效既有记录，**不能把"删掉 ID 字段"与"去掉开销"直接画等号**（§4.5 标识取舍表）。它若被合并，本模块需迁移相应聚合键（如 `WorkParticipation`）并**保留历史可读**；该决定与切换点属 §11.4.2 迁移工作（架构稿 §9.2 第 4 份契约）。
- **restart 与升级兼容**：投影能重建，**升级失败仍能继续读取旧数据**（架构稿 §9.3 规则 5）；`schemaVersion`、切换点与回滚方式写在接口／重构计划中（规则 6）。
- **Kernel 记录与平台提交不是同一事务**：先有可定位的 Kernel 结果，再**幂等**接纳为平台事实；创建请求重试以"**不产生两份会话**"为幂等判据（R-5）；中断按事件 ID／游标对账，副作用未知就核对、**不自动重跑**（架构稿 §9.3 规则 7）。

## 7. 本次接口变化方向

**共用与去向**：继续复用 `ledger-validation.ts` 的结构校验和既有 Contracts 编码；可进一步共用两 Adapter 的机械 commit 分派，但 SQLite 事务、内存原子替换、CAS/幂等/identity slot 检查仍留在各自提交边界。旧 Adapter 分派副本在共享分派落地后删除；不得以此合并结构、业务、事务三类校验。

对应项号：**I5** ｜ 接口名：`StateLedger.load/commit/events` ｜ 方向：**新增 commitKind 与事件类型**（Agent/Session 生命周期、复用、压缩、归档），**具体新增名称尚待接口设计**；`load`／`commit`／`events` 的签名、CAS、幂等、原子提交与 cursor 语义**不变** ｜ 边动作：**保留**（`StateLedger → {}` 仍是 DAG 的汇，不新增依赖边；被依赖侧新增 `AgentLifecycle` 一条反向消费者，使反向边由 5 条增至 6 条）｜ 理由：不变量 #3／#16——生命周期事实**必须经同一原子提交路径**，不能另建状态权威或第二个事件框架 ｜ 不变量：**#3／#16／#18／#19**。

**现有 commitKind 基线**（本模块已提交的 kind 集合；新增 kind 只能是**加法**，不改变既有语义）：

- 首切片与 P1 系列：`goal-create`、`bootstrap`、`evidence-intake`、`verification-result`、`governance-install`、`governance-activate`、`plan-revision`、`goal-reduction`、`dispatch-claim`、`dispatch-start`、`run-fact`、`handoff-record`、`replacement-claim`、`role-spec-install`／`role-spec-activate`。
- 协作通信（CM-1A-001 第 1 工作段，`contracts/coordination.ts` 的 `COMMUNICATION_COMMIT_KINDS`，**20 个**）：`agent-instance-register`、`initial-participation-start`、`participation-start`、`participation-end`、`directed-request-send`、`directed-request-respond`、`directed-request-cancel`、`subscription-create`、`subscription-cancel`、`subscription-catchup`、`subscription-catchup-page`、`wait-register`、`wait-cancel`、`communication-intent-record`、`communication-intent-cancel-request`、`communication-intent-claim`、`communication-route-page`、`communication-intent-settle`、`communication-intent-reconcile`、`communication-successor-claim`。
- 上两份清单按架构稿 §7.1 I5 与现行 StateLedger 模块／Interface 文档的扩展记录列出；**权威清单是源码 `contracts/ledger.ts` 的 `LedgerCommit` 联合**（另含 P1-07 的 lease／integration／patch 六个、reviewer-work、query-job、architecture-review 等切片的 kind）。
- **本次新增的 commitKind 名称、事件类型与聚合形状尚未设计**（I5）；新增后必须同时登记事件校验白名单与两个 ReadModel 的 `isHandledEventType` 白名单（漏登记会让整页 `ProjectionStallError`），并在两个 Adapter 的 commit 分派中**成对**核对（`tsconfig` 未开 `noImplicitReturns`）。

## 8. 信息缺口

- **对齐架构稿 §11.4.3**（引用，不重新推导）：
  - **①** 持久字段、主键与基数约束（Session 承载形态、Agent 实例标识、**旧标识兼容映射**）→ 架构稿 §9.2 第 1 份契约。
  - **②** 各 Port 的精确形状、字段命名、装配点（含 Kernel 适配面的划分）→ 架构稿 §9.2 第 2／4 份契约。
  - **④** 迁移切换点、删除顺序与回滚方式（含普通／Reviewer／Handoff 调用点）→ 架构稿 §9.2 第 4 份契约与 Prompt 6。
  - **⑥** 度量口径的具体采集实现（扫描次数等）→ 按 U12 指标表，标"**待测**"。
- **本模块新增缺口**：
  1. **新增 commitKind 的名称与形状待定**（I5）：Agent／Session 生命周期、复用、压缩、归档分别需要哪些 kind、事件与聚合，由接口设计确定；本模块**不预设**，也不为它新增状态权威。
  2. **`LedgerCommit.outboxIntents` 现固定为空**（只适用 `goal-create` 的历史情形）：P1-03 之后 outbox intent 已按路径非空（`dispatch-claim` 的 `DispatchIntentV1`、`communication-successor-claim` 恰好 1 条）；新增生命周期路径是否需要 outbox intent 待接口设计确认。
  3. **是否迁移按实际持久字段／表／索引判断**：**增加事件类型不必然要求改变数据库结构**（架构稿 §9.1 StateLedger 行）；`identity_claims` 槽的旧库回填与否、`WorkParticipation` 等聚合键是否随 `workId` 合并调整，都属迁移参数（"旧多身份不删不选赢家"是已定口径，回填是迁移动作）。
  4. **`ScopeCatalogPort` 与投影的边界**：它只用事件增量发现 Goal／QueryJob 再读 canonical 快照，**不是同一 cursor 下的业务投影视图**；`freshness` 的凭据仍只有 `CommitCursor`，两者的组合查询面未定。
  5. **可选能力的装配与降级**：`workDirectory?`／`memory?`／`alternativeReport` 在旧 Adapter 缺失时消费者须显式报告 `unavailable`；具体装配点与降级口径属 架构稿 §9.2 第 4 份契约，其中记忆能力**未冻结验收**。
  6. **两个 Adapter 的规则重复是内部维护债**：内存与 SQLite 各写一遍形状校验／提交分派，新增 kind 时必须成对核对（`ledger-validation.ts` 是共享校验的落点）；"先按职责拆分、提取共同逻辑"的排期与回滚点属 Prompt 6（C-11）。
  7. **不承诺跨存储原子**：Kernel 原始记录落盘与平台正式状态提交不是同一事务（架构稿 §9.3 规则 7）；外部文件系统与 SQLite 也不声称原子（`communication-successor-claim` 等路径沿用该口径）。

## 9. 重构目标与质量验收

> 通用依据：[代码规范、重构目标与质量验收](../../CODE-QUALITY-GUIDELINES.md)。本节已纳入本轮模块文档要求；以下均为重构目标与验收条件，**不表示源码已经达成或验收通过**。

| 当前问题／依据 | 本次目标与改动边界 | 共同实现与旧路径去向 | 验收证据（关联规则） |
| --- | --- | --- | --- |
| 内存与 SQLite 各有结构校验／commit 分派，新增 kind 必须成对核对（§1／§7／§8；S11） | 共用协议结构校验与机械分派；不把 ControlEngine 的业务归约下沉到 Ledger，也不新增第二事件框架 | 继续使用 `ledger-validation.ts` 与 Contracts 编码；等价验证后删除 Adapter 内重复机械分派，保留各自提交实现 | 现有全部 commitKind 与新增候选在两 Adapter 得到等价回执和事件形状；未知版本与未登记事件失败关闭（RG-01／RG-02／RG-03；CQ-01／CQ-04／CQ-05／CQ-08） |
| CAS、幂等、identity slot、snapshot＋Event＋outbox 的原子性依赖各 Adapter 的事务边界（§1／§2／§5） | 任何共用抽取都不得把这些约束移到事务外预检；Control 的先查守卫不替代 Ledger 事务内约束 | 共用纯校验与形状分派；SQLite 事务和内存原子替换分别保留，旧预检只作可读拒绝而非权威判定 | 覆盖 revision 冲突、相同／不同 fingerprint 重放、旧库缺 identity slot、提交中途失败和 outbox CAS；失败不得留下半份 snapshot/event/intent（RG-01／RG-04；CQ-01／CQ-03／CQ-06／CQ-08） |
| I5 需要新增生命周期相关 kind／事件，但名称、聚合形状及是否需要表结构变化尚未设计（§7／§8） | 只做加法演进并保留旧事件 v1 语义；字段、主键、迁移和 outbox 需求留给接口设计，不在模块文档冻结 | 新 kind 进入同一 `load/commit/events` 与校验路径；旧数据保持可读，兼容映射有来源，旧多身份不删除不选赢家 | 升级前后读取、restart、旧数据重放与投影重建；若迁移失败仍可读旧数据，并有回滚证据（RG-01／RG-04／RG-05；CQ-01／CQ-03／CQ-06／CQ-08／CQ-11／CQ-12） |

**专项验收场景**：两个 Adapter 对相同命令序列保持 CAS、幂等与事件页契约等价；事务中任一步失败都不产生部分提交；旧库已有绑定但缺 identity slot 时不会为同一任务创建第二身份。

**当前状态**：原子提交、CAS、幂等与既有校验支持已存在；机械分派收敛、I5 新类型、旧库迁移及完整双 Adapter 回归仍待设计、实现或验证。
