# A1 Session 关联、生命周期与定向发现实现

先读 `docs/refactor/tasks/A1-middle-review.md` 最终冻结结论及 `A1-graph-session-skeleton-prompt.md`。本阶段实现，测试和契约只读；只写scope文件，原地写不能rename，不安装不提交不扩范围。不调用额外模型。

宽读用户原话第01/03/09/12/14段、对齐稿、PRODUCT、ARCHITECTURE、五模块方案、IMPLEMENTED-CAPABILITIES 和相关原子实现/测试。工作实体是 Session+Role+图关联，不增永久Agent表。另一个lane实现 catalog-service/helper，消费已冻结签名，不能复制其内部；初始无模块挂靠的Session仍可创建。

实现 SessionLifecyclePort（link/archive/reactivate）及事件codec。复用SessionRecord/SessionWorkLink codec/Store的CAS/receipt/eventAt和cursor binding。只有新事件注册，不重复Session schema。link expected为Session精确pin+link精确pin（0映射absent）；archive/reactivate仅Session pin。meta重复/跨scope/额外pin拒绝。Session与link/事件一次提交；claim/archive/link同Session版本竞争；不要用全ledgerHorizon锁无关并发。

当前module激活使用 `readCatalogModuleFacts` 的完整相关guards；Task激活把session-directory原有validateTaskTarget提取到session-targets.ts，创建和后续link复用唯一逻辑。WorkContext仍unsupported。initial Module registration也使用该helper，不另造权威。结束已有link不重新要求当前目标存在。

归档拒绝occupancy或未交接的active responsible Task/Work；module关联保留。reactivate不篡改health/history/kernel、不执行模型。重放先恢复原事件，不因后来Session/关联已变化而改变原结果。link事件的pending null游标只用原receipt.cursor恢复；scope/sessionRevision/receipt版本严格匹配。不要把事件写后回填或扫描现态作为历史。

findSessions修复为target索引驱动分页，不先收齐全部targetIDs再扫workspace。可在session-record-codecs注册target+relation精确索引（有限3个relation有序流），合并去重Session，不建立全局缓存/无限seen。只读相关Session和这些Session自身关联。当前目标筛选until=null，includeArchived独立过滤lifecycle；原history/readSession仍保留关闭关联。多个relation跨页不能重复/漏项；游标绑定scope/actor/filters/读取水位，错误明确返回。查询未知module允许ready空页，不新增catalog查询门禁。非target路径保持兼容，所有返回状态应真实表示读取。

session-directory已有1313行，本批不得继续把全部生命周期塞进该文件；只保留目录/创建、提取共享目标验证，生命周期在session-lifecycle；重用原codec/helper，不造泛化Manager。

检查 `python3 tools/dsh-refactor/check.py next-graph-agent`、next-types、next-session-directory。catalog lane 未合并前其helper仍unsupported时如实报告，不能改测试/伪造成功；主审将合并两lane后重跑并可原Session返修。报告变化、真实错误、性能读取计数与兼容影响；停止交验。
