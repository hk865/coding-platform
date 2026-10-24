# src/core/work-graph/persistence：记录/事件编解码、提交编译与读取失败映射（L1）

## 负责什么，不负责什么
- L1，只依赖 `model`；不 import `state`、`sessions`、`queries`、`tasks` 等上层。
- 拥有记录与事件的 schema 注册、纯 encode/decode、`PreparedCommit` 的纯编译、索引完整分页读取，以及 Store 失败/游标比较到领域拒绝的映射。
- 只做形状、身份与版本校验；授权、容量、占用、业务选择和状态迁移规则都由上层 owner 决定。
- 不写 SQL、不开事务、不改变持久化字节：事件 JSON 的字段与顺序就是存储契约，不能用 canonical-key 序列化替代。
- 状态迁移仍只经 `src/core/work-graph/state/`；这里看到状态字段也只校验形状。

## 文件
- `command-executor.ts` — 写入执行器：一次原子写的唯一顺序（身份/指纹→回执查找→事实→决定→片段→guard 合并→提交前检查→一次提交→冲突映射/重试→严格结果投影）；导出 `Keys`、`CommittedReceipt`、`CommitFragment`、`CommandRejection`、`CommandResult`、`WriteCommand`、`executeWriteCommand`，owner 只保留自己的事实、决定、片段与结果投影。
- `commit-compiler.ts` — Goal 创建的纯编译：identity/fingerprint、`GoalCreated` 事件、revision-1 快照与 guard 的 `PreparedCommit`，以及 caller version pins。
- `control-record-codecs.ts` — `ControlIntentSnapshot@1`、提交/观察事件、控制状态形状检查与注册。
- `decision-record-codecs.ts` — 决定写事件（`GoalSettingsChanged`、`WorkspaceNoticeSeenChanged`）、notice origin 解码与决定证明校验。
- `event-codec-factory.ts` — 事件 codec 工厂：固定“外层→解析→内外层一致→body”管线。
- `event-envelope.ts` — 外层事件信封编码。
- `event-validation.ts` — 外层信封、内外层一致、actor 与事件 body 校验。
- `evidence-record-codecs.ts` — 验证轮/证据/任务证据索引记录与轮事件 codec、相关查询索引。
- `execution-entry-codecs.ts` — 执行进入的嵌套事实校验与授权/开始/进入/结果/对账事件 codec。
- `execution-history-codecs.ts` — `RunExecutionHistoryV1` 校验与 `ExecutionHistoryRecorded` 事件 codec。
- `field-table-codec.ts` — 字段表格式（`src/contracts/data-format.ts`）的 RecordStore 适配：由一份格式得到记录/事件 codec（check、encode、decode、注册、lookup）和 `formatSchemas`；encode 原样 stringify 调用者的对象，decode 不补值；事件复用 `event-codec-factory.ts` 的管线。
- `graph-repository.ts` — Goal 图仓库：一次读快照、幂等查找、单次提交、按 receipt cursor 重放恢复。
- `line-settings-codecs.ts` — `WorkspaceLinePinsChanged@1` 事件 codec。
- `lookup-all.ts` — 等值索引完整候选集的稳定窗口分页。
- `lookup-ordered-all.ts` — 有序索引完整分页读取。
- `note-record-codecs.ts` — Note 记录/事件/索引 codec，含 cursor-bound 记录先例。
- `plan-record-codecs.ts` — PlanProposal/PlanRevision 记录与事件 codec、proposal 链位置比较。
- `query-activity-codecs.ts` — `QueryActivity@1` 记录与 `QueryActivityRecorded` 事件 codec；tally 规则全部调用 `run-activity-codecs.ts` 的同一份校验器。
- `read-result-failures.ts` — Store 失败到 `CoreRejection` 的映射与游标下限检查。
- `receipt-lookup.ts` — 唯一的已提交回执存储查找：按 identity/fingerprint 精确 `lookupCommit` 并分类 found/missing/conflict/invalid/unavailable（抛错也记为 unavailable）；导出 `CommittedReceipt`（`receipt-lookup.ts:4`）、`ReceiptLookup`（`receipt-lookup.ts:6`）、`lookupCommittedReceipt`（`receipt-lookup.ts:18`）；旧的 query 模块改为 import 后再导出它们，既有调用点不变。
- `record-guards.ts` — 全仓唯一的 guard 合并：同 key 不同 revision 立即 `revision_conflict`，绝不静默去重。
- `record-codecs.ts` — Goal 家族记录/事件 codec、`canonicalRefKey`、Goal/Workspace 设置校验。
- `rework-codecs.ts` — 返工/引用/notice origin 等纯形状校验（actor、Run、Session、Task 等 ref）。
- `run-activity-codecs.ts` — `RunActivity`/`ActivityRecording` 记录与事件 codec；`ActivityRecording` 的当前格式带 `querySince`（null = 还没有 Query epoch），facts/span/ref 校验器导出供 Query codec 复用；两种记录的 SessionRef 都用 `rework-codecs.ts` 的正本 `sessionRefProblem`。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `executeWriteCommand` | `src/core/work-graph/persistence/command-executor.ts:145` | 一次原子写的固定顺序与失败表：回执查找与严格重放、guard 合并、提交前检查、单次提交、冲突映射与最多 3 次重试、结果投影 | 新 owner 的原子写入；owner 只提供事实、决定、片段与投影，不复制顺序或失败表 |
| `lookupCommittedReceipt` | `src/core/work-graph/persistence/receipt-lookup.ts:18` | 按 identity/fingerprint 精确 `lookupCommit` 并分类回执：found/missing/conflict/invalid/unavailable，抛错记为 unavailable；`CommittedReceipt`、`ReceiptLookup` 随函数一起导出 | 需要幂等回执查找或严格重放的起点；旧的 query 模块已改为再导出，调用点不变 |
| `storeFailureCode` | `src/core/work-graph/persistence/read-result-failures.ts:37` | 把 Store 失败码收窄为 `CoreRejection['code']` | 需要判断失败类别时 |
| `storeFailureToRejection` | `src/core/work-graph/persistence/read-result-failures.ts:42` | 通用 Store 失败→`CoreRejection`，可带 `current`；**正本** | 没有 owner 特有语义的读写失败；request-service 的旧映射已删，见“不要做” |
| `pinsFromStoreCurrent` | `src/core/work-graph/persistence/read-result-failures.ts:48` | 从 Store 的 conflict `current` 解出可回填的 version pins | 映射 revision conflict 时 |
| `sessionStoreFailureToRejection` | `src/core/work-graph/persistence/read-result-failures.ts:66` | Session 写失败映射：unique 冲突转 revision conflict | Session 目录/生命周期写失败时 |
| `executionStoreFailureToRejection` | `src/core/work-graph/persistence/read-result-failures.ts:88` | 执行/owner 写失败映射：unique 冲突转 busy | 执行入口或 owner 写失败时 |
| `ownerWriteStoreFailureToRejection` | `src/core/work-graph/persistence/read-result-failures.ts:110` | owner 写失败的窄映射 | 一般 owner 写入时 |
| `ownerReadStoreFailureToRejection` | `src/core/work-graph/persistence/read-result-failures.ts:124` | owner 读失败的窄映射 | 一般 owner 读取时 |
| `mergeGuards` | `src/core/work-graph/persistence/record-guards.ts:11` | 按 refKey 合并 guards：同 key 不同 revision 返回 `revision_conflict` | 任何提交合并读依赖的 guards 时；`tasks/execution-entry-service.ts` 仅保留再导出 |
| `atLeastCursorResult` | `src/core/work-graph/persistence/read-result-failures.ts:22` | 比较观察到的 watermark 与要求的 `atLeastCursor`，不足则给真实 `not_ready` | 索引读承诺新鲜度时 |
| `lookupAll` | `src/core/work-graph/persistence/lookup-all.ts:32` | 把一个等值索引读到结尾，窗口变化最多重试 4 次，返回 watermark 且 `truncated` 恒为 false | 契约要求完整等值事实集时 |
| `readAllOrdered` | `src/core/work-graph/persistence/lookup-ordered-all.ts:17` | 按共享页大小把有序索引读到结尾，返回记录与最后 watermark；store 失败原样抛出 | 契约要求完整有序事实集时 |
| `canonicalRefKey` | `src/core/work-graph/persistence/record-codecs.ts:79` | Project/Workspace/Goal ref 的规范 key；**正本** | 读、guard、claim、比较需要完整 key 时；旧副本见“不要做” |
| `cloneActorRef` | `src/core/work-graph/persistence/record-codecs.ts:90` | 深拷贝 `ActorRef` | 编码前隔离调用方对象时 |
| `goalSnapshotValueProblem` | `src/core/work-graph/persistence/record-codecs.ts:534` | Goal 快照值形状/范围校验 | 解码或提交 Goal 快照时 |
| `workspaceSnapshotValueProblem` | `src/core/work-graph/persistence/record-codecs.ts:547` | Workspace 快照值形状校验 | 解码或提交 Workspace 时 |
| `readGoalSettings` | `src/core/work-graph/persistence/record-codecs.ts:796` | 从 Goal 快照读取带默认值的设置 | 需要 Goal 设置时 |
| `effectiveWorkspaceDecisionSettings` | `src/core/work-graph/persistence/record-codecs.ts:806` | 读取 Workspace 生效的决定设置 | 需要决定设置时 |
| `compileGoalCreate` | `src/core/work-graph/persistence/commit-compiler.ts:83` | 把已由 `state/` 构造的 Goal 快照/guard 编译成一次 `PreparedCommit` | Goal 创建的写入 owner |
| `normalizeCallerGoalPins` | `src/core/work-graph/persistence/commit-compiler.ts:180` | 校验并归一化调用方 Goal pins | 组装 Goal 创建提交前 |
| `compareCallerGoalPins` | `src/core/work-graph/persistence/commit-compiler.ts:232` | 比较 caller pins 与观察到的版本，返回不一致项 | 提交前核对 pins |
| `createGoalGraphRepository` | `src/core/work-graph/persistence/graph-repository.ts:121` | 在 `GoalRecordTransactionPort` 上提供读快照/幂等查找/提交/重放 | Goal 图写入 owner |
| `actorRefProblem` | `src/core/work-graph/persistence/rework-codecs.ts:98` | 校验 human/system/agent actor 的完整形状（agent 带 RunRef）；**正本** | actor 字段或嵌套 actor；旧副本见“不要做” |
| `runRefProblem` | `src/core/work-graph/persistence/rework-codecs.ts:114` | 校验完整 Work RunRef | Work Run 字段，注意不是 QueryRunRef |
| `sessionRefProblem` | `src/core/work-graph/persistence/rework-codecs.ts:154` | 校验完整的普通 `{projectId,sessionId}` SessionRef；**正本** | 普通 SessionRef 输入及嵌套字段；旧副本见“不要做”（CS-11、M1-31） |
| `taskTripleProblem` | `src/core/work-graph/persistence/rework-codecs.ts:107` | 校验 Task 三元组（project/goal/task） | 需要 Task 身份时 |
| `aggregateRefProblem` | `src/core/work-graph/persistence/decision-record-codecs.ts:180` | 校验已知聚合判别式与全部身份字段 | VersionedRef/card 引用 |
| `decisionChangeProofProblem` | `src/core/work-graph/persistence/decision-record-codecs.ts:301` | 校验决定变更证明 | 编码/解码决定写事件时 |
| `decodeNoticeOrigin` | `src/core/work-graph/persistence/decision-record-codecs.ts:387` | 解码 wire-only 的 notice origin | SessionMessage/TaskRequeue/轮次共享 |
| `runControlStateProblem` | `src/core/work-graph/persistence/control-record-codecs.ts:85` | 校验 Run 的 controlState 形状；不判断能否执行 | Run 记录读取器 |
| `createEventCodec` | `src/core/work-graph/persistence/event-codec-factory.ts:42` | 由一份事件描述生成 encode/decode/注册，固定校验顺序与首错 | 新增兼容事件格式时 |
| `createRecordCodec` | `src/core/work-graph/persistence/field-table-codec.ts:57` | 由字段表记录格式生成 check/encode/decode/注册/lookup：键是完整 ref 的 `canonicalJson`，encode 先按 pending 检查、不排序不补值，decode 先核对信封（`decodeRefKey`、`decodeRecordBody`）再按 stored 检查 | 新记录格式；顶层可绑定游标自动声明为 `commitCursorFields` |
| `createEventCodec` | `src/core/work-graph/persistence/field-table-codec.ts:104` | 由字段表事件格式生成 codec：encode 先检查再原样交给信封编码，decode 走事件 codec 工厂的固定管线后做字段检查 | 新事件格式；同名的事件 codec 工厂（`event-codec-factory.ts`）是它复用的管线，旧事件仍直接用工厂 |
| `formatSchemas` | `src/core/work-graph/persistence/field-table-codec.ts:124` | 把字段表 codec 汇成两个后端共用的 `RecordBackendSchemas`；重复的 schemaId、aggregateType 或 事件 type@version 抛错 | 注册新格式时 |
| `encodeEventEnvelope` | `src/core/work-graph/persistence/event-envelope.ts:4` | 编码外层事件信封，body 原样 stringify | 手写事件 codec 时 |
| `eventEnvelopeProblem` | `src/core/work-graph/persistence/event-validation.ts:6` | 校验外层信封四字段 | 事件解码第一步 |
| `eventBodyEnvelopeProblem` | `src/core/work-graph/persistence/event-validation.ts:25` | 校验 body 与编码信封在 id/type/version/time 上一致 | 解析 body 后 |
| `actorProblem` | `src/core/work-graph/persistence/event-validation.ts:40` | 通用 actor 形状校验 | 事件 body 含 actor 时 |
| `eventBodyProblem` | `src/core/work-graph/persistence/event-validation.ts:57` | 校验事件 body 的通用字段与 actor | 事件 body 校验 |
| `isRunExecutionHistoryV1` | `src/core/work-graph/persistence/execution-history-codecs.ts:73` | 纯 `RunExecutionHistoryV1` 形状/范围校验 | Run 记录与写入规则共用时 |
| `compareProposalChainPositions` | `src/core/work-graph/persistence/plan-record-codecs.ts:120` | 比较 proposal 链位置 | 需要 proposal 顺序时 |

## 内部用

以下导出只在本层的 schema 注册、codec 与提交编译内部使用；跨层复用先看上表，确需复用就补进上表。

- commit-compiler：`GOAL_CREATE_IDENTITY_PREFIX`、`goalCreateIdentityKey`、`goalCreateFingerprint`、`projectRefFor`、`workspaceRefFor`、`goalRefFor`。
- control-record-codecs：`CONTROL_INTENT_SNAPSHOT_SCHEMA_ID`、`CONTROL_INTENT_SUBMITTED_EVENT_TYPE`、`CONTROL_INTENT_EVENT_SCHEMA_VERSION`、`CONTROL_INTENT_OBSERVED_EVENT_TYPE`、`CONTROL_INTENT_OBSERVED_EVENT_SCHEMA_VERSION`、`controlObservationProblem`、`controlPlatformObservationProblem`、`controlIntentObservationProblem`、`encodeControlIntentSnapshot`、`decodeControlIntentSnapshot`、`encodeControlIntentSubmittedEvent`、`controlIntentSubmittedEventFromEvent`、`encodeControlIntentObservedEvent`、`controlIntentObservedEventFromEvent`、`CONTROL_BY_WORKSPACE_STATUS_INDEX`、`S2B_CONTROL_BY_RUN_LOOKUP`、`CONTROL_RECORD_SCHEMAS`。
- decision-record-codecs：`GOAL_SETTINGS_CHANGED_EVENT`、`WORKSPACE_NOTICE_SEEN_CHANGED_EVENT`、`DECISION_EVENT_SCHEMA_VERSION`、`encodeGoalSettingsChangedEvent`、`decodeGoalSettingsChangedEvent`、`encodeWorkspaceNoticeSeenChangedEvent`、`decodeWorkspaceNoticeSeenChangedEvent`、`goalSettingsChangedEventProblem`、`workspaceNoticeSeenChangedEventProblem`、`DECISION_RECORD_SCHEMAS`。
- evidence-record-codecs：`VERIFICATION_ROUND_SNAPSHOT_SCHEMA_ID`、`EVIDENCE_SNAPSHOT_SCHEMA_ID`、`TASK_EVIDENCE_INDEX_SNAPSHOT_SCHEMA_ID`、`VERIFICATION_ROUND_OPENED_EVENT_TYPE`、`VERIFICATION_CHECK_BEGUN_EVENT_TYPE`、`VERIFICATION_CHECK_RESULT_RECORDED_EVENT_TYPE`、`VERIFICATION_ROUND_FINALIZED_EVENT_TYPE`、`VERIFICATION_CHECK_INTERRUPTED_EVENT_TYPE`、`VERIFICATION_CHECK_ABANDONED_EVENT_TYPE`、`VERIFICATION_ROUND_REVERIFIED_EVENT_TYPE`、`EVIDENCE_EVENT_SCHEMA_VERSION`、`VERIFICATION_ROUND_EVENT_TYPES`、`encodeVerificationRoundSnapshot`、`decodeVerificationRoundSnapshot`、`encodeEvidenceSnapshot`、`decodeEvidenceSnapshot`、`encodeTaskEvidenceIndexSnapshot`、`decodeTaskEvidenceIndexSnapshot`、`encodeVerificationRoundEvent`、`verificationRoundEventFromEvent`、`checkObservationProblem`、`checkExecutionTicketProblem`、`VERIFICATION_ROUND_ORIGINAL_LOOKUP`、`VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT`、`VERIFICATION_ROUND_BY_TASK_LOOKUP`、`VERIFICATION_ROUND_BY_STATUS_LOOKUP`、`S2A_ROUND_REVERIFY_LOOKUP`、`S2A_ROUND_REVERIFY_LOOKUP_INDEXES`、`S2B_ROUND_BY_GOAL_LOOKUP`、`S2B_ROUND_BY_GOAL_FINALIZED_LOOKUP`、`S2B_ROUND_BY_GOAL_LOOKUP_INDEXES`、`EVIDENCE_RECORD_SCHEMAS`。
- execution-entry-codecs：`EXECUTION_ENTRY_EVENT_SCHEMA_VERSION`、`EXECUTION_ENTRY_AUTHORIZED_EVENT_TYPE`、`EXECUTION_ENTRY_BEGUN_EVENT_TYPE`、`EXECUTION_ENTRY_ENTERED_EVENT_TYPE`、`EXECUTION_RUN_RESULT_RECORDED_EVENT_TYPE`、`EXECUTION_RUN_RECONCILED_EVENT_TYPE`、`executionAuthorizationV2Problem`、`isExecutionAuthorizationV2`、`runExecutionAuthorizationProblem`、`inputBindingProblem`、`anomalyAnchorRefsProblem`、`taskLeaseReleaseV1Problem`、`taskLeaseSnapshotProblem`、`taskDispatchStateV1Problem`、`taskDispatchStateV2Problem`、`taskDispatchStateProblem`、`runtimeEventPayloadProblem`、`runtimeEventProblem`、`terminalPayloadProblem`、`runReconciliationProblem`、`encodeExecutionEntryAuthorizedEvent`、`executionEntryAuthorizedEventFromEvent`、`encodeExecutionEntryBegunEvent`、`executionEntryBegunEventFromEvent`、`encodeExecutionEntryEnteredEvent`、`executionEntryEnteredEventFromEvent`、`encodeExecutionRunResultRecordedEvent`、`executionRunResultRecordedEventFromEvent`、`encodeExecutionRunReconciledEvent`、`executionRunReconciledEventFromEvent`、`EXECUTION_ENTRY_RECORD_SCHEMAS`。
- execution-history-codecs：`EXECUTION_HISTORY_RECORDED_EVENT_TYPE`、`EXECUTION_HISTORY_RECORDED_EVENT_SCHEMA_VERSION`、`encodeExecutionHistoryRecordedEvent`、`executionHistoryRecordedEventFromEvent`、`EXECUTION_HISTORY_RECORD_SCHEMAS`。
- line-settings-codecs：`WORKSPACE_LINE_PINS_CHANGED_EVENT`、`encodeWorkspaceLinePinsChangedEvent`、`decodeWorkspaceLinePinsChangedEvent`、`LINE_SETTINGS_RECORD_SCHEMAS`。
- note-record-codecs：`NOTE_HEAD_SCHEMA_ID`、`NOTE_VERSION_SCHEMA_ID`、`CURRENT_POINTER_SCHEMA_ID`、`NOTE_WRITTEN_EVENT_TYPE`、`NOTE_DISPOSITION_CHANGED_EVENT_TYPE`、`CURRENT_POINTER_MOVED_EVENT_TYPE`、`NOTE_EVENT_SCHEMA_VERSION`、`S4_NOTE_BY_ANCHOR_LOOKUPS`、`S4_NOTE_BY_REVIEW_STATUS_LOOKUP`、`S4_NOTE_BY_STAGED_RUN_LOOKUP`、`S4B_NOTE_BY_PATH_LOOKUPS`、`S4_NOTE_TEXT_LOOKUP`、`S4C2_NOTE_VERSION_NOTICE_LOOKUP`、`factProblem`、`noteHeadRefKey`、`noteVersionRefKey`、`currentPointerRefKey`、`encodeNoteHeadSnapshot`、`decodeNoteHeadSnapshot`、`encodeNoteVersionSnapshot`、`decodeNoteVersionSnapshot`、`encodeCurrentPointerSnapshot`、`decodeCurrentPointerSnapshot`、`encodeNoteWrittenEvent`、`noteWrittenEventFromEvent`、`encodeNoteDispositionChangedEvent`、`noteDispositionChangedEventFromEvent`、`encodeCurrentPointerMovedEvent`、`currentPointerMovedEventFromEvent`、`NOTE_TEXT_PATHS`、`NOTE_RECORD_SCHEMAS`。
- plan-record-codecs：`PLAN_PROPOSAL_SCHEMA_ID`、`PLAN_REVISION_SCHEMA_ID`、`PLAN_PROPOSAL_RECORDED_EVENT`、`PLAN_PROPOSAL_RECORDED_SCHEMA_VERSION`、`PLAN_REVISION_ACCEPTED_EVENT`、`PLAN_REVISION_ACCEPTED_SCHEMA_VERSION`、`PLAN_PROPOSAL_LOOKUP_INDEX`、`S5_PLAN_PROPOSAL_BY_REQUEST`、`planProposalRefKey`、`planRevisionRefKey`、`candidateRequestRef`、`decodePlanProposalRecord`、`decodePlanProposalOrigin`、`decodePlanRevisionSnapshot`、`decodePlanProposalRecordedEvent`、`decodePlanRevisionAcceptedEvent`、`encodePlanProposal`、`encodePlanRevisionSnapshot`、`encodePlanProposalRecordedEvent`、`encodePlanRevisionAcceptedEvent`、`S2B_PLAN_REVISION_BY_GOAL_LOOKUP`、`PLAN_RECORD_SCHEMAS`。
- record-codecs：`PROJECT_SNAPSHOT_SCHEMA_ID`、`WORKSPACE_SNAPSHOT_SCHEMA_ID`、`GOAL_SNAPSHOT_SCHEMA_ID`、`GOAL_CREATED_EVENT_TYPE`、`GOAL_CREATED_EVENT_SCHEMA_VERSION`、`GOAL_DESIRED_STATE_CHANGED_EVENT_TYPE`、`GOAL_DESIRED_STATE_CHANGED_EVENT_SCHEMA_VERSION`、`workspaceDecisionSettingsProblem`、`workspaceLineSettingsProblem`、`goalSnapshotProblem`、`goalSettingsProblem`、`GOAL_RECORD_SCHEMAS`、`encodeProjectSnapshot`、`encodeWorkspaceSnapshot`、`encodeGoalSnapshot`、`encodeGoalCreatedEvent`、`decodeProjectSnapshot`、`decodeWorkspaceSnapshot`、`decodeGoalSnapshot`、`decodeGoalCreatedEvent`、`goalSnapshotFromCreatedEvent`、`encodeGoalDesiredStateChangedEvent`、`decodeGoalDesiredStateChangedEvent`、`goalSnapshotFromDesiredStateChangedEvent`。Goal 记录的 `since` 由创建提交的 `commitCursorBindings` 绑定（schema 的 `commitCursorFields`）；`encodeGoalSnapshot` 接受预绑定形状，decode 拒绝仍为 null 或缺失的 `since`。
- rework-codecs：`isNonNegativeSafeInteger`、`isPositiveSafeInteger`、`NOTICE_ORIGIN_COMMIT_CURSOR_FIELDS`、`noticeOriginFieldsProblem`、`taskAttemptRefProblem`、`planRevisionRefProblem`、`goalRefProblem`、`verificationRoundRefProblem`、`taskRequeueRefProblem`、`controlIntentRefProblem`、`reworkFailureClassProblem`、`taskBudgetProblem`、`sourceStampProblem`、`newBasisInputRefsProblem`、`incompleteCauseProblem`、`noProgressKeyProblem`、`reverifyBasisProblem`、`delegatedWriteProvenanceProblem`。
- query-activity-codecs：`QUERY_ACTIVITY_SCHEMA_ID`、`QUERY_ACTIVITY_RECORDED_EVENT_TYPE`、`QUERY_ACTIVITY_EVENT_SCHEMA_VERSION`、`queryActivityRefKey`、`encodeQueryActivitySnapshot`、`decodeQueryActivitySnapshot`、`encodeQueryActivityRecordedEvent`、`queryActivityRecordedEventFromEvent`、`QUERY_ACTIVITY_RECORD_SCHEMAS`。
- run-activity-codecs：`RUN_ACTIVITY_SCHEMA_ID`、`ACTIVITY_RECORDING_SCHEMA_ID`、`RUN_ACTIVITY_RECORDED_EVENT_TYPE`、`ACTIVITY_RECORDING_STARTED_EVENT_TYPE`、`RUN_ACTIVITY_EVENT_SCHEMA_VERSION`、`S2B_RUN_ACTIVITY_BY_GOAL_LAST_LOOKUP`、`activityRecordRefProblem`、`runActivityFactsProblem`、`runActivitySpanProblem`、`runActivityRefKey`、`activityRecordingRefKey`、`encodeRunActivitySnapshot`、`decodeRunActivitySnapshot`、`encodeActivityRecordingSnapshot`、`decodeActivityRecordingSnapshot`、`encodeRunActivityRecordedEvent`、`runActivityRecordedEventFromEvent`、`encodeActivityRecordingStartedEvent`、`activityRecordingStartedEventFromEvent`、`RUN_ACTIVITY_RECORD_SCHEMAS`。

## 不要做
- `storeFailureToRejection` 只有正本这一份：`src/core/work-graph/persistence/read-result-failures.ts:42`；`src/core/work-graph/tasks/request-service.ts` 的本地 store 失败映射已删，现改调 `ownerWriteStoreFailureToRejection`，不要恢复手写映射（M1-30、M1-10）。
- `actorRefProblem` 另有旧副本：`src/core/work-graph/persistence/rework-codecs.ts:98` 的 `validateActor`、`src/contracts/validation/identity.ts:4` 的 `checkCreationActor`（现委托正本），新代码一律用正本，旧副本由清理轮删除（FP-17）。
- `canonicalRefKey` 另有旧副本：`src/core/work-graph/configuration/role-record-codecs.ts:130`，新代码一律用正本，旧副本由清理轮删除。
- `sessionRefProblem` 另有旧副本：`src/core/work-graph/sessions/session-record-codecs.ts:149` 的 `checkPlainSessionRef`、`src/core/work-graph/sessions/session-record-codecs.ts:149` 的 `isSessionRef`，新代码一律用正本，旧副本由清理轮删除（CS-11、M1-31）。
- 不要复制 Store 失败 switch；按 owner 语义选现有映射，request 尾/收件冲突先单独处理（M1-30、M1-10）。
- 不要把 `lookupAll`/`readAllOrdered` 当成有界队列步；完整集与遍历预算是两个契约（M1-13）。
- 不要重建事件 codec 管线、改校验顺序或把持久化 JSON 换成 canonical-key 序列化（M1-37）。
- 不要接受未绑定 cursor、伪造 `since` 或给旧格式补默认值（CS-01、CS-08、CS-10）。
- 不要另写 ref 校验器或只查 `aggregateType`/`projectId`（CS-11、CS-04、FP-17、M1-31）。
- 不要在这里做状态迁移或业务 admission；写状态只经 `state/`（M1-01、M1-36）。
