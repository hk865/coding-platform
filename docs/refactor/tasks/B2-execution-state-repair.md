# B2 状态独立审阅返修

主审已实跑独立补测：原18绿之外，Session/Lease准入与竞争、撤权后终态记录、终态事件游标、跨scope release与manifest contentType均有反例。只读测试已明确刷新至同lane，scope仍12实现文件，不得改测试。先跑next-execution-state查看真实失败。主审中审与初次实现报告不等于验收。

1. 当前WG11只读不授新动作权限。authorize/begin/entered/model issue/consume实际核Session active/health/完整RunRef owner/generation及V2 sessionGeneration，Lease必须存在、无release、fullTaskRef/holder/attempt匹配；null不是free。所有用于判断的Lease、Session、Attempt/outbox/Run局部版本入同次commit。issue/consume共用admitEnteredRun，不复制漏项；检查后lease release的竞争应真实CAS拒绝。
2. 终态归约是记录已发生事实，不是授予新动作。完整Kernel/begin/claim/entry/Turn来源仍严格；后来Host grant/Role矩阵撤权不能拦住已进入Run的真实terminal及同代release，移除结果路径不适用的新许可门槛。原request replay不变，旧代补历史不动继任owner/cursor。
3. terminal同时更新Run.lastEventSeq=真实event.sequence、lastRuntimeEventId=真实Runtime eventId、lastFactEventId=本次正式domain eventId。严格配对event/payload/序号；不能默默保0或同seq换event。结果重放还原原回执。
4. TaskLease.release nested完整project/goal/task、run/attempt/Session/generation对齐外层及内部各ref，不能只有局部runId/attemptId匹配就投影free。旧无release保持兼容。
5. readStoredManifest/readManifestFromEnvelope作为唯一可复用parser，核精确contentType application/vnd.coding-platform.task-execution-manifest+json;version=1、<=既有256KiB界限、ref/body原字节/size/digest、原owner Run及完整provenance；所有array/ref/role/basis必要shape严格，不接受随意object当真实DTO。无需另造manifest库。
6. mergeGuards不得忽略同key不同revision/null；冲突必须revision_conflict或重新建立整个窗口，不能取较大版本、第一次、last-write-wins。scope内共享export可复用，避免两份宽松merge。

材料guards缺口主审已派M2窄facts接缝骨架。此修复暂不能让外部selected/additional materials在缺facts下获得fresh许可：明确unsupported并指出需facts，而不是open后无guard提交。M2完成后主审更新冻结依赖接线，不复制材料判据。该临时缺口不算B2完整完成。

源码可读、复用既有helper，避免新增大一统manager。原地写文件不rename/probe。跑next-types、next-execution-state及受影响next-task-claim/next-history-index/next-future-plan等，交付后停止。不要全量反复跑其他未实现骨架集合。
