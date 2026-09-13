# 整批近期范围 coverage

范围正文：PLAN §7 路线、§10.1 验收映射、§11 放票门槛。
本文件是**开发记录**（证据 → 票 → owner → 结论 → 剩余项），不是新增产品状态机。

- 批次负责人（实施统筹兼实施 owner）：本会话的 DSH Agent（单 owner 贯通第一条纵向路径）
- 产品根：`/mnt/d/1.project/Software/agent_platform`
- 文档根：`/mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform`
- 独立验收：由用户另交 Codex 执行；本文件不自行记录 PASS
- 采用基线：product `0eb02717d16412298c786166a75ca1a9d3e05ac7`（含既存未提交增量）；docs `e99484fb2bd3296a32d8442e74b47d8ed569b3d5`

## 图例

- 状态：`未开始` / `实施中` / `交付待验收` / `独立验收中` / `已验收` / `缺陷待修`
- 证据列指向本仓 `evidence/collaboration-memory/` 下的实际路径。

## 阶段 → 票 → 状态

| PLAN 阶段 | 阶段结果 | 正式票 | owner | 依赖快照／Gate | 当前状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| 阶段 0 | D01–D05 技术裁决 | CM-1A-001 | 本 session owner | 准备基线 | 已完成（设计裁决，未运行验证） | `CM-1A-001/implementation/CM1A-001-snap-01/decision-log.md` |
| 1A | A01–A12 | CM-1A-001 | 本 session owner | 无（不依赖未实施票） | **交付待独立验收（snap-03）**：5 步计划中第 1–4 步已完成、第 5 步未开始；`tsc` rc=0、边界 0 issue、全量 312 文件 / 2080 用例 rc=0；**A01–A12 无一项可标记通过**（A08 强杀注入与 A10 完全未覆盖） | `CM-1A-001/implementation/CM1A-001-snap-03/ACCEPTANCE-HANDOFF.md` |
| 1B | B01–B05 | 未生成（Gate A 后按证据细化） | — | 1A 的回应 Context／正式写入口 | 未开始 | — |
| 1C | C01–C04 | 未生成（Gate A 后按证据细化） | — | 1A 的 Delivery／版本／接续 | 未开始 | — |
| 入口迁移 M | M01–M06 | 未生成（Gate A 后按依赖制票） | — | Gate A 的共享 primitive 证据 | 未开始；**制票依据已就绪** | `batch/entry-migration-inventory.md` |
| 整批集成 I | I01–I04 | 未生成（B/C/M 有实际结果后） | — | 最终集成快照 | 未开始 | — |

**未生成后续票 ≠ N/A 或延期。** PLAN §10.1 的全部近期项仍在本批范围内。

## PLAN §10.1 近期项覆盖索引

| PLAN 要求 | 责任落点 | 本批当前证据 | 剩余 |
| --- | --- | --- | --- |
| V01 | 1A A02–A03；M06 | 待 1A 交付 | I01/I02 真实共享来源与权限隔离 |
| V02 | 1A A02–A03；M06 | 待 1A 交付 | 生产入口顺序、取消、迟到／重放不漏投 |
| V03 | 1A A03–A09；C03；M01–M05 | 待 1A 交付 | I02 跨入口恢复 |
| V04 | 1A A05/A07/A09（仅 all/timeout/cancel）；M06 负责 any | 待 1A 交付 | any-wait 与剩余时序组合 |
| V05 | 1A A04/A10；M01/M05/M06 | 待 1A 交付 | 正式 app 并行、公平、积压可观察 |
| V06 | 1A A01/A11；C01/C04；M01–M04 | 待 1A 交付 | I01 主 Agent 语义协调 |
| V07 | 后续第二领域 | 不在本批 | 不得宣称跨领域已验证 |
| V08 | B01/B05 | 未开始 | 明确维护 + 增量局部经验 |
| V09 | 1A 来源使用；I02 回归 | 待 1A 交付 | 本地规范 currentness 不退化 |
| V10 | I01/I02 既有人工 Skill 边界回归 | 未开始 | 不要求自动生成链 |
| V11 | B03 | 未开始 | 同 Task 下一相关回话 |
| V12 | B01/B04；C03/C04；M06 | 未开始 | I01/I03 浏览器检查 |
| V13 | B/C/M 合流至 I01 | 未开始 | 同一场景完整链 |
| V14 | 每票受影响验证；I02/I03 | 进行中（1A：`tsc` 0 诊断、边界 0 issue、官方 runner 全量 302/1997 通过；构建与真实模型未跑） | 当前集成快照全量回归 |
| V15 | 每票追溯；I04 收口 | 未开始（1A 未同步 Interface 文档） | 最新纠正与延期归类无遗漏 |
| V16 | 每票独立审阅；I02/I04 | 未开始 | 跨票审阅 |
| V17 | B04 三个消费者 | 未开始 | I01 验接话／解释／反馈 |
| V18 | B03/B04；C04；I01 | 未开始 | 同 Task 纠正与重启 |
| V19 | B05；C04；I01 | 未开始 | 局部习惯影响下一次协作 |
| V20 | C01–C04；I01/I02 | 未开始 | 四种决定与全影响集 |
| V21 | B02；I01 | 未开始 | 单用户两项目 |
| V22 | B01/B05；I04 | 未开始 | 固定上游版本与适配验证 |

## 待用户转交的检查点

| 检查点 | 状态 | 交接内容 |
| --- | --- | --- |
| **CM-1A-001 独立验收（snap-03）** | **待你转交 Codex** | 入口：`CM-1A-001/implementation/CM1A-001-snap-03/ACCEPTANCE-HANDOFF.md`（三项入口、可复算快照与指纹、已归档验证、A01–A12 逐项现状与未覆盖、四件重点复核项、内核改动登记、剩余项 R-1/R-2/R-5/R-5b/R-8、快照作废记录）。**snap-01 与 snap-02 已作废** |
| M01/M02/M05 的三个入口取舍 | **待裁决**（技术取舍，不影响继续推进） | 见 `batch/entry-migration-inventory.md` §7：① `driveParallel` 接生产后与 ordinary drive 是否共存；② desired-state 取消是否新增生产 HTTP 入口；③ in-memory 与 persistent 宿主在 Query drive 实例生命周期上的差异是否算生产语义分叉 |
| 待用户裁决的基线问题 | **待裁决** | 工作树有 25 个文件的改动既不在准备基线内、也不属于本次工作段（mtime 早于基线采集但基线未记录）；见 `CM-1A-001/implementation/CM1A-001-snap-01/verification.md` §4.3 |
