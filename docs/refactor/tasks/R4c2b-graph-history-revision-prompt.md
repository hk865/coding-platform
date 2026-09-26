延续同一图历史实现，三个生产文件scope不变。Astra 已补充并冻结 Graph tests 的两个真实RT1反例（当前16项Graph测试）：篡改i=0不得越过lower；使用真实末条entry.cursor原样续页应返回empty/null nextCursor，并继续核原Session和真实tail，删真实尾后同请求必须unavailable。你最新候选已修复lower反例，该部分保持。终点测试目前确实红：session-operations 的 from>=after.upper 拒绝违反已冻结 lower-1<=position<=upper，旧API允许末条cursor读空末页。

定点修复position==upper，不能以limit=0调用Kernel，也不能空页提前绕过Session.created/tail完整性核验。保持恒定header检查和有界查询，不恢复全历史，不增加SQL或额外Store。无需改其他能力/契约/测试/Kernel。骨架设计、已有接口和工具复用限制仍全部适用。

跑 next-types、next-graph-history 以及相关既有Session历史/continuity回归。你副本的Kernel仍是旧冻结版，最终集成主审会接已验收range补丁；勿因依赖差异改只读文件。交付实际结果和未完成项后停止。