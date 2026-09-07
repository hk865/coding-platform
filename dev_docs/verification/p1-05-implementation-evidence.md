# P1-05 Implementation Evidence — Required set → Goal phase

```yaml
ticket: P1-05-goal-phase-reduction
status: evidence complete, implementation verified (limited authorization, 2026-09-05 — P1-05 only)
baseline: product root commit 5a278cb (P1-04 accepted); P1-05 shared baseline 3256167; final main HEAD recorded in the command log
authorization: 用户按 P1-04 先例有限授权本票（P1-05 仅限）；本票验收 ≠ 整个 P1 已验收；P1-07/08 不自动开始（DAG：05 验收后才出现 07/08 并行窗口）
next: STOP after P1-05 — P1-06 parallel session paused by user (merge surface recorded); P1-07/08 wait for separate authorization
```

## 1. What was built

ControlEngine 从当前 PlanRevision 的全部 required 工作与 Gate、required AcceptanceObligation、适用证据（P1-04 纯函数摘要）与副作用对账**确定性归约 Goal phase**，并投影 goalStatus / goalTimeline 与确定性解释（语义叙述留 T15）。

### 冻结入口与产物（integrator 维护的共享基线，全部在产物根 commit `3256167` 起）

| 面 | 文件 | 内容 |
| --- | --- | --- |
| 契约+纯函数 | src/contracts/goal-phase.ts | GoalReductionInput / GoalPhase（§9 封闭 10 值）/ GoalCompletionExplanation / SideEffectReconciliation；reduceGoalPhase（10 级表 + §3/§8 GoalCompletionGuard）、evaluateGoalCompletionGuard、reconcileGoalSideEffects、renderGoalCompletionExplanation；GoalPhaseSnapshot / GoalPhaseUpdatedEvent / ReduceGoalCommand/Receipt / reduceGoalFingerprint |
| 视图契约 | src/contracts/goal-phase-view.ts | GoalStatusQuery/View/Result（ready 字段名 `goal`）、GoalTimelineQuery/Entry/Result |
| fixtures | src/contracts/fixtures/goal-phase-fixtures.ts | P105_PLAN_REVISION_FIXTURE_V1（plan-goal-mvp：work + Module/Stage/Goal 三层 gate + optional；parentOf；无 dependsOn）+ 确定性 fold 构建器 |
| ledger/validation | src/contracts/{ledger,ledger-validation,validation,events,modules}.ts | goal-reduction commitKind + validateGoalReductionCommit（双适配器共用）、validateReduceGoalCommand、validateDomainEvent GoalPhaseUpdated 分支、DomainEvent/KNOWN_EVENT_TYPES、ControlEngine.reduceGoal |
| Control 入口 | src/control/goal-reducer.ts | reduceGoal（guard→facts→纯函数→单事务 fold→map；CAS/完整幂等；零写入拒绝） |
| ReadModel | src/read-model/read-model-index.ts、src/sqlite-read-model/sqlite-read-model-index.ts | GoalPhaseUpdated → goalStatus + goalTimeline（InMemory + SQLite 双适配器；重建等价/全键隔离/freshness） |
| loops | 双 harness 直通 + 契约套件 + 重启骨架 + 集成接线 | tests/contract-suite/{p1-05-harness,goal-phase.contract.suite}.ts、tests/restart/p1-05-*、tests/integration/p1-05.* |

## 2. 8 项 Acceptance 逐项证据

| # | Acceptance | 证据 |
| --- | --- | --- |
| 01 | 只有全部 required work Task、required obligation 与 required GateTask 满足且无未对账副作用时才能 COMPLETED | 契约套件“full completion…→COMPLETED”与“side-effect comparison…NEEDS_DECISION”；纯 reducer “COMPLETED: …”；lane A “full required satisfaction → COMPLETED”；GoalPhaseUpdated 投影 test 1 |
| 02 | optional 不阻止完成；required 的 deferred/cancelled/blocked/failed 不伪装成完成 | 纯 reducer：optional_task_not_satisfied 仅 attention flag；deferred→NEEDS_DECISION；blocked→BLOCKED；failed→FAILED（均不为 COMPLETED）；套件“RUNNING after plan…”含 optional 运行中任务 |
| 03 | parent_of、Module、Stage、完成比例不改变 required 集合 | 纯 reducer “parent_of / Module / Stage never change…（same phase with/without）”；P1-05 计划 fixture 含 parentOf + module/stage 作用域且完成守卫包含三层 gate |
| 04 | 空 Plan / 空 required GoalGateTask / 空 obligation / 空 VR 不能证明完成 | 纯 reducer 4 个 §3 用例（fail-closed 进 FAILED/PLANNING）；套件“applyPlan rejects a plan WITHOUT a required active GoalGate”（零写入）+ “PLANNING for a goal with no active plan”（空 Plan 不完成） |
| 05 | no-change 只能由带当前 PASS Evidence 的 AlreadySatisfied GoalGateTask 表达 | 套件 full completion（goal gate 仅由 PASS 观察证据满足 → completion_guard_ok 记录 gate taskIds）；纯 reducer “no-change ONLY via…”；applyPlan 拒绝空 goal-gate 计划 |
| 06 | BLOCKED、NEEDS_DECISION、FAILED、CANCELLED 与 outcome_unknown 有确定性优先级 | 纯 reducer：CANCELLED（有效 cancel Decision，优先级 1）、CHANGE_PENDING/PAUSED/ACCEPTED_PARTIAL 各表项、RUNNING（前沿推进）、NEEDS_DECISION（outcome_unknown 未对账）、BLOCKED（全部真实阻塞）、FAILED（终局+invariant fail-closed）；真实路径“same facts + unreconciled outcome_unknown → NEEDS_DECISION” |
| 07 | 相同事实重放得到相同 Goal phase 与解释 | 纯 reducer “replay equality”（phase/reasonCodes/refs/explanation JSON 相等）；lane A “determinism: re-reduction…”；重启路径 runP105Path 两次归约均 COMPLETED（previousPhase=COMPLETED）；restart 1/1 |
| 08 | 历史 FAIL 保留，只有当前适用证据参与本次完成 guard | 纯 reducer “historical FAIL preserved…”（hasHistoricalFail=true + 全覆盖无阻断 → COMPLETED 且 attention flag；当前阻断 FAIL → 不完成）；义务摘要有 hasHistoricalFail 审计字段（buildGoalReductionInput），blockingEvidenceIds 只含当前适用未 supersede 的 FAIL/INCONCLUSIVE |

## 3. 关键设计决策（写入 HANDOFF “P1-05 契约与存储语义（冻结）”）

1. **Goal phase 存储 = 新聚合**：`goal-reduction` commitKind + GoalPhase 聚合（ref=(projectId, goalId)，与 TaskReduction 对称、保留阶段历史、不动 P1-00/02 冻结 Goal 快照形状）；CAS + 完整幂等 + 零写入拒绝。
2. **四契约** schemaVersion 1、未知版本拒绝（不静默跳过）；输入为可替换事实快照（本轮=plan 枚举+点查；将来=摘要提供者，即 T07 增量优化预留接口）。
3. **纯函数 reduceGoalPhase**：表驱动严格顺序 10 级（CANCELLED > CHANGE_PENDING > PAUSED > COMPLETED > ACCEPTED_PARTIAL > PLANNING > RUNNING > NEEDS_DECISION > BLOCKED > FAILED），恰一 primary phase；较低优先级命中作为 attention flags；§3 全规则 fail-closed；GoalCompletionGuard（§8 完整公式）；required deferred/cancelled → NEEDS_DECISION；全部剩余前沿真实阻塞 → BLOCKED；终局失败（P1-05 无 retry 策略）→ FAILED；未覆盖 invariant → FAILED fail-closed 带诊断码；**verifying+终局 run 不算可推进前沿**（P1-05 无重派发）。
4. **判定与解释分离**：reduceGoalPhase 产出 (phase, reasonCodes, refsByCode)；renderGoalCompletionExplanation 确定性模板 + 确定性 refs 拼接（可重放/可比较/可穷举）；语义叙述留 T15。
5. **事件与视图**：每归约一个 GoalPhaseUpdated（after+reason+explanation+reconciliation）；goalStatus（key=(projectId,goalId)，ready.goal）+ goalTimeline；freshness 沿用 opaque CommitCursor（not_ready≠not_found）；**ModuleProgress/StageProgress 只投影，绝不作为 reducer 输入**（防投影回环）。
6. **重启等价**：goal-reduction 单事务；重启后 GoalPhase 快照 load 一致 + 视图从持久 EventPage 重建逐字段一致 + observedCursor 一致（isP105Ready 探针自动启用）。
7. **边界**：不做并行 Reader/唯一 Writer（P1-07）、只读控制台（P1-08）、换手（P1-06）、计划变更/Decision（P1-11/14）；副作用只识别+阻断+记录；Worker/Reviewer/ReadModel 均不写 Goal phase（TaskDetail.phase 保持计划值，套件断言）。

## 4. 命令与结果（product root = /home/han001/projects/agents/agent_platform）

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS 0 errors |
| `pnpm vitest run`（全量） | **64 files / 539 tests PASS**（P1-00…04 基线 486 零回归 + P1-05 新增 53） |
| `pnpm vitest run tests/integration/p1-05.contract-suite.inmemory.test.ts` | 8/8 PASS |
| `pnpm vitest run tests/integration/p1-05.contract-suite.sqlite.test.ts` | 8/8 PASS（同一套件定义，无调参） |
| `pnpm vitest run tests/integration/p1-05.integration.test.ts` | 1/1 PASS（真实 SQLite 全路径 + 重启等价） |
| `pnpm vitest run tests/restart/p1-05-restart.test.ts` | 1/1 PASS |
| `pnpm vitest run tests/restart/evidence/p1-05-evidence.test.ts` | 1/1 PASS（JSON 证据块可重复） |
| `node dev_docs/verification/validate-docs.mjs` | 12/12 PASS |

### P1-05-EVIDENCE 摘要（可重复输出）

```json
{
  "ticket": "P1-05",
  "goalPhase": "COMPLETED",
  "reasonCodes": ["optional_task_not_satisfied", "completion_guard_ok"],
  "explanationHeadline": "goal goal-105 phase = COMPLETED (2 reason(s), completion guard holds)",
  "timelineLength": 2,
  "observedCursorEqual": true,
  "snapshotsMatch": true,
  "viewsRebuild": true,
  "eventTypes": [ "...", "GoalPhaseUpdated", "GoalPhaseUpdated" ]
}
```

完整块：`pnpm vitest run tests/restart/evidence/p1-05-evidence.test.ts`。

## 5. 集成裁决记录（integrator）

- 三路子 Agent（A/B/C）在并行执行中因**子 Agent 基础设施故障中断**（未产出、未 commit；B 于内存适配器完成后中断）。按 P1-04 先例由 integrator 接管：A（goal-reducer，commit 36c144c）、B（双适配器投影，commit faa97e2）在各自隔离 worktree 完成并以 lane commit 合并入 main（8a7da9c、746dfc6）；C（重启证据/集成骨架）由 integrator 编写，无需改动，探针自动启用即验证。**奖励/惩罚不适用；设计不变**。
- 共享 helper 修正（main）：satisfyEverythingP105 在 outcome_unknown 场景断言 work 归约为 verifying（“未对账副作用 → 不满足”），供套件与各 lane 复用。
- **接口文档与票据 Acceptance 无冲突**（契约以票据为准；已在 command-event/state-ledger/goal-view 追加 P1-05 版本化扩展记录，validate-docs 12/12）。
- **P1-06 合并面（供并行 session 协调）**：`agent_platform-p1-06`（branch `p1-06-int`，未 commit，用户已暂停）在 events.ts / ledger.ts / validation.ts 与 P1-05 同区修改；合入 main 时按“双方皆保留、版本化追加”解决三处文本冲突；其 typecheck 红（ledger 适配器 switch 缺 handoff-record / replacement-claim case + 对应 vaildator）为 Phase 1 未完成态，非语义错误。

## 5b. 三方独立验收（子 Agent 复跑，仅只读 + 运行测试，未改文件）

| 验收者 | 结论 | 主要发现与处置 |
| --- | --- | --- |
| Lane A（goal reducer） | **PASS**（typecheck 0、lane 6/6、纯 reducer 19/19） | ①“副作用路径缺 guard_required_obligation_unsatisfied”——已判定：义务满足=证据级（P1-04 公式），任务级阻断单独记为 guard_required_work_task_unsatisfied，主分支套件断言按此修正（评审时其 worktree 为旧套件故显红；主分支实测全绿）；② 其余为旧基线冲突/范围提示，均已裁决/已修复（not_found 用例、isPlanRevisionSnapshot 防御性提示、lane B 缺席红项） |
| Lane B（视图+事件） | **PASS**（typecheck 0、投影 7/7、重启 1/1） | **真实发现已修复**：goalStatus/goalTimeline 无 atLeastCursor 缺失键曾返回 not_found——与冻结 goal-view 契约“not_found 仅在提供且已覆盖 atLeastCursor 时”不一致；已按 goal()/planGraph()/taskDetail()/activeAgent 同型改为 freshness-safe not_ready（双适配器），套件与投影测试同步更新；并补齐“两 Project 同 goalId 各查各的”真隔离用例（InMemory + SQLite，直接事件流） |
| Lane C（重启证据+集成） | **PASS**（3 files/3 tests、typecheck 0） | 8 核对点全 PASS；两条备注（契约套件覆盖其余 Acceptance；解释等值由重启边界全字段断言覆盖）属已记录设计取舍 |

## 6. 边界与下一步

- P1-05 验收后 STOP；P1-07/08 在 05 验收后才出现并行窗口，不自动开始。
- 未实现（后续票）：并行 Reader/唯一 Writer（P1-07）、只读控制台（P1-08）、换手（P1-06）、计划变更/Decision（P1-11/14）、retry/replan（P1-10）、语义叙述解释（T15）、Findings 机制（P1-04 公式保留空输入）。
