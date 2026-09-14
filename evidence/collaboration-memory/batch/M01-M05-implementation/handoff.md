# M01–M05 集中实施交接

当前状态：M01–M05 已独立逐项 PASS，统筹接纳 CMM01-M05-snap-03；1319 文件条目，SHA256 4064c26af78bf34b361623dab13338e8f3296708384129dff6b7577b2b85fb1f。稳定受影响集183例通过，UI31通过/1条件跳过；M-AC-01/02/03全部关闭。旧FAIL保留，I01–I04及整批未完成。

## 输入与范围

正式票：文档根 dev_docs/planning/active/collaboration-memory/CM-M01-001.md 至 CM-M05-001.md。C snap02 是最后已独立接纳上游；M01/M02 的 working checkpoint 仅标记实施输入，不是独立 PASS。产品 HEAD 没有代替逐文件指纹。

已遵循 architecture-before-m 的行为/接口映射及分配清单：先明确责任、接口和持久权威，再按职责归组及共享同一规则。不删除 Control 准入与 Ledger 事务复核，不把 Review、Query、普通运行、Replacement 混成一种身份。不引入 Redis。

## 已实现与逐票证明入口

| 票 | 行为与接口 | 主要定向证明 |
|---|---|---|
| M01 | 普通/计划/旧 workspace drive 共用一个消费者；全作用域筛选先于 limit；本地只读并发与写排队；持久失败退避和工作台积压 | scoped-dispatch、runtime-concurrency、dispatch-wake、initial-planning、实际构建工作台积压 |
| M02 | Query 精确轮次请求与来源持久绑定；结果落盘后对账；无回执不盲跑；取消先落 canonical 状态；未知状态可见 | query-result-recovery、runtime-observation-journal、semantic-query、p1-09；实际工作台查询取消 |
| M03 | Reviewer/普通/Handoff 共享执行栅栏和事实消费；正式 Handoff Host/UI→packet→Replacement→准备→Runtime；有界材料真正进入模型输入；独立审阅资格、来源与撤权保留 | semantic-query、handoff-drive、p1-06、independent-review、reviewer-product-recovery、reviewer-start/lease/isolation |
| M04 | continueRework 捕获公开验证/反馈材料；仅产生 canonical Plan，由 PlannedTaskDispatch 消费；DurableWake 合并扫描，不保存任务存在性 | rework-drive、rework-task-dispatch、rework-dispatch 两种模式（正常与受理后丢失全部旧进程唤醒）、initial-planning |
| M05 | 启动/事件/30 秒计时唤醒；canonical Goal 发现；旧全局 queue 状态职责移除；取消 desired state 在能力调用前提交；unknown/unsupported 不冒充 cancelled；生产装配改名与内部归组 | durable-wake、operator-cancellation、RuntimeDispatch 恢复、真实 Host 重启/取消/独立审阅恢复及边界检查 |

上述“证明入口”不是通过宣称；最终结果以冻结验证记录和独立结论为准。

## 结构变化与行为变化分列

结构：src/composition 接管原生产 persistent-harness 及其跨模块材料装配，名称为 createPersistentPlatform。测试复用相同装配；原 in-memory harness 仍属于测试使用。Dispatch 的 execution/ 维护容量、执行入口、逐次模型许可、持久退避；handoff/ 维护请求、准备和消费。src/app/scheduling 承担宿主唤醒生命周期、返工续接和只读恢复视图。

行为：原全局 RuntimeDispatch queue 已撤；同 Run 的 reconciliation Map 保留防止本进程对账交错。planningQueue/semanticReworkQueue 由按 key 的扫描合并替代；唤醒期间新信号触发再扫描。ReviewWork 自己的执行资格保留。共享 ExecutionSlots 只降低本地无谓租约竞争，跨进程最终权威仍在账本。投影和 HTTP 动作串行区保留明确的宿主一致性职责。

实际去重：普通与 Handoff 的 StartRun→execution_entered 栅栏一处维护；普通、Reviewer 与换手路径共享容量规则；普通/Handoff 的已知启动前失败共享持久退避；旧 WorkspaceDrive 不再复制普通消费循环。不会把仅形状相似的领域资格校验合并。

## 本轮发现和修复的生产缺陷

1. Handoff ContextBundle 缺少 workspace/run/attempt/sources/dependencies；Runtime 严格检查导致首次真实消费者失败。补齐生产者，保留检查强度；同时将有界 handoff 字段加入实际输入及 manifest，避免只存不消费。
2. Reviewer 先前未连接逐次模型许可。接入后发现 Host 便捷接口未导出该方法；不能简单全换成底层 Control，因为材料授权需投影同步才可读取。当前窄接线保留 grant 后同步，模型许可直接进 Control。
3. 换手前本地 cancelled 观察可早于 canonical ended；UI 等待 canonical ended，提交再核对。
4. Query 运行结果存在内存但尚未保存时不得被 inspect 当作可恢复结果；读取已提交 observation。
5. 取消幂等键绑定完整 RunRef，避免跨 Goal 同名 Run 相撞。

## 旧库与历史证据

未改变持久事件名、表名、旧引用或已有摘要。新 Query execution binding 是可选新增字段；旧 running Query 没有精确请求时显示需对账，不推断可重跑。旧 authorized 未进入代际按已建立恢复协议处理；entered/未知效果不自动重做。生产源码改名不搬数据库，旧证据中的旧路径保留为历史。

## 测量与范围限制

SQLite 选择微基准包括每个选中 outbox 的一次索引 replacement 查询：1000 条混合记录约 3.31→0.53ms，10000 条约33.15→5.91ms，分别只解析10/100个目标候选。它是本机孤立查询测量，不是端到端延迟、并发数据库或长期增长承诺。没有新增缓存或索引 schema。

运行测试使用真实 Host、SQLite、ArtifactVault、执行内核/工具和浏览器，其中模型为显式协议替身或本地 HTTP 协议服务，不宣称真实模型在外部项目的自主任务质量、图像能力或 I01–I04 综合效果。全库读模型投影深拆、12模块统一目录改造、通用缓存均未扩入本票。

## 收尾要求

完成定向修复、规范和文件清单后固定源码，集中跑一次全量。全量发现缺陷则集中定向修复并记录是否需新全量。独立验收使用准确快照与本轮差分；M PASS 不自动放行 I 的完成结论。


## 冻结前验证结果

M05 targeted-05：20 文件83例通过；该次早期类型检查发现新增取消测试缺少括号，已修复，types-07 与两例取消定向均通过。UI typecheck 为0诊断。新构建 build-06 与真实工作台 handoff/query-cancel browser-06 通过，截图已人工查看。M05 boundary-05 issues为空。

失败轨迹如实保留：M03 Context生成身份遗漏、Reviewer许可缺失及授权投影同步遗漏已集中修复。browser-04 的构建失败后误跑旧构建属于无效浏览器证明，不能采用；browser-06 已新增构建失败即停并使用最新 dist 通过。

最终全量、UI、文档与独立结论见 CMM01-M05-snap-02/，若回交缺陷则不沿用当前通过结论。

## snap-01 独立发现的集中修复

M-AC-01：TerminalContinuation 从已登记作用域的持久观察和 canonical Run 终态发现反馈/重验，所有 DispatchWake、直接启动、宿主启动触发同一入口。unknown 不续接，不用内存 completed 集合作正确性权威。新增实际 Host 换手 direct/wake/restart/unknown 四例；执行次数、反馈和重启后不重做均核对。

M-AC-02：普通失败按完整 outboxRef 找回持久退避对象；内存与 SQLite 的同项目两 Goal 同 attemptId 各延期一次，正常对照各自执行。新增 tests/control/dispatch-same-local-identity.test.ts。

repair-01 保存原始类型失败（新测试 HTTP JSON unknown 类型）及修复后检查，12 项定向通过。清理当前 Module 的旧换手路径、M06/C 状态和 Host 并行未接等失实说法；历史验收不改写。snap-01 原报告仍保留。



## snap-03 关闭及文档收尾

M-AC-03 的空TCP预连接关闭反例已定位并修复；server跟踪完整HTTP请求和响应后再清残留连接，含不经service的直接路由。新增server-shutdown两例，原浏览器现场和最小反例保留repair-02。修复两处README失效链接及协调驱动旧queue注释。旧返工夹具预先声明显式Work，要求真实Handoff自动复用/link；Handoff窗口断言适应limit前筛选，仍核对Review隔离及ordinary退避。详见CMM01-M05-snap-03/verification.md。


## 后续验证的构建纪律

源码冻结后先集中构建内核和工作台，记录构建产物指纹。使用这些产物的测试与独立验收可以并行，但任何仍会执行 kernel:build 的浏览器启动脚本不能与读取同一 dist 的测试并行。需要重新构建时先结束旧验证并记录新产物；不把构建中的模块读取失败解释成业务资格错误，也不直接删除失败记录。M snap-03 保留了此次失败与固定685构建文件后的完整复跑。

## 最终接纳

[正式独立报告](CMM01-M05-snap-03/acceptance/acceptance.md)逐票PASS；[验证](CMM01-M05-snap-03/verification.md)列明旧全量复用、稳定183例、UI31例、跳过与全部失败轨迹。源码与685构建文件结束复算一致。统筹仅更新文档和票状态，不再修改本次源码。后续进入I01–I04。

