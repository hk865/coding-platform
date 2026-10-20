按本轮的排除项，普通脚本回复、普通公开参数和上层手写 store 记录不列入。下面只判定 v2 改动涉及的输入，不表示整项测试符合其余规则；尤其，公开提案之后的内部状态断言仍受 v1 约束。依据：`.lead-ref/books/test-rule-sheet-v2.md:24`、`:29`、`:31`，`.lead-ref/books/test-rule-sheet-v1.md:76`。

路径默认以 `tests/scenarios/` 为根；`helpers/` 指 `tests/helpers/`。同文件的行号合并列出。计数单位为“位置＋值类”；组外 helper 在本组调用处计数，同一次调用中同类字段合并。重复说明同一个 F1 来源不重复计数。

一、A1 草稿和外部值

表中的共用来源：

- **种**：`seedAG2bWorkGraph[Through]` 构造完整草稿，调用真实提案和采用接口；草稿在 `helpers/AG2b-collaboration-fixture.ts:372`，提交在 `:461`，采用在 `:464`。
- **夹**：组外 fixture 中的完整草稿。基础 claim 草稿及真实提交见 `helpers/task-claim-fixture.ts:323`、`:344`、`:350`；K3 扩展见 `helpers/K3-review-card-fixture.ts:108`、`:122`、`:128`；其 S5 前置草稿见 `helpers/S5-decision-fixture.ts:738`、`:755`、`:946`；注记 fixture 的两份草稿见 `helpers/S4A-note-scope-fixture.ts:196`、`:212`、`:234`；R3e 草稿见 `helpers/R3e-evidence-fixture.ts:194`、`:209`。
- **公＋内**：提案、采用走真实公开 owner，但后续还读内部状态；共用检查入口见 `harness.ts:687`、`support/common.ts:245`、`:252`。这是后续路径说明，不在本轮重新枚举 F7。
- 接收 owner 的绑定见 `src/app/core-routes.ts:704`、`:705`、`:660`；草稿完整字段见 `src/contracts/plan.ts:200`；计划工具分支见 `src/core/agent-runtime/whiteboard-tools.ts:322`、`:329`。

| 文件及行号 | owner、值与契约核对 | 后续是否只走公开步骤 | 判定 |
|---|---|---|---|
| `A10-check-recovery.test.ts:103` | `plans.proposePlan`；种，完整 | 否；另读账本，`:116`、`:126` | v2 允许 |
| `A11-no-progress.test.ts:131、365` | `plans.proposePlan`；种；完整后继草稿，`:366`、`:368` 补任务和 assignment | 否；内部检查，`:133`；采用经 `support/receipts.ts:192` | v2 允许 |
| `A7-control.test.ts:111、182、382` | `plans.proposePlan`；前两处为基础夹，后一处为种；均完整 | 否；fixture 后续及内部读不因此获准 | v2 允许 |
| `A8-host-restart-attestation.test.ts:123` | `plans.proposePlan`；种，完整 | 否；`:160`、`:161` | v2 允许 |
| `A8-host-restart-lease.test.ts:56、88、286、316、366、460` | `plans.proposePlan`；种，完整 | 否；另读账本，`:518`、`:521` | v2 允许 |
| `A8-host-restart-paused.test.ts:747、866` | `plans.proposePlan`；种，完整 | 否；`:919`、`:927` | v2 允许 |
| `A8-host-restart.test.ts:429、584` | `plans.proposePlan`；种，完整 | 否；`:812`、`:820` | v2 允许 |
| `C6-unrelated-adoption.test.ts:68、76、242、319` | `propose_future_plan`、`apply_future_plan`、`plans.proposePlan`；工具初始空对象在发送前补齐；提案参数含完整 draft、reason、expected；采用参数来自真实工具返回，`:73`—`:76` | 否；`:72`、`:83`；host 采用检查见 `support/plan.ts:202` | v2 允许 |
| `C7-defer-reactivate.test.ts:104、108、140、182、284、437、519` | `plans.proposePlan`；完整 deferred/active 草稿；`:434`、`:516` 从公开 plan 复制草稿字段 | 否；`:133`、`:213`；共用提交后检查 `support/plan.ts:707` | v2 允许 |
| `C7-supersede-failed-task.test.ts:83、92、236、245、250` | 计划工具及 `plans.proposePlan`；完整替代/并行草稿；工具参数发送前补齐；采用参数来自 `:88`—`:90` 的真实工具结果 | 否；`:87`、`:98` | v2 允许 |
| `C8-human-stop-respected.test.ts:340、347、362` | 计划工具及 `plans.proposePlan`；完整并行任务、协调任务草稿；不是发送初始化空对象 | 否；公开采用在 `:366`，内部检查在 `:369` | v2 允许 |
| `K-R-interrupted-brief.test.ts:75` | `plans.proposePlan`；种，完整 | 公＋内；共用检查 `support/common.ts:245`、`:252` | v2 允许 |
| `K-W-fallback.test.ts:145` | `plans.proposePlan`；种，完整 | 公＋内；共用检查 `support/common.ts:245`、`:252` | v2 允许 |
| `K-W-workflow-close.test.ts:197` | `plans.proposePlan`；种，完整 | 公＋内；共用检查 `support/common.ts:245`、`:252` | v2 允许 |
| `K3-07-real-host-kill.test.ts:151` | `plans.proposePlan`；种，完整 | 是；公开推进到 start，`:152`、`:156` | v2 允许 |
| `K3-20-review-card-paging.test.ts:80` | `plans.proposePlan`；K3 夹及其基础草稿，完整 | 否；夹后续另接内部 records，`helpers/K3-review-card-fixture.ts:153` | v2 允许 |
| `K3-29-startup-answers.test.ts:116、149` | `plans.proposePlan`；同上 | 否；同上 | v2 允许 |
| `K3-29-startup-reconcile-2b.test.ts:198、228、257、289` | `plans.proposePlan`；同上 | 否；同上 | v2 允许 |
| `K3-42-unexpanded-r2.test.ts:158` | `plans.proposePlan`；完整草稿，仅调整 assignment；经 `hostAdopt` | 否；`support/plan.ts:202` | v2 允许 |
| `S2C-K-retired.test.ts:76` | `plans.proposePlan`；种，完整 | 公＋内；另有本节 A7 损坏路径，`:218` | v2 允许 |
| `S2C-K2-continue.test.ts:143、227` | `plans.proposePlan`；完整取消草稿及第二 Goal 草稿，`:141`、`:212` | 采用是公开的，`:148`、`:231`；随后 harness 默认内部检查，`harness.ts:687` | v2 允许 |
| `S2C-K2-controls.test.ts:88` | `plans.proposePlan`；种，完整 | 公＋内；`harness.ts:687` | v2 允许 |
| `S3-context-and-inputs.test.ts:261` | `plans.proposePlan`；draft 结构完整，但 `inputRequirements` 带测试预算的 artifact 摘要，`:194`、`:217` | 公开 apply 在 `:264`；不修复字段来源 | **F1** |
| `S3-query-graph.test.ts:286` | `plans.proposePlan`；完整 draft；artifact ref 是真实 `materials.storeArtifact` 返回的 `stored.ref`，`:318`、`:323` | 提案后公开 apply，`:289`；前置手写 Run 在 `:317`，属于本轮排除项 | v2 允许 |
| `S4C2-U6-note-card-e2e.test.ts:40、42、218、221` | `notes.writeNote`；完整 general/understanding note；helper 补 commandId、goalId、pointer 参数，`helpers/S4C2-note-card-fixture.ts:286`、`:292`，`helpers/S4A-note-scope-fixture.ts:328` | 是；公开卡片处置及读取，`:233`、`:237` | v2 允许 |
| `S4C2-U6-note-card-e2e.test.ts:55、79、110、135、149、163、194、216` | `plans.proposePlan`；注记夹内两份完整草稿 | 草稿公开采用；夹内后续造运行状态另属既有 F3，不在本轮重新列举 | v2 允许 |
| `S5-goal-conflict-rework.test.ts:192` | `plans.proposePlan`；`:195` 的完整后继 draft，经 `proposeCandidate` | 否；`:205` | v2 允许 |
| `S5-two-request-decisions.test.ts:120` | `plans.proposePlan`；`:121` 的完整替换候选 draft | 否；`:181`；receipt 另见第二节 | v2 允许 |
| `WP2-wiring-scenario.test.ts:76` | `plans.proposePlan`；`createWP2Platform` 调基础 claim 夹，`helpers/WP2-platform-support.ts:542`；本调用未打开第二世界、deferredGoal 分支 | 否；后续另有手写 health，`:243`、`:251`、`:257` | v2 允许 |
| `harness.ts:869、1020` | `plans.proposePlan`；种，完整 | 否；默认内部检查，`:687` | v2 允许 |
| `support/S5-decisions.ts:294、373、375、472、477` | `plans.proposePlan`；完整候选体、Q1/Q2 和模块草稿；真实 requestRef/replaces 分支，`:295`—`:298` | 公开采用入口 `:310`；调用测试仍有内部检查，`S5-two-request-decisions.test.ts:181` | v2 允许 |
| `support/common.ts:489` | `plans.proposePlan`；种，完整 | 公＋内；`:245`、`:252` | v2 允许 |
| `support/control.ts:94` | `plans.proposePlan`；种，完整 | 公＋内；另有 `:170` 的 prepared 来源违规 | v2 允许 |
| `support/fuzz.ts:1840、1842、2228、2703、2741` | `plans.proposePlan`；完整草稿；`futureDraftOf`/`draftOf` 只复制草稿字段，`:2018`、`:3202`；真实 owner 或委托包装，并非忽略输入的替身 | 否；公开 apply 后仍做 gate 检查，`:2708`、`:2711`、`:2726` | v2 允许 |
| `support/fuzz.ts:2184` | `plans.proposePlan`；R3e 夹及基础 claim 夹，完整 | 否；其后继续 fixture 的内部状态路径，`:2245` | v2 允许 |
| `support/gate.ts:266、364、520` | `plans.proposePlan`；完整初始/修复草稿；`:366` 虽有 `as never`，实际传入的是公开 verification 返回的完整 report ref，`C5-gate-fix.test.ts:72`、`:88` | 否；`:368`、`:372`、`:524`、`:529` | v2 允许 |
| `support/plan.ts:195、350、392、623、706` | `plans.proposePlan`；完整 host/C6/C7 草稿；`draftFrom` 不复制 compiler metadata，`support/common.ts:530` | 否；`:202`、`:356`、`:707` | v2 允许 |
| `support/receipts.ts:189` | `plans.proposePlan`；完整转交 `next.draft` | 是；真实 apply，`:192` | v2 允许 |
| `support/restart.ts:234` | `plans.proposePlan`；种，完整 | 公＋内；共用检查 `support/common.ts:245`、`:252` | v2 允许 |
| `support/rework.ts:250` | `plans.proposePlan`；完整 budget 草稿，`:173` | 公开 apply，`:253`；后续 drive 仍有内部检查 | v2 允许 |

二、A1 平台签发字段

为避免把同一个来源说明重复数百遍，表内使用以下字段名；每个名字同时指定 owner 和来源：

- **令**：HTTP 凭据。Host 从真实页面读取 token，`helpers/AG2b-collaboration-fixture.ts:263`、`:339`；请求原样使用，`:354`、`:357`，`helpers/A2-restart-fixture.ts:65`、`:72`。包括表内列出的组外 helper 调用点；不把其普通业务参数另算实例。
- **备**：交给 `runtime.startRun/startQuery` 或 `workflow.advanceWork` 的 prepared。来源是真实 prepare 或 Workflow 返回的下一步；`preparedOf` 只取并复制原返回值，`support/common.ts:295`、`:299`；驱动原样使用 `next`，`support/shell-work-root.ts:64`、`:69`，`support/review-work-root.ts:76`、`:82`。组外 Query helper 同样使用 prepare 原值，`helpers/AG2b-collaboration-fixture.ts:552`、`:555`；WP1 见 `helpers/WP1-scenario-fixture.ts:186`、`:192`、`:209`。
- **策**：交给 `completionPolicies.activateCompletionPolicy` 的 `target.digest`。来自真实 install 返回值；共用来源为 `helpers/AG2b-collaboration-fixture.ts:446`、`:450`，`helpers/task-claim-fixture.ts:258`、`:259`，`helpers/S5-decision-fixture.ts:638`、`:646`，`helpers/S4A-note-scope-fixture.ts:165`、`:168`，`helpers/R3e-evidence-fixture.ts:180`、`:182`。
- **物**：交给 `materials.openArtifact` 或计划 `reason.sources/inputRequirements` 的 artifact ref，含摘要。prepared manifest ref 原样传入，`support/brief.ts:115`、`:117`；C5 report ref 来自真实 verification 返回，`C5-gate-fix.test.ts:61`、`:72`、`:197`、`:202`；S3-query 的 ref 来自真实 store 返回，`S3-query-graph.test.ts:318`、`:323`；WP2 来自真实 prepare，`helpers/WP2-platform-support.ts:917`、`:920`。
- **游**：公开分页返回的 `nextCursor` 原样回传。来源见 `K3-20-review-card-paging.test.ts:68`，`S2C-K2-conversation.test.ts:60`、`:112`、`:135`、`:157`；`:146` 使用过期但未改造的返回 cursor，仍符合来源要求。
- **显**：`markNoticesSeen` 的 `displayToken/seenThrough`，来自公开队列返回，`S5-goal-conflict-rework.test.ts:160`、`:169`，`WP2-wiring-scenario.test.ts:220`、`:227`；helper 原样转交，`support/S5-decisions.ts:449`。
- **角**：`runtime.createSession` 的 role pin，取自公开 Session 读取结果并原样使用，`WP2-wiring-scenario.test.ts:124`、`:127`。

表中同文件的“字段：行号”均是该字段的使用位置。

| 文件 | 字段及行号 | 判定 |
|---|---|---|
| `A1-rework-same-session.test.ts` | 令：86,134,135 | v2 允许 |
| `A10-check-recovery.test.ts` | 令：103,107,109,146；策：103 | v2 允许 |
| `A11-no-progress.test.ts` | 令：131,143,158,172,192,193,514,520,652；备：707；策：131 | v2 允许 |
| `A4-duplicate-receipts.test.ts` | 令：434；备：376,441,494,507,517 | v2 允许 |
| `A7-control-goal29.test.ts` | 令：60,65,67,68,73,97,131,136,138,139,146,165,198 | v2 允许 |
| `A7-control.test.ts` | 令：252,261,265,271,273,278,280,281,285,288,292,294,300,331,332,349,352,356,377,379,382,384,386,388,391,396,399,403,410,411,418,432,436,440,466,469,475,480,488,492,494,500,512,543,548,556,560,570,585,590,616,622,636,661,670,676,682,701,714,719,724,730,755,756,779,785,787,817,843,846,849,850,869,871,875,885,893,895,896,904,908,912,928,931,946,948,950,968,977,994,1000,1001,1009,1012,1020,1023,1032,1039,1047,1051,1058,1089,1095,1102,1103,1115,1143,1147,1150,1153,1154,1160,1161,1165,1171,1186,1189,1192,1215,1218,1220,1226,1229,1242,1257,1279,1285,1290,1298,1327,1333,1342,1404,1411,1417,1433,1439,1456,1461,1463,1482,1484,1492,1503,1539；备：210,1089,1215,1285；策：111,182,382 | v2 允许 |
| `A8-host-restart-attestation.test.ts` | 令：66,123,124,125,126,135；备：126；策：123 | v2 允许 |
| `A8-host-restart-entry.test.ts` | 令：172,227,234,238,265,271,292,297,341,355,364；备：141,377,471 | v2 允许 |
| `A8-host-restart-lease.test.ts` | 令：56,88,89,90,91,96,105,106,119,123,129,155,169,182,200,201,225,240,259,286,316,334,335,338,342,345,347,366,367,368,369,370,371,389,391,395,397,409,422,424,434,460,461,462,463,478,484,489,494,496,499,503,508,519,525；备：91,164,215,371,463；策：56,88,286,316,366,460 | v2 允许 |
| `A8-host-restart-paused.test.ts` | 令：105,123,126,151,180,301,310,316,320,335,347,351,412,421,427,431,450,464,468,527,589,608,612,621,624,627,629,648,654,655,665,671,674,693,701,705,707,739,741,747,750,752,758,761,777,779,780,781,792,794,797,798,802,816,819,820,858,860,866,869,871,877,880,898,900,901,902,912,914,917,918,921,935,938,939；策：747,866 | v2 允许 |
| `A8-host-restart-rework.test.ts` | 令：44 | v2 允许 |
| `A8-host-restart.test.ts` | 令：152,222,295,303,304,310,340,342,368,369,391,392,404,407,429,432,435,448,451,455,461,467,484,486,506,512,516,536,546,553,584,585,588,591,594,595,608,609,611,637,646,650,652,657,661,670,694,709,713,727,730,734,738,757,792,798,799,817,821,827,832,835,840,842；备：93,138,166,236,374；策：429,584 | v2 允许 |
| `B2-09b-allowance-crash.test.ts` | 令：185；备：154；物：150 | v2 允许 |
| `C3-brief-idempotency.test.ts` | 备：124 | v2 允许 |
| `C3-not-entered-chain.test.ts` | 令：50 | v2 允许 |
| `C3-paused-continue-brief.test.ts` | 令：55,62,63,83,84,92,94,125,126 | v2 允许 |
| `C3-reply-other-session.test.ts` | 令：64,83,184 | v2 允许 |
| `C5-gate-fix.test.ts` | 物：88,162,206 | v2 允许 |
| `C7-defer-reactivate.test.ts` | 令：420,497,511,534；备：501 | v2 允许 |
| `C8-human-stop-respected.test.ts` | 令：76,108,168,188,193,217,232,234,265,295,432,446,448 | v2 允许 |
| `K-R-attested-facts-source.test.ts` | 令：50,55,58,82,85,97,186,217,223,234,259,265,271,291,300,315,325,360,368,383,390；备：135 | v2 允许 |
| `K-R-interrupted-brief.test.ts` | 令：49,52,53,59,60,66,67,75,80,83,113,150；策：75 | v2 允许 |
| `K-W-fallback.test.ts` | 令：80,82,84,117,125,126,128,145,146,147,148,149,150,162；备：150；策：145 | v2 允许 |
| `K-W-maintenance.test.ts` | 令：40,45,48,149,170,178,197,204,218,229,256,263,268,272,284,308,314,328,338,342 | v2 允许 |
| `K-W-workflow-close.test.ts` | 令：179,182,183,188,189,197,202,205,243,253,255,273,280,282,304,310,312,330,337,339,360,362,386,390,392,393,419,422,424,425,445,459,476,481,483,484,501,521,527；策：197 | v2 允许 |
| `K3-05-review-round.test.ts` | 令：145,154,187；备：100,152 | v2 允许 |
| `K3-06-mixed-batch.test.ts` | 令：212,233,267；备：151,210 | v2 允许 |
| `K3-07-real-host-kill.test.ts` | 令：151,152,156,223；备：156；策：151 | v2 允许 |
| `K3-08-wait-reply.test.ts` | 令：122,141,162,215,259,284；备：109,211,257；物：186 | v2 允许 |
| `K3-09-restart-between-calls.test.ts` | 令：230,284,294；备：117,160,204,268 | v2 允许 |
| `K3-10-review-round-cells.test.ts` | 令：321；备：133,168,283 | v2 允许 |
| `K3-11-review-reasons-r2.test.ts` | 令：148,153,201,206,245,271,323,354；备：130,174,241,268,321,345,389 | v2 允许 |
| `K3-12-14-review-round.test.ts` | 备：145,198,258 | v2 允许 |
| `K3-13-two-commands.test.ts` | 令：138；备：94,134 | v2 允许 |
| `K3-16-approval-round.test.ts` | 备：132；物：222 | v2 允许 |
| `K3-16-proposal-round.test.ts` | 备：143,197；物：132 | v2 允许 |
| `K3-17-review-answer-shape.test.ts` | 令：175；备：96；物：268 | v2 允许 |
| `K3-18-one-card.test.ts` | 令：105；备：123,156 | v2 允许 |
| `K3-19-missing-read-no-round.test.ts` | 备：124 | v2 允许 |
| `K3-19-review-unavailable.test.ts` | 令：192,197,245,250；备：112,217 | v2 允许 |
| `K3-20-review-card-paging.test.ts` | 策：80；游：63 | v2 允许 |
| `K3-25-attestation-replay.test.ts` | 令：85；备：79 | v2 允许 |
| `K3-26-inventory-scenarios.test.ts` | 令：175,221,258,278,299,321,354,397,433,513；备：212,256,292,345,385,420,464,502 | v2 允许 |
| `K3-27-review-claim-close.test.ts` | 令：125,126,154,312；备：143,215,295；物：289,309 | v2 允许 |
| `K3-28-attested-continuation.test.ts` | 令：92,123,140；备：87,121；物：135 | v2 允许 |
| `K3-29-disposition-recovery.test.ts` | 令：352,359,364,382；备：96 | v2 允许 |
| `K3-29-extras.test.ts` | 令：36,55,58,65,86,88,90,98,99,111,113,121,125 | v2 允许 |
| `K3-29-maintenance-review-run.test.ts` | 令：135,147,162,182,197,217,220；备：105,176 | v2 允许 |
| `K3-29-recovery-continuation.test.ts` | 令：203,287,375,468；备：117,383,414,435,496 | v2 允许 |
| `K3-29-recovery-round.test.ts` | 令：327,419,422,425,437,440,503,596,612,668,703,714,719,746；备：169,214,265,358,415,476,521,582,631,666,711；物：625 | v2 允许 |
| `K3-29-startup-answers.test.ts` | 策：116,149 | v2 允许 |
| `K3-29-startup-reconcile-2b.test.ts` | 策：198,228,257,289 | v2 允许 |
| `K3-29-startup-variants.test.ts` | 备：217 | v2 允许 |
| `K3-37-stopped-review-round.test.ts` | 令：167,188,191,242,261,264,272,329,332,340；备：131,184,257,326 | v2 允许 |
| `K3-42-truncated-command.test.ts` | 令：231；备：187,229；物：224 | v2 允许 |
| `K3-42-unexpanded-r2.test.ts` | 令：223；备：177,221；物：210 | v2 允许 |
| `K3-44-crr-kind4.test.ts` | 备：171 | v2 允许 |
| `K3-44-hold-restart.test.ts` | 备：89,133 | v2 允许 |
| `K3-44-recovery-answers.test.ts` | 令：331；备：97 | v2 允许 |
| `K3-45-review-incomplete-r2.test.ts` | 令：199,201,212,246,256；备：140,191,240 | v2 允许 |
| `K3-R1-continuation-protection.test.ts` | 备：178,213,249；物：114 | v2 允许 |
| `K3-R1-file-change.test.ts` | 备：159,247；物：179,287 | v2 允许 |
| `K3-R1-restart-flows.test.ts` | 令：86,111,177；备：95,122；物：139,192 | v2 允许 |
| `K3-R1-second-cleanup.test.ts` | 令：198,231；备：165,196,219 | v2 允许 |
| `K3-R1-session-not-closable.test.ts` | 令：68；备：78 | v2 允许 |
| `K3-R1-workspace-capture.test.ts` | 令：193；备：178 | v2 允许 |
| `K3-r1-seams.test.ts` | 令：164；备：173 | v2 允许 |
| `S1-archive-restart.test.ts` | 令：357；备：57 | v2 允许 |
| `S1-wait-copy-retirement.test.ts` | 令：40,85,128,153 | v2 允许 |
| `S2C-K-archive-interruption.test.ts` | 令：38,61；备：34 | v2 允许 |
| `S2C-K-archive-tags-checks.test.ts` | 令：78,154,172,365；备：150,246,296,361 | v2 允许 |
| `S2C-K-archive-tags.test.ts` | 令：40,90,143；备：36 | v2 允许 |
| `S2C-K-goal-pause.test.ts` | 令：34,52,72 | v2 允许 |
| `S2C-K-paused-run24.test.ts` | 令：36,46,79,97,114,130,140,144,171；备：111 | v2 允许 |
| `S2C-K-retired.test.ts` | 令：46,52,59,76,77,78,79,132,135,161,177,216,220,265,270,277；备：79,128,157,212；策：76 | v2 允许 |
| `S2C-K-unknown-outcome.test.ts` | 令：56,59,74,77,111,121,132,180,187,192；备：52,70 | v2 允许 |
| `S2C-K2-continue.test.ts` | 令：42,47,77,82,87,89,121,131,136,192,198,257,261,263,268,315；备：238,247 | v2 允许 |
| `S2C-K2-controls.test.ts` | 令：58,68,88,89,90,91,104,113,114,132,138,162,167；备：54,91,158；策：88 | v2 允许 |
| `S2C-K2-conversation.test.ts` | 令：45,86,129,176；备：172；游：56,108,146,153 | v2 允许 |
| `S2C-K2-gate-checks.test.ts` | 令：75,79 | v2 允许 |
| `S2C-K2-paused-archive.test.ts` | 令：46,51,59,97 | v2 允许 |
| `S2C-K2-paused-transfer.test.ts` | 令：38,43,48,50；备：71 | v2 允许 |
| `S2C-K2-query-not-entered.test.ts` | 令：42,46,47,49；备：55 | v2 允许 |
| `S3-context-and-inputs.test.ts` | 备：304；策：250 | v2 允许 |
| `S3-query-graph.test.ts` | 备：336；策：275；物：286 | v2 允许 |
| `S4C2-U6-note-card-e2e.test.ts` | 策：55,79,110,135,149,163,194,216 | v2 允许 |
| `S5-goal-conflict-rework.test.ts` | 显：170 | v2 允许 |
| `WP1-wiring.test.ts` | 备：48,104,149 | v2 允许 |
| `WP2-wiring-scenario.test.ts` | 令：177；备：49；策：76；物：133,161；显：236；角：126 | v2 允许 |
| `harness.test.ts` | 备：106 | v2 允许 |
| `harness.ts` | 令：659,1020,1050,1082,1084,1089；备：1175,1301；策：869,1020 | v2 允许 |
| `support/S5-decisions.ts` | 显：448 | v2 允许 |
| `support/brief.ts` | 物：116,124 | v2 允许 |
| `support/common.ts` | 令：151,156,171,189,190,195,199,221,470,473,475,478,479,489,502,505,507；备：221,647,784；策：489 | v2 允许 |
| `support/control.ts` | 令：94,100,108,112,121,136,137,145,151,165,170；策：94 | v2 允许 |
| `support/fuzz.ts` | 令：1961；备：771,933；策：2184 | v2 允许 |
| `support/gate.ts` | 备：310；策：248；物：364,520 | v2 允许 |
| `support/plan.ts` | 备：427,658；策：338,611 | v2 允许 |
| `support/receipts.ts` | 令：93,206；备：51,99 | v2 允许 |
| `support/restart.ts` | 令：225,234,238；备：238；策：234 | v2 允许 |
| `support/review-card-round.ts` | 备：68,103 | v2 允许 |
| `support/review-work-root.ts` | 备：76 | v2 允许 |
| `support/rework.ts` | 备：267；策：238 | v2 允许 |
| `support/control.ts:170` | `prepared` 从 `:165` 读出的 execution 记录重拼；`:171` 拼 claim、envelope、inputBinding；调用方 `A7-control.test.ts:287` | **F1：从记录重建** |
| `support/fuzz.ts:1553` | `prepared` 从 `:1546`—`:1548` 的 execution 记录重拼，拼接在 `:1554` | **F1：从记录重建** |
| `support/S5-decisions.ts:434` | `receipt.identityKey/fingerprint/cursor` 来自 `s5CommitReceipt` 的 SQLite idempotency 查询和拼装，`:148`、`:151`、`:154`；调用方取值在 `S5-two-request-decisions.test.ts:141`，消费在 `:163` | **F1：从账本重建 receipt** |
| `support/common.ts:712` | credential 是 `:704` 的字面量 `plan-board-route-token`；`:705` 将同一值配入服务器；调用方 `C7-supersede-failed-task.test.ts:133` | **F1：测试自行签发** |
| `S3-context-and-inputs.test.ts:261` | draft 内 artifact digest/size 来自 `legacyArtifactRef`，`:192`、`:194`；真实存储晚于提案，`:329` | **F1：测试预先生成签发字段** |
| `support/fuzz.ts:2241` | `target.digest` 来自内部 world 的 Plan，`:2235`；`:2243` 复制 `effectiveCompletionPolicy`，不是 install 返回值 | **F1：从内部记录恢复签发值** |

三、record-store 自身测试

| 范围 | 本组实例 | 判定 |
|---|---|---|
| L1 专属条款 | 无。L2 清单是 scenarios 及其 support，`.lead-ref/groups/L2-files.txt:1`、`:117`；上层手写记录按本轮要求排除 | 不计 F3 |

四、A7

| 文件及行号 | 使用及边界核对 | 判定 |
|---|---|---|
| `S2C-K-unknown-outcome.test.ts:75、157、179` | `damageKernel` 及两处间接调用；只损坏临时 `kernel.sqlite` 的记录 JSON，`:39`、`:41` | v2 允许 |
| `S2C-K-retired.test.ts:218、248、298` | moved `damageKernel`、间接调用及 damaged 参数化实例；目标是临时 `kernel.sqlite`，`:194`、`:196` | v2 允许 |
| `K3-29-disposition-recovery.test.ts:50` | process stand-in；默认和重置为 `executeChecks:false`，`:46`、`:68` | v2 允许 |
| `K3-44-recovery-answers.test.ts:51` | process stand-in；默认和重置为 false，`:47`、`:69` | v2 允许 |
| `K3-44-crr-kind4.test.ts:53` | process stand-in；默认和重置为 false，`:49`、`:74` | v2 允许 |
| `K3-29-disposition-recovery.test.ts:185` | 打开 `executeChecks`，进入执行命令、返回结果的分支；实现见 `support/process-sandbox-standin.ts:49`、`:59`、`:64` | **A7 越界** |
| `K3-44-recovery-answers.test.ts:267` | 同上 | **A7 越界** |

`support/process-sandbox-standin.ts:38` 是上述 probe 的定义支撑，不另算调用实例；false 分支在 `:42`、`:44`，执行拒绝在 `:49`。本组没有 `buildNoteTools` 使用；其许可文件限定见 `.lead-ref/books/test-rule-sheet-v2.md:45`。

无实例文件：下列文件没有本轮四类实例；组内共用 helper 的实例已在其定义处列出。

- `C3-workspace-changed.test.ts:38`
- `C5-gate-fix-open.test.ts:53`
- `C5-reverify-guards.test.ts:74`
- `C8-auto-rework-cap.test.ts:38`
- `C8-budget.test.ts:52`
- `K3-15-card-hold.test.ts:115`
- `K3-store-wrapper-seam.test.ts:28`
- `S2C-K-legacy-provenance.test.ts:39`
- `support/git-workspace.ts:67`
- `support/shell-work-root.ts:60`

JSON 中，第二节的 `line` 按上文已定义的字段名分组；数组保留每个使用位置。第一节的“种、夹”沿用上文来源说明。

```json
[
  {"section":"1","file":"tests/scenarios/A10-check-recovery.test.ts","line":[103],"owner":"plans.proposePlan","value":"种：完整 PlanRevisionDraft","verdict":"v2 允许","note":"公开提案及采用；后续内部读见本表"},
  {"section":"1","file":"tests/scenarios/A11-no-progress.test.ts","line":[131,365],"owner":"plans.proposePlan","value":"种及完整后继草稿","verdict":"v2 允许","note":"公开采用；后续内部检查"},
  {"section":"1","file":"tests/scenarios/A7-control.test.ts","line":[111,182,382],"owner":"plans.proposePlan","value":"基础夹及种的完整草稿","verdict":"v2 允许","note":"真实 owner；整例不只走公开步骤"},
  {"section":"1","file":"tests/scenarios/A8-host-restart-attestation.test.ts","line":[123],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；后续内部读"},
  {"section":"1","file":"tests/scenarios/A8-host-restart-lease.test.ts","line":[56,88,286,316,366,460],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；后续内部读"},
  {"section":"1","file":"tests/scenarios/A8-host-restart-paused.test.ts","line":[747,866],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；后续内部检查"},
  {"section":"1","file":"tests/scenarios/A8-host-restart.test.ts","line":[429,584],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；后续内部检查"},
  {"section":"1","file":"tests/scenarios/C6-unrelated-adoption.test.ts","line":[68,76,242,319],"owner":"propose_future_plan、apply_future_plan、plans.proposePlan","value":"完整草稿及计划工具参数","verdict":"v2 允许","note":"空对象在发送前补齐；后续内部检查"},
  {"section":"1","file":"tests/scenarios/C7-defer-reactivate.test.ts","line":[104,108,140,182,284,437,519],"owner":"plans.proposePlan","value":"完整 deferred/active 草稿","verdict":"v2 允许","note":"真实提案/采用；后续内部检查"},
  {"section":"1","file":"tests/scenarios/C7-supersede-failed-task.test.ts","line":[83,92,236,245,250],"owner":"propose_future_plan、apply_future_plan、plans.proposePlan","value":"完整替代/并行草稿及工具参数","verdict":"v2 允许","note":"发送前补齐；采用参数来自真实工具结果；后续内部检查"},
  {"section":"1","file":"tests/scenarios/C8-human-stop-respected.test.ts","line":[340,347,362],"owner":"propose_future_plan、apply_future_plan、plans.proposePlan","value":"完整并行/协调任务草稿及工具参数","verdict":"v2 允许","note":"公开采用；后续内部检查"},
  {"section":"1","file":"tests/scenarios/K-R-interrupted-brief.test.ts","line":[75],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；公开推进加内部检查"},
  {"section":"1","file":"tests/scenarios/K-W-fallback.test.ts","line":[145],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；公开推进加内部检查"},
  {"section":"1","file":"tests/scenarios/K-W-workflow-close.test.ts","line":[197],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；公开推进加内部检查"},
  {"section":"1","file":"tests/scenarios/K3-07-real-host-kill.test.ts","line":[151],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；随后公开推进"},
  {"section":"1","file":"tests/scenarios/K3-20-review-card-paging.test.ts","line":[80],"owner":"plans.proposePlan","value":"K3 夹及基础完整草稿","verdict":"v2 允许","note":"真实提案/采用；夹的内部状态路径另受原规则约束"},
  {"section":"1","file":"tests/scenarios/K3-29-startup-answers.test.ts","line":[116,149],"owner":"plans.proposePlan","value":"K3 夹及基础完整草稿","verdict":"v2 允许","note":"真实提案/采用；后续非纯公开路径"},
  {"section":"1","file":"tests/scenarios/K3-29-startup-reconcile-2b.test.ts","line":[198,228,257,289],"owner":"plans.proposePlan","value":"K3 夹及基础完整草稿","verdict":"v2 允许","note":"真实提案/采用；后续非纯公开路径"},
  {"section":"1","file":"tests/scenarios/K3-42-unexpanded-r2.test.ts","line":[158],"owner":"plans.proposePlan","value":"完整 assignment 修改草稿","verdict":"v2 允许","note":"hostAdopt 真实采用后检查内部状态"},
  {"section":"1","file":"tests/scenarios/S2C-K-retired.test.ts","line":[76],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；后续另有 A7 路径"},
  {"section":"1","file":"tests/scenarios/S2C-K2-continue.test.ts","line":[143,227],"owner":"plans.proposePlan","value":"完整取消草稿及第二 Goal 草稿","verdict":"v2 允许","note":"公开采用；harness 后续内部检查"},
  {"section":"1","file":"tests/scenarios/S2C-K2-controls.test.ts","line":[88],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；harness 后续内部检查"},
  {"section":"1","file":"tests/scenarios/S3-context-and-inputs.test.ts","line":[261],"owner":"plans.proposePlan","value":"含测试预算 artifact 摘要的草稿","verdict":"F1","note":"结构完整但字段来源不合；与第二节同一 F1，不重复计数"},
  {"section":"1","file":"tests/scenarios/S3-query-graph.test.ts","line":[286],"owner":"plans.proposePlan","value":"完整草稿及真实存储返回的 artifact ref","verdict":"v2 允许","note":"公开采用；前置手写 Run 属本轮排除项"},
  {"section":"1","file":"tests/scenarios/S4C2-U6-note-card-e2e.test.ts","line":[40,42,218,221],"owner":"notes.writeNote","value":"完整 general/understanding note","verdict":"v2 允许","note":"helper 补齐真实参数契约；后续公开卡片处置和读取"},
  {"section":"1","file":"tests/scenarios/S4C2-U6-note-card-e2e.test.ts","line":[55,79,110,135,149,163,194,216],"owner":"plans.proposePlan","value":"注记夹内两份完整草稿","verdict":"v2 允许","note":"真实提案/采用；夹内后续运行状态构造另受原规则约束"},
  {"section":"1","file":"tests/scenarios/S5-goal-conflict-rework.test.ts","line":[192],"owner":"plans.proposePlan","value":"完整后继候选草稿","verdict":"v2 允许","note":"后续内部检查"},
  {"section":"1","file":"tests/scenarios/S5-two-request-decisions.test.ts","line":[120],"owner":"plans.proposePlan","value":"完整替换候选草稿","verdict":"v2 允许","note":"后续内部检查；receipt 另列 F1"},
  {"section":"1","file":"tests/scenarios/WP2-wiring-scenario.test.ts","line":[76],"owner":"plans.proposePlan","value":"基础 claim 夹完整草稿","verdict":"v2 允许","note":"未启用额外第二世界和 deferredGoal；后续非纯公开路径"},
  {"section":"1","file":"tests/scenarios/harness.ts","line":[869,1020],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；默认内部检查"},
  {"section":"1","file":"tests/scenarios/support/S5-decisions.ts","line":[294,373,375,472,477],"owner":"plans.proposePlan","value":"完整候选体、Q1/Q2 和模块草稿","verdict":"v2 允许","note":"真实 requestRef/replaces 分支；调用测试后续内部检查"},
  {"section":"1","file":"tests/scenarios/support/common.ts","line":[489],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；公开推进加内部检查"},
  {"section":"1","file":"tests/scenarios/support/control.ts","line":[94],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；prepared 重建另列 F1"},
  {"section":"1","file":"tests/scenarios/support/fuzz.ts","line":[1840,1842,2228,2703,2741],"owner":"plans.proposePlan","value":"完整 future draft","verdict":"v2 允许","note":"真实 owner 或委托包装；后续 gate 内部检查"},
  {"section":"1","file":"tests/scenarios/support/fuzz.ts","line":[2184],"owner":"plans.proposePlan","value":"R3e 夹及基础夹完整草稿","verdict":"v2 允许","note":"公开提案/采用；后续内部 fixture 路径"},
  {"section":"1","file":"tests/scenarios/support/gate.ts","line":[266,364,520],"owner":"plans.proposePlan","value":"完整初始/修复草稿","verdict":"v2 允许","note":"as never 处实际为完整公开 report ref；后续内部检查"},
  {"section":"1","file":"tests/scenarios/support/plan.ts","line":[195,350,392,623,706],"owner":"plans.proposePlan","value":"完整 host/C6/C7 草稿","verdict":"v2 允许","note":"不复制 compiler metadata；后续内部检查"},
  {"section":"1","file":"tests/scenarios/support/receipts.ts","line":[189],"owner":"plans.proposePlan","value":"完整 next.draft","verdict":"v2 允许","note":"随后真实 applyPlanChange"},
  {"section":"1","file":"tests/scenarios/support/restart.ts","line":[234],"owner":"plans.proposePlan","value":"种","verdict":"v2 允许","note":"完整；公开推进加内部检查"},
  {"section":"1","file":"tests/scenarios/support/rework.ts","line":[250],"owner":"plans.proposePlan","value":"完整 budget 草稿","verdict":"v2 允许","note":"公开采用；后续 drive 有内部检查"},

  {"section":"2","file":"tests/scenarios/A1-rework-same-session.test.ts","line":{"令":[86,134,135]},"owner":"HTTP 路由","value":"凭据","verdict":"v2 允许","note":"真实页面返回，helper 原样使用"},
  {"section":"2","file":"tests/scenarios/A10-check-recovery.test.ts","line":{"令":[103,107,109,146],"策":[103]},"owner":"HTTP 路由、completionPolicies","value":"凭据、target.digest","verdict":"v2 允许","note":"公开返回原值；来源见字段说明"},
  {"section":"2","file":"tests/scenarios/A11-no-progress.test.ts","line":{"令":[131,143,158,172,192,193,514,520,652],"备":[707],"策":[131]},"owner":"HTTP 路由、Workflow、completionPolicies","value":"凭据、prepared、target.digest","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/A4-duplicate-receipts.test.ts","line":{"令":[434],"备":[376,441,494,507,517]},"owner":"HTTP 路由、Workflow","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值，含原请求重试"},
  {"section":"2","file":"tests/scenarios/A7-control-goal29.test.ts","line":{"令":[60,65,67,68,73,97,131,136,138,139,146,165,198]},"owner":"HTTP 路由","value":"凭据","verdict":"v2 允许","note":"真实页面返回，helper 原样使用"},
  {"section":"2","file":"tests/scenarios/A7-control.test.ts","line":{"令":[252,261,265,271,273,278,280,281,285,288,292,294,300,331,332,349,352,356,377,379,382,384,386,388,391,396,399,403,410,411,418,432,436,440,466,469,475,480,488,492,494,500,512,543,548,556,560,570,585,590,616,622,636,661,670,676,682,701,714,719,724,730,755,756,779,785,787,817,843,846,849,850,869,871,875,885,893,895,896,904,908,912,928,931,946,948,950,968,977,994,1000,1001,1009,1012,1020,1023,1032,1039,1047,1051,1058,1089,1095,1102,1103,1115,1143,1147,1150,1153,1154,1160,1161,1165,1171,1186,1189,1192,1215,1218,1220,1226,1229,1242,1257,1279,1285,1290,1298,1327,1333,1342,1404,1411,1417,1433,1439,1456,1461,1463,1482,1484,1492,1503,1539],"备":[210,1089,1215,1285],"策":[111,182,382]},"owner":"HTTP 路由、runtime、Workflow、completionPolicies","value":"凭据、prepared、target.digest","verdict":"v2 允许","note":"公开返回原值；287 的重建 prepared 计在 support/control.ts:170"},
  {"section":"2","file":"tests/scenarios/A8-host-restart-attestation.test.ts","line":{"令":[66,123,124,125,126,135],"备":[126],"策":[123]},"owner":"HTTP 路由、runtime.startQuery、completionPolicies","value":"凭据、prepared、target.digest","verdict":"v2 允许","note":"组外 startBusyQuery 使用真实 prepare 返回"},
  {"section":"2","file":"tests/scenarios/A8-host-restart-entry.test.ts","line":{"令":[172,227,234,238,265,271,292,297,341,355,364],"备":[141,377,471]},"owner":"HTTP 路由、runtime、Workflow","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/A8-host-restart-lease.test.ts","line":{"令":[56,88,89,90,91,96,105,106,119,123,129,155,169,182,200,201,225,240,259,286,316,334,335,338,342,345,347,366,367,368,369,370,371,389,391,395,397,409,422,424,434,460,461,462,463,478,484,489,494,496,499,503,508,519,525],"备":[91,164,215,371,463],"策":[56,88,286,316,366,460]},"owner":"HTTP 路由、runtime.startQuery、completionPolicies","value":"凭据、prepared、target.digest","verdict":"v2 允许","note":"公开返回原值；338 仅列凭据，不把拒绝用空 prepared 算入新读法"},
  {"section":"2","file":"tests/scenarios/A8-host-restart-paused.test.ts","line":{"令":[105,123,126,151,180,301,310,316,320,335,347,351,412,421,427,431,450,464,468,527,589,608,612,621,624,627,629,648,654,655,665,671,674,693,701,705,707,739,741,747,750,752,758,761,777,779,780,781,792,794,797,798,802,816,819,820,858,860,866,869,871,877,880,898,900,901,902,912,914,917,918,921,935,938,939],"策":[747,866]},"owner":"HTTP 路由、completionPolicies","value":"凭据、target.digest","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/A8-host-restart-rework.test.ts","line":{"令":[44]},"owner":"HTTP 路由","value":"凭据","verdict":"v2 允许","note":"组外 claimQueryOn 原样使用 Host token"},
  {"section":"2","file":"tests/scenarios/A8-host-restart.test.ts","line":{"令":[152,222,295,303,304,310,340,342,368,369,391,392,404,407,429,432,435,448,451,455,461,467,484,486,506,512,516,536,546,553,584,585,588,591,594,595,608,609,611,637,646,650,652,657,661,670,694,709,713,727,730,734,738,757,792,798,799,817,821,827,832,835,840,842],"备":[93,138,166,236,374],"策":[429,584]},"owner":"HTTP 路由、runtime、Workflow、completionPolicies","value":"凭据、prepared、target.digest","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/B2-09b-allowance-crash.test.ts","line":{"令":[185],"备":[154],"物":[150]},"owner":"HTTP 路由、runtime.startRun、materials.openArtifact","value":"凭据、prepared、bundleRef","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/C3-brief-idempotency.test.ts","line":{"备":[124]},"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"真实重复 prepare 的返回值"},
  {"section":"2","file":"tests/scenarios/C3-not-entered-chain.test.ts","line":{"令":[50]},"owner":"HTTP 路由","value":"凭据","verdict":"v2 允许","note":"公开 Host token 原样使用"},
  {"section":"2","file":"tests/scenarios/C3-paused-continue-brief.test.ts","line":{"令":[55,62,63,83,84,92,94,125,126]},"owner":"HTTP 路由","value":"凭据","verdict":"v2 允许","note":"公开 Host token 原样使用"},
  {"section":"2","file":"tests/scenarios/C3-reply-other-session.test.ts","line":{"令":[64,83,184]},"owner":"HTTP 路由","value":"凭据","verdict":"v2 允许","note":"公开 Host token 原样使用"},
  {"section":"2","file":"tests/scenarios/C5-gate-fix.test.ts","line":{"物":[88,162,206]},"owner":"plans.proposePlan、materials.openArtifact","value":"reportRef","verdict":"v2 允许","note":"真实 verification 返回，未重建摘要"},
  {"section":"2","file":"tests/scenarios/C7-defer-reactivate.test.ts","line":{"令":[420,497,511,534],"备":[501]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/C8-human-stop-respected.test.ts","line":{"令":[76,108,168,188,193,217,232,234,265,295,432,446,448]},"owner":"HTTP 路由","value":"凭据","verdict":"v2 允许","note":"公开 Host token 原样使用"},
  {"section":"2","file":"tests/scenarios/K-R-attested-facts-source.test.ts","line":{"令":[50,55,58,82,85,97,186,217,223,234,259,265,271,291,300,315,325,360,368,383,390],"备":[135]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K-R-interrupted-brief.test.ts","line":{"令":[49,52,53,59,60,66,67,75,80,83,113,150],"策":[75]},"owner":"HTTP 路由、completionPolicies","value":"凭据、target.digest","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K-W-fallback.test.ts","line":{"令":[80,82,84,117,125,126,128,145,146,147,148,149,150,162],"备":[150],"策":[145]},"owner":"HTTP 路由、runtime.startQuery、completionPolicies","value":"凭据、prepared、target.digest","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K-W-maintenance.test.ts","line":{"令":[40,45,48,149,170,178,197,204,218,229,256,263,268,272,284,308,314,328,338,342]},"owner":"HTTP 路由","value":"凭据","verdict":"v2 允许","note":"公开 Host token 原样使用"},
  {"section":"2","file":"tests/scenarios/K-W-workflow-close.test.ts","line":{"令":[179,182,183,188,189,197,202,205,243,253,255,273,280,282,304,310,312,330,337,339,360,362,386,390,392,393,419,422,424,425,445,459,476,481,483,484,501,521,527],"策":[197]},"owner":"HTTP 路由、completionPolicies","value":"凭据、target.digest","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-05-review-round.test.ts","line":{"令":[145,154,187],"备":[100,152]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-06-mixed-batch.test.ts","line":{"令":[212,233,267],"备":[151,210]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-07-real-host-kill.test.ts","line":{"令":[151,152,156,223],"备":[156],"策":[151]},"owner":"HTTP 路由、Workflow、completionPolicies","value":"凭据、prepared、target.digest","verdict":"v2 允许","note":"token 由本文件146读真实页面；其余公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-08-wait-reply.test.ts","line":{"令":[122,141,162,215,259,284],"备":[109,211,257],"物":[186]},"owner":"HTTP 路由、runtime.startRun、materials.openArtifact","value":"凭据、prepared、bundleRef","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-09-restart-between-calls.test.ts","line":{"令":[230,284,294],"备":[117,160,204,268]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-10-review-round-cells.test.ts","line":{"令":[321],"备":[133,168,283]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-11-review-reasons-r2.test.ts","line":{"令":[148,153,201,206,245,271,323,354],"备":[130,174,241,268,321,345,389]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-12-14-review-round.test.ts","line":{"备":[145,198,258]},"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"公开 prepare/Workflow 原返回"},
  {"section":"2","file":"tests/scenarios/K3-13-two-commands.test.ts","line":{"令":[138],"备":[94,134]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-16-approval-round.test.ts","line":{"备":[132],"物":[222]},"owner":"runtime.startRun、materials.openArtifact","value":"prepared、bundleRef","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-16-proposal-round.test.ts","line":{"备":[143,197],"物":[132]},"owner":"runtime.startRun、materials.openArtifact","value":"prepared、bundleRef","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-17-review-answer-shape.test.ts","line":{"令":[175],"备":[96],"物":[268]},"owner":"HTTP 路由、runtime.startRun、materials.openArtifact","value":"凭据、prepared、bundleRef","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-18-one-card.test.ts","line":{"令":[105],"备":[123,156]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-19-missing-read-no-round.test.ts","line":{"备":[124]},"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"公开 prepare/Workflow 原返回"},
  {"section":"2","file":"tests/scenarios/K3-19-review-unavailable.test.ts","line":{"令":[192,197,245,250],"备":[112,217]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-20-review-card-paging.test.ts","line":{"策":[80],"游":[63]},"owner":"completionPolicies、decisions.queryDecisionQueue","value":"target.digest、cursor","verdict":"v2 允许","note":"真实 install 返回；cursor 取本文件68的 nextCursor"},
  {"section":"2","file":"tests/scenarios/K3-25-attestation-replay.test.ts","line":{"令":[85],"备":[79]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-26-inventory-scenarios.test.ts","line":{"令":[175,221,258,278,299,321,354,397,433,513],"备":[212,256,292,345,385,420,464,502]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-27-review-claim-close.test.ts","line":{"令":[125,126,154,312],"备":[143,215,295],"物":[289,309]},"owner":"HTTP 路由、runtime.startRun、materials.openArtifact","value":"凭据、prepared、bundleRef","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-28-attested-continuation.test.ts","line":{"令":[92,123,140],"备":[87,121],"物":[135]},"owner":"HTTP 路由、runtime.startRun、materials.openArtifact","value":"凭据、prepared、bundleRef","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-29-disposition-recovery.test.ts","line":{"令":[352,359,364,382],"备":[96]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值；A7 另列"},
  {"section":"2","file":"tests/scenarios/K3-29-extras.test.ts","line":{"令":[36,55,58,65,86,88,90,98,99,111,113,121,125]},"owner":"HTTP 路由","value":"凭据","verdict":"v2 允许","note":"公开 Host token 原样使用"},
  {"section":"2","file":"tests/scenarios/K3-29-maintenance-review-run.test.ts","line":{"令":[135,147,162,182,197,217,220],"备":[105,176]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-29-recovery-continuation.test.ts","line":{"令":[203,287,375,468],"备":[117,383,414,435,496]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-29-recovery-round.test.ts","line":{"令":[327,419,422,425,437,440,503,596,612,668,703,714,719,746],"备":[169,214,265,358,415,476,521,582,631,666,711],"物":[625]},"owner":"HTTP 路由、runtime.startRun、Workflow、materials.openArtifact","value":"凭据、prepared、bundleRef","verdict":"v2 允许","note":"公开返回原值；拒绝 stale 输入不等于重建签发值"},
  {"section":"2","file":"tests/scenarios/K3-29-startup-answers.test.ts","line":{"策":[116,149]},"owner":"completionPolicies","value":"target.digest","verdict":"v2 允许","note":"组外夹真实 install 返回"},
  {"section":"2","file":"tests/scenarios/K3-29-startup-reconcile-2b.test.ts","line":{"策":[198,228,257,289]},"owner":"completionPolicies","value":"target.digest","verdict":"v2 允许","note":"组外夹真实 install 返回"},
  {"section":"2","file":"tests/scenarios/K3-29-startup-variants.test.ts","line":{"备":[217]},"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"公开 prepare/Workflow 原返回"},
  {"section":"2","file":"tests/scenarios/K3-37-stopped-review-round.test.ts","line":{"令":[167,188,191,242,261,264,272,329,332,340],"备":[131,184,257,326]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-42-truncated-command.test.ts","line":{"令":[231],"备":[187,229],"物":[224]},"owner":"HTTP 路由、runtime.startRun、materials.openArtifact","value":"凭据、prepared、bundleRef","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-42-unexpanded-r2.test.ts","line":{"令":[223],"备":[177,221],"物":[210]},"owner":"HTTP 路由、runtime.startRun、materials.openArtifact","value":"凭据、prepared、bundleRef","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-44-crr-kind4.test.ts","line":{"备":[171]},"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"公开 prepare/Workflow 原返回"},
  {"section":"2","file":"tests/scenarios/K3-44-hold-restart.test.ts","line":{"备":[89,133]},"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"公开 prepare/Workflow 原返回"},
  {"section":"2","file":"tests/scenarios/K3-44-recovery-answers.test.ts","line":{"令":[331],"备":[97]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值；A7 另列"},
  {"section":"2","file":"tests/scenarios/K3-45-review-incomplete-r2.test.ts","line":{"令":[199,201,212,246,256],"备":[140,191,240]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-R1-continuation-protection.test.ts","line":{"备":[178,213,249],"物":[114]},"owner":"runtime.startRun、materials.openArtifact","value":"prepared、bundleRef","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-R1-file-change.test.ts","line":{"备":[159,247],"物":[179,287]},"owner":"runtime.startRun、materials.openArtifact","value":"prepared、bundleRef","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-R1-restart-flows.test.ts","line":{"令":[86,111,177],"备":[95,122],"物":[139,192]},"owner":"HTTP 路由、runtime.startRun、materials.openArtifact","value":"凭据、prepared、bundleRef","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-R1-second-cleanup.test.ts","line":{"令":[198,231],"备":[165,196,219]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-R1-session-not-closable.test.ts","line":{"令":[68],"备":[78]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-R1-workspace-capture.test.ts","line":{"令":[193],"备":[178]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/K3-r1-seams.test.ts","line":{"令":[164],"备":[173]},"owner":"HTTP 路由、runtime.startRun","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/S1-archive-restart.test.ts","line":{"令":[357],"备":[57]},"owner":"HTTP 路由、Workflow","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/S1-wait-copy-retirement.test.ts","line":{"令":[40,85,128,153]},"owner":"HTTP 路由","value":"凭据","verdict":"v2 允许","note":"组外 session helper 原样使用 Host token"},
  {"section":"2","file":"tests/scenarios/S2C-K-archive-interruption.test.ts","line":{"令":[38,61],"备":[34]},"owner":"HTTP 路由、Workflow","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/S2C-K-archive-tags-checks.test.ts","line":{"令":[78,154,172,365],"备":[150,246,296,361]},"owner":"HTTP 路由、Workflow","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/S2C-K-archive-tags.test.ts","line":{"令":[40,90,143],"备":[36]},"owner":"HTTP 路由、Workflow","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/S2C-K-goal-pause.test.ts","line":{"令":[34,52,72]},"owner":"HTTP 路由","value":"凭据","verdict":"v2 允许","note":"公开 Host token 原样使用"},
  {"section":"2","file":"tests/scenarios/S2C-K-paused-run24.test.ts","line":{"令":[36,46,79,97,114,130,140,144,171],"备":[111]},"owner":"HTTP 路由、Workflow","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/S2C-K-retired.test.ts","line":{"令":[46,52,59,76,77,78,79,132,135,161,177,216,220,265,270,277],"备":[79,128,157,212],"策":[76]},"owner":"HTTP 路由、runtime.startQuery、Workflow、completionPolicies","value":"凭据、prepared、target.digest","verdict":"v2 允许","note":"公开返回原值；A7 另列"},
  {"section":"2","file":"tests/scenarios/S2C-K-unknown-outcome.test.ts","line":{"令":[56,59,74,77,111,121,132,180,187,192],"备":[52,70]},"owner":"HTTP 路由、Workflow","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值；A7 另列"},
  {"section":"2","file":"tests/scenarios/S2C-K2-continue.test.ts","line":{"令":[42,47,77,82,87,89,121,131,136,192,198,257,261,263,268,315],"备":[238,247]},"owner":"HTTP 路由、Workflow","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/S2C-K2-controls.test.ts","line":{"令":[58,68,88,89,90,91,104,113,114,132,138,162,167],"备":[54,91,158],"策":[88]},"owner":"HTTP 路由、runtime.startQuery、Workflow、completionPolicies","value":"凭据、prepared、target.digest","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/S2C-K2-conversation.test.ts","line":{"令":[45,86,129,176],"备":[172],"游":[56,108,146,153]},"owner":"HTTP 路由、Workflow、lines/page","value":"凭据、prepared、cursor","verdict":"v2 允许","note":"公开返回原值；146 使用原样过期 cursor"},
  {"section":"2","file":"tests/scenarios/S2C-K2-gate-checks.test.ts","line":{"令":[75,79]},"owner":"HTTP 路由","value":"凭据","verdict":"v2 允许","note":"公开 Host token 原样使用"},
  {"section":"2","file":"tests/scenarios/S2C-K2-paused-archive.test.ts","line":{"令":[46,51,59,97]},"owner":"HTTP 路由","value":"凭据","verdict":"v2 允许","note":"公开 Host token 原样使用"},
  {"section":"2","file":"tests/scenarios/S2C-K2-paused-transfer.test.ts","line":{"令":[38,43,48,50],"备":[71]},"owner":"HTTP 路由、Workflow","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/S2C-K2-query-not-entered.test.ts","line":{"令":[42,46,47,49],"备":[55]},"owner":"HTTP 路由、runtime.startQuery","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/S3-context-and-inputs.test.ts","line":{"备":[304],"策":[250]},"owner":"Workflow、completionPolicies","value":"prepared、target.digest","verdict":"v2 允许","note":"公开返回原值；261 的 artifact 摘要另列 F1"},
  {"section":"2","file":"tests/scenarios/S3-query-graph.test.ts","line":{"备":[336],"策":[275],"物":[286]},"owner":"Workflow、completionPolicies、plans.proposePlan","value":"prepared、target.digest、artifact ref","verdict":"v2 允许","note":"artifact ref 为318真实存储返回，并在323传入 seed"},
  {"section":"2","file":"tests/scenarios/S4C2-U6-note-card-e2e.test.ts","line":{"策":[55,79,110,135,149,163,194,216]},"owner":"completionPolicies","value":"target.digest","verdict":"v2 允许","note":"组外夹真实 install 返回；类型断言未重建字段"},
  {"section":"2","file":"tests/scenarios/S5-goal-conflict-rework.test.ts","line":{"显":[170]},"owner":"markNoticesSeen","value":"displayToken、seenThrough","verdict":"v2 允许","note":"本文件160、169公开队列返回，原样传入"},
  {"section":"2","file":"tests/scenarios/WP1-wiring.test.ts","line":{"备":[48,104,149]},"owner":"Workflow","value":"组外 fixture 内的 prepared","verdict":"v2 允许","note":"真实 Workflow.next 原样推进"},
  {"section":"2","file":"tests/scenarios/WP2-wiring-scenario.test.ts","line":{"令":[177],"备":[49],"策":[76],"物":[133,161],"显":[236],"角":[126]},"owner":"HTTP 路由、Workflow、completionPolicies、materials、markNoticesSeen、runtime.createSession","value":"凭据、prepared、摘要、displayToken/seenThrough、role pin","verdict":"v2 允许","note":"均来自真实公开返回；role 原值见124、127"},
  {"section":"2","file":"tests/scenarios/harness.test.ts","line":{"备":[106]},"owner":"Workflow","value":"prepared","verdict":"v2 允许","note":"真实 Workflow.next 原样推进"},
  {"section":"2","file":"tests/scenarios/harness.ts","line":{"令":[659,1020,1050,1082,1084,1089],"备":[1175,1301],"策":[869,1020]},"owner":"HTTP 路由、Workflow、completionPolicies","value":"凭据、prepared、target.digest","verdict":"v2 允许","note":"公开返回原值；组内调用复用这些入口"},
  {"section":"2","file":"tests/scenarios/support/S5-decisions.ts","line":{"显":[448]},"owner":"markNoticesSeen","value":"displayToken、seenThrough","verdict":"v2 允许","note":"449原样转交公开队列返回"},
  {"section":"2","file":"tests/scenarios/support/brief.ts","line":{"物":[116,124]},"owner":"materials.openArtifact","value":"prepared bundleRef","verdict":"v2 允许","note":"117原样使用公开 prepared 的 ref"},
  {"section":"2","file":"tests/scenarios/support/common.ts","line":{"令":[151,156,171,189,190,195,199,221,470,473,475,478,479,489,502,505,507],"备":[221,647,784],"策":[489]},"owner":"HTTP 路由、runtime、Workflow、completionPolicies","value":"凭据、prepared、target.digest","verdict":"v2 允许","note":"公开返回原值；712的自签 token 另列"},
  {"section":"2","file":"tests/scenarios/support/control.ts","line":{"令":[94,100,108,112,121,136,137,145,151,165,170],"策":[94]},"owner":"HTTP 路由、completionPolicies","value":"凭据、target.digest","verdict":"v2 允许","note":"170的 token 合规；同处 prepared 不合规，另列"},
  {"section":"2","file":"tests/scenarios/support/fuzz.ts","line":{"令":[1961],"备":[771,933],"策":[2184]},"owner":"HTTP 路由、Workflow、completionPolicies","value":"凭据、prepared、target.digest","verdict":"v2 允许","note":"公开返回原值；两处重建来源另列"},
  {"section":"2","file":"tests/scenarios/support/gate.ts","line":{"备":[310],"策":[248],"物":[364,520]},"owner":"Workflow、completionPolicies、plans.proposePlan","value":"prepared、target.digest、reportRef","verdict":"v2 允许","note":"真实 prepare/install/verification 返回，原样使用"},
  {"section":"2","file":"tests/scenarios/support/plan.ts","line":{"备":[427,658],"策":[338,611]},"owner":"Workflow、completionPolicies","value":"prepared、target.digest","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/support/receipts.ts","line":{"令":[93,206],"备":[51,99]},"owner":"HTTP 路由、Workflow","value":"凭据、prepared","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/support/restart.ts","line":{"令":[225,234,238],"备":[238],"策":[234]},"owner":"HTTP 路由、Workflow、completionPolicies","value":"凭据、prepared、target.digest","verdict":"v2 允许","note":"公开返回原值"},
  {"section":"2","file":"tests/scenarios/support/review-card-round.ts","line":{"备":[68,103]},"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"公开 prepare/Workflow 原返回"},
  {"section":"2","file":"tests/scenarios/support/review-work-root.ts","line":{"备":[76]},"owner":"Workflow","value":"prepared","verdict":"v2 允许","note":"82的真实 next 原样回传"},
  {"section":"2","file":"tests/scenarios/support/rework.ts","line":{"备":[267],"策":[238]},"owner":"Workflow、completionPolicies","value":"prepared、target.digest","verdict":"v2 允许","note":"公开返回原值"},

  {"section":"2","file":"tests/scenarios/support/control.ts","line":[170],"owner":"runtime.startRun","value":"prepared","verdict":"F1","note":"165读取 execution，171由 claim/envelope/inputBinding 重拼；调用方 A7-control.test.ts:287"},
  {"section":"2","file":"tests/scenarios/support/fuzz.ts","line":[1553],"owner":"runtime.startRun","value":"prepared","verdict":"F1","note":"1546读取 execution，1554重拼"},
  {"section":"2","file":"tests/scenarios/support/S5-decisions.ts","line":[434],"owner":"recordDecisionApplication","value":"receipt.identityKey、fingerprint、cursor","verdict":"F1","note":"148、151、154从 SQLite idempotency 重建；S5-two-request-decisions.test.ts:141取值、163消费"},
  {"section":"2","file":"tests/scenarios/support/common.ts","line":[712],"owner":"HTTP core 路由","value":"credential","verdict":"F1","note":"704测试自行指定 token，705配置服务器；C7-supersede-failed-task.test.ts:133调用"},
  {"section":"2","file":"tests/scenarios/S3-context-and-inputs.test.ts","line":[261],"owner":"plans.proposePlan","value":"artifact digest、size","verdict":"F1","note":"194测试预算；329才真实存储；与第一节同一来源，不重复计数"},
  {"section":"2","file":"tests/scenarios/support/fuzz.ts","line":[2241],"owner":"activateCompletionPolicy","value":"target.digest","verdict":"F1","note":"2235内部 world 的 Plan，2243复制 effectiveCompletionPolicy，非 install 返回"},

  {"section":"4","file":"tests/scenarios/S2C-K-unknown-outcome.test.ts","line":[75,157,179],"owner":"damageKernel","value":"临时 Kernel 记录 JSON 损坏","verdict":"v2 允许","note":"39限定 kernel.sqlite，41修改记录 JSON"},
  {"section":"4","file":"tests/scenarios/S2C-K-retired.test.ts","line":[218,248,298],"owner":"damageKernel","value":"临时 Kernel 记录 JSON 损坏","verdict":"v2 允许","note":"194限定 kernel.sqlite，196修改记录 JSON；298为 damaged 参数实例"},
  {"section":"4","file":"tests/scenarios/K3-29-disposition-recovery.test.ts","line":[50],"owner":"createProcessSandboxStandin.probe","value":"executeChecks:false","verdict":"v2 允许","note":"46初始化，68重置"},
  {"section":"4","file":"tests/scenarios/K3-44-recovery-answers.test.ts","line":[51],"owner":"createProcessSandboxStandin.probe","value":"executeChecks:false","verdict":"v2 允许","note":"47初始化，69重置"},
  {"section":"4","file":"tests/scenarios/K3-44-crr-kind4.test.ts","line":[53],"owner":"createProcessSandboxStandin.probe","value":"executeChecks:false","verdict":"v2 允许","note":"49初始化，74重置"},
  {"section":"4","file":"tests/scenarios/K3-29-disposition-recovery.test.ts","line":[185],"owner":"createProcessSandboxStandin.execute","value":"executeChecks:true","verdict":"A7 越界","note":"实际执行命令并返回结果；support/process-sandbox-standin.ts:59、64"},
  {"section":"4","file":"tests/scenarios/K3-44-recovery-answers.test.ts","line":[267],"owner":"createProcessSandboxStandin.execute","value":"executeChecks:true","verdict":"A7 越界","note":"实际执行命令并返回结果；support/process-sandbox-standin.ts:59、64"}
]
```

v2 允许 1146，F1 6，F3 0，A7 越界 2，文件 117/117，枚举完整