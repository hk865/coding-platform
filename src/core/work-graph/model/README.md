# src/core/work-graph/model：各领域共享的契约、端口与纯索引/请求构造（L0）

## 负责什么，不负责什么
- L0 的共享契约正本：上层（`sessions`、`queries`、`tasks`、`views` 等）读这里的同一份 DTO/端口，不另建平行类型；共同身份、结果和拒绝类型仍以 `src/contracts/core/`（`identity.ts`、`results.ts`、`rejections.ts`）为正本，这里只引用或做兼容再导出。
- 依赖方向按 `docs/refactor/module-target.json`：只允许同层的 `state`（唯一例外，见 model 的 note）；对 `record-store` 只取端口类型，不 import 其实现；不得 import 任何上层子模块、`src/app`、`src/business`、`src/composition`、`src/core/agent-runtime`。
- 只声明形状、端口与纯 helper：plan-local 邻接/环检测、工具参数到 owner 请求、tool commit 的 request id；不实现服务、不读 store、不写记录、不做 I/O。
- 状态迁移只经 `src/core/work-graph/state/`（根 `AGENTS.md` 第 9 条）；这里不构造也不修改受保护状态字段。
- 契约里的时间、事件 id、随机数和 Store 句柄都由上层注入，本层不持有。

## 文件

### Task/Run/执行
做认领、执行进入与读取、Task/Goal 写入、plan 邻接和命令重跑请求的去这组。
- `architecture-footprint.ts` — 执行文件到模块的唯一映射（`mapExecutedFilesToModules`）：按当前 catalog 的最长合法路径归属，找不到唯一 owner 的文件是 `moduleRef: null`，不猜；`plannedFootprintOf` 是一个 Goal 计划足迹的唯一规则：没写清单的任务给模块，写了清单的给文件和它自己的模块，冲突读（经它也用在冲突卡的来源核对）用它；`views/goal-conflicts.ts` 转出它。
- `catalog-revision-ports.ts` — catalog 修订规划读的窄端口：`CatalogTaskClosureV1`、`CatalogPlanTaskFactV1`、`CatalogPlanFactsV1`、`CatalogPlanFactsReadV1`、`CatalogPlanFactsPort`、`CatalogResponsibilityFactsV1`、`CatalogResponsibilityPlanInputV1`、`CatalogResponsibilityPort`；实现在 tasks/sessions，组合根注入，architecture 不 import 它们。
- `claim-contracts.ts` — `TaskClaim` 认领、重新入队与审查认领的输入、`TaskClaimPort` 和依赖。
- `command-rerun-request-contracts.ts` — `CommandRerunRequest` 读写端口、回复分支与 Task closure 读取 DTO；121-110 加 `applyAdviserAnswer`、`escalateRerun` 两个写口（Workflow 以平台自动化身份调）。
- `execution-entry-contracts.ts` — 执行授权/开始/进入/结果的端口与 DTO（不含 Query/Review 的伪 Run）。
- `execution-history-contracts.ts` — `RunExecutionHistory` 写入端口与输入/结果。
- `execution-read-contracts.ts` — `TaskExecutionRecord` 精确读取与按 Goal/Task 的执行分页；`TaskExecutionRecord` 的正本在 `contracts/execution-read.ts`，这里转出。
- `plan-loop-readings.ts` — 三个 Run 读数（纯函数，只读已记录的 `RunActivityFactsV1`，不补算）：`runUsageOf`（累计 input+output，不扣缓存；unknown 保留原因）、`runGrowthOf`（第一次输入不计，看不到末段时不补）、`lineReadingOf`（counted 的 `changedLines`，缺失不是完整零）。阶段/超线读数（`stageReadingOf`/`stageOverLine`/`lineOverrun`）不在 R3。
- `platform-check-context.ts` — 平台替 Agent 做只读核对时的调用上下文（`platformCheckContext`）；平台以自己固定的 Host 系统身份行事的上下文（`hostSystemContext`：成员创建、知识冲突给参谋的请求）。
- `query-activity-plan.ts` — Query 活动写入的纯计划：`queryActivityRefOf`、`QueryActivityRecordContent`、`planQueryActivityWrite`（替换规则调用 `state/activity-replacement.ts`）与 `queryActivitySourceOf`（记录里的目标和两个 Session）。
- `task-contracts.ts` — `GoalTaskPort`（创建/完成/控制 Goal）与 `GraphWrite` 正本。
- `task-node-commit-contracts.ts` — 节点级审核（决定 121-45）：`TaskNodeCommitPort`（`readNodeRows` 读活动 Plan 每个 Task 的行、待审节点和 live work；`commitNode` 是人的提交/认可）、行 `TaskNodeReviewRowV1`，以及节点提交用的窄 git 端口 `TaskNodeCommitWorkspacePort`（逐路径 blob、和 HEAD 比有无差异、只提交给定路径、按 trailer 找回已落地的提交）与它的结果 `NodeGitResult`；组合根在 Goal 工作区的 Host 根上实现它。
- `task-index.ts` — plan-local 的正反邻接构造和两种环检测，纯算法、无 Store 语义。

### Session/请求/通信
做 Session 目录、request round、收件箱、工具参数映射和命令识别的去这组。
- `command-recognition-contracts.ts` — 阻塞命令识别结果 `BlockedCommandMatchV1` 与共享的 `CommandRecognizer` 类型。
- `communication-contracts.ts` — Session 收件箱的 DTO/端口、消息事件类型与 `deriveSessionInputId`；投递与读 `disposition` 的唯一纯推导 `deriveMessageDelivery`（输入 `MessageDeliveryFactsV1`、结果 `MessageDeliveryDerivationV1`），并再导出 C 的 `MessageDeliveryStateV1`/`MessageReadDispositionV1`；完整命令端口（`SessionMessageCommandPort`，扩展窄的 `SessionMailboxPort`）、发送结果、两个视图读、四个生命周期事件、请求 owner 读端口和信箱依赖的五个可选注入。7A-2：`SessionMessageReadV1` 带派生块 `releaseBlock`（`MessageReleaseBlockV1 | null`），发件箱页是 `SessionMessageOutboxPageV1`（`SessionMessagePage` 加同样顺序的 `releaseBlocks`），`readOutbox` 返回它；没有新的依赖成员，块读用已有的 `dispatchBasis`。`SessionMessageReadV1`、`SessionMessageReadPageV1`、`MessageBody` 的正本在 `contracts/mailbox.ts`，这里转出。
- `message-payload.ts` — send/respond 工具参数的唯一载荷模型：`SendMessageV1`、`RespondMessageV1` 与两个纯规范化函数；工具 schema、请求构造和只读查找共用它，同样的参数得到同样的 owner 输入和指纹。
- `pick-ports.ts` — 挑选注入的两个端口：只读的 Session 复用判定 `SessionReuseVerdictV1`/`SessionReusePortV1`（实现在 B 的 `session-chooser.ts`，组合根注入 M）与领取前授权 `PreClaimAuthorizationVerdictV1`/`PreClaimAuthorizationPortV1`（M 实现，P 调用）。
- `request-contracts.ts` — request round 视图（含 `GoalCardDraftViewV1` / `GoalCardDraftRowsV1`：每张草稿的 `index`、`draft` 与已确认的 `confirmedGoalRef`，未确认为 `null`）、秘书选择端口（`SecretaryCandidateFactsV1.scope` 与 `SecretaryScopePort.scopeOf` 都是 7D1 的 `EffectiveScopeV1[]`，读真实有效范围）、队列预算常量、活尝试阶段集合（`LIVE_ATTEMPT_PHASES`，队列与秘书选择共用）、Query/Request 索引名、请求根索引的槽值；交接要用的请求侧条目：固定的 Host system 主体 `HANDOFF_SYSTEM_PRINCIPAL`、`InternalRouteCommandV1`、`RequestCommandReceiptReadV1`、`HandoffRequestCommandV1` 与 `HandoffRequestReceiptReadPort`（`tasks/request-service.ts` 再导出前三个），sessions 和 state 的交接文件从这里取，不 import tasks。
- `request-ideas.ts` — 回答思路的唯一规则：`validIdeaCount` 与 `ideasIssues`（纯函数）。
- `request-references.ts` — 提交的 `references` 唯一规则：形状、`isSafeSourceRelativePath`、行号组合、8 条/单条 4 KiB/合计 16 KiB 上限与归一化；导出 `MAX_REQUEST_REFERENCES`、`MAX_REQUEST_REFERENCE_SNAPSHOT_BYTES`、`MAX_REQUEST_REFERENCES_SNAPSHOT_BYTES`、`requestReferencesProblem`、`normalizeRequestReferences`（纯函数）。
- `secretary-contracts.ts` — 秘书准备读取的契约：`SecretaryHistoryEntryV1`、`SecretaryPreparationFactsV1`（请求事实带 `briefRef` 与唯一一份 `understandingGrants`）、`SecretaryPreparationFactsPort`（实现在 views，组合根注入）。
- `secretary-query-run-contracts.ts` — 运行中的秘书 QueryRun 的受信事实 `SecretaryQueryRunV1` 与解析端口 `SecretaryQueryRunPort`；`goals` 只是冻结材料列表上仍有效的 `request_understanding` 授权集（解析时按当前 operation 记录重算），绝不是本轮的有效 Goal；`planRef` 是准备时冻结的 Plan，秘书的阶段锚点取它的版本。
- `secretary-lifecycle-contracts.ts` — 秘书生命周期的跨组契约：`SecretaryHandoffBasisV1`（`run` 是用量来自的 QueryRun 或 Work Run）、覆盖/路由/简报事实与四态、归档条件的可合并片段、`SecretaryHandoffFactsPort`/`SecretaryArchiveConditionPort`；只有声明，规则和读取器在各自 owner。
- `secretary-note-contracts.ts` — 再导出 `QueryNoteAdmissionV1`（Query 本轮可写的注记值：none 或 secretary 的 kinds/withdraw/grantedGoalIds）；唯一的声明和纯规则 `secretaryNoteAdmission` 都在 `state/secretary-note.ts`。
- `session-handoff-contracts.ts` — 交接推进与秘书归档的输入/结果/进度类型，`handoff.decide` 的输入/结果（`HandoffDecideInputV1`/`HandoffDecideResultV1`），简报消费端口 `HandoffBriefPort`、简报引用的窄读口 `HandoffBriefRefsReadPort` 与 Workflow 入口 `SessionHandoffWorkflowPort`；`HandoffProgressV1.trigger` 用 F2 的 `HandoffTriggerV1`；命令和组合在各自 owner。
- **记录 5 不在本层。** 6B 的 `HandoffBriefV1` 是秘书 QueryRun 简报；H 的 `WorkHandoffBriefV1` 是 `state/work-handoff-brief.ts` 的纯记录类型，ref/材料/绑定来自 `contracts/handoff-brief.ts`（F2），消费贡献是 `workHandoffBriefConsumption`。不要把两者混用或在本层复制记录 5 的类型。
- `session-activity-contracts.ts` — Session 活动记录的窄读端口：`SessionActivityStateV1`（`src/core/work-graph/model/session-activity-contracts.ts:17`；`revision: 0` 是缺失，`record: null` 与坏记录区分）与 `SessionActivityReadPort`（`src/core/work-graph/model/session-activity-contracts.ts:20`；实现在 `sessions/session-activity.ts`，调用方不拼记录键、不解码信封）；这两个契约目前没有生产调用者，留给第 7 片按决定 91 的保留上限重建同一读取（allowlist 的 `kept-for`）。
- `session-contracts.ts` — Session 创建/目录/分页契约；`CoreOperation` 记录的六个分支（`SessionOperationRecordOf`：顶层 `workspaceId`，`action.kind` 为 `create`/`handoff`/`secretary_archive`/`member_create`/`maintainer_assignment`/`role_line`；创建分支带 `parentOperation`），读者先判 `kind`；7B-3 加 `ConsultationFactRefV1`/`ConsultationFactsV1`/`ConsultationCreateV1` 与 `ConsultationCreateReadPort`，创建输入可选 `consultation?`，记录动作必填 `consultation: ConsultationCreateV1 | null`；7D2 加 `RoleLineActionV1` 分支、它的记录别名 `RoleLineOperationV1`（`src/core/work-graph/model/session-contracts.ts:132`）和创建意图的可选 `name`；`SessionCard` 有必需的 `roleFacts: SessionRoleFactsV1 | null`（`src/core/work-graph/model/session-contracts.ts:141`，存下的角色事实行，缺行是 `null`；由 `sessions/session-directory.ts` 的三张卡填）；只 `export type { GraphWrite }` 转出（测试经此路径 import），正本在 `task-contracts.ts`。
- `session-operation-arms.ts` — `CoreOperation` 的交接分支和秘书归档分支：两张字段表（`HandoffActionShape`、`SecretaryArchiveActionShape`）、两组阶段（`HANDOFF_STAGES`、`SECRETARY_ARCHIVE_STAGES`）、四条规则和推出的类型；交接的 `trigger` 取 F2 的 `HANDOFF_TRIGGERS`，`input.tool`（触发 `tool` 的调用者片段）与 `progress.approval`（`short`/`long`、`pending`/`approved`/`rejected`、accept revision 的 pin、card key、答案）是记录 2 的两个新字段；进度里的三个保存位置（`createInput`、`understanding[].command`、`archiveRequest.savedInput`）和归档的 `input.actor` 也在这里，旧记录由唯一的 `upgradeSessionOperationActionV1` 补 `null`（含 `input.tool`、`progress.approval`）；`ActorRefField`（`ActorRef` 的字段，Goal 复制的字段表也用它）从这里导出；`progress` 只由 `state/session-handoff.ts` 写。`role_line` 分支的词表和字段表（`ROLE_LINE_ACTIONS`/`ROLE_LINE_STEP_KEYS`/`ROLE_LINE_STEP_STATES`/`COLD_START_PHASES`/`ColdStartExplorationQueryRefShape`/`RoleLineActionShape` 及推出的类型）的正本在 `state/role-line-action.ts`，本文件只再导出（D-11 先例 `module-maintainer-assignment`）；`upgradeSessionOperationActionV1` 与 `ACTION_KEYS` 不为它加臂。
- `session-facts-contracts.ts` — Session facts/责任 basis 端口、6 个查找索引名与 `SLICE1_LOOKUP_INDEXES`；`SessionFactsV1.waits` 与 `SessionFactsPort.readWait` 带 `SessionWaitV1`（消息、原 Run、收件方、等待状态、期限与完整位）；直接咨询准入只读的三个非消息事实 `DeliveryEligibilityFactsV1` 与 `DeliveryEligibilityFactsPort`；撤回用的收件方未结束执行端口（`RecipientExecutionsPort`）与 `OPEN_WORK_STAGES`/`OPEN_QUERY_PHASES`；窗口三的 `SessionSettlementDuePort`（线上还有没收尾的已结束 Query 源消息吗，实现在可消费视图，归档守卫读）。
- `module-maintainer-contracts.ts` — 模块维护者的 owner 端口 `ModuleMaintainerPort`（`maintainerOf`、`assignModuleMaintainer`、`applyMaintainerAssignmentDecision` 与工具入口 `requestAssignment`），命令准入 `MaintainerCallerV1`、`AssignMaintainerInputV1`、决定输入、工具请求/结果，以及只从存储操作输入重建检查绑定的纯函数 `maintainerBindingOfOperation`；owner 在 `sessions/module-maintainer-service.ts`，纯决定在 `state/assign-maintainer.ts`。
- `dispatch-basis-contracts.ts` — 派发依据：三版事实（计划窗口、理解指针、`DispatchCounter`）的事实读与公开投影端口，以及目标理解指针端口（`GoalUnderstandingPointerPort`）。
- `tool-commit-arguments.ts` — Kernel 工具参数到 owner `GraphWrite` 的纯映射，以及 tool commit 的 identity/lookup 辅助。

### 计划/证据/审查
做 Plan、证据/验证、决定队列和未知调用审查的去这组。
- `completion-policy-contracts.ts` — 当前完成策略的读端口 `CompletionPolicyReadPort`（`readCurrentCompletionPolicy`）与它的读结果 `CurrentCompletionPolicyRead`（active 指针快照和它钉住的不可变策略版本）；实现是 `configuration/project-bootstrap-service.ts` 的同名读，`configuration/project-bootstrap-contracts.ts` 只从这里导入端口、转出读结果，P11 的采用 owner（`tasks/initialization-adoption-service.ts`）经注入的 `policies` 读它。
- `decision-contracts.ts` — 决定队列/卡片/notice、Goal 设置与答复的端口和读 DTO；卡片来源可带 `prepareWindow`：要读知识文件的来源在队列定窗之前读进队列的准备（`DecisionQueuePreparation`，和冲突的架构是同一次准备、主体只列一次；F-30），窗里只读记录、核到移动就答 `DECISION_WINDOW_MOVED_REASON`（R-窗）；`DecisionCardV1` 与 `NoticeItemV1` 带 `subject`（`DecisionSubjectV1`，Goal 或 project）和可选的 `noticeKind`（三种知识通知：`knowledge_write_unconfirmed`、`knowledge_reverted`、`knowledge_conflict`），没有并列的 `goalRef`；`DecisionCardV1` 另带 `taskRef`/`runRef`（来源 `pins` 里恰好一个 Task/Run，零个或多个为 `null`；`goal_cause` 卡透传原因自己的两项）；`GoalDecisionCauseReadV1` 的 `openedAt` 是原因自己的存储时间（失败 Run 的 `endedAt` 或重启的 `detectedAt`，没有就 `null`）；卡片来源端口用 `project?: boolean` 标记兼服务项目 subject，注记决定来源按 `subject` 读；7A-1 的消息提交写端口（`MessageCommandWritePort`，扩展窄的 `MessageWriteOwnerPort`）、提交伴随记录与片段，以及交给 7A-2 的放行端口（`MessageReleasePort`、`MessageReleaseCandidatesPort`）和放行卡条目输入；7A-2 的 `ResolveDecisionActionV1` 加上放行答复提交后的 `WriteResult<SessionMessage>` 臂，候选的 `blockedReason` 改用 C 里 `MessageReleaseBlockV1` 的那三名加 `activity_conflict`；`CandidateRequestFactsPort` 另带 `interventionSource`；`GoalFootprintReadPort` 是冲突卡来源核对也读的足迹读口。
- `goal-card-contracts.ts` — 目标卡片的初始化 binding、理解指针、确认与复制端口：`InitializationBindingReadPort`、`GoalUnderstandingReadPort`、`GoalConfirmPort`、`GoalCopyPort`。
- `goal-copy-contracts.ts` — 复制取消 Goal 的两个端口：`CopyInterventionReadPort`（分页读可复制干预，失败是拒绝不是空集）与 `CopyInterventionRetractionPort`（撤回一条），以及候选 DTO `CopyInterventionCandidateV1`（从 `src/contracts/goal-copy-retraction.ts` 转出，正本在 C）。
- `evidence-contracts.ts` — `EvidencePort`：验证轮、检查开始/记录/终止/重验的写入口；第 9 片加审阅入账 `recordReviewEvidence?`、它的入参、两个读形状、`NO_ACCEPTED_ANSWER` 和 `reviewQueryEnded`（入账 owner、Workflow 的审阅读和早结算共用的“审阅 Query 结束了没有”，见下表）。
- `initialization-adoption-contracts.ts` — P11 的采用、检查与设置串行端口：`InitializationAdoptionPort`、`ChecksEntryPort`、`ChecksConfirmationPort`、`ServedRolesPort`、`StoredChecksStateV1`、`SavedChecksReadPort`、`SettingsSerialGatePort`。
- `plan-contracts.ts` — Plan/Goal 读模型、诊断、`ProposedPlanDraftRequestV1`/`ProposedPlanSourceRequestV1` 两臂及其别名 `ProposedPlanRequestV1`（草稿臂的可选 `acknowledgement`，7A §3.5；干预消息 `sourceMessageRef?` 只在出现时进指纹）、方法类型 `ProposeInitialPlanFromAnswer`（返回 `InitialPlanProposalResult`）/`HostProposePlan`（返回 `EffectWriteResultV1<PlanProposal>`）、`PlanTaskPort`（`readInitialPlanAnswerFacts` 的来源选择器可带 `InterventionAnswerSourceV1`；可选 `readGoalOrdinal` 只给人看的 `goals/read`）与 `PlanServicePort`（另带 PS 的只读 `readAdoptionStopTargets` 与 `AdoptionStopTargetsV1`）。任务图读 `TaskRow`/`TaskGraph` 和诊断类型的正本在 `contracts/task-graph.ts`，这里转出。
- `unknown-call-review-contracts.ts` — `UnknownCallReview` 的读/写端口与分页输入；写端口含分两层的 `applyAdviserAnswer`、`escalateReview` 和 `settleReview` 的可选 `adviserAvailable`。

### 工作线/上下文/配置
做工作线/节点读取、图上下文、任务输入、角色配置、Kernel 读取、材料和注记的去这组。
- `configuration-contracts.ts` — RoleSpec 安装/激活/读取、`RoleBindingFactsPort` 与绑定解析端口。
- `context-input-contracts.ts` — `TaskContextInputPort`：任务输入选择与分页读取。
- `graph-context-contracts.ts` — 图上下文、任务卡、节点卡的读端口与 DTO；`look`/`find` 的 `goalRef` 可为 `null`（项目分支，不借任何 Goal 的 universe）；extensions 另有空目标的请求类型（只读项目理解和 norms，整份上下文读取仍要求 Goal）。
- `kernel-command-read-contracts.ts` — Kernel 原始命令与 workspace 文件读取的窄端口类型。
- `line-knowledge.ts` — 代码知识文件的端口：一条线（`LineRef`：仓库身份、工作区根的 realpath、分支）的 `LineKnowledge`（读架构文件、按 id 读注记文件（只读文件的 `readNoteFiles`，`leave_out` 时只把自己文件读不成的那一条留在外面、注记目录列不出仍是 `unavailable`；加一次记录 `readMany` 带 head 的 `readNotesById`）、提交前算改动、提交后写一处改动、对账读的完整清单 `readKnowledgeFiles`（每个文件的种类、字节、blob、是否已提交、HEAD 的 blob，`KnowledgeDiskFileV1`；加平台留下的临时文件）、用这份清单的字节拼整图 `architectureOfDisk`（对账第 8 步，不再读盘；stk16）、R21 的 `status()`（分支、HEAD、`.workbench/` 未提交的处数和文件数，`KnowledgeLineStatusV1`；不是 git 回 `unsupported`）和 `commit(message)`（只提交 `.workbench/`，说明为 null 或空串用默认的“更新架构图和注记（n 个文件）”；调用方持有写队列和这条线的租约，git 的拒绝原样回 `unavailable`）、按 HEAD 的 blob 读一个知识文件在 HEAD 里的字节和它最后一次提交的时间 `readHeadFile(path, blobSha)`（不是 git 回 `unsupported`，blob 取不到或 git 失败回 `unavailable`））和服务拿到的 `KnowledgeLines`（项目工作区列表、一条线、项目全部线）；文件里的知识形状 `KnowledgeArchitecture`、`NoteKnowledgeV1`、`KnowledgeAnchorV1` 等；`lineRefKey` 是线的键（工作区和分支），`lineRefWorkspaceId` 从键取回工作区。`KnowledgeWriteDeps` 是一次知识写用的依赖：写队列、项目索引和索引器、项目库的记录（补完成、对账读、恢复读事件）、`files`（`notes/knowledge-files.ts` 的携带事件、写日志文件规则、按事件重建文件 `knowledgeFileOfEvent` 和三条恢复规则 `readsAsKnowledge`、`noteHeadKeyOf`、`recordedFileOf`）、检出租约 `acquireLease`（`KnowledgeWriteLease`）、测试缝 `hold`（`KnowledgeWriteHoldPoint`：`committed`、`applied`，生产为 null）、`newId`、`now`、本项目的快照库 `openSnapshots(projectId)`（memory 每项目一个常开、`close` 不关；SQLite 每次开、用完关）、项目通知 `notify`、冲突判定 `conflictsOf` 和对账第 8 步的采用事实 `recordedArchitecture`（记录里最后采用的 catalog 和 baseline，没有是 `null`、读失败是拒绝、不是“没采用”）、冲突通知的问题行 `problemsOf`（`lineProblemsOf` 的纯结果），以及项目级核对的合并 `projectArchitectureOf`（`project-architecture.ts` 的纯结果）。`LineKnowledge.pin(usedModules)`（L3，[2C2-01]）按这条线的工作树字节算钉：`contentHash` 是排好序的 `<path>\0<gitBlobId>\n` 的 sha256，只算 `architecture.json` 和 `modules/*.json`；`head` 同一轮读；`dirty` 是这些文件有没提交的（git 的状态列出、或盘上的文件不在 git 索引里，含被忽略的；不是 git 恒为 true）；dirty 时带 `usedModules` 的最小字段（从这条线自己的文件读），clean 时为 null。实现在组合根，服务只经它读写。
- `knowledge-ops.ts` — `KnowledgeOpsPort`：`platform.knowledge` 的端口，`reconcile(ctx, workspaceId, trigger)` 对一个工作区当前检出的线对账一次；Host 的触发调它。`recover(ctx, {noticeId, itemNo})` 把本项目一条通知的一个恢复项写回，`recoveryItems(ctx, {noticeId})` 读它的恢复项，是两条路由 `knowledge/recover`、`knowledge/recovery-items` 的端口。R21：`status(ctx, workspaceId)` 读这条线 `.workbench/` 未提交的计数和“只留在本机”（`KnowledgeCommitStatus`），`commit(ctx, {workspaceId, message?})` 是人的一次提交（不写记录，回 `ready` 或拒绝），是路由 `knowledge/status`、`knowledge/commit` 的端口；`problems(ctx, {noticeId})` 按通知读本项目快照库里存下的问题行，是路由 `knowledge/problems` 的端口。R6：`markJoinedCheckout(ctx, workspaceId)` 在本项目索引里把这条线的注记都标成待核实（`joined_existing_checkout`），只有 Host 打开一个别的项目已有的根时调。实现在 `knowledge/ops.ts`。
- `material-contracts.ts` — `MaterialPort`：artifact 存储与按引用打开。
- `note-contracts.ts` — 注记/记忆的写入、读取、检查、决定应用端口，上限常量与 `recordNoteRequestOf`；`NoteScopeV1` 的正本在 `contracts/note.ts`，这里只再导出。
- `work-line-contracts.ts` — 工作线、节点详情、悬停读取与线 pin 写入端口。

## 可以复用的能力
| 名字 | 文件:行 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `lineRefKey` | `src/core/work-graph/model/line-knowledge.ts:30` | 线的键：`canonicalJson([workspaceId, branch])` | 索引、快照、写入记录、钉版本按线分时；不要另拼 |
| `lineRefWorkspaceId` | `src/core/work-graph/model/line-knowledge.ts:34` | 从线的键取回工作区 | 恢复按恢复项的 `lineRef` 找线；不要另解析 |
| `LineKnowledge`、`KnowledgeLines` | `src/core/work-graph/model/line-knowledge.ts:122`、`src/core/work-graph/model/line-knowledge.ts:274` | 一条线的知识文件读写端口（含 `readHeadFile`：按 HEAD 的 blob 读一个知识文件在 HEAD 里的字节和它最后一次提交的时间）；服务在依赖里拿 `KnowledgeLines`（必填），由组合根注入 | 架构和注记服务读写知识文件；不要直接碰磁盘 |
| `KnowledgeWriteDeps`、`KnowledgeFileRules`、`KnowledgeWriteLease`、`KnowledgeWriteHoldPoint` | `src/core/work-graph/model/line-knowledge.ts:225`、`:201`、`:196`、`:199` | 知识写的依赖（`KnowledgeLines.write`）和它的三个形状；`KnowledgeFileRules` 里的三条恢复规则 `readsAsKnowledge`（这些字节能读成这个知识文件）、`noteHeadKeyOf`（注记文件 head 的记录键，架构和模块文件为 null）、`recordedFileOf`（只从记录重建一个知识文件） | 组合根和 `tests/helpers/KLS2-knowledge-lines.ts` 造它；写入顺序、对账和恢复经它拿记录、租约和上层的文件规则 |
| `GraphWrite` **正本** | `src/core/work-graph/model/task-contracts.ts:28` | 写请求信封 `{input, meta}`。`session-contracts.ts:19`、`src/core/work-graph/architecture/contracts.ts:16` 只是转出，不是副本 | 所有 GraphWrite 端口的请求参数 |
| `TaskClaimPort` | `src/core/work-graph/model/claim-contracts.ts:155` | 认领、重新入队、审查认领的写入口；`ClaimTaskInput`/`RequeueTaskInput` 各有可选 `acknowledgement`，写结果带可选 `proofReceipt` | Task claim owner 注入时 |
| `SessionDirectoryPort` | `src/core/work-graph/model/session-contracts.ts:149` | Session 创建、读取与分页目录；`findSessions` 给 `projectId` + `workspaceId` 读一个工作区，只给 `projectId` 时读整个项目的 active Session（无 target/role、不含归档） | Session 目录消费者 |
| `SessionReusePortV1`、`PreClaimAuthorizationPortV1` | `src/core/work-graph/model/pick-ports.ts:18`、`src/core/work-graph/model/pick-ports.ts:27` | 挑选的两个注入端口：只读复用判定与领取前授权；W 只声明，B（P 的 chooser）与 M 各自实现，组合根注入 | 挑 Secretary/成员或领取前判授权；不要另立平行端口 |
| `SessionOperationRecordOf`、`SessionOperationRecord`、`SessionCreateOperationRecord`、`RoleLineOperationV1` | `src/core/work-graph/model/session-contracts.ts:112`、`:129`、`:130`、`:132` | `CoreOperation` 记录：按分支取类型；`admitSessionCreation` 只返回创建分支；`RoleLineOperationV1` 是 `role_line` 分支的记录别名 | 读操作记录先判 `action.kind`，非创建分支在创建身份上答 `unavailable`；O3 的卡来源和 O5a 的角色线读用它做投影 |
| `SessionCreateActionV1`、`SessionOperationActionV1` | `src/core/work-graph/model/session-contracts.ts:69`、`:109` | 创建分支的动作（带 `parentOperation`）与必填 `consultation`、`seatDecision`；`CoreOperation` 六个分支的动作联合 | 只处理创建分支的读者用前者；读通用操作记录的 `action` 先判 `kind` |
| `maintainerBindingOfOperation` | `src/core/work-graph/model/module-maintainer-contracts.ts:38` | 从存储的 `maintainer_assignment` 操作输入重建检查绑定 `{operation, moduleRef, line}`，不读证明、不做第二次读 | 决定应用适配器和 owner 的受信入口核对证明时 |
| `CreateSeatDecisionV1` | `src/core/work-graph/model/session-contracts.ts:41` | 准入保存的那一次席位决定：duty、`reserved`/`borrowed`/`not_counted`、恰好随 `not_counted` 出现的理由、分配记录 ref、借席的父操作与来源线、`decidedAt`；创建动作的必有字段（直接调用者为 null），注册只读它、不再解析 duty | 创建操作的写入与编解码、注册的转换臂读保存值 |
| `ConsultationFactRefV1`、`ConsultationFactsV1` | `src/core/work-graph/model/session-contracts.ts:74`、`:84` | 一条冻结事实（`task`/`event`/`body`/`record`，`event` 在 7B-3 无生产者）与三个列表 `{facts, omitted, unreadable}` | 采集器写、Q 渲染与 codec 检查共用；不要另立定位符替身或第四种列表 |
| `ConsultationCreateV1` | `src/core/work-graph/model/session-contracts.ts:90` | 创建 arm 的冻结载荷 `{messageRef, mode, facts, reason, sourceRef, boundary}`；`kernel` 的 `facts`/`reason` 为 null | CS 的创建与重放、Q 的 `platform_facts` 准备 |
| `ConsultationCreateReadPort` | `src/core/work-graph/model/session-contracts.ts:101` | Q 侧按 operation 读冻结创建载荷的唯一端口 | `readConsultationCreate` 实现；Q 的准备调用 |
| `HandoffActionShape`、`HandoffActionV1`、`HANDOFF_STAGES` | `src/core/work-graph/model/session-operation-arms.ts:224`、`:337`、`:221` | 交接分支的字段表、类型和阶段顺序（`accepted` … `finished`），含每个分配的 `createInput`、每个理解代的 `command` 和 `archiveRequest.savedInput` | 校验、编码交接操作；推进步骤按这个阶段顺序 |
| `SecretaryArchiveActionShape`、`SecretaryArchiveActionV1`、`SECRETARY_ARCHIVE_STAGES` | `src/core/work-graph/model/session-operation-arms.ts:330`、`:338`、`:329` | 秘书归档分支的字段表、类型和阶段顺序；`input.actor` 是接受时保存的可信 actor，旧记录为 `null` | 校验、编码秘书归档操作 |
| `handoffReachedInputProblem`、`archiveSavedInputProblem` | `src/core/work-graph/model/session-operation-arms.ts:162`、`:179` | 已到达步骤缺原输入的拒绝规则（交接与秘书归档各一条正本）：`create` 目标的分配已标 successor/createOperation 但 `createInput` 为 `null`、`understanding` 有 round 但 `command` 为 `null`、`archiveRequest` 有 receipt 但 `savedInput` 为 `null` 各给一条原因；`existing` 目标本来不存 create 输入 | 推进服务在选下一步之前据此答 `invalid`；不要重建输入或跳过该步 |
| `upgradeSessionOperationActionV1` | `src/core/work-graph/model/session-operation-arms.ts:362` | 唯一的兼容读：旧记录/事件缺 `createInput`、`understanding[].command`、`archiveRequest.savedInput` 或归档 `actor` 时读作 `null`；没有可补的字段时原样返回 | `sessions/session-record-codecs.ts` 的记录读和两个分支事件在字段表检查之前调用它，返回的就是升级后的值；不要另写 normalizer |
| `GoalTaskPort` | `src/core/work-graph/model/task-contracts.ts:59` | Goal 创建、Task/Goal 正式完成与 desired state 控制 | Goal/Task 写 owner |
| `PlanTaskPort` | `src/core/work-graph/model/plan-contracts.ts:158` | Plan 采用、task 读与规划诊断；`proposePlan` 的 `sourceMessageRef` 只对 `intervention_planning` 来源走窄准入（普通请求仍按 root/`initiatedByOperator`），`readInitialPlanAnswerFacts` 的来源选择器可带 `InterventionAnswerSourceV1` | Plan/task 写 owner |
| `PlanProposalWithAdoption`、`PlanImpactMarkV1`、`RequestCandidateImpactV1` | `src/core/work-graph/model/plan-contracts.ts:38`、`src/core/work-graph/model/plan-contracts.ts:41`、`src/core/work-graph/model/plan-contracts.ts:53` | 只读投影：已采用提案的 `adoptedBy?`（`plans/proposal`），以及 request candidate 的机械影响标记（`plans/request-candidate` 的 `impact.marks`；`before`/`after` 是完整 `FrozenTaskDefinition`）与本请求上一版候选的 `previous`（`plans/proposal` 读旧 draft） | 采用人读口与候选影响读口；不进存储类型、不加路由 |
| `AdoptionStopTargetsV1` / `PlanServicePort.readAdoptionStopTargets` | `src/core/work-graph/model/plan-contracts.ts:241` | PS §3.2 的只读停目标：候选只改处置的任务及每个任务的全部 Run（没有 Run 的任务不列出）；方法只加在真实 `PlanServicePort`，实现复用公开 `readPlanProposal` 的授权路径 | 组合根的采用前停止包装读取；不要扩大 `PlanTaskPort` |
| `GoalReadV1`、`TaskRow.attemptOrdinal`、`PlanTaskPort.readGoalOrdinal` | `src/core/work-graph/model/plan-contracts.ts:84`、`src/contracts/task-graph.ts:92`（`attemptOrdinal`）、`src/core/work-graph/model/plan-contracts.ts:233` | `goals/read` 的人在值：`GoalDetail` 加 `ordinal`（读不到 `null`）；任务行带选定 Run 的尝试序号（没有选定 Run 时不出现）；可选读口让旧 `PlanTaskPort` 替身照旧编译 | 界面读号；内部 `queryGoal` 保持 `GoalDetail` |
| `CandidateRequestFactsPort` | `src/core/work-graph/model/decision-contracts.ts:87` | candidate request facts：`root`、`initiatedByOperator`、`currentSecretary` 与 `guards` 之外，另带 `interventionSource`（admitted `intervention_planning` Query 的来源消息，其他 Query 为 `null`） | 计划提案的窄准入与候选头读取；不要另读 Query 意图 |
| `ProposedPlanDraftRequestV1` | `src/core/work-graph/model/plan-contracts.ts:55` | 提议的草稿臂：Goal、基于的 Plan、草稿与原因；`source` 必须缺省；`sourceMessageRef?` 是干预来源消息，present-only（缺省时旧指纹逐字节不变），记录与事件里是必填可空 | 现有调用方经 `ProposedPlanRequestV1` 使用这一臂；干预提案带 `sourceMessageRef` |
| `ProposedPlanSourceRequestV1` | `src/core/work-graph/model/plan-contracts.ts:64` | 提议的来源臂：无 Goal、无草稿，只带 `InitializationSourceV1` | 无 Goal 的初始提议；不要在这臂传草稿 |
| `ProposedPlanRequestV1` | `src/core/work-graph/model/plan-contracts.ts:52` | 两臂联合（草稿臂 `ProposedPlanDraftRequestV1` 或来源臂 `ProposedPlanSourceRequestV1`） | 所有 `proposePlan` 请求；按 `source` 有无选臂 |
| `ProposeInitialPlanFromAnswer` | `src/core/work-graph/model/plan-contracts.ts:72` | 由正式回答提议初始 Plan 的方法类型：回答引用、原因与可选来源 | 端口方法类型；owner 对无 Goal 的回答强制来源 |
| `HostProposePlan` | `src/core/work-graph/model/plan-contracts.ts:77` | Host 提议 Plan 的方法类型：`GraphWrite<ProposedPlanRequestV1>` | 端口方法类型 |
| `InitializationBindingReadPort` | `src/core/work-graph/model/goal-card-contracts.ts:13` | 按 answer+draft 或按 Goal 读初始化 binding；缺记录是 `not_found`，Goal 无 binding 是空数组 | C 在确认提交写入、G 读取 |
| `GoalUnderstandingReadPort` | `src/core/work-graph/model/goal-card-contracts.ts:19` | 读 Goal 理解指针与可证明的 head/note；缺指针是 `revision: null`，不是错误 | 目标卡片与 G 的读取 |
| `GoalConfirmPort` | `src/core/work-graph/model/goal-card-contracts.ts:25` | 确认候选草稿的唯一写入口 | C 的确认提交 |
| `GoalCopyPort` | `src/core/work-graph/model/goal-card-contracts.ts:29` | 读复制草稿并确认复制 | C/K/G 的复制链路 |
| `InitializationAdoptionPort` | `src/core/work-graph/model/initialization-adoption-contracts.ts:14` | P11 采用的 accept/resume/read/saveBefore/saveAfter；只有 accept 提高代 | J 实现、L 接线 |
| `ChecksEntryPort` | `src/core/work-graph/model/initialization-adoption-contracts.ts:31` | 按采用的来源应用检查配置并保存 | J 的采用阶段 |
| `ChecksConfirmationPort` | `src/core/work-graph/model/initialization-adoption-contracts.ts:39` | 读已安装检查的确认状态 | J 的采用阶段 |
| `StoredChecksStateV1` | `src/core/work-graph/model/initialization-adoption-contracts.ts:49` | 保存的设置状态：来源、完整检查、保存计数与写入子项 | 采用阶段重开后的比较 |
| `SavedChecksReadPort` | `src/core/work-graph/model/initialization-adoption-contracts.ts:56` | 读设置文件自身的保存状态，不读已安装配置 | J 的采用阶段 |
| `SettingsSerialGatePort` | `src/core/work-graph/model/initialization-adoption-contracts.ts:61` | J 的设置串行队列，交给 L 使用 | 采用内不得再次调用排队的设置路由 |
| `ExecutionEntryPort` | `src/core/work-graph/model/execution-entry-contracts.ts:109` | 执行授权、开始、进入、结果与恢复的写入口 | Runtime 执行进入 |
| `ExecutionReadPort` | `src/core/work-graph/model/execution-read-contracts.ts:84` | 精确 Task execution 与按 Goal/Task 的分页读取 | 读执行事实，不再另写读取器 |
| `EvidencePort` | `src/core/work-graph/model/evidence-contracts.ts:154` | 验证轮与检查生命周期的唯一受信写入口；`ReverifyRoundInput` 有可选 `acknowledgement`，写结果带可选 `proofReceipt`；第 9 片加可选 `recordReviewEvidence`（每轮一条审阅 Evidence，重复回放回执，缺了调用方答 unsupported） | 证据/验证 owner |
| `RecordReviewEvidenceInputV1`、`ReviewQueryReads`、`ReviewSessionDuty`、`NO_ACCEPTED_ANSWER` | `src/core/work-graph/model/evidence-contracts.ts:37`、`:43`、`:53`、`:62` | 第 9 片 VR-16：入参只带 `roundRef`；审阅 Query 读与审阅 Session 的 duty 读是 `Pick<QueryJobPort,…>`、`DutyRecipientDependencies.dutyOfRole` 的合约孪生（`evidence/` 不能 import `queries/`、`sessions/`）；`NO_ACCEPTED_ANSWER` 是 Query 已结束却没有能解析的回答时的 `invalid` 原因 | 证据 owner 与组合根接线；不要另写读形状 |
| `reviewQueryEnded` | `src/core/work-graph/model/evidence-contracts.ts:65` | 第 9 片：审阅 Query 的 job 不再 `pending`/`running` 就是结束（QueryRun 和 QueryJob 同一次提交结算），答没答都算 | 入账 owner、Workflow 的 `readReviewState` 和干预入口的早结算判断“结束了没有”；不要另写口径 |
| `MaterialPort` | `src/core/work-graph/model/material-contracts.ts:11` | 存 artifact、按引用打开并区分历史用途 | 材料读写 |
| `SessionMailboxPort` | `src/core/work-graph/model/communication-contracts.ts:369` | 消息发送、读取、ack、回复；读不改状态；7C-1 另带可选的 Host 发送回执读 `lookupHostSendCommit`（只按原发送身份查，不改答案）；可选的 `readHostSendMessageRef`（`HostSendMessageRefRead`）按同一身份重放回执、给出已发消息的真实 ref（消息在收件线的工作区，可能不是发件方的），没发是 `not_found` | 收件箱与决定消息 |
| `ForwardMessageInputV1`、`DisposeWaitInputV1`、`ForwardMessageResultV1`、`MessageForwardingPort` | `src/core/work-graph/model/communication-contracts.ts:549` | 转发 owner 的输入/结果 DTO 与端口：`forwarded` 是一次提交，`existing` 是第二次同目标命令且不带游标；P 的复制转发只经 `forwardCopiedIntervention` | 组合根装配转发 owner、P 的复制 owner 与 F 的行时；不要另写转发输入/结果或端口 |
| `DecisionReadPort` | `src/core/work-graph/model/decision-contracts.ts:492` | 决定队列、来源页与冲突读取 | 决定读模型 |
| `ConflictArchitectureRead`、`DecisionQueuePreparation`、`PreparedDecisionQueue`、`DecisionQueueWindowMoved`、`DecisionQueuePreparedReader` | `src/core/work-graph/model/decision-contracts.ts:515`、`:530`、`:544`、`:549`、`:550` | R-窗（KLS-2 第九轮裁定）：定窗之前读的冲突架构和当时的目录指针 revision；`DecisionQueuePreparation` 是一次队列窗在定窗之前的准备（冲突的架构，加各来源 `prepareWindow` 读进的文件，主体只列一次；F-30；`conflictsUnavailable`：架构被读回闸门拒，这次不出目标冲突卡、`goal_conflict` 是 `not_available`，stk16）；`prepareDecisionQueue` 给自己也有账本窗的调用方在它的窗之前准备一次、交给每一页队列读，内部读口，没有路由。带准备的队列读只试一次，窗口移动回 `moved`，由调用方重新准备、整轮重读自己的窗，最多 `WINDOW_MAX_ATTEMPTS` 次；调用方最后一次（`last`）移动就是队列自己的 `unavailable`（叠树审查 2） | lines/list、上下文的分页队列 |
| `GoalListPhaseV1`、`GoalListRowV1`、`GoalListReadV1`、`GoalListReadPort` | `src/core/work-graph/model/decision-contracts.ts:321`、`:335`、`:346`、`:348` | 全工作区 Goal 列表读：无游标，行只带 settings/显示摘要，`ordinal` 读不全为 `null`，phase 只回四个可判值（其余 `null` 走 `goals/display`） | `goals/list` 路由；不要另造 Goal 行 DTO 或循环读单 Goal |
| `DecisionSourceFactsPort` | `src/core/work-graph/model/decision-contracts.ts:242` | 重建决定来源事实；`readSource` 的 `goal` 在项目 subject 为 `null` | 答复/卡片前证明来源真实时 |
| `NoteDecisionSourcePort` | `src/core/work-graph/model/decision-contracts.ts:283` | 注记复核卡：`readNoteDecisions` 收 `subject`（Goal 或 project）、按 pin 读一张（带回注记自己的 `subject`，只在过时信号时为 `null`）与应用 | 装配注记卡来源时 |
| `DecisionCardSourcePort` | `src/core/work-graph/model/decision-contracts.ts:563` | 把来源记录投影成决定卡；`serves` 声明来源服务的 subject（`goal`：每个 Goal 读一次；`project`：读不按 Goal 过滤时为绑定的项目读一次，零 Goal 也读）；`readPage` 不带 `goalRef` 即读项目的卡，不服务的 subject 回空页 | 卡片来源适配 |
| `DecisionNoticeSourcePort` | `src/core/work-graph/model/decision-contracts.ts:590` | notice 项的读取与排序 | notice 来源适配 |
| `CopyInterventionReadPort`、`CopyInterventionRetractionPort`、`CopyInterventionCandidateV1` | `src/core/work-graph/model/goal-copy-contracts.ts:17`、`src/core/work-graph/model/goal-copy-contracts.ts:22`、`src/core/work-graph/model/goal-copy-contracts.ts:15` | 复制取消 Goal 时读可复制干预、撤回一条，以及候选 DTO（C 的正本再导出；失败是拒绝，不是空集） | 实现或注入 copy 端口时 |
| `NoteWritePort` | `src/core/work-graph/model/note-contracts.ts:111` | 注记写入、审核、撤回 | 注记写 owner |
| `NoteHeadCheckPort`、`NoteLinkVerifyV1` | `src/core/work-graph/model/note-contracts.ts:301`、`src/core/work-graph/model/note-contracts.ts:254` | 注记检查端口：`checkNotes`（不带 `verifyLinks` 只做第一档、从不建程序；带 `verifyLinks: NoteLinkVerifyV1` 时存疑的头版本联系交第二档；`heldByRun` 是替哪个 Run 读）、`checkHeads`，和两个只读 Host 内存的方法：`doubtfulLinks`（读出 `refs_pending`、还没有结论的头版本联系，按 `noteId`）、`brokenLinks`（读出 `broken` 的 accepted/reviewed 头版本联系，带 `heldByRun`） | 注记读模型、写后核对、“重新核对”路由、Run 里改文件后的检查；Host 的后台批量读 `doubtfulLinks`，书记提醒读 `brokenLinks` |
| `analysedDigestsMatch` | `src/core/work-graph/model/note-contracts.ts:261` | 第二档回的 `analysed` 摘要和之前读到的原始字节摘要比：两边都有的路径摘要都相等才算对得上 | 第一档记第二档结论之前、写入闸门比第二档的摘要时；不要另写比对 |
| `NoteReadPort` | `src/core/work-graph/model/note-contracts.ts:421` | 注记按引用/列表/版本读取 | 注记读模型 |
| `NoteMemoryReadPort` | `src/core/work-graph/model/note-contracts.ts:521` | 记忆 lookup/neighbors/history/conflicts/find/stale | 注记检索 |
| `mapExecutedFilesToModules` | `src/core/work-graph/model/architecture-footprint.ts:21` | 把执行文件按当前 catalog 的最长合法路径映射到模块，无唯一 owner 时 `moduleRef: null`，不猜 | repair footprint 与 goal-conflict 读共用；不要另写路径归属 |
| `plannedFootprintOf` | `src/core/work-graph/model/architecture-footprint.ts:38` | 一个 Goal 计划足迹的唯一规则：没写清单的任务给模块，写了清单的给文件和它自己的模块 | 冲突读（经它也用在冲突卡的来源核对）；不要另写计划模块或计划文件的循环 |
| `UnknownCallReviewPort` | `src/core/work-graph/model/unknown-call-review-contracts.ts:59` | 未知调用审查的读与写 | 审查/重跑链路 |
| `WorkLineReadPort` | `src/core/work-graph/model/work-line-contracts.ts:21` | 工作线列表、详情、分页与对话来源 | 工作线读模型 |
| `NodeDetailReadPort` | `src/core/work-graph/model/work-line-contracts.ts:33` | 图悬停与节点详情读取 | 图/节点详情 |
| `WorkLineSettingsPort` | `src/core/work-graph/model/work-line-contracts.ts:37` | 线的 pin 增删写入 | 线设置写 owner |
| `TaskContextInputPort` | `src/core/work-graph/model/context-input-contracts.ts:20` | 任务输入选择与分页 | 上下文装配 |
| `TaskInputUpstreamV1`、`TaskInputUpstreamsV1`、`TaskInputUpstreamPort` | `src/core/work-graph/model/context-input-contracts.ts:31`、`src/core/work-graph/model/context-input-contracts.ts:37`、`src/core/work-graph/model/context-input-contracts.ts:44` | L46 的薄上游读：一条精确 v2 声明解析到的 `consumerTaskId` 与上游 `TaskTriple`，一版 Plan 的 `{ planRef, upstreams }`，以及上下文输入 owner 在原有两读旁发布的 `readInputUpstreams`；原 `TaskContextInputPort` 不加宽 | Workflow 的 L46 pre-pass；不要另写 provenance 解析或宽化旧端口 |
| `GraphContextReadPort` | `src/core/work-graph/model/graph-context-contracts.ts:94` | 图上下文、look/find 与节点卡；`goalRef` 为 `null` 时走项目分支（架构 module、Session、项目注记，命名 Goal 只读） | 图上下文读取、无 Goal 的秘书轮 |
| `RoleConfigurationPort` | `src/core/work-graph/model/configuration-contracts.ts:15` | RoleSpec 安装/激活/读取、按绑定解析角色 | 角色配置与准入 |
| `CommandRecognizer` | `src/core/work-graph/model/command-recognition-contracts.ts:23` | 请求 owner 与 shell hook 共用的唯一命令识别器 | 识别阻塞命令，不要另写解析 |
| `deriveSessionInputId` | `src/core/work-graph/model/communication-contracts.ts:77` | 由 message ref 与 part 生成稳定的 session-input id；`expiry` 部分固定为 `expiry:` 加规范键，`message`/`response` 仍是原哈希（字节不变） | Kernel 供给与 mailbox 消费对齐时 |
| `waitConsumedClaimKey` | `src/core/work-graph/model/communication-contracts.ts:118` | 等待消费槽的唯一键：`wait-consumed:` 加 message ref 的规范键；接受 claim 与等待读共用同一槽 | 写接受 claim 或读等待是否已消费时；不要另拼字符串 |
| `interventionGoalRefOf` | `src/core/work-graph/model/communication-contracts.ts:112` | 一条消息的那一个规划 Query 归哪个 Goal：消息点名的 Goal（`goalRef`，否则 `taskRef` 的 Goal），没点名是 `null`（Query 在消息自己的工作区）；Query 在这个 Goal 的工作区 | 每个找消息的规划 Query 的读者；不要另判“Query 在哪” |
| `deriveMessageDelivery` | `src/core/work-graph/model/communication-contracts.ts:133` | 消息投递与读 `disposition` 的唯一推导（`MessageDeliveryFactsV1` → `MessageDeliveryDerivationV1`）：accepted input → `delivered`（`accepted`）；read/responded → `delivered`（`legacy_unknown`）；否则收件线 archived/retired → `undelivered` 与原因（archived 优先）；剩下 `queued`；withdrawn、未放行、已送达、未送达、可发送依次决定 `disposition`。只读记录的 `status`/`release`/`withdrawnAt`/`acceptedInputs`，不读记录上存的 `delivery` | 工作线消息分节及其它要判投递/读 `disposition` 的消息读；不要另写投递判断 |
| `consultationFacts` | `src/core/work-graph/model/communication-contracts.ts:89` | 把记录的消费事实、调用方的资格事实与这一部分的投递/等待事实合并成投递谓词的输入 `DeliveryFactsV1`；查询准入与可消费 Session 视图共用这一份，不另写 delivered/accepted 或等待判断 | 调 `deliveryEligibility` 之前；不要另写投递/等待事实 |
| `dispatchBasisProblem` | `src/core/work-graph/model/message-payload.ts:70` | 非空 `DispatchBasisV1` 的唯一检查：恰好 `planRevision`、`pointerRevision`、`dispatchSequence` 三个字段，`planRevision` 为 null 或非负整数，`pointerRevision` 为 `'none'` 或非负整数，`dispatchSequence` 为非负整数；返回问题文字，没问题返回 null | send 的 `expected` 规范化和消息 codec 的 pins 检查（`message pins ` 加这里的文字）；不要另写 |
| `normalizeSendMessageInput` | `src/core/work-graph/model/message-payload.ts:87` | send 工具参数 → `SendMessageV1`：没给的可选字段取 mailbox owner 的默认值（`waitAfterSend` 为 false；`needsReply` 只在显式 true，或没给且 `waitAfterSend` 为 true 时为 true）；`deadlineMs` 须是大于 0 的有限数；多余或坏的字段是 `invalid`。纯函数，不读时钟 | send 工具、请求构造和提交查找解码参数时；不要另写解码 |
| `normalizeRespondMessageInput` | `src/core/work-graph/model/message-payload.ts:152` | respond 工具参数 → `RespondMessageV1`：正文是 `{ text }` 或 `{ reject: true, reason }` 二选一，`expectedRevision` 是正整数；两臂都给、都不给、缺 `messageRef` 或多余字段是 `invalid` | respond 工具、请求构造和提交查找解码参数时 |
| `recordNoteRequestOf` | `src/core/work-graph/model/note-contracts.ts:186` | 工具参数 → 注记 owner 请求，注入可信 commandId 并补默认值 | note 工具与查找共用同一份参数 |
| `buildTaskAdjacency` | `src/core/work-graph/model/task-index.ts:23` | 构造一个 plan 的正向/反向依赖表，保留声明顺序 | 需要 plan-local 邻接时 |
| `hasDirectedCycle` | `src/core/work-graph/model/task-index.ts:46` | 对已有邻接表做 DFS 环检测 | 已构造邻接后校验 |
| `hasCycleInEdges` | `src/core/work-graph/model/task-index.ts:69` | 对任意 `{from,to}` 边集做环检测 | 非执行 DAG 的关系校验 |
| `runUsageOf`、`runGrowthOf`、`lineReadingOf` | `src/core/work-graph/model/plan-loop-readings.ts:39` | 三个 Run 读数（规格 10.4）的唯一纯实现：累计 token 与增长量、确认的增删行；unknown 一律 `null` 并保留 `reason`，不写 0 | `activity/runs` 的 `readings` 投影（`views/activity-read-helpers.ts`）和后续 P6/P7 消费者；不要另算 |
| `queryActivityRefOf` | `src/core/work-graph/model/query-activity-plan.ts:26` | 由完整 `QueryRunRef` 构造 `QueryActivity` 记录 ref | 读写 Query 活动记录；不要另拼 ref |
| `planQueryActivityWrite` | `src/core/work-graph/model/query-activity-plan.ts:41` | 调 `decideActivityOutcome` 定 created/replaced/unchanged 并构造下一版 `QueryActivity` 快照与 span | Query 收尾提交与 Query backfill；不要另写替换规则 |
| `queryActivitySourceOf` | `src/core/work-graph/model/query-activity-plan.ts:79` | 从 QueryJob 与 QueryRun 读出记录要写的目标（请求轮取 prepared manifest 冻结的目标，其他取 intent 目标）、执行 Session 和被问 Session；两个 Session 都投影成 `{projectId, sessionId}`（claim 可能留下完整 Session aggregate ref）；进入了却没有 prepared manifest 的请求轮答原因 | Query 收尾提交与 Query backfill 写记录内容；不要另读目标或 Session |
| `toolCommitRequestId` | `src/core/work-graph/model/tool-commit-arguments.ts:68` | 由 origin/toolName/kernelCallId 派生稳定的工具 commit request id | 工具 handler 与 lookup 需要同一 id |
| `agentActorOf` | `src/core/work-graph/model/tool-commit-arguments.ts:85` | 由 SessionRef/RunRef 构造唯一的 agent actor | 委派写入身份 |
| `platformCheckContext` | `src/core/work-graph/model/platform-check-context.ts:10` | 平台替 Agent 做只读核对的调用上下文：Host 调用者原样返回；Run/QueryRun 换成给定的固定内部 system 身份，保留 projectId、workspaceId、signal | 只用于只认 Host 身份的核对读（结构提案的 catalog 试算和职责读、注记的工作区读 `noteCheckWorkspace`、委派写准入的 WG11 读、模块维护者请求读调用者的 Run）；写入、准入和存下的作者仍用调用者的上下文 |
| `hostSystemContext` | `src/core/work-graph/model/platform-check-context.ts:28` | 平台以自己固定的 Host 系统身份（给定 actor）行事的上下文，保留调用者的 projectId、workspaceId、signal | mailbox 和回执按发信人认一次写时（成员创建、知识冲突修复轮的开轮）；不要再抄一份 systemContext |
| `sendSessionMessageRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:94` | `send_session_message` 参数 → mailbox 请求 | 工具 handler 构造请求 |
| `ackSessionMessageRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:112` | `ack_session_message` 参数 → 带 revision pin 的请求 | ack 工具 |
| `respondSessionMessageRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:121` | `respond_session_message` 参数 → 带 revision pin 的请求 | respond 工具 |
| `sendUserMessageRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:131` | `send_user_message` 参数 → mailbox 请求 | 用户消息工具 |
| `recordDecisionApplicationInput` | `src/core/work-graph/model/tool-commit-arguments.ts:146` | 规范化决定应用的输入形状 | 指纹计算与写入共用 |
| `recordDecisionApplicationRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:162` | 决定应用参数 → 带 expected pins 的请求 | 决定应用工具 |
| `proposeFuturePlanRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:168` | `propose_future_plan` 参数 → plan owner 请求 | 未来 Plan 工具 |
| `toolCommitLookupResult` | `src/core/work-graph/model/tool-commit-arguments.ts:177` | 把 Store lookup 结果映射成 committed/not_committed/undetermined | owner 的只读 lookup |
| `toolCommitLookupUnknownTool` | `src/core/work-graph/model/tool-commit-arguments.ts:188` | 对不属于该 owner 的工具名返回 undetermined | 统一 lookup 分发 |
| `withdrawSessionMessageRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:193` | `withdraw_session_message` 工具的写入载荷，工具和回执查找共用 | 撤回工具和它的回执查找 |
| 注记写入上限 | `src/core/work-graph/model/note-contracts.ts:23` | `NOTE_CONCLUSION_MAX_CODEPOINTS`、`NOTE_BODY_MAX_BYTES`、`UNDERSTANDING_BODY_MAX_BYTES`、`NOTE_FACTS_MAX`、`NOTE_BASIS_FILES_MAX`、`NOTE_BASIS_FILE_MAX_BYTES`、`NOTE_EXTRA_ANCHORS_MAX`、`NOTE_ANCHOR_QUOTA`、`NOTE_GOAL_QUOTA`、`NOTE_EXISTING_TOPICS_MAX`、`NOTE_ANCHOR_CANDIDATES_MAX`、`NOTE_ANCHOR_CANDIDATE_SCAN` | 注记写入/锚点准入的注入初值 |
| 链接注记的配额与上限 | `src/core/work-graph/model/note-contracts.ts:55` | `NOTE_LINK_EVIDENCE_MAX`、`NOTE_FLOW_CANDIDATE_MAX`、`NOTE_ANCHOR_LINK_QUOTA`、`NOTE_GOAL_LINK_QUOTA`、`NOTE_PROJECT_FLOW_QUOTA` | link 注记的证据、候选与锚点/目标配额 |
| 注记与记忆读取上限 | `src/core/work-graph/model/note-contracts.ts:34` | `MEMORY_PAGE_MAX`、`NOTE_READ_FILES_MAX`、`NOTE_READ_FACTS_MAX`、`NOTE_SYMBOL_RECHECK_MAX`、`MEMORY_PAGE_DEFAULT`、`MEMORY_RESULT_MAX_BYTES`、`NOTE_BODY_PAGE_BYTES`、`MEMORY_TOPICS_MAX` | 注记/记忆读取分页与字节上限；`NOTE_SYMBOL_RECHECK_MAX` 是一次调用最多单文件解析的不同文件数，第 4 片的锚点和联系的门共用 |
| 第一档读和第二档核对 | `src/core/work-graph/model/note-contracts.ts:44` | `NOTE_READ_PARSE_BYTES_MAX`、`NOTE_LINK_VERIFY_MAX`、`NOTE_CHECK_DEADLINE_MS`、`NOTE_DOUBT_LINES_MAX`、`NOTE_NATIVE_READ_WAIT_MS` | 一次调用单文件解析的文字总字节；一次第二档最多几条联系；agent 等第二档的时限；执行输入里只因存疑出行的联系超过几条就合成一行；一次调用等 Python/C++ 单文件查的总时长 |
| 检索与项目理解上限 | `src/core/work-graph/model/note-contracts.ts:66` | `TEXT_SEARCH_MAX_TERMS`、`TEXT_SEARCH_CANDIDATE_MAX`、`NOTE_RANK_WEIGHT_TOPIC`、`NOTE_RANK_WEIGHT_CONCLUSION`、`NOTE_RANK_WEIGHT_BODY`、`NOTE_SIMILAR_MAX`、`NOTE_SIMILAR_MIN`、`PROJECT_UNDERSTANDING_BODY_MAX_BYTES`、`FIND_RELATED_FILES_MAX`、`PROJECT_NORMS_CHECK_MAX`、`PROJECT_NORMS_MAX` | 全文检索、排序与项目理解读取；`TEXT_SEARCH_MAX_TERMS` 就是全文检索的词数上限 |
| 秘书选择与历史预算 | `src/core/work-graph/model/request-contracts.ts:27` | `SECRETARY_HANDOFF_INPUT_TOKENS`、`SECRETARY_PICK_RETRIES`、`SECRETARY_TAIL_RETRIES`、`IDEA_DETAIL_MAX_CODEPOINTS`、`SECRETARY_HISTORY_ROUNDS`、`SECRETARY_HISTORY_ANSWER_BYTES` | 秘书候选、交接与历史窗口 |
| request 队列预算 | `src/core/work-graph/model/request-contracts.ts:40` | `REQUEST_PASS_PAGES`、`REQUEST_PAGE_SIZE`、`REQUEST_ADVANCES_PER_PASS`、`REQUEST_DRAINED_PER_PASS`、`REQUEST_BACKOFF_INITIAL_MS`、`REQUEST_BACKOFF_MAX_MS` | request 队列分页、并发与退避 |
| request 队列退避的毫秒数 | `src/core/work-graph/model/request-contracts.ts:51` | `backoffMsFor`：失败次数 → 1 s 起翻倍、封顶 60 s 的退避毫秒数，和 `REQUEST_BACKOFF_INITIAL_MS`/`REQUEST_BACKOFF_MAX_MS` 用同一对初值与上限 | 队列失败重试的等待时长；不要另算 |
| request 的两个认领槽键 | `src/core/work-graph/model/request-contracts.ts:69` | `requestTailKey`、`secretaryIntakeKey`（前缀 `REQUEST_TAIL_PREFIX`、`SECRETARY_INTAKE_PREFIX`） | 正本：request-tail 与 secretary-intake 的键只从这里构造；queries 和 tasks 都用它，不另拼字符串 |
| 交接 fence 的前缀 | `src/core/work-graph/model/request-contracts.ts:85` | `SECRETARY_HANDOFF_PREFIX` | 每 Session 的交接 fence 键的前缀；键的函数体 `secretaryHandoffClaimKey` 在 D 的 fence 文件，别处不要另拼 |
| 思路标题上限 | `src/core/work-graph/model/request-contracts.ts:34` | `IDEA_TITLE_MAX_CODEPOINTS`（120 个码点，一行） | 校验或存储一个回答的 ideas 时，和 `IDEA_DETAIL_MAX_CODEPOINTS` 一起用 |
| 思路的唯一规则 | `src/core/work-graph/model/request-ideas.ts:12`、`src/core/work-graph/model/request-ideas.ts:17` | `validIdeaCount`（0、2 或 3 个）；`ideasIssues`（数组、条数、每条 title/detail 是字符串、标题一行非空且 ≤120 码点、说明 ≤600 码点，返回问题列表） | 正本：秘书回答检查（`queries/secretary-answer.ts`）、回答 codec 的存储复检（`queries/query-record-codecs.ts`）和选思路入口（`tasks/request-service.ts`）都调它，不另写思路规则 |
| 秘书准备的读取端口 | `src/core/work-graph/model/secretary-contracts.ts:59` | `SecretaryPreparationFactsPort`：按 QueryRun 读一次请求（含 `briefRef` 与 `understandingGrants`）、工作区、架构、政策、目标列表和执行种类，带 guards 和 watermark | 秘书轮的准备只经这个端口取事实 |
| `SecretaryQueryRunPort`、`SecretaryQueryRunV1` | `src/core/work-graph/model/secretary-query-run-contracts.ts:35`、`src/core/work-graph/model/secretary-query-run-contracts.ts:22` | `resolveSecretaryQueryRun(ctx)` 返回一轮运行中的秘书 QueryRun 的受信事实 `SecretaryQueryRunV1`：Session、duty、scope、round、run、准备时冻结的 `effectiveGoalId` 与 Plan（`planRef`）、requestRoot、sessionGeneration 与当前 `request_understanding` 授权集 | 注记 owner 的 `query_run` 准入；7A 的发送准入复用同一端口 |
| Query/Request 索引名 | `src/core/work-graph/model/request-contracts.ts:59` | `QUERY_BY_REQUEST_INDEX`、`QUERY_OPEN_BY_WORKSPACE_INDEX`、`REQUEST_ROOTS_BY_GOAL_INDEX`、`QUERY_RAN_BY_SESSION_GOAL_INDEX` | 注册或查询这些固定索引时；`unassigned` 读取用 `QUERY_OPEN_BY_WORKSPACE_INDEX` |
| 请求根索引的槽值 **正本** | `src/core/work-graph/model/request-contracts.ts:196`、`src/core/work-graph/model/request-contracts.ts:199` | `REQUEST_ROOT_MARK`（根轮的 `rootMark`）、`requestGoalSlot`（`g:<goalId>`，无 Goal 是 `no-goal`） | 写 `s6-request-roots-by-goal` 的槽（codec）和按它读（主对话）都用这一份，不另拼字符串 |
| `GoalCardDraftViewV1`、`GoalCardDraftRowsV1` | `src/core/work-graph/model/request-contracts.ts:95`、`src/core/work-graph/model/request-contracts.ts:96` | 每张目标卡草稿的视图：`index`、`draft` 与它已确认的 Goal `confirmedGoalRef`（未确认为 `null`）；同一回答的两张草稿可以各带一个 Goal | 请求读模型与主对话读投影草稿时；只读，不从视图反推 binding |
| `latestAnsweredRound` | `src/core/work-graph/model/request-contracts.ts:130` | 请求的最近作答轮：从最后一轮往前找调用方判定为已答的一轮，返回它的 `ref`，没有则 `null` | 请求读取与 confirm owner 共用这一顺序；不要各写倒序扫描 |
| Session facts 索引名 | `src/core/work-graph/model/session-facts-contracts.ts:27` | `SESSION_BY_PROVENANCE_LOOKUP`、`WORK_EXECUTION_BY_SESSION_LOOKUP`、`QUERY_RUN_BY_SESSION_LOOKUP`、`SESSION_ANOMALY_BY_TASK_LOOKUP`、`SESSION_ANOMALY_BY_GOAL_LOOKUP`、`SESSION_REPLY_BY_HANDLER_LOOKUP`、`SLICE1_LOOKUP_INDEXES` | 注册/读取 Session facts 索引时 |
| `SecretaryHandoffBasisV1` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:24` | too-long 事实：阈值、最后输入 token、来源 QueryRun 或 Work Run/请求序号与读取水位；D 的纯规则和读取器产出 |
| `CoverageGoalV1` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:40` | 每个 Goal 的当前理解指针、文本版本、最后文本写的 Session 与轮 |
| `CoverageFactsV1` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:49` | 覆盖读取的完整事实：源 Session、活动 revision、最后进入并结束的轮、Goal 集与首个读取水位 |
| `RoutingRootV1` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:57` | 一个未完成请求根、它的 owner 与 effective goal id |
| `RoutingSetFactsV1` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:58` | 路由扫描结果：根集合、是否关闭与读取水位 |
| `HandoffBriefNoteV1` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:59` | 简报里的注记条目：noteId、版本与正文 |
| `HandoffBriefRequestV1` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:60` | 简报里的请求条目：请求根、原文与最后回答 |
| `HandoffBriefGoalV1` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:61` | 简报里的 Goal 条目：旧秘书写的版本与当前版本 |
| `HandoffBriefV1` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:62` | 后继第一轮看到的完整简报：操作、源、旧线链接、请求与 Goal |
| `HandoffBriefStateV1` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:69` | 简报四态 none/waiting/ready/consumed；waiting 必须阻止准备，不能读成 none |
| `ConditionCheckV1` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:80` | 归档条件检查结果：可合并片段或不可归档原因 |
| `SecretaryArchiveConditionCommitV1` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:84` | 最终归档提交合并的 guards、fence 与 ledgerHorizon |
| `SecretaryHandoffFactsPort` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:93` | H 实现的交接事实端口：覆盖、路由集、简报状态与 handoff 条件检查 |
| `SecretaryArchiveConditionPort` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:102` | 归档 owner 调用的条件检查端口；组合根把 H 的 `checkArchiveCondition` 直接传进去 |
| `QueryNoteAdmissionV1` | `src/core/work-graph/model/secretary-note-contracts.ts:6` | Query 本轮可写的注记值；none 表示没有注记工具也没有注记声明 |
| `HandoffStageV1` | `src/core/work-graph/model/session-handoff-contracts.ts:23` | 交接阶段字面量类型，顺序取 HANDOFF_STAGES |
| `HandoffSavedCreateInputV1` | `src/core/work-graph/model/session-handoff-contracts.ts:25` | ensureLine 子调用的冻结输入；W 不能 import B 的 LineCreationInput |
| `HandoffSavedInputV1` | `src/core/work-graph/model/session-handoff-contracts.ts:31` | 一次原子写保存的输入：create/transfer/route/archive/understanding 或无子调用 |
| `HandoffAdvanceInputV1` | `src/core/work-graph/model/session-handoff-contracts.ts:40` | 交接推进输入：continue 从操作自身阶段选下一步，replay 取该 commandId 的回执，refusal 记下子调用的真实拒绝后停止 |
| `HandoffWriteV1` | `src/core/work-graph/model/session-handoff-contracts.ts:49` | 本次写的 commandId、阶段、项、前后、代、保存输入与回执 |
| `HandoffAdvanceStopV1` | `src/core/work-graph/model/session-handoff-contracts.ts:57` | 不写任何东西的停止：writer 未停、fence 在别人手里、或覆盖等待未提交的理解轮；操作停在原 revision |
| `HandoffAdvanceResultV1` | `src/core/work-graph/model/session-handoff-contracts.ts:61` | 交接推进命令的写结果、下一阶段与停止原因；无写停走第三臂 |
| `SessionHandoffWorkflowPort` | `src/core/work-graph/model/session-handoff-contracts.ts:71` | Workflow 侧交接入口：startHandoff/continueHandoff/advance/manualArchive |
| `HandoffProgressV1` | `src/core/work-graph/model/session-handoff-contracts.ts:81` | 交接操作的进度投影：阶段、phase、后继、归档、notice 键与最后拒绝 |
| `SecretaryArchiveStageV1` | `src/core/work-graph/model/session-handoff-contracts.ts:105` | 秘书归档阶段字面量类型，顺序取 SECRETARY_ARCHIVE_STAGES |
| `SecretaryArchiveAcceptInputV1` | `src/core/work-graph/model/session-handoff-contracts.ts:106` | 归档接受命令的输入：源 Session 与每个请求根的去向 |
| `SecretaryArchiveAcceptResultV1` | `src/core/work-graph/model/session-handoff-contracts.ts:110` | 归档接受命令的结果：操作、accepted 阶段 |
| `SecretaryArchiveAdvanceInputV1` | `src/core/work-graph/model/session-handoff-contracts.ts:112` | 归档推进输入：continue 或 replay |
| `SecretaryArchiveProgressV1` | `src/core/work-graph/model/session-handoff-contracts.ts:115` | 归档操作的进度投影：每项结果、路由轮、归档请求与最后拒绝 |
| `SecretaryArchiveAdvanceResultV1` | `src/core/work-graph/model/session-handoff-contracts.ts:123` | 归档推进命令的写结果与停止原因 |
| `HandoffBriefPort` | `src/core/work-graph/model/session-handoff-contracts.ts:137` | D 在 entered 确认时调用的简报消费端口；H 用 state 构造器实现 |
| `HandoffBriefGoalRefsV1`、`HandoffBriefGoalRefV1` | `src/core/work-graph/model/session-handoff-contracts.ts:144`、`:145` | 简报保存的每 Goal 引用（written/current），由进度的 brief 字段派生，不另立形状 | 推进写 brief、facts 层给出引用时用同一份 |
| `HandoffBriefRefsReadPort` | `src/core/work-graph/model/session-handoff-contracts.ts:151` | 简报引用的窄读口：facts 层读 Note，推进只存引用 | I1 把 facts 层作为推进的 `coverage` 依赖注入；Session owner 不读 Note |

## 内部用
- 无：本层导出的函数与常量都供上层调用；其余导出是类型契约，不做运行时实现。

## 不要做
- 不要另建平行 DTO/端口；上层读这里的同一份契约，重复校验器会让规则分叉（CS-11、M1-31）。
- 不要用裸 local ID 或内联 Session key 当记录 key/比较键（M1-32）。
- 不要复制身份/指纹 recipe，也不要把会变化的选择事实放进公共 identity（M1-25、MH-03）。
- 不要在这里 import 上层子模块、读 store、写记录或做状态迁移；状态只经 `state/`（`AGENTS.md` 第 9 条、M1-01）。
- 不要把失败或不可读读成 `not_found`、空事实或“已完成”（FP-05、M1-12、MH-06）。
- 不要声明没有真实操作支撑的端口方法；空壳会让消费者依赖不存在的行为。
- 不要写不存在的索引 `s6-query-queued-by-session`、`s6-query-unassigned`：队列读取走 `QUERY_OPEN_BY_WORKSPACE_INDEX`；`unassigned` 是 `requestRounds.unassigned`（`RequestRoundPort.unassigned`）这个具名读取，不是索引名。
