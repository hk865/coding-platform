# ReadModelIndex：投影与查询

从已提交事件建立可读视图，保留 cursor 与来源。

## 源码入口

- [read-model-index.ts](read-model-index.ts)
- [scope-catalog.ts](../../contracts/scope-catalog.ts)：按 scope 发现 Goal/QueryJob，增量推进事件 cursor，重开可重建
- [initial-planning-view.ts](initial-planning-view.ts)：规划提案、状态和公开运行记录的查询组合
- [completed-work-eligibility.ts](completed-work-eligibility.ts)
- SQLite 版本：[sqlite-read-model-index.ts](sqlite-read-model-index.ts)

## 边界与接线

已完成工作资格依据正式归约，Run 结束本身不是任务验收。`materialAccessGrants` 只投影已登记的授权行，供展示与 Vault 解析入口使用，本身不做权限判断。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/data/read-model-index.md)。 完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/read-model](../../../tests/read-model)。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。
