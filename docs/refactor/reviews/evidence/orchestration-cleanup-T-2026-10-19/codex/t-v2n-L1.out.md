按静态调用点计数；同一调用点的不同来源分开判定。表中同文件多个行号分别计数，JSON 的 `line` 数组与表一致；`.each` 不按运行次数展开。

“v2 允许”只判该输入或存储测试行；后续已有旁路另注明，不将范围外的旧 F3/F7 重新计入。依据：`.lead-ref/books/test-rule-sheet-v2.md:24`、`.lead-ref/books/test-rule-sheet-v2.md:31`、`.lead-ref/books/test-rule-sheet-v2.md:38`。

第一节：A1 草稿与外部对象。

计划提案的完整参数按 `GraphWrite<ProposedPlanRequestV1>` 核对，包含 `goalRef`、`basedOn`、`draft`、`reason` 和 `meta`；对应公开绑定为 `plans/propose`。依据：`src/core/work-graph/model/plan-contracts.ts:38`、`src/core/work-graph/model/plan-contracts.ts:207`、`src/app/core-routes.ts:388`。

| 文件:行 | owner、值及完整性 | 后续是否只走公开步骤 | 判定 |
|---|---|---|---|
| tests/helpers/AG2b-collaboration-fixture.ts:461 | `plans.proposePlan`；完整计划草稿及请求 | 是；同文件:464 经公开 `plans/apply` | v2 允许 |
| tests/helpers/B2-execution-fixture.ts:160 | `plans.proposePlan`；完整草稿 | 提案链公开，:163 apply；夹具全程否，:282、:309 直接写执行入口 | v2 允许 |
| tests/helpers/K3-proposal-round.ts:203 | `plans.proposePlan`；完整草稿 | :211 公开 apply；夹具全程否，:331 直接读 records | v2 允许 |
| tests/helpers/K3-review-card-fixture.ts:122、377 | `plans.proposePlan`；两处完整草稿 | :128、:383 公开 apply；夹具全程否，:288 从 records 重建回执 | v2 允许 |
| tests/helpers/R3e-evidence-fixture.ts:209、394 | `plans.proposePlan`；初始及后续完整草稿 | :216、:401 公开 apply；夹具全程否，:265 直接 `recordRunResult` | v2 允许 |
| tests/helpers/S2A-notices-support.ts:175 | `plans.proposePlan`；完整草稿 | :178 公开 apply；夹具全程否，:271 直接写检查结果 | v2 允许 |
| tests/helpers/S2B-activity-fixture.ts:364 | `plans.proposePlan`；完整草稿 | :372 公开 apply；夹具全程否，:498 直接写运行结果 | v2 允许 |
| tests/helpers/S2B-task-timeline-fixture.ts:295、333 | `plans.proposePlan`；完整初始草稿及公开读出后编辑的版本草稿 | :302、:343 公开 apply；夹具全程否，:600、:631 有内部写入 | v2 允许 |
| tests/helpers/S2B-track-fixture.ts:281 | `plans.proposePlan`；完整草稿 | :288 公开 apply；夹具全程否，:392 直接写运行结果 | v2 允许 |
| tests/helpers/S2C-D-node-support.ts:281 | `plans.proposePlan`；完整草稿 | :284 公开 apply；夹具全程否，:300 直接登记 Session | v2 允许 |
| tests/helpers/S2C-L-line-support.ts:334 | `plans.proposePlan`；完整草稿 | :341 公开 apply；夹具全程否，:493 直接写异常锚点 | v2 允许 |
| tests/helpers/S4A-note-fixture.ts:222 | `plans.proposePlan`；完整草稿 | :225 公开 apply；夹具全程否，:242 直接登记 Session | v2 允许 |
| tests/helpers/S4A-note-scope-fixture.ts:212、234 | `plans.proposePlan`；两处完整草稿 | :215、:237 公开 apply；夹具全程否，:253 直接登记 Session | v2 允许 |
| tests/helpers/S4B-memory-fixture.ts:79 | `plans.proposePlan`；完整草稿 | :82 公开 apply；夹具全程否，:105 直接登记 Session | v2 允许 |
| tests/helpers/S4B-note-multi-scope-fixture.ts:105、151、206 | `plans.proposePlan`；完整草稿；:200 逐字段构造版本草稿 | 本文件提案链是，分别在 :108、:154、:213 apply；基础夹具另有 Session 内写，见 tests/helpers/S4A-note-scope-fixture.ts:253 | v2 允许 |
| tests/helpers/S4C2-note-card-fixture.ts:244 | `plans.proposePlan`；完整草稿 | :251 公开 apply；夹具全程否，:185 直接登记 Session | v2 允许 |
| tests/helpers/S5-decision-fixture.ts:738、938 | `plans.proposePlan`；完整初始草稿、候选草稿；分别由 :755、:756、:757 和 :946、:947 调用 | :744 公开 apply；候选分支保留提案返回值；夹具全程否，:845、:880 有内部执行写入 | v2 允许 |
| tests/helpers/S5-queue-support.ts:326 | `plans.proposePlan`；完整草稿 | :329 公开 apply；夹具全程否，:356、:362 直接写执行入口 | v2 允许 |
| tests/helpers/S5R2-a-support.ts:82 | `plans.proposePlan`；完整草稿，:70 逐字段构造 | 否；:92 公开读提案、:98 apply，但 :105 从 store 断言 Goal | v2 允许 |
| tests/helpers/S5R2-b-support.ts:253 | `plans.proposePlan`；完整草稿 | :260 公开 apply；夹具全程否，:176 直接写运行结果，:234 读 records | v2 允许 |
| tests/helpers/S5R2-c-support.ts:279 | `plans.proposePlan`；完整草稿 | 否；:284 公开 apply 后，:289 从 records 断言 Goal | v2 允许 |
| tests/helpers/S8A-L8-reminder-world.ts:445 | `plans.proposePlan`；完整草稿 | 是；:449 公开 apply | v2 允许 |
| tests/helpers/W2-whiteboard-fixture.ts:294、298、309 | `plans.proposePlan`；:285—290 构造完整请求并转交草稿 | 提案及 :303、:313 apply 公开；夹具全程否，:352 手工提交候选、:392 写运行结果 | v2 允许 |
| tests/helpers/WP1-entry-fixture.ts:310 | `plans.proposePlan`；:303 完整草稿 | :314 公开 apply；夹具全程否，:241 直接调用执行入口 | v2 允许 |
| tests/helpers/WP1-handover-fixture.ts:464 | `plans.proposePlan`；:450 完整草稿 | :469 公开 apply；夹具全程否，:360 直接写运行结果 | v2 允许 |
| tests/helpers/WP1-units-fixture.ts:199 | `plans.proposePlan`；:187 完整草稿 | :204 公开 apply；夹具全程否，:274 直接写检查结果、:321 直接读事件 | v2 允许 |
| tests/helpers/WP2-platform-support.ts:298、635、691 | `plans.proposePlan`；三处完整草稿 | :302、:641、:697 公开 apply；夹具全程否，:526 直接登记 Session、:579 手工提交治理记录 | v2 允许 |
| tests/helpers/graph-session-fixture.ts:425 | `plans.proposePlan`；:410 完整草稿 | :431 公开读提案、:433 apply；夹具全程否，:383 直接登记 Session | v2 允许 |
| tests/helpers/task-claim-fixture.ts:344 | `plans.proposePlan`；:323 完整草稿 | :350 公开 apply；随后并非全公开，:370 直接登记 Session | v2 允许 |
| tests/helpers/S4A-note-fixture.ts:282 | `notes.writeNote`；完整 `commandId/note/expectedPointerRevision/goalId`，转交 `NoteDraftV1` | 该写入转交真实 owner；夹具全程否，:242 有 Session 内写 | v2 允许 |
| tests/helpers/S4A-note-scope-fixture.ts:329 | `notes.writeNote`；完整写入请求，转交 `NoteDraftV1` | 该写入转交真实 owner；夹具全程否，:253 有 Session 内写 | v2 允许 |
| tests/helpers/S4C2-note-card-fixture.ts:287、293 | 经 `f.write` 到 `notes.writeNote`；分别为用户、成员草稿。:107、:117 的默认草稿完整，但 :113、:121 确有类型断言，不能用断言证明任意覆盖值合法 | 写入走真实 owner；夹具全程否，:185 有 Session 内写 | v2 允许 |
| tests/helpers/B2-blocked-runtime.ts:424 | `request_command_rerun`；:423 有参数断言；命令、理由及可选 `rewriteOf` 交真实工具校验，断言本身不构成放行依据 | 真实工具执行；读取真实 review 的路径见 :281 | v2 允许 |
| tests/helpers/B2-crr-world.ts:309 | `request_command_rerun`；完整 `command/reason/rewriteOf?` 参数 | :314 真实准备、启动，:318 读请求结果 | v2 允许 |
| tests/helpers/K3-proposal-round.ts:708 | `propose_safer_method`；:705—707 完整参数，空 `cwd` 省略；:699 的 `as never` 是工具创建上下文，不是参数补全 | 工具真实执行；夹具全程否，:331 直接读 records | v2 允许 |
| tests/helpers/S2B-task-timeline-fixture.ts:517、538 | `send_session_message`、`respond_session_message`；完整参数，后者 revision 来自 :530 公开读结果 | 工具链是，:530、:545 公开读消息；夹具整体另有 :631 内写 | v2 允许 |
| tests/helpers/K3-blocked-command-fixture.ts:266 | `send_user_message` 分支实际收到 `recipient/text`，来源 tests/work-graph/B2-01-blocked-commands.test.ts:125；缺真实分支的 `goalRef/intent` 等字段，见 src/core/agent-runtime/communication-tools.ts:280 | 否；tests/helpers/K3-tool-seams.ts:136 的宽松 schema、:143 的替身执行接受并忽略参数，随后继续业务链 | **F1** |

第二节：A1 平台签发字段。

| 文件:行 | owner／字段 | 来源 | 判定 |
|---|---|---|---|
| tests/helpers/AG2b-collaboration-fixture.ts:450 | `completionPolicies.activateCompletionPolicy`／`target.digest` | :446 安装返回，:451 原值使用 | v2 允许 |
| tests/helpers/R3e-evidence-fixture.ts:180 | 同上／`target.digest` | :171 安装返回，:182 原值使用 | v2 允许 |
| tests/helpers/S2A-notices-support.ts:152 | 同上／`target.digest` | :145 安装返回，:153 原值使用 | v2 允许 |
| tests/helpers/S2C-D-node-support.ts:218 | 同上／`target.digest` | :211 安装返回，:219 原值使用 | v2 允许 |
| tests/helpers/S2C-L-check-support.ts:147 | 同上／`target.digest` | :139 安装返回，:150 原值使用 | v2 允许 |
| tests/helpers/S4A-note-fixture.ts:187 | 同上／`target.digest` | :182 安装返回；:190 虽有类型断言，字段值未重算 | v2 允许 |
| tests/helpers/S4A-note-scope-fixture.ts:165 | 同上／`target.digest` | :160 安装返回；:168 原值使用 | v2 允许 |
| tests/helpers/S4B-note-multi-scope-fixture.ts:126 | 同上／`target.digest` | :121 安装返回；:129 原值使用 | v2 允许 |
| tests/helpers/S5-decision-fixture.ts:646 | 同上／`target.digest` | :638 安装返回，:647 原值使用 | v2 允许 |
| tests/helpers/S5-queue-support.ts:305 | 同上／`target.digest` | :300 安装返回，:306 原值使用 | v2 允许 |
| tests/helpers/S8A-L8-reminder-world.ts:394 | 同上／`target.digest` | :388 安装返回，:395 原值使用 | v2 允许 |
| tests/helpers/WP1-units-fixture.ts:176 | 同上／`target.digest` | :168 安装返回，:177 原值使用 | v2 允许 |
| tests/helpers/WP2-platform-support.ts:269 | 同上／`target.digest` | :265 安装返回，:270 原值使用 | v2 允许 |
| tests/helpers/graph-session-fixture.ts:335 | 同上／`target.digest` | :325 安装返回，:333、:336 原值使用 | v2 允许 |
| tests/helpers/task-claim-fixture.ts:258 | 同上／`target.digest` | :252 安装返回，:259 原值使用 | v2 允许 |
| tests/helpers/S2B-activity-fixture.ts:414 | 同上／`target.digest` | :415 自行调用 `completionPolicyContentDigest` 重算；未使用 :401 安装返回的摘要 | **F1** |
| tests/helpers/S2B-runtime-steps-fixture.ts:183 | 同上／`target.digest` | :184 自行重算；未使用 :170 安装返回的摘要 | **F1** |
| tests/helpers/AG2b-collaboration-fixture.ts:557 | `runtime.startQuery`／`prepared` | :553 prepare、:555 读取真实返回，原样提交 | v2 允许 |
| tests/helpers/K3-35-continuation-fixture.ts:501 | `runtime.startRun`／`prepared` | :481、:486 的真实准备结果，或 :491、:494 的 `prepareContinuation` 返回值 | v2 允许 |
| tests/helpers/K3-blocked-command-fixture.ts:340 | `runtime.startRun`／`prepared` | :336 真实 `prepareExecution` 返回 | v2 允许 |
| tests/helpers/K3-blocked-command-fixture.ts:563 | `runtime.startRun`／`prepared` | tests/runtime/K3-review-preparation.test.ts:397 传入真实准备结果，没有重建 | v2 允许 |
| tests/helpers/K3-proposal-round.ts:436 | `runtime.startRun`／`prepared` | :434 `prepareContinuation` 返回值 | v2 允许 |
| tests/helpers/RL-query-fixture.ts:169 | `runtime.startQuery`／`prepared` | :167 真实 `prepareQuery` 返回 | v2 允许 |
| tests/helpers/RL-re2-support.ts:68 | `runtime.startRun`／`prepared` | :66 真实 `prepareExecution` 返回 | v2 允许 |
| tests/helpers/S1-runtime-scenario-fixture.ts:257 | `runtime.startRun`／`prepared` | :254 真实 prepare，:256 原样接收 | v2 允许 |
| tests/helpers/S2B-be1-platform-fixture.ts:305 | `runtime.startRun`／`prepared` | :303 真实 prepare 返回 | v2 允许 |
| tests/helpers/S2B-r2-backfill-kernel-support.ts:92 | `runtime.startRun`／`prepared` | :89 真实 prepare 返回 | v2 允许 |
| tests/helpers/S2B-runtime-steps-fixture.ts:357 | `runtime.startRun`／`prepared` | :348 `prepareTaskForReal` 返回；其返回原值见 tests/helpers/task-claim-fixture.ts:606 | v2 允许 |
| tests/helpers/A2-restart-fixture.ts:94、110 | `workflow.advanceWork`／`next` 内的 prepared 等值 | :99、:114 原样接续真实 advance 返回的 `next` | v2 允许 |
| tests/helpers/WP1-scenario-fixture.ts:182、210 | `workflow.advanceWork`／`next` 内的 prepared 等值 | :190 原样循环接续；:208 取真实 `setup.next` | v2 允许 |
| tests/helpers/WP1-units-fixture.ts:566 | `workflow.advanceWork → runtime.startRun`／`prepared` | :530 手建 prepared，:559 的 startRun 替身不检查请求而返回预置结果；消费见 tests/business/WP1-start-refusal.test.ts:18、:43 | **F1** |
| tests/helpers/B2-09b-crash.ts:59 | `requests.listRequests`／cursor | :64 接收前页 `nextCursor`，原样继续 | v2 允许 |
| tests/helpers/B2-401-world.ts:248 | `reviews.listReviews`／cursor | :254 前页返回值 | v2 允许 |
| tests/helpers/B2-blocked-runtime.ts:281 | `reviews.listReviews`／cursor | :287 前页返回值 | v2 允许 |
| tests/helpers/K3-crr-fixture.ts:111 | `reviews.listReviews`／cursor | :117 前页返回值 | v2 允许 |
| tests/helpers/S2A-notices-support.ts:83 | `decisions.queryDecisionQueue`／cursor | tests/work-graph/S2A-notices-counts.test.ts:101 接续前页返回值 | v2 允许 |
| tests/helpers/S2B-task-timeline-fixture.ts:692 | `timeline.readTaskStateTimeline`／cursor | tests/work-graph/S2B-33-task-timeline-pagination.test.ts:30、:35、:65 原样传前页 `next` | v2 允许 |
| tests/helpers/S2B-track-fixture.ts:771 | `activity.readTrackBars`／cursor | tests/work-graph/S2B-30-track-bars.test.ts:140、:143 原样传前页 `next` | v2 允许 |
| tests/helpers/S2C-K-scenario-support.ts:67 | `workLineConversation.readWorkLinePage`／cursor | tests/scenarios/S2C-K2-conversation.test.ts:60、:112、:146、:157 使用公开页返回值 | v2 允许 |
| tests/helpers/S4B-note-check-fixture.ts:156 | `notes.listPlanVersions`／cursor | tests/work-graph/S4B-memory-version-lists.test.ts:94 原样传 `first.value.next` | v2 允许 |
| tests/helpers/S4C2-note-card-fixture.ts:377 | `decisions.queryDecisionQueue`／cursor | tests/work-graph/S4C2-N3.test.ts:101 原样传 `page1.nextCursor` | v2 允许 |
| tests/helpers/WP1-scenario-fixture.ts:255 | `sessionAnomalies.listSessionAnomalies`／cursor | :259 前页返回值 | v2 允许 |
| tests/core/work-graph/MVP-execution-list.test.ts:74、92、96、101 | `executions.listExecutions`／`afterCursor` | :68 返回 cursor，:75、:91 原样使用；后三处改变查询边界，未重建 cursor | v2 允许 |
| tests/helpers/S2A-notices-support.ts:88 | `workspaceDecisionSettings.markNoticesSeen`／`displayToken`、`seenThrough` | :83 真实队列页；调用方原样传递见 tests/work-graph/S2A-notices-counts.test.ts:109、:112 | v2 允许 |
| tests/helpers/S4C2-note-card-fixture.ts:389 | 同上／`displayToken`、`seenThrough` | :377 真实队列页，:390 原值提交 | v2 允许 |
| tests/helpers/WP2-notices-fixture.ts:121 | 同上／`displayToken`、`seenThrough` | :116 真实队列页，:122 原值提交 | v2 允许 |
| tests/helpers/K3-review-card-fixture.ts:294 | `decisionMessages.recordDecisionApplication`／application receipt | :288 `eventAt`、:291 解析内部记录后重建；:313、:315 接入 decision action | **F1** |
| tests/helpers/S5R2-c-support.ts:98 | 同上／application receipt | :92 `eventAt`、:95 解析内部记录后重建；:147 接入 Workflow | **F1** |
| tests/helpers/AG2b-collaboration-fixture.ts:351、357 | core HTTP／platform token | :339—345 读取真实 Host 页面；本组调用传 `host.token`，例如 :397、:477、:557 | v2 允许 |
| tests/helpers/A2-restart-fixture.ts:65、72 | 经 `corePost` 的 core HTTP／platform token | 原样传 `host.token`；页面取值实现见 tests/helpers/AG2b-collaboration-fixture.ts:339 | v2 允许 |
| tests/helpers/change-stream-reader.ts:107 | `GET core/changes`／platform token，真实 Host 分支 | tests/app/change-commit-observer.test.ts:168 从页面取得，:171 传入 | v2 允许 |
| tests/helpers/change-stream-reader.ts:107 | 同上／platform token，测试签发分支 | tests/app/change-stream.test.ts:26 自行定义 TOKEN，:42 配置服务器，:55 传入 | **F1** |
| tests/helpers/change-stream-reader.ts:108 | `GET core/changes`／`Last-Event-ID` | tests/app/change-stream.test.ts:158、:159、:161、:177 使用字面量 cursor，并非公开步骤返回后原样使用 | **F1** |
| tests/helpers/S8A-L8-prepare.ts:45 | `materials.openArtifact`／`bundleRef.digest` | :40 真实 prepare，:44 原样取 bundleRef | v2 允许 |
| tests/helpers/WP2-platform-support.ts:919 | `materials.openArtifact`／`bundleRef.digest` | :917 真实 prepare，:920 原值使用 | v2 允许 |
| tests/helpers/task-claim-fixture.ts:655 | `materials.openArtifact`／`bundleRef.digest` | :650 真实 query preparation，:656 原值使用 | v2 允许 |
| tests/helpers/S8A-L8-reminder-world.ts:522 | `architecture.reviseArchitectureCatalog`／`basedOn.digest` | :510 公开读架构，:526 原值使用 | v2 允许 |
| tests/helpers/S8D-platform-fixture.ts:267 | `architecture.compareFormalObserved`／`catalog.baseline.digest` | :223 公开读架构，:228 保留返回摘要 | v2 允许 |
| tests/helpers/B2-runtime-fixture.ts:209 | `runtime.createSession`／`role.pin.digest` | :195 真实 RoleSpec 安装返回，:197 保留 `contentDigest` | v2 允许 |

第三节：Record-store 测试及专用 helper。

下表各行号分别对应一个静态测试行；专用 helper 另列。没有将 Goal、Note 等记录的名称当作业务测试的判据。

| 文件:行 | 检查的契约／专用 helper 用途 | 判定 |
|---|---|---|
| tests/record-store/R3a-transaction-boundaries.test.ts:46 | `beforeWrite` 次数、幂等重放及返回值与存储隔离；断言见 :55—72 | v2 允许 |
| tests/record-store/R3a-transaction-boundaries.test.ts:76 | 事件、快照、幂等记录事务回滚；断言见 :94—99 | v2 允许 |
| tests/record-store/R3a-transaction-boundaries.test.ts:103 | 同版本记录身份损坏时拒绝提交、不新增事件；断言见 :127—130 | v2 允许 |
| tests/record-store/R3b-body-concurrency.test.ts:60 | 并发 body 去重、唯一首次写入者及 source 保留；断言见 :84—93 | v2 允许 |
| tests/record-store/R3b-body-concurrency.test.ts:74、75 | 外组专用 worker 的两处调用；真实 `RawArtifactStore.put` 在 tests/record-store/sqlite-body-race-worker.mjs:18 | v2 允许 |
| tests/record-store/S2A-ordered-lookup.test.ts:152、192、228、263、293、338、362、414、441、499、540、613 | 文本／整数排序、同值 refKey 次序、bound/after 交集、参数和注册校验、重开建索引 | v2 允许 |
| tests/record-store/S2C-count-lookup.test.ts:124、142、188、222、248、284、325 | 空存储、等值计数、distinct 类型规则、有序索引候选、错误请求、重开补索引 | v2 允许 |
| tests/record-store/S4B-text-search.test.ts:33、47、61、75、94、108、122、136、150、164、183、196、209、222、236、249、269、284、299、313、361、380、400、418、441、455、469、489、504、525、539、558、571、584、597、610、624、639、652、675、692、709 | 子串、大小写与 Unicode 归一化、参数边界、更新后索引、分页、AND、多连接和重建；:299 检查 store 仍返回 withdrawn 记录，没有断言上层 Note 可用性 | v2 允许 |
| tests/record-store/SP-literal-type.test.ts:65、76、142 | aggregateType 注册安全、合法类型读写、各类型索引隔离 | v2 允许 |
| tests/record-store/SP-lookup-index-migration.test.ts:107、154、188、223 | 多连接注册变化、部分／完整 schema 重开及查找可用性 | v2 允许 |
| tests/record-store/SP-record-store-limits.test.ts:113、130、167、194 | lookup／ordered lookup 的 limit、next、after 边界及后端一致性 | v2 允许 |
| tests/record-store/SP-text-scan-undo.test.ts:14 | store 文本扫描内部撤销恢复规则 | v2 允许 |
| tests/record-store/SP-text-scan.test.ts:72、87、109、131、173、198、215、245、270、290、313、330、347、371、402、428 | UTF-8 次序、分页、after、写后可见性、prefix 迁移、跨连接缓存、注册失配、Unicode、any 合并 | v2 允许 |
| tests/record-store/WP2-notice-cursors.test.ts:61、78 | schema 的 cursor 字段白名单及 commit binding 校验；没有检查通知“已读”业务状态 | v2 允许 |
| tests/record-store/lookup.test.ts:55、72、94、137、174 | 解码值索引、UTF-8 次序、keyset、提交／重放／guard、失败原子性、重开索引及损坏记录拒绝 | v2 允许 |
| tests/record-store/transaction-extensions.test.ts:46、57、75、92、116、132、154、174、196 | horizon、唯一槽 CAS、cursor binding、重放、schema 拒绝回滚、输入隔离、并发及重开持久化 | v2 允许 |
| tests/helpers/S4B-text-search-support.ts:155、168 | 专用 `seed/seedBatch` 经 store port 提交；使用者仅为 tests/record-store/S4B-text-search.test.ts:11、tests/record-store/SP-record-store-limits.test.ts:13、tests/record-store/SP-text-scan.test.ts:13 | v2 允许 |

第四节：A7 三个具名 helper。

| 具名 helper | 本组使用情况 | 越界数 |
|---|---|---:|
| `buildNoteTools`；范围定义见 .lead-ref/books/test-rule-sheet-v2.md:45 | L1 文件清单内无定义、导入或调用；检查范围为 .lead-ref/groups/L1-files.txt:1 至 :133 | 0 |
| `damageKernel`；范围定义见 .lead-ref/books/test-rule-sheet-v2.md:50 | 同一 L1 范围内无定义、导入或调用 | 0 |
| `process-sandbox-standin.ts` 的 `probe`；范围定义见 .lead-ref/books/test-rule-sheet-v2.md:59 | 同一 L1 范围内无导入或调用；tests/helpers/RL-kernel-sandbox-double.ts:1 是另一 helper，不冒充此项 | 0 |

无实例：以下 66 个文件没有本次四类实例；不表示其中不存在范围外的 v1 问题。

- tests/architecture/boundaries.test.ts:1
- tests/architecture/production-reach.test.ts:1
- tests/architecture/production-reach.ts:1
- tests/architecture/record-store-literal-type.test.ts:1
- tests/architecture/state-writes.test.ts:1
- tests/context/verification-workspace-reader.test.ts:1
- tests/contracts/A2-rework-contract-helpers.test.ts:1
- tests/contracts/RL-21-default-resource-cap-settings.test.ts:1
- tests/contracts/ledger-cursor.test.ts:1
- tests/contracts/review-admission.test.ts:1
- tests/helpers/C1-mailbox-fixture.ts:1
- tests/helpers/C2-runtime-platform-fixture.ts:1
- tests/helpers/K-boundary-facts-support.ts:1
- tests/helpers/K-legacy-reader-support.ts:1
- tests/helpers/K-readonly-host-support.ts:1
- tests/helpers/K-readonly-work-support.ts:1
- tests/helpers/K-session-support.ts:1
- tests/helpers/K-t1-support.ts:1
- tests/helpers/K3-07-support.ts:1
- tests/helpers/K3-35-prepare.ts:1
- tests/helpers/K3-35-required-review-block.ts:1
- tests/helpers/K3-35-runtime.ts:1
- tests/helpers/K3-continuation-pure-fixture.ts:1
- tests/helpers/K3-mailbox-seam.ts:1
- tests/helpers/K3-mixed-seams.ts:1
- tests/helpers/K3-padded-review-record.ts:1
- tests/helpers/K3-prefix-claim.ts:1
- tests/helpers/K3-real-workspace.ts:1
- tests/helpers/K3-tool-seams.ts:1
- tests/helpers/RL-kernel-sandbox-double.ts:1
- tests/helpers/RL-resource-caps-support.ts:1
- tests/helpers/S1-archive-service-fixture.ts:1
- tests/helpers/S1-public-anchor.ts:1
- tests/helpers/S1-session-facts-fixture.ts:1
- tests/helpers/S1-workflow-archive-fixture.ts:1
- tests/helpers/S2A-notices-overbound-fixture.ts:1
- tests/helpers/S2A-notices-workspace2-fixture.ts:1
- tests/helpers/S2A-planning-fixture.ts:1
- tests/helpers/S2A-queue-fixture.ts:1
- tests/helpers/S2A-route-storage-support.ts:1
- tests/helpers/S2A-window-fixture.ts:1
- tests/helpers/S2B-be1r-kernel-faults-support.ts:1
- tests/helpers/S2B-be1r2-support.ts:1
- tests/helpers/S2B-be2-reconcile-support.ts:1
- tests/helpers/S2B-counting-off-support.ts:1
- tests/helpers/S2B-kernel-records-fixture.ts:1
- tests/helpers/S2B-r2-activity-support.ts:1
- tests/helpers/S2B-r2-calendar-reverify-support.ts:1
- tests/helpers/S2B-r2-timeline-public-flows.ts:1
- tests/helpers/S2B-r2-track-support.ts:1
- tests/helpers/S2B-r3-r4-support.ts:1
- tests/helpers/S2B-runtime-store-fixture.ts:1
- tests/helpers/S2B-runtime-tools-support.ts:1
- tests/helpers/S2C-K2-scenario-support.ts:1
- tests/helpers/S2C-L-runs-support.ts:1
- tests/helpers/S2C-P-pins-fixture.ts:1
- tests/helpers/S2C-X-scale-fixture.ts:1
- tests/helpers/S4A-note-fault-fixture.ts:1
- tests/helpers/S4A-note-interleave-fixture.ts:1
- tests/helpers/S4C-node-notes-fixture.ts:1
- tests/helpers/S5-application-support.ts:1
- tests/helpers/S5-user-message-support.ts:1
- tests/helpers/S5R2-d-support.ts:1
- tests/helpers/WP2-duties-fixture.ts:1
- tests/helpers/executed-files-stub.ts:1
- tests/helpers/orchestration-fixture.ts:1

```json
[
  {"section":"A1草稿","file":"tests/helpers/AG2b-collaboration-fixture.ts","line":[461],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"完整请求；464公开apply"},
  {"section":"A1草稿","file":"tests/helpers/B2-execution-fixture.ts","line":[160],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"163公开apply；夹具另有282、309内部执行写入"},
  {"section":"A1草稿","file":"tests/helpers/K3-proposal-round.ts","line":[203],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"211公开apply；331另有records读取"},
  {"section":"A1草稿","file":"tests/helpers/K3-review-card-fixture.ts","line":[122,377],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"128、383公开apply；288另有内部回执读取"},
  {"section":"A1草稿","file":"tests/helpers/R3e-evidence-fixture.ts","line":[209,394],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"216、401公开apply；265另有运行结果内写"},
  {"section":"A1草稿","file":"tests/helpers/S2A-notices-support.ts","line":[175],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"178公开apply；271另有检查结果内写"},
  {"section":"A1草稿","file":"tests/helpers/S2B-activity-fixture.ts","line":[364],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"372公开apply；498另有运行结果内写"},
  {"section":"A1草稿","file":"tests/helpers/S2B-task-timeline-fixture.ts","line":[295,333],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"302、343公开apply；600、631另有内部写入"},
  {"section":"A1草稿","file":"tests/helpers/S2B-track-fixture.ts","line":[281],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"288公开apply；392另有运行结果内写"},
  {"section":"A1草稿","file":"tests/helpers/S2C-D-node-support.ts","line":[281],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"284公开apply；300另有Session内写"},
  {"section":"A1草稿","file":"tests/helpers/S2C-L-line-support.ts","line":[334],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"341公开apply；493另有异常锚点内写"},
  {"section":"A1草稿","file":"tests/helpers/S4A-note-fixture.ts","line":[222],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"225公开apply；242另有Session内写"},
  {"section":"A1草稿","file":"tests/helpers/S4A-note-scope-fixture.ts","line":[212,234],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"215、237公开apply；253另有Session内写"},
  {"section":"A1草稿","file":"tests/helpers/S4B-memory-fixture.ts","line":[79],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"82公开apply；105另有Session内写"},
  {"section":"A1草稿","file":"tests/helpers/S4B-note-multi-scope-fixture.ts","line":[105,151,206],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"完整请求；108、154、213公开apply；基础夹具见tests/helpers/S4A-note-scope-fixture.ts:253"},
  {"section":"A1草稿","file":"tests/helpers/S4C2-note-card-fixture.ts","line":[244],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"251公开apply；185另有Session内写"},
  {"section":"A1草稿","file":"tests/helpers/S5-decision-fixture.ts","line":[738,938],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"完整初始及候选请求；744公开apply；845、880另有执行内写"},
  {"section":"A1草稿","file":"tests/helpers/S5-queue-support.ts","line":[326],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"329公开apply；356、362另有执行入口内写"},
  {"section":"A1草稿","file":"tests/helpers/S5R2-a-support.ts","line":[82],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"完整；92公开读、98 apply；105通过records断言，后续非全公开"},
  {"section":"A1草稿","file":"tests/helpers/S5R2-b-support.ts","line":[253],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"260公开apply；176、234另有内部写读"},
  {"section":"A1草稿","file":"tests/helpers/S5R2-c-support.ts","line":[279],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"284公开apply；289通过records断言，后续非全公开"},
  {"section":"A1草稿","file":"tests/helpers/S8A-L8-reminder-world.ts","line":[445],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"完整；449公开apply"},
  {"section":"A1草稿","file":"tests/helpers/W2-whiteboard-fixture.ts","line":[294,298,309],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"285构造完整请求；303、313公开apply；352、392另有内部写入"},
  {"section":"A1草稿","file":"tests/helpers/WP1-entry-fixture.ts","line":[310],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"314公开apply；241另有执行入口调用"},
  {"section":"A1草稿","file":"tests/helpers/WP1-handover-fixture.ts","line":[464],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"469公开apply；360另有运行结果内写"},
  {"section":"A1草稿","file":"tests/helpers/WP1-units-fixture.ts","line":[199],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"204公开apply；274、321另有内部写读"},
  {"section":"A1草稿","file":"tests/helpers/WP2-platform-support.ts","line":[298,635,691],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"302、641、697公开apply；526、579另有内部写入"},
  {"section":"A1草稿","file":"tests/helpers/graph-session-fixture.ts","line":[425],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"431公开读、433 apply；383另有Session内写"},
  {"section":"A1草稿","file":"tests/helpers/task-claim-fixture.ts","line":[344],"owner":"plans.proposePlan","value":"PlanRevisionDraft","verdict":"v2 允许","note":"350公开apply；370另有Session内写"},
  {"section":"A1草稿","file":"tests/helpers/S4A-note-fixture.ts","line":[282],"owner":"notes.writeNote","value":"NoteDraftV1","verdict":"v2 允许","note":"完整写入参数，真实owner；夹具另有242内部登记"},
  {"section":"A1草稿","file":"tests/helpers/S4A-note-scope-fixture.ts","line":[329],"owner":"notes.writeNote","value":"NoteDraftV1","verdict":"v2 允许","note":"完整写入参数，真实owner；夹具另有253内部登记"},
  {"section":"A1草稿","file":"tests/helpers/S4C2-note-card-fixture.ts","line":[287,293],"owner":"notes.writeNote（经f.write）","value":"NoteDraftV1","verdict":"v2 允许","note":"完整转交；107、117默认草稿完整，113、121有断言，不能替任意覆盖值证明合法；185另有内写"},
  {"section":"A1草稿","file":"tests/helpers/B2-blocked-runtime.ts","line":[424],"owner":"request_command_rerun","value":"工具参数","verdict":"v2 允许","note":"423有断言；实际参数交真实工具校验，281读真实review"},
  {"section":"A1草稿","file":"tests/helpers/B2-crr-world.ts","line":[309],"owner":"request_command_rerun","value":"command/reason/rewriteOf?","verdict":"v2 允许","note":"完整；314真实准备启动、318读请求"},
  {"section":"A1草稿","file":"tests/helpers/K3-proposal-round.ts","line":[708],"owner":"propose_safer_method","value":"item/command/cwd?/rationale","verdict":"v2 允许","note":"705构造完整参数；空cwd省略；699断言不是参数；331另有records读取"},
  {"section":"A1草稿","file":"tests/helpers/S2B-task-timeline-fixture.ts","line":[517,538],"owner":"send_session_message/respond_session_message","value":"工具参数","verdict":"v2 允许","note":"完整；530、545公开读消息；夹具另有631内部写入"},
  {"section":"A1草稿","file":"tests/helpers/K3-blocked-command-fixture.ts","line":[266],"owner":"send_user_message替身","value":"recipient/text","verdict":"F1","note":"tests/work-graph/B2-01-blocked-commands.test.ts:125传入；缺真实分支字段；tests/helpers/K3-tool-seams.ts:136、143忽略请求"},

  {"section":"A1签发字段","file":"tests/helpers/AG2b-collaboration-fixture.ts","line":[450],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"446安装返回，451原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/R3e-evidence-fixture.ts","line":[180],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"171安装返回，182原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/S2A-notices-support.ts","line":[152],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"145安装返回，153原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/S2C-D-node-support.ts","line":[218],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"211安装返回，219原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/S2C-L-check-support.ts","line":[147],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"139安装返回，150原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/S4A-note-fixture.ts","line":[187],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"182安装返回；190虽有断言，未重算"},
  {"section":"A1签发字段","file":"tests/helpers/S4A-note-scope-fixture.ts","line":[165],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"160安装返回，168原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/S4B-note-multi-scope-fixture.ts","line":[126],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"121安装返回，129原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/S5-decision-fixture.ts","line":[646],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"638安装返回，647原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/S5-queue-support.ts","line":[305],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"300安装返回，306原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/S8A-L8-reminder-world.ts","line":[394],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"388安装返回，395原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/WP1-units-fixture.ts","line":[176],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"168安装返回，177原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/WP2-platform-support.ts","line":[269],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"265安装返回，270原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/graph-session-fixture.ts","line":[335],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"325安装返回，333、336原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/task-claim-fixture.ts","line":[258],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"252安装返回，259原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/S2B-activity-fixture.ts","line":[414],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"F1","note":"415自行重算，未使用401安装返回摘要"},
  {"section":"A1签发字段","file":"tests/helpers/S2B-runtime-steps-fixture.ts","line":[183],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"F1","note":"184自行重算，未使用170安装返回摘要"},
  {"section":"A1签发字段","file":"tests/helpers/AG2b-collaboration-fixture.ts","line":[557],"owner":"runtime.startQuery","value":"prepared","verdict":"v2 允许","note":"553真实prepare，555读取返回"},
  {"section":"A1签发字段","file":"tests/helpers/K3-35-continuation-fixture.ts","line":[501],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"481、486或491、494真实准备结果"},
  {"section":"A1签发字段","file":"tests/helpers/K3-blocked-command-fixture.ts","line":[340],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"336真实prepare返回"},
  {"section":"A1签发字段","file":"tests/helpers/K3-blocked-command-fixture.ts","line":[563],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"tests/runtime/K3-review-preparation.test.ts:397传真实准备结果"},
  {"section":"A1签发字段","file":"tests/helpers/K3-proposal-round.ts","line":[436],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"434 prepareContinuation原值"},
  {"section":"A1签发字段","file":"tests/helpers/RL-query-fixture.ts","line":[169],"owner":"runtime.startQuery","value":"prepared","verdict":"v2 允许","note":"167真实prepareQuery返回"},
  {"section":"A1签发字段","file":"tests/helpers/RL-re2-support.ts","line":[68],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"66真实prepare返回"},
  {"section":"A1签发字段","file":"tests/helpers/S1-runtime-scenario-fixture.ts","line":[257],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"254、256真实prepare返回"},
  {"section":"A1签发字段","file":"tests/helpers/S2B-be1-platform-fixture.ts","line":[305],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"303真实prepare返回"},
  {"section":"A1签发字段","file":"tests/helpers/S2B-r2-backfill-kernel-support.ts","line":[92],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"89真实prepare返回"},
  {"section":"A1签发字段","file":"tests/helpers/S2B-runtime-steps-fixture.ts","line":[357],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"348真实prepareTaskForReal；原值返回见tests/helpers/task-claim-fixture.ts:606"},
  {"section":"A1签发字段","file":"tests/helpers/A2-restart-fixture.ts","line":[94,110],"owner":"workflow.advanceWork","value":"next内prepared等字段","verdict":"v2 允许","note":"99、114原样接续公开返回next"},
  {"section":"A1签发字段","file":"tests/helpers/WP1-scenario-fixture.ts","line":[182,210],"owner":"workflow.advanceWork","value":"next内prepared等字段","verdict":"v2 允许","note":"190原样接续；208使用真实setup.next"},
  {"section":"A1签发字段","file":"tests/helpers/WP1-units-fixture.ts","line":[566],"owner":"workflow.advanceWork/runtime.startRun","value":"prepared","verdict":"F1","note":"530手建；559替身忽略请求；tests/business/WP1-start-refusal.test.ts:18、43消费"},
  {"section":"A1签发字段","file":"tests/helpers/B2-09b-crash.ts","line":[59],"owner":"requests.listRequests","value":"cursor","verdict":"v2 允许","note":"64前页nextCursor原值"},
  {"section":"A1签发字段","file":"tests/helpers/B2-401-world.ts","line":[248],"owner":"reviews.listReviews","value":"cursor","verdict":"v2 允许","note":"254前页nextCursor原值"},
  {"section":"A1签发字段","file":"tests/helpers/B2-blocked-runtime.ts","line":[281],"owner":"reviews.listReviews","value":"cursor","verdict":"v2 允许","note":"287前页nextCursor原值"},
  {"section":"A1签发字段","file":"tests/helpers/K3-crr-fixture.ts","line":[111],"owner":"reviews.listReviews","value":"cursor","verdict":"v2 允许","note":"117前页nextCursor原值"},
  {"section":"A1签发字段","file":"tests/helpers/S2A-notices-support.ts","line":[83],"owner":"decisions.queryDecisionQueue","value":"cursor","verdict":"v2 允许","note":"tests/work-graph/S2A-notices-counts.test.ts:101接续公开返回值"},
  {"section":"A1签发字段","file":"tests/helpers/S2B-task-timeline-fixture.ts","line":[692],"owner":"timeline.readTaskStateTimeline","value":"cursor","verdict":"v2 允许","note":"tests/work-graph/S2B-33-task-timeline-pagination.test.ts:30、35、65原样传next"},
  {"section":"A1签发字段","file":"tests/helpers/S2B-track-fixture.ts","line":[771],"owner":"activity.readTrackBars","value":"cursor","verdict":"v2 允许","note":"tests/work-graph/S2B-30-track-bars.test.ts:140、143原样传next"},
  {"section":"A1签发字段","file":"tests/helpers/S2C-K-scenario-support.ts","line":[67],"owner":"workLineConversation.readWorkLinePage","value":"cursor","verdict":"v2 允许","note":"tests/scenarios/S2C-K2-conversation.test.ts:60、112、146、157使用公开返回值"},
  {"section":"A1签发字段","file":"tests/helpers/S4B-note-check-fixture.ts","line":[156],"owner":"notes.listPlanVersions","value":"cursor","verdict":"v2 允许","note":"tests/work-graph/S4B-memory-version-lists.test.ts:94原样传first.value.next"},
  {"section":"A1签发字段","file":"tests/helpers/S4C2-note-card-fixture.ts","line":[377],"owner":"decisions.queryDecisionQueue","value":"cursor","verdict":"v2 允许","note":"tests/work-graph/S4C2-N3.test.ts:101原样传page1.nextCursor"},
  {"section":"A1签发字段","file":"tests/helpers/WP1-scenario-fixture.ts","line":[255],"owner":"sessionAnomalies.listSessionAnomalies","value":"cursor","verdict":"v2 允许","note":"259前页nextCursor原值"},
  {"section":"A1签发字段","file":"tests/core/work-graph/MVP-execution-list.test.ts","line":[74,92,96,101],"owner":"executions.listExecutions","value":"afterCursor","verdict":"v2 允许","note":"68返回，75、91原样使用；后三处改变查询边界但未修改cursor"},
  {"section":"A1签发字段","file":"tests/helpers/S2A-notices-support.ts","line":[88],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"83真实队列页；tests/work-graph/S2A-notices-counts.test.ts:109、112原样传递"},
  {"section":"A1签发字段","file":"tests/helpers/S4C2-note-card-fixture.ts","line":[389],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"377真实队列页，390原值提交"},
  {"section":"A1签发字段","file":"tests/helpers/WP2-notices-fixture.ts","line":[121],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"116真实队列页，122原值提交"},
  {"section":"A1签发字段","file":"tests/helpers/K3-review-card-fixture.ts","line":[294],"owner":"decisionMessages.recordDecisionApplication","value":"applicationReceipt","verdict":"F1","note":"288 eventAt、291解析内部记录重建；313、315接入decision action"},
  {"section":"A1签发字段","file":"tests/helpers/S5R2-c-support.ts","line":[98],"owner":"decisionMessages.recordDecisionApplication","value":"applicationReceipt","verdict":"F1","note":"92 eventAt、95解析内部记录重建；147接入Workflow"},
  {"section":"A1签发字段","file":"tests/helpers/AG2b-collaboration-fixture.ts","line":[351,357],"owner":"core HTTP","value":"platform token","verdict":"v2 允许","note":"339—345真实Host页面返回；397、477、557等原样传递"},
  {"section":"A1签发字段","file":"tests/helpers/A2-restart-fixture.ts","line":[65,72],"owner":"core HTTP","value":"platform token","verdict":"v2 允许","note":"host.token原样转交；来源见tests/helpers/AG2b-collaboration-fixture.ts:339"},
  {"section":"A1签发字段","file":"tests/helpers/change-stream-reader.ts","line":[107],"owner":"GET core/changes","value":"platform token","verdict":"v2 允许","note":"tests/app/change-commit-observer.test.ts:168真实页面返回，171传入"},
  {"section":"A1签发字段","file":"tests/helpers/change-stream-reader.ts","line":[107],"owner":"GET core/changes","value":"platform token","verdict":"F1","note":"tests/app/change-stream.test.ts:26测试签发，42配置服务器，55传入"},
  {"section":"A1签发字段","file":"tests/helpers/change-stream-reader.ts","line":[108],"owner":"GET core/changes","value":"Last-Event-ID","verdict":"F1","note":"tests/app/change-stream.test.ts:158、159、161、177为测试文字cursor"},
  {"section":"A1签发字段","file":"tests/helpers/S8A-L8-prepare.ts","line":[45],"owner":"materials.openArtifact","value":"bundleRef.digest","verdict":"v2 允许","note":"40真实prepare，44原样取bundleRef"},
  {"section":"A1签发字段","file":"tests/helpers/WP2-platform-support.ts","line":[919],"owner":"materials.openArtifact","value":"bundleRef.digest","verdict":"v2 允许","note":"917真实prepare，920原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/task-claim-fixture.ts","line":[655],"owner":"materials.openArtifact","value":"bundleRef.digest","verdict":"v2 允许","note":"650真实query preparation，656原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/S8A-L8-reminder-world.ts","line":[522],"owner":"architecture.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"510公开架构读取，526原值使用"},
  {"section":"A1签发字段","file":"tests/helpers/S8D-platform-fixture.ts","line":[267],"owner":"architecture.compareFormalObserved","value":"catalog.baseline.digest","verdict":"v2 允许","note":"223公开架构读取，228保留返回摘要"},
  {"section":"A1签发字段","file":"tests/helpers/B2-runtime-fixture.ts","line":[209],"owner":"runtime.createSession","value":"role.pin.digest","verdict":"v2 允许","note":"195真实RoleSpec安装，197原样取contentDigest"},

  {"section":"RecordStore","file":"tests/record-store/R3a-transaction-boundaries.test.ts","line":[46,76,103],"owner":"RecordStore","value":"事务边界测试","verdict":"v2 允许","note":"分别检查钩子及隔离、事务回滚、同版本身份损坏拒绝；断言55—72、94—99、127—130"},
  {"section":"RecordStore","file":"tests/record-store/R3b-body-concurrency.test.ts","line":[60],"owner":"RawArtifactStore","value":"并发body写入","verdict":"v2 允许","note":"84—93检查去重、首次owner/source保留"},
  {"section":"RecordStore","file":"tests/record-store/R3b-body-concurrency.test.ts","line":[74,75],"owner":"RawArtifactStore.put","value":"专用worker调用","verdict":"v2 允许","note":"外组helper实际put见tests/record-store/sqlite-body-race-worker.mjs:18"},
  {"section":"RecordStore","file":"tests/record-store/S2A-ordered-lookup.test.ts","line":[152,192,228,263,293,338,362,414,441,499,540,613],"owner":"RecordStore.lookupOrdered","value":"排序、边界、续页、注册测试","verdict":"v2 允许","note":"逐行均检验store索引契约"},
  {"section":"RecordStore","file":"tests/record-store/S2C-count-lookup.test.ts","line":[124,142,188,222,248,284,325],"owner":"RecordStore.countLookup","value":"计数、distinct、参数和重开测试","verdict":"v2 允许","note":"逐行均检验store计数契约"},
  {"section":"RecordStore","file":"tests/record-store/S4B-text-search.test.ts","line":[33,47,61,75,94,108,122,136,150,164,183,196,209,222,236,249,269,284,299,313,361,380,400,418,441,455,469,489,504,525,539,558,571,584,597,610,624,639,652,675,692,709],"owner":"RecordStore.searchText","value":"文本检索及索引维护测试","verdict":"v2 允许","note":"逐行检验匹配、校验、分页、更新和重建；299不判断上层Note业务可用性"},
  {"section":"RecordStore","file":"tests/record-store/SP-literal-type.test.ts","line":[65,76,142],"owner":"RecordStore","value":"aggregateType及类型索引隔离","verdict":"v2 允许","note":"注册、提交和查找契约"},
  {"section":"RecordStore","file":"tests/record-store/SP-lookup-index-migration.test.ts","line":[107,154,188,223],"owner":"RecordStore","value":"索引注册迁移","verdict":"v2 允许","note":"多连接、部分及完整schema重开"},
  {"section":"RecordStore","file":"tests/record-store/SP-record-store-limits.test.ts","line":[113,130,167,194],"owner":"RecordStore.lookup/lookupOrdered","value":"limit/next/after","verdict":"v2 允许","note":"分页边界及后端一致性"},
  {"section":"RecordStore","file":"tests/record-store/SP-text-scan-undo.test.ts","line":[14],"owner":"RecordStore.text-scan","value":"撤销恢复","verdict":"v2 允许","note":"存储内部扫描结构的恢复规则"},
  {"section":"RecordStore","file":"tests/record-store/SP-text-scan.test.ts","line":[72,87,109,131,173,198,215,245,270,290,313,330,347,371,402,428],"owner":"RecordStore.searchText","value":"扫描、分页、缓存及跨连接测试","verdict":"v2 允许","note":"逐行均检验store文本扫描契约"},
  {"section":"RecordStore","file":"tests/record-store/WP2-notice-cursors.test.ts","line":[61,78],"owner":"RecordStore","value":"cursor字段白名单和binding","verdict":"v2 允许","note":"schema及commit校验，不判断通知已读业务状态"},
  {"section":"RecordStore","file":"tests/record-store/lookup.test.ts","line":[55,72,94,137,174],"owner":"RecordStore.lookup","value":"索引、分页、重放和失败原子性","verdict":"v2 允许","note":"逐行均检验store查找及提交契约"},
  {"section":"RecordStore","file":"tests/record-store/transaction-extensions.test.ts","line":[46,57,75,92,116,132,154,174,196],"owner":"RecordStore.commit","value":"horizon、唯一槽、cursor binding及事务","verdict":"v2 允许","note":"逐行均检验store提交契约"},
  {"section":"RecordStore","file":"tests/helpers/S4B-text-search-support.ts","line":[155,168],"owner":"RecordStore.commit","value":"专用seed/seedBatch","verdict":"v2 允许","note":"仅store测试使用；引用见tests/record-store/S4B-text-search.test.ts:11、tests/record-store/SP-record-store-limits.test.ts:13、tests/record-store/SP-text-scan.test.ts:13"}
]
```

v2 允许 221，F1 8，F3 0，A7 越界 0，文件 133/133，枚举完整