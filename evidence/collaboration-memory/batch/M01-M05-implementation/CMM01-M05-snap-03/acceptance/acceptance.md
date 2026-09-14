# CM-M01-001 至 CM-M05-001 最终独立验收：PASS

本结论针对 CMM01-M05-snap-03 的五张 M Ticket 工程交付范围。三项独立缺陷全部关闭，逐项验收通过。允许统筹据此更新 M01–M05 状态；不代表 I01–I04、整批项目或真实外部模型任务效果完成。

## 精确输入与验证适用性

- 源码：1319 条目，SHA256 `4064c26af78bf34b361623dab13338e8f3296708384129dff6b7577b2b85fb1f`。
- 本 Agent 在进入复验、结束稳定集中测试后分别独立重算，始终匹配。见 observed-source-snapshot.json、final-observed-source-snapshot.json。
- 构建产物：dist + vendor/coding-agent/dist 共685文件，SHA256 `0dd6cf0912a57b0569315aaf4c883713f6ce3ebe9918f62096809b3b43acd9b2`。本 Agent 在稳定运行中和结束后独立重算，与实施方 before/after 一致。见 observed-artifacts-during-stable.json、final-observed-artifacts.json。
- 独立 observed-diff-from-snap02.json 与声明一致：1新增测试、6处修改。唯一生产可执行变化是 server.ts 关闭生命周期；另为一处注释、两README及两旧测试迁移。snap-02 已复验的其他行为未变。

采用“已完成全量结果 + 精确差分 + 稳定产物上的全部受影响集”证明最终交付，**不是 snap-03 重新运行一次全仓全量**：

| 证据 | 实际结果与适用性 |
|---|---|
| snap-02 完整全量 | 334文件：330通过、2失败、2跳过；2211通过、3失败、5跳过。旧失败保留，不能称全量PASS。|
| snap-03 旧失败迁移 | Reviewer隔离两存储及有界返工旧fixture修正，原资格/隔离/预算断言保留，改由真实消费者建立link；独立复跑通过。|
| snap-03 初次受影响集 | 20文件失败，77失败/105通过。与UI触发的vendor dist重建重叠，保留原日志，不据单个重跑通过忽略它。|
| snap-03 稳定受影响集 | affected-stable.log/result：39文件、183例全通过，exit0；包含完整tests/app、直接消费Host的memory/query-input及两旧失败文件。源码和产物前后不变，没有修改timeout。|
| snap-03 全套浏览器 | ui-regression.log/result：31通过、1条件跳过、exit0。原memory保存后宿主重启例实际通过；不把跳过算通过。|
| 独立定向 | snap-02 复验15例；snap-03 复验4文件6例，另运行原dist空连接脚本。分轮保留，不累计成无重叠覆盖数字。|

根build会先运行kernel:build，vendor build通过tsc写入同一个vendor/coding-agent/dist；public-api重导出createEditToolDefinition。初次失败多条Query在usage/trace为空时明确报“createEditToolDefinition is not a function”，当前构建文件中该函数存在。共享产物装载时被重写的判断有具体错误和构建链依据，但没有捕获当时瞬时模块字节，不能宣称逐个证明77条失败的内部原因。最终采用无构建写入、全新进程、前后产物一致的完整受影响集通过来消除交付不确定性，而非删除旧失败。

## 三项独立缺陷全部关闭

### M-AC-01：纯wake的终态后续遗漏——关闭

TerminalContinuation 从登记作用域的观察与完整RunRef canonical ended重新发现普通/换手终态。排除unknown及不匹配Workspace，再走原反馈、重验与必要Reviewer准备。直接启动、DispatchWake.afterDrive、Host启动共用扫描，周期与退避deadline通过同一DispatchWake进入。局部wake只合并扫描，不用本地completed集合代替持久完成事实。

独立原反例已改为真实Host的DispatchWake触发：直接/丢launch两组都唯一执行replacement并调用反馈。旧反例直接调用RuntimeDispatch.drive绕过Host.afterDrive，不能作为修复失败的依据。整条语义反馈/返工/必要Reviewer与settled重放也在独立5例及稳定受影响集中通过。

### M-AC-02：跨Goal同名intent退避错写——关闭

普通failure按canonical完整outboxRef找原entry。内存/SQLite的同项目两Goal同attemptId均各延期一次，attemptCount=1，0 due/2 delayed，正常对照各自执行。未为猜测的字符串冲突改写历史RunFact键；snap-01相同局部ID正常执行对照已排除那项猜测。

### M-AC-03：空预连接使实际Host关闭挂起——关闭

原实际dist Host只开node:net空连接，曾1秒未结束、销毁socket后1ms结束。新dist原脚本1秒内close成功，不依赖先关闭客户端socket。

server同步停止监听/拒绝新受理，追踪完整HTTP handler及response finish/close，close共享同一Promise。Runtime及已受理HTTP工作排空后关闭service/存储与Workspace，再清理没有请求可排空的残留连接并等待HTTP关闭回调。

独立覆盖：空连接与重复close、已发headers未完整body的Goal请求关闭后补齐并在重启后读取持久结果；额外settings-drain.test.ts证明service.action之外的model-settings操作也得到200回执并持久保存。真实浏览器原memory重启超时例通过。排空已进入handler的上传不等于承诺永不补齐body的客户端也能固定时间关闭；未用page.close掩盖产品生命周期缺陷。

## 逐项最终结论

所有PASS均限定于Ticket工程义务及上述证据，不表示穷尽所有操作系统强杀位置或真实模型质量。

| 验收点 | 结论 | 依据 |
|---|---|---|
| M01-A01 | PASS | ordinary/planned/operator与旧WorkspaceDrive归同一持久普通消费者，Work/输入权限和双层准入保留。|
| M01-A02 | PASS | 真实读读并行、同Workspace写等待、独立工作前进；Control/Ledger与lease最终排他未删除。|
| M01-A03 | PASS | 重复/恢复及持久backlog、退避证据；M-AC-02跨Goal反例已关闭。|
| M01-A04 | PASS | 删除重复普通消费循环与全局执行queue，共享槽/执行栅栏/筛选有真实调用者，当前说明已更新。|
| M02-A01 | PASS | Query精确轮次请求与来源同Job/Run事务绑定，Control和Ledger分别复核身份、问题、预算与轮次。|
| M02-A02 | PASS | committed exact结果对账；无绑定/无回执保持可见需对账，不盲重跑，也不阻挡pending配额。|
| M02-A03 | PASS | 独立只读工具、无checkout写权；来源/撤权/B回应及执行反馈选材回归保留。|
| M02-A04 | PASS | 实际Host/内核Query、writer并行、重复、重启、取消、未知结果及memory/query-input在稳定集验证。|
| M03-A01 | PASS | Reviewer独立ReviewWork/input/output/session资格保留，实际模型许可和grant投影同步存在，机械启动/事实复用。|
| M03-A02 | PASS | 正式Handoff Host入口与Replacement消费者，选择先于limit排除ordinary；共享容量不合并领域资格。|
| M03-A03 | PASS | actualHost direct/wake/restart/unknown四组、取消及Reviewer隔离/恢复；unknown后重启/重放/wake无额外执行。|
| M03-A04 | PASS | 不承诺同Run热恢复，不继承旧授权；Reviewer原报告绑定，不制造PASS。|
| M04-A01 | PASS | 组合根传公开issues/feedback，Rework只产生正式PlanRevision，唯一PlannedTaskDispatch消费。|
| M04-A02 | PASS | 受理后丢wake完整Host重启恢复，终态wake遗漏反例也修复；持久身份保证重放。|
| M04-A03 | PASS | 无Verification→Dispatch反向依赖；版本/source pin/反馈/重验/必要审阅闭环与settled重放通过。|
| M04-A04 | PASS | Host编排按职责提取，已受理计划及恢复不依赖promise queue存在。|
| M05-A01 | PASS | 普通、Query、Review、Handoff、planning、rework、terminal的持久发现和事件/计时wake清单可逐入口核对。|
| M05-A02 | PASS | cancel先提交desiredState，unsupported/unknown不假称取消成功；完整RunRef作用域及准备阶段取消保留。|
| M05-A03 | PASS | 启动扫描不依赖旧队列，完整Host重建唯一执行；关闭排空保留已受理持久操作。|
| M05-A04 | PASS | 旧库/退役入口/生产消费者清单、真实恢复与取消反例已交付；M-AC-03及当前README/注释收尾已完成。|

## 结构整理、兼容与旧测试复核

保留12模块依赖方向；execution/共享容量、入场代际、模型许可、退避，handoff/保留独立资格与材料职责，composition承接真实生产装配。WorkspaceDrive不再复制普通循环。抽象确实隐藏机械步骤，没有把Query/Reviewer/Replacement统一成万能权限函数，也没有删除Control受理与Ledger同事务必要复核。

reviewer-existing-drivers-isolation的新窗口期待符合真实选择，仍断言review原记录不变、无review Context、普通intent不变及仅一次退避。p1-15-role-rework-loop在直接Control启动的source后先正式bind指定Work，再断言真实Handoff复用并自动link；不再由测试自己造replacement link。没有放宽生产资格或预算。

两README失效路径已改为实际composition位置，coordination-drive文件头旧queue说明已修正；Module/current-state冲突已在前轮清理。consumer-recovery-map、production-callers、retired-import-search、file-list区分当前代码导入与合理历史Markdown命中。未改持久表、事件、旧字段摘要与身份；旧Query无精确绑定时不推断可重新调用模型。

性能证据仍限定于outbox查询微基准，不是长期终态扫描/全产品端到端性能承诺。没有引入Redis或全仓目录重写；那些事项没有被用来缩减五票当前入口义务。

## 最终放行边界

CM-M01-001、CM-M02-001、CM-M03-001、CM-M04-001、CM-M05-001：**PASS，适用于上述源码和稳定构建产物**。没有尚待修复的本次独立阻塞缺陷。

snap-01、snap-02 FAIL及全部失败/跳过轨迹保持原结论。任何后续源码或执行产物改动需重新确定适用性。统筹可仅更新票/模块状态/交接并验证文档；不因更新文档把当前证据扩大为I01–I04或整批已完成。真实模型、图像能力和用户外部项目自主质量均未由协议替身测试证明。
