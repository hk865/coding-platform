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
- `track-read-model.ts` — 轨道条读模型：Run、验收轮、Query 区间的有界分页。Query 条带带各自的 `QueryActivity` 视图。每个选中 Session 自己的 Query 先按它的 provenance 定画法（`queryOwnScanOf`）：普通 Session 画自己的 turn（按轨道 Goal 过滤）；只读副本画成从来源被问的 consultation，不按 Goal 过滤；来源也被选中时由来源的副本流画，副本自己不画——与 `sessionRefs` 顺序无关。`dedupeQueryBarsByRunRef` 只是按完整 `QueryRunRef` 的身份防重；`queryBarAskedOf` 优先取记录的正式被问 Session、否则取副本来源。

### 活动与时间

做活动日历、活动稳定窗口与任务时间条的去这组。

- `activity-read-helpers.ts` — 活动读模型共用的计数读法（`Budget`、有序/等值/单键读）、`RunActivity`/`QueryActivity` 投影，以及 Work 与 Query 共用的缺失记录分类 `classifyMissingActivity`：各自的事实由 `runMissingActivityFacts`/`queryMissingActivityFacts` 给出，分类结果由 `runMissingActivityViewOf`/`queryMissingActivityViewOf` 原样映射成视图；没有记录的 Query 落在哪个 Goal 由 `missingQueryActivityGoalOf` 定，在哪个 Session 上由 `queryExecutingSession`（claim 记下的 Session）定。
- `activity-read-model.ts` — 日历（Goal 或整个 workspace 范围，Work 与 Query 的活动落在同一格；workspace 范围也数每个 Goal 的验收检查；还没结束的 Query 从开着的 Job 索引读到，算进行中）与单 Run、单 Query 活动读模型；只读 `RunActivity`/`QueryActivity`/`ActivityRecording` 和已存时间点。导出 `calendarTaskKey`（任务条目按 `(goalId, taskId)` 合并的键）与 `calendarCellComplete`（一格是否完整），日历与纯测试共用同一判断。
- `activity-stable-window.ts` — 五个活动读共用的稳定窗口：前后 watermark 相等才算一次，最多四次。
- `task-state-timeline.ts` — 任务状态时间条：只折已存时间点，全部标记 `approximate`。

### 决定与冲突

做决定队列、冲突合成与图读取扩展的去这组。

- `decision-read-model.ts` — 决定队列的唯一聚合器，以及通用集合适配器和五个具体卡片来源适配器；卡片与请知悉项的 `subject` 由本层构造，统一是 `DecisionSubjectV1`（Goal，或带 `projectRef.projectId` 的 project；没有并列的 `goalRef`），排序、过滤与分页点都用带标记的 `decisionSubjectKey`；项目 subject 的 `note_review` 卡不带 Goal 依据。同一套装配另有整页读 `readWholePage`（不分页、请知悉按主对话折叠、项目行加所选 Goal 的行，token 由主对话签发；`notices.goalRef` 为 `null` 时只读项目行），给主对话和 `requests/read` 用。
- `goal-conflicts.ts` — Goal 足迹与冲突组装（F43），并导出 views 共用的 scope/watermark/Goal 列表读法。
- `context-extensions.ts` — 图读取的可选 `extensions`：异常锚点提醒、决定队列提示、注记记忆材料行。

### 主对话

做主对话页（`main/read`）和单个请求读（`requests/read`）的去这组。

- `main-surface-read-model.ts` — 主对话页：一个 Goal（或无 Goal）的请求根按创建倒序、每页 20 条，第一个 Goal 的页尾接上它之前的无 Goal 请求；无 Goal 页以第一个 Goal 的创建为排他下界（交给存储的 `lowerBound`），所以第一个 Goal 建立前拿到的游标续不到它之前的请求；每页的卡片和请知悉只跑一次决定读模型的整页读，项目自己的卡片与请知悉行是每页的公共部分（无 Goal 页也有），和所选 Goal 自己的卡片、行同属页面自己的部分：卡片保持决定队列的顺序（先按状态段：待回答、待应用、历史；段内按 `decisionSubjectKey`，所以同一段里 Goal 的卡排在项目卡之前），请知悉行保持位置顺序。

### 秘书准备

做请求轮的秘书准备事实读取的去这组。

- `secretary-handoff-facts.ts` — 交接的只读事实：`checkArchiveCondition` 按核心谓词（源仍拥有且处理中的请求为零）+ 源/`SessionActivity` guard + 操作持有者的 fence（手工归档为 `null`）+ 首读 horizon 给出可合并片段；`readCoverage` 读源仍拥有且处理中的请求根、它们的有效 Goal、每个 Goal 的当前理解指针/版本/最后文字写入者、最后进入并结束的轮、活动 revision 和一次完整读的首个 horizon；`readRoutingSet` 在同一完整读上返回源仍拥有且处理中的根，`closed` 表示这次读到末尾；`readBriefState` 按五个 phase 找后继是本 Session 的交接操作（含 `existing` 目标与已完成操作），给出 `none`/`waiting`/`ready`/`consumed` 四态，`ready` 只在受保护的最终归档成功且完整路由集保存之后，材料从操作自己的事实和请求/注记读来时读，不存两份（当前理解的正文由同一次 pointer→head→version 读解码一次，written 与 current 同一版本时不再重读）；`readBriefGoalRefs` 是给推进用的窄读口：每个被覆盖的 Goal 给出 written/current 两个引用，推进只存引用，Session 层不读 Note。失败或损坏一律 `unavailable`，不折成空覆盖/空集合，也不把 `waiting` 读成 `none`。
- `secretary-preparation-facts.ts` — `SecretaryPreparationFactsPort` 的唯一实现：一次读齐执行轮的 Job/Run 材料（材料里的 `command` 从存的 `round.job.understanding` 投影，批轮与早先轮走同一投影）、待吸收批、早先 Session 的历史、workspace、当前架构、两个治理指针与 workspace Goals，以及 `ask` 轮卡片引用对象的当前版本（一次 `readMany`，不存在记 null）；还读齐冻结材料里每个理解命令的 operation 记录（缺失/失败/损坏为 `unavailable`，每条进 guards），产出唯一的 `understandingGrants`，并按五个 phase 找后继 Session 的交接 operation 作为 `briefRef`（多个取 revision 最大者，同样进 guards；这条 operation 的简报已被消费时 `briefRef` 为 null、不进 guards，OP-F1）；任何失败原样返回，不折成空事实。

### 注记与通知

做注记派生、请知悉来源/分组/排序/token 的去这组。

- `note-views.ts` — `NoteCheckPort`：注记的 freshness、changedFiles、冲突、配额等派生字段。
- `note-review-notices.ts` — `note_review` 请知悉来源：三类注记版本流；`goalId: null` 的版本是项目 subject 的行，按绑定的项目作用域读，Goal 过滤页不收。
- `automatic-rework-notices.ts` — `automatic_rework` 请知悉来源：自动返工与复核轮。
- `handoff-notices.ts` — `handoff` 请知悉来源：每个走到通知写的交接操作一项；位置由 `noticePositionOf` 从操作保存的 Host principal、workspace、通知键和 `advanceGeneration` 重建原写身份并读回执与事件，缺回执或校验不符为 `unavailable`，绝不给无位置条目。
- `undelivered-reply-notices.ts` — `undelivered_reply` 请知悉来源：不可用 Session 的未送达回复。
- `notice-display-token.ts` — 请知悉展示页的 HMAC token；密钥由 composition 注入。
- `notice-grouping.ts` — 请知悉分组的唯一纯函数与 seenThrough 推进；折行与筛选都按带标记的 `decisionSubjectKey`（一个 Goal 或一个项目各折各的），主对话把每个 subject 的自动返工折成一行，`noticePage` 放指定 subject 的行；推进仍按全部显示行的连续前缀算，别的 subject 的行挡住就不越过。
- `notice-position.ts` — `NoticePositionV1` 的唯一排序与分页合并点。

## 可以复用的能力

| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createWorkLineReader` | `src/core/work-graph/views/work-line-reader.ts:3035` | 工作线列表、归档分页、线详情、分区页、会话源的读端口 | 要工作线或线详情时；不要另写一套组装 |
| `assembleLineBriefs` | `src/core/work-graph/views/work-line-reader.ts:232` | 把线头批量投影成 `LineBriefV1`，与 `lines/list` 同一路径 | 其他读要线摘要、且必须与列表逐字节一致时 |
| `resolveContinuationLine` | `src/core/work-graph/views/work-line-reader.ts:1428` | 沿 continuation 后继找线头；分支返回全部头，环返回成员，最多 32 步 | 从线中任一 Session 找头时；不要另写遍历 |
| `secretaryOrdinals` | `src/core/work-graph/views/work-line-reader.ts:269` | 秘书线名“秘书 N”的 N：本工作区秘书 Session 按 `createdAt`、同刻按 Session 键排，从 1 数（纯函数；一次读只算一回，归档的也算，只读副本不算；有 Session 的职责读不到、或 RoleSpec 角色的职责为 unknown 时整张编号读不到，秘书线名只给“秘书”并带问题；旧模板角色为 unknown 的肯定不是秘书，跳过） |
| `secretaryNumbering` | `src/core/work-graph/views/work-line-reader.ts:290` | 由每个非副本 Session 的角色种类和职责得出编号：秘书才算；旧模板角色为 unknown 跳过；RoleSpec 角色为 unknown 时编号读不到（纯函数） | 编号读取的唯一判定；不要另写 unknown 的处理 | 线名；不要另排秘书顺序 |
| `readLatestQueryGoal` | `src/core/work-graph/views/work-line-reader.ts:1347` | 线头最近一次 Query 的目标，读法与线自己的一致 | 图悬停的 Goal owners 过滤；不要拿线名判断 |
| `createNodeDetailReader` | `src/core/work-graph/views/node-detail-reader.ts:1436` | 悬停与单节点分区详情的读端口 | 图悬停、节点面板 |
| `createGraphContextReader` | `src/core/work-graph/views/graph-context-reader.ts:475` | 上下文事实、图 look/find、注意力图的只读视图；无 Goal 的 look/find 走项目分支 | 上下文组装、图页、注意力扫描、秘书轮的项目视图 |
| `createContextExtensionsReader` | `src/core/work-graph/views/context-extensions.ts:256` | 图读取的可选 extensions：异常锚点、决定队列提示、记忆材料；无 Goal 的请求只投影项目理解和 norms，其余 Goal 专属行跳过；读失败原样返回 | 组装上下文、需要这些扩展行时 |
| `createDecisionReadModel` | `src/core/work-graph/views/decision-read-model.ts:203` | 决定队列的唯一聚合器：卡片、请知悉、冲突合成一页，卡片按 `decisionSubjectKey` 排序与过滤；`DecisionWholePageReader` 的 `readWholePage` 是同一装配的整页读（`notices.goalRef` 可为 `null`，项目行是公共部分） | 读决定队列或标记请知悉已看时；主对话要卡片和请知悉时用整页读，不要另写装配 |
| `cardInScope` | `src/core/work-graph/views/decision-read-model.ts:2139` | 一张卡是否属于某个 Goal（队列的 Goal 过滤用的同一条规则） | 按 Goal 挑卡时；`requests/read` 的卡片也用它 |
| `createCollectionCardSource` | `src/core/work-graph/views/decision-read-model.ts:302` | 集合型卡片来源的通用适配器：一次/页装配、偏移分页、关闭卡片；规格用 `serves` 声明服务的 subject，`readCollection` 和 `project` 都只收一个 `subject`，装配缓存按来源种类、工作区和 subject 分开；队列只在不按 Goal 过滤的读里枚举一次项目 | 新增卡片来源时只注册读写和投影，不复制分页 |
| `createGoalCauseCardSource` | `src/core/work-graph/views/decision-read-model.ts:227` | 把 Goal 决策依据读法包成 `goal_cause` 卡片来源 | 装配决定队列、注册来源 |
| `createPlanningQuestionCardSource` | `src/core/work-graph/views/decision-read-model.ts:248` | 把规划问题读法包成 `planning_question` 卡片来源 | 装配决定队列、注册来源 |
| `createNoteReviewCardSource` | `src/core/work-graph/views/decision-read-model.ts:384` | 注记复核卡片来源（`serves: ['goal', 'project']`），含按 key 直读；项目 subject 的卡是无 Goal 依据的注记卡；直读先按注记自己的 subject 比对（开着、关了都先比），所以别的 subject 的注记不是这张卡 | 装配决定队列、注册来源 |
| `createUnknownCallReviewCardSource` | `src/core/work-graph/views/decision-read-model.ts:480` | 未知调用复核卡片来源，含按 key 直读与历史关闭 | 装配决定队列、注册来源 |
| `createCommandRerunRequestCardSource` | `src/core/work-graph/views/decision-read-model.ts:611` | 命令重跑请求卡片来源，含修订与 Task 结束检查 | 装配决定队列、注册来源 |
| `createMainSurfaceReadModel` | `src/core/work-graph/views/main-surface-read-model.ts:197` | `main/read` 与 `requests/read` 的读端口：请求根按 Goal 槽有序读、请求视图、一次整页读 | composition 装配主对话读时 |
| `parseMainReadInput` | `src/core/work-graph/views/main-surface-read-model.ts:215` | `main/read` 的输入：`goalId` 为 Goal id 或 null，`cursor` 为 null 或一页返回的游标形状 | 校验主对话读的输入时 |
| `mainReadPhases`、`mainReadStart`、`mainPageStep` | `src/core/work-graph/views/main-surface-read-model.ts:103`、`src/core/work-graph/views/main-surface-read-model.ts:116`、`src/core/work-graph/views/main-surface-read-model.ts:123` | 主对话页的段（本 Goal 段，第一个 Goal 再接它之前的无 Goal 段）、游标从哪段续读、一页截到多少和下一页游标 | 改主对话分页时；不要另算段或游标 |
| `requestCards`、`pageCards` | `src/core/work-graph/views/main-surface-read-model.ts:156`、`src/core/work-graph/views/main-surface-read-model.ts:174` | 一个请求的卡片（点名它的轮的卡，加它所在 Goal 自己的卡，即不点名任何请求的卡；同 Goal 别的请求的候选不算）；一页先列页面自己的卡（项目的和所选 Goal 的，保持决定队列顺序），再列各请求的，各列一次，请求按 key 引用 | 主对话页和 `requests/read` 挑卡时 |
| `createAutomaticReworkNoticeSource` | `src/core/work-graph/views/automatic-rework-notices.ts:70` | `automatic_rework` 请知悉来源：返工与复核轮只留系统/Agent 返工 | 装配请知悉来源时 |
| `createNoteReviewNoticeSource` | `src/core/work-graph/views/note-review-notices.ts:51` | `note_review` 请知悉来源：三类版本流，按已看位置增量读；`goalId: null` 的版本是项目 subject 的行，Goal 过滤页不收 | 装配请知悉来源时 |
| `createUndeliveredReplyNoticeSource` | `src/core/work-graph/views/undelivered-reply-notices.ts:62` | `undelivered_reply` 请知悉来源：不可用 Session 的未送达回复 | 装配请知悉来源时 |
| `readOrderedToEnd` | `src/core/work-graph/views/automatic-rework-notices.ts:93` | 从保存的提交位置把有序索引读到尾（可选下界，分页） | 请知悉来源要按提交位置做增量读时 |
| `createNoticePositionComparator` | `src/core/work-graph/views/notice-position.ts:37` | 把唯一顺序注入决定读模型 | 组装决定读模型时 |
| `compareNoticePositions` | `src/core/work-graph/views/notice-position.ts:42` | 按 ledger 游标再按 `itemKey` 比较两个位置 | 任何需要通知顺序时；唯一允许解析 ledger 游标的位置 |
| `mergeNoticePages` | `src/core/work-graph/views/notice-position.ts:56` | 把各来源已过滤的页稳定合并，截到 limit，返回每类已显示位置 | 决定队列合并请知悉来源时 |
| `groupNotices` | `src/core/work-graph/views/notice-grouping.ts:63` | 按 `pass_through`/`user_affected_per_goal`/`main_conversation` 折叠显示行；按 `decisionSubjectKey` 把每个 subject 的书记整理折成一行，主对话另把每个 subject 的自动返工折成一行，成员原行放在 `memberViews` | 显示前分组；输入必须已按位置排序 |
| `seenThroughOfNotices` | `src/core/work-graph/views/notice-grouping.ts:128` | 只按实际显示的成员计算每类 seenThrough 推进 | `markNoticesSeen` 计算推进位置时 |
| `noticePage` | `src/core/work-graph/views/notice-grouping.ts:163` | 按给定的 subject 集合放行（项目行加所选 Goal 的行）；推进按全部行里的连续前缀算，别的 subject 的行挡住就不越过 | 主对话页和整页读组请知悉时 |
| `createNoticeDisplayToken` | `src/core/work-graph/views/notice-display-token.ts:30` | 签发和校验展示页 token（HMAC，绑定 workspace/类别/调用者/水位） | composition 注入一次性密钥后装配 |
| `createGoalConflictAssembler` | `src/core/work-graph/views/goal-conflicts.ts:198` | Goal 冲突读端口，供决定读模型与上层使用 | 需要冲突卡片/冲突事实时 |
| `readGoalFootprint` | `src/core/work-graph/views/goal-conflicts.ts:350` | 一个 Goal 的足迹：计划模块 + 已执行文件映射 | 冲突判断、执行影响展示 |
| `mapExecutedFilesToModules` | `src/core/work-graph/views/goal-conflicts.ts:440` | 已执行路径按架构目录做最长合法段匹配；无唯一主人保持 `unmapped` | 需要把文件映射到 `ModuleRef` 时；不要按名字猜 |
| `createSecretaryHandoffFacts` **正本** | `src/core/work-graph/views/secretary-handoff-facts.ts:264` | 覆盖、路由集、简报状态与简报引用的唯一读取：完整分页打开请求、每根走 owner 读、每个 Goal 读 CurrentPointer/NoteHead/NoteVersion（正文一次解码），返回一个首读 horizon；路由集 `closed:true` 只在本次读完整时给出；`readBriefState` 只在归档成功且路由集完整后给 `ready`，否则 `waiting`；`readBriefGoalRefs` 给推进返回每 Goal 的 saved 引用 | 推进的 coverage/fence/recheck/routing 扫描、brief 引用与后继轮的准备；不要另写覆盖、路由或简报读 |
| `createHandoffNoticeSource`、`noticePositionOf` | `src/core/work-graph/views/handoff-notices.ts:168`、`:53` | `handoff` 请知悉来源与单条位置读：每个操作一项，位置是原通知写的提交；身份只用操作保存的 actor/workspace/键/generation 重建 | I1 注入 `createDecisionReadModel` 的 `noticeSources`；只读，不写记录或事件 |
| `createSecretaryPreparationFacts` **正本** | `src/core/work-graph/views/secretary-preparation-facts.ts:507` | 秘书请求轮准备事实的唯一读取：请求轮材料（含执行轮与批轮各自的理解命令投影）与批、早先 Session 历史（答案/无答案/未结束）、workspace、当前架构、完成策略指针、Goals、唯一的 `briefRef`/`understandingGrants` 与合并后的 guards/watermark | Runtime 准备请求轮；不要另读请求轮历史、治理指针或重算授权集 |
| `workspaceScopeProblem` | `src/core/work-graph/views/goal-conflicts.ts:94` | 在任何记录读之前比较显式 workspace 与 `ctx` 范围 | 每个显式 workspace 输入的读 |
| `listWorkspaceGoals` | `src/core/work-graph/views/goal-conflicts.ts:121` | 读完一个 workspace 的 Goal 集合，带 watermark 与 truncated | 需要 Goal 全集的读 |
| `readGoalTerminalState` | `src/core/work-graph/views/goal-conflicts.ts:165` | 判断 Goal 是否 cancelled 或由 GoalPhase 证明 completed；读失败不当“未终止” | 冲突卡片是否需要关闭时 |
| `CONFLICT_OPTIONS` | `src/core/work-graph/views/goal-conflicts.ts:70`、`src/core/work-graph/communication/decision-source/goal-conflict.ts:15` | 固定的 wait/order/parallel 三个冲突选项 | 冲突卡片；同一能力两份，正本待 lead 定 |
| `readWatermark` | `src/core/work-graph/views/activity-read-helpers.ts:130`、`src/contracts/core/results.ts:33` | 读存储读水位：活动读返回 `ReadResult`，决定读返回 ready/rejection | 一次读的前后水位；同一能力两份，正本待 lead 定 |
| `createActivityReadModel` | `src/core/work-graph/views/activity-read-model.ts:1125` | 日历（Goal/workspace 范围，含 Query 步数与查询覆盖）、单 Run 与单 Query 活动视图 | 活动页、Run/Query 活动列 |
| `classifyMissingActivity` | `src/core/work-graph/views/activity-read-helpers.ts:171` | Work 与 Query 共用的缺失记录规则：never entered、进行中、未补记/未记录/无记录起点 | 任何按活动记录判空/判未知的读；不要另写一份 |
| `queryActivityViewOf` | `src/core/work-graph/views/activity-read-helpers.ts:328` | 把 `QueryActivity` 快照投影成 `QueryActivityViewV1`（含补记 late 规则） | Query 活动读投影时 |
| `createTrackReadModel` | `src/core/work-graph/views/track-read-model.ts:1277` | 轨道条：Run/验收轮/Query 的重叠窗口分页 | 轨道页；composition 把 `readTrackBars` 与 `TrackReadPort` 装到一起 |
| `createTaskStateTimeline` | `src/core/work-graph/views/task-state-timeline.ts:534` | 任务状态时间条，按已存时间点折段 | 任务时间视图 |
| `readStableActivityWindow` | `src/core/work-graph/views/activity-stable-window.ts:29` | 跑一次活动读 attempt：新预算、前后水位相等、最多四次 | 写新的活动读循环时；不要再复制重试 |
| `Budget` | `src/core/work-graph/views/activity-read-helpers.ts:42` | 一次活动读的存储读次数预算 | 活动读的每次 attempt |
| `readOrderedAll` | `src/core/work-graph/views/activity-read-helpers.ts:84` | 把有序索引读到尾并计预算 | 需要完整有序事实时 |
| `readEqualityAll` | `src/core/work-graph/views/activity-read-helpers.ts:94` | 把等值索引候选集读完并计预算 | 需要完整等值事实集时 |
| `readOneKeyed` | `src/core/work-graph/views/activity-read-helpers.ts:117` | 按 key 读一条记录并计预算（miss 也计） | 活动读里按键取记录时 |
| `activityViewOf` | `src/core/work-graph/views/activity-read-helpers.ts:322` | 把 `RunActivity` 快照投影成 `RunActivityViewV1` | 活动/轨道读投影时 |
| `createNoteCheck` | `src/core/work-graph/views/note-views.ts:214` | 注记派生字段的唯一检查端口（freshness、changedFiles、冲突、配额等） | 注记读模型要派生字段时；不要另写检查 |
| `latestActivityAt`（**正本**） | `src/core/work-graph/state/session-activity.ts:25` | 线卡时钟的纯规则：Session 创建时刻与调用方给的时刻取最大 ISO 串，空集回退 `createdAt` | 线卡/选择读时钟；不要另写一份 |
| `readClaimedAtForRun`（**正本**） | `src/core/work-graph/tasks/line-clock.ts:190` | Run 无起止时间时，从按代排序的 Work claim 索引顶行读 claim 时间，只认本 Run | claimedAt 回退；本层与 `secretary-selection.ts` 都调这一份 |
| `indexActiveCopies` | `src/core/work-graph/tasks/line-clock.ts:51` | 从 Session 列表按来源索引 active 的只读副本 | 线卡/选择要数副本时 |
| `readActiveCopies` | `src/core/work-graph/tasks/line-clock.ts:66` | 分页读完一个 workspace 的 active 只读副本 | 需要完整副本集时 |
| `readLatestQueryRun` | `src/core/work-graph/tasks/line-clock.ts:89` | 读一条 Session 最近一次 QueryRun | 线卡时钟、选择判断 |
| `readQueryRunByRef` | `src/core/work-graph/tasks/line-clock.ts:117` | 按精确 ref 读 QueryRun，拒绝跨 workspace | 已持有 QueryRun ref 时 |
| `copyPhase` | `src/core/work-graph/tasks/line-clock.ts:172` | 只读副本的 phase 与 Query 开始时刻 | 线详情要展示副本状态时 |

`goal-conflicts.ts:45`、`src/core/work-graph/persistence/read-result-failures.ts:22`、`src/core/work-graph/persistence/read-result-failures.ts:40` 只是转出 `persistence` 的 `atLeastCursorResult`、`storeFailureToRejection`、`lookupAll` 和 `tasks/goal-basis.ts` 的 `goalDecisionBasis`；新代码从原位置 import。

## 内部用

`CapacityError`、`scanOrdered`、`isQuarterInstant`、`claimingSessionOf`、`gateInfoOf`、`goalParallelRiskText`、`normalizedGoalSettings`、`toBrief`、`LINE_HISTORY_READ_BUDGET`、`NOTE_SIMILAR_SCAN`、`ACTIVITY_WINDOW_MAX_ATTEMPTS` 及本文件夹的 `*V1`/`*Deps`/`*Port` 类型只在本层或契约内使用。

## 不要做

- 不写记录、不提交、不发事件、不调用状态迁移；状态只经 `state/`（`AGENTS.md` 第 9 条）。
- 不 import `app/`、`business/`、`composition/`、`agent-runtime/`，也不让下层 import 本层。
- 不把失败的读当成空事实、0 或 `not_found`；`unavailable`/`not_ready`/`incomplete` 原样返回（FP-05、M1-12、MH-06）。
- 不在本层再复制时钟或 claimedAt：`latestActivityAt`、`readClaimedAtForRun` 的正本在 `src/core/work-graph/state/session-activity.ts:25`、`src/core/work-graph/tasks/line-clock.ts:190`；本层 `src/core/work-graph/views/work-line-reader.ts:1205`、`src/core/work-graph/views/work-line-reader.ts:1221` 只调用正本，不要再写第二份（FP-06、FP-18）。
- 不另写通知排序、分页合并、线摘要组装或卡片分页；上述唯一实现只留一处（M1-13）。
- 不猜：不按名字猜 module，不把未知文件或缺失足迹说成“无冲突”，不把 `possiblyIncomplete` 改成 exact。
