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
- `task-contracts.ts` — `GoalTaskPort`（创建/完成/控制 Goal）与 `GraphWrite` 正本。
- `task-index.ts` — plan-local 的正反邻接构造和两种环检测，纯算法、无 Store 语义。

### Session/请求/通信
做 Session 目录、request round、收件箱、工具参数映射和命令识别的去这组。
- `command-recognition-contracts.ts` — 阻塞命令识别结果 `BlockedCommandMatchV1` 与共享的 `CommandRecognizer` 类型。
- `communication-contracts.ts` — Session 收件箱的 DTO/端口、消息事件类型与 `deriveSessionInputId`。
- `request-contracts.ts` — request round 视图、秘书选择端口、队列预算常量、活尝试阶段集合（`LIVE_ATTEMPT_PHASES`，队列与秘书选择共用）与 Query/Request 索引名。
- `request-ideas.ts` — 回答思路的唯一规则：`validIdeaCount` 与 `ideasIssues`（纯函数）。
- `secretary-contracts.ts` — 秘书准备读取的契约：`SecretaryHistoryEntryV1`、`SecretaryPreparationFactsV1`、`SecretaryPreparationFactsPort`（实现在 views，组合根注入）。
- `session-contracts.ts` — Session 创建/目录/分页契约；文件里的 `GraphWrite` 是旧副本，正本在 `task-contracts.ts`。
- `session-facts-contracts.ts` — Session facts/责任 basis 端口、6 个查找索引名与 `SLICE1_LOOKUP_INDEXES`。
- `tool-commit-arguments.ts` — Kernel 工具参数到 owner `GraphWrite` 的纯映射，以及 tool commit 的 identity/lookup 辅助。

### 计划/证据/审查
做 Plan、证据/验证、决定队列和未知调用审查的去这组。
- `decision-contracts.ts` — 决定队列/卡片/notice、Goal 设置与答复的端口和读 DTO。
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
| `GraphWrite` **正本** | `src/core/work-graph/model/task-contracts.ts:28` | 写请求信封 `{input, meta}`。旧副本在 `session-contracts.ts:12`、`src/core/work-graph/architecture/contracts.ts:16`，见“不要做” | 所有 GraphWrite 端口的请求参数 |
| `TaskClaimPort` | `src/core/work-graph/model/claim-contracts.ts:115` | 认领、重新入队、审查认领的写入口 | Task claim owner 注入时 |
| `SessionDirectoryPort` | `src/core/work-graph/model/session-contracts.ts:66` | Session 创建、读取与分页目录 | Session 目录消费者 |
| `GoalTaskPort` | `src/core/work-graph/model/task-contracts.ts:59` | Goal 创建、Task/Goal 正式完成与 desired state 控制 | Goal/Task 写 owner |
| `PlanTaskPort` | `src/core/work-graph/model/plan-contracts.ts:204` | Plan 采用、task 读与规划诊断 | Plan/task 写 owner |
| `ExecutionEntryPort` | `src/core/work-graph/model/execution-entry-contracts.ts:109` | 执行授权、开始、进入、结果与恢复的写入口 | Runtime 执行进入 |
| `ExecutionReadPort` | `src/core/work-graph/model/execution-read-contracts.ts:96` | 精确 Task execution 与按 Goal/Task 的分页读取 | 读执行事实，不再另写读取器 |
| `EvidencePort` | `src/core/work-graph/model/evidence-contracts.ts:110` | 验证轮与检查生命周期的唯一受信写入口 | 证据/验证 owner |
| `MaterialPort` | `src/core/work-graph/model/material-contracts.ts:11` | 存 artifact、按引用打开并区分历史用途 | 材料读写 |
| `SessionMailboxPort` | `src/core/work-graph/model/communication-contracts.ts:147` | 消息发送、读取、ack、回复；读不改状态 | 收件箱与决定消息 |
| `DecisionReadPort` | `src/core/work-graph/model/decision-contracts.ts:341` | 决定队列、来源页与冲突读取 | 决定读模型 |
| `DecisionCardSourcePort` | `src/core/work-graph/model/decision-contracts.ts:360` | 把来源记录投影成决定卡 | 卡片来源适配 |
| `DecisionNoticeSourcePort` | `src/core/work-graph/model/decision-contracts.ts:373` | notice 项的读取与排序 | notice 来源适配 |
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
| `deriveSessionInputId` | `src/core/work-graph/model/communication-contracts.ts:56` | 由 message ref 与 part 生成稳定的 session-input id | Kernel 供给与 mailbox 消费对齐时 |
| `recordNoteRequestOf` | `src/core/work-graph/model/note-contracts.ts:159` | 工具参数 → 注记 owner 请求，注入可信 commandId 并补默认值 | note 工具与查找共用同一份参数 |
| `buildTaskAdjacency` | `src/core/work-graph/model/task-index.ts:23` | 构造一个 plan 的正向/反向依赖表，保留声明顺序 | 需要 plan-local 邻接时 |
| `hasDirectedCycle` | `src/core/work-graph/model/task-index.ts:46` | 对已有邻接表做 DFS 环检测 | 已构造邻接后校验 |
| `hasCycleInEdges` | `src/core/work-graph/model/task-index.ts:69` | 对任意 `{from,to}` 边集做环检测 | 非执行 DAG 的关系校验 |
| `toolCommitRequestId` | `src/core/work-graph/model/tool-commit-arguments.ts:63` | 由 origin/toolName/kernelCallId 派生稳定的工具 commit request id | 工具 handler 与 lookup 需要同一 id |
| `agentActorOf` | `src/core/work-graph/model/tool-commit-arguments.ts:80` | 由 SessionRef/RunRef 构造唯一的 agent actor | 委派写入身份 |
| `sendSessionMessageRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:89` | `send_session_message` 参数 → mailbox 请求 | 工具 handler 构造请求 |
| `ackSessionMessageRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:103` | `ack_session_message` 参数 → 带 revision pin 的请求 | ack 工具 |
| `respondSessionMessageRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:112` | `respond_session_message` 参数 → 带 revision pin 的请求 | respond 工具 |
| `sendUserMessageRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:122` | `send_user_message` 参数 → mailbox 请求 | 用户消息工具 |
| `recordDecisionApplicationInput` | `src/core/work-graph/model/tool-commit-arguments.ts:137` | 规范化决定应用的输入形状 | 指纹计算与写入共用 |
| `recordDecisionApplicationRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:153` | 决定应用参数 → 带 expected pins 的请求 | 决定应用工具 |
| `proposeFuturePlanRequest` | `src/core/work-graph/model/tool-commit-arguments.ts:159` | `propose_future_plan` 参数 → plan owner 请求 | 未来 Plan 工具 |
| `toolCommitLookupResult` | `src/core/work-graph/model/tool-commit-arguments.ts:168` | 把 Store lookup 结果映射成 committed/not_committed/undetermined | owner 的只读 lookup |
| `toolCommitLookupUnknownTool` | `src/core/work-graph/model/tool-commit-arguments.ts:179` | 对不属于该 owner 的工具名返回 undetermined | 统一 lookup 分发 |
| 注记写入上限 | `src/core/work-graph/model/note-contracts.ts:22` | `NOTE_CONCLUSION_MAX_CODEPOINTS`、`NOTE_BODY_MAX_BYTES`、`UNDERSTANDING_BODY_MAX_BYTES`、`NOTE_FACTS_MAX`、`NOTE_BASIS_FILES_MAX`、`NOTE_BASIS_FILE_MAX_BYTES`、`NOTE_SYMBOL_HITS_MAX`、`NOTE_EXTRA_ANCHORS_MAX`、`NOTE_ANCHOR_QUOTA`、`NOTE_GOAL_QUOTA`、`NOTE_EXISTING_TOPICS_MAX`、`NOTE_ANCHOR_CANDIDATES_MAX`、`NOTE_ANCHOR_CANDIDATE_SCAN` | 注记写入/锚点准入的注入初值 |
| 注记与记忆读取上限 | `src/core/work-graph/model/note-contracts.ts:32` | `MEMORY_PAGE_MAX`、`NOTE_READ_FILES_MAX`、`NOTE_READ_FACTS_MAX`、`NOTE_SYMBOL_RECHECK_MAX`、`MEMORY_PAGE_DEFAULT`、`MEMORY_RESULT_MAX_BYTES`、`NOTE_BODY_PAGE_BYTES`、`MEMORY_TOPICS_MAX` | 注记/记忆读取分页与字节上限 |
| 检索与项目理解上限 | `src/core/work-graph/model/note-contracts.ts:46` | `TEXT_SEARCH_MAX_TERMS`、`TEXT_SEARCH_CANDIDATE_MAX`、`NOTE_RANK_WEIGHT_TOPIC`、`NOTE_RANK_WEIGHT_CONCLUSION`、`NOTE_RANK_WEIGHT_BODY`、`NOTE_SIMILAR_MAX`、`NOTE_SIMILAR_MIN`、`PROJECT_UNDERSTANDING_BODY_MAX_BYTES`、`FIND_RELATED_FILES_MAX`、`PROJECT_NORMS_CHECK_MAX`、`PROJECT_NORMS_MAX` | 全文检索、排序与项目理解读取；`TEXT_SEARCH_MAX_TERMS` 就是全文检索的词数上限 |
| 秘书选择与历史预算 | `src/core/work-graph/model/request-contracts.ts:24` | `SECRETARY_HANDOFF_INPUT_TOKENS`、`SECRETARY_IDLE_ARCHIVE_MS`、`SECRETARY_PICK_RETRIES`、`SECRETARY_TAIL_RETRIES`、`IDEA_DETAIL_MAX_CODEPOINTS`、`SECRETARY_HISTORY_ROUNDS`、`SECRETARY_HISTORY_ANSWER_BYTES` | 秘书候选、交接与历史窗口 |
| request 队列预算 | `src/core/work-graph/model/request-contracts.ts:36` | `REQUEST_PASS_PAGES`、`REQUEST_PAGE_SIZE`、`REQUEST_ADVANCES_PER_PASS`、`REQUEST_DRAINED_PER_PASS`、`REQUEST_BACKOFF_INITIAL_MS`、`REQUEST_BACKOFF_MAX_MS` | request 队列分页、并发与退避 |
| request 的两个认领槽键 | `src/core/work-graph/model/request-contracts.ts:68` | `requestTailKey`、`secretaryIntakeKey`（前缀 `REQUEST_TAIL_PREFIX`、`SECRETARY_INTAKE_PREFIX`） | 正本：request-tail 与 secretary-intake 的键只从这里构造；queries 和 tasks 都用它，不另拼字符串 |
| 思路标题上限 | `src/core/work-graph/model/request-contracts.ts:33` | `IDEA_TITLE_MAX_CODEPOINTS`（120 个码点，一行） | 校验或存储一个回答的 ideas 时，和 `IDEA_DETAIL_MAX_CODEPOINTS` 一起用 |
| 思路的唯一规则 | `src/core/work-graph/model/request-ideas.ts:12`、`src/core/work-graph/model/request-ideas.ts:17` | `validIdeaCount`（0、2 或 3 个）；`ideasIssues`（数组、条数、每条 title/detail 是字符串、标题一行非空且 ≤120 码点、说明 ≤600 码点，返回问题列表） | 正本：秘书回答检查（`queries/secretary-answer.ts`）、回答 codec 的存储复检（`queries/query-record-codecs.ts`）和选思路入口（`tasks/request-service.ts`）都调它，不另写思路规则 |
| 秘书准备的读取端口 | `src/core/work-graph/model/secretary-contracts.ts:49` | `SecretaryPreparationFactsPort`：按 QueryRun 读一次请求、工作区、架构、政策、目标列表和执行种类，带 guards 和 watermark | 秘书轮的准备只经这个端口取事实 |
| Query/Request 索引名 | `src/core/work-graph/model/request-contracts.ts:51` | `QUERY_BY_REQUEST_INDEX`、`QUERY_OPEN_BY_WORKSPACE_INDEX`、`REQUEST_ROOTS_BY_GOAL_INDEX`、`QUERY_RAN_BY_SESSION_GOAL_INDEX` | 注册或查询这些固定索引时；`unassigned` 读取用 `QUERY_OPEN_BY_WORKSPACE_INDEX` |
| Session facts 索引名 | `src/core/work-graph/model/session-facts-contracts.ts:27` | `SESSION_BY_PROVENANCE_LOOKUP`、`WORK_EXECUTION_BY_SESSION_LOOKUP`、`QUERY_RUN_BY_SESSION_LOOKUP`、`SESSION_ANOMALY_BY_TASK_LOOKUP`、`SESSION_ANOMALY_BY_GOAL_LOOKUP`、`SESSION_REPLY_BY_HANDLER_LOOKUP`、`SLICE1_LOOKUP_INDEXES` | 注册/读取 Session facts 索引时 |

## 内部用
- 无：本层导出的函数与常量都供上层调用；其余导出是类型契约，不做运行时实现。

## 不要做
- 不要另建平行 DTO/端口；上层读这里的同一份契约，重复校验器会让规则分叉（CS-11、M1-31）。
- 不要用裸 local ID 或内联 Session key 当记录 key/比较键（M1-32）。
- 不要复制身份/指纹 recipe，也不要把会变化的选择事实放进公共 identity（M1-25、MH-03）。
- 不要在这里 import 上层子模块、读 store、写记录或做状态迁移；状态只经 `state/`（`AGENTS.md` 第 9 条、M1-01）。
- 不要把失败或不可读读成 `not_found`、空事实或“已完成”（FP-05、M1-12、MH-06）。
- 不要声明没有真实操作支撑的端口方法；空壳会让消费者依赖不存在的行为。
- `GraphWrite` 另有旧副本：`src/core/work-graph/model/session-contracts.ts:12`、`src/core/work-graph/architecture/contracts.ts:16`，新代码一律用正本，旧副本由清理轮删除。
- 不要写不存在的索引 `s6-query-queued-by-session`、`s6-query-unassigned`：队列读取走 `QUERY_OPEN_BY_WORKSPACE_INDEX`；`unassigned` 是 `requestRounds.unassigned`（`RequestRoundPort.unassigned`）这个具名读取，不是索引名。
