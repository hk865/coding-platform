# src/composition：唯一装配根——把受信任配置和各模块 owner 接成可关闭的 TargetPlatform

## 负责什么，不负责什么
- 装配层：可以接各模块并构造服务；只装配/接线，不复制领域规则，不把业务选择写进这里。
- 生产代码唯一构造 `createTargetPlatform` 的地方；Host 只经它拿公开端口，不能另建服务图。
- 不写状态：任何状态迁移只经 `src/core/work-graph/state/`（AGENTS 第 9 条）。
- 不被 `src/core`、`src/business` 反向 import；`src/app` 可以依赖本层。
- 默认值只作显式 seam：不发明 secretary profile、容量上限或 wake driver。
- 记录格式只在 `schemas`（`src/composition/create-platform.ts:766`）注册一次：每个 codec 文件的 schema 束按 records、events、lookups 三段展开，内存和 SQLite 两种后端用同一份；Session 活动记录的 `SESSION_ACTIVITY_SCHEMAS`（`src/core/work-graph/sessions/session-activity.ts:39`）和初始化绑定的 `INITIALIZATION_BINDING_SCHEMAS`（`src/core/work-graph/persistence/initialization-binding-codecs.ts:9`，带两条 lookup）也在其中。新格式只加进这三段，不另建 schema 集。
- 内部 owner 挂在 `platform` 上但不可枚举（`src/composition/create-platform.ts:2722`），公开 key 表不变，路由层按属性读。秘书生命周期是一个 owner 组：`sessionHandoff`（`src/composition/create-platform.ts:2625`）由 accept（`createSessionHandoffService`，`src/core/work-graph/sessions/session-handoff-service.ts:168`）和 advance（`createSessionHandoffAdvanceService`，同文件 `:544`）两个 owner 组成；`sessionArchive`（`src/composition/create-platform.ts:2626`）是手动归档的 accept+advance（`createSecretaryArchiveService`，同文件 `:1418`），对外的两个方法经 `trackedCall` 发布、raw owner 留在内部；同一处还发布 `readHandoffFence`、`listUnfinishedOperations`、`readSecretaryHandoffBasis` 三条读，全部经 `trackedCall`；`listUnfinishedOperations` 只答 handoff 和 secretary-archive 两臂并带种类（`{operation, revision, kind}`），别的未完成操作不是可继续的交接。手动归档的预检由 `handoffFacts.checkArchiveCondition` 注入归档 owner（`src/composition/create-platform.ts:1822`）。条件由 `sessionLifecycle` 的持有者（`src/composition/create-platform.ts:1197`）在装配完成后直接收 `handoffFacts.checkArchiveCondition`（`src/composition/create-platform.ts:1753`），不另设条件分派器。H 的 brief 端口 `createHandoffBriefPort`（`src/core/work-graph/sessions/session-handoff-brief.ts:22`）注入 D 的 `brief`（`src/composition/create-platform.ts:1007`），`createHandoffNoticeSource` 的 `handoffNotices`（`src/core/work-graph/views/handoff-notices.ts:168`）进 `noticeSources`（`src/composition/create-platform.ts:1161`）；它们和 owner 共用 `sessionDirectory` 与 `sessionDutyResolver`（`src/composition/create-platform.ts:952`）。

## 文件
- `architecture-reminder-facts.ts` — 当前正式 catalog 版本进观察提醒事实；读失败原样返回，abort 为 cancelled。
- `commit-observer.ts` — 包住共享 `records.commit`，上报真正追加事件的 commit；观察器失败被吞掉。
- `create-platform.ts` — 唯一平台装配：storage/body store、Kernel stores、Workspace、Runtime、WorkGraph owner、Workflow、秘书准备事实端口、秘书生命周期 owner（交接/手动归档、事实、brief、通知、交接 basis 与未完成操作的读）、提示词包与关闭 drain。
- `session-duty.ts` — 受信任 Session duty 解析：pinned RoleSpec、精确 legacy template、配置的执行者回退；失败为 unknown。
- `tool-commit-lookup.ts` — 按固定 tool 名表把已提交调用查询派给 mailbox/decision/plan/notes/CRR owner。
- `work-line-conversation.ts` — line conversation 分页：按 segment 顺序读原始 Session 历史，链变化为 source_stale。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createTargetPlatform` | `src/composition/create-platform.ts:740` | 从受信任 `TargetPlatformOptions`（`src/composition/create-platform.ts:273`）构造唯一平台实例：storage、Kernel stores、Workspace、Runtime、WorkGraph owner 与 Workflow | Host、集成测试或直接平台要一组真实 owner 时；不要另建服务图 |
| `createSecretaryPreparationFacts` | `src/core/work-graph/views/secretary-preparation-facts.ts:507` | 秘书请求轮的准备事实端口（一次读齐轮材料、批、早先历史、workspace、架构、治理指针与 Goals）；无可信 Runtime 时不构造 | Runtime 组装请求轮输入；组合根按 `queryExecution` 是否存在决定是否注入 |
| `createSecretaryOpenCapCapacity` | `src/composition/create-platform.ts:692` | 按 `secretaryOpenCap` 统计活跃 secretary Session，到上限拒绝新线；本次 admission 的 `replaces` 源与活着的交接后继在 provenance 里点名的前任各只算一次（卡片自带 provenance，不额外读） | Host 配置了 cap 时；无 cap 用 business 的 `createAlwaysAdmitCapacity` |
| `createSessionDutyResolver` | `src/composition/session-duty.ts:55` | 从 Session 固定 role 事实解析 platform duty（role_spec 的 `platformDuty`、精确 legacy template、Host binding 回退），读失败返回 `unknown`；经 `sessionDutyResolver`（`src/composition/session-duty.ts:55`）注入；**正本** | Session 资格、profile 资格与容量计数；`src/app/secretary-profiles.ts` 现委托本正本，不要再写 duty/legacy 判断（FP-02、MH-01） |
| `observeRecordCommits` | `src/composition/commit-observer.ts:68` | 包住 `records.commit`，只上报真正追加事件的 commit 的粗粒度聚合 | 变更流或启动观察；观察器失败不得影响写入结果 |
| `createToolCommitLookup` | `src/composition/tool-commit-lookup.ts:37` | 按固定 tool 名表把已提交调用查询派给对应 owner | unknown-call review 的已提交调用查询；不要自己再写 name 到 owner 的分派 |
| `createArchitectureReminderFactsReader` | `src/composition/architecture-reminder-facts.ts:17` | 先读当前正式 catalog 版本，再读观察提醒事实；abort 返回 `cancelled` | 上下文装配器的提醒读取 |
| `createWorkLineConversation` | `src/composition/work-line-conversation.ts:104` | 按 segment 顺序读原始 Session 历史并分页，链变化返回 `source_stale` | `lines/page` 的 conversation 段 |

## 内部用
以下导出只供本层使用：`MAILBOX_COMMIT_LOOKUP_TOOLS`、`DECISION_COMMIT_LOOKUP_TOOLS`、`PLAN_COMMIT_LOOKUP_TOOLS`、`NOTE_COMMIT_LOOKUP_TOOLS`、`COMMAND_RERUN_COMMIT_LOOKUP_TOOLS`。

## 不要做
- duty/legacy 判断只有 `createSessionDutyResolver` 一份（`legacyTemplateIsSecretary` 不存在）；`src/app/secretary-profiles.ts` 委托本正本，不要再写 duty/legacy 判断（FP-02、MH-01）。
- 不要复制领域规则或状态迁移：状态写入只经 `src/core/work-graph/state/`（AGENTS 第 9 条）。
- 不要另建第二个平台/服务图，也不要把某项业务选择（哪个 owner 做决定）写进装配层。
- 不要绕过 `trackedCall`（`src/composition/create-platform.ts:1324`）发布异步端口；关闭时用同一 drain，detached work 走 `trackDetached`（`src/composition/create-platform.ts:1335`）（MH-07）。
- 不要给未配置 `secretaryOpenCap` 的 Host 发明 secretary 或自造全放行 adapter：无 cap 时 `requestCapacity`（`src/composition/create-platform.ts:1740`）直接走 `createAlwaysAdmitCapacity`（`src/business/workflow/line-creation.ts:64`），默认 profile 端口是 `defaultSecretaryProfiles`（`src/composition/create-platform.ts:1735`）的显式 null（FP-15、MH-02、FP-12、MH-12）。
- 不要假设 wake driver 已存在：`createRequestIntake`（`src/business/workflow/request-intake.ts:185`）的 `wake` 来自平台选项 `requestWake`，没有它就什么都不接，提交的轮留在记录上等 Query 路由或下一个 Host；平台自己不推进任何轮。`requestRounds` 的 `open` 与 `unassigned` 一样经 `trackedCall` 发布，队列按页读、不写状态。
- 请求轮的授权预算只有一处：`createAuthorizeQueryConfiguration`（`src/composition/create-platform.ts:678`）的 `requested` 取 `queryExecutionBindingOf(input.job, input.run).runtimeBudget`（请求轮是认领时冻结的 profile 预算，普通 Query 与旧的 Job intent 相同）；不要在别处再读 Job intent 的执行预算。
- 新增 Host 选项必须声明、校验、转发、重开都走：`secretaryOpenCap`（`src/app/host.ts:171`）校验（`src/composition/create-platform.ts:744`）后进 `createTargetPlatform`（`src/composition/create-platform.ts:740`）到传给 cap adapter 的 limit（`src/composition/create-platform.ts:1742`）；`secretaryProfiles` 在 `src/composition/create-platform.ts:365` 声明（FP-15、MH-02）。
