# 最小完整语义协作闭环验收

状态：本次最小完整语义协作闭环验收完成。302文件/1994项行为测试、27项浏览器、前后端类型、12 Module依赖边界及文档13/13全部通过；当前构建产物与HTTP返回字节一致。清理基线为 b7fa329178a1474933c9dd1a4a812285cec04cf3，按用户追加授权已推送 origin/main；本轮功能增量尚未提交或推送。权威文档仓库无远程。

## 同一个真实任务

Python normalize helper 的要求为：去掉首尾空白，只将ASCII大写转小写，保留非ASCII字符和内部空格，空输入保持空。使用真实HTTP宿主、SQLite、coding-agent内核、read/edit、Python检查以及独立Reviewer的read_source/read_material。模型是明确标记的本地协议替身；不据此声称真实模型协作质量。

初始协调计划经Control受理；执行者公开报告规则缺口，协调Query实际读RULES.md并返回带来源补料。首次Python检查真实FAIL，协调者读取失败材料与代码，具体修复指令连同精确答案引用/摘要进入原返工提案。Control保留权限、版本、预算和义务守卫，正式生成新PlanRevision。后继实际输入含规则与调整，工具实际修改代码并重验。工具轮次为INCONCLUSIVE，因为必要Reviewer尚未给结论；独立Reviewer实际读当前源码及完整报告后给PASS，正式Evidence才能使Task satisfied。Goal保持其正式RUNNING/未完成状态，因为目标门任务尚未满足，不能将Task完成冒充Goal完成。

必要人的选择场景另有USE-CASE.md：共用规则已固定，产品应用范围尚未授权为目录导入标识或用户显示标签。协调者实际读该来源后给具体目标/影响/推荐/独立工作，用户选择的精确answerRef+optionId经普通提案→UserDecision→PlanRevision回流。后继须实际收到决定正文、决定ID和所选范围。普通场景没有这一步；不是让人审批既有规则的同义措辞。

## 关键实现边界

- Context持久化原公开报告或正式失败的派生材料，保留原Run/Reviewer来源、报告、失败集合及sourcePin。
- PlanCompiler提交只读Query、解析有来源见证的adjust_plan，并将指令及答案绑定加入原返工编译。Dispatch在接受前再次调用PlanCompiler→Context复核实际来源。
- Control只读持久事实验证答案、失败集合、指令、计划、人的决定和原治理规则，不反向调用Context/WorkspaceReader。既有四边界和原义务不削弱。
- Query刷新以精确supersedes关联旧记录；替代未完成、失效、无权限或必要材料不可用时仍阻塞。Reviewer的独立Work身份保留，只有精确已接受返工指向的答案可送入当前后继。
- 宿主启动重建已记录选择、终态Run和既有验证journal后续动作；不添加工作流状态库。UI读取投影并提交选项，不裁决完成或扫描账本。

## 验证入口

| 范围 | 证据 |
| --- | --- |
| 清理基线身份与远程检查点 | resumed-baseline.json、publish-payload-review.md/json |
| 完整行为回归：302文件/1994项通过 | full-tests-final.log / .exit |
| 后端及UI类型、12 Module依赖边界 | backend-types-final.log、ui-types-final.log、boundaries-final.json |
| 当前构建及浏览器：27/27 | browser.log、browser-results、served-artifacts.json |
| 原三条真实链和两个决定提交断点 | semantic-targeted-8.log：5/5；最终新产品范围场景由full-tests-final和browser覆盖 |
| 提交前来源失效、答案/摘要/指令/Run绑定错配 | coordination-guards-2.log：22/22；明确seam，不声称真实文件竞争 |
| 仅提案未授权的来源/计划变化、精确决定幂等恢复 | feedback-decision-recovery-3.log：7/7 |
| 调查替代与原答案保留 | failure-feedback-renewal-2.log：16/16 |
| 无关工作异常答案隔离及定向答案缺失拒绝 | failure-feedback-isolation-1.log：12/12 |
| Reviewer FAIL实际进入协调与原治理守卫 | rework-drive-compat-2.log：3/3 |
| 独立复核发现与修复 | final-review.md |
| 权威文档结构 | docs-final.log：13/13 |

真实样例逐次输出semantic-task-*.json，包含原FAIL、当前计划/运行/Query/Evidence/Reviewer/Task与Goal投影、模型调用数和分支、真实最终代码。新记录带humanChoice及injectedControlBoundary；此目录保留各次运行身份，不覆盖旧样例。

## 恢复与反例的准确范围

五个同任务场景覆盖正常链、必要Reviewer FAIL不能完成、必要产品范围选择、人的决定已落账而apply前异常、apply已提交而调查投递前异常。两断点解除一次性注入后正常关闭重开，首先等待自动完成后续链，再验证重复选择/重启不新增正式计划、决定、Reviewer或Evidence。它们不是进程强杀、所有checkpoint或未知副作用恢复证明。既有全量回归继续验证明确未知记录不转为重新运行授权。

旧FAIL和原报告可在浏览器打开；旧计划/答案不删除，换版不自动解除义务。当前来源在提交前和材料组装时复核，但文件系统与账本不是一个原子事务。多组失效/精确替代及隔离有有界测试，不将其扩大为任意变化失败集合、持续跨工作包协作或全部强杀断点完成声明。

## 历史及文档影响

原失败日志保留：semantic-targeted-1..7、full-tests.log、full-tests-attempt-2.log、browser-attempt-1/2.log与browser-attempt-2-results。失败推动修复真实的答案引用绑定、宿主队列等待、Reviewer来源、替代链与隔离守卫；夹具改动保留真实读取与精确Reviewer身份断言，没有把必要材料/义务改成可选。

长期契约同步到权威runtime-collaboration.md，当前状态回到human/module-status.md，产品交接回到IMPLEMENTATION-HANDOFF.md。未改PRODUCT、ARCHITECTURE、完成策略或验收/基线规则；这次是已有方向的有界实现。其余14项范围外义务保留，详见唯一模块状态。

冻结版本五场景身份与原始报告摘要见 validated-scenarios.json：正常流程18次模型请求，Reviewer FAIL场景23次，必要产品范围选择及两个提交断点恢复均25次。数字是本地替身协议调用次数，不是模型质量或效率基准。源码身份见 validated-source.json 与 final.json；两者之间仅交接/状态文档收尾，不改变通过测试的生产及测试代码。
