# Context Compactor

本目录预留摘要式上下文压缩模块，当前没有 TypeScript 实现，也不在 Runtime 主链路中。现有
`ContextSelectionPolicy` 只做确定性预算裁剪，不生成摘要。

未来 Compactor 必须位于“Session 事实 → 派生 Context”方向：压缩结果不能改写 append-only
Session，必须记录来源与版本，并保护当前用户消息及未闭合 ToolCall。失败时应能回退到现有 SelectionPolicy；是否持久化、何时失效及如何防止摘要注入需要单独 ADR。
