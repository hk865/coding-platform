# A1 Catalog 独立审阅返修

复用原 Session、原两文件 scope；契约和测试保持只读。当前主工程已导入候选用于集成验收，尚未接受。主审已刷新只读组合根与独立测试到本 lane，不修改你的候选文件。

已经实测的反例在 `next/tests/work-graph/A1-catalog-independent.test.ts`（6 项）：同 identity 同输入的另一调用在 lookup 后、scope 读取前已提交，当前代码返回 revision_conflict 而不是原结果；不同输入在 scope 前提交返回 revision_conflict，在 commit 前提交返回 unavailable，应均为 idempotency_conflict。

请让幂等查询覆盖这些状态变化窗口；复用已有 restoreAdopted，从原 receipt/event 恢复，不能据当前 active 重算。保留 Store 的 idempotency_conflict 错误码。不要每次无条件增加全库查询或重建事务设施；失败路径精确回查该 identity 即可。

同时修整两处明确违反冻结语义的局部实现：ownJsonInput 的 JSON stringify/parse 会剥掉未知 undefined 字段，先结构复制，再精确校验，不通过序列化“清洗”输入；依赖对唯一键不要用 NUL 拼接任意 moduleId，复用 canonicalJson 数组。readCurrentRevision 与 readCatalogModuleFacts 的当前窗口代码共享一个内部函数，既提供 revision 也带相关 guards，避免维护两份相同查读。read 入口尊重已经取消的 signal。

运行 next-catalog / next-types，并用固定工具的 next-vitest 或 harness exec 运行独立 A1 catalog 测试；先查看 check.py 支持的命令，不安装工具。报告真实结果后停止。其他 Session 行为由另一 lane 处理。
