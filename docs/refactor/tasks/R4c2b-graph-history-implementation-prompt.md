W=/home/hyh001/projects/coding-platform；T=W/coding-platform/next。Astra已审核并冻结骨架/测试，进入生产实现。先读本批 docs/refactor/tasks/R4c2b-graph-history-skeleton-prompt.md 的意图与完整契约（仅其阶段“禁止实现”被本指令替换）、IMPLEMENTED-CAPABILITIES WG11/RT1/RT7、WorkGraph Run.executionHistory与三个冻结contracts。读现有 session-operations.ts、observation-recovery.ts 和 graph-execution-history.ts、对应真实Kernel/Claim测试。只写scope三个生产文件，types/interface外形保持冻结；测试/脚本/Kernel/其他模块OS只读，原地写不得rename；不安装/提交/凭据/模型外网。

本批是薄接线：一次WG11取得已持久Run locator→一次RT7→一次RT1有界原历史页；除原Session.created位置1的恒定核验外，不再读全历史，不新建图/日志/数据库/多一层业务filter。graph reader缺locator明确unsupported且零history调用，损坏/链错unavailable；当前Session被别人占用不阻止历史查询。Graph外层cursor绑定完整RunRef、Session/Kernel身份、起点及冻结upper，RT7内cursor完全opaque，只委托原owner解析。续页fresh WG核start+identity未变且旧upper<=当前end??observed，增长不扩页，terminal收窄到旧upper以内则source_stale/invalid。每次不得扩大caller读取权限。所有异常不吞成空结果。

RT1：Request.range可选{adapterId,kernelSessionId,startPosition,throughPosition}，安全正整数start<=through；range+throughCursor并存invalid。核真实映射及principal；从start-1读limit=min(request.limit,upper-from)，若无range首读直接limit小页，使用新SqliteStores.read返回的lastPosition冻结upper；绝不再MAX_SAFE_INTEGER预读。后续页必须核source仍至少达到原upper，不可以Math.min偷偷掩盖截短；显式range超真实tail拒绝incomplete/unavailable。原Session位置1核验最多一条，不重复读取整页。必要内部KernelSessionReader类型改为concrete SqliteStores get/read以获得lastPosition，不新增SQL/StoreAPI。游标除现有p/a/k/principal/upper/position再保存lower，合法范围lower-1<=position<=upper；旧无lower游标仅用于无显式range且lower=1。range必须一致，原API无range兼容已有测试，throughCursor原语义保留。

RT7：同步隔离range；每次仍只委托一页，原证据body/source/basis保持，scannedCount只代表raw页项数，不循环凑满。游标绑定range与execution identity，range不得随着续页改变；转发RT1 range和错误，不解析另一个cursor格式。取消在await后复核。无range旧调用不强行要求图索引。

源码范围读Kernel补丁是独立lane，若本副本尚未导入最终物理性能优化，明确记录哪些SQL成本红测来自依赖，不能修改Kernel/测试或用cache绕过。WG writer最终也独立导入；如缺其实现只影响依赖测试，请清晰报告，主审会集成后重跑。

运行 python3 tools/dsh-refactor/check.py next-types 与 next-graph-history，相关既有session连续/历史测试也复跑；检查composition新入口在你可写范围外由主审装配，不要另造装配入口。交付复用映射、真实通过/失败、仍未实现情况，停止等主审。
