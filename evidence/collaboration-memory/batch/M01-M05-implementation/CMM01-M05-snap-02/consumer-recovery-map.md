# 生产消费者与恢复责任

| 入口 | 持久权威与唯一消费者 | wake 与恢复 |
|---|---|---|
| 人工/计划/旧 workspace 并行 | canonical Claim/Run/DispatchOutbox；同一 DispatchEngineImpl | DispatchWake 事件、deadline、周期；RuntimeDispatch 对账 |
| Query/执行反馈 | QueryJob/QueryRun 精确请求绑定，已提交运行结果 | pending query scan、inspect、答案原校验；unknown 显示需对账 |
| Reviewer | ReviewWork/独立 session/输出绑定；ReviewerDispatch | resumePendingReviews 启动和周期；授权恢复后原消费者 |
| Handoff | HandoffPacket/ReplacementAttempt/Task lease；HandoffDrive | Host登记后、周期和完整启动恢复；ordinary 选择排除 replacement |
| 已结束普通/换手 Run | 持久观察加 canonical ended；TerminalContinuation | 每个 DispatchWake afterDrive、直接启动、Host启动；反馈/重验持久幂等，unknown不消费 |
| 初始规划 | canonical Goal/Query/PlanRevision | planningWake 扫描已登记作用域 Goal；不要求本地 Run存在 |
| Rework | 公开 issues/feedback → canonical PlanRevision | reworkWake 合并扫描；PlannedTaskDispatch唯一消费；接受后丢 wake可从账本找回 |
| cancel | Control desiredState先提交，Runtime能力随后调用 | unsupported/unknown 不改变成确认取消；重启由原Run事实对账 |

生产装配入口 src/composition/persistent-platform.ts；ordinary/Handoff/Reviewer 接同一 ExecutionSlots。具体检索与行号见 production-callers.txt。retired-import-search.txt 有 3 处 Markdown 命中：一处 composition 历史说明、两处待修正的 README 链接；当前运行代码和测试不再导入旧生产 harness 路径或旧工厂名。两处失效链接待冻结验证后作精确文档修复，不把检索命中等同代码依赖。

RuntimeDispatch 全局 queue、planningQueue、semanticReworkQueue 已撤掉。剩余协调文件头注释中的旧 queue 字符串属于避免竞争的历史解释，不是运行中的实例。local serial 保留投影/HTTP动作一致性；reconciliation Map只针对完整Run；DurableWake只合并扫描；ExecutionSlots只做本地容量及写排队，最终资格与跨进程排他仍由账本确认。

不迁移数据库表、事件名或旧身份。旧 Query 没有新的绑定不能凭空恢复模型请求；entered/未知效果保持需对账。取消不承诺同Run热恢复。

