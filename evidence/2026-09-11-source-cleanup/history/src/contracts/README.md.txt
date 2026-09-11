# 共享契约

定义模块端口、信封、命令、事件与版本化材料结构。

## 源码入口

- [modules.ts](modules.ts)
- [ports.ts](ports.ts)
- [task-envelope.ts](task-envelope.ts)
- [verification.ts](verification.ts)
- [artifact.ts](artifact.ts)
- [material-access.ts](material-access.ts)
- [ledger.ts](ledger.ts)

## 边界与接线

fixtures/ 与 testing/ 是示例和替身；修改契约须同步正式 Interface、实际消费者与回归。

## 修改与验证入口

涉及职责或契约时读 [架构](../../../agent_learn/agent_dev/agent_platform/ARCHITECTURE.md)。 完成状态与实施顺序统一看 [module-status](../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/contracts](../../tests/contracts)。构建与测试命令以 [package.json](../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。
