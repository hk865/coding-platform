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
- `claim-contracts.ts` — `TaskClaim` 认领、重新入队与审查认领的输入、`TaskClaimPort` 和依赖。
- `command-rerun-request-contracts.ts` — `CommandRerunRequest` 读写端口、回复分支与 Task closure 读取 DTO。
- `execution-entry-contracts.ts` — 执行授权/开始/进入/结果的端口与 DTO（不含 Query/Review 的伪 Run）。
- `execution-history-contracts.ts` — `RunExecutionHistory` 写入端口与输入/结果。
- `execution-read-contracts.ts` — `TaskExecutionRecord` 精确读取与按 Goal/Task 的执行分页。
- `query-activity-plan.ts` — Query 活动写入的纯计划：`queryActivityRefOf`、`QueryActivityRecordContent`、`planQueryActivityWrite`（替换规则调用 `state/activity-replacement.ts`）与 `queryActivitySourceOf`（记录里的目标和两个 Session）。
- `task-contracts.ts` — `GoalTaskPort`（创建/完成/控制 Goal）与 `GraphWrite` 正本。
- `task-index.ts` — plan-local 的正反邻接构造和两种环检测，纯算法、无 Store 语义。

### Session/请求/通信
做 Session 目录、request round、收件箱、工具参数映射和命令识别的去这组。
- `command-recognition-contracts.ts` — 阻塞命令识别结果 `BlockedCommandMatchV1` 与共享的 `CommandRecognizer` 类型。
- `communication-contracts.ts` — Session 收件箱的 DTO/端口、消息事件类型与 `deriveSessionInputId`；投递与读 `disposition` 的唯一纯推导 `deriveMessageDelivery`（输入 `MessageDeliveryFactsV1`、结果 `MessageDeliveryDerivationV1`），并再导出 C 的 `MessageDeliveryStateV1`/`MessageReadDispositionV1`；完整命令端口（`SessionMessageCommandPort`，扩展窄的 `SessionMailboxPort`）、发送结果、两个视图读、四个生命周期事件、请求 owner 读端口和信箱依赖的五个可选注入。
- `message-payload.ts` — send/respond 工具参数的唯一载荷模型：`SendMessageV1`、`RespondMessageV1` 与两个纯规范化函数；工具 schema、请求构造和只读查找共用它，同样的参数得到同样的 owner 输入和指纹。
- `request-contracts.ts` — request round 视图、秘书选择端口、队列预算常量、活尝试阶段集合（`LIVE_ATTEMPT_PHASES`，队列与秘书选择共用）、Query/Request 索引名、请求根索引的槽值；交接要用的请求侧条目：固定的 Host system 主体 `HANDOFF_SYSTEM_PRINCIPAL`、`InternalRouteCommandV1`、`RequestCommandReceiptReadV1`、`HandoffRequestCommandV1` 与 `HandoffRequestReceiptReadPort`（`tasks/request-service.ts` 再导出前三个），sessions 和 state 的交接文件从这里取，不 import tasks。
- `request-ideas.ts` — 回答思路的唯一规则：`validIdeaCount` 与 `ideasIssues`（纯函数）。
- `secretary-contracts.ts` — 秘书准备读取的契约：`SecretaryHistoryEntryV1`、`SecretaryPreparationFactsV1`（请求事实带 `briefRef` 与唯一一份 `understandingGrants`）、`SecretaryPreparationFactsPort`（实现在 views，组合根注入）。
- `secretary-query-run-contracts.ts` — 运行中的秘书 QueryRun 的受信事实 `SecretaryQueryRunV1` 与解析端口 `SecretaryQueryRunPort`；`goals` 只是冻结材料列表上仍有效的 `request_understanding` 授权集（解析时按当前 operation 记录重算），绝不是本轮的有效 Goal；`planRef` 是准备时冻结的 Plan，秘书的阶段锚点取它的版本。
- `secretary-lifecycle-contracts.ts` — 秘书生命周期的跨组契约：`SecretaryHandoffBasisV1`、覆盖/路由/简报事实与四态、归档条件的可合并片段、`SecretaryHandoffFactsPort`/`SecretaryArchiveConditionPort`；只有声明，规则和读取器在各自 owner。
- `secretary-note-contracts.ts` — 再导出 `QueryNoteAdmissionV1`（Query 本轮可写的注记值：none 或 secretary 的 kinds/withdraw/grantedGoalIds）；唯一的声明和纯规则 `secretaryNoteAdmission` 都在 `state/secretary-note.ts`。
- `session-handoff-contracts.ts` — 交接推进与秘书归档的输入/结果/进度类型，简报消费端口 `HandoffBriefPort`、简报引用的窄读口 `HandoffBriefRefsReadPort` 与 Workflow 入口 `SessionHandoffWorkflowPort`；命令和组合在各自 owner。
- `session-activity-contracts.ts` — Session 活动记录的窄读端口：`SessionActivityStateV1`（`src/core/work-graph/model/session-activity-contracts.ts:17`；`revision: 0` 是缺失，`record: null` 与坏记录区分）与 `SessionActivityReadPort`（`src/core/work-graph/model/session-activity-contracts.ts:20`；实现在 `sessions/session-activity.ts`，调用方不拼记录键、不解码信封）；这两个契约目前没有生产调用者，留给第 7 片按决定 91 的保留上限重建同一读取（allowlist 的 `kept-for`）。
- `session-contracts.ts` — Session 创建/目录/分页契约；`CoreOperation` 记录的三个分支（`SessionOperationRecordOf`：顶层 `workspaceId`，`action.kind` 为 `create`/`handoff`/`secretary_archive`；创建分支带 `parentOperation`），读者先判 `kind`；只 `export type { GraphWrite }` 转出（测试经此路径 import），正本在 `task-contracts.ts`。
- `session-operation-arms.ts` — `CoreOperation` 的交接分支和秘书归档分支：两张字段表（`HandoffActionShape`、`SecretaryArchiveActionShape`）、两组阶段（`HANDOFF_STAGES`、`SECRETARY_ARCHIVE_STAGES`）、四条规则和推出的类型；进度里的三个保存位置（`createInput`、`understanding[].command`、`archiveRequest.savedInput`）和归档的 `input.actor` 也在这里，旧记录由唯一的 `upgradeSessionOperationActionV1` 补 `null`；`progress` 只由 `state/session-handoff.ts` 写。
- `session-facts-contracts.ts` — Session facts/责任 basis 端口、6 个查找索引名与 `SLICE1_LOOKUP_INDEXES`；撤回用的收件方未结束执行端口（`RecipientExecutionsPort`）与 `OPEN_WORK_STAGES`/`OPEN_QUERY_PHASES`。
- `dispatch-basis-contracts.ts` — 派发依据：三版事实（计划窗口、理解指针、`DispatchCounter`）的事实读与公开投影端口，以及目标理解指针端口（`GoalUnderstandingPointerPort`）。
- `tool-commit-arguments.ts` — Kernel 工具参数到 owner `GraphWrite` 的纯映射，以及 tool commit 的 identity/lookup 辅助。

### 计划/证据/审查
做 Plan、证据/验证、决定队列和未知调用审查的去这组。
- `decision-contracts.ts` — 决定队列/卡片/notice、Goal 设置与答复的端口和读 DTO；`DecisionCardV1` 与 `NoticeItemV1` 带 `subject`（`DecisionSubjectV1`，Goal 或 project），没有并列的 `goalRef`；卡片来源端口用 `project?: boolean` 标记兼服务项目 subject，注记决定来源按 `subject` 读；7A-1 的消息提交写端口（`MessageCommandWritePort`，扩展窄的 `MessageWriteOwnerPort`）、提交伴随记录与片段，以及交给 7A-2 的放行端口（`MessageReleasePort`、`MessageReleaseCandidatesPort`）和放行卡条目输入。
- `goal-copy-contracts.ts` — 复制取消 Goal 的两个端口：`CopyInterventionReadPort`（分页读可复制干预，失败是拒绝不是空集）与 `CopyInterventionRetractionPort`（撤回一条），以及候选 DTO `CopyInterventionCandidateV1`。
- `evidence-contracts.ts` — `EvidencePort`：验证轮、检查开始/记录/终止/重验的写入口。
- `plan-contracts.ts` — Plan/Goal 读模型、诊断、`PlanTaskPort` 与 `PlanServicePort`。
- `unknown-call-review-contracts.ts` — `UnknownCallReview` 的读/写端口与分页输入。

### 工作线/上下文/配置
做工作线/节点读取、图上下文、任务输入、角色配置、Kernel 读取、材料和注记的去这组。
- `configuration-contracts.ts` — RoleSpec 安装/激活/读取、`RoleBindingFactsPort` 与绑定解析端口。
- `context-input-contracts.ts` — `TaskContextInputPort`：任务输入选择与分页读取。
- `graph-context-contracts.ts` — 图上下文、任务卡、节点卡的读端口与 DTO；`look`/`find` 的 `goalRef` 可为 `null`（项目分支，不借任何 Goal 的 universe）；extensions 另有空目标的请求类型（只读项目理解和 norms，整份上下文读取仍要求 Goal）。
- `kernel-command-read-contracts.ts` — Kernel 原始命令与 workspace 文件读取的窄端口类型。
- `material-contracts.ts` — `MaterialPort`：artifact 存储与按引用打开。
- `note-contracts.ts` — 注记/记忆的写入、读取、检查、决定应用端口，上限常量与 `recordNoteRequestOf`。
- `work-line-contracts.ts` — 工作线、节点详情、悬停读取与线 pin 写入端口。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `GraphWrite` **正本** | `src/core/work-graph/model/task-contracts.ts:28` | 写请求信封 `{input, meta}`。`session-contracts.ts:14`、`src/core/work-graph/architecture/contracts.ts:16` 只是转出，不是副本 | 所有 GraphWrite 端口的请求参数 |
| `TaskClaimPort` | `src/core/work-graph/model/claim-contracts.ts:115` | 认领、重新入队、审查认领的写入口 | Task claim owner 注入时 |
| `SessionDirectoryPort` | `src/core/work-graph/model/session-contracts.ts:79` | Session 创建、读取与分页目录 | Session 目录消费者 |
| `SessionOperationRecordOf`、`SessionOperationRecord`、`SessionCreateOperationRecord` | `src/core/work-graph/model/session-contracts.ts:46`、`:63`、`:64` | `CoreOperation` 记录：按分支取类型；`admitSessionCreation` 只返回创建分支 | 读操作记录先判 `action.kind`，非创建分支在创建身份上答 `unavailable` |
| `SessionCreateActionV1`、`SessionOperationActionV1` | `src/core/work-graph/model/session-contracts.ts:41`、`:45` | 创建分支的动作（带 `parentOperation`）；`CoreOperation` 三个分支的动作联合 | 只处理创建分支的读者用前者；读通用操作记录的 `action` 先判 `kind` |
| `HandoffActionShape`、`HandoffActionV1`、`HANDOFF_STAGES` | `src/core/work-graph/model/session-operation-arms.ts:215`、`:316`、`:212` | 交接分支的字段表、类型和阶段顺序（`accepted` … `finished`），含每个分配的 `createInput`、每个理解代的 `command` 和 `archiveRequest.savedInput` | 校验、编码交接操作；推进步骤按这个阶段顺序 |
| `SecretaryArchiveActionShape`、`SecretaryArchiveActionV1`、`SECRETARY_ARCHIVE_STAGES` | `src/core/work-graph/model/session-operation-arms.ts:292`、`:317`、`:291` | 秘书归档分支的字段表、类型和阶段顺序；`input.actor` 是接受时保存的可信 actor，旧记录为 `null` | 校验、编码秘书归档操作 |
| `handoffReachedInputProblem`、`archiveSavedInputProblem` | `src/core/work-graph/model/session-operation-arms.ts:162`、`:179` | 已到达步骤缺原输入的拒绝规则（交接与秘书归档各一条正本）：`create` 目标的分配已标 successor/createOperation 但 `createInput` 为 `null`、`understanding` 有 round 但 `command` 为 `null`、`archiveRequest` 有 receipt 但 `savedInput` 为 `null` 各给一条原因；`existing` 目标本来不存 create 输入 | 推进服务在选下一步之前据此答 `invalid`；不要重建输入或跳过该步 |
| `upgradeSessionOperationActionV1` | `src/core/work-graph/model/session-operation-arms.ts:324` | 唯一的兼容读：旧记录/事件缺 `createInput`、`understanding[].command`、`archiveRequest.savedInput` 或归档 `actor` 时读作 `null`；没有可补的字段时原样返回 | `sessions/session-record-codecs.ts` 的记录读和两个分支事件在字段表检查之前调用它，返回的就是升级后的值；不要另写 normalizer |
| `GoalTaskPort` | `src/core/work-graph/model/task-contracts.ts:59` | Goal 创建、Task/Goal 正式完成与 desired state 控制 | Goal/Task 写 owner |
| `PlanTaskPort` | `src/core/work-graph/model/plan-contracts.ts:204` | Plan 采用、task 读与规划诊断 | Plan/task 写 owner |
| `ExecutionEntryPort` | `src/core/work-graph/model/execution-entry-contracts.ts:109` | 执行授权、开始、进入、结果与恢复的写入口 | Runtime 执行进入 |
| `ExecutionReadPort` | `src/core/work-graph/model/execution-read-contracts.ts:96` | 精确 Task execution 与按 Goal/Task 的分页读取 | 读执行事实，不再另写读取器 |
| `EvidencePort` | `src/core/work-graph/model/evidence-contracts.ts:110` | 验证轮与检查生命周期的唯一受信写入口 | 证据/验证 owner |
| `MaterialPort` | `src/core/work-graph/model/material-contracts.ts:11` | 存 artifact、按引用打开并区分历史用途 | 材料读写 |
| `SessionMailboxPort` | `src/core/work-graph/model/communication-contracts.ts:273` | 消息发送、读取、ack、回复；读不改状态 | 收件箱与决定消息 |
| `DecisionReadPort` | `src/core/work-graph/model/decision-contracts.ts:413` | 决定队列、来源页与冲突读取 | 决定读模型 |
| `DecisionSourceFactsPort` | `src/core/work-graph/model/decision-contracts.ts:228` | 重建决定来源事实；`readSource` 的 `goal` 在项目 subject 为 `null` | 答复/卡片前证明来源真实时 |
| `NoteDecisionSourcePort` | `src/core/work-graph/model/decision-contracts.ts:260` | 注记复核卡：`readNoteDecisions` 收 `subject`（Goal 或 project）、按 pin 读一张（带回注记自己的 `subject`，只在过时信号时为 `null`）与应用 | 装配注记卡来源时 |
| `DecisionCardSourcePort` | `src/core/work-graph/model/decision-contracts.ts:432` | 把来源记录投影成决定卡；`serves` 声明来源服务的 subject（`goal`：每个 Goal 读一次；`project`：读不按 Goal 过滤时为绑定的项目读一次，零 Goal 也读）；`readPage` 不带 `goalRef` 即读项目的卡，不服务的 subject 回空页 | 卡片来源适配 |
| `DecisionNoticeSourcePort` | `src/core/work-graph/model/decision-contracts.ts:452` | notice 项的读取与排序 | notice 来源适配 |
| `CopyInterventionReadPort`、`CopyInterventionRetractionPort`、`CopyInterventionCandidateV1` | `src/core/work-graph/model/goal-copy-contracts.ts:18`、`src/core/work-graph/model/goal-copy-contracts.ts:23`、`src/core/work-graph/model/goal-copy-contracts.ts:14` | 复制取消 Goal 时读可复制干预、撤回一条，以及候选 DTO（失败是拒绝，不是空集） | 实现或注入 copy 端口时 |
| `NoteWritePort` | `src/core/work-graph/model/note-contracts.ts:89` | 注记写入、审核、撤回 | 注记写 owner |
| `NoteReadPort` | `src/core/work-graph/model/note-contracts.ts:317` | 注记按引用/列表/版本读取 | 注记读模型 |
| `NoteMemoryReadPort` | `src/core/work-graph/model/note-contracts.ts:414` | 记忆 lookup/neighbors/history/conflicts/find/stale | 注记检索 |
| `UnknownCallReviewPort` | `src/core/work-graph/model/unknown-call-review-contracts.ts:59` | 未知调用审查的读与写 | 审查/重跑链路 |
| `WorkLineReadPort` | `src/core/work-graph/model/work-line-contracts.ts:21` | 工作线列表、详情、分页与对话来源 | 工作线读模型 |
| `NodeDetailReadPort` | `src/core/work-graph/model/work-line-contracts.ts:33` | 图悬停与节点详情读取 | 图/节点详情 |
| `WorkLineSettingsPort` | `src/core/work-graph/model/work-line-contracts.ts:37` | 线的 pin 增删写入 | 线设置写 owner |
| `TaskContextInputPort` | `src/core/work-graph/model/context-input-contracts.ts:20` | 任务输入选择与分页 | 上下文装配 |
| `GraphContextReadPort` | `src/core/work-graph/model/graph-context-contracts.ts:91` | 图上下文、look/find 与节点卡；`goalRef` 为 `null` 时走项目分支（架构 module、Session、项目注记，命名 Goal 只读） | 图上下文读取、无 Goal 的秘书轮 |
| `RoleConfigurationPort` | `src/core/work-graph/model/configuration-contracts.ts:15` | RoleSpec 安装/激活/读取、按绑定解析角色 | 角色配置与准入 |
| `CommandRecognizer` | `src/core/work-graph/model/command-recognition-contracts.ts:23` | 请求 owner 与 shell hook 共用的唯一命令识别器 | 识别阻塞命令，不要另写解析 |
| `deriveSessionInputId` | `src/core/work-graph/model/communication-contracts.ts:69` | 由 message ref 与 part 生成稳定的 session-input id | Kernel 供给与 mailbox 消费对齐时 |
| `deriveMessageDelivery` | `src/core/work-graph/model/communication-contracts.ts:98` | 消息投递与读 `disposition` 的唯一推导（`MessageDeliveryFactsV1` → `MessageDeliveryDerivationV1`）：accepted input → `delivered`（`accepted`）；read/responded → `delivered`（`legacy_unknown`）；否则收件线 archived/retired → `undelivered` 与原因（archived 优先）；剩下 `queued`；withdrawn、未放行、已送达、未送达、可发送依次决定 `disposition`。只读记录的 `status`/`release`/`withdrawnAt`/`acceptedInputs`，不读记录上存的 `delivery` | 工作线消息分节及其它要判投递/读 `disposition` 的消息读；不要另写投递判断 |
| `dispatchBasisProblem` | `src/core/work-graph/model/message-payload.ts:70` | 非空 `DispatchBasisV1` 的唯一检查：恰好 `planRevision`、`pointerRevision`、`dispatchSequence` 三个字段，`planRevision` 为 null 或非负整数，`pointerRevision` 为 `'none'` 或非负整数，`dispatchSequence` 为非负整数；返回问题文字，没问题返回 null | send 的 `expected` 规范化和消息 codec 的 pins 检查（`message pins ` 加这里的文字）；不要另写 |
| `normalizeSendMessageInput` | `src/core/work-graph/model/message-payload.ts:87` | send 工具参数 → `SendMessageV1`：没给的可选字段取 mailbox owner 的默认值（`waitAfterSend` 为 false；`needsReply` 只在显式 true，或没给且 `waitAfterSend` 为 true 时为 true）；`deadlineMs` 须是大于 0 的有限数；多余或坏的字段是 `invalid`。纯函数，不读时钟 | send 工具、请求构造和提交查找解码参数时；不要另写解码 |
| `normalizeRespondMessageInput` | `src/core/work-graph/model/message-payload.ts:152` | respond 工具参数 → `RespondMessageV1`：正文是 `{ text }` 或 `{ reject: true, reason }` 二选一，`expectedRevision` 是正整数；两臂都给、都不给、缺 `messageRef` 或多余字段是 `invalid` | respond 工具、请求构造和提交查找解码参数时 |
| `recordNoteRequestOf` | `src/core/work-graph/model/note-contracts.ts:159` | 工具参数 → 注记 owner 请求，注入可信 commandId 并补默认值 | note 工具与查找共用同一份参数 |
| `buildTaskAdjacency` | `src/core/work-graph/model/task-index.ts:23` | 构造一个 plan 的正向/反向依赖表，保留声明顺序 | 需要 plan-local 邻接时 |
| `hasDirectedCycle` | `src/core/work-graph/model/task-index.ts:46` | 对已有邻接表做 DFS 环检测 | 已构造邻接后校验 |
| `hasCycleInEdges` | `src/core/work-graph/model/task-index.ts:69` | 对任意 `{from,to}` 边集做环检测 | 非执行 DAG 的关系校验 |
| `queryActivityRefOf` | `src/core/work-graph/model/query-activity-plan.ts:26` | 由完整 `QueryRunRef` 构造 `QueryActivity` 记录 ref | 读写 Query 活动记录；不要另拼 ref |
| `planQueryActivityWrite` | `src/core/work-graph/model/query-activity-plan.ts:41` | 调 `decideActivityOutcome` 定 created/replaced/unchanged 并构造下一版 `QueryActivity` 快照与 span | Query 收尾提交与 Query backfill；不要另写替换规则 |
| `queryActivitySourceOf` | `src/core/work-graph/model/query-activity-plan.ts:79` | 从 QueryJob 与 QueryRun 读出记录要写的目标（请求轮取 prepared manifest 冻结的目标，其他取 intent 目标）、执行 Session 和被问 Session；两个 Session 都投影成 `{projectId, sessionId}`（claim 可能留下完整 Session aggregate ref）；进入了却没有 prepared manifest 的请求轮答原因 | Query 收尾提交与 Query backfill 写记录内容；不要另读目标或 Session |
| `toolCommitRequestId` | `src/core/work-graph/model/tool-commit-arguments.ts:68` | 由 origin/toolName/kernelCallId 派生稳定的工具 commit request id | 工具 handler 与 lookup 需要同一 id |
| `agentActorOf` | `src/core/work-graph/model/tool-commit-arguments.ts:85` | 由 SessionRef/RunRef 构造唯一的 agent actor | 委派写入身份 |
| `sendSessionMessageRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:94` | `send_session_message` 参数 → mailbox 请求 | 工具 handler 构造请求 |
| `ackSessionMessageRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:112` | `ack_session_message` 参数 → 带 revision pin 的请求 | ack 工具 |
| `respondSessionMessageRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:121` | `respond_session_message` 参数 → 带 revision pin 的请求 | respond 工具 |
| `sendUserMessageRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:131` | `send_user_message` 参数 → mailbox 请求 | 用户消息工具 |
| `recordDecisionApplicationInput` | `src/core/work-graph/model/tool-commit-arguments.ts:146` | 规范化决定应用的输入形状 | 指纹计算与写入共用 |
| `recordDecisionApplicationRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:162` | 决定应用参数 → 带 expected pins 的请求 | 决定应用工具 |
| `proposeFuturePlanRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:168` | `propose_future_plan` 参数 → plan owner 请求 | 未来 Plan 工具 |
| `toolCommitLookupResult` | `src/core/work-graph/model/tool-commit-arguments.ts:177` | 把 Store lookup 结果映射成 committed/not_committed/undetermined | owner 的只读 lookup |
| `toolCommitLookupUnknownTool` | `src/core/work-graph/model/tool-commit-arguments.ts:188` | 对不属于该 owner 的工具名返回 undetermined | 统一 lookup 分发 |
| 注记写入上限 | `src/core/work-graph/model/note-contracts.ts:22` | `NOTE_CONCLUSION_MAX_CODEPOINTS`、`NOTE_BODY_MAX_BYTES`、`UNDERSTANDING_BODY_MAX_BYTES`、`NOTE_FACTS_MAX`、`NOTE_BASIS_FILES_MAX`、`NOTE_BASIS_FILE_MAX_BYTES`、`NOTE_SYMBOL_HITS_MAX`、`NOTE_EXTRA_ANCHORS_MAX`、`NOTE_ANCHOR_QUOTA`、`NOTE_GOAL_QUOTA`、`NOTE_EXISTING_TOPICS_MAX`、`NOTE_ANCHOR_CANDIDATES_MAX`、`NOTE_ANCHOR_CANDIDATE_SCAN` | 注记写入/锚点准入的注入初值 |
| 注记与记忆读取上限 | `src/core/work-graph/model/note-contracts.ts:32` | `MEMORY_PAGE_MAX`、`NOTE_READ_FILES_MAX`、`NOTE_READ_FACTS_MAX`、`NOTE_SYMBOL_RECHECK_MAX`、`MEMORY_PAGE_DEFAULT`、`MEMORY_RESULT_MAX_BYTES`、`NOTE_BODY_PAGE_BYTES`、`MEMORY_TOPICS_MAX` | 注记/记忆读取分页与字节上限 |
| 检索与项目理解上限 | `src/core/work-graph/model/note-contracts.ts:46` | `TEXT_SEARCH_MAX_TERMS`、`TEXT_SEARCH_CANDIDATE_MAX`、`NOTE_RANK_WEIGHT_TOPIC`、`NOTE_RANK_WEIGHT_CONCLUSION`、`NOTE_RANK_WEIGHT_BODY`、`NOTE_SIMILAR_MAX`、`NOTE_SIMILAR_MIN`、`PROJECT_UNDERSTANDING_BODY_MAX_BYTES`、`FIND_RELATED_FILES_MAX`、`PROJECT_NORMS_CHECK_MAX`、`PROJECT_NORMS_MAX` | 全文检索、排序与项目理解读取；`TEXT_SEARCH_MAX_TERMS` 就是全文检索的词数上限 |
| 秘书选择与历史预算 | `src/core/work-graph/model/request-contracts.ts:26` | `SECRETARY_HANDOFF_INPUT_TOKENS`、`SECRETARY_PICK_RETRIES`、`SECRETARY_TAIL_RETRIES`、`IDEA_DETAIL_MAX_CODEPOINTS`、`SECRETARY_HISTORY_ROUNDS`、`SECRETARY_HISTORY_ANSWER_BYTES` | 秘书候选、交接与历史窗口 |
| request 队列预算 | `src/core/work-graph/model/request-contracts.ts:39` | `REQUEST_PASS_PAGES`、`REQUEST_PAGE_SIZE`、`REQUEST_ADVANCES_PER_PASS`、`REQUEST_DRAINED_PER_PASS`、`REQUEST_BACKOFF_INITIAL_MS`、`REQUEST_BACKOFF_MAX_MS` | request 队列分页、并发与退避 |
| request 的两个认领槽键 | `src/core/work-graph/model/request-contracts.ts:68` | `requestTailKey`、`secretaryIntakeKey`（前缀 `REQUEST_TAIL_PREFIX`、`SECRETARY_INTAKE_PREFIX`） | 正本：request-tail 与 secretary-intake 的键只从这里构造；queries 和 tasks 都用它，不另拼字符串 |
| 交接 fence 的前缀 | `src/core/work-graph/model/request-contracts.ts:80` | `SECRETARY_HANDOFF_PREFIX` | 每 Session 的交接 fence 键的前缀；键的函数体 `secretaryHandoffClaimKey` 在 D 的 fence 文件，别处不要另拼 |
| 思路标题上限 | `src/core/work-graph/model/request-contracts.ts:33` | `IDEA_TITLE_MAX_CODEPOINTS`（120 个码点，一行） | 校验或存储一个回答的 ideas 时，和 `IDEA_DETAIL_MAX_CODEPOINTS` 一起用 |
| 思路的唯一规则 | `src/core/work-graph/model/request-ideas.ts:12`、`src/core/work-graph/model/request-ideas.ts:17` | `validIdeaCount`（0、2 或 3 个）；`ideasIssues`（数组、条数、每条 title/detail 是字符串、标题一行非空且 ≤120 码点、说明 ≤600 码点，返回问题列表） | 正本：秘书回答检查（`queries/secretary-answer.ts`）、回答 codec 的存储复检（`queries/query-record-codecs.ts`）和选思路入口（`tasks/request-service.ts`）都调它，不另写思路规则 |
| 秘书准备的读取端口 | `src/core/work-graph/model/secretary-contracts.ts:58` | `SecretaryPreparationFactsPort`：按 QueryRun 读一次请求（含 `briefRef` 与 `understandingGrants`）、工作区、架构、政策、目标列表和执行种类，带 guards 和 watermark | 秘书轮的准备只经这个端口取事实 |
| `SecretaryQueryRunPort`、`SecretaryQueryRunV1` | `src/core/work-graph/model/secretary-query-run-contracts.ts:35`、`src/core/work-graph/model/secretary-query-run-contracts.ts:22` | `resolveSecretaryQueryRun(ctx)` 返回一轮运行中的秘书 QueryRun 的受信事实 `SecretaryQueryRunV1`：Session、duty、scope、round、run、准备时冻结的 `effectiveGoalId` 与 Plan（`planRef`）、requestRoot、sessionGeneration 与当前 `request_understanding` 授权集 | 注记 owner 的 `query_run` 准入；7A 的发送准入复用同一端口 |
| Query/Request 索引名 | `src/core/work-graph/model/request-contracts.ts:54` | `QUERY_BY_REQUEST_INDEX`、`QUERY_OPEN_BY_WORKSPACE_INDEX`、`REQUEST_ROOTS_BY_GOAL_INDEX`、`QUERY_RAN_BY_SESSION_GOAL_INDEX` | 注册或查询这些固定索引时；`unassigned` 读取用 `QUERY_OPEN_BY_WORKSPACE_INDEX` |
| 请求根索引的槽值 **正本** | `src/core/work-graph/model/request-contracts.ts:174`、`src/core/work-graph/model/request-contracts.ts:177` | `REQUEST_ROOT_MARK`（根轮的 `rootMark`）、`requestGoalSlot`（`g:<goalId>`，无 Goal 是 `no-goal`） | 写 `s6-request-roots-by-goal` 的槽（codec）和按它读（主对话）都用这一份，不另拼字符串 |
| Session facts 索引名 | `src/core/work-graph/model/session-facts-contracts.ts:27` | `SESSION_BY_PROVENANCE_LOOKUP`、`WORK_EXECUTION_BY_SESSION_LOOKUP`、`QUERY_RUN_BY_SESSION_LOOKUP`、`SESSION_ANOMALY_BY_TASK_LOOKUP`、`SESSION_ANOMALY_BY_GOAL_LOOKUP`、`SESSION_REPLY_BY_HANDLER_LOOKUP`、`SLICE1_LOOKUP_INDEXES` | 注册/读取 Session facts 索引时 |
| `SecretaryHandoffBasisV1` | `src/core/work-graph/model/secretary-lifecycle-contracts.ts:23` | too-long 事实：阈值、最后输入 token、来源 QueryRun/请求序号与读取水位；D 的纯规则和读取器产出 |
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
| `SecretaryArchiveStageV1` | `src/core/work-graph/model/session-handoff-contracts.ts:89` | 秘书归档阶段字面量类型，顺序取 SECRETARY_ARCHIVE_STAGES |
| `SecretaryArchiveAcceptInputV1` | `src/core/work-graph/model/session-handoff-contracts.ts:90` | 归档接受命令的输入：源 Session 与每个请求根的去向 |
| `SecretaryArchiveAcceptResultV1` | `src/core/work-graph/model/session-handoff-contracts.ts:94` | 归档接受命令的结果：操作、accepted 阶段 |
| `SecretaryArchiveAdvanceInputV1` | `src/core/work-graph/model/session-handoff-contracts.ts:96` | 归档推进输入：continue 或 replay |
| `SecretaryArchiveProgressV1` | `src/core/work-graph/model/session-handoff-contracts.ts:99` | 归档操作的进度投影：每项结果、路由轮、归档请求与最后拒绝 |
| `SecretaryArchiveAdvanceResultV1` | `src/core/work-graph/model/session-handoff-contracts.ts:107` | 归档推进命令的写结果与停止原因 |
| `HandoffBriefPort` | `src/core/work-graph/model/session-handoff-contracts.ts:121` | D 在 entered 确认时调用的简报消费端口；H 用 state 构造器实现 |
| `HandoffBriefGoalRefsV1`、`HandoffBriefGoalRefV1` | `src/core/work-graph/model/session-handoff-contracts.ts:128`、`:129` | 简报保存的每 Goal 引用（written/current），由进度的 brief 字段派生，不另立形状 | 推进写 brief、facts 层给出引用时用同一份 |
| `HandoffBriefRefsReadPort` | `src/core/work-graph/model/session-handoff-contracts.ts:135` | 简报引用的窄读口：facts 层读 Note，推进只存引用 | I1 把 facts 层作为推进的 `coverage` 依赖注入；Session owner 不读 Note |

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
