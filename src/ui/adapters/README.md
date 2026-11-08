# src/ui/adapters/：画板数据适配层

这一层只做纯转换：把 Host 路由的返回值变成画板通过 props 读取的形状。不碰 DOM、不碰网络、不引用 `src/app`。

## 文件

| 文件 | 负责什么 |
| --- | --- |
| `nav.ts` | 导航段（E3-NAV §2.11）：`adaptNav` 把 `goals/list` 的行、`lines/list` 的行、所选目标的 `goals/display`、`decisions/queue` 的计数和按需的 `lines/read`/`lines/archived` 转成 `props.data` 的导航字段（目标行、工作线行、收件箱、展示状态、归档行、选中线详情）。目标名字用 `ordinal` + `objective`，状态词只来自 `goals/display` 的 `phase`（`null` 不猜）；工作线的字只用 `LineRowV1.status` 的 own/attention，`unavailable` 的控制仍留守卫原因。 |
| `task-map.ts` | `adaptTaskMap` 把 `ReadResult<GoalDetail>`、`ReadResult<GoalDisplayRead>`、`ReadResult<TaskGraph>` 和每次通知的 `lines/list` / `graph/hover` 值转成 `TaskMapData`：Goal 的名字/展示状态/状态词（`goalDisplayState`），阶段按计划顺序，任务的状态词按 `effectivePhase`、`executionIntent` 和 `disposition`；DAG 的节点就是同一批任务行，边是 `plan.executionDag.dependsOn`，门是 `definition.taskKind === 'gate'` 的真实 Task（阶段可只写在 `scope.stageId`），未排定带同时检查无入边、无出边、非门、无验收义务四个条件，关键路径是最长未完成依赖串，没有目标门时不合成节点；`graph/hover` 的 `modules[]` 给 `moduleNames`（“模块”分组按模块 id 分、组标题用名字，页面上不出现 id）；悬停 `owners` 为空或摘要 `responsibility: none`、任务又没完成时，负责写“未分配”（可领取、待执行再接说明），已满足、已取消、已替代仍藏；`why` 留空（路由没有这段正文）。`tasks/query` 的 `not_found` 是 `planMissing` 和 `NO_PLAN_TEXT`。`adaptTaskMapCalendar` 把 `activity/calendar` 的窗口页转成日/小时卡：身份只用返回的 `localDate/localHour/startAt/endAt`，DST 日不补成 24 小时，覆盖不完整时汇总写明范围和“未记全”，不冒充完整 0；`taskMapStatesAt` 按半开时间段取历史状态；`adaptTaskMapTime` 把 `activity/track` 的多页横条、`lines/list` 的行和 `tasks/timeline` 转成轨道：一行一个 `LineRowV1.key`（含接续 Session），Run/检查/Query 按真实 Session、owner 和 `via` 归线，Query 按 `queryRunRef` 去重，检查保留真实 `ordinal`，只从横条自身的 result/pauses 生成标记，Host 重启保留 `approximate`。 |

## 可复用的能力

- `adaptTaskMap` / `TaskMapData` / `TaskMapDag` / `TaskMapCalendarData` / `adaptTaskMapCalendar` / `TaskMapExtraReads` / `goalDisplayState` / `isFinishedGoalDisplayPhase` / `taskMapStatesAt` / `adaptTaskMapTime` / `TaskMapTimeData` / `localShortAt` / `NO_PLAN_TEXT` / `adaptTaskMapDecisionCards`：任务图（含 DAG 形状）的纯适配、“需要你决定 n 张卡”的计数、展示状态到画板状态词的一处映射、完成/取消的结束判断、历史状态段查找，测试可以直接传构造好的路由值。
- `adaptNav` / `NavData` / `NavGoal` / `NavLine`：导航段的纯转换；目标状态词复用 `goalDisplayState`，结束判断复用 `isFinishedGoalDisplayPhase`。
- 值守卫 `asRecord` / `asText` 在 `src/ui/values.ts`，与 `src/ui/boot.ts` 共用一份。

## 边界

- 不调用路由、不读令牌、不写日志；`goals/read` 和 `tasks/query` 的读取顺序、导航读的顺序和 `?goal=` 的范围解析在 `src/ui/boot.ts`。
- `nav.ts` 不复制后端的判定：目标“未完成”只在 boot 读过 `goals/display` 后判断，归档行只在展开时读；线行不读 chain，`branched` 不冒充一条线。
- 不认识的字段值不做猜测：缺省的任务状态词落在 `pending`；Goal 的状态词只来自 `goals/display` 的 `phase`，没有采用计划时由 `planMissing` 和 `NO_PLAN_TEXT` 表示。
- `adaptTaskMapTime` 不推算：没有正式 `previous` 就不连线；没有 Task 引用的 Query 只落在线上；执行横条带上 Host 给的尝试序号（`attempt.ordinal`）、重新入队的事实（`attempt.requeue`）和失败原因，界面不自己数，第 2 次起才写序号；缺失的历史原因不出现，状态词和时间段照常保留。
- `adaptTaskMapDetail` / `TaskMapNodeDetailData`：`graph/detail` 的 summary 与 participants 页的纯转换；只显示 `actualFiles` 的“实际改过／可能改过”并按 `pathOwnershipOf` 与正式 containment 归组，实际文件不在计划模块（或它的子模块）下时标“不在计划里”，没读到目录时不标；计划写了文件就列出（`plannedFileCount` 给总述），并按文件判“不在计划里”，没写照旧按模块；实际文件同一路径只出一行（有一条 `definite` 就是“实际改过”），带 `files/uncommitted` 读到的“+a −d（未提交）”或“（未提交）”，读不到就不写；总述的后半句是 `filesNote`；负责工作线后面的尝试序号取任务行的 `attemptOrdinal`，第 2 次起才写；计数不完整时只显示参与线。
