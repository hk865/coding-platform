# Storage Adapters

本目录存放同一组 Session/Checkpoint Port 的可替换后端：

- `in_memory/` 以 Map/数组保存数据，不跨进程。
- `sqlite/` 以事务和唯一约束提供持久化。

两者共享 append-only position、revision 乐观并发、eventId 幂等、分页与 checkpoint
checksum 语义，并通过相同 contract tests。Adapter 不拥有领域契约。
