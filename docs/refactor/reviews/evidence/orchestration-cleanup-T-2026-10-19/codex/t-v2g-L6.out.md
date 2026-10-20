**这次仍未达到完整枚举，不能用于冻结第二轮。** 以下是已完成判定的部分，以及全部文件的覆盖登记；末尾数量只统计已判定位置，不是 L6 总量。

表中测试文件名均相对于 `tests/work-graph/`。同一行的多个行号分别计数，不按参数化执行次数计数。“v2 允许”只判所列输入，不替包含 F3 或未核完 helper 的整条测试放行。依据为 `.lead-ref/books/test-rule-sheet-v2.md:24`、`:30`、`:32`、`:43`。

1．A1 公共输入

| 文件及行号 | owner | 值的来源、签发字段 | 后续路径 | 判定 |
|---|---|---|---|---|
| `K3-06-mixed-kinds-owner.test.ts:150` | `unknownCallReviews.recordConclusion` | 手写 item、verdict、evidence、crashSuspicion；reviewRef 来自公开轮次。helper：`tests/helpers/K3-proposal-round.ts:478` | 公开收尾及读取：本文件 `:161`、`:163` | v2 允许 |
| `K3-10-crr-goal-basis.test.ts:129、168、176` | `goalSettings.setGoalSettings`、`goalControl.setGoalControl` | 手写设置、pause/resume；版本来自公开读 `:125`、`:164`；无签发凭据 | 含内部 CRR facts 读取，不能认定整链仅公开 | v2 允许 |
| `K3-16-approval-application.test.ts:112、137、164、174、179、181` | `recordProposal`、`recordConclusion`、`workflow.resolveDecision` | 手写建议、结论、选择；reviewRef/card.source 来自公开结果。helper：`tests/helpers/K3-proposal-round.ts:478`、`:715` | 直接轮次路径已核；decision helper 的 receipt 链尚未全部闭合 | v2 允许 |
| `K3-16-proposal-write.test.ts:96、118、136、142、193、242` | `unknownCallReviews.recordProposal` | 手写 item、command、cwd、rationale；完整请求构造在 `:74`；reviewRef 来自公开读；无签发字段重建 | `:96` 后有存储事件断言 `:110`；其他所列位置后为公开读 | v2 允许 |
| `K3-18-review-card-queue.test.ts:117` | `runtime.startRun` | `:115` 的 `prepareOn` 返回 prepared 原样传入；helper：`tests/scenarios/support/shell-work-root.ts` | 继续真实 Runtime/Host | v2 允许 |
| `K3-39-tool-commit-lookup.test.ts:159、202` | `plans.proposePlan` | futureDraft 手写；版本 pins 来自内部 record read：`tests/helpers/W2-whiteboard-fixture.ts:265`、`:285`；不是 receipt/token | 后续内部 tool-commit lookup，非全公开 | v2 允许 |
| `K3-39-tool-commit-lookup.test.ts:229、260、266、276、301` | `messages.sendMessage/ackMessage/respondMessage`、`decisionMessages.sendUserMessage` | 手写正文；messageRef/revision 来自前次公开发送或 ack。helper：`tests/helpers/C1-mailbox-fixture.ts:146`；`:301` 使用 `tests/helpers/S5-user-message-support.ts` | 后续内部 tool-commit lookup，非全公开 | v2 允许 |
| `K3-47-continuation-gate.test.ts:154、181` | `runtime.startRun` | prepared 原样来自 `:152`、`:179` 的 `prepareContinuation`；实际 prepare：`tests/helpers/K3-35-prepare.ts:93`、`:109` | 继续真实 Runtime | v2 允许 |
| `K3-48-2-unknown-call-review-model-text-budget.test.ts:284、293、349、358、431、458、557` | `recordConclusion`、`recordProposal`、`workflow.resolveDecision` | 手写证据、建议、选择；公开 reviewRef。helper：`tests/helpers/K3-proposal-round.ts:478`、`:715` | `:431` 的前置有本文件 `:213` F3；decision receipt 链未全部闭合 | v2 允许 |
| `S4A-note-scope.test.ts:51、54、82、85` | `plans.proposePlan/applyPlanChange` | 手写或公开任务图投影的计划；公开读 `:39`、`:67`、`:69`；apply 原样使用 proposalRef/revision | 继续公开注记、控制操作；初始化 helper 尚需逐调用记账 | v2 允许 |
| `S4B-memory-version-lists.test.ts:30、37、108` | `plans`、`architecture.reviseArchitectureCatalog` | 公开计划、架构投影；来源 `:18`、`:28`、`:35`、`:106`；baseline digest、proposalRef 原样使用 | 公开版本列表 | v2 允许 |
| `S4B-note-anchor-status.test.ts:32、51、57` | `architecture`、`plans` | 公开读 `:30`、`:42`、`:55` 后投影；digest/proposalRef 原样使用 | 公开 readNote/checkNotes | v2 允许 |
| `S4B-note-check-isolation.test.ts:25` | `architecture.reviseArchitectureCatalog` | `:23` 公开 baseline ref/digest，加修改后的 catalog | 公开 readNote | v2 允许 |
| `S4B-note-definitions.test.ts:41、47、59` | `plans`、`architecture` | 公开读 `:28`、`:45`、`:55` 后投影；签发 digest/proposalRef 原样使用 | 公开 readNote | v2 允许 |
| `S4B-note-facts.test.ts:52、71` | `notes.writeNote` | `:52` 使用公开 Goal 版本 `:48`；`:71` 使用 `storeArtifact:66` 返回的原 artifact ref，provenance 为 `:64` 手写 origin；本地转交点 `:19` | 公开 checkNotes：`:26` | v2 允许 |
| `S4B-note-invalid.test.ts:24、31` | `plans.proposePlan/applyPlanChange` | 公开读 `:15`、`:29` 后投影；修改 disposition；apply 原 proposalRef/revision | 公开取消及注记读取 | v2 允许 |
| `S4C-note-protection.test.ts:72、78` | `plans.proposePlan/applyPlanChange` | 公开读 `:54`、`:76` 后调整计划；原 proposalRef/revision | 公开注记操作；Session helper 另有直接写入 | v2 允许 |
| `S4C-note-related-find.test.ts:93、96` | `plans.proposePlan/applyPlanChange` | 手写初始计划；apply 原 proposalRef/revision | 随后 `:116`、`:119` 手写 Session，非全公开 | v2 允许 |
| `S4C-per-call-cache.test.ts:117、123` | `plans.proposePlan/applyPlanChange` | 公开读 `:101`、`:121` 后投影；原 proposalRef/revision | 公开注记操作；Session helper 另有直接写入 | v2 允许 |
| `S4C-related-scope.test.ts:137、140` | `plans.proposePlan/applyPlanChange` | 手写初始计划；apply 原 proposalRef/revision | 随后 `:160`、`:163` 手写 Session，非全公开 | v2 允许 |
| `S4C2-N3.test.ts:118` | `workspaceDecisionSettings.markNoticesSeen` | `:101` 公开 queue 页的 displayToken、seenThrough 原样传递；helper：`tests/helpers/S4C2-note-card-fixture.ts:389`、`:390` | `:119` 再次公开 queue | v2 允许 |
| `S4C2-U3.test.ts:156` | `decisionMessages.recordDecisionApplication` | receipt 为公开 withdraw `:145` 的原返回；answer.ref 来自 `:130` | `:161` 拒绝 incomplete；`:165`、`:168` 公开读。这里只放行参数来源 | v2 允许 |
| `S4C2-memory-material.test.ts:225、230、451、456` | `plans.proposePlan/applyPlanChange` | 公开计划投影；例如 draft `:219`；原 proposalRef/revision | 含内部 readMemoryMaterial：`:242`，非全公开 | v2 允许 |
| `S4C2-read-counts.test.ts:220、224、252、256、598` | `plans`、`architecture` | 公开计划投影或手写第二计划；`:598` 的 baseline digest 来自公开读 `:592` | 含内部 readScribeTodos：`:396`，也有公开 queue：`:608` | v2 允许 |
| `S4C2-rework-staleness.test.ts:281、284` | `plans.proposePlan/applyPlanChange` | 手写第二目标计划 `:273`；apply 原 proposalRef/revision | 随后公开 resolve 的错误路由拒绝分支 | v2 允许 |
| `S4C2-task-window.test.ts:63、71、286、290` | `plans.proposePlan/applyPlanChange` | 公开读 `:49`、`:52`、`:69` 后投影，或手写第二工作区计划；原 proposalRef/revision | 随后 `:306`、`:310` 手写 Session，非全公开 | v2 允许 |
| `S4C2-update-due.test.ts:52、57、157、168` | `plans`、`runtime.startRun`、`claims.requeueTask` | 计划投影；prepared 来自 `preparedBundle:156`；requeue 使用公开 Run/Goal 读 `:160`、`:164` | `:180` 公开 memoryLookup；初始化 `:141` 另有 F3 | v2 允许 |
| `S8A-L8-chunk-scope.test.ts:333、355、360` | `architecture`、`plans` | catalog 投影及手写计划；baseline digest 来自 `:327`；apply 原 proposalRef/revision | 随后真实 runtime.createSession：`:363` | v2 允许 |
| `S8A-L8-observation-state.test.ts:202` | `architecture.reviseArchitectureCatalog` | 公开 catalog `:198` 投影；baseline digest 原样使用 | 后续含 driver 通知 `:410`，不只公开入口 | v2 允许 |
| `S8A-catalog-version-time.test.ts:32、77` | `architecture.reviseArchitectureCatalog` | 公开读 `:26`、`:73` 后复制 catalog；baseline ref/digest 原样使用 | 公开读 `:42`、`:86`；版本列表 `:47` | v2 允许 |
| `SP-memory-check-scoped.test.ts:51` | `architecture.reviseArchitectureCatalog` | 公开读 `:49` 后投影；baseline ref/digest 原样使用 | 公开 memory/check | v2 允许 |
| `SP-memory-scoped-find.test.ts:106` | `notes.memoryFind` | 第一页 `:99` 返回的 cursor 原样使用，查询条件手写 | 公开结果断言 | v2 允许 |
| `K3-11-review-reasons.test.ts:302` | `platform.resolveUnknownRun` | `:304` 手造 review、inventory、items、decisionReason；这些是平台派生值 | `:306` 要求 committed，`:309` 继续 readReview | **F1：v2 第 36 行** |
| `S4B-note-facts.test.ts:78` | `notes.writeNote` | `:77` 将真实 artifact ref.digest 改为全零；经本文件 `writeAccepted:19` 提交 | `:80` 继续公开 check | **F1：v2 第 32–35 行** |
| `S4B-note-facts.test.ts:104、110` | `notes.writeNote` | `:101`–`:103` 手写 kernel locator；fromPosition=12，throughPosition=15/25，均非公开返回的位置 | 写入后继续公开 check；前置 `:96` 另有 F3 | **F1：v2 第 32–35 行** |
| `SP-memory-scoped-find.test.ts:310` | `notes.memoryFind` | `:299` 解析真实 cursor，`:309` 改写 after，再序列化提交 | `:311` 要求 ready | **F1：v2 第 32–35 行** |
| `K3-41-disposition-proof.test.ts:51` | resolveDecision 内部的 `decisionMessages.recordDecisionApplication` | helper 从内部 event JSON 重建 receipt：`tests/helpers/K3-review-card-fixture.ts:288`、`:294`；注入点 `:315` | 消费点 `src/business/workflow/decision-actions.ts:449`、`:458`；本测试 `:56` 要求 applied | **F1：v2 第 32–35 行** |
| 待核 K3 文件：`K3-13-two-items-owner.test.ts:99`；`K3-15-disposition-effects.test.ts:99`；`K3-15-hold-release.test.ts:71`；`K3-15-list-by-task.test.ts:39`；`K3-16-proposal-round-fixture.test.ts:50`；`K3-16-second-unfinished-proposal.test.ts:42`；`K3-17-disposition-replay.test.ts:68`；`K3-18-autonomy-facts.test.ts:82`；`K3-18-requeue-confirmed.test.ts:64`；`K3-26-unknown-call-review-storage.test.ts:170`；`K3-35-owner-manifest-trim.test.ts:82`；`K3-39-record-note-lookup.test.ts:50`；`K3-43-continuation-vs-hold.test.ts:100`；`K3-43-review-claim-vs-hold.test.ts:70`；`K3-47-claim-gate.test.ts:112`；`K3-47-reader-facts.test.ts:88`；`K3-48-3-required-writes.test.ts:81` | 尚未逐项闭合 | 这里只登记命中位置，不是完整实例行 | 未完成 | 不计数 |
| 待核 S4A 文件：`S4A-note-caps.test.ts:40`；`S4A-note-concurrency.test.ts:44`；`S4A-note-failures.test.ts:40`；`S4A-note-history.test.ts:61`；`S4A-note-symbol.test.ts:92`；`S4A-note-write.test.ts:43` | 尚未逐项闭合 | 普通写入、拒绝样本、查询和 helper 调用尚未逐一列完 | 未完成 | 不计数 |
| 待核 S4B 文件：`S4B-memory-anchor-not-found.test.ts:21`；`S4B-memory-conflicts-read.test.ts:20`；`S4B-memory-coverage.test.ts:32`；`S4B-memory-current-filter.test.ts:25`；`S4B-memory-find-stale.test.ts:18`；`S4B-memory-history.test.ts:18`；`S4B-memory-l12-bounds.test.ts:22`；`S4B-memory-not-found.test.ts:20`；`S4B-memory-observation.test.ts:21`；`S4B-memory-paging.test.ts:23`；`S4B-memory-ranking.test.ts:20`；`S4B-memory-similar.test.ts:24`；`S4B-note-anchor-goals.test.ts:24`；`S4B-note-basis-path.test.ts:21`；`S4B-note-budget-check.test.ts:20`；`S4B-note-check-head-version.test.ts:22`；`S4B-note-check-observation.test.ts:21`；`S4B-note-conflicts.test.ts:21`；`S4B-note-freshness.test.ts:21`；`S4B-note-hints.test.ts:25`；`S4B-note-read-failures.test.ts:19`；`S4B-note-symbol-recheck.test.ts:21` | 尚未逐项闭合 | 这里只登记命中位置 | 未完成 | 不计数 |
| 待核 S4C 文件：`S4C-default-states.test.ts:23`；`S4C-find-byte-trim.test.ts:30`；`S4C-find-read-bounds.test.ts:33`；`S4C-note-supersede-race.test.ts:83`；`S4C-path-ownership-callers.test.ts:92`；`S4C-project-understanding-write.test.ts:38`；`S4C-project-understanding.test.ts:29`；`S4C-resolution-order.test.ts:68`；`S4C-write-read-bounds.test.ts:67` | 尚未逐项闭合 | 这里只登记命中位置 | 未完成 | 不计数 |
| 待核 S4C2 文件：`S4C2-D-rows.test.ts:36`；`S4C2-D17.test.ts:38`；`S4C2-N1.test.ts:40`；`S4C2-N2.test.ts:41`；`S4C2-U7.test.ts:99`；`S4C2-disposition-core.test.ts:110`；`S4C2-m12h-store-fault.test.ts:40`；`S4C2-project-set-shared.test.ts:130`；`S4C2-proof-changes.test.ts:35`；`S4C2-scribe-user-reason.test.ts:41` | 尚未逐项闭合 | 这里只登记命中位置 | 未完成 | 不计数 |
| 待核 S8/SP 文件：`S8A-L8-read-counts.test.ts:109`；`S8A-L8-reminders-public.test.ts:39`；`SP-memory-history-confirm.test.ts:29`；`SP-note-reuse.test.ts:98` | 尚未逐项闭合 | 这里只登记命中位置 | 未完成 | 不计数 |

上表已有判定行的文件，也仍有未列完的调用；并非只有“待核”登记中的文件存在缺口。尤其是 K3 receipt helper 的其他调用方，以及注记 Session helper 的调用方，尚未逐一计入（`tests/helpers/K3-review-card-fixture.ts:288`、`:294`；`tests/helpers/S4A-note-fixture.ts:239`、`:242`）。

2．Record-store 自身测试

| 范围 | 结果 |
|---|---|
| `.lead-ref/groups/L6-files.txt:1` 至 `:126` | 全部是 `tests/work-graph/` 文件，没有 `tests/record-store/` 自身测试；本节无实例。 |

3．Store 以上的 F3

这里同时保留 v1 明确禁止的人工 Runtime/Host 事实写入；依据为 `.lead-ref/books/test-rule-sheet-v1.md:64`、`:65`。

| 文件及行号 | 写入内容 | 到达它的测试及 helper | 判定 |
|---|---|---|---|
| `K3-11-review-reasons.test.ts:159、190、202` | 手造 review 记录、事件及 Run 终结事实 | 本文件；commit helper 调用在 `:138`、`:141`、`:218` | F3 |
| `K3-14-unknown-call-review-tool.test.ts:121、213、292` | claimed review；将公开 review 改为 resolved、activeRound=null 后提交 | 本文件 setup `:104`、直接测试 `:213`、adapter settle 调用 `:346` | F3 |
| `K3-45-review-incomplete.test.ts:139、158` | review 批次及手工终结事件 | 本文件 fixture、settle 路径 | F3 |
| `K3-48-2-unknown-call-review-model-text-budget.test.ts:213` | 手造 review 和 review-changed 事件 | 本文件容量 fixture；不能据此把同文件真实 proposal 轮次也算成走此写入 | F3 |
| `S4B-note-facts.test.ts:96` | 手写 kernel run/turn、startPosition=10、observedThroughPosition=20 | 本文件 `:104`、`:110` 随后检查注记 | F3 |
| `S4B-note-missing-flows.test.ts:178` | 手写 executed 检查结果 | 本文件 `:179` 构造结果，`:189` 继续 completeTask | F3 |
| `S4C-node-notes.test.ts:38` | 创建 Kernel Session，并手写 Session anomaly 的 files 事实 | `tests/helpers/S4C-node-notes-fixture.ts:44`、`:67`；底层 `tests/helpers/S4A-note-fixture.ts:239`、`:242`；调用者为本测试文件 | F3 |
| `S4C-note-related-find.test.ts:116、119` | Kernel store.create；手写 WorkGraph Session 注册事实 | 本文件局部 createSession/claimRun 路径 | F3 |
| `S4C-related-scope.test.ts:160、163、246、464` | Kernel Session、Session 注册及 countedFacts 运行活动 | 本文件局部 claimRun 和活动测试路径 | F3 |
| `S4C2-U3.test.ts:78` | 手写 NoteDispositionChanged 事件，并据此构造 receipt | 本文件 commitNoteEvent `:90`、readFacts 调用 `:106`；验证的是上层 application proof | F3 |
| `S4C2-task-window.test.ts:306、310` | 第二工作区 Kernel Session、Session 注册事实 | 本文件第二工作区 fixture | F3 |
| `S4C2-update-due.test.ts:141` | SQLite 分支手造协调策略版本和活动指针 | `tests/helpers/WP2-platform-support.ts:536`、`:579` → `tests/helpers/task-claim-fixture.ts:311`；调用者为本测试文件 | F3 |
| `S8A-file-layer.test.ts:103、122` | Project/Workspace scope 种子；通用 records 提交 helper | `:103` 由本文件 fixture 到达；`:122` 被返回为成员，但本文件没有调用该成员，列为未调用的写入定义 | F3 |
| `S8A-root-path.test.ts:136` | Project/Workspace scope 种子 | helper `tests/work-graph/R3d-fixture.ts:85`；本文件 `:139`、`:146` 继续上层 capture/query | F3 |

**本节也不完整。** 尚未把所有组内调用逐一映射到这些已发现的组外写入：`tests/helpers/task-claim-fixture.ts:367`、`:370`，`tests/helpers/S5-decision-fixture.ts:604`、`:606`、`:851`，`tests/helpers/B2-execution-fixture.ts:309`，`tests/helpers/S4A-note-fixture.ts:239`、`:242`，`tests/helpers/S4A-note-scope-fixture.ts:250`、`:253`，`tests/helpers/S4B-memory-fixture.ts:102`、`:105`，`tests/helpers/S4C2-note-card-fixture.ts:182`、`:185`，`tests/helpers/R3e-evidence-fixture.ts:265`。它们没有被偷偷计入下面的 25。

4．A7

| named helper | 本组结果 | 边界依据 |
|---|---|---|
| `buildNoteTools` | 未发现使用。`S4C-write-read-bounds.test.ts:192` 使用的是实际 `createNoteTools`，不是这个 named helper | `.lead-ref/books/test-rule-sheet-v2.md:45`、`:47` |
| `damageKernel` | 本组及已追踪测试 helper 中未发现使用 | `.lead-ref/books/test-rule-sheet-v2.md:50`、`:58` |
| `process-sandbox-standin` | 本组及已追踪测试 helper 中未发现使用，也未发现其 executeChecks 开关使用 | `.lead-ref/books/test-rule-sheet-v2.md:59`、`:64` |

无实例（仅指本次四类，不代表整份测试符合 v1 的其他规则）：

- `K3-39-request-id.test.ts:16`
- `K3-48-unknown-call-review-creation-budget.test.ts:52`
- `K3-50-codec-shape-checks.test.ts:22`
- `K3-B3-request-order.test.ts:66`
- `K3-receipt-replay.test.ts:69`
- `K3-task-closure.test.ts:30`
- `S4C-note-continuity.test.ts:10`
- `S4C-note-path-ownership.test.ts:13`
- `S4C-scribe-ownership.test.ts:24`
- `S4C2-collection-card-source.test.ts:94`
- `S4C2-goal-triggers.test.ts:120`
- `S4C2-notice-class.test.ts:41`
- `S4C2-notice-grouping.test.ts:41`
- `S4C2-pending-understanding-overridden.test.ts:65`
- `S4C2-update-due-fold.test.ts:76`
- `S8A-L8-reminders-pure.test.ts:101`
- `S8A-formal-comparison.test.ts:63`
- `S8A-path-ownership-dedupe.test.ts:13`
- `S8D-coverage-notes.test.ts:45`

以下 JSON 仅包含已经判定的行；未完成登记不计入数量。

```json
[
  {"section":1,"file":"tests/work-graph/K3-06-mixed-kinds-owner.test.ts","line":[150],"owner":"unknownCallReviews.recordConclusion","value":"手写结论参数，公开轮次ref","verdict":"v2 允许","note":"tests/helpers/K3-proposal-round.ts:478；随后本文件161、163公开收尾和读取"},
  {"section":1,"file":"tests/work-graph/K3-10-crr-goal-basis.test.ts","line":[129,168,176],"owner":"goalSettings.setGoalSettings；goalControl.setGoalControl","value":"手写设置及pause/resume，公开Goal版本","verdict":"v2 允许","note":"来源125、164；后续含内部CRR facts读取"},
  {"section":1,"file":"tests/work-graph/K3-16-approval-application.test.ts","line":[112,137,164,174,179,181],"owner":"unknownCallReviews.recordProposal/recordConclusion；workflow.resolveDecision","value":"手写建议、结论、选择，公开reviewRef/card.source","verdict":"v2 允许","note":"tests/helpers/K3-proposal-round.ts:478、715；decision receipt链未全部闭合"},
  {"section":1,"file":"tests/work-graph/K3-16-proposal-write.test.ts","line":[96,118,136,142,193,242],"owner":"unknownCallReviews.recordProposal","value":"手写item/command/cwd/rationale，公开reviewRef","verdict":"v2 允许","note":"请求构造74；96后有存储事件断言110，其他所列位置后为公开读"},
  {"section":1,"file":"tests/work-graph/K3-18-review-card-queue.test.ts","line":[117],"owner":"runtime.startRun","value":"prepareOn返回的原prepared","verdict":"v2 允许","note":"来源115；helper为tests/scenarios/support/shell-work-root.ts；随后真实Runtime/Host"},
  {"section":1,"file":"tests/work-graph/K3-39-tool-commit-lookup.test.ts","line":[159,202],"owner":"plans.proposePlan","value":"手写futureDraft，内部record read取得版本pins","verdict":"v2 允许","note":"tests/helpers/W2-whiteboard-fixture.ts:265、285；无重建receipt/token；后续内部lookup"},
  {"section":1,"file":"tests/work-graph/K3-39-tool-commit-lookup.test.ts","line":[229,260,266,276,301],"owner":"messages.sendMessage/ackMessage/respondMessage；decisionMessages.sendUserMessage","value":"手写正文，公开消息ref和revision","verdict":"v2 允许","note":"tests/helpers/C1-mailbox-fixture.ts:146；301使用tests/helpers/S5-user-message-support.ts；后续内部tool-commit lookup"},
  {"section":1,"file":"tests/work-graph/K3-47-continuation-gate.test.ts","line":[154,181],"owner":"runtime.startRun","value":"prepareContinuation返回的原prepared","verdict":"v2 允许","note":"来源152、179；tests/helpers/K3-35-prepare.ts:93、109；随后真实Runtime"},
  {"section":1,"file":"tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts","line":[284,293,349,358,431,458,557],"owner":"unknownCallReviews.recordConclusion/recordProposal；workflow.resolveDecision","value":"手写证据、建议、选择，公开reviewRef","verdict":"v2 允许","note":"tests/helpers/K3-proposal-round.ts:478、715；431前置213为F3；decision receipt链未闭合"},
  {"section":1,"file":"tests/work-graph/S4A-note-scope.test.ts","line":[51,54,82,85],"owner":"plans.proposePlan/applyPlanChange","value":"手写或公开任务图投影的计划，原proposalRef/revision","verdict":"v2 允许","note":"公开读39、67、69；继续注记和控制；初始化helper仍待逐调用记账"},
  {"section":1,"file":"tests/work-graph/S4B-memory-version-lists.test.ts","line":[30,37,108],"owner":"plans；architecture.reviseArchitectureCatalog","value":"公开计划/架构投影，原digest和proposalRef","verdict":"v2 允许","note":"来源18、28、35、106；后续公开版本列表"},
  {"section":1,"file":"tests/work-graph/S4B-note-anchor-status.test.ts","line":[32,51,57],"owner":"architecture；plans","value":"公开catalog/plan投影，原digest和proposalRef","verdict":"v2 允许","note":"来源30、42、55；后续公开readNote/checkNotes"},
  {"section":1,"file":"tests/work-graph/S4B-note-check-isolation.test.ts","line":[25],"owner":"architecture.reviseArchitectureCatalog","value":"公开baseline ref/digest和修改后的catalog","verdict":"v2 允许","note":"来源23；后续公开readNote"},
  {"section":1,"file":"tests/work-graph/S4B-note-definitions.test.ts","line":[41,47,59],"owner":"plans；architecture","value":"公开计划/架构投影，原proposal和baseline digest","verdict":"v2 允许","note":"来源28、45、55；后续公开readNote"},
  {"section":1,"file":"tests/work-graph/S4B-note-facts.test.ts","line":[52,71],"owner":"notes.writeNote","value":"公开Goal版本或storeArtifact返回的原artifact ref","verdict":"v2 允许","note":"本地转交19；来源48、66；71的origin手写于64；后续公开check26"},
  {"section":1,"file":"tests/work-graph/S4B-note-invalid.test.ts","line":[24,31],"owner":"plans.proposePlan/applyPlanChange","value":"公开计划投影，修改disposition，原proposalRef/revision","verdict":"v2 允许","note":"来源15、29；后续公开取消和注记读取"},
  {"section":1,"file":"tests/work-graph/S4C-note-protection.test.ts","line":[72,78],"owner":"plans.proposePlan/applyPlanChange","value":"公开计划投影和调整，原proposalRef/revision","verdict":"v2 允许","note":"来源54、76；后续公开注记；Session helper另有直接写入"},
  {"section":1,"file":"tests/work-graph/S4C-note-related-find.test.ts","line":[93,96],"owner":"plans.proposePlan/applyPlanChange","value":"手写初始计划，原proposalRef/revision","verdict":"v2 允许","note":"随后116、119手写Session，非全公开"},
  {"section":1,"file":"tests/work-graph/S4C-per-call-cache.test.ts","line":[117,123],"owner":"plans.proposePlan/applyPlanChange","value":"公开计划投影，原proposalRef/revision","verdict":"v2 允许","note":"来源101、121；后续公开注记；Session helper另有直接写入"},
  {"section":1,"file":"tests/work-graph/S4C-related-scope.test.ts","line":[137,140],"owner":"plans.proposePlan/applyPlanChange","value":"手写初始计划，原proposalRef/revision","verdict":"v2 允许","note":"随后160、163手写Session，非全公开"},
  {"section":1,"file":"tests/work-graph/S4C2-N3.test.ts","line":[118],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"公开queue页的原displayToken和seenThrough","verdict":"v2 允许","note":"来源101；tests/helpers/S4C2-note-card-fixture.ts:389、390；随后119公开queue"},
  {"section":1,"file":"tests/work-graph/S4C2-U3.test.ts","line":[156],"owner":"decisionMessages.recordDecisionApplication","value":"公开withdraw的原receipt及公开answer.ref","verdict":"v2 允许","note":"来源145、130；161拒绝incomplete；165、168公开读；仅放行输入来源"},
  {"section":1,"file":"tests/work-graph/S4C2-memory-material.test.ts","line":[225,230,451,456],"owner":"plans.proposePlan/applyPlanChange","value":"公开计划投影，原proposalRef/revision","verdict":"v2 允许","note":"draft219；后续含内部readMemoryMaterial242"},
  {"section":1,"file":"tests/work-graph/S4C2-read-counts.test.ts","line":[220,224,252,256,598],"owner":"plans；architecture","value":"公开计划投影或手写第二计划，原catalog digest","verdict":"v2 允许","note":"catalog来源592；后续含内部readScribeTodos396及公开queue608"},
  {"section":1,"file":"tests/work-graph/S4C2-rework-staleness.test.ts","line":[281,284],"owner":"plans.proposePlan/applyPlanChange","value":"手写第二目标计划，原proposalRef/revision","verdict":"v2 允许","note":"draft273；随后公开resolve错误路由拒绝分支"},
  {"section":1,"file":"tests/work-graph/S4C2-task-window.test.ts","line":[63,71,286,290],"owner":"plans.proposePlan/applyPlanChange","value":"公开计划投影或手写第二工作区计划，原proposalRef/revision","verdict":"v2 允许","note":"来源49、52、69；随后306、310手写Session"},
  {"section":1,"file":"tests/work-graph/S4C2-update-due.test.ts","line":[52,57,157,168],"owner":"plans；runtime.startRun；claims.requeueTask","value":"计划投影、原prepared、公开Run/Goal版本构造的requeue请求","verdict":"v2 允许","note":"preparedBundle156；公开读160、164；后续180公开memoryLookup；初始化141有F3"},
  {"section":1,"file":"tests/work-graph/S8A-L8-chunk-scope.test.ts","line":[333,355,360],"owner":"architecture；plans","value":"公开catalog投影和手写计划，原digest/proposalRef","verdict":"v2 允许","note":"来源327；随后真实runtime.createSession363"},
  {"section":1,"file":"tests/work-graph/S8A-L8-observation-state.test.ts","line":[202],"owner":"architecture.reviseArchitectureCatalog","value":"公开catalog投影，原baseline digest","verdict":"v2 允许","note":"来源198；后续含driver通知410"},
  {"section":1,"file":"tests/work-graph/S8A-catalog-version-time.test.ts","line":[32,77],"owner":"architecture.reviseArchitectureCatalog","value":"公开catalog复制，原baseline ref/digest","verdict":"v2 允许","note":"来源26、73；后续公开读42、86及版本列表47"},
  {"section":1,"file":"tests/work-graph/SP-memory-check-scoped.test.ts","line":[51],"owner":"architecture.reviseArchitectureCatalog","value":"公开catalog投影，原baseline ref/digest","verdict":"v2 允许","note":"来源49；后续公开memory/check"},
  {"section":1,"file":"tests/work-graph/SP-memory-scoped-find.test.ts","line":[106],"owner":"notes.memoryFind","value":"公开第一页的原cursor及手写查询条件","verdict":"v2 允许","note":"来源99；后续公开结果断言"},
  {"section":1,"file":"tests/work-graph/K3-11-review-reasons.test.ts","line":[302],"owner":"platform.resolveUnknownRun","value":"手造review/inventory/items/decisionReason","verdict":"F1","note":".lead-ref/books/test-rule-sheet-v2.md:36；304构造；306要求committed，309继续readReview"},
  {"section":1,"file":"tests/work-graph/S4B-note-facts.test.ts","line":[78],"owner":"notes.writeNote","value":"改写真实artifact ref.digest为全零","verdict":"F1","note":".lead-ref/books/test-rule-sheet-v2.md:32、35；改写77，经19提交，80继续check"},
  {"section":1,"file":"tests/work-graph/S4B-note-facts.test.ts","line":[104,110],"owner":"notes.writeNote","value":"手写kernel history fromPosition12和throughPosition15/25","verdict":"F1","note":".lead-ref/books/test-rule-sheet-v2.md:32、35；构造101、103；前置96另有F3"},
  {"section":1,"file":"tests/work-graph/SP-memory-scoped-find.test.ts","line":[310],"owner":"notes.memoryFind","value":"修改真实cursor中的after后重新序列化","verdict":"F1","note":".lead-ref/books/test-rule-sheet-v2.md:32、35；299解析、309改写、311要求ready"},
  {"section":1,"file":"tests/work-graph/K3-41-disposition-proof.test.ts","line":[51],"owner":"decisionMessages.recordDecisionApplication（resolveDecision内部）","value":"helper从存储事件JSON重建receipt","verdict":"F1","note":"tests/helpers/K3-review-card-fixture.ts:288、294、305、315；src/business/workflow/decision-actions.ts:449、458；本文件56要求applied；其他调用方未闭合"},
  {"section":3,"file":"tests/work-graph/K3-11-review-reasons.test.ts","line":[159,190,202],"owner":"records.commit；executions.recordRunResult","value":"手造review记录/事件及Run终结事实","verdict":"F3","note":"调用者本文件；commit helper调用138、141、218"},
  {"section":3,"file":"tests/work-graph/K3-14-unknown-call-review-tool.test.ts","line":[121,213,292],"owner":"records.commit","value":"手造claimed review及resolved/activeRound:null更新","verdict":"F3","note":"调用者本文件；setup104、直接测试213、adapter settle346"},
  {"section":3,"file":"tests/work-graph/K3-45-review-incomplete.test.ts","line":[139,158],"owner":"records.commit；executions.recordRunResult","value":"review批次及手工终结事件","verdict":"F3","note":"调用者本文件fixture/settle"},
  {"section":3,"file":"tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts","line":[213],"owner":"records.commit","value":"手造review与review-changed事件","verdict":"F3","note":"调用者本文件容量fixture；真实proposal轮次不走此写入"},
  {"section":3,"file":"tests/work-graph/S4B-note-facts.test.ts","line":[96],"owner":"executions.recordExecutionHistory","value":"手写kernel run/turn及10–20观察位置","verdict":"F3","note":"本文件104、110继续注记检查"},
  {"section":3,"file":"tests/work-graph/S4B-note-missing-flows.test.ts","line":[178],"owner":"evidence.recordCheckResult","value":"手写executed检查结果","verdict":"F3","note":"本文件179构造；189继续completeTask"},
  {"section":3,"file":"tests/work-graph/S4C-node-notes.test.ts","line":[38],"owner":"archiveRun","value":"直接创建Kernel Session并手写Session anomaly files事实","verdict":"F3","note":"tests/helpers/S4C-node-notes-fixture.ts:44、67；tests/helpers/S4A-note-fixture.ts:239、242；调用者本文件"},
  {"section":3,"file":"tests/work-graph/S4C-note-related-find.test.ts","line":[116,119],"owner":"Kernel store.create；sessions.recordSessionCreated","value":"手工Kernel Session及WorkGraph Session注册","verdict":"F3","note":"调用者本文件局部createSession/claimRun"},
  {"section":3,"file":"tests/work-graph/S4C-related-scope.test.ts","line":[160,163,246,464],"owner":"Kernel store.create；sessions.recordSessionCreated；runActivity.recordRunActivity","value":"手工Session及countedFacts运行活动","verdict":"F3","note":"调用者本文件局部claimRun和活动测试"},
  {"section":3,"file":"tests/work-graph/S4C2-U3.test.ts","line":[78],"owner":"records.commit","value":"手写NoteDispositionChanged事件","verdict":"F3","note":"本文件commitNoteEvent90、readFacts106；测试上层application proof"},
  {"section":3,"file":"tests/work-graph/S4C2-task-window.test.ts","line":[306,310],"owner":"Kernel store.create；sessions.recordSessionCreated","value":"手工第二工作区Kernel Session及Session注册","verdict":"F3","note":"调用者本文件第二工作区fixture"},
  {"section":3,"file":"tests/work-graph/S4C2-update-due.test.ts","line":[141],"owner":"createWP2Platform→commitRaw","value":"SQLite分支手造协调策略版本及活动指针","verdict":"F3","note":"tests/helpers/WP2-platform-support.ts:536、579；tests/helpers/task-claim-fixture.ts:311；调用者本文件"},
  {"section":3,"file":"tests/work-graph/S8A-file-layer.test.ts","line":[103,122],"owner":"records.commit","value":"Project/Workspace scope种子及通用records提交helper","verdict":"F3","note":"103由本文件fixture到达；122为返回但未被本文件调用的写入定义"},
  {"section":3,"file":"tests/work-graph/S8A-root-path.test.ts","line":[136],"owner":"fixture→records.commit","value":"Project/Workspace scope种子","verdict":"F3","note":"tests/work-graph/R3d-fixture.ts:85；调用者本文件139、146继续上层capture/query"}
]
```

v2 允许 88，F1 6，F3 25，A7 越界 0，文件 126/126；枚举不完整：126 文件均已登记，但 107 个非空文件的 A1 全量、拒绝分支及组外 helper 可达调用尚未逐项闭合，以上数量只是已判定部分。