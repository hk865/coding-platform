# CM M01–M05 独立验收：snap-01 不通过

验收方：独立只读 Agent m_series_acceptance。依据 CM-M01-001 至 CM-M05-001、Module DispatchEngine、runtime-collaboration Interface、architecture-before-m 的分配清单及实际消费者。未修改产品源码、原测试或 Ticket 状态。

## 固定输入

- source-snapshot.json：1315 文件，SHA256 `7ea951d6bad02fac0612dfebab158896fe4f9688ce3b916c7deb0b197f076c9a`。
- 本 Agent 重取 `observed-source-snapshot.json`，数量、指纹一致；HEAD 不作为同源码证明。
- 对比已接受 C snap02 的 `source-diff-from-c.json`。本次缺陷均落在新增/迁移的 M 消费路径；没有把 C 的历史未覆盖直接升级为 M 新缺陷。
- 本轮未另跑全量。主实施方的全量在并行运行；其结果不能消除以下反例。

## 明确缺陷

### M-AC-01 / P1：纯持久调度 wake 消费的终态没有执行后续扫描

位置：`src/app/service.ts:208`、`:407`、`:415`、`:850`。

`DispatchWake` 的 afterDrive 仅 project；执行反馈、返工后的 reverifyRework/prepareReworkReview 在 continueEndedRun 中，而它只由 launchRealDrive 的 then 和开机时对已有观察的扫描调用。30 秒周期扫 outbox、规划、review、rework，却不重新发现新结束的 Run 来执行这段终态后续。

最小触发：正式 HTTP 登记 Handoff，登记已成功但该次直接 launch 丢失；持久 outbox 被后续周期 wake 成功消费。新 Run 确实结束，模型只启动一次，但 continueEndedRun 不触发。准备失败后稍后退避成功、启动扫描发现尚未开始的 replacement 等也进入同一缺口；不能依赖下一次重启来完成本应自动推进的反馈/重验。

独立实测：`terminal-followup.test.ts` 使用实际 HTTP Host、SQLite/Vault、真实执行内核和显式模型协议替身，唯一断点替换是丢失该次 launch，然后调用周期 wake 使用的同一个 RuntimeDispatch.drive。直接路径与丢 wake 路径都产生 2 个 writer 调用（来源 + replacement），都记录 replacement canonical ended；直接路径的 ExecutionFeedbackCompiler.request 包含 replacement，周期路径不包含。`reproduce.log` 两组对照通过的是“缺陷存在”的断言，不是产品通过。

影响：M05-A01 的完整持久恢复扫描未闭合；M04-A03 的执行反馈/返工闭环在该真实入口无法成立。没有观察到双启动，缺陷是已结束工作后续停住。

修复建议：把终态后续作为按完整 RunRef 的持久扫描职责，覆盖所有调度来源；request/验证/审阅调用使用原幂等协议，未知观察保持未知。周期/事件/启动都能补扫，并测试丢 wake 和已知启动前退避成功后，无额外重启仍进入后续。不要仅在 Handoff HTTP 回调补一次调用。

### M-AC-02 / P2：普通失败退避用局部 intentId 找回 outbox，写到另一个 Goal

位置：`src/control/dispatch-engine/dispatch-engine.ts:240`。

每条 failure 已携完整 outboxRef，但代码用 `pending.find(row => row.intent.intentId === failure.intentId)`。intentId 来自 attemptId，是带 Goal/Task 作用域的局部标识；同项目不同 Goal 使用相同 attemptId 合法。

独立实测：通过正式 bootstrap/CreateGoal/ApplyPlan/ClaimTask，在两个 Goal 登记相同 attemptId、不同 runId；令两者 Context 均明确失败。内存与 SQLite 结果一致：第一个 Goal schedule.attemptCount=2，第二个没有 schedule，backlog 为 1 delayed + 1 due。实际应各延期一次。长期会让第一个过早到 quarantine，而另一个重复进入 due。

证据：`same-local-identity.test.ts`、`identities-confirmed.log`。未伪造账本状态，只有 Context 显式材料失败替身。对照组不注入失败时两 Goal 都成功执行。

修复建议：按 failure.outboxRef 的 canonical 完整引用匹配原 entry（Handoff 已如此），测试同项目两 Goal 同名 attemptId，核对各自 attemptCount、原因和 availableAt。

## 被反例排除的猜测

检查了 execution_entered 的 command key 仅含 intentId/generation 的怀疑。相同局部 attemptId 的两个 Goal 在实际内存/SQLite 中均完成，原因 run-fact 不使用 ledger-level idempotency 记录，而按每 Run 的代际/序列/CAS 去重。因此本轮不把这个字符串相同列为缺陷，也不要求为此改写历史键。`identities.log` 保留最初错误预期“只能启动 1 个”的失败记录；根据实测改正对照预期后 `identities-confirmed.log` 为 4/4。同样不能只凭 model input commandId 的字符串判断幂等冲突。

## 逐项判断

PASS 指此小项经源码职责/条件审查及列明证据支持；不能拼接成全票或 I 阶段通过。FAIL 有明确反例；未证实表示不能把当前材料扩展成该完整结论。

| 验收点 | 判断 | 依据与限制 |
|---|---|---|
| M01-A01 | PASS | ordinary/planned/operator 归同一 ordinary consumer；旧 WorkspaceDrive 是同实例 scope adapter；Control claim/start 和 Ledger 事务资格均保留。|
| M01-A02 | PASS | ExecutionSlots 在 Context/Start 前约束容量，同 Workspace 读读可重叠、写等待，跨 Workspace 可越过冲突；最终 lease 未删除。审阅 runtime-concurrency 和真实 Host 的双 reader 证据。|
| M01-A03 | FAIL | M-AC-02 破坏持久退避/公平归属；同名双 Goal 的正常执行对照支持无双启动，不抵消退避错写。|
| M01-A04 | PASS（结构） | 重复 WorkspaceDrive 循环已删除，RuntimeDispatch 只对 exact Run 对账局部串行，执行栅栏/容量与存储筛选一处维护；文档收尾见下。|
| M02-A01 | PASS | QueryExecutionBinding 随 Job/Run 事务写入，Control 与 Ledger 独立核身份/轮次/问题/预算；恢复复用原请求来源。|
| M02-A02 | PASS | inspectQuery 读取 committed journal；缺绑定/无结果留显式待对账且不消耗 pending 配额，不根据本进程不在场重跑。审阅 query-result-recovery 的结果落盘/答案提交中断反例。|
| M02-A03 | PASS | 独立只读内核工具集、无 checkout lease，恢复答案重核来源，feedback material grant 与撤销路径保留；不把返回文本当来源见证。|
| M02-A04 | PASS（列明组合） | 实施 semantic-query 覆盖实际 Host/内核的独立 Query、writer 并行、重复、重启、取消；runtime journal/recovery 定向覆盖未知。模型为替身，不代表外部项目模型质量。|
| M03-A01 | PASS | Reviewer 的 ReviewWork/input/output/session 独立资格保留，逐次模型授权已接，机械事实提交复用；grant 后投影同步仍保留。|
| M03-A02 | PASS | Host HandoffRequest 正式登记 packet/claim，replacement 在选择阶段与 ordinary 排斥；共享槽但不合并资格，Control/Ledger lease 最终排他。独立实际 Host 反例中的 replacement 均唯一完成。|
| M03-A03 | 未证实（完整项） | 当前真实 Host 换手重复/取消及本轮丢 wake 唯一执行已证明；旧 p1-06/reviewer restart 证明相关资格与恢复，但没有因此把所有真实 Handoff unknown/崩溃位置认作全覆盖；并有 M-AC-01 终态后续缺口。|
| M03-A04 | PASS | 无同 Run 热恢复承诺；旧上下文不是新授权；Handoff whitelist 正文进入实际输入，Reviewer 最终报告须独立 session/原正文绑定。|
| M04-A01 | PASS | continueRework 只传公开 issues/feedback 给 ReworkDrive；正式 PlanRevision 由 PlannedTaskDispatch 消费，Verification 未反调 Dispatch。|
| M04-A02 | PASS（已验断点） | 实施 rework-dispatch 两组含“受理后旧进程丢全部唤醒、重建 Host”并由新扫描派发；DurableWake 本身不保存任务存在性。|
| M04-A03 | FAIL | M-AC-01 使纯 wake 结束后的反馈/重验闭环不能成立；已保留计划版本/source pin 守卫与无反向依赖。|
| M04-A04 | PASS（结构） | Host 提取 continueRework 和按 key 扫描合并；内存 Promise 不再是已受理计划存在性的唯一来源。|
| M05-A01 | FAIL | 移除了三类 queue 的状态责任，但遗漏终态后续持久扫描，见 M-AC-01。|
| M05-A02 | PASS | Operator cancel 在能力调用前 SubmitControl；unsupported/unknown 不伪造 cancelled，完整 RunRef 取消键及准备阶段恢复保留。|
| M05-A03 | PASS（启动权部分） | canonical Goal、已受理 Plan、Query 事件和 outbox 可重建，入场栅栏与 lease 不允许双有效启动；不据此宣称全部后续恢复成立。|
| M05-A04 | 未完成 | 源码 composition 改名与仓内调用迁移可核对，未变持久表/事件/引用；但完整生产恢复清单应补终态消费者，及以下当前文档失实条目。|

## 结构要求与文档收尾

结构方向有效：ExecutionSlots、authorizeRuntimeEntry、普通/Handoff 事实消费和 selection 共享降低同一规则维护点；HandoffRequest 隐藏 packet/body/claim 步骤，并非只套转发。Query/Review/Replacement 的不同资格保留，没有万能布尔开关执行接口，没有全仓搬家或 Redis。

当前 Module 文档仍有历史路径和状态冲突：dispatch-engine.md 早段写旧 handoff-drive.ts；第 70 行仍称 Host 生产并行待实施；第 57 行仍称 M06 尚未冻结，与已接受上游和末尾增量不一致。module-status 仍有“新 Run 换手未接”等旧总述。此为用户明确要求的术语/失实注释清理收尾，不能只在文末附一段新状态就保留两套当前说法。历史证据可保留原词，不要求改写持久幂等键。

性能证据目前是 outbox 选择微基准，准确限于混合记录过滤/解析；未独立执行长期增长、进程内存或整产品端到端性能实验。新增 backlog 上限与 SQLite 查询方式经审阅，无据支持 Redis，也不声明整个架构性能验收。

## 重跑及限制

- `bash .../acceptance/reproduce.sh`：实际 Host 终态丢 wake 对照；运行目录已在脚本固定。
- `bash .../acceptance/reproduce-identities.sh`：内存/SQLite 同名 outbox 退避反例与正常启动对照。
- 两脚本使用 WSL 现有 Node24、Vitest、bubblewrap/真实内核；不读取任何用户模型密钥，不访问外部模型。
- 除测试生成的临时 Host 数据外，本 Agent 写入均在 acceptance 目录；未改源码快照。
- 修复需新快照及针对反例的定向验证，再决定集中全量策略；snap-01 不可沿用后续修复后的通过结论。

结论：M01–M05 snap-01 独立验收 FAIL。至少 M-AC-01、M-AC-02 修复前不应放行；M03 完整真实恢复证明与当前文档收尾应随新快照提供。I01–I04 及整批未因此完成。
