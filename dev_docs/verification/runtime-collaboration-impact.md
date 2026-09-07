# 运行时协作变更的下游同步

日期：2026-09-05。依据：用户要求把角色、记忆与查询变更同步到 ModuleDependencyDAG 和 Interface。

## 修改范围与影响

- ARCHITECTURE：扩展 PlanCompiler 协调职责，新增六条依赖，新增 WorkspaceReader；明确 ContextCompiler 通过缺口返回而非自行启动模型。
- runtime-collaboration Interface：定义角色绑定、消息与正文提交、版本化 Context、公开快照、查询隔离及各 Module 可观察结果；列出冻结测试。
- 四份首切片 Module 与 Command/Event、StateLedger、GoalView：保留有效的 CreateGoal 类型，新增扩展消费入口，修正 HumanCollaboration 对展示及依赖的过宽限制。
- P1-02/03/04/06/08/09/11/12：新增对应契约引用与具体验收；P1-09 补快照接口冻结项，P1-12 补来源读取冻结项。P1-02 保持 fixture，不提前依赖 P1-03 的运行能力；PlanCompiler 请求／结果由 P1-11 冻结。现有 artifact provenance 与 blocking edges 未变：仍消费既有计划、运行、证据和状态产物，不因普通通信建立额外阻塞。
- P1-00/01 首切片类型不变；05 完成归约不变；07/10 沿 03/06 的角色与生命周期契约扩展；11/13/14 保留正式决定、修复与激活语义。完整 MVP 的重新拆票仍由 P0-06 复核，不冒充本轮完成。
- CompletionPolicy 的报告不等于完成、Evidence 与义务要求未变化，不重写正文。角色复核与展示入口已更新链接。

## 验证与剩余边界

执行文档校验，检查链接、Module DAG 无环、P1 metadata／DAG 一致、产物依赖、门禁与归档完整性。结果记录于本次交接；结构检查不能证明语义契约已实现。

运行时扩展仍为 draft，未初始化代码、未批准 P0、未冻结完整 wire schema。新增 WorkspaceReader 是本次按已认可职责推导的候选 Module，可在人审阅 ARCHITECTURE 时调整。
