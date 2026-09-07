# P1-04 Implementation Evidence — CompletionClaim → Evidence → Task/Gate SATISFIED

```yaml
status: implementation verified (limited authorization, 2026-09-05 — P1-04 only)
updated: 2026-09-05
ticket: P1-04
limited_authorization: true
next: STOP after P1-04 — do NOT auto-start P1-05/06 (DAG: 04 验收后才出现 05/06 并行窗口)
```

## 状态

P1-04 共享基线 + 四路并行（Lane A/B/C/D 隔离 worktree → main 合并）全部落地；最终
`pnpm typecheck` 0 errors；`pnpm vitest run` **55 files / 485 tests PASS**（既有 P1-00/01/02/03
395 项零回归 + P1-04 新增 90 项）；P1-04 契约套件 InMemory 18/18、SQLite 18/18（**同一套件定义，
无调参**）；真实 SQLite 集成 2/2；重启证据 1/1；`validate-docs` 12/12。

## P0-06 复核影响（AGENTS.md 要求）

`dev_docs/design/human-framework-role-review.md`（in_review，P0-06 未关闭）与本票无冲突：复核的
"框架依证据规则接受结果，集成者同意不单独构成完成条件"（= Acceptance 7）、"不重复写入，不以 claim
直接完成；接入静态/运行/语义证据"（= evidence-intake + reducer 规则）、"状态链：工具/Agent 产出 →
框架校验与归约 → 持久状态 → 事实投影"（= intake → TaskReduction → ReadModel）均在本票验收内。复核
未要求本票修改角色/输入输出；本票不归约 Goal（P1-05）、不做换手（P1-06）、无用户 Decision 路径。

## 基线

- P1-03 结束基线：commit `9722e14`（typecheck 0、44 files/395 tests、P1-03 双套件 15/15、集成 2/2、
  重启证据 1/1、validate-docs 12/12）。
- P1-04 共享基线：commit `004d325`（7 契约 + 2 接口冻结 + 入口/夹具/套件/重启骨架）；integrator
  场景修正 `775d00d`；四路 merge 与 integrator 裁决后 main 至 `5a278cb`（含用户裁决 A 后最终态）。
- 冻结语义清单：产品根 `IMPLEMENTATION-HANDOFF.md` "P1-04 契约与存储语义（冻结）"（14 条）。
- 两个最小 Interface 首次冻结（DAG interfaces_to_freeze）：`VerificationEngine.VerificationPort`、
  `ContextCompiler.ReviewContextPort`（TaskContextPort 冻结签名不改，ReviewContextPort 为版本化扩展）。

## Acceptance 逐项对照（8/8 满足）

| # | Acceptance | 证据 | 结果 |
| --- | --- | --- | --- |
| 1 | Worker 与 Reviewer 只能提交 claim/observation/verdict，不能直接写 `Task.phase` | evidence.contract.suite 全部提交路径只产生 EvidenceAdmitted/TaskReductionUpdated（proof: 事件类型清单）；integration T1 `taskDetail.phase === "pending"`（含 satisfied 后）；task-reducer.test.ts（无任何 phase 直写路径）；证据块 `workerCannotWriteTaskPhase: true` | ✅ |
| 2 | 每个 required VerificationRequirement 都有当前适用 PASS Evidence 时，目标 Task/Gate 才能 SATISFIED | evidence.contract.suite（FAIL→supersede→satisfied；verdict+static→satisfied）+ verification.contract.suite（implement/REVIEW/GATE 三种义务全齐才 satisfied；缺任意 required VR→blocked）+ 纯有效集表 + 证据块 implementEffectiveEvidenceIds=2 | ✅ |
| 3 | 静态或动态 FAIL 进入返工，缺失输入进入 BLOCKED，当前 binding 过期时显示 STALE | evidence.contract.suite（FAIL→failed（返工）；exit0/claim 无 PASS→blocked；STALE evidence→reduction 仍 satisfied 且视图 binding applicability=STALE）+ reducer-table（crashed→failed；outcome_unknown→非 satisfied；deferred→verifying）+ task-reducer.test.ts 11 表 | ✅ |
| 4 | revision 改变只重新计算 EvidenceBinding applicability，不修改历史 Evidence | evidence.contract.suite #8（workspaceRevision2 证据→视图 STALE；跨任务覆盖证据→视图 OUT_OF_SCOPE；两者 history load 不变；证据快照 revision 恒 1）+ 纯 evidenceApplicability 表（三态） | ✅ |
| 5 | 新 PASS 可以进入当前 EffectiveEvidenceSet，旧 FAIL 仍可追溯 | evidence.contract.suite #7（FAIL 后 PASS→satisfied；effective=[ev-pass-1,ev-pass-2]；旧 FAIL load 仍 found/outcome=FAIL）+ reduction snapshot 记录 blocking/effective 两组 | ✅ |
| 6 | 普通语义变化使用有界 ReviewPacket；无语义变化只有命中版本化策略才快放 | verification.contract.suite（semantic→reviewer check=satisfactionPath review-packet；no-change 无策略→仍 review-packet；no-change+fastPathDiffClasses ["docs-only"]→no-change-fast-path）+ ReviewContext assemble 套件 2/2（材料上限/无 transcript/body-first/拒绝零写入）+ lane C 单测 4 | ✅ |
| 7 | 单个 `exit=0`、Worker 自报或 Reviewer verdict 都不能独立满足 Task/Gate | evidence.contract.suite #5（exit0→blocked；claim 中性→blocked）、#9（verdict alone→blocked；+packet-static→satisfied）、integration T2（exit0/verdict-only 双场景）+ 纯集合表（claim 不覆盖不阻断）；证据块 verdictAloneNotSatisfying | ✅ |
| 8 | Goal phase 在本票结束时仍由后续 Goal reducer 决定 | integration T1（Goal aggregate revision 保持 2=CreateGoal+applyPlan，无任何 phase/归约写入；goalView.activePlanRevision 不变）+ 本票无 Goal 聚合写入路径 + P1-05 独立票据 | ✅ |

## 命令（最终，产品根）

```text
pnpm typecheck                                          → PASS 0 errors
pnpm vitest run                                         → 55 files / 485 tests PASS（P1-00…03 395 零回归 + P1-04 90）
pnpm vitest run tests/integration/p1-04.contract-suite.inmemory.test.ts → 18 PASS（同套件定义）
pnpm vitest run tests/integration/p1-04.contract-suite.sqlite.test.ts   → 18 PASS（无调参；含 evidence/verification/ReviewContext 三套件）
pnpm vitest run tests/integration/p1-04.integration.test.ts             → 2 PASS（真实 SQLite：T1 全路径+8 项验收+重启逐字段一致；T2 不可独立满足）
pnpm vitest run tests/restart/evidence/p1-04-evidence.test.ts           → 1 PASS（P1-04-EVIDENCE JSON 块，可重复；探针自动启用）
node dev_docs/verification/validate-docs.mjs            → 12/12 PASS
```

## 四路实现记录（隔离 worktree → main 合并）

- Lane A（证据摄入 + reducer）：`p1-04-lane-a` → main；evidence-intake.ts（guard 1-6）+
  task-reducer.ts（纯 reduceTaskVerification + outcome_unknown 副作用映射裁决）；tests 20/20。
- Lane B（VerificationEngine）：`p1-04-lane-b` → main；verify()（canonical 解析→纯编译→仅 predicate
  检查→observations；绝不写 ledger）；tests 10/10。
- Lane C（ReviewContext+ReviewerPort）：`p1-04-lane-c` → main；两次派发无产出后由 integrator 接管
  实现（有界 ReviewPacket/body-first/全部拒绝码/零写入）；tests 4/4；双适配器套件 2/2。
- Lane D（ReadModel 投影+重启证据）：`p1-04-lane-d` → main；EvidenceAdmitted/TaskReductionUpdated
  双适配器投影 + taskVerification（重建等价/全键隔离/freshness/applicability 纯函数重算）；tests 16/16。

## P1-04-EVIDENCE（可重复：pnpm vitest run tests/restart/evidence/p1-04-evidence.test.ts）

```json
{
  "ticket": "P1-04",
  "path": "bootstrap -> install/activate -> CreateGoal -> applyPlan -> claim -> FakeRuntime events -> VerificationPlan -> claim/observation/verdict admission -> TaskReduction -> commit -> close -> reopen -> Evidence/Index/TaskReduction/verification view identical",
  "reduction": {
    "implementPhase": "satisfied",
    "implementEffectiveEvidenceIds": ["ev-rs-dynamic", "ev-rs-static"],
    "implementBlockingEvidenceIds": [],
    "reviewPhase": "satisfied",
    "gatePhase": "satisfied"
  },
  "evidenceCount": 6,
  "bindingApplicability": [
    { "id": "ev-rs-claim", "kind": "claim", "applicability": "APPLICABLE" },
    { "id": "ev-rs-static", "kind": "observation", "applicability": "APPLICABLE" },
    { "id": "ev-rs-dynamic", "kind": "observation", "applicability": "APPLICABLE" }
  ],
  "workerCannotWriteTaskPhase": true,
  "verdictAloneNotSatisfying": true,
  "restart": { "snapshotsMatch": true, "verificationViewRebuild": true, "observedCursorEqual": true },
  "eventTypes": ["ProjectBootstrapped","ProjectBootstrapped","WorkspaceBootstrapped","WorkspaceBootstrapped","CompletionPolicyInstalled","ArchitectureBaselineInstalled","CompletionPolicyActivated","ArchitectureBaselineActivated","GoalCreated","PlanRevisionAccepted","TaskClaimed","RunStarted","RunEventRecorded","RunEventRecorded","EvidenceAdmitted","EvidenceAdmitted","EvidenceAdmitted","TaskReductionUpdated","TaskClaimed","RunStarted","RunEventRecorded","RunEventRecorded","EvidenceAdmitted","EvidenceAdmitted","TaskReductionUpdated","EvidenceAdmitted","TaskReductionUpdated"]
}
```

## integrator 裁决记录（缺口统一修订）

1. `prepareP104Project` 需先 `advanceProjection()` 再 `planGraph`（Lane B/D 上报；主分支已修，
   lane worktree 未含——已同步）。
2. 证据默认幂等键 per-evidenceId 化（确定性、不碰撞）；re-reduce 使用独立幂等键（P1-00 纪律）。
3. claim/verdict 证据必须有来源 Run（validator 强制）；system/机械 observation 允许 runRef=null
   （Gate 系统静态检查）。
4. Cross-task coverage 在摄入期确定性拒绝（dangling_ref）——OUT_OF_SCOPE 运行时展示在 P1-04 无计划
   变更机制下不可达，由纯函数表与 reducer 表覆盖（P1-11 起计划变更可观测）。
5. run start 幂等键 per-run（runP104ClaimedRun 修复——此前二次 start 触发 dispatch-start
   idempotency_conflict，阻断所有双 run 场景）。
6. outcome_unknown 的 ended run 必须进 unreconciledSideEffects（绝不按 crash/exit 推断），且不再
   叠加 run_failed 信号；budget_exhausted/cancelled 为中性 INCONCLUSIVE（不满足但非返工信号）。
