# Integration Tests

Integration tests 使用多个真实模块、在进程内验证边界组合：

- Runtime 主循环、工具批次、取消、Limits 和 resilience。
- Tool Registry/Dispatcher 与 Permission、Approval、Workspace/Process Sandbox。
- InMemory/SQLite Store、required SessionSink、Checkpoint 与 Recovery。
- App Composition、Provider fixture、Skill/Memory 和外部 Tool。
- Web RunManager、SSE 投影和 Benchmark Harness。

该层默认使用临时 workspace、离线模型 fixture 和本地数据库，不访问真实 Provider。跨进程和真实 bubblewrap 行为由
`tests/e2e` 负责。
