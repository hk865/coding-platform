# WorkerRuntime 与宿主适配

执行 TaskEnvelope，调用内置编码内核，保存运行事件、上下文和模型用量。

## 源码入口

- [coding-agent-runtime.ts](coding-agent-runtime.ts)
- [exploration-tools.ts](exploration-tools.ts)
- [model-budget.ts](model-budget.ts)
- [read-only-query-adapter.ts](read-only-query-adapter.ts)
- [fake-runtime-adapter.ts](fake-runtime-adapter.ts)

## 边界与接线

真实内核入口为 coding-agent-runtime；Fake 和固定 Query 适配只证明夹具路径。修改内核前读取 vendor/coding-agent/AGENTS.md 与 INTEGRATION.md。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/execution/worker-runtime.md)。 完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/runtime](../../../tests/runtime)。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。
