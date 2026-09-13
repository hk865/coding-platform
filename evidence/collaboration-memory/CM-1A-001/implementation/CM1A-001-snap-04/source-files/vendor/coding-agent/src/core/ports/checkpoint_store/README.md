# Checkpoint Store Port

`checkpoint-store-port.ts` 定义稳定恢复快照、候选信息、resume mode、checksum 和
`CheckpointStorePort`。

Checkpoint 包含 `RunState` 与已提交 Session cursor，只能在 Runtime 的稳定事件边界写入。
`createCheckpoint()`
生成规范 checksum，读取方必须先校验再使用。Session 仍是事实源；Checkpoint 是加速恢复的派生快照，不能跳过事件重放的一致性检查。

SQLite schema、事务和文件路径属于 Storage Adapter，不进入本 Port。
