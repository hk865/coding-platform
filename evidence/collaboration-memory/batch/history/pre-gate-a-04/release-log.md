# release-log（放票 / owner / 依赖快照 / Gate 与技术裁决）

本文件记录每一次实际放票决定所依据的源码快照与证据。不记录未发生的放票。

| 序号 | 时间 | 决定 | 依据 | 写入范围 | 结论 |
| --- | --- | --- | --- | --- | --- |
| R-00 | 实施开始 | 接受本批委托，按 PLAN §7 从 CM-1A-001 开工 | HANDOFF §1；用户直接委托 | 整批近期范围 | 开工 |
| R-01 | 实施开始 | CM-1A-001 为唯一在写票，单一 owner 贯通共享契约 | CM-1A-001 §4；PLAN §11 Gate A | 见 decision-log D01–D05 | 实施中 |
| R-02 | 实施开始 | 后续 1B/1C/M/I 票**暂不生成** | 需 CM-1A-001 的实际 seam 证据（PLAN §7.1） | — | 待证据 |
| R-03 | 第 1 工作段结束 | CM-1A-001 第 1 工作段（契约 + 账本层）交付，**不构成交验** | `CM1A-001-snap-01`：`tsc` 0 诊断、`check:architecture` 0 issue、官方 runner 全量 302 文件 / 1997 用例通过 | 15 个文件（4 新增 + 11 修改） | 继续实施：Control handler → Dispatch 路由 → Context 接入 → 协作测试 |
| R-04 | 第 2 工作段结束 | Control 受理面交付（12 handler + mailboxView + participation-end）；修掉第 1 工作段留下的真实缺陷（`participation-start` 形状与账本白名单不一致，改为专用校验器） | `tsc` 0 诊断、`check:architecture` 0 issue、`tests/coordination` 31 例通过、**全量 304 文件 / 2028 用例 0 失败** | 新增 3 文件 + 修改 9 文件 | 继续实施：Dispatch 路由 → Context 接材（第 3 工作段，已派发） |
| R-05 | 第 3 工作段开始 | 仍需 Gate A 的 seam 证据，因此**暂不放 M/I 票**；M06 已预起草为 `CM-M06-DRAFT.md`（`blocked_by: CM-1A-001`） | PLAN 第 7.1 节的箭头依赖 | — | 已由 R-06 接续 |
| R-06 | 第 3 工作段结束 | Dispatch 协作路由驱动（挂唯一 `drive` 收口）+ Context Delivery 接材交付；冻结快照上 `tsc` 0 / 边界 0 / `tests/coordination` 55 例 / 全量 **306 文件 2043 用例 0 失败** | `source-snapshot.json`（1211 源文件，`391d23a2…`） | 新增 4 文件 + 修改 21 文件 | **到达独立验收检查点**：`ACCEPTANCE-HANDOFF.md` 已写；源码写入停止（除验收缺陷） |
| R-07 | 第 3 工作段结束 | **Gate A 未成立、不放 M/I 票** | A08/A10 完全未覆盖、A06 账本侧证据缺失、A03 尾随不成立；这些是否属本票范围交独立验收判定 | — | 待验收结论 |

## Gate 结论

| Gate | 范围 | 状态 | 依据 |
| --- | --- | --- | --- |
| Gate A | 核心通信／调度（PLAN §11） | 未成立 | 等待 CM-1A-001 A01–A12 的独立验收结论 |
| Gate B | 小记忆与回应 | 未成立 | 未开始 |
| Gate C | 人的决定与协作反馈 | 未成立 | 未开始 |

## 技术裁决

| ID | 决定摘要 | 记录位置 |
| --- | --- | --- |
| D01 | Task outbox 原地演进，不建第二 Task authority | `CM-1A-001/implementation/CM1A-001-snap-01/decision-log.md` |
| D02 | wait 接续资格 = 条件满足 ∧ 前驱 Run 已公开结束（同事务 admission） | 同上 |
| D03 | ActorRef 增加 agent kind + exact agentPrincipal；Host 窄 Adapter | 同上 |
| D04 | 两类 intent 复用同一机械 claim/settle；四个可达终态 | 同上 |
| D05 | 不新增第二生产入口；共存清单登记 | 同上 |

| R-08 | 第 4 步 + B 收口 | 5 步计划第 1–4 步完成；B（调用证据）落地并修掉两处真缺陷（旁路失败改写已完成 Run、contextInputDigest 无复核点降级为已记录上限） | snap-03 指纹 2c3e61c2…（1225 源文件）**当场复算一致**；tsc rc=0；边界 0 issue；全量 **312 文件 / 2080 用例 rc=0**；与 snap-02 差异 0 新增/0 删除/12 变更 | 见 CM-1A-001/implementation/CM1A-001-snap-03/ | **到达独立验收检查点**；源码写入停止 |
| R-09 | 快照纪律 | **snap-01 与 snap-02 作废**（前者交出去后仍有写入导致指纹漂移；后者伪冻结） | 两次事故同因：写入未停止时冻结 | — | 新纪律：全停 → 生成 → 当场复算指纹比对 → tsc rc=0 → 验证 |
| R-10 | Gate 复核 | **Gate A 仍未成立** | A08 强杀注入未做、A10 完全未覆盖、A06 账本侧 contextInputDigest 无复核点、A03 持续尾随不成立 | — | **不放 M/I 票** |
