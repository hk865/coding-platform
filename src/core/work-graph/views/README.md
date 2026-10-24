# src/core/work-graph/views：WorkGraph 的只读投影层（L7），把已保存的记录组装成界面读的视图

## 负责什么，不负责什么

- 只读：读已保存的记录、事件和索引，组装成列表/详情/日历/轨道/决定队列等视图；不写记录、不提交、不发事件、不改状态。
- 只投影已保存事实：不重新裁决业务规则（冲突、完成、资格、所有权由 `state/`、`tasks/` 等 owner 定），不 backfill，不重算运行中 Run 的活动。
- 不做权限授予：调用方的 scope 由 `ctx` 带来，本层只在读之前拒绝越界请求，不扩大也不缩小谁的权限。
- 允许依赖 `model`、`state`、`persistence`、`configuration`、`materials`、`architecture`、`sessions`、`queries`、`tasks`、`evidence`、`communication`、`notes`（见 `docs/refactor/module-target.json` 的 `views` 条目）。
- 不得 import `app/`、`business/`、`composition/`、`agent-runtime/`；下层也不得反向 import 本层。状态迁移只经过 `src/core/work-graph/state/`（根 `AGENTS.md` 第 9 条）。

## 文件

### 工作线与轨道

做工作线列表/详情、图节点、图上下文与轨道条读取的去这组。

- `work-line-reader.ts` — 工作线列表/归档/详情/分区页的唯一组装路径；线摘要也被悬停复用。
- `node-detail-reader.ts` — 图悬停（只用已读数据）与单节点分区详情。
- `graph-context-reader.ts` — 上下文事实、图 look/find、注意力图的唯一只读视图；look/find 的 `goalRef` 为 `null` 时读项目分支（架构 module、项目 Session、请求点名的 Goal 只读），需要 Goal 的节点/关系拒绝。
- `track-read-model.ts` — 轨道条读模型：Run、验收轮、Query 区间的有界分页。

### 活动与时间

做活动日历、活动稳定窗口与任务时间条的去这组。

- `activity-read-helpers.ts` — 活动读模型共用的计数读法（`Budget`、有序/等值/单键读）和 `RunActivity` 投影。
- `activity-read-model.ts` — 日历与单 Run 活动读模型；只读 `RunActivity`/`ActivityRecording` 和已存时间点。
- `activity-stable-window.ts` — 四个活动读共用的稳定窗口：前后 watermark 相等才算一次，最多四次。
- `task-state-timeline.ts` — 任务状态时间条：只折已存时间点，全部标记 `approximate`。

### 决定与冲突

做决定队列、冲突合成与图读取扩展的去这组。

- `decision-read-model.ts` — 决定队列的唯一聚合器，以及通用集合适配器和五个具体卡片来源适配器。
- `goal-conflicts.ts` — Goal 足迹与冲突组装（F43），并导出 views 共用的 scope/watermark/Goal 列表读法。
- `context-extensions.ts` — 图读取的可选 `extensions`：异常锚点提醒、决定队列提示、注记记忆材料行。

### 秘书准备

做请求轮的秘书准备事实读取的去这组。

- `secretary-preparation-facts.ts` — `SecretaryPreparationFactsPort` 的唯一实现：一次读齐执行轮的 Job/Run 材料、待吸收批、早先 Session 的历史、workspace、当前架构、两个治理指针与 workspace Goals；任何失败原样返回，不折成空事实。

### 注记与通知

做注记派生、请知悉来源/分组/排序/token 的去这组。

- `note-views.ts` — `NoteCheckPort`：注记的 freshness、changedFiles、冲突、配额等派生字段。
- `note-review-notices.ts` — `note_review` 请知悉来源：三类注记版本流。
- `automatic-rework-notices.ts` — `automatic_rework` 请知悉来源：自动返工与复核轮。
- `undelivered-reply-notices.ts` — `undelivered_reply` 请知悉来源：不可用 Session 的未送达回复。
- `notice-display-token.ts` — 请知悉展示页的 HMAC token；密钥由 composition 注入。
- `notice-grouping.ts` — 请知悉分组的唯一纯函数与 seenThrough 推进。
- `notice-position.ts` — `NoticePositionV1` 的唯一排序与分页合并点。

## 可以复用的能力

| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createWorkLineReader` | `src/core/work-graph/views/work-line-reader.ts:2894` | 工作线列表、归档分页、线详情、分区页、会话源的读端口 | 要工作线或线详情时；不要另写一套组装 |
| `assembleLineBriefs` | `src/core/work-graph/views/work-line-reader.ts:232` | 把线头批量投影成 `LineBriefV1`，与 `lines/list` 同一路径 | 其他读要线摘要、且必须与列表逐字节一致时 |
| `resolveContinuationLine` | `src/core/work-graph/views/work-line-reader.ts:1294` | 沿 continuation 后继找线头；分支返回全部头，环返回成员，最多 32 步 | 从线中任一 Session 找头时；不要另写遍历 |
| `createNodeDetailReader` | `src/core/work-graph/views/node-detail-reader.ts:1430` | 悬停与单节点分区详情的读端口 | 图悬停、节点面板 |
| `createGraphContextReader` | `src/core/work-graph/views/graph-context-reader.ts:475` | 上下文事实、图 look/find、注意力图的只读视图；无 Goal 的 look/find 走项目分支 | 上下文组装、图页、注意力扫描、秘书轮的项目视图 |
| `createContextExtensionsReader` | `src/core/work-graph/views/context-extensions.ts:262` | 图读取的可选 extensions：异常锚点、决定队列提示、记忆材料；无 Goal 的请求只投影项目理解和 norms，其余 Goal 专属行跳过；读失败原样返回 | 组装上下文、需要这些扩展行时 |
| `createDecisionReadModel` | `src/core/work-graph/views/decision-read-model.ts:173` | 决定队列的唯一聚合器：卡片、请知悉、冲突合成一页 | 读决定队列或标记请知悉已看时 |
| `createCollectionCardSource` | `src/core/work-graph/views/decision-read-model.ts:263` | 集合型卡片来源的通用适配器：一次/页装配、偏移分页、关闭卡片 | 新增卡片来源时只注册读写和投影，不复制分页 |
| `createGoalCauseCardSource` | `src/core/work-graph/views/decision-read-model.ts:194` | 把 Goal 决策依据读法包成 `goal_cause` 卡片来源 | 装配决定队列、注册来源 |
| `createPlanningQuestionCardSource` | `src/core/work-graph/views/decision-read-model.ts:212` | 把规划问题读法包成 `planning_question` 卡片来源 | 装配决定队列、注册来源 |
| `createNoteReviewCardSource` | `src/core/work-graph/views/decision-read-model.ts:330` | 注记复核卡片来源，含按 key 直读 | 装配决定队列、注册来源 |
| `createUnknownCallReviewCardSource` | `src/core/work-graph/views/decision-read-model.ts:418` | 未知调用复核卡片来源，含按 key 直读与历史关闭 | 装配决定队列、注册来源 |
| `createCommandRerunRequestCardSource` | `src/core/work-graph/views/decision-read-model.ts:543` | 命令重跑请求卡片来源，含修订与 Task 结束检查 | 装配决定队列、注册来源 |
| `createAutomaticReworkNoticeSource` | `src/core/work-graph/views/automatic-rework-notices.ts:70` | `automatic_rework` 请知悉来源：返工与复核轮只留系统/Agent 返工 | 装配请知悉来源时 |
| `createNoteReviewNoticeSource` | `src/core/work-graph/views/note-review-notices.ts:48` | `note_review` 请知悉来源：三类版本流，按已看位置增量读 | 装配请知悉来源时 |
| `createUndeliveredReplyNoticeSource` | `src/core/work-graph/views/undelivered-reply-notices.ts:62` | `undelivered_reply` 请知悉来源：不可用 Session 的未送达回复 | 装配请知悉来源时 |
| `readOrderedToEnd` | `src/core/work-graph/views/automatic-rework-notices.ts:93` | 从保存的提交位置把有序索引读到尾（可选下界，分页） | 请知悉来源要按提交位置做增量读时 |
| `createNoticePositionComparator` | `src/core/work-graph/views/notice-position.ts:37` | 把唯一顺序注入决定读模型 | 组装决定读模型时 |
| `compareNoticePositions` | `src/core/work-graph/views/notice-position.ts:42` | 按 ledger 游标再按 `itemKey` 比较两个位置 | 任何需要通知顺序时；唯一允许解析 ledger 游标的位置 |
| `mergeNoticePages` | `src/core/work-graph/views/notice-position.ts:56` | 把各来源已过滤的页稳定合并，截到 limit，返回每类已显示位置 | 决定队列合并请知悉来源时 |
| `groupNotices` | `src/core/work-graph/views/notice-grouping.ts:32` | 按 `pass_through`/`user_affected_per_goal` 折叠显示行 | 显示前分组；输入必须已按位置排序 |
| `seenThroughOfNotices` | `src/core/work-graph/views/notice-grouping.ts:90` | 只按实际显示的成员计算每类 seenThrough 推进 | `markNoticesSeen` 计算推进位置时 |
| `createNoticeDisplayToken` | `src/core/work-graph/views/notice-display-token.ts:30` | 签发和校验展示页 token（HMAC，绑定 workspace/类别/调用者/水位） | composition 注入一次性密钥后装配 |
| `createGoalConflictAssembler` | `src/core/work-graph/views/goal-conflicts.ts:198` | Goal 冲突读端口，供决定读模型与上层使用 | 需要冲突卡片/冲突事实时 |
| `readGoalFootprint` | `src/core/work-graph/views/goal-conflicts.ts:348` | 一个 Goal 的足迹：计划模块 + 已执行文件映射 | 冲突判断、执行影响展示 |
| `mapExecutedFilesToModules` | `src/core/work-graph/views/goal-conflicts.ts:438` | 已执行路径按架构目录做最长合法段匹配；无唯一主人保持 `unmapped` | 需要把文件映射到 `ModuleRef` 时；不要按名字猜 |
| `createSecretaryPreparationFacts` **正本** | `src/core/work-graph/views/secretary-preparation-facts.ts:434` | 秘书请求轮准备事实的唯一读取：请求轮材料与批、早先 Session 历史（答案/无答案/未结束）、workspace、当前架构、完成策略指针、Goals 与合并后的 guards/watermark | Runtime 准备请求轮；不要另读请求轮历史或治理指针 |
| `workspaceScopeProblem` | `src/core/work-graph/views/goal-conflicts.ts:94` | 在任何记录读之前比较显式 workspace 与 `ctx` 范围 | 每个显式 workspace 输入的读 |
| `listWorkspaceGoals` | `src/core/work-graph/views/goal-conflicts.ts:121` | 读完一个 workspace 的 Goal 集合，带 watermark 与 truncated | 需要 Goal 全集的读 |
| `readGoalTerminalState` | `src/core/work-graph/views/goal-conflicts.ts:165` | 判断 Goal 是否 cancelled 或由 GoalPhase 证明 completed；读失败不当“未终止” | 冲突卡片是否需要关闭时 |
| `CONFLICT_OPTIONS` | `src/core/work-graph/views/goal-conflicts.ts:70`、`src/core/work-graph/communication/decision-source-facts.ts:166` | 固定的 wait/order/parallel 三个冲突选项 | 冲突卡片；同一能力两份，正本待 lead 定 |
| `readWatermark` | `src/core/work-graph/views/activity-read-helpers.ts:125`、`src/contracts/core/results.ts:25` | 读存储读水位：活动读返回 `ReadResult`，决定读返回 ready/rejection | 一次读的前后水位；同一能力两份，正本待 lead 定 |
| `createActivityReadModel` | `src/core/work-graph/views/activity-read-model.ts:759` | 日历与单 Run 活动视图 | 活动页、Run 活动列 |
| `createTrackReadModel` | `src/core/work-graph/views/track-read-model.ts:1164` | 轨道条：Run/验收轮/Query 的重叠窗口分页 | 轨道页；composition 把 `readTrackBars` 与 `ActivityReadPort` 装到一起 |
| `createTaskStateTimeline` | `src/core/work-graph/views/task-state-timeline.ts:538` | 任务状态时间条，按已存时间点折段 | 任务时间视图 |
| `readStableActivityWindow` | `src/core/work-graph/views/activity-stable-window.ts:29` | 跑一次活动读 attempt：新预算、前后水位相等、最多四次 | 写新的活动读循环时；不要再复制重试 |
| `Budget` | `src/core/work-graph/views/activity-read-helpers.ts:37` | 一次活动读的存储读次数预算 | 活动读的每次 attempt |
| `readOrderedAll` | `src/core/work-graph/views/activity-read-helpers.ts:79` | 把有序索引读到尾并计预算 | 需要完整有序事实时 |
| `readEqualityAll` | `src/core/work-graph/views/activity-read-helpers.ts:89` | 把等值索引候选集读完并计预算 | 需要完整等值事实集时 |
| `readOneKeyed` | `src/core/work-graph/views/activity-read-helpers.ts:112` | 按 key 读一条记录并计预算（miss 也计） | 活动读里按键取记录时 |
| `activityViewOf` | `src/core/work-graph/views/activity-read-helpers.ts:141` | 把 `RunActivity` 快照投影成 `RunActivityViewV1` | 活动/轨道读投影时 |
| `createNoteCheck` | `src/core/work-graph/views/note-views.ts:214` | 注记派生字段的唯一检查端口（freshness、changedFiles、冲突、配额等） | 注记读模型要派生字段时；不要另写检查 |
| `latestActivityAt`（**正本**） | `src/core/work-graph/tasks/line-clock.ts:45` | 线卡时钟的纯规则：Session 创建时刻与调用方给的时刻取最大 ISO 串，空集回退 `createdAt` | 线卡/选择读时钟；不要另写一份 |
| `readClaimedAtForRun`（**正本**） | `src/core/work-graph/tasks/line-clock.ts:198` | Run 无起止时间时，从按代排序的 Work claim 索引顶行读 claim 时间，只认本 Run | claimedAt 回退；本层与 `secretary-selection.ts` 都调这一份 |
| `indexActiveCopies` | `src/core/work-graph/tasks/line-clock.ts:59` | 从 Session 列表按来源索引 active 的只读副本 | 线卡/选择要数副本时 |
| `readActiveCopies` | `src/core/work-graph/tasks/line-clock.ts:74` | 分页读完一个 workspace 的 active 只读副本 | 需要完整副本集时 |
| `readLatestQueryRun` | `src/core/work-graph/tasks/line-clock.ts:97` | 读一条 Session 最近一次 QueryRun | 线卡时钟、选择判断 |
| `readQueryRunByRef` | `src/core/work-graph/tasks/line-clock.ts:125` | 按精确 ref 读 QueryRun，拒绝跨 workspace | 已持有 QueryRun ref 时 |
| `copyPhase` | `src/core/work-graph/tasks/line-clock.ts:180` | 只读副本的 phase 与 Query 开始时刻 | 线详情要展示副本状态时 |

`goal-conflicts.ts:45`、`src/core/work-graph/persistence/read-result-failures.ts:22`、`src/core/work-graph/persistence/read-result-failures.ts:42` 只是转出 `persistence` 的 `atLeastCursorResult`、`storeFailureToRejection`、`lookupAll` 和 `tasks/goal-basis.ts` 的 `goalDecisionBasis`；新代码从原位置 import。

## 内部用

`CapacityError`、`scanOrdered`、`isQuarterInstant`、`emptyView`、`claimingSessionOf`、`gateInfoOf`、`goalParallelRiskText`、`normalizedGoalSettings`、`toBrief`、`LINE_HISTORY_READ_BUDGET`、`NOTE_SIMILAR_SCAN`、`ACTIVITY_WINDOW_MAX_ATTEMPTS` 及本文件夹的 `*V1`/`*Deps`/`*Port` 类型只在本层或契约内使用。

## 不要做

- 不写记录、不提交、不发事件、不调用状态迁移；状态只经 `state/`（`AGENTS.md` 第 9 条）。
- 不 import `app/`、`business/`、`composition/`、`agent-runtime/`，也不让下层 import 本层。
- 不把失败的读当成空事实、0 或 `not_found`；`unavailable`/`not_ready`/`incomplete` 原样返回（FP-05、M1-12、MH-06）。
- 不在本层再复制时钟或 claimedAt：`latestActivityAt`、`readClaimedAtForRun` 的正本在 `src/core/work-graph/tasks/line-clock.ts:45`、`src/core/work-graph/tasks/line-clock.ts:198`；本层 `src/core/work-graph/tasks/line-clock.ts:45` 与 `src/core/work-graph/tasks/line-clock.ts:45` 只调用正本，旧副本已删，不要再写第二份（FP-06、FP-18）。
- 不另写通知排序、分页合并、线摘要组装或卡片分页；上述唯一实现只留一处（M1-13）。
- 不猜：不按名字猜 module，不把未知文件或缺失足迹说成“无冲突”，不把 `possiblyIncomplete` 改成 exact。
