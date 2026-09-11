# ArchitectureReconciler

把源码图与架构基线做机械差异比较，产出待审问题并物化候选基线。

## 源码入口

- [architecture-reconciler.ts](architecture-reconciler.ts)：inspect 入口
- [architecture-delta.ts](architecture-delta.ts)：源图差异与 Finding 分类
- [baseline-evolution-port.ts](baseline-evolution-port.ts)：materialize 端口

## 边界与接线

取材与来源版本比较交 ArchitectureContext／BaselineEvolutionContext；无来源绑定、版本过期或登记拒绝时停止，不以测试夹具补足。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/control/architecture-reconciler.md)。完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/control](../../../tests/control) 中的 `architecture-reconciler.test.ts`、`architecture-delta-regression.test.ts`、`baseline-evolution-port.test.ts`。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。
