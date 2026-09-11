# In-memory Stores

`InMemoryStores` 同时实现 `SessionStorePort` 与
`CheckpointStorePort`。Session 元数据、记录和 Checkpoint 保存在进程内集合中，每次输入/输出都经过 schema 校验和复制。

实现支持连续 position、revision 冲突、相同 eventId 幂等、分页读取与 checkpoint
checksum，行为与 SQLite Adapter 对齐。它适合单元/集成测试或短生命周期嵌入，不提供跨进程持久化。
