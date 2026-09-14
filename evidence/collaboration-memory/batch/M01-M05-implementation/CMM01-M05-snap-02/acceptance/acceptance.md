# M01–M05 snap-02 独立复验

结论：M-AC-01、M-AC-02 均已修复；M03 的真实宿主恢复证明缺口已补齐。独立定向功能/行为复验通过。UI memory 的关闭失败已独立最小化为 M-AC-03：实际 Host 的空 TCP 预连接使 close 挂起。snap-02 最终结论 FAIL，不能放行。M05 当前文档链接/注释清理及集中全量/UI 尚待收尾，不能把本报告写成整批已完成。

## 输入与独立性

输入为 CMM01-M05-snap-02：1318 条目，指纹 `ddd635fab8a354513a4b203946003a2c82cae8185e0768dc3233f22fcf17cff6`。本 Agent 独立重取 observed-source-snapshot.json，完全匹配。

相对 snap-01 仅新增 TerminalContinuation、两份定向测试，修改 service.ts 与普通 outbox 退避定位。继续采用 snap-01 已逐项完成的五票规范/源码职责审查；本轮没有重审未变文件来冒充新增验证。Agent 未改产品源码、原测试或票状态，只写 acceptance 证据及测试临时数据。

## 缺陷复验

### M-AC-01：关闭

TerminalContinuation 从当前登记作用域的观察记录发现候选，并再次读取完整 RunRef 的 canonical 状态：只有 ended、非 outcome_unknown、相同 Workspace 才交给反馈/重验。每轮重新发现，无本地 completed 集合充当权威；局部 DurableWake 仅合并扫描。同轮某条失败收集后继续其他 Run，未来扫描仍可重试。

service.ts 的直接启动完成、DispatchWake.afterDrive、宿主启动共用此扫描；30 秒周期和退避 deadline 经过实际 DispatchWake，因而也进入后续。

独立测试由 snap-01 反例改编，只把丢 launch 后的恢复驱动改为真实 Host 的 DispatchWake.request。原反例直接调用 RuntimeDispatch.drive 会绕过 Host 的 afterDrive，不能用于判断修复无效。直接/丢 launch 两组现在都出现 replacement 的反馈调用，模型仍只有来源与 replacement 各一次。反馈方法可多次调用，持久副作用由既有业务幂等控制，不把“函数只调用一次”误当正确性。

### M-AC-02：关闭

普通 failure 按 canonical 完整 outboxRef 查原 entry，不再使用局部 intentId。内存和 SQLite 实测两 Goal 同 attemptId：两条各 schedule.attemptCount=1、相同正确延期、0 due/2 delayed；正常对照都完成。没有修改历史 RunFact 幂等键。

### M03 真实恢复缺口：补齐

独立执行 handoff-recovery 的四组：direct、丢 wake 后同一 Host 扫描、packet/claim 已登记但未派发时完整 Host 重建、真实内核已经执行但 RunPort 终态回执丢失。前三组均唯一执行并进入终态后续；unknown 组不虚构反馈完成，重启、重放原 Handoff、再 wake 后模型调用数不增加。原 semantic-query 与 Reviewer 隔离/恢复材料继续支持取消、来源绑定及独立审阅资格。

这些用例证明所列断点，不声称覆盖所有进程强杀位置、同 Run 热恢复或真实外部模型质量。

## 独立执行记录

- reverify.log：3 文件、10 例全部通过，包括自有对照 2 例、实际 Host 换手恢复 4 例、内存/SQLite 同名身份 4 例。
- semantic-causes.log：semantic-collaboration 5 例全部通过，包括完整反馈/返工/必要 Reviewer、Reviewer FAIL 不满足、人的决定及 before_apply/before_query 故障恢复。夹具还断言 settled 重放不新增模型调用、ReviewWork/ReviewResult/Evidence。
- 共独立执行 15 例，未另跑全量。reverify.sh、trace-semantic.sh 固定 WSL Node24/Vitest/现有 bubblewrap；真实 Host、SQLite/Vault、执行内核与工具，模型为明确协议替身，不读用户密钥。

主线程全量曾看到 Terminal continuations require reconciliation 的 stderr。本 Agent 在 evidence 下包装 scan，仅展开 AggregateError.errors 后原样重抛，单文件重跑未再出现该错误，5 例均通过。源码中 ReworkVerification 在复用旧轮次前检查材料 current，不允许 stale 时新执行；TerminalContinuation 单条失败不阻塞其余候选。当前没有支持双执行或错误通过的反例；不把未重现解释为已经查明该全量警告原因。若集中全量最终失败，必须根据具体失败再判断本结论适用性。

## 逐项结论

下列 PASS 是对应小项的源码审查及列明证据结论，仍需集中冻结验证收尾；不能推出 I01–I04 或整批完成。

| 条目 | 结论 | 依据 |
|---|---|---|
| M01-A01 | PASS | ordinary/planned/operator 与旧 WorkspaceDrive 共享持久普通消费者，Work/权限与双层准入保留。|
| M01-A02 | PASS | 本地共享容量支持读读并发、写等待及独立 Workspace 前进，跨进程最终 lease 保留。|
| M01-A03 | PASS | M-AC-02 已关闭；同名正常执行/退避对照、原并发重复与恢复证明共同支持本项。|
| M01-A04 | PASS | 去掉重复普通消费循环与全局运行 queue，职责/命名/规则共享有实际调用者。|
| M02-A01 | PASS | 原轮次请求/来源绑定与 Job/Run 同事务，Control 和 Ledger 校验未削弱。|
| M02-A02 | PASS | committed exact 结果恢复，无结果保留可见需对账，不盲重跑。|
| M02-A03 | PASS | Query 独立只读、来源/撤权复核及反馈材料授权保留。|
| M02-A04 | PASS | 原实际 Query/writer 并行、重复/重启/取消/未知证据，本轮完整语义反馈闭环回归。|
| M03-A01 | PASS | Reviewer 独立输入/输出/session/资格保留，启动栅栏、许可与事实机制复用。|
| M03-A02 | PASS | 正式 Host Handoff；ordinary/replacement 选择互斥，领域资格及 Task lease 未合并。|
| M03-A03 | PASS | 实际 Host direct/wake/restart/unknown 补验通过；取消及 Reviewer 资格回归证据保留。|
| M03-A04 | PASS | 无同 Run 热恢复或合并授权承诺；不伪造 Reviewer 报告。|
| M04-A01 | PASS | 公开 issues/feedback 传 Rework，正式 PlanRevision 交唯一 PlannedTaskDispatch。|
| M04-A02 | PASS | 原受理后丢 wake 完整重启证明，本轮终态后续丢 wake 证明补齐。|
| M04-A03 | PASS | M-AC-01 已关闭；本轮 semantic-collaboration 5 例验证版本、反馈、返工、必要审阅闭环及 settled 重放。|
| M04-A04 | PASS | Host 编排有职责入口，持久计划存在性不依赖 promise queue。|
| M05-A01 | PASS | 增补终态扫描，ordinary/Query/Review/Handoff/planning/rework/terminal 的持久发现与 wake 责任可核对。|
| M05-A02 | PASS | cancel 先持久 desiredState，能力 unsupported/unknown 不冒充确认取消，作用域完整。|
| M05-A03 | PASS | 启动扫描与实际 Handoff 重建不依赖旧内存状态，唯一执行和 unknown 不重做有新对照。|
| M05-A04 | FAIL（关闭及文档收尾） | 旧库/代码消费者迁移与换手恢复证明已核对；M-AC-03 阻止实际浏览器宿主关闭/重启，另有 README 两处失效链接及一处旧 queue 注释待修复。|

## 文档与结构收尾

当前 Module 的旧 Handoff 路径、M06/C 未冻结状态、Host 并行未接说法已改正；新增 consumer-recovery-map、production-callers、file-list 能核对生产职责和退役入口。

仍需完成：src/harness/README.md 链接已删除 persistent-harness.ts；src/contracts/README.md 仍指向 ../harness/rework-composition.ts；coordination-drive.ts 文件头旧 queue 名称的历史说明待整理。retired-import-search.txt 的三个 Markdown 命中不是生产导入；清单“文件为空”的错误表述已回交主线程，更正时保留原始检索证据，不删合理历史说明。

主线程已同意在冻结验证结束后仅修正文档/注释，以精确差分与新指纹核对，无需因为链接改动重跑行为全量。届时独立确认没有可执行语义变化后，可沿用本轮行为证据，并关闭 M05 文档项；本报告不预先接纳未出现的源码。

新增 TerminalContinuation 不创建第二套完成权威；同业务规则仍由原反馈/Verification 的持久身份执行。没有扩展全库目录重构或 Redis。性能测量仍只覆盖已有 outbox 查询微基准，未证明长期终态扫描规模/端到端延迟；不得把这份功能复验写成全面性能承诺。

## 交付状态

snap-01 FAIL 历史保持；snap-02 两项运行缺陷关闭，独立功能复验通过。最终 M01–M05 交付尚须正在运行的集中全量/UI 结果与上述仅文档收尾，不由本报告自动宣布完成。I 阶段应采用最终实际源码，不拼贴旧票通过。

## 收到的 UI 关闭失败（结论保持待定）

主线程告知 ui-regression.log 的 memory 首例保存成功，但 fixture.restart/app.close 超时 120s，截图仍在旧页面并显示 Ledger 已关闭。此失败不在本 Agent 的15例定向范围中。只读 server.ts 确认：先发起 service.close，然后 await Runtime.close，之后才调用 HTTP server.close；服务可能已经关闭 Ledger 而 HTTP 仍接受轮询。建议记录 Runtime.close/flush、HTTP close调用/回调和 service排空三个阶段及连接数，区分执行排空与连接关闭。当前证据不足以归因，也不应用 page.close 绕过实际宿主生命周期问题。

在主线程给出该失败的复现/修复或充分排除证据前，本报告只关闭 M-AC-01/02，不作五票最终通过结论。

## M-AC-03 / P2：空 TCP 预连接阻止实际 Host 关闭（已独立确认）

位置 src/app/server.ts:93。使用当前 dist 的 createGuiServer，监听本机后仅 node:net.connect 建立一个不发送 HTTP 字节的连接，无浏览器、模型、查询或记忆操作。app.close 在一秒后仍未返回；销毁该 socket 后仅 1ms 即结束。独立命令 exit1，见 preconnect-repro.mjs / preconnect-repro.sh / preconnect-repro.log。因此不是模型执行慢或 Ledger 排空慢，而是空预连接存活阻止 HTTP close 回调。

这是旧 Host 关闭路径在本轮 M05 实际退出/浏览器重启范围暴露的缺陷，不宣称由 snap-02 的终态修复引入，也不追溯撤销 C 在其限定测试范围的结论。

方案审查：共享单一 close Promise；关闭开始停止监听并拒绝后续新请求；追踪完整 HTTP handler（workspace/model settings 等并不属于 service.background）；排空已受理操作与 Runtime 后清残余连接，再等 HTTP close 回调。空预连接不应阻止排空。新增已发 headers、body 未完整的真实 POST 对照，证明补齐 body 后持久操作与回执仍完成，避免用无差别 destroy 全连接掩盖问题。handler 的失败/客户端断连也需 finally 移除。若选择排空已经进入 handler 的 body，则永不补齐的上传不属于固定时限关闭承诺，需如实标明。

snap-02 最终 FAIL：M-AC-01/02 已关闭，M-AC-03 待修复；文档收尾仍待精确差分。新修复必须针对新快照复验，不能将本报告修改成 snap-02 通过。
