# M01 实施决定

D01：WorkspaceDrive 保留原公开 driveParallel 入口，内部成为同一个 DispatchEngine 实例的 scope adapter。普通/旧并行共用启动/执行许可/Work材料/事件消费/并发额度。scope 在 outbox limit 前过滤，避免其他 Goal 占据窗口。该 adapter 的价值是兼容原入口及其作用域，不新增状态责任。

D02：先集中收敛重复生命周期，后处理 Host 全程串行、积压与 wake；此工作段不是 M01 完成。旧 C 快照保留。共享选择规则由 StateLedger 内部维护，两种存储 adapter 复用；SQLite 先筛选派发记录再解析，不为复用加载全部聚合。

D03：旧 parallel 迁移后采用 ordinary 的持久 backoff，材料缺口不再每次 wake 立即重试。旧 Reviewer 隔离测试中的三次立即重试期望调整为首次检查、随后延期；仍断言 ReviewWork 原记录不变、零 Review 材料/Runtime 调用以及普通 intent 身份不变。此为明确的调度行为迁移，不削弱隔离断言。

D04：RuntimeDispatch 不再串行整个 drive；仅 exact Run 的事实对账局部串行。普通、计划、人工和 Host wake 均进入同一 outbox owner，同进程重复扫描由 exact outbox in-flight 排除，跨进程继续用账本 CAS/执行许可。

D05：计划入口取消依赖本地 Runtime 全工作区活动列表的串行闸门，一次认领当前 revision 所有独立合格任务。实际容量与冲突由共享 consumer 控制：只读可重叠，同工作区 writer 排队，后来的 reader 不越过等待 writer，其他工作区可使用空闲槽。排队项未取得启动权，持久 pending 不因本地队列消失而消失；租约终审保留。

D06：驱动结果和工作台共享 backlog 解释规则。界面读 exact Project/Goal 的 canonical pending，独立标明 observedAt，不冒用投影 cursor；超过 2000 项明确不可完整展示。Host 的 DispatchWake 负责并行请求与最早重试期限的再扫描，timer 不拥有业务存在性。

D07：计划并行测试发现旧断言允许 barrier 超时后仍从后续流程通过。新增明确 readersOverlapped 断言，超时不得计为并行成功。旧返工入口测试的一次只领取一个任务假设改为全部独立任务领取、确定性身份不变与重复扫描无新增启动。写冲突场景由旧“第二个已知启动前失败”升级为 pending 后顺序完成；不削弱真实租约。

当前定向证据：check-08 核心类型与 UI 类型均 0；8 文件 29 用例通过，含真实 HTTP/Runtime 只读重叠与持久 SQLite writer 排队。边界 issues 空，文件归属检查通过。浏览器单独进行中。尚未冻结、未全量、未独立验收，不据此宣布 M01 或 M 批完成。
