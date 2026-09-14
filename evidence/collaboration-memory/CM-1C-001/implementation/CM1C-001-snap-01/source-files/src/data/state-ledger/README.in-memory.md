# StateLedger：内存实现

保存正式事实，提供版本冲突与幂等提交语义。

## 源码入口

- [in-memory-ledger.ts](in-memory-ledger.ts)

## 边界与接线

持久化实现见 ../sqlite-ledger；业务状态变化由 Control 命令驱动。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/data/state-ledger.md)。 完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/ledger](../../../tests/ledger)。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。
