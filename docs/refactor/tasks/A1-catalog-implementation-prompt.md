# A1 正式 Catalog 实现

骨架已由 Astra 审核，读取 `docs/refactor/tasks/A1-middle-review.md` 最终冻结结论和 `A1-graph-session-skeleton-prompt.md` 整体意图。实现只写本 lane 的 catalog-service.ts / catalog-record-codecs.ts。契约和测试只读，不安装、不提交、不改检查入口或其他源码；不增加新文件。白名单文件原地写，不能 rename。

宽读 PRODUCT、ARCHITECTURE、双图对齐稿、编号原话、IMPLEMENTATION-PLAN 的 A/B/C/D 责任；看 IMPLEMENTED-CAPABILITIES、模块文档、当前 catalog-contracts、RecordStore 和 plan-readers 真实治理读取。目标是给图上的 Session 关联提供正式模块来源，不重新设计架构。

冻结接口以源码为准：constraints 是 `{name,scope}[]`；expected 精确 Project/Workspace 两 pin；新 active/baseline/catalog 内部 absent guard。adopt 的三记录和事件一次提交、现有治理 schema 不重复注册。原 baseline digest 只含既有 fixture形状，Catalog 分开。明确字段/refs校验、唯一模块/接口/依赖端点和 DAG；不能把伪造 __proto__/Unicode key 当普通对象原型用，集合使用 Map/Set。未知字段不应被静默剥离而改变幂等语义。

重放先读原receipt/event，恢复原结果，不按当前 active 再计算；坏事件/版本/指纹/范围不当作成功。输入同步复制，cancel 守住提交前。当前 pointer 读取需要相关记录同窗/复核；Module helper 返回真正相关 baseline/catalog/active guards 供调用方 CAS，激活时使用，关闭旧 link 不要求它。

采用失败码以中审为准；不为了测试造另一个模型、历史库、provider、SQL事务。保持代码紧凑，已有纯函数/codec复用适用部分，DAG 检查优先复用 `tasks/task-index.ts:hasCycleInEdges`，不复制几百行无关验证。运行 `python3 tools/dsh-refactor/check.py next-catalog` 和 next-types；其他 A1 子路径尚在另一 lane 实现，不能为了让它们绿改目录/Session。报告文件与行数、调用链、测试结果和真实限制，停止交主审。
