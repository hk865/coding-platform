# SQLite Stores

`SqliteStores` 使用 Node 内置 `node:sqlite` 同时实现 Session 与 Checkpoint Store。

初始化创建版本化表和约束；追加事件在事务中检查 expected
revision、eventId 幂等与 position 连续性，再更新 Session
revision。Checkpoint 以 run/session 为键保存规范 JSON 和 checksum。读取通过 strict
schema 恢复领域值。

连接和事务只存在于 Adapter。`close()` 由 Composition 的资源生命周期负责，Core 不接触 SQL。
