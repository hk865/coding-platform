# 第一阶段完成报告：R3c 骨架与行为边界测试（未实现生产算法）

## 1. 写入范围

唯一改动文件（共 122 行，4 个测试）：
- `T/tests/work-graph/R3c-task-relations-boundaries.test.ts`

未改任何旧测试、生产源码、契约、composition 或 runner；未新增文件、未装依赖、未 stage/commit/push/reset/restore/clean/stash。写入时 `write` 工具的原子 rename 临时目录被 EROFS 拒绝（单文件挂载限制，见 DSH-EXECUTION-HARNESS §4），改用原地 bash 写入。

## 2. 复用的骨架与契约（未重写/未丢弃）

- `src/contracts/plan.ts`：`PlanRevisionDraft`/`PlanRevisionSnapshot` 的 schemaVersion 1|2 判别联合；`TaskRelationV2`、`TaskInputRequirementV2`。
- `src/core/work-graph/tasks/plan-contracts.ts`：`TaskRow` 三分解释字段 `relations` / `inputRequirements(not_checked)` / `legacyDependencies(legacy_unverifiable)`，`readTaskInput` 端口。
- `src/contracts/dispatch.ts`：冻结的 `TaskIneligibilityReason.code = "task_state_incomplete"`。
- `src/core/work-graph/tasks/eligibility.ts`、`plan-record-codecs.ts`（真实 codec，未自造 decoder）、`plan-service.ts` 的 `readTaskInput` unsupported 入口。
- 测试构造风格复用 `R3c-canonical-task-state.test.ts` / `R3c-task-graph.test.ts`，未复制大 fixture。

## 3. 新增测试范围与来源

| 测试 | 断言 | 来源 |
| --- | --- | --- |
| `does not treat an absent canonical task phase as pending` | 自身无 canonical phase → `eligible:false` 且含 `task_state_incomplete`；不允许落到 pending | 本阶段任务书 #1 + dispatch.ts 冻结 reason |
| `binds a PlanRevisionSnapshot record schema to its body schemaVersion` | `@1`+v1 与 `@2`+v2 解码；两个交叉组合 invalid；真实 encoder v2 产出 `PlanRevisionSnapshot@2` | 任务书 #2、work-graph §4.1、R3c-task-relations:192 既有期望 |
| `rejects a v1 PlanRevisionSnapshot that carries v2-only fields` | v1 body 带 `taskRelations`/`inputRequirements` → invalid | 任务书 #2、冻结语 “不得接受v1新字段后静默丢弃” |
| `rejects a legacy v1 PlanProposal record that carries v2-only fields` | legacy v1 proposal 记录带 v2 字段 → invalid（额外风险，见 #3） | `R3c-next-relations-dsh-prompt.md`:14 “不得接受v1新字段后静默丢弃”；codec legacy 分支现会静默忽略未知字段 |

**未重复**：`evaluateEligibility` 在上游 running、自身 pending/free 时 eligible:true 已由既有 `R3c-task-graph.test.ts:34` 覆盖（且已包含在 `next-task-relations` 检查内），故未复制。

## 4. 检查结果

```
python3 tools/dsh-refactor/check.py next-types          → exit 0（types 通过）
python3 tools/dsh-refactor/check.py next-task-relations → exit 1（10 failed / 3 passed；5 failed files）
```

新增 4 项全部为断言红（非运行错误），根因均为**缺实现**：
1. `eligibility.ts:47` 对缺失 phase 执行 `?? 'pending'`，且 `:55-62` 仍计算 `deps_unsatisfied`。
2. `plan-record-codecs.ts:43` 固定 `PLAN_REVISION_SCHEMA_ID='PlanRevisionSnapshot@1'`；`:295/:453` 与 `structuralPlanIssues` 强制 body `schemaVersion===1`；`:465` 拒绝 `@2`。v2 支持尚未写。
3. v2 字段在 v1 body 上无人校验，被静默接受。
4. legacy `PlanProposal` 分支同样不拒绝 v2 字段（额外风险来源见上表）。

**既有测试自身错误（非缺实现）**：
- `R3c-task-relations.test.ts`（memory/sqlite）在 `createRecordBackend` 阶段抛 `RecordLookupRegistrationError: lookup index r3c-run-by-goal aggregateType Run has no registered record schema`：该文件注册了 `PLAN_STATE_RECORD_SCHEMAS.lookups` 却没有注册 Run record schema（姊妹测试均引入 `materialRecordSchemas()`）。测试只读，需 Astra 处理。
- 基线时 `R3c-task-relations-boundaries.test.ts` 为空文件、被 vitest 记为 “no test suite” 失败；现已由 4 个真实测试替代。
- 其余既有红：`R3c-task-inputs`、`R3c-R4b-platform`（均因 “plan schemaVersion must be 1” 缺 v2 codec）、`R3c-task-graph`（`deps_unsatisfied`）。

## 5. 需要 Astra 裁决的接口/语义缺口

1. **PlanRevision record schemaId 与 RecordStore 注册表冲突（最关键）**
   - 读路径用注册 schemaId 重建 envelope：`in-memory-record-store.ts:234`、`sqlite-record-store.ts:368`、`record-codec.ts:369-397`。故 `R3c-task-relations.test.ts:192` 期望读到 `PlanRevisionSnapshot@2`，就要求 `Plan` 聚合注册的 schemaId 为 `@2`。
   - 但 commit 按精确 `record.schemaId` 查注册表（`record-codec.ts:558/630`），而注册表禁止同一 aggregateType 注册两个 schema（`:162`），`record-codec.ts` 不在本批 5 个可写文件内。
   - `R4b-session-directory.test.ts:138`（`next-session-directory` 现为 **24 项全绿**）直接 commit 一个 `PlanRevisionSnapshot@1` 记录。若把注册改为 `@2`，该提交立即因 “unregistered schemaId @1” 失败。
   - 即：按“schemaId 版本 == body schemaVersion”字面冻结语义，encoder 需对 v1 发 `@1`、v2 发 `@2`，注册表无法同时容纳；而只注册一个又必与上述两测试之一冲突。需决定：扩注册表（超出 R3c 写范围）、改冻结期望、或定义与 body 版本无关的单一 record schemaId。
2. **前驱门槛自相矛盾**：`R3c-plan-adoption.test.ts:244-256` 期望上游 running ⇒ implement `eligible:false` 且 `queryReadyTasks(includeBlocked:false)` 返回 `[]`；`R3c-task-graph.test.ts:34` 与本次冻结纠偏要求上游 running 不得拒绝。二者不可同时成立（前者在 `next-plan`，不在本检查内）。
3. **测试夹具错误**：`R3c-task-relations.test.ts` 缺 Run record schema 注册（见 §4），当前在该文件内完全遮蔽了 v2/readTaskInput 断言。
4. **残余（未加测试）**：`PlanRevisionAccepted` 事件 validator 仍要求内嵌 snapshot `schemaVersion===1`（`plan-record-codecs.ts:453/555`），而冻结语义是外层事件 version 不变、内层 snapshot 显式版本；该路径由 R3c-task-relations/R3c-task-inputs 的重放间接覆盖，待 v2 codec 实现后自然暴露。

## 6. 实现者必须遵循的调用顺序与事实来源（供冻结用）

**顺序**
1. `proposePlan` → `applyPlanChange`（v2 全量 draft 仅初始受理；变更需后续协议）。
2. 读图/候选：`readGoalPlanWindow`/`readPlan` → `readCanonicalTaskFacts`（Run+TaskLease+TaskReduction）→ 共用 `taskRow`+`evaluateEligibility`。删除 `evaluateEligibility` 的前驱整 Task satisfied 判断，并删除 `queryReadyTasks` 内重复的 `blockedByDeps`（`plan-service.ts:918-920`）；缺自身 phase 返回 `task_state_incomplete`，不默认 pending。保留自身 phase/kind/disposition/lease/scope/授权检查。
3. `readTaskInput`：同步隔离输入与身份（保 AbortSignal、拒绝调用方替换 ArtifactRef）→ 校验完整 refs/scope → 用 `readPlan` 读已接受 Plan 的确切 requirement → 仅 `MaterialPort.openArtifact(..., usage:'current')`；原样透传 material 失败，缺注入 unsupported；不因历史可读或生产 task satisfied 当当前可用。

**事实来源**
- 任务定义/`taskRelations`/`inputRequirements`：不可变 `PlanRevisionSnapshot`。
- `effectivePhase`/attempt/execution/lease：canonical Run/TaskLease/TaskReduction（`plan-readers.ts`）。
- 当前材料适用性：真实 MaterialPort + MaterialAccessGrant + source pin。
- 活动 Plan 与 scope：`GoalSnapshot` 指针。
- 版本/身份：RecordStore 按 aggregateType 注册的 codec（schemaId ↔ body 版本）。
- 拒绝码：`contracts/dispatch.ts` 冻结集合。

## 7. 状态

第一阶段产物已落盘、types 通过、行为测试为有价值的 RED。**未进入第二阶段，等待 Astra 审阅并冻结测试 hash / 接口（尤其 §5.1、§5.2 两处冲突）后再派发实现。**