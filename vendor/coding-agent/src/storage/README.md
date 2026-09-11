# Storage

Storage 为 Core 的 `SessionStorePort` 与 `CheckpointStorePort`
提供实现，并把 AgentEvent 连接到 append-only Session。

- `adapters/in_memory/`：确定性的进程内双 Store，主要用于测试和嵌入。
- `adapters/sqlite/`：Node 内置 SQLite 的事务化持久实现。
- `session_event_sink/`：required Sink，把已验证事件追加到 Session。

Session 是恢复事实源，Checkpoint 是带 checksum 的派生快照。SQL、事务和驱动类型不得进入 Core。
