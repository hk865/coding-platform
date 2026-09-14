# Empty Memory Provider

`EmptyMemoryProvider` 是显式“无长期记忆”的默认 Adapter。`recall()` 返回冻结的空集合， `write()` 返回
`provider_disabled`；两者都会先响应 AbortSignal。

该实现不创建文件、数据库、网络连接或进程内缓存，因此多次调用结果稳定，也不会把 no-op 伪装成持久化成功。它让 Composition 在保留 Memory
Port 的同时维持可审计的无状态行为。
