# P1-15 Implementation Evidence（2026-09-07）

> 票：/dev_docs/planning/proposed/P1-foundation/tickets/15-human-role-collaboration.md
> 验收 main：（P1-15 最终合并 main）；全量 **174 files / 1193 tests PASS（0 skip）**。
> 前置：P1-03/06/07/09/14/17 ✅（全部真实路径）；P0-06 复核：本票为已存在能力的纵向整合（不重实现内核/通用 DSL 无限自主规划）。

## 1. 验收映射（Acceptance / verification ↔ 验证 + 实测）

| 组 | 验证 | 实测 |
| --- | --- | --- |
| cross-package-conflict-before-test-failure | 需求歧义 + ≥2 实质差别选项 | PASS |
| decision-feedback-context-refresh-test | 决定绑定精确 proposal digest/option | PASS |
| authorized-change-notification-test | accept 决定呈现；reject/defer 只记录不激活 | PASS |
| completed-work-semantic-continuation-test | P1-17 完成后继承（旧前提识别） | PASS |
| initial-design-decision-test | authority 形状 + proposal revision 绑定 | PASS |
| bounded-role-rework-loop-test | 有界协调预算（显式安装策略） | PASS |
| policy-authority-and-budget-test | 策略预算 maxAutonomousReworks=1；**恰一次返工**；第二次被拒+可见未解项 | PASS |
| unified-view-freshness-test | unified status facts-first ready + stale 标记 | PASS |
| coordinator-rollover-test | 命令幂等重放；rollover 事实保留（bind/link/continuation took_over） | PASS |
| 验收 81-94（角色协作闭环/处理拒绝延后/验证内契约变更上报/完成继承/真实任务集成） | 角色回流链 + 模型 e2e | PASS |

## 2. 命令与实测数字（产品根）

| 命令 | 结果 |
| --- | --- |
| pnpm typecheck | PASS 0 errors |
| pnpm vitest run --testTimeout=30000（全量） | **174 files / 1193 tests PASS（0 skip，0 fail）** |
| lane A 20 / B 8 / C 2（含角色回流链 + 真实内核模型 e2e） | 全过 |
| p1-15 双适配器同套件 | 9 + 9 PASS |
| p1-15.integration / restart / evidence | 1 + 1 + 1 PASS（真实 SQLite close/reopen） |
| P1-15-MODEL-E2E-EVIDENCE | sessionDbBytes>0、closeReopen:true（真实 coding-agent CLI + fixture 模型端点 = 能力降级证据） |
| validate-docs.mjs（doc 根） | 13/13 PASS |

## 3. 实现与裁决记录

- 基线 5a5b085：human-role-collaboration 契约（design/decision/coordination policy/unified status view + 3 冻结端口）+ 4 commitKind + validators + fixtures/harness/套件/restart 骨架。
- Lane A（d5600ac，20 单测）：4 处理器全守卫链；**整合修复**：coordination activate validator 按 P1-02 语义解耦（Project CAS shape-only + active@snap-1）——原 validator 使首激活不可能（真实 blocker，由 A 报告→integrator 修复）。
- Lane B（fe795dd，8 单测）：unifiedStatusView 双适配器（facts-first；policy/activation→kind baseline；行级 stale=false；workspace/project 双作用域隔离）。
- Lane C（d13d717→7ae1fbe：角色回流链 + 真实内核模型 e2e；**follow-up 切真实引擎路径** + assertUnifiedStatusReady）。
- 裁决：① dict 决定绑定精确 digest；② policy install 不自动激活；③ budget 由已安装策略承载；④ e2e 用本地 SSE fixture（能力降级证据，同 P1-16 模式）；⑤ 预算用尽=可见未解项（协调者守约，非引擎级拒绝——本票验收语义）。

## 4. 状态

- P1-15 **VERIFIED**——**P1-foundation 全部 17 票（P1-00..P1-17 全量切片）验收完成**；G1/G2/G3（07+15）/G4/G5 全部 PASS（G3 证据：g3-gate-evidence.md）。
- 剩余：MVP 评议（dev_docs/verification/mvp-review.md）；GitHub 推送仍需用户授权；Remote origin/main 仍为 P1-08（本地 main 全量在本地）。
