# ReadModelIndex：SQLite 投影

持久保存读模型，并支持从账本重建。

## 源码入口

- [sqlite-read-model-index.ts](sqlite-read-model-index.ts)

## 边界与接线

与内存投影共享状态语义；查询视图不成为新的状态权威。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/data/read-model-index.md)。 完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/sqlite-read-model](../../../tests/sqlite-read-model)。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。
