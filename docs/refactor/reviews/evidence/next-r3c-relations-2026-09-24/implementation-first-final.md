实现已落盘并通过全部验收。以下是第二阶段完成报告。

# R3c 第二阶段实现报告：任务关系与精确输入

## 1. 实际改动（仅 5 个冻结生产文件）

**`plan-record-codecs.ts`（单一固定机械 codec，正文 v1|v2）**
- 机械 `schemaId` 保持固定 `PlanRevisionSnapshot@1`；`encodePlanRevisionSnapshot` 不变，未重实现被主审撤销的 outer `@2`。
- `structuralPlanIssues` 改为接受正文 `schemaVersion` 1|2、拒绝未知版本；v1 正文不得携带 `taskRelations`/`inputRequirements`（否则 invalid）；v2 校验关系形状（非空端点、`kind∈{coordination,expected_dependency}`、`note` 字符串）与输入形状（`requirementId`/`consumerTaskId` 非空、`kind==='artifact'`、完整 `ArtifactRef`）。关系允许环，不做 DAG。
- `planRevisionSnapshotIssues` 删除硬编码 `schemaVersion===1`，交由 `structuralPlanIssues` 判定，使 v2 接受快照与 `PlanRevisionAccepted` 内层快照可读。
- `PLAN_VALIDATION_CODES` 补入冻结码 `duplicate_requirement_id`。
- 抽出 `artifactRefIssues` 单条 ArtifactRef 规则，复用于 candidate `reason.sources` 与 v2 `inputRequirements`。

**`plan-commit-compiler.ts`**
- `buildPlanRevisionSnapshot` 现在写出 `schemaVersion: draft.schemaVersion`，并在 v2 时原样携带 `taskRelations`/`inputRequirements`，保证提案→接受快照→事件→重放→重启不丢字段。

**`plan-validation.ts`（领域成员资格，不判可用性）**
- v2 关系端点必须在本 Plan（`dangling_task_ref`）；`requirementId` 本 Plan 唯一（`duplicate_requirement_id`）；`consumerTaskId` 必须存在（`dangling_task_ref`）。
- 对非数组/畸形列表只跳过（形状由 codec 负责），保证 `proposePlan` 返回类型化结果而非 throw。

**`eligibility.ts`**
- 删除前驱整 Task `satisfied` 判断（`deps_unsatisfied`）。
- 本任务缺 canonical phase → `task_state_incomplete`，不再默认 `pending`。
- 保留 kind/disposition/自身 phase/lease 与 goal/task 完整性检查。

**`plan-service.ts`**
- `queryReadyTasks` 删除独立 `blockedByDeps` 过滤与无用 `buildTaskAdjacency` 构造；候选资格与图共用 `taskRow`+`evaluateEligibility`。
- 新增 `buildTaskRowIndex`：一次查询归组 v2 relations/inputs，`taskRow` 不再对每个 Task 重扫完整列表；`queryTaskGraph`、`queryReadyTasks` 共用该投影，输入仍为 `not_checked`，旧 `executionDag` 保留 `legacy_unverifiable`。
- 实现 `readTaskInput`：同步 `ownJsonInput` 隔离（AbortSignal 保留）→ 校验完整 `GoalRef`/`PlanRevisionRef`/taskId/requirementId 与 scope → `authorizeReadContext`+`readGoal`+`authorizeGoal`+`readPlan` → 显式 Plan 必须是指定 Goal 的已接受计划（跨 Goal 同 `requirementId` 拒绝）→ 精确匹配 `{requirementId, consumerTaskId}` → v1/无匹配 `not_found` → 缺注入 `unsupported` → 仅一次 `materials.openArtifact(ctx,{ref,usage:'current'})`，真实 `source_stale`/`forbidden`/`not_found` 原样返回。

## 2. 删除的重复规则

- `evaluateEligibility` 的前驱整 Task 完成门槛。
- `queryReadyTasks` 的重复 `blockedByDeps` 过滤与无用邻接构造。
- `taskRow` 每 Task 重扫新增 v2 列表（改为每查询一次索引）。
- 两处重复 ArtifactRef 形状校验合并为 `artifactRefIssues`。

## 3. 复用的 reader / 事实来源

- `readGoal`、`readPlan`、`readGoalScope`、`readCanonicalTaskFacts`（Run+TaskLease+TaskReduction）、`authorizeReadContext`/`authorizeGoal`。
- 真实 `MaterialPort.openArtifact`（含 grant/source applicability），不把历史可读或生产 task satisfied 当 current。
- `PLAN_RECORD_SCHEMAS` 注册的单一 codec；`contracts/dispatch.ts` 冻结 reason。

## 4. 实测结果（全部通过）

| 检查 | 结果 |
| --- | --- |
| `next-task-relations` | **PASS** 6 files / 12 tests |
| `next-plan` | **PASS** 4 files / 8 tests |
| `next-types` | **PASS** |
| `next-architecture` | **OK**（5/8 allowed observed edges，边界通过） |
| 额外回归 `next-tests` | **PASS** 57 files / 383 tests |

## 5. 未支持项与边界（未越界实现）

- `inputRequirements` 本批仅 `artifact`；未建材料索引/第二事实库。
- 未实现完整 R4c claim/执行驱动、冲突图、跨 worktree 合并。
- `readTaskInput` 未注入 materials 时明确 `unsupported`；v1 Plan 无精确输入 → `not_found`。
- 普通图/候选查询不 `openArtifact`、不 capture、不调模型（`R3c-task-relations` 断言的 `materialReads===0` 通过）。

## 6. 范围与禁令

仅修改 scope.json 列出的 5 个文件；测试/契约/composition/runner 未改（mtime 仍为审核冻结时间）；未新增文件、未装依赖、未 stage/commit/push/reset/restore/clean/stash。实现过程未更改接口或测试来迁就检查。