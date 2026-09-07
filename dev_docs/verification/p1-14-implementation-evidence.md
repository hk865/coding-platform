# P1-14 Implementation Evidence（2026-09-07）

> 票：/dev_docs/planning/proposed/P1-foundation/tickets/14-baseline-activation.md
> 验收 main：（下一条提交即 P1-14 验收；见命令记录）；全量 **164 files / 1142 tests PASS（0 skip）**。
> 前置：P1-11 ✅（authority path 存在性证据）、P1-12 ✅（proposal/finding/brief 消费）、P1-02 ✅（baseline install/activate 机制复用）。

## 1. 验收映射（Acceptance / verification ↔ 验证 + 实测）

| 组 | 验证 | 实测 |
| --- | --- | --- |
| architecture-notification-idempotency-test | 各命令重放 → committed/replayed 同 eventIds/cursor | PASS |
| candidate-materialization-digest-test | 候选 digest == proposal.expectedCandidateDigest（内容寻址）且 source pin 精确 | PASS |
| stale-source-baseline-rebase-required-test | isSourceStale 纯判定；源移动 → 重提案（不激活） | PASS |
| decision-target-matching-tests | decision subject/authorizedTarget 精确匹配候选与 from ref | PASS |
| migration-gate-tests | gate 绑定候选+当前 workspace revision；PASS 需证据 | PASS |
| activation-cas-race-test | activation 记录精确 from/to pins + proposal/decision/gate 引用；链一致性纯函数 | PASS |
| existing-plan-pinning-test | 既有 Plan 保持 pinned baseline（pin 独立于 default 移动） | PASS |
| versioned-baseline-evolution-interface-contract-tests | 3 个冻结端口 versioned（schemaVersion 1） | PASS |
| migration-gate-port-contract-tests | chain consistency 纯函数 + port pass/fail/stale 语义 | PASS |
| 验收 96-106（物化前置/决策精确/Gate 不隐式 rebase/CAS/STALE/不可变/不重写/视图） | 引擎守卫链 + 双套件 + restart + 视图 | PASS |

## 2. 命令与实测数字（产品根）

| 命令 | 结果 |
| --- | --- |
| pnpm typecheck | PASS 0 errors |
| pnpm vitest run --testTimeout=30000（全量） | **164 files / 1142 tests PASS（0 skip）** |
| lane A 引擎单测 | 18/18；lane B 端口 12/12；lane C 视图 8/8 |
| p1-14 双适配器同套件（inmemory/sqlite） | 9 + 9 PASS |
| p1-14.integration / restart / evidence | 1 + 1 + 1 PASS（真实 SQLite close→reopen 逐字段一致） |
| validate-docs.mjs（doc 根） | 13/13 PASS |

## 3. 实现与裁决记录

- **共享基线 7f35a2e**：baseline-evolution 契约（5 聚合 + 4 事件/命令/回执 + 纯函数 + 3 冻结端口 + 视图）+ 4 commitKind + validators + 双适配器 + fixtures/stub/harness/套件/restart/integration 骨架 + **sqlite P1-13 handled-registration 补全**。
- **Lane A（848f091，18 单测）**：materialize（proposal 加载/source 精确/digest 重算）+ decision（candidate 存在/target 精确）+ gate（candidate/workspace revision 匹配）+ activation（decision accept/gate pass/链一致/源精确）——全部零写；fold-equality。
- **Lane B（3ddc5b5，12 单测）**：MigrationGatePortImpl（只读判定 pass/fail/stale + 确定性 gate/evidence 派生）+ BaselineEvolutionPortImpl（只读物化）。
- **Lane C（112cf46，8 单测）**：baselineChangeView 双适配器（4 行存储/表 + stale 标记 + notRebasedPlans 简并语义）。
- **integrator 裁决**：① gate.planRef 必填；② 候选聚合身份=命令 aggregateId（内容寻址仅作为 digest 字段——candidateId 统一裁决方案 B）；③ gate 默认 workspaceRevision 对齐 bootstrap 世界（1）；④ 视图 defaultPin=最新 activation.toPin（无激活→candidate.parentSourcePin）；⑤ notRebasedPlans 简并；⑥ gate 证据为确定性引用（真实证据链归集成）。

## 4. 边界

- 实际 Project 默认 baseline **ref 移动**由集成链经 P1-02 activate 执行（本票记录编排事实并守卫）；不重写旧 FAIL/Finding/Decision/Evidence；STALE 绝不激活；无隐式 rebase。

## 5. 状态

- P1-14 **VERIFIED**；Ticket 状态保持 proposed。
- **G5（13+14）成立**（P1-13 fbc365e + P1-14 本次验收）——G5 证据：dev_docs/verification/g5-gate-evidence.md。
- 剩余：P1-15（最后），G3（07+15），MVP 评议。
