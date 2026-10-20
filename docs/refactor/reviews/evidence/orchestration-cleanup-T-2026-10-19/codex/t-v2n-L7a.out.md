已按新口径核对本组 85 个文件，并追踪它们调用的外部夹具。以下短文件名均位于 `tests/work-graph/`；`H/` 表示 `tests/helpers/`。行号列表逐行计数；同一调用行的不同值类别分别计数，同一入口嵌套产生的同类值合并，参数化测试不按运行次数展开。

“v2 允许”只判断所列输入或字段，不表示整条测试通过规则审查。已有的内部写入、手工记录等问题不另列为本轮 F3。

**1．A1 草稿和外部值**

表中的 `P` 指 `plans.proposePlan`，对应真实路由 `src/app/core-routes.ts:388`。共同调用链如下：

- **G**：完整草稿经过提议、公开读取、采用；`H/graph-session-fixture.ts:425`、`:431`、`:433`。后续仍使用内部读取构造请求，见 `H/graph-session-fixture.ts:199`。
- **C**：完整草稿经过真实提议、采用；`H/task-claim-fixture.ts:344`、`:350`。随后夹具直接登记 Session，整链并非仅公开步骤；`H/task-claim-fixture.ts:370`。
- **E**：包含 C，并追加完整证据计划，经提议、采用；`H/R3e-evidence-fixture.ts:194`、`:209`、`:216`。随后直接记运行结果；`H/R3e-evidence-fixture.ts:265`。追加未来计划也经真实提议、采用；`H/R3e-evidence-fixture.ts:394`、`:401`。
- **S**：包含 C，S5 各完整计划经提议、采用；`H/S5-decision-fixture.ts:738`、`:744`。后续存在直接登记运行事实；`H/S5-decision-fixture.ts:853`。
- **N**：包含 S，并经通知计划的真实提议、采用；`H/S5-queue-support.ts:317`、`:326`、`:329`，`H/S2A-notices-support.ts:162`、`:175`、`:178`。后续仍直接记录检查结果；`H/S2A-notices-support.ts:271`。
- **D**：终止任务的完整修改草稿经真实提议、采用；`H/K3-review-card-fixture.ts:362`、`:377`、`:383`。构造时读取内部窗口，不能称为整链仅公开；`H/K3-review-card-fixture.ts:357`。

| 调用点 | owner、值及完整契约 | 后续是否仅公开 | 裁定 |
|---|---|---|---|
| A1-session-independent.test.ts:26、55、86、117 | P；完整草稿，G | 否，G | v2 允许 |
| A1-session-lifecycle.test.ts:80、125、272 | P；完整草稿，G | 否，G | v2 允许 |
| A2-control-service.test.ts:41 | P；完整草稿，C | 否，C | v2 允许 |
| A2-disposition-change.test.ts:168、487、595、648、655、676、682 | P；完整初始／修改草稿；本地采用见同文件:177，W2 转交见 H/W2-whiteboard-fixture.ts:294、309 | 否；本地随后造运行状态见同文件:190；嵌套 C | v2 允许 |
| A2-entry-plan.test.ts:173、195 | P；完整草稿，C；修改草稿见同文件:184 | 否；公开采用后直接调用运行入口授权，同文件:198、210 | v2 允许 |
| A2-gate-chain-facts.test.ts:44、237 | P；完整草稿，E；修改草稿见同文件:223 | 初始化否；237 后公开采用、查询，同文件:240、252 | v2 允许 |
| A2-goal-control.test.ts:63、101、325 | P；完整草稿，C／E | 否，C／E | v2 允许 |
| A2-requeue-service.test.ts:75 | P；完整草稿，C | 否，C | v2 允许 |
| A2-step1-manifest.test.ts:18 | P；完整草稿，C | 否，C | v2 允许 |
| A2-verification-chain.test.ts:61、173、212 | P；完整草稿，E | 61 否；173 后公开读，同文件:175；212 后内部读，同文件:231 | v2 允许 |
| B2-01-blocked-commands.test.ts:51、95、99、125、159 | P；嵌套完整草稿，S | 否，S；工具参数另列 | v2 允许 |
| B2-01-task-read.test.ts:75 | P；完整草稿，S | 否，S | v2 允许 |
| B2-03-crr-request.test.ts:79、100、114、124、147、161 | P；完整草稿，S | 否，S；后续回执另列 | v2 允许 |
| B2-07-crr-card-closed.test.ts:41、47、64、99 | P；初始化 S；47 为 D | 初始化否；47 公开采用，但构造读取内部窗口 | v2 允许 |
| B2-07-crr-card.test.ts:41、95、139、177 | P；完整草稿，S | 否，S | v2 允许 |
| B2-08-crr-answer.test.ts:58、75、89、94 | P；初始化 S；94 为 D | 初始化否；94 公开采用后公开读取、拒绝回答，同文件:95、97 | v2 允许 |
| B2-08-crr-cancel.test.ts:30、44 | P；初始化 S；44 为 D | 初始化否；44 公开采用后公开读取，同文件:47 | v2 允许 |
| B2-09-answer-replay.test.ts:29 | P；完整草稿，S | 否，S | v2 允许 |
| B2-09-crr-owner.test.ts:90、184 | P；初始化 S；184 为 D | 初始化否；D 的采用公开，构造读取内部窗口 | v2 允许 |
| B2-12-recognition.test.ts:133 | P；完整草稿，S | 否，S | v2 允许 |
| B2-12-rewrite-prefix.test.ts:105、135、157、173 | P；完整草稿，S | 否，S | v2 允许 |
| B2-14-crr-forms.test.ts:68、83、100、120、137、153 | P；完整草稿，S | 否，S；后续回执另列 | v2 允许 |
| B2-17-disposition-reads.test.ts:37、52 | P；完整草稿，S | 否，S | v2 允许 |
| B2-18-request-reads.test.ts:101、144 | P；完整草稿，S | 否，S | v2 允许 |
| B2-UR7-crr-answer.test.ts:120、179 | P；完整草稿，S | 否，S | v2 允许 |
| B2-execution-entry.test.ts:9 | P；完整草稿，C | 否，C | v2 允许 |
| B2-execution-result.test.ts:6 | P；完整草稿，C | 否，C | v2 允许 |
| B2-model-request.test.ts:8 | P；完整草稿，C | 否，C | v2 允许 |
| C1-session-mailbox.test.ts:21 | P；完整草稿，C | 否，C | v2 允许 |
| C2-mailbox-admission.test.ts:16 | P；完整草稿，C | 否，C | v2 允许 |
| R3c-plan-adoption.test.ts:121、182、197、340、346、369、391、424、428 | P；完整草稿；循环等业务问题由真实提议检查 | 否；存在后续内部读，同文件:440；182 嵌套 C | v2 允许 |
| R3c-plan-entry.test.ts:66、74、79 | P；结构完整的空计划 | 是；公开重放、采用拒绝和查询，同文件:84、88 | v2 允许 |
| R3c-task-relations.test.ts:128、158 | P；结构完整，但携带测试自造 artifact 指纹，同文件:53、74 | 经过公开采用／查询；之后还有内部读取，同文件:166、173、189 | F1：平台指纹来源不合规 |
| R3c-task-relations.test.ts:151 | P；缺字段、错误形状、越版本字段的对象强转为草稿，同文件:137、142、153 | 被拒绝，不采用 | F1：强转未满足完整参数契约 |
| R3e-completion.test.ts:34、94、232 | P；完整草稿，E；232 的本地草稿见同文件:213 | 否；后续手造观察并记检查结果，同文件:41、67 | v2 允许 |
| R3e-evidence-coverage.test.ts:26、107 | P；完整草稿，E | 26 否；107 后转入手造证据的纯计算，同文件:112、116，并非仅公开接口 | v2 允许 |
| R3e-evidence.test.ts:29 | P；完整草稿，E | 否，E | v2 允许 |
| R3e-reverify.test.ts:93、654 | P；完整草稿，E；本地草稿见同文件:642 | 否；后续直接登记运行事实，同文件:696、760 | v2 允许 |
| R4-control-intent.test.ts:32 | P；完整草稿，C | 否，C | v2 允许 |
| R4c-execution-history-index.test.ts:64、73、143、1006 | P；完整草稿，C；规模计划见同文件:131 | 否；143 后公开采用，再直接创建 Session，同文件:148、155；内部读见:165 | v2 允许 |
| R4c-execution-read.test.ts:50、98、225、586 | P；完整草稿，C；规模计划见同文件:87 | 否；98 后公开采用，再走 C 的 Session 登记，同文件:103、110 | v2 允许 |
| R4c-source-authority-reader.test.ts:39、129 | P；完整草稿，C；本地草稿见同文件:117 | 初始化否；129 的提议→采用公开，同文件:135；其他夹具步骤仍有 C | v2 允许 |
| R4c-task-claim-boundaries.test.ts:18、131 | P；完整草稿，C；修改草稿见同文件:118 | 初始化否；131 后公开采用、claim，同文件:137、145 | v2 允许 |
| R4c-task-claim-concurrency.test.ts:50、79、103、125、167、183、193、207 | P；完整草稿，C；修改草稿见同文件:112 | 否；125 后公开采用、requeue，再走 C 的 Session 登记，同文件:131、137、143 | v2 允许 |
| R4c-task-claim.test.ts:34、347、368、392、411 | P；完整草稿，C | 否，C | v2 允许 |
| RL-32b-rework-notice-memory-cap.test.ts:72、142、196、268 | P；完整草稿，E | 否，E | v2 允许 |
| S1-anomaly-owner.test.ts:139、140 | P；完整草稿，E／C | 否，E／C | v2 允许 |
| S1-archive-owner.test.ts:15 | P；完整草稿，C | 否，C | v2 允许 |
| S1-codecs-indexes.test.ts:83 | P；完整草稿，C | 否，C | v2 允许 |
| S1-dispatch-guards.test.ts:21 | P；完整草稿，C | 否，C | v2 允许 |
| S1-provenance.test.ts:68 | P；完整草稿，C | 否，C | v2 允许 |
| S1-requeue.test.ts:14 | P；完整草稿，C | 否，C | v2 允许 |
| S1-responsibility.test.ts:132、285 | P；完整草稿，E；本地草稿见同文件:267 | 初始化否；285 后公开采用、完成，同文件:292、308，但检查夹具仍非整链公开 | v2 允许 |
| S1-session-facts.test.ts:18 | P；完整草稿，C | 否，C | v2 允许 |
| S1-wait-disposal.test.ts:11 | P；完整草稿，C | 否，C | v2 允许 |
| S2A-notices-attempt.test.ts:20、23 | P；完整草稿，N | 否，N | v2 允许 |
| S2A-notices-counts.test.ts:25、32 | P；完整草稿，N | 否，N | v2 允许 |
| S2A-notices-overbound.test.ts:25、27 | P；完整草稿，N；27 转调见 H/S2A-notices-overbound-fixture.ts:80 | 否；随后直接进入运行，H/S2A-notices-overbound-fixture.ts:84、87 | v2 允许 |
| S2A-notices-rework.test.ts:22 | P；完整草稿，N | 否，N | v2 允许 |
| B2-01-blocked-commands.test.ts:125 | `send_user_message` 参数只有 recipient/text，同文件:126 | 宽松替身接收；H/K3-tool-seams.ts:136、144 | F1：缺 goalRef、intent、needsReply、waitAfterSend、options、objects；真实契约见 src/core/agent-runtime/communication-tools.ts:280 |
| B2-01-blocked-commands.test.ts:169 | `propose_safer_method`；完整 item/command/rationale，cwd 按契约省略；H/K3-proposal-round.ts:705 | 真实工具；随后真实结束、settle、answer，同文件:172、173、175；回执另列 | v2 允许 |
| B2-07-crr-card.test.ts:54 | `request_command_rerun`；完整 command/reason/可选 rewriteOf；H/B2-crr-world.ts:308、309 | 真实 Runtime 调工具，随后公开 listRequests；H/B2-crr-world.ts:314、318 | v2 允许 |
| R5b-initial-plan.test.ts:190 | `project_source` 的 read 参数完整；src/core/agent-runtime/project-source-tool.ts:119 | 真实工具、公开 startQuery、答案转计划；同文件:245、325 | v2 允许 |

**2．A1 平台签发字段**

下面共同来源代码用于表格和 JSON：

- **Q**：`completionPolicies.activateCompletionPolicy.target.digest`。基础夹具从真实安装结果取值，见 `H/task-claim-fixture.ts:252`、`:259`；图夹具见 `H/graph-session-fixture.ts:325`、`:333`、`:336`。E、S、N 的附加策略也分别原样使用安装返回值，见 `H/R3e-evidence-fixture.ts:171`、`:182`，`H/S5-decision-fixture.ts:638`、`:647`，`H/S5-queue-support.ts:300`、`:306`，`H/S2A-notices-support.ts:145`、`:153`。
- **E1**：真实准备结果→`runtime.startRun.prepared`。C1 转调见 `H/C1-mailbox-fixture.ts:146`；公共准备／启动见 `H/S2B-runtime-steps-fixture.ts:348`、`:357`，返回原值见 `H/task-claim-fixture.ts:601`、`:606`。
- **E2**：阻塞命令的真实 prepare→start，见 `H/K3-blocked-command-fixture.ts:336`、`:340`；prefix 转调见 `H/K3-prefix-claim.ts:75`。
- **E3**：真实续跑 prepare→start，见 `H/B2-crr-world.ts:125`、`:314`，`H/K3-35-continuation-fixture.ts:491`、`:494`、`:501`，`H/K3-35-prepare.ts:93`、`:109`。pending-review 转调见 `H/K3-proposal-round.ts:261`；proposal round 见同文件:434、436。
- **R**：夹具从内部 `eventAt` 的 JSON 重新拼回执，见 `H/K3-review-card-fixture.ts:288`、`:291`、`:294`；公开决策协调器随后把它交给 `decisionMessages.recordDecisionApplication`，见 `src/business/workflow/decision-actions.ts:449`、`:458`。该 owner 确实绑定路由，见 `src/app/core-routes.ts:481`。因此即使 cursor 来自真实提交，重建的整份 receipt 仍为 F1。

| 调用点 | owner／字段 | 来源与裁定 |
|---|---|---|
| A1-architecture-catalog.test.ts:24；A1-catalog-independent.test.ts:23、51；A1-independent-review.test.ts:15；A1-session-discovery.test.ts:24；A1-session-independent.test.ts:14；A1-session-lifecycle.test.ts:29 | Q | 公开安装返回原值，**v2 允许** |
| A2-control-service.test.ts:41；A2-disposition-change.test.ts:595、655、676；A2-entry-plan.test.ts:173；A2-gate-chain-facts.test.ts:44；A2-goal-control.test.ts:63、101、325；A2-requeue-service.test.ts:75；A2-step1-manifest.test.ts:18；A2-verification-chain.test.ts:61 | Q | 含嵌套策略，均为公开安装返回原值，**v2 允许** |
| B2-01-blocked-commands.test.ts:51、95、99、125、159；B2-01-task-read.test.ts:75；B2-03-crr-request.test.ts:79、100、114、124、147、161 | Q | 公开安装返回原值，**v2 允许** |
| B2-07-crr-card-closed.test.ts:41、64、99；B2-07-crr-card.test.ts:41、95、139、177；B2-08-crr-answer.test.ts:58、75、89；B2-08-crr-cancel.test.ts:30；B2-09-answer-replay.test.ts:29；B2-09-crr-owner.test.ts:90 | Q | 公开安装返回原值，**v2 允许** |
| B2-12-recognition.test.ts:133；B2-12-rewrite-prefix.test.ts:105、135、157、173；B2-14-crr-forms.test.ts:68、83、100、120、137、153；B2-17-disposition-reads.test.ts:37、52；B2-18-request-reads.test.ts:101、144；B2-UR7-crr-answer.test.ts:120、179 | Q | 公开安装返回原值，**v2 允许** |
| B2-execution-entry.test.ts:9；B2-execution-result.test.ts:6；B2-model-request.test.ts:8；C1-session-mailbox.test.ts:21；C2-mailbox-admission.test.ts:16；R3c-plan-adoption.test.ts:182 | Q | 公开安装返回原值，**v2 允许** |
| R3e-completion.test.ts:34；R3e-evidence-coverage.test.ts:26；R3e-evidence.test.ts:29；R3e-reverify.test.ts:93；RL-32b-rework-notice-memory-cap.test.ts:72、142、196、268 | Q | 含 E 的附加策略，均为公开返回原值，**v2 允许** |
| R4-control-intent.test.ts:32；R4c-execution-history-index.test.ts:64、73、1006；R4c-execution-read.test.ts:50、225、586；R4c-source-authority-reader.test.ts:39；R4c-task-claim-boundaries.test.ts:18 | Q | 公开安装返回原值，**v2 允许** |
| R4c-task-claim-concurrency.test.ts:50、79、103、167、183、193、207；R4c-task-claim.test.ts:34、347、368、392、411 | Q | 公开安装返回原值，**v2 允许** |
| S1-anomaly-owner.test.ts:139、140；S1-archive-owner.test.ts:15；S1-codecs-indexes.test.ts:83；S1-dispatch-guards.test.ts:21；S1-provenance.test.ts:68；S1-requeue.test.ts:14；S1-responsibility.test.ts:132；S1-session-facts.test.ts:18；S1-wait-disposal.test.ts:11 | Q | 公开安装返回原值，**v2 允许** |
| S2A-notices-attempt.test.ts:20、23；S2A-notices-counts.test.ts:25、32；S2A-notices-overbound.test.ts:25、27；S2A-notices-rework.test.ts:22 | Q | 含 S、noticeWork、many-task 策略，均为公开返回原值，**v2 允许** |
| A2-step1-manifest.test.ts:18；C1-session-mailbox.test.ts:21；C2-mailbox-admission.test.ts:16；B2-execution-entry.test.ts:223、235；R4c-execution-history-index.test.ts:661；R4c-execution-read.test.ts:233 | runtime.startRun／prepared | E1，**v2 允许** |
| B2-01-blocked-commands.test.ts:51、95、99、125、159；B2-03-crr-request.test.ts:79、100、114、124、147、161、164；B2-14-crr-forms.test.ts:68、83、100、120、137、153；B2-17-disposition-reads.test.ts:37、52；B2-18-request-reads.test.ts:77；B2-12-rewrite-prefix.test.ts:53、57、139 | runtime.startRun／prepared | E2，**v2 允许** |
| B2-01-blocked-commands.test.ts:168；B2-01-task-read.test.ts:44、83；B2-07-crr-card-closed.test.ts:43、66、111、126；B2-07-crr-card.test.ts:46、54、97、144、179 | runtime.startRun／prepared | E3，**v2 允许** |
| B2-08-crr-answer.test.ts:60、77、91；B2-08-crr-cancel.test.ts:32；B2-09-answer-replay.test.ts:31；B2-09-crr-owner.test.ts:98；B2-12-recognition.test.ts:135；B2-UR7-crr-answer.test.ts:122、182 | runtime.startRun／prepared | E3，**v2 允许** |
| R3c-plan-adoption.test.ts:225、313 | runtime.startRun／prepared | 同文件:221、309 调真实 prepareTaskForReal，返回原值，**v2 允许** |
| R5b-initial-plan.test.ts:245；R5b-query-execution.test.ts:189 | runtime.startQuery／prepared | 各自真实 prepareQuery 返回，同文件:242、183，**v2 允许** |
| B2-01-blocked-commands.test.ts:70、104、105、141、151、166、175 | decisionMessages.recordDecisionApplication／receipt | R；answer 转交见 H/K3-blocked-command-fixture.ts:496、503，**F1** |
| B2-03-crr-request.test.ts:66、79、100、114、124、147、161 | 同上 | R；构造入口内部先 answer，H/K3-crr-fixture.ts:63，**F1** |
| B2-07-crr-card-closed.test.ts:120；B2-08-crr-answer.test.ts:35；B2-08-crr-cancel.test.ts:36；B2-09-answer-replay.test.ts:35 | 同上 | R；成功应用分支重建回执，**F1** |
| B2-09-crr-owner.test.ts:103、259；B2-12-recognition.test.ts:140 | 同上 | R；本地协调器也接入该回调，B2-09-crr-owner.test.ts:172，**F1** |
| B2-12-rewrite-prefix.test.ts:53、57、139 | 同上 | R；H/K3-prefix-claim.ts:80 转调 answer，**F1** |
| B2-14-crr-forms.test.ts:55、68、83、100、120、137、153 | 同上 | R；含构造入口的 answer，H/K3-crr-fixture.ts:63，**F1** |
| B2-17-disposition-reads.test.ts:31；B2-18-request-reads.test.ts:86、196 | 同上 | R，**F1** |
| B2-UR7-crr-answer.test.ts:127、144、164 | 同上 | 初次 resolve 及两次 Workflow advance 均接入重建回执，同文件:92，**F1** |
| A1-independent-review.test.ts:83；A1-session-discovery.test.ts:43、192；A1-session-independent.test.ts:147 | sessions.findSessions／cursor | 公开前页返回原样续用；分别见同文件:95、138、191、152，**v2 允许** |
| B2-01-task-read.test.ts:61；B2-09-crr-owner.test.ts:146 | unknownCallReviews.listReviews／cursor | 公开 nextCursor，分别见同文件:67、150，**v2 允许** |
| B2-03-crr-request.test.ts:79、100、114、124、147、161；B2-14-crr-forms.test.ts:68、83、100、120、137、153 | unknownCallReviews.listReviews／cursor | 夹具分页回调原样续用公开 nextCursor，H/K3-crr-fixture.ts:111、117，**v2 允许** |
| C1-session-mailbox.test.ts:411、417、533、535、547 | messages.readInbox／cursor | 公开首读返回，同文件:408、532，**v2 允许** |
| C1-session-mailbox.test.ts:333 | messages.readInbox／atLeastCursor | 同文件:332 加 1000 重造，**F1** |
| R3c-plan-adoption.test.ts:151 | plans.queryTaskGraph／atLeastCursor | apply 返回 cursor，同文件:129，**v2 允许** |
| R3c-plan-adoption.test.ts:152 | plans.queryTaskGraph／atLeastCursor | 同文件:153 加 1000 重造，**F1** |
| R3d-observed-architecture.test.ts:29；R3d-observed-boundaries.test.ts:23、25、27、34 | architecture.queryArchitecture／cursor | 前页公开 nextCursor，分别见同文件:27、20，**v2 允许** |
| R4b-session-boundaries.test.ts:227；R4b-session-directory.test.ts:220、224 | sessions.findSessions／cursor | 前页公开 nextCursor，分别见同文件:232、218，**v2 允许** |
| R4c-execution-read.test.ts:336、484 | executions.readExecution／atLeastCursor | 直接使用真实 claim 返回 cursor，**v2 允许** |
| R4c-execution-read.test.ts:325、339 | executions.readExecution／atLeastCursor | 同文件:324、338 加 25 重造，**F1** |
| R4c-execution-read.test.ts:536 | executions.readExecution／atLeastCursor | 同文件:535 手造错误字符串、null、数字、对象、数组，再强转，**F1** |
| S1-session-facts.test.ts:159 | sessionFacts.listSessionExecutions／cursor | 使用公开 first.nextCursor，同文件:153，**v2 允许** |
| S2A-notices-counts.test.ts:96；S2A-notices-overbound.test.ts:41 | decisions.queryDecisionQueue／cursor | 公开前页 nextCursor，分别见同文件:101、48，**v2 允许** |
| S2A-notices-counts.test.ts:109、112；S2A-notices-rework.test.ts:61 | workspaceDecisionSettings.markNoticesSeen／displayToken、seenThrough | 原样使用公开页面返回值，分别见同文件:107、110、59，**v2 允许** |
| A1-independent-review.test.ts:40 | catalog.reviseArchitectureCatalog／basedOn.digest | 公开采用返回 baseline.contentDigest，同文件:22，**v2 允许** |
| R3b-material-applicability.test.ts:93、95、97、98 | materials.openArtifact／ref.digest | 直接由内部 body store 产生，同文件:65、69，**F1** |
| R3c-task-relations.test.ts:128、151、158 | plans.proposePlan／artifactRef.digest | 同文件:53 自造摘要；畸形分支另见:142，**F1** |
| R3e-completion.test.ts:202 | completionPolicies.activateCompletionPolicy／target.digest | 真实安装结果原值，同文件:184，**v2 允许** |
| R5a-project-bootstrap.test.ts:236、243、266、276、277、306、327、330、332、443、467 | completionPolicies.activateCompletionPolicy／target.digest | 公开安装结果原值；复用 validTarget 见同文件:251，**v2 允许** |
| R5a-project-bootstrap.test.ts:253、256、261 | completionPolicies.activateCompletionPolicy／target.digest | 测试签发 f/a 重复摘要，**F1** |
| R5b-initial-plan.test.ts:169 | completionPolicies.activateCompletionPolicy／target.digest | 真实 installed 返回原值，**v2 允许** |
| R3d-observed-architecture.test.ts:21、28、104、124、128、173、190 | architecture.queryArchitecture/queryImpact／capture 指纹 | 公开 capture 返回原样使用，来源同文件:14、82、114、158、186，**v2 允许** |
| R3d-observed-boundaries.test.ts:16、22、24、26、33、49、57、83、123、203、208、228、233 | 同上 | 公开 capture 返回原样使用，来源同文件:12、29、44、72、116、196、223，**v2 允许** |
| R3d-observed-boundaries.test.ts:104 | architecture.queryArchitecture／sourceDigest、configDigest、material.digest | 同文件:98、99、101 改写真实返回值，**F1** |
| R3d-record-integrity.test.ts:192 | architecture.queryArchitecture／capture 指纹 | 公开 capture 返回，来源同文件:165、191，**v2 允许** |
| R3c-plan-adoption.test.ts:182 | roles.activateRoleSpec/runtime.createSession／role pin.digest | 真实安装返回后原样激活、创建 Session；H/B2-runtime-fixture.ts:195、197、198、209，**v2 允许** |
| R4b-session-boundaries.test.ts:145 | sessions.findSessions／role.pin.digest | 同文件:116、118、119 测试签发，**F1** |
| R4c-task-claim-boundaries.test.ts:40、66 | roles.activateRoleSpec／target.digest；sessions.admitSessionCreation／role.pin.digest | 同文件:34、39 安装返回原值；Session 转交见 H/task-claim-fixture.ts:362，**v2 允许** |
| R4c-task-claim-boundaries.test.ts:67 | sessions.admitSessionCreation／role.pin.digest | 改成 f.repeat(64)，**F1** |
| R3g-role-spec.test.ts:116、158、168、208、219、329 | roles.readRoleSpec／pin.digest | 安装返回原值，来源同文件:109、206、320；219 改 ref，但 digest 字段仍是原返回值，**v2 允许** |
| R3g-role-spec.test.ts:128、131、163、210、224、225、254、255、321、336、422、522、539 | roles.activateRoleSpec／target.digest | 公开安装返回原值，来源同文件:109、164、206、207、251、252、320、421、520，**v2 允许** |
| R3g-role-spec.test.ts:217、374、379、488、491 | roles.readRoleSpec／pin.digest | 217 改摘要；374、379 用同文件:373 自造摘要；488、491 用同文件:480、487 从测试安装命令保留的自算摘要，**F1** |
| R3g-role-spec.test.ts:221、495 | roles.activateRoleSpec／target.digest | 221 改摘要；495 沿用测试自算摘要，同文件:480、487，**F1** |
| R3g-role-spec.test.ts:379 | roles.readRoleSpec／atLeastCursor | 内部 readThrough 加 1000，同文件:375、378，**F1** |
| R3g-role-spec.test.ts:491 | roles.readRoleSpec／atLeastCursor | 使用 installed.commitCursor，同文件:490；492 是调用后的变更，**v2 允许** |

**3．Record-store 自身测试**

| 范围 | 结论 |
|---|---|
| 本组清单 `.lead-ref/groups/L7a-files.txt:1` 至末项 `:85` | 无 `tests/record-store/*`；本节无实例。没有把上层手工记录重新列为 F3。适用边界见 `.lead-ref/books/test-rule-sheet-v2.md:38`、`:41`。 |

**4．A7**

| 具名帮助函数 | 本组及实际调用的外部夹具 |
|---|---|
| `buildNoteTools`；范围规定见 `.lead-ref/books/test-rule-sheet-v2.md:45` | 无调用 |
| `damageKernel`；范围规定见 `.lead-ref/books/test-rule-sheet-v2.md:50` | 无调用 |
| `process-sandbox-standin.ts` 的 `probe`；范围规定见 `.lead-ref/books/test-rule-sheet-v2.md:59` | 无调用；K3 的工具 seam 不属于这个具名帮助函数，见 H/K3-tool-seams.ts:132 |

**无实例文件**

以下均已检查全文，没有本轮四类实例：

- A2-step1-codecs.test.ts:1
- B2-07-crr-card-pure.test.ts:1
- B2-11-blocked-commands-bytes-pure.test.ts:1
- B2-11-expansion-levels.test.ts:1
- B2-11-script-expansion.test.ts:1
- B2-12-recognition-pure.test.ts:1
- B2-command-rerun-request-event-pure.test.ts:1
- R3a-goal-replay-boundaries.test.ts:1
- R3c-canonical-task-state.test.ts:1
- R3c-task-graph.test.ts:1
- R3c-task-relations-boundaries.test.ts:1
- R3d-fixture.ts:1
- R5b-query-job.test.ts:1

JSON 中 `line` 是上述计数口径的行号数组；共同来源代码与上表一致。

```json
[
{"section":"1","file":"A1-session-independent.test.ts","line":[26,55,86,117],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"G；后续非仅公开"},
{"section":"1","file":"A1-session-lifecycle.test.ts","line":[80,125,272],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"G；后续非仅公开"},
{"section":"1","file":"A2-control-service.test.ts","line":[41],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"A2-disposition-change.test.ts","line":[168,487,595,648,655,676,682],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"公开采用；C及同文件:190的内部后续"},
{"section":"1","file":"A2-entry-plan.test.ts","line":[173,195],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；同文件:198采用、210内部授权"},
{"section":"1","file":"A2-gate-chain-facts.test.ts","line":[44,237],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"44为E；237后公开采用240、查询252"},
{"section":"1","file":"A2-goal-control.test.ts","line":[63,101,325],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C/E；后续非仅公开"},
{"section":"1","file":"A2-requeue-service.test.ts","line":[75],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"A2-step1-manifest.test.ts","line":[18],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"A2-verification-chain.test.ts","line":[61,173,212],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"61为E；173后公开读175；212后内部读231"},
{"section":"1","file":"B2-01-blocked-commands.test.ts","line":[51,95,99,125,159],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"S；后续非仅公开；工具另列"},
{"section":"1","file":"B2-01-task-read.test.ts","line":[75],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"S；后续非仅公开"},
{"section":"1","file":"B2-03-crr-request.test.ts","line":[79,100,114,124,147,161],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"S；后续非仅公开；回执另列"},
{"section":"1","file":"B2-07-crr-card-closed.test.ts","line":[41,47,64,99],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"初始化S；47为D"},
{"section":"1","file":"B2-07-crr-card.test.ts","line":[41,95,139,177],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"S；后续非仅公开"},
{"section":"1","file":"B2-08-crr-answer.test.ts","line":[58,75,89,94],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"初始化S；94为D，之后公开读95、回答97"},
{"section":"1","file":"B2-08-crr-cancel.test.ts","line":[30,44],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"初始化S；44为D，之后公开读47"},
{"section":"1","file":"B2-09-answer-replay.test.ts","line":[29],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"S；后续非仅公开"},
{"section":"1","file":"B2-09-crr-owner.test.ts","line":[90,184],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"初始化S；184为D"},
{"section":"1","file":"B2-12-recognition.test.ts","line":[133],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"S；后续非仅公开"},
{"section":"1","file":"B2-12-rewrite-prefix.test.ts","line":[105,135,157,173],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"S；后续非仅公开"},
{"section":"1","file":"B2-14-crr-forms.test.ts","line":[68,83,100,120,137,153],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"S；后续非仅公开；回执另列"},
{"section":"1","file":"B2-17-disposition-reads.test.ts","line":[37,52],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"S；后续非仅公开"},
{"section":"1","file":"B2-18-request-reads.test.ts","line":[101,144],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"S；后续非仅公开"},
{"section":"1","file":"B2-UR7-crr-answer.test.ts","line":[120,179],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"S；后续非仅公开"},
{"section":"1","file":"B2-execution-entry.test.ts","line":[9],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"B2-execution-result.test.ts","line":[6],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"B2-model-request.test.ts","line":[8],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"C1-session-mailbox.test.ts","line":[21],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"C2-mailbox-admission.test.ts","line":[16],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"R3c-plan-adoption.test.ts","line":[121,182,197,340,346,369,391,424,428],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"后续内部读同文件:440；182嵌套C"},
{"section":"1","file":"R3c-plan-entry.test.ts","line":[66,74,79],"owner":"plans.proposePlan","value":"结构完整空计划","verdict":"v2 允许","note":"后续公开；同文件:84、88"},
{"section":"1","file":"R3c-task-relations.test.ts","line":[128,158],"owner":"plans.proposePlan","value":"带自造artifact指纹的草稿","verdict":"F1","note":"同文件:53、74；公开采用后还有内部读189"},
{"section":"1","file":"R3c-task-relations.test.ts","line":[151],"owner":"plans.proposePlan","value":"畸形草稿","verdict":"F1","note":"同文件:137、142、153；强转不满足契约，拒绝后不采用"},
{"section":"1","file":"R3e-completion.test.ts","line":[34,94,232],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"E；后续手造检查观察并记录，同文件:41、67"},
{"section":"1","file":"R3e-evidence-coverage.test.ts","line":[26,107],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"26为E；107后手造证据做纯计算，同文件:112、116"},
{"section":"1","file":"R3e-evidence.test.ts","line":[29],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"E；后续非仅公开"},
{"section":"1","file":"R3e-reverify.test.ts","line":[93,654],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"E；后续内部登记，同文件:696、760"},
{"section":"1","file":"R4-control-intent.test.ts","line":[32],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"R4c-execution-history-index.test.ts","line":[64,73,143,1006],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；143后采用148、内部Session登记155、内部读165"},
{"section":"1","file":"R4c-execution-read.test.ts","line":[50,98,225,586],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；98后采用103、内部Session登记110"},
{"section":"1","file":"R4c-source-authority-reader.test.ts","line":[39,129],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"39为C；129后公开采用135，整夹具仍有内部步骤"},
{"section":"1","file":"R4c-task-claim-boundaries.test.ts","line":[18,131],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"18为C；131后公开采用137、claim145"},
{"section":"1","file":"R4c-task-claim-concurrency.test.ts","line":[50,79,103,125,167,183,193,207],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；125后采用131、requeue137、内部Session登记143"},
{"section":"1","file":"R4c-task-claim.test.ts","line":[34,347,368,392,411],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"RL-32b-rework-notice-memory-cap.test.ts","line":[72,142,196,268],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"E；后续非仅公开"},
{"section":"1","file":"S1-anomaly-owner.test.ts","line":[139,140],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"E/C；后续非仅公开"},
{"section":"1","file":"S1-archive-owner.test.ts","line":[15],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"S1-codecs-indexes.test.ts","line":[83],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"S1-dispatch-guards.test.ts","line":[21],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"S1-provenance.test.ts","line":[68],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"S1-requeue.test.ts","line":[14],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"S1-responsibility.test.ts","line":[132,285],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"132为E；285后采用292、完成308；整检查夹具非仅公开"},
{"section":"1","file":"S1-session-facts.test.ts","line":[18],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"S1-wait-disposal.test.ts","line":[11],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"C；后续非仅公开"},
{"section":"1","file":"S2A-notices-attempt.test.ts","line":[20,23],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"N；后续非仅公开"},
{"section":"1","file":"S2A-notices-counts.test.ts","line":[25,32],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"N；后续非仅公开"},
{"section":"1","file":"S2A-notices-overbound.test.ts","line":[25,27],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"N；外部转调H/S2A-notices-overbound-fixture.ts:80，内部进入84、87"},
{"section":"1","file":"S2A-notices-rework.test.ts","line":[22],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"N；后续非仅公开"},
{"section":"1","file":"B2-01-blocked-commands.test.ts","line":[125],"owner":"send_user_message","value":"工具参数","verdict":"F1","note":"缺真实必填字段；H/K3-tool-seams.ts:136宽松替身接收"},
{"section":"1","file":"B2-01-blocked-commands.test.ts","line":[169],"owner":"propose_safer_method","value":"工具参数","verdict":"v2 允许","note":"H/K3-proposal-round.ts:705完整实参；后续真实结束、settle、answer；回执另列"},
{"section":"1","file":"B2-07-crr-card.test.ts","line":[54],"owner":"request_command_rerun","value":"工具参数","verdict":"v2 允许","note":"H/B2-crr-world.ts:309完整实参；314真实启动、318公开读取"},
{"section":"1","file":"R5b-initial-plan.test.ts","line":[190],"owner":"project_source","value":"read工具参数","verdict":"v2 允许","note":"完整契约src/core/agent-runtime/project-source-tool.ts:119；后续公开"},

{"section":"2","file":"A1-architecture-catalog.test.ts","line":[24],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"A1-catalog-independent.test.ts","line":[23,51],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"A1-independent-review.test.ts","line":[15],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"A1-session-discovery.test.ts","line":[24],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"A1-session-independent.test.ts","line":[14],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"A1-session-lifecycle.test.ts","line":[29],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"A2-control-service.test.ts","line":[41],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"A2-disposition-change.test.ts","line":[595,655,676],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"A2-entry-plan.test.ts","line":[173],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"A2-gate-chain-facts.test.ts","line":[44],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"A2-goal-control.test.ts","line":[63,101,325],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"A2-requeue-service.test.ts","line":[75],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"A2-step1-manifest.test.ts","line":[18],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"A2-verification-chain.test.ts","line":[61],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-01-blocked-commands.test.ts","line":[51,95,99,125,159],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-01-task-read.test.ts","line":[75],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-03-crr-request.test.ts","line":[79,100,114,124,147,161],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-07-crr-card-closed.test.ts","line":[41,64,99],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-07-crr-card.test.ts","line":[41,95,139,177],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-08-crr-answer.test.ts","line":[58,75,89],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-08-crr-cancel.test.ts","line":[30],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-09-answer-replay.test.ts","line":[29],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-09-crr-owner.test.ts","line":[90],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-12-recognition.test.ts","line":[133],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-12-rewrite-prefix.test.ts","line":[105,135,157,173],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-14-crr-forms.test.ts","line":[68,83,100,120,137,153],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-17-disposition-reads.test.ts","line":[37,52],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-18-request-reads.test.ts","line":[101,144],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-UR7-crr-answer.test.ts","line":[120,179],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-execution-entry.test.ts","line":[9],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-execution-result.test.ts","line":[6],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"B2-model-request.test.ts","line":[8],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"C1-session-mailbox.test.ts","line":[21],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"C2-mailbox-admission.test.ts","line":[16],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"R3c-plan-adoption.test.ts","line":[182],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"R3e-completion.test.ts","line":[34],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"R3e-evidence-coverage.test.ts","line":[26],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"R3e-evidence.test.ts","line":[29],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"R3e-reverify.test.ts","line":[93],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"R4-control-intent.test.ts","line":[32],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"R4c-execution-history-index.test.ts","line":[64,73,1006],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"R4c-execution-read.test.ts","line":[50,225,586],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"R4c-source-authority-reader.test.ts","line":[39],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"R4c-task-claim-boundaries.test.ts","line":[18],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"R4c-task-claim-concurrency.test.ts","line":[50,79,103,167,183,193,207],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"R4c-task-claim.test.ts","line":[34,347,368,392,411],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"RL-32b-rework-notice-memory-cap.test.ts","line":[72,142,196,268],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"S1-anomaly-owner.test.ts","line":[139,140],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"S1-archive-owner.test.ts","line":[15],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"S1-codecs-indexes.test.ts","line":[83],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"S1-dispatch-guards.test.ts","line":[21],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"S1-provenance.test.ts","line":[68],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"S1-requeue.test.ts","line":[14],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"S1-responsibility.test.ts","line":[132],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"S1-session-facts.test.ts","line":[18],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"S1-wait-disposal.test.ts","line":[11],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"S2A-notices-attempt.test.ts","line":[20,23],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"S2A-notices-counts.test.ts","line":[25,32],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"S2A-notices-overbound.test.ts","line":[25,27],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},
{"section":"2","file":"S2A-notices-rework.test.ts","line":[22],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"Q"},

{"section":"2","file":"A2-step1-manifest.test.ts","line":[18],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E1"},
{"section":"2","file":"C1-session-mailbox.test.ts","line":[21],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E1"},
{"section":"2","file":"C2-mailbox-admission.test.ts","line":[16],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E1"},
{"section":"2","file":"B2-execution-entry.test.ts","line":[223,235],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E1"},
{"section":"2","file":"R4c-execution-history-index.test.ts","line":[661],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E1"},
{"section":"2","file":"R4c-execution-read.test.ts","line":[233],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E1"},
{"section":"2","file":"B2-01-blocked-commands.test.ts","line":[51,95,99,125,159,168],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"前五处E2；168为E3"},
{"section":"2","file":"B2-01-task-read.test.ts","line":[44,83],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E3"},
{"section":"2","file":"B2-03-crr-request.test.ts","line":[79,100,114,124,147,161,164],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E2"},
{"section":"2","file":"B2-07-crr-card-closed.test.ts","line":[43,66,111,126],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E3"},
{"section":"2","file":"B2-07-crr-card.test.ts","line":[46,54,97,144,179],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E3"},
{"section":"2","file":"B2-08-crr-answer.test.ts","line":[60,77,91],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E3"},
{"section":"2","file":"B2-08-crr-cancel.test.ts","line":[32],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E3"},
{"section":"2","file":"B2-09-answer-replay.test.ts","line":[31],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E3"},
{"section":"2","file":"B2-09-crr-owner.test.ts","line":[98],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E3"},
{"section":"2","file":"B2-12-recognition.test.ts","line":[135],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E3"},
{"section":"2","file":"B2-12-rewrite-prefix.test.ts","line":[53,57,139],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E2"},
{"section":"2","file":"B2-14-crr-forms.test.ts","line":[68,83,100,120,137,153],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E2"},
{"section":"2","file":"B2-17-disposition-reads.test.ts","line":[37,52],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E2"},
{"section":"2","file":"B2-18-request-reads.test.ts","line":[77],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E2"},
{"section":"2","file":"B2-UR7-crr-answer.test.ts","line":[122,182],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"E3"},
{"section":"2","file":"R3c-plan-adoption.test.ts","line":[225,313],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"同文件:221、309真实准备；H/task-claim-fixture.ts:606返回原值"},
{"section":"2","file":"R5b-initial-plan.test.ts","line":[245],"owner":"runtime.startQuery","value":"prepared","verdict":"v2 允许","note":"同文件:242真实prepareQuery返回"},
{"section":"2","file":"R5b-query-execution.test.ts","line":[189],"owner":"runtime.startQuery","value":"prepared","verdict":"v2 允许","note":"同文件:183真实prepareQuery返回"},

{"section":"2","file":"B2-01-blocked-commands.test.ts","line":[70,104,105,141,151,166,175],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"R；H/K3-blocked-command-fixture.ts:503转交"},
{"section":"2","file":"B2-03-crr-request.test.ts","line":[66,79,100,114,124,147,161],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"R；构造链H/K3-crr-fixture.ts:63"},
{"section":"2","file":"B2-07-crr-card-closed.test.ts","line":[120],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"R"},
{"section":"2","file":"B2-08-crr-answer.test.ts","line":[35],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"R；成功应用分支"},
{"section":"2","file":"B2-08-crr-cancel.test.ts","line":[36],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"R"},
{"section":"2","file":"B2-09-answer-replay.test.ts","line":[35],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"R"},
{"section":"2","file":"B2-09-crr-owner.test.ts","line":[103,259],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"R；本地接线同文件:172"},
{"section":"2","file":"B2-12-recognition.test.ts","line":[140],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"R"},
{"section":"2","file":"B2-12-rewrite-prefix.test.ts","line":[53,57,139],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"R；H/K3-prefix-claim.ts:80转交"},
{"section":"2","file":"B2-14-crr-forms.test.ts","line":[55,68,83,100,120,137,153],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"R；构造链H/K3-crr-fixture.ts:63"},
{"section":"2","file":"B2-17-disposition-reads.test.ts","line":[31],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"R"},
{"section":"2","file":"B2-18-request-reads.test.ts","line":[86,196],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"R"},
{"section":"2","file":"B2-UR7-crr-answer.test.ts","line":[127,144,164],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"R；Workflow也接入回调，同文件:92"},

{"section":"2","file":"A1-independent-review.test.ts","line":[83],"owner":"sessions.findSessions","value":"cursor","verdict":"v2 允许","note":"公开前页返回；同文件:95"},
{"section":"2","file":"A1-session-discovery.test.ts","line":[43,192],"owner":"sessions.findSessions","value":"cursor","verdict":"v2 允许","note":"公开前页返回；同文件:138、191"},
{"section":"2","file":"A1-session-independent.test.ts","line":[147],"owner":"sessions.findSessions","value":"cursor","verdict":"v2 允许","note":"公开前页返回；同文件:152"},
{"section":"2","file":"B2-01-task-read.test.ts","line":[61],"owner":"unknownCallReviews.listReviews","value":"cursor","verdict":"v2 允许","note":"公开nextCursor；同文件:67"},
{"section":"2","file":"B2-09-crr-owner.test.ts","line":[146],"owner":"unknownCallReviews.listReviews","value":"cursor","verdict":"v2 允许","note":"公开nextCursor；同文件:150"},
{"section":"2","file":"B2-03-crr-request.test.ts","line":[79,100,114,124,147,161],"owner":"unknownCallReviews.listReviews","value":"cursor","verdict":"v2 允许","note":"H/K3-crr-fixture.ts:111、117公开nextCursor原样续用"},
{"section":"2","file":"B2-14-crr-forms.test.ts","line":[68,83,100,120,137,153],"owner":"unknownCallReviews.listReviews","value":"cursor","verdict":"v2 允许","note":"H/K3-crr-fixture.ts:111、117公开nextCursor原样续用"},
{"section":"2","file":"C1-session-mailbox.test.ts","line":[411,417,533,535,547],"owner":"messages.readInbox","value":"cursor","verdict":"v2 允许","note":"公开首读返回；同文件:408、532"},
{"section":"2","file":"C1-session-mailbox.test.ts","line":[333],"owner":"messages.readInbox","value":"atLeastCursor","verdict":"F1","note":"同文件:332加1000重造"},
{"section":"2","file":"R3c-plan-adoption.test.ts","line":[151],"owner":"plans.queryTaskGraph","value":"atLeastCursor","verdict":"v2 允许","note":"apply返回cursor；同文件:129"},
{"section":"2","file":"R3c-plan-adoption.test.ts","line":[152],"owner":"plans.queryTaskGraph","value":"atLeastCursor","verdict":"F1","note":"同文件:153加1000重造"},
{"section":"2","file":"R3d-observed-architecture.test.ts","line":[29],"owner":"architecture.queryArchitecture","value":"cursor","verdict":"v2 允许","note":"公开前页nextCursor；同文件:27"},
{"section":"2","file":"R3d-observed-boundaries.test.ts","line":[23,25,27,34],"owner":"architecture.queryArchitecture","value":"cursor","verdict":"v2 允许","note":"公开前页nextCursor；同文件:20"},
{"section":"2","file":"R4b-session-boundaries.test.ts","line":[227],"owner":"sessions.findSessions","value":"cursor","verdict":"v2 允许","note":"公开前页nextCursor；同文件:232"},
{"section":"2","file":"R4b-session-directory.test.ts","line":[220,224],"owner":"sessions.findSessions","value":"cursor","verdict":"v2 允许","note":"公开前页nextCursor；同文件:218"},
{"section":"2","file":"R4c-execution-read.test.ts","line":[336,484],"owner":"executions.readExecution","value":"atLeastCursor","verdict":"v2 允许","note":"真实claim返回cursor"},
{"section":"2","file":"R4c-execution-read.test.ts","line":[325,339],"owner":"executions.readExecution","value":"atLeastCursor","verdict":"F1","note":"同文件:324、338加25重造"},
{"section":"2","file":"R4c-execution-read.test.ts","line":[536],"owner":"executions.readExecution","value":"atLeastCursor","verdict":"F1","note":"同文件:535测试签发畸形值后强转"},
{"section":"2","file":"S1-session-facts.test.ts","line":[159],"owner":"sessionFacts.listSessionExecutions","value":"cursor","verdict":"v2 允许","note":"公开first.nextCursor；同文件:153"},
{"section":"2","file":"S2A-notices-counts.test.ts","line":[96],"owner":"decisions.queryDecisionQueue","value":"cursor","verdict":"v2 允许","note":"公开nextCursor；同文件:101"},
{"section":"2","file":"S2A-notices-overbound.test.ts","line":[41],"owner":"decisions.queryDecisionQueue","value":"cursor","verdict":"v2 允许","note":"公开nextCursor；同文件:48"},
{"section":"2","file":"S2A-notices-counts.test.ts","line":[109,112],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"公开页面返回；同文件:107、110"},
{"section":"2","file":"S2A-notices-rework.test.ts","line":[61],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"公开页面返回；同文件:59"},

{"section":"2","file":"A1-independent-review.test.ts","line":[40],"owner":"catalog.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"公开采用返回baseline.contentDigest；同文件:22"},
{"section":"2","file":"R3b-material-applicability.test.ts","line":[93,95,97,98],"owner":"materials.openArtifact","value":"ref.digest","verdict":"F1","note":"内部body store直接产生；同文件:65、69"},
{"section":"2","file":"R3c-task-relations.test.ts","line":[128,151,158],"owner":"plans.proposePlan","value":"artifactRef.digest","verdict":"F1","note":"同文件:53手造；74放入草稿；142畸形摘要"},
{"section":"2","file":"R3e-completion.test.ts","line":[202],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"真实安装返回；同文件:184"},
{"section":"2","file":"R5a-project-bootstrap.test.ts","line":[236,243,266,276,277,306,327,330,332,443,467],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"公开安装返回；validTarget见同文件:251"},
{"section":"2","file":"R5a-project-bootstrap.test.ts","line":[253,256,261],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"F1","note":"测试签发f/a重复摘要"},
{"section":"2","file":"R5b-initial-plan.test.ts","line":[169],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"公开安装返回原值"},
{"section":"2","file":"R3d-observed-architecture.test.ts","line":[21,28,104,124,128,173,190],"owner":"architecture.queryArchitecture/queryImpact","value":"selection.capture指纹","verdict":"v2 允许","note":"公开capture原值；同文件:14、82、114、158、186"},
{"section":"2","file":"R3d-observed-boundaries.test.ts","line":[16,22,24,26,33,49,57,83,123,203,208,228,233],"owner":"architecture.queryArchitecture/queryImpact","value":"selection.capture指纹","verdict":"v2 允许","note":"公开capture原值；同文件:12、29、44、72、116、196、223"},
{"section":"2","file":"R3d-observed-boundaries.test.ts","line":[104],"owner":"architecture.queryArchitecture","value":"sourceDigest/configDigest/material.digest","verdict":"F1","note":"同文件:98、99、101改写返回值"},
{"section":"2","file":"R3d-record-integrity.test.ts","line":[192],"owner":"architecture.queryArchitecture","value":"selection.capture指纹","verdict":"v2 允许","note":"公开capture返回；同文件:165、191"},

{"section":"2","file":"R3c-plan-adoption.test.ts","line":[182],"owner":"roles.activateRoleSpec/runtime.createSession","value":"role.pin.digest","verdict":"v2 允许","note":"H/B2-runtime-fixture.ts:195、197、198、209安装返回原样使用"},
{"section":"2","file":"R4b-session-boundaries.test.ts","line":[145],"owner":"sessions.findSessions","value":"role.pin.digest","verdict":"F1","note":"同文件:116、118、119测试签发"},
{"section":"2","file":"R4c-task-claim-boundaries.test.ts","line":[40],"owner":"roles.activateRoleSpec","value":"target.digest","verdict":"v2 允许","note":"同文件:34、39公开安装返回"},
{"section":"2","file":"R4c-task-claim-boundaries.test.ts","line":[66],"owner":"sessions.admitSessionCreation","value":"role.pin.digest","verdict":"v2 允许","note":"同文件:39公开安装返回；H/task-claim-fixture.ts:362转交"},
{"section":"2","file":"R4c-task-claim-boundaries.test.ts","line":[67],"owner":"sessions.admitSessionCreation","value":"role.pin.digest","verdict":"F1","note":"测试改成f.repeat(64)"},
{"section":"2","file":"R3g-role-spec.test.ts","line":[116,158,168,208,219,329],"owner":"roles.readRoleSpec","value":"pin.digest","verdict":"v2 允许","note":"同文件:109、206、320公开安装返回；219仅改ref"},
{"section":"2","file":"R3g-role-spec.test.ts","line":[128,131,163,210,224,225,254,255,321,336,422,522,539],"owner":"roles.activateRoleSpec","value":"target.digest","verdict":"v2 允许","note":"同文件:109、164、206、207、251、252、320、421、520公开安装返回"},
{"section":"2","file":"R3g-role-spec.test.ts","line":[217,374,379,488,491],"owner":"roles.readRoleSpec","value":"pin.digest","verdict":"F1","note":"217改写；373手造；480、487保留测试安装命令的自算摘要"},
{"section":"2","file":"R3g-role-spec.test.ts","line":[221,495],"owner":"roles.activateRoleSpec","value":"target.digest","verdict":"F1","note":"221改写；495使用同文件:480、487的测试自算摘要"},
{"section":"2","file":"R3g-role-spec.test.ts","line":[379],"owner":"roles.readRoleSpec","value":"atLeastCursor","verdict":"F1","note":"内部readThrough加1000；同文件:375、378"},
{"section":"2","file":"R3g-role-spec.test.ts","line":[491],"owner":"roles.readRoleSpec","value":"atLeastCursor","verdict":"v2 允许","note":"同文件:490使用installed.commitCursor；492是调用后变更"}
]
```

v2 允许 416，F1 67，F3 0，A7 越界 0，文件 85/85；枚举完整