# Memory Provider Implementations

该目录放置 `MemoryProviderPort` 的可替换实现：

- `empty/`：生产默认的无状态实现。
- `project_memory/`：尚未实现的项目级长期记忆边界。

所有实现都只接收和返回
`MemoryItem`，不能替代 Session/Checkpoint 或直接控制 Runtime。实现差异通过共享 Port contract 隔离。
