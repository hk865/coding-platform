# src/ui/adapters/：画板数据适配层

这一层只做纯转换：把 Host 路由的返回值变成画板通过 props 读取的形状。不碰 DOM、不碰网络、不引用 `src/app`。

## 文件

| 文件 | 负责什么 |
| --- | --- |
| `goals.ts` | Goals 页（E3 Goals §2.1–§2.6）：`adaptGoals` 把 `goals/list`、逐行的 `goals/display`、`lines/list`、`goals/conflicts`、两个冲突目标的 `tasks/query` 和 `architecture/read` 转成 `GoalsData`。目标行按 `order` 升序，`ordinal` 为 null 不补数字，状态词只来自展示相位；冲突卡的 earlier/later 只用 `goals/list.order` 排，重叠文件只取 `cards[].objects`，`openedAt` 为 null 不补；`maps.arch` 只从目录模块和 `paths` 建树，`maps.task` 只画两个冲突目标；`sourceCursor` 原样带回。 |
| `arch-overview.ts` | 架构页（E3-ARCH）：`adaptArchOverview` 把十条读（`architecture/read`、`observation-state`、`query`、`architecture/change-scope`、`files/list`、`find`、`work-scope`、`tasks/query`、`lines/list`、`notes/list`）折成 `ArchOverviewData`：`ArchRepoModel` 是模块/接口分组/文件/目录/边的树（文件叶子和目录来自 `files/list`，文件→模块用 `pathOwnershipOf`，平手放两个 owner；任务只按 `plannedFiles` 着色），`ArchRepoEdge` 带 `count`（原样取 `architecture/query` 的 `edges[].count`，不重算），`module:<id>` 和 `interface:` + `canonicalJson([moduleId, interfaceId])` 两种端点都映射到页面节点（组 id 用同一串），没有文件的接口组删掉、端找不到的边丢掉；`touched`/`possible` 来自 `architecture/change-scope`（模块=自己的 + containment 后代模块的，接口组/目录=所含文件的，band/SYS=子节点求和，不重复相加），`changes` 另带 `known`/`complete`；没有被任何模块认领的文件按顶层目录建成 `kind:'band'` 的支撑目录节点（内部 id 是 `band:<n>`，根文件归“项目根目录文件”）；`taskModel` 复用 `adaptTaskMap` 的同一 phase→状态映射，`rail` 从 `lines/list` 的 `responsibleNow`/`groups` 取负责，`notes` 按 anchor 放当次读到的注记；查找取第一页 6 条、多出用总数，`empty` 只报 `no_catalog`/`no_observation`。布局/几何不进这里。 |
| `decide.ts` | Decide 页（E3-DECIDE §2.3）：`adaptDecide` 的输入是 `goals/list`、`goals/display`、`lines/list`/`lines/read`/`lines/archived`（共享导航读）、每页 `decisions/queue`、带 Task 卡的 `tasks/query` 和按需的 `materials/open`；输出 `DecideData`（三段、每行自己的 notice token、卡的四项失败事实与动作、冲突卡的三个选择、计划草稿的原始 Plan、答复正文）。`pinsFor` 只取 owner 认的 Goal/Run pin，`taskTripleOf` 认卡上的 Task pin，`draftOf` 裁下一版 Plan 草稿（新 `planId`、`planRevision + 1`、`goalId` 取 Plan 快照的 Goal 引用、去编译器字段），`budgetTokensOf` 解析预算文本。不碰 DOM、网络或 `src/app`。 |
| `main.ts` | Main 页 A 段（E3 Main A §2.2/§2.4/§2.7）：`adaptMain` 把共享的导航段、`main/read` 的页、`decisions/queue` 的 `DecideData` 和 `sessions/history` 的原始行折成平铺的 `MainData`（线程 `conversation`、上一页游标 `older`、轨迹 `track`、待决卡 `decisions`、`progress`）；线程按请求根去重、整页反转成时间正序，每轮一条用户行、有 `session` 的一条运行行、回答或 `closeCode + closeMessage` 的一条秘书行，引用按 `endLine ?? startLine` 折成 `MainQuote`，时间留空；A07 的 `done/total` 复用 `goals.ts` 的 `taskProgressOf`；另导出 `requestRootKey`，把 `QueryJobRef` 折成请求根键（`projectId/workspaceId/queryJobId`），页面等待中的气泡只按这一个键认领。不碰 DOM、网络或 `src/app`。 |
| `nav.ts` | 导航段（E3-NAV §2.11）：`adaptNav` 把 `goals/list` 的行、`lines/list` 的行、所选目标的 `goals/display`、`decisions/queue` 的计数和按需的 `lines/read`/`lines/archived` 转成 `props.data` 的导航字段（目标行、工作线行、收件箱、展示状态、归档行、选中线详情）。目标名字用 `ordinal` + `objective`，状态词只来自 `goals/display` 的 `phase`（`null` 不猜）；工作线的字只用 `LineRowV1.status` 的 own/attention，`unavailable` 的控制仍留守卫原因。`completionRevisionOf` 是 `tasks/query.completion` 的 `snapshot.revision` 正本（`not_recorded`、缺省、`not_found` 都是 0），导航段和 `goals.ts` 共用这一份。 |
| `task-map.ts` | `adaptTaskMap` 把 `ReadResult<GoalDetail>`、`ReadResult<GoalDisplayRead>`、`ReadResult<TaskGraph>` 和每次通知的 `lines/list` / `graph/hover` 值转成 `TaskMapData`：Goal 的名字/展示状态/状态词（`goalDisplayState`），阶段按计划顺序，任务的状态词按 `effectivePhase`、`executionIntent` 和 `disposition`；DAG 的节点就是同一批任务行，边是 `plan.executionDag.dependsOn`，门是 `definition.taskKind === 'gate'` 的真实 Task（阶段可只写在 `scope.stageId`），未排定带同时检查无入边、无出边、非门、无验收义务四个条件，关键路径是最长未完成依赖串，没有目标门时不合成节点；`graph/hover` 的 `modules[]` 给 `moduleNames`（“模块”分组按模块 id 分、组标题用名字，页面上不出现 id）；悬停 `owners` 为空或摘要 `responsibility: none`、任务又没完成时，负责写“未分配”（可领取、待执行再接说明），已满足、已取消、已替代仍藏；`why` 留空（路由没有这段正文）。`tasks/query` 的 `not_found` 是 `planMissing` 和 `NO_PLAN_TEXT`。`adaptTaskMapCalendar` 把 `activity/calendar` 的窗口页转成日/小时卡：身份只用返回的 `localDate/localHour/startAt/endAt`，DST 日不补成 24 小时，覆盖不完整时汇总写明范围和“未记全”，不冒充完整 0；`taskMapStatesAt` 按半开时间段取历史状态；`adaptTaskMapTime` 把 `activity/track` 的多页横条、`lines/list` 的行和 `tasks/timeline` 转成轨道：一行一个 `LineRowV1.key`（含接续 Session），Run/检查/Query 按真实 Session、owner 和 `via` 归线，Query 按 `queryRunRef` 去重，检查保留真实 `ordinal`，只从横条自身的 result/pauses 生成标记，Host 重启保留 `approximate`。 |
| `line-shared.ts` | Member/Chain 的共用入口（E3 Member §10）：线身份 `LineKey` 的正本在 `nav.ts`（这里只 import）；`readLine` 是唯一的 `lines/read`，返回线或 `{kind:'branched',heads}`；`submitRunControl` 是唯一的 `controls/submit`，`expected` 取控制项自己的 `pins`、`requestId` 一次点击一个、只认 `committed`；`requeueVisible` 只认 `effectivePhase==='failed'` 且 `failure.requeueActors` 含 `human`；`readSessionTrace` 是唯一的 `sessions/history` 读（Member 的轨迹和 Main 的轨迹页签共用）。不碰 DOM、不碰页面本地状态。 |
| `chain.ts` | Chain 页（E3 Chain §2.3–§2.10）：`adaptChain(source, ui)` 把导航段、选中线的 `lines/read`/`lines/page` executions、尾部 10 段的 `executions/read`/`executions/history`/`executions/brief`、`verification/round` 与 `tasks/query` 折成 `ChainData`；执行段不重排，检查每轮都读，任务词表和重新入队可见性复用正本。 |
| `member.ts` | Member 页（E3 Member §2.3–§2.10）：`adaptMember(source, selected)` 把导航段、`lines/page` 四段、`messages/view`/`messages/body`、`executions/read`（含 `controls/read`/`executions/brief`）、副本的 `queries/read`/`queries/answer`、按需的 `sessions/history`/`files/*`、`graph/hover` 折成 `MemberData`；左栏 `current` 只认 `ownKey`，控制可用性、重新入队可见性和整页链接都来自已读数据和共用函数；`MemberWriteBasis` 是 `tasks/requeue` 的 pins 依据；`trace` 只列 `sessions/history` 原文，`traceOf` 的时间/类型/编号转换也导出给 Main 复用；`changes` 只画工作区未提交文件。 |

## 可复用的能力

- `adaptTaskMap` / `TaskMapData` / `TaskMapDag` / `TaskMapCalendarData` / `adaptTaskMapCalendar` / `TaskMapExtraReads` / `goalDisplayState` / `isFinishedGoalDisplayPhase` / `taskMapStatesAt` / `adaptTaskMapTime` / `TaskMapTimeData` / `localShortAt` / `NO_PLAN_TEXT` / `adaptTaskMapDecisionCards`：任务图（含 DAG 形状）的纯适配、“需要你决定 n 张卡”的计数、展示状态到画板状态词的一处映射、完成/取消的结束判断、历史状态段查找，测试可以直接传构造好的路由值；`taskState`/`stopWordOf`/`automationStopOf` 也从这里导出给 Decide、Chain 复用。
- `adaptGoals` / `GoalsData` / `GoalsGoal` / `GoalsConflict` / `GoalsMaps` / `goalOrderOf`：Goals 页的纯转换；目标状态词复用 `goalDisplayState`，冲突先后复用 `goals/list` 的 `order`（`goalOrderOf` 是 boot 与适配器共用的那一个查表）。
- `adaptArchOverview` / `ArchOverviewSource` / `ArchOverviewData` / `ArchRepoModel` / `ArchRepoNode` / `ArchRepoEdge` / `ArchOverviewUi` / `ArchTaskModelRow` / `ArchRail`：架构页的纯转换；复用 `pathOwnershipOf`、`goalHref`、`NOT_CONNECTED_TEXT` 和 `adaptTaskMap` 的任务状态映射，测试可直接传构造好的路由值。`goalHref` 由 `src/ui/boot.ts` 在解析工作副本前给 `Main.dc.html` 链接带上 `?goal=`。
- `adaptDecide` / `DecideData` / `DecideCard` / `DecideRow` / `DecideAct` / `DecideSource.nav` / `pinsFor` / `taskTripleOf` / `draftOf` / `conflictSelectionOf`：Decide 页的纯转换；`DecideSource.nav` 是共享的 `NavData`（左栏计数取工作区自己的读，队列正文按目标筛选），`DecideAct` 是卡上一个动作的界面形状（`key`/`label`/`step`/`primary`/`cls`/`off`/`tip`）；冲突选择复用 `goals.ts` 的 `conflictSelectionOf`，状态词复用 `task-map.ts` 的 `taskState`/`stopWordOf`，时间复用 `localShortAt`。
- `adaptMain` / `MainData` / `MainQuote` / `MainLogRow` / `MainTrackRow`：Main A 的纯转换（线程、翻页游标、轨迹、待决卡）；复用 `adaptNav` 的导航段、`adaptDecide` 的卡视图和 `goals.ts` 的 `taskProgressOf`。
- `adaptNav` / `NavData` / `NavGoal` / `NavLine` / `LineKey` / `lineHref` / `lineStatusView` / `goalHref` / `completionRevisionOf`：导航段的纯转换和链接形状；目标状态词复用 `goalDisplayState`，结束判断复用 `isFinishedGoalDisplayPhase`，GoalPhase 版本复用 `completionRevisionOf`。`lineHref` 给 Member/Chain 的整页链接带 Goal 和线身份，各编码一次；`lineStatusView` 是线状态词的唯一映射。
- `adaptChain` / `ChainData` / `ChainSource` / `ChainAttempt` / `ChainRound` / `ChainTraceRecord` / `ChainRail` / `ChainBar`：Chain 页的纯转换；复用 `task-map.ts` 的 `taskState`/`taskWhyOf`/`PHASE_WORD`/`FAILURE_CLASS_WORD`/`CHECK_RESULT_WORD`/`RUN_RESULT_WORD`、`nav.ts` 的 `lineStatusView`/`dutyWordOf`、`line-shared.ts` 的 `requeueVisible`。
- `adaptMember` / `MemberData` / `MemberSource` / `MemberWriteBasis` / `MemberCopySource` / `MemberLine` / `MemberItem` / `MemberTraceRow` / `MemberChanges` / `messageBodyKey`：Member 页的纯转换、写 pins 的依据和正文键；复用 `lineStatusView`、`dutyWordOf`、`lineHref`、`requeueVisible` 和 `task-map.ts` 的 `taskState`/`taskWhyOf`/`PHASE_WORD`。
- `taskProgressOf` / `readSessionTrace`：A07 的 `done/total` 唯一规则（Goals 和 Main 共用）和 `sessions/history` 的唯一读（Member 和 Main 共用）。
- `readLine` / `submitRunControl` / `requeueVisible` / `LineReadValue` / `UiClient`：Member 和 Chain 共用的选中线读取、控制提交和重新入队可见性；线身份复用 `nav.ts` 的 `LineKey`。
- 值守卫 `asRecord` / `asText` 在 `src/ui/values.ts`，与 `src/ui/boot.ts` 共用一份。

## 写口

页面只调 `boot.ts` 的动作面；这些动作从最后发布的 `latestDecide` 取卡自己的事实，路由和 `meta.expected` 都在 `boot.ts`，适配器不拼请求。

| 动作 | 路由 |
| --- | --- |
| `answerCard` | `decisions/answer` |
| `requeueCard` | `tasks/requeue`；Goal 级 `interrupted_pending_resume` 卡的“继续”走 `workflow/driver-start`（D6） |
| `reverifyCard` | `verification/reverify` |
| `attestCard` | `executions/resolve-unknown` |
| `changeDisposition` | `plans/propose`，随后 `plans/apply` |
| `addRepairTask` | `plans/propose`，随后 `plans/apply` |
| `markNoticeSeen` | `decisions/notices/seen` |
| `askCard` | `requests/ask`（卡带 `requestRef`）或 `requests/submit`，随后 `requests/read` |

## 边界

- 不调用路由、不读令牌、不写日志；`goals/read` 和 `tasks/query` 的读取顺序、导航读的顺序和 `?goal=` 的范围解析在 `src/ui/boot.ts`。
- `goals.ts` 不重算冲突：重叠文件只来自 `goals/conflicts` 的 `objects`，不从两个目标的 `plannedFiles` 求交；两个目标的先后只来自 `goals/list.order`，不解析 `source.key`。
- `arch-overview.ts` 不画几何、不读路由、不判定环（环由页面副本的 `levelEdges` 对已取边自算）；文件 `state` 只表示计划归属，实际改动只在 `touched`/`possible`（来自 `architecture/change-scope`，缺失行不猜）；文件→模块平手时两个 owner 都放，不挑第一个；支撑目录只来自未认领文件的顶层目录，不从 catalog 模块推、不硬编码名字。
- `nav.ts` 不复制后端的判定：目标“未完成”只在 boot 读过 `goals/display` 后判断，归档行只在展开时读；线行不读 chain，`branched` 不冒充一条线。
- 不认识的字段值不做猜测：缺省的任务状态词落在 `pending`；Goal 的状态词只来自 `goals/display` 的 `phase`，没有采用计划时由 `planMissing` 和 `NO_PLAN_TEXT` 表示。
- `adaptTaskMapTime` 不推算：没有正式 `previous` 就不连线；没有 Task 引用的 Query 只落在线上；执行横条带上 Host 给的尝试序号（`attempt.ordinal`）、重新入队的事实（`attempt.requeue`）和失败原因，界面不自己数，第 2 次起才写序号；缺失的历史原因不出现，状态词和时间段照常保留。
- `adaptTaskMapDetail` / `TaskMapNodeDetailData`：`graph/detail` 的 summary 与 participants 页的纯转换；只显示 `actualFiles` 的“实际改过／可能改过”并按 `pathOwnershipOf` 与正式 containment 归组，实际文件不在计划模块（或它的子模块）下时标“不在计划里”，没读到目录时不标；计划写了文件就列出（`plannedFileCount` 给总述），并按文件判“不在计划里”，没写照旧按模块；实际文件同一路径只出一行（有一条 `definite` 就是“实际改过”），带 `files/uncommitted` 读到的“+a −d（未提交）”或“（未提交）”，读不到就不写；总述的后半句是 `filesNote`；负责工作线后面的尝试序号取任务行的 `attemptOrdinal`，第 2 次起才写；计数不完整时只显示参与线。
- Member/Chain 的共用边界：不解析 Kernel 原始 JSON、不用 plannedFiles 冒充改动、不复制控制项可用性、不复制重新入队可见性。轨迹只列 `sessions/history` 的 `recordedAt`/`kind`/`recordId`（原文才展开，ArtifactRef 写“原始记录”）；改动只画工作区 `files/uncommitted` 的真实 path/加减行；控制项原样用 `kind`/`availability`/`reason`，`expected` 取控制项自己的 `pins`；重新入队只调 `requeueVisible`。
