# 共同实现、旧消费者与迁移归属

2026-09-23。依据[总架构](../ARCHITECTURE.md)。本表取代“同一事实天然跨4–7个模块”的旧切分；完整旧表见[快照](../archive/2026-09-23-before-core-design/modules/ownership-map.md)。

## 1. 唯一职责与复用

| 能力 | 目标owner | 旧实现/消费者如何处理 |
| --- | --- | --- |
| 业务推进与Session选择 | Workflow | 规划／人机／验证流程消费同一组核心操作，不各自推导身份与材料 |
| 正式任务与架构状态、占用、完成条件 | WorkGraph | Control的合法性／归约、Index的解释与查询同处内部；存储提交仍保留原子版本核对 |
| 图捕获与源码关系 | WorkspaceTools | 同次分析服务完整图和展示分页；捕获验证不移除；适用性由实际调用方核对 |
| 图来源绑定、差分和候选 | WorkGraph | SourceGraphContextCompiler／Reconciler重组，普通观测不依赖模型Run |
| Session目录与关联 | WorkGraph | 新增明确SessionRef到Kernel映射，沿用旧Run/Task/AgentInstance引用兼容 |
| Session创建／继续／压缩／恢复、原日志读取 | AgentRuntime | 调Kernel公开能力；WorkGraph只受理和记录结果；查询日志不建立Run |
| 消息与协作 | WorkGraph | 复用CoordinationIssue/Message等记录、收件箱索引，不把通信作为DAG阻塞 |
| 材料解析、引用定位、来源和有界返回 | WorkGraph | 原Context普通数据读取；Kernel原日志通过AgentRuntime读取，不构成反向依赖 |
| 内容事务、正文、索引物理持久 | RecordStore | Ledger/Vault/SQLite索引复用；授权与业务判据在WorkGraph，数据库条件仍在提交时检查 |
| 路径与来源政策 | WorkspaceTools | 统一安全路径/拒绝前缀能力；用途特有限制保留；不反向调用Store |

## 2. 旧模块逐项移交

| 编号 | 旧模块 | 复用／移动 | 重写／删除 | 退出条件 |
| --- | --- | --- | --- | --- |
| M01 | HumanCollaboration | 请求身份、决定版本、应用结果语义→Workflow | 纯转发大门面按消费者消除 | Host既有路由接新应用端口且行为兼容 |
| M02 | PlanCompiler | 规范化与流程→Workflow；候选/采用→WorkGraph | 业务流程里重复构造正式状态 | 初始、人工、反馈、返工来源全迁移 |
| M03 | ControlEngine | 合法性、占用、完成规则→WorkGraph各结构 | 巨大总门面和重复资格计算 | 所有旧command消费者迁移；合法并发/失败一致 |
| M04 | DispatchEngine | 准入顺序、outbox、回收和恢复→AgentRuntime | 多入口重复驱动、每次新Session/全量准备默认 | 普通/Reviewer/Handoff真实入口统一 |
| M05 | VerificationEngine | 流程→Workflow；覆盖/来源→WorkGraph；执行→AgentRuntime | 多处计算同一完成结论、重复审核门禁 | 完整/缺失/过期/中断轮次和独立审阅通过 |
| M06 | ArchitectureReconciler | 差分、未知与候选→WorkGraph | 独立顶层对账包装 | 真实报告与机械来源两类消费者迁移 |
| M07 | AgentLifecycle | 新需求按策略/记录/执行分至三者 | 不新增旧计划的独立包装模块 | 连续复用、压缩/重组/归档以真实Kernel能力闭环 |
| M08 | WorkerRuntime | Kernel适配/输入/工具适配→AgentRuntime | 所有Run随机新Session的固定策略 | 真实Session打开/继续、控制与观察接线验证 |
| M09 | StateLedger | load/commit/events与事务机制→RecordStore | 业务判据迁WorkGraph，保留提交时约束 | 历史兼容、重放、冲突、回滚均通过 |
| M10 | ArtifactVault | 不可变正文/摘要→RecordStore；适用性→WorkGraph | 仅支持Run读者的统一门面拆分 | 宿主human/system与真实agent调用均有合法上下文，旧Run API兼容退出 |
| M11 | ReadModelIndex | 领域索引→WorkGraph；SQL持久→RecordStore | 反向依赖Control和重复完整图投影 | 精确读/分页/水位/重建兼容 |
| M12 | ContextCompiler | 需求策略→Workflow；引用与选材→WorkGraph；格式→Runtime | 总门面及同材料重复装配 | 六类消费者按真实目的迁移，普通读不隐含Run |
| M13 | WorkspaceReader | 文件/Git/分析器/来源→WorkspaceTools | 已确认的重复捕获/遍历路径 | 生产消费者、路径边界、来源变更与容量语义保持 |

## 3. 跨结构更新

图/任务/Session/占用/消息/证据的正式变化由WorkGraph操作提交，RecordStore在同一事务保存必须同时生效的关联；重索引在提交后按受影响范围推进并公开水位。业务不手动更新多份表。

Kernel和文件副作用不放进数据库事务：先受理意图，执行驱动调用，实际结果回流；未知不盲目重试。核心操作及状态机已明确每一步，不能把“共享一个helper”当作搬走业务责任。
