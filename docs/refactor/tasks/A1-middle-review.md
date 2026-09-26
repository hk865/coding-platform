# A1 骨架与测试中审（2026-09-25）

原始 DSH 骨架位于 `a1-graph-session-skeleton`，作用域检查零越界；服务仍 unsupported，未进入实现。65 条原始测试中有设计性错误，不能据此冻结。

主审采用现有五模块、Session 工作实体和唯一 SessionWorkLink，不新建 Agent 表。下列工程决定不需要重新向用户询问：

- Catalog 初始接受仍是薄 Host 正式入口，后续演进不旁路；baseline 类型先保留在 WorkGraph catalog-contracts，其他消费者真正需要时再上提，不现在建第二份共享契约。
- constraints 复用既有 `{name,scope}[]`，不能 string[]。采用失败码分别为已有 active=`revision_conflict`、跨 scope=`forbidden`、坏持久数据=`unavailable`；公开精确读确证缺失为 `status:not_found`。
- 模块 helper 是本模块内部 `readCatalogModuleFacts(records,ctx,ref)`，只激活关联时要求当前正式模块和 guards；关闭旧关联不要求目标仍存在。
- query 的 ModuleRef 是过滤引用，不凭查询授予责任，也不保证该模块当前存在；未知目标可以返回 ready 空页。真正激活 writer 必须校验正式 catalog。避免为所有查询重复加采用门禁。
- link 要求 caller 同时给精确 Session 和 SessionWorkLink expected pin（新 link 的公共 VersionPin.revision=0，转换为 Store guard expectedRevision=null），archive/reactivate 要求精确 Session pin；同一事务递增 Session revision。初始catalog expected 为 Project/Workspace 两个精确 pin，active/baseline/catalog 必须不存在由内部 guards 表达。
- archive 拒绝占用以及 active responsible Task/Work；module关联保留不删。关闭 Task 责任关系是显式交接操作，不靠归档静默丢弃。
- 相同 requestId 的重放恢复原结果，即使随后关闭关联或再次改变 Session；不同输入仍冲突。
- 历史区间存在事件，当前关联同一 ref 只有一条。测试不得要求 reopen 后造三个当前 link。
- RecordStore 只给记录绑定 commit cursor，不改事件正文。link 事件保存 pending link 与 boundField，重放只用原事件及原 receipt.cursor 还原该字段；另外保存 workspaceId/sessionRevision，核对 scope 与 receipt 版本。不能写事件后再回填、扫描当前 link 或猜下一个 cursor。
- target 索引驱动查询，去重必须覆盖页边界；不每页重读所有关联，不枚举工作区后过滤。根据现有 refKey 的 relation-before-session 排序，可使用按 target+relation 的三条有序索引流合并，维护有界游标；不用无限增长的 seen 集或常驻缓存。实际选用实现须由行为和读取计数验证。

测试修订：移除“schema 永远为空”断言，补真实生命周期事件注册、精确 pins、受控同版本竞争/事务故障、不跳过错误状态、原结果重放和定向读取成本。

## 中审结论：允许进入实现

2026-09-25，Astra 独立复核上述修订并冻结契约。修订后 typecheck 通过；三份 A1 专项共 76 项，69 红 / 7 绿，失败源于明确 unsupported 的骨架，未出现导入、类型或 fixture schema 错误。读取成本断言允许新增 target/relation 索引，不强制旧索引名。冻结摘要见本批 evidence/middle-freeze.json。

下一阶段由 DSH 在互不重叠的 catalog 和 session 文件范围并行实现；测试、契约及产品文档只读。组合根由主审接线，真实 SQLite/Kernel 路径单独验收。本结论仅批准骨架与测试进入实现，不代表 A1 功能验收通过。
