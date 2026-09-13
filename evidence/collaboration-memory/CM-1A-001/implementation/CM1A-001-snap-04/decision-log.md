# CM1A-001-snap-04 实施决定

输入：用户批准的 CM-1A-001-FOLLOWUP-PLAN 第 1–5 步；采用 snap-03（1225 文件，2c3e61c237d5dd398d9a33370b916a08847354450992b08d6d734925e3f944db）。唯一源码 owner：当前 Codex。此前 D01–D06 保留于 snap-01/snap-03；下述决定取代其被指出的实现降级，不改变产品范围。

| 决定 | 本轮收口与理由 | 真实消费者/验证 |
| --- | --- | --- |
| D07 Work 与参与关系 | Work 原子维护 currentParticipationRef；AgentInstance active slot 唯一；历史 Wait 保留旧参与记录，Control 用当前参与关系和 RoleBinding 的权限交集重新准入。后继永久消费 admittedWorkRef，不按 goal/task 再解析 | handoff-successor、participation-uniqueness、host-tool-chain 的 task/coordination 两种 Work |
| D08 输入与逐请求许可 | RuntimeInputBound 固定实际 Context 输入和 manifest 摘要；每次最终 ModelClient.stream 前复核 exact Run、当前授权、Delivery/grant/source pins，提交 authorized 和 attempted。请求摘要在 ModelBudget 修改 maxTokens 后计算。一次性许可不能复用 | model-request-evidence-bypass、delivery-into-input |
| D09 运行代际 | start 先创建授权 generation，execution_entered 是调用 Runtime 前的第二次 CAS。只有从未 entered 的授权可原子撤销并安排同一 Attempt/Run/outbox 的退避；旧进程不能越过代际 fence | process-recovery 的双进程竞争、late begin 和 no-effect retry |
| D10 unknown 正式对账 | ReconcileRun 不接收调用方自称的证明；Control 从已注入 RuntimeObservationPort 读真实持久 journal，匹配 exact Run/sequence/terminal 后收敛 done/cancelled；无充分证明则 canonical quarantine。普通 runFact 的 after_terminal 拒绝不放宽 | process-recovery 的外部计数已写/回执丢失、late completed/cancelled |
| D11 通信 intent 对账 | Control 正式命令把 unknown 或副作用已开始且过期的 intent 收敛 quarantine，保留原领取 owner/generation/domain。当前通信操作没有外部远端回执，不能声称可对账为业务成功；本地页事务可依据 canonical 回执幂等恢复 | route-continuity、route-drive 跨进程 late settle |
| D12 路由与公平 | 源事件和固定 active subscription scope 在同一事务登记；历史 catchup 固定 horizon 并逐页推进，完成后再接 live。公平按持久事件顺序/最近进展选择，避免固定时钟导致饥饿；扫描和并发有有限上界 | route-continuity 的 burst、多 topic、订阅并发、取消末订阅、maxIntents=1 轮换 |
| D13 admission 领取归属 | 若 wait_admission intent 已存在，后继提交必须携带 exact intentClaim（revision/consumer/generation）且未过期；Control 与两类 Ledger 复核当前领取。无 intent 的正式直接准入同时 CAS 检查确定性 intent 不存在 | handoff-successor stale/missing claim 反例 |
| D14 兼容与职责 | 纯折叠规则放 contracts，Control 是正式业务入口，Ledger 做事务级重算与 CAS；Runtime 只调用宿主窄端口。ordinary 使用唯一 outbox drive；Query/Reviewer/Handoff 完整迁移仍属 M 票 | migration-inventory.md、Interface、全量回归 |
| D15 证据基线 | 用历史逐文件索引+准备 patch 还原 1200 文件，含混合行尾；整体哈希必须等于准备基线才能生成 patch。本轮完整保存 1241 文件原始字节，避免下次只有哈希没有内容 | preparation-reconstruction.json、source-files/、baseline-to-delivery.patch |

取消：本票路径先写 desired state，再调用 Runtime.cancel；已完成结果不被旁路失败改写。provider attempted 表示正式尝试许可已消费；不把计量、runtime_completed 或本地观察冒充远端 provider ack。

参数属于机械调度配置：ordinary 并发默认 2、最大 32；重试 1 秒指数退避、最大 60 秒、5 次后隔离；协作页默认上界见契约常量，事件扫描最多 200×1000 项，截断报告 incomplete。不自行增加用户累计 token、调用数或时长预算。

历史边界：snap-03 的首次调用许可与 contextInputDigest 降级已撤销；已同步参与唯一性、持续路由与驱动预算的过时注释，当前协议见正式 Interface、PROTOCOL-CONSTRAINTS §4.11–4.14 与上述消费者。snap-01/02 的伪冻结和指纹事故记录不删除。
