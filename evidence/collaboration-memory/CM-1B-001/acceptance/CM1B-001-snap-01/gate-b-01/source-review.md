# 独立源码审查与缺陷记录

实施owner为/root，验收者仅审查/隔离验证，不修改产品。已读新增memory契约、fold、Control/Ledger、Human入口、Context、App生产者、ReadModel与UI/浏览器测试，沿21项修改追到真实Query/WorkRun输入消费和公开note生成。

- profile独立持久身份，不假造Project/Run；项目维护需要真实Project。原领域CommandIdentity/事件消费者不承担新profile事件。
- memory fold同一工作副本处理batch，容量/CAS失败不写collection；幂等只保留指纹和有限回执，无删除正文副本。snapshot/receipt形状错误明确unavailable，不替换为空。
- Context每次读profile/project当前版本并检查来源/用途/到期；缓存只有刷新后同digest才复用。copy递归检查确切源版本，过期/删除/条件失效不沿缓存复活。输入文本声明preference_only，与当前指示和正式义务分层。
- Host维护路由在Goal守卫前；Query的真实Goal前置保留，不把另建Query冒充同Task验证。WorkRunMaterialCompiler记忆选择在可选WorkContext提前返回前，正式后继仍沿原Run/Work关联校验。
- 维护和采用UI各读真实持久结果；在途输入保留原revision，保存不回写旧历史。经验来源从实际Run选择，经Control解析真实Task Work，不让UI伪造governance或note body。

此前独立发现的两项B05缺陷已修复：

| ID（本验收归档） | 原问题 | 关闭依据 |
|---|---|---|
| B-REVIEW-01 | 导入时当前governance冒充旧note原始依据 | 独立memoryGovernance字段，与body canonical摘要绑定；Control记录时预检查、Ledger完整四项CAS；import/Context复核原见证，未知旧note拒绝，原governanceRevision权限语义不变；同Task测试含首次导入与直接SQLite stale提交反例。 |
| B-REVIEW-02 | 删除同note后换governance/请求可重新激活 | 稳定memorySourceIdentity取note ref+digest；独立stdin原反例已由ready变removed，冻结maintenance含改条件/身份复活拒绝。 |

没有将旧笔记物理删除或自动补当前治理见证；历史查看仍兼容。copy原源版本纠正/删除后已提交复制条目历史可查，当前选材排除。跨库复制不是事务承诺；body→note→memory分步保存仅最终memory receipt确认进入记忆。

本快照当前未发现开放阻断缺陷。最终结论待冻结全量及收尾hash；本文件自身不是Gate。
