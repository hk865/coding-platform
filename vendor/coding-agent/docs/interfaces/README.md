# Interfaces

接口文档按稳定边界分层：

- [Core Contracts](m1-core-contracts.md)：RunState、AgentEvent、ModelClient、ToolExecutor、EventSink、Context 与 Hook。
- [Runtime, Tools and Storage](m2-m4-runtime-tools-storage.md)：Loop、安全链、Session、Checkpoint 与 Recovery。
- [App, Providers and Extensions](m5-app-providers-extensions.md)：配置、Composition、CLI、OpenAI/DeepSeek、Skill 与 Memory。

具体 TypeScript schema/Port 是最终契约来源，模块 README 解释所有权和依赖方向。本目录不把 Benchmark
artifact schema 或厂商 SDK 类型提升为 Core 领域接口。
