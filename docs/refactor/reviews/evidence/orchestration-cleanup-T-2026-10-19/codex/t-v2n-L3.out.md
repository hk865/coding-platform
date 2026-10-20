本次按“节＋组内静态调用位置”计数：同一位置有多个字段只计一次，存在 F1 时按 F1 计；跨节分别计数。`v2 允许`只判断所列输入，不代表整项测试通过其他规则。完整参数合同、签发字段来源和 A7 范围分别依据 `.lead-ref/books/test-rule-sheet-v2.md:30`、`:32`、`:44`。

为缩短重复路径，表内 `B/`、`R/`、`K/` 分别表示 `tests/business/`、`tests/runtime/`、`tests/kernel/`；JSON 使用完整路径。

第一节使用以下证据缩写：

- **P**：组外 helper 构造完整计划草稿，交给 `plans.proposePlan`，检查提议结果，再公开采用。共同底层见 `tests/helpers/task-claim-fixture.ts:323`、`:344`、`:350`；S5 分支见 `tests/helpers/S5-decision-fixture.ts:737`；K3 扩展见 `tests/helpers/K3-review-card-fixture.ts:108`、`:122`、`:128`；注记夹具分支见 `tests/helpers/S4A-note-fixture.ts:204`、`:222`、`:225`。采用后的夹具并非全程公开，例如 `tests/helpers/task-claim-fixture.ts:367`。这些后续问题不在本次另列 F3。
- **H**：Host 场景内完整计划草稿，经真实提议、采用；入口见 `tests/helpers/AG2b-collaboration-fixture.ts:434`、`tests/scenarios/harness.ts:1020`。
- **T**：完整工具参数；表中另外说明真实 owner 或录制替身，以及后续路径。替身不会获得 F4 豁免，依据 `.lead-ref/books/test-rule-sheet-v2.md:31`。

**1．A1 草稿与外来对象**

| 位置 | owner、合同及后续路径 | 裁定 |
|---|---|---|
| B/K3-15-ur3h.test.ts:95 | P | v2 允许 |
| B/K3-17-goal-guard.test.ts:87 | P | v2 允许 |
| B/K3-41-release-hold.test.ts:143,382,508 | 143、382 为 H；508 为 P；场景后续含内部不变量检查 | v2 允许 |
| B/K3-44-crr-recovery.test.ts:152,194 | P | v2 允许 |
| B/K3-46-review-advance-failures.test.ts:143,418,450,475,503,526,627,661,690 | 143：完整草稿在本文件:133构造，:149公开采用；其余 P；后续含:269存储包装 | v2 允许 |
| B/K3-UR7-crr-failed-set.test.ts:338,352,398,445,464,541 | 338：:328完整草稿，:344公开采用；其余 P；另有:301内部读取 | v2 允许 |
| B/K3-review-workflow-rows.test.ts:155,208,368,956,1185,1205,1232 | 368 为 `propose_safer_method`，完整参数来自 `tests/helpers/K3-proposal-round.ts:757`、`:760`；其余 P；后续混合内部读取 | v2 允许 |
| B/R5c-workflow.test.ts:93,135,155 | 93、135 为 P；155 的完整草稿见:148，:161采用，:168公开 advance | v2 允许 |
| B/S1-archive-flow.test.ts:202 | P | v2 允许 |
| B/S1-session-maintenance.test.ts:206,296 | 206 为 P；296 的草稿见:184、:292，:303采用；后续:454直接操作 Kernel | v2 允许 |
| B/S5-decision-workflow.test.ts:186,224 | P | v2 允许 |
| B/S5R2-automation-cards.test.ts:24,134,153 | 24 为 P；134、153 经 `gateHead` 完整提议、采用，见 `tests/helpers/S5R2-b-support.ts:237`、`:253`、`:260`；后续含存储观察 | v2 允许 |
| B/S5R2-settings-replay.test.ts:28,29,246 | 28、29 为 P；246 的草稿及采用见 `tests/helpers/S5R2-c-support.ts:269`、`:279`、`:284`；后续含内部观察 | v2 允许 |
| B/WP1-continuation-handover.test.ts:87,119,164,216,242,273,288,317,346,357,366,376,423,477,498,510,526 | P，组外入口汇入 `tests/helpers/WP1-handover-fixture.ts:233` | v2 允许 |
| R/A2-reconcile-runtime.test.ts:58,78 | P | v2 允许 |
| R/B2-01-shell-hook.test.ts:35 | P | v2 允许 |
| R/B2-02-approved-method.test.ts:45,63 | 45 为 P；63 为真实 `propose_safer_method`，参数见 `tests/helpers/K3-proposal-round.ts:757`、`:760`，随后公开读回 | v2 允许 |
| R/B2-02-recognition-unified.test.ts:82,140 | P | v2 允许 |
| R/B2-03-request-tool.test.ts:26,60,74,75,84,89,98,107,118 | 26 为 P；其余为真实 `request_command_rerun` 完整参数，工具桥见 `tests/helpers/B2-blocked-runtime.ts:417`、`:424`；随后公开列表、卡片读取 | v2 允许 |
| R/B2-04-allowance.test.ts:30,43,74 | 30 为 P；43、74 为完整 rerun 工具参数；后续混用 hook，工具桥同上 | v2 允许 |
| R/B2-05-06-denial.test.ts:30,58,67,80,88 | 30 为 P；其余完整 rerun 工具参数；后续混用 hook | v2 允许 |
| R/B2-09-allowance-crash.test.ts:42,47,66,72 | 42、66 为 P；47、72 为完整 rerun 工具参数；后续混用 hook | v2 允许 |
| R/B2-13-allow-one-form.test.ts:30,35 | 30 为 P；35 为完整 rerun 工具参数；后续混用 hook | v2 允许 |
| R/B2-15-replay.test.ts:121,165 | P | v2 允许 |
| R/B2-16-hook-closure.test.ts:50,63,92,106 | 50、92、106 为 P；63 为完整 rerun 工具参数；后续混用 hook | v2 允许 |
| R/B2-16-hook-reads.test.ts:71 | P | v2 允许 |
| R/B2-401-world.test.ts:48 | P | v2 允许 |
| R/B2-runtime-execution.test.ts:36 | P | v2 允许 |
| R/C1-communication-tools.test.ts:153,163,164,172,177,231,244,252,258,263,267,271 | 231 为 P；其余为完整邮箱工具参数。153—177 使用:70、:77、:81录制端口；244—271 接真实 owner，随后公开调用 | v2 允许 |
| R/C2-runtime-platform-tools.test.ts:116,120,138,187,212,237 | 116、120 为完整邮箱工具参数，但:103替身返回固定结果，随后只作适配器断言；其余 P | v2 允许 |
| R/K-readonly-command.test.ts:543,633,650,675,702,763,777,801 | 633、650 为 H，随后公开 driver；其余 P | v2 允许 |
| R/K3-12-review-round-tools.test.ts:130,230 | 130 为 P；230 为 `run_readonly_command`，:231虽强转但 `{command}` 完整；:221沙箱替身，随后结果断言 | v2 允许 |
| R/K3-14-record-unknown-call-review-tool.test.ts:202 | P | v2 允许 |
| R/K3-19-review-admission.test.ts:127,159,246,255,258 | 159 的 helper 调用真实 `propose_safer_method`，见 `tests/helpers/K3-proposal-round.ts:757`、`:760`、`:889`；其余 P | v2 允许 |
| R/K3-19-review-capability.test.ts:50,116 | P | v2 允许 |
| R/K3-24-unknown-outcome-stability.test.ts:57,75 | P | v2 允许 |
| R/K3-35-T-by-hand.test.ts:102,155 | P；额外长任务草稿完整，见 `tests/helpers/K3-proposal-round.ts:186`、`:203`、`:211` | v2 允许 |
| R/K3-35-approved-methods-brief.test.ts:84 | P | v2 允许 |
| R/K3-35-review-input-size.test.ts:128 | H；后续公开 Workflow、材料读取 | v2 允许 |
| R/K3-35-workspace-baseline-prepare.test.ts:34 | P | v2 允许 |
| R/K3-B3-cancellation-cancelled.test.ts:92,148 | P | v2 允许 |
| R/K3-B3-newest-request-order.test.ts:71 | P | v2 允许 |
| R/K3-merge-cancel-propagation.test.ts:59 | P | v2 允许 |
| R/K3-review-preparation.test.ts:169,215,254,355 | P | v2 允许 |
| R/R2e-git-source-loop.test.ts:45,141 | P | v2 允许 |
| R/R4-control-runtime.test.ts:45,58 | P | v2 允许 |
| R/R4c-graph-history.test.ts:76 | P | v2 允许 |
| R/R4c-source-authority-guards.test.ts:284 | P | v2 允许 |
| R/RL-30-shell-resource-caps.test.ts:36 | P | v2 允许 |
| R/RL-31-readonly-resource-caps.test.ts:226 | P | v2 允许 |
| R/RL-32-check-resource-caps.test.ts:43 | P | v2 允许 |
| R/RL-35-36-sandbox-and-retry.test.ts:40,46,58 | P | v2 允许 |
| R/S1-archive-cancelled-reader.test.ts:40 | P | v2 允许 |
| R/S1-archive-files-brief.test.ts:30 | P | v2 允许 |
| R/S1-routed-replies.test.ts:39 | P | v2 允许 |
| R/S2B-15-end-retry-activity.test.ts:33 | P | v2 允许 |
| R/S2B-36-observer-cancel-reread.test.ts:46 | P | v2 允许 |
| R/S2B-37-observer-reread-failure.test.ts:42 | P | v2 允许 |
| R/S2B-38-run08-unknown-activity.test.ts:124,163,230 | P | v2 允许 |
| R/S2B-44-backfill-late-evidence-race.test.ts:91 | P | v2 允许 |
| R/S2B-45-inprocess-run21-activity.test.ts:74 | P | v2 允许 |
| R/S2B-r2-run08-current-revision.test.ts:92 | P | v2 允许 |
| R/S3-graph-tools.test.ts:390,404,407,409,457,643,686,699,705,714,728,781,1101 | 1101 为 H；其余完整 `look_graph/find_graph` 参数。录制端口见:163；:781可接真实 input owner；随后包括适配器断言 | v2 允许 |
| R/S4C-note-related-find.test.ts:26,28,29,41,65,82 | 41、65、82 为 P；其余 `notes.writeNote` 的完整 `NoteDraftV1`，构造见:15，传入见 `tests/helpers/S4A-note-fixture.ts:282`；后续:46、:55、:70公开查询 | v2 允许 |
| R/S4C2-assembly.test.ts:189,227,254,283,291,307,329,372,407,420 | 189、291、307 为完整注记草稿，构造见:173、:179、:184；其余 P；后续:202直接读正文存储 | v2 允许 |
| R/S5-user-message-tools.test.ts:34,98,234 | 34 为 P；98、234 为完整决策工具参数，见 `tests/helpers/S5-user-message-support.ts:82`；后续:113存储观察 | v2 允许 |
| R/S5R2-agent-application.test.ts:67,143,198,310,335 | 67 为 P；143、198、335 为完整计划工具参数，草稿见:50；310 为完整 `read_user_decision` 参数；后续:187、:313内部观察 | v2 允许 |
| R/S4C-note-tools.test.ts:125,152,166,178,189,197,207,241 | 完整 `record_note` 分支参数；:67录制适配器；后续只检查映射、默认值、结果透传 | v2 允许 |
| R/W2-whiteboard-tools.test.ts:245,246,247,279,300,308,349 | 完整查询、采用工具参数，构造见:59、:67、:307；:117、:123、:125录制替身；后续录制断言 | v2 允许 |
| R/orchestration-boundaries.test.ts:130 | P | v2 允许 |
| R/source-binding-migration.test.ts:162 | P | v2 允许 |
| R/source-tool-lifecycle.test.ts:275,314,337 | 完整 source 工具参数，见:274、:307、:331；275 为取消分支，314、337检查真实文件结果 | v2 允许 |
| B/A2-workflow-result-mapping.test.ts:84,100,110 | `workflow.advanceWork`；:71—73强转只有 `meta` 的 start/observe/finalize 请求；:62、:63、:65替身忽略请求；后续非真实分支 | F1：不满足完整合同 |
| B/K3-review-workflow-rows.test.ts:869,887,926 | `workflow.advanceWork`；:810—813只有 `meta`，:803、:804替身忽略 start/observe 请求 | F1：不满足完整合同 |
| R/W2-whiteboard-tools.test.ts:268,322,338,396 | `propose_future_plan`；草稿见:80，artifact 指纹在:94手造；:117—123录制替身；随后只查录制值 | F1：签发字段非法 |
| R/S3-graph-tools.test.ts:955 | `plans.proposePlan`；:810、:813自算并组装 artifact，:952装入草稿；后续:978直接写 Run | F1：签发字段非法 |
| R/S3-graph-tools.test.ts:702,718,721 | `look_graph/find_graph`；:703、:719、:722手写分页 cursor，交录制端口 | F1：签发字段非法 |
| R/K3-14-record-unknown-call-review-tool.test.ts:94,113,119,128 | `record_unknown_call_review`；:81、:128手写 item 编号，交:65录制端口 | F1：签发字段非法 |
| R/K3-16-proposal-tool.test.ts:103,120,136,143,151,155 | `propose_safer_method`；:68、:120手写 item 编号，交:43录制端口 | F1：签发字段非法 |
| R/B2-03-request-tool.test.ts:120 | `request_command_rerun`；:122手写 `rewriteOf.alias` | F1：签发字段非法 |

**2．A1 平台签发字段**

下面 **D** 表示 `completionPolicies.activateCompletionPolicy` 的 `target.digest`：真实 install 返回后原样使用，证据为 `tests/helpers/task-claim-fixture.ts:252`、`:259`，`tests/helpers/S5-decision-fixture.ts:638`、`:647`，`tests/helpers/S4A-note-fixture.ts:182`、`:190`。**第一表所有标 P 的调用位置同时都是 D 实例**，逐文件位置在 JSON 第二节完整展开。

下面 **Q** 表示交给 Runtime/Workflow 启动分支的 `prepared`，均使用真实准备步骤返回值。组外链证据：`tests/helpers/K3-35-continuation-fixture.ts:481`、`:491`、`:501`，`tests/helpers/K3-proposal-round.ts:434`、`:436`，`tests/helpers/K3-blocked-command-fixture.ts:340`；其他启动夹具见 `tests/helpers/S2B-runtime-steps-fixture.ts:348`、`:357`，`tests/helpers/S2B-be1-platform-fixture.ts:303`、`:305`，`tests/helpers/RL-query-fixture.ts:165`、`:169`，`tests/helpers/S1-runtime-scenario-fixture.ts:251`、`:257`。

| 位置 | 字段、来源及接收方 | 裁定 |
|---|---|---|
| 第一表全部 P 位置，逐项见 JSON 第二节 D 行号 | D，真实安装返回指纹原样激活 | v2 允许 |
| B/K3-15-ur3h.test.ts:206,248,271,316,360 | Q；271 的值由:267公开 Workflow 返回 | v2 允许 |
| B/K3-17-goal-guard.test.ts:89 | Q | v2 允许 |
| B/K3-41-release-hold.test.ts:109,539 | Q；109 的值来自:107、:108 | v2 允许 |
| B/K3-44-crr-recovery.test.ts:101 | Q | v2 允许 |
| B/K3-46-review-advance-failures.test.ts:420,452,477,505,528,529,629,663,692,693 | Q | v2 允许 |
| B/K3-UR7-crr-failed-set.test.ts:354,360,400,401,407,447,466,469 | Q | v2 允许 |
| B/K3-review-workflow-rows.test.ts:210,367,416,465,477,862,881 | Q | v2 允许 |
| B/K3-review-workflow-rows.test.ts:368,385 | 368 的 `item` 来自公开 review，见 `tests/helpers/K3-proposal-round.ts:752`、`:757`；385 的分页 cursor 来自同 helper:626、:639 | v2 允许 |
| B/R5b-initial-planning-workflow.test.ts:188,220 | 188 的 digest 来自:180安装返回，:190原样传入；220 的 prepared 来自:217 | v2 允许 |
| R/A2-reconcile-runtime.test.ts:205,219,233,253,279,342,375,413,420,426,441,490,530,578,723,992,1096 | Q；共用准备函数见:193，992 的准备见:989 | v2 允许 |
| R/B2-01-shell-hook.test.ts:35 | Q；helper 分页 cursor 亦由真实 `listReviews` 返回，见 `tests/helpers/B2-blocked-runtime.ts:281`、`:287` | v2 允许 |
| R/B2-02-approved-method.test.ts:48,62,63 | 48、62 为 Q；63 的 item 原样取公开 review，见 `tests/helpers/K3-proposal-round.ts:752`、`:757` | v2 允许 |
| R/B2-02-recognition-unified.test.ts:84,144,150 | Q | v2 允许 |
| R/B2-03-request-tool.test.ts:26 | Q；helper 的公开分页 cursor 原样续读 | v2 允许 |
| R/B2-04-allowance.test.ts:30 | Q；helper 的公开分页 cursor 原样续读 | v2 允许 |
| R/B2-05-06-denial.test.ts:30 | Q；helper 的公开分页 cursor 原样续读 | v2 允许 |
| R/B2-09-allowance-crash.test.ts:42,66 | Q；helper 的公开分页 cursor 原样续读 | v2 允许 |
| R/B2-13-allow-one-form.test.ts:30 | Q；helper 的公开分页 cursor 原样续读 | v2 允许 |
| R/B2-15-replay.test.ts:121,165 | Q；helper 的公开分页 cursor 原样续读 | v2 允许 |
| R/B2-16-hook-closure.test.ts:50 | Q；helper 的公开分页 cursor 原样续读 | v2 允许 |
| R/B2-16-hook-reads.test.ts:71,124 | 71 为 Q及 helper 分页；124 的 `page.cursor` 来自:130上一页公开返回 | v2 允许 |
| R/B2-401-world.test.ts:48 | Q及公开分页 cursor；分页见 `tests/helpers/B2-401-world.ts:248`、`:254` | v2 允许 |
| R/B2-runtime-execution.test.ts:79,113,123,124,157,171,176,188,217,230,243,298,320,356,377,398,412,439,459,475,483,499,512,540,562 | Q；475、483复用:474保存的原始准备结果 | v2 允许 |
| R/C2-runtime-platform-tools.test.ts:163,196,221,243 | Q；分别来自:160、:193、:218、:240 | v2 允许 |
| R/K-readonly-command.test.ts:308,482,550,693,710,788,808 | Q；482 使用:480真实 HTTP prepare 返回 | v2 允许 |
| R/K3-12-review-round-tools.test.ts:132 | Q | v2 允许 |
| R/K3-14-record-unknown-call-review-tool.test.ts:228 | Q；来源:226 | v2 允许 |
| R/K3-19-review-admission.test.ts:142,143,159,278,318,347 | Q；318、347传递公开 Workflow 返回的下一步；159 另含公开 review 返回的 item，见 `tests/helpers/K3-proposal-round.ts:757`、`:889` | v2 允许 |
| R/K3-24-unknown-outcome-stability.test.ts:191,260,325 | Q；共用准备入口:167 | v2 允许 |
| R/K3-35-T-by-hand.test.ts:102,155 | Q | v2 允许 |
| R/K3-35-approved-methods-brief.test.ts:84 | Q | v2 允许 |
| R/K3-35-review-input-size.test.ts:143,185,211 | 143、211 为 Q，来源:141、:182；185 将 prepared 的原始 `bundleRef.digest` 交公开材料读取 | v2 允许 |
| R/K3-35-workspace-baseline-prepare.test.ts:41 | Q | v2 允许 |
| R/K3-B3-cancellation-cancelled.test.ts:94,150 | Q | v2 允许 |
| R/K3-B3-newest-request-order.test.ts:74 | Q | v2 允许 |
| R/K3-merge-cancel-propagation.test.ts:108,152 | Q | v2 允许 |
| R/K3-review-preparation.test.ts:141,171,254,397 | 141、171、397 为 Q；254 的 helper 分页 cursor 来源为 `tests/helpers/K3-crr-fixture.ts:111`、`:117` | v2 允许 |
| R/R2e-git-source-loop.test.ts:93,198 | Q；来源:90、:195 | v2 允许 |
| R/R4-control-runtime.test.ts:169,260,407,462,542 | Q，分别传递当前或下一次真实准备结果 | v2 允许 |
| R/R4c-graph-history.test.ts:181,590 | Q，经 `tests/helpers/S2B-runtime-steps-fixture.ts:348`、`:357` | v2 允许 |
| R/R4c-source-authority-guards.test.ts:322 | Q；来源:318 | v2 允许 |
| R/R5b-query-session-loop.test.ts:195,247,345,378 | Q；来源:192、:342、:374；247原样重试 | v2 允许 |
| R/RL-30-shell-resource-caps.test.ts:51,63,76,86,96,106,120,144 | Q，真实准备、启动 helper | v2 允许 |
| R/RL-31-readonly-resource-caps.test.ts:57,180,194,233,243,255,265 | Q，Query 或 Work 的真实准备结果 | v2 允许 |
| R/RL-35-36-sandbox-and-retry.test.ts:88,97,106,140,149 | Q | v2 允许 |
| R/S1-archive-files-brief.test.ts:54,116,155,172,208 | Q | v2 允许 |
| R/S1-routed-replies.test.ts:55,126,171,200,223 | Q；171 来源:170 | v2 允许 |
| R/S2B-15-end-retry-activity.test.ts:47 | Q | v2 允许 |
| R/S2B-36-observer-cancel-reread.test.ts:71 | Q | v2 允许 |
| R/S2B-37-observer-reread-failure.test.ts:69 | Q | v2 允许 |
| R/S2B-38-run08-unknown-activity.test.ts:133,181,250 | Q | v2 允许 |
| R/S2B-44-backfill-late-evidence-race.test.ts:106 | Q | v2 允许 |
| R/S2B-45-inprocess-run21-activity.test.ts:89 | Q | v2 允许 |
| R/S2B-r2-run08-current-revision.test.ts:133 | Q | v2 允许 |
| R/S3-graph-tools.test.ts:747,1169 | Q；来源:746、:1167 | v2 允许 |
| R/S4C2-assembly.test.ts:299 | Q；原样使用:297取得的 `first.prepared` | v2 允许 |
| R/orchestration-boundaries.test.ts:157,163,174,177 | Q；共同输入保存于:156，重试只改 requestId | v2 允许 |
| R/source-binding-migration.test.ts:180,403 | Q；180 经启动 helper，403 来源:384 | v2 允许 |
| K/K-interrupted-history.test.ts:221,236,250,279,302,339,384,427,478 | `throughPosition`：公开 `readTurnBounds` 返回的 endPosition 原样使用；公开入口导入见:17，返回读取见:201、:229、:242、:274、:297、:334、:376、:420、:472 | v2 允许 |
| R/R4b-session-input-boundaries.test.ts:129 | `afterCursor`：:121公开返回的 nextCursor，:130原样传回 | v2 允许 |
| R/R4b-session-recovery.test.ts:194,198 | `afterCursor`：:186公开返回，:195、:199原样使用 | v2 允许 |
| R/R4c-execution-history.test.ts:222,242,264,270,273,276,285,311 | cursor 来自:213、:235、:257、:281、:302公开读取；:268、:307保存原值；部分换目标后被拒绝，字段本身未改造 | v2 允许 |
| R/R4c-graph-history.test.ts:449,514,516,525,558 | cursor 或位置来自:434、:502、:522、:538公开结果，原样回传 | v2 允许 |
| R/S3-graph-tools.test.ts:502,503 | `afterCursor`：:497真实 input 工具返回，:501、:502的 nextCursor 原样续读 | v2 允许 |
| R/source-text-loop-migration.test.ts:228,229,246,248,260,273,274,289,290,291 | capture 指纹及 cursor 来自:214、:221、:234、:235、:263真实工具输出，原样查询、比较、读取、释放 | v2 允许 |
| R/RL-32-check-resource-caps.test.ts:74 | `reportRef.digest`：:67真实检查返回，:71—72原样取 ref，交 `materials.openArtifact` | v2 允许 |
| R/RL-35-36-sandbox-and-retry.test.ts:166 | 同类 reportRef，来源:160、:163、:164 | v2 允许 |
| B/K3-41-release-hold.test.ts:143,382；R/K-readonly-command.test.ts:633,650；R/K3-35-review-input-size.test.ts:128；R/S3-graph-tools.test.ts:1101 | Host 种子策略 digest：`tests/helpers/AG2b-collaboration-fixture.ts:446`安装返回，`:451`原样激活 | v2 允许 |
| R/K-readonly-command.test.ts:447,633,634,650,651 | Host token：:366读真实页面，:440取得 token，:448及 `corePost` 原样传入 | v2 允许 |
| B/K3-41-release-hold.test.ts:76,83,125,143,149,152,184,188,202,210,252,260,263,284,293,296,312,314,317,328,330,332,340,343,349,382,391,396,403,419,434,438,446,450,455,460 | Host token：`tests/helpers/AG2b-collaboration-fixture.ts:263`公开取得，`tests/helpers/A2-restart-fixture.ts:64`、`:65`原样带入；210另传公开 prepared 的 bundleRef | v2 允许 |
| R/K3-35-review-input-size.test.ts:123,128,185,213,227 | 同一真实 Host token 链；HTTP 转发见 `tests/scenarios/harness.ts:1082` | v2 允许 |
| B/WP1-start-refusal.test.ts:18,43 | `prepared`：`tests/helpers/WP1-units-fixture.ts:515`、`:530`手造 manifest/prepared，`:559`替身忽略输入 | F1 |
| R/S5-user-message-tools.test.ts:410,449 | `prepared`：:250读内部 manifest，:255改写，:265重组，:380塞回启动输入 | F1 |
| R/S5R2-agent-application.test.ts:241,282,374 | `receipt`：:187读内部 event，:208、:217、:224重建 identityKey/fingerprint/cursor | F1 |
| R/S3-graph-tools.test.ts:702,718,721 | cursor 在:703、:719、:722直接写成 c1/c0/c1 | F1 |
| R/S3-graph-tools.test.ts:955 | artifact 指纹在:810、:813自算并组装，:952装入提议 | F1 |
| R/W2-whiteboard-tools.test.ts:268,322,338,396 | artifact 指纹由:94测试签发，录制端口:117、:123不验证来源 | F1 |
| R/W2-role-skills.test.ts:188 | `page.cursor` 手写 `prior-page`，:172替身接收 | F1 |
| R/K3-14-record-unknown-call-review-tool.test.ts:94,113,119,128 | `item` 编号由:81、:128测试签发 | F1 |
| R/K3-16-proposal-tool.test.ts:103,120,136,143,151,155 | `item` 编号由:68、:120测试签发 | F1 |
| R/B2-02-recognition-unified.test.ts:222,274 | `rewriteOf.alias` 在:223、:276手写 1，未采用公开返回 alias | F1 |
| R/B2-03-request-tool.test.ts:120 | `rewriteOf.alias` 在:122手写 1 | F1 |
| R/K3-35-review-input-size.test.ts:174 | 脚本手写 `item:1`；:195虽读取实际 item，但未把其返回 alias用于参数 | F1 |
| K/R4a-frozen-public.test.ts:300,310,854 | `throughPosition` 从:295、:842、:848内部 records 提取 | F1 |
| R/R4c-session-continuity.test.ts:72,79,87,102,122,139 | `throughPosition` 经:39、:55从 store records 取值；:121另作算术改造 | F1 |
| R/R4c-graph-history.test.ts:786,802,824,849,860,880,894 | range 位置从:779、:817、:843、:874的 rawRecords 重建；802另用:801改写 cursor，849上界加5。860、894虽有原始公开 cursor，range 仍非法 | F1 |

**3．Record-store 测试**

| 范围 | 结果 |
|---|---|
| `.lead-ref/groups/L3-files.txt:1`、`:138` | 本组没有 `tests/record-store/*`；本节无实例。上层手造记录不在本次范围，未计 F3。 |

**4．A7**

| 位置 | 使用范围 | 裁定 |
|---|---|---|
| R/S4C-note-tools.test.ts:124,151,165,177,188,206,240 | `buildNoteTools` 的参数映射、默认值、结果透传；调用及断言见:125、:152、:166、:178、:189、:207、:241；未用于到达真实 owner 状态 | v2 允许 |
| R/S4C-note-tools.test.ts:114 | :115—120检查工具名称、effectClass、能力元数据；不属于 v2:47—48列出的三种用途 | A7 越界 |
| R/S4C-note-tools.test.ts:215 | :216—230检查严格 schema 拒绝及零调用；不属于 v2:47—48列出的映射、默认值、结果透传 | A7 越界 |
| `.lead-ref/groups/L3-files.txt:1`、`:138` | 本组未发现 `damageKernel` 或指定 `process-sandbox-standin` 的使用；本组命名 helper 为 R/S4C-note-tools.test.ts:67 | 无其他实例 |

**无实例**

以下文件没有本次四类实例；`:1`为文件级核对锚点：

- `tests/business/A2-workflow-auto-rework.test.ts:1`
- `tests/business/A2-workflow-disposition.test.ts:1`
- `tests/business/A2-workflow-reverify.test.ts:1`
- `tests/business/S1-task-order.test.ts:1`
- `tests/business/S4C2-U6.test.ts:1`
- `tests/kernel/B2-history-public-export.test.ts:1`
- `tests/kernel/K-close-open-turn.test.ts:1`
- `tests/kernel/K-readonly-sandbox.test.ts:1`
- `tests/kernel/R4-terminal-history.test.ts:1`
- `tests/kernel/R4-tool-group-barrier.test.ts:1`
- `tests/kernel/R4a-legacy-fixtures.ts:1`
- `tests/kernel/RL-01-02-caps-effect.test.ts:1`
- `tests/kernel/RL-03-05-oom-pids.test.ts:1`
- `tests/kernel/RL-06-11-stop.test.ts:1`
- `tests/kernel/RL-12-15-conditions.test.ts:1`
- `tests/kernel/RL-15c-gate-stream-error.test.ts:1`
- `tests/kernel/RL-20-resource-cap-attribution.test.ts:1`
- `tests/kernel/RL-22-settlement.test.ts:1`
- `tests/runtime/B1-kernel-assembly.test.ts:1`
- `tests/runtime/C3-brief-timeline.test.ts:1`
- `tests/runtime/K3-06-mixed-kinds-pure.test.ts:1`
- `tests/runtime/K3-15-blocked-omission.test.ts:1`
- `tests/runtime/K3-15-blocked-sentence-pure.test.ts:1`
- `tests/runtime/K3-15-blocked-sentence.test.ts:1`
- `tests/runtime/K3-15-disposition-effects-pure.test.ts:1`
- `tests/runtime/K3-16-approved-method-lines.test.ts:1`
- `tests/runtime/K3-16-proposal-input.test.ts:1`
- `tests/runtime/K3-16-proposals-pure.test.ts:1`
- `tests/runtime/K3-16-review-extremes-pure.test.ts:1`
- `tests/runtime/K3-16-targets-pure.test.ts:1`
- `tests/runtime/K3-18-requeue-confirmed-pure.test.ts:1`
- `tests/runtime/K3-18-review-card-pure.test.ts:1`
- `tests/runtime/K3-19-review-admission-pure.test.ts:1`
- `tests/runtime/K3-26-unknown-call-review-codec-pure.test.ts:1`
- `tests/runtime/K3-26-unknown-call-review-pure.test.ts:1`
- `tests/runtime/K3-34-tool-name-constants.test.ts:1`
- `tests/runtime/K3-35-manifest-trim-pure.test.ts:1`
- `tests/runtime/K3-35-renderer-boundary-pure.test.ts:1`
- `tests/runtime/K3-40-ignored-at-capture.test.ts:1`
- `tests/runtime/K3-40-workspace-change-capture.test.ts:1`
- `tests/runtime/K3-48-2-proposal-budget-pure.test.ts:1`
- `tests/runtime/K3-48-3-extremes-pure.test.ts:1`
- `tests/runtime/K3-B3-runtime-fail-closed.test.ts:1`
- `tests/runtime/K3-continuation-review-note.test.ts:1`
- `tests/runtime/K3-review-input-pure.test.ts:1`
- `tests/runtime/K3-unknown-call-review-section.test.ts:1`
- `tests/runtime/R4b-session-operations.test.ts:1`
- `tests/runtime/R4b-session-skeleton.test.ts:1`
- `tests/runtime/R4c-kernel-history-range.test.ts:1`
- `tests/runtime/S2B-tally.test.ts:1`
- `tests/runtime/S3-context-assembler.test.ts:1`
- `tests/runtime/S4C-note-run-task-resolver.test.ts:1`
- `tests/runtime/WP1-context-assembly.test.ts:1`

JSON 中 `P/H/T/D/Q` 沿用上表定义；`@` 后为该值对应的本文件行号。同行多个字段已合并，F1 优先。

```json
[
  {"section":"A1草稿","file":"tests/business/K3-15-ur3h.test.ts","line":[95],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/business/K3-17-goal-guard.test.ts","line":[87],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/business/K3-41-release-hold.test.ts","line":[143,382,508],"owner":"plans.proposePlan","value":"H@143,382；P@508","verdict":"v2 允许","note":"完整；后续含内部观察"},
  {"section":"A1草稿","file":"tests/business/K3-44-crr-recovery.test.ts","line":[152,194],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/business/K3-46-review-advance-failures.test.ts","line":[143,418,450,475,503,526,627,661,690],"owner":"plans.proposePlan","value":"草稿@143；P@418,450,475,503,526,627,661,690","verdict":"v2 允许","note":"133构造、149采用；后续269内部包装"},
  {"section":"A1草稿","file":"tests/business/K3-UR7-crr-failed-set.test.ts","line":[338,352,398,445,464,541],"owner":"plans.proposePlan","value":"草稿@338；P@352,398,445,464,541","verdict":"v2 允许","note":"328构造、344采用；另有301内部读取"},
  {"section":"A1草稿","file":"tests/business/K3-review-workflow-rows.test.ts","line":[155,208,368,956,1185,1205,1232],"owner":"plans.proposePlan；propose_safer_method","value":"P@155,208,956,1185,1205,1232；T@368","verdict":"v2 允许","note":"工具参数见tests/helpers/K3-proposal-round.ts:757；后续混合内部读取"},
  {"section":"A1草稿","file":"tests/business/R5c-workflow.test.ts","line":[93,135,155],"owner":"plans.proposePlan","value":"P@93,135；草稿@155","verdict":"v2 允许","note":"148完整构造、161采用、168公开推进"},
  {"section":"A1草稿","file":"tests/business/S1-archive-flow.test.ts","line":[202],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/business/S1-session-maintenance.test.ts","line":[206,296],"owner":"plans.proposePlan","value":"P@206；编辑草稿@296","verdict":"v2 允许","note":"184、292构造，303采用；454内部Kernel操作"},
  {"section":"A1草稿","file":"tests/business/S5-decision-workflow.test.ts","line":[186,224],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/business/S5R2-automation-cards.test.ts","line":[24,134,153],"owner":"plans.proposePlan","value":"P@24；gateHead草稿@134,153","verdict":"v2 允许","note":"tests/helpers/S5R2-b-support.ts:237,253,260；后续内部观察"},
  {"section":"A1草稿","file":"tests/business/S5R2-settings-replay.test.ts","line":[28,29,246],"owner":"plans.proposePlan","value":"P@28,29；adoptA2草稿@246","verdict":"v2 允许","note":"tests/helpers/S5R2-c-support.ts:269,279,284；后续内部观察"},
  {"section":"A1草稿","file":"tests/business/WP1-continuation-handover.test.ts","line":[87,119,164,216,242,273,288,317,346,357,366,376,423,477,498,510,526],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"tests/helpers/WP1-handover-fixture.ts:233汇入公共计划链"},
  {"section":"A1草稿","file":"tests/runtime/A2-reconcile-runtime.test.ts","line":[58,78],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/B2-01-shell-hook.test.ts","line":[35],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/B2-02-approved-method.test.ts","line":[45,63],"owner":"plans.proposePlan；propose_safer_method","value":"P@45；T@63","verdict":"v2 允许","note":"tests/helpers/K3-proposal-round.ts:757,760；工具后公开读回"},
  {"section":"A1草稿","file":"tests/runtime/B2-02-recognition-unified.test.ts","line":[82,140],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/B2-03-request-tool.test.ts","line":[26,60,74,75,84,89,98,107,118],"owner":"plans.proposePlan；request_command_rerun","value":"P@26；T@60,74,75,84,89,98,107,118","verdict":"v2 允许","note":"tests/helpers/B2-blocked-runtime.ts:417,424；真实工具及公开查询"},
  {"section":"A1草稿","file":"tests/runtime/B2-04-allowance.test.ts","line":[30,43,74],"owner":"plans.proposePlan；request_command_rerun","value":"P@30；T@43,74","verdict":"v2 允许","note":"完整；后续混用hook"},
  {"section":"A1草稿","file":"tests/runtime/B2-05-06-denial.test.ts","line":[30,58,67,80,88],"owner":"plans.proposePlan；request_command_rerun","value":"P@30；T@58,67,80,88","verdict":"v2 允许","note":"完整；后续混用hook"},
  {"section":"A1草稿","file":"tests/runtime/B2-09-allowance-crash.test.ts","line":[42,47,66,72],"owner":"plans.proposePlan；request_command_rerun","value":"P@42,66；T@47,72","verdict":"v2 允许","note":"完整；后续混用hook"},
  {"section":"A1草稿","file":"tests/runtime/B2-13-allow-one-form.test.ts","line":[30,35],"owner":"plans.proposePlan；request_command_rerun","value":"P@30；T@35","verdict":"v2 允许","note":"完整；后续混用hook"},
  {"section":"A1草稿","file":"tests/runtime/B2-15-replay.test.ts","line":[121,165],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/B2-16-hook-closure.test.ts","line":[50,63,92,106],"owner":"plans.proposePlan；request_command_rerun","value":"P@50,92,106；T@63","verdict":"v2 允许","note":"完整；后续混用hook"},
  {"section":"A1草稿","file":"tests/runtime/B2-16-hook-reads.test.ts","line":[71],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/B2-401-world.test.ts","line":[48],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/B2-runtime-execution.test.ts","line":[36],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/C1-communication-tools.test.ts","line":[153,163,164,172,177,231,244,252,258,263,267,271],"owner":"plans.proposePlan；邮箱工具","value":"P@231；T@153,163,164,172,177,244,252,258,263,267,271","verdict":"v2 允许","note":"70,77,81录制端口；244起真实owner；不豁免F4"},
  {"section":"A1草稿","file":"tests/runtime/C2-runtime-platform-tools.test.ts","line":[116,120,138,187,212,237],"owner":"plans.proposePlan；邮箱工具","value":"T@116,120；P@138,187,212,237","verdict":"v2 允许","note":"116,120完整，但103为固定结果替身"},
  {"section":"A1草稿","file":"tests/runtime/K-readonly-command.test.ts","line":[543,633,650,675,702,763,777,801],"owner":"plans.proposePlan","value":"H@633,650；P@543,675,702,763,777,801","verdict":"v2 允许","note":"完整公共提议采用；H后公开driver"},
  {"section":"A1草稿","file":"tests/runtime/K3-12-review-round-tools.test.ts","line":[130,230],"owner":"plans.proposePlan；run_readonly_command","value":"P@130；T@230","verdict":"v2 允许","note":"231虽强转但command完整；221沙箱替身"},
  {"section":"A1草稿","file":"tests/runtime/K3-14-record-unknown-call-review-tool.test.ts","line":[202],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/K3-19-review-admission.test.ts","line":[127,159,246,255,258],"owner":"plans.proposePlan；propose_safer_method","value":"P@127,246,255,258；T@159","verdict":"v2 允许","note":"tests/helpers/K3-proposal-round.ts:757,760,889；真实工具及公开读回"},
  {"section":"A1草稿","file":"tests/runtime/K3-19-review-capability.test.ts","line":[50,116],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/K3-24-unknown-outcome-stability.test.ts","line":[57,75],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/K3-35-T-by-hand.test.ts","line":[102,155],"owner":"plans.proposePlan","value":"P及长任务草稿","verdict":"v2 允许","note":"tests/helpers/K3-proposal-round.ts:186,203,211；完整"},
  {"section":"A1草稿","file":"tests/runtime/K3-35-approved-methods-brief.test.ts","line":[84],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/K3-35-workspace-baseline-prepare.test.ts","line":[34],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/K3-B3-cancellation-cancelled.test.ts","line":[92,148],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/K3-B3-newest-request-order.test.ts","line":[71],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/K3-merge-cancel-propagation.test.ts","line":[59],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/K3-review-preparation.test.ts","line":[169,215,254,355],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/R2e-git-source-loop.test.ts","line":[45,141],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/R4-control-runtime.test.ts","line":[45,58],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/R4c-graph-history.test.ts","line":[76],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/R4c-source-authority-guards.test.ts","line":[284],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/RL-30-shell-resource-caps.test.ts","line":[36],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/RL-31-readonly-resource-caps.test.ts","line":[226],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/RL-32-check-resource-caps.test.ts","line":[43],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/RL-35-36-sandbox-and-retry.test.ts","line":[40,46,58],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/S1-archive-cancelled-reader.test.ts","line":[40],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/S1-archive-files-brief.test.ts","line":[30],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/S1-routed-replies.test.ts","line":[39],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/S2B-15-end-retry-activity.test.ts","line":[33],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/S2B-36-observer-cancel-reread.test.ts","line":[46],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/S2B-37-observer-reread-failure.test.ts","line":[42],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/S2B-38-run08-unknown-activity.test.ts","line":[124,163,230],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/S2B-44-backfill-late-evidence-race.test.ts","line":[91],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/S2B-45-inprocess-run21-activity.test.ts","line":[74],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/S2B-r2-run08-current-revision.test.ts","line":[92],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/S4C-note-related-find.test.ts","line":[26,28,29,41,65,82],"owner":"notes.writeNote；plans.proposePlan","value":"NoteDraft@26,28,29；P@41,65,82","verdict":"v2 允许","note":"15完整构造；tests/helpers/S4A-note-fixture.ts:282传入；后续公开memoryFind"},
  {"section":"A1草稿","file":"tests/runtime/S4C2-assembly.test.ts","line":[189,227,254,283,291,307,329,372,407,420],"owner":"notes.writeNote；plans.proposePlan","value":"NoteDraft@189,291,307；P@227,254,283,329,372,407,420","verdict":"v2 允许","note":"173,179,184完整构造；202后续内部正文读取"},
  {"section":"A1草稿","file":"tests/runtime/S5-user-message-tools.test.ts","line":[34,98,234],"owner":"plans.proposePlan；决策工具","value":"P@34；T@98,234","verdict":"v2 允许","note":"tests/helpers/S5-user-message-support.ts:82；后续113存储观察"},
  {"section":"A1草稿","file":"tests/runtime/S5R2-agent-application.test.ts","line":[67,143,198,310,335],"owner":"plans.proposePlan；白板及决策工具","value":"P@67；T@143,198,310,335","verdict":"v2 允许","note":"50完整草稿；187,313后续内部观察"},
  {"section":"A1草稿","file":"tests/runtime/orchestration-boundaries.test.ts","line":[130],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/source-binding-migration.test.ts","line":[162],"owner":"plans.proposePlan","value":"P","verdict":"v2 允许","note":"完整；公开提议采用；后段非全公开"},
  {"section":"A1草稿","file":"tests/runtime/K3-35-review-input-size.test.ts","line":[128],"owner":"plans.proposePlan","value":"H","verdict":"v2 允许","note":"完整；后续公开Workflow及材料读取"},
  {"section":"A1草稿","file":"tests/runtime/S3-graph-tools.test.ts","line":[390,404,407,409,457,643,686,699,705,714,728,781,1101],"owner":"look_graph/find_graph；plans.proposePlan","value":"H@1101；T@390,404,407,409,457,643,686,699,705,714,728,781","verdict":"v2 允许","note":"163录制端口；781可接真实input owner；完整参数，不豁免F4"},
  {"section":"A1草稿","file":"tests/business/A2-workflow-result-mapping.test.ts","line":[84,100,110],"owner":"workflow.advanceWork","value":"只有meta的start/observe/finalize请求","verdict":"F1","note":"71—73强转；62,63,65替身忽略请求；非完整合同"},
  {"section":"A1草稿","file":"tests/business/K3-review-workflow-rows.test.ts","line":[869,887,926],"owner":"workflow.advanceWork","value":"只有meta的start/observe请求","verdict":"F1","note":"810—813强转；803,804替身忽略请求"},
  {"section":"A1草稿","file":"tests/runtime/W2-whiteboard-tools.test.ts","line":[268,322,338,396],"owner":"propose_future_plan","value":"带手造artifact指纹的草稿","verdict":"F1","note":"94测试签发digest；117—123录制替身"},
  {"section":"A1草稿","file":"tests/runtime/S3-graph-tools.test.ts","line":[702,718,721,955],"owner":"look_graph/find_graph；plans.proposePlan","value":"手造cursor@702,718,721；手造artifact草稿@955","verdict":"F1","note":"703,719,722写cursor；810,813算digest；952装入草稿"},
  {"section":"A1草稿","file":"tests/runtime/W2-whiteboard-tools.test.ts","line":[245,246,247,279,300,308,349],"owner":"白板查询及采用工具","value":"T","verdict":"v2 允许","note":"59,67,307完整；117,123,125录制替身；后续录制断言"},
  {"section":"A1草稿","file":"tests/runtime/source-tool-lifecycle.test.ts","line":[275,314,337],"owner":"source工具","value":"T","verdict":"v2 允许","note":"274,307,331完整；取消或真实文件结果"},
  {"section":"A1草稿","file":"tests/runtime/S4C-note-tools.test.ts","line":[125,152,166,178,189,197,207,241],"owner":"record_note","value":"T","verdict":"v2 允许","note":"67录制适配器；仅映射、默认值、结果透传"},
  {"section":"A1草稿","file":"tests/runtime/K3-14-record-unknown-call-review-tool.test.ts","line":[94,113,119,128],"owner":"record_unknown_call_review","value":"含手造item的工具参数","verdict":"F1","note":"81,128手写编号；65录制端口"},
  {"section":"A1草稿","file":"tests/runtime/K3-16-proposal-tool.test.ts","line":[103,120,136,143,151,155],"owner":"propose_safer_method","value":"含手造item的工具参数","verdict":"F1","note":"68,120手写编号；43录制端口"},
  {"section":"A1草稿","file":"tests/runtime/B2-03-request-tool.test.ts","line":[120],"owner":"request_command_rerun","value":"含手造rewriteOf.alias的工具参数","verdict":"F1","note":"122手写1"},

  {"section":"A1签发字段","file":"tests/business/K3-15-ur3h.test.ts","line":[95,206,248,271,316,360],"owner":"Runtime；completionPolicies","value":"D@95；Q@206,248,271,316,360","verdict":"v2 允许","note":"真实公开返回原样使用；271来源267"},
  {"section":"A1签发字段","file":"tests/business/K3-41-release-hold.test.ts","line":[76,83,109,125,143,149,152,184,188,202,210,252,260,263,284,293,296,312,314,317,328,330,332,340,343,349,382,391,396,403,419,434,438,446,450,455,460,508,539],"owner":"HTTP；Runtime；completionPolicies；materials","value":"Q@109,539；D@143,382,508；token@76,83,125,143,149,152,184,188,202,210,252,260,263,284,293,296,312,314,317,328,330,332,340,343,349,382,391,396,403,419,434,438,446,450,455,460；bundleRef@210","verdict":"v2 允许","note":"真实返回原样使用；token源于tests/helpers/AG2b-collaboration-fixture.ts:263"},
  {"section":"A1签发字段","file":"tests/business/R5b-initial-planning-workflow.test.ts","line":[188,220],"owner":"completionPolicies；Runtime.startQuery","value":"digest@188；prepared@220","verdict":"v2 允许","note":"180安装返回、190原样引用；217准备返回"},
  {"section":"A1签发字段","file":"tests/runtime/A2-reconcile-runtime.test.ts","line":[58,78,205,219,233,253,279,342,375,413,420,426,441,490,530,578,723,992,1096],"owner":"completionPolicies；Runtime.startRun","value":"D@58,78；Q@205,219,233,253,279,342,375,413,420,426,441,490,530,578,723,992,1096","verdict":"v2 允许","note":"准备源193、989；原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/B2-runtime-execution.test.ts","line":[36,79,113,123,124,157,171,176,188,217,230,243,298,320,356,377,398,412,439,459,475,483,499,512,540,562],"owner":"completionPolicies；Runtime.startRun","value":"D@36；Q@79,113,123,124,157,171,176,188,217,230,243,298,320,356,377,398,412,439,459,475,483,499,512,540,562","verdict":"v2 允许","note":"公开prepare返回原样启动；474保存重试输入"},
  {"section":"A1签发字段","file":"tests/runtime/C2-runtime-platform-tools.test.ts","line":[138,163,187,196,212,221,237,243],"owner":"completionPolicies；Runtime.startRun","value":"D@138,187,212,237；Q@163,196,221,243","verdict":"v2 允许","note":"准备来源160,193,218,240"},
  {"section":"A1签发字段","file":"tests/runtime/K-readonly-command.test.ts","line":[308,447,482,543,550,633,634,650,651,675,693,702,710,763,777,788,801,808],"owner":"Runtime；completionPolicies；HTTP","value":"Q@308,482,550,693,710,788,808；D@543,633,650,675,702,763,777,801；token@447,633,634,650,651","verdict":"v2 允许","note":"366,440真实页面token；480公开prepare；其余D/Q"},
  {"section":"A1签发字段","file":"tests/runtime/K3-14-record-unknown-call-review-tool.test.ts","line":[202,228],"owner":"completionPolicies；Runtime.startRun","value":"D@202；Q@228","verdict":"v2 允许","note":"226真实准备返回"},
  {"section":"A1签发字段","file":"tests/runtime/K3-24-unknown-outcome-stability.test.ts","line":[57,75,191,260,325],"owner":"completionPolicies；Runtime.startRun","value":"D@57,75；Q@191,260,325","verdict":"v2 允许","note":"167真实准备入口"},
  {"section":"A1签发字段","file":"tests/runtime/K3-35-review-input-size.test.ts","line":[123,128,143,185,211,213,227],"owner":"Runtime；completionPolicies；HTTP；materials","value":"Q@143,211；D@128；bundleRef@185；token@123,128,185,213,227","verdict":"v2 允许","note":"141,182公开准备；185原样材料ref；真实Host token"},
  {"section":"A1签发字段","file":"tests/runtime/R2e-git-source-loop.test.ts","line":[45,93,141,198],"owner":"completionPolicies；Runtime.startRun","value":"D@45,141；Q@93,198","verdict":"v2 允许","note":"90,195公开准备返回"},
  {"section":"A1签发字段","file":"tests/runtime/R4-control-runtime.test.ts","line":[45,58,169,260,407,462,542],"owner":"completionPolicies；Runtime.startRun","value":"D@45,58；Q@169,260,407,462,542","verdict":"v2 允许","note":"真实准备返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/R4c-source-authority-guards.test.ts","line":[284,322],"owner":"completionPolicies；Runtime.startRun","value":"D@284；Q@322","verdict":"v2 允许","note":"318真实prepare返回"},
  {"section":"A1签发字段","file":"tests/runtime/R5b-query-session-loop.test.ts","line":[195,247,345,378],"owner":"Runtime.startQuery","value":"Q","verdict":"v2 允许","note":"192,342,374公开准备；247原样重试"},
  {"section":"A1签发字段","file":"tests/runtime/S1-routed-replies.test.ts","line":[39,55,126,171,200,223],"owner":"completionPolicies；Runtime.startRun","value":"D@39；Q@55,126,171,200,223","verdict":"v2 允许","note":"171来源170；其余真实启动helper"},
  {"section":"A1签发字段","file":"tests/runtime/S2B-15-end-retry-activity.test.ts","line":[33,47],"owner":"completionPolicies；Runtime.startRun","value":"D@33；Q@47","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/S2B-36-observer-cancel-reread.test.ts","line":[46,71],"owner":"completionPolicies；Runtime.startRun","value":"D@46；Q@71","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/S2B-37-observer-reread-failure.test.ts","line":[42,69],"owner":"completionPolicies；Runtime.startRun","value":"D@42；Q@69","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/S2B-38-run08-unknown-activity.test.ts","line":[124,133,163,181,230,250],"owner":"completionPolicies；Runtime.startRun","value":"D@124,163,230；Q@133,181,250","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/S2B-44-backfill-late-evidence-race.test.ts","line":[91,106],"owner":"completionPolicies；Runtime.startRun","value":"D@91；Q@106","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/S2B-45-inprocess-run21-activity.test.ts","line":[74,89],"owner":"completionPolicies；Runtime.startRun","value":"D@74；Q@89","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/S2B-r2-run08-current-revision.test.ts","line":[92,133],"owner":"completionPolicies；Runtime.startRun","value":"D@92；Q@133","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/S3-graph-tools.test.ts","line":[502,503,747,1101,1169],"owner":"look_graph；Runtime；completionPolicies","value":"cursor@502,503；Q@747,1169；D@1101","verdict":"v2 允许","note":"497,501,502公开分页；746,1167真实准备"},
  {"section":"A1签发字段","file":"tests/runtime/S4C2-assembly.test.ts","line":[227,254,283,299,329,372,407,420],"owner":"completionPolicies；Runtime.startRun","value":"D@227,254,283,329,372,407,420；Q@299","verdict":"v2 允许","note":"299原样使用297返回prepared"},
  {"section":"A1签发字段","file":"tests/runtime/orchestration-boundaries.test.ts","line":[130,157,163,174,177],"owner":"completionPolicies；Runtime.startRun","value":"D@130；Q@157,163,174,177","verdict":"v2 允许","note":"156保存原始prepared；重试只改requestId"},
  {"section":"A1签发字段","file":"tests/runtime/source-binding-migration.test.ts","line":[162,180,403],"owner":"completionPolicies；Runtime","value":"D@162；Q@180,403","verdict":"v2 允许","note":"180真实启动helper；403来源384"},
  {"section":"A1签发字段","file":"tests/business/WP1-start-refusal.test.ts","line":[18,43],"owner":"Workflow.advanceWork→Runtime.startRun","value":"prepared","verdict":"F1","note":"tests/helpers/WP1-units-fixture.ts:515,530手造；559替身忽略"},
  {"section":"A1签发字段","file":"tests/runtime/S5-user-message-tools.test.ts","line":[410,449],"owner":"driver.start→Workflow.advanceWork","value":"prepared","verdict":"F1","note":"250读manifest、255改写、265重组、380传入"},
  {"section":"A1签发字段","file":"tests/runtime/S5R2-agent-application.test.ts","line":[241,282,374],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"187读内部事件；208,217,224重建"},
  {"section":"A1签发字段","file":"tests/runtime/S3-graph-tools.test.ts","line":[702,718,721,955],"owner":"look_graph/find_graph；plans.proposePlan","value":"cursor@702,718,721；artifact指纹@955","verdict":"F1","note":"703,719,722手写cursor；810,813自算artifact；952装入草稿"},
  {"section":"A1签发字段","file":"tests/runtime/W2-whiteboard-tools.test.ts","line":[268,322,338,396],"owner":"propose_future_plan","value":"artifact指纹","verdict":"F1","note":"94测试签发；117,123替身不验证来源"},
  {"section":"A1签发字段","file":"tests/runtime/W2-role-skills.test.ts","line":[188],"owner":"query_ready_tasks","value":"page.cursor","verdict":"F1","note":"188手写prior-page；172替身"},
  {"section":"A1签发字段","file":"tests/runtime/K3-14-record-unknown-call-review-tool.test.ts","line":[94,113,119,128],"owner":"record_unknown_call_review","value":"item展示编号","verdict":"F1","note":"81,128测试签发"},
  {"section":"A1签发字段","file":"tests/runtime/K3-16-proposal-tool.test.ts","line":[103,120,136,143,151,155],"owner":"propose_safer_method","value":"item展示编号","verdict":"F1","note":"68,120测试签发"},
  {"section":"A1签发字段","file":"tests/runtime/B2-02-recognition-unified.test.ts","line":[222,274],"owner":"request_command_rerun","value":"rewriteOf.alias","verdict":"F1","note":"223,276手写1"},
  {"section":"A1签发字段","file":"tests/runtime/B2-03-request-tool.test.ts","line":[120],"owner":"request_command_rerun","value":"rewriteOf.alias","verdict":"F1","note":"122手写1"},
  {"section":"A1签发字段","file":"tests/runtime/K3-35-review-input-size.test.ts","line":[174],"owner":"record_unknown_call_review","value":"item展示编号","verdict":"F1","note":"174脚本手写1；195未把返回alias用于参数"},
  {"section":"A1签发字段","file":"tests/kernel/R4a-frozen-public.test.ts","line":[300,310,854],"owner":"Kernel.runCodingAgent","value":"throughPosition","verdict":"F1","note":"295,842,848从内部records提取"},
  {"section":"A1签发字段","file":"tests/runtime/R4c-session-continuity.test.ts","line":[72,79,87,102,122,139],"owner":"runObservedModel→Kernel.runCodingAgent","value":"throughPosition","verdict":"F1","note":"39,55从store records取值；121另作算术改造"},
  {"section":"A1签发字段","file":"tests/runtime/R4c-graph-history.test.ts","line":[786,802,824,849,860,880,894],"owner":"Runtime.readSessionHistory","value":"range位置；802另含改写cursor","verdict":"F1","note":"779,817,843,874内部records重建；801改写cursor；852上界加5"},
  {"section":"A1签发字段","file":"tests/kernel/K-interrupted-history.test.ts","line":[221,236,250,279,302,339,384,427,478],"owner":"Kernel.runCodingAgent","value":"throughPosition","verdict":"v2 允许","note":"17公开readTurnBounds；201,229,242,274,297,334,376,420,472返回位置原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/R4b-session-input-boundaries.test.ts","line":[129],"owner":"Runtime.readSessionHistory","value":"afterCursor","verdict":"v2 允许","note":"121公开返回，130原样传回"},
  {"section":"A1签发字段","file":"tests/runtime/R4b-session-recovery.test.ts","line":[194,198],"owner":"Runtime.readSessionHistory","value":"afterCursor","verdict":"v2 允许","note":"186公开返回，195,199原样传回"},
  {"section":"A1签发字段","file":"tests/runtime/R4c-execution-history.test.ts","line":[222,242,264,270,273,276,285,311],"owner":"Runtime.readExecutionHistory","value":"afterCursor/throughCursor","verdict":"v2 允许","note":"213,235,257,281,302公开返回；268,307保存原值"},
  {"section":"A1签发字段","file":"tests/runtime/R4c-graph-history.test.ts","line":[76,181,449,514,516,525,558,590],"owner":"completionPolicies；Runtime","value":"D@76；Q@181,590；cursor/位置@449,514,516,525,558","verdict":"v2 允许","note":"434,502,522,538公开历史或执行读取；字段原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/source-text-loop-migration.test.ts","line":[228,229,246,248,260,273,274,289,290,291],"owner":"project_source","value":"capture.sourceDigest及cursor","verdict":"v2 允许","note":"214,221,234,235,263真实工具返回，原样重用"},
  {"section":"A1签发字段","file":"tests/business/K3-17-goal-guard.test.ts","line":[87,89],"owner":"completionPolicies；Runtime","value":"D@87；Q@89","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/business/K3-44-crr-recovery.test.ts","line":[101,152,194],"owner":"completionPolicies；Runtime","value":"Q@101；D@152,194","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/business/K3-46-review-advance-failures.test.ts","line":[418,420,450,452,475,477,503,505,526,528,529,627,629,661,663,690,692,693],"owner":"completionPolicies；Runtime","value":"D@418,450,475,503,526,627,661,690；Q@420,452,477,505,528,529,629,663,692,693","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/business/K3-UR7-crr-failed-set.test.ts","line":[352,354,360,398,400,401,407,445,447,464,466,469,541],"owner":"completionPolicies；Runtime","value":"D@352,398,445,464,541；Q@354,360,400,401,407,447,466,469","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/business/K3-review-workflow-rows.test.ts","line":[155,208,210,367,368,385,416,465,477,862,881,956,1185,1205,1232],"owner":"completionPolicies；Runtime；propose_safer_method；cardSource.readPage","value":"D@155,208,956,1185,1205,1232；Q@210,367,416,465,477,862,881；item@368；cursor@385","verdict":"v2 允许","note":"tests/helpers/K3-proposal-round.ts:752,757及626,639；原样公开返回"},
  {"section":"A1签发字段","file":"tests/runtime/B2-01-shell-hook.test.ts","line":[35],"owner":"completionPolicies；Runtime；unknownCallReviews.listReviews","value":"D/Q/page.cursor","verdict":"v2 允许","note":"分页源tests/helpers/B2-blocked-runtime.ts:281,287；均原样返回"},
  {"section":"A1签发字段","file":"tests/runtime/B2-02-approved-method.test.ts","line":[45,48,62,63],"owner":"completionPolicies；Runtime；propose_safer_method","value":"D@45；Q@48,62；item@63","verdict":"v2 允许","note":"item源tests/helpers/K3-proposal-round.ts:752,757"},
  {"section":"A1签发字段","file":"tests/runtime/B2-02-recognition-unified.test.ts","line":[82,84,140,144,150],"owner":"completionPolicies；Runtime","value":"D@82,140；Q@84,144,150","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/B2-03-request-tool.test.ts","line":[26],"owner":"completionPolicies；Runtime；unknownCallReviews.listReviews","value":"D/Q/page.cursor","verdict":"v2 允许","note":"分页源tests/helpers/B2-blocked-runtime.ts:281,287"},
  {"section":"A1签发字段","file":"tests/runtime/B2-04-allowance.test.ts","line":[30],"owner":"completionPolicies；Runtime；unknownCallReviews.listReviews","value":"D/Q/page.cursor","verdict":"v2 允许","note":"分页源tests/helpers/B2-blocked-runtime.ts:281,287"},
  {"section":"A1签发字段","file":"tests/runtime/B2-05-06-denial.test.ts","line":[30],"owner":"completionPolicies；Runtime；unknownCallReviews.listReviews","value":"D/Q/page.cursor","verdict":"v2 允许","note":"分页源tests/helpers/B2-blocked-runtime.ts:281,287"},
  {"section":"A1签发字段","file":"tests/runtime/B2-09-allowance-crash.test.ts","line":[42,66],"owner":"completionPolicies；Runtime；unknownCallReviews.listReviews","value":"D/Q/page.cursor","verdict":"v2 允许","note":"分页源tests/helpers/B2-blocked-runtime.ts:281,287"},
  {"section":"A1签发字段","file":"tests/runtime/B2-13-allow-one-form.test.ts","line":[30],"owner":"completionPolicies；Runtime；unknownCallReviews.listReviews","value":"D/Q/page.cursor","verdict":"v2 允许","note":"分页源tests/helpers/B2-blocked-runtime.ts:281,287"},
  {"section":"A1签发字段","file":"tests/runtime/B2-15-replay.test.ts","line":[121,165],"owner":"completionPolicies；Runtime；unknownCallReviews.listReviews","value":"D/Q/page.cursor","verdict":"v2 允许","note":"分页源tests/helpers/B2-blocked-runtime.ts:281,287"},
  {"section":"A1签发字段","file":"tests/runtime/B2-16-hook-closure.test.ts","line":[50,92,106],"owner":"completionPolicies；Runtime；unknownCallReviews.listReviews","value":"D@50,92,106；Q及page.cursor@50","verdict":"v2 允许","note":"分页源tests/helpers/B2-blocked-runtime.ts:281,287"},
  {"section":"A1签发字段","file":"tests/runtime/B2-16-hook-reads.test.ts","line":[71,124],"owner":"completionPolicies；Runtime；unknownCallReviews.listReviews","value":"D/Q及helper.cursor@71；page.cursor@124","verdict":"v2 允许","note":"124使用130公开nextCursor"},
  {"section":"A1签发字段","file":"tests/runtime/B2-401-world.test.ts","line":[48],"owner":"completionPolicies；Runtime；unknownCallReviews.listReviews","value":"D/Q/page.cursor","verdict":"v2 允许","note":"分页源tests/helpers/B2-401-world.ts:248,254"},
  {"section":"A1签发字段","file":"tests/runtime/K3-12-review-round-tools.test.ts","line":[130,132],"owner":"completionPolicies；Runtime","value":"D@130；Q@132","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/K3-19-review-admission.test.ts","line":[127,142,143,159,246,255,258,278,318,347],"owner":"completionPolicies；Runtime/Workflow；propose_safer_method","value":"D@127,246,255,258；Q@142,143,159,278,318,347；item@159","verdict":"v2 允许","note":"公开prepared及review alias原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/K3-35-T-by-hand.test.ts","line":[102,155],"owner":"completionPolicies；Runtime","value":"D/Q","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/K3-35-approved-methods-brief.test.ts","line":[84],"owner":"completionPolicies；Runtime","value":"D/Q","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/K3-35-workspace-baseline-prepare.test.ts","line":[34,41],"owner":"completionPolicies；Runtime","value":"D@34；Q@41","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/K3-B3-cancellation-cancelled.test.ts","line":[92,94,148,150],"owner":"completionPolicies；Runtime","value":"D@92,148；Q@94,150","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/K3-B3-newest-request-order.test.ts","line":[71,74],"owner":"completionPolicies；Runtime","value":"D@71；Q@74","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/K3-merge-cancel-propagation.test.ts","line":[59,108,152],"owner":"completionPolicies；Runtime","value":"D@59；Q@108,152","verdict":"v2 允许","note":"公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/runtime/K3-review-preparation.test.ts","line":[141,169,171,215,254,355,397],"owner":"completionPolicies；Runtime；unknownCallReviews.listReviews","value":"D@169,215,254,355；Q@141,171,397；page.cursor@254","verdict":"v2 允许","note":"分页源tests/helpers/K3-crr-fixture.ts:111,117；准备返回原样"},
  {"section":"A1签发字段","file":"tests/runtime/RL-30-shell-resource-caps.test.ts","line":[36,51,63,76,86,96,106,120,144],"owner":"completionPolicies；Runtime","value":"D@36；Q@51,63,76,86,96,106,120,144","verdict":"v2 允许","note":"真实启动helper；公开准备返回"},
  {"section":"A1签发字段","file":"tests/runtime/RL-31-readonly-resource-caps.test.ts","line":[57,180,194,226,233,243,255,265],"owner":"completionPolicies；Runtime","value":"D@226；Q@57,180,194,233,243,255,265","verdict":"v2 允许","note":"真实Work/Query准备返回"},
  {"section":"A1签发字段","file":"tests/runtime/RL-35-36-sandbox-and-retry.test.ts","line":[40,46,58,88,97,106,140,149,166],"owner":"completionPolicies；Runtime；materials.openArtifact","value":"D@40,46,58；Q@88,97,106,140,149；reportRef@166","verdict":"v2 允许","note":"报告来源160,163,164；其他公开准备和安装返回"},
  {"section":"A1签发字段","file":"tests/runtime/S1-archive-files-brief.test.ts","line":[30,54,116,155,172,208],"owner":"completionPolicies；Runtime","value":"D@30；Q@54,116,155,172,208","verdict":"v2 允许","note":"真实启动helper；公开返回原样"},
  {"section":"A1签发字段","file":"tests/business/R5c-workflow.test.ts","line":[93,135],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实安装返回指纹"},
  {"section":"A1签发字段","file":"tests/business/S1-archive-flow.test.ts","line":[202],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实安装返回指纹"},
  {"section":"A1签发字段","file":"tests/business/S1-session-maintenance.test.ts","line":[206],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实安装返回指纹"},
  {"section":"A1签发字段","file":"tests/business/S5-decision-workflow.test.ts","line":[186,224],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实安装返回指纹"},
  {"section":"A1签发字段","file":"tests/business/S5R2-automation-cards.test.ts","line":[24],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实安装返回指纹"},
  {"section":"A1签发字段","file":"tests/business/S5R2-settings-replay.test.ts","line":[28,29],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实安装返回指纹"},
  {"section":"A1签发字段","file":"tests/business/WP1-continuation-handover.test.ts","line":[87,119,164,216,242,273,288,317,346,357,366,376,423,477,498,510,526],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实安装返回指纹"},
  {"section":"A1签发字段","file":"tests/runtime/C1-communication-tools.test.ts","line":[231],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实安装返回指纹"},
  {"section":"A1签发字段","file":"tests/runtime/K3-19-review-capability.test.ts","line":[50,116],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实安装返回指纹"},
  {"section":"A1签发字段","file":"tests/runtime/RL-32-check-resource-caps.test.ts","line":[43,74],"owner":"completionPolicies；materials.openArtifact","value":"D@43；reportRef@74","verdict":"v2 允许","note":"报告来自67真实检查返回及71,72提取"},
  {"section":"A1签发字段","file":"tests/runtime/S1-archive-cancelled-reader.test.ts","line":[40],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实安装返回指纹"},
  {"section":"A1签发字段","file":"tests/runtime/S4C-note-related-find.test.ts","line":[41,65,82],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实安装返回指纹"},
  {"section":"A1签发字段","file":"tests/runtime/S5-user-message-tools.test.ts","line":[34],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实安装返回指纹"},
  {"section":"A1签发字段","file":"tests/runtime/S5R2-agent-application.test.ts","line":[67],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实安装返回指纹"},

  {"section":"A7","file":"tests/runtime/S4C-note-tools.test.ts","line":[124,151,165,177,188,206,240],"owner":"buildNoteTools","value":"录制注记适配器","verdict":"v2 允许","note":"125,152,166,178,189,207,241仅映射、默认值、结果透传"},
  {"section":"A7","file":"tests/runtime/S4C-note-tools.test.ts","line":[114,215],"owner":"buildNoteTools","value":"元数据检查；schema拒绝检查","verdict":"A7 越界","note":"115—120及216—230超出.lead-ref/books/test-rule-sheet-v2.md:47—48明列用途"}
]
```

v2 允许 647，F1 71，F3 0，A7 越界 2，文件 138/138；枚举完整