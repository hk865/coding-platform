本次只列 v2 改动涉及的实例。所有短文件名均相对于 `tests/work-graph/`。同一行列出多个行号时，每个行号分别是一处；按“节、文件、静态调用行、值类别”计数，不乘参数化测试或循环次数。同一次组外 helper 调用产生的同类值合并登记。

普通输入、上层手写记录，以及原有畸形输入拒绝测试不重新计数；例如 `S4A-note-write.test.ts:776` 的缺字段拒绝分支不因 v2 获得放行。依据：`.lead-ref/books/test-rule-sheet-v2.md:24`、`:30`、`:36`、`:43`。

**1．A1 草稿和外部值**

下表采用四个类别，owner、实参合同和判定如下：

- **H、P**：owner 为 `plans.proposePlan`；均提交完整 `PlanRevisionDraft`，随后通过真实 `applyPlanChange`。H 是同时安装并激活完成策略的夹具调用，P 是其他计划提交。路由绑定：`src/app/core-routes.ts:704`、`:705`；合同：`src/contracts/plan.ts:200`。组外提交证据包括 `tests/helpers/S4A-note-fixture.ts:205`、`:222`、`:225`，`tests/helpers/S4A-note-scope-fixture.ts:212`、`:234`，`tests/helpers/task-claim-fixture.ts:323`、`:344`，`tests/helpers/S5-decision-fixture.ts:738`，`tests/helpers/K3-review-card-fixture.ts:122`，`tests/helpers/S4B-note-multi-scope-fixture.ts:105`、`:151`、`:206`，`tests/helpers/S4B-memory-fixture.ts:79`，`tests/helpers/S4C2-note-card-fixture.ts:244`，`tests/helpers/S8A-L8-reminder-world.ts:445`。
- **N**：owner 为 `notes.writeNote`；完整 `NoteDraftV1`，包括公共字段和对应种类的 `body`／`sections`。helper 补齐写入封套，没有忽略请求的写入替身。合同、路由和转发：`src/contracts/note.ts:51`、`:56`，`src/core/work-graph/model/note-contracts.ts:68`，`src/app/core-routes.ts:656`、`:903`，`tests/helpers/S4A-note-fixture.ts:281`、`:282`，`tests/helpers/S4A-note-scope-fixture.ts:329`。
- **T**：真实平台工具参数。`K3-14` 是 `record_unknown_call_review`；其强转后的请求仍委托真实 owner（`K3-14-unknown-call-review-tool.test.ts:256`、`:270`）。`K3-16` 是 `propose_safer_method`；helper 构造完整参数并省略空 `cwd`（`tests/helpers/K3-proposal-round.ts:705`、`:708`、`:760`）。`S4C-write-read-bounds.test.ts:196` 是真实 `record_note`。
- 表内这些草稿／参数的判定均为 **v2 允许**。平台签发字段另在第 2 表判断；这不代表整份测试的其他做法获准。

“公”表示所列输入链通过公开 owner／工具继续；“混”表示所在测试还有内部读取、内部写入或内部材料接口，不能称为全程仅公开。例如 Session 夹具内部路径见 `tests/helpers/S4A-note-fixture.ts:239`、`:242`，scope 夹具见 `tests/helpers/S4A-note-scope-fixture.ts:250`、`:253`、`:277`；K3 夹具见 `tests/helpers/S5-decision-fixture.ts:851`。这些旧问题不另计 F3。

| 文件及调用行，括号内为类别 | 后续 | 判定 |
|---|---|---|
| `K3-06-mixed-kinds-owner.test.ts:119,183`（H） | 混 | v2 允许 |
| `K3-10-crr-goal-basis.test.ts:117,158`（H） | 混 | v2 允许 |
| `K3-11-review-reasons.test.ts:106,251`（H） | 混 | v2 允许 |
| `K3-13-two-items-owner.test.ts:52`（H） | 混 | v2 允许 |
| `K3-14-unknown-call-review-tool.test.ts:72`（H）；`:270`（T） | 混；工具请求真实委托 | v2 允许 |
| `K3-15-disposition-effects.test.ts:82`（H） | 混 | v2 允许 |
| `K3-15-hold-release.test.ts:65`（H） | 混 | v2 允许 |
| `K3-15-list-by-task.test.ts:57,104`（H） | 混 | v2 允许 |
| `K3-16-approval-application.test.ts:57`（H）；`:112`（T） | 混；含 `:305` 事件读取 | v2 允许 |
| `K3-16-proposal-round-fixture.test.ts:64`（H）；`:77,124,155,161,173,223`（T） | 混 | v2 允许 |
| `K3-16-proposal-write.test.ts:55`（H） | 混；`:110` 读取事件 | v2 允许 |
| `K3-16-second-unfinished-proposal.test.ts:42`（H）；`:102,114,174,183`（T） | 混 | v2 允许 |
| `K3-17-disposition-replay.test.ts:56`（H） | 混 | v2 允许 |
| `K3-18-autonomy-facts.test.ts:64`（H） | 混 | v2 允许 |
| `K3-18-requeue-confirmed.test.ts:117,148`（H） | 混 | v2 允许 |
| `K3-18-review-card-queue.test.ts:189,276`（H） | `:189` 为真实 Host 链；`:276` 为混合夹具链 | v2 允许 |
| `K3-26-unknown-call-review-storage.test.ts:215,559,796,822,838,865,961`（H） | 混 | v2 允许 |
| `K3-35-owner-manifest-trim.test.ts:47`（H） | 混 | v2 允许 |
| `K3-39-record-note-lookup.test.ts:48`（H）；`:66,107`（N） | 混；`:59,100` 使用内部提交查找 | v2 允许 |
| `K3-39-tool-commit-lookup.test.ts:120,144,183,215,249,285,325`（H）；`:159,202`（P） | 混；`:164,206` 为提交查找 | v2 允许 |
| `K3-41-disposition-proof.test.ts:47`（H） | 混；`:72` 读取事件 | v2 允许 |
| `K3-43-continuation-vs-hold.test.ts:70`（H） | 混 | v2 允许 |
| `K3-43-review-claim-vs-hold.test.ts:47`（H） | 混 | v2 允许 |
| `K3-45-review-incomplete.test.ts:67`（H） | 混 | v2 允许 |
| `K3-47-claim-gate.test.ts:62`（H） | 混 | v2 允许 |
| `K3-47-continuation-gate.test.ts:60`（H） | 混；`:81` 直接读取记录 | v2 允许 |
| `K3-47-reader-facts.test.ts:63`（H） | 混 | v2 允许 |
| `K3-48-2-unknown-call-review-model-text-budget.test.ts:189,255,317`（H） | 混 | v2 允许 |
| `K3-48-3-required-writes.test.ts:56`（H） | 混 | v2 允许 |
| `S4A-note-caps.test.ts:51,64,94,95,108`（H）；`:40,54,67,112`（N） | 公 | v2 允许 |
| `S4A-note-concurrency.test.ts:39,68,98,131,150`（H）；`:44,49,51,71,73,87,107,108,137,138,159,160`（N） | 混；夹具建 Session，写后公开读取 | v2 允许 |
| `S4A-note-failures.test.ts:37,57,73,96,109,123,134,152`（H）；`:40,44,62,77,82,100,112,127,156,161`（N） | 混；真实 owner 加存储故障注入 | v2 允许 |
| `S4A-note-history.test.ts:37,52`（H）；`:61,68,80,81,82,90,91,100,103,114,117,126,136,162,164,175,199,202,220,249,278,281,286,290,292,301,304,308,347,354,360,380,381,382,387,401,403,405,407,409,411,429,444,469,475,476,496,500`（N） | 公共注记链；scope 分支含内部 Session 设置 | v2 允许 |
| `S4A-note-scope.test.ts:92`（H）；`:51,82`（P）；`:99,108,118,128,131,143,147,157,166,170,181,203,212,214,216,229,240,251,270,282,294,309,316,333,344,357,360,370,371,373,374,390,391,393,394,410,412,417,426,428,434,445,459`（N） | 混 | v2 允许 |
| `S4A-note-symbol.test.ts:84`（H）；`:102,118,141,156,168,180,195`（N） | 公 | v2 允许 |
| `S4A-note-write.test.ts:32`（H）；`:43,48,51,58,63,67,84,98,129,135,140,145,155,158,160,166,168,176,180,182,183,193,194,196,207,210,229,234,240,243,256,260,277,281,298,302,311,315,329,334,346,352,355,366,368,370,382,385,388,402,404,406,420,425,444,447,451,469,491,492,504,508,509,531,536,559,563,593,620,640,643,650,663,671,672,684,687,702,705,712,804,807,810,822,828,841,857,880,882,902,903,920,926`（N） | 公共写读；含 `:128` 等 Session 夹具链。`:135` 强转对象保留完整草稿，真实 owner 忽略伪造 source，`:139` 核对可信 source | v2 允许 |
| `S4B-memory-anchor-not-found.test.ts:28,46,65,82,105`（H）；`:21`（N） | 公 | v2 允许 |
| `S4B-memory-conflicts-read.test.ts:18,34`（H）；`:20,22,36,38`（N） | 公 | v2 允许 |
| `S4B-memory-coverage.test.ts:22`（H）；`:32,36`（N） | 公 | v2 允许 |
| `S4B-memory-current-filter.test.ts:32`（H）；`:35`（P）；`:25`（N） | 混；`:36` 使用 Session 夹具 | v2 允许 |
| `S4B-memory-find-stale.test.ts:25,41,55,71,84,101,127,140,160,176`（H）；`:18,73,112,143,146`（N） | 公 | v2 允许 |
| `S4B-memory-history.test.ts:25,46,62,80,90`（H）；`:18`（N） | 公 | v2 允许 |
| `S4B-memory-l12-bounds.test.ts:29,59,80,101,137,174,196`（H）；`:176,198`（P）；`:22,200`（N） | 公共查询；`:62` 等分支含 Session 夹具 | v2 允许 |
| `S4B-memory-not-found.test.ts:18,30`（H） | 公；未调用本文件的 draft 定义 | v2 允许 |
| `S4B-memory-observation.test.ts:28,50`（H）；`:21`（N） | 公 | v2 允许 |
| `S4B-memory-paging.test.ts:20,86,109,137,160,181,201,223`（H）；`:111`（P）；`:23,58,89,115,131,233`（N） | 公共查询；`:112` 分支含 Session 夹具 | v2 允许 |
| `S4B-memory-ranking.test.ts:27,52,67,91,121,155,187,208,232`（H）；`:20`（N） | 公 | v2 允许 |
| `S4B-memory-similar.test.ts:34,58`（H）；`:24,26,41,65`（N） | 混；`:36` 使用 Session 夹具 | v2 允许 |
| `S4B-memory-version-lists.test.ts:52,84,103,134`（H）；`:30`（P）；`:136`（N） | 公 | v2 允许 |
| `S4B-note-anchor-goals.test.ts:21,22,36,37,53,54,78,79`（H）；`:42,59,67,83`（P）；`:24,39,56,81`（N） | 公 | v2 允许 |
| `S4B-note-anchor-status.test.ts:73,94,110,123,137,153,171`（H）；`:51`（P）；`:23`（N） | 公 | v2 允许 |
| `S4B-note-basis-path.test.ts:19`（H）；`:21`（N） | 公；完整请求被路径规则拒绝 | v2 允许 |
| `S4B-note-budget-check.test.ts:27,61,74,85,105,117,128,147,161`（H）；`:20`（N） | 公 | v2 允许 |
| `S4B-note-check-head-version.test.ts:20`（H）；`:22`（N） | 公 | v2 允许 |
| `S4B-note-check-isolation.test.ts:34,35,65,66`（H）；`:72`（P）；`:37,38,68,69`（N） | 公 | v2 允许 |
| `S4B-note-check-observation.test.ts:28,40,57`（H）；`:21`（N） | 公 | v2 允许 |
| `S4B-note-conflicts.test.ts:19`（H）；`:21,24`（N） | 公 | v2 允许 |
| `S4B-note-definitions.test.ts:68,81,97`（H）；`:41`（P）；`:20`（N） | 公 | v2 允许 |
| `S4B-note-facts.test.ts:33,46,61,87,118`（H）；`:19`（N） | 混；`:96` 含内部设置；签发字段见第 2 表 | v2 允许 |
| `S4B-note-freshness.test.ts:28,41,56,74,92,109,125`（H）；`:21`（N） | 公 | v2 允许 |
| `S4B-note-hints.test.ts:39,47,55,63,71,82,83,97,98,112,113,125,135,155`（H）；`:85,100,115`（P）；`:25,89,104`（N） | 公 | v2 允许 |
| `S4B-note-invalid.test.ts:63,77`（H）；`:24`（P）；`:44`（N） | 混；`:39` 使用 Session 夹具 | v2 允许 |
| `S4B-note-missing-flows.test.ts:39,53,65,79,95,111,127,153`（H）；`:42,55,69,83,97,113,131,133,164`（N） | 公共注记链；`:127,153` 分支含内部设置，`:178` 写执行结果 | v2 允许 |
| `S4B-note-read-failures.test.ts:26,40`（H）；`:19`（N） | 公；故障包装委托真实 owner | v2 允许 |
| `S4B-note-symbol-recheck.test.ts:29,45,60,74`（H）；`:21`（N） | 公 | v2 允许 |
| `S4C-default-states.test.ts:90,136,169,197,239,278`（H）；`:60,201,241`（P）；`:23`（N） | 混；`:57` 等使用 Session 夹具 | v2 允许 |
| `S4C-find-byte-trim.test.ts:37`（H）；`:30,67`（N） | 混；`:66` 使用 Session 夹具 | v2 允许 |
| `S4C-find-read-bounds.test.ts:61,89`（H）；`:33,74`（N） | 混；`:71` 使用 Session 夹具 | v2 允许 |
| `S4C-node-notes.test.ts:35,107,119`（H）；`:40`（N） | 混；`:38` 归档夹具；注记后公开 node/lookup | v2 允许 |
| `S4C-note-protection.test.ts:35`（H）；`:72`（P）；`:116,118,120,131,134,155,166,178,181,197,199,218,220,240,243,259,262,275,279,290,301,317,320,351,355`（N） | 混；`:119` 等使用 Session 夹具 | v2 允许 |
| `S4C-note-related-find.test.ts:47`（H）；`:93`（P）；`:150`（N） | 混；`:116,119` 内部 Session 设置 | v2 允许 |
| `S4C-note-supersede-race.test.ts:73`（H）；`:94,99,107`（N） | 混；`:94` 使用 Session 夹具；另有读计数包装 | v2 允许 |
| `S4C-path-ownership-callers.test.ts:88,101,114,136,151`（H） | 混；`:45` 等替换 catalog 读取 | v2 允许 |
| `S4C-per-call-cache.test.ts:35,74,156`（H）；`:117`（P）；`:39,40,45,47,77,165,166,169,170`（N） | 混；scope 夹具路径 | v2 允许 |
| `S4C-project-understanding-write.test.ts:32`（H）；`:53,61,66,76,86,114,117,129,138`（N） | 混；`:52` 等使用 Session 夹具 | v2 允许 |
| `S4C-project-understanding.test.ts:44,70`（H）；`:47,75`（P）；`:30,37`（N） | 混；`:29` 使用 Session 夹具 | v2 允许 |
| `S4C-related-scope.test.ts:79,85`（H）；`:137`（P）；`:201,384,567`（N） | 混；`:160,163,246,464` 内部设置 | v2 允许 |
| `S4C-resolution-order.test.ts:57`（H）；`:69,71`（N） | 混；`:68` 使用 Session 夹具 | v2 允许 |
| `S4C-write-read-bounds.test.ts:54`（H）；`:68,69,74,93,94,95,97,120,121,123,152,153,154,158,187,188`（N）；`:196`（T） | 混；真实写读及计数；`:67` 使用 Session 夹具 | v2 允许 |
| `S4C2-D-rows.test.ts:46,68,101,123,148,174,192,218,275`（H）；`:224,254`（P）；`:48,57,70,71,103,105,125,130,152,176,177,194,203,234,235,241,277,279`（N） | 混；scope 夹具及 `:210` 内部 scribe 读取 | v2 允许 |
| `S4C2-D17.test.ts:54,74,92,110`（H）；`:38,40`（N） | 混；scope 夹具；写后公开队列/决定 | v2 允许 |
| `S4C2-N1.test.ts:34`（H）；`:40,41,42,44,46,48`（N） | 混；scope 夹具；写后公开队列 | v2 允许 |
| `S4C2-N2.test.ts:37`（H）；`:41,43,49,62`（N） | 混；scope 夹具；写后公开队列 | v2 允许 |
| `S4C2-N3.test.ts:47`（H）；`:53,54,56,58,63,65`（N） | 混；scope 夹具；写后公开队列 | v2 允许 |
| `S4C2-U3.test.ts:98,113`（H）；`:117`（N） | 混；`:78` 是另一路内部记录测试；`:117` 后走公开处置 | v2 允许 |
| `S4C2-U7.test.ts:88`（H）；`:99,101`（N） | 混；scope 夹具；写后公开队列 | v2 允许 |
| `S4C2-disposition-core.test.ts:95`（H）；`:110,114,117`（N） | 混；`:113` 使用 Session 夹具 | v2 允许 |
| `S4C2-m12h-store-fault.test.ts:35`（H）；`:40`（N） | 混；fault helper 经 scope 夹具；写后公开读取 | v2 允许 |
| `S4C2-memory-material.test.ts:62`（H）；`:225,451`（P）；`:76,281,380`（N） | 混；`:86` 等直接调用内部 memory material | v2 允许 |
| `S4C2-project-set-shared.test.ts:98`（H）；`:132,138`（N） | 混；`:130` Session 夹具，`:165` 内部材料计数 | v2 允许 |
| `S4C2-proof-changes.test.ts:76,89`（H）；`:35,38`（N） | 混；`:37` 使用 Session 夹具 | v2 允许 |
| `S4C2-read-counts.test.ts:87,187,537`（H）；`:220,252`（P）；`:108,284,291,385`（N） | 混；`:265` Session 设置，`:396` 内部 scribe 读取 | v2 允许 |
| `S4C2-rework-staleness.test.ts:55`（H）；`:281`（P）；`:89,92,175,180,185,193,196`（N） | 混；`:91` 使用 Session 夹具 | v2 允许 |
| `S4C2-scribe-user-reason.test.ts:49,95`（H）；`:101,128`（P）；`:53,62,113,116`（N） | 混；`:41` 内部 scribe 读取 | v2 允许 |
| `S4C2-task-window.test.ts:126,174,213,335`（H）；`:63,286`（P）；`:137,138,144,180,183,219,221,337,343`（N） | 混；`:306,310` Session 设置，`:361,380` 内部 scribe 读取 | v2 允许 |
| `S4C2-update-due.test.ts:66,141`（H）；`:52`（P）；`:70,80,94,110,120,151`（N） | `:66` 链公开；`:141` 夹具含内部设置 | v2 允许 |
| `S8A-L8-chunk-scope.test.ts:355`（P） | 公；`:360,363` 公开 apply/createSession | v2 允许 |
| `S8A-L8-read-counts.test.ts:85`（H） | 公共准备/材料读取；`:52` 为计数包装 | v2 允许 |
| `S8A-L8-reminders-public.test.ts:55,77,102,121,139,153,170,182,194,214,239,253,270,293,310,335,360`（H） | 公 | v2 允许 |
| `S8A-catalog-version-time.test.ts:22,69`（H） | 公 | v2 允许 |
| `SP-memory-check-scoped.test.ts:65,132,159,181,182,211,212`（H）；`:184,221`（P）；`:27,34,214,216`（N） | 混；`:67` 等使用 Session 夹具 | v2 允许 |
| `SP-memory-history-confirm.test.ts:37`（H）；`:29,43`（N） | 混；`:42` 使用 Session 夹具 | v2 允许 |
| `SP-memory-scoped-find.test.ts:32,64,89,120,146,164,183,205,227,251,289`（H）；`:24`（N） | 公；重建 cursor 单列第 2 表 | v2 允许 |
| `SP-note-reuse.test.ts:76`（H）；`:98,101,105`（N） | 混；`:108` 使用 Session 夹具；公开读带计数包装 | v2 允许 |

**2．A1 平台签发字段**

下表中：

- **D** 是 `completionPolicies.activateCompletionPolicy` 的 `target.digest`，从真实 install 返回值原样取得。H 的全部 **316 个调用点**均包含这一实例；另有本文件直接调用 `S8A-L8-chunk-scope.test.ts:272`。对应 helper 证据：`tests/helpers/S4A-note-fixture.ts:187`、`:190`，`tests/helpers/S4A-note-scope-fixture.ts:165`、`:168`，`tests/helpers/task-claim-fixture.ts:258`、`:259`，`tests/helpers/S5-decision-fixture.ts:646`、`:647`，`tests/helpers/S4B-note-multi-scope-fixture.ts:126`、`:129`，`tests/helpers/R3e-evidence-fixture.ts:180`、`:182`，`tests/helpers/S2C-D-node-support.ts:218`、`:219`，`tests/helpers/WP2-platform-support.ts:269`、`:270`，`tests/helpers/S8A-L8-reminder-world.ts:394`、`:395`。
- **R** 是 `runtime.startRun.prepared`。真实 prepare 返回值原样传入；helper 证据：`tests/helpers/K3-35-prepare.ts:93`、`:109`，`tests/helpers/K3-35-continuation-fixture.ts:481`、`:494`、`:501`，`tests/helpers/K3-proposal-round.ts:434`、`:436`，`tests/helpers/B2-crr-world.ts:125`，`tests/helpers/K3-review-card-fixture.ts:409`、`:448`，`tests/helpers/C1-mailbox-fixture.ts:146`。
- **F** 是 `decisionMessages.recordDecisionApplication.receipt`。K3 helper 从 `eventAt` 的事件 JSON 重建 `identityKey/fingerprint/cursor`，再注入决定流程（`tests/helpers/K3-review-card-fixture.ts:288`、`:291`、`:294`、`:315`）；成功动作由 `src/business/workflow/decision-actions.ts:449`、`:458` 送入登记 owner，故为 **F1**。

| 文件及调用行 | owner／字段与来源 | 判定 |
|---|---|---|
| 第 1 表全部 H 调用点；`S8A-L8-chunk-scope.test.ts:272` | D：真实 install 返回的 `contentDigest` 原样激活；后者来源 `:265`、`:273` | v2 允许 |
| `K3-06-mixed-kinds-owner.test.ts:121,145,196` | R | v2 允许 |
| `K3-10-crr-goal-basis.test.ts:74` | R | v2 允许 |
| `K3-13-two-items-owner.test.ts:54,66` | R | v2 允许 |
| `K3-15-disposition-effects.test.ts:103,132,152,217,255` | R | v2 允许 |
| `K3-15-disposition-effects.test.ts:134,162,279` | F：重建 receipt | F1 |
| `K3-15-hold-release.test.ts:98,139,227` | R | v2 允许 |
| `K3-15-list-by-task.test.ts:64,75,80,106` | R | v2 允许 |
| `K3-15-list-by-task.test.ts:42` | `unknownCallReviews.listReviews` 的 cursor，取前页 `:46` 的 nextCursor | v2 允许 |
| `K3-16-approval-application.test.ts:111,125,159,163` | R | v2 允许 |
| `K3-16-approval-application.test.ts:72,137,174,179,181` | F；`:72` 登记其成功分支，旧卡拒绝分支不重复计 | F1 |
| `K3-16-proposal-round-fixture.test.ts:77,124,142,146,154,160,173,223,253,258` | R | v2 允许 |
| `K3-16-proposal-round-fixture.test.ts:77,124,153,173,223` | F；reach helper 的 answer 步骤见 `tests/helpers/K3-proposal-round.ts:879` | F1 |
| `K3-16-proposal-write.test.ts:57,69` | R | v2 允许 |
| `K3-16-proposal-write.test.ts:66` | F | F1 |
| `K3-16-second-unfinished-proposal.test.ts:67,72,92,113,151,173,182` | R | v2 允许 |
| `K3-16-second-unfinished-proposal.test.ts:89,169` | F | F1 |
| `K3-17-disposition-replay.test.ts:58` | R | v2 允许 |
| `K3-17-disposition-replay.test.ts:68,76,89,96,104,115,122` | F；包括重放和登记失败后的重试；`:148,153` 拒绝路径未传 receipt | F1 |
| `K3-18-autonomy-facts.test.ts:86` | R | v2 允许 |
| `K3-18-requeue-confirmed.test.ts:120,151` | R | v2 允许 |
| `K3-18-requeue-confirmed.test.ts:122` | F | F1 |
| `K3-18-review-card-queue.test.ts:117,285` | R；`:117` 的 prepared 直接来自 `:115,116` | v2 允许 |
| `K3-18-review-card-queue.test.ts:104,181,189,194,195,200,201` | Host 请求 credential；真实页面 token 原样回传。读取和发送见 `tests/helpers/AG2b-collaboration-fixture.ts:263`、`:343`、`:357`，`tests/scenarios/support/control.ts:100`、`:151` | v2 允许 |
| `K3-26-unknown-call-review-storage.test.ts:255,291,583,756,963,972` | R | v2 允许 |
| `K3-35-owner-manifest-trim.test.ts:52,71` | R | v2 允许 |
| `K3-35-owner-manifest-trim.test.ts:88` | `materials.openArtifact.ref`；`:81,82` 公开 execution 读取中的 bundleRef 原样取出，`:91` 送入；没有把重建 prepared 送入 startRun | v2 允许 |
| `K3-39-tool-commit-lookup.test.ts:215,249` | R；C1 helper 启动真实 Run | v2 允许 |
| `K3-41-disposition-proof.test.ts:49,99` | R | v2 允许 |
| `K3-41-disposition-proof.test.ts:51,112` | F；`:112` 的 receiptA 来自 `:60` 调用重建 helper，并非公开返回的完整 receipt | F1 |
| `K3-43-continuation-vs-hold.test.ts:88` | R | v2 允许 |
| `K3-43-review-claim-vs-hold.test.ts:53` | R | v2 允许 |
| `K3-47-claim-gate.test.ts:86,195` | R | v2 允许 |
| `K3-47-continuation-gate.test.ts:154,181` | R；分别来自 `:152,179` 的真实 prepare | v2 允许 |
| `K3-47-reader-facts.test.ts:109,129,149,161,173,203,217` | R | v2 允许 |
| `K3-48-2-unknown-call-review-model-text-budget.test.ts:264,283,299,323,348,362` | R | v2 允许 |
| `K3-48-2-unknown-call-review-model-text-budget.test.ts:293,358` | F | F1 |
| `K3-48-3-required-writes.test.ts:58` | R | v2 允许 |
| `S4A-note-caps.test.ts:76,102` | `notes.listByAnchor.cursor`；前页返回值，来源 `:84,98` | v2 允许 |
| `S4B-memory-history.test.ts:108` | `notes.memoryHistory.cursor`；来源 `:104` | v2 允许 |
| `S4B-memory-l12-bounds.test.ts:46,69,115,160` | `notes.memoryFind/memoryLookup.cursor`；公开分页返回值，来源 `:37,65,130,149` | v2 允许 |
| `S4B-memory-paging.test.ts:41,61,77,99,151,173,192,211` | notes 查询的 cursor／body.cursor；前页或正文页原返回值，来源 `:35,55,73,95,145,167,189,208` | v2 允许 |
| `S4B-memory-ranking.test.ts:106,111,138,170,248` | `notes.memoryFind.cursor`；公开前页原值，来源 `:101,106,144,176,242` | v2 允许 |
| `S4B-memory-version-lists.test.ts:94` | plan version-list cursor；来源 `:88` | v2 允许 |
| `S4B-memory-version-lists.test.ts:108` | `architecture.reviseArchitectureCatalog.basedOn.digest`；公开读取 `:106` | v2 允许 |
| `S4B-note-anchor-status.test.ts:32` | 同上；来源 `:30` | v2 允许 |
| `S4B-note-check-isolation.test.ts:25` | 同上；来源 `:23` | v2 允许 |
| `S4B-note-definitions.test.ts:59` | 同上；来源 `:55` | v2 允许 |
| `S4B-note-facts.test.ts:71` | `notes.writeNote` 内 artifact ref/digest；真实 `storeArtifact:66` 返回值 | v2 允许 |
| `S4B-note-facts.test.ts:78` | artifact digest 被 `:77` 改成全零 | F1 |
| `S4B-note-facts.test.ts:104,110` | kernel-history `fromPosition/throughPosition`；`:101,103` 手填 12，调用处手填 15／25 | F1 |
| `S4C-default-states.test.ts:223` | `notes.memoryLookup.cursor`；公开 first 页原值 | v2 允许 |
| `S4C-note-related-find.test.ts:201` | `notes.memoryFind.cursor`；来源 `:193` | v2 允许 |
| `S4C-related-scope.test.ts:274,282,443,447,452,457,466,585` | `notes.memoryFind.cursor`；各自前页 next 原样回传，包括换查询后被拒绝的原 cursor | v2 允许 |
| `S4C-related-scope.test.ts:438` | `notes.memoryFind.cursor`；解析后改 `rule:1` 再序列化 | F1 |
| `S4C2-N3.test.ts:101` | decision queue cursor；page1.nextCursor 原值 | v2 允许 |
| `S4C2-N3.test.ts:118` | `workspaceDecisionSettings.markNoticesSeen.displayToken/seenThrough`；`:101` 返回 page2 原值，转发见 `tests/helpers/S4C2-note-card-fixture.ts:389,390` | v2 允许 |
| `S4C2-U3.test.ts:156` | `decisionMessages.recordDecisionApplication.receipt`；真实 withdraw `:145` 返回的 receipt，`:157` 原样回传 | v2 允许 |
| `S4C2-project-set-shared.test.ts:265` | `notes.memoryFind.cursor`；来源 `:254` | v2 允许 |
| `S4C2-read-counts.test.ts:598` | catalog baseline digest；公开读取 `:592` | v2 允许 |
| `S4C2-update-due.test.ts:156` | `materials.openArtifact.ref`；prepare 返回的 bundleRef，helper `tests/helpers/WP2-platform-support.ts:917,919,920` | v2 允许 |
| `S4C2-update-due.test.ts:157` | R；`:156` 返回 prepared 原值 | v2 允许 |
| `S8A-L8-chunk-scope.test.ts:333` | catalog baseline digest；公开读取 `:327` | v2 允许 |
| `S8A-L8-chunk-scope.test.ts:468,470,558` | `materials.openArtifact.ref`；真实 prepare 返回的 bundleRef，helper `tests/helpers/S8A-L8-prepare.ts:40,44,45` | v2 允许 |
| `S8A-L8-observation-state.test.ts:202` | catalog baseline digest；公开读取 `:198` | v2 允许 |
| `S8A-L8-read-counts.test.ts:96,125` | `materials.openArtifact.ref`；同一真实 prepare→openArtifact helper | v2 允许 |
| `S8A-L8-reminders-public.test.ts:48,374,390` | `materials.openArtifact.ref`；同一真实 prepare→openArtifact helper | v2 允许 |
| `S8A-L8-reminders-public.test.ts:380,394` | catalog baseline digest；helper 公开读取后原样提交，`tests/helpers/S8A-L8-reminder-world.ts:510,522,526` | v2 允许 |
| `S8A-catalog-version-time.test.ts:32,77` | catalog baseline digest；公开读取 `:26,73` | v2 允许 |
| `S8A-file-layer.test.ts:175,208,263,265,317` | architecture listFiles/neighbors cursor；真实前页 nextCursor，来源 `:181,200,259,322` | v2 允许 |
| `S8A-file-layer.test.ts:412,451,458,462,467` | `architecture.compareFormalObserved` 的 catalog digest；公开读取 `:405,444` 原值 | v2 允许 |
| `S8A-file-layer.test.ts:454` | 同字段被 `:453` 替换成测试生成的 `hex('d')` | F1 |
| `SP-memory-check-scoped.test.ts:51` | catalog baseline digest；公开读取 `:49` | v2 允许 |
| `SP-memory-scoped-find.test.ts:106,265` | `notes.memoryFind.cursor`；真实前页 next，来源 `:99,278` | v2 允许 |
| `SP-memory-scoped-find.test.ts:302,310` | `notes.memoryFind.cursor`；`:299,300,301,309` 解析、修改并重建；`:310` 还改写 after 为 missing key | F1 |

**3．Record-store 自身测试**

| 范围 | 结论 |
|---|---|
| `.lead-ref/groups/L6-files.txt:1` 至 `:126` | 全部为 work-graph 测试，没有本节实例。上层手写记录不在本次重列范围；本节 F3 计数为 0。规则范围见 `.lead-ref/books/test-rule-sheet-v2.md:38`、`:41`、`:43`。 |

**4．A7**

| 指定 helper | L6 及可达测试 helper 中的使用 | 判定 |
|---|---|---|
| `buildNoteTools` | 未发现。`S4C-write-read-bounds.test.ts:192` 使用的是 `createNoteTools`，`:196` 执行真实工具。指定边界见 `.lead-ref/books/test-rule-sheet-v2.md:45`、`:47` | 无实例 |
| `damageKernel` | 未发现。允许文件及边界见 `.lead-ref/books/test-rule-sheet-v2.md:50`、`:51`、`:52`、`:58` | 无实例 |
| `process-sandbox-standin` | 未发现，也未发现 `executeChecks` 使用。指定边界见 `.lead-ref/books/test-rule-sheet-v2.md:59`、`:60`、`:64` | 无实例 |

**无实例文件**

以下 20 个文件没有上述四类实例；其中内部纯函数／内部读取器接收的测试值，不当作公开输入登记：

`K3-39-request-id.test.ts:16`、`K3-48-unknown-call-review-creation-budget.test.ts:52`、`K3-50-codec-shape-checks.test.ts:22`、`K3-B3-request-order.test.ts:66`、`K3-receipt-replay.test.ts:69`、`K3-task-closure.test.ts:30`、`S4C-note-continuity.test.ts:10`、`S4C-note-path-ownership.test.ts:13`、`S4C-scribe-ownership.test.ts:24`、`S4C2-collection-card-source.test.ts:94`、`S4C2-goal-triggers.test.ts:120`、`S4C2-notice-class.test.ts:41`、`S4C2-notice-grouping.test.ts:41`、`S4C2-pending-understanding-overridden.test.ts:65`、`S4C2-update-due-fold.test.ts:76`、`S8A-L8-reminders-pure.test.ts:101`、`S8A-formal-comparison.test.ts:63`、`S8A-path-ownership-dedupe.test.ts:13`、`S8A-root-path.test.ts:136`、`S8D-coverage-notes.test.ts:45`。

JSON 使用上述相同短文件名和类别。第 1 节 `line` 按 H/P/N/T 分组；第 2 节 D/R/F 与表中定义相同。每个数组中的整数分别计数。

```json
[
  {"section":"1","file":"K3-06-mixed-kinds-owner.test.ts","line":{"H":[119,183]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-10-crr-goal-basis.test.ts","line":{"H":[117,158]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-11-review-reasons.test.ts","line":{"H":[106,251]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-13-two-items-owner.test.ts","line":{"H":[52]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-14-unknown-call-review-tool.test.ts","line":{"H":[72],"T":[270]},"owner":"plans.proposePlan；record_unknown_call_review","value":"完整计划草稿、工具参数","verdict":"v2 允许","note":"强转后仍真实委托；混合链"},
  {"section":"1","file":"K3-15-disposition-effects.test.ts","line":{"H":[82]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-15-hold-release.test.ts","line":{"H":[65]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-15-list-by-task.test.ts","line":{"H":[57,104]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-16-approval-application.test.ts","line":{"H":[57],"T":[112]},"owner":"plans.proposePlan；propose_safer_method","value":"完整计划草稿、工具参数","verdict":"v2 允许","note":"真实工具；混合链"},
  {"section":"1","file":"K3-16-proposal-round-fixture.test.ts","line":{"H":[64],"T":[77,124,155,161,173,223]},"owner":"plans.proposePlan；propose_safer_method","value":"完整计划草稿、工具参数","verdict":"v2 允许","note":"真实工具；混合链"},
  {"section":"1","file":"K3-16-proposal-write.test.ts","line":{"H":[55]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；110读取事件"},
  {"section":"1","file":"K3-16-second-unfinished-proposal.test.ts","line":{"H":[42],"T":[102,114,174,183]},"owner":"plans.proposePlan；propose_safer_method","value":"完整计划草稿、工具参数","verdict":"v2 允许","note":"真实工具；混合链"},
  {"section":"1","file":"K3-17-disposition-replay.test.ts","line":{"H":[56]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-18-autonomy-facts.test.ts","line":{"H":[64]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-18-requeue-confirmed.test.ts","line":{"H":[117,148]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-18-review-card-queue.test.ts","line":{"H":[189,276]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"189真实Host；276混合链"},
  {"section":"1","file":"K3-26-unknown-call-review-storage.test.ts","line":{"H":[215,559,796,822,838,865,961]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-35-owner-manifest-trim.test.ts","line":{"H":[47]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-39-record-note-lookup.test.ts","line":{"H":[48],"N":[66,107]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"后续内部提交查找"},
  {"section":"1","file":"K3-39-tool-commit-lookup.test.ts","line":{"H":[120,144,183,215,249,285,325],"P":[159,202]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"后续内部提交查找"},
  {"section":"1","file":"K3-41-disposition-proof.test.ts","line":{"H":[47]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；72读取事件"},
  {"section":"1","file":"K3-43-continuation-vs-hold.test.ts","line":{"H":[70]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-43-review-claim-vs-hold.test.ts","line":{"H":[47]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-45-review-incomplete.test.ts","line":{"H":[67]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-47-claim-gate.test.ts","line":{"H":[62]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-47-continuation-gate.test.ts","line":{"H":[60]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；81读取记录"},
  {"section":"1","file":"K3-47-reader-facts.test.ts","line":{"H":[63]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-48-2-unknown-call-review-model-text-budget.test.ts","line":{"H":[189,255,317]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"K3-48-3-required-writes.test.ts","line":{"H":[56]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开apply；混合链"},
  {"section":"1","file":"S4A-note-caps.test.ts","line":{"H":[51,64,94,95,108],"N":[40,54,67,112]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4A-note-concurrency.test.ts","line":{"H":[39,68,98,131,150],"N":[44,49,51,71,73,87,107,108,137,138,159,160]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"写后公开读取；夹具含内部Session设置"},
  {"section":"1","file":"S4A-note-failures.test.ts","line":{"H":[37,57,73,96,109,123,134,152],"N":[40,44,62,77,82,100,112,127,156,161]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"真实owner加故障包装；混合链"},
  {"section":"1","file":"S4A-note-history.test.ts","line":{"H":[37,52],"N":[61,68,80,81,82,90,91,100,103,114,117,126,136,162,164,175,199,202,220,249,278,281,286,290,292,301,304,308,347,354,360,380,381,382,387,401,403,405,407,409,411,429,444,469,475,476,496,500]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公共注记链；scope分支混合"},
  {"section":"1","file":"S4A-note-scope.test.ts","line":{"H":[92],"P":[51,82],"N":[99,108,118,128,131,143,147,157,166,170,181,203,212,214,216,229,240,251,270,282,294,309,316,333,344,357,360,370,371,373,374,390,391,393,394,410,412,417,426,428,434,445,459]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开apply及注记操作；scope夹具混合"},
  {"section":"1","file":"S4A-note-symbol.test.ts","line":{"H":[84],"N":[102,118,141,156,168,180,195]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4A-note-write.test.ts","line":{"H":[32],"N":[43,48,51,58,63,67,84,98,129,135,140,145,155,158,160,166,168,176,180,182,183,193,194,196,207,210,229,234,240,243,256,260,277,281,298,302,311,315,329,334,346,352,355,366,368,370,382,385,388,402,404,406,420,425,444,447,451,469,491,492,504,508,509,531,536,559,563,593,620,640,643,650,663,671,672,684,687,702,705,712,804,807,810,822,828,841,857,880,882,902,903,920,926]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"部分Session夹具链混合；135真实owner忽略额外伪造source"},
  {"section":"1","file":"S4B-memory-anchor-not-found.test.ts","line":{"H":[28,46,65,82,105],"N":[21]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-memory-conflicts-read.test.ts","line":{"H":[18,34],"N":[20,22,36,38]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-memory-coverage.test.ts","line":{"H":[22],"N":[32,36]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-memory-current-filter.test.ts","line":{"H":[32],"P":[35],"N":[25]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"36使用Session夹具"},
  {"section":"1","file":"S4B-memory-find-stale.test.ts","line":{"H":[25,41,55,71,84,101,127,140,160,176],"N":[18,73,112,143,146]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-memory-history.test.ts","line":{"H":[25,46,62,80,90],"N":[18]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-memory-l12-bounds.test.ts","line":{"H":[29,59,80,101,137,174,196],"P":[176,198],"N":[22,200]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开查询；62等分支含Session夹具"},
  {"section":"1","file":"S4B-memory-not-found.test.ts","line":{"H":[18,30]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开后续；未调用本地注记draft定义"},
  {"section":"1","file":"S4B-memory-observation.test.ts","line":{"H":[28,50],"N":[21]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-memory-paging.test.ts","line":{"H":[20,86,109,137,160,181,201,223],"P":[111],"N":[23,58,89,115,131,233]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开查询；112分支含Session夹具"},
  {"section":"1","file":"S4B-memory-ranking.test.ts","line":{"H":[27,52,67,91,121,155,187,208,232],"N":[20]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-memory-similar.test.ts","line":{"H":[34,58],"N":[24,26,41,65]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"36使用Session夹具"},
  {"section":"1","file":"S4B-memory-version-lists.test.ts","line":{"H":[52,84,103,134],"P":[30],"N":[136]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-note-anchor-goals.test.ts","line":{"H":[21,22,36,37,53,54,78,79],"P":[42,59,67,83],"N":[24,39,56,81]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-note-anchor-status.test.ts","line":{"H":[73,94,110,123,137,153,171],"P":[51],"N":[23]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-note-basis-path.test.ts","line":{"H":[19],"N":[21]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开路径拒绝"},
  {"section":"1","file":"S4B-note-budget-check.test.ts","line":{"H":[27,61,74,85,105,117,128,147,161],"N":[20]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-note-check-head-version.test.ts","line":{"H":[20],"N":[22]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-note-check-isolation.test.ts","line":{"H":[34,35,65,66],"P":[72],"N":[37,38,68,69]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-note-check-observation.test.ts","line":{"H":[28,40,57],"N":[21]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-note-conflicts.test.ts","line":{"H":[19],"N":[21,24]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-note-definitions.test.ts","line":{"H":[68,81,97],"P":[41],"N":[20]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-note-facts.test.ts","line":{"H":[33,46,61,87,118],"N":[19]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"96内部设置；签发字段另判"},
  {"section":"1","file":"S4B-note-freshness.test.ts","line":{"H":[28,41,56,74,92,109,125],"N":[21]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-note-hints.test.ts","line":{"H":[39,47,55,63,71,82,83,97,98,112,113,125,135,155],"P":[85,100,115],"N":[25,89,104]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-note-invalid.test.ts","line":{"H":[63,77],"P":[24],"N":[44]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"39使用Session夹具"},
  {"section":"1","file":"S4B-note-missing-flows.test.ts","line":{"H":[39,53,65,79,95,111,127,153],"N":[42,55,69,83,97,113,131,133,164]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公共注记链；127、153、178分支混合"},
  {"section":"1","file":"S4B-note-read-failures.test.ts","line":{"H":[26,40],"N":[19]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4B-note-symbol-recheck.test.ts","line":{"H":[29,45,60,74],"N":[21]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S4C-default-states.test.ts","line":{"H":[90,136,169,197,239,278],"P":[60,201,241],"N":[23]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"57等使用Session夹具"},
  {"section":"1","file":"S4C-find-byte-trim.test.ts","line":{"H":[37],"N":[30,67]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"66使用Session夹具"},
  {"section":"1","file":"S4C-find-read-bounds.test.ts","line":{"H":[61,89],"N":[33,74]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"71使用Session夹具"},
  {"section":"1","file":"S4C-node-notes.test.ts","line":{"H":[35,107,119],"N":[40]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"38归档夹具；注记后公开读取"},
  {"section":"1","file":"S4C-note-protection.test.ts","line":{"H":[35],"P":[72],"N":[116,118,120,131,134,155,166,178,181,197,199,218,220,240,243,259,262,275,279,290,301,317,320,351,355]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公共处置；119等使用Session夹具"},
  {"section":"1","file":"S4C-note-related-find.test.ts","line":{"H":[47],"P":[93],"N":[150]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"116、119内部Session设置"},
  {"section":"1","file":"S4C-note-supersede-race.test.ts","line":{"H":[73],"N":[94,99,107]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"94使用Session夹具；公开写读加计数"},
  {"section":"1","file":"S4C-path-ownership-callers.test.ts","line":{"H":[88,101,114,136,151]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"45等替换catalog读取；混合链"},
  {"section":"1","file":"S4C-per-call-cache.test.ts","line":{"H":[35,74,156],"P":[117],"N":[39,40,45,47,77,165,166,169,170]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"scope夹具混合链"},
  {"section":"1","file":"S4C-project-understanding-write.test.ts","line":{"H":[32],"N":[53,61,66,76,86,114,117,129,138]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"52等使用Session夹具"},
  {"section":"1","file":"S4C-project-understanding.test.ts","line":{"H":[44,70],"P":[47,75],"N":[30,37]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"29使用Session夹具"},
  {"section":"1","file":"S4C-related-scope.test.ts","line":{"H":[79,85],"P":[137],"N":[201,384,567]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"160、163、246、464内部设置"},
  {"section":"1","file":"S4C-resolution-order.test.ts","line":{"H":[57],"N":[69,71]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"68使用Session夹具"},
  {"section":"1","file":"S4C-write-read-bounds.test.ts","line":{"H":[54],"N":[68,69,74,93,94,95,97,120,121,123,152,153,154,158,187,188],"T":[196]},"owner":"plans.proposePlan；notes.writeNote；record_note","value":"完整计划草稿、注记草稿、工具参数","verdict":"v2 允许","note":"真实工具；67使用Session夹具；计数包装"},
  {"section":"1","file":"S4C2-D-rows.test.ts","line":{"H":[46,68,101,123,148,174,192,218,275],"P":[224,254],"N":[48,57,70,71,103,105,125,130,152,176,177,194,203,234,235,241,277,279]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"scope夹具；210内部scribe读取"},
  {"section":"1","file":"S4C2-D17.test.ts","line":{"H":[54,74,92,110],"N":[38,40]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"scope夹具；写后公开队列/决定"},
  {"section":"1","file":"S4C2-N1.test.ts","line":{"H":[34],"N":[40,41,42,44,46,48]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"scope夹具；写后公开队列"},
  {"section":"1","file":"S4C2-N2.test.ts","line":{"H":[37],"N":[41,43,49,62]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"scope夹具；写后公开队列"},
  {"section":"1","file":"S4C2-N3.test.ts","line":{"H":[47],"N":[53,54,56,58,63,65]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"scope夹具；写后公开队列"},
  {"section":"1","file":"S4C2-U3.test.ts","line":{"H":[98,113],"N":[117]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"78另有内部记录路径；117后公开处置"},
  {"section":"1","file":"S4C2-U7.test.ts","line":{"H":[88],"N":[99,101]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"scope夹具；写后公开队列"},
  {"section":"1","file":"S4C2-disposition-core.test.ts","line":{"H":[95],"N":[110,114,117]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"113使用Session夹具"},
  {"section":"1","file":"S4C2-m12h-store-fault.test.ts","line":{"H":[35],"N":[40]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"fault/scope夹具；写后公开读取"},
  {"section":"1","file":"S4C2-memory-material.test.ts","line":{"H":[62],"P":[225,451],"N":[76,281,380]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"86等内部memory material读取"},
  {"section":"1","file":"S4C2-project-set-shared.test.ts","line":{"H":[98],"N":[132,138]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"130 Session夹具；165内部材料计数"},
  {"section":"1","file":"S4C2-proof-changes.test.ts","line":{"H":[76,89],"N":[35,38]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"37使用Session夹具"},
  {"section":"1","file":"S4C2-read-counts.test.ts","line":{"H":[87,187,537],"P":[220,252],"N":[108,284,291,385]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"265 Session设置；396内部scribe读取"},
  {"section":"1","file":"S4C2-rework-staleness.test.ts","line":{"H":[55],"P":[281],"N":[89,92,175,180,185,193,196]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"91使用Session夹具"},
  {"section":"1","file":"S4C2-scribe-user-reason.test.ts","line":{"H":[49,95],"P":[101,128],"N":[53,62,113,116]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"41内部scribe读取"},
  {"section":"1","file":"S4C2-task-window.test.ts","line":{"H":[126,174,213,335],"P":[63,286],"N":[137,138,144,180,183,219,221,337,343]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"306、310 Session设置；361、380内部读取"},
  {"section":"1","file":"S4C2-update-due.test.ts","line":{"H":[66,141],"P":[52],"N":[70,80,94,110,120,151]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"66链公开；141夹具混合"},
  {"section":"1","file":"S8A-L8-chunk-scope.test.ts","line":{"P":[355]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"360、363公开apply/createSession"},
  {"section":"1","file":"S8A-L8-read-counts.test.ts","line":{"H":[85]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开后续；52计数包装"},
  {"section":"1","file":"S8A-L8-reminders-public.test.ts","line":{"H":[55,77,102,121,139,153,170,182,194,214,239,253,270,293,310,335,360]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"S8A-catalog-version-time.test.ts","line":{"H":[22,69]},"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"公开后续"},
  {"section":"1","file":"SP-memory-check-scoped.test.ts","line":{"H":[65,132,159,181,182,211,212],"P":[184,221],"N":[27,34,214,216]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"67等使用Session夹具"},
  {"section":"1","file":"SP-memory-history-confirm.test.ts","line":{"H":[37],"N":[29,43]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"42使用Session夹具"},
  {"section":"1","file":"SP-memory-scoped-find.test.ts","line":{"H":[32,64,89,120,146,164,183,205,227,251,289],"N":[24]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"公开后续；cursor另判"},
  {"section":"1","file":"SP-note-reuse.test.ts","line":{"H":[76],"N":[98,101,105]},"owner":"plans.proposePlan；notes.writeNote","value":"完整计划草稿、注记草稿","verdict":"v2 允许","note":"108使用Session夹具；公开读加计数"},

  {"section":"2","file":"K3-06-mixed-kinds-owner.test.ts","line":[119,183],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-10-crr-goal-basis.test.ts","line":[117,158],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-11-review-reasons.test.ts","line":[106,251],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-13-two-items-owner.test.ts","line":[52],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-14-unknown-call-review-tool.test.ts","line":[72],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-15-disposition-effects.test.ts","line":[82],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-15-hold-release.test.ts","line":[65],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-15-list-by-task.test.ts","line":[57,104],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-16-approval-application.test.ts","line":[57],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-16-proposal-round-fixture.test.ts","line":[64],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-16-proposal-write.test.ts","line":[55],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-16-second-unfinished-proposal.test.ts","line":[42],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-17-disposition-replay.test.ts","line":[56],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-18-autonomy-facts.test.ts","line":[64],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-18-requeue-confirmed.test.ts","line":[117,148],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-18-review-card-queue.test.ts","line":[189,276],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-26-unknown-call-review-storage.test.ts","line":[215,559,796,822,838,865,961],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-35-owner-manifest-trim.test.ts","line":[47],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-39-record-note-lookup.test.ts","line":[48],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-39-tool-commit-lookup.test.ts","line":[120,144,183,215,249,285,325],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-41-disposition-proof.test.ts","line":[47],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-43-continuation-vs-hold.test.ts","line":[70],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-43-review-claim-vs-hold.test.ts","line":[47],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-45-review-incomplete.test.ts","line":[67],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-47-claim-gate.test.ts","line":[62],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-47-continuation-gate.test.ts","line":[60],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-47-reader-facts.test.ts","line":[63],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-48-2-unknown-call-review-model-text-budget.test.ts","line":[189,255,317],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"K3-48-3-required-writes.test.ts","line":[56],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4A-note-caps.test.ts","line":[51,64,94,95,108],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4A-note-concurrency.test.ts","line":[39,68,98,131,150],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4A-note-failures.test.ts","line":[37,57,73,96,109,123,134,152],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4A-note-history.test.ts","line":[37,52],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4A-note-scope.test.ts","line":[92],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4A-note-symbol.test.ts","line":[84],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4A-note-write.test.ts","line":[32],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-memory-anchor-not-found.test.ts","line":[28,46,65,82,105],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-memory-conflicts-read.test.ts","line":[18,34],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-memory-coverage.test.ts","line":[22],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-memory-current-filter.test.ts","line":[32],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-memory-find-stale.test.ts","line":[25,41,55,71,84,101,127,140,160,176],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-memory-history.test.ts","line":[25,46,62,80,90],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-memory-l12-bounds.test.ts","line":[29,59,80,101,137,174,196],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-memory-not-found.test.ts","line":[18,30],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-memory-observation.test.ts","line":[28,50],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-memory-paging.test.ts","line":[20,86,109,137,160,181,201,223],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-memory-ranking.test.ts","line":[27,52,67,91,121,155,187,208,232],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-memory-similar.test.ts","line":[34,58],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-memory-version-lists.test.ts","line":[52,84,103,134],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-anchor-goals.test.ts","line":[21,22,36,37,53,54,78,79],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-anchor-status.test.ts","line":[73,94,110,123,137,153,171],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-basis-path.test.ts","line":[19],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-budget-check.test.ts","line":[27,61,74,85,105,117,128,147,161],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-check-head-version.test.ts","line":[20],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-check-isolation.test.ts","line":[34,35,65,66],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-check-observation.test.ts","line":[28,40,57],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-conflicts.test.ts","line":[19],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-definitions.test.ts","line":[68,81,97],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-facts.test.ts","line":[33,46,61,87,118],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-freshness.test.ts","line":[28,41,56,74,92,109,125],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-hints.test.ts","line":[39,47,55,63,71,82,83,97,98,112,113,125,135,155],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-invalid.test.ts","line":[63,77],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-missing-flows.test.ts","line":[39,53,65,79,95,111,127,153],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-read-failures.test.ts","line":[26,40],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4B-note-symbol-recheck.test.ts","line":[29,45,60,74],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-default-states.test.ts","line":[90,136,169,197,239,278],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-find-byte-trim.test.ts","line":[37],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-find-read-bounds.test.ts","line":[61,89],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-node-notes.test.ts","line":[35,107,119],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-note-protection.test.ts","line":[35],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-note-related-find.test.ts","line":[47],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-note-supersede-race.test.ts","line":[73],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-path-ownership-callers.test.ts","line":[88,101,114,136,151],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-per-call-cache.test.ts","line":[35,74,156],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-project-understanding-write.test.ts","line":[32],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-project-understanding.test.ts","line":[44,70],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-related-scope.test.ts","line":[79,85],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-resolution-order.test.ts","line":[57],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C-write-read-bounds.test.ts","line":[54],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-D-rows.test.ts","line":[46,68,101,123,148,174,192,218,275],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-D17.test.ts","line":[54,74,92,110],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-N1.test.ts","line":[34],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-N2.test.ts","line":[37],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-N3.test.ts","line":[47],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-U3.test.ts","line":[98,113],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-U7.test.ts","line":[88],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-disposition-core.test.ts","line":[95],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-m12h-store-fault.test.ts","line":[35],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-memory-material.test.ts","line":[62],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-project-set-shared.test.ts","line":[98],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-proof-changes.test.ts","line":[76,89],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-read-counts.test.ts","line":[87,187,537],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-rework-staleness.test.ts","line":[55],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-scribe-user-reason.test.ts","line":[49,95],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-task-window.test.ts","line":[126,174,213,335],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S4C2-update-due.test.ts","line":[66,141],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S8A-L8-chunk-scope.test.ts","line":[272],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"265、273原样取得digest"},
  {"section":"2","file":"S8A-L8-read-counts.test.ts","line":[85],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S8A-L8-reminders-public.test.ts","line":[55,77,102,121,139,153,170,182,194,214,239,253,270,293,310,335,360],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"S8A-catalog-version-time.test.ts","line":[22,69],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"SP-memory-check-scoped.test.ts","line":[65,132,159,181,182,211,212],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"SP-memory-history-confirm.test.ts","line":[37],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"SP-memory-scoped-find.test.ts","line":[32,64,89,120,146,164,183,205,227,251,289],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},
  {"section":"2","file":"SP-note-reuse.test.ts","line":[76],"owner":"completionPolicies.activateCompletionPolicy","value":"D","verdict":"v2 允许","note":"真实install返回digest"},

  {"section":"2","file":"K3-06-mixed-kinds-owner.test.ts","line":[121,145,196],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-10-crr-goal-basis.test.ts","line":[74],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-13-two-items-owner.test.ts","line":[54,66],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-15-disposition-effects.test.ts","line":[103,132,152,217,255],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-15-hold-release.test.ts","line":[98,139,227],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-15-list-by-task.test.ts","line":[64,75,80,106],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-16-approval-application.test.ts","line":[111,125,159,163],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-16-proposal-round-fixture.test.ts","line":[77,124,142,146,154,160,173,223,253,258],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-16-proposal-write.test.ts","line":[57,69],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-16-second-unfinished-proposal.test.ts","line":[67,72,92,113,151,173,182],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-17-disposition-replay.test.ts","line":[58],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-18-autonomy-facts.test.ts","line":[86],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-18-requeue-confirmed.test.ts","line":[120,151],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-18-review-card-queue.test.ts","line":[117,285],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R；117来源115、116"},
  {"section":"2","file":"K3-26-unknown-call-review-storage.test.ts","line":[255,291,583,756,963,972],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-35-owner-manifest-trim.test.ts","line":[52,71],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-39-tool-commit-lookup.test.ts","line":[215,249],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"C1 helper真实启动"},
  {"section":"2","file":"K3-41-disposition-proof.test.ts","line":[49,99],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-43-continuation-vs-hold.test.ts","line":[88],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-43-review-claim-vs-hold.test.ts","line":[53],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-47-claim-gate.test.ts","line":[86,195],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-47-continuation-gate.test.ts","line":[154,181],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"来源152、179"},
  {"section":"2","file":"K3-47-reader-facts.test.ts","line":[109,129,149,161,173,203,217],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-48-2-unknown-call-review-model-text-budget.test.ts","line":[264,283,299,323,348,362],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"K3-48-3-required-writes.test.ts","line":[58],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R：真实prepare原返回值"},
  {"section":"2","file":"S4C2-update-due.test.ts","line":[157],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"156返回值原样回传"},

  {"section":"2","file":"K3-15-disposition-effects.test.ts","line":[134,162,279],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"F：helper从事件JSON重建"},
  {"section":"2","file":"K3-16-approval-application.test.ts","line":[72,137,174,179,181],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"F；72记成功分支"},
  {"section":"2","file":"K3-16-proposal-round-fixture.test.ts","line":[77,124,153,173,223],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"F；reach helper含answer步骤"},
  {"section":"2","file":"K3-16-proposal-write.test.ts","line":[66],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"F：helper从事件JSON重建"},
  {"section":"2","file":"K3-16-second-unfinished-proposal.test.ts","line":[89,169],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"F：helper从事件JSON重建"},
  {"section":"2","file":"K3-17-disposition-replay.test.ts","line":[68,76,89,96,104,115,122],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"F；包括重放和登记失败重试"},
  {"section":"2","file":"K3-18-requeue-confirmed.test.ts","line":[122],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"F：helper从事件JSON重建"},
  {"section":"2","file":"K3-41-disposition-proof.test.ts","line":[51,112],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"F；112的receiptA来源60的重建helper"},
  {"section":"2","file":"K3-48-2-unknown-call-review-model-text-budget.test.ts","line":[293,358],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"F：helper从事件JSON重建"},

  {"section":"2","file":"K3-15-list-by-task.test.ts","line":[42],"owner":"unknownCallReviews.listReviews","value":"cursor","verdict":"v2 允许","note":"46前页nextCursor"},
  {"section":"2","file":"S4A-note-caps.test.ts","line":[76,102],"owner":"notes.listByAnchor","value":"cursor","verdict":"v2 允许","note":"84、98公开前页原值"},
  {"section":"2","file":"S4B-memory-history.test.ts","line":[108],"owner":"notes.memoryHistory","value":"cursor","verdict":"v2 允许","note":"104公开前页原值"},
  {"section":"2","file":"S4B-memory-l12-bounds.test.ts","line":[46,69,115,160],"owner":"notes.memoryFind/memoryLookup","value":"cursor","verdict":"v2 允许","note":"37、65、130、149公开分页原值"},
  {"section":"2","file":"S4B-memory-paging.test.ts","line":[41,61,77,99,151,173,192,211],"owner":"notes查询","value":"cursor/body.cursor","verdict":"v2 允许","note":"35、55、73、95、145、167、189、208公开原值"},
  {"section":"2","file":"S4B-memory-ranking.test.ts","line":[106,111,138,170,248],"owner":"notes.memoryFind","value":"cursor","verdict":"v2 允许","note":"101、106、144、176、242公开原值"},
  {"section":"2","file":"S4B-memory-version-lists.test.ts","line":[94],"owner":"计划版本列表","value":"cursor","verdict":"v2 允许","note":"88公开前页原值"},
  {"section":"2","file":"S4C-default-states.test.ts","line":[223],"owner":"notes.memoryLookup","value":"cursor","verdict":"v2 允许","note":"公开first页原值"},
  {"section":"2","file":"S4C-note-related-find.test.ts","line":[201],"owner":"notes.memoryFind","value":"cursor","verdict":"v2 允许","note":"193公开前页原值"},
  {"section":"2","file":"S4C-related-scope.test.ts","line":[274,282,443,447,452,457,466,585],"owner":"notes.memoryFind","value":"cursor","verdict":"v2 允许","note":"各前页next原样回传"},
  {"section":"2","file":"S4C2-N3.test.ts","line":[101],"owner":"decisions.queryDecisionQueue","value":"cursor","verdict":"v2 允许","note":"page1.nextCursor原值"},
  {"section":"2","file":"S4C2-project-set-shared.test.ts","line":[265],"owner":"notes.memoryFind","value":"cursor","verdict":"v2 允许","note":"254公开前页原值"},
  {"section":"2","file":"SP-memory-scoped-find.test.ts","line":[106,265],"owner":"notes.memoryFind","value":"cursor","verdict":"v2 允许","note":"99、278公开前页原值"},
  {"section":"2","file":"S8A-file-layer.test.ts","line":[175,208,263,265,317],"owner":"architecture.listFiles/neighbors","value":"cursor","verdict":"v2 允许","note":"181、200、259、322公开前页原值"},

  {"section":"2","file":"S4B-memory-version-lists.test.ts","line":[108],"owner":"architecture.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"106公开读取原值"},
  {"section":"2","file":"S4B-note-anchor-status.test.ts","line":[32],"owner":"architecture.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"30公开读取原值"},
  {"section":"2","file":"S4B-note-check-isolation.test.ts","line":[25],"owner":"architecture.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"23公开读取原值"},
  {"section":"2","file":"S4B-note-definitions.test.ts","line":[59],"owner":"architecture.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"55公开读取原值"},
  {"section":"2","file":"S4C2-read-counts.test.ts","line":[598],"owner":"architecture.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"592公开读取原值"},
  {"section":"2","file":"S8A-L8-chunk-scope.test.ts","line":[333],"owner":"architecture.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"327公开读取原值"},
  {"section":"2","file":"S8A-L8-observation-state.test.ts","line":[202],"owner":"architecture.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"198公开读取原值"},
  {"section":"2","file":"S8A-catalog-version-time.test.ts","line":[32,77],"owner":"architecture.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"26、73公开读取原值"},
  {"section":"2","file":"SP-memory-check-scoped.test.ts","line":[51],"owner":"architecture.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"49公开读取原值"},
  {"section":"2","file":"S8A-file-layer.test.ts","line":[412,451,458,462,467],"owner":"architecture.compareFormalObserved","value":"catalog.digest","verdict":"v2 允许","note":"405、444公开读取原值"},
  {"section":"2","file":"S8A-L8-reminders-public.test.ts","line":[380,394],"owner":"architecture.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"S8A-L8-reminder-world.ts:510、526公开读取原值"},

  {"section":"2","file":"K3-18-review-card-queue.test.ts","line":[104,181,189,194,195,200,201],"owner":"Host公开请求入口","value":"平台访问token","verdict":"v2 允许","note":"真实页面签发后原样回传；AG2b-collaboration-fixture.ts:263、343、357"},
  {"section":"2","file":"K3-35-owner-manifest-trim.test.ts","line":[88],"owner":"materials.openArtifact","value":"bundleRef/digest","verdict":"v2 允许","note":"81、82公开execution读取原值；91传入"},
  {"section":"2","file":"S4B-note-facts.test.ts","line":[71],"owner":"notes.writeNote","value":"artifact.ref/digest","verdict":"v2 允许","note":"66真实storeArtifact返回值"},
  {"section":"2","file":"S8A-L8-reminders-public.test.ts","line":[48,374,390],"owner":"materials.openArtifact","value":"bundleRef/digest","verdict":"v2 允许","note":"S8A-L8-prepare.ts:40、44、45真实prepare返回值"},
  {"section":"2","file":"S8A-L8-chunk-scope.test.ts","line":[468,470,558],"owner":"materials.openArtifact","value":"bundleRef/digest","verdict":"v2 允许","note":"S8A-L8-prepare.ts:40、44、45真实prepare返回值"},
  {"section":"2","file":"S8A-L8-read-counts.test.ts","line":[96,125],"owner":"materials.openArtifact","value":"bundleRef/digest","verdict":"v2 允许","note":"S8A-L8-prepare.ts:40、44、45真实prepare返回值"},
  {"section":"2","file":"S4C2-update-due.test.ts","line":[156],"owner":"materials.openArtifact","value":"bundleRef/digest","verdict":"v2 允许","note":"WP2-platform-support.ts:917、919、920真实prepare返回值"},
  {"section":"2","file":"S4C2-N3.test.ts","line":[118],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"101返回page2原值；S4C2-note-card-fixture.ts:389、390"},
  {"section":"2","file":"S4C2-U3.test.ts","line":[156],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"v2 允许","note":"145真实withdraw返回值；157原样传入"},

  {"section":"2","file":"S4B-note-facts.test.ts","line":[78],"owner":"notes.writeNote","value":"artifact.ref.digest","verdict":"F1","note":"77改成全零"},
  {"section":"2","file":"S4B-note-facts.test.ts","line":[104,110],"owner":"notes.writeNote","value":"fromPosition/throughPosition","verdict":"F1","note":"101、103及调用处手填12、15、25"},
  {"section":"2","file":"S4C-related-scope.test.ts","line":[438],"owner":"notes.memoryFind","value":"cursor","verdict":"F1","note":"解析后改rule并重建"},
  {"section":"2","file":"SP-memory-scoped-find.test.ts","line":[302,310],"owner":"notes.memoryFind","value":"cursor","verdict":"F1","note":"299、300、301、309解析修改后重建"},
  {"section":"2","file":"S8A-file-layer.test.ts","line":[454],"owner":"architecture.compareFormalObserved","value":"catalog.digest","verdict":"F1","note":"453使用测试生成的hex('d')"}
]
```

v2 允许 1295，F1 35，F3 0，A7 越界 0，文件 126/126；枚举完整