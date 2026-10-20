这份结果**尚不能作为 v1 第 14 行要求的完整实例清单**。已确认的实例列在下面；另外保留逐文件覆盖索引。覆盖索引中的“待核”不计作“v2 允许”。末行按表中有确定判定的合并行计数，不按循环执行次数计数。规则依据：`.lead-ref/books/test-rule-sheet-v1.md:14`、`.lead-ref/books/test-rule-sheet-v2.md:24`。

下文相对路径均以 `tests/scenarios/` 为根；`helpers/` 明写为 `tests/helpers/`。同一行合并的位置共用所述来源和判定。

一、A1 输入

“v2 允许”只表示所列输入的来源符合 A1；同一测试里的内部写入另列 F3。签发值必须来自真实公开返回值，不能从记录重建，依据 `.lead-ref/books/test-rule-sheet-v2.md:32`。

| 编号 | 位置、owner | 值及来源；签发字段来源 | 后续是否只走公开步骤 | 判定 |
|---|---|---|---|---|
| A01 | `A7-control.test.ts:210`；`runtime.startRun` | 手写启动请求；`prepared` 原样取自真实 `prepareExecution` 返回值（`:207`） | 初始化另有 F3，见下表；不能据此允许整例 | **v2 允许，A1 签发值原样传递** |
| A02 | `A8-host-restart-lease.test.ts:164`、`:215`；`startQuery` | 手写启动包装；prepared 分别来自公开 prepare（`:158`、`:213`），未重建 | 不是仅公开验看；此处只判输入来源 | **v2 允许，A1 签发值原样传递** |
| A03 | `S2C-K2-query-not-entered.test.ts:55`；`startQuery` | 手写请求；prepared 来自 `queries/prepare`（`:51`） | 此后通过 line section 读取（`:63`、`:68`、`:76`） | **v2 允许，A1** |
| A04 | `K3-20-review-card-paging.test.ts:63`；`queryDecisionQueue` | 手写 workspace、limit；后续 cursor 取上一页返回值（`:68`） | 该分页循环是；所在测试另有内部 card source 调用（`:103`） | **v2 允许，A1** |
| A05 | `S4C2-U6-note-card-e2e.test.ts:40`、`:42`、`:218`、`:221`；notes 写 owner，经 `writeUser/writeAgent` | 手写 note draft；helper 位于 `tests/helpers/S4C2-note-card-fixture.ts:286`、`:292`；没有手写 receipt、cursor 或 prepared | 写入后的卡片处理走公开 owner（`:85`、`:233`）；fixture 初始化另有 F3 | **v2 允许，A1 draft** |
| A06 | `S5-goal-conflict-rework.test.ts:170`；`markNoticesSeen` | 手写包装；displayToken、seenThrough 来自公开队列的 firstPage（`:160`、`:169`）；helper 转交在 `support/S5-decisions.ts:448` | 所在测试还经过有内部断言的 harness（`harness.ts:687`） | **v2 允许，A1 签发值原样传递** |
| A07 | `WP2-wiring-scenario.test.ts:236`；`markNoticesSeen` | displayToken、seenThrough 来自公开队列（`:220`、`:227`）；workspace pin 来自公开注册读取（`:234`）；`:209` 捕获的位置仅作期望值 | 否，后面还有手写 health（`:243`、`:251`、`:257`） | **v2 允许，A1 签发值原样传递** |
| A08 | `K3-store-wrapper-seam.test.ts:28`、`:36`、`:40`、`:47`、`:49`；`goals.createGoal` | 手写 goal 请求（`:21`）；失败后原请求重试，没有重建签发字段 | 是，所列请求通过公开 route，包装器放行后调用真实 owner | **v2 允许，A1** |
| F01 | `support/control.ts:170`；`runtime.startRun`；调用者 `A7-control.test.ts:287` | 从公开 execution **记录**（`:165`）拆出 claim、envelope、inputBinding，再拼成 prepared（`:171`）；不是 prepare 返回值 | 启动后继续测试；来源已违反签发值限制 | **F1，v2 A1 签发值不得从记录重建** |
| F02 | `support/fuzz.ts:1553`；`runtime.startRun` | 从 execution 读取（`:1546`）取得 record（`:1548`），在 `:1554` 重建 prepared | 否，之后进入内部 invariant gate（`:1562`） | **F1，v2 A1 签发值不得从记录重建** |
| F03 | `support/S5-decisions.ts:434`；`recordDecisionApplication`；调用者 `S5-two-request-decisions.test.ts:163` | receipt 由 `s5CommitReceipt` 从 SQLite idempotency 行读取 identity、fingerprint，再与 cursor 拼装（`support/S5-decisions.ts:148`、`:151`、`:154`）；调用点 `S5-two-request-decisions.test.ts:141` | 否；应用后同时有公开 card 读取（`:169`）和内部账本断言（`:165`、`:176`） | **F1，v2 A1 receipt/fingerprint 不得从 store 重建** |
| F04 | `support/common.ts:712`；HTTP core route；调用者 `C7-supersede-failed-task.test.ts:133` | bearer token 是测试字面量 `plan-board-route-token`（`support/common.ts:704`），同时配置到服务器（`:705`），随后用于请求 | 后续继续推进（`C7-supersede-failed-task.test.ts:161`） | **F1，v2 A1 credential 不得由测试签发** |
| F05 | `A8-host-restart-attestation.test.ts:87`；底层 `resolveUnknownRun` | 手写 kernelTurnOpen、inputsConfirmed、review（`:80`、`:88`）；这是下层派生事实输入，不是 route 的公开 attest 请求 | 否；接受后读内部账本（`:92`、`:94`、`:98`） | **F1，v2 保留的派生 review/entered fact 禁令** |
| F06 | `A8-host-restart-attestation.test.ts:150`；底层 `resolveUnknownQueryRun` | 手写 kernelTurnOpen、inputsConfirmed（`:151`），不是平台从 Kernel 派生的事实 | 否；接受后内部验看（`:156`、`:160`、`:161`） | **F1，v2 保留的派生事实禁令** |
| F07 | `S3-context-and-inputs.test.ts:261`；`plans.proposePlan` | draft 的 artifactRef 来自 `legacyArtifactRef`：测试先计算 digest、size（`:192`、`:194`），放入 inputRequirements（`:217`）；公开/owner 存储实际发生在后面（`:329`） | 提议后继续 apply（`:264`）、Run（`:322`）；后来的存储不能改变输入当时的来源 | **F1，v2 A1 fingerprint 不得由测试预先制造** |
| F08 | `K3-20-review-card-paging.test.ts:103`、`:229`、`:234`；内部 `cardSource.readPage` | cursor 是字面量 `'2'`、`'2'`、`'4'`（`:104`、`:230`、`:235`），没有使用上一页的 nextCursor；这也不是公开 route owner | 否，直接调用内部 source 后继续验看 | **F1，v2 A1 cursor 必须来自真实公开返回值** |
| F09 | `support/fuzz.ts:2241`；`activateCompletionPolicy` | target 复制自内部 invariant world 中 Plan 的 effectiveCompletionPolicy（`:2235`、`:2243`）；active revision 又从 records.readMany 获取（`:2238`） | 否，随后调用内部 session fixture（`:2245`） | **F1，v2 A1 平台派生 policy pin/digest 不得从内部记录重建** |
| 待核 | `A1-rework-same-session.test.ts:58` | 平台 `edit` 参数；其余调用的来源、签发字段及续行尚未逐项收齐 | 待核 | 不计数 |
| 待核 | `A10-check-recovery.test.ts:80` | Workflow 推进输入；同上 | 待核 | 不计数 |
| 待核 | `A11-no-progress.test.ts:131` | `seedAG2bWorkGraph`；helper：`tests/helpers/AG2b-collaboration-fixture.ts:395` | 待核 | 不计数 |
| 待核 | `A4-duplicate-receipts.test.ts:90` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `A7-control-goal29.test.ts:59` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `A7-control.test.ts:162` | `submitControl`；本文件其他输入未逐项收齐 | 待核 | 不计数 |
| 待核 | `A8-host-restart-attestation.test.ts:123` | `seedAG2bWorkGraph`；helper：`tests/helpers/AG2b-collaboration-fixture.ts:395` | 待核 | 不计数 |
| 待核 | `A8-host-restart-entry.test.ts:57` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `A8-host-restart-lease.test.ts:56` | `seedAG2bWorkGraph`；helper：`tests/helpers/AG2b-collaboration-fixture.ts:395` | 待核 | 不计数 |
| 待核 | `A8-host-restart-paused.test.ts:91` | 平台 `read` 参数 | 待核 | 不计数 |
| 待核 | `A8-host-restart-rework.test.ts:32` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `A8-host-restart.test.ts:89` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `B2-09b-allowance-crash.test.ts:127` | 平台 `shell` 参数 | 待核 | 不计数 |
| 待核 | `C3-brief-idempotency.test.ts:64` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `C3-not-entered-chain.test.ts:35` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `C3-paused-continue-brief.test.ts:55` | `submitControl`；helper：`tests/helpers/A2-restart-fixture.ts:155` | 待核 | 不计数 |
| 待核 | `C3-reply-other-session.test.ts:58` | 平台 `send_session_message` 参数 | 待核 | 不计数 |
| 待核 | `C3-workspace-changed.test.ts:38` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `C5-gate-fix-open.test.ts:36` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `C5-gate-fix.test.ts:49` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `C5-reverify-guards.test.ts:74` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `C6-unrelated-adoption.test.ts:55` | plan 工具参数；实际赋值在 `:68`、`:76`，不能把初始空对象直接当执行参数 | 待核 | 不计数 |
| 待核 | `C7-defer-reactivate.test.ts:78` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `C7-supersede-failed-task.test.ts:57` | plan 工具参数；实际赋值在 `:83`、`:92` | 待核 | 不计数 |
| 待核 | `C8-auto-rework-cap.test.ts:38` | 平台 `edit` 参数 | 待核 | 不计数 |
| 待核 | `C8-budget.test.ts:52` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `C8-human-stop-respected.test.ts:76` | `submitControl`；helper：`tests/helpers/A2-restart-fixture.ts:155` | 待核 | 不计数 |
| 待核 | `K-R-attested-facts-source.test.ts:50` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K-R-interrupted-brief.test.ts:53` | `sendMessage` 请求 | 待核 | 不计数 |
| 待核 | `K-W-fallback.test.ts:53` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `K-W-maintenance.test.ts:40` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K-W-workflow-close.test.ts:183` | `sendMessage` 请求 | 待核 | 不计数 |
| 待核 | `K3-05-review-round.test.ts:82` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-06-mixed-batch.test.ts:119` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-07-real-host-kill.test.ts:151` | `seedAG2bWorkGraph`；helper：`tests/helpers/AG2b-collaboration-fixture.ts:395` | 待核 | 不计数 |
| 待核 | `K3-08-wait-reply.test.ts:88` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-09-restart-between-calls.test.ts:104` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-10-review-round-cells.test.ts:78` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-11-review-reasons-r2.test.ts:90` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-12-14-review-round.test.ts:122` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-13-two-commands.test.ts:74` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-15-card-hold.test.ts:115` | `releaseHold` 请求 | 待核 | 不计数 |
| 待核 | `K3-16-approval-round.test.ts:121` | 平台 `propose_safer_method` 参数 | 待核 | 不计数 |
| 待核 | `K3-16-proposal-round.test.ts:116` | 平台 `propose_safer_method` 参数 | 待核 | 不计数 |
| 待核 | `K3-17-review-answer-shape.test.ts:83` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-18-one-card.test.ts:79` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-19-missing-read-no-round.test.ts:97` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-19-review-unavailable.test.ts:85` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-20-review-card-paging.test.ts:247` | `readDecisionCard`；除 A04、F08 外尚未逐项收齐 | 待核 | 不计数 |
| 待核 | `K3-25-attestation-replay.test.ts:54` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-26-inventory-scenarios.test.ts:163` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-27-review-claim-close.test.ts:98` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-28-attested-continuation.test.ts:69` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-29-disposition-recovery.test.ts:74` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-29-extras.test.ts:36` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-29-maintenance-review-run.test.ts:77` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-29-recovery-continuation.test.ts:89` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-29-recovery-round.test.ts:117` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-29-startup-answers.test.ts:55` | `readDecisionCard`；source 由 record 生成（`:47`、`:49`），此来源尚未定判 | 待核 | 不计数 |
| 待核 | `K3-29-startup-reconcile-2b.test.ts:94` | 平台 `shell` 参数 | 待核 | 不计数 |
| 待核 | `K3-29-startup-variants.test.ts:204` | 平台 `propose_safer_method` 参数 | 待核 | 不计数 |
| 待核 | `K3-37-stopped-review-round.test.ts:79` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-42-truncated-command.test.ts:98` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-42-unexpanded-r2.test.ts:103` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-44-crr-kind4.test.ts:88` | `queryDecisionQueue` 请求 | 待核 | 不计数 |
| 待核 | `K3-44-hold-restart.test.ts:76` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-44-recovery-answers.test.ts:75` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-45-review-incomplete-r2.test.ts:92` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-R1-continuation-protection.test.ts:114` | `openArtifact` 请求 | 待核 | 不计数 |
| 待核 | `K3-R1-file-change.test.ts:148` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `K3-R1-restart-flows.test.ts:86` | `createAG2bSession`；helper：`tests/helpers/AG2b-collaboration-fixture.ts:473` | 待核 | 不计数 |
| 待核 | `K3-R1-second-cleanup.test.ts:147` | `readReview` 请求 | 待核 | 不计数 |
| 待核 | `K3-R1-session-not-closable.test.ts:68` | `createAG2bSession`；helper：`tests/helpers/AG2b-collaboration-fixture.ts:473` | 待核 | 不计数 |
| 待核 | `K3-R1-workspace-capture.test.ts:169` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `K3-r1-seams.test.ts:164` | `createAG2bSession`；helper：`tests/helpers/AG2b-collaboration-fixture.ts:473` | 待核 | 不计数 |
| 已列 | `K3-store-wrapper-seam.test.ts:28` | 见 A08 | 是 | 不重复计数 |
| 待核 | `S1-archive-restart.test.ts:55` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `S1-wait-copy-retirement.test.ts:40` | `createAG2bSession`；helper：`tests/helpers/AG2b-collaboration-fixture.ts:473` | 待核 | 不计数 |
| 待核 | `S2C-K-archive-interruption.test.ts:28` | 平台 `read` 参数 | 待核 | 不计数 |
| 待核 | `S2C-K-archive-tags-checks.test.ts:49` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `S2C-K-archive-tags.test.ts:30` | 平台 `read` 参数 | 待核 | 不计数 |
| 待核 | `S2C-K-goal-pause.test.ts:24` | 平台 `read` 参数 | 待核 | 不计数 |
| 待核 | `S2C-K-legacy-provenance.test.ts:41` | `createSession` 请求；当前还有公开 control/requeue（`:84`、`:95`） | 待核 | 不计数 |
| 待核 | `S2C-K-paused-run24.test.ts:28` | 平台 `read` 参数 | 待核 | 不计数 |
| 待核 | `S2C-K-retired.test.ts:46` | `listLines` 请求 | 待核 | 不计数 |
| 待核 | `S2C-K-unknown-outcome.test.ts:50` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `S2C-K2-continue.test.ts:42` | `submitControl`；helper：`tests/helpers/A2-restart-fixture.ts:155` | 待核 | 不计数 |
| 待核 | `S2C-K2-controls.test.ts:48` | 平台 `read` 参数 | 待核 | 不计数 |
| 待核 | `S2C-K2-conversation.test.ts:35` | `readSessionHistory`；分页 cursor 另见 `:146`、`:153` | 待核 | 不计数 |
| 待核 | `S2C-K2-gate-checks.test.ts:43` | `linkSession` 请求 | 待核 | 不计数 |
| 待核 | `S2C-K2-paused-archive.test.ts:46` | `submitControl`；helper：`tests/helpers/A2-restart-fixture.ts:155` | 待核 | 不计数 |
| 待核 | `S2C-K2-paused-transfer.test.ts:38` | `submitControl`；helper：`tests/helpers/A2-restart-fixture.ts:155` | 待核 | 不计数 |
| 待核 | `S2C-K2-query-not-entered.test.ts:39` | Workflow 推进输入；其余见 A03 | 待核 | 不计数 |
| 待核 | `S3-context-and-inputs.test.ts:244` | bootstrap owner 输入；另有 `storeArtifact`（`:329`）待定界 | 待核 | 不计数 |
| 待核 | `S3-query-graph.test.ts:269` | bootstrap owner 输入；另有 `storeArtifact`（`:318`）待定界 | 待核 | 不计数 |
| 待核 | `S4C2-U6-note-card-e2e.test.ts:85` | `resolveDecision`；note draft 见 A05 | 待核 | 不计数 |
| 待核 | `S5-goal-conflict-rework.test.ts:85` | Workflow 推进输入；通知签发值见 A06 | 待核 | 不计数 |
| 待核 | `S5-two-request-decisions.test.ts:59` | `queryDecisionQueue` 请求；receipt 见 F03 | 待核 | 不计数 |
| 待核 | `WP1-wiring.test.ts:48` | `openPausedInterruptedScenario`；helper：`tests/helpers/WP1-scenario-fixture.ts:277` | 待核 | 不计数 |
| 待核 | `WP2-wiring-scenario.test.ts:67` | architecture observation-state 请求；通知签发值见 A07 | 待核 | 不计数 |
| 待核 | `harness.test.ts:47` | Workflow 推进输入 | 待核 | 不计数 |
| 待核 | `harness.ts:869`、`:1020` | seed helper；`tests/helpers/AG2b-collaboration-fixture.ts:434`、`:395` | 待核 | 不计数 |
| 待核 | `support/S5-decisions.ts:68` | 平台 `edit` 参数；owner 输入还包括 `:294`、`:393`、`:448` | 待核 | 不计数 |
| 待核 | `support/brief.ts:40` | 平台 `edit` 参数 | 待核 | 不计数 |
| 待核 | `support/common.ts:85` | 平台 `edit` 参数；token 见 F04 | 待核 | 不计数 |
| 待核 | `support/control.ts:66` | `submitControl`；prepared 见 F01 | 待核 | 不计数 |
| 待核 | `support/fuzz.ts:664` | 平台 `read` 参数；另有 forged trigger（`:1597`、`:1641`）尚未定判 | 待核 | 不计数 |
| 待核 | `support/gate.ts:237` | bootstrap owner 输入 | 待核 | 不计数 |
| 待核 | `support/plan.ts:179` | task 查询、plan proposal/apply（`:195`、`:199`） | 待核 | 不计数 |
| 待核 | `support/receipts.ts:136` | `requeueTask` 请求 | 待核 | 不计数 |
| 待核 | `support/restart.ts:234` | `seedAG2bWorkGraph`；helper：`tests/helpers/AG2b-collaboration-fixture.ts:395` | 待核 | 不计数 |
| 待核 | `support/review-card-round.ts:39` | `readReview`；还构造工具参数及 decision answer（`:61`、`:93`、`:125`） | 待核 | 不计数 |
| 待核 | `support/rework.ts:78` | `queryGoal`、`requeueTask`（`:82`） | 待核 | 不计数 |

二、record-store 自身测试

| 范围 | 结论 |
|---|---|
| `.lead-ref/groups/L2-files.txt:1` 至 `:117` | 本组没有 `tests/record-store/` 文件；本节无实例，不把场景测试中的 store port 当作 store 自身合同测试。适用边界见 `.lead-ref/books/test-rule-sheet-v2.md:38`、`:43`。 |

三、store 之上的写入

下表包含直接 store 写和 v1 明确列出的 Runtime/Host 事实写。后者依据 `.lead-ref/books/test-rule-sheet-v1.md:64`，不能仅因没有直接调用 `commit` 就遗漏。

| 编号 | 本组位置；到达它的测试 | 写入内容及实际写点 | 判定 |
|---|---|---|---|
| S01 | `K-W-maintenance.test.ts:130`；本文件 `:324` 调用 | `injectRunningToolCall` 手写 assistant 完成、tool started 的 Kernel 事件（`:125`），直接 append | **F3** |
| S02 | `K-W-workflow-close.test.ts:76`；本文件 `:101`、`:321` | `appendConcurrentRevision` 手写 `run.resumed` 事件（`:71`），通过 Kernel append 制造并发 revision | **F3** |
| S03 | `K3-r1-seams.test.ts:141`；本文件 `:147`、`:154` | 临时 ledger 的 events 表直接 INSERT `ModelRequestEvidenceRecorded`、`SessionMessageSent`。这是 seam 自测中的手写事件，不是 store 自身合同测试 | **F3** |
| S04 | `S3-query-graph.test.ts:208`；本文件 `:317` | `seedCompletedRun` 直接 SQL 写入手写 RunSnapshot（`:216`） | **F3** |
| S05 | `K-R-attested-facts-source.test.ts:171` | `injectAcceptedMessage`；实际 Kernel append 在 `tests/helpers/K-boundary-facts-support.ts:79` | **F3** |
| S06 | `K-R-attested-facts-source.test.ts:309`、`:377` | `injectRunningToolCall`；实际 Kernel append 在 `tests/helpers/K-boundary-facts-support.ts:118` | **F3** |
| S07 | `A7-control.test.ts:111` | `createTaskClaimFixture`；手写 Kernel session create、SessionCreated，写点 `tests/helpers/task-claim-fixture.ts:367`、`:370` | **F3** |
| S08 | `A7-control.test.ts:182` | `createB2RuntimeFixture`；包含上一行 session 写入，还在 `tests/helpers/B2-runtime-fixture.ts:204` commitRaw 两条 coordination policy 记录，body 在 `:202`、`:203` | **F3** |
| S09 | `WP2-wiring-scenario.test.ts:76` | `createWP2Platform`；经 `tests/helpers/WP2-platform-support.ts:542` 到 task fixture 的 session 写；并在 `:579` commitRaw coordination policy 记录 | **F3** |
| S10 | `K3-20-review-card-paging.test.ts:80`、`:85`、`:166` | `openK3ReviewCardWorld/createRecord`；外部链入口 `tests/helpers/K3-review-card-fixture.ts:149`、`:343`、`:399`；到 `tests/helpers/S5-decision-fixture.ts:604`、`:606` 的 Kernel/session 写，以及 `:845`、`:848`、`:851` 的执行事实写 | **F3** |
| S11 | `K3-29-startup-answers.test.ts:116`、`:119`、`:149`、`:152` | 同一 `openK3ReviewCardWorld/createRecord` 外部链；实际写点同 S10 | **F3** |
| S12 | `K3-29-startup-reconcile-2b.test.ts:89`、`:113`、`:198`、`:228`、`:257`、`:266`、`:289` | world factory、`createS5Session`、`createK3PendingReview`、`claimK3ReviewRound`；session 写点 `tests/helpers/S5-decision-fixture.ts:604`、`:606`；round helper 的 session 调用在 `tests/helpers/K3-proposal-round.ts:388` | **F3** |
| S13 | `S4C2-U6-note-card-e2e.test.ts:55`、`:79`、`:110`、`:135`、`:149`、`:163`、`:194`、`:216` | `createS4C2NoteCardFixture` 经 `tests/helpers/S4C2-note-card-fixture.ts:271` 到 S4A fixture；Kernel create、SessionCreated 写点 `tests/helpers/S4A-note-scope-fixture.ts:250`、`:253`，初始化 session 调用 `:277` 至 `:282` | **F3** |
| S14 | `support/fuzz.ts:2184`、`:2245`；测试入口 `tests/state/invariants-fuzz.test.ts:95` | `createR3eEvidenceFixture/base.createSession`；session 写点 `tests/helpers/task-claim-fixture.ts:367`、`:370`；entered 写点 `tests/helpers/B2-execution-fixture.ts:309`；手写终态 `tests/helpers/R3e-evidence-fixture.ts:265` | **F3** |
| S15 | `S1-wait-copy-retirement.test.ts:160` | `retireS1Session`；实际在 `tests/helpers/S1-runtime-scenario-fixture.ts:138` 手写 missing health/probe 事实 | **F3，Runtime/Host 事实写** |
| S16 | `support/S5-decisions.ts:567`、`:570`、`:573`、`:592`；调用者 `S5-goal-conflict-rework.test.ts:113` | 手动 authorize、begin、recordExecutionEntered、recordRunResult；Kernel 身份在 `:565` 构造，位置/cursor 在 `:597` 构造 | **F3，Runtime/Host 事实写** |
| S17 | `support/fuzz.ts:2331`、`:2334`、`:2337`、`:2466`；测试入口 `tests/state/invariants-fuzz.test.ts:95` | 手动授权、进入及终态；Kernel 位置为手写值（`:2339`、`:2468`） | **F3，Runtime/Host 事实写** |
| S18 | `WP2-wiring-scenario.test.ts:197`、`:243`、`:251`、`:257` | 直接 `recordSessionHealth`，手写 missing/ready 状态以驱动通知 | **F3，Runtime/Host 事实写** |
| W01 | `harness.ts:143` | `records.commit(batch)` 原样委托；之后观察 batch/receipt（`:148`、`:154`），没有手写提交内容 | **v2 允许，A3** |
| W02 | `K3-20-review-card-paging.test.ts:147` | `f.records.commit(input)` 原样委托 | **v2 允许，A3** |
| W03 | `K3-R1-workspace-capture.test.ts:130` | body store `put(input)` 真实委托，外层注入失败 | **v2 允许，A2/A3** |
| W04 | `support/fuzz.ts:3186` | gate 后原样 `records.commit(batch)` | **v2 允许，A3** |
| W05 | `support/plan.ts:815` | barrier 后原样 `backend.records.commit(prepared)`；prepared 是真实提交参数，不是测试构造的执行 prepared | **v2 允许，A3** |
| W06 | `support/receipts.ts:77`、`:85` | 建立、移除使 idempotency INSERT 失败的 trigger；不插入业务记录 | **v2 允许，A2** |
| 待定界 | `S3-context-and-inputs.test.ts:329`、`S3-query-graph.test.ts:318` | 直接调用内部 `materials.storeArtifact` 写正文；core route 仅绑定 `openArtifact`（`src/app/core-routes.ts:733`），此处尚未完成与内部 Runtime 写边界的判定 | 不计数 |

四、A7

| 编号 | 使用位置 | 当前用途及边界 | 判定 |
|---|---|---|---|
| H01 | `S2C-K-unknown-outcome.test.ts:75`；间接调用 `:157`、`:179` | `damageKernel` 定义 `:38`，实际破坏 JSON 在 `:41`；目标是本测试临时 Kernel 的 records 表 | **v2 允许，A7/A2** |
| H02 | `S2C-K-retired.test.ts:218`；间接调用 `:248`、`:298` | `damageKernel` 定义 `:193`，实际破坏在 `:196`；`:298` 为 damaged 分支，仍只破坏临时 Kernel | **v2 允许，A7/A2** |
| H03 | `K3-44-crr-kind4.test.ts:53` | `createProcessSandboxStandin`；executeChecks 初始化 false（`:49`）、复位 false（`:74`），仅 probe 用法 | **v2 允许，A7** |
| H04 | `K3-29-disposition-recovery.test.ts:50` | 默认 false（`:46`）、复位 false（`:68`）的 probe 分支 | **v2 允许，A7；不含下行 true 分支** |
| H05 | `K3-44-recovery-answers.test.ts:51` | 默认 false（`:47`）、复位 false（`:69`）的 probe 分支 | **v2 允许，A7；不含下行 true 分支** |
| H06 | `K3-29-disposition-recovery.test.ts:185` | 将 executeChecks 打开，使同一 stand-in 执行命令/检查 | **A7 越界** |
| H07 | `K3-44-recovery-answers.test.ts:267` | 将 executeChecks 打开，使同一 stand-in 执行命令/检查 | **A7 越界** |
| 定义 | `support/process-sandbox-standin.ts:21`、`:38`、`:48` | false 的 probe 分支在 `:42`；true 的执行分支在 `:59` 启动进程，并在 `:64` 构造输出。定义不另算一个使用实例 | 不重复计数 |
| 无使用 | `.lead-ref/groups/L2-files.txt:1` 至 `:117` | L2 没有 `buildNoteTools` 调用；v2 指定的唯一允许文件是 `tests/runtime/S4C-note-tools.test.ts`（`.lead-ref/books/test-rule-sheet-v2.md:45`） | 无实例 |

**无实例：**

- `support/git-workspace.ts:67`、`:92`：真实 git/workspace 准备，不含所列 owner 输入、记录/body 写或三个 A7 helper。
- `support/review-work-root.ts:70`、`:76`：原样转交传入的 Workflow input，之后沿真实 next 推进；输入构造点在调用者。
- `support/shell-work-root.ts:60`、`:64`：原样转交输入和真实 next；输入构造点在调用者。

```json
[
  {"section":"A1","file":"tests/scenarios/A7-control.test.ts","line":[210],"owner":"runtime.startRun","value":"真实 prepare 返回的 prepared","verdict":"v2 允许","note":"来源207；初始化F3另列"},
  {"section":"A1","file":"tests/scenarios/A8-host-restart-lease.test.ts","line":[164,215],"owner":"startQuery","value":"真实 prepare 返回的 prepared","verdict":"v2 允许","note":"来源158、213"},
  {"section":"A1","file":"tests/scenarios/S2C-K2-query-not-entered.test.ts","line":[55],"owner":"startQuery","value":"真实 queries/prepare 返回的 prepared","verdict":"v2 允许","note":"来源51；后续公开line读取63、68、76"},
  {"section":"A1","file":"tests/scenarios/K3-20-review-card-paging.test.ts","line":[63],"owner":"queryDecisionQueue","value":"手写分页请求，cursor原样取上页返回","verdict":"v2 允许","note":"cursor来源68；内部source游标另列F1"},
  {"section":"A1","file":"tests/scenarios/S4C2-U6-note-card-e2e.test.ts","line":[40,42,218,221],"owner":"notes.writeNote","value":"手写note draft","verdict":"v2 允许","note":"helper tests/helpers/S4C2-note-card-fixture.ts:286、292；初始化F3另列"},
  {"section":"A1","file":"tests/scenarios/S5-goal-conflict-rework.test.ts","line":[170],"owner":"markNoticesSeen","value":"公开队列返回的displayToken和seenThrough","verdict":"v2 允许","note":"来源160、169；helper support/S5-decisions.ts:448"},
  {"section":"A1","file":"tests/scenarios/WP2-wiring-scenario.test.ts","line":[236],"owner":"markNoticesSeen","value":"公开队列返回的displayToken和seenThrough","verdict":"v2 允许","note":"来源220、227；workspace公开读取234；后续health写另列F3"},
  {"section":"A1","file":"tests/scenarios/K3-store-wrapper-seam.test.ts","line":[28,36,40,47,49],"owner":"goals.createGoal","value":"手写goal请求及原请求重试","verdict":"v2 允许","note":"请求构造21；公开route继续"},
  {"section":"A1","file":"tests/scenarios/support/control.ts","line":[170],"owner":"runtime.startRun","value":"从execution记录重建prepared","verdict":"F1","note":"记录来源165，重建171；调用者A7-control.test.ts:287；v2签发值条款"},
  {"section":"A1","file":"tests/scenarios/support/fuzz.ts","line":[1553],"owner":"runtime.startRun","value":"从execution记录重建prepared","verdict":"F1","note":"来源1546、1548，重建1554；内部gate1562；v2签发值条款"},
  {"section":"A1","file":"tests/scenarios/support/S5-decisions.ts","line":[434],"owner":"recordDecisionApplication","value":"从SQLite idempotency重建receipt","verdict":"F1","note":"148、151、154读取并拼装；S5-two-request-decisions.test.ts:141、163调用；v2 receipt/fingerprint条款"},
  {"section":"A1","file":"tests/scenarios/support/common.ts","line":[712],"owner":"HTTP core route","value":"测试字面量bearer token","verdict":"F1","note":"704制造，705配置；C7-supersede-failed-task.test.ts:133调用；v2 credential条款"},
  {"section":"A1","file":"tests/scenarios/A8-host-restart-attestation.test.ts","line":[87],"owner":"底层resolveUnknownRun","value":"手写kernelTurnOpen、inputsConfirmed、review","verdict":"F1","note":"80、88构造，92接受，94内部验看；v2派生事实禁令"},
  {"section":"A1","file":"tests/scenarios/A8-host-restart-attestation.test.ts","line":[150],"owner":"底层resolveUnknownQueryRun","value":"手写kernelTurnOpen、inputsConfirmed","verdict":"F1","note":"151构造，156接受，160内部验看；v2派生事实禁令"},
  {"section":"A1","file":"tests/scenarios/S3-context-and-inputs.test.ts","line":[261],"owner":"plans.proposePlan","value":"测试预计算artifact digest和size的draft","verdict":"F1","note":"192、194制造，217嵌入；实际存储329；v2 fingerprint条款"},
  {"section":"A1","file":"tests/scenarios/K3-20-review-card-paging.test.ts","line":[103,229,234],"owner":"内部cardSource.readPage","value":"字面量cursor 2、2、4","verdict":"F1","note":"104、230、235；v2 cursor条款；非公开route owner"},
  {"section":"A1","file":"tests/scenarios/support/fuzz.ts","line":[2241],"owner":"activateCompletionPolicy","value":"内部Plan记录的effectiveCompletionPolicy","verdict":"F1","note":"2235内部world，2238 store读取，2243复制；v2派生pin/digest条款"},

  {"section":"A1待核","file":"tests/scenarios/A1-rework-same-session.test.ts","line":58,"owner":"edit","value":"调用索引","verdict":"待核","note":"未完成本文件全部实例的来源及续行判定"},
  {"section":"A1待核","file":"tests/scenarios/A10-check-recovery.test.ts","line":80,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/A11-no-progress.test.ts","line":131,"owner":"seedAG2bWorkGraph","value":"调用索引","verdict":"待核","note":"helper tests/helpers/AG2b-collaboration-fixture.ts:395"},
  {"section":"A1待核","file":"tests/scenarios/A4-duplicate-receipts.test.ts","line":90,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/A7-control-goal29.test.ts","line":59,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/A7-control.test.ts","line":162,"owner":"submitControl","value":"调用索引","verdict":"待核","note":"除已列确定项外未完成"},
  {"section":"A1待核","file":"tests/scenarios/A8-host-restart-attestation.test.ts","line":123,"owner":"seedAG2bWorkGraph","value":"调用索引","verdict":"待核","note":"helper tests/helpers/AG2b-collaboration-fixture.ts:395"},
  {"section":"A1待核","file":"tests/scenarios/A8-host-restart-entry.test.ts","line":57,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/A8-host-restart-lease.test.ts","line":56,"owner":"seedAG2bWorkGraph","value":"调用索引","verdict":"待核","note":"helper tests/helpers/AG2b-collaboration-fixture.ts:395"},
  {"section":"A1待核","file":"tests/scenarios/A8-host-restart-paused.test.ts","line":91,"owner":"read","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/A8-host-restart-rework.test.ts","line":32,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/A8-host-restart.test.ts","line":89,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/B2-09b-allowance-crash.test.ts","line":127,"owner":"shell","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/C3-brief-idempotency.test.ts","line":64,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/C3-not-entered-chain.test.ts","line":35,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/C3-paused-continue-brief.test.ts","line":55,"owner":"submitControl","value":"调用索引","verdict":"待核","note":"helper tests/helpers/A2-restart-fixture.ts:155"},
  {"section":"A1待核","file":"tests/scenarios/C3-reply-other-session.test.ts","line":58,"owner":"send_session_message","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/C3-workspace-changed.test.ts","line":38,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/C5-gate-fix-open.test.ts","line":36,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/C5-gate-fix.test.ts","line":49,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/C5-reverify-guards.test.ts","line":74,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/C6-unrelated-adoption.test.ts","line":55,"owner":"propose_future_plan","value":"调用索引","verdict":"待核","note":"实际参数赋值68、76"},
  {"section":"A1待核","file":"tests/scenarios/C7-defer-reactivate.test.ts","line":78,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/C7-supersede-failed-task.test.ts","line":57,"owner":"propose_future_plan","value":"调用索引","verdict":"待核","note":"实际参数赋值83、92"},
  {"section":"A1待核","file":"tests/scenarios/C8-auto-rework-cap.test.ts","line":38,"owner":"edit","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/C8-budget.test.ts","line":52,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/C8-human-stop-respected.test.ts","line":76,"owner":"submitControl","value":"调用索引","verdict":"待核","note":"helper tests/helpers/A2-restart-fixture.ts:155"},
  {"section":"A1待核","file":"tests/scenarios/K-R-attested-facts-source.test.ts","line":50,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K-R-interrupted-brief.test.ts","line":53,"owner":"sendMessage","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K-W-fallback.test.ts","line":53,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K-W-maintenance.test.ts","line":40,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K-W-workflow-close.test.ts","line":183,"owner":"sendMessage","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-05-review-round.test.ts","line":82,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-06-mixed-batch.test.ts","line":119,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-07-real-host-kill.test.ts","line":151,"owner":"seedAG2bWorkGraph","value":"调用索引","verdict":"待核","note":"helper tests/helpers/AG2b-collaboration-fixture.ts:395"},
  {"section":"A1待核","file":"tests/scenarios/K3-08-wait-reply.test.ts","line":88,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-09-restart-between-calls.test.ts","line":104,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-10-review-round-cells.test.ts","line":78,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-11-review-reasons-r2.test.ts","line":90,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-12-14-review-round.test.ts","line":122,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-13-two-commands.test.ts","line":74,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-15-card-hold.test.ts","line":115,"owner":"releaseHold","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-16-approval-round.test.ts","line":121,"owner":"propose_safer_method","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-16-proposal-round.test.ts","line":116,"owner":"propose_safer_method","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-17-review-answer-shape.test.ts","line":83,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-18-one-card.test.ts","line":79,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-19-missing-read-no-round.test.ts","line":97,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-19-review-unavailable.test.ts","line":85,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-20-review-card-paging.test.ts","line":247,"owner":"readDecisionCard","value":"调用索引","verdict":"待核","note":"除确定项外未完成"},
  {"section":"A1待核","file":"tests/scenarios/K3-25-attestation-replay.test.ts","line":54,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-26-inventory-scenarios.test.ts","line":163,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-27-review-claim-close.test.ts","line":98,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-28-attested-continuation.test.ts","line":69,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-29-disposition-recovery.test.ts","line":74,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-29-extras.test.ts","line":36,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-29-maintenance-review-run.test.ts","line":77,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-29-recovery-continuation.test.ts","line":89,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-29-recovery-round.test.ts","line":117,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-29-startup-answers.test.ts","line":55,"owner":"readDecisionCard","value":"source由record构造","verdict":"待核","note":"构造47、49；未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-29-startup-reconcile-2b.test.ts","line":94,"owner":"shell","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-29-startup-variants.test.ts","line":204,"owner":"propose_safer_method","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-37-stopped-review-round.test.ts","line":79,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-42-truncated-command.test.ts","line":98,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-42-unexpanded-r2.test.ts","line":103,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-44-crr-kind4.test.ts","line":88,"owner":"queryDecisionQueue","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-44-hold-restart.test.ts","line":76,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-44-recovery-answers.test.ts","line":75,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-45-review-incomplete-r2.test.ts","line":92,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-R1-continuation-protection.test.ts","line":114,"owner":"openArtifact","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-R1-file-change.test.ts","line":148,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-R1-restart-flows.test.ts","line":86,"owner":"createAG2bSession","value":"调用索引","verdict":"待核","note":"helper tests/helpers/AG2b-collaboration-fixture.ts:473"},
  {"section":"A1待核","file":"tests/scenarios/K3-R1-second-cleanup.test.ts","line":147,"owner":"readReview","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-R1-session-not-closable.test.ts","line":68,"owner":"createAG2bSession","value":"调用索引","verdict":"待核","note":"helper tests/helpers/AG2b-collaboration-fixture.ts:473"},
  {"section":"A1待核","file":"tests/scenarios/K3-R1-workspace-capture.test.ts","line":169,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/K3-r1-seams.test.ts","line":164,"owner":"createAG2bSession","value":"调用索引","verdict":"待核","note":"helper tests/helpers/AG2b-collaboration-fixture.ts:473"},
  {"section":"A1待核","file":"tests/scenarios/S1-archive-restart.test.ts","line":55,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/S1-wait-copy-retirement.test.ts","line":40,"owner":"createAG2bSession","value":"调用索引","verdict":"待核","note":"helper tests/helpers/AG2b-collaboration-fixture.ts:473"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K-archive-interruption.test.ts","line":28,"owner":"read","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K-archive-tags-checks.test.ts","line":49,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K-archive-tags.test.ts","line":30,"owner":"read","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K-goal-pause.test.ts","line":24,"owner":"read","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K-legacy-provenance.test.ts","line":41,"owner":"createSession","value":"调用索引","verdict":"待核","note":"当前公开control/requeue在84、95"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K-paused-run24.test.ts","line":28,"owner":"read","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K-retired.test.ts","line":46,"owner":"listLines","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K-unknown-outcome.test.ts","line":50,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K2-continue.test.ts","line":42,"owner":"submitControl","value":"调用索引","verdict":"待核","note":"helper tests/helpers/A2-restart-fixture.ts:155"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K2-controls.test.ts","line":48,"owner":"read","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K2-conversation.test.ts","line":35,"owner":"readSessionHistory","value":"调用索引","verdict":"待核","note":"分页还见146、153"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K2-gate-checks.test.ts","line":43,"owner":"linkSession","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K2-paused-archive.test.ts","line":46,"owner":"submitControl","value":"调用索引","verdict":"待核","note":"helper tests/helpers/A2-restart-fixture.ts:155"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K2-paused-transfer.test.ts","line":38,"owner":"submitControl","value":"调用索引","verdict":"待核","note":"helper tests/helpers/A2-restart-fixture.ts:155"},
  {"section":"A1待核","file":"tests/scenarios/S2C-K2-query-not-entered.test.ts","line":39,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"除确定项外未完成"},
  {"section":"A1待核","file":"tests/scenarios/S3-context-and-inputs.test.ts","line":[244,329],"owner":"bootstrap、materials.storeArtifact","value":"调用索引","verdict":"待核","note":"storeArtifact非core route绑定；其边界未定"},
  {"section":"A1待核","file":"tests/scenarios/S3-query-graph.test.ts","line":[269,318],"owner":"bootstrap、materials.storeArtifact","value":"调用索引","verdict":"待核","note":"storeArtifact非core route绑定；其边界未定"},
  {"section":"A1待核","file":"tests/scenarios/S4C2-U6-note-card-e2e.test.ts","line":85,"owner":"resolveDecision","value":"调用索引","verdict":"待核","note":"除确定项外未完成"},
  {"section":"A1待核","file":"tests/scenarios/S5-goal-conflict-rework.test.ts","line":85,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"除确定项外未完成"},
  {"section":"A1待核","file":"tests/scenarios/S5-two-request-decisions.test.ts","line":59,"owner":"queryDecisionQueue","value":"调用索引","verdict":"待核","note":"除确定项外未完成"},
  {"section":"A1待核","file":"tests/scenarios/WP1-wiring.test.ts","line":48,"owner":"openPausedInterruptedScenario","value":"调用索引","verdict":"待核","note":"helper tests/helpers/WP1-scenario-fixture.ts:277"},
  {"section":"A1待核","file":"tests/scenarios/WP2-wiring-scenario.test.ts","line":67,"owner":"architecture observation-state","value":"调用索引","verdict":"待核","note":"除确定项外未完成"},
  {"section":"A1待核","file":"tests/scenarios/harness.test.ts","line":47,"owner":"workflow.advanceWork","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/harness.ts","line":[869,1020],"owner":"seedAG2bWorkGraphThrough、seedAG2bWorkGraph","value":"调用索引","verdict":"待核","note":"helper tests/helpers/AG2b-collaboration-fixture.ts:434、395"},
  {"section":"A1待核","file":"tests/scenarios/support/S5-decisions.ts","line":[68,294,393,448],"owner":"edit、proposePlan、resolveDecision、markNoticesSeen","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/support/brief.ts","line":40,"owner":"edit","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/support/common.ts","line":85,"owner":"edit","value":"调用索引","verdict":"待核","note":"除确定项外未完成"},
  {"section":"A1待核","file":"tests/scenarios/support/control.ts","line":66,"owner":"submitControl","value":"调用索引","verdict":"待核","note":"除确定项外未完成"},
  {"section":"A1待核","file":"tests/scenarios/support/fuzz.ts","line":[664,1597,1641],"owner":"read、requeueTask","value":"调用索引及forged trigger","verdict":"待核","note":"forged分支尚未定判；未计数"},
  {"section":"A1待核","file":"tests/scenarios/support/gate.ts","line":237,"owner":"bootstrap owners","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/support/plan.ts","line":[179,195,199],"owner":"tasks/query、proposePlan、applyPlanChange","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/support/receipts.ts","line":136,"owner":"requeueTask","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/support/restart.ts","line":234,"owner":"seedAG2bWorkGraph","value":"调用索引","verdict":"待核","note":"helper tests/helpers/AG2b-collaboration-fixture.ts:395"},
  {"section":"A1待核","file":"tests/scenarios/support/review-card-round.ts","line":[39,61,93,125],"owner":"readReview、shell、record_unknown_call_review、resolveDecision","value":"调用索引","verdict":"待核","note":"未计数"},
  {"section":"A1待核","file":"tests/scenarios/support/rework.ts","line":[78,82],"owner":"queryGoal、requeueTask","value":"调用索引","verdict":"待核","note":"未计数"},

  {"section":"record-store","file":".lead-ref/groups/L2-files.txt","line":[1,117],"owner":"","value":"本组无tests/record-store文件","verdict":"无实例","note":"不计数"},

  {"section":"F3","file":"tests/scenarios/K-W-maintenance.test.ts","line":[130],"owner":"Kernel store.append","value":"手写assistant和tool事件","verdict":"F3","note":"本文件324调用；payload125"},
  {"section":"F3","file":"tests/scenarios/K-W-workflow-close.test.ts","line":[76],"owner":"Kernel store.append","value":"手写run.resumed","verdict":"F3","note":"本文件101、321到达；payload71"},
  {"section":"F3","file":"tests/scenarios/K3-r1-seams.test.ts","line":[141],"owner":"SQLite events","value":"手写两种事件标记","verdict":"F3","note":"本文件147、154到达；seam自测并非record-store合同"},
  {"section":"F3","file":"tests/scenarios/S3-query-graph.test.ts","line":[208],"owner":"SQLite snapshots","value":"手写RunSnapshot","verdict":"F3","note":"216构造，317调用"},
  {"section":"F3","file":"tests/scenarios/K-R-attested-facts-source.test.ts","line":[171],"owner":"injectAcceptedMessage","value":"Kernel事件","verdict":"F3","note":"实际写点tests/helpers/K-boundary-facts-support.ts:79"},
  {"section":"F3","file":"tests/scenarios/K-R-attested-facts-source.test.ts","line":[309,377],"owner":"injectRunningToolCall","value":"Kernel事件","verdict":"F3","note":"实际写点tests/helpers/K-boundary-facts-support.ts:118"},
  {"section":"F3","file":"tests/scenarios/A7-control.test.ts","line":[111],"owner":"createTaskClaimFixture","value":"Kernel session、SessionCreated","verdict":"F3","note":"tests/helpers/task-claim-fixture.ts:367、370"},
  {"section":"F3","file":"tests/scenarios/A7-control.test.ts","line":[182],"owner":"createB2RuntimeFixture","value":"session事实和coordination policy记录","verdict":"F3","note":"tests/helpers/task-claim-fixture.ts:367、370；tests/helpers/B2-runtime-fixture.ts:202、203、204"},
  {"section":"F3","file":"tests/scenarios/WP2-wiring-scenario.test.ts","line":[76],"owner":"createWP2Platform","value":"session事实和coordination policy记录","verdict":"F3","note":"tests/helpers/WP2-platform-support.ts:542、579；tests/helpers/task-claim-fixture.ts:367、370"},
  {"section":"F3","file":"tests/scenarios/K3-20-review-card-paging.test.ts","line":[80,85,166],"owner":"openK3ReviewCardWorld、createRecord","value":"Kernel/session和执行事实","verdict":"F3","note":"tests/helpers/K3-review-card-fixture.ts:149、343、399；tests/helpers/S5-decision-fixture.ts:604、606、845、848、851"},
  {"section":"F3","file":"tests/scenarios/K3-29-startup-answers.test.ts","line":[116,119,149,152],"owner":"openK3ReviewCardWorld、createRecord","value":"Kernel/session和执行事实","verdict":"F3","note":"tests/helpers/K3-review-card-fixture.ts:149、343、399；tests/helpers/S5-decision-fixture.ts:604、606、845、848、851"},
  {"section":"F3","file":"tests/scenarios/K3-29-startup-reconcile-2b.test.ts","line":[89,113,198,228,257,266,289],"owner":"world/session/pending-review/round helpers","value":"Kernel/session和执行事实","verdict":"F3","note":"tests/helpers/S5-decision-fixture.ts:604、606；tests/helpers/K3-proposal-round.ts:388"},
  {"section":"F3","file":"tests/scenarios/S4C2-U6-note-card-e2e.test.ts","line":[55,79,110,135,149,163,194,216],"owner":"createS4C2NoteCardFixture","value":"Kernel session、SessionCreated","verdict":"F3","note":"tests/helpers/S4C2-note-card-fixture.ts:271；tests/helpers/S4A-note-scope-fixture.ts:250、253、277"},
  {"section":"F3","file":"tests/scenarios/support/fuzz.ts","line":[2184,2245],"owner":"createR3eEvidenceFixture、base.createSession","value":"session、entered、terminal事实","verdict":"F3","note":"tests/helpers/task-claim-fixture.ts:367、370；tests/helpers/B2-execution-fixture.ts:309；tests/helpers/R3e-evidence-fixture.ts:265；tests/state/invariants-fuzz.test.ts:95到达"},
  {"section":"F3","file":"tests/scenarios/S1-wait-copy-retirement.test.ts","line":[160],"owner":"retireS1Session","value":"手写missing health","verdict":"F3","note":"tests/helpers/S1-runtime-scenario-fixture.ts:138"},
  {"section":"F3","file":"tests/scenarios/support/S5-decisions.ts","line":[567,570,573,592],"owner":"execution事实写owner","value":"手写进入、Kernel位置和终态","verdict":"F3","note":"Kernel565，位置597；S5-goal-conflict-rework.test.ts:113到达"},
  {"section":"F3","file":"tests/scenarios/support/fuzz.ts","line":[2331,2334,2337,2466],"owner":"execution事实写owner","value":"手写进入、Kernel位置和终态","verdict":"F3","note":"位置2339、2468；tests/state/invariants-fuzz.test.ts:95到达"},
  {"section":"F3","file":"tests/scenarios/WP2-wiring-scenario.test.ts","line":[197,243,251,257],"owner":"recordSessionHealth","value":"手写missing/ready事实","verdict":"F3","note":"Runtime/Host事实写"},

  {"section":"F3扫描排除","file":"tests/scenarios/harness.ts","line":[143],"owner":"records.commit","value":"原样batch委托","verdict":"v2 允许","note":"A3；148、154观察真实提交"},
  {"section":"F3扫描排除","file":"tests/scenarios/K3-20-review-card-paging.test.ts","line":[147],"owner":"records.commit","value":"原样input委托","verdict":"v2 允许","note":"A3"},
  {"section":"F3扫描排除","file":"tests/scenarios/K3-R1-workspace-capture.test.ts","line":[130],"owner":"body store.put","value":"失败注入后真实委托","verdict":"v2 允许","note":"A2/A3"},
  {"section":"F3扫描排除","file":"tests/scenarios/support/fuzz.ts","line":[3186],"owner":"records.commit","value":"gate后原样委托","verdict":"v2 允许","note":"A3"},
  {"section":"F3扫描排除","file":"tests/scenarios/support/plan.ts","line":[815],"owner":"records.commit","value":"barrier后原样委托","verdict":"v2 允许","note":"A3；这里的prepared是提交参数"},
  {"section":"F3扫描排除","file":"tests/scenarios/support/receipts.ts","line":[77,85],"owner":"SQLite trigger","value":"注入idempotency写失败","verdict":"v2 允许","note":"A2；不插入业务记录"},

  {"section":"A7","file":"tests/scenarios/S2C-K-unknown-outcome.test.ts","line":[75,157,179],"owner":"damageKernel","value":"破坏临时Kernel record JSON","verdict":"v2 允许","note":"定义38，写点41；A7/A2"},
  {"section":"A7","file":"tests/scenarios/S2C-K-retired.test.ts","line":[218,248,298],"owner":"damageKernel","value":"破坏临时Kernel record JSON","verdict":"v2 允许","note":"定义193，写点196；A7/A2"},
  {"section":"A7","file":"tests/scenarios/K3-44-crr-kind4.test.ts","line":[53],"owner":"createProcessSandboxStandin","value":"executeChecks false的probe","verdict":"v2 允许","note":"初始化49，复位74"},
  {"section":"A7","file":"tests/scenarios/K3-29-disposition-recovery.test.ts","line":[50],"owner":"createProcessSandboxStandin","value":"executeChecks false的probe","verdict":"v2 允许","note":"初始化46，复位68；不含185"},
  {"section":"A7","file":"tests/scenarios/K3-44-recovery-answers.test.ts","line":[51],"owner":"createProcessSandboxStandin","value":"executeChecks false的probe","verdict":"v2 允许","note":"初始化47，复位69；不含267"},
  {"section":"A7","file":"tests/scenarios/K3-29-disposition-recovery.test.ts","line":[185],"owner":"process sandbox stand-in","value":"executeChecks true","verdict":"A7 越界","note":"进入实际命令/检查执行分支"},
  {"section":"A7","file":"tests/scenarios/K3-44-recovery-answers.test.ts","line":[267],"owner":"process sandbox stand-in","value":"executeChecks true","verdict":"A7 越界","note":"进入实际命令/检查执行分支"},
  {"section":"A7定义","file":"tests/scenarios/support/process-sandbox-standin.ts","line":[21,38,48,59,64],"owner":"createProcessSandboxStandin","value":"probe及execute分支定义","verdict":"定义","note":"不重复计数；false分支42，true进程59，输出64"},

  {"section":"无实例","file":"tests/scenarios/support/git-workspace.ts","line":[67,92],"owner":"","value":"真实git/workspace准备","verdict":"无实例","note":"不计数"},
  {"section":"无实例","file":"tests/scenarios/support/review-work-root.ts","line":[70,76],"owner":"workflow.advanceWork转交","value":"原样input及next","verdict":"无实例","note":"构造输入计在调用者"},
  {"section":"无实例","file":"tests/scenarios/support/shell-work-root.ts","line":[60,64],"owner":"workflow.advanceWork转交","value":"原样input及next","verdict":"无实例","note":"构造输入计在调用者"}
]
```

v2 允许 19，F1 9，F3 18，A7 越界 2，文件 117/117；枚举不完整：A1 尚缺全部调用的逐项来源、完整参数分支和公开续行判定；两处内部 materials.storeArtifact 写入及 forged trigger 的边界尚未定判。