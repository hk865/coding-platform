“OK”按条目及其“书面核对改正”一起判断；不可达行按 R4 删除，当前拒绝行为保留为 A6，不因缺少现成夹具继续阻塞。依据：`.lead-ref/books/t-book.md:22`、`.lead-ref/books/t-w1-findings.md:27`、`.lead-ref/books/t-w1r1-findings.md:13`。

| 编号 | 状态 | 现在的位置 | 说明（CHANGED 写新的动作） |
|---|---|---|---|
| T1-001 | OK | `tests/helpers/S2C-X-scale-fixture.ts:501` | 仍是七个类型出口；按书面改正删除，并清理仅供出口使用的导入。 |
| T1-002 | OK | `tests/scenarios/K3-37-stopped-review-round.test.ts:298`；`tests/scenarios/K3-45-review-incomplete-r2.test.ts:233` | 仍删除第三例；先将暂停期间不产生第二轮的断言迁入目标恢复之前。 |
| T1-003 | CHANGED | `tests/work-graph/A2-control-service.test.ts:320`；`tests/helpers/task-claim-fixture.ts:361`；`tests/helpers/S2B-runtime-steps-fixture.ts:319` | 治理前置已公开化（`tests/helpers/task-claim-fixture.ts:245`）；新动作：补真实 Session 创建，entered 分支用共享真实 Runtime 门控，再分别公开 pause/cancel Goal；保留拒绝及公开读不变断言。 |
| T1-004 | OK | `tests/work-graph/A2-control-service.test.ts:290`；`tests/app/A2-continuation-projection.test.ts:109` | 书面改正仍适用；真实 cancel 的当前位置是后者，先保存结果并补 queued 断言，再删原例。 |
| T1-005 | OK | `tests/work-graph/A2-control-service.test.ts:262`；`tests/scenarios/A7-control.test.ts:488` | 先在真实等待控制场景补 controlState 断言，再删手造 yielded 前置。 |
| T1-006 | DONE | `tests/work-graph/A2-gate-chain-facts.test.ts:213`；`src/core/work-graph/state/verification-machine.ts:913` | 旧的无链根用例已删除；当前后续是 FIX 路径，不能按旧行号继续删。 |
| T1-007 | OK | `tests/work-graph/A2-gate-chain-facts.test.ts:267` | 异 subject/ref 篡改用例仍在，删除动作不变。 |
| T1-008 | OK | `tests/work-graph/B2-11-expansion-levels.test.ts:162`；`tests/work-graph/B2-11-script-expansion.test.ts:155` | 合并仍需保留源例的 sha 断言。 |
| T1-009 | OK | `tests/work-graph/B2-11-script-expansion.test.ts:241`；`tests/work-graph/B2-11-expansion-levels.test.ts:105` | 按改正与 010 同批，最终保留 script-expansion。 |
| T1-010 | OK | `tests/work-graph/B2-11-expansion-levels.test.ts:60`；`tests/work-graph/B2-11-expansion-levels.test.ts:147` | 五组输入及全部断言迁完再删文件；包括 maxFiles=1。 |
| T1-011 | OK | `tests/work-graph/B2-11-script-expansion.test.ts:190`；`tests/work-graph/B2-17-disposition-reads.test.ts:34` | 删除重复段、补目标覆盖的动作不变。 |
| T1-012 | OK | `tests/work-graph/B2-12-recognition.test.ts:52`；`tests/work-graph/B2-12-recognition-pure.test.ts:29` | 按改正抽纯共享夹具，并保留两个调用方的白名单调整。 |
| T1-013 | OK | `tests/work-graph/B2-execution-result.test.ts:24`；`tests/helpers/S2B-runtime-steps-fixture.ts:348` | 真实 prepare/start→entered 门控→链接→真实结束；重放实际请求，不能只换链接种子。 |
| T1-014 | OK | `tests/work-graph/C1-session-mailbox.test.ts:467`；`tests/work-graph/C1-session-mailbox.test.ts:336` | 删除释放 Lease 后篡改的整例；终态重放覆盖仍在。 |
| T1-015 | OK | `tests/work-graph/C1-session-mailbox.test.ts:355` | Lease 接续篡改段仍在，按原动作删除。 |
| T1-016 | OK | `tests/work-graph/K3-11-review-reasons.test.ts:113`；`tests/helpers/K3-proposal-round.ts:571` | 书面改正仍必要：真实核对轮、真实 manifest；单原因前置不能省略。 |
| T1-017 | OK | `tests/work-graph/K3-14-unknown-call-review-tool.test.ts:157`；`tests/work-graph/K3-14-unknown-call-review-tool.test.ts:310` | owner/adapter 重复仍在，合并动作不变。 |
| T1-018 | OK | `tests/work-graph/K3-14-unknown-call-review-tool.test.ts:72`；`tests/work-graph/K3-14-unknown-call-review-tool.test.ts:292` | 按改正转换真实记录；alias 9 拒绝留服务层，仅非 process 分支迁纯测试。 |
| T1-019 | OK | `tests/work-graph/K3-15-disposition-effects.test.ts:230`；`tests/work-graph/K3-15-disposition-effects.test.ts:149` | 重复卡片分支仍可并入现有参数化例。 |
| T1-020 | OK | `tests/work-graph/K3-16-proposal-round-fixture.test.ts:121`；`tests/work-graph/K3-16-second-unfinished-proposal.test.ts:122` | 迁入首轮断言后删除重复例。 |
| T1-021 | OK | `tests/work-graph/K3-26-unknown-call-review-storage.test.ts:862`；`tests/work-graph/K3-47-reader-facts.test.ts:201` | 位置移动；完整 pending 投影断言迁入目标，损坏解码段删除。 |
| T1-022 | OK | `tests/work-graph/K3-45-review-incomplete.test.ts:93`；`tests/scenarios/K3-45-review-incomplete-r2.test.ts:268` | 原始记录前置仍在；迁入真实第二轮场景后删旧文件。 |
| T1-023 | CHANGED | `tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:149`；`tests/helpers/S5-decision-fixture.ts:572`；`tests/helpers/S5-decision-fixture.ts:598` | 新动作：复用已公开化的 scope、治理、Goal/设置；只补剩余真实 Session/Run 前置，再以真实 prepare/核对请求测预算，display 从真实 manifest 读（`tests/helpers/S5-decision-fixture.ts:840`；`src/composition/create-platform.ts:737`）。 |
| T1-024 | OK | `tests/work-graph/R3b-material-applicability.test.ts:24`；`tests/work-graph/R3b-material-applicability.test.ts:87` | 按改正补公开治理、Plan、真实 Session；正文统一经真实 owner 上下文存入。 |
| T1-025 | BLOCK | `tests/work-graph/R3d-fixture.ts:79`；`tests/work-graph/R3a-goal-replay-boundaries.test.ts:54`；`src/core/work-graph/model/plan-contracts.ts:44` | scope 转换可做；必须保留的事件 ID/载荷断言仍只有 eventAt，queryGoal 没有等价事件输出，整项不能报完成。 |
| T1-026 | OK | `tests/work-graph/R3e-completion.test.ts:87`；`tests/composition/R3e-completion-platform.test.ts:67` | 按改正合并；completeGoal 不传 planRef（`src/core/work-graph/model/task-contracts.ts:78`）。 |
| T1-027 | DONE | `tests/work-graph/R3e-reverify.test.ts:442`；`tests/work-graph/R3e-reverify.test.ts:466` | 旧无链根重验例已删除；后续现存的是双重验例。 |
| T1-028 | OK | `tests/work-graph/R3g-role-spec.test.ts:346`；`tests/work-graph/R3g-role-spec.test.ts:381`；`tests/work-graph/R3g-role-spec.test.ts:506` | 指定三处篡改段仍在；只删这些段。 |
| T1-029 | OK | `tests/work-graph/R4b-session-boundaries.test.ts:192`；`tests/work-graph/R4b-session-boundaries.test.ts:238` | 按改正用真实 Session 创建及公开链接；不能直接登记 Session 事实。 |
| T1-030 | OK | `tests/work-graph/R4b-session-boundaries.test.ts:113` | 两类 role 均经真实 Session Runtime 创建，再按返回身份验证过滤。 |
| T1-031 | OK | `tests/work-graph/R4b-session-directory.test.ts:107`；`tests/work-graph/R4b-session-directory.test.ts:142` | createGoal 已是公开调用（同文件 `:114`）；保留它，转换剩余 scope、治理、Plan、Session 前置。 |
| T1-032 | OK | `tests/work-graph/R4c-execution-history-index.test.ts:788`；`tests/work-graph/R4c-execution-history-index.test.ts:956` | 两处篡改例仍在；删除后清理对应孤立 helper/import。 |
| T1-033 | OK | `tests/work-graph/S1-codecs-indexes.test.ts:255` | SV01 的 provenance 部分已不在；剩余 Message 默认值、brief digest 段仍按原删除动作处理。 |
| T1-034 | OK | `tests/work-graph/S1-codecs-indexes.test.ts:348` | SV03 旧 outbox 索引迁移段仍在，删除动作不变。 |
| T1-035 | DONE | `tests/work-graph/S1-provenance.test.ts:2`；`tests/work-graph/S1-provenance.test.ts:97` | 指定五例及旧前置已删除，当前只剩 SV14。 |
| T1-036 | OK | `tests/work-graph/S2B-r2-keyed-cap.test.ts:61`；`src/core/work-graph/views/activity-read-helpers.ts:182` | 按改正：缺记录明确抛 unavailable 并带 ref，不能只删 return null。 |
| T1-037 | OK | `tests/work-graph/S2C-lines-attention.test.ts:216`；`tests/work-graph/S2C-lines-tiers.test.ts:156` | 迁 own=standby 断言后删重复例。 |
| T1-038 | OK | `tests/work-graph/S2C-lines-failure.test.ts:173`；`tests/work-graph/S2C-lines-failure.test.ts:199` | 删除篡改例；RD8 固定转换为真实等待/回复及 A3 接续门控，保留 busy 断言。 |
| T1-039 | OK | `tests/work-graph/S2C-lines-scale.test.ts:146`；`tests/helpers/S2C-X-scale-fixture.ts:219` | 删除测量例及其专用计数包装，动作不变。 |
| T1-040 | CHANGED | `tests/work-graph/S2C-node-detail-anomalies.test.ts:97`；`tests/scenarios/S2C-K2-paused-archive.test.ts:46`；`tests/scenarios/S2C-K2-paused-archive.test.ts:91` | 解除整项 BLOCKED：沿真实 pause→重启→archive→另一 Session 接续路径产生锚点，扩至 101 个；成功页和游标原样委托，仅第二页注入失败，身份来自公开读。 |
| T1-041 | OK | `tests/work-graph/S2C-node-detail-executions.test.ts:34`；`tests/work-graph/S2C-node-detail-executions.test.ts:44` | 只删 notes 缺失断言，保留 execution 断言。 |
| T1-042 | OK | `tests/work-graph/S4A-note-history.test.ts:464`；`tests/work-graph/S4A-note-write.test.ts:481` | 重复例仍在，原合并动作适用。 |
| T1-043 | OK | `tests/work-graph/S4A-note-history.test.ts:493`；`tests/work-graph/S4A-note-write.test.ts:699` | 合并并保留 N06 标识。 |
| T1-044 | OK | `tests/work-graph/S4B-memory-anchor-not-found.test.ts:45`；`tests/work-graph/S4B-memory-not-found.test.ts:17` | 合入目标时保留 A2 身份和 candidates 断言。 |
| T1-045 | OK | `tests/work-graph/S4B-memory-version-lists.test.ts:81` | 旧 reason skip 仍在，按原动作删除。 |
| T1-046 | OK | `tests/work-graph/S4B-memory-version-lists.test.ts:102`；`tests/work-graph/S8A-catalog-version-time.test.ts:21` | 迁 newest reasonLabel 断言并保留 M10 标识。 |
| T1-047 | OK | `tests/work-graph/S4B-note-symbol-recheck.test.ts:73`；`tests/work-graph/S4B-note-anchor-status.test.ts:122` | 重复关系仍成立；src/a/x.ts 是夹具创建的临时文件（`tests/helpers/S4A-note-scope-fixture.ts:105`），不是 GONE。 |
| T1-048 | OK | `tests/work-graph/S4B-note-freshness.test.ts:54`；`tests/work-graph/S4B-note-budget-check.test.ts:127` | 合并时保留 listByAnchor 断言及 M05/M14 标识。 |
| T1-049 | OK | `tests/work-graph/S4C-note-protection.test.ts:257`；`tests/work-graph/S4C2-D-rows.test.ts:274` | 按改正固定参数化两组组合，不再留选择项。 |
| T1-050 | OK | `tests/work-graph/S4C-note-protection.test.ts:287`；`tests/work-graph/S4C-resolution-order.test.ts:79` | 完整迁 accepted-review、pending-reject 及状态不变断言。 |
| T1-051 | OK | `tests/work-graph/S4C-project-understanding.test.ts:40`；`tests/work-graph/S4C-project-understanding.test.ts:65` | 合入 PU02，保留 find 断言和 DS07 标识。 |
| T1-052 | OK | `tests/work-graph/S4C2-D-rows.test.ts:110`；`tests/work-graph/S4C2-D-rows.test.ts:114` | 只删尾部 supersede 重复段，pending options 保留。 |
| T1-053 | OK | `tests/work-graph/S4C2-U3.test.ts:47`；`tests/helpers/S4A-note-scope-fixture.ts:250` | 先换真实 Session，再用 B 的真实回执申请 A，保留拒绝及 A 公开读不变。 |
| T1-054 | CHANGED | `tests/work-graph/S4C2-goal-triggers.test.ts:116`；`src/core/work-graph/state/task-machine.ts:487`；`src/core/work-graph/state/task-machine.ts:1172` | 取消整项 BLOCKED：3a 改真实完成链，3c 改连续真实 Plan 采用，3d 改真实 requeue/archive 并保留互斥及 claimed 断言；3b/e/h 的不可达前置按 R4 删除，生产过滤保留（`src/core/work-graph/tasks/plan-readers.ts:1390`）。 |
| T1-055 | OK | `tests/work-graph/S4C2-project-set-shared.test.ts:197`；`tests/work-graph/S4C2-project-set-shared.test.ts:160` | 重复 query 例仍可合入 work 例。 |
| T1-056 | OK | `tests/work-graph/S5R2-queue-history.test.ts:141`；`tests/work-graph/S5R2-queue-history.test.ts:127` | 200 条例并入 201 条边界例，动作不变。 |
| T1-057 | OK | `tests/work-graph/S8A-L8-reminders-pure.test.ts:130`；`tests/work-graph/S8A-L8-reminders-pure.test.ts:171` | 删除指定四例；null catalog 等未指定纯例保留。 |
| T1-058 | OK | `tests/work-graph/S8A-file-layer.test.ts:103` | 原始 scope 前置仍在；改公开 bootstrap/register 并补 schemas。 |
| T1-059 | OK | `tests/work-graph/S8A-path-ownership-dedupe.test.ts:18`；`tests/work-graph/S4C-note-path-ownership.test.ts:44` | 删除 06b；保留身份去重例及现有公开路径归属覆盖。 |
| T1-060 | OK | `tests/work-graph/SP-memory-history-confirm.test.ts:82` | 第五版本 skip 仍在，原删除动作适用。 |
| T1-061 | CHANGED | `tests/work-graph/UCR-settle-review.test.ts:218`；`tests/work-graph/UCR-settle-review.test.ts:278`；`tests/work-graph/K3-06-mixed-kinds-owner.test.ts:6` | 转真实轮及 manifest；unknown 用真实 entered 核对 Run、Kernel 缺失故障和重启产生，保留 busy/公开读不变（`tests/scenarios/S2C-K-unknown-outcome.test.ts:48`）；不可达多 process 计数例按 R4 删除；真实长命令产生 truncated，manifest 仅注入失败，全部矩阵及双后端保留。 |
| T1-062 | CHANGED | `tests/work-graph/W1-future-plan.test.ts:276`；`tests/work-graph/W1-future-plan.test.ts:706`；`src/core/work-graph/tasks/plan-readers.ts:2065` | 真实 Runtime/检查/完成链转换照做；scenario9 保留真实 changed-run 拒绝，删除 Lease/Reduction 单独存在及未采用新增任务已有痕迹的不可达行；公开读+A3 验零写入。原始字节/事件断言子段仍待公开等价入口（同测试 `:443`、`:687`）。 |
| T1-063 | OK | `tests/work-graph/W1-future-plan.test.ts:417` | 损坏源定义段仍在，按原动作删除。 |
| T1-064 | OK | `tests/work-graph/W1-future-plan.test.ts:620`；`tests/work-graph/W1-future-plan.test.ts:600` | 删除坏源图集成段；前面的 codec 测试保留。 |
| T1-065 | CHANGED | `tests/work-graph/W1-future-plan.test.ts:669`；`tests/work-graph/W1-future-plan.test.ts:734`；`tests/work-graph/W1-future-plan.test.ts:717` | 删除篡改 helper/两例的动作保留；撤销以 runs-first、lease-before-reduction 作为覆盖的说明，它们随 062 删除；只引用真实 changed-run 的 A6 拒绝，不声称覆盖不可达优先级。 |
| T1-066 | OK | `tests/work-graph/W2-agent-whiteboard.test.ts:192`；`tests/helpers/W2-whiteboard-fixture.ts:175`；`tests/helpers/W2-whiteboard-fixture.ts:197` | 按改正先换两个真实 Run；T1 改四处，T3 改第五处后再删共享种子 helper。 |
| T1-067 | CHANGED | `tests/work-graph/WP2-context-extensions.test.ts:309`；`tests/helpers/S5-decision-fixture.ts:598`；`tests/helpers/S5-decision-fixture.ts:840` | 复用已公开化的 S5 scope/Goal；补剩余真实 Session 和 entered Run，再执行 100 次真实 propose，按返回 proposalId 排序并保留分页断言。 |
| T1-068 | BLOCK | `tests/work-graph/goal-independent.test.ts:63`；`tests/work-graph/goal-independent.test.ts:66`；`src/core/work-graph/model/plan-contracts.ts:44` | Goal 存在/revision 可换 queryGoal；事件类型、事件 ID 没有等价公开输出，该子段仍阻塞。 |
| T1-069 | OK | `tests/work-graph/material-readers.test.ts:20`；`tests/work-graph/material-readers.test.ts:74` | 按改正使用真实 owner/Session；期望由请求和时钟手算，仅动态身份引用公开返回值。 |
| T1-070 | OK | `tests/work-graph/unknown-call-review-list.test.ts:45`；`tests/work-graph/unknown-call-review-list.test.ts:165`；`tests/work-graph/unknown-call-review-list.test.ts:198` | 书面改正仍适用：真实状态路径、205 个公开任务、真实水位+A3 门控；不得伪造返回页。 |

```json
[
  {"id":"T1-001","status":"OK","where":"tests/helpers/S2C-X-scale-fixture.ts:501","note":"七个类型出口仍在，按书面改正删除。"},
  {"id":"T1-002","status":"OK","where":"tests/scenarios/K3-37-stopped-review-round.test.ts:298; tests/scenarios/K3-45-review-incomplete-r2.test.ts:233","note":"删除第三例前，迁入暂停期间不产生第二轮的断言。"},
  {"id":"T1-003","status":"CHANGED","where":"tests/work-graph/A2-control-service.test.ts:320; tests/helpers/task-claim-fixture.ts:245; tests/helpers/task-claim-fixture.ts:361; tests/helpers/S2B-runtime-steps-fixture.ts:319","note":"治理已公开化，Session 和 entered 前置仍需转换。","action":"补真实 Session 创建；entered 分支用真实 Runtime 门控；独立公开 pause/cancel Goal，保留拒绝及公开读不变。"},
  {"id":"T1-004","status":"OK","where":"tests/work-graph/A2-control-service.test.ts:290; tests/app/A2-continuation-projection.test.ts:109","note":"保存真实 cancel 结果并补 queued 断言，再删除原例；仅目标行号移动。"},
  {"id":"T1-005","status":"OK","where":"tests/work-graph/A2-control-service.test.ts:262; tests/scenarios/A7-control.test.ts:488","note":"先迁 controlState 断言，再删手造 yielded 前置。"},
  {"id":"T1-006","status":"DONE","where":"tests/work-graph/A2-gate-chain-facts.test.ts:213; src/core/work-graph/state/verification-machine.ts:913","note":"旧无链根用例已删除，不能按旧行号删除当前 FIX 路径。"},
  {"id":"T1-007","status":"OK","where":"tests/work-graph/A2-gate-chain-facts.test.ts:267","note":"异 subject/ref 篡改例仍在，删除动作不变。"},
  {"id":"T1-008","status":"OK","where":"tests/work-graph/B2-11-expansion-levels.test.ts:162; tests/work-graph/B2-11-script-expansion.test.ts:155","note":"合并时保留 sha 断言。"},
  {"id":"T1-009","status":"OK","where":"tests/work-graph/B2-11-script-expansion.test.ts:241; tests/work-graph/B2-11-expansion-levels.test.ts:105","note":"与 010 同批迁移，最终保留 script-expansion。"},
  {"id":"T1-010","status":"OK","where":"tests/work-graph/B2-11-expansion-levels.test.ts:60; tests/work-graph/B2-11-expansion-levels.test.ts:147","note":"包括 maxFiles=1 在内的五组输入和全部断言迁完再删文件。"},
  {"id":"T1-011","status":"OK","where":"tests/work-graph/B2-11-script-expansion.test.ts:190; tests/work-graph/B2-17-disposition-reads.test.ts:34","note":"删除重复段并补目标覆盖。"},
  {"id":"T1-012","status":"OK","where":"tests/work-graph/B2-12-recognition.test.ts:52; tests/work-graph/B2-12-recognition-pure.test.ts:29","note":"按书面改正抽纯共享夹具并调整白名单。"},
  {"id":"T1-013","status":"OK","where":"tests/work-graph/B2-execution-result.test.ts:24; tests/helpers/S2B-runtime-steps-fixture.ts:348","note":"真实 prepare/start、entered 门控、链接和结束；重放实际请求。"},
  {"id":"T1-014","status":"OK","where":"tests/work-graph/C1-session-mailbox.test.ts:467; tests/work-graph/C1-session-mailbox.test.ts:336","note":"删除释放 Lease 后篡改的整例，终态重放覆盖仍在。"},
  {"id":"T1-015","status":"OK","where":"tests/work-graph/C1-session-mailbox.test.ts:355","note":"Lease 接续篡改段仍在。"},
  {"id":"T1-016","status":"OK","where":"tests/work-graph/K3-11-review-reasons.test.ts:113; tests/helpers/K3-proposal-round.ts:571","note":"仍需真实核对轮和 manifest；单原因前置按书面改正。"},
  {"id":"T1-017","status":"OK","where":"tests/work-graph/K3-14-unknown-call-review-tool.test.ts:157; tests/work-graph/K3-14-unknown-call-review-tool.test.ts:310","note":"owner/adapter 重复仍在。"},
  {"id":"T1-018","status":"OK","where":"tests/work-graph/K3-14-unknown-call-review-tool.test.ts:72; tests/work-graph/K3-14-unknown-call-review-tool.test.ts:292","note":"真实记录转换；alias 9 拒绝留服务层，仅非 process 分支迁纯测试。"},
  {"id":"T1-019","status":"OK","where":"tests/work-graph/K3-15-disposition-effects.test.ts:230; tests/work-graph/K3-15-disposition-effects.test.ts:149","note":"并入现有参数化例。"},
  {"id":"T1-020","status":"OK","where":"tests/work-graph/K3-16-proposal-round-fixture.test.ts:121; tests/work-graph/K3-16-second-unfinished-proposal.test.ts:122","note":"迁首轮断言后删除重复例。"},
  {"id":"T1-021","status":"OK","where":"tests/work-graph/K3-26-unknown-call-review-storage.test.ts:862; tests/work-graph/K3-47-reader-facts.test.ts:201","note":"完整 pending 投影断言迁入目标，损坏解码段删除。"},
  {"id":"T1-022","status":"OK","where":"tests/work-graph/K3-45-review-incomplete.test.ts:93; tests/scenarios/K3-45-review-incomplete-r2.test.ts:268","note":"迁入真实第二轮场景后删旧文件。"},
  {"id":"T1-023","status":"CHANGED","where":"tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:149; tests/helpers/S5-decision-fixture.ts:572; tests/helpers/S5-decision-fixture.ts:598; tests/helpers/S5-decision-fixture.ts:840; src/composition/create-platform.ts:737","note":"S5 的 scope、治理、Goal/设置已公开化，Session/Run 前置及真实 display 仍未齐。","action":"复用已转换初始化，只补真实 Session/Run；以真实 prepare/核对请求测预算，display 从真实 manifest 读取。"},
  {"id":"T1-024","status":"OK","where":"tests/work-graph/R3b-material-applicability.test.ts:24; tests/work-graph/R3b-material-applicability.test.ts:87","note":"按改正补公开治理、Plan、真实 Session，正文经真实 owner 上下文存入。"},
  {"id":"T1-025","status":"BLOCK","where":"tests/work-graph/R3d-fixture.ts:79; tests/work-graph/R3a-goal-replay-boundaries.test.ts:54; src/core/work-graph/model/plan-contracts.ts:44","note":"scope 可转换；事件 ID/载荷断言仍缺等价公开读，整项不能完成。"},
  {"id":"T1-026","status":"OK","where":"tests/work-graph/R3e-completion.test.ts:87; tests/composition/R3e-completion-platform.test.ts:67; src/core/work-graph/model/task-contracts.ts:78","note":"按改正合并；completeGoal 不传 planRef。"},
  {"id":"T1-027","status":"DONE","where":"tests/work-graph/R3e-reverify.test.ts:442; tests/work-graph/R3e-reverify.test.ts:466","note":"旧无链根重验例已删除。"},
  {"id":"T1-028","status":"OK","where":"tests/work-graph/R3g-role-spec.test.ts:346; tests/work-graph/R3g-role-spec.test.ts:381; tests/work-graph/R3g-role-spec.test.ts:506","note":"指定三处篡改段仍在。"},
  {"id":"T1-029","status":"OK","where":"tests/work-graph/R4b-session-boundaries.test.ts:192; tests/work-graph/R4b-session-boundaries.test.ts:238","note":"使用真实 Session 创建及公开链接，不能直接登记事实。"},
  {"id":"T1-030","status":"OK","where":"tests/work-graph/R4b-session-boundaries.test.ts:113","note":"两类 role 经真实 Runtime 创建，按返回身份验证过滤。"},
  {"id":"T1-031","status":"OK","where":"tests/work-graph/R4b-session-directory.test.ts:107; tests/work-graph/R4b-session-directory.test.ts:114; tests/work-graph/R4b-session-directory.test.ts:142","note":"保留已有公开 createGoal，转换其余 scope、治理、Plan、Session。"},
  {"id":"T1-032","status":"OK","where":"tests/work-graph/R4c-execution-history-index.test.ts:788; tests/work-graph/R4c-execution-history-index.test.ts:956","note":"删除两处篡改例及孤立 helper/import。"},
  {"id":"T1-033","status":"OK","where":"tests/work-graph/S1-codecs-indexes.test.ts:255","note":"provenance 部分已不在；剩余 SV01 段仍按原动作删除。"},
  {"id":"T1-034","status":"OK","where":"tests/work-graph/S1-codecs-indexes.test.ts:348","note":"SV03 旧 outbox 索引迁移段仍在。"},
  {"id":"T1-035","status":"DONE","where":"tests/work-graph/S1-provenance.test.ts:2; tests/work-graph/S1-provenance.test.ts:97","note":"指定五例及旧前置已删除，当前只剩 SV14。"},
  {"id":"T1-036","status":"OK","where":"tests/work-graph/S2B-r2-keyed-cap.test.ts:61; src/core/work-graph/views/activity-read-helpers.ts:182","note":"缺记录明确抛 unavailable 并带 ref，不能仅删 return null。"},
  {"id":"T1-037","status":"OK","where":"tests/work-graph/S2C-lines-attention.test.ts:216; tests/work-graph/S2C-lines-tiers.test.ts:156","note":"迁 own=standby 断言后删重复例。"},
  {"id":"T1-038","status":"OK","where":"tests/work-graph/S2C-lines-failure.test.ts:173; tests/work-graph/S2C-lines-failure.test.ts:199","note":"删篡改例；RD8 用真实等待/回复和 A3 接续门控转换，保留 busy。"},
  {"id":"T1-039","status":"OK","where":"tests/work-graph/S2C-lines-scale.test.ts:146; tests/helpers/S2C-X-scale-fixture.ts:219","note":"删除测量例及专用计数包装。"},
  {"id":"T1-040","status":"CHANGED","where":"tests/work-graph/S2C-node-detail-anomalies.test.ts:97; tests/scenarios/S2C-K2-paused-archive.test.ts:46; tests/scenarios/S2C-K2-paused-archive.test.ts:66; tests/scenarios/S2C-K2-paused-archive.test.ts:91","note":"真实暂停、重启、归档和另一 Session 接续路径已有依据。","action":"解除整项 BLOCKED；沿真实路径产生 101 个锚点，身份来自公开读；成功页和游标原样委托，仅第二页注入失败。"},
  {"id":"T1-041","status":"OK","where":"tests/work-graph/S2C-node-detail-executions.test.ts:34; tests/work-graph/S2C-node-detail-executions.test.ts:44","note":"只删 notes 缺失断言，保留 execution 断言。"},
  {"id":"T1-042","status":"OK","where":"tests/work-graph/S4A-note-history.test.ts:464; tests/work-graph/S4A-note-write.test.ts:481","note":"原合并动作仍适用。"},
  {"id":"T1-043","status":"OK","where":"tests/work-graph/S4A-note-history.test.ts:493; tests/work-graph/S4A-note-write.test.ts:699","note":"合并并保留 N06 标识。"},
  {"id":"T1-044","status":"OK","where":"tests/work-graph/S4B-memory-anchor-not-found.test.ts:45; tests/work-graph/S4B-memory-not-found.test.ts:17","note":"合入目标时保留 A2 身份和 candidates 断言。"},
  {"id":"T1-045","status":"OK","where":"tests/work-graph/S4B-memory-version-lists.test.ts:81","note":"旧 reason skip 仍在。"},
  {"id":"T1-046","status":"OK","where":"tests/work-graph/S4B-memory-version-lists.test.ts:102; tests/work-graph/S8A-catalog-version-time.test.ts:21","note":"迁 newest reasonLabel 断言并保留 M10。"},
  {"id":"T1-047","status":"OK","where":"tests/work-graph/S4B-note-symbol-recheck.test.ts:73; tests/work-graph/S4B-note-anchor-status.test.ts:122; tests/helpers/S4A-note-scope-fixture.ts:105","note":"重复仍成立；src/a/x.ts 是临时夹具文件，不是 GONE。"},
  {"id":"T1-048","status":"OK","where":"tests/work-graph/S4B-note-freshness.test.ts:54; tests/work-graph/S4B-note-budget-check.test.ts:127","note":"保留 listByAnchor 断言及 M05/M14 标识。"},
  {"id":"T1-049","status":"OK","where":"tests/work-graph/S4C-note-protection.test.ts:257; tests/work-graph/S4C2-D-rows.test.ts:274","note":"按改正固定参数化两组组合。"},
  {"id":"T1-050","status":"OK","where":"tests/work-graph/S4C-note-protection.test.ts:287; tests/work-graph/S4C-resolution-order.test.ts:79","note":"完整迁 accepted-review、pending-reject 及状态不变断言。"},
  {"id":"T1-051","status":"OK","where":"tests/work-graph/S4C-project-understanding.test.ts:40; tests/work-graph/S4C-project-understanding.test.ts:65","note":"合入 PU02，保留 find 和 DS07。"},
  {"id":"T1-052","status":"OK","where":"tests/work-graph/S4C2-D-rows.test.ts:110; tests/work-graph/S4C2-D-rows.test.ts:114","note":"只删尾部 supersede 重复段，保留 pending options。"},
  {"id":"T1-053","status":"OK","where":"tests/work-graph/S4C2-U3.test.ts:47; tests/helpers/S4A-note-scope-fixture.ts:250","note":"真实 Session 前置后，用 B 的真实回执申请 A；检查拒绝及 A 公开读不变。"},
  {"id":"T1-054","status":"CHANGED","where":"tests/work-graph/S4C2-goal-triggers.test.ts:116; tests/work-graph/S4C2-goal-triggers.test.ts:129; tests/work-graph/S4C2-goal-triggers.test.ts:181; tests/work-graph/S4C2-goal-triggers.test.ts:190; src/core/work-graph/state/task-machine.ts:487; src/core/work-graph/state/task-machine.ts:1172; src/core/work-graph/tasks/plan-readers.ts:1390","note":"旧整项 BLOCKED 不再适用；部分行依赖不可达持久状态。","action":"3a 转真实完成链，3c 转连续真实 Plan 采用，3d 转真实 requeue/archive 并保留互斥和 claimed 断言；按 R4 删除 3b/e/h，保留生产过滤。"},
  {"id":"T1-055","status":"OK","where":"tests/work-graph/S4C2-project-set-shared.test.ts:197; tests/work-graph/S4C2-project-set-shared.test.ts:160","note":"重复 query 例并入 work 例。"},
  {"id":"T1-056","status":"OK","where":"tests/work-graph/S5R2-queue-history.test.ts:141; tests/work-graph/S5R2-queue-history.test.ts:127","note":"200 条例并入 201 条边界例。"},
  {"id":"T1-057","status":"OK","where":"tests/work-graph/S8A-L8-reminders-pure.test.ts:130; tests/work-graph/S8A-L8-reminders-pure.test.ts:171","note":"只删指定四例，保留未指定纯例。"},
  {"id":"T1-058","status":"OK","where":"tests/work-graph/S8A-file-layer.test.ts:103","note":"原始 scope 前置仍在，改公开 bootstrap/register 并补 schemas。"},
  {"id":"T1-059","status":"OK","where":"tests/work-graph/S8A-path-ownership-dedupe.test.ts:18; tests/work-graph/S4C-note-path-ownership.test.ts:44","note":"删除 06b，保留身份去重及公开路径归属覆盖。"},
  {"id":"T1-060","status":"OK","where":"tests/work-graph/SP-memory-history-confirm.test.ts:82","note":"第五版本 skip 仍在。"},
  {"id":"T1-061","status":"CHANGED","where":"tests/work-graph/UCR-settle-review.test.ts:218; tests/work-graph/UCR-settle-review.test.ts:245; tests/work-graph/UCR-settle-review.test.ts:264; tests/work-graph/UCR-settle-review.test.ts:278; tests/work-graph/K3-06-mixed-kinds-owner.test.ts:6; tests/scenarios/S2C-K-unknown-outcome.test.ts:48","note":"多 process 行不可达；unknown 有真实 Run 加 Kernel 缺失、重启的产生路径。","action":"转换真实核对轮和 manifest；真实 entered 核对 Run 经 Kernel 缺失故障及重启产生 unknown，保留 busy 和公开读不变；删除多 process 计数例；真实长命令产生 truncated，manifest 仅注入失败；保留全部矩阵和双后端。"},
  {"id":"T1-062","status":"CHANGED","where":"tests/work-graph/W1-future-plan.test.ts:276; tests/work-graph/W1-future-plan.test.ts:443; tests/work-graph/W1-future-plan.test.ts:687; tests/work-graph/W1-future-plan.test.ts:706; src/core/work-graph/tasks/plan-readers.ts:2065","note":"scenario9 不可达子例应删除，不再暂留；字节/事件断言子段仍缺公开等价入口。","action":"正常场景用真实 Runtime、检查和完成链；scenario9 留真实 changed-run 拒绝，删 Lease/Reduction 单独存在及未采用新增任务已有痕迹的行；用公开读和 A3 验零写入，保留字节/事件子段的阻塞记录。"},
  {"id":"T1-063","status":"OK","where":"tests/work-graph/W1-future-plan.test.ts:417","note":"损坏源定义段仍在。"},
  {"id":"T1-064","status":"OK","where":"tests/work-graph/W1-future-plan.test.ts:620; tests/work-graph/W1-future-plan.test.ts:600","note":"删坏源图集成段，保留 codec 测试。"},
  {"id":"T1-065","status":"CHANGED","where":"tests/work-graph/W1-future-plan.test.ts:669; tests/work-graph/W1-future-plan.test.ts:734; tests/work-graph/W1-future-plan.test.ts:717; tests/work-graph/W1-future-plan.test.ts:729; tests/work-graph/W1-future-plan.test.ts:706","note":"原点名覆盖中的两条优先级例也依赖不可达状态。","action":"仍删除篡改 helper 和两例；撤销 runs-first、lease-before-reduction 覆盖说明，它们随 062 删除；仅引用真实 changed-run 的 A6 拒绝，不声称覆盖不可达优先级。"},
  {"id":"T1-066","status":"OK","where":"tests/work-graph/W2-agent-whiteboard.test.ts:192; tests/helpers/W2-whiteboard-fixture.ts:175; tests/helpers/W2-whiteboard-fixture.ts:197","note":"先换两个真实 Run；T1 改四处，T3 改第五处后删共享种子 helper。"},
  {"id":"T1-067","status":"CHANGED","where":"tests/work-graph/WP2-context-extensions.test.ts:309; tests/helpers/S5-decision-fixture.ts:572; tests/helpers/S5-decision-fixture.ts:598; tests/helpers/S5-decision-fixture.ts:840","note":"S5 部分初始化已公开化，剩余 Session/entered 仍手造。","action":"复用公开 scope/Goal，补真实 Session 和 entered Run；执行 100 次真实 propose，按返回 proposalId 排序并保留分页断言。"},
  {"id":"T1-068","status":"BLOCK","where":"tests/work-graph/goal-independent.test.ts:63; tests/work-graph/goal-independent.test.ts:66; src/core/work-graph/model/plan-contracts.ts:44","note":"Goal 存在/revision 可换 queryGoal；事件类型和 ID 子段仍无等价公开输出。"},
  {"id":"T1-069","status":"OK","where":"tests/work-graph/material-readers.test.ts:20; tests/work-graph/material-readers.test.ts:74","note":"真实 owner/Session；期望由请求和时钟手算，只引用公开返回的动态身份。"},
  {"id":"T1-070","status":"OK","where":"tests/work-graph/unknown-call-review-list.test.ts:45; tests/work-graph/unknown-call-review-list.test.ts:165; tests/work-graph/unknown-call-review-list.test.ts:198","note":"按书面改正使用真实状态路径、205 个公开任务及真实水位+A3 门控。"}
]
```

OK 57，DONE 3，GONE 0，CHANGED 8，BLOCK 2，条目 70/70