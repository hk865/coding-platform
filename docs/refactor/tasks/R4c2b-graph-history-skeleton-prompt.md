W=/home/hyh001/projects/coding-platform；T=W/coding-platform/next。第一阶段：骨架/测试后停止，Astra审查后才实现。原工程只读，不提交/安装/外网模型/凭据；scope仅两个文件，原地写入不要rename。

先读原意图 docs/refactor/intent/ORIGINAL-DIALOGUE.md:975-985、INTENT-AND-DECISIONS.md最新图复用补充、PRODUCT §3、ARCHITECTURE §2、IMPLEMENTED-CAPABILITIES WG11/RT1/RT7及modules/core/work-graph.md §6.2、agent-runtime.md §7。设计是已有TaskGraph→Run→Session→原历史区间；不另建历史库/图/通用框架。读当前真实代码：tasks/run-state-service.ts、tasks/execution-history-service.ts、persistence/execution-history-codecs.ts、core/agent-runtime/session-operations.ts/observation-recovery.ts、vendor补丁SqliteStores.read及三个冻结contracts。已有readTaskInput/Plan图不属于本批重写范围。

新增薄工厂 src/core/agent-runtime/graph-execution-history.ts：createGraphExecutionHistoryReader(deps:GraphExecutionHistoryDependencies):GraphExecutionHistoryReadPort。接口已在execution-history-contracts.ts冻结，readTaskExecutionHistory(ctx,{runRef,afterCursor,limit})组合一次WG11 readExecution及一次既有RT7 readExecutionHistory，不解析/过滤另一套Kernel正文，不自己开store/SQL，不产生写入或执行权限。骨架真实unsupported，本阶段不实现。tests/runtime/R4c-graph-history.test.ts是唯一可写测试。

真实目标接线（中审后才实施）：WG11 Run.executionHistory定位，不存在返回unsupported且不调用history、不从头回退；损坏/与claim Session或adapter映射错链unavailable。取history.kernel.runId+turnId（不等同platform runId）、SessionRef、start与end??observed水位；委托RT7新增range参数{adapterId,kernelSessionId,startPosition,throughPosition}，通过原owner读取。Session当前已被别人占用或归档不阻止历史查询。

图reader外层cursor保存完整RunRef、固定Kernel/session身份、start和冻结upper、RT7 opaque nextCursor；每页fresh WG11核身份/start未变和upper仍在当前有效图范围。允许observed增长但保持旧upper；terminal end比旧upper更小时返回source_stale/invalid，不能偷偷扩/缩范围。内部cursor仍由RT7/RT1校验。未签名cursor不是授权，每页必须遵守现有scope/来源核验；不同Run不能换用cursor，越过当前graph水位拒绝。同步深拷贝ctx/request并保留signal；await返回后取消拒绝，保留not_found/not_ready等，unexpectedthrow→unavailable，不吞成空。

根Agent将于实施阶段扩展RT1/RT7已冻结range字段，不要本阶段修改它们。RT1首读按start-1，一次有界Kernel.read取page+lastPosition，不再MAX_SAFE_INTEGER；明确上界大于当前tail、或续页冻结tail已截短拒绝。cursor绑定range+principal+Session，range/throughCursor同时提供拒绝。RT7仍只筛一页、零命中nextCursor前进，不凑满；每页range绑定一致，原recordId/source/body/basis保留。既有无range API行为保留。

测试优先真实SQLite/TaskClaim fixture/Session/Kernel scripted turn。复用tests/helpers/task-claim-fixture.ts（其Sessions本身是真Kernel创建）和R4c-execution-history已有runObservedModel模式；writer可处于unsupported骨架，所以写绑定后的成功链应红，不能假成功mock；避免复制整个fixture。另用spy记录真实SessionHistoryRequest和Kernel read行数证明直接从后部起点读取，不以只返回命中数假装少扫描。根Agent另加composition装配测试。覆盖：真实两Turn的第二个Run区间直接读；进行中增长后旧分页上界固定；缺locator零Kernel读；Run/Session/principal/cursor换目标拒绝；原始证据保留/少于limit与零匹配仍有续页；显式起止/尾部截短/输入突变/取消拒绝；RT1可用realSessionOwner直接覆盖range性能，当前不接线时必须红。对照真实数据而非重新实现服务。

运行 python3 tools/dsh-refactor/check.py next-types 与 next-graph-history，指出哪些红测来自writer/reader骨架，不要求旧已通过用例变红；禁止skip/todo和实现。返回复用映射及测试报告，停止。
