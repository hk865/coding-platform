# R5a初始化 / R4.2工具组安全点中审与验收

2026-09-26。前序W2/C2已通过99文件975项完整隔离；本报告仅记录后续两批，不把骨架当成已交付能力。源码默认next，旧工程只读。证据暂沿用当日evidence/next-b2-2026-09-26目录。

## 最终验收

两批均已合入，完整物理隔离102文件/1,007项通过，types/build/6of8允许边界/24Kernel产物再生/编译入口open-close全部通过，原8,827文件无变化。隔离时next/src为194文件43,116物理行，较前序增加1,614行；新增能力不等于代码净缩减或性能提升。

R5a真实空SQLite→Project/Workspace→政策安装/启用→Goal/初始架构/Plan采用及重开回执已通过；已采用Plan保留原policy pin。5个初审响应窗口/精确pin问题修复后独立4文件26项通过。R4.2的真实before/after_group等待、并发排空、required pause sink、同identity恢复和callback异常最新state归约独立5文件68项通过，24项源/产物完全一致。平台R4.1/3–5、Query、完成、Workflow/HostUI仍未闭合。

最终证据：[隔离结果](evidence/next-b2-2026-09-26/r5a-r4-isolated-result.json)、[完整日志](evidence/next-b2-2026-09-26/r5a-r4-isolated.log)、[旧文件保护](evidence/next-b2-2026-09-26/protected-check-r5a-r4.json)、[R5a导入](evidence/next-b2-2026-09-26/r5a-final-implementation-import.json)、[Kernel导入](evidence/next-b2-2026-09-26/r4-tool-group-final-implementation-import.json)、[24项再生](evidence/next-b2-2026-09-26/r4-tool-group-final-repro.json)。以下各阶段保留当时红/绿边界，不代表当前未实现。

## R5a 骨架中审

6生产/2测试，scope无越界及主树冲突。四Host writer仍unsupported，新四事件codec显式未实现；复用唯一Project/Workspace/政策schema、摘要和真实组合根close/drain。原任务书接口、唯一摘要提取和组合接线可保留。

首轮独立15红/39旧绿、types通过。测试需纠正foreign target错误码、同键真正并发、提交成功后取消、policy/architecture前置因果、两类版本区分、独立固定digest及真实事件归因。已派只改两测试返修，不提前实现生产。返修交回后独立复验17红/39旧绿、类型与最终测试独审通过；后段被Project stub遮挡，尚无空库产品闭环PASS。

8文件已按原树hash导入，见r5a-reviewed-skeleton-import.json。阶段二只写project-bootstrap-service与project-bootstrap-record-codecs两个生产文件，接口/测试/组合根冻结。implementation lane已运行，DSH session-cdb53e46-352c-4ea0-8b4c-82d447c2ffc8。

## R4.2 骨架中审

主审从当前maps精确提取runner与两个Kernel组合根；六受管源24项基线逐字再生，未改变原运行字节。独立scope为5源/16对应产物/1测试，生产独审确认DTO、run/identity-resume/public-resume三处callback透传、原before_model保持、唯一Runner与明确unsupported接缝。实际变化4源/15产物/1测试，无越界；public-api运行JS不变。

独立6红/61绿（目标10项中4绿、原公开Kernel/Runtime57绿），types及24项再生通过。测试中结果required sink未悬停、resume callback未被观察、失败清理与取消工具ID断言需收紧；四项修订和group3等待三方竞速已独审通过，最终6红/61绿及types通过；20文件骨架按原hash导入，测试冻结746a787b…，见r4-tool-group-reviewed-skeleton-import.json。第二阶段仅runner及4生成物，session-b71e2e7d-035e-4a66-83da-495079d149ba，其他源/测试只读。真实pause/drain与平台控制均尚未交付。

## 独立证据

- [R5a初审测试](evidence/next-b2-2026-09-26/r5a-middle-initial-tests.log)、[类型](evidence/next-b2-2026-09-26/r5a-middle-initial-types.log)；返修独审见r5a-middle-final-tests/types.log。
- [R4目标与旧路径](evidence/next-b2-2026-09-26/r4-tool-group-middle-tests.log)、[类型](evidence/next-b2-2026-09-26/r4-tool-group-middle-types.log)、[24项再生](evidence/next-b2-2026-09-26/r4-tool-group-middle-repro.json)、[中审任务刷新](evidence/next-b2-2026-09-26/r4-tool-group-middle-refresh.json)。

R5a初始化与R4.2Kernel子能力写范围不重叠。R4.1持久控制、R4.3–5实际投递/ack/恢复、Query、检查完成与Workflow/Host/UI继续由现有任务书推进；没有为这两批加入Role热换、全局锁或第二执行库。

## 实现初审返修

R5a初审时独立13文件81项/types通过、尚未合入。发现真实提交成功后响应丢失未恢复、必要读期间取消后仍提交、政策expected引用不精确、同键activate晚读的回执竞争，以及未读取就报告current:0。仅补实际薄包装回归并返修原两生产文件；不增加内部篡改状态或重复验证框架。

R4.2初审实现交回时，专项/邻接独立运行中。callback在组后抛错会跨出executeTools，外层还持有工具执行前state；须证明失败事件使用已完成工具后的真实state/sequence，不能丢失结果。新增最小实际Kernel回归后仍只修runner及其对应产物。

完整隔离首次102文件1007项中，1005通过；唯一旧composition/platform.test.ts在Memory/SQLite两行路径的Object.keys清单缺R5a公开projects/completionPolicies。主审按已审核公开契约仅同步这两个名字，其他行为断言不动；重新完整隔离。首次日志保留为r5a-r4-isolated-first.log。
