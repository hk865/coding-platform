# src/core/work-graph/tasks：任务、计划、请求与运行生命周期的写入 owner，以及这些写入点名的定向读取

## 负责什么，不负责什么

- 负责 Goal/Task/Plan/Request/Run 认领/模型请求/审查请求/异常锚等聚合的**写入服务**：绑定可信 Host 端口、先查幂等 receipt、编译并提交**恰好一个** `PreparedCommit`；也负责这些写入与读模型点名的 **canonical 定向读取**。
- 依赖方向：只允许 `model, state, persistence, materials, architecture, sessions, queries`（`docs/refactor/module-target.json`）。不得 import `notes/`、`evidence/`、`communication/`、`views/`，也不得 import `src/core/agent-runtime`、`src/app`、`src/business`、`src/composition`。
- 状态迁移只经 `src/core/work-graph/state/`：本层调用 `transitionX`/状态构造函数拿 next 记录、guards 与 effects，不手改受保护字段（AGENTS 第 9 条）。
- 写入顺序固定：上下文与请求隔离 → 形状/scope/pins → identity+fingerprint → receipt 重放 → 现状读 → 纯状态机 → 一个 commit。失败的读不得降级成空事实、`not_found` 或普通 blocked。
- 秘书 profile 是注入端口：本层只声明并消费 `SecretaryProfilePort`（`src/core/work-graph/model/request-contracts.ts:149`）；`createSecretaryProfiles`（`src/app/secretary-profiles.ts:50`）与发布端口 `secretaryProfiles` 在 `src/app/` 和组合根，不在本文件夹。
- 不负责：纯状态机与记录构造（`state/`）、通用编解码与 store 失败映射（`src/core/work-graph/persistence/`）、跨聚合读模型（`views/`）、Host 路由与接线（`app/`、`composition/`）。

## 文件

本目录 70 个 `.ts`，按主题分组。

### 请求、秘书与决定卡（13 个）

做 request round 的提交/路由/分配、秘书准入、决定答案与决定卡投影的去这组。

- `command-rerun-request-card.ts` — `CommandRerunRequest` 到决定卡的纯投影（source、pins、objects、options、summary）。
- `command-rerun-request-service.ts` — `CommandRerunRequest` 读写 owner；`closed` 按 Task closure 在读取时派生。
- `context-input-service.ts` — 精确 task input owner：声明 → 上游事实 → 纯声明守卫 → 历史材料桥。
- `decision-answer-lookup.ts` — 决定答案索引分页到结尾的单一查找。
- `decision-source-identity.ts` — 决定来源 `source.key` 的单一解析。
- `request-facts.ts` — request 核心视图与 candidate adapter：`deriveRequestCore`、`createRequestFacts`、`createCandidateRequestFactsReader`、`readAnswers`（按已读轮次批读答案的唯一读法）。
- `request-service.ts` — request round 的共享入口：人的命令与可信内部命令共用一条 commit 路径；`workspaceOf` 折调用 scope，`requestAssignmentRow` 是提交行的唯一纯判定；记录键、请求根和 `request-tail` 空操作 claim 用 `src/core/work-graph/queries/request-round-claims.ts` 的那一份。另有两条具名读取：`unassigned`（未分配 drain 的一页请求）与 `open`（某状态分区里有开放轮的请求根，每个根一次），两者共用 `readOpenIndexPage` 的游标解析与页读取。人的 `ask`（对一张卡片问秘书或重出候选）续请求的一轮，卡片引用是 1–20 个本项目的 `VersionedRef`、不重复，存为 `relatedCardRefs`；`askInputText` 给出存下的输入（重出时先放固定的一句），`publicCommandProblem` 是人命令形状与文本的唯一纯判定。加轮之前 precheck 用一次 `readMany` 读这些卡片对象，`cardRefsReadRefusal` 判定结果：存储不保存的类型 `invalid`（再问也没用），别的读失败 `unavailable`，不存在的对象放行（上下文里写 not found），不比较钉住的版本。授权检查收窄出 Host principal，命令身份和事件 actor 都取自它。
- `secretary-selection.ts` — 秘书候选事实与选择：`admitRequestSecretary` 是唯一准入检查（scope、可用性、派发、duty、profile），`createSecretarySelection` 只列已准入候选；另有 `createProjectSecretaryScope`、`orderCandidates`。
- `session-facts.ts` — `SessionFactsPort` 的唯一实现（keyset 分页，有页限）。
- `unknown-call-review-answers.ts` — 决定答案索引的内部读取（UCR/CRR 两种 source kind）。
- `unknown-call-review-card.ts` — `UnknownCallReview` 到决定卡的纯投影。
- `unknown-call-review-service.ts` — `UnknownCallReview` 读写 owner。
- `unknown-call-review-target-digests.ts` — review 卡目标路径工作树摘要的单一读取。

### 计划与 Goal（17 个）

做 Plan 采用/校验、Goal 设置/控制/读取与 Goal 创建入口的去这组。

- `goal-basis.ts` — Goal 内容 basis 的单一默认值应用。
- `goal-control.ts` — Goal desired state（GOAL-04…06）的可信 Host 入口。
- `goal-decision-reader.ts` — Goal 需要决定的原因读取（只读，不写 GoalPhase）。
- `goal-executed-files-reader.ts` — Goal 已执行文件的真实端口，按 Goal 索引分页到结尾。
- `goal-settings-service.ts` — Goal 设置、工作区 Goal 顺序与冲突解决的 owner。
- `initial-plan.ts` — 初始 Plan 响应 v2 的规范化与 plan id；v2 解析在 `src/contracts/initial-planning-parse.ts`，本文件为旧调用方再导出。
- `initial-plan-answer.ts` — 初始 Plan 答案的事实读取与采用侧重核；工厂 `createInitialPlanAnswerReader` 只消费注入的 records/materials/bodies 端口，不调 Runtime，也不进 Kernel store。
- `initialization-pointers.ts` — 项目两个 active 治理指针（完成策略、架构基线）的唯一读取与 `activeRevision` 解码；缺失是 `null`，坏读是 `unavailable`。
- `plan-commit-compiler.ts` — 初始/未来 Plan 采用的一次性 `PreparedCommit` 编译。
- `plan-readers.ts` — canonical Task/Goal/Plan/治理/closure 的读取总汇与记录 schema/索引名；`policyRefFromBody`/`architectureRefFromBody` 是治理指针体的唯一解析器。
- `plan-result-helpers.ts` — 计划服务共用的 `Owned`/`Rejection` 形状，以及 `messageOf`、`rejected`、`mapStoreReadFailure`、`asWriteRejection`。
- `plan-service.ts` — Plan 采用与 task 读的协调 owner，另有 request candidate service。
- `plan-task-basis.ts` — Task 有效 basis、冻结执行定义与 origin 判定的纯规则。
- `plan-validation.ts` — Plan 草稿准入的纯校验（义务、DAG、assignment、future delta）。
- `plan-write-admission.ts` — 委派写者身份识别与当前 Host/Role/Run 权限复核。
- `planning-question-reader.ts` — 已保存 planning question 的只读读取。
- `task-service.ts` — Goal 创建的两条 Host 入口，共用同一 `admitGoalCreation` 管线。

### 完成与资格（5 个）

做 Task/Goal 完成判定、证据折与候选资格的去这组。

- `completion.ts` — `completeTaskFromHost`/`completeGoalFromHost` 正式完成入口（receipt → 证据折 → 状态机 → 一 commit）。
- `completion-policy.ts` — Task/Goal 完成判定的纯规则缝：只消费已折好的 effective evidence 与 canonical task facts。
- `eligibility.ts` — queryReadyTasks 与认领准入共用的纯 Task 资格规则。
- `evidence-coverage.ts` — 有效证据的单一纯折叠与适用性判定。
- `task-phase-facts.ts` — 完成 Task 的 phase 投影输入，由调用方给已读事实。

### 执行入口与 Run（15 个）

做认领/返工、执行进入、模型 permit、Run 控制/对账/活动与 execution 读取的去这组。

- `claim-service.ts` — `claimTask` 认领准入：一次 commit 写 Lease、Attempt、starting Run、Outbox 与 Session 占用。
- `control-contracts.ts` — `RunControlPort` 与内部 `ControlObservationPort` 的契约。
- `control-service.ts` — 持久 Run 控制（pause/cancel/resume/steer）的单一实现与读取。
- `execution-entry-service.ts` — 授权/开始/进入/结果四条执行生命周期写，以及共享准入与 guard helper。
- `execution-history-binding.ts` — `executionHistory` 定位器更新的纯编译缝，不含 I/O。
- `execution-history-service.ts` — `executionHistory` 定位器维护：一 commit、一事件、一个 Kernel 唯一槽。
- `model-call-contracts.ts` — 模型请求 permit 的窄端口与 DTO（一次签发、一次消费）。
- `model-call-service.ts` — permit 的签发/消费，复用同一 `admitEnteredRun` 准入。
- `reconcile-intents.ts` — 对账 Run end 时 queued `ControlIntent` 的观察与待写快照。
- `reconcile-reads.ts` — 启动对账的候选集合读取（有界于未完成工作）。
- `requeue-service.ts` — `requeueTask`：`TaskRequeue` 或 `TaskReworkRefusal` 的二选一 commit。
- `run-activity-service.ts` — `RunActivity`/`QueryActivity` 的 backfill 写入与合并候选读取；合并顺序的纯函数 `compareActivityBackfillCandidates`、`orderActivityBackfillCandidates`、`activityBackfillCandidateAfter`、`activityBackfillCursorOf` 也在这里（游标判断和下一个时刻的选择都调 `compareActivityBackfillCandidates`）：两种记录共用 `decideActivityOutcome`、同一身份/指纹与 CAS 规则（`expectedActivityRevision`，私有 `activityRevisionMatches`）和已有记录的重算规则（私有 `shouldBackfillRecordedActivity`）；Query 记录的目标和 Session 取 `model/query-activity-plan.ts` 的 `queryActivitySourceOf`；`listActivityBackfillCandidates` 把 Work ended 索引与 `s6-query-run-by-workspace-ended` 合成一张按 `endedAt` 降序、同一时刻 Work Run 在前、再按 `refKey` 升序的列表，`limit` 数合并后的候选，游标是 `{order, kind, refKey}`，续页时请求的 `to` 仍是排他上界；读取上限按读到的索引记录数各计一次，本次调用检查到第一个位置以前所需的页都读，之后只在预算内读页，已读到的先检查完再停，`next` 是最后检查的位置，只有索引没有下一页或早于 `from` 才算读完；没有记录的已进入 Query 不论结束在 `querySince` 前后都是候选；`ensureActivityRecording` 在已有 `since`、`querySince` 为 null 时用自己的一次提交补 Query epoch（revision + 1，不动 `since`）；这次提交的身份和指纹只含请求，先查回执再读时钟，重试或提交抛错后都重放原回执。
- `run-reconcile-contracts.ts` — Run 对账端口与输入/输出契约。
- `run-reconcile-service.ts` — 无 Kernel terminal 的 Run end 判定、未知结果处置与一 commit。
- `run-state-service.ts` — 精确 Task execution 读取：三段 `readMany`，只在引用漂移时重试。

### 记录读取与共享纯规则（11 个）

做工作线时钟、owner 单条读、receipt 重放、路由守卫与阻塞命令纯规则的去这组。

- `blocked-command-order.ts` — 阻塞命令的全局展平与排序纯规则（记录 `createdAt`、alias、refKey 字节序）。
- `command-expansion.ts` — `npm run`/脚本的二次展开纯 helper，按上限读 `package.json`。
- `command-recognition.ts` — 阻塞命令识别器：展平排序后按 exact/action/`declaredForms` 取第一条。
- `entry-plan-reader.ts` — `entryPlanVerdict` 所需读取：旧 Plan 上钉住的 claim 还能否进入。
- `line-clock.ts` — 工作线的单一时钟与记录读取：`latestActivityAt`、活跃副本、最近 Query、QueryJob 的 Goal、阶段与 `readClaimedAtForRun`。
- `owner-record-read.ts` — 单条 owner 记录读取（`readMany` + 解码 + 缺失区分）。
- `receipt-replay.ts` — 已提交 receipt 的单一重放 helper。
- `revision-guard.ts` — 从 `meta.expected` 取某引用唯一 revision pin 的纯规则。
- `session-anomaly-service.ts` — 异常锚的写入/读取 owner（每 Run 一个，不可变）。
- `task-review-reader.ts` — Task review 的分页读取，失败原样返回。
- `trusted-context.ts` — 可信 Host 上下文绑定与同步请求隔离的共用缝。

### 编解码（9 个）

做记录/事件/索引的 schema、编解码与字段形状检查的去这组。

- `claim-record-codecs.ts` — `TaskAttempt`/`DispatchOutboxEntry`/`TaskRequeue`/`TaskReworkRefusal` 的记录、事件与索引注册。
- `codec-fields.ts` — 记录编解码共用的字段/引用/数组校验原语，从 `contracts` 的校验与指纹模块再导出。
- `codec-shape-checks.ts` — `RunRef`/`TaskTriple`/`SessionMessageRef` 的形状检查，label 由调用方给。
- `command-rerun-request-codecs.ts` — `CommandRerunRequest` 记录、变更事件、三个索引与答案 identity。
- `completion-record-codecs.ts` — `TaskReduction`/`GoalPhase` 编解码与 `TaskCompleted`/`GoalCompleted` 事件。
- `model-request-codecs.ts` — `ModelRequestPermit` 记录与签发/证据事件的编解码。
- `run-activity-codecs.ts` — 再导出 `src/core/work-graph/persistence/run-activity-codecs.ts` 的编解码。
- `session-anomaly-codecs.ts` — `SessionAnomalyAnchor` 记录、事件与两个索引。
- `unknown-call-review-codecs.ts` — `UnknownCallReview` 记录、变更事件与两个索引。

## 可以复用的能力

`正本` 标在名字后面：新代码只用正本；旧副本在“不要做”里逐条列出。

| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `readOwnerRecord` **正本** | `owner-record-read.ts:22` | 一次 `readMany` 读一条 owner 记录、解码，并区分缺失与坏记录 | 单记录 owner 读取；不要自己写 `readOne` |
| `readBatch`、`readRevisionNumber` | `plan-readers.ts:364`、`plan-readers.ts:380` | 批量读完整 key（present/missing/readThrough），并取某 key 的 revision | 一次要读多条事实、据实读版本生成 guard |
| `sameCursor`、`laterCursor` | `plan-readers.ts:345`、`plan-readers.ts:354` | 比较两个 commit cursor、取较晚的一个 | 保留真实水位，合并多次读 |
| `mergeGuards` **正本** | `src/core/work-graph/persistence/record-guards.ts:12` | 按 refKey 合并 guards；同 key 不同 revision 应当拒绝 | 提交前合并全部读依赖；已合成，只剩这一份 |
| `pinRevision` | `revision-guard.ts:19` | 从 `meta.expected` 取某引用的唯一非负 revision | 校验 pins；不要另写数组扫描 |
| `replayCommittedReceipt` | `receipt-replay.ts:85` | 在 receipt cursor 处定位原事件、核对 receipt/事件与身份、投影结果 | 已提交重放，以及 commit 抛错后的恢复 |
| `trustedContextOf`、`isolatedWriteOf` | `trusted-context.ts:30`、`trusted-context.ts:98` | 绑定可信 Host 上下文（保留 AbortSignal）并同步隔离请求 | 每个写入服务的入口 |
| `bindTrustedContext`、`isolateWrite` | `execution-entry-service.ts:210`、`execution-entry-service.ts:218` | 上面两个的带标签包装，检查顺序与文案一致 | 证据、邮箱等要同一拒绝文案的入口 |
| `mapStoreFailure` | `execution-entry-service.ts:146` | 把 execution-write 的 `StoreFailure` 映射成 `CoreRejection` | 执行类写入的失败映射；其它 owner 用 `src/core/work-graph/persistence/read-result-failures.ts` 的对应映射 |
| `requestTailKey`、`secretaryIntakeKey` | `src/core/work-graph/model/request-contracts.ts:68`、`src/core/work-graph/model/request-contracts.ts:73` | request tail 与 secretary intake 两个物理唯一槽的 key；后者用 `sessionAggregateRefKey` 拼 | 认领/转移 request 所有权 |
| `workspaceOf` **正本** | `request-service.ts:221` | 把 `CoreCallContext` 折成 `WorkspaceScope`（缺省 workspace 为空串） | 请求、秘书与读取统一 scope；不要各写一份 |
| `requestAssignmentRow` **正本** | `request-service.ts:833` | submit/route 的提交行唯一纯判定（follow_owner/wait/pick/recipient） | Workflow 决定是否 pick；append 复核 |
| `sameRef` **正本** | `src/core/work-graph/state/ref-equality.ts:2` | 按结构逐字段比较两个引用/JSON 是否同一（与 canonical JSON 等值同义） | 判等引用；本目录的导出副本见“不要做” |
| `sessionAggregateRefKey` **正本** | `src/core/work-graph/sessions/session-record-codecs.ts:998` | Session 聚合键的规范序列化 | 拼 canonical key；不要内联序列化 |
| `messageOf` **正本（M1-38，尚未落地）** | `src/contracts`（新增，尚未落地） | 取 `Error.message`，否则 `String(error)` | 错误文案；落地后一律用正本，现有导出全是旧副本 |
| `sessionRefProblem` **正本** | `src/core/work-graph/persistence/rework-codecs.ts:154` | 校验完整 `{projectId, sessionId}` 引用 | 校验 SessionRef；不要另写形状检查 |
| `storeFailureToRejection` **正本** | `src/core/work-graph/persistence/read-result-failures.ts:42` | 按 owner 语义把 Store 失败映射成 `CoreRejection` | 处理 store 失败；owner 写入用同文件的 `ownerWriteStoreFailureToRejection`，读用 `ownerReadStoreFailureToRejection` |
| `rejected` **正本** | `src/contracts/core/rejections.ts:5` | 领域 rejection 构造器（无 `current`） | 返回失败时用 `rejected` |
| `lookupCommit` **正本** | `src/core/record-store/ports.ts:190` | Store 的 exact identity/fingerprint 幂等查询端口 | 重放/恢复的底层查询；需要失败分类时用 `lookupCommittedReceipt`，不要复制整套分类 |
| `oldestPendingRound` **正本** | `src/core/work-graph/queries/request-rounds-read.ts:473` | 选最老的 pending 非 routing round | intake 转移、未分配遍历、Workflow 计划；只有这一份 |
| `buildRecordedEvent` **正本** | `src/core/work-graph/queries/query-execution.ts:575` | 从实际写入的 Run 构造执行事件 | 记录 Query 执行事件；只有这一份 |
| `latestActivityAt` **正本**、`indexActiveCopies`、`readActiveCopies` | `line-clock.ts:45`、`line-clock.ts:59`、`line-clock.ts:74` | 工作线时钟、活跃只读副本索引与完整分页枚举 | 工作线卡、秘书选择；不要把时钟或副本另读一份 |
| `readLatestQueryRun`、`readQueryRunByRef`、`readQueryJobGoal` | `line-clock.ts:97`、`line-clock.ts:125`、`line-clock.ts:153` | 最近 Query、按 ref 读 QueryRun、读其 QueryJob 的 goal；失败经 sink 原样报 | 线卡与只读副本的阶段；`readQueryJobGoal` 由线卡和副本共用 |
| `copyPhase`、`readClaimedAtForRun` **正本** | `line-clock.ts:180`、`line-clock.ts:198` | 副本的阶段/开始时刻；Run 无起止时间时按 claim 索引回退读 claimedAt | 线卡、秘书选择；不要把 claimedAt 另读一份 |
| `readCanonicalTaskFacts`、`readTaskClosure`、`taskClosureOf` | `plan-readers.ts:1628`、`plan-readers.ts:1952`、`plan-readers.ts:1932` | 规范 Task 事实（Plan、phase、lease、requeue/refusal）与 Task closure | 认领、完成、对账、节点详情读 Task |
| `readGoal`、`readGoalScope`、`readPlan`、`readProposal`、`readProposalOrigin` | `plan-readers.ts:386`、`plan-readers.ts:432`、`plan-readers.ts:463`、`plan-readers.ts:477`、`plan-readers.ts:498` | 单条 Goal/Plan/Proposal 及其来源的 canonical 读取 | 任何 owner 要一条已存记录时 |
| `readGoalsByWorkspaceCreated` | `plan-readers.ts:405` | 按 `s6-goal-by-workspace-created` 升序分页读完一个工作区的全部 Goal（第一项即最早创建的 Goal） | `main/read` 取“首目标”与其前目标区边界 |
| `readGoalPlanWindow`、`confirmActivePlan`、`findPendingProposal`、`terminalProposalOf` | `plan-readers.ts:1011`、`plan-readers.ts:995`、`plan-readers.ts:549`、`plan-readers.ts:790` | Goal 的 Plan 窗口、active Plan 确认与 proposal 终态 | 采用、决定队列、完成判定 |
| `enumerateGoalCandidates`、`enumerateClosedGoalCandidates`、`readGoalTriggerRecords`、`readGoalRunsForCount` | `plan-readers.ts:650`、`plan-readers.ts:698`、`plan-readers.ts:1356`、`plan-readers.ts:1329` | 按索引枚举 Goal 候选、触发记录与 Run 计数 | 决定队列、预算/上限判断 |
| `readRunRoundChain`、`readGateRoundChain`、`readPointerIntents`、`readPinnedCompletionPolicy` | `plan-readers.ts:1258`、`plan-readers.ts:1295`、`plan-readers.ts:1492`、`plan-readers.ts:944` | Run/gate 的 round 链、控制指针意图、钉住的完成策略 | 对账、完成、控制扇出 |
| `readInitializationPointers` **正本** | `src/core/work-graph/tasks/initialization-pointers.ts:49` | 项目两个 active 治理指针的读取与 `activeRevision` 解码：返回架构基线/完成策略的 id 与 revision；缺失为 `null`，坏读为 `unavailable` | 判断项目是否已初始化、或者要指针里的 id/revision 时；不要另读这两个指针 |
| `readGoalPhase`、`readOriginPlans`、`readFutureChangeTaskFacts`、`readDispositionChangeTaskFacts` | `plan-readers.ts:1980`、`plan-readers.ts:2183`、`plan-readers.ts:2039`、`plan-readers.ts:2123` | 阶段、来源 Plan、未来/处置变更的 Task 事实 | 各 owner 的定向读 |
| `readUnknownCallReviewOutcome`、`readRequestCandidateHead`、`taskRecordRefKey`、`createNoteRunTaskResolver`、`createSessionResponsibilityBasisReader` | `plan-readers.ts:1155`、`plan-readers.ts:608`、`plan-readers.ts:1206`、`plan-readers.ts:1465`、`plan-readers.ts:2221` | 审查结果、候选头、Task/Lease 记录键与两个窄读取器 | 各 owner 的定向读；不要另写同一索引遍历 |
| `PLAN_STATE_RECORD_SCHEMAS`、`PLAN_GOVERNANCE_RECORD_SCHEMAS`、`RUN_BY_TASK_INDEX`、`RUN_BY_WORKSPACE_STATUS_INDEX`、`GOAL_BY_WORKSPACE_INDEX`、`GOAL_BY_WORKSPACE_CREATED_LOOKUP`、`RUN_BY_WORKSPACE_OUTCOME_INDEX`、`S2B_RUN_BY_GOAL_ENDED_LOOKUP`、`S2B_RUN_BY_WORKSPACE_ENDED_LOOKUP` | `plan-readers.ts:299`、`plan-readers.ts:328`、`plan-readers.ts:99`、`plan-readers.ts:101`、`plan-readers.ts:103`、`plan-readers.ts:105`、`plan-readers.ts:107`、`plan-readers.ts:109`、`plan-readers.ts:111` | 记录 schema 注册组与已注册索引名 | 组合根注册、按索引读；不要自造索引名 |
| `planTaskFacts`、`buildEffectiveTaskBasis`、`isBasisUnsupported` | `plan-task-basis.ts:238`、`plan-task-basis.ts:102`、`plan-task-basis.ts:73` | Task 有效 basis 的每 Plan 索引与不可用判定 | 读 Plan 的 Task 与采用编译 |
| `entryPlanVerdict`、`taskOriginVerdict` | `plan-task-basis.ts:379`、`plan-task-basis.ts:318` | 旧 Plan 的 claim 能否进入；来源 Plan 的事实是否描述所选 Plan 的 Task | 进入授权、证据归属 |
| `validatePlanDraft`、`validatePlanAssignments` | `plan-validation.ts:34`、`plan-validation.ts:200` | Plan 草稿的义务/DAG/assignment 校验与 assignment 唯一性 | 采用前校验；不要另写一套 |
| `evaluateTaskCompletion`、`evaluateGoalCompletion` | `completion-policy.ts:59`、`completion-policy.ts:178` | Task/Goal 完成判定的纯规则 | 完成服务与状态机前置判断 |
| `evidenceBindingFor`、`selectEffectiveEvidenceSet`、`evidenceApplicabilityWithBasis` | `evidence-coverage.ts:34`、`evidence-coverage.ts:76`、`evidence-coverage.ts:153` | 证据绑定、有效证据折叠与适用性判定 | 完成、证据读；不要重算 applicability |
| `goalDecisionBasis` | `goal-basis.ts:14` | 给 Goal 内容套上已存设置默认值 | 读模型与来源事实需要同一 basis |
| `parseInitialPlanningResponseV2` | `src/contracts/initial-planning-parse.ts:18`（`initial-plan.ts` 再导出） | 初始 Plan 响应 v2 的纯解析 | 读初始 Plan 答案；不要另写 JSON 解析 |
| `compareBlockedCommands`、`orderBlockedCommands` | `blocked-command-order.ts:28`、`blocked-command-order.ts:39` | 阻塞命令的全局展平与排序 | 识别、执行准备、续接简报共用同一顺序 |
| `createCommandRecognizer` | `command-recognition.ts:38` | 阻塞命令识别器（exact → action → declaredForms） | `request_command_rerun` 与 shell hook |
| `expandShellScripts`、`BLOCKED_COMMAND_MAX_FILE_BYTES` | `command-expansion.ts:95`、`command-expansion.ts:30` | 有界脚本二次展开 | 识别与 hook 需要展开时 |
| `commandRerunRequestCardFacts`、`commandRerunRequestDeclaredForms`、`compareCommandRerunRequestNewestFirst`、`commandRerunRequestCardIdentity`、`commandRerunRequestCardWorkspaceOf` | `command-rerun-request-card.ts:187`、`command-rerun-request-card.ts:99`、`command-rerun-request-card.ts:143`、`command-rerun-request-card.ts:239`、`command-rerun-request-card.ts:254` | CRR 决定卡的纯投影、已声明形式、最新优先排序与卡身份 | 决定读模型与来源事实；不要复制卡投影 |
| `unknownCallReviewCardFacts`、`unknownCallReviewTargetPaths`、`UNKNOWN_CALL_REVIEW_FILE_OBJECTS_MAX`、`readReviewTargetDigests` | `unknown-call-review-card.ts:155`、`unknown-call-review-card.ts:87`、`unknown-call-review-card.ts:80`、`unknown-call-review-target-digests.ts:30` | UCR 决定卡的纯投影、目标路径、文件对象上限与当前摘要读取 | 决定读模型与来源事实 |
| `findAnswerMessage` | `decision-answer-lookup.ts:29` | 决定答案索引分页到结尾的单一查找 | 找某决定来源的答案 |
| `readTaskReviews` | `task-review-reader.ts:42` | Task review 的分页读取（到结尾、同一 guards） | 执行准备、续接简报、CRR 列表 |
| `readUnappliedAnswers`、`REWORK_NOTE_CONTENT_TYPE`、`readRequeueWindow`、`newBasisInputsProblem` | `unknown-call-review-answers.ts:167`、`requeue-service.ts:148`、`requeue-service.ts:394`、`requeue-service.ts:472` | 未应用答案读取、返工说明内容类型、requeue 读窗口、新依据输入校验 | 启动恢复、返工准入 |
| `readEntryPlanVerdict` | `entry-plan-reader.ts:32` | 进入判定所需的旧 Plan/新 Plan 读取 | 进入授权与 RUN-03 复核 |
| `evaluateEligibility` | `eligibility.ts:32` | Task 资格纯规则（phase、kind、assignment、lease） | 候选列表与认领前置；不替代认领准入 |
| `deriveRequestCore`、`createRequestFacts`、`createCandidateRequestFactsReader` | `request-facts.ts:87`、`request-facts.ts:272`、`request-facts.ts:359` | request 核心视图、事实端口与 candidate adapter | 请求视图与候选列表；不要另算 owner |
| `readAdmissionFacts`、`readStoredManifest`、`readManifestFromEnvelope` | `execution-entry-service.ts:264`、`execution-entry-service.ts:282`、`execution-entry-service.ts:316` | 执行事实/清单读取与 manifest 解码 | 执行入口与模型调用 |
| `admitEnteredRun`、`recheckHostRoleAdmission`、`loadReplayEvent` | `execution-entry-service.ts:597`、`execution-entry-service.ts:510`、`execution-entry-service.ts:1349` | 已进入 Run 的准入复核、Host/Role 复核与重放事件加载 | 执行入口与模型调用；不要复制授权算法 |
| `executionReadGuards`、`claimEffectRecords`、`claimLeaseOf`、`claimSessionOf`、`hostLeaseOf` | `execution-entry-service.ts:949`、`execution-entry-service.ts:892`、`execution-entry-service.ts:677`、`execution-entry-service.ts:688`、`execution-entry-service.ts:795` | 执行读 guard、Run effect 到记录/effect 的翻译、Lease/Session 上下文 | 执行/对账 commit；不要手拼相关记录 |
| `identifyDelegatedWriter`、`authorizeDelegatedWrite` | `plan-write-admission.ts:144`、`plan-write-admission.ts:234` | 委派写者身份识别与当前权限复核（含真实 guards） | Agent 计划写、requeue；两步顺序不可换 |
| `admitGoalCreation`、`createGoalService` | `task-service.ts:155`、`task-service.ts:414` | Goal 创建的准入管线与服务工厂 | Host 建 Goal |
| `createInitialPlanAnswerReader` | `initial-plan-answer.ts:46` | 初始 Plan 答案的事实读取与采用侧重核（同一 records/materials/bodies 端口） | 初答读取、模型协调草稿的采用前证明 |
| `createPlanService`、`createRequestCandidateService` | `plan-service.ts:1035`、`plan-service.ts:2080` | Plan 采用/task 读服务与 request candidate 服务 | 组合根接线 |
| `createRequestRoundService` | `request-service.ts:950` | request round 的读写端口 | Host 与 Workflow 的请求入口 |
| `open`、`unassigned` **正本** | `request-service.ts:1703`、`request-service.ts:1651` | 两条具名开放轮读取：`open` 一页给出某状态分区里有开放轮的请求根（每个根一次，带 continuation 与 `wrapped`）；`unassigned` 给出最老 pending 轮命中的未分配请求 | 队列分派与 drain；两者共用 `readOpenIndexPage`（`request-service.ts:1703`）的游标解析和页读取，不要另写一份 |
| `createTaskClaimService`、`workClaimDispatchProblem`、`createTaskRequeueService`、`createReconcileCandidateReader` | `claim-service.ts:722`、`claim-service.ts:171`、`requeue-service.ts:600`、`reconcile-reads.ts:52` | 认领服务、认领分派前置检查、返工服务与对账候选读取器 | 组合根与启动对账 |
| `createExecutionEntryService`、`createModelCallService`、`createModelRequestReadPort`、`modelRequestPermitIdFor` | `execution-entry-service.ts:1406`、`model-call-service.ts:154`、`model-call-service.ts:366`、`model-call-contracts.ts:80` | 执行入口、模型请求读写与 permit id | 组合根接线 |
| `createRunControlService`、`controlIntentRefFor`、`createRunStateReader` | `control-service.ts:583`、`control-service.ts:159`、`run-state-service.ts:416` | Run 控制服务、确定性的 intent 引用与执行读取器 | 组合根、Goal 扇出、执行读取 |
| `createRunReconcileService`、`createExecutionHistoryService`、`createRunActivityService`、`runActivityRefOf` | `run-reconcile-service.ts:649`、`execution-history-service.ts:213`、`run-activity-service.ts:376`、`run-activity-service.ts:277` | Run 对账、执行历史定位器、活动回填与活动引用 | 启动对账与活动回填 |
| `createGoalSettingsService`、`setGoalControlFromHost`、`createGoalDecisionCauseReader` | `goal-settings-service.ts:174`、`goal-control.ts:125`、`goal-decision-reader.ts:117` | Goal 设置、desired state 与决定原因读取 | 组合根、Host 控制、决定队列 |
| `createGoalExecutedFilesReader`、`createPlanningQuestionReader` | `goal-executed-files-reader.ts:72`、`planning-question-reader.ts:70` | Goal 已执行文件与已保存 planning question 的只读端口 | 决定队列与 Host 读 |
| `admitRequestSecretary` **正本** | `secretary-selection.ts:204` | 请求秘书的唯一准入检查：caller scope、occupancy 可用性、Query 派发、duty 与 profile；占用只表示 busy | 分配、转交与候选列表都走它；不要复制准入算法 |
| `createSecretarySelection`、`createProjectSecretaryScope`、`orderCandidates` | `secretary-selection.ts:511`、`secretary-selection.ts:94`、`secretary-selection.ts:134` | 秘书候选事实、项目 scope 与候选排序 | 请求分配；不要另算候选 |
| `createSessionFactsService`、`createSessionAnomalyService`、`createUnknownCallReviewService` | `session-facts.ts:170`、`session-anomaly-service.ts:355`、`unknown-call-review-service.ts:412` | Session 事实端口、异常锚服务与 UCR 服务 | 组合根接线 |
| `createCommandRerunRequestService`、`createTaskContextInputService` | `command-rerun-request-service.ts:174`、`context-input-service.ts:952` | CRR 读写服务与精确 task input 服务 | 组合根接线 |
| `completeTaskFromHost`、`completeGoalFromHost` | `completion.ts:262`、`completion.ts:496` | 正式 Task/Goal 完成 Host 入口 | Host 完成动作 |
| `TASK_CLAIM_RECORD_SCHEMAS`、`COMPLETION_RECORD_SCHEMAS`、`MODEL_REQUEST_RECORD_SCHEMAS`、`SESSION_ANOMALY_RECORD_SCHEMAS`、`UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS`、`COMMAND_RERUN_REQUEST_RECORD_SCHEMAS` | `claim-record-codecs.ts:811`、`completion-record-codecs.ts:280`、`model-request-codecs.ts:260`、`session-anomaly-codecs.ts:336`、`unknown-call-review-codecs.ts:646`、`command-rerun-request-codecs.ts:339` | 各聚合的记录/事件 schema 注册组 | 组合根注册；不要重复注册同一 aggregateType |
| `decodeDispatchOutboxEntry`、`dispatchOutboxRefKey`、`S2A_REQUEUE_BY_PROJECT_LOOKUP`、`S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP`、`taskRequeueRefKey` | `claim-record-codecs.ts:276`、`claim-record-codecs.ts:196`、`claim-record-codecs.ts:60`、`claim-record-codecs.ts:62`、`claim-record-codecs.ts:364` | 认领出站记录解码/键、两个认领相关索引与 requeue 记录键 | 读 claim/requeue、按索引遍历 |
| `decodeTaskRequeueSnapshot`、`decodeTaskReworkRefusalSnapshot`、`encodeTaskReworkRefusalSnapshot`、`taskReworkRefusalRefKey`、`TASK_REWORK_EVENT_SCHEMA_VERSION`、`TASK_REWORK_REFUSED_EVENT_TYPE`、`encodeTaskReworkRefusedEvent`、`taskReworkRefusedEventFromEvent` | `claim-record-codecs.ts:692`、`claim-record-codecs.ts:709`、`claim-record-codecs.ts:703`、`claim-record-codecs.ts:369`、`claim-record-codecs.ts:57`、`claim-record-codecs.ts:56`、`claim-record-codecs.ts:759`、`claim-record-codecs.ts:764` | 返工记录/拒绝策略记录与其事件编解码、事件类型与 schema 版本 | 读返工历史、写 policy 拒绝 |
| `decodeSessionAnomalyAnchor`、`sessionAnomalyRefKey`、`S2C_ANOMALY_BY_SESSION_LOOKUP`、`decodeGoalPhaseSnapshot` | `session-anomaly-codecs.ts:275`、`session-anomaly-codecs.ts:262`、`session-anomaly-codecs.ts:28`、`completion-record-codecs.ts:204` | 异常锚读取/键、按 Session 的异常索引与 GoalPhase 解码 | 工作线、时间线、Goal 冲突读 |
| `unknownCallReviewRefKey`、`unknownCallReviewChangedEventFromEvent`、`commandRerunRequestRefOfSource`、`commandRerunRequestChangedEventFromEvent` | `unknown-call-review-codecs.ts:540`、`unknown-call-review-codecs.ts:603`、`command-rerun-request-codecs.ts:382`、`command-rerun-request-codecs.ts:292` | 审查/CRR 记录键、变更事件解码与来源到 CRR 引用 | 读卡、应用答案、续接简报 |

## 内部用

以下导出只在本层的 codec、纯校验、读取器与提交编译内部使用；跨层复用先看上表，确需复用就补进上表（位置都指本文件夹）。

- `claim-record-codecs.ts`：`TASK_ATTEMPT_SCHEMA_ID`、`TASK_CLAIM_OUTBOX_SCHEMA_ID`、`TASK_CLAIMED_EVENT_TYPE`、`TASK_CLAIMED_EVENT_SCHEMA_VERSION`、`TASK_REQUEUE_SCHEMA_ID`、`TASK_REWORK_REFUSAL_SCHEMA_ID`、`TASK_REQUEUED_EVENT_TYPE`、`S2A_REQUEUE_LOOKUP_INDEXES`、`taskClaimProblem`、`taskAttemptRefKey`、`encodeTaskAttemptSnapshot`、`decodeTaskAttemptSnapshot`、`encodeDispatchOutboxEntry`、`encodeTaskClaimedEvent`、`taskClaimedEventFromEvent`、`taskRequeueSnapshotProblem`、`taskReworkRefusalSnapshotProblem`、`encodeTaskRequeueSnapshot`、`encodeTaskRequeuedEvent`、`taskRequeuedEventFromEvent`
- `command-rerun-request-codecs.ts`：`COMMAND_RERUN_REQUEST_SCHEMA_ID`、`COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE`、`COMMAND_RERUN_REQUEST_EVENT_SCHEMA_VERSION`、`K3_CRR_BY_TASK_ALIAS_LOOKUP`、`K3_CRR_BY_GOAL_STATE_LOOKUP`、`K3_CRR_BY_TASK_LOOKUP`、`commandRerunRequestBodyProblem`、`commandRerunRequestRefKey`、`encodeCommandRerunRequest`、`decodeCommandRerunRequest`、`encodeCommandRerunRequestChangedEvent`、`commandRerunRequestAnswerIdentity`、`commandRerunRequestAnswerIdentityOf`
- `command-rerun-request-card.ts`：`COMMAND_RERUN_REQUEST_OPTION_LABELS`、`COMMAND_RERUN_REQUEST_FIXED_SENTENCE`、`COMMAND_RERUN_REQUEST_DECLARED_MATCH_TEXT`、`COMMAND_RERUN_REQUEST_EARLIER_MAX`、`commandRerunRequestOptions`、`commandRerunRequestSummary`
- `completion-record-codecs.ts`：`TASK_REDUCTION_SNAPSHOT_SCHEMA_ID`、`GOAL_PHASE_SNAPSHOT_SCHEMA_ID`、`TASK_COMPLETED_EVENT_TYPE`、`GOAL_COMPLETED_EVENT_TYPE`、`COMPLETION_EVENT_SCHEMA_VERSION`、`COMPLETION_EVENT_TYPES`、`encodeTaskReductionSnapshot`、`encodeGoalPhaseSnapshot`、`encodeCompletionEvent`、`completionEventFromEvent`
- `model-request-codecs.ts`：`MODEL_REQUEST_PERMIT_SCHEMA_ID`、`MODEL_REQUEST_AUTHORIZED_EVENT_TYPE`、`MODEL_REQUEST_EVIDENCE_EVENT_TYPE`、`MODEL_REQUEST_EVENT_SCHEMA_VERSION`、`MODEL_REQUEST_BY_RUN_LOOKUP`、`modelRequestPromptProblem`、`modelRequestPermitProblem`、`encodeModelRequestPermitSnapshot`、`decodeModelRequestPermitSnapshot`、`encodeModelRequestRecordedEvent`、`modelRequestRecordedEventFromEvent`
- `session-anomaly-codecs.ts`：`SESSION_ANOMALY_SCHEMA_ID`、`SESSION_ANOMALY_RECORDED_EVENT_TYPE`、`SESSION_ANOMALY_EVENT_SCHEMA_VERSION`、`archiveChangedFilesProblem`、`encodeSessionAnomalyAnchor`、`encodeSessionAnomalyRecordedEvent`、`sessionAnomalyRecordedEventFromEvent`
- `unknown-call-review-codecs.ts`：`UNKNOWN_CALL_REVIEW_SCHEMA_ID`、`UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE`、`UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION`、`K3_UCR_BY_GOAL_STATUS_LOOKUP`、`K3_UCR_BY_WORKSPACE_OPEN_LOOKUP`、`unknownCallReviewBodyProblem`、`encodeUnknownCallReview`、`decodeUnknownCallReview`、`encodeUnknownCallReviewChangedEvent`
- `unknown-call-review-card.ts`：`UNKNOWN_CALL_REVIEW_OPTION_LABELS`、`UNKNOWN_CALL_APPROVAL_OPTION_LABELS`、`UNKNOWN_CALL_REVIEW_MIXED_LINE`、`unknownCallReviewOptions`、`unknownCallReviewIsMixed`、`unknownCallReviewSummary`
- `unknown-call-review-answers.ts`：`UCR_DISPOSITION_IDENTITY_PREFIX`、`unknownCallAnswerPhase`、`unknownCallReviewDispositionIdentity`
- `unknown-call-review-service.ts`、`unknown-call-review-target-digests.ts`、`codec-shape-checks.ts`：`blockedCommandsBytes`、`REVIEW_TARGET_FILE_MAX_BYTES`、`sessionMessageRefProblem`
- `plan-validation.ts`：`explicitExecutionIntentTaskIds`、`planPhaseGuardReasons`、`deriveFuturePlanDelta`、`validateFutureObligationCoverage`
- `plan-task-basis.ts`：`buildTargetTaskBasis`、`buildFrozenTaskDefinitions`、`frozenTaskDefinitionsAgree`、`executionDefinitionsAgree`、`verifyBasisDelegation`
- `plan-commit-compiler.ts`、`plan-readers.ts`：`compileInitialPlanAdoption`、`compileFuturePlanAdoption`、`resolveGovernance`、`tryPolicyContent`
- `plan-write-admission.ts`、`execution-entry-service.ts`：`identifyPlanWriter`、`authorizePlanWrite`、`checkRunPin`、`checkRunAndPermitPins`、`anomalyAnchorRefsMatch`、`taskEntryPermitProblem`
- `reconcile-intents.ts`：`readRunIntents`、`pointerIntentOf`、`queuedSteersOf`、`outcomeUnknownIntentsOf`、`reconciledIntentRecords`
- `run-activity-service.ts`、`requeue-service.ts`：`decideRunActivityOutcome`、`planRunActivity`、`planRunActivityForCommit`、`verifiedArchiveInterruptionOf`
- `request-service.ts`、`initial-plan.ts`、`decision-source-identity.ts`、`execution-history-binding.ts`、`task-phase-facts.ts`：`REQUEST_TAIL_PREFIX`、`SECRETARY_INTAKE_PREFIX`（从 `model/request-contracts.ts` 再导出）、`initialPlanIdFor`、`normalizeInitialPlanningResponseV2`、`parseDecisionSourceKey`、`nestedSourceObject`、`compileExecutionHistoryBinding`、`taskPhaseFactsOf`

## 不要做

- 不要另写 `sessionRefProblem`、`sameRef`、`messageOf`、`mergeGuards`、store 失败映射、`rejected` 的本地副本；下表每个能力只认一个正本（标 **正本** 的那一行），旧副本列在各自条目里。
- `sameRef` 另有旧副本：`execution-entry-service.ts:144`、`claim-service.ts:122`、`execution-history-service.ts:86`、`reconcile-intents.ts:86`、`session-anomaly-service.ts:94`、`src/core/work-graph/queries/query-execution.ts:104`；新代码一律用正本 `src/core/work-graph/state/ref-equality.ts:2`，旧副本由清理轮删除。
- `sameJson` 另有旧副本：`src/core/work-graph/tasks/run-reconcile-service.ts:125`、`src/core/work-graph/tasks/run-state-service.ts:352` 的 `sameJsonRef`（私有），正本在 `src/contracts/fingerprint.ts:50`，新代码一律用正本，旧副本由清理轮删除（M1-32）。
- `mergeGuards` 的旧副本（曾在本目录 `request-service.ts`、`request-facts.ts` 和 `queries/request-rounds-read.ts`）已合成；只有 `src/core/work-graph/persistence/record-guards.ts:12` 这一份，不要再写。
- `oldestPendingRound` 只有 `src/core/work-graph/queries/request-rounds-read.ts:473` 这一份，已合成；不要另写选最老 pending round 的私有副本。
- `buildRecordedEvent` 只有 `src/core/work-graph/queries/query-execution.ts:575` 这一份，已合成；不要在 request-service 内联第二份。
- 开放轮遍历只有 `unassigned` 和 `open` 两条具名读取，且共用 `readOpenIndexPage`（`request-service.ts:899`）的游标解析与页读取；不要在别处再写 `s6-query-open-by-workspace` 的分页、`after` 解析或候选解码。`open` 只投影 `job.requestRoot`，不读请求事实。
- `readClaimedAtForRun` 的正本在 `line-clock.ts:198`；`views/work-line-reader.ts` 只在已由 claim 定位 Run 的分支里直接取 claimedAt（`src/core/work-graph/tasks/line-clock.ts:198` 仍调用正本），`secretary-selection.ts` 已改调它，旧的私有 `readClaimedAt` 已删；不要新增第三份。
- `readOwnerRecord`（`owner-record-read.ts:22`）是单条 owner 读的正本；`request-service.ts:374` 的 `readOne` 只是包着它的 owner 分类器，`run-state-service.ts:655` 是批量读的另一回事。不要再写新的 `readOne` 通用副本。
- `lookupCommit` 只有 `src/core/record-store/ports.ts:190` 这个端口；`lookupCommittedReceipt`（`src/core/work-graph/queries/query-job-service.ts:424`）是带失败分类的唯一包装。claim/control 等 owner 直接调用端口时也要自己分类失败，不要复制整套重试与分类逻辑。
- `sessionAggregateRefKey` 只有 `src/core/work-graph/sessions/session-record-codecs.ts:998` 这一份；`secretaryIntakeKey`（`src/core/work-graph/model/request-contracts.ts:73`）调用它，旧的内联序列化已合成，不要恢复。
- `storeFailureToRejection` 只有 `src/core/work-graph/persistence/read-result-failures.ts:42`；owner 用同文件的 `ownerWriteStoreFailureToRejection`（`src/core/work-graph/persistence/read-result-failures.ts:110`），`request-service` 的本地 store 失败 switch 已改为调用它，不要恢复手写映射。
- `rejected` 只有 `src/contracts/core/rejections.ts:5` 这一份；`request-service` 的本地 `rejection` 已删，不要恢复。
- `messageOf` 另有旧副本：`src/core/record-store/record-codec.ts:77`、`src/core/agent-runtime/context-support.ts:11`，本目录还有 `request-service.ts:162`、`request-facts.ts:168`、`secretary-selection.ts:110`、`completion.ts:102`、`control-service.ts:114`、`execution-history-service.ts:83`、`goal-control.ts:54`、`goal-decision-reader.ts:93`、`goal-settings-service.ts:84`、`plan-result-helpers.ts:11`、`run-reconcile-service.ts:117`、`task-review-reader.ts:24`；正本定为 `src/contracts` 新增（M1-38，尚未落地），落地后新代码一律用正本，旧副本由清理轮删除。
- `sessionRefProblem` 正本在 `src/core/work-graph/persistence/rework-codecs.ts:154`；`src/core/work-graph/sessions/session-record-codecs.ts:149` 的 `checkPlainSessionRef` 是 planned SessionRef 的更严旧副本，`src/core/work-graph/queries/query-record-codecs.ts:290` 的 `isSessionRef` 只是调用正本的布尔包装；不要新增形状检查副本。
- 不要把失败的读取变成空事实、`not_found` 或普通 blocked；`unavailable`/`incomplete` 原样返回（FP-05、M1-12、MH-06）。
- 不要手改受保护字段或只写生命周期的一半：Run、Attempt、Lease、Outbox、Session 占用、Task/Goal reduction 都经 `state/` 的构造函数，并在同一 commit 里写齐（M1-01、M1-05、M1-36）。
- 不要先读现状再查 receipt：重放与丢失 ack 的恢复都先 `lookupCommit`/`replayCommittedReceipt`，绝不按今天的快照重建原答案（M1-14、M1-15、M1-25、M1-26）。
- 不要一个 commit 混用多次读的事实窗口，或让同 key 的 guard first-wins：冲突的 revision 必须拒绝并重读（M1-07、M1-09、M1-10）。
- 不要发明默认值（秘书、容量、唤醒驱动、时钟）：时间用注入的 `now()`，配置从 Host 透传（FP-15、MH-02、MH-25）。
