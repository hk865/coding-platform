# 产品装配

`persistent-platform.ts` 装配 SQLite 账本、投影及模块公开入口；`rework-composition.ts`、`query-composition.ts` 和 `alternative-report-observation.ts` 负责宿主跨模块材料接线。生产服务直接从这里导入，测试也复用同一装配并显式替换能力。

历史 `createPersistentSqliteHarness` 已迁为 `createPersistentPlatform`，仓内调用同步迁移。磁盘目录、数据库表、事件名、引用和摘要没有随源码命名修改。

`createPersistentPlatform` 是持久测试／演示装配，允许通过 `PersistentPlatformOptions` 选择明确记录的 Fake 默认能力。`createProductPlatform` 是生产入口：类型要求调用者显式提供 Runtime、验证、只读查询、换手、接续、生命周期、WorkspaceReader 和工作区能力；当前内核不支持的可选效果必须由明确返回 unsupported／rejected 的端口表示。生产 `app/service.ts` 已走该入口，`executionCapability` 继续标出 fixture 与真实执行。新增生产宿主必须同样提供并验证能力接线。
