# P1-03 Implementation Evidence — Eligible Task → Fake Run View

```yaml
status: implementation verified (limited authorization, 2026-09-05 — P1-03 only)
updated: 2026-09-05
ticket: P1-03
limited_authorization: true
next: STOP after P1-03 — do NOT auto-start P1-04 (DAG: 04 验收后才出现 05/06 并行窗口)
```

## 状态

P1-03 共享基线 + 四路并行（Lane A/B/C/D 隔离 worktree → main 合并）全部落地；最终
`pnpm typecheck` 0 errors；`pnpm vitest run` **44 files / 395 tests PASS**（既有 P1-00/01/02
283 项零回归 + P1-03 新增 112 项）；P1-03 契约套件 InMemory 15/15、SQLite 15/15（**同一套件定义，
无调参**）；真实 SQLite 集成 2/2；重启证据 1/1；`validate-docs` 12/12。

## 基线

- P1-02 结束基线：commit `bafb0f1`（typecheck 0、29 files/283 tests、validate-docs 12/12）。
- P1-03 共享基线：commit `27359e1`（= `cec6b57` + TaskContextRequest.declaredPermissions）；套件细化 `c986d2d`；lane 合并与 integrator 裁决后 main 至 `<final>`。
- 冻结语义清单：产品根 `IMPLEMENTATION-HANDOFF.md` "P1-03 契约与存储语义（冻结）"。
- 四个最小 Interface 首次冻结：ArtifactPort / DispatchPort / TaskContextPort / RunPort（wire 字段以本票为准）。

## Acceptance 逐项对照（8/8 满足）

| # | Acceptance | 证据 | 结果 |
| --- | --- | --- | --- |
| 1 | 只有 DAG 硬依赖满足 + active + 无 Blocker + 资源可用的 Task 才 eligible | `evaluateTaskEligibility` 纯函数 + dispatch.contract.suite readiness 表（eligible / deps_unsatisfied / blocked / deferred / gate_kind / not_found）+ tests/control/dispatch-readiness.test.ts | ✅ |
| 2 | 两个 Dispatcher 竞争同一 Task 最多一个 lease/Attempt 成功 | dispatch.contract.suite competing-claim（TaskLease CAS@0）+ integration T2（真实 SQLite Promise.all 并发：1 committed / 1 revision_conflict / 恰 1 个 TaskClaimed 事件） | ✅ |
| 3 | dispatch intent 先持久化到 outbox，之后才调用 Fake Runtime | dispatch-drive.test.ts（runtime.start 调用瞬间 outbox 已是 started）+ 实现顺序（pending intents → assemble → startRun commit → 才 runtime.start）+ integration T1（真实 drive 全路径） | ✅ |
| 4 | TaskEnvelope 绑定 WorkspaceSnapshot revision/权限/预算/来源 + 硬上限 + 无完整 transcript | context-compiler.test.ts 12 项（ready 全字段 / stale_workspace / forbidden ⊄ declared / budget / needs_material / 64KiB cap / body-first）+ artifact-vault.test.ts 13 项 + 证据块 envelopeBounded/envelopeHasTranscript | ✅ |
| 5 | 重复、乱序和迟到 RuntimeEvent 不会回退 Task 或 Run revision | run.contract.suite（duplicate/invalid-seq0/conflict 零写入 + NEWER-then-OLDER：晚到旧事件 after_terminal、Run 保持 seq3/exitCode 0）+ tests/control/run-facts.test.ts（不回退断言） | ✅ |
| 6 | crash 与 outcome_unknown 分开投影，不能猜成成功 | run.contract.suite crash-vs-unknown（双项目）→ crashed ≠ outcome_unknown；RunOutcomeUnknown 为显式 fact；两投影均 ended 且 phase=pending | ✅ |
| 7 | ActiveAgents 与 TaskDetail 可从事件重建 | run.contract.suite rebuild 用例 + tests/read-model|sqlite-read-model/p1-03-run-projection.test.ts（双 Adapter 同断言 + 全新实例/新文件重放逐字段一致）+ 重启证据 agentRebuild/taskDetailRebuild | ✅ |
| 8 | Runtime exit 或 exit=0 不会直接写 Task.phase=satisfied | run.contract.suite（exit=0 → outcome completed/exitCode 0、phase 保持 pending）+ integration T1（phase pending）+ 证据块 afterTerminalTaskPhaseNotSatisfied=true | ✅ |

## 命令（最终，产品根）

```text
pnpm typecheck                                          → PASS 0 errors
pnpm vitest run                                         → 44 files / 395 tests PASS
pnpm vitest run tests/integration/p1-03.contract-suite.inmemory.test.ts → 15 PASS（同套件定义）
pnpm vitest run tests/integration/p1-03.contract-suite.sqlite.test.ts   → 15 PASS（无调参）
pnpm vitest run tests/integration/p1-03.integration.test.ts             → 2 PASS（真实 SQLite：drive 全路径 + 竞争领取）
pnpm vitest run tests/restart/evidence/p1-03-evidence.test.ts           → 1 PASS（P1-03-EVIDENCE JSON 块，可重复）
node dev_docs/verification/validate-docs.mjs            → 12/12 PASS
```

## P1-03-EVIDENCE（可重复：pnpm vitest run tests/restart/evidence/p1-03-evidence.test.ts）

```json
{
  "ticket": "P1-03",
  "path": "bootstrap -> install/activate -> CreateGoal -> applyPlan -> claim -> start -> FakeRuntime events -> commit -> close -> reopen -> outbox/lease/Attempt/Run/ActiveAgents/TaskDetail identical",
  "run": { "runId": "run-p103-0001", "status": "ended", "outcome": "completed", "lastEventSeq": 2, "exitCode": 0, "envelopeBounded": true, "envelopeHasTranscript": false },
  "outbox": { "status": "done", "pendingAfterTerminal": true, "intentTaskId": "task-run-adaptor", "bindingVersion": 1 },
  "lease": { "holderRunId": "run-p103-0001", "revision": 1 },
  "attempt": { "status": "ended", "endOutcome": "completed" },
  "views": { "activeAgentOutcome": "completed", "taskDetailPhase": "pending", "taskDetailRunOutcome": "completed" },
  "afterTerminalTaskPhaseNotSatisfied": true,
  "restart": { "observedCursorEqual": true, "snapshotsMatch": true, "agentRebuild": true, "taskDetailRebuild": true },
  "eventTypes": ["ProjectBootstrapped","ProjectBootstrapped","WorkspaceBootstrapped","WorkspaceBootstrapped","CompletionPolicyInstalled","ArchitectureBaselineInstalled","CompletionPolicyActivated","ArchitectureBaselineActivated","GoalCreated","PlanRevisionAccepted","TaskClaimed","RunStarted","RunEventRecorded","RunEventRecorded"]
}
```

## integrator 裁决记录（lane 上报缺口的统一修订）

1. validateTaskContextRequest 增加 planRef/runRef/attemptRef + 交叉对齐校验（Lane C 缺口 1，已修订）。
2. tokenBudget>=1 在命令/请求校验层强制（invalid_request）；budget_exhausted 语义用于 runtime 事件与 deadline（缺口 2 已裁决）。
3. 内容寻址/首次 put 胜出 + open 授权只认 RunRef owner（缺口 3/4 已文档冻结）。
4. RunFactV1.outcome_unknown 增加 `runRef`（Lane B 缺口 1 已修订，消除事件日志扫描）；stale 语义 = 合法序列严格低于 lastEventSeq，seq0 为 malformed（invalid），乱序不回归由 "newer-then-older" 用例覆盖（缺口 2 已裁决）。
5. DISPATCH_PLAN_REVISION_FIXTURE_V1 补齐 task-blocked 的 required obligation 映射（Lane D 上报，修复后通过 P1-02 applyPlan 守卫）。
6. readiness gate 用例期望改为累计全部原因 [task_kind_not_work, deps_unsatisfied]（Lane A 上报，已修订）。
7. run-fact 的 Run revision 折叠 = expectedRevision+1（fixture fold target 已同步，Lane A/B 交叉依赖确认一致）。

## P1-07 补充审查注记（追加，不改原验收记录）

P1-07 复核发现并修复（见 p1-07-implementation-evidence.md §4①）：本票 eligibility 的 depends_on 满足原按 plan 快照 phase 判定，而 plan 快照为声明值、满足唯一写者是 P1-04 TaskReduction——带依赖 work task 原本不可 claim；现由 dispatch-facts.loadLivePlan 在 readiness/claim 以 TaskReduction live phase 覆盖（签名不变）。本行仅作语义来源登记，原 8 项 Acceptance 结论不受影响。
