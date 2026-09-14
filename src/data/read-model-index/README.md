# ReadModelIndex

从已提交事件建立可读视图，保留 cursor 与来源。内存投影与 SQLite 投影在同一 Module 目录下。

## 源码入口

- 内存投影：[README.in-memory.md](README.in-memory.md)、[read-model-index.ts](read-model-index.ts)
- SQLite 投影：[README.sqlite.md](README.sqlite.md)、[sqlite-read-model-index.ts](sqlite-read-model-index.ts)
- [initial-planning-view.ts](initial-planning-view.ts)：规划提案、状态和公开运行记录的查询组合
- [completed-work-eligibility.ts](completed-work-eligibility.ts)
- [completed-work-merge.ts](completed-work-merge.ts)：完成工作视图的归并可见性（工作身份归并）：同一任务多条身份时给出落选者与计数
- [baseline-change-projection.ts](baseline-change-projection.ts)
- [reviewer-projection.ts](reviewer-projection.ts)
- [work-context-projection.ts](work-context-projection.ts)：两种适配器共享工作绑定、运行关联、执行笔记和接续记录的事件解释；只在关联运行时读取精确旧绑定，具体写入与事务留在适配器。
- [handled-event-types.ts](handled-event-types.ts)：两种适配器共享已支持事件集合；事件的具体投影计算和存储事务仍由对应职责文件或适配器负责。
- [console-projection.ts](console-projection.ts)：两种适配器共享运行显示状态、计划矩阵、Evidence 行和 Portfolio 的纯投影计算。
- [architecture-inspection-projection.ts](architecture-inspection-projection.ts)：两种适配器共享缺少 Inspection 关联时的展示占位构造；不生成 canonical 事实。
- [verification-projection.ts](verification-projection.ts)：两种适配器共享 Evidence 顺序、适用性解释、Reduction 和 Plan fallback 的验证视图构造；适配器只负责读取各自的投影行。
- [collaboration-projection.ts](collaboration-projection.ts)：共享初始设计、决策、协调政策与激活事实的具名投影变化。
- [material-access-projection.ts](material-access-projection.ts)：共享授权／撤权事件到不可变展示行的解释。
- [query-projection.ts](query-projection.ts)：共享 Query job、run、answer 生命周期的具名投影变化。
- [control-intent-projection.ts](control-intent-projection.ts)：以不可变 fold 共享控制意图与安全点回执时间线语义。
- [plan-change-projection.ts](plan-change-projection.ts)：共享最新目标修订对应的源／目标计划选择和 disposition 解释调用；计划快照读取仍由适配器提供。

## 边界与接线

按已提交事件投影、cursor、scope、重建与查询布局。canonical 目录由 StateLedger 的 ScopeCatalogPort 提供；政策解释用注入端口，不复制 Control 算法。两种投影共享状态语义，查询视图不成为新的状态权威。

（工作身份归并）：`completedWorkView` 的行新增 `duplicateIdentityCount` 与 `droppedWorkRefs`。同一 (goal, task) 存在多条持久身份时（旧版本留下的历史不一致），视图仍按 work-identity-resolution 的**唯一**规则归并成一行（显式声明的身份优先于推导兜底身份，不改写该实现），但把「发生过归并、落选者是谁」变成可见事实 —— 此前落选身份被静默丢弃，读的人无从知道，其留痕也永远没有机会进入历史选材。落选身份不被改名、不被删除，仍可按 workId 用 `workContextView` 直接读取；两套后端由 [completed-work-merge.ts](completed-work-merge.ts) 的同一份纯函数算出，结果逐字段一致（canonical 排序，不依赖存储遍历顺序）。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/data/read-model-index.md)。完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/read-model](../../../tests/read-model)（内存）与 [tests/sqlite-read-model](../../../tests/sqlite-read-model)（SQLite）。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。
