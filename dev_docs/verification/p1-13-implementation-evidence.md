# P1-13 Implementation Evidence（2026-09-07）

> 票：/dev_docs/planning/proposed/P1-foundation/tickets/13-allowlisted-remediation.md
> 验收 main：产品根 **（见下方命令记录；含 lane A/B/C 合并）**；全量 **154 files / 1083 tests PASS（0 skip）**。
> 前置：P1-12 ✅（finding/brief/proposal 消费）、P1-07 ✅（唯一 Writer lease 链复用）、P1-02/04/05/08 冻结形状零改动（第三 governance 类只走现有 commitKind union 扩展）。

## 1. 验收映射（Acceptance / verification ↔ 验证 + 实测）

| Accept/verification 组 | 验证 | 实测 |
| --- | --- | --- |
| evolution-policy-local-fixture-schema-and-digest-tests | schema/revision/identity/source + digest 确定性 | PASS |
| evolution-policy-install-roundtrip-test | install 持久化 digest/revision 精确、绝不自动激活（Activated 事件仅场景显式 1 次） | PASS |
| evolution-policy-activation-cas-test | 激活 CAS 建 per-kind active ref、ArchitectureBaseline active 不动 | PASS |
| allowlist-policy-guard-tests | evolutionPolicyDecision 纯判据：delta(reversible/medium/module)→allowed；report(material)→material 判据先触发拒绝 | PASS |
| active-evolution-policy-resolution-test | 只沿 canonical active ref 解析（三重匹配） | PASS |
| remediation-governance-revision-binding-test | patch 绑定 finding/workspace/evolution policy/plan baseline/completion pins | PASS |
| remediation-deduplication-test | 同键重放→replayed；终态不占键（冻结语义）→同键新任务允许 | PASS |
| exclusive-writer-lease-test | Writer 链（P1-07 conflict-scope lease → recordPatch → 新 workspace revision） | PASS（writer-chain 测试 3/3） |
| current-revision-verification-test | 修复后当前 revision + pinned policy 验证；resolved 守卫（证据/verified/PASS/revision ≥ patch） | PASS |
| 验收 10/11/12（Writer/Verification/FAIL 保留/基线不动） | remediation-writer-chain 测试（InMemory + 真实 SQLite reopen 逐字段一致 + 过期 PASS→evidence_mismatch gated 激活） | PASS |

## 2. 命令与实测数字（产品根）

| 命令 | 结果 |
| --- | --- |
| pnpm typecheck | PASS 0 errors |
| pnpm vitest run（全量） | **154 files / 1083 tests PASS（0 skip）** |
| p1-13 双适配器同套件（inmemory/sqlite） | 9/9 + 9/9 PASS |
| p1-13.integration.test.ts / restart / evidence | 1/1 + 1/1 + 1/1 PASS（真实 SQLite close→reopen 逐字段一致） |
| writer-chain（InMemory + SQLite reopen） | 2 + 1 PASS |
| validate-docs.mjs（doc 根） | 13/13 PASS |

## 3. 实现与裁决记录

- **共享基线**：contracts/architecture-evolution-policy.ts（第三 governance 类：fixture/content/allowlist 判据 evolutionPolicyDecision（纯）/ref/pin/snapshot/activeRef/命令/回执/事件/digest/fingerprints/resolve helpers）+ contracts/remediation.ts（patch/task/dedup key/命令/回执/3 事件/fingerprints/remediationTaskOccupiesDedupKey）；ledger 3 个新 commitKind + 双适配器 dispatch；events/KNOWN 版本化追加（含 P1-02 KNOWN 断言维护裁决——场景级隔离证据保留）；ControlEngine +5；validation.ts 3 个共享校验器（validatePin 增 evolution kind，修复 229a9e8）；harness/套件（9 组 verification）/restart/integration 骨架。
- **Lane A**（d507e48→5f1efce→0ab2cd2，13 单测）：install（digest 精确/不激活）与 activate（load 区分 not_found/digest_mismatch（与 P1-02 口径一致）+ per-kind active CAS）；ledger-validation 第三分支。复审修订：共享校验器接入 + strip 移除（共享面 validatePin 修复后）。
- **Lane B**（e8092b2 → 56e95f6，21 单测）：submitPlanPatch（verdict 引擎权威重算 + 绑定校验 + policy_unresolved/stale_finding/allowlist_rejected）、createTask（事件流 dedup 扫描 + 终态不占键）、advanceTask（迁移表 + resolved 守卫 evidence_mismatch）；修订：SeededLedger 移除 → 真实第三分支 validator 路径。
- **Lane C**（3000e8b，3 测试）：唯一 Writer（P1-07 lease）+ Verification 链集成（InMemory + 真实 SQLite reopen 一致 + 原 Delta 保留 + baseline active 不动）；"真实路径优先、fixture-fold 兜底"设计，lane A/B 落地后自动切真实路径。
- **integrator 裁决**：① activate digest mismatch → digest_mismatch（P1-02 对齐）；② pin 字段名统一 digest（P1-02 pin 形状）；③ 判据顺序 material/ambiguous 先于 deltaRef（允许报告型 finding 的 material 语义先拒绝）；④ 终态不占 dedup 键；⑤ 不采纳 currentWorkspaceRevision 新接口（ledger.load 可用）；⑥ 套件断言对齐（activated 计数/终态/理由顺序，a3641f0）。

## 4. 边界（本票不做）

- ArchitectureBaseline active ref 全程不动（验收 8）；不做 migration gate/baseline activation（P1-14）；不覆盖压缩次数/Token 开销/生命周期信号（设计复核重分配）；无 read-model 展示视图（事件仅注册防 stall）。

## 5. 状态

- P1-13 **VERIFIED**；Ticket 状态保持 proposed（由开发流程依据 Evidence 更新）。
- Gate：**G5（13+14）未成立**（等 P1-14）；G3（07+15）未成立；G1/G2/G4 PASS。
- 本运行继续推进下一票（P1-14 ← 11+12 均 ✅）；GitHub 推送仍需用户授权。
