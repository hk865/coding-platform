# P1-11 Implementation Evidence（2026-09-07）

> 票：/dev_docs/planning/proposed/P1-foundation/tickets/11-goal-plan-change-revision.md
> 验收 commit：产品根 main **6d70494**（= 共享基线 d5a51ba + lane B 2512b93 + lane C merge + lane A merge + integrator 修复）
> 前置：P1-10 ✅（ee53869 窗口）、P1-02/04/05/07/08 冻结形状零改动（只版本化追加）。
> 有限授权（2026-09-06 连续窗口）：完成本票并推进下一票；Ticket 状态保持 proposed（由开发流程依据 Evidence 更新）。

## 1. 验收映射（Acceptance / verification ↔ 验证 + 实测数字）

| Accept/verification | 验证（命令/测试） | 实测 |
| --- | --- | --- |
| 变更影响分析：受影响工作 Context/旧假设/待刷新材料；刷新登记后继续；独立工作可继续 | contract-suite affected-context-refresh-test + plan-change-view-test + integration InMemory/SQLite | PASS（impact.affectedWorks(refreshRequired=true)+staleAssumptions+materialsToRefresh+independentWork） |
| 只受影响子图暂停；不受影响 Task 继续；控制台展示保留/取消/替代/重验/恢复 | affected-subgraph-selection-tests（computeTaskDispositions 纯函数 + view.dispositions） | PASS（4 source tasks 全覆盖；task-verify reverify；其余 keep） |
| Proposal/Patch 绑定 source Goal/Plan/Workspace/Baseline/Policy revision + in/out-of-scope | proposal-bound-test + revision-cas-tests | PASS |
| Planner/HumanCollab 不能直接激活；reject/未授权不改变 active revision | decision-authority-tests + tests/control/goal-change.test.ts（reject/unauthorized 零写） | PASS（15/15 lane A 单测） |
| accepted Decision 的 subject/outcome/actor/authority/authorizedTarget 匹配后 CAS 创建并激活 | revision-cas-tests + goal-change.test.ts（decision_target_mismatch 零写） | PASS |
| 被替代 revision 与历史 FAIL 保留；Evidence 经新 binding 重算 applicability | evidence-applicability-recompute-test：P1-04 纯函数对新 anchor → OUT_OF_SCOPE；source plan load 仍 found | PASS |
| 新 revision required 集合重过 P1-02/P1-05 guards | guards-failed（空义务）零写 + 复用 applyPlanGuardIssues | PASS |
| 控制台显示哪些 Task 保留/取消/替代/重验/恢复执行 | plan-change-view-test + affected-subgraph-selection-tests | PASS |
| versioned-planning-interface-contract-tests | versioned-planning-interface-contract-tests（schemaVersion=1 冻结 + 编译器零写） | PASS |
| bounded-planning-context-tests | bounded-planning-context-tests（预算/缺口/越权三态） | PASS |

## 2. 命令与实测数字（产品根，commit 6d70494）

| 命令 | 结果 |
| --- | --- |
| pnpm typecheck | PASS 0 errors |
| pnpm vitest run（全量） | **145 文件 / 1025 tests PASS（0 skip）**——P1-11 探针组激活后全部真实执行 |
| 双适配器同套件（p1-11.contract-suite.inmemory + sqlite） | **10/10 + 10/10 PASS**（同一 defineGoalChangeContractSuite，无调参） |
| p1-11.integration.test.ts | **2/2 PASS**（真实 SQLite 全路径 + InMemory/SQLite 视图一致） |
| p1-11-restart.test.ts | **1/1 PASS**（close→reopen 同 DB 文件：view JSON/observedCursor/goal revision 逐字段一致） |
| p1-11-evidence.test.ts | **1/1 PASS**（P1-11-EVIDENCE JSON 块，evidence/p1-11-evidence.json） |
| validate-docs.mjs（doc 根） | **13/13 PASS** |

## 3. 实现与裁决记录

- **共享基线**（integrator，d5a51ba）：契约/纯函数（planProposalDigest/decisionTargetFor/computeTaskDispositions/draftConsistencyIssues）、
  PlanRevisionSupersededEvent（apply fold = PlanRevisionAccepted → PlanRevisionSuperseded → GoalRevisionRecorded 三事件）、
  HumanCollaboration.GoalChangePort（amend/decide/applyChange）、ReadModelIndex.planChangeView、3 个 commitKind + 校验器、
  goal-change-fixtures（3 个 fold 构建器）、harness/suite/restart/integration 骨架。基线全量 965 PASS + 24 skip 零回归。
- **Lane A（control，d28559f，15 单测）**：GoalChangeEngineImpl 完整守卫链（形状→proposal→decision→accept→target→draft→source_stale→
  P1-02 guards→原子 fold）；fold-equality 测试通过。**裁决**：apply 重放 vs source_stale 顺序冲突 → 在 source_stale 分支内以
  causationId+同命令关联事件日志重建原 receipt（replayed=true 同 eventIds/cursor，读零写）——验收含"重放→committed/replayed"。
- **Lane B（compilers，3f3109a，12 单测）**：PlanCompilerImpl（有界 proposal/impact，零写）+ PlanningContextCompilerImpl（委托
  ContextCompiler 预算/缺口/越权）。**裁决**：freshnessCursor=null 接受（端口允许）；add-delta affectedWorks 克隆启发式接受；
  未知 workspace→invalid_request 接受。
- **Lane C（projection，6587051，9 单测）**：in-memory + sqlite 双适配器投影（4 行存储/表；applyP111 4 分支；
  isHandledEventType 4 事件同 commit；planChangeView 组装 dispositions（computeTaskDispositions，任一侧快照缺失→[]））。
- **integrator 修复（6d70494）**：① P111_WORKSPACE "ws-p111"→"ws-shared"（声明字段与 canonical goal workspace 一致，避免 P1-15 消费者坑；
  引擎存在性锚点=goal 链——冻结语义）；② 契约套件 skipIf 死锁（内层 it.skipIf 收集期求值导致 beforeAll 永不执行）→
  改为 wiring 层 READY 门控 + beforeAll 无条件执行（P1-09 模式）；③ 探针诊断已回退（静默 catch）。

## 4. 边界（本票不做）

- 委托策略路径（P0-06 注释：需单独明确契约后同步）；
- P1-14/15 的验证决定闭环/主动上报；task 集合变更（P1-11 冻结为不可变）；
- 不改 ArchitectureBaseline/CompletionPolicy 任何形状；无 dispatch outbox/TaskAttempt/Run 副作用。

## 5. 状态

- P1-11 **VERIFIED**（本证据 + 全量数字）。Ticket 状态保持 proposed，由开发流程依据 Evidence 更新。
- Gate 更新：**G4（P1-09 + P1-11）成立候选**——P1-09 已验收（2c01536）、P1-11 本次验收（6d70494）；G4 成立记录见 HANDOFF/后续 gate 证据。
- 本运行继续推进下一票（P1-13 或按 DAG）；GitHub 推送仍需用户授权。
