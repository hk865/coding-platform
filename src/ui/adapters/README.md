# src/ui/adapters/：画板数据适配层

这一层只做纯转换：把 Host 路由的返回值变成画板通过 props 读取的形状。不碰 DOM、不碰网络、不引用 `src/app`。

## 文件

| 文件 | 负责什么 |
| --- | --- |
| `task-map.ts` | `adaptTaskMap` 把 `ReadResult<GoalDetail>`、`ReadResult<GoalDisplayRead>` 和 `ReadResult<TaskGraph>` 的值（由 `src/ui/boot.ts` 拆出 `.value`）转成 `TaskMapData`：Goal 的名字/展示状态/状态词（`goalDisplayState`），阶段按计划顺序，任务的状态词按 `effectivePhase`、`executionIntent` 和 `disposition`，依赖只保留仍在图上的任务；`why` 留空（路由没有这段正文），没有阶段或阶段未知的任务挂在目标下；`tasks/query` 的 `not_found` 是 `planMissing` 和 `NO_PLAN_TEXT`。 |

## 可复用的能力

- `adaptTaskMap` / `TaskMapData` / `goalDisplayState` / `isFinishedGoalDisplayPhase` / `NO_PLAN_TEXT`：任务图的纯适配、展示状态到画板状态词的一处映射、完成/取消的结束判断，测试可以直接传构造好的路由值。
- 值守卫 `asRecord` / `asText` 在 `src/ui/values.ts`，与 `src/ui/boot.ts` 共用一份。

## 边界

- 不调用路由、不读令牌、不写日志；`goals/read` 和 `tasks/query` 的读取顺序在 `src/ui/boot.ts`。
- 不认识的字段值不做猜测：缺省的任务状态词落在 `pending`；Goal 的状态词只来自 `goals/display` 的 `phase`，没有采用计划时由 `planMissing` 和 `NO_PLAN_TEXT` 表示。
