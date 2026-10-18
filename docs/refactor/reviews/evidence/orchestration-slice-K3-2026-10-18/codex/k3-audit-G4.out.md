G4 的 11 个文件已逐行读完，共 2,853 行；没有修改文件，没有运行测试或构建。不能判为通过。主要问题是共享夹具仍手写前置事实、端口返回手造结果、隐藏的数据库断言，以及几个不能保护其所声称分支的测试。

以下计数按**不同源码问题位置**去重：共享 helper 的同一问题只计一次，同时列出 G4 调用范围；循环执行、双后端展开不重复计数。T 项单列，不计入 G4 的 F 计数。“删掉检查会失败”均为静态判断，没有执行变异测试。

为避免重复长标题，以下标题集合用于共享 helper 的归属：

- **W 组**：`K3-20-review-card-paging.test.ts:77` 的分页用例；`K3-29-startup-answers.test.ts:115` 的 current-card answer、`:148` 的 failed ③；`K3-29-startup-reconcile-2b.test.ts:201` 的列表、`:231` 的首页失败、`:260` 的 kind 1/2、`:281` 的 inactive Goal；`K3-44-crr-kind4.test.ts:32` 的 CRR kind 4。
- **H 组**：`B2-09b-allowance-crash.test.ts:98`；`K3-16-approval-round.test.ts:103`；`K3-29-startup-variants.test.ts:97`、`:125`、`:173`；`K3-44-recovery-answers.test.ts:219`、`:266`。
- 下文省略目录的测试文件名均指 COVERAGE 中的唯一同名文件；helper、生产代码仍给出路径。
- 规格行号均指 `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`。

**1. COVERAGE**

文件 | 测试 | 完整读取 | 命中规则 | 调用 helper 的裁定 | 最后一个测试标题

- `tests/scenarios/B2-09b-allowance-crash.test.ts` | 1 个声明、1 个用例 | 是，1–226 | F2、F4、F7、F8 | `HostScenario.open/restart`：启动和崩溃步骤 A1/A2，内置 invariant 检查 F7；`needsDecisionCard/crashOneCommand`：真实 Runtime/Workflow 步骤 A1，继承 shell/review root 的 F2、sandbox/shell 的 F4；`answerCard/reviewOf/queueOf/readExecution/preparedOf/preparedManifestOf`：A1；`createScriptedModel`：A1，第三次回复的 gate 为 A3；`openShellWorkRoot`：F2，继承固定 token counter 的 F4；`prepareOn`：A1；`listCommandRerunRequests`：A1，确实调用公开 owner 读接口；`shellSeam`：等待部分 A2，成功结果替身 F4；清理 helper：只清理测试资源 | `B2-09b: skip_as_done writes the binding, allow_rerun is consumed, the Host crashes before the command starts, and the restart shows used + outcome_unknown + a K3 review`
- `tests/scenarios/K3-16-approval-round.test.ts` | 1、1 | 是，1–234 | F2、F4、F7、F8 | `HostScenario`、`needsDecisionCard`、`shellSeam` 同上；`openReviewWorkRoot`：F2，继承 F4；`driveReviewUntil/createScriptedModel/answerCard/reviewOf/queueOf/preparedOf/preparedBriefOf`：A1；本地 `aggregateKeyOf/approvalCardOf`：公开结果定位，A1；`approvedMethodLinesZh` 被用作期望值：F8；`renderContinuationBriefZh` 作为被测函数：A5 | `K3-16: approve on the real awaiting_approval card resolves the record and the continuation carries the approved methods`
- `tests/scenarios/K3-20-review-card-paging.test.ts` | 1、2，memory/SQLite | 是，1–287 | F1、F3、F4、F6、F8、F11 | `openK3ReviewCardWorld/createRecord`：继承 S5 的 F1/F3，world 的 F4，以及 `review_unavailable` 的 F6；`allQueuePages/fixtureCtx`：A1，但聚合方式不能证明当前调用重试；`completeReadModel/emptyCardSource/emptyNoticeSource/createExecutedFilesStub`：F4；`cardSourceKey` 作期望：F8；中途写入 wrapper 返回真实原结果，形状为 A3，但其中调用的 `createRecord` 不合规；`shellSeam`：F4 | `%s: pageLimit 2 pages four cards, a fifth record committed mid-read appears on the retry, and the fifth card reads by key`
- `tests/scenarios/K3-29-startup-answers.test.ts` | 2、4，memory/SQLite | 是，1–198 | F1、F3、F4、F6 | `openK3ReviewCardWorld/createRecord`：F1/F3/F4/F6；本地 `answeredSource/cardOf/answerCard/goalOf`：A1；`reconcile/nothing`：F4；`untouched` 只是未调用路径的断言哨兵，不能把其余 stub 变成 A2；`failNextApplicationCommit`：A2；`listUnappliedAnswers` 包装：A3；`shellSeam`：F4 | `K3-29 (%s): a real ② commit with a failed ③ is handed over by its own reviewRef after a direct hold closes the record`
- `tests/scenarios/K3-29-startup-reconcile-2b.test.ts` | 5、9，其中 4 个双后端声明 | 是，1–292 | F1、F3、F4、F9、F11；另有 A5 文件隔离违规 | `openK3ReviewCardWorld`：F1/F3/F4；`incompleteRecord/pendingRecord/openRealRunHarness/createK3PendingReview`：后半段 Runtime、RUN-20/22 为 A1，前置 world/session 仍继承 F1/F3；`heldRecord/readK3Review/goalSnapshots/projectionOver/endK3RunUnfinished`：A1/A2；`pauseGoalB`：F3；`reconcile/nothing`、两处 display reader：F4；`claimK3ReviewRound`：真实 claim/start 部分 A1，session 前置 F3、轮询 F9；只读 commit wrapper、首次 lookup 故障：A2 | `K3-29 (%s): an inactive Goal is not handed off even with an open record`
- `tests/scenarios/K3-29-startup-variants.test.ts` | 3、3，SQLite Host 重启 | 是，1–250 | F2、F4、F7、F9 | `HostScenario/needsDecisionCard/openReviewWorkRoot/shellSeam`：同 H 组裁定；本地 `answer/messageApplication`、`answerCard/reviewOf/queueOf/preparedOf/driveReviewUntil/createScriptedModel`：A1；`failCommitOf`：A2，真实提交失败；`waitFor`：F9；`expectQuietHarnessRestart`：重启 A2、计数断言 F7 | `K3-29 variant (c): a real safer_method answer enters awaiting_proposal at stateEntry+1; kind 1 hands the Goal over and the record stays`
- `tests/scenarios/K3-44-crr-kind4.test.ts` | 1、1，仅 SQLite | 是，1–104 | F1、F3、F4、F6、F11；另有双后端要求未满足 | `openK3ReviewCardWorld`：F1/F3/F4，`realKernelCommandFacts:true` 这一路 Kernel reader 是 A1；`blockedRecord`：真实阻塞 Run 部分 A1，`settleUnavailable` 为 F6；`requestRerunOf/workRunCtx`：F3；`crrCardOf/readUnappliedAnswers`：A1；`failNextApplicationCommit`：A2；本地 startup platform：F4；`shellSeam`：F4 | `K3-44: 6b (c) kind 4 lists the CRR answer by Goal and the advance applies ③`
- `tests/scenarios/K3-44-recovery-answers.test.ts` | 2、2，SQLite Host 重启 | 是，1–338 | F2、F4、F7、F9 | `HostScenario/openShellWorkRoot/shellSeam`：同上；`createProcessSandboxStandin`：F4；本地 `crashShellRun`：崩溃步骤 A2，继承 root/stand-in 问题；`openMissingReadReviewRoot`：通过真实 Host 配置缩窄授权，A2；`createNeedsDecisionRecord`：让真实 Workflow 选择并执行 settle，A1/A2；`reviewCard/queueOf/messageApplication/resolvedRecord/readExecution`：A1；`answerWithFailedApplication/failCommitOf`：A1/A2；`waitFor/waitForFlowToStop`：F9；`expectQuietHarnessRestart`：F7 | `K3-44 (三): UR7b replays ② and does ③ on a historical record (open no, selected Run the continuation); no hold is released and no second continuation is claimed`
- `tests/state/command-normalization.test.ts` | 60、60 | 是，1–445 | F8 | 本地 `sha/keyOf`：独立 `node:crypto` 计算，A5；`parsed/wordsOf/nestShell/unparsedFor/detailed/dirsOf`：A5；没有 store、Host、Workflow、Runtime 或 stub；`:47`、`:48` 的被测函数自比另见 F8 | `keeps the public parseShellActions projection unchanged`
- `tests/state/command-rerun-request-used-by.test.ts` | 3、3 | 是，1–113 | clean | `baseInput/ctx/accepted/pending/allowed`：均只构造纯状态机输入或解包纯返回值，A5；事件和 `usedBy` 直接传给纯状态机，不是 owner 接受事实，不能报 F1/F3 | `B2-09 replays the same used identity unchanged`
- `tests/state/command-rerun-request.test.ts` | 25、25 | 是，1–366 | F8 | `baseInput/ctx/record/*Event/accepted/rejected/effectsOf/messageRef/requestRef/reviewRef`：A5；`openRequestForAlias` 的手造数组是纯函数输入，A5；两处容量数据随生产常量变化，F8 | `openRequestForAlias selects only the open request for the (task, review, alias)`

UNREAD：无 G4 文件。合计 104 个测试声明，按 `.each` 展开为 111 个用例；测试内部的循环不另算 Vitest 用例。

**2. FINDINGS by rule**

每行只有一个处置。标为“helper missing”的都是需要补齐的公开步骤 helper，不表示当前已有合规实现。

**F1：1 处**

- F1-01 | `tests/helpers/S5-decision-fixture.ts:736`，W 组全部标题 | `buildPrepared` 在 `:707`、`:719`、`:725` 手造 manifest/envelope/binding，随后由 `authorizeRuntimeEntry` 接受；真实 owner 并不使手造 prepared 合法 | 处置 (i)：helper missing：由真实 Runtime 的 `prepareExecution` 产生 prepared，再由 `startRun` 进入；复用 `openRealRunHarness` 的准备、启动步骤 `tests/helpers/K3-35-continuation-fixture.ts:555`、`:576`，替换 S5 的手造入口。

**F2：2 处**

- F2-01 | `tests/scenarios/support/shell-work-root.ts:43`，H 组全部标题 | 先读取 `resolveConfiguration`，再 spread 并覆盖 `shellWorkspaceAccess`，是明确的读结果覆写 | 处置 (i)：helper missing：通过真实 `WorkbenchRuntimeConfiguration.grant.shellWorkspaceAccess` 配置 shell root；采用 `K3-44-recovery-answers.test.ts:110`、`:129` 的真实 Host bindings 组装方式。
- F2-02 | `tests/scenarios/support/review-work-root.ts:49`，B2-09b、K3-16、K3-29 variants 三条 | 覆盖已解析配置的 `readonlyCommandAccess` 和 `processSandboxOptions`；`:51` 又直接返回本地组装的 access facts | 处置 (i)：helper missing：以真实 Host 配置声明 read-only grant，由生产 bindings 解析；入口方式同 `K3-44-recovery-answers.test.ts:110`、`:129`。

`tests/helpers/K3-proposal-round.ts:431` 也有 spread，但本次不另报 F2：其 fallback 字段已经由 `tests/helpers/K3-35-runtime.ts:94` 固定提供，当前调用链没有改变字段值；不能只凭语法命中下结论。

**F3：15 处**

以下 S5 问题均由 W 组的 `openK3ReviewCardWorld` 触发，调用链入口为 `tests/helpers/K3-review-card-fixture.ts:131`。

- F3-01 | `tests/helpers/S5-decision-fixture.ts:543`，W 组全部标题 | 将手造 Project/Workspace 编码后送 `seedCommit`，最终在 `:530` 直接提交 store | 处置 (i)：使用 `seedAG2bWorkGraphThrough` 的公开 `projects/create`、`workspaces/register` 步骤，`tests/helpers/AG2b-collaboration-fixture.ts:342`、`:350`、`:352`；helper missing：将这些步骤参数化为 W 组身份。
- F3-02 | `tests/helpers/S5-decision-fixture.ts:568`，W 组全部标题 | 手造 policy、baseline、active-pointer 四类治理快照后直接提交 | 处置 (i)：使用公开 install/activate/adopt-initial 步骤，`tests/helpers/AG2b-collaboration-fixture.ts:354`、`:358`、`:361`；helper missing：W 组参数化封装。
- F3-03 | `tests/helpers/S5-decision-fixture.ts:574`，W 组全部标题 | 直接写入三个 revision 6 的 Goal checkpoint，跳过形成这些事实的公开步骤 | 处置 (i)：使用 `seedAG2bWorkGraphThrough` 的 `goals/create`、plan propose/apply，`tests/helpers/AG2b-collaboration-fixture.ts:366`、`:369`、`:372`；helper missing：公开配置三个 Goal 的封装。
- F3-04 | `tests/helpers/S5-decision-fixture.ts:630`，W 组全部标题 | 自己打开 Kernel store 并 `store.create` Session | 处置 (i)：helper missing：通过真实 Runtime Session 创建接口完成 admission、Kernel 创建及登记，只接收 Session 名称/角色等公开输入。
- F3-05 | `tests/helpers/S5-decision-fixture.ts:632`，W 组全部标题 | 测试替 Runtime 调 `recordSessionCreated`，传入自定 Kernel Session 身份和观察时间 | 处置 (i)：使用上一行要求的真实 Runtime Session 创建 helper，由 Runtime 自己登记。
- F3-06 | `tests/helpers/S5-decision-fixture.ts:715`，W 组全部标题 | 测试直接将手造 execution manifest 写入 body store；A4 只允许共享真实 backend，不允许手造运行材料 | 处置 (i)：使用 `openRealRunHarness.prepareAndStart` 的真实 `prepareExecution` 分支，`tests/helpers/K3-35-continuation-fixture.ts:555`。
- F3-07 | `tests/helpers/S5-decision-fixture.ts:739`，W 组全部标题 | 测试替 Runtime 调 `beginRuntimeEntry`，Kernel run/turn 身份来自 `:733` 的字面量 | 处置 (i)：由 `openRealRunHarness` 的 `startRun` 完成，`tests/helpers/K3-35-continuation-fixture.ts:576`。
- F3-08 | `tests/helpers/S5-decision-fixture.ts:742`，W 组全部标题 | 测试替 Runtime 写 entered fact，并手填 position 3、startPosition 2 | 处置 (i)：由同一真实 `startRun` 路径记录实际 Kernel 位置，`tests/helpers/K3-35-continuation-fixture.ts:576`。
- F3-09 | `tests/helpers/S5-decision-fixture.ts:816`，W 组全部标题 | U1/U2 candidate、request-head claim 和事件由测试直接提交；`:811`、`:812` 是其手造来源 | 处置 (i)：helper missing：真实 Query/模型调用 proposal 工具，或公开 plan proposal 请求，产生与 Query 对应的候选及 request-head。
- F3-10 | `tests/helpers/S5-decision-fixture.ts:869`，W 组全部标题 | 测试手工写 Session message/response body；三次调用在 `:875`、`:885`、`:897` | 处置 (i)：helper missing：用真实消息工具发送请求，再经公开决定答复入口产生 body。
- F3-11 | `tests/helpers/S5-decision-fixture.ts:881`，W 组全部标题 | 直接提交第一条 decision message 及 sent event | 处置 (i)：使用上一行要求的真实消息发送 helper。
- F3-12 | `tests/helpers/S5-decision-fixture.ts:892`，W 组全部标题 | 直接提交第二条 decision message 及 sent event | 处置 (i)：使用真实消息发送 helper，创建第二条实际消息。
- F3-13 | `tests/helpers/S5-decision-fixture.ts:906`，W 组全部标题 | 将已提交消息 spread 成 responded 状态，手造 response/application 字段后再次提交；覆写发生在 `:904` | 处置 (i)：通过公开 `decisions/answer` 答复实际卡；现有路由 helper 为 `tests/scenarios/support/review-card-round.ts:122`，需要对应消息卡的共享封装。
- F3-14 | `K3-29-startup-reconcile-2b.test.ts:152`，标题“lists the real records…”、“a first-page read failure…”、“an inactive Goal…” | `pauseGoalB` 直接调用 Host 内部写入函数 `setGoalControlFromHost`，并从 store 读 GoalPhase pin（`:149`） | 处置 (i)：使用公开 `goals/control` 路径；已有范式 `controlGoal`、`goalControlPins` 位于 `tests/helpers/A2-restart-fixture.ts:170`、`:159`，helper missing：支持 W 组 Goal 的参数化版本。
- F3-15 | `tests/helpers/B2-crr-world.ts:239`，`K3-44-crr-kind4.test.ts:32` 的 CRR kind 4 | `workRunCtx` 在 `:228` 将已结束原 Run 包成 `work_run` principal，再替 Runtime 工具直接写 `requestRerun`；没有实际运行中的模型工具调用 | 处置 (i)：helper missing：在真实接续 Work Run 中用 scripted model 调 `request_command_rerun`；可复用 B2-09b 已有的公开调用序列 `B2-09b-allowance-crash.test.ts:120`、`:122`、`:148`。

**F4：27 处**

- F4-01 | `B2-09b-allowance-crash.test.ts:64`，B2-09b crash 标题 | `ProcessSandbox.probe` 直接返回 available、bwrapPath 和版本，未委托真实探测 | 处置 (i)：helper missing：真实 ProcessSandbox 探测和执行，配合真实 shell handler 的 gate。
- F4-02 | `K3-16-approval-round.test.ts:56`，K3-16 approve 标题 | 同样手造 sandbox 可用事实 | 处置 (i)：使用上一行要求的真实 sandbox helper。
- F4-03 | `K3-29-startup-variants.test.ts:57`，variant (a)/(b)/(c) | 同样手造 sandbox 可用事实 | 处置 (i)：使用真实 sandbox helper。
- F4-04 | `tests/scenarios/support/process-sandbox-standin.ts:38`，K3-44 recovery（一）/（三） | probe 返回手造 sandbox 状态；执行分支在 `:59` 直接 spawn，`:64` 自行组装 sandbox 返回值，没有委托实际 ProcessSandbox | 处置 (i)：helper missing：真实 ProcessSandbox 包装；保留真实命令、工作树及真实检查，故障只在实际依赖外层注入。
- F4-05 | `tests/helpers/K3-tool-seams.ts:93`，W、H 组全部标题 | armed shell 的 handler 在 gate 释放后返回手造 success/output/effects；`:85` 还去掉了真实 capability 要求。gate 本身可以是 A2/A3，但这个成功返回不是 | 处置 (i)：helper missing：包装真实 `createShellToolDefinition`，在 handler 入口 gate，释放后返回真实 handler 结果，不替换能力要求和结果。
- F4-06 | `tests/scenarios/harness.ts:766`，H 组全部标题经 shell/review root | `inputCounter.count` 无论请求内容如何都报告 256 tokens、`model_tokenizer` | 处置 (i)：helper missing：使用真实 Host bindings 的计数器或生产支持的实际计数路径；Host 配置组装入口可用 `K3-44-recovery-answers.test.ts:129`。
- F4-07 | `tests/helpers/K3-review-card-fixture.ts:139`，W 组中默认 `realKernelCommandFacts` 的用例 | Kernel command reader 从测试维护的 Map 返回事实，未读实际 Kernel 历史 | 处置 (i)：使用该 helper 已有的真实 reader 分支 `tests/helpers/K3-review-card-fixture.ts:150`、`:158`。
- F4-08 | `tests/helpers/K3-review-card-fixture.ts:164`，W 组全部标题 | workspace reader 不访问工作区，固定返回“没有 package.json” | 处置 (i)：helper missing：真实 Workspace reader 读取测试目录；需要缺文件时就在真实目录中不创建该文件。
- F4-09 | `tests/helpers/K3-review-card-fixture.ts:200`，W 组，实际 CRR 请求见 `K3-44-crr-kind4.test.ts:37` | 测试自己实现 exact-sha recognizer，返回手造 match/action；生产识别链没有执行 | 处置 (i)：使用真实 Runtime 的 `request_command_rerun` 路径，调用序列见 `B2-09b-allowance-crash.test.ts:120`、`:148`；helper missing：W 组共享版本。
- F4-10 | `tests/helpers/K3-review-card-fixture.ts:246`，W 组答案相关标题 | mailbox duties 端口直接返回 fixture duties、空 guards 和固定标志 | 处置 (i)：helper missing：从真实组合根取得 mailbox 及其 duties reader，用公开角色/配置步骤建立授权。
- F4-11 | `tests/helpers/executed-files-stub.ts:24`，W 组，另由 `K3-20-review-card-paging.test.ts:262` 显式调用 | 固定返回 `not_available/files:[]/possiblyIncomplete:true`；“冻结数据”的注释不在 A1–A7 中 | 处置 (i)：helper missing：使用生产 `createGoalExecutedFilesReader` 读取真实 Goal 的执行文件；需要故障时包装真实 reader。
- F4-12 | `K3-20-review-card-paging.test.ts:273`，分页标题 | 五类空 card source 均手造 `available/items:[]`，调用在 `:256`–`:258`，使 `countsComplete` 成为注入的答案 | 处置 (i)：helper missing：通过真实平台组合根取得完整 decision read model，使用所有生产 card sources。
- F4-13 | `K3-20-review-card-paging.test.ts:283`，分页标题 | 六类 notice source 同样固定返回 available/空集合，调用在 `:259` | 处置 (i)：使用上一行要求的完整生产 decision read model。
- F4-14 | `K3-29-startup-answers.test.ts:85`，current-card answer、failed ③ 两条 | `nothing` 为四类 startup candidate 查询返回手造空集合，接线在 `:99` | 处置 (i)：helper missing：从真实组合根取得 startup candidate readers。
- F4-15 | `K3-29-startup-answers.test.ts:90`，同上 | Session 查询手造空集合及 sourceCursor | 处置 (i)：使用真实平台 Session directory 查询端口。
- F4-16 | `K3-29-startup-answers.test.ts:101`，同上 | 只选一个 Goal，再组装成 candidate listing，代替真实 workspace Goal 枚举 | 处置 (i)：使用真实组合根的 Goal candidate reader；通过公开步骤控制其他 Goal 的存在和状态。
- F4-17 | `K3-29-startup-reconcile-2b.test.ts:172`，四条服务用例 | 四类 candidate 查询固定为空，接线在 `:187` | 处置 (i)：helper missing：真实 startup readers 的共享组装。
- F4-18 | `K3-29-startup-reconcile-2b.test.ts:177`，四条服务用例 | Session 查询固定为空并手造 `'c-1'` cursor | 处置 (i)：使用真实 Session directory 查询端口。
- F4-19 | `K3-29-startup-reconcile-2b.test.ts:188`，四条服务用例 | 将测试传入的 GoalSnapshot 数组直接包装成候选读结果 | 处置 (i)：使用真实 Goal candidate reader；暂停由公开 `goals/control` 完成。
- F4-20 | `K3-29-startup-reconcile-2b.test.ts:215`，标题“lists the real records…” | display reader 固定返回空 Map；只读 commit 故障包装不能使这个独立 stub 合法 | 处置 (i)：从真实组合根取得 review service，只在其真实 records.commit 外层安装失败包装。
- F4-21 | `K3-29-startup-reconcile-2b.test.ts:243`，标题“a first-page read failure…” | 第二个独立 display reader 固定返回空 Map | 处置 (i)：使用同一真实 review service，只包装真实 lookup 的首次失败。
- F4-22 | `K3-44-crr-kind4.test.ts:52`，CRR kind 4 标题 | 四类 candidate 查询固定为空，接线在 `:61` | 处置 (i)：helper missing：使用真实平台 startup candidate readers。
- F4-23 | `K3-44-crr-kind4.test.ts:54`，同上 | Session 查询固定为空 | 处置 (i)：使用真实 Session directory reader。
- F4-24 | `K3-44-crr-kind4.test.ts:56`，同上 | execution reader 固定返回 not_found | 处置 (i)：使用真实平台 `executions.readExecution`。
- F4-25 | `K3-44-crr-kind4.test.ts:57`，同上 | control reader 固定返回 not_found | 处置 (i)：使用真实平台 control reader。
- F4-26 | `K3-44-crr-kind4.test.ts:62`，同上 | 将单个真实 Goal 重新包装为完整候选列表，绕过真实枚举 | 处置 (i)：使用真实平台 Goal candidate reader。
- F4-27 | `K3-44-crr-kind4.test.ts:65`，同上 | probe 固定返回 missing/activeRunId:null | 处置 (i)：使用真实 Kernel Session mapping probe；共享 harness 的真实 probe 调用在 `tests/helpers/K3-35-continuation-fixture.ts:691`。

**F5：未发现。** 实际 receipt 重放、公开再次读取、重启后的正常 selection，不按“无原因重复通知”误报。

**F6：2 处**

- F6-01 | `tests/helpers/K3-review-card-fixture.ts:389`，分页、startup-answers 两条标题 | `createRecord` 不制造真实 review capability 故障，直接传 `cause:'review_unavailable'`；真正 owner 写发生在 `tests/helpers/K3-proposal-round.ts:594` | 处置 (i)：helper missing：共享 `K3-44-recovery-answers.test.ts:110`、`:143` 的路径——缩窄真实 Host grant，由 Workflow 自己判断并执行 settle。
- F6-02 | `tests/helpers/B2-crr-world.ts:193`，CRR kind 4 标题 | `settleUnavailable` 直接向 owner 写同一个虚构失败原因 | 处置 (i)：使用同一真实 Host 授权不足→Workflow settle 的共享 helper。

**F7：8 处**

- F7-01 | `tests/scenarios/harness.ts:684`、`:688`，H 组全部标题 | `advance` 默认在 `:655`、`restart` 默认在 `:1063` 调 invariant 检查；检查从数据库重建整个 world，再断言 findings 为空；数据库读取在 `tests/state/invariants.ts:344`、`:352` | 处置 (i)：helper missing：用公开 Task、Run、Session、review、message 读取验证本用例涉及的不变量，替换隐藏的全库断言。
- F7-02 | `tests/scenarios/support/restart.ts:159`，variants (a)/(b)、recovery（一）/（三） | `expectQuietHarnessRestart` 比较 `counts()`；计数直接查询 ledger/Kernel 表，见 `tests/scenarios/harness.ts:358`、`:365`、`:371`、`:374` | 处置 (i)：helper missing：重启前后读取相关公开记录及 revision，并比较重启报告；保留“无新增行为”的原义。
- F7-03 | `K3-29-startup-variants.test.ts:119`，variant (a) | 从 ledger SQL 读事件类型后断言没有 TaskRequeued；底层为 `tests/scenarios/harness.ts:340` | 处置 (iii)：删除这条数据库断言；公开 Task 执行指针不变已由同文件 `:118` 检查，review 不变由 `:117` 检查。
- F7-04 | `K3-29-startup-variants.test.ts:165`，variant (b) | 同类数据库事件断言 | 处置 (iii)：删除；公开 Task/review 不变已有同文件 `:164`、`:163`。
- F7-05 | `K3-44-recovery-answers.test.ts:237`，recovery（一） | 直接读 ledger 断言初始无重排 | 处置 (i)：helper missing：从公开 Task/执行历史读取重排前后的运行链，记录初始原 Run，再与恢复后公开结果比较。
- F7-06 | `K3-44-recovery-answers.test.ts:254`，recovery（一） | 直接读 ledger 断言恢复后无重排 | 处置 (iii)：删除；该阶段的公开 Task 指针及完整 held review 已由同文件 `:255`、`:253` 验证。
- F7-07 | `K3-44-recovery-answers.test.ts:287`，recovery（三） | 用 ledger 中恰好一条 TaskRequeued 证明一次接续 | 处置 (i)：helper missing：通过公开执行历史/Task 读取核对只有原 Run 和第一次接续；当前公开 receipt 入口已有同文件 `:281`、`:283`。
- F7-08 | `K3-44-recovery-answers.test.ts:315`，recovery（三） | 再次通过 ledger 事件数证明没有第二次接续 | 处置 (i)：使用上一行要求的公开运行链 helper，并与恢复前快照比较；保留 `:316`、`:327`–`:331` 的公开断言。

**F8：10 处**

- F8-01 | `B2-09b-allowance-crash.test.ts:112`，B2-09b crash 标题 | blocked command 的预期 hash 调生产 `commandSha256(command)` | 处置 (i)：保留 `needsDecisionCard` 公开路径，`tests/scenarios/support/review-card-round.ts:81`；期望改为独立 SHA-256 对已知规范化字符串 `b2-09b runs a program` 的固定例子。
- F8-02 | `B2-09b-allowance-crash.test.ts:146`，同上 | manifest binding 的预期 hash 再次来自同一生产函数 | 处置 (i)：保留 `preparedManifestOf` 的公开材料读取，使用上一条独立固定 hash。
- F8-03 | `B2-09b-allowance-crash.test.ts:218`，同上 | used CRR 的预期 hash 仍调用生产函数 | 处置 (i)：保留 `listCommandRerunRequests`，`tests/helpers/B2-09b-crash.ts:37`，使用同一独立固定 hash。
- F8-04 | `K3-16-approval-round.test.ts:163`，K3-16 approve 标题 | summary 的期望由生产 `approvedMethodLinesZh` 和实际 proposals 生成，生产 summary 也用该函数，见 `src/core/work-graph/tasks/unknown-call-review-card.ts:143` | 处置 (iii)：删除这条自证断言；该单方案的固定格式已由同文件 `:164` 覆盖。
- F8-05 | `K3-20-review-card-paging.test.ts:120`，分页标题 | expectedKeysBefore 调生产 `decisionSourceKey`，随后 `:122`、`:124` 以它为 oracle | 处置 (ii)：把来源键编码断言移至 `tests/state/unknown-call-review-source-key-pure.test.ts`，直接测 `decisionSourceKey`，使用手算 canonical identity 字面量。
- F8-06 | `K3-20-review-card-paging.test.ts:241`，分页标题 | `cardSourceKey` 再调同一生产函数，`:176`、`:185`、`:212` 将其输出作为预期 | 处置 (ii)：同样移至上述 pure 文件测 `decisionSourceKey`；分页场景只用公开返回身份核对集合归属和无重复。
- F8-07 | `tests/state/command-normalization.test.ts:47`，`B2-10 normalisation is digest-insensitive to whitespace only` | 用被测 `commandSha256` 的另一份输出当预期 | 处置 (ii)：移至 `tests/state/command-normalization-pure.test.ts` 的 `commandSha256` 固定例子，期望独立计算 `SHA256_UTF8("tool a")`。
- F8-08 | `tests/state/command-normalization.test.ts:48`，同上 | 用两个被测输出的不等关系代替两个独立预期 | 处置 (ii)：同一 pure 文件分别核对 `"tool a"`、`"tool b"` 的独立 hash。
- F8-09 | `tests/state/command-rerun-request.test.ts:144`，`CRR-01 rejects a ninth declared form with capacity and writes nothing` | 输入数量是生产 `MAX_FORMS + 1`；生产上限误改为 80 时测试会改为 81，不再保护“第九个” | 处置 (ii)：移至 `tests/state/command-rerun-request-pure.test.ts`，测 `newCommandRerunRequest`，固定构造 9 个 form。
- F8-10 | `tests/state/command-rerun-request.test.ts:287`、`:290`，`CRR-07 rejects the ninth form with capacity and writes nothing` | 前置数量和长度期望均取生产常量；同样不能固定 8→9 边界 | 处置 (ii)：移至上述 pure 文件，测 `transitionCommandRerunRequest`，固定 8 个已有 form，再加第 9 个。

**F9：2 处**

- F9-01 | `tests/helpers/K3-proposal-round.ts:356`，`K3-29-startup-reconcile-2b.test.ts:260` 的 kind 1/2 标题 | `waitForEntered` 最多 500 次、每次 sleep 10ms；调用在 helper `:444` | 处置 (i)：helper missing：在真实模型 `beforeReply` 的首次进入处发 reached 信号，再由 gate 保持 Run；现有真实模型 gate 在同 helper `:413`–`:417`，不再轮询。
- F9-02 | `tests/scenarios/harness.ts:706`，variant (b)、recovery（一）/（三） | `waitFor` 每 50ms 轮询，直接调用点为 `K3-29-startup-variants.test.ts:157`、`K3-44-recovery-answers.test.ts:245`、`:306`；`waitForFlowToStop` 在 `:211` 也调用它 | 处置 (i)：helper missing：在真实 application commit 和真实 driver completion 处安装 A3 reached/gate 包装，返回真实结果后进行公开读取。

**F10：未发现。**

`K3-29-startup-reconcile-2b.test.ts:255` 的 `pages === 1` 是核对“首次真实 lookup 故障后不继续读取”，不是拿内层次数冒充公开资源上限，因此不报 F10。

**F11：4 处**

- F11-01 | `K3-20-review-card-paging.test.ts:137`、`:165`，分页标题中的“appears on the retry” | wrapper 只按 index 触发，没有限定目标 Goal（`:144`）；生产按各 Goal 读 source，`src/core/work-graph/views/decision-read-model.ts:953`、`:956`。测试又把多次独立 queue 调用拼起来，只保留末次 counts，`K3-20-review-card-paging.test.ts:61`、`:65`。删掉整窗移动检查 `src/core/work-graph/views/decision-read-model.ts:1102`，新记录仍可在后续 Goal 读取或后续公开分页调用中出现；现有结果并不能证明该次调用执行过重试 | 处置 (i)：helper missing：限定 Goal B 的真实读取 gate，在同一次公开 `queryDecisionQueue` 中途创建第五条记录，并断言该次返回的 `counts.waitingAnswer` 和公开 sourceCursor 已覆盖提交后的窗口。
- F11-02 | `K3-29-startup-reconcile-2b.test.ts:267`，kind 1/2 标题 | kind 2 示例仍是无 hold 的 `pending_review`；删掉 `src/app/startup-reconcile.ts:240` 后仍由 `:241`、`:242` 的 kind 1 条件选中 | 处置 (i)：helper missing：真实 claim review round 后通过公开 hold，保留 activeRound，再结束 Run；`src/core/work-graph/state/unknown-call-review.ts:593`、`:594` 明确保留 activeRound。这样状态为 held/resolved，仅 kind 2 能选中。
- F11-03 | `K3-44-crr-kind4.test.ts:95`，标题“the advance applies ③” | 实际直接调 `decisionActions.advanceReviewDisposition`，没有调 Workflow；删除 CRR 的 handed-over 分派 `src/business/workflow/workflow.ts:2726`、`:2728` 仍不影响此测试 | 处置 (i)：helper missing：把 startup report 中真实 `answers` 交给公开 Workflow advance，验证 CRR 的 ③ 由 `applyHandedOverAnswers` 执行；生产入口在 `src/business/workflow/workflow.ts:2684`、`:2755`。
- F11-04 | `K3-44-crr-kind4.test.ts:102`，同上 | `expect(AG2B_AT).toBeTruthy()` 只验证 fixture 常量，与任何生产检查无关 | 处置 (iii)：删除；应用结果已由同文件 `:100`、`:101` 断言，这条常量检查不增加规格证据。

**F12：本组台账未确认削弱，0 处。** 逐条判断见 LEDGER；当前仍不合规的实现形状，不反过来把有任务书依据的迁移自动算成 F12。

**规则表明确禁止、但 F1–F12 没有专属编号：2 处**

- A5 文件隔离 | `K3-29-startup-reconcile-2b.test.ts:196`，`K3-29: emptyStartupReport reports no reviews` | 纯函数行混在导入平台、store、Runtime 和 stub 的场景文件中，不满足规则表 `:41`–`:44` | 处置 (iii)：删除；真实空 review/空 redrive 的公开重启结果已经由 `K3-29-startup-variants.test.ts:114`–`:116` 覆盖。
- 每行双后端要求 | `K3-44-crr-kind4.test.ts:33`，CRR kind 4 标题 | 只开 SQLite，整个用例没有真实 Host 关闭再启动；不满足规则表 `:94`、`:95` 的例外条件。未见台账证明它曾有 memory 后端，故不冒称历史 F12 | 处置 (i)：helper missing：共享真实平台的 memory/SQLite 两后端 startup→Workflow CRR recovery 路径。

**T：单列，不迁入本组免责范围**

- T / F3 | `tests/helpers/B2-execution-fixture.ts:297`、`:301` | `enter` 手填 entered history/position，属于规则表已点名的 F3；该文件由 rulings `:10` 放入 T | 处置 (iv)：T，交对应轮次处理；G4 实际执行的 S5 手写入口仍按上面的 F1/F3 修复，不能借 T 豁免。
- `tests/helpers/B2-runtime-fixture.ts:54` 的 `createScriptedModel` 本身是 A1；不能因为文件在 T，就把这个合法 scripted model 也列成缺陷。

**3. ROWS**

下列“是”表示删掉所列的直接生产分支/检查会破坏相应断言；不表示整条场景已经满足夹具规则。“否”或“部分”单独说明。纯函数行不适用后端要求。

**场景行**

- `B2-09b-allowance-crash.test.ts:111` | B2-01/B2-09：blockedCommands 长度 1、alias 1、原 reviewRunId；来源为规格 `:458`–`:462` 及单一 shell 调用；hash 目前来自 src，F8 | SQLite，真实 Host crash/restart 例外 | blocked-list 写入被删会失败：`src/core/work-graph/tasks/unknown-call-review-service.ts:1335`、`:1343`。
- `B2-09b-allowance-crash.test.ts:145` | B2 binding：manifest 只有 `{reviewRunId,alias,commandSha256}` 一项；来源为原 Run 的一个命令及规格 L19a；hash oracle 不独立 | SQLite | binding 丢失会使该精确数组断言失败；本行不独立证明 hash 算法。
- `B2-09b-allowance-crash.test.ts:155` | B2 拦截：模型收到“平台拦下了这条命令”和 `request_command_rerun`；来源为规格 `:453`、`:454` | SQLite | 证明有公开拦截反馈；不覆盖所有拒绝文案或全部识别形式。
- `B2-09b-allowance-crash.test.ts:165` | CRR-02：allowed、revision 2、usedAt/usedBy 为 null；1 次创建加 1 次 allow，规格 `:1281` | SQLite | 是，状态机 answer 写入 `src/core/work-graph/state/command-rerun-request.ts:181`、`:184`。
- `B2-09b-allowance-crash.test.ts:171` | B2-09：只有获准后的 callId 到达 shell handler；输入手算为第三个 scripted tool call | SQLite | 受 F4 shell stand-in 限制，证明的是替身入口，不是真实命令已开始。
- `B2-09b-allowance-crash.test.ts:180` | RUN-20/RUN-25 G9：ended/outcome_unknown，quarantined，`second_auto_cleanup`，一个未决 callId；规格 `:130` 及 RUN-25 一次自动清理边界 | SQLite | 是，G9 为 `src/core/work-graph/state/run-machine.ts:2439`；删掉它会改走自动清理，而非期望 quarantine。
- `B2-09b-allowance-crash.test.ts:195` | RUN-22：人工认定 committed；`:207`–`:211` 为 pending_review、human_attested、一个 process shell item；来源为规格人工认定路径及单调用输入 | SQLite | 认定/创建链被删会失败；真实入口是 `tests/helpers/K3-35-continuation-fixture.ts:750` 所调用的同一公开 `resolveUnknownRun`。
- `B2-09b-allowance-crash.test.ts:217` | B2-09/CRR-03：used、revision 3、精确 runId/callId，第二读仍 `[['used',3]]`；创建→允许→消费共三版，规格 `:1282`、`:1491` | SQLite | 是，消费写入 `src/core/work-graph/state/command-rerun-request.ts:196`；对 hash 的检查另有 F8。
- `K3-16-approval-round.test.ts:146` | K3-16/UCR proposal settlement：awaiting_approval，真实脚本生成方案；规格 `:553`、`:1260` | SQLite，前置有真实 Host crash/restart | 缺少方案定稿到 awaiting_approval 的行为会失败；不能据此覆盖 proposal_missing 分支。
- `K3-16-approval-round.test.ts:156` | K3-16：选项恰为 approve/同意/apply、decline/不同意/apply；规格 `:432` | SQLite | 是，`src/core/work-graph/tasks/unknown-call-review-card.ts:103`–`:107`。
- `K3-16-approval-round.test.ts:162` | K3-16：原命令行、方案行，且单 process 卡没有混合平台句；规格 `:433`、`:553`、`:571`；`:163` 自证，`:164` 为独立单方案文字 | SQLite | 原命令/方案投影被删会失败：`src/core/work-graph/tasks/unknown-call-review-card.ts:137`、`:143`；没有检查整段 summary 的精确相等。
- `K3-16-approval-round.test.ts:178` | UCR-12/B2 blocked commands：resolved/open no/activeRound null；固定原命令 hash `79dba946…d6c6cc4`、action hash `f0e89c8e…cb19687`；推导材料分别为 UTF-8 `"k3-16-approval-e2e runs a program"` 和 words 数组 JSON，规则来自规格 `:467`、`:488` | SQLite | 是，原命令收集 `src/core/work-graph/tasks/unknown-call-review-service.ts:1335`，approvedMethods 构造 `:1348`–`:1354`，状态写入 `src/core/work-graph/state/unknown-call-review.ts:569`、`:570`。
- `K3-16-approval-round.test.ts:192` | UCR-12：保留 safer_method 的 NOTE/annotation，approvedMethods 为提交的 NEW_COMMAND、cwd `"."`；规格 `:445`、`:555` | SQLite | 是，approval 保留原 disposition、写 approvedMethods 的分支 `src/core/work-graph/state/unknown-call-review.ts:569`。
- `K3-16-approval-round.test.ts:202` | approval answer 与 disposition answer 是不同真实消息，公开 messages/read 可读；来源为两次实际答卡 | SQLite | 只保护消息身份分离；`:210` 没有核对 APPROVE_TEXT 正文，不能算正文保存验收。
- `K3-16-approval-round.test.ts:225` | L20：固定处置句、`- 作用对象：#1。`、方案行、targets 在方案之前、无平台条目、brief 中一个批准方法；规格 `:563`–`:571` | SQLite | 对缺失/错序会失败；这里没有测 5,120/16,384 字节边界，不应声称完成 K3-16 全行所有子项。
- `K3-20-review-card-paging.test.ts:98` | K3-20：四条源记录分页 2+2，cursor `"2"`、null；手算 `4÷2`，规格 `:1434` | memory/SQLite | 是，分页截取和 cursor 分支 `src/core/work-graph/views/decision-read-model.ts:294`–`:297`。
- `K3-20-review-card-paging.test.ts:118` | K3-20：queue count 8、countsComplete true；8 是四条 review 加 S5 四张预置卡，测试在 `:115`–`:117` 写明推导；不是规格单独五条 review 的 count 5 | memory/SQLite | 计数装配被删会失败，`src/core/work-graph/views/decision-read-model.ts:1128`；完整性证据被 F4 available stubs 污染，`:1129`。
- `K3-20-review-card-paging.test.ts:181` | K3-20 中途提交：最终收集五张唯一 review，末次总数 9、complete true；手算 5+4 | memory/SQLite | **否，不能保护“同一次调用整窗重试”**，检查为 `src/core/work-graph/views/decision-read-model.ts:1102`，原因见 F11-01。
- `K3-20-review-card-paging.test.ts:198` | K3-20：五条源记录分页 2+2+1，cursor `"2"`、`"4"`、null，输入 limit 200 仍受 pageLimit 2 限制；规格 `:1434` | memory/SQLite | 是，`src/core/work-graph/views/decision-read-model.ts:294`–`:297`。
- `K3-20-review-card-paging.test.ts:220` | K3-20/L18：第五张卡按 key 读取，waiting_answer、可答、3 个 pins，顺序 UCR/Run/Goal，四个固定选项，仅 aggregate 对象；规格 `:426`–`:432` | memory/SQLite | 是，直接读取入口 `src/core/work-graph/views/decision-read-model.ts:476`；pins/objects `src/core/work-graph/tasks/unknown-call-review-card.ts:161`、`:169`；四选项 `:110`–`:117`。
- `K3-29-startup-answers.test.ts:122` | K3-29 kind 3：needs_decision revision 2；由 pending 创建版 1 再 settle 得版 2；未答时 reviews 1、redrive 空，答后 taskIds `['k3-20-a']`；规格 `:728` | memory/SQLite | 是，当前卡答复选择 `src/app/startup-reconcile.ts:501`、`:505`、`:517`；前置 settle 仍为 F6。
- `K3-29-startup-answers.test.ts:135` | K3-29 kind 3 与 kind 4 区分：只有①时 unapplied answers 为 `[]` | memory/SQLite | 保护答案索引只收相应阶段；不是完整 UR7b 执行测试。
- `K3-29-startup-answers.test.ts:177` | K3-29 kind 4：直接 hold 后 resolved/open no/answerMessageRef null；索引仍按旧 answerRef/reviewRef 返回；report reviews `[]`、taskIds `[]`、answers 恰一项；规格 `:729`、`:736`、`:750` | memory/SQLite | 是，独立于 open/taskIds 的交接在 `src/app/startup-reconcile.ts:524`–`:530`、`:562`–`:564`。
- `K3-29-startup-answers.test.ts:190` | L28：每 active Goal 一次 unapplied-answer 查询，预期参数 `[{goalRef:GOAL_B}]`；规格 kind 4 每 Goal 查询约束 | memory/SQLite | 是，`src/app/startup-reconcile.ts:526`；wrapper 返回真实结果，A3，不是 F10。
- `K3-29-startup-reconcile-2b.test.ts:197` | K3-29 空报告 reviews `[]`；规格报告结构 | 纯函数 | 是，`src/app/startup-reconcile.ts:261`；但文件隔离不符合 A5。
- `K3-29-startup-reconcile-2b.test.ts:223` | L28 step 2b：两条 `UCR/left`，原因精确为 `needs_decision inventory_incomplete` 和 `pending_review`，问题空、暂停 Goal 不读 Plan；规格 `:723`、`:724` | memory/SQLite | 列表过滤/报告生成丢失会失败，公开扫描在 `src/app/startup-reconcile.ts:586`；暂停判断在 `:491`。
- `K3-29-startup-reconcile-2b.test.ts:252` | L28 首页失败：reviews `[]`，恰一条 `W: the open reviews are not readable (unavailable: the review list could not be read: k3-29 first page read fails)`，一次失败 lookup | memory/SQLite | 是，失败结果转 problem 后返回在 `src/app/startup-reconcile.ts:592`–`:594`。
- `K3-29-startup-reconcile-2b.test.ts:268` | TASK-03r/UCR-03：真实 round 为 review、round 1；规格 `:1254`；随后 Runtime fault 结束 Run | memory/SQLite | activeRound 创建缺失会失败；这里保留并加强了旧 round 前置断言。
- `K3-29-startup-reconcile-2b.test.ts:276` | K3-29 kind 1/2：taskIds 恰 `['k3-20-a','k3-20-b']`，held 无 round 不交接；规格 `:726`、`:727`、`:731` | memory/SQLite | kind 1 是；**kind 2 否**，删掉 `src/app/startup-reconcile.ts:240` 仍被 `:242` 命中。
- `K3-29-startup-reconcile-2b.test.ts:286` | K3-29 inactive Goal：paused、仍列一条 review、redrive `[]`；规格 `:723`、`:737` | memory/SQLite | 是，`src/app/startup-reconcile.ts:491`。
- `K3-29-startup-variants.test.ts:108` | K3-29 variant (a)：resolved/open no/held、rounds 1；重启 reviews/redrive 空，review 与 Task 原执行不变；规格 `:731`、`:750`、`:1460` | SQLite Host 重启例外 | 是，公开 no-change 部分保护不释放 hold；数据库事件/quiet 断言另为 F7。
- `K3-29-startup-variants.test.ts:137` | K3-29 variant (b)：①② committed、③ rejected；重启 answers 一项、taskIds 空，随后 application schemaVersion 1，held review 不变；规格 `:729`、`:750`、`:1319` | SQLite Host 重启例外 | 是，交接 `src/app/startup-reconcile.ts:526`，Workflow 应用 `src/business/workflow/workflow.ts:2755`；等待方式 F9。
- `K3-29-startup-variants.test.ts:184` | K3-29 variant (c)/UCR-09：awaiting_proposal、stateEntry+1、proposals 空、rounds 1；重启列 `UCR/left/awaiting_proposal`，交接原 taskId，记录不变；规格 `:448`、`:726` | SQLite Host 重启例外 | 是，kind 1 检查 `src/app/startup-reconcile.ts:242`。
- `K3-29-startup-variants.test.ts:215` | UR proposal/K3-16：工具恰 `read/run_readonly_command/propose_safer_method`；完成后 awaiting_approval、方案 `"echo safer"`、cwd `"."`，approve/decline 两选项及新 revision pin；规格 `:553`、`:432` | SQLite，属于同一重启场景后续 | 缺少真实方案写入/定稿会失败；卡选项分支 `src/core/work-graph/tasks/unknown-call-review-card.ts:103`。
- `K3-44-crr-kind4.test.ts:44` | CRR kind 4：③ 失败后 application_not_recorded，startup report 中有 CRR requestRef/answerMessageRef；规格 L28 kind 4 和 B3 任务书 §8 answer 7 | 仅 SQLite，无重启理由，违规 | CRR 索引交接分支被删会失败：`src/app/startup-reconcile.ts:543`–`:550`。
- `K3-44-crr-kind4.test.ts:100` | UR7b/CRR：预期 applied、application committed | 仅 SQLite，违规 | **否，Workflow CRR 分派可以删除而本行仍通过**；绕过了 `src/business/workflow/workflow.ts:2726`、`:2728`、`:2755`。
- `K3-44-recovery-answers.test.ts:232` | K3-44（一）：②后直接 hold，resolved/open no/held/direct/answerMessageRef null；③仍 null；规格 `:1464`、`:750` | SQLite Host 重启例外 | 是，hold 状态写入 `src/core/work-graph/state/unknown-call-review.ts:587`–`:594`。
- `K3-44-recovery-answers.test.ts:242` | K3-44（一）/UR7b：answers 恰一项、taskIds 空；补记 schemaVersion 1，held review 完整不变，Task 仍原 Run；规格 `:1319`、`:1464` | SQLite Host 重启例外 | 是，Workflow `src/business/workflow/workflow.ts:2755`；②必须先走 receipt replay `src/core/work-graph/tasks/unknown-call-review-service.ts:1231`，否则旧卡对当前 held 状态不能按原方式重新落实。
- `K3-44-recovery-answers.test.ts:281` | K3-44（三）：真实 receipts 含 requeue/claim/start，selected Run 改变，complete_task 后 satisfied；历史 review open no、③仍 null；规格 `:1464` 的历史记录恢复前置 | SQLite Host 重启例外 | 真实公开前置；ledger “恰一次”部分另为 F7。
- `K3-44-recovery-answers.test.ts:303` | K3-44（三）/UR7b：历史 review 仍按自身 ref 交接，taskIds 空，补③，原 review 保持 resolved/open no/hold null，selected Run 不变；规格 `:1319`、`:1464` | SQLite Host 重启例外 | 是，答案独立交接 `src/app/startup-reconcile.ts:526`、Workflow `src/business/workflow/workflow.ts:2755`、② receipt 优先 `src/core/work-graph/tasks/unknown-call-review-service.ts:1231`。
- `K3-44-recovery-answers.test.ts:324` | K3-44（三）恢复后：completed、`the Goal is formally COMPLETED`、next null，无 requeue/claim/start，continuation ended；手算为已 complete_task 且没有新的执行要求 | SQLite | 保护恢复后没有再次执行；不能用这条额外 selection 代替此前启动 driver 已完成的同步证据，等待仍为 F9。
- `K3-29-startup-variants.test.ts:121`、`:167`；`K3-44-recovery-answers.test.ts:260`、`:335` | K3-29/K3-44 最后一次安静重启：redrive `[]`、报告不再改变；规格 `:1460`、L29 | SQLite | 公开报告部分有效；“零写入”目前通过 SQL counts 断言，不是合规公开证据。

**B2-10 纯函数行**

以下各行后端均“不适用，A5”；字面量来自规格 `:464`–`:480`、`:488` 对给定命令逐词/逐段手算。`N` 在本小节仅是路径缩写：`src/core/work-graph/state/command-normalization.ts`。

- `tests/state/command-normalization.test.ts:27` | 空白归一为 `"a b c"`、`"echo hi"`、`""`；规格 `:488` | 是，N`:34`。
- `tests/state/command-normalization.test.ts:34` | `"tool"`、`"tool --flag=1"` 不变；规格 `:488` | 是，N`:34` 的错误归一会破坏例子。
- `tests/state/command-normalization.test.ts:41` | 独立 SHA256_UTF8(`"tool a b"`)、SHA256_UTF8(`""`)；规格 `:488`，独立 oracle 在测试 `:21` | 是，N`:39`。
- `tests/state/command-normalization.test.ts:47` | 两个生产 hash 相等/不等，没有独立字面量 | 不足，F8；不能保护共同出错的算法。
- `tests/state/command-normalization.test.ts:52` | 独立 SHA256_UTF8(`"tool 日本語"`)；规格 `:488` | 是，N`:39`。
- `tests/state/command-normalization.test.ts:67` | parsed，words `['tool','a','b']`，text `"tool a b"`；规格 `:464`、`:467` | 是，N`:409`、`:410`、`:518`。
- `tests/state/command-normalization.test.ts:74` | 单引号、双引号、反斜线分别得到 `"a b"`、`"c d"`、`"e f"` 单一参数 | 是，N`:128`、`:135`、`:163`。
- `tests/state/command-normalization.test.ts:80` | 相邻引用拼接 `"abc"`、转义引号 `a"b`、空参数 `""` | 是，N`:131`、`:140`、`:151`。
- `tests/state/command-normalization.test.ts:86` | 引号内 `"a && b"` 不分段，外部 `c` 是第二 action | 是，N`:118`、`:202`。
- `tests/state/command-normalization.test.ts:92` | quoted words `['tool','a b']`、split words `['tool','a','b']`；独立 JSON-word hash 不同 | 是，参数边界 N`:118`、`:264`；测试的 key helper 没有冒充生产 recognizer 验收。
- `tests/state/command-normalization.test.ts:102` | `&&/||` 均为 `[['a'],['b']]` | 是，N`:207`、`:212`。
- `tests/state/command-normalization.test.ts:107` | `; / | / |& / & / newline` 均保留两段顺序 | 是，N`:202`、`:207`、`:212`。
- `tests/state/command-normalization.test.ts:115` | 全分隔符链得到 a 至 h 八个单词 action | 是，N`:446`、`:451`。
- `tests/state/command-normalization.test.ts:120` | 空段忽略，纯空白为 parsed/actions `[]` | 是，N`:433`、`:505`。
- `tests/state/command-normalization.test.ts:127` | 静态环境赋值剥离后 `[['tool','x']]` | 是，N`:305`。
- `tests/state/command-normalization.test.ts:132` | env、command、exec、time、nohup、nice 前缀剥离后 `[['tool','x']]` | 是，N`:310`、`:316`。
- `tests/state/command-normalization.test.ts:141` | npx 的三个固定 flag、npm/pnpm/yarn exec 前缀剥离后 `[['tool','x']]` | 是，N`:321`、`:327`、`:332`。
- `tests/state/command-normalization.test.ts:151` | 两种 node_modules/.bin 路径剥离后 `[['tool','x']]` | 是，N`:337`。
- `tests/state/command-normalization.test.ts:156` | 复合前缀链最终 `[['tool','x']]` | 是，N`:302` 的持续剥离。
- `tests/state/command-normalization.test.ts:161` | 参数位置 npx 保留为 `['tool','npx','x']` | 是，N`:304` 只处理 head。
- `tests/state/command-normalization.test.ts:165` | npm/pnpm/yarn run build 保持三词，不展开 | 是，N`:327`、`:332` 的限定匹配；这是 B2-10 的不展开边界，不是 B2-11 展开验收。
- `tests/state/command-normalization.test.ts:173` | `> / >> / <` 及目标移除后 `['tool','a']` | 是，N`:223`、`:442`、`:499`。
- `tests/state/command-normalization.test.ts:179` | fd 重定向、`2>&1` 不成为参数 | 是，N`:227`、`:260`。
- `tests/state/command-normalization.test.ts:185` | 紧贴单词的重定向仍移除，保留 tool/a 或 tool | 是，N`:125`、`:223`。
- `tests/state/command-normalization.test.ts:192` | cd/pushd/popd/export/set/unset/true/false/`:` 均无 action | 是，N`:281`、`:357`。
- `tests/state/command-normalization.test.ts:204` | echo/printf 均无 action | 是，N`:283`、`:357`。
- `tests/state/command-normalization.test.ts:209` | 15 个固定只读命令均 `[]` | 是，N`:285`、`:287`、`:357`、`:358`。
- `tests/state/command-normalization.test.ts:216` | git commit、rm 保留原 words | 是，N`:358` 的白名单限制。
- `tests/state/command-normalization.test.ts:221` | 普通 find `[]`；`-delete`、`-exec` 保留 | 是，N`:359`。
- `tests/state/command-normalization.test.ts:227` | 全部无关段得到 parsed/actions `[]` | 是，N`:408`。
- `tests/state/command-normalization.test.ts:232` | 无关段之间仅保留 tool x | 是，N`:408`、`:451`。
- `tests/state/command-normalization.test.ts:245` | 圆括号递归，顺序保留 tool a 或 a/b | 是，N`:235`、`:489`。
- `tests/state/command-normalization.test.ts:251` | 花括号递归，保留 tool a、tool b | 是，N`:246`、`:489`。
- `tests/state/command-normalization.test.ts:256` | 嵌套组得到 a/b/c/d 顺序 | 是，N`:488`–`:491`。
- `tests/state/command-normalization.test.ts:263` | bash/sh/zsh/dash 固定 `-c/-lc/-ic` 静态字符串递归为 tool a | 是，N`:396`–`:404`。
- `tests/state/command-normalization.test.ts:270` | 三层 shell parsed/tool a；规格最多 3 层 | 是，N`:400` 边界。
- `tests/state/command-normalization.test.ts:275` | 四层 shell 为 unparsed | 是，N`:400`。
- `tests/state/command-normalization.test.ts:279` | shell 前后 action 顺序 x/a/y，内部只有 cd 时 `[]` | 是，N`:402`、`:408`、`:451`。
- `tests/state/command-normalization.test.ts:293` | 未闭合单/双引号、反引号为 unparsed，reason 非空 | 是，N`:130`、`:160`、`:176`。
- `tests/state/command-normalization.test.ts:299` | here-doc 为 unparsed | 是，N`:220`、`:221`。
- `tests/state/command-normalization.test.ts:304` | executable 位置 `$()`/反引号为 unparsed | 是，N`:390`、`:391`。
- `tests/state/command-normalization.test.ts:310` | eval/source/`.` 为 unparsed | 是，N`:381`、`:393`。
- `tests/state/command-normalization.test.ts:316` | `<()`、`>()` process substitution 为 unparsed | 是，N`:217`、`:218`。
- `tests/state/command-normalization.test.ts:321` | 三种函数定义为 unparsed | 是，函数定义拒绝路径 N`:237`、`:238`、`:393`–`:395`；不能把它当作每个内部重复检查都单独受保护。
- `tests/state/command-normalization.test.ts:327` | alias 为 unparsed | 是，N`:381`、`:393`。
- `tests/state/command-normalization.test.ts:331` | 再次覆盖四层 shell unparsed | 是，N`:400`；与 `:275` 重复，但没有因此删除它或报 F12。
- `tests/state/command-normalization.test.ts:335` | 参数位置 `$(date)` 保留，echo 的替换参数仍无 action | 是，N`:390` 只检查 executable、N`:408`。
- `tests/state/command-normalization.test.ts:340` | 任一段/组内出现不支持语法，整命令 unparsed | 是，N`:450`、`:490`、`:506` 的失败传播。
- `tests/state/command-normalization.test.ts:359` | dirs：`[]`、`['app']`、`['a','b']`，分号/或/换行仍保留同层目录 | 是，N`:369`–`:377`；来源为规格 `:480` 和 B3 任务书 §8 answer 1。
- `tests/state/command-normalization.test.ts:369` | 花括号目录传播到内部及后续 action | 是，N`:492`–`:495`。
- `tests/state/command-normalization.test.ts:375` | 子 shell 内 `['app']`，外部恢复 `[]` | 是，N`:492` 的 brace 限定。
- `tests/state/command-normalization.test.ts:380` | pipeline/background 的 cd 不泄露；AND-OR 后台例子为 `[['app'],[]]` | 是，N`:467`–`:480`。
- `tests/state/command-normalization.test.ts:389` | bash 子 shell 继承 outer、叠加 inner，返回外层后只剩 outer | 是，N`:402`、`:404`。
- `tests/state/command-normalization.test.ts:395` | 非静态 cd、无参数 cd、cd -、pushd/popd 后 dirs 为 null | 是，N`:371`、`:375`、`:376`。
- `tests/state/command-normalization.test.ts:406` | 公开 parse 仍只有 words/text；detailed 另含 dirs | 是，N`:518`、`:529`。
- `tests/state/command-normalization.test.ts:418` | pipeline 在 `;` 结束后恢复 `[]` 或 `['outer']` | 是，N`:462`。
- `tests/state/command-normalization.test.ts:423` | pipeline 在 `&&/||` 结束后恢复外部 dirs | 是，N`:455`。
- `tests/state/command-normalization.test.ts:429` | 多 pipeline 元素仍使用外层 dirs，最后恢复 | 是，N`:469`–`:474`、`:462`。
- `tests/state/command-normalization.test.ts:434` | 后台/组规则不变，预期 `[[],[]]`、`[['app'],[]]`、`[[]]` | 是，N`:478`、`:492`。
- `tests/state/command-normalization.test.ts:441` | 公开投影精确为 parsed、words npm/run/x、text `"npm run x"` | 是，N`:518`。

**CRR 纯状态机行**

以下后端均“不适用，A5”。状态/事件/守卫来自规格 `:1280`–`:1290`；revision 数值为创建版 1 后逐次写入加 1。这里 `C` 指 `src/core/work-graph/state/command-rerun-request.ts`。

- `tests/state/command-rerun-request-used-by.test.ts:82` | B2-09：新请求 usedBy null | 是，C`:99`。
- `tests/state/command-rerun-request-used-by.test.ts:90` | B2-09/CRR-03：used、revision 3、T2、`{runId:'run-9',callId:'call-42'}`，write_request+used 两个 effect；输入字面量在测试 `:53`、`:54` | 是，C`:196`、`:240`、`:243`。
- `tests/state/command-rerun-request-used-by.test.ts:109` | B2-09 replay：同一个 used 对象、同一个 usedBy、effects `[]` | 是，C`:115`–`:118`；不是无原因重复触发，是明确 receipt replay。
- `tests/state/command-rerun-request.test.ts:120` | CRR-01：pending、revision/schemaVersion 1、declared false、forms `[]`、answer/allowedAt/usedAt null、T0，created effect | 是，C`:89`–`:102`。
- `tests/state/command-rerun-request.test.ts:139` | CRR-01 declared rewrite：`['pending',1,true,[form]]` | 是，C 的构造分支；form 是纯函数输入，A5。
- `tests/state/command-rerun-request.test.ts:149` | CRR-01：guard_failed/capacity | 删除容量检查 C`:85` 会失败；但把上限提高不会失败，因为输入随生产常量变，F8。
- `tests/state/command-rerun-request.test.ts:154` | CRR-01 created-from-none：pending/revision1/schema1、2 effects | 是，C`:120`–`:124`。
- `tests/state/command-rerun-request.test.ts:161` | CRR-02：allowed/revision2/T1/null、m1，allowed event | 是，C`:181`–`:184`。
- `tests/state/command-rerun-request.test.ts:171` | CRR-02 inactive：guard_failed/busy | 是，C`:178`。
- `tests/state/command-rerun-request.test.ts:176` | CRR-02 wrong card：guard_failed/invalid | 是，C`:177`。
- `tests/state/command-rerun-request.test.ts:183` | CRR-02/03：used/revision3/T1/T2，used event | 是，C`:196`。
- `tests/state/command-rerun-request.test.ts:192` | CRR-03 pending→used：illegal/invalid | 是，C`:193`。
- `tests/state/command-rerun-request.test.ts:198` | CRR-04：denied/revision2/allowedAt null、m2，denied event | 是，C`:183`、`:184`。
- `tests/state/command-rerun-request.test.ts:208` | CRR-04 inactive：guard_failed/busy | 是，C`:178`。
- `tests/state/command-rerun-request.test.ts:214` | CRR-05：denied_final/revision2/allowedAt null、m3 | 是，C`:132`、`:183`。
- `tests/state/command-rerun-request.test.ts:224` | CRR-05 wrong card：guard_failed/invalid | 是，C`:177`。
- `tests/state/command-rerun-request.test.ts:230` | CRR-06 pending→closed：closed/revision2、closed event | 是，C`:207`。
- `tests/state/command-rerun-request.test.ts:241` | CRR-06 allowed→closed：closed/revision3/usedAt null | 是，C`:204`、`:207`。
- `tests/state/command-rerun-request.test.ts:254` | CRR-06 used/denied/denied_final 不能 closed：illegal/invalid，原 state 不变 | 是，C`:204`。
- `tests/state/command-rerun-request.test.ts:271` | CRR-07：pending 保持 pending@2，denied/denied_final 保持原 state@3，追加给定 form，forms_added event | 是，C`:216`、`:226`–`:228`。
- `tests/state/command-rerun-request.test.ts:283` | CRR-07 denied 且另一 Run：illegal/invalid | 是，C`:219`；其余 guard 输入有效，不是双错误拒绝行。
- `tests/state/command-rerun-request.test.ts:292` | CRR-07：第九 form capacity | 删除 C`:222` 会失败；错误提高上限不会失败，F8。
- `tests/state/command-rerun-request.test.ts:302` | CRR-02/04/05/06/07：expectedRevision 7 对当前 1，stale/revision_conflict | 是，C`:126`。
- `tests/state/command-rerun-request.test.ts:322` | 表外六组合均 illegal/invalid：allowed→allowed、denied→allowed、denied_final→closed、used/allowed→forms_added、pending→created | 是，分别由 C`:174`、`:204`、`:216`、`:136` 拒绝；各行 expectedRevision 与当前一致。
- `tests/state/command-rerun-request.test.ts:328` | none 上非 created：illegal/invalid | 是，C`:121`。
- `tests/state/command-rerun-request.test.ts:335` | 同身份同内容：返回同一 allowed 对象、effects `[]`，尽管旧 expectedRevision 为 1 | 是，C`:115`–`:118`；它刻意验证 replay 优先于 CAS，不能按 A6 双错误误报。
- `tests/state/command-rerun-request.test.ts:346` | 同身份不同内容：duplicate/idempotency_conflict | 是，C`:116`、`:118`；删掉该检查后会变成 stale，而断言精确要求 duplicate，因此不是“另一个错误也能让测试过”。
- `tests/state/command-rerun-request.test.ts:355` | openRequestForAlias：只选择 matching pending/allowed；denied、other alias、other review、other task 均排除 | 是，C`:158`–`:161`；每个过滤条件都有独立会改变返回值的样本。

**4. LEDGER**

仅处理累计台账落入 G4 的 14 行；以下是裁定和现位置，不重抄旧断言。

- 台账 `:139`，K3-20 旧 options | **较早任务要求导致的必要变更**：rework-6 §2 item 3 的真实前置路径原则，及规格 `:432` 的非空 proposalTargets；现 `K3-20-review-card-paging.test.ts:232`、`:233` 精确断言四选项。真实单 process 记录新增 safer_method，不能保留旧空记录的三选项期望；不是 F12。
- 台账 `:140`，startup-answers 旧 revision 1 | **必要变更**：真实 pending 创建后再 settle，现 `K3-29-startup-answers.test.ts:122` 精确为 revision 2；对应 rework-6 §2 item 3，`.lead-ref/k3-g4b3-rework-6.md:40`。新路径里的 settle 原因仍有 F6，但 revision 迁移本身不是削弱。
- 台账 `:141`，旧 marked committed | **较早任务要求替换旧手造 recognition**：rework-6 §2 item 3 明确点名本文件，`.lead-ref/k3-g4b3-rework-6.md:47`；现真实 RUN-20 结果门槛在 `tests/helpers/K3-35-continuation-fixture.ts:703`，公开 Run 再读在 `:706`。旧写入对象已取消，不能要求保留旧变量断言。
- 台账 `:142`，旧 resolved committed | **等价迁移**：现 RUN-22 公开调用及 committed 门槛在 `tests/helpers/K3-35-continuation-fixture.ts:750`–`:752`。
- 台账 `:143`，旧 claimed committed | **等价迁移**：真实 round claim 的 committed 门槛在 `tests/helpers/S5-decision-fixture.ts:682`、`:683`；调用在 `tests/helpers/K3-proposal-round.ts:389`。
- 台账 `:144`，旧 read ready | **等价迁移**：现 review 公开读取及 ready 门槛在 `tests/helpers/K3-35-continuation-fixture.ts:761`、`:762`；round 记录再读在 `tests/helpers/K3-proposal-round.ts:392`。
- 台账 `:145`，旧 claimed committed | **等价迁移**：实际 Run claim 的 committed 门槛在 `tests/helpers/K3-35-continuation-fixture.ts:525`、`:532`，被 `K3-29-startup-reconcile-2b.test.ts:90` 的真实 harness 路径调用。
- 台账 `:146`，旧 activeRound ready 包装断言 | **等价且更具体的迁移**：现 `K3-29-startup-reconcile-2b.test.ts:268` 断言 `round.record.activeRound` 的 phase review 和 round 1；helper 返回前另检查真实 activeRound 与 claim Run 一致，`tests/helpers/K3-proposal-round.ts:393`、`:396`。kind 2 判别覆盖不足另报 F11，不是这次包装迁移造成。
- 台账 `:434`，startup-answers 第一条旧标题 | **较早任务必需**：rework-7 §2 item 4 明确该文件双后端，`.lead-ref/k3-g4b3-rework-7.md:40`、`:42`；现 `K3-29-startup-answers.test.ts:115` 为 memory/SQLite `.each`。
- 台账 `:435`，startup-answers 第二条旧标题 | **较早任务必需**：同一 book item；现 `K3-29-startup-answers.test.ts:148`。
- 台账 `:436`，startup-reconcile 列表旧标题 | **较早任务必需**：rework-6 §2 item 3 替换旧前置、rework-7 §2 item 4 扩双后端；现 `K3-29-startup-reconcile-2b.test.ts:201`。
- 台账 `:437`，startup-reconcile 首页失败旧标题 | **较早任务必需**：rework-7 §2 item 4；现 `K3-29-startup-reconcile-2b.test.ts:231`。
- 台账 `:438`，startup-reconcile kind 1/2 旧标题 | **较早任务必需**：rework-7 §2 item 4；现 `K3-29-startup-reconcile-2b.test.ts:260`。
- 台账 `:439`，startup-reconcile inactive Goal 旧标题 | **较早任务必需**：rework-7 §2 item 4；现 `K3-29-startup-reconcile-2b.test.ts:281`。

台账列出的七项 timeout 提高不在 G4 文件中；没有把当前存在的 `120_000/300_000` 本身当成“提高”的证据。

**5. CANARIES**

- rulings §4 的 `tests/business/K3-review-workflow-rows.test.ts:736` / performWorld：不属于 `.lead-ref/groups/G4.txt`；G4 没有该调用，未冒报“本组已验证干净”。
- rulings §4 的 `tests/work-graph/K3-06-mixed-kinds-owner.test.ts`：不在 G4。
- rulings §4 的 `tests/work-graph/K3-13-two-items-owner.test.ts`：不在 G4。
- rulings §4 的 `tests/app/K3-15-review-routes.test.ts:81`：不在 G4。
- rulings §4 的 `tests/work-graph/K3-16-approval-application.test.ts:238`：不在 G4；本组文件是另一个 `tests/scenarios/K3-16-approval-round.test.ts`，不能混为同一 canary。本组 `:163` 另发现 F8。
- rulings §4 的 `tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:388`、`:374`：不在 G4。
- rulings §4 的七项 timeout ledger canary：均不落入本组 11 文件。

因此，本组没有“应出现却漏掉”的 §4 canary；不能将此理解为整个审计的 canary 已通过。

**6. STATIC claims**

本次没有实际执行公开调用序列；以下是逐步沿实现核对的静态结果。没有用“公开步骤不可达”作为删除 G4 业务场景的理由。

- **RUN-25 两后端可达的静态路径**：公开建立世界和 Session → `openRealRunHarness(world,{gitWorkspace:true,takeover:hl03_stale_lock证明})` → `claimRun` → `prepareAndStart(...,{prepareViaRuntime:true,blockOnShell:true})` → 在真实工具入口保持未决 → `reconcileUnknownTwice`。git 初始化在 `tests/helpers/K3-35-continuation-fixture.ts:450`，实际 git helper 在 `tests/scenarios/support/git-workspace.ts:92`；Runtime baseline 准备在前者 `:555`；真实 start 在 `:576`；同一 memory records/body backend 的 A4 共享在 `:637`、`:646`；SQLite 组合根在 `:660`、`:661`；真实 probe/reconcile 在 `:687`–`:696`；重复请求及公开最终 Run 读取在 `:715`–`:727`。
- **内存后端不是自动拒绝条件**：规格 `:138` 明确允许服务层 memory 示例在 HostInstanceFacts 注入 `hl03_stale_lock`。生产拒绝的是 `takeover === null/undefined` 或 `kind === 'memory_store'`，`src/core/agent-runtime/run-reconcile.ts:453`、`:454`，不是 storage.kind 为 memory。故“memory 必然不能测 RUN-25”不成立。
- **不开 Runtime baseline 分支会被拒绝**：普通 `prepareContinuation` 分支在 `tests/helpers/K3-35-continuation-fixture.ts:566`，harness 注释在 `:550`–`:552` 说明其没有 RUN-25 baseline；生产在 `src/core/agent-runtime/run-reconcile.ts:475` 返回 `no_baseline`。不能只初始化 git、不走 Runtime prepare，就称双后端路径已经齐备。
- **该可达性结论有明确前置**：真实工具必须属于 contained 集合，shell 的声明在 `src/core/work-graph/state/unknown-call-kinds.ts:40`；还须 inputs confirmed、closure supported、head 一致、inventory complete、workspace captured，检查在 `src/core/agent-runtime/run-reconcile.ts:458`–`:475`；WorkGraph 还检查 stop pointer、Session 可关闭和此前无自动清理，`src/core/work-graph/state/run-machine.ts:2435`–`:2439`。不能仅凭 helper 名称把任何现有用例算作 RUN-25 覆盖。
- **现有共享路径并非全链合规**：上述运行、识别、backend 共享部分可用，但 W 组前置的 S5 手造世界仍在 `tests/helpers/S5-decision-fixture.ts:543`、`:736`、`:742`，shell 成功替身仍在 `tests/helpers/K3-tool-seams.ts:93`；这些必须按 FINDINGS 修复，不影响“生产路径不存在 memory 专属阻断”的静态判断。
- **kind 2 隔离状态可以公开形成**：真实 review claim → 人的公开 hold → Runtime 结束 round Run → startup reconcile；hold 明确保留 activeRound，`src/core/work-graph/state/unknown-call-review.ts:593`，此时 status resolved/hold held 不命中 kind 1，但 activeRound 命中 `src/app/startup-reconcile.ts:240`。因此 F11-02 不需要篡改记录，也不需要删场景。

**7. OPEN QUESTIONS**

无。现有发现均可依据 v1 的默认拒绝、A1–A7、F1–F12、双后端条款及 rulings 作出处理，不需要新增例外。

这里没有把旧注释中的“port double”“stand-in”“frozen data”当成许可；v1 A7 为空。也没有因“服务接口是 public”就允许测试替 Runtime 填 Kernel 身份、位置或 prepared。

**8. SEARCH LOG**

- 读取 `.lead-ref/groups/G4.txt`，逐文件按 UTF-8 带行号读取至 EOF；最终核对行数为 226、234、287、198、292、250、104、338、445、113、366，总计 2,853。
- 对 11 文件枚举 `it`、`it.each` 声明，并核对最后一个测试标题；得到 104 个声明、111 个后端展开用例。
- 完整读取 `.lead-ref/test-rule-sheet.md` 和 `.lead-ref/k3-b3-rulings-v1.md`；核对 A7 空表、T 范围、撤回裁定、RUN-25 问题和 §4 canaries。
- 读取 `.lead-ref/groups/H.txt`，按 G4 的实际 imports 和调用链追入 helper；没有以“由 H 组审”替代自己的裁定。
- 阅读 `b3-helpers.diff` 的文件/hunk 索引及相关 helper 当前实现；追到 S5 seed、Session 创建、prepared、entry、candidate/message 写入、world reader、CRR helper、Runtime prepare/start、Host recognition、backend/body 共享。
- 对 ledger 搜索全部 11 个路径，得到本组 14 条命中；逐条对照当前断言和 rework-6 §2 item 3/4、rework-7 §2 item 4，以及 B3 初始任务书。
- 阅读相关历史返工说明、rework8-final、上次 capped review；检索 closeout-grep 的 G4 项。未采用其“0 defects”结论作为证据。
- 搜索并逐段核对 `resolveConfiguration`、spread 覆写、`seedCommit`、`recordSessionCreated`、`authorizeRuntimeEntry`、`beginRuntimeEntry`、`recordExecutionEntered`、`requestRerun`、`review_unavailable`。
- 搜索并逐段核对 `waitFor`、`setTimeout`、`ledgerEventTypes`、`counts`、`assertInvariants`，确认隐藏于 harness 的数据库断言和 sleep。
- 核对生产 `reviewRedriveKindOf`、startup kind 3/4、CRR answer handover、Workflow `applyHandedOverAnswers`、UCR receipt replay、decision queue window retry/paging。
- 完整阅读命令归一化/解析实现，并逐行对照 60 个纯函数测试；阅读 CRR 状态机各守卫、effects 和 replay 顺序，检查拒绝行是否有可掩盖目标 guard 的第二错误。
- 静态追踪 RUN-25 的 git baseline、Host takeover、memory records/body 共享、真实 probe 和 WorkGraph G9。
- `rg` 不在 PATH，改用 PowerShell `Select-String`、`Get-Content -Encoding UTF8`、`Get-ChildItem`。终端中文编码不可靠时，对读取内容做 Unicode 转义后在工具编排层还原；未把乱码片段算作完成读取。
- 没有运行测试、构建、应用服务、git 操作或写文件；没有提交审计文件。

G4: files read 11/11; instances by rule: F1 1, F2 2, F3 15, F4 27, F5 0, F6 2, F7 8, F8 10, F9 2, F10 0, F11 4, F12 0; open questions 0