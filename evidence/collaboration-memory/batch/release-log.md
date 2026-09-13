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

## 2026-09-13 当前决定（替代上方历史当前状态）

| 序号 | 决定 | 依据 | 当前结果 |
| --- | --- | --- | --- |
| R-11 | 接受snap-04为当前1A交验输入 | 1241文件，f930c3efb08d9d665117ddbc974f406a09e7d98efc2f24563ef3a78f709e4a81；最终315/2113通过，类型/边界/构建/文档通过；完整原始基线patch回放一致 | A08/A10等旧缺口已在实施侧补齐，逐项以snap-04 coverage为准 |
| R-12 | 统筹内部提交Gate A独立验收 | MAIN-AGENT-PROMPT §3/§5要求另一Agent；用户本轮要求先提交Gate并继续 | gate_a_independent只写独立acceptance目录；源码及既有输入冻结；独立结论待返回，不要求用户转交 |
| R-13 | 继续整批，调查1B并细化票 | PLAN阶段1B仅依赖正式写入口与回应seam，不等完整通信 | /root唯一实现owner；memory_seam只读调查；M按实际Gate范围释放 |
| R-14 | 采用用户集中回归节奏 | 用户本轮明确要求 | 集中实现/审查/文档/文件清单，阶段内定向测试及必要类型/边界；全部计划修改收口后冻结并集中全量。全量失败集中修复，是否再全量按影响和交付要求决定 |

当前Gate A=独立验收中，B/C=未成立；整批未完成。snap-04既有全量与源码由独立Agent核实后复用，本次仅Gate提交不机械重复全量。上方R-00至R-10为历史记录，其待用户转交、旧缺口与旧owner不再描述当前状态。Git提交/推送未获授权且未执行。

## R-15：Gate A成立并放行CM-M06-001

2026-09-13。独立Agent gate_a_independent完成A01–A12逐项PASS，未发现可复现产品缺陷。结论输入为snap-04/f930c3ef…，独立111例与增强输入witness2例通过；复用同源码全量315/2113。报告：../CM-1A-001/acceptance/CM1A-001-snap-04/gate-a-01/acceptance.md。

Gate A的实际范围为1A工程primitive（Work/principal/request/Delivery、route/CAS/all-wait唯一后继、取消/unknown恢复、实际输入逐请求许可与有限并发），不包含any、完整迁移、记忆/决定产品效果。当前开发流程据独立证据接纳CM-1A-001；M06新增语义独立验证。

正式释放CM-M06-001，/root为唯一实现owner，先完成any报告接续、有限重放剩余边界、持久通信展示，再继续就绪1B及其余M/C/I。源码冻结结束；新修改形成新快照，不把snap-04 PASS自动延伸。继续执行R-14集中回归纪律；未Git提交/推送。

## R-16：M06独立通过，继续1B

2026-09-13。gate_a_independent对CMM06-001-snap-01的M06-A–E独立PASS，1253文件fb3be7f46cf471269427f1f1e2ece8651f8b185ac2408618fc56740309991d96。冻结全量318文件2145例、四项检查、650构建文件核对通过；无开放阻断缺陷。报告见../CM-M06-001/acceptance/CMM06-001-snap-01/gate-m06-01/acceptance.md。

统筹据此接纳M06并结束冻结，正式推进CM-1B-001；唯一源码owner仍为/root。准备裁决和上游固定源码在../CM-1B-001/preparation。仍按R-14集中实现与回归纪律，不commit/push；1B/1C/M01–M05/I01–I04仍待完成。

## R-17：Gate B成立，继续1C

2026-09-13。独立gate_a_independent对CM1B-001-snap-01的B01–B05判定PASS，无开放阻断缺陷。1270源码文件ba2841a9f018b2c3a22cd2d87eb40ae71a06e7eb0ba27e37121b9b24116d1eea，结束复算一致；全量322文件2156例通过；类型/边界/UI类型/build均0，文档13/13；658构建文件独立逐项核对一致。正式报告见../CM-1B-001/acceptance/CM1B-001-snap-01/gate-b-01/acceptance.md。

统筹据此接纳CM-1B-001并结束源码冻结，释放CM-1C-001。/root继续唯一实现owner，以上述快照作为新输入，先处理四种人的架构决定及全部影响Work回流。Gate B只放行明确小记忆、真实输入刷新/维护界面及公开经验路径，不扩大为完整画像、任意语义冲突识别、图像链路或整批通过。用户项目只读样例与候选分别记录，不修改其源码。继续R-14验证节奏，未Git提交/推送。
