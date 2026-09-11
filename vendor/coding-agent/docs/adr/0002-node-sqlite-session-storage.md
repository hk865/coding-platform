# ADR-0002：M4 使用 Node 内置 SQLite

```yaml
status: accepted
date: 2026-08-22
scope: M4 Session/Checkpoint 持久化驱动、最低 Node 版本和事务边界
```

## 背景

M4 需要 append-only
Session 事实、原子批次、乐观并发、Checkpoint 保留和进程重启后恢复。项目已经固定 Node
24，优先避免引入额外 native addon。

## 决策

- 使用 Node 内置 `node:sqlite` 的 `DatabaseSync`，最低 Node 版本固定为 24.15；
- 同步数据库 API 只封装在 `storage/adapters/sqlite`，事务内不调用模型、工具、Hook 或外部等待；
- database schema v1 使用 `metadata`、`sessions`、`session_records`、`checkpoints` 四张表；
- 启用并验证 foreign keys、WAL、`synchronous=FULL`、`trusted_schema=OFF`、defensive mode 和有限 busy
  timeout；
- 所有写操作使用 prepared statements 和短事务；Session record/Checkpoint 在 Core strict
  schema 之外再校验 SHA-256；
- 未知数据库版本 fail closed，不在普通 open 时自动迁移。

## 理由与后果

Node 24.15 起，官方将 `node:sqlite` 标为 Stability 1.2（release candidate）；`DatabaseSync`
的同步特性适合当前单 CLI、短事务和小型事实批次，但不应扩散到 Runtime 热路径。未来若更换驱动，只替换 Adapter，不改变 Store
Port 或事实语义。

数据库文件必须位于 App 明确配置的数据目录，而不是 Agent 可编辑的 workspace。当前实现把父目录权限收紧为
`0700`、数据库文件为 `0600`；外部协调和备份仍由后续 App/CLI 负责。

## 未选择方案

| 方案                | 未选择原因                                     |
| ------------------- | ---------------------------------------------- |
| JSON/JSONL          | 难以同时提供批次原子性、唯一约束和并发冲突语义 |
| 第三方 SQLite addon | 当前不需要额外 native 构建和分发复杂度         |
| 异步数据库服务      | 超出单机学习型 MVP 的部署边界                  |

## 参考

- [Node.js 24 SQLite 文档](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [SQLite atomic commit](https://sqlite.org/atomiccommit.html)
