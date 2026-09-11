# HumanCollaboration

将人的目标、指令和决定转成可受理请求，查询正式状态。

## 源码入口

- [human-collaboration.ts](human-collaboration.ts)

## 边界与接线

浏览器宿主位于 ../app；角色配置与人类接口不等于真实模型协作。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/interaction/human-collaboration.md)。 完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/interaction](../../../tests/interaction)。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。
