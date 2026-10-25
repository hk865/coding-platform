# src/core/work-graph/sessions：Session 目录、生命周期、消息与记录编解码（L3）

## 负责什么，不负责什么
- L3，允许依赖 `model`、`state`、`persistence`、`materials`、`architecture`；不得 import `queries`、`tasks`、`notes`、`evidence`、`communication`、`views`、`agent-runtime`、`app`、`business`、`composition`。
- 拥有 Session/CoreOperation/SessionWorkLink 的正式创建、注册与读取，以及 link/archive/reactivate、健康观测、责任转移和 Session/消息 codec。
- 状态迁移不在本层决定：生命周期、占用、归档与健康写入都经 `state/session-availability.ts` 的构造器和守卫，这里只收集事实、加 guard、提交。
- `tasks` 的事实只能经窄端口注入（如 `SessionResponsibilityBasisPort`），不能直接 import `tasks`；模块目标经 `architecture` 的 `readCatalogModuleFacts`。
- 不做 Query/Note/Evidence 的读取、调度或界面投影。

## 文件
- `lifecycle-contracts.ts` — link/archive/reactivate 的端口与 store 依赖类型，无运行时导出。
- `lifecycle-record-codecs.ts` — SessionWorkLink/归档/健康/责任事件 codec，复用既有 Session/WorkLink 记录 schema。
- `message-body-envelope.ts` — SessionMessage body 信封与用户决定 answer body 的编解码。
- `message-record-codecs.ts` — `SessionMessage@1` 记录/事件 codec 与消息查询索引；消息里的决定来源按 `DecisionSubjectShape` 校验（只有 `subject`，不再有并列的 `goalRef`），K3 已答复按来源 Goal 的索引路径是 `decision.source.subject.goalRef.goalId`。
- `session-activity.ts` — Session 活动记录（`SessionActivity@1`）：codec 与 schema 注册、ref/guard 助手、纯推进 planner 与读端口；只编码一条记录，状态写入仍由 `state/` 构造。
- `session-directory.ts` — Session 目录：Session 的正式创建/注册，写 SessionRecord/SessionWorkLink/CoreOperation/Kernel 映射 claim，并提供 Session 卡读取。
- `session-handoff-service.ts` — 交接 owner 的接受（`handoff.accept`）：经共用写入执行器记一条交接操作（revision 1、`accepted`）；拒绝顺序是 `state/session-handoff.ts` 的 `admitHandoff`。
- `session-health.ts` — Host reconcile 的 Session 健康探测结果观测与写入。
- `session-lifecycle.ts` — link/archive/reactivate 写服务，精确 CAS Session 与 link。
- `session-links.ts` — 一个 Session 自身 work links 的完整读取（有上限，超限明确 `capacity`）。
- `session-record-codecs.ts` — Session 家族 schema 注册、纯 encode/decode、聚合键、provenance 等形状校验；`CoreOperation` 按 `action.kind` 分派到手写的创建分支或两张字段表，并检查顶层 `workspaceId`、每个嵌套 `projectId` 和只有创建才有的 observation。
- `session-responsibility-service.ts` — 责任转移与归档责任处置，绑定同一 commit cursor。
- `session-targets.ts` — 创建/链接目标的正式校验：Task 走 Goal+当前已采纳 Plan，Module 走当前架构目录。
- `trusted-context.ts` — 可信 Host 入口、写请求同步隔离、身份/指纹/事件 ID 助手。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createSessionDirectory` | `src/core/work-graph/sessions/session-directory.ts:560` | 返回 Session 目录端口：创建/注册/读取/按条件列 Session | 需要 Session 的正式写入或目录读取时 |
| `readSession` | `src/core/work-graph/sessions/session-directory.ts:1237` | 读一个公开 Session 卡，含可用性与当前 revision | 需要按 `SessionRef` 读卡片时 |
| `stableSessionCreationIdentity` | `src/core/work-graph/sessions/session-directory.ts:161` | 由 actor/project/request 推出稳定的 operationRef 与 plannedSessionRef | 创建前查重、重试或容量预检 |
| `kernelSessionClaimKey` | `src/core/work-graph/sessions/session-directory.ts:174` | Kernel Session 独占映射槽 key | 绑定/检查 Kernel 映射 claim 时 |
| `checkSessionProvenance` | `src/core/work-graph/sessions/session-record-codecs.ts:392` | 校验 new/task 续接/secretary handoff/readonly-copy provenance | 跟随 successor 或排除副本时 |
| `checkPlainSessionRef` | `src/core/work-graph/sessions/session-record-codecs.ts:158` | planned SessionRef 输入的报错适配器：只允许 projectId/sessionId，报两条固定文字 | planned SessionRef 字段；不能换成 `sessionRefProblem`（正本 `src/core/work-graph/persistence/rework-codecs.ts:154`，CS-11、M1-31） |
| `operationRefKey` | `src/core/work-graph/sessions/session-record-codecs.ts:1066` | CoreOperation 的规范 key | 读写创建操作记录时 |
| `sessionAggregateRefKey` | `src/core/work-graph/sessions/session-record-codecs.ts:1069` | 完整 `SessionAggregateRef` 的规范 key；**正本**（同文件的 `sessionWorkLinkRefKey:1073`、`plainSessionRefToAggregate:1076` 一起用） | 读、guard、claim、比较 Session 时 |
| `plainSessionRefKey` | `src/core/work-graph/sessions/session-record-codecs.ts:1079` | 普通 `{projectId, sessionId}` 输入的规范 Session 键（记录 refKey），丢掉额外字段 | 请求队列、执行读取与秘书选择的内存 Map 键；不要内联序列化 |
| `plainSessionRefToAggregate` | `src/core/work-graph/sessions/session-record-codecs.ts:1075` | 普通 SessionRef → 带 `aggregateType` 的聚合 ref | 目录/记录 key 需要聚合形式时 |
| `sessionWorkLinkRefKey` | `src/core/work-graph/sessions/session-record-codecs.ts:1072` | SessionWorkLink 的规范 key | 链接记录的读、guard、claim |
| `trustedContext` | `src/core/work-graph/sessions/trusted-context.ts:33` | 校验 Host principal、scope 与 AbortSignal，未绑定即拒绝 | 每个 Session 写入口的第一道边界 |
| `ownRequest` | `src/core/work-graph/sessions/trusted-context.ts:59` | 在首个 await 前同步克隆 GraphWrite，并取出 requestId/expected | 需要隔离调用方可变输入时 |
| `identityKeyOf` | `src/core/work-graph/sessions/trusted-context.ts:81` | 拼 Session 操作的 identity key（含 actor/scope/requestId） | 构造 Session 命令身份时 |
| `fingerprintOf` | `src/core/work-graph/sessions/trusted-context.ts:92` | 拼指纹，并把 expected pins 按规范 ref 排序后纳入 | 构造 Session 请求指纹时 |
| `eventIdOf` | `src/core/work-graph/sessions/trusted-context.ts:111` | 由 identity key 加后缀派生事件 id | 生成 Session 事件 id 时 |
| `readSessionWorkLinks` | `src/core/work-graph/sessions/session-links.ts:29` | 经注册索引完整读一个 Session 的 links，返回读取 watermark | 构建 Session 卡或判断归档阻塞时 |
| `createSessionLifecycleService` | `src/core/work-graph/sessions/session-lifecycle.ts:259` | link/archive/reactivate 的 GraphWrite 服务，含 replay 恢复 | 生命周期写入口 |
| `createSessionHealthService` | `src/core/work-graph/sessions/session-health.ts:78` | 在 Host 实例租约下观测并写入 Session 健康 | Host 启动 reconcile 或 Turn closure |
| `createSessionResponsibilityService` | `src/core/work-graph/sessions/session-responsibility-service.ts:105` | 责任转移/关闭/归档责任处置，绑定同一 cursor | 责任交接与归档步骤 |
| `validateTaskTarget` | `src/core/work-graph/sessions/session-targets.ts:70` | 校验 Task 目标属于 Goal 当前已采纳 Plan，并返回 guards | 创建或链接 Task 目标时 |
| `validateWorkLinkTarget` | `src/core/work-graph/sessions/session-targets.ts:129` | 按目标种类校验（Task/Module，WorkContext 明确 unsupported） | 链接目标写前校验 |
| `sessionActivityCodec`、`SESSION_ACTIVITY_SCHEMAS` | `src/core/work-graph/sessions/session-activity.ts:38`、`src/core/work-graph/sessions/session-activity.ts:39` | `SessionActivity@1` 的记录 codec 与 schema 注册组 | 组合根注册 schema、提交前编码恰好一条活动记录 |
| `sessionActivityRefOf` | `src/core/work-graph/sessions/session-activity.ts:42` | 由 SessionRef 构造活动的完整带标记 ref（`aggregateType: 'SessionActivity'`） | 读、guard 或比较活动记录时；不要内联拼 key |
| `planSessionActivityAdvance` | `src/core/work-graph/sessions/session-activity.ts:51` | 一次 `readMany` 读 Session 的创建时刻与当前活动记录，返回下一条编码记录**和**它的 revision guard；不写任何东西 | 会推进活动的事实提交；调用方把 guard 并进自己的提交 |
| `activityGuardOf` | `src/core/work-graph/sessions/session-activity.ts:99` | 把 planner 给的 guard 转成 store 的 CAS 形状：revision 0 是缺失默认，写成 `expectedRevision: null` | 和调用方其余 guards 合并时 |
| `createSessionActivityReader` | `src/core/work-graph/sessions/session-activity.ts:112` | 活动记录的读端口：一次 `readMany` 同时在**同一批**里读 Session 与活动记录；记录缺失时返回 revision 0 与 Session 的创建时刻，`record: null` | 读 Session 活动；任何 principal 都核对：读之前比 project，解码 Session 之后比 workspace，不符一律 `forbidden`（同 `tasks/planning-question-reader.ts`） |
| `createSessionHandoffService`、`SessionHandoffPort` | `src/core/work-graph/sessions/session-handoff-service.ts:66`、`:48` | 交接 owner：`acceptHandoff` 记一条交接操作，重放回原回执，同一源只留一个未完成操作；源和 `existing` 目标经公开的 `readSession` 读（别的项目或工作区的 Session 答 `not_found`） | 组合根接成内部 owner `sessionHandoff`；推进步骤也挂在这个 owner 上 |
| `HandoffAcceptInputV1`、`HandoffAcceptResultV1` | `src/core/work-graph/sessions/session-handoff-service.ts:42`、`:47` | `acceptHandoff` 的输入（工作区、源、触发、每个分配的目标和任务、`commandId`）和结果（操作 ref，阶段 `accepted`） | 交接路由和推进步骤调交接 owner 时 |
| `sessionHandoffRecordedCodec`、`secretaryArchiveRecordedCodec` | `src/core/work-graph/sessions/session-record-codecs.ts:968`、`:974` | 两个分支每次写都追加的事件（带记录的新 revision） | 写交接或归档操作时编码事件，写命令的结果从它解码 |
| `CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP` | `src/core/work-graph/sessions/session-record-codecs.ts:63` | 按工作区和阶段查操作；未完成是 `accepted` 或 `running`，读者按 `action.kind` 过滤 | 查一个源有没有未完成的交接或归档 |

## 内部用

以下导出只在本层的 codec、schema 注册与校验内部使用；跨层复用先看上表，确需复用就补进上表。

- lifecycle-record-codecs：`SESSION_WORK_LINK_CHANGED_EVENT`、`SESSION_ARCHIVED_EVENT`、`SESSION_REACTIVATED_EVENT`、`SESSION_HEALTH_OBSERVED_EVENT`、`SESSION_LIFECYCLE_EVENT_VERSION`、`SESSION_ARCHIVE_REQUESTED_EVENT`、`SESSION_ARCHIVE_REQUEST_RELEASED_EVENT`、`SESSION_RESPONSIBILITY_CHANGED_EVENT`、`SESSION_LIFECYCLE_RECORD_SCHEMAS`、`encodeSessionWorkLinkChangedEvent`、`encodeSessionLifecycleChangedEvent`、`encodeSessionHealthObservedEvent`、`encodeSessionArchiveChangedEvent`、`encodeSessionResponsibilityChangedEvent`、`sessionWorkLinkChangedPayloadFromEvent`、`sessionLifecycleChangedPayloadFromEvent`、`sessionHealthObservedPayloadFromEvent`、`sessionArchiveChangedEventFromEvent`、`sessionResponsibilityChangedEventFromEvent`。
- message-body-envelope：`encodeUserDecisionBody`、`checkUserDecisionBody`、`isUserDecisionAnswerPart`、`decodeStoredUserDecisionBody`、`decodeStoredMessageBody`。
- message-record-codecs 常量/索引：`SESSION_MESSAGE_SCHEMA_ID`、`SESSION_MESSAGE_SENT_EVENT_TYPE`、`SESSION_MESSAGE_READ_EVENT_TYPE`、`SESSION_MESSAGE_RESPONDED_EVENT_TYPE`、`SESSION_MESSAGE_DERIVATION_EVENT_TYPE`、`SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE`、`SESSION_MESSAGE_DECISION_ANSWERED_EVENT_TYPE`、`SESSION_MESSAGE_DECISION_APPLIED_EVENT_TYPE`、`SESSION_MESSAGE_EVENT_SCHEMA_VERSION`、`ARCHIVE_WAIT_DISPOSED_EVENT_TYPE`、`SESSION_MESSAGE_BY_RECIPIENT_LOOKUP`、`SESSION_MESSAGE_BY_RECIPIENT_STATUS_LOOKUP`、`SESSION_MESSAGE_BY_SENDER_RUN_LOOKUP`、`SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP`、`S5_USER_MESSAGE_BY_GOAL`、`S5_MESSAGE_BY_WORKSPACE_STATUS`、`S5_DECISION_ANSWER_BY_SOURCE`、`S2A_USER_MESSAGES_LOOKUP`、`K3_DECISION_ANSWER_BY_SOURCE_GOAL_LOOKUP`、`SESSION_MESSAGE_CONTENT_TYPE`、`SESSION_MESSAGE_MAX_TEXT_BYTES`、`SESSION_MESSAGE_LOOKUP_INDEXES`、`S5_SESSION_MESSAGE_LOOKUP_INDEXES`、`K3_SESSION_MESSAGE_LOOKUP_INDEXES`、`S2A_SESSION_MESSAGE_LOOKUP_INDEXES`。
- message-record-codecs 校验/codec：`checkSessionMessageRef`、`checkSourceRef`、`checkRoleBindingRef`、`checkMessageSender`、`checkQueryAnswerSender`、`checkResponseSender`、`checkSessionMessageBody`、`SESSION_MESSAGE_RECORD_SCHEMAS`、`sessionMessageRefKey`、`encodeSessionMessageRecord`、`encodeSessionMessageSentEvent`、`encodeSessionMessageReadEvent`、`encodeSessionMessageRespondedEvent`、`encodeSessionMessageConsultationDerivedEvent`、`encodeSessionMessageInputAcceptedEvent`、`encodeSessionMessageDecisionAnsweredEvent`、`encodeSessionMessageDecisionAppliedEvent`、`encodeArchiveWaitDisposedEvent`、`decodeSessionMessageRecord`、`sessionMessageFromEvent`、`archiveWaitDisposedEventFromEvent`。
- session-record-codecs 常量/索引：`CORE_OPERATION_SCHEMA_ID`、`SESSION_RECORD_SCHEMA_ID`、`SESSION_WORK_LINK_SCHEMA_ID`、`SESSION_CREATION_ADMITTED_EVENT_TYPE`、`SESSION_CREATED_EVENT_TYPE`、`SESSION_EVENT_SCHEMA_VERSION`、`SESSION_BY_WORKSPACE_LOOKUP`、`SESSION_WORK_LINKS_LOOKUP`、`SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP`、`SESSION_BY_WORKSPACE_LEGACY_ROLE_LOOKUP`、`SESSION_BY_WORKSPACE_SPEC_ROLE_LOOKUP`、`SESSION_LINKS_BY_MODULE_LOOKUP`、`SESSION_LINKS_BY_TASK_LOOKUP`、`SESSION_LINKS_BY_WORK_LOOKUP`、`S2C_SESSION_BY_KIND_FROM_LOOKUP`、`S2C_SESSION_BY_LIFECYCLE_KIND_LOOKUP`、`S2C_SESSION_ARCHIVED_AT_LOOKUP`、`S2C_OPEN_LINKS_BY_SESSION_LOOKUP`、`S2C_CLOSED_TASK_LINKS_LOOKUP`、`SESSION_WORK_LINK_RELATIONS`。
- session-record-codecs 校验/codec：`isPlatformCursor`、`isNonZeroPlatformCursor`（正本在 `src/contracts/validation/cursors.ts`，这里转出给原有导入者）、`checkOperationRef`、`checkRole`、`checkTarget`、`checkArtifactRef`、`checkWorkLinkRef`、`checkSessionCreationIntent`、`checkSessionArchiveRequest`、`checkSessionBody`、`checkWorkLinkBody`、`SESSION_RECORD_SCHEMAS`、`encodeSessionOperationRecord`、`encodeSessionRecord`、`encodePendingSessionWorkLink`、`encodeSessionCreationAdmittedEvent`、`encodeSessionCreatedEvent`、`decodeSessionOperationRecord`、`decodeSessionRecord`、`decodeSessionWorkLink`、`sessionOperationFromAdmittedEvent`、`sessionCreatedPayloadFromEvent`。
- trusted-context：`actorIdentity`。

## 不要做
- 不要 import 上层模块；本层只允许 `model, state, persistence, materials, architecture`。
- 不要复制 actor 校验：正本是 `src/core/work-graph/persistence/rework-codecs.ts:98` 的 `actorRefProblem`；`src/contracts/validation/identity.ts:5` 的 `validateActor` 是另一条规则（`void` 并追加 `ValidationIssue`，契约层也不能 import WorkGraph），二者不能互换（FP-17）。
- `sessionRefProblem` 正本在 `src/core/work-graph/persistence/rework-codecs.ts:154`；`src/core/work-graph/sessions/session-record-codecs.ts:158` 的 `checkPlainSessionRef` 是 planned 输入的报错适配器（S06，两种固定文字），不是它的副本，也不能换成它（CS-11、M1-31）。
- `sessionAggregateRefKey` 只有 `src/core/work-graph/sessions/session-record-codecs.ts:1069` 这一份；`secretaryIntakeKey`（`src/core/work-graph/model/request-contracts.ts:75`）仍内联序列化、带 `secretary-intake:` 前缀，是认领槽键（S10），不是它的副本，不要改写成它（M1-32）。
- 不要绕过 `state/` 写生命周期、占用或健康；所有受保护状态写入只经状态构造器（M1-01、M1-36）。
- 不要用裸 local id 拼 key 或另写聚合 key；用 `sessionAggregateRefKey` 等完整 key（M1-32）。
- 不要把失败读当空卡、把截断当完整列表、或把 intake claim 释放当 Session 释放（FP-05、M1-13、M1-36）。
