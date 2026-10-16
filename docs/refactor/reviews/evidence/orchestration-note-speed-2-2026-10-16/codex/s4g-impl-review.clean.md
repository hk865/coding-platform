未发现必须改的实现问题，只有一处注释建议。全程只读，未运行测试或构建。实际 HEAD 为 `abf8be98`，提交标题为 `269a9748`；本报告针对当前工作树。

1. **建议：删除残留的旧后缀说明。** `src/core/record-store/sqlite-lookup-indexes.ts:62` 声称排序值类型会进入 DDL；实际构造只使用 `orderBy.path`，名称再散列 DDL 正文（同文件第 64、78 行）。最小反例：其他注册项不变，只把 `valueType` 从 `text` 改为 `integer`，DDL 和名称都不变。实现符合 R2-3，但注释会让维护者误判是否触发迁移。最小修法：删掉第 62–63 行关于值类型进入 DDL 的说法，保留排序列位置说明。

其余重点未发现偏差：列布局、同源类型条件和命名见 `src/core/record-store/sqlite-lookup-indexes.ts:54`、`src/core/record-store/sqlite-lookup-indexes.ts:77`；C′ 的精确谓词识别、按类型删除和事务内重新规划见同文件第 88、99、123 行。工厂先迁移、再初始化文本模块、清空缓存，异常时关闭连接，见 `src/core/record-store/sqlite-record-store.ts:156`。

四个测试的范围与任务书一致：

- SP-40 确实先缓存 W/V 查询，再让 B 改变 W 的路径注册，随后检查原连接答案、V 新提交和重开结果；预先有手写键值断言，前后比较并非唯一依据。见 `tests/record-store/SP-lookup-index-migration.test.ts:98`、同文件第 112、125、138 行。
- SP-41/42 覆盖完整→部分→完整、部分→完整→部分两种顺序；SP-43 的注册集合与生产装配一致。见同文件第 `tests/record-store/SP-lookup-index-migration.test.ts:154`、`tests/record-store/SP-lookup-index-migration.test.ts:188`、`tests/record-store/SP-lookup-index-migration.test.ts:223` 行，以及 `src/composition/create-platform.ts:521`。
- 这些公开端口测试只能证明答案，不能证明旧索引删除、其他类型索引保留、回滚路径、查询计划或重准备次数；文件开头也明确限定为行为刻画测试（`tests/record-store/SP-lookup-index-migration.test.ts:2`）。这些不是额外要求补测的缺陷；升级、大小、计划和成本仍按 R2-5/R2-6 由 lead 在两万条注记副本上验收，本次未复核实测结果。

成本方面，无变更时，**本轮迁移新增的数据库工作只有一次 `sqlite_master` 读取**，另有内存中的 DDL、散列和集合计算，不进入事务（`src/core/record-store/sqlite-lookup-indexes.ts:90`、同文件第 124 行）。普通、有序及计数查询继续使用类型字面量，没有新增逐查询迁移或元数据读取（`src/core/record-store/sqlite-record-store.ts:562`、同文件第 618、713 行）；不能仅凭静态审查宣称所有计划和零重准备指标已通过。

可以合入