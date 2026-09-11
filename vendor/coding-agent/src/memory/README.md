# Memory

`memory` 承载 `MemoryProviderPort` 的外层实现，为模型 Context 提供可选的
`MemoryItem`。Memory 是派生知识，不是 Session/Checkpoint 的运行事实，也不能携带系统权限。

当前 Composition 显式注入 `providers/empty`，因此运行没有隐藏的跨会话状态。
`providers/project_memory` 仅保留未来项目级长期记忆的边界。

新增 Provider 只能通过 `recall` / `write`
Port 工作，并必须定义 workspace 隔离、来源、删除和注入防护；RuntimeRunner 与 ContextBuilder 不应感知具体存储方式。
