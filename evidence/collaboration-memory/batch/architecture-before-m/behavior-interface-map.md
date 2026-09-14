# M 准备：行为、责任与接口映射

依据 2026-09-14 用户确认的结构原则、PLAN M01–M05，输入为 C snap02；本表区分实际入口和迁移目标，不宣称迁移已完成。正式状态仅由 Control/Ledger 决定，ModuleDependencyDAG 仍有效。

| 行为/触发者 | 当前调用链与责任 | 对外接口/调用方所需知识 | 持久权威及重复/恢复 | 迁移目标和验证 |
| --- | --- | --- | --- | --- |
| 人工普通执行：HTTP/操作员 | service → OperatorTaskDispatch → Control claim → RuntimeDispatch → ordinary drive | 人提供目标、范围和请求身份；Operator 隐藏规格/角色绑定/claim，Dispatch 隐藏启动及事实消费 | TaskAttempt/Run/outbox、执行许可及 workspace lease；只有 fresh start/entry 可执行 | M01，同一 ordinary owner，实际两只读并行/写冲突/重复触发 |
| 已接受计划：规划推进 | InitialPlanning → PlannedTaskDispatch → claim/launch → RuntimeDispatch | 只消费正式 active PlanRevision 与既定授权；调用方不自己重算 readiness | PlanRevision/Task/Run/outbox；重启扫描已接受分工 | M01/M04，受理后丢失 wake 仍可执行，旧版本不派发 |
| 旧显式并行入口 | WorkspaceDriveEngineImpl 再实现 assemble/start/consume；两个 harness 分别构造 ordinary 与 parallel | 现有 driveParallel(projectId,goalId,maxIntents) | 与 ordinary 同一 outbox/Run，必须共享唯一启动原语 | M01，旧入口转同一实例的有界 ordinary 选择，不保留另一套生命周期；scope 在 limit 前过滤 |
| 通信/架构决定回流 | service.advanceArchitecture → h.drive → CoordinationDrive + ordinary successors | Host 仅发 wake，决定/Wait/Delivery 资格留在正式模块 | CommunicationIntent/Wait/Delivery/Run inputBinding/permit | M01/M05，收敛唤醒，不复制调度权；回归 C 四分支 |
| Query/只读回应/执行反馈 | service → QueryJobDrive → ReadOnlyQueryRuntime；Query Context/来源独立 | 保留 QueryJob/QueryRun、轮次、来源和只读权限 | QueryJob/Run/Answer 与持久 Runtime 观测；running 不盲重跑 | M02，结果对账或 quarantine，writer 并行、来源失效/B 回应 |
| 独立 Reviewer | service.launchReview → ReviewerDispatch → Control/Runtime → output bind | 独立资格、精确 input/output 是 Reviewer Interface | ReviewWork/Run/材料授权/独立报告绑定 | M03，复用事实消费，不混同普通完成；重复/撤权/未知恢复 |
| Handoff/替代执行 | Control recordHandoff/claimReplacement → HandoffDrive | 旧 Run 与 ReplacementAttempt 资格保持；Host 消费者需补查 | HandoffPacket/ReplacementAttempt/Task lease/Run | M03，旧消费者与 ordinary 不抢同一工作；真实 Host/取消/恢复 |
| Rework | Verification 事实 → service.triggerRework → ReworkDrive → PlanRevision → planning wake | 组合根传公开材料；Verification 不导入 Dispatch | 原问题/处置/正式 PlanRevision；queue 不能保存唯一待办 | M04，重复/受理后 wake 前中断恢复，旧 source pin 回归 |
| 取消与启动恢复 | Operator.cancel/控制入口、RuntimeDispatch.recover、Reviewer recover、多个 Host queue | 对外区分请求取消、确认取消、unsupported、unknown | desired state 先持久化；Runtime 回执不能由 abort 请求代替 | M05，逐入口 scan + event/timer wake；进程退出和并发触发反例 |

跨模块入口不是要求一个总服务，也不以架构流程箭头作为导入许可。内部 helper 仅在隐藏真实规则或步骤时抽取；内部变化不得迫使外部调用者重排工作步骤。Control 的准入和 Ledger 同事务最终复核都保留。
