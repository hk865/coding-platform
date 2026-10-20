本次仍是**未完成穷举的核实清单**，不能作为 L7 已枚举完整的结论。已排除普通公开输入和旧 F3 手造记录；尚未闭合的跨文件调用链写在最后。

以下文件名默认相对于 `tests/work-graph/`；同一文件后的多个行号分别计数。计数单位是“章节、调用位置、值类别”，因此同一草稿及其签发字段会分别出现。`文件 169/169` 表示清单文件均已读取，不表示调用链均已穷尽（`.lead-ref/groups/L7-files.txt:1`、`.lead-ref/groups/L7-files.txt:169`）。

第一节：A1 草稿与外来值

计划类 owner 均为 `plans.proposePlan`，由真实路由绑定；请求包括 `goalRef`、`basedOn`、`draft`、`reason`（`src/app/core-routes.ts:704`；`src/core/work-graph/model/plan-contracts.ts:38`）。

下表“完整草稿”表示已核实对象结构和真实提议入口，不是整条测试合规结论。主要夹具确实继续调用公开采用步骤：`tests/helpers/graph-session-fixture.ts:425`、`:433`；`tests/helpers/task-claim-fixture.ts:344`、`:350`；`tests/helpers/S5-decision-fixture.ts:738`、`:744`；`tests/helpers/S2C-L-line-support.ts:334`、`:341`；`tests/helpers/S2C-D-node-support.ts:281`、`:284`。但夹具还存在内部读取或写入，例如 `tests/helpers/graph-session-fixture.ts:199`、`tests/helpers/task-claim-fixture.ts:372`、`tests/helpers/S2C-L-line-support.ts:245`。其余调用之后是否始终只走公开步骤，尚未逐项闭合；这里不借 v2 豁免这些独立问题（`.lead-ref/books/test-rule-sheet-v2.md:30`）。

| 文件及行号 | owner／值与契约 | 后续是否只公开 | 判定 |
|---|---|---|---|
| A1-session-independent.test.ts:26,55,86,117；A1-session-lifecycle.test.ts:80,125,272 | plans.proposePlan；夹具完整草稿 | 否，夹具含上述内部步骤 | v2 允许 |
| A2-control-service.test.ts:41；A2-disposition-change.test.ts:168,487,595,648,655,676,682；A2-entry-plan.test.ts:173,195；A2-gate-chain-facts.test.ts:44,237；A2-goal-control.test.ts:63,101,325；A2-requeue-service.test.ts:75；A2-step1-manifest.test.ts:18；A2-verification-chain.test.ts:61,173,212 | plans.proposePlan；完整草稿及提议体 | 提议／采用真实；整链未全部闭合 | v2 允许 |
| B2-01-blocked-commands.test.ts:51,95,99,125,159；B2-01-task-read.test.ts:75；B2-03-crr-request.test.ts:79,100,114,124,147,161；B2-07-crr-card-closed.test.ts:41,47,64,99；B2-07-crr-card.test.ts:41,95,139,177；B2-08-crr-answer.test.ts:58,75,89,94；B2-08-crr-cancel.test.ts:30,44；B2-09-answer-replay.test.ts:29；B2-09-crr-owner.test.ts:90,184 | plans.proposePlan；K3／S5 夹具完整草稿，真实入口见 tests/helpers/K3-review-card-fixture.ts:122 | 整链未全部闭合 | v2 允许 |
| B2-12-recognition.test.ts:133；B2-12-rewrite-prefix.test.ts:105,135,157,173；B2-14-crr-forms.test.ts:68,83,100,120,137,153；B2-17-disposition-reads.test.ts:37,52；B2-18-request-reads.test.ts:101,144；B2-UR7-crr-answer.test.ts:120,179；B2-execution-entry.test.ts:9；B2-execution-result.test.ts:6；B2-model-request.test.ts:8 | plans.proposePlan；夹具完整草稿 | 整链未全部闭合 | v2 允许 |
| C1-session-mailbox.test.ts:21；C2-mailbox-admission.test.ts:16 | plans.proposePlan；经 C1 夹具进入真实初始计划，tests/helpers/C1-mailbox-fixture.ts:92 | 含内部夹具步骤 | v2 允许 |
| R3c-plan-entry.test.ts:66,74,79 | plans.proposePlan；结构完整的空计划，不是残缺参数；草稿定义在 R3c-plan-entry.test.ts:63 | 是；公开重放、采用拒绝和读取见 R3c-plan-entry.test.ts:84、:88 | v2 允许 |
| R3c-plan-adoption.test.ts:121,182,197,340,346,369,391,424,428 | plans.proposePlan；完整草稿；包括业务问题候选、冲突及重放分支 | 否，另有内部读取，例如 R3c-plan-adoption.test.ts:440 | v2 允许 |
| R3c-task-relations.test.ts:128,158 | plans.proposePlan；结构完整，但草稿带测试自造 artifact 指纹，见 R3c-task-relations.test.ts:53、:74 | 另有内部读取，R3c-task-relations.test.ts:189 | **F1** |
| R3e-completion.test.ts:34,94,232；R3e-evidence-coverage.test.ts:26,107；R3e-evidence.test.ts:29；R3e-reverify.test.ts:93,654 | plans.proposePlan；完整草稿；共享构造及采用见 tests/helpers/R3e-evidence-fixture.ts:194、:209、:216 | 整链未全部闭合 | v2 允许 |
| R4-control-intent.test.ts:32；R4c-execution-history-index.test.ts:64,73,143,1006；R4c-execution-read.test.ts:50,98,225,586；R4c-source-authority-reader.test.ts:39,129；R4c-task-claim-boundaries.test.ts:18,131；R4c-task-claim-concurrency.test.ts:50,79,103,125,167,183,193,207；R4c-task-claim.test.ts:34,347,368,392,411 | plans.proposePlan；完整初始／修改草稿 | 含内部夹具步骤 | v2 允许 |
| RL-32b-rework-notice-memory-cap.test.ts:72,142,196,268 | plans.proposePlan；夹具完整草稿 | 整链未全部闭合 | v2 允许 |
| S1-anomaly-owner.test.ts:139,140；S1-archive-owner.test.ts:15；S1-codecs-indexes.test.ts:83；S1-dispatch-guards.test.ts:21；S1-provenance.test.ts:68；S1-requeue.test.ts:14；S1-responsibility.test.ts:132,285；S1-session-facts.test.ts:18；S1-wait-disposal.test.ts:11 | plans.proposePlan；完整初始／责任变更草稿 | 含内部夹具步骤 | v2 允许 |
| S2A-notices-attempt.test.ts:20,23；S2A-notices-counts.test.ts:25,32；S2A-notices-overbound.test.ts:25,27；S2A-notices-rework.test.ts:22；S2A-notices-since.test.ts:59；S2A-notices-workspace.test.ts:22,26,28,49,52,53 | plans.proposePlan；完整草稿；多任务构造及提交见 tests/helpers/S2A-notices-support.ts:162、:175 | 整链未全部闭合 | v2 允许 |
| S2A-queue-bounds.test.ts:26；S2A-queue-card-semantics.test.ts:23；S2A-queue-derived-cards.test.ts:20；S2A-queue-goal-runs.test.ts:35；S2A-queue-request-candidates.test.ts:31；S2A-queue-window.test.ts:15 | plans.proposePlan；S5 夹具完整草稿 | 整链未全部闭合 | v2 允许 |
| S2B-30-track-bars.test.ts:18；S2B-31-task-timeline-main.test.ts:21,23；S2B-32-task-timeline-fold.test.ts:41,57,77,96,118,138,139,141,143,165,166,168,170,181,182,184,186,188,201,211,230；S2B-33-task-timeline-pagination.test.ts:21,24,45,48,56,59,63,70,73,83,86,99,102；S2B-34-executed-files.test.ts:22,221 | plans.proposePlan；完整初始／版本草稿；入口见 tests/helpers/S2B-task-timeline-fixture.ts:295、:333，tests/helpers/S2B-track-fixture.ts:281 | 整链未全部闭合；策略指纹另见第二节 | v2 允许 |
| S2B-activity-calendar-tasks.test.ts:21；S2B-activity-calendar.test.ts:18；S2B-activity-read-faults.test.ts:21；S2B-r2-27-moving-window.test.ts:76,94,97,113,157,160；S2B-r2-activity-run-ended-at.test.ts:52；S2B-r2-calendar-boundaries.test.ts:16；S2B-r2-calendar-same-task.test.ts:22；S2B-r2-conflict-catalog.test.ts:40；S2B-r2-keyed-cap.test.ts:15；S2B-r2-never-entered.test.ts:17 | plans.proposePlan；完整草稿；活动夹具入口见 tests/helpers/S2B-activity-fixture.ts:364 | 整链未全部闭合 | v2 允许 |
| S2B-r2-r3-track-pagination.test.ts:23；S2B-r2-r4-bound-workspace.test.ts:27,43,46；S2B-r2-r5-not-entered.test.ts:19；S2B-r2-r7-keyed-read-cap.test.ts:19,50,53；S2B-r2-s-preentry-control.test.ts:24,27；S2B-r2-v-real-runs.test.ts:64,96,127,158；S2B-r2-workspace-binding.test.ts:24；S2B-r3-consultation-cap.test.ts:23；S2B-r4-session-workspace.test.ts:32,38；S2B-run-activity-read.test.ts:18 | plans.proposePlan；完整草稿 | 整链未全部闭合 | v2 允许 |
| S2B-r2-s-yielded.test.ts:39 | plans.proposePlan；场景夹具构造完整草稿；tests/scenarios/harness.ts:1020 → tests/helpers/AG2b-collaboration-fixture.ts:461 | 提议／采用公开，采用见该 helper:464；场景框架还有内部观察，tests/scenarios/harness.ts:24 | v2 允许 |
| S2C-lines-attention.test.ts:24,31,45,75,110,143,164,188,219,239；S2C-lines-controls.test.ts:33,43,60,74,109,166,185,209,231,252；S2C-lines-conversation.test.ts:48；S2C-lines-copies.test.ts:34；S2C-lines-counts.test.ts:27,34,52,64,78,96；S2C-lines-d1.test.ts:26,33,59,74,89,101 | plans.proposePlan；完整工作线草稿；构造见 tests/helpers/S2C-L-line-support.ts:295 | 含内部夹具步骤，tests/helpers/S2C-L-line-support.ts:245 | v2 允许 |
| S2C-lines-done-evidence.test.ts:33,40,58,68,85,102,120,139,155,167,178,195,241,264,283；S2C-lines-failure.test.ts:61,124,147,175,188,201；S2C-lines-identification.test.ts:34,135；S2C-lines-latest-generation.test.ts:23,30,87；S2C-lines-names.test.ts:27,43,59,70,80,124；S2C-lines-page.test.ts:47,91,131,157,179,220 | plans.proposePlan；完整工作线草稿 | 含内部夹具步骤 | v2 允许 |
| S2C-lines-paused-continue.test.ts:35,45；S2C-lines-read-only.test.ts:87,94,127,147,157,170,208,232,255；S2C-lines-scale.test.ts:43；S2C-lines-task-anchors.test.ts:27,37,58；S2C-lines-tiers.test.ts:28,43,51,67,129,158,182；S2C-lines-waiting-reply.test.ts:27,34,49,66,83；S2C-lines-walk.test.ts:60,68,154 | plans.proposePlan；完整工作线／节点草稿 | 含内部夹具步骤 | v2 允许 |
| S2C-node-detail-anomalies.test.ts:98,143,163；S2C-node-detail-bounded.test.ts:78,99,144,191,210,243；S2C-node-detail-executions.test.ts:20；S2C-node-detail-hover.test.ts:21,107,125,143,174,185；S2C-node-detail-next-kinds.test.ts:130；S2C-node-detail-task.test.ts:22,101,125；S2C-pins.test.ts:29 | plans.proposePlan；完整节点／初始草稿；节点构造见 tests/helpers/S2C-D-node-support.ts:269 | 含内部步骤，例如 tests/helpers/S2C-D-node-support.ts:300 | v2 允许 |
| S3-context-inputs.test.ts:275；S3-graph-context.test.ts:382,464,488,815；S3-prepared-context-admission.test.ts:225,762 | plans.proposePlan；完整初始／图变更草稿 | 整链未全部闭合 | v2 允许 |
| S3-context-inputs.test.ts:459；S3-prepared-context-admission.test.ts:315 | plans.proposePlan；结构完整，但带测试计算／手造的 artifact digest；来源分别为 S3-context-inputs.test.ts:116、:119，S3-prepared-context-admission.test.ts:91 | 后续不是仅公开；不能据此放行该字段 | **F1** |
| S5-decision-application.test.ts:27；S5-decision-queue.test.ts:52,160；S5-goal-cause-at-least-cursor.test.ts:16；S5-goal-settings.test.ts:90,183,234；S5-notices.test.ts:32,139,226,242,284；S5-request-candidates.test.ts:31,55；S5-user-messages.test.ts:24；S5R2-queue-history.test.ts:22,30,35,47,50,60,63,78,79,95,98,113,171,194 | plans.proposePlan；完整初始／候选草稿；候选 helper 见 tests/helpers/S5R2-a-support.ts:70、:82 | 整链未全部闭合 | v2 允许 |
| UCR-settle-review.test.ts:60；unknown-call-review-list.test.ts:40,199,229 | plans.proposePlan；夹具完整草稿 | 含内部夹具步骤 | v2 允许 |
| W1-future-plan.test.ts:263,340 | plans.proposePlan；完整未来计划草稿 | 否，W1-future-plan.test.ts:330 有内部读取 | v2 允许 |
| W2-agent-whiteboard.test.ts:39,125,140,161,174,224,234,254,266,283,294,298,304,309,333,352,368,376,412,446,498,510；W2-future-intent.test.ts:108,116,137,147,167,195,201,328,333,347,359,379,407,456,463,480,502 | plans.proposePlan；完整 Host／Work Run 提议体；共享构造和真实转交见 tests/helpers/W2-whiteboard-fixture.ts:285、:294、:309 | 非全程公开；请求构造有内部 pin 读取，tests/helpers/W2-whiteboard-fixture.ts:288 | v2 允许 |
| WP1-context-anomalies.test.ts:296；WP1-goal-content-entry.test.ts:56,64,80,82,92,104,118；WP2-context-extensions.test.ts:223,269,298,329；WP2-message-duties.test.ts:49；WP2-undelivered-notices.test.ts:33 | plans.proposePlan；完整夹具／追加任务草稿；追加入口见 tests/helpers/WP1-entry-fixture.ts:303、:310 | 整链未全部闭合 | v2 允许 |
| B2-01-blocked-commands.test.ts:125 | **send_user_message** 参数只有 recipient/text；真实分支要求 goalRef、intent、needsReply 等，src/core/agent-runtime/communication-tools.ts:280；替身用宽松 schema，tests/helpers/K3-tool-seams.ts:136 | 从替身结果继续，B2-01-blocked-commands.test.ts:131 | **F1** |
| R5b-initial-plan.test.ts:190 | **project_source** 的 read 参数包含 action/path/maxBytes/version，符合 src/core/agent-runtime/project-source-tool.ts:119；真实处理见该文件:207 | 工具调用真实；整测试后续未全部闭合 | v2 允许 |
| S2B-r2-s-yielded.test.ts:38 | **send_session_message**；虽先强转，但调用前在该文件:44 补全 recipient，实参满足 src/core/agent-runtime/communication-tools.ts:309 | 后续公开 consultation 和 timeline，S2B-r2-s-yielded.test.ts:59、:79 | v2 允许 |

第二节：A1 平台签发字段

这里的“原样”指字段来自真实步骤返回值，未重新计算；即使重算后字节相等，也不满足 v2 的来源要求（`.lead-ref/books/test-rule-sheet-v2.md:32`）。

| 文件及行号 | owner／字段 | 来源 | 判定 |
|---|---|---|---|
| A1-independent-review.test.ts:83 | sessions.findSessions／cursor | 前页返回，更新在同文件:95 | v2 允许 |
| A1-session-discovery.test.ts:43,192 | sessions.findSessions／cursor | 公开 findTarget 返回，同文件:138、:191 | v2 允许 |
| A1-session-independent.test.ts:147 | sessions.findSessions／cursor | 前页返回，同文件:152 | v2 允许 |
| B2-01-task-read.test.ts:61 | unknownCallReviews.listReviews／cursor | 前页 nextCursor，同文件:67 | v2 允许 |
| B2-09-crr-owner.test.ts:146 | unknownCallReviews.listReviews／cursor | 前页 nextCursor，同文件:150 | v2 允许 |
| C1-session-mailbox.test.ts:411,417,533,535,547 | messages.readInbox／cursor | 公开首读 nextCursor，同文件:408、:532；更换筛选时也未改造游标 | v2 允许 |
| R3c-plan-adoption.test.ts:151 | plans.queryTaskGraph／atLeastCursor | applyPlanChange 返回 cursor，同文件:129 | v2 允许 |
| R3c-plan-adoption.test.ts:225,313 | runtime.startRun／prepared | 真实 preparation.prepare 返回；同文件:221、:309，tests/helpers/task-claim-fixture.ts:601、:606 | v2 允许 |
| R3d-observed-architecture.test.ts:29 | architecture.queryArchitecture／cursor | 公开首读 nextCursor，同文件:27 | v2 允许 |
| R3d-observed-boundaries.test.ts:23,25,27,34 | architecture.queryArchitecture／cursor | 公开首读 nextCursor，同文件:20；改变其他参数时游标原样传入 | v2 允许 |
| R4b-session-boundaries.test.ts:227 | sessions.findSessions／cursor | 前页 nextCursor，同文件:232 | v2 允许 |
| R4b-session-directory.test.ts:220,224 | sessions.findSessions／cursor | 前页 nextCursor，同文件:218 | v2 允许 |
| R4c-execution-read.test.ts:336,484 | executions.readExecution／atLeastCursor | 直接使用真实 claim 结果的 cursor，见这两个调用位置 | v2 允许 |
| R5b-initial-plan.test.ts:245；R5b-query-execution.test.ts:189 | runtime.startQuery／prepared | 分别来自公开 prepareQuery：R5b-initial-plan.test.ts:242、R5b-query-execution.test.ts:183 | v2 允许 |
| S1-session-facts.test.ts:159 | sessionFacts.listSessionExecutions／cursor | 原样传 first.nextCursor，见调用位置 | v2 允许 |
| S2A-notices-counts.test.ts:96；S2A-notices-overbound.test.ts:41；S2A-queue-bounds.test.ts:78 | decisions.queryDecisionQueue／cursor | 各调用直接续用公开前页 nextCursor | v2 允许 |
| S2A-notices-counts.test.ts:109,112；S2A-notices-rework.test.ts:61；S2A-notices-since.test.ts:104 | workspaceDecisionSettings.markNoticesSeen／displayToken、seenThrough | 分别来自同文件公开页 :107、:110／:59／:102；原样转交在 tests/helpers/S2A-notices-support.ts:88 | v2 允许 |
| S2B-30-track-bars.test.ts:140,143；S2B-r2-r3-track-pagination.test.ts:74 | activity.readTrackBars／cursor | 真实 first.next／second.next；后一文件首读在 :66 | v2 允许 |
| S2B-33-task-timeline-pagination.test.ts:30,35,65 | activity.readTaskStateTimeline／cursor | 真实 page1.value.next／page2.value.next，含原样旧游标拒绝 | v2 允许 |
| S2B-r2-activity-run-ended-at.test.ts:83 | runtime.startRun／prepared | runtime.port.prepareExecution 返回，tests/helpers/S2B-be2-reconcile-support.ts:98、:100 | v2 允许 |
| S2C-lines-conversation.test.ts:75,134,154 | lines.readWorkLinePage／cursor | 真实页产生的外层 nextCursor；历史替身另见同文件:32、:72，不因此豁免 F4 | v2 允许 |
| S2C-lines-counts.test.ts:162；S2C-lines-scale.test.ts:73 | lines.listArchivedLines／cursor | 公开前页 nextCursor；前一文件首读在 :159 | v2 允许 |
| S2C-lines-page.test.ts:100,182,214,225,245,251,269 | lines.readWorkLinePage／cursor | 原样续用公开 nextCursor；来源见同文件:112、:119、:195、:200、:216、:233、:246、:264 | v2 允许 |
| S2C-node-detail-bounded.test.ts:125,161,224 | nodeDetail.readNodeDetail／afterCursor | 公开页 nextCursor；续页更新包括同文件:231 | v2 允许 |
| S3-graph-context.test.ts:901,1125,1138 | graph.lookGraph／findGraph／afterCursor | 公开返回值，同文件:899、:1123、:1135 | v2 允许 |
| S5-decision-queue.test.ts:286；S5R2-queue-history.test.ts:233 | decisions.queryDecisionQueue／cursor | 原样续用公开 nextCursor；前一文件来源为 :282、:287 | v2 允许 |
| S5-notices.test.ts:66 | workspaceDecisionSettings.markNoticesSeen／displayToken、seenThrough | 公开 queryDecisionQueue 页，同文件:61；原样调用包括 :173、:192、:215、:259、:269；不含下面单列的 :189 | v2 允许 |
| unknown-call-review-list.test.ts:107,188 | unknownCallReviews.listReviews／cursor | 公开前页 nextCursor，同文件:104、:183 | v2 允许 |
| S5-decision-application.test.ts:53 | decisionMessages.recordDecisionApplication／receipt | 从截获提交重建 identityKey、fingerprint、cursor，同文件:34、:39 | **F1** |
| S2A-queue-card-semantics.test.ts:78 | decisionMessages.recordDecisionApplication／receipt | 从截获提交重建，同文件:60、:63、:79 | **F1** |
| S2C-pins.test.ts:58 | workspaceDecisionSettings.markNoticesSeen／displayToken、seenThrough | 测试构造 position 并自行 issue，同文件:46、:51、:52 | **F1** |
| C1-session-mailbox.test.ts:333 | messages.readInbox／atLeastCursor | 返回游标加 1000 后重造，同文件:332 | **F1** |
| R3c-plan-adoption.test.ts:152 | plans.queryTaskGraph／atLeastCursor | apply 游标加 1000 后重造，同文件:153 | **F1** |
| R4c-execution-read.test.ts:325,339 | executions.readExecution／atLeastCursor | claim 游标加 25 后重造，同文件:324、:338 | **F1** |
| unknown-call-review-list.test.ts:157 | unknownCallReviews.listReviews／cursor | 将手工记录的 refKey 当作 cursor，同文件:152、:154、:159 | **F1** |
| A1-independent-review.test.ts:40 | catalog.reviseArchitectureCatalog／basedOn.digest | 原样使用公开采用结果的 baseline.contentDigest，见该行 | v2 允许 |
| R3b-material-applicability.test.ts:93,95,97,98 | materials.openArtifact／ref.digest | 测试直接调用 RawArtifactBodyStore.put 得到 ref，并非公开材料步骤返回，同文件:65、:69 | **F1** |
| R3c-task-relations.test.ts:128,158 | plans.proposePlan／artifactRef.digest | 同文件:53 手造，:74 放入草稿 | **F1** |
| S3-context-inputs.test.ts:459 | plans.proposePlan／artifactRef.digest | 同文件:116、:119 在测试中计算，:428、:431 放入草稿 | **F1** |
| S3-prepared-context-admission.test.ts:315 | plans.proposePlan／artifactRef.digest | 同文件:91 手造 OLD_A，:313 放入草稿 | **F1** |
| R3e-completion.test.ts:202；S3-context-inputs.test.ts:392；S3-graph-context.test.ts:437 | completionPolicies.activateCompletionPolicy／target.digest | 各行直接取真实 installed.value.contentDigest | v2 允许 |
| R5a-project-bootstrap.test.ts:236,243,266,276,277,306,327,330,332,443,467 | completionPolicies.activateCompletionPolicy／target.digest | 安装返回值原样使用；其中 validTarget 定义在同文件:251 | v2 允许 |
| R5a-project-bootstrap.test.ts:253,256,261 | completionPolicies.activateCompletionPolicy／target.digest | 测试构造 f/a.repeat(64)；对应调用被拒绝 | **F1** |
| R5b-initial-plan.test.ts:169 | completionPolicies.activateCompletionPolicy／target.digest | 真实安装返回值，见该行 | v2 允许 |
| S5-notices.test.ts:189 | workspaceDecisionSettings.markNoticesSeen／seenThrough | 测试自造 pos(12,'r12')，没有原样使用页返回 position；调用被拒绝 | **F1** |
| WP2-undelivered-notices.test.ts:174 | workspaceDecisionSettings.markNoticesSeen／displayToken、seenThrough | f.page 的公开结果；原样转交见 tests/helpers/WP2-notices-fixture.ts:115、:121、:122 | v2 允许 |
| R3d-observed-architecture.test.ts:21,28,104,124,128,173,190 | architecture.queryArchitecture／queryImpact／capture 内的指纹 | 原样使用公开 captureSourceChanges 返回值；同文件:14、:82、:114、:158、:186 | v2 允许 |
| R3d-observed-boundaries.test.ts:16,22,24,26,33,49,57,83,123,203,208,228,233 | architecture.queryArchitecture／queryImpact／capture 内的指纹 | 公开 capture 返回值；同文件:12、:29、:44、:72、:116、:196、:223 | v2 允许 |
| R3d-observed-boundaries.test.ts:104 | architecture.queryArchitecture／sourceDigest、configDigest、material.digest | 同文件:98、:99、:101 改写真实返回值后传入；调用被拒绝 | **F1** |
| R3d-record-integrity.test.ts:192 | architecture.queryArchitecture／capture 内的指纹 | 公开 captureSourceChanges 返回，同文件:165、:191 | v2 允许 |
| S2B-r2-s-yielded.test.ts:39 | completionPolicies.activateCompletionPolicy／target.digest | 场景初始化走公开安装返回值，tests/helpers/AG2b-collaboration-fixture.ts:446、:451 | v2 允许 |
| S2B-30-track-bars.test.ts:18；S2B-31-task-timeline-main.test.ts:21；S2B-32-task-timeline-fold.test.ts:41；S2B-33-task-timeline-pagination.test.ts:21,45,56,70,83,99；S2B-34-executed-files.test.ts:22；S2B-r2-27-moving-window.test.ts:76,94,113,157；S2B-r2-r3-track-pagination.test.ts:23；S2B-r2-r4-bound-workspace.test.ts:27,43；S2B-r2-r5-not-entered.test.ts:19；S2B-r2-r7-keyed-read-cap.test.ts:19,50；S2B-r2-s-preentry-control.test.ts:24；S2B-r3-consultation-cap.test.ts:23；S2B-r4-session-workspace.test.ts:32 | completionPolicies.activateCompletionPolicy／静态策略 target.digest | 初始化进入 tests/helpers/S2B-track-fixture.ts:756 或 tests/helpers/S2B-task-timeline-fixture.ts:700；最终在 tests/helpers/S2B-runtime-steps-fixture.ts:184 重新计算，未使用 :170 安装返回值 | **F1** |
| S2B-activity-calendar-tasks.test.ts:21；S2B-activity-calendar.test.ts:18；S2B-activity-read-faults.test.ts:21；S2B-r2-calendar-boundaries.test.ts:16；S2B-r2-calendar-same-task.test.ts:22；S2B-r2-keyed-cap.test.ts:15；S2B-r2-never-entered.test.ts:17；S2B-r2-workspace-binding.test.ts:24；S2B-r4-session-workspace.test.ts:38；S2B-run-activity-read.test.ts:18 | completionPolicies.activateCompletionPolicy／静态策略 target.digest | 初始化见 tests/helpers/S2B-activity-fixture.ts:567；:401 安装后，:415 重新计算 digest | **F1** |
| A1-architecture-catalog.test.ts:24；A1-catalog-independent.test.ts:23,51；A1-independent-review.test.ts:15；A1-session-discovery.test.ts:24；A1-session-independent.test.ts:14；A1-session-lifecycle.test.ts:29 | completionPolicies.activateCompletionPolicy／target.digest | tests/helpers/graph-session-fixture.ts:325 安装，:333 保存返回值，:336 原样使用 contentDigest | v2 允许 |

第三节：record-store 自身契约

| 实例 | 判定依据 |
|---|---|
| 无 | L7 清单全部属于 tests/work-graph，未包含 tests/record-store；本项限定 L1，不将这些上层测试的旧 F3 重列。见 `.lead-ref/groups/L7-files.txt:1`、`:169`；`.lead-ref/books/test-rule-sheet-v2.md:38`。 |

第四节：A7 三个具名 helper

| helper | L7 使用实例 | 判定 |
|---|---|---|
| buildNoteTools | 本组文件及已追到的 helper 未发现调用；允许范围仅为指定适配器文件，`.lead-ref/books/test-rule-sheet-v2.md:45` | 无实例 |
| damageKernel | 本组文件及已追到的 helper 未发现调用；两个允许文件见 `.lead-ref/books/test-rule-sheet-v2.md:51`、`:52` | 无实例 |
| process-sandbox-standin.ts 的 probe | 本组文件及已追到的 helper 未发现调用；不把其他 sandbox 替身混算成此 helper，具名范围见 `.lead-ref/books/test-rule-sheet-v2.md:58` | 无实例 |

无实例文件，仅指本轮四类，不表示整文件合规：

- A2-step1-codecs.test.ts:1
- B2-07-crr-card-pure.test.ts:16
- B2-11-blocked-commands-bytes-pure.test.ts:10
- B2-11-expansion-levels.test.ts:19
- B2-11-script-expansion.test.ts:16
- B2-12-recognition-pure.test.ts:18
- B2-command-rerun-request-event-pure.test.ts:11
- R3a-goal-replay-boundaries.test.ts:24
- R3c-canonical-task-state.test.ts:8
- R3c-task-graph.test.ts:3
- R3c-task-relations-boundaries.test.ts:20
- goal-independent.test.ts:1
- R3d-fixture.ts:47
- R3g-role-spec.test.ts:54
- R5b-query-job.test.ts:59
- S3-role-profiles.test.ts:122
- material-readers.test.ts:63

JSON 中 `section` 的 1、2 分别对应上面第一、第二节；第三、第四节没有实例。`note` 引用的共同说明及来源均在对应表中。

```json
[
{"section":"1","file":"A1-session-independent.test.ts","line":[26,55,86,117],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具后续含内部步骤"},
{"section":"1","file":"A1-session-lifecycle.test.ts","line":[80,125,272],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具后续含内部步骤"},
{"section":"1","file":"A2-control-service.test.ts","line":[41],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"A2-disposition-change.test.ts","line":[168,487,595,648,655,676,682],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"A2-entry-plan.test.ts","line":[173,195],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"A2-gate-chain-facts.test.ts","line":[44,237],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"A2-goal-control.test.ts","line":[63,101,325],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"A2-requeue-service.test.ts","line":[75],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"A2-step1-manifest.test.ts","line":[18],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"A2-verification-chain.test.ts","line":[61,173,212],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-01-blocked-commands.test.ts","line":[51,95,99,125,159],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"仅此处嵌套计划输入；工具参数另列"},
{"section":"1","file":"B2-01-task-read.test.ts","line":[75],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-03-crr-request.test.ts","line":[79,100,114,124,147,161],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-07-crr-card-closed.test.ts","line":[41,47,64,99],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-07-crr-card.test.ts","line":[41,95,139,177],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-08-crr-answer.test.ts","line":[58,75,89,94],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-08-crr-cancel.test.ts","line":[30,44],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-09-answer-replay.test.ts","line":[29],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-09-crr-owner.test.ts","line":[90,184],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-12-recognition.test.ts","line":[133],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-12-rewrite-prefix.test.ts","line":[105,135,157,173],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-14-crr-forms.test.ts","line":[68,83,100,120,137,153],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-17-disposition-reads.test.ts","line":[37,52],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-18-request-reads.test.ts","line":[101,144],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-UR7-crr-answer.test.ts","line":[120,179],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-execution-entry.test.ts","line":[9],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-execution-result.test.ts","line":[6],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-model-request.test.ts","line":[8],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"C1-session-mailbox.test.ts","line":[21],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"C2-mailbox-admission.test.ts","line":[16],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"R3c-plan-adoption.test.ts","line":[121,182,197,340,346,369,391,424,428],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"后续存在内部读取；见同文件:440"},
{"section":"1","file":"R3c-plan-entry.test.ts","line":[66,74,79],"owner":"plans.proposePlan","value":"结构完整的空计划","verdict":"v2 允许","note":"后续公开重放、采用拒绝、queryGoal；同文件:84、88"},
{"section":"1","file":"R3c-task-relations.test.ts","line":[128,158],"owner":"plans.proposePlan","value":"带自造artifact指纹的草稿","verdict":"F1","note":"结构完整；指纹来源为同文件:53"},
{"section":"1","file":"R3e-completion.test.ts","line":[34,94,232],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"R3e-evidence-coverage.test.ts","line":[26,107],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"R3e-evidence.test.ts","line":[29],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"R3e-reverify.test.ts","line":[93,654],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"R4-control-intent.test.ts","line":[32],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"R4c-execution-history-index.test.ts","line":[64,73,143,1006],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"R4c-execution-read.test.ts","line":[50,98,225,586],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"R4c-source-authority-reader.test.ts","line":[39,129],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"R4c-task-claim-boundaries.test.ts","line":[18,131],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"R4c-task-claim-concurrency.test.ts","line":[50,79,103,125,167,183,193,207],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"R4c-task-claim.test.ts","line":[34,347,368,392,411],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"RL-32b-rework-notice-memory-cap.test.ts","line":[72,142,196,268],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S1-anomaly-owner.test.ts","line":[139,140],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"S1-archive-owner.test.ts","line":[15],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"S1-codecs-indexes.test.ts","line":[83],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"S1-dispatch-guards.test.ts","line":[21],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"S1-provenance.test.ts","line":[68],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"S1-requeue.test.ts","line":[14],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"S1-responsibility.test.ts","line":[132,285],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"S1-session-facts.test.ts","line":[18],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"S1-wait-disposal.test.ts","line":[11],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"S2A-notices-attempt.test.ts","line":[20,23],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2A-notices-counts.test.ts","line":[25,32],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2A-notices-overbound.test.ts","line":[25,27],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2A-notices-rework.test.ts","line":[22],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2A-notices-since.test.ts","line":[59],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2A-notices-workspace.test.ts","line":[22,26,28,49,52,53],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2A-queue-bounds.test.ts","line":[26],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2A-queue-card-semantics.test.ts","line":[23],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2A-queue-derived-cards.test.ts","line":[20],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2A-queue-goal-runs.test.ts","line":[35],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2A-queue-request-candidates.test.ts","line":[31],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2A-queue-window.test.ts","line":[15],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-30-track-bars.test.ts","line":[18],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合；策略指纹另列"},
{"section":"1","file":"S2B-31-task-timeline-main.test.ts","line":[21,23],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-32-task-timeline-fold.test.ts","line":[41,57,77,96,118,138,139,141,143,165,166,168,170,181,182,184,186,188,201,211,230],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-33-task-timeline-pagination.test.ts","line":[21,24,45,48,56,59,63,70,73,83,86,99,102],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-34-executed-files.test.ts","line":[22,221],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-activity-calendar-tasks.test.ts","line":[21],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-activity-calendar.test.ts","line":[18],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-activity-read-faults.test.ts","line":[21],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-27-moving-window.test.ts","line":[76,94,97,113,157,160],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-activity-run-ended-at.test.ts","line":[52],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-calendar-boundaries.test.ts","line":[16],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-calendar-same-task.test.ts","line":[22],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-conflict-catalog.test.ts","line":[40],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-keyed-cap.test.ts","line":[15],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-never-entered.test.ts","line":[17],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-r3-track-pagination.test.ts","line":[23],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-r4-bound-workspace.test.ts","line":[27,43,46],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-r5-not-entered.test.ts","line":[19],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-r7-keyed-read-cap.test.ts","line":[19,50,53],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-s-preentry-control.test.ts","line":[24,27],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-v-real-runs.test.ts","line":[64,96,127,158],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-workspace-binding.test.ts","line":[24],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r3-consultation-cap.test.ts","line":[23],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r4-session-workspace.test.ts","line":[32,38],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-run-activity-read.test.ts","line":[18],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S2B-r2-s-yielded.test.ts","line":[39],"owner":"plans.proposePlan","value":"完整AG2b草稿","verdict":"v2 允许","note":"AG2b-collaboration-fixture.ts:461、464公开提议和采用"},
{"section":"1","file":"S2C-lines-attention.test.ts","line":[24,31,45,75,110,143,164,188,219,239],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-controls.test.ts","line":[33,43,60,74,109,166,185,209,231,252],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-conversation.test.ts","line":[48],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-copies.test.ts","line":[34],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-counts.test.ts","line":[27,34,52,64,78,96],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-d1.test.ts","line":[26,33,59,74,89,101],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-done-evidence.test.ts","line":[33,40,58,68,85,102,120,139,155,167,178,195,241,264,283],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-failure.test.ts","line":[61,124,147,175,188,201],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-identification.test.ts","line":[34,135],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-latest-generation.test.ts","line":[23,30,87],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-names.test.ts","line":[27,43,59,70,80,124],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-page.test.ts","line":[47,91,131,157,179,220],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-paused-continue.test.ts","line":[35,45],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-read-only.test.ts","line":[87,94,127,147,157,170,208,232,255],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线／节点夹具含内部步骤"},
{"section":"1","file":"S2C-lines-scale.test.ts","line":[43],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-task-anchors.test.ts","line":[27,37,58],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-tiers.test.ts","line":[28,43,51,67,129,158,182],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-waiting-reply.test.ts","line":[27,34,49,66,83],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-lines-walk.test.ts","line":[60,68,154],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"工作线夹具含内部步骤"},
{"section":"1","file":"S2C-node-detail-anomalies.test.ts","line":[98,143,163],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"节点夹具含内部步骤"},
{"section":"1","file":"S2C-node-detail-bounded.test.ts","line":[78,99,144,191,210,243],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"节点夹具含内部步骤"},
{"section":"1","file":"S2C-node-detail-executions.test.ts","line":[20],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"节点夹具含内部步骤"},
{"section":"1","file":"S2C-node-detail-hover.test.ts","line":[21,107,125,143,174,185],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"节点夹具含内部步骤"},
{"section":"1","file":"S2C-node-detail-next-kinds.test.ts","line":[130],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"节点夹具含内部步骤"},
{"section":"1","file":"S2C-node-detail-task.test.ts","line":[22,101,125],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"节点夹具含内部步骤"},
{"section":"1","file":"S2C-pins.test.ts","line":[29],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"S3-context-inputs.test.ts","line":[275],"owner":"plans.proposePlan","value":"完整初始草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S3-context-inputs.test.ts","line":[459],"owner":"plans.proposePlan","value":"带自造artifact指纹的草稿","verdict":"F1","note":"同文件:116、119计算材料指纹"},
{"section":"1","file":"S3-graph-context.test.ts","line":[382,464,488,815],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S3-prepared-context-admission.test.ts","line":[225,762],"owner":"plans.proposePlan","value":"完整初始草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S3-prepared-context-admission.test.ts","line":[315],"owner":"plans.proposePlan","value":"带自造artifact指纹的草稿","verdict":"F1","note":"同文件:91手造OLD_A"},
{"section":"1","file":"S5-decision-application.test.ts","line":[27],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S5-decision-queue.test.ts","line":[52,160],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S5-goal-cause-at-least-cursor.test.ts","line":[16],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S5-goal-settings.test.ts","line":[90,183,234],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S5-notices.test.ts","line":[32,139,226,242,284],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S5-request-candidates.test.ts","line":[31,55],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S5-user-messages.test.ts","line":[24],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"S5R2-queue-history.test.ts","line":[22,30,35,47,50,60,63,78,79,95,98,113,171,194],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"UCR-settle-review.test.ts","line":[60],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"unknown-call-review-list.test.ts","line":[40,199,229],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"夹具含内部步骤"},
{"section":"1","file":"W1-future-plan.test.ts","line":[263,340],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"同文件:330有内部读取"},
{"section":"1","file":"W2-agent-whiteboard.test.ts","line":[39,125,140,161,174,224,234,254,266,283,294,298,304,309,333,352,368,376,412,446,498,510],"owner":"plans.proposePlan","value":"完整提议体","verdict":"v2 允许","note":"请求helper含内部pin读取；见第一表"},
{"section":"1","file":"W2-future-intent.test.ts","line":[108,116,137,147,167,195,201,328,333,347,359,379,407,456,463,480,502],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"请求helper含内部步骤；见第一表"},
{"section":"1","file":"WP1-context-anomalies.test.ts","line":[296],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"WP1-goal-content-entry.test.ts","line":[56,64,80,82,92,104,118],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"WP2-context-extensions.test.ts","line":[223,269,298,329],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"WP2-message-duties.test.ts","line":[49],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"WP2-undelivered-notices.test.ts","line":[33],"owner":"plans.proposePlan","value":"完整草稿","verdict":"v2 允许","note":"整条后续链未全部闭合"},
{"section":"1","file":"B2-01-blocked-commands.test.ts","line":[125],"owner":"send_user_message","value":"工具参数","verdict":"F1","note":"缺真实分支必填字段；K3-tool-seams.ts:136宽松替身接收"},
{"section":"1","file":"R5b-initial-plan.test.ts","line":[190],"owner":"project_source","value":"read工具参数","verdict":"v2 允许","note":"满足project-source-tool.ts:119完整契约"},
{"section":"1","file":"S2B-r2-s-yielded.test.ts","line":[38],"owner":"send_session_message","value":"工具参数","verdict":"v2 允许","note":"同文件:44在调用前补全recipient；随后走公开步骤"},

{"section":"2","file":"A1-independent-review.test.ts","line":[83],"owner":"sessions.findSessions","value":"cursor","verdict":"v2 允许","note":"前页返回原样续用；同文件:95"},
{"section":"2","file":"A1-session-discovery.test.ts","line":[43,192],"owner":"sessions.findSessions","value":"cursor","verdict":"v2 允许","note":"公开返回原样续用；同文件:138、191"},
{"section":"2","file":"A1-session-independent.test.ts","line":[147],"owner":"sessions.findSessions","value":"cursor","verdict":"v2 允许","note":"前页返回原样续用；同文件:152"},
{"section":"2","file":"B2-01-task-read.test.ts","line":[61],"owner":"unknownCallReviews.listReviews","value":"cursor","verdict":"v2 允许","note":"前页nextCursor；同文件:67"},
{"section":"2","file":"B2-09-crr-owner.test.ts","line":[146],"owner":"unknownCallReviews.listReviews","value":"cursor","verdict":"v2 允许","note":"前页nextCursor；同文件:150"},
{"section":"2","file":"C1-session-mailbox.test.ts","line":[411,417,533,535,547],"owner":"messages.readInbox","value":"cursor","verdict":"v2 允许","note":"首读nextCursor；同文件:408、532"},
{"section":"2","file":"R3c-plan-adoption.test.ts","line":[151],"owner":"plans.queryTaskGraph","value":"atLeastCursor","verdict":"v2 允许","note":"apply返回cursor；同文件:129"},
{"section":"2","file":"R3c-plan-adoption.test.ts","line":[225,313],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"真实prepare返回；task-claim-fixture.ts:601、606"},
{"section":"2","file":"R3d-observed-architecture.test.ts","line":[29],"owner":"architecture.queryArchitecture","value":"cursor","verdict":"v2 允许","note":"前页nextCursor；同文件:27"},
{"section":"2","file":"R3d-observed-boundaries.test.ts","line":[23,25,27,34],"owner":"architecture.queryArchitecture","value":"cursor","verdict":"v2 允许","note":"前页nextCursor；同文件:20"},
{"section":"2","file":"R4b-session-boundaries.test.ts","line":[227],"owner":"sessions.findSessions","value":"cursor","verdict":"v2 允许","note":"前页nextCursor；同文件:232"},
{"section":"2","file":"R4b-session-directory.test.ts","line":[220,224],"owner":"sessions.findSessions","value":"cursor","verdict":"v2 允许","note":"前页nextCursor；同文件:218"},
{"section":"2","file":"R4c-execution-read.test.ts","line":[336,484],"owner":"executions.readExecution","value":"atLeastCursor","verdict":"v2 允许","note":"直接使用真实claim返回cursor"},
{"section":"2","file":"R5b-initial-plan.test.ts","line":[245],"owner":"runtime.startQuery","value":"prepared","verdict":"v2 允许","note":"prepareQuery返回；同文件:242"},
{"section":"2","file":"R5b-query-execution.test.ts","line":[189],"owner":"runtime.startQuery","value":"prepared","verdict":"v2 允许","note":"prepareQuery返回；同文件:183"},
{"section":"2","file":"S1-session-facts.test.ts","line":[159],"owner":"sessionFacts.listSessionExecutions","value":"cursor","verdict":"v2 允许","note":"公开first.nextCursor原样续用"},
{"section":"2","file":"S2A-notices-counts.test.ts","line":[96],"owner":"decisions.queryDecisionQueue","value":"cursor","verdict":"v2 允许","note":"公开前页nextCursor原样续用"},
{"section":"2","file":"S2A-notices-counts.test.ts","line":[109,112],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"公开页返回；同文件:107、110"},
{"section":"2","file":"S2A-notices-overbound.test.ts","line":[41],"owner":"decisions.queryDecisionQueue","value":"cursor","verdict":"v2 允许","note":"公开前页nextCursor原样续用"},
{"section":"2","file":"S2A-notices-rework.test.ts","line":[61],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"公开页返回；同文件:59"},
{"section":"2","file":"S2A-notices-since.test.ts","line":[104],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"公开页返回；同文件:102"},
{"section":"2","file":"S2A-queue-bounds.test.ts","line":[78],"owner":"decisions.queryDecisionQueue","value":"cursor","verdict":"v2 允许","note":"公开前页nextCursor原样续用"},
{"section":"2","file":"S2B-30-track-bars.test.ts","line":[140,143],"owner":"activity.readTrackBars","value":"cursor","verdict":"v2 允许","note":"first.next/second.next原样续用"},
{"section":"2","file":"S2B-33-task-timeline-pagination.test.ts","line":[30,35,65],"owner":"activity.readTaskStateTimeline","value":"cursor","verdict":"v2 允许","note":"公开前页next原样续用"},
{"section":"2","file":"S2B-r2-activity-run-ended-at.test.ts","line":[83],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"prepareExecution原样返回；S2B-be2-reconcile-support.ts:98、100"},
{"section":"2","file":"S2B-r2-r3-track-pagination.test.ts","line":[74],"owner":"activity.readTrackBars","value":"cursor","verdict":"v2 允许","note":"first.next原样续用；同文件:66"},
{"section":"2","file":"S2C-lines-conversation.test.ts","line":[75,134,154],"owner":"lines.readWorkLinePage","value":"cursor","verdict":"v2 允许","note":"真实页签发外层游标；历史替身不因此获豁免"},
{"section":"2","file":"S2C-lines-counts.test.ts","line":[162],"owner":"lines.listArchivedLines","value":"cursor","verdict":"v2 允许","note":"first.nextCursor；同文件:159"},
{"section":"2","file":"S2C-lines-page.test.ts","line":[100,182,214,225,245,251,269],"owner":"lines.readWorkLinePage","value":"cursor","verdict":"v2 允许","note":"公开页nextCursor原样续用；来源见第二表"},
{"section":"2","file":"S2C-lines-scale.test.ts","line":[73],"owner":"lines.listArchivedLines","value":"cursor","verdict":"v2 允许","note":"公开前页nextCursor原样续用"},
{"section":"2","file":"S2C-node-detail-bounded.test.ts","line":[125,161,224],"owner":"nodeDetail.readNodeDetail","value":"afterCursor","verdict":"v2 允许","note":"公开前页nextCursor原样续用"},
{"section":"2","file":"S3-graph-context.test.ts","line":[901,1125,1138],"owner":"graph.lookGraph/findGraph","value":"afterCursor","verdict":"v2 允许","note":"公开返回；同文件:899、1123、1135"},
{"section":"2","file":"S5-decision-queue.test.ts","line":[286],"owner":"decisions.queryDecisionQueue","value":"cursor","verdict":"v2 允许","note":"公开前页nextCursor；同文件:282、287"},
{"section":"2","file":"S5-notices.test.ts","line":[66],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"仅指公开页原样值；不包括同文件:189"},
{"section":"2","file":"S5R2-queue-history.test.ts","line":[233],"owner":"decisions.queryDecisionQueue","value":"cursor","verdict":"v2 允许","note":"公开前页nextCursor原样续用"},
{"section":"2","file":"unknown-call-review-list.test.ts","line":[107,188],"owner":"unknownCallReviews.listReviews","value":"cursor","verdict":"v2 允许","note":"公开前页nextCursor；同文件:104、183"},
{"section":"2","file":"S5-decision-application.test.ts","line":[53],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"从截获提交重建；同文件:34、39"},
{"section":"2","file":"S2A-queue-card-semantics.test.ts","line":[78],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"从截获提交重建；同文件:60、63、79"},
{"section":"2","file":"S2C-pins.test.ts","line":[58],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"F1","note":"测试构造position并issue；同文件:46、51、52"},
{"section":"2","file":"C1-session-mailbox.test.ts","line":[333],"owner":"messages.readInbox","value":"atLeastCursor","verdict":"F1","note":"原游标加1000重造；同文件:332"},
{"section":"2","file":"R3c-plan-adoption.test.ts","line":[152],"owner":"plans.queryTaskGraph","value":"atLeastCursor","verdict":"F1","note":"apply游标加1000重造；同文件:153"},
{"section":"2","file":"R4c-execution-read.test.ts","line":[325,339],"owner":"executions.readExecution","value":"atLeastCursor","verdict":"F1","note":"claim游标加25重造；同文件:324、338"},
{"section":"2","file":"unknown-call-review-list.test.ts","line":[157],"owner":"unknownCallReviews.listReviews","value":"cursor","verdict":"F1","note":"手工记录refKey充当游标；同文件:152、154、159"},
{"section":"2","file":"A1-independent-review.test.ts","line":[40],"owner":"catalog.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"公开采用结果baseline.contentDigest原样使用"},
{"section":"2","file":"R3b-material-applicability.test.ts","line":[93,95,97,98],"owner":"materials.openArtifact","value":"ref.digest","verdict":"F1","note":"直接由内部body store产生；同文件:65、69"},
{"section":"2","file":"R3c-task-relations.test.ts","line":[128,158],"owner":"plans.proposePlan","value":"artifactRef.digest","verdict":"F1","note":"同文件:53手造；:74放入草稿"},
{"section":"2","file":"S3-context-inputs.test.ts","line":[459],"owner":"plans.proposePlan","value":"artifactRef.digest","verdict":"F1","note":"同文件:116、119测试计算"},
{"section":"2","file":"S3-prepared-context-admission.test.ts","line":[315],"owner":"plans.proposePlan","value":"artifactRef.digest","verdict":"F1","note":"同文件:91手造；:313放入草稿"},
{"section":"2","file":"R3e-completion.test.ts","line":[202],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"真实installed.value.contentDigest原样使用"},
{"section":"2","file":"S3-context-inputs.test.ts","line":[392],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"真实installed.value.contentDigest原样使用"},
{"section":"2","file":"S3-graph-context.test.ts","line":[437],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"真实installed.value.contentDigest原样使用"},
{"section":"2","file":"R5a-project-bootstrap.test.ts","line":[236,243,266,276,277,306,327,330,332,443,467],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"公开安装返回值原样使用；validTarget在同文件:251"},
{"section":"2","file":"R5a-project-bootstrap.test.ts","line":[253,256,261],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"F1","note":"测试构造f/a.repeat(64)；对应调用被拒绝"},
{"section":"2","file":"R5b-initial-plan.test.ts","line":[169],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"真实安装返回值原样使用"},
{"section":"2","file":"S5-notices.test.ts","line":[189],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"seenThrough","verdict":"F1","note":"测试自造pos(12,'r12')；调用被拒绝"},
{"section":"2","file":"WP2-undelivered-notices.test.ts","line":[174],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"公开页原样返回；WP2-notices-fixture.ts:115、121、122"},
{"section":"2","file":"R3d-observed-architecture.test.ts","line":[21,28,104,124,128,173,190],"owner":"architecture.queryArchitecture/queryImpact","value":"selection.capture内的指纹","verdict":"v2 允许","note":"公开capture原样使用；来源见第二表"},
{"section":"2","file":"R3d-observed-boundaries.test.ts","line":[16,22,24,26,33,49,57,83,123,203,208,228,233],"owner":"architecture.queryArchitecture/queryImpact","value":"selection.capture内的指纹","verdict":"v2 允许","note":"公开capture原样使用；来源见第二表"},
{"section":"2","file":"R3d-observed-boundaries.test.ts","line":[104],"owner":"architecture.queryArchitecture","value":"sourceDigest/configDigest/material.digest","verdict":"F1","note":"同文件:98、99、101改写真实返回值"},
{"section":"2","file":"R3d-record-integrity.test.ts","line":[192],"owner":"architecture.queryArchitecture","value":"selection.capture内的指纹","verdict":"v2 允许","note":"公开capture返回；同文件:165、191"},
{"section":"2","file":"S2B-r2-s-yielded.test.ts","line":[39],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"AG2b-collaboration-fixture.ts:446、451原样使用安装返回值"},
{"section":"2","file":"S2B-30-track-bars.test.ts","line":[18],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-runtime-steps-fixture.ts:184重新计算"},
{"section":"2","file":"S2B-31-task-timeline-main.test.ts","line":[21],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-runtime-steps-fixture.ts:184重新计算"},
{"section":"2","file":"S2B-32-task-timeline-fold.test.ts","line":[41],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-runtime-steps-fixture.ts:184重新计算"},
{"section":"2","file":"S2B-33-task-timeline-pagination.test.ts","line":[21,45,56,70,83,99],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-runtime-steps-fixture.ts:184重新计算"},
{"section":"2","file":"S2B-34-executed-files.test.ts","line":[22],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-runtime-steps-fixture.ts:184重新计算"},
{"section":"2","file":"S2B-activity-calendar-tasks.test.ts","line":[21],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-activity-fixture.ts:415重新计算"},
{"section":"2","file":"S2B-activity-calendar.test.ts","line":[18],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-activity-fixture.ts:415重新计算"},
{"section":"2","file":"S2B-activity-read-faults.test.ts","line":[21],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-activity-fixture.ts:415重新计算"},
{"section":"2","file":"S2B-r2-27-moving-window.test.ts","line":[76,94,113,157],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-runtime-steps-fixture.ts:184重新计算"},
{"section":"2","file":"S2B-r2-calendar-boundaries.test.ts","line":[16],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-activity-fixture.ts:415重新计算"},
{"section":"2","file":"S2B-r2-calendar-same-task.test.ts","line":[22],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"经日历夹具到S2B-activity-fixture.ts:415重算"},
{"section":"2","file":"S2B-r2-keyed-cap.test.ts","line":[15],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-activity-fixture.ts:415重新计算"},
{"section":"2","file":"S2B-r2-never-entered.test.ts","line":[17],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-activity-fixture.ts:415重新计算"},
{"section":"2","file":"S2B-r2-r3-track-pagination.test.ts","line":[23],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-runtime-steps-fixture.ts:184重新计算"},
{"section":"2","file":"S2B-r2-r4-bound-workspace.test.ts","line":[27,43],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-runtime-steps-fixture.ts:184重新计算"},
{"section":"2","file":"S2B-r2-r5-not-entered.test.ts","line":[19],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-runtime-steps-fixture.ts:184重新计算"},
{"section":"2","file":"S2B-r2-r7-keyed-read-cap.test.ts","line":[19,50],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-runtime-steps-fixture.ts:184重新计算"},
{"section":"2","file":"S2B-r2-s-preentry-control.test.ts","line":[24],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"经时间线夹具到S2B-runtime-steps-fixture.ts:184重算"},
{"section":"2","file":"S2B-r2-workspace-binding.test.ts","line":[24],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-activity-fixture.ts:415重新计算"},
{"section":"2","file":"S2B-r3-consultation-cap.test.ts","line":[23],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-runtime-steps-fixture.ts:184重新计算"},
{"section":"2","file":"S2B-r4-session-workspace.test.ts","line":[32,38],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"分别在S2B-runtime-steps-fixture.ts:184、S2B-activity-fixture.ts:415重算"},
{"section":"2","file":"S2B-run-activity-read.test.ts","line":[18],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"S2B-activity-fixture.ts:415重新计算"},
{"section":"2","file":"A1-architecture-catalog.test.ts","line":[24],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"graph-session-fixture.ts:325、333、336原样使用安装结果"},
{"section":"2","file":"A1-catalog-independent.test.ts","line":[23,51],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"graph-session-fixture.ts:325、333、336原样使用安装结果"},
{"section":"2","file":"A1-independent-review.test.ts","line":[15],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"graph-session-fixture.ts:325、333、336原样使用安装结果"},
{"section":"2","file":"A1-session-discovery.test.ts","line":[24],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"graph-session-fixture.ts:325、333、336原样使用安装结果"},
{"section":"2","file":"A1-session-independent.test.ts","line":[14],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"graph-session-fixture.ts:325、333、336原样使用安装结果"},
{"section":"2","file":"A1-session-lifecycle.test.ts","line":[29],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"graph-session-fixture.ts:325、333、336原样使用安装结果"}
]
```

缺口是：其他夹具初始策略 digest 尚未全部映射回 L7 调用点，例如 `tests/helpers/task-claim-fixture.ts:259`；嵌套运行 helper 的 prepared 尚未全部映射，例如 `tests/helpers/S2B-runtime-steps-fixture.ts:357`、`tests/helpers/K3-proposal-round.ts:436`；工具参数尚未穷尽，例如 `tests/helpers/B2-crr-world.ts:309`；角色 pin 来源及第一表标注的后续公开链尚未全部闭合，例如 `R4c-task-claim-boundaries.test.ts:66`、`:67`。这些缺口没有计入上面的判定数量。

v2 允许 563，F1 59，F3 0，A7 越界 0，文件 169/169；枚举不完整：未穷尽跨文件夹具的签发字段和工具参数，部分后续公开调用链及角色 pin 来源未闭合。