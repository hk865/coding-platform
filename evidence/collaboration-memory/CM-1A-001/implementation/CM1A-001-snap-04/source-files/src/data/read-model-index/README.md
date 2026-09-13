# ReadModelIndex

从已提交事件建立可读视图，保留 cursor 与来源。内存投影与 SQLite 投影在同一 Module 目录下。

## 源码入口

- 内存投影：[README.in-memory.md](README.in-memory.md)、[read-model-index.ts](read-model-index.ts)
- SQLite 投影：[README.sqlite.md](README.sqlite.md)、[sqlite-read-model-index.ts](sqlite-read-model-index.ts)
- [initial-planning-view.ts](initial-planning-view.ts)：规划提案、状态和公开运行记录的查询组合
- [completed-work-eligibility.ts](completed-work-eligibility.ts)
- [completed-work-merge.ts](completed-work-merge.ts)：完成工作视图的归并可见性（RW-15 / M1）：同一任务多条身份时给出落选者与计数
- [baseline-change-projection.ts](baseline-change-projection.ts)
- [reviewer-projection.ts](reviewer-projection.ts)

## 边界与接线

按已提交事件投影、cursor、scope、重建与查询布局。canonical 目录由 StateLedger 的 ScopeCatalogPort 提供；政策解释用注入端口，不复制 Control 算法。两种投影共享状态语义，查询视图不成为新的状态权威。

RW-15（M1）：`completedWorkView` 的行新增 `duplicateIdentityCount` 与 `droppedWorkRefs`。同一 (goal, task) 存在多条持久身份时（RW-13 之前留下的历史不一致），视图仍按 work-identity-resolution 的**唯一**规则归并成一行（显式声明的身份优先于推导兜底身份，不改写该实现），但把「发生过归并、落选者是谁」变成可见事实 —— 此前落选身份被静默丢弃，读的人无从知道，其留痕也永远没有机会进入历史选材。落选身份不被改名、不被删除，仍可按 workId 用 `workContextView` 直接读取；两套后端由 [completed-work-merge.ts](completed-work-merge.ts) 的同一份纯函数算出，结果逐字段一致（canonical 排序，不依赖存储遍历顺序）。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/data/read-model-index.md)。完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/read-model](../../../tests/read-model)（内存）与 [tests/sqlite-read-model](../../../tests/sqlite-read-model)（SQLite）。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。
