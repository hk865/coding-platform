G1 的 7 个文件已全部逐行读完，共 3,837 行、57 个测试声明；按当前参数表展开为 101 个用例。没有修改文件，没有运行测试或构建。以下“删除检查后是否失败”均为静态判断，不是变异测试结果。

本组不能判为 clean。主要问题仍是：用返回手造值的端口驱动真实 Workflow；公共路径夹具下面仍有直接写入事实的旧初始化；从存储断言；以及个别断言和验收序列不完整。

为避免重复很长的路径，下文测试文件使用唯一文件名，完整路径列于 COVERAGE；辅助文件位于 `tests/helpers/`，`common.ts` 位于 `tests/scenarios/support/`，`harness.ts` 位于 `tests/scenarios/`。生产文件路径为：

- `workflow.ts`：`src/business/workflow/workflow.ts`。
- `core-routes.ts`、`collaboration-driver.ts`：`src/app/`。
- `unknown-call-review-service.ts`、`control-service.ts`、`requeue-service.ts`：`src/core/work-graph/tasks/`。
- `run-machine.ts`、`review-lease.ts`：`src/core/work-graph/state/`。
- `decision-service.ts`：`src/core/work-graph/communication/`。
- `slice-K3-SPEC.md`：`docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`。

计数按不同违规语句或注入点计算；共享 helper 的定义不因调用次数、两个后端重复计数。调用传播另外列明。同一实例同时违反两条规则时分别计入，例如 targets 断言同时命中 F8、F12。T 项不计入 G1 的末尾计数。

**1. COVERAGE**

| 文件 | 测试声明／展开数 | 全读 | 命中规则 | 调用的 helper 及独立判断 | 最后一个测试的完整标题 |
|---|---:|---|---|---|---|
| `tests/app/K3-15-review-routes.test.ts` | 3／5 | 是，1–194 | F1、F3、F4；另有 A6 结构欠缺 | `fixture:73`：F4，并继承下述 world 初始化问题；`routePlatform:66`：F4；`claimUnenteredRound:95`、`scopeOf:103`、`call:107`、`graphWrite:113`：A1；`createK3PendingReview`（`K3-proposal-round.ts:255`）：公开运行链部分 A1，继承 world／工具替身问题；`readK3Review`（同文件:277）：A1；`openK3ReviewCardWorld`（`K3-review-card-fixture.ts:127`）：F1、F3、F4；`createAutoSettledK3Record`（同文件:410）：实际使用 F4 read 替身；`shellSeam`、`readToolSeam`（`K3-tool-seams.ts:79、132`）：F4 | `K3-15 (五) %s route: release-hold returns { hold, requeue: null } when the original Run is not human-fenced, and replays`，:171 |
| `tests/business/K3-15-ur3h.test.ts` | 4／8 | 是，1–362 | F1、F3、F4、F8、F11、F12 | `makeWorld:95`：F4；`configurationOf:66`、`kernelStoresOf:79`：A1 装配；`workspaceRevision:87`：直接读存储作装配输入，未把它冒称公共读取；`reviewClaim:142`、`readReview:151`、`hold:155`、`selectInput:163`、`performInput:168`、`operationOf:173`、`readRun:181`、`pauseRound:188`：A1；`createScriptedModel`（`B2-runtime-fixture.ts:69`）：A1；`createK3_35Runtime`（`K3-35-runtime.ts:120`）：真实 Runtime 装配部分 A1；共享 pending/world/工具 helper 同上一行的判定 | `K3-15 (七) %s: a Run revision moved before the cancel commit returns revision_conflict and nothing changes`，:329 |
| `tests/business/K3-17-goal-guard.test.ts` | 1／2 | 是，1–183 | F1、F3、F4、F6、F7 | `cardOf:47`、`goalPhaseRef:57`：A1；`pausedBeforeDisposition:62`：A3，先经真实 owner 暂停，再提交原 batch，没有改写提交结果；`goalAt`（`S5-application-support.ts:68`）及其 `recordAt:58`：F7；`world.createRecord`（`K3-review-card-fixture.ts:375、389`）：F6；world／工具替身继承 F1、F3、F4 | `K3-17 %s: a Goal pause before the disposition commit makes ② a revision_conflict, then busy, then applies after resume`，:85 |
| `tests/business/K3-41-release-hold.test.ts` | 5／7 | 是，1–588 | F1、F3、F4、F7；另有规格序列和断言完整性缺口 | `readReview:74`、`holdPersonReview:80`、`taskRowOf:145`、`queueOf:149`、`reviewCardOf:156`、`answerReviewCard:162`、`preparedBriefOfHost:171`：A1；`pausedAttestedWorld:97`、`:130、:138`：公共 Host／真实文件故障部分 A1/A2，但继承 F7 场景检查；`startAG2bHost`（`AG2b-collaboration-fixture.ts:185`）、`graphWrite:297`、`plain:299`：A1；`tempDir`、`publicDirectory`、`post`、`readExecution`、`goalControlPins`、`moveKernelAside`、`restoreKernel`（`A2-restart-fixture.ts:49、55、64、120、159、203、211`）：A1/A2；`driveChecked`（`common.ts:237`）、`pausedRunOnClosedHostChecked:459`：F7；`operatorRequeue:196`、`preparedOf:295`、`textReply:79`：A1；`routePlatform:331`、`routeFixture:355`：F4；`failReadControlOnce:435`：A2；`routeFacts:460`、`routeRuns:468`：F7；`bindingsFor:424`、`routeWrite:447`、`routeCall:453`、`goalControlThroughRoute:472`、`continuationRequest:489`、`releaseHoldBody:504`：公共调用部分 A1；`openRealRunHarness`（`K3-35-continuation-fixture.ts:443`）：共享运行链 A1、后端共享 A4，其传入 world 的旧初始化不因此豁免 | `K3-41 (二): after both steps commit and the Goal changes, the same release-hold replays the one requeue and adds no continuation`，:550 |
| `tests/business/K3-46-review-advance-failures.test.ts` | 9／18 | 是，1–757 | F1、F3、F4、F6、F7、F8、F9；另有 A6、内部输入和行号来源问题 | `selectWork:72`、`targetTaskId:82`、`cardOf:95`、`answerCard:106`、`adoptReorderedPlan:124`：A1；这里的 Plan 是经真实 propose/apply 提交的用户提案，未覆写保存的 Plan；`reviewServiceOver:157`：A1；`reviewService:175`：A3 计数；`assemble:191`：F4；`failingDispositionRecords:258`、`failingDispositionRecordsPerCard:282`：A2；`pausedBeforeDisposition:331`：真实竞争部分 A3，调用 `goalAt:339` 部分 F7；`waitForSettledDriver:315`：F9；`routedWorkflowBindings:389`：F4；`routeAdvance:406`：A1；`:548` 的 Workflow 包装器因 cap 返回手造结果而不是 A3；world／createRecord／shell 同前述判定 | `K3-46 (三) (%s) internal: the removed failedReviewRefs third argument is ignored`，:738 |
| `tests/business/K3-UR7-crr-failed-set.test.ts` | 5／5 | 是，1–560 | F1、F3、F4、F6、F7、F8、F9；另有后端、A6 和内部输入问题 | `selectWork:76`、`answerUcrCard:102`、`answerCrrCard:114`：A1；`requestRerunOf:127` 调用真实公共 owner，但其 recognizer 继承 F4，不能称整条链合规；`failingCardCommits:152`：A2；`reviewServiceOver:179`：A1；`crrServiceOver:198`：F4；`assemble:226`：F4；`messageAt`（`S5-application-support.ts:70`）：F7；`adoptReorderedPlan:322`：A1；`waitForSettledDriver:86`：F9；`blockedRecord/blockedRecordWithClaim`（`B2-crr-world.ts:100、111`）：运行链部分 A1，`settleUnavailable:190` 为 F6，`:165` 为 F8；`workRunCtx:226` 读真实 Run 后构造调用身份，没有覆写 Run；`crrCardOf:253`：A1；`:487` 的 cap 包装器为 F4 | `the failed-card set is never a public advance input (both field names are refused)`，:542 |
| `tests/business/K3-review-workflow-rows.test.ts` | 30／56 | 是，1–1193 | F1、F2、F3、F4、F6、F7、F8、F9、F11；另有 A6、后端、断言完整性及接受项冲突 | `refreshOriginSession:117`：F3；`makeWorld:153`、`makeRealWorld:203`：F4；`selectTask:305`、`claimUnenteredRound:311`、`pauseUnenteredRound:321`、`answerSavedOnly:368`、`holdRecord:383`：公共操作部分 A1；`reachNeedsDecision:338`：F6；`reachAwaitingApproval:346`：继承 proposal helper 的 F2/F9 及直接工具处理器调用问题；`reachUnknownReviewEnd:399`：按裁定 §3.6 接受其缺失 probe 注入，不另判禁止；`rawRun:719`、`performWorld:736`、`answerMessage:759`、`answersWorld:776`：被用于真实 Workflow 的 F4 输入链，不能按 A5；`untouched:733`：不是 A3 委托；`realOwnerWorkflow:978`：F4 goalSettings；`reviewLookupSource:1003`、`selectFor:1009`、`theUr7Perform:1013`：A1；`answeredUr7Selection:1022`：继承 world/createRecord；`expectUr7Applied:1039`：F7；`claimK3ReviewRound`（`K3-proposal-round.ts:383`）：F2/F9；`endK3RunCompleted:526`：A1，`endK3RunUnfinished:542`：A2；`settleK3Review:588`：真实结束后的 owner 调用部分 A1，但其 display 分支 F4；`writeK3Proposals:744`：实际直接调用处理器，见默认拒绝项 | `K3 UR7b (%s): two real handed-over answers whose ③ fail report the FIRST failure and still advance`，:1115 |

UNREAD：G1 文件为 0。没有把组外未完整审计的测试文件判为 clean。

**2. FINDINGS by rule**

以下公共修复路径在各实例中只指定一种去向：

- **P0，helper missing：`openK3PublicWorld`。** 必须经平台公开的项目、工作区、治理安装、Goal、Plan、Session 入口建立空白世界；经真实 Runtime prepare/start 建立运行事实；提供同一真实 memory/SQLite 后端和真实 mailbox。现有 `openK3ReviewCardWorld` 会进入 `S5-decision-fixture.ts:463、543、574、783` 的旧事实初始化，因此不能只改函数名后继续使用。
- **P1，helper missing：`workflowOfPublicWorld`。** 从 P0 的正式平台装配取得真实 Workflow、Runtime、evidence、checks、goalSettings、mailbox；需要观察时只作 A3 委托。`openRealRunHarness` 的真实运行装配可复用 `K3-35-continuation-fixture.ts:536、607、637`，但必须先消除 P0 指出的前置状态问题。
- **P2，helper missing：`reachReviewThroughWorkflow`。** 从真实 pending 记录开始，通过缩窄 Host 的只读命令授权制造不可用，然后调用真实 Workflow 的 select/perform；由 `workflow.ts:1485、1491` 产生 `review_unavailable`，不直接声称不可用。
- **P3，helper missing：`driveWithGates`。** 包住真实依赖，暴露开始／完成 Promise 和可释放的 gate；不睡眠，不返回替代 Workflow 结果。
- **P4，helper missing：`readPublicTaskHistory`。** 经公开任务、执行、rework 查询读取 Run 和重排数量，不调用 `readCanonicalTaskFacts(records, …)` 或 SQLite 不变量读取。

这些是待实现 helper，不是声称仓库已有文件。

F1：

- **F1-01｜`S5-decision-fixture.ts:698、707、728、736`｜标题：所有经 `openK3ReviewCardWorld` 建世界的 G1 服务测试。** `buildPrepared` 手造 manifest、envelope、permit，再让 `authorizeRuntimeEntry` 接受；`openS5DecisionFixture:783` 在初始化时实际执行这条链。处置：**(i) P0**，让真实 preparation 返回 prepared，再由 Runtime 入场。

F2：

- **F2-01｜`K3-proposal-round.ts:428、431、432`｜标题：`K3-review-workflow-rows.test.ts:447、459、566` 的运行中、已结束和 awaiting_approval 行。** 先调用真实配置读取，再 spread 并补写 `readonlyCommandAccess`，属于覆写读取结果，包装器没有原样返回。处置：**(i)** 修改 `createK3_35Runtime`（`K3-35-runtime.ts:120`）的正式 Host 配置输入，使该授权在配置建立时存在，删除读取后覆盖。

F3：

- **F3-01｜`task-claim-fixture.ts:227、233`｜标题：G1 所有 B2/S5 世界服务行，包括 `K3-review-workflow-rows.test.ts:521` 的 UR9。** 直接向 backend 提交 Project、Workspace、治理快照和 `TrustedScopeSeeded`。处置：**(i) P0**，使用公开安装与创建入口。
- **F3-02｜`task-claim-fixture.ts:324、327`｜标题：同上。** 测试自己创建 Kernel Session，再调用 Host 通常调用的 `recordSessionCreated`。处置：**(i) P0**，使用公开 `sessions/create`，可复用 `createAG2bSession`（`AG2b-collaboration-fixture.ts:381`）的调用形状。
- **F3-03｜`S5-decision-fixture.ts:541、543`｜标题：所有 K3 world 服务行。** 手造 Project、Workspace 后 `seedCommit`。处置：**(i) P0** 的公开项目／工作区创建。
- **F3-04｜`S5-decision-fixture.ts:558、568`｜标题：所有 K3 world 服务行。** 手编码治理版本和 active 指针后直接提交。处置：**(i) P0** 的治理安装／采用入口；公开路线可参照 `seedAG2bWorkGraphThrough`（`AG2b-collaboration-fixture.ts:354、361`）。
- **F3-05｜`S5-decision-fixture.ts:572、574`｜标题：所有 K3 world 服务行。** 手造三份 Goal，再把 revision 改为预设检查点并直接提交。处置：**(i) P0** 的 Goal 创建与设置入口。
- **F3-06｜`S5-decision-fixture.ts:630、632`｜标题：所有 K3 world 服务行。** `createS5Session` 自己完成 Kernel 写入和 Session 注册事实。处置：**(i) P0** 的公开 Session 创建。
- **F3-07｜`S5-decision-fixture.ts:733、739`｜标题：所有 K3 world 服务行。** 用写死的 Kernel run/turn 身份直接 `beginRuntimeEntry`。处置：**(i) P0**，由 Runtime 根据真实 Kernel begin 结果写入。
- **F3-08｜`S5-decision-fixture.ts:742、744、745`｜标题：所有 K3 world 服务行。** 直接写 `recordExecutionEntered`，position、history 起止值由测试提供。处置：**(i) P0**，由真实 Runtime 入场。
- **F3-09｜`S5-decision-fixture.ts:811、816、818`｜标题：所有 K3 world 服务行。** U1/U2 候选及其 claim、事件直接 seed。处置：**(i) P0**，经公开提案入口产生候选。
- **F3-10｜`S5-decision-fixture.ts:866、869`｜标题：所有 K3 world 服务行。** 手造消息正文 envelope 后直接写 body store，为随后手造消息提供事实。处置：**(i) P0**，让真实消息 owner 保存正文。
- **F3-11｜`S5-decision-fixture.ts:876、881`｜标题：所有 K3 world 服务行。** 手造待答消息及发送事件后直接提交。处置：**(i) P0** 的真实消息／决定请求入口。
- **F3-12｜`S5-decision-fixture.ts:886、892`｜标题：所有 K3 world 服务行。** 第二份待答消息也直接提交。处置：**(i) P0** 的真实消息／决定请求入口。
- **F3-13｜`S5-decision-fixture.ts:898、903、906`｜标题：所有 K3 world 服务行。** 手造 response，修改消息 revision/status/application，再直接提交答复事实。处置：**(i) P0** 的 `decisions/answer`。
- **F3-14｜`K3-review-workflow-rows.test.ts:138、139、141`｜标题：经 `makeRealWorld` 的 UR0–UR8 服务行。** 即使 probe 来自真实 Kernel，测试仍自行声明 Host lease 并直接写 Session 健康；真实 probe 不把 Host 写入变成人的公开动作。处置：**(i)** 由修复后的 `openRealRunHarness`（`K3-35-continuation-fixture.ts:607、694`）驱动真实 Host 健康核对，再公开读 Session。

F4：

- **F4-01｜`K3-15-review-routes.test.ts:66、67`｜标题：两条 K3-15 路由服务测试。** 未提供的路由端口由 Proxy 返回手造 `unsupported`。处置：**(i) P1** 的真实平台路由 bindings。
- **F4-02｜`K3-15-review-routes.test.ts:81`｜标题：两条 K3-15 路由服务测试。** `captureDigest` 固定返回 `'a'.repeat(64)`；裁定 §3.4 已明确禁止。处置：**(i)** 采用 `K3-41-release-hold.test.ts:365、371` 已有的真实 `VerificationWorkspaceReader.captureDigest` 委托。
- **F4-03｜`K3-15-review-routes.test.ts:83`｜标题：两条 K3-15 路由服务测试。** mailbox 读取恒回 `not_found`。处置：**(i) P0** 的真实 mailbox。
- **F4-04｜`K3-15-ur3h.test.ts:107`｜标题：四条 K3-15（六）（七）测试。** 同样的固定 digest，没有因为未被 canary 点名就变成允许。处置：**(i)** 采用 `K3-41-release-hold.test.ts:365、371` 的真实 capture。
- **F4-05｜`K3-15-ur3h.test.ts:110`｜标题：四条 K3-15（六）（七）测试。** requeue 的消息端口恒回 `not_found`。处置：**(i) P0** 的真实 mailbox。
- **F4-06｜`K3-15-ur3h.test.ts:120`｜标题：四条 K3-15（六）（七）测试。** evidence 的五个方法全部返回手造拒绝。处置：**(i) P1** 的真实 evidence；需要证明未调用时加 A3 计数。
- **F4-07｜`K3-15-ur3h.test.ts:127`｜标题：四条 K3-15（六）（七）测试。** check runner 返回手造拒绝。处置：**(i) P1** 的真实 runner 加 A3 观察。
- **F4-08｜`K3-41-release-hold.test.ts:331、333`｜标题：两条参数化 route 测试。** routePlatform 用返回手造拒绝的 Proxy 填空。处置：**(i) P1** 的真实路由 bindings。
- **F4-09｜`K3-41-release-hold.test.ts:373`｜标题：两条参数化 route 测试。** 消息读取恒回 `not_found`。处置：**(i) P0** 的真实 mailbox。
- **F4-10｜`K3-46-review-advance-failures.test.ts:199`｜标题：该文件九条 K3-46 测试。** Runtime 各方法返回手造 `unsupported`；连续推进行还依赖 `prepareExecution:205` 的假拒绝结束。处置：**(i) P1**，在真实 prepare 前用 P3 gate 停住。
- **F4-11｜`K3-46-review-advance-failures.test.ts:209`｜标题：该文件九条 K3-46 测试。** evidence 端口返回手造拒绝。处置：**(i) P1**。
- **F4-12｜`K3-46-review-advance-failures.test.ts:216`｜标题：该文件九条 K3-46 测试。** check runner 返回手造拒绝。处置：**(i) P1**。
- **F4-13｜`K3-46-review-advance-failures.test.ts:389、390`｜标题：route、failed-set 输出和旧内部参数三条测试。** 路由 bindings 用假端口填充正式平台接口。处置：**(i) P1** 的真实路由 bindings，只委托被观察的 advance。
- **F4-14｜`K3-46-review-advance-failures.test.ts:554、556、559`｜标题：`continuous: A and B fail ② once each and C is claimed in one drive`。** cap 分支返回手造 `waiting`，因此包装器不是 A3；`:620` 的调用次数断言能防止该分支被当成功，但不能使这种夹具形状合法。处置：**(i) P3**，真实终止／取消信号加 gate。
- **F4-15｜`K3-UR7-crr-failed-set.test.ts:209、214`｜标题：前三条失败集合测试及 Host driver 测试。** 自己比较 sha 并生成 `match: exact`，替代生产识别器。处置：**(i) P0** 装配正式 CRR 识别器，输入真实 Kernel 命令和真实工作区。
- **F4-16｜`K3-UR7-crr-failed-set.test.ts:238`｜标题：该文件五条测试。** Runtime 返回手造拒绝。处置：**(i) P1**。
- **F4-17｜`K3-UR7-crr-failed-set.test.ts:248`｜标题：该文件五条测试。** evidence 返回手造拒绝。处置：**(i) P1**。
- **F4-18｜`K3-UR7-crr-failed-set.test.ts:255`｜标题：该文件五条测试。** check runner 返回手造拒绝。处置：**(i) P1**。
- **F4-19｜`K3-UR7-crr-failed-set.test.ts:302、305、307、310`｜标题：该文件五条测试。** 重新实现 mailbox：直接读存储、拼 ready/unavailable，body 读取固定 unsupported；不是正式 mailbox 的委托。处置：**(i) P0** 的真实 mailbox。
- **F4-20｜`K3-UR7-crr-failed-set.test.ts:490、492、495`｜标题：`the Host driver carries the CRR failed ref across steps and never puts it in the public input`。** cap 返回手造 waiting；`:536` 只排除 failed，未排除 cap 导致的停止。处置：**(i) P3**，并以真实终点的公开状态结束。
- **F4-21｜`K3-review-workflow-rows.test.ts:158、167`｜标题：`K3 UR9/U4: no record keeps today's path`。** 无记录世界仍给 Workflow 一个假的 Runtime，包括固定 available 能力。处置：**(i) P1**。
- **F4-22｜`K3-review-workflow-rows.test.ts:169`｜标题：同一 UR9 行。** evidence 返回手造拒绝。处置：**(i) P1**。
- **F4-23｜`K3-review-workflow-rows.test.ts:176`｜标题：同一 UR9 行。** check runner 返回手造拒绝。处置：**(i) P1**。
- **F4-24｜`K3-review-workflow-rows.test.ts:223、232、233`｜标题：`makeRealWorld` 的 UR0–UR8 行，尤其 `K3 UR2/U4 … switch off`。** `world.capability` 直接决定 available/unavailable，Runtime 其他方法也是假拒绝；真实 review record 不会使假能力口合法。处置：**(i) P1**，UR2 用 A2 缩窄正式 Host 授权。
- **F4-25｜`K3-review-workflow-rows.test.ts:235`｜标题：`makeRealWorld` 的 UR0–UR8 行。** evidence 返回手造拒绝。处置：**(i) P1**。
- **F4-26｜`K3-review-workflow-rows.test.ts:242`｜标题：同上。** check runner 返回手造拒绝。处置：**(i) P1**。
- **F4-27｜`K3-review-workflow-rows.test.ts:281、282、285`｜标题：`:676` 的 answers input 和 `:697` 的 unreadable answer 行。** 用测试内 map 保存的消息快照替代实时公共 mailbox；`:375` 把此前读取结果放进 map，不构成 A3 委托。处置：**(i) P0** 的真实 mailbox，读失败使用包住它的 A2 wrapper。
- **F4-28｜`K3-review-workflow-rows.test.ts:736、743、744`｜标题：`:809` 的 L10 ended、`:820` 的 revision identity、`:845` 的 unknown outcome、`:856` 的 receipt 行。** `performWorld` 的 start/observe 返回手造 Run，调用分别在 `:811、822、848、857`；`rawRun:719` 不是纯测试，因为结果被送入真实 Workflow。处置：**(i)** helper missing：`performRealReviewRound`，经 P0、真实 claim/prepare/start 和 A2 中断产生所需 Run，再调用真实 Workflow。
- **F4-29｜`K3-review-workflow-rows.test.ts:746、748`｜标题：同上四条。** review 读取只返回测试拼出的 ref/revision，完全没有正式记录。处置：**(i)** 同一个 `performRealReviewRound`，读取真实 `readReview`。
- **F4-30｜`K3-review-workflow-rows.test.ts:749、811、857`｜标题：L10 ended、settle receipt 等 performWorld 调用。** settle 端口接受测试回调的手造提交回执，包含 `{}` cursor 或 `{seq:1}`。处置：**(i)** 同一个 `performRealReviewRound`，调用真实 settlement owner 并保留原回执。
- **F4-31｜`K3-review-workflow-rows.test.ts:759、776、784`｜标题：`K3 UR7b: another source kind is skipped (B3 adds it) and no disposition is applied`。** 手造完整答复消息，再从假的 mailbox 返回；“没有 store”不能满足 A5，代码仍创建 Workflow。处置：**(i)** helper missing：`answerRealNoteReviewCard`，经公开注记审查卡／答复入口产生其他来源消息，再交真实 mailbox；关于裁定 §3.6 的文字冲突见 OPEN QUESTIONS。
- **F4-32｜`K3-review-workflow-rows.test.ts:788、790`｜标题：同一 other-source 行。** disposition adapter 返回手造 `action:null, receipt:null`。处置：**(i) P1**，对真实 adapter 加 A3 调用观察。
- **F4-33｜`K3-review-workflow-rows.test.ts:898、899`｜标题：`K3 UR7 real owner … captured source and ② applies`。** goalSettings 返回手造 Goal 和 `order:0`。处置：**(i)** 使用该文件 `:253` 已示范的 `createGoalSettingsService` 正式 owner，建立在 P0 上。
- **F4-34｜`K3-review-workflow-rows.test.ts:990、991`｜标题：两条 `K3-17 reverse order`。** `realOwnerWorkflow` 同样伪造 goalSettings。处置：**(i)** 使用 `createGoalSettingsService`，参照该文件 `:253`。
- **F4-35｜`K3-review-workflow-rows.test.ts:1147、1148`｜标题：`two real handed-over answers whose ③ fail report the FIRST failure and still advance`。** 第三处伪造 goalSettings。处置：**(i)** 使用 `createGoalSettingsService`，参照该文件 `:253`。
- **F4-36｜`K3-review-workflow-rows.test.ts:1135、1159、1163`｜标题：同一双答复行。** `byMessageId` 缓存替代正式 mailbox；消息曾经真实保存不等于当前读取经过正式读口。处置：**(i) P0** 的真实 mailbox。
- **F4-37｜`K3-review-card-fixture.ts:139、142、148`｜标题：所有默认打开 K3 world 的 G1 服务行。** 默认 Kernel 命令 reader 是测试 map；真实版本只在 `realKernelCommandFacts:true` 的 `:150` 分支。处置：**(i)** 所有 G1 world 使用该 helper 已有的真实选项，正式读取在 `:154、158`。
- **F4-38｜`K3-review-card-fixture.ts:162、164`｜标题：所有 K3 world 服务行。** 工作区读取固定声称没有 `package.json`，没有读取真实目录。处置：**(i) P0** 的真实 workspace reader。
- **F4-39｜`K3-review-card-fixture.ts:200、205`｜标题：CRR failed-set 文件的请求建立。** 默认 CRR recognizer 自己生成 exact match。处置：**(i) P0** 装配正式 recognizer；命令事实可复用 `realKernelCommandReaderOf`（`B2-crr-world.ts:206`）。
- **F4-40｜`K3-review-card-fixture.ts:245、247、248`｜标题：经该 world 的消息／决定服务行。** mailbox duties 返回手造职责、两个 false 和空 guards。处置：**(i) P0** 的正式职责读取装配。
- **F4-41｜`K3-review-card-fixture.ts:305` → `executed-files-stub.ts:23、24`｜标题：经该 world 读取决定卡的 G1 行。** 注入已被生产实现替换的 executed-files 桩，固定返回 not_available。处置：**(i) P0** 使用正式 executed-files reader。
- **F4-42｜`K3-tool-seams.ts:79、85、93`｜标题：G1 所有使用 shellSeam 的记录建立行。** armed 分支没有执行真实 shell，去掉 capability 要求并在释放后返回手造 success；gate 本身是 A3 形状，整个替身不是。处置：**(i)** helper missing：`gateRealShell`，包装真实 shell handler，保留原定义和结果，只在指定点阻塞／取消。
- **F4-43｜`K3-tool-seams.ts:132、138、146`｜标题：`K3-15-review-routes.test.ts:171` 的 auto-settled 行。** read 替身没有执行真实 read，返回手造 success；调用路径为 `K3-review-card-fixture.ts:423、433`。处置：**(i)** helper missing：`gateRealRead`，在真实文件和真实 read handler 上作 A3 gate。
- **F4-44｜`task-claim-fixture.ts:245、248、253`｜标题：所有 B2/S5 世界服务行。** Plan owner 收到固定 unsupported 的 materials 端口。处置：**(i) P0** 的正式 materials。
- **F4-45｜`K3-proposal-round.ts:566、571、573`｜标题：调用 `settleK3Review` 的核对／提案链。** `settlementOwner` 把每个 alias 一律标成 `full`；这是 helper 的真实分支，不是从 prepared manifest 读取。G1 当前调用是否进入该分支取决于 `:591` 的 `observed.by`，不能因此把 helper 整体评为 A1。处置：**(i)** helper missing：`readActualReviewDisplays`，从本轮真实 prepared manifest 读取显示状态并原样交给 settlement owner。
- **F4-46｜`K3-46-review-advance-failures.test.ts:246`｜标题：该文件经 assemble 的服务行。** adapter 的 `reviews===undefined` 分支返回手造成功形状；而同函数 `:197` 已回退到 `world.reviews`，正常 world 不需要这条分支。处置：**(iii) 删除**，真实 adapter 路径已在 `:247`，该空成功分支没有对应公共场景。

F5：

- 本组未发现无真实原因重复发送 trigger/notification 的实例。重放请求本身没有按 F5 误报，例如 `K3-15-review-routes.test.ts:189`、`K3-41-release-hold.test.ts:572` 是明确的同请求重放场景。

F6：

- **F6-01｜`K3-review-card-fixture.ts:389、390`｜标题：C、E、F、G 中调用 `world.createRecord` 的 needs_decision 行。** 直接声称 `review_unavailable`，没有让真实能力检查得出不可用。处置：**(i) P2**。
- **F6-02｜`B2-crr-world.ts:190、193、194`｜标题：`K3-UR7-crr-failed-set.test.ts:355、401、446、465` 的 blocked record 前置步骤。** `settleUnavailable` 直接写入同一人为失败原因。处置：**(i) P2**。
- **F6-03｜`K3-review-workflow-rows.test.ts:338、339`｜标题：UR6 needs_decision、UR7、UR7b 等调用 `reachNeedsDecision` 的行。** 名字换成 reach helper，实际仍直接写 `review_unavailable`。处置：**(i) P2**。

F7：

- **F7-01｜`S5-application-support.ts:58、59、61、62、68、70`｜标题：`K3-17 … Goal pause`、`K3-46 … race`、CRR failed-set 服务行。** `goalAt`、`messageAt` 进入 `recordAt`，对原始 store 的 missing、records 数及解码作断言；调用在 `K3-17-goal-guard.test.ts:102`、`K3-46-review-advance-failures.test.ts:339`、`K3-UR7-crr-failed-set.test.ts:305`。处置：**(i)** Goal 使用公开 `plans.queryGoal`，消息使用 P0 的真实 mailbox。
- **F7-02｜`K3-41-release-hold.test.ts:527`｜标题：`a failed control-intent read is a rejected requeue, never null; the re-click performs one continuation`。** 经 `routeFacts:460` 的内部 plan reader 断言重排为 0。处置：**(i) P4**。
- **F7-03｜`K3-41-release-hold.test.ts:537、538`｜标题：同上。** 经同一内部 reader 断言重排为 1。处置：**(i) P4**。
- **F7-04｜`K3-41-release-hold.test.ts:544`｜标题：同上。** `routeRuns:468` 从内部 canonical facts 断言 Run 总数 2。处置：**(i) P4**。
- **F7-05｜`K3-41-release-hold.test.ts:577、578`｜标题：`after both steps commit and the Goal changes … adds no continuation`。** 内部事实读取后断言重排为 1。处置：**(i) P4**。
- **F7-06｜`K3-41-release-hold.test.ts:584、585`｜标题：同上。** 内部事实读取后断言 Run 总数 2。处置：**(i) P4**。
- **F7-07｜`K3-review-workflow-rows.test.ts:1056、1058、1060`｜标题：两条 `K3-17 reverse order`。** `expectUr7Applied` 直接调用内部 plan/canonical reader，断言没有 requeue。处置：**(i) P4**。
- **F7-08｜`harness.ts:683、684、688`｜标题：`K3-41-release-hold.test.ts:180、241、268` 三条 Host 行。** `driveChecked` 在 `common.ts:241、249` 调用不变量检查，后者从 database 读取整个 invariant world 再断言；前置 `pausedRunOnClosedHostChecked:491` 也调用它。处置：**(i)** helper missing：`drivePublicChecked`，保留真实 advance 循环，把断言改为公开 Goal／Task／Execution／Review／Message 读取。

F8：

- **F8-01｜`K3-15-ur3h.test.ts:241`｜标题：`hold then the next advance cancels the round … zero model calls`。** targets 的期望来自 `created.items.map`，不是本例已声明的 callId。处置：**(i)** 保留 `createK3PendingReview`（`K3-proposal-round.ts:255`）的公共路径，期望固定为手算的 `['k3-15-ur3h-call-1']`，输入出处为测试 `:208`。
- **F8-02｜`K3-46-review-advance-failures.test.ts:498`｜标题：`race: a concurrent Goal pause reports the real revision_conflict reason, not T02`。** 期望拼接了被测提交刚返回的 `rejectedReason`，因此同样错误的 reason 会自证。处置：**(i)** 保留 `pausedBeforeDisposition:331` 的真实竞争路径，把预期拒绝文字按该固定竞争例子手算写死。
- **F8-03｜`K3-review-workflow-rows.test.ts:578`｜标题：`K3 UR6 ($kind/$status): a $status card skips the task and waits with the card's formal source`。** 用生产 `decisionSourceKey` 算期望 key。处置：**(i)** 保留公开状态链，按固定 review ref/revision 的规范格式手算 key；两个状态各给独立期望。
- **F8-04｜`B2-crr-world.ts:165`｜标题：CRR failed-set 文件四条 SQLite 行的 blockedRecord 前置断言。** `blockedCommands.length` 的期望复制 `record.items.length`；本夹具串行停在第一条 shell，固定例子的期望应是 1。处置：**(i)** 保留 `blockedRecordWithClaim:111` 的公开运行链，改用手算字面量 1。

F9：

- **F9-01｜`K3-46-review-advance-failures.test.ts:315、326`｜标题：`continuous: A and B fail ② once each and C is claimed in one drive`。** 5 ms 轮询等待 driver。处置：**(i) P3**。
- **F9-02｜`K3-UR7-crr-failed-set.test.ts:86、97`｜标题：`the Host driver carries the CRR failed ref across steps …`。** 同样用 sleep 轮询。处置：**(i) P3**。
- **F9-03｜`K3-proposal-round.ts:343、347、356`｜标题：G1 中进入真实核对／提案轮的行。** 最多 500 次、每次睡 10 ms 等 entered；实际调用在 `claimK3ReviewRound:443、444`。处置：**(i) P3**，在真实 Runtime 入场写完成后释放可等待的 gate。

F10：

- 本组未认定 F10。`K3-46-review-advance-failures.test.ts:620` 数的是公开 advance 调用；`K3-review-workflow-rows.test.ts:1065` 的问题是观察时段不足以证明前一次 ③ 没重写，见下面完整性缺口，不能仅因用了 commit 计数就机械判 F10。

F11：

- **F11-01｜`K3-15-ur3h.test.ts:245、275、276、277`｜标题：`UR3a read the record, the late start gets RUN-02 stale, the next advance goes UR3h`。** 只拿到 cancel operation 就结束，没有 perform cancel、读 cancelled、再 settle；因此该行不执行它声称覆盖的 late-start 后 RUN-09(U) 收尾，删除 `control-service.ts:252` 的未进入取消分支也不会由这行发现。处置：**(i)** 复用同文件 `performInput:168`、`readRun:181` 和 `:225、235` 的公开执行序列，在 late-start 例子里完成取消及结算。
- **F11-02｜`K3-review-workflow-rows.test.ts:856、857、862、863`｜标题：`K3 settle_review: the owner receipt is preserved and the next selection follows`。** 只断言 receipt 的 kind 和 status；`value.revision`、cursor、replayed 等都不检查，丢掉这些回执字段仍满足断言。对应完整回执传递位于 `workflow.ts:2546、2547`。处置：**(i)** 使用 `performRealReviewRound` 的真实 owner 回执，逐项断言其身份、cursor、事件及结果保持，并公开读记录不被额外改变。

F12：

- **F12-01｜`K3-15-ur3h.test.ts:241`，D1:70｜标题：`hold then the next advance cancels the round … zero model calls`。** 以前期望为声明例子的 `[processItem(1).callId]`，现在为实际输出 `created.items.map(item => item.callId)`；换公共路径要求替换前置状态，没有授权把正确性期望改成输出自比。处置：**(i)** 保留公共路径，恢复由测试 `:208` 输入手算的 `['k3-15-ur3h-call-1']`。

规则表其他必需项；不硬塞进不相符的 F 编号：

- **A6｜`K3-15-review-routes.test.ts:147、151、153`｜标题：K3-15（四）member forbidden。** 手造 member context 的拒绝部分没有 `describe('rejects: …')`，也没有紧随拒绝的公共无变化读取。处置：**(i)** 保留 `call:107`，拆出独立 rejects 行并公开读 review／Run。
- **A6｜`K3-46-review-advance-failures.test.ts:635、645、652`｜标题：`input: every public failedReviewRefs is refused invalid, even a real same-project card`。** 四种输入在普通测试循环内；后续一次 fresh advance 不证明每次拒绝都没改变状态。处置：**(i)** 经 `routeAdvance:406` 拆为四条独立 rejects 行，每行公共读取前后状态。
- **A6｜`K3-46-review-advance-failures.test.ts:671、672、678`｜标题：`route: a real answered card ref is refused invalid, then the card still applies without it`。** 拒绝后继续能落实，不等于拒绝时无变化；缺 rejects 分组及当时的公共前后快照。处置：**(i)** 保留真实 route 路径，在再次 advance 前核对公共 review／answer／Task 状态。
- **A6｜`K3-UR7-crr-failed-set.test.ts:546、549、553`｜标题：`the failed-card set is never a public advance input (both field names are refused)`。** 两个字段在循环内拒绝，无 rejects 分组、无各次公共无变化证明。处置：**(i)** 拆为两个后端上的两条 rejects 行，经 P1 调用并公开读状态。
- **A6｜`K3-review-workflow-rows.test.ts:588、589、590`｜标题：`K3 L11 gatePerform … waits and writes nothing`。** 请求同时缺 reason 和 Goal/Run pins；生产分别在 `requeue-service.ts:298、362` 拒绝。当前 pending reason 断言确实能区别 gate 与格式拒绝，因此不虚报为“删 gate 仍绿”，但它仍不满足单错误输入规则。处置：**(i)** 用 `requeueBodyOf`（`common.ts:187`）同样的公开读 pin 方法构造完整合法请求，只保留 review 未结算这一项阻挡。
- **A1 默认拒绝｜`K3-46-review-advance-failures.test.ts:728`｜标题：`route: a failed apply hands the set beside a continuing next, never inside it`。** 测试自行往第三参数放 failed-card 集合；实际 Host 负责从上一结果保存并传递，位置为 `collaboration-driver.ts:818、829`。处置：**(i)** 经该文件 `:570` 的真实 driver 路径和 A3 观察验证传递，取消测试手工传内部参数。
- **A1 默认拒绝｜`K3-UR7-crr-failed-set.test.ts:393、394`｜标题：`a failed command_rerun_request ② continues the ordinary advance and carries the request ref`。** 即使集合复制自真实结果，测试仍跳过 Host 的内部传递路径。处置：**(i)** 使用该文件 `:507` 的真实 driver 路径，修复其 F4/F9 后观察内部转交。
- **A1 默认拒绝｜`K3-46-review-advance-failures.test.ts:751、752`｜标题：`internal: the removed failedReviewRefs third argument is ignored`。** 人为构造已移除的内部参数，不是产品公开输入。处置：**(iii) 删除**；公开字段拒绝由 `:626` 覆盖，真实内部集合传递由 `:525` 覆盖。
- **A1 默认拒绝｜`K3-proposal-round.ts:705、708、760`｜标题：`K3-review-workflow-rows.test.ts:566` 的 awaiting_approval 分支。** 注释称 scripted tool，实际手造 ToolCall 后直接执行 handler，绕过真实 Kernel 工具调用记录。处置：**(i)** helper missing：`proposeSaferMethodByModel`，让 `createScriptedModel`（`B2-runtime-fixture.ts:69`）在真实 proposal Run 中发出工具调用。
- **A1 默认拒绝｜`K3-46-review-advance-failures.test.ts:566、572`｜标题：continuous driver 行。** driver 的 Runtime、Session、mailbox 等依赖只是 throw 函数，不是包住真实依赖的 A3。处置：**(i) P1** 的真实 driver 装配。
- **A1 默认拒绝｜`K3-UR7-crr-failed-set.test.ts:504、508`｜标题：Host driver carries CRR 行。** 同样的 throw 端口装配。处置：**(i) P1**。
- **A1 默认拒绝｜`K3-review-workflow-rows.test.ts:733`｜标题：performWorld、answersWorld 及三个 real-owner Workflow 区域。** `untouched` 不是 A3：访问时只抛错，从不委托真实依赖。处置：**(i) P1** 的真实依赖加调用计数。
- **A5｜`K3-15-ur3h.test.ts:221`｜标题：K3-15（六）cancel 行。** 场景里另断言内部纯 predicate；它不能作为满足 A5 的纯行。处置：**(iii) 删除该冗余断言**，公开取消结果已由 `:225、229、230` 覆盖。
- **A5｜`K3-15-ur3h.test.ts:300`｜标题：K3-15（七）paused unentered 行。** 同一 predicate 的额外内部断言。处置：**(iii) 删除该冗余断言**，公开取消结果由 `:307、308` 覆盖。
- **每行后端｜`K3-UR7-crr-failed-set.test.ts:355、356`｜标题：failed CRR continues ordinary。** 只有 SQLite。处置：**(i)** P0 参数化为 memory、SQLite。
- **每行后端｜`K3-UR7-crr-failed-set.test.ts:401、402`｜标题：later CRR never overwrites earlier UCR。** 只有 SQLite。处置：**(i)** P0 参数化两个后端。
- **每行后端｜`K3-UR7-crr-failed-set.test.ts:446、447`｜标题：named-Task failed CRR waits。** 只有 SQLite。处置：**(i)** P0 参数化两个后端。
- **每行后端｜`K3-UR7-crr-failed-set.test.ts:465、466`｜标题：Host driver carries CRR。** 它是进程内 driver 服务测试，不是 Host 重启；只有 SQLite 不满足重启例外。处置：**(i)** P0 参数化两个后端。
- **每行后端｜`K3-UR7-crr-failed-set.test.ts:542、543`｜标题：both field names refused。** 只有 memory。处置：**(i)** P0 参数化两个后端。
- **每行后端｜`K3-review-workflow-rows.test.ts:521`、`:154`｜标题：UR9 no record。** 只有 memory。处置：**(i)** P0 参数化两个后端。
- **每行入口｜`K3-review-workflow-rows.test.ts:796、809、820、845、856`｜标题：other source、L10 ended、revision identity、L10 unknown、settle receipt。** 五条都实际创建 Workflow，不能以“纯、无 store”为由不覆盖后端。处置：**(i)** 按各自上述公共路径修复后，全部覆盖 memory、SQLite。
- **规格序列｜`K3-41-release-hold.test.ts:105` → `common.ts:466、467`｜标题：K3-41（一）。** 原 Run 停在 read，随后移走整个 Kernel，直接得到 needs_decision；没有规格 `slice-K3-SPEC.md:1462` 要求的在途 shell → pending_review → 核对轮 → 卡。处置：**(i)** helper missing：`pausedShellReviewHost`，按该完整序列建立场景。
- **规格序列｜`K3-41-release-hold.test.ts:242`｜标题：K3-41（二）。** 继承相同的 read／Kernel 缺失前置路径。处置：**(i)** 使用 `pausedShellReviewHost`。
- **规格序列｜`K3-41-release-hold.test.ts:269、271、274、290`｜标题：K3-41（三）crash between two steps。** 两步之间实际发生 Goal pause/resume，没有 Host 崩溃和重启。处置：**(i)** 在真实 release 提交后、requeue 前用 A3 gate 配合真实 Host 崩溃夹具中断，再重新启动并点击同请求。
- **断言完整性｜`K3-41-release-hold.test.ts:257、262`｜标题：K3-41（二）one continuation。** 只证明到了 open_checks 且选中一个不同 Run，没有证明总共只有一个 continuation。处置：**(i) P4**，补公开 rework／Run 数量为 1 的断言。
- **断言完整性｜`K3-41-release-hold.test.ts:286、299、311`｜标题：K3-41（三）exactly once。** 缺第一次失败后的零 requeue／AV-4 断言；最后“原 Run 仍 ended”不证明只有一次接续。处置：**(i) P4**，公开读失败窗口及重试后的数量。
- **断言完整性｜`K3-review-workflow-rows.test.ts:594、596`｜标题：L11 waits and writes nothing。** 没有公共无变化读取。处置：**(i)** 经 P4 和公开 review／Run 读取，比较调用前后。
- **断言完整性｜`K3-review-workflow-rows.test.ts:1062、1065、1085`｜标题：K3-17 reverse order a，records no second ③。** commit 基线取在 UR7 perform 之后，只证明后面的 select 没写，不能证明刚才的 UR7 没重复记录 ③。处置：**(i)** 采用同文件 `:942、964、968、969` 已有的公共 answer application／revision 前后比较，围住 `:1044` 那次 perform。
- **测试入口｜`K3-15-review-routes.test.ts:125`｜标题：route table。** 该行只检查配置表，没有单独的业务调用。处置：**(iii) 删除**，真实解析、派发、hold 和 release 行已由 `:134、171` 覆盖。
- **行号来源｜`K3-46-review-advance-failures.test.ts:420、452、477、502、525、626、660、689、738`。** 这九条的 K3-46 不是现行规格 `slice-K3-SPEC.md:1439` 的“平台条目／混合卡”两组；不能把这些测试记为该规格行验收完成。处置：**(i)** 保留各自公共行为测试，先按 OPEN QUESTIONS 取得正式行号映射再更名。

T：

- `B2-execution-fixture.ts:200、220、274、297、301` 的手造 prepared／入场写入属于裁定 §1 的 **T**。本组没有因导入这个文件就把 `createScriptedModel` 或所有 B2 方法一起判禁；G1 实际继续使用的非法前置状态在上面的调用路径逐项列出，不能随 helper 文件一起转入 T。
- `B2-runtime-fixture.ts:69` 的 `createScriptedModel` 是本组实际调用部分，判 A1；该文件另一个完整 Runtime fixture 的旧状态写法属于裁定列出的 T 文件，不据此给本组 scripted model 加罪。

**3. ROWS**

“是”表示：在其他前提不变、确实到达该分支时，静态上删除指定判断会破坏所列断言。它不表示夹具已满足 A1–A7。共享 F1/F3/F4 问题仍然有效。动态 ref、消息 ref、captured pins 的相等比较，只用于验证同一身份／传递，没有把业务结论从输出反算为期望。

| 行及位置 | 实际断言的字面量及来源 | 后端 | 删除指定检查是否会使该行失败 |
|---|---|---|---|
| `K3-15-review-routes.test.ts:125`，route table | `graph_write`、两个 binding／owner 名；来自入口定义要求，断言在 :126、129 | 无后端，配置表检查 | 不是行为守卫测试；改变 `core-routes.ts:459、460` 的表项会失败 |
| `K3-15-review-routes.test.ts:134`，K3-15（四） | pending@1 → claim@2 → hold 后 resolved/held@3；member 为 forbidden；未收尾 release 为 busy／“核对轮还没收尾”；来源 `slice-K3-SPEC.md:1429、1463`，revision 为一次创建、一次 claim、一次 hold 的手算 | memory、SQLite | 人权限检查 `unknown-call-review-service.ts:1012`：是；activeRound release 检查 :1131：是 |
| `K3-15-review-routes.test.ts:171`，K3-15（五） | resolved@1 → hold@2 → release@3；`requeue:null`；重复请求 replayed；来源规格 :1429、1670，三次写的手算 | memory、SQLite | 非人围栏返回 null 的 `core-routes.ts:959`：是；release 回执重放 `unknown-call-review-service.ts:1117`：是 |
| `K3-15-ur3h.test.ts:204`，K3-15（六）／UR3h／RUN-09(U)／UR4／UCR-08b | cancel operation、ended/cancelled、startedAt:null、无 executionHistory、activeRound:null、held 保持、模型 0；来源规格 :1429、1314、1317 | memory、SQLite | `workflow.ts:1403`、`control-service.ts:252`：是；targets 的期望在 :241 不合规，见 F8/F12 |
| `K3-15-ur3h.test.ts:245`，K3-15（六）late start／RUN-02 | prepare 同一 Run、start `source_stale`、下次选择 cancel、模型 0；来源规格 :1429 | memory、SQLite | `run-machine.ts:1508`：是；RUN-09(U)／UR4 后半链：否，没有执行，见 F11 |
| `K3-15-ur3h.test.ts:282`，K3-15（七）／UR3h | paused → cancel → cancelled → activeRound:null → release → requeue_task；模型 0；来源规格 :1429、1683 | memory、SQLite | `workflow.ts:1403` 使用取消专用 predicate、`review-lease.ts:53` 允许 paused：是 |
| `K3-15-ur3h.test.ts:329`，K3-15（七）revision race | `revision_conflict`，公开 Run 等于已 steer 后值，review 仍 held，模型 0；来源规格 :1429 | memory、SQLite | `control-service.ts:659` 的 Run pin 匹配：是 |
| `K3-17-goal-guard.test.ts:85`，K3-17／L19 | 首次 `application_not_recorded/revision_conflict`，暂停重试 `awaiting_resume/busy`，恢复后 applied/resolved，revision +1；来源规格 :456、1431 | memory、SQLite | Goal commit guard `unknown-call-review-service.ts:1396`：是；active 检查 :1302：是 |
| `K3-41-release-hold.test.ts:180`，K3-41（一）／AV-4 | resolved、hold:null、task_paused/human_pause、0 rework、0 自动 claim、1 人工 continuation；brief 两句中文字；来源规格 :1462、1670，数量为本例手算 | SQLite；标题中的 memory 没有实现，真实 Host 重启可用 SQLite 例外 | 人围栏与人工 requeue 路径能被断言约束；但规格要求的 shell／核对轮前置链未覆盖，见 :105、`common.ts:467` |
| `K3-41-release-hold.test.ts:241`，K3-41（二） | hold released、requeue committed、后续 open_checks、Run 不同；来源规格 :1462 | SQLite Host | `core-routes.ts:959、981`：是；“只有一次”没有足够公开数量断言 |
| `K3-41-release-hold.test.ts:268`，K3-41（三） | 首次 released＋requeue busy；恢复后 hold replayed＋requeue committed；来源规格 :1462 的两步状态，但当前用 Goal pause 代替 crash | SQLite Host | `unknown-call-review-service.ts:1117` 的 hold 重放：是；跨重启恢复及最后只有一个 continuation：未证明 |
| `K3-41-release-hold.test.ts:516`，K3-41（二）control read fault | unavailable 不是 null；重试 replayed；requeue 0→1、Run 数 2；来源规格 :1462、D9，数量手算 | memory、SQLite | `core-routes.ts:951` 的读失败传播：是；数量断言本身 F7 |
| `K3-41-release-hold.test.ts:550`，K3-41（二）replay after Goal change | 同 requeue ref/cursor，replayed:true；重排 1、Run 2；来源规格 :1462、L29 重放要求 | memory、SQLite | 先查重排回执的 `core-routes.ts:921、926`：是；数量断言 F7 |
| `K3-46-review-advance-failures.test.ts:420`，ordinary failed ② | advance、保留 apply receipt、`unavailable`＋注入文字、下一任务 `k3-20-b`、apply 1；字面错误来自测试注入，行为称来自旧 B1 rework-2 item 1，当前给定规格 K3-46 不对应 | memory、SQLite | `workflow.ts:2591、1949、1966`：是；行号来源待补 |
| `K3-46-review-advance-failures.test.ts:452`，designated failed ② | waiting、next:null、失败 receipt/reason；来源同上一行 | memory、SQLite | `workflow.ts:2590`：是 |
| `K3-46-review-advance-failures.test.ts:477`，Goal race | waiting、非 T02、`revision_conflict`；Goal 竞争来自规格 :456；完整 reason 的期望复制实际输出，见 :498 | memory、SQLite | `unknown-call-review-service.ts:1396`：是；`workflow.ts:2273` 的 T02 区分可被“不是固定句”约束；完整 reason 断言 F8 |
| `K3-46-review-advance-failures.test.ts:502`，T02 | waiting、next:null、固定 T02 中文句；基础变化拒绝来源规格 :456；给定 K3 规格没有提供该测试中文映射句的独立来源 | memory、SQLite | `unknown-call-review-service.ts:1310` 和 `workflow.ts:2273`：是 |
| `K3-46-review-advance-failures.test.ts:525`，continuous failed set | A、B 各 apply 1；C claim 1；两段失败文字；waiting；advance 总数 5；失败集合推广来源 `k3-g4b3-impl.md:131、253`；5 是当前“假 prepare 拒绝终止”路径的手算 | memory、SQLite | `collaboration-driver.ts:818、829` 和 `workflow.ts:1389`：是；但终点依赖 F4 Runtime |
| `K3-46-review-advance-failures.test.ts:626`，public failedReviewRefs | 四种值均 `invalid`，reason 含字段名；字段不能公开来源 `k3-g4b3-impl.md:253、255` | memory、SQLite | `workflow.ts:728、729`：是；A6 无变化证明缺失 |
| `K3-46-review-advance-failures.test.ts:660`，route public failed set | `invalid`，之后正常 apply/resolved；来源同上 | memory、SQLite | `workflow.ts:728、729`：是；后续成功不等于此前零变化 |
| `K3-46-review-advance-failures.test.ts:689`，set beside next | `failedCardRefs` 在结果外层，不在 next 内；A 失败后 B 继续；来源 `k3-g4b3-impl.md:253、255` | memory、SQLite | `workflow.ts:1955、1958、1963` 的集合封装及失败跳过：是；第三参数由测试手造，见 :728 |
| `K3-46-review-advance-failures.test.ts:738`，old internal key ignored | 旧 `failedReviewRefs` 第三参数不跳过 A；没有现行规格要求保留该内部兼容输入 | memory、SQLite | 对 `workflow.ts:695` 只读取新字段敏感；该旧内部接口测试应删除 |
| `K3-UR7-crr-failed-set.test.ts:355`，CRR failed ordinary | advance、非空下一步、失败文字、一个 discriminated CRR ref、apply 1；来源 `k3-g4b3-impl.md:131、253`，错误文字为注入字面量 | SQLite，缺 memory | `workflow.ts:2740、2769、2793、2794`：是；手工传第三参数另不合规 |
| `K3-UR7-crr-failed-set.test.ts:401`，UCR then CRR failure | 两个 ref 都保留；reason 为第一个 UCR，不能是第二个 CRR；来源为同一推广任务，FIRST 行为的旧 B1 任务书未提供 | SQLite，缺 memory | `workflow.ts:2773` 的 failure-null 条件及 `:2765、2772` 集合累加：是 |
| `K3-UR7-crr-failed-set.test.ts:446`，named Task failure | waiting、next:null、CRR 失败文字；来源推广任务及旧 designated 规则 | SQLite，缺 memory | `workflow.ts:2793` 的 designated 判断：是 |
| `K3-UR7-crr-failed-set.test.ts:465`，driver carries CRR | 第一次无集合、后续内部含 ref、公开输入无两个字段、apply 1、最终非 failed；来源 `k3-g4b3-impl.md:253、255` | SQLite，缺 memory；不是重启例外 | `collaboration-driver.ts:818、829`：是；最终“正常收束”没有排除测试 cap |
| `K3-UR7-crr-failed-set.test.ts:542`，public field names | `failedReviewRefs`、`failedCardRefs` 都 invalid；来源 `k3-g4b3-impl.md:253、255` | memory，缺 SQLite | `workflow.ts:728、729`：是；A6 不完整 |
| `K3-review-workflow-rows.test.ts:421`，UR0 | waiting、next:null、reason 含 review_unreadable；来源规格 :1313 | memory、SQLite | `workflow.ts:1382`：是 |
| `K3-review-workflow-rows.test.ts:430`，UR3a | prepare 同一 claim/Run；来源规格 :1315 | memory、SQLite | `workflow.ts:1412、1413`：是 |
| `K3-review-workflow-rows.test.ts:438`，UR3a paused | waiting、review_round_in_flight；真实 pre-entry pause，按裁定 §3.6 接受 | memory、SQLite | `workflow.ts:1412、1414`：是 |
| `K3-review-workflow-rows.test.ts:447`，UR3 | waiting、review_round_in_flight；来源规格 :1316 | memory、SQLite | `workflow.ts:1417`：是 |
| `K3-review-workflow-rows.test.ts:459`，UR4 | 实际 crashed；下一步 settle_review／round_ended；来源规格 :1317 | memory、SQLite | `workflow.ts:1419、1421`：是；使用 crashed 而非 completed，能区分普通失败路径 |
| `K3-review-workflow-rows.test.ts:470`，UR5 | waiting、review_round_unknown；来源规格 :1318；缺失 probe 的造法由裁定 §3.6 接受 | memory、SQLite | `workflow.ts:1419`、`review-lease.ts:64`：是 |
| `K3-review-workflow-rows.test.ts:478`，UR2 | settle_review／review_unavailable；来源规格 :1322 | memory、SQLite | `workflow.ts:1488、1491`：是；能力输入为 F4 |
| `K3-review-workflow-rows.test.ts:487`，UR1 | claim_task 携带本记录 ref/revision 和 phase review；来源规格 :1321、315 | memory、SQLite | `workflow.ts:1492、1515、1522`：是 |
| `K3-review-workflow-rows.test.ts:495`，UR1 busy Session | waiting、review_session_busy；占用由真实第二个 claim 建立；来源规格 :1321 的可领取前提 | memory、SQLite | `workflow.ts:1517`：是 |
| `K3-review-workflow-rows.test.ts:506`，UR1 missing binding | waiting、review_binding_missing、settle 0、记录仍 pending；绑定为空为 Host 配置输入；来源规格 :1321 | memory、SQLite | `workflow.ts:1480`：是 |
| `K3-review-workflow-rows.test.ts:521`，UR9 | ready，reason 不含 review_；来源规格 :1325 | memory，缺 SQLite | `workflow.ts:1383` 的 not_found 放行：是；该行没有锁定“今天路径”的具体 next |
| `K3-review-workflow-rows.test.ts:535`，UR8 no active round | waiting、unknown_call_review_held；来源规格 :1320 | memory、SQLite | `workflow.ts:1424`：是 |
| `K3-review-workflow-rows.test.ts:544`，标题 UR8，实际 UR3h | 断言 cancel_review_round、settle 0；来源规格 :1314，不是标题“skipped, never prepared or settled”的 UR8 | memory、SQLite | `workflow.ts:1403、1404`：是；应校正标题／行号 |
| `K3-review-workflow-rows.test.ts:566`，UR6 needs_decision | waiting、unknown_call_review_needs_decision、source/pin、settle 0；来源规格 :1323 | memory、SQLite | `workflow.ts:1430、1468`：是；source key 期望 F8 |
| `K3-review-workflow-rows.test.ts:566`，UR6 awaiting_approval | waiting、unknown_call_review_awaiting_approval、source/pin、settle 0；来源规格 :1323 | memory、SQLite | `workflow.ts:1430、1468`：是；proposal 前置 helper 另有问题 |
| `K3-review-workflow-rows.test.ts:585`，L11 gatePerform | waiting、next:null、unknown_call_review_pending；来源规格 :324–326 | memory、SQLite | `workflow.ts:1713`：是；请求同时有缺 reason／pins，零写入未断言 |
| `K3-review-workflow-rows.test.ts:603`，UR7 selection | apply_review_disposition、保存答复的 source/selection/pins、apply 0、③ 0、review 未变；来源规格 :1324、443、456 | memory、SQLite | `workflow.ts:1440、1456、1459、1461`：是 |
| `K3-review-workflow-rows.test.ts:626`，UR7 perform | applied、select_work、② 1、③ 1、review resolved；来源规格 :1324、749 | memory、SQLite | `workflow.ts:2576、2586、2589`：是 |
| `K3-review-workflow-rows.test.ts:650`，UR7 answer read failure | waiting、review_unreadable、apply 0；来源规格 :1313 的 fail-closed 及 :1324 的已答复前提 | memory、SQLite | `workflow.ts:1441`：是 |
| `K3-review-workflow-rows.test.ts:661`，UR8 before UR7 | waiting、held、apply 0、记录仍 held；来源规格 :1320 的优先级 | memory、SQLite | `workflow.ts:1424` 位于 :1430 之前：是 |
| `K3-review-workflow-rows.test.ts:676`，UR7b answers input | applied、select_work、apply 1、③ 1、resolved、requestId 前缀 card-application；业务来源规格 :1319、750，统一 card 身份背景为 `k3-g4b3-impl.md:131、253` | memory、SQLite | `workflow.ts:2755、2796`：是；前缀不是规格独立字面量 |
| `K3-review-workflow-rows.test.ts:697`，UR7b unreadable plus good | waiting、unavailable 文本、其余有效答复仍 apply 1；不可读文字由输入例子手算，处理规则在 UR7b 恢复要求 | memory、SQLite | `workflow.ts:2707、2710、2793`：是；mailbox 是 F4 |
| `K3-review-workflow-rows.test.ts:796`，UR7b other source | advance、receipt:null、next select_work、apply 0；“只处理两种卡”来源 `k3-g4b3-impl.md:253、256` | 无真实后端；实际 Workflow 桩测试 | `workflow.ts:2726`：是；A5/F4 与接受项冲突见 Q1 |
| `K3-review-workflow-rows.test.ts:809`，L10 start | next settle_review／round_ended；来源规格 :319、320 | 无真实后端 | `workflow.ts:2440、2441`：是；输入和端口 F4 |
| `K3-review-workflow-rows.test.ts:809`，L10 observe | 同上 | 无真实后端 | `workflow.ts:2451、2452`：是；输入和端口 F4 |
| `K3-review-workflow-rows.test.ts:820`，settlement identity | pins 为测试输入的 7、8，两个 requestId 不同；7/8 是手造例子，不是公共轮次推导；pin 规则来自正式写入约定 | 无真实后端 | `workflow.ts:235、238` 的 revision pin：是；真实多轮路径没有被验证 |
| `K3-review-workflow-rows.test.ts:845`，L10 unknown，start/observe | waiting，精确 normal-end reason；来源规格 :320，Run 名为本例输入 | 无真实后端 | `workflow.ts:2213` 的 known-end 检查：是；仅删除 purpose 分流时普通 `normalEnd/afterNotNormalEnd` 也能给相同结果，见 :581、615，因此不能拿它单独证明 purpose 分流 |
| `K3-review-workflow-rows.test.ts:856`，settle receipt | committed、select_work；完整回执保持来自正式 owner 回执约定 | 无真实后端 | 完整回执字段保持：否；`:863` 没检查 owner 返回的 revision/cursor，见 F11 |
| `K3-review-workflow-rows.test.ts:871`，UR7 real owner＋K3-17 正序 | captured pins 数 3、② applied、③ committed、review resolved；重试 ①② replayed、application 相等、message/review revision 不变；来源规格 :443、444、456、1431 | memory、SQLite | source 捕获 `workflow.ts:1456、1459`、owner pins `unknown-call-review-service.ts:1254`、重放 :1231：是；重放相等比较符合裁定 §3.1 |
| `K3-review-workflow-rows.test.ts:1068`，K3-17 reverse a | 先人落实，再 UR7 replayed:true、applied、卡进入历史；来源规格 :1431 | memory、SQLite | ② 重放 `unknown-call-review-service.ts:1231`：是；③ 无二次写入的公开版本保持没有证明，不能宣称已锁住 `decision-service.ts:1106、1112` |
| `K3-review-workflow-rows.test.ts:1088`，K3-17 reverse b | 第一次 application_not_recorded／unavailable，卡 answered_pending_application；UR7 后 applied；来源规格 :444、750、1431，故障由真实 commit wrapper 注入 | memory、SQLite | 重放 :1231 及后续 ③ 路径：是；“不重排”的断言 F7 |
| `K3-review-workflow-rows.test.ts:1115`，UR7b FIRST failure | advance、select_work、reason 为 FIRST 而非 SECOND；两份 review resolved、两份 answer application:null；L29 5b 来源规格 :750；FIRST 细则的旧任务书未提供 | memory、SQLite | `workflow.ts:2781` 的 `failure===null`：是；消息 port 和 goalSettings 为 F4 |

本组没有直接声称验收 RUN-25、B2-01…B2-18 的测试行；不能因为 helper 内部经过 RUN-20/RUN-22，就把它记为 RUN-25 覆盖。`K3-review-workflow-rows.test.ts:506` 标题里的 “B2” 是该 UR1 missing-binding 例子的标记，不是规格的 `B2-nn` 行。

**4. LEDGER**

以下逐条对应 D1 的行号，只给判断和去向，不重抄账本原文。

| D1 行 | 判断 |
|---:|---|
| 62 | 早先任务书要求：`k3-g4b3-rework-6.md` §2.3 要移除手造 recognition；替换为真实链，其提交检查在 `K3-35-continuation-fixture.ts:703、751`。 |
| 63 | 同一 §2.3 要求；正式 RUN-22 提交检查在 `K3-35-continuation-fixture.ts:751`，当前记录断言在 `K3-15-review-routes.test.ts:140`。 |
| 64 | 等价搬移：claim 的 committed 检查在 `S5-decision-fixture.ts:682、683`，调用在 `K3-15-review-routes.test.ts:99、142`。 |
| 65 | 等价搬移：`K3-15-review-routes.test.ts:167` 仍公开读取并检查 held 状态。 |
| 66 | 等价搬移：`K3-15-review-routes.test.ts:177`。 |
| 67 | 早先任务书要求：rework-6 §2.3 的 recognition 替换，提交检查在 `K3-35-continuation-fixture.ts:703`。 |
| 68 | 同一任务书要求；正式 resolve 提交检查在 `K3-35-continuation-fixture.ts:751`。 |
| 69 | 等价搬移：`K3-15-ur3h.test.ts:182、183` 的非 ready 抛错仍使测试失败。 |
| 70 | **F12 削弱**：当前 `K3-15-ur3h.test.ts:241` 从实际 items 生成期望；见 F12-01。 |
| 71 | 等价搬移：`K3-15-ur3h.test.ts:242`。 |
| 72 | 等价搬移：`K3-15-ur3h.test.ts:277`。 |
| 73 | 等价搬移：`K3-15-ur3h.test.ts:326`。 |
| 74 | 等价搬移：`K3-15-ur3h.test.ts:358`。 |
| 75 | 等价搬移：`K3-15-ur3h.test.ts:360`。 |
| 76 | 早先任务书要求：rework-6 §2.3 改为真实 Host recognition；当前调用在 `K3-41-release-hold.test.ts:400`，提交检查在 `K3-35-continuation-fixture.ts:703`。 |
| 77 | 同一任务书要求；正式 resolve 提交检查在 `K3-35-continuation-fixture.ts:751`。 |
| 78 | 等价搬移：`K3-41-release-hold.test.ts:527`；仍保留 F7，不因搬移变合规。 |
| 79 | 等价搬移：`K3-41-release-hold.test.ts:566`。 |
| 80 | 等价搬移：`K3-41-release-hold.test.ts:568`。 |
| 81 | 等价搬移：`K3-review-workflow-rows.test.ts:452、453`。 |
| 82 | 等价搬移：`K3-review-workflow-rows.test.ts:474、475`。 |
| 83 | 等价搬移，并改成公共读取：`K3-review-workflow-rows.test.ts:517、518`。 |
| 84 | 等价搬移：`K3-review-workflow-rows.test.ts:617`。 |
| 85 | 等价搬移，并改成公共读取：`K3-review-workflow-rows.test.ts:622、623`。 |
| 86 | 等价搬移：`K3-review-workflow-rows.test.ts:642、643、644`。 |
| 87 | 等价搬移，并改成公共读取：`K3-review-workflow-rows.test.ts:672、673`。 |
| 88 | 等价搬移：`K3-review-workflow-rows.test.ts:688、689`。 |
| 89 | 早先任务书要求的身份推广：`k3-g4b3-impl.md` §2 item 5、§8 answer 7（:131、253）把 UR7 推广为两种 card；当前具体前缀断言在 `K3-review-workflow-rows.test.ts:690`，没有改成宽泛任意前缀。 |
| 90 | 等价搬移：`K3-review-workflow-rows.test.ts:691`。 |
| 91 | 等价搬移：`K3-review-workflow-rows.test.ts:711`。 |
| 92 | 等价搬移：`K3-review-workflow-rows.test.ts:806`；当前例子仍有 F4。 |
| 388 | 等价搬移且增加双后端：`K3-15-review-routes.test.ts:134`。 |
| 389 | 等价搬移且增加双后端：`K3-15-review-routes.test.ts:171`。 |
| 390 | 等价搬移且增加 SQLite：`K3-15-ur3h.test.ts:204`。 |
| 391 | 等价搬移且增加 SQLite：`K3-15-ur3h.test.ts:245`；完整性问题另列 F11，不把旧缺口冒称本次删行。 |
| 392 | 等价搬移且增加 SQLite：`K3-15-ur3h.test.ts:282`。 |
| 393 | 等价搬移且增加 SQLite：`K3-15-ur3h.test.ts:329`。 |
| 394 | 等价搬移：`K3-41-release-hold.test.ts:515`，两后端仍在。 |
| 395 | 等价搬移：`K3-41-release-hold.test.ts:549`，两后端仍在。 |
| 396 | 等价搬移且参数化双后端：`K3-46-review-advance-failures.test.ts:420`。 |
| 397 | 等价搬移且参数化双后端：`K3-46-review-advance-failures.test.ts:452`。 |
| 398 | 等价搬移且参数化双后端：`K3-46-review-advance-failures.test.ts:477`。 |
| 399 | 等价搬移且参数化双后端：`K3-46-review-advance-failures.test.ts:502`。 |
| 400 | 等价搬移且参数化双后端：`K3-46-review-advance-failures.test.ts:525`。 |
| 401 | 等价搬移且参数化双后端：`K3-46-review-advance-failures.test.ts:626`。 |
| 402 | 等价搬移且参数化双后端：`K3-46-review-advance-failures.test.ts:660`。 |
| 403 | 等价搬移且参数化双后端：`K3-46-review-advance-failures.test.ts:689`。 |
| 404 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:421`。 |
| 405 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:430`。 |
| 406 | 等价搬移：`K3-review-workflow-rows.test.ts:438`；换真实 pre-entry pause 由裁定 §3.6 接受。 |
| 407 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:447`。 |
| 408 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:459`。 |
| 409 | 等价搬移：`K3-review-workflow-rows.test.ts:470`；missing probe 由裁定 §3.6 接受。 |
| 410 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:478`。 |
| 411 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:487`。 |
| 412 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:495`。 |
| 413 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:506`。 |
| 414 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:535`。 |
| 415 | 等价搬移至 `K3-review-workflow-rows.test.ts:544`；当前实际断言 cancel_review_round 在 :554，标题保留了过时 UR8／skip 说法，见 ROWS。 |
| 416 | 等价搬移且保留两种状态、增加两后端：四项矩阵在 `K3-review-workflow-rows.test.ts:561、562、563、564、565`。 |
| 417 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:585`。 |
| 418 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:603`。 |
| 419 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:626`。 |
| 420 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:650`。 |
| 421 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:661`。 |
| 422 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:676`。 |
| 423 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:697`。 |
| 424 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:871`。 |
| 425 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:1068`。 |
| 426 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:1088`。 |
| 427 | 等价搬移且参数化双后端：`K3-review-workflow-rows.test.ts:1115`。 |

核对结果：31 条断言记录、40 条测试／describe 记录，合计 71 条。D1 的七条 raised timeout、两条 strict→loose、单后端新增项均不落在 G1；没有把它们算进本组。

**5. CANARIES**

- `k3-b3-rulings-v1.md:44` 的 `performWorld`：**找到**，定义仍在 `K3-review-workflow-rows.test.ts:736`，假 Runtime 返回在 :743、744，假 review 在 :746、748，假 settle 在 :749。
- 同一 canary 的约 :811 调用：**找到**，当前 `K3-review-workflow-rows.test.ts:811`，属于 L10 ended 的 start／observe 循环。
- 同一 canary 的约 :822 调用：**找到**，当前 `K3-review-workflow-rows.test.ts:822`，手工分别输入 revision 7、8 于 :836、837。
- 同一 helper 的另外两处调用：**找到**，`K3-review-workflow-rows.test.ts:848` 的 unknown outcome，及 :857 的 owner receipt；没有只报裁定给出的两个示例。
- `k3-b3-rulings-v1.md:46` 的 literal digest：**找到**，`K3-15-review-routes.test.ts:81`；同形未点名实例在 `K3-15-ur3h.test.ts:107`。
- 裁定 §4 的两份多条目 owner 文件、K3-16 whole-summary、K3-48 字节／SQLite 项及七条 timeout：**均不在 G1 文件清单**，留给所属组，不宣称它们已修复或 clean。

**6. STATIC claims**

本报告没有用“公共步骤不可达”作为删除业务场景的依据，也没有把未执行的调用说成已经试跑。以下是实际做过的静态调用追踪：

- **late-start 并非不可达。** `K3-15-ur3h.test.ts:252` 真实 claim → :258 select prepare → :262 perform prepare → :268 hold → :271 Runtime start；拒绝点是 `run-machine.ts:1508、1509` 的 `source_stale`。然后 :275 真实 Workflow 已能给 cancel；缺的是测试继续 perform 和 settle，不是平台拒绝了公共路径。
- **paused before entry 并非不可达。** `K3-review-workflow-rows.test.ts:311` 真实 claim → :321 控制暂停；取消 predicate 在 `review-lease.ts:53` 只排除 cancelled，没有排除 paused；held 情况在 `workflow.ts:1403` 进入 cancel。该造法也由裁定 §3.6 明确接受。
- **公开 failed-set 字段确实被拒。** `K3-46-review-advance-failures.test.ts:406` 路由 parse/dispatch → 真实 `advanceWork` → `workflow.ts:728、729、730` 按字段存在即 invalid；这不能用来授权测试自行调用第三参数。正式第三参数路径是 `collaboration-driver.ts:818、821、829`。
- **L11 的当前请求有两个额外错误。** 静态序列为 `K3-review-workflow-rows.test.ts:591` → `workflow.ts:1704、1713` 先因 pending 等待；若越过此 gate，缺 reason 在 `requeue-service.ts:298` 拒绝，空 expected 在 :362 拒绝。因此应修成合法请求，而不是声称合法 requeue 无法造出。
- **UR7b 的 other-source 消息没有证明不可公开产生。** 当前 `K3-review-workflow-rows.test.ts:799` 直接造消息，`:801` 装假 mailbox；没有经过公开 note-review 卡和答复路线，也没有任何正式拒绝位置能证明那条路线不可达。所以本报告给的是“缺少公共 helper”，没有给 AGENTS 4 删除结论。
- **本组没有依赖“RUN-25 只能 SQLite”的判断。** RUN-25 后端问题属于裁定 §3.2 的专门问题，本组没有 RUN-25 验收行；这里只确认共享 harness 有 memory 工厂共享点 `K3-35-continuation-fixture.ts:637`，不把该装配点本身当 RUN-25 的完整可达性证明。

**7. OPEN QUESTIONS**

- **Q1：裁定 §3.6 的“Accepted”是否包括 `K3-review-workflow-rows.test.ts:796` 的原样实现？** `k3-g4b3-rework8-final.md:21` 的 UNSPECIFIED 6 把“pure UR7b 留在同文件”与真实 pause／missing probe 放在一起；裁定 `k3-b3-rulings-v1.md:39` 整项接受，但规则表 A5 明确禁止 pure 文件导入 Workflow／stub port，而此行在 `K3-review-workflow-rows.test.ts:776、793` 实际创建 Workflow。最小选项：① 接受仅指 pause／probe，UR7b 按 v1 改公共路径；② lead 明确记录 UR7b 的特殊待遇及其适用版本。审计不自行补 A7。
- **Q2：失败后继续推进、FIRST failure 和 T02 中文映射的冻结来源是哪份任务书？** `K3-46-review-advance-failures.test.ts:420` 等使用的 K3-46 与 `slice-K3-SPEC.md:1439` 不同；生产注释 `workflow.ts:1935` 指向 B1 rework-2 item 1，给定 `.lead-ref/` 没有这份书。最小选项：① 补齐旧 B1 冻结条目，并把测试标成其正式别名；② 在现行规格中明确登记这些 UR7 扩展行及固定错误文字。不能拿 `workflow.ts` 自己的注释和输出作独立期望来源。

**8. SEARCH LOG**

- 读取 `.lead-ref/groups/G1.txt`，逐个分段输出七份文件的全部行，核对总行数及每份最后测试；总计 3,837 行，最后位置分别为 194、362、183、588、757、560、1193。
- 全读 `.lead-ref/test-rule-sheet.md`、`.lead-ref/k3-b3-rulings-v1.md`，核对 A1–A7、default deny、T 清单、已撤回裁定和全部 canary。
- 读取 `.lead-ref/groups/H.txt`；逐个追踪 G1 调用的 helper。完整读取主要共享文件及其被调用方法，包括 `K3-proposal-round.ts`、`K3-review-card-fixture.ts`、`K3-tool-seams.ts`、`B2-crr-world.ts`、`K3-35-runtime.ts`、`K3-35-prepare.ts`、`B2-runtime-fixture.ts`、`B2-execution-fixture.ts`、`S5-application-support.ts`、`task-claim-fixture.ts`，以及 Host／场景辅助函数。
- 读取 `openS5DecisionFixture` 的整个初始化和返回方法段 `S5-decision-fixture.ts:459–1060`，向下追踪到 `task-claim-fixture.ts:160`；检查 seedCommit、手造 prepared、Session 注册、入场事实、候选及消息建立，不止检查 G1 测试文件中的显式 commit。
- 读取 `openRealRunHarness` 的实现及其 claim、prepare/start、Host recognition、resolve、memory 共享后端路径；区别正常装配与传入 world 的旧初始化。
- 检索并核对 `.lead-ref/b3-helpers.diff` 的文件边界及相关改动，特别检查 S5 改动没有移除旧 seed 路径；没有把历史 diff 当成当前实现。
- 读取 rework 6、7、8、rework8-final、此前 capped review，以及 closeout-grep 的相关说明；逐项核对“pure no-store”“0 defects”等说法对应的当前代码。
- 对 D1 按七个完整路径筛选，并逐条核对 62–92、388–427，共 71 条；分别判断任务书要求、等价搬移、削弱，不按“removed”关键词直接定罪。
- 搜索全部测试声明、`.each` 参数、断言、`setTimeout`、`setImmediate`、skip/todo/only 候选，再回读完整上下文；参数展开数为 101，没有把循环内两次调用误算成两个测试声明。
- 按含义追查 `rawRun`、`performWorld`、`answersWorld`、map mailbox、`sourceDigest`、`readReviewDisplays`、`recognize`、`recordSessionHealth`、`recordExecutionEntered`、`recordRunResult`、spread 后覆盖、内部 failed-card 第三参数、driver cap。
- 阅读相应规格 UR 表、K3-15、K3-17、K3-41、K3-46、L10/L11/L19/L29、R1–R5 和双后端要求；以现行行号核对，不采用历史文件里过期的绝对路径。
- 静态阅读对应生产判断：Workflow review gate、perform gate、start/observe 分流、失败集合、handed answers；hold/release、Goal/T02 守卫；Run entry；control revision；route release/requeue；driver 内部集合传递；③ 的幂等和已记账短路。
- 已尝试首选 `rg`，环境未提供；随后使用 Node `fs.readFile` 的 UTF-8 带行号读取及正则筛选。PowerShell 中文输出不可可靠阅读的部分以 UTF-8 重读；工具输出被截断的 G1 正文部分另分段重读，没有把截断输出算作完整覆盖。
- 未运行任何测试、构建、git 写操作或文件修改；未据先前“全部通过”报告推定当前规则合规。

G1: files read 7/7; instances by rule: F1 1, F2 1, F3 14, F4 46, F5 0, F6 3, F7 8, F8 4, F9 3, F10 0, F11 2, F12 1; open questions 2