# CM1A-001-snap-04：A01–A12 可核对证据

本表是实施侧用例映射，不是独立验收结论。最终运行结果见 verification.md。路径均相对产品根，故障注入使用隔离临时目录、真实 SQLite、产品 Control/Dispatch/Context/Runtime 和内置内核；模型响应使用明确标记的确定性替身。

| 项 | 当前用例与可观察断言 | 证据边界 |
| --- | --- | --- |
| A01 | control.test、control.sqlite、participation-uniqueness、handoff-successor：当前参与唯一、独立 SQLite 竞争、换手与 RoleBinding 权限交集、无资格保留 wait、错误 principal/版本零写入；host-tool-chain 分别验证 task Work 与独立 coordination Work 的同 Work 后继 | 单 Project/Workspace，未扩展账户或远端 Worker |
| A02 | control.test：正式请求/回应/订阅、replay 与异载荷拒绝、body-first；host-tool-chain：真实 Host 工具、exact digest/版本；material-isolation：三个真实 Work、正式路由与精确 grant、两个合法读取者与无权第三者、相同正文重放不串权及重开；coordination-capability：未授权内核拒绝且 handler/Vault/Control 不执行 | 测试真实工具路径，模型为确定性协议替身 |
| A03 | route-drive/route-continuity：3 订阅 pageSize=1、固定 scope/horizon、连续新事件、历史多 topic 到 live、源事务期间新订阅、末订阅取消、伪造正文/target/hasMore 零写入、page 前后进程退出恢复无重复 | 有限构造场景；超出扫描上限显式 incomplete，不宣称无限吞吐 |
| A04 | process-recovery：2 个独立 PID 竞争同一 SQLite/outbox，实际 provider 计数只有 1；old generation late begin 拒绝；route-drive 独立进程旧 generation late settle 不覆盖新结果；participation-uniqueness 独立连接 | 本地多进程，未做远端 broker |
| A05 | route-drive/handoff-successor：事件先/后 wait、前驱结束前不接续、结束后唯一后继、timeout/cancel、换手期间 CAS 冲突、stale/missing intentClaim 拒绝；host-tool-chain 重启后无需手工 prepare 后继 | 仅 all-wait；any-wait 由 M06 负责 |
| A06 | host-tool-chain 捕获实际 ModelRequest、精确 Delivery/manifest 与 nonce；delivery-into-input 比对 request/input digests、授权到 attempted 之间撤权；model-request-evidence-bypass 多请求独立 permit、伪造 digest/重复消费/请求间取消、真实 source permission 更新阻止第二请求 | 有 attempted，无真实远端 provider ack 或模型质量结论；实际内核保留 |
| A07 | route-continuity 的 Wait 取消真实生产者、desired-state-first 与中断恢复；process-recovery pending 取消重启不执行、执行中取消晚到 terminal 对账；model-request-evidence-bypass 请求间取消；real-runtime 慢模型取消；runtime-dispatch 已终态不降级 | unknown 只可隔离/对账，不假称取消成功 |
| A08 | process-recovery provider_effect 后进程直接退出，持久计数已写但本地回执缺失，重启 provider 计数不增加且可见 quarantine；未 entered 的授权原子撤销后同 Attempt 退避；late terminal completed/cancelled 正式对账 | 模拟外部效果为独立持久计数，非真实付费远端动作；journal 是本地执行观察，非远端 ack |
| A09 | process-recovery before_start/after_bind/after_authorize/after_attempt/provider_effect/after_terminal、claim 后未 wake、authorized 后未 begin；route-drive before_page/after_page；host-tool-chain SQLite+Runtime 重启 | child process 用 process.exit(86) 绕过清理模拟突然退出，未声称断电/内核崩溃或 SIGKILL 全矩阵 |
| A10 | runtime-concurrency：实际 Runtime/provider 两读重叠、两写仅一到 provider；route-continuity：availableAt 前不领、unknown 隔离、固定时间 maxIntents=1 轮换；route-drive 失败上限 quarantine；backlog oldest/reason 可查 | 有界有限公平样例，未做长期压测/SLA |
| A11 | migration-inventory.md 与普通调度、P1-07、Reviewer/Handoff/Rework/真实宿主回归；重试不新建领域 Attempt；replacement 在 ordinary Context 前跳过 | 完整入口迁移仍由 M01–M06 后续完成 |
| A12 | source-snapshot 的 1241 个逐文件哈希、完整 source-files、准备基线准确 patch、正式 Interface 与字段五问、当前构建/类型/边界/文档/全量日志 | 不把旧快照通过数迁移；无本票完整浏览器交互测试；独立验收尚未进行 |

## 原 R1–R8 的实施对应

R1 → RuntimeInputBound + 每次请求 authorized/attempted；R2 → 源事件同事务 intent + catchup/live；R3 → 已证实无副作用的持久退避与 quarantine；R4 → desired-state-first 真实生产者；R5 → 独立进程断点及正式 reconcile；R6 → 实际读并发/写排斥与 backlog；R7 → admission 固定 WorkRef，coordination Work 与 Task Work 分离样例；R8 → 四份直接受影响 Interface 与 PROTOCOL-CONSTRAINTS 同步。上述为实现和用例位置，关闭验收项须独立结论。

## 三处早期修复的反例

- participation-start：通用事件 schemaVersion/eventId/scope/identity 校验仍先执行，专用校验再检查事件顺序、Work/participation/snapshot/CAS 关联；恶意改变任一者均有拒绝断言。
- waitRef.workId：契约没有此字段，维持删除；Work 归属通过 canonical Wait/Work 快照核对，不从用户伪造字段授权。
- wait-register/route-page：CommunicationIntentRecorded 必须和相应 snapshot 同提交；current done 与可选 next pending intent 分别校验版本、确定性 ID、source cursor 和页边界；跨进程页前/后退出覆盖恢复。
