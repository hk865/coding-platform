# Contract Tests

Contract tests 固定跨实现不变量：

- State/Event schema、转换合法性与 Reducer 前置条件。
- ModelClient 的流式事件序列、终止与取消。
- ToolExecutor 的 callId、结果、错误与 effects。
- Hook/EventSink 的控制和提交语义。
- OpenAI/DeepSeek、Skill/Memory 及 Store Adapter 的共同 Port 行为。

Fake 和真实 Adapter 应运行同一契约；测试不能依赖某个 Fake 的私有便利行为来定义生产语义。
