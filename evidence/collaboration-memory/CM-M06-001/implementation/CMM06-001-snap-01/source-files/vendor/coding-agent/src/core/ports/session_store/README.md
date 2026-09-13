# Session Store Port

`session-store-port.ts` 定义 append-only
Session 的元数据、`RunConfigSnapshot`、记录格式、分页读取、revision 乐观并发与
`SessionStorePort`。`session-projection.ts` 用同一 Reducer 把记录纯投影回 `RunState`。

每条 `SessionRecord`
具有连续 position 和稳定 eventId；重复追加相同事实可幂等返回，内容冲突则失败。恢复逻辑按页读取全部记录并验证连续性。

数据库 schema、SQL 和事务实现属于 Storage Adapter。
