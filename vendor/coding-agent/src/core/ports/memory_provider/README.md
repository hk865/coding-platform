# Memory Provider Port

`memory-provider-port.ts` 定义受 `AbortSignal` 控制的 `recall` / `write`
边界，以及 strict 输入、结果和稳定错误分类。返回值使用 `context/types` 中的 `MemoryItem`。

Memory 是可选的派生上下文，不是 Session/Checkpoint 事实源。Port 不规定向量库、检索算法、跨项目共享或自动摘要；当前生产装配使用
`EmptyMemoryProvider`。
