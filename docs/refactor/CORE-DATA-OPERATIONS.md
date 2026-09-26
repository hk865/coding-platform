# 核心数据结构与原子操作

```yaml
status: target-design-for-implementation
updated: 2026-09-23
scope: 从用户的数据结构方案确定核心对象、操作和一致性规则；不以旧 13 个模块反推边界
implementation: 分项标记现有实现、需重组和新增；接口表是目标契约，不表示全部已交付
```

本文落实用户已经给出的设计：核心由专用数据结构、算法和工具组成；业务选择目标及动作；工具隐藏查询、索引维护、来源定位、更新和同步的复杂度。执行结果反向维护图与状态是原方案的一部分。本文不新建永久 Agent 人格，不建立第二套 Kernel Session 日志，不要求所有关系是 DAG，也不要求一张图或一个数据库容纳所有数据。

本设计与 [编排状态机](ORCHESTRATION-STATE-MACHINES.md) 配套。本文定义操作及记录，状态机定义允许的转换、触发和重入；业务策略决定调用哪个操作。对旧模块的迁移由总体重构方案定义。首批保持现有 Task、Run、Plan、Artifact 的公开身份与版本语义，避免为重组目录同时改写全部历史记录。

详细文件与完整关键接口见[骨架总览](skeleton/README.md)及五篇模块页；共同字段见[CONTRACTS](skeleton/CONTRACTS.md)。本文保留数据/操作层说明，不能单凭下列语义表认定完整源码骨架或真实实现已完成。本轮细化明确了Run/QueryRun/维护共用Session占用，以及临时捕获与持久来源分离。

## 1. 数据分类与身份

用户的四块基础数据是“两类来源 × 当前／历史”，不是四个互不相通的数据库。

| 来源 | 当前 | 历史 | 持久身份与来源 |
| --- | --- | --- | --- |
| 工作会话 | 可调用的 Session、正在执行的 Run、承担的工作及协作关系 | 消息、工具结果、明确的决定、执行轮次、交接 | 平台 `SessionRef` 映射 Kernel Session ID；Run/TaskAttempt 沿用现有引用 |
| 文件产物 | 工作区文件、目录、未提交变更及当前源码关系 | Git commit/tree/blob；需要保留的未提交内容快照或 patch | `projectId + workspaceId`、规范相对路径、内容 digest、commit 与工作区观测版本 |

架构、任务、Session、协作、检索结构建立在这些来源及正式业务记录之上。它们可分别持久化，既能保存独有信息，也能为具体操作维护索引。

身份规则：

1. `TaskRef` 使用 `(projectId, goalId, taskId)`；PlanRevision 决定某个任务在哪一版计划里如何定义。返工可继续同一 Task，新增 TaskAttempt/Run，不因返工自动新增任务。
2. `ModuleRef` 是正式架构对象身份；目录名称不自动成为模块身份。源码映射记录该 Module 对应哪些路径。
3. `SessionRef = { projectId, sessionId }` 是目标新增的平台定位引用；存入 Ledger 时增加 `aggregateType: 'Session'`，沿用现有带类型的 AggregateRef 约定，不能把没有类型的引用直接传给 Ledger。绑定 `{ adapterId, kernelSessionId }`，其中 adapterId 指配置的 Kernel 存储实例，不只是厂商名称。平台 sessionId 与 Kernel ID 可以不同，但映射必须唯一、可恢复；不把 Run ID 当 Session ID。
4. Run 是一次执行，Session 是连续会话。一个 Session 可先后关联相关任务；同一 Session 同时只允许一个会修改其对话状态的执行。需要并行时创建另一 Session。
5. `AgentInstance` 与 `WorkParticipation` 沿用现有归因/通信记录。面向用户的 Agent 卡片由角色配置、Session、当前承担关系组成，不新建一个必须跨所有任务保持的“员工主体”。
6. 同一内容用 ArtifactRef 引用，不在每张图里复制正文。图边可以直接保存正式责任关系，不能把所有边都降为可删除投影。
7. 事件以原身份、源内 sequence 和明确 causation 连接。墙钟时间用于显示，不能单独证明并发事件的因果顺序。

历史兼容：TaskRef 只给现有 TaskTriple 一个语义名称，不为 Task 新造聚合键；RunRef/TaskAttemptRef 保留现有 aggregateType 和字段。PlanRevisionRef 仍以 planId 定位不可变版本，快照 aggregate revision 仍为 1，`planRevision` 仍是计划序号，两者不能混用。新增 Session 引用只扩展新记录/可选关联；旧 Run 没有 Session 映射时标为未映射，仅有实际 RuntimeRecord/Kernel 记录可核对时补关联，不按 Run ID 猜造 Kernel Session。

## 2. 共同调用契约

调用者的读取身份与协作参与身份分别表达：普通工作源/材料读取使用真实 RunRef 与角色授予，不强制先有 WorkParticipation；通信及正式 Agent 写命令仍按原精确参与身份和逐操作资格受理。详见[共同契约 §3](skeleton/CONTRACTS.md)。

以下名称是目标能力名，可以先由旧入口适配；不要求把现有所有方法一次迁名。工具 Adapter 从宿主获得调用身份，模型参数不允许伪造 actor、Run、能力授予或存储版本。

```ts
// 下列为文档级类型；TaskTriple、VersionedRef、RoleSpecPinV1 等直接复用 contracts。
type ProjectScope = { projectId: string };
type WorkspaceScope = ProjectScope & { workspaceId: string };
type Scope = ProjectScope | WorkspaceScope; // 每个具体操作下述选择一种，不接受含糊 scope
type TaskRef = TaskTriple;                  // 文档别名；不新增 Task 聚合或迁移既有键
type SessionRef = { projectId: string; sessionId: string };
type ExecutionRef = RunRef | QueryRunRef; // QueryRunRef 来自 contracts/query-job.ts，不伪造 Task/Run
type OperationRef = { aggregateType: 'CoreOperation'; projectId: string; operationId: string };
type SessionAggregateRef = SessionRef & { aggregateType: 'Session' };
type ModuleRef = { projectId: string; moduleId: string };
type WorkLinkTarget =
  | { kind: 'task'; ref: TaskRef }
  | { kind: 'work'; ref: WorkContextRef }
  | { kind: 'module'; ref: ModuleRef };
type WorkLinkRelation = 'responsible' | 'participates' | 'investigated';
type SessionWorkLinkRef = SessionRef & {
  aggregateType: 'SessionWorkLink';
  target: WorkLinkTarget;
  relation: WorkLinkRelation;                // 复合键，不再新造一个不透明身份
};
type VersionPin = VersionedRef
  | { ref: SessionAggregateRef | SessionWorkLinkRef | OperationRef; revision: number };
type RoleConfigurationRef =
  | { kind: 'role_spec'; pin: RoleSpecPinV1 }
  | { kind: 'legacy_template'; templateId: string; templateRevision: string };
type SourceCaptureRef = WorkspaceScope & {
  captureId: string;
  workspaceRevision: number;
  sourceDigest: string;
  configDigest: string;
  indexVersion: string;
};
type PersistedSourceCaptureRef = { capture: SourceCaptureRef; material: ArtifactRef };
// WorkspaceTools 返回有界临时捕获；WorkGraph 保存正文后构造持久引用，前者不依赖存储。
type ReadStamp =
  | { kind: 'platform'; cursor: CommitCursor }
  | { kind: 'plan'; ref: PlanRevisionRef }
  | { kind: 'source'; capture: SourceCaptureRef }
  | { kind: 'session'; ref: SessionRef; cursor: string };
type CommandMeta = {
  requestId: string;                 // 适配现有 CommandIdentity / idempotencyKey
  expected: readonly VersionPin[];   // 只包含本操作实际依赖/修改的版本
};
type ReadBasis = {
  atLeastCursor?: CommitCursor;      // 需要读到某次已提交修改时指定
  revision?: number;                // 读取历史版本时指定
};
type Page<T> = {
  items: T[];
  nextCursor: string | null;
  basis: ReadStamp;
};
type ReadResult<T> =
  | { status: 'ready'; value: T }
  | { status: 'not_ready'; observed: ReadStamp | null; required: ReadStamp }
  | { status: 'not_found' }
  | { status: 'rejected'; code: CoreError; reason: string };
type WriteResult<T> =
  | { status: 'committed'; value: T; replayed: boolean; cursor: CommitCursor }
  | { status: 'rejected'; code: CoreError; reason: string; current?: VersionPin[] };
type CoreError =
  | 'invalid' | 'forbidden' | 'revision_conflict' | 'idempotency_conflict'
  | 'not_found' | 'dependency_blocked' | 'cycle' | 'busy'
  | 'source_stale' | 'incomplete' | 'capacity' | 'unsupported' | 'unavailable' | 'cancelled';
```

约定与边界：

- 错误码是业务可处理的稳定语义；适配旧入口时保留其已有细分错误，不为统一外形丢失原因。
- 精确引用查询不先扫描图。普通文件、图、历史查询不强制先有运行中的 Run 或已激活 baseline；宿主仍执行实际适用的项目、路径和能力检查。
- `not_ready` 表示索引尚未到要求版本，不能返回 `not_found` 或用旧结果冒充当前。核心可直接读正式记录或推进所需索引；调用者不负责重建索引。
- 命令在同一请求身份、同一内容下重放原回执；同一身份不同内容返回 `idempotency_conflict`。旧 expected version 返回 `revision_conflict`，不静默覆盖。
- `requestId` 由适配层映射到现有 `CommandIdentity` 的幂等键；完整身份仍含 project、真实 actor，以及 Agent 调用适用的 principal。它不是全系统无作用域的请求键，也不取代旧 commandId/correlationId。
- 参数中的版本由查询回执或正式引用获得，不要求业务自行计算 digest。只对改变决定的对象进行版本核对，不对每个只读操作附加整项目版本门禁。
- **目标分页协议**：cursor 绑定查询条件与来源版本；读下一页复用已捕获来源，来源已无法继续读取时显式失效，不能拼接不同版本的页。**本轮代码不宣称已实现所有公开分页的捕获复用**：它只移除 `architectureMaterials` 内部按页反复调用 query 的循环，公开 `project_index` 分页与来源验证保持现有语义；公开 capture/cursor 协议及跨请求复用属于后续迁移。
- 长操作复用现有 Run/outbox/control-intent 的 `accepted → observed` 路径。返回“已受理”不表示模型已启动、文件已修改或 Session 已暂停。简单查询和内存算法不额外创建长期作业。
- 原子操作表示一个完整、受约束的业务动作，不等同于通用数据库 CRUD。数据库更新能原子提交；Kernel、文件与数据库之间使用可重试意图及结果核对，不假定跨系统事务。

### 2.1 关键写输入与兼容适配

工具不是接收任意 `object` 后自行猜意图。关键写入至少固定以下类型；表内的旧类型直接复用，新增引用按上述映射落到 Ledger：

```ts
type ClaimTaskInput = {
  taskRef: TaskRef;
  planRef: PlanRevisionRef;
  sessionRef: SessionRef;                  // 已存在映射；新建由 createSession 先完成
  role: RoleConfigurationRef;
  meta: CommandMeta;
};
type CreateSessionInput = {
  workspace: WorkspaceScope;
  role: RoleConfigurationRef;
  recommendedRefs: ArtifactRef[];          // 检索/继承建议，不是新的授权白名单
  initialLinks: { target: WorkLinkTarget; relation: WorkLinkRelation }[];
  meta: CommandMeta;
};
type ApplyPlanInput = {
  draft: PlanRevisionDraft;                // 既有完整类型；候选引用先由工具解析成此形状
  expectedGoalRevision: number;
  decisionRefs: VersionedRef[];            // 可空；工具限定为适用的正式决定记录，非正文引用
  meta: CommandMeta;
};
type RecordRunResultInput = {
  event: RuntimeEventV1;                   // 原 runRef/eventId/sequence 及类型化 payload
  meta: CommandMeta;
};
```

这些是目标窄入口的字段承诺，不要求引入一个包罗所有行为的通用命令解释器。新建目标与改计划仍由其原正式 handler 受理；RoleConfigurationRef 不替代每次 Run 的 RoleBinding，工具按配置及当前授权生成/解析原绑定。历史只有 template 的角色仍可读取，不为兼容创建虚假 RoleSpec。

### 2.2 无 Run 的材料访问契约

现有 `ArtifactPort.put` 的 owner 与 `open` 的 requester 都要求 Run/QueryRun 或其尝试引用。它们的底层内容寻址和来源检查可复用，但普通宿主查询、确定性捕获不能原样套这个门面；禁止为读取正文伪造 Run，也不能把去除 Run 前置条件误作取消权限检查。

```ts
// 由宿主/运行适配注入，绝不放进模型可自行填写的 tool schema。
type MaterialReader =
  | { kind: 'run'; requester: ArtifactOwnerRunRef; currentBasis?: MaterialBasisV1 }
  | { kind: 'host'; projectId: string; workspaceId?: string;
      actor: Extract<ActorRef, { kind: 'human' | 'system' }> };
type PlatformMaterialOrigin = {
  kind: 'platform_operation'; projectId: string; workspaceId?: string;
  requestId: string; actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
};
```

目标 WorkGraph 材料入口接收被绑定的 MaterialReader；按其真实范围执行适用性与读取政策，再调用 RecordStore。旧 Run 模式保持原回执和历史 owner 语义；宿主确定性捕获增加 PlatformMaterialOrigin，不改写旧 owner。`usage=current/historical_explanation`、来源版本与明确缺口继续保留。这里的 actor 是归因，授权仍来自真实宿主权限/现有运行能力，不能单凭 `actor.kind='system'` 取得全部材料。这是需实现的接口拆分，不是已有能力声明。

### 2.3 目标模块归属与禁止的反向调用

| 能力 | 公开能力/流程 owner | 内部协作 |
| --- | --- | --- |
| 图、任务、平台历史、Session 目录、邮箱、证据、有限记忆读写 | WorkGraph | 调 RecordStore；需要文件来源时调 WorkspaceTools |
| 已知文件/Git/源码查询与一次捕获 | WorkspaceTools | 自身完成 I/O；返回材料给 WorkGraph 或 AgentRuntime 保存，不能反调 RecordStore |
| Kernel Session 原日志读取、创建/恢复/压缩、Run 开始/控制 | AgentRuntime | 先调用 WorkGraph 受理/查映射，再调用 Kernel，再向 WorkGraph 记录结果 |
| `applyWorkspaceChange` 的 Kernel 编辑桥接 | AgentRuntime | 调用 Kernel 既有编辑工具；WorkspaceTools 提供路径/来源与变更捕获，实际结果交 WorkGraph 关联 |
| 纯目录归档/再启用及正式关系变化 | WorkGraph | 需要 Kernel 副作用的部分先由 AgentRuntime 实施并回报；WorkGraph 不调用 Kernel |
| 选择 Session/检索范围/返工方案，组合一次业务所需的读取 | Workflow | 调 WorkGraph、AgentRuntime、WorkspaceTools；不直接读库 |
| 事务、正文、持久索引适配 | RecordStore | 不执行业务策略或路径政策；原数据库可以继续分开 |

`findSessions/searchHistory` 返回平台关联及历史引用；需要原始 Session 页时，Workflow/Host 调 `AgentRuntime.readSessionHistory`。AgentRuntime 的 `prepareExecution`读取本次所需WorkGraph材料，历史Context由Kernel按绑定边界装配；WorkGraph不为组装全文增加对AgentRuntime的隐含依赖。工具可以统一展示入口名称，但组合调用必须遵守这条方向。本文表格描述操作语义，精确字段与方法归属以模块骨架为准；不另外实现一套同义接口。

## 3. 专用数据结构总表

| 编号 | 结构 | 正式内容 | 可重建或可替换部分 |
| --- | --- | --- | --- |
| D1 | 架构关系与版本 | 采用的模块/接口、职责、依赖、路径映射、变更决定 | 邻接索引、反向影响索引、展示布局 |
| D2 | 工作区来源结构 | Git 原记录；必要的未提交快照、捕获清单与来源证明 | AST/符号索引、观测依赖图、文本搜索索引 |
| D3 | 任务图与执行状态 | PlanRevision、任务/义务/真实依赖、尝试、结果与完成归约 | 就绪集合、依赖反向索引、任务卡片与时间线索引 |
| D4 | Session 目录与关联 | Kernel 映射、归档状态、任务/模块关联、延续/重组记录 | 按任务/模块/角色查会话的索引、忙闲卡片 |
| D5 | 执行与占用记录 | Run/TaskAttempt、执行授权、任务/Session/工作区占用、控制意图 | 活跃集合、待派发索引、控制状态展示 |
| D6 | 协作与邮箱 | 请求、响应、收件、等待、当前责任地址及参与者 | 收件箱分页索引、协作图、未读/待回应集合 |
| D7 | 结果、证据和历史引用 | Artifact 正文/来源、明确决定、检查轮次/结果、压缩/交接记录 | 全文索引、摘要检索和关联索引 |
| D8 | 角色、Skill 与可积累知识 | 已安装角色配置、Skill 来源版本、现有人工记忆记录 | 检索候选索引；长期领域知识与记忆管理是扩展面 |

结构数量不是顶层模块数量。同一个组件可维护多个紧密联动的结构；同一个结构也可以通过窄存储接口使用多种后端。

## 4. D1：架构图、观测关系与版本比较

### 4.1 最小内容与权威

正式架构继续使用 `ArchitectureBaselineRevision` 及其 active 引用。最小内容为：`moduleId/interfaceId`、名称与职责、显式路径映射、类型化依赖、版本、来源/决定引用。新增一个普通 module ↔ Session 关联不等同于修改正式模块依赖。

观测源码关系使用 `ArchitectureSourceSnapshotV1`：`workspaceRevision/sourceDigest/commitHash/indexVersion/mappings/nodes/edges/unresolved`。扩展文件/符号粒度时保持同样的来源绑定语义，不把索引版本当架构基线版本。

正式架构描述“采用什么职责及约束”；观测结构描述“这份源码实际发现什么”。两者可放在不同结构中，工具负责比较与关联。语义标签标明来源和状态（人工采用、工具观测、模型候选），不能把相关性分数改写成确定的代码依赖。

### 4.2 操作

| 操作 | 输入 | 返回与效果 | 特有约束 |
| --- | --- | --- | --- |
| `queryArchitecture` | scope、baseline revision/current/draft、锚点 module/file/session/task、关系类型、深度/分页 | 有版本的节点、边、来源与未解析项 | 没有 baseline 时可以查询草案或观测图；不能伪造已采用架构 |
| `queryImpact` | 来源版本、变更模块/文件集合、关系类型 | 反向依赖闭包、影响路径、未解析项 | 一般图用 visited 集处理环；结果保留“未知影响” |
| `compareArchitecture` | baselineRef、sourceCaptureRef 或两个正式 revision | added/removed/changed、违约边、环、unresolved | 机械差异不自动决定接受；不能将缺失来源当空图 |
| `proposeArchitectureChange` | 基于哪版、完整候选模块/接口/映射/依赖catalog、理由与来源 | draftRef、候选及版本 | 工具验证引用和形状，内部计算增量；语义方案由业务产生 |
| `applyArchitectureChange` | proposalRef、当前预期版本、适用决定引用 | 新 revision、active 引用与变更事件 | 仅执行该项目已采用的受理规则；普通观测/关联更新不触发全套架构审查 |
| `linkWorkToModule` | Session分支使用responsible/participates/investigated；Task/Work分支使用implements/investigates/affects；均带moduleRef、预期版本 | 正式关联及两侧查询索引变化 | 不要求任务先有Session；Plan.scope既有归属仍由Plan解释，新增工作关联不覆盖它 |

### 4.3 维护与复杂度

- 主键保存对象/边，正反邻接索引服务邻域与影响分析；读取已知主键不遍历整图。对删除边、修改映射维护相关邻接项。
- 目标模块依赖可以要求 DAG；对增边检测是否从目标可到达源，失败返回环路径。源码观测图不拒收环，否则恰好丢掉需要修复的事实。
- 正式版本与变更记录必须保留；布局与检索索引可以重建。文件重命名通过版本化映射维护，不能仅凭相似文件名宣称身份连续。
- 邻域查询目标成本为返回的节点/边规模；全图比较仍为 `O(V+E)`。局部变更使用受影响闭包；修改全局映射或解析配置时允许扩大到全图，需在回执解释原因。

现有复用点：[架构来源契约](../../coding-platform/src/contracts/architecture-source.ts)、[结构差异算法](../../coding-platform/src/control/architecture-reconciler/architecture-reconciler.ts)、[基线演进](../../coding-platform/src/control/control-engine/baseline-evolution.ts)。新增的是完整邻域/影响/关联工具；现有机械比较可直接迁作内部算法。

## 5. D2：工作区文件、Git 与观测源码图

### 5.1 最小内容

`WorkspaceRef`、规范 root、工作区登记 revision；捕获记录包括 `captureId`、HEAD、读取清单及每文件 digest、未提交变更身份、parser/indexVersion、捕获时间、未解析项。目录包含关系是树；Git commit 父关系是 DAG；实际 import/call/reference 关系是一般有向图。

不把工作区登记 revision 单独当成“文件没有改变”的证明。外部编辑和未提交变更必须由捕获清单、摘要和读取一致性检查覆盖。快照不必复制整个仓库：复用 Git 对象，并对本次确需保留的未提交内容保存 patch/blob 引用。

### 5.2 操作

| 操作 | 输入 | 输出/效果 |
| --- | --- | --- |
| `readWorkspace` | scope、路径/范围、current 或 commit/captureRef | 文件、目录、摘要及来源；可直接读取，不必先查图 |
| `captureSourceChanges` | workspace、上一 captureRef（可无）、映射/解析配置 | 一致的 captureRef、变更路径、观测节点/边、未知项 |
| `querySource` | captureRef、路径/符号/文本/依赖条件、cursor | 来自同一 capture 的结果页；AST、文本、路径查询分型 |
| `compareWorkspace` | 两个 commit/capture/working-state 引用 | 文件和内容差异、重命名证据、未解析/不可比较项 |
| `applyWorkspaceChange` | patch/文件动作、预期输入摘要、既有写能力/占用 | 实际应用回执及变更路径；结果关联对应 Run |

`applyWorkspaceChange` 的公开 Kernel 编辑桥接归 AgentRuntime，使用 Kernel 已有编辑工具与平台写入约束；WorkspaceTools 提供路径/来源核对及变化捕获，结果交 WorkGraph 登记关联，不建立第二套编辑器。D2 按文件数据对象列出操作，不表示所有操作都归 WorkspaceTools，也不增加它对 AgentRuntime 的反向依赖。返回的是实际变更事实；计划中的 patch、工具请求和编辑成功分别记录。

### 5.3 更新规则

1. 一次捕获内部完成读取与一致性验证；查询多页复用同一材料。来源在捕获期间改变返回 `source_stale`，取消/容量/解析能力不足显式返回，不静默截断成完整图。
2. 文件修改结果携带 changed paths，索引删除旧边、写入新边，并更新被影响的导入方。若符号解析、配置、依赖清单或目录映射改变，按解析器能力扩大失效范围；不能假定“仅重解析被编辑文件”总是正确。
3. 捕获工具拥有解析/索引维护复杂度；业务不手工更新 AST、反向依赖或搜索表。
4. 工具返回 capture 身份与 `complete/partial` 来源范围；对功能不支持的语言使用文本/路径检索，并标明未做语义解析。
5. 无文件变化时可复用来源版本；跨请求缓存必须以 HEAD、工作树清单/内容、配置与索引版本为有效性依据。首批不为了缓存性能跳过来源验证。

现有复用点：[ProjectSourceIndex](../../coding-platform/src/core/workspace/project-source-index.ts)、[源码身份](../../coding-platform/src/core/workspace/source-identity.ts)、[架构捕获](../../coding-platform/src/core/workspace/architecture-source.ts)、[工具适配](../../coding-platform/src/execution/worker-runtime/exploration-tools.ts)。本轮代码切片针对架构材料内部的分页重复捕获；不声称已交付持久增量源码索引。

## 6. D3：任务白板、状态、关系与候选查询

### 6.1 最小内容

**2026-09-24 纠偏，2026-09-26 源码核对：** 本结构服务协作、监测及 Session/证据查找，不替代 Agent 编排。预期依赖、影响提示与明确采用的输入消费条件分别表达；只有后者适用于实际消费条件检查，不能将前驱未整体 satisfied 当通用启动禁令。`next` 已有 v2 提示关系、精确输入及 W1 未来修订；W2 已接通显式 `plan_only/request_execution`，允许无完整验收或分配的未来意图先进入已采用计划，并可后续补全。`plan_only` 不可领取，节点存在不等于可执行或可完成；资格查询不按前驱整体 phase 阻塞。领取不要求预证明全部未来范围，详见[并行设计](PARALLEL-COLLABORATION.md)。

沿用 `PlanRevisionDraft/RuntimeTask/AcceptanceObligation/RuntimeExecutionDAG` 的身份与适用字段，关系/资格语义按上述边界修订。未来节点保存已知标题、意图、来源与范围；角色/指令、完成义务、验证条件及依赖可后续明确，不能为入图伪造检查或分配。未知与已有正式承诺分开，允许补全不意味着允许删除或弱化已采用验收。`parentOf` 表示分组，现有 `executionDag.dependsOn` 仅用于已采用的真实输入/产出依赖并保留 requires，未知/预期关系不得塞入该硬边集合，不以排列顺序代替依赖。

节点存在不等于执行就绪或完成。`queryTaskGraph` 必须包含待细化节点；候选查询应返回待分配/待明确执行条件等实际缺项，`claimTask` 核对执行必要条件，`completeTask/completeGoal` 核对当前采用的验收与证据，不能将空验收视为自动通过。角色/Workflow 应从完整图而非仅 ready 列表恢复未推进方向，Host/UI 展示这些节点及其待细化原因。该能力归入 W2/R3c，R5/R6 消费，当前缺口见实施方案。

首批保持现有 phase：`pending/ready/running/verifying/blocked/satisfied/failed`；disposition：`active/deferred/cancelled/superseded`。不把任务状态、执行结果、人的暂停意图和 Session 忙闲合成一个大枚举。业务需要的“待办、实现中、待验收、完成”由这些事实解释。

辅助结构：按 plan version 的正反依赖索引、未满足前置集合/计数、可领取集合、Task → 当前尝试/工作/Session 关联、事件时间线索引。辅助结构必须对应准确的 plan 与事实版本。

### 6.2 操作

| 操作 | 输入 | 返回/效果 | 关键失败 |
| --- | --- | --- | --- |
| `queryTaskGraph` | goalRef、planRef/current、关系/范围、ReadBasis | 任务、分组、依赖、当前状态及关联 | 索引滞后为 not_ready |
| `queryReadyTasks` | goal/workspace、角色/能力筛选、分页 | 可领取候选及阻塞解释、版本依据 | 不意味着已经占用，不把展示分页当准入证明 |
| `proposePlan` | 原 planRef（初次可无）、已知 tasks/assignments/obligations/edges、理由 | 计划候选、变化与校验问题；规划未完整是可见诊断 | dangling reference、重复身份、采用的硬依赖 cycle；已有义务不得被静默削弱 |
| `applyPlanChange` | proposalRef/规范化 plan draft、expected goal/plan、适用决定 | 新 PlanRevision、状态衔接、受影响任务集合 | 不静默删除已执行任务/义务；取消/替换显式处置 |
| `claimTask` | taskRef、planRef、所选 role/sessionRef、请求身份与预期版本 | attemptRef/runRef、任务占用、Session 占用和派发意图 | dependency_blocked、busy、版本冲突、不可用能力 |
| `releaseTaskClaim` | claim/attemptRef、理由与实际运行状态 | 释放未执行占用，或受理停止后的清理 | 已进入执行时先走停止/核对，不直接放出第二执行者 |
| `requeueTask` | taskRef、当前失败/检查引用、返工理由、expected | 保留原义务及失败，按既有返工处置建立再次领取的条件 | 未核对副作用不重跑；范围/验收改变需 applyPlanChange |
| `completeTask` | taskRef、planRef、verification round/证据引用、expected | 完成归约、受影响后继及事件 | 检查缺失/失败、来源过期、仍有未解义务 |
| `completeGoal` | goalRef、适用完成条件版本 | 目标归约及未完成解释 | 不用 UI 百分比或一句报告替代正式条件 |

任务领取把“任务允许开始”“Session 可用”“请求没有重复”和“创建待执行意图”放在同一正式提交中。若选择新 Session，先有稳定 Session 映射/创建结果，再领取；初次创建映射不启动模型。特殊只读调查不强行伪造一个编码 Task，可沿现有 QueryRun/探索入口并共用 Session/来源工具。

目标入口 `createGoal/updateGoalIntent` 继续通过已有目标命令记录正文与授权范围；它们不隐式创建已采用计划。上表完整计划/任务操作消费这些正式目标引用，不再另存一份业务层 Goal 状态。

### 6.3 增量推进

- 接受计划时构建/更新邻接关系；任务完成或依赖产物有效性改变时，只重新评估相关后继及显式关联义务。业务不逐项“通知后继”。
- 索引中的 ready 是候选；`claimTask` 使用同一套正式判据，在提交时核对版本和占用。可复用确定性的判据函数，不要求保留每次全量扫描的实现。
- 返工继续 Task 的新执行轮次；不能把“检查失败后返工”加入同一轮相互等待的硬依赖环。状态转移允许返回，执行历史追加新事件。
- 增边可做目标到源的可达性检测；整版计划校验为 `O(V+E)`。一次完成更新目标为相关后继及义务规模；全局完成政策变化确实可能要求重新评估全部关联任务。

复用：[Plan 结构](../../coding-platform/src/contracts/plan.ts)、[任务准入](../../coding-platform/src/control/control-engine/policies/task-eligibility.ts)、[领取](../../coding-platform/src/control/control-engine/claim.ts)、[完成归约](../../coding-platform/src/control/control-engine/task-reducer.ts)。目标不复制这些规则到每个工具 Adapter。

## 7. D4：Session 目录、历史索引与生命周期操作

### 7.1 新增平台正式记录

```ts
type SessionRecord = {
  ref: SessionAggregateRef;
  revision: number;
  kernel: { adapterId: string; kernelSessionId: string };
  lifecycle: 'active' | 'archived';
  health: 'available' | 'recoverable' | 'unavailable';
  role: RoleConfigurationRef;              // 已安装规格或兼容旧 template 引用
  workspaceId: string;
  lastExecutionRef: ExecutionRef | null;
  occupancy:
    | { kind: 'execution'; executionRef: ExecutionRef; generation: number }
    | { kind: 'maintenance'; operationRef: OperationRef; generation: number }
    | null;
  historyCursor: string | null;            // Kernel 原生 cursor，通过桥接使用
  createdAt: string;
  archivedAt: string | null;
};
type SessionWorkLink = {
  ref: SessionWorkLinkRef;
  revision: number;
  since: CommitCursor;
  until: CommitCursor | null;
};
```

availability `idle/busy/recoverable/unavailable` 由 occupancy 和 health 解释，执行与维护均占同一独占槽；UI 的 working/standby/paused/archived 继续结合 Run/control 的事实生成。不要另存一套必须手动同步的“当前 Agent 状态”。每个 SessionWorkLink 有且只有一个类型化目标，多种关联保存多条；工具核对 scope，同一复合键更新当前 revision，旧区间保留在正式事件历史里。上轮草案的 currentClaim/lastRunRef 尚未落成实际Session表，本次类型调整不构成已有Session数据迁移。

### 7.2 操作

| 操作 | 输入 | 输出/效果 |
| --- | --- | --- |
| `findSessions` | scope、task/module/work/role 条件、可用性、分页 | Session 卡片、关联理由、历史入口及恢复能力；不代替业务决定 |
| `readSessionHistory` | sessionRef、afterCursor/throughCursor、limit | 原记录引用、必要正文、来源 sequence；按需读取，不复制整条日志；跨主题筛选走平台searchHistory再定位 |
| `createSession` | 角色/Skill/Kernel 配置、workspace、初始关联、requestId | 稳定 SessionRef 与 Kernel 映射；失败可按同请求核对 |
| `continueSession` | 已领取admission、prepareExecution结果、请求身份/expected | 消费已有Run/QueryRun与Session占用进入同一driver；本方法不再claim |
| `compactSession` | sessionRef、记录范围、保留义务/决定引用、理由 | Kernel 支持时执行压缩，记录 before/after cursor、summaryRef、来源范围 |
| `regroupSessions` | 来源 Session 引用、目标角色/任务、交接引用及关系变更 | 新关联/Session 与交接记录；不把原日志修改成另一人的历史 |
| `archiveSession` / `reactivateSession` | sessionRef、expected、理由 | 改变活跃管理状态；保留映射、来源及历史关联 |

`prepareExecution` 是AgentRuntime的执行准备入口：从WorkGraph解析平台材料、定位版本、装配Skill与本轮必要输入，返回准备结果及缺口。Kernel内部按绑定的已完成历史边界进行Context选择与预算检查，平台不再实现一套历史选择器。连续执行沿用真实Kernel Session与存储实例；旧bundle必需字段不能假填，正文格式演进按Runtime骨架迁移。普通查询和历史读取不经这个准备流程。

压缩的实际摘要生成可以由 Kernel 或一次明确的 Agent 工作完成；候选摘要未经提交不得宣称 Session 已压缩。当前执行未停止时不能并发修改同一 Session。归档时有未完成工作则显式保留/转移责任与等待，不能因退出活跃集合丢弃义务。没有 Kernel restore/compact 能力返回 unsupported，不能伪造已恢复或已压缩。

### 7.3 存储与复杂度

- 平台仅新增 Session 目录、映射、关联和操作结果记录，落现有 StateLedger/RecordStore；Session 原记录与 checkpoint 继续由 Kernel Store 维护。
- 按 `(project, workspace, module/task/work/role)` 建专用索引；findSessions 读取命中候选而非重放所有 Run。无需先聚合整个项目再过滤。
- 历史读取按 cursor 分页；摘要/知识条目保存来源引用而非复制完整日志。归档变更更新活跃集合，正文无需迁移或重写。

当前差距明确存在：[RuntimeRecord](../../coding-platform/src/execution/worker-runtime/coding-agent-runtime.ts) 每次新 Run 产生随机 sessionId；完整平台 Session 目录与复用桥接不能当作现成实现。可复用 Kernel 的 [SessionStorePort](../../coding-platform/vendor/coding-agent/src/core/ports/session_store/session-store-port.ts) 与现有 [WorkContext](../../coding-platform/src/contracts/context-continuity.ts)，而不是重新实现它们的日志格式。

详细核对还发现：平台目前按Run使用独立Kernel数据库，Kernel同sessionId新调用也不自动继承已完成轮次的模型上下文。目标由稳定存储定位与[AgentRuntime骨架](modules/core/agent-runtime.md)规定的最小Kernel公开接口扩展接通；原生compact当前未实现，必须保留unsupported。能力配置或Session ID相同不能代替实际历史输入验证。

## 8. D5：执行、控制与占用

Run 保持现有 `status = starting/running/ended`，outcome 独立为 completed/failed/cancelled/budget_exhausted/crashed/outcome_unknown；暂停等意图保存在 controlState，并与 Kernel 观测分开。TaskAttempt、TaskLease、WorkspaceLease、DispatchOutbox、executionAuthorization 沿用已有记录；新增 Session 独占槽与 Run 绑定。

| 操作 | 输入 | 输出/效果 |
| --- | --- | --- |
| `startRun` | 已受理ExecutionAdmission、实际准备结果、请求身份/expected | Runtime核对后进入Kernel；Run/QueryRun分型；重复提交复用同次执行记录 |
| `recordRunResult` | admission、Kernel eventId/sequence、类型、结果/来源引用 | WorkGraph追加一次正式观测，更新Run/QueryRun、活跃集合和相关结果索引 |
| `setRunControl` | runRef、动作 pause/resume/cancel/steer、理由、expected | 记录 desired state 与现有 ControlIntent；执行完成另记观测 |
| 请求停止/恢复 | `setRunControl`受理pause/resume/cancel意图，再由Runtime.applyControl消费该引用 | 没有另外的requestRunStop/resumeRun公开Port；真实控制确认与正式受理分开；resume只恢复原Run，新Session接续是独立业务 |
| `reconcile` → `reconcileRun` | Runtime查询真实Kernel/技术映射，WorkGraph接收带ExecutionRef的实际观察 | WorkGraph不直接查Kernel；收敛为已完成/已取消/仍未知，决定是否安全释放占用 |

核心负责：记录任务/Session 承担关系与适用独占，核对既有授权，准确归因，处理终态和重复事件及旧 generation。对具体工具确有需要的资源协调按该操作采用，不对每个 Task 预占全部预测资源。业务负责：选择任务/Session、并行分工、冲突修正、暂停原因及是否换方案。按用户最新决定，同一工作区必须支持实际范围允许的多 Agent 并行；撤销旧“每工作区单写者”目标，当前源码限制列入迁移。

注释：架构模块不等于锁范围。之前新增 ScopeProposal、ResolvedFootprint、ResourceReservation 并要求所有 claim 先占实际范围的方案已撤回为普遍前置。范围比较、文件版本校验、必要隔离与局部资源协调属于具体工具能力，只有真实消费者需要时才落码，不先实施通用资源锁层。图和工具返回已有事实与未知，Agent 决定并行并根据真实结果修正；不因未来范围尚不完整而拒绝开始。当前行为图见[并行协作 §1.2、§3](PARALLEL-COLLABORATION.md)。权限边界不随图标签自动扩大。

Run 结束不等于 Task 完成；暂停请求不等于暂停成功；一次工具调用失败不自动意味着整个 Run 结束。unknown 保留不确定性，并阻止不安全地重复同一副作用。

复用：[Dispatch intent/Run](../../coding-platform/src/contracts/dispatch.ts)、[派发驱动](../../coding-platform/src/control/dispatch-engine/dispatch-engine.ts)、[执行授权](../../coding-platform/src/control/control-engine/start-run.ts)、[工作区占用](../../coding-platform/src/control/control-engine/workspace-lease.ts)、[Kernel 适配](../../coding-platform/src/execution/worker-runtime/coding-agent-runtime.ts)。

## 9. D6：Agent 协作图与邮箱

继续复用 `DirectedRequest/Delivery/WaitCondition/WorkParticipation`。当前 WorkContext 是持久责任地址：更换执行 Session 后未处理请求仍可找到负责人。不为了邮箱再给每条消息创造一个 Work；平台可以展示 Session 地址，但工具内部解析到现有责任地址及参与关系。

| 操作 | 输入 | 输出/效果 |
| --- | --- | --- |
| `sendMessage` | 目标 work/session/task 引用、kind request/report、正文或 artifactRef、replyTo、requestId | 正式请求/响应引用及收件状态；只登记成功后返回已发送 |
| `readInbox` | 当前调用者范围、状态筛选、cursor | Delivery/请求/响应页及正文引用 |
| `ackMessage` | deliveryRef、处理标记及 expected | 仅表示已接收/读取，不等同于回答完成或任务完成 |
| `respondMessage` | requestRef、正文/结果引用、expected | 正式响应、相关等待的确定性推进 |
| `waitFor` / `cancelWait` | 已有类型化条件引用、owner work、expected | 持久等待及满足/取消记录；等待满足至多受理一次后继 |

协作边允许往返；硬任务依赖仍保持 DAG。消息时间线以每次收发事件记录，不把双方互相回复认作历史因果环。策略决定沟通内容和是否需要等待；工具负责路由、幂等、可恢复投递和责任换手。

收件索引使用收件责任地址、状态和 cursor；普通读邮件不扫描/重放整个项目事件。发送、投递和等待推进复用现有有界路由及 intent，首批不另做独立消息总线。待迁移的旧路由机制只有在实际调用路径被替换后才能删除。

复用：[通信契约](../../coding-platform/src/contracts/coordination.ts)、[宿主绑定工具身份](../../coding-platform/src/contracts/coordination-tools.ts)、[通信实现](../../coding-platform/src/control/control-engine/coordination/)。上述工具名是对现有 request/respond/subscribe/wait/cancel 的目标整理，新增 ack 要显式定义与 Delivery 既有状态的映射，不声称已有同名入口。

## 10. D7：产物、证据、历史与检查

Artifact 保留 contentType/digest/sizeBytes/source；引用记录保留对应 Task/Run/Session、工作区版本和使用目的。数据存储保存“某次工具实际返回了什么”；是否满足当前任务由既定完成条件判断。没有明示来源的模型判断保持为判断，不提升为工具观测。

| 操作 | 输入 | 输出/效果 |
| --- | --- | --- |
| `storeArtifact` / `openArtifact` | 正文及来源/精确 ArtifactRef | 不可变内容引用/核验后正文；存入不代表业务采纳 |
| `recordDecision` | task/module/work、明确决定与理由、来源、适用版本 | 可检索决定记录；不要求或保存隐含思维链 |
| `searchHistory` | scope、task/module/session、类型、关键词、范围/cursor | 原记录/Artifact 引用、摘要、版本与适用性提示 |
| `openVerification` | task/plan/workspace 来源、既定检查要求 | 固定本轮所需检查与来源版本的 roundRef |
| `recordCheckResult` | roundRef、requirement/checkId、实际报告引用、来源版本 | 幂等结果，保留失败/未知/尚缺覆盖 |
| `finalizeChecks` | roundRef、expected | 完整覆盖及综合结果；不执行 completeTask 的正式完成写入 |

检查工具可直接运行静态分析、测试和格式检查；需要语义审阅时由业务派发相应工作，提交其报告。finalizeChecks 处理缺失/冲突/失败汇合，不自行要求每次操作都增加审阅 Agent，也不把任何一项 PASS 当整个任务 PASS。

更新顺序：正文先存并得到稳定引用，再在正式提交中登记来源/结果。登记失败时正文可成为未被引用的内容，但不得产生成功业务回执；重试复用引用。既有 Vault 与 Ledger 分库时延续此顺序，不引入跨数据库事务。

历史索引可按类型和对象建立倒排/关联结构；查询按请求读取有限正文，不先把所有 transcript 送模型。平台 RuntimeRecord 的事件记录不得持续以累计 JSON 重写替代增量保存；这项改造针对平台记录，不宣称 Kernel 原生 SessionStore 同样存在累计重写问题。压缩和摘要是新增有来源的记录，不能覆盖原事件或把历史授权继承为新任务授权。

复用：[ArtifactPort](../../coding-platform/src/contracts/artifact.ts)、[正文存储](../../coding-platform/src/data/artifact-vault/sqlite-artifact-vault.ts)、[验证轮次](../../coding-platform/src/control/verification-engine/verification-rounds.ts)、[执行记录](../../coding-platform/src/control/control-engine/work-record.ts)。

## 11. D8：角色、Skill、知识与记忆

当前已存在 `RoleSpecRevision`、角色矩阵、`MemoryScope/MemoryEntry/MemoryLedgerPort` 与人工记忆读写路径。不能把现有有限记忆能力说成完全不存在；也不能据此声称长期领域专家、跨项目知识积累和全套记忆检索已经完成。

| 操作族 | 最小数据 | 当前/目标边界 |
| --- | --- | --- |
| `readRoleConfiguration` / 既有 install/activate | 角色职责、工具、材料要求、输出要求、Skill 来源及版本 | 复用已有角色配置；角色不是 Session 内容副本 |
| `resolveSkillMaterials` | Skill 标识、来源版本、正文/引用 | 输入准备中的工具能力；业务决定选哪个 Skill |
| `readMemory` / `updateMemory` | scope、entryId/revision、content、origin、conditions、source、state | 复用现有 profile/project 记忆与 remember/correct/remove |
| `searchKnowledge` / `proposeKnowledgeEntry` | 主题/模块索引、Artifact 引用、出处、适用版本、候选/采用状态 | 扩展契约；未接入时返回 unsupported，不自动创建新知识服务 |

“经验”要有适用范围和来源；记录“版本 X 的测试通过”不能改写为“这个模块永远正确”。自动提炼的条目保持候选，采用规则属于明确的业务配置；本次不添加一套必经人工审核。纠正/作废更新引用和索引；人工删除的记忆正文不能在新审计日志里偷偷复制保存。

生命周期调用这些能力装配输入，但不拥有知识的所有读写入口。普通 Agent、秘书和人工界面都可以按能力使用同一工具；不能为了工具复用强迫所有访问经过生命周期策略。

复用：[角色配置](../../coding-platform/src/contracts/role-spec.ts)、[记忆契约](../../coding-platform/src/contracts/memory.ts)、[记忆写入](../../coding-platform/src/control/control-engine/memory.ts)、[现有记忆查看](../../coding-platform/src/data/read-model-index/memory-view.ts)。

## 12. 跨结构更新协议

工具维护同步，业务不手工串行更新各张表。为了做到这一点，只需要复用当前事务、幂等记录和有界异步推进，不需要引入新的分布式框架。

| 动作 | 同次正式提交必须一致 | 可稍后更新但需可追赶的部分 |
| --- | --- | --- |
| 接受计划变化 | 新 PlanRevision、相关处置/责任、变更事件 | UI 图布局、全文索引；依赖/ready 索引若异步则 claim 不信任旧版本 |
| 领取任务 | TaskAttempt/Run、任务与 Session 占用、派发意图及关联 | UI 活跃卡片；启动必须使用正式回执 |
| 接收 Run 终态 | 精确 Run 结果、对应占用清理、结果/来源引用 | 历史检索、协作视图；终态未确认不提前释放 |
| 完成任务 | 检查/义务版本核对、正式完成记录及事件 | 后继展示；领取仍用共同准入规则 |
| 修改源码 | 文件变更实际结果不能和 DB 假装同事务；登记精确观测 | 受影响源码索引、反向依赖、架构差异；标明 capture/version |
| 发送/响应消息 | 请求/响应受理与必要等待状态 | 分页投递和收件索引使用既有 intent；重复推进不重复后继 |
| 归档/重组 Session | 目录、责任/关联变更与交接记录 | 卡片/搜索索引；Kernel 操作结果确认后才登记实际状态 |

索引异常时保留正式记录和推进位置，只重试受影响的页/对象；不能让图修改成功而索引落后看起来像数据丢失。无需所有读取等待整个系统投影追平，只保证它请求的数据和版本。

## 13. 真实存储映射与迁移范围

| 内容 | 当前真实落点 | 本轮目标处理 |
| --- | --- | --- |
| 正式快照、事件、幂等与唯一身份槽 | `SqliteStateLedger` 的 snapshots/events/idempotency/identity_claims | 复用事务和 CAS；新增 Session/关联记录类型；按操作需要加索引，不先迁全库 |
| 正文和来源 | `SqliteArtifactVault.artifacts` | 复用内容寻址与来源；与结构记录共属存储能力但可继续分库 |
| 任务图、活跃卡片、历史视图 | `SqliteReadModelIndex` 的 plan_graph/task_detail/active_agent 等 | 图/ready/Session 专用索引按实际查询增加，避免依赖全量 JSON 扫描；不以投影重建代替正式关联存储 |
| 文件与源码索引 | WorkspaceReader 的捕获、解析、ProjectSourceIndex | 先消除一次操作中重复捕获/分析，再做跨请求增量索引 |
| Session 日志与 checkpoint | vendor Kernel 的 SessionStorePort/CheckpointStorePort；平台 RuntimeRecord 有有限映射 | 桥接 Kernel 存储；平台保存目录/关联，不另做第二套 Session 事件正文 |
| 邮箱、等待与责任地址 | Ledger 通信记录与既有投影 | 暴露简洁工具；复用持久投递/去重，不建立第二消息总线 |
| 人工记忆 | 现有 MemoryLedgerPort 适配与 profile/project scope | 继续复用；长期专家知识是可积累扩展，不以新身份系统前置 |

实现证据：[Ledger schema](../../coding-platform/src/data/state-ledger/sqlite-ledger.ts)、[ReadModel schema](../../coding-platform/src/data/read-model-index/sqlite-read-model-index.ts)、[Kernel SQLite stores](../../coding-platform/vendor/coding-agent/src/storage/adapters/sqlite/sqlite-stores.ts)。这些是现状映射；目标模块名称变化不要求同步更换数据库。

## 14. 性能与精简的具体目标

| 热路径 | 已核实事实或待实现约束 | 预期工作量与保留理由 |
| --- | --- | --- |
| 架构图捕获 | 改前 `architectureMaterials` 内部每页 imports 再调用 query，重复全量捕获/摘要、关系遍历与诊断；TS 服务已经复用未变脚本，不能称每页重新 parse 全仓 | 本轮 R1 已改为一次关系提取，保留 capture 与 verify 两遍捕获。3 页场景由 6 次捕获/3 次关系提取降为 2/1；公开跨请求分页仍待迁移 |
| ready 查询/推进 | 已核实 `task-eligibility` 的 tasks.find、dependsOn.filter 与前驱查找；未证明每个事件都扫描全部历史 | 依赖索引与相关后继更新；计划/政策整体变化允许重新评估 |
| Session 选择 | 完整候选器尚未实现；避免从全部 Run/transcript 重建是目标约束，不是现有性能测量 | 按任务/模块/角色命中关联索引，正文按需读 |
| 连续执行 | 当前每新 Run 组装所选材料，存在有界 bundle/selection；尚未贯通 Session 延续，不等于每轮装全部历史 | 同 Session 延续；只解析新增引用/变化来源；真正重组才构造新输入 |
| 结果记录 | 平台 RuntimeRecord 累计 JSON 重写；不是 Kernel SessionStore 的一般结论 | 平台增量保存与原生引用；摘要另存，不覆盖原历史 |
| 多种图/卡片同步 | 目标设计禁止业务手工同步多个索引；是否重复按具体调用路径核对 | 一份领域操作维护正式关系和相关索引，UI 读取结果 |
| 通信 | 已有事件重建的通信视图；是否每次读邮箱都走完整重建需按宿主消费链验证，不能由投影函数单独断言 | 收件地址/状态/cursor 索引；路由按既有分页有界推进 |

R1 的同次架构读取去重已实现，其捕获/关系提取次数有本轮测试证据；其余各行是后续实现目标，不能写成已测得的性能收益。索引带来额外存储与局部写入，但减少反复全量读取；增量更新必须保留正确的失效范围。没有需要的查询，不提前建立索引或新增一套服务。

验收按具体行为进行：重复请求不重复启动；两个调用不能同时占用同一 Session；新增结果只影响相关索引；分页属于同一来源；局部/全量结构比较结果一致；返工追加执行而不制造任务依赖环。代码量与可读性比较应包含删除的重复流程和兼容适配的数量；性能主张附实际调用/捕获次数，不只看模块数。

## 15. 本次设计确定的边界

1. 核心维护多种专用数据结构和完整操作，不压缩成一张通用图或裸 CRUD。
2. 业务决定规划、角色、Session 选择、并行及返工策略；共同准入、写入、版本、来源、恢复和检查汇合规则由工具实施。
3. 同一事实只有一个正式修改路径，多个结构可各自持久化独有内容或索引；不要求全部成为可删除投影。
4. 任务依赖与目标模块依赖按各自约束保持 DAG；状态机、协作关系允许回路；执行历史按具体事件追加。
5. 普通查询、首个 baseline 前探索、持续 Session 工作都能走直接能力路径，不强制穿过整条旧的计划/上下文/审查流水线。
6. 复用已实现的事务、解析、差分、执行和通信机制；取消模块边界不等于重写这些实现。模块划分根据这些操作的变化边界确定。
